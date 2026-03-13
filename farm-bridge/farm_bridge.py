"""
Farm Bridge — Ray's Berry Farm
Polls Open-Meteo + NWS, computes GDD, chill hours, growth stage, fungal risk,
SWD pressure, spray window, frost risk, VPD, yield threat, and pushes them all
into Home Assistant as virtual sensors via the HA REST API.

Runs every 10 minutes as a Docker service alongside HA.
"""

import os
import math
import time
import logging
import datetime
import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [farm-bridge] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("farm-bridge")

# ── Config ────────────────────────────────────────────────────────────────────
HA_URL   = os.getenv("HA_URL",   "http://homeassistant:8123")
HA_TOKEN = os.getenv("HA_TOKEN", "")
INTERVAL = int(os.getenv("BRIDGE_INTERVAL_SECONDS", "600"))  # 10 min default

# Ray's Berry Farm — Jersey County, IL
LAT, LON = 39.09, -90.33

# ── Jersey County climate normals (month index 0–11, temps in °F) ─────────────
MONTHLY_WEATHER = [
    {"low": 18, "high": 36}, {"low": 22, "high": 42}, {"low": 30, "high": 53},
    {"low": 41, "high": 65}, {"low": 52, "high": 74}, {"low": 62, "high": 83},
    {"low": 66, "high": 87}, {"low": 64, "high": 85}, {"low": 55, "high": 78},
    {"low": 44, "high": 66}, {"low": 34, "high": 52}, {"low": 22, "high": 40},
]

# ── Crop config (Triple Crown / Chester blackberry) ───────────────────────────
GDD_BASE            = 50
CHILL_THRESHOLD_F   = 45
CHILL_HOURS_NEEDED  = 700
GDD_BUD_BREAK       = 100
GDD_VEGETATIVE      = 200
GDD_FLOWERING       = 350
GDD_GREEN_FRUIT     = 550
GDD_RIPENING        = 750
GDD_HARVEST_READY   = 900
GDD_POST_HARVEST    = 1100

GROWTH_STAGES = [
    (GDD_POST_HARVEST, "Post-Harvest"),
    (GDD_HARVEST_READY, "Harvest Ready"),
    (GDD_RIPENING,      "Ripening"),
    (GDD_GREEN_FRUIT,   "Green Fruit"),
    (GDD_FLOWERING,     "Flowering"),
    (GDD_VEGETATIVE,    "Vegetative"),
    (GDD_BUD_BREAK,     "Bud Break"),
    (0,                 "Dormant"),
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_growth_stage(gdd: float) -> str:
    for threshold, label in GROWTH_STAGES:
        if gdd >= threshold:
            return label
    return "Dormant"


def get_fungal_risk(humidity: float, precip: float, temp_f: float) -> float:
    if temp_f < 45 or temp_f > 90:
        return 0.0
    wetness = min(1.0, max(0, humidity - 60) / 40 + precip * 2)
    temp_factor = 1.0 if 60 <= temp_f <= 80 else 0.6
    return round(min(100.0, wetness * temp_factor * 100), 1)


def get_swd_level(gdd: float) -> str:
    if gdd < 500:  return "Minimal"
    if gdd < 800:  return "Emerging"
    if gdd < 1200: return "Active"
    return "Declining"


def get_spray_window(wind_speed: float, wind_gusts: float, solar_rad: float, precip: float) -> str:
    if precip > 0.01:             return "closed - rain"
    if wind_speed > 10 or wind_gusts > 15: return "closed - wind"
    if solar_rad > 600:           return "closed - solar"
    return "open"


def get_vpd_status(vpd: float) -> str:
    if vpd < 0.4:  return "Too Low"
    if vpd < 1.2:  return "Optimal"
    if vpd < 2.0:  return "Mild Stress"
    return "High Stress"


def compute_vpd(temp_f: float, humidity: float) -> float:
    temp_c = (temp_f - 32) * 5 / 9
    svp = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
    return round(svp * (1 - humidity / 100), 3)


def project_gdd_days(current_gdd: float, target_gdd: float) -> int | None:
    """Project how many days until target GDD using climate normals."""
    gdd = current_gdd
    today = datetime.date.today()
    for i in range(300):
        d = today + datetime.timedelta(days=i)
        norm = MONTHLY_WEATHER[d.month - 1]
        avg_temp = (norm["high"] + norm["low"]) / 2
        gdd += max(0, avg_temp - GDD_BASE)
        if gdd >= target_gdd:
            return i + 1
    return None


def frost_risk_level(daily: dict, gdd: float) -> str:
    """Scan 7-day forecast for frost during vulnerable stages."""
    stage = get_growth_stage(gdd)
    vulnerable = {"Bud Break", "Vegetative", "Flowering", "Green Fruit"}
    if stage not in vulnerable:
        return "none"
    today = datetime.date.today().isoformat()
    for i, d in enumerate(daily.get("time", [])):
        if d < today:
            continue
        low = daily["temperature_2m_min"][i]
        if low <= 32:
            return "critical" if low < 28 else "warning"
    return "none"


def composite_yield_threat(daily: dict, hourly: dict, soil_moisture: float, gdd: float, nws_alerts: int) -> int:
    today = datetime.date.today().isoformat()
    # Frost
    frost_score = 80 if any(
        daily["temperature_2m_min"][i] <= 32
        for i, d in enumerate(daily.get("time", []))
        if d >= today
    ) else 0
    # SWD
    swd_score = 70 if gdd >= 800 else 35 if gdd >= 500 else 0
    # Fungal (peak 48h from hourly)
    now_str = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H")
    start = max(0, next((i for i, t in enumerate(hourly.get("time", [])) if t[:13] >= now_str), 0))
    fungal_scores = [
        get_fungal_risk(hourly["relativehumidity_2m"][start + k], hourly["precipitation"][start + k], hourly["temperature_2m"][start + k])
        for k in range(min(48, len(hourly.get("time", [])) - start))
    ]
    fungal_score = max(fungal_scores) if fungal_scores else 0
    # Drought
    drought_score = 75 if soil_moisture < 0.25 else 40 if soil_moisture < 0.40 else 20 if soil_moisture < 0.50 else 0
    # Heat
    heat_score = 50 if any(
        daily["temperature_2m_max"][i] >= 95
        for i, d in enumerate(daily.get("time", []))
        if d >= today
    ) else 25 if any(
        daily["temperature_2m_max"][i] >= 90
        for i, d in enumerate(daily.get("time", []))
        if d >= today
    ) else 0
    # NWS
    alert_score = 60 if nws_alerts > 0 else 0

    composite = round(
        frost_score * 0.30 +
        swd_score * 0.20 +
        fungal_score * 0.18 +
        drought_score * 0.15 +
        heat_score * 0.10 +
        alert_score * 0.07
    )
    return min(100, composite)


# ── API fetchers ──────────────────────────────────────────────────────────────

def fetch_weather() -> dict | None:
    """Fetch current + hourly + daily weather from Open-Meteo."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": LAT, "longitude": LON,
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "current": ",".join([
            "temperature_2m", "relative_humidity_2m", "precipitation",
            "wind_speed_10m", "wind_gusts_10m", "uv_index",
            "shortwave_radiation", "soil_temperature_18cm", "soil_moisture_0_to_7cm",
        ]),
        "hourly": ",".join([
            "temperature_2m", "relative_humidity_2m", "precipitation",
            "wind_speed_10m", "wind_gusts_10m", "shortwave_radiation",
        ]),
        "daily": ",".join([
            "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
            "et0_fao_evapotranspiration",
        ]),
        "timezone": "America/Chicago",
        "forecast_days": 7,
        "past_days": 90,
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error(f"Open-Meteo fetch failed: {e}")
        return None


def compute_gdd_since_mar1(daily: dict) -> float:
    """Sum GDD (base 50°F) from March 1 of current year to today."""
    year = datetime.date.today().year
    mar1 = f"{year}-03-01"
    today = datetime.date.today().isoformat()
    gdd = 0.0
    for i, d in enumerate(daily.get("time", [])):
        if d < mar1 or d > today:
            continue
        tmax = daily["temperature_2m_max"][i]
        tmin = daily["temperature_2m_min"][i]
        avg = (tmax + tmin) / 2
        gdd += max(0, avg - GDD_BASE)
    return round(gdd, 1)


def compute_chill_hours(hourly: dict) -> int:
    """Count hours below 45°F since Sep 1 of previous/current season."""
    today = datetime.date.today()
    year = today.year if today.month >= 9 else today.year - 1
    sep1 = f"{year}-09-01"
    today_str = today.isoformat()
    count = 0
    for i, t in enumerate(hourly.get("time", [])):
        if t[:10] < sep1 or t[:10] > today_str:
            continue
        if hourly["temperature_2m"][i] < CHILL_THRESHOLD_F:
            count += 1
    return count


def fetch_nws_alerts() -> list[dict]:
    """Fetch active NWS alerts for Jersey County, IL (zone ILZ057)."""
    url = "https://api.weather.gov/alerts/active/zone/ILZ057"
    headers = {"User-Agent": "RaysBerryFarmBridge/1.0 (farm automation)"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        r.raise_for_status()
        features = r.json().get("features", [])
        return [
            {
                "event": f["properties"].get("event", ""),
                "severity": f["properties"].get("severity", ""),
                "headline": f["properties"].get("headline", ""),
            }
            for f in features
        ]
    except Exception as e:
        log.warning(f"NWS fetch failed: {e}")
        return []


# ── HA sensor push ────────────────────────────────────────────────────────────

def push_sensor(entity_id: str, state: str | int | float, attributes: dict) -> bool:
    """Push a virtual sensor state to HA via REST API."""
    if not HA_TOKEN:
        log.warning("HA_TOKEN not set — skipping push")
        return False
    url = f"{HA_URL}/api/states/{entity_id}"
    headers = {
        "Authorization": f"Bearer {HA_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {"state": str(state), "attributes": attributes}
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=10)
        r.raise_for_status()
        return True
    except Exception as e:
        log.error(f"HA push failed for {entity_id}: {e}")
        return False


# ── Main loop ─────────────────────────────────────────────────────────────────

def run_once():
    log.info("Fetching farm data...")
    weather = fetch_weather()
    if not weather:
        log.error("No weather data — skipping this cycle")
        return

    daily  = weather.get("daily", {})
    hourly = weather.get("hourly", {})
    current = weather.get("current", {})

    alerts = fetch_nws_alerts()
    gdd = compute_gdd_since_mar1(daily)
    chill_hours = compute_chill_hours(hourly)
    stage = get_growth_stage(gdd)

    temp_f     = current.get("temperature_2m", 0)
    humidity   = current.get("relative_humidity_2m", 0)
    wind_speed = current.get("wind_speed_10m", 0)
    wind_gusts = current.get("wind_gusts_10m", 0)
    solar_rad  = current.get("shortwave_radiation", 0)
    precip     = current.get("precipitation", 0)
    soil_moisture = current.get("soil_moisture_0_to_7cm", 0.3)
    soil_temp  = current.get("soil_temperature_18cm", 0)

    vpd = compute_vpd(temp_f, humidity)
    vpd_status = get_vpd_status(vpd)
    fungal_risk = get_fungal_risk(humidity, precip, temp_f)
    swd_level = get_swd_level(gdd)
    spray_window = get_spray_window(wind_speed, wind_gusts, solar_rad, precip)
    frost_risk = frost_risk_level(daily, gdd)
    yield_threat = composite_yield_threat(daily, hourly, soil_moisture, gdd, len(alerts))
    days_to_harvest = project_gdd_days(gdd, GDD_HARVEST_READY) if gdd < GDD_HARVEST_READY else 0
    chill_pct = round(min(100, (chill_hours / CHILL_HOURS_NEEDED) * 100), 1)

    now_iso = datetime.datetime.now().isoformat()

    sensors = [
        ("sensor.farm_gdd",           round(gdd, 1),    {"unit_of_measurement": "GDD",   "friendly_name": "Farm GDD Accumulated",    "icon": "mdi:thermometer-lines", "device_class": "None", "last_updated": now_iso}),
        ("sensor.farm_chill_hours",    chill_hours,      {"unit_of_measurement": "hrs",   "friendly_name": "Chill Hours Accumulated",  "icon": "mdi:snowflake",         "last_updated": now_iso}),
        ("sensor.farm_chill_pct",      chill_pct,        {"unit_of_measurement": "%",     "friendly_name": "Chill Hours %",            "icon": "mdi:snowflake-check",   "last_updated": now_iso}),
        ("sensor.farm_growth_stage",   stage,            {"friendly_name": "Growth Stage",                                              "icon": "mdi:sprout",            "last_updated": now_iso}),
        ("sensor.farm_fungal_risk",    fungal_risk,      {"unit_of_measurement": "/100",  "friendly_name": "Fungal Disease Risk",      "icon": "mdi:mushroom",          "last_updated": now_iso}),
        ("sensor.farm_swd_risk",       swd_level,        {"friendly_name": "SWD Pressure",                                             "icon": "mdi:bug",               "last_updated": now_iso}),
        ("sensor.farm_spray_window",   spray_window,     {"friendly_name": "Spray Window",                                             "icon": "mdi:spray",             "last_updated": now_iso}),
        ("sensor.farm_frost_risk",     frost_risk,       {"friendly_name": "Frost Risk (7-day)",                                       "icon": "mdi:snowflake-alert",   "last_updated": now_iso}),
        ("sensor.farm_vpd",            vpd,              {"unit_of_measurement": "kPa",   "friendly_name": "Vapor Pressure Deficit",   "icon": "mdi:water-percent",     "last_updated": now_iso}),
        ("sensor.farm_vpd_status",     vpd_status,       {"friendly_name": "VPD Status",                                               "icon": "mdi:water-check",       "last_updated": now_iso}),
        ("sensor.farm_yield_threat",   yield_threat,     {"unit_of_measurement": "/100",  "friendly_name": "Composite Yield Threat",   "icon": "mdi:alert-circle",      "last_updated": now_iso}),
        ("sensor.farm_nws_alerts",     len(alerts),      {"unit_of_measurement": "alerts","friendly_name": "Active NWS Alerts",        "icon": "mdi:weather-lightning", "last_updated": now_iso,
                                                           "alerts": alerts[:5]}),
        ("sensor.farm_days_to_harvest",days_to_harvest,  {"unit_of_measurement": "days",  "friendly_name": "Days to Harvest (projected)","icon": "mdi:calendar-clock",  "last_updated": now_iso}),
        ("sensor.farm_soil_moisture",  round(soil_moisture * 100, 1), {"unit_of_measurement": "%", "friendly_name": "Soil Moisture (0-7cm)", "icon": "mdi:water",        "last_updated": now_iso}),
        ("sensor.farm_soil_temp",      round(soil_temp, 1),{"unit_of_measurement": "°F",  "friendly_name": "Soil Temperature (18cm)",  "icon": "mdi:thermometer",       "last_updated": now_iso}),
    ]

    ok = 0
    for entity_id, state, attrs in sensors:
        if push_sensor(entity_id, state, attrs):
            ok += 1

    log.info(
        f"Pushed {ok}/{len(sensors)} sensors — "
        f"GDD={gdd} stage={stage} fungal={fungal_risk} "
        f"SWD={swd_level} spray={spray_window} frost={frost_risk} "
        f"yield_threat={yield_threat} NWS={len(alerts)}"
    )


def main():
    log.info(f"Farm Bridge starting — polling every {INTERVAL}s")
    log.info(f"HA target: {HA_URL}")
    while True:
        try:
            run_once()
        except Exception as e:
            log.error(f"Unexpected error: {e}")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()

# Ray's Berry Farm — Full System Setup Guide

Complete walkthrough for setting up the Smart Speaker AI assistant, Home Assistant integration, and the physical blackberry irrigation system.

---

## Table of Contents

1. [Hardware Overview](#1-hardware-overview)
2. [Physical Irrigation Setup](#2-physical-irrigation-setup)
3. [Software Prerequisites](#3-software-prerequisites)
4. [Docker & Home Assistant Setup](#4-docker--home-assistant-setup)
5. [Smart Speaker Setup](#5-smart-speaker-setup)
6. [HA Packages & Lovelace](#6-ha-packages--lovelace)
7. [Farm Bridge (Weather Intelligence)](#7-farm-bridge-weather-intelligence)
8. [RainPoint BLE Soil Sensor](#8-rainpoint-ble-soil-sensor)
9. [GIEX WiFi Valve Integration](#9-giex-wifi-valve-integration)
10. [Verifying the Full Stack](#10-verifying-the-full-stack)
11. [Voice Command Reference](#11-voice-command-reference)

---

## 1. Hardware Overview

### Computing
| Component | Spec |
|---|---|
| Host machine | Windows PC with NVIDIA GTX 1070 8GB |
| Docker engine | Docker Desktop for Windows |
| Ollama | Runs natively on host for direct GPU access |

### Farm Devices
| Device | Purpose | HA Entity |
|---|---|---|
| GIEX WiFi Sprinkler Timer (2-zone) | Master valve — controls water flow to both Rainwave timers | `switch.tuya_master_valve_1`, `switch.tuya_master_valve_2` |
| Rainwave RW-74ZWT-2 (×2) | 4-zone battery timers — sequence individual rows | Hardware only (no HA entity) |
| RainPoint BLE Soil Sensor | Bluetooth soil moisture & temperature | `sensor.rainpoint_soil_moisture`, `sensor.rainpoint_soil_temperature` |
| ESP32 (any WROOM-32) | Bluetooth proxy — bridges RainPoint BLE → WiFi → HA | ESPHome integration |
| Barn Light | Field lighting | `light.barn_light` |
| Field Light | Field lighting | `light.field_light` |
| Barn Camera | Surveillance | `camera.barn_cam` |

---

## 2. Physical Irrigation Setup

### System Overview

8-zone blackberry irrigation using a 2-tier architecture:

```
Outdoor Spigot
      │
      ▼
Water Hammer Arrestor      ← prevents pressure spike damage on valve close
      │
      ▼
GIEX WiFi 2-Zone Timer     ← HA-controlled "gatekeeper" — decides IF water flows
      │              │
   Outlet 1       Outlet 2
      │              │
   Garden Hose    Garden Hose
      │              │
      ▼              ▼
Rainwave A (4-zone)   Rainwave B (4-zone)   ← battery timers — decide WHEN/HOW LONG
   │  │  │  │            │  │  │  │
Row1 2 3 4             Row5 6 7 8
```

### Components & Connections

**GIEX WiFi Dual-Zone Timer (Tuya/Smart Life)**
- Connects directly to outdoor spigot (3/4" standard thread)
- Brass inlet — hand-tighten only, no tools needed
- Two outlets: Outlet 1 → Rows 1-4, Outlet 2 → Rows 5-8
- Connects to WiFi 2.4GHz via Smart Life app, then Tuya HA integration
- HA entities: `switch.tuya_master_valve_1`, `switch.tuya_master_valve_2`

**Water Hammer Arrestor**
- Install between spigot and GIEX valve
- Prevents pressure shock when solenoids close — protects fittings and valve internals

**Rainwave RW-74ZWT-2 (4-Zone Hose Timer)**
- Set Timer A to **6:00 AM** — 4 zones × 15 minutes = 60 minutes total
- Set Timer B to **7:00 AM** — 4 zones × 15 minutes = 60 minutes total
- These are independent battery timers — they run on their own schedule
- HA does NOT directly control them; HA controls the GIEX master valve (water flow on/off)
- Without the GIEX open, no water reaches the Rainwaves regardless of their timer

### Watering Schedule Logic

```
5:50 AM  HA gatekeeper opens — checks weather + soil moisture
6:00 AM  Rainwave A starts cycling Rows 1-4 (15min/zone × 4 = 1hr)
7:00 AM  Rainwave B starts cycling Rows 5-8 (15min/zone × 4 = 1hr)
8:15 AM  GIEX master valve closes (2h25m from open)
2:00 PM  HA safety shutoff — confirms all irrigation is off
```

### Skip Conditions (handled by `sky_irrigation_daily_gatekeeper`)

The automation skips irrigation if ANY of these are true:
- Current weather is `rainy` or `pouring`
- Rain probability forecast > 40%
- RainPoint soil moisture ≥ wet threshold (default 75%)

### Installation Steps

1. Attach water hammer arrestor to spigot
2. Attach GIEX timer to arrestor outlet
3. Run garden hose from GIEX Outlet 1 to Rainwave A inlet
4. Run garden hose from GIEX Outlet 2 to Rainwave B inlet
5. Connect Rainwave A zone outputs to drip lines for Rows 1-4
6. Connect Rainwave B zone outputs to drip lines for Rows 5-8
7. Set Rainwave A internal timer to 6:00 AM, 15min/zone
8. Set Rainwave B internal timer to 7:00 AM, 15min/zone
9. Add GIEX to Smart Life app (QR code on device), then add Tuya integration in HA

---

## 3. Software Prerequisites

| Software | Version | Notes |
|---|---|---|
| Docker Desktop | Latest | Windows or Mac |
| Ollama | Latest | Install natively (not in Docker) for GPU access |
| Git | Any | For cloning the repo |
| PowerShell | 5.1+ | For patch scripts (Windows) |
| NVIDIA Drivers | Latest | Required for GPU acceleration |
| NVIDIA Container Toolkit | Latest | Required for Docker GPU passthrough |

### Pull the recommended LLM model

```powershell
ollama pull qwen3.5:latest
```

> **Note:** Ollama must be running as a background service before starting Docker. It listens on `localhost:11434` and is accessible from Docker containers via `host.docker.internal:11434`.

---

## 4. Docker & Home Assistant Setup

### Clone the repository

```powershell
git clone https://github.com/BlueprintNinja/smart-speaker.git
cd smart-speaker
copy .env.example .env
```

### Configure `.env`

Open `.env` and set:

```env
HA_TOKEN=your_long_lived_token_here
OLLAMA_MODEL=qwen3.5:latest
KOKORO_VOICE=af_sky
TZ=America/Chicago
WHISPER_DTYPE=int8
```

> **WHISPER_DTYPE:** Use `int8` for GTX 1070 / cards without float16 support. Use `float16` for RTX cards.

### Start Home Assistant first

```powershell
docker compose up homeassistant -d
```

Open http://localhost:8123 and complete the HA onboarding wizard.

### Get your HA long-lived token

1. Click your profile picture (bottom-left in HA)
2. Scroll to **Security → Long-Lived Access Tokens**
3. Click **Create Token**, name it `smart-speaker`
4. Copy the token and paste into `.env` as `HA_TOKEN=...`

---

## 5. Smart Speaker Setup

### Start all services

```powershell
docker compose up -d
docker compose logs -f backend
```

Wait for `[startup] All models ready.` in the logs (~2-3 minutes on first run, Kokoro and Whisper download automatically).

Open **https://localhost** (HTTPS required for microphone access from non-localhost devices).

> **Self-signed cert warning** is expected — click "Advanced → Proceed" in Chrome. The cert is auto-generated at nginx build time.

### UI Tabs

| Tab | Icon | Description |
|---|---|---|
| Chat | 💬 | Voice/text commands to Sky |
| Farm Dashboard | 📊 | Live farm sensor cards |
| Memory | 🧠 | Sky's persistent farm log |
| Decisions | 📋 | Recommendation journal + morning digest |
| Schedule | 📅 | Farm automation schedule (daily + weekly views) |
| Devices | ⚙ | Farm device grid with live HA sync and manual toggles |

### Device Grid (⚙ SHOW DEVICES)

Click **⚙ SHOW DEVICES** in the chat input area to open the slide-out device panel. This shows all pinned farm devices as cards with:
- Live state (on/off/unavailable)
- HA sync status badge (✓ SYNCED / ? NOT FOUND / ⚠ UNAVAIL)
- ON/OFF toggle buttons for lights, switches, valves
- Green glow when entity is active
- Pulse animation when Sky sends a command to that device

Default devices:
- GIEX Valve 1 (Rows 1-4) — `switch.tuya_master_valve_1`
- GIEX Valve 2 (Rows 5-8) — `switch.tuya_master_valve_2`
- Barn Light — `light.barn_light`
- Field Light — `light.field_light`
- Field 1 & 2 Moisture — `sensor.tensiometer_field1/2`
- Barn Camera — `camera.barn_cam`
- RainPoint BLE — `sensor.rainpoint_soil_moisture`

---

## 6. HA Packages & Lovelace

The `ha-packages/` directory contains all HA YAML configuration. Run the patch script to copy them into the live HA config:

```powershell
.\scripts\patch-ha-config.ps1
docker compose restart homeassistant
```

> Run this after every `git pull` that modifies `ha-packages/`.

### Package Files

| File | Contents |
|---|---|
| `smart_speaker_helpers.yaml` | `input_boolean.*` + `timer.sky_*` helpers, generic timer auto-off automation, REST command for Sky alerts |
| `master_valve_irrigation.yaml` | Blackberry row status sensor, daily gatekeeper automation, weather-skip notify, manual watering script |
| `rainpoint.yaml` | Soil moisture template sensors, dry/wet threshold sliders, dry/wet/offline alert automations |
| `farm_scenes.yaml` | Pre-built scenes: Morning Routine, Evening Mode, All Irrigation On/Off, Frost Protection, Deep Water, Quick Rinse, Emergency Shutoff |
| `farm_scripts.yaml` | Irrigation sequence script (all zones sequentially), single-zone irrigate script |
| `farm_automations_advanced.yaml` | Auto-irrigate on low moisture, frost protection, dawn/dusk lights, fungal risk alert, midday shutoff |
| `farm_bridge_automations.yaml` | Posts to Sky `/alert` when farm sensor thresholds cross |
| `farm_dashboard.yaml` | Lovelace dashboard definition |

### Lovelace Dashboard Views

The Farm dashboard at http://localhost:8123 has these tabs:
- **Ray's Berry Farm** — weather, soil, growth stage, risk assessment, irrigation controls
- **Scenes & Automations** — all farm scenes and automation toggles
- **Schedule** — daily timetable, automation status, active timers, quick actions
- **Sky Assistant** — about Sky, farm bridge sensor values

---

## 7. Farm Bridge (Weather Intelligence)

The Farm Bridge polls Open-Meteo (weather) and NWS (weather alerts) every 10 minutes and pushes 15 live sensor entities to HA:

| Entity | Description |
|---|---|
| `sensor.farm_gdd` | Growing Degree Days accumulated |
| `sensor.farm_growth_stage` | Current blackberry growth stage |
| `sensor.farm_days_to_harvest` | Estimated days to harvest |
| `sensor.farm_chill_hours` | Chill hours accumulated |
| `sensor.farm_fungal_risk` | Fungal pressure score (0-100) |
| `sensor.farm_frost_risk` | 7-day frost probability |
| `sensor.farm_swd_risk` | Spotted Wing Drosophila pressure |
| `sensor.farm_spray_window` | Current spray window status |
| `sensor.farm_vpd` | Vapor Pressure Deficit |
| `sensor.farm_vpd_status` | VPD interpretation (Optimal/High/Low) |
| `sensor.farm_soil_moisture` | Open-Meteo soil moisture (0-7cm) |
| `sensor.farm_soil_temp` | Open-Meteo soil temperature (18cm) |
| `sensor.farm_yield_threat` | Composite yield threat score |
| `sensor.farm_nws_alerts` | Count of active NWS weather alerts |

These power the Farm Dashboard in both HA Lovelace and the Smart Speaker UI.

---

## 8. RainPoint BLE Soil Sensor

The RainPoint Bluetooth soil sensor (IP54, CR2032 battery) bridges into HA via an ESP32 Bluetooth proxy.

### What it provides
- `sensor.rainpoint_soil_moisture` — % volumetric water content
- `sensor.rainpoint_soil_temperature` — °C soil temperature
- `sensor.soil_moisture_status` — DRY / OK / WET (threshold-based)
- `sensor.soil_vpd_estimate` — calculated soil VPD (kPa)

### Physical Setup

1. Push the sensor probe into the ground near the root zone (aim for 4-6" depth)
2. Place the ESP32 within 30ft of the sensor (60ft+ with clear line of sight)
3. Power the ESP32 via USB (any USB wall adapter)

### ESP32 Flash

```powershell
pip install esphome

# Edit WiFi credentials in the config
notepad ha-packages\esphome-ble-proxy.yaml

# Generate encryption key
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
# Paste key into ha-packages\esphome_secrets.yaml

# Flash (ESP32 must be connected via USB)
esphome run ha-packages\esphome-ble-proxy.yaml
```

### HA Pairing

1. **Settings → Integrations → ESPHome** — should auto-discover the ESP32 by IP
2. Once ESPHome is connected: **Settings → Integrations → Bluetooth** — pair the RainPoint device
3. Entities `sensor.rainpoint_soil_moisture` and `sensor.rainpoint_soil_temperature` appear automatically

### Thresholds (adjustable in HA)

| Threshold | Default | Use |
|---|---|---|
| `input_number.rainpoint_dry_threshold` | 25% | Below this → irrigation alert |
| `input_number.rainpoint_wet_threshold` | 75% | Above this → skip daily irrigation |

---

## 9. GIEX WiFi Valve Integration

### Pairing via Smart Life / Tuya

1. Download **Smart Life** app (iOS or Android)
2. Power up the GIEX timer (it blinks rapidly when in pairing mode)
3. In the app: **+** → Add Device → follow on-screen pairing (2.4GHz WiFi only)
4. Name the outlets: `Master Valve 1` and `Master Valve 2`

### Home Assistant Tuya Integration

1. In HA: **Settings → Devices & Services → Add Integration → Tuya**
2. Log in with your Smart Life / Tuya account credentials
3. The GIEX timer appears as two switch entities:
   - `switch.tuya_master_valve_1`
   - `switch.tuya_master_valve_2`

> If entity IDs differ, update them in `ha-packages/master_valve_irrigation.yaml` to match.

### Testing

From the Smart Speaker UI Device Grid, click **ON** on GIEX Valve 1 — you should hear a click from the solenoid and water should flow to Rainwave A.

Or via Sky: *"Turn on GIEX valve 1 for 5 minutes"*

---

## 10. Verifying the Full Stack

Run through this checklist after initial setup:

### Backend Health
```powershell
Invoke-RestMethod http://localhost:8000/health
```
Should return `{ "status": "ok", "kokoro": true, ... }`

### HA Connection
```powershell
Invoke-RestMethod http://localhost:8000/ha/entities
```
Should return a list of your HA entities.

### LLM (Ollama)
```powershell
Invoke-RestMethod http://localhost:8000/model/status
```
Should return `{ "status": "loaded" }` once a request has been made.

### Farm Bridge
```powershell
Invoke-RestMethod http://localhost:8000/ha/state/sensor.farm_gdd
```
Should return a numeric GDD value.

### Schedule Endpoint
```powershell
Invoke-RestMethod http://localhost:8000/schedule
```
Should return 7 schedule entries.

### Voice Test
1. Open https://localhost
2. Hold the microphone orb
3. Say: *"What's the soil moisture today?"*
4. Sky should respond verbally with the RainPoint reading

### Irrigation Test (manual)
1. Open the Device Grid (⚙ SHOW DEVICES)
2. Click **ON** on GIEX Valve 1
3. Verify water flows to Rows 1-4
4. Click **OFF** immediately after confirming

---

## 11. Voice Command Reference

### Irrigation
| Command | Action |
|---|---|
| *"Open the master valve"* | Turns on both GIEX outlets |
| *"Turn on GIEX valve 1"* | Opens Outlet 1 (Rows 1-4) |
| *"Water the blackberries for 30 minutes"* | Opens both valves + sets 30min auto-off timer |
| *"Is irrigation running?"* | Reports current valve state |
| *"Skip irrigation today"* | Disables the daily gatekeeper automation |

### Lights
| Command | Action |
|---|---|
| *"Turn on the barn lights"* | `light.barn_light` on |
| *"Turn off all lights"* | All lights off |
| *"Set barn light to 50%"* | Dims to 50% |

### Scenes
| Command | Action |
|---|---|
| *"Activate morning routine"* | All irrigation on, barn + field lights on |
| *"Activate evening mode"* | Irrigation off, field light off, barn on |
| *"Activate frost protection"* | All irrigation on, barn light on |
| *"Activate deep water"* | Both GIEX valves + all zones on |
| *"Activate emergency shutoff"* | Everything off immediately |

### Farm Intelligence
| Command | Action |
|---|---|
| *"What's the fungal risk today?"* | Reports `sensor.farm_fungal_risk` |
| *"Is it a good day to spray?"* | Reports spray window status + VPD |
| *"What has soil moisture been this week?"* | Fetches 7-day HA history |
| *"When should I harvest?"* | Reports GDD + days to harvest |
| *"What's the frost risk?"* | Reports 7-day frost probability |

### Memory & Logs
| Command | Action |
|---|---|
| *"Log that I sprayed Captan today"* | Adds to spray log in persistent memory |
| *"When did I last spray?"* | Checks memory for last spray record |
| *"Add note: south field needs attention"* | Saves to observations |

---

## Update Procedure

After each `git pull`:

```powershell
git pull
.\scripts\patch-ha-config.ps1        # if ha-packages/ changed
docker compose restart homeassistant  # if HA packages changed
docker compose up -d --build backend frontend
```

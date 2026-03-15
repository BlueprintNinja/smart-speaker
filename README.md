# Sky — AI Farm Assistant

Voice-driven farm automation assistant for Ray's Berry Farm, powered by:
- **Whisper** (faster-whisper) — speech-to-text, GPU accelerated with CPU fallback
- **Ollama** — local LLM with structured command extraction (supports thinking models)
- **Kokoro TTS** (`af_sky` voice) — text-to-speech, auto-downloads on first run
- **Home Assistant** — controls lights, switches, valves, irrigation, sensors, scenes, timers, and automations
- **Device Grid** — live farm device cards with HA sync status and manual ON/OFF toggles
- **Farm Bridge** — real-time farm intelligence from Open-Meteo + NWS weather data
- **Scheduler** — visual daily/weekly farm automation schedule with live HA state

> For full physical and software setup instructions see **[SETUP.md](./SETUP.md)**

---

## Prerequisites

1. **Docker Desktop** installed and running
2. **Ollama** installed natively on your PC (so it can access your GPU directly)
   - Download: https://ollama.com
   - Recommended model: `ollama pull qwen3.5:latest` (best for structured command output)
   - Alternatives: `qwen2.5:7b`, `llama3`
3. **Node.js 18+** for the frontend dev server (optional, for local dev only)
4. **NVIDIA GPU** with drivers + NVIDIA Container Toolkit for GPU passthrough in Docker

---

## Setup

### 1. Clone and configure

```powershell
git clone https://github.com/BlueprintNinja/smart-speaker.git
cd smart-speaker
copy .env.example .env
```

Edit `.env` and fill in:
- `HA_TOKEN` — your Home Assistant long-lived token (see step 3)
- `OLLAMA_MODEL` — whichever model you have pulled in Ollama (e.g. `qwen3.5:latest`)
- `KOKORO_VOICE` — voice to use (default: `af_sky`, see options below)
- `TZ` — your timezone

> **No TTS model files needed.** Kokoro and Whisper models download automatically on first startup and are cached in a Docker volume (`model-cache`) so they persist across rebuilds.

### 2. Start Home Assistant

```bash
docker compose up homeassistant -d
```

Open http://localhost:8123, complete onboarding, then add your devices via:
**Settings → Devices & Services → Add Integration**

Get your long-lived token:
**Profile (bottom-left) → Security → Long-Lived Access Tokens → Create Token**

Paste it into `.env` as `HA_TOKEN=...`

### 3. Patch HA config (one-time, then after each pull)

```powershell
.\scripts\patch-ha-config.ps1
docker compose restart homeassistant
```

This copies HA packages (helpers, automations, Lovelace dashboard) into the HA config directory. Required for canvas sync, timers, and farm automations to work.

### 4. Start everything

```bash
docker compose up -d
docker compose logs -f backend   # wait for "All models ready"
```

Open **http://localhost** in your browser. That's it.

---

## Local Development (no Docker for frontend)

```bash
# Start backend + HA in Docker
docker compose up homeassistant backend -d

# Run frontend natively
npm install
VITE_API=http://localhost:8000 npm run dev
```

Open http://localhost:5173

---

## Usage

### Chat Tab (💬)
- **Hold the orb** to speak, release to send
- **Type** in the text box and press Enter
- **Deep Think toggle** — enables extended LLM reasoning for complex commands (required for structured HA commands on thinking models like qwen3.5)
- **Wake word** — enable "Hey Sky" always-on listening
- Say things like:
  - *"Turn on the barn lights"*
  - *"Irrigate zone 1 for 30 minutes"* (auto-creates HA timer + auto-off)
  - *"Set the thermostat to 70 degrees"*
  - *"What's the fungal risk today?"*
  - *"What has soil moisture been doing this week?"* (fetches HA history)
  - *"What happened today?"* (fetches HA logbook)
  - *"When did I last spray Captan?"* (Sky checks her memory)

The assistant speaks the response and shows a confirmation badge when a device command executes.

### Dashboard Tab (⊞)
Live farm insights panel driven by `sensor.farm_*` entities in Home Assistant:
- Color-coded alert cards: critical / warning / info / positive
- NWS weather alerts, frost risk, fungal pressure, SWD, spray window status
- GDD, chill hours, days-to-harvest, VPD, soil moisture
- Canvas device status cards

### Memory Tab (🧠)
Sky's persistent farm log — survives container restarts:
- **Log notes, observations, or spray records** via the input box
- Sky automatically sees all memory in every chat conversation
- Sections: Spray Log · Observations · Notes · Events & Alerts
- **Raw JSON editor** for bulk memory management
- **LLM Preview** shows exactly what Sky sees from memory
- Proactive alerts from HA automations appear here automatically

### Decision Journal (📋)
Tracks Sky's farm recommendations and their outcomes:
- Sky auto-logs recommendations from chat (spray, irrigate, frost protection, etc.)
- Log outcomes against each recommendation to build a feedback loop
- **Morning Digest** — auto-generated briefing on page load, replayable via TTS
- Manual digest trigger button

### Device Grid (⚙ SHOW DEVICES)

Click **⚙ SHOW DEVICES** in the chat input area to open the slide-out device panel:

- **Live state** — each card polls HA every 5 seconds (on/off/unavailable/numeric)
- **HA sync badge** — ✓ SYNCED / ? NOT FOUND / ⚠ UNAVAIL on every card
- **ON/OFF toggles** — available on lights, switches, valves, fans, covers, scenes, automations
- **Active glow** — cards glow green when entity state is "on"
- **Pulse animation** — card pulses when Sky sends a command to that device
- **Add/Remove** — click `+` card to add any HA entity; hover card to remove
- **Syncs to HA** — device list calls `/canvas/sync` on change to register entities
- Persists across refreshes via `localStorage`

### Schedule Tab (📅)

Farm automation schedule with two views:

- **Daily** — timeline sorted by time, color-coded by category (irrigation/lighting/alert)
  - Each event shows duration, conditions, last triggered time
  - **ON/OFF toggle** to enable/disable each HA automation live
- **Weekly** — 7-column grid with today highlighted
- **Sun bar** — live sunrise/sunset times from HA
- **Active timers** — pill badges when any HA timer is running
- **Category filter** — All / 🌊 Irrigation / 💡 Lighting / ⚠ Alert
- Polls `/schedule` every 15 seconds

### Collapsible Sidebar
- Click ◀/▶ to collapse/expand. Tab icons remain accessible when collapsed.

---

## Home Assistant Integration

### Device Grid → HA Entity Lifecycle

When devices are pinned to the Device Grid:
1. **`sensor.canvas_{slug}`** is created as a read-only status sensor
2. **`input_boolean.{slug}`** is created as a real HA helper (for actionable entities — lights, switches)
3. **`timer.sky_{slug}`** is created on demand when Sky issues a timed command
4. All entities appear in the **Lovelace dashboard** automatically (dynamic update via HA REST API)
5. Sync fires automatically whenever the device list changes

### HA-Native Timers

When Sky receives a timed command like "irrigate zone 1 for 30 minutes":
1. The `input_boolean.irrigation_zone_1` is turned **on**
2. A `timer.sky_irrigation_zone_1` is created and **started** in HA
3. When the timer expires, an HA automation turns the input_boolean **off** and notifies the backend
4. Timers are visible in the Lovelace dashboard and persist across HA restarts

### Supported HA Domains

Sky can control any entity in Home Assistant:
- **Lights** — turn on/off, brightness, color temperature, RGB
- **Switches & Plugs** — turn on/off, toggle
- **Covers / Gates / Blinds** — open, close, stop, set position
- **Locks** — lock, unlock
- **Climate / Thermostat** — set temperature, HVAC mode
- **Fans** — on/off, speed percentage
- **Scenes** — activate
- **Scripts** — run
- **Automations** — trigger, enable, disable
- **Notifications** — send via notify service
- **Input Booleans** — canvas-managed virtual devices

### LLM Tools

Sky has access to several backend tools triggered by special tags in the LLM response:

- **`[FETCH_TREND: entity_id, hours]`** — fetches historical sensor data from HA recorder, then answers naturally
- **`[FETCH_LOGBOOK: hours]`** or **`[FETCH_LOGBOOK: entity_id, hours]`** — fetches HA logbook entries
- **`[TIMER: entity_id, minutes, domain]`** — schedules an HA-native timer with auto-off
- **JSON command blocks** — structured HA service calls embedded in the response

### Farm Scenes

Pre-built scenes activatable by voice or from the Device Grid:

| Scene | Action |
|---|---|
| `farm_morning_routine` | Irrigation zone 1 on, barn + field lights on |
| `farm_evening_mode` | Irrigation off, field light off, barn on |
| `farm_all_irrigation_on/off` | All zones on or off |
| `farm_frost_protection` | All irrigation + barn light on |
| `farm_deep_water` | Both GIEX valves + all zones on |
| `farm_quick_rinse` | Both GIEX valves on (dust/heat rinse) |
| `farm_emergency_shutoff` | Everything off immediately |

### HA Packages

All HA configuration is in `ha-packages/` — see [SETUP.md](./SETUP.md) for full details.

Key files:
- **`smart_speaker_helpers.yaml`** — input_boolean + timer helpers, timer auto-off automation, REST command
- **`master_valve_irrigation.yaml`** — GIEX dual-zone valve, daily gatekeeper, weather-skip, manual watering script
- **`farm_scenes.yaml`** — all farm scenes including Deep Water, Quick Rinse, Emergency Shutoff
- **`farm_automations_advanced.yaml`** — auto-irrigate, frost protection, dawn/dusk lights, fungal risk
- **`farm_bridge_automations.yaml`** — HA automations that POST to `/alert` when farm sensor thresholds are crossed
- **`rainpoint.yaml`** — RainPoint BLE soil sensor template sensors, thresholds, and automations

---

## Troubleshooting

### Sky Not Speaking (Kokoro/TTS)

If you see `CustomAlbert requires the PyTorch library` in backend logs:

```powershell
docker compose down backend
docker rmi smart-speaker-backend:latest --force
docker compose build --no-cache backend
docker compose up -d backend
```

Once you see `[startup] Kokoro ready.` — Sky's voice is working.

### Models Re-downloading on Every Rebuild

Whisper and Kokoro models are cached in the `model-cache` Docker volume. If they re-download, check that the volume exists:

```powershell
docker volume ls | findstr model-cache
```

The `HF_HOME` environment variable in `docker-compose.yml` points to `/app/.cache/huggingface` which is mounted from this volume.

### Device Cards Showing "? NOT FOUND"

1. Ensure packages are installed: `.\scripts\patch-ha-config.ps1`
2. Restart HA: `docker compose restart homeassistant`
3. Check backend logs for sync errors: `docker compose logs backend --tail 20`
4. Verify the entity exists in HA: Developer Tools → States → search the entity_id

### Deep Think Required for Commands

Thinking models (qwen3.5, deepseek-r1, qwq) need **Deep Think ON** to emit structured JSON commands. In fast mode, these models respond conversationally but may skip the JSON/TIMER tags needed to trigger HA actions.

---

## RainPoint BLE Soil Moisture Sensor

The **RainPoint Bluetooth Soil Moisture & Temperature Meter** bridges into Home Assistant via an ESP32 Bluetooth Proxy.

### What's Already Set Up

- **`ha-packages/rainpoint.yaml`** — template sensors, dry/wet threshold sliders, automations
- **`ha-packages/esphome-ble-proxy.yaml`** — flash this to a $5 ESP32 to bridge BLE → WiFi

### Setup

1. Run `.\scripts\patch-ha-config.ps1` then restart HA
2. Get any ESP32-WROOM-32 dev board (~$5-10)
3. Flash the ESP32:

```powershell
pip install esphome
notepad ha-packages\esphome-ble-proxy.yaml   # edit WiFi credentials
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
# Paste key into ha-packages\esphome_secrets.yaml
esphome run ha-packages\esphome-ble-proxy.yaml
```

4. Plug ESP32 within 30ft of the RainPoint sensor
5. In HA: **Settings → Integrations → ESPHome** → auto-discovered → then **Bluetooth** → pair RainPoint

### Sensor Notes

- **Update rate:** every 2 seconds when in range
- **IP54 rated:** splash-proof, not submersible
- **Battery:** CR2032, 6–12 months
- **Range:** 30ft direct, 60ft+ with ESP32 relay

---

## Farm Intelligence (Sky's Proactive Alerts)

- **Every 10 minutes:** Farm data (Open-Meteo + NWS) fetched and injected into LLM context
- **Critical alerts:** Frost risk, SWD pressure, NWS alerts trigger immediate spoken briefings
- **Morning digest:** Auto-generated farm briefing on page load with TTS replay
- **Dashboard:** Live color-coded farm insights cards
- **HA automations:** `farm_bridge_automations.yaml` POSTs to `/alert` on threshold crossings → Sky speaks + logs to Memory
- **Alert polling:** Frontend checks for new alerts every 30 seconds

### Testing an Alert Manually

```powershell
Invoke-RestMethod -Uri http://localhost:8000/alert -Method POST `
  -ContentType "application/json" `
  -Body '{"sensor":"sensor.farm_fungal_risk","state":"85","message":"Fungal risk critical.","severity":"critical"}'
```

---

## Architecture

```
Browser
    │  http://localhost (port 80)
    ▼
nginx (frontend container)
    │  proxies /api/* → backend:8000
    ▼
FastAPI Backend (Docker, GPU, port 8000)
    ├── /transcribe         → faster-whisper STT (GPU + CPU fallback)
    ├── /chat               → Ollama LLM → command extraction → HA service call
    ├── /tts_audio          → Kokoro TTS (af_sky) → WAV at 24kHz
    ├── /alert              → Proactive alert webhook (HA → TTS → Memory)
    ├── /memory             → GET/POST/DELETE persistent farm memory
    ├── /memory/decisions   → Decision journal + outcome tracking
    ├── /memory/outcome     → Log outcomes against recommendations
    ├── /canvas/sync        → Push device list → HA entities + Lovelace update
    ├── /schedule           → Farm automation schedule with live HA state
    ├── /schedule/toggle    → Enable/disable automation from UI
    ├── /ha/entities        → Cached HA entity list (60s refresh)
    ├── /ha/service         → Direct HA service call (manual device toggles)
    ├── /ha/trend/{id}      → Historical sensor stats (min/max/mean/delta)
    ├── /alerts/timers      → Active timer list
    ├── /alerts/pending     → Pending alert queue
    ├── /farm/prime         → Open-Meteo + NWS farm data injection
    ├── /digest             → Morning briefing (cached daily)
    └── /persona            → GET/PUT assistant persona settings
    │
    ├──→ Ollama (native on host, GPU)         host.docker.internal:11434
    ├──→ Home Assistant (Docker, speaker-net)  homeassistant:8123
    │        ├── input_boolean.*  — canvas-managed virtual devices
    │        ├── timer.sky_*      — HA-native auto-off timers
    │        ├── sensor.canvas_*  — canvas status sensors
    │        └── automations POST /alert on farm sensor threshold crossings
    └──→ Farm Bridge (Docker, speaker-net)     pushes 15 sensor.farm_* every 10 min
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen3.5:latest` | Model to use (must be pulled in Ollama first) |
| `WHISPER_MODEL` | `medium` | Whisper model size (`tiny`, `base`, `small`, `medium`, `large`) |
| `WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` |
| `WHISPER_DTYPE` | `int8` | `int8` (recommended) or `float16` |
| `KOKORO_VOICE` | `af_sky` | Kokoro voice ID — auto-downloaded on first run |
| `GPU_CONCURRENCY` | `1` | Max simultaneous GPU tasks (Whisper + TTS share this lock) |
| `HA_URL` | `http://homeassistant:8123` | Home Assistant URL |
| `HA_TOKEN` | *(required)* | HA long-lived access token |
| `HF_HOME` | `/app/.cache/huggingface` | HuggingFace model cache (Docker volume) |
| `TZ` | `America/New_York` | Timezone |

---

## Kokoro Voices

Set `KOKORO_VOICE` in `.env`:

| Voice | Gender | Style |
|---|---|---|
| `af_sky` | Female | Warm, smooth (default) |
| `af_sarah` | Female | Clear, neutral |
| `af_bella` | Female | Expressive |
| `am_adam` | Male | Neutral |
| `am_michael` | Male | Deep, clear |

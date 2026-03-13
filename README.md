# Smart Speaker — Home & Farm Voice Assistant

Voice-driven home/farm automation assistant powered by:
- **Whisper** (faster-whisper) — speech-to-text, GPU accelerated with CPU fallback
- **Ollama** — local LLM with device intent extraction
- **Kokoro TTS** (`af_sky` voice) — text-to-speech, auto-downloads on first run
- **Home Assistant** — controls lights, switches, locks, irrigation, sensors, and more
- **Node Canvas** — visual interface to test voice commands against device nodes before physical integration

---

## Prerequisites

1. **Docker Desktop** installed and running
2. **Ollama** installed natively on your PC (so it can access your GPU directly)
   - Download: https://ollama.com
   - Pull your model: `ollama pull llama3` (or any model you prefer)
3. **Node.js 18+** for the frontend dev server
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
- `OLLAMA_MODEL` — whichever model you have pulled in Ollama
- `KOKORO_VOICE` — voice to use (default: `af_sky`, see options below)
- `TZ` — your timezone

> **No TTS model files needed.** Kokoro downloads its weights automatically on first startup (~330 MB from HuggingFace).

### 2. Start Home Assistant

```bash
docker compose up homeassistant -d
```

Open http://localhost:8123, complete onboarding, then add your devices via:
**Settings → Devices & Services → Add Integration**

Get your long-lived token:
**Profile (bottom-left) → Security → Long-Lived Access Tokens → Create Token**

Paste it into `.env` as `HA_TOKEN=...`

### 3. Start everything

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

### Chat Tab
- **Hold the orb** to speak, release to send
- **Type** in the text box and press Enter
- Say things like:
  - *"Turn on the barn lights"*
  - *"Turn off the porch switch"*
  - *"Set the thermostat to 70 degrees"*
  - *"Lock the back door"*
  - *"Open the gate"*
  - *"Start the irrigation zone 2"*

The assistant speaks the response and shows a confirmation badge when a device command executes.

### Node Canvas Tab (⬡ Nodes)
Build a visual map of your devices before they're physically wired up:

1. Drag node types from the left palette onto the canvas: **Light, Camera, Tensiometer, Irrigation**
2. Fill in each node's `entity_id` and friendly name
3. Connect nodes by dragging from output port → input port
4. Use the **Command Tester** panel to run a voice command or pick a node + action
5. Results show the exact HA API call that would be made — live if `HA_TOKEN` is set, dry-run otherwise

---

## Troubleshooting: Sky Not Speaking (Kokoro/TTS)

If you see `CustomAlbert requires the PyTorch library` in backend logs, the Docker image has a cached numpy 2.x layer that breaks PyTorch. The fix is a **forced clean rebuild** — this re-downloads PyTorch (~2.4 GB) but only needs to happen once:

```powershell
cd C:\Users\mrray\smart-speaker
docker compose down backend
docker rmi smart-speaker-backend:latest --force
docker compose build --no-cache backend
docker compose up -d backend
```

Watch progress:
```powershell
docker compose logs -f backend
```

Once you see `[startup] Kokoro ready.` — Sky's voice is working.

---

## RainPoint BLE Soil Moisture Sensor

The **RainPoint Bluetooth Soil Moisture & Temperature Meter** bridges into Home Assistant via an ESP32 Bluetooth Proxy. This solves the Docker-on-Windows Bluetooth limitation (Docker containers can't access the host's Bluetooth adapter).

### What's Already Set Up

All HA config files are in `ha-packages/` and auto-mounted into the HA container:

- **`ha-packages/rainpoint.yaml`** — template sensors, dry/wet threshold sliders, automations (dry alert, wet alert, offline alert)
- **`ha-packages/esphome-ble-proxy.yaml`** — flash this to a $5 ESP32 to bridge BLE → WiFi

### Step 1 — Activate Packages in HA (one-time)

Run this in PowerShell to add the packages include to your HA config:

```powershell
$haConfig = "C:\Users\mrray\smart-speaker\ha-config\configuration.yaml"
$existing = Get-Content $haConfig -Raw
if ($existing -notmatch "packages") {
  Add-Content $haConfig "`nhomeassistant:`n  packages: !include_dir_named packages"
  Write-Host "Added packages include"
} else { Write-Host "Already configured" }
```

Then restart HA: **http://localhost:8123 → Settings → System → Restart**

After restart you'll see these new entities in HA:
- `input_number.rainpoint_dry_threshold` (default 25%)
- `input_number.rainpoint_wet_threshold` (default 75%)
- `sensor.soil_moisture_status` (DRY / OK / WET)
- Three automations armed and waiting for the sensor

### Step 2 — Get an ESP32 (~$5–10)

Any ESP32-WROOM-32 dev board works. Search "ESP32 development board" on Amazon. Plug it in via USB to your PC for the initial flash, then move it to a USB outlet near the garden.

### Step 3 — Flash the ESP32

```powershell
# Install ESPHome
pip install esphome

# Edit WiFi credentials first
notepad ha-packages\esphome-ble-proxy.yaml
# Change: ssid: "YOUR_WIFI_SSID" and password: "YOUR_WIFI_PASSWORD"

# Generate a random API key (run this, copy the output)
python -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"
# Paste it into ha-packages\esphome_secrets.yaml as esphome_api_key

# Flash (ESP32 connected via USB)
esphome run ha-packages\esphome-ble-proxy.yaml
```

First flash takes ~2 min. After that it updates OTA over WiFi — no USB needed.

### Step 4 — Pair in Home Assistant

1. Unplug ESP32 from PC, plug into USB power outlet **within 30ft of the RainPoint sensor**
2. In HA: **Settings → Integrations → ESPHome** — the proxy appears automatically
3. Then: **Settings → Integrations → Bluetooth** — RainPoint BLE device appears
4. Click **Configure** to pair

### Step 5 — Update Entity IDs

Once paired, HA assigns real entity IDs (e.g. `sensor.rainpoint_soil_moisture`). If they differ from the defaults, update them in `ha-packages/rainpoint.yaml`:

```yaml
# Find your real entity IDs at:
# http://localhost:8123 → Developer Tools → States → search "rainpoint"
```

### Sensor Notes

- **Update rate:** every 2 seconds when ESP32 is in range
- **IP54 rated:** splash-proof, not submersible — keep the head elevated so water doesn't pool around the button
- **Battery:** CR2032, typically 6–12 months
- **Range:** 30ft direct, 60ft+ with ESP32 proxy relaying over WiFi
- **HA Dashboard card:** see comment block at bottom of `ha-packages/rainpoint.yaml`

---

## Farm Intelligence (Sky's Proactive Alerts)

Sky monitors Ray's Berry Farm automatically and speaks up when something needs attention:

- **Every 10 minutes:** Farm data (Open-Meteo + NWS) is fetched and injected into the LLM's memory so Sky always knows the current GDD, growth stage, and active risks
- **Critical alerts:** If frost risk, SWD pressure, or NWS alerts are detected, Sky generates and speaks a briefing immediately on page load
- **Every 60 minutes:** Sky gives an unprompted spoken farm update
- **Dashboard tab:** Live farm insights panel shows color-coded cards (critical/warning/positive/info)

---

## Entity IDs

To find the correct `entity_id` for your devices:
- Go to http://localhost:8123 → **Developer Tools → States**
- Or query the backend: `GET http://localhost:8000/ha/entities?domain=light`

---

## Kokoro Voices

Set `KOKORO_VOICE` in `.env` to any of the following:

| Voice | Gender | Style |
|---|---|---|
| `af_sky` | Female | Warm, smooth (default) |
| `af_sarah` | Female | Clear, neutral |
| `af_bella` | Female | Expressive |
| `am_adam` | Male | Neutral |
| `am_michael` | Male | Deep, clear |

---

## Architecture

```
Browser
    │  http://localhost (port 80)
    ▼
nginx (frontend container)
    │  proxies /api/* → backend:8000
    ▼
FastAPI Backend (Docker, port 8000)
    ├── /transcribe    → faster-whisper STT (GPU + CPU fallback)
    ├── /chat          → Ollama LLM → intent extraction → HA API call → SSE stream
    ├── /tts_audio     → Kokoro TTS (af_sky) → WAV at 24kHz
    ├── /ha/*          → Home Assistant REST API passthrough
    └── /test_command  → Node canvas dry-run / live command tester
    │
    ├──→ Ollama (native on host, GPU access)  host.docker.internal:11434
    └──→ Home Assistant (Docker, host network) host.docker.internal:8123
             └── controls all smart home/farm devices
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://host.docker.internal:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Model to use (must be pulled in Ollama first) |
| `WHISPER_MODEL` | `medium` | Whisper model size (`tiny`, `base`, `small`, `medium`, `large`) |
| `WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` |
| `WHISPER_DTYPE` | `float16` | `float16` (GPU) or `int8` (CPU) |
| `KOKORO_VOICE` | `af_sky` | Kokoro voice ID — auto-downloaded on first run |
| `GPU_CONCURRENCY` | `1` | Max simultaneous GPU tasks (Whisper + TTS share this lock) |
| `HA_URL` | `http://homeassistant:8123` | Home Assistant URL (container name on bridge network) |
| `HA_TOKEN` | *(required for device control)* | HA long-lived access token |
| `TZ` | `America/New_York` | Timezone |

---

## Node Canvas

The playground lets you map out devices visually before or after physical integration.

**Available node types:**
- 💡 **Light** — HA light entities, brightness/color control
- 📷 **Camera** — snapshot, motion detection
- 💧 **Tensiometer** — soil moisture sensor with kPa threshold
- 🌊 **Irrigation** — valve switches with duration
- 🌱 **RainPoint BLE** — Bluetooth soil moisture/temp with ESP32 proxy integration notes

Nodes and connections **persist across page refreshes** via localStorage.

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
| `HA_URL` | `http://host.docker.internal:8123` | Home Assistant URL |
| `HA_TOKEN` | *(required for device control)* | HA long-lived access token |
| `TZ` | `America/New_York` | Timezone |

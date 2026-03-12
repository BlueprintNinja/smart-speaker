# Smart Speaker — Home & Farm Voice Assistant

Voice-driven home/farm automation assistant powered by:
- **Whisper** (faster-whisper) — speech-to-text
- **Ollama** — local LLM with device intent extraction
- **Piper TTS** — text-to-speech
- **Home Assistant** — controls lights, switches, locks, irrigation, sensors, and more

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

```bash
git clone https://github.com/BlueprintNinja/smart-speaker.git
cd smart-speaker
cp .env.example .env
```

Edit `.env` and fill in:
- `HA_TOKEN` — your Home Assistant long-lived token (see step 3)
- `OLLAMA_MODEL` — whichever model you have pulled in Ollama
- `TZ` — your timezone

### 2. Place your Piper TTS model

Download a Piper voice model (`.onnx` + `.onnx.json`) from:
https://huggingface.co/rhasspy/piper-voices

Place both files in `backend/models/` and update `PIPER_MODEL` in `.env`:
```
PIPER_MODEL=models/en_US-joe-medium.onnx
```

### 3. Start Home Assistant

```bash
docker compose up homeassistant -d
```

Open http://localhost:8123, complete onboarding, then add your devices via:
**Settings → Devices & Services → Add Integration**

Get your long-lived token:
**Profile (bottom-left) → Security → Long-Lived Access Tokens → Create Token**

Paste it into `.env` as `HA_TOKEN=...`

### 4. Start everything

```bash
docker compose up -d
docker compose logs -f backend   # wait for "All models ready"
```

Open **http://localhost** in your browser. That's it.

---

## Local Development (no Docker for frontend)

If you want hot-reload during frontend development:

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

- **Hold the orb** to speak, release to send
- **Type** in the text box and press Enter
- Say things like:
  - *"Turn on the barn lights"*
  - *"Turn off the porch switch"*
  - *"Set the thermostat to 70 degrees"*
  - *"Lock the back door"*
  - *"Open the gate"*

The assistant will speak the response and show a confirmation badge when a device command was executed.

---

## Entity IDs

To find the correct `entity_id` for your devices:
- Go to http://localhost:8123 → **Developer Tools → States**
- Or ask the backend: `GET http://localhost:8000/ha/entities?domain=light`

If the LLM guesses the wrong entity ID, it will say so — just tell it the correct name and it will update.

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
    ├── /transcribe  → faster-whisper STT
    ├── /chat        → Ollama LLM → intent extraction → HA API call → SSE stream
    ├── /tts_audio   → Piper TTS → WAV
    └── /ha/*        → Home Assistant REST API passthrough
    │
    ├──→ Ollama (native on host, GPU access)  host.docker.internal:11434
    └──→ Home Assistant (Docker, host network) host.docker.internal:8123
             └── controls all smart home/farm devices
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3` | Model to use (must be pulled in Ollama first) |
| `WHISPER_MODEL` | `medium` | Whisper model size |
| `WHISPER_DEVICE` | `cuda` | `cuda` or `cpu` |
| `WHISPER_DTYPE` | `float16` | `float16` or `int8` |
| `PIPER_MODEL` | `models/en_US-joe-medium.onnx` | Path to Piper voice model |
| `HA_URL` | `http://localhost:8123` | Home Assistant URL |
| `HA_TOKEN` | *(required)* | HA long-lived access token |
| `TZ` | `America/New_York` | Timezone |

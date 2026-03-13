"""
Smart Speaker - GPU Backend
Runs locally on your GPU PC. Handles:
 - STT: faster-whisper (GPU accelerated)
 - LLM: Ollama with intent extraction for home/farm control
 - TTS: Kokoro TTS
 - Home Control: Home Assistant REST API
"""
import os
import io
import re
import json
import time
import wave
import base64
import tempfile
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import requests
import httpx
import soundfile as sf
import uvicorn
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from kokoro import KPipeline

# ── Config ────────────────────────────────────────────────────────────────────
OLLAMA_HOST    = os.getenv("OLLAMA_HOST",    "http://localhost:11434")
OLLAMA_MODEL   = os.getenv("OLLAMA_MODEL",   "llama3")
WHISPER_MODEL  = os.getenv("WHISPER_MODEL",  "medium")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_DTYPE  = os.getenv("WHISPER_DTYPE",  "float16")
KOKORO_VOICE    = os.getenv("KOKORO_VOICE",    "af_sky")
GPU_CONCURRENCY = int(os.getenv("GPU_CONCURRENCY", "1"))

HA_URL   = os.getenv("HA_URL",   "http://localhost:8123")
HA_TOKEN = os.getenv("HA_TOKEN", "")

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a helpful, concise home and farm voice assistant with deep Home Assistant integration.

When the user asks you to control a device or trigger an action, ALWAYS include a JSON command block
in your response using exactly this format:

```json
{"action": "<domain>.<service>", "entity_id": "<entity_id>", "extra": {}}
```

== LIGHTS ==
  light.turn_on, light.turn_off, light.toggle
  extra: {"brightness_pct": 80}  |  {"rgb_color": [255, 100, 0]}  |  {"color_temp": 300}

== SWITCHES & PLUGS ==
  switch.turn_on, switch.turn_off, switch.toggle

== IRRIGATION & FARM ==
  switch.turn_on / switch.turn_off  — for irrigation zone switches (e.g. switch.irrigation_zone_1)
  input_boolean.turn_on / turn_off  — for virtual irrigation toggles
  automation.trigger  — to trigger scheduled irrigation automations
  For timed irrigation: extra: {"variables": {"duration": 10}}  (minutes)
  Soil moisture sensors are read-only (sensor domain) — report their state, do not command them.

== COVERS / GATES / BLINDS ==
  cover.open_cover, cover.close_cover, cover.stop_cover, cover.toggle
  cover.set_cover_position  extra: {"position": 50}  (0=closed, 100=open)

== LOCKS ==
  lock.lock, lock.unlock

== CLIMATE / THERMOSTAT ==
  climate.set_temperature  extra: {"temperature": 72}
  climate.set_hvac_mode    extra: {"hvac_mode": "heat"}  or "cool", "auto", "off"
  climate.turn_on, climate.turn_off

== SCENES ==
  scene.turn_on  (entity_id is the scene entity, e.g. scene.evening_farm)

== SCRIPTS ==
  script.turn_on

== AUTOMATIONS ==
  automation.trigger, automation.turn_on, automation.turn_off

== FANS ==
  fan.turn_on, fan.turn_off, fan.toggle
  fan.set_percentage  extra: {"percentage": 75}

== ALARMS ==
  alarm_control_panel.alarm_arm_away, alarm_control_panel.alarm_disarm
  extra: {"code": "1234"}  if required

== NOTIFICATIONS ==
  notify.notify  extra: {"message": "...", "title": "..."}

== GROUPS / ALL DEVICES ==
  homeassistant.turn_on, homeassistant.turn_off  (works on groups and scenes)

If you do NOT know the exact entity_id, make your best guess based on the name the user mentioned
(e.g. "barn lights" → light.barn_lights) and mention it in your reply so the user can correct it.

For read-only questions ("what is the soil moisture?", "is the gate open?", "what's the temperature?")
do NOT include a JSON block — just answer naturally based on context.

If the user is chatting or asking a general question, do NOT include any JSON block."""


# ── GPU concurrency lock ──────────────────────────────────────────────────────
GPU_LOCK = asyncio.Semaphore(GPU_CONCURRENCY)


# ── Lifespan (replaces deprecated @app.on_event) ──────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    print("[startup] Warming up Whisper...")
    await loop.run_in_executor(None, get_whisper)
    print("[startup] Warming up Kokoro...")
    await loop.run_in_executor(None, get_kokoro)
    print("[startup] All models ready.")
    yield


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="Smart Speaker API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Lazy loaders ──────────────────────────────────────────────────────────────
_whisper  = None
_pipeline = None


def get_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    from faster_whisper import WhisperModel
    try:
        print(f"[whisper] Loading on {WHISPER_DEVICE}...")
        _whisper = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_DTYPE)
    except Exception:
        print("[whisper] GPU load failed, falling back to CPU...")
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _whisper


def get_kokoro():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    print("[kokoro] Initializing pipeline...")
    try:
        _pipeline = KPipeline(lang_code='a', device='cuda')
    except Exception as e:
        print(f"[kokoro] GPU init failed ({e}), falling back to CPU...")
        _pipeline = KPipeline(lang_code='a', device='cpu')
    return _pipeline


# ── Ollama helpers ────────────────────────────────────────────────────────────
def _ollama_chat_stream(messages: list[dict], options: dict):
    url = f"{OLLAMA_HOST.rstrip('/')}/api/chat"
    payload = {"model": OLLAMA_MODEL, "messages": messages, "stream": True, "options": options}
    with requests.post(url, json=payload, stream=True, timeout=120) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if line:
                chunk = json.loads(line.decode("utf-8"))
                content = (chunk.get("message") or {}).get("content", "")
                if content:
                    yield content


# ── Conversation history ───────────────────────────────────────────────────────
conversation: list[dict] = []


# ── Home Assistant helpers ─────────────────────────────────────────────────────
def _ha_headers() -> dict:
    return {
        "Authorization": f"Bearer {HA_TOKEN}",
        "Content-Type": "application/json",
    }


async def ha_call_service(domain: str, service: str, entity_id: str, extra: dict = None) -> dict:
    """Call a Home Assistant service. Returns HA response or an error dict."""
    if not HA_TOKEN:
        return {"error": "HA_TOKEN not configured"}

    payload = {"entity_id": entity_id}
    if extra:
        payload.update(extra)

    url = f"{HA_URL}/api/services/{domain}/{service}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, headers=_ha_headers(), json=payload)
            r.raise_for_status()
            return {"ok": True, "status": r.status_code}
    except httpx.HTTPStatusError as e:
        return {"error": f"HA returned {e.response.status_code}: {e.response.text}"}
    except Exception as e:
        return {"error": str(e)}


async def ha_get_state(entity_id: str) -> dict:
    """Fetch the current state of a HA entity."""
    if not HA_TOKEN:
        return {"error": "HA_TOKEN not configured"}

    url = f"{HA_URL}/api/states/{entity_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers=_ha_headers())
            r.raise_for_status()
            return r.json()
    except httpx.HTTPStatusError as e:
        return {"error": f"HA returned {e.response.status_code}"}
    except Exception as e:
        return {"error": str(e)}


async def ha_list_entities(domain: str = None) -> list[dict]:
    """List all HA states, optionally filtered by domain."""
    if not HA_TOKEN:
        return []

    url = f"{HA_URL}/api/states"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=_ha_headers())
            r.raise_for_status()
            states = r.json()
            if domain:
                states = [s for s in states if s["entity_id"].startswith(f"{domain}.")]
            return states
    except Exception:
        return []


def extract_ha_command(llm_response: str) -> dict | None:
    """
    Parse the JSON command block the LLM embeds in its reply.
    Returns the parsed dict or None if no command was found.
    """
    match = re.search(r"```json\s*(\{.*?\})\s*```", llm_response, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


def strip_command_block(text: str) -> str:
    """Remove the embedded JSON block from the spoken reply."""
    return re.sub(r"```json\s*\{.*?\}\s*```", "", text, flags=re.DOTALL).strip()


# ── WAV synthesis helper ───────────────────────────────────────────────────────
def synth_wav_bytes(text: str) -> tuple[bytes, int]:
    """Synthesize WAV bytes with Kokoro. Returns (wav_bytes, sample_rate)."""
    pipe = get_kokoro()
    all_audio = []
    for _, _, audio in pipe(text, voice=KOKORO_VOICE, speed=1.0, split_pattern=r'\n+'):
        all_audio.append(audio)
    if not all_audio:
        return b"", 24000
    full_audio = np.concatenate(all_audio)
    buf = io.BytesIO()
    sf.write(buf, full_audio, 24000, format='WAV')
    return buf.getvalue(), 24000


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    kokoro_ok = _pipeline is not None
    try:
        r = requests.get(f"{OLLAMA_HOST.rstrip('/')}/api/tags", timeout=3)
        ollama_ok = r.status_code == 200
    except Exception:
        ollama_ok = False

    ha_ok = False
    if HA_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{HA_URL}/api/", headers=_ha_headers())
                ha_ok = r.status_code == 200
        except Exception:
            pass

    gpu_info = {}
    try:
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            gpu_info = {
                "name": props.name,
                "vram_total": f"{props.total_memory / 1e9:.1f} GB",
                "vram_free": f"{(props.total_memory - torch.cuda.memory_allocated(0)) / 1e9:.1f} GB",
            }
    except Exception:
        pass

    return {
        "status": "ok",
        "ollama_model": OLLAMA_MODEL,
        "ollama_ok": ollama_ok,
        "whisper_model": WHISPER_MODEL,
        "whisper_device": WHISPER_DEVICE,
        "kokoro_voice": KOKORO_VOICE,
        "kokoro_ok": kokoro_ok,
        "ha_url": HA_URL,
        "ha_ok": ha_ok,
        "gpu": gpu_info,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read()
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        loop = asyncio.get_event_loop()

        def _transcribe():
            segments, _ = get_whisper().transcribe(tmp_path, beam_size=5, language="en")
            return "".join(s.text for s in segments).strip()

        async with GPU_LOCK:
            text = await loop.run_in_executor(None, _transcribe)
        return {"text": text}
    finally:
        os.unlink(tmp_path)


@app.post("/chat")
async def chat(body: dict):
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return JSONResponse({"reply": "I didn't catch that."})

    conversation.append({"role": "user", "content": user_msg})
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + conversation

    async def generate():
        full = ""
        ha_result = None
        loop = asyncio.get_event_loop()

        try:
            def _stream():
                return list(_ollama_chat_stream(messages, {"temperature": 0.6}))

            tokens = await loop.run_in_executor(None, _stream)
            if not tokens:
                yield f"data: {json.dumps({'token': '[No response from LLM — check Ollama is running and model is pulled]'})}\n\n"
                full = ""
            else:
                for token in tokens:
                    full += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            err_msg = f"[LLM error: {e}]"
            yield f"data: {json.dumps({'token': err_msg})}\n\n"
            full = err_msg

        # ── Execute any embedded HA command ───────────────────────────────────
        cmd = extract_ha_command(full)
        if cmd:
            try:
                domain, service = cmd["action"].split(".", 1)
                ha_result = await ha_call_service(
                    domain, service,
                    cmd.get("entity_id", ""),
                    cmd.get("extra") or {},
                )
            except Exception as e:
                ha_result = {"error": str(e)}

            yield f"data: {json.dumps({'event': 'ha_result', 'result': ha_result})}\n\n"

        spoken = strip_command_block(full)
        conversation.append({"role": "assistant", "content": spoken})
        yield f"data: {json.dumps({'done': True, 'full': spoken})}\n\n"

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive"}
    return StreamingResponse(generate(), media_type="text/event-stream", headers=headers)


@app.post("/tts_audio")
async def tts_audio(body: dict):
    text = body.get("text", "").strip()
    if not text:
        return JSONResponse({"error": "no text"}, status_code=400)

    loop = asyncio.get_event_loop()

    try:
        async with GPU_LOCK:
            wav_bytes, sr = await loop.run_in_executor(None, lambda: synth_wav_bytes(text))
    except Exception as e:
        return JSONResponse({"error": f"TTS failed: {e}"}, status_code=500)

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={"Cache-Control": "no-store", "X-Sample-Rate": str(sr)},
    )


# ── Home Assistant passthrough routes ─────────────────────────────────────────
@app.get("/ha/entities")
async def ha_entities(domain: str = None):
    """List HA entities so the frontend can display what's available."""
    entities = await ha_list_entities(domain)
    return {"entities": [
        {"entity_id": e["entity_id"], "state": e["state"],
         "name": e.get("attributes", {}).get("friendly_name", e["entity_id"])}
        for e in entities
    ]}


@app.get("/ha/state/{entity_id:path}")
async def ha_state(entity_id: str):
    """Get the current state of a single HA entity."""
    return await ha_get_state(entity_id)


@app.post("/ha/service")
async def ha_service(body: dict):
    """Directly call a HA service from the frontend (for manual UI controls)."""
    domain, service = body.get("action", ".").split(".", 1)
    return await ha_call_service(
        domain, service,
        body.get("entity_id", ""),
        body.get("extra") or {},
    )


# ── Node canvas command tester ─────────────────────────────────────────────────
@app.post("/test_command")
async def test_command(body: dict):
    """
    Test a voice command against a node graph without physical hardware.
    Accepts:
      command  : str  — the voice/text command to test
      node     : dict — { type, config, action } of the targeted node (optional)
      nodes    : list — all nodes on the canvas
      edges    : list — connections between nodes
    Returns a structured result showing what API call would be made and whether
    it succeeds against HA (if HA_TOKEN is configured) or a dry-run simulation.
    """
    command = body.get("command", "").strip()
    target_node = body.get("node")
    nodes = body.get("nodes", [])

    if not command and not target_node:
        return JSONResponse({"error": "Provide a command or select a node."}, status_code=400)

    NODE_DOMAIN_MAP = {
        "light":       "light",
        "camera":      "camera",
        "tensiometer": "sensor",
        "irrigation":  "switch",
    }

    # ── Build a context string describing the canvas for the LLM ──────────────
    node_descriptions = []
    for n in nodes:
        ntype = n.get("type", "unknown")
        cfg   = n.get("config", {})
        node_descriptions.append(
            f"- {ntype} | entity_id: {cfg.get('entity_id','?')} | name: {cfg.get('friendly_name','?')}"
        )

    canvas_context = "\n".join(node_descriptions) if node_descriptions else "No nodes defined."

    # If a specific node+action was chosen directly, skip LLM and resolve immediately
    if target_node and target_node.get("action"):
        ntype   = target_node.get("type", "")
        cfg     = target_node.get("config", {})
        action  = target_node.get("action", "")
        domain  = NODE_DOMAIN_MAP.get(ntype, ntype)
        entity  = cfg.get("entity_id", "")

        resolved = {"action": f"{domain}.{action}", "entity_id": entity, "extra": {}}
    else:
        # ── Ask the LLM to resolve which node+action the command maps to ──────
        test_prompt = f"""You are a home automation command parser. Given a voice command and a list of available devices, output ONLY a JSON object with the action to take. No explanation.

Available devices:
{canvas_context}

Voice command: "{command}"

Output format (JSON only):
{{"action": "<domain>.<service>", "entity_id": "<entity_id>", "extra": {{}}}}

Valid domains/services: light.turn_on, light.turn_off, light.toggle, switch.turn_on, switch.turn_off, switch.toggle, camera.snapshot, sensor.read, cover.open_cover, cover.close_cover, lock.lock, lock.unlock, climate.set_temperature"""

        loop = asyncio.get_event_loop()

        def _ask():
            return "".join(_ollama_chat_stream(
                [{"role": "user", "content": test_prompt}],
                {"temperature": 0.1},
            ))

        try:
            raw = await loop.run_in_executor(None, _ask)
            match = re.search(r"\{.*\}", raw, re.DOTALL)
            resolved = json.loads(match.group(0)) if match else None
        except Exception as e:
            return {"status": "error", "stage": "llm_parse", "error": str(e), "command": command}

        if not resolved:
            return {"status": "error", "stage": "llm_parse", "error": "LLM did not return valid JSON.", "raw": raw, "command": command}

    # ── Attempt real HA call or return dry-run ─────────────────────────────────
    domain, service = resolved.get("action", ".").split(".", 1)
    entity_id       = resolved.get("entity_id", "")
    extra           = resolved.get("extra") or {}

    if HA_TOKEN and entity_id:
        ha_result = await ha_call_service(domain, service, entity_id, extra)
        mode = "live"
    else:
        ha_result = {"dry_run": True, "note": "No HA_TOKEN set or no entity_id — simulated only."}
        mode = "dry_run"

    return {
        "status":    "ok" if ha_result.get("ok") or ha_result.get("dry_run") else "error",
        "mode":      mode,
        "command":   command,
        "resolved":  resolved,
        "ha_result": ha_result,
    }


# ── Extended Home Assistant routes ────────────────────────────────────────────
@app.get("/ha/areas")
async def ha_areas():
    """Return all HA areas/rooms with their entities."""
    if not HA_TOKEN:
        return {"areas": []}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(f"{HA_URL}/api/states", headers=_ha_headers())
            r.raise_for_status()
            states = r.json()
        except Exception:
            return {"areas": []}

    areas: dict[str, list] = {}
    for s in states:
        area = s.get("attributes", {}).get("area_id") or "Uncategorized"
        areas.setdefault(area, []).append({
            "entity_id": s["entity_id"],
            "state":     s["state"],
            "name":      s.get("attributes", {}).get("friendly_name", s["entity_id"]),
            "domain":    s["entity_id"].split(".")[0],
            "attributes": s.get("attributes", {}),
        })
    return {"areas": areas}


@app.get("/ha/scenes")
async def ha_scenes():
    """List all HA scenes."""
    entities = await ha_list_entities("scene")
    return {"scenes": [
        {"entity_id": e["entity_id"],
         "name": e.get("attributes", {}).get("friendly_name", e["entity_id"])}
        for e in entities
    ]}


@app.post("/ha/scene/activate")
async def ha_scene_activate(body: dict):
    """Activate a HA scene."""
    return await ha_call_service("scene", "turn_on", body.get("entity_id", ""))


@app.get("/ha/automations")
async def ha_automations():
    """List all HA automations."""
    entities = await ha_list_entities("automation")
    return {"automations": [
        {"entity_id": e["entity_id"],
         "state":     e["state"],
         "name":      e.get("attributes", {}).get("friendly_name", e["entity_id"])}
        for e in entities
    ]}


@app.post("/ha/automation/trigger")
async def ha_automation_trigger(body: dict):
    """Trigger a HA automation."""
    return await ha_call_service("automation", "trigger", body.get("entity_id", ""))


@app.get("/ha/history/{entity_id:path}")
async def ha_history(entity_id: str, hours: int = 24):
    """Fetch state history for an entity over the last N hours."""
    if not HA_TOKEN:
        return {"history": []}
    from datetime import datetime, timezone, timedelta
    start = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    url = f"{HA_URL}/api/history/period/{start}?filter_entity_id={entity_id}&minimal_response=true"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=_ha_headers())
            r.raise_for_status()
            data = r.json()
            history = data[0] if data else []
            return {"entity_id": entity_id, "history": [
                {"state": h.get("state"), "last_changed": h.get("last_changed")}
                for h in history
            ]}
    except Exception as e:
        return {"error": str(e), "history": []}


@app.get("/ha/camera/{entity_id:path}")
async def ha_camera_snapshot(entity_id: str):
    """Proxy a camera snapshot image from HA."""
    if not HA_TOKEN:
        return JSONResponse({"error": "HA_TOKEN not configured"}, status_code=401)
    url = f"{HA_URL}/api/camera_proxy/{entity_id}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=_ha_headers())
            r.raise_for_status()
            return StreamingResponse(io.BytesIO(r.content), media_type=r.headers.get("content-type", "image/jpeg"))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@app.get("/ha/dashboard")
async def ha_dashboard():
    """Return a structured dashboard summary: lights, switches, sensors, covers, climate, cameras."""
    if not HA_TOKEN:
        return {"groups": {}}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{HA_URL}/api/states", headers=_ha_headers())
            r.raise_for_status()
            states = r.json()
    except Exception as e:
        return {"error": str(e), "groups": {}}

    DOMAINS = ["light", "switch", "cover", "lock", "climate", "sensor", "binary_sensor", "camera", "fan", "automation", "scene"]
    groups: dict[str, list] = {d: [] for d in DOMAINS}

    for s in states:
        domain = s["entity_id"].split(".")[0]
        if domain not in groups:
            continue
        groups[domain].append({
            "entity_id":  s["entity_id"],
            "state":      s["state"],
            "name":       s.get("attributes", {}).get("friendly_name", s["entity_id"]),
            "attributes": s.get("attributes", {}),
        })

    return {"groups": groups}


@app.get("/debug")
async def debug():
    """Connectivity debug — checks Ollama reachability and lists available models."""
    result = {"ollama_host": OLLAMA_HOST, "ollama_model": OLLAMA_MODEL}
    try:
        r = requests.get(f"{OLLAMA_HOST.rstrip('/')}/api/tags", timeout=5)
        result["ollama_reachable"] = True
        result["ollama_status"] = r.status_code
        data = r.json()
        result["models"] = [m["name"] for m in data.get("models", [])]
        result["model_available"] = any(OLLAMA_MODEL in m for m in result["models"])
    except Exception as e:
        result["ollama_reachable"] = False
        result["ollama_error"] = str(e)
    return result


@app.post("/farm/prime")
async def farm_prime(body: dict):
    """
    Called periodically by the frontend with fresh farm data.
    Injects farm state as a persistent system memory so all future /chat
    and /farm/ask calls have current context. Also generates a proactive
    spoken briefing if there are critical/warning insights.
    Body: { context: { ... }, criticals: int, force_brief: bool }
    """
    ctx = body.get("context") or {}
    criticals = body.get("criticals", 0)
    force_brief = body.get("force_brief", False)

    gdd      = ctx.get("gdd", 0)
    stage    = ctx.get("growthStage", "Unknown")
    chill    = ctx.get("chillHours", 0)
    insights = ctx.get("insights") or []
    weather  = ctx.get("weather") or {}
    current  = weather.get("current") or {}
    temp     = current.get("temp", "?")
    alerts   = ctx.get("alerts") or []

    # Build compact farm status string for injection into conversation memory
    critical_items = [i for i in insights if i.get("severity") == "critical"]
    warning_items  = [i for i in insights if i.get("severity") == "warning"]

    farm_status = (
        f"[FARM STATUS UPDATE — {ctx.get('timestamp', 'now')}] "
        f"Ray's Berry Farm: {stage}, {round(gdd)} GDD, {chill} chill hrs, {temp}°F. "
        f"Criticals: {len(critical_items)}, Warnings: {len(warning_items)}. "
        + (f"NWS Alerts: {', '.join(a.get('event','') for a in alerts)}. " if alerts else "")
        + " | ".join(f"{i.get('title','?')}: {i.get('summary','')[:80]}" for i in (critical_items + warning_items)[:4])
    )

    # Inject as a system memory message into the global conversation
    # Use a special role marker so it doesn't appear as user/assistant
    conversation.append({"role": "system", "content": farm_status})
    # Keep conversation from growing unbounded — trim old farm primes (keep last 2)
    farm_primes = [i for i, m in enumerate(conversation) if m["role"] == "system"]
    while len(farm_primes) > 2:
        conversation.pop(farm_primes.pop(0))

    # Generate a proactive briefing only if there are criticals or force_brief
    brief = None
    if criticals > 0 or force_brief:
        prompt_msgs = [
            {"role": "system", "content": f"""You are Sky, an expert AI farm advisor for Ray's Berry Farm.
Current farm status: {farm_status}
Generate a concise spoken farm briefing (2-3 sentences max). Lead with the most urgent issue.
Be direct, practical, and use natural spoken language — this will be read aloud by TTS.
Do not use bullet points or formatting. Start with 'Hey Ray,' if it's a critical alert."""},
            {"role": "user", "content": "Give me a farm status briefing."},
        ]
        loop = asyncio.get_event_loop()
        try:
            def _get_brief():
                return "".join(_ollama_chat_stream(prompt_msgs, {"temperature": 0.4, "max_tokens": 120}))
            brief = await loop.run_in_executor(None, _get_brief)
        except Exception as e:
            brief = f"Farm update: {stage}, {round(gdd)} GDD. {len(critical_items)} critical alerts."

    return {"status": "primed", "brief": brief, "criticals": criticals, "stage": stage, "gdd": round(gdd)}


@app.post("/farm/ask")
async def farm_ask(body: dict):
    """
    Accept a question + live farm context from the berry sim and stream an LLM answer.
    Body: { question: str, context: { weather, soil, insights, gdd, chillHours, alerts } }
    """
    question = (body.get("question") or "").strip()
    ctx = body.get("context") or {}
    if not question:
        return JSONResponse({"error": "no question"}, status_code=400)

    # Build a rich farm-aware system prompt
    weather = ctx.get("weather") or {}
    soil = ctx.get("soil") or {}
    insights = ctx.get("insights") or []
    gdd = ctx.get("gdd", 0)
    chill = ctx.get("chillHours", 0)
    alerts = ctx.get("alerts") or []
    stage = ctx.get("growthStage", "Unknown")

    current = weather.get("current") or {}
    daily = weather.get("daily") or {}

    farm_prompt = f"""You are Sky, an expert AI farm advisor for Ray's Jersey Berry Farm in Jersey County, Illinois.
The farm grows Triple Crown and Chester blackberries (0.2 acres in production).

CURRENT FARM STATUS ({ctx.get('timestamp', 'now')}):
- Growth Stage: {stage}
- Accumulated GDD (base 50°F since Mar 1): {gdd:.1f}
- Chill Hours accumulated (since Sep 1): {chill}
- Temperature: {current.get('temp', '?')}°F
- Humidity: {current.get('humidity', '?')}%
- Wind: {current.get('windSpeed', '?')} mph (gusts {current.get('windGusts', '?')} mph)
- Precipitation (current hr): {current.get('precipitation', 0)}" 
- UV Index: {current.get('uvIndex', '?')}
- VPD: {current.get('vpd', '?')} kPa
- Solar Radiation: {current.get('solarRad', '?')} W/m²
- Soil Moisture (0-7cm): {current.get('soilMoisture', '?')}
- Soil Temperature (18cm): {current.get('soilTemp', '?')}°F

SOIL PROFILE:
- Type: {soil.get('compName', '?')}
- Drainage: {soil.get('drainageClass', '?')}
- Sand: {soil.get('sandPercent', '?')}% / Clay: {soil.get('clayPercent', '?')}%
- Field Capacity (AWC): {soil.get('fieldCapacity', '?')} in/in

ACTIVE NWS ALERTS: {len(alerts)} alert(s)
{chr(10).join(f"- [{a.get('severity','?')}] {a.get('event','?')}: {a.get('headline','')}" for a in alerts) if alerts else "None"}

AI-GENERATED INSIGHTS ({len(insights)} total):
{chr(10).join(f"- [{i.get('severity','?').upper()}] {i.get('title','?')}: {i.get('summary','')}" for i in insights[:10]) if insights else "None"}

GDD CROP MILESTONES (Triple Crown blackberry):
- Bud Break: 100 GDD | Vegetative: 200 | Flowering: 350 | Green Fruit: 550 | Ripening: 750 | Harvest Ready: 900

Answer questions about the farm with specific, actionable advice. Reference actual values from the data above.
When asked about predictions, use the GDD accumulation and growth stage to give precise estimates.
Keep responses concise and practical for a working farmer. You may also control Home Assistant devices on the farm.
"""

    messages = [
        {"role": "system", "content": farm_prompt},
        {"role": "user", "content": question},
    ]

    async def generate():
        loop = asyncio.get_event_loop()
        try:
            def _stream():
                return list(_ollama_chat_stream(messages, {"temperature": 0.5}))
            tokens = await loop.run_in_executor(None, _stream)
            if not tokens:
                yield f"data: {json.dumps({'token': '[No response from LLM]'})}\n\n"
            else:
                for token in tokens:
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'token': f'[Error: {e}]'})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive"}
    return StreamingResponse(generate(), media_type="text/event-stream", headers=headers)


@app.delete("/conversation")
async def clear_conversation():
    conversation.clear()
    return {"status": "cleared"}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False, workers=1)
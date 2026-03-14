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
import uuid
import base64
import tempfile
import asyncio
import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from apscheduler.schedulers.asyncio import AsyncIOScheduler

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
WHISPER_DTYPE  = os.getenv("WHISPER_DTYPE",  "int8")
KOKORO_VOICE    = os.getenv("KOKORO_VOICE",    "af_sky")
GPU_CONCURRENCY = int(os.getenv("GPU_CONCURRENCY", "1"))

HA_URL   = os.getenv("HA_URL",   "http://localhost:8123")
HA_TOKEN = os.getenv("HA_TOKEN", "")

# ── Persona config (feature 8) ────────────────────────────────────────────────
PERSONA_NAME  = os.getenv("PERSONA_NAME",  "Sky")
PERSONA_STYLE = os.getenv("PERSONA_STYLE", "warm, direct, practical farm advisor")
PERSONA_NOTES = os.getenv("PERSONA_NOTES", "")  # extra instructions injected into system prompt

# ── APScheduler (feature 6) ───────────────────────────────────────────────────
scheduler = AsyncIOScheduler(timezone=datetime.timezone.utc)

# ── System prompt (rebuilt per-request to include live persona settings) ──────
def _build_system_prompt() -> str:
    persona_block = f"You are {PERSONA_NAME}, a {PERSONA_STYLE} with deep Home Assistant integration."
    if PERSONA_NOTES:
        persona_block += f"\n{PERSONA_NOTES}"
    return persona_block + """

When the user asks you to control a device or trigger an action, ALWAYS include a JSON command block
in your response using exactly this format:

```json
{"action": "<domain>.<service>", "entity_id": "<entity_id>", "extra": {}}
```

CRITICAL RULES:
- NEVER say "Here is the JSON command" or describe/narrate the JSON block. Just embed it silently.
- NEVER show the raw JSON to the user in your spoken reply.
- Your spoken reply should confirm the action naturally: "Turning on irrigation zone 1 for 10 minutes."
- The JSON block is parsed by the system — the user never needs to see it.
- ALWAYS respond in 1-3 short conversational sentences. You are a voice assistant — responses are spoken aloud.
- NEVER use bullet points, numbered lists, markdown headers, or asterisks. Plain prose only.
- If asked about multiple sensor values, pick the 1-2 most important ones and mention them naturally.
- Be direct. "Soil moisture is at 34%, trending down over the last 3 days." not a full status report.
- Address Ray by name when appropriate.
- When you make a farm recommendation (spray, irrigate, apply frost protection), state it clearly.

== LIGHTS ==
  light.turn_on, light.turn_off, light.toggle
  extra: {"brightness_pct": 80}  |  {"rgb_color": [255, 100, 0]}  |  {"color_temp": 300}

== SWITCHES & PLUGS ==
  switch.turn_on, switch.turn_off, switch.toggle

== IRRIGATION & FARM ==
  input_boolean.turn_on / input_boolean.turn_off  — for canvas-managed irrigation zones
    e.g. "irrigate zone 1" → entity_id: input_boolean.irrigation_zone_1
  switch.turn_on / switch.turn_off  — only if a real physical switch exists in HA
  automation.trigger  — to trigger scheduled irrigation automations
  For timed irrigation: use input_boolean.turn_on with NO extra fields — confirm duration verbally.
  e.g. "Turning on irrigation zone 1 for 30 minutes — I'll remind you when to turn it off."
  Soil moisture sensors are read-only (sensor domain) — report their state, do not command them.
  IMPORTANT: Canvas node entity IDs like switch.irrigation_zone_1 are registered as input_boolean.irrigation_zone_1 in HA.
  Always prefer input_boolean.* for canvas nodes unless the entity list shows a real switch.*.

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

If the user is chatting or asking a general question, do NOT include any JSON block.

== HISTORICAL TREND TOOL ==
When the user asks about trends, history, patterns, or changes over time for any sensor, use this tool:

[FETCH_TREND: <entity_id>, <hours>]

Examples:
- "what has the soil moisture been doing this week?" → [FETCH_TREND: sensor.farm_soil_moisture, 168]
- "show me fungal risk over the last 24 hours" → [FETCH_TREND: sensor.farm_fungal_risk, 24]
- "has the temperature been rising?" → [FETCH_TREND: sensor.farm_soil_temp, 72]

RULES for FETCH_TREND:
- Use ONLY the tool tag on its own line — do not add any other text before or after it.
- The system will fetch real historical data and call you again with the results.
- Default to 72 hours if the user doesn't specify a timeframe.
- Common timeframes: "today"=24h, "this week"=168h, "yesterday"=48h, "last few days"=72h

== TIMER TOOL (feature 6) ==
When the user asks you to run something for a set duration (irrigation, lights, etc.), after sending the
JSON command to turn it on, also emit a TIMER tag to schedule automatic turn-off:

[TIMER: <entity_id>, <minutes>, <domain>]

Examples:
- "Turn on zone 1 for 30 minutes" → JSON turn_on + [TIMER: switch.irrigation_zone_1, 30, switch]
- "Turn on barn lights for 1 hour" → JSON turn_on + [TIMER: light.barn_lights, 60, light]

RULES for TIMER:
- Always include the domain so the auto-off fires the correct service.
- Confirm the duration verbally: "Turning on zone 1 for 30 minutes, Ray — I'll turn it off automatically."
- Do NOT emit TIMER for actions that don't have a natural end (locks, scenes, thermostat setpoints)."""


SYSTEM_PROMPT = _build_system_prompt()


# ── GPU concurrency lock ──────────────────────────────────────────────────────
GPU_LOCK = asyncio.Semaphore(GPU_CONCURRENCY)


# ── Lifespan (replaces deprecated @app.on_event) ──────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    print("[startup] Warming up Whisper...", flush=True)
    try:
        await loop.run_in_executor(None, get_whisper)
        print("[startup] Whisper ready.", flush=True)
    except Exception as e:
        print(f"[startup] Whisper failed (non-fatal): {e}", flush=True)
    print("[startup] Warming up Kokoro...", flush=True)
    try:
        await loop.run_in_executor(None, get_kokoro)
        print("[startup] Kokoro ready.", flush=True)
    except Exception as e:
        print(f"[startup] Kokoro failed (non-fatal, TTS disabled): {e}", flush=True)
    print("[startup] Server accepting requests.", flush=True)
    # Seed HA entity cache once at startup, then keep it warm in background
    asyncio.ensure_future(_refresh_ha_cache())
    async def _cache_loop():
        while True:
            await asyncio.sleep(60)
            await _refresh_ha_cache()
    asyncio.ensure_future(_cache_loop())
    # Start APScheduler for timed device actions and daily digest
    scheduler.start()
    # Schedule daily farm digest at 12:00 UTC (~7-8 AM US Eastern)
    scheduler.add_job(_daily_digest_job, "cron", hour=12, minute=0, id="daily_digest", replace_existing=True)
    print("[startup] APScheduler started.", flush=True)
    yield
    scheduler.shutdown(wait=False)


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
        print(f"[whisper] Loading {WHISPER_MODEL} on {WHISPER_DEVICE}...", flush=True)
        _whisper = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_DTYPE)
        print(f"[whisper] Loaded on {WHISPER_DEVICE}.", flush=True)
    except Exception as e:
        print(f"[whisper] GPU load failed ({e}), falling back to CPU...", flush=True)
        _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        print("[whisper] Loaded on CPU.", flush=True)
    return _whisper


def get_kokoro():
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    print("[kokoro] Initializing pipeline on GPU...", flush=True)
    try:
        _pipeline = KPipeline(lang_code='a', device='cuda')
        print("[kokoro] Loaded on GPU.", flush=True)
    except Exception as e:
        print(f"[kokoro] GPU init failed ({e}), falling back to CPU...", flush=True)
        try:
            _pipeline = KPipeline(lang_code='a', device='cpu')
            print("[kokoro] Loaded on CPU.", flush=True)
        except Exception as e2:
            print(f"[kokoro] CPU init also failed: {e2}", flush=True)
            raise
    return _pipeline


# ── Ollama helpers ────────────────────────────────────────────────────────────
def _ollama_chat_stream(messages: list[dict], options: dict):
    url = f"{OLLAMA_HOST.rstrip('/')}/api/chat"
    payload = {"model": OLLAMA_MODEL, "messages": messages, "stream": True, "options": options}
    print(f"[ollama] POST {url} model={OLLAMA_MODEL}", flush=True)
    try:
        with requests.post(url, json=payload, stream=True, timeout=120) as r:
            print(f"[ollama] HTTP {r.status_code}", flush=True)
            r.raise_for_status()
            for line in r.iter_lines():
                if line:
                    chunk = json.loads(line.decode("utf-8"))
                    content = (chunk.get("message") or {}).get("content", "")
                    if content:
                        yield content
            print("[ollama] stream done", flush=True)
    except Exception as e:
        print(f"[ollama] ERROR: {e}", flush=True)
        raise


# ── HA entity cache (refreshed in background every 60s) ───────────────────────
_ha_entity_cache: list[dict] = []
_ha_entity_cache_ts: float = 0.0

async def _refresh_ha_cache():
    global _ha_entity_cache, _ha_entity_cache_ts
    try:
        entities = await ha_list_entities()
        if entities:
            _ha_entity_cache = entities
            _ha_entity_cache_ts = time.time()
    except Exception:
        pass

def _get_cached_ha_entities() -> list[dict]:
    return _ha_entity_cache

# ── Sky Memory System ──────────────────────────────────────────────────────────
MEMORY_PATH = Path("/app/data/sky_memory.json")

def _load_memory() -> dict:
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MEMORY_PATH.exists():
        try:
            return json.loads(MEMORY_PATH.read_text())
        except Exception:
            pass
    return {"events": [], "observations": [], "spray_log": [], "notes": [], "decisions": []}

def _save_memory(mem: dict):
    MEMORY_PATH.parent.mkdir(parents=True, exist_ok=True)
    MEMORY_PATH.write_text(json.dumps(mem, indent=2))


def _entry_text(entry: dict | str) -> str:
    """Flatten a memory entry (dict or str) to a single searchable string."""
    if isinstance(entry, str):
        return entry
    parts = []
    for k in ("product", "note", "description", "type", "sensor", "recommendation", "outcome", "title"):
        v = entry.get(k)
        if v:
            parts.append(str(v))
    return " ".join(parts).lower()


def _search_memory(mem: dict, query: str, top_n: int = 6) -> str:
    """
    Feature 1: Contextual memory retrieval.
    Score every memory entry against the query by keyword overlap,
    return the top_n most relevant entries as a compact summary string.
    Falls back to most-recent entries when query is empty.
    """
    query_words = set(re.findall(r"\w+", query.lower())) - {"the", "a", "is", "what", "when", "did", "i", "you", "it", "was"}

    scored: list[tuple[float, str, str]] = []  # (score, category, text)

    def score_and_add(category: str, entries: list, fmt_fn):
        for entry in entries:
            text = _entry_text(entry)
            if query_words:
                entry_words = set(re.findall(r"\w+", text))
                score = len(query_words & entry_words) / max(len(query_words), 1)
            else:
                score = 0.0
            date = entry.get("date", "")[:10] if isinstance(entry, dict) else ""
            scored.append((score, category, f"[{date}] {fmt_fn(entry)}" if date else fmt_fn(entry)))

    def fmt_spray(e):
        return f"Spray: {e.get('product','?')} @ {e.get('rate','?')} — {e.get('notes','')}"
    def fmt_obs(e):
        return f"Observation: {e.get('note','?')} (GDD {e.get('gdd','?')})"
    def fmt_event(e):
        return f"Event [{e.get('type','?')}]: {e.get('description', e.get('sensor',''))} → {e.get('state','')}"
    def fmt_note(e):
        return f"Note: {e}" if isinstance(e, str) else f"Note: {e}"
    def fmt_decision(e):
        outcome = f" → Outcome: {e['outcome']}" if e.get("outcome") else " (pending outcome)"
        return f"Recommendation: {e.get('recommendation','?')}{outcome}"

    score_and_add("spray",     mem.get("spray_log", []),  fmt_spray)
    score_and_add("obs",       mem.get("observations", []), fmt_obs)
    score_and_add("event",     mem.get("events", []),     fmt_event)
    score_and_add("note",      mem.get("notes", []),      fmt_note)
    score_and_add("decision",  mem.get("decisions", []),  fmt_decision)

    # Sort by score desc, then take top_n; always include at least the 2 most recent of each major type
    scored.sort(key=lambda x: x[0], reverse=True)
    selected = [s[2] for s in scored[:top_n]]

    # Always append the very last spray if not already included (high farming relevance)
    if mem.get("spray_log"):
        last_spray = fmt_spray(mem["spray_log"][-1])
        tail = f"[{mem['spray_log'][-1].get('date','')[:10]}] {last_spray}"
        if tail not in selected:
            selected.append(tail)

    return "\n".join(selected) if selected else "No memory entries yet."


def _memory_summary(mem: dict, query: str = "") -> str:
    """Wrapper kept for backward-compat — now uses contextual retrieval."""
    return _search_memory(mem, query)


# ── Session store (feature 2) — per-session conversation history ───────────────
SESSIONS_PATH = Path("/app/data/sessions.json")
_sessions: dict[str, list[dict]] = {}   # session_id -> message list

def _load_sessions():
    global _sessions
    if SESSIONS_PATH.exists():
        try:
            _sessions = json.loads(SESSIONS_PATH.read_text())
        except Exception:
            _sessions = {}

def _save_sessions():
    SESSIONS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Keep only last 20 sessions, max 40 messages each to avoid unbounded growth
    trimmed = {k: v[-40:] for k, v in list(_sessions.items())[-20:]}
    SESSIONS_PATH.write_text(json.dumps(trimmed))

def _get_session(session_id: str) -> list[dict]:
    if session_id not in _sessions:
        # Seed new session with latest farm context if available
        farm_ctx = _sessions.get("__farm_context__", [])
        _sessions[session_id] = list(farm_ctx)
    return _sessions[session_id]

def _append_session(session_id: str, role: str, content: str):
    _sessions.setdefault(session_id, []).append({"role": role, "content": content})
    _save_sessions()

_load_sessions()


# ── Decision journal (feature 3) ───────────────────────────────────────────────
RECOMMENDATION_KEYWORDS = [
    "recommend", "suggest", "you should", "you need to", "consider", "apply",
    "spray", "irrigate", "turn on", "activate", "protect", "check", "monitor",
]

def _maybe_log_recommendation(text: str, context: str = ""):
    """If the LLM response contains a farm recommendation, log it to decisions[]."""
    lower = text.lower()
    if not any(kw in lower for kw in RECOMMENDATION_KEYWORDS):
        return
    # Extract first sentence as the recommendation
    first_sentence = re.split(r"[.!?]", text.strip())[0].strip()
    if len(first_sentence) < 15:
        return
    mem = _load_memory()
    mem.setdefault("decisions", []).append({
        "date": datetime.datetime.now().isoformat(),
        "recommendation": first_sentence,
        "context": context[:200],
        "outcome": None,
    })
    # Keep only last 50 decisions
    mem["decisions"] = mem["decisions"][-50:]
    _save_memory(mem)


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

    # Pre-check: entity must exist in HA cache (skip check for homeassistant domain)
    if entity_id and domain != "homeassistant":
        cached = _get_cached_ha_entities()
        known_ids = {e["entity_id"] for e in cached}
        if known_ids and entity_id not in known_ids:
            print(f"[ha_call] SKIP — entity not in HA: {entity_id}", flush=True)
            return {"error": f"Entity '{entity_id}' not found in Home Assistant. Check the entity ID or create it in HA first."}

    payload = {"entity_id": entity_id}
    if extra:
        # Strip fields that HA rejects for simple on/off services
        STRIP_FOR_SIMPLE = {"variables", "duration"}
        if domain in ("switch", "input_boolean", "fan", "lock", "cover") and service in ("turn_on", "turn_off", "toggle"):
            extra = {k: v for k, v in extra.items() if k not in STRIP_FOR_SIMPLE}
        payload.update(extra)

    url = f"{HA_URL}/api/services/{domain}/{service}"
    print(f"[ha_call] POST {url} payload={payload}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, headers=_ha_headers(), json=payload)
            r.raise_for_status()
            print(f"[ha_call] OK {r.status_code}", flush=True)
            return {"ok": True, "status": r.status_code}
    except httpx.HTTPStatusError as e:
        print(f"[ha_call] ERROR {e.response.status_code}: {e.response.text}", flush=True)
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
    Handles malformed action fields like "switch" (missing service).
    """
    # Try fenced block first, then bare inline JSON with "action" key
    match = re.search(r"```json\s*(\{.*?\})\s*```", llm_response, re.DOTALL)
    if not match:
        match = re.search(r"(\{[^{}]*\"action\"[^{}]*\})", llm_response, re.DOTALL)
    if not match:
        return None
    try:
        cmd = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    # Normalize action: if it's just a domain with no service, infer turn_on
    action = cmd.get("action", "")
    if action and "." not in action:
        # Guess service from entity_id or default to turn_on
        entity_id = cmd.get("entity_id", "")
        if any(kw in llm_response.lower() for kw in ["turn off", "switch off", "disable", "stop"]):
            cmd["action"] = f"{action}.turn_off"
        else:
            cmd["action"] = f"{action}.turn_on"
    return cmd


def strip_command_block(text: str) -> str:
    """Remove the embedded JSON block from the spoken reply.
    Handles both fenced ```json blocks and bare inline JSON objects."""
    # Remove fenced ```json ... ``` blocks
    text = re.sub(r"```json\s*\{.*?\}\s*```", "", text, flags=re.DOTALL)
    # Remove bare JSON objects (starting with { containing "action": )
    text = re.sub(r"\{[^{}]*\"action\"[^{}]*\}", "", text, flags=re.DOTALL)
    # Remove tool tags
    text = re.sub(r"\[FETCH_TREND:[^\]]+\]", "", text)
    text = re.sub(r"\[TIMER:[^\]]+\]", "", text)
    # Clean up leftover punctuation/whitespace artefacts like trailing ". " or double spaces
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\.\s*\.", ".", text)
    return text.strip()


def extract_timer(llm_response: str) -> dict | None:
    """Parse [TIMER: entity_id, minutes, domain] from LLM response."""
    match = re.search(r"\[TIMER:\s*([^,\]]+),\s*(\d+(?:\.\d+)?),\s*([^\]]+)\]", llm_response)
    if not match:
        return None
    return {
        "entity_id": match.group(1).strip(),
        "minutes": float(match.group(2).strip()),
        "domain": match.group(3).strip(),
    }


async def _timer_auto_off(entity_id: str, domain: str):
    """Called by APScheduler after timer expires — turns entity off and logs a spoken reminder."""
    print(f"[timer] Auto-off firing for {entity_id} ({domain})", flush=True)
    result = await ha_call_service(domain, "turn_off", entity_id)
    spoken = f"Hey Ray, the timer has expired — {entity_id.split('.')[-1].replace('_', ' ')} has been turned off."
    # Log as an event
    mem = _load_memory()
    mem.setdefault("events", []).append({
        "date": datetime.datetime.now().isoformat(),
        "type": "timer_expired",
        "sensor": entity_id,
        "state": "off",
        "severity": "info",
    })
    _save_memory(mem)
    # Generate TTS for the reminder and store it so frontend can pick it up
    try:
        loop = asyncio.get_event_loop()
        async with GPU_LOCK:
            wav_bytes, _ = await loop.run_in_executor(None, lambda: synth_wav_bytes(spoken))
        _pending_timer_alerts.append({
            "text": spoken,
            "audio_b64": base64.b64encode(wav_bytes).decode(),
            "entity_id": entity_id,
            "severity": "info",
        })
    except Exception as e:
        print(f"[timer] TTS failed: {e}", flush=True)
        _pending_timer_alerts.append({"text": spoken, "audio_b64": None, "entity_id": entity_id, "severity": "info"})


def schedule_timer(entity_id: str, minutes: float, domain: str) -> str:
    """Schedule an auto-off job. Returns a job_id."""
    job_id = f"timer_{entity_id}_{int(time.time())}"
    run_at = datetime.datetime.now() + datetime.timedelta(minutes=minutes)
    scheduler.add_job(
        _timer_auto_off, "date", run_date=run_at,
        args=[entity_id, domain], id=job_id, replace_existing=True,
    )
    print(f"[timer] Scheduled auto-off for {entity_id} in {minutes}min (job={job_id})", flush=True)
    return job_id


# Pending timer alerts — polled by /alerts/pending endpoint
_pending_timer_alerts: list[dict] = []


# ── Daily digest job (feature 7) ──────────────────────────────────────────────
_last_digest_date: str = ""
_latest_digest: dict | None = None


async def _daily_digest_job():
    """Generate a morning farm briefing at 7 AM. Stored for frontend polling."""
    global _last_digest_date, _latest_digest
    today = datetime.date.today().isoformat()
    if _last_digest_date == today:
        return
    _last_digest_date = today
    print("[digest] Generating daily farm digest...", flush=True)

    # Pull current farm sensor states from HA
    entities = _get_cached_ha_entities()
    farm_entities = [e for e in entities if e["entity_id"].startswith("sensor.farm_")]
    sensor_lines = "\n".join(
        f"  {e['entity_id']}: {e['state']} {e.get('attributes', {}).get('unit_of_measurement', '')}"
        for e in farm_entities
    )

    # Pull memory for context
    mem = _load_memory()
    mem_ctx = _search_memory(mem, "morning farm status spray irrigation")

    prompt_msgs = [
        {"role": "system", "content": f"""You are {PERSONA_NAME}, Ray's farm AI advisor.
Generate a concise morning farm briefing (3-4 sentences max) covering the most important items for the day.
Include: growth stage, any critical risks, spray window status, recommended actions.
Be direct, spoken-language only. Start with 'Good morning, Ray.'
Today's date: {today}
Farm sensors:\n{sensor_lines or 'No sensor data available yet.'}
Recent farm memory:\n{mem_ctx}"""},
        {"role": "user", "content": "Give me today's morning farm briefing."},
    ]

    loop = asyncio.get_event_loop()
    try:
        def _gen():
            return "".join(_ollama_chat_stream(prompt_msgs, {"temperature": 0.4, "num_predict": 150}))
        brief = await loop.run_in_executor(None, _gen)
        brief = strip_markdown_for_tts(brief)
    except Exception as e:
        brief = f"Good morning, Ray. Farm sensors are online. Check the dashboard for today's conditions."
        print(f"[digest] LLM failed: {e}", flush=True)

    # Generate TTS
    audio_b64 = None
    try:
        async with GPU_LOCK:
            wav_bytes, _ = await loop.run_in_executor(None, lambda: synth_wav_bytes(brief))
        audio_b64 = base64.b64encode(wav_bytes).decode()
    except Exception:
        pass

    _latest_digest = {"date": today, "text": brief, "audio_b64": audio_b64}
    # Log to memory
    mem = _load_memory()
    mem.setdefault("events", []).append({"date": datetime.datetime.now().isoformat(), "type": "daily_digest", "description": brief[:120]})
    _save_memory(mem)
    print(f"[digest] Done for {today}.", flush=True)


# ── Markdown → plain text for TTS ────────────────────────────────────────────
def strip_markdown_for_tts(text: str) -> str:
    """Remove markdown formatting so Kokoro speaks clean natural language."""
    # Bold/italic: **text**, *text*, __text__, _text_
    text = re.sub(r'\*{1,3}([^*]+)\*{1,3}', r'\1', text)
    text = re.sub(r'_{1,3}([^_]+)_{1,3}', r'\1', text)
    # Headers: ## Title
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Inline code: `code`
    text = re.sub(r'`([^`]+)`', r'\1', text)
    # Code blocks: ```...```
    text = re.sub(r'```[\s\S]*?```', '', text)
    # Bullet/list markers: - item, * item, 1. item
    text = re.sub(r'^[\-\*]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\d+\.\s+', '', text, flags=re.MULTILINE)
    # Links: [text](url)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Horizontal rules
    text = re.sub(r'^---+$', '', text, flags=re.MULTILINE)
    # Collapse multiple blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# ── WAV synthesis helper ───────────────────────────────────────────────────────
def synth_wav_bytes(text: str) -> tuple[bytes, int]:
    """Synthesize WAV bytes with Kokoro. Returns (wav_bytes, sample_rate)."""
    text = strip_markdown_for_tts(text)
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
    session_id = (body.get("session_id") or "default").strip()
    if not user_msg:
        return JSONResponse({"reply": "I didn't catch that."})

    # Feature 1: Contextual memory retrieval — score entries against this query
    mem = _load_memory()
    mem_summary = _search_memory(mem, user_msg)

    # Feature 2: Session-aware conversation history
    session_history = _get_session(session_id)

    # Use cached HA entities — never block /chat on a live HA fetch
    ha_entities = _get_cached_ha_entities()
    dynamic_prompt = _build_system_prompt()
    if ha_entities:
        ACTIONABLE_DOMAINS = {"light", "switch", "cover", "lock", "climate", "fan", "scene", "script", "automation", "input_boolean"}
        lines = []
        for e in ha_entities:
            domain = e["entity_id"].split(".")[0]
            if domain not in ACTIONABLE_DOMAINS:
                continue
            name = (e.get("attributes") or {}).get("friendly_name") or e["entity_id"]
            state = e.get("state", "")
            lines.append(f"  {e['entity_id']} — \"{name}\" [{state}]")
        dynamic_prompt += "\n== YOUR HOME ASSISTANT ENTITIES (use these exact entity_ids) ==\n" + "\n".join(lines)

    if mem_summary and mem_summary != "No memory entries yet.":
        dynamic_prompt += f"\n\n== SKY MEMORY (relevant farm history) ==\n{mem_summary}"

    _append_session(session_id, "user", user_msg)
    messages = [{"role": "system", "content": dynamic_prompt}] + session_history

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
                full = "".join(tokens)

                # ── Feature 4: Multi-step tool chaining ───────────────────────
                # Run up to 3 tool-pass iterations so the LLM can chain tools
                for _tool_pass in range(3):
                    trend_match = re.search(r"\[FETCH_TREND:\s*([^,\]]+),\s*(\d+)\]", full)
                    if not trend_match:
                        break
                    entity_id_t = trend_match.group(1).strip()
                    hours_t = int(trend_match.group(2).strip())
                    print(f"[trend] pass={_tool_pass+1} fetching {entity_id_t} for {hours_t}h", flush=True)
                    try:
                        trend_data = await ha_trend(entity_id_t, hours_t)
                        stats = trend_data.get("stats", {})
                        points = trend_data.get("points", [])
                        if stats:
                            trend_summary = (
                                f"Historical data for {entity_id_t} over the last {hours_t} hours:\n"
                                f"  Min: {stats['min']}  Max: {stats['max']}  "
                                f"Mean: {stats['mean']}  Change: {stats['delta']:+}  "
                                f"Samples: {stats['count']}\n"
                            )
                            if points:
                                first = points[0]
                                mid   = points[len(points) // 2]
                                last  = points[-1]
                                trend_summary += (
                                    f"  Start: {first['v']} at {first['t'][:16]}\n"
                                    f"  Mid:   {mid['v']} at {mid['t'][:16]}\n"
                                    f"  End:   {last['v']} at {last['t'][:16]}\n"
                                )
                        else:
                            trend_summary = f"No historical data found for {entity_id_t} in the last {hours_t} hours."
                    except Exception as te:
                        trend_summary = f"Could not fetch trend for {entity_id_t}: {te}"

                    trend_messages = messages + [
                        {"role": "assistant", "content": full},
                        {"role": "user", "content": (
                            f"[SYSTEM: Trend data retrieved]\n{trend_summary}\n"
                            f"Now answer the user's original question naturally using this data. "
                            f"You may emit another [FETCH_TREND:...] if you need more data, or answer directly."
                        )},
                    ]
                    def _stream2():
                        return list(_ollama_chat_stream(trend_messages, {"temperature": 0.4}))
                    tokens2 = await loop.run_in_executor(None, _stream2)
                    full = "".join(tokens2) if tokens2 else trend_summary

                # ── Feature 6: TIMER tool ─────────────────────────────────────
                timer_cfg = extract_timer(full)
                if timer_cfg:
                    job_id = schedule_timer(timer_cfg["entity_id"], timer_cfg["minutes"], timer_cfg["domain"])
                    yield f"data: {json.dumps({'event': 'timer_set', 'entity_id': timer_cfg['entity_id'], 'minutes': timer_cfg['minutes'], 'job_id': job_id})}\n\n"

                # Strip all tool tags, JSON blocks, and markdown before streaming
                spoken = strip_command_block(full)
                spoken = strip_markdown_for_tts(spoken)
                for word in re.findall(r'\S+\s*', spoken):
                    yield f"data: {json.dumps({'token': word})}\n\n"

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

            yield f"data: {json.dumps({'event': 'ha_result', 'result': ha_result, 'entity_id': cmd.get('entity_id', '')})}\n\n"

        spoken = strip_command_block(full)
        spoken = strip_markdown_for_tts(spoken)

        # Feature 3: Log recommendation if present
        _maybe_log_recommendation(spoken, context=user_msg)

        # Feature 2: Persist assistant reply to session
        _append_session(session_id, "assistant", spoken)

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

    # Inject farm status into all active sessions so every conversation gets fresh context
    for sid, msgs in _sessions.items():
        # Remove stale farm primes (keep at most 2)
        farm_primes = [i for i, m in enumerate(msgs) if m["role"] == "system" and "FARM STATUS" in m.get("content", "")]
        while len(farm_primes) > 1:
            msgs.pop(farm_primes.pop(0))
        msgs.append({"role": "system", "content": farm_status})
    # Also keep a global farm_status for sessions that don't exist yet
    _sessions.setdefault("__farm_context__", []).clear()
    _sessions["__farm_context__"].append({"role": "system", "content": farm_status})
    _save_sessions()

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


# ── Legacy compat — keep the global conversation list for farm_prime fallback ─
conversation: list[dict] = []


@app.delete("/conversation")
async def clear_conversation():
    conversation.clear()
    await clear_all_sessions()
    return {"status": "cleared"}


# ── Sky Memory endpoints ───────────────────────────────────────────────────────
@app.get("/memory")
async def get_memory():
    """Return Sky's full persistent memory."""
    return _load_memory()


@app.post("/memory/log")
async def log_memory(body: dict):
    """
    Log a farm event to Sky's memory.
    Body: { type: 'spray'|'observation'|'event'|'note', data: {...} }
    Types:
      spray:       { product, rate, target, notes }
      observation: { note, growth_stage, gdd }
      event:       { type, description }
      note:        str — free-form note
    """
    mem = _load_memory()
    mtype = body.get("type", "event")
    data  = body.get("data", {})
    now   = datetime.datetime.now().isoformat()

    if mtype == "spray":
        mem["spray_log"].append({"date": now, **data})
    elif mtype == "observation":
        mem["observations"].append({"date": now, **data})
    elif mtype == "note":
        mem["notes"].append(f"[{now[:10]}] {data}" if isinstance(data, str) else f"[{now[:10]}] {json.dumps(data)}")
    else:
        mem["events"].append({"date": now, "type": mtype, **data})

    _save_memory(mem)
    return {"status": "logged", "type": mtype}


@app.delete("/memory")
async def clear_memory():
    _save_memory({"events": [], "observations": [], "spray_log": [], "notes": [], "decisions": []})
    return {"status": "cleared"}


@app.get("/memory/search")
async def memory_search(q: str = ""):
    """Feature 1: Search memory by keyword relevance."""
    mem = _load_memory()
    results = _search_memory(mem, q, top_n=10)
    return {"query": q, "results": results}


@app.get("/memory/decisions")
async def get_decisions():
    """Feature 3: Return all logged recommendations/decisions."""
    mem = _load_memory()
    return {"decisions": list(reversed(mem.get("decisions", [])))}


@app.post("/memory/outcome")
async def log_outcome(body: dict):
    """
    Feature 3: Link an outcome to a pending decision.
    Body: { index: int (0=latest), outcome: str }
    """
    mem = _load_memory()
    decisions = mem.get("decisions", [])
    if not decisions:
        return JSONResponse({"error": "No decisions logged yet."}, status_code=404)
    idx = body.get("index", len(decisions) - 1)
    outcome = (body.get("outcome") or "").strip()
    if not outcome:
        return JSONResponse({"error": "outcome required"}, status_code=400)
    try:
        decisions[idx]["outcome"] = outcome
        decisions[idx]["outcome_date"] = datetime.datetime.now().isoformat()
    except IndexError:
        return JSONResponse({"error": "index out of range"}, status_code=400)
    mem["decisions"] = decisions
    _save_memory(mem)
    return {"status": "outcome logged", "decision": decisions[idx]}


# ── Session endpoints (feature 2) ─────────────────────────────────────────────
@app.get("/sessions")
async def list_sessions():
    """List all active sessions and their message counts."""
    return {
        "sessions": [
            {"session_id": sid, "message_count": len(msgs), "last_message": msgs[-1]["content"][:60] if msgs else ""}
            for sid, msgs in _sessions.items()
        ]
    }


@app.delete("/sessions/{session_id}")
async def clear_session(session_id: str):
    """Clear a specific session's conversation history."""
    _sessions.pop(session_id, None)
    _save_sessions()
    return {"status": "cleared", "session_id": session_id}


@app.delete("/sessions")
async def clear_all_sessions():
    """Clear all session histories."""
    _sessions.clear()
    _save_sessions()
    return {"status": "all sessions cleared"}


# ── Pending timer alerts (feature 6) ──────────────────────────────────────────
@app.get("/alerts/pending")
async def get_pending_alerts():
    """
    Frontend polls this to pick up timer expiry notifications and other
    server-pushed alerts (auto-off spoken reminders, etc).
    Clears the queue on read.
    """
    alerts = list(_pending_timer_alerts)
    _pending_timer_alerts.clear()
    return {"alerts": alerts}


@app.get("/alerts/timers")
async def list_timers():
    """Return all currently scheduled timer jobs."""
    jobs = [
        {
            "job_id": job.id,
            "run_at": job.next_run_time.isoformat() if job.next_run_time else None,
            "args": list(job.args) if job.args else [],
        }
        for job in scheduler.get_jobs()
        if job.id.startswith("timer_")
    ]
    return {"timers": jobs}


@app.delete("/alerts/timers/{job_id}")
async def cancel_timer(job_id: str):
    """Cancel a pending timer by job_id."""
    try:
        scheduler.remove_job(job_id)
        return {"status": "cancelled", "job_id": job_id}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=404)


# ── Daily digest endpoints (feature 7) ────────────────────────────────────────
@app.get("/digest")
async def get_digest():
    """Return today's morning digest if generated, or trigger one now."""
    global _latest_digest
    today = datetime.date.today().isoformat()
    if _latest_digest and _latest_digest.get("date") == today:
        return _latest_digest
    # Trigger generation on-demand (e.g. first page load of the day)
    await _daily_digest_job()
    return _latest_digest or {"date": today, "text": None, "audio_b64": None}


@app.post("/digest/trigger")
async def trigger_digest():
    """Force-regenerate the daily digest regardless of whether it already ran today."""
    global _last_digest_date
    _last_digest_date = ""  # reset gate so _daily_digest_job runs
    await _daily_digest_job()
    return _latest_digest or {"error": "digest generation failed"}


# ── Persona config endpoints (feature 8) ──────────────────────────────────────
@app.get("/persona")
async def get_persona():
    """Return the current persona configuration."""
    return {
        "name":  PERSONA_NAME,
        "style": PERSONA_STYLE,
        "notes": PERSONA_NOTES,
        "preview": _build_system_prompt()[:300] + "...",
    }


@app.post("/persona")
async def set_persona(body: dict):
    """
    Update persona at runtime (no restart needed).
    Body: { name?: str, style?: str, notes?: str }
    Changes take effect on the next /chat call.
    """
    global PERSONA_NAME, PERSONA_STYLE, PERSONA_NOTES, SYSTEM_PROMPT
    if "name"  in body: PERSONA_NAME  = body["name"].strip()
    if "style" in body: PERSONA_STYLE = body["style"].strip()
    if "notes" in body: PERSONA_NOTES = body["notes"].strip()
    SYSTEM_PROMPT = _build_system_prompt()
    print(f"[persona] Updated: name={PERSONA_NAME} style={PERSONA_STYLE}", flush=True)
    return {"status": "updated", "name": PERSONA_NAME, "style": PERSONA_STYLE, "notes": PERSONA_NOTES}


# ── Proactive alert webhook (called by HA automations) ────────────────────────
@app.post("/alert")
async def proactive_alert(body: dict):
    """
    Called by HA automations when a farm sensor threshold is crossed.
    Generates a spoken TTS briefing and broadcasts it to connected frontends.
    Body: { sensor: str, state: str, message: str, severity: str }
    Returns: { text: str, audio_b64: str|None }
    """
    sensor   = body.get("sensor", "unknown")
    state    = body.get("state", "")
    message  = body.get("message", "")
    severity = body.get("severity", "warning")

    # Ask LLM to turn the raw alert into natural spoken language
    prompt = [
        {"role": "system", "content": "You are Sky, Ray's farm AI assistant. Convert this farm alert into one natural spoken sentence (no formatting, no bullet points). Be concise and start with 'Hey Ray,'"},
        {"role": "user", "content": f"Alert — {sensor} is now {state}. {message}"}
    ]
    loop = asyncio.get_event_loop()
    try:
        def _gen():
            return "".join(_ollama_chat_stream(prompt, {"temperature": 0.3, "num_predict": 80}))
        spoken = await loop.run_in_executor(None, _gen)
    except Exception:
        spoken = message or f"Alert: {sensor} is {state}."

    # Log alert to memory
    mem = _load_memory()
    mem["events"].append({"date": datetime.datetime.now().isoformat(), "type": "alert", "sensor": sensor, "state": state, "severity": severity})
    _save_memory(mem)

    # Generate TTS audio if Kokoro is available
    audio_b64 = None
    try:
        async with GPU_LOCK:
            wav_bytes, sr = await loop.run_in_executor(None, lambda: synth_wav_bytes(spoken))
        audio_b64 = base64.b64encode(wav_bytes).decode()
    except Exception:
        pass

    return {"text": spoken, "audio_b64": audio_b64, "severity": severity, "sensor": sensor}


# ── NodeCanvas virtual device sync ────────────────────────────────────────────
# Node types that should become controllable HA entities (not just read-only sensors)
ACTIONABLE_NODE_TYPES = {"irrigation", "light", "switch"}


@app.post("/canvas/sync")
async def canvas_sync(body: dict):
    """
    Push NodeCanvas nodes as virtual HA entities.
    - Read-only nodes (tensiometer, camera, rainpoint) → sensor.canvas_* state-machine entry.
    - Actionable nodes (irrigation, light, switch) → also register the config entity_id
      as a real input_boolean in HA so Sky can control it via input_boolean.turn_on/off.
    Body: { nodes: [ { id, type, config: { entity_id, friendly_name, ... } } ] }
    """
    nodes = body.get("nodes", [])
    if not HA_TOKEN:
        return {"pushed": 0, "error": "HA_TOKEN not set"}

    DOMAIN_ICON = {
        "light": "mdi:lightbulb",
        "camera": "mdi:camera",
        "irrigation": "mdi:water",
        "tensiometer": "mdi:water-percent",
        "rainpoint": "mdi:sprout",
        "switch": "mdi:toggle-switch",
    }
    pushed = 0
    errors = []
    now = datetime.datetime.now().isoformat()

    async with httpx.AsyncClient(timeout=10) as client:
        for node in nodes:
            ntype  = node.get("type", "unknown")
            cfg    = node.get("config", {})
            raw_id = cfg.get("entity_id") or f"canvas_{node.get('id','x')}"
            friendly = cfg.get("friendly_name", raw_id)

            # ── 1. Always push sensor.canvas_* placeholder for dashboard display ──
            canvas_id = raw_id if "." in raw_id else f"sensor.{raw_id}"
            if not canvas_id.startswith("sensor.canvas_") and not canvas_id.startswith("sensor.farm_"):
                canvas_id = "sensor.canvas_" + canvas_id.split(".", 1)[-1]

            sensor_payload = {
                "state": "placeholder",
                "attributes": {
                    "friendly_name": friendly,
                    "icon": DOMAIN_ICON.get(ntype, "mdi:devices"),
                    "device_type": ntype,
                    "canvas_node": True,
                    "last_synced": now,
                    **{k: v for k, v in cfg.items() if k not in ("entity_id", "friendly_name")},
                }
            }
            try:
                r = await client.post(f"{HA_URL}/api/states/{canvas_id}", headers=_ha_headers(), json=sensor_payload)
                if r.status_code in (200, 201):
                    pushed += 1
                else:
                    errors.append(f"{canvas_id}: HTTP {r.status_code}")
            except Exception as e:
                errors.append(f"{canvas_id}: {e}")

            # ── 2. For actionable nodes, also register a real input_boolean ──────
            if ntype in ACTIONABLE_NODE_TYPES and raw_id:
                # Derive input_boolean entity_id from config entity_id
                # e.g. switch.irrigation_zone_1 → input_boolean.irrigation_zone_1
                slug = raw_id.split(".", 1)[-1] if "." in raw_id else raw_id
                ib_id = f"input_boolean.{slug}"

                # Check if this input_boolean already exists — skip creation if so
                state_r = await client.get(f"{HA_URL}/api/states/{ib_id}", headers=_ha_headers())
                if state_r.status_code == 404:
                    # Create it via the input_boolean REST API
                    create_r = await client.post(
                        f"{HA_URL}/api/config/input_boolean/config/{slug}",
                        headers=_ha_headers(),
                        json={"name": friendly, "icon": DOMAIN_ICON.get(ntype, "mdi:toggle-switch")},
                    )
                    if create_r.status_code in (200, 201):
                        print(f"[canvas_sync] Created input_boolean {ib_id}", flush=True)
                    else:
                        print(f"[canvas_sync] input_boolean create failed {ib_id}: {create_r.status_code} {create_r.text}", flush=True)
                        errors.append(f"{ib_id}: create HTTP {create_r.status_code}")
                else:
                    print(f"[canvas_sync] input_boolean {ib_id} already exists", flush=True)

    # Refresh HA entity cache so newly created input_booleans are immediately available
    asyncio.ensure_future(_refresh_ha_cache())
    return {"pushed": pushed, "total": len(nodes), "errors": errors}


# ── Historical trend endpoint ──────────────────────────────────────────────────
@app.get("/ha/trend/{entity_id:path}")
async def ha_trend(entity_id: str, hours: int = 72):
    """
    Fetch historical states for a sensor and return a sparkline-friendly
    list of {t, v} pairs plus computed stats (min, max, mean, delta).
    Uses HA's /api/history endpoint which is backed by the recorder DB.
    """
    if not HA_TOKEN:
        return {"error": "HA_TOKEN not set", "points": []}
    start = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=hours)).isoformat()
    url = f"{HA_URL}/api/history/period/{start}?filter_entity_id={entity_id}&minimal_response=true&no_attributes=true"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers=_ha_headers())
            r.raise_for_status()
            data = r.json()
            history = data[0] if data else []
        points = []
        for h in history:
            try:
                points.append({"t": h["last_changed"], "v": float(h["state"])})
            except (ValueError, KeyError):
                pass
        if not points:
            return {"entity_id": entity_id, "points": [], "stats": {}}
        vals = [p["v"] for p in points]
        stats = {
            "min":   round(min(vals), 2),
            "max":   round(max(vals), 2),
            "mean":  round(sum(vals) / len(vals), 2),
            "delta": round(vals[-1] - vals[0], 2),
            "count": len(vals),
        }
        return {"entity_id": entity_id, "hours": hours, "points": points, "stats": stats}
    except Exception as e:
        return {"error": str(e), "points": []}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False, workers=1)
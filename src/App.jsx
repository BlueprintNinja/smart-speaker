import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import NodeCanvas from "./NodeCanvas";
import Dashboard from "./Dashboard";

// In Docker (nginx) mode VITE_API is not set — use relative /api so nginx proxies correctly.
// For local dev, set VITE_API=http://localhost:8000 in your .env file.
const API = import.meta?.env?.VITE_API || "/api";

// ─────────────────────────────────────────────────────────────────────────────
// THEME — Smart Speaker (Navy + Amber)
// ─────────────────────────────────────────────────────────────────────────────
const styles = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --navy-950:  #060d1a;
  --navy-900:  #0b1526;
  --navy-800:  #112035;
  --navy-700:  #1a3050;
  --navy-600:  #1e3a5f;
  --navy-400:  #2d5a8e;
  --amber-500: #f59e0b;
  --amber-400: #fbbf24;
  --text-dim:  #94a3b8;
  --text-bright: #f8fafc;
}

body {
  background: var(--navy-950);
  color: var(--text-bright);
  font-family: 'Inter', sans-serif;
  overflow: hidden;
}

.app-container {
  display: flex; height: 100vh; width: 100vw;
  background: radial-gradient(circle at 50% 50%, var(--navy-900) 0%, var(--navy-950) 100%);
}

.sidebar {
  width: 320px; border-right: 1px solid var(--navy-700);
  display: flex; flex-direction: column; background: rgba(11, 21, 38, 0.5);
}

.main-view { flex: 1; display: flex; flex-direction: column; position: relative; }

.header {
  padding: 1.5rem; border-bottom: 1px solid var(--navy-700);
  display: flex; justify-content: space-between; align-items: center;
}

.status-badge {
  font-family: 'JetBrains Mono', monospace; font-size: 0.7rem;
  padding: 4px 8px; border-radius: 4px; text-transform: uppercase;
  background: var(--navy-800); border: 1px solid var(--navy-600);
}
.status-badge.active { color: var(--amber-400); border-color: var(--amber-500); box-shadow: 0 0 10px rgba(245, 158, 11, 0.2); }

.chat-history {
  flex: 1; overflow-y: auto; padding: 2rem;
  display: flex; flex-direction: column; gap: 1.5rem;
}

.msg { max-width: 80%; line-height: 1.6; }
.msg.user { align-self: flex-end; color: var(--amber-300); text-align: right; }
.msg.bot { align-self: flex-start; color: var(--text-bright); }

.msg-meta { font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: var(--navy-400); margin-bottom: 0.25rem; }

/* ── UI Components ── */
.input-zone {
  padding: 2rem; border-top: 1px solid var(--navy-700);
  background: rgba(6, 13, 26, 0.8); backdrop-filter: blur(10px);
}

.orb-row { display: flex; flex-direction: column; align-items: center; margin-bottom: 1.5rem; }

.orb-btn {
  width: 80px; height: 80px; border-radius: 50%; border: none;
  cursor: pointer; position: relative; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  display: flex; align-items: center; justify-content: center;
}

.orb-btn.idle { background: var(--navy-700); box-shadow: 0 0 0 4px var(--navy-800); }
.orb-btn.listening { background: var(--amber-500); box-shadow: 0 0 20px var(--amber-500); transform: scale(1.1); }
.orb-btn.thinking { background: var(--navy-400); animation: pulse 1.5s infinite; }

@keyframes pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.7; }
  100% { transform: scale(1); opacity: 1; }
}

.text-row { display: flex; gap: 0.75rem; background: var(--navy-800); padding: 0.5rem; border-radius: 8px; border: 1px solid var(--navy-700); }
.text-input { flex: 1; background: transparent; border: none; color: white; resize: none; outline: none; padding: 0.5rem; font-family: inherit; }
.send-btn { background: transparent; border: none; color: var(--navy-400); cursor: pointer; display: flex; align-items: center; padding: 0.5rem; }
.send-btn:hover { color: var(--amber-400); }

.tts-btn {
  background: var(--navy-700); border: 1px solid var(--navy-600);
  color: var(--text-bright); font-size: 0.7rem; padding: 4px 10px;
  border-radius: 4px; cursor: pointer; margin-top: 0.5rem;
  display: flex; align-items: center; gap: 4px;
}
.tts-btn:hover { background: var(--navy-600); }

.ha-action {
  margin-top: 0.5rem; padding: 4px 8px; border-radius: 4px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.65rem;
  border: 1px solid; display: inline-flex; align-items: center; gap: 6px;
}
.ha-action.ok { color: #4ade80; border-color: #166534; background: rgba(22,101,52,0.15); }
.ha-action.err { color: #f87171; border-color: #7f1d1d; background: rgba(127,29,29,0.15); }

.sidebar-stat { font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
  display: flex; justify-content: space-between; align-items: center;
  padding: 0.35rem 0; border-bottom: 1px solid var(--navy-800); color: var(--text-dim); }
.sidebar-stat .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
.dot-red   { background: #f87171; }
.dot-dim   { background: var(--navy-600); }

.tab-nav { display: flex; border-bottom: 1px solid var(--navy-700); }
.tab-btn {
  flex: 1; padding: 0.6rem; background: none; border: none;
  color: var(--text-dim); font-size: 0.7rem; font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase; letter-spacing: 0.5px; cursor: pointer;
  border-bottom: 2px solid transparent; transition: all 0.15s;
}
.tab-btn:hover { color: var(--text-bright); }
.tab-btn.active { color: var(--amber-400); border-bottom-color: var(--amber-400); }
`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

// ── Stable session ID (feature 2) — persisted across page reloads ──────────────
function getOrCreateSessionId() {
  const key = "sky_session_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = "sess_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
    sessionStorage.setItem(key, id);
  }
  return id;
}

export default function App() {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [orbState, setOrbState] = useState("idle"); // idle, listening, thinking, wake
  const [isRecording, setIsRecording] = useState(false);
  const [haStatus, setHaStatus] = useState(null); // null | true | false
  const [activeTab, setActiveTab] = useState("chat"); // chat | dashboard | memory | decisions
  const [showCanvas, setShowCanvas] = useState(false);
  const [lastHaEvent, setLastHaEvent] = useState(null);
  const [micError, setMicError] = useState(null);
  const [memory, setMemory] = useState(null);
  const [memNote, setMemNote] = useState("");
  const [lastAlert, setLastAlert] = useState(null);
  // Feature 5: wake word
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const wakeWordRef = useRef(false);
  const wakeAnalyserRef = useRef(null);
  const wakeStreamRef = useRef(null);
  const wakeRafRef = useRef(null);
  // Feature 6: active timers display
  const [activeTimers, setActiveTimers] = useState([]);
  // Feature 7: daily digest
  const [digest, setDigest] = useState(null);
  const digestShownRef = useRef(false);
  // Feature 3: decisions
  const [decisions, setDecisions] = useState([]);
  const [outcomeInput, setOutcomeInput] = useState({});

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch(`${API}/health`)
      .then(r => r.json())
      .then(d => setHaStatus(d.ha_ok === true))
      .catch(() => setHaStatus(false));
  }, []);

  // ── Load Sky memory ─────────────────────────────────────────────────────────
  const loadMemory = () => {
    fetch(`${API}/memory`).then(r => r.json()).then(setMemory).catch(() => {});
  };
  useEffect(() => { loadMemory(); }, []);

  // ── Feature 7: Daily digest — fetch on first load of the day ─────────────────
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const lastDigestDay = localStorage.getItem("sky_digest_day");
    if (lastDigestDay === today && digestShownRef.current) return;
    fetch(`${API}/digest`)
      .then(r => r.json())
      .then(d => {
        if (d?.text) {
          setDigest(d);
          if (lastDigestDay !== today) {
            localStorage.setItem("sky_digest_day", today);
            // Auto-play digest audio if available
            if (d.audio_b64) {
              const bytes = Uint8Array.from(atob(d.audio_b64), c => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.play().catch(() => {});
              audio.onended = () => URL.revokeObjectURL(url);
            }
          }
          digestShownRef.current = true;
        }
      })
      .catch(() => {});
  }, []);

  // ── Feature 3: Load decisions ──────────────────────────────────────────────
  const loadDecisions = () => {
    fetch(`${API}/memory/decisions`)
      .then(r => r.json())
      .then(d => setDecisions(d.decisions || []))
      .catch(() => {});
  };
  useEffect(() => { loadDecisions(); }, []);

  // ── Feature 6 + Alert polling — /alerts/pending covers timers AND HA alerts ──
  const lastAlertRef = useRef(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API}/alerts/pending`);
        const data = await r.json();
        const alerts = data.alerts || [];
        for (const alert of alerts) {
          // Play audio if present
          if (alert.audio_b64) {
            try {
              const bytes = Uint8Array.from(atob(alert.audio_b64), c => c.charCodeAt(0));
              const blob = new Blob([bytes], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url);
              audio.play().catch(() => {});
              audio.onended = () => URL.revokeObjectURL(url);
            } catch (_) {}
          }
          // Show in chat
          setMessages(prev => [...prev, {
            role: "bot",
            text: alert.text,
            isAlert: true,
            severity: alert.severity,
          }]);
        }
        // Also refresh active timers display
        const tr = await fetch(`${API}/alerts/timers`);
        const td = await tr.json();
        setActiveTimers(td.timers || []);
      } catch (_) {}
    };
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  // ── Proactive Farm Intelligence ─────────────────────────────────────────────
  const primeFarm = async (forceBrief = false) => {
    try {
      const FARM_LAT = 39.09, FARM_LON = -90.33, GDD_BASE = 50;
      const today = new Date();
      const fmt = d => d.toISOString().slice(0, 10);
      const gddStart  = new Date(today.getFullYear(), 2, 1);
      const chillStart = new Date(today.getFullYear(), 8, 1);
      const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

      const [histRes, fcastRes, nwsRes] = await Promise.all([
        fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${FARM_LAT}&longitude=${FARM_LON}&start_date=${fmt(gddStart)}&end_date=${fmt(yesterday)}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`),
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${FARM_LAT}&longitude=${FARM_LON}&past_days=2&forecast_days=7&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,soil_moisture_0_to_7cm&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=mph&timezone=auto`),
        fetch(`https://api.weather.gov/alerts/active?point=${FARM_LAT},${FARM_LON}`),
      ]);
      const hist  = await histRes.json();
      const fcast = await fcastRes.json();
      const nws   = nwsRes.ok ? await nwsRes.json() : { features: [] };

      let gdd = 0;
      for (let i = 0; i < (hist.daily?.temperature_2m_max?.length ?? 0); i++) {
        const avg = (hist.daily.temperature_2m_max[i] + hist.daily.temperature_2m_min[i]) / 2;
        gdd += Math.max(0, avg - GDD_BASE);
      }
      const ti = fcast.daily.time.findIndex(t => t === fmt(today));
      if (ti >= 0) gdd += Math.max(0, ((fcast.daily.temperature_2m_max[ti] + fcast.daily.temperature_2m_min[ti]) / 2) - GDD_BASE);

      let chillHours = 0;
      const chillStr = fmt(chillStart);
      for (let i = 0; i < fcast.hourly.time.length; i++) {
        if (fcast.hourly.time[i] >= chillStr && fcast.hourly.temperature_2m[i] < 45) chillHours++;
      }

      const nowStr = new Date().toISOString().slice(0, 13);
      const ci = Math.max(0, fcast.hourly.time.findIndex(t => t.slice(0, 13) >= nowStr));
      const temp   = fcast.hourly.temperature_2m[ci] ?? 0;
      const humid  = fcast.hourly.relative_humidity_2m[ci] ?? 0;
      const wind   = fcast.hourly.wind_speed_10m[ci] ?? 0;
      const gusts  = fcast.hourly.wind_gusts_10m[ci] ?? 0;
      const precip = fcast.hourly.precipitation[ci] ?? 0;
      const soilM  = fcast.hourly.soil_moisture_0_to_7cm[ci] ?? 0;

      const STAGES = [{s:"Dormant",g:0},{s:"Bud Break",g:100},{s:"Vegetative",g:200},{s:"Flowering",g:350},{s:"Green Fruit",g:550},{s:"Ripening",g:750},{s:"Harvest Ready",g:900},{s:"Post-Harvest",g:1100}];
      let growthStage = "Dormant";
      for (const x of STAGES) { if (gdd >= x.g) growthStage = x.s; }

      const alerts = (nws.features ?? []).map(f => ({ event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline }));

      const insights = [];
      if (alerts.length) insights.push(...alerts.map(a => ({ severity: "critical", title: a.event, summary: a.headline?.slice(0, 100) || a.event })));
      const frostVuln = ["Bud Break","Vegetative","Flowering","Green Fruit"];
      if (frostVuln.includes(growthStage)) {
        for (let i = 0; i < fcast.daily.time.length; i++) {
          if (fcast.daily.temperature_2m_min[i] <= 32) {
            insights.push({ severity: "critical", title: "Frost Risk", summary: `${fcast.daily.temperature_2m_min[i]}°F low on ${fcast.daily.time[i]} during ${growthStage}` });
            break;
          }
        }
      }
      if (gdd >= 500 && gdd < 1200) insights.push({ severity: gdd >= 800 ? "critical" : "warning", title: "SWD Pressure", summary: gdd >= 800 ? `Peak SWD at ${Math.round(gdd)} GDD — IPM required` : `SWD emerging at ${Math.round(gdd)} GDD — set traps` });
      const wetness = Math.min(1, (Math.max(0, humid - 60) / 40) + precip * 2);
      const fungal = Math.round(Math.min(100, wetness * (temp >= 60 && temp <= 80 ? 1 : 0.6) * 100));
      if (fungal >= 70) insights.push({ severity: fungal >= 85 ? "critical" : "warning", title: "Fungal Risk", summary: `${fungal}% fungal pressure at ${Math.round(humid)}% humidity` });
      if (soilM < 0.1) insights.push({ severity: "warning", title: "Low Soil Moisture", summary: `Soil moisture ${(soilM*100).toFixed(1)}% — consider irrigation` });

      const criticals = insights.filter(i => i.severity === "critical").length;
      const context = {
        timestamp: today.toLocaleString(),
        gdd, chillHours, growthStage,
        weather: { current: { temp, humidity: humid, windSpeed: wind, windGusts: gusts, precipitation: precip, soilMoisture: soilM } },
        alerts, insights,
      };

      const res = await fetch(`${API}/farm/prime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, criticals, force_brief: forceBrief }),
      });
      const data = await res.json();

      if (data.brief) {
        setMessages(prev => [...prev, { role: "bot", text: `🌿 ${data.brief}`, isFarmBrief: true }]);
        playTTS(data.brief);
      }
    } catch (e) {
      console.warn("Farm prime failed:", e);
    }
  };

  useEffect(() => {
    // Initial prime on load (silent — no brief unless criticals exist)
    primeFarm(false);
    // Every 10 min re-prime; every hour force a brief
    let count = 0;
    const id = setInterval(() => {
      count++;
      primeFarm(count % 6 === 0); // force spoken brief every 60 min
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── Feature 5: Wake word detection (energy-based "Hey Sky" trigger) ──────────
  const WAKE_PHRASE = "hey sky";

  const startWakeWord = useCallback(async () => {
    if (wakeWordRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      wakeStreamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      wakeAnalyserRef.current = analyser;
      wakeWordRef.current = true;
      setWakeWordEnabled(true);
      setOrbState("wake");

      // We use the Web Speech API for live phrase detection when available,
      // falling back to energy-level recording + Whisper for "hey sky" detection.
      if (window.SpeechRecognition || window.webkitSpeechRecognition) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (ev) => {
          const transcript = Array.from(ev.results)
            .map(r => r[0].transcript.toLowerCase()).join(" ");
          if (transcript.includes(WAKE_PHRASE) && !isRecording && !loading) {
            rec.stop();
            stopWakeWord();
            startListening();
          }
        };
        rec.onend = () => {
          if (wakeWordRef.current) rec.start(); // restart if still armed
        };
        rec.onerror = () => {};
        rec.start();
        wakeWordRef.current = rec; // store for cleanup
      } else {
        // Fallback: monitor energy; if sustained loud audio, start recording
        const buf = new Uint8Array(analyser.frequencyBinCount);
        let silenceCount = 0;
        const tick = () => {
          if (!wakeWordRef.current) return;
          analyser.getByteFrequencyData(buf);
          const energy = buf.reduce((s, v) => s + v, 0) / buf.length;
          if (energy > 40) { silenceCount = 0; }
          else { silenceCount++; }
          // Sustained energy spike — treat as activation
          if (energy > 55 && !isRecording && !loading) {
            stopWakeWord();
            startListening();
            return;
          }
          wakeRafRef.current = requestAnimationFrame(tick);
        };
        wakeRafRef.current = requestAnimationFrame(tick);
      }
    } catch (err) {
      setMicError("Wake word mic error: " + err.message);
    }
  }, [isRecording, loading]);

  const stopWakeWord = useCallback(() => {
    if (typeof wakeWordRef.current === "object" && wakeWordRef.current?.stop) {
      try { wakeWordRef.current.stop(); } catch (_) {}
    }
    wakeWordRef.current = false;
    if (wakeRafRef.current) cancelAnimationFrame(wakeRafRef.current);
    if (wakeStreamRef.current) {
      wakeStreamRef.current.getTracks().forEach(t => t.stop());
      wakeStreamRef.current = null;
    }
    setWakeWordEnabled(false);
    setOrbState("idle");
  }, []);

  // ── Speech Recognition / Audio Recording ─────────────────────────────────────
  const startListening = async () => {
    setMicError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMicError(location.protocol !== 'https:' && location.hostname !== 'localhost'
        ? 'Mic requires HTTPS. Access via localhost or enable HTTPS.'
        : 'Microphone not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.onstop = handleAudioStop;

      recorder.start();
      setIsRecording(true);
      setOrbState("listening");
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setMicError('Mic permission denied. Allow microphone access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setMicError('No microphone found. Plug in a mic and try again.');
      } else {
        setMicError(`Mic error: ${err.message}`);
      }
      setOrbState('idle');
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setOrbState("thinking");
    }
  };

  const handleAudioStop = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("audio", audioBlob, "user_speech.webm");

    try {
      const res = await fetch(`${API}/transcribe`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.text?.trim()) {
        sendText(data.text);
      } else {
        setOrbState("idle");
      }
    } catch (err) {
      console.error("Transcription failed", err);
      setOrbState("idle");
    }
  };

  // ── Chat & TTS ──────────────────────────────────────────────────────────────
  const sendText = async (text) => {
    if (!text.trim()) return;
    setLoading(true);
    setOrbState("thinking");

    const newMsg = { role: "user", text };
    setMessages(prev => [...prev, newMsg]);
    setInput("");

    try {
      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let botText = "";
      let buf = "";
      let finalText = "";

      // Add initial empty bot message
      setMessages(prev => [...prev, { role: "bot", text: "", sources: [] }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) {
              botText += data.token;
              updateLastBotMessage(botText, null, null);
            } else if (data.event === "ha_result") {
              updateLastBotMessage(null, null, data.result);
              setLastHaEvent({ ...data.result, entity_id: data.entity_id });
            } else if (data.event === "timer_set") {
              const mins = data.minutes;
              const label = data.entity_id?.split(".")[1]?.replace(/_/g, " ") || data.entity_id;
              setMessages(prev => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "bot") {
                  next[next.length - 1] = { ...last, timerInfo: { entity_id: data.entity_id, minutes: mins, label, job_id: data.job_id } };
                }
                return next;
              });
              fetch(`${API}/alerts/timers`).then(r => r.json()).then(d => setActiveTimers(d.timers || [])).catch(() => {});
            } else if (data.done) {
              finalText = data.full || botText;
            }
          } catch (e) { /* malformed line */ }
        }
      }
      // Speak the full response once streaming is complete
      if (finalText.trim()) playTTS(finalText);
    } catch (err) {
      console.error("Chat failed", err);
    } finally {
      setLoading(false);
      setOrbState("idle");
    }
  };

  const updateLastBotMessage = (text, sources, haResult) => {
    setMessages(prev => {
      const next = [...prev];
      const last = { ...next[next.length - 1] };
      if (last.role === "bot") {
        if (text !== null)     last.text = text;
        if (sources !== null)  last.sources = sources;
        if (haResult !== null) last.haResult = haResult;
        next[next.length - 1] = last;
      }
      return next;
    });
  };

  const playTTS = async (text) => {
    try {
      const res = await fetch(`${API}/tts_audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (err) {
      console.error("TTS playback error", err);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText(input);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app-container">
        
        {/* ── Sidebar ── */}
        <aside className="sidebar">
          <div className="header" style={{ borderBottom: '1px solid var(--navy-700)' }}>
            <h2 style={{ fontSize: '0.9rem', letterSpacing: '1px', color: 'var(--amber-400)' }}>SMART SPEAKER</h2>
            <div className={`status-badge ${orbState !== 'idle' ? 'active' : ''}`}>
              {orbState}
            </div>
          </div>
          <div className="tab-nav">
            <button className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`} onClick={() => setActiveTab('chat')}>💬</button>
            <button className={`tab-btn${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')}>⊞</button>
            <button className={`tab-btn${activeTab === 'memory' ? ' active' : ''}`} onClick={() => { setActiveTab('memory'); loadMemory(); }}>🧠</button>
            <button className={`tab-btn${activeTab === 'decisions' ? ' active' : ''}`} onClick={() => { setActiveTab('decisions'); loadDecisions(); }}>📋</button>
          </div>
          <div style={{ padding: '1.5rem' }}>
            <div className="sidebar-stat">
              <span>LLM</span>
              <span className="dot dot-green" title="Ollama" />
            </div>
            <div className="sidebar-stat">
              <span>WHISPER</span>
              <span className="dot dot-green" />
            </div>
            <div className="sidebar-stat">
              <span>HOME ASSISTANT</span>
              <span className={`dot ${haStatus === true ? 'dot-green' : haStatus === false ? 'dot-red' : 'dot-dim'}`}
                    title={haStatus === true ? 'Connected' : haStatus === false ? 'Not connected' : 'Checking...'} />
            </div>
            <div className="sidebar-stat" style={{ borderBottom: '1px solid var(--navy-800)', paddingBottom: '0.5rem' }}>
              <span>VOICE ENGINE</span>
              <span style={{ color: 'var(--amber-400)', fontSize: '0.65rem' }}>KOKORO</span>
            </div>
            {/* Feature 5: Wake word toggle */}
            <div style={{ marginTop: '0.75rem' }}>
              <button onClick={() => wakeWordEnabled ? stopWakeWord() : startWakeWord()}
                style={{ width: '100%', padding: '0.4rem', borderRadius: '6px', border: `1px solid ${wakeWordEnabled ? 'var(--amber-500)' : 'var(--navy-600)'}`,
                  background: wakeWordEnabled ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: wakeWordEnabled ? 'var(--amber-400)' : 'var(--text-dim)',
                  fontSize: '0.68rem', cursor: 'pointer', fontFamily: 'JetBrains Mono', letterSpacing: '0.5px' }}>
                {wakeWordEnabled ? '🎙 LISTENING — HEY SKY' : '🎙 ENABLE WAKE WORD'}
              </button>
            </div>
            {/* Feature 6: Active timers */}
            {activeTimers.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.35rem' }}>Active Timers</div>
                {activeTimers.map(t => (
                  <div key={t.job_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--navy-800)', borderRadius: '5px', padding: '0.3rem 0.5rem',
                    fontSize: '0.65rem', marginBottom: '0.25rem', border: '1px solid var(--navy-600)' }}>
                    <span style={{ color: 'var(--text-bright)' }}>{(t.args?.[0] || '').split('.')[1]?.replace(/_/g,' ') || t.args?.[0]}</span>
                    <span style={{ color: 'var(--amber-400)' }}>{t.run_at ? new Date(t.run_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '...'}</span>
                    <button onClick={async () => {
                      await fetch(`${API}/alerts/timers/${t.job_id}`, { method: 'DELETE' });
                      setActiveTimers(prev => prev.filter(x => x.job_id !== t.job_id));
                    }} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0 2px', fontSize: '0.65rem' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {/* Feature 7: Digest banner */}
            {digest && (
              <div style={{ marginTop: '0.75rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: '6px', padding: '0.5rem 0.6rem' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--amber-400)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.25rem' }}>Morning Briefing · {digest.date}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-bright)', lineHeight: '1.5' }}>{digest.text}</div>
                <button onClick={() => { if (digest.audio_b64) {
                  const bytes = Uint8Array.from(atob(digest.audio_b64), c => c.charCodeAt(0));
                  const blob = new Blob([bytes], { type: 'audio/wav' });
                  const url = URL.createObjectURL(blob);
                  const a = new Audio(url); a.play().catch(()=>{}); a.onended = () => URL.revokeObjectURL(url);
                } else { playTTS(digest.text); }}}
                  style={{ marginTop: '0.4rem', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-dim)',
                    fontSize: '0.6rem', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer' }}>▶ REPLAY</button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main View ── */}
        <div className="main-view" style={{ flexDirection: 'row' }}>

          {activeTab === 'dashboard' ? (
            <Dashboard api={API} />
          ) : activeTab === 'decisions' ? (
            /* Feature 3: Decision journal */
            <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono', letterSpacing: '1px' }}>DECISION JOURNAL</div>
                <button onClick={() => fetch(`${API}/digest/trigger`, { method: 'POST' }).then(r => r.json()).then(d => { if (d?.text) setDigest(d); })}
                  style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', color: 'var(--text-dim)', fontSize: '0.65rem', padding: '0.3rem 0.6rem', borderRadius: '5px', cursor: 'pointer' }}>↻ NEW DIGEST</button>
              </div>
              {decisions.length === 0 ? (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontStyle: 'italic' }}>No recommendations logged yet. Sky will log farm advice automatically as you chat.</div>
              ) : decisions.map((d, i) => (
                <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '8px', padding: '0.75rem', borderLeft: `3px solid ${d.outcome ? '#4ade80' : 'var(--amber-500)'}` }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.3rem' }}>{d.date?.slice(0,16)} {d.context ? `· ${d.context.slice(0,50)}` : ''}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-bright)', marginBottom: '0.4rem' }}>{d.recommendation}</div>
                  {d.outcome ? (
                    <div style={{ fontSize: '0.7rem', color: '#4ade80' }}>✓ Outcome: {d.outcome}</div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem' }}>
                      <input value={outcomeInput[i] || ''}
                        onChange={e => setOutcomeInput(prev => ({ ...prev, [i]: e.target.value }))}
                        placeholder="Log what happened..."
                        style={{ flex: 1, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', color: 'white',
                          padding: '0.3rem 0.5rem', borderRadius: '5px', fontSize: '0.7rem' }} />
                      <button onClick={async () => {
                        const outcome = outcomeInput[i];
                        if (!outcome?.trim()) return;
                        const realIdx = decisions.length - 1 - i;
                        await fetch(`${API}/memory/outcome`, { method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ index: realIdx, outcome }) });
                        setOutcomeInput(prev => ({ ...prev, [i]: '' }));
                        loadDecisions();
                      }} style={{ background: 'var(--navy-600)', border: 'none', color: 'var(--amber-400)',
                        padding: '0.3rem 0.6rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.7rem' }}>LOG</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : activeTab === 'memory' ? (
            <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono', letterSpacing: '1px' }}>SKY MEMORY</div>

              {/* Quick log */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input value={memNote} onChange={e => setMemNote(e.target.value)}
                  placeholder="Log a note, observation, or spray..."
                  style={{ flex: 1, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'white', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem' }} />
                <button onClick={async () => {
                  if (!memNote.trim()) return;
                  await fetch(`${API}/memory/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'note', data: memNote }) });
                  setMemNote('');
                  loadMemory();
                }} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', color: 'var(--amber-400)', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem' }}>LOG</button>
                <button onClick={async () => {
                  if (!confirm('Clear all memory?')) return;
                  await fetch(`${API}/memory`, { method: 'DELETE' });
                  loadMemory();
                }} style={{ background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-dim)', padding: '0.4rem 0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.7rem' }}>CLEAR</button>
              </div>

              {memory && (
                <>
                  {/* Spray log */}
                  {memory.spray_log?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Spray Log</div>
                      {[...memory.spray_log].reverse().map((s, i) => (
                        <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.3rem', fontSize: '0.75rem', borderLeft: '3px solid #60a5fa' }}>
                          <span style={{ color: 'var(--text-dim)' }}>{s.date?.slice(0,10)}</span> — {s.product || 'Unknown product'} {s.rate ? `@ ${s.rate}` : ''} {s.notes ? `· ${s.notes}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Observations */}
                  {memory.observations?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Observations</div>
                      {[...memory.observations].reverse().map((o, i) => (
                        <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.3rem', fontSize: '0.75rem', borderLeft: '3px solid #4ade80' }}>
                          <span style={{ color: 'var(--text-dim)' }}>{o.date?.slice(0,10)}</span> — {o.note}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {memory.notes?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Notes</div>
                      {[...memory.notes].reverse().map((n, i) => (
                        <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.3rem', fontSize: '0.75rem', borderLeft: '3px solid var(--amber-500)' }}>
                          {n}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Events/Alerts */}
                  {memory.events?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Events & Alerts</div>
                      {[...memory.events].reverse().slice(0, 20).map((e, i) => (
                        <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '0.3rem', fontSize: '0.72rem', borderLeft: `3px solid ${e.severity === 'critical' ? '#f87171' : e.severity === 'warning' ? '#fbbf24' : '#60a5fa'}` }}>
                          <span style={{ color: 'var(--text-dim)' }}>{e.date?.slice(0,16)}</span> — {e.type} {e.sensor ? `· ${e.sensor}` : ''} {e.state ? `→ ${e.state}` : ''}
                        </div>
                      ))}
                    </div>
                  )}

                  {(!memory.spray_log?.length && !memory.observations?.length && !memory.notes?.length && !memory.events?.length) && (
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontStyle: 'italic' }}>No memory yet. Log a spray, observation, or note above. Sky will remember it in future conversations.</div>
                  )}
                </>
              )}
            </div>
          ) : (
            <>
              {/* ── Chat panel ── */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: showCanvas ? '1px solid var(--navy-700)' : 'none' }}>
                <div className="chat-history">
                  {messages.length === 0 ? (
                    <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.4 }}>
                      <p>Awaiting your command...</p>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={i} className={`msg ${msg.role}`}>
                        <div className="msg-meta">{msg.role === 'user' ? 'YOU' : 'ASSISTANT'}</div>
                        <div className="bubble">
                          {msg.text || "..."}
                          {msg.role === 'bot' && msg.haResult && (
                            <div className={`ha-action ${msg.haResult.ok ? 'ok' : 'err'}`}>
                              {msg.haResult.ok ? '✓ Device command sent' : `✗ ${msg.haResult.error}`}
                            </div>
                          )}
                          {msg.role === 'bot' && msg.timerInfo && (
                            <div className="ha-action ok" style={{ borderColor: '#92400e', background: 'rgba(146,64,14,0.15)', color: '#fbbf24' }}>
                              ⏱ Auto-off in {msg.timerInfo.minutes}min — {msg.timerInfo.label}
                            </div>
                          )}
                          {msg.role === 'bot' && msg.isAlert && (
                            <div className={`ha-action ${msg.severity === 'critical' ? 'err' : 'ok'}`}>
                              {msg.severity === 'critical' ? '🚨' : '⚠'} {msg.severity || 'alert'}
                            </div>
                          )}
                          {msg.role === 'bot' && i < messages.length - 1 && (
                            <button className="tts-btn" onClick={() => playTTS(msg.text)}>
                              ▶ REPLAY AUDIO
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>

                <div className="input-zone">
                  <div className="orb-row">
                    <button
                      className={`orb-btn ${orbState}`}
                      onMouseDown={startListening}
                      onMouseUp={stopListening}
                      onTouchStart={startListening}
                      onTouchEnd={stopListening}
                    >
                      <div style={{ width: '30%', height: '30%', border: '2px solid white', borderRadius: '50%' }} />
                    </button>
                    <span style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: 'var(--navy-400)', fontWeight: 'bold' }}>
                      {orbState === 'listening' ? 'HOLD TO TRANSMIT' : 'READY TO RECEIVE'}
                    </span>
                    {micError && (
                      <span style={{ fontSize: '0.62rem', color: '#f87171', textAlign: 'center', maxWidth: '200px', marginTop: '0.25rem' }}>
                        ⚠ {micError}
                      </span>
                    )}
                  </div>
                  <div className="text-row">
                    <textarea
                      className="text-input"
                      rows={1}
                      placeholder="Enter command or manual query..."
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKey}
                      disabled={loading}
                    />
                    <button className="send-btn" onClick={() => sendText(input)} disabled={!input.trim() || loading}>
                      SEND
                    </button>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button
                      className="tts-btn"
                      onClick={() => setShowCanvas(v => !v)}
                      style={{ background: showCanvas ? 'rgba(245,158,11,0.15)' : '', borderColor: showCanvas ? 'var(--amber-500)' : '', color: showCanvas ? 'var(--amber-400)' : '' }}
                    >
                      ⬡ {showCanvas ? 'HIDE NODES' : 'SHOW NODES'}
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Node canvas panel (slide in alongside chat) ── */}
              {showCanvas && (
                <div style={{ width: '55%', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <NodeCanvas api={API} lastHaEvent={lastHaEvent} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
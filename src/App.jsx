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
  transition: width 0.25s ease;
  overflow: hidden; flex-shrink: 0;
}
.sidebar.collapsed {
  width: 52px;
}
.sidebar-toggle {
  background: transparent; border: none; color: var(--text-dim); cursor: pointer;
  font-size: 0.85rem; padding: 4px 6px; border-radius: 4px; transition: color 0.2s;
}
.sidebar-toggle:hover { color: var(--amber-400); }

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

/* ── Mobile Layout ── */
.mobile-container {
  display: flex; flex-direction: column; height: 100vh; width: 100vw;
  background: radial-gradient(circle at 50% 50%, var(--navy-900) 0%, var(--navy-950) 100%);
  overflow: hidden;
}
.mobile-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--navy-700);
  background: rgba(11, 21, 38, 0.8); backdrop-filter: blur(10px);
  flex-shrink: 0; min-height: 50px;
}
.mobile-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.mobile-chat {
  flex: 1; overflow-y: auto; padding: 1rem;
  display: flex; flex-direction: column; gap: 1rem;
}
.mobile-msg { max-width: 88%; line-height: 1.5; font-size: 0.88rem; }
.mobile-msg.user { align-self: flex-end; color: var(--amber-400); text-align: right; }
.mobile-msg.bot { align-self: flex-start; color: var(--text-bright); }
.mobile-input-zone {
  padding: 0.75rem 1rem; border-top: 1px solid var(--navy-700);
  background: rgba(6, 13, 26, 0.9); backdrop-filter: blur(10px); flex-shrink: 0;
}
.mobile-orb {
  width: 72px; height: 72px; border-radius: 50%; border: none;
  cursor: pointer; position: relative; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  display: flex; align-items: center; justify-content: center; touch-action: none;
}
.mobile-orb.idle { background: var(--navy-700); box-shadow: 0 0 0 3px var(--navy-800); }
.mobile-orb.listening { background: var(--amber-500); box-shadow: 0 0 25px var(--amber-500); transform: scale(1.15); }
.mobile-orb.thinking { background: var(--navy-400); animation: pulse 1.5s infinite; }
.mobile-orb.wake { background: var(--navy-600); box-shadow: 0 0 12px var(--navy-400); }
.mobile-text-row {
  display: flex; gap: 0.5rem; background: var(--navy-800); padding: 0.4rem;
  border-radius: 10px; border: 1px solid var(--navy-700); margin-top: 0.6rem;
}
.mobile-text-input {
  flex: 1; background: transparent; border: none; color: white;
  resize: none; outline: none; padding: 0.5rem; font-family: inherit; font-size: 0.9rem;
}
.mobile-send {
  background: var(--amber-500); border: none; color: #0b1526; cursor: pointer;
  padding: 0.5rem 1rem; border-radius: 8px; font-weight: 600; font-size: 0.8rem;
}
.mobile-tab-bar {
  display: flex; border-top: 1px solid var(--navy-700);
  background: rgba(6, 13, 26, 0.95); backdrop-filter: blur(10px);
  flex-shrink: 0; padding-bottom: env(safe-area-inset-bottom, 0);
}
.mobile-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  padding: 0.5rem 0; background: none; border: none; cursor: pointer;
  color: var(--text-dim); font-size: 0.55rem; font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.5px; text-transform: uppercase; gap: 2px;
  transition: color 0.15s;
}
.mobile-tab .mtab-icon { font-size: 1.2rem; }
.mobile-tab.active { color: var(--amber-400); }
.mobile-status-dots {
  display: flex; gap: 4px; align-items: center;
}
.mobile-status-dots .dot { width: 6px; height: 6px; }
.mobile-section-scroll {
  flex: 1; overflow-y: auto; padding: 1rem;
  display: flex; flex-direction: column; gap: 1rem;
}
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

// ── Mobile detection hook ─────────────────────────────────────────────────────
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && (window.innerWidth <= breakpoint || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))
  );
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= breakpoint || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return isMobile;
}

export default function App() {
  const sessionId = useMemo(() => getOrCreateSessionId(), []);
  const isMobile = useIsMobile();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [orbState, setOrbState] = useState("idle"); // idle, listening, thinking, wake
  const [isRecording, setIsRecording] = useState(false);
  const [haStatus, setHaStatus] = useState(null); // null | true | false
  const [activeTab, setActiveTab] = useState("chat"); // chat | dashboard | memory | decisions
  const [showCanvas, setShowCanvas] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lastHaEvent, setLastHaEvent] = useState(null);
  const [micError, setMicError] = useState(null);
  const [memory, setMemory] = useState(null);
  const [memNote, setMemNote] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [memRawMode, setMemRawMode] = useState(false);
  const [memRawJson, setMemRawJson] = useState("");
  const [memLlmPreview, setMemLlmPreview] = useState(null);
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

  // Global audio serialization — chain all playback so nothing overlaps
  const audioChainRef = useRef(Promise.resolve());
  // Persistent Audio element for iOS Safari compatibility (autoplay policy)
  const audioElRef = useRef(null);
  const audioUnlockedRef = useRef(false);

  const abortRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const bottomRef = useRef(null);

  // Stop/interrupt: cancel fetch + stop audio + reset state
  const stopAll = useCallback(() => {
    // Abort any in-flight chat request
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    // Stop audio playback
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.currentTime = 0; }
    // Reset the audio chain so future playback isn't blocked
    audioChainRef.current = Promise.resolve();
    // Stop recording if active
    if (mediaRecorderRef.current && isRecording) {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
      setIsRecording(false);
    }
    setLoading(false);
    setOrbState("idle");
    console.log("[stop] Interrupted");
  }, [isRecording]);

  // iOS audio unlock: create a single Audio element and "prime" it on first user gesture
  useEffect(() => {
    const el = new Audio();
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    audioElRef.current = el;

    const unlock = () => {
      if (audioUnlockedRef.current) return;
      // Play a silent data URI to unlock the audio element
      el.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      el.play().then(() => {
        audioUnlockedRef.current = true;
        console.log("[audio] iOS audio unlocked");
      }).catch(() => {});
    };
    document.addEventListener("touchstart", unlock, { once: false });
    document.addEventListener("click", unlock, { once: false });
    return () => {
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("click", unlock);
    };
  }, []);

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
          // Show in chat (silent — no auto-TTS)
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

      recorder.ondataavailable = (e) => { console.log("[mic] Data chunk:", e.data.size, "bytes"); audioChunksRef.current.push(e.data); };
      recorder.onstop = handleAudioStop;

      recorder.start();
      setIsRecording(true);
      setOrbState("listening");
      console.log("[mic] Recording started");
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
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      console.log("[mic] Stopping recorder");
      recorder.stop();
      // Stop all tracks so mic indicator goes away
      recorder.stream?.getTracks().forEach(t => t.stop());
      setIsRecording(false);
      setOrbState("thinking");
    } else {
      console.log("[mic] stopListening called but recorder state:", recorder?.state, "isRecording:", isRecording);
    }
  };

  const handleAudioStop = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    console.log("[mic] handleAudioStop — blob size:", audioBlob.size, "chunks:", audioChunksRef.current.length);
    if (audioBlob.size === 0) {
      console.warn("[mic] Empty audio blob, skipping transcription");
      setOrbState("idle");
      return;
    }
    const formData = new FormData();
    formData.append("audio", audioBlob, "user_speech.webm");

    try {
      const res = await fetch(`${API}/transcribe`, { method: "POST", body: formData });
      const data = await res.json();
      console.log("[mic] Transcription result:", data);
      if (data.text?.trim()) {
        sendText(data.text);
      } else {
        console.log("[mic] Empty transcription, returning to idle");
        setOrbState("idle");
      }
    } catch (err) {
      console.error("[mic] Transcription failed", err);
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

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId, deep_think: deepThink }),
        signal: controller.signal,
      });
      const data = await res.json();
      const reply = data.reply || "";

      // Build bot message with all metadata
      const botMsg = { role: "bot", text: reply };
      if (data.ha_result) {
        botMsg.haResult = data.ha_result;
        setLastHaEvent({ ...data.ha_result, entity_id: data.entity_id || "" });
      }
      if (data.timer) {
        const t = data.timer;
        const label = t.entity_id?.split(".")[1]?.replace(/_/g, " ") || t.entity_id;
        botMsg.timerInfo = { ...t, label };
        fetch(`${API}/alerts/timers`).then(r => r.json()).then(d => setActiveTimers(d.timers || [])).catch(() => {});
        // Pulse canvas node for timer entity even if ha_result was empty
        if (!data.ha_result && data.entity_id) {
          setLastHaEvent({ ok: true, entity_id: data.entity_id });
        }
      }

      setMessages(prev => [...prev, botMsg]);

      // Speak once, wait for it to finish
      if (reply.trim()) await playTTS(reply);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("[chat] Request aborted by user");
      } else {
        console.error("Chat failed", err);
        setMessages(prev => [...prev, { role: "bot", text: "[Error contacting server]" }]);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setOrbState("idle");
    }
  };

  // Play a blob URL and return a promise that resolves when audio finishes
  // Uses persistent Audio element for iOS Safari compatibility
  const _playUrl = (url) => new Promise((resolve) => {
    const el = audioElRef.current;
    if (!el) {
      // Fallback: create new Audio if ref somehow missing
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      audio.play().catch(() => resolve());
      return;
    }
    el.onended = () => { URL.revokeObjectURL(url); el.onended = null; el.onerror = null; resolve(); };
    el.onerror = () => { URL.revokeObjectURL(url); el.onended = null; el.onerror = null; resolve(); };
    el.src = url;
    el.play().catch((err) => {
      console.warn("[audio] play() rejected:", err.message);
      URL.revokeObjectURL(url);
      resolve();
    });
  });

  // Speak text via /tts_audio — serialized so nothing overlaps
  const playTTS = (text) => {
    const job = audioChainRef.current.then(async () => {
      try {
        const res = await fetch(`${API}/tts_audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await _playUrl(url);
      } catch (err) {
        console.error("TTS playback error", err);
      }
    });
    audioChainRef.current = job;
    return job;
  };

  // Play raw base64 audio — also serialized
  const playAudioB64 = (b64, mime = "audio/wav") => {
    const job = audioChainRef.current.then(async () => {
      try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        await _playUrl(url);
      } catch (err) {
        console.error("Audio playback error", err);
      }
    });
    audioChainRef.current = job;
    return job;
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendText(input);
    }
  };

  // ── Mobile Layout ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <>
        <style>{styles}</style>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <div className="mobile-container">
          {/* ── Header ── */}
          <div className="mobile-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--amber-400)', letterSpacing: '2px' }}>SKY</span>
              <div className="mobile-status-dots">
                <span className={`dot ${haStatus === true ? 'dot-green' : haStatus === false ? 'dot-red' : 'dot-dim'}`} title="HA" />
                <span className="dot dot-green" title="LLM" />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {activeTimers.length > 0 && (
                <span style={{ fontSize: '0.6rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono' }}>
                  ⏱ {activeTimers.length}
                </span>
              )}
              <div className={`status-badge ${orbState !== 'idle' ? 'active' : ''}`} style={{ fontSize: '0.6rem' }}>{orbState}</div>
            </div>
          </div>

          {/* ── Body (tab content) ── */}
          <div className="mobile-body">
            {activeTab === 'chat' ? (
              <>
                {/* Chat messages */}
                <div className="mobile-chat">
                  {messages.length === 0 ? (
                    <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.4 }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🌾</div>
                      <p style={{ fontSize: '0.85rem' }}>Tap the orb or type to talk to Sky</p>
                    </div>
                  ) : (
                    messages.map((msg, i) => (
                      <div key={i} className={`mobile-msg ${msg.role}`}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--navy-400)', marginBottom: '2px', fontFamily: 'JetBrains Mono' }}>
                          {msg.role === 'user' ? 'YOU' : 'SKY'}
                        </div>
                        <div>{msg.text || "..."}</div>
                        {msg.role === 'bot' && msg.haResult && (
                          <div className={`ha-action ${msg.haResult.ok ? 'ok' : 'err'}`} style={{ marginTop: '0.4rem' }}>
                            {msg.haResult.ok ? '✓ Command sent' : `✗ ${msg.haResult.error}`}
                          </div>
                        )}
                        {msg.role === 'bot' && msg.timerInfo && (
                          <div className="ha-action ok" style={{ borderColor: '#92400e', background: 'rgba(146,64,14,0.15)', color: '#fbbf24', marginTop: '0.4rem' }}>
                            ⏱ Auto-off {msg.timerInfo.minutes}min — {msg.timerInfo.label}
                          </div>
                        )}
                        {msg.role === 'bot' && msg.isAlert && (
                          <div className={`ha-action ${msg.severity === 'critical' ? 'err' : 'ok'}`} style={{ marginTop: '0.4rem' }}>
                            {msg.severity === 'critical' ? '🚨' : '⚠'} {msg.severity || 'alert'}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Input zone */}
                <div className="mobile-input-zone">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                      className={`mobile-orb ${orbState}`}
                      {...(loading || orbState === 'thinking'
                        ? { onClick: (e) => { e.preventDefault(); stopAll(); } }
                        : { onTouchStart: (e) => { e.preventDefault(); startListening(); }, onTouchEnd: (e) => { e.preventDefault(); stopListening(); }, onMouseDown: startListening, onMouseUp: stopListening }
                      )}
                    >
                      {loading || orbState === 'thinking' ? (
                        <div style={{ width: '24%', height: '24%', background: 'white', borderRadius: '3px' }} />
                      ) : (
                        <div style={{ width: '28%', height: '28%', border: '2px solid white', borderRadius: '50%' }} />
                      )}
                    </button>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.6rem', color: loading ? '#f87171' : 'var(--navy-400)', fontFamily: 'JetBrains Mono', fontWeight: 'bold' }}>
                        {loading || orbState === 'thinking' ? 'TAP ■ TO STOP' : orbState === 'listening' ? 'LISTENING...' : 'HOLD ORB TO SPEAK'}
                      </span>
                      <div className="mobile-text-row">
                        <textarea
                          className="mobile-text-input"
                          rows={1}
                          placeholder="Type a command..."
                          value={input}
                          onChange={e => setInput(e.target.value)}
                          onKeyDown={handleKey}
                          disabled={loading}
                        />
                        <button className="mobile-send" onClick={() => sendText(input)} disabled={!input.trim() || loading}>
                          ▶
                        </button>
                      </div>
                    </div>
                  </div>
                  {micError && (
                    <div style={{ fontSize: '0.6rem', color: '#f87171', marginTop: '0.3rem', textAlign: 'center' }}>⚠ {micError}</div>
                  )}
                </div>
              </>
            ) : activeTab === 'dashboard' ? (
              <div className="mobile-section-scroll">
                <Dashboard api={API} />
              </div>
            ) : activeTab === 'memory' ? (
              <div className="mobile-section-scroll">
                <div style={{ fontSize: '0.75rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono', letterSpacing: '1px', marginBottom: '0.5rem' }}>SKY MEMORY</div>
                {/* Quick log */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input value={memNote} onChange={e => setMemNote(e.target.value)}
                    placeholder="Log a note..."
                    onKeyDown={e => { if (e.key === 'Enter' && memNote.trim()) { e.target.blur(); document.querySelector('[data-mem-log-m]')?.click(); } }}
                    style={{ flex: 1, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'white', padding: '0.5rem', borderRadius: '8px', fontSize: '0.85rem' }} />
                  <button data-mem-log-m onClick={async () => {
                    if (!memNote.trim()) return;
                    await fetch(`${API}/memory/log`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type: 'note', data: memNote }) });
                    setMemNote('');
                    loadMemory();
                  }} style={{ background: 'var(--amber-500)', border: 'none', color: '#0b1526', padding: '0.5rem 0.8rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.8rem' }}>LOG</button>
                </div>

                {memory && (
                  <>
                    {memory.spray_log?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Spray Log</div>
                        {[...memory.spray_log].reverse().map((s, i) => (
                          <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '8px', padding: '0.5rem 0.6rem', fontSize: '0.78rem', borderLeft: '3px solid #60a5fa', marginBottom: '0.3rem' }}>
                            <span style={{ color: 'var(--text-dim)' }}>{s.date?.slice(0,10)}</span> — {s.product || 'Unknown'} {s.rate ? `@ ${s.rate}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {memory.observations?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Observations</div>
                        {[...memory.observations].reverse().map((o, i) => (
                          <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '8px', padding: '0.5rem 0.6rem', fontSize: '0.78rem', borderLeft: '3px solid #4ade80', marginBottom: '0.3rem' }}>
                            <span style={{ color: 'var(--text-dim)' }}>{o.date?.slice(0,10)}</span> — {o.note}
                          </div>
                        ))}
                      </div>
                    )}
                    {memory.notes?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Notes</div>
                        {[...memory.notes].reverse().map((n, i) => (
                          <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '8px', padding: '0.5rem 0.6rem', fontSize: '0.78rem', borderLeft: '3px solid var(--amber-500)', marginBottom: '0.3rem' }}>
                            {n}
                          </div>
                        ))}
                      </div>
                    )}
                    {memory.events?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Events</div>
                        {[...memory.events].reverse().slice(0, 15).map((e, i) => (
                          <div key={i} style={{ background: 'var(--navy-800)', borderRadius: '8px', padding: '0.5rem 0.6rem', fontSize: '0.75rem', borderLeft: `3px solid ${e.severity === 'critical' ? '#f87171' : e.severity === 'warning' ? '#fbbf24' : '#60a5fa'}`, marginBottom: '0.3rem' }}>
                            <span style={{ color: 'var(--text-dim)' }}>{e.date?.slice(0,16)}</span> — {e.type}
                          </div>
                        ))}
                      </div>
                    )}
                    {(!memory.spray_log?.length && !memory.observations?.length && !memory.notes?.length && !memory.events?.length) && (
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', fontStyle: 'italic' }}>No memory yet. Log a note above or chat with Sky.</div>
                    )}
                  </>
                )}
              </div>
            ) : activeTab === 'devices' ? (
              <div className="mobile-section-scroll">
                <div style={{ fontSize: '0.75rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono', letterSpacing: '1px', marginBottom: '0.5rem' }}>FARM DEVICES</div>
                {/* Active timers */}
                {activeTimers.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Active Timers</div>
                    {activeTimers.map(t => {
                      const tid = t.timer_id || t.job_id;
                      const label = t.entity_id
                        ? t.entity_id.split('.')[1]?.replace(/_/g, ' ')
                        : (t.args?.[0] || '').split('.')[1]?.replace(/_/g, ' ') || tid;
                      const timeInfo = t.remaining || (t.run_at ? new Date(t.run_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '...');
                      return (
                        <div key={tid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          background: 'var(--navy-800)', borderRadius: '8px', padding: '0.5rem 0.6rem',
                          fontSize: '0.75rem', marginBottom: '0.3rem', border: '1px solid var(--navy-600)' }}>
                          <span style={{ color: 'var(--text-bright)' }}>{label}</span>
                          <span style={{ color: 'var(--amber-400)' }}>{timeInfo}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Wake word + Deep think toggles */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <button onClick={() => wakeWordEnabled ? stopWakeWord() : startWakeWord()}
                    style={{ flex: 1, padding: '0.6rem', borderRadius: '8px',
                      border: `1px solid ${wakeWordEnabled ? 'var(--amber-500)' : 'var(--navy-600)'}`,
                      background: wakeWordEnabled ? 'rgba(245,158,11,0.12)' : 'var(--navy-800)',
                      color: wakeWordEnabled ? 'var(--amber-400)' : 'var(--text-dim)',
                      fontSize: '0.7rem', fontFamily: 'JetBrains Mono' }}>
                    {wakeWordEnabled ? '🎙 HEY SKY ON' : '🎙 WAKE WORD'}
                  </button>
                  <button onClick={() => setDeepThink(p => !p)}
                    style={{ flex: 1, padding: '0.6rem', borderRadius: '8px',
                      border: `1px solid ${deepThink ? '#a855f7' : 'var(--navy-600)'}`,
                      background: deepThink ? 'rgba(168,85,247,0.15)' : 'var(--navy-800)',
                      color: deepThink ? '#a855f7' : 'var(--text-dim)',
                      fontSize: '0.7rem', fontFamily: 'JetBrains Mono' }}>
                    {deepThink ? '🧠 DEEP THINK' : '⚡ FAST MODE'}
                  </button>
                </div>
                {/* Digest */}
                {digest && (
                  <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: '8px', padding: '0.6rem', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.6rem', color: 'var(--amber-400)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>Morning Briefing</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-bright)', lineHeight: '1.5' }}>{digest.text}</div>
                    <button onClick={() => { if (digest.audio_b64) playAudioB64(digest.audio_b64); else playTTS(digest.text); }}
                      style={{ marginTop: '0.4rem', background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-dim)',
                        fontSize: '0.65rem', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer' }}>▶ REPLAY</button>
                  </div>
                )}
                {/* System status */}
                <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.3rem' }}>System Status</div>
                {[
                  { name: 'Home Assistant', ok: haStatus === true },
                  { name: 'LLM (Ollama)', ok: true },
                  { name: 'Whisper STT', ok: true },
                  { name: 'Kokoro TTS', ok: true },
                ].map(s => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.4rem 0', borderBottom: '1px solid var(--navy-800)', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-dim)' }}>{s.name}</span>
                    <span className={`dot ${s.ok ? 'dot-green' : 'dot-red'}`} />
                  </div>
                ))}
                <a href="http://192.168.254.131:8123" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', textAlign: 'center', marginTop: '0.75rem', padding: '0.6rem', borderRadius: '8px',
                    border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.08)',
                    color: '#60a5fa', fontSize: '0.75rem', fontFamily: 'JetBrains Mono',
                    textDecoration: 'none' }}>
                  🏠 Open HA Dashboard
                </a>
              </div>
            ) : null}
          </div>

          {/* ── Bottom Tab Bar ── */}
          <div className="mobile-tab-bar">
            <button className={`mobile-tab${activeTab === 'chat' ? ' active' : ''}`} onClick={() => setActiveTab('chat')}>
              <span className="mtab-icon">💬</span>Chat
            </button>
            <button className={`mobile-tab${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              <span className="mtab-icon">📊</span>Farm
            </button>
            <button className={`mobile-tab${activeTab === 'memory' ? ' active' : ''}`} onClick={() => { setActiveTab('memory'); loadMemory(); }}>
              <span className="mtab-icon">🧠</span>Memory
            </button>
            <button className={`mobile-tab${activeTab === 'devices' ? ' active' : ''}`} onClick={() => setActiveTab('devices')}>
              <span className="mtab-icon">⚙</span>Devices
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── Desktop Layout ──────────────────────────────────────────────────────────
  return (
    <>
      <style>{styles}</style>
      <div className="app-container">
        
        {/* ── Sidebar ── */}
        <aside className={`sidebar${sidebarCollapsed ? ' collapsed' : ''}`}>
          <div className="header" style={{ borderBottom: '1px solid var(--navy-700)', padding: sidebarCollapsed ? '1rem 0.5rem' : '1.5rem', justifyContent: sidebarCollapsed ? 'center' : 'space-between' }}>
            {sidebarCollapsed ? (
              <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(false)} title="Expand sidebar">▶</button>
            ) : (
              <>
                <h2 style={{ fontSize: '0.9rem', letterSpacing: '1px', color: 'var(--amber-400)' }}>SMART SPEAKER</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className={`status-badge ${orbState !== 'idle' ? 'active' : ''}`}>{orbState}</div>
                  <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(true)} title="Collapse sidebar">◀</button>
                </div>
              </>
            )}
          </div>
          <div className="tab-nav" style={{ flexDirection: sidebarCollapsed ? 'column' : 'row' }}>
            <button className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`} onClick={() => setActiveTab('chat')}>💬</button>
            <button className={`tab-btn${activeTab === 'dashboard' ? ' active' : ''}`} onClick={() => setActiveTab('dashboard')}>⊞</button>
            <button className={`tab-btn${activeTab === 'memory' ? ' active' : ''}`} onClick={() => { setActiveTab('memory'); loadMemory(); }}>🧠</button>
            <button className={`tab-btn${activeTab === 'decisions' ? ' active' : ''}`} onClick={() => { setActiveTab('decisions'); loadDecisions(); }}>📋</button>
          </div>
          <div style={{ padding: '1.5rem', display: sidebarCollapsed ? 'none' : 'block' }}>
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
            <a href="http://192.168.254.131:8123" target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', textAlign: 'center', marginTop: '0.5rem', padding: '0.35rem', borderRadius: '6px',
                border: '1px solid var(--navy-600)', background: 'rgba(59,130,246,0.08)',
                color: '#60a5fa', fontSize: '0.65rem', fontFamily: 'JetBrains Mono', letterSpacing: '0.5px',
                textDecoration: 'none', cursor: 'pointer' }}>
              🏠 HA DASHBOARD
            </a>
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
                {activeTimers.map(t => {
                  const tid = t.timer_id || t.job_id;
                  const label = t.entity_id
                    ? t.entity_id.split('.')[1]?.replace(/_/g, ' ')
                    : (t.args?.[0] || '').split('.')[1]?.replace(/_/g, ' ') || tid;
                  const timeInfo = t.remaining || (t.run_at ? new Date(t.run_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '...');
                  return (
                    <div key={tid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--navy-800)', borderRadius: '5px', padding: '0.3rem 0.5rem',
                      fontSize: '0.65rem', marginBottom: '0.25rem', border: '1px solid var(--navy-600)' }}>
                      <span style={{ color: 'var(--text-bright)' }}>{label}</span>
                      <span style={{ color: 'var(--amber-400)' }}>{timeInfo}</span>
                      <button onClick={async () => {
                        await fetch(`${API}/alerts/timers/${encodeURIComponent(tid)}`, { method: 'DELETE' });
                        setActiveTimers(prev => prev.filter(x => (x.timer_id || x.job_id) !== tid));
                      }} style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0 2px', fontSize: '0.65rem' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Feature 7: Digest banner */}
            {digest && (
              <div style={{ marginTop: '0.75rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: '6px', padding: '0.5rem 0.6rem' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--amber-400)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.25rem' }}>Morning Briefing · {digest.date}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-bright)', lineHeight: '1.5' }}>{digest.text}</div>
                <button onClick={() => { if (digest.audio_b64) {
                  playAudioB64(digest.audio_b64);
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--amber-400)', fontFamily: 'JetBrains Mono', letterSpacing: '1px' }}>SKY MEMORY</div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button onClick={() => {
                    setMemRawMode(false); setMemLlmPreview(null);
                  }} style={{ background: !memRawMode && !memLlmPreview ? 'var(--navy-600)' : 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-bright)', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>ENTRIES</button>
                  <button onClick={() => {
                    setMemRawMode(true); setMemLlmPreview(null);
                    setMemRawJson(JSON.stringify(memory, null, 2));
                  }} style={{ background: memRawMode ? 'var(--navy-600)' : 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-bright)', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>RAW JSON</button>
                  <button onClick={async () => {
                    setMemRawMode(false);
                    const r = await fetch(`${API}/memory/llm-preview`);
                    const d = await r.json();
                    setMemLlmPreview(d.llm_context);
                  }} style={{ background: memLlmPreview ? 'var(--navy-600)' : 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-bright)', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.6rem' }}>LLM VIEW</button>
                </div>
              </div>

              {/* Quick log */}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input value={memNote} onChange={e => setMemNote(e.target.value)}
                  placeholder="Log a note, observation, or spray..."
                  onKeyDown={e => { if (e.key === 'Enter' && memNote.trim()) { e.target.blur(); document.querySelector('[data-mem-log]')?.click(); } }}
                  style={{ flex: 1, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'white', padding: '0.4rem 0.6rem', borderRadius: '6px', fontSize: '0.8rem' }} />
                <button data-mem-log onClick={async () => {
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

              {/* LLM Preview mode */}
              {memLlmPreview && (
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '6px', padding: '0.75rem' }}>
                  <div style={{ fontSize: '0.6rem', color: 'var(--amber-400)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.5rem' }}>What Sky Sees In Her Prompt</div>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.7rem', color: 'var(--text-bright)', fontFamily: 'JetBrains Mono', lineHeight: '1.5', margin: 0 }}>{memLlmPreview}</pre>
                </div>
              )}

              {/* Raw JSON editor mode */}
              {memRawMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <textarea value={memRawJson} onChange={e => setMemRawJson(e.target.value)}
                    style={{ width: '100%', minHeight: '400px', background: 'var(--navy-800)', border: '1px solid var(--navy-600)', color: 'var(--text-bright)', padding: '0.6rem', borderRadius: '6px', fontSize: '0.7rem', fontFamily: 'JetBrains Mono', lineHeight: '1.4', resize: 'vertical' }} />
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setMemRawMode(false); }} style={{ background: 'transparent', border: '1px solid var(--navy-600)', color: 'var(--text-dim)', padding: '0.3rem 0.8rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.7rem' }}>CANCEL</button>
                    <button onClick={async () => {
                      try {
                        const parsed = JSON.parse(memRawJson);
                        await fetch(`${API}/memory`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
                        setMemRawMode(false);
                        loadMemory();
                      } catch (e) { alert('Invalid JSON: ' + e.message); }
                    }} style={{ background: 'var(--amber-400)', border: 'none', color: '#000', padding: '0.3rem 0.8rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>SAVE</button>
                  </div>
                </div>
              )}

              {/* Entry-by-entry view */}
              {!memRawMode && !memLlmPreview && memory && (
                <>
                  {/* Spray log */}
                  {memory.spray_log?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Spray Log</div>
                      {[...memory.spray_log].reverse().map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <div style={{ flex: 1, background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', borderLeft: '3px solid #60a5fa' }}>
                            <span style={{ color: 'var(--text-dim)' }}>{s.date?.slice(0,10)}</span> — {s.product || 'Unknown product'} {s.rate ? `@ ${s.rate}` : ''} {s.notes ? `· ${s.notes}` : ''}
                          </div>
                          <button onClick={async () => { await fetch(`${API}/memory/spray_log/${i}`, { method: 'DELETE' }); loadMemory(); }}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Observations */}
                  {memory.observations?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Observations</div>
                      {[...memory.observations].reverse().map((o, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <div style={{ flex: 1, background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', borderLeft: '3px solid #4ade80' }}>
                            <span style={{ color: 'var(--text-dim)' }}>{o.date?.slice(0,10)}</span> — {o.note}
                          </div>
                          <button onClick={async () => { await fetch(`${API}/memory/observations/${i}`, { method: 'DELETE' }); loadMemory(); }}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes */}
                  {memory.notes?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Notes</div>
                      {[...memory.notes].reverse().map((n, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <div style={{ flex: 1, background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.75rem', borderLeft: '3px solid var(--amber-500)' }}>
                            {n}
                          </div>
                          <button onClick={async () => { await fetch(`${API}/memory/notes/${i}`, { method: 'DELETE' }); loadMemory(); }}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Events/Alerts */}
                  {memory.events?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Events & Alerts</div>
                      {[...memory.events].reverse().slice(0, 20).map((e, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <div style={{ flex: 1, background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.72rem', borderLeft: `3px solid ${e.severity === 'critical' ? '#f87171' : e.severity === 'warning' ? '#fbbf24' : '#60a5fa'}` }}>
                            <span style={{ color: 'var(--text-dim)' }}>{e.date?.slice(0,16)}</span> — {e.type} {e.sensor ? `· ${e.sensor}` : ''} {e.state ? `→ ${e.state}` : ''}
                          </div>
                          <button onClick={async () => { await fetch(`${API}/memory/events/${i}`, { method: 'DELETE' }); loadMemory(); }}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Decisions */}
                  {memory.decisions?.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Decisions</div>
                      {[...memory.decisions].reverse().slice(0, 20).map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                          <div style={{ flex: 1, background: 'var(--navy-800)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.72rem', borderLeft: `3px solid ${d.outcome ? '#4ade80' : '#a78bfa'}` }}>
                            <span style={{ color: 'var(--text-dim)' }}>{d.date?.slice(0,10)}</span> — {d.recommendation} {d.outcome ? `→ ${d.outcome}` : ' (pending)'}
                          </div>
                          <button onClick={async () => { await fetch(`${API}/memory/decisions/${i}`, { method: 'DELETE' }); loadMemory(); }}
                            style={{ background: 'transparent', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {(!memory.spray_log?.length && !memory.observations?.length && !memory.notes?.length && !memory.events?.length && !memory.decisions?.length) && (
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
                      {...(loading || orbState === 'thinking'
                        ? { onClick: stopAll }
                        : { onMouseDown: startListening, onMouseUp: stopListening, onTouchStart: startListening, onTouchEnd: stopListening }
                      )}
                    >
                      {loading || orbState === 'thinking' ? (
                        <div style={{ width: '26%', height: '26%', background: 'white', borderRadius: '3px' }} />
                      ) : (
                        <div style={{ width: '30%', height: '30%', border: '2px solid white', borderRadius: '50%' }} />
                      )}
                    </button>
                    <span style={{ fontSize: '0.65rem', marginTop: '0.5rem', color: 'var(--navy-400)', fontWeight: 'bold' }}>
                      {loading || orbState === 'thinking' ? 'TAP TO STOP' : orbState === 'listening' ? 'HOLD TO TRANSMIT' : 'READY TO RECEIVE'}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.4rem', paddingLeft: '0.25rem' }}>
                    <button onClick={() => setDeepThink(p => !p)}
                      style={{ background: deepThink ? 'rgba(168,85,247,0.15)' : 'transparent',
                        border: `1px solid ${deepThink ? '#a855f7' : 'var(--navy-600)'}`,
                        color: deepThink ? '#a855f7' : 'var(--text-dim)',
                        padding: '0.2rem 0.6rem', borderRadius: '4px', cursor: 'pointer',
                        fontSize: '0.6rem', fontFamily: 'JetBrains Mono', letterSpacing: '0.5px',
                        transition: 'all 0.2s' }}>
                      {deepThink ? '🧠 DEEP THINK ON' : '⚡ FAST MODE'}
                    </button>
                    {deepThink && <span style={{ fontSize: '0.55rem', color: '#a855f7', fontStyle: 'italic' }}>Extended reasoning enabled — responses may take longer</span>}
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
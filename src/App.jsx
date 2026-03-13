import { useState, useRef, useEffect, useCallback } from "react";
import NodeCanvas from "./NodeCanvas";

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

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [orbState, setOrbState] = useState("idle"); // idle, listening, thinking
  const [isRecording, setIsRecording] = useState(false);
  const [haStatus, setHaStatus] = useState(null); // null | true | false
  const [activeTab, setActiveTab] = useState("chat"); // chat | canvas

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

  // ── Speech Recognition / Audio Recording ───────────────────────────────────
  const startListening = async () => {
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
      console.error("Mic access denied", err);
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
        body: JSON.stringify({ message: text }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let botText = "";
      
      // Add initial empty bot message
      setMessages(prev => [...prev, { role: "bot", text: "", sources: [] }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");
        
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.replace("data: ", ""));
            if (data.token) {
              botText += data.token;
              updateLastBotMessage(botText, null, null);
            } else if (data.event === "ha_result") {
              updateLastBotMessage(null, null, data.result);
            } else if (data.event === "rag") {
              updateLastBotMessage(null, data.sources, null);
            } else if (data.done) {
              playTTS(data.full);
            }
          } catch (e) { /* partial chunk */ }
        }
      }
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
            <button className={`tab-btn${activeTab === 'chat' ? ' active' : ''}`} onClick={() => setActiveTab('chat')}>💬 Chat</button>
            <button className={`tab-btn${activeTab === 'canvas' ? ' active' : ''}`} onClick={() => setActiveTab('canvas')}>⬡ Nodes</button>
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
            <div className="sidebar-stat" style={{ border: 'none', marginTop: '0.5rem' }}>
              <span>VOICE ENGINE</span>
              <span style={{ color: 'var(--amber-400)', fontSize: '0.65rem' }}>PIPER</span>
            </div>
          </div>
        </aside>

        {/* ── Main View ── */}
        <div className="main-view">
          {activeTab === 'canvas' ? (
            <NodeCanvas />
          ) : (
            <>
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
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
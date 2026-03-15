import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CAT_COLORS = {
  irrigation: { bg: "rgba(14,165,233,0.12)", border: "#0ea5e9", text: "#38bdf8", icon: "🌊" },
  lighting:   { bg: "rgba(245,158,11,0.12)", border: "#f59e0b", text: "#fbbf24", icon: "💡" },
  alert:      { bg: "rgba(251,191,36,0.12)", border: "#fbbf24", text: "#fde68a", icon: "⚠" },
};

const DAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const DAYS_KEY   = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const schedulerStyles = `
.scheduler { display: flex; flex-direction: column; height: 100%; font-family: 'JetBrains Mono', monospace; }
.sched-header { padding: 0.75rem 1rem; border-bottom: 1px solid var(--navy-700); display: flex; justify-content: space-between; align-items: center; }
.sched-header h3 { font-size: 0.7rem; color: var(--amber-400); letter-spacing: 1px; margin: 0; }
.sched-view-toggle { display: flex; gap: 0.25rem; }
.sched-view-toggle button {
  padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.55rem;
  font-family: 'JetBrains Mono', monospace; letter-spacing: 0.5px;
  border: 1px solid var(--navy-600); background: transparent;
  color: var(--text-dim); cursor: pointer; transition: all 0.15s;
}
.sched-view-toggle button.active { background: var(--navy-700); color: var(--text-bright); border-color: var(--amber-500); }
.sched-body { flex: 1; overflow-y: auto; padding: 0.75rem; }

/* ── Timeline view ── */
.timeline { display: flex; flex-direction: column; gap: 0.5rem; }
.time-slot { display: flex; gap: 0.6rem; align-items: flex-start; }
.time-label { width: 52px; flex-shrink: 0; font-size: 0.58rem; color: var(--navy-400); text-align: right; padding-top: 0.25rem; }
.time-events { flex: 1; display: flex; flex-direction: column; gap: 0.3rem; }
.sched-event {
  border-radius: 8px; padding: 0.5rem 0.65rem;
  border-left: 3px solid; position: relative;
  transition: background 0.15s;
}
.sched-event:hover { filter: brightness(1.15); }
.sched-event .ev-row { display: flex; justify-content: space-between; align-items: center; }
.sched-event .ev-name { font-size: 0.7rem; font-weight: 600; }
.sched-event .ev-desc { font-size: 0.58rem; color: var(--text-dim); margin-top: 0.15rem; line-height: 1.4; }
.sched-event .ev-meta { display: flex; gap: 0.4rem; align-items: center; margin-top: 0.25rem; flex-wrap: wrap; }
.sched-event .ev-badge {
  font-size: 0.48rem; padding: 1px 5px; border-radius: 3px;
  letter-spacing: 0.3px;
}
.sched-event .ev-toggle {
  background: none; border: 1px solid var(--navy-600); color: var(--text-dim);
  font-size: 0.5rem; padding: 2px 6px; border-radius: 3px;
  cursor: pointer; font-family: 'JetBrains Mono', monospace;
  transition: all 0.15s;
}
.sched-event .ev-toggle:hover { border-color: var(--text-bright); color: var(--text-bright); }
.sched-event .ev-toggle.enabled { border-color: rgba(74,222,128,0.4); color: #4ade80; }
.sched-event .ev-toggle.disabled { border-color: rgba(248,113,113,0.4); color: #f87171; }

/* ── Weekly grid ── */
.weekly-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.4rem; }
.week-col { display: flex; flex-direction: column; gap: 0.3rem; }
.week-day-header {
  text-align: center; font-size: 0.55rem; color: var(--navy-400);
  padding: 0.3rem 0; border-bottom: 1px solid var(--navy-700);
}
.week-day-header.today { color: var(--amber-400); border-color: var(--amber-500); }
.week-event {
  border-radius: 6px; padding: 0.3rem 0.4rem;
  font-size: 0.5rem; border-left: 2px solid;
  line-height: 1.3;
}
.week-event .we-time { color: var(--text-dim); font-size: 0.45rem; }
.week-event .we-name { font-weight: 600; }

/* ── Sun info bar ── */
.sun-bar {
  display: flex; gap: 1rem; padding: 0.5rem 0.75rem; margin-bottom: 0.5rem;
  background: var(--navy-800); border-radius: 8px; border: 1px solid var(--navy-700);
  font-size: 0.6rem;
}
.sun-bar span { display: flex; align-items: center; gap: 0.3rem; }

/* ── Active timers ── */
.active-timers { margin-bottom: 0.75rem; }
.active-timers .at-title { font-size: 0.55rem; color: var(--amber-400); letter-spacing: 0.5px; margin-bottom: 0.3rem; }
.timer-pill {
  display: inline-flex; align-items: center; gap: 0.3rem;
  background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3);
  border-radius: 6px; padding: 0.25rem 0.5rem; margin-right: 0.3rem; margin-bottom: 0.3rem;
  font-size: 0.6rem; color: var(--amber-400);
}

/* ── Category filter ── */
.cat-filters { display: flex; gap: 0.3rem; margin-bottom: 0.5rem; }
.cat-btn {
  font-size: 0.5rem; padding: 0.2rem 0.5rem; border-radius: 4px;
  border: 1px solid var(--navy-600); background: transparent;
  color: var(--text-dim); cursor: pointer; font-family: 'JetBrains Mono', monospace;
  transition: all 0.15s;
}
.cat-btn.active { background: var(--navy-700); color: var(--text-bright); }
`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function formatTime(timeStr, sun) {
  if (!timeStr) return "";
  if (timeStr.startsWith("sunrise")) {
    const offset = parseInt(timeStr.split(/[+-]/)[1] || "0", 10);
    const riseTime = sun?.next_rising ? new Date(sun.next_rising) : null;
    if (riseTime) {
      riseTime.setMinutes(riseTime.getMinutes() + (timeStr.includes("-") ? -offset : offset));
      return `☀ ${riseTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return `☀ sunrise${timeStr.includes("-") ? `-${offset}m` : `+${offset}m`}`;
  }
  if (timeStr.startsWith("sunset")) {
    const offset = parseInt(timeStr.split(/[+-]/)[1] || "0", 10);
    const setTime = sun?.next_setting ? new Date(sun.next_setting) : null;
    if (setTime) {
      setTime.setMinutes(setTime.getMinutes() + (timeStr.includes("-") ? -offset : offset));
      return `🌙 ${setTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return `🌙 sunset+${offset}m`;
  }
  // Convert 24h to 12h
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function sortKey(timeStr) {
  if (!timeStr) return 9999;
  if (timeStr.startsWith("sunrise")) return 600 + (timeStr.includes("-") ? -30 : 30);
  if (timeStr.startsWith("sunset")) return 2000 + parseInt(timeStr.split(/[+-]/)[1] || "0", 10);
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function relativeTime(isoStr) {
  if (!isoStr) return "never";
  const d = new Date(isoStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function Scheduler({ api }) {
  const [schedData, setSchedData] = useState(null);
  const [view, setView] = useState("daily"); // daily | weekly
  const [catFilter, setCatFilter] = useState("all");

  const fetchSchedule = useCallback(async () => {
    if (!api) return;
    try {
      const r = await fetch(`${api}/schedule`);
      const data = await r.json();
      setSchedData(data);
    } catch {}
  }, [api]);

  useEffect(() => {
    fetchSchedule();
    const id = setInterval(fetchSchedule, 15000);
    return () => clearInterval(id);
  }, [fetchSchedule]);

  const toggleAutomation = useCallback(async (entityId, currentlyEnabled) => {
    if (!api || !entityId) return;
    try {
      await fetch(`${api}/schedule/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: entityId, enable: !currentlyEnabled }),
      });
      setTimeout(fetchSchedule, 500);
    } catch {}
  }, [api, fetchSchedule]);

  if (!schedData) {
    return (
      <>
        <style>{schedulerStyles}</style>
        <div className="scheduler">
          <div style={{ margin: "auto", color: "var(--text-dim)", fontSize: "0.75rem" }}>Loading schedule...</div>
        </div>
      </>
    );
  }

  const { schedules, active_timers, sun } = schedData;
  const filtered = catFilter === "all" ? schedules : schedules.filter(s => s.category === catFilter);
  const sorted = [...filtered].sort((a, b) => sortKey(a.time) - sortKey(b.time));
  const todayIdx = new Date().getDay();

  return (
    <>
      <style>{schedulerStyles}</style>
      <div className="scheduler">
        <div className="sched-header">
          <h3>FARM SCHEDULE</h3>
          <div className="sched-view-toggle">
            <button className={view === "daily" ? "active" : ""} onClick={() => setView("daily")}>DAILY</button>
            <button className={view === "weekly" ? "active" : ""} onClick={() => setView("weekly")}>WEEKLY</button>
          </div>
        </div>

        <div className="sched-body">
          {/* Sun info */}
          {sun?.next_rising && (
            <div className="sun-bar">
              <span>☀ Sunrise: {new Date(sun.next_rising).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span>🌙 Sunset: {new Date(sun.next_setting).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}

          {/* Active timers */}
          {active_timers?.length > 0 && (
            <div className="active-timers">
              <div className="at-title">ACTIVE TIMERS</div>
              {active_timers.map(t => (
                <span key={t.entity_id} className="timer-pill">
                  ⏱ {t.friendly_name} — {t.remaining || "..."}
                </span>
              ))}
            </div>
          )}

          {/* Category filter */}
          <div className="cat-filters">
            <button className={`cat-btn${catFilter === "all" ? " active" : ""}`} onClick={() => setCatFilter("all")}>ALL</button>
            {Object.entries(CAT_COLORS).map(([cat, cfg]) => (
              <button
                key={cat}
                className={`cat-btn${catFilter === cat ? " active" : ""}`}
                onClick={() => setCatFilter(catFilter === cat ? "all" : cat)}
                style={catFilter === cat ? { borderColor: cfg.border, color: cfg.text } : {}}
              >
                {cfg.icon} {cat.toUpperCase()}
              </button>
            ))}
          </div>

          {/* ── Daily timeline view ── */}
          {view === "daily" && (
            <div className="timeline">
              {sorted.map(sched => {
                const cat = CAT_COLORS[sched.category] || CAT_COLORS.alert;
                return (
                  <div key={sched.id} className="time-slot">
                    <div className="time-label">{formatTime(sched.time, sun)}</div>
                    <div className="time-events">
                      <div
                        className="sched-event"
                        style={{ background: cat.bg, borderColor: cat.border }}
                      >
                        <div className="ev-row">
                          <span className="ev-name" style={{ color: cat.text }}>
                            {cat.icon} {sched.name}
                          </span>
                          {sched.entity_id && (
                            <button
                              className={`ev-toggle ${sched.enabled ? "enabled" : "disabled"}`}
                              onClick={() => toggleAutomation(sched.entity_id, sched.enabled)}
                            >
                              {sched.enabled ? "● ON" : "○ OFF"}
                            </button>
                          )}
                        </div>
                        <div className="ev-desc">{sched.description}</div>
                        <div className="ev-meta">
                          {sched.duration_min > 0 && (
                            <span className="ev-badge" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-dim)" }}>
                              ⏱ {sched.duration_min}min
                            </span>
                          )}
                          {sched.last_triggered && (
                            <span className="ev-badge" style={{ background: "rgba(255,255,255,0.06)", color: "var(--text-dim)" }}>
                              Last: {relativeTime(sched.last_triggered)}
                            </span>
                          )}
                          {sched.conditions?.map((c, i) => (
                            <span key={i} className="ev-badge" style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Weekly grid view ── */}
          {view === "weekly" && (
            <div className="weekly-grid">
              {DAYS_SHORT.map((day, di) => (
                <div key={day} className="week-col">
                  <div className={`week-day-header${di === todayIdx ? " today" : ""}`}>{day}</div>
                  {sorted
                    .filter(s => s.days.includes(DAYS_KEY[di]))
                    .map(sched => {
                      const cat = CAT_COLORS[sched.category] || CAT_COLORS.alert;
                      return (
                        <div
                          key={sched.id}
                          className="week-event"
                          style={{
                            background: cat.bg,
                            borderColor: cat.border,
                            opacity: sched.enabled === false ? 0.4 : 1,
                          }}
                          title={sched.description}
                        >
                          <div className="we-time">{formatTime(sched.time, sun)}</div>
                          <div className="we-name" style={{ color: cat.text }}>{sched.name}</div>
                          {sched.duration_min > 0 && (
                            <div style={{ fontSize: "0.42rem", color: "var(--text-dim)" }}>{sched.duration_min}min</div>
                          )}
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

import { useState, useEffect, useCallback } from "react";

const DOMAIN_ICONS = {
  light:         "💡",
  switch:        "🔌",
  cover:         "🚪",
  lock:          "🔒",
  climate:       "🌡️",
  sensor:        "📡",
  binary_sensor: "⚡",
  camera:        "📷",
  fan:           "🌀",
  automation:    "⚙️",
  scene:         "🎨",
};

const DOMAIN_LABEL = {
  light:         "Lights",
  switch:        "Switches",
  cover:         "Covers & Gates",
  lock:          "Locks",
  climate:       "Climate",
  sensor:        "Sensors",
  binary_sensor: "Binary Sensors",
  camera:        "Cameras",
  fan:           "Fans",
  automation:    "Automations",
  scene:         "Scenes",
};

const CONTROLLABLE = ["light", "switch", "cover", "lock", "climate", "fan"];

const STATE_COLOR = (state) => {
  if (["on", "open", "unlocked", "heating", "cooling"].includes(state)) return "#4ade80";
  if (["off", "closed", "locked", "idle"].includes(state)) return "#64748b";
  if (["unavailable", "unknown"].includes(state)) return "#f87171";
  return "#fbbf24";
};

const dash = `
.db-wrap {
  flex: 1; overflow-y: auto; padding: 1.5rem;
  background: var(--navy-950);
}
.db-toolbar {
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 1.25rem; flex-wrap: wrap;
}
.db-toolbar h1 { font-size: 0.95rem; color: var(--amber-400); letter-spacing: 1px; flex: 1; }
.db-refresh {
  background: var(--navy-800); border: 1px solid var(--navy-600);
  color: var(--text-dim); font-size: 0.7rem; padding: 4px 10px;
  border-radius: 4px; cursor: pointer; font-family: 'JetBrains Mono', monospace;
}
.db-refresh:hover { color: var(--amber-400); border-color: var(--amber-500); }
.db-filter {
  background: var(--navy-800); border: 1px solid var(--navy-600);
  color: var(--text-dim); font-size: 0.7rem; padding: 4px 8px;
  border-radius: 4px; font-family: 'JetBrains Mono', monospace;
}
.db-section { margin-bottom: 2rem; }
.db-section-title {
  font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
  color: var(--text-dim); text-transform: uppercase; letter-spacing: 1px;
  margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;
  border-bottom: 1px solid var(--navy-800); padding-bottom: 0.4rem;
}
.db-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.75rem;
}
.db-card {
  background: var(--navy-900); border: 1px solid var(--navy-700);
  border-radius: 8px; padding: 0.85rem; display: flex; flex-direction: column; gap: 0.4rem;
  transition: border-color 0.2s;
}
.db-card:hover { border-color: var(--navy-500); }
.db-card.on { border-left: 3px solid #4ade80; }
.db-card.off { border-left: 3px solid #334155; }
.db-card-name {
  font-size: 0.8rem; color: var(--text-bright); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.db-card-id {
  font-family: 'JetBrains Mono', monospace; font-size: 0.6rem; color: var(--navy-400);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.db-card-state {
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 600;
}
.db-card-attr { font-size: 0.65rem; color: var(--text-dim); }
.db-btns { display: flex; gap: 0.4rem; margin-top: 0.2rem; flex-wrap: wrap; }
.db-btn {
  background: var(--navy-800); border: 1px solid var(--navy-600);
  color: var(--text-dim); font-size: 0.6rem; padding: 3px 7px;
  border-radius: 3px; cursor: pointer; font-family: 'JetBrains Mono', monospace;
  transition: all 0.15s;
}
.db-btn:hover { color: var(--amber-400); border-color: var(--amber-500); }
.db-btn.active { color: #4ade80; border-color: #166534; background: rgba(22,101,52,0.15); }
.db-camera-img { width: 100%; border-radius: 4px; margin-top: 0.4rem; object-fit: cover; height: 110px; background: var(--navy-800); }
.db-empty { color: var(--text-dim); font-size: 0.75rem; font-style: italic; padding: 0.5rem 0; }
.db-feedback {
  position: fixed; bottom: 1.5rem; right: 1.5rem;
  background: var(--navy-800); border: 1px solid var(--amber-500);
  color: var(--amber-400); font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem; padding: 0.5rem 1rem; border-radius: 6px;
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.db-search {
  background: var(--navy-800); border: 1px solid var(--navy-600);
  color: var(--text-bright); font-size: 0.75rem; padding: 5px 10px;
  border-radius: 4px; outline: none; font-family: inherit; width: 180px;
}
.db-search::placeholder { color: var(--text-dim); }
`;

const DOMAIN_ACTIONS = {
  light:   [["turn_on","ON"], ["turn_off","OFF"], ["toggle","TOGGLE"]],
  switch:  [["turn_on","ON"], ["turn_off","OFF"], ["toggle","TOGGLE"]],
  cover:   [["open_cover","OPEN"], ["close_cover","CLOSE"], ["stop_cover","STOP"]],
  lock:    [["lock","LOCK"], ["unlock","UNLOCK"]],
  fan:     [["turn_on","ON"], ["turn_off","OFF"], ["toggle","TOGGLE"]],
  climate: [["turn_on","ON"], ["turn_off","OFF"]],
  automation: [["trigger","TRIGGER"], ["turn_on","ENABLE"], ["turn_off","DISABLE"]],
  scene:   [["turn_on","ACTIVATE"]],
};

export default function Dashboard({ api }) {
  const [groups, setGroups] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [cameraTokens, setCameraTokens] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${api}/ha/dashboard`);
      const d = await r.json();
      if (d.error) { setError(d.error); setGroups({}); }
      else setGroups(d.groups || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const callService = async (domain, service, entity_id, extra = {}) => {
    try {
      const r = await fetch(`${api}/ha/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: `${domain}.${service}`, entity_id, extra }),
      });
      const d = await r.json();
      const msg = d.ok ? `✓ ${entity_id} → ${service}` : `✗ ${d.error || "failed"}`;
      showFeedback(msg);
      setTimeout(load, 800);
    } catch (e) {
      showFeedback(`✗ ${e.message}`);
    }
  };

  const showFeedback = (msg) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const activateScene = async (entity_id) => {
    await callService("scene", "turn_on", entity_id);
  };

  const cameraUrl = (entity_id) => `${api}/ha/camera/${entity_id}?t=${Date.now()}`;

  const refreshCamera = (entity_id) => {
    setCameraTokens(prev => ({ ...prev, [entity_id]: Date.now() }));
  };

  const ORDER = ["light", "switch", "cover", "lock", "climate", "fan", "sensor", "binary_sensor", "camera", "automation", "scene"];
  const visibleDomains = filter === "all" ? ORDER : ORDER.filter(d => d === filter);

  const filterEntity = (e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.name?.toLowerCase().includes(q) || e.entity_id?.toLowerCase().includes(q);
  };

  const getAttrHint = (domain, attrs) => {
    if (domain === "light" && attrs.brightness != null)
      return `${Math.round((attrs.brightness / 255) * 100)}% brightness`;
    if (domain === "climate") {
      const parts = [];
      if (attrs.current_temperature != null) parts.push(`${attrs.current_temperature}°`);
      if (attrs.hvac_mode) parts.push(attrs.hvac_mode);
      return parts.join(" · ");
    }
    if (domain === "sensor") return attrs.unit_of_measurement ? `Unit: ${attrs.unit_of_measurement}` : "";
    if (domain === "cover" && attrs.current_position != null) return `Position: ${attrs.current_position}%`;
    return "";
  };

  if (loading && Object.keys(groups).length === 0) {
    return (
      <div className="db-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{dash}</style>
        <span style={{ color: "var(--text-dim)", fontFamily: "JetBrains Mono", fontSize: "0.8rem" }}>
          Loading dashboard...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="db-wrap">
        <style>{dash}</style>
        <div style={{ color: "#f87171", fontFamily: "JetBrains Mono", fontSize: "0.8rem", padding: "2rem" }}>
          ✗ {error}
          <br /><br />
          <span style={{ color: "var(--text-dim)" }}>
            Make sure HA_TOKEN is set in your .env and Home Assistant is running.
          </span>
          <br /><br />
          <button className="db-refresh" onClick={load}>RETRY</button>
        </div>
      </div>
    );
  }

  return (
    <div className="db-wrap">
      <style>{dash}</style>

      <div className="db-toolbar">
        <h1>⊞ HOME DASHBOARD</h1>
        <input
          className="db-search"
          placeholder="Search entities..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="db-filter" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All domains</option>
          {ORDER.map(d => <option key={d} value={d}>{DOMAIN_LABEL[d]}</option>)}
        </select>
        <button className="db-refresh" onClick={load}>↻ REFRESH</button>
      </div>

      {visibleDomains.map(domain => {
        const entities = (groups[domain] || []).filter(filterEntity);
        if (!entities.length) return null;
        const actions = DOMAIN_ACTIONS[domain] || [];

        return (
          <div className="db-section" key={domain}>
            <div className="db-section-title">
              <span>{DOMAIN_ICONS[domain]}</span>
              <span>{DOMAIN_LABEL[domain]}</span>
              <span style={{ marginLeft: "auto", color: "var(--navy-400)" }}>{entities.length}</span>
            </div>

            <div className="db-grid">
              {entities.map(e => {
                const isOn = ["on", "open", "unlocked", "heating", "cooling"].includes(e.state);
                const hint = getAttrHint(domain, e.attributes || {});

                return (
                  <div className={`db-card ${isOn ? "on" : "off"}`} key={e.entity_id}>
                    <div className="db-card-name" title={e.name}>{e.name}</div>
                    <div className="db-card-id">{e.entity_id}</div>
                    <div className="db-card-state" style={{ color: STATE_COLOR(e.state) }}>
                      {e.state}
                    </div>
                    {hint && <div className="db-card-attr">{hint}</div>}

                    {domain === "camera" && (
                      <>
                        <img
                          className="db-camera-img"
                          src={`${api}/ha/camera/${e.entity_id}?t=${cameraTokens[e.entity_id] || 0}`}
                          alt={e.name}
                          onError={ev => { ev.target.style.display = "none"; }}
                        />
                        <button className="db-btn" onClick={() => refreshCamera(e.entity_id)}>↻ REFRESH</button>
                      </>
                    )}

                    {actions.length > 0 && domain !== "camera" && (
                      <div className="db-btns">
                        {actions.map(([svc, label]) => (
                          <button
                            key={svc}
                            className={`db-btn ${isOn && svc.includes("on") ? "active" : ""}`}
                            onClick={() => callService(domain, svc, e.entity_id)}
                          >
                            {label}
                          </button>
                        ))}
                        {domain === "light" && isOn && (
                          <>
                            <button className="db-btn" onClick={() => callService("light", "turn_on", e.entity_id, { brightness_pct: 25 })}>25%</button>
                            <button className="db-btn" onClick={() => callService("light", "turn_on", e.entity_id, { brightness_pct: 50 })}>50%</button>
                            <button className="db-btn" onClick={() => callService("light", "turn_on", e.entity_id, { brightness_pct: 100 })}>100%</button>
                          </>
                        )}
                        {domain === "cover" && (
                          <>
                            <button className="db-btn" onClick={() => callService("cover", "set_cover_position", e.entity_id, { position: 50 })}>50%</button>
                          </>
                        )}
                        {domain === "climate" && (
                          <>
                            <button className="db-btn" onClick={() => callService("climate", "set_temperature", e.entity_id, { temperature: 68 })}>68°</button>
                            <button className="db-btn" onClick={() => callService("climate", "set_temperature", e.entity_id, { temperature: 72 })}>72°</button>
                            <button className="db-btn" onClick={() => callService("climate", "set_temperature", e.entity_id, { temperature: 76 })}>76°</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {feedback && <div className="db-feedback">{feedback}</div>}
    </div>
  );
}

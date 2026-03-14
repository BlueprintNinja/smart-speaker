import { useState, useEffect, useCallback, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DEVICES — seeded from the old canvas sample
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_DEVICES = [
  { entity_id: "switch.irrigation_zone_1", name: "Zone 1", icon: "🌊", color: "#0ea5e9" },
  { entity_id: "switch.irrigation_zone_2", name: "Zone 2", icon: "🌊", color: "#0ea5e9" },
  { entity_id: "switch.irrigation_zone_3", name: "Zone 3", icon: "🌊", color: "#0ea5e9" },
  { entity_id: "light.barn_light", name: "Barn Light", icon: "💡", color: "#f59e0b" },
  { entity_id: "light.field_light", name: "Field Light", icon: "💡", color: "#f59e0b" },
  { entity_id: "sensor.tensiometer_field1", name: "Field 1 Moisture", icon: "💧", color: "#10b981" },
  { entity_id: "sensor.tensiometer_field2", name: "Field 2 Moisture", icon: "💧", color: "#10b981" },
  { entity_id: "camera.barn_cam", name: "Barn Camera", icon: "📷", color: "#6366f1" },
  { entity_id: "sensor.rainpoint_soil_moisture", name: "RainPoint BLE", icon: "🌱", color: "#34d399" },
];

const STORAGE_KEY = "device_grid_v1";
const ICON_MAP = {
  light: { icon: "💡", color: "#f59e0b" },
  switch: { icon: "🔌", color: "#0ea5e9" },
  sensor: { icon: "📊", color: "#10b981" },
  camera: { icon: "📷", color: "#6366f1" },
  binary_sensor: { icon: "⚡", color: "#f472b6" },
  automation: { icon: "⚙", color: "#a78bfa" },
  script: { icon: "▶", color: "#fb923c" },
  input_boolean: { icon: "🔘", color: "#38bdf8" },
  scene: { icon: "🎬", color: "#c084fc" },
  climate: { icon: "🌡", color: "#f87171" },
  fan: { icon: "🌀", color: "#22d3ee" },
  cover: { icon: "🪟", color: "#a3e635" },
  timer: { icon: "⏱", color: "#fbbf24" },
};

function getEntityMeta(entityId) {
  const domain = entityId.split(".")[0] || "";
  return ICON_MAP[domain] || { icon: "📦", color: "#94a3b8" };
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const gridStyles = `
.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.6rem;
  padding: 0.75rem;
}
.device-card {
  background: var(--navy-800);
  border: 1px solid var(--navy-600);
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  position: relative;
  transition: border-color 0.3s, box-shadow 0.3s;
  min-height: 80px;
}
.device-card .card-remove {
  position: absolute; top: 4px; right: 6px;
  background: none; border: none; color: var(--navy-500);
  cursor: pointer; font-size: 0.65rem; padding: 2px 4px;
  opacity: 0; transition: opacity 0.15s;
}
.device-card:hover .card-remove { opacity: 1; }
.device-card .card-remove:hover { color: #f87171; }

.device-card.active {
  border-color: #4ade80;
  box-shadow: 0 0 8px 1px rgba(74,222,128,0.35);
}
.device-card.active .card-icon { filter: drop-shadow(0 0 4px rgba(74,222,128,0.6)); }

@keyframes cardPulse {
  0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0.7); }
  50%  { box-shadow: 0 0 0 8px rgba(74,222,128,0); }
  100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
}
.device-card.pulsing {
  animation: cardPulse 0.6s ease-out 3;
  border-color: #4ade80;
}

.add-card {
  background: transparent;
  border: 2px dashed var(--navy-600);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--navy-400);
  font-size: 1.5rem;
  min-height: 80px;
  transition: border-color 0.2s, color 0.2s;
}
.add-card:hover {
  border-color: var(--amber-500);
  color: var(--amber-400);
}

.entity-picker-overlay {
  position: fixed; inset: 0; z-index: 9990;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.entity-picker {
  background: var(--navy-900);
  border: 1px solid var(--navy-600);
  border-radius: 12px;
  width: 400px; max-width: 90vw;
  max-height: 70vh;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.7);
}
.entity-picker-header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--navy-700);
  display: flex; align-items: center; gap: 0.5rem;
}
.entity-picker-header input {
  flex: 1;
  background: var(--navy-800);
  border: 1px solid var(--navy-600);
  color: var(--text-bright);
  border-radius: 6px;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  outline: none;
}
.entity-picker-header input:focus { border-color: var(--amber-500); }
.entity-picker-header button {
  background: none; border: none; color: var(--text-dim);
  cursor: pointer; font-size: 0.9rem; padding: 4px;
}
.entity-picker-header button:hover { color: var(--text-bright); }
.entity-picker-list {
  flex: 1; overflow-y: auto; padding: 0.5rem;
  display: flex; flex-direction: column; gap: 0.25rem;
}
.entity-picker-item {
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.72rem;
  transition: background 0.15s;
}
.entity-picker-item:hover { background: var(--navy-800); }
.entity-picker-item.already { opacity: 0.4; pointer-events: none; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function DeviceGrid({ api, lastHaEvent }) {
  // Load pinned devices from localStorage, seed with defaults on first run
  const [devices, setDevices] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return DEFAULT_DEVICES;
  });
  const [haStates, setHaStates] = useState({});
  const [pulsingId, setPulsingId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [allEntities, setAllEntities] = useState([]);
  const searchRef = useRef(null);

  // Persist to localStorage
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(devices)); } catch {}
  }, [devices]);

  // Poll HA entity states
  useEffect(() => {
    if (!api) return;
    const poll = async () => {
      try {
        const r = await fetch(`${api}/ha/entities`);
        const data = await r.json();
        const map = {};
        for (const e of (data.entities || [])) map[e.entity_id] = e;
        setHaStates(map);
        setAllEntities(data.entities || []);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [api]);

  // Pulse card when a chat command targets its entity
  useEffect(() => {
    if (!lastHaEvent?.entity_id) return;
    const eid = lastHaEvent.entity_id;
    const slug = eid.includes(".") ? eid.split(".").slice(1).join(".") : eid;
    const match = devices.find(d => {
      const dSlug = d.entity_id.includes(".") ? d.entity_id.split(".").slice(1).join(".") : d.entity_id;
      return d.entity_id === eid || dSlug === slug;
    });
    if (match) {
      setPulsingId(match.entity_id);
      setTimeout(() => setPulsingId(null), 2000);
    }
  }, [lastHaEvent]);

  const removeDevice = useCallback((entityId) => {
    setDevices(prev => prev.filter(d => d.entity_id !== entityId));
  }, []);

  const addDevice = useCallback((entity) => {
    const meta = getEntityMeta(entity.entity_id);
    const name = entity.attributes?.friendly_name || entity.entity_id.split(".").pop().replace(/_/g, " ");
    setDevices(prev => {
      if (prev.some(d => d.entity_id === entity.entity_id)) return prev;
      return [...prev, { entity_id: entity.entity_id, name, icon: meta.icon, color: meta.color }];
    });
    setShowPicker(false);
  }, []);

  // Focus search input when picker opens
  useEffect(() => {
    if (showPicker) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showPicker]);

  const pinnedIds = new Set(devices.map(d => d.entity_id));
  const filteredEntities = allEntities.filter(e => {
    const q = search.toLowerCase();
    return e.entity_id.toLowerCase().includes(q) ||
           (e.attributes?.friendly_name || "").toLowerCase().includes(q);
  });

  return (
    <>
      <style>{gridStyles}</style>
      <div className="device-grid">
        {devices.map(dev => {
          const ha = haStates[dev.entity_id];
          const state = ha?.state ?? "—";
          const isOn = state === "on" || state === "open" || state === "playing" || state === "home";
          const isPulsing = pulsingId === dev.entity_id;
          return (
            <div
              key={dev.entity_id}
              className={`device-card${isOn ? " active" : ""}${isPulsing ? " pulsing" : ""}`}
              style={{ borderLeft: `3px solid ${dev.color}` }}
            >
              <button className="card-remove" onClick={() => removeDevice(dev.entity_id)}>✕</button>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="card-icon" style={{ fontSize: "1.1rem" }}>{dev.icon}</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-bright)" }}>{dev.name}</span>
              </div>
              <div style={{ fontSize: "0.58rem", fontFamily: "'JetBrains Mono', monospace", color: "var(--navy-400)" }}>
                {dev.entity_id}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                <span style={{
                  fontSize: "0.68rem", fontWeight: 600,
                  color: isOn ? "#4ade80" : state === "off" ? "var(--text-dim)" : "var(--amber-400)",
                }}>
                  {state}
                </span>
                {ha && (
                  <span style={{ fontSize: "0.5rem", color: "#4ade80" }}>● HA</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Add new entity card */}
        <div className="add-card" onClick={() => setShowPicker(true)} title="Add a device">
          +
        </div>
      </div>

      {/* Entity picker modal */}
      {showPicker && (
        <div className="entity-picker-overlay" onClick={() => setShowPicker(false)}>
          <div className="entity-picker" onClick={e => e.stopPropagation()}>
            <div className="entity-picker-header">
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search entities..."
              />
              <button onClick={() => setShowPicker(false)}>✕</button>
            </div>
            <div className="entity-picker-list">
              {filteredEntities.length === 0 && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", padding: "1rem", textAlign: "center" }}>
                  {allEntities.length === 0 ? "Loading HA entities..." : "No matches"}
                </div>
              )}
              {filteredEntities.slice(0, 100).map(e => {
                const meta = getEntityMeta(e.entity_id);
                const already = pinnedIds.has(e.entity_id);
                const fname = e.attributes?.friendly_name || "";
                return (
                  <div
                    key={e.entity_id}
                    className={`entity-picker-item${already ? " already" : ""}`}
                    onClick={() => !already && addDevice(e)}
                  >
                    <span>{meta.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--text-bright)", fontSize: "0.72rem" }}>
                        {fname || e.entity_id.split(".").pop().replace(/_/g, " ")}
                      </div>
                      <div style={{ fontSize: "0.58rem", fontFamily: "'JetBrains Mono', monospace", color: "var(--navy-400)" }}>
                        {e.entity_id}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.65rem", color: e.state === "on" ? "#4ade80" : "var(--text-dim)" }}>
                      {e.state}
                    </span>
                    {already && <span style={{ fontSize: "0.55rem", color: "var(--navy-400)" }}>added</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

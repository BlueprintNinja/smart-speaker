import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// NODE TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
const NODE_TYPES = {
  light: {
    label: "Light",
    color: "#f59e0b",
    icon: "💡",
    defaultConfig: { entity_id: "light.my_light", friendly_name: "My Light", brightness: true },
    fields: [
      { key: "entity_id", label: "Entity ID", placeholder: "light.barn_lights" },
      { key: "friendly_name", label: "Friendly Name", placeholder: "Barn Lights" },
    ],
    actions: ["turn_on", "turn_off", "toggle"],
  },
  camera: {
    label: "Camera",
    color: "#6366f1",
    icon: "📷",
    defaultConfig: { entity_id: "camera.my_camera", friendly_name: "My Camera", stream_url: "" },
    fields: [
      { key: "entity_id", label: "Entity ID", placeholder: "camera.front_gate" },
      { key: "friendly_name", label: "Friendly Name", placeholder: "Front Gate Camera" },
      { key: "stream_url", label: "Stream URL (optional)", placeholder: "rtsp://192.168.1.x/stream" },
    ],
    actions: ["snapshot", "enable_motion_detection", "disable_motion_detection"],
  },
  tensiometer: {
    label: "Tensiometer",
    color: "#10b981",
    icon: "💧",
    defaultConfig: { entity_id: "sensor.soil_moisture_1", friendly_name: "Field 1 Moisture", threshold_kpa: 40 },
    fields: [
      { key: "entity_id", label: "Entity ID", placeholder: "sensor.field1_tension" },
      { key: "friendly_name", label: "Friendly Name", placeholder: "Field 1 Tensiometer" },
      { key: "threshold_kpa", label: "Irrigate Threshold (kPa)", placeholder: "40" },
    ],
    actions: ["read_value", "set_threshold"],
  },
  irrigation: {
    label: "Irrigation",
    color: "#0ea5e9",
    icon: "🌊",
    defaultConfig: { entity_id: "switch.irrigation_zone_1", friendly_name: "Zone 1", duration_min: 20 },
    fields: [
      { key: "entity_id", label: "Entity ID", placeholder: "switch.zone_1_valve" },
      { key: "friendly_name", label: "Friendly Name", placeholder: "Zone 1 Valve" },
      { key: "duration_min", label: "Default Duration (min)", placeholder: "20" },
    ],
    actions: ["turn_on", "turn_off", "toggle"],
  },
  rainpoint: {
    label: "RainPoint BLE",
    color: "#34d399",
    icon: "🌱",
    defaultConfig: {
      moisture_entity: "sensor.rainpoint_soil_moisture",
      temp_entity: "sensor.rainpoint_soil_temperature",
      friendly_name: "RainPoint Sensor",
      dry_threshold: 25,
      wet_threshold: 75,
      proxy_host: "esp32-ble-proxy.local",
    },
    fields: [
      { key: "moisture_entity", label: "Moisture Entity ID", placeholder: "sensor.rainpoint_soil_moisture" },
      { key: "temp_entity", label: "Temperature Entity ID", placeholder: "sensor.rainpoint_soil_temperature" },
      { key: "friendly_name", label: "Friendly Name", placeholder: "Field 1 RainPoint" },
      { key: "dry_threshold", label: "Dry Alert Threshold (%)", placeholder: "25" },
      { key: "wet_threshold", label: "Wet Alert Threshold (%)", placeholder: "75" },
      { key: "proxy_host", label: "ESP32 BLE Proxy Host", placeholder: "esp32-ble-proxy.local" },
    ],
    actions: ["read_moisture", "read_temperature", "check_thresholds"],
    info: [
      "BLE device — requires ESP32 Bluetooth Proxy or HA host with Bluetooth within 30ft.",
      "ESP32 proxy: flash ESPHome 'bluetooth_proxy' preset, plug in near garden.",
      "HA integration: Settings → Integrations → Bluetooth → discovers automatically.",
      "Moisture entity appears as sensor.* once HA pairs via Bluetooth integration.",
      "IP54 rated: splash-proof, not submersible. Keep head elevated.",
      "Updates every 2s when in range. Historical trends in HA energy dashboard.",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const canvasStyles = `
.canvas-root { display: flex; height: 100%; width: 100%; overflow: hidden; }

.canvas-toolbar {
  width: 200px; flex-shrink: 0; background: rgba(11,21,38,0.8);
  border-right: 1px solid var(--navy-700); padding: 1rem;
  display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto;
}
.canvas-toolbar h3 {
  font-size: 0.7rem; letter-spacing: 1px; color: var(--text-dim);
  text-transform: uppercase; margin-bottom: 0.5rem;
}
.node-palette-item {
  padding: 0.6rem 0.8rem; border-radius: 6px; cursor: grab;
  border: 1px solid var(--navy-600); background: var(--navy-800);
  font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem;
  user-select: none; transition: background 0.15s;
}
.node-palette-item:hover { background: var(--navy-700); }

.canvas-area {
  flex: 1; position: relative; overflow: hidden;
  background-image: radial-gradient(circle, #1a3050 1px, transparent 1px);
  background-size: 28px 28px;
}
.canvas-svg { position: absolute; inset: 0; pointer-events: none; overflow: visible; }

.canvas-node {
  position: absolute; min-width: 180px; border-radius: 8px;
  border: 1px solid var(--navy-600); background: var(--navy-900);
  box-shadow: 0 4px 20px rgba(0,0,0,0.4); cursor: move; user-select: none;
}
.canvas-node.selected { outline: 2px solid var(--amber-400); }
.node-header {
  padding: 0.5rem 0.75rem; border-radius: 7px 7px 0 0;
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.8rem; font-weight: 600;
}
.node-body { padding: 0.6rem 0.75rem; font-size: 0.72rem; color: var(--text-dim); }
.node-field { margin-bottom: 0.4rem; }
.node-field label { display: block; font-size: 0.65rem; color: var(--text-dim); margin-bottom: 2px; }
.node-field input {
  width: 100%; background: var(--navy-800); border: 1px solid var(--navy-600);
  color: var(--text-bright); border-radius: 4px; padding: 3px 6px;
  font-size: 0.72rem; outline: none; font-family: 'JetBrains Mono', monospace;
}
.node-field input:focus { border-color: var(--amber-500); }
.node-port {
  width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--navy-600);
  background: var(--navy-800); position: absolute; cursor: crosshair;
  transition: background 0.15s, border-color 0.15s;
}
.node-port:hover, .node-port.active { background: var(--amber-400); border-color: var(--amber-500); }
.node-port.in  { left: -7px;  top: 50%; transform: translateY(-50%); }
.node-port.out { right: -7px; top: 50%; transform: translateY(-50%); }
.node-delete {
  position: absolute; top: 4px; right: 6px; background: none; border: none;
  color: var(--text-dim); cursor: pointer; font-size: 0.75rem; padding: 0 2px;
}
.node-delete:hover { color: #f87171; }

@keyframes nodePulse {
  0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0.8), 0 4px 20px rgba(0,0,0,0.5); }
  50%  { box-shadow: 0 0 0 8px rgba(74,222,128,0), 0 4px 20px rgba(0,0,0,0.5); }
  100% { box-shadow: 0 0 0 0 rgba(74,222,128,0), 0 4px 20px rgba(0,0,0,0.5); }
}
.node-pulse { animation: nodePulse 0.6s ease-out 3; }

.ha-panel {
  width: 240px; flex-shrink: 0; background: rgba(6,13,26,0.9);
  border-left: 1px solid var(--navy-700); display: flex; flex-direction: column;
}
.ha-panel-header {
  padding: 1rem; border-bottom: 1px solid var(--navy-700);
  font-size: 0.75rem; font-weight: 600; color: var(--amber-400); letter-spacing: 1px;
}
.ha-panel-body { flex: 1; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; }
.ha-entity-row {
  background: var(--navy-800); border: 1px solid var(--navy-700); border-radius: 6px;
  padding: 0.5rem 0.6rem; display: flex; flex-direction: column; gap: 0.15rem;
}
.ha-entity-id { font-family: 'JetBrains Mono', monospace; font-size: 0.6rem; color: var(--navy-400); }
.ha-entity-state { font-size: 0.72rem; font-weight: 600; }
.ha-entity-name { font-size: 0.65rem; color: var(--text-dim); }
`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
let _nodeId = 1;
const newId = () => `node_${_nodeId++}`;

function makeNode(type, x, y) {
  return {
    id: newId(),
    type,
    x,
    y,
    config: { ...NODE_TYPES[type].defaultConfig },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = "nodecanvas_v1";

function loadCanvas() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { nodes: [], edges: [] };
}

export default function NodeCanvas({ api, lastHaEvent }) {
  const saved = loadCanvas();
  const [nodes, setNodes] = useState(saved.nodes);
  const [edges, setEdges] = useState(saved.edges);   // { id, from, to }
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);  // { nodeId, offX, offY }
  const [wiring, setWiring] = useState(null);      // { fromNode, fromPort:{x,y} }
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [haStates, setHaStates] = useState({});    // entity_id -> { state, attributes }
  const [chatHighlight, setChatHighlight] = useState(null); // entity_id triggered from chat
  const [pulsingNode, setPulsingNode] = useState(null); // node.id currently pulsing
  const canvasRef = useRef(null);

  // ── Persist canvas to localStorage + sync to HA ─────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges })); } catch {}
    if (nodes.length > 0 && api) {
      fetch(`${api}/canvas/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes }),
      }).catch(() => {});
    }
  }, [nodes, edges]);

  // ── Poll HA states for all canvas nodes ────────────────────────────────────
  useEffect(() => {
    const fetchStates = async () => {
      if (!api || nodes.length === 0) return;
      try {
        const r = await fetch(`${api}/ha/entities`);
        const data = await r.json();
        const map = {};
        for (const e of (data.entities || [])) map[e.entity_id] = e;
        setHaStates(map);
      } catch (e) { /* silent */ }
    };
    fetchStates();
    const id = setInterval(fetchStates, 15000);
    return () => clearInterval(id);
  }, [nodes, api]);

  // ── Pulse node when a chat command fires on its entity ──────────────────────
  useEffect(() => {
    if (!lastHaEvent?.entity_id) return;
    const entityId = lastHaEvent.entity_id;
    const eventSlug = entityId.includes(".") ? entityId.split(".").slice(1).join(".") : entityId;
    const match = nodes.find(n => {
      const nodeEid = n.config.entity_id || "";
      const nodeSlug = nodeEid.includes(".") ? nodeEid.split(".").slice(1).join(".") : nodeEid;
      return nodeEid === entityId || resolveEntityId(n) === entityId || nodeSlug === eventSlug;
    });
    if (match) {
      setPulsingNode(match.id);
      setTimeout(() => setPulsingNode(null), 2000);
    }
  }, [lastHaEvent]);

  // ── Drag node ───────────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e, nodeId) => {
    if (e.target.classList.contains("node-port") || e.target.classList.contains("node-delete")) return;
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    setDragging({ nodeId, offX: e.clientX - node.x, offY: e.clientY - node.y });
    setSelected(nodeId);
  }, [nodes]);

  const onMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });

    if (dragging) {
      setNodes(prev => prev.map(n =>
        n.id === dragging.nodeId
          ? { ...n, x: e.clientX - dragging.offX, y: e.clientY - dragging.offY }
          : n
      ));
    }
  }, [dragging]);

  const onMouseUp = useCallback(() => {
    setDragging(null);
    setWiring(null);
  }, []);

  // ── Drop from palette ───────────────────────────────────────────────────────
  const onCanvasDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("nodeType");
    if (!type) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - 90;
    const y = e.clientY - rect.top - 30;
    setNodes(prev => [...prev, makeNode(type, x, y)]);
  }, []);

  // ── Wire ports ──────────────────────────────────────────────────────────────
  const onPortMouseDown = useCallback((e, nodeId, portType) => {
    e.stopPropagation();
    if (portType === "out") {
      const node = nodes.find(n => n.id === nodeId);
      const rect = canvasRef.current.getBoundingClientRect();
      setWiring({ fromNode: nodeId, fromPort: { x: node.x + 187, y: node.y + 36 } });
    }
  }, [nodes]);

  const onPortMouseUp = useCallback((e, nodeId, portType) => {
    e.stopPropagation();
    if (wiring && portType === "in" && wiring.fromNode !== nodeId) {
      const alreadyExists = edges.some(
        eg => eg.from === wiring.fromNode && eg.to === nodeId
      );
      if (!alreadyExists) {
        setEdges(prev => [...prev, { id: `${wiring.fromNode}->${nodeId}`, from: wiring.fromNode, to: nodeId }]);
      }
    }
    setWiring(null);
  }, [wiring, edges]);

  // ── Update node config ──────────────────────────────────────────────────────
  const updateConfig = useCallback((nodeId, key, value) => {
    setNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n
    ));
  }, []);

  const deleteNode = useCallback((nodeId) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.from !== nodeId && e.to !== nodeId));
    if (selected === nodeId) setSelected(null);
  }, [selected]);

  // ── Get port screen positions for SVG edges ─────────────────────────────────
  const getPortPos = (nodeId, side) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    return {
      x: side === "out" ? node.x + 187 : node.x,
      y: node.y + 36,
    };
  };

  // ── Resolve entity_id for a canvas node ──────────────────────────────────────
  const resolveEntityId = (node) => {
    const raw = node.config.entity_id || `canvas_${node.id}`;
    if (raw.includes(".")) return raw;
    return `sensor.canvas_${raw}`;
  };

  return (
    <>
      <style>{canvasStyles}</style>
      <div className="canvas-root">

        {/* ── Palette ── */}
        <div className="canvas-toolbar">
          <h3>Node Types</h3>
          {Object.entries(NODE_TYPES).map(([type, def]) => (
            <div
              key={type}
              className="node-palette-item"
              draggable
              onDragStart={e => e.dataTransfer.setData("nodeType", type)}
            >
              <span>{def.icon}</span>
              <span>{def.label}</span>
            </div>
          ))}
          <div style={{ marginTop: "auto", paddingTop: "1rem", borderTop: "1px solid var(--navy-700)" }}>
            <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", lineHeight: 1.6 }}>
              Drag nodes onto canvas.<br />
              Connect output → input ports.<br />
              Nodes sync to HA automatically.
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div
          className="canvas-area"
          ref={canvasRef}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onDragOver={e => e.preventDefault()}
          onDrop={onCanvasDrop}
          onClick={() => setSelected(null)}
        >
          {/* SVG wires */}
          <svg className="canvas-svg">
            {edges.map(edge => {
              const from = getPortPos(edge.from, "out");
              const to   = getPortPos(edge.to,   "in");
              const cx   = (from.x + to.x) / 2;
              return (
                <g key={edge.id}>
                  <path
                    d={`M${from.x},${from.y} C${cx},${from.y} ${cx},${to.y} ${to.x},${to.y}`}
                    fill="none" stroke="#2d5a8e" strokeWidth="2" strokeDasharray="4 3" opacity="0.7"
                  />
                  <circle cx={from.x} cy={from.y} r="4" fill="#f59e0b" />
                  <circle cx={to.x}   cy={to.y}   r="4" fill="#f59e0b" />
                  {/* delete edge on click */}
                  <path
                    d={`M${from.x},${from.y} C${cx},${from.y} ${cx},${to.y} ${to.x},${to.y}`}
                    fill="none" stroke="transparent" strokeWidth="12" style={{ cursor: "pointer", pointerEvents: "stroke" }}
                    onClick={() => setEdges(prev => prev.filter(e => e.id !== edge.id))}
                  />
                </g>
              );
            })}
            {/* Live wire while dragging */}
            {wiring && (
              <path
                d={`M${wiring.fromPort.x},${wiring.fromPort.y} C${(wiring.fromPort.x + mousePos.x) / 2},${wiring.fromPort.y} ${(wiring.fromPort.x + mousePos.x) / 2},${mousePos.y} ${mousePos.x},${mousePos.y}`}
                fill="none" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" opacity="0.8"
              />
            )}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const def = NODE_TYPES[node.type];
            return (
              <div
                key={node.id}
                className={`canvas-node${selected === node.id ? " selected" : ""}${pulsingNode === node.id ? " node-pulse" : ""}`}
                style={{ left: node.x, top: node.y }}
                onMouseDown={e => onNodeMouseDown(e, node.id)}
              >
                {/* Input port */}
                <div
                  className="node-port in"
                  onMouseDown={e => onPortMouseDown(e, node.id, "in")}
                  onMouseUp={e => onPortMouseUp(e, node.id, "in")}
                />
                {/* Output port */}
                <div
                  className="node-port out"
                  onMouseDown={e => onPortMouseDown(e, node.id, "out")}
                  onMouseUp={e => onPortMouseUp(e, node.id, "out")}
                />

                <button className="node-delete" onMouseDown={e => e.stopPropagation()} onClick={() => deleteNode(node.id)}>✕</button>

                <div className="node-header" style={{ background: def.color + "22", borderBottom: `1px solid ${def.color}44` }}>
                  <span>{def.icon}</span>
                  <span style={{ color: def.color }}>{def.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: "0.6rem", color: "var(--text-dim)", fontFamily: "monospace" }}>
                    {node.id}
                  </span>
                </div>

                <div className="node-body">
                  {def.fields.map(field => (
                    <div key={field.key} className="node-field">
                      <label>{field.label}</label>
                      <input
                        value={node.config[field.key] ?? ""}
                        placeholder={field.placeholder}
                        onMouseDown={e => e.stopPropagation()}
                        onChange={e => updateConfig(node.id, field.key, e.target.value)}
                      />
                    </div>
                  ))}
                  {def.info && (
                    <div style={{ marginTop: "0.5rem", borderTop: `1px solid ${def.color}33`, paddingTop: "0.5rem" }}>
                      <div style={{ fontSize: "0.6rem", color: def.color, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "0.3rem" }}>Integration Notes</div>
                      {def.info.map((line, i) => (
                        <div key={i} style={{ fontSize: "0.63rem", color: "var(--text-dim)", lineHeight: 1.5, marginBottom: "0.15rem" }}>• {line}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {nodes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.25, pointerEvents: "none", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ fontSize: "2rem" }}>⬡</div>
              <div style={{ fontSize: "0.8rem" }}>Drag nodes from the left panel to begin</div>
            </div>
          )}
        </div>

        {/* ── HA Entity Status Panel ── */}
        <div className="ha-panel">
          <div className="ha-panel-header">⊞ HA ENTITIES</div>
          <div className="ha-panel-body">
            {nodes.length === 0 && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", fontStyle: "italic" }}>
                Add nodes to the canvas — they will appear as real HA entities automatically.
              </div>
            )}
            {nodes.map(node => {
              const def = NODE_TYPES[node.type];
              const entityId = resolveEntityId(node);
              const haEntity = haStates[entityId] || haStates[node.config.entity_id];
              const state = haEntity?.state ?? "—";
              const isOn = state === "on" || state === "open" || state === "unlocked";
              const isOff = state === "off" || state === "closed" || state === "locked";
              const stateColor = isOn ? "#4ade80" : isOff ? "var(--text-dim)" : "var(--amber-400)";
              return (
                <div key={node.id} className="ha-entity-row" style={{ borderLeft: `3px solid ${def.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span>{def.icon}</span>
                    <span className="ha-entity-name">{node.config.friendly_name || node.id}</span>
                    <span className="ha-entity-state" style={{ marginLeft: "auto", color: stateColor }}>{state}</span>
                  </div>
                  <div className="ha-entity-id">{entityId}</div>
                  {haEntity && (
                    <div style={{ fontSize: "0.6rem", color: "#4ade80", marginTop: "0.1rem" }}>✓ in HA</div>
                  )}
                  {!haEntity && (
                    <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginTop: "0.1rem" }}>syncing…</div>
                  )}
                </div>
              );
            })}
            {edges.length > 0 && (
              <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--navy-700)" }}>
                <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "0.4rem" }}>Connections ({edges.length})</div>
                {edges.map(e => {
                  const from = nodes.find(n => n.id === e.from);
                  const to   = nodes.find(n => n.id === e.to);
                  return (
                    <div key={e.id} style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontFamily: "monospace", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ color: NODE_TYPES[from?.type]?.color }}>{from?.config.friendly_name || e.from}</span>
                      <span>→</span>
                      <span style={{ color: NODE_TYPES[to?.type]?.color }}>{to?.config.friendly_name || e.to}</span>
                      <span style={{ marginLeft: "auto", cursor: "pointer", color: "#f87171" }}
                        onClick={() => setEdges(prev => prev.filter(eg => eg.id !== e.id))}>✕</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

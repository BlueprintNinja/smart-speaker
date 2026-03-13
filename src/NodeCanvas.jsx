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

.test-panel {
  width: 280px; flex-shrink: 0; background: rgba(6,13,26,0.9);
  border-left: 1px solid var(--navy-700); display: flex; flex-direction: column;
}
.test-panel-header {
  padding: 1rem; border-bottom: 1px solid var(--navy-700);
  font-size: 0.8rem; font-weight: 600; color: var(--amber-400); letter-spacing: 1px;
}
.test-panel-body { flex: 1; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; }
.test-input {
  background: var(--navy-800); border: 1px solid var(--navy-700);
  color: white; border-radius: 6px; padding: 0.5rem; font-family: inherit;
  font-size: 0.8rem; resize: none; outline: none; width: 100%;
}
.test-input:focus { border-color: var(--amber-500); }
.test-run-btn {
  background: var(--amber-500); border: none; color: var(--navy-950);
  font-weight: 700; font-size: 0.8rem; padding: 0.5rem; border-radius: 6px;
  cursor: pointer; letter-spacing: 0.5px;
}
.test-run-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.test-result {
  background: var(--navy-800); border: 1px solid var(--navy-700);
  border-radius: 6px; padding: 0.75rem; font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem; line-height: 1.6; white-space: pre-wrap; overflow-x: auto;
  flex: 1;
}
.test-result.ok   { border-color: #166534; color: #4ade80; }
.test-result.err  { border-color: #7f1d1d; color: #f87171; }
.test-node-select {
  background: var(--navy-800); border: 1px solid var(--navy-700);
  color: var(--text-bright); border-radius: 6px; padding: 0.4rem 0.5rem;
  font-size: 0.78rem; width: 100%; outline: none; cursor: pointer;
}
.test-label { font-size: 0.68rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
.test-action-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.test-action-chip {
  padding: 3px 10px; border-radius: 20px; font-size: 0.68rem; cursor: pointer;
  border: 1px solid var(--navy-600); background: var(--navy-800); color: var(--text-dim);
  transition: all 0.15s;
}
.test-action-chip.selected { background: var(--amber-500); border-color: var(--amber-500); color: var(--navy-950); font-weight: 600; }
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
  const [testCmd, setTestCmd] = useState("");
  const [testNode, setTestNode] = useState("");
  const [testAction, setTestAction] = useState("");
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [chatHighlight, setChatHighlight] = useState(null); // entity_id triggered from chat
  const canvasRef = useRef(null);

  // ── Persist canvas to localStorage ──────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges })); } catch {}
  }, [nodes, edges]);

  // ── Highlight nodes triggered by main chat commands ──────────────────────────
  useEffect(() => {
    if (!lastHaEvent) return;
    const entity = lastHaEvent.entity_id || (lastHaEvent.result || {}).entity_id;
    if (entity) {
      setChatHighlight(entity);
      setTimeout(() => setChatHighlight(null), 3000);
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

  // ── Test a voice command against selected node ──────────────────────────────
  const runTest = async () => {
    if (!testNode && !testCmd.trim()) return;
    setTesting(true);
    setTestResult(null);

    const node = nodes.find(n => n.id === testNode);
    const payload = {
      command: testCmd,
      node: node ? { type: node.type, config: node.config, action: testAction } : null,
      nodes: nodes.map(n => ({ id: n.id, type: n.type, config: n.config })),
      edges,
    };

    try {
      const res = await fetch(`${api}/test_command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setTestResult({ ok: res.ok, data });
    } catch (err) {
      setTestResult({ ok: false, data: { error: err.message } });
    } finally {
      setTesting(false);
    }
  };

  const selectedNodeType = nodes.find(n => n.id === testNode)?.type;

  useEffect(() => {
    setTestAction("");
  }, [testNode]);

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
              Test voice commands in the right panel.
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
                className={`canvas-node${selected === node.id ? " selected" : ""}`}
                style={{
                  left: node.x, top: node.y,
                  ...(chatHighlight && node.config.entity_id === chatHighlight
                    ? { boxShadow: "0 0 0 2px #4ade80, 0 0 20px rgba(74,222,128,0.4)", borderColor: "#4ade80" }
                    : {}),
                }}
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

        {/* ── Test Panel ── */}
        <div className="test-panel">
          <div className="test-panel-header">⚡ COMMAND TESTER</div>
          <div className="test-panel-body">

            <div>
              <div className="test-label" style={{ marginBottom: "0.35rem" }}>Target Node</div>
              <select
                className="test-node-select"
                value={testNode}
                onChange={e => setTestNode(e.target.value)}
              >
                <option value="">— All nodes —</option>
                {nodes.map(n => (
                  <option key={n.id} value={n.id}>
                    {NODE_TYPES[n.type].icon} {n.config.friendly_name || n.id}
                  </option>
                ))}
              </select>
            </div>

            {selectedNodeType && (
              <div>
                <div className="test-label" style={{ marginBottom: "0.35rem" }}>Action</div>
                <div className="test-action-chips">
                  {NODE_TYPES[selectedNodeType].actions.map(a => (
                    <div
                      key={a}
                      className={`test-action-chip${testAction === a ? " selected" : ""}`}
                      onClick={() => setTestAction(a === testAction ? "" : a)}
                    >
                      {a}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="test-label" style={{ marginBottom: "0.35rem" }}>Voice Command</div>
              <textarea
                className="test-input"
                rows={3}
                placeholder={"e.g. Turn on the barn lights\ne.g. Check field 1 moisture\ne.g. Open irrigation zone 2"}
                value={testCmd}
                onChange={e => setTestCmd(e.target.value)}
              />
            </div>

            <button
              className="test-run-btn"
              onClick={runTest}
              disabled={testing || (!testCmd.trim() && !testNode)}
            >
              {testing ? "RUNNING..." : "▶ RUN TEST"}
            </button>

            {testResult && (
              <div className={`test-result ${testResult.ok ? "ok" : "err"}`}>
                {JSON.stringify(testResult.data, null, 2)}
              </div>
            )}

            {edges.length > 0 && (
              <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--navy-700)" }}>
                <div className="test-label" style={{ marginBottom: "0.4rem" }}>Connections ({edges.length})</div>
                {edges.map(e => {
                  const from = nodes.find(n => n.id === e.from);
                  const to   = nodes.find(n => n.id === e.to);
                  return (
                    <div key={e.id} style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontFamily: "monospace", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ color: NODE_TYPES[from?.type]?.color }}>{from?.config.friendly_name || e.from}</span>
                      <span>→</span>
                      <span style={{ color: NODE_TYPES[to?.type]?.color }}>{to?.config.friendly_name || e.to}</span>
                      <span
                        style={{ marginLeft: "auto", cursor: "pointer", color: "#f87171" }}
                        onClick={() => setEdges(prev => prev.filter(eg => eg.id !== e.id))}
                      >✕</span>
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

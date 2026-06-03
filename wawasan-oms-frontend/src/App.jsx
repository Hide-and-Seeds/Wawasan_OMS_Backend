import { useState, useEffect, useCallback, useRef } from "react";

// ─── Mock API (replace BASE_URL with your backend) ─────────────────────────
const BASE_URL = "http://localhost:3001/api";
let _token = localStorage.getItem("oms_token") || "";

async function api(method, path, body, isFormData = false) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${_token}` },
  };
  if (body && !isFormData) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (isFormData) {
    opts.body = body;
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Unknown error");
  }
  return res.json();
}

// ─── Color helpers ──────────────────────────────────────────────────────────
const STAGE_CONFIG = {
  order:              { label: "Order",             color: "#3B82F6", bg: "#EFF6FF" },
  production:         { label: "Production",        color: "#F59E0B", bg: "#FFFBEB" },
  packing:            { label: "Packing",           color: "#8B5CF6", bg: "#F5F3FF" },
  ready_for_delivery: { label: "Ready for Delivery",color: "#10B981", bg: "#ECFDF5" },
  delivered:          { label: "Delivered",         color: "#6B7280", bg: "#F9FAFB" },
  on_hold:            { label: "On Hold",           color: "#EF4444", bg: "#FEF2F2" },
  cancelled:          { label: "Cancelled",         color: "#9CA3AF", bg: "#F3F4F6" },
};

const ROLE_LABELS = {
  super_admin: "Super Admin",
  operations_controller: "Ops Controller",
  production_lead: "Production Lead",
  production_staff: "Production Staff",
  packing_staff: "Packing Staff",
  delivery_team: "Delivery Team",
};

const STAGE_ORDER = ["order","production","packing","ready_for_delivery"];

function Avatar({ name = "?", color = "#3B82F6", size = 32 }) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: color + "22", color: color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.36, fontWeight: 500, flexShrink: 0
    }}>{initials}</div>
  );
}

function Badge({ children, color = "#6B7280" }) {
  return (
    <span style={{
      background: color + "18", color, border: `1px solid ${color}33`,
      borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 500,
      whiteSpace: "nowrap"
    }}>{children}</span>
  );
}

function DeliveryDot({ date }) {
  const days = Math.ceil((new Date(date) - new Date()) / 86400000);
  if (days < 0) return <span style={{ color: "#EF4444", fontSize: 11, fontWeight: 600 }}>⚠ OVERDUE</span>;
  if (days <= 2) return <span style={{ color: "#EF4444", fontSize: 11 }}>🔴 {days}d</span>;
  if (days <= 6) return <span style={{ color: "#F59E0B", fontSize: 11 }}>🟡 {days}d</span>;
  return <span style={{ color: "#10B981", fontSize: 11 }}>🟢 {days}d</span>;
}

function Modal({ open, onClose, title, children, width = 560 }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
    }} onClick={onClose}>
      <div style={{
        background: "white", borderRadius: 12, padding: "24px 28px",
        width, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.15)"
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "#9CA3AF", padding: "2px 6px"
          }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", size = "md", disabled, style = {} }) {
  const base = {
    border: "none", cursor: disabled ? "not-allowed" : "pointer",
    borderRadius: 8, fontWeight: 500, transition: "all 0.15s",
    opacity: disabled ? 0.5 : 1, ...style
  };
  const sizes = { sm: { padding: "6px 12px", fontSize: 13 }, md: { padding: "8px 16px", fontSize: 14 }, lg: { padding: "11px 22px", fontSize: 15 } };
  const variants = {
    primary: { background: "#1E40AF", color: "white" },
    secondary: { background: "#F3F4F6", color: "#374151" },
    danger: { background: "#FEF2F2", color: "#DC2626" },
    success: { background: "#ECFDF5", color: "#059669" },
    ghost: { background: "transparent", color: "#6B7280", padding: 0 },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...sizes[size], ...variants[variant] }}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = "text", required, options, placeholder, readOnly }) {
  const id = label?.toLowerCase().replace(/\s/g, "_");
  const style = {
    width: "100%", padding: "8px 12px", border: "1px solid #E5E7EB",
    borderRadius: 8, fontSize: 14, boxSizing: "border-box",
    background: readOnly ? "#F9FAFB" : "white"
  };
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label htmlFor={id} style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4, color: "#374151" }}>
        {label}{required && <span style={{ color: "#EF4444" }}> *</span>}
      </label>}
      {options ? (
        <select id={id} value={value} onChange={e => onChange(e.target.value)} style={style} disabled={readOnly}>
          {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
        </select>
      ) : (
        <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} required={required} readOnly={readOnly} style={style} />
      )}
    </div>
  );
}

// ─── MOCK DATA (used when API is unavailable) ─────────────────────────────
const MOCK_BOARD = {
  order: [
    { id: "1", invoice_number: "INV-001", customer_name: "Kedai Bunga Jaya", required_delivery_date: new Date(Date.now() + 86400000*7).toISOString().slice(0,10), priority: "normal", pic_name: "Reenee", pic_color: "#0891B2", item_count: 3 },
    { id: "2", invoice_number: "INV-002", customer_name: "Harumni Sdn Bhd", required_delivery_date: new Date(Date.now() + 86400000*2).toISOString().slice(0,10), priority: "urgent", pic_name: "Reenee", pic_color: "#0891B2", item_count: 5 },
  ],
  production: [
    { id: "3", invoice_number: "INV-003", customer_name: "Candle World KL", required_delivery_date: new Date(Date.now() + 86400000*1).toISOString().slice(0,10), priority: "urgent", pic_name: "Misha", pic_color: "#059669", item_count: 2 },
    { id: "4", invoice_number: "INV-004", customer_name: "Gift House Subang", required_delivery_date: new Date(Date.now() + 86400000*5).toISOString().slice(0,10), priority: "normal", pic_name: "Ali", pic_color: "#D97706", item_count: 8 },
  ],
  packing: [
    { id: "5", invoice_number: "INV-005", customer_name: "Aromatherapy Plus", required_delivery_date: new Date(Date.now() + 86400000*3).toISOString().slice(0,10), priority: "normal", pic_name: "Siti", pic_color: "#DB2777", item_count: 4 },
  ],
  ready_for_delivery: [
    { id: "6", invoice_number: "INV-006", customer_name: "Wellness Hub PJ", required_delivery_date: new Date(Date.now() - 86400000*1).toISOString().slice(0,10), priority: "urgent", pic_name: "Raju", pic_color: "#DC2626", item_count: 6 },
  ],
  on_hold: []
};

const MOCK_DASHBOARD = {
  stage_counts: [
    { stage: "order", count: 2 }, { stage: "production", count: 2 },
    { stage: "packing", count: 1 }, { stage: "ready_for_delivery", count: 1 }
  ],
  this_week_orders: 8, this_month_orders: 31, active_staff: 6,
  upcoming_deliveries: [MOCK_BOARD.ready_for_delivery[0]],
  overdue_orders: [MOCK_BOARD.ready_for_delivery[0]]
};

// ─── LOGIN ─────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("admin@wawasancandle.com");
  const [password, setPassword] = useState("Admin@123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
  e.preventDefault();
  setLoading(true); setError("");
  try {
    const data = await api("POST", "/auth/login", { email, password });
    _token = data.token;
    localStorage.setItem("oms_token", data.token);
    onLogin(data.user);
  } catch (err) {
    setLoading(false);
    // Only use demo mode if it looks like a connection error (backend not running)
    if (err.message === "Failed to fetch" || err.message.includes("NetworkError")) {
      setError("⚠️ Cannot reach backend. Starting in demo mode (read-only).");
      setTimeout(() => {
        onLogin({ id: "demo", name: "Boss Admin", email, role: "super_admin", avatar_color: "#7C3AED" });
      }, 1500);
    } else {
      // Real errors like wrong password — show them
      setError(err.message);
    }
  } finally {
    setLoading(false);
  }
}

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC" }}>
      <div style={{ width: 400, background: "white", borderRadius: 16, padding: "40px 36px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🕯️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1E293B", margin: 0 }}>Wawasan Candle</h1>
          <p style={{ color: "#64748B", fontSize: 14, margin: "4px 0 0" }}>Order Management System</p>
        </div>
        <form onSubmit={handleSubmit}>
          <Input label="Email" type="email" value={email} onChange={setEmail} required />
          <Input label="Password" type="password" value={password} onChange={setPassword} required />
          {error && <p style={{ color: "#EF4444", fontSize: 13, margin: "-8px 0 12px" }}>{error}</p>}
          <Btn onClick={() => {}} disabled={loading} style={{ width: "100%" }}>
            {loading ? "Signing in…" : "Sign In"}
          </Btn>
        </form>
        <p style={{ textAlign: "center", fontSize: 12, color: "#94A3B8", marginTop: 20 }}>
          Demo: admin@wawasancandle.com / Admin@123
        </p>
      </div>
    </div>
  );
}

// ─── KANBAN BOARD ─────────────────────────────────────────────────────────
function KanbanCard({ order, onClick, canMove, onMove }) {
  const [showMenu, setShowMenu] = useState(false);
  const cfg = STAGE_CONFIG[order.stage] || STAGE_CONFIG.order;
  const stageIdx = STAGE_ORDER.indexOf(order.stage);
  const nextStage = STAGE_ORDER[stageIdx + 1];

  return (
    <div onClick={() => onClick(order)} style={{
      background: "white", border: order.priority === "urgent" ? "1.5px solid #EF4444" : "1px solid #E5E7EB",
      borderRadius: 10, padding: "12px 14px", cursor: "pointer",
      transition: "box-shadow 0.15s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1E293B" }}>{order.invoice_number}</span>
        <div style={{ display: "flex", gap: 4 }}>
          {order.priority === "urgent" && <Badge color="#EF4444">URGENT</Badge>}
          {canMove && nextStage && (
            <span onClick={e => { e.stopPropagation(); onMove(order, nextStage); }}
              style={{ fontSize: 11, color: "#3B82F6", cursor: "pointer", padding: "2px 6px", borderRadius: 4, border: "1px solid #BFDBFE" }}>
              → {STAGE_CONFIG[nextStage]?.label.split(" ")[0]}
            </span>
          )}
        </div>
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "#374151", fontWeight: 500 }}>{order.customer_name}</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <DeliveryDot date={order.required_delivery_date} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#9CA3AF" }}>{order.item_count} items</span>
          {order.pic_name && <Avatar name={order.pic_name} color={order.pic_color} size={22} />}
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({ user, onSelectOrder }) {
  const [board, setBoard] = useState(null);
  const [weekOnly, setWeekOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const canMove = ["super_admin", "operations_controller"].includes(user.role);

  async function load() {
    setLoading(true);
    try {
      const data = await api("GET", `/orders/kanban${weekOnly ? "?week=current" : ""}`);
      setBoard(data);
    } catch {
      setBoard(MOCK_BOARD);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [weekOnly]);

  async function handleMove(order, toStage) {
    try {
      await api("POST", `/orders/${order.id}/move`, { to_stage: toStage });
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  const filterOrders = (orders) => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      o.invoice_number.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q)
    );
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Loading board…</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="🔍  Search invoice / customer…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "8px 14px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 14 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#374151", cursor: "pointer" }}>
          <input type="checkbox" checked={weekOnly} onChange={e => setWeekOnly(e.target.checked)} />
          This week only
        </label>
        <Btn onClick={load} variant="secondary" size="sm">↺ Refresh</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, minWidth: 800 }}>
        {STAGE_ORDER.map(stage => {
          const cfg = STAGE_CONFIG[stage];
          const orders = filterOrders(board[stage] || []);
          return (
            <div key={stage} style={{ background: cfg.bg, borderRadius: 12, padding: "14px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                <span style={{
                  background: cfg.color, color: "white",
                  borderRadius: 20, padding: "1px 8px", fontSize: 12, fontWeight: 600
                }}>{orders.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {orders.map(o => (
                  <KanbanCard key={o.id} order={o} onClick={onSelectOrder} canMove={canMove} onMove={handleMove} />
                ))}
                {orders.length === 0 && (
                  <div style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, padding: "20px 0" }}>No orders</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ORDER DETAIL ──────────────────────────────────────────────────────────
function OrderDetail({ orderId, user, onClose, onUpdated }) {
  const [order, setOrder] = useState(null);
  const [tab, setTab] = useState("details");
  const [moveStage, setMoveStage] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [showMoveForm, setShowMoveForm] = useState(false);
  const canMove = ["super_admin", "operations_controller"].includes(user.role);

  async function load() {
    try {
      const data = await api("GET", `/orders/${orderId}`);
      setOrder(data);
    } catch {
      // mock order detail
      const allOrders = Object.values(MOCK_BOARD).flat();
      const o = allOrders.find(x => x.id === orderId);
      if (o) setOrder({
        ...o, stage: o.stage || "order", notes: "Sample order notes.",
        order_date: new Date().toISOString().slice(0,10),
        expiry_date: new Date(Date.now() + 86400000*90).toISOString().slice(0,10),
        items: [
          { id: "i1", sku: "CND-001", name: "Lavender Candle 200g", quantity: 100, unit: "pcs" },
          { id: "i2", sku: "CND-002", name: "Vanilla Candle 150g", quantity: 50, unit: "pcs" },
        ],
        activity: [
          { id: "a1", action: "order_created", user_name: "Reenee", details: "Order created", created_at: new Date().toISOString() },
        ],
        transitions: [], attachments: []
      });
    }
  }

  useEffect(() => { load(); }, [orderId]);

  async function handleMove() {
    if (!moveStage) return;
    try {
      await api("POST", `/orders/${orderId}/move`, { to_stage: moveStage, reason: moveReason });
      setShowMoveForm(false); setMoveStage(""); setMoveReason("");
      load(); onUpdated?.();
    } catch (err) { alert(err.message); }
  }

  if (!order) return <div style={{ padding: 40, textAlign: "center" }}>Loading…</div>;

  const stageCfg = STAGE_CONFIG[order.stage] || STAGE_CONFIG.order;
  const tabs = ["details", "timeline", "items", "attachments"];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Badge color={stageCfg.color}>{stageCfg.label}</Badge>
        {order.priority === "urgent" && <Badge color="#EF4444">URGENT</Badge>}
        <span style={{ fontSize: 13, color: "#64748B" }}>{order.created_by_name} · {order.order_date}</span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", marginBottom: 20, gap: 4 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", padding: "8px 14px", cursor: "pointer",
            fontSize: 13, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "#1E40AF" : "#6B7280",
            borderBottom: tab === t ? "2px solid #1E40AF" : "2px solid transparent",
            textTransform: "capitalize"
          }}>{t}</button>
        ))}
      </div>

      {tab === "details" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <LabelValue label="Customer" value={order.customer_name} />
          <LabelValue label="Contact" value={order.customer_contact || "—"} />
          <LabelValue label="Delivery Date" value={<><DeliveryDot date={order.required_delivery_date} /> {order.required_delivery_date}</>} />
          <LabelValue label="Expiry Date" value={order.expiry_date || "—"} />
          <LabelValue label="PIC" value={order.pic_name ? <div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar name={order.pic_name} color={order.pic_color} size={24} />{order.pic_name}</div> : "Not assigned"} />
          <LabelValue label="Source" value={order.source === "sql_account" ? "SQL Account" : "Manual"} />
          {order.notes && <div style={{ gridColumn: "span 2" }}><LabelValue label="Notes" value={order.notes} /></div>}
        </div>
      )}

      {tab === "timeline" && (
        <div>
          {(order.activity || []).map(a => (
            <div key={a.id} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3B82F6", marginTop: 5, flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#1E293B" }}>{a.user_name}</span>
                <span style={{ fontSize: 13, color: "#64748B" }}> — {a.details || a.action}</span>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{new Date(a.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "items" && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              {["SKU", "Product", "Qty", "Unit"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #E5E7EB" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(order.items || []).map(item => (
              <tr key={item.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 12px", color: "#64748B", fontFamily: "monospace" }}>{item.sku}</td>
                <td style={{ padding: "8px 12px" }}>{item.name}</td>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{item.quantity}</td>
                <td style={{ padding: "8px 12px", color: "#64748B" }}>{item.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "attachments" && (
        <div>
          {(order.attachments || []).length === 0 && <p style={{ color: "#94A3B8", fontSize: 14 }}>No attachments yet.</p>}
          {(order.attachments || []).map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span>📎</span>
              <span style={{ fontSize: 13 }}>{a.original_name}</span>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>{a.uploaded_by_name}</span>
            </div>
          ))}
        </div>
      )}

      {canMove && (
        <div style={{ marginTop: 24, borderTop: "1px solid #E5E7EB", paddingTop: 16 }}>
          {!showMoveForm ? (
            <Btn onClick={() => setShowMoveForm(true)} variant="primary" size="sm">Move Stage…</Btn>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <select value={moveStage} onChange={e => setMoveStage(e.target.value)}
                  style={{ flex: 1, minWidth: 180, padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 14 }}>
                  <option value="">Select stage…</option>
                  {Object.entries(STAGE_CONFIG).map(([k, v]) =>
                    k !== order.stage && <option key={k} value={k}>{v.label}</option>
                  )}
                </select>
                <input placeholder="Reason (optional)" value={moveReason} onChange={e => setMoveReason(e.target.value)}
                  style={{ flex: 2, padding: "8px 12px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 14 }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={handleMove} disabled={!moveStage} size="sm">Confirm Move</Btn>
                <Btn onClick={() => setShowMoveForm(false)} variant="secondary" size="sm">Cancel</Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabelValue({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#1E293B" }}>{value}</div>
    </div>
  );
}

// ─── CREATE ORDER FORM ────────────────────────────────────────────────────
function CreateOrderForm({ onCreated, onClose }) {
  const [form, setForm] = useState({
    invoice_number: "", customer_name: "", customer_contact: "",
    required_delivery_date: "", priority: "normal", skip_production: false, notes: ""
  });
  const [items, setItems] = useState([{ sku: "", name: "", quantity: 1, unit: "pcs" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit() {
    if (!form.invoice_number || !form.customer_name || !form.required_delivery_date) {
      setError("Invoice number, customer name, and delivery date are required."); return;
    }
    setLoading(true); setError("");
    try {
      await api("POST", "/orders", { ...form, items: items.filter(i => i.name) });
      onCreated?.();
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Input label="Invoice Number" value={form.invoice_number} onChange={v => set("invoice_number", v)} required placeholder="INV-2024-001" />
        <Input label="Priority" value={form.priority} onChange={v => set("priority", v)} options={[{ value: "normal", label: "Normal" }, { value: "urgent", label: "🔴 Urgent" }]} />
        <Input label="Customer Name" value={form.customer_name} onChange={v => set("customer_name", v)} required placeholder="Customer Sdn Bhd" />
        <Input label="Contact" value={form.customer_contact} onChange={v => set("customer_contact", v)} placeholder="01X-XXXXXXX" />
        <Input label="Required Delivery Date" type="date" value={form.required_delivery_date} onChange={v => set("required_delivery_date", v)} required />
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
          <input type="checkbox" id="skip_prod" checked={form.skip_production} onChange={e => set("skip_production", e.target.checked)} />
          <label htmlFor="skip_prod" style={{ fontSize: 13, color: "#374151" }}>Skip production (go direct to packing)</label>
        </div>
      </div>
      <Input label="Notes" value={form.notes} onChange={v => set("notes", v)} placeholder="Optional notes…" />

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Order Items</div>
        {items.map((item, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 80px 32px", gap: 6, marginBottom: 6, alignItems: "center" }}>
            <input placeholder="SKU" value={item.sku} onChange={e => setItems(it => it.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))}
              style={{ padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13 }} />
            <input placeholder="Product name" value={item.name} onChange={e => setItems(it => it.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              style={{ padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13 }} />
            <input type="number" min="1" placeholder="Qty" value={item.quantity} onChange={e => setItems(it => it.map((x, j) => j === i ? { ...x, quantity: +e.target.value } : x))}
              style={{ padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13 }} />
            <input placeholder="Unit" value={item.unit} onChange={e => setItems(it => it.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}
              style={{ padding: "7px 10px", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 13 }} />
            <button onClick={() => setItems(it => it.filter((_, j) => j !== i))} style={{ background: "#FEF2F2", border: "none", borderRadius: 6, cursor: "pointer", color: "#EF4444", fontSize: 16, height: 32 }}>×</button>
          </div>
        ))}
        <Btn onClick={() => setItems(it => [...it, { sku: "", name: "", quantity: 1, unit: "pcs" }])} variant="secondary" size="sm">+ Add Item</Btn>
      </div>

      {error && <p style={{ color: "#EF4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn onClick={onClose} variant="secondary">Cancel</Btn>
        <Btn onClick={handleSubmit} disabled={loading}>{loading ? "Creating…" : "Create Order"}</Btn>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────
function Dashboard() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("week");

  useEffect(() => {
    api("GET", "/reports/dashboard").then(setData).catch(() => setData(MOCK_DASHBOARD));
  }, []);

  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Loading…</div>;

  const stageCounts = Object.fromEntries((data.stage_counts || []).map(s => [s.stage, s.count]));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 28 }}>
        {[
          { label: "This Week", value: data.this_week_orders, icon: "📋", color: "#3B82F6" },
          { label: "This Month", value: data.this_month_orders, icon: "📅", color: "#8B5CF6" },
          { label: "Active Staff", value: data.active_staff, icon: "👥", color: "#10B981" },
          { label: "Overdue", value: (data.overdue_orders || []).length, icon: "⚠️", color: "#EF4444" },
        ].map(({ label, value, icon, color }) => (
          <div key={label} style={{ background: "white", borderRadius: 12, padding: "16px 18px", border: "1px solid #E5E7EB" }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "white", borderRadius: 12, padding: "18px 20px", border: "1px solid #E5E7EB" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px", color: "#374151" }}>Orders by Stage</h3>
          {STAGE_ORDER.map(stage => {
            const cfg = STAGE_CONFIG[stage];
            const count = stageCounts[stage] || 0;
            const max = Math.max(...STAGE_ORDER.map(s => stageCounts[s] || 0), 1);
            return (
              <div key={stage} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
                  <span style={{ fontWeight: 600 }}>{count}</span>
                </div>
                <div style={{ height: 6, background: "#F1F5F9", borderRadius: 3 }}>
                  <div style={{ height: 6, width: `${(count / max) * 100}%`, background: cfg.color, borderRadius: 3, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background: "white", borderRadius: 12, padding: "18px 20px", border: "1px solid #E5E7EB" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 14px", color: "#374151" }}>Upcoming Deliveries (7 days)</h3>
          {(data.upcoming_deliveries || []).length === 0 && <p style={{ color: "#94A3B8", fontSize: 13 }}>No upcoming deliveries.</p>}
          {(data.upcoming_deliveries || []).map(o => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9", fontSize: 13 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{o.invoice_number}</span>
                <span style={{ color: "#64748B", marginLeft: 8 }}>{o.customer_name}</span>
              </div>
              <DeliveryDot date={o.required_delivery_date} />
            </div>
          ))}
        </div>
      </div>

      {(data.overdue_orders || []).length > 0 && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 12, padding: "16px 20px", marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#DC2626", margin: "0 0 10px" }}>⚠ Overdue Orders</h3>
          {data.overdue_orders.map(o => (
            <div key={o.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0" }}>
              <span style={{ fontWeight: 600 }}>{o.invoice_number}</span>
              <span style={{ color: "#64748B" }}>{o.customer_name}</span>
              <span style={{ color: "#DC2626" }}>{o.required_delivery_date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────────
function Reports() {
  const [tab, setTab] = useState("production");
  const [period, setPeriod] = useState("weekly");
  const [data, setData] = useState({});

  useEffect(() => {
    api("GET", `/reports/${tab}?period=${period}`)
      .then(d => setData(d))
      .catch(() => setData({
        completed: 42, rework_count: 3, rework_rate: "7.1",
        avg_production_hours: "14.2", on_time_rate: "88.1",
        packed: 38, avg_pack_minutes: "47",
        total_deliveries: 29, on_time_count: 26, on_time_rate: "89.7",
        daily_trend: [
          { date: "Mon", count: 8 }, { date: "Tue", count: 12 },
          { date: "Wed", count: 7 }, { date: "Thu", count: 11 }, { date: "Fri", count: 4 }
        ]
      }));
  }, [tab, period]);

  const tabs = [
    { id: "production", label: "Production" },
    { id: "packing", label: "Packing" },
    { id: "delivery", label: "Delivery" },
  ];

  const metrics = {
    production: [
      { label: "Orders Completed", value: data.completed, color: "#3B82F6" },
      { label: "On-Time Rate", value: data.on_time_rate ? `${data.on_time_rate}%` : "—", color: "#10B981" },
      { label: "Avg Production Time", value: data.avg_production_hours ? `${data.avg_production_hours}h` : "—", color: "#8B5CF6" },
      { label: "Rework Rate", value: data.rework_rate ? `${data.rework_rate}%` : "—", color: "#EF4444" },
    ],
    packing: [
      { label: "Orders Packed", value: data.packed, color: "#3B82F6" },
      { label: "Avg Pack Time", value: data.avg_pack_minutes ? `${data.avg_pack_minutes}min` : "—", color: "#8B5CF6" },
      { label: "Rework Rate", value: data.rework_rate ? `${data.rework_rate}%` : "—", color: "#EF4444" },
    ],
    delivery: [
      { label: "Total Deliveries", value: data.total_deliveries, color: "#3B82F6" },
      { label: "On-Time Rate", value: data.on_time_rate ? `${data.on_time_rate}%` : "—", color: "#10B981" },
      { label: "On-Time Count", value: data.on_time_count, color: "#8B5CF6" },
    ],
  };

  const trend = data.daily_trend || [];
  const maxTrend = Math.max(...trend.map(t => t.count), 1);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 4, background: "#F1F5F9", borderRadius: 10, padding: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: tab === t.id ? "white" : "transparent",
              border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? "#1E293B" : "#64748B"
            }}>{t.label}</button>
          ))}
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          style={{ padding: "7px 12px", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13 }}>
          <option value="daily">Today</option>
          <option value="weekly">This Week</option>
          <option value="monthly">This Month</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {(metrics[tab] || []).map(({ label, value, color }) => (
          <div key={label} style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color }}>{value ?? "—"}</div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {trend.length > 0 && (
        <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: 12, padding: "18px 20px" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#374151", margin: "0 0 16px" }}>Daily Trend</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 100 }}>
            {trend.map((t, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#64748B" }}>{t.count}</span>
                <div style={{
                  width: "100%", background: "#3B82F6", borderRadius: "4px 4px 0 0",
                  height: `${(t.count / maxTrend) * 70}px`, minHeight: 4, transition: "height 0.4s"
                }} />
                <span style={{ fontSize: 10, color: "#9CA3AF" }}>{String(t.date).slice(-3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── USERS MANAGEMENT ────────────────────────────────────────────────────
function UsersPage({ user }) {
  const [users, setUsers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "production_staff", password: "" });

  useEffect(() => {
    api("GET", "/users").then(setUsers).catch(() => setUsers([
      { id: "1", name: "Boss Admin", email: "admin@wawasancandle.com", role: "super_admin", is_active: 1, avatar_color: "#7C3AED" },
      { id: "2", name: "Reenee", email: "reenee@wawasancandle.com", role: "operations_controller", is_active: 1, avatar_color: "#0891B2" },
      { id: "3", name: "Misha", email: "misha@wawasancandle.com", role: "production_lead", is_active: 1, avatar_color: "#059669" },
      { id: "4", name: "Staff Ali", email: "ali@wawasancandle.com", role: "production_staff", is_active: 1, avatar_color: "#D97706" },
      { id: "5", name: "Staff Siti", email: "siti@wawasancandle.com", role: "packing_staff", is_active: 1, avatar_color: "#DB2777" },
      { id: "6", name: "Driver Raju", email: "raju@wawasancandle.com", role: "delivery_team", is_active: 1, avatar_color: "#DC2626" },
    ]));
  }, []);

  async function handleCreate() {
    try {
      await api("POST", "/users", form);
      setShowCreate(false);
      api("GET", "/users").then(setUsers);
    } catch (err) { alert(err.message); }
  }

  const isAdmin = user.role === "super_admin";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {isAdmin && <Btn onClick={() => setShowCreate(true)} size="sm">+ Add User</Btn>}
      </div>
      <div style={{ background: "white", borderRadius: 12, border: "1px solid #E5E7EB", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#F8FAFC" }}>
              {["User", "Email", "Role", "Status"].map(h => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #E5E7EB" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={u.name} color={u.avatar_color} size={32} />
                    <span style={{ fontWeight: 500 }}>{u.name}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", color: "#64748B" }}>{u.email}</td>
                <td style={{ padding: "12px 16px" }}><Badge color="#6B7280">{ROLE_LABELS[u.role] || u.role}</Badge></td>
                <td style={{ padding: "12px 16px" }}>
                  <Badge color={u.is_active ? "#10B981" : "#EF4444"}>{u.is_active ? "Active" : "Disabled"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create New User">
        <Input label="Full Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} required />
        <Input label="Email" type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} required />
        <Input label="Role" value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} options={Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
        <Input label="Password" type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} required />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
          <Btn onClick={() => setShowCreate(false)} variant="secondary">Cancel</Btn>
          <Btn onClick={handleCreate}>Create User</Btn>
        </div>
      </Modal>
    </div>
  );
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────
function NotificationsPanel({ onClose }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api("GET", "/notifications").then(d => setItems(d.notifications || [])).catch(() => setItems([
      { id: "n1", type: "pic_assigned", title: "You are assigned to INV-003", message: "By Reenee", is_read: 0, created_at: new Date().toISOString() },
      { id: "n2", type: "order_overdue", title: "INV-006 is overdue", message: "Delivery was due yesterday", is_read: 0, created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: "n3", type: "urgent_flag", title: "INV-002 flagged URGENT", message: "", is_read: 1, created_at: new Date(Date.now() - 7200000).toISOString() },
    ]));
  }, []);

  async function markAllRead() {
    await api("PATCH", "/notifications/read-all").catch(() => {});
    setItems(items.map(i => ({ ...i, is_read: 1 })));
  }

  const icons = { pic_assigned: "👤", order_stage_entered: "📦", urgent_flag: "🔴", order_overdue: "⚠️", weekly_remark: "📝", rework_returned: "↩️" };

  return (
    <div style={{
      position: "fixed", top: 56, right: 16, width: 340, background: "white",
      borderRadius: 12, border: "1px solid #E5E7EB", boxShadow: "0 8px 30px rgba(0,0,0,0.12)", zIndex: 500
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #E5E7EB" }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={markAllRead} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#3B82F6" }}>Mark all read</button>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#9CA3AF" }}>×</button>
        </div>
      </div>
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {items.length === 0 && <div style={{ padding: "24px 16px", textAlign: "center", color: "#94A3B8", fontSize: 14 }}>All caught up!</div>}
        {items.map(n => (
          <div key={n.id} style={{
            padding: "12px 16px", borderBottom: "1px solid #F1F5F9",
            background: n.is_read ? "transparent" : "#EFF6FF"
          }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 16 }}>{icons[n.type] || "🔔"}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: "#1E293B" }}>{n.title}</div>
                {n.message && <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{n.message}</div>}
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>{new Date(n.created_at).toLocaleString()}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("board");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [boardKey, setBoardKey] = useState(0);

  useEffect(() => {
    const savedToken = localStorage.getItem("oms_token");
    if (savedToken) {
      _token = savedToken;
      api("GET", "/auth/me").then(d => setUser(d.user)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    api("GET", "/notifications?unread_only=1").then(d => setUnreadCount(d.unread_count || 0)).catch(() => setUnreadCount(2));
    const t = setInterval(() => {
      api("GET", "/notifications?unread_only=1").then(d => setUnreadCount(d.unread_count || 0)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [user]);

  function handleLogout() {
    api("POST", "/auth/logout").catch(() => {});
    _token = "";
    localStorage.removeItem("oms_token");
    setUser(null);
  }

  if (!user) return <LoginPage onLogin={setUser} />;

  const canCreateOrder = ["super_admin", "operations_controller"].includes(user.role);

  const navItems = [
    { id: "board", label: "Kanban Board", icon: "🗂️", roles: null },
    { id: "dashboard", label: "Dashboard", icon: "📊", roles: ["super_admin", "operations_controller"] },
    { id: "reports", label: "Reports", icon: "📈", roles: ["super_admin", "operations_controller"] },
    { id: "users", label: "Users", icon: "👥", roles: ["super_admin"] },
  ].filter(n => !n.roles || n.roles.includes(user.role));

  const pageTitles = { board: "Kanban Board", dashboard: "Dashboard", reports: "Performance Reports", users: "User Management" };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{
        background: "white", borderBottom: "1px solid #E5E7EB",
        padding: "0 20px", height: 52, display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 20 }}>🕯️</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#1E293B" }}>Wawasan OMS</span>
          <div style={{ display: "flex", gap: 2 }}>
            {navItems.map(n => (
              <button key={n.id} onClick={() => setPage(n.id)} style={{
                background: page === n.id ? "#EFF6FF" : "transparent",
                border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                fontSize: 13, color: page === n.id ? "#1E40AF" : "#64748B", fontWeight: page === n.id ? 600 : 400
              }}>
                {n.icon} {n.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canCreateOrder && (
            <Btn onClick={() => setShowCreateOrder(true)} size="sm">+ New Order</Btn>
          )}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowNotifs(!showNotifs)} style={{
              background: "none", border: "1px solid #E5E7EB", borderRadius: 8,
              padding: "6px 10px", cursor: "pointer", fontSize: 16, position: "relative"
            }}>🔔
              {unreadCount > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -4,
                  background: "#EF4444", color: "white", borderRadius: "50%",
                  width: 16, height: 16, fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center"
                }}>{unreadCount}</span>
              )}
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: "1px solid #E5E7EB", paddingLeft: 10 }}>
            <Avatar name={user.name} color={user.avatar_color} size={28} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#1E293B" }}>{user.name}</div>
              <div style={{ fontSize: 11, color: "#94A3B8" }}>{ROLE_LABELS[user.role]}</div>
            </div>
            <button onClick={handleLogout} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", fontSize: 12 }}>Sign out</button>
          </div>
        </div>
      </div>

      {/* Notifications panel */}
      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}

      {/* Main content */}
      <div style={{ padding: "24px 24px", maxWidth: 1400, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1E293B", margin: "0 0 20px" }}>{pageTitles[page]}</h1>

        {page === "board" && (
          <div style={{ overflowX: "auto" }}>
            <KanbanBoard key={boardKey} user={user} onSelectOrder={o => setSelectedOrderId(o.id)} />
          </div>
        )}
        {page === "dashboard" && <Dashboard />}
        {page === "reports" && <Reports />}
        {page === "users" && <UsersPage user={user} />}
      </div>

      {/* Order Detail Modal */}
      <Modal open={!!selectedOrderId} onClose={() => setSelectedOrderId(null)} title="Order Detail" width={640}>
        {selectedOrderId && (
          <OrderDetail
            orderId={selectedOrderId} user={user}
            onClose={() => setSelectedOrderId(null)}
            onUpdated={() => setBoardKey(k => k + 1)}
          />
        )}
      </Modal>

      {/* Create Order Modal */}
      <Modal open={showCreateOrder} onClose={() => setShowCreateOrder(false)} title="Create New Order" width={600}>
        <CreateOrderForm
          onCreated={() => { setShowCreateOrder(false); setBoardKey(k => k + 1); }}
          onClose={() => setShowCreateOrder(false)}
        />
      </Modal>
    </div>
  );
}

// src/routes/reports.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const ADMIN_ROLES = ['super_admin', 'operations_controller'];
// Back-office Admin (deputy) gets the read-only Dashboard overview — but NOT the
// detailed Reports tabs (those stay Boss/Ops/Lead).
const DASHBOARD_ROLES = ['super_admin', 'operations_controller', 'admin'];
// Production Lead (floor supervisor) may see the name-free reports: production,
// packing, and the per-person staff / person-in-charge tables. Orders and the
// dashboard stay Boss/Ops only — they list customer names. Delivery is the
// coordinator's domain, not the lead's.
const PROD_REPORT_ROLES = ['super_admin', 'operations_controller', 'production_lead'];
const DELIVERY_REPORT_ROLES = ['super_admin', 'operations_controller'];

// GET /api/reports/dashboard — boss overview
router.get('/dashboard', authenticate, authorize(...DASHBOARD_ROLES), asyncHandler(async (req, res) => {
  const stageCounts = (await query(`
    SELECT stage, COUNT(*)::int AS count FROM orders
    WHERE stage NOT IN ('delivered','cancelled')
    GROUP BY stage
  `)).rows;

  const thisWeekOrders = (await query(`
    SELECT COUNT(*)::int AS count FROM orders
    WHERE date_trunc('week', created_at) = date_trunc('week', now())
  `)).rows[0];

  const thisMonthOrders = (await query(`
    SELECT COUNT(*)::int AS count FROM orders
    WHERE date_trunc('month', created_at) = date_trunc('month', now())
  `)).rows[0];

  const upcomingDeliveries = (await query(`
    SELECT o.*, u.name AS pic_name FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.stage = 'ready_for_delivery'
      AND o.required_delivery_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    ORDER BY o.required_delivery_date ASC
  `)).rows;

  const overdueOrders = (await query(`
    SELECT o.*, u.name AS pic_name FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.required_delivery_date < CURRENT_DATE
      AND o.stage NOT IN ('delivered','cancelled')
    ORDER BY o.required_delivery_date ASC
  `)).rows;

  const activeStaff = (await query("SELECT COUNT(*)::int AS count FROM users WHERE is_active = true")).rows[0];

  res.json({
    stage_counts: stageCounts,
    this_week_orders: thisWeekOrders.count,
    this_month_orders: thisMonthOrders.count,
    upcoming_deliveries: upcomingDeliveries,
    overdue_orders: overdueOrders,
    active_staff: activeStaff.count
  });
}));

// GET /api/reports/production — production performance
router.get('/production', authenticate, authorize(...PROD_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;

  let dateFilter = '';
  const params = [];

  if (from && to) {
    dateFilter = 'AND st.created_at BETWEEN $1 AND $2';
    params.push(from, to);
  } else if (period === 'daily') {
    dateFilter = "AND st.created_at::date = CURRENT_DATE";
  } else if (period === 'weekly') {
    dateFilter = "AND date_trunc('week', st.created_at) = date_trunc('week', now())";
  } else if (period === 'monthly') {
    dateFilter = "AND date_trunc('month', st.created_at) = date_trunc('month', now())";
  }

  // Orders completed through production
  const completedProduction = (await query(`
    SELECT COUNT(DISTINCT st.order_id)::int AS count
    FROM stage_transitions st
    WHERE st.from_stage = 'production' AND st.to_stage = 'packing'
    ${dateFilter}
  `, params)).rows[0];

  // Rework rate (packing → production)
  const reworks = (await query(`
    SELECT COUNT(*)::int AS count FROM stage_transitions st
    WHERE st.from_stage = 'packing' AND st.to_stage = 'production'
    ${dateFilter}
  `, params)).rows[0];

  // Avg production time (hours)
  const avgTime = (await query(`
    SELECT AVG(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 3600.0) AS avg_hours
    FROM stage_transitions t1
    JOIN stage_transitions t2 ON t1.order_id = t2.order_id
    WHERE t1.to_stage = 'production' AND t2.from_stage = 'production'
    ${dateFilter.replace(/st\./g, 't1.')}
  `, params)).rows[0];

  // On-time rate
  const onTime = (await query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN st.created_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM stage_transitions st
    JOIN orders o ON st.order_id = o.id
    WHERE st.from_stage = 'production' AND st.to_stage = 'packing'
    ${dateFilter}
  `, params)).rows[0];

  // Daily trend (last 14 days)
  const dailyTrend = (await query(`
    SELECT st.created_at::date AS date, COUNT(DISTINCT st.order_id)::int AS count
    FROM stage_transitions st
    WHERE st.from_stage = 'production'
      AND st.created_at >= CURRENT_DATE - INTERVAL '14 days'
    GROUP BY st.created_at::date
    ORDER BY date ASC
  `)).rows;

  // Units (SKU lines) finished in the period + how many orders sit in production right now.
  const itemFilter = dateFilter.replace(/st\.created_at/g, 'oi.made_at');
  const unitsMade = (await query(`
    SELECT COUNT(*)::int AS count FROM order_items oi
    WHERE oi.status = 'done' AND oi.made_at IS NOT NULL ${itemFilter}
  `, params)).rows[0];
  const inStage = (await query("SELECT COUNT(*)::int AS count FROM orders WHERE stage = 'production'")).rows[0];

  res.json({
    completed: completedProduction.count,
    units_made: unitsMade.count,
    in_stage: inStage.count,
    rework_count: reworks.count,
    rework_rate: completedProduction.count > 0
      ? ((reworks.count / completedProduction.count) * 100).toFixed(1)
      : 0,
    avg_production_hours: avgTime.avg_hours != null ? Number(avgTime.avg_hours).toFixed(1) : null,
    on_time_rate: onTime.total > 0
      ? ((onTime.on_time / onTime.total) * 100).toFixed(1)
      : 0,
    daily_trend: dailyTrend
  });
}));

// GET /api/reports/packing — packing performance
router.get('/packing', authenticate, authorize(...PROD_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;

  const params = [];
  let dateFilter = '';
  if (from && to) { dateFilter = 'AND created_at BETWEEN $1 AND $2'; params.push(from, to); }
  else if (period === 'daily') dateFilter = "AND created_at::date = CURRENT_DATE";
  else if (period === 'weekly') dateFilter = "AND date_trunc('week', created_at) = date_trunc('week', now())";
  else if (period === 'monthly') dateFilter = "AND date_trunc('month', created_at) = date_trunc('month', now())";

  const packed = (await query(`
    SELECT COUNT(*)::int AS count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'ready_for_delivery'
    ${dateFilter}
  `, params)).rows[0];

  const avgPackTime = (await query(`
    SELECT AVG(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 60.0) AS avg_minutes
    FROM stage_transitions t1
    JOIN stage_transitions t2 ON t1.order_id = t2.order_id
    WHERE t1.to_stage = 'packing' AND t2.from_stage = 'packing'
    ${dateFilter.replace(/created_at/g, 't1.created_at')}
  `, params)).rows[0];

  const reworks = (await query(`
    SELECT COUNT(*)::int AS count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'production'
    ${dateFilter}
  `, params)).rows[0];

  const inStage = (await query("SELECT COUNT(*)::int AS count FROM orders WHERE stage = 'packing'")).rows[0];

  // Daily packed count (last 14 days) for the trend chart.
  const dailyTrend = (await query(`
    SELECT created_at::date AS date, COUNT(*)::int AS count
    FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'ready_for_delivery'
      AND created_at >= CURRENT_DATE - INTERVAL '14 days'
    GROUP BY created_at::date ORDER BY date ASC
  `)).rows;

  res.json({
    packed: packed.count,
    in_stage: inStage.count,
    rework_count: reworks.count,
    rework_rate: packed.count > 0 ? ((reworks.count / packed.count) * 100).toFixed(1) : 0,
    avg_pack_minutes: avgPackTime.avg_minutes != null ? Number(avgPackTime.avg_minutes).toFixed(0) : null,
    daily_trend: dailyTrend
  });
}));

// GET /api/reports/delivery — delivery performance
router.get('/delivery', authenticate, authorize(...DELIVERY_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;

  const params = [];
  let dateFilter = '';
  if (from && to) { dateFilter = 'AND d.delivered_at BETWEEN $1 AND $2'; params.push(from, to); }
  else if (period === 'daily') dateFilter = "AND d.delivered_at::date = CURRENT_DATE";
  else if (period === 'weekly') dateFilter = "AND date_trunc('week', d.delivered_at) = date_trunc('week', now())";
  else if (period === 'monthly') dateFilter = "AND date_trunc('month', d.delivered_at) = date_trunc('month', now())";

  const totalDeliveries = (await query(`
    SELECT COUNT(*)::int AS count FROM deliveries d WHERE d.status = 'delivered' ${dateFilter}
  `, params)).rows[0];

  const onTime = (await query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    WHERE d.status = 'delivered' ${dateFilter}
  `, params)).rows[0];

  // Avg turnaround: hours from when the delivery record was created to delivered.
  const turnaround = (await query(`
    SELECT AVG(EXTRACT(EPOCH FROM (d.delivered_at - d.created_at)) / 3600.0) AS avg_hours
    FROM deliveries d
    WHERE d.status = 'delivered' AND d.delivered_at IS NOT NULL ${dateFilter}
  `, params)).rows[0];

  const byDeliveryMan = (await query(`
    SELECT COALESCE(dl.id, u.id) AS id, COALESCE(dl.name, u.name) AS name,
      COUNT(*)::int AS total,
      SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM deliveries d
    LEFT JOIN deliverers dl ON d.deliverer_id = dl.id
    LEFT JOIN users u ON d.delivery_man_id = u.id
    JOIN orders o ON d.order_id = o.id
    WHERE d.status = 'delivered' ${dateFilter}
    GROUP BY COALESCE(dl.id, u.id), COALESCE(dl.name, u.name) ORDER BY total DESC
  `, params)).rows;

  // Live snapshot, not period-bound: deliveries still out, and ones that failed.
  const pending = (await query("SELECT COUNT(*)::int AS count FROM deliveries WHERE status IN ('pending','in_transit')")).rows[0];
  const failed = (await query("SELECT COUNT(*)::int AS count FROM deliveries WHERE status = 'failed'")).rows[0];

  // Daily delivered count (last 14 days) for the trend chart.
  const dailyTrend = (await query(`
    SELECT d.delivered_at::date AS date, COUNT(*)::int AS count
    FROM deliveries d
    WHERE d.status = 'delivered' AND d.delivered_at >= CURRENT_DATE - INTERVAL '14 days'
    GROUP BY d.delivered_at::date ORDER BY date ASC
  `)).rows;

  res.json({
    total_deliveries: totalDeliveries.count,
    on_time_count: onTime.on_time || 0,
    on_time_rate: onTime.total > 0 ? ((onTime.on_time / onTime.total) * 100).toFixed(1) : 0,
    avg_turnaround_hours: turnaround.avg_hours != null ? Number(turnaround.avg_hours).toFixed(1) : null,
    pending_count: pending.count,
    failed_count: failed.count,
    by_delivery_man: byDeliveryMan,
    daily_trend: dailyTrend
  });
}));

// GET /api/reports/orders — per-order breakdown: progress, days-in-stage, cycle time,
// per-stage durations and per-SKU status counts. Boss/Ops only (shows customer names).
router.get('/orders', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to, stage } = req.query;

  const where = ["o.stage <> 'cancelled'"];
  const params = [];
  if (from) { where.push(`o.required_delivery_date >= $${params.push(from)}`); }
  if (to) { where.push(`o.required_delivery_date <= $${params.push(to)}`); }
  if (!from && !to) {
    if (period === 'daily') where.push('o.required_delivery_date = CURRENT_DATE');
    else if (period === 'weekly') where.push("date_trunc('week', o.required_delivery_date) = date_trunc('week', now())");
    else if (period === 'monthly') where.push("date_trunc('month', o.required_delivery_date) = date_trunc('month', now())");
  }
  if (stage) { where.push(`o.stage = $${params.push(stage)}`); }

  const orders = (await query(`
    SELECT o.id, o.invoice_number, o.customer_name, o.stage, o.priority, o.importance,
      o.order_date, o.required_delivery_date, o.created_at,
      u.name AS pic_name,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id AND status = 'done') AS done_count,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id AND status = 'in_progress') AS in_progress_count
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY o.required_delivery_date ASC
  `, params)).rows;

  // Pull stage transitions for these orders → per-stage durations + days in current stage.
  const ids = orders.map((o) => o.id);
  const transByOrder = {};
  if (ids.length) {
    const trans = (await query(
      `SELECT order_id, to_stage, created_at FROM stage_transitions
       WHERE order_id = ANY($1::uuid[]) ORDER BY created_at ASC`, [ids]
    )).rows;
    for (const t of trans) (transByOrder[t.order_id] = transByOrder[t.order_id] || []).push(t);
  }

  const now = Date.now();
  const hours = (ms) => Math.round((ms / 3600000) * 10) / 10;
  const out = orders.map((o) => {
    const ts = transByOrder[o.id] || [];
    const stage_hours = {};
    for (let i = 0; i < ts.length; i++) {
      const start = new Date(ts[i].created_at).getTime();
      const end = i + 1 < ts.length ? new Date(ts[i + 1].created_at).getTime() : now;
      stage_hours[ts[i].to_stage] = hours((stage_hours[ts[i].to_stage] ? stage_hours[ts[i].to_stage] * 3600000 : 0) + (end - start));
    }
    const firstAt = ts.length ? new Date(ts[0].created_at).getTime() : new Date(o.created_at).getTime();
    const lastAt = ts.length ? new Date(ts[ts.length - 1].created_at).getTime() : firstAt;
    const delivered = o.stage === 'delivered';
    const reqMs = o.required_delivery_date ? new Date(o.required_delivery_date).getTime() : null;
    const total = o.item_count || 0;
    return {
      id: o.id, invoice_number: o.invoice_number, customer_name: o.customer_name,
      stage: o.stage, priority: o.priority, importance: o.importance,
      required_delivery_date: o.required_delivery_date, order_date: o.order_date,
      pic_name: o.pic_name,
      item_count: total, done_count: o.done_count || 0, in_progress_count: o.in_progress_count || 0,
      not_started_count: Math.max(0, total - (o.done_count || 0) - (o.in_progress_count || 0)),
      pct: total > 0 ? Math.round(((o.done_count || 0) / total) * 100) : 0,
      days_in_stage: Math.floor((now - lastAt) / 86400000),
      cycle_hours: hours((delivered ? lastAt : now) - firstAt),
      delivered,
      on_time: delivered && reqMs != null ? lastAt <= reqMs + 86400000 : null,
      late: !delivered && reqMs != null && reqMs < now,
      stage_hours,
    };
  });
  res.json({ orders: out });
}));

// Forward (completing) stage moves — used to credit a person with finishing a step.
const FORWARD_PAIRS = `(st.from_stage, st.to_stage) IN
  (('order','production'),('production','packing'),
   ('packing','ready_for_delivery'),('ready_for_delivery','delivered'))`;

// GET /api/reports/staff — per-person productivity: stage completions, items
// marked done, and reworks, in the chosen period. Boss/Ops + Production Lead (no customer names).
router.get('/staff', authenticate, authorize(...PROD_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;
  const params = [];
  // Matching date windows for stage_transitions (created_at) and order_items (made_at).
  let stF, itF;
  if (from && to) {
    params.push(from, to);
    stF = 'AND st.created_at BETWEEN $1 AND $2';
    itF = 'AND oi.made_at BETWEEN $1 AND $2';
  } else if (period === 'daily') {
    stF = 'AND st.created_at::date = CURRENT_DATE';
    itF = 'AND oi.made_at::date = CURRENT_DATE';
  } else if (period === 'monthly') {
    stF = "AND date_trunc('month', st.created_at) = date_trunc('month', now())";
    itF = "AND date_trunc('month', oi.made_at) = date_trunc('month', now())";
  } else { // weekly (default)
    stF = "AND date_trunc('week', st.created_at) = date_trunc('week', now())";
    itF = "AND date_trunc('week', oi.made_at) = date_trunc('week', now())";
  }

  // A Production Lead only oversees the make + pack floor, so scope the people they
  // see to that team (excludes delivery dispatcher and ops/admin). Boss/Ops see all.
  const teamRoles = ['production_lead', 'production_staff', 'packing_staff'];
  const leadFilter = req.user.role === 'production_lead'
    ? `AND u.role = ANY($${params.push(teamRoles)}::text[])`
    : '';

  const staff = (await query(`
    WITH trans AS (
      SELECT st.transitioned_by AS uid,
        SUM(CASE WHEN ${FORWARD_PAIRS} THEN 1 ELSE 0 END)::int AS completions,
        SUM(CASE WHEN st.from_stage = 'packing' AND st.to_stage = 'production' THEN 1 ELSE 0 END)::int AS reworks
      FROM stage_transitions st
      WHERE st.transitioned_by IS NOT NULL ${stF}
      GROUP BY st.transitioned_by
    ),
    items AS (
      SELECT oi.made_by AS uid, COUNT(*)::int AS items_done
      FROM order_items oi
      WHERE oi.status = 'done' AND oi.made_by IS NOT NULL ${itF}
      GROUP BY oi.made_by
    )
    SELECT u.id, u.name, u.role, u.avatar_color,
      COALESCE(t.completions, 0) AS completions,
      COALESCE(t.reworks, 0) AS reworks,
      COALESCE(i.items_done, 0) AS items_done
    FROM users u
    LEFT JOIN trans t ON t.uid = u.id
    LEFT JOIN items i ON i.uid = u.id
    WHERE COALESCE(t.completions, 0) + COALESCE(t.reworks, 0) + COALESCE(i.items_done, 0) > 0
      ${leadFilter}
    ORDER BY completions DESC, items_done DESC, u.name ASC
  `, params)).rows;

  res.json({ staff });
}));

// GET /api/reports/staff/:id — deep drill-down for ONE person: volume, speed and
// reliability, each benchmarked against the team average, plus a recent-activity
// feed. Same audience as /staff (Boss/Ops/Lead); a Production Lead may only open
// someone on the make+pack team. All numbers come from existing tables — no money.
router.get('/staff/:id', authenticate, authorize(...PROD_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { period = 'weekly', from, to } = req.query;

  const u = (await query('SELECT id, name, role, avatar_color FROM users WHERE id = $1', [id])).rows[0];
  if (!u) return res.status(404).json({ error: 'Staff not found' });
  const teamRoles = ['production_lead', 'production_staff', 'packing_staff'];
  if (req.user.role === 'production_lead' && !teamRoles.includes(u.role)) {
    return res.status(403).json({ error: 'Outside your team' });
  }

  // Period window for any timestamp column. Every query below is called with
  // [id, ...dParams], so from/to are always $2/$3 (id is $1, ignored where unused).
  const win = (col) => {
    if (from && to) return `AND ${col} BETWEEN $2 AND $3`;
    if (period === 'daily') return `AND ${col}::date = CURRENT_DATE`;
    if (period === 'monthly') return `AND date_trunc('month', ${col}) = date_trunc('month', now())`;
    return `AND date_trunc('week', ${col}) = date_trunc('week', now())`;
  };
  const dParams = (from && to) ? [from, to] : [];
  const P = [id, ...dParams];
  const stF = win('st.created_at'), madeF = win('oi.made_at'), packF = win('oi.pack_made_at');

  // Stage work, split by step, plus reworks (sent back) and distinct active days.
  const work = (await query(`
    SELECT
      SUM(CASE WHEN ${FORWARD_PAIRS} THEN 1 ELSE 0 END)::int AS completions,
      SUM(CASE WHEN st.from_stage='order' AND st.to_stage='production' THEN 1 ELSE 0 END)::int AS routed,
      SUM(CASE WHEN st.from_stage='production' AND st.to_stage='packing' THEN 1 ELSE 0 END)::int AS produced,
      SUM(CASE WHEN st.from_stage='packing' AND st.to_stage='ready_for_delivery' THEN 1 ELSE 0 END)::int AS packed_moves,
      SUM(CASE WHEN st.from_stage='ready_for_delivery' AND st.to_stage='delivered' THEN 1 ELSE 0 END)::int AS delivered_moves,
      SUM(CASE WHEN st.from_stage='packing' AND st.to_stage='production' THEN 1 ELSE 0 END)::int AS reworks,
      COUNT(DISTINCT st.created_at::date)::int AS active_days
    FROM stage_transitions st
    WHERE st.transitioned_by = $1 ${stF}
  `, P)).rows[0];

  const items_made = (await query(
    `SELECT COUNT(*)::int AS n FROM order_items oi WHERE oi.made_by = $1 AND oi.status = 'done' ${madeF}`, P
  )).rows[0].n;
  const items_packed = (await query(
    `SELECT COUNT(*)::int AS n FROM order_items oi WHERE oi.pack_made_by = $1 AND oi.pack_status = 'done' ${packF}`, P
  )).rows[0].n;
  const amendments = (await query(
    `SELECT COUNT(*)::int AS n FROM activity_log WHERE user_id = $1 AND action = 'order_edited' ${win('created_at')}`, P
  )).rows[0].n;

  // Live PIC workload (not period-bound) + on-time rate for their delivered orders.
  const workload = (await query(`
    SELECT
      COUNT(*) FILTER (WHERE stage NOT IN ('delivered','cancelled'))::int AS active,
      COUNT(*) FILTER (WHERE stage NOT IN ('delivered','cancelled') AND required_delivery_date < CURRENT_DATE)::int AS overdue,
      COUNT(*) FILTER (WHERE on_hold)::int AS on_hold
    FROM orders WHERE pic_id = $1
  `, [id])).rows[0];
  const ot = (await query(`
    SELECT COUNT(*)::int AS total,
      SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE o.pic_id = $1 AND d.status = 'delivered' ${win('d.delivered_at')}
  `, P)).rows[0];

  // 14-day completion trend (sparkline) and the recent-activity feed.
  const trend = (await query(`
    SELECT st.created_at::date AS date, COUNT(*)::int AS count
    FROM stage_transitions st
    WHERE st.transitioned_by = $1 AND ${FORWARD_PAIRS} AND st.created_at >= CURRENT_DATE - INTERVAL '13 days'
    GROUP BY st.created_at::date ORDER BY date ASC
  `, [id])).rows;
  const activity = (await query(`
    SELECT al.action, al.details, al.created_at, o.invoice_number
    FROM activity_log al LEFT JOIN orders o ON o.id = al.order_id
    WHERE al.user_id = $1 ORDER BY al.created_at DESC LIMIT 15
  `, [id])).rows;

  // Team benchmark: average completions + items per active person this period.
  const bench = (await query(`
    WITH per AS (
      SELECT u.id,
        COALESCE((SELECT COUNT(*) FROM stage_transitions st WHERE st.transitioned_by = u.id AND ${FORWARD_PAIRS} ${stF}), 0)::int AS completions,
        COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.made_by = u.id AND oi.status = 'done' ${madeF}), 0)::int
          + COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.pack_made_by = u.id AND oi.pack_status = 'done' ${packF}), 0)::int AS items
      FROM users u WHERE u.is_active = true
    )
    SELECT COALESCE(ROUND(AVG(completions), 1), 0) AS avg_completions,
           COALESCE(ROUND(AVG(items), 1), 0) AS avg_items
    FROM per WHERE completions > 0 OR items > 0
  `, P)).rows[0];

  const items_total = items_made + items_packed;
  const per_active_day = work.active_days > 0 ? +(items_total / work.active_days).toFixed(1) : 0;

  res.json({
    staff: { id: u.id, name: u.name, role: u.role, avatar_color: u.avatar_color },
    period,
    volume: {
      completions: work.completions, items_made, items_packed, items_total,
      breakdown: { routed: work.routed, produced: work.produced, packed: work.packed_moves, delivered: work.delivered_moves }
    },
    speed: { active_days: work.active_days, items_per_active_day: per_active_day },
    reliability: {
      reworks: work.reworks, amendments,
      on_time_total: ot.total, on_time_count: ot.on_time || 0,
      on_time_rate: ot.total > 0 ? +(((ot.on_time || 0) / ot.total) * 100).toFixed(1) : null
    },
    workload,
    benchmark: { avg_completions: Number(bench.avg_completions), avg_items: Number(bench.avg_items) },
    trend,
    activity
  });
}));

// GET /api/reports/pic — per-person-in-charge view: current open workload
// (active / overdue / on-hold, live) plus orders completed in the period. Boss/Ops + Production Lead (no customer names).
router.get('/pic', authenticate, authorize(...PROD_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;
  const params = [];
  let stF;
  if (from && to) { params.push(from, to); stF = 'AND st.created_at BETWEEN $1 AND $2'; }
  else if (period === 'daily') stF = 'AND st.created_at::date = CURRENT_DATE';
  else if (period === 'monthly') stF = "AND date_trunc('month', st.created_at) = date_trunc('month', now())";
  else stF = "AND date_trunc('week', st.created_at) = date_trunc('week', now())";

  // Roles that can hold orders as PIC — keeps zero-load assignees visible in the table.
  const picRoles = ['operations_controller', 'production_lead', 'production_staff', 'packing_staff', 'delivery_team'];
  // Production Lead is scoped to the make + pack team (no delivery dispatcher / ops).
  const teamRoles = ['production_lead', 'production_staff', 'packing_staff'];
  const leadFilter = req.user.role === 'production_lead'
    ? `AND u.role = ANY($${params.push(teamRoles)}::text[])`
    : '';

  const pics = (await query(`
    WITH wl AS (
      SELECT pic_id AS uid,
        COUNT(*) FILTER (WHERE stage NOT IN ('delivered','cancelled'))::int AS active,
        COUNT(*) FILTER (WHERE stage NOT IN ('delivered','cancelled') AND required_delivery_date < CURRENT_DATE)::int AS overdue,
        COUNT(*) FILTER (WHERE on_hold)::int AS on_hold
      FROM orders WHERE pic_id IS NOT NULL GROUP BY pic_id
    ),
    done AS (
      SELECT st.transitioned_by AS uid, COUNT(*)::int AS completed
      FROM stage_transitions st
      WHERE st.transitioned_by IS NOT NULL AND ${FORWARD_PAIRS} ${stF}
      GROUP BY st.transitioned_by
    )
    SELECT u.id, u.name, u.role, u.avatar_color,
      COALESCE(w.active, 0) AS active,
      COALESCE(w.overdue, 0) AS overdue,
      COALESCE(w.on_hold, 0) AS on_hold,
      COALESCE(d.completed, 0) AS completed
    FROM users u
    LEFT JOIN wl w ON w.uid = u.id
    LEFT JOIN done d ON d.uid = u.id
    WHERE u.is_active = true
      AND (COALESCE(w.active, 0) > 0 OR COALESCE(d.completed, 0) > 0 OR u.role = ANY($${params.push(picRoles)}::text[]))
      ${leadFilter}
    ORDER BY active DESC, completed DESC, u.name ASC
  `, params)).rows;

  res.json({ pics });
}));

// GET /api/reports/efficiency — flow health: end-to-end cycle time, on-time rate,
// the bottleneck stage (longest avg dwell) and aging WIP (oldest open orders).
// Boss/Ops only (spans delivery). Invoice numbers only — no customer names.
router.get('/efficiency', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;
  const win = (col) => {
    if (from && to) return `AND ${col} BETWEEN $1 AND $2`;
    if (period === 'daily') return `AND ${col}::date = CURRENT_DATE`;
    if (period === 'monthly') return `AND date_trunc('month', ${col}) = date_trunc('month', now())`;
    return `AND date_trunc('week', ${col}) = date_trunc('week', now())`;
  };
  const params = (from && to) ? [from, to] : [];

  // Cycle time: first stage entry → delivered, for orders delivered in the period.
  const cycle = (await query(`
    WITH starts AS (SELECT order_id, MIN(created_at) AS start_at FROM stage_transitions GROUP BY order_id)
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (dl.created_at - s.start_at)) / 3600.0)::numeric, 1) AS avg_hours, COUNT(*)::int AS n
    FROM stage_transitions dl JOIN starts s ON s.order_id = dl.order_id
    WHERE dl.to_stage = 'delivered' ${win('dl.created_at')}
  `, params)).rows[0];

  // Avg dwell per stage = time from entering a stage to leaving it.
  const dwell = (await query(`
    WITH seq AS (
      SELECT order_id, to_stage AS stage, created_at,
        LEAD(created_at) OVER (PARTITION BY order_id ORDER BY created_at) AS next_at
      FROM stage_transitions
    )
    SELECT stage, ROUND(AVG(EXTRACT(EPOCH FROM (next_at - created_at)) / 3600.0)::numeric, 1) AS avg_hours, COUNT(*)::int AS n
    FROM seq
    WHERE next_at IS NOT NULL AND stage IN ('order','production','packing','ready_for_delivery') ${win('created_at')}
    GROUP BY stage
  `, params)).rows;

  const ot = (await query(`
    SELECT COUNT(*)::int AS total,
      SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE d.status = 'delivered' ${win('d.delivered_at')}
  `, params)).rows[0];

  // Aging WIP (live): open orders, oldest first, with days open + days late.
  const aging = (await query(`
    SELECT o.invoice_number, o.stage, o.required_delivery_date,
      (CURRENT_DATE - MIN(st.created_at)::date)::int AS days_open,
      (CURRENT_DATE - o.required_delivery_date)::int AS days_late
    FROM orders o JOIN stage_transitions st ON st.order_id = o.id
    WHERE o.stage NOT IN ('delivered','cancelled')
    GROUP BY o.id, o.invoice_number, o.stage, o.required_delivery_date
    ORDER BY MIN(st.created_at) ASC LIMIT 12
  `)).rows;

  const bottleneck = dwell.reduce((m, s) => (Number(s.avg_hours) > Number((m && m.avg_hours) || 0) ? s : m), null);

  res.json({
    avg_cycle_hours: cycle.avg_hours != null ? Number(cycle.avg_hours) : null,
    cycle_n: cycle.n,
    on_time_total: ot.total, on_time_count: ot.on_time || 0,
    on_time_rate: ot.total > 0 ? +(((ot.on_time || 0) / ot.total) * 100).toFixed(1) : null,
    stage_dwell: dwell.map((s) => ({ stage: s.stage, avg_hours: Number(s.avg_hours), n: s.n })),
    bottleneck: bottleneck ? { stage: bottleneck.stage, avg_hours: Number(bottleneck.avg_hours) } : null,
    aging
  });
}));

// GET /api/reports/mistakes — error & rework lens: amendments, late / failed
// deliveries, cancellations, holds and waiting-stock — all from existing tables.
// Boss/Ops only. The thing nothing aggregated before. No money, no customer names.
router.get('/mistakes', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly', from, to } = req.query;
  const win = (col) => {
    if (from && to) return `AND ${col} BETWEEN $1 AND $2`;
    if (period === 'daily') return `AND ${col}::date = CURRENT_DATE`;
    if (period === 'monthly') return `AND date_trunc('month', ${col}) = date_trunc('month', now())`;
    return `AND date_trunc('week', ${col}) = date_trunc('week', now())`;
  };
  const params = (from && to) ? [from, to] : [];

  const amendCount = (await query(
    `SELECT COUNT(*)::int AS n FROM activity_log WHERE action = 'order_edited' ${win('created_at')}`, params
  )).rows[0].n;
  const amendList = (await query(`
    SELECT al.created_at, al.details, u.name AS user_name, o.invoice_number
    FROM activity_log al LEFT JOIN users u ON u.id = al.user_id LEFT JOIN orders o ON o.id = al.order_id
    WHERE al.action = 'order_edited' ${win('al.created_at')}
    ORDER BY al.created_at DESC LIMIT 12
  `, params)).rows;

  const lateCount = (await query(`
    SELECT COUNT(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id
    WHERE d.status = 'delivered' AND d.delivered_at::date > o.required_delivery_date ${win('d.delivered_at')}
  `, params)).rows[0].n;
  const lateList = (await query(`
    SELECT o.invoice_number, (d.delivered_at::date - o.required_delivery_date)::int AS days_late,
      COALESCE(dl.name, u.name) AS driver
    FROM deliveries d JOIN orders o ON o.id = d.order_id
    LEFT JOIN deliverers dl ON dl.id = d.deliverer_id LEFT JOIN users u ON u.id = d.delivery_man_id
    WHERE d.status = 'delivered' AND d.delivered_at::date > o.required_delivery_date ${win('d.delivered_at')}
    ORDER BY days_late DESC LIMIT 12
  `, params)).rows;

  const failed = (await query("SELECT COUNT(*)::int AS n FROM deliveries WHERE status = 'failed'")).rows[0].n;
  const cancelled = (await query("SELECT COUNT(*)::int AS n FROM orders WHERE stage = 'cancelled'")).rows[0].n;
  const onHold = (await query("SELECT COUNT(*)::int AS n FROM orders WHERE on_hold = true")).rows[0].n;
  const waiting = (await query("SELECT COUNT(*)::int AS n FROM orders WHERE waiting_stock = true")).rows[0].n;

  // 8-week amendment trend (the "is it getting better" line).
  const trend = (await query(`
    SELECT date_trunc('week', created_at)::date AS date, COUNT(*)::int AS count
    FROM activity_log
    WHERE action = 'order_edited' AND created_at >= date_trunc('week', now()) - INTERVAL '7 weeks'
    GROUP BY 1 ORDER BY 1
  `)).rows;

  res.json({
    amendments: { count: amendCount, list: amendList },
    late: { count: lateCount, list: lateList },
    failed_count: failed, cancelled_count: cancelled, on_hold_count: onHold, waiting_stock_count: waiting,
    trend
  });
}));

// GET /api/reports/audit — audit trail (admin only)
router.get('/audit', authenticate, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const { user_id, action, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = ['1=1'];
  const params = [];

  if (user_id) { where.push(`al.user_id = $${params.push(user_id)}`); }
  if (action) { where.push(`al.action = $${params.push(action)}`); }
  if (from) { where.push(`al.created_at >= $${params.push(from)}`); }
  if (to) { where.push(`al.created_at <= $${params.push(to)}`); }

  const whereSql = where.join(' AND ');
  const total = (await query(`SELECT COUNT(*)::int AS c FROM activity_log al WHERE ${whereSql}`, params)).rows[0].c;

  const limitIdx = params.push(parseInt(limit));
  const offsetIdx = params.push(offset);

  const logs = (await query(`
    SELECT al.*, u.name AS user_name, o.invoice_number
    FROM activity_log al
    JOIN users u ON al.user_id = u.id
    LEFT JOIN orders o ON al.order_id = o.id
    WHERE ${whereSql}
    ORDER BY al.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, params)).rows;

  res.json({ logs, total, page: parseInt(page) });
}));

// ─── Reward scorecard / leaderboard ──────────────────────────────────────────
// Composite 0–100 score per department or per person, for the monthly reward
// engine + the floor leaderboard. Four pillars — On-time, Output, Quality, Speed —
// each normalised 0–100 (Output & Speed relative to the best performer that
// period; Rock-friendly — no targets to maintain), then blended by weights stored
// in system_settings (editable in System Settings). Compares to the previous
// period for the ▲▼ movement. All from existing fields — no money, no customer
// names. authenticate-only (no role gate): it is names + scores, the same exposure
// as the floor board, and it feeds the all-roles Floor Display leaderboard.
const DEFAULT_WEIGHTS = { ontime: 30, output: 30, quality: 25, speed: 15 };
const ROLE_DEPT = {
  production_lead: 'Production', production_staff: 'Production',
  packing_staff: 'Packing', delivery_team: 'Delivery',
};
const DEPT_COLOR = { Production: '#f97316', Packing: '#f5b13a', Delivery: '#60a5fa' };
const clamp100 = (n) => Math.max(0, Math.min(100, n));

async function readWeights() {
  try {
    const row = (await query("SELECT value FROM system_settings WHERE key = 'scorecard_weights'")).rows[0];
    if (!row || !row.value) return { ...DEFAULT_WEIGHTS };
    const w = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const out = {};
    for (const k of ['ontime', 'output', 'quality', 'speed']) {
      const v = Number(w[k]);
      out[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_WEIGHTS[k];
    }
    return (out.ontime + out.output + out.quality + out.speed) > 0 ? out : { ...DEFAULT_WEIGHTS };
  } catch { return { ...DEFAULT_WEIGHTS }; }
}

// Turn raw pillar inputs into 0–100 scores + the weighted composite. On-time and
// Quality are already percentages; Output and Speed are scaled against the best
// performer in the set. `higher` = whether a bigger speed_raw is better (people:
// STKs/day → yes; departments: avg dwell hours → no).
function scoreUnits(units, weights, higher) {
  const maxOut = Math.max(1, ...units.map((u) => Number(u.output_raw) || 0));
  const sp = units.map((u) => Number(u.speed_raw)).filter((v) => Number.isFinite(v) && v > 0);
  const bestSp = sp.length ? (higher ? Math.max(...sp) : Math.min(...sp)) : 0;
  const wsum = (weights.ontime + weights.output + weights.quality + weights.speed) || 1;
  for (const u of units) {
    const pOn = u.ontime_pct == null ? 0 : clamp100(u.ontime_pct);
    const pQ = u.quality_pct == null ? 0 : clamp100(u.quality_pct);
    const pOut = Math.round((Number(u.output_raw) || 0) / maxOut * 100);
    const v = Number(u.speed_raw);
    let pSp = 0;
    if (bestSp > 0 && Number.isFinite(v) && v > 0) pSp = clamp100(higher ? (v / bestSp) * 100 : (bestSp / v) * 100);
    u.pillars = { ontime: Math.round(pOn), output: pOut, quality: Math.round(pQ), speed: Math.round(pSp) };
    u.score = Math.round((pOn * weights.ontime + pOut * weights.output + pQ * weights.quality + pSp * weights.speed) / wsum);
  }
  return units;
}

// GET /api/reports/scorecard?period=monthly|weekly&unit=dept|people
router.get('/scorecard', authenticate, asyncHandler(async (req, res) => {
  const period = req.query.period === 'weekly' ? 'weekly' : 'monthly';
  const unit = req.query.unit === 'people' ? 'people' : 'dept';
  const U = period === 'weekly' ? 'week' : 'month';
  const weights = await readWeights();
  // off: 0 = current period, 1 = previous (for the ▲▼ movement). off is an integer
  // we control (never user input), so inlining it into the SQL is injection-safe.
  const win = (col, off) => `date_trunc('${U}', ${col}) = (date_trunc('${U}', now()) - INTERVAL '${off} ${U}')`;

  async function deptUnits(off) {
    const fwd = (await query(`
      SELECT st.from_stage, st.to_stage, COUNT(*)::int AS n,
        SUM(CASE WHEN st.created_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
      FROM stage_transitions st JOIN orders o ON o.id = st.order_id
      WHERE (st.from_stage, st.to_stage) IN (('production','packing'),('packing','ready_for_delivery'))
        AND ${win('st.created_at', off)}
      GROUP BY 1, 2
    `)).rows;
    const rw = (await query(`
      SELECT st.to_stage, COUNT(*)::int AS n FROM stage_transitions st
      WHERE ((st.to_stage='production' AND st.from_stage IN ('packing','ready_for_delivery','delivered'))
          OR (st.to_stage='packing'    AND st.from_stage IN ('ready_for_delivery','delivered')))
        AND ${win('st.created_at', off)}
      GROUP BY 1
    `)).rows;
    const dw = (await query(`
      WITH seq AS (
        SELECT order_id, to_stage AS stage, created_at,
          LEAD(created_at) OVER (PARTITION BY order_id ORDER BY created_at) AS next_at
        FROM stage_transitions
      )
      SELECT stage, AVG(EXTRACT(EPOCH FROM (next_at - created_at)) / 3600.0) AS avg_hours
      FROM seq WHERE next_at IS NOT NULL AND stage IN ('production','packing') AND ${win('next_at', off)}
      GROUP BY stage
    `)).rows;
    const del = (await query(`
      SELECT COUNT(*) FILTER (WHERE d.status='delivered')::int AS delivered,
        SUM(CASE WHEN d.status='delivered' AND d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time,
        SUM(CASE WHEN d.status='delivered' AND d.delivered_at::date >  o.required_delivery_date THEN 1 ELSE 0 END)::int AS late,
        AVG(CASE WHEN d.status='delivered' THEN EXTRACT(EPOCH FROM (d.delivered_at - d.created_at)) / 3600.0 END) AS avg_turn
      FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE ${win('COALESCE(d.delivered_at, d.created_at)', off)}
    `)).rows[0];
    const failed = (await query(`SELECT COUNT(*)::int AS n FROM deliveries WHERE status='failed' AND ${win('created_at', off)}`)).rows[0].n;

    const pick = (from, to) => fwd.find((r) => r.from_stage === from && r.to_stage === to) || { n: 0, on_time: 0 };
    const rwOf = (stage) => (rw.find((r) => r.to_stage === stage) || { n: 0 }).n;
    const dwOf = (stage) => { const r = dw.find((x) => x.stage === stage); return r && r.avg_hours != null ? Number(r.avg_hours) : null; };
    const pct = (num, den) => den > 0 ? (num / den) * 100 : null;
    const prod = pick('production', 'packing'), pack = pick('packing', 'ready_for_delivery');
    return [
      { key: 'Production', name: 'Production', color: DEPT_COLOR.Production,
        output_raw: prod.n, ontime_pct: pct(prod.on_time, prod.n),
        quality_pct: prod.n > 0 ? 100 - (rwOf('production') / prod.n) * 100 : null, speed_raw: dwOf('production'),
        raw: { on_time: prod.on_time, total: prod.n, reworks: rwOf('production'), dwell_h: dwOf('production') } },
      { key: 'Packing', name: 'Packing', color: DEPT_COLOR.Packing,
        output_raw: pack.n, ontime_pct: pct(pack.on_time, pack.n),
        quality_pct: pack.n > 0 ? 100 - (rwOf('packing') / pack.n) * 100 : null, speed_raw: dwOf('packing'),
        raw: { on_time: pack.on_time, total: pack.n, reworks: rwOf('packing'), dwell_h: dwOf('packing') } },
      { key: 'Delivery', name: 'Delivery', color: DEPT_COLOR.Delivery,
        output_raw: del.delivered, ontime_pct: pct(del.on_time, del.delivered),
        quality_pct: del.delivered > 0 ? 100 - ((failed + (del.late || 0)) / del.delivered) * 100 : null,
        speed_raw: del.avg_turn != null ? Number(del.avg_turn) : null,
        raw: { on_time: del.on_time, total: del.delivered, failed, late: del.late || 0, turn_h: del.avg_turn != null ? Number(del.avg_turn) : null } },
    ];
  }

  async function peopleUnits(off) {
    const rows = (await query(`
      WITH trans AS (
        SELECT st.transitioned_by AS uid,
          SUM(CASE WHEN ${FORWARD_PAIRS} THEN 1 ELSE 0 END)::int AS completions,
          SUM(CASE WHEN (${FORWARD_PAIRS}) AND st.created_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time,
          SUM(CASE WHEN st.from_stage='packing' AND st.to_stage='production' THEN 1 ELSE 0 END)::int AS reworks,
          COUNT(DISTINCT st.created_at::date)::int AS active_days
        FROM stage_transitions st JOIN orders o ON o.id = st.order_id
        WHERE st.transitioned_by IS NOT NULL AND ${win('st.created_at', off)}
        GROUP BY 1
      ),
      items  AS (SELECT made_by      AS uid, COUNT(*)::int AS n FROM order_items WHERE status='done'      AND made_by      IS NOT NULL AND ${win('made_at', off)}      GROUP BY 1),
      pitems AS (SELECT pack_made_by AS uid, COUNT(*)::int AS n FROM order_items WHERE pack_status='done' AND pack_made_by IS NOT NULL AND ${win('pack_made_at', off)} GROUP BY 1)
      SELECT u.id, u.name, u.role, u.avatar_color,
        COALESCE(t.completions,0) AS completions, COALESCE(t.on_time,0) AS on_time,
        COALESCE(t.reworks,0) AS reworks, COALESCE(t.active_days,0) AS active_days,
        COALESCE(i.n,0) + COALESCE(p.n,0) AS items
      FROM users u
      LEFT JOIN trans t ON t.uid = u.id LEFT JOIN items i ON i.uid = u.id LEFT JOIN pitems p ON p.uid = u.id
      WHERE u.is_active = true AND u.role IN ('production_lead','production_staff','packing_staff','delivery_team')
    `)).rows;
    return rows
      .map((r) => ({
        key: r.id, name: r.name, color: r.avatar_color, dept: ROLE_DEPT[r.role] || null,
        output_raw: (r.completions || 0) + (r.items || 0),
        ontime_pct: r.completions > 0 ? (r.on_time / r.completions) * 100 : null,
        quality_pct: r.completions > 0 ? 100 - (r.reworks / r.completions) * 100 : 100,
        speed_raw: r.active_days > 0 ? r.items / r.active_days : 0,
        raw: { completions: r.completions, items: r.items, on_time: r.on_time, reworks: r.reworks, active_days: r.active_days },
      }))
      .filter((u) => u.output_raw > 0);
  }

  const build = unit === 'people' ? peopleUnits : deptUnits;
  const higher = unit === 'people'; // people speed = STKs/day (higher better); dept speed = dwell hours (lower better)
  const cur = scoreUnits(await build(0), weights, higher);
  const prev = scoreUnits(await build(1), weights, higher);

  const prevRank = {};
  prev.slice().sort((a, b) => b.score - a.score).forEach((u, i) => { prevRank[u.key] = i + 1; });
  cur.sort((a, b) => b.score - a.score);
  const leaderboard = cur.map((u, i) => {
    const was = prevRank[u.key];
    return {
      key: u.key, name: u.name, dept: u.dept || null, color: u.color || null,
      score: u.score, pillars: u.pillars, raw: u.raw,
      rank: i + 1, prev_rank: was || null, delta: was ? was - (i + 1) : null,
    };
  });

  res.json({ unit, period, weights, leaderboard });
}));

// GET /api/reports/trend?months=6 — month-over-month trend: completed orders,
// on-time %, rework % and avg cycle (days), one row per month for the last N
// months (empty months included). The "are we getting better or worse" view for
// the monthly review. All from existing fields — no money. Boss/Ops only.
router.get('/trend', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  let n = parseInt(req.query.months, 10);
  if (!Number.isFinite(n) || n < 3) n = 6;
  if (n > 12) n = 12;
  const back = n - 1; // integer we control — safe to inline into the interval

  const trend = (await query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()) - INTERVAL '${back} months',
        date_trunc('month', now()),
        INTERVAL '1 month'
      )::date AS m
    ),
    deliv AS (
      SELECT date_trunc('month', d.delivered_at)::date AS m,
        COUNT(*)::int AS completed,
        SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
      FROM deliveries d JOIN orders o ON o.id = d.order_id
      WHERE d.status = 'delivered' GROUP BY 1
    ),
    prod AS (
      SELECT date_trunc('month', created_at)::date AS m,
        SUM(CASE WHEN from_stage='production' AND to_stage='packing' THEN 1 ELSE 0 END)::int AS produced,
        SUM(CASE WHEN from_stage='packing' AND to_stage='production' THEN 1 ELSE 0 END)::int AS reworks
      FROM stage_transitions GROUP BY 1
    ),
    starts AS (SELECT order_id, MIN(created_at) AS s FROM stage_transitions GROUP BY order_id),
    cyc AS (
      SELECT date_trunc('month', dl.created_at)::date AS m,
        ROUND(AVG(EXTRACT(EPOCH FROM (dl.created_at - st.s)) / 86400.0)::numeric, 1) AS avg_days
      FROM stage_transitions dl JOIN starts st ON st.order_id = dl.order_id
      WHERE dl.to_stage = 'delivered' GROUP BY 1
    )
    SELECT to_char(months.m, 'YYYY-MM') AS month,
      COALESCE(deliv.completed, 0) AS completed,
      CASE WHEN COALESCE(deliv.completed, 0) > 0 THEN ROUND(deliv.on_time * 100.0 / deliv.completed, 1) ELSE NULL END AS on_time_rate,
      CASE WHEN COALESCE(prod.produced, 0) > 0 THEN ROUND(prod.reworks * 100.0 / prod.produced, 1) ELSE NULL END AS rework_rate,
      cyc.avg_days AS avg_cycle_days
    FROM months
    LEFT JOIN deliv ON deliv.m = months.m
    LEFT JOIN prod  ON prod.m  = months.m
    LEFT JOIN cyc   ON cyc.m   = months.m
    ORDER BY months.m
  `)).rows.map((r) => ({
    month: r.month,
    completed: r.completed,
    on_time_rate: r.on_time_rate == null ? null : Number(r.on_time_rate),
    rework_rate: r.rework_rate == null ? null : Number(r.rework_rate),
    avg_cycle_days: r.avg_cycle_days == null ? null : Number(r.avg_cycle_days),
  }));

  res.json({ months: n, trend });
}));

module.exports = router;

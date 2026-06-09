// src/routes/reports.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

const ADMIN_ROLES = ['super_admin', 'operations_controller'];
// Production Lead (floor supervisor) may see the name-free reports: production,
// packing, and the per-person staff / person-in-charge tables. Orders and the
// dashboard stay Boss/Ops only — they list customer names. Delivery is the
// coordinator's domain, not the lead's.
const PROD_REPORT_ROLES = ['super_admin', 'operations_controller', 'production_lead'];
const DELIVERY_REPORT_ROLES = ['super_admin', 'operations_controller'];

// GET /api/reports/dashboard — boss overview
router.get('/dashboard', authenticate, authorize(...ADMIN_ROLES), asyncHandler(async (req, res) => {
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

  res.json({
    completed: completedProduction.count,
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
  const { period = 'weekly' } = req.query;

  let dateFilter = '';
  if (period === 'daily') dateFilter = "AND created_at::date = CURRENT_DATE";
  else if (period === 'weekly') dateFilter = "AND date_trunc('week', created_at) = date_trunc('week', now())";
  else if (period === 'monthly') dateFilter = "AND date_trunc('month', created_at) = date_trunc('month', now())";

  const packed = (await query(`
    SELECT COUNT(*)::int AS count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'ready_for_delivery'
    ${dateFilter}
  `)).rows[0];

  const avgPackTime = (await query(`
    SELECT AVG(EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 60.0) AS avg_minutes
    FROM stage_transitions t1
    JOIN stage_transitions t2 ON t1.order_id = t2.order_id
    WHERE t1.to_stage = 'packing' AND t2.from_stage = 'packing'
    ${dateFilter.replace(/created_at/g, 't1.created_at')}
  `)).rows[0];

  const reworks = (await query(`
    SELECT COUNT(*)::int AS count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'production'
    ${dateFilter}
  `)).rows[0];

  res.json({
    packed: packed.count,
    rework_count: reworks.count,
    rework_rate: packed.count > 0 ? ((reworks.count / packed.count) * 100).toFixed(1) : 0,
    avg_pack_minutes: avgPackTime.avg_minutes != null ? Number(avgPackTime.avg_minutes).toFixed(0) : null
  });
}));

// GET /api/reports/delivery — delivery performance
router.get('/delivery', authenticate, authorize(...DELIVERY_REPORT_ROLES), asyncHandler(async (req, res) => {
  const { period = 'weekly' } = req.query;

  let dateFilter = '';
  if (period === 'daily') dateFilter = "AND d.delivered_at::date = CURRENT_DATE";
  else if (period === 'weekly') dateFilter = "AND date_trunc('week', d.delivered_at) = date_trunc('week', now())";
  else if (period === 'monthly') dateFilter = "AND date_trunc('month', d.delivered_at) = date_trunc('month', now())";

  const totalDeliveries = (await query(`
    SELECT COUNT(*)::int AS count FROM deliveries d WHERE d.status = 'delivered' ${dateFilter}
  `)).rows[0];

  const onTime = (await query(`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN d.delivered_at::date <= o.required_delivery_date THEN 1 ELSE 0 END)::int AS on_time
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    WHERE d.status = 'delivered' ${dateFilter}
  `)).rows[0];

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
  `)).rows;

  res.json({
    total_deliveries: totalDeliveries.count,
    on_time_count: onTime.on_time || 0,
    on_time_rate: onTime.total > 0 ? ((onTime.on_time / onTime.total) * 100).toFixed(1) : 0,
    by_delivery_man: byDeliveryMan
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
    ORDER BY completions DESC, items_done DESC, u.name ASC
  `, params)).rows;

  res.json({ staff });
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
    ORDER BY active DESC, completed DESC, u.name ASC
  `, params)).rows;

  res.json({ pics });
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

module.exports = router;

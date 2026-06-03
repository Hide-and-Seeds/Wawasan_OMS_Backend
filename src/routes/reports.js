// src/routes/reports.js
const express = require('express');
const router = express.Router();
const { getDb } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');

const ADMIN_ROLES = ['super_admin', 'operations_controller'];

// GET /api/reports/dashboard — boss overview
router.get('/dashboard', authenticate, (req, res) => {
  const db = getDb();

  const stageCounts = db.prepare(`
    SELECT stage, COUNT(*) as count FROM orders
    WHERE stage NOT IN ('delivered','cancelled')
    GROUP BY stage
  `).all();

  const thisWeekOrders = db.prepare(`
    SELECT COUNT(*) as count FROM orders
    WHERE strftime('%W-%Y', created_at) = strftime('%W-%Y', 'now')
  `).get();

  const thisMonthOrders = db.prepare(`
    SELECT COUNT(*) as count FROM orders
    WHERE strftime('%m-%Y', created_at) = strftime('%m-%Y', 'now')
  `).get();

  const upcomingDeliveries = db.prepare(`
    SELECT o.*, u.name as pic_name FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.stage = 'ready_for_delivery'
      AND o.required_delivery_date BETWEEN date('now') AND date('now', '+7 days')
    ORDER BY o.required_delivery_date ASC
  `).all();

  const overdueOrders = db.prepare(`
    SELECT o.*, u.name as pic_name FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.required_delivery_date < date('now')
      AND o.stage NOT IN ('delivered','cancelled')
    ORDER BY o.required_delivery_date ASC
  `).all();

  const activeStaff = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_active = 1").get();

  res.json({
    stage_counts: stageCounts,
    this_week_orders: thisWeekOrders.count,
    this_month_orders: thisMonthOrders.count,
    upcoming_deliveries: upcomingDeliveries,
    overdue_orders: overdueOrders,
    active_staff: activeStaff.count
  });
});

// GET /api/reports/production — production performance
router.get('/production', authenticate, authorize(...ADMIN_ROLES), (req, res) => {
  const db = getDb();
  const { period = 'weekly', from, to, staff_id } = req.query;

  let dateFilter = '';
  const params = [];

  if (from && to) {
    dateFilter = "AND st.created_at BETWEEN ? AND ?";
    params.push(from, to);
  } else if (period === 'daily') {
    dateFilter = "AND date(st.created_at) = date('now')";
  } else if (period === 'weekly') {
    dateFilter = "AND strftime('%W-%Y', st.created_at) = strftime('%W-%Y', 'now')";
  } else if (period === 'monthly') {
    dateFilter = "AND strftime('%m-%Y', st.created_at) = strftime('%m-%Y', 'now')";
  }

  // Orders completed through production
  const completedProduction = db.prepare(`
    SELECT COUNT(DISTINCT st.order_id) as count
    FROM stage_transitions st
    WHERE st.from_stage = 'production' AND st.to_stage = 'packing'
    ${dateFilter}
  `).get(...params);

  // Rework rate (packing → production)
  const reworks = db.prepare(`
    SELECT COUNT(*) as count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'production'
    ${dateFilter}
  `).get(...params);

  // Avg production time
  const avgTime = db.prepare(`
    SELECT AVG((julianday(t2.created_at) - julianday(t1.created_at)) * 24) as avg_hours
    FROM stage_transitions t1
    JOIN stage_transitions t2 ON t1.order_id = t2.order_id
    WHERE t1.to_stage = 'production' AND t2.from_stage = 'production'
    ${dateFilter.replace(/st\./g, 't1.')}
  `).get(...params);

  // On-time rate
  const onTime = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN st.created_at <= o.required_delivery_date THEN 1 ELSE 0 END) as on_time
    FROM stage_transitions st
    JOIN orders o ON st.order_id = o.id
    WHERE st.from_stage = 'production' AND st.to_stage = 'packing'
    ${dateFilter}
  `).get(...params);

  // Daily trend (last 14 days)
  const dailyTrend = db.prepare(`
    SELECT date(st.created_at) as date, COUNT(DISTINCT st.order_id) as count
    FROM stage_transitions st
    WHERE st.from_stage = 'production'
      AND st.created_at >= date('now', '-14 days')
    GROUP BY date(st.created_at)
    ORDER BY date ASC
  `).all();

  res.json({
    completed: completedProduction.count,
    rework_count: reworks.count,
    rework_rate: completedProduction.count > 0
      ? ((reworks.count / completedProduction.count) * 100).toFixed(1)
      : 0,
    avg_production_hours: avgTime.avg_hours ? avgTime.avg_hours.toFixed(1) : null,
    on_time_rate: onTime.total > 0
      ? ((onTime.on_time / onTime.total) * 100).toFixed(1)
      : 0,
    daily_trend: dailyTrend
  });
});

// GET /api/reports/packing — packing performance
router.get('/packing', authenticate, authorize(...ADMIN_ROLES), (req, res) => {
  const db = getDb();
  const { period = 'weekly' } = req.query;

  let dateFilter = '';
  if (period === 'daily') dateFilter = "AND date(created_at) = date('now')";
  else if (period === 'weekly') dateFilter = "AND strftime('%W-%Y', created_at) = strftime('%W-%Y', 'now')";
  else if (period === 'monthly') dateFilter = "AND strftime('%m-%Y', created_at) = strftime('%m-%Y', 'now')";

  const packed = db.prepare(`
    SELECT COUNT(*) as count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'ready_for_delivery'
    ${dateFilter}
  `).get();

  const avgPackTime = db.prepare(`
    SELECT AVG((julianday(t2.created_at) - julianday(t1.created_at)) * 60) as avg_minutes
    FROM stage_transitions t1
    JOIN stage_transitions t2 ON t1.order_id = t2.order_id
    WHERE t1.to_stage = 'packing' AND t2.from_stage = 'packing'
    ${dateFilter.replace(/created_at/g, 't1.created_at')}
  `).get();

  const reworks = db.prepare(`
    SELECT COUNT(*) as count FROM stage_transitions
    WHERE from_stage = 'packing' AND to_stage = 'production'
    ${dateFilter}
  `).get();

  res.json({
    packed: packed.count,
    rework_count: reworks.count,
    rework_rate: packed.count > 0 ? ((reworks.count / packed.count) * 100).toFixed(1) : 0,
    avg_pack_minutes: avgPackTime.avg_minutes ? avgPackTime.avg_minutes.toFixed(0) : null
  });
});

// GET /api/reports/delivery — delivery performance
router.get('/delivery', authenticate, authorize(...ADMIN_ROLES), (req, res) => {
  const db = getDb();
  const { period = 'weekly' } = req.query;

  let dateFilter = '';
  if (period === 'daily') dateFilter = "AND date(d.delivered_at) = date('now')";
  else if (period === 'weekly') dateFilter = "AND strftime('%W-%Y', d.delivered_at) = strftime('%W-%Y', 'now')";
  else if (period === 'monthly') dateFilter = "AND strftime('%m-%Y', d.delivered_at) = strftime('%m-%Y', 'now')";

  const totalDeliveries = db.prepare(`
    SELECT COUNT(*) as count FROM deliveries d WHERE d.status = 'delivered' ${dateFilter}
  `).get();

  const onTime = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN d.delivered_at <= o.required_delivery_date THEN 1 ELSE 0 END) as on_time
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    WHERE d.status = 'delivered' ${dateFilter}
  `).get();

  const byDeliveryMan = db.prepare(`
    SELECT u.name, u.id,
      COUNT(*) as total,
      SUM(CASE WHEN d.delivered_at <= o.required_delivery_date THEN 1 ELSE 0 END) as on_time
    FROM deliveries d
    JOIN users u ON d.delivery_man_id = u.id
    JOIN orders o ON d.order_id = o.id
    WHERE d.status = 'delivered' ${dateFilter}
    GROUP BY u.id ORDER BY total DESC
  `).all();

  res.json({
    total_deliveries: totalDeliveries.count,
    on_time_count: onTime.on_time || 0,
    on_time_rate: onTime.total > 0 ? ((onTime.on_time / onTime.total) * 100).toFixed(1) : 0,
    by_delivery_man: byDeliveryMan
  });
});

// GET /api/reports/audit — audit trail (admin only)
router.get('/audit', authenticate, authorize('super_admin'), (req, res) => {
  const db = getDb();
  const { user_id, action, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = ['1=1'];
  const params = [];

  if (user_id) { where.push('al.user_id = ?'); params.push(user_id); }
  if (action) { where.push('al.action = ?'); params.push(action); }
  if (from) { where.push('al.created_at >= ?'); params.push(from); }
  if (to) { where.push('al.created_at <= ?'); params.push(to); }

  const logs = db.prepare(`
    SELECT al.*, u.name as user_name, o.invoice_number
    FROM activity_log al
    JOIN users u ON al.user_id = u.id
    LEFT JOIN orders o ON al.order_id = o.id
    WHERE ${where.join(' AND ')}
    ORDER BY al.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM activity_log al WHERE ${where.join(' AND ')}`)
    .get(...params).c;

  res.json({ logs, total, page: parseInt(page) });
});

module.exports = router;

// src/routes/orders.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate, canMoveOrders } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 } });

const VALID_STAGES = ['order', 'production', 'packing', 'ready_for_delivery', 'delivered', 'cancelled', 'on_hold'];

// Helper: log activity
function logActivity(db, { orderId, userId, action, details, oldValue, newValue, ipAddress }) {
  db.prepare(`
    INSERT INTO activity_log (id, order_id, user_id, action, details, old_value, new_value, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), orderId || null, userId, action, details || null, oldValue || null, newValue || null, ipAddress || null);
}

// Helper: create notification
function notify(db, { userId, type, title, message, orderId }) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, message, order_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, type, title, message || null, orderId || null);
}

// GET /api/orders — list with filters
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const { stage, priority, search, week, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = ['1=1'];
  let params = [];

  if (stage) { where.push('o.stage = ?'); params.push(stage); }
  if (priority) { where.push('o.priority = ?'); params.push(priority); }
  if (search) {
    where.push('(o.invoice_number LIKE ? OR o.customer_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (week === 'current') {
    where.push("strftime('%W-%Y', o.required_delivery_date) = strftime('%W-%Y', 'now')");
  }
  if (from) { where.push('o.required_delivery_date >= ?'); params.push(from); }
  if (to) { where.push('o.required_delivery_date <= ?'); params.push(to); }

  const sql = `
    SELECT o.*,
      u.name AS pic_name, u.avatar_color AS pic_color,
      cb.name AS created_by_name,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    LEFT JOIN users cb ON o.created_by = cb.id
    WHERE ${where.join(' AND ')}
    ORDER BY
      CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      o.required_delivery_date ASC
    LIMIT ? OFFSET ?
  `;
  params.push(parseInt(limit), offset);

  const orders = db.prepare(sql).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as c FROM orders o WHERE ${where.join(' AND ')}`).get(...params.slice(0, -2)).c;

  res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/orders/kanban — grouped by stage
router.get('/kanban', authenticate, (req, res) => {
  const db = getDb();
  const { week } = req.query;

  let weekFilter = '';
  if (week === 'current') {
    weekFilter = "AND strftime('%W-%Y', o.required_delivery_date) = strftime('%W-%Y', 'now')";
  }

  const sql = `
    SELECT o.*,
      u.name AS pic_name, u.avatar_color AS pic_color,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.stage NOT IN ('delivered','cancelled')
    ${weekFilter}
    ORDER BY
      CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      o.required_delivery_date ASC
  `;

  const allOrders = db.prepare(sql).all();
  const board = { order: [], production: [], packing: [], ready_for_delivery: [], on_hold: [] };
  for (const o of allOrders) {
    if (board[o.stage]) board[o.stage].push(o);
  }

  res.json(board);
});

// GET /api/orders/:id
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const order = db.prepare(`
    SELECT o.*, u.name AS pic_name, u.avatar_color AS pic_color, cb.name AS created_by_name
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    LEFT JOIN users cb ON o.created_by = cb.id
    WHERE o.id = ?
  `).get(req.params.id);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY rowid').all(order.id);
  const attachments = db.prepare(`
    SELECT a.*, u.name AS uploaded_by_name FROM order_attachments a
    JOIN users u ON a.uploaded_by = u.id
    WHERE a.order_id = ? ORDER BY a.uploaded_at DESC
  `).all(order.id);
  const activity = db.prepare(`
    SELECT al.*, u.name AS user_name FROM activity_log al
    JOIN users u ON al.user_id = u.id
    WHERE al.order_id = ? ORDER BY al.created_at DESC
  `).all(order.id);
  const transitions = db.prepare(`
    SELECT st.*, u.name AS by_name FROM stage_transitions st
    JOIN users u ON st.transitioned_by = u.id
    WHERE st.order_id = ? ORDER BY st.created_at ASC
  `).all(order.id);

  res.json({ ...order, items, attachments, activity, transitions });
});

// POST /api/orders — create order
router.post('/', authenticate, (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const db = getDb();
  const {
    invoice_number, customer_name, customer_contact,
    order_date, required_delivery_date, expiry_date,
    priority = 'normal', skip_production = false, pic_id, notes, items = []
  } = req.body;

  if (!invoice_number || !customer_name || !required_delivery_date) {
    return res.status(400).json({ error: 'invoice_number, customer_name, required_delivery_date are required' });
  }

  // Duplicate check
  const existing = db.prepare('SELECT id FROM orders WHERE invoice_number = ?').get(invoice_number);
  if (existing) return res.status(409).json({ error: `Invoice ${invoice_number} already exists` });

  const orderId = uuidv4();
  const initialStage = skip_production ? 'packing' : 'order';

  db.prepare(`
    INSERT INTO orders (id, invoice_number, customer_name, customer_contact,
      order_date, required_delivery_date, expiry_date, stage, priority,
      skip_production, pic_id, notes, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
  `).run(orderId, invoice_number, customer_name, customer_contact || null,
    order_date || new Date().toISOString().slice(0, 10),
    required_delivery_date, expiry_date || null,
    initialStage, priority, skip_production ? 1 : 0,
    pic_id || null, notes || null, req.user.id);

  for (const item of items) {
    db.prepare('INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), orderId, item.sku, item.name, item.quantity, item.unit || 'pcs');
  }

  // Stage transition record
  db.prepare('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES (?, ?, NULL, ?, ?)')
    .run(uuidv4(), orderId, initialStage, req.user.id);

  logActivity(db, { orderId, userId: req.user.id, action: 'order_created',
    details: `Order ${invoice_number} created`, newValue: initialStage, ipAddress: req.ip });

  const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json(created);
});

// PATCH /api/orders/:id — edit order details
router.patch('/:id', authenticate, (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fields = ['customer_name', 'customer_contact', 'required_delivery_date', 'expiry_date', 'priority', 'notes', 'pic_id'];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push('updated_at = datetime("now")');
  values.push(req.params.id);

  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  logActivity(db, { orderId: req.params.id, userId: req.user.id, action: 'order_edited',
    details: `Fields updated: ${updates.slice(0, -1).join(', ')}`, ipAddress: req.ip });

  res.json(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id));
});

// POST /api/orders/:id/move — move to next/specific stage
router.post('/:id/move', authenticate, canMoveOrders, (req, res) => {
  const db = getDb();
  const { to_stage, reason } = req.body;

  if (!VALID_STAGES.includes(to_stage)) {
    return res.status(400).json({ error: 'Invalid target stage' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fromStage = order.stage;

  db.prepare(`UPDATE orders SET stage = ?, updated_at = datetime("now") WHERE id = ?`)
    .run(to_stage, order.id);

  db.prepare('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by, reason) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), order.id, fromStage, to_stage, req.user.id, reason || null);

  logActivity(db, { orderId: order.id, userId: req.user.id, action: 'stage_moved',
    details: `${fromStage} → ${to_stage}${reason ? ': ' + reason : ''}`,
    oldValue: fromStage, newValue: to_stage, ipAddress: req.ip });

  // Notify PIC
  if (order.pic_id && order.pic_id !== req.user.id) {
    notify(db, {
      userId: order.pic_id, type: 'order_stage_entered',
      title: `Order ${order.invoice_number} moved to ${to_stage}`,
      message: `Moved by ${req.user.name}`,
      orderId: order.id
    });
  }

  res.json({ message: 'Order moved', from: fromStage, to: to_stage });
});

// POST /api/orders/:id/assign-pic
router.post('/:id/assign-pic', authenticate, canMoveOrders, (req, res) => {
  const db = getDb();
  const { pic_id } = req.body;

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const oldPic = order.pic_id;
  db.prepare('UPDATE orders SET pic_id = ?, updated_at = datetime("now") WHERE id = ?').run(pic_id, order.id);

  logActivity(db, { orderId: order.id, userId: req.user.id, action: 'pic_assigned',
    details: `PIC changed`, oldValue: oldPic, newValue: pic_id, ipAddress: req.ip });

  if (pic_id && pic_id !== req.user.id) {
    notify(db, {
      userId: pic_id, type: 'pic_assigned',
      title: `You are assigned to order ${order.invoice_number}`,
      orderId: order.id
    });
  }

  res.json({ message: 'PIC assigned' });
});

// POST /api/orders/:id/attachments
router.post('/:id/attachments', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const db = getDb();
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const att = {
    id: uuidv4(), order_id: order.id,
    filename: req.file.filename, original_name: req.file.originalname,
    mime_type: req.file.mimetype, size: req.file.size,
    uploaded_by: req.user.id
  };

  db.prepare(`
    INSERT INTO order_attachments (id, order_id, filename, original_name, mime_type, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(att.id, att.order_id, att.filename, att.original_name, att.mime_type, att.size, att.uploaded_by);

  logActivity(db, { orderId: order.id, userId: req.user.id, action: 'attachment_uploaded',
    details: req.file.originalname, ipAddress: req.ip });

  res.status(201).json(att);
});

// POST /api/orders/webhook/sql-account — SQL Account integration
router.post('/webhook/sql-account', (req, res) => {
  // Validate webhook secret
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.SQL_ACCOUNT_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const db = getDb();
  const { invoice_number, customer_name, customer_contact, required_delivery_date, items = [] } = req.body;

  if (!invoice_number || !customer_name) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const existing = db.prepare('SELECT id FROM orders WHERE invoice_number = ?').get(invoice_number);
  if (existing) return res.status(409).json({ error: 'Duplicate invoice', existing_id: existing.id });

  const systemUser = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get();
  const orderId = uuidv4();

  db.prepare(`
    INSERT INTO orders (id, invoice_number, customer_name, customer_contact,
      order_date, required_delivery_date, stage, source, created_by)
    VALUES (?, ?, ?, ?, date('now'), ?, 'order', 'sql_account', ?)
  `).run(orderId, invoice_number, customer_name, customer_contact || null,
    required_delivery_date, systemUser.id);

  for (const item of items) {
    db.prepare('INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), orderId, item.sku || 'N/A', item.name, item.quantity, item.unit || 'pcs');
  }

  res.status(201).json({ id: orderId, invoice_number });
});

module.exports = router;

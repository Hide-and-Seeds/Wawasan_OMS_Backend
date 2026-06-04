// src/routes/orders.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { query, withTransaction } = require('../utils/db');
const { authenticate, canMoveOrders } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer, publicUrl, removeObject } = require('../lib/supabaseClient');

// Files are buffered in memory then streamed to Supabase Storage
// (the local filesystem is ephemeral on serverless hosts like Vercel).
const MAX_UPLOAD = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024; // 5 MB default
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type — please upload a PDF or an image'));
  },
});
// Wrap multer so size/type errors return a clean message instead of a generic 500.
function uploadSingle(field) {
  return (req, res, next) => upload.single(field)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large — max ${Math.round(MAX_UPLOAD / 1048576)} MB` });
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

const VALID_STAGES = ['order', 'production', 'packing', 'ready_for_delivery', 'delivered', 'cancelled', 'on_hold'];
// Forward workflow + which staff roles "own" (may complete) each stage.
const FORWARD_STAGE = { order: 'production', production: 'packing', packing: 'ready_for_delivery', ready_for_delivery: 'delivered' };
const STAGE_OWNERS = { production: ['production_staff'], packing: ['packing_staff'] };

// Helper: log activity. `q` is a query runner (global query, or a tx client).
function logActivity(q, { orderId, userId, action, details, oldValue, newValue, ipAddress }) {
  return q(
    `INSERT INTO activity_log (id, order_id, user_id, action, details, old_value, new_value, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv4(), orderId || null, userId, action, details || null, oldValue || null, newValue || null, ipAddress || null]
  );
}

// Helper: create notification
function notify(q, { userId, type, title, message, orderId }) {
  return q(
    `INSERT INTO notifications (id, user_id, type, title, message, order_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), userId, type, title, message || null, orderId || null]
  );
}

// Self-migration: ensure the per-SKU "made" tracking columns exist (runs once
// per process; ADD COLUMN IF NOT EXISTS is idempotent and cheap on a no-op).
let _itemColsReady = false;
async function ensureItemColumns() {
  if (_itemColsReady) return;
  await query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS made boolean NOT NULL DEFAULT false');
  await query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS made_at timestamptz');
  await query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS made_by uuid REFERENCES users(id)');
  _itemColsReady = true;
}

// Self-migration: hold / waiting-stock are overlay flags so an order keeps its
// workflow stage while showing a badge (rather than moving to an 'on_hold' stage).
let _orderFlagsReady = false;
async function ensureOrderFlags() {
  if (_orderFlagsReady) return;
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS on_hold boolean NOT NULL DEFAULT false');
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS waiting_stock boolean NOT NULL DEFAULT false');
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS hold_reason text');
  _orderFlagsReady = true;
}

// GET /api/orders — list with filters
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { stage, priority, search, week, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const where = ['1=1'];
  const params = [];

  if (stage) { where.push(`o.stage = $${params.push(stage)}`); }
  if (priority) { where.push(`o.priority = $${params.push(priority)}`); }
  if (search) {
    const term = `%${search}%`;
    where.push(`(o.invoice_number ILIKE $${params.push(term)} OR o.customer_name ILIKE $${params.push(term)})`);
  }
  if (week === 'current') {
    where.push("date_trunc('week', o.required_delivery_date) = date_trunc('week', now())");
  }
  if (from) { where.push(`o.required_delivery_date >= $${params.push(from)}`); }
  if (to) { where.push(`o.required_delivery_date <= $${params.push(to)}`); }

  const whereSql = where.join(' AND ');
  const total = (await query(`SELECT COUNT(*)::int AS c FROM orders o WHERE ${whereSql}`, params)).rows[0].c;

  const limitIdx = params.push(parseInt(limit));
  const offsetIdx = params.push(offset);

  const sql = `
    SELECT o.*,
      u.name AS pic_name, u.avatar_color AS pic_color,
      cb.name AS created_by_name,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    LEFT JOIN users cb ON o.created_by = cb.id
    WHERE ${whereSql}
    ORDER BY
      CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      o.required_delivery_date ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const orders = (await query(sql, params)).rows;
  res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) });
}));

// GET /api/orders/kanban — grouped by stage
router.get('/kanban', authenticate, asyncHandler(async (req, res) => {
  const { week } = req.query;
  await ensureItemColumns();
  await ensureOrderFlags();

  const weekFilter = week === 'current'
    ? "AND date_trunc('week', o.required_delivery_date) = date_trunc('week', now())"
    : '';

  const sql = `
    SELECT o.*,
      u.name AS pic_name, u.avatar_color AS pic_color,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count,
      (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS total_units,
      (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id AND made) AS made_count
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    WHERE o.stage NOT IN ('delivered','cancelled')
    ${weekFilter}
    ORDER BY
      CASE o.priority WHEN 'urgent' THEN 0 ELSE 1 END,
      o.required_delivery_date ASC
  `;

  const allOrders = (await query(sql)).rows;
  const board = { order: [], production: [], packing: [], ready_for_delivery: [], on_hold: [] };
  for (const o of allOrders) {
    if (board[o.stage]) board[o.stage].push(o);
  }

  res.json(board);
}));

// GET /api/orders/stats — lightweight board stats (any authenticated user)
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const active = (await query(
    "SELECT COUNT(*)::int AS c FROM orders WHERE stage NOT IN ('delivered','cancelled')"
  )).rows[0].c;
  const completedToday = (await query(
    "SELECT COUNT(*)::int AS c FROM stage_transitions WHERE to_stage = 'delivered' AND created_at::date = CURRENT_DATE"
  )).rows[0].c;
  const overdue = (await query(
    "SELECT COUNT(*)::int AS c FROM orders WHERE required_delivery_date < CURRENT_DATE AND stage NOT IN ('delivered','cancelled')"
  )).rows[0].c;
  res.json({ active, completed_today: completedToday, overdue });
}));

// GET /api/orders/:id
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const order = (await query(`
    SELECT o.*, u.name AS pic_name, u.avatar_color AS pic_color, cb.name AS created_by_name
    FROM orders o
    LEFT JOIN users u ON o.pic_id = u.id
    LEFT JOIN users cb ON o.created_by = cb.id
    WHERE o.id = $1
  `, [req.params.id])).rows[0];

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = (await query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at', [order.id])).rows;
  const attachments = (await query(`
    SELECT a.*, u.name AS uploaded_by_name FROM order_attachments a
    JOIN users u ON a.uploaded_by = u.id
    WHERE a.order_id = $1 ORDER BY a.uploaded_at DESC
  `, [order.id])).rows.map((a) => ({ ...a, url: publicUrl(a.filename) }));
  const activity = (await query(`
    SELECT al.*, u.name AS user_name FROM activity_log al
    JOIN users u ON al.user_id = u.id
    WHERE al.order_id = $1 ORDER BY al.created_at DESC
  `, [order.id])).rows;
  const transitions = (await query(`
    SELECT st.*, u.name AS by_name FROM stage_transitions st
    JOIN users u ON st.transitioned_by = u.id
    WHERE st.order_id = $1 ORDER BY st.created_at ASC
  `, [order.id])).rows;

  res.json({ ...order, items, attachments, activity, transitions });
}));

// POST /api/orders — create order
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const {
    invoice_number, customer_name, customer_contact,
    order_date, required_delivery_date, expiry_date,
    priority = 'normal', skip_production = false, pic_id, notes, items = []
  } = req.body;

  if (!invoice_number || !customer_name || !required_delivery_date) {
    return res.status(400).json({ error: 'invoice_number, customer_name, required_delivery_date are required' });
  }

  // Duplicate check
  const existing = (await query('SELECT id FROM orders WHERE invoice_number = $1', [invoice_number])).rows[0];
  if (existing) return res.status(409).json({ error: `Invoice ${invoice_number} already exists` });

  const orderId = uuidv4();
  const initialStage = skip_production ? 'packing' : 'order';

  await withTransaction(async (q) => {
    await q(`
      INSERT INTO orders (id, invoice_number, customer_name, customer_contact,
        order_date, required_delivery_date, expiry_date, stage, priority,
        skip_production, pic_id, notes, source, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual', $13)
    `, [orderId, invoice_number, customer_name, customer_contact || null,
      order_date || new Date().toISOString().slice(0, 10),
      required_delivery_date, expiry_date || null,
      initialStage, priority, Boolean(skip_production),
      pic_id || null, notes || null, req.user.id]);

    for (const item of items) {
      await q('INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv4(), orderId, item.sku, item.name, item.quantity, item.unit || 'pcs']);
    }

    // Stage transition record
    await q('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES ($1, $2, NULL, $3, $4)',
      [uuidv4(), orderId, initialStage, req.user.id]);

    await logActivity(q, { orderId, userId: req.user.id, action: 'order_created',
      details: `Order ${invoice_number} created`, newValue: initialStage, ipAddress: req.ip });
  });

  const created = (await query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0];
  res.status(201).json(created);
}));

// PATCH /api/orders/:id — edit order details
router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const order = (await query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fields = ['customer_name', 'customer_contact', 'required_delivery_date', 'expiry_date', 'priority', 'notes', 'pic_id'];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${values.push(req.body[f])}`);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push('updated_at = now()');
  const idIdx = values.push(req.params.id);

  await query(`UPDATE orders SET ${updates.join(', ')} WHERE id = $${idIdx}`, values);

  await logActivity(query, { orderId: req.params.id, userId: req.user.id, action: 'order_edited',
    details: `Fields updated: ${fields.filter(f => req.body[f] !== undefined).join(', ')}`, ipAddress: req.ip });

  const updated = (await query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  res.json(updated);
}));

// POST /api/orders/:id/move — move to next/specific stage
router.post('/:id/move', authenticate, asyncHandler(async (req, res) => {
  const { to_stage, reason } = req.body;

  if (!VALID_STAGES.includes(to_stage)) {
    return res.status(400).json({ error: 'Invalid target stage' });
  }

  const order = (await query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const fromStage = order.stage;

  // Managers move freely; stage staff may only advance their own stage forward one step.
  if (!['super_admin', 'operations_controller'].includes(req.user.role)) {
    if (order.on_hold) return res.status(403).json({ error: 'Order is on hold' });
    const owners = STAGE_OWNERS[fromStage] || [];
    if (!owners.includes(req.user.role) || to_stage !== FORWARD_STAGE[fromStage]) {
      return res.status(403).json({ error: 'You can only mark your own stage complete' });
    }
  }

  await withTransaction(async (q) => {
    // Clear the PIC on a stage change so the next stage's owner is assigned fresh.
    await q('UPDATE orders SET stage = $1, pic_id = NULL, updated_at = now() WHERE id = $2', [to_stage, order.id]);

    await q('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by, reason) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuidv4(), order.id, fromStage, to_stage, req.user.id, reason || null]);

    await logActivity(q, { orderId: order.id, userId: req.user.id, action: 'stage_moved',
      details: `${fromStage} → ${to_stage}${reason ? ': ' + reason : ''}`,
      oldValue: fromStage, newValue: to_stage, ipAddress: req.ip });

    // Notify PIC
    if (order.pic_id && order.pic_id !== req.user.id) {
      await notify(q, {
        userId: order.pic_id, type: 'order_stage_entered',
        title: `Order ${order.invoice_number} moved to ${to_stage}`,
        message: `Moved by ${req.user.name}`,
        orderId: order.id
      });
    }
  });

  res.json({ message: 'Order moved', from: fromStage, to: to_stage });
}));

// POST /api/orders/:id/assign-pic
router.post('/:id/assign-pic', authenticate, canMoveOrders, asyncHandler(async (req, res) => {
  const { pic_id } = req.body;

  const order = (await query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const oldPic = order.pic_id;

  await withTransaction(async (q) => {
    await q('UPDATE orders SET pic_id = $1, updated_at = now() WHERE id = $2', [pic_id || null, order.id]);

    await logActivity(q, { orderId: order.id, userId: req.user.id, action: 'pic_assigned',
      details: `PIC changed`, oldValue: oldPic, newValue: pic_id, ipAddress: req.ip });

    if (pic_id && pic_id !== req.user.id) {
      await notify(q, {
        userId: pic_id, type: 'pic_assigned',
        title: `You are assigned to order ${order.invoice_number}`,
        orderId: order.id
      });
    }
  });

  res.json({ message: 'PIC assigned' });
}));

// PATCH /api/orders/:id/flags — toggle hold / waiting-stock overlay flags
router.patch('/:id/flags', authenticate, canMoveOrders, asyncHandler(async (req, res) => {
  await ensureOrderFlags();
  const order = (await query('SELECT * FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const sets = [];
  const vals = [];
  const acts = [];
  if (req.body.on_hold !== undefined) {
    sets.push(`on_hold = $${vals.push(!!req.body.on_hold)}`);
    sets.push(`hold_reason = $${vals.push(req.body.reason || null)}`);
    acts.push(req.body.on_hold ? 'put on hold' : 'released from hold');
  }
  if (req.body.waiting_stock !== undefined) {
    sets.push(`waiting_stock = $${vals.push(!!req.body.waiting_stock)}`);
    acts.push(req.body.waiting_stock ? 'flagged waiting stock' : 'cleared waiting stock');
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  sets.push('updated_at = now()');
  const idIdx = vals.push(req.params.id);
  await query(`UPDATE orders SET ${sets.join(', ')} WHERE id = $${idIdx}`, vals);

  await logActivity(query, {
    orderId: req.params.id, userId: req.user.id, action: 'order_flagged',
    details: `${order.invoice_number}: ${acts.join(', ')}`, ipAddress: req.ip || null,
  });
  res.json({ message: 'Flags updated' });
}));

// PATCH /api/orders/:id/items/:itemId — mark made (stage staff) or edit fields (Ops/Admin)
router.patch('/:id/items/:itemId', authenticate, asyncHandler(async (req, res) => {
  await ensureItemColumns();
  const item = (await query(
    'SELECT * FROM order_items WHERE id = $1 AND order_id = $2', [req.params.itemId, req.params.id]
  )).rows[0];
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const isManager = ['super_admin', 'operations_controller'].includes(req.user.role);
  const canMark = isManager || ['production_lead', 'production_staff', 'packing_staff'].includes(req.user.role);
  const b = req.body || {};
  const editingFields = ['sku', 'name', 'unit', 'quantity'].some((f) => b[f] !== undefined);
  if (editingFields && !isManager) return res.status(403).json({ error: 'Only Ops/Admin can edit item details' });
  if (b.made !== undefined && !canMark) return res.status(403).json({ error: 'Insufficient permissions' });

  const sets = [];
  const vals = [];
  if (b.made !== undefined) {
    const made = !!b.made;
    sets.push(`made = $${vals.push(made)}`);
    sets.push(`made_at = $${vals.push(made ? new Date().toISOString() : null)}`);
    sets.push(`made_by = $${vals.push(made ? req.user.id : null)}`);
  }
  if (b.sku !== undefined) sets.push(`sku = $${vals.push(b.sku)}`);
  if (b.name !== undefined) sets.push(`name = $${vals.push(b.name)}`);
  if (b.unit !== undefined) sets.push(`unit = $${vals.push(b.unit)}`);
  if (b.quantity !== undefined) sets.push(`quantity = $${vals.push(Number(b.quantity) || 0)}`);
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  const idIdx = vals.push(req.params.itemId);
  await query(`UPDATE order_items SET ${sets.join(', ')} WHERE id = $${idIdx}`, vals);
  await logActivity(query, {
    orderId: req.params.id, userId: req.user.id,
    action: b.made !== undefined ? (b.made ? 'item_made' : 'item_reopened') : 'item_edited',
    details: `${item.sku} — ${item.name}`, ipAddress: req.ip || null,
  });
  res.json({ ok: true });
}));

// POST /api/orders/:id/items — add a line item (Ops/Admin)
router.post('/:id/items', authenticate, canMoveOrders, asyncHandler(async (req, res) => {
  const order = (await query('SELECT id FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { sku, name, quantity, unit } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  await query(
    'INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, req.params.id, sku || 'N/A', name, Number(quantity) || 1, unit || 'pcs']
  );
  await logActivity(query, { orderId: req.params.id, userId: req.user.id, action: 'item_added', details: `${sku || ''} ${name}`.trim(), ipAddress: req.ip || null });
  res.status(201).json({ id });
}));

// DELETE /api/orders/:id/items/:itemId — remove a line item (Ops/Admin)
router.delete('/:id/items/:itemId', authenticate, canMoveOrders, asyncHandler(async (req, res) => {
  const item = (await query('SELECT * FROM order_items WHERE id = $1 AND order_id = $2', [req.params.itemId, req.params.id])).rows[0];
  if (!item) return res.status(404).json({ error: 'Item not found' });
  await query('DELETE FROM order_items WHERE id = $1', [req.params.itemId]);
  await logActivity(query, { orderId: req.params.id, userId: req.user.id, action: 'item_removed', details: `${item.sku} — ${item.name}`, ipAddress: req.ip || null });
  res.json({ ok: true });
}));

// POST /api/orders/:id/attachments
router.post('/:id/attachments', authenticate, uploadSingle('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const order = (await query('SELECT id FROM orders WHERE id = $1', [req.params.id])).rows[0];
  if (!order) return res.status(404).json({ error: 'Order not found' });

  let storedPath, url;
  try { ({ path: storedPath, url } = await uploadBuffer(req.file, 'attachments/')); }
  catch (e) { return res.status(502).json({ error: `Attachment upload failed: ${e.message}` }); }

  const att = {
    id: uuidv4(), order_id: order.id,
    filename: storedPath, original_name: req.file.originalname,
    mime_type: req.file.mimetype, size: req.file.size,
    uploaded_by: req.user.id
  };

  await query(`
    INSERT INTO order_attachments (id, order_id, filename, original_name, mime_type, size, uploaded_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [att.id, att.order_id, att.filename, att.original_name, att.mime_type, att.size, att.uploaded_by]);

  await logActivity(query, { orderId: order.id, userId: req.user.id, action: 'attachment_uploaded',
    details: req.file.originalname, ipAddress: req.ip });

  res.status(201).json({ ...att, url });
}));

// DELETE /api/orders/:id/attachments/:attId — remove an attachment + its file (Ops/Admin)
router.delete('/:id/attachments/:attId', authenticate, canMoveOrders, asyncHandler(async (req, res) => {
  const att = (await query('SELECT * FROM order_attachments WHERE id = $1 AND order_id = $2', [req.params.attId, req.params.id])).rows[0];
  if (!att) return res.status(404).json({ error: 'Attachment not found' });
  try { await removeObject(att.filename); } catch (e) { /* best-effort: still remove the record */ }
  await query('DELETE FROM order_attachments WHERE id = $1', [req.params.attId]);
  await logActivity(query, { orderId: req.params.id, userId: req.user.id, action: 'attachment_removed', details: att.original_name, ipAddress: req.ip || null });
  res.json({ ok: true });
}));

// POST /api/orders/webhook/sql-account — SQL Account integration
router.post('/webhook/sql-account', asyncHandler(async (req, res) => {
  // Validate webhook secret
  const secret = req.headers['x-webhook-secret'];
  if (secret !== process.env.SQL_ACCOUNT_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const { invoice_number, customer_name, customer_contact, required_delivery_date, items = [] } = req.body;

  if (!invoice_number || !customer_name) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const existing = (await query('SELECT id FROM orders WHERE invoice_number = $1', [invoice_number])).rows[0];
  if (existing) return res.status(409).json({ error: 'Duplicate invoice', existing_id: existing.id });

  const systemUser = (await query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1")).rows[0];
  if (!systemUser) return res.status(500).json({ error: 'No system user configured' });

  const orderId = uuidv4();

  await withTransaction(async (q) => {
    await q(`
      INSERT INTO orders (id, invoice_number, customer_name, customer_contact,
        order_date, required_delivery_date, stage, source, created_by)
      VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'order', 'sql_account', $6)
    `, [orderId, invoice_number, customer_name, customer_contact || null,
      required_delivery_date, systemUser.id]);

    for (const item of items) {
      await q('INSERT INTO order_items (id, order_id, sku, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuidv4(), orderId, item.sku || 'N/A', item.name, item.quantity, item.unit || 'pcs']);
    }
  });

  res.status(201).json({ id: orderId, invoice_number });
}));

module.exports = router;

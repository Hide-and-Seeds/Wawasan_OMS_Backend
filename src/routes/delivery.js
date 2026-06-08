// src/routes/delivery.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { query, withTransaction } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { uploadBuffer } = require('../lib/supabaseClient');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
});

// Self-migration: per-delivery address (additive, idempotent).
let _delSchemaReady = false;
async function ensureDeliverySchema() {
  if (_delSchemaReady) return;
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS address text');
  await query(`CREATE TABLE IF NOT EXISTS deliverers (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    phone      text,
    is_active  boolean not null default true,
    created_at timestamptz not null default now()
  )`);
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS deliverer_id uuid REFERENCES deliverers(id)');
  _delSchemaReady = true;
}

// Production-floor roles must not see the customer — mirror the scrub in orders.js.
const CUSTOMER_HIDDEN_ROLES = ['production_lead', 'production_staff', 'packing_staff'];

// GET /api/delivery — list deliveries
router.get('/', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliverySchema();
  const { status, delivery_man_id, date, order_id } = req.query;
  const where = ['1=1'];
  const params = [];

  if (status) { where.push(`d.status = $${params.push(status)}`); }
  if (delivery_man_id) { where.push(`d.delivery_man_id = $${params.push(delivery_man_id)}`); }
  if (date) { where.push(`d.scheduled_date = $${params.push(date)}`); }
  if (order_id) { where.push(`d.order_id = $${params.push(order_id)}`); }

  const deliveries = (await query(`
    SELECT d.*, o.invoice_number, o.customer_name, o.required_delivery_date,
      COALESCE(dl.name, u.name) AS delivery_man_name, dl.name AS deliverer_name
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    LEFT JOIN deliverers dl ON d.deliverer_id = dl.id
    LEFT JOIN users u ON d.delivery_man_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY d.scheduled_date ASC, o.required_delivery_date ASC
  `, params)).rows;

  const hideCustomer = CUSTOMER_HIDDEN_ROLES.includes(req.user.role);
  res.json(hideCustomer ? deliveries.map((d) => ({ ...d, customer_name: null, address: null })) : deliveries);
}));

// POST /api/delivery — assign delivery
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'operations_controller', 'delivery_team'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();

  const { order_id, deliverer_id, scheduled_date, address, notes } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const order = (await query("SELECT id FROM orders WHERE id = $1 AND stage = 'ready_for_delivery'", [order_id])).rows[0];
  if (!order) return res.status(400).json({ error: 'Order not found or not ready for delivery' });

  // A deliverer (if chosen) must be a real, active one. Deliverers don't log in.
  if (deliverer_id) {
    const dl = (await query('SELECT id, is_active FROM deliverers WHERE id = $1', [deliverer_id])).rows[0];
    if (!dl || !dl.is_active) return res.status(400).json({ error: 'Deliverer must be active' });
  }

  const id = uuidv4();
  await withTransaction(async (q) => {
    await q(`
      INSERT INTO deliveries (id, order_id, deliverer_id, scheduled_date, address, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, order_id, deliverer_id || null, scheduled_date || null, address || null, notes || null]);

    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_scheduled', $4)`,
      [uuidv4(), order_id, req.user.id, `Delivery scheduled${scheduled_date ? ' for ' + scheduled_date : ''}`]);
  });

  res.status(201).json({ id });
}));

// POST /api/delivery/:id/deliver — mark delivered
router.post('/:id/deliver', authenticate, upload.single('signature'), asyncHandler(async (req, res) => {
  const delivery = (await query('SELECT * FROM deliveries WHERE id = $1', [req.params.id])).rows[0];
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  // Guard against double-completion (would write a duplicate delivered transition).
  if (delivery.status === 'delivered') return res.status(409).json({ error: 'This delivery is already completed' });

  // Boss, Ops, or the Delivery Coordinator may mark a delivery complete.
  const allowed = ['super_admin', 'operations_controller', 'delivery_team'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  let signatureFile = null;
  if (req.file) {
    try { const { path: storedPath } = await uploadBuffer(req.file, 'signatures/'); signatureFile = storedPath; }
    catch (e) { return res.status(502).json({ error: `Signature upload failed: ${e.message}` }); }
  }

  await withTransaction(async (q) => {
    await q(`
      UPDATE deliveries SET status = 'delivered', delivered_at = now(),
        signature_file = $1, updated_at = now() WHERE id = $2
    `, [signatureFile, delivery.id]);

    // Move order to delivered
    await q("UPDATE orders SET stage = 'delivered', updated_at = now() WHERE id = $1", [delivery.order_id]);

    await q('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), delivery.order_id, 'ready_for_delivery', 'delivered', req.user.id]);

    // Audit log (was previously missing on delivery completion).
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details)
             VALUES ($1, $2, $3, 'delivery_completed', $4)`,
      [uuidv4(), delivery.order_id, req.user.id, 'Marked delivered']);
  });

  res.json({ message: 'Marked as delivered' });
}));

// ─── Deliverers (no-login driver list, managed by Boss / Ops / Coordinator) ───
const DELIVERER_MANAGERS = ['super_admin', 'operations_controller', 'delivery_team'];

// GET /api/delivery/deliverers — list (any authenticated user who can reach Delivery)
router.get('/deliverers', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliverySchema();
  const rows = (await query('SELECT * FROM deliverers ORDER BY is_active DESC, name ASC')).rows;
  res.json(rows);
}));

// POST /api/delivery/deliverers — add a deliverer
router.post('/deliverers', authenticate, asyncHandler(async (req, res) => {
  if (!DELIVERER_MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();
  const { name, phone } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const id = uuidv4();
  await query('INSERT INTO deliverers (id, name, phone) VALUES ($1, $2, $3)', [id, name.trim(), phone || null]);
  res.status(201).json({ id, name: name.trim(), phone: phone || null, is_active: true });
}));

// PATCH /api/delivery/deliverers/:id — rename / set phone / enable-disable
router.patch('/deliverers/:id', authenticate, asyncHandler(async (req, res) => {
  if (!DELIVERER_MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliverySchema();
  const sets = [], vals = [];
  if (req.body.name !== undefined) sets.push(`name = $${vals.push(req.body.name)}`);
  if (req.body.phone !== undefined) sets.push(`phone = $${vals.push(req.body.phone || null)}`);
  if (req.body.is_active !== undefined) sets.push(`is_active = $${vals.push(!!req.body.is_active)}`);
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  const idIdx = vals.push(req.params.id);
  await query(`UPDATE deliverers SET ${sets.join(', ')} WHERE id = $${idIdx}`, vals);
  res.json({ message: 'Deliverer updated' });
}));

module.exports = router;

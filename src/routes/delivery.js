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
let _addrReady = false;
async function ensureDeliveryAddress() {
  if (_addrReady) return;
  await query('ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS address text');
  _addrReady = true;
}

// Production-floor roles must not see the customer — mirror the scrub in orders.js.
const CUSTOMER_HIDDEN_ROLES = ['production_lead', 'production_staff', 'packing_staff'];

// GET /api/delivery — list deliveries
router.get('/', authenticate, asyncHandler(async (req, res) => {
  await ensureDeliveryAddress();
  const { status, delivery_man_id, date, order_id } = req.query;
  const where = ['1=1'];
  const params = [];

  if (status) { where.push(`d.status = $${params.push(status)}`); }
  if (delivery_man_id) { where.push(`d.delivery_man_id = $${params.push(delivery_man_id)}`); }
  if (date) { where.push(`d.scheduled_date = $${params.push(date)}`); }
  if (order_id) { where.push(`d.order_id = $${params.push(order_id)}`); }

  const deliveries = (await query(`
    SELECT d.*, o.invoice_number, o.customer_name, o.required_delivery_date,
      u.name AS delivery_man_name
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    LEFT JOIN users u ON d.delivery_man_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY d.scheduled_date ASC, o.required_delivery_date ASC
  `, params)).rows;

  const hideCustomer = CUSTOMER_HIDDEN_ROLES.includes(req.user.role);
  res.json(hideCustomer ? deliveries.map((d) => ({ ...d, customer_name: null, address: null })) : deliveries);
}));

// POST /api/delivery — assign delivery
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  await ensureDeliveryAddress();

  const { order_id, delivery_man_id, scheduled_date, address, notes } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const order = (await query("SELECT id FROM orders WHERE id = $1 AND stage = 'ready_for_delivery'", [order_id])).rows[0];
  if (!order) return res.status(400).json({ error: 'Order not found or not ready for delivery' });

  const id = uuidv4();

  await withTransaction(async (q) => {
    await q(`
      INSERT INTO deliveries (id, order_id, delivery_man_id, scheduled_date, address, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [id, order_id, delivery_man_id || null, scheduled_date || null, address || null, notes || null]);

    if (delivery_man_id) {
      await q(`
        INSERT INTO notifications (id, user_id, type, title, message, order_id)
        VALUES ($1, $2, 'pic_assigned', 'New Delivery Assigned', 'You have a new delivery scheduled', $3)
      `, [uuidv4(), delivery_man_id, order_id]);
    }
  });

  res.status(201).json({ id });
}));

// POST /api/delivery/:id/deliver — mark delivered
router.post('/:id/deliver', authenticate, upload.single('signature'), asyncHandler(async (req, res) => {
  const delivery = (await query('SELECT * FROM deliveries WHERE id = $1', [req.params.id])).rows[0];
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  // Guard against double-completion (would write a duplicate delivered transition).
  if (delivery.status === 'delivered') return res.status(409).json({ error: 'This delivery is already completed' });

  // Only delivery man or admin can mark delivered
  const allowed = ['super_admin', 'operations_controller', 'delivery_team'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  // A driver may only complete a delivery assigned to them; managers complete any.
  if (req.user.role === 'delivery_team' && delivery.delivery_man_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only complete deliveries assigned to you' });
  }

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
  });

  res.json({ message: 'Marked as delivered' });
}));

module.exports = router;

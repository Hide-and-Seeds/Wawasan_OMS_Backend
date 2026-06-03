// src/routes/delivery.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `sig_${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// GET /api/delivery — list deliveries
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const { status, delivery_man_id, date } = req.query;
  let where = ['1=1'];
  const params = [];

  if (status) { where.push('d.status = ?'); params.push(status); }
  if (delivery_man_id) { where.push('d.delivery_man_id = ?'); params.push(delivery_man_id); }
  if (date) { where.push('d.scheduled_date = ?'); params.push(date); }

  const deliveries = db.prepare(`
    SELECT d.*, o.invoice_number, o.customer_name, o.required_delivery_date,
      u.name as delivery_man_name
    FROM deliveries d
    JOIN orders o ON d.order_id = o.id
    LEFT JOIN users u ON d.delivery_man_id = u.id
    WHERE ${where.join(' AND ')}
    ORDER BY d.scheduled_date ASC, o.required_delivery_date ASC
  `).all(...params);

  res.json(deliveries);
});

// POST /api/delivery — assign delivery
router.post('/', authenticate, (req, res) => {
  const allowed = ['super_admin', 'operations_controller'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const db = getDb();
  const { order_id, delivery_man_id, scheduled_date, notes } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const order = db.prepare('SELECT id FROM orders WHERE id = ? AND stage = "ready_for_delivery"').get(order_id);
  if (!order) return res.status(400).json({ error: 'Order not found or not ready for delivery' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO deliveries (id, order_id, delivery_man_id, scheduled_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, order_id, delivery_man_id || null, scheduled_date || null, notes || null);

  if (delivery_man_id) {
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, message, order_id)
      VALUES (?, ?, 'pic_assigned', 'New Delivery Assigned', 'You have a new delivery scheduled', ?)
    `).run(uuidv4(), delivery_man_id, order_id);
  }

  res.status(201).json({ id });
});

// POST /api/delivery/:id/deliver — mark delivered
router.post('/:id/deliver', authenticate, upload.single('signature'), (req, res) => {
  const db = getDb();
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });

  // Only delivery man or admin can mark delivered
  const allowed = ['super_admin', 'operations_controller', 'delivery_team'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const signatureFile = req.file ? req.file.filename : null;

  db.prepare(`
    UPDATE deliveries SET status = 'delivered', delivered_at = datetime('now'),
      signature_file = ?, updated_at = datetime('now') WHERE id = ?
  `).run(signatureFile, delivery.id);

  // Move order to delivered
  db.prepare("UPDATE orders SET stage = 'delivered', updated_at = datetime('now') WHERE id = ?")
    .run(delivery.order_id);

  db.prepare('INSERT INTO stage_transitions (id, order_id, from_stage, to_stage, transitioned_by) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), delivery.order_id, 'ready_for_delivery', 'delivered', req.user.id);

  res.json({ message: 'Marked as delivered' });
});

module.exports = router;

// src/routes/notifications.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const { unread_only } = req.query;
  let sql = `
    SELECT n.*, o.invoice_number FROM notifications n
    LEFT JOIN orders o ON n.order_id = o.id
    WHERE n.user_id = ?
  `;
  const params = [req.user.id];
  if (unread_only === '1') { sql += ' AND n.is_read = 0'; }
  sql += ' ORDER BY n.created_at DESC LIMIT 50';

  const notifications = db.prepare(sql).all(...params);
  const unread_count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;

  res.json({ notifications, unread_count });
});

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All notifications marked as read' });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Notification marked as read' });
});

module.exports = router;

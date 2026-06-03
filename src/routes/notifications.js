// src/routes/notifications.js
const express = require('express');
const router = express.Router();
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/notifications
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { unread_only } = req.query;

  let sql = `
    SELECT n.*, o.invoice_number FROM notifications n
    LEFT JOIN orders o ON n.order_id = o.id
    WHERE n.user_id = $1
  `;
  if (unread_only === '1') { sql += ' AND n.is_read = false'; }
  sql += ' ORDER BY n.created_at DESC LIMIT 50';

  const notifications = (await query(sql, [req.user.id])).rows;
  const unread_count = (await query(
    'SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = false',
    [req.user.id]
  )).rows[0].c;

  res.json({ notifications, unread_count });
}));

// PATCH /api/notifications/read-all
router.patch('/read-all', authenticate, asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
  res.json({ message: 'All notifications marked as read' });
}));

// PATCH /api/notifications/:id/read
router.patch('/:id/read', authenticate, asyncHandler(async (req, res) => {
  await query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ message: 'Notification marked as read' });
}));

module.exports = router;

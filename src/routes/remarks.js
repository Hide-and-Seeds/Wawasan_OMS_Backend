// src/routes/remarks.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// Production staff may READ the weekly remarks (they're the audience); only the
// lead and owners may WRITE them.
const READ_ROLES = ['super_admin', 'production_lead', 'production_staff'];
const WRITE_ROLES = ['super_admin', 'production_lead'];

// GET /api/remarks — list all remarks
router.get('/', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  const remarks = (await query(`
    SELECT r.*, u.name AS author_name FROM production_remarks r
    JOIN users u ON r.author_id = u.id
    ORDER BY r.week_start DESC
  `)).rows;
  res.json(remarks);
}));

// GET /api/remarks/current — current week (Monday-anchored)
router.get('/current', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  const remark = (await query(`
    SELECT r.*, u.name AS author_name FROM production_remarks r
    JOIN users u ON r.author_id = u.id
    WHERE r.week_start = date_trunc('week', now())::date
    ORDER BY r.updated_at DESC LIMIT 1
  `)).rows[0];
  res.json(remark || null);
}));

// POST /api/remarks
router.post('/', authenticate, authorize(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const { content, week_start } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  // Calculate week range (Mon–Sun)
  const wStart = week_start || (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    return mon.toISOString().slice(0, 10);
  })();
  const wEnd = new Date(new Date(wStart).getTime() + 6 * 86400000).toISOString().slice(0, 10);

  const id = uuidv4();

  await withTransaction(async (q) => {
    await q(`
      INSERT INTO production_remarks (id, author_id, week_start, week_end, content)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, req.user.id, wStart, wEnd, content]);

    // Notify the audience: owners + the whole production team (lead & staff), minus the author.
    const recipients = (await q(
      "SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true",
      [['super_admin', 'production_lead', 'production_staff']]
    )).rows;
    for (const r of recipients) {
      if (r.id === req.user.id) continue;
      await q(`
        INSERT INTO notifications (id, user_id, type, title, message)
        VALUES ($1, $2, 'weekly_remark', 'New Weekly Remark', $3)
      `, [uuidv4(), r.id, `${req.user.name} posted weekly remarks for w/c ${wStart}`]);
    }
  });

  res.status(201).json({ id, week_start: wStart, week_end: wEnd });
}));

// PATCH /api/remarks/:id
router.patch('/:id', authenticate, authorize(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const remark = (await query('SELECT * FROM production_remarks WHERE id = $1', [req.params.id])).rows[0];
  if (!remark) return res.status(404).json({ error: 'Not found' });
  if (remark.author_id !== req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Not your remark' });
  }

  await query('UPDATE production_remarks SET content = $1, updated_at = now() WHERE id = $2',
    [req.body.content, req.params.id]);
  res.json({ message: 'Updated' });
}));

module.exports = router;

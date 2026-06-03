// src/routes/remarks.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');

const ALLOWED_ROLES = ['super_admin', 'production_lead'];

// GET /api/remarks — list all remarks
router.get('/', authenticate, authorize(...ALLOWED_ROLES), (req, res) => {
  const db = getDb();
  const remarks = db.prepare(`
    SELECT r.*, u.name as author_name FROM production_remarks r
    JOIN users u ON r.author_id = u.id
    ORDER BY r.week_start DESC
  `).all();
  res.json(remarks);
});

// GET /api/remarks/current — current week
router.get('/current', authenticate, authorize(...ALLOWED_ROLES), (req, res) => {
  const db = getDb();
  const remark = db.prepare(`
    SELECT r.*, u.name as author_name FROM production_remarks r
    JOIN users u ON r.author_id = u.id
    WHERE r.week_start = date('now', 'weekday 0', '-6 days')
    ORDER BY r.updated_at DESC LIMIT 1
  `).get();
  res.json(remark || null);
});

// POST /api/remarks
router.post('/', authenticate, authorize(...ALLOWED_ROLES), (req, res) => {
  const { content, week_start } = req.body;
  if (!content) return res.status(400).json({ error: 'Content is required' });

  const db = getDb();
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
  db.prepare(`
    INSERT INTO production_remarks (id, author_id, week_start, week_end, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, req.user.id, wStart, wEnd, content);

  // Notify all super admins
  const admins = db.prepare("SELECT id FROM users WHERE role = 'super_admin' AND is_active = 1").all();
  for (const admin of admins) {
    if (admin.id !== req.user.id) {
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, title, message)
        VALUES (?, ?, 'weekly_remark', 'New Weekly Remark', ?)
      `).run(uuidv4(), admin.id, `${req.user.name} posted weekly remarks for w/c ${wStart}`);
    }
  }

  res.status(201).json({ id, week_start: wStart, week_end: wEnd });
});

// PATCH /api/remarks/:id
router.patch('/:id', authenticate, authorize(...ALLOWED_ROLES), (req, res) => {
  const db = getDb();
  const remark = db.prepare('SELECT * FROM production_remarks WHERE id = ?').get(req.params.id);
  if (!remark) return res.status(404).json({ error: 'Not found' });
  if (remark.author_id !== req.user.id && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Not your remark' });
  }

  db.prepare('UPDATE production_remarks SET content = ?, updated_at = datetime("now") WHERE id = ?')
    .run(req.body.content, req.params.id);
  res.json({ message: 'Updated' });
});

module.exports = router;

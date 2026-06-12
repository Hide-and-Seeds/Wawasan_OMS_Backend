// src/routes/remarks.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// The lead, owners and the back-office Admin may READ the weekly remarks; only the
// lead and owners may WRITE them.
const READ_ROLES = ['super_admin', 'production_lead', 'admin'];
// Only the Production Head writes the weekly remark; the Boss writes the monthly summary.
const WRITE_ROLES = ['production_lead'];

// Archive tables (column mirrors). The pg_cron jobs move old remarks here
// (weekly: past weeks; quarterly: months > 3mo) so the live tables stay lean but
// nothing is lost — the reads below union them back so full history still shows.
async function ensureArchives() {
  await query('CREATE TABLE IF NOT EXISTS production_remarks_archive (LIKE production_remarks)');
  await ensureMonthly();
  await query('CREATE TABLE IF NOT EXISTS monthly_remarks_archive (LIKE monthly_remarks)');
}

// GET /api/remarks — list all remarks (live + archived)
router.get('/', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  await ensureArchives();
  const remarks = (await query(`
    SELECT r.*, u.name AS author_name FROM (
      SELECT * FROM production_remarks
      UNION ALL
      SELECT * FROM production_remarks_archive
    ) r LEFT JOIN users u ON r.author_id = u.id
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

    // Notify the audience: owners + the production lead, minus the author. (Production
    // staff no longer read remarks, so they're not notified.)
    const recipients = (await q(
      "SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true",
      [['super_admin', 'production_lead']]
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

// ─── Monthly summary remarks (Boss-authored, one per month) ──────────────────
async function ensureMonthly() {
  await query(`CREATE TABLE IF NOT EXISTS monthly_remarks (
    id uuid PRIMARY KEY,
    month_start date UNIQUE NOT NULL,
    content text NOT NULL,
    author_id uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}

// GET /api/remarks/monthly — list monthly summaries (live + archived)
router.get('/monthly', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  await ensureArchives();
  const rows = (await query(`
    SELECT m.*, u.name AS author_name FROM (
      SELECT * FROM monthly_remarks
      UNION ALL
      SELECT * FROM monthly_remarks_archive
    ) m LEFT JOIN users u ON m.author_id = u.id
    ORDER BY m.month_start DESC
  `)).rows;
  res.json(rows);
}));

// POST /api/remarks/monthly — write / overwrite a month's summary (Boss only).
// Upserts on month_start so editing the current month is just another POST.
router.post('/monthly', authenticate, authorize('super_admin'), asyncHandler(async (req, res) => {
  await ensureMonthly();
  const { content, month_start } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });
  const row = (await query(`
    INSERT INTO monthly_remarks (id, month_start, content, author_id, created_at, updated_at)
    VALUES ($1, COALESCE($2::date, date_trunc('month', now())::date), $3, $4, now(), now())
    ON CONFLICT (month_start) DO UPDATE SET content = EXCLUDED.content, author_id = EXCLUDED.author_id, updated_at = now()
    RETURNING *
  `, [uuidv4(), month_start || null, content.trim(), req.user.id])).rows[0];
  res.json(row);
}));

module.exports = router;

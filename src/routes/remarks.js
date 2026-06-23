// src/routes/remarks.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// The lead, owners and the back-office Admin may READ the weekly remarks.
const READ_ROLES = ['super_admin', 'production_lead', 'admin'];
// The Production Head (Reenee, production_lead) and the Admin (Misha) co-own the weekly
// remark and both may WRITE/edit it, so production arrangements stay aligned both ways.
// The Boss writes the monthly summary.
const WRITE_ROLES = ['production_lead', 'admin'];

// Archive tables (column mirrors). The pg_cron jobs move old remarks here
// (weekly: past weeks; quarterly: months > 3mo) so the live tables stay lean but
// nothing is lost — the reads below union them back so full history still shows.
async function ensureArchives() {
  await query('CREATE TABLE IF NOT EXISTS production_remarks_archive (LIKE production_remarks)');
  // Last-editor tracking (idempotent — covers fresh DBs and keeps the archive mirror aligned).
  await query('ALTER TABLE production_remarks ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES users(id)');
  await query('ALTER TABLE production_remarks ADD COLUMN IF NOT EXISTS edited_at timestamptz');
  await query('ALTER TABLE production_remarks_archive ADD COLUMN IF NOT EXISTS edited_by uuid');
  await query('ALTER TABLE production_remarks_archive ADD COLUMN IF NOT EXISTS edited_at timestamptz');
  await ensureMonthly();
  await query('CREATE TABLE IF NOT EXISTS monthly_remarks_archive (LIKE monthly_remarks)');
}

// Notify the remark audience (owners + lead + admin) of a post/edit, minus the actor,
// so Reenee and Misha always see each other's changes.
async function notifyRemarkAudience(q, actorId, title, message) {
  const recipients = (await q(
    "SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true",
    [['super_admin', 'production_lead', 'admin']]
  )).rows;
  for (const r of recipients) {
    if (r.id === actorId) continue;
    await q(
      "INSERT INTO notifications (id, user_id, type, title, message) VALUES ($1, $2, 'weekly_remark', $3, $4)",
      [uuidv4(), r.id, title, message]
    );
  }
}

// GET /api/remarks — list all remarks (live + archived)
router.get('/', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  await ensureArchives();
  const remarks = (await query(`
    SELECT r.*, u.name AS author_name, e.name AS editor_name FROM (
      SELECT * FROM production_remarks
      UNION ALL
      SELECT * FROM production_remarks_archive
    ) r LEFT JOIN users u ON r.author_id = u.id
      LEFT JOIN users e ON e.id = r.edited_by
    ORDER BY r.week_start DESC
  `)).rows;
  res.json(remarks);
}));

// GET /api/remarks/current — current week (Monday-anchored)
router.get('/current', authenticate, authorize(...READ_ROLES), asyncHandler(async (req, res) => {
  const remark = (await query(`
    SELECT r.*, u.name AS author_name, e.name AS editor_name FROM production_remarks r
    JOIN users u ON r.author_id = u.id
    LEFT JOIN users e ON e.id = r.edited_by
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

    // Production staff no longer read remarks, so they're not notified.
    await notifyRemarkAudience(q, req.user.id, 'New Weekly Remark',
      `${req.user.name} posted weekly remarks for w/c ${wStart}`);
  });

  res.status(201).json({ id, week_start: wStart, week_end: wEnd });
}));

// PATCH /api/remarks/:id
router.patch('/:id', authenticate, authorize(...WRITE_ROLES), asyncHandler(async (req, res) => {
  const remark = (await query('SELECT * FROM production_remarks WHERE id = $1', [req.params.id])).rows[0];
  if (!remark) return res.status(404).json({ error: 'Not found' });
  // Weekly remarks are a shared doc co-owned by the lead + admin (both in WRITE_ROLES),
  // so any writer may edit regardless of who first created the row.
  if (!req.body.content || !req.body.content.trim()) return res.status(400).json({ error: 'Content is required' });

  const wStart = new Date(remark.week_start).toISOString().slice(0, 10);
  await withTransaction(async (q) => {
    await q('UPDATE production_remarks SET content = $1, updated_at = now(), edited_by = $2, edited_at = now() WHERE id = $3',
      [req.body.content, req.user.id, req.params.id]);
    // Edits used to be silent; notify the others so the change isn't missed.
    await notifyRemarkAudience(q, req.user.id, 'Weekly Remark Updated',
      `${req.user.name} updated the weekly remarks for w/c ${wStart}`);
  });
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

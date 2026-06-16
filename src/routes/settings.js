// src/routes/settings.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/settings — all settings as a key→value object
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const rows = (await query('SELECT key, value FROM system_settings')).rows;
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
}));

// PUT /api/settings — upsert a batch of settings (admin)
router.put('/', authenticate, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const settings = req.body.settings || {};
  for (const [key, value] of Object.entries(settings)) {
    await query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, value == null ? '' : String(value), req.user.id]
    );
  }
  res.json({ message: 'Settings saved' });
}));

// ─── Holiday calendar ───
// GET /api/settings/holidays
router.get('/holidays', authenticate, asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM holidays ORDER BY date')).rows);
}));

// POST /api/settings/holidays (admin)
router.post('/holidays', authenticate, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'date and name are required' });
  const id = uuidv4();
  await query('INSERT INTO holidays (id, date, name) VALUES ($1, $2, $3)', [id, date, name]);
  res.status(201).json({ id, date, name });
}));

// DELETE /api/settings/holidays/:id (admin)
router.delete('/holidays/:id', authenticate, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  res.json({ message: 'Holiday removed' });
}));

// POST /api/settings/holidays/bulk (admin) — import many at once from a CSV/Excel
// upload (parsed client-side to {date,name}). Skips dates that already exist, so
// re-importing the same file is safe.
router.post('/holidays/bulk', authenticate, authorize('super_admin', 'admin'), asyncHandler(async (req, res) => {
  const list = Array.isArray(req.body.holidays) ? req.body.holidays : [];
  let inserted = 0, skipped = 0;
  for (const h of list) {
    const date = h && h.date;
    const name = ((h && h.name) || '').toString().trim();
    if (!date || !name) { skipped++; continue; }
    const r = await query(
      `INSERT INTO holidays (id, date, name)
       SELECT $1, $2, $3 WHERE NOT EXISTS (SELECT 1 FROM holidays WHERE date = $2)`,
      [uuidv4(), date, name]
    );
    if (r.rowCount > 0) inserted++; else skipped++;
  }
  res.json({ inserted, skipped });
}));

// POST /api/settings/clear-data — Boss-only reset of the order board + its history,
// for a fresh start (new period / after testing). super_admin-only, requires
// { confirm: 'CLEAR' }. REVERSIBLE: every table is first snapshot to a single rolling
// recovery copy (<table>__cleared_backup, overwriting the previous one) so a reset can
// be undone and the audit trail is preserved, not destroyed. Clears orders + every
// order-linked table + the activity log; KEEPS users, settings, holidays, drivers and
// remarks. Invoices + financial records live in SQL Account and are never touched here.
const CLEARABLE_TABLES = ['order_items', 'stage_transitions', 'notifications', 'message_queue',
  'deliveries', 'order_attachments', 'activity_log', 'activity_log_archive', 'orders'];
router.post('/clear-data', authenticate, authorize('super_admin'), asyncHandler(async (req, res) => {
  if (!req.body || req.body.confirm !== 'CLEAR') {
    return res.status(400).json({ error: "Confirmation required — send { confirm: 'CLEAR' }." });
  }
  const counts = {};
  await withTransaction(async (q) => {
    // 1. Snapshot to a rolling recovery copy first (so the reset is reversible).
    for (const t of CLEARABLE_TABLES) {
      await q(`DROP TABLE IF EXISTS ${t}__cleared_backup`);
      await q(`CREATE TABLE ${t}__cleared_backup AS TABLE ${t}`);
      counts[t] = (await q(`SELECT count(*)::int AS c FROM ${t}__cleared_backup`)).rows[0].c;
    }
    // 2. Clear the live tables (children first, orders last — FK-safe).
    for (const t of CLEARABLE_TABLES) await q(`DELETE FROM ${t}`);
    // 3. Re-log the reset so the fresh audit trail records who did it + when.
    await q(`INSERT INTO activity_log (id, order_id, user_id, action, details, old_value, new_value, ip_address)
             VALUES ($1, NULL, $2, 'data_cleared', $3, NULL, NULL, $4)`,
      [uuidv4(), req.user.id, `Reset order board (${counts.orders} orders saved to recovery copy)`, req.ip || null]);
  });
  res.json({ message: 'Order board reset. A recovery copy was saved.', counts, recoverable: true });
}));

module.exports = router;

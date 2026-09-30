// src/routes/settings.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const { authenticate } = require('../middleware/auth');
const { requireCap } = require('../lib/capabilities');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/settings — all settings as a key→value object
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const rows = (await query('SELECT key, value FROM system_settings')).rows;
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
}));

// Settings changes used to leave no trace beyond system_settings.updated_by, so
// answering "who paused order intake, and when" needed someone with database access.
// That question came up for real on 2026-09-30. It belongs in the Audit Trail like
// every other action, so it is written there now.
//
// Values are recorded because the value is usually the point — order tracking off, a
// session timeout of 1 hour. The shared login password is the exception and is masked:
// the Audit Trail is readable by the Admin role, and a password in it would be a
// password in a list a lot of people can open.
const SECRET_SETTINGS = new Set(['login_password']);

async function logSettings(req, action, details) {
  try {
    await query(
      'INSERT INTO activity_log (id, user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [uuidv4(), req.user.id, action, String(details).slice(0, 2000), req.ip || null]
    );
  } catch (err) {
    // A settings change that saved must not fail because its log line did not.
    console.error('[settings] could not write %s to the audit trail: %s', action, err.message);
  }
}

// PUT /api/settings — upsert a batch of settings (admin)
router.put('/', authenticate, requireCap('settings.write'), asyncHandler(async (req, res) => {
  const settings = req.body.settings || {};
  const changed = [];
  for (const [key, value] of Object.entries(settings)) {
    const next = value == null ? '' : String(value);
    const before = (await query('SELECT value FROM system_settings WHERE key = $1', [key])).rows[0];
    await query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, next, req.user.id]
    );
    // Only record what actually moved — saving a form without touching it should not
    // fill the trail with lines saying nothing changed.
    if (!before || before.value !== next) {
      changed.push(SECRET_SETTINGS.has(key)
        ? `${key} changed`
        : `${key}: ${before ? before.value || '(empty)' : '(unset)'} → ${next || '(empty)'}`);
    }
  }
  if (changed.length) await logSettings(req, 'settings_changed', changed.join('; '));
  res.json({ message: 'Settings saved' });
}));

// ─── Holiday calendar ───
// GET /api/settings/holidays
router.get('/holidays', authenticate, asyncHandler(async (req, res) => {
  res.json((await query('SELECT * FROM holidays ORDER BY date')).rows);
}));

// POST /api/settings/holidays (admin)
router.post('/holidays', authenticate, requireCap('settings.write'), asyncHandler(async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'date and name are required' });
  const id = uuidv4();
  await query('INSERT INTO holidays (id, date, name) VALUES ($1, $2, $3)', [id, date, name]);
  await logSettings(req, 'holiday_added', `Added ${date} — ${name}`);
  res.status(201).json({ id, date, name });
}));

// DELETE /api/settings/holidays/:id (admin)
router.delete('/holidays/:id', authenticate, requireCap('settings.write'), asyncHandler(async (req, res) => {
  // Read it before it goes, so the log says which day was removed rather than an id
  // that no longer resolves to anything.
  const gone = (await query('SELECT date, name FROM holidays WHERE id = $1', [req.params.id])).rows[0];
  await query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  if (gone) await logSettings(req, 'holiday_removed', `Removed ${gone.date} — ${gone.name}`);
  res.json({ message: 'Holiday removed' });
}));

// POST /api/settings/holidays/bulk (admin) — import many at once from a CSV/Excel
// upload (parsed client-side to {date,name}). Skips dates that already exist, so
// re-importing the same file is safe.
router.post('/holidays/bulk', authenticate, requireCap('settings.write'), asyncHandler(async (req, res) => {
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
  if (inserted > 0) await logSettings(req, 'holidays_imported', `Imported ${inserted} holiday${inserted === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}`);
  res.json({ inserted, skipped });
}));

module.exports = router;

// src/routes/settings.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
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
router.put('/', authenticate, authorize('super_admin'), asyncHandler(async (req, res) => {
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
router.post('/holidays', authenticate, authorize('super_admin'), asyncHandler(async (req, res) => {
  const { date, name } = req.body;
  if (!date || !name) return res.status(400).json({ error: 'date and name are required' });
  const id = uuidv4();
  await query('INSERT INTO holidays (id, date, name) VALUES ($1, $2, $3)', [id, date, name]);
  res.status(201).json({ id, date, name });
}));

// DELETE /api/settings/holidays/:id (admin)
router.delete('/holidays/:id', authenticate, authorize('super_admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  res.json({ message: 'Holiday removed' });
}));

module.exports = router;

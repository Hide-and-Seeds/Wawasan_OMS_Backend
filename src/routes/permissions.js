// src/routes/permissions.js
//
// The owners' access panel. Reads the capability registry and the current matrix,
// and saves changes to it.
//
// Both routes are hardcoded to super_admin and are NOT themselves a capability. That
// is deliberate: if "edit permissions" were editable, an owner could hand it to a role
// by accident and that role could then grant itself everything. The Boss role is the
// anchor the rest of the model hangs off, so it stays out of reach of the panel.

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../utils/db');
const { authenticate, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const {
  OWNER_ROLE,
  EDITABLE_ROLES,
  ROLE_LABELS,
  CAPABILITIES,
  ensurePermissionsTable,
  readOverrides,
  invalidate,
  resolve,
} = require('../lib/capabilities');

const ownerOnly = [authenticate, authorize(OWNER_ROLE)];

// GET /api/permissions — everything the panel needs to draw itself.
router.get('/', ...ownerOnly, asyncHandler(async (req, res) => {
  const overrides = await readOverrides();
  const matrix = {};
  for (const role of EDITABLE_ROLES) matrix[role] = resolve(role, overrides);
  res.json({
    roles: EDITABLE_ROLES,
    roleLabels: ROLE_LABELS,
    ownerRole: OWNER_ROLE,
    // `roles` here is the shipped default, so the panel can show which switches have
    // been moved away from it and offer to put them back.
    capabilities: CAPABILITIES.map((c) => ({
      id: c.id, group: c.group, label: c.label, help: c.help || '', defaults: c.roles,
    })),
    matrix,
    overrides,
  });
}));

// PUT /api/permissions — save a batch of changes.
// Body: { changes: { "<role>": { "<capability>": true | false | null } } }
// null removes the override and puts that switch back to the shipped default.
router.put('/', ...ownerOnly, asyncHandler(async (req, res) => {
  const changes = (req.body && req.body.changes) || {};
  const known = new Set(CAPABILITIES.map((c) => c.id));
  const writes = [];

  for (const [role, caps] of Object.entries(changes)) {
    // The Boss is not editable, and an unknown role name would write a row that
    // nothing ever reads — reject both rather than storing junk.
    if (!EDITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `Cannot change permissions for "${role}"` });
    }
    for (const [cap, value] of Object.entries(caps || {})) {
      if (!known.has(cap)) {
        return res.status(400).json({ error: `Unknown capability "${cap}"` });
      }
      if (value !== null && typeof value !== 'boolean') {
        return res.status(400).json({ error: `"${cap}" must be true, false or null` });
      }
      writes.push([role, cap, value]);
    }
  }
  if (writes.length === 0) return res.status(400).json({ error: 'Nothing to change' });

  await ensurePermissionsTable();
  for (const [role, cap, value] of writes) {
    if (value === null) {
      await query('DELETE FROM role_permissions WHERE role = $1 AND capability = $2', [role, cap]);
    } else {
      await query(
        `INSERT INTO role_permissions (role, capability, allowed, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (role, capability) DO UPDATE
           SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [role, cap, value, req.user.id]
      );
    }
  }
  invalidate();

  // Who may do what is exactly the kind of change the Audit Trail exists for.
  const summary = writes
    .map(([role, cap, value]) => `${ROLE_LABELS[role] || role}: ${cap} → ${value === null ? 'default' : value ? 'on' : 'off'}`)
    .join('; ');
  await query(
    `INSERT INTO activity_log (id, user_id, action, details, ip_address)
     VALUES ($1, $2, 'permissions_changed', $3, $4)`,
    [uuidv4(), req.user.id, summary.slice(0, 2000), req.ip || null]
  );

  const overrides = await readOverrides();
  const matrix = {};
  for (const role of EDITABLE_ROLES) matrix[role] = resolve(role, overrides);
  res.json({ message: 'Permissions saved', changed: writes.length, matrix, overrides });
}));

module.exports = router;

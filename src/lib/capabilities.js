// src/lib/capabilities.js
//
// Role → capability permissions, editable by the owners without a redeploy.
//
// Until now every rule lived in a hardcoded role list: 32 authorize() guards, 33
// inline req.user.role checks and a NAV table in the frontend. Changing who could
// see what meant editing both repos and deploying. The owners asked to manage it
// themselves, so each of those rules now has a NAME, and the name is what the code
// checks.
//
// Two things keep this safe:
//
//   * Defaults live here in code and mirror exactly what the hardcoded lists allowed
//     on 2026-09-23. The table stores only DEVIATIONS from these defaults, so a
//     capability added in a later release gets its intended default automatically
//     instead of being silently denied by a stale stored matrix.
//
//   * super_admin (the Boss) always has everything and cannot be edited. That is what
//     makes it impossible to lock every owner out of the panel that grants access.
//
// A capability is only listed here if the server actually enforces it. A toggle that
// only hides a menu is not access control, and showing one would be a lie.

const { query } = require('../utils/db');

const OWNER_ROLE = 'super_admin';

// Every role that can be edited in the panel, in the order it should be shown.
const EDITABLE_ROLES = [
  'admin',
  'production_lead',
  'production_staff',
  'packing_staff',
  'delivery_team',
];

const ROLE_LABELS = {
  super_admin: 'Boss',
  admin: 'Admin',
  production_lead: 'Production Head',
  production_staff: 'Production Department',
  packing_staff: 'Packing Department',
  delivery_team: 'Delivery Department',
};

// `roles` on each entry is the DEFAULT — what the hardcoded guard allowed before this
// existed. super_admin is implied everywhere and deliberately left out of the lists.
const CAPABILITIES = [
  // ── Sections: which parts of the app a role can open ──────────────────────
  {
    id: 'page.board', group: 'Sections', label: 'Order Board',
    help: 'The kanban board of live orders.',
    roles: ['admin', 'production_lead', 'production_staff', 'packing_staff'],
  },
  {
    id: 'page.import', group: 'Sections', label: 'Import Invoices',
    help: 'The SQL Account CSV import page.',
    roles: [],
  },
  {
    id: 'page.dashboard', group: 'Sections', label: 'Dashboard',
    help: 'Operations overview. Lists customer names.',
    roles: ['admin'],
  },
  {
    id: 'page.delivery', group: 'Sections', label: 'Delivery',
    help: 'The delivery workspace.',
    roles: ['admin', 'production_lead', 'delivery_team'],
  },
  {
    id: 'page.remarks', group: 'Sections', label: 'Production Remarks',
    help: 'Reading the weekly and monthly notes.',
    roles: ['admin', 'production_lead'],
  },
  {
    id: 'page.audit', group: 'Sections', label: 'Audit Trail',
    help: 'Every action in the system, logged.',
    roles: ['admin'],
  },
  {
    id: 'page.users', group: 'Sections', label: 'User Management',
    help: 'Seeing the staff list. Editing accounts is separate, below.',
    roles: ['admin'],
  },
  {
    id: 'page.settings', group: 'Sections', label: 'System Settings',
    help: 'Opening settings. Saving them is separate, below.',
    roles: ['admin'],
  },

  // ── Reports: split the way the server already splits them ─────────────────
  {
    id: 'report.production', group: 'Reports', label: 'Production & packing reports',
    help: 'Throughput, efficiency, staff and person-in-charge figures.',
    roles: ['admin', 'production_lead'],
  },
  {
    id: 'report.business', group: 'Reports', label: 'Business reports',
    help: 'Orders, mistakes and trend. These carry customer names.',
    roles: ['admin'],
  },
  {
    id: 'report.delivery', group: 'Reports', label: 'Delivery reports',
    help: 'Delivery performance and carrier breakdown.',
    roles: ['admin'],
  },

  // ── Orders: what a role may do to an order ────────────────────────────────
  {
    id: 'order.create', group: 'Orders', label: 'Create an order',
    help: 'Key an invoice in by hand.',
    roles: [],
  },
  {
    id: 'order.import', group: 'Orders', label: 'Import invoices from CSV',
    help: 'Turn a SQL Account export into orders.',
    roles: [],
  },
  {
    id: 'order.move_free', group: 'Orders', label: 'Move or cancel an order',
    help: 'Send an order to any stage, backwards included, or cancel it. Without this a role can still push its own stage forward when it is finished.',
    roles: ['admin'],
  },
  {
    id: 'order.route', group: 'Orders', label: 'Route an order',
    // Editing an order's own fields (customer, notes, dates) is a separate Boss/Admin
    // rule in PATCH /orders/:id that is deliberately not exposed here, so this help
    // text stays to what the switch actually controls.
    help: 'Set the person in charge, the urgent / on-hold / waiting-stock flags, and the order of cards on the board.',
    roles: ['admin', 'production_lead'],
  },
  {
    id: 'order.amend_line', group: 'Orders', label: 'Correct a line',
    help: 'Fix the quantity, STK code or unit on a line already on the board.',
    roles: ['admin'],
  },
  {
    id: 'order.edit_lines', group: 'Orders', label: 'Add or remove lines',
    help: 'Add a line to an order, remove one, or delete an attachment.',
    roles: [],
  },
  {
    id: 'item.mark', group: 'Orders', label: 'Tick item progress',
    help: 'Mark a line not started / making / done and count cartons. A department can only ever tick its own track.',
    roles: ['admin', 'production_lead', 'production_staff', 'packing_staff'],
  },

  // ── Delivery ──────────────────────────────────────────────────────────────
  {
    id: 'delivery.manage', group: 'Delivery', label: 'Schedule and confirm deliveries',
    help: 'Book a delivery, mark it delivered, reopen it, and manage the driver list.',
    roles: ['admin', 'delivery_team'],
  },

  // ── Remarks ───────────────────────────────────────────────────────────────
  {
    id: 'remarks.write', group: 'Remarks', label: 'Write the weekly remark',
    help: 'The shared weekly production note.',
    roles: ['admin', 'production_lead'],
  },
  {
    id: 'remarks.monthly', group: 'Remarks', label: 'Write the monthly summary',
    help: 'The month-end summary.',
    roles: [],
  },

  // ── Administration ────────────────────────────────────────────────────────
  {
    id: 'users.manage', group: 'Administration', label: 'Manage staff accounts',
    help: 'Create accounts, set passwords, change roles, disable accounts. A Boss account can still only be managed by another Boss.',
    roles: ['admin'],
  },
  {
    id: 'settings.write', group: 'Administration', label: 'Change system settings',
    help: 'Save settings and edit the holiday calendar.',
    roles: ['admin'],
  },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

let _tableReady = false;
async function ensurePermissionsTable() {
  if (_tableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role       text NOT NULL,
      capability text NOT NULL,
      allowed    boolean NOT NULL,
      updated_by uuid REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (role, capability)
    )
  `);
  _tableReady = true;
}

// Overrides change about once a quarter and are read on every request, so they are
// cached. The TTL is what carries a change across to other serverless instances, which
// never see our local invalidation — 15s is slow enough to be free and fast enough that
// nobody notices saving a toggle.
const CACHE_TTL_MS = 15000;
let _cache = null;
let _cacheAt = 0;

async function readOverrides() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;
  try {
    await ensurePermissionsTable();
    const rows = (await query('SELECT role, capability, allowed FROM role_permissions')).rows;
    const out = {};
    for (const r of rows) {
      if (!BY_ID.has(r.capability)) continue; // a capability retired in a later release
      (out[r.role] || (out[r.role] = {}))[r.capability] = r.allowed;
    }
    _cache = out;
    _cacheAt = now;
    return out;
  } catch (err) {
    // Every authenticated request resolves capabilities, and /auth/me does it at sign-in.
    // If this table is unreadable — it has not been created yet, the role lacks DDL
    // rights, the database blinked — throwing here would lock the whole company out of
    // an app that was working a second ago. Fall back to the shipped defaults instead:
    // the floor keeps working, and the only thing lost is any customisation, which the
    // next successful read picks straight back up. Not cached, so it retries.
    console.error('[capabilities] falling back to defaults:', err.message);
    return {};
  }
}

function invalidate() {
  _cache = null;
  _cacheAt = 0;
}

// What a role can do right now: the code default, with any stored override applied.
// The Boss is not resolvable — they have everything, always.
function resolve(role, overrides) {
  const out = {};
  const mine = (overrides && overrides[role]) || {};
  for (const cap of CAPABILITIES) {
    out[cap.id] = role === OWNER_ROLE
      ? true
      : (typeof mine[cap.id] === 'boolean' ? mine[cap.id] : cap.roles.includes(role));
  }
  return out;
}

async function capsFor(role) {
  return resolve(role, await readOverrides());
}

async function can(role, capabilityId) {
  if (role === OWNER_ROLE) return true;
  const cap = BY_ID.get(capabilityId);
  if (!cap) return false; // unknown name: deny rather than wave it through
  const overrides = await readOverrides();
  const mine = overrides[role] || {};
  return typeof mine[capabilityId] === 'boolean' ? mine[capabilityId] : cap.roles.includes(role);
}

// Route guard. Replaces authorize(...roles) at every site the panel governs.
function requireCap(capabilityId) {
  return (req, res, next) => {
    can(req.user.role, capabilityId)
      .then((ok) => {
        if (ok) return next();
        res.status(403).json({ error: 'Insufficient permissions' });
      })
      .catch(next);
  };
}

// Same check inside a handler that already has other work to do.
async function assertCap(req, res, capabilityId) {
  if (await can(req.user.role, capabilityId)) return true;
  res.status(403).json({ error: 'Insufficient permissions' });
  return false;
}

module.exports = {
  OWNER_ROLE,
  EDITABLE_ROLES,
  ROLE_LABELS,
  CAPABILITIES,
  ensurePermissionsTable,
  readOverrides,
  invalidate,
  resolve,
  capsFor,
  can,
  requireCap,
  assertCap,
};

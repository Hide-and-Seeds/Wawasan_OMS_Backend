// src/utils/migrate.js
// Run with: node src/utils/migrate.js

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/wawasan_oms.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
-- ─────────────────────────────────────────
-- USERS & AUTH
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password     TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN (
    'super_admin','operations_controller','production_lead',
    'production_staff','packing_staff','delivery_team'
  )),
  avatar_color TEXT DEFAULT '#3B82F6',
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT PRIMARY KEY,
  invoice_number      TEXT UNIQUE NOT NULL,
  customer_name       TEXT NOT NULL,
  customer_contact    TEXT,
  order_date          TEXT NOT NULL,
  required_delivery_date TEXT NOT NULL,
  expiry_date         TEXT,
  stage               TEXT NOT NULL DEFAULT 'order' CHECK(stage IN (
    'order','production','packing','ready_for_delivery','delivered','cancelled','on_hold'
  )),
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','urgent')),
  skip_production     INTEGER DEFAULT 0,
  pic_id              TEXT REFERENCES users(id),
  notes               TEXT,
  source              TEXT DEFAULT 'manual' CHECK(source IN ('sql_account','manual')),
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL,
  name       TEXT NOT NULL,
  quantity   REAL NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'pcs',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_attachments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size        INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- ACTIVITY & AUDIT
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  order_id   TEXT REFERENCES orders(id) ON DELETE SET NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  action     TEXT NOT NULL,
  details    TEXT,
  old_value  TEXT,
  new_value  TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- STAGE TRANSITIONS (for timing reports)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stage_transitions (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_stage   TEXT,
  to_stage     TEXT NOT NULL,
  transitioned_by TEXT NOT NULL REFERENCES users(id),
  reason       TEXT,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- PRODUCTION REMARKS (Misha-specific)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_remarks (
  id         TEXT PRIMARY KEY,
  author_id  TEXT NOT NULL REFERENCES users(id),
  week_start TEXT NOT NULL,
  week_end   TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK(type IN (
    'order_stage_entered','pic_assigned','urgent_flag',
    'order_overdue','weekly_remark','rework_returned'
  )),
  title      TEXT NOT NULL,
  message    TEXT,
  order_id   TEXT REFERENCES orders(id) ON DELETE SET NULL,
  is_read    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- DELIVERY
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  delivery_man_id TEXT REFERENCES users(id),
  scheduled_date  TEXT,
  delivered_at    TEXT,
  signature_file  TEXT,
  status          TEXT DEFAULT 'pending' CHECK(status IN (
    'pending','in_transit','delivered','failed'
  )),
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- SYSTEM SETTINGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id    TEXT PRIMARY KEY,
  date  TEXT NOT NULL,
  name  TEXT NOT NULL
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(stage);
CREATE INDEX IF NOT EXISTS idx_orders_invoice ON orders(invoice_number);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_date ON orders(required_delivery_date);
CREATE INDEX IF NOT EXISTS idx_activity_order ON activity_log(order_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_stage_transitions_order ON stage_transitions(order_id);
`;

db.exec(schema);
console.log('✅ Database schema applied successfully.');
db.close();

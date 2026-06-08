-- ============================================================
-- Wawasan Candle OMS — Postgres schema (Supabase)
-- ------------------------------------------------------------
-- Run this once in the Supabase SQL Editor (or via `npm run migrate`).
-- Converted from the original SQLite schema:
--   * TEXT ids            -> uuid (default gen_random_uuid())
--   * INTEGER 0/1 flags   -> boolean
--   * datetime('now')     -> timestamptz default now()
--   * date columns        -> date
-- ============================================================

-- gen_random_uuid() lives in pgcrypto (already available on Supabase).
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────
-- USERS & AUTH
-- ─────────────────────────────────────────
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text unique not null,
  password     text not null,
  role         text not null check (role in (
    'super_admin','admin','operations_controller','production_lead',
    'production_staff','packing_staff','delivery_team'
  )),
  avatar_color text default '#3B82F6',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists password_reset_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token      text not null,
  expires_at timestamptz not null,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- ORDERS
-- ─────────────────────────────────────────
create table if not exists orders (
  id                     uuid primary key default gen_random_uuid(),
  invoice_number         text unique not null,
  customer_name          text not null,
  customer_contact       text,
  order_date             date not null,
  required_delivery_date date not null,
  expiry_date            date,
  stage                  text not null default 'order' check (stage in (
    'order','production','packing','ready_for_delivery','delivered','cancelled','on_hold'
  )),
  priority               text not null default 'normal' check (priority in ('normal','urgent')),
  importance             text not null default 'standard' check (importance in ('standard','priority','vip')),
  skip_production        boolean not null default false,
  pic_id                 uuid references users(id),
  notes                  text,
  on_hold                boolean not null default false,
  waiting_stock          boolean not null default false,
  hold_reason            text,
  source                 text not null default 'manual' check (source in ('sql_account','manual')),
  created_by             uuid not null references users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders(id) on delete cascade,
  sku        text not null,
  name       text not null,
  quantity   numeric not null,
  unit       text not null default 'pcs',
  made       boolean not null default false,
  made_at    timestamptz,
  made_by    uuid references users(id),
  made_qty   integer not null default 0,
  status     text not null default 'not_started' check (status in ('not_started','in_progress','done')),
  created_at timestamptz not null default now()
);

create table if not exists order_attachments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  filename      text not null,          -- storage object path in the Supabase bucket
  original_name text not null,
  mime_type     text not null,
  size          integer not null,
  uploaded_by   uuid not null references users(id),
  uploaded_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- ACTIVITY & AUDIT
-- ─────────────────────────────────────────
create table if not exists activity_log (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid references orders(id) on delete set null,
  user_id    uuid not null references users(id),
  action     text not null,
  details    text,
  old_value  text,
  new_value  text,
  ip_address text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- STAGE TRANSITIONS (for timing reports)
-- ─────────────────────────────────────────
create table if not exists stage_transitions (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  from_stage      text,
  to_stage        text not null,
  transitioned_by uuid not null references users(id),
  reason          text,
  created_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- PRODUCTION REMARKS (Misha-specific)
-- ─────────────────────────────────────────
create table if not exists production_remarks (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references users(id),
  week_start date not null,
  week_end   date not null,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null check (type in (
    'order_stage_entered','pic_assigned','urgent_flag',
    'order_overdue','weekly_remark','rework_returned'
  )),
  title      text not null,
  message    text,
  order_id   uuid references orders(id) on delete set null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- DELIVERY
-- ─────────────────────────────────────────
create table if not exists deliverers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists deliveries (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references orders(id) on delete cascade,
  delivery_man_id uuid references users(id),
  deliverer_id    uuid references deliverers(id),
  scheduled_date  date,
  address         text,
  delivered_at    timestamptz,
  signature_file  text,                 -- storage object path in the Supabase bucket
  status          text not null default 'pending' check (status in (
    'pending','in_transit','delivered','failed'
  )),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────
-- SYSTEM SETTINGS
-- ─────────────────────────────────────────
create table if not exists system_settings (
  key        text primary key,
  value      text not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

create table if not exists holidays (
  id   uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────
create index if not exists idx_orders_stage          on orders(stage);
create index if not exists idx_orders_invoice         on orders(invoice_number);
create index if not exists idx_orders_delivery_date   on orders(required_delivery_date);
create index if not exists idx_activity_order         on activity_log(order_id);
create index if not exists idx_activity_user          on activity_log(user_id);
create index if not exists idx_notifications_user     on notifications(user_id, is_read);
create index if not exists idx_stage_transitions_order on stage_transitions(order_id);

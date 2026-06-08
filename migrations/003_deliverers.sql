-- Migration 003 — no-login deliverers + link from deliveries.
-- Run in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS deliverers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS deliverer_id uuid REFERENCES deliverers(id);

-- Optional: migrate existing delivery_team *driver* users into the deliverers list
-- (skip the dedicated coordinator account). Review names before running.
-- INSERT INTO deliverers (name)
--   SELECT name FROM users
--   WHERE role = 'delivery_team' AND name <> 'Delivery Coordinator'
--   AND NOT EXISTS (SELECT 1 FROM deliverers d WHERE d.name = users.name);

-- Migration 001 — add the system-only 'admin' role.
-- Run in the Supabase SQL editor (or via `npm run migrate` after the schema.sql update).
-- Postgres auto-names the inline CHECK 'users_role_check'; drop and re-add it with 'admin'.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'super_admin','admin','operations_controller','production_lead',
  'production_staff','packing_staff','delivery_team'
));

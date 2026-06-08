-- Migration 002 — items tracked by status (not_started/in_progress/done), replacing made_qty.
-- Run in the Supabase SQL editor. Safe to re-run.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'not_started';

-- Backfill from the legacy made / made_qty fields.
UPDATE order_items SET status = CASE
  WHEN made THEN 'done'
  WHEN made_qty > 0 THEN 'in_progress'
  ELSE 'not_started'
END
WHERE status = 'not_started';

-- Enforce the allowed values.
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('not_started','in_progress','done'));

-- made_qty column is left in place but no longer written by the app.

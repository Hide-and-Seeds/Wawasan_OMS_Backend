-- Migration 009 — per-line carton progress for the floor display.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- `made_qty` already exists: it predates migration 002, which replaced counting with a
-- 3-state status and stopped writing it. The status model stays exactly as it is — this
-- adds the packing-side counter that never existed, so both tracks can carry "X of Y
-- cartons done" alongside their status.
--
-- Both counters are optional. A line whose qty is 0 but whose status is 'done' reads as
-- fully complete, so orders worked with the existing three buttons are unaffected.

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pack_qty integer NOT NULL DEFAULT 0;

-- Backfill: a line already finished has all of its cartons done.
UPDATE order_items SET made_qty = ROUND(quantity)::int
  WHERE made_qty = 0 AND (made = true OR status = 'done');
UPDATE order_items SET pack_qty = ROUND(quantity)::int
  WHERE pack_qty = 0 AND (pack_made = true OR pack_status = 'done');

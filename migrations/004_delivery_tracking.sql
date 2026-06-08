-- Migration 004 — per-delivery courier tracking number.
-- Run in the Supabase SQL editor. Safe to re-run.

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS tracking_no text;

-- Migration 010 — order archive, for clearing the board without losing anything.
--
-- YOU DO NOT NEED TO RUN THIS. ensureOrderArchive() in src/routes/orders.js creates
-- the same tables on the first call to /orders/purge/preview, the way the other
-- self-migrations in this codebase work. It is written out here so the shape is
-- reviewable, and so the restore query at the bottom lives somewhere findable.
--
-- Orders are never hard-deleted (see the note at the foot of routes/orders.js and the
-- 2026-06-10 cleanup that removed DELETE /:id). "Clearing the board" copies every row
-- into the mirror below and then removes it from the live table. One press of the
-- button is one purge_id, so a batch can be identified and put back.

CREATE TABLE IF NOT EXISTS orders_archive            (LIKE orders);
CREATE TABLE IF NOT EXISTS order_items_archive       (LIKE order_items);
CREATE TABLE IF NOT EXISTS order_attachments_archive (LIKE order_attachments);
CREATE TABLE IF NOT EXISTS stage_transitions_archive (LIKE stage_transitions);
CREATE TABLE IF NOT EXISTS deliveries_archive        (LIKE deliveries);

-- LIKE copies the columns but not the keys. That is on purpose: the archive must
-- accept an invoice number that gets reused years later, and must not hold a foreign
-- key back into a row that has since gone.

ALTER TABLE orders_archive            ADD COLUMN IF NOT EXISTS purge_id uuid;
ALTER TABLE order_items_archive       ADD COLUMN IF NOT EXISTS purge_id uuid;
ALTER TABLE order_attachments_archive ADD COLUMN IF NOT EXISTS purge_id uuid;
ALTER TABLE stage_transitions_archive ADD COLUMN IF NOT EXISTS purge_id uuid;
ALTER TABLE deliveries_archive        ADD COLUMN IF NOT EXISTS purge_id uuid;

ALTER TABLE orders_archive            ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE order_items_archive       ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE order_attachments_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE stage_transitions_archive ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE deliveries_archive        ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE orders_archive ADD COLUMN IF NOT EXISTS archived_by uuid;

CREATE INDEX IF NOT EXISTS orders_archive_purge_idx      ON orders_archive (purge_id);
CREATE INDEX IF NOT EXISTS order_items_archive_purge_idx ON order_items_archive (purge_id);
CREATE INDEX IF NOT EXISTS orders_archive_invoice_idx    ON orders_archive (invoice_number);


-- ─────────────────────────────────────────────────────────────────────────────
-- What was archived, and when
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT purge_id, archived_at, COUNT(*) AS orders
-- FROM orders_archive
-- GROUP BY purge_id, archived_at
-- ORDER BY archived_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- Putting a batch back
-- ─────────────────────────────────────────────────────────────────────────────
-- Fill in the purge_id from the query above. Parents before children, so the foreign
-- keys on the live tables are satisfied as each insert lands. The extra archive-only
-- columns are excluded by naming them out rather than using SELECT *.
--
-- Two things to check first:
--   * An invoice number that has been keyed in again since the archive will collide
--     with the live UNIQUE constraint. The first SELECT below lists any such clash --
--     resolve those before restoring.
--   * Restoring does not remove the archived copy. Delete the batch afterwards if you
--     do not want it listed twice.
--
-- BEGIN;
--
-- -- clashes, if any:
-- SELECT a.invoice_number FROM orders_archive a
-- JOIN orders o ON o.invoice_number = a.invoice_number
-- WHERE a.purge_id = '<purge_id>';
--
-- INSERT INTO orders SELECT <column list> FROM orders_archive WHERE purge_id = '<purge_id>';
-- INSERT INTO order_items SELECT <column list> FROM order_items_archive WHERE purge_id = '<purge_id>';
-- INSERT INTO stage_transitions SELECT <column list> FROM stage_transitions_archive WHERE purge_id = '<purge_id>';
-- INSERT INTO deliveries SELECT <column list> FROM deliveries_archive WHERE purge_id = '<purge_id>';
-- INSERT INTO order_attachments SELECT <column list> FROM order_attachments_archive WHERE purge_id = '<purge_id>';
--
-- COMMIT;
--
-- To generate the column list for a table without typing it out:
--   SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
--   FROM pg_attribute
--   WHERE attrelid = 'orders'::regclass AND attnum > 0 AND NOT attisdropped;


-- ─────────────────────────────────────────────────────────────────────────────
-- Not covered
-- ─────────────────────────────────────────────────────────────────────────────
-- * Files in Supabase Storage. order_attachments_archive keeps the filename, so the
--   objects can still be found and re-linked, but clearing the board does not delete
--   or move anything in the bucket.
-- * Notifications. Bell entries tied to an order are deleted outright rather than
--   archived -- they are transient UI, and keeping ones that point at an order nobody
--   can open is worse than losing them.
-- * activity_log. Deliberately untouched. Its order_id becomes NULL by the existing
--   foreign key and the record of who did what survives the clear.

-- 008_drop_message_queue.sql
-- WhatsApp feature removed entirely (routes/lib/worker/crons/env all deleted).
-- The message_queue table + its indexes are no longer used by anything.
-- Run this once in the Supabase SQL editor to drop it.
--
-- NOTE: whatsapp.js used to lazily re-create this table via CREATE TABLE IF NOT
-- EXISTS on boot. That code is gone, so nothing will recreate it after this drop.

drop index if exists uq_mq_order_kind;
drop index if exists idx_mq_status;
drop table if exists message_queue;

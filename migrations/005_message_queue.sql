-- 005_message_queue.sql
-- Outbound WhatsApp / morning-brief message queue. Additive; safe to re-run.
-- (The app also self-migrates this table on first use — see src/routes/whatsapp.js.)

create table if not exists message_queue (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null default 'whatsapp',
  recipient  text not null,
  body       text not null,
  order_id   uuid references orders(id) on delete set null,
  kind       text not null,
  status     text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts   int  not null default 0,
  provider   text,
  error      text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create unique index if not exists uq_mq_order_kind on message_queue(order_id, kind);
create index if not exists idx_mq_status on message_queue(status, created_at);

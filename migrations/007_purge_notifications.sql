-- Migration 007 — monthly: delete notifications older than 30 days.
-- Notifications are transient in-app alerts (the bell / unread count). They have no
-- audit or retention value, so unlike activity_log (migration 006) they are HARD
-- deleted, not archived. Without this they grow unbounded.
--
-- Requires the pg_cron extension (already enabled by migration 006).
-- Safe to re-run: the existing schedule is dropped and recreated.

create extension if not exists pg_cron;

-- Drop any previous copy of this job, then (re)create it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-notifications') then
    perform cron.unschedule('purge-notifications');
  end if;
end $$;

select cron.schedule(
  'purge-notifications',
  '0 3 1 * *',  -- 03:00 on the 1st of every month
  $$ delete from notifications where created_at < now() - interval '30 days' $$
);

-- Verify:  select * from cron.job where jobname = 'purge-notifications';
-- Stop it: select cron.unschedule('purge-notifications');

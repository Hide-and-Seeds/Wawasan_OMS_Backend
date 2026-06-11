-- Migration 006 — auto-purge the activity log monthly (keep ~1 month of history).
-- The audit trail (activity_log) is trimmed on the 1st of each month: rows older
-- than one month are deleted.
--
-- stage_transitions is intentionally NOT touched — the timing / performance reports
-- read it, so it must be retained. Only activity_log (the Audit Trail screen) is cut.
--
-- Requires the pg_cron extension. On Supabase, enable it once (Dashboard → Database →
-- Extensions → pg_cron, or the CREATE EXTENSION below), then schedule the job.
-- Safe to re-run: the existing schedule is dropped and recreated.

create extension if not exists pg_cron;

-- Drop any previous copy of this job, then (re)create it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-activity-log') then
    perform cron.unschedule('purge-activity-log');
  end if;
end $$;

select cron.schedule(
  'purge-activity-log',
  '0 3 1 * *',  -- 03:00 on the 1st of every month
  $$ delete from activity_log where created_at < now() - interval '1 month' $$
);

-- To verify after running:   select * from cron.job where jobname = 'purge-activity-log';
-- To stop it later:          select cron.unschedule('purge-activity-log');

-- Migration 006 — monthly: ARCHIVE the audit log, then trim it to ~1 month.
-- On the 1st of each month, rows in activity_log older than one month are MOVED
-- into activity_log_archive (kept forever) and removed from the live activity_log.
-- So the Audit Trail screen stays light (~1 month) but nothing is ever lost.
--
-- stage_transitions is intentionally NOT touched — the timing / performance reports
-- read it. Only activity_log (the Audit Trail screen) is trimmed.
--
-- Requires the pg_cron extension. On Supabase, enable it once (Dashboard → Database →
-- Extensions → pg_cron, or the CREATE EXTENSION below), then schedule the job.
-- Safe to re-run: the existing schedule is dropped and recreated.

create extension if not exists pg_cron;

-- Keep a full copy of every trimmed row here (columns + defaults, but NO constraints
-- so it never blocks on a deleted user/order it references).
create table if not exists activity_log_archive (like activity_log including defaults);

-- Drop any previous copy of this job, then (re)create it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-activity-log') then
    perform cron.unschedule('purge-activity-log');
  end if;
end $$;

-- Move (not just delete) >1-month-old rows into the archive, atomically.
select cron.schedule(
  'purge-activity-log',
  '0 3 1 * *',  -- 03:00 on the 1st of every month
  $$ with moved as (
       delete from activity_log where created_at < now() - interval '1 month' returning *
     )
     insert into activity_log_archive select * from moved $$
);

-- Verify:   select * from cron.job where jobname = 'purge-activity-log';
-- Archive:  select count(*) from activity_log_archive;
-- Stop it:  select cron.unschedule('purge-activity-log');

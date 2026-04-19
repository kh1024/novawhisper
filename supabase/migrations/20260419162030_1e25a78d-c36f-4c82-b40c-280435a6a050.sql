-- Enable pg_cron + pg_net so we can call edge functions on a schedule.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Drop any prior version so this migration is idempotent across redeploys.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'perf-evaluate-nightly') THEN
    PERFORM cron.unschedule('perf-evaluate-nightly');
  END IF;
END $$;

-- Schedule perf-evaluate every weekday at 01:00 UTC (≈ 9pm EST / 8pm EDT).
-- This populates pick_outcomes for snapshots whose 1d/5d/20d windows have elapsed,
-- giving perf-learn real data to compute label multipliers from.
SELECT cron.schedule(
  'perf-evaluate-nightly',
  '0 1 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://yrsjhpkrxxcbwlnaegks.supabase.co/functions/v1/perf-evaluate',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlyc2pocGtyeHhjYndsbmFlZ2tzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzA0NjksImV4cCI6MjA5MjEwNjQ2OX0.5hQIXN1Pb7EHEhtZBBshKb6Zjp5GiOdiRwUgGbfrksQ'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
-- Ensure scheduling extensions exist (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Idempotent: drop any prior version of this job before re-creating.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'perf-learn-weekly') THEN
    PERFORM cron.unschedule('perf-learn-weekly');
  END IF;
END $$;

-- Run every Sunday at 10:00 UTC (≈ 6 AM EST / 5 AM EDT).
SELECT cron.schedule(
  'perf-learn-weekly',
  '0 10 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://yrsjhpkrxxcbwlnaegks.supabase.co/functions/v1/perf-learn',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlyc2pocGtyeHhjYndsbmFlZ2tzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzA0NjksImV4cCI6MjA5MjEwNjQ2OX0.5hQIXN1Pb7EHEhtZBBshKb6Zjp5GiOdiRwUgGbfrksQ'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
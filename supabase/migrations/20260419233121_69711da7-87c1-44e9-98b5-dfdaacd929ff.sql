-- Enable required extensions for scheduled HTTP calls (idempotent).
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Drop any prior version so reruns don't error.
do $$
begin
  perform cron.unschedule('political-posts-hourly');
exception when others then null;
end$$;

-- Schedule political-posts every hour at :00.
select cron.schedule(
  'political-posts-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://yrsjhpkrxxcbwlnaegks.supabase.co/functions/v1/political-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlyc2pocGtyeHhjYndsbmFlZ2tzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzA0NjksImV4cCI6MjA5MjEwNjQ2OX0.5hQIXN1Pb7EHEhtZBBshKb6Zjp5GiOdiRwUgGbfrksQ'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);
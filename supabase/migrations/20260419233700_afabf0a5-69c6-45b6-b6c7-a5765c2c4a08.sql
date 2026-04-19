create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$
begin
  perform cron.unschedule('massive-ping-hourly');
exception when others then null;
end$$;

select cron.schedule(
  'massive-ping-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://yrsjhpkrxxcbwlnaegks.supabase.co/functions/v1/massive-ping',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlyc2pocGtyeHhjYndsbmFlZ2tzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1MzA0NjksImV4cCI6MjA5MjEwNjQ2OX0.5hQIXN1Pb7EHEhtZBBshKb6Zjp5GiOdiRwUgGbfrksQ'
    ),
    body := jsonb_build_object('triggered_at', now())
  );
  $$
);
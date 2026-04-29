CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('sync-gmcap-rfid-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-gmcap-rfid-every-minute');

SELECT cron.schedule(
  'sync-gmcap-rfid-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hjhxyxwhgawxfrthxqva.supabase.co/functions/v1/sync-gmcap-rfid',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6ImhqaHh5eHdoZ2F3eGZydGh4cXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDgwNjYsImV4cCI6MjA5MTkyNDA2Nn0.0DnxYSaaJ8nAUOa2Sd6Uundpg5fjgKVlCK0hvrHvWZY","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI1NiIsInJlZiI6ImhqaHh5eHdoZ2F3eGZydGh4cXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDgwNjYsImV4cCI6MjA5MTkyNDA2Nn0.0DnxYSaaJ8nAUOa2Sd6Uundpg5fjgKVlCK0hvrHvWZY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

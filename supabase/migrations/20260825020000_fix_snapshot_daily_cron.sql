-- Corrige o pg_cron do snapshot diário: headers JSON inválidos faziam o job
-- falhar desde ~20/08 (Token "Content" is invalid — chaves sem aspas).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gc-dashboard-snapshot-daily') THEN
    PERFORM cron.unschedule('gc-dashboard-snapshot-daily');
  END IF;

  PERFORM cron.schedule(
    'gc-dashboard-snapshot-daily',
    '5 3 * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://cbqkoverzdzmhceztldv.supabase.co/functions/v1/snapshot-daily',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    );
    $cron$
  );
END $$;

-- Reativa pull incremental IAM Control → GC (cron 5 min).
-- Não aplicar automaticamente — só quando quiser retomar a sync.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'gc-iam-control-pull-incremental'
  ) THEN
    PERFORM cron.schedule(
      'gc-iam-control-pull-incremental',
      '*/5 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://cbqkoverzdzmhceztldv.supabase.co/functions/v1/iam-control-pull-clientes',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"max_paginas": 5}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;

-- Pull incremental automático IAM Control → GC (a cada 5 minutos).
-- Complementa o webhook iam-control-receive-aluno (push imediato na conciliação/pendência).

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

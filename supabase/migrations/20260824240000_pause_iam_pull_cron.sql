-- Pausa pull incremental IAM Control → GC (cron 5 min).
-- Para reativar: ver migration 20260824240100_resume_iam_pull_cron.sql

SELECT cron.unschedule('gc-iam-control-pull-incremental');

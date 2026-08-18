ALTER TABLE public.regua_mensagens
  ADD COLUMN IF NOT EXISTS criterio text NOT NULL DEFAULT 'no',
  ADD COLUMN IF NOT EXISTS dias integer NOT NULL DEFAULT 0;
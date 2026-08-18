ALTER TABLE public.conciliacao_items
  ADD COLUMN IF NOT EXISTS aprovado_at timestamptz,
  ADD COLUMN IF NOT EXISTS aprovado_por_id uuid,
  ADD COLUMN IF NOT EXISTS aprovado_por_nome text,
  ADD COLUMN IF NOT EXISTS aprovado_nota text;
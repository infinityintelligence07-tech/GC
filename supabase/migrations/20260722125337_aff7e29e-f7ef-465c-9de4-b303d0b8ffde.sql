ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS meta_reversao_1 numeric,
  ADD COLUMN IF NOT EXISTS meta_reversao_2 numeric,
  ADD COLUMN IF NOT EXISTS meta_reversao_3 numeric;
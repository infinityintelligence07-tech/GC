ALTER TABLE public.acs
  ADD COLUMN IF NOT EXISTS meta_1 numeric,
  ADD COLUMN IF NOT EXISTS meta_2 numeric,
  ADD COLUMN IF NOT EXISTS meta_3 numeric;
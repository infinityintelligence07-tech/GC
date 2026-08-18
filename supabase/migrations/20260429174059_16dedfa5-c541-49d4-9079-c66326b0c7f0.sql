ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS renda_extra_payment_date text,
  ADD COLUMN IF NOT EXISTS renda_extra_payment_method text;
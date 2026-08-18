ALTER TABLE public.cancellation_cases
ADD COLUMN IF NOT EXISTS cancellation_fine_value numeric,
ADD COLUMN IF NOT EXISTS cancellation_reviewed_installments jsonb;
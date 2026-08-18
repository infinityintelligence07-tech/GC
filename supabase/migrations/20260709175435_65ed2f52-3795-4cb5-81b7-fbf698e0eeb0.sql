
ALTER TABLE public.cancellation_cases
  ADD COLUMN IF NOT EXISTS dentro_7_dias boolean,
  ADD COLUMN IF NOT EXISTS com_30_dias_antecedencia boolean,
  ADD COLUMN IF NOT EXISTS data_evento text,
  ADD COLUMN IF NOT EXISTS multa_percent numeric,
  ADD COLUMN IF NOT EXISTS multa_value numeric,
  ADD COLUMN IF NOT EXISTS contract_pdf_url text,
  ADD COLUMN IF NOT EXISTS pagamento_tipo text,
  ADD COLUMN IF NOT EXISTS ligacao_agendada_at text,
  ADD COLUMN IF NOT EXISTS final_checklist jsonb;

ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS multa_cancelamento_com_antecedencia numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS multa_cancelamento_sem_antecedencia numeric NOT NULL DEFAULT 40;

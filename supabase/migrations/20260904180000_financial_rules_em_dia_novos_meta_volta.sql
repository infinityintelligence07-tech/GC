-- Fita "Em Dia + Novos · mês vigente" do Dashboard volta a ter meta em reais
-- por empresa (o lápis de editar meta retorna ao Dashboard). Reverte
-- 20260904101000_financial_rules_drop_em_dia_novos_meta.sql.
ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS em_dia_novos_meta numeric(14,2);

COMMENT ON COLUMN public.financial_rules.em_dia_novos_meta IS 'Meta (R$) do mês para Em Dia + Novos — traço da fita do Dashboard. NULL = padrão do app.';

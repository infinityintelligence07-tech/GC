-- Fita "Em Dia + Novos · mês vigente" passa a ter meta em reais.
--   em_dia_novos_meta : meta (R$) do mês — fim da escala da fita.
--   em_dia_novos_base : agora guarda o VALOR (R$) de Em Dia + Novos do mês no
--                       início do mês (antes era %), por isso amplia a precisão.
-- Obs.: a meta em financial_rules foi removida logo em seguida
-- (20260904101000_financial_rules_drop_em_dia_novos_meta.sql) — meta é só por assessor.

ALTER TABLE public.financial_rules
  ALTER COLUMN em_dia_novos_base TYPE numeric(14,2),
  ADD COLUMN IF NOT EXISTS em_dia_novos_meta numeric(14,2);

ALTER TABLE public.acs
  ALTER COLUMN em_dia_novos_base TYPE numeric(14,2),
  ADD COLUMN IF NOT EXISTS em_dia_novos_meta numeric(14,2);

COMMENT ON COLUMN public.financial_rules.em_dia_novos_base IS 'Valor (R$) de Em Dia + Novos com vencimento no mês, registrado no início do mês — marca da fita do Dashboard.';
COMMENT ON COLUMN public.financial_rules.em_dia_novos_meta IS 'Meta (R$) do mês para Em Dia + Novos — fim da fita do Dashboard. NULL = padrão do app.';
COMMENT ON COLUMN public.acs.em_dia_novos_base IS 'Valor (R$) de Em Dia + Novos com vencimento no mês, registrado no início do mês — marca da fita da carteira.';
COMMENT ON COLUMN public.acs.em_dia_novos_meta IS 'Meta (R$) do mês para Em Dia + Novos na carteira do assessor — fim da fita. NULL = padrão do app.';

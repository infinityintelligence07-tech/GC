-- Meta em R$ da fita é só por assessor (acs); no Dashboard geral não existe.
-- A fita do Dashboard segue em % de participação, e em_dia_novos_base volta a
-- guardar esse percentual.
ALTER TABLE public.financial_rules DROP COLUMN IF EXISTS em_dia_novos_meta;
COMMENT ON COLUMN public.financial_rules.em_dia_novos_base IS 'Participação (%) de Em Dia + Novos entre os alunos com vencimento no mês, registrada no início do mês — marca da fita do Dashboard.';

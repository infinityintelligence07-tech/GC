-- Marca do início do mês para a fita "Em Dia + Novos" da Carteira do Assessor.
-- Mesma semântica das colunas homônimas em financial_rules (Dashboard geral),
-- mas por assessor.

ALTER TABLE public.acs
  ADD COLUMN IF NOT EXISTS em_dia_novos_base     numeric(5,2),
  ADD COLUMN IF NOT EXISTS em_dia_novos_base_mes text;

COMMENT ON COLUMN public.acs.em_dia_novos_base     IS 'Participação (%) de Em Dia + Novos na carteira do assessor no início do mês — marca da fita.';
COMMENT ON COLUMN public.acs.em_dia_novos_base_mes IS 'Mês (YYYY-MM) a que em_dia_novos_base se refere; reset automático quando o mês vira.';

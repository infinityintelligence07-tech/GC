-- Marca do início do mês para a fita "Em Dia + Novos" do Dashboard.
-- em_dia_novos_base     : participação (%) de Em Dia + Novos na carteira registrada
--                         na primeira visualização do mês.
-- em_dia_novos_base_mes : mês (YYYY-MM, Brasília) da marca; mês diferente do
--                         atual faz o app refazer a marca (reset mensal).

ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS em_dia_novos_base     numeric(5,2),
  ADD COLUMN IF NOT EXISTS em_dia_novos_base_mes text;

COMMENT ON COLUMN public.financial_rules.em_dia_novos_base     IS 'Participação (%) de Em Dia + Novos na carteira no início do mês — marca da fita do Dashboard.';
COMMENT ON COLUMN public.financial_rules.em_dia_novos_base_mes IS 'Mês (YYYY-MM) a que em_dia_novos_base se refere; reset automático quando o mês vira.';

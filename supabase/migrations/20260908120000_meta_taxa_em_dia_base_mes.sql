-- Velocímetro de Taxa em Dia: ponto de partida passa a ser a Taxa em Dia do
-- início do mês, refixada automaticamente na virada (08/09/2026).
--
-- Antes a partida era gravada uma única vez (quando a meta era definida ou na
-- primeira visualização) e ficava congelada — na Dashboard IAM ficou em 47,2%
-- desde 03/09, igual à taxa atual, o que parecia um vínculo ao vivo.
--
-- meta_taxa_em_dia_base_mes (YYYY-MM, Brasília): mês a que a partida se
-- refere. Mês diferente do atual = o front refixa a partida na taxa do momento
-- e grava o novo mês.

ALTER TABLE public.acs
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_base_mes text;
COMMENT ON COLUMN public.acs.meta_taxa_em_dia_base IS
  'Taxa em Dia (%) no início do mês — ponto de partida da escala do velocímetro.';
COMMENT ON COLUMN public.acs.meta_taxa_em_dia_base_mes IS
  'Mês (YYYY-MM, Brasília) a que meta_taxa_em_dia_base se refere; mês diferente = refixar.';

ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_base_mes text;
COMMENT ON COLUMN public.financial_rules.meta_taxa_em_dia_base IS
  'Taxa em Dia (%) no início do mês — ponto de partida da escala do velocímetro.';
COMMENT ON COLUMN public.financial_rules.meta_taxa_em_dia_base_mes IS
  'Mês (YYYY-MM, Brasília) a que meta_taxa_em_dia_base se refere; mês diferente = refixar.';

-- Partidas já gravadas foram fixadas em setembro/2026 — valem para este mês.
UPDATE public.acs
   SET meta_taxa_em_dia_base_mes = to_char(COALESCE(meta_taxa_em_dia_em, now()) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')
 WHERE meta_taxa_em_dia_base IS NOT NULL AND meta_taxa_em_dia_base_mes IS NULL;

UPDATE public.financial_rules
   SET meta_taxa_em_dia_base_mes = to_char(COALESCE(meta_taxa_em_dia_em, now()) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')
 WHERE meta_taxa_em_dia_base IS NOT NULL AND meta_taxa_em_dia_base_mes IS NULL;

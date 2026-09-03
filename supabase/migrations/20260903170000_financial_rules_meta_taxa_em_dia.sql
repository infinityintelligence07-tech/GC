-- Meta mensal de Taxa em Dia da empresa (velocímetro do Dashboard geral).
-- Mesma semântica das colunas homônimas em acs: meta (topo), ponto de partida
-- (início da escala) e quando foi definida. Sem meta, o app usa meta_1.

ALTER TABLE public.financial_rules
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia      numeric(5,2),
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_base numeric(5,2),
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_em   timestamptz;

COMMENT ON COLUMN public.financial_rules.meta_taxa_em_dia      IS 'Meta mensal de Taxa em Dia (%) da empresa — topo do velocímetro do Dashboard.';
COMMENT ON COLUMN public.financial_rules.meta_taxa_em_dia_base IS 'Taxa em Dia (%) no momento em que a meta foi definida — início da escala.';
COMMENT ON COLUMN public.financial_rules.meta_taxa_em_dia_em   IS 'Quando a meta de Taxa em Dia foi definida.';

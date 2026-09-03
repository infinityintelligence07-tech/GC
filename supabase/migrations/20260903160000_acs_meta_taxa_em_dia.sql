-- Meta mensal de Taxa em Dia por assessor (velocímetro da Carteira do Assessor).
--
-- meta_taxa_em_dia      : meta (%) — topo do velocímetro.
-- meta_taxa_em_dia_base : taxa em dia no momento em que a meta foi definida —
--                         início da escala. O ponteiro anda daqui até a meta.
-- meta_taxa_em_dia_em   : quando a meta foi definida.
--
-- Escala do velocímetro: base → (base+meta)/2 → meta → 1,5×meta → 2×meta.
-- Sem meta definida, o app usa financial_rules.meta_1 e a taxa atual como base.

ALTER TABLE public.acs
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia      numeric(5,2),
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_base numeric(5,2),
  ADD COLUMN IF NOT EXISTS meta_taxa_em_dia_em   timestamptz;

COMMENT ON COLUMN public.acs.meta_taxa_em_dia      IS 'Meta mensal de Taxa em Dia (%) do assessor — topo do velocímetro.';
COMMENT ON COLUMN public.acs.meta_taxa_em_dia_base IS 'Taxa em Dia (%) no momento em que a meta foi definida — início da escala.';
COMMENT ON COLUMN public.acs.meta_taxa_em_dia_em   IS 'Quando a meta de Taxa em Dia foi definida.';

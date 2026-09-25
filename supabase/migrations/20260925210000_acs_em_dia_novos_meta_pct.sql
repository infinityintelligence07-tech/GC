-- Liberty: percentual editável da meta (padrão 95% do A Vencer/Vencido).
ALTER TABLE public.acs
  ADD COLUMN IF NOT EXISTS em_dia_novos_meta_pct numeric(5,2);

COMMENT ON COLUMN public.acs.em_dia_novos_meta_pct IS
  'Liberty: % do A Vencer/Vencido usado como meta da fita Pago. NULL = 95.';

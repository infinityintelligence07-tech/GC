-- Assessores (aba AC / carteira) precisam ler o limite de parcelas para renegociação.

DROP POLICY IF EXISTS financial_rules_select_by_tab ON public.financial_rules;
CREATE POLICY financial_rules_select_by_tab ON public.financial_rules
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['config','alunos','ac','cancelamentos','conciliacao','rendaExtra','dashboard']));

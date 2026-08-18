
-- Permite qualquer usuário autenticado da empresa CRIAR itens pendentes de conciliação
-- (ex.: AC solicitando ajuste financeiro). Aprovar/reprovar/conciliar continua restrito.
DROP POLICY IF EXISTS conciliacao_items_insert_edit ON public.conciliacao_items;
CREATE POLICY conciliacao_items_insert_any_company
  ON public.conciliacao_items
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = current_company_id());

-- Permite qualquer usuário autenticado da empresa VER os itens de conciliação
-- (ACs precisam ver o status dos ajustes que enviaram).
DROP POLICY IF EXISTS conciliacao_items_select_access ON public.conciliacao_items;
CREATE POLICY conciliacao_items_select_company
  ON public.conciliacao_items
  FOR SELECT
  TO authenticated
  USING (company_id = current_company_id());

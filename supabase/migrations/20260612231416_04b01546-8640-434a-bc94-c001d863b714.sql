
-- Permite que qualquer usuário autenticado crie itens de conciliação
-- (continua restrito por company_isolation à empresa ativa).
DROP POLICY IF EXISTS conciliacao_items_insert_priv ON public.conciliacao_items;
CREATE POLICY conciliacao_items_insert_any_auth
  ON public.conciliacao_items
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Permite que qualquer usuário autenticado leia itens de conciliação
-- da sua empresa (company_isolation continua valendo como restritiva).
DROP POLICY IF EXISTS conciliacao_items_select_auth ON public.conciliacao_items;
CREATE POLICY conciliacao_items_select_any_auth
  ON public.conciliacao_items
  FOR SELECT
  TO authenticated
  USING (true);

-- Mesmo problema espelhado em conciliacao_import_errors (rascunhos de import)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='conciliacao_import_errors_insert_priv'
             AND polrelid='public.conciliacao_import_errors'::regclass) THEN
    DROP POLICY conciliacao_import_errors_insert_priv ON public.conciliacao_import_errors;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='conciliacao_import_errors_select_auth'
             AND polrelid='public.conciliacao_import_errors'::regclass) THEN
    DROP POLICY conciliacao_import_errors_select_auth ON public.conciliacao_import_errors;
  END IF;
END$$;

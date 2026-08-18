-- Restrict conciliacao delete/update policies to authenticated role only
DROP POLICY IF EXISTS conciliacao_items_delete_admin ON public.conciliacao_items;
DROP POLICY IF EXISTS conciliacao_items_update_admin ON public.conciliacao_items;
DROP POLICY IF EXISTS conciliacao_import_errors_delete_admin ON public.conciliacao_import_errors;
DROP POLICY IF EXISTS conciliacao_import_errors_update_admin ON public.conciliacao_import_errors;

CREATE POLICY conciliacao_items_delete_admin ON public.conciliacao_items
  FOR DELETE TO authenticated
  USING (public.has_conciliacao_edit(auth.uid()));

CREATE POLICY conciliacao_items_update_admin ON public.conciliacao_items
  FOR UPDATE TO authenticated
  USING (public.has_conciliacao_edit(auth.uid()))
  WITH CHECK (public.has_conciliacao_edit(auth.uid()));

CREATE POLICY conciliacao_import_errors_delete_admin ON public.conciliacao_import_errors
  FOR DELETE TO authenticated
  USING (public.has_conciliacao_edit(auth.uid()));

CREATE POLICY conciliacao_import_errors_update_admin ON public.conciliacao_import_errors
  FOR UPDATE TO authenticated
  USING (public.has_conciliacao_edit(auth.uid()))
  WITH CHECK (public.has_conciliacao_edit(auth.uid()));
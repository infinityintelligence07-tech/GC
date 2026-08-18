
DROP POLICY IF EXISTS "conciliacao_items_insert_any_auth" ON public.conciliacao_items;
CREATE POLICY "conciliacao_items_insert_edit" ON public.conciliacao_items
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id() AND public.has_conciliacao_edit(auth.uid()));

DROP POLICY IF EXISTS "conciliacao_items_select_any_auth" ON public.conciliacao_items;
CREATE POLICY "conciliacao_items_select_access" ON public.conciliacao_items
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.has_conciliacao_access(auth.uid()));

DROP POLICY IF EXISTS "Usuarios autenticados gravam registros" ON public.activity_logs;
CREATE POLICY "Usuarios autenticados gravam registros" ON public.activity_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_user_id IS NULL OR actor_user_id = auth.uid());

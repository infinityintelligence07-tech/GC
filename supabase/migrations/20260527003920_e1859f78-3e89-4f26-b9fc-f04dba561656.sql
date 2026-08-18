-- 1) app_users: bloqueia self-update de role/permissions/ac_id
DROP POLICY IF EXISTS app_users_update_self_or_admin ON public.app_users;

CREATE POLICY app_users_update_admin
ON public.app_users FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Self-update: somente colunas seguras (não troca role/permissions/ac_id/auth_user_id/login)
CREATE POLICY app_users_update_self_safe
ON public.app_users FOR UPDATE TO authenticated
USING (auth_user_id = auth.uid())
WITH CHECK (
  auth_user_id = auth.uid()
  AND role = (SELECT role FROM public.app_users WHERE auth_user_id = auth.uid())
  AND ac_id IS NOT DISTINCT FROM (SELECT ac_id FROM public.app_users WHERE auth_user_id = auth.uid())
  AND login = (SELECT login FROM public.app_users WHERE auth_user_id = auth.uid())
  AND permissions IS NOT DISTINCT FROM (SELECT permissions FROM public.app_users WHERE auth_user_id = auth.uid())
);

-- 2) conciliacao_items: insert restrito
DROP POLICY IF EXISTS conciliacao_items_insert_auth ON public.conciliacao_items;
CREATE POLICY conciliacao_items_insert_priv ON public.conciliacao_items FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'conciliacao')
    OR public.has_role(auth.uid(), 'financeiro')
  );

-- 3) conciliacao_import_errors: insert restrito
DROP POLICY IF EXISTS conciliacao_import_errors_insert_auth ON public.conciliacao_import_errors;
CREATE POLICY conciliacao_import_errors_insert_priv ON public.conciliacao_import_errors FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'conciliacao')
    OR public.has_role(auth.uid(), 'financeiro')
  );

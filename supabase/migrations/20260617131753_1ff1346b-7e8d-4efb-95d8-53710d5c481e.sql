
-- Função helper: usuário tem permissão de conciliação?
-- Aceita: role admin, role conciliacao, OU app_users.permissions->>'conciliacao' = 'edit' / 'view'
CREATE OR REPLACE FUNCTION public.has_conciliacao_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'conciliacao'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.auth_user_id = _user_id
        AND (
          au.role = 'admin'
          OR au.role = 'conciliacao'
          OR COALESCE(au.permissions->>'conciliacao','none') IN ('edit','view')
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_conciliacao_edit(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'conciliacao'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.auth_user_id = _user_id
        AND (
          au.role = 'admin'
          OR au.role = 'conciliacao'
          OR COALESCE(au.permissions->>'conciliacao','none') = 'edit'
        )
    );
$$;

-- Atualiza policies para usar has_conciliacao_edit
DROP POLICY IF EXISTS conciliacao_items_update_admin ON public.conciliacao_items;
CREATE POLICY conciliacao_items_update_admin
  ON public.conciliacao_items FOR UPDATE
  USING (public.has_conciliacao_edit(auth.uid()));

DROP POLICY IF EXISTS conciliacao_items_delete_admin ON public.conciliacao_items;
CREATE POLICY conciliacao_items_delete_admin
  ON public.conciliacao_items FOR DELETE
  USING (public.has_conciliacao_edit(auth.uid()));

DROP POLICY IF EXISTS conciliacao_import_errors_update_admin ON public.conciliacao_import_errors;
CREATE POLICY conciliacao_import_errors_update_admin
  ON public.conciliacao_import_errors FOR UPDATE
  USING (public.has_conciliacao_edit(auth.uid()));

DROP POLICY IF EXISTS conciliacao_import_errors_delete_admin ON public.conciliacao_import_errors;
CREATE POLICY conciliacao_import_errors_delete_admin
  ON public.conciliacao_import_errors FOR DELETE
  USING (public.has_conciliacao_edit(auth.uid()));

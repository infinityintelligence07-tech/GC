-- Admins definidos em app_users (role ou permissions.admin) devem poder
-- listar e gerenciar todos os usuários, alinhado ao canManageUsers() do front.

CREATE OR REPLACE FUNCTION public.can_manage_users(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.app_users au
      WHERE au.auth_user_id = _user_id
        AND (
          au.role = 'admin'
          OR COALESCE(au.permissions->>'admin', 'none') = 'edit'
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_users(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_users(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_users(_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.user_companies
        WHERE user_id = _user_id
          AND company_id = _company_id
      );
$$;

-- app_users
DROP POLICY IF EXISTS app_users_select_self_or_admin ON public.app_users;
CREATE POLICY app_users_select_self_or_admin
ON public.app_users
FOR SELECT
TO authenticated
USING (auth_user_id = auth.uid() OR public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS app_users_insert_admin ON public.app_users;
CREATE POLICY app_users_insert_admin
ON public.app_users
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS app_users_update_admin ON public.app_users;
CREATE POLICY app_users_update_admin
ON public.app_users
FOR UPDATE
TO authenticated
USING (public.can_manage_users(auth.uid()))
WITH CHECK (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS app_users_delete_admin ON public.app_users;
CREATE POLICY app_users_delete_admin
ON public.app_users
FOR DELETE
TO authenticated
USING (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS app_users_company_isolation ON public.app_users;
CREATE POLICY app_users_company_isolation
ON public.app_users
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR public.can_manage_users(auth.uid())
  OR company_id = public.current_company_id()
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR public.can_manage_users(auth.uid())
  OR company_id = public.current_company_id()
);

-- user_companies
DROP POLICY IF EXISTS uc_select ON public.user_companies;
CREATE POLICY uc_select
ON public.user_companies
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS uc_insert_admin ON public.user_companies;
CREATE POLICY uc_insert_admin
ON public.user_companies
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS uc_update_admin ON public.user_companies;
CREATE POLICY uc_update_admin
ON public.user_companies
FOR UPDATE
TO authenticated
USING (public.can_manage_users(auth.uid()))
WITH CHECK (public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS uc_delete_admin ON public.user_companies;
CREATE POLICY uc_delete_admin
ON public.user_companies
FOR DELETE
TO authenticated
USING (public.can_manage_users(auth.uid()));

-- user_company_acs
DROP POLICY IF EXISTS user_company_acs_select_own_or_admin ON public.user_company_acs;
CREATE POLICY user_company_acs_select_own_or_admin
ON public.user_company_acs
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.can_manage_users(auth.uid()));

DROP POLICY IF EXISTS user_company_acs_insert_admin ON public.user_company_acs;
CREATE POLICY user_company_acs_insert_admin
ON public.user_company_acs
FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_users(auth.uid()) AND public.has_company_access(auth.uid(), company_id));

DROP POLICY IF EXISTS user_company_acs_update_admin ON public.user_company_acs;
CREATE POLICY user_company_acs_update_admin
ON public.user_company_acs
FOR UPDATE
TO authenticated
USING (public.can_manage_users(auth.uid()) AND public.has_company_access(auth.uid(), company_id))
WITH CHECK (public.can_manage_users(auth.uid()) AND public.has_company_access(auth.uid(), company_id));

DROP POLICY IF EXISTS user_company_acs_delete_admin ON public.user_company_acs;
CREATE POLICY user_company_acs_delete_admin
ON public.user_company_acs
FOR DELETE
TO authenticated
USING (public.can_manage_users(auth.uid()) AND public.has_company_access(auth.uid(), company_id));

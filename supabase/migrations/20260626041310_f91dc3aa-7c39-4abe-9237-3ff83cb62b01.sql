
-- Helper: tab-level edit permission
CREATE OR REPLACE FUNCTION public.has_tab_edit(_user_id uuid, _tab text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.auth_user_id = _user_id
        AND (
          au.role = 'admin'
          OR COALESCE(au.permissions->>_tab, 'none') = 'edit'
        )
    );
$$;

-- antecipacao_items: restrict write to admins or rendaExtra-edit users
DROP POLICY IF EXISTS antecipacao_items_insert_auth ON public.antecipacao_items;
DROP POLICY IF EXISTS antecipacao_items_update_auth ON public.antecipacao_items;
DROP POLICY IF EXISTS antecipacao_items_delete_auth ON public.antecipacao_items;

CREATE POLICY antecipacao_items_insert_edit ON public.antecipacao_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tab_edit(auth.uid(), 'rendaExtra'));
CREATE POLICY antecipacao_items_update_edit ON public.antecipacao_items
  FOR UPDATE TO authenticated
  USING (public.has_tab_edit(auth.uid(), 'rendaExtra'))
  WITH CHECK (public.has_tab_edit(auth.uid(), 'rendaExtra'));
CREATE POLICY antecipacao_items_delete_edit ON public.antecipacao_items
  FOR DELETE TO authenticated
  USING (public.has_tab_edit(auth.uid(), 'rendaExtra'));

-- cancellation_cases: restrict insert/update to admins or cancelamentos-edit users
DROP POLICY IF EXISTS cancellation_cases_insert_auth ON public.cancellation_cases;
DROP POLICY IF EXISTS cancellation_cases_update_auth ON public.cancellation_cases;

CREATE POLICY cancellation_cases_insert_edit ON public.cancellation_cases
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tab_edit(auth.uid(), 'cancelamentos'));
CREATE POLICY cancellation_cases_update_edit ON public.cancellation_cases
  FOR UPDATE TO authenticated
  USING (public.has_tab_edit(auth.uid(), 'cancelamentos'))
  WITH CHECK (public.has_tab_edit(auth.uid(), 'cancelamentos'));

-- students: restrict insert/update to admins or alunos-edit users
DROP POLICY IF EXISTS students_insert_auth ON public.students;
DROP POLICY IF EXISTS students_update_auth ON public.students;

CREATE POLICY students_insert_edit ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tab_edit(auth.uid(), 'alunos'));
CREATE POLICY students_update_edit ON public.students
  FOR UPDATE TO authenticated
  USING (public.has_tab_edit(auth.uid(), 'alunos'))
  WITH CHECK (public.has_tab_edit(auth.uid(), 'alunos'));

-- conciliacao_import_errors: add INSERT policy
CREATE POLICY conciliacao_import_errors_insert_edit ON public.conciliacao_import_errors
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_conciliacao_edit(auth.uid())
  );

-- app_users: tighten restrictive policy to enforce company isolation
-- (admins still bypass; users only see profiles in their active company)
DROP POLICY IF EXISTS app_users_company_isolation ON public.app_users;
CREATE POLICY app_users_company_isolation ON public.app_users
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR company_id = public.current_company_id()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR company_id = public.current_company_id()
  );

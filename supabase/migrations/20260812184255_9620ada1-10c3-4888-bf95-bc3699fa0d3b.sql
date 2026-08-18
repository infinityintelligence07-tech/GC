CREATE OR REPLACE FUNCTION public.has_any_tab_edit(_user_id uuid, _tabs text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(_user_id, 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.app_users au
      WHERE au.auth_user_id = _user_id
        AND (
          au.role = 'admin'
          OR EXISTS (
            SELECT 1 FROM unnest(_tabs) t
            WHERE COALESCE(au.permissions->>t, 'none') = 'edit'
          )
        )
    );
$$;

DROP POLICY IF EXISTS students_update_edit ON public.students;
CREATE POLICY students_update_edit ON public.students
FOR UPDATE
USING (public.has_any_tab_edit(auth.uid(), ARRAY['alunos','equipe','rendaExtra','cancelamentos','conciliacao']))
WITH CHECK (public.has_any_tab_edit(auth.uid(), ARRAY['alunos','equipe','rendaExtra','cancelamentos','conciliacao']));
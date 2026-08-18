
-- ── Helper functions ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_tab_view(_user_id uuid, _tab text)
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
          OR COALESCE(au.permissions->>_tab, 'none') IN ('edit','view')
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.has_any_tab_view(_user_id uuid, _tabs text[])
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
          OR EXISTS (
            SELECT 1 FROM unnest(_tabs) t
            WHERE COALESCE(au.permissions->>t, 'none') IN ('edit','view')
          )
        )
    );
$$;

-- ── Replace overly permissive SELECT policies ───────────────────────────────

DROP POLICY IF EXISTS students_select_auth ON public.students;
CREATE POLICY students_select_by_tab ON public.students
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['alunos','cancelamentos','conciliacao','rendaExtra','dashboard','equipe']));

DROP POLICY IF EXISTS student_tags_select_auth ON public.student_tags;
CREATE POLICY student_tags_select_by_tab ON public.student_tags
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['alunos','cancelamentos','conciliacao','dashboard']));

DROP POLICY IF EXISTS cancellation_cases_select_auth ON public.cancellation_cases;
CREATE POLICY cancellation_cases_select_by_tab ON public.cancellation_cases
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['cancelamentos','conciliacao','alunos','dashboard']));

DROP POLICY IF EXISTS acs_select_auth ON public.acs;
CREATE POLICY acs_select_by_tab ON public.acs
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['equipe','alunos','dashboard','cancelamentos','conciliacao','rendaExtra']));

DROP POLICY IF EXISTS antecipacao_items_select_auth ON public.antecipacao_items;
CREATE POLICY antecipacao_items_select_by_tab ON public.antecipacao_items
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['rendaExtra','conciliacao','dashboard']));

DROP POLICY IF EXISTS financial_rules_select_auth ON public.financial_rules;
CREATE POLICY financial_rules_select_by_tab ON public.financial_rules
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['config','alunos','cancelamentos','conciliacao','rendaExtra','dashboard']));

DROP POLICY IF EXISTS products_select_auth ON public.products;
CREATE POLICY products_select_by_tab ON public.products
  FOR SELECT TO authenticated
  USING (public.has_any_tab_view(auth.uid(),
    ARRAY['config','alunos','cancelamentos','dashboard']));

-- ── Storage bucket cancellation-docs: scope per company ─────────────────────
-- Path convention: "{company_id}/contracts/{timestamp}_{filename}.pdf"

DROP POLICY IF EXISTS cancellation_docs_select ON storage.objects;
CREATE POLICY cancellation_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND public.has_tab_edit(auth.uid(), 'cancelamentos')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS cancellation_docs_insert ON storage.objects;
CREATE POLICY cancellation_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cancellation-docs'
    AND public.has_tab_edit(auth.uid(), 'cancelamentos')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS cancellation_docs_update ON storage.objects;
CREATE POLICY cancellation_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND public.has_tab_edit(auth.uid(), 'cancelamentos')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  )
  WITH CHECK (
    bucket_id = 'cancellation-docs'
    AND public.has_tab_edit(auth.uid(), 'cancelamentos')
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

DROP POLICY IF EXISTS cancellation_docs_delete ON storage.objects;
CREATE POLICY cancellation_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

CREATE POLICY "conciliacao_import_errors_select_access"
ON public.conciliacao_import_errors
FOR SELECT
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.has_conciliacao_access(auth.uid())
);
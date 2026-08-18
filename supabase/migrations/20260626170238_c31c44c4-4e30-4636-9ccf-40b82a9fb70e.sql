DROP POLICY IF EXISTS app_users_company_isolation ON public.app_users;

CREATE POLICY app_users_company_isolation
ON public.app_users
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  auth_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR company_id = current_company_id()
  OR EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = public.app_users.company_id
  )
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR company_id = current_company_id()
  OR EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = public.app_users.company_id
  )
);
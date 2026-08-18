
-- Tighten RESTRICTIVE isolation on app_users: remove overly-broad user_companies fallback
DROP POLICY IF EXISTS app_users_company_isolation ON public.app_users;
CREATE POLICY app_users_company_isolation ON public.app_users
AS RESTRICTIVE
FOR ALL
USING (
  auth_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR company_id = public.current_company_id()
)
WITH CHECK (
  auth_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR company_id = public.current_company_id()
);

-- Add explicit SELECT policy for company-logos public bucket
DROP POLICY IF EXISTS "company_logos_public_read" ON storage.objects;
CREATE POLICY "company_logos_public_read" ON storage.objects
FOR SELECT
USING (bucket_id = 'company-logos');

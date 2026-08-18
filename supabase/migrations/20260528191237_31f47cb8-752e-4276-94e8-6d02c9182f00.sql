CREATE TABLE IF NOT EXISTS public.user_company_acs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ac_id uuid NOT NULL REFERENCES public.acs(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_company_acs TO authenticated;
GRANT ALL ON public.user_company_acs TO service_role;

ALTER TABLE public.user_company_acs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_company_acs_select_own_or_admin" ON public.user_company_acs;
CREATE POLICY "user_company_acs_select_own_or_admin"
ON public.user_company_acs
FOR SELECT
TO authenticated
USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "user_company_acs_insert_admin" ON public.user_company_acs;
CREATE POLICY "user_company_acs_insert_admin"
ON public.user_company_acs
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND has_company_access(auth.uid(), company_id));

DROP POLICY IF EXISTS "user_company_acs_update_admin" ON public.user_company_acs;
CREATE POLICY "user_company_acs_update_admin"
ON public.user_company_acs
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND has_company_access(auth.uid(), company_id))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND has_company_access(auth.uid(), company_id));

DROP POLICY IF EXISTS "user_company_acs_delete_admin" ON public.user_company_acs;
CREATE POLICY "user_company_acs_delete_admin"
ON public.user_company_acs
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND has_company_access(auth.uid(), company_id));

DROP TRIGGER IF EXISTS set_updated_at_user_company_acs ON public.user_company_acs;
CREATE TRIGGER set_updated_at_user_company_acs
BEFORE UPDATE ON public.user_company_acs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.user_company_acs (user_id, company_id, ac_id)
SELECT au.auth_user_id, a.company_id, au.ac_id
FROM public.app_users au
JOIN public.acs a ON a.id = au.ac_id
WHERE au.auth_user_id IS NOT NULL
  AND au.ac_id IS NOT NULL
ON CONFLICT (user_id, company_id)
DO UPDATE SET ac_id = EXCLUDED.ac_id;

CREATE OR REPLACE FUNCTION public.current_ac_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (
      SELECT uca.ac_id
      FROM public.user_company_acs uca
      WHERE uca.user_id = auth.uid()
        AND uca.company_id = public.current_company_id()
      LIMIT 1
    ),
    (
      SELECT au.ac_id
      FROM public.app_users au
      JOIN public.acs a ON a.id = au.ac_id
      WHERE au.auth_user_id = auth.uid()
        AND (a.company_id = public.current_company_id() OR public.current_company_id() IS NULL)
      LIMIT 1
    )
  );
$$;
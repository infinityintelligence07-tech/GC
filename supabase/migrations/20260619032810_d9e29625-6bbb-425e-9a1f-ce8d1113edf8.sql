-- Helper: verifica se o usuário autenticado tem permissão Admin (view ou edit)
CREATE OR REPLACE FUNCTION public.has_admin_permission(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users au
    WHERE au.auth_user_id = _user_id
      AND (
        au.role = 'admin'
        OR COALESCE(au.permissions->>'admin','none') IN ('edit','view')
      )
  );
$$;

CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_name text,
  company_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  entity_label text,
  summary text NOT NULL,
  meta jsonb
);

CREATE INDEX activity_logs_created_at_idx ON public.activity_logs (created_at DESC);
CREATE INDEX activity_logs_actor_idx ON public.activity_logs (actor_user_id);
CREATE INDEX activity_logs_entity_idx ON public.activity_logs (entity);
CREATE INDEX activity_logs_company_idx ON public.activity_logs (company_id);

GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins podem ler registros"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (public.has_admin_permission(auth.uid()));

CREATE POLICY "Usuarios autenticados gravam registros"
  ON public.activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

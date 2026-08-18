
-- 1. companies
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  color_primary text NOT NULL DEFAULT '#0022ff',
  color_accent text NOT NULL DEFAULT '#7c3aed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

INSERT INTO public.companies (id, name, slug, color_primary, color_accent)
VALUES ('00000000-0000-0000-0000-0000000a1a11'::uuid, 'IAM Gestão de Contas', 'iam', '#0022ff', '#7c3aed');
INSERT INTO public.companies (name, slug, color_primary, color_accent)
VALUES ('Liberty', 'liberty', '#16a34a', '#0ea5e9');

-- 2. user_companies
CREATE TABLE public.user_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);
CREATE INDEX user_companies_user_id_idx ON public.user_companies(user_id);
CREATE INDEX user_companies_company_id_idx ON public.user_companies(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_companies TO authenticated;
GRANT ALL ON public.user_companies TO service_role;
ALTER TABLE public.user_companies ENABLE ROW LEVEL SECURITY;

-- 3. user_active_company
CREATE TABLE public.user_active_company (
  user_id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_active_company TO authenticated;
GRANT ALL ON public.user_active_company TO service_role;
ALTER TABLE public.user_active_company ENABLE ROW LEVEL SECURITY;

-- 4. Funções
CREATE OR REPLACE FUNCTION public.has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.user_companies WHERE user_id = _user_id AND company_id = _company_id);
$$;

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT company_id FROM public.user_active_company WHERE user_id = auth.uid() LIMIT 1;
$$;

-- 5. Policies das tabelas novas
CREATE POLICY companies_select ON public.companies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = auth.uid() AND uc.company_id = companies.id));
CREATE POLICY companies_insert_admin ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY companies_update_admin ON public.companies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY companies_delete_admin ON public.companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY uc_select ON public.user_companies FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY uc_insert_admin ON public.user_companies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY uc_update_admin ON public.user_companies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY uc_delete_admin ON public.user_companies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE POLICY uac_select_own ON public.user_active_company FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY uac_insert_own ON public.user_active_company FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_company_access(auth.uid(), company_id));
CREATE POLICY uac_update_own ON public.user_active_company FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.has_company_access(auth.uid(), company_id));

CREATE TRIGGER trg_companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_uac_updated_at BEFORE UPDATE ON public.user_active_company
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Backfill company_id em todas as tabelas
DO $$
DECLARE
  iam_id uuid := '00000000-0000-0000-0000-0000000a1a11'::uuid;
  t text;
  tables text[] := ARRAY[
    'acs','products','student_tags','financial_rules',
    'students','cancellation_cases','app_users',
    'antecipacao_items','conciliacao_items','conciliacao_import_errors',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid', t);
    EXECUTE format('UPDATE public.%I SET company_id = %L::uuid WHERE company_id IS NULL', t, iam_id);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.current_company_id()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (company_id)', t || '_company_id_idx', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id) REFERENCES public.companies(id)',
                   t, t || '_company_id_fkey');
  END LOOP;
END $$;

-- 7. Vincular usuários existentes à IAM
INSERT INTO public.user_companies (user_id, company_id)
SELECT DISTINCT auth_user_id, '00000000-0000-0000-0000-0000000a1a11'::uuid
  FROM public.app_users
 WHERE auth_user_id IS NOT NULL
ON CONFLICT (user_id, company_id) DO NOTHING;

INSERT INTO public.user_active_company (user_id, company_id)
SELECT DISTINCT auth_user_id, '00000000-0000-0000-0000-0000000a1a11'::uuid
  FROM public.app_users
 WHERE auth_user_id IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- 8. Política RESTRITIVA de isolamento por empresa
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'acs','products','student_tags','financial_rules',
    'students','cancellation_cases','app_users',
    'antecipacao_items','conciliacao_items','conciliacao_import_errors',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
         USING (company_id = public.current_company_id())
         WITH CHECK (company_id = public.current_company_id())',
      t || '_company_isolation', t
    );
  END LOOP;
END $$;

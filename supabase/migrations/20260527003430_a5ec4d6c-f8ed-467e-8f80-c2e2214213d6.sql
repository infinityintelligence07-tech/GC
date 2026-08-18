-- ────────────────────────────────────────────────────────────────────────────
-- ETAPA 2 — Ligar app_users ao Supabase Auth, dropar coluna password,
-- e aplicar RLS escopada em todas as tabelas
-- ────────────────────────────────────────────────────────────────────────────

-- 1) Adiciona auth_user_id em app_users e popula via match por login (email)
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS auth_user_id UUID;

UPDATE public.app_users a
SET auth_user_id = u.id
FROM auth.users u
WHERE a.auth_user_id IS NULL
  AND lower(u.email) = lower(a.login) || '@app.local';

CREATE UNIQUE INDEX IF NOT EXISTS app_users_auth_user_id_uidx
  ON public.app_users(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- 2) Dropa a coluna password (senhas agora no auth.users com bcrypt)
ALTER TABLE public.app_users DROP COLUMN IF EXISTS password;

-- 3) Dropa tabela profiles (vamos usar app_users como perfil)
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Recria trigger handle_new_user para não falhar (sem profiles)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN NEW; END;
$$;

-- 4) Função helper: o app_user do usuário logado
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_ac_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ac_id FROM public.app_users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS — REMOVE PÚBLICAS, APLICA ESCOPADAS
-- ────────────────────────────────────────────────────────────────────────────

-- Helper macro: revogar anon de tudo
REVOKE ALL ON public.acs FROM anon;
REVOKE ALL ON public.products FROM anon;
REVOKE ALL ON public.student_tags FROM anon;
REVOKE ALL ON public.financial_rules FROM anon;
REVOKE ALL ON public.students FROM anon;
REVOKE ALL ON public.cancellation_cases FROM anon;
REVOKE ALL ON public.app_users FROM anon;
REVOKE ALL ON public.antecipacao_items FROM anon;
REVOKE ALL ON public.conciliacao_items FROM anon;
REVOKE ALL ON public.conciliacao_import_errors FROM anon;
REVOKE ALL ON public.notifications FROM anon;

-- Garante grants para authenticated/service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.acs TO authenticated;
GRANT ALL ON public.acs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_tags TO authenticated;
GRANT ALL ON public.student_tags TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_rules TO authenticated;
GRANT ALL ON public.financial_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT ALL ON public.students TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cancellation_cases TO authenticated;
GRANT ALL ON public.cancellation_cases TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.antecipacao_items TO authenticated;
GRANT ALL ON public.antecipacao_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliacao_items TO authenticated;
GRANT ALL ON public.conciliacao_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conciliacao_import_errors TO authenticated;
GRANT ALL ON public.conciliacao_import_errors TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- ───── acs ─────
DROP POLICY IF EXISTS acs_public_all ON public.acs;
CREATE POLICY acs_select_auth ON public.acs FOR SELECT TO authenticated USING (true);
CREATE POLICY acs_modify_admin ON public.acs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY acs_update_admin ON public.acs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY acs_delete_admin ON public.acs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── products ─────
DROP POLICY IF EXISTS products_public_all ON public.products;
CREATE POLICY products_select_auth ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY products_insert_admin ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY products_update_admin ON public.products FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY products_delete_admin ON public.products FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── student_tags ─────
DROP POLICY IF EXISTS student_tags_public_all ON public.student_tags;
CREATE POLICY student_tags_select_auth ON public.student_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY student_tags_insert_admin ON public.student_tags FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY student_tags_update_admin ON public.student_tags FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY student_tags_delete_admin ON public.student_tags FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── financial_rules ─────
DROP POLICY IF EXISTS financial_rules_public_all ON public.financial_rules;
CREATE POLICY financial_rules_select_auth ON public.financial_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY financial_rules_insert_admin ON public.financial_rules FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY financial_rules_update_admin ON public.financial_rules FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY financial_rules_delete_admin ON public.financial_rules FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── students ─────
DROP POLICY IF EXISTS students_public_all ON public.students;
CREATE POLICY students_select_auth ON public.students FOR SELECT TO authenticated USING (true);
CREATE POLICY students_insert_auth ON public.students FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY students_update_auth ON public.students FOR UPDATE TO authenticated USING (true);
CREATE POLICY students_delete_admin ON public.students FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── cancellation_cases ─────
DROP POLICY IF EXISTS cancellation_cases_public_all ON public.cancellation_cases;
CREATE POLICY cancellation_cases_select_auth ON public.cancellation_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY cancellation_cases_insert_auth ON public.cancellation_cases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY cancellation_cases_update_auth ON public.cancellation_cases FOR UPDATE TO authenticated USING (true);
CREATE POLICY cancellation_cases_delete_admin ON public.cancellation_cases FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ───── antecipacao_items ─────
DROP POLICY IF EXISTS antecipacao_items_public_all ON public.antecipacao_items;
CREATE POLICY antecipacao_items_select_auth ON public.antecipacao_items FOR SELECT TO authenticated USING (true);
CREATE POLICY antecipacao_items_insert_auth ON public.antecipacao_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY antecipacao_items_update_auth ON public.antecipacao_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY antecipacao_items_delete_auth ON public.antecipacao_items FOR DELETE TO authenticated USING (true);

-- ───── app_users ─────
DROP POLICY IF EXISTS app_users_public_all ON public.app_users;
CREATE POLICY app_users_select_self_or_admin ON public.app_users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY app_users_insert_admin ON public.app_users FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY app_users_update_self_or_admin ON public.app_users FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY app_users_delete_admin ON public.app_users FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ───── conciliacao_items ─────
DROP POLICY IF EXISTS conciliacao_items_public_all ON public.conciliacao_items;
CREATE POLICY conciliacao_items_select_auth ON public.conciliacao_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'conciliacao') OR public.has_role(auth.uid(), 'financeiro'));
CREATE POLICY conciliacao_items_insert_auth ON public.conciliacao_items FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY conciliacao_items_update_admin ON public.conciliacao_items FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'conciliacao'));
CREATE POLICY conciliacao_items_delete_admin ON public.conciliacao_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ───── conciliacao_import_errors ─────
DROP POLICY IF EXISTS conciliacao_import_errors_public_all ON public.conciliacao_import_errors;
CREATE POLICY conciliacao_import_errors_select_auth ON public.conciliacao_import_errors FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'conciliacao') OR public.has_role(auth.uid(), 'financeiro'));
CREATE POLICY conciliacao_import_errors_insert_auth ON public.conciliacao_import_errors FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY conciliacao_import_errors_update_admin ON public.conciliacao_import_errors FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'conciliacao'));
CREATE POLICY conciliacao_import_errors_delete_admin ON public.conciliacao_import_errors FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ───── notifications ─────
DROP POLICY IF EXISTS notifications_public_all ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR (ac_id IS NOT NULL AND ac_id = public.current_ac_id())
  );
CREATE POLICY notifications_insert_auth ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR (ac_id IS NOT NULL AND ac_id = public.current_ac_id())
  );
CREATE POLICY notifications_delete_admin ON public.notifications FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

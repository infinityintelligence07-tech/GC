-- Corrige "new row violates row-level security policy" ao salvar observações
-- com anexo em cancelamentos (storage cancellation-docs + case_notes).

-- ── Permissões efetivas (alinhadas ao getEffectivePermissions do front) ─────

CREATE OR REPLACE FUNCTION public.effective_tab_level(_user_id uuid, _tab text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  au RECORD;
  lvl text;
BEGIN
  IF public.has_role(_user_id, 'admin'::public.app_role) THEN
    RETURN 'edit';
  END IF;

  SELECT role, permissions INTO au
  FROM public.app_users
  WHERE auth_user_id = _user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'none';
  END IF;

  IF au.role = 'admin' THEN
    RETURN 'edit';
  END IF;

  IF au.role = 'conciliacao' THEN
    IF _tab = 'conciliacao' THEN
      RETURN 'edit';
    END IF;
    IF au.permissions ? _tab THEN
      RETURN COALESCE(au.permissions->>_tab, 'none');
    END IF;
    RETURN 'none';
  END IF;

  IF au.permissions IS NOT NULL THEN
    IF au.permissions ? _tab THEN
      RETURN COALESCE(au.permissions->>_tab, 'none');
    END IF;
    RETURN 'none';
  END IF;

  CASE au.role
    WHEN 'ac' THEN
      IF _tab IN ('equipe', 'rendaExtra') THEN RETURN 'edit'; END IF;
    WHEN 'acn2' THEN
      IF _tab IN ('equipe', 'rendaExtra', 'cancelamentos') THEN RETURN 'edit'; END IF;
    WHEN 'juridico' THEN
      IF _tab = 'cancelamentos' THEN RETURN 'edit'; END IF;
    ELSE
      NULL;
  END CASE;

  RETURN 'none';
END;
$$;

CREATE OR REPLACE FUNCTION public.has_tab_edit(_user_id uuid, _tab text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_tab_level(_user_id, _tab) = 'edit';
$$;

CREATE OR REPLACE FUNCTION public.has_tab_view(_user_id uuid, _tab text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_tab_level(_user_id, _tab) IN ('edit', 'view', 'own');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_cancellation_case_notes(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.effective_tab_level(_user_id, 'cancelamentos') IN ('edit', 'view')
    OR public.effective_tab_level(_user_id, 'estornos') IN ('edit', 'view');
$$;

-- ── RPC: atualiza somente case_notes (evita UPDATE amplo com permissão view) ──

CREATE OR REPLACE FUNCTION public.save_cancellation_case_notes(
  p_case_id uuid,
  p_notes jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_cancellation_case_notes(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para salvar observações do caso';
  END IF;

  UPDATE public.cancellation_cases
  SET case_notes = COALESCE(p_notes, '[]'::jsonb),
      updated_at = now()
  WHERE id = p_case_id
    AND company_id = public.current_company_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caso não encontrado ou sem acesso';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_cancellation_case_notes(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_cancellation_case_notes(uuid, jsonb) TO authenticated;

-- ── Storage cancellation-docs (políticas ausentes em produção) ───────────────
-- Path: "{company_id}/case-notes/{case_id}/..." ou "{company_id}/contracts/..."

CREATE OR REPLACE FUNCTION public.can_access_cancellation_storage(_user_id uuid, _path text, _require_edit boolean)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  folders text[];
  is_case_notes boolean;
BEGIN
  folders := storage.foldername(_path);
  IF folders IS NULL OR array_length(folders, 1) IS NULL THEN
    RETURN false;
  END IF;

  IF folders[1] IS DISTINCT FROM public.current_company_id()::text THEN
    RETURN false;
  END IF;

  is_case_notes := folders[2] = 'case-notes';

  IF is_case_notes THEN
    RETURN public.can_manage_cancellation_case_notes(_user_id);
  END IF;

  IF _require_edit THEN
    RETURN public.effective_tab_level(_user_id, 'cancelamentos') = 'edit'
        OR public.effective_tab_level(_user_id, 'estornos') = 'edit';
  END IF;

  RETURN public.can_manage_cancellation_case_notes(_user_id)
      OR public.effective_tab_level(_user_id, 'cancelamentos') = 'edit'
      OR public.effective_tab_level(_user_id, 'estornos') = 'edit';
END;
$$;

DROP POLICY IF EXISTS cancellation_docs_select ON storage.objects;
CREATE POLICY cancellation_docs_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND public.can_access_cancellation_storage(auth.uid(), name, false)
  );

DROP POLICY IF EXISTS cancellation_docs_insert ON storage.objects;
CREATE POLICY cancellation_docs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cancellation-docs'
    AND public.can_access_cancellation_storage(auth.uid(), name, true)
  );

DROP POLICY IF EXISTS cancellation_docs_update ON storage.objects;
CREATE POLICY cancellation_docs_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND public.can_access_cancellation_storage(auth.uid(), name, true)
  )
  WITH CHECK (
    bucket_id = 'cancellation-docs'
    AND public.can_access_cancellation_storage(auth.uid(), name, true)
  );

DROP POLICY IF EXISTS cancellation_docs_delete ON storage.objects;
CREATE POLICY cancellation_docs_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'cancellation-docs'
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.app_users au
        WHERE au.auth_user_id = auth.uid() AND au.role = 'admin'
      )
    )
    AND (storage.foldername(name))[1] = public.current_company_id()::text
  );

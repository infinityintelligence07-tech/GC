-- Registros: ACs leem as próprias ações; quem tem registros view/edit vê tudo.
-- Alinha effective_tab_level com os pisos do front (alunos view; registros own p/ AC).

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

  SELECT role, permissions, ac_id INTO au
  FROM public.app_users
  WHERE auth_user_id = _user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'none';
  END IF;

  IF au.role = 'admin' THEN
    RETURN 'edit';
  END IF;

  IF au.role = 'conciliacao' AND _tab = 'conciliacao' THEN
    RETURN 'edit';
  END IF;

  IF au.permissions IS NOT NULL AND (au.permissions ? _tab) THEN
    lvl := COALESCE(au.permissions->>_tab, 'none');
    RETURN lvl;
  END IF;

  -- Pisos (chave ausente): alunos sempre view; registros own se usuário tem AC.
  IF _tab = 'alunos' THEN
    RETURN 'view';
  END IF;

  IF _tab = 'registros' THEN
    IF COALESCE(au.permissions->>'admin', 'none') IN ('edit', 'view') THEN
      RETURN 'edit';
    END IF;
    IF au.ac_id IS NOT NULL THEN
      RETURN 'own';
    END IF;
  END IF;

  IF au.permissions IS NULL THEN
    CASE au.role
      WHEN 'ac' THEN
        IF _tab IN ('equipe', 'rendaExtra') THEN RETURN 'edit'; END IF;
      WHEN 'acn2' THEN
        IF _tab IN ('equipe', 'rendaExtra', 'cancelamentos') THEN RETURN 'edit'; END IF;
      WHEN 'juridico' THEN
        IF _tab IN ('cancelamentos', 'documentos') THEN RETURN 'edit'; END IF;
      ELSE
        NULL;
    END CASE;
  END IF;

  RETURN 'none';
END;
$$;

CREATE OR REPLACE FUNCTION public.has_tab_view(_user_id uuid, _tab text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_tab_level(_user_id, _tab) IN ('edit', 'view', 'own');
$$;

CREATE OR REPLACE FUNCTION public.has_tab_edit(_user_id uuid, _tab text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_tab_level(_user_id, _tab) = 'edit';
$$;

-- SELECT: admin (legado) OU próprios registros OU registros view/edit (todos).
DROP POLICY IF EXISTS "Admins podem ler registros" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_access" ON public.activity_logs;

CREATE POLICY "activity_logs_select_access"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (
    public.has_admin_permission(auth.uid())
    OR actor_user_id = auth.uid()
    OR public.effective_tab_level(auth.uid(), 'registros') IN ('view', 'edit')
  );

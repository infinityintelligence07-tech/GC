-- Assessores (role ac/acn2 ou com ac_id) sempre veem a aba Alunos,
-- mesmo com permissions.alunos = 'none' no JSON.

CREATE OR REPLACE FUNCTION public.effective_tab_level(_user_id uuid, _tab text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  au RECORD;
  lvl text;
  is_assessor boolean;
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

  is_assessor :=
    au.role IN ('ac', 'acn2')
    OR au.ac_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.user_company_acs uca
      WHERE uca.user_id = _user_id AND uca.ac_id IS NOT NULL
    );

  IF au.role = 'conciliacao' AND _tab = 'conciliacao' THEN
    RETURN 'edit';
  END IF;

  IF au.permissions IS NOT NULL AND (au.permissions ? _tab) THEN
    lvl := COALESCE(au.permissions->>_tab, 'none');
    -- Assessor: alunos nunca fica none (mínimo view; edit salvo prevalece).
    IF _tab = 'alunos' AND is_assessor AND lvl <> 'edit' THEN
      RETURN 'view';
    END IF;
    RETURN lvl;
  END IF;

  -- Pisos (chave ausente)
  IF _tab = 'alunos' THEN
    RETURN 'view';
  END IF;

  IF _tab = 'registros' THEN
    IF COALESCE(au.permissions->>'admin', 'none') IN ('edit', 'view') THEN
      RETURN 'edit';
    END IF;
    IF is_assessor THEN
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

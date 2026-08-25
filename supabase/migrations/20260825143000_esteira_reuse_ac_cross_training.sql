-- Esteira: reutiliza AC de outro treinamento da mesma pessoa.
-- Antes: só CPF + ciclo iguais. Agora:
--   1) Mesmo CPF (qualquer treinamento/ciclo) com AC preenchido
--   2) Fallback: mesmo nome normalizado (quando CPF não bate entre fichas)

CREATE OR REPLACE FUNCTION public.normalize_person_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT translate(
    lower(btrim(coalesce(p_name, ''))),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
  );
$$;

CREATE OR REPLACE FUNCTION public.existing_ac_for_esteira(
  p_company_id uuid,
  p_cpf text DEFAULT NULL,
  p_name text DEFAULT NULL,
  p_exclude_student_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '[^0-9]', '', 'g');
  v_name text := public.normalize_person_name(p_name);
  v_existing_ac text;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF length(v_cpf) >= 11 THEN
    SELECT s.ac INTO v_existing_ac
    FROM public.students s
    WHERE s.company_id = p_company_id
      AND s.id IS DISTINCT FROM p_exclude_student_id
      AND regexp_replace(coalesce(s.cpf, ''), '[^0-9]', '', 'g') = v_cpf
      AND length(regexp_replace(coalesce(s.cpf, ''), '[^0-9]', '', 'g')) >= 11
      AND s.ac IS NOT NULL
      AND btrim(s.ac) <> ''
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;

    IF v_existing_ac IS NOT NULL THEN
      RETURN v_existing_ac;
    END IF;
  END IF;

  IF v_name <> '' THEN
    SELECT s.ac INTO v_existing_ac
    FROM public.students s
    WHERE s.company_id = p_company_id
      AND s.id IS DISTINCT FROM p_exclude_student_id
      AND public.normalize_person_name(s.name) = v_name
      AND s.ac IS NOT NULL
      AND btrim(s.ac) <> ''
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;

    IF v_existing_ac IS NOT NULL THEN
      RETURN v_existing_ac;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.students_assign_ac_esteira()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod text;
  v_existing_ac text;
  v_last uuid;
  v_ids uuid[];
  v_names text[];
  v_n int;
  v_idx int;
  v_next_id uuid;
  v_next_name text;
  i int;
BEGIN
  IF NEW.ac IS NOT NULL AND btrim(NEW.ac) <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_prod := lower(btrim(coalesce(NEW.product, '')));
  v_prod := translate(
    v_prod,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
  );

  IF v_prod = 'ipr'
     OR v_prod LIKE 'ipr %'
     OR v_prod LIKE '% ipr'
     OR v_prod LIKE '% ipr %'
     OR v_prod LIKE '%imersao prosperar%'
     OR v_prod LIKE '%imersao de negocios%'
  THEN
    RETURN NEW;
  END IF;

  v_existing_ac := public.existing_ac_for_esteira(
    NEW.company_id,
    NEW.cpf,
    NEW.name,
    NEW.id
  );

  IF v_existing_ac IS NOT NULL THEN
    NEW.ac := v_existing_ac;
    RETURN NEW;
  END IF;

  INSERT INTO public.ac_esteira_state (company_id)
  VALUES (NEW.company_id)
  ON CONFLICT (company_id) DO NOTHING;

  SELECT last_assigned_ac_id INTO v_last
  FROM public.ac_esteira_state
  WHERE company_id = NEW.company_id
  FOR UPDATE;

  SELECT
    coalesce(array_agg(a.id ORDER BY a.created_at ASC NULLS LAST, a.name ASC), '{}'::uuid[]),
    coalesce(array_agg(a.name ORDER BY a.created_at ASC NULLS LAST, a.name ASC), '{}'::text[])
  INTO v_ids, v_names
  FROM public.acs a
  WHERE a.company_id = NEW.company_id
    AND a.active = true;

  v_n := coalesce(array_length(v_ids, 1), 0);
  IF v_n = 0 THEN
    RETURN NEW;
  END IF;

  v_idx := NULL;
  IF v_last IS NOT NULL THEN
    FOR i IN 1..v_n LOOP
      IF v_ids[i] = v_last THEN
        v_idx := i;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_idx IS NULL THEN
    v_next_id := v_ids[1];
    v_next_name := v_names[1];
  ELSIF v_idx >= v_n THEN
    v_next_id := v_ids[1];
    v_next_name := v_names[1];
  ELSE
    v_next_id := v_ids[v_idx + 1];
    v_next_name := v_names[v_idx + 1];
  END IF;

  NEW.ac := v_next_name;

  UPDATE public.ac_esteira_state
  SET last_assigned_ac_id = v_next_id,
      updated_at = now()
  WHERE company_id = NEW.company_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_ac_from_esteira(
  p_company_id uuid,
  p_cpf text DEFAULT NULL,
  p_product text DEFAULT NULL,
  p_ciclo text DEFAULT NULL,
  p_exclude_student_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prod text;
  v_name text := coalesce(
    p_name,
    (SELECT s.name FROM public.students s WHERE s.id = p_exclude_student_id)
  );
  v_existing_ac text;
  v_last uuid;
  v_ids uuid[];
  v_names text[];
  v_n int;
  v_idx int;
  v_next_id uuid;
  v_next_name text;
  i int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_prod := lower(btrim(coalesce(p_product, '')));
  v_prod := translate(
    v_prod,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
  );

  IF v_prod = 'ipr'
     OR v_prod LIKE 'ipr %'
     OR v_prod LIKE '% ipr'
     OR v_prod LIKE '% ipr %'
     OR v_prod LIKE '%imersao prosperar%'
     OR v_prod LIKE '%imersao de negocios%'
  THEN
    RETURN NULL;
  END IF;

  v_existing_ac := public.existing_ac_for_esteira(
    p_company_id,
    p_cpf,
    v_name,
    p_exclude_student_id
  );

  IF v_existing_ac IS NOT NULL THEN
    RETURN v_existing_ac;
  END IF;

  INSERT INTO public.ac_esteira_state (company_id)
  VALUES (p_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  SELECT last_assigned_ac_id INTO v_last
  FROM public.ac_esteira_state
  WHERE company_id = p_company_id
  FOR UPDATE;

  SELECT
    coalesce(array_agg(a.id ORDER BY a.created_at ASC NULLS LAST, a.name ASC), '{}'::uuid[]),
    coalesce(array_agg(a.name ORDER BY a.created_at ASC NULLS LAST, a.name ASC), '{}'::text[])
  INTO v_ids, v_names
  FROM public.acs a
  WHERE a.company_id = p_company_id
    AND a.active = true;

  v_n := coalesce(array_length(v_ids, 1), 0);
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;

  v_idx := NULL;
  IF v_last IS NOT NULL THEN
    FOR i IN 1..v_n LOOP
      IF v_ids[i] = v_last THEN
        v_idx := i;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_idx IS NULL THEN
    v_next_id := v_ids[1];
    v_next_name := v_names[1];
  ELSIF v_idx >= v_n THEN
    v_next_id := v_ids[1];
    v_next_name := v_names[1];
  ELSE
    v_next_id := v_ids[v_idx + 1];
    v_next_name := v_names[v_idx + 1];
  END IF;

  UPDATE public.ac_esteira_state
  SET last_assigned_ac_id = v_next_id,
      updated_at = now()
  WHERE company_id = p_company_id;

  RETURN v_next_name;
END;
$$;

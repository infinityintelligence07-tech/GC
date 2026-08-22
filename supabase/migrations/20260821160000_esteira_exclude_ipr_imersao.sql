-- Esteira: não atribui AC automático para IPR / Imersão Prosperar / Imersão de Negócios.

CREATE OR REPLACE FUNCTION public.students_assign_ac_esteira()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cpf text;
  v_ciclo text;
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
  -- AC já informado: não mexe na esteira
  IF NEW.ac IS NOT NULL AND btrim(NEW.ac) <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Normaliza produto (minúsculas, sem acento) para exclusões da esteira
  v_prod := lower(btrim(coalesce(NEW.product, '')));
  v_prod := translate(
    v_prod,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
  );

  -- Contratos fora da esteira: IPR / Imersão Prosperar / Imersão de Negócios
  IF v_prod = 'ipr'
     OR v_prod LIKE 'ipr %'
     OR v_prod LIKE '% ipr'
     OR v_prod LIKE '% ipr %'
     OR v_prod LIKE '%imersao prosperar%'
     OR v_prod LIKE '%imersao de negocios%'
  THEN
    RETURN NEW;
  END IF;

  v_cpf := regexp_replace(coalesce(NEW.cpf, ''), '[^0-9]', '', 'g');
  v_ciclo := lower(btrim(coalesce(NEW.ciclo, '')));

  -- Aluno já existente (mesmo CPF + ciclo): reusa AC sem avançar a fila
  IF v_cpf <> '' THEN
    SELECT s.ac INTO v_existing_ac
    FROM public.students s
    WHERE s.company_id = NEW.company_id
      AND s.id IS DISTINCT FROM NEW.id
      AND regexp_replace(coalesce(s.cpf, ''), '[^0-9]', '', 'g') = v_cpf
      AND lower(btrim(coalesce(s.ciclo, ''))) = v_ciclo
      AND s.ac IS NOT NULL
      AND btrim(s.ac) <> ''
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;

    IF v_existing_ac IS NOT NULL THEN
      NEW.ac := v_existing_ac;
      RETURN NEW;
    END IF;
  END IF;

  -- Garante linha de estado e trava para concorrência
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

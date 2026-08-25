-- IAM não injeta financeiro no GC: Kamino é a fonte da verdade.
-- Novos alunos IAM entram só com cadastro + pendência; parcelas vêm da sync Kamino.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS kamino_synced_at timestamptz;

COMMENT ON COLUMN public.students.kamino_synced_at IS
  'Preenchido pela sync Kamino. Enquanto NULL, valores financeiros do IAM não entram na carteira.';

CREATE OR REPLACE FUNCTION public.run_kamino_sync_from_staging()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
  v_protected uuid[];
  v_deleted int;
  v_inserted int;
  v_updated int;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE active = true
  ORDER BY CASE WHEN name ILIKE '%iam%' THEN 0 ELSE 1 END, name LIMIT 1;

  CREATE TEMP TABLE matched_ids (id uuid PRIMARY KEY) ON COMMIT DROP;

  SELECT coalesce(array_agg(DISTINCT student_id), ARRAY[]::uuid[])
  INTO v_protected FROM public.cancellation_cases WHERE student_id IS NOT NULL;

  INSERT INTO matched_ids (id)
  SELECT s.id FROM public.students s
  JOIN public._kamino_sync_staging k ON public.gc_student_key(s.name, s.product) = k.skey
  ON CONFLICT DO NOTHING;

  UPDATE public.students s SET
    whatsapp = coalesce(nullif(k.whatsapp, ''), s.whatsapp, ''),
    email = coalesce(k.email, s.email),
    ac = coalesce(nullif(trim(s.ac), ''), k.ac, ''),
    sale_value = k.sale_value, down_payment = k.down_payment,
    total_installments = k.total_installments, paid_installments = k.paid_installments,
    installment_value = k.installment_value, installments = k.installments,
    due_day = k.due_day, detalhes = k.detalhes,
    kamino_synced_at = now(),
    enrollment_date = CASE WHEN s.id = ANY(v_protected) THEN s.enrollment_date ELSE k.enrollment_date::text END,
    data_treinamento_origem = CASE WHEN s.id = ANY(v_protected) THEN s.data_treinamento_origem ELSE coalesce(k.data_treinamento_origem::text, k.enrollment_date::text) END,
    name = CASE WHEN s.id = ANY(v_protected) THEN s.name ELSE k.name END,
    product = CASE WHEN s.id = ANY(v_protected) THEN s.product ELSE k.product END,
    status = CASE WHEN s.id = ANY(v_protected) THEN s.status ELSE k.status END,
    updated_at = now()
  FROM public._kamino_sync_staging k
  WHERE public.gc_student_key(s.name, s.product) = k.skey;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.students (
    id, company_id, name, whatsapp, email, cpf, address, numero, cidade, estado, cep,
    status, status_mode, ac, product, enrollment_date, data_treinamento_origem,
    due_day, sale_value, down_payment, total_installments, paid_installments,
    installment_value, installments, history, tags, detalhes, kamino_synced_at
  )
  SELECT
    gen_random_uuid(), v_company, k.name,
    coalesce(nullif(k.whatsapp, ''), (SELECT nullif(s2.whatsapp, '') FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name)) ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1), ''),
    coalesce(k.email, (SELECT s2.email FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name)) AND s2.email IS NOT NULL ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1)),
    coalesce((SELECT nullif(s2.cpf, '') FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name)) ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1), ''),
    '', '', '', '', '',
    k.status, 'Automático',
    coalesce(nullif(k.ac, ''), (SELECT nullif(trim(s2.ac), '') FROM public.students s2 WHERE lower(trim(s2.name)) = lower(trim(k.name)) ORDER BY s2.updated_at DESC NULLS LAST LIMIT 1), ''),
    k.product, k.enrollment_date::text, coalesce(k.data_treinamento_origem::text, k.enrollment_date::text), k.due_day,
    k.sale_value, k.down_payment, k.total_installments, k.paid_installments,
    k.installment_value, k.installments, '[]'::jsonb, '[]'::jsonb, k.detalhes, now()
  FROM public._kamino_sync_staging k
  WHERE NOT EXISTS (SELECT 1 FROM public.students s WHERE public.gc_student_key(s.name, s.product) = k.skey);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO matched_ids (id)
  SELECT s.id FROM public.students s
  JOIN public._kamino_sync_staging k ON public.gc_student_key(s.name, s.product) = k.skey
  ON CONFLICT DO NOTHING;

  UPDATE public.students s SET
    sale_value = k.sale_value, down_payment = k.down_payment,
    total_installments = k.total_installments, paid_installments = k.paid_installments,
    installment_value = k.installment_value, installments = k.installments,
    due_day = k.due_day, detalhes = k.detalhes,
    kamino_synced_at = now(),
    whatsapp = coalesce(nullif(k.whatsapp, ''), s.whatsapp, ''),
    email = coalesce(k.email, s.email),
    ac = coalesce(nullif(trim(s.ac), ''), k.ac, ''),
    updated_at = now()
  FROM public._kamino_sync_staging k
  WHERE s.id = ANY(v_protected)
    AND public.gc_student_key(s.name, s.product) = k.skey
    AND s.id NOT IN (SELECT id FROM matched_ids);

  DELETE FROM public.conciliacao_import_errors e USING public.students s
  WHERE e.student_id = s.id AND NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);

  DELETE FROM public.conciliacao_items i USING public.students s
  WHERE i.student_id = s.id AND NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);

  DELETE FROM public.students s
  WHERE NOT (s.id = ANY(v_protected))
    AND s.id NOT IN (SELECT id FROM matched_ids)
    AND public.gc_student_key(s.name, s.product) NOT IN (SELECT skey FROM public._kamino_sync_staging);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.cancellation_cases cc SET
    ac = coalesce(nullif(trim(cc.ac), ''), s.ac),
    student_name = coalesce(s.name, cc.student_name),
    updated_at = now()
  FROM public.students s WHERE cc.student_id = s.id;

  RETURN jsonb_build_object(
    'updated', v_updated, 'inserted', v_inserted, 'deleted', v_deleted,
    'students_final', (SELECT count(*) FROM public.students),
    'cancel_cases', (SELECT count(*) FROM public.cancellation_cases),
    'staging', (SELECT count(*) FROM public._kamino_sync_staging)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_control_upsert_one_contract(
  p jsonb,
  p_produto text,
  p_treinamento jsonb,
  p_data_matricula text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_iam_id       bigint  := nullif(p->>'iam_control_aluno_id', '')::bigint;
  v_nome         text    := btrim(coalesce(p->>'nome', ''));
  v_email        text    := coalesce(p->>'email', '');
  v_whatsapp     text    := coalesce(p->>'whatsapp', '');
  v_cpf          text    := coalesce(p->>'cpf', '');
  v_cpf_digits   text    := regexp_replace(v_cpf, '[^0-9]', '', 'g');
  v_end          jsonb   := coalesce(p->'endereco', '{}'::jsonb);
  v_produto      text    := btrim(coalesce(p_produto, ''));
  v_data_matric  text    := coalesce(left(p_data_matricula, 10), left(p_treinamento->>'data_venda', 10), '');
  v_fin          record;
  v_student_id   uuid;
  v_matched_by   text    := null;
  v_empatados    int     := 0;
  v_acao         text;
  v_company_id   uuid;
  v_contrato_id  text    := nullif(btrim(coalesce(p_treinamento->>'contrato_id', '')), '');
  v_status       text    := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_pend_tipo    text    := upper(nullif(btrim(coalesce(p_treinamento->>'pendente_tipo', '')), ''));
  v_pend_link    text    := nullif(btrim(coalesce(p_treinamento->>'pendente_link', '')), '');
  v_sem_parcelas boolean;
  v_kamino       boolean;
BEGIN
  IF v_produto = '' OR public.product_excluded_from_gc(v_produto) THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'treinamento vazio ou fora do GC', 'produto', v_produto);
  END IF;

  v_company_id := public.resolve_gc_company_id(v_produto);

  IF v_status IS DISTINCT FROM 'PENDENTE' THEN
    v_pend_tipo := NULL;
    v_pend_link := NULL;
  ELSIF v_pend_tipo IS DISTINCT FROM 'LINK' THEN
    v_pend_link := NULL;
  END IF;

  SELECT * INTO v_fin FROM public.iam_treinamento_financeiro(p_treinamento) LIMIT 1;

  IF length(v_cpf_digits) >= 11 THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.cpf_digits = v_cpf_digits
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'cpf_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'iam_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND coalesce(btrim(s.product), '') = ''
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'iam_sem_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL THEN
    SELECT r.id, r.empatados
    INTO v_student_id, v_empatados
    FROM (
      SELECT c.id,
             c.pontos,
             count(*) OVER (PARTITION BY c.pontos) AS empatados
      FROM (
        SELECT s.id,
               (CASE WHEN public.iam_normalize_phone(v_whatsapp) <> ''
                      AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp)
                     THEN 2 ELSE 0 END)
             + (CASE WHEN public.iam_normalize_email(v_email) <> ''
                      AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email)
                     THEN 2 ELSE 0 END)
             + (CASE WHEN public.iam_normalize_name(v_nome) <> ''
                      AND public.iam_normalize_name(s.name) = public.iam_normalize_name(v_nome)
                     THEN 1 ELSE 0 END) AS pontos
        FROM public.students s
        WHERE s.company_id = v_company_id
          AND s.iam_control_aluno_id IS NULL
          AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
          AND (
            (public.iam_normalize_phone(v_whatsapp) <> ''
             AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp))
         OR (public.iam_normalize_email(v_email) <> ''
             AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email))
          )
      ) c
      WHERE c.pontos >= 3
    ) r
    ORDER BY r.pontos DESC
    LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      IF v_empatados > 1 THEN
        RETURN jsonb_build_object(
          'acao', 'ambiguo',
          'iam_control_aluno_id', v_iam_id,
          'produto', v_produto,
          'motivo', v_empatados || ' cadastros conferem com os mesmos dados'
        );
      END IF;
      v_matched_by := 'identidade';
    END IF;
  END IF;

  IF v_student_id IS NOT NULL THEN
    SELECT
      coalesce(jsonb_array_length(s.installments), 0) = 0,
      s.kamino_synced_at IS NOT NULL
    INTO v_sem_parcelas, v_kamino
    FROM public.students s
    WHERE s.id = v_student_id;

    UPDATE public.students s SET
      company_id                  = v_company_id,
      iam_control_aluno_id        = coalesce(v_iam_id, s.iam_control_aluno_id),
      iam_control_synced_at       = now(),
      iam_control_contrato_id     = coalesce(v_contrato_id, s.iam_control_contrato_id),
      iam_control_contrato_status = coalesce(v_status, s.iam_control_contrato_status),
      iam_control_pendente_tipo   = v_pend_tipo,
      iam_control_pendente_link   = v_pend_link,
      name                        = v_nome,
      email                       = coalesce(nullif(v_email, ''), s.email),
      whatsapp                    = coalesce(nullif(v_whatsapp, ''), s.whatsapp),
      cpf                         = coalesce(nullif(v_cpf, ''), s.cpf),
      address                     = coalesce(nullif(v_end->>'logradouro', ''), s.address),
      numero                      = coalesce(nullif(v_end->>'numero', ''), s.numero),
      cidade                      = coalesce(nullif(v_end->>'cidade', ''), s.cidade),
      estado                      = coalesce(nullif(v_end->>'estado', ''), s.estado),
      cep                         = coalesce(nullif(v_end->>'cep', ''), s.cep),
      product                     = v_produto,
      enrollment_date             = coalesce(nullif(v_data_matric, ''), s.enrollment_date),
      data_treinamento_origem     = coalesce(nullif(v_data_matric, ''), s.data_treinamento_origem),
      status                      = CASE
        WHEN v_kamino THEN s.status
        WHEN v_status = 'PENDENTE' THEN 'Pendente'
        ELSE s.status
      END,
      sale_value                  = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.sale_value ELSE s.sale_value END,
      down_payment                = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.down_payment ELSE s.down_payment END,
      total_installments          = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.total_installments ELSE s.total_installments END,
      installment_value           = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.installment_value ELSE s.installment_value END,
      installments                = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.installments ELSE s.installments END,
      paid_installments           = CASE WHEN NOT v_kamino AND v_sem_parcelas THEN v_fin.paid_installments ELSE s.paid_installments END
    WHERE s.id = v_student_id;

    v_acao := 'atualizado';
  ELSE
    INSERT INTO public.students (
      company_id,
      iam_control_aluno_id, iam_control_synced_at,
      iam_control_contrato_id, iam_control_contrato_status,
      iam_control_pendente_tipo, iam_control_pendente_link,
      name, email, whatsapp, cpf,
      address, numero, cidade, estado, cep,
      product, enrollment_date, data_treinamento_origem,
      status, status_mode,
      sale_value, down_payment, total_installments, installment_value,
      installments, paid_installments
    ) VALUES (
      v_company_id,
      v_iam_id, now(),
      v_contrato_id, v_status, v_pend_tipo, v_pend_link,
      v_nome, nullif(v_email, ''), v_whatsapp, v_cpf,
      coalesce(v_end->>'logradouro', ''), coalesce(v_end->>'numero', ''),
      coalesce(v_end->>'cidade', ''), coalesce(v_end->>'estado', ''), coalesce(v_end->>'cep', ''),
      v_produto, nullif(v_data_matric, ''), nullif(v_data_matric, ''),
      CASE WHEN v_status = 'PENDENTE' THEN 'Pendente' ELSE 'Aluno Novo' END,
      'Automático',
      0, 0, 0, 0,
      '[]'::jsonb, 0
    )
    RETURNING id INTO v_student_id;

    v_acao := 'criado';
    v_matched_by := 'novo';
  END IF;

  RETURN jsonb_build_object(
    'acao', v_acao,
    'student_id', v_student_id,
    'iam_control_aluno_id', v_iam_id,
    'produto', v_produto,
    'company_id', v_company_id,
    'casado_por', v_matched_by,
    'status_conciliacao', v_status,
    'pendente_tipo', v_pend_tipo
  );
END;
$function$;

COMMENT ON FUNCTION public.iam_control_upsert_one_contract(jsonb, text, jsonb, text) IS
  'Upsert IAM→GC: cadastro e pendência. Financeiro só entra via sync Kamino (kamino_synced_at).';

-- Marca fichas já sincronizadas pela última carga Kamino (staging ainda populada).
UPDATE public.students s
SET kamino_synced_at = now()
FROM public._kamino_sync_staging k
WHERE public.gc_student_key(s.name, s.product) = k.skey
  AND s.kamino_synced_at IS NULL;

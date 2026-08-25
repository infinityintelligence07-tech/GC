-- Tópico 2: quando a ficha existe na Kamino, o financeiro do GC segue a planilha.
-- Corrige divergências atuais e impede o IAM de sobrescrever parcelas Kamino.

UPDATE public.students s
SET
  sale_value          = k.sale_value,
  down_payment        = k.down_payment,
  total_installments  = k.total_installments,
  paid_installments   = k.paid_installments,
  installment_value   = k.installment_value,
  installments        = k.installments,
  due_day             = k.due_day,
  detalhes            = k.detalhes,
  updated_at          = now()
FROM public._kamino_sync_staging k
WHERE public.gc_student_key(s.name, s.product) = k.skey
  AND (
    s.installments::text IS DISTINCT FROM k.installments::text
    OR s.sale_value IS DISTINCT FROM k.sale_value
    OR s.total_installments IS DISTINCT FROM k.total_installments
    OR s.paid_installments IS DISTINCT FROM k.paid_installments
    OR s.installment_value IS DISTINCT FROM k.installment_value
  );

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

  IF v_status = 'NOVO' THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'status NOVO não importado no GC',
      'iam_control_aluno_id', v_iam_id,
      'produto', v_produto,
      'status_conciliacao', v_status
    );
  END IF;

  v_company_id := public.resolve_gc_company_id(v_produto);

  SELECT EXISTS (
    SELECT 1 FROM public._kamino_sync_staging k
    WHERE k.skey = public.gc_student_key(v_nome, v_produto)
  ) INTO v_kamino;

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
    IF NOT v_kamino THEN
      SELECT EXISTS (
        SELECT 1 FROM public._kamino_sync_staging k
        JOIN public.students s ON k.skey = public.gc_student_key(s.name, s.product)
        WHERE s.id = v_student_id
      ) INTO v_kamino;
    END IF;

    SELECT coalesce(jsonb_array_length(s.installments), 0) = 0
    INTO v_sem_parcelas
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
      sale_value                  = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.sale_value ELSE v_fin.sale_value END,
      down_payment                = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.down_payment ELSE v_fin.down_payment END,
      total_installments          = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.total_installments ELSE v_fin.total_installments END,
      installment_value           = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.installment_value ELSE v_fin.installment_value END,
      installments                = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.installments ELSE v_fin.installments END,
      paid_installments           = CASE WHEN v_kamino OR NOT v_sem_parcelas THEN s.paid_installments ELSE v_fin.paid_installments END
    WHERE s.id = v_student_id;

    v_acao := 'atualizado';
  ELSE
    IF v_kamino THEN
      RETURN jsonb_build_object(
        'acao', 'ignorado',
        'motivo', 'ficha Kamino existente — financeiro não vem do IAM',
        'iam_control_aluno_id', v_iam_id,
        'produto', v_produto
      );
    END IF;

    INSERT INTO public.students (
      company_id,
      iam_control_aluno_id, iam_control_synced_at,
      iam_control_contrato_id, iam_control_contrato_status,
      iam_control_pendente_tipo, iam_control_pendente_link,
      name, email, whatsapp, cpf,
      address, numero, cidade, estado, cep,
      product, enrollment_date, data_treinamento_origem,
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
      v_fin.sale_value, v_fin.down_payment, v_fin.total_installments, v_fin.installment_value,
      v_fin.installments, v_fin.paid_installments
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
    'pendente_tipo', v_pend_tipo,
    'kamino_protegido', v_kamino
  );
END;
$function$;

COMMENT ON FUNCTION public.iam_control_upsert_one_contract(jsonb, text, jsonb, text) IS
  'Upsert IAM→GC. Ignora NOVO. Financeiro preservado quando a ficha existe na staging Kamino.';

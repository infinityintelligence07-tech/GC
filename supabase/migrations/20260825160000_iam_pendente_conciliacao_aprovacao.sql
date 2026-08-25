-- Aprovação GC de contratos IAM PENDENTE antes de entrar nos totais financeiros.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS iam_gc_conciliado_at timestamptz;

COMMENT ON COLUMN public.students.iam_gc_conciliado_at IS
  'Data em que a Conciliação GC aprovou contrato IAM PENDENTE. Enquanto NULL, não entra nos totais.';

CREATE INDEX IF NOT EXISTS students_iam_gc_conciliado_at_idx
  ON public.students (iam_gc_conciliado_at)
  WHERE iam_gc_conciliado_at IS NOT NULL;

-- Patch: upsert IAM não reverte aprovação GC nem força Pendente de novo.
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
  v_is_pendente  boolean;
  v_ac_atual     text;
  v_ac_novo      text;
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
  v_is_pendente := v_status = 'PENDENTE';

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
    IF v_student_id IS NOT NULL THEN v_matched_by := 'cpf_produto'; END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'iam_produto'; END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND coalesce(btrim(s.product), '') = ''
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'iam_sem_produto'; END IF;
  END IF;

  IF v_student_id IS NOT NULL THEN
    IF NOT v_kamino THEN
      SELECT EXISTS (
        SELECT 1 FROM public._kamino_sync_staging k
        JOIN public.students s ON k.skey = public.gc_student_key(s.name, s.product)
        WHERE s.id = v_student_id
      ) INTO v_kamino;
    END IF;

    SELECT coalesce(jsonb_array_length(s.installments), 0) = 0,
           nullif(btrim(coalesce(s.ac, '')), '')
    INTO v_sem_parcelas, v_ac_atual
    FROM public.students s
    WHERE s.id = v_student_id;

    IF v_ac_atual IS NULL THEN
      v_ac_novo := public.next_ac_from_esteira(v_company_id, v_cpf, v_produto, NULL, v_student_id);
    END IF;

    UPDATE public.students s SET
      company_id                  = v_company_id,
      iam_control_aluno_id        = coalesce(v_iam_id, s.iam_control_aluno_id),
      iam_control_synced_at       = now(),
      iam_control_contrato_id     = coalesce(v_contrato_id, s.iam_control_contrato_id),
      iam_control_contrato_status = CASE
                                      WHEN v_is_pendente AND s.iam_gc_conciliado_at IS NOT NULL THEN 'CONCILIADO'
                                      ELSE coalesce(v_status, s.iam_control_contrato_status)
                                    END,
      iam_control_pendente_tipo   = v_pend_tipo,
      iam_control_pendente_link   = v_pend_link,
      iam_gc_conciliado_at        = CASE
                                      WHEN upper(coalesce(v_status, '')) = 'CONCILIADO'
                                        THEN coalesce(s.iam_gc_conciliado_at, now())
                                      ELSE s.iam_gc_conciliado_at
                                    END,
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
      ac                          = coalesce(v_ac_atual, v_ac_novo, s.ac),
      status                      = CASE
                                      WHEN v_is_pendente AND s.iam_gc_conciliado_at IS NULL THEN 'Pendente'
                                      ELSE s.status
                                    END,
      status_mode                 = CASE
                                      WHEN v_is_pendente AND s.iam_gc_conciliado_at IS NULL THEN 'Manual'
                                      WHEN upper(coalesce(v_status, '')) = 'CONCILIADO' OR s.iam_gc_conciliado_at IS NOT NULL THEN 'Automático'
                                      ELSE s.status_mode
                                    END,
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
      CASE WHEN v_is_pendente THEN 'Pendente' ELSE 'Aluno Novo' END,
      CASE WHEN v_is_pendente THEN 'Manual' ELSE 'Automático' END,
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
    'kamino_protegido', v_kamino,
    'ac_atribuido', coalesce(v_ac_atual, v_ac_novo)
  );
END;
$function$;

COMMENT ON FUNCTION public.iam_control_upsert_one_contract(jsonb, text, jsonb, text) IS
  'Upsert IAM→GC. PENDENTE aguarda aprovação GC (iam_gc_conciliado_at) antes de contar nos totais.';

-- IAM Control envia status_conciliacao como PENDENTE_LINK / PENDENTE_PIX (não só PENDENTE).
-- O GC tratava como quitado → financeiro errado e fila de Conciliação vazia.

CREATE OR REPLACE FUNCTION public.iam_status_is_pendente(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(btrim(coalesce(p_status, ''))) IN ('PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX')
    OR upper(btrim(coalesce(p_status, ''))) LIKE 'PENDENTE\_%' ESCAPE '\';
$$;

CREATE OR REPLACE FUNCTION public.iam_extract_pendente_tipo(p_status text, p_tipo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    nullif(upper(btrim(coalesce(p_tipo, ''))), ''),
    CASE upper(btrim(coalesce(p_status, '')))
      WHEN 'PENDENTE_LINK' THEN 'LINK'
      WHEN 'PENDENTE_PIX' THEN 'PIX'
      ELSE NULL
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.iam_forma_is_pendencia(p_fp jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_fp->>'pendencia', p_fp->>'pendência', '') IN ('true', '1', 'sim', 'TRUE')
    OR btrim(coalesce(p_fp->>'status', '')) ILIKE '%pendente%'
    OR btrim(coalesce(p_fp->>'forma', '')) ILIKE '%(pendência)%'
    OR btrim(coalesce(p_fp->>'forma', '')) ILIKE '%(pendencia)%';
$$;

COMMENT ON FUNCTION public.iam_status_is_pendente(text) IS
  'True para PENDENTE, PENDENTE_LINK, PENDENTE_PIX e variantes.';
COMMENT ON FUNCTION public.iam_extract_pendente_tipo(text, text) IS
  'Extrai LINK/PIX do campo pendente_tipo ou do sufixo do status_conciliacao.';
COMMENT ON FUNCTION public.iam_forma_is_pendencia(jsonb) IS
  'Forma de pagamento IAM marcada como pendência (ex.: cartão crédito aguardando).';

-- ─── Financeiro: reconhecer PENDENTE_* e separar pago vs pendente ─────────────
CREATE OR REPLACE FUNCTION public.iam_treinamento_financeiro(p_treinamento jsonb)
RETURNS TABLE (
  sale_value numeric,
  down_payment numeric,
  total_installments int,
  installment_value numeric,
  installments jsonb,
  paid_installments int
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sale numeric := coalesce(nullif(p_treinamento->>'valor_total', '')::numeric, 0);
  v_down numeric := 0;
  v_parcelado numeric := 0;
  v_parcelas int;
  v_data_venda text := coalesce(left(p_treinamento->>'data_venda', 10), '');
  v_fp jsonb;
  v_formas jsonb := coalesce(p_treinamento->'formas_pagamento', '[]'::jsonb);
  v_i int;
  v_forma text;
  v_valor numeric;
  v_valor_parcela numeric;
  v_parcelas_pagas int;
  v_detalhe jsonb := coalesce(p_treinamento->'parcelas_detalhe', '[]'::jsonb);
  v_detalhe_len int := coalesce(jsonb_array_length(v_detalhe), 0);
  v_status text := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_pendente boolean := public.iam_status_is_pendente(v_status);
  v_base date := coalesce(nullif(left(v_data_venda, 10), '')::date, current_date);
  v_inst jsonb := '[]'::jsonb;
  v_entrada_restante numeric := 0;
  v_valor_pago numeric := coalesce(nullif(p_treinamento->>'valor_pago', '')::numeric, 0);
  v_valor_pendente numeric := coalesce(nullif(p_treinamento->>'valor_pendente', '')::numeric, 0);
  v_sum_inst numeric := 0;
  v_first numeric := 0;
  v_modalidade text := upper(coalesce(
    p_treinamento->>'modalidade_pagamento',
    p_treinamento->>'tipo_pagamento',
    ''
  ));
  v_fp_parcelas int;
  v_forma_pendente boolean;
BEGIN
  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    v_fp_parcelas := coalesce(nullif(v_fp->>'parcelas', '')::int, 0);
    v_forma_pendente := public.iam_forma_is_pendencia(v_fp);

    IF v_pendente AND v_forma_pendente THEN
      v_entrada_restante := v_entrada_restante + v_valor;
    ELSIF coalesce(v_fp->>'a_vista', '') IN ('true', '1', 'sim', 'TRUE')
       OR btrim(coalesce(v_fp->>'modalidade', '')) ILIKE '%vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%à vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%a vista%' THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_entrada(v_forma) THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_parcelado(v_forma) THEN
      IF NOT v_pendente AND v_fp_parcelas = 1 THEN
        v_down := v_down + v_valor;
      ELSE
        v_parcelado := v_parcelado + v_valor;
      END IF;
    END IF;
  END LOOP;

  IF nullif(p_treinamento->>'valor_entrada', '') IS NOT NULL THEN
    v_down := (p_treinamento->>'valor_entrada')::numeric;
  END IF;

  IF v_pendente AND v_parcelado > 0.0049 AND v_down > v_sale - v_parcelado + 0.01 THEN
    v_down := round(greatest(v_sale - v_parcelado, 0), 2);
  END IF;

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;

  IF v_pendente AND v_valor_pendente > 0.0049 AND v_valor_pendente < v_sale - 0.01 THEN
    IF v_entrada_restante < 0.01 THEN
      v_entrada_restante := round(v_valor_pendente, 2);
    END IF;
    IF v_valor_pago > 0.0049 THEN
      v_down := round(v_valor_pago, 2);
    ELSIF v_entrada_restante >= v_valor_pendente - 0.01 THEN
      v_down := 0;
    END IF;
  END IF;

  IF v_pendente AND v_entrada_restante < 0.01 AND v_down > 0.0049 THEN
    IF v_valor_pago >= v_down - 0.01 THEN
      NULL;
    ELSE
      v_entrada_restante := round(v_down, 2);
      v_down := 0;
    END IF;
  END IF;

  IF v_detalhe_len > 0 THEN
    v_parcelas := v_detalhe_len;
    v_valor_parcela := coalesce(nullif(v_detalhe->>0, '')::numeric, 0);
    IF v_parcelas > 0 THEN
      v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
    END IF;
    v_inst := public.iam_build_installments_from_values(v_detalhe, v_data_venda, v_parcelas_pagas);
  ELSE
    v_parcelas := nullif(p_treinamento->>'parcelas', '')::int;
    IF v_parcelas IS NULL OR v_parcelas < 1 THEN
      IF v_parcelado > 0 AND (v_sale - coalesce(nullif(v_entrada_restante, 0), v_down) ) > 0.01 THEN
        v_parcelas := 1;
      ELSE
        v_parcelas := 0;
      END IF;
    END IF;

    v_valor_parcela := coalesce(nullif(p_treinamento->>'valor_parcela', '')::numeric, 0);
    IF v_valor_parcela <= 0 THEN
      v_valor_parcela := CASE
        WHEN v_parcelas > 0 THEN
          round(greatest(v_sale - CASE WHEN v_entrada_restante > 0 THEN v_entrada_restante ELSE v_down END, 0) / v_parcelas, 2)
        ELSE 0
      END;
    END IF;

    IF v_parcelas > 0 THEN
      v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
    END IF;

    IF v_parcelas > 0 AND v_valor_parcela > 0 THEN
      v_inst := public.iam_build_installments_from_values(
        (
          SELECT coalesce(jsonb_agg(round(v_valor_parcela, 2)), '[]'::jsonb)
          FROM generate_series(1, v_parcelas) AS gs(i)
        ),
        v_data_venda,
        v_parcelas_pagas
      );
    ELSE
      v_inst := public.iam_build_installments(
        v_sale,
        CASE WHEN v_entrada_restante > 0 THEN 0 ELSE v_down END,
        v_parcelas,
        v_data_venda
      );
    END IF;
  END IF;

  SELECT coalesce(sum((elem->>'value')::numeric), 0)
  INTO v_sum_inst
  FROM jsonb_array_elements(coalesce(v_inst, '[]'::jsonb)) elem;

  v_first := coalesce((v_inst->0->>'value')::numeric, 0);

  IF v_pendente
     AND v_entrada_restante >= v_sale - 0.01
     AND coalesce(v_parcelas, 0) > 1 THEN
    IF v_valor_parcela > 0 THEN
      v_entrada_restante := round(greatest(v_sale - v_valor_parcela * v_parcelas, 0), 2);
    ELSIF v_parcelado > 0.0049 THEN
      v_entrada_restante := round(greatest(v_sale - v_parcelado, 0), 2);
    END IF;
  END IF;

  IF v_down > 0.0049 AND v_entrada_restante < 0.01 AND v_sale > 0 THEN
    IF abs(v_sum_inst - v_sale) < 0.05 AND abs(v_first - v_down) < 0.05 THEN
      v_inst := coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb(rn::int))
          ORDER BY rn
        )
        FROM (
          SELECT elem, row_number() OVER (ORDER BY ord) AS rn
          FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(elem, ord)
          WHERE ord > 1
        ) x
      ), '[]'::jsonb);
      SELECT coalesce(sum((elem->>'value')::numeric), 0)
      INTO v_sum_inst
      FROM jsonb_array_elements(v_inst) elem;
    ELSIF v_sum_inst + v_down > v_sale + 0.05 AND abs(v_sum_inst - (v_sale - v_down)) > 0.05 THEN
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', round(greatest(v_sale - v_down, 0), 2),
          'dueDate', (v_base + interval '1 month')::date::text,
          'paid', false
        )
      );
      v_sum_inst := round(greatest(v_sale - v_down, 0), 2);
      v_parcelas_pagas := 0;
    END IF;
  END IF;

  IF v_entrada_restante > 0.0049 THEN
    IF abs(v_sum_inst - v_sale) < 0.05 THEN
      IF abs(v_first - v_entrada_restante) < 0.05 THEN
        v_inst := jsonb_set(
          v_inst,
          '{0,tags}',
          coalesce(v_inst->0->'tags', '[]'::jsonb) || '"entrada-pendente"'::jsonb
        );
      END IF;
    ELSIF abs(v_sum_inst - (v_sale - v_entrada_restante)) < 0.05
       OR abs(v_sum_inst + v_entrada_restante - v_sale) < 0.05
       OR v_sum_inst < 0.01 THEN
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', v_entrada_restante,
          'dueDate', v_base::text,
          'paid', false,
          'tags', jsonb_build_array('entrada-pendente')
        )
      ) || coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb((elem->>'number')::int + 1))
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(v_inst) elem
      ), '[]'::jsonb);
      v_parcelas_pagas := 0;
    ELSIF v_sum_inst + v_entrada_restante > v_sale + 0.05 THEN
      IF abs(v_first - v_entrada_restante) < 0.05 THEN
        v_inst := jsonb_set(
          v_inst,
          '{0,tags}',
          coalesce(v_inst->0->'tags', '[]'::jsonb) || '"entrada-pendente"'::jsonb
        );
      END IF;
    ELSE
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', v_entrada_restante,
          'dueDate', v_base::text,
          'paid', false,
          'tags', jsonb_build_array('entrada-pendente')
        )
      ) || coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb((elem->>'number')::int + 1))
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(v_inst) elem
      ), '[]'::jsonb);
      v_parcelas_pagas := 0;
    END IF;
  END IF;

  IF NOT v_pendente AND v_sale > 0.0049 THEN
    IF v_valor_pago >= v_sale - 0.01
       OR v_down >= v_sale - 0.01
       OR v_modalidade LIKE '%VISTA%' THEN
      sale_value := v_sale;
      down_payment := round(v_sale, 2);
      total_installments := 0;
      installment_value := 0;
      installments := '[]'::jsonb;
      paid_installments := 0;
      RETURN NEXT;
      RETURN;
    END IF;

    IF coalesce(v_parcelas, 0) > 0 AND v_parcelas_pagas >= v_parcelas THEN
      installments := coalesce((
        SELECT jsonb_agg(
          jsonb_set(
            jsonb_set(elem, '{paid}', 'true'::jsonb),
            '{paidDate}',
            to_jsonb(coalesce(elem->>'paidDate', v_base::text))
          )
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(coalesce(v_inst, '[]'::jsonb)) elem
      ), '[]'::jsonb);
      sale_value := v_sale;
      down_payment := round(v_down, 2);
      total_installments := coalesce(jsonb_array_length(installments), v_parcelas, 0);
      installment_value := round(coalesce(nullif((installments->0->>'value')::numeric, 0), v_valor_parcela, 0), 2);
      paid_installments := v_parcelas;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  sale_value := v_sale;
  down_payment := round(v_down, 2);
  total_installments := coalesce(jsonb_array_length(v_inst), v_parcelas, 0);
  installment_value := round(coalesce(
    nullif((v_inst->0->>'value')::numeric, 0),
    v_valor_parcela,
    0
  ), 2);
  installments := coalesce(v_inst, '[]'::jsonb);
  paid_installments := v_parcelas_pagas;
  RETURN NEXT;
END;
$$;

-- ─── Upsert: normalizar PENDENTE_LINK/PIX ────────────────────────────────────
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
  v_quitado      boolean;
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
  v_is_pendente := public.iam_status_is_pendente(v_status);
  IF v_is_pendente THEN
    v_pend_tipo := public.iam_extract_pendente_tipo(v_status, v_pend_tipo);
    v_status := 'PENDENTE';
  END IF;

  v_quitado := upper(coalesce(v_status, '')) = 'CONCILIADO'
    AND public.iam_conciliado_quitado(p_treinamento);

  SELECT EXISTS (
    SELECT 1 FROM public._kamino_sync_staging k
    WHERE k.skey = public.gc_student_key(v_nome, v_produto)
  ) INTO v_kamino;

  IF NOT v_is_pendente THEN
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
                                      WHEN v_quitado THEN coalesce(s.iam_gc_conciliado_at, now())
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
                                      WHEN s.iam_gc_conciliado_at IS NOT NULL OR v_quitado THEN 'Automático'
                                      ELSE s.status_mode
                                    END,
      sale_value                  = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.sale_value ELSE v_fin.sale_value END,
      down_payment                = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.down_payment ELSE v_fin.down_payment END,
      total_installments          = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.total_installments ELSE v_fin.total_installments END,
      installment_value           = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.installment_value ELSE v_fin.installment_value END,
      installments                = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.installments ELSE v_fin.installments END,
      paid_installments           = CASE WHEN v_kamino OR (NOT v_sem_parcelas AND NOT v_is_pendente) THEN s.paid_installments ELSE v_fin.paid_installments END
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
      iam_gc_conciliado_at,
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
      CASE WHEN v_quitado THEN now() ELSE NULL END,
      v_nome, nullif(v_email, ''), v_whatsapp, v_cpf,
      coalesce(v_end->>'logradouro', ''), coalesce(v_end->>'numero', ''),
      coalesce(v_end->>'cidade', ''), coalesce(v_end->>'estado', ''), coalesce(v_end->>'cep', ''),
      v_produto, nullif(v_data_matric, ''), nullif(v_data_matric, ''),
      CASE WHEN v_is_pendente THEN 'Pendente' ELSE 'Aluno Novo' END,
      CASE WHEN v_is_pendente OR NOT v_quitado THEN 'Manual' ELSE 'Automático' END,
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

-- ─── Backfill: normalizar status + corrigir financeiro quebrado ──────────────
UPDATE public.students s
SET
  iam_control_contrato_status = 'PENDENTE',
  iam_control_pendente_tipo = public.iam_extract_pendente_tipo(s.iam_control_contrato_status, s.iam_control_pendente_tipo),
  status = CASE WHEN s.iam_gc_conciliado_at IS NULL THEN 'Pendente' ELSE s.status END,
  status_mode = CASE WHEN s.iam_gc_conciliado_at IS NULL THEN 'Manual' ELSE s.status_mode END
WHERE s.iam_control_aluno_id IS NOT NULL
  AND public.iam_status_is_pendente(s.iam_control_contrato_status)
  AND upper(coalesce(s.iam_control_contrato_status, '')) <> 'PENDENTE';

UPDATE public.students s
SET
  down_payment = round(greatest(coalesce(s.sale_value, 0) - coalesce(s.sale_value, 0), 0), 2),
  total_installments = 1,
  installment_value = coalesce(s.sale_value, 0),
  paid_installments = 0,
  installments = jsonb_build_array(
    jsonb_build_object(
      'number', 1,
      'value', coalesce(s.sale_value, 0),
      'dueDate', coalesce(nullif(s.enrollment_date, ''), current_date::text),
      'paid', false,
      'tags', jsonb_build_array('entrada-pendente')
    )
  )
WHERE s.iam_control_aluno_id IS NOT NULL
  AND public.iam_status_is_pendente(s.iam_control_contrato_status)
  AND s.iam_gc_conciliado_at IS NULL
  AND coalesce(s.sale_value, 0) > 0.01
  AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01
  AND coalesce(jsonb_array_length(s.installments), 0) = 0;

-- Caso conhecido: Dave Gray — débito R$197 pago + crédito R$2364 pendente
UPDATE public.students s
SET
  down_payment = 197,
  total_installments = 1,
  installment_value = 2364,
  paid_installments = 0,
  installments = jsonb_build_array(
    jsonb_build_object(
      'number', 1,
      'value', 2364,
      'dueDate', coalesce(nullif(s.enrollment_date, ''), '2026-06-02'),
      'paid', false,
      'tags', jsonb_build_array('entrada-pendente')
    )
  ),
  status = 'Pendente',
  status_mode = 'Manual',
  iam_control_contrato_status = 'PENDENTE',
  iam_control_pendente_tipo = 'LINK'
WHERE s.id = '3bb943f3-780f-483a-8bad-c965de4ec167';

-- Fila Conciliação IAM → GC
INSERT INTO public.conciliacao_items (
  company_id, tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status
)
SELECT
  s.company_id,
  'iam_pendente',
  s.id,
  s.name,
  s.ac,
  CASE
    WHEN upper(coalesce(s.iam_control_contrato_status, '')) = 'PENDENTE'
         AND upper(coalesce(s.iam_control_pendente_tipo, '')) = 'LINK' THEN 'IAM Control — Pendente Link'
    WHEN upper(coalesce(s.iam_control_contrato_status, '')) = 'PENDENTE'
         AND upper(coalesce(s.iam_control_pendente_tipo, '')) = 'PIX' THEN 'IAM Control — Pendente PIX'
    WHEN upper(coalesce(s.iam_control_contrato_status, '')) = 'PARA_CONCILIAR' THEN 'IAM Control — Para Conciliar'
    WHEN upper(coalesce(s.iam_control_contrato_status, '')) = 'CONCILIADO' THEN 'IAM Control — Conciliado (aguarda aprovação GC)'
    ELSE 'IAM Control — ' || replace(upper(coalesce(s.iam_control_contrato_status, '')), '_', ' ')
  END,
  jsonb_build_object(
    'iam_control_contrato_status', upper(coalesce(s.iam_control_contrato_status, ''))
  ),
  jsonb_build_object(
    'iam_control_contrato_status', 'CONCILIADO',
    'pendente_tipo', s.iam_control_pendente_tipo,
    'pendente_link', s.iam_control_pendente_link,
    'sale_value', s.sale_value,
    'down_payment', s.down_payment,
    'total_installments', s.total_installments,
    'product', s.product
  ),
  'Sistema IAM',
  'pendente'
FROM public.students s
WHERE s.iam_control_aluno_id IS NOT NULL
  AND (
    public.iam_status_is_pendente(s.iam_control_contrato_status)
    OR upper(coalesce(s.iam_control_contrato_status, '')) IN ('CONCILIADO', 'PARA_CONCILIAR')
  )
  AND s.iam_gc_conciliado_at IS NULL
  AND NOT public.iam_student_conciliado_quitado(
    s.sale_value, s.down_payment, s.total_installments, s.paid_installments, s.installments
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.conciliacao_items ci
    WHERE ci.student_id = s.id
      AND ci.tipo = 'iam_pendente'
      AND ci.status IN ('pendente', 'aprovado')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.conciliacao_items ci
    WHERE ci.student_id = s.id
      AND ci.tipo = 'iam_pendente'
      AND ci.status = 'conciliado'
  );

-- Funções de reparo para CONCILIADO quitado (à vista / cartão pago integral).

CREATE OR REPLACE FUNCTION public.iam_repair_conciliado_quitado(
  p_treinamento jsonb,
  p_iam_aluno_id bigint,
  p_produto text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_fin record;
  v_student_id uuid;
  v_company_id uuid;
  v_produto text := btrim(coalesce(p_produto, ''));
  v_quitado boolean := false;
  v_aberto numeric := 0;
BEGIN
  IF v_status IS DISTINCT FROM 'CONCILIADO' OR p_iam_aluno_id IS NULL OR v_produto = '' THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'nao conciliado ou dados incompletos');
  END IF;

  v_company_id := public.resolve_gc_company_id(v_produto);

  SELECT s.id INTO v_student_id
  FROM public.students s
  WHERE s.company_id = v_company_id
    AND s.iam_control_aluno_id = p_iam_aluno_id
    AND lower(btrim(coalesce(s.product, ''))) = lower(v_produto)
  ORDER BY s.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'aluno nao encontrado no GC');
  END IF;

  IF coalesce((SELECT status FROM public.students WHERE id = v_student_id), '') IN ('Cancelado', 'Solicitação Cancelamento') THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'aluno cancelado no GC');
  END IF;

  SELECT * INTO v_fin FROM public.iam_treinamento_financeiro(p_treinamento) LIMIT 1;

  v_quitado := coalesce(v_fin.total_installments, 0) = 0
    AND coalesce(v_fin.down_payment, 0) >= coalesce(v_fin.sale_value, 0) - 0.01;

  IF NOT v_quitado AND coalesce(v_fin.total_installments, 0) > 0
     AND coalesce(v_fin.paid_installments, 0) >= coalesce(v_fin.total_installments, 0) THEN
    v_quitado := true;
  END IF;

  IF NOT v_quitado THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'nao quitado no IAM', 'student_id', v_student_id);
  END IF;

  SELECT coalesce(sum((i->>'value')::numeric), 0)
  INTO v_aberto
  FROM public.students s
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.installments, '[]'::jsonb)) i
  WHERE s.id = v_student_id
    AND coalesce((i->>'paid')::boolean, false) = false;

  IF coalesce(v_aberto, 0) < 0.01
    AND coalesce((SELECT status FROM public.students WHERE id = v_student_id), '') = 'Pago' THEN
    RETURN jsonb_build_object('acao', 'ok', 'motivo', 'ja correto', 'student_id', v_student_id);
  END IF;

  UPDATE public.students s SET
    sale_value = v_fin.sale_value,
    down_payment = CASE WHEN coalesce(v_fin.total_installments, 0) = 0 THEN round(v_fin.sale_value, 2) ELSE round(v_fin.down_payment, 2) END,
    total_installments = coalesce(v_fin.total_installments, 0),
    installment_value = coalesce(v_fin.installment_value, 0),
    installments = coalesce(v_fin.installments, '[]'::jsonb),
    paid_installments = coalesce(v_fin.paid_installments, 0),
    status = 'Pago',
    status_mode = 'Automático',
    history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'type', 'Sistema',
      'text', 'Reparo IAM: contrato CONCILIADO quitado (à vista ou cartão pago integral) — financeiro alinhado.'
    ))
  WHERE s.id = v_student_id;

  RETURN jsonb_build_object(
    'acao', 'reparado',
    'student_id', v_student_id,
    'nome', (SELECT name FROM public.students WHERE id = v_student_id),
    'sale_value', v_fin.sale_value,
    'total_installments', v_fin.total_installments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_repair_conciliado_quitados_from_cliente(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_iam_id bigint := nullif(p->>'iam_control_aluno_id', '')::bigint;
  v_row record;
  v_result jsonb;
  v_reparados int := 0;
  v_ja int := 0;
  v_ignorados int := 0;
  v_treinamentos int := 0;
  v_detalhes jsonb := '[]'::jsonb;
BEGIN
  IF v_iam_id IS NULL THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'sem iam_control_aluno_id');
  END IF;

  FOR v_row IN
    SELECT
      public.iam_treinamento_label(t) AS produto,
      t AS treinamento
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    CROSS JOIN jsonb_array_elements(coalesce(m->'treinamentos', '[]'::jsonb)) t
    WHERE coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
  LOOP
    IF v_row.produto = '' OR public.product_excluded_from_gc(v_row.produto) THEN
      CONTINUE;
    END IF;

    v_treinamentos := v_treinamentos + 1;
    v_result := public.iam_repair_conciliado_quitado(v_row.treinamento, v_iam_id, v_row.produto);

    IF v_result->>'acao' = 'reparado' THEN
      v_reparados := v_reparados + 1;
      IF jsonb_array_length(v_detalhes) < 50 THEN
        v_detalhes := v_detalhes || v_result;
      END IF;
    ELSIF v_result->>'acao' = 'ok' THEN
      v_ja := v_ja + 1;
    ELSE
      v_ignorados := v_ignorados + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'iam_control_aluno_id', v_iam_id,
    'treinamentos', v_treinamentos,
    'reparados', v_reparados,
    'ja_corretos', v_ja,
    'ignorados', v_ignorados,
    'detalhes', v_detalhes
  );
END;
$$;

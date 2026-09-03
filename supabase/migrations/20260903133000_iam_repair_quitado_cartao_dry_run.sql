-- Reparo de contratos IAM pagos no cartão de crédito que ficaram parcelados
-- e pendentes no GC (bug corrigido em 20260903130000).
--
-- Ajustes no reparo existente (iam-repair-conciliado-quitados):
--   * aceita PARA_CONCILIAR além de CONCILIADO (o GC aprova PARA_CONCILIAR na
--     fila IAM → GC; o financeiro tem que estar certo em ambos);
--   * localiza a ficha pelo iam_control_aluno_id + produto em qualquer empresa
--     (mesma chave do upsert), em vez de depender de resolve_gc_company_id;
--   * modo p_dry_run: devolve o que seria alterado sem gravar nada;
--   * preserva iam_gc_conciliado_at / status_mode Manual de cancelamentos.

DROP FUNCTION IF EXISTS public.iam_repair_conciliado_quitado(jsonb, bigint, text);
DROP FUNCTION IF EXISTS public.iam_repair_conciliado_quitados_from_cliente(jsonb);

CREATE OR REPLACE FUNCTION public.iam_repair_conciliado_quitado(
  p_treinamento jsonb,
  p_iam_aluno_id bigint,
  p_produto text,
  p_dry_run boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_fin record;
  v_student record;
  v_produto text := btrim(coalesce(p_produto, ''));
  v_quitado boolean := false;
  v_aberto numeric := 0;
  v_formas text;
BEGIN
  IF v_status IS NULL OR v_status NOT IN ('CONCILIADO', 'PARA_CONCILIAR') OR p_iam_aluno_id IS NULL OR v_produto = '' THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'status nao elegivel ou dados incompletos', 'status', v_status);
  END IF;

  SELECT s.id, s.name, s.status, s.sale_value, s.total_installments, s.paid_installments, s.installments
    INTO v_student
  FROM public.students s
  WHERE s.iam_control_aluno_id = p_iam_aluno_id
    AND lower(btrim(coalesce(s.product, ''))) = lower(v_produto)
  ORDER BY s.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'aluno nao encontrado no GC');
  END IF;

  IF coalesce(v_student.status, '') IN ('Cancelado', 'Solicitação Cancelamento') THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'aluno cancelado no GC', 'student_id', v_student.id);
  END IF;

  SELECT * INTO v_fin FROM public.iam_treinamento_financeiro(p_treinamento) LIMIT 1;

  v_quitado := coalesce(v_fin.total_installments, 0) = 0
    AND coalesce(v_fin.down_payment, 0) >= coalesce(v_fin.sale_value, 0) - 0.01
    AND coalesce(v_fin.sale_value, 0) > 0.0049;

  IF NOT v_quitado AND coalesce(v_fin.total_installments, 0) > 0
     AND coalesce(v_fin.paid_installments, 0) >= coalesce(v_fin.total_installments, 0) THEN
    v_quitado := true;
  END IF;

  IF NOT v_quitado THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'nao quitado no IAM', 'student_id', v_student.id);
  END IF;

  SELECT coalesce(sum((i->>'value')::numeric), 0)
  INTO v_aberto
  FROM jsonb_array_elements(coalesce(v_student.installments, '[]'::jsonb)) i
  WHERE coalesce((i->>'paid')::boolean, false) = false;

  IF coalesce(v_aberto, 0) < 0.01 AND coalesce(v_student.status, '') = 'Pago' THEN
    RETURN jsonb_build_object('acao', 'ok', 'motivo', 'ja correto', 'student_id', v_student.id);
  END IF;

  SELECT string_agg(coalesce(f->>'forma', '?') || ' ' || coalesce(f->>'valor', ''), ' + ')
  INTO v_formas
  FROM jsonb_array_elements(coalesce(p_treinamento->'formas_pagamento', '[]'::jsonb)) f;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'acao', 'reparavel',
      'student_id', v_student.id,
      'nome', v_student.name,
      'produto', v_produto,
      'status_iam', v_status,
      'formas', v_formas,
      'gc_parcelas', coalesce(v_student.total_installments, 0),
      'gc_em_aberto', v_aberto,
      'sale_value', v_fin.sale_value,
      'novo_total_installments', v_fin.total_installments
    );
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
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Reparo IAM: contrato ' || replace(v_status, '_', ' ') || ' quitado no IAM (' || coalesce(v_formas, 'à vista / cartão')
              || '). Cartão de crédito entra para a empresa uma vez só, independente do parcelamento do cliente — financeiro alinhado (sem recebíveis futuros).'
    ))
  WHERE s.id = v_student.id;

  RETURN jsonb_build_object(
    'acao', 'reparado',
    'student_id', v_student.id,
    'nome', v_student.name,
    'produto', v_produto,
    'status_iam', v_status,
    'formas', v_formas,
    'gc_parcelas_antes', coalesce(v_student.total_installments, 0),
    'gc_em_aberto_antes', v_aberto,
    'sale_value', v_fin.sale_value,
    'total_installments', v_fin.total_installments
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_repair_conciliado_quitados_from_cliente(
  p jsonb,
  p_dry_run boolean DEFAULT false
)
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
    v_result := public.iam_repair_conciliado_quitado(v_row.treinamento, v_iam_id, v_row.produto, p_dry_run);

    IF v_result->>'acao' IN ('reparado', 'reparavel') THEN
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
    'dry_run', p_dry_run,
    'treinamentos', v_treinamentos,
    'reparados', v_reparados,
    'ja_corretos', v_ja,
    'ignorados', v_ignorados,
    'detalhes', v_detalhes
  );
END;
$$;

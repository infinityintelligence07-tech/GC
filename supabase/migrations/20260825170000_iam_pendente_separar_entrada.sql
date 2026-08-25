-- PENDENTE: separar valor de entrada do saldo parcelado (PIX/link vs boleto).
-- Evita tratar o contrato inteiro como entrada quando há parcelas no plano.

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
  v_pendente boolean := v_status = 'PENDENTE';
  v_base date := coalesce(nullif(left(v_data_venda, 10), '')::date, current_date);
  v_inst jsonb := '[]'::jsonb;
  v_entrada_restante numeric := 0;
  v_valor_pago numeric := coalesce(nullif(p_treinamento->>'valor_pago', '')::numeric, 0);
  v_valor_pendente numeric := coalesce(nullif(p_treinamento->>'valor_pendente', '')::numeric, 0);
  v_sum_inst numeric := 0;
  v_first numeric := 0;
BEGIN
  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    IF public.iam_forma_is_entrada(v_forma) THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_parcelado(v_forma) THEN
      v_parcelado := v_parcelado + v_valor;
    END IF;
  END LOOP;

  IF nullif(p_treinamento->>'valor_entrada', '') IS NOT NULL THEN
    v_down := (p_treinamento->>'valor_entrada')::numeric;
  END IF;

  -- Formas mistas: PIX/entrada não pode engolir o parcelado (link/boleto do saldo).
  IF v_pendente AND v_parcelado > 0.0049 AND v_down > v_sale - v_parcelado + 0.01 THEN
    v_down := round(greatest(v_sale - v_parcelado, 0), 2);
  END IF;

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;

  -- Valor explícito aguardando PIX/link (quando IAM envia separado do contrato).
  IF v_pendente
     AND v_valor_pendente > 0.0049
     AND v_valor_pendente < v_sale - 0.01
     AND v_valor_pago < v_valor_pendente - 0.01 THEN
    v_entrada_restante := round(v_valor_pendente, 2);
    v_down := 0;
  END IF;

  -- PENDENTE: entrada só vira parcela em aberto se AINDA NÃO foi paga.
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

  -- PIX = contrato inteiro mas há parcelas no plano: entrada ≠ saldo total.
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

COMMENT ON FUNCTION public.iam_treinamento_financeiro(jsonb) IS
  'Converte treinamento IAM→GC. PENDENTE: separa entrada (PIX/link) do saldo parcelado; nunca duplica sobre parcelas_detalhe.';

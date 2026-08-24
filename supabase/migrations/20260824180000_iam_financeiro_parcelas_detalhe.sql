-- Sync IAM: usa parcelas_detalhe (valores explícitos por parcela) e valor negociado do contrato.

CREATE OR REPLACE FUNCTION public.iam_build_installments_from_values(
  p_values jsonb,
  p_enrollment_date text,
  p_paid_count int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_count int := coalesce(jsonb_array_length(p_values), 0);
  v_base date := coalesce(nullif(left(p_enrollment_date, 10), '')::date, current_date);
  v_i int;
  v_valor numeric;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_count <= 0 THEN
    RETURN v_out;
  END IF;

  FOR v_i IN 0..(v_count - 1) LOOP
    v_valor := coalesce(nullif(p_values->>v_i, '')::numeric, 0);
    IF v_valor <= 0 THEN
      CONTINUE;
    END IF;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'number', v_i + 1,
        'value', round(v_valor, 2),
        'dueDate', (v_base + make_interval(months => v_i + 1))::date::text,
        'paid', v_i < greatest(coalesce(p_paid_count, 0), 0)
      )
    );
  END LOOP;

  RETURN v_out;
END;
$$;

DROP FUNCTION IF EXISTS public.iam_treinamento_financeiro(jsonb);

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

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;

  IF v_detalhe_len > 0 THEN
    v_parcelas := v_detalhe_len;
    v_valor_parcela := coalesce(nullif(v_detalhe->>0, '')::numeric, 0);
    IF v_parcelas > 0 THEN
      v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
    END IF;
    sale_value := v_sale;
    down_payment := round(v_down, 2);
    total_installments := v_parcelas;
    installment_value := round(v_valor_parcela, 2);
    installments := public.iam_build_installments_from_values(v_detalhe, v_data_venda, v_parcelas_pagas);
    paid_installments := v_parcelas_pagas;
    RETURN NEXT;
    RETURN;
  END IF;

  v_parcelas := nullif(p_treinamento->>'parcelas', '')::int;
  IF v_parcelas IS NULL OR v_parcelas < 1 THEN
    IF v_parcelado > 0 AND (v_sale - v_down) > 0.01 THEN
      v_parcelas := 1;
    ELSE
      v_parcelas := 0;
    END IF;
  END IF;

  v_valor_parcela := coalesce(nullif(p_treinamento->>'valor_parcela', '')::numeric, 0);
  IF v_valor_parcela <= 0 THEN
    v_valor_parcela := CASE
      WHEN v_parcelas > 0 THEN round(greatest(v_sale - v_down, 0) / v_parcelas, 2)
      ELSE 0
    END;
  END IF;

  IF v_parcelas > 0 THEN
    v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
  END IF;

  sale_value := v_sale;
  down_payment := round(v_down, 2);
  total_installments := v_parcelas;
  installment_value := round(v_valor_parcela, 2);
  IF v_parcelas > 0 AND v_valor_parcela > 0 THEN
    installments := public.iam_build_installments_from_values(
      (
        SELECT coalesce(jsonb_agg(round(v_valor_parcela, 2)), '[]'::jsonb)
        FROM generate_series(1, v_parcelas) AS gs(i)
      ),
      v_data_venda,
      v_parcelas_pagas
    );
  ELSE
    installments := public.iam_build_installments(v_sale, v_down, v_parcelas, v_data_venda);
  END IF;
  paid_installments := v_parcelas_pagas;
  RETURN NEXT;
END;
$$;

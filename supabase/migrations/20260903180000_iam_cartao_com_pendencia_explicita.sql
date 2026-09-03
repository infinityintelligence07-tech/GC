-- Cartão cobrado + pendência explícita em contrato PENDENTE_LINK/PIX.
--
-- Caso real (Ronaldo / Confronto 2): cartão de crédito R$ 4.000 (cobrado) +
-- cartão de crédito R$ 8.922 "(pendência)" aguardando link. O IAM mandava as
-- duas formas somadas (CARTAO_CREDITO 12.922) e, como o contrato está
-- PENDENTE_LINK, o GC não aplicava a regra "cartão = recebido pela operadora":
-- ficavam 12.922 em aberto em 2 parcelas.
--
-- O IAM agora exporta cada pendência como forma própria com `pendencia: true`
-- (e a entrada sem as pendências). Aqui:
--   * pré-varredura detecta se há forma de pendência explícita;
--   * cartão SEM marca de pendência é recebido (v_cartao) mesmo com o contrato
--     pendente, desde que a pendência esteja identificada em outra forma;
--   * forma de pendência em contrato já CONCILIADO é recebida (v_pend_paga) e
--     somada à entrada depois do override de valor_entrada.
-- Payloads antigos (sem a flag) seguem exatamente o comportamento anterior.

CREATE OR REPLACE FUNCTION public.iam_treinamento_financeiro(p_treinamento jsonb)
RETURNS TABLE(sale_value numeric, down_payment numeric, total_installments integer, installment_value numeric, installments jsonb, paid_installments integer)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_sale numeric := coalesce(nullif(p_treinamento->>'valor_total', '')::numeric, 0);
  v_down numeric := 0;
  v_cartao numeric := 0;
  v_pend_paga numeric := 0;
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
  v_detalhe_sum numeric := 0;
  v_acum numeric := 0;
  v_corte int := 0;
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
  v_tem_forma_pendente boolean := false;
BEGIN
  -- Pré-varredura: há pendência identificada em alguma forma?
  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    IF public.iam_forma_is_pendencia(v_formas->v_i) THEN
      v_tem_forma_pendente := true;
      EXIT;
    END IF;
  END LOOP;

  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    v_fp_parcelas := coalesce(nullif(v_fp->>'parcelas', '')::int, 0);
    v_forma_pendente := public.iam_forma_is_pendencia(v_fp);

    IF v_forma_pendente THEN
      IF v_pendente THEN
        -- Pendência ainda aguardando link/PIX: recebível em aberto.
        v_entrada_restante := v_entrada_restante + v_valor;
      ELSE
        -- Contrato já conciliado: a pendência foi paga. Acumulada à parte para
        -- sobreviver ao override de valor_entrada (o IAM não a soma na entrada).
        v_pend_paga := v_pend_paga + v_valor;
      END IF;
    ELSIF coalesce(v_fp->>'a_vista', '') IN ('true', '1', 'sim', 'TRUE')
       OR btrim(coalesce(v_fp->>'modalidade', '')) ILIKE '%vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%à vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%a vista%' THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_entrada(v_forma) THEN
      v_down := v_down + v_valor;
    ELSIF (NOT v_pendente OR v_tem_forma_pendente) AND public.iam_forma_is_cartao_credito(v_forma) THEN
      -- Cartão de crédito: recebido à vista pela operadora, independente
      -- das parcelas do cliente. Vale também em contrato pendente quando a
      -- pendência está identificada em OUTRA forma (este cartão foi cobrado).
      v_cartao := v_cartao + v_valor;
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

  IF v_pend_paga > 0.0049 THEN
    v_down := v_down + v_pend_paga;
  END IF;

  IF v_cartao > 0.0049 THEN
    v_down := v_down + v_cartao;

    -- O IAM detalha as parcelas do cartão em parcelas_detalhe. Quando o
    -- detalhe é só o cartão (soma bate), não há recebível futuro: descarta.
    SELECT coalesce(sum(nullif(elem, '')::numeric), 0)
    INTO v_detalhe_sum
    FROM jsonb_array_elements_text(v_detalhe) elem;

    IF v_detalhe_len > 0 AND abs(v_detalhe_sum - v_cartao) < 0.05 THEN
      v_detalhe := '[]'::jsonb;
      v_detalhe_len := 0;
    ELSIF v_detalhe_len > 0 AND v_detalhe_sum > v_cartao + 0.05 THEN
      -- Cartão + boleto/pendência: o IAM lista primeiro as parcelas do cartão.
      -- Remove o prefixo cuja soma bate com o cartão e mantém o restante.
      v_acum := 0;
      v_corte := 0;
      FOR v_i IN 0..v_detalhe_len - 1 LOOP
        v_acum := v_acum + coalesce(nullif(v_detalhe->>v_i, '')::numeric, 0);
        IF abs(v_acum - v_cartao) < 0.05 THEN
          v_corte := v_i + 1;
          EXIT;
        END IF;
        EXIT WHEN v_acum > v_cartao + 0.05;
      END LOOP;
      IF v_corte > 0 THEN
        v_detalhe := coalesce((
          SELECT jsonb_agg(elem ORDER BY ord)
          FROM jsonb_array_elements(v_detalhe) WITH ORDINALITY AS t(elem, ord)
          WHERE ord > v_corte
        ), '[]'::jsonb);
        v_detalhe_len := coalesce(jsonb_array_length(v_detalhe), 0);
      END IF;
    END IF;
  END IF;

  IF v_pendente AND v_parcelado > 0.0049 AND v_down > v_sale - v_parcelado + 0.01 THEN
    v_down := round(greatest(v_sale - v_parcelado, 0), 2);
  END IF;

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;
  -- O IAM conta as parcelas do cartão como pagas primeiro (valor_pago cobre o
  -- cartão). Removidas do detalhe, saem também da contagem de pagas, senão o
  -- boleto restante seria marcado como pago indevidamente.
  IF v_corte > 0 THEN
    v_parcelas_pagas := greatest(v_parcelas_pagas - v_corte, 0);
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
    -- Cartão integral (detalhe descartado acima): nada a parcelar.
    IF NOT v_pendente AND v_cartao > 0.0049 AND v_down >= v_sale - 0.01 THEN
      v_parcelas := 0;
    END IF;
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
       OR v_modalidade LIKE '%VISTA%'
       OR (v_modalidade LIKE '%CART%' AND v_modalidade NOT LIKE '%DEB%') THEN
      -- Quitado (à vista, cartão de crédito em qualquer nº de parcelas,
      -- ou valor pago cobre o contrato): sem recebíveis futuros no GC.
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
$function$;

COMMENT ON FUNCTION public.iam_treinamento_financeiro(jsonb) IS
  'Financeiro IAM→GC. Cartão de crédito sem marca de pendência é recebido à vista pela empresa (mesmo em contrato PENDENTE, se a pendência estiver identificada em outra forma); forma marcada como pendência fica em aberto até o contrato conciliar.';

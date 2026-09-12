-- Boleto parcelado (NX) que o IAM lista como UM item em parcelas_detalhe →
-- o GC criava uma parcela única com o valor todo.
--
-- Caso real (12/09/2026) — Layane Soares / Confronto R$ 23.325:
--   formas: cartão R$ 12.000 + boleto R$ 11.325 em 12x.
--   parcelas_detalhe = [9000, 3000, 11325] (o IAM detalha o cartão em 2 itens
--   e joga o boleto inteiro num só). Após remover o prefixo do cartão sobrava
--   [11325] → 1 parcela de 11.325 vencendo 02/09, em vez de 12 × 943,75.
--
-- Regra nova: quando o detalhe restante tem UM item e existe uma forma
-- parcelada (boleto etc., não cartão, não pendência) com `parcelas` > 1 e
-- valor igual a esse item, o item é aberto em `parcelas` parcelas iguais
-- (centavos ajustados na última). Vencimentos seguem data_venda + N meses.
-- O restante da função é idêntico à 20260912160000.
CREATE OR REPLACE FUNCTION public.iam_treinamento_financeiro(p_treinamento jsonb)
RETURNS TABLE(sale_value numeric, down_payment numeric, total_installments integer, installment_value numeric, installments jsonb, paid_installments integer)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_sale numeric := coalesce(nullif(p_treinamento->>'valor_total', '')::numeric, 0);
  v_down numeric := 0;
  v_cartao numeric := 0;
  v_cartao_avista numeric := 0;  -- cartão sem parcelas (IAM soma em valor_entrada)
  v_cartao_prazo numeric := 0;   -- cartão parcelado 2x+ (IAM NÃO soma em valor_entrada)
  v_boleto_avista numeric := 0;  -- boleto 1x em contrato não pendente (vai a v_down, mas não é entrada IAM)
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
  v_entrada_iam numeric;
  v_cartao_na_entrada boolean := false;
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
      IF v_fp_parcelas > 1 THEN
        v_cartao_prazo := v_cartao_prazo + v_valor;
      ELSE
        v_cartao_avista := v_cartao_avista + v_valor;
      END IF;
    ELSIF public.iam_forma_is_parcelado(v_forma) THEN
      IF NOT v_pendente AND v_fp_parcelas = 1 THEN
        v_down := v_down + v_valor;
        v_boleto_avista := v_boleto_avista + v_valor;
      ELSE
        v_parcelado := v_parcelado + v_valor;
      END IF;
    END IF;
  END LOOP;

  IF nullif(p_treinamento->>'valor_entrada', '') IS NOT NULL THEN
    v_entrada_iam := (p_treinamento->>'valor_entrada')::numeric;
    -- Export atual do IAM: valor_entrada inclui o cartão cobrado À VISTA (sem
    -- parcelas), mas NÃO o cartão parcelado ("à prazo", 10x/12x). A checagem
    -- compara com a entrada apurada nas formas (PIX/dinheiro/débito + cartão à
    -- vista) — boleto 1x fica de fora: ele entra em v_down por conveniência,
    -- mas não é "entrada" para o IAM e mascarava a comparação.
    v_cartao_na_entrada := v_cartao_avista > 0.0049
      AND v_entrada_iam >= (v_down - v_boleto_avista) + v_cartao_avista - 0.05;
    v_down := v_entrada_iam;
  END IF;

  IF v_pend_paga > 0.0049 THEN
    v_down := v_down + v_pend_paga;
  END IF;

  IF v_cartao > 0.0049 THEN
    IF v_cartao_na_entrada THEN
      -- Cartão à vista já está em valor_entrada; o parcelado não — soma só ele.
      v_down := v_down + v_cartao_prazo;
    ELSE
      v_down := v_down + v_cartao;
    END IF;

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

  -- Boleto (ou outra forma parcelada, não cartão) em NX que o IAM lista como
  -- um único item no detalhe: abre em N parcelas iguais.
  IF v_detalhe_len = 1 THEN
    FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
      v_fp := v_formas->v_i;
      v_forma := v_fp->>'forma';
      v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
      v_fp_parcelas := coalesce(nullif(v_fp->>'parcelas', '')::int, 0);
      IF v_fp_parcelas > 1
         AND NOT public.iam_forma_is_pendencia(v_fp)
         AND NOT public.iam_forma_is_cartao_credito(v_forma)
         AND public.iam_forma_is_parcelado(v_forma)
         AND abs(v_valor - coalesce(nullif(v_detalhe->>0, '')::numeric, 0)) < 0.05 THEN
        v_valor_parcela := round(v_valor / v_fp_parcelas, 2);
        v_detalhe := (
          SELECT jsonb_agg(
            CASE WHEN gs.i = v_fp_parcelas
                 THEN round(v_valor - v_valor_parcela * (v_fp_parcelas - 1), 2)
                 ELSE v_valor_parcela END
            ORDER BY gs.i)
          FROM generate_series(1, v_fp_parcelas) AS gs(i)
        );
        v_detalhe_len := v_fp_parcelas;
        EXIT;
      END IF;
    END LOOP;
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
    -- Cartão integral (detalhe descartado acima): nada a parcelar. Em contrato
    -- pendente, a pendência em aberto (link/PIX) completa o contrato e vira a
    -- parcela nº 1 mais abaixo — o `parcelas` do IAM aqui é ruído.
    IF v_cartao > 0.0049 AND v_down + v_entrada_restante >= v_sale - 0.01 THEN
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
  'Financeiro IAM→GC. Cartão de crédito sem marca de pendência é recebido à vista pela empresa; com cartão, a entrada é o maior entre valor_entrada do IAM e (entrada das formas + cartão), nunca a soma. Forma marcada como pendência fica em aberto (parcela nº 1, tag entrada-pendente) até o contrato conciliar.';

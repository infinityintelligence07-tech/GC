-- Reparo: fichas IAM com boleto Nx listado como lump no detalhe (vira 1 parcela).
-- Causa raiz corrigida em 20260917120000_iam_boleto_nx_detalhe_misto.
-- Aqui reaplica iam_treinamento_financeiro nos contratos já identificados.

DO $$
DECLARE
  v_item jsonb;
  v_fin record;
  v_stud record;
  v_due_day int;
  v_payloads jsonb := $payloads$[
    {
      "contrato_id": "1535",
      "aluno_id": 16468,
      "treinamento": {
        "valor_total": 20011,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 2000},
          {"forma": "BOLETO", "valor": 18011, "parcelas": 18}
        ],
        "data_venda": "2026-08-25T12:23:36.954Z",
        "parcelas": 2,
        "valor_entrada": 2000,
        "valor_parcela": 1000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [1000, 18011],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Lorena / Missão Governar: boleto 18x R$ 18.011 (IAM listava [1000, 18011])."
    },
    {
      "contrato_id": "1498",
      "aluno_id": 16597,
      "treinamento": {
        "valor_total": 20011,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 2000},
          {"forma": "BOLETO", "valor": 18011, "parcelas": 18}
        ],
        "data_venda": "2026-08-23",
        "parcelas": 2,
        "valor_entrada": 2000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [1200, 18011],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Douglas Henrique / Missão Governar: boleto 18x R$ 18.011."
    },
    {
      "contrato_id": "1493",
      "aluno_id": 15539,
      "treinamento": {
        "valor_total": 20011,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 3000},
          {"forma": "BOLETO", "valor": 17011, "parcelas": 18}
        ],
        "data_venda": "2026-08-23",
        "parcelas": 3,
        "valor_entrada": 3000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [2000, 1000, 17011],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Thiago Alberto / Missão Governar: boleto 18x R$ 17.011."
    },
    {
      "contrato_id": "1490",
      "aluno_id": 2518,
      "treinamento": {
        "valor_total": 34146,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 6000},
          {"forma": "BOLETO", "valor": 28146, "parcelas": 18}
        ],
        "data_venda": "2026-08-23",
        "parcelas": 2,
        "valor_entrada": 6000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [6000, 28146],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Rodrigo Penna / Missão Governar: boleto 18x R$ 28.146."
    },
    {
      "contrato_id": "1539",
      "aluno_id": 10789,
      "treinamento": {
        "valor_total": 21600,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 4000},
          {"forma": "BOLETO", "valor": 17600, "parcelas": 10}
        ],
        "data_venda": "2026-08-25",
        "parcelas": 2,
        "valor_entrada": 4000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [2000, 17600],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Ana Cecilia / Liberty Begin: boleto 10x R$ 17.600."
    },
    {
      "contrato_id": "1675",
      "aluno_id": 13222,
      "treinamento": {
        "valor_total": 25000,
        "formas_pagamento": [
          {"forma": "CARTAO_CREDITO", "valor": 6000},
          {"forma": "BOLETO", "valor": 19000, "parcelas": 8}
        ],
        "data_venda": "2026-08-30",
        "parcelas": 2,
        "valor_entrada": 6000,
        "parcelas_pagas": 0,
        "parcelas_detalhe": [5000, 19000],
        "status_conciliacao": "CONCILIADO"
      },
      "nota": "Mayara Ramine / Liberty Begin: boleto 8x R$ 19.000."
    }
  ]$payloads$::jsonb;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_payloads)
  LOOP
    SELECT * INTO v_fin
    FROM public.iam_treinamento_financeiro(v_item->'treinamento');

    IF coalesce(v_fin.total_installments, 0) <= 1 THEN
      RAISE NOTICE 'Pulando contrato % — financeiro ainda com % parcela(s)',
        v_item->>'contrato_id', coalesce(v_fin.total_installments, 0);
      CONTINUE;
    END IF;

    SELECT * INTO v_stud
    FROM public.students s
    WHERE s.iam_control_contrato_id = v_item->>'contrato_id'
       OR (
         s.iam_control_aluno_id = (v_item->>'aluno_id')::bigint
         AND abs(coalesce(s.sale_value, 0) - coalesce(v_fin.sale_value, 0)) < 0.05
         AND coalesce(s.total_installments, 0) = 1
       )
    ORDER BY CASE WHEN s.iam_control_contrato_id = v_item->>'contrato_id' THEN 0 ELSE 1 END
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'Aluno não encontrado para contrato %', v_item->>'contrato_id';
      CONTINUE;
    END IF;

    -- Só repara quem ainda está com 1 parcela (ou equivalente ao lump).
    IF coalesce(v_stud.total_installments, 0) <> 1
       AND jsonb_array_length(coalesce(v_stud.installments, '[]'::jsonb)) <> 1 THEN
      RAISE NOTICE 'Contrato % já tem % parcelas — mantém',
        v_item->>'contrato_id', v_stud.total_installments;
      CONTINUE;
    END IF;

    v_due_day := coalesce(
      nullif(split_part(coalesce(v_fin.installments->0->>'dueDate', ''), '-', 3), '')::int,
      v_stud.due_day,
      10
    );

    UPDATE public.students s
    SET down_payment = v_fin.down_payment,
        total_installments = v_fin.total_installments,
        installment_value = v_fin.installment_value,
        installments = v_fin.installments,
        paid_installments = coalesce(v_fin.paid_installments, 0),
        due_day = v_due_day,
        history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'date', now(),
            'type', 'Sistema',
            'text', format(
              'Financeiro corrigido (boleto Nx do IAM listado como parcela única): %s Antes: 1 parcela de R$ %s. Agora: %sx de R$ %s.',
              coalesce(v_item->>'nota', ''),
              to_char(coalesce((v_stud.installments->0->>'value')::numeric, v_stud.installment_value, 0), 'FM999999990.00'),
              v_fin.total_installments,
              to_char(v_fin.installment_value, 'FM999999990.00')
            )
          )
        ),
        updated_at = now()
    WHERE s.id = v_stud.id;

    RAISE NOTICE 'Reparado % (%): %sx R$ %s',
      v_stud.name, v_item->>'contrato_id', v_fin.total_installments, v_fin.installment_value;
  END LOOP;
END $$;

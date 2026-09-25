-- JAVIER ACUNA ORELLANA (Missão Governar) — ficha 1665a88e
-- A entrada da venda (R$ 5.000,00 = R$ 3.000,00 + R$ 2.000,00, paga no evento
-- em 19–20/04/2026) foi lançada como parcelas P1/P2 e baixada no GC em 24/09,
-- entrando no card "Pago" (entrada de venda não entra no Pago).
-- Correção:
--   - remove P1 (R$ 3.000) e P2 (R$ 2.000) do fluxo e renumera (19 → 17 parcelas);
--   - down_payment 1.350 → 6.350 (R$ 5.000 entrada da venda + R$ 1.350 entrada
--     da renegociação conciliada em 24/09 — esta continua no Pago via item de
--     renegociação);
--   - desvincula os itens de Conciliação "Pagamento parcela 1/2" do número de
--     parcela (senão o Pago passaria a contar as novas P1/P2 de R$ 1.350, que
--     vieram pagas do Kamino).
-- Contrato continua R$ 18.500,00 = 6.350 + 2 × 1.350 + 15 × 630.

DO $$
DECLARE
  v_id uuid := '1665a88e-55ed-437e-b66a-f8a6d4c2d6d5';
  v_co uuid := '00000000-0000-0000-0000-0000000a1a11';
  v_inst jsonb;
BEGIN
  -- Guarda: só aplica se a ficha ainda está no estado analisado.
  IF NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = v_id AND s.company_id = v_co
      AND jsonb_array_length(s.installments) = 19
      AND (s.installments->0->>'value')::numeric = 3000
      AND (s.installments->1->>'value')::numeric = 2000
      AND s.down_payment = 1350
  ) THEN
    RAISE NOTICE 'Javier 1665a88e: estado diferente do esperado — nada alterado.';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           (e - 'observacao' - 'numeroOriginal')
             || jsonb_build_object('number', rn)
           ORDER BY rn
         )
  INTO v_inst
  FROM (
    SELECT e, row_number() OVER (ORDER BY (e->>'number')::int) AS rn
    FROM public.students s, jsonb_array_elements(s.installments) e
    WHERE s.id = v_id AND (e->>'number')::int > 2
  ) x;

  UPDATE public.students s
  SET
    installments = v_inst,
    total_installments = 17,
    paid_installments = 2,
    down_payment = 6350,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text',
      'Correção (suporte): entrada da venda R$ 5.000,00 (R$ 3.000,00 + R$ 2.000,00 pagos no evento em 20/04/2026) estava lançada como parcelas P1/P2 com baixa no GC. Removidas do fluxo e registradas como entrada — total de entrada R$ 6.350,00 (venda R$ 5.000,00 + renegociação R$ 1.350,00). Fluxo: 17 parcelas (2 pagas de R$ 1.350,00 + 15 de R$ 630,00). Contrato R$ 18.500,00 mantido.'
    )),
    updated_at = now()
  WHERE s.id = v_id AND s.company_id = v_co;

  UPDATE public.conciliacao_items ci
  SET
    depois = ci.depois
      || jsonb_build_object(
           'parcela', null,
           'parcelaOriginal', (ci.depois->>'parcela')::int,
           'movidoParaEntradaVenda', true
         ),
    conciliado_nota = coalesce(ci.conciliado_nota || E'\n', '')
      || 'Correção (suporte) 25/09/2026: valor é entrada da venda (evento), não parcela — movido para a entrada da ficha; não conta no card Pago.',
    updated_at = now()
  WHERE ci.id IN (
    'ad8eaf44-a74c-450b-8110-136bc2c5df65', -- Pagamento parcela 1 — R$ 3.000,00
    '46bac5fa-96c7-4a15-98d2-97065d894fb1'  -- Pagamento parcela 2 — R$ 2.000,00
  )
    AND ci.student_id = v_id
    AND ci.tipo = 'pagamento_parcela'
    AND ci.status = 'conciliado';
END $$;

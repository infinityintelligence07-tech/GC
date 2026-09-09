-- GLADYS RODRIGO GUTIERREZ (Liberty - GC, BEGIN) — R$ 6.000,00 pagos em maio/2026.
--
-- A ficha veio de uma importação antiga (26/06/2026) que gravou os R$ 6.000,00
-- como ENTRADA da venda (down_payment) e 5 boletos de R$ 4.000,00 a partir de
-- 15/06. Na planilha Liberty esse valor é uma célula paga (cinza) do mês de
-- MAIO, e a regra do card Pago (08/09/2026) só conta parcela com baixa
-- registrada no GC — entrada de venda fica de fora. Resultado: os R$ 6.000,00
-- não apareciam no Pago de maio.
--
-- Correção: o pagamento vira a parcela 1 (R$ 6.000,00, vencimento e pagamento
-- em 15/05/2026, com paidMarkedAt — mesmo rastro das demais baixas da Liberty),
-- os boletos de R$ 4.000,00 passam a ser as parcelas 2–6 e a entrada zera.
-- Valor do contrato (R$ 26.000,00) e saldo em aberto (R$ 16.000,00) não mudam.

DO $$
DECLARE
  v_id uuid;
  v_inst jsonb;
  v_nova jsonb;
  v_pagas int;
BEGIN
  SELECT s.id, s.installments INTO v_id, v_inst
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id
   WHERE co.name = 'Liberty - GC'
     AND s.name ILIKE 'GLADYS RODRIGO%'
     AND abs(coalesce(s.down_payment, 0) - 6000) < 0.01
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'Gladys: ficha com entrada de R$ 6.000,00 não encontrada — nada alterado';
    RETURN;
  END IF;

  IF NOT (
    (v_inst->0->>'dueDate') = '2026-06-15'
    AND abs((v_inst->0->>'value')::numeric - 4000) < 0.01
    AND jsonb_array_length(v_inst) = 5
  ) THEN
    RAISE NOTICE 'Gladys: parcelas fora do esperado (5 x R$ 4.000,00 a partir de 15/06) — nada alterado';
    RETURN;
  END IF;

  -- Parcela 1 = os R$ 6.000,00 de maio, baixados no GC.
  v_nova := jsonb_build_array(jsonb_build_object(
    'number', 1,
    'value', 6000,
    'dueDate', '2026-05-15',
    'paid', true,
    'paidDate', '2026-05-15',
    'paidValue', 6000,
    'paidMarkedAt', '2026-05-15T12:00:00.000Z',
    'tags', '[]'::jsonb,
    'observacao', 'Pagamento de R$ 6.000,00 em maio/2026 (planilha Liberty). Estava registrado como entrada da venda; convertido em parcela para constar no Pago.'
  ));

  -- Boletos de R$ 4.000,00 renumerados para 2–6.
  SELECT v_nova || jsonb_agg(i || jsonb_build_object('number', ord + 1) ORDER BY ord)
    INTO v_nova
    FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(i, ord);

  SELECT count(*) INTO v_pagas FROM jsonb_array_elements(v_nova) i WHERE coalesce((i->>'paid')::boolean, false);

  UPDATE public.students
     SET installments = v_nova,
         down_payment = 0,
         total_installments = jsonb_array_length(v_nova),
         paid_installments = v_pagas,
         history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'type', 'Sistema',
           'text', 'Correção (09/09/2026): os R$ 6.000,00 pagos em 15/05/2026 estavam gravados como entrada da venda e não entravam no card Pago. Passaram a ser a parcela 1 (paga em 15/05/2026); os 5 boletos de R$ 4.000,00 (15/06 a 15/10) são agora as parcelas 2 a 6. Contrato segue R$ 26.000,00 com R$ 16.000,00 em aberto.'
         )),
         updated_at = now()
   WHERE id = v_id;

  RAISE NOTICE 'Gladys: entrada convertida em parcela 1 paga em 15/05/2026 (% parcelas, % pagas).', jsonb_array_length(v_nova), v_pagas;
END $$;

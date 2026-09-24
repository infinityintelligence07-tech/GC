-- LUIS CARLOS DE SOUSA (Confronto) — ficha 1da9373f
-- Contrato subiu quitado (15× R$ 500, status Pago) após quitação PIX indevida.
-- Restaura o plano do contrato assinado:
--   TOTAL R$ 14.237,18 | entrada R$ 1.500,00 | boleto 15× R$ 849,15
--   1º venc. 13/10/2026; demais dia 25.
-- Remove o desconto de quitação lançado na carteira em 17/09.

DO $$
DECLARE
  v_id uuid := '1da9373f-279a-4174-a934-07ee4f4544c0';
  v_co uuid := '00000000-0000-0000-0000-0000000a1a11';
  v_inst jsonb;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'number', n,
        'value', 849.15,
        'dueDate', to_char(
          CASE
            WHEN n = 1 THEN date '2026-10-13'
            ELSE (date '2026-11-25' + ((n - 2) * interval '1 month'))::date
          END,
          'YYYY-MM-DD'
        ),
        'paid', false
      )
      ORDER BY n
    ),
    '[]'::jsonb
  )
  INTO v_inst
  FROM generate_series(1, 15) AS n;

  UPDATE public.students s
  SET
    sale_value = 14237.18,
    down_payment = 1500,
    total_installments = 15,
    installment_value = 849.15,
    paid_installments = 0,
    due_day = 25,
    status = 'Em Dia',
    installments = v_inst,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text',
      'Correção (suporte): quitação indevida desfeita. Contrato restaurado conforme ficha assinada — R$ 14.237,18 (entrada R$ 1.500,00 + boleto 15× R$ 849,15). 1º venc. 13/10/2026; demais todo dia 25. Parcelas em aberto; status Em Dia.'
    )),
    updated_at = now()
  WHERE s.id = v_id
    AND s.company_id = v_co
    AND s.product = 'Confronto';

  DELETE FROM public.carteira_extrato_lancamentos
  WHERE id = 'f4beeee8-269e-4870-88f7-f778bed02c0a'
    AND company_id = v_co
    AND tipo = 'saida_desconto'
    AND descricao ilike '%Luis Carlos de Sousa%';
END $$;

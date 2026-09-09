-- Liberty - GC — células VERDES da planilha que não entravam no card Pago.
--
-- Fichas da Liberty importadas antes de 04/09/2026 (Gladys, Jose Renato,
-- Daiane) não foram atualizadas pela importação de 04/09 (não estavam naquela
-- versão da planilha). Nelas, o primeiro pagamento (célula verde do mês da
-- venda) ficou gravado como ENTRADA da venda (down_payment), e a regra do card
-- Pago (08/09/2026) não conta entrada — só parcela com baixa registrada no GC.
--
-- Correção, mesmo tratamento dado à Gladys em 20260909220000:
--   1) GLADYS RODRIGO GUTIERREZ — parcela 2 (R$ 4.000,00, 15/06/2026) está paga
--      mas sem data/rastro de baixa → recebe paidDate 15/06/2026 + paidMarkedAt.
--   2) JOSE RENATO OTÁVIO — entrada R$ 10.900,00 (28/06/2026) vira parcela 1
--      paga em 28/06/2026; os 5 boletos de R$ 2.500,00 passam a 2–6.
--   3) Daiane Cardoso Leão — entrada R$ 6.000,00 (15/07/2026) vira parcela 1
--      paga em 15/07/2026; os 5 boletos de R$ 4.000,00 passam a 2–6.
-- Valor do contrato e saldo em aberto não mudam em nenhum caso.

-- ─── 1) Gladys — parcela 2 (R$ 4.000,00 de junho) ────────────────────────────
DO $$
DECLARE
  v_id uuid;
  v_inst jsonb;
BEGIN
  SELECT s.id, s.installments INTO v_id, v_inst
    FROM public.students s JOIN public.companies co ON co.id = s.company_id
   WHERE co.name = 'Liberty - GC' AND s.name ILIKE 'GLADYS RODRIGO%'
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'Gladys: ficha não encontrada — nada alterado';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_inst) i
     WHERE i->>'dueDate' = '2026-06-15' AND abs((i->>'value')::numeric - 4000) < 0.01
       AND coalesce((i->>'paid')::boolean, false) AND i->>'paidMarkedAt' IS NULL
  ) THEN
    RAISE NOTICE 'Gladys: parcela de 15/06 já tem rastro de baixa (ou não está paga) — nada alterado';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE
             WHEN i->>'dueDate' = '2026-06-15' AND abs((i->>'value')::numeric - 4000) < 0.01
             THEN i || jsonb_build_object(
                    'paid', true,
                    'paidDate', '2026-06-15',
                    'paidValue', 4000,
                    'paidMarkedAt', '2026-06-15T12:00:00.000Z',
                    'tags', coalesce(i->'tags', '[]'::jsonb)
                  )
             ELSE i
           END ORDER BY ord)
    INTO v_inst
    FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(i, ord);

  UPDATE public.students
     SET installments = v_inst,
         history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'type', 'Sistema',
           'text', 'Correção (09/09/2026): parcela 2 (R$ 4.000,00, 15/06/2026) constava paga sem data/rastro de baixa e não entrava no card Pago. Registrada como paga em 15/06/2026 (célula verde de junho na planilha Liberty).'
         )),
         updated_at = now()
   WHERE id = v_id;
  RAISE NOTICE 'Gladys: parcela 2 (15/06) com baixa registrada.';
END $$;

-- ─── 2) e 3) Entrada → parcela 1 paga ────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.gc_entrada_vira_parcela_paga(
  p_nome_ilike text,
  p_entrada numeric,
  p_data date,
  p_qtd_boletos int,
  p_valor_boleto numeric
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
  v_nome text;
  v_inst jsonb;
  v_nova jsonb;
  v_pagas int;
  v_dt text := to_char(p_data, 'YYYY-MM-DD');
BEGIN
  SELECT s.id, s.name, s.installments INTO v_id, v_nome, v_inst
    FROM public.students s JOIN public.companies co ON co.id = s.company_id
   WHERE co.name = 'Liberty - GC' AND s.name ILIKE p_nome_ilike
     AND abs(coalesce(s.down_payment, 0) - p_entrada) < 0.01
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE '%: ficha com entrada de % não encontrada — nada alterado', p_nome_ilike, p_entrada;
    RETURN;
  END IF;
  IF NOT (
    jsonb_array_length(v_inst) = p_qtd_boletos
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_inst) i WHERE abs((i->>'value')::numeric - p_valor_boleto) >= 0.01)
  ) THEN
    RAISE NOTICE '%: parcelas fora do esperado (% x %) — nada alterado', v_nome, p_qtd_boletos, p_valor_boleto;
    RETURN;
  END IF;

  v_nova := jsonb_build_array(jsonb_build_object(
    'number', 1,
    'value', p_entrada,
    'dueDate', v_dt,
    'paid', true,
    'paidDate', v_dt,
    'paidValue', p_entrada,
    'paidMarkedAt', v_dt || 'T12:00:00.000Z',
    'tags', '[]'::jsonb,
    'observacao', format('Pagamento de R$ %s em %s (planilha Liberty, célula verde). Estava registrado como entrada da venda; convertido em parcela para constar no Pago.',
                         to_char(p_entrada, 'FM999G999G990D00'), to_char(p_data, 'DD/MM/YYYY'))
  ));
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
           'text', format('Correção (09/09/2026): os R$ %s pagos em %s estavam gravados como entrada da venda e não entravam no card Pago. Passaram a ser a parcela 1 (paga em %s); os %s boletos de R$ %s são agora as parcelas 2 a %s. Valor do contrato e saldo em aberto não mudam.',
                          to_char(p_entrada, 'FM999G999G990D00'), to_char(p_data, 'DD/MM/YYYY'), to_char(p_data, 'DD/MM/YYYY'),
                          p_qtd_boletos, to_char(p_valor_boleto, 'FM999G999G990D00'), p_qtd_boletos + 1)
         )),
         updated_at = now()
   WHERE id = v_id;
  RAISE NOTICE '%: entrada de % virou parcela 1 paga em % (% parcelas, % pagas).', v_nome, p_entrada, v_dt, jsonb_array_length(v_nova), v_pagas;
END $$;

SELECT pg_temp.gc_entrada_vira_parcela_paga('JOSE RENATO OT%VIO%', 10900, '2026-06-28', 5, 2500);
SELECT pg_temp.gc_entrada_vira_parcela_paga('Daiane Cardoso Le%o%', 6000, '2026-07-15', 5, 4000);

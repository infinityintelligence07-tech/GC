-- Correção do contrato de SOLANGE LEAL PAIXÃO — Confronto (IAM - GC, 08/09/2026).
--
-- Contrato: R$ 11.662,50 = entrada R$ 4.000,00 no cartão (19/07/2026, dois
-- lançamentos na Kamino: R$ 2.300,00 + R$ 1.700,00) + 2 boletos de R$ 3.831
-- (31/08 e 30/09/2026).
--
-- A planilha Kamino usada na importação de 28/08 trazia só o lançamento de
-- R$ 1.700,00 do cartão; o de R$ 2.300,00 não estava no export. A ficha ficou
-- com contrato R$ 9.362,00 (= 1.700 + 3.831 + 3.831) e a entrada de R$ 2.300
-- sumiu do "Pago". A Kamino hoje mostra os dois lançamentos pagos em 19/07.
--
-- Insere o lançamento de R$ 2.300,00 (pago 19/07/2026, mesmas tags do cartão
-- de R$ 1.700), renumera as parcelas e ajusta o total do contrato para
-- R$ 11.662,00 (soma dos lançamentos Kamino). Staging Kamino alinhado para a
-- próxima sincronização não desfazer a correção.

DO $$
DECLARE
  v_id uuid := '14aed068-8bba-4181-9a5b-70e917987410';
  v_stud public.students%ROWTYPE;
  v_inst jsonb;
  v_antes jsonb;
  v_hist jsonb;
  v_tags_cartao jsonb := '["6618a678-280e-4b76-8cd2-f2872d8406c0", "313c5b97-5823-4d57-87e4-8c0611a58acd"]'::jsonb;
  v_tags_boleto jsonb := '["313c5b97-5823-4d57-87e4-8c0611a58acd"]'::jsonb;
BEGIN
  SELECT * INTO v_stud FROM public.students WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'Ficha da Solange não encontrada';
    RETURN;
  END IF;

  -- Idempotente: já tem o lançamento de R$ 2.300.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(v_stud.installments, '[]'::jsonb)) i
    WHERE (i->>'value')::numeric = 2300
  ) THEN
    RAISE NOTICE 'Contrato da Solange já corrigido';
    RETURN;
  END IF;

  v_inst := jsonb_build_array(
    jsonb_build_object('number', 1, 'value', 2300, 'dueDate', '2026-07-19', 'paid', true,
                       'paidDate', '2026-07-19', 'paidValue', 2300, 'tags', v_tags_cartao),
    jsonb_build_object('number', 2, 'value', 1700, 'dueDate', '2026-07-19', 'paid', true,
                       'paidDate', '2026-07-19', 'paidValue', 1700, 'tags', v_tags_cartao),
    jsonb_build_object('number', 3, 'value', 3831, 'dueDate', '2026-08-31', 'paid', false, 'tags', v_tags_boleto),
    jsonb_build_object('number', 4, 'value', 3831, 'dueDate', '2026-09-30', 'paid', false, 'tags', v_tags_boleto)
  );

  v_antes := jsonb_build_object(
    'saleValue', v_stud.sale_value,
    'downPayment', v_stud.down_payment,
    'totalInstallments', v_stud.total_installments,
    'paidInstallments', v_stud.paid_installments,
    'installments', v_stud.installments,
    'status', v_stud.status
  );

  v_hist := jsonb_build_object(
    'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Entrada corrigida conforme Kamino: incluído o lançamento de R$ 2.300,00 no cartão pago em 19/07/2026 '
            || '(faltava na planilha da importação de 28/08). Entrada total R$ 4.000,00 (2.300 + 1.700) + 2 boletos de R$ 3.831,00. '
            || 'Contrato R$ 9.362,00 → R$ 11.662,00.'
  );

  UPDATE public.students
     SET installments = v_inst,
         total_installments = 4,
         paid_installments = 2,
         sale_value = 11662,
         status = 'Vencido 1',
         status_mode = 'Automático',
         history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(v_hist)
   WHERE id = v_id;

  -- Staging Kamino: mesma estrutura, para o próximo sync não voltar a R$ 9.362.
  UPDATE public._kamino_sync_staging k
     SET sale_value = 11662,
         total_installments = 4,
         paid_installments = 2,
         installments = (
           SELECT jsonb_agg(i - 'tags' - 'paidValue' ORDER BY (i->>'number')::int)
           FROM jsonb_array_elements(v_inst) i
         ),
         detalhes = 'Confronto - Ipr_Lon_224 | Jul26 | Cartão de Crédito + Boleto | Venda | Conf_Am_57 | Cartão de Crédito | '
                    || coalesce(k.detalhes, '')
   WHERE k.skey = 'solange leal paixão||confronto'
     AND coalesce(k.sale_value, 0) = 9362;

  INSERT INTO public.conciliacao_items
    (tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status,
     conciliado_at, conciliado_por_nome, conciliado_nota, company_id)
  VALUES
    ('correcao_contrato', v_id, v_stud.name, v_stud.ac,
     'Entrada corrigida conforme Kamino: + R$ 2.300,00 cartão pago 19/07/2026. Contrato R$ 9.362,00 → R$ 11.662,00 (entrada 4.000 + 2× 3.831).',
     v_antes,
     jsonb_build_object(
       'saleValue', 11662, 'downPayment', 0, 'totalInstallments', 4, 'paidInstallments', 2,
       'installments', v_inst, 'status', 'Vencido 1'
     ),
     'Sistema', 'conciliado', now(), 'Sistema',
     'Kamino mostra dois lançamentos de cartão pagos em 19/07/2026 (R$ 2.300 + R$ 1.700); o de R$ 2.300 não veio na planilha importada em 28/08.',
     v_stud.company_id);
END $$;

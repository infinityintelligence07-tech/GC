-- Correção do contrato de ANGELICA LEA SERVIÇOS AMBULATORIAIS — Missão Governar
-- (IAM - GC, 08/09/2026).
--
-- A ficha foi importada em 28/08 com o fluxo de pagamento colapsado: entrada
-- R$ 10.000 + UMA parcela de R$ 22.461,00 marcada como paga em 20/07/2026, o
-- que deixou o contrato "todo pago" e impedia formalizar o cancelamento (o
-- modal apontava divergência: Kamino R$ 11.871,75 × fluxo R$ 32.461,00).
--
-- Kamino (staging da sincronização): 12 boletos de R$ 1.871,75 (2/13 a 13/13;
-- 1/13 é a entrada), parcela 1 paga em 20/07/2026, parcelas 2–12 em aberto de
-- 25/08/2026 a 25/06/2027. Total pago real = 10.000 + 1.871,75 = 11.871,75.
--
-- Reconstrói o fluxo a partir do Kamino, mantendo contrato R$ 32.461 e entrada
-- R$ 10.000. Status volta ao automático (parcela de 25/08 vencida → Vencido 1).

DO $$
DECLARE
  v_id uuid := '04737335-93c5-47d5-8e91-667e3699224e';
  v_stud public.students%ROWTYPE;
  v_kamino_inst jsonb;
  v_antes jsonb;
  v_hist jsonb;
BEGIN
  SELECT * INTO v_stud FROM public.students WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'Ficha não encontrada';
    RETURN;
  END IF;

  -- Idempotente: já reconstruída.
  IF coalesce(jsonb_array_length(v_stud.installments), 0) = 12 THEN
    RAISE NOTICE 'Contrato já corrigido';
    RETURN;
  END IF;

  SELECT k.installments INTO v_kamino_inst
  FROM public._kamino_sync_staging k
  WHERE k.skey = 'angelica lea serviços ambulatoriais||missão governar';
  IF v_kamino_inst IS NULL OR jsonb_array_length(v_kamino_inst) <> 12 THEN
    RAISE EXCEPTION 'Staging Kamino da Angelica não tem as 12 parcelas esperadas';
  END IF;

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
    'text', 'Fluxo de pagamento corrigido conforme Kamino: entrada R$ 10.000,00 + 12 parcelas de R$ 1.871,75 '
            || '(parcela 1 paga em 20/07/2026; 2–12 em aberto). Antes constava 1 parcela de R$ 22.461,00 paga, '
            || 'deixando o contrato indevidamente quitado.'
  );

  UPDATE public.students
     SET installments = v_kamino_inst,
         total_installments = 12,
         paid_installments = 1,
         down_payment = 10000,
         sale_value = 32461,
         status = 'Vencido 1',
         status_mode = 'Automático',
         history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(v_hist)
   WHERE id = v_id;

  INSERT INTO public.conciliacao_items
    (tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status,
     conciliado_at, conciliado_por_nome, conciliado_nota, company_id)
  VALUES
    ('correcao_contrato', v_id, v_stud.name, v_stud.ac,
     'Fluxo reconstruído conforme Kamino: entrada R$ 10.000,00 + 12× R$ 1.871,75 (1 paga, 11 em aberto). Antes: 1 parcela de R$ 22.461,00 paga.',
     v_antes,
     jsonb_build_object(
       'saleValue', 32461, 'downPayment', 10000, 'totalInstallments', 12, 'paidInstallments', 1,
       'installments', v_kamino_inst, 'status', 'Vencido 1'
     ),
     'Sistema', 'conciliado', now(), 'Sistema',
     'Corrigido para permitir o cancelamento: total pago real R$ 11.871,75 (entrada + parcela 1), saldo em aberto R$ 20.589,25.',
     v_stud.company_id);
END $$;

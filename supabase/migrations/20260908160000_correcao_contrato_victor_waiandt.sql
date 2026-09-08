-- Correção do contrato de VICTOR GUEDES WAIANDT — Missão Governar (IAM - GC, 08/09/2026).
--
-- Mesmo colapso da Angelica Lea (20260908140000): a sync IAM (contrato 510,
-- status NOVO) reescreveu o fluxo em 03/09 como entrada R$ 2.000 + UMA parcela
-- de R$ 18.020,00 paga em 22/07/2026 — contrato "Pago" à vista, sumindo da
-- carteira do assessor enquanto o Kamino segue cobrando 10 boletos de R$ 1.802.
--
-- Fonte: staging Kamino (10 × R$ 1.802,00, parcela 1 paga 22/07/2026, 2–10 em
-- aberto de 25/08/2026 a 25/04/2027) + Conciliação GC de 28/08/2026, que já
-- registrou a parcela 2 paga em 27/08/2026 (baixa Kamino refeita com a data
-- certa — item pagamento_parcela conciliado por Carol Romera).
--
-- Reconstrói: contrato R$ 20.020 (entrada R$ 2.000 + 10 × 1.802), 2 pagas,
-- 8 em aberto (25/09/2026 a 25/04/2027) → Em Dia. Data do contrato 21/06/2026
-- (venda do MG, informada pelo Financeiro; constava 01/05 = matrícula antiga).
-- Marca iam_gc_conciliado_at para o contrato voltar a contar na carteira e na
-- dashboard (sem isso, vínculo IAM em NOVO deixa a ficha fora dos totais).

DO $$
DECLARE
  v_id uuid := 'eec8a575-e969-4f2c-afb7-685b0409e3cb';
  v_stud public.students%ROWTYPE;
  v_kamino_inst jsonb;
  v_inst jsonb;
  v_antes jsonb;
  v_hist jsonb;
BEGIN
  SELECT * INTO v_stud FROM public.students WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'Ficha não encontrada';
    RETURN;
  END IF;

  -- Idempotente: já reconstruída.
  IF coalesce(jsonb_array_length(v_stud.installments), 0) = 10 THEN
    RAISE NOTICE 'Contrato já corrigido';
    RETURN;
  END IF;

  SELECT k.installments INTO v_kamino_inst
  FROM public._kamino_sync_staging k
  WHERE k.skey = 'victor guedes waiandt||missão governar';
  IF v_kamino_inst IS NULL OR jsonb_array_length(v_kamino_inst) <> 10 THEN
    RAISE EXCEPTION 'Staging Kamino do Victor não tem as 10 parcelas esperadas';
  END IF;

  -- Parcela 2: paga em 27/08/2026 conforme Conciliação GC (28/08).
  SELECT jsonb_agg(
           CASE WHEN (i->>'number')::int = 2
                THEN i || jsonb_build_object('paid', true, 'paidDate', '2026-08-27', 'paidValue', 1802)
                ELSE i END
           ORDER BY (i->>'number')::int)
    INTO v_inst
  FROM jsonb_array_elements(v_kamino_inst) i;

  v_antes := jsonb_build_object(
    'saleValue', v_stud.sale_value,
    'downPayment', v_stud.down_payment,
    'totalInstallments', v_stud.total_installments,
    'paidInstallments', v_stud.paid_installments,
    'installments', v_stud.installments,
    'status', v_stud.status,
    'enrollmentDate', v_stud.enrollment_date,
    'iamGcConciliadoAt', v_stud.iam_gc_conciliado_at
  );

  v_hist := jsonb_build_object(
    'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Fluxo de pagamento corrigido conforme Kamino: entrada R$ 2.000,00 + 10 parcelas de R$ 1.802,00 '
            || '(parcelas 1 e 2 pagas em 22/07 e 27/08/2026; 3–10 em aberto de 25/09/2026 a 25/04/2027). '
            || 'Antes constava 1 parcela de R$ 18.020,00 paga, deixando o contrato indevidamente quitado à vista. '
            || 'Data do contrato corrigida de 01/05/2026 para 21/06/2026. Contrato reconhecido na carteira GC.'
  );

  UPDATE public.students
     SET installments = v_inst,
         total_installments = 10,
         paid_installments = 2,
         down_payment = 2000,
         sale_value = 20020,
         enrollment_date = '2026-06-21',
         data_treinamento_origem = '2026-06-21',
         status = 'Em Dia',
         status_mode = 'Automático',
         iam_gc_conciliado_at = coalesce(iam_gc_conciliado_at, now()),
         history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(v_hist),
         updated_at = now()
   WHERE id = v_id;

  INSERT INTO public.conciliacao_items
    (tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status,
     conciliado_at, conciliado_por_nome, conciliado_nota, company_id)
  VALUES
    ('correcao_contrato', v_id, v_stud.name, v_stud.ac,
     'Fluxo reconstruído conforme Kamino: entrada R$ 2.000,00 + 10× R$ 1.802,00 (2 pagas, 8 em aberto). Antes: 1 parcela de R$ 18.020,00 paga (à vista).',
     v_antes,
     jsonb_build_object(
       'saleValue', 20020, 'downPayment', 2000, 'totalInstallments', 10, 'paidInstallments', 2,
       'installments', v_inst, 'status', 'Em Dia', 'enrollmentDate', '2026-06-21'
     ),
     'Sistema', 'conciliado', now(), 'Sistema',
     'Corrigido a pedido do Financeiro: contrato parcelado em 10x constava como à vista. Total pago real R$ 5.604,00 (entrada + parcelas 1 e 2), saldo em aberto R$ 14.416,00.',
     v_stud.company_id);
END $$;

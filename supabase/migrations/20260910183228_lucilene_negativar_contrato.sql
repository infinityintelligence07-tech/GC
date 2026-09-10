-- Lucilene dos Santos Barbosa (Confronto) — desfecho correto: NEGATIVAR CONTRATO.
--
-- A conciliação de 10/09 aplicou a baixa padrão: 12 parcelas (R$ 12.437,16)
-- saíram da carteira e ficou só 1 parcela de multa (R$ 4.271,15) com
-- 'pagamento_multa_pendente'. Regra do financeiro: a aluna recusou a multa
-- ("Seguir com a negativação"), então o contrato inteiro vai para negativação
-- e a dashboard não muda. Restaura as 12 parcelas a partir do snapshot
-- guardado no item de conciliação, marca a ficha "À Negativar" (Manual) e
-- encerra o caso como Negativação.
DO $$
DECLARE
  v_student uuid := '39653ac8-bdcb-4e5f-888e-cd941497af71';
  v_case    uuid := '4a8e8a05-cd7c-4810-8869-7461ec53f4d9';
  v_item    uuid := '04177c90-b46b-4605-9350-a123e88c7993';
  v_parcelas jsonb;
  v_aberto   numeric;
  v_now      timestamptz := now();
BEGIN
  SELECT ci.antes->'_snapshot'->'installments' INTO v_parcelas
  FROM public.conciliacao_items ci WHERE ci.id = v_item;

  IF v_parcelas IS NULL OR jsonb_typeof(v_parcelas) <> 'array' OR jsonb_array_length(v_parcelas) <> 12 THEN
    RAISE EXCEPTION 'snapshot das 12 parcelas da Lucilene não encontrado no item %', v_item;
  END IF;

  SELECT sum((i->>'value')::numeric) INTO v_aberto
  FROM jsonb_array_elements(v_parcelas) i WHERE NOT coalesce((i->>'paid')::boolean, false);

  UPDATE public.students s SET
    installments        = v_parcelas,
    total_installments  = 12,
    paid_installments   = 0,
    installment_value   = 1036.43,
    status              = 'À Negativar',
    status_mode         = 'Manual',
    status_cancelamento = 'negativacao',
    history             = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_jsonb(v_now),
      'type', 'Sistema',
      'text', 'Correção do desfecho do cancelamento: NEGATIVAÇÃO DO CONTRATO. Aluna recusou a multa (R$ 4.271,15); as 12 parcelas (R$ 12.437,16) voltaram para a ficha, a parcela de multa foi removida e o status passou a "À Negativar" (Manual). O cancelamento não altera a dashboard. Após negativar nos órgãos de crédito, mude para "Negativado".'
    )),
    updated_at          = v_now
  WHERE s.id = v_student
    AND s.status_cancelamento = 'pagamento_multa_pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ficha da Lucilene não está mais em pagamento_multa_pendente — nada alterado';
  END IF;

  UPDATE public.cancellation_cases c SET
    stage                            = 'Iniciar Negativação',
    operational_status               = 'Cancelado',
    funnel_stage                     = 'Finalizado',
    acao                             = 'Negativação',
    negativar_contrato               = true,
    cancellation_reviewed_installments = v_parcelas,
    moved_to_current_stage_at        = v_now,
    history                          = coalesce(c.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_jsonb(v_now),
      'from', c.stage,
      'to', 'Iniciar Negativação',
      'operationalStatus', 'Cancelado',
      'note', 'Desfecho corrigido para NEGATIVAÇÃO DO CONTRATO: aluna recusou a multa. Baixa de 10/09 desfeita — as 12 parcelas (R$ 12.437,16) seguem na carteira como "À Negativar"; nenhuma parcela de multa fica na ficha.',
      'byName', 'Sistema GC'
    )),
    updated_at                       = v_now
  WHERE c.id = v_case;

  UPDATE public.conciliacao_items ci SET
    resumo = 'Cancelamento com NEGATIVAÇÃO DO CONTRATO — Lucilene dos Santos Barbosa. Aluna recusou a multa de R$ 4.271,15; o contrato inteiro (R$ 12.437,16 em aberto) segue na carteira como "À Negativar". Nada é baixado — a dashboard não muda.',
    depois = (ci.depois - 'totalNegativar' - 'totalNegativarBase' - 'multaDeduzidaDoPago') || jsonb_build_object(
      'stage', 'Iniciar Negativação',
      'statusCancelamento', 'negativacao',
      'parcelas', '12 pendentes mantidas (R$ 12.437,16) — contrato inteiro a negativar; nenhuma parcela baixada',
      'negativarContrato', true,
      'contratoNegativar', v_aberto,
      'impactoCarteira', 0,
      'impactoCarteiraNota', 'Contrato permanece na carteira como "À Negativar" — o cancelamento não altera a dashboard.'
    ),
    conciliado_nota = concat_ws(' | ', ci.conciliado_nota,
      'Desfecho corrigido em ' || to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ': negativação do contrato — baixa das 12 parcelas desfeita, ficha À Negativar.'),
    updated_at = v_now
  WHERE ci.id = v_item;

  RAISE NOTICE 'Lucilene: 12 parcelas restauradas, % em aberto, ficha À Negativar / negativacao', v_aberto;
END $$;

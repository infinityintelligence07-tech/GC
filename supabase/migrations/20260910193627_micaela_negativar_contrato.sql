-- Micaela Dias Farias (PMR) — desfecho correto: NEGATIVAR CONTRATO.
--
-- Conciliada em 10/09 16:27 com a baixa padrão ("Negativar Multa"): as 10
-- parcelas pendentes (R$ 8.270,00) saíram e ficou 1 parcela de multa
-- (R$ 2.841,00) em 'pagamento_multa_pendente'. Mesma regra aplicada à Lucilene:
-- a aluna não paga a multa → o contrato inteiro vai para negativação, nada é
-- baixado e a dashboard não muda. Restaura as 11 parcelas (1 paga + 10 em
-- aberto) e o valor do contrato (R$ 9.470,00) a partir do snapshot guardado no
-- item de conciliação, marca a ficha "À Negativar" (Manual) e encerra o caso
-- como Negativação.
DO $$
DECLARE
  v_student uuid := 'f9f7a6a6-7518-4974-8b96-ec9ad25778bb';
  v_case    uuid := '593e8cd1-4982-40b9-a202-4464028fd31e';
  v_item    uuid := 'b357dbdf-7d48-43c9-b768-970a975b6351';
  v_snap     jsonb;
  v_parcelas jsonb;
  v_aberto   numeric;
  v_pagas    int;
  v_now      timestamptz := now();
BEGIN
  SELECT ci.antes->'_snapshot' INTO v_snap FROM public.conciliacao_items ci WHERE ci.id = v_item;
  v_parcelas := v_snap->'installments';

  IF v_parcelas IS NULL OR jsonb_typeof(v_parcelas) <> 'array' OR jsonb_array_length(v_parcelas) <> 11 THEN
    RAISE EXCEPTION 'snapshot das 11 parcelas da Micaela não encontrado no item %', v_item;
  END IF;

  SELECT
    sum((i->>'value')::numeric) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false)),
    count(*) FILTER (WHERE coalesce((i->>'paid')::boolean, false))
    INTO v_aberto, v_pagas
  FROM jsonb_array_elements(v_parcelas) i;

  UPDATE public.students s SET
    installments        = v_parcelas,
    total_installments  = 11,
    paid_installments   = v_pagas,
    sale_value          = (v_snap->>'saleValue')::numeric,
    installment_value   = 827,
    status              = 'À Negativar',
    status_mode         = 'Manual',
    status_cancelamento = 'negativacao',
    history             = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_jsonb(v_now),
      'type', 'Sistema',
      'text', 'Correção do desfecho do cancelamento: NEGATIVAÇÃO DO CONTRATO. Aluna não paga a multa (R$ 2.841,00); as 11 parcelas do contrato (1 paga R$ 1.200,00 + 10 em aberto R$ 8.270,00) e o valor do contrato (R$ 9.470,00) voltaram para a ficha, a parcela de multa foi removida e o status passou a "À Negativar" (Manual). O cancelamento não altera a dashboard. Após negativar nos órgãos de crédito, mude para "Negativado".'
    )),
    updated_at          = v_now
  WHERE s.id = v_student
    AND s.status_cancelamento = 'pagamento_multa_pendente';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ficha da Micaela não está mais em pagamento_multa_pendente — nada alterado';
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
      'note', 'Desfecho corrigido para NEGATIVAÇÃO DO CONTRATO: aluna não paga a multa. Baixa de 10/09 desfeita — as 10 parcelas em aberto (R$ 8.270,00) seguem na carteira como "À Negativar"; nenhuma parcela de multa fica na ficha.',
      'byName', 'Sistema GC'
    )),
    updated_at                       = v_now
  WHERE c.id = v_case;

  UPDATE public.conciliacao_items ci SET
    resumo = 'Cancelamento com NEGATIVAÇÃO DO CONTRATO — Micaela Dias Farias. Aluna não paga a multa de R$ 2.841,00; o contrato inteiro (R$ 8.270,00 em aberto) segue na carteira como "À Negativar". Nada é baixado — a dashboard não muda.',
    depois = (ci.depois - 'totalNegativar' - 'totalNegativarBase' - 'multaDeduzidaDoPago') || jsonb_build_object(
      'stage', 'Iniciar Negativação',
      'statusCancelamento', 'negativacao',
      'parcelas', '10 pendentes mantidas (R$ 8.270,00) — contrato inteiro a negativar; nenhuma parcela baixada',
      'negativarContrato', true,
      'contratoNegativar', v_aberto,
      'impactoCarteira', 0,
      'impactoCarteiraNota', 'Contrato permanece na carteira como "À Negativar" — o cancelamento não altera a dashboard.'
    ),
    conciliado_nota = concat_ws(' | ', ci.conciliado_nota,
      'Desfecho corrigido em ' || to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ': negativação do contrato — baixa das 10 parcelas desfeita, ficha À Negativar.'),
    updated_at = v_now
  WHERE ci.id = v_item;

  RAISE NOTICE 'Micaela: 11 parcelas restauradas, % em aberto, ficha À Negativar / negativacao', v_aberto;
END $$;

-- Reparo de dados: aprovações "IAM CONTROL → GC" de 03/09 apagadas pelo pull.
--
-- Restaura iam_gc_conciliado_at (data da conciliação do item) e a visão GC
-- CONCILIADO para toda ficha IAM que tem item iam_pendente conciliado mas está
-- sem aprovação e ainda com status pendente/para conciliar — exatamente o que
-- a migração 20260903131000 passa a impedir. Status volta a Automático.
--
-- Caso Edelvan Lopes (PENDENTE_PIX): o pull também reescreveu o financeiro e
-- apagou o parcelamento 2x R$ 7.000 feito pela Carol no GC (parcela 1 paga em
-- 23/08). Restaurado a partir do "depois" do item parcela_quantidade.

WITH aprovados AS (
  SELECT DISTINCT ON (ci.student_id)
         ci.student_id,
         ci.conciliado_at,
         ci.conciliado_por_nome,
         upper(nullif(btrim(ci.antes->>'iam_control_contrato_status'), '')) AS status_iam_na_aprovacao
  FROM public.conciliacao_items ci
  WHERE ci.tipo = 'iam_pendente'
    AND ci.status = 'conciliado'
    AND ci.student_id IS NOT NULL
  ORDER BY ci.student_id, ci.conciliado_at DESC NULLS LAST, ci.created_at DESC
),
alvo AS (
  SELECT s.id, a.conciliado_at, a.conciliado_por_nome, a.status_iam_na_aprovacao,
         upper(coalesce(s.iam_control_contrato_status, '')) AS status_atual
  FROM public.students s
  JOIN aprovados a ON a.student_id = s.id
  WHERE s.iam_control_aluno_id IS NOT NULL
    AND s.iam_gc_conciliado_at IS NULL
    AND upper(coalesce(s.iam_control_contrato_status, '')) IN ('PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR')
    AND coalesce(s.status, '') NOT IN ('Cancelado', 'Solicitação Cancelamento')
)
UPDATE public.students s SET
  iam_gc_conciliado_at = coalesce(a.conciliado_at, now()),
  iam_control_status_origem = coalesce(s.iam_control_status_origem, a.status_atual),
  iam_control_contrato_status = 'CONCILIADO',
  status_mode = 'Automático',
  status = (
    SELECT CASE
      WHEN count(*) = 0 THEN CASE WHEN coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01 AND coalesce(s.sale_value, 0) > 0 THEN 'Pago' ELSE 'Em Dia' END
      WHEN count(*) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false)) = 0 THEN 'Pago'
      WHEN count(*) FILTER (WHERE coalesce((i->>'paid')::boolean, false)) = 0
       AND count(*) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false) AND (i->>'dueDate')::date < (now() at time zone 'America/Sao_Paulo')::date) = 0
       AND count(*) > 1 THEN 'Aluno Novo'
      WHEN count(*) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false) AND (i->>'dueDate')::date < (now() at time zone 'America/Sao_Paulo')::date) = 0 THEN 'Em Dia'
      WHEN (now() at time zone 'America/Sao_Paulo')::date - min((i->>'dueDate')::date) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false) AND (i->>'dueDate')::date < (now() at time zone 'America/Sao_Paulo')::date) <= 30 THEN 'Vencido 1'
      WHEN (now() at time zone 'America/Sao_Paulo')::date - min((i->>'dueDate')::date) FILTER (WHERE NOT coalesce((i->>'paid')::boolean, false) AND (i->>'dueDate')::date < (now() at time zone 'America/Sao_Paulo')::date) <= 60 THEN 'Vencido 2'
      ELSE 'À Negativar'
    END
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.installments) = 'array' THEN s.installments ELSE '[]'::jsonb END) i
  ),
  history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Reparo IAM: aprovação da Conciliação GC (' || coalesce(a.conciliado_por_nome, 'Conciliação') || ', '
            || to_char(coalesce(a.conciliado_at, now()) at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
            || ') havia sido desfeita pelo sync do IAM Control (contrato ainda ' || replace(a.status_atual, '_', ' ')
            || ' no IAM). Aprovação restaurada; volta a contar na carteira e nos totais.'
  ))
FROM alvo a
WHERE s.id = a.id;

-- Edelvan Lopes Pereira — Missão Governar: restaura 2x R$ 7.000 (1ª paga 23/08).
UPDATE public.students s SET
  installments = '[
    {"paid": true,  "tags": ["entrada-pendente"], "value": 7000, "number": 1, "dueDate": "2026-08-23", "paidDate": "2026-08-23", "paidValue": 7000, "paidMarkedAt": "2026-09-03T00:36:34.813Z"},
    {"paid": false, "tags": ["entrada-pendente"], "value": 7000, "number": 2, "dueDate": "2026-09-23"}
  ]'::jsonb,
  total_installments = 2,
  paid_installments = 1,
  installment_value = 7000,
  down_payment = 0,
  status = 'Em Dia',
  status_mode = 'Automático',
  history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Reparo IAM: o sync do IAM Control havia reescrito o financeiro (1x R$ 14.000 paga). Restaurado o ajuste feito no GC em 03/09: 2 parcelas de R$ 7.000 — 1ª paga em 23/08/2026, 2ª vence em 23/09/2026.'
  ))
WHERE s.id = 'f4032cab-8475-46d8-bdd3-be8370948be7'
  AND s.iam_control_contrato_id = '1500'
  AND coalesce(s.total_installments, 0) = 1
  AND coalesce(s.installment_value, 0) = 14000;

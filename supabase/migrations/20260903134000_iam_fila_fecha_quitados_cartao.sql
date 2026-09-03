-- Contratos IAM CONCILIADO que, após o reparo do cartão de crédito
-- (20260903130000/133000), ficaram quitados à vista: pela regra vigente
-- (20260826000000) entram direto na dashboard, sem aprovação GC. Fecha os
-- itens que ainda estavam na fila IAM CONTROL → GC e grava a aprovação.

WITH quitados AS (
  SELECT s.id
  FROM public.students s
  WHERE s.iam_control_aluno_id IS NOT NULL
    AND upper(coalesce(s.iam_control_contrato_status, '')) = 'CONCILIADO'
    AND coalesce(s.total_installments, 0) = 0
    AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01
    AND coalesce(s.sale_value, 0) > 0
),
fechados AS (
  UPDATE public.conciliacao_items ci SET
    status = 'conciliado',
    conciliado_at = now(),
    conciliado_por_nome = 'Sistema IAM',
    conciliado_nota = 'Fechado automaticamente: contrato quitado no cartão de crédito / à vista no IAM (entra direto na dashboard, sem aprovação GC).',
    updated_at = now()
  FROM quitados q
  WHERE ci.student_id = q.id
    AND ci.tipo = 'iam_pendente'
    AND ci.status IN ('pendente', 'aprovado')
  RETURNING ci.student_id
)
UPDATE public.students s SET
  iam_gc_conciliado_at = coalesce(s.iam_gc_conciliado_at, now()),
  history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Contrato IAM CONCILIADO quitado (cartão de crédito / à vista): item da fila IAM CONTROL → GC fechado automaticamente; passa a contar na carteira e nos totais.'
  ))
FROM (SELECT DISTINCT student_id FROM fechados) f
WHERE s.id = f.student_id;

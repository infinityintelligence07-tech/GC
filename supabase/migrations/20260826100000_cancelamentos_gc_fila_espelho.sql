-- Fila Cancelamentos → GC: itens espelho para alunos em cancelamento (fora Kamino) sem item aberto.

INSERT INTO public.conciliacao_items (
  company_id, tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status, related_case_id
)
SELECT
  s.company_id,
  'cancelamento',
  s.id,
  s.name,
  s.ac,
  'Espelho GC — cancelamento em andamento (' ||
    replace(coalesce(s.status_cancelamento, 'solicitado'), '_', ' ') ||
    ') — em aberto fora Kamino',
  jsonb_build_object(
    'statusCancelamento', s.status_cancelamento,
    'openBalance', open_val
  ),
  jsonb_build_object(
    'espelho_gc', true,
    'statusCancelamento', coalesce(s.status_cancelamento, 'solicitado'),
    'openBalance', open_val,
    'product', s.product
  ),
  'Sistema GC',
  'pendente',
  cc.id
FROM students s
LEFT JOIN LATERAL (
  SELECT cc2.id
  FROM cancellation_cases cc2
  WHERE cc2.student_id = s.id
    AND cc2.acao IS DISTINCT FROM 'Revertido'
    AND cc2.acao IS DISTINCT FROM 'Cancelado'
  ORDER BY cc2.updated_at DESC NULLS LAST
  LIMIT 1
) cc ON true
CROSS JOIN LATERAL (
  SELECT coalesce((
    SELECT sum((i->>'value')::numeric)
    FROM jsonb_array_elements(coalesce(s.installments, '[]'::jsonb)) i
    WHERE coalesce((i->>'paid')::boolean, false) = false
  ), 0) AS open_val
) ov
WHERE s.status_cancelamento IN ('solicitado', 'em_tratamento', 'juridico', 'aguardando_conciliacao', 'pagamento_multa_pendente')
  AND coalesce(s.status_cancelamento, '') NOT IN ('cancelado', 'revertido')
  AND ov.open_val > 0.0049
  AND NOT EXISTS (
    SELECT 1 FROM conciliacao_items ci
    WHERE ci.student_id = s.id
      AND ci.tipo IN ('cancelamento', 'reversao')
      AND ci.status IN ('pendente', 'aprovado')
  )
  AND NOT EXISTS (
    SELECT 1 FROM conciliacao_items ci
    WHERE ci.student_id = s.id
      AND ci.tipo IN ('cancelamento', 'reversao')
      AND ci.status = 'conciliado'
  );

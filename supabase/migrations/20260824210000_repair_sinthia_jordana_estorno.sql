-- Reparo pontual: Sinthia Gomes da Costa e JORDANA NAVES LOBO
-- Casos importados do Lovable ficaram em Formalização sem refund_plan nem finalização.

WITH sinthia_refund AS (
  SELECT jsonb_build_object(
    'pixKey', 'nitrisinthiag@gmail.com',
    'pixKeyType', 'Email',
    'totalValue', 11662.50,
    'createdAt', '2026-08-18T13:32:26.196Z',
    'installments', jsonb_build_array(
      jsonb_build_object('date', '2026-09-01', 'value', 3887.50, 'lancadoParaPagamento', false),
      jsonb_build_object('date', '2026-10-01', 'value', 3887.50, 'lancadoParaPagamento', false),
      jsonb_build_object('date', '2026-11-03', 'value', 3887.50, 'lancadoParaPagamento', false)
    )
  ) AS plan
), jordana_refund AS (
  SELECT jsonb_build_object(
    'pixKey', '037.529.551-80',
    'pixKeyType', 'CPF',
    'totalValue', 11662.50,
    'createdAt', '2026-08-18T14:49:41.696Z',
    'installments', jsonb_build_array(
      jsonb_build_object('date', '2026-09-09', 'value', 3887.50, 'lancadoParaPagamento', false),
      jsonb_build_object('date', '2026-10-09', 'value', 3887.50, 'lancadoParaPagamento', false),
      jsonb_build_object('date', '2026-11-09', 'value', 3887.50, 'lancadoParaPagamento', false)
    )
  ) AS plan
)
UPDATE public.cancellation_cases cc
SET
  student_id = s.student_id,
  stage = 'Cancelado',
  funnel_stage = 'Finalizado',
  operational_status = 'Cancelado',
  acao = 'Cancelado',
  moved_to_current_stage_at = '2026-08-18T13:47:23.445Z',
  refund_plan = CASE cc.id
    WHEN '2d346f15-d683-4699-9370-7f43594e33ca' THEN (SELECT plan FROM sinthia_refund)
    WHEN '3d003944-cf86-4bfc-87df-e950b95f115a' THEN (SELECT plan FROM jordana_refund)
  END,
  history = cc.history || jsonb_build_array(
    jsonb_build_object(
      'date', '2026-08-18T13:47:23.445Z',
      'from', 'Ajustes em Geral / Boleto',
      'to', 'Assinar Termo',
      'operationalStatus', 'Aguardando',
      'note', 'Cancelamento confirmado (migração Lovable). Estorno 100% em 3 parcelas de R$ 3.887,50.'
    ),
    jsonb_build_object(
      'date', '2026-08-18T13:47:23.500Z',
      'from', 'Assinar Termo',
      'to', 'Cancelado',
      'operationalStatus', 'Cancelado',
      'note', 'Conciliação concluída (importação externa sem multa). Aluno cancelado.'
    )
  ),
  updated_at = now()
FROM (
  VALUES
    ('2d346f15-d683-4699-9370-7f43594e33ca'::uuid, '67fc7944-53b8-40ff-be7b-1af382bb5078'::uuid),
    ('3d003944-cf86-4bfc-87df-e950b95f115a'::uuid, '1b897218-f498-488f-afd3-0c8ce59cc0ca'::uuid)
) AS s(case_id, student_id)
WHERE cc.id = s.case_id
  AND cc.refund_plan IS NULL;

UPDATE public.students
SET
  status = 'Cancelado',
  status_cancelamento = 'cancelado',
  ac = 'Paula Passini',
  cancellation_case_id = CASE id
    WHEN '67fc7944-53b8-40ff-be7b-1af382bb5078' THEN '2d346f15-d683-4699-9370-7f43594e33ca'::uuid
    WHEN '1b897218-f498-488f-afd3-0c8ce59cc0ca' THEN '3d003944-cf86-4bfc-87df-e950b95f115a'::uuid
  END,
  updated_at = now()
WHERE id IN ('67fc7944-53b8-40ff-be7b-1af382bb5078', '1b897218-f498-488f-afd3-0c8ce59cc0ca');

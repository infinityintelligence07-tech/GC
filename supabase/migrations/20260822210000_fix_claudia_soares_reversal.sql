-- Correção pontual: caso Claudia Ribeiro Fernandes Soares (Trainer)
-- Reversão de 31/07 foi sobrescrita por conciliação obsoleta em 06/08.

UPDATE cancellation_cases
SET
  stage = 'Recuperado',
  operational_status = 'Recuperado',
  acao = 'Revertido',
  inscricoes_revertidas = 1,
  moved_to_current_stage_at = NOW(),
  updated_at = NOW(),
  history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'to', 'Recuperado',
      'from', 'Cancelado',
      'date', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'note', 'Correção: conciliação obsoleta de cancelamento sobrescreveu reversão de 31/07. Caso restaurado como revertido.',
      'operationalStatus', 'Recuperado'
    )
  )
WHERE id = '934fb442-a736-4901-99b7-e69c34bacb0e';

UPDATE students
SET
  status = 'Pago',
  status_cancelamento = 'revertido',
  status_mode = 'Automático',
  updated_at = NOW(),
  history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'date', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Correção manual: cancelamento revertido restaurado após conciliação obsoleta. Contrato Trainer ativo (parcelas quitadas).'
    )
  )
WHERE id = '95b72ece-90d4-4ca5-9676-67b10feb0388';

UPDATE commissions
SET
  pending_approval = false,
  updated_at = NOW(),
  observacao = 'Comissão recuperada automaticamente a partir do caso revertido.'
WHERE id = '3fbb4d3c-df93-46d1-9cac-7aedd5615624'
  AND status <> 'cancelada';

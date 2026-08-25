-- Cancelamento ativo deve sobrepor status financeiro (Vencido/Em Dia).
-- Corrige alunos no funil com status_mode Automático e status recalculado.

UPDATE public.students
SET
  status_mode = 'Manual',
  status = CASE
    WHEN status_cancelamento = 'cancelado' THEN 'Cancelado'
    ELSE 'Solicitação Cancelamento'
  END,
  updated_at = now()
WHERE status_cancelamento IN (
  'solicitado',
  'em_tratamento',
  'juridico',
  'aguardando_conciliacao',
  'pagamento_multa_pendente',
  'cancelado'
)
AND (
  status_mode IS DISTINCT FROM 'Manual'
  OR status NOT IN ('Solicitação Cancelamento', 'Cancelado')
);

-- Alunos com caso ativo no funil de cancelamento mas sem status_cancelamento no cadastro.

UPDATE public.students s
SET
  status_cancelamento = 'solicitado',
  status = 'Solicitação Cancelamento',
  status_mode = 'Manual',
  cancellation_case_id = cc.id,
  updated_at = now()
FROM public.cancellation_cases cc
WHERE cc.student_id = s.id
  AND COALESCE(cc.funnel_stage, '') <> 'Finalizado'
  AND COALESCE(cc.acao, '') NOT IN ('Cancelado', 'Revertido')
  AND cc.stage NOT IN ('Cancelado', 'Negativação Efetivada', 'Recuperado')
  AND COALESCE(s.status_cancelamento, 'nenhum') IN ('nenhum', '');

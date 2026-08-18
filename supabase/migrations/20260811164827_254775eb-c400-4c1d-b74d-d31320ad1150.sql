UPDATE public.students s
SET status_cancelamento = 'nenhum',
    cancellation_case_id = NULL,
    status = CASE WHEN s.status = 'Solicitação Cancelamento'
                  THEN COALESCE(NULLIF(s.status_antes_cancelamento, ''), 'Em Dia')
                  ELSE s.status END,
    status_mode = CASE WHEN s.status = 'Solicitação Cancelamento' THEN 'Automático' ELSE s.status_mode END,
    updated_at = now()
WHERE s.cancellation_case_id IS NOT NULL
  AND s.status_cancelamento = 'solicitado'
  AND (
    NOT EXISTS (SELECT 1 FROM public.cancellation_cases c WHERE c.id = s.cancellation_case_id)
    OR EXISTS (SELECT 1 FROM public.cancellation_cases c WHERE c.id = s.cancellation_case_id AND c.student_id IS NOT NULL AND c.student_id <> s.id)
  );
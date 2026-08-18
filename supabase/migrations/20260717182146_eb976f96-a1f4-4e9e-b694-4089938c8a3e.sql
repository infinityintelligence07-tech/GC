ALTER TABLE public.students ADD COLUMN IF NOT EXISTS status_antes_cancelamento text;

COMMENT ON COLUMN public.students.status_antes_cancelamento IS 'Status financeiro do aluno imediatamente antes de uma solicitação de cancelamento; usado para restaurar o status ao excluir o caso de cancelamento.';
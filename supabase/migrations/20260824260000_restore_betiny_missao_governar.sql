-- Betiny | Missão Governar: estava com status_cancelamento='cancelado' (vínculo
-- incorreto com caso de cancelamento do produto Confronto 2), excluindo R$ 3.281,25
-- do KPI. Kamino mantém saldo aberto — reativa na carteira financeira.

UPDATE public.students
SET
  status_cancelamento = 'nenhum',
  cancellation_case_id = NULL,
  updated_at = now()
WHERE id = '1ca0a5a4-a850-462a-ba2f-c279fb751906'
  AND company_id = '00000000-0000-0000-0000-0000000a1a11'
  AND public.gc_student_key(name, product) = 'betiny emanuelle ferreira arcanjo||missão governar';

-- Remove ficha duplicada — LUCIANE MARONI CALDAS | Liberty - GC
-- Mantém 585977ab (contrato IAM Control 1711, conciliado; pendência R$ 10.000,00 paga em 18/09/2026).
-- Remove 440dde75 (importada da planilha "Liberty e Begin | 2026", linha 36, sem CPF;
--   aparecia "Vencido 1" com a mesma pendência em aberto — conciliação reprovada por card duplicado).

BEGIN;

-- Item de conciliação (reprovado) da ficha duplicada
DELETE FROM public.conciliacao_items
WHERE student_id = '440dde75-3195-4b5b-a67b-582b8613bb9f'
  AND status = 'reprovado';

DELETE FROM public.students
WHERE id = '440dde75-3195-4b5b-a67b-582b8613bb9f'
  AND company_id = '67e6e336-4482-4440-90f1-b4be00c5a6cd'
  AND iam_control_contrato_id IS NULL;

COMMIT;

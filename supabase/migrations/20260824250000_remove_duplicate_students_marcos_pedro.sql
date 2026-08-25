-- Remove fichas duplicadas (inflação KPI ~R$ 16.313,32)
-- Marcos Vinícius | Confronto: mantém 48b36ae6 (IAM aluno 6978)
-- Pedro Henrique | Fundo Recompra: mantém dec8ce5c (ficha original + histórico conciliação)

BEGIN;

-- Pedro: limpa itens de conciliação da ficha duplicada antes do delete
DELETE FROM public.conciliacao_items
WHERE student_id = '8a616a97-bb34-4e5f-850b-aac84f6ea5a3';

DELETE FROM public.conciliacao_import_errors
WHERE student_id IN (
  'f1607c65-3194-4379-a525-d37408cd3063',
  '8a616a97-bb34-4e5f-850b-aac84f6ea5a3'
);

DELETE FROM public.commissions
WHERE student_id IN (
  'f1607c65-3194-4379-a525-d37408cd3063',
  '8a616a97-bb34-4e5f-850b-aac84f6ea5a3'
);

DELETE FROM public.students
WHERE id IN (
  'f1607c65-3194-4379-a525-d37408cd3063', -- Marcos duplicata
  '8a616a97-bb34-4e5f-850b-aac84f6ea5a3'  -- Pedro duplicata
)
  AND company_id = '00000000-0000-0000-0000-0000000a1a11';

COMMIT;

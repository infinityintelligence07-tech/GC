-- Complemento de 20260910170000: itens "IAM Control → GC" que ficaram na empresa
-- arquivo "Banco de Dados - Liberty".
--
-- Esses contratos Liberty nasceram na Liberty - GC em 26/08 (roteamento por
-- produto da época), foram para a IAM - GC em 28/08 e, quando a Liberty foi
-- zerada/arquivada em 02/09, os itens antigos foram junto para o arquivo. Como
-- só pode existir 1 item iam_pendente aberto por aluno
-- (conciliacao_items_iam_pendente_aberto_uidx), 4 alunos (Gisele, Richard,
-- Sergio Vieira, Silvio) ficaram com o item aberto preso no arquivo — fora de
-- qualquer fila. Traz todo item de aluno que hoje está na Liberty - GC de volta
-- para a Liberty - GC.
UPDATE public.conciliacao_items ci
SET company_id = s.company_id,
    updated_at = now()
FROM public.students s
WHERE s.id = ci.student_id
  AND s.company_id = (SELECT id FROM public.companies WHERE slug = 'liberty' LIMIT 1)
  AND s.iam_control_aluno_id IS NOT NULL
  AND ci.tipo = 'iam_pendente'
  AND ci.company_id = (SELECT id FROM public.companies WHERE slug = 'banco-de-dados-liberty' LIMIT 1);

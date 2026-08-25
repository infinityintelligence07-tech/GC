-- José Ailton | Liberty: ficha estava na empresa Liberty-GC (fora do dashboard IAM).
-- Para alinhar KPI IAM com Kamino completa + gap, move para IAM - GC.

UPDATE public.students
SET
  company_id = '00000000-0000-0000-0000-0000000a1a11',
  updated_at = now()
WHERE id = '17a0a1ce-a982-40aa-acb8-7ee125878ac4'
  AND public.gc_student_key(name, product) = 'jose ailton dos santos||liberty';

UPDATE public.conciliacao_items
SET
  company_id = '00000000-0000-0000-0000-0000000a1a11',
  updated_at = now()
WHERE student_id = '17a0a1ce-a982-40aa-acb8-7ee125878ac4';

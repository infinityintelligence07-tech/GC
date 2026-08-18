-- Remove cancellation cases duplicados por aluno, mantendo apenas o mais recente.
DELETE FROM public.cancellation_cases c
USING (
  SELECT id, student_id,
    ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at DESC) AS rn
  FROM public.cancellation_cases
  WHERE student_id IS NOT NULL
) dedup
WHERE c.id = dedup.id AND dedup.rn > 1;
UPDATE students
SET iam_control_aluno_id = 3220
WHERE (
  name ILIKE '%Jennifer Nayara Pontes%'
  OR name ILIKE '%JENNIFER NAYARA PONTES%'
)
AND (iam_control_aluno_id IS NULL OR iam_control_aluno_id <> 3220);
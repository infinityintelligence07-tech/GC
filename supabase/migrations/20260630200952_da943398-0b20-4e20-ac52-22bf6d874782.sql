WITH inst AS (
  SELECT s.id, (e.elem->>'value')::numeric AS v,
         COALESCE((e.elem->>'paid')::boolean, false) AS paid
  FROM public.students s
  CROSS JOIN LATERAL jsonb_array_elements(s.installments) AS e(elem)
  WHERE jsonb_typeof(s.installments) = 'array' AND jsonb_array_length(s.installments) > 0
),
ranked AS (
  SELECT id, ROUND(v, 2) AS v, paid, COUNT(*) AS cnt
  FROM inst GROUP BY id, ROUND(v, 2), paid
),
unpaid_mode AS (
  SELECT DISTINCT ON (id) id, v FROM ranked WHERE paid = false
  ORDER BY id, cnt DESC, v DESC
),
all_mode AS (
  SELECT id, v FROM (
    SELECT id, v, ROW_NUMBER() OVER (PARTITION BY id ORDER BY SUM(cnt) DESC, v DESC) AS rn
    FROM ranked GROUP BY id, v
  ) x WHERE rn = 1
),
target AS (
  SELECT am.id, COALESCE(um.v, am.v) AS new_v
  FROM all_mode am LEFT JOIN unpaid_mode um ON um.id = am.id
)
UPDATE public.students s
SET installment_value = t.new_v
FROM target t
WHERE s.id = t.id
  AND ROUND(s.installment_value::numeric, 2) <> ROUND(t.new_v::numeric, 2);
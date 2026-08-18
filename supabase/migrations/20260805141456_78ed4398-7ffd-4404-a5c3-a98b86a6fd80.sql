UPDATE public.conciliacao_items
SET depois = jsonb_set(depois, '{impactoCarteira}', to_jsonb(-1 * (depois->>'impactoCarteira')::numeric))
WHERE tipo = 'cancelamento'
  AND depois ? 'impactoCarteira'
  AND (depois->>'impactoCarteira')::numeric > 0;
-- CONCILIADO quitado no IAM pode sobrescrever financeiro existente no sync (ex.: à vista no evento).

CREATE OR REPLACE FUNCTION public.iam_conciliado_quitado(p_treinamento jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.iam_treinamento_financeiro(p_treinamento) f
    WHERE (
      coalesce(f.total_installments, 0) = 0
      AND coalesce(f.down_payment, 0) >= coalesce(f.sale_value, 0) - 0.01
    ) OR (
      coalesce(f.total_installments, 0) > 0
      AND coalesce(f.paid_installments, 0) >= coalesce(f.total_installments, 0)
    )
  );
$$;

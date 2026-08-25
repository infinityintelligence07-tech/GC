-- Totais do card "Data de Vencimento" alinhados à fonte Kamino (_kamino_sync_staging).

CREATE OR REPLACE FUNCTION public.kamino_dashboard_forecast_totals(
  p_ac text DEFAULT NULL,
  p_product text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH company AS (
    SELECT id
    FROM public.companies
    WHERE active = true
    ORDER BY CASE WHEN name ILIKE '%iam%' THEN 0 ELSE 1 END, name
    LIMIT 1
  ),
  inst AS (
    SELECT
      coalesce(nullif(trim(k.ac), ''), nullif(trim(s.ac), '')) AS ac,
      k.product,
      COALESCE((i->>'paid')::boolean, false) AS paid,
      COALESCE((i->>'value')::numeric, 0) AS value,
      COALESCE(
        NULLIF(i->>'paidValue', '')::numeric,
        (i->>'value')::numeric,
        0
      ) AS paid_value
    FROM public._kamino_sync_staging k
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(k.installments) = 'array' THEN k.installments ELSE '[]'::jsonb END
    ) i
    LEFT JOIN public.students s
      ON public.gc_student_key(s.name, s.product) = k.skey
     AND s.company_id = (SELECT id FROM company)
    WHERE s.id IS NULL
       OR COALESCE(s.status_cancelamento, 'nenhum') <> 'cancelado'
  ),
  filtered AS (
    SELECT *
    FROM inst
    WHERE (NULLIF(trim(coalesce(p_ac, '')), '') IS NULL OR ac = NULLIF(trim(p_ac), ''))
      AND (NULLIF(trim(coalesce(p_product, '')), '') IS NULL OR product = NULLIF(trim(p_product), ''))
  )
  SELECT jsonb_build_object(
    'aVencer', COALESCE(SUM(value) FILTER (WHERE NOT paid), 0),
    'pago', COALESCE(SUM(value) FILTER (WHERE paid), 0),
    'pagoReal', COALESCE(SUM(paid_value) FILTER (WHERE paid), 0),
    'total', COALESCE(SUM(value), 0),
    'qtd', COUNT(*),
    'source', 'kamino_staging'
  )
  FROM filtered;
$$;

COMMENT ON FUNCTION public.kamino_dashboard_forecast_totals IS
  'Totais financeiros da carteira Kamino (staging). Inclui contratos IAM que também existem na Kamino.';

GRANT EXECUTE ON FUNCTION public.kamino_dashboard_forecast_totals(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.kamino_dashboard_forecast_totals(text, text) TO service_role;

-- Mantém os totais da Kamino como base, mas incorpora baixas conciliadas
-- registradas no GC que ainda não chegaram ao staging da Kamino.

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
  raw_inst AS (
    SELECT
      k.skey,
      COALESCE(NULLIF(trim(k.ac), ''), NULLIF(trim(s.ac), '')) AS ac,
      k.product,
      s.id AS student_id,
      COALESCE((i->>'number')::int, 0) AS installment_number,
      COALESCE((i->>'dueDate'), '') AS due_date,
      COALESCE((i->>'paid')::boolean, false) AS staging_paid,
      COALESCE((i->>'value')::numeric, 0) AS value,
      COALESCE(
        NULLIF(i->>'paidValue', '')::numeric,
        (i->>'value')::numeric,
        0
      ) AS staging_paid_value
    FROM public._kamino_sync_staging k
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(k.installments) = 'array' THEN k.installments
        ELSE '[]'::jsonb
      END
    ) i
    LEFT JOIN public.students s
      ON public.gc_student_key(s.name, s.product) = k.skey
     AND s.company_id = (SELECT id FROM company)
    WHERE s.id IS NULL
       OR COALESCE(s.status_cancelamento, 'nenhum') <> 'cancelado'
  ),
  effective_inst AS (
    SELECT
      r.*,
      COALESCE(overlay.has_gc_baixa, false) AS has_gc_baixa,
      COALESCE(overlay.gc_paid_value, 0) AS gc_paid_value
    FROM raw_inst r
    LEFT JOIN LATERAL (
      SELECT
        true AS has_gc_baixa,
        COALESCE(
          NULLIF(ci.depois->>'valor', '')::numeric,
          NULLIF(ci.depois->>'paidValue', '')::numeric,
          r.value
        ) AS gc_paid_value
      FROM public.conciliacao_items ci
      WHERE ci.student_id = r.student_id
        AND ci.status = 'conciliado'
        AND ci.tipo IN ('baixa_kamino', 'pagamento_parcela')
        AND COALESCE((ci.depois->>'paid')::boolean, false)
        AND COALESCE(
          NULLIF(ci.depois->>'numero', '')::int,
          NULLIF(ci.depois->>'parcela', '')::int
        ) = r.installment_number
        AND (
          NULLIF(ci.depois->>'vencimento', '') IS NULL
          OR ci.depois->>'vencimento' = r.due_date
        )
      ORDER BY ci.created_at DESC
      LIMIT 1
    ) overlay ON true
  ),
  filtered AS (
    SELECT *
    FROM effective_inst
    WHERE (NULLIF(trim(coalesce(p_ac, '')), '') IS NULL OR ac = NULLIF(trim(p_ac), ''))
      AND (NULLIF(trim(coalesce(p_product, '')), '') IS NULL OR product = NULLIF(trim(p_product), ''))
  )
  SELECT jsonb_build_object(
    'aVencer',
      COALESCE(SUM(
        CASE
          WHEN staging_paid THEN 0
          WHEN has_gc_baixa THEN GREATEST(value - gc_paid_value, 0)
          ELSE value
        END
      ), 0),
    'pago',
      COALESCE(SUM(
        CASE
          WHEN staging_paid THEN value
          WHEN has_gc_baixa THEN gc_paid_value
          ELSE 0
        END
      ), 0),
    'pagoReal',
      COALESCE(SUM(
        CASE
          WHEN staging_paid THEN staging_paid_value
          WHEN has_gc_baixa THEN gc_paid_value
          ELSE 0
        END
      ), 0),
    'total',
      COALESCE(SUM(value), 0),
    'qtd',
      COUNT(*),
    'source',
      'kamino_staging_gc_overlay'
  )
  FROM filtered;
$$;

COMMENT ON FUNCTION public.kamino_dashboard_forecast_totals IS
  'Totais da Kamino com overlay de baixas conciliadas registradas no GC.';

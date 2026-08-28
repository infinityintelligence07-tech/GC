-- Restringe a projeção Kamino à empresa ativa.
-- Contratos arquivados não devem alimentar Dashboard/Carteira do GC.

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
  WITH active_company AS (
    SELECT id, slug
    FROM public.companies
    WHERE id = COALESCE(
      public.current_company_id(),
      (SELECT id FROM public.companies WHERE slug = 'iam')
    )
    LIMIT 1
  ),
  raw_inst AS (
    SELECT
      k.skey,
      COALESCE(NULLIF(trim(k.ac), ''), NULLIF(trim(s.ac), '')) AS ac,
      k.product,
      s.id AS student_id,
      COALESCE((i->>'number')::int, 0) AS installment_number,
      COALESCE(i->>'dueDate', '') AS due_date,
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
     AND s.company_id = (SELECT id FROM active_company)
    WHERE (
      -- Liberty permanece integralmente visível.
      (SELECT slug FROM active_company) = 'liberty'
      OR (
        -- No IAM, apenas cadastros locais novos ou contratos já liberados
        -- após aprovação entram na projeção. Pendências e cancelamentos ficam
        -- exclusivamente nas filas de Conciliação.
        s.id IS NOT NULL
        AND (
          s.iam_control_aluno_id IS NULL
          OR s.iam_gc_conciliado_at IS NOT NULL
        )
        AND COALESCE(s.status_cancelamento, 'nenhum') NOT IN (
          'solicitado',
          'aguardando_conciliacao',
          'pagamento_multa_pendente',
          'cancelado',
          'revertido'
        )
      )
      OR (
        -- Permite que um contrato Liberty ainda não cadastrado no GC
        -- continue aparecendo quando a empresa Liberty estiver ativa.
        s.id IS NULL
        AND (SELECT slug FROM active_company) = 'liberty'
        AND lower(COALESCE(k.product, '')) LIKE '%liberty%'
      )
    )
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
    WHERE (NULLIF(trim(COALESCE(p_ac, '')), '') IS NULL OR ac = NULLIF(trim(p_ac), ''))
      AND (NULLIF(trim(COALESCE(p_product, '')), '') IS NULL OR product = NULLIF(trim(p_product), ''))
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
    'total', COALESCE(SUM(value), 0),
    'qtd', COUNT(*),
    'source', 'kamino_staging_gc_overlay'
  )
  FROM filtered;
$$;

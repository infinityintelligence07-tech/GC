-- Abatimento do saldo a devolver em outro contrato (cancelamento).
--
-- 1. `cancellation_cases.abatimento` nunca existiu no banco: o front gravava
--    `abatimento` no caso (updateCancellationCase) mas a coluna não estava no
--    mapeamento — o dado sumia no reload e o painel "Cancelados com abatimento
--    em outro treinamento" ficava sempre vazio. Cria a coluna e preenche a
--    partir do item de conciliação do cancelamento (depois.abatimento*).
--
-- 2. Ana Cecília Mascarenhas Silva Pinheiro: o crédito de R$ 397 do PMR
--    cancelado foi aplicado (24/08) no Missão Governar 3af8a55b; em 28/08 a
--    importação Kamino criou uma ficha nova para o mesmo contrato (23ccf197,
--    sem o crédito e sem o vencimento 22/10 ajustado em 26/08) e a antiga foi
--    para "Banco de Dados". Reaplica o crédito e o vencimento na ficha ativa.

ALTER TABLE public.cancellation_cases ADD COLUMN IF NOT EXISTS abatimento jsonb;

COMMENT ON COLUMN public.cancellation_cases.abatimento IS
  'Saldo a devolver abatido em outro contrato do aluno: {valor, studentId, studentName, product, saldoAntes, saldoDepois, estornoBruto, estornoRestante, appliedAt}.';

-- ─── Backfill a partir do item de conciliação do cancelamento ────────────────
WITH itens AS (
  SELECT DISTINCT ON (ci.related_case_id)
         ci.related_case_id AS case_id,
         ci.depois,
         ci.conciliado_at,
         ci.created_at,
         cc.company_id
    FROM public.conciliacao_items ci
    JOIN public.cancellation_cases cc ON cc.id = ci.related_case_id
   WHERE ci.tipo = 'cancelamento'
     AND ci.related_case_id IS NOT NULL
     AND coalesce((ci.depois->>'abatimentoValor')::numeric, 0) > 0.0049
   ORDER BY ci.related_case_id, ci.conciliado_at DESC NULLS LAST, ci.created_at DESC
),
destino AS (
  SELECT i.*,
         btrim(split_part(coalesce(i.depois->>'abatimentoContratoDestino', ''), '·', 1)) AS dest_nome,
         nullif(btrim(split_part(coalesce(i.depois->>'abatimentoContratoDestino', ''), '·', 2)), '') AS dest_produto
    FROM itens i
),
com_id AS (
  SELECT d.*,
         (SELECT s.id
            FROM public.students s
            JOIN public.companies co ON co.id = s.company_id AND co.active
           WHERE public.gc_nome_norm(s.name) = public.gc_nome_norm(d.dest_nome)
             AND (d.dest_produto IS NULL OR lower(btrim(s.product)) = lower(btrim(d.dest_produto)))
           ORDER BY (s.company_id = d.company_id) DESC, s.updated_at DESC
           LIMIT 1) AS dest_id
    FROM destino d
)
UPDATE public.cancellation_cases cc
   SET abatimento = jsonb_strip_nulls(jsonb_build_object(
         'valor',           (c.depois->>'abatimentoValor')::numeric,
         'studentId',       c.dest_id,
         'studentName',     c.dest_nome,
         'product',         c.dest_produto,
         'saldoAntes',      coalesce((c.depois->>'abatimentoSaldoAntes')::numeric, 0),
         'saldoDepois',     coalesce((c.depois->>'abatimentoSaldoDepois')::numeric, 0),
         'estornoBruto',    coalesce((c.depois->>'abatimentoSaldoOrigem')::numeric, (c.depois->>'abatimentoValor')::numeric),
         'estornoRestante', coalesce((c.depois->>'abatimentoEstornoRestante')::numeric, 0),
         'appliedAt',       to_char(coalesce(c.conciliado_at, c.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )),
       updated_at = now()
  FROM com_id c
 WHERE cc.id = c.case_id
   AND cc.abatimento IS NULL;

-- ─── Ana Cecília — Missão Governar (ficha ativa 23ccf197) ────────────────────
DO $$
DECLARE
  v_id constant uuid := '23ccf197-e57f-4dae-991b-5f5f92d9d142';
  v_inst jsonb;
  v_alvo jsonb;
  v_hist jsonb;
BEGIN
  SELECT installments INTO v_inst FROM public.students WHERE id = v_id;
  IF v_inst IS NULL THEN
    RAISE NOTICE 'Ana Cecília: ficha % não encontrada — nada feito', v_id;
    RETURN;
  END IF;

  SELECT i INTO v_alvo
    FROM jsonb_array_elements(v_inst) i
   WHERE (i->>'number')::int = 2
     AND NOT coalesce((i->>'paid')::boolean, false)
     AND abs((i->>'value')::numeric - 1230.5) < 0.01
     AND coalesce((i->>'creditApplied')::numeric, 0) < 397;
  IF v_alvo IS NULL THEN
    RAISE NOTICE 'Ana Cecília: parcela 2 (R$ 1.230,50 em aberto, sem crédito) não encontrada — nada feito';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE
             WHEN (i->>'number')::int = 2
             THEN i || jsonb_build_object(
                    'creditApplied', 397,
                    'dueDate', '2026-10-22',
                    'observacao', 'Abatimento parcial de R$ 397,00 — cancelamento de Ana Cecília Mascarenhas Silva Pinheiro (PMR). Vencimento 22/07 → 22/10/2026 (ajuste do AC de 26/08).'
                  )
             ELSE i
           END
           ORDER BY ord
         )
    INTO v_inst
    FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(i, ord);

  v_hist := jsonb_build_array(
    jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Recebeu abatimento de R$ 397,00 proveniente do saldo a devolver do cancelamento de Ana Cecília Mascarenhas Silva Pinheiro (PMR) — saldo da parcela 2: R$ 1.230,50 → R$ 833,50. Crédito reaplicado: havia sido lançado em 24/08 na ficha anterior deste contrato, substituída pela importação Kamino de 28/08.'
    ),
    jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Vencimento da parcela 2 restaurado para 22/10/2026 (ajuste financeiro do AC de 26/08, perdido na substituição da ficha).'
    )
  );

  UPDATE public.students
     SET installments = v_inst,
         history = coalesce(history, '[]'::jsonb) || v_hist,
         status = CASE WHEN status_mode = 'Automático' THEN 'Em Dia' ELSE status END,
         updated_at = now()
   WHERE id = v_id;
END $$;

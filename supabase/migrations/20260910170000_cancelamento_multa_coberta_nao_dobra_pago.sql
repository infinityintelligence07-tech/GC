-- Cancelamento com multa "quitada" coberta pela entrada/parcelas já pagas: a
-- finalização criava uma parcela de multa PAGA pelo valor integral além da
-- entrada que já estava na ficha — o "pago" do aluno dobrava e aparecia um
-- "saldo p/ abater" que nunca existiu.
-- Ex.: Damares Barbosa (Confronto) — entrada R$ 1.500 cobriu a multa R$ 1.500;
-- a ficha mostrava R$ 3.000 pagos e R$ 1.500 a abater. Kamino recebeu R$ 1.500.
--
-- Regra (app, 10/09/2026): parcela de multa na ficha = dinheiro recebido pela
-- multa (complemento ou multa negativada paga). Multa coberta pelo que já foi
-- pago não gera parcela. Aqui corrigimos as fichas já finalizadas nesse
-- padrão: remove a parcela de multa paga cujo valor está inteiramente coberto
-- pela entrada + parcelas pagas normais (total pago real = item de conciliação).

DO $$
DECLARE
  r record;
  v_inst jsonb;
  v_total int;
  v_pagas int;
  v_hist jsonb;
BEGIN
  FOR r IN
    WITH c AS (
      SELECT s.id, s.name, s.product, s.down_payment::numeric entrada, s.installments, s.cancellation_case_id,
             (SELECT coalesce(sum(coalesce(nullif(i->>'paidValue','')::numeric, (i->>'value')::numeric)), 0)
                FROM jsonb_array_elements(s.installments) i
               WHERE coalesce((i->>'paid')::boolean, false)
                 AND NOT (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')) pagas_normais,
             (SELECT coalesce(sum(coalesce(nullif(i->>'paidValue','')::numeric, (i->>'value')::numeric)), 0)
                FROM jsonb_array_elements(s.installments) i
               WHERE coalesce((i->>'paid')::boolean, false)
                 AND (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')) multa_paga,
             (SELECT (ci.depois->>'totalPagoEfetivo')::numeric
                FROM public.conciliacao_items ci
               WHERE ci.student_id = s.id AND ci.tipo = 'cancelamento' AND ci.status = 'conciliado'
                 AND coalesce((ci.depois->>'espelho_gc')::boolean, false) = false
               ORDER BY ci.conciliado_at DESC LIMIT 1) pago_item
        FROM public.students s JOIN public.companies co ON co.id = s.company_id
       WHERE co.active AND s.status_cancelamento = 'cancelado'
    )
    SELECT * FROM c
     WHERE multa_paga > 0.0049
       AND pago_item IS NOT NULL
       -- ficha soma mais que o pago real, e a diferença é exatamente a multa paga
       AND abs((entrada + pagas_normais + multa_paga) - pago_item - multa_paga) < 0.01
       AND abs((entrada + pagas_normais) - pago_item) < 0.01
  LOOP
    SELECT coalesce(jsonb_agg(i ORDER BY (i->>'number')::int), '[]'::jsonb)
      INTO v_inst
      FROM jsonb_array_elements(r.installments) i
     WHERE NOT (coalesce((i->>'paid')::boolean, false) AND (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento'));

    SELECT count(*), count(*) FILTER (WHERE coalesce((i->>'paid')::boolean, false))
      INTO v_total, v_pagas
      FROM jsonb_array_elements(v_inst) i;

    v_hist := jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', format(
        'Correção (10/09/2026): a multa de cancelamento (R$ %s) foi retida da entrada/parcelas já pagas (R$ %s); a parcela de multa "paga" criada na finalização dobrava o valor pago e foi removida. Total pago real: R$ %s.',
        to_char(r.multa_paga, 'FM999G999G990D00'), to_char(r.entrada + r.pagas_normais, 'FM999G999G990D00'), to_char(r.pago_item, 'FM999G999G990D00'))
    );

    UPDATE public.students
       SET installments = v_inst,
           total_installments = v_total,
           paid_installments = v_pagas,
           history = coalesce(history, '[]'::jsonb) || jsonb_build_array(v_hist),
           updated_at = now()
     WHERE id = r.id;

    UPDATE public.cancellation_cases cc
       SET cancellation_reviewed_installments = (
             SELECT coalesce(jsonb_agg(i ORDER BY (i->>'number')::int), '[]'::jsonb)
               FROM jsonb_array_elements(cc.cancellation_reviewed_installments) i
              WHERE NOT (coalesce((i->>'paid')::boolean, false) AND (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')))
     WHERE cc.id = r.cancellation_case_id
       AND jsonb_typeof(cc.cancellation_reviewed_installments) = 'array';

    RAISE NOTICE 'Corrigido: % · % — pago na ficha % → %', r.name, r.product, r.entrada + r.pagas_normais + r.multa_paga, r.pago_item;
  END LOOP;
END $$;

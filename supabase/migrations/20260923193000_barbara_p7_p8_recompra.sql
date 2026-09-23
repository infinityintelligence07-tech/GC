-- Barbara Midori Sasaki (IAM): P7 e P8 da Missão Governar estavam como "Pago"
-- no fluxo, mas a dívida vive na recompra vinculada.
--
-- 1) Inclui P7 (venc. 20/07/2026) na ficha Fundo - Receita (Recompra) — só P8
--    (20/08) existia, gerando duplicata visual da P8 e omitindo a P7.
-- 2) Marca P7/P8 do treinamento como antecipada (baixa fundo, não pagamento
--    do aluno). O Fluxo esconde parcelas espelhadas na recompra vinculada.

DO $$
DECLARE
  v_mg uuid := '7d2f83ec-2dfa-43a8-903c-8e9e9d0eaf2a';
  v_rec uuid := 'aa6ebbb8-8b41-4837-905a-6a82dec2c48a';
  v_tag_recompra uuid := '391d9ecc-9103-495f-b6b4-08ca05f8bafe';
  v_inst jsonb;
  v_hist jsonb;
  v_has_jul boolean;
BEGIN
  -- ── Recompra: garantir parcela de julho (P7) ─────────────────────────────
  SELECT EXISTS (
    SELECT 1
    FROM students s, jsonb_array_elements(COALESCE(s.installments, '[]'::jsonb)) i
    WHERE s.id = v_rec
      AND i->>'dueDate' = '2026-07-20'
      AND abs((i->>'value')::numeric - 2416.66) < 0.02
  ) INTO v_has_jul;

  IF NOT v_has_jul THEN
    SELECT COALESCE(
             jsonb_agg(
               CASE
                 WHEN i->>'dueDate' = '2026-08-20'
                   THEN (i - 'number') || jsonb_build_object('number', 2)
                 ELSE i
               END
               ORDER BY (i->>'dueDate')
             ),
             '[]'::jsonb
           )
      INTO v_inst
    FROM students s, jsonb_array_elements(COALESCE(s.installments, '[]'::jsonb)) i
    WHERE s.id = v_rec;

    v_inst := jsonb_build_array(
      jsonb_build_object(
        'number', 1,
        'dueDate', '2026-07-20',
        'value', 2416.66,
        'paid', false,
        'tags', jsonb_build_array(v_tag_recompra::text),
        'observacao', 'Recompra SICOOB — parcela espelhada da P7 Missão Governar (venc. 20/07/2026). Incluída em 23/09/2026 para alinhar fluxo × recompra.'
      )
    ) || COALESCE(v_inst, '[]'::jsonb);

    v_hist := jsonb_build_object(
      'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Parcela 1 (venc. 20/07/2026 · R$ 2.416,66) incluída — espelho da P7 da Missão Governar. P8 (20/08) renumerada para parcela 2.'
    );

    UPDATE students
       SET installments = v_inst,
           total_installments = jsonb_array_length(v_inst),
           paid_installments = (
             SELECT count(*)::int
             FROM jsonb_array_elements(v_inst) x
             WHERE COALESCE((x->>'paid')::boolean, false)
           ),
           sale_value = (
             SELECT coalesce(sum((x->>'value')::numeric), 0)
             FROM jsonb_array_elements(v_inst) x
           ),
           history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(v_hist)
     WHERE id = v_rec;
  END IF;

  -- ── Missão Governar: P7 e P8 como antecipada ─────────────────────────────
  UPDATE students s
     SET installments = (
           SELECT jsonb_agg(
                    CASE
                      WHEN (i->>'number')::int IN (7, 8)
                           AND COALESCE((i->>'paid')::boolean, false)
                        THEN i || '{"antecipada": true}'::jsonb
                      ELSE i
                    END
                    ORDER BY (i->>'number')::int
                  )
           FROM jsonb_array_elements(COALESCE(s.installments, '[]'::jsonb)) i
         ),
         history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'type', 'Sistema',
             'text', 'P7 e P8 marcadas como antecipadas (baixa fundo) — dívida correspondente na recompra vinculada; não contam como pagamento do aluno no Fluxo.'
           )
         )
   WHERE s.id = v_mg
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(s.installments, '[]'::jsonb)) i
       WHERE (i->>'number')::int IN (7, 8)
         AND COALESCE((i->>'paid')::boolean, false)
         AND NOT COALESCE((i->>'antecipada')::boolean, false)
     );
END $$;

-- Parcelas "Antecipado" (azul claro)
--
-- Boletos antecipados (banco/fundo) chegaram do Kamino baixados como pagos com
-- paidDate = vencimento, inclusive em datas futuras. Uma baixa com data futura
-- só pode ser antecipação — o aluno ainda não pagou. Marcamos essas parcelas com
-- `antecipada: true` para o front exibir "Antecipado" em vez de "Pago".
-- Os totais não mudam (a parcela continua `paid`), apenas a exibição.
--
-- Idempotente: só toca parcelas pagas com data futura que ainda não têm a marca.

DO $$
DECLARE
  r record;
  v_new jsonb;
  v_marcadas int;
  v_nums text;
  v_total_alunos int := 0;
  v_total_parcelas int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.name, s.installments, s.history
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id
    WHERE co.active
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.installments) i
        WHERE coalesce((i->>'paid')::boolean, false)
          AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
          AND NOT coalesce((i->>'antecipada')::boolean, false)
      )
  LOOP
    SELECT
      jsonb_agg(
        CASE
          WHEN coalesce((i->>'paid')::boolean, false)
           AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
           AND NOT coalesce((i->>'antecipada')::boolean, false)
          THEN i || '{"antecipada": true}'::jsonb
          ELSE i
        END
        ORDER BY ord
      ),
      count(*) FILTER (
        WHERE coalesce((i->>'paid')::boolean, false)
          AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
          AND NOT coalesce((i->>'antecipada')::boolean, false)
      ),
      string_agg(i->>'number', ', ' ORDER BY (i->>'number')::int) FILTER (
        WHERE coalesce((i->>'paid')::boolean, false)
          AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
          AND NOT coalesce((i->>'antecipada')::boolean, false)
      )
    INTO v_new, v_marcadas, v_nums
    FROM jsonb_array_elements(r.installments) WITH ORDINALITY AS t(i, ord);

    UPDATE public.students
    SET installments = v_new,
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'type', 'Sistema',
          'text', format(
            'Parcela(s) %s marcada(s) como boleto antecipado (baixa com data futura vinda do Kamino — antecipação banco/fundo, não pagamento do aluno). Exibidas como "Antecipado".',
            v_nums
          )
        ))
    WHERE id = r.id;

    v_total_alunos := v_total_alunos + 1;
    v_total_parcelas := v_total_parcelas + v_marcadas;
  END LOOP;

  RAISE NOTICE 'Parcelas antecipadas marcadas: % parcela(s) em % aluno(s).', v_total_parcelas, v_total_alunos;
END $$;

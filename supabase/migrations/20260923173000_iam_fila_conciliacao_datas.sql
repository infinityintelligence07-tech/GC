-- Reaplica a regra de datas IAM nos contratos da fila
-- "IAM Control → GC / Aguardando aprovação" (conciliacao_items iam_pendente).
-- Pendência: data_venda + 5d (se ainda estiver no dia da venda).
-- Boletos: dia da data_venda, a partir do mês seguinte (depois da pendência).

DO $$
DECLARE
  v_stud record;
  v_enroll date;
  v_pend_due date;
  v_due_day int;
  v_first_boleto date;
  v_new jsonb;
  v_n int := 0;
  v_needs boolean;
BEGIN
  FOR v_stud IN
    SELECT DISTINCT ON (s.id)
      s.id, s.name, s.enrollment_date, s.due_day, s.installments
    FROM public.conciliacao_items ci
    JOIN public.students s ON s.id = ci.student_id
    WHERE ci.tipo = 'iam_pendente'
      AND ci.status IN ('pendente', 'aprovado')
      AND s.iam_control_aluno_id IS NOT NULL
      AND jsonb_typeof(s.installments) = 'array'
      AND jsonb_array_length(s.installments) > 0
      AND public.iam_parse_iso_date(s.enrollment_date) IS NOT NULL
    ORDER BY s.id
  LOOP
    v_enroll := public.iam_parse_iso_date(v_stud.enrollment_date);
    v_due_day := EXTRACT(DAY FROM v_enroll)::int;

    -- Pendência atual (se houver)
    SELECT public.iam_parse_iso_date(i->>'dueDate')
      INTO v_pend_due
    FROM jsonb_array_elements(v_stud.installments) i
    WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
    ORDER BY (i->>'number')::int
    LIMIT 1;

    v_needs := false;

    -- Pendência no dia da venda → carência de 5 dias
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_stud.installments) i
      WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
        AND coalesce((i->>'paid')::boolean, false) = false
        AND (i->>'dueDate') = v_enroll::text
    ) THEN
      v_pend_due := (v_enroll + interval '5 days')::date;
      v_needs := true;
    ELSIF v_pend_due IS NULL THEN
      -- Sem pendência: âncora só para garantir boleto > nada
      v_pend_due := v_enroll;
    END IF;

    -- Boleto com dia ≠ dia da venda
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_stud.installments) b
      WHERE NOT coalesce(b->'tags', '[]'::jsonb) ? 'entrada-pendente'
        AND coalesce((b->>'paid')::boolean, false) = false
        AND public.iam_parse_iso_date(b->>'dueDate') IS NOT NULL
        AND EXTRACT(DAY FROM public.iam_parse_iso_date(b->>'dueDate')) <> v_due_day
    ) THEN
      v_needs := true;
    END IF;

    IF NOT v_needs THEN
      CONTINUE;
    END IF;

    v_first_boleto := public.iam_due_on_month(v_enroll, 1, v_due_day);
    IF v_first_boleto <= v_pend_due THEN
      v_first_boleto := public.iam_first_due_after(v_pend_due, v_due_day);
    END IF;

    -- Ajusta pendência se necessário; depois redatinga boletos
    v_new := (
      SELECT coalesce(jsonb_agg(
        CASE
          WHEN coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
               AND coalesce((i->>'paid')::boolean, false) = false
               AND (i->>'dueDate') = v_enroll::text
            THEN i || jsonb_build_object('dueDate', v_pend_due::text)
          ELSE i
        END
        ORDER BY (i->>'number')::int
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_stud.installments) i
    );

    v_new := public.iam_redate_boletos(v_new, v_first_boleto, v_due_day);

    UPDATE public.students s
    SET
      installments = v_new,
      due_day = v_due_day,
      history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'type', 'Sistema',
        'text', format(
          'Fila conciliação IAM: vencimentos alinhados à regra atual (boletos dia %s a partir de %s).',
          v_due_day,
          to_char(v_first_boleto, 'DD/MM/YYYY')
        )
      )),
      updated_at = now()
    WHERE s.id = v_stud.id;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'iam_fila_conciliacao_datas: % fichas atualizadas', v_n;
END;
$$;

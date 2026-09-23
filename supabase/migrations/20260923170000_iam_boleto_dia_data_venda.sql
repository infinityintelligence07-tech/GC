-- Boletos IAM: o dia de vencimento segue o dia da data_venda (ex.: venda 20/09
-- → boletos 20/10, 20/11…), não o default genérico due_day=10.
-- Pendência (venda + carência) permanece como está.

CREATE OR REPLACE FUNCTION public.iam_datas_do_treinamento(p_treinamento jsonb)
RETURNS TABLE(pendencia_due date, primeiro_boleto date, due_day integer)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base date := coalesce(
    public.iam_parse_iso_date(p_treinamento->>'data_venda'),
    current_date
  );
  v_formas jsonb := coalesce(p_treinamento->'formas_pagamento', '[]'::jsonb);
  v_fp jsonb;
  v_i int;
  v_due_day int;
  v_pend date;
  v_boleto date;
  v_carencia int := 5;
BEGIN
  -- Preferência: campo explícito do IAM; senão o dia da própria data_venda
  -- (regra histórica do sync: data_venda + N meses). Nunca cair no 10 genérico
  -- da coluna students.due_day — isso deslocava boletos de 20→10.
  v_due_day := coalesce(
    public.iam_json_first_int(p_treinamento, 'dia_vencimento', 'melhor_dia', 'dia_venc', 'due_day'),
    (
      SELECT public.iam_json_first_int(fp, 'dia_vencimento', 'melhor_dia', 'dia_venc', 'due_day')
      FROM jsonb_array_elements(v_formas) fp
      WHERE public.iam_forma_is_parcelado(fp->>'forma')
        AND NOT public.iam_forma_is_pendencia(fp)
        AND NOT public.iam_forma_is_cartao_credito(fp->>'forma')
      LIMIT 1
    ),
    EXTRACT(DAY FROM v_base)::int
  );

  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    IF public.iam_forma_is_pendencia(v_fp) THEN
      v_pend := public.iam_json_first_date(
        v_fp,
        'data_vencimento', 'vencimento', 'data_limite',
        'data_pagamento', 'data_prevista', 'due_date', 'dueDate'
      );
      IF v_pend IS NOT NULL THEN
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_pend IS NULL THEN
    v_pend := public.iam_json_first_date(
      p_treinamento,
      'data_vencimento_entrada', 'data_vencimento_pendencia',
      'vencimento_entrada', 'vencimento_pendencia',
      'data_pendencia', 'data_limite_entrada'
    );
  END IF;

  IF v_pend IS NULL THEN
    v_pend := (v_base + (v_carencia || ' days')::interval)::date;
  END IF;

  v_boleto := public.iam_json_first_date(
    p_treinamento,
    'data_primeiro_vencimento', 'primeiro_vencimento',
    'data_1_vencimento', 'data_primeiro_boleto', 'primeiro_boleto'
  );

  IF v_boleto IS NULL THEN
    FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
      v_fp := v_formas->v_i;
      IF public.iam_forma_is_parcelado(v_fp->>'forma')
         AND NOT public.iam_forma_is_pendencia(v_fp)
         AND NOT public.iam_forma_is_cartao_credito(v_fp->>'forma') THEN
        v_boleto := public.iam_json_first_date(
          v_fp,
          'data_primeiro_vencimento', 'primeiro_vencimento',
          'data_vencimento', 'vencimento', 'due_date', 'dueDate'
        );
        IF v_boleto IS NOT NULL THEN
          EXIT;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF v_boleto IS NULL THEN
    v_boleto := public.iam_due_on_month(v_base, 1, v_due_day);
  END IF;

  IF v_boleto <= v_pend THEN
    v_boleto := public.iam_first_due_after(v_pend, v_due_day);
  END IF;

  pendencia_due := v_pend;
  primeiro_boleto := v_boleto;
  due_day := v_due_day;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.iam_datas_do_treinamento(jsonb) IS
  'Resolve pendência (IAM ou venda+5d) e boletos (IAM ou dia da data_venda + N meses).';

-- Reaplica boletos nas fichas que o backfill anterior deslocou para dia 10
-- enquanto a matrícula/venda é noutro dia (ex.: 20).
DO $$
DECLARE
  v_stud record;
  v_enroll date;
  v_pend_due date;
  v_due_day int;
  v_first_boleto date;
  v_new jsonb;
  v_n int := 0;
  v_sale_day int;
BEGIN
  FOR v_stud IN
    SELECT s.id, s.name, s.enrollment_date, s.due_day, s.installments
    FROM public.students s
    WHERE s.iam_control_aluno_id IS NOT NULL
      AND jsonb_typeof(s.installments) = 'array'
      AND public.iam_parse_iso_date(s.enrollment_date) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s.installments) i
        WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s.installments) b
        WHERE NOT coalesce(b->'tags', '[]'::jsonb) ? 'entrada-pendente'
          AND coalesce((b->>'paid')::boolean, false) = false
          AND public.iam_parse_iso_date(b->>'dueDate') IS NOT NULL
          AND EXTRACT(DAY FROM public.iam_parse_iso_date(b->>'dueDate')) = 10
          AND EXTRACT(DAY FROM public.iam_parse_iso_date(s.enrollment_date)) <> 10
      )
  LOOP
    v_enroll := public.iam_parse_iso_date(v_stud.enrollment_date);
    v_sale_day := EXTRACT(DAY FROM v_enroll)::int;
    v_due_day := v_sale_day;

    SELECT public.iam_parse_iso_date(i->>'dueDate')
      INTO v_pend_due
    FROM jsonb_array_elements(v_stud.installments) i
    WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
    ORDER BY (i->>'number')::int
    LIMIT 1;

    IF v_pend_due IS NULL THEN
      v_pend_due := (v_enroll + interval '5 days')::date;
    END IF;

    v_first_boleto := public.iam_due_on_month(v_enroll, 1, v_due_day);
    IF v_first_boleto <= v_pend_due THEN
      v_first_boleto := public.iam_first_due_after(v_pend_due, v_due_day);
    END IF;

    -- Mantém pendência; só redatinga boletos.
    v_new := public.iam_redate_boletos(v_stud.installments, v_first_boleto, v_due_day);

    UPDATE public.students s
    SET
      installments = v_new,
      due_day = v_due_day,
      history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'type', 'Sistema',
        'text', format(
          'Boletos IAM: vencimento no dia %s (dia da venda), a partir de %s. Pendência mantida.',
          v_due_day,
          to_char(v_first_boleto, 'DD/MM/YYYY')
        )
      )),
      updated_at = now()
    WHERE s.id = v_stud.id;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'iam_boleto_dia_data_venda: % fichas corrigidas', v_n;
END;
$$;

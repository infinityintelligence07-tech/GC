-- 1ª parcela (boleto) pode usar o dia da data_venda; as demais usam due_day
-- recorrente (padrão 10), como no Fluxo/renegociação do GC.
-- Ex.: venda 20/09 → 1º boleto 20/10; seguintes 10/11, 10/12, 10/01…

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
  v_sale_day int := EXTRACT(DAY FROM v_base)::int;
  v_pend date;
  v_boleto date;
  v_carencia int := 5;
BEGIN
  -- Dia recorrente das parcelas 2..N (não o dia da 1ª).
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
    10
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

  -- 1º boleto: data explícita do IAM, senão dia da venda no mês seguinte.
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
    v_boleto := public.iam_due_on_month(v_base, 1, v_sale_day);
  END IF;

  IF v_boleto <= v_pend THEN
    -- Empurra a 1ª mantendo o dia da venda (não o due_day recorrente).
    v_boleto := public.iam_first_due_after(v_pend, v_sale_day);
  END IF;

  pendencia_due := v_pend;
  primeiro_boleto := v_boleto;
  due_day := v_due_day;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.iam_datas_do_treinamento(jsonb) IS
  'Pendência: IAM ou venda+5d. 1º boleto: IAM ou dia da venda no mês seguinte. Demais: due_day (padrão 10).';

CREATE OR REPLACE FUNCTION public.iam_build_installments_from_values(
  p_values jsonb,
  p_enrollment_date text,
  p_paid_count integer DEFAULT 0,
  p_first_due date DEFAULT NULL,
  p_due_day integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_count int := coalesce(jsonb_array_length(p_values), 0);
  v_base date := coalesce(public.iam_parse_iso_date(p_enrollment_date), current_date);
  v_due_day int := coalesce(p_due_day, 10);
  v_sale_day int := EXTRACT(DAY FROM v_base)::int;
  v_first date := coalesce(
    p_first_due,
    public.iam_due_on_month(v_base, 1, v_sale_day)
  );
  v_i int;
  v_valor numeric;
  v_out jsonb := '[]'::jsonb;
  v_due date;
  v_prev date;
BEGIN
  IF v_count <= 0 THEN
    RETURN v_out;
  END IF;

  v_prev := v_first;
  FOR v_i IN 0..(v_count - 1) LOOP
    v_valor := coalesce(nullif(p_values->>v_i, '')::numeric, 0);
    IF v_valor <= 0 THEN
      CONTINUE;
    END IF;
    IF v_i = 0 THEN
      v_due := v_first;
    ELSE
      v_due := public.iam_first_due_after(v_prev, v_due_day);
    END IF;
    v_prev := v_due;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'number', jsonb_array_length(v_out) + 1,
        'value', round(v_valor, 2),
        'dueDate', v_due::text,
        'paid', v_i < greatest(coalesce(p_paid_count, 0), 0)
      )
    );
  END LOOP;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_build_installments(
  p_sale_value numeric,
  p_down_payment numeric,
  p_total_installments int,
  p_enrollment_date text,
  p_first_due date DEFAULT NULL,
  p_due_day integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_parcelas int := greatest(coalesce(p_total_installments, 0), 0);
  v_base date := coalesce(public.iam_parse_iso_date(p_enrollment_date), current_date);
  v_due_day int := coalesce(p_due_day, 10);
  v_sale_day int := EXTRACT(DAY FROM v_base)::int;
  v_first date := coalesce(
    p_first_due,
    public.iam_due_on_month(v_base, 1, v_sale_day)
  );
  v_restante numeric;
  v_valor_parcela numeric;
  v_i int;
  v_out jsonb := '[]'::jsonb;
  v_due date;
  v_prev date;
BEGIN
  IF v_parcelas <= 0 THEN
    RETURN v_out;
  END IF;

  v_restante := greatest(coalesce(p_sale_value, 0) - coalesce(p_down_payment, 0), 0);
  v_valor_parcela := round(v_restante / v_parcelas, 2);
  v_prev := v_first;

  FOR v_i IN 1..v_parcelas LOOP
    IF v_i = 1 THEN
      v_due := v_first;
    ELSE
      v_due := public.iam_first_due_after(v_prev, v_due_day);
    END IF;
    v_prev := v_due;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'number', v_i,
        'value', v_valor_parcela,
        'dueDate', v_due::text,
        'paid', false
      )
    );
  END LOOP;

  RETURN v_out;
END;
$$;

-- 1ª boleto = p_first_due; demais = próximo due_day após a anterior.
CREATE OR REPLACE FUNCTION public.iam_redate_boletos(
  p_inst jsonb,
  p_first_due date,
  p_due_day int
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_due_day int := coalesce(p_due_day, 10);
  v_first date := p_first_due;
  v_elem jsonb;
  v_out jsonb := '[]'::jsonb;
  v_due date;
  v_prev date := NULL;
  v_ord int := 0;
BEGIN
  IF p_inst IS NULL OR jsonb_typeof(p_inst) <> 'array' OR v_first IS NULL THEN
    RETURN coalesce(p_inst, '[]'::jsonb);
  END IF;

  FOR v_elem IN
    SELECT elem
    FROM jsonb_array_elements(p_inst) elem
    ORDER BY (elem->>'number')::int
  LOOP
    IF coalesce(v_elem->'tags', '[]'::jsonb) ? 'entrada-pendente' THEN
      v_out := v_out || jsonb_build_array(v_elem);
    ELSE
      v_ord := v_ord + 1;
      IF v_ord = 1 THEN
        v_due := v_first;
      ELSE
        v_due := public.iam_first_due_after(v_prev, v_due_day);
      END IF;
      v_prev := v_due;
      v_out := v_out || jsonb_build_array(
        v_elem || jsonb_build_object('dueDate', v_due::text)
      );
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

-- Backfill: fila de conciliação IAM + fichas IAM recentes já tocadas pela regra.
DO $$
DECLARE
  v_stud record;
  v_enroll date;
  v_pend_due date;
  v_due_day int := 10;
  v_sale_day int;
  v_first_boleto date;
  v_new jsonb;
  v_n int := 0;
BEGIN
  FOR v_stud IN
    SELECT DISTINCT s.id, s.name, s.enrollment_date, s.due_day, s.installments
    FROM public.students s
    WHERE s.iam_control_aluno_id IS NOT NULL
      AND jsonb_typeof(s.installments) = 'array'
      AND jsonb_array_length(s.installments) > 1
      AND public.iam_parse_iso_date(s.enrollment_date) IS NOT NULL
      AND (
        -- fila aguardando aprovação
        EXISTS (
          SELECT 1 FROM public.conciliacao_items ci
          WHERE ci.student_id = s.id
            AND ci.tipo = 'iam_pendente'
            AND ci.status IN ('pendente', 'aprovado')
        )
        -- ou boletos todos no mesmo dia do mês da 1ª (padrão antigo errado)
        OR (
          SELECT count(DISTINCT EXTRACT(DAY FROM public.iam_parse_iso_date(b->>'dueDate')))
          FROM jsonb_array_elements(s.installments) b
          WHERE NOT coalesce(b->'tags', '[]'::jsonb) ? 'entrada-pendente'
            AND coalesce((b->>'paid')::boolean, false) = false
            AND public.iam_parse_iso_date(b->>'dueDate') IS NOT NULL
        ) = 1
        AND (
          SELECT count(*)
          FROM jsonb_array_elements(s.installments) b
          WHERE NOT coalesce(b->'tags', '[]'::jsonb) ? 'entrada-pendente'
            AND coalesce((b->>'paid')::boolean, false) = false
        ) > 1
      )
  LOOP
    v_enroll := public.iam_parse_iso_date(v_stud.enrollment_date);
    v_sale_day := EXTRACT(DAY FROM v_enroll)::int;
    v_due_day := 10;

    SELECT public.iam_parse_iso_date(i->>'dueDate')
      INTO v_pend_due
    FROM jsonb_array_elements(v_stud.installments) i
    WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
    ORDER BY (i->>'number')::int
    LIMIT 1;

    IF v_pend_due IS NULL THEN
      v_pend_due := v_enroll;
    ELSIF (SELECT i->>'dueDate'
           FROM jsonb_array_elements(v_stud.installments) i
           WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
             AND coalesce((i->>'paid')::boolean, false) = false
             AND (i->>'dueDate') = v_enroll::text
           LIMIT 1) IS NOT NULL THEN
      v_pend_due := (v_enroll + interval '5 days')::date;
    END IF;

    -- 1º boleto: dia da venda no mês seguinte (ou após pendência)
    v_first_boleto := public.iam_due_on_month(v_enroll, 1, v_sale_day);
    IF v_first_boleto <= v_pend_due THEN
      v_first_boleto := public.iam_first_due_after(v_pend_due, v_sale_day);
    END IF;

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
          'Vencimentos IAM: 1º boleto em %s; demais no dia %s (recorrente).',
          to_char(v_first_boleto, 'DD/MM/YYYY'),
          v_due_day
        )
      )),
      updated_at = now()
    WHERE s.id = v_stud.id;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'iam_boleto_primeira_vs_recorrente: % fichas', v_n;
END;
$$;

-- Aplica datas extraídas do contrato IAM (PDF):
--   "Melhor dia de vencimento: N"  → due_day recorrente (parcelas 2..N)
--   "1º boleto para: DD/MM/YYYY"   → 1ª parcela boleto
-- Pendência: se p_pendencia_due informado, atualiza entrada-pendente aberta.

CREATE OR REPLACE FUNCTION public.iam_aplicar_datas_contrato(
  p_student_id uuid,
  p_primeiro_boleto date,
  p_due_day integer,
  p_pendencia_due date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stud record;
  v_due_day int := greatest(least(coalesce(p_due_day, 10), 31), 1);
  v_first date := p_primeiro_boleto;
  v_pend date := p_pendencia_due;
  v_new jsonb;
  v_enroll date;
BEGIN
  IF p_student_id IS NULL OR v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'student_id/primeiro_boleto obrigatórios');
  END IF;

  SELECT s.id, s.installments, s.enrollment_date
    INTO v_stud
  FROM public.students s
  WHERE s.id = p_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'aluno não encontrado');
  END IF;

  IF jsonb_typeof(v_stud.installments) <> 'array'
     OR jsonb_array_length(v_stud.installments) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'sem parcelas');
  END IF;

  v_enroll := public.iam_parse_iso_date(v_stud.enrollment_date);

  -- Ajusta pendência aberta se veio do contrato; senão mantém (ou carência se = matrícula)
  IF v_pend IS NOT NULL THEN
    v_new := (
      SELECT coalesce(jsonb_agg(
        CASE
          WHEN coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
               AND coalesce((i->>'paid')::boolean, false) = false
            THEN i || jsonb_build_object('dueDate', v_pend::text)
          ELSE i
        END
        ORDER BY (i->>'number')::int
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_stud.installments) i
    );
  ELSE
    v_new := v_stud.installments;
    IF v_enroll IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_new) i
      WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
        AND coalesce((i->>'paid')::boolean, false) = false
        AND (i->>'dueDate') = v_enroll::text
    ) THEN
      v_pend := (v_enroll + interval '5 days')::date;
      v_new := (
        SELECT coalesce(jsonb_agg(
          CASE
            WHEN coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
                 AND coalesce((i->>'paid')::boolean, false) = false
                 AND (i->>'dueDate') = v_enroll::text
              THEN i || jsonb_build_object('dueDate', v_pend::text)
            ELSE i
          END
          ORDER BY (i->>'number')::int
        ), '[]'::jsonb)
        FROM jsonb_array_elements(v_new) i
      );
    END IF;
  END IF;

  -- 1º boleto do contrato deve ser após a pendência
  IF v_pend IS NOT NULL AND v_first <= v_pend THEN
    v_first := public.iam_first_due_after(v_pend, EXTRACT(DAY FROM v_first)::int);
  END IF;

  v_new := public.iam_redate_boletos(v_new, v_first, v_due_day);

  UPDATE public.students s
  SET
    installments = v_new,
    due_day = v_due_day,
    history = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', format(
        'Datas do contrato IAM Control: 1º boleto %s; demais no dia %s.',
        to_char(v_first, 'DD/MM/YYYY'),
        v_due_day
      )
    )),
    updated_at = now()
  WHERE s.id = p_student_id;

  RETURN jsonb_build_object(
    'ok', true,
    'primeiro_boleto', v_first,
    'due_day', v_due_day,
    'pendencia_due', v_pend,
    'installments', (
      SELECT jsonb_agg(jsonb_build_object('n', (i->>'number')::int, 'due', i->>'dueDate') ORDER BY (i->>'number')::int)
      FROM jsonb_array_elements(v_new) i
      WHERE (i->>'number')::int <= 4
    )
  );
END;
$$;

COMMENT ON FUNCTION public.iam_aplicar_datas_contrato(uuid, date, integer, date) IS
  'Aplica Melhor dia + 1º boleto extraídos do PDF do contrato IAM Control.';

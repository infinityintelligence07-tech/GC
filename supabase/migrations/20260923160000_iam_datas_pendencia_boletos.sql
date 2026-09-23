-- Datas de pendência e boletos no sync IAM.
--
-- Causa: o IAM Control (webhook gestao-contas) hoje só envia data_venda — sem
-- data_vencimento da pendência nem primeiro vencimento dos boletos. O GC
-- fabricava dueDate = data_venda (pendência já "Vencido" no dia da venda) e
-- boletos em data_venda + N meses (dia da matrícula, não o dia de cobrança).
--
-- Regra nova:
-- 1) Consome campos de data se o IAM passar a exportar
--    (data_vencimento / primeiro_vencimento / dia_vencimento etc.).
-- 2) Fallback: pendência = data_venda + 5 dias (carência); boletos = dia 10
--    (default de students.due_day) a partir do mês seguinte à venda, sempre
--    depois do vencimento da pendência.
-- 3) Backfill nas fichas IAM ainda com o padrão antigo (pendência = matrícula).

-- ── Helpers ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.iam_parse_iso_date(p text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := nullif(btrim(coalesce(p, '')), '');
BEGIN
  IF v IS NULL THEN
    RETURN NULL;
  END IF;
  v := left(v, 10);
  IF v !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    RETURN v::date;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_json_first_date(p jsonb, VARIADIC p_keys text[])
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  d date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH k IN ARRAY p_keys LOOP
    d := public.iam_parse_iso_date(p->>k);
    IF d IS NOT NULL THEN
      RETURN d;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_json_first_int(p jsonb, VARIADIC p_keys text[])
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  v text;
  n int;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH k IN ARRAY p_keys LOOP
    v := nullif(btrim(coalesce(p->>k, '')), '');
    IF v IS NULL OR v !~ '^\d+$' THEN
      CONTINUE;
    END IF;
    n := v::int;
    IF n BETWEEN 1 AND 31 THEN
      RETURN n;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Data no mês (ano/mês de p_base + p_months) com dia p_due_day (clampa no mês).
CREATE OR REPLACE FUNCTION public.iam_due_on_month(p_base date, p_months int, p_due_day int)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT make_date(
    EXTRACT(YEAR FROM (p_base + make_interval(months => coalesce(p_months, 0))))::int,
    EXTRACT(MONTH FROM (p_base + make_interval(months => coalesce(p_months, 0))))::int,
    LEAST(
      greatest(coalesce(p_due_day, 10), 1),
      EXTRACT(DAY FROM (
        date_trunc('month', p_base + make_interval(months => coalesce(p_months, 0)))
        + interval '1 month - 1 day'
      ))::int
    )
  );
$$;

-- Overload para window sum() que devolve bigint.
CREATE OR REPLACE FUNCTION public.iam_due_on_month(p_base date, p_months bigint, p_due_day int)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.iam_due_on_month(p_base, p_months::int, p_due_day);
$$;

-- Primeiro vencimento no dia p_due_day estritamente após p_after.
CREATE OR REPLACE FUNCTION public.iam_first_due_after(p_after date, p_due_day int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_day int := greatest(least(coalesce(p_due_day, 10), 31), 1);
  v_try date;
  v_m int := 0;
BEGIN
  IF p_after IS NULL THEN
    RETURN public.iam_due_on_month(current_date, 1, v_day);
  END IF;
  -- Começa no mês de p_after; se o dia já passou (ou é o próprio after), avança.
  LOOP
    v_try := public.iam_due_on_month(p_after, v_m, v_day);
    IF v_try > p_after THEN
      RETURN v_try;
    END IF;
    v_m := v_m + 1;
    EXIT WHEN v_m > 24;
  END LOOP;
  RETURN public.iam_due_on_month(p_after, 1, v_day);
END;
$$;

-- Extrai (ou estima) datas do payload do treinamento IAM.
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
  v_carencia int := 5; -- dias após a venda quando o IAM não manda vencimento
BEGIN
  -- Preferência: campo explícito do IAM; senão o dia da data_venda
  -- (data_venda + N meses). Não usar o default genérico 10.
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

  -- Pendência: campos da forma marcada como pendência, depois do treinamento.
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

  -- Primeiro boleto: campos IAM, senão dia de cobrança no mês seguinte à venda.
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
    -- Espelha generateInstallments(enrollment, dueDay): 1ª no mês seguinte.
    v_boleto := public.iam_due_on_month(v_base, 1, v_due_day);
  END IF;

  -- Boletos sempre depois da pendência de entrada.
  IF v_boleto <= v_pend THEN
    v_boleto := public.iam_first_due_after(v_pend, v_due_day);
  END IF;

  pendencia_due := v_pend;
  primeiro_boleto := v_boleto;
  due_day := v_due_day;
  RETURN NEXT;
END;
$$;

-- ── Builders com âncora + dia de vencimento ───────────────────────────────

DROP FUNCTION IF EXISTS public.iam_build_installments_from_values(jsonb, text, integer);

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
  v_first date := coalesce(p_first_due, public.iam_due_on_month(v_base, 1, v_due_day));
  v_i int;
  v_valor numeric;
  v_out jsonb := '[]'::jsonb;
  v_due date;
BEGIN
  IF v_count <= 0 THEN
    RETURN v_out;
  END IF;

  FOR v_i IN 0..(v_count - 1) LOOP
    v_valor := coalesce(nullif(p_values->>v_i, '')::numeric, 0);
    IF v_valor <= 0 THEN
      CONTINUE;
    END IF;
    v_due := CASE
      WHEN v_i = 0 THEN v_first
      ELSE public.iam_due_on_month(v_first, v_i, v_due_day)
    END;
    v_out := v_out || jsonb_build_array(
      jsonb_build_object(
        'number', v_i + 1,
        'value', round(v_valor, 2),
        'dueDate', v_due::text,
        'paid', v_i < greatest(coalesce(p_paid_count, 0), 0)
      )
    );
  END LOOP;

  RETURN v_out;
END;
$$;

DROP FUNCTION IF EXISTS public.iam_build_installments(numeric, numeric, integer, text);

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
  v_first date := coalesce(p_first_due, public.iam_due_on_month(v_base, 1, v_due_day));
  v_restante numeric;
  v_valor_parcela numeric;
  v_i int;
  v_out jsonb := '[]'::jsonb;
  v_due date;
BEGIN
  IF v_parcelas <= 0 THEN
    RETURN v_out;
  END IF;

  v_restante := greatest(coalesce(p_sale_value, 0) - coalesce(p_down_payment, 0), 0);
  v_valor_parcela := round(v_restante / v_parcelas, 2);

  FOR v_i IN 1..v_parcelas LOOP
    v_due := CASE
      WHEN v_i = 1 THEN v_first
      ELSE public.iam_due_on_month(v_first, v_i - 1, v_due_day)
    END;
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

-- Reaplica vencimentos só nas parcelas que NÃO são entrada-pendente.
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
BEGIN
  IF p_inst IS NULL OR jsonb_typeof(p_inst) <> 'array' OR v_first IS NULL THEN
    RETURN coalesce(p_inst, '[]'::jsonb);
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      CASE
        WHEN coalesce(elem->'tags', '[]'::jsonb) ? 'entrada-pendente' THEN elem
        ELSE elem || jsonb_build_object(
          'dueDate',
          (CASE
            WHEN ord_boleto = 1 THEN v_first
            ELSE public.iam_due_on_month(v_first, (ord_boleto - 1)::int, v_due_day)
          END)::text
        )
      END
      ORDER BY (elem->>'number')::int
    )
    FROM (
      SELECT
        elem,
        sum(
          CASE WHEN coalesce(elem->'tags', '[]'::jsonb) ? 'entrada-pendente' THEN 0 ELSE 1 END
        ) OVER (ORDER BY (elem->>'number')::int ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
          AS ord_boleto
      FROM jsonb_array_elements(p_inst) elem
    ) x
  ), '[]'::jsonb);
END;
$$;

-- ── iam_treinamento_financeiro: usa as datas resolvidas ───────────────────
-- (cópia da versão 20260917120000 com âncoras de data)

CREATE OR REPLACE FUNCTION public.iam_treinamento_financeiro(p_treinamento jsonb)
RETURNS TABLE(sale_value numeric, down_payment numeric, total_installments integer, installment_value numeric, installments jsonb, paid_installments integer)
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_sale numeric := coalesce(nullif(p_treinamento->>'valor_total', '')::numeric, 0);
  v_down numeric := 0;
  v_cartao numeric := 0;
  v_cartao_avista numeric := 0;
  v_cartao_prazo numeric := 0;
  v_boleto_avista numeric := 0;
  v_pend_paga numeric := 0;
  v_parcelado numeric := 0;
  v_parcelas int;
  v_data_venda text := coalesce(left(p_treinamento->>'data_venda', 10), '');
  v_fp jsonb;
  v_formas jsonb := coalesce(p_treinamento->'formas_pagamento', '[]'::jsonb);
  v_i int;
  v_forma text;
  v_valor numeric;
  v_valor_parcela numeric;
  v_parcelas_pagas int;
  v_detalhe jsonb := coalesce(p_treinamento->'parcelas_detalhe', '[]'::jsonb);
  v_detalhe_len int := coalesce(jsonb_array_length(v_detalhe), 0);
  v_detalhe_sum numeric := 0;
  v_acum numeric := 0;
  v_corte int := 0;
  v_status text := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_pendente boolean := public.iam_status_is_pendente(v_status);
  v_base date := coalesce(nullif(left(v_data_venda, 10), '')::date, current_date);
  v_inst jsonb := '[]'::jsonb;
  v_entrada_restante numeric := 0;
  v_valor_pago numeric := coalesce(nullif(p_treinamento->>'valor_pago', '')::numeric, 0);
  v_valor_pendente numeric := coalesce(nullif(p_treinamento->>'valor_pendente', '')::numeric, 0);
  v_sum_inst numeric := 0;
  v_first numeric := 0;
  v_modalidade text := upper(coalesce(
    p_treinamento->>'modalidade_pagamento',
    p_treinamento->>'tipo_pagamento',
    ''
  ));
  v_fp_parcelas int;
  v_forma_pendente boolean;
  v_tem_forma_pendente boolean := false;
  v_entrada_iam numeric;
  v_cartao_na_entrada boolean := false;
  v_pendencia_due date;
  v_primeiro_boleto date;
  v_due_day int;
BEGIN
  SELECT d.pendencia_due, d.primeiro_boleto, d.due_day
    INTO v_pendencia_due, v_primeiro_boleto, v_due_day
  FROM public.iam_datas_do_treinamento(p_treinamento) d;

  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    IF public.iam_forma_is_pendencia(v_formas->v_i) THEN
      v_tem_forma_pendente := true;
      EXIT;
    END IF;
  END LOOP;

  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    v_fp_parcelas := coalesce(nullif(v_fp->>'parcelas', '')::int, 0);
    v_forma_pendente := public.iam_forma_is_pendencia(v_fp);

    IF v_forma_pendente THEN
      IF v_pendente THEN
        v_entrada_restante := v_entrada_restante + v_valor;
      ELSE
        v_pend_paga := v_pend_paga + v_valor;
      END IF;
    ELSIF coalesce(v_fp->>'a_vista', '') IN ('true', '1', 'sim', 'TRUE')
       OR btrim(coalesce(v_fp->>'modalidade', '')) ILIKE '%vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%à vista%'
       OR btrim(coalesce(v_forma, '')) ILIKE '%a vista%' THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_entrada(v_forma) THEN
      v_down := v_down + v_valor;
    ELSIF (NOT v_pendente OR v_tem_forma_pendente) AND public.iam_forma_is_cartao_credito(v_forma) THEN
      v_cartao := v_cartao + v_valor;
      IF v_fp_parcelas > 1 THEN
        v_cartao_prazo := v_cartao_prazo + v_valor;
      ELSE
        v_cartao_avista := v_cartao_avista + v_valor;
      END IF;
    ELSIF public.iam_forma_is_parcelado(v_forma) THEN
      IF NOT v_pendente AND v_fp_parcelas = 1 THEN
        v_down := v_down + v_valor;
        v_boleto_avista := v_boleto_avista + v_valor;
      ELSE
        v_parcelado := v_parcelado + v_valor;
      END IF;
    END IF;
  END LOOP;

  IF nullif(p_treinamento->>'valor_entrada', '') IS NOT NULL THEN
    v_entrada_iam := (p_treinamento->>'valor_entrada')::numeric;
    v_cartao_na_entrada := v_cartao_avista > 0.0049
      AND v_entrada_iam >= (v_down - v_boleto_avista) + v_cartao_avista - 0.05;
    v_down := v_entrada_iam;
  END IF;

  IF v_pend_paga > 0.0049 THEN
    v_down := v_down + v_pend_paga;
  END IF;

  IF v_cartao > 0.0049 THEN
    IF v_cartao_na_entrada THEN
      v_down := v_down + v_cartao_prazo;
    ELSE
      v_down := v_down + v_cartao;
    END IF;

    SELECT coalesce(sum(nullif(elem, '')::numeric), 0)
    INTO v_detalhe_sum
    FROM jsonb_array_elements_text(v_detalhe) elem;

    IF v_detalhe_len > 0 AND abs(v_detalhe_sum - v_cartao) < 0.05 THEN
      v_detalhe := '[]'::jsonb;
      v_detalhe_len := 0;
    ELSIF v_detalhe_len > 0 AND v_detalhe_sum > v_cartao + 0.05 THEN
      v_acum := 0;
      v_corte := 0;
      FOR v_i IN 0..v_detalhe_len - 1 LOOP
        v_acum := v_acum + coalesce(nullif(v_detalhe->>v_i, '')::numeric, 0);
        IF abs(v_acum - v_cartao) < 0.05 THEN
          v_corte := v_i + 1;
          EXIT;
        END IF;
        EXIT WHEN v_acum > v_cartao + 0.05;
      END LOOP;
      IF v_corte > 0 THEN
        v_detalhe := coalesce((
          SELECT jsonb_agg(elem ORDER BY ord)
          FROM jsonb_array_elements(v_detalhe) WITH ORDINALITY AS t(elem, ord)
          WHERE ord > v_corte
        ), '[]'::jsonb);
        v_detalhe_len := coalesce(jsonb_array_length(v_detalhe), 0);
      END IF;
    END IF;
  END IF;

  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    v_fp_parcelas := coalesce(nullif(v_fp->>'parcelas', '')::int, 0);
    IF v_fp_parcelas > 1
       AND v_valor > 0.0049
       AND NOT public.iam_forma_is_pendencia(v_fp)
       AND NOT public.iam_forma_is_cartao_credito(v_forma)
       AND public.iam_forma_is_parcelado(v_forma)
       AND (
         v_detalhe_len = 0
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(v_detalhe) elem
           WHERE abs(coalesce(nullif(elem, '')::numeric, 0) - v_valor) < 0.05
         )
       ) THEN
      v_valor_parcela := round(v_valor / v_fp_parcelas, 2);
      v_detalhe := (
        SELECT jsonb_agg(
          CASE WHEN gs.i = v_fp_parcelas
               THEN round(v_valor - v_valor_parcela * (v_fp_parcelas - 1), 2)
               ELSE v_valor_parcela END
          ORDER BY gs.i)
        FROM generate_series(1, v_fp_parcelas) AS gs(i)
      );
      v_detalhe_len := v_fp_parcelas;
      EXIT;
    END IF;
  END LOOP;

  IF v_pendente AND v_parcelado > 0.0049 AND v_down > v_sale - v_parcelado + 0.01 THEN
    v_down := round(greatest(v_sale - v_parcelado, 0), 2);
  END IF;

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;
  IF v_corte > 0 THEN
    v_parcelas_pagas := greatest(v_parcelas_pagas - v_corte, 0);
  END IF;

  IF v_pendente AND v_valor_pendente > 0.0049 AND v_valor_pendente < v_sale - 0.01 THEN
    IF v_entrada_restante < 0.01 THEN
      v_entrada_restante := round(v_valor_pendente, 2);
    END IF;
    IF v_valor_pago > 0.0049 THEN
      v_down := round(v_valor_pago, 2);
    ELSIF v_entrada_restante >= v_valor_pendente - 0.01 THEN
      v_down := 0;
    END IF;
  END IF;

  IF v_pendente AND v_entrada_restante < 0.01 AND v_down > 0.0049 THEN
    IF v_valor_pago >= v_down - 0.01 THEN
      NULL;
    ELSE
      v_entrada_restante := round(v_down, 2);
      v_down := 0;
    END IF;
  END IF;

  IF v_detalhe_len > 0 THEN
    v_parcelas := v_detalhe_len;
    v_valor_parcela := coalesce(nullif(v_detalhe->>0, '')::numeric, 0);
    IF v_parcelas > 0 THEN
      v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
    END IF;
    v_inst := public.iam_build_installments_from_values(
      v_detalhe, v_data_venda, v_parcelas_pagas, v_primeiro_boleto, v_due_day
    );
  ELSE
    v_parcelas := nullif(p_treinamento->>'parcelas', '')::int;
    IF v_cartao > 0.0049 AND v_down + v_entrada_restante >= v_sale - 0.01 THEN
      v_parcelas := 0;
    END IF;
    IF v_parcelas IS NULL OR v_parcelas < 1 THEN
      IF v_parcelado > 0 AND (v_sale - coalesce(nullif(v_entrada_restante, 0), v_down) ) > 0.01 THEN
        v_parcelas := 1;
      ELSE
        v_parcelas := 0;
      END IF;
    END IF;

    v_valor_parcela := coalesce(nullif(p_treinamento->>'valor_parcela', '')::numeric, 0);
    IF v_valor_parcela <= 0 THEN
      v_valor_parcela := CASE
        WHEN v_parcelas > 0 THEN
          round(greatest(v_sale - CASE WHEN v_entrada_restante > 0 THEN v_entrada_restante ELSE v_down END, 0) / v_parcelas, 2)
        ELSE 0
      END;
    END IF;

    IF v_parcelas > 0 THEN
      v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
    END IF;

    IF v_parcelas > 0 AND v_valor_parcela > 0 THEN
      v_inst := public.iam_build_installments_from_values(
        (
          SELECT coalesce(jsonb_agg(round(v_valor_parcela, 2)), '[]'::jsonb)
          FROM generate_series(1, v_parcelas) AS gs(i)
        ),
        v_data_venda,
        v_parcelas_pagas,
        v_primeiro_boleto,
        v_due_day
      );
    ELSE
      v_inst := public.iam_build_installments(
        v_sale,
        CASE WHEN v_entrada_restante > 0 THEN 0 ELSE v_down END,
        v_parcelas,
        v_data_venda,
        v_primeiro_boleto,
        v_due_day
      );
    END IF;
  END IF;

  SELECT coalesce(sum((elem->>'value')::numeric), 0)
  INTO v_sum_inst
  FROM jsonb_array_elements(coalesce(v_inst, '[]'::jsonb)) elem;

  v_first := coalesce((v_inst->0->>'value')::numeric, 0);

  IF v_pendente
     AND v_entrada_restante >= v_sale - 0.01
     AND coalesce(v_parcelas, 0) > 1 THEN
    IF v_valor_parcela > 0 THEN
      v_entrada_restante := round(greatest(v_sale - v_valor_parcela * v_parcelas, 0), 2);
    ELSIF v_parcelado > 0.0049 THEN
      v_entrada_restante := round(greatest(v_sale - v_parcelado, 0), 2);
    END IF;
  END IF;

  IF v_down > 0.0049 AND v_entrada_restante < 0.01 AND v_sale > 0 THEN
    IF abs(v_sum_inst - v_sale) < 0.05 AND abs(v_first - v_down) < 0.05 THEN
      v_inst := coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb(rn::int))
          ORDER BY rn
        )
        FROM (
          SELECT elem, row_number() OVER (ORDER BY ord) AS rn
          FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(elem, ord)
          WHERE ord > 1
        ) x
      ), '[]'::jsonb);
      SELECT coalesce(sum((elem->>'value')::numeric), 0)
      INTO v_sum_inst
      FROM jsonb_array_elements(v_inst) elem;
    ELSIF v_sum_inst + v_down > v_sale + 0.05 AND abs(v_sum_inst - (v_sale - v_down)) > 0.05 THEN
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', round(greatest(v_sale - v_down, 0), 2),
          'dueDate', v_primeiro_boleto::text,
          'paid', false
        )
      );
      v_sum_inst := round(greatest(v_sale - v_down, 0), 2);
      v_parcelas_pagas := 0;
    END IF;
  END IF;

  IF v_entrada_restante > 0.0049 THEN
    IF abs(v_sum_inst - v_sale) < 0.05 THEN
      IF abs(v_first - v_entrada_restante) < 0.05 THEN
        v_inst := jsonb_set(
          jsonb_set(
            v_inst,
            '{0,tags}',
            coalesce(v_inst->0->'tags', '[]'::jsonb) || '"entrada-pendente"'::jsonb
          ),
          '{0,dueDate}',
          to_jsonb(v_pendencia_due::text)
        );
        v_inst := public.iam_redate_boletos(v_inst, v_primeiro_boleto, v_due_day);
      END IF;
    ELSIF abs(v_sum_inst - (v_sale - v_entrada_restante)) < 0.05
       OR abs(v_sum_inst + v_entrada_restante - v_sale) < 0.05
       OR v_sum_inst < 0.01 THEN
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', v_entrada_restante,
          'dueDate', v_pendencia_due::text,
          'paid', false,
          'tags', jsonb_build_array('entrada-pendente')
        )
      ) || coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb((elem->>'number')::int + 1))
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(v_inst) elem
      ), '[]'::jsonb);
      v_inst := public.iam_redate_boletos(v_inst, v_primeiro_boleto, v_due_day);
      v_parcelas_pagas := 0;
    ELSIF v_sum_inst + v_entrada_restante > v_sale + 0.05 THEN
      IF abs(v_first - v_entrada_restante) < 0.05 THEN
        v_inst := jsonb_set(
          jsonb_set(
            v_inst,
            '{0,tags}',
            coalesce(v_inst->0->'tags', '[]'::jsonb) || '"entrada-pendente"'::jsonb
          ),
          '{0,dueDate}',
          to_jsonb(v_pendencia_due::text)
        );
        v_inst := public.iam_redate_boletos(v_inst, v_primeiro_boleto, v_due_day);
      END IF;
    ELSE
      v_inst := jsonb_build_array(
        jsonb_build_object(
          'number', 1,
          'value', v_entrada_restante,
          'dueDate', v_pendencia_due::text,
          'paid', false,
          'tags', jsonb_build_array('entrada-pendente')
        )
      ) || coalesce((
        SELECT jsonb_agg(
          jsonb_set(elem, '{number}', to_jsonb((elem->>'number')::int + 1))
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(v_inst) elem
      ), '[]'::jsonb);
      v_inst := public.iam_redate_boletos(v_inst, v_primeiro_boleto, v_due_day);
      v_parcelas_pagas := 0;
    END IF;
  END IF;

  IF NOT v_pendente AND v_sale > 0.0049 THEN
    IF v_valor_pago >= v_sale - 0.01
       OR v_down >= v_sale - 0.01
       OR v_modalidade LIKE '%VISTA%'
       OR (v_modalidade LIKE '%CART%' AND v_modalidade NOT LIKE '%DEB%') THEN
      sale_value := v_sale;
      down_payment := round(v_sale, 2);
      total_installments := 0;
      installment_value := 0;
      installments := '[]'::jsonb;
      paid_installments := 0;
      RETURN NEXT;
      RETURN;
    END IF;

    IF coalesce(v_parcelas, 0) > 0 AND v_parcelas_pagas >= v_parcelas THEN
      installments := coalesce((
        SELECT jsonb_agg(
          jsonb_set(
            jsonb_set(elem, '{paid}', 'true'::jsonb),
            '{paidDate}',
            to_jsonb(coalesce(elem->>'paidDate', v_base::text))
          )
          ORDER BY (elem->>'number')::int
        )
        FROM jsonb_array_elements(coalesce(v_inst, '[]'::jsonb)) elem
      ), '[]'::jsonb);
      sale_value := v_sale;
      down_payment := round(v_down, 2);
      total_installments := coalesce(jsonb_array_length(installments), v_parcelas, 0);
      installment_value := round(coalesce(nullif((installments->0->>'value')::numeric, 0), v_valor_parcela, 0), 2);
      paid_installments := v_parcelas;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  sale_value := v_sale;
  down_payment := round(v_down, 2);
  total_installments := coalesce(jsonb_array_length(v_inst), v_parcelas, 0);
  installment_value := round(coalesce(
    nullif((v_inst->0->>'value')::numeric, 0),
    v_valor_parcela,
    0
  ), 2);
  installments := coalesce(v_inst, '[]'::jsonb);
  paid_installments := v_parcelas_pagas;
  RETURN NEXT;
END;
$function$;

COMMENT ON FUNCTION public.iam_treinamento_financeiro(jsonb) IS
  'Financeiro IAM→GC. Pendência usa data_vencimento do IAM (ou data_venda+5d). Boletos usam data_primeiro_vencimento/dia_vencimento (ou dia 10 a partir do mês seguinte).';

-- ── Backfill: corrige fichas já gravadas com o padrão antigo ──────────────

DO $$
DECLARE
  v_stud record;
  v_enroll date;
  v_pend_due date;
  v_due_day int;
  v_first_boleto date;
  v_new jsonb;
  v_n int := 0;
BEGIN
  FOR v_stud IN
    SELECT s.id, s.name, s.enrollment_date, s.due_day, s.installments
    FROM public.students s
    WHERE s.iam_control_aluno_id IS NOT NULL
      AND jsonb_typeof(s.installments) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(s.installments) i
        WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
          AND coalesce((i->>'paid')::boolean, false) = false
          AND (
            -- clássico: pendência no dia da matrícula/venda
            (i->>'dueDate') = left(coalesce(s.enrollment_date, ''), 10)
            -- ou boletos no mesmo dia do mês da matrícula (data_venda + N meses)
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(s.installments) b
              WHERE NOT coalesce(b->'tags', '[]'::jsonb) ? 'entrada-pendente'
                AND coalesce((b->>'paid')::boolean, false) = false
                AND public.iam_parse_iso_date(b->>'dueDate') IS NOT NULL
                AND public.iam_parse_iso_date(s.enrollment_date) IS NOT NULL
                AND EXTRACT(DAY FROM public.iam_parse_iso_date(b->>'dueDate'))
                  = EXTRACT(DAY FROM public.iam_parse_iso_date(s.enrollment_date))
            )
          )
      )
  LOOP
    v_enroll := coalesce(public.iam_parse_iso_date(v_stud.enrollment_date), current_date);
    v_due_day := coalesce(nullif(v_stud.due_day, 0), 10);
    v_pend_due := (v_enroll + interval '5 days')::date;

    -- Se a pendência já foi ajustada (≠ matrícula), preserva.
    SELECT public.iam_parse_iso_date(i->>'dueDate')
      INTO v_pend_due
    FROM jsonb_array_elements(v_stud.installments) i
    WHERE coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
    ORDER BY (i->>'number')::int
    LIMIT 1;

    IF v_pend_due IS NULL OR v_pend_due = v_enroll THEN
      v_pend_due := (v_enroll + interval '5 days')::date;
    END IF;

    v_first_boleto := public.iam_due_on_month(v_enroll, 1, v_due_day);
    IF v_first_boleto <= v_pend_due THEN
      v_first_boleto := public.iam_first_due_after(v_pend_due, v_due_day);
    END IF;

    -- Ajusta dueDate da entrada-pendente aberta.
    v_new := (
      SELECT coalesce(jsonb_agg(
        CASE
          WHEN coalesce(i->'tags', '[]'::jsonb) ? 'entrada-pendente'
               AND NOT coalesce((i->>'paid')::boolean, false)
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
          'Vencimentos IAM corrigidos: pendência em %s; boletos a partir de %s (dia %s).',
          to_char(v_pend_due, 'DD/MM/YYYY'),
          to_char(v_first_boleto, 'DD/MM/YYYY'),
          v_due_day
        )
      )),
      updated_at = now()
    WHERE s.id = v_stud.id;

    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'iam_datas_pendencia_boletos: % fichas corrigidas', v_n;
END;
$$;

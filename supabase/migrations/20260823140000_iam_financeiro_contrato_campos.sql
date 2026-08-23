-- Sync IAM: usa campos explícitos do contrato (entrada, parcelas, valor parcela, parcelas pagas)
-- quando exportados pelo webhook gestao-contas/clientes.

DROP FUNCTION IF EXISTS public.iam_treinamento_financeiro(jsonb);

CREATE OR REPLACE FUNCTION public.iam_treinamento_financeiro(p_treinamento jsonb)
RETURNS TABLE (
  sale_value numeric,
  down_payment numeric,
  total_installments int,
  installment_value numeric,
  installments jsonb,
  paid_installments int
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sale numeric := coalesce(nullif(p_treinamento->>'valor_total', '')::numeric, 0);
  v_down numeric := 0;
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
BEGIN
  FOR v_i IN 0..greatest(jsonb_array_length(v_formas) - 1, -1) LOOP
    v_fp := v_formas->v_i;
    v_forma := v_fp->>'forma';
    v_valor := coalesce(nullif(v_fp->>'valor', '')::numeric, 0);
    IF public.iam_forma_is_entrada(v_forma) THEN
      v_down := v_down + v_valor;
    ELSIF public.iam_forma_is_parcelado(v_forma) THEN
      v_parcelado := v_parcelado + v_valor;
    END IF;
  END LOOP;

  IF nullif(p_treinamento->>'valor_entrada', '') IS NOT NULL THEN
    v_down := (p_treinamento->>'valor_entrada')::numeric;
  END IF;

  v_parcelas := nullif(p_treinamento->>'parcelas', '')::int;
  IF v_parcelas IS NULL OR v_parcelas < 1 THEN
    IF v_parcelado > 0 AND (v_sale - v_down) > 0.01 THEN
      v_parcelas := 1;
    ELSE
      v_parcelas := 0;
    END IF;
  END IF;

  v_valor_parcela := coalesce(nullif(p_treinamento->>'valor_parcela', '')::numeric, 0);
  IF v_valor_parcela <= 0 THEN
    v_valor_parcela := CASE
      WHEN v_parcelas > 0 THEN round(greatest(v_sale - v_down, 0) / v_parcelas, 2)
      ELSE 0
    END;
  END IF;

  v_parcelas_pagas := coalesce(nullif(p_treinamento->>'parcelas_pagas', '')::int, 0);
  IF v_parcelas_pagas < 0 THEN
    v_parcelas_pagas := 0;
  END IF;
  IF v_parcelas > 0 THEN
    v_parcelas_pagas := least(v_parcelas_pagas, v_parcelas);
  END IF;

  sale_value := v_sale;
  down_payment := round(v_down, 2);
  total_installments := v_parcelas;
  installment_value := round(v_valor_parcela, 2);
  installments := public.iam_build_installments(v_sale, v_down, v_parcelas, v_data_venda);
  paid_installments := v_parcelas_pagas;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.iam_control_upsert_one_contract(
  p jsonb,
  p_produto text,
  p_treinamento jsonb,
  p_data_matricula text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_iam_id       bigint  := nullif(p->>'iam_control_aluno_id', '')::bigint;
  v_nome         text    := btrim(coalesce(p->>'nome', ''));
  v_email        text    := coalesce(p->>'email', '');
  v_whatsapp     text    := coalesce(p->>'whatsapp', '');
  v_cpf          text    := coalesce(p->>'cpf', '');
  v_cpf_digits   text    := regexp_replace(v_cpf, '[^0-9]', '', 'g');
  v_end          jsonb   := coalesce(p->'endereco', '{}'::jsonb);
  v_produto      text    := btrim(coalesce(p_produto, ''));
  v_data_matric  text    := coalesce(left(p_data_matricula, 10), left(p_treinamento->>'data_venda', 10), '');
  v_fin          record;
  v_student_id   uuid;
  v_matched_by   text    := null;
  v_empatados    int     := 0;
  v_acao         text;
  v_company_id   uuid    := coalesce(
    public.current_company_id(),
    '00000000-0000-0000-0000-0000000a1a11'::uuid
  );
BEGIN
  IF v_produto = '' OR public.product_excluded_from_gc(v_produto) THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'treinamento vazio ou fora do GC', 'produto', v_produto);
  END IF;

  SELECT * INTO v_fin FROM public.iam_treinamento_financeiro(p_treinamento) LIMIT 1;

  IF length(v_cpf_digits) >= 11 THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.cpf_digits = v_cpf_digits
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'cpf_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'iam_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND coalesce(btrim(s.product), '') = ''
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      v_matched_by := 'iam_sem_produto';
    END IF;
  END IF;

  IF v_student_id IS NULL THEN
    SELECT r.id, r.empatados
    INTO v_student_id, v_empatados
    FROM (
      SELECT c.id,
             c.pontos,
             count(*) OVER (PARTITION BY c.pontos) AS empatados
      FROM (
        SELECT s.id,
               (CASE WHEN public.iam_normalize_phone(v_whatsapp) <> ''
                      AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp)
                     THEN 2 ELSE 0 END)
             + (CASE WHEN public.iam_normalize_email(v_email) <> ''
                      AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email)
                     THEN 2 ELSE 0 END)
             + (CASE WHEN public.iam_normalize_name(v_nome) <> ''
                      AND public.iam_normalize_name(s.name) = public.iam_normalize_name(v_nome)
                     THEN 1 ELSE 0 END) AS pontos
        FROM public.students s
        WHERE s.company_id = v_company_id
          AND s.iam_control_aluno_id IS NULL
          AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
          AND (
            (public.iam_normalize_phone(v_whatsapp) <> ''
             AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp))
         OR (public.iam_normalize_email(v_email) <> ''
             AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email))
          )
      ) c
      WHERE c.pontos >= 3
    ) r
    ORDER BY r.pontos DESC
    LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      IF v_empatados > 1 THEN
        RETURN jsonb_build_object(
          'acao', 'ambiguo',
          'iam_control_aluno_id', v_iam_id,
          'produto', v_produto,
          'motivo', v_empatados || ' cadastros conferem com os mesmos dados'
        );
      END IF;
      v_matched_by := 'identidade';
    END IF;
  END IF;

  IF v_student_id IS NOT NULL THEN
    UPDATE public.students s SET
      iam_control_aluno_id    = coalesce(v_iam_id, s.iam_control_aluno_id),
      iam_control_synced_at   = now(),
      name                    = v_nome,
      email                   = coalesce(nullif(v_email, ''), s.email),
      whatsapp                = coalesce(nullif(v_whatsapp, ''), s.whatsapp),
      cpf                     = coalesce(nullif(v_cpf, ''), s.cpf),
      address                 = coalesce(nullif(v_end->>'logradouro', ''), s.address),
      numero                  = coalesce(nullif(v_end->>'numero', ''), s.numero),
      cidade                  = coalesce(nullif(v_end->>'cidade', ''), s.cidade),
      estado                  = coalesce(nullif(v_end->>'estado', ''), s.estado),
      cep                     = coalesce(nullif(v_end->>'cep', ''), s.cep),
      product                 = v_produto,
      enrollment_date         = coalesce(nullif(v_data_matric, ''), s.enrollment_date),
      data_treinamento_origem = coalesce(nullif(v_data_matric, ''), s.data_treinamento_origem),
      sale_value              = v_fin.sale_value,
      down_payment            = v_fin.down_payment,
      total_installments      = v_fin.total_installments,
      installment_value       = v_fin.installment_value,
      installments            = v_fin.installments,
      paid_installments       = v_fin.paid_installments
    WHERE s.id = v_student_id;

    v_acao := 'atualizado';
  ELSE
    INSERT INTO public.students (
      company_id,
      iam_control_aluno_id, iam_control_synced_at,
      name, email, whatsapp, cpf,
      address, numero, cidade, estado, cep,
      product, enrollment_date, data_treinamento_origem,
      sale_value, down_payment, total_installments, installment_value,
      installments, paid_installments
    ) VALUES (
      v_company_id,
      v_iam_id, now(),
      v_nome, nullif(v_email, ''), v_whatsapp, v_cpf,
      coalesce(v_end->>'logradouro', ''), coalesce(v_end->>'numero', ''),
      coalesce(v_end->>'cidade', ''), coalesce(v_end->>'estado', ''), coalesce(v_end->>'cep', ''),
      v_produto, nullif(v_data_matric, ''), nullif(v_data_matric, ''),
      v_fin.sale_value, v_fin.down_payment, v_fin.total_installments, v_fin.installment_value,
      v_fin.installments, v_fin.paid_installments
    )
    RETURNING id INTO v_student_id;

    v_acao := 'criado';
    v_matched_by := 'novo';
  END IF;

  RETURN jsonb_build_object(
    'acao', v_acao,
    'student_id', v_student_id,
    'iam_control_aluno_id', v_iam_id,
    'produto', v_produto,
    'casado_por', v_matched_by
  );
END;
$function$;

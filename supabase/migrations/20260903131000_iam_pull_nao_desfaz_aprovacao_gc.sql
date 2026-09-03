-- O pull do IAM (cron 5 min) desfazia a aprovação feita na Conciliação GC.
--
-- Sintoma: Carol aprovou 5 contratos em "IAM CONTROL → GC" (00h15–01h10 de
-- 03/09). Minutos depois o cron trouxe o mesmo contrato ainda com
-- PARA_CONCILIAR / PENDENTE_PIX no IAM e a migração 20260828010000 zerava
-- iam_gc_conciliado_at e devolvia iam_control_contrato_status ao valor do IAM.
-- Resultado: o aluno voltava a "Pendente" fora da carteira e da dashboard,
-- e sem novo item na fila (o item já estava conciliado). No PENDENTE_PIX o
-- financeiro também era reescrito, apagando o parcelamento 2x7.000 feito no GC.
--
-- Regra nova: a aprovação GC só é reaberta quando o IAM MUDA o status do
-- contrato de um estado não pendente (CONCILIADO/AJUSTES…) para um estado
-- pendente — uma pendência nova de verdade. Enquanto o IAM apenas continua
-- dizendo o mesmo status pendente que já foi aprovado no GC, nada muda.
-- Para isso passamos a guardar o último status bruto vindo do IAM em
-- iam_control_status_origem (iam_control_contrato_status é a visão do GC e
-- vira CONCILIADO na aprovação).

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS iam_control_status_origem text;

COMMENT ON COLUMN public.students.iam_control_status_origem IS
  'Último status_conciliacao bruto recebido do IAM Control no pull. iam_control_contrato_status é a visão do GC (vira CONCILIADO na aprovação).';

-- Backfill.
-- Fichas ainda não aprovadas no GC: o status gravado é o do IAM.
UPDATE public.students s
SET iam_control_status_origem = s.iam_control_contrato_status
WHERE s.iam_control_aluno_id IS NOT NULL
  AND s.iam_control_status_origem IS NULL
  AND s.iam_gc_conciliado_at IS NULL;

-- Fichas já aprovadas no GC: iam_control_contrato_status virou CONCILIADO na
-- aprovação; o status que o IAM tinha na hora está no item da fila (antes).
UPDATE public.students s
SET iam_control_status_origem = coalesce(
  (
    SELECT upper(nullif(btrim(ci.antes->>'iam_control_contrato_status'), ''))
    FROM public.conciliacao_items ci
    WHERE ci.tipo = 'iam_pendente'
      AND ci.student_id = s.id
      AND ci.status = 'conciliado'
    ORDER BY ci.conciliado_at DESC NULLS LAST, ci.created_at DESC
    LIMIT 1
  ),
  'CONCILIADO'
)
WHERE s.iam_control_aluno_id IS NOT NULL
  AND s.iam_control_status_origem IS NULL
  AND s.iam_gc_conciliado_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.iam_control_upsert_one_contract(p jsonb, p_produto text, p_treinamento jsonb, p_data_matricula text)
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
  v_company_id   uuid    := coalesce(public.current_company_id(), '00000000-0000-0000-0000-0000000a1a11'::uuid);
  v_contrato_id  text    := nullif(btrim(coalesce(p_treinamento->>'contrato_id', '')), '');
  v_status       text    := upper(nullif(btrim(coalesce(p_treinamento->>'status_conciliacao', '')), ''));
  v_pend_tipo    text    := upper(nullif(btrim(coalesce(p_treinamento->>'pendente_tipo', '')), ''));
  v_pend_link    text    := nullif(btrim(coalesce(p_treinamento->>'pendente_link', '')), '');
  v_kamino       boolean := false;
  v_sem_parcelas boolean := true;
  v_is_pendente  boolean := false;
  v_aguarda_gc   boolean := false;
  v_preserva_fin boolean := false;
  v_gc_aprovado_em timestamptz;
  v_status_origem_ant text;
  v_reabre       boolean := false;
  v_mantem_aprov boolean := false;
BEGIN
  IF v_produto = '' OR public.product_excluded_from_gc(v_produto) THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'treinamento vazio ou fora do GC', 'produto', v_produto);
  END IF;

  -- Proteção 1: contrato NOVO não é importado nem atualizado pelo pull.
  IF v_status = 'NOVO' THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'status NOVO não importado no GC',
      'iam_control_aluno_id', v_iam_id,
      'produto', v_produto,
      'status_conciliacao', v_status
    );
  END IF;

  v_is_pendente := public.iam_status_is_pendente(v_status);
  v_aguarda_gc  := v_status IN ('PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR');

  IF v_status IS DISTINCT FROM 'PENDENTE' THEN
    v_pend_tipo := NULL;
    v_pend_link := NULL;
  ELSIF v_pend_tipo IS DISTINCT FROM 'LINK' THEN
    v_pend_link := NULL;
  END IF;

  -- Proteção 2: financeiro de ficha Kamino não vem do IAM.
  SELECT EXISTS (
    SELECT 1 FROM public._kamino_sync_staging k
    WHERE k.skey = public.gc_student_key(v_nome, v_produto)
  ) INTO v_kamino;

  SELECT * INTO v_fin FROM public.iam_treinamento_financeiro(p_treinamento) LIMIT 1;

  IF v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.iam_control_aluno_id = v_iam_id
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'iam_global_produto'; END IF;
  END IF;

  IF v_student_id IS NULL AND length(v_cpf_digits) >= 11 THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.cpf_digits = v_cpf_digits
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.created_at ASC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'cpf_produto'; END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'iam_produto'; END IF;
  END IF;

  IF v_student_id IS NULL AND v_iam_id IS NOT NULL THEN
    SELECT s.id INTO v_student_id
    FROM public.students s
    WHERE s.company_id = v_company_id
      AND s.iam_control_aluno_id = v_iam_id
      AND coalesce(btrim(s.product), '') = ''
    ORDER BY s.updated_at DESC NULLS LAST
    LIMIT 1;
    IF v_student_id IS NOT NULL THEN v_matched_by := 'iam_sem_produto'; END IF;
  END IF;

  IF v_student_id IS NULL THEN
    SELECT r.id, r.empatados INTO v_student_id, v_empatados
    FROM (
      SELECT c.id, c.pontos, count(*) OVER (PARTITION BY c.pontos) AS empatados
      FROM (
        SELECT s.id,
          (CASE WHEN public.iam_normalize_phone(v_whatsapp) <> '' AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp) THEN 2 ELSE 0 END)
          + (CASE WHEN public.iam_normalize_email(v_email) <> '' AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email) THEN 2 ELSE 0 END)
          + (CASE WHEN public.iam_normalize_name(v_nome) <> '' AND public.iam_normalize_name(s.name) = public.iam_normalize_name(v_nome) THEN 1 ELSE 0 END) AS pontos
        FROM public.students s
        WHERE s.company_id = v_company_id
          AND s.iam_control_aluno_id IS NULL
          AND lower(btrim(coalesce(s.product, ''))) = lower(btrim(v_produto))
          AND (
            (public.iam_normalize_phone(v_whatsapp) <> '' AND public.iam_normalize_phone(s.whatsapp) = public.iam_normalize_phone(v_whatsapp))
            OR (public.iam_normalize_email(v_email) <> '' AND public.iam_normalize_email(s.email) = public.iam_normalize_email(v_email))
          )
      ) c
      WHERE c.pontos >= 3
    ) r
    ORDER BY r.pontos DESC
    LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      IF v_empatados > 1 THEN
        RETURN jsonb_build_object('acao', 'ambiguo', 'iam_control_aluno_id', v_iam_id, 'produto', v_produto, 'motivo', v_empatados || ' cadastros conferem com os mesmos dados');
      END IF;
      v_matched_by := 'identidade';
    END IF;
  END IF;

  IF v_student_id IS NOT NULL THEN
    -- Reavalia a proteção Kamino pelo nome/produto já gravados na ficha.
    IF NOT v_kamino THEN
      SELECT EXISTS (
        SELECT 1 FROM public._kamino_sync_staging k
        JOIN public.students s2 ON k.skey = public.gc_student_key(s2.name, s2.product)
        WHERE s2.id = v_student_id
      ) INTO v_kamino;
    END IF;

    SELECT coalesce(jsonb_array_length(s2.installments), 0) = 0,
           s2.iam_gc_conciliado_at,
           upper(nullif(btrim(coalesce(s2.iam_control_status_origem, '')), ''))
      INTO v_sem_parcelas, v_gc_aprovado_em, v_status_origem_ant
      FROM public.students s2
     WHERE s2.id = v_student_id;

    -- Aprovação GC só reabre quando o IAM MUDA para um status pendente vindo
    -- de um status que não aguardava GC (ex.: CONCILIADO → PENDENTE_PIX).
    -- Origem desconhecida (NULL) nunca reabre: é a 1ª passada após o deploy.
    v_reabre := v_aguarda_gc
      AND v_gc_aprovado_em IS NOT NULL
      AND v_status_origem_ant IS NOT NULL
      AND v_status_origem_ant IS DISTINCT FROM v_status
      AND NOT (v_status_origem_ant IN ('PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR'));
    v_mantem_aprov := v_gc_aprovado_em IS NOT NULL AND NOT v_reabre;

    -- Proteção 3: ficha que já tem cronograma não é reescrita pelo IAM,
    -- exceto quando o contrato está pendente E ainda não foi aprovado no GC.
    v_preserva_fin := v_kamino OR (NOT v_sem_parcelas AND (NOT v_is_pendente OR v_mantem_aprov));

    UPDATE public.students s SET
      company_id = CASE
        WHEN v_aguarda_gc AND NOT v_mantem_aprov THEN v_company_id
        WHEN v_status = 'CONCILIADO'
          AND s.iam_gc_conciliado_at IS NULL
          AND NOT (
            (coalesce(s.total_installments, 0) = 0 AND coalesce(s.down_payment, 0) >= coalesce(s.sale_value, 0) - 0.01)
            OR (coalesce(s.total_installments, 0) > 0 AND coalesce(s.paid_installments, 0) >= coalesce(s.total_installments, 0))
            OR (
              jsonb_typeof(s.installments) = 'array'
              AND jsonb_array_length(s.installments) > 0
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(s.installments) inst
                WHERE coalesce((inst->>'paid')::boolean, false) = false
              )
            )
          ) THEN v_company_id
        ELSE s.company_id
      END,
      iam_control_aluno_id = coalesce(v_iam_id, s.iam_control_aluno_id),
      iam_control_synced_at = now(),
      iam_control_contrato_id = coalesce(v_contrato_id, s.iam_control_contrato_id),
      iam_control_status_origem = coalesce(v_status, s.iam_control_status_origem),
      -- Visão do GC: aprovado no GC continua CONCILIADO mesmo que o IAM ainda
      -- diga PARA_CONCILIAR / PENDENTE_*.
      iam_control_contrato_status = CASE
        WHEN v_aguarda_gc AND v_mantem_aprov THEN 'CONCILIADO'
        ELSE coalesce(v_status, s.iam_control_contrato_status)
      END,
      iam_control_pendente_tipo = v_pend_tipo,
      iam_control_pendente_link = v_pend_link,
      iam_gc_conciliado_at = CASE WHEN v_reabre THEN NULL ELSE s.iam_gc_conciliado_at END,
      name = v_nome,
      email = coalesce(nullif(v_email, ''), s.email),
      whatsapp = coalesce(nullif(v_whatsapp, ''), s.whatsapp),
      cpf = coalesce(nullif(v_cpf, ''), s.cpf),
      address = coalesce(nullif(v_end->>'logradouro', ''), s.address),
      numero = coalesce(nullif(v_end->>'numero', ''), s.numero),
      cidade = coalesce(nullif(v_end->>'cidade', ''), s.cidade),
      estado = coalesce(nullif(v_end->>'estado', ''), s.estado),
      cep = coalesce(nullif(v_end->>'cep', ''), s.cep),
      product = v_produto,
      enrollment_date = coalesce(nullif(v_data_matric, ''), s.enrollment_date),
      data_treinamento_origem = coalesce(nullif(v_data_matric, ''), s.data_treinamento_origem),
      sale_value         = CASE WHEN v_preserva_fin THEN s.sale_value         ELSE v_fin.sale_value END,
      down_payment       = CASE WHEN v_preserva_fin THEN s.down_payment       ELSE v_fin.down_payment END,
      total_installments = CASE WHEN v_preserva_fin THEN s.total_installments ELSE v_fin.total_installments END,
      installment_value  = CASE WHEN v_preserva_fin THEN s.installment_value  ELSE v_fin.installment_value END,
      -- Estrutura das parcelas vem do IAM, mas baixa registrada no GC
      -- (ex.: conciliação Kamino) nunca é desfeita: parcela paga no GC
      -- continua paga, casada pelo número, com paidValue e paidMarkedAt.
      installments = CASE WHEN v_preserva_fin THEN s.installments ELSE (
        SELECT coalesce(jsonb_agg(
          CASE
            WHEN gcp.n IS NOT NULL AND NOT coalesce((fin.i->>'paid')::boolean, false)
              THEN fin.i
                   || jsonb_build_object('paid', true, 'paidDate', coalesce(gcp.paid_date, fin.i->>'paidDate'))
                   || coalesce(gcp.rastro, '{}'::jsonb)
            ELSE fin.i
          END
          ORDER BY (fin.i->>'number')::int), '[]'::jsonb)
        FROM jsonb_array_elements(coalesce(v_fin.installments, '[]'::jsonb)) AS fin(i)
        LEFT JOIN (
          SELECT (gi->>'number')::int AS n,
                 max(gi->>'paidDate') AS paid_date,
                 jsonb_strip_nulls(jsonb_build_object(
                   'paidValue',    to_jsonb(max(nullif(gi->>'paidValue', '')::numeric)),
                   'paidMarkedAt', to_jsonb(max(nullif(gi->>'paidMarkedAt', '')))
                 )) AS rastro
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.installments) = 'array' THEN s.installments ELSE '[]'::jsonb END) gi
          WHERE coalesce((gi->>'paid')::boolean, false)
          GROUP BY 1
        ) gcp ON gcp.n = (fin.i->>'number')::int
      ) END,
      paid_installments = CASE WHEN v_preserva_fin THEN s.paid_installments ELSE (
        SELECT count(*)::int
        FROM jsonb_array_elements(coalesce(v_fin.installments, '[]'::jsonb)) AS fin(i)
        WHERE coalesce((fin.i->>'paid')::boolean, false)
          OR (fin.i->>'number')::int IN (
            SELECT (gi->>'number')::int
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.installments) = 'array' THEN s.installments ELSE '[]'::jsonb END) gi
            WHERE coalesce((gi->>'paid')::boolean, false)
          )
      ) END
    WHERE s.id = v_student_id;
    v_acao := 'atualizado';
  ELSE
    -- Proteção 2 na criação: ficha Kamino não é criada a partir do IAM.
    IF v_kamino THEN
      RETURN jsonb_build_object(
        'acao', 'ignorado',
        'motivo', 'ficha Kamino existente — financeiro não vem do IAM',
        'iam_control_aluno_id', v_iam_id,
        'produto', v_produto
      );
    END IF;

    INSERT INTO public.students (
      company_id, iam_control_aluno_id, iam_control_synced_at,
      iam_control_contrato_id, iam_control_contrato_status, iam_control_status_origem,
      iam_control_pendente_tipo, iam_control_pendente_link,
      name, email, whatsapp, cpf, address, numero, cidade, estado, cep,
      product, enrollment_date, data_treinamento_origem,
      sale_value, down_payment, total_installments, installment_value,
      installments, paid_installments
    ) VALUES (
      v_company_id, v_iam_id, now(), v_contrato_id, v_status, v_status, v_pend_tipo, v_pend_link,
      v_nome, nullif(v_email, ''), v_whatsapp, v_cpf,
      coalesce(v_end->>'logradouro', ''), coalesce(v_end->>'numero', ''), coalesce(v_end->>'cidade', ''), coalesce(v_end->>'estado', ''), coalesce(v_end->>'cep', ''),
      v_produto, nullif(v_data_matric, ''), nullif(v_data_matric, ''),
      v_fin.sale_value, v_fin.down_payment, v_fin.total_installments, v_fin.installment_value,
      v_fin.installments, v_fin.paid_installments
    ) RETURNING id INTO v_student_id;
    v_acao := 'criado';
    v_matched_by := 'novo';
  END IF;

  RETURN jsonb_build_object(
    'acao', v_acao,
    'student_id', v_student_id,
    'iam_control_aluno_id', v_iam_id,
    'produto', v_produto,
    'casado_por', v_matched_by,
    'status_conciliacao', v_status,
    'pendente_tipo', v_pend_tipo,
    'kamino_protegido', v_kamino,
    'financeiro_preservado', v_preserva_fin,
    'aprovacao_gc_mantida', v_mantem_aprov,
    'aprovacao_gc_reaberta', v_reabre
  );
END;
$function$;

COMMENT ON FUNCTION public.iam_control_upsert_one_contract(jsonb, text, jsonb, text) IS
  'Upsert IAM→GC. Aprovação GC (iam_gc_conciliado_at) só reabre quando o IAM muda de status não pendente para pendente; status pendente repetido não desfaz a aprovação.';

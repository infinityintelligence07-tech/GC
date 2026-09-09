-- Pull do IAM Control desfazia a baixa de contrato cancelado (09/09/2026).
--
-- PAULO ROBERTO BARBOSA PAIVA (Confronto, IAM Control, contrato nunca aprovado
-- na fila IAM > GC): a conciliação do cancelamento às 15:08 zerou as parcelas e
-- marcou a ficha como Cancelado. Às 15:25 o pull periódico do IAM rodou
-- `iam_control_upsert_one_contract`: como `iam_gc_conciliado_at` era NULL,
-- `v_preserva_fin` ficou falso e o financeiro foi reescrito com a estrutura do
-- IAM (1x R$ 7.662,50 em aberto). Em seguida o front, vendo contrato IAM sem
-- aprovação GC, forçou status "Pendente". Resultado: a dashboard não mexeu e o
-- aluno voltou a aparecer como pendente na carteira.
--
-- Correções:
--   1. iam_control_upsert_one_contract(): ficha com status_cancelamento
--      'cancelado' (ou status 'Cancelado') preserva o financeiro do GC, como já
--      acontece com ficha Kamino e com contrato aprovado no GC.
--   2. cancellation_case_finaliza_aluno(): ao concluir o cancelamento, fecha o
--      item IAM > GC pendente da ficha (contrato cancelado não precisa de
--      aprovação) — a migração de 04/09 fazia isso só como reparo pontual.
--   3. Reparo: reaplica a baixa das fichas canceladas que foram sobrescritas
--      (Paulo) e fecha os itens IAM > GC pendentes dessas fichas.

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
  v_cancelado    boolean := false;
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
           upper(nullif(btrim(coalesce(s2.iam_control_status_origem, '')), '')),
           (coalesce(s2.status_cancelamento, 'nenhum') = 'cancelado' OR s2.status = 'Cancelado')
      INTO v_sem_parcelas, v_gc_aprovado_em, v_status_origem_ant, v_cancelado
      FROM public.students s2
     WHERE s2.id = v_student_id;

    -- Aprovação GC só reabre quando o IAM MUDA para um status pendente vindo
    -- de um status que não aguardava GC (ex.: CONCILIADO → PENDENTE_PIX).
    -- Origem desconhecida (NULL) nunca reabre: é a 1ª passada após o deploy.
    -- Contrato cancelado no GC nunca reabre aprovação.
    v_reabre := v_aguarda_gc
      AND NOT v_cancelado
      AND v_gc_aprovado_em IS NOT NULL
      AND v_status_origem_ant IS NOT NULL
      AND v_status_origem_ant IS DISTINCT FROM v_status
      AND NOT (v_status_origem_ant IN ('PENDENTE', 'PENDENTE_LINK', 'PENDENTE_PIX', 'PARA_CONCILIAR'));
    v_mantem_aprov := v_gc_aprovado_em IS NOT NULL AND NOT v_reabre;

    -- Proteção 3: ficha Kamino nunca recebe financeiro do IAM.
    -- Proteção 4: contrato CANCELADO no GC (conciliação de cancelamento
    -- concluída) mantém a baixa feita no GC — o IAM não reabre parcelas.
    -- Antes da aprovação GC (iam_gc_conciliado_at NULL) a estrutura financeira
    -- vem do IAM a cada pull — é assim que cartão 3x/12x vira quitado à vista
    -- na fila. Depois da aprovação, o cronograma do GC é preservado; só uma
    -- reabertura legítima (v_reabre) com status pendente volta a reescrever.
    v_preserva_fin := v_kamino
      OR v_cancelado
      OR (NOT v_sem_parcelas AND v_gc_aprovado_em IS NOT NULL AND (v_mantem_aprov OR NOT v_is_pendente));

    UPDATE public.students s SET
      company_id = CASE
        WHEN v_cancelado THEN s.company_id
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
    'contrato_cancelado', v_cancelado,
    'financeiro_preservado', v_preserva_fin,
    'aprovacao_gc_mantida', v_mantem_aprov,
    'aprovacao_gc_reaberta', v_reabre
  );
END;
$function$;

-- ─── Ao concluir o cancelamento, fecha o item IAM > GC pendente da ficha ─────
CREATE OR REPLACE FUNCTION public.cancellation_case_finaliza_aluno(p_case_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case public.cancellation_cases%ROWTYPE;
  v_stud public.students%ROWTYPE;
  v_inst jsonb;
  v_paid int;
  v_total int;
  v_needs_apply boolean;
  v_hist jsonb;
  v_por_nome boolean := false;
BEGIN
  SELECT * INTO v_case FROM public.cancellation_cases WHERE id = p_case_id;
  IF NOT FOUND OR v_case.stage IS DISTINCT FROM 'Cancelado' THEN
    RETURN;
  END IF;

  SELECT * INTO v_stud
  FROM public.students s
  WHERE s.company_id = v_case.company_id
    AND (s.id = v_case.student_id OR (v_case.student_id IS NULL AND s.cancellation_case_id = v_case.id))
  ORDER BY (s.id = v_case.student_id) DESC
  LIMIT 1;

  -- Caso sem ficha vinculada (importação externa): casa por nome normalizado,
  -- somente quando existe UMA ficha com esse nome na empresa e ela não está
  -- presa a outro caso nem já cancelada.
  IF NOT FOUND AND v_case.student_id IS NULL AND trim(coalesce(v_case.student_name, '')) <> '' THEN
    SELECT s.* INTO v_stud
    FROM public.students s
    WHERE s.company_id = v_case.company_id
      AND public.gc_nome_norm(s.name) = public.gc_nome_norm(v_case.student_name)
      AND (s.cancellation_case_id IS NULL OR s.cancellation_case_id = v_case.id)
      AND COALESCE(s.status_cancelamento, 'nenhum') <> 'cancelado'
      AND (
        SELECT count(*) FROM public.students s2
        WHERE s2.company_id = v_case.company_id
          AND public.gc_nome_norm(s2.name) = public.gc_nome_norm(v_case.student_name)
      ) = 1
    LIMIT 1;
    IF FOUND THEN
      v_por_nome := true;
    END IF;
  END IF;

  IF v_stud.id IS NULL THEN
    RETURN;
  END IF;

  -- Só mexe em ficha que está no fluxo de cancelamento (ou que já foi
  -- cancelada mas ficou com a baixa pendente). Ficha 'nenhum' só entra quando
  -- nunca esteve vinculada a outro caso — ou seja, o vínculo com este caso
  -- simplesmente não chegou a ser gravado. 'revertido' fica como está.
  IF COALESCE(v_stud.status_cancelamento, 'nenhum') NOT IN
     ('solicitado', 'aguardando_conciliacao', 'pagamento_multa_pendente', 'em_tratamento', 'juridico', 'cancelado')
     AND NOT (
       COALESCE(v_stud.status_cancelamento, 'nenhum') = 'nenhum'
       AND (v_stud.cancellation_case_id IS NULL OR v_stud.cancellation_case_id = v_case.id)
     ) THEN
    RETURN;
  END IF;

  IF v_por_nome THEN
    UPDATE public.cancellation_cases SET student_id = v_stud.id WHERE id = v_case.id AND student_id IS NULL;
  END IF;

  -- Contrato cancelado não precisa de aprovação IAM > GC: fecha o item pendente.
  UPDATE public.conciliacao_items ci
     SET status = 'conciliado',
         conciliado_at = now(),
         conciliado_por_nome = 'Sistema',
         conciliado_nota = 'Fechado automaticamente: contrato cancelado (caso de cancelamento concluído).'
   WHERE ci.student_id = v_stud.id
     AND ci.tipo = 'iam_pendente'
     AND ci.status IN ('pendente', 'aprovado');

  -- Baixa pendente = ainda existe parcela em aberto que não é a multa.
  v_needs_apply := jsonb_typeof(v_case.cancellation_reviewed_installments) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_stud.installments, '[]'::jsonb)) i
      WHERE NOT COALESCE((i->>'paid')::boolean, false)
        AND NOT (COALESCE(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')
    );

  -- Já finalizado e sem baixa pendente: nada a fazer (idempotente).
  IF COALESCE(v_stud.status_cancelamento, 'nenhum') = 'cancelado'
     AND v_stud.status = 'Cancelado'
     AND NOT v_needs_apply THEN
    RETURN;
  END IF;

  IF v_needs_apply THEN
    v_inst := v_case.cancellation_reviewed_installments;
    SELECT count(*) FILTER (WHERE COALESCE((i->>'paid')::boolean, false)), count(*)
      INTO v_paid, v_total
    FROM jsonb_array_elements(v_inst) i;
  END IF;

  v_hist := jsonb_build_object(
    'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Conciliação de cancelamento concluída. Status completo: Cancelado.' ||
            CASE WHEN v_needs_apply THEN ' Parcelas em aberto baixadas da carteira.' ELSE '' END ||
            CASE WHEN v_por_nome THEN ' Caso importado vinculado à ficha pelo nome.' ELSE '' END ||
            ' (aplicado pelo banco a partir do caso finalizado)'
  );

  UPDATE public.students s
     SET status = 'Cancelado',
         status_mode = 'Manual',
         status_cancelamento = 'cancelado',
         cancellation_case_id = COALESCE(s.cancellation_case_id, v_case.id),
         installments = CASE WHEN v_needs_apply THEN v_inst ELSE s.installments END,
         paid_installments = CASE WHEN v_needs_apply THEN v_paid ELSE s.paid_installments END,
         total_installments = CASE WHEN v_needs_apply THEN v_total ELSE s.total_installments END,
         history = COALESCE(s.history, '[]'::jsonb) || jsonb_build_array(v_hist)
   WHERE s.id = v_stud.id;
END;
$$;

-- ─── Reparo: fichas canceladas que o pull do IAM reabriu (Paulo Roberto) ─────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.cancellation_case_id AS case_id
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id AND co.active
    JOIN public.cancellation_cases cc ON cc.id = s.cancellation_case_id AND cc.stage = 'Cancelado'
    WHERE COALESCE(s.status_cancelamento, 'nenhum') = 'cancelado'
      AND (
        s.status <> 'Cancelado'
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(s.installments, '[]'::jsonb)) i
          WHERE NOT COALESCE((i->>'paid')::boolean, false)
            AND NOT (COALESCE(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')
        )
      )
  LOOP
    PERFORM public.cancellation_case_finaliza_aluno(r.case_id);
  END LOOP;
END $$;

-- Itens IAM > GC ainda abertos de fichas já canceladas (qualquer origem).
UPDATE public.conciliacao_items ci
   SET status = 'conciliado',
       conciliado_at = now(),
       conciliado_por_nome = 'Sistema',
       conciliado_nota = 'Fechado automaticamente: contrato cancelado (caso de cancelamento concluído).'
  FROM public.students s
  JOIN public.companies co ON co.id = s.company_id AND co.active
 WHERE ci.student_id = s.id
   AND ci.tipo = 'iam_pendente'
   AND ci.status IN ('pendente', 'aprovado')
   AND COALESCE(s.status_cancelamento, 'nenhum') = 'cancelado';

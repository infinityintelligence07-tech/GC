-- Sync IAM: aluno bônus que COMPRA treinamento deixa de ser bônus e entra no GC.
--
-- Regra do financeiro (10/09/2026): bônus é quem só tem brinde. No momento em
-- que o aluno compra qualquer treinamento (contrato_id + valor_total > 0 no
-- IAM), ele entra na esteira do GC como qualquer outro cliente — a venda sobe,
-- o brinde continua fora.
--
-- Isso fecha os dois caminhos que ainda descartavam o aluno inteiro:
--   1) origem_aluno = ALUNO_BONUS na matrícula (já tratado em 20260910120000);
--   2) NOME marcado como bônus — réplica de inscrição tipo "NOME (bônus 1)"
--      (iam_name_is_bonus). Antes o upsert parava aqui sem olhar contratos.
--
-- Para o caso 2, a ficha no GC é criada com o nome limpo (sem o sufixo
-- "(bônus N)"), para não nascer aluno chamado "FULANO (bônus 1)".

CREATE OR REPLACE FUNCTION public.iam_nome_sem_marca_bonus(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT CASE
           WHEN btrim(regexp_replace(coalesce(p_nome, ''), '\s*[\(\[\-–]?\s*b[oôó]nus\y[^\)\]]*[\)\]]?\s*$', '', 'i')) = ''
           THEN btrim(coalesce(p_nome, ''))
           ELSE btrim(regexp_replace(coalesce(p_nome, ''), '\s*[\(\[\-–]?\s*b[oôó]nus\y[^\)\]]*[\)\]]?\s*$', '', 'i'))
         END;
$$;

COMMENT ON FUNCTION public.iam_nome_sem_marca_bonus(text) IS
  'Remove sufixo de réplica bônus do nome vindo do IAM ("NOME (bônus 1)" → "NOME"). Devolve o original se sobrar vazio.';

CREATE OR REPLACE FUNCTION public.iam_control_upsert_student(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_iam_id       bigint  := nullif(p->>'iam_control_aluno_id', '')::bigint;
  v_nome         text    := btrim(coalesce(p->>'nome', ''));
  v_nome_bonus   boolean := false;
  v_payload      jsonb   := p;
  v_row          record;
  v_result       jsonb;
  v_criados      int := 0;
  v_atualizados  int := 0;
  v_ambiguos     int := 0;
  v_ignorados    int := 0;
  v_detalhes     jsonb := '[]'::jsonb;
  v_tem_venda    boolean := false;
  v_tem_elegivel boolean := false;
BEGIN
  IF v_nome = '' THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'nome vazio', 'iam_control_aluno_id', v_iam_id);
  END IF;

  v_nome_bonus := public.iam_name_is_bonus(v_nome);

  -- Alguma VENDA no payload (contrato_id + valor_total > 0)?
  SELECT exists (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    CROSS JOIN jsonb_array_elements(coalesce(m->'treinamentos', '[]'::jsonb)) t
    WHERE public.iam_treinamento_vendido(t)
  ) INTO v_tem_venda;

  -- Nome bônus sem nenhuma compra: continua fora do GC.
  IF v_nome_bonus AND NOT v_tem_venda THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'aluno bonus',
      'iam_control_aluno_id', v_iam_id
    );
  END IF;

  -- Nome bônus que comprou: entra com o nome limpo.
  IF v_nome_bonus THEN
    v_nome := public.iam_nome_sem_marca_bonus(v_nome);
    v_payload := jsonb_set(p, '{nome}', to_jsonb(v_nome), true);
  END IF;

  -- Elegível: treinamento de matrícula não-bônus (aluno não-bônus), OU venda.
  SELECT exists (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    CROSS JOIN jsonb_array_elements(coalesce(m->'treinamentos', '[]'::jsonb)) t
    WHERE (NOT v_nome_bonus AND coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS')
       OR public.iam_treinamento_vendido(t)
  ) INTO v_tem_elegivel;

  IF jsonb_array_length(coalesce(p->'matriculas', '[]'::jsonb)) > 0
     AND NOT v_tem_elegivel THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'somente matriculas bonus',
      'iam_control_aluno_id', v_iam_id
    );
  END IF;

  IF public.iam_payload_has_only_excluded_treinamentos(p) THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'treinamento fora do GC (IPR/Imersão)',
      'iam_control_aluno_id', v_iam_id
    );
  END IF;

  FOR v_row IN
    SELECT
      public.iam_treinamento_label(t) AS produto,
      t AS treinamento,
      -- Data do CONTRATO: venda do treinamento; data da matrícula só se faltar.
      coalesce(
        nullif(left(t->>'data_venda', 10), ''),
        nullif(left(m->>'data_matricula', 10), ''),
        ''
      ) AS data_matricula
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    CROSS JOIN jsonb_array_elements(coalesce(m->'treinamentos', '[]'::jsonb)) t
    WHERE (NOT v_nome_bonus AND coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS')
       OR public.iam_treinamento_vendido(t)
  LOOP
    IF v_row.produto = '' OR public.product_excluded_from_gc(v_row.produto) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    v_result := public.iam_control_upsert_one_contract(
      v_payload,
      v_row.produto,
      v_row.treinamento,
      v_row.data_matricula
    );

    v_detalhes := v_detalhes || jsonb_build_array(v_result);

    CASE v_result->>'acao'
      WHEN 'criado' THEN v_criados := v_criados + 1;
      WHEN 'atualizado' THEN v_atualizados := v_atualizados + 1;
      WHEN 'ambiguo' THEN v_ambiguos := v_ambiguos + 1;
      ELSE v_ignorados := v_ignorados + 1;
    END CASE;
  END LOOP;

  IF v_criados + v_atualizados + v_ambiguos = 0 THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'nenhum treinamento elegível',
      'iam_control_aluno_id', v_iam_id,
      'detalhes', v_detalhes
    );
  END IF;

  IF v_criados + v_atualizados + v_ambiguos = 1 THEN
    RETURN v_result;
  END IF;

  RETURN jsonb_build_object(
    'acao', 'multiplo',
    'iam_control_aluno_id', v_iam_id,
    'criados', v_criados,
    'atualizados', v_atualizados,
    'ambiguo', v_ambiguos,
    'ignorados', v_ignorados,
    'detalhes', v_detalhes
  );
END;
$function$;

-- Data do contrato (enrollment_date / data_treinamento_origem) na sync IAM.
--
-- Desde 20260823030000 o GC tem uma ficha por treinamento/contrato, mas a data
-- passada ao upsert continuava sendo `matriculas[].data_matricula` — a data em
-- que o aluno foi cadastrado no IAM (sobra da época de "uma ficha por aluno").
-- Aluno que já tinha matrícula antiga e comprou um contrato novo (ex.: evento de
-- agosto) ficava com "contrato assinado em" na data da matrícula velha (01/06),
-- enquanto as parcelas (data_venda + n meses) saíam corretas.
--
-- Agora a data do contrato é `treinamentos[].data_venda` (a venda daquele
-- contrato) e `data_matricula` fica só como fallback. As parcelas já usavam
-- data_venda, então nada muda no financeiro.
--
-- Fichas já sincronizadas com a data errada: corrigidas por
-- scripts/gc-reparo-iam-data-contrato.mjs (infere data_venda pela 1ª parcela).

CREATE OR REPLACE FUNCTION public.iam_control_upsert_student(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_iam_id       bigint  := nullif(p->>'iam_control_aluno_id', '')::bigint;
  v_nome         text    := btrim(coalesce(p->>'nome', ''));
  v_row          record;
  v_result       jsonb;
  v_criados      int := 0;
  v_atualizados  int := 0;
  v_ambiguos     int := 0;
  v_ignorados    int := 0;
  v_detalhes     jsonb := '[]'::jsonb;
  v_tem_matricula_nao_bonus boolean := false;
BEGIN
  IF v_nome = '' THEN
    RETURN jsonb_build_object('acao', 'ignorado', 'motivo', 'nome vazio', 'iam_control_aluno_id', v_iam_id);
  END IF;

  IF public.iam_name_is_bonus(v_nome) THEN
    RETURN jsonb_build_object(
      'acao', 'ignorado',
      'motivo', 'aluno bonus',
      'iam_control_aluno_id', v_iam_id
    );
  END IF;

  SELECT exists (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    WHERE coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
  ) INTO v_tem_matricula_nao_bonus;

  IF jsonb_array_length(coalesce(p->'matriculas', '[]'::jsonb)) > 0
     AND NOT v_tem_matricula_nao_bonus THEN
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
    WHERE coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
  LOOP
    IF v_row.produto = '' OR public.product_excluded_from_gc(v_row.produto) THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    v_result := public.iam_control_upsert_one_contract(
      p,
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

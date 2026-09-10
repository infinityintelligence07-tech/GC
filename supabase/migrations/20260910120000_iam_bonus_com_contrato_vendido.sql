-- Sync IAM: matrícula "bônus" que contém contrato VENDIDO passa a subir.
--
-- Desde 20260821240000 a sync ignora matrículas com origem_aluno = ALUNO_BONUS
-- (aluno que entrou de brinde numa turma). A regra descartava a matrícula
-- inteira — inclusive os treinamentos vendidos dentro dela. Caso real: Igor da
-- Silva Andrade entrou como bônus na turma PNL AM 22 e, no evento de 25/08,
-- comprou dois Leader Skills (R$ 5.122 em 12x e R$ 2.305 à vista), ambos com
-- contrato_id e status PARA_CONCILIAR no IAM. Como a única matrícula dele é
-- bônus, o upsert devolvia "somente matriculas bonus" e nada chegava ao GC.
--
-- Agora o filtro é por TREINAMENTO: dentro de matrícula bônus, sobe o que tem
-- contrato_id e valor_total > 0 (é venda); o brinde em si (sem contrato, valor
-- zero) continua fora. Matrícula não-bônus não muda. Aluno cujo NOME marca
-- bônus (iam_name_is_bonus) continua ignorado.
--
-- Backfill: rodar a edge function iam-control-pull-clientes em modo completo
-- (scripts/gc-iam-pull-completo.mjs) para os clientes já descartados voltarem.

CREATE OR REPLACE FUNCTION public.iam_treinamento_vendido(t jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT nullif(btrim(coalesce(t->>'contrato_id', '')), '') IS NOT NULL
     AND coalesce(nullif(t->>'valor_total', '')::numeric, 0) > 0;
$$;

COMMENT ON FUNCTION public.iam_treinamento_vendido(jsonb) IS
  'Treinamento do payload IAM é uma venda (tem contrato_id e valor_total > 0) — sobe ao GC mesmo dentro de matrícula ALUNO_BONUS.';

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
  v_tem_treinamento_elegivel boolean := false;
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

  -- Elegível: treinamento de matrícula não-bônus, OU venda (contrato_id +
  -- valor) dentro de matrícula bônus.
  SELECT exists (
    SELECT 1
    FROM jsonb_array_elements(coalesce(p->'matriculas', '[]'::jsonb)) m
    CROSS JOIN jsonb_array_elements(coalesce(m->'treinamentos', '[]'::jsonb)) t
    WHERE coalesce(m->>'origem_aluno', '') <> 'ALUNO_BONUS'
       OR public.iam_treinamento_vendido(t)
  ) INTO v_tem_treinamento_elegivel;

  IF jsonb_array_length(coalesce(p->'matriculas', '[]'::jsonb)) > 0
     AND NOT v_tem_treinamento_elegivel THEN
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
       OR public.iam_treinamento_vendido(t)
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

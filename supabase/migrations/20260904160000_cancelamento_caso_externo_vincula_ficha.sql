-- Caso importado manualmente ("Importar Aluno Cancelamento — PIX/Cartão")
-- para um aluno que JÁ tinha ficha na base (04/09/2026).
--
-- MARINA BRANDÃO PEREIRA (Confronto, à vista R$ 11.662,50, IAM Control):
-- o caso foi criado pela importação externa sem student_id e com o nome
-- digitado com acento ("Brandão"), enquanto a ficha está "BRANDAO". O casamento
-- por nome do front compara texto cru, então nunca vinculou. Ao concluir o
-- cancelamento, o trigger não achou ficha, a aluna seguiu "Pendente" na
-- carteira (R$ 11.662,50 no card Pago como entrada) e a lista mostrou um
-- espelho "Somente visualização / Cancelado" ao lado da ficha real.
--
-- Correções:
--   1. gc_nome_norm(): normalização de nome sem acento/caixa/espaços duplos.
--   2. cancellation_case_finaliza_aluno(): quando o caso não tem student_id,
--      resolve a ficha por nome normalizado (apenas se houver UMA ficha com
--      esse nome na empresa) e persiste o vínculo nos dois lados. Ficha com
--      status_cancelamento 'nenhum' passa a ser finalizada quando ela nunca
--      esteve vinculada a outro caso (era exatamente o cenário da Marina).
--   3. Reparo: casos externos já finalizados com ficha correspondente
--      (Marina, Marcia de Oliveira Souza) + fecha o item IAM > GC pendente
--      dessas fichas, já que contrato cancelado não precisa de aprovação.

CREATE OR REPLACE FUNCTION public.gc_nome_norm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
           lower(translate(coalesce(p, ''),
             'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
             'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
           '\s+', ' ', 'g')
$$;

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

-- Reparo: casos externos já em 'Cancelado' (empresas ativas), sem student_id,
-- cuja ficha existe na base com o mesmo nome normalizado.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cc.id
    FROM public.cancellation_cases cc
    JOIN public.companies co ON co.id = cc.company_id AND co.active
    WHERE cc.stage = 'Cancelado'
      AND cc.student_id IS NULL
      AND NOT COALESCE(cc.is_mirror, false)
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.company_id = cc.company_id
          AND public.gc_nome_norm(s.name) = public.gc_nome_norm(cc.student_name)
      )
    ORDER BY cc.updated_at
  LOOP
    PERFORM public.cancellation_case_finaliza_aluno(r.id);
  END LOOP;
END $$;

-- Ficha cancelada não precisa de aprovação IAM > GC: fecha o item pendente.
WITH alvo AS (
  SELECT ci.id, s.id AS student_id
  FROM public.conciliacao_items ci
  JOIN public.students s ON s.id = ci.student_id
  JOIN public.companies co ON co.id = s.company_id AND co.active
  WHERE ci.tipo = 'iam_pendente'
    AND ci.status IN ('pendente', 'aprovado')
    AND COALESCE(s.status_cancelamento, 'nenhum') = 'cancelado'
)
UPDATE public.conciliacao_items ci
   SET status = 'conciliado',
       conciliado_at = now(),
       conciliado_por_nome = 'Sistema',
       conciliado_nota = 'Fechado automaticamente: contrato cancelado (caso de cancelamento concluído).'
  FROM alvo
 WHERE ci.id = alvo.id;

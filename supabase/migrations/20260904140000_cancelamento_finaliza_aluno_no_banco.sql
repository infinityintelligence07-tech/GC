-- Conclusão de cancelamento atômica no banco (04/09/2026).
--
-- Problema: a conciliação de cancelamento (Fase B em
-- `concluirConciliacaoCancelamento`) grava o caso (stage → Cancelado) e a ficha
-- do aluno em duas requisições separadas do navegador. Em 04/09 a 2ª requisição
-- (aluno) não chegou ao banco: o caso ficou "Cancelado" e a aluna JUNIA VIEIRA
-- continuou "Solicitação Cancelamento" com 10 parcelas em aberto na carteira,
-- e a Dashboard não mudou. O mesmo padrão existe em 2 fichas do arquivo.
--
-- Solução: quando um caso passa para stage 'Cancelado', o próprio banco aplica
-- na ficha do aluno o mesmo estado final que o front aplicaria — idempotente,
-- então a gravação do front (quando chega) não conflita.

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
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Já finalizado: nada a fazer (idempotente).
  IF COALESCE(v_stud.status_cancelamento, 'nenhum') = 'cancelado' AND v_stud.status = 'Cancelado' THEN
    RETURN;
  END IF;

  -- Só mexe em ficha que está no fluxo de cancelamento. Ficha sem vínculo
  -- (status_cancelamento 'nenhum'/'revertido') fica como está — pode ser
  -- legado ou reversão posterior.
  IF COALESCE(v_stud.status_cancelamento, 'nenhum') NOT IN
     ('solicitado', 'aguardando_conciliacao', 'pagamento_multa_pendente', 'em_tratamento', 'juridico') THEN
    RETURN;
  END IF;

  -- Mesma regra do front: as parcelas finais (pagas + multa) só são aplicadas
  -- quando a baixa ainda não aconteceu (aguardando_conciliacao).
  v_needs_apply := v_stud.status_cancelamento = 'aguardando_conciliacao'
                   AND jsonb_typeof(v_case.cancellation_reviewed_installments) = 'array';
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
            ' (aplicado pelo banco a partir do caso finalizado)'
  );

  UPDATE public.students s
     SET status = 'Cancelado',
         status_mode = 'Manual',
         status_cancelamento = 'cancelado',
         installments = CASE WHEN v_needs_apply THEN v_inst ELSE s.installments END,
         paid_installments = CASE WHEN v_needs_apply THEN v_paid ELSE s.paid_installments END,
         total_installments = CASE WHEN v_needs_apply THEN v_total ELSE s.total_installments END,
         history = COALESCE(s.history, '[]'::jsonb) || jsonb_build_array(v_hist)
   WHERE s.id = v_stud.id;
END;
$$;

COMMENT ON FUNCTION public.cancellation_case_finaliza_aluno(uuid) IS
  'Aplica na ficha do aluno o estado final de um caso de cancelamento em stage Cancelado (idempotente). Espelha a Fase B de concluirConciliacaoCancelamento do front.';

CREATE OR REPLACE FUNCTION public.trg_cancellation_case_finaliza_aluno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'Cancelado' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'Cancelado') THEN
    PERFORM public.cancellation_case_finaliza_aluno(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cancellation_cases_finaliza_aluno ON public.cancellation_cases;
CREATE TRIGGER cancellation_cases_finaliza_aluno
  AFTER INSERT OR UPDATE OF stage ON public.cancellation_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cancellation_case_finaliza_aluno();

-- Reparo: casos já em 'Cancelado' cuja ficha ficou presa no fluxo, nas
-- empresas ativas (hoje: JUNIA VIEIRA DE CARVALHO FERREIRA / Confronto).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cc.id
    FROM public.cancellation_cases cc
    JOIN public.students s ON s.id = cc.student_id AND s.company_id = cc.company_id
    JOIN public.companies co ON co.id = cc.company_id AND co.active
    WHERE cc.stage = 'Cancelado'
      AND COALESCE(s.status_cancelamento, 'nenhum') IN
          ('solicitado', 'aguardando_conciliacao', 'pagamento_multa_pendente', 'em_tratamento', 'juridico')
  LOOP
    PERFORM public.cancellation_case_finaliza_aluno(r.id);
  END LOOP;
END $$;

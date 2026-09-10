-- Cancelamento: parcela de multa PAGA não pode dobrar o valor pago do aluno.
--
-- Regra (10/09/2026): a parcela "multa-cancelamento" na ficha representa só o
-- DINHEIRO recebido pela multa. Quando a multa é coberta pela entrada/parcelas
-- já pagas, ela é retida desse valor e não gera parcela; quando o aluno paga um
-- complemento, a parcela vale só o complemento.
--
-- O app já formaliza assim (finalizeCancellation), mas casos formalizados ANTES
-- da correção guardam a parcela dobrada em cancellation_reviewed_installments e
-- só a aplicam na ficha quando a Conciliação aprova — foi o que aconteceu com
-- LUISE FERNANDA (aprovada 10/09 12:27, entrada R$ 1.250 + multa "paga"
-- R$ 1.250). Por isso a garantia fica no banco: todo insert/update de ficha
-- cancelada passa por este trigger.
--
-- Multa contratual de referência: cancellation_cases.cancellation_fine_value do
-- caso vinculado; sem caso, o último item de conciliação de cancelamento
-- (depois.multaCancelamento). Sem referência, não mexe.
--
-- Parcela de multa paga com valor = multa contratual e (entrada + parcelas
-- pagas normais) > 0:
--   complemento = max(0, multa − pago_normal)
--   * complemento ≈ 0 → parcela removida (multa toda retida do que já foi pago)
--   * 0 < complemento < multa → parcela passa a valer o complemento
--   * pago_normal = 0 → nada muda (a parcela é dinheiro de verdade: Dayane,
--     Eduardo Flausino, Ana Beatriz, Juliana Roza)
-- Parcela de multa com valor ≠ multa contratual (já ajustada ao que o aluno
-- pagou — ex.: Ericson R$ 223,22) não é tocada.

CREATE OR REPLACE FUNCTION public.students_cancelamento_multa_nao_dobra_pago()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_multa numeric;
  v_pago_normal numeric;
  v_inst jsonb := '[]'::jsonb;
  v_i jsonb;
  v_valor numeric;
  v_compl numeric;
  v_mudou boolean := false;
  v_removidas numeric := 0;
  v_ajustadas numeric := 0;
  v_texto text;
BEGIN
  IF NOT (coalesce(NEW.status_cancelamento, 'nenhum') = 'cancelado' OR NEW.status = 'Cancelado') THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.installments) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.installments) i
    WHERE coalesce((i->>'paid')::boolean, false) AND (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')
  ) THEN
    RETURN NEW;
  END IF;

  -- Multa contratual de referência.
  IF NEW.cancellation_case_id IS NOT NULL THEN
    SELECT cc.cancellation_fine_value::numeric INTO v_multa
      FROM public.cancellation_cases cc WHERE cc.id = NEW.cancellation_case_id;
  END IF;
  IF v_multa IS NULL OR v_multa <= 0.0049 THEN
    SELECT nullif(ci.depois->>'multaCancelamento', '')::numeric INTO v_multa
      FROM public.conciliacao_items ci
     WHERE ci.student_id = NEW.id AND ci.tipo = 'cancelamento' AND ci.status = 'conciliado'
       AND coalesce((ci.depois->>'espelho_gc')::boolean, false) = false
       AND nullif(ci.depois->>'multaCancelamento', '') IS NOT NULL
     ORDER BY ci.conciliado_at DESC NULLS LAST, ci.created_at DESC
     LIMIT 1;
  END IF;
  IF v_multa IS NULL OR v_multa <= 0.0049 THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(NEW.down_payment, 0)::numeric + coalesce(sum(
           coalesce(nullif(i->>'paidValue', '')::numeric, (i->>'value')::numeric, 0)), 0)
    INTO v_pago_normal
    FROM jsonb_array_elements(NEW.installments) i
   WHERE coalesce((i->>'paid')::boolean, false)
     AND NOT (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento');
  IF v_pago_normal <= 0.0049 THEN
    RETURN NEW;
  END IF;

  v_compl := round(greatest(0, v_multa - v_pago_normal), 2);

  FOR v_i IN SELECT i FROM jsonb_array_elements(NEW.installments) i ORDER BY (i->>'number')::int LOOP
    v_valor := coalesce(nullif(v_i->>'paidValue', '')::numeric, (v_i->>'value')::numeric, 0);
    IF coalesce((v_i->>'paid')::boolean, false)
       AND (coalesce(v_i->'tags', '[]'::jsonb) ? 'multa-cancelamento')
       AND abs(v_valor - v_multa) < 0.01
       AND v_compl < v_valor - 0.0049
    THEN
      v_mudou := true;
      IF v_compl > 0.0049 THEN
        v_ajustadas := v_ajustadas + 1;
        v_inst := v_inst || jsonb_build_array(
          v_i || jsonb_build_object(
            'value', v_compl, 'paidValue', v_compl, 'valorReal', v_compl,
            'observacao', format('Complemento da multa de cancelamento (R$ %s); o restante foi retido do valor já pago.',
                                 replace(to_char(v_multa, 'FM999999990.00'), '.', ','))
          )
        );
      ELSE
        v_removidas := v_removidas + 1;
      END IF;
    ELSE
      v_inst := v_inst || jsonb_build_array(v_i);
    END IF;
  END LOOP;

  IF NOT v_mudou THEN
    RETURN NEW;
  END IF;

  NEW.installments := v_inst;
  SELECT count(*), count(*) FILTER (WHERE coalesce((i->>'paid')::boolean, false))
    INTO NEW.total_installments, NEW.paid_installments
    FROM jsonb_array_elements(v_inst) i;

  v_texto := format(
    'Multa de cancelamento (R$ %s) retida da entrada/parcelas já pagas (R$ %s)%s. A parcela de multa "paga" criada na finalização dobrava o valor pago e foi %s.',
    replace(to_char(v_multa, 'FM999999990.00'), '.', ','),
    replace(to_char(v_pago_normal, 'FM999999990.00'), '.', ','),
    CASE WHEN v_compl > 0.0049 THEN format(' + complemento pago R$ %s', replace(to_char(v_compl, 'FM999999990.00'), '.', ',')) ELSE '' END,
    CASE WHEN v_removidas > 0 THEN 'removida' ELSE 'ajustada para o complemento' END
  );
  NEW.history := coalesce(NEW.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', v_texto
  ));

  -- Mantém o caso coerente para reaberturas/reativações.
  IF TG_OP = 'UPDATE' AND NEW.cancellation_case_id IS NOT NULL THEN
    UPDATE public.cancellation_cases cc
       SET cancellation_reviewed_installments = v_inst
     WHERE cc.id = NEW.cancellation_case_id
       AND jsonb_typeof(cc.cancellation_reviewed_installments) = 'array';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_cancelamento_multa_nao_dobra_pago ON public.students;
CREATE TRIGGER students_cancelamento_multa_nao_dobra_pago
  BEFORE INSERT OR UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.students_cancelamento_multa_nao_dobra_pago();

COMMENT ON FUNCTION public.students_cancelamento_multa_nao_dobra_pago() IS
  'Ficha cancelada: parcela de multa paga coberta pela entrada/parcelas já pagas é removida (ou reduzida ao complemento) para não dobrar o pago.';

-- Backfill: toda ficha cancelada com parcela de multa paga passa pelo trigger.
UPDATE public.students s
   SET updated_at = now()
 WHERE (coalesce(s.status_cancelamento, 'nenhum') = 'cancelado' OR s.status = 'Cancelado')
   AND jsonb_typeof(s.installments) = 'array'
   AND EXISTS (
     SELECT 1 FROM jsonb_array_elements(s.installments) i
     WHERE coalesce((i->>'paid')::boolean, false) AND (coalesce(i->'tags', '[]'::jsonb) ? 'multa-cancelamento')
   );

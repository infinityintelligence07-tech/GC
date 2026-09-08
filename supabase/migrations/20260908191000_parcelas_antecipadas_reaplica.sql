-- Reaplica a marcação de boleto antecipado (mesma regra de 20260908180000).
--
-- Um ajuste financeiro salvo a partir de um rascunho aberto ANTES da marcação
-- sobrescreveu as parcelas do aluno sem a chave `antecipada` (caso FABIANO DUENHAS,
-- 08/09 19:25). O front agora preserva a marca ao aplicar rascunhos
-- (conciliacaoApply.preserveAntecipadaFlags); aqui só recuperamos o que se perdeu.
--
-- Idempotente: só toca parcelas pagas com data de baixa futura ainda sem a marca.

DO $$
DECLARE
  r record;
  v_new jsonb;
  v_nums text;
  v_total_alunos int := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.installments
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id
    WHERE co.active
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(s.installments) i
        WHERE coalesce((i->>'paid')::boolean, false)
          AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
          AND NOT coalesce((i->>'antecipada')::boolean, false)
      )
  LOOP
    SELECT
      jsonb_agg(
        CASE
          WHEN coalesce((i->>'paid')::boolean, false)
           AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
           AND NOT coalesce((i->>'antecipada')::boolean, false)
          THEN i || '{"antecipada": true}'::jsonb
          ELSE i
        END
        ORDER BY ord
      ),
      string_agg(i->>'number', ', ' ORDER BY (i->>'number')::int) FILTER (
        WHERE coalesce((i->>'paid')::boolean, false)
          AND (i->>'paidDate') > to_char(current_date, 'YYYY-MM-DD')
          AND NOT coalesce((i->>'antecipada')::boolean, false)
      )
    INTO v_new, v_nums
    FROM jsonb_array_elements(r.installments) WITH ORDINALITY AS t(i, ord);

    UPDATE public.students
    SET installments = v_new,
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'type', 'Sistema',
          'text', format('Marcação de boleto antecipado restaurada na(s) parcela(s) %s (perdida em ajuste financeiro salvo a partir de rascunho antigo).', v_nums)
        ))
    WHERE id = r.id;

    v_total_alunos := v_total_alunos + 1;
  END LOOP;

  RAISE NOTICE 'Marcação restaurada em % aluno(s).', v_total_alunos;
END $$;

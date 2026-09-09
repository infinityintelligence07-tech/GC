-- Boletos antecipados — Liberty, células rosa/salmão dos meses seguintes.
--
-- Confirmado pelo financeiro em 08/09/2026: as células abaixo da planilha
-- Liberty (rosa F4CCCC / salmão E6B8AF) são antecipação pelo valor integral,
-- igual às células azuis. As parcelas correspondentes estavam em aberto no GC
-- e passam a baixa por antecipação (paid + antecipada), exibidas como
-- "Antecipado" e somadas no card "Boletos Antecipados".
--
--   Antonio Ferreira Lima      — out/2026 — R$ 10.000,00
--   Marcos William Salvador    — nov/2026 — R$  5.727,27
--   Jefferson Ribeiro (JETI)   — dez/2026 — R$  4.000,00
--   Fabiano Duenhas            — out/2026 — R$  3.600,00 (só a parcela de 3.600; a de 18.000 do mesmo mês fica em aberto)
--
-- Idempotente: parcela já baixada não é tocada.

DO $$
DECLARE
  alvo record;
  v_id uuid;
  v_inst jsonb;
  v_pagas int;
  v_num int;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('ANTONIO FERREIRA LIMA%',      '2026-10', 10000.00, 'rosa'),
      ('MARCOS WILLIAM SALVADOR%',    '2026-11',  5727.27, 'rosa'),
      ('JEFFERSON RIBEIRO%',          '2026-12',  4000.00, 'rosa'),
      ('FABIANO DUENHAS%',            '2026-10',  3600.00, 'salmão')
    ) AS t(nome_like, mes, valor, cor)
  LOOP
    SELECT s.id, s.installments INTO v_id, v_inst
      FROM public.students s
      JOIN public.companies co ON co.id = s.company_id
     WHERE co.name = 'Liberty - GC' AND s.name ILIKE alvo.nome_like
     LIMIT 1;
    IF v_id IS NULL THEN
      RAISE NOTICE '% não encontrado — pulado', alvo.nome_like;
      CONTINUE;
    END IF;

    SELECT (i->>'number')::int INTO v_num
      FROM jsonb_array_elements(v_inst) i
     WHERE left(i->>'dueDate', 7) = alvo.mes
       AND abs((i->>'value')::numeric - alvo.valor) < 0.01
       AND NOT coalesce((i->>'paid')::boolean, false)
     ORDER BY (i->>'number')::int
     LIMIT 1;
    IF v_num IS NULL THEN
      RAISE NOTICE '% %: parcela de R$ % em aberto não encontrada — pulado', alvo.nome_like, alvo.mes, alvo.valor;
      CONTINUE;
    END IF;

    SELECT jsonb_agg(
             CASE
               WHEN (i->>'number')::int = v_num
               THEN (i - 'observacao')
                    || jsonb_build_object(
                         'paid', true,
                         'paidDate', i->>'dueDate',
                         'paidValue', alvo.valor,
                         'antecipada', true,
                         'observacao', format('Antecipado por Liberty (planilha: célula %s — antecipação integral)', alvo.cor)
                       )
               ELSE i
             END
             ORDER BY ord
           )
      INTO v_inst
      FROM jsonb_array_elements(v_inst) WITH ORDINALITY AS t(i, ord);

    SELECT count(*) INTO v_pagas FROM jsonb_array_elements(v_inst) i WHERE coalesce((i->>'paid')::boolean, false);

    UPDATE public.students
       SET installments = v_inst,
           paid_installments = v_pagas,
           history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'type', 'Sistema',
             'text', format(
               'Parcela %s (%s, R$ %s) baixada como boleto antecipado — planilha Liberty, célula %s confirmada pelo financeiro em 08/09/2026 como antecipação integral. Exibida como "Antecipado".',
               v_num, alvo.mes, to_char(alvo.valor, 'FM999G999G990D00'), alvo.cor
             )
           )),
           updated_at = now()
     WHERE id = v_id;

    RAISE NOTICE '% — parcela % (% R$ %) marcada como antecipada; % pagas.', alvo.nome_like, v_num, alvo.mes, alvo.valor, v_pagas;
  END LOOP;
END $$;

-- Boleto antecipado — Picasso Gonçalves Rocha (Liberty), setembro/2026.
--
-- Na planilha Liberty a célula de SETEMBRO do Picasso está em ROSA (F4CCCC).
-- Definição do financeiro (08/09/2026): do rosa entra R$ 5.000,00 como
-- antecipação neste mês. A parcela #2 (15/09/2026, R$ 5.000,00) estava em
-- aberto no GC com a observação "Cor fora da legenda" — passa a ser baixa por
-- antecipação (paid + antecipada), igual às células azuis.
--
-- Roxo (Fabiano Duenhas, R$ 3.600 de antecipação em setembro): a parcela #5
-- de 15/09 já está marcada como antecipada no GC — nada a fazer.

DO $$
DECLARE
  v_id uuid;
  v_inst jsonb;
  v_pagas int;
BEGIN
  SELECT s.id, s.installments INTO v_id, v_inst
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id
   WHERE co.name = 'Liberty - GC' AND s.name ILIKE 'PICASSO GON%ROCHA%'
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE 'Picasso não encontrado — nada alterado';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_inst) i
     WHERE (i->>'number')::int = 2 AND i->>'dueDate' = '2026-09-15'
       AND coalesce((i->>'paid')::boolean, false)
  ) THEN
    RAISE NOTICE 'Parcela 2 do Picasso já está baixada — nada alterado';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE
             WHEN (i->>'number')::int = 2 AND i->>'dueDate' = '2026-09-15' AND abs((i->>'value')::numeric - 5000) < 0.01
             THEN (i - 'observacao')
                  || jsonb_build_object(
                       'paid', true,
                       'paidDate', '2026-09-15',
                       'paidValue', 5000,
                       'antecipada', true,
                       'observacao', 'Antecipado por Liberty (planilha: célula rosa — R$ 5.000,00 de antecipação em set/2026)'
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
           'text', 'Parcela 2 (15/09/2026, R$ 5.000,00) baixada como boleto antecipado — planilha Liberty, célula rosa de setembro: R$ 5.000,00 de antecipação (definição do financeiro em 08/09/2026). Exibida como "Antecipado".'
         )),
         updated_at = now()
   WHERE id = v_id;

  RAISE NOTICE 'Picasso: parcela 2 marcada como antecipada (% pagas).', v_pagas;
END $$;

-- IAM - GC: correção da data de pagamento de baixas registradas em 08/09/2026
-- que na verdade foram pagas em agosto. Solicitação do gestor: mover para 28/08/2026.
--
--   • Gilmara Bagnhur da Trindade (Confronto) — parcela 1 (R$ 2.500,00, recebido R$ 2.880,00)
--   • Leticia Maria Chaves (Fundo - Receita (Recompra)) — parcelas 1 e 2 (R$ 470,22 cada)
--
-- Só altera `paidDate`; valor, vencimento e status permanecem. Idempotente.

DO $$
DECLARE
  v_nova_data constant text := '2026-08-28';
  r record;
  v_new jsonb;
  v_alteradas int;
  v_nums text;
BEGIN
  FOR r IN
    SELECT s.id, s.name, s.ac, s.company_id, s.installments
    FROM public.students s
    JOIN public.companies co ON co.id = s.company_id
    WHERE co.name = 'IAM - GC' AND co.active
      AND (
        (s.name ILIKE 'Gilmara Bagnhur da Trindade%' AND s.product = 'Confronto')
        OR (s.name ILIKE 'Leticia Maria Chaves%' AND s.product = 'Fundo - Receita (Recompra)')
      )
  LOOP
    SELECT
      jsonb_agg(
        CASE
          WHEN coalesce((i->>'paid')::boolean, false) AND i->>'paidDate' = '2026-09-08'
          THEN i || jsonb_build_object('paidDate', v_nova_data)
          ELSE i
        END
        ORDER BY ord
      ),
      count(*) FILTER (WHERE coalesce((i->>'paid')::boolean, false) AND i->>'paidDate' = '2026-09-08'),
      string_agg(i->>'number', ', ' ORDER BY (i->>'number')::int)
        FILTER (WHERE coalesce((i->>'paid')::boolean, false) AND i->>'paidDate' = '2026-09-08')
    INTO v_new, v_alteradas, v_nums
    FROM jsonb_array_elements(r.installments) WITH ORDINALITY AS t(i, ord);

    IF coalesce(v_alteradas, 0) = 0 THEN
      RAISE NOTICE '% — nada a alterar (já ajustado).', r.name;
      CONTINUE;
    END IF;

    UPDATE public.students
    SET installments = v_new,
        history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'type', 'Sistema',
          'text', format('Data de pagamento da(s) parcela(s) %s corrigida: 08/09/2026 → 28/08/2026 (pagamento ocorreu em agosto; baixa registrada em setembro). Ajuste solicitado pelo gestor.', v_nums)
        ))
    WHERE id = r.id;

    INSERT INTO public.conciliacao_items
      (tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status,
       conciliado_at, conciliado_por_nome, conciliado_nota, company_id)
    VALUES
      ('parcela_valor', r.id, r.name, r.ac,
       format('Parcela(s) %s — data de pagamento corrigida 08/09/2026 → 28/08/2026', v_nums),
       jsonb_build_object('parcelas', v_nums, 'paidDate', '2026-09-08'),
       jsonb_build_object('parcelas', v_nums, 'paidDate', v_nova_data),
       'Sistema', 'conciliado', now(), 'Sistema',
       'Pagamento recebido em agosto; a baixa havia sido lançada em 08/09. Data movida para 28/08 a pedido do gestor.',
       r.company_id);

    RAISE NOTICE '% — parcela(s) % movida(s) para %.', r.name, v_nums, v_nova_data;
  END LOOP;
END $$;

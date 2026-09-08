-- Baixa manual da recompra de GUILHERME DO COUTO CEMBRANELLI (08/09/2026).
--
-- Ficha "Fundo - Receita (Recompra)" (IAM - GC) estava com 1 parcela em aberto,
-- R$ 785,79, vencimento 10/02/2027. O relatório Sicoob "Títulos por Período"
-- (cedente 1556380, Seu Número 1-01) mostra o título liquidado via compensação:
-- vencimento 10/02/2026, liquidado em 05/02/2026, R$ 785,79 cobrados. O ano do
-- vencimento na importação Kamino estava errado (2027); o título é de 2026.
--
-- Ajustes: parcela paga em 05/02/2026 (valor integral), vencimento corrigido
-- para 10/02/2026, status Pago, histórico e item de conciliação.

DO $$
DECLARE
  v_id uuid := '41eae0b9-abe1-4362-b477-c0b39d1a1f6b';
  v_stud public.students%ROWTYPE;
  v_inst jsonb;
  v_hist jsonb;
BEGIN
  SELECT * INTO v_stud FROM public.students WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE NOTICE 'Ficha da recompra não encontrada';
    RETURN;
  END IF;

  -- Idempotente: se já está paga, não faz nada.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_stud.installments, '[]'::jsonb)) i
    WHERE (i->>'number') = '1' AND COALESCE((i->>'paid')::boolean, false)
  ) THEN
    RAISE NOTICE 'Recompra já baixada';
    RETURN;
  END IF;

  SELECT jsonb_agg(
           CASE WHEN (i->>'number') = '1'
             THEN i || jsonb_build_object(
                    'paid', true,
                    'paidDate', '2026-02-05',
                    'paidValue', 785.79,
                    'dueDate', '2026-02-10'
                  )
             ELSE i
           END
           ORDER BY (i->>'number')::int
         )
    INTO v_inst
  FROM jsonb_array_elements(COALESCE(v_stud.installments, '[]'::jsonb)) i;

  v_hist := jsonb_build_object(
    'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Pagamento',
    'text', 'Parcela 1 (R$ 785,79) baixada manualmente — liquidada via compensação Sicoob em 05/02/2026 '
            || '(relatório Títulos por Período, Seu Número 1-01). Vencimento corrigido de 10/02/2027 para 10/02/2026.'
  );

  UPDATE public.students
     SET installments = v_inst,
         paid_installments = 1,
         status = 'Pago',
         status_mode = 'Automático',
         history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(v_hist)
   WHERE id = v_id;

  INSERT INTO public.conciliacao_items
    (tipo, student_id, student_name, ac, resumo, antes, depois, autor_nome, status,
     conciliado_at, conciliado_por_nome, conciliado_nota, company_id)
  VALUES
    ('pagamento_parcela', v_id, v_stud.name, v_stud.ac,
     'Parcela 1 (venc. 10/02/2026 • R$ 785,79) da recompra baixada — liquidada via compensação Sicoob em 05/02/2026.',
     jsonb_build_object('numero', 1, 'valor', 785.79, 'vencimento', '2027-02-10', 'paid', false),
     jsonb_build_object('numero', 1, 'valor', 785.79, 'vencimento', '2026-02-10', 'paid', true, 'paidDate', '2026-02-05', 'paidValue', 785.79),
     'Sistema', 'conciliado',
     now(), 'Sistema',
     'Comprovante: relatório Sicoob Títulos por Período (cedente 1556380, Seu Número 1-01, Dt. Liquid. 05/02/2026, Vlr. Cobrado 785,79).',
     v_stud.company_id);
END $$;

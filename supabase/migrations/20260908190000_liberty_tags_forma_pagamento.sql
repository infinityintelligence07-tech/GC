-- Liberty - GC: forma de pagamento (coluna "FORMA DE PGTO" da planilha "Liberty e Begin | 2026")
-- como tag do aluno — PIX / BOLETO / CARTÃO.
--
-- Na importação de 04/09 a forma de pagamento ficou só no texto de Detalhes
-- ("Forma de pagamento: BOLETO"). Aqui ela vira tag de aluno para filtrar
-- na Dashboard / carteira do AC (só BOLETO pode ter boleto antecipado).
--
-- Idempotente: tags criadas uma vez por nome; alunos só recebem a tag se ainda não tiverem.

DO $$
DECLARE
  v_company uuid;
  v_tag_pix uuid;
  v_tag_boleto uuid;
  v_tag_cartao uuid;
  v_alunos int;
BEGIN
  SELECT id INTO v_company FROM public.companies WHERE name = 'Liberty - GC' AND active LIMIT 1;
  IF v_company IS NULL THEN
    RAISE NOTICE 'Empresa "Liberty - GC" não encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Tags (scope student), uma por forma
  SELECT id INTO v_tag_pix FROM public.student_tags WHERE company_id = v_company AND scope = 'student' AND upper(name) = 'PIX' LIMIT 1;
  IF v_tag_pix IS NULL THEN
    INSERT INTO public.student_tags (name, color, scope, company_id) VALUES ('PIX', 'cyan', 'student', v_company) RETURNING id INTO v_tag_pix;
  END IF;

  SELECT id INTO v_tag_boleto FROM public.student_tags WHERE company_id = v_company AND scope = 'student' AND upper(name) = 'BOLETO' LIMIT 1;
  IF v_tag_boleto IS NULL THEN
    INSERT INTO public.student_tags (name, color, scope, company_id) VALUES ('BOLETO', 'indigo', 'student', v_company) RETURNING id INTO v_tag_boleto;
  END IF;

  SELECT id INTO v_tag_cartao FROM public.student_tags WHERE company_id = v_company AND scope = 'student' AND upper(name) IN ('CARTÃO', 'CARTAO') LIMIT 1;
  IF v_tag_cartao IS NULL THEN
    INSERT INTO public.student_tags (name, color, scope, company_id) VALUES ('CARTÃO', 'orange', 'student', v_company) RETURNING id INTO v_tag_cartao;
  END IF;

  -- Aplica a tag conforme "Forma de pagamento: X" registrado em Detalhes na importação
  WITH alvo AS (
    SELECT s.id,
           CASE upper(substring(s.detalhes FROM 'Forma de pagamento: ([A-Za-zÇÃçã]+)'))
             WHEN 'PIX' THEN v_tag_pix
             WHEN 'BOLETO' THEN v_tag_boleto
             WHEN 'CARTAO' THEN v_tag_cartao
             WHEN 'CARTÃO' THEN v_tag_cartao
           END AS tag_id
    FROM public.students s
    WHERE s.company_id = v_company
  ),
  upd AS (
    UPDATE public.students s
    SET tags = coalesce(s.tags, '[]'::jsonb) || to_jsonb(a.tag_id::text)
    FROM alvo a
    WHERE a.id = s.id
      AND a.tag_id IS NOT NULL
      AND NOT (coalesce(s.tags, '[]'::jsonb) ? a.tag_id::text)
    RETURNING s.id
  )
  SELECT count(*) INTO v_alunos FROM upd;

  RAISE NOTICE 'Liberty - GC: tags PIX/BOLETO/CARTÃO aplicadas em % aluno(s).', v_alunos;
END $$;

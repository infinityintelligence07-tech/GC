-- Nome canônico de produto: PMR e PNL (08/09/2026).
--
-- O IAM Control manda o treinamento com `nome` por extenso ("Programação
-- Mental para Riqueza e Relacionamento", "Programação Neurolinguística") e a
-- planilha Kamino usa a sigla ("Pmr", "Pnl"). Como toda casagem de ficha é por
-- nome + produto (lower), o mesmo contrato virava DUAS fichas: a do Kamino com
-- o cronograma real e a do IAM com o resumo do contrato (ex.: Jose Israel
-- Vieira do Nascimento — "Pmr" 2.500 + 12×580,83 e "Programação Mental..."
-- 2.500 + 6.970). Também aparecia como se fossem produtos diferentes.
--
-- 1. gc_canonical_product(text): mapeia os apelidos para o nome cadastrado em
--    products (PMR, PNL). Outros produtos passam inalterados (btrim).
-- 2. iam_treinamento_label passa a devolver o nome canônico — a sync IAM casa
--    com a ficha Kamino existente em vez de criar outra.
-- 3. Renomeia as fichas já gravadas (Pmr/Programação Mental… → PMR;
--    Pnl/Programação Neurolinguística → PNL) em todas as empresas.
-- 4. Funde a ficha IAM duplicada do Jose Israel na ficha Kamino (mantém o
--    cronograma do Kamino, herda os identificadores IAM) e apaga a duplicata.

CREATE OR REPLACE FUNCTION public.gc_canonical_product(p_product text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH norm AS (
    SELECT translate(
      lower(btrim(coalesce(p_product, ''))),
      'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
      'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'
    ) AS p
  )
  SELECT CASE
    WHEN p = 'pmr' OR p LIKE 'programacao mental%' THEN 'PMR'
    WHEN p = 'pnl' OR p LIKE 'programacao neurolinguistica%' OR p LIKE 'programacao neuro-linguistica%' THEN 'PNL'
    ELSE btrim(coalesce(p_product, ''))
  END
  FROM norm;
$$;

COMMENT ON FUNCTION public.gc_canonical_product(text) IS
  'Nome canônico do produto no GC: apelidos do IAM/Kamino (Pmr, Programação Mental…, Pnl, Programação Neurolinguística) → PMR / PNL.';

CREATE OR REPLACE FUNCTION public.iam_treinamento_label(p_treinamento jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public.gc_canonical_product(
    coalesce(
      nullif(btrim(p_treinamento->>'nome'), ''),
      nullif(btrim(p_treinamento->>'sigla'), ''),
      ''
    )
  );
$$;

-- 3. Fichas já gravadas. Respeita students_unique_cpf_product_ciclo: se já
--    existe outra ficha do mesmo CPF que cai no mesmo nome canônico, a
--    renomeação violaria o índice único — esse par fica como está (hoje são 2
--    casos no arquivo "Banco de Dados": Michel Leonardo Bridi e Mayra Freitas,
--    "Pnl" × "Programação Neurolinguística") e precisa de análise humana para
--    saber se é o mesmo contrato ou uma recompra.
UPDATE public.students s
   SET product = public.gc_canonical_product(s.product),
       updated_at = now()
 WHERE s.product IS DISTINCT FROM public.gc_canonical_product(s.product)
   AND NOT (
     coalesce(s.cpf_digits, '') <> '' AND length(s.cpf_digits) >= 11
     AND EXISTS (
       SELECT 1 FROM public.students o
        WHERE o.id <> s.id
          AND o.company_id = s.company_id
          AND o.cpf_digits = s.cpf_digits
          AND lower(public.gc_canonical_product(o.product)) = lower(public.gc_canonical_product(s.product))
          AND lower(btrim(coalesce(o.ciclo, ''))) = lower(btrim(coalesce(s.ciclo, '')))
     )
   );

-- Cadastro de produtos: garante PMR/PNL na IAM - GC (já existem) e remove
-- eventuais variantes por extenso.
UPDATE public.products p
   SET name = public.gc_canonical_product(p.name)
 WHERE p.name IS DISTINCT FROM public.gc_canonical_product(p.name)
   AND NOT EXISTS (
     SELECT 1 FROM public.products q
      WHERE q.company_id = p.company_id AND q.id <> p.id
        AND q.name = public.gc_canonical_product(p.name)
   );

-- 4. Jose Israel Vieira do Nascimento (IAM - GC): funde a ficha IAM
--    d842cdf1 ("Programação Mental…", contrato 514) na ficha Kamino c8c19bf2
--    ("PMR", 2.500 + 12×580,83, cronograma real).
DO $$
DECLARE
  v_kamino uuid := 'c8c19bf2-0a85-487f-908a-4b393e5a1fed';
  v_iam    uuid := 'd842cdf1-1851-405e-b2c3-50e971fa5e55';
  v_iam_row public.students%ROWTYPE;
BEGIN
  SELECT * INTO v_iam_row FROM public.students WHERE id = v_iam;
  IF NOT FOUND THEN
    RAISE NOTICE 'Ficha IAM duplicada já removida';
    RETURN;
  END IF;

  -- Apaga a duplicata ANTES de herdar o CPF (índice único CPF + produto).
  -- Sem dependências (conferido): nenhum item de conciliação, caso ou comissão aponta para ela.
  DELETE FROM public.students WHERE id = v_iam;

  UPDATE public.students s
     SET iam_control_aluno_id        = coalesce(s.iam_control_aluno_id, v_iam_row.iam_control_aluno_id),
         iam_control_contrato_id     = coalesce(s.iam_control_contrato_id, v_iam_row.iam_control_contrato_id),
         iam_control_contrato_status = coalesce(s.iam_control_contrato_status, v_iam_row.iam_control_contrato_status),
         iam_control_synced_at       = coalesce(s.iam_control_synced_at, v_iam_row.iam_control_synced_at),
         cpf      = coalesce(nullif(s.cpf, ''), v_iam_row.cpf),
         email    = coalesce(nullif(s.email, ''), v_iam_row.email),
         whatsapp = coalesce(nullif(s.whatsapp, ''), v_iam_row.whatsapp),
         history  = coalesce(s.history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'type', 'Sistema',
           'text', 'Ficha duplicada do IAM Control ("Programação Mental para Riqueza e Relacionamento", contrato '
                   || coalesce(v_iam_row.iam_control_contrato_id, '?') || ', entrada R$ 2.500,00 + 1 parcela de R$ 6.970,00) '
                   || 'fundida nesta ficha PMR — é o mesmo contrato; mantido o cronograma do Kamino. Vínculo IAM herdado.')),
         updated_at = now()
   WHERE s.id = v_kamino;
END $$;

-- PRISCILA DE OLIVEIRA BARBOSA (Confronto) — ficha 9d928918
-- Remove a tag "Tmf" (55db7beb) das parcelas (estava em P7, P8 e P9).
-- A tag não fica na ficha (students.tags), só nas parcelas — por isso não aparecia na edição do aluno.
-- Demais tags das parcelas (Sicoob 2, Antecipação, Boletos - Iam - Sicoob 2) mantidas.

DO $$
DECLARE
  v_id uuid := '9d928918-1d1f-415f-bde0-1f37e4e1fd99';
  v_co uuid := '00000000-0000-0000-0000-0000000a1a11';
  v_tag text := '55db7beb-5999-419d-b829-136f1c35d34a';
BEGIN
  UPDATE public.students s
  SET
    installments = (
      SELECT jsonb_agg(
        CASE
          WHEN e ? 'tags' AND jsonb_typeof(e->'tags') = 'array'
            THEN jsonb_set(e, '{tags}', (e->'tags') - v_tag)
          ELSE e
        END
        ORDER BY ord
      )
      FROM jsonb_array_elements(s.installments) WITH ORDINALITY AS x(e, ord)
    ),
    tags = coalesce(s.tags, '[]'::jsonb) - v_tag,
    history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'type', 'Sistema',
      'text', 'Correção (suporte): tag "Tmf" removida das parcelas P7, P8 e P9.'
    )),
    updated_at = now()
  WHERE s.id = v_id
    AND s.company_id = v_co;
END $$;

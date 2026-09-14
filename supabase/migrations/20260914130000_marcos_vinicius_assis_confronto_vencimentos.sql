-- Marcos Vinícius de Assis — Confronto (IAM - GC), ficha 4904f719
-- Entrada (R$ 3.000) e 10x R$ 950 estão corretas, mas os vencimentos foram
-- cadastrados de 02/2026 a 11/2026. Correto: 04/2026 a 01/2027 (dia 28).
-- Só desloca o dueDate de cada parcela em +2 meses; mantém paid/paidDate/paidMarkedAt.

UPDATE public.students s
SET
  installments = (
    SELECT jsonb_agg(
      i || jsonb_build_object(
        'dueDate',
        to_char(((i->>'dueDate')::date + interval '2 months')::date, 'YYYY-MM-DD')
      )
      ORDER BY (i->>'number')::int
    )
    FROM jsonb_array_elements(s.installments) i
  ),
  history = coalesce(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type', 'Sistema',
    'text', 'Vencimentos corrigidos: as 10 parcelas de R$ 950,00 passam a vencer de 28/04/2026 a 28/01/2027 (antes: 28/02/2026 a 28/11/2026). Entrada, valores e baixas mantidos.'
  )),
  updated_at = now()
WHERE s.id = '4904f719-6d05-475f-8eb9-f25c9cea5c71'
  AND s.company_id = '00000000-0000-0000-0000-0000000a1a11'
  AND s.product = 'Confronto';

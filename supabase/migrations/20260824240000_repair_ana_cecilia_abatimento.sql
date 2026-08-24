-- Repara abatimento de R$ 397 no contrato Missão Governar da Ana Cecília:
-- o histórico foi gravado, mas creditApplied não persistiu na parcela.

UPDATE public.students
SET installments = jsonb_set(
      installments,
      '{1}',
      (installments->1)
        || jsonb_build_object('creditApplied', 397)
        || jsonb_build_object(
          'observacao',
          'Abatimento parcial de R$ 397,00 — cancelamento de Ana Cecília Mascarenhas Silva Pinheiro'
        ),
      false
    ),
    updated_at = now()
WHERE id = '3af8a55b-a206-4f2b-8c0b-5782f150b90b'
  AND jsonb_array_length(installments) >= 2
  AND COALESCE((installments->1->>'creditApplied')::numeric, 0) < 397;

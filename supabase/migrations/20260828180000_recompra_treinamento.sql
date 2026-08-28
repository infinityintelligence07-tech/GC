-- Recompra vira contrato à parte na carteira do AC.
-- A coluna guarda o treinamento ao qual a recompra se refere,
-- selecionado no novo card "Recompras" da aba Conciliação.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS recompra_treinamento text;

COMMENT ON COLUMN public.students.recompra_treinamento IS
  'Treinamento de referência de uma ficha de Recompra (Fundo). NULL = aguardando vínculo na Conciliação.';

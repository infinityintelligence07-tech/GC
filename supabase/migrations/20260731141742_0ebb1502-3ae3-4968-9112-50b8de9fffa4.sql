ALTER TABLE public.cancellation_cases ADD COLUMN IF NOT EXISTS treinamento text;

UPDATE public.cancellation_cases
SET treinamento = 'Missão Governar', quantidade_inscricoes = 2
WHERE id = '2d87c87c-ba72-4274-91fc-ce44a55e5795';
-- Detalhamento por aluno da leitura diária do card "A Vencer / Vencido".
-- payload: [{ "id": uuid, "name": text, "open": numeric }, ...]
-- Permite que a aba Extrato do Card mostre exatamente quem mudou entre duas datas.

ALTER TABLE public.carteira_card_snapshots
  ADD COLUMN IF NOT EXISTS payload JSONB;

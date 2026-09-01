-- Alinha as categorias de lançamento do Extrato do Card ao modelo da planilha
-- de conferência: Pagamento/Juros pagos (−), Entrada valor em aberto (+),
-- Saída/Desconto (−) e Cancelamento (−).

ALTER TABLE public.carteira_extrato_lancamentos
  DROP CONSTRAINT carteira_extrato_lancamentos_tipo_check;

ALTER TABLE public.carteira_extrato_lancamentos
  ADD CONSTRAINT carteira_extrato_lancamentos_tipo_check
  CHECK (tipo IN ('pagamento', 'entrada_aberto', 'saida_desconto', 'cancelamento'));

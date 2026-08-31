-- Extrato do card "A Vencer / Vencido" (Carteira Total do Dashboard).
-- 1. carteira_card_snapshots: uma leitura por dia/empresa do valor exibido no
--    card (gravada automaticamente quando o Dashboard é aberto sem filtros).
-- 2. carteira_extrato_lancamentos: lançamentos manuais de conferência para
--    "bater" a variação entre duas leituras (modelo planilha de conciliação).

CREATE TABLE public.carteira_card_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  snapshot_date DATE NOT NULL,
  -- Última leitura do dia (fechamento) e primeira (abertura)
  a_vencer NUMERIC NOT NULL DEFAULT 0,
  pago NUMERIC NOT NULL DEFAULT 0,
  abertura_a_vencer NUMERIC,
  qtd_alunos INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

ALTER TABLE public.carteira_card_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carteira_card_snapshots_public_all"
ON public.carteira_card_snapshots
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER set_carteira_card_snapshots_updated_at
BEFORE UPDATE ON public.carteira_card_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_carteira_card_snapshots_company_date
ON public.carteira_card_snapshots(company_id, snapshot_date);

CREATE TABLE public.carteira_extrato_lancamentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  data DATE NOT NULL,
  descricao TEXT NOT NULL,
  -- credito = valor ENTROU no card (novos contratos etc.)
  -- debito  = valor SAIU do card (baixas, ajustes, cancelamentos concluídos)
  tipo TEXT NOT NULL CHECK (tipo IN ('credito', 'debito')),
  valor NUMERIC NOT NULL,
  autor_id UUID,
  autor_nome TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.carteira_extrato_lancamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carteira_extrato_lancamentos_public_all"
ON public.carteira_extrato_lancamentos
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER set_carteira_extrato_lancamentos_updated_at
BEFORE UPDATE ON public.carteira_extrato_lancamentos
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_carteira_extrato_lancamentos_company_data
ON public.carteira_extrato_lancamentos(company_id, data);

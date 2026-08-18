-- Permite status 'reprovado' em conciliacao_items (campos já existem)
-- Não há CHECK constraint atual, então só garante via comentário.
COMMENT ON COLUMN public.conciliacao_items.status IS 'pendente | conciliado | reprovado';

-- Tabela notifications já existe; adiciona índice para consultas por ac_id ordenadas por data.
CREATE INDEX IF NOT EXISTS idx_notifications_ac_id_created_at
  ON public.notifications (ac_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);
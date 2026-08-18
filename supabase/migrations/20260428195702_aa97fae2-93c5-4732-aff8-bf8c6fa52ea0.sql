-- Tabela de notificações por AC (item 7)
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Destinatário: assessor de conta (acs.id) OU usuário (app_users.id)
  ac_id UUID,
  user_id UUID,
  -- Tipo da notificação para roteamento de UI
  -- 'venc_hoje' | 'concil_aprovada' | 'concil_reprovada' | 'renda_extra' | 'sistema'
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  -- Dados extras opcionais (ex.: studentId para deep-link, valor, etc.)
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_ac_id ON public.notifications (ac_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Política aberta (mantém o padrão atual do projeto, sem auth integrada)
CREATE POLICY notifications_public_all ON public.notifications
  FOR ALL TO public USING (true) WITH CHECK (true);

-- Flag de reprovação em conciliacao_items (item 8)
-- Reaproveita a coluna status existente: agora aceita 'pendente' | 'conciliado' | 'reprovado'
-- + colunas de auditoria de reprovação
ALTER TABLE public.conciliacao_items
  ADD COLUMN IF NOT EXISTS reprovado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reprovado_por_id UUID,
  ADD COLUMN IF NOT EXISTS reprovado_por_nome TEXT,
  ADD COLUMN IF NOT EXISTS reprovado_motivo TEXT;

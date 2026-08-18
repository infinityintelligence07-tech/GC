CREATE TABLE public.conciliacao_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  student_id uuid,
  student_name text NOT NULL,
  ac text,
  resumo text NOT NULL,
  antes jsonb NOT NULL DEFAULT '{}'::jsonb,
  depois jsonb NOT NULL DEFAULT '{}'::jsonb,
  autor_id uuid,
  autor_nome text,
  status text NOT NULL DEFAULT 'pendente',
  conciliado_at timestamptz,
  conciliado_por_id uuid,
  conciliado_por_nome text,
  conciliado_nota text,
  related_case_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conciliacao_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conciliacao_items_public_all"
ON public.conciliacao_items
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER conciliacao_items_set_updated_at
BEFORE UPDATE ON public.conciliacao_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_conciliacao_items_status ON public.conciliacao_items(status);
CREATE INDEX idx_conciliacao_items_student ON public.conciliacao_items(student_id);
CREATE INDEX idx_conciliacao_items_created ON public.conciliacao_items(created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.conciliacao_items;
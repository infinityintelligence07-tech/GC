CREATE TABLE public.conciliacao_import_errors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL,
  file_name TEXT,
  row_index INTEGER,
  student_name TEXT NOT NULL,
  student_id UUID,
  vencimento TEXT,
  valor NUMERIC,
  data_pagamento TEXT,
  motivo TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pendente',
  resolvido_por_id UUID,
  resolvido_por_nome TEXT,
  resolvido_at TIMESTAMP WITH TIME ZONE,
  resolvido_nota TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.conciliacao_import_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conciliacao_import_errors_public_all"
ON public.conciliacao_import_errors
FOR ALL
USING (true)
WITH CHECK (true);

CREATE TRIGGER set_conciliacao_import_errors_updated_at
BEFORE UPDATE ON public.conciliacao_import_errors
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_conciliacao_import_errors_batch ON public.conciliacao_import_errors(batch_id);
CREATE INDEX idx_conciliacao_import_errors_status ON public.conciliacao_import_errors(status);
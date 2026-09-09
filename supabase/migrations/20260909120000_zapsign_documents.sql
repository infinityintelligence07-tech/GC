-- Integração direta com a ZapSign (API + webhook).
--
-- Cada termo enviado para assinatura vira uma linha aqui. A edge function
-- `zapsign-termo` cria o documento na ZapSign e grava a linha; a edge function
-- `zapsign-webhook` recebe os eventos (doc_signed, doc_refused, ...) e atualiza
-- status, baixa o PDF assinado para o bucket `cancellation-docs` e reflete no
-- caso de cancelamento / histórico do aluno.
--
-- Escrita só pelo service role (edge functions). Leitura para usuários da empresa.

CREATE TABLE IF NOT EXISTS public.zapsign_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- 'cancelamento' | 'renegociacao' | 'aditivo' | 'outro'
  tipo              text NOT NULL,
  student_id        uuid REFERENCES public.students(id) ON DELETE SET NULL,
  cancellation_case_id uuid REFERENCES public.cancellation_cases(id) ON DELETE SET NULL,
  -- Identificadores ZapSign
  doc_token         text NOT NULL UNIQUE,
  doc_open_id       bigint,
  signer_token      text,
  sign_url          text,
  external_id       text,
  nome_documento    text NOT NULL,
  -- pending | signed | refused | deleted | expired
  status            text NOT NULL DEFAULT 'pending',
  signer_name       text,
  signer_email      text,
  signer_phone      text,
  signers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- PDF assinado salvo no bucket cancellation-docs (path relativo ao bucket)
  signed_file_path  text,
  signed_at         timestamptz,
  refused_at        timestamptz,
  last_event        text,
  last_event_at     timestamptz,
  last_payload      jsonb,
  created_by        uuid,
  created_by_nome   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zapsign_documents_company_idx ON public.zapsign_documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zapsign_documents_student_idx ON public.zapsign_documents(student_id);
CREATE INDEX IF NOT EXISTS zapsign_documents_case_idx ON public.zapsign_documents(cancellation_case_id);
CREATE INDEX IF NOT EXISTS zapsign_documents_status_idx ON public.zapsign_documents(status);

COMMENT ON TABLE public.zapsign_documents IS
  'Termos enviados para assinatura eletrônica na ZapSign (integração direta). Escrita apenas via edge functions.';

CREATE OR REPLACE FUNCTION public.zapsign_documents_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zapsign_documents_touch ON public.zapsign_documents;
CREATE TRIGGER zapsign_documents_touch
  BEFORE UPDATE ON public.zapsign_documents
  FOR EACH ROW EXECUTE FUNCTION public.zapsign_documents_touch();

ALTER TABLE public.zapsign_documents ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.zapsign_documents TO authenticated;

DROP POLICY IF EXISTS zapsign_documents_select ON public.zapsign_documents;
CREATE POLICY zapsign_documents_select ON public.zapsign_documents
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR company_id = public.current_company_id()
  );

-- Atualizações em tempo real no front (status muda quando o webhook chega).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'zapsign_documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.zapsign_documents;
  END IF;
END $$;

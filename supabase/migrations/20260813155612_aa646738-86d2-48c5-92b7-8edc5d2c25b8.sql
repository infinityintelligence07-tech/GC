CREATE TABLE public.regua_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  mensagem text NOT NULL DEFAULT '',
  status text,
  ordem integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.regua_mensagens TO authenticated;
GRANT ALL ON public.regua_mensagens TO service_role;

ALTER TABLE public.regua_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regua_select" ON public.regua_mensagens FOR SELECT TO authenticated
USING (company_id = public.current_company_id() AND public.has_tab_view(auth.uid(), 'alunos'));

CREATE POLICY "regua_insert" ON public.regua_mensagens FOR INSERT TO authenticated
WITH CHECK (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'alunos'));

CREATE POLICY "regua_update" ON public.regua_mensagens FOR UPDATE TO authenticated
USING (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'alunos'))
WITH CHECK (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'alunos'));

CREATE POLICY "regua_delete" ON public.regua_mensagens FOR DELETE TO authenticated
USING (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'alunos'));

CREATE TRIGGER trg_regua_mensagens_updated BEFORE UPDATE ON public.regua_mensagens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_regua_mensagens_company ON public.regua_mensagens(company_id, ordem);
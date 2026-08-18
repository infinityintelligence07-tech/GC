CREATE TABLE public.tutorials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL DEFAULT public.current_company_id(),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutorials TO authenticated;
GRANT ALL ON public.tutorials TO service_role;

ALTER TABLE public.tutorials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tutorials_select_company" ON public.tutorials
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "tutorials_insert_company" ON public.tutorials
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tutorials_update_company" ON public.tutorials
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "tutorials_delete_company" ON public.tutorials
  FOR DELETE TO authenticated
  USING (company_id = public.current_company_id() AND (created_by = auth.uid() OR public.current_user_is_admin()));

CREATE TRIGGER trg_tutorials_updated BEFORE UPDATE ON public.tutorials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
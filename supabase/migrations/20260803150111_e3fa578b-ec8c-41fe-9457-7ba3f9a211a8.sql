CREATE TABLE public.commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cancellation_case_id text NOT NULL,
  student_id uuid,
  student_name text NOT NULL,
  ac_id uuid REFERENCES public.acs(id) ON DELETE SET NULL,
  ac_name text,
  payment_type text NOT NULL DEFAULT 'boleto',
  reverted_value numeric NOT NULL DEFAULT 0,
  percent numeric NOT NULL DEFAULT 0,
  value numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  pending_approval boolean NOT NULL DEFAULT false,
  observacao text,
  product text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, cancellation_case_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commissions TO authenticated;
GRANT ALL ON public.commissions TO service_role;

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commissions_select" ON public.commissions
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND (
    public.has_any_tab_view(auth.uid(), ARRAY['comissoes','conciliacao','admin'])
    OR ac_id = public.current_ac_id()
  )
);

CREATE POLICY "commissions_insert" ON public.commissions
FOR INSERT TO authenticated
WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "commissions_update" ON public.commissions
FOR UPDATE TO authenticated
USING (
  company_id = public.current_company_id()
  AND (
    public.has_any_tab_view(auth.uid(), ARRAY['comissoes','conciliacao','admin'])
    OR ac_id = public.current_ac_id()
  )
)
WITH CHECK (company_id = public.current_company_id());

CREATE POLICY "commissions_delete" ON public.commissions
FOR DELETE TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.has_any_tab_view(auth.uid(), ARRAY['comissoes','admin'])
);

CREATE TRIGGER trg_commissions_updated
BEFORE UPDATE ON public.commissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.commission_rates (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  boleto numeric NOT NULL DEFAULT 0.5,
  pix numeric NOT NULL DEFAULT 1,
  cartao numeric NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_rates TO authenticated;
GRANT ALL ON public.commission_rates TO service_role;

ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commission_rates_select" ON public.commission_rates
FOR SELECT TO authenticated
USING (company_id = public.current_company_id());

CREATE POLICY "commission_rates_write" ON public.commission_rates
FOR ALL TO authenticated
USING (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'comissoes'))
WITH CHECK (company_id = public.current_company_id() AND public.has_tab_edit(auth.uid(), 'comissoes'));

CREATE TRIGGER trg_commission_rates_updated
BEFORE UPDATE ON public.commission_rates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── ACs ──────────────────────────────────────────────────────────────────
CREATE TABLE public.acs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  photo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.acs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acs_public_all" ON public.acs FOR ALL USING (true) WITH CHECK (true);

-- ─── Products ─────────────────────────────────────────────────────────────
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  value NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_all" ON public.products FOR ALL USING (true) WITH CHECK (true);

-- ─── Student Tags ─────────────────────────────────────────────────────────
CREATE TABLE public.student_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.student_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "student_tags_public_all" ON public.student_tags FOR ALL USING (true) WITH CHECK (true);

-- ─── Financial Rules ──────────────────────────────────────────────────────
CREATE TABLE public.financial_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  multa_percent NUMERIC NOT NULL DEFAULT 2,
  juros_percent NUMERIC NOT NULL DEFAULT 1,
  desconto_renda_extra NUMERIC NOT NULL DEFAULT 0,
  max_parcelas_renegociacao INTEGER NOT NULL DEFAULT 12,
  max_parcelas_cadastro INTEGER NOT NULL DEFAULT 24,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.financial_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "financial_rules_public_all" ON public.financial_rules FOR ALL USING (true) WITH CHECK (true);
INSERT INTO public.financial_rules DEFAULT VALUES;

-- ─── Students ─────────────────────────────────────────────────────────────
CREATE TABLE public.students (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT,
  cpf TEXT,
  address TEXT,
  numero TEXT,
  cidade TEXT,
  estado TEXT,
  cep TEXT,
  status TEXT NOT NULL DEFAULT 'Aluno Novo',
  status_mode TEXT NOT NULL DEFAULT 'Automático',
  ac TEXT,
  product TEXT,
  enrollment_date TEXT,
  data_treinamento_origem TEXT,
  due_day INTEGER NOT NULL DEFAULT 10,
  sale_value NUMERIC NOT NULL DEFAULT 0,
  down_payment NUMERIC NOT NULL DEFAULT 0,
  total_installments INTEGER NOT NULL DEFAULT 0,
  paid_installments INTEGER NOT NULL DEFAULT 0,
  installment_value NUMERIC NOT NULL DEFAULT 0,
  installments JSONB NOT NULL DEFAULT '[]'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_renda_extra BOOLEAN NOT NULL DEFAULT false,
  renda_extra_status TEXT,
  renda_extra_ac TEXT,
  renda_extra_ac_assigned_at TEXT,
  renda_extra_inclusion_date TEXT,
  renda_extra_inscription_date TEXT,
  renda_extra_acordo_value NUMERIC,
  renda_extra_directed_at TEXT,
  renda_extra_value_at_direction NUMERIC,
  status_cancelamento TEXT DEFAULT 'nenhum',
  cancellation_case_id UUID,
  tags JSONB DEFAULT '[]'::jsonb,
  product_history JSONB DEFAULT '[]'::jsonb,
  detalhes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "students_public_all" ON public.students FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_students_ac ON public.students(ac);
CREATE INDEX idx_students_status ON public.students(status);
CREATE INDEX idx_students_renda_extra ON public.students(is_renda_extra);

-- ─── Cancellation Cases ───────────────────────────────────────────────────
CREATE TABLE public.cancellation_cases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_name TEXT NOT NULL,
  student_id UUID,
  student_whatsapp TEXT,
  ac TEXT,
  stage TEXT NOT NULL,
  operational_status TEXT NOT NULL,
  value NUMERIC,
  notes TEXT DEFAULT '',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  motivo_cancelamento TEXT,
  descricao_cancelamento TEXT,
  funnel_stage TEXT,
  acao TEXT,
  responsavel TEXT,
  is_mirror BOOLEAN NOT NULL DEFAULT false,
  term_template TEXT,
  term_signed_at TEXT,
  term_signed_by_student BOOLEAN DEFAULT false,
  term_attachments JSONB DEFAULT '[]'::jsonb,
  moved_to_current_stage_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cancellation_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cancellation_cases_public_all" ON public.cancellation_cases FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_cancellation_cases_stage ON public.cancellation_cases(stage);
CREATE INDEX idx_cancellation_cases_ac ON public.cancellation_cases(ac);

-- ─── App Users ────────────────────────────────────────────────────────────
CREATE TABLE public.app_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  login TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ac',
  ac_id UUID REFERENCES public.acs(id) ON DELETE SET NULL,
  photo TEXT,
  permissions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_users_public_all" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_app_users_login ON public.app_users(login);
CREATE INDEX idx_app_users_ac_id ON public.app_users(ac_id);

-- Usuário admin padrão (se já existir, ignora)
INSERT INTO public.app_users (id, name, login, password, role, permissions)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Admin',
  'admin',
  'admin',
  'admin',
  '{"dashboard":"edit","alunos":"edit","equipe":"edit","rendaExtra":"edit","cancelamentos":"edit","config":"edit"}'::jsonb
)
ON CONFLICT (login) DO NOTHING;

-- ─── Antecipação Items ────────────────────────────────────────────────────
CREATE TABLE public.antecipacao_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ac_id UUID NOT NULL REFERENCES public.acs(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  whatsapp TEXT,
  data_vencimento TEXT NOT NULL,
  origem TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.antecipacao_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "antecipacao_items_public_all" ON public.antecipacao_items FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_antecipacao_items_ac_id ON public.antecipacao_items(ac_id);

-- ─── Updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_acs_updated BEFORE UPDATE ON public.acs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_student_tags_updated BEFORE UPDATE ON public.student_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_financial_rules_updated BEFORE UPDATE ON public.financial_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_students_updated BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_cancellation_cases_updated BEFORE UPDATE ON public.cancellation_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_app_users_updated BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_antecipacao_items_updated BEFORE UPDATE ON public.antecipacao_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Realtime ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.acs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.student_tags;
ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_rules;
ALTER PUBLICATION supabase_realtime ADD TABLE public.students;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cancellation_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.antecipacao_items;

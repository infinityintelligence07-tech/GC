
-- Table to store daily frozen snapshots of student portfolio state per company.
-- One row per (snapshot_date, company_id) with a JSONB payload containing an
-- array of per-student snapshots (status, installments state, flags).
CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  student_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, company_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date
  ON public.dashboard_snapshots (snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_company_date
  ON public.dashboard_snapshots (company_id, snapshot_date DESC);

GRANT SELECT ON public.dashboard_snapshots TO authenticated;
GRANT ALL ON public.dashboard_snapshots TO service_role;

ALTER TABLE public.dashboard_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read snapshots for companies they have access to.
CREATE POLICY "Snapshots readable by company members"
  ON public.dashboard_snapshots
  FOR SELECT
  TO authenticated
  USING (public.has_company_access(auth.uid(), company_id));

-- Only service_role writes (via the scheduled edge function).
-- No INSERT/UPDATE/DELETE policies for authenticated => blocked by RLS.

CREATE TRIGGER trg_dashboard_snapshots_updated_at
  BEFORE UPDATE ON public.dashboard_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

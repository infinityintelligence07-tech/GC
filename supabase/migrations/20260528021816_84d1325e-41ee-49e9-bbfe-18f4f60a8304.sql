
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS subtitle text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "company logos public read" ON storage.objects;
CREATE POLICY "company logos public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "company logos admin write" ON storage.objects;
CREATE POLICY "company logos admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "company logos admin update" ON storage.objects;
CREATE POLICY "company logos admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "company logos admin delete" ON storage.objects;
CREATE POLICY "company logos admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'company-logos' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS company_logos_public_read ON storage.objects;
CREATE POLICY "company_logos_authenticated_list" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'company-logos');
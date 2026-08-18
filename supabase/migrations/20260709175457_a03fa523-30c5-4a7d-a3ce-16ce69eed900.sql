
CREATE POLICY "cancellation_docs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cancellation-docs' AND public.has_tab_edit(auth.uid(), 'cancelamentos'));

CREATE POLICY "cancellation_docs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'cancellation-docs' AND public.has_tab_edit(auth.uid(), 'cancelamentos'));

CREATE POLICY "cancellation_docs_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'cancellation-docs' AND public.has_tab_edit(auth.uid(), 'cancelamentos'))
  WITH CHECK (bucket_id = 'cancellation-docs' AND public.has_tab_edit(auth.uid(), 'cancelamentos'));

CREATE POLICY "cancellation_docs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cancellation-docs' AND public.has_role(auth.uid(), 'admin'::public.app_role));

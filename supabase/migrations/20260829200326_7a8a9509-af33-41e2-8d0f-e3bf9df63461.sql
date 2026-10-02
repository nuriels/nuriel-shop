CREATE POLICY "branding own read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'branding'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_super_admin(auth.uid())
    )
  );

CREATE POLICY "branding own insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "branding own update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "branding own delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'branding'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
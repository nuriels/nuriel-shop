CREATE POLICY "product images readable by approved"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'product-images' AND (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid())));

CREATE POLICY "product images insert by approved"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid())));

CREATE POLICY "product images update by approved"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid())))
  WITH CHECK (bucket_id = 'product-images' AND (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid())));

CREATE POLICY "product images delete by super admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_super_admin(auth.uid()));
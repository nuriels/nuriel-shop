REVOKE ALL ON FUNCTION public.check_product_category() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_product_category() TO service_role;

REVOKE ALL ON FUNCTION public.check_selling_price() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_selling_price() TO service_role;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.owns_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_store(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.generate_sku() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_sku() TO authenticated, service_role;

DO $$ BEGIN
  CREATE POLICY "store_shares deny client" ON public.store_shares
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
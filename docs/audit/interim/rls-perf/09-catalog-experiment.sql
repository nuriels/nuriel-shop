-- EXTRA experiment (NOT part of the RLS rewrite; scratch DB perf_scratch_b only).
-- get_catalog()/storefront_feed_products() are SECURITY DEFINER, so RLS policies are never evaluated inside them;
-- their per-row cost comes from helper calls in their own bodies. Build experimental copies with the same hoisting idea:
--   get_catalog_exp():  WITH viewer AS MATERIALIZED (...) + the "storefront open OR is_staff" test computed once in viewer
--   storefront_feed_products_exp(): tenant_is_active / tenant_subscription_active evaluated once (gp.tenant_id = current_tenant_id())
\set ON_ERROR_STOP on
DO $$
DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.get_catalog()'::regprocedure);
  d := replace(d0, 'FUNCTION public.get_catalog()', 'FUNCTION public.get_catalog_exp()');
  d := replace(d, 'WITH viewer AS (', 'WITH viewer AS MATERIALIZED (');
  d := replace(d, E'      public.current_tenant_id() AS tenant_id', E'      public.current_tenant_id() AS tenant_id,\n      (public.tenant_storefront_open(public.current_tenant_id()) OR public.is_staff(auth.uid())) AS visible');
  d := replace(d, 'AND (public.tenant_storefront_open(v.tenant_id) OR public.is_staff(auth.uid()))', 'AND v.visible');
  IF d = d0 OR position('AS MATERIALIZED' in d) = 0 OR position('AND v.visible' in d) = 0 OR position('AS visible' in d) = 0 THEN
    RAISE EXCEPTION 'get_catalog rewrite did not apply cleanly';
  END IF;
  EXECUTE d;

  d0 := pg_get_functiondef('public.storefront_feed_products()'::regprocedure);
  d := replace(d0, 'FUNCTION public.storefront_feed_products()', 'FUNCTION public.storefront_feed_products_exp()');
  d := replace(d, E'AND public.tenant_is_active(gp.tenant_id)\n     AND public.tenant_subscription_active(gp.tenant_id)',
                  E'AND (SELECT public.tenant_is_active(public.current_tenant_id()) AND public.tenant_subscription_active(public.current_tenant_id()))');
  IF d = d0 OR position('(SELECT public.tenant_is_active' in d) = 0 THEN RAISE EXCEPTION 'feed rewrite did not apply cleanly'; END IF;
  EXECUTE d;
END $$;
GRANT EXECUTE ON FUNCTION public.get_catalog_exp() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.storefront_feed_products_exp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_feed_products_exp() TO service_role;

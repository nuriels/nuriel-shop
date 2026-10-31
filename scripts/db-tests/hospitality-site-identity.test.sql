-- ============================================================
-- Hospitality: site identity for the page head (R-1 — 20261101170000_hosp_site_identity.sql)
--   • anyone (also anonymous) gets ONLY the business name of the request's site
--   • only for an active Hospitality site whose database and management area (or public
--     website) are enabled; otherwise NULL
--   • never for a store, never without the site header; another site's header gives that
--     site's name only
--   • Ecommerce data unchanged
-- ============================================================
\set SHOP '''00000000-0000-0000-0000-000000000001'''

CREATE OR REPLACE FUNCTION pg_temp.identity(_site text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE anon;
  SELECT hospitality.site_identity() INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
       JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(x::text, ',' ORDER BY x.tenant_id) FROM public.tenant_subscriptions x)));
$f$;
CREATE TEMP TABLE r1_before AS SELECT pg_temp.ecommerce_hash() AS h;

SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('r1-a', 'צימרים א'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('r1-b', 'צימרים ב'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'r1-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'r1-b' \gset
UPDATE hospitality.settings SET business_name = 'בקתות הגליל', contact_email = 'secret.owner@test.local',
       contact_phone = '050-1234567', address = 'רחוב סודי 1' WHERE tenant_id = :'sa';

SELECT tests.check('identity: nothing while every flag is off',
  format($$SELECT pg_temp.identity(%L) IS NULL$$, :'sa'));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT tests.check('identity: database on, but neither the management area nor the website → nothing',
  format($$SELECT pg_temp.identity(%L) IS NULL$$, :'sa'));

SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT tests.check('identity: management area on → anonymous gets the business name',
  format($$SELECT pg_temp.identity(%L) = '{"name": "בקתות הגליל"}'::jsonb$$, :'sa'));
SELECT tests.check('identity: only the name — no email, phone, address, plan or ids',
  format($$SELECT (SELECT array_agg(k) FROM jsonb_object_keys(pg_temp.identity(%L)) k) = ARRAY['name']
             AND pg_temp.identity(%1$L)::text !~ '(secret|050|סודי|trial|%1$s)'$$, :'sa'));
SELECT tests.check('identity: public website on (no management) → the name too',
  format($$SELECT pg_temp.identity(%L) = '{"name": "צימרים ב"}'::jsonb$$, :'sb'));
UPDATE hospitality.settings SET business_name = '  ' WHERE tenant_id = :'sb';
SELECT tests.check('identity: empty business name → the site name',
  format($$SELECT pg_temp.identity(%L) = '{"name": "צימרים ב"}'::jsonb$$, :'sb'));
SELECT tests.check('identity: each site header gives only that site''s name',
  format($$SELECT pg_temp.identity(%L) ->> 'name' = 'בקתות הגליל' AND pg_temp.identity(%L) ->> 'name' = 'צימרים ב'$$, :'sa', :'sb'));
SELECT tests.check('identity: a store id in the header → nothing',
  format($$SELECT pg_temp.identity(%L) IS NULL$$, :SHOP));
SELECT tests.check('identity: no site header → nothing',
  $$SELECT pg_temp.identity(NULL) IS NULL$$);
SELECT tests.check('identity: an unknown id → nothing',
  $$SELECT pg_temp.identity('00000000-0000-0000-0000-00000000dead') IS NULL$$);

SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', false, %L))$$, :'sa')) IS NOT NULL AS ok \gset
SELECT tests.check('identity: the site''s database switched off → nothing',
  format($$SELECT pg_temp.identity(%L) IS NULL$$, :'sa'));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true, %L))$$, :'sa')) IS NOT NULL AS ok \gset
UPDATE public.tenants SET status = 'suspended' WHERE id = :'sa';
SELECT tests.check('identity: a suspended site → nothing',
  format($$SELECT pg_temp.identity(%L) IS NULL$$, :'sa'));
UPDATE public.tenants SET status = 'active' WHERE id = :'sa';

SELECT tests.check('identity: SECURITY DEFINER, callable by anon / authenticated, not by PUBLIC',
  $$SELECT p.prosecdef
       AND has_function_privilege('anon', 'hospitality.site_identity()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.site_identity()', 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
     FROM pg_proc p WHERE p.oid = 'hospitality.site_identity()'::regprocedure$$);
SELECT tests.check('identity: anon still cannot read the settings table directly',
  $$SELECT NOT has_table_privilege('anon', 'hospitality.settings', 'SELECT')$$);

SELECT tests.check('ecommerce: store data unchanged',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM r1_before)$$);

SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'r1-a'), public.platform_delete_tenant(%2$L, 'r1-b')])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false),
                                    public.platform_set_flag('hospitality_frontend_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE r1_before;

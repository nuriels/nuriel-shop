-- ============================================================
-- GA4 in the business settings (migration 199): a measurement ID only, stored per site in site_tracking,
-- next to Google Tag Manager
--   • only G-XXXXXXXXXX is stored (uppercased); scripts, GTM / UA / AW IDs, bad lengths are refused —
--     in the function and by the CHECK, even for the database owner
--   • zimmer: the owner or the platform admin only (not the business admin, not a regular manager, not a
--     guest, not the owner of another zimmer); store: the owner
--   • the site reads only its own ID (by the request's site), also as a guest — and in a zimmer only while
--     measurement is on for that site
--   • saving GA4 does not touch the saved Tag Manager settings; clearing removes it; every change is logged
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set SA '''70000000-0000-0000-0000-00000000000a'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set G_OWNER '''a0000000-0000-0000-0000-0000000199d1'''
\set G_BA '''a0000000-0000-0000-0000-0000000199d2'''
\set G_MGR '''a0000000-0000-0000-0000-0000000199d3'''
\set G_OTHER '''a0000000-0000-0000-0000-0000000199d4'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.user_err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.owner_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RETURN e;
END $f$;
-- the GA4 ID a site serves to a guest
CREATE OR REPLACE FUNCTION pg_temp.ga4(_site text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(_site, NULL, 'SELECT to_jsonb(public.site_ga4())') #>> '{}';
$f$;

-- ---------- fixtures: zimmer G (owner, business admin, manager) and zimmer O (another owner) ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:G_OWNER, 'ga4.owner@test.local', now()),
  (:G_BA, 'ga4.ba@test.local', now()),
  (:G_MGR, 'ga4.mgr@test.local', now()),
  (:G_OTHER, 'ga4.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[hospitality.admin_create_site('ga4-zimmer-g', 'צימר GA4'),
                                                               hospitality.admin_create_site('ga4-zimmer-o', 'צימר אחר')])$$) IS NOT NULL AS ok \gset
SELECT id AS gs FROM public.tenants WHERE slug = 'ga4-zimmer-g' \gset
SELECT id AS os FROM public.tenants WHERE slug = 'ga4-zimmer-o' \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(hospitality.admin_set_extra_managers(%L, 5))$$, :'gs')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:'gs', :G_OWNER, 'ga4.owner@test.local', 'ga4_owner', 'admin', true, true),
  (:'gs', :G_BA, 'ga4.ba@test.local', 'ga4_ba', 'admin', true, false),
  (:'gs', :G_MGR, 'ga4.mgr@test.local', 'ga4_mgr', 'admin', true, false),
  (:'os', :G_OTHER, 'ga4.other@test.local', 'ga4_other', 'admin', true, true);
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'gs', :'os')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'gs', :G_OWNER, format('SELECT hospitality.team_set_business_admin(%L, true)', :G_BA)) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. The column and the functions
-- ============================================================
SELECT tests.check('ga4: guests may only call the read function; saving needs a signed-in user; the table stays closed',
  $$SELECT has_function_privilege('anon', 'public.site_ga4()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.save_my_ga4(text)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.save_my_ga4(text)', 'EXECUTE')
       AND NOT has_table_privilege('authenticated', 'public.site_tracking', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.site_tracking', 'UPDATE')$$);
SELECT tests.check('ga4: nothing is served before an owner saves',
  format($$SELECT pg_temp.ga4(%L) IS NULL AND pg_temp.ga4(%L) IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.site_tracking WHERE tenant_id IN (%1$L, %2$L))$$, :'gs', :'os'));

-- ============================================================
-- 2. Only a measurement ID in the right format
-- ============================================================
SELECT tests.check('ga4: scripts, HTML, other Google IDs and bad lengths are refused; nothing was stored',
  format($$SELECT bool_and(pg_temp.user_err(%1$L, %2$L, format('SELECT public.save_my_ga4(%%L)', v)) LIKE '%%לא תקין%%')
             AND NOT EXISTS (SELECT 1 FROM public.site_tracking WHERE tenant_id = %1$L)
           FROM unnest(ARRAY['<script>alert(1)</script>', 'G-ABC123"><script>', 'G-AB1', 'G-ABCDEFGHIJ1234567',
                             'GTM-ABC1234', 'UA-12345-1', 'AW-123456789', 'G_ABC12345', 'G-ABC 12345',
                             'javascript:alert(1)', 'G-ABC12345'';alert(1);//', 'G-ÄBC12345']) v$$, :'gs', :G_OWNER));
SELECT tests.check('ga4: even the database owner cannot store a value that is not a measurement ID',
  format($$SELECT pg_temp.owner_err(format($q$INSERT INTO public.site_tracking (tenant_id, ga4_measurement_id) VALUES (%%L, 'GTM-ABC1234')$q$, %L))
                  LIKE '%%check constraint%%'$$, :'gs'));

-- ============================================================
-- 3. Who may change it
-- ============================================================
SELECT pg_temp.as_user(:'gs', :G_OWNER, $$SELECT public.save_my_ga4('  g-e2etest123 ')$$) AS saved_owner \gset
SELECT tests.check('ga4: the owner saves — trimmed and uppercased (G-E2ETEST123); reads it back with the Tag Manager settings',
  format($$SELECT %L::jsonb ->> 'ga4_id' = 'G-E2ETEST123' AND %1$L::jsonb ->> 'container_id' IS NULL
             AND NOT (%1$L::jsonb ->> 'enabled')::boolean
             AND pg_temp.as_user(%2$L, %3$L, 'SELECT public.my_tag_manager()') ->> 'ga4_id' = 'G-E2ETEST123'$$,
         :'saved_owner', :'gs', :G_OWNER));
SELECT tests.check('ga4: the business admin, a regular manager and a guest can neither read nor change it',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.save_my_ga4('G-EVIL12345')$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.my_tag_manager()') LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, %3$L, $q$SELECT public.save_my_ga4('G-EVIL12345')$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, NULL, $q$SELECT public.save_my_ga4('G-EVIL12345')$q$) IS NOT NULL
             AND (SELECT ga4_measurement_id FROM public.site_tracking WHERE tenant_id = %1$L) = 'G-E2ETEST123'$$,
         :'gs', :G_BA, :G_MGR));
SELECT tests.check('ga4: the owner of another zimmer cannot change this one (even naming it from their own site)',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.save_my_ga4('G-EVIL12345')$q$) LIKE '%%רק בעל העסק%%'
             AND (SELECT ga4_measurement_id FROM public.site_tracking WHERE tenant_id = %1$L) = 'G-E2ETEST123'
             AND (pg_temp.as_user(%3$L, %2$L, $q$SELECT public.save_my_ga4('G-OTHER9999')$q$) ->> 'ga4_id') = 'G-OTHER9999'
             AND (SELECT ga4_measurement_id FROM public.site_tracking WHERE tenant_id = %1$L) = 'G-E2ETEST123'$$,
         :'gs', :G_OTHER, :'os'));
SELECT tests.check('ga4: the platform admin may change it (entering the business management)',
  format($$SELECT (pg_temp.as_user(%L, %L, $q$SELECT public.save_my_ga4('G-PLATFRM12')$q$) ->> 'ga4_id') = 'G-PLATFRM12'
             AND (pg_temp.as_user(%1$L, %3$L, $q$SELECT public.save_my_ga4('G-E2ETEST123')$q$) ->> 'ga4_id') = 'G-E2ETEST123'$$,
         :'gs', :PLATFORM, :G_OWNER));

-- ============================================================
-- 4. Served only on its own site, only while measurement is on there
-- ============================================================
SELECT tests.check('ga4: measurement off for the site — nothing served; the owner is told it does not load yet',
  format($$SELECT pg_temp.ga4(%L) IS NULL
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.my_tag_manager()') ->> 'loads_on_site')::boolean$$, :'gs', :G_OWNER));
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_analytics_enabled', true),
       public.platform_set_flag('hospitality_analytics_enabled', true, %L)])$$, :'gs')) IS NOT NULL AS ok \gset
SELECT tests.check('ga4: measurement on for this site — its own ID only; the other zimmer (switch off) and a store serve nothing of it',
  format($$SELECT pg_temp.ga4(%L) = 'G-E2ETEST123' AND pg_temp.ga4(%L) IS NULL AND pg_temp.ga4(%L) IS NULL
             AND pg_temp.ga4(NULL) IS NULL$$, :'gs', :'os', :SA));

-- ============================================================
-- 5. GA4 and Tag Manager side by side; clearing; audit
-- ============================================================
SELECT pg_temp.as_user(:'gs', :G_OWNER, $$SELECT public.save_my_tag_manager('GTM-GA4TEST', true)$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'gs', :G_OWNER, $$SELECT public.save_my_ga4('G-E2ETEST999')$$) AS both_saved \gset
SELECT tests.check('ga4: saving GA4 keeps the saved Tag Manager settings (and the other way round)',
  format($$SELECT %L::jsonb ->> 'ga4_id' = 'G-E2ETEST999' AND %1$L::jsonb ->> 'container_id' = 'GTM-GA4TEST'
             AND (%1$L::jsonb ->> 'enabled')::boolean
             AND (pg_temp.as_user(%2$L, %3$L, $q$SELECT public.save_my_tag_manager('GTM-GA4TEST', false)$q$) ->> 'ga4_id') = 'G-E2ETEST999'$$,
         :'both_saved', :'gs', :G_OWNER));
SELECT pg_temp.as_user(:'gs', :G_OWNER, $$SELECT public.save_my_ga4('')$$) AS cleared \gset
SELECT tests.check('ga4: an empty value removes it — nothing served any more',
  format($$SELECT %L::jsonb ->> 'ga4_id' IS NULL AND pg_temp.ga4(%L) IS NULL$$, :'cleared', :'gs'));
SELECT tests.check('ga4: every change is in the platform log with the previous value and who did it',
  format($$SELECT (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'site_ga4_saved') = 5
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'site_ga4_saved'
                           AND details ->> 'ga4_id' IS NULL AND details ->> 'previous' = 'G-E2ETEST999'
                           AND actor_id = %2$L AND actor_email = 'ga4.owner@test.local')
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'site_ga4_saved'
                           AND actor_id = %3$L AND details ->> 'ga4_id' = 'G-PLATFRM12')$$,
         :'gs', :G_OWNER, :PLATFORM));

-- ---------- cleanup: the global flags off (later files check that); the test sites removed ----------
DELETE FROM public.site_tracking WHERE tenant_id IN (:'gs', :'os');
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', false),
       public.platform_set_flag('hospitality_management_enabled', false),
       public.platform_set_flag('hospitality_analytics_enabled', false)])$$) IS NOT NULL AS ok \gset

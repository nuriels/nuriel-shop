-- ============================================================
-- Google Tag Manager per site (migration 192): a container ID only, owner-only, one site never sees
-- another site's ID
--   • the table is closed to every API user; everything goes through the functions
--   • only GTM-XXXXXXX is stored (uppercased); scripts, other tags, too short / long IDs are refused —
--     in the function and by the CHECK, even for the database owner
--   • store: the owner only (not a manager, a customer or a guest, not the owner of another store);
--     zimmer: the owner or the business admin (settings.owner), not a regular manager
--   • the site reads only its own enabled ID (by the request's site), also as a guest
--   • every change is in the platform log
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set B1 '''a0000000-0000-0000-0000-0000000000b1'''
\set B2 '''a0000000-0000-0000-0000-0000000000b2'''
\set SA '''70000000-0000-0000-0000-00000000000a'''
\set SB '''70000000-0000-0000-0000-00000000000b'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set GC '''a0000000-0000-0000-0000-0000000192c1'''
\set H_OWNER '''a0000000-0000-0000-0000-0000000192d1'''
\set H_BA '''a0000000-0000-0000-0000-0000000192d2'''
\set H_MGR '''a0000000-0000-0000-0000-0000000192d3'''

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
-- the ID a site serves to a guest
CREATE OR REPLACE FUNCTION pg_temp.served(_site text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(_site, NULL, 'SELECT to_jsonb(public.site_tag_manager())') #>> '{}';
$f$;

-- ---------- fixtures: a customer of store B; zimmer H (owner, business admin, manager) ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:GC, 'gtm.customer@test.local', now()),
  (:H_OWNER, 'gtm.h.owner@test.local', now()),
  (:H_BA, 'gtm.h.ba@test.local', now()),
  (:H_MGR, 'gtm.h.mgr@test.local', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:SB, :GC, 'gtm.customer@test.local', 'gtm_customer', 'customer', true) ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(hospitality.admin_create_site('gtm-zimmer-h', 'צימר GTM'))$$) IS NOT NULL AS ok \gset
SELECT id AS hs FROM public.tenants WHERE slug = 'gtm-zimmer-h' \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(hospitality.admin_set_extra_managers(%L, 5))$$, :'hs')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:'hs', :H_OWNER, 'gtm.h.owner@test.local', 'gtm_h_owner', 'admin', true, true),
  (:'hs', :H_BA, 'gtm.h.ba@test.local', 'gtm_h_ba', 'admin', true, false),
  (:'hs', :H_MGR, 'gtm.h.mgr@test.local', 'gtm_h_mgr', 'admin', true, false);
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L)])$$, :'hs')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'hs', :H_OWNER, format('SELECT hospitality.team_set_business_admin(%L, true)', :H_BA)) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Closed table; nothing served before an owner saves
-- ============================================================
SELECT tests.check('gtm: the table is closed to every API user (RLS, no grants); guests may only call the read function',
  $$SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_tracking'::regclass)
       AND NOT has_table_privilege('anon', 'public.site_tracking', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.site_tracking', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.site_tracking', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.site_tracking', 'UPDATE')
       AND has_function_privilege('anon', 'public.site_tag_manager()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.save_my_tag_manager(text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.my_tag_manager()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.site_tracking_can_edit()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.site_tracking_allowed()', 'EXECUTE')$$);
SELECT tests.check('gtm: no site serves anything until its owner saves (existing businesses untouched)',
  format($$SELECT pg_temp.served(%L) IS NULL AND pg_temp.served(%L) IS NULL AND pg_temp.served(%L) IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.site_tracking)$$, :SA, :SB, :'hs'));

-- ============================================================
-- 2. Only a container ID in the right format — never code
-- ============================================================
SELECT tests.check('gtm: scripts, HTML, other tags and bad lengths are refused; nothing was stored',
  format($$SELECT bool_and(pg_temp.user_err(%1$L, %2$L, format('SELECT public.save_my_tag_manager(%%L, true)', v)) LIKE '%%לא תקין%%')
             AND NOT EXISTS (SELECT 1 FROM public.site_tracking)
           FROM unnest(ARRAY['<script>alert(1)</script>', 'GTM-ABC123"><script>', 'GTM-AB', 'GTM-ABCDEFGHIJKLM',
                             'G-ABCDE12345', 'UA-12345-1', 'AW-123456789', 'GTM_ABC123', 'GTM-ABC 123',
                             'javascript:alert(1)', 'GTM-ABC123'';alert(1);//']) v$$, :SA, :OA));
SELECT tests.check('gtm: turning it on without an ID is refused',
  format($$SELECT pg_temp.user_err(%L, %L, 'SELECT public.save_my_tag_manager(NULL, true)') LIKE '%%צריך מזהה%%'$$, :SA, :OA));
SELECT tests.check('gtm: even the database owner cannot store a value that is not a container ID',
  format($$SELECT pg_temp.owner_err(format($q$INSERT INTO public.site_tracking (tenant_id, gtm_container_id) VALUES (%%L, '<b>x</b>')$q$, %L))
                  LIKE '%%check constraint%%'$$, :SA));

-- ============================================================
-- 3. Owner saves; each site serves only its own ID
-- ============================================================
SELECT pg_temp.as_user(:SA, :OA, $$SELECT public.save_my_tag_manager('  gtm-abc123 ', true)$$) AS saved_a \gset
SELECT pg_temp.as_user(:SB, :B1, $$SELECT public.save_my_tag_manager('GTM-BBB777', true)$$) AS saved_b \gset
SELECT tests.check('gtm: the owner saves — trimmed and uppercased (GTM-ABC123), on; the owner reads it back',
  format($$SELECT %L::jsonb ->> 'container_id' = 'GTM-ABC123' AND (%1$L::jsonb ->> 'enabled')::boolean
             AND pg_temp.as_user(%2$L, %3$L, 'SELECT public.my_tag_manager()') ->> 'container_id' = 'GTM-ABC123'$$,
         :'saved_a', :SA, :OA));
SELECT tests.check('gtm: separation — store A serves only its ID, store B only its own, the zimmer nothing',
  format($$SELECT pg_temp.served(%L) = 'GTM-ABC123' AND pg_temp.served(%L) = 'GTM-BBB777' AND pg_temp.served(%L) IS NULL$$,
         :SA, :SB, :'hs'));
SELECT tests.check('gtm: no site header (the platform) — nothing',
  $$SELECT pg_temp.served(NULL) IS NULL$$);

-- ============================================================
-- 4. Permissions
-- ============================================================
SELECT tests.check('gtm: store — a manager, a customer and a guest cannot read or change it',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.save_my_tag_manager('GTM-EVIL01', true)$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.my_tag_manager()') LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, %3$L, $q$SELECT public.save_my_tag_manager('GTM-EVIL01', true)$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.user_err(%1$L, NULL, $q$SELECT public.save_my_tag_manager('GTM-EVIL01', true)$q$) IS NOT NULL
             AND pg_temp.served(%1$L) = 'GTM-BBB777'$$, :SB, :B2, :GC));
SELECT tests.check('gtm: the owner of store A cannot change store B (another business)',
  format($$SELECT pg_temp.user_err(%L, %L, $q$SELECT public.save_my_tag_manager('GTM-EVIL01', true)$q$) LIKE '%%רק בעל העסק%%'
             AND pg_temp.served(%1$L) = 'GTM-BBB777'$$, :SB, :OA));
SELECT pg_temp.as_user(:'hs', :H_OWNER, $$SELECT public.save_my_tag_manager('GTM-HHH111', true)$$) AS saved_h \gset
SELECT pg_temp.as_user(:'hs', :H_BA, $$SELECT public.save_my_tag_manager('GTM-HHH222', true)$$) AS saved_h2 \gset
SELECT tests.check('gtm: zimmer — the owner and the business admin may; a regular manager may not',
  format($$SELECT %L::jsonb ->> 'container_id' = 'GTM-HHH111' AND %L::jsonb ->> 'container_id' = 'GTM-HHH222'
             AND pg_temp.user_err(%L, %L, $q$SELECT public.save_my_tag_manager('GTM-EVIL01', true)$q$) LIKE '%%רק בעל העסק%%'$$,
         :'saved_h', :'saved_h2', :'hs', :H_MGR));
SELECT tests.check('gtm: zimmer — not served while measurement is off for the site on the platform (like GA4); the owner is told',
  format($$SELECT pg_temp.served(%L) IS NULL
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.my_tag_manager()') ->> 'loads_on_site')::boolean$$, :'hs', :H_OWNER));
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_analytics_enabled', true),
       public.platform_set_flag('hospitality_analytics_enabled', true, %L)])$$, :'hs')) IS NOT NULL AS ok \gset
SELECT tests.check('gtm: zimmer — with measurement on for the site, its own ID is served (and only on that site)',
  format($$SELECT pg_temp.served(%L) = 'GTM-HHH222' AND pg_temp.served(%L) = 'GTM-BBB777'
             AND (pg_temp.as_user(%1$L, %3$L, 'SELECT public.my_tag_manager()') ->> 'loads_on_site')::boolean$$,
         :'hs', :SB, :H_OWNER));

-- ============================================================
-- 5. Off = not served; the saved ID stays for the owner; audit
-- ============================================================
SELECT pg_temp.as_user(:SA, :OA, $$SELECT public.save_my_tag_manager('GTM-ABC123', false)$$) AS off_a \gset
SELECT tests.check('gtm: switched off — the site serves nothing, the owner still sees the saved ID',
  format($$SELECT pg_temp.served(%L) IS NULL AND %L::jsonb ->> 'container_id' = 'GTM-ABC123'
             AND NOT (%2$L::jsonb ->> 'enabled')::boolean$$, :SA, :'off_a'));
SELECT tests.check('gtm: every change is in the platform log (before / after)',
  format($$SELECT (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'site_tag_manager_saved') = 2
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'site_tag_manager_saved'
                           AND details ->> 'enabled' = 'false' AND details -> 'previous' ->> 'enabled' = 'true')$$, :SA));

-- ---------- cleanup: the sites as found; the global flags off (later files check that) ----------
DELETE FROM public.site_tracking WHERE tenant_id IN (:SA, :SB);
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', false),
       public.platform_set_flag('hospitality_management_enabled', false),
       public.platform_set_flag('hospitality_analytics_enabled', false)])$$) IS NOT NULL AS ok \gset
DELETE FROM public.site_tracking WHERE tenant_id = :'hs';

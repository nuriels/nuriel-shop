-- ============================================================
-- Hospitality: מטריצת הרשאות מלאה — Owner / Business Admin / מנהל רגיל / Super Admin (מיגרציה 188)
--   • כל מפתח ב-permissions(): מי מקבל אותו (מפת ההרשאות של management_context וגם השער _staff_tenant
--     שכל פונקציות הניהול עוברות דרכו)
--   • מנהל/ת עסק: כל פעולה עסקית (כל מסכי הניהול, הזמנות, מסמכים וחוזים, יומן, הגדרות, יחידות) — כן;
--     מנוי / תשלום / בעלות — לא; פעולות פלטפורמה (Super Admin) — לא, אף אחת; עסק אחר — לא
--   • Super Admin: כל ההרשאות בכל עסק, כולל מינוי מנהל/ת עסק
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER '''a0000000-0000-0000-0000-00000188d001'''
\set BA '''a0000000-0000-0000-0000-00000188d002'''
\set MGR '''a0000000-0000-0000-0000-00000188d003'''
\set OWNER_X '''a0000000-0000-0000-0000-00000188d004'''

CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
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
-- the error text of a call (NULL = no error), as a signed-in user on a site
CREATE OR REPLACE FUNCTION pg_temp.err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.call(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
-- the gate itself (internal: no grant to authenticated) with the user's identity and site
CREATE OR REPLACE FUNCTION pg_temp.gate(_site text, _uid uuid, _perm text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE ok boolean := true;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site)::text, true);
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  BEGIN
    PERFORM hospitality._staff_tenant(_perm);
  EXCEPTION WHEN OTHERS THEN ok := false;
  END;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN ok;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.perms(_site text, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT hospitality.management_context()') -> 'permissions';
$f$;
-- the permission keys a user gets, as a sorted array (from the management_context map)
CREATE OR REPLACE FUNCTION pg_temp.granted(_site text, _uid uuid) RETURNS text[] LANGUAGE sql AS $f$
  SELECT array_agg(k ORDER BY k) FROM jsonb_each_text(pg_temp.perms(_site, _uid)) AS e(k, v) WHERE v = 'true';
$f$;
-- the permission keys that pass the gate, as a sorted array
CREATE OR REPLACE FUNCTION pg_temp.gated(_site text, _uid uuid) RETURNS text[] LANGUAGE sql AS $f$
  SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p WHERE pg_temp.gate(_site, _uid, p);
$f$;

-- ---------- fixtures: business M (owner, business admin, regular manager), business X (another owner) ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-00000188d001', 'h188d.owner@test.local', now()),
  ('a0000000-0000-0000-0000-00000188d002', 'h188d.ba@test.local', now()),
  ('a0000000-0000-0000-0000-00000188d003', 'h188d.mgr@test.local', now()),
  ('a0000000-0000-0000-0000-00000188d004', 'h188d.owner.x@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h188d-m', 'מטריצה M'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('h188d-x', 'מטריצה X'))$$) IS NOT NULL AS ok \gset
SELECT id AS sm FROM public.tenants WHERE slug = 'h188d-m' \gset
SELECT id AS sx FROM public.tenants WHERE slug = 'h188d-x' \gset
SELECT id AS store FROM public.tenants WHERE site_type = 'ecommerce' ORDER BY created_at LIMIT 1 \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(hospitality.admin_set_extra_managers(%L, 5))$$, :'sm')) IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sm', :OWNER, 'h188d_owner') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sm', :BA, 'h188d_ba') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sm', :MGR, 'h188d_mgr') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sx', :OWNER_X, 'h188d_owner_x') IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_contracts_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_contracts_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sm', :'sx')) IS NOT NULL AS ok \gset
-- the owner appoints the business admin (the only way)
SELECT pg_temp.call(:'sm', :OWNER, format('SELECT hospitality.team_set_business_admin(%L, true)', :BA)) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. The matrix: every permission key, per role (the map the screens get, and the gate the functions use)
-- ============================================================
SELECT tests.check('matrix: 16 permission keys',
  $$SELECT cardinality(hospitality.permissions()) = 16$$);
SELECT tests.check('matrix owner: every key, in the map and at the gate',
  format($$SELECT pg_temp.granted(%1$L, %2$L) = (SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p)
             AND pg_temp.gated(%1$L, %2$L) = (SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p)$$,
         :'sm', :OWNER));
SELECT tests.check('matrix business admin: every key except billing.manage and ownership — map and gate agree',
  format($$SELECT pg_temp.granted(%1$L, %2$L) = (SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p
                                                   WHERE p NOT IN ('billing.manage', 'ownership'))
             AND pg_temp.gated(%1$L, %2$L) = pg_temp.granted(%1$L, %2$L)$$,
         :'sm', :BA));
SELECT tests.check('matrix business admin: billing.manage and ownership refused at the gate',
  format($$SELECT NOT pg_temp.gate(%1$L, %2$L, 'billing.manage') AND NOT pg_temp.gate(%1$L, %2$L, 'ownership')$$,
         :'sm', :BA));
SELECT tests.check('matrix regular manager: day-to-day keys only (no team, finance, documents, privacy, owner settings, billing, ownership) — map and gate agree',
  format($$SELECT NOT (pg_temp.granted(%1$L, %2$L) && ARRAY['staff.managers', 'billing.manage', 'ownership', 'reports.finance',
                                                         'contracts', 'guests.privacy', 'settings.owner', 'catalog.owner'])
             AND 'bookings' = ANY (pg_temp.granted(%1$L, %2$L))
             AND pg_temp.gated(%1$L, %2$L) = pg_temp.granted(%1$L, %2$L)$$,
         :'sm', :MGR));
SELECT tests.check('matrix super admin (platform): every key in any business, without a role there',
  format($$SELECT pg_temp.granted(%1$L, %3$L) = (SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p)
             AND pg_temp.gated(%2$L, %3$L) = (SELECT array_agg(p ORDER BY p) FROM unnest(hospitality.permissions()) p)$$,
         :'sm', :'sx', :PLATFORM));

-- ============================================================
-- 2. The business admin does the business: every management screen's data, and real changes
-- ============================================================
SELECT tests.check('business admin: every staff screen loads (bookings, dashboard, tasks, channels, payments, terms, catalog, room types, packages, contracts, media, pricing, settings, site editor, documents, support, entitlements, team)',
  format($$SELECT bool_and(pg_temp.err(%L, %L, 'SELECT to_jsonb(hospitality.' || f || ')') IS NULL)
          FROM unnest(ARRAY['blocks_upcoming()', 'dashboard()', 'channels_view()', 'dashboard_today()', 'dashboard_tasks()',
                            'payment_proofs_waiting()', 'business_terms_view()', 'catalog_view()', 'room_types_view()',
                            'packages_view()', 'contracts_view()', 'contracts_unseen()', 'media_galleries()', 'pricing_view()',
                            'my_entitlements()', 'settings_view()', 'site_preview()', 'site_editor()', 'support_list()',
                            'support_unread()', 'setup_guide()', 'payment_settings_view()', 'site_documents_view()',
                            'team_members()', 'team_activity()']) f$$,
         :'sm', :BA));
-- the actions first, each in its own statement (an AND in one query is evaluated in any order)
SELECT COALESCE(pg_temp.err(:'sm', :BA, 'SELECT to_jsonb(hospitality.settings_set_shabbat(true))'), '') AS shabbat_err \gset
SELECT COALESCE(pg_temp.err(:'sm', :BA, $q$SELECT hospitality.property_create('{"name": "מתחם המטריצה", "property_type": "zimmer_complex", "status": "active"}')$q$), '') AS property_err \gset
SELECT tests.check('business admin: a real change in settings (Shabbat badge) and in the catalog (a new property), both logged under their name',
  format($$SELECT %3$L = '' AND %4$L = ''
             AND EXISTS (SELECT 1 FROM hospitality.properties WHERE tenant_id = %1$L AND name = 'מתחם המטריצה')
             AND (SELECT array_agg(action ORDER BY action) FROM hospitality.audit_log WHERE tenant_id = %1$L AND actor_id = %2$L)
                 = ARRAY['catalog.property_created', 'settings.shabbat_on']$$,
         :'sm', :BA, :'shabbat_err', :'property_err'));
SELECT tests.check('business admin: the regular manager is still refused the owner-level screens (team, documents)',
  format($$SELECT pg_temp.err(%1$L, %2$L, 'SELECT to_jsonb(hospitality.team_members())') LIKE '%%הרשאה%%'
             AND pg_temp.err(%1$L, %2$L, 'SELECT to_jsonb(hospitality.contracts_view())') IS NOT NULL$$,
         :'sm', :MGR));

-- ============================================================
-- 3. The business admin and other businesses: nothing
-- ============================================================
SELECT tests.check('business admin on business X (no role there): every permission refused at the gate, no screen loads',
  format($$SELECT pg_temp.gated(%1$L, %2$L) IS NULL
             AND pg_temp.err(%1$L, %2$L, 'SELECT hospitality.management_context()') IS NOT NULL
             AND bool_and(pg_temp.err(%1$L, %2$L, 'SELECT to_jsonb(hospitality.' || f || ')') IS NOT NULL)
          FROM unnest(ARRAY['dashboard()', 'catalog_view()', 'contracts_view()', 'settings_view()', 'team_members()',
                            'team_activity()', 'pricing_view()']) f$$,
         :'sx', :BA));
SELECT tests.check('business admin: cannot touch X''s team even by naming X''s people from M''s address',
  format($$SELECT pg_temp.err(%1$L, %2$L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %3$L)) IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %4$L AND user_id = %3$L)$$,
         :'sm', :BA, :OWNER_X, :'sx'));
SELECT tests.check('business admin: no store (Ecommerce) access — not staff there',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(public.staff_can(''admin''))') = 'false'::jsonb$$,
         :'store', :BA));

-- ============================================================
-- 4. The business admin and Super Admin actions: every platform function refused
-- ============================================================
SELECT tests.check('business admin: every platform (Super Admin) function refused — open / create / delete businesses, owners, plans, seats, subscriptions, flags, admins, payments, support desk',
  format($$SELECT bool_and(pg_temp.err(%L, %L, s) IS NOT NULL)
          FROM unnest(ARRAY[
            $q$SELECT to_jsonb(hospitality.admin_create_site('h188d-evil', 'x'))$q$,
            $q$SELECT to_jsonb(hospitality.admin_open_site('h188d-evil2', 'x', 'evil@test.local', NULL, NULL))$q$,
            $q$SELECT to_jsonb(hospitality.admin_sites())$q$,
            $q$SELECT to_jsonb(hospitality.admin_overview())$q$,
            $q$SELECT to_jsonb(hospitality.admin_site_stats())$q$,
            $q$SELECT to_jsonb(hospitality.admin_plans())$q$,
            $q$SELECT to_jsonb(hospitality.admin_platform_flags())$q$,
            $q$SELECT to_jsonb(hospitality.admin_site_switches())$q$,
            $q$SELECT to_jsonb(hospitality.admin_site_requests())$q$,
            $q$SELECT to_jsonb(hospitality.admin_support_tickets(NULL, NULL, NULL, NULL, NULL, NULL, 10, 0))$q$,
            format($q$SELECT to_jsonb(hospitality.admin_set_extra_managers(%%L, 50))$q$, %L),
            format($q$SELECT to_jsonb(hospitality.admin_set_owner(%%L, 'h188d.ba@test.local', NULL))$q$, %L),
            format($q$SELECT to_jsonb(hospitality.admin_site_theme(%%L, 'luxury'))$q$, %L),
            $q$SELECT to_jsonb(hospitality.admin_save_plan('basic', '{}'::jsonb))$q$,
            $q$SELECT to_jsonb(public.platform_set_flag('hospitality_contracts_enabled', false))$q$,
            format($q$SELECT to_jsonb(public.platform_set_flag('hospitality_contracts_enabled', false, %%L))$q$, %L),
            format($q$SELECT to_jsonb(public.platform_delete_tenant(%%L, 'h188d-x'))$q$, %L),
            format($q$SELECT to_jsonb(public.platform_extend_trial(%%L, 365))$q$, %L),
            format($q$SELECT to_jsonb(public.platform_grant_addon(%%L, 'ai_assistant'))$q$, %L),
            $q$SELECT to_jsonb(public.platform_add_admin('h188d.ba@test.local'))$q$]) s$$,
         :'sm', :BA, :'sm', :'sm', :'sm', :'sm', :'sx', :'sm', :'sm'));
SELECT tests.check('business admin: the platform list of businesses returns nothing (no error, no rows)',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM public.platform_list_tenants()') = '0'::jsonb$$,
         :'sm', :BA));
SELECT tests.check('business admin: nothing changed by those attempts (businesses, owner, seats, flags, platform admins)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug IN ('h188d-evil', 'h188d-evil2'))
             AND EXISTS (SELECT 1 FROM public.tenants WHERE id = %1$L)
             AND NOT public.is_platform_admin(%3$L)
             AND (SELECT is_protected FROM public.user_roles WHERE tenant_id = %2$L AND user_id = %4$L)
             AND NOT (SELECT is_protected FROM public.user_roles WHERE tenant_id = %2$L AND user_id = %3$L)
             AND public.platform_feature_enabled('hospitality_contracts_enabled', %2$L)$$,
         :'sx', :'sm', :BA, :OWNER));

-- ============================================================
-- 5. Super Admin over the business admin role
-- ============================================================
SELECT COALESCE(pg_temp.err(:'sm', :PLATFORM, format('SELECT hospitality.team_set_business_admin(%L, false)', :BA)), '') AS revoke_err \gset
SELECT tests.check('super admin: can revoke a business admin in any business — at once',
  format($$SELECT %3$L = '' AND NOT pg_temp.gate(%1$L, %2$L, 'staff.managers')
             AND NOT EXISTS (SELECT 1 FROM hospitality.staff_grants WHERE tenant_id = %1$L AND user_id = %2$L)$$,
         :'sm', :BA, :'revoke_err'));
SELECT COALESCE(pg_temp.err(:'sm', :PLATFORM, format('SELECT hospitality.team_set_business_admin(%L, true)', :BA)), '') AS grant_err \gset
SELECT tests.check('super admin: can appoint a business admin in any business; every change logged',
  format($$SELECT %3$L = '' AND pg_temp.gate(%1$L, %2$L, 'staff.managers')
             AND (SELECT array_agg(action ORDER BY id) FROM hospitality.audit_log WHERE tenant_id = %1$L
                   AND action IN ('team.business_admin_granted', 'team.business_admin_revoked'))
                 = ARRAY['team.business_admin_granted', 'team.business_admin_revoked', 'team.business_admin_granted']$$,
         :'sm', :BA, :'grant_err'));
SELECT tests.check('regular manager: cannot appoint anyone (not even themselves)',
  format($$SELECT pg_temp.err(%1$L, %2$L, format('SELECT hospitality.team_set_business_admin(%%L, true)', %2$L)) LIKE '%%הרשאה%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.staff_grants WHERE tenant_id = %1$L AND user_id = %2$L
                              AND permission = 'business.admin')$$,
         :'sm', :MGR));

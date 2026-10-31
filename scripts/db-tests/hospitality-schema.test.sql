-- ============================================================
-- Hospitality: schema, roles, permissions, RLS, flags, media bucket, site creation
-- (Hospitality Stage 1c — 20261101110000_hosp_schema.sql)
-- Layers: DB triggers/constraints (as postgres), RPC (functions called as the user),
-- RLS (table access as anon / authenticated with the site's x-tenant-id header).
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set ECOM_OWNER_A '''a0000000-0000-0000-0000-0000000000a1'''
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set H_OWNER_A '''a0000000-0000-0000-0000-0000000001d1'''
\set H_MANAGER_A '''a0000000-0000-0000-0000-0000000001d2'''
\set H_OWNER_B '''a0000000-0000-0000-0000-0000000001d3'''
\set GUEST '''a0000000-0000-0000-0000-0000000001d4'''
\set DUAL '''a0000000-0000-0000-0000-0000000001d5'''
\set ECOM_CUSTOMER '''a0000000-0000-0000-0000-0000000001d6'''
\set H_BLOCKED_B '''a0000000-0000-0000-0000-0000000001d7'''
\set H_OWNER_C '''a0000000-0000-0000-0000-0000000001d8'''
\set SHOP_E '''71c10000-0000-0000-0000-0000000000e1'''

-- run as a user on a site (x-tenant-id header), like a request through the API
CREATE OR REPLACE FUNCTION pg_temp.run_at(_site text, _name text, _sql text, _uid uuid,
                                          _err text DEFAULT NULL, _rows int DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM tests.run(_name, _sql, _uid, _err, _rows);
  PERFORM set_config('request.headers', '', true);
END $f$;

-- an error raised at the database level (as postgres: triggers and constraints only)
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000001d1', 'h.owner.a@test.local'),
  ('a0000000-0000-0000-0000-0000000001d2', 'h.manager.a@test.local'),
  ('a0000000-0000-0000-0000-0000000001d3', 'h.owner.b@test.local'),
  ('a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local'),
  ('a0000000-0000-0000-0000-0000000001d5', 'h.dual@test.local'),
  ('a0000000-0000-0000-0000-0000000001d6', 'h.ecom.customer@test.local'),
  ('a0000000-0000-0000-0000-0000000001d7', 'h.blocked.b@test.local'),
  ('a0000000-0000-0000-0000-0000000001d8', 'h.owner.c@test.local')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1. Structure
-- ============================================================
CREATE TEMP TABLE hc_tables(name text, perm text);
INSERT INTO hc_tables VALUES
  ('settings', 'settings'), ('policies', 'policies'), ('properties', 'catalog'), ('units', 'catalog'),
  ('unit_members', 'catalog'), ('unit_beds', 'catalog'), ('amenities', 'catalog'),
  ('unit_amenities', 'catalog'), ('media', 'media'), ('rate_rules', 'pricing'), ('promotions', 'pricing');

SELECT tests.check('schema: the hospitality schema holds the 11 Stage 1c tables (later stages add their own)',
  $$SELECT count(*) = 11 FROM pg_class c JOIN hc_tables t ON t.name = c.relname
     WHERE c.relnamespace = 'hospitality'::regnamespace AND c.relkind = 'r'$$);
SELECT tests.check('schema: RLS is enabled on every Hospitality table',
  $$SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN hc_tables t ON t.name = c.relname
     WHERE c.relnamespace = 'hospitality'::regnamespace$$);
SELECT tests.check('schema: every table has RESTRICTIVE tenant_isolation on the request tenant',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'hospitality' AND p.tablename = t.name
         AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE'
         AND p.qual LIKE '%tenant_id = ( SELECT current_tenant_id()%'
         AND p.with_check LIKE '%tenant_id = ( SELECT current_tenant_id()%'))$$);
SELECT tests.check('schema: every table has RESTRICTIVE backend_enabled (feature flag)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t WHERE NOT EXISTS (
      SELECT 1 FROM pg_policies p WHERE p.schemaname = 'hospitality' AND p.tablename = t.name
         AND p.policyname = 'backend_enabled' AND p.permissive = 'RESTRICTIVE'
         AND p.qual LIKE '%hospitality.flag(''hospitality_backend_enabled''%'
         AND p.with_check LIKE '%hospitality.flag(''hospitality_backend_enabled''%'))$$);
SELECT tests.check('schema: the only PERMISSIVE policy per table is staff, gated by can(<its permission>)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t WHERE
      (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'hospitality' AND p.tablename = t.name
          AND p.permissive = 'PERMISSIVE') <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'hospitality' AND p.tablename = t.name
          AND p.policyname = 'staff' AND p.permissive = 'PERMISSIVE' AND p.roles = '{authenticated}'
          AND p.qual LIKE '%hospitality.can(''' || t.perm || '''%'
          AND p.with_check LIKE '%hospitality.can(''' || t.perm || '''%'))$$);
SELECT tests.check('schema: anon and PUBLIC have no privilege on any Hospitality table',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
      WHERE has_table_privilege('anon', 'hospitality.' || t.name, pr))
     AND NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'hospitality' AND g.grantee = 'PUBLIC')$$);
SELECT tests.check('schema: authenticated has no TRUNCATE / REFERENCES / TRIGGER on Hospitality tables',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t, unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) pr
      WHERE has_table_privilege('authenticated', 'hospitality.' || t.name, pr))$$);
SELECT tests.check('schema: every table has the tenant guard trigger (row belongs to a Hospitality site)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE c.relnamespace = 'hospitality'::regnamespace AND c.relname = t.name AND tg.tgname = 'tenant_guard'))$$);
SELECT tests.check('schema: every Hospitality table references public.tenants with ON DELETE CASCADE',
  $$SELECT NOT EXISTS (SELECT 1 FROM hc_tables t WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint k
       WHERE k.conrelid = ('hospitality.' || t.name)::regclass AND k.contype = 'f'
         AND k.confrelid = 'public.tenants'::regclass AND k.confdeltype = 'c'))$$);
SELECT tests.check('schema: no Hospitality function is executable by PUBLIC',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
      AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)))$$);
SELECT tests.check('schema: of the Stage 1c functions anon can execute only request_tenant()',
  $$SELECT array_agg(p.proname::text) = ARRAY['request_tenant'] FROM pg_proc p
     WHERE p.pronamespace = 'hospitality'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname IN ('flag', 'flag_for', 'permissions', 'can', 'request_tenant', 'tenant_guard', 'touch_updated_at',
                         'settings_validate', 'policies_validate', 'policies_default_guard', 'unit_members_validate',
                         'units_membership_guard', 'admin_create_site')$$);
SELECT tests.check('schema: every SECURITY DEFINER function pins search_path to empty',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
      AND p.prosecdef AND NOT ('search_path=""' = ANY (COALESCE(p.proconfig, '{}'))))$$);
SELECT tests.check('schema: trigger functions are not callable by API roles',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
      AND p.prorettype = 'trigger'::regtype
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')))$$);

-- flags
SELECT tests.check('flags: the five Hospitality keys are registered, all off',
  $$SELECT count(*) = 5 AND bool_and(NOT enabled) FROM public.platform_feature_flags
     WHERE key IN ('hospitality_backend_enabled', 'hospitality_frontend_enabled', 'hospitality_onboarding_enabled',
                   'hospitality_themes_enabled', 'hospitality_booking_enabled')$$);

-- ============================================================
-- 2. Product-role registry (database level)
-- ============================================================
SELECT tests.check('roles: Hospitality registers only admin (owner / manager)',
  $$SELECT array_agg(role) = ARRAY['admin'] FROM public.platform_product_roles WHERE product = 'hospitality'$$);
SELECT tests.check('roles: the Ecommerce registration is unchanged (5 roles)',
  $$SELECT array_agg(role ORDER BY role) = ARRAY['admin','agent','cashier','customer','warehouse']
      FROM public.platform_product_roles WHERE product = 'ecommerce'$$);
-- permission and membership functions of Ecommerce / the platform are byte-for-byte unchanged
-- (hashes of the bodies before this migration; migration 3 defines nothing in public)
SELECT tests.check('roles: store permission and membership functions are unchanged',
  $$SELECT count(*) = 8 AND bool_and(md5(prosrc) = CASE proname
        WHEN 'current_tenant_id' THEN '0be1396f2cc9d476f03a8975a19c2833'
        WHEN 'is_admin' THEN '60c13660d812725d03ac1ab01f99c3c9'
        WHEN 'is_super_admin' THEN 'dc96c98109094de37e687df0b5cb215d'
        WHEN 'staff_can' THEN '7f0dc33ba1d7e031c430ac22e9eeed44'
        WHEN 'store_staff_role' THEN '288aff3ff585456fdd3ace428227033a'
        WHEN 'user_roles_membership_guard' THEN '9ccf1352f00bf7cc34a6f324e876b1cb'
        WHEN 'user_roles_owner_guard' THEN '2a64aaa92ae7a36901bdf1e04b84a13c'
        WHEN 'user_roles_product_role_guard' THEN '858b548c1ab63e66d05c9cfe5796bc2d' END)
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname IN ('current_tenant_id', 'is_admin', 'is_super_admin', 'staff_can', 'store_staff_role',
                       'user_roles_membership_guard', 'user_roles_owner_guard', 'user_roles_product_role_guard')$$);

-- ============================================================
-- 3. Sites: created by the platform admin (RPC)
-- ============================================================
SELECT pg_temp.run_at(NULL, 'admin_create_site: anon cannot call it',
  $$SELECT hospitality.admin_create_site('hc1c-anon', 'x')$$, NULL, 'permission denied');
SELECT pg_temp.run_at(NULL, 'admin_create_site: a store owner (not platform admin) is refused',
  $$SELECT hospitality.admin_create_site('hc1c-nope', 'x')$$, :ECOM_OWNER_A, 'רק מנהל הפלטפורמה');
SELECT pg_temp.run_at(NULL, 'admin_create_site: platform admin creates site A',
  $$SELECT hospitality.admin_create_site('hc1c-a', 'צימרים A', 'h.owner.a@test.local')$$, :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(NULL, 'admin_create_site: platform admin creates site B',
  $$SELECT hospitality.admin_create_site('hc1c-b', 'צימרים B')$$, :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(NULL, 'admin_create_site: platform admin creates site C (flags stay off)',
  $$SELECT hospitality.admin_create_site('hc1c-c', 'צימרים C')$$, :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(NULL, 'admin_create_site: a taken address is refused',
  $$SELECT hospitality.admin_create_site('hc1c-a', 'שוב')$$, :PLATFORM, 'תפוס');
SELECT pg_temp.run_at(NULL, 'admin_create_site: an invalid owner email is refused',
  $$SELECT hospitality.admin_create_site('hc1c-bad-mail', 'x', 'not-an-email')$$, :PLATFORM, 'אימייל');

SELECT quote_literal(id) AS hosp_a FROM public.tenants WHERE slug = 'hc1c-a' \gset
SELECT quote_literal(id) AS hosp_b FROM public.tenants WHERE slug = 'hc1c-b' \gset
SELECT quote_literal(id) AS hosp_c FROM public.tenants WHERE slug = 'hc1c-c' \gset

SELECT tests.check('admin_create_site: the site is a Hospitality site with the owner email',
  format($$SELECT site_type = 'hospitality' AND owner_email = 'h.owner.a@test.local' FROM public.tenants WHERE id = %s$$, :'hosp_a'));
SELECT tests.check('admin_create_site: shared platform settings created (site_settings, email_settings)',
  format($$SELECT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = %1$s)
          AND EXISTS (SELECT 1 FROM public.email_settings WHERE tenant_id = %1$s)$$, :'hosp_a'));
SELECT tests.check('admin_create_site: no Ecommerce seed (shipping methods, store subscription)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.shipping_methods WHERE tenant_id = %1$s)
          AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = %1$s)$$, :'hosp_a'));
SELECT tests.check('admin_create_site: Hospitality settings row with the business name and contact email',
  format($$SELECT business_name = 'צימרים A' AND contact_email = 'h.owner.a@test.local' AND booking_mode = 'request'
            AND approval_window_minutes = 720 AND max_open_requests = 2
          FROM hospitality.settings WHERE tenant_id = %s$$, :'hosp_a'));
SELECT tests.check('admin_create_site: exactly one default cancellation policy (editable template, version 1)',
  format($$SELECT count(*) = 1 AND bool_and(is_default AND version = 1) FROM hospitality.policies WHERE tenant_id = %s$$, :'hosp_a'));
SELECT tests.check('admin_create_site: the creation is in the platform audit log',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %s AND action = 'site_created'
            AND actor_id = 'a0000000-0000-0000-0000-0000000000f0' AND details ->> 'site_type' = 'hospitality')$$, :'hosp_a'));
SELECT tests.check('admin_create_site: no feature flag is turned on for the new site',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE tenant_id = %s AND enabled)$$, :'hosp_a'));

-- members (the first admin of a site becomes its protected owner, as in stores)
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:hosp_a, :H_OWNER_A, 'h.owner.a@test.local', 'h_owner_a', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:hosp_a, :H_MANAGER_A, 'h.manager.a@test.local', 'h_manager_a', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:hosp_b, :H_OWNER_B, 'h.owner.b@test.local', 'h_owner_b', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_blocked) VALUES
  (:hosp_b, :H_BLOCKED_B, 'h.blocked.b@test.local', 'h_blocked_b', 'admin', true, true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:hosp_c, :H_OWNER_C, 'h.owner.c@test.local', 'h_owner_c', 'admin', true);
-- an Ecommerce store with an owner who is also a manager of site A, and a customer
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP_E, 'hc1c-shop', 'חנות 1c');
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:SHOP_E, :DUAL, 'h.dual@test.local', 'h_dual_e', 'admin', true),
  (:SHOP_E, :ECOM_CUSTOMER, 'h.ecom.customer@test.local', 'h_customer_e', 'customer', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:hosp_a, :DUAL, 'h.dual@test.local', 'h_dual_a', 'admin', true);

SELECT tests.check('roles: the first admin of a Hospitality site is its protected owner, the second a manager',
  format($$SELECT (SELECT is_protected FROM public.user_roles WHERE tenant_id = %1$s AND user_id = 'a0000000-0000-0000-0000-0000000001d1')
          AND NOT (SELECT is_protected FROM public.user_roles WHERE tenant_id = %1$s AND user_id = 'a0000000-0000-0000-0000-0000000001d2')$$, :'hosp_a'));

-- rejected roles on a Hospitality site (trigger, whoever writes)
SELECT pg_temp.expect_error('roles: Hospitality site rejects customer',
  format($$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role) VALUES (%s, 'a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local', 'h_guest_x', 'customer')$$, :'hosp_a'),
  'התפקיד customer לא קיים באתר מסוג hospitality');
SELECT pg_temp.expect_error('roles: Hospitality site rejects agent',
  format($$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role) VALUES (%s, 'a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local', 'h_guest_x', 'agent')$$, :'hosp_a'),
  'התפקיד agent לא קיים');
SELECT pg_temp.expect_error('roles: Hospitality site rejects cashier',
  format($$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role) VALUES (%s, 'a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local', 'h_guest_x', 'cashier')$$, :'hosp_a'),
  'התפקיד cashier לא קיים');
SELECT pg_temp.expect_error('roles: Hospitality site rejects warehouse',
  format($$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role) VALUES (%s, 'a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local', 'h_guest_x', 'warehouse')$$, :'hosp_a'),
  'התפקיד warehouse לא קיים');
SELECT pg_temp.expect_error('roles: a Hospitality manager cannot be changed to a store role',
  format($$UPDATE public.user_roles SET role = 'cashier' WHERE tenant_id = %s AND user_id = 'a0000000-0000-0000-0000-0000000001d2'$$, :'hosp_a'),
  'התפקיד cashier לא קיים');
-- the API path: a logged-in guest tries to register as a customer of the site (store sign-up policy)
SELECT pg_temp.run_at(:hosp_a, 'roles: a guest cannot self-register as a customer of a Hospitality site (API)',
  $$INSERT INTO public.user_roles (user_id, email, username, role, is_approved, is_blocked)
    VALUES ('a0000000-0000-0000-0000-0000000001d4', 'h.guest@test.local', 'h_guest_self', 'customer', false, false)$$,
  :GUEST, 'לא קיים באתר מסוג hospitality');
SELECT tests.check('roles: the guest has no membership anywhere',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000001d4')$$);
-- Ecommerce stores keep every role
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:SHOP_E, :GUEST, 'h.guest@test.local', 'h_guest_e_agent', 'agent', true);
SELECT tests.check('roles: an Ecommerce store still accepts store roles (agent, customer)',
  format($$SELECT count(*) = 2 FROM public.user_roles WHERE tenant_id = %s AND role IN ('agent', 'customer')$$, :'SHOP_E'));
DELETE FROM public.user_roles WHERE tenant_id = :SHOP_E AND user_id = :GUEST;

-- ============================================================
-- 4. Permissions: hospitality.can() (RPC, as the user, on a site)
-- ============================================================
-- Stage 2a (migration 7) added guests.privacy (guest export / anonymise, owner only): 11 permissions
SELECT tests.check('can: the permission list is the Hospitality list (11 permissions)',
  $$SELECT cardinality(hospitality.permissions()) = 11$$);
SELECT pg_temp.run_at(:hosp_a, 'can: owner has every Hospitality permission',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :H_OWNER_A, NULL, 11);
SELECT pg_temp.run_at(:hosp_a, 'can: manager has all but staff.managers, billing.manage and guests.privacy',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :H_MANAGER_A, NULL, 8);
SELECT pg_temp.run_at(:hosp_a, 'can: manager lacks exactly staff.managers, billing.manage and guests.privacy',
  $$SELECT 1 FROM unnest(ARRAY['staff.managers', 'billing.manage', 'guests.privacy']) p WHERE NOT hospitality.can(p)$$, :H_MANAGER_A, NULL, 3);
SELECT pg_temp.run_at(:hosp_a, 'can: owner gets no Ecommerce or unknown permission (pos, admin, products.view, inventory)',
  $$SELECT 1 FROM unnest(ARRAY['pos', 'admin', 'products.view', 'inventory', 'orders.fulfill', '', 'catalog ']) p
     WHERE hospitality.can(p)$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: a guest (no membership) has no permission',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :GUEST, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: an Ecommerce store owner has no permission on a Hospitality site',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :ECOM_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: an Ecommerce customer has no permission on a Hospitality site',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :ECOM_CUSTOMER, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: the owner of another Hospitality site has no permission here',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :H_OWNER_B, NULL, 0);
SELECT pg_temp.run_at(:hosp_b, 'can: a blocked admin has no permission',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :H_BLOCKED_B, NULL, 0);
SELECT pg_temp.run_at(:STORE_A, 'can: no Hospitality permission on an Ecommerce store, even for its owner',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :ECOM_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:SHOP_E, 'can: a member of both products gets nothing on the store host',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :DUAL, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: a member of both products is a manager on the Hospitality host',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :DUAL, NULL, 8);
SELECT pg_temp.run_at(NULL, 'can: a member of both products without a site header gets nothing',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :DUAL, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'can: the platform admin is owner (as in stores)',
  $$SELECT 1 FROM unnest(hospitality.permissions()) p WHERE hospitality.can(p)$$, :PLATFORM, NULL, 11);
SELECT pg_temp.run_at(:hosp_a, 'can: anon cannot call it',
  $$SELECT hospitality.can('catalog')$$, NULL, 'permission denied');

-- Ecommerce membership → no Ecommerce reach outside its store; Hospitality membership → no store data
SELECT pg_temp.run_at(:STORE_A, 'cross-product: a Hospitality owner on a store host has no store role',
  $$SELECT 1 WHERE public.store_staff_role() IS NULL AND NOT public.staff_can('admin')$$, :H_OWNER_A, NULL, 1);
SELECT pg_temp.run_at(:STORE_A, 'cross-product: a Hospitality owner sees no store orders / customers on a store host',
  $$SELECT 1 FROM public.orders UNION ALL SELECT 1 FROM public.customer_profiles UNION ALL SELECT 1 FROM public.user_roles$$,
  :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'cross-product: a Hospitality owner cannot create store data on their own site (engine guard)',
  format($$INSERT INTO public.shipping_methods (tenant_id, name, kind, price) VALUES (%s, 'משלוח בדיקה', 'pickup', 0)$$, :'hosp_a'),
  :H_OWNER_A, 'שייכת למנוע החנויות');
SELECT pg_temp.run_at(:hosp_a, 'cross-product: a Hospitality owner sees no store data on their own site',
  $$SELECT 1 FROM public.orders UNION ALL SELECT 1 FROM public.shipping_methods UNION ALL SELECT 1 FROM public.categories$$,
  :H_OWNER_A, NULL, 0);

-- ============================================================
-- 5. Data (as postgres) and feature flags
-- ============================================================
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  ('71c20000-0000-0000-0000-0000000000a1', :hosp_a, 'מתחם A', 'mitham-a', 'active'),
  ('71c20000-0000-0000-0000-0000000000a2', :hosp_a, 'מתחם A2', 'mitham-a2', 'draft'),
  ('71c20000-0000-0000-0000-0000000000b1', :hosp_b, 'מתחם B', 'mitham-b', 'active'),
  ('71c20000-0000-0000-0000-0000000000c1', :hosp_c, 'מתחם C', 'mitham-c', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  ('71c30000-0000-0000-0000-0000000000a1', :hosp_a, '71c20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 1', 'zimmer-1', 4, 2, 800),
  ('71c30000-0000-0000-0000-0000000000a2', :hosp_a, '71c20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 2', 'צימר-2', 4, 2, 900),
  ('71c30000-0000-0000-0000-0000000000aa', :hosp_a, '71c20000-0000-0000-0000-0000000000a1', 'whole_property', 'כל המתחם', 'kol-hamitham', 8, 4, 1600),
  ('71c30000-0000-0000-0000-0000000000a3', :hosp_a, '71c20000-0000-0000-0000-0000000000a2', 'unit', 'סוויטה', 'suite', 2, 2, 1200),
  ('71c30000-0000-0000-0000-0000000000b1', :hosp_b, '71c20000-0000-0000-0000-0000000000b1', 'unit', 'צימר B', 'zimmer-b', 2, 2, 700),
  ('71c30000-0000-0000-0000-0000000000c1', :hosp_c, '71c20000-0000-0000-0000-0000000000c1', 'unit', 'צימר C', 'zimmer-c', 2, 2, 700);
INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES
  (:hosp_a, '71c30000-0000-0000-0000-0000000000aa', '71c30000-0000-0000-0000-0000000000a1'),
  (:hosp_a, '71c30000-0000-0000-0000-0000000000aa', '71c30000-0000-0000-0000-0000000000a2');
INSERT INTO hospitality.amenities (id, tenant_id, name, icon) VALUES
  ('71c40000-0000-0000-0000-0000000000a1', :hosp_a, 'ג׳קוזי', 'jacuzzi'),
  ('71c40000-0000-0000-0000-0000000000b1', :hosp_b, 'ג׳קוזי', 'jacuzzi');
INSERT INTO hospitality.unit_amenities (tenant_id, amenity_id, unit_id) VALUES
  (:hosp_a, '71c40000-0000-0000-0000-0000000000a1', '71c30000-0000-0000-0000-0000000000a1');
INSERT INTO hospitality.unit_beds (tenant_id, unit_id, bed_type, quantity) VALUES
  (:hosp_a, '71c30000-0000-0000-0000-0000000000a1', 'double', 1);
INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, storage_path, is_cover) VALUES
  (:hosp_a, 'unit', '71c30000-0000-0000-0000-0000000000a1', 'image', trim(both '''' from :'hosp_a') || '/units/z1.jpg', true);
INSERT INTO hospitality.rate_rules (tenant_id, name, kind, days_mask, price_mode, value) VALUES
  (:hosp_a, 'סוף שבוע', 'weekend', 48, 'fixed', 1100);
INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES
  (:hosp_a, 'קופון', 'SUMMER10', 'percent', 10),
  (:hosp_b, 'קופון', 'SUMMER10', 'percent', 10);

SELECT pg_temp.run_at(:hosp_a, 'flags: with every flag off, even the owner sees no rows',
  $$SELECT 1 FROM hospitality.units$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'flags: with every flag off, the owner cannot insert',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'בריכה')$$, :'hosp_a'),
  :H_OWNER_A, 'row-level security');
-- turn the backend on: platform-wide, and for sites A and B only (platform admin, audited)
SELECT pg_temp.run_at(NULL, 'flags: platform admin enables hospitality_backend_enabled for the platform',
  $$SELECT public.platform_set_flag('hospitality_backend_enabled', true)$$, :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'flags: platform on, site flag off → still closed',
  $$SELECT 1 FROM hospitality.units$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(NULL, 'flags: platform admin enables the backend for site A',
  format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true, %s)$$, :'hosp_a'), :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(NULL, 'flags: platform admin enables the backend for site B',
  format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true, %s)$$, :'hosp_b'), :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(NULL, 'flags: a site owner cannot turn a flag on',
  format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true, %s)$$, :'hosp_c'), :H_OWNER_C, 'רק מנהל הפלטפורמה');
SELECT pg_temp.run_at(NULL, 'flags: setting a Hospitality flag on an Ecommerce store is allowed but has no effect (below)',
  format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true, %s)$$, :'SHOP_E'), :PLATFORM, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'flags: flag() is on for site A (as its owner)',
  $$SELECT 1 WHERE hospitality.flag('hospitality_backend_enabled')$$, :H_OWNER_A, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'flags: other Hospitality flags stay off',
  $$SELECT 1 WHERE hospitality.flag('hospitality_booking_enabled') OR hospitality.flag('hospitality_frontend_enabled')$$,
  :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'flags: flag() refuses non-Hospitality keys',
  $$SELECT 1 WHERE hospitality.flag('google_login') OR hospitality.flag('pf1a_test_flag')$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:SHOP_E, 'flags: flag() is off on an Ecommerce store even when its site flag is set',
  $$SELECT 1 WHERE hospitality.flag('hospitality_backend_enabled')$$, :DUAL, NULL, 0);
SELECT pg_temp.run_at(:hosp_c, 'flags: site C (flag off) — owner sees no rows',
  $$SELECT 1 FROM hospitality.units UNION ALL SELECT 1 FROM hospitality.settings UNION ALL SELECT 1 FROM hospitality.policies$$,
  :H_OWNER_C, NULL, 0);
SELECT pg_temp.run_at(:hosp_c, 'flags: site C (flag off) — owner cannot write',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'בריכה')$$, :'hosp_c'),
  :H_OWNER_C, 'row-level security');
SELECT pg_temp.run_at(:hosp_c, 'flags: site C (flag off) — owner cannot update',
  $$UPDATE hospitality.units SET name = 'x'$$, :H_OWNER_C, NULL, 0);
SELECT tests.check('flags: hospitality.flag_for() is server-only (not executable by authenticated)',
  $$SELECT NOT has_function_privilege('authenticated', 'hospitality.flag_for(text, uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.flag_for(text, uuid)', 'EXECUTE')$$);
SELECT tests.check('flags: flag_for() reads a site flag directly (A on, C off, store E off)',
  format($$SELECT hospitality.flag_for('hospitality_backend_enabled', %s)
          AND NOT hospitality.flag_for('hospitality_backend_enabled', %s)
          AND NOT hospitality.flag_for('hospitality_backend_enabled', %s)$$, :'hosp_a', :'hosp_c', :'SHOP_E'));

-- ============================================================
-- 6. RLS: tenant isolation and roles (flag on for A and B)
-- ============================================================
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A sees the 4 units of site A',
  $$SELECT 1 FROM hospitality.units$$, :H_OWNER_A, NULL, 4);
SELECT pg_temp.run_at(:hosp_a, 'rls: manager A sees the units of site A',
  $$SELECT 1 FROM hospitality.units$$, :H_MANAGER_A, NULL, 4);
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A sees every table of site A only (settings 1, policies 1, promotions 1)',
  $$SELECT 1 FROM hospitality.settings UNION ALL SELECT 1 FROM hospitality.policies
    UNION ALL SELECT 1 FROM hospitality.promotions$$, :H_OWNER_A, NULL, 3);
SELECT pg_temp.run_at(:hosp_b, 'rls: owner A on site B (not a member) sees nothing',
  $$SELECT 1 FROM hospitality.units UNION ALL SELECT 1 FROM hospitality.settings$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_b, 'rls: owner B sees only site B (1 unit)',
  $$SELECT 1 FROM hospitality.units$$, :H_OWNER_B, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A cannot insert a row for site B',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'חדירה')$$, :'hosp_b'), :H_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A cannot update site B rows (0 rows)',
  $$UPDATE hospitality.units SET base_price = 1 WHERE id = '71c30000-0000-0000-0000-0000000000b1'$$, :H_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_b, 'rls: owner B cannot delete site A rows (0 rows)',
  $$DELETE FROM hospitality.promotions WHERE tenant_id <> '00000000-0000-0000-0000-000000000000'$$, :H_OWNER_B, NULL, 1);
SELECT tests.check('rls: site A promotion is still there after owner B deleted "everything"',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.promotions WHERE tenant_id = %s)$$, :'hosp_a'));
INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES (:hosp_b, 'קופון', 'SUMMER10', 'percent', 10);
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A cannot move a row to site B',
  $$UPDATE hospitality.units SET tenant_id = (SELECT id FROM public.tenants WHERE slug = 'hc1c-b')
     WHERE id = '71c30000-0000-0000-0000-0000000000a1'$$, :H_OWNER_A, 'אי אפשר להעביר נתונים בין אתרים');
SELECT pg_temp.run_at(:hosp_a, 'rls: owner A can create, edit and delete catalog rows',
  format($$WITH i AS (INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'בריכה') RETURNING id)
          SELECT 1 FROM i$$, :'hosp_a'), :H_OWNER_A, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'rls: manager A can edit pricing',
  $$UPDATE hospitality.rate_rules SET value = 1150$$, :H_MANAGER_A, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'rls: manager A can edit settings',
  $$UPDATE hospitality.settings SET check_in_time = '14:00'$$, :H_MANAGER_A, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'rls: the owner cannot delete the site settings row',
  $$DELETE FROM hospitality.settings$$, :H_OWNER_A, 'permission denied');
SELECT pg_temp.run_at(:hosp_a, 'rls: the owner cannot create a second settings row',
  format($$INSERT INTO hospitality.settings (tenant_id) VALUES (%s)$$, :'hosp_a'), :H_OWNER_A, 'permission denied');
SELECT pg_temp.run_at(:hosp_a, 'rls: a guest sees no Hospitality rows',
  $$SELECT 1 FROM hospitality.units UNION ALL SELECT 1 FROM hospitality.settings UNION ALL SELECT 1 FROM hospitality.media$$,
  :GUEST, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'rls: a guest cannot write',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'אורח')$$, :'hosp_a'), :GUEST, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'rls: an Ecommerce owner sees no Hospitality rows on the site',
  $$SELECT 1 FROM hospitality.units UNION ALL SELECT 1 FROM hospitality.settings$$, :ECOM_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'rls: an Ecommerce owner cannot write Hospitality rows',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'חנות')$$, :'hosp_a'), :ECOM_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:STORE_A, 'rls: an Ecommerce owner on its own store sees no Hospitality rows',
  $$SELECT 1 FROM hospitality.units UNION ALL SELECT 1 FROM hospitality.settings$$, :ECOM_OWNER_A, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'rls: an Ecommerce customer sees no Hospitality rows',
  $$SELECT 1 FROM hospitality.units$$, :ECOM_CUSTOMER, NULL, 0);
SELECT pg_temp.run_at(:SHOP_E, 'rls: a member of both products sees no Hospitality rows on the store host',
  $$SELECT 1 FROM hospitality.units$$, :DUAL, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'rls: a member of both products sees site A rows on the Hospitality host',
  $$SELECT 1 FROM hospitality.units$$, :DUAL, NULL, 4);
SELECT pg_temp.run_at(:hosp_b, 'rls: a blocked admin sees nothing',
  $$SELECT 1 FROM hospitality.units$$, :H_BLOCKED_B, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'rls: anon has no table access at all',
  $$SELECT 1 FROM hospitality.units$$, NULL, 'permission denied');
SELECT pg_temp.run_at(:hosp_a, 'rls: anon cannot insert',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'אנונימי')$$, :'hosp_a'), NULL, 'permission denied');

-- ============================================================
-- 7. request_tenant() (for guest RPCs in Stage 1d)
-- ============================================================
SELECT pg_temp.run_at(:hosp_a, 'request_tenant: the site header resolves for anon',
  format($$SELECT 1 WHERE hospitality.request_tenant() = %s$$, :'hosp_a'), NULL, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'request_tenant: resolves for a member of another site (unlike current_tenant_id)',
  format($$SELECT 1 WHERE hospitality.request_tenant() = %s AND public.current_tenant_id() IS NULL$$, :'hosp_a'), :H_OWNER_B, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'request_tenant: resolves for an Ecommerce staff member visiting the site',
  format($$SELECT 1 WHERE hospitality.request_tenant() = %s$$, :'hosp_a'), :ECOM_OWNER_A, NULL, 1);
SELECT pg_temp.run_at(:STORE_A, 'request_tenant: NULL on an Ecommerce store',
  $$SELECT 1 WHERE hospitality.request_tenant() IS NULL$$, NULL, NULL, 1);
SELECT pg_temp.run_at(NULL, 'request_tenant: NULL without a header (no default-store fallback)',
  $$SELECT 1 WHERE hospitality.request_tenant() IS NULL AND public.current_tenant_id() IS NOT NULL$$, NULL, NULL, 1);
SELECT pg_temp.run_at('not-a-uuid'' OR 1=1', 'request_tenant: NULL for a malformed header',
  $$SELECT 1 WHERE hospitality.request_tenant() IS NULL$$, NULL, NULL, 1);
SELECT pg_temp.run_at('00000000-0000-0000-0000-000000000000', 'request_tenant: NULL for an unknown site',
  $$SELECT 1 WHERE hospitality.request_tenant() IS NULL$$, NULL, NULL, 1);
UPDATE public.tenants SET status = 'suspended', status_changed_at = now() WHERE id = :hosp_c;
SELECT pg_temp.run_at(:hosp_c, 'request_tenant: NULL for a suspended site',
  $$SELECT 1 WHERE hospitality.request_tenant() IS NULL$$, NULL, NULL, 1);
UPDATE public.tenants SET status = 'active', status_changed_at = now() WHERE id = :hosp_c;

-- ============================================================
-- 8. Database rules (as postgres — apply to every writer, including service_role)
-- ============================================================
SELECT pg_temp.expect_error('guard: a Hospitality row cannot belong to an Ecommerce store',
  format($$INSERT INTO hospitality.amenities (tenant_id, name) VALUES (%s, 'x')$$, :'STORE_A'),
  'שייכת למנוע האירוח ואינה זמינה לאתר מסוג ecommerce');
SELECT pg_temp.expect_error('guard: settings cannot be created for an Ecommerce store',
  format($$INSERT INTO hospitality.settings (tenant_id) VALUES (%s)$$, :'SHOP_E'), 'שייכת למנוע האירוח');
SELECT pg_temp.expect_error('guard: a Hospitality row cannot move to another site',
  format($$UPDATE hospitality.amenities SET tenant_id = %s WHERE id = '71c40000-0000-0000-0000-0000000000a1'$$, :'hosp_b'),
  'אי אפשר להעביר נתונים בין אתרים');
SELECT pg_temp.expect_error('guard: a unit cannot use another site''s property (composite key)',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%s, '71c20000-0000-0000-0000-0000000000a1', 'x', 'x')$$, :'hosp_b'),
  'foreign key');
SELECT pg_temp.expect_error('guard: an amenity link cannot use another site''s amenity',
  format($$INSERT INTO hospitality.unit_amenities (tenant_id, amenity_id, unit_id) VALUES (%s, '71c40000-0000-0000-0000-0000000000a1', '71c30000-0000-0000-0000-0000000000b1')$$, :'hosp_b'),
  'foreign key');

-- units and whole property
SELECT pg_temp.expect_error('units: base occupancy above capacity is rejected',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug, capacity, base_occupancy) VALUES (%s, '71c20000-0000-0000-0000-0000000000a1', 'x', 'x-1', 2, 3)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('units: slug is unique per site',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%s, '71c20000-0000-0000-0000-0000000000a1', 'x', 'zimmer-1')$$, :'hosp_a'),
  'duplicate key');
SELECT pg_temp.expect_error('units: an invalid slug is rejected',
  format($$INSERT INTO hospitality.units (tenant_id, property_id, name, slug) VALUES (%s, '71c20000-0000-0000-0000-0000000000a1', 'x', 'Bad Slug!')$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('whole property: a regular unit cannot contain units',
  format($$INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES (%s, '71c30000-0000-0000-0000-0000000000a1', '71c30000-0000-0000-0000-0000000000a2')$$, :'hosp_a'),
  'רק יחידה מסוג "כל המתחם"');
SELECT pg_temp.expect_error('whole property: members come from the same property',
  format($$INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES (%s, '71c30000-0000-0000-0000-0000000000aa', '71c30000-0000-0000-0000-0000000000a3')$$, :'hosp_a'),
  'היחידה שייכת למתחם אחר');
SELECT pg_temp.expect_error('whole property: a unit cannot contain itself',
  format($$INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES (%s, '71c30000-0000-0000-0000-0000000000aa', '71c30000-0000-0000-0000-0000000000aa')$$, :'hosp_a'),
  'לא יכול להיות חלק');
SELECT pg_temp.expect_error('whole property: a member unit cannot become a whole property',
  $$UPDATE hospitality.units SET kind = 'whole_property' WHERE id = '71c30000-0000-0000-0000-0000000000a1'$$,
  'הסירו את השיוך');
SELECT pg_temp.expect_error('whole property: a member unit cannot move to another property',
  $$UPDATE hospitality.units SET property_id = '71c20000-0000-0000-0000-0000000000a2' WHERE id = '71c30000-0000-0000-0000-0000000000a2'$$,
  'הסירו את השיוך');
UPDATE hospitality.units SET name = 'צימר 1 (שם חדש)' WHERE id = '71c30000-0000-0000-0000-0000000000a1';
SELECT tests.check('whole property: other edits of a member unit are allowed',
  $$SELECT name = 'צימר 1 (שם חדש)' FROM hospitality.units WHERE id = '71c30000-0000-0000-0000-0000000000a1'$$);

-- media
SELECT pg_temp.expect_error('media: a file must be inside the site folder',
  format($$INSERT INTO hospitality.media (tenant_id, kind, storage_path) VALUES (%s, 'image', '%s/x.jpg')$$, :'hosp_a', trim(both '''' from :'hosp_b')),
  'check constraint');
SELECT pg_temp.expect_error('media: path traversal is rejected',
  format($$INSERT INTO hospitality.media (tenant_id, kind, storage_path) VALUES (%1$s, 'image', '%2$s/../x.jpg')$$, :'hosp_a', trim(both '''' from :'hosp_a')),
  'check constraint');
SELECT pg_temp.expect_error('media: an embed needs a provider and an id, and no file',
  format($$INSERT INTO hospitality.media (tenant_id, kind, embed_provider) VALUES (%s, 'embed', 'youtube')$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('media: an unsupported embed provider is rejected',
  format($$INSERT INTO hospitality.media (tenant_id, kind, embed_provider, embed_id) VALUES (%s, 'embed', 'example', 'abcdefgh')$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('media: a demo image needs a licence reference',
  format($$INSERT INTO hospitality.media (tenant_id, kind, storage_path, is_demo) VALUES (%1$s, 'image', '%2$s/demo.jpg', true)$$, :'hosp_a', trim(both '''' from :'hosp_a')),
  'check constraint');
SELECT pg_temp.expect_error('media: one cover per unit',
  format($$INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, storage_path, is_cover) VALUES (%1$s, 'unit', '71c30000-0000-0000-0000-0000000000a1', 'image', '%2$s/units/z1b.jpg', true)$$, :'hosp_a', trim(both '''' from :'hosp_a')),
  'duplicate key');
INSERT INTO hospitality.media (tenant_id, kind, embed_provider, embed_id, owner_kind) VALUES (:hosp_a, 'embed', 'youtube', 'dQw4w9WgXcQ', 'site');
SELECT tests.check('media: a YouTube embed for the site is accepted',
  $$SELECT EXISTS (SELECT 1 FROM hospitality.media WHERE kind = 'embed' AND embed_id = 'dQw4w9WgXcQ')$$);

-- pricing and promotions
SELECT pg_temp.expect_error('rate rules: a season needs dates',
  format($$INSERT INTO hospitality.rate_rules (tenant_id, name, kind, value) VALUES (%s, 'קיץ', 'season', 1000)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('rate rules: the end date must follow the start date',
  format($$INSERT INTO hospitality.rate_rules (tenant_id, name, kind, date_from, date_to, value) VALUES (%s, 'חג', 'holiday', '2026-10-10', '2026-10-10', 1000)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('rate rules: a fixed price cannot be negative',
  format($$INSERT INTO hospitality.rate_rules (tenant_id, name, kind, price_mode, value) VALUES (%s, 'x', 'weekday', 'fixed', -1)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('promotions: a percent above 100 is rejected',
  format($$INSERT INTO hospitality.promotions (tenant_id, name, discount_kind, value) VALUES (%s, 'x', 'percent', 101)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('promotions: coupon codes are unique per site',
  format($$INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES (%s, 'x', 'SUMMER10', 'fixed', 50)$$, :'hosp_a'),
  'duplicate key');
SELECT pg_temp.expect_error('promotions: coupon codes are stored in upper case',
  format($$INSERT INTO hospitality.promotions (tenant_id, name, code, discount_kind, value) VALUES (%s, 'x', 'summer20', 'fixed', 50)$$, :'hosp_a'),
  'check constraint');
SELECT tests.check('promotions: the same code may exist on two sites',
  $$SELECT count(DISTINCT tenant_id) = 2 FROM hospitality.promotions WHERE code = 'SUMMER10'$$);

-- settings
SELECT pg_temp.expect_error('settings: an unknown timezone is rejected',
  format($$UPDATE hospitality.settings SET timezone = 'Mars/Olympus' WHERE tenant_id = %s$$, :'hosp_a'), 'אזור זמן לא מוכר');
SELECT pg_temp.expect_error('settings: an approval window outside 1–48 hours is rejected',
  format($$UPDATE hospitality.settings SET approval_window_minutes = 10 WHERE tenant_id = %s$$, :'hosp_a'), 'check constraint');
SELECT pg_temp.expect_error('settings: an invalid notification email is rejected',
  format($$UPDATE hospitality.settings SET notification_emails = ARRAY['ok@test.local', 'bad'] WHERE tenant_id = %s$$, :'hosp_a'),
  'כתובת אימייל להתראות');
UPDATE hospitality.settings SET notification_emails = ARRAY[' Owner@Test.local ', 'owner@test.local', ''] WHERE tenant_id = :hosp_a;
SELECT tests.check('settings: notification emails are normalised and de-duplicated',
  format($$SELECT notification_emails = ARRAY['owner@test.local'] FROM hospitality.settings WHERE tenant_id = %s$$, :'hosp_a'));

-- cancellation policies (validation, versioning, exactly one default)
SELECT pg_temp.expect_error('policies: tiers must be ordered from far to near',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2, "fee": "full"}, {"from_days": 5, "fee": "full"}]')$$, :'hosp_a'),
  'מסודרות מהרחוקה לקרובה');
SELECT pg_temp.expect_error('policies: a percentage above 100 is rejected',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2, "fee": "percent_total", "value": 120}]')$$, :'hosp_a'),
  'ערך לא תקין');
SELECT pg_temp.expect_error('policies: a negative fixed fee is rejected',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2, "fee": "fixed", "value": -5}]')$$, :'hosp_a'),
  'ערך לא תקין');
SELECT pg_temp.expect_error('policies: an unknown fee type is rejected',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2, "fee": "double"}]')$$, :'hosp_a'),
  'סוג דמי ביטול לא מוכר');
SELECT pg_temp.expect_error('policies: a deposit-based fee needs a deposit',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2, "fee": "deposit"}]')$$, :'hosp_a'),
  'דורשים מקדמה');
SELECT pg_temp.expect_error('policies: a tier cannot start inside the free-cancellation window',
  format($$INSERT INTO hospitality.policies (tenant_id, name, free_cancel_days, fee_tiers) VALUES (%s, 'x', 3, '[{"from_days": 5, "fee": "full"}]')$$, :'hosp_a'),
  'לפני סוף הביטול החינם');
SELECT pg_temp.expect_error('policies: a fractional day count is rejected',
  format($$INSERT INTO hospitality.policies (tenant_id, name, fee_tiers) VALUES (%s, 'x', '[{"from_days": 2.5, "fee": "full"}]')$$, :'hosp_a'),
  'מספר ימים שלם');
SELECT pg_temp.expect_error('policies: a deposit above 100% is rejected',
  format($$INSERT INTO hospitality.policies (tenant_id, name, deposit_kind, deposit_value) VALUES (%s, 'x', 'percent', 150)$$, :'hosp_a'),
  'check constraint');
SELECT pg_temp.expect_error('policies: instant cancellation in the free window needs a free window',
  format($$INSERT INTO hospitality.policies (tenant_id, name, auto_cancel) VALUES (%s, 'x', 'within_free_window')$$, :'hosp_a'),
  'check constraint');
INSERT INTO hospitality.policies (id, tenant_id, name, deposit_kind, deposit_value, free_cancel_days, fee_tiers, no_show_fee)
VALUES ('71c50000-0000-0000-0000-0000000000a2', :hosp_a, 'מחמירה', 'percent', 30, 3,
        '[{"from_days": 3, "fee": "deposit"}, {"from_days": 1, "fee": "full"}]', 'full');
SELECT tests.check('policies: a valid second policy is accepted and is not the default',
  $$SELECT NOT is_default AND version = 1 FROM hospitality.policies WHERE id = '71c50000-0000-0000-0000-0000000000a2'$$);
UPDATE hospitality.policies SET name = 'מחמירה (חגים)' WHERE id = '71c50000-0000-0000-0000-0000000000a2';
SELECT tests.check('policies: renaming does not create a new version',
  $$SELECT version = 1 FROM hospitality.policies WHERE id = '71c50000-0000-0000-0000-0000000000a2'$$);
UPDATE hospitality.policies SET free_cancel_days = 5, version = 99 WHERE id = '71c50000-0000-0000-0000-0000000000a2';
SELECT tests.check('policies: changing a rule bumps the version by one (cannot be set by hand)',
  $$SELECT version = 2 FROM hospitality.policies WHERE id = '71c50000-0000-0000-0000-0000000000a2'$$);
SELECT pg_temp.expect_error('policies: the default cannot be unset directly',
  format($$UPDATE hospitality.policies SET is_default = false WHERE tenant_id = %s AND is_default$$, :'hosp_a'),
  'חייבת להיות מדיניות ברירת מחדל');
SELECT pg_temp.expect_error('policies: the default cannot be deleted',
  format($$DELETE FROM hospitality.policies WHERE tenant_id = %s AND is_default$$, :'hosp_a'),
  'אי אפשר למחוק את מדיניות ברירת המחדל');
SELECT pg_temp.run_at(:hosp_a, 'policies: the owner makes another policy the default (API)',
  $$UPDATE hospitality.policies SET is_default = true WHERE id = '71c50000-0000-0000-0000-0000000000a2'$$, :H_OWNER_A, NULL, 1);
SELECT tests.check('policies: exactly one default after switching',
  format($$SELECT count(*) FILTER (WHERE is_default) = 1
            AND bool_or(is_default AND id = '71c50000-0000-0000-0000-0000000000a2')
          FROM hospitality.policies WHERE tenant_id = %s$$, :'hosp_a'));
SELECT pg_temp.expect_error('policies: the default cannot be archived',
  $$UPDATE hospitality.policies SET is_archived = true WHERE id = '71c50000-0000-0000-0000-0000000000a2'$$, 'check constraint');
SELECT pg_temp.run_at(:hosp_b, 'policies: owner B cannot switch site A''s default',
  $$UPDATE hospitality.policies SET is_default = true WHERE name = 'גמישה'$$, :H_OWNER_B, NULL, 1);
SELECT tests.check('policies: site A still has its own default (B''s switch only touched B)',
  format($$SELECT bool_or(is_default AND id = '71c50000-0000-0000-0000-0000000000a2') AND count(*) FILTER (WHERE is_default) = 1
          FROM hospitality.policies WHERE tenant_id = %s$$, :'hosp_a'));
UPDATE hospitality.units SET policy_id = '71c50000-0000-0000-0000-0000000000a2' WHERE id = '71c30000-0000-0000-0000-0000000000a3';
SELECT pg_temp.expect_error('policies: a unit cannot use another site''s policy',
  format($$UPDATE hospitality.units SET policy_id = (SELECT id FROM hospitality.policies WHERE tenant_id = %s LIMIT 1)
          WHERE id = '71c30000-0000-0000-0000-0000000000a1'$$, :'hosp_b'),
  'foreign key');
-- a site that was not provisioned: its first policy becomes the default
INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71c10000-0000-0000-0000-0000000000d1', 'hc1c-raw', 'גולמי', 'hospitality');
INSERT INTO hospitality.policies (tenant_id, name) VALUES ('71c10000-0000-0000-0000-0000000000d1', 'ראשונה');
SELECT tests.check('policies: the first policy of a site becomes its default',
  $$SELECT is_default FROM hospitality.policies WHERE tenant_id = '71c10000-0000-0000-0000-0000000000d1'$$);
DELETE FROM public.tenants WHERE id = '71c10000-0000-0000-0000-0000000000d1';
SELECT tests.check('policies: deleting a site removes its policies, including the default (cascade)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.policies WHERE tenant_id = '71c10000-0000-0000-0000-0000000000d1')$$);

-- ============================================================
-- 9. Media bucket (storage RLS)
-- ============================================================
SELECT tests.check('storage: hosp-media bucket exists, public, with a size limit and image/video types',
  $$SELECT public AND file_size_limit = 52428800 AND 'video/mp4' = ANY (allowed_mime_types)
           AND 'image/webp' = ANY (allowed_mime_types)
      FROM storage.buckets WHERE id = 'hosp-media'$$);
SELECT pg_temp.run_at(:hosp_a, 'storage: owner A uploads into the site A folder',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/units/z1.jpg')$$, trim(both '''' from :'hosp_a')),
  :H_OWNER_A, NULL, 1);
SELECT pg_temp.run_at(:hosp_a, 'storage: owner A cannot upload into the site B folder',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/x.jpg')$$, trim(both '''' from :'hosp_b')),
  :H_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'storage: owner A cannot upload outside a site folder',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', 'x.jpg')$$, :H_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'storage: a guest cannot upload',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/g.jpg')$$, trim(both '''' from :'hosp_a')),
  :GUEST, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'storage: anon cannot upload',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/a.jpg')$$, trim(both '''' from :'hosp_a')),
  NULL, 'row-level security');
SELECT pg_temp.run_at(:STORE_A, 'storage: an Ecommerce owner cannot upload into hosp-media (own store folder)',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '70000000-0000-0000-0000-00000000000a/x.jpg')$$,
  :ECOM_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:hosp_a, 'storage: an Ecommerce owner cannot upload into a Hospitality site folder',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/e.jpg')$$, trim(both '''' from :'hosp_a')),
  :ECOM_OWNER_A, 'row-level security');
SELECT pg_temp.run_at(:hosp_c, 'storage: owner C (backend flag off) cannot upload',
  format($$INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-media', '%s/c.jpg')$$, trim(both '''' from :'hosp_c')),
  :H_OWNER_C, 'row-level security');
SELECT pg_temp.run_at(:hosp_b, 'storage: owner B cannot see or delete site A files',
  $$DELETE FROM storage.objects WHERE bucket_id = 'hosp-media'$$, :H_OWNER_B, NULL, 0);
SELECT pg_temp.run_at(:hosp_a, 'storage: owner A can delete its own file',
  $$DELETE FROM storage.objects WHERE bucket_id = 'hosp-media'$$, :H_OWNER_A, NULL, 1);
SELECT tests.check('storage: every hosp-media policy is scoped to the bucket and gated by can(''media'')',
  $$SELECT count(*) = 4 AND bool_and(COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%bucket_id = ''hosp-media''%'
                                 AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%hospitality.can(''media''%')
      FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'hosp media%'$$);
SELECT tests.check('storage: no storage policy outside the hosp-media ones mentions the bucket',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname NOT LIKE 'hosp media%'
      AND COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%hosp-media%')$$);

-- ============================================================
-- 10. Ecommerce unchanged
-- ============================================================
SELECT tests.check('ecommerce: no Hospitality object was added to the public schema',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'hosp%')
       AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'hosp%')$$);
SELECT tests.check('ecommerce: every store keeps site_type ecommerce',
  $$SELECT bool_and(site_type = 'ecommerce') FROM public.tenants WHERE slug IN ('kobi', 'store-a', 'store-b', 'store-c', 'hc1c-shop')$$);
SELECT pg_temp.run_at(:STORE_A, 'ecommerce: a store owner still has every store permission on its store',
  $$SELECT 1 FROM unnest(ARRAY['pos', 'products.view', 'inventory', 'orders.fulfill', 'admin', 'staff.manage', 'staff.managers', 'billing.manage']) p
     WHERE public.staff_can(p)$$, :ECOM_OWNER_A, NULL, 8);

DROP TABLE hc_tables;

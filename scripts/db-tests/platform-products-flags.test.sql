-- ============================================================
-- פלטפורמה: site_type, תפקידים לפי מוצר, דגלי פיצ'רים, seed משותף
-- (Hospitality Stage 1a — 20261101090000_platform_products_flags.sql)
-- ============================================================
\set PA '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_A '''a0000000-0000-0000-0000-0000000000a1'''
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set STORE_B '''70000000-0000-0000-0000-00000000000b'''
\set ECOM_NEW '''71a00000-0000-0000-0000-000000000001'''
\set HOSP '''71a00000-0000-0000-0000-0000000000b1'''

-- ---------- site_type ----------
SELECT tests.check('site_type: every existing store is ecommerce',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE site_type <> 'ecommerce' AND id::text NOT LIKE '71a00000-%')$$);
SELECT tests.check('site_type: column is NOT NULL with default ecommerce',
  $$SELECT is_nullable = 'NO' AND column_default LIKE '''ecommerce''%'
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'site_type'$$);

INSERT INTO public.tenants (id, slug, name) VALUES (:ECOM_NEW, 'pf1a-ecom', 'חנות חדשה 1a');
SELECT tests.check('site_type: a new store without site_type is ecommerce',
  $$SELECT site_type = 'ecommerce' FROM public.tenants WHERE id = '71a00000-0000-0000-0000-000000000001'$$);

DO $t$
DECLARE err text;
BEGIN
  BEGIN
    UPDATE public.tenants SET site_type = 'hospitality' WHERE id = '71a00000-0000-0000-0000-000000000001';
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('site_type: cannot be changed after creation', err ILIKE '%אי אפשר לשנות את סוג האתר%', COALESCE(err, 'no error'));
  err := NULL;
  BEGIN
    INSERT INTO public.tenants (id, slug, name, site_type) VALUES (gen_random_uuid(), 'pf1a-bad', 'x', 'restaurant');
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('site_type: unknown product rejected', err ILIKE '%tenants_site_type_check%', COALESCE(err, 'no error'));
END $t$;

UPDATE public.tenants SET name = 'חנות חדשה 1a (שם חדש)' WHERE id = :ECOM_NEW;
SELECT tests.check('site_type: other tenant columns still update normally',
  $$SELECT name = 'חנות חדשה 1a (שם חדש)' AND site_type = 'ecommerce' FROM public.tenants WHERE id = '71a00000-0000-0000-0000-000000000001'$$);

-- ---------- Ecommerce seed: exactly as before ----------
SELECT tests.check('ecommerce seed: function body unchanged',
  $$SELECT md5(prosrc) = 'c78ef9e211a0c1886246616f473ef0bc' FROM pg_proc WHERE proname = 'tenants_seed_settings'$$);
SELECT tests.check('ecommerce seed: new store gets site_settings and email_settings',
  $$SELECT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = '71a00000-0000-0000-0000-000000000001' AND site_title = 'חנות חדשה 1a')
       AND EXISTS (SELECT 1 FROM public.email_settings WHERE tenant_id = '71a00000-0000-0000-0000-000000000001')$$);
SELECT tests.check('ecommerce seed: new store gets the self-pickup shipping method',
  $$SELECT count(*) = 1 FROM public.shipping_methods
     WHERE tenant_id = '71a00000-0000-0000-0000-000000000001' AND kind = 'pickup' AND price = 0 AND name = 'איסוף עצמי'$$);
SELECT tests.check('ecommerce seed: new store gets a 14-day trial',
  $$SELECT plan_type = 'trial' AND status = 'trialing'
       AND trial_ends_at BETWEEN now() + interval '13 days 23 hours' AND now() + interval '14 days 1 hour'
      FROM public.tenant_subscriptions WHERE tenant_id = '71a00000-0000-0000-0000-000000000001'$$);
SELECT tests.run('ecommerce seed: platform admin creates a store through platform_create_tenant',
  $$SELECT public.platform_create_tenant('pf1a-platform', 'חנות מהפאנל')$$, :PA, NULL, 1);
SELECT tests.check('ecommerce seed: store created from the platform panel is ecommerce and seeded',
  $$SELECT t.site_type = 'ecommerce'
       AND EXISTS (SELECT 1 FROM public.site_settings s WHERE s.tenant_id = t.id)
       AND EXISTS (SELECT 1 FROM public.shipping_methods m WHERE m.tenant_id = t.id)
       AND EXISTS (SELECT 1 FROM public.tenant_subscriptions s WHERE s.tenant_id = t.id)
      FROM public.tenants t WHERE t.slug = 'pf1a-platform'$$);

-- ---------- A non-Ecommerce tenant gets none of the Ecommerce seed ----------
INSERT INTO public.tenants (id, slug, name, site_type) VALUES (:HOSP, 'pf1a-stay', 'אירוח 1a', 'hospitality');
SELECT tests.check('hospitality tenant: no Ecommerce seed rows (shipping, trial, settings)',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.shipping_methods WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1')
       AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1')
       AND NOT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1')$$);
SELECT public.platform_seed_tenant_shared(:HOSP);
SELECT public.platform_seed_tenant_shared(:HOSP);
SELECT tests.check('shared seed: site_settings + email_settings created once (idempotent)',
  $$SELECT (SELECT count(*) FROM public.site_settings WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1') = 1
       AND (SELECT count(*) FROM public.email_settings WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1') = 1
       AND (SELECT site_title FROM public.site_settings WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1') = 'אירוח 1a'$$);
SELECT tests.run('shared seed: not callable through the API (authenticated)',
  $$SELECT public.platform_seed_tenant_shared('71a00000-0000-0000-0000-0000000000b1')$$, :OWNER_A, 'permission denied');

-- ---------- current_site_type() ----------
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('current_site_type: store site → ecommerce', $$SELECT public.current_site_type() = 'ecommerce'$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '71a00000-0000-0000-0000-0000000000b1')::text, false);
SELECT tests.check('current_site_type: hospitality site → hospitality', $$SELECT public.current_site_type() = 'hospitality'$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '00000000-0000-0000-0000-00000000dead')::text, false);
SELECT tests.check('current_site_type: unknown site → NULL', $$SELECT public.current_site_type() IS NULL$$);
SELECT set_config('request.headers', '', false);

-- ---------- Roles per product ----------
SELECT tests.check('product roles: Ecommerce registers no roles in this migration (no restriction)',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.platform_product_roles WHERE product = 'ecommerce')$$);
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000001a1', 'role1@test.local'),
  ('a0000000-0000-0000-0000-0000000001a2', 'role2@test.local'),
  ('a0000000-0000-0000-0000-0000000001a3', 'role3@test.local'),
  ('a0000000-0000-0000-0000-0000000001a4', 'role4@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('71a00000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000001a1', 'role1@test.local', 'role1_cashier', 'cashier', true);
SELECT tests.check('product roles: Ecommerce store still accepts all of its roles',
  $$SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000001a1' AND role = 'cashier')$$);

-- a product that registered roles accepts only them (simulates Hospitality's own migration)
INSERT INTO public.platform_product_roles (product, role) VALUES ('hospitality', 'admin') ON CONFLICT DO NOTHING;
DO $t$
DECLARE err text;
BEGIN
  BEGIN
    INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('71a00000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000001a2', 'role2@test.local', 'role2_guest', 'customer', true);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('product roles: hospitality tenant rejects an unregistered role (customer)',
          err ILIKE '%התפקיד customer לא קיים%', COALESCE(err, 'no error'));
END $t$;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('71a00000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000001a3', 'role3@test.local', 'role3_owner', 'admin', true);
SELECT tests.check('product roles: hospitality tenant accepts a registered role (admin)',
  $$SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000001a3' AND role = 'admin')$$);
-- a second (not protected) admin, so the existing main-owner protection is not what fires
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('71a00000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000001a4', 'role4@test.local', 'role4_manager', 'admin', true);
DO $t$
DECLARE err text;
BEGIN
  BEGIN
    UPDATE public.user_roles SET role = 'agent'
     WHERE tenant_id = '71a00000-0000-0000-0000-0000000000b1' AND user_id = 'a0000000-0000-0000-0000-0000000001a4';
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('product roles: changing a hospitality member to an unregistered role is rejected',
          err ILIKE '%התפקיד agent לא קיים%', COALESCE(err, 'no error'));
END $t$;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('71a00000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000001a2', 'role2@test.local', 'role2_agent', 'agent', true);
SELECT tests.check('product roles: a hospitality registration does not restrict Ecommerce stores',
  $$SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-0000000001a2' AND role = 'agent')$$);
DELETE FROM public.platform_product_roles WHERE product = 'hospitality';
SELECT tests.run('product roles: table not readable through the API',
  $$SELECT * FROM public.platform_product_roles$$, :OWNER_A, 'permission denied');

-- ---------- Feature flags ----------
SELECT tests.run('flags: platform flags not readable through the API (authenticated)',
  $$SELECT * FROM public.platform_feature_flags$$, :OWNER_A, 'permission denied');
SELECT tests.run('flags: tenant flags not readable through the API (anon)',
  $$SELECT * FROM public.tenant_feature_flags$$, NULL, 'permission denied');
SELECT tests.run('flags: tenant flags not writable through the API',
  $$INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES ('70000000-0000-0000-0000-00000000000a', 'x', true)$$,
  :OWNER_A, 'permission denied');
SELECT tests.run('flags: anon cannot call platform_feature_enabled',
  $$SELECT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000a')$$, NULL, 'permission denied');

INSERT INTO public.platform_feature_flags (key, description) VALUES ('pf1a_test_flag', 'דגל בדיקה') ON CONFLICT DO NOTHING;
SELECT tests.check('flags: a registered flag starts disabled',
  $$SELECT NOT enabled FROM public.platform_feature_flags WHERE key = 'pf1a_test_flag'$$);
SELECT tests.check('flags: unknown key is off',
  $$SELECT NOT public.platform_feature_enabled('no_such_flag', '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.check('flags: registered but not enabled anywhere is off',
  $$SELECT NOT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000a')$$);

SELECT tests.run('flags: a store owner cannot set flags',
  $$SELECT public.platform_set_flag('pf1a_test_flag', true)$$, :OWNER_A, 'רק מנהל הפלטפורמה');
SELECT tests.run('flags: platform admin enables a flag for one store only',
  $$SELECT public.platform_set_flag('pf1a_test_flag', true, '70000000-0000-0000-0000-00000000000a')$$, :PA, NULL, 1);
SELECT tests.check('flags: tenant on but platform off → still off',
  $$SELECT NOT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.run('flags: platform admin enables the flag at platform level',
  $$SELECT public.platform_set_flag('pf1a_test_flag', true)$$, :PA, NULL, 1);
SELECT tests.check('flags: platform on + tenant on → on',
  $$SELECT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.check('flags: platform on + another tenant not enabled → off',
  $$SELECT NOT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.run('flags: platform admin disables it for the store',
  $$SELECT public.platform_set_flag('pf1a_test_flag', false, '70000000-0000-0000-0000-00000000000a')$$, :PA, NULL, 1);
SELECT tests.check('flags: disabled again → off',
  $$SELECT NOT public.platform_feature_enabled('pf1a_test_flag', '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.check('flags: every change is in the audit log with actor and scope',
  $$SELECT count(*) = 3
           AND bool_and(actor_id = 'a0000000-0000-0000-0000-0000000000f0')
           AND count(*) FILTER (WHERE details->>'scope' = 'platform') = 1
      FROM public.platform_audit_log WHERE action = 'feature_flag_set' AND details->>'key' = 'pf1a_test_flag'$$);
SELECT tests.run('flags: unknown key rejected',
  $$SELECT public.platform_set_flag('no_such_flag', true)$$, :PA, 'דגל לא מוכר');
SELECT tests.run('flags: unknown store rejected',
  $$SELECT public.platform_set_flag('pf1a_test_flag', true, '00000000-0000-0000-0000-00000000dead')$$, :PA, 'החנות לא נמצאה');
SELECT tests.run('flags: NULL value rejected',
  $$SELECT public.platform_set_flag('pf1a_test_flag', NULL)$$, :PA, 'ערך הדגל חסר');
DELETE FROM public.tenant_feature_flags WHERE key = 'pf1a_test_flag';
DELETE FROM public.platform_feature_flags WHERE key = 'pf1a_test_flag';

-- ---------- Deleting a store removes its flags ----------
INSERT INTO public.tenants (id, slug, name, site_type)
VALUES ('71a00000-0000-0000-0000-0000000000c1', 'pf1a-cascade', 'מחיקה 1a', 'hospitality');
INSERT INTO public.platform_feature_flags (key) VALUES ('pf1a_cascade_flag') ON CONFLICT DO NOTHING;
INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
VALUES ('71a00000-0000-0000-0000-0000000000c1', 'pf1a_cascade_flag', true);
DELETE FROM public.tenants WHERE id = '71a00000-0000-0000-0000-0000000000c1';
SELECT tests.check('flags: deleting a store removes its tenant flags',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE key = 'pf1a_cascade_flag')$$);
DELETE FROM public.platform_feature_flags WHERE key = 'pf1a_cascade_flag';

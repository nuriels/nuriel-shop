-- ============================================================
-- מנוע Ecommerce: הגנת כתיבה, תפקידים רשומים, product-images
-- (Hospitality Stage 1b — 20261101100000_ecommerce_engine_guard.sql)
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000000a1'''
\set HOSP_OWNER '''a0000000-0000-0000-0000-0000000001b1'''
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set STORE_B '''70000000-0000-0000-0000-00000000000b'''
\set HOSP '''71b10000-0000-0000-0000-0000000000b1'''

INSERT INTO public.tenants (id, slug, name, site_type) VALUES (:HOSP, 'eg1b-stay', 'אירוח 1b', 'hospitality');
-- a dedicated store for the role checks (the fixture stores belong to other test files)
INSERT INTO public.tenants (id, slug, name) VALUES ('71b10000-0000-0000-0000-0000000000e1', 'eg1b-shop', 'חנות 1b');
INSERT INTO auth.users (id, email) VALUES (:HOSP_OWNER, 'hosp.owner.1b@test.local') ON CONFLICT DO NOTHING;

-- ---------- Ecommerce roles ----------
SELECT tests.check('roles: Ecommerce registers exactly the roles user_roles allows today',
  $$SELECT (SELECT array_agg(role ORDER BY role) FROM public.platform_product_roles WHERE product = 'ecommerce')
         = (SELECT array_agg(r ORDER BY r)
              FROM regexp_matches(
                     (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_roles_role_check'),
                     '''([a-z_]+)''', 'g') AS m(arr), unnest(m.arr) AS r)$$);
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000001c1', 'r1.1b@test.local'),
  ('a0000000-0000-0000-0000-0000000001c2', 'r2.1b@test.local'),
  ('a0000000-0000-0000-0000-0000000001c3', 'r3.1b@test.local'),
  ('a0000000-0000-0000-0000-0000000001c4', 'r4.1b@test.local'),
  ('a0000000-0000-0000-0000-0000000001c5', 'r5.1b@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('71b10000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000001c1', 'r1.1b@test.local', 'r1_1b', 'admin', true),
  ('71b10000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000001c2', 'r2.1b@test.local', 'r2_1b', 'agent', true),
  ('71b10000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000001c3', 'r3.1b@test.local', 'r3_1b', 'customer', true),
  ('71b10000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000001c4', 'r4.1b@test.local', 'r4_1b', 'warehouse', true),
  ('71b10000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000001c5', 'r5.1b@test.local', 'r5_1b', 'cashier', true);
SELECT tests.check('roles: a store still accepts all five of its roles',
  $$SELECT count(DISTINCT role) = 5 FROM public.user_roles WHERE email LIKE 'r_.1b@test.local'$$);

-- ---------- Triggers on all 40 Ecommerce tables ----------
CREATE TEMP TABLE eg_tables(name text);
INSERT INTO eg_tables SELECT unnest(ARRAY[
  'abandoned_carts', 'cancellation_requests', 'cart_promotions', 'categories',
  'coupon_email_sends', 'coupons', 'customer_carts', 'customer_emails',
  'customer_invites', 'customer_profiles', 'global_products', 'grow_payment_processes',
  'home_banner_slides', 'location_transfer_lines', 'location_transfers',
  'order_courier_links', 'order_delivery_events', 'order_items', 'order_number_counters',
  'orders', 'pages', 'pending_products', 'picking_events', 'price_tier_backup',
  'product_categories', 'product_drafts', 'product_locations', 'product_relations',
  'product_reviews', 'product_serials', 'product_stickers', 'product_variants',
  'service_agreements', 'shared_carts', 'shipping_methods', 'stock_count_lines',
  'stock_counts', 'tenant_addons', 'tenant_subscriptions', 'user_custom_prices']);
SELECT tests.check('guard: the list has the 40 Ecommerce tables of the classification',
  $$SELECT count(*) = 40 FROM eg_tables$$);
SELECT tests.check('guard: every Ecommerce table has the statement-level insert guard',
  $$SELECT NOT EXISTS (SELECT 1 FROM eg_tables e WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE c.relname = e.name AND c.relnamespace = 'public'::regnamespace
         AND tg.tgname = 'ecommerce_rows_guard' AND tg.tgenabled = 'O'))$$);
SELECT tests.check('guard: every Ecommerce table has the tenant-move guard (row level, only when tenant_id changes)',
  $$SELECT NOT EXISTS (SELECT 1 FROM eg_tables e WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE c.relname = e.name AND c.relnamespace = 'public'::regnamespace
         AND tg.tgname = 'ecommerce_row_move_guard' AND tg.tgenabled = 'O'
         AND pg_get_triggerdef(tg.oid) LIKE '%BEFORE UPDATE OF tenant_id%WHEN%IS DISTINCT FROM%'))$$);
SELECT tests.check('guard: no platform (shared) table carries the Ecommerce guard',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
       WHERE tg.tgname IN ('ecommerce_rows_guard', 'ecommerce_row_move_guard')
         AND c.relname NOT IN (SELECT name FROM eg_tables))$$);

-- ---------- Behaviour ----------
CREATE OR REPLACE FUNCTION pg_temp.expect_guard(_name text, _sql text, _role text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    IF _role IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE ' || _role; END IF;
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err ILIKE '%שייכת למנוע החנויות%', COALESCE(err, 'no error'));
END $f$;

-- Ecommerce stores: writes unchanged
INSERT INTO public.categories (tenant_id, name) VALUES (:STORE_A, 'eg1b-קטגוריה');
INSERT INTO public.shipping_methods (tenant_id, name, kind, price, sort_order) VALUES (:STORE_A, 'eg1b-משלוח', 'pickup', 0, 9);
INSERT INTO public.home_banner_slides (tenant_id, placement, alt_text, desktop_image_url) VALUES (:STORE_A, 'top', 'eg1b', 'https://cdn.test/eg1b.webp');
SELECT tests.check('guard: Ecommerce store inserts still work (categories, shipping, banners)',
  $$SELECT EXISTS (SELECT 1 FROM public.categories WHERE name = 'eg1b-קטגוריה')
       AND EXISTS (SELECT 1 FROM public.shipping_methods WHERE name = 'eg1b-משלוח')
       AND EXISTS (SELECT 1 FROM public.home_banner_slides WHERE alt_text = 'eg1b')$$);
UPDATE public.shipping_methods SET price = 12 WHERE name = 'eg1b-משלוח';
SELECT tests.check('guard: ordinary updates of Ecommerce rows still work',
  $$SELECT price = 12 FROM public.shipping_methods WHERE name = 'eg1b-משלוח'$$);
UPDATE public.shipping_methods SET tenant_id = :STORE_B WHERE name = 'eg1b-משלוח';
SELECT tests.check('guard: moving a row between Ecommerce stores is still allowed (unchanged)',
  $$SELECT tenant_id = '70000000-0000-0000-0000-00000000000b' FROM public.shipping_methods WHERE name = 'eg1b-משלוח'$$);

-- Hospitality site: every write path rejected
SELECT pg_temp.expect_guard('guard: category insert for a hospitality site rejected (owner bypassing RLS)',
  $$INSERT INTO public.categories (tenant_id, name) VALUES ('71b10000-0000-0000-0000-0000000000b1', 'x')$$);
SELECT pg_temp.expect_guard('guard: shipping method insert for a hospitality site rejected (service_role)',
  $$INSERT INTO public.shipping_methods (tenant_id, name, kind, price) VALUES ('71b10000-0000-0000-0000-0000000000b1', 'eg1b-hosp-shipping', 'pickup', 0)$$,
  'service_role');
SELECT pg_temp.expect_guard('guard: Ecommerce subscription for a hospitality site rejected',
  $$INSERT INTO public.tenant_subscriptions (tenant_id, plan_type, status, trial_ends_at) VALUES ('71b10000-0000-0000-0000-0000000000b1', 'trial', 'trialing', now() + interval '14 days')$$);
SELECT pg_temp.expect_guard('guard: banner insert for a hospitality site rejected',
  $$INSERT INTO public.home_banner_slides (tenant_id, placement, alt_text, desktop_image_url) VALUES ('71b10000-0000-0000-0000-0000000000b1', 'top', 'x', 'https://cdn.test/x.webp')$$);
SELECT pg_temp.expect_guard('guard: a multi-row insert with one hospitality row is rejected as a whole',
  $$INSERT INTO public.shipping_methods (tenant_id, name, kind, price) VALUES
      ('70000000-0000-0000-0000-00000000000a', 'eg1b-mixed', 'pickup', 0),
      ('71b10000-0000-0000-0000-0000000000b1', 'eg1b-mixed', 'pickup', 0)$$);
SELECT tests.check('guard: nothing from the rejected multi-row insert was kept',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.shipping_methods WHERE name = 'eg1b-mixed')$$);
SELECT pg_temp.expect_guard('guard: moving an Ecommerce row to a hospitality site rejected',
  $$UPDATE public.home_banner_slides SET tenant_id = '71b10000-0000-0000-0000-0000000000b1' WHERE alt_text = 'eg1b'$$);
SELECT tests.check('guard: the row stayed in its store',
  $$SELECT tenant_id = '70000000-0000-0000-0000-00000000000a' FROM public.home_banner_slides WHERE alt_text = 'eg1b'$$);
SELECT tests.check('guard: the hospitality site owns no Ecommerce rows',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.categories WHERE tenant_id = '71b10000-0000-0000-0000-0000000000b1')
       AND NOT EXISTS (SELECT 1 FROM public.shipping_methods WHERE tenant_id = '71b10000-0000-0000-0000-0000000000b1')
       AND NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = '71b10000-0000-0000-0000-0000000000b1')$$);

-- Shared platform tables stay writable for a hospitality site
SELECT public.platform_seed_tenant_shared(:HOSP);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:HOSP, :HOSP_OWNER, 'hosp.owner.1b@test.local', 'hosp_owner_1b', 'admin', true);
SELECT tests.check('guard: shared tables (settings, membership) still work for a hospitality site',
  $$SELECT EXISTS (SELECT 1 FROM public.site_settings WHERE tenant_id = '71b10000-0000-0000-0000-0000000000b1')
       AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = '71b10000-0000-0000-0000-0000000000b1' AND role = 'admin')$$);

-- ---------- product-images storage ----------
INSERT INTO storage.buckets (id, name) VALUES ('product-images', 'product-images') ON CONFLICT DO NOTHING;
SELECT tests.check('storage: the new policies are RESTRICTIVE and only about product-images',
  $$SELECT count(*) = 2 AND bool_and(permissive = 'RESTRICTIVE')
           AND bool_and(coalesce(with_check, qual) LIKE '%product-images%')
      FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname LIKE 'product images not on hospitality sites%'$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.run('storage: a store admin still uploads product images (unchanged)',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', '70000000-0000-0000-0000-00000000000a/eg1b.webp')$$,
  :OWNER_A, NULL, 1);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '71b10000-0000-0000-0000-0000000000b1')::text, false);
SELECT tests.run('storage: a hospitality site admin cannot upload to product-images',
  $$INSERT INTO storage.objects (bucket_id, name) VALUES ('product-images', '71b10000-0000-0000-0000-0000000000b1/eg1b.webp')$$,
  :HOSP_OWNER, 'row-level security');
SELECT set_config('request.headers', '', false);

-- cleanup of shared rows written for the hospitality site
DELETE FROM storage.objects WHERE name LIKE '%eg1b.webp';
DROP TABLE eg_tables;

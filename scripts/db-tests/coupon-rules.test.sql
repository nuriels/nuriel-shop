-- ============================================================
-- קופונים: שימושים ללקוח, קהל יעד (רשומים / אורחים), בלי כפל מבצעים
-- ============================================================
CREATE OR REPLACE FUNCTION tests.server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, CASE WHEN _expect_error IS NULL THEN err IS NULL ELSE COALESCE(err ILIKE '%' || _expect_error || '%', false) END,
          COALESCE('ERROR: ' || err, 'ok'));
END; $f$;
-- הזמנה: לקוח רשום (customer) או אורח (customer NULL + מייל), שורות: (מוצר, כמות, מחיר)
CREATE OR REPLACE FUNCTION tests.cr_order(_id TEXT, _customer TEXT, _email TEXT, _code TEXT, _lines JSONB)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE l JSONB;
BEGIN
  INSERT INTO public.orders (id, tenant_id, customer_id, kind, coupon_code,
    customer_name, customer_tax_id, customer_phone, customer_email, billing_city, billing_address, billing_zip)
  VALUES (_id::uuid, '70000000-0000-0000-0000-00000000000a', _customer::uuid, 'order', _code,
    'קונה בדיקה', '514123456', '0501234567', _email, 'תל אביב', 'הרצל 1', '6100001');
  FOR l IN SELECT * FROM jsonb_array_elements(_lines) LOOP
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    VALUES (_id::uuid, (l ->> 0)::uuid, (l ->> 1)::int, (l ->> 2)::numeric);
  END LOOP;
END; $f$;
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'rules_cust', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed)
VALUES ('a0000000-0000-0000-0000-0000000000c7', 'לקוח כללים', true) ON CONFLICT DO NOTHING;
DO $$ BEGIN
  UPDATE public.customer_profiles SET profile_completed = true WHERE user_id = 'a0000000-0000-0000-0000-0000000000c7';
EXCEPTION WHEN undefined_column THEN NULL; END $$;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'כללי קופון') ON CONFLICT DO NOTHING;
-- מוצר רגיל 100; מוצר במבצע (מחיר מבצע 80 בתוקף); מוצר "מבצע חם" 50
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, sale_price, sale_ends_at, is_promo) VALUES
  ('9c700000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '97000001', 'רגיל', 'כללי קופון', 'a0000000-0000-0000-0000-0000000000a1', 100, 1000, NULL, NULL, false),
  ('9c700000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', '97000002', 'במבצע', 'כללי קופון', 'a0000000-0000-0000-0000-0000000000a1', 100, 1000, 80, now() + interval '30 days', false),
  ('9c700000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', '97000003', 'מבצע חם', 'כללי קופון', 'a0000000-0000-0000-0000-0000000000a1', 50, 1000, NULL, NULL, true)
ON CONFLICT DO NOTHING;

-- ---------- הגדרות ----------
SELECT tests.server('rules: coupon with all the new rules is saved',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, max_uses_per_customer, audience, exclude_sale_items)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'ONCE10', 'percent', 10, 1, 'all', false),
           ('70000000-0000-0000-0000-00000000000a', 'MEMBERS', 'percent', 10, NULL, 'registered', false),
           ('70000000-0000-0000-0000-00000000000a', 'GUESTS', 'percent', 10, NULL, 'guests', false),
           ('70000000-0000-0000-0000-00000000000a', 'NOSALE', 'percent', 10, NULL, 'all', true),
           ('70000000-0000-0000-0000-00000000000a', 'NOSALEFIX', 'fixed', 500, NULL, 'all', true);
    INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'PLAIN5', 'percent', 5)$$);
SELECT tests.server('rules: unknown audience rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, audience)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'BADAUD', 'percent', 10, 'vip')$$, 'coupons_rules_check');
SELECT tests.server('rules: 0 uses per customer rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, max_uses_per_customer)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'BADUSE', 'percent', 10, 0)$$, 'coupons_rules_check');
SELECT tests.check('rules: an existing-style coupon gets the defaults (all, unlimited, sale included)',
  $$SELECT audience = 'all' AND max_uses_per_customer IS NULL AND NOT exclude_sale_items
      FROM public.coupons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND code = 'PLAIN5'$$);

-- ---------- שימוש אחד ללקוח ----------
SELECT tests.server('once: registered customer — first use works',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'once10', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$);
SELECT tests.check('once: discount applied (10)',
  $$SELECT discount_amount = 10 FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000001'$$);
SELECT tests.server('once: same customer — second use blocked',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'ONCE10', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$,
  'כבר השתמשת בקופון הזה');
SELECT tests.server('once: same email as a guest — also blocked (cannot bypass by logging out)',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000003', NULL, 'RULES.cust@test.local', 'ONCE10', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$,
  'כבר השתמשת בקופון הזה');
SELECT tests.server('once: a different guest can use it',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000004', NULL, 'other.guest@test.local', 'ONCE10', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$);
SELECT tests.server('once: cancelling the order frees the use',
  $$UPDATE public.orders SET status = 'cancelled' WHERE id = '0d700000-0000-0000-0000-000000000001'$$);
SELECT tests.server('once: after cancel the customer can use it again',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'ONCE10', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$);
DO $t$
DECLARE err text;
BEGIN
  BEGIN PERFORM public.check_coupon('ONCE10', 100, 'a0000000-0000-0000-0000-0000000000c7', NULL, false);
  EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  INSERT INTO tests.results (name, ok, detail) VALUES ('check_coupon: preview says already used', err ILIKE '%כבר השתמשת%', COALESCE(err, 'no error'));
END $t$;

-- ---------- קהל יעד ----------
SELECT tests.server('members: guest blocked',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000011', NULL, 'g1@test.local', 'MEMBERS', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$,
  'ללקוחות רשומים בלבד');
SELECT tests.server('members: registered customer allowed',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'MEMBERS', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$);
SELECT tests.server('guests: registered customer blocked',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'GUESTS', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$,
  'בלי הרשמה בלבד');
SELECT tests.server('guests: guest allowed',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000014', NULL, 'g2@test.local', 'GUESTS', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]')$$);

-- ---------- בלי כפל מבצעים ----------
SELECT tests.server('nosale: cart with regular 100 + sale 80 + hot deal 50',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'NOSALE',
      '[["9c700000-0000-0000-0000-000000000001", 1, 100], ["9c700000-0000-0000-0000-000000000002", 1, 80], ["9c700000-0000-0000-0000-000000000003", 1, 50]]')$$);
SELECT tests.check('nosale: the sale and hot-deal lines are marked on_sale',
  $$SELECT bool_and(on_sale = (product_id <> '9c700000-0000-0000-0000-000000000001'))
      FROM public.order_items WHERE order_id = '0d700000-0000-0000-0000-000000000021'$$);
SELECT tests.check('nosale: 10% only on the regular product (10), total 220',
  $$SELECT discount_amount = 10 AND total = 220 AND coupon_exclude_sale FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000021'$$);
SELECT tests.server('nosale fixed: ₪500 off, capped at the non-sale products',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'NOSALEFIX',
      '[["9c700000-0000-0000-0000-000000000001", 1, 100], ["9c700000-0000-0000-0000-000000000002", 1, 80]]')$$);
SELECT tests.check('nosale fixed: discount = 100 (only the regular product), total 80',
  $$SELECT discount_amount = 100 AND total = 80 FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000022'$$);
SELECT tests.server('nosale: cart with only sale items',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'NOSALE',
      '[["9c700000-0000-0000-0000-000000000002", 2, 80]]')$$);
SELECT tests.check('nosale: no discount at all when every item is on sale',
  $$SELECT discount_amount = 0 AND total = 160 FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000023'$$);
SELECT tests.server('regular coupon still discounts sale items (default behaviour unchanged)',
  $$SELECT tests.cr_order('0d700000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-0000000000c7', 'rules.cust@test.local', 'MEMBERS',
      '[["9c700000-0000-0000-0000-000000000001", 1, 100], ["9c700000-0000-0000-0000-000000000002", 1, 80]]')$$);
SELECT tests.check('regular coupon: 10% of 180 = 18',
  $$SELECT discount_amount = 18 FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000024'$$);
SELECT tests.server('changing the coupon later does not change an existing order',
  $$UPDATE public.coupons SET exclude_sale_items = false WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND code = 'NOSALE';
    UPDATE public.orders SET note = 'recalc' WHERE id = '0d700000-0000-0000-0000-000000000021'$$);
SELECT tests.check('existing order keeps its snapshot (still 10)',
  $$SELECT discount_amount = 10 AND total = 220 FROM public.orders WHERE id = '0d700000-0000-0000-0000-000000000021'$$);

-- ---------- צוות: לא מוגבל בקהל / שימושים ללקוח ----------
DO $t$
DECLARE err text;
BEGIN
  BEGIN
    -- מנהל החנות מחובר (auth.uid() = המנהל) — יוצר הזמנה ידנית לקונה מזדמן
    PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true);
    PERFORM tests.cr_order('0d700000-0000-0000-0000-000000000031', NULL, 'walkin@test.local', 'MEMBERS', '[["9c700000-0000-0000-0000-000000000001", 1, 100]]');
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('staff: manual order for a guest with a members-only coupon is allowed', err IS NULL, COALESCE(err, 'ok'));
END $t$;

-- ניקוי
SELECT set_config('request.headers', '', false);
SET session_replication_role = replica;
DELETE FROM public.order_items WHERE order_id::text LIKE '0d700000-%';
DELETE FROM public.orders WHERE id::text LIKE '0d700000-%';
SET session_replication_role = origin;
DELETE FROM public.coupons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND code IN ('ONCE10', 'MEMBERS', 'GUESTS', 'NOSALE', 'NOSALEFIX', 'PLAIN5');
DELETE FROM public.global_products WHERE id::text LIKE '9c700000-%';
DELETE FROM public.categories WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND name = 'כללי קופון';

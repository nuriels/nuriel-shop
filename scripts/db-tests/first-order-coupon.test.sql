-- קופון להזמנה ראשונה: מצבים, זיהוי לפי חשבון / מייל, הצעה, אכיפה ביצירת הזמנה, הפרדה בין חנויות
CREATE OR REPLACE FUNCTION tests.fo_server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, CASE WHEN _expect_error IS NULL THEN err IS NULL ELSE COALESCE(err ILIKE '%' || _expect_error || '%', false) END, COALESCE('ERROR: ' || err, 'ok'));
END; $f$;
CREATE OR REPLACE FUNCTION tests.fo_order(_id TEXT, _tenant TEXT, _customer TEXT, _email TEXT, _code TEXT, _status TEXT DEFAULT 'pending')
RETURNS VOID LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _tenant)::text, false);
  INSERT INTO public.orders (id, tenant_id, customer_id, kind, coupon_code, status,
    customer_name, customer_tax_id, customer_phone, customer_email, billing_city, billing_address, billing_zip)
  VALUES (_id::uuid, _tenant::uuid, _customer::uuid, 'order', _code, 'pending',
    'קונה', '514123456', '0501234567', _email, 'תל אביב', 'הרצל 1', '6100001');
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
  SELECT _id::uuid, p.id, 1, 100 FROM public.global_products p WHERE p.tenant_id = _tenant::uuid LIMIT 1;
  IF _status <> 'pending' THEN UPDATE public.orders SET status = _status WHERE id = _id::uuid; END IF;
END; $f$;

SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO auth.users (id, email) VALUES ('f1d00000-0000-0000-0000-0000000000c1', 'fo.cust@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'f1d00000-0000-0000-0000-0000000000c1', 'fo.cust@test.local', 'fo_cust', 'customer', true) ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed) VALUES ('f1d00000-0000-0000-0000-0000000000c1', 'לקוח', true) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'הזמנה ראשונה'), ('70000000-0000-0000-0000-00000000000b', 'הזמנה ראשונה') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity) VALUES
  ('9f100000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000a', '98000001', 'מוצר א', 'הזמנה ראשונה', 'a0000000-0000-0000-0000-0000000000a1', 100, 1000),
  ('9f100000-0000-0000-0000-00000000000b', '70000000-0000-0000-0000-00000000000b', '98000002', 'מוצר ב', 'הזמנה ראשונה', 'a0000000-0000-0000-0000-0000000000b1', 100, 1000)
ON CONFLICT DO NOTHING;

SELECT tests.check('first order: every existing coupon defaults to none',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.coupons WHERE first_order_mode <> 'none')$$);
SELECT tests.fo_server('first order: an auto coupon is created',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, first_order_mode) VALUES ('70000000-0000-0000-0000-00000000000a', 'FIRSTAUTO', 'percent', 10, 'auto')$$);
SELECT tests.fo_server('first order: a second first-order coupon in the same store is refused',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, first_order_mode) VALUES ('70000000-0000-0000-0000-00000000000a', 'FIRSTOFFER', 'percent', 15, 'offer')$$, 'one_first_order');
SELECT tests.fo_server('first order: another store may have its own',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, first_order_mode) VALUES ('70000000-0000-0000-0000-00000000000b', 'FIRSTB', 'fixed', 20, 'offer')$$);
SELECT tests.fo_server('first order: unknown mode rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, first_order_mode) VALUES ('70000000-0000-0000-0000-00000000000a', 'BADMODE', 'percent', 5, 'sometimes')$$, 'first_order_mode_check');

-- ---------- הצעה ----------
SELECT tests.check('first order: offer returned for a brand-new email',
  $$SELECT (public.first_order_offer(NULL, 'brand.new@test.local', true) ->> 'code') = 'FIRSTAUTO' AND (public.first_order_offer(NULL, 'brand.new@test.local', true) ->> 'mode') = 'auto'$$);
SELECT tests.check('first order: offer shown tentatively when the email is not known yet',
  $$SELECT public.first_order_offer(NULL, NULL, true) IS NOT NULL$$);
SELECT tests.check('first order: the offer of store A is not visible in store B',
  $$SELECT (SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false)) IS NOT NULL
       AND (public.first_order_offer(NULL, 'brand.new@test.local', true) ->> 'code') = 'FIRSTB'$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- ---------- הזמנה ראשונה ואחריה ----------
SELECT tests.fo_server('first order: first order with the coupon succeeds (guest by email)',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', NULL, 'Guest.One@test.local', 'FIRSTAUTO')$$);
SELECT tests.check('first order: the discount was applied to that order',
  $$SELECT coupon_code = 'FIRSTAUTO' AND coupon_discount_value = 10 FROM public.orders WHERE id = 'f1a00000-0000-0000-0000-000000000001'$$);
SELECT tests.fo_server('first order: a second order with the coupon on the same email is refused (case-insensitive)',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', NULL, 'guest.one@TEST.local', 'FIRSTAUTO')$$, 'להזמנה ראשונה בלבד');
SELECT tests.check('first order: no offer for that email any more',
  $$SELECT public.first_order_offer(NULL, 'guest.one@test.local', true) IS NULL$$);
SELECT tests.check('first order: the pre-check refuses it too',
  $$SELECT (SELECT public.coupon_customer_problem(c, NULL, 'guest.one@test.local', true) FROM public.coupons c WHERE code = 'FIRSTAUTO') = 'הקופון מיועד להזמנה ראשונה בלבד'$$);
SELECT tests.fo_server('first order: an order without a coupon is unaffected',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', NULL, 'guest.one@test.local', NULL)$$);

-- ---------- חשבון ----------
SELECT tests.fo_server('first order: registered customer, first order, coupon accepted',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000a', 'f1d00000-0000-0000-0000-0000000000c1', 'fo.cust@test.local', 'FIRSTAUTO')$$);
SELECT tests.check('first order: that customer is not offered the coupon again (by account, even with another email)',
  $$SELECT public.first_order_offer('f1d00000-0000-0000-0000-0000000000c1', 'other.mail@test.local', false) IS NULL$$);

-- ---------- הזמנה שבוטלה לא נחשבת; חנות אחרת לא נחשבת ----------
SELECT tests.fo_server('first order: a cancelled order does not count',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-00000000000a', NULL, 'cancelled.only@test.local', NULL, 'cancelled')$$);
SELECT tests.check('first order: still offered after only a cancelled order',
  $$SELECT public.first_order_offer(NULL, 'cancelled.only@test.local', true) IS NOT NULL$$);
SELECT tests.fo_server('first order: an order of the same email in another store does not count',
  $$SELECT tests.fo_order('f1a00000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-00000000000b', NULL, 'other.store@test.local', NULL)$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('first order: still offered in store A',
  $$SELECT public.first_order_offer(NULL, 'other.store@test.local', true) IS NOT NULL$$);

-- ---------- קופון שלא זמין ----------
UPDATE public.coupons SET is_active = false WHERE code = 'FIRSTAUTO';
SELECT tests.check('first order: an inactive coupon is not offered', $$SELECT public.first_order_offer(NULL, 'x@test.local', true) IS NULL$$);
UPDATE public.coupons SET is_active = true, expires_at = now() - interval '1 day' WHERE code = 'FIRSTAUTO';
SELECT tests.check('first order: an expired coupon is not offered', $$SELECT public.first_order_offer(NULL, 'x@test.local', true) IS NULL$$);
UPDATE public.coupons SET expires_at = NULL WHERE code = 'FIRSTAUTO';
SELECT tests.run('first order: clients cannot call the offer function',
  $$SELECT public.first_order_offer(NULL, 'x@test.local', true)$$, NULL, 'permission denied');
SELECT set_config('request.headers', '', false);

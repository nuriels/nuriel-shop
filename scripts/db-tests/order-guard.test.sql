-- ============================================================
-- מיגרציה 200: הגנה על יצירת הזמנה ישירה (place_order / INSERT ל-orders)
--   • קופון ללקוח מחובר דורש אישור של check_coupon (השרת) — אותה שגיאה לכל קוד, כך שאי אפשר לנחש קודים
--   • האישור נצרך (חד-פעמי), פג אחרי שעתיים, תקף לקוד ולמשתמש שלו בלבד
--   • אורח ושרת (בלי משתמש) וצוות — בלי שינוי
--   • הגבלת קצב הזמנות ללקוח: 30 ל-10 דקות, 300 ליממה; צוות לא מוגבל
-- בדיקות המקביליות (הזמנות מקבילות, קופון עם max_uses, אישור אחד בשני חיבורים) — order-guard-concurrency.sh
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set C5 '''a0000000-0000-0000-0000-0000000009a5'''
\set C6 '''a0000000-0000-0000-0000-0000000009a6'''
\set C7 '''a0000000-0000-0000-0000-0000000009a7'''
\set TEN '''70000000-0000-0000-0000-00000000000a'''

CREATE OR REPLACE FUNCTION tests.og_server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
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

CREATE OR REPLACE FUNCTION tests.og_details()
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object(
    'customer_name', 'לקוח הגנה', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
    'customer_email', 'cust.guard@test.local',
    'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001',
    'accepted_terms', true, 'shipping_method_id', '5e000000-0000-0000-0000-000000000002',
    'payment_method', 'phone');
$f$;
CREATE OR REPLACE FUNCTION tests.og_details(_coupon TEXT)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$ SELECT tests.og_details() || jsonb_build_object('coupon_code', _coupon); $f$;
CREATE OR REPLACE FUNCTION tests.og_items() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', '9e100000-0000-0000-0000-000000000001', 'quantity', 1, 'unit_price', 100));
$f$;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tests.og_details(), tests.og_details(TEXT), tests.og_items() TO anon, authenticated;

SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000009a5', 'guard.c5@test.local'),
  ('a0000000-0000-0000-0000-0000000009a6', 'guard.c6@test.local'),
  ('a0000000-0000-0000-0000-0000000009a7', 'guard.c7@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000009a5', 'guard.c5@test.local', 'guard_c5', 'customer', true),
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000009a6', 'guard.c6@test.local', 'guard_c6', 'customer', true),
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000009a7', 'guard.c7@test.local', 'guard_c7', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed) VALUES
  ('a0000000-0000-0000-0000-0000000009a5', 'לקוח הגנה 5', true, true),
  ('a0000000-0000-0000-0000-0000000009a6', 'לקוח הגנה 6', true, true),
  ('a0000000-0000-0000-0000-0000000009a7', 'לקוח הגנה 7', true, true) ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active)
VALUES ('5e000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', 'איסוף עצמי (הגנה)', 'pickup', 0, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'בדיקת הגנה') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity)
VALUES ('9e100000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '96000901', 'מוצר הגנה', 'בדיקת הגנה',
        'a0000000-0000-0000-0000-0000000000a1', 100, 100000) ON CONFLICT DO NOTHING;
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'GUARD10', 'percent', 10),
  ('70000000-0000-0000-0000-00000000000a', 'GUARDB', 'percent', 5)
ON CONFLICT DO NOTHING;

-- ---------- 1. בלי אישור: אותה שגיאה לכל קוד (קיים, לא קיים, לא פעיל) ----------
SELECT tests.run('coupon: a customer without a grant is refused (an existing code)',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :C6, 'הקופון לא אומת בקופה');
SELECT tests.run('coupon: the SAME error for a code that does not exist (no oracle)',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('NOSUCHCODE'))$$, :C6, 'הקופון לא אומת בקופה');
SELECT tests.run('coupon: direct INSERT into orders gets the same refusal',
  $$INSERT INTO public.orders (customer_id, status, kind, total, coupon_code, customer_name, customer_tax_id,
      customer_phone, customer_email, billing_city, billing_address, billing_zip)
    VALUES ('a0000000-0000-0000-0000-0000000009a6', 'pending', 'order', 0, 'GUARD10', 'x', '123456782',
      '0501234567', 'x@test.local', 'ת"א', 'הרצל 1', '6100001')$$, :C6, 'הקופון לא אומת בקופה');
SELECT tests.check('coupon: no order was created by the refused attempts',
  $$SELECT count(*) = 0 FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a6'$$);
SELECT tests.run('coupon: an order WITHOUT a coupon is unaffected',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C6);

-- ---------- 2. אישור מהשרת ----------
SELECT tests.og_server('grant: check_coupon (service) answers for a registered customer',
  $$SELECT public.check_coupon('GUARD10', 100, 'a0000000-0000-0000-0000-0000000009a5', NULL, false)$$);
SELECT tests.check('grant: ... and recorded exactly one grant for that customer and code',
  $$SELECT count(*) = 1 FROM public.coupon_grants WHERE user_id = 'a0000000-0000-0000-0000-0000000009a5' AND code = 'GUARD10'$$);
SELECT tests.og_server('grant: check_coupon for a GUEST (no customer) answers',
  $$SELECT public.check_coupon('GUARDB', 100, NULL, 'guest@test.local', true)$$);
SELECT tests.check('grant: ... and records nothing', $$SELECT count(*) = 0 FROM public.coupon_grants WHERE code = 'GUARDB'$$);
SELECT tests.check('grant: a refused check (unknown code) records nothing',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.coupon_grants WHERE code = 'NOSUCHCODE')$$);
SELECT tests.run('grant: the customer cannot read or forge grants through the API',
  $$INSERT INTO public.coupon_grants (tenant_id, user_id, code, expires_at)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000009a6', 'GUARD10', now() + interval '1 day')$$,
  :C6, 'permission denied');
SELECT tests.run('grant: the customer cannot read the grants table',
  $$SELECT * FROM public.coupon_grants$$, :C6, 'permission denied');
SELECT tests.run('grant: the customer cannot call check_coupon (service only)',
  $$SELECT public.check_coupon('GUARD10', 100, 'a0000000-0000-0000-0000-0000000009a6', NULL, false)$$, :C6, 'permission denied');

-- ---------- 3. עם אישור: ההזמנה עוברת והאישור נצרך ----------
SELECT tests.run('grant: with a grant the order is created with the coupon',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :C5);
SELECT tests.check('grant: the order carries the coupon discount snapshot',
  $$SELECT count(*) = 1 AND bool_and(coupon_code = 'GUARD10' AND coupon_discount_value = 10)
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a5' AND coupon_code IS NOT NULL$$);
SELECT tests.check('grant: it was consumed by the order', $$SELECT NOT EXISTS (SELECT 1 FROM public.coupon_grants WHERE user_id = 'a0000000-0000-0000-0000-0000000009a5')$$);
SELECT tests.run('grant: a second order with the same coupon needs a new check',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :C5, 'הקופון לא אומת בקופה');

-- ---------- 4. האישור צר: קוד אחד, משתמש אחד, שעתיים ----------
SELECT tests.og_server('grant: a new check for GUARD10 (service)',
  $$SELECT public.check_coupon('GUARD10', 100, 'a0000000-0000-0000-0000-0000000009a5', NULL, false)$$);
SELECT tests.run('grant: ... GUARDB is still refused',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARDB'))$$, :C5, 'הקופון לא אומת בקופה');
SELECT tests.run('grant: ... and another customer cannot use it',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :C6, 'הקופון לא אומת בקופה');
UPDATE public.coupon_grants SET expires_at = now() - interval '1 minute' WHERE user_id = 'a0000000-0000-0000-0000-0000000009a5';
SELECT tests.run('grant: an expired grant is refused',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :C5, 'הקופון לא אומת בקופה');
SELECT tests.og_server('grant: a new check after the expiry (service)',
  $$SELECT public.check_coupon('GUARD10', 100, 'a0000000-0000-0000-0000-0000000009a5', NULL, false)$$);
SELECT tests.check('grant: ... refreshes it for two hours',
  $$SELECT expires_at > now() + interval '119 minutes' FROM public.coupon_grants
     WHERE user_id = 'a0000000-0000-0000-0000-0000000009a5' AND code = 'GUARD10'$$);

-- ---------- 5. אורח / שרת / צוות — בלי שינוי ----------
SELECT tests.run('staff: an admin places an order with a coupon without any grant',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details('GUARD10'))$$, :OA);
SELECT tests.og_server('server/guest: an order with a coupon and no user (place_guest_order style) is accepted',
  $$INSERT INTO public.orders (customer_id, status, kind, total, coupon_code, customer_name, customer_tax_id,
      customer_phone, customer_email, billing_city, billing_address, billing_zip)
    VALUES (NULL, 'pending', 'order', 0, 'GUARDB', 'אורח', '123456782', '0501234567', 'guest.guard@test.local',
            'ת"א', 'הרצל 1', '6100001')$$);
SELECT tests.check('server/guest: ... and the coupon was applied with no grant',
  $$SELECT count(*) = 1 FROM public.orders WHERE customer_email = 'guest.guard@test.local' AND coupon_code = 'GUARDB'$$);

-- ---------- 6. הגבלת קצב: 30 ל-10 דקות ----------
-- (הקריאה ל-place_order תלויה ב-g — אחרת Postgres מריץ אותה פעם אחת בלבד)
SELECT tests.run('rate: 29 orders in one burst are accepted',
  $$SELECT count(*) FROM generate_series(1, 29) g, LATERAL public.place_order('order', tests.og_items(), 18, true, tests.og_details() || jsonb_build_object('note', g::text))$$,
  :C7, NULL, 1);
SELECT tests.check('rate: (C7 now has 29 orders; the 30th is the last one allowed)',
  $$SELECT count(*) = 29 FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7'$$);
SELECT tests.run('rate: the 30th is accepted',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C7);
SELECT tests.run('rate: the 31st within 10 minutes is refused',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C7, 'יותר מדי הזמנות');
SELECT tests.run('rate: a direct INSERT is refused as well',
  $$INSERT INTO public.orders (customer_id, status, kind, total, customer_name, customer_tax_id, customer_phone,
      customer_email, billing_city, billing_address, billing_zip, terms_accepted_at)
    VALUES ('a0000000-0000-0000-0000-0000000009a7', 'pending', 'order', 0, 'x', '123456782', '0501234567',
      'x@test.local', 'ת"א', 'הרצל 1', '6100001', now())$$, :C7, 'יותר מדי הזמנות');
SELECT tests.check('rate: nothing was created by the refused attempts',
  $$SELECT count(*) = 30 FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7'$$);
SELECT tests.run('rate: another customer is not affected',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C6);
SELECT tests.run('rate: staff are not limited by it',
  $$SELECT count(*) FROM generate_series(1, 35) g, LATERAL public.place_order('order', tests.og_items(), 18, true, tests.og_details() || jsonb_build_object('note', g::text))$$,
  :OA, NULL, 1);
-- ההזמנות עברו את חלון 10 הדקות → שוב אפשר
UPDATE public.orders SET created_at = now() - interval '11 minutes' WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7';
SELECT tests.run('rate: after the 10-minute window the customer can order again',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C7);

-- ---------- 7. תקרה יומית: 300 ----------
-- C7 יש 31 הזמנות. 10 סבבים של 25 (תחת תקרת ה-10 דקות; אחרי כל סבב "ישנות" של שעתיים) → 281; ועוד 19 → 300
DO $$
DECLARE i integer;
BEGIN
  FOR i IN 1..10 LOOP
    PERFORM tests.run('rate24: batch ' || i,
      $q$SELECT count(*) FROM generate_series(1, 25) g, LATERAL public.place_order('order', tests.og_items(), 18, true, tests.og_details() || jsonb_build_object('note', g::text))$q$,
      'a0000000-0000-0000-0000-0000000009a7'::uuid, NULL, 1);
    UPDATE public.orders SET created_at = now() - interval '2 hours'
     WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7' AND created_at > now() - interval '1 hour';
  END LOOP;
  PERFORM tests.run('rate24: the last 19',
    $q$SELECT count(*) FROM generate_series(1, 19) g, LATERAL public.place_order('order', tests.og_items(), 18, true, tests.og_details() || jsonb_build_object('note', g::text))$q$,
    'a0000000-0000-0000-0000-0000000009a7'::uuid, NULL, 1);
  UPDATE public.orders SET created_at = now() - interval '2 hours'
   WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7' AND created_at > now() - interval '1 hour';
END $$;
SELECT tests.check('rate24: C7 has exactly 300 orders in the last 24 hours, none in the last 10 minutes',
  $$SELECT count(*) = 300 AND count(*) FILTER (WHERE created_at > now() - interval '10 minutes') = 0
      FROM public.orders WHERE customer_id = 'a0000000-0000-0000-0000-0000000009a7' AND created_at > now() - interval '24 hours'$$);
SELECT tests.run('rate24: the daily cap refuses the next order (outside the 10-minute window)',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C7, 'יותר מדי הזמנות');
SELECT tests.run('rate24: another customer is not affected by it',
  $$SELECT * FROM public.place_order('order', tests.og_items(), 18, true, tests.og_details())$$, :C5);

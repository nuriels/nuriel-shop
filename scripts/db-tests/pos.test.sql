-- ============================================================
-- חלק 32: קופה מהירה בניהול (admin_create_order) + חיפוש לקוחות + מדבקות ברקוד
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set AG  '''a0000000-0000-0000-0000-0000000000a2'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
\set PC  '''a0000000-0000-0000-0000-0000000000e7'''
\set PX  '''a0000000-0000-0000-0000-0000000000e8'''
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
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- ---------- נתונים: לקוח רשום (מחירון אישי), לקוח חסום, מוצרים, משלוח ----------
-- (הדרגים "רדומים" בחנות — force_single_price_tier — כל לקוח בדרג 1)
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000e7', 'pos.customer@test.local'),
  ('a0000000-0000-0000-0000-0000000000e8', 'pos.blocked@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_blocked) VALUES
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000e7', 'pos.customer@test.local', 'pos_customer', 'customer', true, false),
  ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000e8', 'pos.blocked@test.local', 'pos_blocked', 'customer', true, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, phone, city, business_address, zip_code, price_tier, price_list_type, age_confirmed)
VALUES ('a0000000-0000-0000-0000-0000000000e7', '70000000-0000-0000-0000-00000000000a', 'מאפיית הקופה', '052-7654321', 'חיפה', 'הנמל 5', '3100001', 1, 'custom', true),
       ('a0000000-0000-0000-0000-0000000000e8', '70000000-0000-0000-0000-00000000000a', 'לקוח חסום', NULL, NULL, NULL, NULL, 1, 'regular', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'בדיקת קופה') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, stock_quantity, barcode)
VALUES
  ('9f000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '94000001', 'מקלדת קופה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 100, 90, 10, '7290000000017'),
  ('9f000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', '94000002', 'עכבר קופה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 50, 45, 5, NULL),
  ('9f000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', '94000003', 'רישיון תוכנה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 30, 30, 0, NULL),
  ('9f000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000a', '94000004', 'ארגז משקה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 60, 60, 20, NULL),
  ('9f000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-00000000000a', '94000005', 'חולצת קופה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 80, 80, 0, NULL),
  ('9f000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-00000000000a', '94000006', 'מתנת קופה', 'בדיקת קופה', 'a0000000-0000-0000-0000-0000000000a1', 15, 15, 50, NULL)
ON CONFLICT DO NOTHING;
UPDATE public.global_products SET sale_price = 40, sale_starts_at = now() - interval '1 day', sale_ends_at = now() + interval '30 days'
 WHERE id = '9f000000-0000-0000-0000-000000000002';
-- מוצר דיגיטלי ווריאציות — פיצ'רים של פרימיום: חנות A עוברת לפרימיום לרגע ההגדרה
UPDATE public.tenant_subscriptions SET plan_type = 'premium' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
UPDATE public.global_products SET is_digital = true WHERE id = '9f000000-0000-0000-0000-000000000003';
UPDATE public.global_products SET has_deposit = true, deposit_price = 0.30, deposit_units = 6
 WHERE id = '9f000000-0000-0000-0000-000000000004';
UPDATE public.global_products SET variant_attributes = '[{"name":"מידה","values":["S","M"]}]'::jsonb
 WHERE id = '9f000000-0000-0000-0000-000000000005';
INSERT INTO public.product_variants (id, tenant_id, product_id, options, price, stock_quantity) VALUES
  ('9f100000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-000000000005', '{"מידה":"S"}', 70, 3),
  ('9f100000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', '9f000000-0000-0000-0000-000000000005', '{"מידה":"M"}', NULL, 2);
UPDATE public.tenant_subscriptions SET plan_type = 'basic' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
-- מחירון אישי ללקוח הרשום: מקלדת ב-85
INSERT INTO public.user_custom_prices (user_id, product_id, tenant_id, custom_price)
VALUES ('a0000000-0000-0000-0000-0000000000e7', '9f000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 85)
ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active) VALUES
  ('5f000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'שליח קופה', 'delivery', 30, true),
  ('5f000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', 'איסוף קופה', 'pickup', 0, true),
  ('5f000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', 'שליח כבוי', 'delivery', 10, false)
ON CONFLICT DO NOTHING;

-- ---------- הרשאות ----------
SELECT tests.run('pos: agent cannot create a POS order',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"אורח","customer_phone":"0501234567"}')$$,
  :AG, 'אין לך הרשאה מתאימה');
SELECT tests.run('pos: customer cannot create a POS order',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"אורח","customer_phone":"0501234567"}')$$,
  :PC, 'אין לך הרשאה מתאימה');
SELECT tests.run('pos: anonymous cannot call',
  $$SELECT * FROM public.admin_create_order(NULL, '[]', '{}')$$, NULL, 'permission denied');
SELECT tests.run('pos: admin of store B cannot sell store A products (on store A site)',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"אורח","customer_phone":"0501234567"}')$$,
  :B1, 'אין לך הרשאה מתאימה');

-- ---------- ולידציה ----------
SELECT tests.run('pos: empty cart refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[]', '{"customer_name":"אורח","customer_phone":"0501234567"}')$$, :OA, 'הוסיפו לפחות מוצר אחד');
SELECT tests.run('pos: guest without a name refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_phone":"0501234567"}')$$, :OA, 'נא להזין את שם הלקוח');
SELECT tests.run('pos: guest without a phone refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן"}')$$, :OA, 'נא להזין מספר טלפון');
SELECT tests.run('pos: bad phone refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"12"}')$$, :OA, 'מספר הטלפון אינו תקין');
SELECT tests.run('pos: bad email refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","customer_email":"not-an-email"}')$$, :OA, 'כתובת האימייל אינה תקינה');
SELECT tests.run('pos: zero quantity refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":0}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567"}')$$, :OA, 'כמות לא תקינה');
SELECT tests.run('pos: unknown product refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-0000000000ff","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567"}')$$, :OA, 'כבר לא קיים בקטלוג');
SELECT tests.run('pos: negative / garbage price refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1,"unit_price":"-5"}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567"}')$$, :OA, 'אינו תקין');
SELECT tests.run('pos: product with variants needs a variant',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000005","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567"}')$$, :OA, 'יש לבחור מידה');
SELECT tests.run('pos: shipping without a method refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","fulfillment":"shipping"}')$$, :OA, 'נא לבחור שיטת משלוח');
SELECT tests.run('pos: inactive shipping method refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","fulfillment":"shipping","shipping_method_id":"5f000000-0000-0000-0000-000000000003"}')$$, :OA, 'אינה זמינה עוד');
SELECT tests.run('pos: home delivery for a guest needs city + address',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","fulfillment":"shipping","shipping_method_id":"5f000000-0000-0000-0000-000000000001"}')$$, :OA, 'נא להזין עיר וכתובת');
SELECT tests.run('pos: bad zip refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","zip":"12"}')$$, :OA, 'מיקוד לא תקין');
SELECT tests.run('pos: unknown payment method refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","payment_method":"crypto"}')$$, :OA, 'אמצעי התשלום אינו תקין');
SELECT tests.run('pos: percent discount above 100 refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","discount":{"type":"percent","value":150}}')$$, :OA, 'עד 100%');
SELECT tests.run('pos: unknown discount type refused',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{"customer_name":"דנה כהן","customer_phone":"0501234567","discount":{"type":"gift","value":5}}')$$, :OA, 'סוג ההנחה אינו תקין');
SELECT tests.run('pos: blocked customer refused',
  $$SELECT * FROM public.admin_create_order('a0000000-0000-0000-0000-0000000000e8', '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{}')$$, :OA, 'חסום');
SELECT tests.run('pos: customer of another store refused',
  $$SELECT * FROM public.admin_create_order('a0000000-0000-0000-0000-0000000000b1', '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1}]', '{}')$$, :OA, 'הלקוח לא נמצא בחנות');
SELECT tests.check('pos: nothing was created by the refused attempts',
  $$SELECT count(*) = 0 FROM public.orders WHERE order_source = 'pos' AND tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('pos: stock untouched by the refused attempts',
  $$SELECT stock_quantity = 10 FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000001'$$);

-- ---------- 1. מכירה בחנות לאורח: מזומן, שולם, נמסר במקום ----------
SELECT tests.run('pos #1: guest in-store sale (cash, paid)',
  $$SELECT * FROM public.admin_create_order(NULL,
      '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":2},{"product_id":"9f000000-0000-0000-0000-000000000002","quantity":1}]',
      '{"customer_name":"  דנה   כהן ","customer_phone":"050-123-4567","customer_email":"Dana@Example.com","payment_method":"cash","note":"pos-1"}')$$,
  :OA, NULL, 1);
SELECT tests.check('pos #1: POS order, guest, details cleaned',
  $$SELECT order_source = 'pos' AND customer_id IS NULL AND customer_name = 'דנה כהן'
           AND customer_phone = '0501234567' AND customer_email = 'dana@example.com'
           AND customer_tax_id IS NULL AND created_by_staff_id = 'a0000000-0000-0000-0000-0000000000a1'
      FROM public.orders WHERE note = 'pos-1'$$);
SELECT tests.check('pos #1: guest price = tier 1, sale applies (2x100 + 40 = 240)',
  $$SELECT total = 240 AND discount_amount = 0 AND manual_discount_amount = 0 AND shipping_price = 0
      FROM public.orders WHERE note = 'pos-1'$$);
SELECT tests.check('pos #1: delivered on the spot (delivered_at + delivery event + item status)',
  $$SELECT o.status = 'delivered' AND o.delivered_at IS NOT NULL AND o.shipping_kind IS NULL
           AND EXISTS (SELECT 1 FROM public.order_delivery_events e WHERE e.order_id = o.id AND e.kind = 'delivered')
           AND NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id = o.id AND i.item_status <> 'delivered')
      FROM public.orders o WHERE o.note = 'pos-1'$$);
SELECT tests.check('pos #1: paid in cash (payment_status paid, confirmed by the admin)',
  $$SELECT pos_payment_method = 'cash' AND payment_method = 'offline' AND payment_status = 'paid'
           AND paid_at IS NOT NULL AND payment_confirmed_by = 'a0000000-0000-0000-0000-0000000000a1'
      FROM public.orders WHERE note = 'pos-1'$$);
SELECT tests.check('pos #1: stock reduced (10→8, 5→4)',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000001') = 8
       AND (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000002') = 4$$);
SELECT tests.check('pos #1: order number + VAT from the store + item snapshot',
  $$SELECT o.order_number ~ '^SH[0-9]{9}$' AND o.vat_rate = 18
           AND (SELECT string_agg(i.product_sku || ':' || i.product_barcode, ',' ORDER BY i.product_sku)
                  FROM public.order_items i WHERE i.order_id = o.id AND i.product_barcode IS NOT NULL) = '94000001:7290000000017'
      FROM public.orders o WHERE o.note = 'pos-1'$$);
SELECT tests.check('pos #1: admins notified like any guest order',
  $$SELECT EXISTS (SELECT 1 FROM public.staff_notifications n, public.orders o
                    WHERE o.note = 'pos-1' AND n.kind = 'new_order' AND n.body LIKE '%' || o.order_number)$$);

-- ---------- 2. לקוח רשום, משלוח עד הבית, הנחה באחוזים, תשלום בהמשך ----------
SELECT tests.run('pos #2: registered customer, delivery, 10% off, pay later',
  $$SELECT * FROM public.admin_create_order('a0000000-0000-0000-0000-0000000000e7',
      '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":2},{"product_id":"9f000000-0000-0000-0000-000000000002","quantity":2}]',
      '{"fulfillment":"shipping","shipping_method_id":"5f000000-0000-0000-0000-000000000001","payment_method":"later","paid":true,"discount":{"type":"percent","value":10},"note":"pos-2"}')$$,
  :OA, NULL, 1);
SELECT tests.check('pos #2: customer prices — custom price 85, sale 40 beats the regular 50',
  $$SELECT string_agg(i.product_sku || '=' || trim_scale(i.unit_price)::text, ',' ORDER BY i.product_sku) = '94000001=85,94000002=40'
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id WHERE o.note = 'pos-2'$$);
SELECT tests.check('pos #2: products 250, 10% = 25, shipping 30 → total 255',
  $$SELECT manual_discount_type = 'percent' AND manual_discount_value = 10 AND manual_discount_amount = 25
           AND discount_amount = 25 AND shipping_price = 30 AND total = 255
      FROM public.orders WHERE note = 'pos-2'$$);
SELECT tests.check('pos #2: address from the customer profile, contact from the account',
  $$SELECT customer_id = 'a0000000-0000-0000-0000-0000000000e7' AND customer_name = 'מאפיית הקופה'
           AND billing_city = 'חיפה' AND billing_address = 'הנמל 5' AND billing_zip = '3100001'
           AND customer_phone = '0527654321' AND customer_email = 'pos.customer@test.local'
           AND shipping_kind = 'delivery' AND shipping_method_name = 'שליח קופה'
      FROM public.orders WHERE note = 'pos-2'$$);
SELECT tests.check('pos #2: pay later — not paid, status pending (regular flow)',
  $$SELECT pos_payment_method = 'later' AND payment_status = 'not_required' AND paid_at IS NULL
           AND status = 'pending'
      FROM public.orders WHERE note = 'pos-2'$$);

-- ---------- 3. מחיר ידני, הנחה בסכום גדול מהמוצרים, איסוף, ביט ----------
SELECT tests.run('pos #3: manual unit price + fixed discount larger than the products',
  $$SELECT * FROM public.admin_create_order(NULL,
      '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":1,"unit_price":"77.5"}]',
      '{"customer_name":"משה לוי","customer_phone":"+972 52-111-2233","fulfillment":"shipping","shipping_method_id":"5f000000-0000-0000-0000-000000000002","payment_method":"bit","discount":{"type":"fixed","value":"500"},"note":"pos-3"}')$$,
  :OA, NULL, 1);
SELECT tests.check('pos #3: the admin price is kept, discount capped at the products (total 0)',
  $$SELECT (SELECT unit_price FROM public.order_items i WHERE i.order_id = o.id) = 77.5
           AND o.manual_discount_amount = 77.5 AND o.total = 0 AND o.shipping_kind = 'pickup'
           AND o.pos_payment_method = 'bit' AND o.payment_status = 'paid' AND o.customer_phone = '+972521112233'
      FROM public.orders o WHERE o.note = 'pos-3'$$);

-- ---------- 4. פיקדון, וריאציה עם מחיר ומלאי משלה, מוצר דיגיטלי ----------
SELECT tests.run('pos #4: deposit product + variant + digital',
  $$SELECT * FROM public.admin_create_order(NULL,
      '[{"product_id":"9f000000-0000-0000-0000-000000000004","quantity":2},{"product_id":"9f000000-0000-0000-0000-000000000005","variant_id":"9f100000-0000-0000-0000-000000000001","quantity":1},{"product_id":"9f000000-0000-0000-0000-000000000003","quantity":1}]',
      '{"customer_name":"רונית","customer_phone":"0549998877","payment_method":"card","note":"pos-4"}')$$,
  :OA, NULL, 1);
SELECT tests.check('pos #4: one deposit line per product (2 units × 0.30 × 6 = 1.80 each)',
  $$SELECT count(*) = 1 AND min(i.quantity) = 2 AND min(i.unit_price) = 1.80
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
     WHERE o.note = 'pos-4' AND i.is_deposit$$);
SELECT tests.check('pos #4: variant price 70 + label, variant stock 3→2',
  $$SELECT i.unit_price = 70 AND i.variant_label = 'S'
           AND (SELECT stock_quantity FROM public.product_variants WHERE id = '9f100000-0000-0000-0000-000000000001') = 2
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
     WHERE o.note = 'pos-4' AND i.variant_id IS NOT NULL$$);
SELECT tests.check('pos #4: total = 2×60 + 3.60 deposit + 70 + 30 digital = 223.60',
  $$SELECT total = 223.60 FROM public.orders WHERE note = 'pos-4'$$);
SELECT tests.check('pos #4: digital line awaits its license',
  $$SELECT i.is_digital AND i.item_status = 'awaiting_license'
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
     WHERE o.note = 'pos-4' AND i.product_id = '9f000000-0000-0000-0000-000000000003'$$);

-- ---------- 5. דיגיטלי בלבד במקום → shipping_kind digital ----------
SELECT tests.run('pos #5: digital only, in store',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000003","quantity":1}]',
      '{"customer_name":"רונית","customer_phone":"0549998877","note":"pos-5"}')$$, :OA, NULL, 1);
SELECT tests.check('pos #5: shipping kind digital, default payment cash + paid',
  $$SELECT shipping_kind = 'digital' AND pos_payment_method = 'cash' AND payment_status = 'paid'
      FROM public.orders WHERE note = 'pos-5'$$);

-- ---------- 6. מתנה לפי הטבת החנות ----------
INSERT INTO public.cart_promotions (id, tenant_id, name, condition_type, min_subtotal, gift_product_id, gift_quantity)
VALUES ('9f200000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'מתנה מעל 150 (קופה)', 'min_subtotal', 150,
        '9f000000-0000-0000-0000-000000000006', 1)
ON CONFLICT DO NOTHING;
SELECT tests.run('pos #6: order above the promotion threshold',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"9f000000-0000-0000-0000-000000000001","quantity":2}]',
      '{"customer_name":"גיל","customer_phone":"0531112222","note":"pos-6"}')$$, :OA, NULL, 1);
SELECT tests.check('pos #6: the store gift was added (free)',
  $$SELECT EXISTS (SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
                    WHERE o.note = 'pos-6' AND i.is_gift AND i.unit_price = 0
                      AND i.product_id = '9f000000-0000-0000-0000-000000000006')$$);
UPDATE public.cart_promotions SET is_active = false WHERE id = '9f200000-0000-0000-0000-000000000001';

-- ---------- שמירה על הכללים הקיימים ----------
SELECT tests.run('guard: customer cannot mark their own order as POS / give a discount',
  $$INSERT INTO public.orders (customer_id, kind, order_source, manual_discount_type, manual_discount_value, pos_payment_method, note)
    VALUES ('a0000000-0000-0000-0000-0000000000e7', 'order', 'pos', 'percent', 50, 'cash', 'guard-1')$$, :PC, NULL, 1);
SELECT tests.check('guard: stored as a regular web order, no discount / POS payment',
  $$SELECT order_source = 'web' AND manual_discount_type IS NULL AND manual_discount_value IS NULL
           AND pos_payment_method IS NULL AND created_by_staff_id IS NULL
      FROM public.orders WHERE note = 'guard-1'$$);
SELECT tests.server('guard: a web guest order still needs the full checkout details',
  $$INSERT INTO public.orders (tenant_id, customer_id, kind, customer_name, customer_phone, order_source)
    VALUES ('70000000-0000-0000-0000-00000000000a', NULL, 'order', 'אורח', '0501234567', 'pos')$$,
  'orders_guest_details_check');
SELECT tests.run('guard: POS source cannot be changed afterwards',
  $$UPDATE public.orders SET order_source = 'web', created_by_staff_id = NULL WHERE note = 'pos-1'$$, :OA, NULL, 1);
SELECT tests.check('guard: still POS, creator kept',
  $$SELECT order_source = 'pos' AND created_by_staff_id = 'a0000000-0000-0000-0000-0000000000a1'
      FROM public.orders WHERE note = 'pos-1'$$);
SELECT tests.run('guard: admin changes the manual discount of an order → total recalculated',
  $$UPDATE public.orders SET manual_discount_type = 'fixed', manual_discount_value = 20 WHERE note = 'pos-2'$$, :OA, NULL, 1);
SELECT tests.check('guard: 250 − 20 + 30 = 260',
  $$SELECT manual_discount_amount = 20 AND discount_amount = 20 AND total = 260
      FROM public.orders WHERE note = 'pos-2'$$);
UPDATE public.orders SET agent_id = 'a0000000-0000-0000-0000-0000000000a2' WHERE note = 'pos-2';
SELECT tests.run('guard: agent of the order cannot change the discount / POS payment',
  $$UPDATE public.orders SET manual_discount_value = 90, pos_payment_method = 'cash' WHERE note = 'pos-2'$$, :AG, NULL, 1);
SELECT tests.check('guard: discount + payment unchanged',
  $$SELECT manual_discount_value = 20 AND pos_payment_method = 'later' AND total = 260
      FROM public.orders WHERE note = 'pos-2'$$);
-- ביטול הזמנת קופה מחזיר את המלאי (הטריגר הרגיל orders_stock_sync):
-- מקלדת 10 → 8 (#1) → 6 (#2) → 5 (#3) → 3 (#6); מתנה 50 → 49
SELECT tests.check('stock before the cancel: keyboard 3, gift 49',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000001') = 3
       AND (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000006') = 49$$);
SELECT tests.run('admin cancels POS order #6',
  $$UPDATE public.orders SET status = 'cancelled' WHERE note = 'pos-6'$$, :OA, NULL, 1);
SELECT tests.check('cancelled POS order: keyboard back to 5, gift back to 50',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000001') = 5
       AND (SELECT stock_quantity FROM public.global_products WHERE id = '9f000000-0000-0000-0000-000000000006') = 50$$);

-- קופון + הנחה ידנית באותה הזמנה (הזמנה ידנית רגילה של מנהל): שתיהן נספרות
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value)
VALUES ('70000000-0000-0000-0000-00000000000a', 'POSTEN', 'percent', 10) ON CONFLICT DO NOTHING;
SELECT tests.run('admin order with coupon POSTEN (10%) + manual ₪30 off',
  $$INSERT INTO public.orders (customer_id, kind, coupon_code, manual_discount_type, manual_discount_value, note)
    VALUES ('a0000000-0000-0000-0000-0000000000e7', 'order', 'posten', 'fixed', 30, 'pos-coupon')$$, :OA, NULL, 1);
SELECT tests.run('admin adds 2 x 100 to it',
  $$INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
    SELECT id, '9f000000-0000-0000-0000-000000000001', 2, 100 FROM public.orders WHERE note = 'pos-coupon'$$, :OA, NULL, 1);
SELECT tests.check('coupon 20 + manual 30 = discount 50, total 150, web order opened by the admin',
  $$SELECT coupon_code = 'POSTEN' AND manual_discount_amount = 30 AND discount_amount = 50 AND total = 150
           AND order_source = 'web' AND created_by_staff_id = 'a0000000-0000-0000-0000-0000000000a1'
      FROM public.orders WHERE note = 'pos-coupon'$$);
SELECT tests.run('manual discount bigger than what the coupon left → capped (total 0)',
  $$UPDATE public.orders SET manual_discount_value = 999 WHERE note = 'pos-coupon'$$, :OA, NULL, 1);
SELECT tests.check('coupon 20 + manual capped at 180 → total 0',
  $$SELECT manual_discount_amount = 180 AND discount_amount = 200 AND total = 0
      FROM public.orders WHERE note = 'pos-coupon'$$);

-- ---------- מחיר ללקוח ----------
SELECT tests.run('pos_unit_price: agent refused',
  $$SELECT public.pos_unit_price(NULL, '9f000000-0000-0000-0000-000000000001')$$, :AG, 'אין הרשאה');
SELECT tests.run('pos_unit_price: admin gets guest / customer / variant prices',
  $$SELECT 1 WHERE public.pos_unit_price(NULL, '9f000000-0000-0000-0000-000000000001') = 100
               AND public.pos_unit_price('a0000000-0000-0000-0000-0000000000e7', '9f000000-0000-0000-0000-000000000001') = 85
               AND public.pos_unit_price('a0000000-0000-0000-0000-0000000000e7', '9f000000-0000-0000-0000-000000000002') = 40
               AND public.pos_unit_price(NULL, '9f000000-0000-0000-0000-000000000005', '9f100000-0000-0000-0000-000000000002') = 80$$,
  :OA, NULL, 1);

-- ---------- חיפוש לקוחות ----------
SELECT tests.run('search: agent refused', $$SELECT * FROM public.admin_search_customers('דנה')$$, :AG, 'אין הרשאה');
SELECT tests.run('search: registered customer by name',
  $$SELECT * FROM public.admin_search_customers('מאפיית') WHERE kind = 'account' AND customer_id = 'a0000000-0000-0000-0000-0000000000e7'
       AND price_tier = 1 AND price_list_type = 'custom' AND orders_count >= 2$$, :OA, NULL, 1);
SELECT tests.run('search: registered customer by phone (+972 form)',
  $$SELECT * FROM public.admin_search_customers('+972-52-765') WHERE customer_id = 'a0000000-0000-0000-0000-0000000000e7'$$, :OA, NULL, 1);
SELECT tests.run('search: previous guest buyer by phone, with the latest details',
  $$SELECT * FROM public.admin_search_customers('0501234567') WHERE kind = 'guest' AND name = 'דנה כהן'
       AND email = 'dana@example.com' AND orders_count = 1$$, :OA, NULL, 1);
SELECT tests.run('search: guest by email (case-insensitive)',
  $$SELECT * FROM public.admin_search_customers('DANA@') WHERE kind = 'guest'$$, :OA, NULL, 1);
SELECT tests.run('search: blocked customers hidden',
  $$SELECT * FROM public.admin_search_customers('חסום')$$, :OA, NULL, 0);
SELECT tests.run('search: LIKE wildcards are literal',
  $$SELECT * FROM public.admin_search_customers('%')$$, :OA, NULL, 0);
SELECT tests.run('search: empty term → recent customers (up to 8)',
  $$SELECT 1 FROM (SELECT count(*) AS n FROM public.admin_search_customers('')) s WHERE s.n BETWEEN 1 AND 8$$, :OA, NULL, 1);
SELECT tests.run('search: store B admin sees nothing of store A (on store B site)',
  $$SELECT * FROM public.admin_search_customers('דנה')$$, :B1, 'אין הרשאה');

-- ---------- מדבקות ברקוד: גודל המדבקה של החנות ----------
SELECT tests.check('labels: default size 70×40',
  $$SELECT barcode_label_width_mm = 70 AND barcode_label_height_mm = 40
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.run('labels: admin saves 58×40',
  $$UPDATE public.site_settings SET barcode_label_width_mm = 58, barcode_label_height_mm = 40 WHERE id = true$$, :OA, NULL, 1);
SELECT tests.run('labels: 10 mm wide refused',
  $$UPDATE public.site_settings SET barcode_label_width_mm = 10 WHERE id = true$$, :OA, 'site_settings_barcode_label_size_check');
SELECT tests.run('labels: agent cannot change the size',
  $$UPDATE public.site_settings SET barcode_label_width_mm = 100 WHERE id = true$$, :AG, NULL, 0);
UPDATE public.site_settings SET barcode_label_width_mm = 70, barcode_label_height_mm = 40
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';

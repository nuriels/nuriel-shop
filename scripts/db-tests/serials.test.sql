-- ============================================================
-- חלק 35: מספרים סידוריים (קליטה, שיוך בליקוט / בקופה, אין משלוח בלי מספר,
-- ביטול מחזיר למלאי, אחריות), שמירת שבת וחג אוטומטית (שעון ישראל), ומינימום
-- להזמנה. חנות B: b1 בעלים, b2 מנהל; כאן נוספים קופאי, מחסנאי ולקוח.
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
\set SC  '''a0000000-0000-0000-0000-0000000000e2'''
\set SW  '''a0000000-0000-0000-0000-0000000000e3'''
\set SU  '''a0000000-0000-0000-0000-0000000000e4'''
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
-- פרטי קופה תקינים (איסוף עצמי בחנות B)
CREATE OR REPLACE FUNCTION tests.s35_details() RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_object(
    'customer_name', 'לקוח סריאלים', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
    'customer_email', 'ser.customer@test.local',
    'billing_city', 'חיפה', 'billing_address', 'הנמל 3', 'billing_zip', '3100001',
    'accepted_terms', true, 'shipping_method_id', '5e000000-0000-0000-0000-0000000000b5',
    'payment_method', 'offline');
$f$;
CREATE OR REPLACE FUNCTION tests.s35_items(_qty INTEGER) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $f$
  SELECT jsonb_build_array(jsonb_build_object(
    'product_id', '8a000000-0000-0000-0000-000000000002', 'quantity', _qty, 'unit_price', 100));
$f$;
-- שעון ישראל עכשיו ± דקות, בפורמט של רשימת החגים
CREATE OR REPLACE FUNCTION tests.s35_local(_minutes INTEGER) RETURNS TEXT LANGUAGE sql STABLE AS $f$
  SELECT to_char((now() AT TIME ZONE 'Asia/Jerusalem') + make_interval(mins => _minutes), 'YYYY-MM-DD"T"HH24:MI');
$f$;
GRANT USAGE ON SCHEMA tests TO anon, authenticated;
GRANT EXECUTE ON FUNCTION tests.s35_details(), tests.s35_items(INTEGER), tests.s35_local(INTEGER) TO anon, authenticated;
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

-- ---------- נתונים ----------
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000e2', 'ser.cashier@test.local'),
  ('a0000000-0000-0000-0000-0000000000e3', 'ser.warehouse@test.local'),
  ('a0000000-0000-0000-0000-0000000000e4', 'ser.customer@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000e2', 'ser.cashier@test.local', 'ser_cashier', 'cashier', true, 'קופאי סריאלים'),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000e3', 'ser.warehouse@test.local', 'ser_warehouse', 'warehouse', true, 'מחסנאי סריאלים'),
  ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000e4', 'ser.customer@test.local', 'ser_customer', 'customer', true, NULL)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, phone, city, business_address, zip_code, price_tier, age_confirmed, profile_completed)
VALUES ('a0000000-0000-0000-0000-0000000000e4', '70000000-0000-0000-0000-00000000000b', 'לקוח סריאלים', '0501234567', 'חיפה', 'הנמל 3', '3100001', 1, true, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active)
VALUES ('5e000000-0000-0000-0000-0000000000b5', '70000000-0000-0000-0000-00000000000b', 'איסוף (סריאלים)', 'pickup', 0, true)
ON CONFLICT DO NOTHING;
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000b', 'בדיקת סריאלים') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, stock_quantity, requires_serial, warranty_months) VALUES
  ('8a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '97100001', 'נתב סריאלי', 'בדיקת סריאלים', 'a0000000-0000-0000-0000-0000000000b1', 300, 300, 0, true, 12),
  ('8a000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000b', '97100002', 'כבל רגיל', 'בדיקת סריאלים', 'a0000000-0000-0000-0000-0000000000b1', 100, 100, 200, false, 0),
  ('8a000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000b', '97100003', 'מתג ותיק', 'בדיקת סריאלים', 'a0000000-0000-0000-0000-0000000000b1', 150, 150, 3, false, 0),
  ('8a000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000b', '97100004', 'מטען בלי אחריות', 'בדיקת סריאלים', 'a0000000-0000-0000-0000-0000000000b1', 50, 50, 0, true, 0)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 1. מבנה
-- ============================================================
SELECT tests.check('schema: products.requires_serial + warranty_months, defaults false / 0',
  $$SELECT count(*) = 2 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'global_products'
       AND ((column_name = 'requires_serial' AND column_default = 'false')
            OR (column_name = 'warranty_months' AND column_default = '0'))$$);
SELECT tests.check('schema: product_serials.status is an enum in_stock / sold',
  $$SELECT enum_range(NULL::public.product_serial_status)::text = '{in_stock,sold}'$$);
SELECT tests.check('schema: order_items.serial_number + warranty_until + serial_required',
  $$SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'order_items'
       AND column_name IN ('serial_number', 'warranty_until', 'serial_required')$$);
SELECT tests.check('schema: serial unique per product and store',
  $$SELECT indexdef LIKE '%UNIQUE%(tenant_id, product_id, serial_number)%' FROM pg_indexes
     WHERE indexname = 'product_serials_unique_per_product'$$);
SELECT tests.check('schema: RLS on product_serials (tenant isolation, restrictive)',
  $$SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_serials'::regclass$$);
SELECT tests.check('schema: anon cannot read product_serials',
  $$SELECT NOT has_table_privilege('anon', 'public.product_serials', 'SELECT')$$);
SELECT tests.check('schema: authenticated cannot write product_serials directly',
  $$SELECT NOT has_table_privilege('authenticated', 'public.product_serials', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.product_serials', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'public.product_serials', 'DELETE')$$);

-- ============================================================
-- 2. מלאי של מוצר סריאלי — רק דרך קליטה
-- ============================================================
SELECT tests.run('stock: new serial product with stock 5 → rejected',
  $$INSERT INTO public.global_products (tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, requires_serial)
    VALUES ('70000000-0000-0000-0000-00000000000b', '97100099', 'נתב חדש', 'בדיקת סריאלים', 'a0000000-0000-0000-0000-0000000000b1', 10, 5, true)$$,
  :B1, 'נשמר עם מלאי 0');
SELECT tests.run('stock: digital product cannot require a serial',
  $$UPDATE public.global_products SET is_digital = true WHERE id = '8a000000-0000-0000-0000-000000000004'$$,
  :B1, 'global_products_serial_physical_check');
SELECT tests.run('stock: admin raises the stock of a serial product directly → rejected',
  $$UPDATE public.global_products SET stock_quantity = 4 WHERE id = '8a000000-0000-0000-0000-000000000001'$$,
  :B1, 'קליטת סחורה');
SELECT tests.run('stock: lowering is allowed (still 0 → 0 ok)',
  $$UPDATE public.global_products SET stock_quantity = 0 WHERE id = '8a000000-0000-0000-0000-000000000001'$$,
  :B1, NULL, 1);
SELECT tests.run('stock: a regular product is not affected',
  $$UPDATE public.global_products SET stock_quantity = 210 WHERE id = '8a000000-0000-0000-0000-000000000002'$$,
  :B1, NULL, 1);

-- ============================================================
-- 3. קליטת סחורה
-- ============================================================
SELECT tests.run('receive: cashier → no permission',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['AA-1'])$$, :SC, 'אין לך הרשאה');
SELECT tests.run('receive: customer → no permission',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['AA-1'])$$, :SU, 'אין לך הרשאה');
SELECT tests.run('receive: owner of another store → no permission',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['AA-1'])$$, :OA, 'אין לך הרשאה');
SELECT tests.run('receive: empty list → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['  ', ''])$$, :SW, 'לפחות מספר סידורי');
SELECT tests.run('receive: invalid characters → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['AB$%'])$$, :SW, 'מספר סידורי לא תקין');
SELECT tests.run('receive: the same serial twice in the list → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['rt-100', 'RT-100'])$$, :SW, 'יותר מפעם אחת');
SELECT tests.run('receive: product that does not require serials → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000002', ARRAY['X1'])$$, :SW, 'לא מוגדר');
SELECT tests.run('receive: warehouse scans 4 units (spaces / lower case cleaned)',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY[' rt-100 ', 'RT-101', E'rt-102\r', 'RT 103'])$$, :SW, NULL, 1);
SELECT tests.check('receive: stock went up by 4, serials stored normalized and in stock',
  $$SELECT gp.stock_quantity = 4
       AND (SELECT array_agg(serial_number ORDER BY serial_number) FROM public.product_serials
             WHERE product_id = gp.id) = ARRAY['RT-100', 'RT-101', 'RT-102', 'RT103']
       AND (SELECT bool_and(status = 'in_stock' AND received_by = 'a0000000-0000-0000-0000-0000000000e3')
              FROM public.product_serials WHERE product_id = gp.id)
      FROM public.global_products gp WHERE gp.id = '8a000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('receive: a serial already in stock → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000001', ARRAY['RT-200', 'rt-101'])$$, :SW, 'כבר קיים במלאי');
SELECT tests.check('receive: a failed batch adds nothing',
  $$SELECT count(*) = 4 FROM public.product_serials WHERE product_id = '8a000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('receive: owner can receive too',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000004', ARRAY['CH-1', 'CH-2'])$$, :B1, NULL, 1);
SELECT tests.run('serials: no direct insert by an admin',
  $$INSERT INTO public.product_serials (product_id, serial_number) VALUES ('8a000000-0000-0000-0000-000000000001', 'HACK-1')$$,
  :B1, 'permission denied');
SELECT tests.run('serials: warehouse reads the table (store B only)',
  $$SELECT * FROM public.product_serials WHERE product_id = '8a000000-0000-0000-0000-000000000001'$$, :SW, NULL, 4);
SELECT tests.run('serials: customer reads nothing',
  $$SELECT * FROM public.product_serials$$, :SU, NULL, 0);

-- רישום יחידות קיימות (מוצר שעבר עכשיו למספרים סידוריים)
SELECT tests.run('existing: switch the old switch to "requires serial" (stock 3 stays)',
  $$UPDATE public.global_products SET requires_serial = true, warranty_months = 24 WHERE id = '8a000000-0000-0000-0000-000000000003'$$,
  :B1, NULL, 1);
SELECT tests.check('existing: 3 units without a serial',
  $$SELECT public.product_serial_gap('8a000000-0000-0000-0000-000000000003') = 3$$);
SELECT tests.run('existing: register 2 existing units',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000003', ARRAY['SW-1', 'SW-2'], 'existing')$$, :SW, NULL, 1);
SELECT tests.check('existing: stock unchanged (3), gap 1',
  $$SELECT gp.stock_quantity = 3 AND public.product_serial_gap(gp.id) = 1
      FROM public.global_products gp WHERE gp.id = '8a000000-0000-0000-0000-000000000003'$$);
SELECT tests.run('existing: 2 more than the units without a serial → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000003', ARRAY['SW-3', 'SW-4'], 'existing')$$, :SW, 'רק 1 יחידות');
SELECT tests.run('existing: bad mode → rejected',
  $$SELECT public.product_serials_receive('8a000000-0000-0000-0000-000000000003', ARRAY['SW-3'], 'magic')$$, :SW, 'סוג הקליטה');

-- ============================================================
-- 4. הזמנה: שורה דורשת מספר סידורי, אין משלוח בלי מספר לכל יחידה
-- ============================================================
SELECT tests.run('order: admin opens an order with 2 routers + 1 cable',
  $$INSERT INTO public.orders (id, customer_id, kind, note) VALUES ('8a300000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000e4', 'order', 'ser-order-1');
    INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price, serial_number, serial_required) VALUES
      ('8a400000-0000-0000-0000-000000000001', '8a300000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001', 2, 300, 'FAKE-1', false),
      ('8a400000-0000-0000-0000-000000000002', '8a300000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000002', 1, 100, NULL, true)$$,
  :B1);
SELECT tests.check('order: serial_required decided by the DB (router yes, cable no), serial from the browser ignored',
  $$SELECT bool_and(CASE WHEN product_id = '8a000000-0000-0000-0000-000000000001'
                         THEN serial_required AND serial_number IS NULL
                         ELSE NOT serial_required END)
      FROM public.order_items WHERE order_id = '8a300000-0000-0000-0000-000000000001'$$);
SELECT tests.check('order: 2 units reserved from the router stock (4 → 2)',
  $$SELECT stock_quantity = 2 FROM public.global_products WHERE id = '8a000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('order: admin cannot write serial_number directly (kept)',
  $$UPDATE public.order_items SET serial_number = 'HACK', warranty_until = '2099-01-01' WHERE id = '8a400000-0000-0000-0000-000000000001'$$,
  :B1, NULL, 1);
SELECT tests.check('order: … still empty',
  $$SELECT serial_number IS NULL AND warranty_until IS NULL FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000001'$$);
SELECT tests.run('order: shipped without serials → rejected',
  $$UPDATE public.orders SET status = 'shipped' WHERE id = '8a300000-0000-0000-0000-000000000001'$$,
  :B1, 'הוזנו 0 מתוך 2');
SELECT tests.run('order: awaiting_courier without serials → rejected too',
  $$UPDATE public.orders SET status = 'awaiting_courier' WHERE id = '8a300000-0000-0000-0000-000000000001'$$,
  :B1, 'ממתינה לשליח');
SELECT tests.run('order: picking is fine without serials',
  $$UPDATE public.orders SET status = 'picking' WHERE id = '8a300000-0000-0000-0000-000000000001'$$, :B1, NULL, 1);
SELECT tests.run('missing: orders_missing_serials (admin) → 1 row with 0 of 2',
  $$SELECT * FROM public.orders_missing_serials(ARRAY['8a300000-0000-0000-0000-000000000001'::uuid]) WHERE assigned = 0 AND required = 2$$,
  :B1, NULL, 1);
SELECT tests.run('missing: customer → no permission',
  $$SELECT * FROM public.orders_missing_serials(ARRAY['8a300000-0000-0000-0000-000000000001'::uuid])$$, :SU, 'אין הרשאה');

-- ============================================================
-- 5. שיוך ("קלט חכם")
-- ============================================================
SELECT tests.run('available: warehouse sees the 4 free routers (oldest first)',
  $$SELECT * FROM public.product_serials_available('8a000000-0000-0000-0000-000000000001')$$, :SW, NULL, 4);
SELECT tests.run('available: search narrows the list',
  $$SELECT * FROM public.product_serials_available('8a000000-0000-0000-0000-000000000001', 'rt-10')$$, :SW, NULL, 3);
SELECT tests.run('available: cashier (POS) can list too',
  $$SELECT * FROM public.product_serials_available('8a000000-0000-0000-0000-000000000001')$$, :SC, NULL, 4);
SELECT tests.run('available: customer → no permission',
  $$SELECT * FROM public.product_serials_available('8a000000-0000-0000-0000-000000000001')$$, :SU, 'אין הרשאה');
SELECT tests.run('assign: cashier cannot assign in an order',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-100')$$, :SC, 'אין לך הרשאה');
SELECT tests.run('assign: serial of another product → clear error',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'SW-1')$$, :SW, 'שייך למוצר אחר: "מתג ותיק"');
SELECT tests.run('assign: unknown serial → receive it first',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-999')$$, :SW, 'לא נמצא במלאי');
SELECT tests.run('assign: empty scan → rejected',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', '   ')$$, :SW, 'נא להזין');
SELECT tests.run('assign: a line without serials (cable) → rejected',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000002', 'RT-100')$$, :SW, 'לא מוגדר כמוצר עם מספר סידורי');
SELECT tests.run('assign: warehouse scans rt-100 (lower case) → assigned 1 of 2',
  $$SELECT 1 WHERE (public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', ' rt-100 ') ->> 'assigned')::int = 1$$,
  :SW, NULL, 1);
SELECT tests.check('assign: serial sold, linked to the order, warranty = order date + 12 months',
  $$SELECT ps.status = 'sold' AND ps.order_id = '8a300000-0000-0000-0000-000000000001'
       AND ps.order_item_id = '8a400000-0000-0000-0000-000000000001' AND ps.sold_at IS NOT NULL
       AND ps.warranty_until = ((o.created_at AT TIME ZONE 'Asia/Jerusalem')::date + interval '12 months')::date
      FROM public.product_serials ps JOIN public.orders o ON o.id = ps.order_id
     WHERE ps.serial_number = 'RT-100'$$);
SELECT tests.check('assign: order line shows the serial + warranty date',
  $$SELECT oi.serial_number = 'RT-100' AND oi.warranty_until IS NOT NULL
      FROM public.order_items oi WHERE oi.id = '8a400000-0000-0000-0000-000000000001'$$);
SELECT tests.run('assign: the same serial again → already on this line',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-100')$$, :SW, 'כבר משויך לשורה הזו');
SELECT tests.run('assign: still 1 of 2 → cannot ship',
  $$UPDATE public.orders SET status = 'shipped' WHERE id = '8a300000-0000-0000-0000-000000000001'$$, :B1, 'הוזנו 1 מתוך 2');
SELECT tests.run('assign: line with serials cannot switch product',
  $$UPDATE public.order_items SET product_id = '8a000000-0000-0000-0000-000000000004' WHERE id = '8a400000-0000-0000-0000-000000000001'$$,
  :B1, 'לפני החלפת המוצר');
SELECT tests.run('assign: second unit RT-101 (owner)',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-101')$$, :B1, NULL, 1);
SELECT tests.check('assign: line lists both serials',
  $$SELECT serial_number IN ('RT-100, RT-101') FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000001'$$);
SELECT tests.run('assign: a third → all units already have a serial',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-102')$$, :SW, 'כבר שויך מספר סידורי');
SELECT tests.run('assign: quantity below the assigned count → rejected',
  $$UPDATE public.order_items SET quantity = 1 WHERE id = '8a400000-0000-0000-0000-000000000001'$$, :B1, 'הסירו קודם מספר סידורי');
SELECT tests.run('order: all serials in → shipped',
  $$UPDATE public.orders SET status = 'shipped' WHERE id = '8a300000-0000-0000-0000-000000000001'$$, :B1, NULL, 1);
SELECT tests.run('order: shipped → delivered (already left, no re-check)',
  $$UPDATE public.orders SET status = 'delivered' WHERE id = '8a300000-0000-0000-0000-000000000001'$$, :B1, NULL, 1);
SELECT tests.run('order_serial_lines: warehouse sees the serial line of the order (not the cable)',
  $$SELECT * FROM public.order_serial_lines('8a300000-0000-0000-0000-000000000001') WHERE serial_number = 'RT-100, RT-101'$$, :SW, NULL, 1);
SELECT tests.run('order_serial_lines: cashier → no permission',
  $$SELECT * FROM public.order_serial_lines('8a300000-0000-0000-0000-000000000001')$$, :SC, 'אין הרשאה');
SELECT tests.run('order_item_serials: warehouse sees the 2 serials of the line',
  $$SELECT * FROM public.order_item_serials('8a400000-0000-0000-0000-000000000001')$$, :SW, NULL, 2);
SELECT tests.run('customer: sees serial + warranty on their own order line',
  $$SELECT 1 FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000001' AND serial_number = 'RT-100, RT-101' AND warranty_until IS NOT NULL$$,
  :SU, NULL, 1);

-- הסרת שיוך
SELECT tests.run('unassign: warehouse after delivery → only a manager',
  $$SELECT public.order_item_unassign_serial('8a400000-0000-0000-0000-000000000001', (SELECT id FROM public.product_serials WHERE serial_number = 'RT-101'))$$,
  :SW, 'רק מנהל');
SELECT tests.run('unassign: owner removes RT-101 (wrong scan)',
  $$SELECT public.order_item_unassign_serial('8a400000-0000-0000-0000-000000000001', (SELECT id FROM public.product_serials WHERE serial_number = 'RT-101'))$$,
  :B1, NULL, 1);
SELECT tests.check('unassign: RT-101 back in stock, line shows only RT-100',
  $$SELECT (SELECT status = 'in_stock' AND order_id IS NULL AND warranty_until IS NULL FROM public.product_serials WHERE serial_number = 'RT-101')
       AND (SELECT serial_number = 'RT-100' FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000001')$$);
SELECT tests.run('unassign: owner puts RT-102 instead',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000001', 'RT-102')$$, :B1, NULL, 1);

-- הזמנה שנייה: מספר שנמכר, ביטול מחזיר למלאי, מחיקת שורה
SELECT tests.run('order 2: admin opens an order with 1 router',
  $$INSERT INTO public.orders (id, customer_id, kind, note) VALUES ('8a300000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000e4', 'order', 'ser-order-2');
    INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price) VALUES
      ('8a400000-0000-0000-0000-000000000003', '8a300000-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-000000000001', 1, 300)$$,
  :B1);
SELECT tests.run('order 2: serial sold in order 1 → "already sold (order SH…)"',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000003', 'RT-100')$$, :SW, 'כבר נמכר (הזמנה SH');
SELECT tests.run('order 2: assign RT-101',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000003', 'RT-101')$$, :SW, NULL, 1);
SELECT tests.run('order 2: cancelled',
  $$UPDATE public.orders SET status = 'cancelled' WHERE id = '8a300000-0000-0000-0000-000000000002'$$, :B1, NULL, 1);
SELECT tests.check('order 2: cancel → RT-101 back in stock, line cleared, router stock back',
  $$SELECT (SELECT status = 'in_stock' AND order_item_id IS NULL FROM public.product_serials WHERE serial_number = 'RT-101')
       AND (SELECT serial_number IS NULL AND warranty_until IS NULL FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000003')$$);
SELECT tests.run('order 2: no assigning in a cancelled order',
  $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000003', 'RT-101')$$, :SW, 'ההזמנה בוטלה');
SELECT tests.run('order 3: admin opens an order with 1 router',
  $$INSERT INTO public.orders (id, customer_id, kind, note) VALUES ('8a300000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000e4', 'order', 'ser-order-3');
    INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price) VALUES
      ('8a400000-0000-0000-0000-000000000004', '8a300000-0000-0000-0000-000000000003', '8a000000-0000-0000-0000-000000000001', 1, 300)$$,
  :B1);
SELECT tests.run('order 3: assign RT103', $$SELECT public.order_item_assign_serial('8a400000-0000-0000-0000-000000000004', 'RT103')$$, :SW, NULL, 1);
SELECT tests.run('order 3: delete the line', $$DELETE FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000004'$$, :B1, NULL, 1);
SELECT tests.check('order 3: deleted line → RT103 back in stock',
  $$SELECT status = 'in_stock' AND order_id IS NULL FROM public.product_serials WHERE serial_number = 'RT103'$$);

-- הפעלת "דורש מספר סידורי" על מוצר בהזמנה פתוחה
SELECT tests.run('sync: open order with 1 charger-less cable line',
  $$INSERT INTO public.orders (id, customer_id, kind, note) VALUES ('8a300000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-0000000000e4', 'order', 'ser-order-4');
    INSERT INTO public.order_items (id, order_id, product_id, quantity, unit_price) VALUES
      ('8a400000-0000-0000-0000-000000000005', '8a300000-0000-0000-0000-000000000004', '8a000000-0000-0000-0000-000000000002', 1, 100)$$,
  :B1);
UPDATE public.global_products SET requires_serial = true WHERE id = '8a000000-0000-0000-0000-000000000002';
SELECT tests.check('sync: cable now requires a serial → open line updated',
  $$SELECT serial_required FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000005'$$);
SELECT tests.check('sync: … but the delivered order 1 line is untouched',
  $$SELECT NOT serial_required FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000002'$$);
UPDATE public.global_products SET requires_serial = false WHERE id = '8a000000-0000-0000-0000-000000000002';
SELECT tests.check('sync: switched off → open line no longer requires',
  $$SELECT NOT serial_required FROM public.order_items WHERE id = '8a400000-0000-0000-0000-000000000005'$$);

-- ============================================================
-- 6. ניהול היחידות: תיקון, הסרה, רשימה, בדיקת אחריות
-- ============================================================
SELECT tests.run('update: fix a typo in an in-stock serial',
  $$SELECT public.product_serial_update((SELECT id FROM public.product_serials WHERE serial_number = 'RT103'), 'rt-103')$$, :SW, NULL, 1);
SELECT tests.run('update: to an existing serial → rejected',
  $$SELECT public.product_serial_update((SELECT id FROM public.product_serials WHERE serial_number = 'RT-103'), 'RT-101')$$, :SW, 'כבר קיים');
SELECT tests.run('update: a sold unit → rejected',
  $$SELECT public.product_serial_update((SELECT id FROM public.product_serials WHERE serial_number = 'RT-100'), 'RT-500')$$, :SW, 'שנמכרה');
SELECT tests.run('update: cashier → no permission',
  $$SELECT public.product_serial_update((SELECT id FROM public.product_serials WHERE serial_number = 'RT-103'), 'RT-104')$$, :SC, 'אין לך הרשאה');
SELECT tests.run('remove: sold unit → rejected',
  $$SELECT public.product_serial_remove((SELECT id FROM public.product_serials WHERE serial_number = 'RT-100'))$$, :SW, 'נמכרה');
SELECT tests.check('remove: router stock before write-off',
  $$SELECT stock_quantity = 2 FROM public.global_products WHERE id = '8a000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('remove: write off RT-103 (damaged)',
  $$SELECT public.product_serial_remove((SELECT id FROM public.product_serials WHERE serial_number = 'RT-103'), true)$$, :SW, NULL, 1);
SELECT tests.check('remove: unit gone, stock 2 → 1',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.product_serials WHERE serial_number = 'RT-103')
       AND (SELECT stock_quantity = 1 FROM public.global_products WHERE id = '8a000000-0000-0000-0000-000000000001')$$);
SELECT tests.run('remove: serial-only removal keeps the stock',
  $$SELECT public.product_serial_remove((SELECT id FROM public.product_serials WHERE serial_number = 'CH-2'), false)$$, :B1, NULL, 1);
SELECT tests.check('remove: charger stock still 2',
  $$SELECT stock_quantity = 2 FROM public.global_products WHERE id = '8a000000-0000-0000-0000-000000000004'$$);
SELECT tests.run('list: all router units', $$SELECT * FROM public.product_serials_list('8a000000-0000-0000-0000-000000000001')$$, :SW, NULL, 3);
SELECT tests.run('list: sold only, with the order number',
  $$SELECT * FROM public.product_serials_list('8a000000-0000-0000-0000-000000000001', 'sold') WHERE order_number LIKE 'SH%'$$, :SW, NULL, 2);
SELECT tests.run('list: customer → no permission',
  $$SELECT * FROM public.product_serials_list('8a000000-0000-0000-0000-000000000001')$$, :SU, 'אין הרשאה');
SELECT tests.run('serial_products: overview of the serial products (router, old switch, charger)',
  $$SELECT * FROM public.serial_products()$$, :SW, NULL, 3);
SELECT tests.run('serial_products: router → 1 in stock, 2 sold, 0 missing',
  $$SELECT * FROM public.serial_products() WHERE name = 'נתב סריאלי' AND in_stock_serials = 1 AND sold_serials = 2 AND missing_serials = 0 AND warranty_months = 12$$,
  :SW, NULL, 1);
SELECT tests.run('lookup: warranty check by serial (exact) → sold, active warranty, order + customer',
  $$SELECT * FROM public.serial_lookup('rt-100') WHERE status = 'sold' AND warranty_active AND order_number LIKE 'SH%' AND product_name = 'נתב סריאלי'$$,
  :SW, NULL, 1);
SELECT tests.run('lookup: partial search', $$SELECT * FROM public.serial_lookup('RT-10')$$, :B1, NULL, 3);
SELECT tests.run('lookup: 1 character → nothing', $$SELECT * FROM public.serial_lookup('R')$$, :B1, NULL, 0);
SELECT tests.run('lookup: cashier → no permission', $$SELECT * FROM public.serial_lookup('RT-100')$$, :SC, 'אין הרשאה');
SELECT tests.check('warranty: 0 months → no warranty date',
  $$SELECT public.serial_warranty_until(now(), 0) IS NULL AND public.serial_warranty_until('2026-01-31 23:30+00', 1) = '2026-03-01'$$);

-- ============================================================
-- 7. קופה מהירה: מכירה בחנות = מספר סידורי לכל יחידה
-- ============================================================
SELECT tests.run('pos: in-store sale of a router without a serial → rejected',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000004","quantity":1}]', '{"customer_name":"קונה בחנות","customer_phone":"0501234567"}')$$,
  :SC, '(0 מתוך 1)');
SELECT tests.run('pos: serials on a product that does not need them → rejected',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000002","quantity":1,"serials":["X-1"]}]', '{"customer_name":"קונה בחנות","customer_phone":"0501234567"}')$$,
  :SC, 'לא דורש מספר סידורי');
SELECT tests.run('pos: more serials than units → rejected',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000004","quantity":1,"serials":["CH-1","CH-9"]}]', '{"customer_name":"קונה בחנות","customer_phone":"0501234567"}')$$,
  :SC, 'יותר מספרים סידוריים');
SELECT tests.run('pos: unknown serial → rejected (nothing saved)',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000004","quantity":1,"serials":["CH-404"]}]', '{"customer_name":"קונה בחנות","customer_phone":"0501234567"}')$$,
  :SC, 'לא נמצא במלאי');
SELECT tests.run('pos: cashier sells the charger with CH-1 (scanned lower case) → delivered',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000004","quantity":1,"serials":["ch-1"]}]', '{"customer_name":"קונה בחנות","customer_phone":"0501234567"}') WHERE status = 'delivered'$$,
  :SC, NULL, 1);
SELECT tests.check('pos: CH-1 sold, line documented, no warranty (0 months)',
  $$SELECT ps.status = 'sold' AND ps.warranty_until IS NULL AND oi.serial_number = 'CH-1' AND oi.warranty_until IS NULL
           AND o.order_source = 'pos' AND o.status = 'delivered'
      FROM public.product_serials ps
      JOIN public.order_items oi ON oi.id = ps.order_item_id
      JOIN public.orders o ON o.id = oi.order_id
     WHERE ps.serial_number = 'CH-1'$$);

-- ============================================================
-- 8. שמירת שבת וחג אוטומטית (שעון ישראל)
-- ============================================================
SELECT tests.check('rest: defaults — off, Friday 16:00, Saturday 20:30, no holidays, no minimum',
  $$SELECT NOT shabbat_auto_enabled AND shabbat_start_time = '16:00' AND shabbat_end_time = '20:30'
           AND holidays = '[]'::jsonb AND minimum_order_amount IS NULL
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.check('rest: automation off → never closed (even on Friday night)',
  $$SELECT NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-09 18:00+03') ->> 'closed')::boolean$$);
SELECT tests.run('rest: owner turns the automation on',
  $$UPDATE public.site_settings SET shabbat_auto_enabled = true WHERE id = true$$, :B1, NULL, 1);
SELECT tests.check('rest: Friday 15:59 Israel → open, closes at 16:00',
  $$SELECT NOT (s ->> 'closed')::boolean AND (s ->> 'next_close_at')::timestamptz = '2026-10-09 16:00+03'
           AND s ->> 'next_kind' = 'shabbat'
      FROM (SELECT public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-09 15:59+03') AS s) x$$);
SELECT tests.check('rest: Friday 16:00 Israel → closed (Shabbat) until Saturday 20:30',
  $$SELECT (s ->> 'closed')::boolean AND s ->> 'kind' = 'shabbat'
           AND (s ->> 'reopens_at')::timestamptz = '2026-10-10 20:30+03'
      FROM (SELECT public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-09 16:00+03') AS s) x$$);
SELECT tests.check('rest: the window follows Israel time, not UTC (Friday 13:30 UTC = 16:30 Israel)',
  $$SELECT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-09 13:30+00') ->> 'closed')::boolean$$);
SELECT tests.check('rest: Saturday 20:29 → closed; 20:30 → open',
  $$SELECT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-10 20:29+03') ->> 'closed')::boolean
       AND NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-10 20:30+03') ->> 'closed')::boolean$$);
SELECT tests.check('rest: winter time (December, UTC+2) — Friday 16:05 Israel closed',
  $$SELECT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-12-04 14:05+00') ->> 'closed')::boolean
       AND NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-12-04 13:55+00') ->> 'closed')::boolean$$);
SELECT tests.check('rest: Wednesday noon → open',
  $$SELECT NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-14 12:00+03') ->> 'closed')::boolean$$);
SELECT tests.run('holidays: bad date format → rejected',
  $$UPDATE public.site_settings SET holidays = '[{"name":"חג","start":"13/10/2026 17:00","end":"2026-10-14T19:00"}]' WHERE id = true$$,
  :B1, 'לא תקינים');
SELECT tests.run('holidays: end before start → rejected',
  $$UPDATE public.site_settings SET holidays = '[{"name":"חג","start":"2026-10-14T19:00","end":"2026-10-13T17:00"}]' WHERE id = true$$,
  :B1, 'שעת הסיום');
SELECT tests.run('holidays: longer than 8 days → rejected',
  $$UPDATE public.site_settings SET holidays = '[{"name":"ארוך","start":"2026-10-01T17:00","end":"2026-10-12T19:00"}]' WHERE id = true$$,
  :B1, 'ארוך מדי');
SELECT tests.run('holidays: a date that does not exist → rejected',
  $$UPDATE public.site_settings SET holidays = '[{"name":"חג","start":"2026-02-30T17:00","end":"2026-03-01T19:00"}]' WHERE id = true$$,
  :B1, 'לא קיים');
SELECT tests.run('holidays: two holidays saved (unsorted, messy name)',
  $$UPDATE public.site_settings SET holidays = '[{"name":"  חג   ראשון ","start":"2026-10-20T17:00","end":"2026-10-21T19:30"},{"name":"מוצאי שבת חג","start":"2026-10-10T20:30","end":"2026-10-11T20:00"}]' WHERE id = true$$,
  :B1, NULL, 1);
SELECT tests.check('holidays: stored sorted by start, name cleaned',
  $$SELECT holidays -> 0 ->> 'start' = '2026-10-10T20:30' AND holidays -> 1 ->> 'name' = 'חג ראשון'
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.check('rest: Shabbat that runs into a holiday → reopens when the holiday ends (Sunday 20:00)',
  $$SELECT (s ->> 'closed')::boolean AND (s ->> 'reopens_at')::timestamptz = '2026-10-11 20:00+03'
      FROM (SELECT public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-09 17:00+03') AS s) x$$);
SELECT tests.check('rest: Tuesday holiday → closed, kind holiday, with its name',
  $$SELECT (s ->> 'closed')::boolean AND s ->> 'kind' = 'holiday' AND s ->> 'name' = 'חג ראשון'
           AND (s ->> 'reopens_at')::timestamptz = '2026-10-21 19:30+03'
      FROM (SELECT public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-21 09:00+03') AS s) x$$);
SELECT tests.run('rest: anyone (guest) can read the state of the store',
  $$SELECT public.store_rest_state()$$, NULL, NULL, 1);

-- חלון שמכסה את "עכשיו": אין הזמנות מהאתר, הקטלוג נשאר פתוח
UPDATE public.site_settings
   SET holidays = jsonb_build_array(jsonb_build_object('name', 'חג בדיקה', 'start', tests.s35_local(-60), 'end', tests.s35_local(60)))
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
SELECT tests.check('rest: the store is closed right now',
  $$SELECT (public.store_rest_state('70000000-0000-0000-0000-00000000000b') ->> 'closed')::boolean$$);
SELECT tests.run('rest: customer order during the holiday → blocked with the message',
  $$SELECT * FROM public.place_order('order', tests.s35_items(6), 18, true, tests.s35_details())$$, :SU,
  'האתר שומר שבת/חג ויחזור לפעילות בצאת השבת/חג');
SELECT tests.server('rest: guest order (server) during the holiday → blocked',
  $$SELECT * FROM public.place_guest_order('order', tests.s35_items(6), tests.s35_details())$$,
  'האתר שומר שבת/חג');
SELECT tests.run('rest: the catalog is still open for browsing',
  $$SELECT * FROM public.get_catalog() WHERE id = '8a000000-0000-0000-0000-000000000002'$$, NULL, NULL, 1);
SELECT tests.run('rest: staff can still open an order (manual / phone)',
  $$INSERT INTO public.orders (customer_id, kind, note) VALUES ('a0000000-0000-0000-0000-0000000000e4', 'order', 'ser-holiday-staff')$$, :B1, NULL, 1);
SELECT tests.run('rest: POS in-store sale is not blocked',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000002","quantity":1}]', '{"customer_name":"קונה בחג","customer_phone":"0501234567"}')$$,
  :SC, NULL, 1);
UPDATE public.site_settings SET shabbat_auto_enabled = false WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
SELECT tests.check('rest: automation off → the same holiday no longer closes the store',
  $$SELECT NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b') ->> 'closed')::boolean$$);
SELECT tests.run('rest: … and the customer can order again',
  $$SELECT * FROM public.place_order('order', tests.s35_items(6), 18, true, tests.s35_details())$$, :SU, NULL, 1);

-- ============================================================
-- 9. מינימום להזמנה
-- ============================================================
SELECT tests.run('minimum: 0 → rejected',
  $$UPDATE public.site_settings SET minimum_order_amount = 0 WHERE id = true$$, :B1, 'site_settings_minimum_order_check');
SELECT tests.run('minimum: owner sets ₪500',
  $$UPDATE public.site_settings SET minimum_order_amount = 500 WHERE id = true$$, :B1, NULL, 1);
SELECT tests.run('minimum: customer order of ₪200 → blocked, says how much is missing',
  $$SELECT * FROM public.place_order('order', tests.s35_items(2), 18, true, tests.s35_details())$$, :SU,
  'סכום ההזמנה המינימלי באתר הוא ₪500 — חסרים עוד ₪300');
SELECT tests.server('minimum: guest order of ₪200 → blocked too',
  $$SELECT * FROM public.place_guest_order('order', tests.s35_items(2), tests.s35_details())$$, 'המינימלי');
SELECT tests.run('minimum: ₪500 exactly → accepted',
  $$SELECT * FROM public.place_order('order', tests.s35_items(5), 18, true, tests.s35_details())$$, :SU, NULL, 1);
SELECT tests.run('minimum: a quote request below the minimum → accepted',
  $$SELECT * FROM public.place_order('quote', tests.s35_items(1), 18, true, tests.s35_details())$$, :SU, NULL, 1);
SELECT tests.run('minimum: POS below the minimum → accepted (store staff)',
  $$SELECT * FROM public.admin_create_order(NULL, '[{"product_id":"8a000000-0000-0000-0000-000000000002","quantity":1}]', '{"customer_name":"קונה קטן","customer_phone":"0501234567"}')$$,
  :SC, NULL, 1);
UPDATE public.site_settings SET minimum_order_amount = NULL, holidays = '[]'::jsonb WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
-- ניקוי: ההזמנות של הבדיקה (בדיקות הצוות סופרות מכירות קופה בחנות B)
DELETE FROM public.orders
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
   AND (customer_id = 'a0000000-0000-0000-0000-0000000000e4'
        OR customer_name IN ('קונה בחנות', 'קונה בחג', 'קונה קטן', 'לקוח סריאלים'));
SELECT tests.check('cleanup: deleting the orders released every sold serial',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.product_serials WHERE status = 'sold'
                        AND tenant_id = '70000000-0000-0000-0000-00000000000b')$$);

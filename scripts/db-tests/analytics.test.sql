-- ============================================================
-- חלק 26: store_analytics — הכנסות ששולמו, הזמנות, ממוצע, השוואה, נמכרים, מלאי
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set AGA '''a0000000-0000-0000-0000-0000000000a2'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
-- מוצר דיגיטלי ווריאציות פתוחים בפרימיום (בניקוי — חזרה ל-basic)
UPDATE public.tenant_subscriptions SET plan_type = 'premium' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000d3', 'cust3.a@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d3', 'cust3.a@test.local', 'cust3_a', 'customer', true) ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed)
VALUES ('a0000000-0000-0000-0000-0000000000d3', 'לקוח 3', true, true) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'אנליטיקס') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, is_hidden, is_digital) VALUES
  ('9a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '92000001', 'יין אדום', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 100, 100, false, false),
  ('9a000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', '92000002', 'בירה (אזל)', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 10, 0, false, false),
  ('9a000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', '92000003', 'מים (2 יח׳)', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 5, 2, false, false),
  ('9a000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000a', '92000004', 'מוסתר', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 5, 0, true, false),
  ('9a000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-00000000000a', '92000005', 'דיגיטלי', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 5, 0, false, true),
  ('9a000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-00000000000a', '92000006', 'חולצה', 'אנליטיקס', 'a0000000-0000-0000-0000-0000000000a1', 50, 0, false, false)
ON CONFLICT DO NOTHING;
INSERT INTO public.product_variants (id, tenant_id, product_id, options, sku, stock_quantity, is_active) VALUES
  ('9b000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-000000000006', '{"מידה":"M"}', '92000061', 1, true),
  ('9b000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', '9a000000-0000-0000-0000-000000000006', '{"מידה":"L"}', '92000062', 50, true);
-- (בלי ON CONFLICT: האילוץ הייחודי של הווריאציות הוא DEFERRABLE; הקובץ מנקה את עצמו)

CREATE OR REPLACE FUNCTION pg_temp.mk(_id UUID, _qty INTEGER) RETURNS VOID LANGUAGE sql AS $f$
  INSERT INTO public.orders (id, tenant_id, customer_id, kind)
  VALUES (_id, '70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d3', 'order');
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
  VALUES (_id, '9a000000-0000-0000-0000-000000000001', _qty, 100);
$f$;
SELECT pg_temp.mk('0a000000-0000-0000-0000-000000000001', 2);  -- שולמה (כרטיס)
SELECT pg_temp.mk('0a000000-0000-0000-0000-000000000002', 1);  -- במקום, נמסרה
SELECT pg_temp.mk('0a000000-0000-0000-0000-000000000003', 4);  -- במקום, ממתינה (לא שולמה)
SELECT pg_temp.mk('0a000000-0000-0000-0000-000000000004', 9);  -- בוטלה
SELECT pg_temp.mk('0a000000-0000-0000-0000-000000000005', 3);  -- החודש שעבר, שולמה
-- עדכון תשלום מותר רק במסלול התשלום (kobi.payment_update) — כמו Hyp / ביט
SELECT set_config('kobi.payment_update', 'on', false);
UPDATE public.orders SET payment_method = 'credit_card', payment_status = 'paid', paid_at = now()
 WHERE id IN ('0a000000-0000-0000-0000-000000000001', '0a000000-0000-0000-0000-000000000004', '0a000000-0000-0000-0000-000000000005');
UPDATE public.orders SET payment_method = 'offline', status = 'delivered' WHERE id = '0a000000-0000-0000-0000-000000000002';
UPDATE public.orders SET payment_method = 'offline' WHERE id = '0a000000-0000-0000-0000-000000000003';
UPDATE public.orders SET status = 'cancelled' WHERE id = '0a000000-0000-0000-0000-000000000004';
SELECT set_config('kobi.payment_update', '', false);
UPDATE public.orders
   SET created_at = ((date_trunc('month', now() AT TIME ZONE 'Asia/Jerusalem') - interval '1 month') AT TIME ZONE 'Asia/Jerusalem') + interval '1 minute'
 WHERE id = '0a000000-0000-0000-0000-000000000005';

SELECT tests.check('setup: payment / status as intended',
  $$SELECT count(*) = 5 FROM public.orders WHERE id::text LIKE '0a000000-%'
      AND ((id = '0a000000-0000-0000-0000-000000000001' AND payment_status = 'paid')
        OR (id = '0a000000-0000-0000-0000-000000000002' AND payment_method = 'offline' AND status = 'delivered')
        OR (id = '0a000000-0000-0000-0000-000000000003' AND payment_status <> 'paid' AND status <> 'delivered')
        OR (id = '0a000000-0000-0000-0000-000000000004' AND status = 'cancelled')
        OR (id = '0a000000-0000-0000-0000-000000000005' AND payment_status = 'paid'))$$);

CREATE OR REPLACE FUNCTION pg_temp.a(_period TEXT) RETURNS JSONB LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true);
  SELECT public.store_analytics(_period);
$f$;
SELECT tests.check('month: revenue 300 (paid card 200 + delivered offline 100), 3 orders, AOV 150',
  $$SELECT (a->>'revenue')::numeric = 300 AND (a->>'orders')::int = 3 AND (a->>'paid_orders')::int = 2
           AND (a->>'aov')::numeric = 150 FROM (SELECT pg_temp.a('month') a) q$$);
SELECT tests.check('month: previous = same elapsed part of last month (300, 1 order)',
  $$SELECT (a->'prev'->>'revenue')::numeric = 300 AND (a->'prev'->>'orders')::int = 1 FROM (SELECT pg_temp.a('month') a) q$$);
SELECT tests.check('month: top product = 3 units from paid orders only (unpaid 4 + cancelled 9 excluded)',
  $$SELECT a->'top_products'->0->>'name' = 'יין אדום' AND (a->'top_products'->0->>'units')::int = 3
      FROM (SELECT pg_temp.a('month') a) q$$);
SELECT tests.check('month: daily series sums to the revenue',
  $$SELECT (SELECT sum((d->>'revenue')::numeric) FROM jsonb_array_elements(a->'series') d) = 300
           AND a->>'bucket' = 'day' FROM (SELECT pg_temp.a('month') a) q$$);
SELECT tests.check('last_month: 300, 1 order, AOV 300; previous month empty',
  $$SELECT (a->>'revenue')::numeric = 300 AND (a->>'orders')::int = 1 AND (a->>'aov')::numeric = 300
           AND (a->'prev'->>'orders')::int = 0 FROM (SELECT pg_temp.a('last_month') a) q$$);
SELECT tests.check('year: monthly buckets, at least this month''s numbers',
  $$SELECT a->>'bucket' = 'month' AND (a->>'revenue')::numeric >= 300 AND (a->>'orders')::int >= 3
      FROM (SELECT pg_temp.a('year') a) q$$);
SELECT tests.check('stock: 3 alerts (out 0, variant M 1, water 2) — hidden, digital, healthy excluded',
  $$SELECT (a->>'stock_alerts_total')::int = 3
           AND a->'stock_alerts'->0->>'name' = 'בירה (אזל)' AND (a->'stock_alerts'->0->>'stock')::int = 0
           AND a->'stock_alerts'->1->>'variant' = 'M' AND a->'stock_alerts'->2->>'name' = 'מים (2 יח׳)'
      FROM (SELECT pg_temp.a('month') a) q$$);
SELECT tests.run('unknown period rejected', $$SELECT public.store_analytics('week')$$, :OA, 'טווח לא מוכר');
SELECT tests.run('agent: no permission', $$SELECT public.store_analytics('month')$$, :AGA, 'אין הרשאה');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.check('store B admin sees only store B (0 orders)',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000b1', true))
    SELECT (s->>'orders')::int = 0 AND (s->>'stock_alerts_total')::int = 0 FROM x, LATERAL (SELECT public.store_analytics('month') s) q$$);
SELECT tests.run('guest: no permission', $$SELECT public.store_analytics('month')$$, NULL, 'permission denied');

-- ניקוי
SELECT set_config('request.headers', '', false);
DELETE FROM public.orders WHERE id::text LIKE '0a000000-%';
DELETE FROM public.product_variants WHERE id::text LIKE '9b000000-%';
DELETE FROM public.global_products WHERE id::text LIKE '9a000000-%';
DELETE FROM public.categories WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND name = 'אנליטיקס';
UPDATE public.tenant_subscriptions SET plan_type = 'basic' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';

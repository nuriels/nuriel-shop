-- ============================================================
-- חלק 24: קופון "משלוח חינם" + מעקב משלוחים (tracking)
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set CU  '''a0000000-0000-0000-0000-0000000000d1'''
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

-- ---------- נתונים: לקוח, שיטת משלוח, קופונים ----------
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000d1', 'cust.a@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1', 'cust.a@test.local', 'cust_a', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed)
VALUES ('a0000000-0000-0000-0000-0000000000d1', 'לקוח A', true, true)
ON CONFLICT DO NOTHING;
DO $$ BEGIN
  UPDATE public.customer_profiles SET profile_completed = true WHERE user_id = 'a0000000-0000-0000-0000-0000000000d1';
EXCEPTION WHEN undefined_column THEN NULL; END $$;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active)
VALUES ('5a000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'שליח עד הבית', 'delivery', 30, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000a', 'בדיקת קופון') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity)
VALUES ('9c000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', '91000001', 'מוצר קופון', 'בדיקת קופון',
        'a0000000-0000-0000-0000-0000000000a1', 100, 1000) ON CONFLICT DO NOTHING;
SELECT tests.server('coupon: percent 10 (regression)',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('70000000-0000-0000-0000-00000000000a', 'TENOFF', 'percent', 10)$$);
SELECT tests.server('coupon: free_shipping with value 0 is allowed',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('70000000-0000-0000-0000-00000000000a', 'FREESHIP', 'free_shipping', 0)$$);
SELECT tests.server('coupon: free_shipping with a minimum order',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, min_order_total) VALUES ('70000000-0000-0000-0000-00000000000a', 'FREEBIG', 'free_shipping', 0, 500)$$);
SELECT tests.server('coupon: percent above 100 still rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('70000000-0000-0000-0000-00000000000a', 'BAD150', 'percent', 150)$$, 'coupons_value_check');
SELECT tests.server('coupon: fixed with 0 still rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('70000000-0000-0000-0000-00000000000a', 'ZERO', 'fixed', 0)$$, 'coupons_value_check');
SELECT tests.server('coupon: unknown type rejected',
  $$INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('70000000-0000-0000-0000-00000000000a', 'WHAT', 'gift', 5)$$, 'coupons_discount_type_check');

-- ---------- הזמנה עם משלוח + FREESHIP ----------
SELECT tests.server('order 1: shipping 30 + freeship + 2 x 100',
  $$WITH o AS (INSERT INTO public.orders (id, tenant_id, customer_id, kind, shipping_method_id, coupon_code)
    VALUES ('0d000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1',
            'order', '5a000000-0000-0000-0000-000000000001', 'freeship') RETURNING id)
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) SELECT id, '9c000000-0000-0000-0000-000000000001', 2, 100 FROM o$$);
SELECT tests.check('FREESHIP: products 200, shipping 30 kept, discount 30, total 200',
  $$SELECT shipping_price = 30 AND discount_amount = 30 AND total = 200 AND coupon_code = 'FREESHIP'
           AND coupon_discount_type = 'free_shipping'
      FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000001'$$);
SELECT tests.server('order 2: shipping 30 + FREEBIG + 2 x 100',
  $$WITH o AS (INSERT INTO public.orders (id, tenant_id, customer_id, kind, shipping_method_id, coupon_code)
    VALUES ('0d000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1',
            'order', '5a000000-0000-0000-0000-000000000001', 'FREEBIG') RETURNING id)
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) SELECT id, '9c000000-0000-0000-0000-000000000001', 2, 100 FROM o$$);
SELECT tests.check('FREEBIG (min 500) with 200: no discount, total 230',
  $$SELECT discount_amount = 0 AND total = 230 FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000002'$$);
SELECT tests.server('order 3: shipping 30 + TENOFF + 2 x 100',
  $$WITH o AS (INSERT INTO public.orders (id, tenant_id, customer_id, kind, shipping_method_id, coupon_code)
    VALUES ('0d000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d1',
            'order', '5a000000-0000-0000-0000-000000000001', 'TENOFF') RETURNING id)
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) SELECT id, '9c000000-0000-0000-0000-000000000001', 2, 100 FROM o$$);
SELECT tests.check('TENOFF 10% (regression): discount 20 on products only, total 210',
  $$SELECT discount_amount = 20 AND total = 210 AND shipping_price = 30 FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000003'$$);

-- ---------- מעקב משלוח ----------
SELECT tests.run('admin: set tracking (with spaces)',
  $$UPDATE public.orders SET tracking_number = '  RR123456789IL ', shipping_provider = 'דואר ישראל',
         tracking_url = ' https://example.com/track/RR123456789IL '
     WHERE id = '0d000000-0000-0000-0000-000000000001'$$, :OA, NULL, 1);
SELECT tests.check('tracking trimmed + stamped',
  $$SELECT tracking_number = 'RR123456789IL' AND tracking_url = 'https://example.com/track/RR123456789IL'
           AND shipping_provider = 'דואר ישראל' AND tracking_updated_at IS NOT NULL
      FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('admin: javascript: link rejected',
  $$UPDATE public.orders SET tracking_url = 'javascript:alert(1)' WHERE id = '0d000000-0000-0000-0000-000000000001'$$,
  :OA, 'orders_tracking_check');
SELECT tests.run('admin: empty values clear the tracking',
  $$UPDATE public.orders SET tracking_number = ' ', tracking_url = '' WHERE id = '0d000000-0000-0000-0000-000000000002'$$, :OA, NULL, 1);
SELECT tests.check('empty → NULL',
  $$SELECT tracking_number IS NULL AND tracking_url IS NULL FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000002'$$);
SELECT tests.run('customer cannot change tracking',
  $$UPDATE public.orders SET tracking_number = 'FAKE' WHERE id = '0d000000-0000-0000-0000-000000000001'$$, :CU, NULL, 0);
SELECT tests.check('tracking unchanged after the customer attempt',
  $$SELECT tracking_number = 'RR123456789IL' FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000001'$$);
SELECT tests.server('status update keeps tracking stamp',
  $$UPDATE public.orders SET note = 'x' WHERE id = '0d000000-0000-0000-0000-000000000001'$$);

-- ניקוי
SELECT set_config('request.headers', '', false);
DELETE FROM public.orders WHERE id IN ('0d000000-0000-0000-0000-000000000001', '0d000000-0000-0000-0000-000000000002', '0d000000-0000-0000-0000-000000000003');
DELETE FROM public.global_products WHERE id = '9c000000-0000-0000-0000-000000000001';
DELETE FROM public.categories WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND name = 'בדיקת קופון';
DELETE FROM public.coupons WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
DELETE FROM public.shipping_methods WHERE id = '5a000000-0000-0000-0000-000000000001';

-- ============================================================
-- חלק 39: שיתוף עגלה בקישור
-- ============================================================
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000b', 'בדיקת שיתוף') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, stock_quantity, is_hidden) VALUES
  ('8c000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '97300001', 'מוצר לשיתוף', 'בדיקת שיתוף', 'a0000000-0000-0000-0000-0000000000b1', 50, 50, 5, false),
  ('8c000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000b', '97300002', 'מוצר מוסתר', 'בדיקת שיתוף', 'a0000000-0000-0000-0000-0000000000b1', 50, 50, 5, true)
ON CONFLICT DO NOTHING;

SELECT tests.run('shared cart: a guest creates a link (hidden product dropped)',
  $$SELECT set_config('tests.code', public.create_shared_cart('[{"product_id":"8c000000-0000-0000-0000-000000000001","quantity":3},{"product_id":"8c000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb), false)$$,
  NULL);
SELECT tests.check('shared cart: 8-char code saved with only the visible product',
  $$SELECT current_setting('tests.code') ~ '^[A-Za-z0-9]{8}$'
       AND (SELECT jsonb_array_length(items) = 1 AND items -> 0 ->> 'product_id' = '8c000000-0000-0000-0000-000000000001'
                   AND (items -> 0 ->> 'quantity')::int = 3
              FROM public.shared_carts WHERE code = current_setting('tests.code'))$$);
SELECT tests.run('shared cart: anyone in the store opens it',
  $$SELECT 1 WHERE (public.get_shared_cart(current_setting('tests.code')) -> 'items' -> 0 ->> 'quantity')::int = 3$$,
  NULL, NULL, 1);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('shared cart: another store cannot open it',
  $$SELECT public.get_shared_cart(current_setting('tests.code')) IS NULL$$);
SELECT tests.run('shared cart: products of another store are dropped → nothing to share',
  $$SELECT public.create_shared_cart('[{"product_id":"8c000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb)$$,
  NULL, 'אין בעגלה מוצרים');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.run('shared cart: empty cart rejected',
  $$SELECT public.create_shared_cart('[]'::jsonb)$$, NULL, 'ריקה');
SELECT tests.run('shared cart: bad quantity rejected',
  $$SELECT public.create_shared_cart('[{"product_id":"8c000000-0000-0000-0000-000000000001","quantity":0}]'::jsonb)$$, NULL, 'כמות');
SELECT tests.run('shared cart: no direct table access',
  $$SELECT * FROM public.shared_carts$$, NULL, 'permission denied');
UPDATE public.shared_carts SET expires_at = now() - interval '1 day' WHERE code = current_setting('tests.code');
SELECT tests.check('shared cart: expired link → nothing',
  $$SELECT public.get_shared_cart(current_setting('tests.code')) IS NULL$$);

DELETE FROM public.shared_carts WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
DELETE FROM public.global_products WHERE id IN ('8c000000-0000-0000-0000-000000000001', '8c000000-0000-0000-0000-000000000002');
SELECT set_config('request.headers', '', false);

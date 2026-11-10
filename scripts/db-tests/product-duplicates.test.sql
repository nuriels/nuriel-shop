-- ============================================================
-- מוצרים כפולים (20261110230000): זיהוי (שם / תמונה / ברקוד), "לא כפול", מיזוג (כל מצבי הכמות,
-- מוצר שהוזמן מוסתר ולא נמחק, ביקורות / קשורים / מחירים / מבצע מתנה עוברים, יומן לשחזור), בידוד חנויות,
-- הרשאות, גודל מרבי, ורשימת המוצרים להצעות ה-AI (לשרת בלבד).
-- חנות B: b1 מנהל. חנות A: a1 בעלים, a2 סוכן. הקובץ מנקה את עצמו.
-- ============================================================
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

-- קריאה לפונקציה כמשתמש מחובר (הפונקציות SECURITY DEFINER — הן בודקות את auth.uid() ואת החנות בעצמן)
CREATE OR REPLACE FUNCTION tests.dup_as(_uid uuid, _call text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SELECT ' || _call INTO v;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN v;
END $f$;
-- הקבוצה (מהפונקציה) שיש בה בדיוק המוצרים האלה
CREATE OR REPLACE FUNCTION tests.dup_group(_groups jsonb, _ids uuid[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT g FROM jsonb_array_elements(_groups -> 'groups') AS g
   WHERE (SELECT array_agg((p ->> 'id')::uuid ORDER BY (p ->> 'id')::uuid) FROM jsonb_array_elements(g -> 'products') p)
         = (SELECT array_agg(x ORDER BY x) FROM unnest(_ids) x)
   LIMIT 1;
$f$;

-- ---------- נתונים ----------
INSERT INTO auth.users (id, email) VALUES ('d1d10000-0000-0000-0000-00000000c001', 'dup.customer@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-00000000c001', 'dup.customer@test.local', 'dup_customer', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, age_confirmed, profile_completed)
VALUES ('d1d10000-0000-0000-0000-00000000c001', '70000000-0000-0000-0000-00000000000b', 'לקוח כפולים', true, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES
  ('70000000-0000-0000-0000-00000000000b', 'כפולים בדיקה'),
  ('70000000-0000-0000-0000-00000000000a', 'כפולים בדיקה')
ON CONFLICT DO NOTHING;

INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, image_url, created_at) VALUES
  -- קבוצה 1: אותו שם (רווחים / אותיות שונים) ואותה תמונה
  ('d1d10000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '99110001', 'מקלדת אלחוטית K380', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 150, 5, 'https://cdn.test/dup-k380.webp', now() - interval '30 days'),
  ('d1d10000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000b', '99110002', '  מקלדת   אלחוטית k380 ', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 150, 2, 'https://cdn.test/dup-k380.webp', now() - interval '1 day'),
  ('d1d10000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000b', '99110003', 'מקלדת אלחוטית K380', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 160, 0, 'https://cdn.test/dup-k380.webp', now()),
  -- קבוצה 2: אותה תמונה בלבד
  ('d1d10000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000b', '99110004', 'מסך 22 אינץ׳ עם HDMI', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 300, 3, 'https://cdn.test/dup-monitor.webp', now() - interval '3 days'),
  ('d1d10000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-00000000000b', '99110005', 'מסך 22 אינץ׳ בלי HDMI', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 250, 1, 'https://cdn.test/dup-monitor.webp', now() - interval '2 days'),
  -- קבוצה 3: אותו שם בלבד; 07 יוזמן
  ('d1d10000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-00000000000b', '99110006', 'עכבר גיימינג X7', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 99, 2, 'https://cdn.test/dup-x7-a.webp', now() - interval '20 days'),
  ('d1d10000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-00000000000b', '99110007', 'עכבר גיימינג X7', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 99, 4, 'https://cdn.test/dup-x7-b.webp', now() - interval '5 days'),
  ('d1d10000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-00000000000b', '99110008', 'מוצר יחיד בלי כפילות', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 10, 9, 'https://cdn.test/dup-single.webp', now() - interval '9 days'),
  -- סידורי (09) + עותק רגיל (10)
  ('d1d10000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-00000000000b', '99110010', 'כרטיס מסך בדיקה RTX', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 2000, 3, NULL, now() - interval '1 day'),
  -- הסתרה לפי בקשה
  ('d1d10000-0000-0000-0000-000000000013', '70000000-0000-0000-0000-00000000000b', '99110013', 'רמקול בדיקה להסתרה', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 50, 1, NULL, now() - interval '8 days'),
  ('d1d10000-0000-0000-0000-000000000014', '70000000-0000-0000-0000-00000000000b', '99110014', 'רמקול בדיקה להסתרה', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 50, 6, NULL, now() - interval '7 days'),
  -- חנות A: אותו שם כמו קבוצה 1 — לא נכנס לקבוצה של B
  ('d1d10000-0000-0000-0000-0000000000a1', '70000000-0000-0000-0000-00000000000a', '99119901', 'מקלדת אלחוטית K380', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000a1', 150, 1, 'https://cdn.test/dup-k380.webp', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, requires_serial, created_at) VALUES
  ('d1d10000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-00000000000b', '99110009', 'כרטיס מסך בדיקה RTX', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 2000, 0, true, now() - interval '40 days')
ON CONFLICT DO NOTHING;
-- 21 מוצרים עם אותה תמונה ("אין תמונה") — קבוצה גדולה מדי, לא מוצגת
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, image_url)
SELECT ('d1d10000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, '70000000-0000-0000-0000-00000000000b',
       '991101' || lpad(i::text, 2, '0'), 'פריט עם תמונת ברירת מחדל ' || i, 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 5, 1,
       'https://cdn.test/dup-placeholder.webp'
  FROM generate_series(1, 21) AS i
ON CONFLICT DO NOTHING;

-- הזמנה של 07
INSERT INTO public.orders (id, tenant_id, customer_id, kind)
VALUES ('d1d10000-0000-0000-0000-0000000000e1', '70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-00000000c001', 'order')
ON CONFLICT DO NOTHING;
INSERT INTO public.order_items (order_id, product_id, quantity, unit_price)
SELECT 'd1d10000-0000-0000-0000-0000000000e1', 'd1d10000-0000-0000-0000-000000000007', 1, 99
 WHERE NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = 'd1d10000-0000-0000-0000-0000000000e1');
-- ביקורות: אותו לקוח כתב על 02 ועל 03 (רק האחרונה עוברת), ביקורת אורח על 03 (עוברת)
INSERT INTO public.product_reviews (id, tenant_id, product_id, customer_name, rating, content, user_id, created_at) VALUES
  ('d1d10000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000002', 'לקוח כפולים', 4, 'ביקורת ישנה על העותק', 'd1d10000-0000-0000-0000-00000000c001', now() - interval '2 hours'),
  ('d1d10000-0000-0000-0000-0000000000b2', '70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000003', 'לקוח כפולים', 5, 'ביקורת חדשה על העותק', 'd1d10000-0000-0000-0000-00000000c001', now() - interval '1 hour'),
  ('d1d10000-0000-0000-0000-0000000000b3', '70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000003', 'אורח', 3, 'ביקורת אורח', NULL, now())
ON CONFLICT DO NOTHING;
-- מוצרים קשורים: 02→08 (יהפוך ל-01→08), 08→03 (יהפוך ל-08→01), 02→03 (שניהם עותקים — נעלם)
INSERT INTO public.product_relations (tenant_id, product_id, related_product_id, sort_order) VALUES
  ('70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000008', 1),
  ('70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000008', 'd1d10000-0000-0000-0000-000000000003', 1),
  ('70000000-0000-0000-0000-00000000000b', 'd1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000003', 2)
ON CONFLICT DO NOTHING;
-- מחיר מיוחד ללקוח על 02, ומבצע "מתנה בעגלה" שנותן את 03
INSERT INTO public.user_custom_prices (user_id, product_id, custom_price, tenant_id) VALUES
  ('d1d10000-0000-0000-0000-00000000c001', 'd1d10000-0000-0000-0000-000000000002', 99, '70000000-0000-0000-0000-00000000000b')
ON CONFLICT DO NOTHING;
INSERT INTO public.cart_promotions (id, tenant_id, name, condition_type, min_subtotal, gift_product_id, gift_quantity) VALUES
  ('d1d10000-0000-0000-0000-0000000000f1', '70000000-0000-0000-0000-00000000000b', 'מתנה בדיקת כפולים', 'min_subtotal', 100, 'd1d10000-0000-0000-0000-000000000003', 1)
ON CONFLICT DO NOTHING;

-- ---------- הרשאות ----------
SELECT tests.check('duplicates: the two tables have RLS + a RESTRICTIVE tenant_isolation policy, closed to the browser',
  $$SELECT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.product_duplicate_dismissals'::regclass, 'public.product_merges'::regclass))
       AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
              AND tablename IN ('product_duplicate_dismissals', 'product_merges')) = 2
       AND NOT has_table_privilege('authenticated', 'public.product_merges', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.product_duplicate_dismissals', 'INSERT')
       AND NOT has_table_privilege('anon', 'public.product_merges', 'SELECT')$$);
SELECT tests.check('duplicates: the store functions are for signed-in users only; the AI list and the helpers are for the server only',
  $$SELECT has_function_privilege('authenticated', 'public.product_duplicate_groups()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.product_merge(uuid,uuid[],text,uuid,integer,uuid[])', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.product_duplicate_dismiss(uuid[])', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.product_duplicate_groups()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.product_merge(uuid,uuid[],text,uuid,integer,uuid[])', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.product_duplicate_ai_candidates(uuid,text,integer)', 'EXECUTE')
       AND has_function_privilege('service_role', 'public.product_duplicate_ai_candidates(uuid,text,integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public._product_duplicate_cards(uuid,uuid[])', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public._product_keep_reasons(uuid)', 'EXECUTE')$$);
SELECT tests.run('duplicates: a guest cannot list groups', $$SELECT public.product_duplicate_groups()$$, NULL, 'permission denied');
SELECT tests.run('duplicates: the browser cannot read the merge log', $$SELECT * FROM public.product_merges$$,
  'a0000000-0000-0000-0000-0000000000b1', 'permission denied');
SELECT tests.run('duplicates: the browser cannot call the AI product list', $$SELECT public.product_duplicate_ai_candidates('70000000-0000-0000-0000-00000000000b')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'permission denied');

-- ---------- הקבוצות ----------
SELECT tests.check('groups: same name (spaces / case) + same image → one group of 3 with both reasons, oldest first',
  $$WITH g AS (SELECT tests.dup_group(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()'),
                 ARRAY['d1d10000-0000-0000-0000-000000000001', 'd1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000003']::uuid[]) AS g)
    SELECT g IS NOT NULL AND g -> 'reasons' = '["image", "name"]'::jsonb
       AND g -> 'products' -> 0 ->> 'id' = 'd1d10000-0000-0000-0000-000000000001'
       AND (g -> 'products' -> 0 ->> 'stock')::int = 5
       AND g -> 'products' -> 0 ->> 'image_url' = 'https://cdn.test/dup-k380.webp'
       AND (g -> 'products' -> 2 ->> 'reviews')::int = 2
    FROM g$$);
SELECT tests.check('groups: same image only → a group with the image reason',
  $$SELECT tests.dup_group(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()'),
             ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000005']::uuid[]) -> 'reasons' = '["image"]'::jsonb$$);
SELECT tests.check('groups: same name only → a group; the ordered product shows its order and that it can only be hidden',
  $$WITH g AS (SELECT tests.dup_group(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()'),
                 ARRAY['d1d10000-0000-0000-0000-000000000006', 'd1d10000-0000-0000-0000-000000000007']::uuid[]) AS g)
    SELECT g -> 'reasons' = '["name"]'::jsonb
       AND (g -> 'products' -> 1 ->> 'orders')::int = 1
       AND g -> 'products' -> 1 -> 'keep_reasons' = '["orders"]'::jsonb
       AND g -> 'products' -> 0 -> 'keep_reasons' = '[]'::jsonb
    FROM g$$);
SELECT tests.check('groups: an image shared by more than 20 products (a placeholder) is not a group; a single product is not a group',
  $$WITH r AS (SELECT tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()') AS r)
    SELECT NOT EXISTS (SELECT 1 FROM r, jsonb_array_elements(r -> 'groups') g, jsonb_array_elements(g -> 'products') p
                        WHERE p ->> 'image_url' = 'https://cdn.test/dup-placeholder.webp'
                           OR p ->> 'id' = 'd1d10000-0000-0000-0000-000000000008')
    FROM r$$);
SELECT tests.check('groups: store isolation — the same name in store A is never in a store B group',
  $$WITH r AS (SELECT tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()') AS r)
    SELECT NOT EXISTS (SELECT 1 FROM r, jsonb_array_elements(r -> 'groups') g, jsonb_array_elements(g -> 'products') p
                        WHERE p ->> 'id' = 'd1d10000-0000-0000-0000-0000000000a1')
    FROM r$$);
SELECT tests.run('groups: an agent is not a store admin', $$SELECT public.product_duplicate_groups()$$,
  'a0000000-0000-0000-0000-0000000000a2', 'רק מנהל החנות');
SELECT tests.run('groups: the admin of store A on the address of store B gets nothing (not a member)',
  $$SELECT public.product_duplicate_groups()$$, 'a0000000-0000-0000-0000-0000000000a1', 'רק מנהל החנות');
SELECT tests.check('cards: only products of the current store come back (a store A id is ignored)',
  $$SELECT jsonb_array_length(tests.dup_as('a0000000-0000-0000-0000-0000000000b1',
            'public.product_duplicate_cards(ARRAY[''d1d10000-0000-0000-0000-000000000001'', ''d1d10000-0000-0000-0000-0000000000a1'']::uuid[])')) = 1$$);
SELECT tests.run('cards: at most 200 ids',
  $$SELECT public.product_duplicate_cards(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)))$$,
  'a0000000-0000-0000-0000-0000000000b1', 'עד 200');

-- ---------- "לא כפול" ----------
SELECT tests.run('dismiss: one product is not a group', $$SELECT public.product_duplicate_dismiss(ARRAY['d1d10000-0000-0000-0000-000000000004']::uuid[])$$,
  'a0000000-0000-0000-0000-0000000000b1', 'בחרו בין 2');
SELECT tests.run('dismiss: a product of another store is refused',
  $$SELECT public.product_duplicate_dismiss(ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-0000000000a1']::uuid[])$$,
  'a0000000-0000-0000-0000-0000000000b1', 'לא נמצאו');
SELECT tests.run('dismiss: an agent cannot dismiss', $$SELECT public.product_duplicate_dismiss(ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000005']::uuid[])$$,
  'a0000000-0000-0000-0000-0000000000a2', 'רק מנהל החנות');
SELECT tests.run('dismiss: the admin marks the monitors "not a duplicate" (twice = once)',
  $$SELECT public.product_duplicate_dismiss(ARRAY['d1d10000-0000-0000-0000-000000000005', 'd1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000004']::uuid[]),
           public.product_duplicate_dismiss(ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000005']::uuid[])$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('dismiss: stored once, sorted',
  $$SELECT count(*) = 1 AND min(product_ids::text) = '{d1d10000-0000-0000-0000-000000000004,d1d10000-0000-0000-0000-000000000005}'
      FROM public.product_duplicate_dismissals WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.check('dismiss: the dismissed group is no longer listed',
  $$SELECT tests.dup_group(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()'),
             ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000005']::uuid[]) IS NULL$$);
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity, image_url) VALUES
  ('d1d10000-0000-0000-0000-000000000015', '70000000-0000-0000-0000-00000000000b', '99110015', 'מסך 22 אינץ׳ שלישי', 'כפולים בדיקה', 'a0000000-0000-0000-0000-0000000000b1', 280, 2, 'https://cdn.test/dup-monitor.webp')
ON CONFLICT DO NOTHING;
SELECT tests.check('dismiss: a new copy joins the dismissed products → the group is shown again, with all three',
  $$SELECT tests.dup_group(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()'),
             ARRAY['d1d10000-0000-0000-0000-000000000004', 'd1d10000-0000-0000-0000-000000000005', 'd1d10000-0000-0000-0000-000000000015']::uuid[]) IS NOT NULL$$);
SELECT tests.check('AI list (server only): products of the asked store only, the dismissed sets, the category filter and the limit',
  $$WITH all_b AS (SELECT public.product_duplicate_ai_candidates('70000000-0000-0000-0000-00000000000b', NULL, 1000) AS r),
         two AS (SELECT public.product_duplicate_ai_candidates('70000000-0000-0000-0000-00000000000b', 'כפולים בדיקה', 2) AS r),
         none AS (SELECT public.product_duplicate_ai_candidates('70000000-0000-0000-0000-00000000000b', 'אין קטגוריה כזו', 10) AS r)
    SELECT jsonb_array_length(all_b.r -> 'products') <= 300
       AND (all_b.r ->> 'total')::int = (SELECT count(*) FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(all_b.r -> 'products') p WHERE p ->> 'id' = 'd1d10000-0000-0000-0000-0000000000a1')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(all_b.r -> 'products') p WHERE p ? 'stock' OR p ? 'customer' OR p ? 'image_url')
       AND jsonb_array_length(all_b.r -> 'dismissed') = 1
       AND jsonb_array_length(two.r -> 'products') = 2 AND (two.r ->> 'total')::int >= 30
       AND jsonb_array_length(none.r -> 'products') = 0
    FROM all_b, two, none$$);
SELECT tests.run('dismiss: "show all again" clears the store marks', $$SELECT public.product_duplicate_dismissals_clear()$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('dismiss: cleared',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.product_duplicate_dismissals WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);

-- ---------- מיזוג: שגיאות (שום דבר לא משתנה) ----------
SELECT tests.run('merge: no other product', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000001']::uuid[], 'keep')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'לפחות מוצר אחד');
SELECT tests.run('merge: at most 20 products at once',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 20)), 'keep')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'עד 20');
SELECT tests.run('merge: an unknown stock choice', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'max')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'בחירת הכמות');
SELECT tests.run('merge: "take the stock from" a product outside the group',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'from', 'd1d10000-0000-0000-0000-000000000008')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'בחרו מאיזה מוצר');
SELECT tests.run('merge: a negative custom stock', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'custom', NULL, -1)$$,
  'a0000000-0000-0000-0000-0000000000b1', 'כמות לא תקינה');
SELECT tests.run('merge: a product of store A in a store B merge is refused',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-0000000000a1']::uuid[], 'sum')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'לא נמצאו');
SELECT tests.run('merge: keeping a product of store A is refused',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-0000000000a1', ARRAY['d1d10000-0000-0000-0000-000000000001']::uuid[], 'keep')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'לא נמצאו');
SELECT tests.run('merge: an agent cannot merge', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'keep')$$,
  'a0000000-0000-0000-0000-0000000000a2', 'רק מנהל החנות');
SELECT tests.run('merge: the admin of store A cannot merge in store B', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'keep')$$,
  'a0000000-0000-0000-0000-0000000000a1', 'רק מנהל החנות');
SELECT tests.run('merge: a guest cannot merge', $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'keep')$$,
  NULL, 'permission denied');
SELECT tests.check('merge: after the refused calls nothing changed (store A product, the copies, the log)',
  $$SELECT (SELECT count(*) FROM public.global_products WHERE id IN ('d1d10000-0000-0000-0000-000000000001', 'd1d10000-0000-0000-0000-000000000002',
                                                                  'd1d10000-0000-0000-0000-000000000003', 'd1d10000-0000-0000-0000-0000000000a1')) = 4
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000001') = 5
       AND NOT EXISTS (SELECT 1 FROM public.product_merges WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);

-- ---------- מיזוג 1: סכום הכמויות; שני העותקים נמחקים; ביקורות / קשורים / מחיר / מבצע עוברים ----------
SELECT tests.run('merge 1: keep 01, merge 02 and 03, sum the stock',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001',
                                ARRAY['d1d10000-0000-0000-0000-000000000003', 'd1d10000-0000-0000-0000-000000000002']::uuid[], 'sum')$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('merge 1: stock 5 + 2 + 0 = 7, and the main warehouse location follows (5 → 7)',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000001') = 7
       AND (SELECT sum(quantity) FROM public.product_locations WHERE product_id = 'd1d10000-0000-0000-0000-000000000001') = 7$$);
SELECT tests.check('merge 1: both copies are deleted (no orders), with their locations and category links',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products WHERE id IN ('d1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000003'))
       AND NOT EXISTS (SELECT 1 FROM public.product_locations WHERE product_id IN ('d1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000003'))
       AND NOT EXISTS (SELECT 1 FROM public.product_categories WHERE product_id IN ('d1d10000-0000-0000-0000-000000000002', 'd1d10000-0000-0000-0000-000000000003'))$$);
SELECT tests.check('merge 1: reviews moved — one per customer (the newest) plus the guest review; the older one of the same customer is gone',
  $$SELECT (SELECT count(*) FROM public.product_reviews WHERE product_id = 'd1d10000-0000-0000-0000-000000000001') = 2
       AND EXISTS (SELECT 1 FROM public.product_reviews WHERE id = 'd1d10000-0000-0000-0000-0000000000b2' AND product_id = 'd1d10000-0000-0000-0000-000000000001')
       AND EXISTS (SELECT 1 FROM public.product_reviews WHERE id = 'd1d10000-0000-0000-0000-0000000000b3' AND product_id = 'd1d10000-0000-0000-0000-000000000001')
       AND NOT EXISTS (SELECT 1 FROM public.product_reviews WHERE id = 'd1d10000-0000-0000-0000-0000000000b1')$$);
SELECT tests.check('merge 1: related products re-pointed both ways; the relation between the two copies is gone; no self relation',
  $$SELECT EXISTS (SELECT 1 FROM public.product_relations WHERE product_id = 'd1d10000-0000-0000-0000-000000000001' AND related_product_id = 'd1d10000-0000-0000-0000-000000000008')
       AND EXISTS (SELECT 1 FROM public.product_relations WHERE product_id = 'd1d10000-0000-0000-0000-000000000008' AND related_product_id = 'd1d10000-0000-0000-0000-000000000001')
       AND NOT EXISTS (SELECT 1 FROM public.product_relations WHERE product_id = related_product_id)
       AND NOT EXISTS (SELECT 1 FROM public.product_relations WHERE 'd1d10000-0000-0000-0000-000000000002' IN (product_id, related_product_id)
                                                               OR 'd1d10000-0000-0000-0000-000000000003' IN (product_id, related_product_id))$$);
SELECT tests.check('merge 1: the customer price and the gift promotion now point at the kept product (the promotion was not deleted)',
  $$SELECT EXISTS (SELECT 1 FROM public.user_custom_prices WHERE user_id = 'd1d10000-0000-0000-0000-00000000c001'
                      AND product_id = 'd1d10000-0000-0000-0000-000000000001' AND custom_price = 99)
       AND (SELECT gift_product_id FROM public.cart_promotions WHERE id = 'd1d10000-0000-0000-0000-0000000000f1') = 'd1d10000-0000-0000-0000-000000000001'$$);
SELECT tests.check('merge 1: the log keeps the kept product before, both deleted rows with what depended on them, the moves — and no review text',
  $$SELECT count(*) = 1
       AND bool_and(m.kept_product_id = 'd1d10000-0000-0000-0000-000000000001' AND m.stock_mode = 'sum'
                    AND m.stock_before = 5 AND m.stock_after = 7
                    AND (m.kept_before ->> 'stock_quantity')::int = 5
                    AND jsonb_array_length(m.products) = 2
                    AND (SELECT bool_and(p ->> 'action' = 'deleted' AND p -> 'row' ->> 'tenant_id' = '70000000-0000-0000-0000-00000000000b')
                           FROM jsonb_array_elements(m.products) p)
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.products) p
                                 WHERE p ->> 'id' = 'd1d10000-0000-0000-0000-000000000002'
                                   AND p -> 'children' ? 'product_locations.product_id'
                                   AND p -> 'children' ? 'product_categories.product_id'
                                   AND p -> 'children' ? 'user_custom_prices.product_id'
                                   AND p -> 'children' ? 'product_relations.product_id')
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(m.products) p
                                 WHERE p ->> 'id' = 'd1d10000-0000-0000-0000-000000000003'
                                   AND p -> 'children' ? 'cart_promotions.gift_product_id')
                    AND jsonb_array_length(m.moved -> 'reviews') = 2
                    AND jsonb_array_length(m.moved -> 'custom_prices') = 1
                    AND jsonb_array_length(m.moved -> 'gift_promotions') = 1
                    AND (m.moved ->> 'relations_added')::int = 2
                    AND m.products::text NOT LIKE '%ביקורת%' AND m.moved::text NOT LIKE '%ביקורת%'
                    AND m.created_by = 'a0000000-0000-0000-0000-0000000000b1')
      FROM public.product_merges m WHERE m.tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.check('merge 1: the group is gone from the list',
  $$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tests.dup_as('a0000000-0000-0000-0000-0000000000b1', 'public.product_duplicate_groups()') -> 'groups') g,
                                       jsonb_array_elements(g -> 'products') p
                        WHERE p ->> 'id' = 'd1d10000-0000-0000-0000-000000000001')$$);
SELECT tests.run('merge 1: running it again is refused (the copies are gone)',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000001', ARRAY['d1d10000-0000-0000-0000-000000000002']::uuid[], 'sum')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'לא נמצאו');

-- ---------- מיזוג 2: "לקחת את הכמות מ" מוצר שהוזמן — הוא מוסתר, לא נמחק ----------
SELECT tests.run('merge 2: keep 06, take the stock from 07 (ordered)',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000006', ARRAY['d1d10000-0000-0000-0000-000000000007']::uuid[], 'from',
                                'd1d10000-0000-0000-0000-000000000007')$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('merge 2: 06 has the stock 07 had at the merge (4 minus the 1 ordered = 3); 07 is hidden with stock 0, not deleted, and its order is untouched',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000006') = 3
       AND (SELECT m.stock_after = 3 AND (m.products -> 0 ->> 'stock')::int = 3
              FROM public.product_merges m WHERE m.kept_product_id = 'd1d10000-0000-0000-0000-000000000006')
       AND (SELECT is_hidden AND stock_quantity = 0 FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000007')
       AND EXISTS (SELECT 1 FROM public.order_items WHERE order_id = 'd1d10000-0000-0000-0000-0000000000e1'
                      AND product_id = 'd1d10000-0000-0000-0000-000000000007')$$);
SELECT tests.check('merge 2: hiding the ordered copy did not send an "out of stock" notice',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.staff_notifications WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
                          AND kind = 'out_of_stock' AND body LIKE 'עכבר גיימינג X7%')$$);
SELECT tests.check('merge 2: the log says hidden, because of the order',
  $$SELECT EXISTS (SELECT 1 FROM public.product_merges m, jsonb_array_elements(m.products) p
                    WHERE m.kept_product_id = 'd1d10000-0000-0000-0000-000000000006'
                      AND p ->> 'id' = 'd1d10000-0000-0000-0000-000000000007'
                      AND p ->> 'action' = 'hidden' AND p -> 'reasons' = '["orders"]'::jsonb
                      AND p -> 'children' = '{}'::jsonb)$$);

-- ---------- מיזוג 3: מוצר עם מספרים סידוריים לא מקבל כמות במיזוג ----------
SELECT tests.run('merge 3: summing into a serial-number product is refused with a clear message',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000009', ARRAY['d1d10000-0000-0000-0000-000000000010']::uuid[], 'sum')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'מספר סידורי');
SELECT tests.check('merge 3: refused = nothing changed',
  $$SELECT EXISTS (SELECT 1 FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000010' AND stock_quantity = 3)$$);
SELECT tests.run('merge 3: with "keep the stock" it works',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000009', ARRAY['d1d10000-0000-0000-0000-000000000010']::uuid[], 'keep')$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('merge 3: the serial product keeps stock 0; the copy is deleted',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000009') = 0
       AND NOT EXISTS (SELECT 1 FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000010')$$);

-- ---------- מיזוג 4: כמות אחרת (0) + הסתרה לפי בקשה ----------
SELECT tests.run('merge 4: keep 13 with a custom stock of 0, hide 14 instead of deleting it',
  $$SELECT public.product_merge('d1d10000-0000-0000-0000-000000000013', ARRAY['d1d10000-0000-0000-0000-000000000014']::uuid[], 'custom',
                                NULL, 0, ARRAY['d1d10000-0000-0000-0000-000000000014']::uuid[])$$,
  'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('merge 4: 13 → 0 is marked out of stock by the regular trigger (the regular notice, to the other admins); 14 is hidden with stock 0 and no notice',
  $$SELECT (SELECT stock_quantity = 0 AND is_out_of_stock FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000013')
       AND (SELECT is_hidden AND stock_quantity = 0 FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-000000000014')
       AND EXISTS (SELECT 1 FROM public.staff_notifications WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
                      AND kind = 'out_of_stock' AND body LIKE 'רמקול בדיקה להסתרה%')
       AND (SELECT count(*) FROM public.staff_notifications WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
                      AND kind = 'out_of_stock' AND body LIKE 'רמקול בדיקה להסתרה%')
           = (SELECT count(*) FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND role = 'admin' AND NOT is_blocked
                AND user_id <> 'a0000000-0000-0000-0000-0000000000b1')
       AND EXISTS (SELECT 1 FROM public.product_merges m, jsonb_array_elements(m.products) p
                    WHERE m.kept_product_id = 'd1d10000-0000-0000-0000-000000000013' AND m.stock_after = 0
                      AND p ->> 'action' = 'hidden' AND p -> 'reasons' = '["requested"]'::jsonb)$$);
SELECT tests.check('merges: every log row belongs to store B; store A is untouched',
  $$SELECT (SELECT count(*) FROM public.product_merges WHERE tenant_id = '70000000-0000-0000-0000-00000000000b') = 4
       AND NOT EXISTS (SELECT 1 FROM public.product_merges WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'd1d10000-0000-0000-0000-0000000000a1') = 1$$);

-- ---------- ניקוי ----------
SELECT set_config('request.headers', '', false);
DELETE FROM public.product_merges WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';
DELETE FROM public.product_duplicate_dismissals WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b');
DELETE FROM public.staff_notifications WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND kind = 'out_of_stock'
   AND (body LIKE 'רמקול בדיקה להסתרה%' OR body LIKE 'עכבר גיימינג X7%' OR body LIKE 'מקלדת אלחוטית K380%' OR body LIKE 'כרטיס מסך בדיקה RTX%');
DELETE FROM public.cart_promotions WHERE id = 'd1d10000-0000-0000-0000-0000000000f1';
DELETE FROM public.orders WHERE id = 'd1d10000-0000-0000-0000-0000000000e1';
DELETE FROM public.product_reviews WHERE id::text LIKE 'd1d10000-%';
DELETE FROM public.global_products WHERE id::text LIKE 'd1d10000-%';
DELETE FROM public.categories WHERE name = 'כפולים בדיקה'
   AND tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b');
DELETE FROM public.customer_profiles WHERE user_id = 'd1d10000-0000-0000-0000-00000000c001';
DELETE FROM public.user_roles WHERE user_id = 'd1d10000-0000-0000-0000-00000000c001';
DELETE FROM auth.users WHERE id = 'd1d10000-0000-0000-0000-00000000c001';
DROP FUNCTION tests.dup_group(jsonb, uuid[]);
DROP FUNCTION tests.dup_as(uuid, text);

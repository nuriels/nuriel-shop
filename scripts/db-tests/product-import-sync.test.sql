-- ============================================================
-- STORE-2 (מיגרציה 64): ייבוא שמזהה מוצרים קיימים — בלי כפולים, עדכון מלאי (גם 0) ומחיר לפי הבחירה,
-- מוצרים שלא בקובץ (להשאיר / לאפס / להסתיר), דוח שינויים, ביטול יבוא, הרשאות והפרדת חנויות.
-- חנות נפרדת לבדיקה (store-imp) — איפוס / הסתרה של "מה שלא בקובץ" לא נוגעים בחנויות של בדיקות אחרות.
-- ============================================================
\set D   '''70000000-0000-0000-0000-00000000f1a0'''
\set D1  '''a0000000-0000-0000-0000-00000000f1a1'''
\set D2  '''a0000000-0000-0000-0000-00000000f1a2'''
\set D3  '''a0000000-0000-0000-0000-00000000f1a3'''
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000f1a1', 'imp.owner@f1a.test'),
  ('a0000000-0000-0000-0000-00000000f1a2', 'imp.admin2@f1a.test'),
  ('a0000000-0000-0000-0000-00000000f1a3', 'imp.agent@f1a.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  ('70000000-0000-0000-0000-00000000f1a0', 'store-f1a-import', 'חנות ייבוא', 'imp.owner@f1a.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenant_subscriptions (tenant_id, plan_type, status, trial_ends_at, current_period_end) VALUES
  ('70000000-0000-0000-0000-00000000f1a0', 'premium', 'active', NULL, now() + interval '1 year')
ON CONFLICT (tenant_id) DO UPDATE SET plan_type = EXCLUDED.plan_type, status = EXCLUDED.status,
  trial_ends_at = EXCLUDED.trial_ends_at, current_period_end = EXCLUDED.current_period_end;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('70000000-0000-0000-0000-00000000f1a0', 'a0000000-0000-0000-0000-00000000f1a1', 'imp.owner@f1a.test', 'imp_owner', 'admin', true),
  ('70000000-0000-0000-0000-00000000f1a0', 'a0000000-0000-0000-0000-00000000f1a2', 'imp.admin2@f1a.test', 'imp_admin2', 'admin', true),
  ('70000000-0000-0000-0000-00000000f1a0', 'a0000000-0000-0000-0000-00000000f1a3', 'imp.agent@f1a.test', 'imp_agent', 'agent', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.categories (tenant_id, name) VALUES
  ('70000000-0000-0000-0000-00000000f1a0', 'כללי'), ('70000000-0000-0000-0000-00000000000b', 'כללי')
ON CONFLICT DO NOTHING;
-- המוצרים שכבר בחנות
INSERT INTO public.global_products
  (id, tenant_id, sku, name, category, barcode, stock_quantity, price_tier1, price_tier2, price_tier3, uniform_price, created_by)
VALUES
  ('f1b00000-0000-0000-0000-000000000001', :D, '10000001', 'מחשב נייד Lenovo', 'כללי', '7290000000011', 5, 100, 100, 100, true, :D1),
  ('f1b00000-0000-0000-0000-000000000002', :D, '10000002', 'כבל HDMI', 'כללי', '7290000000022', 4, 20, 20, 20, true, :D1),
  ('f1b00000-0000-0000-0000-000000000003', :D, '10000003', 'מסך 24 אינץ''', 'כללי', NULL, 2, 500, 450, 400, false, :D1),
  ('f1b00000-0000-0000-0000-000000000004', :D, '10000004', 'סורק עם מספר סידורי', 'כללי', NULL, 0, 300, 300, 300, true, :D1),
  ('f1b00000-0000-0000-0000-000000000005', :D, '10000005', 'רישיון אופיס', 'כללי', NULL, 0, 200, 200, 200, true, :D1),
  ('f1b00000-0000-0000-0000-000000000006', :D, '10000006', 'עכבר ישן', 'כללי', NULL, 3, 30, 30, 30, true, :D1)
ON CONFLICT (id) DO NOTHING;
UPDATE public.global_products SET requires_serial = true WHERE id = 'f1b00000-0000-0000-0000-000000000004';
UPDATE public.global_products SET is_digital = true WHERE id = 'f1b00000-0000-0000-0000-000000000005';
-- מוצר של חנות אחרת (B) — לבדיקת הפרדה
INSERT INTO public.global_products (id, tenant_id, sku, name, category, stock_quantity, price_tier1, price_tier2, price_tier3, uniform_price, created_by)
VALUES ('f1b00000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', '10000901', 'מוצר של חנות B (ייבוא)', 'כללי', 8, 10, 10, 10, true,
        'a0000000-0000-0000-0000-0000000000b1')
ON CONFLICT (id) DO NOTHING;

-- קריאה כמשתמש (RLS פעיל, החנות לפי header) — מחזיר את התוצאה, או {"error": ...}
CREATE OR REPLACE FUNCTION tests.pis(_uid uuid, _sql text,
                                     _tenant uuid DEFAULT '70000000-0000-0000-0000-00000000f1a0')
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _tenant)::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END, true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  BEGIN
    EXECUTE _sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := jsonb_build_object('error', SQLERRM);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.headers', '', true);
  RETURN v;
END $f$;

CREATE TEMP TABLE pis_out (k text PRIMARY KEY, v jsonb);
CREATE OR REPLACE FUNCTION pg_temp.pis_put(_k text, _v jsonb) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO pis_out (k, v) VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
$f$;

-- ---------- 1. הקובץ הראשון: בדיקת התאמה ----------
SELECT pg_temp.pis_put('file1', $j$[
  {"row": 2, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "7290000000011", "sku": "", "stock": "7"},
  {"row": 3, "name": "עכבר אלחוטי", "price": "50", "barcode": "", "sku": "SUP-77", "stock": "10"},
  {"row": 4, "name": "מקלדת", "price": "80", "barcode": "", "sku": "", "stock": "0"},
  {"row": 5, "name": "כבל  HDMI", "price": "20", "barcode": "", "sku": "", "stock": "6"},
  {"row": 6, "name": "מסך 24 אינץ'", "price": "480", "barcode": "", "sku": " 10000003", "stock": "1"},
  {"row": 7, "name": "שורה עם מחיר שבור", "price": "abc", "barcode": "", "sku": "", "stock": "1"}
]$j$::jsonb);
SELECT pg_temp.pis_put('match1', tests.pis(:D1,
  format('SELECT public.product_import_match(%L::jsonb)', (SELECT v FROM pis_out WHERE k = 'file1'))));

SELECT tests.check('import match: an existing barcode is a match (by barcode)',
  $$SELECT v -> 'rows' -> 0 ->> 'status' = 'matched' AND v -> 'rows' -> 0 ->> 'kind' = 'barcode'
       AND v -> 'rows' -> 0 -> 'products' -> 0 ->> 'id' = 'f1b00000-0000-0000-0000-000000000001'
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: a product that is not in the store is new',
  $$SELECT v -> 'rows' -> 1 ->> 'status' = 'new' AND v -> 'rows' -> 2 ->> 'status' = 'new'
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: the same name (extra spaces) is a match by name',
  $$SELECT v -> 'rows' -> 3 ->> 'status' = 'matched' AND v -> 'rows' -> 3 ->> 'kind' = 'name'
       AND v -> 'rows' -> 3 -> 'products' -> 0 ->> 'id' = 'f1b00000-0000-0000-0000-000000000002'
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: the internal 8-digit SKU matches (spaces ignored)',
  $$SELECT v -> 'rows' -> 4 ->> 'status' = 'matched' AND v -> 'rows' -> 4 ->> 'kind' = 'sku'
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: an invalid price is reported, not imported',
  $$SELECT v -> 'rows' -> 5 ->> 'status' = 'invalid' AND v -> 'rows' -> 5 ->> 'problem' LIKE 'מחיר לא תקין%'
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: the product card says what the store has (stock, price, editable)',
  $$SELECT (v -> 'rows' -> 0 -> 'products' -> 0 ->> 'stock')::int = 5
       AND (v -> 'rows' -> 0 -> 'products' -> 0 ->> 'price_editable')::boolean
       AND NOT (v -> 'rows' -> 0 -> 'products' -> 0 ->> 'ordered')::boolean
     FROM pis_out WHERE k = 'match1'$$);
SELECT tests.check('import match: read only — nothing was created or changed',
  $$SELECT (SELECT count(*) FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0') = 6
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001') = 5
       AND NOT EXISTS (SELECT 1 FROM public.product_imports WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0')$$);

-- ---------- 2. הייבוא הראשון: עדכון מלאי + הוספת חדשים ----------
SELECT tests.check('import begin: options are required (no default)',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'בחרו מה לעשות%%'$$,
         tests.pis(:D1, $$SELECT to_jsonb(public.product_import_begin('a.csv', '{"create_new": true, "missing": "keep"}'::jsonb, 3))$$)));
SELECT pg_temp.pis_put('imp1', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('catalog.csv', '{"existing": "stock", "create_new": true, "missing": "keep"}'::jsonb, 6))$$));
SELECT pg_temp.pis_put('apply1', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp1'), $j$[
  {"row": 2, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "7290000000011", "sku": "", "stock": "7", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001", "match": "barcode"},
  {"row": 3, "name": "עכבר אלחוטי", "price": "50", "barcode": "", "sku": "SUP-77", "stock": "10", "action": "create"},
  {"row": 4, "name": "מקלדת", "price": "80", "barcode": "", "sku": "", "stock": "0", "action": "create"},
  {"row": 5, "name": "כבל  HDMI", "price": "20", "barcode": "", "sku": "", "stock": "6", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000002", "match": "name"},
  {"row": 6, "name": "מסך 24 אינץ'", "price": "480", "barcode": "", "sku": " 10000003", "stock": "1", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000003", "match": "sku"},
  {"row": 7, "name": "שורה עם מחיר שבור", "price": "abc", "barcode": "", "sku": "", "stock": "1", "action": "skip", "reason": "מחיר לא תקין"}
]$j$)));
SELECT tests.check('import apply: 2 created, 3 updated, 1 skipped, nothing failed',
  $$SELECT (v ->> 'created')::int = 2 AND (v ->> 'updated')::int = 3 AND (v ->> 'skipped')::int = 1
       AND (v ->> 'failed')::int = 0
     FROM pis_out WHERE k = 'apply1'$$);
SELECT tests.check('import apply: stock of existing products follows the file',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001') = 7
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000002') = 6
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000003') = 1$$);
SELECT tests.check('import apply: prices were not touched (stock only)',
  $$SELECT (SELECT price_tier1 FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000003') = 500$$);
SELECT tests.check('import create: the new product got an internal 8-digit SKU and the supplier SKU is kept as a key',
  $$SELECT gp.sku ~ '^[0-9]{8}$' AND k.sku_raw = 'SUP-77' AND k.sku_norm = 'sup-77'
     FROM public.global_products gp
     JOIN public.product_supplier_keys k ON k.product_id = gp.id
    WHERE gp.tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND gp.name = 'עכבר אלחוטי'$$);
SELECT tests.check('import create: an explicit 0 in the file = out of stock (automatic)',
  $$SELECT stock_quantity = 0 AND is_out_of_stock AND out_of_stock_auto
     FROM public.global_products
    WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'מקלדת'$$);
SELECT tests.check('import log: before / after only for what changed',
  $$SELECT (c.before ->> 'stock')::int = 5 AND (c.after ->> 'stock')::int = 7 AND NOT c.after ? 'price'
       AND c.match_kind = 'barcode'
     FROM public.product_import_changes c
    WHERE c.product_id = 'f1b00000-0000-0000-0000-000000000001' AND c.action = 'updated'$$);
SELECT tests.run('import finish: done, nothing outside the file changed (keep)',
  format($$SELECT public.product_import_finish(%L::uuid, NULL)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp1')), :D1);
SELECT tests.check('import finish: status done, counts saved',
  $$SELECT status = 'done' AND finished_at IS NOT NULL AND (counts ->> 'created')::int = 2
       AND (counts ->> 'updated')::int = 3 AND NOT (counts ->> 'missing_applied')::boolean
     FROM public.product_imports WHERE id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1')$$);

-- ---------- 3. אותו קובץ שוב (כמויות אחרות): בלי כפולים, רק עדכון ----------
SELECT pg_temp.pis_put('match2', tests.pis(:D1, $$SELECT public.product_import_match('[
  {"row": 2, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "7290000000011", "sku": "", "stock": "7"},
  {"row": 3, "name": "עכבר אלחוטי", "price": "50", "barcode": "", "sku": "SUP-77", "stock": "0"},
  {"row": 4, "name": "מקלדת", "price": "80", "barcode": "", "sku": "", "stock": "3"}
]'::jsonb)$$));
SELECT tests.check('re-import match: every row is now an existing product (barcode, supplier SKU, name)',
  $$SELECT v -> 'rows' -> 0 ->> 'kind' = 'barcode'
       AND v -> 'rows' -> 1 ->> 'status' = 'matched' AND v -> 'rows' -> 1 ->> 'kind' = 'supplier_sku'
       AND v -> 'rows' -> 2 ->> 'status' = 'matched' AND v -> 'rows' -> 2 ->> 'kind' = 'name'
     FROM pis_out WHERE k = 'match2'$$);
SELECT pg_temp.pis_put('imp2', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('catalog.csv', '{"existing": "stock", "create_new": true, "missing": "keep"}'::jsonb, 3))$$));
SELECT pg_temp.pis_put('apply2', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp2'),
  (SELECT jsonb_agg(r || jsonb_build_object('action', 'update', 'product_id', m -> 'products' -> 0 ->> 'id', 'match', m ->> 'kind'))
     FROM jsonb_array_elements($j$[
       {"row": 2, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "7290000000011", "sku": "", "stock": "7"},
       {"row": 3, "name": "עכבר אלחוטי", "price": "50", "barcode": "", "sku": "SUP-77", "stock": "0"},
       {"row": 4, "name": "מקלדת", "price": "80", "barcode": "", "sku": "", "stock": "3"}]$j$::jsonb) WITH ORDINALITY AS a(r, n)
     JOIN jsonb_array_elements((SELECT v -> 'rows' FROM pis_out WHERE k = 'match2')) WITH ORDINALITY AS b(m, n2) ON b.n2 = a.n))));
SELECT tests.check('re-import: no duplicates — each name exists once',
  $$SELECT bool_and(c = 1) FROM (SELECT count(*) AS c FROM public.global_products
                                 WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0'
                                   AND name IN ('מחשב נייד Lenovo', 'עכבר אלחוטי', 'מקלדת') GROUP BY name) s$$);
SELECT tests.check('re-import: 2 updated, 1 unchanged (same stock)',
  $$SELECT (v ->> 'updated')::int = 2 AND (v ->> 'unchanged')::int = 1 AND (v ->> 'created')::int = 0
     FROM pis_out WHERE k = 'apply2'$$);
SELECT tests.check('re-import: stock 10 → 0 marks out of stock (automatic, like a stock count)',
  $$SELECT stock_quantity = 0 AND is_out_of_stock AND out_of_stock_auto
     FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'עכבר אלחוטי'$$);
SELECT tests.check('re-import: stock 0 → 3 removes the automatic out-of-stock mark',
  $$SELECT stock_quantity = 3 AND NOT is_out_of_stock AND NOT out_of_stock_auto
     FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'מקלדת'$$);
SELECT tests.check('re-import: no out-of-stock notification per product (bulk import)',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.staff_notifications n
                        WHERE n.kind = 'out_of_stock' AND n.body LIKE 'עכבר אלחוטי%')$$);
SELECT tests.run('re-import finish', format($$SELECT public.product_import_finish(%L::uuid, NULL)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp2')), :D1);

-- ---------- 4. השרת לא יוצר כפולים גם אם מבקשים ----------
SELECT pg_temp.pis_put('imp3', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('more.csv', '{"existing": "stock", "create_new": true, "missing": "keep"}'::jsonb, 6))$$));
SELECT pg_temp.pis_put('apply3', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp3'), $j$[
  {"row": 2, "name": "מחשב אחר", "price": "100", "barcode": "7290000000011", "sku": "", "stock": "1", "action": "create"},
  {"row": 3, "name": "מקלדת", "price": "80", "barcode": "", "sku": "", "stock": "1", "action": "create"},
  {"row": 4, "name": "עכבר", "price": "50", "barcode": "", "sku": "sup-77 ", "stock": "1", "action": "create"},
  {"row": 5, "name": "מקלדת", "price": "90", "barcode": "", "sku": "", "stock": "2", "action": "create", "force_new": true},
  {"row": 6, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "", "sku": "", "stock": "8", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"},
  {"row": 7, "name": "מחשב נייד Lenovo", "price": "100", "barcode": "", "sku": "", "stock": "9", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"}
]$j$)));
SELECT tests.check('no duplicates: create refused for an existing barcode',
  $$SELECT v -> 'errors' @> '[{"row": 2}]' AND (SELECT m ->> 'message' FROM jsonb_array_elements(v -> 'errors') m WHERE (m ->> 'row')::int = 2) LIKE '%אותו ברקוד%'
     FROM pis_out WHERE k = 'apply3'$$);
SELECT tests.check('no duplicates: create refused for an existing name (without "new product")',
  $$SELECT (SELECT m ->> 'message' FROM jsonb_array_elements(v -> 'errors') m WHERE (m ->> 'row')::int = 3) LIKE '%בשם הזה%'
     FROM pis_out WHERE k = 'apply3'$$);
SELECT tests.check('no duplicates: create refused for a saved supplier SKU (any case / spaces)',
  $$SELECT (SELECT m ->> 'message' FROM jsonb_array_elements(v -> 'errors') m WHERE (m ->> 'row')::int = 4) LIKE '%אותו ברקוד / מק"ט%'
     FROM pis_out WHERE k = 'apply3'$$);
SELECT tests.check('a second product with the same name only when marked "new product"',
  $$SELECT (v ->> 'created')::int = 1 AND (v ->> 'failed')::int = 3
       AND (SELECT count(*) FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'מקלדת') = 2
     FROM pis_out WHERE k = 'apply3'$$);
SELECT tests.check('the same product twice in one file: only the first row changes it',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001') = 8
       AND (v ->> 'skipped')::int = 1
       AND (SELECT m ->> 'message' FROM jsonb_array_elements(v -> 'warnings') m WHERE (m ->> 'row')::int = 7) LIKE '%כבר עודכן בשורה 6%'
     FROM pis_out WHERE k = 'apply3'$$);
SELECT pg_temp.pis_put('match3', tests.pis(:D1,
  $$SELECT public.product_import_match('[{"row": 2, "name": "מקלדת", "price": "80", "sku": "", "barcode": "", "stock": "1"}]'::jsonb)$$));
SELECT tests.check('two products with the same name = not clear-cut (ambiguous), both shown',
  $$SELECT v -> 'rows' -> 0 ->> 'status' = 'ambiguous' AND (v -> 'rows' -> 0 ->> 'total')::int = 2
       AND jsonb_array_length(v -> 'rows' -> 0 -> 'products') = 2
       AND jsonb_array_length(v -> 'rows' -> 0 -> 'ids') = 2
     FROM pis_out WHERE k = 'match3'$$);
SELECT pg_temp.pis_put('match4', tests.pis(:D1,
  $$SELECT public.product_import_match('[{"row": 2, "name": "כבל HDMI", "price": "20", "sku": "", "barcode": "7299999999999", "stock": "1"}]'::jsonb)$$));
SELECT tests.check('same name but a different barcode (both have one) = a different product (new)',
  $$SELECT v -> 'rows' -> 0 ->> 'status' = 'new' FROM pis_out WHERE k = 'match4'$$);
SELECT tests.run('finish 3', format($$SELECT public.product_import_finish(%L::uuid, NULL)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp3')), :D1);

-- ---------- 5. מחיר: רק למחיר אחיד; מבצע שפג; מספרים סידוריים ----------
UPDATE public.site_settings SET price_tiers_enabled = true WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0';
-- מבצע שנגמר (נשמר לפני הבדיקה של תאריך עתידי) — שינוי מחיר ייחסם בטריגר
SET session_replication_role = replica;
UPDATE public.global_products SET sale_price = 15, sale_ends_at = now() - interval '1 day', is_promo = true
 WHERE id = 'f1b00000-0000-0000-0000-000000000002';
SET session_replication_role = origin;
SELECT pg_temp.pis_put('imp4', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('prices.csv', '{"existing": "stock_price", "create_new": false, "missing": "keep"}'::jsonb, 5))$$));
SELECT pg_temp.pis_put('apply4', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp4'), $j$[
  {"row": 2, "name": "מחשב נייד Lenovo", "price": "120", "stock": "8", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"},
  {"row": 3, "name": "מסך 24 אינץ'", "price": "999", "stock": "4", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000003"},
  {"row": 4, "name": "כבל HDMI", "price": "25", "stock": "11", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000002"},
  {"row": 5, "name": "סורק עם מספר סידורי", "price": "300", "stock": "5", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000004"},
  {"row": 6, "name": "מוצר חדש בלי הרשאה", "price": "10", "stock": "5", "action": "create"}
]$j$)));
SELECT tests.check('price: a uniform price is updated in all three tiers',
  $$SELECT price_tier1 = 120 AND price_tier2 = 120 AND price_tier3 = 120
     FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001'$$);
SELECT tests.check('price: different tier prices are not touched (reported), the stock is updated',
  $$SELECT gp.price_tier1 = 500 AND gp.price_tier2 = 450 AND gp.stock_quantity = 4
       AND (SELECT m ->> 'message' FROM jsonb_array_elements(o.v -> 'warnings') m WHERE (m ->> 'row')::int = 3) LIKE '%מחירים שונים לדרגות%'
     FROM public.global_products gp, pis_out o
    WHERE gp.id = 'f1b00000-0000-0000-0000-000000000003' AND o.k = 'apply4'$$);
SELECT tests.check('price: a price the store refuses (ended sale) is reported; the stock still updated',
  $$SELECT gp.price_tier1 = 20 AND gp.stock_quantity = 11
       AND (SELECT m ->> 'message' FROM jsonb_array_elements(o.v -> 'warnings') m WHERE (m ->> 'row')::int = 4) LIKE 'המחיר לא עודכן%'
     FROM public.global_products gp, pis_out o
    WHERE gp.id = 'f1b00000-0000-0000-0000-000000000002' AND o.k = 'apply4'$$);
SELECT tests.check('serial numbers: the stock of a serial product is never changed by an import',
  $$SELECT gp.stock_quantity = 0
       AND (SELECT m ->> 'message' FROM jsonb_array_elements(o.v -> 'warnings') m WHERE (m ->> 'row')::int = 5) LIKE '%מספרים סידוריים%'
     FROM public.global_products gp, pis_out o
    WHERE gp.id = 'f1b00000-0000-0000-0000-000000000004' AND o.k = 'apply4'$$);
SELECT tests.check('"don''t add new products" is enforced by the server',
  $$SELECT (SELECT m ->> 'message' FROM jsonb_array_elements(v -> 'errors') m WHERE (m ->> 'row')::int = 6) LIKE '%לא להוסיף מוצרים חדשים%'
       AND NOT EXISTS (SELECT 1 FROM public.global_products WHERE name = 'מוצר חדש בלי הרשאה')
     FROM pis_out WHERE k = 'apply4'$$);
SELECT tests.run('finish 4', format($$SELECT public.product_import_finish(%L::uuid, NULL)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp4')), :D1);
UPDATE public.site_settings SET price_tiers_enabled = false WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0';
SELECT pg_temp.pis_put('imp4b', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('prices2.csv', '{"existing": "stock_price", "create_new": false, "missing": "keep"}'::jsonb, 1))$$));
SELECT pg_temp.pis_put('apply4b', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp4b'),
  $j$[{"row": 2, "name": "מסך 24 אינץ'", "price": "520", "stock": "4", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000003"}]$j$)));
SELECT tests.check('price: without customer tiers in the store — the price (tier 1) is updated, like the product form',
  $$SELECT price_tier1 = 520 AND price_tier2 = 450 AND price_tier3 = 400
     FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000003'$$);
SELECT tests.run('finish 4b', format($$SELECT public.product_import_finish(%L::uuid, NULL)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp4b')), :D1);

-- ---------- 6. מוצרים שלא בקובץ: אישור המספר, רק כשהכול טופל, לא דיגיטלי ולא סידורי ----------
SELECT pg_temp.pis_put('missing', tests.pis(:D1,
  $$SELECT public.product_import_missing_count(ARRAY['f1b00000-0000-0000-0000-000000000001']::uuid[], 'zero')$$));
SELECT tests.check('missing count: products not in the file, without digital / serial / already 0 and out of stock',
  $$SELECT (v ->> 'count')::int = (SELECT count(*) FROM public.global_products gp
                                    WHERE gp.tenant_id = '70000000-0000-0000-0000-00000000f1a0'
                                      AND gp.id <> 'f1b00000-0000-0000-0000-000000000001'
                                      AND NOT gp.is_digital AND NOT gp.requires_serial
                                      AND (gp.stock_quantity > 0 OR NOT gp.is_out_of_stock))
       AND (v ->> 'count')::int > 0 AND jsonb_array_length(v -> 'sample') > 0
     FROM pis_out WHERE k = 'missing'$$);
SELECT pg_temp.pis_put('imp5', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('only-one.csv', '{"existing": "stock", "create_new": false, "missing": "zero"}'::jsonb, 1))$$));
SELECT pg_temp.pis_put('apply5', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp5'),
  $j$[{"row": 2, "name": "מחשב נייד Lenovo", "price": "120", "stock": "8", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"}]$j$)));
CREATE TEMP TABLE pis_before AS
  SELECT id, stock_quantity, is_out_of_stock, out_of_stock_auto, is_hidden FROM public.global_products
   WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0';
SELECT tests.check('missing: refused when more products would change than the admin confirmed',
  format($$SELECT %L::jsonb ->> 'error' LIKE '%%גדל מאז הבדיקה%%'$$,
         tests.pis(:D1, format($$SELECT public.product_import_finish(%L::uuid, %s)$$,
           (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp5'), (SELECT (v ->> 'count')::int - 1 FROM pis_out WHERE k = 'missing')))));
SELECT tests.check('missing: nothing changed after the refusal',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products gp JOIN pis_before b ON b.id = gp.id
                        WHERE gp.stock_quantity <> b.stock_quantity)$$);
SELECT pg_temp.pis_put('finish5', tests.pis(:D1, format($$SELECT public.product_import_finish(%L::uuid, %s)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp5'), (SELECT (v ->> 'count')::int FROM pis_out WHERE k = 'missing'))));
SELECT tests.check('missing zero: every product not in the file is 0 and out of stock, and logged',
  $$SELECT (SELECT count(*) FROM public.product_import_changes
             WHERE import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp5') AND action = 'zeroed')
         = (SELECT (v ->> 'count')::int FROM pis_out WHERE k = 'missing')
       AND NOT EXISTS (SELECT 1 FROM public.global_products gp
                        WHERE gp.tenant_id = '70000000-0000-0000-0000-00000000f1a0'
                          AND gp.id <> 'f1b00000-0000-0000-0000-000000000001'
                          AND NOT gp.is_digital AND NOT gp.requires_serial
                          AND (gp.stock_quantity > 0 OR NOT gp.is_out_of_stock))
       AND (SELECT (v -> 'counts' ->> 'missing_applied')::boolean FROM pis_out WHERE k = 'finish5')$$);
SELECT tests.check('missing zero: the product in the file, the digital product and the serial product were not zeroed',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001') = 8
       AND NOT EXISTS (SELECT 1 FROM public.product_import_changes
                        WHERE import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp5')
                          AND product_id IN ('f1b00000-0000-0000-0000-000000000005', 'f1b00000-0000-0000-0000-000000000004'))$$);
-- יבוא שלא הושלם: לא נוגעים במה שלא בקובץ
SELECT pg_temp.pis_put('imp6', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('half.csv', '{"existing": "stock", "create_new": false, "missing": "hide"}'::jsonb, 2))$$));
SELECT pg_temp.pis_put('apply6', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp6'),
  $j$[{"row": 2, "name": "מחשב נייד Lenovo", "price": "120", "stock": "8", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"}]$j$)));
SELECT tests.check('missing: refused when the import did not finish all rows',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'היבוא לא הושלם%%'$$,
         tests.pis(:D1, format($$SELECT public.product_import_finish(%L::uuid, 1000)$$,
           (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp6')))));
SELECT tests.run('missing: finishing a stopped import without touching other products',
  format($$SELECT public.product_import_finish(%L::uuid, NULL)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp6')), :D1);
SELECT tests.check('missing: nothing was hidden by the stopped import',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND is_hidden)
       AND NOT EXISTS (SELECT 1 FROM public.product_import_changes
                        WHERE import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp6') AND action = 'hidden')$$);
-- הסתרה
SELECT pg_temp.pis_put('missing_hide', tests.pis(:D1,
  $$SELECT public.product_import_missing_count(ARRAY['f1b00000-0000-0000-0000-000000000001']::uuid[], 'hide')$$));
SELECT pg_temp.pis_put('imp7', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('hide.csv', '{"existing": "none", "create_new": false, "missing": "hide"}'::jsonb, 1))$$));
SELECT pg_temp.pis_put('apply7', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp7'),
  $j$[{"row": 2, "name": "מחשב נייד Lenovo", "price": "1", "stock": "1", "action": "update", "product_id": "f1b00000-0000-0000-0000-000000000001"}]$j$)));
SELECT tests.check('"don''t change existing products": the matched product stays as it is (unchanged)',
  $$SELECT (v ->> 'unchanged')::int = 1
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001') = 8
     FROM pis_out WHERE k = 'apply7'$$);
SELECT pg_temp.pis_put('finish7', tests.pis(:D1, format($$SELECT public.product_import_finish(%L::uuid, %s)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp7'), (SELECT (v ->> 'count')::int FROM pis_out WHERE k = 'missing_hide'))));
SELECT tests.check('missing hide: products not in the file are hidden (the digital one is not)',
  $$SELECT (SELECT count(*) FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND is_hidden)
         = (SELECT (v ->> 'count')::int FROM pis_out WHERE k = 'missing_hide')
       AND NOT (SELECT is_hidden FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000005')
       AND NOT (SELECT is_hidden FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001')$$);

-- ---------- 7. דוח ויבואים אחרונים ----------
SELECT pg_temp.pis_put('report1', tests.pis(:D1, format($$SELECT public.product_import_report(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp1'))));
SELECT tests.check('report: one row per file row with action, before and after',
  $$SELECT jsonb_array_length(v -> 'rows') = 6
       AND v -> 'rows' @> '[{"row": 2, "action": "updated", "before": {"stock": 5}, "after": {"stock": 7}}]'
       AND v -> 'rows' @> '[{"row": 3, "action": "created"}]'
       AND v -> 'rows' @> '[{"row": 7, "action": "skipped"}]'
       AND v -> 'import' ->> 'file_name' = 'catalog.csv'
     FROM pis_out WHERE k = 'report1'$$);
SELECT pg_temp.pis_put('recent', tests.pis(:D1, $$SELECT public.product_imports_recent()$$));
SELECT tests.check('recent imports: newest first, with counts',
  $$SELECT jsonb_array_length(v) = 8 AND v -> 0 ->> 'file_name' = 'hide.csv'
       AND (v -> 7 -> 'counts' ->> 'created')::int = 2
     FROM pis_out WHERE k = 'recent'$$);

-- ---------- 8. ביטול ----------
-- ביטול ההסתרה והאיפוס
SELECT pg_temp.pis_put('undo7', tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp7'))));
SELECT tests.check('undo hide: everything is shown again',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND is_hidden)
       AND (SELECT (v ->> 'restored')::int FROM pis_out WHERE k = 'undo7') > 0$$);
SELECT pg_temp.pis_put('undo5', tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp5'))));
SELECT tests.check('undo zero: the stock and the out-of-stock marks are back to what they were',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products gp JOIN pis_before b ON b.id = gp.id
                        WHERE gp.id <> 'f1b00000-0000-0000-0000-000000000001'
                          AND (gp.stock_quantity <> b.stock_quantity OR gp.is_out_of_stock <> b.is_out_of_stock
                               OR gp.out_of_stock_auto <> b.out_of_stock_auto))$$);
SELECT tests.check('undo twice is refused',
  format($$SELECT %L::jsonb ->> 'error' = 'היבוא הזה כבר בוטל'$$,
         tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp5')))));
-- הזמנה על המקלדת הראשונה (נוספה ביבוא 1) — בביטול היא תוסתר, לא תימחק
SET session_replication_role = replica;
INSERT INTO public.orders (id, tenant_id, order_number, order_source, customer_name, customer_phone, status, kind)
VALUES ('f1b00000-0000-0000-0000-0000000000e1', '70000000-0000-0000-0000-00000000f1a0', 'IMP-1', 'pos', 'לקוח בדיקה', '0501234567', 'delivered', 'order')
ON CONFLICT DO NOTHING;
INSERT INTO public.order_items (order_id, product_id, tenant_id, quantity, unit_price)
SELECT 'f1b00000-0000-0000-0000-0000000000e1', c.product_id, '70000000-0000-0000-0000-00000000f1a0', 1, 80
  FROM public.product_import_changes c
 WHERE c.import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1') AND c.action = 'created' AND c.product_name = 'מקלדת';
SET session_replication_role = origin;
-- שינוי ידני אחרי היבוא — הביטול לא דורס אותו
UPDATE public.global_products SET stock_quantity = 2 WHERE id = 'f1b00000-0000-0000-0000-000000000003';
SELECT pg_temp.pis_put('undo2', tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp2'))));
SELECT tests.check('undo re-import: the mouse is back to 10 in stock (not out of stock), the keyboard back to 0 (out of stock)',
  $$SELECT (SELECT stock_quantity = 10 AND NOT is_out_of_stock FROM public.global_products
             WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'עכבר אלחוטי')
       AND (SELECT stock_quantity = 0 AND is_out_of_stock AND out_of_stock_auto FROM public.global_products
             WHERE id = (SELECT c.product_id FROM public.product_import_changes c
                          WHERE c.import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1')
                            AND c.action = 'created' AND c.product_name = 'מקלדת'))$$);
SELECT pg_temp.pis_put('undo4', tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp4'))));
SELECT tests.check('undo prices: the uniform price goes back to what it was (120 → 100, all tiers)',
  $$SELECT price_tier1 = 100 AND price_tier2 = 100 AND price_tier3 = 100
     FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000001'$$);
SELECT tests.check('undo prices: the stock that import changed is back (HDMI 11 → 6)',
  $$SELECT stock_quantity = 6 FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000002'$$);
SELECT pg_temp.pis_put('undo1', tests.pis(:D1, format($$SELECT public.product_import_undo(%L::uuid)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp1'))));
SELECT tests.check('undo: a created product that was never ordered is deleted',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.global_products
                        WHERE tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND name = 'עכבר אלחוטי')
       AND NOT EXISTS (SELECT 1 FROM public.product_supplier_keys k
                        WHERE k.tenant_id = '70000000-0000-0000-0000-00000000f1a0' AND k.sku_norm = 'sup-77')$$);
SELECT tests.check('undo: a created product that was already ordered is hidden instead (the order keeps it)',
  $$SELECT gp.is_hidden AND o.v -> 'rows' @> '[{"row": 4}]' AND (o.v ->> 'hidden')::int = 1
     FROM public.global_products gp, pis_out o
    WHERE o.k = 'undo1'
      AND gp.id = (SELECT c.product_id FROM public.product_import_changes c
                    WHERE c.import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1')
                      AND c.action = 'created' AND c.product_name = 'מקלדת')$$);
SELECT tests.check('undo: a value changed by hand after the import is a conflict and stays',
  $$SELECT (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000003') = 2
       AND (SELECT undone FROM public.product_import_changes
             WHERE import_id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1')
               AND product_id = 'f1b00000-0000-0000-0000-000000000003') = 'conflict'
       AND (SELECT (v ->> 'conflicts')::int FROM pis_out WHERE k = 'undo1') >= 1$$);
SELECT tests.check('undo: the HDMI cable stock is restored (6 → 4)',
  $$SELECT stock_quantity = 4 FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-000000000002'$$);
SELECT tests.check('undo: the import is marked undone, the history stays',
  $$SELECT status = 'undone' AND undone_at IS NOT NULL
       AND (SELECT count(*) FROM public.product_import_changes c WHERE c.import_id = i.id) = 6
     FROM public.product_imports i WHERE i.id = (SELECT (v #>> '{}')::uuid FROM pis_out WHERE k = 'imp1')$$);

-- ---------- 9. הרשאות והפרדת חנויות ----------
SELECT tests.check('permissions: an agent of the store cannot import',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'רק מנהל החנות%%'$$,
         tests.pis(:D3, $$SELECT public.product_import_match('[]'::jsonb)$$)));
SELECT tests.check('permissions: anonymous visitors cannot call the import functions',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'permission denied%%'$$,
         tests.pis(NULL, $$SELECT public.product_import_match('[]'::jsonb)$$)));
SELECT tests.check('permissions: the import tables are not readable from the browser',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'permission denied%%'$$,
         tests.pis(:D1, $$SELECT to_jsonb(count(*)) FROM public.product_imports$$)));
SELECT tests.check('isolation: an admin of another store does not see the import (report)',
  format($$SELECT %L::jsonb ->> 'error' = 'היבוא לא נמצא'$$,
         tests.pis(:OA, format($$SELECT public.product_import_report(%L::uuid)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp2')),
                   '70000000-0000-0000-0000-00000000000a')));
SELECT tests.check('isolation: an admin of another store cannot undo it',
  format($$SELECT %L::jsonb ->> 'error' = 'היבוא לא נמצא'$$,
         tests.pis(:OA, format($$SELECT public.product_import_undo(%L::uuid)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp3')),
                   '70000000-0000-0000-0000-00000000000a')));
SELECT tests.check('isolation: the recent imports of another store are empty',
  format($$SELECT %L::jsonb = '[]'::jsonb$$,
         tests.pis(:OA, $$SELECT public.product_imports_recent()$$, '70000000-0000-0000-0000-00000000000a')));
SELECT pg_temp.pis_put('imp8', tests.pis(:D1,
  $$SELECT to_jsonb(public.product_import_begin('x.csv', '{"existing": "stock", "create_new": false, "missing": "keep"}'::jsonb, 1))$$));
SELECT pg_temp.pis_put('apply8', tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, %L::jsonb)$$,
  (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp8'),
  $j$[{"row": 2, "name": "מוצר של חנות B (ייבוא)", "price": "10", "stock": "0", "action": "update", "product_id": "f1b00000-0000-0000-0000-0000000000b1"}]$j$)));
SELECT tests.check('isolation: a product of another store cannot be updated (not found), and it did not change',
  $$SELECT (v ->> 'failed')::int = 1 AND v -> 'errors' -> 0 ->> 'message' = 'המוצר לא נמצא בחנות'
       AND (SELECT stock_quantity FROM public.global_products WHERE id = 'f1b00000-0000-0000-0000-0000000000b1') = 8
     FROM pis_out WHERE k = 'apply8'$$);
SELECT tests.check('isolation: the match never shows products of another store',
  format($$SELECT %L::jsonb -> 'rows' -> 0 ->> 'status' = 'new'$$,
         tests.pis(:D1, $$SELECT public.product_import_match('[{"row": 2, "name": "מוצר של חנות B (ייבוא)", "price": "10", "sku": "10000901", "barcode": "", "stock": "1"}]'::jsonb)$$)));
SELECT tests.check('another admin of the same store cannot write into an import someone else started',
  format($$SELECT %L::jsonb ->> 'error' = 'את היבוא הזה התחיל מנהל אחר'$$,
         tests.pis(:D2, format($$SELECT public.product_import_apply(%L::uuid, '[]'::jsonb)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp8')))));
SELECT tests.check('a finished import cannot be written into',
  format($$SELECT %L::jsonb ->> 'error' LIKE 'היבוא הזה כבר הסתיים%%'$$,
         tests.pis(:D1, format($$SELECT public.product_import_apply(%L::uuid, '[]'::jsonb)$$, (SELECT v #>> '{}' FROM pis_out WHERE k = 'imp2')))));

-- ---------- 10. ההתאמה הישנה לא השתנתה (סריקת אתר מקור) ----------
SELECT tests.check('the old import_products is unchanged: still skips an existing 8-digit SKU',
  format($$SELECT (%L::jsonb ->> 'duplicates')::int = 1$$,
         tests.pis(:D1, $$SELECT public.import_products('[{"row": 2, "name": "עותק", "price": "5", "sku": "10000001"}]'::jsonb)$$)));

DROP FUNCTION IF EXISTS tests.pis(uuid, text, uuid);

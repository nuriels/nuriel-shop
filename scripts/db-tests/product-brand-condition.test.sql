-- ============================================================
-- מיגרציה 207 (20261127100000_product_brand_condition.sql): מותג ומצב המוצר
--   • העמודות: brand עד 80 תווים בלי < >; item_condition רק new / refurbished / used; ריק = לא ידוע
--   • הצעות למותג / מצב: למוצר בלבד, ממתינות לאישור, לעולם לא מוחלות אוטומטית (גם כשההחלה האוטומטית פעילה)
--   • אישור (עם עריכה), "התיישנה", שחזור; מצב — רק אחד משלושת הערכים, גם בעריכה
--   • 'facts' ב-snapshot: רק מוצרים של החנות עם מותג / מצב חסר; שדה עם הצעה פתוחה / שנדחתה — חסום
--   • בידוד: חנות אחרת, סוכן
-- ============================================================
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set STORE_B '''70000000-0000-0000-0000-00000000000b'''
\set S_OWNER '''a0000000-0000-0000-0000-0000000000a1'''
\set S_AGENT '''a0000000-0000-0000-0000-0000000000a2'''
\set S_ADMIN_B '''a0000000-0000-0000-0000-0000000000b1'''

CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.sadd(_site uuid, _items jsonb, _only_empty boolean) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(format('SELECT public.store_seo_proposals_add(%L, %L, %L)', _site, _items, _only_empty));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.spid(_site uuid, _target uuid, _field text, _status text DEFAULT 'pending')
RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.store_seo_proposals WHERE tenant_id = _site AND target_id IS NOT DISTINCT FROM _target
     AND field = _field AND status = _status ORDER BY created_at DESC LIMIT 1;
$f$;

-- ---------- fixtures ----------
INSERT INTO public.categories (tenant_id, name)
SELECT x.t, x.n FROM (VALUES (:STORE_A::uuid, 'מחשבים ניידים מחודשים'), (:STORE_B::uuid, 'כללי')) x(t, n)
 WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.tenant_id = x.t AND c.name = x.n);
INSERT INTO public.global_products (tenant_id, sku, name, category, created_by)
VALUES (:STORE_A, '99207001', 'מחשב נייד Lenovo ThinkPad T480 מחודש', 'מחשבים ניידים מחודשים', :S_OWNER),
       (:STORE_A, '99207002', 'מטען למחשב נייד', 'מחשבים ניידים מחודשים', :S_OWNER),
       (:STORE_B, '99207003', 'מוצר של חנות B', 'כללי', :S_ADMIN_B);
SELECT id AS g1 FROM public.global_products WHERE sku = '99207001' \gset
SELECT id AS g2 FROM public.global_products WHERE sku = '99207002' \gset
SELECT id AS g3 FROM public.global_products WHERE sku = '99207003' \gset
SELECT id AS cat_a FROM public.categories WHERE tenant_id = :STORE_A AND name = 'מחשבים ניידים מחודשים' \gset

-- ============================================================
-- 1. The columns and their rules
-- ============================================================
SELECT tests.check('207: global_products has brand and item_condition, both empty for every existing product (nothing filled in)',
  $$SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'global_products'
             AND column_name IN ('brand', 'item_condition')) = 2
      AND NOT EXISTS (SELECT 1 FROM public.global_products WHERE brand IS NOT NULL OR item_condition IS NOT NULL)$$);
SELECT pg_temp.expect_error('207: a brand with markup is refused',
  format($$UPDATE public.global_products SET brand = '<b>Lenovo</b>' WHERE id = %L$$, :'g1'), 'global_products_brand_check');
SELECT pg_temp.expect_error('207: a brand longer than 80 characters is refused',
  format($$UPDATE public.global_products SET brand = repeat('x', 81) WHERE id = %L$$, :'g1'), 'global_products_brand_check');
SELECT pg_temp.expect_error('207: a blank brand is refused (empty = NULL, not spaces)',
  format($$UPDATE public.global_products SET brand = '   ' WHERE id = %L$$, :'g1'), 'global_products_brand_check');
SELECT pg_temp.expect_error('207: a condition outside new / refurbished / used is refused',
  format($$UPDATE public.global_products SET item_condition = 'like new' WHERE id = %L$$, :'g1'), 'global_products_item_condition_check');
SELECT pg_temp.expect_error('207: a brand proposal for the store cannot even be stored (product only — the new table rule)',
  format($$INSERT INTO public.store_seo_proposals (tenant_id, target_kind, target_id, field, proposed, source)
           VALUES (%L, 'store', NULL, 'brand', 'Lenovo', 'template')$$, :STORE_A), 'store_seo_proposals_product_fields');
SELECT pg_temp.expect_error('207: a condition proposal for a category cannot be stored either',
  format($$INSERT INTO public.store_seo_proposals (tenant_id, target_kind, target_id, field, proposed, source)
           VALUES (%L, 'category', %L, 'item_condition', 'used', 'template')$$, :STORE_A, :'cat_a'), 'violates check constraint');

-- ============================================================
-- 2. Proposals: product only, cleaned, never auto-applied
-- ============================================================
SELECT pg_temp.call(:STORE_A, :S_OWNER, $q$SELECT public.seo_settings_save('{"meta": true, "keywords": true}')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'brand', 'text', '  Lenovo  ', 'reason', 'המותג מופיע בשם המוצר'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g1', 'field', 'item_condition', 'text', 'Refurbished', 'reason', 'כתוב "מחודש" בשם המוצר'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'item_condition', 'text', 'like new'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'brand', 'text', 'Le<b>novo'),
  jsonb_build_object('target_kind', 'store', 'field', 'brand', 'text', 'Lenovo'),
  jsonb_build_object('target_kind', 'category', 'target_id', :'cat_a', 'field', 'item_condition', 'text', 'refurbished'),
  jsonb_build_object('target_kind', 'product', 'target_id', :'g3', 'field', 'brand', 'text', 'Other store')), true) AS add1 \gset
SELECT tests.check('207: brand + condition proposals for THIS store''s product are added (cleaned: trimmed, lower-case condition); a bad condition, markup, store / category targets and another store''s product are skipped',
  format($$SELECT (%1$L::jsonb ->> 'added')::int = 2 AND (%1$L::jsonb ->> 'skipped')::int = 5
           AND (SELECT proposed FROM public.store_seo_proposals WHERE id = pg_temp.spid(%2$L, %3$L, 'brand')) = 'Lenovo'
           AND (SELECT proposed FROM public.store_seo_proposals WHERE id = pg_temp.spid(%2$L, %3$L, 'item_condition')) = 'refurbished'$$,
         :'add1', :STORE_A, :'g1'));
SELECT tests.check('207: with every auto switch ON, the brand and the condition are NOT applied — they wait for the owner',
  format($$SELECT (%1$L::jsonb ->> 'auto_applied')::int = 0
           AND (SELECT brand IS NULL AND item_condition IS NULL FROM public.global_products WHERE id = %2$L)$$, :'add1', :'g1'));
SELECT pg_temp.call(:STORE_A, :S_OWNER, $q$SELECT public.seo_settings_save('{"meta": false, "keywords": false}')$q$) IS NOT NULL AS ok \gset

-- ============================================================
-- 3. The owner's list, approve (with an edit), stale, restore
-- ============================================================
SELECT tests.check('207: the owner sees both proposals with the current (empty) value and the product''s name',
  format($$SELECT (SELECT count(*) FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT public.store_seo_proposals()') -> 'proposals') e
                    WHERE e ->> 'target_id' = %3$L AND e ->> 'field' IN ('brand', 'item_condition')
                      AND e ->> 'current' = '' AND e ->> 'label' LIKE '%%ThinkPad%%') = 2$$, :STORE_A, :S_OWNER, :'g1'));
SELECT pg_temp.expect_error('207: a store agent cannot open the proposals',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT public.store_seo_proposals()')$$, :STORE_A, :S_AGENT), 'אין הרשאה');
SELECT pg_temp.expect_error('207: store B''s admin cannot decide store A''s brand proposal',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :STORE_B, :S_ADMIN_B,
         format('SELECT public.store_seo_proposal_decide(%L, ''approve'')', pg_temp.spid(:STORE_A, :'g1', 'brand'))), 'לא נמצאה');
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'approve', 'Lenovo ThinkPad')$q$,
  pg_temp.spid(:STORE_A, :'g1', 'brand'))) ->> 'status' AS st_brand \gset
SELECT tests.check('207: approve with the owner''s edit writes the brand to the product; logged',
  format($$SELECT %2$L = 'approved' AND (SELECT brand FROM public.global_products WHERE id = %1$L) = 'Lenovo ThinkPad'
           AND EXISTS (SELECT 1 FROM public.platform_audit_log l WHERE l.action = 'seo.proposal_approved'
                         AND l.details ->> 'target_id' = %1$L AND l.details ->> 'field' = 'brand')$$, :'g1', :'st_brand'));
SELECT pg_temp.expect_error('207: approving a condition with free text is refused (only new / refurbished / used)',
  format($$SELECT pg_temp.call(%L, %L, %L)$$, :STORE_A, :S_OWNER,
         format('SELECT public.store_seo_proposal_decide(%L, ''approve'', ''כמו חדש'')', pg_temp.spid(:STORE_A, :'g1', 'item_condition'))),
  'תווים לא מורשים');
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'approve', 'Used')$q$,
  pg_temp.spid(:STORE_A, :'g1', 'item_condition'))) ->> 'status' AS st_cond \gset
SELECT tests.check('207: the owner can change the proposed condition on approval (refurbished → used); written as "used"',
  format($$SELECT %2$L = 'approved' AND (SELECT item_condition FROM public.global_products WHERE id = %1$L) = 'used'$$, :'g1', :'st_cond'));
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_revert(%L)$q$,
  pg_temp.spid(:STORE_A, :'g1', 'item_condition', 'approved'))) ->> 'status' AS st_rev \gset
SELECT tests.check('207: restore → the condition is empty again (unknown), the brand stays',
  format($$SELECT %2$L = 'reverted' AND (SELECT item_condition IS NULL AND brand = 'Lenovo ThinkPad'
                                            FROM public.global_products WHERE id = %1$L)$$, :'g1', :'st_rev'));
-- stale: the owner wrote a brand in the product editor after the proposal was made
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'brand', 'text', 'Dell')), true) IS NOT NULL AS ok \gset
UPDATE public.global_products SET brand = 'HP' WHERE id = :'g2';
SELECT pg_temp.call(:STORE_A, :S_OWNER, format($q$SELECT public.store_seo_proposal_decide(%L, 'approve')$q$,
  pg_temp.spid(:STORE_A, :'g2', 'brand'))) ->> 'status' AS st_stale \gset
SELECT tests.check('207: approving after the owner set the brand meanwhile → "stale", the owner''s brand stays',
  format($$SELECT %2$L = 'stale' AND (SELECT brand FROM public.global_products WHERE id = %1$L) = 'HP'$$, :'g2', :'st_stale'));
SELECT tests.check('207: an only-empty run never proposes over a brand the owner already set',
  format($$SELECT (pg_temp.sadd(%1$L, jsonb_build_array(jsonb_build_object('target_kind', 'product', 'target_id', %2$L,
                     'field', 'brand', 'text', 'Lenovo')), true) ->> 'added')::int = 0$$, :STORE_A, :'g2'));

-- ============================================================
-- 4. The worker's snapshot: 'facts'
-- ============================================================
UPDATE public.global_products SET brand = NULL WHERE id = :'g2';
SELECT pg_temp.sadd(:STORE_A, jsonb_build_array(
  jsonb_build_object('target_kind', 'product', 'target_id', :'g2', 'field', 'item_condition', 'text', 'refurbished')), true) IS NOT NULL AS ok \gset
SELECT tests.check('207: facts = this store''s products missing a brand or a condition, with the fields already proposed blocked; no other store''s product',
  format($$SELECT (SELECT count(*) FROM jsonb_array_elements(x -> 'facts') f WHERE f ->> 'id' = %2$L) = 1
           AND (SELECT (f -> 'blocked') = '["item_condition"]'::jsonb FROM jsonb_array_elements(x -> 'facts') f WHERE f ->> 'id' = %2$L)
           AND (SELECT f ->> 'brand' = 'Lenovo ThinkPad' FROM jsonb_array_elements(x -> 'facts') f WHERE f ->> 'id' = %3$L)
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'facts') f WHERE f ->> 'id' = %4$L)
      FROM (SELECT pg_temp.srv(format('SELECT public.store_seo_snapshot(%%L)', %1$L)) AS x) y$$, :STORE_A, :'g2', :'g1', :'g3'));
SELECT tests.check('207: a pending brand / condition proposal does not hide the product from the Google-texts part of the snapshot',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.srv(format('SELECT public.store_seo_snapshot(%%L)', %1$L)) -> 'products') p
                    WHERE p ->> 'id' = %2$L)$$, :STORE_A, :'g2'));
SELECT pg_temp.expect_error('207: the snapshot is for the server only (a signed-in admin cannot call it)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT public.store_seo_snapshot(%%L)', %L))$$, :STORE_A, :S_OWNER, :STORE_A),
  'permission denied');
SELECT pg_temp.expect_error('207: the write helper refuses a field that is not allowed for the target (store brand)',
  format($$SELECT public._store_seo_write(%L, 'store', NULL, 'brand', 'x')$$, :STORE_A), 'שדה לא מוכר');

-- ---------- cleanup of what other files may count ----------
DELETE FROM public.store_seo_proposals WHERE target_id IN (:'g1', :'g2', :'g3');
DELETE FROM public.global_products WHERE sku IN ('99207001', '99207002', '99207003');

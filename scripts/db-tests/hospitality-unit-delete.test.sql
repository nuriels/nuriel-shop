-- ============================================================
-- Hospitality — safe unit delete (migration 205 — 20261123100000_hosp_unit_delete_safe.sql)
--   "צימר 6 נפתח בטעות": the owner deletes a unit opened by mistake from the units list, after an
--   "are you sure?" window that says exactly what goes with it.
--   • structure: the preview and the delete — owner only, never anon; the shared helper is internal;
--   • the preview: what goes with the unit (photos, prices, beds, amenities, calendars, add-on rooms of packages,
--     open SEO proposals) and what stops the delete (bookings / blocks, "the whole property", a package's own unit),
--     nothing changed; a manager, another business — refused;
--   • the delete: the same three stops (the package survives — before, CASCADE deleted it silently); a unit that is
--     an add-on room — leaves the list (max lowered, an emptied list = no add-ons, the CHECK of migration 202 holds,
--     revision up); open SEO proposals for the unit and its photos — closed ("stale"); the photo files come back for
--     the server to remove from the bucket; the action log.
-- ============================================================
\set OWNER205 '''a0000000-0000-0000-0000-000000205a01'''
\set MGR205 '''a0000000-0000-0000-0000-000000205a02'''
\set OTHER205 '''a0000000-0000-0000-0000-000000205a03'''

CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site)::text, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.err_of(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.call(_site, _uid, _sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.unit(_site text, _uid uuid, _property text, _name text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.unit_create(%L, %L::jsonb)', _property,
                                          jsonb_build_object('name', _name, 'unit_type', 'zimmer', 'capacity', 2))) ->> 'id';
$f$;

-- ---------- fixtures: a zimmer business like Nofi Dorit, with a unit opened by mistake ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000205a01', 'm205.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000205a02', 'm205.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000205a03', 'm205.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m205_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m205-del', 'נופי המחיקה', 'm205.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm205.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m205-other', 'אתר שכן', 'm205.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm205.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR205, 'm205.manager@test.local', 'm205_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER205,
  $q$SELECT hospitality.property_create('{"name": "נופי המחיקה", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'מוריה') AS um \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'אדיר') AS ua \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'גן עדן') AS ue \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'חדר א') AS w1 \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'חדר ב') AS w2 \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'צימר 6') AS u6 \gset
SELECT pg_temp.unit(:'st', :OWNER205, :'sp', 'צימר 7') AS u7 \gset
SELECT pg_temp.call(:'so', :OTHER205,
  $q$SELECT hospitality.property_create('{"name": "אתר שכן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
SELECT pg_temp.unit(:'so', :OTHER205, :'op', 'יחידה שכנה') AS uo \gset
UPDATE hospitality.units SET base_price = 500 WHERE tenant_id IN (:'st', :'so');
-- "גן עדן" was blocked once (history); "חדר א" + "חדר ב" are "the whole property"
SELECT pg_temp.call(:'st', :OWNER205, format('SELECT to_jsonb(hospitality.block_create(%L, current_date + 30, current_date + 32, %L))', :'ue', 'שיפוץ')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER205, format('SELECT to_jsonb(hospitality.whole_property_set(%L, true, ARRAY[%L, %L]::uuid[]))', :'sp', :'w1', :'w2')) IS NOT NULL AS ok \gset
-- the bridal package on "מוריה", with "צימר 6" and "אדיר" as add-on rooms (up to 2); a second package with only "צימר 6"
SELECT pg_temp.call(:'st', :OWNER205, format($q$SELECT hospitality.package_save(_id => NULL, _unit_id => %L, _kind => 'special',
         _name => 'חבילת כלה', _nights => 2, _price => 4000, _max_guests => 2,
         _addons => %L::jsonb)$q$, :'um', jsonb_build_object('unit_ids', jsonb_build_array(:'u6', :'ua'), 'nightly_price', 500, 'max', 2))) ->> 'id' AS pk \gset
SELECT pg_temp.call(:'st', :OWNER205, format($q$SELECT hospitality.package_save(_id => NULL, _unit_id => %L, _kind => 'package',
         _name => 'סוף שבוע זוגי', _nights => 2, _price => 1800, _max_guests => 2,
         _addons => %L::jsonb)$q$, :'ua', jsonb_build_object('unit_ids', jsonb_build_array(:'u6'), 'nightly_price', 400, 'max', 1))) ->> 'id' AS pk2 \gset
-- "צימר 6": two photos (one with sizes), a price rule, an open SEO proposal for the unit and one for a photo
INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, storage_path, variants)
VALUES (:'st', 'unit', :'u6', 'image', :'st' || '/m205-a.webp',
        jsonb_build_object('w640', :'st' || '/m205-a-640.webp', 'w1280', :'st' || '/m205-a-1280.webp'))
RETURNING id AS m1 \gset
INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, storage_path)
VALUES (:'st', 'unit', :'u6', 'image', :'st' || '/m205-b.webp') RETURNING id AS m2 \gset
INSERT INTO hospitality.rate_rules (tenant_id, unit_id, name, kind, days_mask, price_mode, value)
VALUES (:'st', :'u6', 'סוף שבוע', 'weekend', 96, 'fixed', 600);
SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%L, %L, %L, %L))', :'st', :OWNER205, 'template', 'request')) #>> '{}' AS run \gset
SELECT pg_temp.srv(format('SELECT hospitality.seo_proposals_add(%L, %L, %L::jsonb, false)', :'st', :'run',
  jsonb_build_array(jsonb_build_object('target_kind', 'unit', 'target_id', :'u6', 'field', 'seo_title', 'text', 'צימר 6 – עד 2 אורחים'),
                    jsonb_build_object('target_kind', 'media', 'target_id', :'m1', 'field', 'alt', 'text', 'מיטה זוגית בצימר 6'),
                    jsonb_build_object('target_kind', 'unit', 'target_id', :'u7', 'field', 'seo_title', 'text', 'צימר 7 – עד 2 אורחים')))) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(format('SELECT hospitality.seo_run_finish(%L, %L, true)', :'st', :'run')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: preview and delete are SECURITY DEFINER, for signed-in staff only (never anon); delete returns jsonb',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
       AND pg_get_function_result('hospitality.unit_delete(uuid)'::regprocedure) = 'jsonb'
      FROM pg_proc p WHERE p.oid IN ('hospitality.unit_delete(uuid)'::regprocedure, 'hospitality.unit_delete_preview(uuid)'::regprocedure)$$);
SELECT tests.check('structure: the shared "what stops a delete" helper is internal (not callable by staff or guests)',
  $$SELECT NOT has_function_privilege('authenticated', 'hospitality._unit_delete_block(uuid, uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality._unit_delete_block(uuid, uuid)', 'EXECUTE')$$);

-- ============================================================
-- 2. The preview — what goes with the unit and what stops the delete; nothing changes
-- ============================================================
CREATE TEMP TABLE m205_before AS
  SELECT (SELECT md5(string_agg(u::text, ',' ORDER BY u.id)) FROM hospitality.units u WHERE u.tenant_id = :'st') AS units,
         (SELECT md5(string_agg(p::text, ',' ORDER BY p.id)) FROM hospitality.packages p WHERE p.tenant_id = :'st') AS packages;
SELECT pg_temp.call(:'st', :OWNER205, format('SELECT hospitality.unit_delete_preview(%L)', :'u6')) AS pv \gset
SELECT tests.check('preview: "צימר 6" can be deleted — 2 photos, a price rule, the add-on rooms of both packages, 2 open SEO proposals (unit + photo)',
  format($$SELECT %1$L::jsonb ->> 'name' = 'צימר 6' AND %1$L::jsonb -> 'block' = 'null'::jsonb
             AND (%1$L::jsonb ->> 'photos')::int = 2 AND (%1$L::jsonb ->> 'seo_open')::int = 2
             AND (%1$L::jsonb ->> 'prices')::int = 1
             AND %1$L::jsonb -> 'addon_packages' = '["חבילת כלה", "סוף שבוע זוגי"]'::jsonb
             AND (%1$L::jsonb ->> 'is_active')::boolean$$, :'pv'));
SELECT tests.check('preview: changes nothing (units and packages exactly as before)',
  format($$SELECT (SELECT md5(string_agg(u::text, ',' ORDER BY u.id)) FROM hospitality.units u WHERE u.tenant_id = %1$L) = (SELECT units FROM m205_before)
             AND (SELECT md5(string_agg(p::text, ',' ORDER BY p.id)) FROM hospitality.packages p WHERE p.tenant_id = %1$L) = (SELECT packages FROM m205_before)$$,
         :'st'));
SELECT tests.check('preview: a unit with a block — "history", with the existing message (deactivate instead)',
  format($$SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) -> 'block'
               = jsonb_build_object('code', 'history', 'reason', 'ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק')$$,
         :'st', :OWNER205, :'ue'));
SELECT tests.check('preview: a unit inside "the whole property" — "whole", with the existing message',
  format($$SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) #>> '{block,code}' = 'whole'$$,
         :'st', :OWNER205, :'w1'));
SELECT tests.check('preview: the unit of a package — "package", naming the package',
  format($$SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) -> 'block'
               = jsonb_build_object('code', 'package', 'reason', 'החבילה "חבילת כלה" שייכת ליחידה הזו — יש להעביר את החבילה ליחידה אחרת או למחוק אותה קודם')$$,
         :'st', :OWNER205, :'um'));
SELECT tests.check('preview: a manager is refused (owner only, like the delete); so is another business''s owner on its own site',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) = 'רק בעל העסק יכול למחוק יחידה'
             AND pg_temp.err_of(%4$L, %5$L, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) = 'היחידה לא נמצאה'
             AND pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.unit_delete_preview(%%L)', %3$L)) IS NOT NULL$$,
         :'st', :MGR205, :'u6', :'so', :OTHER205));

-- ============================================================
-- 3. The delete — the stops (nothing changes)
-- ============================================================
SELECT tests.check('delete: refused for a manager, for another business, with a block, inside "the whole property"',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_delete(%%L)', %3$L)) = 'רק בעל העסק יכול למחוק יחידה'
             AND pg_temp.err_of(%4$L, %5$L, format('SELECT hospitality.unit_delete(%%L)', %3$L)) = 'היחידה לא נמצאה'
             AND pg_temp.err_of(%1$L, %6$L, format('SELECT hospitality.unit_delete(%%L)', %7$L)) = 'ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק'
             AND pg_temp.err_of(%1$L, %6$L, format('SELECT hospitality.unit_delete(%%L)', %8$L)) = 'היחידה כלולה ב"כל המתחם" — יש להסיר אותה משם קודם'$$,
         :'st', :MGR205, :'u6', :'so', :OTHER205, :OWNER205, :'ue', :'w1'));
SELECT tests.check('delete: the unit of a package is refused — and the package is still there (before: CASCADE deleted it silently)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.unit_delete(%%L)', %3$L)) LIKE 'החבילה "חבילת כלה" שייכת ליחידה הזו%%'
             AND EXISTS (SELECT 1 FROM hospitality.packages WHERE id = %4$L)
             AND EXISTS (SELECT 1 FROM hospitality.units WHERE id = %3$L)$$,
         :'st', :OWNER205, :'um', :'pk'));
SELECT tests.check('delete: after the refusals, units and packages are exactly as before',
  format($$SELECT (SELECT md5(string_agg(u::text, ',' ORDER BY u.id)) FROM hospitality.units u WHERE u.tenant_id = %1$L) = (SELECT units FROM m205_before)
             AND (SELECT md5(string_agg(p::text, ',' ORDER BY p.id)) FROM hospitality.packages p WHERE p.tenant_id = %1$L) = (SELECT packages FROM m205_before)$$,
         :'st'));

-- ============================================================
-- 4. The delete of "צימר 6"
-- ============================================================
SELECT revision AS pk_rev FROM hospitality.packages WHERE id = :'pk' \gset
SELECT revision AS pk2_rev FROM hospitality.packages WHERE id = :'pk2' \gset
SELECT pg_temp.call(:'st', :OWNER205, format('SELECT hospitality.unit_delete(%L)', :'u6')) AS del \gset
SELECT tests.check('delete: "צימר 6" is gone with its photos, beds and prices; the result lists every file for the bucket',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.units WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.media WHERE unit_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.rate_rules WHERE unit_id = %1$L)
             AND (%2$L::jsonb ->> 'deleted')::boolean
             AND (SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(%2$L::jsonb -> 'removed_files') x)
                 = ARRAY[%3$L || '/m205-a-1280.webp', %3$L || '/m205-a-640.webp', %3$L || '/m205-a.webp', %3$L || '/m205-b.webp']$$,
         :'u6', :'del', :'st'));
SELECT tests.check('delete: the bridal package keeps "אדיר" only, up to 1, same price, revision up (the CHECK of migration 202 holds)',
  format($$SELECT p.addon_unit_ids = ARRAY[%1$L]::uuid[] AND p.addon_max = 1 AND p.addon_nightly_price = 500
                  AND p.revision = %2$s + 1
             FROM hospitality.packages p WHERE p.id = %3$L$$,
         :'ua', :'pk_rev', :'pk'));
SELECT tests.check('delete: the package whose only add-on room it was — back to "no add-on rooms" (no price, max 0), revision up',
  format($$SELECT p.addon_unit_ids = '{}'::uuid[] AND p.addon_max = 0 AND p.addon_nightly_price IS NULL
                  AND p.revision = %1$s + 1
             FROM hospitality.packages p WHERE p.id = %2$L$$,
         :'pk2_rev', :'pk2'));
SELECT tests.check('delete: the open SEO proposals of the unit and its photo are closed ("stale", decided); another unit''s stays open',
  format($$SELECT (SELECT count(*) FROM hospitality.seo_proposals s WHERE s.tenant_id = %1$L AND s.status = 'stale'
                     AND s.decided_at IS NOT NULL AND s.target_id IN (%2$L, %3$L)) = 2
             AND (SELECT s.status FROM hospitality.seo_proposals s WHERE s.tenant_id = %1$L AND s.target_id = %4$L) = 'pending'$$,
         :'st', :'u6', :'m1', :'u7'));
SELECT tests.check('delete: logged once, with the number of photos and the packages it left',
  format($$SELECT count(*) = 1 AND bool_and((a.changes ->> 'photos')::int = 2
                                       AND a.changes -> 'removed_from_package_addons' = '["חבילת כלה", "סוף שבוע זוגי"]'::jsonb)
             FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'catalog.unit_deleted' AND a.target_label = 'צימר 6'$$,
         :'st'));
SELECT pg_temp.call(:'st', :OWNER205, format('SELECT hospitality.unit_delete(%L)', :'u7')) AS del7 \gset
SELECT tests.check('delete: a unit without photos or packages — plain delete, empty file list, logged with 0 photos',
  format($$SELECT %1$L::jsonb = '{"deleted": true, "removed_files": [], "removed_from_package_addons": []}'::jsonb
             AND NOT EXISTS (SELECT 1 FROM hospitality.units WHERE id = %2$L)
             AND (SELECT a.changes FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'catalog.unit_deleted'
                   AND a.target_label = 'צימר 7') = '{"photos": 0}'::jsonb$$,
         :'del7', :'u7', :'st'));
SELECT tests.check('delete: the other business is untouched',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.units WHERE id = %1$L)$$, :'uo'));

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'm205-del'), public.platform_delete_tenant(%2$L, 'm205-other')])$$, :'st', :'so')) IS NOT NULL AS ok \gset
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m205_flags m WHERE f.key = m.key;
DROP TABLE m205_flags;
DROP TABLE m205_before;

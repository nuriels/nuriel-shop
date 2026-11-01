-- ============================================================
-- Hospitality: photos and galleries (Hospitality Stage 2e — 20261101200000_hosp_media.sql)
--   • structure: no direct staff writes to media; functions DEFINER, never anon
--   • galleries for the site, a property and a unit; whole-property units refused
--   • paths only "<tenant>/<uuid>.<ext>" of the same site (+ "-960 / -480 / -thumb" variants)
--   • first image = cover; one cover per gallery; a video / embed cannot be the cover
--   • reorder with the loaded order ("updated in the meantime"); replace keeps place, cover, ALT;
--     delete returns the files and moves the cover; YouTube / Vimeo ids; usage in bytes
--   • outsiders refused everywhere; site isolation; Ecommerce data unchanged
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000008a1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000008a2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000008b1'''
\set GUEST '''a0000000-0000-0000-0000-0000000008c1'''
\set SHOP_OWNER '''a0000000-0000-0000-0000-0000000008e1'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set SHOP '''72e00000-0000-0000-0000-0000000000e1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
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
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text, _role text DEFAULT 'admin') RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, _role, true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
       JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(x::text, ',' ORDER BY x.tenant_id) FROM public.tenant_subscriptions x)));
$f$;
-- a hospitality call as somebody, on a site — returns the function's jsonb
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h_sql(_site text, _uid uuid, _call text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT pg_temp.h(%L, %L, %L)', _site, _uid, _call);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.unused_rev(_unit uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.units WHERE id = _unit;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.prev(_property uuid) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.properties WHERE id = _property;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.last_audit(_site uuid, _action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT to_jsonb(a) FROM hospitality.audit_log a WHERE tenant_id = _site AND action = _action ORDER BY id DESC LIMIT 1;
$f$;
-- a file item as the server sends it, for site _s: "<site>/<uuid>.webp" + variants
CREATE OR REPLACE FUNCTION pg_temp.img(_s uuid, _n integer, _bytes integer DEFAULT 1000) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('kind', 'image',
    'storage_path', _s || '/' || u || '.webp',
    'variants', jsonb_build_object('960', _s || '/' || u || '-960.webp', '480', _s || '/' || u || '-480.webp',
                                   'thumb', _s || '/' || u || '-thumb.webp'),
    'width', 1600, 'height', 1067, 'size_bytes', _bytes)
    FROM (SELECT ('00000000-0000-4000-8000-' || lpad(_n::text, 12, '0'))::uuid AS u) x;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.order_of(_unit uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(right(storage_path, 7) || CASE WHEN is_cover THEN '*' ELSE '' END, ',' ORDER BY sort_order)
    FROM hospitality.media WHERE unit_id = _unit;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000008a1', 'c2e.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000008a2', 'c2e.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000008b1', 'c2e.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000008c1', 'c2e.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000008e1', 'c2e.shop.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2e-a', 'אירוח תמונות A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('c2e-b', 'אירוח תמונות B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'c2e-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'c2e-b' \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'c2e_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'c2e_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'c2e_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
INSERT INTO public.tenants (id, slug, name) VALUES (:SHOP, 'c2e-shop', 'חנות 2e');
SELECT pg_temp.add_role(:SHOP, :SHOP_OWNER, 'c2e_shop_owner') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id = :SHOP_OWNER;
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
CREATE TEMP TABLE c2e_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "חוות הזית", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הזית", "unit_type": "zimmer"}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר האלון", "unit_type": "zimmer"}')$$, :'pa')) ->> 'id' AS u2 \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('media: no direct INSERT / UPDATE / DELETE for staff; SELECT kept',
  $$SELECT NOT has_table_privilege('authenticated', 'hospitality.media', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'hospitality.media', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'hospitality.media', 'DELETE')
       AND has_table_privilege('authenticated', 'hospitality.media', 'SELECT')$$);
SELECT tests.check('media: every gallery function is SECURITY DEFINER, authenticated only (never anon)',
  $$SELECT bool_and(p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('media_list', 'media_galleries', 'media_add', 'media_add_embed', 'media_update',
                         'media_set_cover', 'media_reorder', 'media_replace', 'media_delete')
    HAVING count(*) = 9$$);
SELECT tests.check('media: helpers are not callable by API roles',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('_media_owner', '_media_gallery_lock', '_media_in_gallery', '_media_path_ok', '_media_item',
                         '_media_files', '_media_json', '_media_usage', '_media_ensure_cover', '_media_get')
    HAVING count(*) = 10$$);

-- ============================================================
-- 2. adding, paths, the cover
-- ============================================================
SELECT pg_temp.h(:'sa', :MGR_A, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 1, 5000))) ->> 'id' AS m1 \gset
SELECT tests.check('add: the manager adds the first photo of a unit — it becomes the cover; audit row',
  format($$SELECT m.is_cover AND m.sort_order = 0 AND m.kind = 'image' AND m.size_bytes = 5000
             AND m.variants ? 'thumb' AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'media.added') = 1
           FROM hospitality.media m WHERE m.id = %L$$, :'sa', :'m1'));
SELECT pg_temp.h(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 2))) ->> 'id' AS m2 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 3))) ->> 'id' AS m3 \gset
SELECT tests.check('add: next photos go to the end; still one cover',
  format($$SELECT pg_temp.order_of(%L) = '01.webp*,02.webp,03.webp'$$, :'u1'));
SELECT pg_temp.expect_error('path: another site''s folder is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sb', 9))), 'נתיב הקובץ לא תקין');
SELECT pg_temp.expect_error('path: traversal / other names are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1',
    jsonb_set(pg_temp.img(:'sa', 9), '{storage_path}', to_jsonb(:'sa' || '/../x.webp')))), 'נתיב הקובץ לא תקין');
SELECT pg_temp.expect_error('path: an image must be .webp (re-encoded by the server)',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1',
    jsonb_set(pg_temp.img(:'sa', 9), '{storage_path}', to_jsonb(:'sa' || '/00000000-0000-4000-8000-000000000009.svg')))), 'נתיב הקובץ לא תקין');
SELECT pg_temp.expect_error('path: a variant must belong to the same file',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1',
    jsonb_set(pg_temp.img(:'sa', 9), '{variants,thumb}', to_jsonb(:'sa' || '/00000000-0000-4000-8000-000000000001-thumb.webp')))), 'נתיב הקובץ לא תקין');
SELECT pg_temp.expect_error('add: the same file twice is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u2', pg_temp.img(:'sa', 1))), 'כבר בגלריה');
SELECT pg_temp.expect_error('add: unknown fields are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 9) || '{"is_demo": true}')), 'לא תקינים');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$$, :'pa', :'u1', :'u2')) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :'pa' AND kind = 'whole_property' \gset
SELECT pg_temp.expect_error('add: the "whole property" unit has no gallery of its own',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add('unit', %L, %L)$$, :'uw', pg_temp.img(:'sa', 9))), 'בגלריה של המתחם');
SELECT pg_temp.after('add: the site gallery and a property gallery work the same way',
  format($$SELECT jsonb_build_array(pg_temp.h(%1$L, %2$L, format('media_add(''site'', NULL, %%L)', pg_temp.img(%1$L, 21))),
                                    pg_temp.h(%1$L, %2$L, format('media_add(''property'', %%L, %%L)', %3$L, pg_temp.img(%1$L, 22))))$$,
         :'sa', :OWNER_A, :'pa'),
  $$SELECT ($1 -> 0 ->> 'is_cover')::boolean AND ($1 -> 1 ->> 'is_cover')::boolean$$);

-- ============================================================
-- 3. cover, order, ALT, embed
-- ============================================================
SELECT pg_temp.after('cover: another photo becomes the cover — exactly one per gallery',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_set_cover(%L)$$, :'m3')),
  format($$SELECT pg_temp.order_of(%L) = '01.webp,02.webp,03.webp*'$$, :'u1'));
SELECT pg_temp.expect_error('order: a stale order is refused ("updated in the meantime")',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_reorder('unit', %L, ARRAY[%L, %L, %L]::uuid[], ARRAY[%L, %L, %L]::uuid[])$$,
    :'u1', :'m2', :'m1', :'m3', :'m3', :'m2', :'m1')), 'עודכנה בינתיים');
SELECT pg_temp.expect_error('order: a list with a missing / foreign item is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_reorder('unit', %L, ARRAY[%L, %L, %L]::uuid[], ARRAY[%L, %L, %L]::uuid[])$$,
    :'u1', :'m1', :'m2', :'m3', :'m3', :'m2', :'m2')), 'רשימת הסדר');
SELECT pg_temp.after('order: the new order is saved',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_reorder('unit', %L, ARRAY[%L, %L, %L]::uuid[], ARRAY[%L, %L, %L]::uuid[])$$,
    :'u1', :'m1', :'m2', :'m3', :'m3', :'m1', :'m2')),
  format($$SELECT pg_temp.order_of(%L) = '03.webp*,01.webp,02.webp'$$, :'u1'));
SELECT pg_temp.after('ALT: saved (empty clears it), the log says only "changed"',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_update(%L, '  ג׳קוזי מול הנוף  ')$$, :'m1')),
  format($$SELECT (SELECT alt FROM hospitality.media WHERE id = %L) = 'ג׳קוזי מול הנוף'
             AND NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE changes::text LIKE '%%מול הנוף%%')$$, :'m1'));
SELECT pg_temp.expect_error('ALT: over 250 characters is refused',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_update(%L, %L)$$, :'m1', repeat('א', 251))), 'ארוך מדי');
SELECT pg_temp.h(:'sa', :OWNER_A, format($$media_add_embed('unit', %L, 'youtube', 'dQw4w9WgXcQ', 'סיור')$$, :'u1')) ->> 'id' AS me \gset
SELECT pg_temp.after('embed: a YouTube video goes to the end, never the cover',
  format($$SELECT pg_temp.h(%L, %L, format('media_add_embed(''unit'', %%L, ''vimeo'', ''76979871'')', %L))$$, :'sa', :OWNER_A, :'u1'),
  format($$SELECT (SELECT count(*) FROM hospitality.media WHERE unit_id = %L AND kind = 'embed' AND NOT is_cover) = 2$$, :'u1'));
SELECT pg_temp.expect_error('embed: a bad YouTube id is refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add_embed('unit', %L, 'youtube', 'not a real id')$$, :'u1')), 'רק YouTube או Vimeo');
SELECT pg_temp.expect_error('embed: other providers are refused',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_add_embed('unit', %L, 'dailymotion', 'x7tgad0aaaa')$$, :'u1')), 'רק YouTube או Vimeo');
SELECT pg_temp.expect_error('cover: a video cannot be the cover',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_set_cover(%L)$$, :'me')), 'רק תמונה');

-- ============================================================
-- 4. replace and delete
-- ============================================================
SELECT pg_temp.after('replace: the new file keeps the place, the cover and the ALT; the old files are returned',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_replace(%L, %L)$$, :'m3', pg_temp.img(:'sa', 33, 7000))),
  format($$SELECT jsonb_array_length($1 -> 'removed_files') = 4 AND $1 -> 'removed_files' ->> 0 LIKE '%%000000000003.webp'
             AND pg_temp.order_of(%L) LIKE '33.webp*,01.webp,02.webp%%'
             AND (SELECT size_bytes = 7000 FROM hospitality.media WHERE id = %L)$$, :'u1', :'m3'));
SELECT pg_temp.expect_error('replace: an image cannot replace a video link',
  pg_temp.h_sql(:'sa', :OWNER_A, format($$media_replace(%L, %L)$$, :'me', pg_temp.img(:'sa', 34))), 'להחליף');
SELECT pg_temp.after('delete: the cover is deleted — the next photo becomes the cover; its files are returned',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_delete(%L)$$, :'m3')),
  format($$SELECT jsonb_array_length($1 -> 'removed_files') = 4
             AND (SELECT is_cover FROM hospitality.media WHERE id = %L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.media WHERE id = %L)$$, :'m1', :'m3'));
SELECT pg_temp.after('delete: a video link has no files',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_delete(%L)$$, :'me')),
  $$SELECT $1 -> 'removed_files' = '[]'$$);

-- ============================================================
-- 5. reading, usage, limits
-- ============================================================
SELECT pg_temp.after('list: the unit gallery in order, with the site''s usage in bytes',
  pg_temp.h_sql(:'sa', :MGR_A, format($$media_list('unit', %L)$$, :'u1')),
  $$SELECT $1 ->> 'label' = 'צימר הזית' AND jsonb_array_length($1 -> 'items') = 3
       AND ($1 -> 'items' -> 0 ->> 'is_cover')::boolean AND ($1 -> 'usage' ->> 'bytes')::bigint = 5000 + 1000 + 1000 + 1000$$);
SELECT pg_temp.after('galleries: the site, the property and each unit with a count and the cover',
  pg_temp.h_sql(:'sa', :OWNER_A, 'media_galleries()'),
  $$SELECT ($1 -> 'site' ->> 'count')::integer = 1 AND ($1 -> 'properties' -> 0 ->> 'count')::integer = 1
       AND (SELECT (u ->> 'count')::integer FROM jsonb_array_elements($1 -> 'properties' -> 0 -> 'units') u WHERE u ->> 'name' = 'צימר הזית') = 3
       AND jsonb_array_length($1 -> 'properties' -> 0 -> 'units') = 2$$);
SELECT pg_temp.expect_error('limit: at most 60 items per gallery',
  format($$SELECT pg_temp.h(%1$L, %2$L, format('media_add(''unit'', %%L, %%L)', %3$L, pg_temp.img(%1$L, 100 + i))) FROM generate_series(1, 61) i$$,
         :'sa', :OWNER_A, :'u2'),
  'עד 60');

-- ============================================================
-- 6. outsiders and isolation
-- ============================================================
SELECT pg_temp.expect_error('outsiders: site B''s owner cannot add to A through A',
  pg_temp.h_sql(:'sa', :OWNER_B, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 77))), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: through its own site, B does not find A''s photo',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$media_delete(%L)$$, :'m1')), 'התמונה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: through its own site, B cannot use A''s unit as a gallery',
  pg_temp.h_sql(:'sb', :OWNER_B, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sb', 78))), 'היחידה לא נמצאה');
SELECT pg_temp.expect_error('outsiders: a signed-in guest cannot list',
  pg_temp.h_sql(:'sa', :GUEST, format($$media_list('unit', %L)$$, :'u1')), 'אין הרשאה');
SELECT pg_temp.expect_error('outsiders: anonymous callers cannot add',
  pg_temp.h_sql(:'sa', NULL, format($$media_add('unit', %L, %L)$$, :'u1', pg_temp.img(:'sa', 79))), 'permission denied');
SELECT pg_temp.expect_error('outsiders: a store owner cannot use the gallery functions',
  pg_temp.h_sql(:SHOP, :SHOP_OWNER, 'media_galleries()'), 'אין הרשאה');
SELECT pg_temp.expect_error('direct write: staff cannot change media rows directly',
  format($$SELECT pg_temp.call(%L, %L, 'UPDATE hospitality.media SET is_cover = true RETURNING to_jsonb(true)')$$, :'sa', :OWNER_A),
  'permission denied');
SELECT pg_temp.after('isolation: site B sees an empty overview',
  pg_temp.h_sql(:'sb', :OWNER_B, 'media_galleries()'),
  $$SELECT ($1 -> 'usage' ->> 'items')::integer = 0 AND jsonb_array_length($1 -> 'properties') = 0$$);
SELECT tests.check('ecommerce: store data unchanged',
  $$SELECT pg_temp.ecommerce_hash() = (SELECT h FROM c2e_before)$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'c2e-a'), public.platform_delete_tenant(%2$L, 'c2e-b')])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset
DROP TABLE c2e_before;

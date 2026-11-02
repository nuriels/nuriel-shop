-- ============================================================
-- Hospitality — the logo outside the galleries (migration 42 — 20261105190000_hosp_logo_brand.sql)
--   • the table: 'brand' — no property, no unit, an image only;
--   • uploading a logo (media_add 'brand') never becomes or replaces the site's main image — in an
--     empty site gallery and in one with a main image; a logo has no main image of its own;
--   • the logo is not in the site gallery: media_list / media_galleries / the public 'gallery' —
--     it is in 'brand' (the editor and the site find it by the id in the design document);
--   • 'brand' takes no id and no video; deleting a logo leaves the main image alone;
--   • existing logos in the site gallery move to 'brand' (used as the logo in a design version, or
--     uploaded with the logo button) and the site gallery gets its first photo as the main image;
--     other photos, videos, property photos and other businesses — untouched.
-- ============================================================
\set OWNER42 '''a0000000-0000-0000-0000-000000042a01'''

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
-- a direct write (the table itself), as the database owner: the SQLSTATE, or NULL when it worked
CREATE OR REPLACE FUNCTION pg_temp.raw_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- a file the server wrote: "<tenant>/<uuid>.webp" + the three sizes
CREATE OR REPLACE FUNCTION pg_temp.img(_s uuid, _n integer, _alt text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('kind', 'image',
    'storage_path', _s || '/' || u || '.webp',
    'variants', jsonb_build_object('960', _s || '/' || u || '-960.webp', '480', _s || '/' || u || '-480.webp',
                                   'thumb', _s || '/' || u || '-thumb.webp'),
    'width', 800, 'height', 400, 'size_bytes', 2000)
    || CASE WHEN _alt IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('alt', _alt) END
    FROM (SELECT ('00000000-0000-4000-8042-' || lpad(_n::text, 12, '0'))::uuid AS u) x;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ids(_items jsonb) RETURNS text[] LANGUAGE sql AS $f$
  SELECT COALESCE(array_agg(x ->> 'id' ORDER BY x ->> 'id'), '{}') FROM jsonb_array_elements(_items) x;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000042a01', 'm42.owner@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m42_flags AS
  SELECT key, enabled FROM public.platform_feature_flags
   WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled');
UPDATE public.platform_feature_flags SET enabled = true
 WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled');
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m42-logo', 'צימר הלוגו', 'm42.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm42.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. The table
-- ============================================================
SELECT tests.check('table: a logo has no property and no unit, and is an image only (no video, no embed)',
  format($$SELECT pg_temp.raw_err(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, embed_provider, embed_id) VALUES (%%L, ''brand'', ''embed'', ''youtube'', ''dQw4w9WgXcQ'')', %1$L)) = '23514'
             AND pg_temp.raw_err(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path) VALUES (%%L, ''brand'', ''video'', %%L)', %1$L, %1$L || '/00000000-0000-4000-8042-000000000099.mp4')) = '23514'
             AND pg_temp.raw_err(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path, unit_id) VALUES (%%L, ''brand'', ''image'', %%L, gen_random_uuid())', %1$L, %1$L || '/00000000-0000-4000-8042-000000000098.webp')) IS NOT NULL
             AND pg_temp.raw_err(format('INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path) VALUES (%%L, ''logo'', ''image'', %%L)', %1$L, %1$L || '/00000000-0000-4000-8042-000000000097.webp')) = '23514'
             AND NOT EXISTS (SELECT 1 FROM hospitality.media WHERE tenant_id = %1$L)$$, :'st'));

-- ============================================================
-- 2. Uploading a logo never becomes the main image
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER42, format($q$SELECT hospitality.media_add('brand', NULL, %L)$q$,
  pg_temp.img(:'st', 1, 'הלוגו של צימר הלוגו'))) ->> 'id' AS logo1 \gset
SELECT tests.check('upload into an empty site: the logo is saved as the logo, not as a main image, and the site gallery stays empty',
  format($$SELECT m.owner_kind = 'brand' AND NOT m.is_cover AND m.property_id IS NULL AND m.unit_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM hospitality.media x WHERE x.tenant_id = m.tenant_id AND x.owner_kind = 'site')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = m.tenant_id AND a.action = 'media.added' AND a.target_label = 'הלוגו')
            FROM hospitality.media m WHERE m.id = %L$$, :'logo1'));

SELECT pg_temp.call(:'st', :OWNER42, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  pg_temp.img(:'st', 2, 'הנוף מהמרפסת'))) ->> 'id' AS photo_a \gset
SELECT tests.check('the first photo of the site gallery is its main image — the logo uploaded before it does not count',
  format($$SELECT is_cover FROM hospitality.media WHERE id = %L$$, :'photo_a'));

SELECT pg_temp.call(:'st', :OWNER42, format($q$SELECT hospitality.media_add('brand', NULL, %L)$q$,
  pg_temp.img(:'st', 3, 'הלוגו של צימר הלוגו'))) ->> 'id' AS logo2 \gset
SELECT tests.check('a second logo (replacing the first): the site main image stays; logos never get a main image',
  format($$SELECT (SELECT is_cover FROM hospitality.media WHERE id = %1$L)
             AND (SELECT count(*) FROM hospitality.media WHERE tenant_id = %2$L AND is_cover) = 1
             AND (SELECT bool_and(NOT is_cover) FROM hospitality.media WHERE tenant_id = %2$L AND owner_kind = 'brand')$$,
         :'photo_a', :'st'));

SELECT tests.check('the logo takes no id and no video link (the gallery is not found / an image only)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.media_add(''brand'', %%L, %%L)', gen_random_uuid(), pg_temp.img(%1$L::uuid, 4))) = 'הגלריה לא נמצאה'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.media_add_embed(''brand'', NULL, ''youtube'', ''dQw4w9WgXcQ'')') IS NOT NULL
             AND (SELECT count(*) FROM hospitality.media WHERE tenant_id = %1$L) = 3$$, :'st', :OWNER42));

-- ============================================================
-- 3. Where the logo shows — and where it does not
-- ============================================================
SELECT tests.check('management: the site gallery lists the photo only; the logo list has the two logos ("הלוגו")',
  format($$SELECT pg_temp.ids(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.media_list(''site'', NULL)') -> 'items') = ARRAY[%3$L]
             AND pg_temp.ids(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.media_list(''brand'', NULL)') -> 'items') = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[%4$L, %5$L]) x)
             AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.media_list(''brand'', NULL)') ->> 'label' = 'הלוגו'$$,
         :'st', :OWNER42, :'photo_a', :'logo1', :'logo2'));
SELECT tests.check('management: the photos overview counts 1 photo in the site gallery and shows it as the main image',
  format($$SELECT (g -> 'site' ->> 'count')::integer = 1 AND g -> 'site' -> 'cover' ->> 'id' = %3$L
            FROM (SELECT pg_temp.call(%1$L, %2$L, 'SELECT hospitality.media_galleries()') AS g) x$$,
         :'st', :OWNER42, :'photo_a'));
SELECT tests.check('public site: the gallery has the photo only; the logos come separately ("brand", no main image)',
  format($$SELECT pg_temp.ids(p -> 'gallery') = ARRAY[%2$L]
             AND pg_temp.ids(p -> 'brand') = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[%3$L, %4$L]) x)
             AND (SELECT bool_and(NOT (x ->> 'is_cover')::boolean) FROM jsonb_array_elements(p -> 'brand') x)
            FROM (SELECT hospitality._site_payload(%1$L) AS p) s$$, :'st', :'photo_a', :'logo1', :'logo2'));

SELECT pg_temp.call(:'st', :OWNER42, format($q$SELECT hospitality.media_delete(%L)$q$, :'logo1')) AS del \gset
SELECT tests.check('deleting an old logo: its files come back to the server; the site main image stays',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'removed_files') = 4
             AND NOT EXISTS (SELECT 1 FROM hospitality.media WHERE id = %2$L)
             AND (SELECT is_cover FROM hospitality.media WHERE id = %3$L)$$, :'del', :'logo1', :'photo_a'));

-- ============================================================
-- 4. Logos already in the site gallery (before migration 42) move out
-- ============================================================
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m42-old', 'צימר ישן', 'm42.owner@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm42.owner@test.local')$$, :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'so', :OWNER42,
  $q$SELECT hospitality.property_create('{"name": "מתחם ישן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sop \gset
-- as the old app left them: the logo button's upload became the main image; another picture was
-- picked as the logo in the draft (upper case on purpose); a photo; a video; a property photo
-- picked as the logo in a published version
INSERT INTO hospitality.media (id, tenant_id, owner_kind, kind, storage_path, alt, is_cover, sort_order) VALUES
  ('00000000-0000-4000-8042-0000000000a1', :'so', 'site', 'image', :'so' || '/00000000-0000-4000-8042-0000000000a1.webp', 'הלוגו של צימר ישן', true, 0),
  ('00000000-0000-4000-8042-0000000000a2', :'so', 'site', 'image', :'so' || '/00000000-0000-4000-8042-0000000000a2.webp', 'השלט בכניסה', false, 1),
  ('00000000-0000-4000-8042-0000000000a3', :'so', 'site', 'image', :'so' || '/00000000-0000-4000-8042-0000000000a3.webp', 'הבריכה', false, 2);
INSERT INTO hospitality.media (id, tenant_id, owner_kind, kind, embed_provider, embed_id, sort_order) VALUES
  ('00000000-0000-4000-8042-0000000000a4', :'so', 'site', 'embed', 'youtube', 'dQw4w9WgXcQ', 3);
INSERT INTO hospitality.media (id, tenant_id, owner_kind, property_id, kind, storage_path, alt, is_cover, sort_order) VALUES
  ('00000000-0000-4000-8042-0000000000a5', :'so', 'property', :'sop', 'image', :'so' || '/00000000-0000-4000-8042-0000000000a5.webp', 'החצר', true, 0);
UPDATE hospitality.site_versions SET document = document || '{"logo": "00000000-0000-4000-8042-0000000000A2"}'
 WHERE tenant_id = :'so' AND kind = 'draft';
INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document)
SELECT :'so', 'draft', 0, 'luxury', '{"logo": "00000000-0000-4000-8042-0000000000A2"}'
 WHERE NOT EXISTS (SELECT 1 FROM hospitality.site_versions WHERE tenant_id = :'so' AND kind = 'draft');
INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document) VALUES
  (:'so', 'published', 1, 'luxury', '{"logo": "00000000-0000-4000-8042-0000000000a5"}');
CREATE TEMP TABLE m42_other AS
  SELECT id, owner_kind, is_cover, sort_order FROM hospitality.media
   WHERE tenant_id NOT IN (:'so') AND owner_kind <> 'brand';

\ir ../../supabase/migrations/20261105190000_hosp_logo_brand.sql

SELECT tests.check('existing logos move out of the site gallery: the logo-button upload and the picture used as the logo — no longer a main image',
  $$SELECT bool_and(owner_kind = 'brand' AND NOT is_cover) AND count(*) = 2 FROM hospitality.media
     WHERE id IN ('00000000-0000-4000-8042-0000000000a1', '00000000-0000-4000-8042-0000000000a2')$$);
SELECT tests.check('the site gallery gets its first photo as the main image; the video stays; the property photo used as a logo stays in its gallery (still its main image)',
  $$SELECT (SELECT owner_kind = 'site' AND is_cover FROM hospitality.media WHERE id = '00000000-0000-4000-8042-0000000000a3')
       AND (SELECT owner_kind = 'site' AND NOT is_cover FROM hospitality.media WHERE id = '00000000-0000-4000-8042-0000000000a4')
       AND (SELECT owner_kind = 'property' AND is_cover FROM hospitality.media WHERE id = '00000000-0000-4000-8042-0000000000a5')$$);
SELECT tests.check('other businesses: nothing moved, no main image changed',
  $$SELECT NOT EXISTS (SELECT 1 FROM m42_other o JOIN hospitality.media m ON m.id = o.id
                        WHERE (m.owner_kind, m.is_cover, m.sort_order) IS DISTINCT FROM (o.owner_kind, o.is_cover, o.sort_order))$$);
SELECT tests.check('the public site of the old business: the gallery without logos, the logos separately',
  format($$SELECT pg_temp.ids(p -> 'gallery') = ARRAY['00000000-0000-4000-8042-0000000000a3', '00000000-0000-4000-8042-0000000000a4']
             AND pg_temp.ids(p -> 'brand') = ARRAY['00000000-0000-4000-8042-0000000000a1', '00000000-0000-4000-8042-0000000000a2']
            FROM (SELECT hospitality._site_payload(%L) AS p) s$$, :'so'));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m42_flags m WHERE f.key = m.key;
DROP TABLE m42_flags;
DROP TABLE m42_other;

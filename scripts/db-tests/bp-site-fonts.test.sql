-- ============================================================
-- Nuriel Websites — site fonts in the media library + the "Classic" template (migration 195)
--   • only someone who may edit the site registers a font, only under the site's own folder, only .woff2
--   • the font details (family, weight, style, Unicode range) are checked by strict patterns — they go into CSS
--   • up to 2MB per font, counted in the site's quota; the library shows the kind and the font details
--   • a font used by the draft (theme.fonts[].file.media) is not deleted; guests get it only once it is live
--   • the table keeps images and fonts apart (path, details, variants)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set F_OWNER1 '''a0000000-0000-0000-0000-0000000195a1'''
\set F_OWNER2 '''a0000000-0000-0000-0000-0000000195a2'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
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
CREATE OR REPLACE FUNCTION pg_temp.user_err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
-- run a statement as the database owner (the table constraints); NULL = ok, otherwise the error text
CREATE OR REPLACE FUNCTION pg_temp.try_sql(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $f$;
-- register a font (NULL = ok, otherwise the error text)
CREATE OR REPLACE FUNCTION pg_temp.add_font(_site text, _uid uuid, _id uuid, _path text, _bytes bigint, _font jsonb)
RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.user_err(_site, _uid, format('SELECT public.bp_media_add_font(%L, %L, %s, %L::jsonb, %L)',
                                              _id, _path, _bytes, _font, 'heebo.woff2'));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.heebo(_range text DEFAULT 'U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('family', 'Heebo', 'weight', '100 900', 'style', 'normal', 'unicode_range', _range,
                            'license', 'SIL OFL 1.1');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.doc_font(_media uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('schema', 1, 'template', 'classic', 'locales', '["he"]'::jsonb,
           'theme', jsonb_build_object('fonts', CASE WHEN _media IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
             jsonb_build_object('family', 'Heebo', 'weight', '100 900', 'style', 'normal', 'unicodeRange', '',
                                'file', jsonb_build_object('media', _media))) END),
           'pages', jsonb_build_array(jsonb_build_object('id', 'home', 'slug', '', 'blocks', '[]'::jsonb)));
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:F_OWNER1, 'fonts.owner1@test.local', now()),
  (:F_OWNER2, 'fonts.owner2@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', true),
       public.platform_set_flag('business_profile_public', true)])$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('fonts-one', 'גופנים אחד', 'fonts.owner1@test.local')$$) ->> 'id' AS f1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('fonts-two', 'גופנים שתיים', 'fonts.owner2@test.local')$$) ->> 'id' AS f2 \gset
SELECT gen_random_uuid() AS font1, gen_random_uuid() AS font2, gen_random_uuid() AS font3 \gset

-- ============================================================
SELECT tests.check('bp fonts: the "Classic" template is available',
  $$SELECT EXISTS (SELECT 1 FROM business_profile.templates WHERE key = 'classic' AND status = 'available')$$);
SELECT tests.check('bp fonts: only signed-in editors may register a font; the details check is internal',
  $$SELECT has_function_privilege('authenticated', 'public.bp_media_add_font(uuid,text,bigint,jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_media_add_font(uuid,text,bigint,jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._font_meta_ok(jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'business_profile._font_meta_ok(jsonb)', 'EXECUTE')$$);
SELECT tests.check('bp fonts: the bucket takes WOFF2 besides the pictures (nothing else)',
  $$SELECT allowed_mime_types = ARRAY['image/webp', 'image/avif', 'font/woff2'] FROM storage.buckets WHERE id = 'bp-media'$$);

SELECT COALESCE(pg_temp.add_font(:'f1', :F_OWNER1, :'font1', :'f1' || '/' || :'font1' || '.woff2', 40000, pg_temp.heebo()), '') AS add1 \gset
SELECT tests.check('bp fonts: the owner registers a font under the site''s own folder — kind, details and size are kept',
  format($$SELECT %L = ''
             AND (SELECT kind = 'font' AND variants = '{}'::jsonb AND size_bytes = 40000 AND width IS NULL
                         AND font = jsonb_build_object('family', 'Heebo', 'weight', '100 900', 'style', 'normal',
                                    'unicode_range', 'U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F',
                                    'license', 'SIL OFL 1.1')
                    FROM business_profile.media WHERE id = %L)$$, :'add1', :'font1'));
SELECT tests.check('bp fonts: another site''s folder, a picture path or a path outside the folder pattern is refused',
  format($$SELECT pg_temp.add_font(%1$L, %2$L, %3$L, %4$L || '/' || %3$L || '.woff2', 1000, pg_temp.heebo()) LIKE '%%לא שייך לאתר הזה%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.webp', 1000, pg_temp.heebo()) LIKE '%%לא שייך לאתר הזה%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/../' || %3$L || '.woff2', 1000, pg_temp.heebo()) LIKE '%%לא שייך לאתר הזה%%'
             AND NOT EXISTS (SELECT 1 FROM business_profile.media WHERE id = %3$L)$$, :'f1', :F_OWNER1, :'font2', :'f2'));
SELECT tests.check('bp fonts: details that could break out of the CSS rule are refused (family, weight, style, range)',
  format($$SELECT pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo() || '{"family": "Heebo}; body{display:none"}') LIKE '%%פרטי הגופן לא תקינים%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo() || '{"family": "x\"); src: url(https://evil"}') LIKE '%%פרטי הגופן לא תקינים%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo() || '{"weight": "450"}') LIKE '%%פרטי הגופן לא תקינים%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo() || '{"style": "oblique 10deg"}') LIKE '%%פרטי הגופן לא תקינים%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo('U+0590-05FF; } body {')) LIKE '%%פרטי הגופן לא תקינים%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000,
                    pg_temp.heebo() || jsonb_build_object('license', repeat('x', 121))) LIKE '%%פרטי הגופן לא תקינים%%'
             AND NOT EXISTS (SELECT 1 FROM business_profile.media WHERE id = %3$L)$$, :'f1', :F_OWNER1, :'font2'));
SELECT tests.check('bp fonts: a real Unicode range list (128 ranges, like Google''s symbols subset) is accepted',
  format($$SELECT business_profile._font_meta_ok(pg_temp.heebo(%L))$$,
         (SELECT string_agg(format('U+%s-%s', to_hex(4096 + i * 16), to_hex(4096 + i * 16 + 7)), ', ')
            FROM generate_series(1, 128) i)));
SELECT tests.check('bp fonts: more than 2MB is refused; over the quota is refused',
  format($$SELECT pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 2097153, pg_temp.heebo()) LIKE '%%עד 2MB%%'
             AND pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 0, pg_temp.heebo()) LIKE '%%עד 2MB%%'$$,
         :'f1', :F_OWNER1, :'font2'));
UPDATE business_profile.sites SET media_quota_bytes = 50000 WHERE tenant_id = :'f1';
SELECT tests.check('bp fonts: the font counts in the site''s quota (40KB used of 50KB → another 20KB is refused)',
  format($$SELECT pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 20000, pg_temp.heebo()) LIKE '%%אין מספיק מקום%%'$$,
         :'f1', :F_OWNER1, :'font2'));
UPDATE business_profile.sites SET media_quota_bytes = 209715200 WHERE tenant_id = :'f1';
SELECT tests.check('bp fonts: the owner of another site and a guest cannot register a font here',
  format($$SELECT pg_temp.add_font(%1$L, %2$L, %3$L, %1$L || '/' || %3$L || '.woff2', 1000, pg_temp.heebo()) LIKE '%%אין הרשאה%%'
             AND pg_temp.add_font(%1$L, NULL, %3$L, %1$L || '/' || %3$L || '.woff2', 1000, pg_temp.heebo()) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM business_profile.media WHERE id = %3$L)$$, :'f1', :F_OWNER2, :'font2'));
SELECT tests.check('bp fonts: the library shows the kind and the details; another site sees nothing',
  format($$SELECT (SELECT e ->> 'kind' = 'font' AND e -> 'font' ->> 'family' = 'Heebo'
                     FROM jsonb_array_elements(pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_media_list()') -> 'items') e
                    WHERE e ->> 'id' = %3$L)
             AND jsonb_array_length(pg_temp.as_user(%4$L, %5$L, 'SELECT public.bp_media_list()') -> 'items') = 0$$,
         :'f1', :F_OWNER1, :'font1', :'f2', :F_OWNER2));
SELECT tests.check('bp fonts: the table keeps the kinds apart (a font with a picture path, a picture with font details, a font with sizes)',
  format($$SELECT (SELECT count(*) FROM (VALUES
                   (format('INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, font) VALUES (gen_random_uuid(), %%L, %%L, %%L, %%L, 1, %%L, %%L)',
                           %1$L, 'font', %1$L || '/' || gen_random_uuid() || '.webp', '{}', '{"he": ""}', pg_temp.heebo())),
                   (format('INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, font) VALUES (gen_random_uuid(), %%L, %%L, %%L, %%L, 1, %%L, %%L)',
                           %1$L, 'image', %1$L || '/' || gen_random_uuid() || '.webp', '{}', '{"he": ""}', pg_temp.heebo())),
                   (format('INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, font) VALUES (gen_random_uuid(), %%L, %%L, %%L, %%L, 1, %%L, %%L)',
                           %1$L, 'font', %1$L || '/' || gen_random_uuid() || '.woff2', '{"960": "x"}', '{"he": ""}', pg_temp.heebo())),
                   (format('INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, font) VALUES (gen_random_uuid(), %%L, %%L, %%L, %%L, 1, %%L, NULL)',
                           %1$L, 'font', %1$L || '/' || gen_random_uuid() || '.woff2', '{}', '{"he": ""}')),
                   (format('INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, font) VALUES (gen_random_uuid(), %%L, %%L, %%L, %%L, 1, %%L, NULL)',
                           %1$L, 'video', %1$L || '/' || gen_random_uuid() || '.webp', '{}', '{"he": ""}'))
                 ) AS t(stmt) WHERE pg_temp.try_sql(stmt) LIKE '%%violates check constraint%%') = 5$$, :'f1'));

-- the font goes into the draft (Classic template); it is protected; published → guests get it (with its kind)
SELECT (SELECT revision FROM business_profile.site_versions WHERE tenant_id = :'f1' AND state = 'draft') AS rev1 \gset
SELECT pg_temp.as_user(:'f1', :F_OWNER1, format('SELECT public.bp_draft_save(%L, %s)', pg_temp.doc_font(:'font1'), :rev1)) IS NOT NULL AS ok \gset
SELECT tests.check('bp fonts: a draft in the "Classic" template is saved; a font used by the draft cannot be deleted',
  format($$SELECT (SELECT template FROM business_profile.site_versions WHERE tenant_id = %1$L AND state = 'draft') = 'classic'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_media_delete(%%L)', %3$L)) LIKE '%%בשימוש באתר%%'$$,
         :'f1', :F_OWNER1, :'font1'));
SELECT tests.check('bp fonts: guests get nothing before the site is published',
  format($$SELECT jsonb_array_length(pg_temp.as_user(%L, NULL, 'SELECT public.bp_media_public()')) = 0$$, :'f1'));
SELECT pg_temp.as_user(:'f1', :F_OWNER1, format('SELECT public.bp_publish(%s)', :rev1 + 1)) IS NOT NULL AS ok \gset
SELECT tests.check('bp fonts: the platform reviewer sees the font of the snapshot, with its kind',
  format($$SELECT (SELECT array_agg(e ->> 'kind') FROM jsonb_array_elements(
                     pg_temp.as_user(NULL, %L, format('SELECT public.platform_bp_review_media(%%L)', %L))) e) = ARRAY['font']$$,
         :PLATFORM, :'f1'));
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_approve_publish(%L, %L)', :'f1',
       (SELECT id FROM business_profile.site_versions WHERE tenant_id = :'f1' AND state = 'pending'))) IS NOT NULL AS ok \gset
SELECT tests.check('bp fonts: once live, guests get exactly that font (kind "font", the .woff2 path) — nothing on another site',
  format($$SELECT (SELECT array_agg((e ->> 'id') || ':' || (e ->> 'kind') || ':' || (e ->> 'storage_path'))
                     FROM jsonb_array_elements(pg_temp.as_user(%1$L, NULL, 'SELECT public.bp_media_public()')) e)
                  = ARRAY[%2$L || ':font:' || %1$L || '/' || %2$L || '.woff2']
             AND jsonb_array_length(pg_temp.as_user(%3$L, NULL, 'SELECT public.bp_media_public()')) = 0$$,
         :'f1', :'font1', :'f2'));
SELECT tests.check('bp fonts: storage — the editor uploads a .woff2 to their own site''s folder only',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %1$L || '/f.woff2')) IS NULL
             AND pg_temp.user_err(%1$L, %2$L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %3$L || '/f.woff2')) LIKE '%%row-level security%%'$$,
         :'f1', :F_OWNER1, :'f2'));

-- ---------- cleanup ----------
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', false),
       public.platform_set_flag('business_profile_public', false)])$$) IS NOT NULL AS ok \gset
DELETE FROM storage.objects WHERE bucket_id = 'bp-media';
SET session_replication_role = replica;
DELETE FROM public.user_roles WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM business_profile.media WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'f1', :'f2');
DELETE FROM public.tenants WHERE id IN (:'f1', :'f2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:F_OWNER1, :F_OWNER2);

-- ============================================================
-- Nuriel Websites — the media library (migration 194, Stage 2)
--   • the table is closed; the bucket takes only WebP / AVIF, up to 8MB
--   • only someone who may edit the site registers files, and only under the site's own folder
--   • a per-site quota; another site never sees, changes or deletes the library
--   • a picture in use (draft / request / live) is not deleted
--   • guests get only the pictures of the published version; the platform reviewer — only the snapshot's
--   • storage: an editor writes only to their own site's folder
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set SA '''70000000-0000-0000-0000-00000000000a'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set M_OWNER1 '''a0000000-0000-0000-0000-0000000194a1'''
\set M_OWNER2 '''a0000000-0000-0000-0000-0000000194a2'''
\set M_MGR '''a0000000-0000-0000-0000-0000000194a3'''

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
CREATE OR REPLACE FUNCTION pg_temp.add(_site text, _uid uuid, _id uuid, _path_site text, _bytes bigint) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.user_err(_site, _uid, format(
    'SELECT public.bp_media_add(%L, %L, %L::jsonb, 1600, 1200, %s, %L::jsonb, %L)',
    _id, _path_site || '/' || _id || '.webp',
    json_build_object('960', _path_site || '/' || _id || '-960.webp', 'avif', _path_site || '/' || _id || '-1600.avif'),
    _bytes, '{"he": "תמונה"}', 'cover.jpg'));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.doc_with(_media uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('schema', 1, 'template', 'elegant', 'locales', '["he"]'::jsonb,
           'business', jsonb_build_object('logo', jsonb_build_object('media', _media, 'alt', jsonb_build_object('he', 'לוגו'))),
           'pages', jsonb_build_array(jsonb_build_object('id', 'home', 'slug', '', 'blocks', '[]'::jsonb)));
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:M_OWNER1, 'media.owner1@test.local', now()),
  (:M_OWNER2, 'media.owner2@test.local', now()),
  (:M_MGR, 'media.mgr@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', true),
       public.platform_set_flag('business_profile_public', true)])$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('media-one', 'מדיה אחד', 'media.owner1@test.local')$$) ->> 'id' AS m1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT public.platform_bp_open_site('media-two', 'מדיה שתיים', 'media.owner2@test.local')$$) ->> 'id' AS m2 \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
VALUES (:'m1', :M_MGR, 'media.mgr@test.local', 'admin', true, false);
SELECT gen_random_uuid() AS img1, gen_random_uuid() AS img2, gen_random_uuid() AS img3, gen_random_uuid() AS img4 \gset

-- ============================================================
SELECT tests.check('bp media: the table is closed to the API (RLS); guests may only read the published pictures',
  $$SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'business_profile.media'::regclass)
       AND NOT has_table_privilege('authenticated', 'business_profile.media', 'SELECT')
       AND has_function_privilege('anon', 'public.bp_media_public()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_media_list()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_media_add(uuid,text,jsonb,integer,integer,bigint,jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._media_ids(jsonb)', 'EXECUTE')$$);
SELECT tests.check('bp media: the bucket is public for reading, WebP / AVIF only, up to 8MB',
  $$SELECT public AND file_size_limit = 8388608 AND allowed_mime_types = ARRAY['image/webp', 'image/avif']
      FROM storage.buckets WHERE id = 'bp-media'$$);
SELECT tests.check('bp media: the default quota is 200MB per site',
  format($$SELECT (SELECT media_quota_bytes FROM business_profile.sites WHERE tenant_id = %L) = 209715200$$, :'m1'));

-- (each action in its own statement: a check that writes and reads in one statement reads the old snapshot)
SELECT COALESCE(pg_temp.add(:'m1', :M_OWNER1, :'img1', :'m1', 500000), '') AS add1 \gset
SELECT tests.check('bp media: the owner registers a picture under the site''s own folder',
  format($$SELECT %L = '' AND (SELECT count(*) FROM business_profile.media WHERE tenant_id = %L) = 1$$,
         :'add1', :'m1'));
SELECT tests.check('bp media: a path in another site''s folder (main file or a variant) is refused',
  format($$SELECT pg_temp.add(%1$L, %2$L, %3$L, %4$L, 1000) LIKE '%%לא שייך לאתר הזה%%'
             AND pg_temp.user_err(%1$L, %2$L, format(
                   'SELECT public.bp_media_add(%%L, %%L, %%L::jsonb, 10, 10, 10)', %3$L, %1$L || '/' || %3$L || '.webp',
                   json_build_object('960', %4$L || '/x-960.webp'))) LIKE '%%לא שייך לאתר הזה%%'
             AND NOT EXISTS (SELECT 1 FROM business_profile.media WHERE id = %3$L)$$, :'m1', :M_OWNER1, :'img2', :'m2'));
SELECT tests.check('bp media: the manager (content editing) may add; the owner of another site, a store owner and a guest may not',
  format($$SELECT pg_temp.add(%1$L, %2$L, %3$L, %1$L, 1000) IS NULL
             AND pg_temp.add(%1$L, %4$L, gen_random_uuid(), %1$L, 1000) LIKE '%%אין הרשאה%%'
             AND pg_temp.add(%1$L, %5$L, gen_random_uuid(), %1$L, 1000) LIKE '%%אין הרשאה%%'
             AND pg_temp.add(%1$L, NULL, gen_random_uuid(), %1$L, 1000) IS NOT NULL$$,
         :'m1', :M_MGR, :'img2', :M_OWNER2, :OA));
UPDATE business_profile.sites SET media_quota_bytes = 600000 WHERE tenant_id = :'m1';
SELECT tests.check('bp media: over the quota — the check and the registration both refuse',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_media_check_quota(200000)') LIKE '%%אין מספיק מקום%%'
             AND pg_temp.add(%1$L, %2$L, %3$L, %1$L, 200000) LIKE '%%אין מספיק מקום%%'
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_media_check_quota(1000)') ->> 'used_bytes')::bigint = 501000$$,
         :'m1', :M_OWNER1, :'img3'));
UPDATE business_profile.sites SET media_quota_bytes = 209715200 WHERE tenant_id = :'m1';
SELECT tests.check('bp media: separation — site two sees an empty library and cannot touch site one''s pictures',
  format($$SELECT jsonb_array_length(pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_media_list()') -> 'items') = 0
             AND jsonb_array_length(pg_temp.as_user(%3$L, %4$L, 'SELECT public.bp_media_list()') -> 'items') = 2
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_media_delete(%%L)', %5$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format($q$SELECT public.bp_media_set_alt(%%L, '{"he": "x"}')$q$, %5$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.user_err(%3$L, %2$L, 'SELECT public.bp_media_list()') LIKE '%%אין הרשאה%%'$$,
         :'m2', :M_OWNER2, :'m1', :M_OWNER1, :'img1'));
SELECT pg_temp.as_user(:'m1', :M_OWNER1, format($q$SELECT public.bp_media_set_alt(%L, '{"he": "עטיפת הספר", "en": "Cover"}')$q$, :'img1')) ->> 'id' AS alt1 \gset
SELECT tests.check('bp media: alt text per language, up to 200 characters',
  format($$SELECT %4$L = %3$L
             AND (SELECT alt FROM business_profile.media WHERE id = %3$L) = '{"he": "עטיפת הספר", "en": "Cover"}'::jsonb
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_media_set_alt(%%L, %%L)', %3$L,
                   json_build_object('he', repeat('א', 201)))) LIKE '%%200 תווים%%'$$, :'m1', :M_OWNER1, :'img1', :'alt1'));

-- the picture goes into the draft; then published
SELECT (SELECT revision FROM business_profile.site_versions WHERE tenant_id = :'m1' AND state = 'draft') AS rev1 \gset
SELECT pg_temp.as_user(:'m1', :M_OWNER1, format('SELECT public.bp_draft_save(%L, %s)', pg_temp.doc_with(:'img1'), :rev1)) IS NOT NULL AS ok \gset
SELECT jsonb_array_length(pg_temp.as_user(:'m1', :M_OWNER1, format('SELECT public.bp_media_delete(%L)', :'img2')) -> 'paths') AS del_paths \gset
SELECT tests.check('bp media: a picture used in the draft cannot be deleted; an unused one can (the paths come back for the bucket)',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_media_delete(%%L)', %3$L)) LIKE '%%בשימוש באתר%%'
             AND %5$s = 3
             AND NOT EXISTS (SELECT 1 FROM business_profile.media WHERE id = %4$L)$$, :'m1', :M_OWNER1, :'img1', :'img2', :'del_paths'));
SELECT tests.check('bp media: guests get nothing before the site is published',
  format($$SELECT jsonb_array_length(pg_temp.as_user(%L, NULL, 'SELECT public.bp_media_public()')) = 0$$, :'m1'));
-- publish (first publish → approval)
SELECT pg_temp.as_user(:'m1', :M_OWNER1, format('SELECT public.bp_publish(%s)', :rev1 + 1)) IS NOT NULL AS ok \gset
SELECT tests.check('bp media: the platform admin reviewing the request sees only the pictures of the snapshot; an owner, another site and a guest cannot ask',
  format($$SELECT (SELECT array_agg(e ->> 'id') FROM jsonb_array_elements(pg_temp.as_user(NULL, %1$L, format('SELECT public.platform_bp_review_media(%%L)', %2$L))) e) = ARRAY[%3$L]
             AND jsonb_array_length(pg_temp.as_user(NULL, %1$L, format('SELECT public.platform_bp_review_media(%%L)', %4$L))) = 0
             AND pg_temp.user_err(%2$L, %5$L, format('SELECT public.platform_bp_review_media(%%L)', %2$L)) IS NOT NULL
             AND pg_temp.user_err(%4$L, %6$L, format('SELECT public.platform_bp_review_media(%%L)', %2$L)) IS NOT NULL
             AND pg_temp.user_err(%2$L, NULL, format('SELECT public.platform_bp_review_media(%%L)', %2$L)) IS NOT NULL$$,
         :PLATFORM, :'m1', :'img1', :'m2', :M_OWNER1, :M_OWNER2));
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_approve_publish(%L, %L)', :'m1',
       (SELECT id FROM business_profile.site_versions WHERE tenant_id = :'m1' AND state = 'pending'))) IS NOT NULL AS ok \gset
SELECT pg_temp.add(:'m1', :M_OWNER1, :'img4', :'m1', 1000) IS NULL AS ok \gset
SELECT tests.check('bp media: guests get only the pictures of the live version — not the rest of the library, and nothing on another site',
  format($$SELECT (SELECT array_agg(e ->> 'id') FROM jsonb_array_elements(pg_temp.as_user(%1$L, NULL, 'SELECT public.bp_media_public()')) e) = ARRAY[%2$L]
             AND jsonb_array_length(pg_temp.as_user(%3$L, NULL, 'SELECT public.bp_media_public()')) = 0
             AND jsonb_array_length(pg_temp.as_user(%4$L, NULL, 'SELECT public.bp_media_public()')) = 0$$,
         :'m1', :'img1', :'m2', :SA));
-- the draft drops the picture; it is still live → still protected
SELECT pg_temp.as_user(:'m1', :M_OWNER1, format('SELECT public.bp_draft_save(%L, %s)', pg_temp.doc_with(NULL), :rev1 + 1)) IS NOT NULL AS ok \gset
SELECT tests.check('bp media: a picture in the live version cannot be deleted even after the draft dropped it',
  format($$SELECT pg_temp.user_err(%L, %L, format('SELECT public.bp_media_delete(%%L)', %L)) LIKE '%%בשימוש באתר%%'$$,
         :'m1', :M_OWNER1, :'img1'));

-- ---------- storage policies ----------
SELECT tests.check('bp media: storage — the editor uploads to their own site''s folder; another site''s folder and the wrong bucket path are refused',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %1$L || '/a.webp')) IS NULL
             AND pg_temp.user_err(%1$L, %2$L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %3$L || '/a.webp')) LIKE '%%row-level security%%'
             AND pg_temp.user_err(%1$L, %4$L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %1$L || '/b.webp')) LIKE '%%row-level security%%'
             AND pg_temp.user_err(%1$L, NULL, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %1$L || '/c.webp')) IS NOT NULL$$,
         :'m1', :M_OWNER1, :'m2', :M_OWNER2));
SELECT tests.check('bp media: storage — with the engine off for the platform, nobody can upload',
  format($$SELECT pg_temp.as_user(NULL, %L, $q$SELECT to_jsonb(public.platform_set_flag('business_profile_enabled', false))$q$) IS NOT NULL
             AND pg_temp.user_err(%L, %L, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('bp-media', %%L) RETURNING to_jsonb(name)$q$, %2$L || '/d.webp')) LIKE '%%row-level security%%'$$,
         :PLATFORM, :'m1', :M_OWNER1));

-- ---------- cleanup ----------
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', false),
       public.platform_set_flag('business_profile_public', false)])$$) IS NOT NULL AS ok \gset
DELETE FROM storage.objects WHERE bucket_id = 'bp-media';
SET session_replication_role = replica;
DELETE FROM public.user_roles WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM business_profile.media WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'m1', :'m2');
DELETE FROM public.tenants WHERE id IN (:'m1', :'m2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:M_OWNER1, :M_OWNER2, :M_MGR);

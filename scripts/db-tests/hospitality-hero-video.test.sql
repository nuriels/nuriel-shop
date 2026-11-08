-- ============================================================
-- Hospitality — the hero video: up to 15 seconds by a length the server measured (migration 62 —
-- 20261111100000_hosp_hero_video_verified.sql)
--   • who may record a length (the app server only) and list unchecked videos; staff cannot declare a length
--     through media_add;
--   • the draft: a new / changed hero video must be this business's uploaded video, measured, up to 15.5 s;
--     an unchanged old value does not block saving other changes;
--   • publishing: a measured-and-wrong video blocks, with the reason; one not measured yet does not block
--     (the site does not show it until measured);
--   • the site gets the measured length (only for a checked video); replacing the file resets the check.
-- ============================================================
\set OWNER62 '''a0000000-0000-0000-0000-000000062a01'''
\set OTHER62 '''a0000000-0000-0000-0000-000000062a02'''

CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.62')::text, true);
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
CREATE OR REPLACE FUNCTION pg_temp.srv_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.srv(_sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- a video item as the app server records it (the file is in the business's folder)
CREATE OR REPLACE FUNCTION pg_temp.vid(_site text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('kind', 'video', 'storage_path', _site || '/' || gen_random_uuid() || '.mp4',
                            'variants', '{}'::jsonb, 'size_bytes', 123456);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.doc(_video text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('v', 1, 'theme', 'luxury', 'sections', jsonb_build_array(
           jsonb_build_object('id', 'hero', 'type', 'hero', 'hidden', false,
                              'content', CASE WHEN _video IS NULL THEN '{}'::jsonb
                                              ELSE jsonb_build_object('video', _video) END),
           jsonb_build_object('id', 'about', 'type', 'about', 'hidden', false, 'content', '{}'::jsonb)));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.save_sql(_rev integer, _doc jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.site_draft_save(%s, %L, %L)', _rev, 'luxury', _doc);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.rev(_site text) RETURNS integer LANGUAGE sql AS $f$
  SELECT revision FROM hospitality.site_versions WHERE tenant_id = _site::uuid AND kind = 'draft';
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000062a01', 'm62.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000062a02', 'm62.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m62_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m62-video', 'נופי הסרטון', 'm62.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm62.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m62-other', 'אתר שכן לסרטון', 'm62.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm62.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset

SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$, pg_temp.vid(:'st'))) ->> 'id' AS v_short \gset
SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$, pg_temp.vid(:'st'))) ->> 'id' AS v_long \gset
SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$, pg_temp.vid(:'st'))) ->> 'id' AS v_unread \gset
SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$, pg_temp.vid(:'st'))) ->> 'id' AS v_new \gset
SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  jsonb_build_object('kind', 'image', 'storage_path', :'st' || '/' || gen_random_uuid() || '.webp', 'size_bytes', 900)))
  ->> 'id' AS img \gset
SELECT pg_temp.call(:'st', :OWNER62, $q$SELECT hospitality.media_add_embed('site', NULL, 'youtube', 'dQw4w9WgXcQ', 'סרטון')$q$)
  -> 'items' -> 0 IS NOT NULL AS ok \gset
SELECT id AS emb FROM hospitality.media WHERE tenant_id = :'st' AND kind = 'embed' \gset
SELECT pg_temp.call(:'so', :OTHER62, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$, pg_temp.vid(:'so'))) ->> 'id' AS v_other \gset

-- ============================================================
-- 1. Who may record a length
-- ============================================================
SELECT tests.check('structure: recording a length and listing unchecked videos — the app server only; the helpers — nobody',
  $$SELECT has_function_privilege('service_role', 'hospitality.media_video_verified(uuid,uuid,numeric,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.media_video_verified(uuid,uuid,numeric,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.media_video_verified(uuid,uuid,numeric,text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.media_videos_to_check(integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.media_videos_to_check(integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._hero_video_problem(uuid,jsonb,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality._hero_video_ref(jsonb)', 'EXECUTE')
       AND NOT has_table_privilege('authenticated', 'hospitality.media', 'UPDATE')$$);
SELECT tests.check('staff cannot declare a length: media_add refuses duration / codec / checked fields',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.media_add('site', NULL, %%L)$s$,
                    pg_temp.vid(%1$L) || '{"duration_seconds": 3}')) = 'פרטי הקובץ לא תקינים'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.media_add('site', NULL, %%L)$s$,
                    pg_temp.vid(%1$L) || '{"duration_checked_at": "2026-11-08"}')) = 'פרטי הקובץ לא תקינים'$$,
         :'st', :OWNER62));
SELECT tests.check('a new upload is unchecked (no length) and waits in the server''s list; images and embeds never do',
  format($$SELECT (SELECT duration_seconds IS NULL AND duration_checked_at IS NULL AND video_codec IS NULL
                     FROM hospitality.media WHERE id = %1$L)
             AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.srv('SELECT hospitality.media_videos_to_check(20)')) e
                   WHERE e ->> 'id' IN (%1$L, %2$L, %3$L, %4$L)) = 4
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.srv('SELECT hospitality.media_videos_to_check(20)')) e
                              WHERE e ->> 'id' IN (%5$L, %6$L))$$,
         :'v_short', :'v_long', :'v_unread', :'v_new', :'img', :'emb'));

SELECT pg_temp.srv(format($q$SELECT hospitality.media_video_verified(%L, %L, 4.04, 'h264')$q$, :'st', :'v_short')) AS r_short \gset
SELECT pg_temp.srv(format($q$SELECT hospitality.media_video_verified(%L, %L, 16.2, 'hevc')$q$, :'st', :'v_long')) AS r_long \gset
SELECT pg_temp.srv(format($q$SELECT hospitality.media_video_verified(%L, %L, NULL, NULL)$q$, :'st', :'v_unread')) AS r_unread \gset
SELECT tests.check('the server records what it measured: 4.04 s fits, 16.2 s does not, unreadable = checked with no length; codec kept',
  format($$SELECT (%1$L::jsonb ->> 'hero_ok')::boolean AND (%1$L::jsonb ->> 'seconds')::numeric = 4.04
             AND NOT (%2$L::jsonb ->> 'hero_ok')::boolean AND %2$L::jsonb ->> 'codec' = 'hevc'
             AND NOT (%3$L::jsonb ->> 'hero_ok')::boolean AND %3$L::jsonb -> 'seconds' = 'null'::jsonb
             AND (SELECT duration_checked_at IS NOT NULL FROM hospitality.media WHERE id = %4$L)
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.srv('SELECT hospitality.media_videos_to_check(20)')) e
                              WHERE e ->> 'id' IN (%5$L, %6$L, %4$L))$$,
         :'r_short', :'r_long', :'r_unread', :'v_unread', :'v_short', :'v_long'));
SELECT tests.check('recording a length: another business''s video, an image, an embed — not found; an unknown codec is kept as "other"',
  format($$SELECT pg_temp.srv_err(format('SELECT hospitality.media_video_verified(%%L, %%L, 3, NULL)', %1$L, %2$L)) = 'הסרטון לא נמצא'
             AND pg_temp.srv_err(format('SELECT hospitality.media_video_verified(%%L, %%L, 3, NULL)', %1$L, %3$L)) = 'הסרטון לא נמצא'
             AND pg_temp.srv_err(format('SELECT hospitality.media_video_verified(%%L, %%L, 3, NULL)', %1$L, %4$L)) = 'הסרטון לא נמצא'
             AND pg_temp.srv(format('SELECT hospitality.media_video_verified(%%L, %%L, 3, %%L)', %5$L, %2$L, 'xyz')) ->> 'codec' = 'other'$$,
         :'st', :'v_other', :'img', :'emb', :'so'));

-- ============================================================
-- 2. The draft
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER62, pg_temp.save_sql(0, pg_temp.doc(:'v_short'))) ->> 'revision' AS rv1 \gset
SELECT tests.check('draft: a measured 4-second video of this business — saved',
  format($$SELECT %1$L::integer = 1
             AND (SELECT document #>> '{sections,0,content,video}' = %2$L FROM hospitality.site_versions
                   WHERE tenant_id = %3$L AND kind = 'draft')$$, :'rv1', :'v_short', :'st'));
SELECT tests.check('draft: a new hero video that is too long / unreadable / not measured yet / an image / an embed / another business''s / garbage — refused with the reason',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%3$L)))
                    = 'סרטון הפתיח ארוך מדי (16 שניות). עד 15 שניות — הסירו אותו או העלו סרטון קצר יותר'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%4$L))) LIKE 'לא הצלחנו לקרוא את אורך הסרטון%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%5$L))) LIKE 'אורך הסרטון עוד לא נבדק%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%6$L))) LIKE 'בפתיח אפשר רק סרטון שהועלה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%7$L))) LIKE 'בפתיח אפשר רק סרטון שהועלה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(%8$L))) LIKE 'סרטון הפתיח לא נמצא%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc('../etc/passwd'))) LIKE 'סרטון הפתיח לא תקין%%'
             AND pg_temp.rev(%1$L) = 1$$,
         :'st', :OWNER62, :'v_long', :'v_unread', :'v_new', :'img', :'emb', :'v_other'));
SELECT tests.check('draft: removing the video, and saving again with the same valid video, both work',
  format($$SELECT (pg_temp.call(%1$L, %2$L, pg_temp.save_sql(1, pg_temp.doc(NULL))) ->> 'revision')::integer = 2
             AND (pg_temp.call(%1$L, %2$L, pg_temp.save_sql(2, pg_temp.doc(%3$L))) ->> 'revision')::integer = 3$$,
         :'st', :OWNER62, :'v_short'));

-- an old draft (from before migration 62) that already points to a too-long video: saving other changes
-- still works; publishing is refused with the reason; removing the video fixes it
SET session_replication_role = replica;
UPDATE hospitality.site_versions SET document = pg_temp.doc(:'v_long') WHERE tenant_id = :'st' AND kind = 'draft';
SET session_replication_role = DEFAULT;
SELECT tests.check('old draft with a too-long video: other changes still save (the value did not change); publishing is refused with the reason',
  format($$SELECT (pg_temp.call(%1$L, %2$L, pg_temp.save_sql(3, pg_temp.doc(%3$L) || '{"colors": {}}')) ->> 'revision')::integer = 4
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.site_publish(4)') LIKE 'סרטון הפתיח ארוך מדי (16 שניות)%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.site_versions WHERE tenant_id = %1$L AND kind = 'published')$$,
         :'st', :OWNER62, :'v_long'));
-- an old draft with a video nobody measured yet: publishing does not wait for the check (the site will not show it)
SET session_replication_role = replica;
UPDATE hospitality.site_versions SET document = pg_temp.doc(:'v_new') WHERE tenant_id = :'st' AND kind = 'draft';
SET session_replication_role = DEFAULT;
SELECT pg_temp.call(:'st', :OWNER62, 'SELECT hospitality.site_publish(4)') ->> 'version' AS pv1 \gset
SELECT tests.check('publish: a video not measured yet does not block; the site gets no length for it (so it is not shown)',
  format($$SELECT %1$L::integer = 1
             AND (SELECT e -> 'seconds' = 'null'::jsonb
                    FROM jsonb_array_elements(pg_temp.call(%2$L, NULL, 'SELECT hospitality.public_site()') -> 'gallery') e
                   WHERE e ->> 'id' = %3$L)$$,
         :'pv1', :'st', :'v_new'));
SELECT pg_temp.call(:'st', :OWNER62, pg_temp.save_sql(4, pg_temp.doc(:'v_short'))) ->> 'revision' AS rv5 \gset
SELECT pg_temp.call(:'st', :OWNER62, format('SELECT hospitality.site_publish(%s)', :'rv5')) ->> 'version' AS pv2 \gset
SELECT tests.check('publish: a measured short video — published; the site gets its length (4.04) and no length for unchecked / images',
  format($$SELECT %1$L::integer = 2
             AND (SELECT jsonb_object_agg(e ->> 'id', e -> 'seconds')
                    FROM jsonb_array_elements(pg_temp.call(%2$L, NULL, 'SELECT hospitality.public_site()') -> 'gallery') e)
                 @> jsonb_build_object(%3$L, 4.04, %4$L, 16.2, %5$L, NULL, %6$L, NULL)
             AND pg_temp.call(%2$L, NULL, 'SELECT hospitality.public_site()') #>> '{design,document,sections,0,content,video}' = %3$L$$,
         :'pv2', :'st', :'v_short', :'v_long', :'v_unread', :'img'));

-- ============================================================
-- 3. Replacing the file resets the check
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER62, format($q$SELECT hospitality.media_replace(%L, %L)$q$, :'v_short', pg_temp.vid(:'st'))) IS NOT NULL AS ok \gset
SELECT tests.check('replacing the file: the old length is gone (checked again on the server); the site shows no length; back in the server''s list',
  format($$SELECT (SELECT duration_seconds IS NULL AND duration_checked_at IS NULL AND video_codec IS NULL
                     FROM hospitality.media WHERE id = %1$L)
             AND (SELECT e -> 'seconds' = 'null'::jsonb
                    FROM jsonb_array_elements(pg_temp.call(%2$L, NULL, 'SELECT hospitality.public_site()') -> 'gallery') e
                   WHERE e ->> 'id' = %1$L)
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.srv('SELECT hospitality.media_videos_to_check(20)')) e
                          WHERE e ->> 'id' = %1$L)
             AND pg_temp.call(%2$L, %3$L, $s$SELECT hospitality.media_list('site', NULL)$s$) -> 'items' @>
                 jsonb_build_array(jsonb_build_object('id', %1$L, 'duration_checked', false))$$,
         :'v_short', :'st', :OWNER62));
SELECT tests.check('a visitor of the other business cannot read this business''s lengths; the other business never sees them',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.media_list('site', NULL)$s$) -> 'items') e
                               WHERE e ->> 'id' IN (%3$L, %4$L))$$,
         :'so', :OTHER62, :'v_long', :'v_unread'));

-- ---------- cleanup: the platform flags as they were ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m62_flags m WHERE f.key = m.key;
DROP TABLE m62_flags;

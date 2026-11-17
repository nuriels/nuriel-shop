-- ============================================================
-- Hospitality: הצעות SEO שממתינות לאישור (20261118200000_hosp_seo_proposals.sql)
--   • מבנה: שתי טבלאות סגורות (RLS, בלי הרשאות ישירות לאף תפקיד); פונקציות ההפקה — שרת האפליקציה בלבד;
--     הרשימה וההחלטה — צוות עם הרשאת settings (לא אורח אנונימי)
--   • הפקה ראשונית — פעם אחת לעסק לכל סוג; ריצה שנכשלה / נתקעה לא חוסמת
--   • ההצעות: הערך הנוכחי (base) מחושב במסד; בהפקה האוטומטית — רק לשדות ריקים; יעד של עסק אחר / טקסט ארוך /
--     זהה — לא נכנס; תגיות ותווי בקרה מנוקים; הצעה חדשה מחליפה ממתינה לאותו שדה
--   • אישור: דרך הפונקציה הקיימת של השדה (טיוטת האתר / יחידה / תמונה); עריכה לפני אישור; אין דריסה — שדה
--     שהשתנה מאז ההפקה → stale ולא נוגעים בו; אין פרסום (הגרסה המפורסמת לא משתנה); יומן הפעולות
--   • בידוד: עסק אחר, משתמש זר, אורח — נדחים; אתר שאינו אירוח — נדחה; Ecommerce לא השתנה
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000e5ea1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000e5ea2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000e5eb1'''
\set STRANGER '''a0000000-0000-0000-0000-0000000e5ec1'''

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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_role(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.h(_site text, _uid uuid, _call text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT to_jsonb(hospitality.' || _call || ')');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.tenants t WHERE t.site_type = 'ecommerce')));
$f$;
-- הצעות של הפקה (כמו שרת האפליקציה)
CREATE OR REPLACE FUNCTION pg_temp.add(_site uuid, _run uuid, _items jsonb, _only_empty boolean) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(format('SELECT hospitality.seo_proposals_add(%L, %L, %L, %L)', _site, _run, _items, _only_empty));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.pid(_site uuid, _kind text, _target uuid, _field text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM hospitality.seo_proposals WHERE tenant_id = _site AND target_kind = _kind
     AND target_id IS NOT DISTINCT FROM _target AND field = _field AND status = 'pending';
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000e5ea1', 'sp.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000e5ea2', 'sp.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000e5eb1', 'sp.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000e5ec1', 'sp.stranger@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE sp_ecommerce_before AS SELECT pg_temp.ecommerce_hash() AS h;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('sp-a', 'הצעות SEO A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('sp-b', 'הצעות SEO B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'sp-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'sp-b' \gset
SELECT id AS shop FROM public.tenants WHERE site_type = 'ecommerce' ORDER BY is_default DESC LIMIT 1 \gset
SELECT pg_temp.add_role(:'sa', :OWNER_A, 'sp_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sa', :MGR_A, 'sp_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_role(:'sb', :OWNER_B, 'sp_owner_b') IS NOT NULL AS ok \gset
UPDATE public.user_roles SET is_protected = true WHERE user_id IN (:OWNER_A, :OWNER_B);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, $$property_create('{"name": "מתחם הצעות", "property_type": "zimmer_complex", "status": "active"}')$$) ->> 'id' AS pa \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר האלון", "unit_type": "zimmer", "capacity": 2}')$$, :'pa')) ->> 'id' AS u1 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format($$unit_create(%L, '{"name": "צימר הזית", "unit_type": "zimmer", "capacity": 5}')$$, :'pa')) ->> 'id' AS u2 \gset
SELECT pg_temp.h(:'sb', :OWNER_B, $$property_create('{"name": "מתחם B", "property_type": "villa"}')$$) ->> 'id' AS pb \gset
SELECT pg_temp.h(:'sb', :OWNER_B, format($$unit_create(%L, '{"name": "וילה B", "unit_type": "villa"}')$$, :'pb')) ->> 'id' AS ub \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  jsonb_build_object('kind', 'image', 'storage_path', :'sa' || '/' || gen_random_uuid() || '.webp', 'size_bytes', 900))) ->> 'id' AS img \gset
SELECT pg_temp.call(:'sb', :OWNER_B, format($q$SELECT hospitality.media_add('site', NULL, %L)$q$,
  jsonb_build_object('kind', 'image', 'storage_path', :'sb' || '/' || gen_random_uuid() || '.webp', 'size_bytes', 900))) ->> 'id' AS img_b \gset
-- האתר של A: טיוטה ופרסום (כותרת SEO כבר כתובה — העסק כתב אותה)
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT hospitality.site_draft_save(0, 'luxury',
  '{"v": 1, "theme": "luxury", "sections": [{"id": "hero", "type": "hero", "hidden": false, "content": {}}], "seo": {"title": "כותרת שהעסק כתב"}}'::jsonb)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sa', :OWNER_A, $q$SELECT hospitality.site_publish(1, NULL)$q$) IS NOT NULL AS ok \gset
-- יחידה 2 — העסק כבר כתב תיאור לגוגל
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_get(%L)', :'u2')) ->> 'revision')::int AS u2r \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, NULL, %L, %s)', :'u2', 'תיאור שהעסק כתב', :u2r)) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. מבנה והרשאות
-- ============================================================
SELECT tests.check('seo proposals: both tables closed (RLS on, no direct privileges for anon / authenticated / service_role, tenant guard)',
  $$SELECT (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('hospitality.seo_runs'::regclass, 'hospitality.seo_proposals'::regclass))
       AND NOT has_table_privilege('authenticated', 'hospitality.seo_proposals', 'SELECT')
       AND NOT has_table_privilege('anon', 'hospitality.seo_proposals', 'SELECT')
       AND NOT has_table_privilege('service_role', 'hospitality.seo_proposals', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'hospitality.seo_runs', 'SELECT')
       AND (SELECT count(*) FROM pg_policy WHERE polrelid IN ('hospitality.seo_runs'::regclass, 'hospitality.seo_proposals'::regclass)
              AND NOT polpermissive) = 4
       AND (SELECT count(*) FROM pg_trigger WHERE tgname = 'tenant_guard'
              AND tgrelid IN ('hospitality.seo_runs'::regclass, 'hospitality.seo_proposals'::regclass)) = 2$$);
SELECT tests.check('seo proposals: creating runs and proposals — the app server only; listing and deciding — staff (not anon); helpers — nobody',
  $$SELECT has_function_privilege('service_role', 'hospitality.seo_proposals_add(uuid,uuid,jsonb,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.seo_proposals_add(uuid,uuid,jsonb,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.seo_proposals_add(uuid,uuid,jsonb,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.seo_run_start(uuid,uuid,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.seo_run_finish(uuid,uuid,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.seo_runs_state(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.seo_proposals()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.seo_proposals()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.seo_proposal_decide(uuid,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.seo_proposal_decide(uuid,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._seo_current(uuid,text,uuid,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._seo_doc(uuid)', 'EXECUTE')$$);
SELECT pg_temp.expect_error('seo proposals: the server functions refuse a store (not a hospitality site)',
  format('SELECT pg_temp.srv(%L)', format('SELECT to_jsonb(hospitality.seo_run_start(%L, NULL, %L, %L))', :'shop', 'template', 'initial')),
  'אתר האירוח לא נמצא');

-- ============================================================
-- 2. הפקה ראשונית — פעם אחת לעסק
-- ============================================================
SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%L, %L, %L, %L))', :'sa', :OWNER_A, 'template', 'initial')) #>> '{}' AS run_t \gset
SELECT tests.check('seo runs: the first initial template run starts; a second one (same business, same kind) does not',
  format($$SELECT %1$L <> ''
             AND pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%%L, NULL, %%L, %%L))', %2$L, 'template', 'initial')) IS NULL
             AND pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%%L, NULL, %%L, %%L))', %3$L, 'template', 'initial')) IS NOT NULL$$,
         :'run_t', :'sa', :'sb'));
SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%L, %L, %L, %L))', :'sa', :OWNER_A, 'ai', 'initial')) #>> '{}' AS run_ai \gset
SELECT tests.check('seo runs: a failed initial AI run does not block a retry; a run stuck over 15 minutes counts as failed',
  format($$SELECT pg_temp.srv(format('SELECT hospitality.seo_run_finish(%%L, %%L, false)', %1$L, %2$L)) ->> 'status' = 'failed'
             AND (SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%%L, NULL, %%L, %%L))', %1$L, 'ai', 'initial'))) IS NOT NULL
             AND (SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%%L, NULL, %%L, %%L))', %1$L, 'ai', 'initial'))) IS NULL$$,
         :'sa', :'run_ai'));
UPDATE hospitality.seo_runs SET created_at = now() - interval '20 minutes' WHERE tenant_id = :'sa' AND kind = 'ai' AND status = 'running';
SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%L, NULL, %L, %L))', :'sa', 'ai', 'initial')) #>> '{}' AS run_ai2 \gset
SELECT tests.check('seo runs: after the stuck run is marked failed, exactly one live initial AI run per business',
  format($$SELECT %1$L <> '' AND (SELECT count(*) FROM hospitality.seo_runs WHERE tenant_id = %2$L AND kind = 'ai'
                                     AND scope = 'initial' AND status <> 'failed') = 1
             AND (pg_temp.srv(format('SELECT hospitality.seo_runs_state(%%L)', %2$L)) ->> 'ai_initial')::boolean$$,
         :'run_ai2', :'sa'));

-- ============================================================
-- 3. ההצעות נכנסות — רק לשדות ריקים בהפקה האוטומטית
-- ============================================================
SELECT pg_temp.add(:'sa', :'run_t', jsonb_build_array(
  jsonb_build_object('target_kind', 'site', 'field', 'seo_title', 'text', 'כותרת מהתבנית'),             -- העסק כתב — דילוג
  jsonb_build_object('target_kind', 'site', 'field', 'seo_description', 'text', E'תיאור <b>מהתבנית</b>\nבשורה'),
  jsonb_build_object('target_kind', 'site', 'field', 'hero_title', 'text', 'כותרת פתיח'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u1', 'field', 'seo_title', 'text', 'צימר האלון | לזוג'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u2', 'field', 'seo_description', 'text', 'תיאור מהתבנית'), -- העסק כתב — דילוג
  jsonb_build_object('target_kind', 'unit', 'target_id', :'ub', 'field', 'seo_title', 'text', 'יחידה של עסק אחר'),  -- לא שייך — דילוג
  jsonb_build_object('target_kind', 'media', 'target_id', :'img', 'field', 'alt', 'text', 'מרפסת עם נוף לגבעות'),
  jsonb_build_object('target_kind', 'media', 'target_id', :'img_b', 'field', 'alt', 'text', 'תמונה של עסק אחר'),   -- לא שייך — דילוג
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u1', 'field', 'seo_description', 'text', repeat('א', 201)), -- ארוך — דילוג
  jsonb_build_object('target_kind', 'site', 'field', 'about_title', 'text', '   '),                         -- ריק — דילוג
  jsonb_build_object('target_kind', 'unit', 'field', 'seo_title', 'text', 'בלי יחידה'),                    -- בלי יעד — דילוג
  jsonb_build_object('target_kind', 'site', 'field', 'password', 'text', 'שדה לא מוכר')                    -- דילוג
), true) AS added1 \gset
SELECT tests.check('seo add: 4 in, 8 skipped (filled by the business, another business''s unit / image, too long, empty, no target, unknown field)',
  format($$SELECT %1$L::jsonb = '{"added": 4, "skipped": 8}'::jsonb
             AND NOT EXISTS (SELECT 1 FROM hospitality.seo_proposals WHERE tenant_id = %2$L)$$, :'added1', :'sb'));
SELECT tests.check('seo add: tags and line breaks cleaned from one-line fields; base computed by the database (empty = NULL)',
  format($$SELECT (SELECT proposed FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%1$L, 'site', NULL, 'seo_description'))
                    = 'תיאור bמהתבנית/b בשורה'
             AND (SELECT base IS NULL AND source = 'template' FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%1$L, 'unit', %2$L, 'seo_title'))$$,
         :'sa', :'u1'));
SELECT pg_temp.add(:'sa', :'run_ai2', jsonb_build_array(
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u1', 'field', 'seo_title', 'text', 'צימר האלון – צימר לזוג'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u2', 'field', 'seo_description', 'text', 'ניסוח משופר'),
  jsonb_build_object('target_kind', 'unit', 'target_id', :'u2', 'field', 'description',
                     'text', E'פסקה ראשונה.\n\nפסקה שנייה.')), false) AS added2 \gset
SELECT tests.check('seo add (on request): a new proposal replaces the pending one for the same field (superseded); a filled field may get a proposal (base = what the business wrote); paragraphs kept in content',
  format($$SELECT %1$L::jsonb = '{"added": 3, "skipped": 0}'::jsonb
             AND (SELECT count(*) FROM hospitality.seo_proposals WHERE tenant_id = %2$L AND target_id = %3$L AND field = 'seo_title'
                    AND status = 'superseded') = 1
             AND (SELECT source = 'ai' FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%2$L, 'unit', %3$L, 'seo_title'))
             AND (SELECT base = 'תיאור שהעסק כתב' FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%2$L, 'unit', %4$L, 'seo_description'))
             AND (SELECT proposed = E'פסקה ראשונה.\n\nפסקה שנייה.' FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%2$L, 'unit', %4$L, 'description'))$$,
         :'added2', :'sa', :'u1', :'u2'));
SELECT pg_temp.srv(format('SELECT hospitality.seo_run_finish(%L, %L, true)', :'sa', :'run_t')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('seo add: a finished run takes no more proposals',
  format('SELECT pg_temp.add(%L, %L, %L, true)', :'sa', :'run_t',
                      jsonb_build_array(jsonb_build_object('target_kind', 'site', 'field', 'about_title', 'text', 'x'))),
  'ההפקה לא נמצאה');
SELECT tests.check('seo runs: finishing writes the count and one log entry (system, no text)',
  format($$SELECT (SELECT added = 4 AND status = 'done' FROM hospitality.seo_runs WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %2$L AND action = 'seo.suggestions_created'
                           AND changes = '{"count": 4, "scope": "initial", "source": "template"}'::jsonb)$$,
         :'run_t', :'sa'));

-- ============================================================
-- 4. הרשימה
-- ============================================================
SELECT tests.check('seo list: the owner and a manager of A see the pending proposals with the current value and the unit name; B sees none of A',
  format($$SELECT (SELECT count(*) FROM jsonb_array_elements(pg_temp.h(%1$L, %2$L, 'seo_proposals()') -> 'proposals') e
                    WHERE e ->> 'status' = 'pending') = 6
             AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.h(%1$L, %3$L, 'seo_proposals()') -> 'proposals')) >= 6
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.h(%1$L, %2$L, 'seo_proposals()') -> 'proposals') e
                          WHERE e ->> 'field' = 'seo_description' AND e ->> 'target_label' = 'צימר הזית'
                            AND e ->> 'current' = 'תיאור שהעסק כתב')
             AND (pg_temp.h(%1$L, %2$L, 'seo_proposals()') #>> '{runs,template_initial}')::boolean
             AND jsonb_array_length(pg_temp.h(%4$L, %5$L, 'seo_proposals()') -> 'proposals') = 0$$,
         :'sa', :OWNER_A, :MGR_A, :'sb', :OWNER_B));
SELECT pg_temp.expect_error('seo list: an anonymous visitor cannot call it',
  format('SELECT pg_temp.h(%L, NULL, %L)', :'sa', 'seo_proposals()'), 'permission denied');
SELECT pg_temp.expect_error('seo list: a signed-in stranger is refused',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :STRANGER, 'seo_proposals()'), '');

-- ============================================================
-- 5. החלטה — דרך הפונקציות הקיימות, בלי דריסה ובלי פרסום
-- ============================================================
SELECT pg_temp.pid(:'sa', 'unit', :'u1', 'seo_title') AS p_u1 \gset
SELECT pg_temp.pid(:'sa', 'site', NULL, 'seo_description') AS p_desc \gset
SELECT pg_temp.pid(:'sa', 'site', NULL, 'hero_title') AS p_hero \gset
SELECT pg_temp.pid(:'sa', 'media', :'img', 'alt') AS p_img \gset
SELECT pg_temp.pid(:'sa', 'unit', :'u2', 'seo_description') AS p_u2 \gset
SELECT pg_temp.pid(:'sa', 'unit', :'u2', 'description') AS p_u2d \gset
SELECT (SELECT revision FROM hospitality.units WHERE id = :'u1') AS u1rev \gset
SELECT (SELECT max(version) FROM hospitality.site_versions WHERE tenant_id = :'sa' AND kind = 'published') AS pubv \gset
SELECT (SELECT md5(document::text) FROM hospitality.site_versions WHERE tenant_id = :'sa' AND kind = 'published') AS pubdoc \gset

SELECT pg_temp.expect_error('seo decide: another business cannot decide A''s proposal',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sb', :OWNER_B, format('seo_proposal_decide(%L, %L)', :'p_u1', 'approve')), 'לא נמצאה');
SELECT pg_temp.expect_error('seo decide: an anonymous visitor cannot call it',
  format('SELECT pg_temp.h(%L, NULL, %L)', :'sa', format('seo_proposal_decide(%L, %L)', :'p_u1', 'approve')), 'permission denied');
SELECT pg_temp.expect_error('seo decide: an unknown action is refused',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_u1', 'publish')), 'פעולה לא תקינה');

SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_u1', 'approve')) ->> 'status' AS d1 \gset
SELECT tests.check('seo decide: approving a unit title saves it through unit_seo_set (revision +1, the description untouched), status approved, logged',
  format($$SELECT %1$L = 'approved'
             AND (SELECT seo_title = 'צימר האלון – צימר לזוג' AND seo_description IS NULL AND revision = %2$s + 1
                    FROM hospitality.units WHERE id = %3$L)
             AND (SELECT status = 'approved' AND applied = proposed AND decided_by = %4$L FROM hospitality.seo_proposals WHERE id = %5$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %6$L AND action = 'catalog.unit_updated')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %6$L AND action = 'seo.proposal_approved'
                           AND target_label = 'צימר האלון' AND changes ->> 'edited' = 'false')$$,
         :'d1', :u1rev, :'u1', :OWNER_A, :'p_u1', :'sa'));
SELECT pg_temp.expect_error('seo decide: a decided proposal cannot be decided again',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_u1', 'reject')), 'כבר טופלה');

SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L, %L)', :'p_desc', 'approve', '  תיאור שהעסק ערך <i>לפני</i> האישור ')) ->> 'status' AS d2 \gset
SELECT pg_temp.h(:'sa', :MGR_A, format('seo_proposal_decide(%L, %L)', :'p_hero', 'approve')) ->> 'status' AS d3 \gset
SELECT tests.check('seo decide: site fields go to the DRAFT only (edited text cleaned, the hero section gets the title); the published version is unchanged — no publish',
  format($$SELECT %1$L = 'approved' AND %2$L = 'approved'
             AND (SELECT document #>> '{seo,description}' = 'תיאור שהעסק ערך iלפני/i האישור'
                     AND document #>> '{seo,title}' = 'כותרת שהעסק כתב'
                     AND document #>> '{sections,0,content,title}' = 'כותרת פתיח'
                    FROM hospitality.site_versions WHERE tenant_id = %3$L AND kind = 'draft')
             AND (SELECT max(version) FROM hospitality.site_versions WHERE tenant_id = %3$L AND kind = 'published') = %4$s
             AND (SELECT md5(document::text) FROM hospitality.site_versions WHERE tenant_id = %3$L AND kind = 'published') = %5$L
             AND (SELECT changes ->> 'edited' = 'true' FROM hospitality.audit_log WHERE tenant_id = %3$L
                    AND action = 'seo.proposal_approved' AND changes ->> 'field' = 'seo_description')$$,
         :'d2', :'d3', :'sa', :pubv, :'pubdoc'));

SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_img', 'approve')) ->> 'status' AS d4 \gset
SELECT tests.check('seo decide: an image alt is saved through media_update (logged as media.alt_updated)',
  format($$SELECT %1$L = 'approved' AND (SELECT alt = 'מרפסת עם נוף לגבעות' FROM hospitality.media WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %3$L AND action = 'media.alt_updated')$$,
         :'d4', :'img', :'sa'));

-- אין דריסה: העסק משנה את התיאור לגוגל של יחידה 2 אחרי ההפקה
SELECT (pg_temp.h(:'sa', :OWNER_A, format('unit_seo_get(%L)', :'u2')) ->> 'revision')::int AS u2r2 \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('unit_seo_set(%L, NULL, %L, %s)', :'u2', 'העסק שינה אחרי ההצעה', :u2r2)) IS NOT NULL AS ok \gset
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_u2', 'approve')) ->> 'status' AS d5 \gset
SELECT tests.check('seo decide: a field changed after the proposal is NOT overwritten — the proposal becomes stale, the business''s text stays',
  format($$SELECT %1$L = 'stale'
             AND (SELECT seo_description = 'העסק שינה אחרי ההצעה' FROM hospitality.units WHERE id = %2$L)
             AND (SELECT status = 'stale' AND applied IS NULL FROM hospitality.seo_proposals WHERE id = %3$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %4$L AND action = 'seo.proposal_approved'
                               AND target_label = 'צימר הזית' AND changes ->> 'field' = 'seo_description')$$,
         :'d5', :'u2', :'p_u2', :'sa'));

SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', :'p_u2d', 'reject')) ->> 'status' AS d6 \gset
SELECT tests.check('seo decide: rejecting changes nothing in the unit and is logged',
  format($$SELECT %1$L = 'rejected' AND (SELECT description IS NULL FROM hospitality.units WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %3$L AND action = 'seo.proposal_rejected')$$,
         :'d6', :'u2', :'sa'));
SELECT pg_temp.srv(format('SELECT to_jsonb(hospitality.seo_run_start(%L, %L, %L, %L))', :'sa', :OWNER_A, 'template', 'request')) #>> '{}' AS run_r \gset
SELECT pg_temp.add(:'sa', :'run_r', jsonb_build_array(
  jsonb_build_object('target_kind', 'site', 'field', 'about_title', 'text', 'על המקום'),
  jsonb_build_object('target_kind', 'site', 'field', 'seo_title', 'text', 'כותרת חדשה לבקשת העסק')), false) AS added3 \gset
SELECT pg_temp.expect_error('seo decide: an edited text longer than the field allows is refused',
  format('SELECT pg_temp.h(%L, %L, %L)', :'sa', :OWNER_A,
         format('seo_proposal_decide(%L, %L, %L)', pg_temp.pid(:'sa', 'site', NULL, 'about_title'), 'approve', repeat('ב', 121))),
  'ארוך מדי');
SELECT tests.check('seo decide: after the refused edit nothing was saved and the proposal is still pending; a request run may propose for a field the business wrote (base kept)',
  format($$SELECT %1$L::jsonb = '{"added": 2, "skipped": 0}'::jsonb
             AND pg_temp.pid(%2$L, 'site', NULL, 'about_title') IS NOT NULL
             AND (SELECT document -> 'sections' @> '[{"type": "about"}]' IS NOT TRUE
                    FROM hospitality.site_versions WHERE tenant_id = %2$L AND kind = 'draft')
             AND (SELECT base = 'כותרת שהעסק כתב' FROM hospitality.seo_proposals WHERE id = pg_temp.pid(%2$L, 'site', NULL, 'seo_title'))$$,
         :'added3', :'sa'));
SELECT pg_temp.h(:'sa', :OWNER_A, format('seo_proposal_decide(%L, %L)', pg_temp.pid(:'sa', 'site', NULL, 'about_title'), 'approve')) ->> 'status' AS d7 \gset
SELECT tests.check('seo decide: a missing "about" section is added to the draft with the approved title (the editor shows it)',
  format($$SELECT %1$L = 'approved'
             AND (SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(document -> 'sections') s
                                  WHERE s ->> 'type' = 'about' AND s #>> '{content,title}' = 'על המקום' AND s ->> 'hidden' = 'false')
                    FROM hospitality.site_versions WHERE tenant_id = %2$L AND kind = 'draft')$$,
         :'d7', :'sa'));

-- ============================================================
-- 6. בידוד ו-Ecommerce
-- ============================================================
SELECT tests.check('seo isolation: nothing of B changed (unit, image, draft), and every proposal of A belongs to A',
  format($$SELECT (SELECT seo_title IS NULL FROM hospitality.units WHERE id = %1$L)
             AND (SELECT alt IS NULL FROM hospitality.media WHERE id = %2$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.seo_proposals p WHERE p.tenant_id = %3$L AND p.target_kind = 'unit'
                               AND NOT EXISTS (SELECT 1 FROM hospitality.units u WHERE u.id = p.target_id AND u.tenant_id = %3$L))$$,
         :'ub', :'img_b', :'sa'));
SELECT tests.check('seo proposals: Ecommerce stores and their settings unchanged',
  $$SELECT h = pg_temp.ecommerce_hash() FROM sp_ecommerce_before$$);

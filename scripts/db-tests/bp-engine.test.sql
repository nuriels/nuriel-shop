-- ============================================================
-- Nuriel Websites — business_profile engine (migration 193, Stage 1)
--   • the schema is closed to every API user; everything goes through the functions
--   • only the platform admin opens a site; the owner must be a platform-verified account
--   • two business sites are fully separated (content, versions, studio, public read)
--   • permissions: owner (everything), manager (content only), customer / other business / guest (nothing)
--   • draft revisions never overwrite each other; the first publish waits for the platform admin;
--     after the approval the owner publishes alone; versions are kept and restorable, never changed
--   • the public site shows only the approved live version, only when the flags are on and the site is active
--   • stores and zimmer sites are untouched: no store rows for a business site, no business data on theirs
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
\set B1 '''a0000000-0000-0000-0000-0000000000b1'''
\set SA '''70000000-0000-0000-0000-00000000000a'''
\set SB '''70000000-0000-0000-0000-00000000000b'''
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set W_OWNER1 '''a0000000-0000-0000-0000-0000000193a1'''
\set W_OWNER2 '''a0000000-0000-0000-0000-0000000193a2'''
\set W_MGR '''a0000000-0000-0000-0000-0000000193a3'''
\set W_PLAIN '''a0000000-0000-0000-0000-0000000193a4'''

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
CREATE OR REPLACE FUNCTION pg_temp.owner_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RETURN e;
END $f$;
-- the public read of a site, as a guest
CREATE OR REPLACE FUNCTION pg_temp.public_doc(_site text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.as_user(_site, NULL, 'SELECT public.bp_public_site()');
$f$;
-- a minimal valid document
CREATE OR REPLACE FUNCTION pg_temp.doc(_title text, _template text DEFAULT 'elegant') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('schema', 1, 'template', _template, 'locales', '["he"]'::jsonb,
           'pages', jsonb_build_array(jsonb_build_object('id', 'home', 'slug', '', 'title', jsonb_build_object('he', _title),
                                                         'blocks', '[]'::jsonb)));
$f$;

-- ---------- fixtures: platform-verified accounts (two owners, a manager, a plain account) ----------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data) VALUES
  (:W_OWNER1, 'web.owner1@test.local', now(), '{"platform": "true"}'),
  (:W_OWNER2, 'web.owner2@test.local', now(), '{"platform": "true"}'),
  (:W_MGR, 'web.mgr@test.local', now(), '{"platform": "true"}'),
  (:W_PLAIN, 'web.plain@test.local', now(), '{"provider": "email", "providers": ["email"]}')
ON CONFLICT DO NOTHING;
SELECT count(*) AS stores_before FROM public.tenants WHERE site_type = 'ecommerce' \gset
SELECT count(*) AS shipping_before FROM public.shipping_methods \gset
SELECT count(*) AS subs_before FROM public.tenant_subscriptions \gset

-- ============================================================
-- 1. Closed schema; only the platform admin opens a site
-- ============================================================
SELECT tests.check('bp: the business_profile schema and its tables are closed to every API user (RLS on every table)',
  $$SELECT NOT has_schema_privilege('anon', 'business_profile', 'USAGE')
       AND NOT has_schema_privilege('authenticated', 'business_profile', 'USAGE')
       AND (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'business_profile' AND c.relkind = 'r')
       -- (4 tables in migration 193; later migrations add more — every one of them with RLS, checked above)
       AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'business_profile' AND c.relkind = 'r') >= 4
       AND NOT has_table_privilege('authenticated', 'business_profile.site_versions', 'SELECT')
       AND NOT has_table_privilege('anon', 'business_profile.sites', 'SELECT')$$);
SELECT tests.check('bp: guests may only call the public read and the site name; everything else needs a login',
  $$SELECT has_function_privilege('anon', 'public.bp_public_site()', 'EXECUTE')
       AND has_function_privilege('anon', 'public.bp_site_head()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_draft_get()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_draft_save(jsonb,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_publish(integer,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.platform_bp_open_site(text,text,text,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.platform_bp_approve_publish(uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile.studio_site(text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._publish(uuid,text,jsonb,integer,text,uuid,uuid)', 'EXECUTE')$$);
SELECT tests.check('bp: two templates are available (Elegant, Portfolio) and four are planned — six in all',
  $$SELECT (SELECT string_agg(key, ',' ORDER BY sort) FROM business_profile.templates WHERE status = 'available') = 'elegant,portfolio'
       AND (SELECT count(*) FROM business_profile.templates) = 6$$);
SELECT tests.check('bp: a store owner, a plain account and a guest cannot open a business site',
  format($$SELECT pg_temp.user_err(NULL, %L, $q$SELECT public.platform_bp_open_site('web-x', 'אתר')$q$) LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.user_err(NULL, %L, $q$SELECT public.platform_bp_open_site('web-x', 'אתר')$q$) LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.user_err(NULL, NULL, $q$SELECT public.platform_bp_open_site('web-x', 'אתר')$q$) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'web-x')$$, :OA, :W_PLAIN));
SELECT tests.check('bp: a planned template (not yet available) or a broken document is refused',
  format($$SELECT pg_temp.user_err(NULL, %1$L, format('SELECT public.platform_bp_open_site(%%L, %%L, NULL, %%L)', 'web-x', 'אתר', pg_temp.doc('x', 'luxury'))) LIKE '%%לא זמינה%%'
             AND pg_temp.user_err(NULL, %1$L, $q$SELECT public.platform_bp_open_site('web-x', 'אתר', NULL, '[]'::jsonb)$q$) LIKE '%%לא תקין%%'
             AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'web-x')$$, :PLATFORM));

SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('web-one', 'אתר ראשון', 'web.owner1@test.local', %L)$$,
                                              pg_temp.doc('ראשון'))) AS open1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('web-two', 'אתר שני', 'web.plain@test.local', %L)$$,
                                              pg_temp.doc('שני', 'portfolio'))) AS open2 \gset
SELECT :'open1'::jsonb ->> 'id' AS w1, :'open2'::jsonb ->> 'id' AS w2 \gset

SELECT tests.check('bp: opening — a business site, a draft from the template, the studio flag; the verified owner is attached, an unverified email waits',
  format($$SELECT (SELECT site_type FROM public.tenants WHERE id = %1$L) = 'business_profile'
             AND (SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = %1$L AND state = 'draft') = 1
             AND (SELECT template FROM business_profile.site_versions WHERE tenant_id = %2$L AND state = 'draft') = 'portfolio'
             AND EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE tenant_id = %1$L AND key = 'business_profile_enabled' AND enabled)
             AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE tenant_id = %1$L AND key = 'business_profile_public')
             AND %3$L::jsonb -> 'owner' ->> 'status' = 'added'
             AND %4$L::jsonb -> 'owner' ->> 'status' = 'needs_account'
             AND EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %1$L AND user_id = %5$L AND role = 'admin' AND is_protected)
             AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = %2$L)
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'bp_site_opened')$$,
         :'w1', :'w2', :'open1', :'open2', :W_OWNER1));
SELECT tests.check('bp: opening a business site creates no store rows (shipping, subscription) — and store tables refuse them',
  format($$SELECT (SELECT count(*) FROM public.shipping_methods) = %s AND (SELECT count(*) FROM public.tenant_subscriptions) = %s
             AND pg_temp.owner_err(format($q$INSERT INTO public.shipping_methods (tenant_id, name, kind, price) VALUES (%%L, 'x', 'pickup', 0)$q$, %L)) IS NOT NULL$$,
         :shipping_before, :subs_before, :'w1'));
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_set_owner(%L, 'web.owner2@test.local')$$, :'w2')) AS own2 \gset
SELECT tests.check('bp: set owner — a verified account is attached; a second owner is refused; a customer cannot be added to a business site',
  format($$SELECT %L::jsonb ->> 'status' = 'added'
             AND pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_set_owner(%%L, %%L)', %L, 'web.owner1@test.local')) LIKE '%%כבר יש בעלים%%'
             AND pg_temp.owner_err(format($q$INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved) VALUES (%%L, %%L, 'web.plain@test.local', 'customer', true)$q$, %L, %L)) LIKE '%%לא קיים באתר מסוג%%'$$,
         :'own2', :PLATFORM, :'w2', :'w1', :W_PLAIN));
-- a manager (not the owner) on site one
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
VALUES (:'w1', :W_MGR, 'web.mgr@test.local', 'admin', true, false);

-- ============================================================
-- 2. Studio: the platform flag gates everything; the owner edits; revisions never overwrite
-- ============================================================
SELECT tests.check('bp: with the platform flag off, the studio is closed even for the owner',
  format($$SELECT pg_temp.user_err(%L, %L, 'SELECT public.bp_studio_context()') LIKE '%%אין הרשאה%%'$$, :'w1', :W_OWNER1));
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(public.platform_set_flag('business_profile_enabled', true))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'w1', :W_OWNER1, 'SELECT public.bp_studio_context()') AS ctx1 \gset
SELECT pg_temp.as_user(:'w1', :W_OWNER1, 'SELECT public.bp_draft_get()') AS draft1 \gset
SELECT tests.check('bp: the owner sees their own site, status draft, all permissions and the six templates',
  format($$SELECT %1$L::jsonb -> 'site' ->> 'slug' = 'web-one' AND %1$L::jsonb -> 'state' ->> 'status' = 'draft'
             AND %1$L::jsonb -> 'permissions' ? 'site.publish' AND jsonb_array_length(%1$L::jsonb -> 'templates') = 6
             AND %2$L::jsonb ->> 'revision' = '1' AND %2$L::jsonb -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון'$$,
         :'ctx1', :'draft1'));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, format('SELECT public.bp_draft_save(%L, 1)', pg_temp.doc('ראשון v2'))) AS save1 \gset
SELECT tests.check('bp: save with the current revision → revision 2; a stale revision is refused and changes nothing',
  format($$SELECT %L::jsonb ->> 'revision' = '2'
             AND pg_temp.user_err(%L, %L, format('SELECT public.bp_draft_save(%%L, 1)', pg_temp.doc('דורס'))) LIKE '%%נשמרה בינתיים%%'
             AND (SELECT document -> 'pages' -> 0 -> 'title' ->> 'he' FROM business_profile.site_versions
                   WHERE tenant_id = %L AND state = 'draft') = 'ראשון v2'$$, :'save1', :'w1', :W_MGR, :'w1'));
SELECT tests.check('bp: an oversized document (over 512KB) or a planned template is refused',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_draft_save(%%L, 2)',
                    pg_temp.doc('x') || jsonb_build_object('pad', repeat('א', 300000)))) LIKE '%%גדול מדי%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_draft_save(%%L, 2)', pg_temp.doc('x', 'minimal'))) LIKE '%%לא זמינה%%'$$,
         :'w1', :W_OWNER1));
SELECT tests.check('bp: the manager may edit content but may not publish or restore',
  format($$SELECT pg_temp.as_user(%1$L, %2$L, format('SELECT public.bp_draft_save(%%L, 2)', pg_temp.doc('ראשון v3'))) ->> 'revision' = '3'
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_publish(3)') LIKE '%%אין הרשאה%%'
             AND NOT (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_studio_context()') -> 'permissions' ? 'site.publish')$$,
         :'w1', :W_MGR));

-- ============================================================
-- 3. Separation between two business sites (and the other engines)
-- ============================================================
SELECT tests.check('bp: owner of site one cannot read or change site two — from its address or from their own',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_draft_get()') LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_draft_save(%%L, 1)', pg_temp.doc('פריצה'))) LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_versions()') LIKE '%%אין הרשאה%%'
             AND pg_temp.as_user(%3$L, %2$L, 'SELECT public.bp_draft_get()') -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v3'
             AND (SELECT document -> 'pages' -> 0 -> 'title' ->> 'he' FROM business_profile.site_versions
                   WHERE tenant_id = %1$L AND state = 'draft') = 'שני'$$, :'w2', :W_OWNER1, :'w1'));
SELECT tests.check('bp: a store owner (store A) has no studio on a business site or on their store; a plain account neither',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_studio_context()') LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%3$L, %2$L, 'SELECT public.bp_studio_context()') LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %4$L, 'SELECT public.bp_draft_get()') LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, NULL, 'SELECT public.bp_draft_get()') IS NOT NULL$$, :'w1', :OA, :SA, :W_PLAIN));
SELECT tests.check('bp: a business owner gets nothing on a store address (the store is not a business site)',
  format($$SELECT pg_temp.user_err(%L, %L, 'SELECT public.bp_studio_context()') LIKE '%%אין הרשאה%%'
             AND pg_temp.public_doc(%1$L) IS NULL$$, :SA, :W_OWNER1));
SELECT tests.check('bp: the owner of a business site cannot use the platform functions',
  format($$SELECT pg_temp.user_err(NULL, %1$L, 'SELECT public.platform_bp_sites()') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.user_err(NULL, %1$L, format('SELECT public.platform_bp_review(%%L)', %2$L)) LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.user_err(NULL, %1$L, format('SELECT public.platform_bp_set_public(%%L, true)', %2$L)) LIKE '%%מנהל הפלטפורמה%%'$$,
         :W_OWNER1, :'w1'));

-- ============================================================
-- 4. First publish waits for the platform admin
-- ============================================================
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(public.platform_set_flag('business_profile_public', true))$$) IS NOT NULL AS ok \gset
SELECT tests.check('bp: nothing is public before an approved publish (even with both flags on)',
  format($$SELECT pg_temp.public_doc(%L) IS NULL AND pg_temp.public_doc(%L) IS NULL$$, :'w1', :'w2'));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, $$SELECT public.bp_publish(3, 'גרסה ראשונה')$$) AS req1 \gset
SELECT tests.check('bp: the first publish becomes a request (pending review) — a snapshot of the draft; still not public',
  format($$SELECT %L::jsonb ->> 'mode' = 'pending_review'
             AND pg_temp.as_user(%L, %L, 'SELECT public.bp_studio_context()') -> 'state' ->> 'status' = 'pending_review'
             AND pg_temp.public_doc(%2$L) IS NULL
             AND (SELECT document -> 'pages' -> 0 -> 'title' ->> 'he' FROM business_profile.site_versions
                   WHERE tenant_id = %2$L AND state = 'pending') = 'ראשון v3'$$, :'req1', :'w1', :W_OWNER1));
-- the owner keeps editing the draft; the request stays what was sent
SELECT pg_temp.as_user(:'w1', :W_OWNER1, format('SELECT public.bp_draft_save(%L, 3)', pg_temp.doc('ראשון v4'))) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_review(%L)', :'w1')) AS review1 \gset
SELECT tests.check('bp: the platform admin reviews exactly the requested snapshot (not later draft changes)',
  format($$SELECT %L::jsonb -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v3'$$, :'review1'));
SELECT tests.check('bp: rejecting needs a note; the note is shown to the owner; nothing is public',
  format($$SELECT pg_temp.user_err(NULL, %1$L, format('SELECT public.platform_bp_reject_publish(%%L, %%L, %%L)', %2$L, %3$L, '')) LIKE '%%מה צריך לתקן%%'
             AND pg_temp.as_user(NULL, %1$L, format('SELECT public.platform_bp_reject_publish(%%L, %%L, %%L)', %2$L, %3$L, 'חסרות תמונות')) ->> 'status' = 'rejected'
             AND pg_temp.as_user(%2$L, %4$L, 'SELECT public.bp_studio_context()') -> 'state' -> 'last_rejection' ->> 'note' = 'חסרות תמונות'
             AND pg_temp.as_user(%2$L, %4$L, 'SELECT public.bp_studio_context()') -> 'state' ->> 'status' = 'draft'
             AND pg_temp.public_doc(%2$L) IS NULL$$, :PLATFORM, :'w1', :'review1'::jsonb ->> 'id', :W_OWNER1));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, 'SELECT public.bp_publish(4)') IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_review(%L)', :'w1')) AS review2 \gset
SELECT tests.check('bp: an old (already handled) request id cannot be approved',
  format($$SELECT pg_temp.user_err(NULL, %L, format('SELECT public.platform_bp_approve_publish(%%L, %%L)', %L, %L)) LIKE '%%לא נמצאה%%'$$,
         :PLATFORM, :'w1', :'review1'::jsonb ->> 'id'));
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_approve_publish(%L, %L)', :'w1', :'review2'::jsonb ->> 'id')) AS appr1 \gset
SELECT tests.check('bp: approval → version 1 is live and public on its own site only; the approval is recorded',
  format($$SELECT (%1$L::jsonb ->> 'version')::int = 1
             AND pg_temp.public_doc(%2$L) -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v4'
             AND pg_temp.public_doc(%2$L) ->> 'version' = '1'
             AND pg_temp.public_doc(%3$L) IS NULL AND pg_temp.public_doc(%4$L) IS NULL AND pg_temp.public_doc(NULL) IS NULL
             AND (SELECT reviewed_by FROM business_profile.site_versions WHERE tenant_id = %2$L AND version = 1) = %5$L
             AND (SELECT created_by FROM business_profile.site_versions WHERE tenant_id = %2$L AND version = 1) = %6$L
             AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %2$L AND action = 'bp_publish_approved')$$,
         :'appr1', :'w1', :'w2', :SA, :PLATFORM, :W_OWNER1));

-- ============================================================
-- 5. After the approval the owner publishes alone; history and restore
-- ============================================================
SELECT pg_temp.as_user(:'w1', :W_OWNER1, format('SELECT public.bp_draft_save(%L, 4)', pg_temp.doc('ראשון v5'))) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'w1', :W_OWNER1, $$SELECT public.bp_publish(5, 'עדכון')$$) AS pub2 \gset
SELECT tests.check('bp: after the first approval the owner publishes directly → version 2 live',
  format($$SELECT %L::jsonb ->> 'mode' = 'published' AND (%1$L::jsonb ->> 'version')::int = 2
             AND pg_temp.public_doc(%L) -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v5'$$, :'pub2', :'w1'));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, 'SELECT public.bp_versions()') AS hist1 \gset
SELECT (SELECT e ->> 'id' FROM jsonb_array_elements(:'hist1'::jsonb) e WHERE e ->> 'version' = '1') AS v1id \gset
SELECT tests.check('bp: history — versions 2 (live) and 1, and the rejected request; no draft; only this site',
  format($$SELECT jsonb_array_length(%1$L::jsonb) = 3
             AND (SELECT count(*) FROM jsonb_array_elements(%1$L::jsonb) e WHERE (e ->> 'live')::boolean AND e ->> 'version' = '2') = 1
             AND (SELECT count(*) FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'state' = 'rejected') = 1
             AND jsonb_array_length(pg_temp.as_user(%2$L, %3$L, 'SELECT public.bp_versions()')) = 0$$, :'hist1', :'w2', :W_OWNER2));
SELECT tests.check('bp: a version of another site cannot be read or restored',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_version_get(%%L)', %3$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_version_restore(%%L, 1)', %3$L)) LIKE '%%לא נמצאה%%'$$,
         :'w2', :W_OWNER2, :'v1id'));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, format('SELECT public.bp_version_restore(%L, 5)', :'v1id')) AS rest1 \gset
SELECT tests.check('bp: restore version 1 → into the draft (revision 6); the live version is unchanged until publishing',
  format($$SELECT %L::jsonb ->> 'revision' = '6'
             AND pg_temp.as_user(%L, %L, 'SELECT public.bp_draft_get()') -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v4'
             AND pg_temp.public_doc(%2$L) ->> 'version' = '2'$$, :'rest1', :'w1', :W_OWNER1));
SELECT pg_temp.as_user(:'w1', :W_OWNER1, 'SELECT public.bp_publish(6)') AS pub3 \gset
SELECT tests.check('bp: publishing the restored draft → version 3 with the content of version 1',
  format($$SELECT (%L::jsonb ->> 'version')::int = 3
             AND pg_temp.public_doc(%L) -> 'document' -> 'pages' -> 0 -> 'title' ->> 'he' = 'ראשון v4'$$, :'pub3', :'w1'));
SELECT tests.check('bp: published versions and the log never change — not even for the database owner',
  format($$SELECT pg_temp.owner_err(format($q$UPDATE business_profile.site_versions SET note = 'x' WHERE tenant_id = %%L AND version = 1$q$, %1$L)) LIKE '%%לא משתנה%%'
             AND pg_temp.owner_err(format($q$DELETE FROM business_profile.site_versions WHERE tenant_id = %%L AND version = 1$q$, %1$L)) LIKE '%%לא נמחקת%%'
             AND pg_temp.owner_err(format($q$UPDATE business_profile.audit_log SET action = 'x.y.z' WHERE tenant_id = %%L$q$, %1$L)) LIKE '%%לא משתנה%%'
             AND (SELECT count(*) FROM business_profile.audit_log WHERE tenant_id = %1$L AND action LIKE 'publish.%%') >= 5$$, :'w1'));

-- ============================================================
-- 6. Public visibility switches
-- ============================================================
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_set_public(%L, false)', :'w1')) IS NOT NULL AS ok \gset
SELECT tests.check('bp: the platform admin can hide the public site (versions kept); a never-approved site cannot be opened',
  format($$SELECT pg_temp.public_doc(%1$L) IS NULL
             AND (SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = %1$L AND state = 'published') = 3
             AND pg_temp.user_err(NULL, %3$L, format('SELECT public.platform_bp_set_public(%%L, true)', %2$L)) LIKE '%%עוד לא אושר%%'$$,
         :'w1', :'w2', :PLATFORM));
SELECT pg_temp.as_user(NULL, :PLATFORM, format('SELECT public.platform_bp_set_public(%L, true)', :'w1')) IS NOT NULL AS ok \gset
UPDATE public.tenants SET status = 'suspended' WHERE id = :'w1';
SELECT tests.check('bp: a suspended site is not public', format($$SELECT pg_temp.public_doc(%L) IS NULL$$, :'w1'));
UPDATE public.tenants SET status = 'active' WHERE id = :'w1';
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(public.platform_set_flag('business_profile_public', false))$$) IS NOT NULL AS ok \gset
SELECT tests.check('bp: the platform switch off hides every business site at once',
  format($$SELECT pg_temp.public_doc(%L) IS NULL$$, :'w1'));
SELECT tests.check('bp: the platform list shows both business sites and only them, with their state',
  format($$SELECT jsonb_array_length(pg_temp.as_user(NULL, %L, 'SELECT public.platform_bp_sites()')) = 2
             AND (SELECT e -> 'state' ->> 'status' FROM jsonb_array_elements(pg_temp.as_user(NULL, %1$L, 'SELECT public.platform_bp_sites()')) e
                   WHERE e ->> 'slug' = 'web-one') = 'live'$$, :PLATFORM));
SELECT tests.check('bp: the existing stores are untouched (same number, still ecommerce)',
  format($$SELECT (SELECT count(*) FROM public.tenants WHERE site_type = 'ecommerce') = %s$$, :stores_before));

-- ---------- cleanup: flags off, the two business sites removed (later files count sites) ----------
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', false),
       public.platform_set_flag('business_profile_public', false)])$$) IS NOT NULL AS ok \gset
SET session_replication_role = replica;
DELETE FROM public.user_roles WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'w1', :'w2');
DELETE FROM public.tenants WHERE id IN (:'w1', :'w2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:W_OWNER1, :W_OWNER2, :W_MGR, :W_PLAIN);

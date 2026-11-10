-- ============================================================
-- Hospitality: הסכמה ל-Cookies, כבוי מאחורי מתג (20261110210000_hosp_consent.sql)
--   • מבנה: טבלה עם RLS בלי שום הרשאה ישירה, בלי IP / דפדפן / פרטים אישיים, שומר האתר, FK עם CASCADE;
--     המתג קיים וכבוי; הרישום — לשרת בלבד (service_role), הבדיקה אם המדידה זמינה — לכולם
--   • זמינות: כבוי כברירת מחדל; דולק לפלטפורמה ולאתר A — רק ב-A (לא ב-B, לא בלי כתובת, לא בחנות)
--   • רישום: רק באתר פתוח שהמדידה בו זמינה; בחירה לא עקבית / פעולה / גרסה לא תקינות — נדחות;
--     אורח אנונימי ומשתמש מחובר — לא יכולים לקרוא לפונקציה; שמירה ל-24 חודשים (רק של אותו אתר);
--     נתוני ה-Ecommerce לא השתנו
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-00000009c0a1'''
\set OWNER_B '''a0000000-0000-0000-0000-00000009c0b1'''
\set CID_1 '''c0000000-0000-4000-8000-00000000c001'''
\set CID_2 '''c0000000-0000-4000-8000-00000000c002'''

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
-- שרת האפליקציה (מפתח השירות) עם הכתובת של האתר — כמו callServerRpc
CREATE OR REPLACE FUNCTION pg_temp.svc(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
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
CREATE OR REPLACE FUNCTION pg_temp.record(_site text, _cid text, _analytics boolean, _action text, _version text)
RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT pg_temp.svc(%L, %L)', _site,
                format('SELECT hospitality.site_consent_record(%L, %L, %L, %L)', _cid, _analytics, _action, _version));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ecommerce_hash() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
       JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
    (SELECT string_agg(t::text, ',' ORDER BY t.id) FROM public.tenants t WHERE t.site_type = 'ecommerce')));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-00000009c0a1', 'cons.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-00000009c0b1', 'cons.owner.b@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE cons_ecommerce_before AS SELECT pg_temp.ecommerce_hash() AS h;
-- the platform switches as they were before this file (restored at the end)
SELECT COALESCE((SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_backend_enabled'), false) AS be0,
       COALESCE((SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_frontend_enabled'), false) AS fe0 \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('cons-a', 'אירוח הסכמה A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('cons-b', 'אירוח הסכמה B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'cons-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'cons-b' \gset
SELECT id AS store FROM public.tenants WHERE site_type = 'ecommerce' ORDER BY created_at LIMIT 1 \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:'sa', :OWNER_A, 'cons.owner.a@test.local', 'cons_owner_a', 'admin', true, true),
  (:'sb', :OWNER_B, 'cons.owner.b@test.local', 'cons_owner_b', 'admin', true, true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset

-- ============================================================
-- 1. structure
-- ============================================================
SELECT tests.check('consent: the table has RLS, no privilege for anon / authenticated / service_role, the tenant guard, FK to tenants with CASCADE',
  $$SELECT (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.consent_records'::regclass)
       AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role),
                                     unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
                        WHERE has_table_privilege(r.role, 'hospitality.consent_records', p.priv))
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'hospitality.consent_records'::regclass AND tgname = 'tenant_guard')
       AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.consent_records'::regclass AND contype = 'f'
                      AND confrelid = 'public.tenants'::regclass AND confdeltype = 'c')$$);
SELECT tests.check('consent: a record keeps no IP, browser or personal detail — exactly these columns',
  $$SELECT array_agg(column_name::text ORDER BY ordinal_position)
           = ARRAY['id', 'tenant_id', 'consent_id', 'analytics', 'action', 'policy_version', 'created_at']
      FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'consent_records'$$);
SELECT tests.check('consent: the analytics flag exists and is off for the platform',
  $$SELECT NOT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_analytics_enabled'$$);
SELECT tests.check('consent: recording is for the app server only (service_role); the availability check is for everyone',
  $$SELECT has_function_privilege('service_role', 'hospitality.site_consent_record(uuid,boolean,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.site_consent_record(uuid,boolean,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.site_consent_record(uuid,boolean,text,text)', 'EXECUTE')
       AND has_function_privilege('anon', 'hospitality.analytics_enabled()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.analytics_enabled()', 'EXECUTE')
       AND (SELECT bool_and(prosecdef) FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
                                         AND proname IN ('site_consent_record', 'analytics_enabled'))$$);

-- ============================================================
-- 2. availability (the flag)
-- ============================================================
SELECT tests.check('consent: by default (flag off) analytics is not available — anonymous visitor and staff alike',
  format($$SELECT pg_temp.call(%1$L, NULL, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'false'::jsonb
              AND pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'false'::jsonb$$,
         :'sa', :OWNER_A));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_analytics_enabled', true),
       public.platform_set_flag('hospitality_analytics_enabled', true, %1$L)])$$, :'sa')) IS NOT NULL AS ok \gset
SELECT tests.check('consent: on for the platform and site A — available on A only (not B, not without an address, not on a store)',
  format($$SELECT pg_temp.call(%1$L, NULL, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'true'::jsonb
              AND pg_temp.call(%2$L, NULL, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'false'::jsonb
              AND pg_temp.call(NULL, NULL, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'false'::jsonb
              AND pg_temp.call(%3$L, NULL, 'SELECT to_jsonb(hospitality.analytics_enabled())') = 'false'::jsonb$$,
         :'sa', :'sb', :'store'));

-- ============================================================
-- 3. recording
-- ============================================================
SELECT pg_temp.expect_error('consent: recording is refused while the public site is closed',
  pg_temp.record(:'sa', :CID_1, true, 'accept', '2026-11-10'), 'לא פתוח');
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %2$L)])$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
SELECT pg_temp.svc(:'sa', format('SELECT hospitality.site_consent_record(%L, true, ''accept'', ''2026-11-10'')', :CID_1)) ->> 'ok' AS ok1 \gset
SELECT pg_temp.svc(:'sa', format('SELECT hospitality.site_consent_record(%L, false, ''reject'', ''2026-11-10'')', :CID_2)) ->> 'ok' AS ok2 \gset
SELECT pg_temp.svc(:'sa', format('SELECT hospitality.site_consent_record(%L, false, ''withdraw'', ''2026-11-10'')', :CID_1)) ->> 'ok' AS ok3 \gset
SELECT tests.check('consent: the server records accept / reject / withdraw on A — for site A, with the version and the time',
  format($$SELECT %L = 'true' AND %L = 'true' AND %L = 'true'
             AND (SELECT count(*) FROM hospitality.consent_records WHERE tenant_id = %L) = 3
             AND EXISTS (SELECT 1 FROM hospitality.consent_records WHERE tenant_id = %L AND consent_id = %L
                            AND analytics AND action = 'accept' AND policy_version = '2026-11-10'
                            AND created_at > now() - interval '1 minute')
             AND EXISTS (SELECT 1 FROM hospitality.consent_records WHERE consent_id = %L AND action = 'withdraw' AND NOT analytics)$$,
         :'ok1', :'ok2', :'ok3', :'sa', :'sa', :CID_1, :CID_1));
SELECT pg_temp.expect_error('consent: B (analytics off for B) is refused — nothing to consent to there',
  pg_temp.record(:'sb', :CID_1, true, 'accept', '2026-11-10'), 'אין Cookies');
SELECT pg_temp.expect_error('consent: an "accept" without analytics is refused (inconsistent choice)',
  pg_temp.record(:'sa', :CID_1, false, 'accept', '2026-11-10'), 'לא תקינה');
SELECT pg_temp.expect_error('consent: a "reject" with analytics is refused (inconsistent choice)',
  pg_temp.record(:'sa', :CID_1, true, 'reject', '2026-11-10'), 'לא תקינה');
SELECT pg_temp.expect_error('consent: an unknown action is refused',
  pg_temp.record(:'sa', :CID_1, true, 'maybe', '2026-11-10'), 'לא תקינה');
SELECT pg_temp.expect_error('consent: a policy version that is not a date is refused',
  pg_temp.record(:'sa', :CID_1, true, 'save', 'v2<script>'), 'לא תקינה');
SELECT pg_temp.expect_error('consent: an anonymous visitor cannot record directly (only through the server)',
  format('SELECT pg_temp.call(%L, NULL, %L)', :'sa',
         format('SELECT to_jsonb(hospitality.site_consent_record(%L, true, ''accept'', ''2026-11-10''))', :CID_1)),
  'permission denied');
SELECT pg_temp.expect_error('consent: a signed-in user (even the owner) cannot record directly',
  format('SELECT pg_temp.call(%L, %L, %L)', :'sa', :OWNER_A,
         format('SELECT to_jsonb(hospitality.site_consent_record(%L, true, ''accept'', ''2026-11-10''))', :CID_1)),
  'permission denied');
SELECT pg_temp.expect_error('consent: the owner cannot read the records directly either',
  format('SELECT pg_temp.call(%L, %L, %L)', :'sa', :OWNER_A,
         'SELECT to_jsonb(count(*)) FROM hospitality.consent_records'),
  'permission denied');

-- retention: records older than 24 months are removed on the next record of the same site only
INSERT INTO hospitality.consent_records (tenant_id, consent_id, analytics, action, policy_version, created_at) VALUES
  (:'sa', :CID_2, true, 'accept', '2024-01-01', now() - interval '25 months'),
  (:'sb', :CID_2, true, 'accept', '2024-01-01', now() - interval '25 months');
SELECT pg_temp.svc(:'sa', format('SELECT hospitality.site_consent_record(%L, true, ''save'', ''2026-11-10'')', :CID_2)) ->> 'ok' AS ok4 \gset
SELECT tests.check('consent: kept 24 months — the old record of A is gone on its next record; B''s old record is untouched',
  format($$SELECT %L = 'true'
             AND NOT EXISTS (SELECT 1 FROM hospitality.consent_records WHERE tenant_id = %L AND created_at < now() - interval '24 months')
             AND (SELECT count(*) FROM hospitality.consent_records WHERE tenant_id = %L) = 4
             AND EXISTS (SELECT 1 FROM hospitality.consent_records WHERE tenant_id = %L AND created_at < now() - interval '24 months')$$,
         :'ok4', :'sa', :'sa', :'sb'));
SELECT tests.check('consent: Ecommerce stores and their settings unchanged',
  $$SELECT h = pg_temp.ecommerce_hash() FROM cons_ecommerce_before$$);

-- back to how it was for the files that run after this one (analytics off for the platform)
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_analytics_enabled', false),
       public.platform_set_flag('hospitality_backend_enabled', %L::boolean),
       public.platform_set_flag('hospitality_frontend_enabled', %L::boolean)])$$, :'be0', :'fe0')) IS NOT NULL AS ok \gset

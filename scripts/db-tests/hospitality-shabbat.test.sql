-- ============================================================
-- Hospitality — "מתחם שומר שבת" (20261108120000_hosp_shabbat.sql, migration 57)
--   • off by default (every existing and new business); only through settings_set_shabbat (settings
--     permission), not a direct column write; the action log records each change;
--   • the settings screen gets the value; the public site gets it in the business details;
--   • the settings form's revision does not move (an open form is not blocked).
-- ============================================================
-- hospitality-logo-brand.test.sql מריץ שוב את מיגרציה 42 (בדיקת אידמפוטנטיות) — וכך מחזיר את _site_payload
-- לגרסה שלה לשאר הקבצים. כאן — שוב 57 (אידמפוטנטית), כדי לבדוק את הגרסה האחרונה
SET client_min_messages = warning;
\ir ../../supabase/migrations/20261108120000_hosp_shabbat.sql
RESET client_min_messages;
\set OWNER_P '''a0000000-0000-0000-0000-000000057a01'''
\set OWNER_X '''a0000000-0000-0000-0000-000000057a03'''

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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000057a01', 'm57.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000057a03', 'm57.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m57-shabbat', 'צימרי השבת', 'm57.owner@test.local')$$) ->> 'id' AS sp \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m57-other', 'עסק אחר 57', 'm57.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sp', :OWNER_P, 'm57.owner@test.local', 'm57_owner', 'admin', true, 'דורית'),
  (:'sx', :OWNER_X, 'm57.other@test.local', 'm57_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sp', :'sx')) IS NOT NULL AS ok \gset
SELECT revision AS rev0 FROM hospitality.settings WHERE tenant_id = :'sp' \gset

SELECT tests.check('shabbat (57): off by default; the settings screen and the public site get the value',
  format($$SELECT NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.settings_view()') -> 'values' ->> 'shabbat_observant')::boolean
             AND hospitality._site_payload(%1$L) -> 'business' -> 'shabbat_observant' = 'false'::jsonb
             AND NOT EXISTS (SELECT 1 FROM hospitality.settings WHERE shabbat_observant)$$, :'sp', :OWNER_P));
SELECT tests.check('shabbat (57): only through the function — no direct write, guests and other businesses refused',
  format($$SELECT NOT has_column_privilege('authenticated', 'hospitality.settings', 'shabbat_observant', 'UPDATE')
             AND NOT has_function_privilege('anon', 'hospitality.settings_set_shabbat(boolean)', 'EXECUTE')
             AND pg_temp.err_of(%1$L, NULL, 'SELECT hospitality.settings_set_shabbat(true)') LIKE '%%permission denied%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.settings_set_shabbat(true)') LIKE '%%אין הרשאה%%'
             AND pg_temp.err_of(%1$L, %3$L, 'SELECT hospitality.settings_set_shabbat(NULL)') LIKE '%%לא תקין%%'$$,
         :'sp', :OWNER_X, :OWNER_P));
SELECT pg_temp.call(:'sp', :OWNER_P, 'SELECT hospitality.settings_set_shabbat(true)') AS v1 \gset
SELECT pg_temp.call(:'sp', :OWNER_P, 'SELECT hospitality.settings_set_shabbat(true)') AS v2 \gset
SELECT tests.check('shabbat (57): turned on — saved, shown on the site, logged once (a repeat changes nothing); the form revision unchanged',
  format($$SELECT (%1$L::jsonb -> 'values' ->> 'shabbat_observant')::boolean
             AND hospitality._site_payload(%2$L) -> 'business' -> 'shabbat_observant' = 'true'::jsonb
             AND hospitality._site_payload(%3$L) -> 'business' -> 'shabbat_observant' = 'false'::jsonb
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %2$L AND action = 'settings.shabbat_on') = 1
             AND (SELECT revision FROM hospitality.settings WHERE tenant_id = %2$L) = %4$s
             AND (%5$L::jsonb ->> 'revision')::int = %4$s$$, :'v1', :'sp', :'sx', :rev0, :'v2'));
SELECT pg_temp.call(:'sp', :OWNER_P, 'SELECT hospitality.settings_set_shabbat(false)') AS v3 \gset
SELECT tests.check('shabbat (57): turned off — nothing on the site again, logged',
  format($$SELECT NOT (%1$L::jsonb -> 'values' ->> 'shabbat_observant')::boolean
             AND hospitality._site_payload(%2$L) -> 'business' -> 'shabbat_observant' = 'false'::jsonb
             AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %2$L AND action = 'settings.shabbat_off')$$,
         :'v3', :'sp'));

SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

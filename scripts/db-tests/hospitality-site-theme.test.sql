-- ============================================================
-- Hospitality D2 (migration 26): the site's theme when a business is opened
--   admin_site_theme — platform admin only; creates the first draft in the chosen theme;
--   never touches a design the business already has; logged in the platform audit log.
-- ============================================================
\set OWNER_T '''a0000000-0000-0000-0000-000000000ba1'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
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
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000ba1', 'd2.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
  $$SELECT hospitality.admin_open_site('d2-theme-a', 'עסק עם ערכה', 'd2.owner@test.local')$$) ->> 'id' AS ta \gset
SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
  $$SELECT hospitality.admin_open_site('d2-theme-b', 'עסק עם עיצוב', 'd2.owner@test.local')$$) ->> 'id' AS tb \gset

SELECT pg_temp.expect_error('site theme: a business owner cannot set it (platform admin only)',
  format($$SELECT pg_temp.as_user(%L, format('SELECT hospitality.admin_site_theme(%%L, ''nature'')', %L))$$, :OWNER_T, :'ta'),
  'רק מנהל הפלטפורמה');
SELECT pg_temp.expect_error('site theme: anonymous visitors cannot call it',
  format($$SELECT pg_temp.as_user(NULL, format('SELECT hospitality.admin_site_theme(%%L, ''nature'')', %L))$$, :'ta'),
  'permission denied');
SELECT pg_temp.expect_error('site theme: an unknown theme is refused',
  format($$SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0', format('SELECT hospitality.admin_site_theme(%%L, ''neon'')', %L))$$, :'ta'),
  'ערכת עיצוב לא מוכרת');
SELECT pg_temp.expect_error('site theme: a store (Ecommerce) is refused',
  $$SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
      format('SELECT hospitality.admin_site_theme(%L, ''nature'')', (SELECT id FROM public.tenants WHERE site_type = 'ecommerce' LIMIT 1)))$$,
  'האתר לא נמצא');

SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
  format('SELECT hospitality.admin_site_theme(%L, ''romantic'')', :'ta')) ->> 'status' AS first_status \gset
SELECT tests.check('site theme: the first draft is created in the chosen theme, with every section to come from the business data',
  format($$SELECT %L = 'set'
          AND (SELECT theme = 'romantic' AND kind = 'draft' AND version = 0 AND revision = 1
                      AND document ->> 'theme' = 'romantic' AND document -> 'sections' = '[]'::jsonb
                 FROM hospitality.site_versions WHERE tenant_id = %L)$$, :'first_status', :'ta'));
SELECT tests.check('site theme: logged in the platform audit log',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %L AND action = 'hosp_site_theme'
                           AND details ->> 'theme' = 'romantic')$$, :'ta'));
SELECT tests.check('site theme: a second call keeps the existing draft (the business owns its design)',
  format($$SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
             format('SELECT hospitality.admin_site_theme(%%L, ''modern'')', %1$L)) ->> 'status' = 'kept'
          AND (SELECT theme FROM hospitality.site_versions WHERE tenant_id = %1$L) = 'romantic'$$, :'ta'));
-- a business that already designed its site (a draft of its own)
INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document)
VALUES (:'tb', 'draft', 0, 'nature', '{"v": 1, "theme": "nature", "colors": {}, "sections": []}');
SELECT tests.check('site theme: a business with a design of its own is never changed',
  format($$SELECT pg_temp.as_user('a0000000-0000-0000-0000-0000000000f0',
             format('SELECT hospitality.admin_site_theme(%%L, ''luxury'')', %1$L)) ->> 'status' = 'kept'
          AND (SELECT count(*) = 1 AND bool_and(theme = 'nature') FROM hospitality.site_versions WHERE tenant_id = %1$L)$$, :'tb'));
SELECT tests.check('site theme: the function has a fixed search_path and is closed to anon',
  $$SELECT 'search_path=""' = ANY (proconfig) AND prosecdef
           AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      FROM pg_proc WHERE oid = 'hospitality.admin_site_theme(uuid, text)'::regprocedure$$);

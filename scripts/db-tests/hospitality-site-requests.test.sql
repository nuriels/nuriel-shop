-- ============================================================
-- Hospitality: requests for a zimmer site from the platform portal (stage E2 —
-- 20261104110000_hosp_site_requests.sql)
--   submit: server only, input rules, published plans only, 3 per email a day, platform
--   admin emails returned for the notification; panel: list + status (platform admin only, audited)
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.err_of(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;

-- ---------- structure ----------
SELECT tests.check('site requests: no API access to the table (functions only), RLS on',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.site_requests', p))
       AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.site_requests'::regclass)
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.run('site requests: guests cannot submit directly',
  $$SELECT hospitality.site_request_submit('x@test.local', '{}')$$, NULL, 'permission denied');
SELECT tests.run('site requests: signed-in users cannot submit directly (server only)',
  $$SELECT hospitality.site_request_submit('x@test.local', '{}')$$, 'a0000000-0000-0000-0000-0000000000a1', 'permission denied');

-- ---------- input ----------
SELECT tests.check('submit: business name required',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"א","phone":"0501234567"}')$q$) LIKE '%שם העסק%'$$);
SELECT tests.check('submit: phone required',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"צימר הגליל","phone":"12"}')$q$) LIKE '%טלפון%'$$);
SELECT tests.check('submit: units 1-500',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"צימר הגליל","phone":"0501234567","units":0}')$q$) LIKE '%יחידות%'$$);
SELECT tests.check('submit: only a published plan',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"צימר הגליל","phone":"0501234567","plan_code":"enterprise"}')$q$) LIKE '%חבילה%'$$);
SELECT tests.check('submit: invalid email',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('not-an-email', '{"business_name":"צימר הגליל","phone":"0501234567"}')$q$) LIKE '%אימייל%'$$);
SELECT tests.check('submit: nothing was stored by the rejected attempts',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.site_requests WHERE email = 'zim.e2@test.local')$$);

-- ---------- a valid request ----------
SELECT tests.check('submit: a valid request is stored, cleaned, and returns the platform admin emails',
  $$SELECT r ->> 'status' = 'new' AND r ->> 'business_name' = 'צימר הגליל' AND r ->> 'phone' = '0501234567'
       AND (r ->> 'units')::integer = 3 AND r ->> 'plan_code' = 'premium' AND r ->> 'plan_name' = 'פרימיום'
       AND r ->> 'email' = 'zim.e2@test.local' AND r ->> 'area' = 'גליל עליון'
       AND r -> 'notify' ? 'platform@test.local'
      FROM (SELECT hospitality.site_request_submit(' Zim.E2@test.local ',
              '{"business_name":"  צימר   הגליל ","phone":"050-123 4567","units":3,"plan_code":"premium","area":" גליל  עליון ","message":"מתי אפשר להתחיל?"}') AS r) x$$);
SELECT tests.check('submit: a second and third request the same day are fine',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"צימר הגליל","phone":"0501234567"}')$q$) IS NULL
       AND pg_temp.err_of($q$SELECT hospitality.site_request_submit('zim.e2@test.local', '{"business_name":"צימר הגליל","phone":"0501234567"}')$q$) IS NULL$$);
SELECT tests.check('submit: the fourth within a day is refused politely',
  $$SELECT pg_temp.err_of($q$SELECT hospitality.site_request_submit('ZIM.E2@test.local', '{"business_name":"צימר הגליל","phone":"0501234567"}')$q$) LIKE '%נחזור אליכם%'$$);

-- ---------- the panel ----------
SELECT tests.check('panel: a store owner cannot list the requests',
  $$SELECT pg_temp.err_of($q$SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true),
                                   hospitality.admin_site_requests()$q$) LIKE '%מנהל הפלטפורמה%'$$);
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT tests.check('panel: the platform admin sees the requests, new first',
  $$SELECT jsonb_array_length(l) >= 3 AND l -> 0 ->> 'status' = 'new'
      FROM (SELECT pg_temp.as_platform('SELECT hospitality.admin_site_requests()') AS l) x$$);
SELECT id AS rq FROM hospitality.site_requests WHERE email = 'zim.e2@test.local' ORDER BY created_at LIMIT 1 \gset
SELECT tests.check('panel: marking a request handled (with a note)',
  format($$SELECT r ->> 'status' = 'handled' AND r ->> 'admin_note' = 'נפתח האתר' AND r ->> 'handled_at' IS NOT NULL
            FROM (SELECT pg_temp.as_platform(format('SELECT hospitality.admin_site_request_set(%%L, %%L, %%L)', %1$L, 'handled', ' נפתח האתר ')) AS r) x$$, :'rq'));
SELECT tests.check('panel: … recorded in the platform log',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'hosp_site_request_set'
                           AND details ->> 'id' = %L AND details ->> 'status' = 'handled'
                           AND actor_id = 'a0000000-0000-0000-0000-0000000000f0')$$, :'rq'));
SELECT tests.check('panel: back to new clears the handling stamp',
  format($$SELECT r ->> 'status' = 'new' AND r ->> 'handled_at' IS NULL
            FROM (SELECT pg_temp.as_platform(format('SELECT hospitality.admin_site_request_set(%%L, %%L)', %L, 'new')) AS r) x$$, :'rq'));
SELECT tests.check('panel: unknown status / request refused',
  format($$SELECT pg_temp.err_of(format('SELECT pg_temp.as_platform(%%L)', format('SELECT hospitality.admin_site_request_set(%%L, %%L)', %L, 'done'))) LIKE '%%מצב%%'
          AND pg_temp.err_of(format('SELECT pg_temp.as_platform(%%L)', format('SELECT hospitality.admin_site_request_set(%%L, %%L)', gen_random_uuid(), 'new'))) LIKE '%%לא נמצאה%%'$$, :'rq'));

-- cleanup (other files and the rollback check expect no requests)
DELETE FROM hospitality.site_requests WHERE email = 'zim.e2@test.local';

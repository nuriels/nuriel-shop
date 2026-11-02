-- ============================================================
-- Hospitality — opening a zimmer business from the portal (migration 40 —
-- 20261105170000_hosp_portal_open.sql)
--   • server only; new businesses get a 30-day trial;
--   • refusals (no account, platform admin, a store customer, a taken / bad address, bad details, the
--     daily request limit) leave nothing behind;
--   • one transaction: the request (the platform calls back) + the business (settings, policy, trial,
--     management flags) + the owner + the link request → business + the platform log;
--   • the site opens when the owner publishes — only a portal business, only while the platform has
--     not decided about its site; the setup guide and the editor say so (opens_on_publish);
--   • the panel sees the opened business on the request.
-- ============================================================
\set PO_OWNER '''a0000000-0000-0000-0000-000000040a01'''
\set PO_CUSTOMER '''a0000000-0000-0000-0000-000000040a02'''
\set PO_SECOND '''a0000000-0000-0000-0000-000000040a03'''
\set PO_PANEL '''a0000000-0000-0000-0000-000000040a04'''
\set PO_REQ '''{"business_name":"  צימר   הכרם ","phone":"050-765 4321","units":2,"plan_code":"basic","area":" הגליל ","message":"נשמח לעזרה"}'''

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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- an error of a server call (the server = service role; here — the database owner)
CREATE OR REPLACE FUNCTION pg_temp.srv_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;
-- the owner publishes the draft (saves one first if there is none)
CREATE OR REPLACE FUNCTION pg_temp.publish(_site text, _uid uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE e jsonb; d jsonb;
BEGIN
  e := pg_temp.call(_site, _uid, 'SELECT hospitality.site_editor()');
  IF e -> 'draft' = 'null'::jsonb OR e -> 'draft' IS NULL THEN
    d := pg_temp.call(_site, _uid, $q$SELECT hospitality.site_draft_save(0, 'luxury',
           '{"v":1,"theme":"luxury","colors":{},"sections":[]}'::jsonb)$q$);
  ELSE
    d := e -> 'draft';
  END IF;
  RETURN pg_temp.call(_site, _uid, format('SELECT hospitality.site_publish(%s)', d ->> 'revision'));
END $f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000040a01', 'm40.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000040a02', 'm40.customer@test.local', now()),
  ('a0000000-0000-0000-0000-000000040a03', 'm40.second@test.local', now()),
  ('a0000000-0000-0000-0000-000000040a04', 'm40.panel@test.local', now())
ON CONFLICT DO NOTHING;
-- a customer of store A (cannot become a business owner)
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('70000000-0000-0000-0000-00000000000a', :PO_CUSTOMER, 'm40.customer@test.local', 'm40_customer', 'customer', true);
-- the engine is on in the platform (as on the server); the public sites too — restored at the end
CREATE TEMP TABLE m40_flags AS
  SELECT key, enabled FROM public.platform_feature_flags
   WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_frontend_enabled');
UPDATE public.platform_feature_flags SET enabled = true
 WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_frontend_enabled');

-- ============================================================
-- 1. Server only; 30 days of trial
-- ============================================================
SELECT tests.run('portal open: guests cannot open a business directly',
  $$SELECT hospitality.portal_open_site('x@test.local', 'x-site', '{}')$$, NULL, 'permission denied');
SELECT tests.run('portal open: signed-in users cannot open a business directly (server only)',
  $$SELECT hospitality.portal_open_site('x@test.local', 'x-site', '{}')$$, 'a0000000-0000-0000-0000-0000000000a1', 'permission denied');
SELECT tests.run('portal open: the trial length is for the server only too',
  $$SELECT hospitality.portal_trial_days()$$, NULL, 'permission denied');
SELECT tests.check('portal open: the server may call both; the helpers and the trigger function are closed to the API',
  $$SELECT has_function_privilege('service_role', 'hospitality.portal_open_site(text,text,jsonb)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.portal_trial_days()', 'EXECUTE')
       AND NOT bool_or(has_function_privilege(r, f, 'EXECUTE'))
      FROM unnest(ARRAY['anon', 'authenticated']) r,
           unnest(ARRAY['hospitality._portal_opened(uuid)', 'hospitality._opens_on_publish(uuid)',
                        'hospitality.site_versions_portal_open()', 'hospitality.portal_open_site(text,text,jsonb)',
                        'hospitality.portal_trial_days()']) f$$);
SELECT tests.check('trial: a new business gets 30 days (the trial plan; stores keep their own 14)',
  $$SELECT hospitality.portal_trial_days() = 30
       AND (SELECT trial_days FROM hospitality.plans WHERE code = 'trial') = 30$$);

-- ============================================================
-- 2. Refusals — nothing is left behind
-- ============================================================
SELECT tests.check('refused: an email without an account (the server opens the account first)',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.nobody@test.local', 'm40-nobody', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%החשבון לא נמצא%'$$);
SELECT tests.check('refused: the platform admin''s own account',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('platform@test.local', 'm40-platform', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%מנהל הפלטפורמה%'$$);
SELECT tests.check('refused: an email registered as a customer of a store',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.customer@test.local', 'm40-customer', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%לקוח בחנות אחרת%'$$);
SELECT tests.check('refused: a taken address',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', 'store-a', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%תפוסה%'$$);
SELECT tests.check('refused: a reserved / malformed address',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', 'admin', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%שמורה%'
       AND pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', '-x', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%3-63 תווים%'$$);
SELECT tests.check('refused: bad details (the request rules — phone, name)',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', 'm40-bad', '{"business_name":"צימר","phone":"12"}')$q$) LIKE '%טלפון%'
       AND pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', 'm40-bad', '{"business_name":"א","phone":"0501234567"}')$q$) LIKE '%שם העסק%'$$);
SELECT tests.check('refused attempts: no request, no business, no role, no log entry',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.site_requests
                        WHERE email IN ('m40.owner@test.local', 'm40.nobody@test.local', 'platform@test.local', 'm40.customer@test.local'))
       AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug IN ('m40-nobody', 'm40-platform', 'm40-customer', 'm40-bad'))
       AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = 'a0000000-0000-0000-0000-000000040a01')
       AND NOT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'hosp_site_opened' AND details ->> 'source' = 'portal')$$);

-- ============================================================
-- 3. Opening — one transaction
-- ============================================================
SELECT r -> 'tenant' ->> 'id' AS pt, r -> 'request' ->> 'id' AS prq, r::text AS pr
  FROM (SELECT hospitality.portal_open_site(' M40.Owner@test.local ', ' M40-Zimmer ', :PO_REQ) AS r) x \gset
SELECT tests.check('open: the answer — the business (address, name), the trial end and the request with the platform emails',
  format($$SELECT r -> 'tenant' ->> 'slug' = 'm40-zimmer' AND r -> 'tenant' ->> 'name' = 'צימר הכרם'
             AND (r ->> 'trial_ends_at')::timestamptz BETWEEN now() + interval '30 days' - interval '1 minute'
                                                         AND now() + interval '30 days' + interval '1 minute'
             AND r -> 'request' ->> 'plan_code' = 'basic' AND r -> 'request' ->> 'phone' = '0507654321'
             AND r -> 'request' -> 'notify' ? 'platform@test.local'
            FROM (SELECT %L::jsonb AS r) x$$, :'pr'));
SELECT tests.check('open: a hospitality business with the owner''s email; the shared settings are seeded',
  format($$SELECT t.site_type = 'hospitality' AND t.owner_email = 'm40.owner@test.local' AND t.status = 'active'
             AND EXISTS (SELECT 1 FROM public.site_settings s WHERE s.tenant_id = t.id)
             AND EXISTS (SELECT 1 FROM public.email_settings s WHERE s.tenant_id = t.id)
            FROM public.tenants t WHERE t.id = %L$$, :'pt'));
SELECT tests.check('open: the business details — name, email and phone from the portal; the first policy (flexible)',
  format($$SELECT s.business_name = 'צימר הכרם' AND s.contact_email = 'm40.owner@test.local' AND s.contact_phone = '0507654321'
             AND EXISTS (SELECT 1 FROM hospitality.policies p WHERE p.tenant_id = s.tenant_id AND p.is_default AND p.name = 'גמישה')
            FROM hospitality.settings s WHERE s.tenant_id = %L$$, :'pt'));
SELECT tests.check('open: a 30-day trial, active',
  format($$SELECT s.plan_code = 'trial' AND s.status = 'trialing'
             AND s.trial_ends_at BETWEEN now() + interval '30 days' - interval '1 minute' AND now() + interval '30 days' + interval '1 minute'
             AND (hospitality.entitlements(s.tenant_id) ->> 'active')::boolean
            FROM hospitality.subscriptions s WHERE s.tenant_id = %L$$, :'pt'));
SELECT tests.check('open: the database and the management area are on for the business; the public site and bookings wait for publishing',
  format($$SELECT (SELECT count(*) FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L AND f.enabled
                    AND f.key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')) = 2
             AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L
                              AND f.key IN ('hospitality_frontend_enabled', 'hospitality_booking_enabled'))
             AND NOT hospitality.flag_for('hospitality_frontend_enabled', %1$L)$$, :'pt'));
SELECT tests.check('open: the owner — a protected, approved admin of the business (exactly one role)',
  format($$SELECT count(*) = 1 AND bool_and(ur.role = 'admin' AND ur.is_protected AND ur.is_approved AND NOT ur.is_blocked
                                       AND ur.email = 'm40.owner@test.local')
            FROM public.user_roles ur WHERE ur.tenant_id = %L AND ur.user_id = %L$$, :'pt', :PO_OWNER));
SELECT tests.check('open: the request is kept for the call back (still new) and linked to the business',
  format($$SELECT r.status = 'new' AND r.opened_tenant_id = %L AND r.opened_at IS NOT NULL
             AND r.business_name = 'צימר הכרם' AND r.area = 'הגליל' AND r.units = 2
            FROM hospitality.site_requests r WHERE r.id = %L$$, :'pt', :'prq'));
SELECT tests.check('open: recorded in the platform log (from the portal, by the owner, with the request)',
  format($$SELECT EXISTS (SELECT 1 FROM public.platform_audit_log a
                           WHERE a.tenant_id = %L AND a.action = 'hosp_site_opened' AND a.actor_id = %L
                             AND a.details ->> 'source' = 'portal' AND a.details ->> 'request' = %L
                             AND a.details ->> 'plan' = 'trial' AND a.details ->> 'owner' NOT LIKE 'm40.owner%%')$$,
         :'pt', :PO_OWNER, :'prq'));
SELECT tests.check('open: the portal lists the business for the owner, and the way in (portal_store_state) works',
  format($$SELECT (SELECT bool_or(s ->> 'id' = %1$L) FROM jsonb_array_elements(public.portal_account('m40.owner@test.local') -> 'stores') s)
             AND public.portal_store_state('m40.owner@test.local', %1$L) ->> 'slug' = 'm40-zimmer'$$, :'pt'));

-- ============================================================
-- 4. The owner works in the management area; the guide and the editor say the site opens on publish
-- ============================================================
SELECT tests.check('owner: the setup guide — details and contact done from the portal; "opens when you publish"',
  format($$SELECT (g -> 'steps' -> 'details' ->> 'done')::boolean AND (g -> 'steps' -> 'contact' ->> 'phone')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'published')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'site_open')::boolean
             AND (g -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean
            FROM (SELECT pg_temp.call(%L, %L, 'SELECT hospitality.setup_guide()') AS g) x$$, :'pt', :PO_OWNER));
SELECT tests.check('owner: saving a guide step answers with the same flag',
  format($$SELECT (pg_temp.call(%L, %L, $q$SELECT hospitality.setup_save('units', 'visit')$q$)
             -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean$$, :'pt', :PO_OWNER));
SELECT tests.check('owner: the site editor — closed for now, opens on publish',
  format($$SELECT NOT (e ->> 'site_open')::boolean AND (e ->> 'opens_on_publish')::boolean
            FROM (SELECT pg_temp.call(%L, %L, 'SELECT hospitality.site_editor()') AS e) x$$, :'pt', :PO_OWNER));

-- ============================================================
-- 5. Publishing opens the site and bookings — once
-- ============================================================
SELECT pg_temp.publish(:'pt', :PO_OWNER) IS NOT NULL AS ok \gset
SELECT tests.check('publish: the public site and bookings are on for the business',
  format($$SELECT (SELECT count(*) FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L AND f.enabled
                    AND f.updated_by = %2$L
                    AND f.key IN ('hospitality_frontend_enabled', 'hospitality_booking_enabled')) = 2
             AND hospitality.flag_for('hospitality_frontend_enabled', %1$L)$$, :'pt', :PO_OWNER));
SELECT tests.check('publish: recorded in the platform log once',
  format($$SELECT count(*) = 1 FROM public.platform_audit_log
            WHERE tenant_id = %L AND action = 'hosp_site_opened_on_publish' AND (details ->> 'flags')::integer = 2$$, :'pt'));
SELECT tests.check('publish: the guide now says the site is open (and no longer "opens on publish")',
  format($$SELECT (g -> 'steps' -> 'publish' ->> 'published')::boolean AND (g -> 'steps' -> 'publish' ->> 'site_open')::boolean
             AND NOT (g -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean
            FROM (SELECT pg_temp.call(%L, %L, 'SELECT hospitality.setup_guide()') AS g) x$$, :'pt', :PO_OWNER));

-- the platform closes the site; the owner publishes again → stays closed, nothing new in the log
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_frontend_enabled', false, %L))$$, :'pt')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'pt', :PO_OWNER, $q$SELECT hospitality.site_draft_save(
         (hospitality.site_editor() -> 'draft' ->> 'revision')::integer, 'nature',
         '{"v":1,"theme":"nature","colors":{},"sections":[]}'::jsonb)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.publish(:'pt', :PO_OWNER) IS NOT NULL AS ok \gset
SELECT tests.check('platform decision kept: after the platform closed the site, another publish leaves it closed',
  format($$SELECT NOT (SELECT f.enabled FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L AND f.key = 'hospitality_frontend_enabled')
             AND (SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'hosp_site_opened_on_publish') = 1
             AND (SELECT count(*) FROM hospitality.site_versions WHERE tenant_id = %1$L AND kind = 'published') = 2
             AND NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.site_editor()') ->> 'opens_on_publish')::boolean$$,
         :'pt', :PO_OWNER));

-- a second portal business, closed by the platform before its first publish → stays closed
SELECT r -> 'tenant' ->> 'id' AS pt2
  FROM (SELECT hospitality.portal_open_site('m40.second@test.local', 'm40-second',
          '{"business_name":"בקתות השקד","phone":"0521112222"}') AS r) x \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_frontend_enabled', false, %L))$$, :'pt2')) IS NOT NULL AS ok \gset
SELECT tests.check('platform decision kept: a business the platform closed before publishing — the guide does not promise opening',
  format($$SELECT NOT (pg_temp.call(%L, %L, 'SELECT hospitality.setup_guide()') -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean$$,
         :'pt2', :PO_SECOND));
SELECT pg_temp.publish(:'pt2', :PO_SECOND) IS NOT NULL AS ok \gset
SELECT tests.check('platform decision kept: … and its first publish opens nothing (no booking flag either)',
  format($$SELECT NOT (SELECT f.enabled FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L AND f.key = 'hospitality_frontend_enabled')
             AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L AND f.key = 'hospitality_booking_enabled')
             AND NOT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = %1$L AND action = 'hosp_site_opened_on_publish')$$,
         :'pt2'));

-- a business opened from the panel (not from the portal): publishing does not open it
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m40-panel', 'צימר מהפאנל', 'm40.panel@test.local')$$) ->> 'id' AS pp \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm40.panel@test.local')$$, :'pp')) IS NOT NULL AS ok \gset
SELECT tests.check('panel business: the guide keeps "the Nuriel team opens it" (no opens_on_publish)',
  format($$SELECT NOT (pg_temp.call(%L, %L, 'SELECT hospitality.setup_guide()') -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean$$,
         :'pp', :PO_PANEL));
SELECT pg_temp.publish(:'pp', :PO_PANEL) IS NOT NULL AS ok \gset
SELECT tests.check('panel business: publishing does not open the site (the platform decides, as before)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags f WHERE f.tenant_id = %1$L
                               AND f.key IN ('hospitality_frontend_enabled', 'hospitality_booking_enabled'))
             AND EXISTS (SELECT 1 FROM hospitality.site_versions WHERE tenant_id = %1$L AND kind = 'published')$$, :'pp'));

-- the platform switch for public sites is off → no promise in the guide
UPDATE public.platform_feature_flags SET enabled = false WHERE key = 'hospitality_frontend_enabled';
SELECT r -> 'tenant' ->> 'id' AS pt3
  FROM (SELECT hospitality.portal_open_site('m40.second@test.local', 'm40-third',
          '{"business_name":"בקתות השקד 2","phone":"0521112222"}') AS r) x \gset
SELECT tests.check('platform switch off: the guide does not promise opening (public sites are closed in the platform)',
  format($$SELECT NOT (pg_temp.call(%L, %L, 'SELECT hospitality.setup_guide()') -> 'steps' -> 'publish' ->> 'opens_on_publish')::boolean$$,
         :'pt3', :PO_SECOND));
UPDATE public.platform_feature_flags SET enabled = true WHERE key = 'hospitality_frontend_enabled';

-- ============================================================
-- 6. The daily limit counts openings; the panel sees the opened business
-- ============================================================
SELECT hospitality.site_request_submit('m40.owner@test.local', '{"business_name":"צימר הכרם","phone":"0507654321"}') IS NOT NULL AS ok \gset
SELECT hospitality.site_request_submit('m40.owner@test.local', '{"business_name":"צימר הכרם","phone":"0507654321"}') IS NOT NULL AS ok \gset
SELECT tests.check('limit: a fourth opening / request in a day is refused politely — and no business is created',
  $$SELECT pg_temp.srv_err($q$SELECT hospitality.portal_open_site('m40.owner@test.local', 'm40-fourth', '{"business_name":"צימר","phone":"0501234567"}')$q$) LIKE '%נחזור אליכם%'
       AND NOT EXISTS (SELECT 1 FROM public.tenants WHERE slug = 'm40-fourth')
       AND (SELECT count(*) FROM hospitality.site_requests WHERE email = 'm40.owner@test.local') = 3$$);
SELECT tests.check('panel: the request shows the opened business (address and time); a plain request shows none',
  format($$SELECT (SELECT bool_and(CASE WHEN r ->> 'id' = %L
                                         THEN r ->> 'opened_slug' = 'm40-zimmer' AND r ->> 'opened_at' IS NOT NULL
                                              AND r ->> 'opened_tenant_id' IS NOT NULL
                                         ELSE r -> 'opened_slug' = 'null'::jsonb AND r -> 'opened_at' = 'null'::jsonb END)
                     FROM jsonb_array_elements(pg_temp.as_platform('SELECT hospitality.admin_site_requests()')) r
                    WHERE r ->> 'email' = 'm40.owner@test.local')$$, :'prq'));

-- ---------- cleanup (the businesses stay — like the other files; the requests go) ----------
DELETE FROM hospitality.site_requests WHERE email IN ('m40.owner@test.local', 'm40.second@test.local');
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m40_flags m WHERE f.key = m.key;
DROP TABLE m40_flags;

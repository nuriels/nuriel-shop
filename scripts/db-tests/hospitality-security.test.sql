-- ============================================================
-- Hospitality D1 (migration 25): security before opening the public site
--   1. shared rate counters (rate_check / rate_sweep): semantics (migration 36: a refused attempt
--      is not counted anywhere), server only, no raw data
--   2. function coverage — runs on every function, including future ones: every API-callable
--      function has a tenant / permission guard; booking requests only from the app server;
--      the anon allowlist; DEFINER functions with a fixed search_path
--   3. cross-tenant matrix: the owner of A cannot read or change any object of B (bookings,
--      payments, channels, room types, media, guests, emails, catalog) — on A's host or on B's
--   4. permission matrix: platform admin / owner / manager / signed-up account / anonymous
--   5. data exposure: the public site and the guest calls return no internal or personal fields
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set OWNER_A '''a0000000-0000-0000-0000-0000000009a1'''
\set MGR_A '''a0000000-0000-0000-0000-0000000009a2'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000009b1'''
\set ACCOUNT '''a0000000-0000-0000-0000-0000000009c1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
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
-- the application server (service role) — booking requests and the system functions
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site,
    'user-agent', 'db-test', 'x-forwarded-for', '203.0.113.7')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
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
-- refused for a reason of access (not found in this business / no permission) — never a success,
-- and never an unrelated error (a typo in the test would otherwise "pass")
CREATE OR REPLACE FUNCTION pg_temp.denied(_name text, _sql text) RETURNS void LANGUAGE plpgsql AS $f$
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
  VALUES (_name, err IS NOT NULL AND err ~ '(לא נמצא|אין הרשאה|permission denied|אינו פעיל|רק בעל העסק|רק מנהל הפלטפורמה)',
          COALESCE('ERROR: ' || err, 'no error — the call succeeded'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.add_admin(_site uuid, _uid uuid, _name text) RETURNS jsonb LANGUAGE sql AS $f$
  INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
  VALUES (_site, _uid, _name || '@test.local', _name, 'admin', true) RETURNING to_jsonb(true);
$f$;
-- a site request (quote, then the request) — through the app server
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _unit uuid, _in date, _out date, _email text, _phone text, _key text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', _unit, _in, _out));
  RETURN pg_temp.srv(_site, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L)',
    _unit, _in, _out, 'אורחת בדיקה', _email, _phone, _key, q ->> 'policy_hash'));
END $f$;

-- ============================================================
-- fixtures: two businesses, A (owner + manager) and B (owner), each with an active unit
-- ============================================================
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000009a1', 'd1.owner.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009a2', 'd1.mgr.a@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009b1', 'd1.owner.b@test.local', now()),
  ('a0000000-0000-0000-0000-0000000009c1', 'd1.account@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('d1-sec-a', 'עסק A'))$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT to_jsonb(hospitality.admin_create_site('d1-sec-b', 'עסק B'))$$) IS NOT NULL AS ok \gset
SELECT id AS sa FROM public.tenants WHERE slug = 'd1-sec-a' \gset
SELECT id AS sb FROM public.tenants WHERE slug = 'd1-sec-b' \gset
SELECT pg_temp.add_admin(:'sa', :OWNER_A, 'd1_owner_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sa', :MGR_A, 'd1_mgr_a') IS NOT NULL AS ok \gset
SELECT pg_temp.add_admin(:'sb', :OWNER_B, 'd1_owner_b') IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(
       public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true)
   AND public.platform_set_flag('hospitality_frontend_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_booking_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_frontend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_booking_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_frontend_enabled', true, %2$L))$$, :'sa', :'sb')) IS NOT NULL AS ok \gset

\set PA '''7d100000-0000-0000-0000-0000000000a1'''
\set PB '''7d100000-0000-0000-0000-0000000000b1'''
\set UA '''7d110000-0000-0000-0000-0000000000a1'''
\set UB '''7d110000-0000-0000-0000-0000000000b1'''
\set CB '''7d120000-0000-0000-0000-0000000000b1'''
\set MB '''7d130000-0000-0000-0000-0000000000b1'''
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:PA, :'sa', 'מתחם A', 'd1-pa', 'active'), (:PB, :'sb', 'מתחם B', 'd1-pb', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:UA, :'sa', :PA, 'unit', 'יחידה A', 'd1-ua', 4, 2, 500),
  (:UB, :'sb', :PB, 'unit', 'יחידה B', 'd1-ub', 4, 2, 700);
INSERT INTO hospitality.unit_categories (id, tenant_id, property_id, name, slug) VALUES (:CB, :'sb', :PB, 'סוג B', 'd1-cb');
UPDATE hospitality.units SET category_id = :CB WHERE id = :UB;
INSERT INTO hospitality.media (id, tenant_id, owner_kind, kind, storage_path)
VALUES (:MB, :'sb', 'site', 'image', :'sb' || '/d1-cover.webp');

-- B: a booking (approved), a payment, a channel calendar, an export feed
SELECT pg_temp.req(:'sb', :UB, pg_temp.d(40), pg_temp.d(42), 'd1.guest.b@example.com', '0521119999', 'd1-key-b-0001') AS rb \gset
SELECT (:'rb'::jsonb) ->> 'booking_id' AS bb, (:'rb'::jsonb) ->> 'manage_token' AS tb \gset
SELECT guest_id AS gb FROM hospitality.bookings WHERE id = :'bb' \gset
SELECT pg_temp.call(:'sb', :OWNER_B, format('SELECT to_jsonb(hospitality.approve_booking(%L))', :'bb')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sb', :OWNER_B, format($$SELECT hospitality.payment_record(%L, 'deposit', 'transfer', 200, current_date, 'd1')$$, :'bb')) IS NOT NULL AS ok \gset
SELECT id AS payb FROM hospitality.payments WHERE booking_id = :'bb' \gset
SELECT pg_temp.call(:'sb', :OWNER_B, format($$SELECT to_jsonb(hospitality.channel_calendar_add(%L, 'airbnb', 'https://www.airbnb.com/calendar/ical/d1.ics?s=x'))$$, :UB)) IS NOT NULL AS ok \gset
SELECT id AS calb FROM hospitality.channel_calendars WHERE tenant_id = :'sb' \gset
SELECT pg_temp.call(:'sb', :OWNER_B, format('SELECT to_jsonb(hospitality.channel_feed_token(%L))', :UB)) #>> '{}' AS feedb \gset
SELECT id AS nb FROM hospitality.notifications WHERE booking_id = :'bb' ORDER BY created_at LIMIT 1 \gset
-- A: a booking (pending) for the manager / owner checks
SELECT pg_temp.req(:'sa', :UA, pg_temp.d(40), pg_temp.d(42), 'd1.guest.a@example.com', '0521118888', 'd1-key-a-0001') ->> 'booking_id' AS ba \gset
SELECT guest_id AS ga FROM hospitality.bookings WHERE id = :'ba' \gset
-- a snapshot of B before the attacks (compared at the end)
CREATE TEMP TABLE d1_b_before AS
SELECT (SELECT jsonb_agg(to_jsonb(b) - 'updated_at' ORDER BY id) FROM hospitality.bookings b WHERE tenant_id = :'sb') AS bookings,
       (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hospitality.payments p WHERE tenant_id = :'sb') AS payments,
       (SELECT jsonb_agg(to_jsonb(c) - 'updated_at' ORDER BY id) FROM hospitality.channel_calendars c WHERE tenant_id = :'sb') AS calendars,
       (SELECT jsonb_agg(to_jsonb(u) - 'updated_at' ORDER BY id) FROM hospitality.units u WHERE tenant_id = :'sb') AS units,
       (SELECT jsonb_agg(to_jsonb(m) - 'updated_at' ORDER BY id) FROM hospitality.media m WHERE tenant_id = :'sb') AS media,
       (SELECT jsonb_agg(to_jsonb(g) - 'updated_at' ORDER BY id) FROM hospitality.guests g WHERE tenant_id = :'sb') AS guests,
       (SELECT count(*) FROM hospitality.blocks WHERE tenant_id = :'sb') AS blocks,
       (SELECT count(*) FROM hospitality.unit_categories WHERE tenant_id = :'sb') AS categories;

-- ============================================================
-- 1. Shared rate counters
-- ============================================================
\set K1 '''d1-rate-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set K2 '''d1-rate-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
SELECT pg_temp.after('rate: the first hits are allowed and counted per rule, in the order sent',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 600}, {"key": "%s", "limit": 5, "window": 600}]'))$$, :K1, :K2),
  $$SELECT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[1, 1]'::jsonb AND ($1 ->> 'retry_after')::integer = 0$$);
SELECT pg_temp.srv(NULL, format($$SELECT hospitality.rate_check('[{"key": "%s", "limit": 2, "window": 600}]')$$, :K1)) IS NOT NULL AS ok \gset
SELECT pg_temp.after('rate: over the limit → refused, with the seconds left in the window and the attempt number per rule',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 5, "window": 600}, {"key": "%s", "limit": 2, "window": 600}]'))$$, :K2, :K1),
  $$SELECT NOT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[2, 3]'::jsonb
           AND ($1 ->> 'retry_after')::integer BETWEEN 590 AND 600$$);
-- migration 36: an attempt that does not go through is not counted anywhere
\set K3 '''d1-rate-key-cccccccccccccccccccccccccccccccccccccccc'''
\set K4 '''d1-rate-key-dddddddddddddddddddddddddddddddddddddddd'''
\set K5 '''d1-rate-key-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'''
SELECT tests.check('rate (36): a refused attempt uses up nothing — not the rule that refused it, not the others',
  format($$SELECT (SELECT hits FROM hospitality.rate_buckets WHERE key = %L) = 1
             AND (SELECT hits FROM hospitality.rate_buckets WHERE key = %L) = 2$$, :K2, :K1));
SELECT pg_temp.after('rate (36): … so the other rule''s quota is intact — the next attempt there is number 2',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 5, "window": 600}]'))$$, :K2),
  $$SELECT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[2]'::jsonb$$);
SELECT pg_temp.after('rate: a one-time token — the first use passes',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 1, "window": 600}]'))$$, :K3),
  $$SELECT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[1]'::jsonb$$);
SELECT pg_temp.after('rate: … a second use is refused and reported as attempt 2 (the server answers "already used")',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 1, "window": 600}]'))$$, :K3),
  $$SELECT NOT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[2]'::jsonb$$);
SELECT tests.check('rate (36): … and the token counter stays at 1',
  format($$SELECT (SELECT hits FROM hospitality.rate_buckets WHERE key = %L) = 1$$, :K3));
SELECT pg_temp.after('rate (36): an attempt that another rule refuses does not burn a one-time token',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 600}, {"key": "%s", "limit": 1, "window": 600}]'))$$, :K1, :K4),
  $$SELECT NOT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[3, 1]'::jsonb$$);
SELECT tests.check('rate (36): … the token is still unused (no counter was written for it)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.rate_buckets WHERE key = %L)$$, :K4));
UPDATE hospitality.rate_buckets SET window_ends = now() - interval '1 second'
 WHERE key = 'd1-rate-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
SELECT pg_temp.after('rate: a new window starts from one (and the waiting token can now be used)',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 600}, {"key": "%s", "limit": 1, "window": 600}]'))$$, :K1, :K4),
  $$SELECT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[1, 1]'::jsonb$$);
SELECT pg_temp.after('rate: the same key twice in one call counts twice (as before)',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 600}, {"key": "%s", "limit": 2, "window": 600}]'))$$, :K5, :K5),
  $$SELECT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[1, 2]'::jsonb$$);
SELECT pg_temp.after('rate: … and a third time is over the limit (attempt 3, nothing counted)',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 600}]'))$$, :K5),
  $$SELECT NOT ($1 ->> 'allowed')::boolean AND $1 -> 'hits' = '[3]'::jsonb
           AND (SELECT hits FROM hospitality.rate_buckets WHERE key = 'd1-rate-key-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') = 2$$);
SELECT pg_temp.expect_error('rate: an invalid rule (key format) is refused',
  $$SELECT pg_temp.srv(NULL, $q$SELECT hospitality.rate_check('[{"key": "1.2.3.4", "limit": 2, "window": 600}]')$q$)$$,
  'invalid rule');
SELECT pg_temp.expect_error('rate: a window longer than a day is refused',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.rate_check(%%L)', '[{"key": "%s", "limit": 2, "window": 90000}]'))$$, :K1),
  'invalid rule');
SELECT pg_temp.expect_error('rate: more than 8 rules in one call is refused',
  $$SELECT pg_temp.srv(NULL, $q$SELECT hospitality.rate_check((SELECT jsonb_agg(jsonb_build_object('key', 'd1-many-keys-' || lpad(i::text, 8, '0'), 'limit', 1, 'window', 60)) FROM generate_series(1, 9) i))$q$)$$,
  '1 to 8 rules');
SELECT pg_temp.expect_error('rate: anonymous visitors cannot call the counter',
  $$SELECT pg_temp.call(NULL, NULL, $q$SELECT hospitality.rate_check('[]')$q$)$$, 'permission denied');
SELECT pg_temp.expect_error('rate: … nor a logged-in account (could exhaust someone else''s counter)',
  format($$SELECT pg_temp.call(%L, %L, $q$SELECT hospitality.rate_check('[]')$q$)$$, :'sa', :OWNER_A), 'permission denied');
SELECT pg_temp.expect_error('rate: … nor the cleanup',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.rate_sweep())')$$, :'sa', :OWNER_A), 'permission denied');
SELECT tests.check('rate: no API role (not even the server key) reads or writes the counters table directly',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.rate_buckets', p))
      FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.check('rate: the counters keep no raw data (HMAC keys only: no dots, no colons, no @)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.rate_buckets WHERE key ~ '[.:@ ]')$$);
SELECT tests.check('rate: temporary counters — an unlogged table with RLS on',
  $$SELECT relpersistence = 'u' AND relrowsecurity FROM pg_class WHERE oid = 'hospitality.rate_buckets'::regclass$$);
UPDATE hospitality.rate_buckets SET window_ends = now() - interval '2 minutes'
 WHERE key = 'd1-rate-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
SELECT pg_temp.after('rate: the cleanup removes expired counters only',
  $$SELECT pg_temp.srv(NULL, 'SELECT to_jsonb(hospitality.rate_sweep())')$$,
  $$SELECT $1::integer >= 1
       AND NOT EXISTS (SELECT 1 FROM hospitality.rate_buckets WHERE key = 'd1-rate-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
       AND EXISTS (SELECT 1 FROM hospitality.rate_buckets WHERE key = 'd1-rate-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$);

-- ============================================================
-- 2. Function coverage (every function — also ones added later)
-- ============================================================
SELECT tests.check('coverage: every SECURITY DEFINER function has a fixed, empty search_path',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace AND p.prosecdef
      AND NOT COALESCE('search_path=""' = ANY (p.proconfig), false))$$);
SELECT tests.check('coverage: anonymous visitors can call exactly the public functions (site, availability, quote, the guest''s own booking by its secret link)',
  $$SELECT array_agg(proname::text ORDER BY proname) = ARRAY['cancellation_quote', 'get_booking_by_token', 'guest_arrival_info',
      'guest_payment_info', 'public_availability', 'public_payment_methods', 'public_room_types', 'public_site',
      'public_type_availability', 'quote', 'quote_type', 'request_cancellation', 'request_tenant', 'site_identity']
      FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND has_function_privilege('anon', oid, 'EXECUTE')$$);
DO $t$
DECLARE _bad text;
BEGIN
  -- every function a logged-in account may call: a guard in its body — the staff of this business
  -- (_manage_tenant / _staff_tenant / _catalog_tenant / _arrival_tenant), the business of the address
  -- (request_tenant / _public_tenant / _public_site_tenant), the guest's own booking (_guest_booking),
  -- or the platform admin (_platform_admin / is_platform_admin / platform_slug_problem) — or one of
  -- the pure helpers listed here
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO _bad
    FROM pg_proc p
   WHERE p.pronamespace = 'hospitality'::regnamespace
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))
     AND p.prosrc !~ '(_manage_tenant|_staff_tenant|_catalog_tenant|_arrival_tenant|request_tenant|_public_tenant|_public_site_tenant|_guest_booking|_platform_admin|is_platform_admin|platform_slug_problem)\('
     AND p.proname NOT IN ('flag', 'permissions', 'can', 'amenity_presets', 'management_context', 'request_tenant');
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('coverage: every function callable through the API checks the business / permission / guest link in its body',
          _bad IS NULL, COALESCE('unguarded: ' || _bad, 'ok'));
  -- functions only the server runs: never callable by anon / authenticated
  SELECT string_agg(f, ', ') INTO _bad
    FROM unnest(ARRAY['rate_check', 'rate_sweep', 'request_booking', 'request_booking_type', 'channel_feed',
                      'channel_sync_service', 'channel_calendars_due', 'payment_provider_record', 'claim_notifications',
                      'mark_notification', 'expire_holds', 'apply_retention', 'export_guest', 'confirm_payment',
                      'email_payment_methods', 'support_platform_recipients', 'site_request_submit',
                      'portal_open_site', 'portal_trial_days']) f
   WHERE EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace AND p.proname = f
                    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')))
      OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace AND p.proname = f
                    AND has_function_privilege('service_role', p.oid, 'EXECUTE'));
  INSERT INTO tests.results (name, ok, detail)
  VALUES ('coverage: the server-only functions (booking requests, counters, sync, outbox, retention, provider payments, portal requests / opening) are closed to the API roles',
          _bad IS NULL, COALESCE('open / missing: ' || _bad, 'ok'));
END $t$;
SELECT pg_temp.expect_error('coverage: a booking request straight through the API (anonymous) is refused',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_booking_type(_category_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _email => %%L, _phone => %%L, _idempotency_key => %%L, _policy_accepted => true, _policy_hash => %%L)',
     %L::uuid, pg_temp.d(60), pg_temp.d(61), 'בוט', 'bot@example.com', '0520000009', 'd1-bot-0001', repeat('0', 64)))$$, :'sb', :CB),
  'permission denied');

-- ============================================================
-- 3. Cross-tenant matrix — the owner of A, on A's host, with B's identifiers
-- ============================================================
SELECT pg_temp.denied('cross-tenant: booking detail', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_booking_detail(%%L)', %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: approve', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.approve_booking(%%L))', %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: decline', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.decline_booking(%%L))', %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: cancel', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.cancel_booking(%%L))', %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: check-in', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.set_stay_status(%%L, 'checked_in'))$q$, %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: modify dates', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.modify_booking(%%L, 1, %%L, %%L))', %L, pg_temp.d(50), pg_temp.d(52)))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: read payments', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.booking_payments(%%L)', %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: record a payment', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT hospitality.payment_record(%%L, 'full', 'cash', 1, current_date)$q$, %L))$$, :'sa', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant: void a payment', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT hospitality.payment_void(%%L, 'd1 attack')$q$, %L))$$, :'sa', :OWNER_A, :'payb'));
SELECT pg_temp.denied('cross-tenant: block dates on a unit', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.block_create(%%L, %%L, %%L))', %L, pg_temp.d(70), pg_temp.d(72)))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: deactivate a unit', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.unit_set_active(%%L, false))', %L))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: delete a unit', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.unit_delete(%%L))', %L))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: archive a property', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.property_archive(%%L))', %L))$$, :'sa', :OWNER_A, :PB));
SELECT pg_temp.denied('cross-tenant: arrival info (codes, Wi-Fi)', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.arrival_info_view(%%L)', %L))$$, :'sa', :OWNER_A, :PB));
SELECT pg_temp.denied('cross-tenant: manual booking on a unit', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.create_manual_booking(%%L, %%L, %%L, 'אורח בדיקה', '0520000000', true))$q$, %L, pg_temp.d(80), pg_temp.d(81)))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: connect a channel calendar to a unit', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.channel_calendar_add(%%L, 'airbnb', 'https://www.airbnb.com/calendar/ical/x.ics'))$q$, %L))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: remove a channel calendar', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.channel_calendar_remove(%%L))', %L))$$, :'sa', :OWNER_A, :'calb'));
SELECT pg_temp.denied('cross-tenant: push events into a channel calendar', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.channel_sync_apply(%%L, '[]'))$q$, %L))$$, :'sa', :OWNER_A, :'calb'));
SELECT pg_temp.denied('cross-tenant: read / rotate the export feed token', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.channel_feed_token(%%L, true))', %L))$$, :'sa', :OWNER_A, :UB));
SELECT pg_temp.denied('cross-tenant: put own unit in a room type of another business', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.room_type_assign(%%L, %%L))', %L, %L))$$, :'sa', :OWNER_A, :UA, :CB));
SELECT pg_temp.denied('cross-tenant: delete a room type', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.room_type_delete(%%L))', %L))$$, :'sa', :OWNER_A, :CB));
SELECT pg_temp.denied('cross-tenant: delete a photo', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.media_delete(%%L))', %L))$$, :'sa', :OWNER_A, :MB));
SELECT pg_temp.denied('cross-tenant: edit a photo', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.media_update(%%L, 'x'))$q$, %L))$$, :'sa', :OWNER_A, :MB));
SELECT pg_temp.denied('cross-tenant: guest card', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_guest_detail(%%L)', %L))$$, :'sa', :OWNER_A, :'gb'));
SELECT pg_temp.denied('cross-tenant: export a guest', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest_logged(%%L)', %L))$$, :'sa', :OWNER_A, :'gb'));
SELECT pg_temp.denied('cross-tenant: anonymise a guest', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L))$$, :'sa', :OWNER_A, :'gb'));
SELECT pg_temp.denied('cross-tenant: guest notes', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT to_jsonb(hospitality.update_guest_notes(%%L, 'x'))$q$, %L))$$, :'sa', :OWNER_A, :'gb'));
-- (the same answer as for an unknown id — nothing about B's email is revealed)
SELECT pg_temp.expect_error('cross-tenant: re-send an email', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.requeue_notification(%%L))', %L))$$, :'sa', :OWNER_A, :'nb'),
  'אפשר לשלוח שוב רק מייל שנכשל');
SELECT pg_temp.expect_error('cross-tenant: … the same answer as for an id that does not exist',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.requeue_notification(gen_random_uuid()))')$$, :'sa', :OWNER_A),
  'אפשר לשלוח שוב רק מייל שנכשל');
SELECT pg_temp.denied('cross-tenant: remove the other owner from a team', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'sa', :OWNER_A, :OWNER_B));

-- … and on B's host (the owner of A is not staff there)
SELECT pg_temp.denied('cross-tenant (B''s host): bookings list', format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.staff_bookings()')$$, :'sb', :OWNER_A));
SELECT pg_temp.denied('cross-tenant (B''s host): dashboard', format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.dashboard()')$$, :'sb', :OWNER_A));
SELECT pg_temp.denied('cross-tenant (B''s host): channels', format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.channels_view()')$$, :'sb', :OWNER_A));
SELECT pg_temp.denied('cross-tenant (B''s host): record a payment', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT hospitality.payment_record(%%L, 'full', 'cash', 1, current_date)$q$, %L))$$, :'sb', :OWNER_A, :'bb'));
SELECT pg_temp.denied('cross-tenant (B''s host): the website editor', format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.site_editor()')$$, :'sb', :OWNER_A));
SELECT tests.check('cross-tenant (B''s host): the tables show the owner of A no rows of B',
  format($$SELECT (pg_temp.call(%L, %L, $q$SELECT to_jsonb((SELECT count(*) FROM hospitality.bookings) + (SELECT count(*) FROM hospitality.guests)
       + (SELECT count(*) FROM hospitality.units))$q$))::integer = 0$$, :'sb', :OWNER_A));
SELECT tests.check('cross-tenant: payments, channel calendars and the counters are not readable as tables at all (functions only)',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.' || t, 'SELECT'))
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['payments', 'channel_calendars', 'channel_feeds', 'rate_buckets']) t$$);

-- anonymous visitors: the address decides the business, never the identifiers sent
SELECT pg_temp.denied('cross-tenant (anon on A''s host): availability of B''s unit', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %L, pg_temp.d(1), pg_temp.d(30)))$$, :'sa', :UB));
SELECT pg_temp.denied('cross-tenant (anon on A''s host): availability of B''s room type', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.public_type_availability(%%L, %%L, %%L)', %L, pg_temp.d(1), pg_temp.d(30)))$$, :'sa', :CB));
SELECT pg_temp.denied('cross-tenant (anon on A''s host): a quote for B''s unit', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L, pg_temp.d(50), pg_temp.d(52)))$$, :'sa', :UB));
SELECT pg_temp.denied('cross-tenant (anon on A''s host): a quote for B''s room type', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote_type(%%L, %%L, %%L)', %L, pg_temp.d(50), pg_temp.d(52)))$$, :'sa', :CB));
SELECT pg_temp.denied('cross-tenant (anon on A''s host): B''s booking by its secret link', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L))$$, :'sa', :'tb'));
SELECT pg_temp.denied('cross-tenant (anon on A''s host): cancel B''s booking by its secret link', format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sa', :'tb'));
SELECT tests.check('cross-tenant: the export feed of B''s unit is not served under A (the token belongs to B)',
  format($$SELECT pg_temp.srv(NULL, format('SELECT hospitality.channel_feed(%%L, %%L)', %L, %L)) IS NULL
           AND pg_temp.srv(NULL, format('SELECT hospitality.channel_feed(%%L, %%L)', %L, %L)) IS NOT NULL$$,
         :'sa', :'feedb', :'sb', :'feedb'));

SELECT tests.check('cross-tenant: after all of the above, nothing of B changed',
  format($$SELECT (SELECT jsonb_agg(to_jsonb(b) - 'updated_at' ORDER BY id) FROM hospitality.bookings b WHERE tenant_id = %1$L) = x.bookings
          AND (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM hospitality.payments p WHERE tenant_id = %1$L) = x.payments
          AND (SELECT jsonb_agg(to_jsonb(c) - 'updated_at' ORDER BY id) FROM hospitality.channel_calendars c WHERE tenant_id = %1$L) = x.calendars
          AND (SELECT jsonb_agg(to_jsonb(u) - 'updated_at' ORDER BY id) FROM hospitality.units u WHERE tenant_id = %1$L) = x.units
          AND (SELECT jsonb_agg(to_jsonb(m) - 'updated_at' ORDER BY id) FROM hospitality.media m WHERE tenant_id = %1$L) = x.media
          AND (SELECT jsonb_agg(to_jsonb(g) - 'updated_at' ORDER BY id) FROM hospitality.guests g WHERE tenant_id = %1$L) = x.guests
          AND (SELECT count(*) FROM hospitality.blocks WHERE tenant_id = %1$L) = x.blocks
          AND (SELECT count(*) FROM hospitality.unit_categories WHERE tenant_id = %1$L) = x.categories
          FROM d1_b_before x$$, :'sb'));

-- ============================================================
-- 4. Permission matrix
-- ============================================================
-- manager (sub-manager): daily work yes; privacy, team and owner-only actions no
SELECT tests.check('permissions: a manager works the bookings (list, payments, channels)',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_bookings()') IS NOT NULL
          AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.booking_payments(%%L)', %3$L)) IS NOT NULL
          AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.channels_view()') IS NOT NULL$$, :'sa', :MGR_A, :'ba'));
SELECT pg_temp.denied('permissions: a manager cannot export a guest (privacy — owner only)', format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest_logged(%%L)', %L))$$, :'sa', :MGR_A, :'ga'));
SELECT pg_temp.denied('permissions: a manager cannot anonymise a guest', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L))$$, :'sa', :MGR_A, :'ga'));
SELECT pg_temp.denied('permissions: a manager cannot add managers', format($$SELECT pg_temp.call(%L, %L, $q$SELECT to_jsonb(hospitality.team_add_manager('x@example.com', 'x'))$q$)$$, :'sa', :MGR_A));
SELECT pg_temp.denied('permissions: a manager cannot remove the owner', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.team_remove_manager(%%L))', %L))$$, :'sa', :MGR_A, :OWNER_A));
SELECT pg_temp.denied('permissions: a manager cannot delete a unit (catalog — owner only)', format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.unit_delete(%%L))', %L))$$, :'sa', :MGR_A, :UA));
-- the owner: everything in their own business
SELECT tests.check('permissions: the owner exports a guest of their own business',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest_logged(%%L)', %L)) ? 'guest'$$, :'sa', :OWNER_A, :'ga'));
-- a signed-up account with no role (anyone can create one): nothing
SELECT pg_temp.denied('permissions: a signed-up account is not staff', format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.staff_bookings()')$$, :'sa', :ACCOUNT));
SELECT pg_temp.denied('permissions: … cannot record a payment', format($$SELECT pg_temp.call(%L, %L, format($q$SELECT hospitality.payment_record(%%L, 'full', 'cash', 1, current_date)$q$, %L))$$, :'sa', :ACCOUNT, :'ba'));
SELECT pg_temp.denied('permissions: … nor open the platform panel', format($$SELECT pg_temp.call(NULL, %L, 'SELECT hospitality.admin_sites()')$$, :ACCOUNT));
SELECT tests.run('permissions: … and reads no Hospitality row', 'SELECT * FROM hospitality.bookings', :ACCOUNT, NULL, 0);
-- the owner of a business is not a platform admin
SELECT pg_temp.denied('permissions: a business owner cannot open the platform panel', format($$SELECT pg_temp.call(NULL, %L, 'SELECT hospitality.admin_sites()')$$, :OWNER_A));
SELECT pg_temp.denied('permissions: … nor change their own subscription', format($$SELECT pg_temp.call(NULL, %L, format($q$SELECT to_jsonb(hospitality.admin_set_subscription(%%L, 'basic', 'active'))$q$, %L))$$, :OWNER_A, :'sa'));
-- the platform admin: the panel, and owner-level support on every business (by design; logged with the actor)
SELECT tests.check('permissions: the platform admin opens the panel',
  $$SELECT pg_temp.call(NULL, 'a0000000-0000-0000-0000-0000000000f0', 'SELECT hospitality.admin_sites()') IS NOT NULL$$);
-- anonymous: no management at all
SELECT pg_temp.denied('permissions: anonymous visitors reach no management function', format($$SELECT pg_temp.call(%L, NULL, 'SELECT hospitality.staff_bookings()')$$, :'sa'));

-- ============================================================
-- 5. Data exposure
-- ============================================================
SELECT tests.check('exposure: the public site carries no guest, booking, staff or internal data',
  format($$SELECT NOT (s::text ~* '(d1\.guest|d1\.owner|d1_owner|manage_token|internal_notes|arrival|wifi|door_code|notification_emails|user_id)')
          FROM pg_temp.call(%L, NULL, 'SELECT hospitality.public_site()') s$$, :'sb'));
SELECT tests.check('exposure: availability shows dates only — no names, no booking ids',
  format($$SELECT NOT (a::text ~* '(אורחת|d1\.guest|booking_id|%s)')
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %L, pg_temp.d(30), pg_temp.d(60))) a$$,
         :'bb', :'sb', :UB));
SELECT tests.check('exposure: the guest''s own booking (secret link) has no staff notes or internal fields',
  format($$SELECT NOT (v ?| ARRAY['internal_notes', 'guest_id', 'tenant_id', 'manage_token_hash', 'created_by', 'events'])
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) v$$, :'sb', :'tb'));
SELECT tests.check('exposure: the export feed has dates only (no guest name / email / phone)',
  format($$SELECT NOT (f::text ~* '(אורחת|d1\.guest|0521119999|@)')
          FROM pg_temp.srv(NULL, format('SELECT hospitality.channel_feed(%%L, %%L)', %L, %L)) f$$, :'sb', :'feedb'));

-- ============================================================
-- Hospitality — the guest area "ההזמנות שלי" (20261108110000_hosp_guest_area.sql, migration 56)
--   • codes and sessions: RLS, no direct grants, every function for the server only (service key);
--   • a code is stored for any address (the limits apply the same) but "send" only when this business has
--     a booking with it — the visitor gets the same answer; one code per 30 seconds, 5 an hour;
--   • a code: one active, 5 attempts, 10 minutes, once only; per business;
--   • a session (only its hash): 14 days, per business, revoked by signing out;
--   • the area shows exactly this business's bookings whose guest email is the proven address — never
--     another guest's, another business's, or an anonymized guest's; payment and transfer by the 55 rules.
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000056a01'''
\set OWNER_X '''a0000000-0000-0000-0000-000000056a03'''
\set PP '''75600000-0000-0000-0000-0000000000f1'''
\set P1 '''75600000-0000-0000-0000-0000000000a1'''
\set P2 '''75600000-0000-0000-0000-0000000000a2'''
\set XP '''75600000-0000-0000-0000-0000000000f2'''
\set X1 '''75600000-0000-0000-0000-0000000000b1'''
\set H1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set H2 '''2222222222222222222222222222222222222222222222222222222222222222'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date + _n
$$;
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
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site)::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
-- the error and its SQLSTATE ("28000: …") — the server shows the sign-in again on 28000
CREATE OR REPLACE FUNCTION pg_temp.srv_err(_site text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.srv(_site, _sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN SQLSTATE || ': ' || SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
-- a manual booking for a guest with this email
CREATE OR REPLACE FUNCTION pg_temp.manual(_site text, _uid uuid, _unit uuid, _in date, _out date, _email text,
                                          _status text DEFAULT 'confirmed') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _email => %L, _terms_explained => true, _status => %L)',
    _unit, _in, _out, 'אורחת האזור', '0541234567', _email, _status));
$f$;
-- a code hash as the server makes it (here: any 43 base64url characters)
CREATE OR REPLACE FUNCTION pg_temp.ch(_s text) RETURNS text LANGUAGE sql AS $$
  SELECT rpad(translate(encode(convert_to(_s, 'UTF8'), 'base64'), '+/=', '-_A'), 43, 'Q')
$$;
CREATE OR REPLACE FUNCTION pg_temp.issue(_site text, _email text, _code text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.guest_code_issue(%L, %L)', _email, pg_temp.ch(_code)));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.consume(_site text, _email text, _code text, _session text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.guest_code_consume(%L, %L, %L)', _email, pg_temp.ch(_code), _session));
$f$;
-- the 30-second wait between codes, skipped (as if time passed)
CREATE OR REPLACE FUNCTION pg_temp.later(_email text) RETURNS void LANGUAGE sql AS $$
  UPDATE hospitality.guest_codes SET created_at = created_at - interval '31 seconds' WHERE email = _email;
$$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000056a01', 'm56.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000056a03', 'm56.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m56-area', 'צימרי האזור', 'm56.owner@test.local')$$) ->> 'id' AS sp \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m56-other', 'עסק אחר 56', 'm56.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sp', :OWNER_P, 'm56.owner@test.local', 'm56_owner', 'admin', true, 'דורית'),
  (:'sx', :OWNER_X, 'm56.other@test.local', 'm56_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sp', :'sx')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:PP, :'sp', 'מתחם האזור', 'm56-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'm56-x', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:P1, :'sp', :PP, 'unit', 'סוויטת הגפן', 'm56-p1', 4, 2, 600),
  (:P2, :'sp', :PP, 'unit', 'בקתת התאנה', 'm56-p2', 4, 2, 500),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'm56-x1', 4, 2, 500);
SELECT pg_temp.call(:'sp', :OWNER_P, $$SELECT hospitality.payment_settings_save('{"bank_enabled": true, "bank_name": "בנק לאומי",
  "bank_branch": "800", "bank_account": "123456", "bank_holder": "דורית כהן"}'::jsonb, 0)$$) IS NOT NULL AS ok \gset
-- dana: two bookings here (a month ahead and two months ahead), one at the other business; noa: one here
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(60), pg_temp.d(62), 'Dana@Example.com') ->> 'booking_id' AS b_far \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P2, pg_temp.d(30), pg_temp.d(31), 'dana@example.com', 'pending_approval') ->> 'booking_id' AS b_soon \gset
SELECT pg_temp.manual(:'sx', :OWNER_X, :X1, pg_temp.d(30), pg_temp.d(32), 'dana@example.com') ->> 'booking_id' AS b_x \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(20), pg_temp.d(22), 'noa@example.com') ->> 'booking_id' AS b_noa \gset

-- ============================================================
-- 1. Tables and who may call what
-- ============================================================
SELECT tests.check('guest area (56): codes and sessions — RLS, no direct grants, restrictive isolation + backend policies, tenant guard',
  $$SELECT bool_and(c.relrowsecurity)
       AND NOT bool_or(has_table_privilege(r, c.oid, p))
       AND bool_and((SELECT count(*) FROM pg_policies x WHERE x.schemaname = 'hospitality' AND x.tablename = c.relname
                       AND x.permissive = 'RESTRICTIVE' AND x.policyname IN ('tenant_isolation', 'backend_enabled')) = 2)
       AND bool_and(EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard'))
      FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
     WHERE c.oid IN ('hospitality.guest_codes'::regclass, 'hospitality.guest_sessions'::regclass)$$);
SELECT tests.check('guest area (56): every new function is for the server only; the helpers are internal',
  $$SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE') OR p.proname LIKE '\_%')
       AND count(*) = 13
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('guest_code_issue', 'guest_code_consume', 'guest_area_sign_out', 'guest_area_bookings',
                         'guest_area_booking', 'guest_area_set_payment_method', 'guest_area_proof_slot',
                         '_guest_area_has_bookings', '_guest_area_email', '_guest_area_booking', '_guest_payment_json',
                         '_set_payment_method', '_proof_slot')$$);

-- ============================================================
-- 2. Codes: the same answer for every address; the limits apply the same
-- ============================================================
SELECT pg_temp.issue(:'sp', 'DANA@example.com ', '111111') AS i1 \gset
SELECT pg_temp.issue(:'sp', 'nobody@example.com', '222222') AS i2 \gset
SELECT tests.check('code: "send" only when this business has a booking with the address — a code is stored either way',
  format($$SELECT (%1$L::jsonb ->> 'send')::boolean AND NOT (%2$L::jsonb ->> 'send')::boolean
             AND (SELECT count(*) FROM hospitality.guest_codes WHERE tenant_id = %3$L) = 2
             AND EXISTS (SELECT 1 FROM hospitality.guest_codes WHERE tenant_id = %3$L AND email = 'dana@example.com')$$,
         :'i1', :'i2', :'sp'));
SELECT tests.check('code: a second code within 30 seconds is refused — for an address with bookings and without alike',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'dana@example.com', pg_temp.ch('3')))
                LIKE '%%בעוד חצי דקה%%'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'nobody@example.com', pg_temp.ch('4')))
                LIKE '%%בעוד חצי דקה%%'$$, :'sp'));
SELECT tests.check('code: guests and signed-in accounts cannot call it; a bad address or hash is refused',
  format($$SELECT pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'a@b.co', pg_temp.ch('x'))) LIKE '%%permission denied%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'a@b.co', pg_temp.ch('x'))) LIKE '%%permission denied%%'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'not-an-email', pg_temp.ch('x'))) LIKE '%%לא תקינה%%'
             AND pg_temp.srv_err(%1$L, 'SELECT hospitality.guest_code_issue(''a@b.co'', ''short'')') LIKE '%%לא תקינה%%'$$,
         :'sp', :OWNER_P));
SELECT pg_temp.later('dana@example.com');
SELECT pg_temp.issue(:'sp', 'dana@example.com', '333333') IS NOT NULL AS ok \gset
SELECT tests.check('code: a new code cancels the previous one — only the newest is active',
  format($$SELECT (SELECT count(*) FROM hospitality.guest_codes WHERE tenant_id = %L AND email = 'dana@example.com'
                     AND consumed_at IS NULL) = 1
             AND pg_temp.consume(%L, 'dana@example.com', '111111', %L) ->> 'result' = 'invalid'$$, :'sp', :'sp', :H1));
SELECT tests.check('code: wrong codes count down, the fifth locks it; then there is no active code',
  format($$SELECT pg_temp.consume(%1$L, 'dana@example.com', '000001', %2$L) ->> 'left' = '3'
             AND pg_temp.consume(%1$L, 'dana@example.com', '000002', %2$L) ->> 'left' = '2'
             AND pg_temp.consume(%1$L, 'dana@example.com', '000003', %2$L) ->> 'left' = '1'
             AND pg_temp.consume(%1$L, 'dana@example.com', '000004', %2$L) ->> 'result' = 'locked'
             AND pg_temp.consume(%1$L, 'dana@example.com', '333333', %2$L) ->> 'result' = 'none'
             AND NOT EXISTS (SELECT 1 FROM hospitality.guest_sessions WHERE token_hash = %2$L)$$, :'sp', :H1));
SELECT pg_temp.later('dana@example.com');
SELECT pg_temp.issue(:'sp', 'dana@example.com', '444444') IS NOT NULL AS ok \gset
UPDATE hospitality.guest_codes SET expires_at = now() - interval '1 second'
 WHERE tenant_id = :'sp' AND email = 'dana@example.com' AND consumed_at IS NULL;
SELECT tests.check('code: after 10 minutes it has expired',
  format($$SELECT pg_temp.consume(%L, 'dana@example.com', '444444', %L) ->> 'result' = 'expired'$$, :'sp', :H1));
SELECT pg_temp.later('dana@example.com');
SELECT pg_temp.issue(:'sp', 'dana@example.com', '555555') IS NOT NULL AS ok \gset
SELECT tests.check('code: per business — the right code on another business''s address finds nothing',
  format($$SELECT pg_temp.consume(%L, 'dana@example.com', '555555', %L) ->> 'result' = 'none'$$, :'sx', :H1));
SELECT pg_temp.consume(:'sp', 'Dana@Example.com', '555555', :H1) AS c1 \gset
SELECT tests.check('code: the right code opens a session (only its hash, 14 days) and is used up',
  format($$SELECT %4$L::jsonb ->> 'result' = 'ok'
             AND (SELECT email = 'dana@example.com' AND expires_at BETWEEN now() + interval '13 days' AND now() + interval '15 days'
                    FROM hospitality.guest_sessions WHERE token_hash = %2$L AND tenant_id = %1$L)
             AND pg_temp.consume(%1$L, 'dana@example.com', '555555', %3$L) ->> 'result' = 'none'$$, :'sp', :H1, :H2, :'c1'));
SELECT pg_temp.later('limit@example.com');
SELECT pg_temp.issue(:'sp', 'limit@example.com', '1') IS NOT NULL AS ok \gset
SELECT pg_temp.later('limit@example.com');
SELECT pg_temp.issue(:'sp', 'limit@example.com', '2') IS NOT NULL AS ok \gset
SELECT pg_temp.later('limit@example.com');
SELECT pg_temp.issue(:'sp', 'limit@example.com', '3') IS NOT NULL AS ok \gset
SELECT pg_temp.later('limit@example.com');
SELECT pg_temp.issue(:'sp', 'limit@example.com', '4') IS NOT NULL AS ok \gset
SELECT pg_temp.later('limit@example.com');
SELECT pg_temp.issue(:'sp', 'limit@example.com', '5') IS NOT NULL AS ok \gset
SELECT pg_temp.later('limit@example.com');
SELECT tests.check('code: at most 5 codes an hour for an address',
  format($$SELECT pg_temp.srv_err(%L, format('SELECT hospitality.guest_code_issue(%%L, %%L)', 'limit@example.com', pg_temp.ch('6')))
                LIKE '%%בעוד שעה%%'$$, :'sp'));

-- ============================================================
-- 3. The area: exactly the proven address's bookings at this business
-- ============================================================
SELECT pg_temp.srv(:'sp', format('SELECT hospitality.guest_area_bookings(%L)', :H1)) AS list \gset
SELECT tests.check('area: the list — this business''s bookings of the address (case does not matter), the nearest first, with the payment and transfer state',
  format($$SELECT %1$L::jsonb ->> 'email' = 'dana@example.com'
             AND jsonb_array_length(%1$L::jsonb -> 'bookings') = 2
             AND %1$L::jsonb -> 'bookings' -> 0 ->> 'id' = %2$L
             AND %1$L::jsonb -> 'bookings' -> 1 ->> 'id' = %3$L
             AND %1$L::jsonb -> 'bookings' -> 1 ->> 'unit_name' = 'סוויטת הגפן'
             AND %1$L::jsonb -> 'bookings' -> 1 ->> 'payment_status' = 'unpaid'
             AND (%1$L::jsonb -> 'bookings' -> 1 -> 'transfer' ->> 'can_upload')::boolean
             AND %1$L::jsonb::text NOT LIKE '%%' || %4$L || '%%'
             AND %1$L::jsonb::text NOT LIKE '%%noa@%%'$$, :'list', :'b_soon', :'b_far', :'b_x'));
SELECT tests.check('area: another guest''s booking, or the address''s booking at another business — not found',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_booking(%%L, %%L)', %2$L, %3$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_booking(%%L, %%L)', %2$L, %4$L)) LIKE '%%לא נמצאה%%'$$,
         :'sp', :H1, :'b_noa', :'b_x'));
SELECT tests.check('area: one booking — the details and the payment instructions (bank transfer allowed a month ahead)',
  format($$SELECT b -> 'booking' ->> 'id' = %3$L AND (b -> 'payment' ->> 'available')::boolean
             AND b -> 'payment' -> 'bank' ->> 'account' = '123456'
             AND b -> 'payment' -> 'methods' = '["bank", "phone"]'::jsonb
            FROM pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_booking(%%L, %%L)', %2$L, %3$L)) b$$,
         :'sp', :H1, :'b_far'));
SELECT tests.check('area: the session is for this business only; an unknown session is signed out (28000)',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_bookings(%%L)', %3$L)) LIKE '28000:%%'
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.guest_area_bookings(%%L)', %4$L)) LIKE '28000:%%החיבור הסתיים%%'
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.guest_area_bookings(%%L)', 'x')) LIKE '28000:%%'$$,
         :'sx', :'sp', :H1, :H2));
SELECT pg_temp.srv(:'sp', format('SELECT hospitality.guest_area_set_payment_method(%L, %L, %L)', :H1, :'b_far', 'bank')) AS m \gset
SELECT tests.check('area: choosing bank transfer — the same rules and history as the personal link',
  format($$SELECT (%1$L::jsonb -> 'transfer' ->> 'chosen')::boolean
             AND (SELECT payment_method FROM hospitality.bookings WHERE id = %2$L) = 'bank'
             AND EXISTS (SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = %2$L AND e.kind = 'payment_method_chosen')
             AND pg_temp.srv_err(%3$L, format('SELECT hospitality.guest_area_set_payment_method(%%L, %%L, %%L)', %4$L, %5$L, 'bank'))
                LIKE '%%לא נמצאה%%'$$, :'m', :'b_far', :'sp', :H1, :'b_noa'));
SELECT pg_temp.srv(:'sp', format('SELECT hospitality.guest_area_proof_slot(%L, %L, %L, %L, %s)', :H1, :'b_far', 'proof.png', 'image/png', 1024)) AS slot \gset
SELECT tests.check('area: a transfer proof — a slot for the own booking (then "ready" as usual); none for a request not approved, or another guest''s',
  format($$SELECT %1$L::jsonb ->> 'path' LIKE %2$L || '/' || %3$L || '/%%'
             AND pg_temp.srv(%2$L, format('SELECT to_jsonb(hospitality.guest_proof_ready(%%L))', %1$L::jsonb ->> 'id')) = 'true'::jsonb
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.guest_area_proof_slot(%%L, %%L, %%L, %%L, %%s)', %4$L, %5$L, 'a.png', 'image/png', 10))
                LIKE '%%אי אפשר להעלות%%'
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.guest_area_proof_slot(%%L, %%L, %%L, %%L, %%s)', %4$L, %6$L, 'a.png', 'image/png', 10))
                LIKE '%%לא נמצאה%%'$$, :'slot', :'sp', :'b_far', :H1, :'b_soon', :'b_noa'));
SELECT tests.check('area: the received proof is in the list (after a refresh — from the database)',
  format($$SELECT l -> 'bookings' -> 1 -> 'transfer' -> 'proofs' -> 0 ->> 'status' = 'submitted'
             AND (l -> 'bookings' -> 1 -> 'transfer' ->> 'waiting_review')::boolean
            FROM pg_temp.srv(%L, format('SELECT hospitality.guest_area_bookings(%%L)', %L)) l$$, :'sp', :H1));
UPDATE hospitality.guests SET anonymized_at = now(), email = NULL, phone = NULL, user_id = NULL
 WHERE tenant_id = :'sp' AND id = (SELECT guest_id FROM hospitality.bookings WHERE id = :'b_soon');
SELECT tests.check('area: a guest whose details were deleted (anonymized) is not shown — none of that guest''s bookings',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l -> 'bookings') x
                               WHERE x ->> 'id' IN (SELECT b.id::text FROM hospitality.bookings b
                                                     WHERE b.guest_id = (SELECT guest_id FROM hospitality.bookings WHERE id = %3$L)))
             AND jsonb_array_length(l -> 'bookings') = (SELECT count(*) FROM hospitality.bookings b
                    JOIN hospitality.guests g ON g.id = b.guest_id
                   WHERE b.tenant_id = %1$L AND g.email_normalized = 'dana@example.com')
            FROM pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_bookings(%%L)', %2$L)) l$$, :'sp', :H1, :'b_soon'));
SELECT pg_temp.srv(:'sp', format('SELECT to_jsonb(hospitality.guest_area_sign_out(%L))', :H1)) AS out1 \gset
SELECT tests.check('sign out: the session is revoked in the database — the next call is signed out',
  format($$SELECT %3$L::jsonb = 'true'::jsonb
             AND (SELECT revoked_at IS NOT NULL FROM hospitality.guest_sessions WHERE token_hash = %2$L)
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_bookings(%%L)', %2$L)) LIKE '28000:%%'$$,
         :'sp', :H1, :'out1'));
SELECT pg_temp.later('noa@example.com');
SELECT pg_temp.issue(:'sp', 'noa@example.com', '777777') IS NOT NULL AS ok \gset
SELECT pg_temp.consume(:'sp', 'noa@example.com', '777777', :H2) IS NOT NULL AS ok \gset
UPDATE hospitality.guest_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = :H2;
SELECT tests.check('session: after 14 days it has expired — signed out',
  format($$SELECT pg_temp.srv_err(%L, format('SELECT hospitality.guest_area_bookings(%%L)', %L)) LIKE '28000:%%'$$, :'sp', :H2));

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

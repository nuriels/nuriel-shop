-- ============================================================
-- Hospitality — several rooms in one request (migration 44 — 20261105210000_hosp_booking_groups.sql)
--   • public_free_units: open, free units for the dates (not the whole complex);
--   • request_booking_group: all rooms together or none; one email to the guest (a personal link per
--     room) and one to the business — not one per room; one approval reminder; the same request again
--     returns the same group; the request counts as one toward the open-requests limit;
--   • refused: one room, the same room twice, the whole complex, a taken room (by name, nothing
--     created), changed terms, a visitor calling it directly;
--   • booking_group / booking_group_decide: the staff sees the rooms; approve / decline all of them —
--     one email to the guest (with the new personal links); instant booking mode.
-- (The test harness opens units created by tests — tests.open_new_units.)
-- ============================================================
\set OWNER44 '''a0000000-0000-0000-0000-000000044a01'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.44')::text, true);
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
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.44')::text, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
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
-- the rooms of a request: [unit, adults, children] — with the terms each one is quoted with now
CREATE OR REPLACE FUNCTION pg_temp.rooms(_site text, _in date, _out date, VARIADIC _r text[]) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE out jsonb := '[]'; i integer := 1; q jsonb;
BEGIN
  WHILE i <= cardinality(_r) LOOP
    q := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, %s, %s)', _r[i], _in, _out, _r[i + 1], _r[i + 2]));
    out := out || jsonb_build_array(jsonb_build_object('unit_id', _r[i], 'adults', _r[i + 1]::integer,
                                                       'children', _r[i + 2]::integer, 'policy_hash', q ->> 'policy_hash'));
    i := i + 3;
  END LOOP;
  RETURN out;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.grp_sql(_rooms jsonb, _in date, _out date, _email text, _key text) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.request_booking_group(_rooms => %L, _check_in => %L, _check_out => %L,
                   _full_name => %L, _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true)',
                _rooms, _in, _out, 'אורח קבוצה', _email, '0542630440', _key);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.grp_err(_site text, _rooms jsonb, _in date, _out date, _email text, _key text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.srv(_site, pg_temp.grp_sql(_rooms, _in, _out, _email, _key));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.mails(_site uuid, _event text) RETURNS bigint LANGUAGE sql AS $f$
  SELECT count(*) FROM hospitality.notifications WHERE tenant_id = _site AND event = _event;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000044a01', 'm44.owner@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m44_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m44-group', 'נופי הקבוצה', 'm44.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm44.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_booking_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %1$L)])$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER44,
  $q$SELECT hospitality.property_create('{"name": "נופי הקבוצה", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידת אדיר", "unit_type": "suite", "capacity": 5}')$q$, :'sp')) ->> 'id' AS ua \gset
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידת מוריה", "unit_type": "suite", "capacity": 5}')$q$, :'sp')) ->> 'id' AS ub \gset
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידת גן עדן", "unit_type": "suite", "capacity": 2}')$q$, :'sp')) ->> 'id' AS uc \gset
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$q$, :'sp', :'ua', :'ub')) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :'sp' AND kind = 'whole_property' \gset
UPDATE hospitality.units SET base_price = 500 WHERE tenant_id = :'st';

-- ============================================================
-- 1. Units free and open for the dates
-- ============================================================
SELECT tests.check('free units: the three rooms (not the whole complex), in their order',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.public_free_units(%%L, %%L)', pg_temp.d(10), pg_temp.d(12))) -> 'units'
                  = jsonb_build_array(%L, %L, %L)$$, :'st', :'ua', :'ub', :'uc'));
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.block_create(%L, %L, %L)$q$, :'uc', pg_temp.d(10), pg_temp.d(12))) IS NOT NULL AS ok \gset
UPDATE hospitality.units SET open_until = current_date + 40 WHERE id = :'ub';
SELECT tests.check('free units: a blocked room and a room not open on those dates are left out; bad dates refused',
  format($$SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_free_units(%%L, %%L)', pg_temp.d(10), pg_temp.d(12))) -> 'units'
                  = jsonb_build_array(%2$L, %3$L)
             AND pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_free_units(%%L, %%L)', pg_temp.d(45), pg_temp.d(47))) -> 'units'
                  = jsonb_build_array(%2$L, %4$L)
             AND pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.public_free_units(%%L, %%L)', pg_temp.d(12), pg_temp.d(10))) IS NOT NULL$$,
         :'st', :'ua', :'ub', :'uc'));
UPDATE hospitality.units SET open_until = current_date + 730 WHERE id = :'ub';

-- ============================================================
-- 2. One request, two rooms
-- ============================================================
SELECT pg_temp.srv(:'st', pg_temp.grp_sql(pg_temp.rooms(:'st', pg_temp.d(20), pg_temp.d(22), :'ua', '2', '0', :'ub', '3', '1'),
                                          pg_temp.d(20), pg_temp.d(22), 'grp.guest@example.com', 'm44-group-one')) AS g1 \gset
SELECT (:'g1'::jsonb) ->> 'group_id' AS gid, (:'g1'::jsonb) -> 'bookings' -> 0 ->> 'booking_id' AS b1,
       (:'g1'::jsonb) -> 'bookings' -> 1 ->> 'booking_id' AS b2,
       (:'g1'::jsonb) -> 'bookings' -> 1 ->> 'manage_token' AS t2 \gset
SELECT tests.check('two rooms, one request: two bookings with the same group, waiting for approval, the guests per room, the total of both',
  format($$SELECT count(*) = 2 AND bool_and(status = 'pending_approval') AND count(DISTINCT guest_id) = 1
             AND (SELECT adults = 3 AND children = 1 FROM hospitality.bookings WHERE id = %2$L)
             AND (%3$L::jsonb ->> 'total')::numeric = sum(total) AND NOT (%3$L::jsonb ->> 'duplicate')::boolean
             AND array_agg(idempotency_key ORDER BY number) = ARRAY['m44-group-one-1', 'm44-group-one-2']
            FROM hospitality.bookings WHERE group_id = %1$L$$, :'gid', :'b2', :'g1'));
SELECT tests.check('one email to the guest (both rooms, a personal link for each) and one to the business — not one per room; one approval reminder',
  format($$SELECT pg_temp.mails(%1$L, 'group_request_received') = 1 AND pg_temp.mails(%1$L, 'new_group_request') = 1
             AND pg_temp.mails(%1$L, 'request_received') = 0 AND pg_temp.mails(%1$L, 'new_request') = 0
             AND (SELECT jsonb_array_length(payload -> 'rooms') = 2
                         AND bool_and(r ->> 'manage_token' ~ '^[0-9a-f]{64}$')
                         AND recipient_email = 'grp.guest@example.com'
                    FROM hospitality.notifications n, jsonb_array_elements(n.payload -> 'rooms') r
                   WHERE n.tenant_id = %1$L AND n.event = 'group_request_received'
                   GROUP BY n.payload, n.recipient_email)
             AND (SELECT NOT (n.payload::text LIKE '%%manage_token%%') FROM hospitality.notifications n
                   WHERE n.tenant_id = %1$L AND n.event = 'new_group_request')
             AND (SELECT count(*) FILTER (WHERE reminder_due_at IS NOT NULL) = 1 FROM hospitality.bookings WHERE group_id = %2$L)$$,
         :'st', :'gid'));
SELECT tests.check('the personal link of the second room opens the second room',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) ->> 'number')::integer
                  = (SELECT number FROM hospitality.bookings WHERE id = %L)$$, :'st', :'t2', :'b2'));
SELECT tests.check('the same request again: the same group, nothing new; the same key from someone else — refused',
  format($$SELECT (r ->> 'duplicate')::boolean AND r ->> 'group_id' = %2$L AND jsonb_array_length(r -> 'bookings') = 2
             AND (SELECT count(*) FROM hospitality.bookings WHERE group_id = %2$L) = 2
             AND pg_temp.mails(%1$L, 'group_request_received') = 1
             AND pg_temp.grp_err(%1$L, %3$L::jsonb, pg_temp.d(20), pg_temp.d(22), 'someone.else@example.com', 'm44-group-one') LIKE '%%כבר בשימוש%%'
            FROM (SELECT pg_temp.srv(%1$L, pg_temp.grp_sql(%3$L::jsonb, pg_temp.d(20), pg_temp.d(22), 'grp.guest@example.com', 'm44-group-one')) AS r) x$$,
         :'st', :'gid', pg_temp.rooms(:'st', pg_temp.d(20), pg_temp.d(22), :'ua', '2', '0', :'ub', '3', '1')));

-- ============================================================
-- 3. Refused — and nothing is created
-- ============================================================
SELECT tests.check('refused: one room, the same room twice, the whole complex, changed terms',
  format($$SELECT pg_temp.grp_err(%1$L, pg_temp.rooms(%1$L, pg_temp.d(30), pg_temp.d(32), %2$L, '2', '0'), pg_temp.d(30), pg_temp.d(32), 'r1@example.com', 'm44-refused-1') LIKE '%%בין 2 ל-8%%'
             AND pg_temp.grp_err(%1$L, pg_temp.rooms(%1$L, pg_temp.d(30), pg_temp.d(32), %2$L, '2', '0', %2$L, '2', '0'), pg_temp.d(30), pg_temp.d(32), 'r2@example.com', 'm44-refused-2') LIKE '%%פעם אחת%%'
             AND pg_temp.grp_err(%1$L, pg_temp.rooms(%1$L, pg_temp.d(30), pg_temp.d(32), %2$L, '2', '0', %3$L, '2', '0'), pg_temp.d(30), pg_temp.d(32), 'r3@example.com', 'm44-refused-3') LIKE '%%כל המתחם%%'
             AND pg_temp.grp_err(%1$L, jsonb_set(pg_temp.rooms(%1$L, pg_temp.d(30), pg_temp.d(32), %2$L, '2', '0', %4$L, '2', '0'), '{1,policy_hash}', '"x"'),
                                 pg_temp.d(30), pg_temp.d(32), 'r4@example.com', 'm44-refused-4') LIKE '%%תנאי ההזמנה השתנו%%'$$,
         :'st', :'ua', :'uw', :'uc'));
SELECT tests.check('a taken room: refused by its name — and the other room was not taken either (all or none)',
  format($$SELECT pg_temp.grp_err(%1$L, pg_temp.rooms(%1$L, pg_temp.d(10), pg_temp.d(12), %2$L, '2', '0', %3$L, '2', '0'),
                                  pg_temp.d(10), pg_temp.d(12), 'r5@example.com', 'm44-refused-5') LIKE '%%יחידת גן עדן%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE tenant_id = %1$L AND check_in = current_date + 10)
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE tenant_id = %1$L AND idempotency_key LIKE 'm44-refused%%')$$,
         :'st', :'ua', :'uc'));
SELECT pg_temp.srv(:'st', pg_temp.grp_sql(pg_temp.rooms(:'st', pg_temp.d(30), pg_temp.d(32), :'ua', '2', '0', :'uc', '2', '0'),
                                          pg_temp.d(30), pg_temp.d(32), 'grp.guest@example.com', 'm44-group-two')) ->> 'group_id' AS gid2 \gset
SELECT tests.check('the open-requests limit counts a request for several rooms as one: a second group goes through, a third does not; a visitor cannot call it directly',
  format($$SELECT (SELECT count(*) FROM hospitality.bookings WHERE group_id = %2$L) = 2
             AND pg_temp.grp_err(%1$L, pg_temp.rooms(%1$L, pg_temp.d(50), pg_temp.d(52), %3$L, '2', '0', %4$L, '2', '0'),
                                 pg_temp.d(50), pg_temp.d(52), 'grp.guest@example.com', 'm44-group-three') LIKE '%%בקשות פתוחות%%'
             AND NOT has_function_privilege('anon', 'hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)', 'EXECUTE')$$,
         :'st', :'gid2', :'ua', :'ub'));

-- ============================================================
-- 4. The business: the rooms of the group, approve / decline them all
-- ============================================================
SELECT tests.check('the staff sees the rooms of the group from any of its bookings',
  format($$SELECT jsonb_array_length(g -> 'bookings') = 2 AND g ->> 'group_id' = %3$L
             AND g -> 'bookings' -> 0 ->> 'unit_name' = 'יחידת אדיר' AND g -> 'bookings' -> 1 ->> 'unit_name' = 'יחידת מוריה'
            FROM (SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.booking_group(%%L)', %4$L)) AS g) x$$,
         :'st', :OWNER44, :'gid', :'b2'));
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.booking_group_decide(%L, true)$q$, :'b2')) AS dec \gset
SELECT tests.check('approve all: both rooms confirmed — one email to the guest with a new personal link for each room, none per room',
  format($$SELECT (%3$L::jsonb ->> 'decided')::integer = 2
             AND (SELECT bool_and(status = 'confirmed') FROM hospitality.bookings WHERE group_id = %2$L)
             AND pg_temp.mails(%1$L, 'group_booking_confirmed') = 1 AND pg_temp.mails(%1$L, 'booking_confirmed') = 0
             AND (SELECT jsonb_array_length(n.payload -> 'rooms') = 2
                    FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'group_booking_confirmed')$$,
         :'st', :'gid', :'dec'));
SELECT (SELECT r ->> 'manage_token' FROM hospitality.notifications n, jsonb_array_elements(n.payload -> 'rooms') r
         WHERE n.tenant_id = :'st' AND n.event = 'group_booking_confirmed' ORDER BY (r ->> 'number')::integer DESC LIMIT 1) AS t2new \gset
SELECT tests.check('the new personal link from the approval email opens that room; deciding again — nothing waiting',
  format($$SELECT (pg_temp.call(%1$L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %2$L)) ->> 'status') = 'confirmed'
             AND pg_temp.err_of(%1$L, %3$L, format('SELECT hospitality.booking_group_decide(%%L, true)', %4$L)) LIKE '%%אין בקבוצה%%'$$,
         :'st', :'t2new', :OWNER44, :'b2'));
SELECT (SELECT id FROM hospitality.bookings WHERE group_id = :'gid2' ORDER BY number LIMIT 1) AS g2b \gset
SELECT pg_temp.call(:'st', :OWNER44, format($q$SELECT hospitality.booking_group_decide(%L, false, 'אין מקום בתאריכים האלה')$q$, :'g2b')) IS NOT NULL AS ok \gset
SELECT tests.check('decline all: both rooms declined — one email to the guest with the reason; a visitor cannot decide',
  format($$SELECT (SELECT bool_and(status = 'declined') FROM hospitality.bookings WHERE group_id = %2$L)
             AND pg_temp.mails(%1$L, 'group_booking_declined') = 1 AND pg_temp.mails(%1$L, 'booking_declined') = 0
             AND (SELECT n.payload ->> 'reason' = 'אין מקום בתאריכים האלה' FROM hospitality.notifications n
                   WHERE n.tenant_id = %1$L AND n.event = 'group_booking_declined')
             AND pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.booking_group_decide(%%L, true)', %3$L)) IS NOT NULL$$,
         :'st', :'gid2', :'g2b'));

-- ============================================================
-- 5. Instant booking mode
-- ============================================================
UPDATE hospitality.settings SET booking_mode = 'instant' WHERE tenant_id = :'st';
SELECT pg_temp.srv(:'st', pg_temp.grp_sql(pg_temp.rooms(:'st', pg_temp.d(60), pg_temp.d(61), :'ua', '2', '0', :'ub', '2', '0'),
                                          pg_temp.d(60), pg_temp.d(61), 'instant.group@example.com', 'm44-group-instant')) ->> 'group_id' AS gid3 \gset
SELECT tests.check('instant mode: both rooms confirmed at once — "confirmed" to the guest and "new booking" to the business, one each',
  format($$SELECT (SELECT bool_and(status = 'confirmed') AND count(*) = 2 FROM hospitality.bookings WHERE group_id = %2$L)
             AND pg_temp.mails(%1$L, 'new_group_booking') = 1
             AND (SELECT count(*) FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'group_booking_confirmed'
                     AND n.recipient_email = 'instant.group@example.com') = 1
             AND pg_temp.mails(%1$L, 'new_booking') = 0$$,
         :'st', :'gid3'));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m44_flags m WHERE f.key = m.key;
DROP TABLE m44_flags;

-- ============================================================
-- Hospitality — open dates (migration 43 — 20261105200000_hosp_open_dates.sql)
--   • closed by default: a new unit cannot be booked on the site until the owner opens dates;
--     the staff (manual / phone bookings) may still book closed dates;
--   • units_open_dates: open, extend, shorten, close — one unit or several; range checks; another
--     business's unit and visitors refused; the action log;
--   • the guest quote: available only when every night is open (open / open_until in the answer);
--     a booking request on closed dates is refused;
--   • the site calendar: open_until, and the whole complex is busy when one of its units is (and
--     the other way round); hotel room types: a night is free when some room is open and free;
--   • the board carries open_until; the iCal feed of the whole complex has its units' bookings;
--   • the dashboard task, and the reminder email (live sites only, once a week per address).
-- The test harness opens units created by the older tests (tests.open_new_units) — off here.
-- ============================================================
\set OWNER43 '''a0000000-0000-0000-0000-000000043a01'''
\set OTHER43 '''a0000000-0000-0000-0000-000000043b01'''

ALTER TABLE hospitality.units DISABLE TRIGGER tests_open_new_units;

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.43')::text, true);
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
-- the application server (service role): booking requests, the iCal feed, the reminder sweep
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE
    json_build_object('x-tenant-id', _site, 'user-agent', 'db-test', 'x-forwarded-for', '203.0.113.43')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.srv_err(_site text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.srv(_site, _sql);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
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
-- the guest's quote (anon, the site) for a unit
CREATE OR REPLACE FUNCTION pg_temp.gq(_site text, _unit uuid, _in date, _out date) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', _unit, _in, _out));
$f$;
-- a booking request as the site sends it: quote, then request with the quote's policy hash
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _unit uuid, _in date, _out date, _key text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.gq(_site, _unit, _in, _out);
  RETURN pg_temp.srv(_site, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L)',
    _unit, _in, _out, 'אורח פתיחה', 'open.dates.guest@example.com', '0542630043', _key, q ->> 'policy_hash'));
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.open(_site text, _units uuid[], _until date) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, 'a0000000-0000-0000-0000-000000043a01',
                      format('SELECT hospitality.units_open_dates(%L::uuid[], %L::date)', _units, _until));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.busy(_av jsonb) RETURNS date[] LANGUAGE sql AS $f$
  SELECT COALESCE(array_agg(x::date ORDER BY x::date), '{}') FROM jsonb_array_elements_text(_av -> 'busy') x;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000043a01', 'm43.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000043b01', 'm43.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m43_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m43-open', 'נופי הבדיקה', 'm43.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm43.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m43-other', 'אירוח אחר', 'm43.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm43.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_booking_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset

SELECT pg_temp.call(:'st', :OWNER43,
  $q$SELECT hospitality.property_create('{"name": "נופי הבדיקה", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידת אדיר", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS ua \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידת מוריה", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS ub \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$q$, :'sp', :'ua', :'ub')) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :'sp' AND kind = 'whole_property' \gset
UPDATE hospitality.units SET base_price = 500 WHERE tenant_id = :'st';
SELECT pg_temp.call(:'so', :OTHER43,
  $q$SELECT hospitality.property_create('{"name": "מתחם אחר", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
SELECT pg_temp.call(:'so', :OTHER43, format($q$SELECT hospitality.unit_create(%L, '{"name": "יחידה אחרת", "unit_type": "suite"}')$q$, :'op')) ->> 'id' AS uo \gset

-- ============================================================
-- 1. Closed by default
-- ============================================================
SELECT tests.check('a new unit (and the whole complex) starts closed: no open dates',
  format($$SELECT bool_and(open_until IS NULL) AND count(*) = 3 FROM hospitality.units WHERE tenant_id = %L$$, :'st'));
SELECT tests.check('closed: the guest gets "not available — not open" (no error), the owner may still book it',
  format($$SELECT NOT (g ->> 'available')::boolean AND NOT (g ->> 'open')::boolean AND g -> 'open_until' = 'null'::jsonb
             AND (s ->> 'available')::boolean AND NOT (s ->> 'open')::boolean
            FROM (SELECT pg_temp.gq(%1$L, %2$L, pg_temp.d(10), pg_temp.d(12)) AS g,
                         pg_temp.call(%1$L, %3$L, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 0)', %2$L, pg_temp.d(10), pg_temp.d(12))) AS s) x$$,
         :'st', :'ua', :OWNER43));
SELECT tests.check('the site calendar of a closed unit: no open dates, nothing busy',
  format($$SELECT a -> 'open_until' = 'null'::jsonb AND pg_temp.busy(a) = '{}'
            FROM (SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %L, pg_temp.d(0), pg_temp.d(60))) AS a) x$$,
         :'st', :'ua'));

-- ============================================================
-- 2. Opening, extending, shortening, closing
-- ============================================================
SELECT pg_temp.open(:'st', ARRAY[:'ua']::uuid[], pg_temp.d(30)) AS r \gset
SELECT tests.check('open "Adir" for 30 days: saved, one unit updated, in the action log',
  format($$SELECT (%1$L::jsonb ->> 'updated')::integer = 1
             AND (SELECT open_until = current_date + 30 FROM hospitality.units WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'calendar.dates_opened'
                                                        AND a.target_label = 'יחידת אדיר' AND (a.changes ->> 'until')::date = current_date + 30)$$,
         :'r', :'ua', :'st'));
SELECT tests.check('the guest: inside the open dates — available; the last open night counts; one night past it — not open',
  format($$SELECT (pg_temp.gq(%1$L, %2$L, pg_temp.d(10), pg_temp.d(12)) ->> 'available')::boolean
             AND (pg_temp.gq(%1$L, %2$L, pg_temp.d(10), pg_temp.d(12)) ->> 'open')::boolean
             AND (pg_temp.gq(%1$L, %2$L, pg_temp.d(29), pg_temp.d(31)) ->> 'available')::boolean
             AND NOT (pg_temp.gq(%1$L, %2$L, pg_temp.d(30), pg_temp.d(32)) ->> 'available')::boolean
             AND NOT (pg_temp.gq(%1$L, %2$L, pg_temp.d(30), pg_temp.d(32)) ->> 'open')::boolean
             AND (pg_temp.gq(%1$L, %2$L, pg_temp.d(30), pg_temp.d(32)) ->> 'open_until')::date = current_date + 30$$,
         :'st', :'ua'));
SELECT tests.check('opening the same again changes nothing (no extra log line)',
  format($$SELECT (pg_temp.open(%1$L, ARRAY[%2$L]::uuid[], pg_temp.d(30)) ->> 'updated')::integer = 0
             AND (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'calendar.dates_opened') = 1$$,
         :'st', :'ua'));
SELECT pg_temp.open(:'st', ARRAY[:'ua', :'ub', :'uw']::uuid[], pg_temp.d(60)) IS NOT NULL AS ok \gset
SELECT pg_temp.open(:'st', ARRAY[:'ub']::uuid[], pg_temp.d(15)) IS NOT NULL AS ok \gset
SELECT tests.check('several units at once (60 days), then one shortened (15 days)',
  format($$SELECT (SELECT open_until FROM hospitality.units WHERE id = %1$L) = current_date + 60
             AND (SELECT open_until FROM hospitality.units WHERE id = %2$L) = current_date + 15
             AND (SELECT open_until FROM hospitality.units WHERE id = %3$L) = current_date + 60$$,
         :'ua', :'ub', :'uw'));
SELECT pg_temp.open(:'st', ARRAY[:'ub']::uuid[], NULL) IS NOT NULL AS ok \gset
SELECT tests.check('close: no open dates again, "closed" in the action log; the guest cannot book it',
  format($$SELECT (SELECT open_until IS NULL FROM hospitality.units WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'calendar.dates_closed'
                                                        AND a.target_label = 'יחידת מוריה')
             AND NOT (pg_temp.gq(%2$L, %1$L, pg_temp.d(3), pg_temp.d(4)) ->> 'available')::boolean$$,
         :'ub', :'st'));
SELECT pg_temp.open(:'st', ARRAY[:'ub']::uuid[], pg_temp.d(60)) IS NOT NULL AS ok \gset
SELECT tests.check('refused: a past date, more than two years ahead, no units, a unit of another business, a visitor',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.units_open_dates(ARRAY[%%L]::uuid[], %%L)', %3$L, pg_temp.d(-1))) LIKE '%%כבר עבר%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.units_open_dates(ARRAY[%%L]::uuid[], %%L)', %3$L, pg_temp.d(731))) LIKE '%%שנתיים%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.units_open_dates(%%L::uuid[], %%L)', '{}', pg_temp.d(5))) LIKE '%%לא נבחרו%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.units_open_dates(ARRAY[%%L]::uuid[], %%L)', %4$L, pg_temp.d(5))) LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.units_open_dates(ARRAY[%%L]::uuid[], %%L)', %3$L, pg_temp.d(5))) IS NOT NULL
             AND (SELECT open_until IS NULL FROM hospitality.units WHERE id = %4$L)
             AND (SELECT open_until = current_date + 60 FROM hospitality.units WHERE id = %3$L)$$,
         :'st', :OWNER43, :'ua', :'uo'));

-- ============================================================
-- 3. Booking requests, and the whole complex on the site calendar
-- ============================================================
SELECT tests.check('a booking request on closed dates is refused',
  format($$SELECT pg_temp.srv_err(%1$L, format(
             'SELECT hospitality.request_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L, _full_name => %%L,
                _email => %%L, _phone => %%L, _idempotency_key => %%L, _policy_accepted => true, _policy_hash => %%L)',
             %2$L, pg_temp.d(61), pg_temp.d(63), 'אורח', 'closed.dates@example.com', '0542630044', 'm43-closed-1',
             pg_temp.call(%1$L, %3$L, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 0)', %2$L, pg_temp.d(61), pg_temp.d(63))) ->> 'policy_hash')) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE tenant_id = %1$L)$$,
         :'st', :'ua', :OWNER43));
SELECT pg_temp.req(:'st', :'ua', pg_temp.d(10), pg_temp.d(12), 'm43-open-1') ->> 'booking_id' AS b1 \gset
SELECT tests.check('a request on open dates goes through',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.bookings WHERE id = %L AND status = 'pending_approval')$$, :'b1'));
SELECT tests.check('the site calendar: "Adir" booked → the whole complex is busy those nights too; "Moriya" is not; open_until is there',
  format($$SELECT pg_temp.busy(w) = ARRAY[current_date + 10, current_date + 11]
             AND pg_temp.busy(a) = ARRAY[current_date + 10, current_date + 11]
             AND pg_temp.busy(b) = '{}'
             AND (w ->> 'open_until')::date = current_date + 60
            FROM (SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %2$L, pg_temp.d(0), pg_temp.d(30))) AS w,
                         pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %3$L, pg_temp.d(0), pg_temp.d(30))) AS a,
                         pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %4$L, pg_temp.d(0), pg_temp.d(30))) AS b) x$$,
         :'st', :'uw', :'ua', :'ub'));
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.block_create(%L, %L, %L, 'שיפוץ')$q$, :'uw', pg_temp.d(20), pg_temp.d(22))) IS NOT NULL AS ok \gset
SELECT tests.check('the other way round: the whole complex blocked → each of its units is busy those nights',
  format($$SELECT pg_temp.busy(pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_availability(%%L, %%L, %%L)', %2$L, pg_temp.d(15), pg_temp.d(25))))
                  = ARRAY[current_date + 20, current_date + 21]$$, :'st', :'ub'));

-- ============================================================
-- 4. The board and the iCal feed
-- ============================================================
SELECT tests.check('the board: every unit carries its open dates',
  format($$SELECT (SELECT (x ->> 'open_until')::date FROM jsonb_array_elements(c -> 'units') x WHERE x ->> 'id' = %3$L) = current_date + 60
             AND (SELECT (x ->> 'open_until')::date FROM jsonb_array_elements(c -> 'units') x WHERE x ->> 'id' = %4$L) = current_date + 60
            FROM (SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.calendar(%%L, %%L)', pg_temp.d(0), pg_temp.d(30))) AS c) x$$,
         :'st', :OWNER43, :'ua', :'uw'));
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT to_jsonb(hospitality.channel_feed_token(%L))$q$, :'uw')) #>> '{}' AS feed \gset
SELECT tests.check('the iCal feed of the whole complex has the booking of "Adir" (its unit) and its own block — once each',
  format($$SELECT (SELECT count(*) FROM jsonb_array_elements(f -> 'events') e WHERE e ->> 'uid' = %3$L) = 1
             AND (SELECT count(*) FROM jsonb_array_elements(f -> 'events') e WHERE e ->> 'kind' = 'block') = 1
            FROM (SELECT pg_temp.srv(NULL, format('SELECT hospitality.channel_feed(%%L, %%L)', %1$L, %2$L)) AS f) x$$,
         :'st', :'feed', :'b1'));

-- ============================================================
-- 5. Hotel room types: free = some room of the type is open and free
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER43,
  $q$SELECT hospitality.property_create('{"name": "בית החדרים", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS hp \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.room_type_save(NULL, %L, 'חדר זוגי')$q$, :'hp')) ->> 'id' AS cat \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.unit_create(%L, '{"name": "חדר 1", "unit_type": "room"}')$q$, :'hp')) ->> 'id' AS r1 \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.unit_create(%L, '{"name": "חדר 2", "unit_type": "room"}')$q$, :'hp')) ->> 'id' AS r2 \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT to_jsonb(hospitality.room_type_assign(%L, %L))$q$, :'r1', :'cat')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT to_jsonb(hospitality.room_type_assign(%L, %L))$q$, :'r2', :'cat')) IS NOT NULL AS ok \gset
UPDATE hospitality.units SET base_price = 400 WHERE id IN (:'r1', :'r2');
SELECT pg_temp.open(:'st', ARRAY[:'r1']::uuid[], pg_temp.d(20)) IS NOT NULL AS ok \gset
SELECT tests.check('room type: open until the last open room; the nights after it are not free (room 2 is closed)',
  format($$SELECT (t ->> 'open_until')::date = current_date + 20
             AND pg_temp.busy(t) = ARRAY[current_date + 21, current_date + 22, current_date + 23, current_date + 24]
            FROM (SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_type_availability(%%L, %%L, %%L)', %2$L, pg_temp.d(1), pg_temp.d(25))) AS t) x$$,
         :'st', :'cat'));
SELECT pg_temp.call(:'st', :OWNER43, format($q$SELECT hospitality.block_create(%L, %L, %L)$q$, :'r1', pg_temp.d(5), pg_temp.d(6))) IS NOT NULL AS ok \gset
SELECT tests.check('room type: room 1 blocked on a night → that night is not free (room 2 is closed); the guest quote skips the closed room',
  format($$SELECT current_date + 5 = ANY (pg_temp.busy(pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_type_availability(%%L, %%L, %%L)', %2$L, pg_temp.d(1), pg_temp.d(25)))))
             AND NOT (pg_temp.call(%1$L, NULL, format('SELECT hospitality.quote_type(%%L, %%L, %%L)', %2$L, pg_temp.d(5), pg_temp.d(6))) ->> 'available')::boolean
             AND (SELECT (q ->> 'available')::boolean AND q ->> 'unit_id' = %3$L
                    FROM pg_temp.call(%1$L, NULL, format('SELECT hospitality.quote_type(%%L, %%L, %%L)', %2$L, pg_temp.d(7), pg_temp.d(8))) q)$$,
         :'st', :'cat', :'r1'));

-- ============================================================
-- 6. The dashboard task and the reminder email
-- ============================================================
SELECT tests.check('dashboard: "open dates" — 1 unit closed (room 2), urgent',
  format($$SELECT (t ->> 'closed')::integer = 1 AND (t ->> 'ending')::integer = 0 AND t ->> 'severity' = 'high'
            FROM jsonb_array_elements(pg_temp.call(%L, %L, 'SELECT hospitality.dashboard_tasks()') -> 'items') t
           WHERE t ->> 'kind' = 'open_dates'$$, :'st', :OWNER43));
SELECT pg_temp.open(:'st', ARRAY[:'r2']::uuid[], pg_temp.d(10)) IS NOT NULL AS ok \gset
SELECT tests.check('dashboard: room 2 open for 10 days → "ending soon", with the date',
  format($$SELECT (t ->> 'closed')::integer = 0 AND (t ->> 'ending')::integer = 1 AND t ->> 'severity' = 'medium'
             AND (t ->> 'until')::date = current_date + 10
            FROM jsonb_array_elements(pg_temp.call(%L, %L, 'SELECT hospitality.dashboard_tasks()') -> 'items') t
           WHERE t ->> 'kind' = 'open_dates'$$, :'st', :OWNER43));

SELECT pg_temp.srv(NULL, 'SELECT to_jsonb(hospitality.open_dates_remind())') IS NOT NULL AS ok \gset
SELECT tests.check('reminder email: the live site gets one, to the owner — the unit and its last open night, no guest details',
  format($$SELECT count(*) = 1
             AND bool_and(n.recipient_email = 'm43.owner@test.local' AND n.recipient_kind = 'owner' AND n.booking_id IS NULL
                          AND (n.payload ->> 'ending_count')::integer = 1 AND (n.payload ->> 'closed_count')::integer = 0
                          AND n.payload -> 'units' = jsonb_build_array(jsonb_build_object('name', 'חדר 2', 'open_until', current_date + 10)))
            FROM hospitality.notifications n WHERE n.tenant_id = %L AND n.event = 'open_dates_reminder'$$, :'st'));
SELECT pg_temp.srv(NULL, 'SELECT to_jsonb(hospitality.open_dates_remind())') IS NOT NULL AS ok \gset
SELECT tests.check('reminder email: once a week — a second run the same week adds nothing; a site not open for bookings gets none',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'open_dates_reminder') = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.tenant_id = %2$L AND n.event = 'open_dates_reminder')$$,
         :'st', :'so'));
SELECT pg_temp.open(:'st', ARRAY[:'r2']::uuid[], pg_temp.d(90)) IS NOT NULL AS ok \gset
SELECT tests.check('everything open for more than 14 days → no task; the reminder is for the staff only (no visitor may run it)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.dashboard_tasks()') -> 'items') t
                               WHERE t ->> 'kind' = 'open_dates')
             AND NOT has_function_privilege('anon', 'hospitality.open_dates_remind()', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'hospitality.open_dates_remind()', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'hospitality.units_open_dates(uuid[],date)', 'EXECUTE')$$,
         :'st', :OWNER43));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m43_flags m WHERE f.key = m.key;
DROP TABLE m43_flags;
ALTER TABLE hospitality.units ENABLE TRIGGER tests_open_new_units;

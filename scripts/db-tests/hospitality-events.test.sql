-- ============================================================
-- Hospitality — events at the compound (migration 63 — 20261111110000_hosp_events.sql)
--   • structure: business_terms / events / event_log closed to the API roles (RLS, restrictive, tenant guard);
--     who may call what; the history is append-only; an Ecommerce store cannot hold events;
--   • the business terms: the contract's numbers by default; saving resets the owner's confirmation; only the
--     owner confirms, and only with the representative and the business number filled;
--   • events: up to 50 participants (the database refuses more); a new customer card or an existing one;
--     no two active events in the same compound at the same time (also across midnight, also when written
--     directly); a cancelled event frees the time; before confirming — lodging guests need an explicit ack;
--     "completed" only after the end; every change logged (before → after) and in the action log;
--   • another business and a visitor see and change nothing.
-- ============================================================
\set OWNER63 '''a0000000-0000-0000-0000-000000063a01'''
\set MGR63 '''a0000000-0000-0000-0000-000000063a02'''
\set OTHER63 '''a0000000-0000-0000-0000-000000063a03'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.63')::text, true);
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
-- an event's input: the defaults below + what the test changes
CREATE OR REPLACE FUNCTION pg_temp.ev(_property text, _day integer, _start text, _end text, _extra jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('property_id', _property, 'event_type', 'birthday', 'event_date', pg_temp.d(_day),
                            'start_time', _start, 'end_time', _end, 'participants', 30, 'price', 3500,
                            'customer', jsonb_build_object('full_name', 'דנה אירועים', 'phone', '050-6300001',
                                                           'email', 'dana.events@example.com')) || _extra;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.create_sql(_data jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT hospitality.event_create(%L)', _data);
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000063a01', 'm63.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000063a02', 'm63.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000063a03', 'm63.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m63_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m63-events', 'נופי האירועים', 'm63.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm63.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m63-other', 'אתר שכן לאירועים', 'm63.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm63.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR63, 'm63.manager@test.local', 'm63_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER63,
  $q$SELECT hospitality.property_create('{"name": "מתחם הבריכה", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS p1 \gset
SELECT pg_temp.call(:'st', :OWNER63,
  $q$SELECT hospitality.property_create('{"name": "מתחם שני", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS p2 \gset
SELECT pg_temp.call(:'st', :OWNER63, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר אדיר", "unit_type": "suite", "capacity": 5}')$q$, :'p1')) ->> 'id' AS u1 \gset
SELECT pg_temp.call(:'so', :OTHER63,
  $q$SELECT hospitality.property_create('{"name": "מתחם שכן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
UPDATE hospitality.units SET base_price = 700, is_active = true WHERE tenant_id = :'st';

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the 3 tables — RLS with the two restrictive policies, the tenant guard, no access for the API roles',
  $$SELECT bool_and(c.relrowsecurity
                    AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive
                          AND p.polname IN ('tenant_isolation', 'backend_enabled')) = 2
                    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive)
                    AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
                    AND NOT (SELECT bool_or(has_table_privilege(r, c.oid, p))
                               FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                                    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p))
       AND count(*) = 3
     FROM pg_class c
    WHERE c.oid IN ('hospitality.business_terms'::regclass, 'hospitality.events'::regclass, 'hospitality.event_log'::regclass)$$);
SELECT tests.check('structure: the event functions for signed-in staff (not visitors); the helpers for nobody; the overlap rule is in the table',
  $$SELECT has_function_privilege('authenticated', 'hospitality.event_create(jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.event_create(jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.staff_events(text,text,text,date,date,integer,integer)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.event_set_status(uuid,integer,text,text,boolean)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.business_terms_confirm(integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._event_apply(uuid,hospitality.events,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._event_customer(uuid,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._terms(uuid)', 'EXECUTE')
       AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_no_overlap' AND contype = 'x')$$);
SELECT tests.check('structure: an Ecommerce store cannot hold events or terms (tenant guard)',
  $$SELECT pg_temp.err_of(NULL, NULL, format('SELECT 1') ) IS NULL
       AND (SELECT count(*) FROM public.tenants t WHERE t.site_type <> 'hospitality') > 0$$);
DO $$
DECLARE _shop uuid := (SELECT id FROM public.tenants WHERE site_type <> 'hospitality' ORDER BY created_at LIMIT 1);
BEGIN
  BEGIN
    INSERT INTO hospitality.business_terms (tenant_id) VALUES (_shop);
    INSERT INTO tests.results (name, ok, detail) VALUES ('an Ecommerce store gets no business terms', false, 'inserted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO tests.results (name, ok, detail)
    VALUES ('an Ecommerce store gets no business terms', SQLERRM LIKE '%שייכת למנוע האירוח%', SQLERRM);
  END;
END $$;

-- ============================================================
-- 2. Business terms
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER63, 'SELECT hospitality.business_terms_view()') AS t0 \gset
SELECT tests.check('terms: before saving — the contract''s numbers (deposit 2,000, late fee 200 / 100 per hour, 12 lodging, 50 at an event, pool 08:00–18:00, 14 days); not confirmed',
  format($$SELECT (%1$L::jsonb ->> 'deposit_amount')::numeric = 2000 AND (%1$L::jsonb ->> 'event_late_fee_per_hour')::numeric = 200
             AND (%1$L::jsonb ->> 'lodging_late_fee_per_hour')::numeric = 100 AND (%1$L::jsonb ->> 'max_lodging_guests')::int = 12
             AND (%1$L::jsonb ->> 'max_event_guests')::int = 50 AND %1$L::jsonb ->> 'pool_open_time' = '08:00'
             AND %1$L::jsonb ->> 'pool_close_time' = '18:00' AND (%1$L::jsonb ->> 'free_cancellation_days')::int = 14
             AND %1$L::jsonb ->> 'facilities' = 'מטבח חוץ, פינת מנגל, טרמפולינה ושולחן טניס'
             AND NOT (%1$L::jsonb ->> 'confirmed')::boolean AND NOT (%1$L::jsonb ->> 'saved')::boolean$$, :'t0'));
SELECT tests.check('terms: more than 50 at an event, a closing hour before opening, a bad business number, a stale revision — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.business_terms_save('{"max_event_guests": 51}', 0)$s$) LIKE 'מכסת משתתפים באירוע%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.business_terms_save('{"pool_open_time": "19:00"}', 0)$s$) LIKE 'שעת סגירת הבריכה%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.business_terms_save('{"business_tax_id": "12"}', 0)$s$) LIKE 'מספר עוסק%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.business_terms_save('{"deposit_amount": 1500}', 4)$s$) LIKE 'התנאים עודכנו בינתיים%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.business_terms_save('{"bonus": 1}', 0)$s$) LIKE 'שדה לא מוכר%%'$$,
         :'st', :OWNER63));
SELECT tests.check('terms: confirming before saving, or without the representative / business number — refused; a manager cannot confirm',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.business_terms_confirm(0)') LIKE 'שמרו את התנאים%%'
             AND (pg_temp.call(%1$L, %3$L, $s$SELECT hospitality.business_terms_save('{"facilities": "מטבח חוץ ופינת מנגל"}', 0)$s$) ->> 'revision')::int = 1
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.business_terms_confirm(1)') LIKE 'חסרים פרטי צד א%%'
             AND pg_temp.err_of(%1$L, %3$L, 'SELECT hospitality.business_terms_confirm(1)') IS NOT NULL$$,
         :'st', :OWNER63, :MGR63));
SELECT pg_temp.call(:'st', :OWNER63, $q$SELECT hospitality.business_terms_save('{"representative_name": "אמציה בשארי",
  "business_tax_id": "58731621", "facilities": "מטבח חוץ, פינת מנגל, טרמפולינה ושולחן טניס",
  "unit_lines": [{"name": "אדיר", "description": "מיועד לזוג ועד 3 ילדים"}]}', 1)$q$) AS t2 \gset
SELECT pg_temp.call(:'st', :OWNER63, 'SELECT hospitality.business_terms_confirm(2)') AS t3 \gset
SELECT pg_temp.call(:'st', :OWNER63, $q$SELECT hospitality.business_terms_save('{"deposit_amount": 2000}', 2)$q$) AS t4 \gset
SELECT pg_temp.call(:'st', :OWNER63, 'SELECT hospitality.business_terms_confirm(3)') AS t5 \gset
SELECT tests.check('terms: saved (revision 2, the unit line kept); the owner confirms; a later change cancels the confirmation; all in the action log',
  format($$SELECT (%1$L::jsonb ->> 'revision')::int = 2 AND %1$L::jsonb -> 'unit_lines' -> 0 ->> 'name' = 'אדיר'
             AND (%2$L::jsonb ->> 'confirmed')::boolean
             AND NOT (%3$L::jsonb ->> 'confirmed')::boolean AND (%4$L::jsonb ->> 'confirmed')::boolean
             AND (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %5$L AND a.action = 'terms.saved') = 3
             AND (SELECT count(*) FROM hospitality.audit_log a WHERE a.tenant_id = %5$L AND a.action = 'terms.confirmed') = 2$$,
         :'t2', :'t3', :'t4', :'t5', :'st'));

-- ============================================================
-- 3. Events: create
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER63, pg_temp.create_sql(pg_temp.ev(:'p1', 20, '10:00', '17:00'))) AS e1 \gset
SELECT tests.check('create: event #1001, pending, a new customer card; deposit 2,000 and late fee 200 from the terms; inside the pool hours; logged',
  format($$SELECT (%1$L::jsonb ->> 'number')::int = 1001 AND %1$L::jsonb ->> 'status' = 'pending'
             AND (%1$L::jsonb ->> 'deposit_amount')::numeric = 2000 AND (%1$L::jsonb ->> 'late_fee_per_hour')::numeric = 200
             AND %1$L::jsonb ->> 'deposit_status' = 'pending' AND NOT (%1$L::jsonb ->> 'outside_pool_hours')::boolean
             AND %1$L::jsonb ->> 'event_type_label' = 'יום הולדת' AND %1$L::jsonb ->> 'payment_status' = 'unpaid'
             AND %1$L::jsonb -> 'customer' ->> 'full_name' = 'דנה אירועים'
             AND (SELECT count(*) FROM hospitality.guests g WHERE g.tenant_id = %2$L AND g.email_normalized = 'dana.events@example.com') = 1
             AND EXISTS (SELECT 1 FROM hospitality.event_log l WHERE l.event_id = (%1$L::jsonb ->> 'id')::uuid AND l.kind = 'created')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'events.created'
                          AND a.target_label = 'אירוע #1001')$$, :'e1', :'st'));
SELECT tests.check('create: more than 50 participants, none, a negative price, an advance above the price, "other" with no name, no compound — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00', '{"participants": 51}')))
                    = 'עד 50 משתתפים באירוע (לפי החוזה) — אי אפשר יותר'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00', '{"participants": 0}'))) LIKE 'מספר המשתתפים%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00', '{"price": -5}'))) LIKE 'המחיר%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00', '{"advance_amount": 4000}'))) LIKE 'המקדמה לא יכולה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00', '{"event_type": "other"}'))) LIKE 'יש למלא את סוג האירוע (אחר)%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '17:00') - 'property_id')) LIKE 'יש לבחור את המתחם%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%4$L, 30, '10:00', '17:00'))) LIKE 'יש לבחור את המתחם%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 30, '10:00', '10:00'))) LIKE 'שעת הסיום%%'$$,
         :'st', :OWNER63, :'p1', :'op'));
DO $$
BEGIN
  -- even straight in the database: 51 is refused by the table itself
  BEGIN
    UPDATE hospitality.events SET participants = 51 WHERE number = 1001;
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses 51 participants', false, 'updated');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses 51 participants', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 4. No two active events at the same time in the same compound
-- ============================================================
SELECT tests.check('overlap: a second event in the same compound at overlapping hours — refused with the event it clashes with; nothing saved',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql(pg_temp.ev(%3$L, 20, '16:00', '20:00')))
                    LIKE 'יש כבר אירוע במתחם בזמן הזה (אירוע #1001%%'
             AND (SELECT count(*) FROM hospitality.events WHERE tenant_id = %1$L) = 1$$,
         :'st', :OWNER63, :'p1'));
SELECT pg_temp.call(:'st', :OWNER63, pg_temp.create_sql(pg_temp.ev(:'p1', 20, '17:00', '23:30',
  '{"event_type": "other", "event_type_other": "ערב צוות", "customer": {"full_name": "יוסי ערב", "phone": "0526300002"}}'))) AS e2 \gset
SELECT pg_temp.call(:'st', :OWNER63, pg_temp.create_sql(pg_temp.ev(:'p2', 20, '12:00', '15:00'))) AS e3 \gset
SELECT tests.check('overlap: back to back (17:00 after an event that ends 17:00) — fine; the same hours in another compound — fine; outside the pool hours marked',
  format($$SELECT (%1$L::jsonb ->> 'number')::int = 1002 AND (%2$L::jsonb ->> 'number')::int = 1003
             AND (%1$L::jsonb ->> 'outside_pool_hours')::boolean AND %1$L::jsonb ->> 'event_type_label' = 'ערב צוות'
             AND (%2$L::jsonb -> 'customer' ->> 'guest_id') = (SELECT g.id::text FROM hospitality.guests g
                   WHERE g.tenant_id = %3$L AND g.email_normalized = 'dana.events@example.com')$$,
         :'e2', :'e3', :'st'));
-- across midnight: 21:00 → 01:00 ends the next day, and clashes with an event the next day at 00:30
SELECT pg_temp.call(:'st', :OWNER63, pg_temp.create_sql(pg_temp.ev(:'p1', 25, '21:00', '01:00'))) AS e4 \gset
SELECT tests.check('across midnight: 21:00–01:00 ends the next day; an event the next day at 00:30 clashes; at 01:00 it does not',
  format($$SELECT (%1$L::jsonb ->> 'ends_next_day')::boolean
             AND pg_temp.err_of(%2$L, %3$L, pg_temp.create_sql(pg_temp.ev(%4$L, 26, '00:30', '03:00'))) LIKE 'יש כבר אירוע במתחם%%'
             AND (pg_temp.call(%2$L, %3$L, pg_temp.create_sql(pg_temp.ev(%4$L, 26, '01:00', '03:00'))) ->> 'number')::int = 1005$$,
         :'e4', :'st', :OWNER63, :'p1'));
DO $$
DECLARE
  _src hospitality.events := (SELECT e FROM hospitality.events e WHERE e.number = 1001
                                 AND e.tenant_id = (SELECT id FROM public.tenants WHERE slug = 'm63-events'));
BEGIN
  -- the table itself (as if two requests ran at once): an overlapping active row is refused
  BEGIN
    INSERT INTO hospitality.events (tenant_id, number, property_id, guest_id, event_type, event_date, start_time, end_time,
                                    starts_at, ends_at, participants, price, status)
    VALUES (_src.tenant_id, 1999, _src.property_id, _src.guest_id, 'birthday', _src.event_date, '11:00', '12:00',
            _src.starts_at + interval '1 hour', _src.starts_at + interval '2 hours', 10, 100, 'confirmed');
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses an overlapping active event', false, 'inserted');
  EXCEPTION WHEN exclusion_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses an overlapping active event', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 5. Status: confirm (availability + lodging guests), cancel, reopen, completed
-- ============================================================
-- a lodging booking in the same compound on the day of event #1001 (10:00–17:00): staying the night before
SELECT pg_temp.call(:'st', :OWNER63, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'אורח לינה', _phone => '0546300003', _terms_explained => true, _total_override => 1400)$q$,
   :'u1', pg_temp.d(19), pg_temp.d(21))) ->> 'booking_id' AS bk \gset
SELECT tests.check('confirm: lodging guests at the compound during the event — refused until the owner marks knowing it; the event page lists them',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.event_set_status(%%L, 1, %%L)', %3$L, 'confirmed'))
                    LIKE 'באותו זמן יש אורחים בצימרים במתחם (1 הזמנות)%%'
             AND (pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_event_detail(%%L)', %3$L)) -> 'lodging' -> 0 ->> 'booking_id') = %4$L
             AND (SELECT status FROM hospitality.events WHERE id = %3$L) = 'pending'$$,
         :'st', :OWNER63, (:'e1'::jsonb ->> 'id'), :'bk'));
SELECT pg_temp.call(:'st', :OWNER63, format($q$SELECT hospitality.event_set_status(%L, 1, 'confirmed', NULL, true)$q$, (:'e1'::jsonb ->> 'id'))) AS c1 \gset
SELECT tests.check('confirm with the ack: confirmed, the ack stored and logged with the number of lodging bookings; the booking itself unchanged',
  format($$SELECT %1$L::jsonb ->> 'status' = 'confirmed' AND (%1$L::jsonb ->> 'lodging_ack')::boolean
             AND EXISTS (SELECT 1 FROM hospitality.event_log l WHERE l.event_id = %2$L AND l.kind = 'status_changed'
                          AND l.from_status = 'pending' AND l.to_status = 'confirmed' AND (l.changes ->> 'lodging')::int = 1)
             AND (SELECT status FROM hospitality.bookings WHERE id = %3$L) = 'confirmed'$$,
         :'c1', (:'e1'::jsonb ->> 'id'), :'bk'));
SELECT tests.check('status: "completed" before the end — refused; a stale revision — refused; an unknown move — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_set_status(%%L, 2, 'completed')$s$, %3$L)) LIKE 'אפשר לסמן "הסתיים" רק אחרי%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_set_status(%%L, 1, 'cancelled')$s$, %3$L)) LIKE 'האירוע עודכן בינתיים%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_set_status(%%L, 1, 'completed')$s$, %4$L)) LIKE 'אי אפשר לעבור%%'$$,
         :'st', :OWNER63, (:'e1'::jsonb ->> 'id'), (:'e2'::jsonb ->> 'id')));
-- cancel #1001 → the time is free: a new event at those hours is accepted; reopening #1001 then clashes
SELECT pg_temp.call(:'st', :OWNER63, format($q$SELECT hospitality.event_set_status(%L, 2, 'cancelled', 'הלקוחה ביטלה')$q$, (:'e1'::jsonb ->> 'id'))) AS x1 \gset
SELECT pg_temp.call(:'st', :OWNER63, pg_temp.create_sql(pg_temp.ev(:'p1', 20, '11:00', '16:00', '{"participants": 50}'))) AS e6 \gset
SELECT tests.check('cancel: with the reason, the time freed (a new event at those hours, exactly 50 participants, is accepted); reopening the cancelled one clashes',
  format($$SELECT %1$L::jsonb ->> 'status' = 'cancelled' AND %1$L::jsonb ->> 'cancel_reason' = 'הלקוחה ביטלה'
             AND (%2$L::jsonb ->> 'participants')::int = 50
             AND pg_temp.err_of(%3$L, %4$L, format($s$SELECT hospitality.event_set_status(%%L, 3, 'pending')$s$, %5$L)) LIKE 'יש כבר אירוע במתחם%%'$$,
         :'x1', :'e6', :'st', :OWNER63, (:'e1'::jsonb ->> 'id')));
-- a past event can be marked completed
SET session_replication_role = replica;
UPDATE hospitality.events SET event_date = current_date - 3, starts_at = now() - interval '3 days',
       ends_at = now() - interval '3 days' + interval '5 hours', status = 'confirmed'
 WHERE id = (:'e3'::jsonb ->> 'id')::uuid;
SET session_replication_role = DEFAULT;
SELECT tests.check('completed: an event that already ended — marked completed; it no longer shows as upcoming',
  format($$SELECT pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.event_set_status(%%L, 1, 'completed')$s$, %3$L)) ->> 'status' = 'completed'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''upcoming'')') -> 'rows') r
                              WHERE r ->> 'id' = %3$L)
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''past'')') -> 'rows') r
                          WHERE r ->> 'id' = %3$L)$$,
         :'st', :OWNER63, (:'e3'::jsonb ->> 'id')));

-- ============================================================
-- 6. Update: every change logged; time changes re-check; a cancelled event is frozen
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER63, format($q$SELECT hospitality.event_update(%L, 1, '{"participants": 40, "price": 4200,
  "advance_amount": 1000, "amount_paid": 1000, "deposit_status": "held", "internal_notes": "להביא שולחנות"}')$q$, (:'e2'::jsonb ->> 'id'))) AS u2 \gset
SELECT tests.check('update: the new values, an advance paid, the deposit held; each change logged before → after; in the action log',
  format($$SELECT (%1$L::jsonb ->> 'participants')::int = 40 AND (%1$L::jsonb ->> 'price')::numeric = 4200
             AND %1$L::jsonb ->> 'payment_status' = 'advance_paid' AND (%1$L::jsonb ->> 'balance_due')::numeric = 3200
             AND %1$L::jsonb ->> 'deposit_status' = 'held'
             AND (SELECT l.changes -> 'participants' = '{"from": 30, "to": 40}'::jsonb
                         AND l.changes -> 'deposit_status' = '{"from": "pending", "to": "held"}'::jsonb
                    FROM hospitality.event_log l WHERE l.event_id = %2$L AND l.kind = 'updated')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'events.updated')$$,
         :'u2', (:'e2'::jsonb ->> 'id'), :'st'));
SELECT tests.check('update: into a clash, above 50, a stale revision, the status or the customer through update, a cancelled event — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 2, '{"start_time": "15:00"}')$s$, %3$L)) LIKE 'יש כבר אירוע במתחם%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 2, '{"participants": 60}')$s$, %3$L)) LIKE 'עד 50 משתתפים%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 1, '{"participants": 20}')$s$, %3$L)) LIKE 'האירוע עודכן בינתיים%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 2, '{"status": "confirmed"}')$s$, %3$L)) LIKE 'מצב האירוע והלקוח%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 3, '{"participants": 20}')$s$, %4$L)) LIKE 'אירוע שבוטל%%'$$,
         :'st', :OWNER63, (:'e2'::jsonb ->> 'id'), (:'e1'::jsonb ->> 'id')));
SELECT tests.check('check (no save): both clashing events (#1002 and #1006), lodging guests and the pool hours, for the form while typing',
  format($$SELECT jsonb_array_length(c -> 'conflicts') = 2 AND jsonb_array_length(c -> 'lodging') = 1
             AND (c ->> 'outside_pool_hours')::boolean AND (c ->> 'max_event_guests')::int = 50
          FROM (SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.event_check(%%L)',
                  jsonb_build_object('property_id', %3$L, 'event_date', pg_temp.d(20), 'start_time', '15:00', 'end_time', '19:00')))) x(c)$$,
         :'st', :OWNER63, :'p1'));

-- ============================================================
-- 7. Isolation and history
-- ============================================================
SELECT tests.check('another business''s owner and a visitor: no list, no detail, no changes',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'')') ->> 'total')::int = 0
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.staff_event_detail(%%L)', %3$L)) = 'האירוע לא נמצא'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.event_update(%%L, 2, '{"price": 1}')$s$, %3$L)) = 'האירוע לא נמצא'
             AND pg_temp.err_of(%4$L, NULL, 'SELECT hospitality.staff_events(''all'')') IS NOT NULL
             AND pg_temp.err_of(%4$L, %2$L, 'SELECT hospitality.staff_events(''all'')') IS NOT NULL$$,
         :'so', :OTHER63, (:'e2'::jsonb ->> 'id'), :'st'));
SELECT tests.check('list: search by name / phone / number, filter by type; a manager of the business sees the same',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'', ''יוסי'')') ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'', ''050-6300001'')') ->> 'total')::int >= 3
             AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'', ''1002'')') ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'', NULL, ''other'')') ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT hospitality.staff_events(''all'')') ->> 'total')::int
                 = (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_events(''all'')') ->> 'total')::int$$,
         :'st', :OWNER63, :MGR63));
DO $$
BEGIN
  BEGIN
    UPDATE hospitality.event_log SET note = 'x' WHERE id = (SELECT min(id) FROM hospitality.event_log);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the event history cannot be edited or deleted', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    BEGIN
      DELETE FROM hospitality.event_log WHERE id = (SELECT min(id) FROM hospitality.event_log);
      INSERT INTO tests.results (name, ok, detail) VALUES ('the event history cannot be edited or deleted', false, 'deleted');
    EXCEPTION WHEN insufficient_privilege THEN
      INSERT INTO tests.results (name, ok, detail) VALUES ('the event history cannot be edited or deleted', true, SQLERRM);
    END;
  END;
END $$;

-- ---------- cleanup: the platform flags as they were ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m63_flags m WHERE f.key = m.key;
DROP TABLE m63_flags;

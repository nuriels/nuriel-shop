-- ============================================================
-- Hospitality F3 (20261105090000_hosp_dashboard.sql): the owner's dashboard
--   • revenue = stay nights inside the period, after discounts; cancelled / pending excluded;
--   • collected = recorded payments by date, refunds subtracted, voided ignored;
--   • occupancy = occupied unit-nights / available unit-nights: direct bookings + synced channel
--     dates, each unit-night once, whole-property bookings on every member unit, internal blocks
--     reduce availability and are not occupancy, inactive and whole-property units not counted;
--   • comparison with the previous period only when the site already existed in it;
--   • finance numbers: the owner always; a manager only with the owner's explicit grant (DB);
--   • today / upcoming stays with short guest names; the "needs attention" list.
-- ============================================================
\set OWNER_F '''a0000000-0000-0000-0000-000000f30a01'''
\set MGR_F '''a0000000-0000-0000-0000-000000f30a02'''
\set OWNER_O '''a0000000-0000-0000-0000-000000f30a03'''
\set U1 '''7f300000-0000-0000-0000-0000000000a1'''
\set U2 '''7f300000-0000-0000-0000-0000000000a2'''
\set U3 '''7f300000-0000-0000-0000-0000000000a3'''
\set U4 '''7f300000-0000-0000-0000-0000000000a4'''
\set PF '''7f300000-0000-0000-0000-0000000000f1'''
\set POL '''7f300000-0000-0000-0000-0000000000c1'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
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
CREATE OR REPLACE FUNCTION pg_temp.sync(_calendar uuid, _events jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := hospitality.channel_sync_service(_calendar, _events, NULL);
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.ev(_uid text, _from integer, _to integer) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('uid', _uid, 'from', current_date + _from, 'to', current_date + _to);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.book(_site text, _uid uuid, _unit uuid, _from date, _to date, _name text,
                                        _extra text DEFAULT '') RETURNS uuid LANGUAGE sql AS $f$
  SELECT (pg_temp.call(_site, _uid, format(
    'SELECT to_jsonb(hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L,
       _full_name => %L, _phone => ''0521234567'', _terms_explained => true%s))', _unit, _from, _to, _name, _extra))
    ->> 'booking_id')::uuid;
$f$;
-- the overview as someone (site, user, from, to)
CREATE OR REPLACE FUNCTION pg_temp.ov(_site text, _uid uuid, _from date, _to date) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.dashboard_overview(%L, %L)', _from, _to));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000f30a01', 'f3.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000f30a02', 'f3.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000f30a03', 'f3.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('f3-dash', 'צימרי F3', 'f3.owner@test.local')$$) ->> 'id' AS sf \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('f3-other', 'עסק אחר F3', 'f3.other@test.local')$$) ->> 'id' AS so \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sf', :OWNER_F, 'f3.owner@test.local', 'f3_owner', 'admin', true, 'דנה בעלת העסק'),
  (:'sf', :MGR_F, 'f3.manager@test.local', 'f3_manager', 'admin', true, 'יוסי'),
  (:'so', :OWNER_O, 'f3.other@test.local', 'f3_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %2$L))$$, :'sf', :'so')) IS NOT NULL AS ok \gset
-- the trial ends in 10 days (a new business gets 30 since migration 40; the task shows from 14 days before)
UPDATE hospitality.subscriptions SET trial_ends_at = now() + interval '10 days' WHERE tenant_id = :'sf';
SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date AS jt \gset

INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES (:PF, :'sf', 'מתחם F3', 'f3-p', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:U1, :'sf', :PF, 'unit', 'בקתת האלון', 'f3-u1', 4, 2, 500),
  (:U2, :'sf', :PF, 'unit', 'בקתת הזית', 'f3-u2', 4, 2, 500),
  (:U3, :'sf', :PF, 'unit', 'סוויטת הגפן', 'f3-u3', 4, 2, 500),
  (:U4, :'sf', :PF, 'unit', 'יחידה כבויה', 'f3-u4', 4, 2, 500);
UPDATE hospitality.units SET is_active = false WHERE id = :U4;
-- the whole property (U1 + U2), priced per night
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.whole_property_set(%L, true, ARRAY[%L, %L]::uuid[])$$, :PF, :U1, :U2)) IS NOT NULL AS ok \gset
SELECT id AS uw FROM hospitality.units WHERE property_id = :PF AND kind = 'whole_property' \gset
UPDATE hospitality.units SET base_price = 1200 WHERE id = :'uw';
-- a policy with a 30% deposit
INSERT INTO hospitality.policies (id, tenant_id, name, deposit_kind, deposit_value, free_cancel_days, fee_tiers, no_show_fee)
VALUES (:POL, :'sf', 'מקדמה 30%', 'percent', 30, 3, '[{"from_days": 3, "fee": "deposit"}, {"from_days": 1, "fee": "full"}]', 'full');

-- bookings (the period under test: nights +40 … +49)
SELECT pg_temp.book(:'sf', :OWNER_F, :U1, pg_temp.d(40), pg_temp.d(43), 'נועה לוי', ', _total_override => 1200') AS b1 \gset
SELECT pg_temp.book(:'sf', :OWNER_F, :U2, pg_temp.d(45), pg_temp.d(47), 'אורי ברק') AS b2 \gset
-- a coupon discount on B2, stored the way the booking engine stores it (subtotal 1,000 − 200 = 800)
UPDATE hospitality.bookings SET discount = 200, total = 800 WHERE id = :'b2';
SELECT pg_temp.book(:'sf', :OWNER_F, :U3, pg_temp.d(48), pg_temp.d(52), 'יעל מור') AS b3 \gset
SELECT pg_temp.book(:'sf', :OWNER_F, :U3, pg_temp.d(41), pg_temp.d(43), 'בוטל כהן') AS b4 \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format('SELECT to_jsonb(hospitality.cancel_booking(%L, %L))', :'b4', 'בדיקה')) IS NOT NULL AS ok \gset
SELECT pg_temp.book(:'sf', :OWNER_F, :U2, pg_temp.d(41), pg_temp.d(43), 'ממתין שמש', ', _status => ''pending_approval''') AS b5 \gset
-- arriving today (business date), 30% deposit due and unpaid; and one in three days
SELECT pg_temp.book(:'sf', :OWNER_F, :U1, :'jt'::date, :'jt'::date + 2, 'נועה לוי', format(', _policy_id => %L', :POL)) AS b6 \gset
SELECT pg_temp.book(:'sf', :OWNER_F, :U2, :'jt'::date + 3, :'jt'::date + 4, 'רועי שגב') AS b8 \gset
-- the whole property, nights +60 … +61
SELECT pg_temp.book(:'sf', :OWNER_F, :'uw', pg_temp.d(60), pg_temp.d(62), 'אירוע משפחתי') AS b7 \gset
-- an internal block (U3, nights +44, +45) and channel dates (U1, nights +46 … +48) + one conflict
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT to_jsonb(hospitality.block_create(%L, %L, %L, 'שיפוץ'))$$,
  :U3, pg_temp.d(44), pg_temp.d(46))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format(
  $$SELECT to_jsonb(hospitality.channel_calendar_add(%L, 'airbnb', 'https://www.airbnb.com/calendar/ical/f3.ics?s=1'))$$, :U1)) IS NOT NULL AS ok \gset
SELECT id AS cal FROM hospitality.channel_calendars WHERE tenant_id = :'sf' \gset
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('f3-air', 46, 49), pg_temp.ev('f3-over', 41, 43))) IS NOT NULL AS ok \gset
-- payments today: 300 (B1) + 200 − 100 refund (B2); 50 recorded and voided (B1)
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.payment_record(%L, 'deposit', 'transfer', 300, %L)$$, :'b1', :'jt')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.payment_record(%L, 'full', 'cash', 200, %L)$$, :'b2', :'jt')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.payment_record(%L, 'refund', 'cash', 100, %L)$$, :'b2', :'jt')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.payment_record(%L, 'balance', 'cash', 50, %L)$$, :'b1', :'jt')) IS NOT NULL AS ok \gset
SELECT id AS p_void FROM hospitality.payments WHERE booking_id = :'b1' AND kind = 'balance' \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format($$SELECT hospitality.payment_void(%L, 'נרשם בטעות')$$, :'p_void')) IS NOT NULL AS ok \gset

SELECT tests.check('dashboard fixtures: the bookings exist as planned (cancelled, pending, discount, deposit)',
  format($$SELECT (SELECT status FROM hospitality.bookings WHERE id = %L) = 'cancelled'
       AND (SELECT status FROM hospitality.bookings WHERE id = %L) = 'pending_approval'
       AND (SELECT total = 1200 AND price_manual FROM hospitality.bookings WHERE id = %L)
       AND (SELECT subtotal = 1000 AND discount = 200 AND total = 800 FROM hospitality.bookings WHERE id = %L)
       AND (SELECT deposit_amount = 300 AND amount_paid = 0 FROM hospitality.bookings WHERE id = %L)
       AND (SELECT count(*) = 1 FROM hospitality.blocks WHERE tenant_id = %L AND channel_calendar_id IS NOT NULL AND released_at IS NULL)$$,
    :'b4', :'b5', :'b1', :'b2', :'b6', :'sf'));

-- ============================================================
-- 1. Access
-- ============================================================
SELECT tests.check('access: a guest (anon) cannot read the dashboard',
  format($$SELECT pg_temp.err_of(%L, NULL, 'SELECT hospitality.dashboard_overview(current_date, current_date)') ILIKE '%%permission denied%%'$$, :'sf'));
SELECT tests.check('access: the owner of another business cannot read this one',
  format($$SELECT pg_temp.err_of(%L, %L, 'SELECT hospitality.dashboard_overview(current_date, current_date)') IS NOT NULL
       AND pg_temp.err_of(%L, %L, 'SELECT hospitality.dashboard_tasks()') IS NOT NULL
       AND pg_temp.err_of(%L, %L, 'SELECT hospitality.dashboard_today()') IS NOT NULL$$,
    :'sf', :OWNER_O, :'sf', :OWNER_O, :'sf', :OWNER_O));
SELECT tests.check('access: the internal helpers are not callable from the API',
  $$SELECT NOT bool_or(has_function_privilege(r, p, 'EXECUTE'))
      FROM unnest(ARRAY['anon', 'authenticated']) r,
           unnest(ARRAY['hospitality._dashboard_nights(uuid,date,date)',
                        'hospitality._dashboard_numbers(uuid,text,date,date,integer,boolean)',
                        'hospitality._dashboard_series(uuid,text,date,date,text,integer,boolean)',
                        'hospitality._dashboard_stay(hospitality.bookings)']) p$$);
SELECT tests.check('access: no direct access to the grants table',
  $$SELECT NOT bool_or(has_table_privilege(r, 'hospitality.staff_grants', p))
      FROM unnest(ARRAY['anon', 'authenticated']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p$$);
SELECT tests.check('range: the end before the start is refused',
  format($$SELECT pg_temp.err_of(%L, %L, 'SELECT hospitality.dashboard_overview(current_date, current_date - 1)') LIKE '%%טווח%%'$$, :'sf', :OWNER_F));
SELECT tests.check('range: more than a year is refused',
  format($$SELECT pg_temp.err_of(%L, %L, 'SELECT hospitality.dashboard_overview(current_date, current_date + 366)') LIKE '%%שנה%%'$$, :'sf', :OWNER_F));

-- ============================================================
-- 2. The numbers (owner), nights +40 … +49
-- ============================================================
SELECT pg_temp.ov(:'sf', :OWNER_F, pg_temp.d(40), pg_temp.d(49)) AS o1 \gset
SELECT tests.check('numbers: 3 physical active units (the inactive unit and the whole property are not counted)',
  format($$SELECT (%L::jsonb ->> 'units')::int = 3$$, :'o1'));
SELECT tests.check('occupancy: 10 occupied unit-nights (7 direct + 3 channel), cancelled and pending excluded',
  format($$SELECT (%1$L::jsonb #>> '{current,occupied_nights}')::int = 10
       AND (%1$L::jsonb #>> '{current,channel_nights}')::int = 3$$, :'o1'));
SELECT tests.check('occupancy: the internal block reduces availability (30 − 2 = 28) and is not occupancy → 35.7%',
  format($$SELECT (%1$L::jsonb #>> '{current,blocked_nights}')::int = 2
       AND (%1$L::jsonb #>> '{current,available_nights}')::int = 28
       AND (%1$L::jsonb #>> '{current,occupancy}')::numeric = 35.7$$, :'o1'));
SELECT tests.check('revenue: nights inside the period after discounts (1,200 manual + 1,000 − 200 coupon + 2 of 4 nights 1,000) = 3,000',
  format($$SELECT (%1$L::jsonb #>> '{current,revenue}')::numeric = 3000
       AND (%1$L::jsonb #>> '{current,nights_sold}')::int = 7
       AND (%1$L::jsonb #>> '{current,adr}')::numeric = 428.57$$, :'o1'));
SELECT tests.check('comparison: the previous 10 days exist for the site (created today) — all zero, occupancy 0',
  format($$SELECT (%1$L::jsonb #>> '{previous,occupied_nights}')::int = 0
       AND (%1$L::jsonb #>> '{previous,occupancy}')::numeric = 0
       AND (%1$L::jsonb #>> '{previous,revenue}')::numeric = 0
       AND %1$L::jsonb #>> '{period,previous_from}' = %2$L
       AND jsonb_array_length(%1$L::jsonb -> 'previous_series') = 10
       AND (%1$L::jsonb #>> '{previous_series,0,start}') = %2$L$$, :'o1', pg_temp.d(30)));
SELECT tests.check('series: by day, 10 points; +44 → 0%%, +45 → 50%%, +46 → 66.7%%; revenue +40 = 400, +45 = 400 (after the coupon)',
  format($$SELECT %1$L::jsonb #>> '{period,bucket}' = 'day'
       AND jsonb_array_length(%1$L::jsonb -> 'series') = 10
       AND (SELECT (p ->> 'occupancy')::numeric FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p ->> 'start' = %2$L) = 0
       AND (SELECT (p ->> 'occupancy')::numeric FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p ->> 'start' = %3$L) = 50
       AND (SELECT (p ->> 'occupancy')::numeric FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p ->> 'start' = %4$L) = 66.7
       AND (SELECT (p ->> 'revenue')::numeric FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p ->> 'start' = %5$L) = 400
       AND (SELECT (p ->> 'revenue')::numeric FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p ->> 'start' = %3$L) = 400$$,
    :'o1', pg_temp.d(44), pg_temp.d(45), pg_temp.d(46), pg_temp.d(40)));
SELECT tests.check('whole property: a booking occupies every member unit (2 units × 2 nights = 4 of 6 → 66.7%%), sold as 2 nights',
  format($$SELECT (o #>> '{current,occupied_nights}')::int = 4 AND (o #>> '{current,occupancy}')::numeric = 66.7
       AND (o #>> '{current,nights_sold}')::int = 2 AND (o #>> '{current,revenue}')::numeric = 2400
      FROM (SELECT pg_temp.ov(%L, %L, %L, %L) AS o) x$$, :'sf', :OWNER_F, pg_temp.d(60), pg_temp.d(61)));

-- today: bookings made, cancellations, collected
SELECT pg_temp.ov(:'sf', :OWNER_F, :'jt'::date, :'jt'::date) AS o2 \gset
SELECT tests.check('today: 7 bookings made (the cancelled one and nothing else excluded), 1 cancellation',
  format($$SELECT (%1$L::jsonb #>> '{current,bookings}')::int = 7
       AND (%1$L::jsonb #>> '{current,cancellations}')::int = 1$$, :'o2'));
SELECT tests.check('collected: 300 + 200 − 100 refund = 400 (the voided payment is not counted)',
  format($$SELECT (%L::jsonb #>> '{current,collected}')::numeric = 400$$, :'o2'));
SELECT tests.check('comparison: none for a period before the site existed (no invented numbers, no previous line)',
  format($$SELECT (%1$L::jsonb -> 'previous') = 'null'::jsonb AND (%1$L::jsonb -> 'previous_series') = 'null'::jsonb$$, :'o2'));
SELECT tests.check('pending: the request waiting for approval, with its deadline',
  format($$SELECT (%1$L::jsonb #>> '{pending,count}')::int = 1 AND %1$L::jsonb #>> '{pending,next_expiry}' IS NOT NULL$$, :'o2'));
SELECT tests.check('greeting: the first name of the person signed in',
  format($$SELECT %L::jsonb #>> '{me,first_name}' = 'דנה'$$, :'o2'));
SELECT tests.check('buckets: weeks for 101 days (all days covered), months for 301 days',
  format($$SELECT w #>> '{period,bucket}' = 'week'
       AND (SELECT sum((p ->> 'days')::int) FROM jsonb_array_elements(w -> 'series') p) = 101
       AND m #>> '{period,bucket}' = 'month'
      FROM (SELECT pg_temp.ov(%1$L, %2$L, %3$L, %4$L) AS w, pg_temp.ov(%1$L, %2$L, %5$L, %6$L) AS m) x$$,
    :'sf', :OWNER_F, pg_temp.d(40), pg_temp.d(140), pg_temp.d(0), pg_temp.d(300)));

-- ============================================================
-- 3. Finance permission
-- ============================================================
SELECT tests.check('finance: the owner sees revenue and collected',
  format($$SELECT (%L::jsonb ->> 'finance')::boolean$$, :'o1'));
SELECT pg_temp.ov(:'sf', :MGR_F, pg_temp.d(40), pg_temp.d(49)) AS m1 \gset
SELECT tests.check('finance: a manager without a grant — no revenue, collected or ADR (null from the database); occupancy yes',
  format($$SELECT NOT (%1$L::jsonb ->> 'finance')::boolean
       AND (%1$L::jsonb #> '{current,revenue}') = 'null'::jsonb
       AND (%1$L::jsonb #> '{current,collected}') = 'null'::jsonb
       AND (%1$L::jsonb #> '{current,adr}') = 'null'::jsonb
       AND (%1$L::jsonb #>> '{current,occupancy}')::numeric = 35.7
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'series') p WHERE p -> 'revenue' <> 'null'::jsonb)$$, :'m1'));
SELECT tests.check('finance: the manager does not have reports.finance; the owner does',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(hospitality.can(''reports.finance''))'))::text = 'false'
       AND (pg_temp.call(%1$L, %3$L, 'SELECT to_jsonb(hospitality.can(''reports.finance''))'))::text = 'true'$$,
    :'sf', :MGR_F, :OWNER_F));
SELECT tests.check('finance: the older dashboard() (2k) — month revenue only for the owner, null for a manager without a grant',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.dashboard()') -> 'revenue_month') = 'null'::jsonb
       AND jsonb_typeof(pg_temp.call(%1$L, %3$L, 'SELECT hospitality.dashboard()') -> 'revenue_month') = 'number'
       AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.dashboard()') ->> 'arrivals_today') IS NOT NULL$$,
    :'sf', :MGR_F, :OWNER_F));
SELECT tests.check('finance: a manager cannot grant it (owner only)',
  format($$SELECT pg_temp.err_of(%L, %L, format('SELECT hospitality.team_set_finance(%%L, true)', %L)) IS NOT NULL$$,
    :'sf', :MGR_F, :MGR_F));
SELECT tests.check('finance: the owner''s own access cannot be changed',
  format($$SELECT pg_temp.err_of(%L, %L, format('SELECT hospitality.team_set_finance(%%L, false)', %L)) LIKE '%%בעלים%%'$$,
    :'sf', :OWNER_F, :OWNER_F));
SELECT pg_temp.call(:'sf', :OWNER_F, format('SELECT hospitality.team_set_finance(%L, true)', :MGR_F)) AS t1 \gset
SELECT tests.check('finance: the owner grants it — the team list shows it',
  format($$SELECT (SELECT (m ->> 'finance')::boolean FROM jsonb_array_elements(%1$L::jsonb -> 'members') m WHERE m ->> 'user_id' = %2$L)
       AND (SELECT (m ->> 'finance')::boolean FROM jsonb_array_elements(%1$L::jsonb -> 'members') m WHERE m ->> 'role' = 'owner')$$,
    :'t1', :MGR_F));
SELECT tests.check('finance: with the grant the manager sees revenue (3,000) — enforced in the database',
  format($$SELECT (pg_temp.ov(%L, %L, %L, %L) #>> '{current,revenue}')::numeric = 3000$$, :'sf', :MGR_F, pg_temp.d(40), pg_temp.d(49)));
SELECT tests.check('finance: with the grant the older dashboard() shows the month revenue to the manager too',
  format($$SELECT jsonb_typeof(pg_temp.call(%L, %L, 'SELECT hospitality.dashboard()') -> 'revenue_month') = 'number'$$,
    :'sf', :MGR_F));
SELECT tests.check('finance: granting is in the activity log',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'team.finance_granted')$$, :'sf'));
SELECT pg_temp.call(:'sf', :OWNER_F, format('SELECT hospitality.team_set_finance(%L, false)', :MGR_F)) IS NOT NULL AS ok \gset
SELECT tests.check('finance: revoked — null again, and logged',
  format($$SELECT (pg_temp.ov(%L, %L, %L, %L) #> '{current,revenue}') = 'null'::jsonb
       AND EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'team.finance_revoked')$$,
    :'sf', :MGR_F, pg_temp.d(40), pg_temp.d(49), :'sf'));
SELECT tests.check('finance: a grant in one business does not open another business',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.can(''reports.finance''))'))::text = 'false'$$,
    :'so', :MGR_F));

-- ============================================================
-- 4. Today and needs-attention
-- ============================================================
SELECT pg_temp.call(:'sf', :MGR_F, 'SELECT hospitality.dashboard_today()') AS td \gset
SELECT tests.check('today: the arrival with a short name (first name + initial), the unit and its revision (for the arrived button)',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'arrivals') = 1
       AND %1$L::jsonb #>> '{arrivals,0,guest}' = 'נועה ל.'
       AND %1$L::jsonb #>> '{arrivals,0,unit_name}' = 'בקתת האלון'
       AND (%1$L::jsonb #>> '{arrivals,0,revision}')::int = (SELECT revision FROM hospitality.bookings WHERE id = %2$L)
       AND %1$L::jsonb #>> '{arrivals,0,id}' = %2$L$$, :'td', :'b6'));
SELECT tests.check('today: the check-in in three days is in the upcoming list; departures empty',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'upcoming') u WHERE u ->> 'id' = %2$L)
       AND jsonb_array_length(%1$L::jsonb -> 'departures') = 0$$, :'td', :'b8'));
SELECT pg_temp.call(:'sf', :OWNER_F, 'SELECT hospitality.dashboard_tasks()') AS tk \gset
SELECT tests.check('tasks: the pending request (high, with its booking), the unpaid deposit, the channel conflict',
  format($$SELECT (SELECT t ->> 'severity' = 'high' AND t ->> 'booking_id' = %2$L FROM jsonb_array_elements(%1$L::jsonb -> 'items') t WHERE t ->> 'kind' = 'pending')
       AND (SELECT (t ->> 'count')::int = 1 AND t ->> 'booking_id' = %3$L FROM jsonb_array_elements(%1$L::jsonb -> 'items') t WHERE t ->> 'kind' = 'deposits')
       AND (SELECT (t ->> 'conflicts')::int = 1 FROM jsonb_array_elements(%1$L::jsonb -> 'items') t WHERE t ->> 'kind' = 'channels')
       AND (%1$L::jsonb ->> 'count')::int = jsonb_array_length(%1$L::jsonb -> 'items')$$, :'tk', :'b5', :'b6'));
SELECT tests.check('tasks: the trial ending is shown to the owner only',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%L::jsonb -> 'items') t WHERE t ->> 'kind' = 'plan')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%L, %L, 'SELECT hospitality.dashboard_tasks()') -> 'items') t
                        WHERE t ->> 'kind' = 'plan')$$, :'tk', :'sf', :MGR_F));
SELECT tests.check('tasks: after recording the deposit the deposit task is gone',
  format($$SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.payment_record(%%L, ''deposit'', ''bit'', 300, %%L)', %3$L, %4$L)) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.dashboard_tasks()') -> 'items') t
                        WHERE t ->> 'kind' = 'deposits')$$, :'sf', :OWNER_F, :'b6', :'jt'));

-- ============================================================
-- 5. Team removal clears grants; the permission list
-- ============================================================
SELECT pg_temp.call(:'sf', :OWNER_F, format('SELECT hospitality.team_set_finance(%L, true)', :MGR_F)) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sf', :OWNER_F, format('SELECT to_jsonb(hospitality.team_remove_manager(%L))', :MGR_F)) IS NOT NULL AS ok \gset
SELECT tests.check('team: removing a manager removes the grants given to them',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.staff_grants WHERE tenant_id = %L AND user_id = %L)$$, :'sf', :MGR_F));
SELECT tests.check('permissions: 14, reports.finance last; the dashboard functions guard by reports / bookings',
  $$SELECT cardinality(hospitality.permissions()) = 14 AND (hospitality.permissions())[14] = 'reports.finance'
       AND (SELECT prosrc LIKE '%_manage_tenant(''reports'')%' FROM pg_proc WHERE oid = 'hospitality.dashboard_overview(date,date)'::regprocedure)
       AND (SELECT prosrc LIKE '%_manage_tenant(''bookings'')%' FROM pg_proc WHERE oid = 'hospitality.dashboard_tasks()'::regprocedure)$$);

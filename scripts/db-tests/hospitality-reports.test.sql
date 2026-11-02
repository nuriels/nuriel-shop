-- ============================================================
-- Hospitality F7 (20261105110000_hosp_reports.sql): reports and export
--   • one source of truth: with no filters the report's numbers are the dashboard's numbers;
--   • filters (unit, source, status) narrow every part consistently;
--   • revenue by month / by period, sources, per-unit performance, cancellations, payments, balances;
--   • money only with the finance permission; isolation between businesses; input validation.
-- ============================================================
\set OWNER_R '''a0000000-0000-0000-0000-000000f70a01'''
\set MGR_R '''a0000000-0000-0000-0000-000000f70a02'''
\set OWNER_X '''a0000000-0000-0000-0000-000000f70a03'''
\set R1 '''7f700000-0000-0000-0000-0000000000a1'''
\set R2 '''7f700000-0000-0000-0000-0000000000a2'''
\set RP '''7f700000-0000-0000-0000-0000000000f1'''
\set X1 '''7f700000-0000-0000-0000-0000000000b1'''
\set XP '''7f700000-0000-0000-0000-0000000000f2'''

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
CREATE OR REPLACE FUNCTION pg_temp.book(_site text, _uid uuid, _unit uuid, _from date, _to date, _name text,
                                        _extra text DEFAULT '') RETURNS uuid LANGUAGE sql AS $f$
  SELECT (pg_temp.call(_site, _uid, format(
    'SELECT to_jsonb(hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L,
       _full_name => %L, _phone => ''0521234567'', _terms_explained => true%s))', _unit, _from, _to, _name, _extra))
    ->> 'booking_id')::uuid;
$f$;
-- the report as someone: (site, user, from, to, extra args)
CREATE OR REPLACE FUNCTION pg_temp.rep(_site text, _uid uuid, _from date, _to date, _extra text DEFAULT '')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.reports_view(%L, %L%s)', _from, _to, _extra));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000f70a01', 'f7.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000f70a02', 'f7.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000f70a03', 'f7.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('f7-reports', 'צימרי הדוחות', 'f7.owner@test.local')$$) ->> 'id' AS sr \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('f7-other', 'עסק אחר F7', 'f7.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sr', :OWNER_R, 'f7.owner@test.local', 'f7_owner', 'admin', true, 'רינה'),
  (:'sr', :MGR_R, 'f7.manager@test.local', 'f7_manager', 'admin', true, 'אבי'),
  (:'sx', :OWNER_X, 'f7.other@test.local', 'f7_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %2$L))$$, :'sr', :'sx')) IS NOT NULL AS ok \gset
UPDATE hospitality.subscriptions SET plan_code = 'premium' WHERE tenant_id IN (:'sr', :'sx');

INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:RP, :'sr', 'מתחם הדוחות', 'f7-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'f7-x', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:R1, :'sr', :RP, 'unit', 'בקתת האורן', 'f7-r1', 4, 2, 500),
  (:R2, :'sr', :RP, 'unit', 'בקתת התאנה', 'f7-r2', 4, 2, 500),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'f7-x1', 4, 2, 500);

-- the period under test: today … +49 (bookings at +40 … +49, payments today — a payment cannot be dated later)
SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date AS jt \gset
-- R1: phone, 3 nights (+40…+42), 1,500; paid 600 (deposit) → balance 900
SELECT pg_temp.book(:'sr', :OWNER_R, :R1, pg_temp.d(40), pg_temp.d(43), 'נועה לוי') AS b1 \gset
-- R2: walk-in, 2 nights (+44, +45), 1,000; paid in full
SELECT pg_temp.book(:'sr', :OWNER_R, :R2, pg_temp.d(44), pg_temp.d(46), 'אורי ברק', ', _source => ''walk_in''') AS b2 \gset
-- R2: phone, 2 nights (+40, +41) — cancelled
SELECT pg_temp.book(:'sr', :OWNER_R, :R2, pg_temp.d(40), pg_temp.d(42), 'בוטל כהן') AS b3 \gset
SELECT pg_temp.call(:'sr', :OWNER_R, format('SELECT to_jsonb(hospitality.cancel_booking(%L, %L))', :'b3', 'בדיקה')) IS NOT NULL AS ok \gset
-- R1: external channel (Airbnb), 2 nights (+47, +48), 1,000 — unpaid
SELECT pg_temp.book(:'sr', :OWNER_R, :R1, pg_temp.d(47), pg_temp.d(49), 'אורח מ-Airbnb', ', _source => ''external'', _channel => ''airbnb''') AS b4 \gset
-- an internal block on R2 (+48, +49)
SELECT pg_temp.call(:'sr', :OWNER_R, format($$SELECT to_jsonb(hospitality.block_create(%L, %L, %L, 'שיפוץ'))$$,
  :R2, pg_temp.d(48), pg_temp.d(50))) IS NOT NULL AS ok \gset
-- payments (today)
SELECT pg_temp.call(:'sr', :OWNER_R, format($$SELECT hospitality.payment_record(%L, 'deposit', 'transfer', 600, %L)$$, :'b1', :'jt')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sr', :OWNER_R, format($$SELECT hospitality.payment_record(%L, 'full', 'cash', 1000, %L)$$, :'b2', :'jt')) IS NOT NULL AS ok \gset
-- the other business: a booking in the same period (must never appear)
SELECT pg_temp.book(:'sx', :OWNER_X, :X1, pg_temp.d(40), pg_temp.d(45), 'אורח של עסק אחר') AS bx \gset

SELECT :'jt'::date + 49 AS pe \gset
SELECT pg_temp.rep(:'sr', :OWNER_R, :'jt', :'pe') AS r \gset
SELECT pg_temp.call(:'sr', :OWNER_R, format('SELECT hospitality.dashboard_overview(%L, %L)', :'jt', :'pe')) AS dash \gset

-- ---------- one source of truth ----------
SELECT tests.check('reports: without filters, the numbers are exactly the dashboard''s numbers',
  format($$SELECT (%1$L::jsonb -> 'summary') = (%2$L::jsonb -> 'current')
             AND (%1$L::jsonb -> 'series') = (%2$L::jsonb -> 'series')$$, :'r', :'dash'));
SELECT tests.check('reports: revenue = stay nights in the period; collected; occupancy (channel included, block excluded)',
  format($$SELECT (%1$L::jsonb #>> '{summary,revenue}')::numeric = 3500
             AND (%1$L::jsonb #>> '{summary,collected}')::numeric = 1600
             AND (%1$L::jsonb #>> '{summary,nights_sold}')::int = 7
             AND (%1$L::jsonb #>> '{summary,occupied_nights}')::int = 7
             AND (%1$L::jsonb #>> '{summary,blocked_nights}')::int = 2
             AND (%1$L::jsonb #>> '{summary,available_nights}')::int = 98
             AND (%1$L::jsonb #>> '{summary,bookings}')::int = 3
             AND (%1$L::jsonb #>> '{summary,cancellations}')::int = 1$$, :'r'));
SELECT tests.check('reports: revenue by month adds up to the period''s revenue',
  format($$SELECT (SELECT sum((m ->> 'revenue')::numeric) FROM jsonb_array_elements(%1$L::jsonb -> 'months') m) = 3500
             AND (SELECT sum((m ->> 'days')::int) FROM jsonb_array_elements(%1$L::jsonb -> 'months') m) = 50
             AND jsonb_array_length(%1$L::jsonb -> 'months') >= 2$$, :'r'));

-- ---------- the sections ----------
SELECT tests.check('reports: sources — phone / walk-in / Airbnb with bookings, nights and revenue',
  format($$SELECT (%1$L::jsonb -> 'sources') @> '[{"source": "phone", "nights": 3, "revenue": 1500},
                                                    {"source": "walk_in", "nights": 2, "revenue": 1000},
                                                    {"source": "external", "channel": "airbnb", "nights": 2, "revenue": 1000}]'
             AND (%1$L::jsonb -> 'sources') @> '[{"source": "phone", "bookings": 1}]'$$, :'r'));
SELECT tests.check('reports: per unit — nights, occupancy (minus blocked nights), revenue, average per night',
  format($$SELECT (%1$L::jsonb -> 'by_unit') @> jsonb_build_array(
                    jsonb_build_object('unit_id', %2$L, 'nights_sold', 5, 'occupied_nights', 5, 'available_nights', 50,
                                       'occupancy', 10.0, 'revenue', 2500, 'adr', 500),
                    jsonb_build_object('unit_id', %3$L, 'nights_sold', 2, 'occupied_nights', 2, 'available_nights', 48,
                                       'occupancy', 4.2, 'revenue', 1000))$$, :'r', :R1, :R2));
SELECT tests.check('reports: cancellations list; payments with methods; balances (paid / still due)',
  format($$SELECT (%1$L::jsonb -> 'cancellations') @> jsonb_build_array(jsonb_build_object('booking_id', %2$L, 'status', 'cancelled'))
             AND jsonb_array_length(%1$L::jsonb -> 'payments') = 2
             AND (%1$L::jsonb -> 'payments') @> '[{"method": "transfer", "amount": 600}, {"method": "cash", "amount": 1000}]'
             AND (%1$L::jsonb -> 'balances') @> jsonb_build_array(jsonb_build_object('booking_id', %3$L, 'paid', 600, 'balance', 900))
             AND (%1$L::jsonb -> 'balances') @> jsonb_build_array(jsonb_build_object('booking_id', %5$L, 'paid', 0, 'balance', 1000))
             AND NOT (%1$L::jsonb -> 'balances') @> jsonb_build_array(jsonb_build_object('booking_id', %4$L))$$,
         :'r', :'b3', :'b1', :'b2', :'b4'));
SELECT tests.check('reports: the bookings in the period (with the cancelled one), full guest names for staff with guests access',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'bookings') = 4
             AND (%1$L::jsonb -> 'bookings') @> '[{"guest": "נועה לוי", "nights": 3}]'$$, :'r'));

-- ---------- filters ----------
SELECT pg_temp.rep(:'sr', :OWNER_R, :'jt', :'pe', format(', _unit_ids => ARRAY[%L]::uuid[]', :R2)) AS ru \gset
SELECT tests.check('filter by unit: only that unit (revenue, occupancy, payments, bookings, per-unit rows)',
  format($$SELECT (%1$L::jsonb #>> '{summary,revenue}')::numeric = 1000
             AND (%1$L::jsonb #>> '{summary,available_nights}')::int = 48
             AND (%1$L::jsonb #>> '{summary,occupancy}')::numeric = 4.2
             AND (%1$L::jsonb #>> '{summary,collected}')::numeric = 1000
             AND (%1$L::jsonb -> 'units')::int = 1
             AND jsonb_array_length(%1$L::jsonb -> 'by_unit') = 1
             AND jsonb_array_length(%1$L::jsonb -> 'bookings') = 2$$, :'ru'));
SELECT pg_temp.rep(:'sr', :OWNER_R, :'jt', :'pe', ', _sources => ARRAY[''external'']') AS rs \gset
SELECT tests.check('filter by source: the channel only',
  format($$SELECT (%1$L::jsonb #>> '{summary,revenue}')::numeric = 1000
             AND (%1$L::jsonb #>> '{summary,nights_sold}')::int = 2
             AND jsonb_array_length(%1$L::jsonb -> 'sources') = 1
             AND jsonb_array_length(%1$L::jsonb -> 'payments') = 0$$, :'rs'));
SELECT pg_temp.rep(:'sr', :OWNER_R, :'jt', :'pe', ', _statuses => ARRAY[''cancelled'']') AS rc \gset
SELECT tests.check('filter by status: the cancelled bookings (no revenue from them)',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'bookings') = 1
             AND (%1$L::jsonb #>> '{summary,revenue}')::numeric = 0$$, :'rc'));

-- ---------- permissions and isolation ----------
SELECT pg_temp.rep(:'sr', :MGR_R, :'jt', :'pe') AS rm \gset
SELECT tests.check('finance: a manager without the grant sees no money (revenue, collected, payments, balances, totals)',
  format($$SELECT (%1$L::jsonb ->> 'finance')::boolean = false
             AND %1$L::jsonb #> '{summary,revenue}' = 'null'::jsonb
             AND %1$L::jsonb #> '{summary,collected}' = 'null'::jsonb
             AND %1$L::jsonb -> 'payments' = 'null'::jsonb
             AND %1$L::jsonb -> 'balances' = 'null'::jsonb
             AND NOT (%1$L::jsonb -> 'bookings')::text LIKE '%%"total": 1500%%'
             AND NOT (%1$L::jsonb -> 'by_unit')::text LIKE '%%"revenue": 2500%%'
             AND (%1$L::jsonb #>> '{summary,occupied_nights}')::int = 7$$, :'rm'));
SELECT pg_temp.call(:'sr', :OWNER_R, format('SELECT to_jsonb(hospitality.team_set_finance(%L, true))', :MGR_R)) IS NOT NULL AS ok \gset
SELECT tests.check('finance: with the owner''s grant the manager sees the money',
  format($$SELECT (pg_temp.rep(%1$L, %2$L, %3$L, %4$L) #>> '{summary,revenue}')::numeric = 3500$$,
         :'sr', :MGR_R, :'jt', :'pe'));
SELECT tests.check('isolation: another business''s bookings, units and payments never appear',
  format($$SELECT NOT %1$L LIKE '%%אורח של עסק אחר%%' AND NOT %1$L LIKE '%%יחידה זרה%%'
             AND jsonb_array_length(pg_temp.rep(%2$L, %3$L, %6$L, %7$L,
                   format(', _unit_ids => ARRAY[%%L]::uuid[]', %4$L)) -> 'bookings') = 0
             AND pg_temp.err_of(%2$L, %5$L, format('SELECT hospitality.reports_view(%%L, %%L)', %6$L, %7$L)) IS NOT NULL$$,
         :'r', :'sr', :OWNER_R, :X1, :OWNER_X, :'jt', :'pe'));
SELECT tests.run('reports: guests (anon) cannot call', 'SELECT hospitality.reports_view(current_date, current_date)', NULL, 'permission denied');
SELECT tests.check('reports: validation — range, at most a year, sources, statuses',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.reports_view(current_date, current_date - 1)') LIKE '%%טווח%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.reports_view(current_date, current_date + 400)') LIKE '%%שנה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.reports_view(current_date, current_date, _sources => ARRAY[''x''])') LIKE '%%מקור%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.reports_view(current_date, current_date, _statuses => ARRAY[''lost''])') LIKE '%%סטטוס%%'$$,
         :'sr', :OWNER_R));

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

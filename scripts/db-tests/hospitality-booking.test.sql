-- ============================================================
-- Hospitality: booking engine (Hospitality Stage 1d — 20261101120000_hosp_booking.sql)
-- Pricing, requests, double-booking prevention (EXCLUDE), integrity, owner actions,
-- expiry, cancellation fees, guest isolation, outbox, privacy, flags.
-- Concurrency between real parallel sessions: scripts/db-tests/hospitality/concurrency/run.sh
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set ECOM_OWNER '''a0000000-0000-0000-0000-0000000000a1'''
\set STORE_A '''70000000-0000-0000-0000-00000000000a'''
\set OWNER_X '''a0000000-0000-0000-0000-0000000002a1'''
\set MANAGER_X '''a0000000-0000-0000-0000-0000000002a2'''
\set OWNER_Y '''a0000000-0000-0000-0000-0000000002b1'''
\set GUEST_V '''a0000000-0000-0000-0000-0000000002c1'''
\set GUEST_U '''a0000000-0000-0000-0000-0000000002c2'''

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
-- the first date >= current_date + _n with the given weekday (0 = Sunday)
CREATE OR REPLACE FUNCTION pg_temp.dow(_n integer, _dow integer) RETURNS date LANGUAGE sql AS $$
  SELECT current_date + _n + ((_dow - extract(dow FROM current_date + _n)::integer + 7) % 7) $$;

-- call a function as a site visitor: x-tenant-id header, JWT subject, API role (anon / authenticated)
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers',
    CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                           'x-forwarded-for', '203.0.113.7, 10.0.0.1')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;

-- quote, then request with the quote's policy hash (as the guest)
CREATE OR REPLACE FUNCTION pg_temp.req(_site text, _uid uuid, _unit uuid, _in date, _out date, _email text,
                                       _phone text, _key text, _adults integer DEFAULT 2, _children integer DEFAULT 0,
                                       _code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE q jsonb;
BEGIN
  q := pg_temp.call(_site, _uid, format('SELECT hospitality.quote(%L, %L, %L, %s, %s, %L)',
                                        _unit, _in, _out, _adults, _children, _code));
  RETURN pg_temp.call(_site, _uid, format(
    'SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _email => %L, _phone => %L, _idempotency_key => %L, _policy_accepted => true, _policy_hash => %L,
       _adults => %s, _children => %s, _promo_code => %L)',
    _unit, _in, _out, 'אורח בדיקה', _email, _phone, _key, q ->> 'policy_hash', _adults, _children, _code));
END $f$;

-- an error raised by a statement (recorded, not propagated)
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  RESET ROLE;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;

-- the same, with the deferred integrity checks forced at the end of the statement
CREATE OR REPLACE FUNCTION pg_temp.expect_commit_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;

-- run an action, then check the result in a later statement (a query cannot see writes made by a
-- function it calls itself). The check gets the action's jsonb result as $1.
CREATE OR REPLACE FUNCTION pg_temp.after(_name text, _action text, _check text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r jsonb; v boolean; err text;
BEGIN
  BEGIN
    EXECUTE _action INTO r;
    EXECUTE _check INTO v USING r;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NULL AND COALESCE(v, false),
          COALESCE('ERROR: ' || err, 'value=' || COALESCE(v::text, 'null') || ' result=' || left(COALESCE(r::text, 'null'), 300)));
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql;
  PERFORM set_config('request.jwt.claim.sub', '', true);
END $f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000002a1', 'owner.x@test.local', now()),
  ('a0000000-0000-0000-0000-0000000002a2', 'manager.x@test.local', now()),
  ('a0000000-0000-0000-0000-0000000002b1', 'owner.y@test.local', now()),
  ('a0000000-0000-0000-0000-0000000002c1', 'verified.guest@test.local', now()),
  ('a0000000-0000-0000-0000-0000000002c2', 'unverified.guest@test.local', NULL)
ON CONFLICT DO NOTHING;

SELECT pg_temp.as_platform($$SELECT hospitality.admin_create_site('hd1d-x', 'צימרי איקס', 'owner.x@test.local')$$);
SELECT pg_temp.as_platform($$SELECT hospitality.admin_create_site('hd1d-y', 'צימרי וויי', 'owner.y@test.local')$$);
SELECT id AS sx FROM public.tenants WHERE slug = 'hd1d-x' \gset
SELECT id AS sy FROM public.tenants WHERE slug = 'hd1d-y' \gset

INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:'sx', :OWNER_X, 'owner.x@test.local', 'owner_x_1d', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:'sx', :MANAGER_X, 'manager.x@test.local', 'manager_x_1d', 'admin', true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  (:'sy', :OWNER_Y, 'owner.y@test.local', 'owner_y_1d', 'admin', true);

SELECT pg_temp.as_platform(format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true),
  public.platform_set_flag('hospitality_booking_enabled', true),
  public.platform_set_flag('hospitality_backend_enabled', true, %1$L), public.platform_set_flag('hospitality_booking_enabled', true, %1$L),
  public.platform_set_flag('hospitality_backend_enabled', true, %2$L), public.platform_set_flag('hospitality_booking_enabled', true, %2$L)$$,
  :'sx', :'sy'));

UPDATE hospitality.settings SET notification_emails = ARRAY['owner.x@test.local', 'desk.x@test.local'] WHERE tenant_id = :'sx';

-- site X: property P (active): U1, U2, W (whole property = U1 + U2); U5 for policy tests; property P2 (draft): U4
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  ('71d20000-0000-0000-0000-0000000000a1', :'sx', 'מתחם', 'mitham', 'active'),
  ('71d20000-0000-0000-0000-0000000000a2', :'sx', 'טיוטה', 'draft', 'draft'),
  ('71d20000-0000-0000-0000-0000000000b1', :'sy', 'מתחם Y', 'mitham-y', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price,
                               extra_adult_price, extra_child_price) VALUES
  ('71d30000-0000-0000-0000-0000000000a1', :'sx', '71d20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 1', 'z1', 4, 2, 500, 100, 50),
  ('71d30000-0000-0000-0000-0000000000a2', :'sx', '71d20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 2', 'z2', 4, 2, 600, 100, 50),
  ('71d30000-0000-0000-0000-0000000000aa', :'sx', '71d20000-0000-0000-0000-0000000000a1', 'whole_property', 'כל המתחם', 'all', 8, 4, 1000, 0, 0),
  ('71d30000-0000-0000-0000-0000000000a5', :'sx', '71d20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 5', 'z5', 2, 2, 400, 0, 0),
  ('71d30000-0000-0000-0000-0000000000a6', :'sx', '71d20000-0000-0000-0000-0000000000a1', 'unit', 'צימר 6', 'z6', 2, 2, 400, 0, 0),
  ('71d30000-0000-0000-0000-0000000000a4', :'sx', '71d20000-0000-0000-0000-0000000000a2', 'unit', 'סוויטה', 'suite', 2, 2, 900, 0, 0),
  ('71d30000-0000-0000-0000-0000000000b1', :'sy', '71d20000-0000-0000-0000-0000000000b1', 'unit', 'צימר Y', 'zy', 2, 2, 700, 0, 0);
INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id) VALUES
  (:'sx', '71d30000-0000-0000-0000-0000000000aa', '71d30000-0000-0000-0000-0000000000a1'),
  (:'sx', '71d30000-0000-0000-0000-0000000000aa', '71d30000-0000-0000-0000-0000000000a2');
\set U1 '''71d30000-0000-0000-0000-0000000000a1'''
\set U2 '''71d30000-0000-0000-0000-0000000000a2'''
\set W '''71d30000-0000-0000-0000-0000000000aa'''
\set U5 '''71d30000-0000-0000-0000-0000000000a5'''
\set U6 '''71d30000-0000-0000-0000-0000000000a6'''
\set U4 '''71d30000-0000-0000-0000-0000000000a4'''
\set UY '''71d30000-0000-0000-0000-0000000000b1'''

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the seven Stage 1d tables exist',
  $$SELECT count(*) = 7 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'
     AND relname IN ('guests', 'bookings', 'booking_nights', 'booking_events', 'blocks', 'unit_occupancy', 'notifications')$$);
SELECT tests.check('structure: unit_occupancy has the gist EXCLUDE constraint (tenant, unit, nights &&)',
  $$SELECT pg_get_constraintdef(oid) LIKE 'EXCLUDE USING gist (tenant_id WITH =, unit_id WITH =, nights WITH &&)'
      FROM pg_constraint WHERE conname = 'unit_occupancy_no_overlap'$$);
SELECT tests.check('structure: integrity checks run at commit (deferred constraint triggers)',
  $$SELECT count(*) = 3 FROM pg_trigger WHERE tgname IN ('bookings_consistency', 'booking_nights_consistency',
      'unit_occupancy_consistency') AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred$$);
SELECT tests.check('structure: staff have read-only access to bookings, nights, events, occupancy, outbox, guests',
  $$SELECT NOT bool_or(has_table_privilege('authenticated', 'hospitality.' || t, p))
      FROM unnest(ARRAY['bookings', 'booking_nights', 'booking_events', 'unit_occupancy', 'notifications', 'guests']) t,
           unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p$$);
-- Stage 2b (migration 8): no direct settings writes for staff at all (update_settings() only)
SELECT tests.check('structure: staff cannot update the booking-number counter (nor any settings column directly)',
  $$SELECT NOT has_column_privilege('authenticated', 'hospitality.settings', 'last_booking_number', 'UPDATE')
       AND NOT has_column_privilege('authenticated', 'hospitality.settings', 'check_in_time', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'hospitality.settings', 'UPDATE')$$);
SELECT tests.check('structure: anon can execute only the public guest functions',
  $$SELECT array_agg(proname::text ORDER BY proname) = ARRAY['cancellation_quote', 'get_booking_by_token', 'quote',
      'request_booking', 'request_cancellation', 'request_tenant']
      FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND has_function_privilege('anon', oid, 'EXECUTE')$$);
SELECT tests.check('structure: system functions are service_role only',
  $$SELECT bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('expire_holds', 'claim_notifications', 'mark_notification', 'confirm_payment', 'apply_retention',
                         '_quote', '_create_booking', '_enqueue', '_expire_due', 'policy_schedule', 'fee_at')$$);
SELECT tests.check('structure: guest retention is off unless the business sets a period',
  format($$SELECT guest_retention_months IS NULL FROM hospitality.settings WHERE tenant_id = %L$$, :'sx'));

-- ============================================================
-- 2. Quote and pricing
-- ============================================================
SELECT tests.check('quote: base price + extra adult per night (3 adults, base occupancy 2)',
  format($$SELECT (q ->> 'total')::numeric = 3 * 600 AND (q -> 'nights' -> 0 ->> 'extras')::numeric = 100
                  AND (q ->> 'available')::boolean
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 3, 0)', %L::uuid, pg_temp.d(30), pg_temp.d(33))) q$$,
         :'sx', :U1));
SELECT tests.check('quote: extra child only beyond the remaining base occupancy (1 adult + 2 children)',
  format($$SELECT (q -> 'nights' -> 0 ->> 'extras')::numeric = 50
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 1, 2)', %L::uuid, pg_temp.d(30), pg_temp.d(31))) q$$,
         :'sx', :U1));
INSERT INTO hospitality.rate_rules (tenant_id, name, kind, price_mode, value, priority) VALUES
  (:'sx', 'סוף שבוע', 'weekend', 'fixed', 800, 0),
  (:'sx', 'אמצע שבוע', 'weekday', 'amount', -50, 0);
SELECT tests.check('quote: weekend nights (Thu, Fri) use the weekend rule, other nights the weekday rule',
  format($$SELECT count(*) FILTER (WHERE n ->> 'rule_applied' = 'weekend' AND (n ->> 'base_rate')::numeric = 800) = 2
             AND count(*) FILTER (WHERE n ->> 'rule_applied' = 'weekday' AND (n ->> 'base_rate')::numeric = 450) = 5
          FROM jsonb_array_elements(pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid,
                 pg_temp.dow(60, 0), pg_temp.dow(60, 0) + 7)) -> 'nights') n$$, :'sx', :U1));
INSERT INTO hospitality.rate_rules (tenant_id, name, kind, property_id, date_from, date_to, price_mode, value, priority) VALUES
  (:'sx', 'קיץ מתחם', 'season', '71d20000-0000-0000-0000-0000000000a1', pg_temp.d(100), pg_temp.d(130), 'percent', 20, 0);
INSERT INTO hospitality.rate_rules (tenant_id, name, kind, unit_id, date_from, date_to, price_mode, value, priority) VALUES
  (:'sx', 'קיץ צימר 1', 'season', :U1, pg_temp.d(110), pg_temp.d(120), 'fixed', 999, -5);
INSERT INTO hospitality.rate_rules (tenant_id, name, kind, date_from, date_to, price_mode, value, min_nights) VALUES
  (:'sx', 'חג', 'holiday', pg_temp.d(115), pg_temp.d(117), 'fixed', 1500, 2);
SELECT tests.check('quote: property season (+20%%) applies to a unit without its own season',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(105), pg_temp.d(106)))
                   -> 'nights' -> 0 ->> 'base_rate')::numeric = 720$$, :'sx', :U2));
SELECT tests.check('quote: unit season beats property season even with a lower priority',
  format($$SELECT n ->> 'rule_applied' = 'season' AND (n ->> 'base_rate')::numeric = 999
          FROM (SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(111), pg_temp.d(112))) -> 'nights' -> 0 AS n) x$$,
         :'sx', :U1));
SELECT tests.check('quote: holiday beats every season',
  format($$SELECT n ->> 'rule_applied' = 'holiday' AND (n ->> 'base_rate')::numeric = 1500
          FROM (SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(115), pg_temp.d(117))) -> 'nights' -> 0 AS n) x$$,
         :'sx', :U1));
SELECT pg_temp.expect_error('quote: the holiday minimum nights applies to guests',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(116), pg_temp.d(117)))$$, :'sx', :U1),
  'לפחות 2 לילות');
SELECT tests.check('quote: the owner may quote below the minimum (manual booking)',
  format($$SELECT (pg_temp.call(%L, %L, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(116), pg_temp.d(117))) ->> 'min_nights')::integer = 2$$,
         :'sx', :OWNER_X, :U1));
UPDATE hospitality.units SET price_ceiling = 1200 WHERE id = :U1;
SELECT tests.check('quote: the unit price ceiling caps the holiday price',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(115), pg_temp.d(117)))
                   -> 'nights' -> 0 ->> 'base_rate')::numeric = 1200$$, :'sx', :U1));
UPDATE hospitality.units SET price_ceiling = NULL WHERE id = :U1;
SELECT pg_temp.expect_error('quote: more guests than the capacity',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 4, 1)', %L::uuid, pg_temp.d(30), pg_temp.d(31)))$$, :'sx', :U1),
  'עד 4 אורחים');
SELECT pg_temp.expect_error('quote: past dates are refused for guests',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(-3), pg_temp.d(-1)))$$, :'sx', :U1),
  'תאריך שעבר');
SELECT pg_temp.expect_error('quote: check-out must follow check-in',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(31), pg_temp.d(31)))$$, :'sx', :U1),
  'לא תקינים');
SELECT pg_temp.expect_error('quote: a unit of a draft property is not offered to guests',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(31)))$$, :'sx', :U4),
  'היחידה לא נמצאה');
SELECT pg_temp.expect_error('quote: a unit of another site is not found',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(31)))$$, :'sx', :UY),
  'היחידה לא נמצאה');

-- promotions
INSERT INTO hospitality.promotions (id, tenant_id, name, discount_kind, value, unit_id) VALUES
  ('71d60000-0000-0000-0000-000000000001', :'sx', 'אוטומטי', 'percent', 10, :U6);
INSERT INTO hospitality.promotions (id, tenant_id, name, code, discount_kind, value, usage_limit) VALUES
  ('71d60000-0000-0000-0000-000000000002', :'sx', 'קופון', 'WELCOME', 'fixed', 100, 1);
SELECT tests.check('quote: an automatic promotion is applied',
  format($$SELECT (q ->> 'discount')::numeric = round((q ->> 'subtotal')::numeric * 0.1, 2) AND (q ->> 'discount')::numeric > 0
             AND (q ->> 'total')::numeric = (q ->> 'subtotal')::numeric - (q ->> 'discount')::numeric
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(32))) q$$, :'sx', :U6));
SELECT tests.check('quote: a coupon code is applied (case-insensitive)',
  format($$SELECT (q ->> 'discount')::numeric = 100 AND q ->> 'promotion_id' = '71d60000-0000-0000-0000-000000000002'
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 0, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(32), 'welcome')) q$$, :'sx', :U5));
SELECT pg_temp.expect_error('quote: an unknown coupon is refused',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L, 2, 0, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(32), 'NOPE'))$$, :'sx', :U5),
  'קוד הקופון לא תקף');

-- policies: default (flexible), a strict policy for a unit, a holiday rule policy
INSERT INTO hospitality.policies (id, tenant_id, name, deposit_kind, deposit_value, free_cancel_days, fee_tiers, no_show_fee) VALUES
  ('71d50000-0000-0000-0000-000000000001', :'sx', 'מחמירה', 'percent', 30, 3,
   '[{"from_days": 3, "fee": "deposit"}, {"from_days": 1, "fee": "full"}]', 'full');
INSERT INTO hospitality.policies (id, tenant_id, name, free_cancel_days, auto_cancel, fee_tiers) VALUES
  ('71d50000-0000-0000-0000-000000000002', :'sx', 'אוטומטית', 5, 'within_free_window', '[{"from_days": 5, "fee": "percent_total", "value": 20}]');
INSERT INTO hospitality.policies (id, tenant_id, name, auto_cancel, fee_tiers) VALUES
  ('71d50000-0000-0000-0000-000000000003', :'sx', 'ללא החזר', 'always', '[{"from_days": 0, "fee": "full"}]');
UPDATE hospitality.units SET policy_id = '71d50000-0000-0000-0000-000000000001' WHERE id = :U5;
UPDATE hospitality.rate_rules SET policy_id = '71d50000-0000-0000-0000-000000000003' WHERE name = 'חג';
SELECT tests.check('policy: the default policy applies when nothing else does',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(31))) -> 'policy' ->> 'name' = 'גמישה'$$, :'sx', :U1));
SELECT tests.check('policy: the unit policy beats the default',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(31))) -> 'policy' ->> 'name' = 'מחמירה'$$, :'sx', :U5));
SELECT tests.check('policy: a holiday rule with a policy beats the unit policy',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(115), pg_temp.d(117))) -> 'policy' ->> 'name' = 'ללא החזר'$$, :'sx', :U5));
SELECT tests.check('policy: the quote shows the deposit and a concrete schedule in absolute times',
  format($$SELECT (p ->> 'deposit_amount')::numeric = round((p ->> 'total')::numeric * 0.3, 2)
             AND jsonb_array_length(p -> 'schedule' -> 'periods') = 3
             AND (p -> 'schedule' ->> 'free_until')::timestamptz < (p -> 'schedule' ->> 'arrival')::timestamptz
          FROM (SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(40), pg_temp.d(43))) -> 'policy' AS p) x$$,
         :'sx', :U5));

-- ============================================================
-- 3. Guest requests
-- ============================================================
SELECT pg_temp.req(:'sx', NULL, :U1, pg_temp.d(40), pg_temp.d(43), 'Dana@Example.com', '+972-52-111-1111', 'key-dana-0001') AS r1 \gset
SELECT (:'r1'::jsonb) ->> 'booking_id' AS b1, (:'r1'::jsonb) ->> 'manage_token' AS t1 \gset
SELECT tests.check('request: saved as pending_approval with a 12-hour hold and a reminder at 50%',
  format($$SELECT status = 'pending_approval' AND number = 1001
             AND hold_expires_at BETWEEN now() + interval '12 hours' - interval '1 minute' AND now() + interval '12 hours' + interval '1 minute'
             AND reminder_due_at BETWEEN now() + interval '6 hours' - interval '1 minute' AND now() + interval '6 hours' + interval '1 minute'
          FROM hospitality.bookings WHERE id = %L$$, :'b1'));
SELECT tests.check('request: the dates are held (occupancy row for the unit)',
  format($$SELECT count(*) = 1 FROM hospitality.unit_occupancy WHERE booking_id = %L AND unit_id = %L
            AND nights = daterange(pg_temp.d(40), pg_temp.d(43))$$, :'b1', :U1));
SELECT tests.check('request: locked nights match the total',
  format($$SELECT count(*) = 3 AND sum(price) = (SELECT subtotal FROM hospitality.bookings WHERE id = %1$L)
          FROM hospitality.booking_nights WHERE booking_id = %1$L$$, :'b1'));
SELECT tests.check('request: history has "created" and "policy_accepted" by the guest',
  format($$SELECT array_agg(kind || ':' || actor_kind ORDER BY id) = ARRAY['created:guest', 'policy_accepted:guest']
          FROM hospitality.booking_events WHERE booking_id = %L$$, :'b1'));
SELECT tests.check('request: acceptance record (DB time, channel, snapshot hash, IP, user agent)',
  format($$SELECT policy_acceptance ->> 'channel' = 'site' AND policy_acceptance ->> 'ip' = '203.0.113.7'
             AND policy_acceptance ->> 'user_agent' = 'db-test'
             AND policy_acceptance ->> 'snapshot_hash' = hospitality._hash(policy_snapshot)
          FROM hospitality.bookings WHERE id = %L$$, :'b1'));
SELECT tests.check('request: owner emails (each notification recipient) and the guest email are queued in the same transaction',
  format($$SELECT array_agg(event || ':' || recipient_email ORDER BY event, recipient_email) =
                  ARRAY['new_request:desk.x@test.local', 'new_request:owner.x@test.local', 'request_received:dana@example.com']
          FROM hospitality.notifications WHERE booking_id = %L$$, :'b1'));
SELECT tests.check('request: only the guest email carries the manage token; the token is stored hashed',
  format($$SELECT (SELECT bool_and((payload ? 'manage_token') = (recipient_kind = 'guest')) FROM hospitality.notifications WHERE booking_id = %1$L)
             AND (SELECT manage_token_hash = encode(sha256(convert_to(%2$L, 'UTF8')), 'hex') AND manage_token_hash <> %2$L
                  FROM hospitality.bookings WHERE id = %1$L)$$, :'b1', :'t1'));
SELECT tests.check('request: the guest got no membership anywhere',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE lower(email) = 'dana@example.com')$$);
SELECT tests.check('request: guest card with normalised email and phone',
  format($$SELECT email_normalized = 'dana@example.com' AND phone_normalized = '0521111111' AND user_id IS NULL
          FROM hospitality.guests g JOIN hospitality.bookings b ON b.guest_id = g.id WHERE b.id = %L$$, :'b1'));

-- idempotency
SELECT tests.check('request: a retry with the same key returns the same booking (no duplicate, no new emails)',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(40), pg_temp.d(43), 'dana@example.com', '0521111111', 'key-dana-0001') ->> 'booking_id') = %L
             AND (SELECT count(*) FROM hospitality.bookings WHERE idempotency_key = 'key-dana-0001') = 1
             AND (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %L) = 3$$, :'sx', :U1, :'b1', :'b1'));
SELECT pg_temp.expect_error('request: the same key from another contact is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(50), pg_temp.d(51), 'other@example.com', '0529999999', 'key-dana-0001')$$, :'sx', :U2),
  'מזהה הבקשה כבר בשימוש');

-- acceptance and input validation
SELECT pg_temp.expect_error('request: refused without accepting the cancellation terms',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _email => %%L, _phone => %%L, _idempotency_key => %%L, _policy_accepted => false, _policy_hash => %%L)',
     %L::uuid, pg_temp.d(50), pg_temp.d(51), 'אורח', 'x@example.com', '0520000001', 'key-noaccept', 'x'))$$, :'sx', :U2),
  'יש לאשר את תנאי הביטול');
SELECT pg_temp.expect_error('request: refused when the accepted terms differ from the current ones (hash)',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _email => %%L, _phone => %%L, _idempotency_key => %%L, _policy_accepted => true, _policy_hash => %%L)',
     %L::uuid, pg_temp.d(50), pg_temp.d(51), 'אורח', 'x@example.com', '0520000001', 'key-badhash', repeat('0', 64)))$$, :'sx', :U2),
  'תנאי ההזמנה השתנו');
SELECT pg_temp.expect_error('request: an invalid email is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(50), pg_temp.d(51), 'not-an-email', '0520000001', 'key-bademail')$$, :'sx', :U2),
  'האימייל לא תקינה');
SELECT pg_temp.expect_error('request: an invalid phone is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(50), pg_temp.d(51), 'x@example.com', '12', 'key-badphone')$$, :'sx', :U2),
  'הטלפון לא תקין');

-- open-request cap (2 per contact, by email OR phone)
SELECT pg_temp.req(:'sx', NULL, :U2, pg_temp.d(44), pg_temp.d(45), 'dana@example.com', '0521111111', 'key-dana-0002') IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('cap: a third open request from the same email is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(46), pg_temp.d(47), 'dana@example.com', '0500000000', 'key-dana-0003')$$, :'sx', :U2),
  'כבר יש 2 בקשות פתוחות');
SELECT pg_temp.expect_error('cap: … and from the same phone with another email',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(46), pg_temp.d(47), 'dana2@example.com', '052-111-1111', 'key-dana-0004')$$, :'sx', :U2),
  'כבר יש 2 בקשות פתוחות');
SELECT tests.check('cap: the cap is per business (the same contact can request on another site)',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(46), pg_temp.d(47), 'dana@example.com', '0521111111', 'key-dana-y001') ->> 'status') = 'pending_approval'$$,
         :'sy', :UY));

-- an Ecommerce store owner (member of another tenant) books as a guest
SELECT tests.check('request: an Ecommerce store owner can book as a guest (request_tenant, not membership)',
  format($$SELECT (pg_temp.req(%L, %L, %L, pg_temp.d(70), pg_temp.d(71), 'owner.a@test.local', '0547777777', 'key-ecom-0001') ->> 'status') = 'pending_approval'$$,
         :'sx', :ECOM_OWNER, :U2));
SELECT tests.check('request: … without gaining any staff access to site X',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.bookings')::integer = 0$$, :'sx', :ECOM_OWNER));

-- logged-in guests: linked only with a verified account email
SELECT pg_temp.req(:'sx', :GUEST_V, :U2, pg_temp.d(80), pg_temp.d(81), 'verified.guest@test.local', '0531111111', 'key-ver-0001') ->> 'booking_id' AS bv \gset
SELECT pg_temp.req(:'sx', :GUEST_U, :U2, pg_temp.d(82), pg_temp.d(83), 'unverified.guest@test.local', '0532222222', 'key-unv-0001') AS ru \gset
SELECT (:'ru'::jsonb) ->> 'booking_id' AS bu, (:'ru'::jsonb) ->> 'manage_token' AS tu \gset
SELECT tests.check('identity: a logged-in guest with a verified matching email is linked',
  format($$SELECT g.user_id = %L FROM hospitality.guests g JOIN hospitality.bookings b ON b.guest_id = g.id WHERE b.id = %L$$, :GUEST_V, :'bv'));
SELECT tests.check('identity: an unverified account is not linked',
  format($$SELECT g.user_id IS NULL FROM hospitality.guests g JOIN hospitality.bookings b ON b.guest_id = g.id WHERE b.id = %L$$, :'bu'));
SELECT pg_temp.req(:'sx', :GUEST_V, :U2, pg_temp.d(84), pg_temp.d(85), 'someone.else@test.local', '0533333333', 'key-ver-0002') ->> 'booking_id' AS bo \gset
SELECT tests.check('identity: a typed email of someone else does not link the logged-in account',
  format($$SELECT g.user_id IS NULL FROM hospitality.guests g JOIN hospitality.bookings b ON b.guest_id = g.id WHERE b.id = %L$$, :'bo'));

-- instant mode
UPDATE hospitality.settings SET booking_mode = 'instant' WHERE tenant_id = :'sy';
SELECT pg_temp.req(:'sy', NULL, :UY, pg_temp.d(60), pg_temp.d(62), 'instant@example.com', '0544444444', 'key-inst-0001') ->> 'booking_id' AS bi \gset
SELECT tests.check('instant mode: confirmed at once, no hold, "new booking" + confirmation emails',
  format($$SELECT b.status = 'confirmed' AND b.hold_expires_at IS NULL
             AND (SELECT array_agg(event ORDER BY event) FROM hospitality.notifications WHERE booking_id = b.id) = ARRAY['booking_confirmed', 'new_booking']
          FROM hospitality.bookings b WHERE b.id = %L$$, :'bi'));
SELECT tests.check('numbers: each site numbers its own bookings from 1001',
  format($$SELECT (SELECT min(number) FROM hospitality.bookings WHERE tenant_id = %L) = 1001
             AND (SELECT min(number) FROM hospitality.bookings WHERE tenant_id = %L) = 1001$$, :'sx', :'sy'));

-- ============================================================
-- 4. Double-booking prevention (the database decides)
-- ============================================================
SELECT pg_temp.expect_error('overlap: a second request for overlapping dates is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(42), pg_temp.d(44), 'late@example.com', '0561111111', 'key-late-0001')$$, :'sx', :U1),
  'כבר לא פנויים');
SELECT tests.check('overlap: an adjacent stay (check-in on the other''s check-out day) succeeds',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(43), pg_temp.d(45), 'adjacent@example.com', '0561111112', 'key-adj-0001') ->> 'status') = 'pending_approval'$$,
         :'sx', :U1));
SELECT tests.check('overlap: … and one ending on the other''s check-in day',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(38), pg_temp.d(40), 'before@example.com', '0561111113', 'key-bef-0001') ->> 'status') = 'pending_approval'$$,
         :'sx', :U1));
SELECT pg_temp.expect_error('whole property: refused while a member unit is held',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(41), pg_temp.d(42), 'whole@example.com', '0562222221', 'key-whole-0001')$$, :'sx', :W),
  'כבר לא פנויים');
SELECT pg_temp.req(:'sx', NULL, :W, pg_temp.d(90), pg_temp.d(92), 'whole@example.com', '0562222222', 'key-whole-0002') ->> 'booking_id' AS bw \gset
SELECT tests.check('whole property: a whole booking holds the bundle and every member unit',
  format($$SELECT array_agg(unit_id ORDER BY unit_id) = ARRAY[%L, %L, %L]::uuid[] FROM hospitality.unit_occupancy WHERE booking_id = %L$$,
         :U1, :U2, :W, :'bw'));
SELECT pg_temp.expect_error('whole property: a member unit is refused while the whole property is held',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(91), pg_temp.d(93), 'member@example.com', '0563333331', 'key-mem-0001')$$, :'sx', :U2),
  'כבר לא פנויים');
SELECT pg_temp.expect_error('whole property: two overlapping whole bookings — the second is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(91), pg_temp.d(92), 'whole2@example.com', '0563333332', 'key-whole-0003')$$, :'sx', :W),
  'כבר לא פנויים');
SELECT pg_temp.req(:'sx', NULL, :U1, pg_temp.d(95), pg_temp.d(96), 'm1@example.com', '0564444441', 'key-m1-0001') IS NOT NULL AS ok \gset
SELECT pg_temp.req(:'sx', NULL, :U2, pg_temp.d(95), pg_temp.d(96), 'm2@example.com', '0564444442', 'key-m2-0001') IS NOT NULL AS ok \gset
SELECT tests.check('whole property: members 1 and 2 booked separately on the same night (both succeed)',
  $$SELECT count(*) = 2 FROM hospitality.bookings WHERE idempotency_key IN ('key-m1-0001', 'key-m2-0001') AND status = 'pending_approval'$$);
SELECT pg_temp.expect_error('whole property: … then the whole property is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(95), pg_temp.d(96), 'whole3@example.com', '0564444443', 'key-whole-0004')$$, :'sx', :W),
  'כבר לא פנויים');
SELECT pg_temp.expect_error('whole property: membership cannot change while the whole property has future bookings',
  format($$DELETE FROM hospitality.unit_members WHERE parent_unit_id = %L AND member_unit_id = %L$$, :W, :U2),
  'אי אפשר לשנות את היחידות');

-- blocks (owner, through RLS) share the same inventory
SELECT tests.run('blocks: the owner blocks free dates',
  format($$INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason) VALUES (%L, %L, %L, %L, 'שיפוץ')$$,
         :'sx', :U5, pg_temp.d(120), pg_temp.d(125)), :OWNER_X);
SELECT pg_temp.expect_error('blocks: a guest request over a block is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(122), pg_temp.d(123), 'blocked@example.com', '0565555551', 'key-blk-0001')$$, :'sx', :U5),
  'כבר לא פנויים');
SELECT pg_temp.expect_error('blocks: a block over a held booking is refused',
  format($$INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date) VALUES (%L, %L, %L, %L)$$, :'sx', :U1, pg_temp.d(41), pg_temp.d(42)),
  'יש הזמנה או חסימה');
SELECT tests.run('blocks: the owner releases the block',
  $$UPDATE hospitality.blocks SET released_at = now() WHERE reason = 'שיפוץ'$$, :OWNER_X, NULL, 1);
SELECT tests.check('blocks: a released block frees the dates',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(122), pg_temp.d(123), 'blocked@example.com', '0565555551', 'key-blk-0002') ->> 'status') = 'pending_approval'$$,
         :'sx', :U5));
SELECT pg_temp.expect_error('blocks: a released block cannot be re-activated',
  $$UPDATE hospitality.blocks SET released_at = NULL WHERE reason = 'שיפוץ'$$, 'כבר שוחררה');
SELECT tests.run('blocks: guests and other owners cannot create blocks',
  format($$INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date) VALUES (%L, %L, %L, %L)$$, :'sx', :U6, pg_temp.d(200), pg_temp.d(201)),
  :OWNER_Y, 'row-level security');

-- the constraint holds even when the functions are bypassed
SELECT pg_temp.expect_error('authority: a raw occupancy row overlapping a held booking is refused (EXCLUDE)',
  format($$INSERT INTO hospitality.unit_occupancy (tenant_id, unit_id, nights, block_id)
           SELECT %L, %L, daterange(%L, %L), id FROM hospitality.blocks WHERE reason = 'שיפוץ'$$, :'sx', :U1, pg_temp.d(41), pg_temp.d(42)),
  'unit_occupancy_no_overlap');
SELECT pg_temp.expect_error('authority: a raw booking row bypassing the functions is refused on overlap',
  format($$INSERT INTO hospitality.bookings (tenant_id, number, unit_id, guest_id, check_in, check_out, status, subtotal, total,
             policy_snapshot, policy_acceptance)
           SELECT %L, 9999, %L, guest_id, %L, %L, 'confirmed', 0, 0, '{}', '{}' FROM hospitality.bookings WHERE id = %L$$,
         :'sx', :U1, pg_temp.d(41), pg_temp.d(42), :'b1'),
  'כבר לא פנויים');
SELECT tests.check('authority: no booking ever overlaps another on a physical unit',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy a JOIN hospitality.unit_occupancy b
                        ON a.tenant_id = b.tenant_id AND a.unit_id = b.unit_id AND a.id < b.id AND a.nights && b.nights)$$);

-- ============================================================
-- 5. Integrity: nothing partial, history consistent
-- ============================================================
CREATE TEMP TABLE hd_counts AS
SELECT (SELECT count(*) FROM hospitality.bookings) AS b, (SELECT count(*) FROM hospitality.guests) AS g,
       (SELECT count(*) FROM hospitality.booking_nights) AS n, (SELECT count(*) FROM hospitality.booking_events) AS e,
       (SELECT count(*) FROM hospitality.notifications) AS o, (SELECT count(*) FROM hospitality.unit_occupancy) AS u,
       (SELECT last_booking_number FROM hospitality.settings WHERE tenant_id = :'sx') AS c;
SELECT pg_temp.expect_error('integrity: a failing request (dates taken) …',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(40), pg_temp.d(41), 'brand.new@example.com', '0569999999', 'key-fail-0001')$$, :'sx', :U1),
  'כבר לא פנויים');
SELECT tests.check('integrity: … leaves no booking, guest, night, event, email, occupancy or used number behind',
  format($$SELECT (SELECT count(*) FROM hospitality.bookings) = b AND (SELECT count(*) FROM hospitality.guests) = g
             AND (SELECT count(*) FROM hospitality.booking_nights) = n AND (SELECT count(*) FROM hospitality.booking_events) = e
             AND (SELECT count(*) FROM hospitality.notifications) = o AND (SELECT count(*) FROM hospitality.unit_occupancy) = u
             AND (SELECT last_booking_number FROM hospitality.settings WHERE tenant_id = %L) = c
          FROM hd_counts$$, :'sx'));
-- a guest card created inside the failing call is rolled back too
SELECT pg_temp.expect_error('integrity: a failing request when the coupon is used up …',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(150), pg_temp.d(152), 'coupon@example.com', '0568888881', 'key-cpn-0001', 2, 0, 'WELCOME'),
                  pg_temp.req(%L, NULL, %L, pg_temp.d(153), pg_temp.d(155), 'coupon2@example.com', '0568888882', 'key-cpn-0002', 2, 0, 'WELCOME')$$,
         :'sx', :U5, :'sx', :U6),
  'קוד הקופון לא תקף');
SELECT tests.check('integrity: … rolls back the first booking of the same transaction as well',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.guests WHERE email_normalized IN ('coupon@example.com', 'coupon2@example.com'))
       AND (SELECT used_count FROM hospitality.promotions WHERE code = 'WELCOME') = 0$$);
SELECT pg_temp.expect_commit_error('integrity: a booking row without nights is refused at commit',
  format($$INSERT INTO hospitality.bookings (tenant_id, number, unit_id, guest_id, check_in, check_out, status, subtotal, total,
             policy_snapshot, policy_acceptance)
           SELECT %L, 9998, %L, guest_id, %L, %L, 'confirmed', 100, 100, '{}', '{}' FROM hospitality.bookings WHERE id = %L$$,
         :'sx', :U6, pg_temp.d(300), pg_temp.d(301), :'b1'),
  'הלילות או המחיר לא תואמים');
SELECT pg_temp.expect_commit_error('integrity: deleting a locked night is refused at commit',
  format($$DELETE FROM hospitality.booking_nights WHERE booking_id = %L AND night = %L$$, :'b1', pg_temp.d(41)),
  'הלילות או המחיר לא תואמים');
SELECT pg_temp.expect_commit_error('integrity: changing the total without the nights is refused at commit',
  format($$UPDATE hospitality.bookings SET subtotal = subtotal + 1, total = total + 1 WHERE id = %L$$, :'b1'),
  'הלילות או המחיר לא תואמים');
SELECT pg_temp.expect_commit_error('integrity: removing the occupancy of a held booking is refused at commit',
  format($$DELETE FROM hospitality.unit_occupancy WHERE booking_id = %L$$, :'b1'),
  'התפוסה לא תואמת לסטטוס');
SELECT pg_temp.expect_error('integrity: an illegal status transition is refused (pending → checked_in)',
  format($$UPDATE hospitality.bookings SET status = 'checked_in', hold_expires_at = NULL WHERE id = %L$$, :'b1'),
  'מעבר סטטוס לא חוקי');
SELECT pg_temp.expect_error('integrity: a booking cannot start as cancelled',
  format($$INSERT INTO hospitality.bookings (tenant_id, number, unit_id, guest_id, check_in, check_out, status, subtotal, total,
             policy_snapshot, policy_acceptance)
           SELECT %L, 9997, %L, guest_id, %L, %L, 'cancelled', 0, 0, '{}', '{}' FROM hospitality.bookings WHERE id = %L$$,
         :'sx', :U6, pg_temp.d(300), pg_temp.d(301), :'b1'),
  'לא יכולה להתחיל בסטטוס');
SELECT pg_temp.expect_error('integrity: a pending booking always has a hold deadline',
  format($$UPDATE hospitality.bookings SET hold_expires_at = NULL WHERE id = %L$$, :'b1'), 'check constraint');
SELECT pg_temp.expect_error('integrity: history cannot be edited',
  format($$UPDATE hospitality.booking_events SET note = 'x' WHERE booking_id = %L$$, :'b1'), 'לא ניתנת לשינוי');
SELECT pg_temp.expect_error('integrity: history cannot be deleted',
  format($$DELETE FROM hospitality.booking_events WHERE booking_id = %L$$, :'b1'), 'לא ניתנת לשינוי');

-- ============================================================
-- 6. Owner actions
-- ============================================================
SELECT revision AS rev1 FROM hospitality.bookings WHERE id = :'b1' \gset
SELECT pg_temp.expect_error('approve: a stale revision is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L, %%s)', %L::uuid, %s))$$, :'sx', :OWNER_X, :'b1', :rev1 - 1),
  'עודכנה בינתיים');
SELECT pg_temp.expect_error('approve: a guest cannot approve',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sx', :GUEST_V, :'b1'),
  'אין הרשאה');
SELECT pg_temp.expect_error('approve: an Ecommerce store owner cannot approve',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sx', :ECOM_OWNER, :'b1'),
  'אין הרשאה');
SELECT pg_temp.expect_error('approve: the owner of another site cannot approve (on its own site the booking is not found)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sy', :OWNER_Y, :'b1'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('approve: anon cannot call owner functions',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sx', :'b1'),
  'permission denied');
SELECT pg_temp.after('approve: the manager approves — confirmed, hold cleared, dates held, guest confirmation queued, history by staff',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L, %%s)', %L::uuid, %s))$$, :'sx', :MANAGER_X, :'b1', :rev1),
  format($$SELECT $1 ->> 'status' = 'confirmed' AND b.hold_expires_at IS NULL
             AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = b.id)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = b.id AND event = 'booking_confirmed' AND recipient_kind = 'guest')
             AND EXISTS (SELECT 1 FROM hospitality.booking_events WHERE booking_id = b.id AND from_status = 'pending_approval'
                           AND to_status = 'confirmed' AND actor_kind = 'staff' AND actor_id = %L)
          FROM hospitality.bookings b WHERE b.id = %L$$, :MANAGER_X, :'b1'));

SELECT id AS b_adj FROM hospitality.bookings WHERE idempotency_key = 'key-adj-0001' \gset
SELECT pg_temp.after('decline: declined with a reason, dates released, guest told, reason in history',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.decline_booking(%%L, %%L)', %L::uuid, 'תפוס לשיפוץ'))$$, :'sx', :OWNER_X, :'b_adj'),
  format($$SELECT $1 ->> 'status' = 'declined'
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND (SELECT payload ->> 'reason' FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'booking_declined') = 'תפוס לשיפוץ'
             AND (SELECT note FROM hospitality.booking_events WHERE booking_id = %1$L AND to_status = 'declined') = 'תפוס לשיפוץ'$$, :'b_adj'));
SELECT tests.check('decline: the released dates can be booked again',
  format($$SELECT (pg_temp.req(%L, NULL, %L, pg_temp.d(43), pg_temp.d(45), 'again@example.com', '0561111119', 'key-again-0001') ->> 'status') = 'pending_approval'$$,
         :'sx', :U1));

-- manual booking
SELECT pg_temp.expect_error('manual: the owner must confirm the terms were explained',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.create_manual_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _phone => %%L, _terms_explained => false)', %L::uuid, pg_temp.d(130), pg_temp.d(132), 'משה', '0571111111'))$$,
         :'sx', :OWNER_X, :U6),
  'הוסברו ללקוח');
SELECT pg_temp.call(:'sx', :OWNER_X, format($$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L,
   _full_name => 'משה טלפוני', _phone => '057-111-1111', _terms_explained => true, _total_override => 1000, _channel => 'Booking.com')$$,
   :U6, pg_temp.d(130), pg_temp.d(133))) ->> 'booking_id' AS bm \gset
SELECT tests.check('manual: confirmed at once with the dates held, source phone, manual price split per night, phone acceptance',
  format($$SELECT b.status = 'confirmed' AND b.source = 'phone' AND b.channel = 'Booking.com' AND b.price_manual AND b.total = 1000
             AND (SELECT sum(price) FROM hospitality.booking_nights WHERE booking_id = b.id) = 1000
             AND (SELECT bool_and(rule_applied = 'manual') FROM hospitality.booking_nights WHERE booking_id = b.id)
             AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = b.id)
             AND b.policy_acceptance ->> 'channel' = 'owner_phone' AND (b.policy_snapshot ->> 'total')::numeric = 1000
             AND EXISTS (SELECT 1 FROM hospitality.booking_events WHERE booking_id = b.id AND kind = 'policy_accepted' AND actor_kind = 'staff')
             AND b.created_by = %L
          FROM hospitality.bookings b WHERE b.id = %L$$, :OWNER_X, :'bm'));
SELECT tests.check('manual: no guest email unless the owner asked for it',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %L)$$, :'bm'));
SELECT pg_temp.expect_error('manual vs site: a site request on the manual booking''s dates is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(131), pg_temp.d(132), 'site@example.com', '0572222222', 'key-msite-0001')$$, :'sx', :U6),
  'כבר לא פנויים');
SELECT pg_temp.req(:'sx', NULL, :U6, pg_temp.d(140), pg_temp.d(142), 'site2@example.com', '0572222223', 'key-msite-0002') IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('site vs manual: a manual booking on a held request''s dates is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.create_manual_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _phone => %%L, _terms_explained => true)', %L::uuid, pg_temp.d(141), pg_temp.d(143), 'משה', '0571111111'))$$,
         :'sx', :OWNER_X, :U6),
  'כבר לא פנויים');
SELECT pg_temp.after('manual: with "send to guest" the confirmation (with the manage link) is queued',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.create_manual_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
                 _full_name => %%L, _phone => %%L, _email => %%L, _terms_explained => true, _send_guest_email => true)',
                 %L::uuid, pg_temp.d(150), pg_temp.d(151), 'רונית', '0573333333', 'ronit@example.com'))$$, :'sx', :OWNER_X, :U6),
  $$SELECT (SELECT payload ? 'manage_token' FROM hospitality.notifications n
             WHERE n.booking_id = ($1 ->> 'booking_id')::uuid AND n.event = 'booking_confirmed' AND n.recipient_email = 'ronit@example.com')
       AND $1 ->> 'manage_token' IS NULL$$);
SELECT pg_temp.expect_error('manual: a guest cannot create manual bookings',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.create_manual_booking(_unit_id => %%L, _check_in => %%L, _check_out => %%L,
     _full_name => %%L, _phone => %%L, _terms_explained => true)', %L::uuid, pg_temp.d(160), pg_temp.d(161), 'x', '0571111111'))$$,
         :'sx', :GUEST_V, :U6),
  'אין הרשאה');

-- modify
SELECT revision AS revm FROM hospitality.bookings WHERE id = :'bm' \gset
UPDATE hospitality.policies SET free_cancel_days = 10 WHERE tenant_id = :'sx' AND name = 'גמישה';
SELECT pg_temp.after('modify: new free dates — nights recomputed (manual price), the same policy version re-applied, history before/after',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L, _total_override => 1200, _note => %%L)',
                    %L::uuid, %s, pg_temp.d(134), pg_temp.d(137), 'הלקוח ביקש'))$$, :'sx', :OWNER_X, :'bm', :revm),
  format($$SELECT ($1 ->> 'total')::numeric = 1200
             AND (SELECT check_in = pg_temp.d(134) AND (policy_snapshot ->> 'version')::integer = 1
                         AND (policy_snapshot -> 'rules' ->> 'free_cancel_days')::integer = 7
                         AND (policy_snapshot ->> 'total')::numeric = 1200
                         AND (SELECT sum(price) FROM hospitality.booking_nights WHERE booking_id = %1$L) = 1200
                    FROM hospitality.bookings WHERE id = %1$L)
             AND (SELECT changes -> 'before' ->> 'check_in' = %2$L AND changes -> 'after' ->> 'check_in' = %3$L AND note = 'הלקוח ביקש'
                    FROM hospitality.booking_events WHERE booking_id = %1$L AND kind = 'modified')
             AND (SELECT nights = daterange(pg_temp.d(134), pg_temp.d(137)) FROM hospitality.unit_occupancy WHERE booking_id = %1$L)$$,
         :'bm', pg_temp.d(130), pg_temp.d(134)));
SELECT revision AS revm2 FROM hospitality.bookings WHERE id = :'bm' \gset
SELECT pg_temp.expect_error('modify: into occupied dates is refused …',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L)', %L::uuid, %s, pg_temp.d(140), pg_temp.d(141)))$$,
         :'sx', :OWNER_X, :'bm', :revm2),
  'כבר לא פנויים');
SELECT tests.check('modify: … and the original booking is intact (dates, nights, occupancy, revision)',
  format($$SELECT b.check_in = pg_temp.d(134) AND b.revision = %s
             AND (SELECT count(*) FROM hospitality.booking_nights WHERE booking_id = b.id) = 3
             AND (SELECT nights = daterange(pg_temp.d(134), pg_temp.d(137)) FROM hospitality.unit_occupancy WHERE booking_id = b.id)
          FROM hospitality.bookings b WHERE b.id = %L$$, :revm2, :'bm'));
SELECT pg_temp.expect_error('modify: a stale revision (two tabs) is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L)', %L::uuid, %s, pg_temp.d(170), pg_temp.d(171)))$$,
         :'sx', :OWNER_X, :'bm', :revm),
  'עודכנה בינתיים');
SELECT tests.check('modify: moving a booking over its own dates is allowed',
  format($$SELECT (pg_temp.call(%L, %L, format('SELECT hospitality.modify_booking(%%L, %%s, %%L, %%L, _total_override => 1300)',
                    %L::uuid, %s, pg_temp.d(135), pg_temp.d(138))) ->> 'revision')::integer = %s + 1$$,
         :'sx', :OWNER_X, :'bm', :revm2, :revm2));
UPDATE hospitality.policies SET free_cancel_days = 7 WHERE tenant_id = :'sx' AND name = 'גמישה';
SELECT tests.check('policy edit: existing bookings keep their snapshot; the policy has a new version for new bookings',
  format($$SELECT (SELECT version FROM hospitality.policies WHERE tenant_id = %L AND name = 'גמישה') = 3
             AND (SELECT (policy_snapshot ->> 'version')::integer FROM hospitality.bookings WHERE id = %L) = 1$$, :'sx', :'bm'));
SELECT tests.check('policy edit: a new booking snapshots the new version',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(180), pg_temp.d(181)))
                   -> 'policy' ->> 'version')::integer = 3$$, :'sx', :U2));

-- ============================================================
-- 7. Expiry (DB clock; time simulated by moving the stored deadline)
-- ============================================================
SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(160), pg_temp.d(162), 'expire@example.com', '0581111111', 'key-exp-0001') ->> 'booking_id' AS be \gset
UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :'be';
SELECT tests.check('expiry: a quote already treats an expired hold as free',
  format($$SELECT (pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(160), pg_temp.d(162))) ->> 'available')::boolean$$,
         :'sx', :U5));
SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(160), pg_temp.d(162), 'taker@example.com', '0581111112', 'key-exp-0002') ->> 'booking_id' AS bt \gset
SELECT tests.check('expiry: lazy — the new request expired the old hold in the same transaction and took the dates',
  format($$SELECT (SELECT status FROM hospitality.bookings WHERE id = %1$L) = 'expired'
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %2$L)
             AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = %1$L AND to_status = 'expired' AND actor_kind = 'system') = 1
             AND (SELECT array_agg(event ORDER BY event) FROM hospitality.notifications WHERE booking_id = %1$L
                   AND event LIKE 'request_expired%%') = ARRAY['request_expired', 'request_expired_owner', 'request_expired_owner']$$,
         :'be', :'bt'));
SELECT pg_temp.expect_error('expiry: re-approving an expired request whose dates were taken is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sx', :OWNER_X, :'be'),
  'כבר לא פנויים');
SELECT tests.check('expiry: … and it stays expired',
  format($$SELECT status = 'expired' FROM hospitality.bookings WHERE id = %L$$, :'be'));

SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(170), pg_temp.d(172), 'sweep@example.com', '0581111113', 'key-exp-0003') ->> 'booking_id' AS bs \gset
UPDATE hospitality.bookings SET reminder_due_at = now() - interval '1 second' WHERE id = :'bs';
SELECT pg_temp.after('reminder: the sweep queues one owner reminder per recipient at 50%',
  $$SELECT hospitality.expire_holds()$$,
  format($$SELECT ($1 ->> 'reminders')::integer = 2
             AND (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %L AND event = 'approval_reminder') = 2$$, :'bs'));
SELECT pg_temp.after('reminder: running the sweep again queues nothing more',
  $$SELECT hospitality.expire_holds()$$,
  format($$SELECT ($1 ->> 'reminders')::integer = 0
             AND (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %L AND event = 'approval_reminder') = 2$$, :'bs'));
UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = :'bs';
SELECT pg_temp.after('expiry: the sweep expires the hold, releases the dates and queues the emails',
  $$SELECT hospitality.expire_holds()$$,
  format($$SELECT ($1 ->> 'expired')::integer = 1
             AND (SELECT status FROM hospitality.bookings WHERE id = %1$L) = 'expired'
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'request_expired')$$, :'bs'));
SELECT pg_temp.after('expiry: a second sweep is a no-op — one expiry event, exactly the expected emails (request ×3, reminder ×2, expired ×3)',
  $$SELECT hospitality.expire_holds()$$,
  format($$SELECT ($1 ->> 'expired')::integer = 0
             AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = %1$L AND to_status = 'expired') = 1
             AND (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %1$L) = 8$$, :'bs'));
SELECT pg_temp.after('expiry: the owner may re-approve an expired request while its dates are still free',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_booking(%%L)', %L::uuid))$$, :'sx', :OWNER_X, :'bs'),
  format($$SELECT $1 ->> 'status' = 'confirmed' AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %L)$$, :'bs'));
SELECT tests.run('expiry: the sweep is not callable through the API',
  $$SELECT hospitality.expire_holds()$$, :OWNER_X, 'permission denied');

-- the open-request cap counts only live holds
SELECT pg_temp.req(:'sx', NULL, :U2, pg_temp.d(270), pg_temp.d(271), 'dana@example.com', '0521111111', 'key-dana-0005') IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('cap: two open requests again (one approved earlier) — the next is refused',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(272), pg_temp.d(273), 'dana@example.com', '0521111111', 'key-dana-0006')$$, :'sx', :U2),
  'כבר יש 2 בקשות פתוחות');
UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE idempotency_key = 'key-dana-0002';
SELECT pg_temp.after('cap: an expired request no longer counts toward the cap (and is expired on the way)',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(272), pg_temp.d(273), 'dana@example.com', '0521111111', 'key-dana-0006')$$, :'sx', :U2),
  $$SELECT $1 ->> 'status' = 'pending_approval'
       AND (SELECT status FROM hospitality.bookings WHERE idempotency_key = 'key-dana-0002') = 'expired'$$);

-- ============================================================
-- 8. Cancellation policies and fees
-- ============================================================
-- pure schedule: "3 days before arrival → full refund, then deposit forfeited"
CREATE TEMP TABLE hd_sched AS
SELECT hospitality.policy_schedule('{"free_cancel_days": 3, "fee_tiers": [{"from_days": 3, "fee": "deposit"}], "no_show_fee": "full"}',
                                   DATE '2026-12-10', 'Asia/Jerusalem', TIME '15:00', 1000, 300) AS s;
SELECT tests.check('fees: free until the deadline — 1 second before, the paid deposit is refunded in full',
  $$SELECT (hospitality.fee_at(s, (s ->> 'free_until')::timestamptz - interval '1 second') ->> 'fee')::numeric = 0 FROM hd_sched$$);
SELECT tests.check('fees: at the deadline + 1 second the deposit is forfeited (refund 0 of a paid deposit)',
  $$SELECT (hospitality.fee_at(s, (s ->> 'free_until')::timestamptz + interval '1 second') ->> 'fee')::numeric = 300 FROM hd_sched$$);
SELECT tests.check('fees: exactly at the deadline the next period applies (half-open periods)',
  $$SELECT (hospitality.fee_at(s, (s ->> 'free_until')::timestamptz) ->> 'fee')::numeric = 300 FROM hd_sched$$);
SELECT tests.check('fees: the deadline is the check-in time, in the business time zone',
  $$SELECT ((s ->> 'free_until')::timestamptz AT TIME ZONE 'Asia/Jerusalem') = TIMESTAMP '2026-12-07 15:00'
       AND ((s ->> 'arrival')::timestamptz AT TIME ZONE 'Asia/Jerusalem') = TIMESTAMP '2026-12-10 15:00' FROM hd_sched$$);
SELECT tests.check('fees: across the October daylight-saving change the local deadline stays 15:00 (UTC gap is 3 days + 1 hour)',
  $$SELECT ((x ->> 'free_until')::timestamptz AT TIME ZONE 'Asia/Jerusalem')::time = '15:00'
       AND ((x ->> 'arrival')::timestamptz AT TIME ZONE 'Asia/Jerusalem')::time = '15:00'
       AND (x ->> 'arrival')::timestamptz - (x ->> 'free_until')::timestamptz = interval '3 days 1 hour'
      FROM (SELECT hospitality.policy_schedule('{"free_cancel_days": 3, "fee_tiers": []}', DATE '2026-10-27', 'Asia/Jerusalem',
                                               TIME '15:00', 1000, 0) AS x) y$$);
SELECT tests.check('fees: a custom deadline time is honoured',
  $$SELECT ((hospitality.policy_schedule('{"free_cancel_days": 2, "free_cancel_time": "10:00", "fee_tiers": []}', DATE '2026-12-10',
              'Asia/Jerusalem', TIME '15:00', 1000, 0) ->> 'free_until')::timestamptz AT TIME ZONE 'Asia/Jerusalem') = TIMESTAMP '2026-12-08 10:00'$$);
SELECT tests.check('fees: multi-tier — percent of total, percent of deposit, fixed, full, in order',
  $$SELECT array_agg((p ->> 'fee')::numeric ORDER BY ord) = ARRAY[0, 100, 150, 250, 1000]::numeric[]
      FROM jsonb_array_elements(hospitality.policy_schedule(
             '{"free_cancel_days": 14, "fee_tiers": [{"from_days": 14, "fee": "percent_total", "value": 10},
               {"from_days": 7, "fee": "percent_deposit", "value": 50}, {"from_days": 3, "fee": "fixed", "value": 250},
               {"from_days": 1, "fee": "full"}]}', DATE '2026-12-20', 'Asia/Jerusalem', TIME '15:00', 1000, 300) -> 'periods')
           WITH ORDINALITY e(p, ord)$$);
SELECT tests.check('fees: a fee never exceeds the booking total',
  $$SELECT (hospitality.policy_schedule('{"fee_tiers": [{"from_days": 0, "fee": "fixed", "value": 5000}]}', DATE '2026-12-20',
             'Asia/Jerusalem', TIME '15:00', 1000, 0) -> 'periods' -> 0 ->> 'fee')::numeric = 1000$$);
SELECT tests.check('fees: without a free window or tiers the booking is non-refundable from the start',
  $$SELECT (hospitality.fee_at(hospitality.policy_schedule('{"fee_tiers": []}', DATE '2026-12-20', 'Asia/Jerusalem', TIME '15:00', 800, 0),
            now()) ->> 'fee')::numeric = 800$$);
SELECT tests.check('fees: the periods cover the whole timeline (exactly one applies at any moment)',
  $$SELECT bool_and(hospitality.fee_at(s, t) IS NOT NULL)
      FROM hd_sched, generate_series(timestamptz '2026-01-01', timestamptz '2027-01-01', interval '7 days') t$$);

-- guest cancellation flow (policy "מחמירה" on U5: deposit 30%, free until 3 days before, never automatic)
SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(200), pg_temp.d(202), 'cancel@example.com', '0591111111', 'key-can-0001') AS rc \gset
SELECT (:'rc'::jsonb) ->> 'booking_id' AS bc, (:'rc'::jsonb) ->> 'manage_token' AS tc \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'bc')) IS NOT NULL AS ok \gset
UPDATE hospitality.bookings SET amount_paid = deposit_amount WHERE id = :'bc';
SELECT tests.check('cancel quote: before the deadline the fee is 0 and the paid deposit is due back; owner approval needed',
  format($$SELECT (q ->> 'fee')::numeric = 0 AND (q ->> 'refund_due')::numeric = b.deposit_amount AND b.deposit_amount > 0
             AND q ->> 'result' = 'cancel_requested'
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.cancellation_quote(%%L)', %L)) q, hospitality.bookings b WHERE b.id = %L$$,
         :'sx', :'tc', :'bc'));
SELECT pg_temp.after('cancel request: status cancel_requested, dates still held, outcome frozen at the request time, owner + guest told',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L, NULL, %%L)', %L, 'שינוי תוכניות'))$$, :'sx', :'tc'),
  format($$SELECT $1 ->> 'status' = 'cancel_requested'
             AND (SELECT b.cancellation_requested_at IS NOT NULL AND (b.cancellation_outcome ->> 'fee')::numeric = 0
                         AND b.cancellation_outcome ->> 'requested_by' = 'guest' AND b.cancellation_reason = 'שינוי תוכניות'
                         AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = b.id)
                    FROM hospitality.bookings b WHERE b.id = %1$L)
             AND (SELECT array_agg(event ORDER BY event) FROM hospitality.notifications WHERE booking_id = %1$L
                   AND event IN ('cancellation_requested', 'cancellation_received')) =
                 ARRAY['cancellation_received', 'cancellation_requested', 'cancellation_requested']$$, :'bc'));
SELECT pg_temp.expect_error('cancel request: a second request is refused',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'tc'),
  'כבר נשלחה');
-- the deadline passes before the owner answers (simulated by moving the stored schedule into the past)
UPDATE hospitality.bookings
   SET policy_snapshot = jsonb_set(jsonb_set(policy_snapshot, '{schedule,periods,0,until}', to_jsonb(hospitality._ts(now() - interval '1 day'))),
                                   '{schedule,periods,1,from}', to_jsonb(hospitality._ts(now() - interval '1 day')))
 WHERE id = :'bc';
SELECT pg_temp.after('cancel approve: after the deadline the fee is still the one at the request time (0); refund only calculated',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_cancellation(%%L)', %L::uuid))$$, :'sx', :OWNER_X, :'bc'),
  format($$SELECT ($1 ->> 'final_fee')::numeric = 0
             AND (SELECT status = 'cancelled' AND (cancellation_outcome ->> 'refund_due')::numeric = deposit_amount AND amount_paid = deposit_amount
                    FROM hospitality.bookings WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'cancellation_approved')$$, :'bc'));

-- a request after the deadline (fee = deposit), owner reduces the fee with a reason
SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(210), pg_temp.d(212), 'late.cancel@example.com', '0591111112', 'key-can-0002') AS rl \gset
SELECT (:'rl'::jsonb) ->> 'booking_id' AS bl, (:'rl'::jsonb) ->> 'manage_token' AS tl \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'bl')) IS NOT NULL AS ok \gset
UPDATE hospitality.bookings
   SET policy_snapshot = jsonb_set(jsonb_set(policy_snapshot, '{schedule,periods,0,until}', to_jsonb(hospitality._ts(now() - interval '1 day'))),
                                   '{schedule,periods,1,from}', to_jsonb(hospitality._ts(now() - interval '1 day')))
 WHERE id = :'bl';
SELECT pg_temp.call(:'sx', NULL, format('SELECT hospitality.cancellation_quote(%L)', :'tl')) AS ql \gset
SELECT pg_temp.after('cancel quote = fee charged: the quote shown and the stored outcome are identical (deposit forfeited)',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'tl'),
  format($$SELECT ($1 -> 'cancellation_outcome' ->> 'fee')::numeric = %s AND %s = (SELECT deposit_amount FROM hospitality.bookings WHERE id = %L)
             AND %s > 0$$, (:'ql'::jsonb) ->> 'fee', (:'ql'::jsonb) ->> 'fee', :'bl', (:'ql'::jsonb) ->> 'fee'));
SELECT pg_temp.expect_error('override: raising the fee is refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_cancellation(%%L, 5000, %%L)', %L::uuid, 'סיבה'))$$, :'sx', :OWNER_X, :'bl'),
  'רק להפחית');
SELECT pg_temp.expect_error('override: a reason is required',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_cancellation(%%L, 100)', %L::uuid))$$, :'sx', :OWNER_X, :'bl'),
  'נא לציין סיבה');
SELECT pg_temp.after('override: the owner reduces the fee with a reason — recorded with the actor and the calculated fee',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.approve_cancellation(%%L, 100, %%L)', %L::uuid, 'לקוח חוזר'))$$, :'sx', :OWNER_X, :'bl'),
  format($$SELECT ($1 ->> 'final_fee')::numeric = 100
             AND (SELECT (fee_override ->> 'amount')::numeric = 100 AND (fee_override ->> 'calculated_fee')::numeric = deposit_amount
                         AND fee_override ->> 'reason' = 'לקוח חוזר' AND fee_override ->> 'actor_id' = %L
                         AND (cancellation_outcome ->> 'final_fee')::numeric = 100
                    FROM hospitality.bookings WHERE id = %L)$$, :OWNER_X, :'bl'));

-- decline a cancellation request
SELECT pg_temp.req(:'sx', NULL, :U5, pg_temp.d(220), pg_temp.d(222), 'decl@example.com', '0591111113', 'key-can-0003') AS rd \gset
SELECT (:'rd'::jsonb) ->> 'booking_id' AS bd, (:'rd'::jsonb) ->> 'manage_token' AS td \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'bd')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sx', NULL, format('SELECT hospitality.request_cancellation(%L)', :'td')) IS NOT NULL AS ok \gset
SELECT pg_temp.expect_error('cancel decline: a reason is required',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.decline_cancellation(%%L, %%L)', %L::uuid, ''))$$, :'sx', :OWNER_X, :'bd'),
  'נא לציין סיבה');
SELECT pg_temp.after('cancel decline: back to confirmed, reason sent to the guest, dates still held',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.decline_cancellation(%%L, %%L)', %L::uuid, 'מעבר למועד'))$$, :'sx', :OWNER_X, :'bd'),
  format($$SELECT $1 ->> 'status' = 'confirmed'
             AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND (SELECT payload ->> 'reason' FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'cancellation_declined') = 'מעבר למועד'$$, :'bd'));

-- automatic rules
UPDATE hospitality.units SET policy_id = '71d50000-0000-0000-0000-000000000002' WHERE id = :U6;
SELECT pg_temp.req(:'sx', NULL, :U6, pg_temp.d(230), pg_temp.d(232), 'auto@example.com', '0591111114', 'key-can-0004') AS ra \gset
SELECT (:'ra'::jsonb) ->> 'booking_id' AS ba, (:'ra'::jsonb) ->> 'manage_token' AS ta \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'ba')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('automatic (within the free window): cancelled at once, dates released, owner told',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'ta'),
  format($$SELECT $1 ->> 'status' = 'cancelled'
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'cancelled_by_guest')$$, :'ba'));
SELECT pg_temp.req(:'sx', NULL, :U6, pg_temp.d(240), pg_temp.d(242), 'auto2@example.com', '0591111115', 'key-can-0005') AS ra2 \gset
SELECT (:'ra2'::jsonb) ->> 'booking_id' AS ba2, (:'ra2'::jsonb) ->> 'manage_token' AS ta2 \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'ba2')) IS NOT NULL AS ok \gset
UPDATE hospitality.bookings
   SET policy_snapshot = jsonb_set(jsonb_set(policy_snapshot, '{schedule,periods,0,until}', to_jsonb(hospitality._ts(now() - interval '1 day'))),
                                   '{schedule,periods,1,from}', to_jsonb(hospitality._ts(now() - interval '1 day')))
 WHERE id = :'ba2';
SELECT pg_temp.after('automatic (within the free window): after the window — a request for the owner instead, fee 20%',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'ta2'),
  format($$SELECT $1 ->> 'status' = 'cancel_requested'
             AND (SELECT (cancellation_outcome ->> 'fee')::numeric = round(total * 0.2, 2) FROM hospitality.bookings WHERE id = %L)$$, :'ba2'));
SELECT pg_temp.req(:'sx', NULL, :U1, pg_temp.d(115), pg_temp.d(117), 'holiday@example.com', '0591111116', 'key-can-0006') AS rh \gset
SELECT (:'rh'::jsonb) ->> 'booking_id' AS bh, (:'rh'::jsonb) ->> 'manage_token' AS th \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format('SELECT hospitality.approve_booking(%L)', :'bh')) IS NOT NULL AS ok \gset
SELECT pg_temp.after('automatic (always, holiday policy): cancelled at once with the full fee',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'th'),
  format($$SELECT $1 ->> 'status' = 'cancelled'
             AND (SELECT (cancellation_outcome ->> 'final_fee')::numeric = total FROM hospitality.bookings WHERE id = %L)$$, :'bh'));

-- withdrawing a pending request, owner cancellation, stay statuses, no-show
SELECT pg_temp.req(:'sx', NULL, :U2, pg_temp.d(250), pg_temp.d(251), 'withdraw@example.com', '0591111117', 'key-can-0007') AS rw \gset
SELECT (:'rw'::jsonb) ->> 'booking_id' AS bwd, (:'rw'::jsonb) ->> 'manage_token' AS twd \gset
SELECT pg_temp.after('withdraw: a pending request cancelled by the guest has no fee and frees the dates; owner told',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.request_cancellation(%%L)', %L))$$, :'sx', :'twd'),
  format($$SELECT $1 ->> 'status' = 'cancelled'
             AND (SELECT (cancellation_outcome ->> 'fee')::numeric = 0 FROM hospitality.bookings WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'request_withdrawn')$$, :'bwd'));
SELECT pg_temp.after('owner cancel: fee from the snapshot at the time of cancellation; guest told',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.cancel_booking(%%L, %%L)', %L::uuid, 'סגירת עונה'))$$, :'sx', :OWNER_X, :'bd'),
  format($$SELECT $1 ->> 'status' = 'cancelled'
             AND (SELECT cancellation_outcome ->> 'requested_by' = 'staff' FROM hospitality.bookings WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'booking_cancelled')$$, :'bd'));
SELECT pg_temp.call(:'sx', :OWNER_X, format($$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => current_date,
   _check_out => current_date + 2, _full_name => 'מגיע היום', _phone => '0592222222', _terms_explained => true)$$, :U4)) ->> 'booking_id' AS bn \gset
SELECT pg_temp.call(:'sx', :OWNER_X, format($$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => current_date + 30,
   _check_out => current_date + 32, _full_name => 'עתידי', _phone => '0592222223', _terms_explained => true)$$, :U4)) ->> 'booking_id' AS bf \gset
SELECT pg_temp.expect_error('no-show: cannot be marked before the arrival day',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.set_stay_status(%%L, %%L)', %L::uuid, 'no_show'))$$, :'sx', :OWNER_X, :'bf'),
  'רק מיום ההגעה');
SELECT pg_temp.after('no-show: the snapshot no-show fee is recorded and the dates released',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.set_stay_status(%%L, %%L)', %L::uuid, 'no_show'))$$, :'sx', :OWNER_X, :'bn'),
  format($$SELECT $1 ->> 'status' = 'no_show'
             AND (SELECT (cancellation_outcome ->> 'final_fee')::numeric = (policy_snapshot -> 'schedule' ->> 'no_show_fee')::numeric
                    FROM hospitality.bookings WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %1$L)$$, :'bn'));
SELECT pg_temp.call(:'sx', :OWNER_X, format($$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => current_date,
   _check_out => current_date + 1, _full_name => 'צ׳ק אין', _phone => '0592222224', _terms_explained => true)$$, :U4)) ->> 'booking_id' AS bk \gset
SELECT pg_temp.after('stay: check-in keeps the dates held',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.set_stay_status(%%L, %%L)', %L::uuid, 'checked_in'))$$, :'sx', :OWNER_X, :'bk'),
  format($$SELECT $1 ->> 'status' = 'checked_in' AND EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %L)$$, :'bk'));
SELECT pg_temp.after('stay: check-out releases them',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.set_stay_status(%%L, %%L)', %L::uuid, 'checked_out'))$$, :'sx', :OWNER_X, :'bk'),
  format($$SELECT $1 ->> 'status' = 'checked_out' AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE booking_id = %L)$$, :'bk'));
SELECT pg_temp.expect_error('stay: a checked-out stay cannot be cancelled',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.cancel_booking(%%L)', %L::uuid))$$, :'sx', :OWNER_X, :'bk'),
  'בסטטוס הזה');
SELECT tests.check('payments: nothing is charged or refunded in this stage (amount_paid only changes by explicit entry)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE amount_paid > 0 AND idempotency_key IS DISTINCT FROM 'key-can-0001')$$);

-- ============================================================
-- 9. Guest isolation
-- ============================================================
SELECT tests.check('token: the guest reads the booking with its manage link',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) ->> 'id' = %L$$, :'sx', :'t1', :'b1'));
SELECT tests.check('token: the guest view has no internal notes or audit details',
  format($$SELECT NOT (v ? 'notes') AND NOT (v ? 'policy_acceptance') AND NOT (v ? 'manage_token_hash')
          FROM pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) v$$, :'sx', :'t1'));
SELECT pg_temp.expect_error('token: the same link on another site is not found',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L))$$, :'sy', :'t1'), 'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('token: a wrong token is not found',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', repeat('a', 64)))$$, :'sx'), 'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('token: a malformed token is not found',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', 'x'' OR 1=1 --'))$$, :'sx'), 'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('token: the stored hash itself is not a valid link',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', (SELECT manage_token_hash FROM hospitality.bookings WHERE id = %L)))$$, :'sx', :'b1'),
  'ההזמנה לא נמצאה');
SELECT tests.check('token: the unverified guest''s link works before it expires',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) ->> 'id' = %L$$, :'sx', :'tu', :'bu'));
UPDATE hospitality.bookings SET manage_token_expires_at = now() - interval '1 second' WHERE id = :'bu';
SELECT pg_temp.expect_error('token: an expired link (30 days after check-out) is not found',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L))$$, :'sx', :'tu'),
  'ההזמנה לא נמצאה');
SELECT tests.check('token: valid until 30 days after check-out (end of day, business time zone)',
  format($$SELECT manage_token_expires_at = ((check_out + 31)::timestamp AT TIME ZONE 'Asia/Jerusalem') FROM hospitality.bookings WHERE id = %L$$, :'b1'));
SELECT tests.check('my bookings: a linked verified guest sees exactly their own bookings on this site',
  format($$SELECT jsonb_array_length(v) = 1 AND v -> 0 ->> 'id' = %L
          FROM pg_temp.call(%L, %L, 'SELECT hospitality.my_bookings()') v$$, :'bv', :'sx', :GUEST_V));
SELECT tests.check('my bookings: an unlinked account sees nothing',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.my_bookings()') = '[]'::jsonb$$, :'sx', :GUEST_U));
SELECT tests.check('my bookings: … and nothing on another site',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT hospitality.my_bookings()') = '[]'::jsonb$$, :'sy', :GUEST_V));
SELECT pg_temp.expect_error('by id: a logged-in guest cannot read another guest''s booking by id',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.cancellation_quote(NULL, %%L)', %L::uuid))$$, :'sx', :GUEST_V, :'b1'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('by id: … nor cancel it',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.request_cancellation(NULL, %%L)', %L::uuid))$$, :'sx', :GUEST_V, :'b1'),
  'ההזמנה לא נמצאה');
SELECT pg_temp.expect_error('by id: anon cannot address bookings by id',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.cancellation_quote(NULL, %%L)', %L::uuid))$$, :'sx', :'bv'),
  'ההזמנה לא נמצאה');
SELECT tests.check('by id: the linked guest can read their own booking by id',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.cancellation_quote(NULL, %%L)', %L::uuid)) ? 'fee'$$, :'sx', :GUEST_V, :'bv'));
SELECT tests.run('tables: a logged-in guest reads no Hospitality table rows', 'SELECT * FROM hospitality.bookings', :GUEST_V, NULL, 0);
SELECT tests.run('tables: anon has no table access', 'SELECT * FROM hospitality.guests', NULL, 'permission denied');
SELECT tests.run('tables: a guest cannot write bookings', 'UPDATE hospitality.bookings SET total = 0', :GUEST_V, 'permission denied');
SELECT tests.run('tables: even the owner cannot write bookings directly', 'UPDATE hospitality.bookings SET total = 0', :OWNER_X, 'permission denied');

-- claiming past bookings: verified email only, this site only
UPDATE auth.users SET email_confirmed_at = now() WHERE id = :GUEST_U;
SELECT pg_temp.after('claim: after verifying the account email, the guest links their earlier booking on this site',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.claim_guest_bookings())')$$, :'sx', :GUEST_U),
  format($$SELECT $1::integer = 1
             AND (SELECT g.user_id = %L FROM hospitality.guests g JOIN hospitality.bookings b ON b.guest_id = g.id WHERE b.id = %L)$$,
         :GUEST_U, :'bu'));
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :GUEST_U;
SELECT pg_temp.expect_error('claim: an unverified account cannot link anything',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.claim_guest_bookings())')$$, :'sx', :GUEST_U),
  'אימייל מאומת');
SELECT pg_temp.expect_error('claim: not available to anon',
  format($$SELECT pg_temp.call(%L, NULL, 'SELECT to_jsonb(hospitality.claim_guest_bookings())')$$, :'sx'), 'permission denied');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = :ECOM_OWNER;
SELECT pg_temp.after('claim: a verified Ecommerce store owner claims only the booking made with their own email',
  format($$SELECT pg_temp.call(%L, %L, 'SELECT to_jsonb(hospitality.claim_guest_bookings())')$$, :'sx', :ECOM_OWNER),
  format($$SELECT $1::integer = 1 AND jsonb_array_length(pg_temp.call(%L, %L, 'SELECT hospitality.my_bookings()')) = 1$$, :'sx', :ECOM_OWNER));
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = :ECOM_OWNER;

-- staff of one site cannot reach another site's bookings
SELECT tests.check('staff isolation: owner Y on the site X host reads no bookings',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.bookings'))::integer = 0$$, :'sx', :OWNER_Y));
SELECT pg_temp.expect_error('staff isolation: owner Y cannot export a guest of site X',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.export_guest(%%L)', (SELECT guest_id FROM hospitality.bookings WHERE id = %L)))$$,
         :'sy', :OWNER_Y, :'b1'),
  'האורח לא נמצא');
SELECT tests.check('staff: the owner reads only site X bookings',
  format($$SELECT (pg_temp.call(%L, %L, 'SELECT to_jsonb(count(*)) FROM hospitality.bookings'))::integer
                  = (SELECT count(*) FROM hospitality.bookings WHERE tenant_id = %L)$$, :'sx', :OWNER_X, :'sx'));

-- ============================================================
-- 10. Email outbox (filled and tested; nothing is sent in this stage)
-- ============================================================
SELECT tests.check('outbox: owner emails go to the notification recipients when set',
  format($$SELECT hospitality._owner_emails(%L) = ARRAY['owner.x@test.local', 'desk.x@test.local']$$, :'sx'));
INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71d10000-0000-0000-0000-0000000000d9', 'hd1d-z', 'בלי מייל', 'hospitality');
INSERT INTO hospitality.settings (tenant_id) VALUES ('71d10000-0000-0000-0000-0000000000d9');
SELECT tests.check('outbox: a site with no contact address at all has no owner recipient yet',
  $$SELECT hospitality._owner_emails('71d10000-0000-0000-0000-0000000000d9') = '{}'::text[]$$);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
  ('71d10000-0000-0000-0000-0000000000d9', :OWNER_Y, 'Owner.Y@test.local', 'owner_y_z', 'admin', true);
SELECT tests.check('outbox: … and falls back to the owner''s account email once the site has an owner',
  $$SELECT hospitality._owner_emails('71d10000-0000-0000-0000-0000000000d9') = ARRAY['owner.y@test.local']$$);
SELECT tests.check('outbox: the dedupe key makes an event idempotent (second enqueue adds nothing)',
  format($$SELECT hospitality._enqueue(b, 'new_request', 'owner', '{}', true) = 0 FROM hospitality.bookings b WHERE b.id = %L$$, :'b1'));
UPDATE hospitality.notifications SET status = 'sent', sent_at = now() WHERE status = 'queued' AND booking_id <> :'b1';
SELECT pg_temp.after('outbox: a worker claims the queued rows (sending, attempt 1, locked)',
  $$SELECT jsonb_agg(to_jsonb(n)) FROM hospitality.claim_notifications(10) n$$,
  format($$SELECT jsonb_array_length($1) = 4
             AND (SELECT bool_and(status = 'sending' AND attempts = 1 AND locked_until > now()) FROM hospitality.notifications WHERE booking_id = %L)$$, :'b1'));
SELECT pg_temp.after('outbox: a second worker gets none of the rows being sent',
  $$SELECT to_jsonb(count(*)) FROM hospitality.claim_notifications(10)$$, $$SELECT $1::integer = 0$$);
SELECT id AS n1 FROM hospitality.notifications WHERE booking_id = :'b1' AND event = 'request_received' \gset
SELECT pg_temp.after('outbox: a failed send is retried later with backoff; the booking is untouched',
  format($$SELECT to_jsonb(hospitality.mark_notification(%L, false, 'Resend 503'))$$, :'n1'),
  format($$SELECT $1 #>> '{}' = 'failed'
             AND (SELECT next_attempt_at > now() + interval '50 seconds' AND last_error = 'Resend 503' FROM hospitality.notifications WHERE id = %L)
             AND (SELECT status = 'confirmed' FROM hospitality.bookings WHERE id = %L)$$, :'n1', :'b1'));
SELECT pg_temp.after('outbox: not claimed again before the retry time',
  $$SELECT COALESCE(jsonb_agg(n.id), '[]') FROM hospitality.claim_notifications(10) n$$,
  format($$SELECT NOT ($1 ? %L)$$, :'n1'));
UPDATE hospitality.notifications SET next_attempt_at = now() - interval '1 second' WHERE id = :'n1';
SELECT pg_temp.after('outbox: claimed again when due (attempt 2)',
  $$SELECT jsonb_agg(to_jsonb(n)) FROM hospitality.claim_notifications(10) n$$,
  format($$SELECT (SELECT attempts = 2 AND status = 'sending' FROM hospitality.notifications WHERE id = %L)$$, :'n1'));
SELECT pg_temp.after('outbox: sent — provider id stored, manage token removed from the stored content',
  format($$SELECT to_jsonb(hospitality.mark_notification(%L, true, NULL, 'resend_123'))$$, :'n1'),
  format($$SELECT $1 #>> '{}' = 'sent'
             AND (SELECT sent_at IS NOT NULL AND provider_message_id = 'resend_123' AND NOT (payload ? 'manage_token')
                    FROM hospitality.notifications WHERE id = %L)$$, :'n1'));
SELECT pg_temp.after('outbox: marking a sent email again changes nothing',
  format($$SELECT to_jsonb(hospitality.mark_notification(%L, false, 'late failure'))$$, :'n1'),
  format($$SELECT $1 #>> '{}' = 'sent' AND (SELECT status = 'sent' AND last_error IS NULL FROM hospitality.notifications WHERE id = %L)$$, :'n1'));
SELECT id AS n2 FROM hospitality.notifications WHERE booking_id = :'b1' AND event = 'booking_confirmed' \gset
UPDATE hospitality.notifications SET attempts = 5 WHERE id = :'n2';
SELECT pg_temp.after('outbox: after the fifth failure the email is dead with the error kept',
  format($$SELECT to_jsonb(hospitality.mark_notification(%L, false, 'mailbox full'))$$, :'n2'),
  format($$SELECT $1 #>> '{}' = 'dead' AND (SELECT last_error = 'mailbox full' FROM hospitality.notifications WHERE id = %L)$$, :'n2'));
SELECT id AS n3 FROM hospitality.notifications WHERE booking_id = :'b1' AND event = 'new_request' AND recipient_email = 'owner.x@test.local' \gset
UPDATE hospitality.notifications SET locked_until = now() - interval '1 second' WHERE id = :'n3';
SELECT pg_temp.after('outbox: a row stuck in "sending" (worker crashed) is claimed again',
  $$SELECT jsonb_agg(n.id) FROM hospitality.claim_notifications(10) n$$,
  format($$SELECT $1 ? %L AND (SELECT attempts = 2 FROM hospitality.notifications WHERE id = %L)$$, :'n3', :'n3'));
SELECT tests.run('outbox: the worker functions are not callable through the API',
  'SELECT * FROM hospitality.claim_notifications(1)', :OWNER_X, 'permission denied');
-- Stage 2a (migration 7): the outbox payload holds the guest's manage-link token until the
-- email is sent, so staff no longer read the table; the email status comes from
-- staff_email_status() (no payload, masked recipient). Tested in hospitality-management.test.sql.
SELECT tests.check('outbox: the owner sees the email status of their bookings (read-only, through the safe function)',
  format($$SELECT jsonb_array_length(pg_temp.call(%L, %L, format('SELECT hospitality.staff_email_status(%%L)', %L)))
                  = (SELECT count(*) FROM hospitality.notifications WHERE tenant_id = %L AND booking_id = %L)$$,
         :'sx', :OWNER_X, :'b1', :'sx', :'b1'));

-- ============================================================
-- 11. Privacy
-- ============================================================
SELECT tests.check('privacy: the owner exports a guest card with their bookings',
  format($$SELECT jsonb_array_length(pg_temp.call(%L, %L, format('SELECT hospitality.export_guest(%%L)',
                  (SELECT guest_id FROM hospitality.bookings WHERE id = %L))) -> 'bookings') >= 1$$, :'sx', :OWNER_X, :'b1'));
SELECT pg_temp.expect_error('privacy: a guest with a live booking cannot be anonymised',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', (SELECT guest_id FROM hospitality.bookings WHERE id = %L)))$$,
         :'sx', :OWNER_X, :'b1'),
  'הזמנה פעילה');
SELECT guest_id AS gc FROM hospitality.bookings WHERE id = :'bc' \gset
SELECT pg_temp.after('privacy: a guest without live bookings is anonymised (contact, token, IP, emails scrubbed)',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L::uuid))$$, :'sx', :OWNER_X, :'gc'),
  format($$SELECT $1::boolean
             AND (SELECT full_name = 'אורח שנמחק' AND email IS NULL AND phone IS NULL AND anonymized_at IS NOT NULL
                    FROM hospitality.guests WHERE id = %L)
             AND (SELECT manage_token_hash IS NULL AND NOT (policy_acceptance ? 'ip') FROM hospitality.bookings WHERE id = %L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %L
                               AND (payload <> '{}' OR recipient_email = 'cancel@example.com'))$$, :'gc', :'bc', :'bc'));
SELECT pg_temp.expect_error('privacy: a guest cannot anonymise anyone',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT to_jsonb(hospitality.anonymize_guest(%%L))', %L::uuid))$$, :'sx', :GUEST_V, :'gc'),
  'אין הרשאה');
SELECT tests.check('privacy: retention does nothing while no period is set',
  $$SELECT hospitality.apply_retention() = 0$$);
UPDATE hospitality.settings SET guest_retention_months = 6 WHERE tenant_id = :'sy';
UPDATE hospitality.guests SET created_at = now() - interval '2 years' WHERE tenant_id = :'sy' AND email_normalized = 'dana@example.com';
SELECT tests.check('privacy: retention keeps a guest whose booking still holds dates',
  $$SELECT hospitality.apply_retention() = 0$$);
INSERT INTO hospitality.guests (tenant_id, full_name, email, phone, created_at)
VALUES (:'sy', 'אורח ישן', 'old.guest@example.com', '0501231234', now() - interval '2 years');
SELECT pg_temp.after('privacy: retention anonymises an old guest with no recent stay (only where a period is set)',
  $$SELECT to_jsonb(hospitality.apply_retention())$$,
  format($$SELECT $1::integer = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.guests WHERE email = 'old.guest@example.com')
             AND EXISTS (SELECT 1 FROM hospitality.guests WHERE tenant_id = %L AND email_normalized = 'dana@example.com')$$, :'sy'));

-- ============================================================
-- 12. Flags
-- ============================================================
SELECT pg_temp.as_platform(format($$SELECT public.platform_set_flag('hospitality_booking_enabled', false, %L)$$, :'sx'));
SELECT pg_temp.expect_error('flags: with bookings closed on the site, guests cannot request …',
  format($$SELECT pg_temp.req(%L, NULL, %L, pg_temp.d(260), pg_temp.d(261), 'closed@example.com', '0599999991', 'key-closed-0001')$$, :'sx', :U2),
  'אינן פעילות');
SELECT tests.check('flags: … but can still read and manage existing bookings with their link',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L)) ->> 'id' = %L$$, :'sx', :'t1', :'b1'));
SELECT tests.check('flags: … and the owner can still quote for a manual booking',
  format($$SELECT (pg_temp.call(%L, %L, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(260), pg_temp.d(261))) ->> 'available')::boolean$$,
         :'sx', :OWNER_X, :U2));
SELECT pg_temp.as_platform(format($$SELECT public.platform_set_flag('hospitality_backend_enabled', false, %L)$$, :'sx'));
SELECT pg_temp.expect_error('flags: with the backend off, the manage link is closed too',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.get_booking_by_token(%%L)', %L))$$, :'sx', :'t1'), 'אינן פעילות');
SELECT pg_temp.expect_error('flags: … and the owner functions are refused',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.decline_booking(%%L)', %L::uuid))$$, :'sx', :OWNER_X, :'b1'), 'אין הרשאה');
SELECT pg_temp.expect_error('flags: an Ecommerce store is never a booking site',
  format($$SELECT pg_temp.call(%L, NULL, format('SELECT hospitality.quote(%%L, %%L, %%L)', %L::uuid, pg_temp.d(30), pg_temp.d(31)))$$, :STORE_A, :U1),
  'אינן פעילות');
SELECT pg_temp.as_platform(format($$SELECT public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
                                         public.platform_set_flag('hospitality_booking_enabled', true, %1$L)$$, :'sx'));

-- ============================================================
-- 13. Ecommerce unchanged / site deletion
-- ============================================================
SELECT tests.check('ecommerce: no booking-engine object in the public schema',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                         AND proname IN ('quote', 'request_booking', 'expire_holds', 'claim_notifications'))
       AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
                         AND relname IN ('bookings', 'guests', 'unit_occupancy', 'notifications'))$$);
SELECT tests.check('ecommerce: store tables hold no rows of the Hospitality sites',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.orders WHERE tenant_id IN (%L, %L))
             AND NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE tenant_id IN (%L, %L))$$, :'sx', :'sy', :'sx', :'sy'));
SELECT pg_temp.as_platform(format($$SELECT public.platform_delete_tenant(%L, 'hd1d-y')$$, :'sy'));
SELECT tests.check('site deletion: the platform delete removes the site with all its bookings, guests, history and emails',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.guests WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.booking_events WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE tenant_id = %1$L)$$, :'sy'));

DROP TABLE hd_counts;
DROP TABLE hd_sched;

-- leave the platform flags as the migration left them (other test files check the defaults)
SELECT pg_temp.as_platform($$SELECT public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_booking_enabled', false)$$);

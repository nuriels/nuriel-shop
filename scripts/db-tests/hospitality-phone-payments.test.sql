-- ============================================================
-- Hospitality D4 (migration 28): phone payments on the payments ledger (migration 23)
--   • request → approved → paid are separate: approving never marks a booking paid;
--     payment_status follows only what the business recorded (fixed: it stayed 'unpaid');
--   • no card numbers in payment notes (database guard);
--   • confirm_payment (Stage 1, server only) records through the ledger — one payment system.
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000000da1'''
\set UP '''7d410000-0000-0000-0000-0000000000d1'''

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
CREATE OR REPLACE FUNCTION pg_temp.srv(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site,
    'user-agent', 'db-test', 'x-forwarded-for', '203.0.113.7')::text END, true);
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
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.state(_b uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT status || '/' || payment_status || '/' || amount_paid::numeric(12, 2) FROM hospitality.bookings WHERE id = _b;
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000da1', 'd4.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('d4-phone', 'עסק עם תשלום טלפוני', 'd4.owner@test.local')$$) ->> 'id' AS sp \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'sp', :OWNER_P, 'd4.owner@test.local', 'd4_owner', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true, %L))$$, :'sp')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
VALUES ('7d400000-0000-0000-0000-0000000000d1', :'sp', 'מתחם', 'd4-p', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
VALUES (:UP, :'sp', '7d400000-0000-0000-0000-0000000000d1', 'unit', 'צימר', 'd4-u', 4, 2, 500);

-- 1. the guest's request (through the app server)
SELECT pg_temp.srv(:'sp', format(
  $$SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => 'רוני לוי',
      _email => 'roni.d4@example.com', _phone => '0547778888', _idempotency_key => 'd4-key-0001', _policy_accepted => true,
      _policy_hash => (SELECT hospitality.quote(%L, %L, %L) ->> 'policy_hash'))$$,
  :UP, pg_temp.d(30), pg_temp.d(32), :UP, pg_temp.d(30), pg_temp.d(32))) ->> 'booking_id' AS bp \gset
SELECT tests.check('phone payment: a new request — waiting for approval, nothing paid',
  format($$SELECT pg_temp.state(%L) = 'pending_approval/unpaid/0.00'$$, :'bp'));
SELECT tests.check('phone payment: the owner sees the guest phone in full on the booking',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.staff_booking_detail(%%L)', %L)) -> 'guest' ->> 'phone' = '0547778888'$$,
         :'sp', :OWNER_P, :'bp'));

-- 2. approving is not paying
SELECT pg_temp.call(:'sp', :OWNER_P, format('SELECT to_jsonb(hospitality.approve_booking(%L))', :'bp')) IS NOT NULL AS ok \gset
SELECT tests.check('phone payment: approved — still not paid (approval never marks a payment)',
  format($$SELECT pg_temp.state(%L) = 'confirmed/unpaid/0.00'$$, :'bp'));

-- 3. the owner charges by phone and records it
SELECT pg_temp.call(:'sp', :OWNER_P, format(
  $$SELECT hospitality.payment_record(%L, 'deposit', 'card', 300, current_date, 'אסמכתא 778899 · 4 ספרות 1234')$$, :'bp')) IS NOT NULL AS ok \gset
SELECT tests.check('phone payment: a recorded deposit → "deposit paid" (the status follows the ledger — was stuck on unpaid)',
  format($$SELECT pg_temp.state(%L) = 'confirmed/deposit_paid/300.00'$$, :'bp'));
SELECT pg_temp.call(:'sp', :OWNER_P, format(
  $$SELECT hospitality.payment_record(%L, 'balance', 'card', (SELECT total - 300 FROM hospitality.bookings WHERE id = %L), current_date, NULL)$$,
  :'bp', :'bp')) IS NOT NULL AS ok \gset
SELECT tests.check('phone payment: the balance recorded → paid',
  format($$SELECT pg_temp.state(%L) = 'confirmed/paid/' || (SELECT total::numeric(12, 2) FROM hospitality.bookings WHERE id = %L)$$, :'bp', :'bp'));
SELECT id AS last_payment FROM hospitality.payments WHERE booking_id = :'bp' AND kind = 'balance' \gset
SELECT pg_temp.call(:'sp', :OWNER_P, format($$SELECT hospitality.payment_void(%L, 'נרשם בטעות')$$, :'last_payment')) IS NOT NULL AS ok \gset
SELECT tests.check('phone payment: voiding a wrong record → back to deposit paid',
  format($$SELECT pg_temp.state(%L) = 'confirmed/deposit_paid/300.00'$$, :'bp'));

-- 4. no card numbers in the system
SELECT pg_temp.expect_error('card data: a card number in the payment note is refused by the database',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.payment_record(%%L, ''balance'', ''card'', 10, current_date, ''4580 1234 5678 9010'')', %L))$$,
         :'sp', :OWNER_P, :'bp'),
  'payments_note_no_card');
SELECT pg_temp.expect_error('card data: … also without spaces',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.payment_record(%%L, ''balance'', ''card'', 10, current_date, ''כרטיס 4580123456789010 תוקף 12/28'')', %L))$$,
         :'sp', :OWNER_P, :'bp'),
  'payments_note_no_card');
SELECT tests.check('card data: the refused records left nothing behind',
  format($$SELECT pg_temp.state(%L) = 'confirmed/deposit_paid/300.00'
             AND (SELECT count(*) FROM hospitality.payments WHERE booking_id = %L AND status = 'recorded') = 1$$, :'bp', :'bp'));

-- 5. confirm_payment (Stage 1, server only) — through the ledger
SELECT pg_temp.srv(:'sp', format(
  $$SELECT hospitality.request_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => 'מיכל',
      _email => 'michal.d4@example.com', _phone => '0547779999', _idempotency_key => 'd4-key-0002', _policy_accepted => true,
      _policy_hash => (SELECT hospitality.quote(%L, %L, %L) ->> 'policy_hash'))$$,
  :UP, pg_temp.d(40), pg_temp.d(42), :UP, pg_temp.d(40), pg_temp.d(42))) ->> 'booking_id' AS bq \gset
DO $t$
BEGIN
  PERFORM hospitality._set_actor('system', 'בדיקה: ממתינה לתשלום');
  UPDATE hospitality.bookings SET status = 'pending_payment', hold_expires_at = now() + interval '1 hour'
   WHERE id = (SELECT id FROM hospitality.bookings WHERE idempotency_key = 'd4-key-0002');
  PERFORM hospitality._set_actor('', NULL);
END $t$;
SELECT pg_temp.srv(NULL, format('SELECT hospitality.confirm_payment(%L, (SELECT total FROM hospitality.bookings WHERE id = %L))', :'bq', :'bq')) IS NOT NULL AS ok \gset
SELECT tests.check('one payment system: confirm_payment confirms and records the payment in the ledger',
  format($$SELECT pg_temp.state(%1$L) = 'confirmed/paid/' || (SELECT total::numeric(12, 2) FROM hospitality.bookings WHERE id = %1$L)
             AND (SELECT count(*) = 1 AND bool_and(method = 'provider' AND provider = 'confirm' AND status = 'recorded')
                    FROM hospitality.payments WHERE booking_id = %1$L)$$, :'bq'));
SELECT tests.check('one payment system: the paid amount equals the ledger (no amount outside it)',
  $$SELECT NOT EXISTS (
      SELECT 1 FROM hospitality.bookings b
       WHERE b.tenant_id = (SELECT id FROM public.tenants WHERE slug = 'd4-phone')
         AND b.amount_paid <> greatest(COALESCE((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END)
                                                  FROM hospitality.payments p WHERE p.booking_id = b.id AND p.status = 'recorded'), 0), 0))$$);
SELECT pg_temp.expect_error('one payment system: confirm_payment is still server-only',
  format($$SELECT pg_temp.call(%L, %L, format('SELECT hospitality.confirm_payment(%%L, 1)', %L))$$, :'sp', :OWNER_P, :'bq'),
  'permission denied');

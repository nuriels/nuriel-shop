-- ============================================================
-- Hospitality — bank-transfer policy and transfer proofs (20261108100000_hosp_bank_transfer.sql, migration 55)
--   • the table: RLS, no direct grants, restrictive isolation + backend policies, tenant guard; the bucket is private;
--   • the 7-day rule (arrival at least 7 days after the day of booking, at the business): the site, the guest
--     page, the guest's choice and the guest emails — always computed in the database;
--   • the guest's choice: only methods the business takes, bank only by the rule, recorded in the history;
--   • upload: only for an approved booking with money due; pending (invisible) → ready (server only) →
--     submitted; at most 3 unfinished uploads an hour and 5 proofs a booking; another business gets nothing;
--   • staff (bookings permission): the list, the file path (never of an unfinished upload), approve (= a ledger
--     payment, so the payment status follows) or reject (with a reason the guest sees), each proof once only;
--     the dashboard count.
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000055a01'''
\set OWNER_X '''a0000000-0000-0000-0000-000000055a03'''
\set PP '''75500000-0000-0000-0000-0000000000f1'''
\set P1 '''75500000-0000-0000-0000-0000000000a1'''
\set XP '''75500000-0000-0000-0000-0000000000f2'''
\set X1 '''75500000-0000-0000-0000-0000000000b1'''

-- the business's date (Asia/Jerusalem), as the rule counts it
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
-- the app server (service key), for the business of the address
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
CREATE OR REPLACE FUNCTION pg_temp.manual(_site text, _uid uuid, _unit uuid, _in date, _out date,
                                          _status text DEFAULT 'confirmed') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _terms_explained => true, _status => %L)',
    _unit, _in, _out, 'אורח העברה', '0541234567', _status));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.guest(_site text, _token text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, format('SELECT hospitality.guest_payment_info(%L)', _token));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.choose(_site text, _token text, _method text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, format('SELECT hospitality.guest_set_payment_method(%L, NULL, %L)', _token, _method));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.choose_err(_site text, _token text, _method text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.err_of(_site, NULL, format('SELECT hospitality.guest_set_payment_method(%L, NULL, %L)', _token, _method));
$f$;
-- the server registers a slot in the guest's name (the guest's link), uploads, then marks it ready
CREATE OR REPLACE FUNCTION pg_temp.slot(_site text, _token text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, format(
    'SELECT hospitality.guest_proof_slot(%L, NULL, %L, %L, %s)', _token, 'אישור-העברה.png', 'image/png', 2048));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.slot_err(_site text, _token text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.err_of(_site, NULL, format(
    'SELECT hospitality.guest_proof_slot(%L, NULL, %L, %L, %s)', _token, 'אישור-העברה.png', 'image/png', 2048));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.upload(_site text, _token text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE _id uuid;
BEGIN
  _id := (pg_temp.slot(_site, _token) ->> 'id')::uuid;
  PERFORM pg_temp.srv(_site, format('SELECT to_jsonb(hospitality.guest_proof_ready(%L))', _id));
  RETURN _id;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.review(_site text, _uid uuid, _proof uuid, _decision text, _amount numeric,
                                          _note text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.payment_proof_review(%L, %L, %L, %L)',
                                          _proof, _decision, _amount, _note));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.review_err(_site text, _uid uuid, _proof uuid, _decision text, _amount numeric,
                                              _note text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.err_of(_site, _uid, format('SELECT hospitality.payment_proof_review(%L, %L, %L, %L)',
                                            _proof, _decision, _amount, _note));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000055a01', 'm55.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000055a03', 'm55.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m55-bank', 'צימרי ההעברה', 'm55.owner@test.local')$$) ->> 'id' AS sp \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m55-other', 'עסק אחר 55', 'm55.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sp', :OWNER_P, 'm55.owner@test.local', 'm55_owner', 'admin', true, 'דורית'),
  (:'sx', :OWNER_X, 'm55.other@test.local', 'm55_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sp', :'sx')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:PP, :'sp', 'מתחם ההעברה', 'm55-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'm55-x', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:P1, :'sp', :PP, 'unit', 'בקתת ההעברה', 'm55-p1', 4, 2, 500),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'm55-x1', 4, 2, 500);
-- the business takes bank transfers (and phone payment, the default); the other business — phone only
SELECT pg_temp.call(:'sp', :OWNER_P, $$SELECT hospitality.payment_settings_save('{"bank_enabled": true, "bank_name": "בנק לאומי",
  "bank_branch": "800", "bank_account": "123456", "bank_holder": "דורית כהן"}'::jsonb, 0)$$) IS NOT NULL AS ok \gset

-- bookings made today (one unit, dates apart): 6 days ahead, exactly 7, a month ahead (the upload flow),
-- a request not approved yet, and two for the limits
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(6), pg_temp.d(7)) AS j \gset
SELECT (:'j'::jsonb) ->> 'booking_id' AS b_near, (:'j'::jsonb) ->> 'manage_token' AS t_near \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(7), pg_temp.d(8)) AS j \gset
SELECT (:'j'::jsonb) ->> 'booking_id' AS b_edge, (:'j'::jsonb) ->> 'manage_token' AS t_edge \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(30), pg_temp.d(32)) AS j \gset
SELECT (:'j'::jsonb) ->> 'booking_id' AS b_far, (:'j'::jsonb) ->> 'manage_token' AS t_far \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(40), pg_temp.d(41), 'pending_approval') AS j \gset
SELECT (:'j'::jsonb) ->> 'booking_id' AS b_pend, (:'j'::jsonb) ->> 'manage_token' AS t_pend \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(50), pg_temp.d(51)) AS j \gset
SELECT (:'j'::jsonb) ->> 'manage_token' AS t_cap \gset
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(60), pg_temp.d(61)) AS j \gset
SELECT (:'j'::jsonb) ->> 'manage_token' AS t_flood \gset
-- booked 10 days ago, arriving in 3 days: 13 days between booking and arrival
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(3), pg_temp.d(4)) AS j \gset
SELECT (:'j'::jsonb) ->> 'booking_id' AS b_old, (:'j'::jsonb) ->> 'manage_token' AS t_old \gset
UPDATE hospitality.bookings SET created_at = now() - interval '10 days' WHERE id = :'b_old';

-- ============================================================
-- 1. The table, the bucket and who may call what
-- ============================================================
SELECT tests.check('transfer (55): the proofs table has RLS, no direct grants, restrictive isolation + backend policies and the tenant guard',
  $$SELECT c.relrowsecurity
       AND NOT bool_or(has_table_privilege(r, 'hospitality.payment_proofs', p))
       AND (SELECT count(*) FROM pg_policies x WHERE x.schemaname = 'hospitality' AND x.tablename = 'payment_proofs'
              AND x.permissive = 'RESTRICTIVE' AND x.policyname IN ('tenant_isolation', 'backend_enabled')) = 2
       AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
      FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
     WHERE c.oid = 'hospitality.payment_proofs'::regclass
     GROUP BY c.relrowsecurity, c.oid$$);
SELECT tests.check('transfer (55): the proofs bucket is private — 5MB, images and PDF only',
  $$SELECT NOT public AND file_size_limit = 5242880
       AND allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
      FROM storage.buckets WHERE id = 'hosp-payment-proofs'$$);
SELECT tests.check('transfer (55): "ready" and the email helper are server-only; staff functions are not for guests; the rule helpers are internal',
  $$SELECT NOT has_function_privilege('anon', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.email_booking_payment_methods(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.email_booking_payment_methods(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.booking_payment_proofs(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.payment_proof_file(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.payment_proof_review(uuid,text,numeric,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.payment_proofs_waiting()', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._bank_for_booking(hospitality.bookings)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality._transfer_state(hospitality.bookings)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._bank_transfer_allowed(uuid,date,date)', 'EXECUTE')$$);

-- ============================================================
-- 2. The 7-day rule — the site, the guest page, the emails
-- ============================================================
SELECT tests.check('rule: the site offers bank transfer only for an arrival at least 7 days away; 6 days or no date — not offered; a business without transfers — never',
  format($$SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(7)))
                = '{"methods": ["bank", "phone"], "bank_allowed": true, "bank_min_days": 7}'::jsonb
             AND pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(6)))
                = '{"methods": ["phone"], "bank_allowed": false, "bank_min_days": 7}'::jsonb
             AND pg_temp.call(%1$L, NULL, 'SELECT hospitality.public_payment_methods()') -> 'methods' = '["phone"]'::jsonb
             AND pg_temp.call(%2$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(30))) -> 'methods'
                = '["phone"]'::jsonb$$, :'sp', :'sx'));
SELECT tests.check('rule: booked today for 6 days ahead — the guest page has no bank option and no account details; nothing to upload',
  format($$SELECT (g ->> 'available')::boolean AND g -> 'methods' = '["phone"]'::jsonb AND g -> 'bank' = 'null'::jsonb
             AND NOT (g -> 'transfer' ->> 'allowed')::boolean AND NOT (g -> 'transfer' ->> 'can_upload')::boolean
             AND g::text NOT LIKE '%%123456%%'
            FROM pg_temp.guest(%L, %L) g$$, :'sp', :'t_near'));
SELECT tests.check('rule: booked today for exactly 7 days ahead — bank transfer with the details, and an upload is possible',
  format($$SELECT g -> 'methods' = '["bank", "phone"]'::jsonb AND g -> 'bank' ->> 'account' = '123456'
             AND (g -> 'transfer' ->> 'allowed')::boolean AND (g -> 'transfer' ->> 'can_upload')::boolean
             AND (g -> 'transfer' ->> 'min_days')::int = 7 AND NOT (g -> 'transfer' ->> 'chosen')::boolean
            FROM pg_temp.guest(%L, %L) g$$, :'sp', :'t_edge'));
SELECT tests.check('rule: counted from the day of booking, not from today — booked 10 days ago for 3 days from now is allowed',
  format($$SELECT (g -> 'transfer' ->> 'allowed')::boolean AND g -> 'methods' = '["bank", "phone"]'::jsonb
            FROM pg_temp.guest(%L, %L) g$$, :'sp', :'t_old'));
SELECT tests.check('rule: the guest emails mention bank transfer by the same rule (server only)',
  format($$SELECT hospitality.email_booking_payment_methods(%L) = ARRAY['phone']
             AND hospitality.email_booking_payment_methods(%L) = ARRAY['bank', 'phone']
             AND hospitality.email_booking_payment_methods(gen_random_uuid()) IS NULL$$, :'b_near', :'b_edge'));

-- ============================================================
-- 3. The guest's choice
-- ============================================================
SELECT tests.check('choice: bank transfer is refused for 6 days ahead, a method the business does not take is refused, an unknown one too',
  format($$SELECT pg_temp.choose_err(%1$L, %2$L, 'bank') LIKE '%%לפחות 7 ימים%%'
             AND pg_temp.choose_err(%1$L, %2$L, 'bit') LIKE '%%לא זמין%%'
             AND pg_temp.choose_err(%1$L, %2$L, 'cash') LIKE '%%לא תקין%%'
             AND (SELECT payment_method FROM hospitality.bookings WHERE id = %3$L) IS NULL$$, :'sp', :'t_near', :'b_near'));
SELECT pg_temp.choose(:'sp', :'t_near', 'phone') AS c_near \gset
SELECT pg_temp.choose(:'sp', :'t_edge', 'bank') AS c_edge \gset
SELECT tests.check('choice: phone payment for 6 days ahead; bank transfer for 7 — saved, returned, and in the booking history',
  format($$SELECT %1$L::jsonb ->> 'payment_method' = 'phone'
             AND (%2$L::jsonb -> 'transfer' ->> 'chosen')::boolean AND %2$L::jsonb ->> 'payment_method' = 'bank'
             AND (SELECT payment_method FROM hospitality.bookings WHERE id = %3$L) = 'bank'
             AND EXISTS (SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = %3$L
                           AND e.kind = 'payment_method_chosen' AND e.actor_kind = 'guest' AND e.changes ->> 'to' = 'bank')$$,
         :'c_near', :'c_edge', :'b_edge'));
SELECT tests.check('choice: a request not approved yet may choose bank transfer (shown as waiting for approval)',
  format($$SELECT g ->> 'reason' = 'not_confirmed' AND (g -> 'transfer' ->> 'chosen')::boolean
             AND NOT (g -> 'transfer' ->> 'can_upload')::boolean AND g::text NOT LIKE '%%123456%%'
            FROM pg_temp.choose(%L, %L, 'bank') g$$, :'sp', :'t_pend'));
SELECT tests.check('choice: this business''s link on another business''s address → not found',
  format($$SELECT pg_temp.choose_err(%L, %L, 'phone') LIKE '%%לא נמצאה%%'$$, :'sx', :'t_far'));

-- ============================================================
-- 4. Upload: slot → server upload → ready
-- ============================================================
SELECT tests.check('upload: refused for a request not approved yet and for a booking without bank transfer',
  format($$SELECT pg_temp.slot_err(%1$L, %2$L) LIKE '%%אי אפשר להעלות%%'
             AND pg_temp.slot_err(%1$L, %3$L) LIKE '%%אי אפשר להעלות%%'$$, :'sp', :'t_pend', :'t_near'));
SELECT pg_temp.slot(:'sp', :'t_far') AS s1 \gset
SELECT (:'s1'::jsonb) ->> 'id' AS p1, (:'s1'::jsonb) ->> 'path' AS p1_path \gset
SELECT tests.check('upload: the slot is under the business and the booking; unfinished — the guest and the staff see nothing yet',
  format($$SELECT %1$L = %2$L || '/' || %3$L || '/' || %4$L
             AND (SELECT status FROM hospitality.payment_proofs WHERE id = %4$L) = 'pending'
             AND pg_temp.guest(%2$L, %5$L) -> 'transfer' -> 'proofs' = '[]'::jsonb
             AND pg_temp.call(%2$L, %6$L, format('SELECT hospitality.booking_payment_proofs(%%L)', %3$L)) -> 'proofs' = '[]'::jsonb
             AND pg_temp.err_of(%2$L, %6$L, format('SELECT hospitality.payment_proof_file(%%L)', %4$L)) LIKE '%%לא נמצא%%'$$,
         :'p1_path', :'sp', :'b_far', :'p1', :'t_far', :OWNER_P));
SELECT tests.check('upload: only the server may mark a file received — a guest is refused, the server of another address gets "not found"',
  format($$SELECT pg_temp.err_of(%1$L, NULL, format('SELECT to_jsonb(hospitality.guest_proof_ready(%%L))', %3$L)) LIKE '%%permission denied%%'
             AND pg_temp.err_of(%1$L, %4$L, format('SELECT to_jsonb(hospitality.guest_proof_ready(%%L))', %3$L)) LIKE '%%permission denied%%'
             AND pg_temp.srv_err(%2$L, format('SELECT to_jsonb(hospitality.guest_proof_ready(%%L))', %3$L)) LIKE '%%לא נמצא%%'
             AND (SELECT status FROM hospitality.payment_proofs WHERE id = %3$L) = 'pending'$$,
         :'sp', :'sx', :'p1', :OWNER_P));
SELECT pg_temp.srv(:'sp', format('SELECT to_jsonb(hospitality.guest_proof_ready(%L))', :'p1')) IS NOT NULL AS ok \gset
SELECT tests.check('upload: received — waiting for the business, the booking is marked bank transfer, the history has it; once only',
  format($$SELECT (SELECT status = 'submitted' AND submitted_at IS NOT NULL FROM hospitality.payment_proofs WHERE id = %2$L)
             AND (SELECT payment_method FROM hospitality.bookings WHERE id = %3$L) = 'bank'
             AND EXISTS (SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = %3$L AND e.kind = 'payment_proof_submitted')
             AND pg_temp.srv_err(%1$L, format('SELECT to_jsonb(hospitality.guest_proof_ready(%%L))', %2$L)) LIKE '%%לא נמצא%%'$$,
         :'sp', :'p1', :'b_far'));
SELECT tests.check('upload: the guest sees "received, waiting for review" (after a refresh too — it is in the database), never the file path',
  format($$SELECT jsonb_array_length(g -> 'transfer' -> 'proofs') = 1
             AND g -> 'transfer' -> 'proofs' -> 0 ->> 'status' = 'submitted'
             AND g -> 'transfer' -> 'proofs' -> 0 ->> 'file_name' = 'אישור-העברה.png'
             AND (g -> 'transfer' ->> 'waiting_review')::boolean AND (g -> 'transfer' ->> 'chosen')::boolean
             AND g::text NOT LIKE '%%' || %3$L || '%%'
            FROM pg_temp.guest(%1$L, %2$L) g$$, :'sp', :'t_far', :'p1_path'));

-- ============================================================
-- 5. Staff: list, file, reject, approve
-- ============================================================
SELECT tests.check('staff: the owner sees the proof, the amount due and the file path; the dashboard counts it',
  format($$SELECT (s ->> 'bank_allowed')::boolean AND s ->> 'payment_method' = 'bank'
             AND (s ->> 'amount_due')::numeric = (SELECT total FROM hospitality.bookings WHERE id = %3$L)
             AND jsonb_array_length(s -> 'proofs') = 1
             AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.payment_proof_file(%%L)', %4$L)) ->> 'path' = %5$L
             AND w ->> 'count' = '1' AND w ->> 'booking_id' = %3$L
            FROM pg_temp.call(%1$L, %2$L, format('SELECT hospitality.booking_payment_proofs(%%L)', %3$L)) s,
                 pg_temp.call(%1$L, %2$L, 'SELECT hospitality.payment_proofs_waiting()') w$$,
         :'sp', :OWNER_P, :'b_far', :'p1', :'p1_path'));
SELECT tests.check('staff: another business''s owner gets nothing — not on its own address, not on this one; guests are refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.booking_payment_proofs(%%L)', %4$L)) LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.payment_proof_file(%%L)', %5$L)) LIKE '%%לא נמצא%%'
             AND pg_temp.err_of(%3$L, %2$L, format('SELECT hospitality.payment_proof_file(%%L)', %5$L)) LIKE '%%אין הרשאה%%'
             AND pg_temp.err_of(%3$L, NULL, format('SELECT hospitality.payment_proof_file(%%L)', %5$L)) LIKE '%%permission denied%%'
             AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.payment_proofs_waiting()') ->> 'count')::int = 0$$,
         :'sx', :OWNER_X, :'sp', :'b_far', :'p1'));
SELECT tests.check('staff: a rejection needs a reason for the guest',
  format($$SELECT pg_temp.review_err(%L, %L, %L, 'reject', NULL, ' ') LIKE '%%למה האישור נדחה%%'$$, :'sp', :OWNER_P, :'p1'));
SELECT pg_temp.review(:'sp', :OWNER_P, :'p1', 'reject', NULL, 'הסכום לא תואם') AS r1 \gset
SELECT tests.check('staff: rejected — the guest sees why and may upload another; history and action log; checked once only',
  format($$SELECT %1$L::jsonb -> 'proofs' -> 0 ->> 'status' = 'rejected'
             AND g -> 'transfer' -> 'proofs' -> 0 ->> 'review_note' = 'הסכום לא תואם'
             AND (g -> 'transfer' ->> 'can_upload')::boolean AND NOT (g -> 'transfer' ->> 'waiting_review')::boolean
             AND EXISTS (SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = %4$L AND e.kind = 'payment_proof_rejected')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'payments.proof_rejected')
             AND pg_temp.review_err(%2$L, %5$L, %6$L, 'approve', 100, NULL) LIKE '%%כבר נבדק%%'
             AND (SELECT amount_paid FROM hospitality.bookings WHERE id = %4$L) = 0
            FROM pg_temp.guest(%2$L, %3$L) g$$, :'r1', :'sp', :'t_far', :'b_far', :OWNER_P, :'p1'));
SELECT pg_temp.upload(:'sp', :'t_far') AS p2 \gset
SELECT tests.check('staff: approval needs the amount received',
  format($$SELECT pg_temp.review_err(%L, %L, %L, 'approve', NULL, NULL) LIKE '%%הסכום%%'$$, :'sp', :OWNER_P, :'p2'));
SELECT pg_temp.review(:'sp', :OWNER_P, :'p2', 'approve', 300, NULL) AS r2 \gset
SELECT tests.check('staff: approved 300 — a bank-transfer payment in the ledger, the payment status follows, the action log has it',
  format($$SELECT %1$L::jsonb -> 'proofs' -> 0 ->> 'status' = 'approved'
             AND EXISTS (SELECT 1 FROM hospitality.payments x JOIN hospitality.payment_proofs p ON p.payment_id = x.id
                          WHERE p.id = %3$L AND x.method = 'transfer' AND x.amount = 300 AND x.kind = 'deposit'
                            AND x.booking_id = %2$L)
             AND (SELECT amount_paid = 300 AND payment_status = 'deposit_paid' FROM hospitality.bookings WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.action = 'payments.proof_approved'
                           AND a.changes ->> 'proof' = %3$L)
             AND (%1$L::jsonb ->> 'amount_due')::numeric = (SELECT total - 300 FROM hospitality.bookings WHERE id = %2$L)$$,
         :'r2', :'b_far', :'p2'));
SELECT tests.check('staff: the guest sees approved and rejected, the remaining amount, and may still upload for the rest',
  format($$SELECT jsonb_array_length(g -> 'transfer' -> 'proofs') = 2
             AND g -> 'transfer' -> 'proofs' -> 0 ->> 'status' = 'approved'
             AND (g ->> 'amount_due')::numeric = (SELECT total - 300 FROM hospitality.bookings WHERE id = %3$L)
             AND (g -> 'transfer' ->> 'can_upload')::boolean
            FROM pg_temp.guest(%1$L, %2$L) g$$, :'sp', :'t_far', :'b_far'));
SELECT pg_temp.upload(:'sp', :'t_far') AS p3 \gset
SELECT pg_temp.review(:'sp', :OWNER_P, :'p3', 'approve', (SELECT total - 300 FROM hospitality.bookings WHERE id = :'b_far'),
                      'העברה 2 מתוך 2') IS NOT NULL AS ok \gset
SELECT tests.check('staff: the rest approved — paid in full ("balance"), nothing more to upload, nothing waiting on the dashboard',
  format($$SELECT (SELECT payment_status FROM hospitality.bookings WHERE id = %3$L) = 'paid'
             AND EXISTS (SELECT 1 FROM hospitality.payments x JOIN hospitality.payment_proofs p ON p.payment_id = x.id
                          WHERE p.id = %5$L AND x.kind = 'balance' AND x.note = 'העברה 2 מתוך 2')
             AND g ->> 'reason' = 'paid' AND NOT (g -> 'transfer' ->> 'can_upload')::boolean
             AND w ->> 'count' = '0' AND w -> 'booking_id' = 'null'::jsonb
            FROM pg_temp.guest(%1$L, %2$L) g, pg_temp.call(%1$L, %4$L, 'SELECT hospitality.payment_proofs_waiting()') w$$,
         :'sp', :'t_far', :'b_far', :OWNER_P, :'p3'));

-- ============================================================
-- 6. Limits
-- ============================================================
SELECT pg_temp.upload(:'sp', :'t_cap') IS NOT NULL AS ok \gset
SELECT pg_temp.upload(:'sp', :'t_cap') IS NOT NULL AS ok \gset
SELECT pg_temp.upload(:'sp', :'t_cap') IS NOT NULL AS ok \gset
SELECT pg_temp.upload(:'sp', :'t_cap') IS NOT NULL AS ok \gset
SELECT pg_temp.upload(:'sp', :'t_cap') IS NOT NULL AS ok \gset
SELECT tests.check('limits: up to 5 proofs a booking — then no more uploads',
  format($$SELECT NOT (pg_temp.guest(%1$L, %2$L) -> 'transfer' ->> 'can_upload')::boolean
             AND jsonb_array_length(pg_temp.guest(%1$L, %2$L) -> 'transfer' -> 'proofs') = 5
             AND pg_temp.slot_err(%1$L, %2$L) LIKE '%%אי אפשר להעלות%%'$$, :'sp', :'t_cap'));
SELECT pg_temp.slot(:'sp', :'t_flood') IS NOT NULL AS ok \gset
SELECT pg_temp.slot(:'sp', :'t_flood') IS NOT NULL AS ok \gset
SELECT pg_temp.slot(:'sp', :'t_flood') IS NOT NULL AS ok \gset
SELECT tests.check('limits: at most 3 unfinished uploads an hour for a booking',
  format($$SELECT pg_temp.slot_err(%L, %L) LIKE '%%יותר מדי ניסיונות%%'$$, :'sp', :'t_flood'));

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

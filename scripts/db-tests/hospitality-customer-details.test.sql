-- ============================================================
-- Hospitality — correcting the customer's details on an existing booking / event
-- (migration 65 — 20261111130000_hosp_customer_details.sql)
--   • structure: the staff functions for signed-in staff; the helpers for nobody;
--   • input: known fields only, a valid email / phone, something must change, the revision guard;
--   • "the customer card": the name / phone / email change on the card; a changed email revokes the personal
--     links that went to the old address, drops guest emails still queued to it, and unlinks the old account;
--   • "this booking only": the booking (and its room group) moves to an existing card by email, or a new one;
--     the other card is not changed; no new booking, nothing deleted;
--   • "send the details": one email with a fresh personal link to the corrected address (the old link dies);
--   • contracts: an open contract made from the card follows the new details and its link dies; a signed
--     contract never changes (returned so a corrected contract can be offered);
--   • history: who and when, which fields — the email and phone masked only; the action log;
--   • events: the same correction (no link, no email); another business sees nothing.
-- ============================================================
\set OWNER65 '''a0000000-0000-0000-0000-000000065a01'''
\set MGR65 '''a0000000-0000-0000-0000-000000065a02'''
\set OTHER65 '''a0000000-0000-0000-0000-000000065a03'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test')::text, true);
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
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test')::text, true);
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
CREATE OR REPLACE FUNCTION pg_temp.h(_s text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex') $$;
CREATE OR REPLACE FUNCTION pg_temp.rev(_id text) RETURNS integer LANGUAGE sql AS $$
  SELECT revision FROM hospitality.bookings WHERE id = _id::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.upd(_id text, _data jsonb, _scope text, _notify boolean) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT hospitality.booking_customer_update(%L, %s, %L, %L, %L)', _id, pg_temp.rev(_id), _data, _scope, _notify);
$$;
-- the server's send of a contract: a new link (only its hash), then the result of the email
CREATE OR REPLACE FUNCTION pg_temp.send(_site text, _id text, _token text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.contract_issue_link(%L, %L, %L, %L)', _site, _id, pg_temp.h(_token),
                                   'a0000000-0000-0000-0000-000000065a01'))
         || pg_temp.srv(_site, format('SELECT hospitality.contract_send_result(%L, %L, true, NULL, %L)', _site, _id,
                                      'a0000000-0000-0000-0000-000000065a01'));
$$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000065a01', 'm65.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000065a02', 'm65.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000065a03', 'm65.other@test.local', now()),
  ('a0000000-0000-0000-0000-000000065a09', 'old.address@example.com', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m65_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m65-details', 'נופי הפרטים', 'm65.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm65.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m65-other', 'אתר שכן לפרטים', 'm65.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm65.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR65, 'm65.manager@test.local', 'm65_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_contracts_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_contracts_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
UPDATE hospitality.settings SET business_name = 'נופי הפרטים', contact_phone = '0503822365', contact_email = 'nofi65@example.com',
       address = 'מושב ישעי 65', check_in_time = '14:00', check_out_time = '11:00'
 WHERE tenant_id = :'st';
SELECT pg_temp.call(:'st', :OWNER65,
  $q$SELECT hospitality.property_create('{"name": "מתחם הפרטים", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS p1 \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר אלון", "unit_type": "suite", "capacity": 4}')$q$, :'p1')) ->> 'id' AS u1 \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר ברוש", "unit_type": "suite", "capacity": 4}')$q$, :'p1')) ->> 'id' AS u2 \gset
UPDATE hospitality.units SET base_price = 600, is_active = true WHERE tenant_id = :'st';
-- booking A: the guest typed a wrong email; the first email (with the personal link) is still queued
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'מיכל טעות', _phone => '0546500001', _email => 'old.address@example.com',
   _terms_explained => true, _total_override => 1200, _send_guest_email => true)$q$, :'u1', pg_temp.d(20), pg_temp.d(22))) ->> 'booking_id' AS ba \gset
UPDATE hospitality.guests SET user_id = 'a0000000-0000-0000-0000-000000065a09'
 WHERE id = (SELECT guest_id FROM hospitality.bookings WHERE id = :'ba');
-- an existing card of another customer (for "this booking only")
INSERT INTO hospitality.guests (tenant_id, full_name, email, phone)
VALUES (:'st', 'יעל קיימת', 'yael@example.com', '0546500009') RETURNING id AS gy \gset
-- booking B (two rooms in one request) and an event of the same customer card as booking A
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'רון קבוצה', _phone => '0546500002', _email => 'ron@example.com',
   _terms_explained => true, _total_override => 1200)$q$, :'u1', pg_temp.d(40), pg_temp.d(42))) ->> 'booking_id' AS bb1 \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'רון קבוצה', _phone => '0546500002', _email => 'ron@example.com',
   _terms_explained => true, _total_override => 1200)$q$, :'u2', pg_temp.d(40), pg_temp.d(42))) ->> 'booking_id' AS bb2 \gset
UPDATE hospitality.bookings SET group_id = 'b0000000-0000-0000-0000-000000065b01' WHERE id IN (:'bb1', :'bb2');
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'birthday', 'event_date', pg_temp.d(50), 'start_time', '10:00', 'end_time', '15:00',
  'participants', 20, 'price', 1800, 'customer', jsonb_build_object('full_name', 'דנה אירוע', 'phone', '0546500003',
                                                                    'email', 'dana.event@example.com')))) AS ev \gset
-- the contracts: terms confirmed; booking A — an open contract (sent); booking B — a signed one
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.business_terms_save(%L, 0)$q$, jsonb_build_object(
  'representative_name', 'אמציה בשארי', 'business_tax_id', '58731621',
  'unit_lines', jsonb_build_array(jsonb_build_object('unit_id', :'u1', 'name', 'אלון', 'description', 'זוג + 2'),
                                  jsonb_build_object('unit_id', :'u2', 'name', 'ברוש', 'description', 'משפחה'))))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER65, 'SELECT hospitality.business_terms_confirm(1)') IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'ba')) AS ca \gset
SELECT pg_temp.send(:'st', (:'ca'::jsonb ->> 'id'), 'tok-65-a') IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'bb1')) AS cb \gset
SELECT pg_temp.send(:'st', (:'cb'::jsonb ->> 'id'), 'tok-65-b') IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_sign(%L, %L, %L, true, %L, %L)', pg_temp.h('tok-65-b'),
  '{"id_number": "123456782", "address": "רחוב הזית 9, ישעי", "deposit_method": "cash"}',
  '{"kind": "typed", "name": "רון קבוצה"}', '198.51.100.65', 'db-test')) IS NOT NULL AS ok \gset
SELECT signed_body_sha256 AS cb_hash FROM hospitality.client_contracts WHERE id = (:'cb'::jsonb ->> 'id')::uuid \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the correction / resend functions for signed-in staff only; the helpers for nobody',
  $$SELECT has_function_privilege('authenticated', 'hospitality.booking_customer_update(uuid,integer,jsonb,text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.booking_customer_update(uuid,integer,jsonb,text,boolean)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.booking_resend_details(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.booking_resend_details(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.event_customer_update(uuid,integer,jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.event_customer_update(uuid,integer,jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._customer_apply(uuid,hospitality.guests,jsonb,text,uuid[],uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._customer_patch(jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._send_booking_details(uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('service_role', 'hospitality._send_booking_details(uuid,uuid)', 'EXECUTE')$$);

-- ============================================================
-- 2. Input and guards
-- ============================================================
SELECT tests.check('input: unknown field, bad email, bad phone, nothing changed, a stale revision, another business, anon — all refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{"address": "x"}', 'guest', false)) LIKE 'שדה לא מוכר%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{"email": "not-an-email"}', 'guest', false)) = 'כתובת האימייל לא תקינה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{"phone": "12"}', 'guest', false)) = 'מספר הטלפון לא תקין'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{"full_name": "מיכל טעות"}', 'guest', false)) LIKE 'הפרטים זהים%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{}', 'guest', false)) = 'לא נשלח אף פרט לעדכון'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%3$L, '{"full_name": "מיכל"}', 'everything', false)) = 'היקף השינוי לא מוכר'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.booking_customer_update(%%L, 999, '{"full_name": "מיכל"}')$s$, %3$L))
                 LIKE 'ההזמנה עודכנה בינתיים%%'
             AND pg_temp.err_of(%4$L, %5$L, pg_temp.upd(%3$L, '{"full_name": "מיכל"}', 'guest', false)) = 'ההזמנה לא נמצאה'
             AND pg_temp.err_of(%1$L, NULL, pg_temp.upd(%3$L, '{"full_name": "מיכל"}', 'guest', false)) IS NOT NULL$$,
         :'st', :OWNER65, :'ba', :'so', :OTHER65));

-- ============================================================
-- 3. The customer card: the email was wrong (by the manager), without sending yet
-- ============================================================
SELECT (SELECT manage_token_hash IS NOT NULL FROM hospitality.bookings WHERE id = :'ba')
   AND (SELECT count(*) FROM hospitality.notifications WHERE booking_id = :'ba' AND recipient_kind = 'guest'
                                                         AND status = 'queued' AND payload ? 'manage_token') = 1 AS before_ok \gset
SELECT pg_temp.call(:'st', :MGR65, pg_temp.upd(:'ba', '{"full_name": "מיכל לוי", "email": "michal.levi@example.com", "phone": "050-6500001"}',
  'guest', false)) AS r1 \gset
SELECT tests.check('card: the name / phone / email corrected on the card; same booking (dates, price, status) — revision moved; no new booking, nothing deleted',
  format($$SELECT %1$L::boolean
             AND (SELECT full_name = 'מיכל לוי' AND email = 'michal.levi@example.com' AND phone_normalized = hospitality.normalize_phone('0506500001')
                    FROM hospitality.guests WHERE id = (SELECT guest_id FROM hospitality.bookings WHERE id = %2$L))
             AND (SELECT status = 'confirmed' AND total = 1200 AND check_in = pg_temp.d(20) FROM hospitality.bookings WHERE id = %2$L)
             AND (%3$L::jsonb ->> 'revision')::int = pg_temp.rev(%2$L)
             AND %3$L::jsonb -> 'fields' = '["full_name", "phone", "email"]'::jsonb
             AND (SELECT count(*) FROM hospitality.bookings WHERE tenant_id = %4$L) = 3$$,
         :'before_ok', :'ba', :'r1', :'st'));
SELECT tests.check('card: the email changed — the personal link that went to the old address is dead, the queued guest email to it will not go out (and holds no token), the old account is unlinked',
  format($$SELECT (SELECT manage_token_hash IS NULL AND manage_token2_hash IS NULL AND manage_token_expires_at IS NULL
                     FROM hospitality.bookings WHERE id = %1$L)
             AND (%2$L::jsonb ->> 'links_revoked')::int = 1 AND (%2$L::jsonb ->> 'emails_dropped')::int = 1
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE booking_id = %1$L AND recipient_kind = 'guest'
                               AND (status IN ('queued', 'failed') OR payload ? 'manage_token'))
             AND (SELECT user_id IS NULL FROM hospitality.guests WHERE id = (SELECT guest_id FROM hospitality.bookings WHERE id = %1$L))$$,
         :'ba', :'r1'));
SELECT tests.check('card: history — who (the manager), which fields, the emails masked only; the action log names the booking and the fields',
  format($$SELECT (SELECT actor_kind = 'staff' AND actor_id = %3$L AND changes -> 'fields' = '["full_name", "phone", "email"]'::jsonb
                          AND changes -> 'email' ->> 'from' = 'o•••@example.com' AND changes -> 'email' ->> 'to' = 'm•••@example.com'
                          AND changes::text NOT LIKE '%%michal.levi%%' AND changes::text NOT LIKE '%%old.address%%'
                     FROM hospitality.booking_events WHERE booking_id = %1$L AND kind = 'customer_updated')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'bookings.customer_updated'
                           AND a.target_label = 'הזמנה #' || (SELECT number FROM hospitality.bookings WHERE id = %1$L))$$,
         :'ba', :'st', :MGR65));
SELECT tests.check('contracts: the open contract made from the card follows the new details, its link is dead (send again), logged; nothing signed here',
  format($$SELECT (SELECT signer_name = 'מיכל לוי' AND signer_email = 'michal.levi@example.com' AND token_hash IS NULL
                          AND data ->> 'signer_email' = 'michal.levi@example.com' AND status = 'sent'
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND hospitality._contract_state((SELECT c FROM hospitality.client_contracts c WHERE c.id = %1$L)) = 'expired'
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = %1$L AND action = 'signer_updated')
             AND %2$L::jsonb -> 'open_contracts_updated' = to_jsonb(ARRAY[(%3$L::jsonb ->> 'number')::int])
             AND %2$L::jsonb -> 'signed_contracts' = '[]'::jsonb$$,
         (:'ca'::jsonb ->> 'id'), :'r1', :'ca'));

-- ============================================================
-- 4. Send the details to the corrected address (and again)
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER65, format('SELECT hospitality.booking_resend_details(%L)', :'ba')) AS s1 \gset
SELECT payload ->> 'manage_token' AS tok1 FROM hospitality.notifications
 WHERE booking_id = :'ba' AND event = 'booking_details' AND status = 'queued' ORDER BY created_at DESC LIMIT 1 \gset
SELECT tests.check('resend: one "booking details" email to the corrected address, with a fresh personal link (its hash on the booking); logged',
  format($$SELECT (%1$L::jsonb ->> 'queued')::boolean AND %1$L::jsonb ->> 'email_masked' = 'm•••@example.com'
             AND (SELECT recipient_email FROM hospitality.notifications WHERE booking_id = %2$L AND event = 'booking_details') = 'michal.levi@example.com'
             AND (SELECT manage_token_hash = pg_temp.h(%3$L) AND manage_token_expires_at > now() FROM hospitality.bookings WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.booking_events WHERE booking_id = %2$L AND kind = 'details_sent')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %4$L AND a.action = 'bookings.details_sent')$$,
         :'s1', :'ba', :'tok1', :'st'));
SELECT pg_temp.call(:'st', :OWNER65, format('SELECT hospitality.booking_resend_details(%L)', :'ba')) IS NOT NULL AS ok \gset
SELECT tests.check('resend again: a second email (not swallowed as a duplicate); the first link stops working',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications WHERE booking_id = %1$L AND event = 'booking_details') = 2
             AND (SELECT manage_token_hash <> pg_temp.h(%2$L) FROM hospitality.bookings WHERE id = %1$L)$$,
         :'ba', :'tok1'));

-- ============================================================
-- 5. "This booking only" — to an existing card by email; the room group moves together
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER65, pg_temp.upd(:'bb1', '{"full_name": "יעל קיימת", "email": "Yael@Example.com"}', 'booking', true)) AS r2 \gset
SELECT tests.check('this booking only: both rooms of the request move to the existing card found by the email; that card is not changed; the old card keeps its details',
  format($$SELECT (%1$L::jsonb ->> 'existing_guest')::boolean AND %1$L::jsonb ->> 'guest_id' = %2$L
             AND (SELECT count(*) FROM hospitality.bookings WHERE id IN (%3$L, %4$L) AND guest_id = %2$L::uuid) = 2
             AND (SELECT full_name = 'יעל קיימת' AND phone = '0546500009' FROM hospitality.guests WHERE id = %2$L)
             AND (SELECT full_name = 'רון קבוצה' AND email = 'ron@example.com' FROM hospitality.guests
                   WHERE tenant_id = %5$L AND email_normalized = 'ron@example.com')
             AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id IN (%3$L, %4$L) AND kind = 'customer_updated'
                     AND (changes ->> 'guest_changed')::boolean) = 2$$,
         :'r2', :'gy', :'bb1', :'bb2', :'st'));
SELECT tests.check('this booking only + send: ONE email to the corrected address with a personal link per room; the signed contract is untouched and offered for correction',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications WHERE booking_id IN (%1$L, %2$L) AND event = 'booking_details'
                     AND recipient_email = 'yael@example.com' AND jsonb_array_length(payload -> 'rooms') = 2
                     AND (SELECT bool_and(r ? 'manage_token') FROM jsonb_array_elements(payload -> 'rooms') r)) = 1
             AND (SELECT count(*) FROM hospitality.bookings WHERE id IN (%1$L, %2$L) AND manage_token_hash IS NOT NULL) = 2
             AND (SELECT status = 'signed' AND signer_name = 'רון קבוצה' AND signed_body_sha256 = %4$L
                    FROM hospitality.client_contracts WHERE id = %3$L)
             AND %5$L::jsonb -> 'signed_contracts' -> 0 ->> 'id' = %3$L$$,
         :'bb1', :'bb2', (:'cb'::jsonb ->> 'id'), :'cb_hash', :'r2'));
SELECT pg_temp.call(:'st', :OWNER65, pg_temp.upd(:'bb2', '{"full_name": "נועה חדשה", "email": "noa.new@example.com", "phone": "0546500010"}',
  'booking', false)) AS r3 \gset
SELECT tests.check('this booking only, a new email: a new card; the group moves to it (the request stays one customer)',
  format($$SELECT NOT (%1$L::jsonb ->> 'existing_guest')::boolean
             AND (SELECT full_name = 'נועה חדשה' AND email = 'noa.new@example.com' FROM hospitality.guests WHERE id = (%1$L::jsonb ->> 'guest_id')::uuid)
             AND (SELECT count(DISTINCT guest_id) FROM hospitality.bookings WHERE id IN (%2$L, %3$L)) = 1$$,
         :'r3', :'bb1', :'bb2'));
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER65, format($s$SELECT hospitality.cancel_booking(%L, 'בדיקה')$s$, :'bb2')), 'ok') AS cancel2 \gset
SELECT tests.check('send details: a cancelled booking — refused; a customer without an email — refused',
  format($$SELECT %5$L = 'ok'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.booking_resend_details(%%L)', %3$L)) = 'אפשר לשלוח פרטים רק להזמנה פעילה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.upd(%4$L, '{"email": null}', 'booking', true)) = 'לשליחת פרטי ההזמנה צריך אימייל של הלקוח'$$,
         :'st', :OWNER65, :'bb2', :'ba', :'cancel2'));

-- ============================================================
-- 6. Events — the same correction (no link, no email)
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.event_customer_update(%L, %s, '{"phone": "0546500033", "email": "dana.right@example.com"}', 'guest')$q$,
  :'ev'::jsonb ->> 'id', :'ev'::jsonb ->> 'revision')) AS r4 \gset
SELECT pg_temp.call(:'st', :OWNER65, format($q$SELECT hospitality.event_customer_update(%L, %s, '{"full_name": "דנה אחרת", "email": "dana.other@example.com"}', 'booking')$q$,
  :'ev'::jsonb ->> 'id', :'r4'::jsonb ->> 'revision')) AS r5 \gset
SELECT tests.check('event: the card corrected (history masked, action log); then "this event only" — the event moves to a new card, the revision moves; a stale revision refused',
  format($$SELECT (SELECT email = 'dana.right@example.com' FROM hospitality.guests WHERE tenant_id = %1$L AND full_name = 'דנה אירוע')
             AND (SELECT count(*) FROM hospitality.event_log WHERE event_id = %2$L AND kind = 'customer_updated'
                     AND changes::text NOT LIKE '%%dana.right%%') = 2
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'events.customer_updated')
             AND (SELECT g.full_name = 'דנה אחרת' FROM hospitality.events e JOIN hospitality.guests g ON g.id = e.guest_id WHERE e.id = %2$L)
             AND (%3$L::jsonb ->> 'revision')::int = (SELECT revision FROM hospitality.events WHERE id = %2$L)
             AND pg_temp.err_of(%1$L, %4$L, format($s$SELECT hospitality.event_customer_update(%%L, 1, '{"full_name": "x y"}')$s$, %2$L))
                 LIKE 'האירוע עודכן בינתיים%%'
             AND pg_temp.err_of(%5$L, %6$L, format($s$SELECT hospitality.event_customer_update(%%L, NULL, '{"full_name": "x y"}')$s$, %2$L))
                 = 'האירוע לא נמצא'$$,
         :'st', (:'ev'::jsonb ->> 'id'), :'r5', :OWNER65, :'so', :OTHER65));

-- ---------- cleanup: the platform flags as they were ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m65_flags m WHERE f.key = m.key;
DROP TABLE m65_flags;

-- ============================================================
-- Hospitality — a personal link in the "booking confirmed" email (20261105160000_hosp_confirm_link.sql, migration 39)
--   • approving a request issues a second token: only its hash is stored, the token itself goes only into the
--     guest's queued confirmation email and is removed from it once sent;
--   • both links open the booking (the first one is not revoked), same expiry, same business only;
--   • no second token without a first one, and none when the guest has no email;
--   • erasing the guest's details clears both;
--   • privileges unchanged.
-- ============================================================
\set OWNER_C '''a0000000-0000-0000-0000-000000039a01'''
\set OWNER_X '''a0000000-0000-0000-0000-000000039a03'''
\set CP '''73900000-0000-0000-0000-0000000000f1'''
\set C1 '''73900000-0000-0000-0000-0000000000a1'''
\set C2 '''73900000-0000-0000-0000-0000000000a2'''
\set XP '''73900000-0000-0000-0000-0000000000f2'''
\set X1 '''73900000-0000-0000-0000-0000000000b1'''

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
-- a pending request created by staff (returns the first token: no email is sent to the guest here).
-- each guest its own phone — the same phone is the same guest card
CREATE OR REPLACE FUNCTION pg_temp.pending(_site text, _uid uuid, _unit uuid, _in date, _out date, _email text,
                                           _phone text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _terms_explained => true, _email => %L, _status => %L, _send_guest_email => false)',
    _unit, _in, _out, 'אורחת בדיקה', _phone, _email, 'pending_approval'));
$f$;
-- the guest's page by token (as a site visitor of _site)
CREATE OR REPLACE FUNCTION pg_temp.page(_site text, _token text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.call(_site, NULL, format('SELECT hospitality.get_booking_by_token(%L)', _token)) ->> 'id';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN 'error: ' || SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.refused(_sql text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN check_violation THEN
  RETURN true;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.sha(_t text) RETURNS text LANGUAGE sql AS $$
  SELECT encode(sha256(convert_to(_t, 'UTF8')), 'hex') $$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000039a01', 'm39.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000039a03', 'm39.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m39-link', 'צימרי הקישור', 'm39.owner@test.local')$$) ->> 'id' AS sc \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m39-other', 'עסק אחר 39', 'm39.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sc', :OWNER_C, 'm39.owner@test.local', 'm39_owner', 'admin', true, 'מאיה'),
  (:'sx', :OWNER_X, 'm39.other@test.local', 'm39_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sc', :'sx')) IS NOT NULL AS ok \gset
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:CP, :'sc', 'מתחם הקישור', 'm39-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'm39-x', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:C1, :'sc', :CP, 'unit', 'בקתת האלון', 'm39-c1', 4, 2, 600),
  (:C2, :'sc', :CP, 'unit', 'בקתת השקד', 'm39-c2', 4, 2, 600),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'm39-x1', 4, 2, 500);

-- a request whose guest has an email, one without an email, and one in the other business
SELECT pg_temp.pending(:'sc', :OWNER_C, :C1, pg_temp.d(40), pg_temp.d(42), 'm39.guest@test.local', '0541239001')::text AS b1_json \gset
SELECT (:'b1_json'::jsonb) ->> 'booking_id' AS b1, (:'b1_json'::jsonb) ->> 'manage_token' AS t1 \gset
SELECT pg_temp.pending(:'sc', :OWNER_C, :C2, pg_temp.d(40), pg_temp.d(42), NULL, '0541239002')::text AS b2_json \gset
SELECT (:'b2_json'::jsonb) ->> 'booking_id' AS b2 \gset
SELECT pg_temp.pending(:'sx', :OWNER_X, :X1, pg_temp.d(40), pg_temp.d(42), 'm39.guest@test.local', '0541239001')::text AS bx_json \gset
SELECT (:'bx_json'::jsonb) ->> 'booking_id' AS bx \gset

-- ============================================================
-- 1. The column and its rules
-- ============================================================
SELECT tests.check('confirm link (39): the second token is stored as a hash only — 64 hex, unique, never without the first',
  format($$SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'hospitality' AND indexname = 'bookings_manage_token2'
                           AND indexdef LIKE 'CREATE UNIQUE INDEX%%')
             AND pg_temp.refused(format('UPDATE hospitality.bookings SET manage_token2_hash = %%L WHERE id = %%L', 'not-a-hash', %1$L))
             AND pg_temp.refused(format('UPDATE hospitality.bookings SET manage_token_hash = NULL, manage_token_expires_at = NULL,
                                           manage_token2_hash = %%L WHERE id = %%L', repeat('a', 64), %1$L))$$, :'b1'));

-- ============================================================
-- 2. Approving issues the second token and puts it in the confirmation email only
-- ============================================================
SELECT pg_temp.call(:'sc', :OWNER_C, format('SELECT hospitality.approve_booking(%L)', :'b1')) ->> 'status' AS approved \gset
SELECT n.payload ->> 'manage_token' AS t2, n.id AS n2
  FROM hospitality.notifications n
 WHERE n.booking_id = :'b1' AND n.event = 'booking_confirmed' AND n.recipient_kind = 'guest' \gset

SELECT tests.check('confirm link: approval confirms the booking and queues the confirmation with a new personal token',
  format($$SELECT %1$L = 'confirmed' AND %2$L ~ '^[0-9a-f]{64}$' AND %2$L <> %3$L$$, :'approved', :'t2', :'t1'));
SELECT tests.check('confirm link: only the hash of the new token is stored, next to the first one',
  format($$SELECT b.manage_token2_hash = pg_temp.sha(%2$L) AND b.manage_token_hash = pg_temp.sha(%3$L)
             FROM hospitality.bookings b WHERE b.id = %1$L$$, :'b1', :'t2', :'t1'));
SELECT tests.check('confirm link: no other email carries the new token (the owner''s, the first email to the guest)',
  format($$SELECT NOT EXISTS (SELECT 1 FROM hospitality.notifications n
                               WHERE n.booking_id = %1$L AND n.id <> %2$L AND n.payload::text LIKE '%%' || %3$L || '%%')$$,
         :'b1', :'n2', :'t2'));

-- ============================================================
-- 3. Both links open the booking — this business only, while valid
-- ============================================================
SELECT tests.check('confirm link: both links open the booking (the first one keeps working)',
  format($$SELECT pg_temp.page(%1$L, %2$L) = %4$L AND pg_temp.page(%1$L, %3$L) = %4$L$$, :'sc', :'t1', :'t2', :'b1'));
SELECT tests.check('confirm link: on another business''s site, or a made-up token — not found',
  format($$SELECT pg_temp.page(%1$L, %2$L) LIKE 'error: %%לא נמצאה%%'
             AND pg_temp.page(%3$L, repeat('0', 64)) LIKE 'error: %%לא נמצאה%%'$$, :'sx', :'t2', :'sc'));
UPDATE hospitality.bookings SET manage_token_expires_at = now() - interval '1 minute' WHERE id = :'b1';
SELECT tests.check('confirm link: after the link expires (30 days after check-out) neither link works',
  format($$SELECT pg_temp.page(%1$L, %2$L) LIKE 'error: %%' AND pg_temp.page(%1$L, %3$L) LIKE 'error: %%'$$,
         :'sc', :'t1', :'t2'));
UPDATE hospitality.bookings SET manage_token_expires_at = now() + interval '60 days' WHERE id = :'b1';

-- ============================================================
-- 4. No guest email → no second token; once sent → the token leaves the email
-- ============================================================
SELECT pg_temp.call(:'sc', :OWNER_C, format('SELECT hospitality.approve_booking(%L)', :'b2')) IS NOT NULL AS ok \gset
SELECT tests.check('confirm link: a guest without an email gets no second token (no secret nobody receives)',
  format($$SELECT b.status = 'confirmed' AND b.manage_token2_hash IS NULL
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.booking_id = %1$L AND n.payload ? 'manage_token')
             FROM hospitality.bookings b WHERE b.id = %1$L$$, :'b2'));
UPDATE hospitality.notifications SET status = 'sending', attempts = 1, locked_until = now() + interval '5 minutes'
 WHERE id = :'n2';
SELECT hospitality.mark_notification(:'n2', true) AS sent \gset
SELECT tests.check('confirm link: once the email is sent the token is removed from it — and the link still works',
  format($$SELECT %1$L = 'sent' AND NOT (n.payload ? 'manage_token') AND pg_temp.page(%3$L, %4$L) = %5$L
             FROM hospitality.notifications n WHERE n.id = %2$L$$, :'sent', :'n2', :'sc', :'t2', :'b1'));

-- ============================================================
-- 5. Erasing the guest's details clears both links
-- ============================================================
SELECT pg_temp.call(:'sc', :OWNER_C, format($$SELECT to_jsonb(hospitality.cancel_booking(%L, 'בדיקה'))$$, :'b1')) IS NOT NULL AS ok \gset
SELECT b.guest_id AS g1 FROM hospitality.bookings b WHERE b.id = :'b1' \gset
SELECT pg_temp.call(:'sc', :OWNER_C, format('SELECT to_jsonb(hospitality.anonymize_guest(%L))', :'g1')) AS anon \gset
SELECT tests.check('confirm link: erasing the guest''s details clears both tokens — neither link opens anything',
  format($$SELECT b.manage_token_hash IS NULL AND b.manage_token2_hash IS NULL AND b.manage_token_expires_at IS NULL
             AND pg_temp.page(%2$L, %3$L) LIKE 'error: %%' AND pg_temp.page(%2$L, %4$L) LIKE 'error: %%'
             FROM hospitality.bookings b WHERE b.id = %1$L$$, :'b1', :'sc', :'t1', :'t2'));

-- ============================================================
-- 6. Nothing else changed: the other business, privileges
-- ============================================================
SELECT tests.check('confirm link: the other business''s pending request is untouched (no second token)',
  format($$SELECT b.status = 'pending_approval' AND b.manage_token2_hash IS NULL FROM hospitality.bookings b WHERE b.id = %L$$, :'bx'));
SELECT tests.check('confirm link: privileges unchanged — guests open their page, only staff approve',
  $$SELECT has_function_privilege('anon', 'hospitality.get_booking_by_token(text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.approve_booking(uuid,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality._guest_booking(uuid,text,uuid,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._guest_booking(uuid,text,uuid,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._anonymize_guest(uuid,uuid)', 'EXECUTE')$$);

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

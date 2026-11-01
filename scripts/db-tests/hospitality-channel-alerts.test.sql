-- ============================================================
-- Hospitality D3 (migration 27): channel conflicts and the occupancy source on the board
--   • a NEW conflict (an external event over dates we already hold) → one email to the owner
--     (outbox, 'channel_conflict') + the activity log; the same conflict on the next sync → nothing;
--   • a conflict never changes or cancels a booking;
--   • the board's blocks carry their source: synced (and the channel) or manual.
-- ============================================================
\set OWNER_C '''a0000000-0000-0000-0000-000000000ca1'''
\set UC '''7d310000-0000-0000-0000-0000000000c1'''

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
-- the sync worker (service role): apply the events of one calendar
CREATE OR REPLACE FUNCTION pg_temp.sync(_calendar uuid, _events jsonb) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  r := hospitality.channel_sync_service(_calendar, _events, NULL);
  RESET ROLE;
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
CREATE OR REPLACE FUNCTION pg_temp.ev(_uid text, _from integer, _to integer) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('uid', _uid, 'from', current_date + _from, 'to', current_date + _to);
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000000ca1', 'd3.owner@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('d3-channels', 'עסק עם ערוצים', 'd3.owner@test.local')$$) ->> 'id' AS sc \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'sc', :OWNER_C, 'd3.owner@test.local', 'd3_owner', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true)
   AND public.platform_set_flag('hospitality_booking_enabled', true, %L))$$, :'sc')) IS NOT NULL AS ok \gset
UPDATE hospitality.settings SET notification_emails = ARRAY['d3.owner@test.local', 'd3.desk@test.local'] WHERE tenant_id = :'sc';
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
VALUES ('7d300000-0000-0000-0000-0000000000c1', :'sc', 'מתחם ערוצים', 'd3-p', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
VALUES (:UC, :'sc', '7d300000-0000-0000-0000-0000000000c1', 'unit', 'צימר הערוצים', 'd3-u', 4, 2, 600);

-- a confirmed booking (phone) on nights 10–11, and a manual block on 40–41
SELECT pg_temp.call(:'sc', :OWNER_C, format(
  $$SELECT to_jsonb(hospitality.create_manual_booking(%L, %L, %L, 'דנה כהן', '0521234567', true, 'dana.d3@example.com'))$$,
  :UC, pg_temp.d(10), pg_temp.d(12))) ->> 'booking_id' AS bk \gset
SELECT pg_temp.call(:'sc', :OWNER_C, format($$SELECT to_jsonb(hospitality.block_create(%L, %L, %L, 'שיפוץ'))$$,
  :UC, pg_temp.d(40), pg_temp.d(42))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'sc', :OWNER_C, format(
  $$SELECT to_jsonb(hospitality.channel_calendar_add(%L, 'airbnb', 'https://www.airbnb.com/calendar/ical/d3.ics?s=1'))$$,
  :UC)) IS NOT NULL AS ok \gset
SELECT id AS cal FROM hospitality.channel_calendars WHERE tenant_id = :'sc' \gset
CREATE TEMP TABLE d3_booking_before AS SELECT * FROM hospitality.bookings WHERE id = :'bk';

-- ---------- 1. a new conflict → one email per owner address + the activity log ----------
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('e-over', 10, 12), pg_temp.ev('e-free', 20, 22))) AS r1 \gset
SELECT tests.check('conflicts: the overlapping event is reported, the free one becomes a block',
  format($$SELECT jsonb_array_length(%L::jsonb -> 'conflicts') = 1 AND (%L::jsonb ->> 'events')::integer = 1$$, :'r1', :'r1'));
SELECT tests.check('conflicts: a new conflict queues one email to each owner address',
  format($$SELECT count(*) = 2 AND bool_and(recipient_kind = 'owner' AND booking_id IS NULL AND status = 'queued')
             AND array_agg(recipient_email ORDER BY recipient_email) = ARRAY['d3.desk@test.local', 'd3.owner@test.local']
            FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, :'sc'));
SELECT tests.check('conflicts: exactly the dates of our own booking — flagged as a possible echo of our export',
  format($$SELECT bool_and((payload ->> 'echo_like')::boolean)
            FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, :'sc'));
SELECT tests.check('conflicts: the email carries the unit, the channel and the dates only (no guest details)',
  format($$SELECT bool_and(payload ->> 'unit_name' = 'צימר הערוצים' AND payload ->> 'channel_label' = 'Airbnb'
                            AND (payload ->> 'conflict_count')::integer = 1
                            AND payload -> 'conflicts' -> 0 ->> 'from' = %L
                            AND payload::text !~ '(דנה|dana|0521234567|e-over)')
            FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, pg_temp.d(10), :'sc'));
SELECT tests.check('conflicts: written to the activity log (system actor)',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.audit_log WHERE tenant_id = %L AND action = 'channels.conflict'
                            AND actor_role = 'system' AND (changes ->> 'count')::integer = 1)$$, :'sc'));
SELECT tests.check('conflicts: the booking is not changed or cancelled',
  format($$SELECT to_jsonb(b) = to_jsonb(x) FROM hospitality.bookings b, d3_booking_before x WHERE b.id = %L$$, :'bk'));

-- ---------- 2. the same conflict on the next sync → no new email ----------
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('e-over', 10, 12), pg_temp.ev('e-free', 20, 22))) IS NOT NULL AS ok \gset
SELECT tests.check('conflicts: the same conflict again — no repeated email',
  format($$SELECT count(*) = 2 FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, :'sc'));

-- ---------- 3. another conflict → a new email ----------
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('e-over', 10, 12), pg_temp.ev('e-over2', 11, 13),
                                              pg_temp.ev('e-free', 20, 22))) IS NOT NULL AS ok \gset
SELECT tests.check('conflicts: a further conflict — one more email per address, about the new one only (not an echo: other dates)',
  format($$SELECT count(*) = 4 AND count(*) FILTER (WHERE (payload ->> 'conflict_count')::integer = 1) = 4
             AND count(*) FILTER (WHERE NOT (payload ->> 'echo_like')::boolean) = 2
            FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, :'sc'));

-- ---------- 4. resolved, then back → an email again ----------
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('e-free', 20, 22))) IS NOT NULL AS ok \gset
SELECT tests.check('conflicts: resolved in the channel — no email',
  format($$SELECT count(*) = 4 FROM hospitality.notifications WHERE tenant_id = %L AND event = 'channel_conflict'$$, :'sc'));
SELECT pg_temp.sync(:'cal', jsonb_build_array(pg_temp.ev('e-over', 10, 12), pg_temp.ev('e-free', 20, 22))) IS NOT NULL AS ok \gset
SELECT tests.check('conflicts: back on the same day after being resolved — logged, but no second email that day (a flapping feed does not flood)',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications WHERE tenant_id = %1$L AND event = 'channel_conflict') = 4
             AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = %1$L AND action = 'channels.conflict') = 3$$, :'sc'));
SELECT tests.check('conflicts: after all syncs the booking is still exactly as it was',
  format($$SELECT to_jsonb(b) = to_jsonb(x) FROM hospitality.bookings b, d3_booking_before x WHERE b.id = %L$$, :'bk'));

-- ---------- 5. the board shows where each occupancy comes from ----------
SELECT pg_temp.call(:'sc', :OWNER_C, format('SELECT hospitality.calendar(%L, %L)', pg_temp.d(0), pg_temp.d(60))) AS cv \gset
SELECT tests.check('board: the synced block says synced, from Airbnb',
  format($$SELECT bool_and((k ->> 'synced')::boolean AND k ->> 'channel' = 'airbnb')
             FROM jsonb_array_elements(%L::jsonb -> 'blocks') k WHERE k ->> 'start_date' = %L$$, :'cv', pg_temp.d(20)));
SELECT tests.check('board: the manual block says manual, no channel',
  format($$SELECT bool_and(NOT (k ->> 'synced')::boolean AND k -> 'channel' = 'null'::jsonb AND k ->> 'reason' = 'שיפוץ')
             FROM jsonb_array_elements(%L::jsonb -> 'blocks') k WHERE k ->> 'start_date' = %L$$, :'cv', pg_temp.d(40)));
SELECT tests.check('board: the booking says where it came from (phone)',
  format($$SELECT bool_and(b ->> 'source' = 'phone') FROM jsonb_array_elements(%L::jsonb -> 'bookings') b
           WHERE b ->> 'id' = %L$$, :'cv', :'bk'));

-- ---------- 6. structure ----------
SELECT tests.check('structure: the conflict trigger function is not callable through the API and has a fixed search_path',
  $$SELECT NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
           AND 'search_path=""' = ANY (p.proconfig)
      FROM pg_proc p WHERE p.oid = 'hospitality.channel_conflicts_notify()'::regprocedure$$);

-- ============================================================
-- Hospitality E4 (20261105100000_hosp_support.sql): the support system
--   • a business opens tickets, replies, closes / reopens, attaches files (type + size checked);
--   • each business sees only its own tickets — function calls, direct table access and files;
--   • the platform admin sees all tickets, filters them, replies, writes internal notes;
--   • internal notes (and their files) never reach the business; platform staff names / emails
--     are not shown to businesses; platform admin emails are server-only;
--   • statuses: new → in_progress → waiting_customer → resolved → closed, reopen;
--   • an email to the business (outbox) when the platform replies — without the message body;
--   • limits: 10 tickets a day per business, 5 files per message.
-- ============================================================
\set OWNER_A '''a0000000-0000-0000-0000-0000000e4a01'''
\set MGR_A '''a0000000-0000-0000-0000-0000000e4a02'''
\set OWNER_B '''a0000000-0000-0000-0000-0000000e4a03'''
\set ADMIN '''a0000000-0000-0000-0000-0000000000f0'''

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
-- the platform admin, as an authenticated user without a site
CREATE OR REPLACE FUNCTION pg_temp.admin(_sql text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call('', 'a0000000-0000-0000-0000-0000000000f0', _sql);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.admin_err(_sql text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.err_of('', 'a0000000-0000-0000-0000-0000000000f0', _sql);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.as_platform(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true);
  EXECUTE _sql INTO r;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.files(_n integer, _mime text DEFAULT 'image/png', _size integer DEFAULT 2048)
RETURNS text LANGUAGE sql AS $f$
  SELECT (SELECT jsonb_agg(jsonb_build_object('name', 'צילום ' || g || '.png', 'mime', _mime, 'size', _size))
            FROM generate_series(1, _n) g)::text;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-0000000e4a01', 'e4.owner@test.local', now()),
  ('a0000000-0000-0000-0000-0000000e4a02', 'e4.manager@test.local', now()),
  ('a0000000-0000-0000-0000-0000000e4a03', 'e4.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('e4-sup-a', 'צימרי התמיכה', 'e4.owner@test.local')$$) ->> 'id' AS sa \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('e4-sup-b', 'עסק שכן', 'e4.other@test.local')$$) ->> 'id' AS sb \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sa', :OWNER_A, 'e4.owner@test.local', 'e4_owner', 'admin', true, 'דנה'),
  (:'sa', :MGR_A, 'e4.manager@test.local', 'e4_manager', 'admin', true, 'יוסי'),
  (:'sb', :OWNER_B, 'e4.other@test.local', 'e4_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(public.platform_set_flag('hospitality_backend_enabled', true)
   AND public.platform_set_flag('hospitality_management_enabled', true)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %1$L)
   AND public.platform_set_flag('hospitality_backend_enabled', true, %2$L)
   AND public.platform_set_flag('hospitality_management_enabled', true, %2$L))$$, :'sa', :'sb')) IS NOT NULL AS ok \gset
UPDATE hospitality.subscriptions SET plan_code = 'premium' WHERE tenant_id = :'sa';
UPDATE hospitality.subscriptions SET plan_code = 'basic' WHERE tenant_id = :'sb';

-- ---------- opening a ticket ----------
SELECT pg_temp.call(:'sa', :OWNER_A, format($$SELECT hospitality.support_open('הזמנה לא מופיעה ביומן', 'calendar', 'high',
  'הזמנה של משפחת לוי לא מופיעה ביומן של בקתת האלון.', %L::jsonb)$$,
  '[{"name": "../../etc/passwd<script>.png", "mime": "image/png", "size": 1200},
    {"name": "חשבונית.pdf", "mime": "application/pdf", "size": 90000}]')) AS opened \gset
SELECT (:'opened'::jsonb #>> '{ticket,id}') AS t1 \gset
-- the ticket id as a literal inside a quoted SQL string ('...(''<id>'')...')
SELECT '''''' || :'t1' || '''''' AS q1 \gset
SELECT tests.check('support: a business opens a ticket — number from 1001, status new, waiting for the platform',
  format($$SELECT (%1$L::jsonb #>> '{ticket,number}')::bigint >= 1001
             AND %1$L::jsonb #>> '{ticket,status}' = 'new'
             AND (%1$L::jsonb #>> '{ticket,needs_reply}')::boolean
             AND %1$L::jsonb #>> '{business,name}' = 'צימרי התמיכה'$$, :'opened'));
SELECT tests.check('support: the attachments are registered as pending, under <site>/<ticket>/, with a safe file name',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'uploads') = 2
             AND (SELECT bool_and(u ->> 'path' LIKE %2$L || '/' || %3$L || '/%%') FROM jsonb_array_elements(%1$L::jsonb -> 'uploads') u)
             AND (SELECT count(*) FROM hospitality.support_attachments WHERE ticket_id = %3$L AND status = 'pending') = 2
             AND NOT EXISTS (SELECT 1 FROM hospitality.support_attachments
                              WHERE ticket_id = %3$L AND (file_name ~ '[/\\<>]'))$$, :'opened', :'sa', :'t1'));
SELECT tests.check('support: pending files are not shown until the server marks them ready',
  format($$SELECT jsonb_array_length(pg_temp.call(%L, %L, 'SELECT hospitality.support_ticket(%s)') #> '{messages,0,files}') = 0$$,
         :'sa', :OWNER_A, :'q1'));
-- another staff member cannot mark someone else's uploads; the uploader can (one step at a time —
-- the order of calls inside one boolean expression is not guaranteed)
SELECT array_agg(id)::text AS t1_files FROM hospitality.support_attachments WHERE ticket_id = :'t1' \gset
SELECT pg_temp.call(:'sa', :MGR_A, format('SELECT to_jsonb(hospitality.support_files_ready(%L::uuid[]))', :'t1_files')) AS ready_by_other \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT to_jsonb(hospitality.support_files_ready(%L::uuid[]))', :'t1_files')) AS ready_by_owner \gset
SELECT tests.check('support: only the uploader marks the files ready (a manager of the same site: 0)',
  format($$SELECT %1$L::int = 0 AND %2$L::int = 2
             AND jsonb_array_length(pg_temp.call(%3$L, %4$L, 'SELECT hospitality.support_ticket(%5$s)') #> '{messages,0,files}') = 2$$,
         :'ready_by_other', :'ready_by_owner', :'sa', :OWNER_A, :'q1'));

-- validation
SELECT tests.check('support: validation — subject, topic, priority, body',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_open(''אב'', ''other'', ''normal'', ''x'')') LIKE '%%נושא הפנייה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_open(''נושא תקין'', ''billing'', ''normal'', ''x'')') LIKE '%%תחום%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_open(''נושא תקין'', ''other'', ''asap'', ''x'')') LIKE '%%דחיפות%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_open(''נושא תקין'', ''other'', ''normal'', ''   '')') LIKE '%%כתבו הודעה%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.support_open(''נושא תקין'', ''other'', ''normal'', %%L)', repeat('א', 5001))) LIKE '%%ארוכה מדי%%'$$,
         :'sa', :OWNER_A));
SELECT tests.check('support: files — at most 5 per message, only JPG / PNG / WebP / PDF, up to 5MB',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.support_reply(%%L, ''שש תמונות'', %%L::jsonb)', %3$L, pg_temp.files(6))) LIKE '%%עד 5 קבצים%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.support_reply(%%L, ''svg'', %%L::jsonb)', %3$L, pg_temp.files(1, 'image/svg+xml'))) LIKE '%%סוג הקובץ%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.support_reply(%%L, ''html'', %%L::jsonb)', %3$L, pg_temp.files(1, 'text/html'))) LIKE '%%סוג הקובץ%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.support_reply(%%L, ''גדול'', %%L::jsonb)', %3$L, pg_temp.files(1, 'image/png', 5242881))) LIKE '%%גדול מדי%%'
             AND (SELECT count(*) FROM hospitality.support_messages WHERE ticket_id = %3$L) = 1$$,
         :'sa', :OWNER_A, :'t1'));

-- ---------- isolation ----------
SELECT pg_temp.call(:'sb', :OWNER_B, $$SELECT hospitality.support_open('שאלה על החשבון', 'account', 'low', 'איך משנים את החבילה?')$$) #>> '{ticket,id}' AS t2 \gset
SELECT id AS f1 FROM hospitality.support_attachments WHERE ticket_id = :'t1' AND mime = 'application/pdf' \gset
SELECT '''''' || :'f1' || '''''' AS qf1 \gset
SELECT tests.check('isolation: another business does not see the ticket (list / view / reply / close / file)',
  format($$SELECT NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_list()') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %3$L))
             AND jsonb_array_length(pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_list()') -> 'items') = 1
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_ticket(%4$s)') LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_reply(%4$s, ''היי'')') LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_set_open(%4$s, false)') LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_file(%5$s)') LIKE '%%לא נמצא%%'
             AND (pg_temp.call(%1$L, %2$L, format('SELECT to_jsonb(hospitality.support_files_ready(%%L::uuid[]))', ARRAY[%6$L::uuid])))::int = 0$$,
         :'sb', :OWNER_B, :'t1', :'q1', :'qf1', :'f1'));
SELECT tests.check('isolation: a user of one business cannot act on another by switching the site header',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_list()') IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_ticket(%3$s)') IS NOT NULL$$,
         :'sa', :OWNER_B, :'q1'));
SELECT tests.run('isolation: no direct table access for staff (tickets)', 'SELECT * FROM hospitality.support_tickets', :OWNER_A, 'permission denied');
SELECT tests.run('isolation: no direct table access for staff (messages)', 'SELECT * FROM hospitality.support_messages', :OWNER_A, 'permission denied');
SELECT tests.run('isolation: no direct table access for staff (attachments)', 'SELECT * FROM hospitality.support_attachments', :OWNER_A, 'permission denied');
SELECT tests.run('isolation: no direct table access for staff (settings)', 'SELECT * FROM hospitality.support_settings', :OWNER_A, 'permission denied');
SELECT tests.run('isolation: no direct table access for the platform admin either', 'SELECT * FROM hospitality.support_tickets', :ADMIN, 'permission denied');
SELECT tests.run('isolation: guests (anon) cannot call the support functions', 'SELECT hospitality.support_list()', NULL, 'permission denied');
SELECT tests.check('isolation: businesses cannot call the platform functions',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_tickets()') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_ticket(%3$s)') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_reply(%3$s, ''x'', true)') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_set_status(%3$s, ''closed'')') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_file(%4$s)') LIKE '%%מנהל הפלטפורמה%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.admin_support_settings(''+972501234567'', true)') LIKE '%%מנהל הפלטפורמה%%'$$,
         :'sa', :OWNER_A, :'q1', :'qf1'));
SELECT tests.run('isolation: the platform admins'' emails are for the server only', 'SELECT hospitality.support_platform_recipients()', :OWNER_A, 'permission denied');
SELECT tests.check('support: the server (service role) gets the platform admins'' emails',
  $$SELECT 'platform@test.local' = ANY (hospitality.support_platform_recipients())$$);
DO $$
BEGIN
  INSERT INTO hospitality.support_messages (tenant_id, ticket_id, sender_type, body, internal)
  SELECT tenant_id, id, 'business', 'פנימי?', true FROM hospitality.support_tickets LIMIT 1;
  INSERT INTO tests.results (name, ok, detail) VALUES ('isolation: internal = platform only (CHECK)', false, 'inserted');
EXCEPTION WHEN check_violation THEN
  INSERT INTO tests.results (name, ok, detail) VALUES ('isolation: internal = platform only (CHECK)', true, SQLERRM);
END $$;

-- ---------- the platform side ----------
SELECT tests.check('platform: sees every business''s tickets, with the business name and plan',
  format($$SELECT (pg_temp.admin('SELECT hospitality.admin_support_tickets()') -> 'items') @> jsonb_build_array(
                     jsonb_build_object('id', %1$L, 'business', jsonb_build_object('name', 'צימרי התמיכה', 'plan', 'premium')),
                     jsonb_build_object('id', %2$L, 'business', jsonb_build_object('name', 'עסק שכן', 'plan', 'basic')))$$,
         :'t1', :'t2'));
SELECT tests.check('platform: filters — status, priority, dates, search (number / subject / business / email), waiting for reply',
  format($$SELECT (pg_temp.admin('SELECT hospitality.admin_support_tickets(_priority => ''high'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L))
             AND NOT (pg_temp.admin('SELECT hospitality.admin_support_tickets(_priority => ''high'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %2$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_status => ''new'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L), jsonb_build_object('id', %2$L))
             AND jsonb_array_length(pg_temp.admin('SELECT hospitality.admin_support_tickets(_status => ''closed'', _q => ''צימרי'')') -> 'items') = 0
             AND (pg_temp.admin(format('SELECT hospitality.admin_support_tickets(_q => %%L)', '#' || (SELECT number FROM hospitality.support_tickets WHERE id = %1$L))) -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_q => ''לא מופיעה'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_q => ''עסק שכן'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %2$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_q => ''E4.OTHER@'')') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %2$L))
             AND jsonb_array_length(pg_temp.admin(format('SELECT hospitality.admin_support_tickets(_from => %%L, _q => ''צימרי התמיכה'')', current_date + 2)) -> 'items') = 0
             AND (pg_temp.admin(format('SELECT hospitality.admin_support_tickets(_from => %%L, _to => %%L)', current_date - 1, current_date + 1)) -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_needs_reply => true)') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L))
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets()') #>> '{counts,needs_reply}')::int >= 2
             AND pg_temp.admin_err('SELECT hospitality.admin_support_tickets(_status => ''lost'')') LIKE '%%סטטוס%%'
             AND pg_temp.admin_err(format('SELECT hospitality.admin_support_tickets(_from => %%L, _to => %%L)', current_date, current_date - 3)) LIKE '%%טווח%%'$$,
         :'t1', :'t2'));
SELECT tests.check('platform: the ticket view shows business details, the opener''s email, internal notes',
  format($$SELECT pg_temp.admin('SELECT hospitality.admin_support_ticket(%1$s)') #>> '{business,slug}' = 'e4-sup-a'
             AND pg_temp.admin('SELECT hospitality.admin_support_ticket(%1$s)') ->> 'opened_by_email' = 'e4.owner@test.local'
             AND (pg_temp.admin('SELECT hospitality.admin_support_ticket(%1$s)') #>> '{business,units}') IS NOT NULL$$,
         :'q1'));

-- an internal note: never shown to the business (also its file), the ticket moves to "in progress"
SELECT pg_temp.admin(format($$SELECT hospitality.admin_support_reply(%L, 'פנימי: לבדוק את הסנכרון של Airbnb', true, NULL, %L::jsonb)$$,
  :'t1', '[{"name": "log.png", "mime": "image/png", "size": 500}]')) AS note \gset
SELECT pg_temp.admin(format($$SELECT to_jsonb(hospitality.admin_support_files_ready(ARRAY[%L]::uuid[]))$$,
  :'note'::jsonb #>> '{uploads,0,id}')) IS NOT NULL AS ok \gset
SELECT '''''' || (:'note'::jsonb #>> '{uploads,0,id}') || '''''' AS qn \gset
SELECT tests.check('internal note: the ticket moves to in progress; the platform sees the note',
  format($$SELECT status = 'in_progress' FROM hospitality.support_tickets WHERE id = %1$L$$, :'t1'));
SELECT tests.check('internal note: the business never sees it — not in the thread, the preview, the unread count, the emails',
  format($$SELECT NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_ticket(%3$s)')::text LIKE '%%פנימי%%')
             AND NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_ticket(%3$s)') -> 'messages') @> '[{"internal": true}]'
             AND NOT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_list()')::text LIKE '%%פנימי%%')
             AND (pg_temp.call(%1$L, %2$L, 'SELECT to_jsonb(hospitality.support_unread())'))::int = 0
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE event = 'support_reply' AND tenant_id = %1$L)
             AND (pg_temp.admin('SELECT hospitality.admin_support_ticket(%3$s)') -> 'messages') @> '[{"internal": true}]'$$,
         :'sa', :OWNER_A, :'q1'));
SELECT tests.check('internal note: its file cannot be downloaded by the business',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_file(%3$s)') LIKE '%%לא נמצא%%'
             AND pg_temp.admin('SELECT hospitality.admin_support_file(%3$s)') ->> 'path' LIKE %4$L || '/%%'$$,
         :'sa', :OWNER_A, :'qn', :'sa'));

-- a public reply: waiting for the customer, first response time, unread for the business, an email
SELECT pg_temp.admin(format($$SELECT hospitality.admin_support_reply(%L, 'בדקנו — ההזמנה מופיעה עכשיו. תוכלו לאשר?')$$, :'t1')) AS reply \gset
SELECT tests.check('reply: waiting for the customer; first response recorded; not waiting for the platform any more',
  format($$SELECT status = 'waiting_customer' AND first_response_at IS NOT NULL AND last_public_sender = 'platform'
             FROM hospitality.support_tickets WHERE id = %1$L$$, :'t1'));
SELECT pg_temp.call(:'sa', :OWNER_A, 'SELECT to_jsonb(hospitality.support_unread())') AS unread_before \gset
SELECT pg_temp.call(:'sa', :OWNER_A, 'SELECT hospitality.support_list()') AS list_before \gset
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.support_ticket(%L)', :'t1')) AS seen \gset
SELECT pg_temp.call(:'sa', :OWNER_A, 'SELECT to_jsonb(hospitality.support_unread())') AS unread_after \gset
SELECT tests.check('reply: the business sees "support team" (not the platform staff email) and an unread answer; viewing marks it read',
  format($$SELECT %1$L::int = 1
             AND (%2$L::jsonb -> 'items') @> jsonb_build_array(jsonb_build_object('id', %3$L, 'unread', 1))
             AND (%4$L::jsonb -> 'messages') @> '[{"sender_type": "platform", "sender_name": "צוות התמיכה"}]'
             AND NOT %4$L LIKE '%%platform@test.local%%'
             AND %5$L::int = 0$$,
         :'unread_before', :'list_before', :'t1', :'seen', :'unread_after'));
SELECT tests.check('reply: one email to the person who opened the ticket — no message body in the queue',
  format($$SELECT count(*) = 1 AND bool_and(recipient_email = 'e4.owner@test.local' AND recipient_kind = 'owner'
                                             AND booking_id IS NULL AND payload ->> 'ticket_id' = %2$L
                                             AND NOT payload::text LIKE '%%בדקנו%%')
             FROM hospitality.notifications WHERE event = 'support_reply' AND tenant_id = %1$L$$, :'sa', :'t1'));
SELECT tests.check('reply: the email is on the business''s own emails screen; no platform address there',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_emails()') -> 'items') @> '[{"event": "support_reply"}]'
             AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE recipient_email = 'platform@test.local')$$,
         :'sa', :OWNER_A));

-- the business answers → in progress, waiting for the platform again
SELECT pg_temp.call(:'sa', :MGR_A, format($$SELECT hospitality.support_reply(%L, 'מאשרים, תודה! עוד שאלה קטנה.')$$, :'t1')) IS NOT NULL AS ok \gset
SELECT tests.check('business reply (a manager of the same site): back to in progress, waiting for the platform',
  format($$SELECT status = 'in_progress' AND last_public_sender = 'business'
             AND (pg_temp.admin('SELECT hospitality.admin_support_tickets(_needs_reply => true)') -> 'items') @> jsonb_build_array(jsonb_build_object('id', %1$L, 'unread', 1))
             FROM hospitality.support_tickets WHERE id = %1$L$$, :'t1'));
-- resolved → a business reply reopens it; close → no replies; reopen
SELECT pg_temp.admin(format($$SELECT hospitality.admin_support_reply(%L, 'סגרנו את זה.', false, 'resolved')$$, :'t1')) IS NOT NULL AS ok \gset
SELECT tests.check('status: resolved with a time stamp',
  format($$SELECT status = 'resolved' AND resolved_at IS NOT NULL FROM hospitality.support_tickets WHERE id = %L$$, :'t1'));
SELECT pg_temp.call(:'sa', :OWNER_A, format($$SELECT hospitality.support_reply(%L, 'רגע, זה חזר.')$$, :'t1')) IS NOT NULL AS ok \gset
SELECT tests.check('status: a reply to a resolved ticket reopens it (in progress, resolved_at cleared)',
  format($$SELECT status = 'in_progress' AND resolved_at IS NULL FROM hospitality.support_tickets WHERE id = %L$$, :'t1'));
SELECT pg_temp.call(:'sa', :OWNER_A, format($$SELECT hospitality.support_set_open(%L, false)$$, :'t1')) IS NOT NULL AS ok \gset
SELECT pg_temp.err_of(:'sa', :OWNER_A, format('SELECT hospitality.support_reply(%L, ''עוד משהו'')', :'t1')) AS e_reply_closed \gset
SELECT pg_temp.err_of(:'sa', :OWNER_A, format('SELECT hospitality.support_set_open(%L, false)', :'t1')) AS e_close_twice \gset
SELECT tests.check('status: the business closes; then no replies until it is reopened',
  format($$SELECT (SELECT status = 'closed' AND closed_at IS NOT NULL FROM hospitality.support_tickets WHERE id = %1$L)
             AND %2$L LIKE '%%סגורה%%' AND %3$L LIKE '%%כבר סגורה%%'$$, :'t1', :'e_reply_closed', :'e_close_twice'));
SELECT pg_temp.call(:'sa', :OWNER_A, format('SELECT hospitality.support_set_open(%L, true)', :'t1')) ->> 'status' AS reopened \gset
SELECT pg_temp.err_of(:'sa', :OWNER_A, format('SELECT hospitality.support_set_open(%L, true)', :'t1')) AS e_open_twice \gset
SELECT tests.check('status: reopen → in progress and waiting for the platform; reopening an open ticket is refused',
  format($$SELECT %2$L = 'in_progress' AND %3$L LIKE '%%כבר פתוחה%%'
             AND (SELECT closed_at IS NULL AND last_public_sender = 'business' FROM hospitality.support_tickets WHERE id = %1$L)$$,
         :'t1', :'reopened', :'e_open_twice'));
SELECT pg_temp.admin(format('SELECT hospitality.admin_support_set_status(%L, ''closed'')', :'t1')) ->> 'status' AS p_closed \gset
SELECT (SELECT closed_at IS NOT NULL FROM hospitality.support_tickets WHERE id = :'t1') AS p_closed_at \gset
SELECT pg_temp.admin(format('SELECT hospitality.admin_support_set_status(%L, ''in_progress'')', :'t1')) ->> 'status' AS p_reopened \gset
SELECT pg_temp.admin_err(format('SELECT hospitality.admin_support_set_status(%L, ''lost'')', :'t1')) AS e_bad_status \gset
SELECT tests.check('status: the platform closes and reopens; every change is in the platform audit log',
  format($$SELECT %2$L = 'closed' AND %3$L::boolean AND %4$L = 'in_progress' AND %5$L LIKE '%%סטטוס%%'
             AND (SELECT closed_at IS NULL FROM hospitality.support_tickets WHERE id = %1$L)
             AND (SELECT count(*) >= 5 FROM public.platform_audit_log
                   WHERE action IN ('hosp_support_status', 'hosp_support_reply', 'hosp_support_note')
                     AND details ->> 'ticket' = (SELECT number::text FROM hospitality.support_tickets WHERE id = %1$L))$$,
         :'t1', :'p_closed', :'p_closed_at', :'p_reopened', :'e_bad_status'));

-- ---------- support settings and plans ----------
SELECT tests.check('settings: WhatsApp for premium — saved normalized; shown to a premium business only',
  format($$SELECT pg_temp.admin('SELECT hospitality.admin_support_settings(''+972-50-123-4567'', true)') ->> 'whatsapp' = '+972501234567'
             AND pg_temp.admin_err('SELECT hospitality.admin_support_settings(''abc'', true)') LIKE '%%WhatsApp%%'
             AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_list()') ->> 'whatsapp' = '+972501234567'
             AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.support_list()') ->> 'plan' = 'premium'
             AND pg_temp.call(%3$L, %4$L, 'SELECT hospitality.support_list()') ->> 'whatsapp' IS NULL
             AND pg_temp.call(%3$L, %4$L, 'SELECT hospitality.support_list()') ->> 'plan' = 'basic'$$,
         :'sa', :OWNER_A, :'sb', :OWNER_B));

-- ---------- flood limit ----------
DO $$
DECLARE _i integer;
BEGIN
  FOR _i IN 1..9 LOOP
    PERFORM pg_temp.call((SELECT id::text FROM public.tenants WHERE slug = 'e4-sup-b'), 'a0000000-0000-0000-0000-0000000e4a03',
      format($f$SELECT hospitality.support_open('פנייה מספר %s', 'other', 'low', 'בדיקת הגבלה')$f$, _i));
  END LOOP;
END $$;
SELECT tests.check('limit: up to 10 new tickets a day per business (the 11th is refused; the other business is not affected)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.support_open(''פנייה 11'', ''other'', ''low'', ''x'')') LIKE '%%הרבה פניות%%'
             AND pg_temp.err_of(%3$L, %4$L, 'SELECT hospitality.support_open(''פנייה נוספת'', ''other'', ''low'', ''x'')') IS NULL$$,
         :'sb', :OWNER_B, :'sa', :OWNER_A));

-- ============================================================
-- Hospitality — failed-email alerts can be marked read / handled (migration 206 — 20261125100000_hosp_email_alerts.sql)
--   "יש התראה על מייל שנכשל ואין אפשרות להסיר אותה" (Nofi Dorit, and every zimmer business).
--   • structure: the mark functions — signed-in staff with the bookings permission, never anon; the
--     "cancelled on purpose" helper is internal;
--   • an open alert = failed / dead, not handled, not cancelled by the system (guest anonymized, customer email
--     corrected) — dashboard_tasks counts only those, with how many were not seen yet;
--   • staff_emails: "failed" = the open alerts, "handled" = handled or cancelled, every failed row says its state;
--   • seen / handled / reopen / mark all — only the business's own emails, logged; the emails themselves (status,
--     attempts, error, history) never change;
--   • a cancelled email is never re-sent (it would go to the old address); a re-sent email starts a new alert.
-- ============================================================
\set OWNER206 '''a0000000-0000-0000-0000-000000206a01'''
\set MGR206 '''a0000000-0000-0000-0000-000000206a02'''
\set OTHER206 '''a0000000-0000-0000-0000-000000206a03'''

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
CREATE OR REPLACE FUNCTION pg_temp.srv(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
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
CREATE OR REPLACE FUNCTION pg_temp.mail(_site text, _key text, _status text, _error text) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO hospitality.notifications (tenant_id, event, recipient_kind, recipient_email, dedupe_key, status,
                                         attempts, last_error, sent_at)
  VALUES (_site::uuid, 'booking_confirmed', 'guest', 'guest-' || _key || '@test.local', 'm206:' || _key, _status,
          CASE WHEN _status IN ('failed', 'dead') THEN 5 ELSE 1 END, _error,
          CASE WHEN _status = 'sent' THEN now() END)
  RETURNING id;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.emails_task(_site text, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT (SELECT e FROM jsonb_array_elements(pg_temp.call(_site, _uid, 'SELECT hospitality.dashboard_tasks()') -> 'items') e
           WHERE e ->> 'kind' = 'emails');
$f$;

-- ---------- fixtures: a zimmer business with failed, cancelled and sent emails; a neighbour ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000206a01', 'm206.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000206a02', 'm206.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000206a03', 'm206.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m206_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m206-mail', 'נופי המיילים', 'm206.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm206.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m206-other', 'אתר שכן', 'm206.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm206.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR206, 'm206.manager@test.local', 'm206_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.mail(:'st', 'n1', 'failed', 'שגיאת שליחה (422)') AS n1 \gset
SELECT pg_temp.mail(:'st', 'n2', 'dead', 'domain is not verified') AS n2 \gset
SELECT pg_temp.mail(:'st', 'n3', 'dead', 'guest anonymized') AS n3 \gset
SELECT pg_temp.mail(:'st', 'n4', 'dead', 'customer email corrected') AS n4 \gset
SELECT pg_temp.mail(:'st', 'n5', 'sent', NULL) AS n5 \gset
SELECT pg_temp.mail(:'so', 'n6', 'failed', 'שגיאת שליחה (500)') AS n6 \gset
CREATE TEMP TABLE m206_before AS
  SELECT id, status, attempts, last_error, recipient_email, created_at FROM hospitality.notifications
   WHERE tenant_id IN (:'st', :'so');

-- ---------- structure ----------
SELECT tests.check('structure: the mark functions are SECURITY DEFINER, for signed-in staff (never anon)',
  $$SELECT bool_and(p.prosecdef) AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          AND NOT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.oid IN ('hospitality.email_alerts_mark(uuid[],text)'::regprocedure,
                                    'hospitality.email_alerts_mark_all(text)'::regprocedure)$$);
SELECT tests.check('structure: the "cancelled on purpose" helper is internal (not callable by staff or guests)',
  $$SELECT NOT has_function_privilege('authenticated', 'hospitality._email_cancelled(text,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality._email_cancelled(text,text)', 'EXECUTE')$$);

-- ---------- what counts as an alert ----------
SELECT tests.check('dashboard: 2 open alerts (failed + gave up) — not the 2 the system cancelled on purpose, not the sent one; 2 not seen',
  format($$SELECT (%1$L::jsonb ->> 'count')::int = 2 AND (%1$L::jsonb ->> 'unseen')::int = 2$$,
         pg_temp.emails_task(:'st', :OWNER206)));
SELECT pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.staff_emails('failed', 100)$$) AS failed_list \gset
SELECT tests.check('emails screen, "failed": exactly the 2 open alerts; counts: failed 2, handled 2 (the cancelled ones)',
  format($$SELECT (SELECT array_agg(e ->> 'id' ORDER BY e ->> 'id') FROM jsonb_array_elements(%1$L::jsonb -> 'items') e)
                    = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[%2$L, %3$L]) x)
             AND (%1$L::jsonb #>> '{counts,failed}')::int = 2 AND (%1$L::jsonb #>> '{counts,handled}')::int = 2$$,
         :'failed_list', :'n1', :'n2'));
SELECT tests.check('emails screen: a cancelled email says so (cancelled, not handled); a sent email has no alert state',
  format($$SELECT (SELECT (e -> 'alert' ->> 'cancelled')::boolean AND NOT (e -> 'alert' ->> 'handled')::boolean
                     FROM jsonb_array_elements(%1$L::jsonb -> 'items') e WHERE e ->> 'id' = %2$L)
             AND (SELECT e -> 'alert' IS NULL OR e -> 'alert' = 'null'::jsonb
                     FROM jsonb_array_elements(%1$L::jsonb -> 'items') e WHERE e ->> 'id' = %3$L)$$,
         pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.staff_emails('all', 100)$$), :'n3', :'n5'));

-- ---------- read / handled / reopen ----------
SELECT pg_temp.call(:'st', :OWNER206, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'seen')$q$, :'n1')) AS r_seen \gset
SELECT tests.check('read: marking one as read keeps it an alert (count 2) but it is no longer new (unseen 1); logged',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 1
             AND (%2$L::jsonb ->> 'count')::int = 2 AND (%2$L::jsonb ->> 'unseen')::int = 1
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'emails.alert_seen'
                          AND (a.changes ->> 'count')::int = 1)$$,
         :'r_seen', pg_temp.emails_task(:'st', :OWNER206), :'st'));
SELECT pg_temp.call(:'st', :MGR206, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'handled')$q$, :'n1')) AS r_handled \gset
SELECT tests.check('handled: a manager (bookings permission) marks it handled — it leaves the alerts (count 1); who and when are kept',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 1 AND (%2$L::jsonb ->> 'count')::int = 1
             AND (SELECT x.alert_handled_by = %3$L::uuid AND x.alert_handled_at IS NOT NULL
                    FROM hospitality.notifications x WHERE x.id = %4$L)$$,
         :'r_handled', pg_temp.emails_task(:'st', :OWNER206), :MGR206, :'n1'));
SELECT tests.check('handled: the "handled" list shows it (with the cancelled ones); the "failed" list no longer does',
  format($$SELECT (SELECT count(*) FROM jsonb_array_elements(%1$L::jsonb -> 'items') e WHERE e ->> 'id' IN (%3$L, %4$L, %5$L)) = 3
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb -> 'items') e WHERE e ->> 'id' = %3$L)$$,
         pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.staff_emails('handled', 100)$$),
         pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.staff_emails('failed', 100)$$), :'n1', :'n3', :'n4'));
SELECT pg_temp.call(:'st', :OWNER206, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'reopen')$q$, :'n1')) AS r_reopen \gset
SELECT tests.check('reopen: back to the alerts (count 2), read and handled cleared; logged',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 1 AND (%2$L::jsonb ->> 'count')::int = 2
             AND (SELECT x.alert_handled_at IS NULL AND x.alert_seen_at IS NULL FROM hospitality.notifications x WHERE x.id = %3$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %4$L AND a.action = 'emails.alert_reopened')$$,
         :'r_reopen', pg_temp.emails_task(:'st', :OWNER206), :'n1', :'st'));
SELECT pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.email_alerts_mark_all('seen')$$) AS r_all_seen \gset
SELECT tests.check('mark all as read: every open alert is read (unseen 0), still 2 alerts',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 2 AND (%2$L::jsonb ->> 'count')::int = 2
             AND (%2$L::jsonb ->> 'unseen')::int = 0$$,
         :'r_all_seen', pg_temp.emails_task(:'st', :OWNER206)));
SELECT pg_temp.call(:'st', :OWNER206, $$SELECT hospitality.email_alerts_mark_all('handled')$$) AS r_all_handled \gset
SELECT tests.check('mark all as handled: no alert left (the "emails" task disappears); the cancelled rows are not touched',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 2 AND %2$L::jsonb IS NULL
             AND (SELECT bool_and(x.alert_handled_at IS NULL) FROM hospitality.notifications x WHERE x.id IN (%3$L, %4$L))$$,
         :'r_all_handled', pg_temp.emails_task(:'st', :OWNER206), :'n3', :'n4'));

-- ---------- isolation and permissions ----------
SELECT pg_temp.call(:'st', :OWNER206, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'handled')$q$, :'n6')) AS r_cross \gset
SELECT tests.check('isolation: another business''s email cannot be marked from this one (0 updated); its alert stays',
  format($$SELECT (%1$L::jsonb ->> 'updated')::int = 0 AND (%2$L::jsonb ->> 'count')::int = 1
             AND (SELECT x.alert_handled_at IS NULL AND x.alert_seen_at IS NULL FROM hospitality.notifications x WHERE x.id = %3$L)$$,
         :'r_cross', pg_temp.emails_task(:'so', :OTHER206), :'n6'));
SELECT tests.check('permissions: a guest (anon) cannot mark anything',
  format($$SELECT %L IS NOT NULL$$,
         pg_temp.err_of(:'st', NULL, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'handled')$q$, :'n2'))));
SELECT tests.check('input: an unknown action, an empty list, more than 200 ids, and "reopen" for all are refused',
  format($$SELECT %1$L IS NOT NULL AND %2$L IS NOT NULL AND %3$L IS NOT NULL AND %4$L IS NOT NULL$$,
         pg_temp.err_of(:'st', :OWNER206, format($q$SELECT hospitality.email_alerts_mark(ARRAY[%L]::uuid[], 'delete')$q$, :'n2')),
         pg_temp.err_of(:'st', :OWNER206, $q$SELECT hospitality.email_alerts_mark(ARRAY[]::uuid[], 'seen')$q$),
         pg_temp.err_of(:'st', :OWNER206, $q$SELECT hospitality.email_alerts_mark((SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 201)), 'seen')$q$),
         pg_temp.err_of(:'st', :OWNER206, $q$SELECT hospitality.email_alerts_mark_all('reopen')$q$)));

-- ---------- re-send ----------
SELECT tests.check('re-send: an email cancelled on purpose is refused (it would go to the old address) and stays as it was',
  format($$SELECT %1$L LIKE '%%בוטל בכוונה%%'
             AND (SELECT x.status = 'dead' AND x.last_error = 'customer email corrected' FROM hospitality.notifications x WHERE x.id = %2$L)$$,
         pg_temp.err_of(:'st', :OWNER206, format($q$SELECT hospitality.requeue_notification(%L)$q$, :'n4')), :'n4'));
SELECT pg_temp.call(:'st', :OWNER206, format($q$SELECT hospitality.requeue_notification(%L)$q$, :'n2')) AS rq \gset
SELECT tests.check('re-send: a handled failure goes back to the queue — a new attempt, a new alert (read / handled cleared)',
  format($$SELECT %1$L::jsonb ->> 'status' = 'queued'
             AND (SELECT x.alert_seen_at IS NULL AND x.alert_handled_at IS NULL AND x.alert_handled_by IS NULL
                    FROM hospitality.notifications x WHERE x.id = %2$L)$$, :'rq', :'n2'));

-- ---------- history kept ----------
SELECT tests.check('history: no email row was deleted; the untouched ones keep status, attempts, error and address',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications WHERE tenant_id IN (%1$L, %2$L)) = 6
             AND NOT EXISTS (SELECT 1 FROM m206_before b JOIN hospitality.notifications x ON x.id = b.id
                              WHERE x.id <> %3$L AND (x.status, x.attempts, x.last_error, x.recipient_email)
                                    IS DISTINCT FROM (b.status, b.attempts, b.last_error, b.recipient_email))$$,
         :'st', :'so', :'n2'));

-- ---------- cleanup ----------
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_delete_tenant(%1$L, 'm206-mail'), public.platform_delete_tenant(%2$L, 'm206-other')])$$, :'st', :'so')) IS NOT NULL AS ok \gset
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m206_flags m WHERE f.key = m.key;
DROP TABLE m206_flags;
DROP TABLE m206_before;

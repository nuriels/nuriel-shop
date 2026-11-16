-- ============================================================
-- Nuriel Websites — inquiries from customers (migration 196)
--   • only our server (service_role) saves an inquiry; guests / signed-in users cannot call it directly
--   • the site of the request, a live site (or a test inquiry from the preview), valid input, rate limits,
--     one inquiry per client key (double submit)
--   • the owner (inquiries.manage) lists / reads / changes status / adds notes / deletes — on their own site only;
--     a content manager, another business and a guest see nothing
--   • the e-mail notification: saved first, claimed with a lock, failure → automatic retry schedule, manual retry
--   • every admin action is in the audit log, without the inquiry's content or the notification address
--   • retention: automatic deletion after the site's period (test inquiries after 30 days)
-- ============================================================
\set PLATFORM '''a0000000-0000-0000-0000-0000000000f0'''
\set Q_OWNER1 '''a0000000-0000-0000-0000-0000000196a1'''
\set Q_OWNER2 '''a0000000-0000-0000-0000-0000000196a2'''
\set Q_MGR '''a0000000-0000-0000-0000-0000000196a3'''
\set IP1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set IP2 '''2222222222222222222222222222222222222222222222222222222222222222'''

CREATE OR REPLACE FUNCTION pg_temp.as_user(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE ' || CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.user_err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
-- our server: service_role with the site's x-tenant-id (like the app's service client)
CREATE OR REPLACE FUNCTION pg_temp.as_service(_site text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  SET LOCAL ROLE service_role;
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.service_err(_site text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_service(_site, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN e;
END $f$;
-- run a statement as the database owner (the table constraints); NULL = ok, otherwise the error text
CREATE OR REPLACE FUNCTION pg_temp.try_sql(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $f$;
-- the SQLSTATE of an error (to check the server's mapping, e.g. P0429 = rate limit)
CREATE OR REPLACE FUNCTION pg_temp.service_state(_site text, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_service(_site, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  RETURN e;
END $f$;
-- a submission (the server's call)
CREATE OR REPLACE FUNCTION pg_temp.submit_sql(_key uuid, _name text DEFAULT 'דנה כהן', _phone text DEFAULT '050-1234567',
                                              _email text DEFAULT 'dana@example.com', _message text DEFAULT 'אשמח לפרטים',
                                              _ip text DEFAULT NULL, _test boolean DEFAULT false,
                                              _kind text DEFAULT 'consultation')
RETURNS text LANGUAGE sql AS $f$
  SELECT format('SELECT public.bp_inquiry_submit(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
                _key, _kind, 'השאירו פרטים', '/', _name, _phone, _email, _message, _ip, _test);
$f$;
CREATE OR REPLACE FUNCTION pg_temp.doc() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('schema', 1, 'template', 'elegant', 'locales', '["he"]'::jsonb,
           'pages', jsonb_build_array(jsonb_build_object('id', 'home', 'slug', '', 'blocks', '[]'::jsonb)));
$f$;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data) VALUES
  (:Q_OWNER1, 'inq.owner1@test.local', now(), '{"platform": "true"}'),
  (:Q_OWNER2, 'inq.owner2@test.local', now(), '{"platform": "true"}'),
  (:Q_MGR, 'inq.mgr@test.local', now(), '{"platform": "true"}')
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', true),
       public.platform_set_flag('business_profile_public', true)])$$) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('inq-one', 'פניות אחד', 'inq.owner1@test.local', %L)$$, pg_temp.doc())) ->> 'id' AS q1 \gset
SELECT pg_temp.as_user(NULL, :PLATFORM, format($$SELECT public.platform_bp_open_site('inq-two', 'פניות שתיים', 'inq.owner2@test.local', %L)$$, pg_temp.doc())) ->> 'id' AS q2 \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
VALUES (:'q1', :Q_MGR, 'inq.mgr@test.local', 'admin', true, false);
-- site one is live (approved first publish); site two is still a draft
SELECT business_profile._publish(:'q1', 'elegant', pg_temp.doc(), 1, NULL, :Q_OWNER1, :PLATFORM) IS NOT NULL AS ok \gset
UPDATE business_profile.sites SET first_approved_at = now(), first_approved_by = :PLATFORM WHERE tenant_id = :'q1';
INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES (:'q1', 'business_profile_public', true)
ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true;
SELECT gen_random_uuid() AS k1, gen_random_uuid() AS k2, gen_random_uuid() AS k3, gen_random_uuid() AS k4,
       gen_random_uuid() AS k5 \gset

-- ============================================================
-- 1. Closed tables; who may call what
-- ============================================================
SELECT tests.check('bp inquiries: the three tables are closed to every API user, with RLS and the tenant isolation policy',
  $$SELECT (SELECT bool_and(c.relrowsecurity) FROM pg_class c
             WHERE c.oid IN ('business_profile.inquiries'::regclass, 'business_profile.inquiry_notes'::regclass,
                             'business_profile.inquiry_settings'::regclass))
       AND NOT has_table_privilege('anon', 'business_profile.inquiries', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'business_profile.inquiries', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'business_profile.inquiries', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'business_profile.inquiry_notes', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'business_profile.inquiry_settings', 'SELECT')
       AND NOT has_table_privilege('service_role', 'business_profile.inquiries', 'INSERT')
       AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'business_profile' AND policyname = 'tenant_isolation'
             AND tablename IN ('inquiries', 'inquiry_notes', 'inquiry_settings') AND permissive = 'RESTRICTIVE') = 3$$);
SELECT tests.check('bp inquiries: saving and the notification queue are for our server only (not guests, not signed-in users)',
  $$SELECT has_function_privilege('service_role', 'public.bp_inquiry_submit(uuid,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_inquiry_submit(uuid,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_inquiry_submit(uuid,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_inquiry_notify_claim(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_inquiry_notify_result(uuid,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_inquiry_notify_due(integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bp_inquiries_purge()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'public.bp_inquiries_list(text,boolean,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_inquiries_list(text,boolean,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_inquiry_get(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'public.bp_inquiry_settings_save(text,boolean,integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._inquiry_json(business_profile.inquiries,boolean)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'business_profile._site_live(uuid)', 'EXECUTE')$$);
SELECT tests.check('bp inquiries: the owner gets the new permission; a content manager does not',
  format($$SELECT pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_studio_context()') -> 'permissions' ? 'inquiries.manage'
             AND NOT pg_temp.as_user(%1$L, %3$L, 'SELECT public.bp_studio_context()') -> 'permissions' ? 'inquiries.manage'$$,
         :'q1', :Q_OWNER1, :Q_MGR));

-- ============================================================
-- 2. Submitting
-- ============================================================
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(:'k1', _ip => :IP1)) AS sub1 \gset
SELECT tests.check('bp inquiries: a valid submission on a live site is saved on that site — normalised, with a reference; no address yet → the notification is skipped with the reason',
  format($$SELECT (%1$L::jsonb ->> 'duplicate')::boolean = false AND char_length(%1$L::jsonb ->> 'reference') = 8
             AND (%1$L::jsonb ->> 'notify')::boolean = false
             AND (SELECT tenant_id = %2$L AND full_name = 'דנה כהן' AND phone = '0501234567' AND email = 'dana@example.com'
                         AND kind = 'consultation' AND status = 'new' AND NOT is_test AND ip_hash = %3$L
                         AND notify_status = 'skipped' AND notify_error = 'לא הוגדר מייל להתראות'
                    FROM business_profile.inquiries WHERE id = (%1$L::jsonb ->> 'id')::uuid)$$,
         :'sub1', :'q1', :IP1));
SELECT tests.check('bp inquiries: the same client key again (double click) → the same inquiry, nothing new',
  format($$SELECT pg_temp.as_service(%1$L, pg_temp.submit_sql(%2$L, _ip => %3$L)) ->> 'id' = %4$L::jsonb ->> 'id'
             AND (pg_temp.as_service(%1$L, pg_temp.submit_sql(%2$L, _ip => %3$L)) ->> 'duplicate')::boolean
             AND (SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = %1$L AND client_key = %2$L) = 1$$,
         :'q1', :'k1', :IP1, :'sub1'));
SELECT pg_temp.service_err(:'q2', pg_temp.submit_sql(:'k2')) AS not_live \gset
SELECT pg_temp.as_service(:'q2', pg_temp.submit_sql(:'k3', _test => true)) AS sub_test \gset
SELECT tests.check('bp inquiries: a site that is not live refuses a normal submission; a test inquiry (preview) is saved and marked',
  format($$SELECT %1$L LIKE '%%הטופס לא זמין%%' AND (%2$L::jsonb ->> 'test')::boolean
             AND (SELECT is_test FROM business_profile.inquiries WHERE tenant_id = %3$L AND client_key = %4$L)
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiries WHERE client_key = %5$L)$$,
         :'not_live', :'sub_test', :'q2', :'k3', :'k2'));
SELECT tests.check('bp inquiries: no site in the request → refused (nothing saved)',
  format($$SELECT pg_temp.service_err(NULL, pg_temp.submit_sql(%L)) LIKE '%%האתר לא נמצא%%'$$, gen_random_uuid()));
SELECT tests.check('bp inquiries: bad input is refused with a message for the visitor (name, phone, e-mail, no way back, long message)',
  format($$SELECT pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _name => 'א')) LIKE '%%נא למלא שם%%'
             AND pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _phone => '12')) LIKE '%%הטלפון לא תקין%%'
             AND pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _email => 'not-an-email')) LIKE '%%האימייל לא תקינה%%'
             AND pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _phone => '', _email => '')) LIKE '%%טלפון או אימייל%%'
             AND pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _message => repeat('א', 4001))) LIKE '%%ארוכה מדי%%'
             AND pg_temp.service_err(%1$L, format('SELECT public.bp_inquiry_submit(NULL, %%L, NULL, NULL, %%L, %%L, NULL, NULL)', 'contact', 'שם', '0501234567')) LIKE '%%הטופס לא תקין%%'$$,
         :'q1'));
SELECT pg_temp.as_service(:'q1', format('SELECT public.bp_inquiry_submit(%L, %L, NULL, %L, %L, NULL, %L, NULL, %L)',
         gen_random_uuid(), 'hack', 'javascript:alert(1)', 'שם מלא', 'a@b.co', '10.0.0.1')) ->> 'id' AS odd \gset
SELECT tests.check('bp inquiries: an unknown kind becomes "contact"; a bad page path or IP hash is dropped (never stored)',
  format($$SELECT (SELECT kind = 'contact' AND page_path IS NULL AND ip_hash IS NULL FROM business_profile.inquiries
                    WHERE id = %L)$$, :'odd'));
-- rate limit: the first submission used IP1; three more → 4, then the 5th is allowed, the 6th refused
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(gen_random_uuid(), _ip => :IP1)) IS NOT NULL AS ok \gset
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(gen_random_uuid(), _ip => :IP1)) IS NOT NULL AS ok \gset
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(gen_random_uuid(), _ip => :IP1)) IS NOT NULL AS ok \gset
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(gen_random_uuid(), _ip => :IP1)) IS NOT NULL AS ok \gset
SELECT tests.check('bp inquiries: 5 inquiries in 10 minutes from one address — the 6th is refused (P0429); another address is fine',
  format($$SELECT pg_temp.service_err(%1$L, pg_temp.submit_sql(gen_random_uuid(), _ip => %2$L)) LIKE '%%נסו שוב בעוד כמה דקות%%'
             AND pg_temp.service_state(%1$L, pg_temp.submit_sql(gen_random_uuid(), _ip => %2$L)) = 'P0429'
             AND (SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = %1$L AND ip_hash = %2$L) = 5
             AND pg_temp.as_service(%1$L, pg_temp.submit_sql(gen_random_uuid(), _ip => %3$L)) ->> 'id' IS NOT NULL$$,
         :'q1', :IP1, :IP2));
SELECT tests.check('bp inquiries: a note must belong to an inquiry of the same site (the table refuses a mismatch)',
  format($$SELECT pg_temp.try_sql(format('INSERT INTO business_profile.inquiry_notes (tenant_id, inquiry_id, body) VALUES (%%L, %%L, %%L)',
                                          %L, %L, 'x')) LIKE '%%bp_inquiry_notes_inquiry%%'$$,
         :'q2', :'sub1'::jsonb ->> 'id'));

-- ============================================================
-- 3. The owner's inbox — own site only
-- ============================================================
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, 'SELECT public.bp_inquiries_list()') AS list1 \gset
SELECT tests.check('bp inquiries: the owner lists their own site''s inquiries (newest first) with counts; no IP hash or client key in the list',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'items') = (SELECT count(*) FROM business_profile.inquiries WHERE tenant_id = %2$L)
             AND (%1$L::jsonb -> 'counts' ->> 'new')::int = jsonb_array_length(%1$L::jsonb -> 'items')
             AND NOT (%1$L::jsonb -> 'items' -> 0) ? 'ip_hash' AND NOT (%1$L::jsonb -> 'items' -> 0) ? 'client_key'
             AND %1$L::jsonb ->> 'notify_block' = 'לא הוגדר מייל להתראות'
             AND (SELECT bool_and((e ->> 'id')::uuid IN (SELECT id FROM business_profile.inquiries WHERE tenant_id = %2$L))
                    FROM jsonb_array_elements(%1$L::jsonb -> 'items') e)$$,
         :'list1', :'q1'));
SELECT tests.check('bp inquiries: the other business sees only its own (the test one); it cannot read, change, note or delete site one''s inquiry',
  format($$SELECT jsonb_array_length(pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_inquiries_list()') -> 'items') = 1
             AND (pg_temp.as_user(%1$L, %2$L, 'SELECT public.bp_inquiries_list()') -> 'counts' ->> 'test')::int = 1
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_get(%%L)', %3$L)) LIKE '%%הפנייה לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_set_status(%%L, %%L)', %3$L, 'done')) LIKE '%%הפנייה לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_add_note(%%L, %%L)', %3$L, 'x')) LIKE '%%הפנייה לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_delete(%%L)', %3$L)) LIKE '%%הפנייה לא נמצאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_retry_notify(%%L)', %3$L)) LIKE '%%הפנייה לא נמצאה%%'
             -- and on site one's address, site two's owner has no permission at all
             AND pg_temp.user_err(%4$L, %2$L, 'SELECT public.bp_inquiries_list()') LIKE '%%אין הרשאה%%'
             AND (SELECT status FROM business_profile.inquiries WHERE id = %3$L) = 'new'$$,
         :'q2', :Q_OWNER2, :'sub1'::jsonb ->> 'id', :'q1'));
SELECT tests.check('bp inquiries: a content manager and a guest cannot open the inbox; the new-count is 0 for them',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, 'SELECT public.bp_inquiries_list()') LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_get(%%L)', %3$L)) LIKE '%%אין הרשאה%%'
             AND pg_temp.user_err(%1$L, NULL, 'SELECT public.bp_inquiries_list()') IS NOT NULL
             AND pg_temp.as_user(%1$L, %2$L, 'SELECT to_jsonb(public.bp_inquiries_new_count())')::int = 0
             AND pg_temp.as_user(%1$L, %4$L, 'SELECT to_jsonb(public.bp_inquiries_new_count())')::int > 0
             AND pg_temp.as_user(%5$L, %6$L, 'SELECT to_jsonb(public.bp_inquiries_new_count())')::int = 0$$,
         :'q1', :Q_MGR, :'sub1'::jsonb ->> 'id', :Q_OWNER1, :'q2', :Q_OWNER2));

-- status, notes, history
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_set_status(%L, %L)', :'sub1'::jsonb ->> 'id', 'in_progress')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_add_note(%L, %L)', :'sub1'::jsonb ->> 'id', '  חזרתי אליה בטלפון  ')) ->> 'id' AS note1 \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_get(%L)', :'sub1'::jsonb ->> 'id')) AS get1 \gset
SELECT tests.check('bp inquiries: the owner moves an inquiry to "in progress" and adds an internal note — both in the details, with the history',
  format($$SELECT %1$L::jsonb ->> 'status' = 'in_progress' AND %1$L::jsonb ->> 'message' = 'אשמח לפרטים'
             AND %1$L::jsonb -> 'notes' -> 0 ->> 'body' = 'חזרתי אליה בטלפון'
             AND (%1$L::jsonb -> 'notes' -> 0 ->> 'mine')::boolean
             AND %1$L::jsonb -> 'notes' -> 0 ->> 'author' = 'inq.owner1@test.local'
             AND (%1$L::jsonb ->> 'notes_count')::int = 1
             AND %1$L::jsonb -> 'history' -> 0 ->> 'action' = 'inquiry.status'
             AND %1$L::jsonb -> 'history' -> 0 ->> 'from' = 'new' AND %1$L::jsonb -> 'history' -> 0 ->> 'to' = 'in_progress'
             AND %1$L::jsonb -> 'history' -> 1 ->> 'action' = 'inquiry.note_added'
             AND (SELECT status_changed_by = %2$L FROM business_profile.inquiries WHERE id = (%1$L::jsonb ->> 'id')::uuid)$$,
         :'get1', :Q_OWNER1));
SELECT tests.check('bp inquiries: bad status / empty or long note are refused; the other business cannot delete the note',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_set_status(%%L, %%L)', %3$L, 'archived')) LIKE '%%מצב לא תקין%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_add_note(%%L, %%L)', %3$L, '   ')) LIKE '%%1–2000%%'
             AND pg_temp.user_err(%1$L, %2$L, format('SELECT public.bp_inquiry_add_note(%%L, %%L)', %3$L, repeat('x', 2001))) LIKE '%%1–2000%%'
             AND pg_temp.user_err(%4$L, %5$L, format('SELECT public.bp_inquiry_delete_note(%%L)', %6$L)) LIKE '%%ההערה לא נמצאה%%'
             AND EXISTS (SELECT 1 FROM business_profile.inquiry_notes WHERE id = %6$L)$$,
         :'q1', :Q_OWNER1, :'sub1'::jsonb ->> 'id', :'q2', :Q_OWNER2, :'note1'));
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_set_status(%L, %L)', :'sub1'::jsonb ->> 'id', 'done')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_delete_note(%L)', :'note1')) IS NOT NULL AS ok \gset
SELECT tests.check('bp inquiries: "done" and deleting the note — every admin action is in the audit log with the actor, without the content',
  format($$SELECT (SELECT status FROM business_profile.inquiries WHERE id = %1$L) = 'done'
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiry_notes WHERE id = %2$L)
             AND (SELECT array_agg(action ORDER BY id) FROM business_profile.audit_log
                   WHERE tenant_id = %3$L AND details ->> 'id' = %1$L::text)
                 = ARRAY['inquiry.status', 'inquiry.note_added', 'inquiry.status', 'inquiry.note_deleted']
             AND (SELECT bool_and(actor_id = %4$L) FROM business_profile.audit_log
                   WHERE tenant_id = %3$L AND details ->> 'id' = %1$L::text)
             AND NOT EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %3$L
                              AND (details::text LIKE '%%חזרתי%%' OR details::text LIKE '%%dana@%%' OR details::text LIKE '%%050%%'))$$,
         :'sub1'::jsonb ->> 'id', :'note1', :'q1', :Q_OWNER1));

-- ============================================================
-- 4. Notification settings and the e-mail lifecycle
-- ============================================================
SELECT tests.check('bp inquiries: settings — a bad address, notifications on without an address and an out-of-range period are refused',
  format($$SELECT pg_temp.user_err(%1$L, %2$L, $q$SELECT public.bp_inquiry_settings_save('not-mail', true, 365)$q$) LIKE '%%לא תקינה%%'
             AND pg_temp.user_err(%1$L, %2$L, $q$SELECT public.bp_inquiry_settings_save('', true, 365)$q$) LIKE '%%צריך מייל להתראות%%'
             AND pg_temp.user_err(%1$L, %2$L, $q$SELECT public.bp_inquiry_settings_save('a@b.co', true, 10)$q$) LIKE '%%בין 30 ל-1095%%'
             AND pg_temp.user_err(%1$L, %3$L, $q$SELECT public.bp_inquiry_settings_save('a@b.co', true, 365)$q$) LIKE '%%אין הרשאה%%'
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiry_settings WHERE tenant_id = %1$L)$$,
         :'q1', :Q_OWNER1, :Q_MGR));
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, $$SELECT public.bp_inquiry_settings_save(' Owner.Notify@Example.com ', true, 400)$$) AS set1 \gset
SELECT tests.check('bp inquiries: the owner saves the notification address (normalised) and the period; the log says what changed, not the address; the account e-mail is offered',
  format($$SELECT %1$L::jsonb ->> 'notify_email' = 'owner.notify@example.com' AND (%1$L::jsonb ->> 'retention_days')::int = 400
             AND pg_temp.as_user(%2$L, %3$L, 'SELECT public.bp_inquiry_settings()') ->> 'account_email' = 'inq.owner1@test.local'
             AND (SELECT details = '{"notify_enabled": true, "retention_days": 400, "email_changed": true}'::jsonb
                    FROM business_profile.audit_log WHERE tenant_id = %2$L AND action = 'inquiry.settings' ORDER BY id DESC LIMIT 1)
             AND pg_temp.user_err(%4$L, %5$L, 'SELECT public.bp_inquiry_settings()') IS NULL
             AND pg_temp.as_user(%4$L, %5$L, 'SELECT public.bp_inquiry_settings()') ->> 'notify_email' IS NULL$$,
         :'set1', :'q1', :Q_OWNER1, :'q2', :Q_OWNER2));
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(:'k4', _ip => :IP2)) AS sub2 \gset
SELECT pg_temp.as_service(NULL, format('SELECT public.bp_inquiry_notify_claim(%L)', :'sub2'::jsonb ->> 'id')) AS claim1 \gset
SELECT tests.check('bp inquiries: with an address the inquiry waits for the e-mail; claiming locks it and returns what the e-mail needs',
  format($$SELECT (%1$L::jsonb ->> 'notify')::boolean
             AND %2$L::jsonb ->> 'to' = 'owner.notify@example.com' AND %2$L::jsonb -> 'site' ->> 'slug' = 'inq-one'
             AND %2$L::jsonb ->> 'full_name' = 'דנה כהן' AND (%2$L::jsonb ->> 'attempt')::int = 1
             AND (SELECT notify_status = 'sending' AND notify_locked_until > now() FROM business_profile.inquiries
                   WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             -- locked: a second claim (another server / the worker) gets nothing → no double e-mail
             AND pg_temp.as_service(NULL, format('SELECT public.bp_inquiry_notify_claim(%%L)', %1$L::jsonb ->> 'id')) IS NULL$$,
         :'sub2', :'claim1'));
SELECT pg_temp.as_service(NULL, format($$SELECT to_jsonb(public.bp_inquiry_notify_result(%L, false, 'השרת לא זמין (503)'))$$, :'sub2'::jsonb ->> 'id')) IS NULL AS ok \gset
SELECT tests.check('bp inquiries: a failed send keeps the inquiry; status failed with the error and a retry in about 5 minutes',
  format($$SELECT (SELECT notify_status = 'failed' AND notify_error = 'השרת לא זמין (503)' AND notify_attempts = 1
                         AND notify_next_at BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes'
                         AND notify_locked_until IS NULL AND full_name = 'דנה כהן'
                    FROM business_profile.inquiries WHERE id = %1$L)
             AND NOT (pg_temp.as_service(NULL, 'SELECT public.bp_inquiry_notify_due(50)') ? %1$L)$$,
         :'sub2'::jsonb ->> 'id'));
UPDATE business_profile.inquiries SET notify_next_at = now() - interval '1 second' WHERE id = (:'sub2'::jsonb ->> 'id')::uuid;
SELECT pg_temp.as_service(NULL, 'SELECT public.bp_inquiry_notify_due(50)') ? (:'sub2'::jsonb ->> 'id') AS due2 \gset
SELECT pg_temp.as_service(NULL, format('SELECT public.bp_inquiry_notify_claim(%L)', :'sub2'::jsonb ->> 'id')) ->> 'attempt' AS attempt2 \gset
SELECT pg_temp.as_service(NULL, format('SELECT to_jsonb(public.bp_inquiry_notify_result(%L, true))', :'sub2'::jsonb ->> 'id')) IS NULL AS ok \gset
SELECT tests.check('bp inquiries: when the retry time comes the worker picks it up; attempt 2 → success → sent (and not claimable again)',
  format($$SELECT %4$L::boolean AND %5$L::int = 2
             AND (SELECT notify_status = 'sent' AND notify_sent_at IS NOT NULL AND notify_error IS NULL
                    FROM business_profile.inquiries WHERE id = %1$L)
             AND pg_temp.as_service(NULL, format('SELECT public.bp_inquiry_notify_claim(%%L)', %1$L)) IS NULL
             AND pg_temp.user_err(%2$L, %3$L, format('SELECT public.bp_inquiry_retry_notify(%%L)', %1$L)) LIKE '%%כבר נשלחה%%'$$,
         :'sub2'::jsonb ->> 'id', :'q1', :Q_OWNER1, :'due2', :'attempt2'));
-- four failures → no more automatic retries; the owner retries by hand
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(:'k5', _ip => :IP2)) AS sub3 \gset
DO $$
DECLARE _id uuid := (SELECT id FROM business_profile.inquiries WHERE notify_status = 'pending' ORDER BY created_at DESC LIMIT 1);
BEGIN
  FOR i IN 1..4 LOOP
    SET LOCAL ROLE service_role;
    PERFORM public.bp_inquiry_notify_claim(_id);
    PERFORM public.bp_inquiry_notify_result(_id, false, 'נכשל');
    RESET ROLE;
    UPDATE business_profile.inquiries SET notify_next_at = CASE WHEN notify_next_at IS NULL THEN NULL ELSE now() - interval '1 second' END
     WHERE id = _id;
  END LOOP;
END $$;
SELECT tests.check('bp inquiries: after 4 failed attempts there is no automatic retry (next_at empty, not in the worker list)',
  format($$SELECT (SELECT notify_status = 'failed' AND notify_attempts = 4 AND notify_next_at IS NULL
                    FROM business_profile.inquiries WHERE id = %1$L)
             AND NOT (pg_temp.as_service(NULL, 'SELECT public.bp_inquiry_notify_due(50)') ? %1$L)$$,
         :'sub3'::jsonb ->> 'id'));
SELECT pg_temp.user_err(:'q1', :Q_MGR, format('SELECT public.bp_inquiry_retry_notify(%L)', :'sub3'::jsonb ->> 'id')) AS retry_mgr \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_retry_notify(%L)', :'sub3'::jsonb ->> 'id')) ->> 'id' AS retry_id \gset
SELECT tests.check('bp inquiries: manual retry by the owner → waiting again (logged); the manager cannot',
  format($$SELECT %4$L LIKE '%%אין הרשאה%%' AND %5$L = %1$L
             AND (SELECT notify_status = 'pending' AND notify_error IS NULL FROM business_profile.inquiries WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = %2$L AND action = 'inquiry.notify_retry'
                          AND details ->> 'id' = %1$L AND actor_id = %3$L)
             AND (pg_temp.as_service(NULL, format('SELECT public.bp_inquiry_notify_claim(%%L)', %1$L)) ->> 'attempt')::int = 5$$,
         :'sub3'::jsonb ->> 'id', :'q1', :Q_OWNER1, :'retry_mgr', :'retry_id'));
SELECT pg_temp.as_service(NULL, format('SELECT to_jsonb(public.bp_inquiry_notify_result(%L, false, %L))', :'sub3'::jsonb ->> 'id', 'x')) IS NULL AS ok \gset
SELECT tests.check('bp inquiries: notifications turned off → a waiting inquiry is skipped at claim time (no e-mail), and retry explains why',
  format($$SELECT pg_temp.as_user(%2$L, %3$L, $q$SELECT public.bp_inquiry_settings_save('owner.notify@example.com', false, 400)$q$) IS NOT NULL
             AND pg_temp.user_err(%2$L, %3$L, format('SELECT public.bp_inquiry_retry_notify(%%L)', %1$L)) LIKE '%%ההתראות במייל כבויות%%'
             AND (pg_temp.as_service(%2$L, pg_temp.submit_sql(gen_random_uuid(), _ip => %4$L)) ->> 'notify')::boolean = false
             AND pg_temp.as_user(%2$L, %3$L, $q$SELECT public.bp_inquiry_settings_save('owner.notify@example.com', true, 400)$q$) IS NOT NULL$$,
         :'sub3'::jsonb ->> 'id', :'q1', :Q_OWNER1, :IP2));
SELECT pg_temp.as_service(:'q1', pg_temp.submit_sql(gen_random_uuid(), _ip => :IP2)) ->> 'id' AS stuck \gset
SELECT pg_temp.as_service(NULL, 'SELECT public.bp_inquiry_notify_due(50)') ? :'stuck' AS due_fresh \gset
UPDATE business_profile.inquiries SET created_at = now() - interval '3 minutes' WHERE id = :'stuck';
SELECT tests.check('bp inquiries: a waiting inquiry that the server never sent (crash) is picked up after 2 minutes, not before',
  format($$SELECT NOT %1$L::boolean AND pg_temp.as_service(NULL, 'SELECT public.bp_inquiry_notify_due(50)') ? %2$L$$,
         :'due_fresh', :'stuck'));

-- ============================================================
-- 5. Deleting and retention
-- ============================================================
SELECT pg_temp.user_err(:'q2', :Q_OWNER2, format('SELECT public.bp_inquiry_delete(%L)', :'sub3'::jsonb ->> 'id')) AS del_other \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_add_note(%L, %L)', :'sub3'::jsonb ->> 'id', 'הערה')) ->> 'id' AS note3 \gset
SELECT pg_temp.as_user(:'q1', :Q_OWNER1, format('SELECT public.bp_inquiry_delete(%L)', :'sub3'::jsonb ->> 'id')) ->> 'id' AS del_id \gset
SELECT tests.check('bp inquiries: the owner deletes an inquiry (its notes with it) — logged without content; another business cannot',
  format($$SELECT %2$L LIKE '%%לא נמצאה%%' AND %3$L = %1$L
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiries WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiry_notes WHERE id = %5$L)
             AND (SELECT details FROM business_profile.audit_log WHERE tenant_id = %4$L AND action = 'inquiry.deleted'
                   ORDER BY id DESC LIMIT 1) = jsonb_build_object('id', %1$L, 'test', false)$$,
         :'sub3'::jsonb ->> 'id', :'del_other', :'del_id', :'q1', :'note3'));
SELECT pg_temp.as_user(:'q2', :Q_OWNER2, 'SELECT public.bp_inquiries_delete_test()') ->> 'deleted' AS del_test \gset
SELECT tests.check('bp inquiries: "delete all test inquiries" removes only test ones of that site',
  format($$SELECT %1$L::int = 1
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiries WHERE tenant_id = %2$L)
             AND EXISTS (SELECT 1 FROM business_profile.inquiries WHERE tenant_id = %3$L)$$,
         :'del_test', :'q2', :'q1'));
-- retention: one inquiry older than the site's 400 days, one just inside; a test inquiry older than 30 days
UPDATE business_profile.inquiries SET created_at = now() - interval '401 days' WHERE id = (:'sub1'::jsonb ->> 'id')::uuid;
UPDATE business_profile.inquiries SET created_at = now() - interval '399 days' WHERE id = (:'sub2'::jsonb ->> 'id')::uuid;
SELECT pg_temp.as_service(:'q2', pg_temp.submit_sql(gen_random_uuid(), _test => true)) ->> 'id' AS test_old \gset
UPDATE business_profile.inquiries SET created_at = now() - interval '31 days' WHERE id = :'test_old';
SELECT pg_temp.as_service(NULL, 'SELECT to_jsonb(public.bp_inquiries_purge())')::int AS purged \gset
SELECT tests.check('bp inquiries: retention — older than the site''s period (and test inquiries after 30 days) are deleted; the rest stay; each site logs a count',
  format($$SELECT %1$s = 2
             AND NOT EXISTS (SELECT 1 FROM business_profile.inquiries WHERE id IN (%2$L, %4$L))
             AND EXISTS (SELECT 1 FROM business_profile.inquiries WHERE id = %3$L)
             AND (SELECT details FROM business_profile.audit_log WHERE tenant_id = %5$L AND action = 'inquiry.purged'
                   ORDER BY id DESC LIMIT 1) = '{"count": 1, "test": 0}'::jsonb
             AND (SELECT details FROM business_profile.audit_log WHERE tenant_id = %6$L AND action = 'inquiry.purged'
                   ORDER BY id DESC LIMIT 1) = '{"count": 0, "test": 1}'::jsonb$$,
         :purged, :'sub1'::jsonb ->> 'id', :'sub2'::jsonb ->> 'id', :'test_old', :'q1', :'q2'));
SELECT tests.check('bp inquiries: deleting the site deletes its inquiries, notes and settings (CASCADE)',
  $$SELECT pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'inquiries_tenant_id_fkey')) LIKE '%ON DELETE CASCADE%'
       AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'inquiry_settings_tenant_id_fkey')) LIKE '%ON DELETE CASCADE%'
       AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'bp_inquiry_notes_inquiry')) LIKE '%ON DELETE CASCADE%'$$);

-- ---------- cleanup ----------
SELECT pg_temp.as_user(NULL, :PLATFORM, $$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('business_profile_enabled', false),
       public.platform_set_flag('business_profile_public', false)])$$) IS NOT NULL AS ok \gset
SET session_replication_role = replica;
DELETE FROM business_profile.inquiry_notes WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM business_profile.inquiries WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM business_profile.inquiry_settings WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.user_roles WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM business_profile.audit_log WHERE tenant_id IN (:'q1', :'q2');
UPDATE business_profile.sites SET live_version_id = NULL WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM business_profile.sites WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM business_profile.site_versions WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.tenant_feature_flags WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.site_settings WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.email_settings WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.platform_audit_log WHERE tenant_id IN (:'q1', :'q2');
DELETE FROM public.tenants WHERE id IN (:'q1', :'q2');
SET session_replication_role = origin;
DELETE FROM auth.users WHERE id IN (:Q_OWNER1, :Q_OWNER2, :Q_MGR);

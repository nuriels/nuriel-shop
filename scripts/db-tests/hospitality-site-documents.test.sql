-- ============================================================
-- Hospitality — site documents, accessibility statement and arrangements (migration 60 —
-- 20261109100000_hosp_site_documents.sql)
--   • structure: the 5 tables closed to the API roles (RLS, restrictive, tenant guard); who may call what;
--   • staff (settings): a draft (new, a stale revision), publish = a new fixed version (not with unfilled
--     details, not a stale draft), the site shows only the published version, a published version never
--     changes (only the review mark), unpublish keeps the versions; another business and a visitor refused;
--   • the business details for the documents: the coordinator only when the business marks it must have one;
--   • accessibility arrangements (catalog): only with the owner's confirmation, only known items and answers,
--     nothing "accessible" by default, another business's property refused;
--   • booking on the site: the shown versions are accepted in the same transaction as the booking (unit,
--     several rooms, package), with the kind of sale (distance) and service; an outdated or missing document
--     → refused and no booking; the same request again — no second record; the staff booking page lists them.
-- ============================================================
\set OWNER60 '''a0000000-0000-0000-0000-000000060a01'''
\set OTHER60 '''a0000000-0000-0000-0000-000000060a02'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.60')::text, true);
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
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.60')::text, true);
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
-- a booking request through the documents wrapper, with the terms quoted now
CREATE OR REPLACE FUNCTION pg_temp.req_sql(_site text, _unit text, _in date, _out date, _email text, _key text,
                                           _docs jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE q jsonb := pg_temp.call(_site, NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', _unit, _in, _out));
BEGIN
  RETURN format('SELECT hospitality.request_booking_with_documents(_documents => %L, _unit_id => %L, _check_in => %L,
                   _check_out => %L, _full_name => %L, _email => %L, _phone => %L, _idempotency_key => %L,
                   _policy_accepted => true, _policy_hash => %L)',
                _docs, _unit, _in, _out, 'אורחת מסמכים', _email, '0542630460', _key, q ->> 'policy_hash');
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.shown(_site text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', e ->> 'kind', 'version', (e ->> 'version')::integer)), '[]'::jsonb)
    FROM jsonb_array_elements(pg_temp.call(_site, NULL, 'SELECT hospitality.public_site_documents()')) e;
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000060a01', 'm60.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000060a02', 'm60.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m60_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m60-docs', 'נופי המסמכים', 'm60.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm60.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m60-other', 'אתר שכן', 'm60.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm60.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_frontend_enabled', true),
       public.platform_set_flag('hospitality_booking_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L),
       public.platform_set_flag('hospitality_frontend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_booking_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER60,
  $q$SELECT hospitality.property_create('{"name": "נופי המסמכים", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS sp \gset
SELECT pg_temp.call(:'st', :OWNER60, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר האלה", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS u1 \gset
SELECT pg_temp.call(:'st', :OWNER60, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר התאנה", "unit_type": "suite", "capacity": 4}')$q$, :'sp')) ->> 'id' AS u2 \gset
SELECT pg_temp.call(:'so', :OTHER60,
  $q$SELECT hospitality.property_create('{"name": "אתר שכן", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS op \gset
UPDATE hospitality.units SET base_price = 600 WHERE tenant_id = :'st';

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: the 5 tables — RLS with the two restrictive policies, the tenant guard, no access for the API roles',
  $$SELECT bool_and(c.relrowsecurity
                    AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND NOT p.polpermissive
                          AND p.polname IN ('tenant_isolation', 'backend_enabled')) = 2
                    AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polpermissive)
                    AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
                    AND NOT (SELECT bool_or(has_table_privilege(r, c.oid, p))
                               FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                                    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p))
       AND count(*) = 5
     FROM pg_class c
    WHERE c.oid IN ('hospitality.site_documents'::regclass, 'hospitality.site_document_versions'::regclass,
                    'hospitality.booking_document_acceptances'::regclass, 'hospitality.property_accessibility'::regclass,
                    'hospitality.site_legal_profile'::regclass)$$);
SELECT tests.check('structure: the documents on the site for everyone; the booking wrappers for the app server only; management for staff; the helpers for nobody',
  $$SELECT has_function_privilege('anon', 'hospitality.public_site_documents()', 'EXECUTE')
       AND has_function_privilege('anon', 'hospitality.public_site_document(text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.request_booking_group_with_documents(jsonb,jsonb,date,date,text,text,text,text,boolean,text,boolean,text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_package_with_documents(jsonb,uuid,date,text,text,text,text,boolean,text,integer,integer,text,boolean,text)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.request_booking_type_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text,uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.request_booking_type_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.site_documents_view()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.site_document_publish(text,text,text,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.property_accessibility_save(uuid,jsonb,boolean,text,text,text,text,integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._documents_accept(uuid,uuid[],jsonb,text)', 'EXECUTE')
       AND NOT has_function_privilege('service_role', 'hospitality._documents_for_booking(uuid,jsonb,text)', 'EXECUTE')$$);
SELECT tests.check('structure: no business has documents, arrangements or acceptances yet (nothing filled in automatically)',
  $$SELECT NOT EXISTS (SELECT 1 FROM hospitality.site_documents) AND NOT EXISTS (SELECT 1 FROM hospitality.property_accessibility)
       AND NOT EXISTS (SELECT 1 FROM hospitality.booking_document_acceptances)$$);

-- ============================================================
-- 2. Staff: drafts and publishing
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_save('booking_terms', 'תנאי הזמנה',
  '## כללי' || chr(10) || 'ההזמנה אצל {{business_name}}.', NULL)$q$) AS s1 \gset
SELECT tests.check('a new draft: revision 1, the template kept as written (with its variables); the action log has it',
  format($$SELECT (%1$L::jsonb ->> 'revision')::integer = 1
             AND (SELECT draft_body LIKE '%%{{business_name}}%%' AND published_version IS NULL
                    FROM hospitality.site_documents WHERE tenant_id = %2$L AND kind = 'booking_terms')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'documents.saved')$$,
         :'s1', :'st'));
SELECT tests.check('a draft: an unknown kind, a short title, a stale revision — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_save('vip_terms', 'תנאים', 'x')$s$) = 'סוג המסמך לא תקין'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_save('privacy', 'א', 'x')$s$) LIKE 'כותרת המסמך%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_save('booking_terms', 'תנאי הזמנה', 'x', 7)$s$) LIKE 'המסמך השתנה בינתיים%%'$$,
         :'st', :OWNER60));
SELECT tests.check('a visitor, and the owner of another business, cannot see or change this business''s documents',
  format($$SELECT pg_temp.err_of(%1$L, NULL, 'SELECT hospitality.site_documents_view()') IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.site_documents_view()') IS NOT NULL
             AND pg_temp.call(%3$L, %2$L, 'SELECT hospitality.site_documents_view()') -> 'documents' = '[]'::jsonb$$,
         :'st', :OTHER60, :'so'));
SELECT tests.check('publish: unfilled details ({{…}} / [[…]]), a stale draft revision, a document never saved — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_publish('booking_terms', 'תנאי הזמנה',
                     'ההזמנה אצל {{business_name}} — מסמך לדוגמה ארוך מספיק.', 1)$s$) LIKE 'במסמך יש פרטים שעוד לא הושלמו%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_publish('booking_terms', 'תנאי הזמנה',
                     'ההזמנה אצל [[להשלמה: שם]] — מסמך לדוגמה ארוך מספיק.', 1)$s$) LIKE 'במסמך יש פרטים שעוד לא הושלמו%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_publish('booking_terms', 'תנאי הזמנה',
                     'ההזמנה אצל נופי המסמכים — מסמך לדוגמה ארוך מספיק.', 5)$s$) LIKE 'המסמך השתנה בינתיים%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_publish('privacy', 'פרטיות',
                     'מדיניות הפרטיות של נופי המסמכים — טקסט ארוך מספיק.', 1)$s$) LIKE 'שמרו את המסמך%%'$$,
         :'st', :OWNER60));
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_publish('booking_terms', 'תנאי הזמנה',
  '## כללי' || chr(10) || 'ההזמנה אצל נופי המסמכים, בכפוף לתנאים האלה.', 1)$q$) AS pub1 \gset
SELECT tests.check('publish: version 1 — the full text, its sha-256, who and when; the site lists it and shows the text',
  format($$SELECT (%1$L::jsonb ->> 'version')::integer = 1
             AND (SELECT v.body_hash = encode(sha256(convert_to(v.body, 'UTF8')), 'hex') AND v.published_by = %4$L
                    FROM hospitality.site_document_versions v WHERE v.tenant_id = %2$L AND v.kind = 'booking_terms')
             AND pg_temp.shown(%2$L) = '[{"kind": "booking_terms", "version": 1}]'::jsonb
             AND pg_temp.call(%2$L, NULL, $s$SELECT hospitality.public_site_document('booking_terms')$s$) ->> 'body'
                 LIKE '%%ההזמנה אצל נופי המסמכים%%'
             AND pg_temp.call(%3$L, NULL, 'SELECT hospitality.public_site_documents()') = '[]'::jsonb$$,
         :'pub1', :'st', :'so', :OWNER60));
SELECT tests.check('a published version never changes (only the review mark); a review in the future is refused; the mark is saved',
  format($$SELECT (SELECT count(*) FROM hospitality.site_document_versions WHERE tenant_id = %1$L) = 1
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.site_document_review('booking_terms', 1, 'lawyer', 'עו"ד ישראלי', %%L)$s$, pg_temp.d(3))) LIKE 'מי בדק ומתי%%'
             AND pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.site_document_review('booking_terms', 1, 'lawyer', 'עו"ד ישראלי', %%L)$s$, pg_temp.d(-1))) ->> 'review_kind' = 'lawyer'$$,
         :'st', :OWNER60));
DO $$
BEGIN
  UPDATE hospitality.site_document_versions SET body = body || ' שינוי' WHERE kind = 'booking_terms';
  RAISE EXCEPTION 'the update went through';
EXCEPTION WHEN check_violation THEN
  NULL;  -- expected: the frozen trigger
END $$;
SELECT tests.check('the frozen trigger: the published text is the same after an attempt to change it',
  format($$SELECT body NOT LIKE '%% שינוי' FROM hospitality.site_document_versions WHERE tenant_id = %L AND kind = 'booking_terms'$$, :'st'));
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_save('booking_terms', 'תנאי הזמנה',
  'ההזמנה אצל {{business_name}} — עדכון.', 1)$q$) ->> 'revision' AS rev2 \gset
SELECT pg_temp.call(:'st', :OWNER60, format($q$SELECT hospitality.site_document_publish('booking_terms', 'תנאי הזמנה',
  'ההזמנה אצל נופי המסמכים — עדכון של התנאים.', %s)$q$, :'rev2')) ->> 'version' AS v2 \gset
SELECT tests.check('publish again: version 2 is the one on the site; version 1 stays (with its review mark)',
  format($$SELECT %1$L::integer = 2 AND pg_temp.shown(%2$L) = '[{"kind": "booking_terms", "version": 2}]'::jsonb
             AND (SELECT count(*) FROM hospitality.site_document_versions WHERE tenant_id = %2$L AND kind = 'booking_terms') = 2
             AND (SELECT review_kind FROM hospitality.site_document_versions WHERE tenant_id = %2$L AND version = 1) = 'lawyer'$$,
         :'v2', :'st'));
-- the other documents a booking needs: privacy and cancellation
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_save('privacy', 'מדיניות פרטיות', 'טיוטה')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_publish('privacy', 'מדיניות פרטיות',
  'מדיניות הפרטיות של נופי המסמכים — מה נאסף ולמה.', 1)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_save('event_terms', 'תנאי אירועים', 'טיוטה')$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_publish('event_terms', 'תנאי אירועים',
  'תנאי השכרה לאירועים בנופי המסמכים — לפי הסכם נפרד.', 1)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_document_unpublish('event_terms')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('unpublish: off the site, the version kept; unpublishing again — "not on the site"',
  format($$SELECT pg_temp.call(%1$L, NULL, $s$SELECT hospitality.public_site_document('event_terms')$s$) IS NULL
             AND EXISTS (SELECT 1 FROM hospitality.site_document_versions WHERE tenant_id = %1$L AND kind = 'event_terms')
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_document_unpublish('event_terms')$s$) = 'המסמך לא מוצג באתר'$$,
         :'st', :OWNER60));

-- ============================================================
-- 3. The business details for the documents
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER60, $q$SELECT hospitality.site_legal_profile_save('{"legal_name": "נופי המסמכים בע\"מ",
  "registration_id": "515555555", "a11y_contact_name": "דנה", "a11y_contact_email": "A11y@Example.com",
  "coordinator_required": false, "coordinator_name": "לא אמור להישמר"}')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('the details: saved; the e-mail in lower case; the coordinator only when the business must appoint one',
  format($$SELECT p.legal_name = 'נופי המסמכים בע"מ' AND p.a11y_contact_email = 'a11y@example.com'
             AND NOT p.coordinator_required AND p.coordinator_name IS NULL
             FROM hospitality.site_legal_profile p WHERE p.tenant_id = %L$$, :'st'));
SELECT tests.check('the details: a bad e-mail is refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.site_legal_profile_save('{"a11y_contact_email": "not-an-email"}')$s$)
             LIKE '%%כתובת אימייל לא תקינה'$$, :'st', :OWNER60));

-- ============================================================
-- 4. Accessibility arrangements — only what the owner gave and confirmed
-- ============================================================
SELECT tests.check('arrangements: without the owner''s confirmation, an unknown item, a bad answer — refused; nothing saved',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.property_accessibility_save(%%L, '{"parking": {"answer": "yes"}}', false)$s$, %3$L)) LIKE 'יש לאשר%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.property_accessibility_save(%%L, '{"elevator": {"answer": "yes"}}', true)$s$, %3$L)) = 'פריט לא מוכר בהסדרי הנגישות'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.property_accessibility_save(%%L, '{"parking": {"answer": "maybe"}}', true)$s$, %3$L)) = 'תשובה לא תקינה בהסדרי הנגישות'
             AND NOT EXISTS (SELECT 1 FROM hospitality.property_accessibility WHERE tenant_id = %1$L)$$,
         :'st', :OWNER60, :'sp'));
SELECT pg_temp.call(:'st', :OWNER60, format($q$SELECT hospitality.property_accessibility_save(%L,
  '{"parking": {"answer": "yes", "details": "חניה מסומנת ליד הכניסה"}, "unit": {"answer": "no"}, "restroom": {}}', true,
  'כלבי נחייה מתקבלים בברכה', 'דנה', '050-1112222', 'dana@example.com')$q$, :'sp')) AS acc \gset
SELECT tests.check('arrangements: saved with the confirmation (who, when); only the answered items — an unanswered one is not "no"',
  format($$SELECT (SELECT items = '{"parking": {"answer": "yes", "details": "חניה מסומנת ליד הכניסה"}, "unit": {"answer": "no"}}'::jsonb
                      AND confirmed_by = %3$L AND additional = 'כלבי נחייה מתקבלים בברכה'
                     FROM hospitality.property_accessibility WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'accessibility.confirmed')$$,
         :'st', :'acc', :OWNER60));
SELECT tests.check('arrangements: another business''s property — not found; the view shows this property''s confirmed data',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.property_accessibility_save(%%L, '{}', true)$s$, %3$L)) = 'המתחם לא נמצא'
             AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.property_accessibility_view(%%L)', %4$L)) -> 'items' ? 'parking'$$,
         :'st', :OWNER60, :'op', :'sp'));

-- ============================================================
-- 5. Booking on the site: the documents accepted with the booking
-- ============================================================
SELECT pg_temp.shown(:'st') AS docs \gset
SELECT tests.check('the site shows booking terms v2 and privacy v1 (the event terms are off)',
  format($$SELECT %L::jsonb = '[{"kind": "booking_terms", "version": 2}, {"kind": "privacy", "version": 1}]'::jsonb$$, :'docs'));
SELECT tests.check('an outdated version, or a missing document — refused, and no booking was made',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.req_sql(%1$L, %2$L, pg_temp.d(20), pg_temp.d(22), 'old@example.com', 'm60-key-old-01',
                     '[{"kind": "booking_terms", "version": 1}, {"kind": "privacy", "version": 1}]')) LIKE 'מסמכי האתר עודכנו%%'
             AND pg_temp.srv_err(%1$L, pg_temp.req_sql(%1$L, %2$L, pg_temp.d(20), pg_temp.d(22), 'old@example.com', 'm60-key-old-02',
                     '[{"kind": "booking_terms", "version": 2}]')) LIKE 'מסמכי האתר עודכנו%%'
             AND NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE tenant_id = %1$L)$$,
         :'st', :'u1'));
SELECT pg_temp.srv(:'st', pg_temp.req_sql(:'st', :'u1', pg_temp.d(20), pg_temp.d(22), 'guest@example.com', 'm60-key-ok-001', :'docs')) AS r1 \gset
SELECT (:'r1'::jsonb) ->> 'booking_id' AS b1 \gset
SELECT tests.check('a booking with the shown versions: the booking, and for each document — the version, its hash, the time, a distance sale of accommodation; a line in the booking log',
  format($$SELECT (SELECT count(*) = 2
                        AND bool_and(x.sale_type = 'distance' AND x.service = 'accommodation'
                                     AND x.body_hash = v.body_hash AND x.version = v.version AND x.accepted_at IS NOT NULL)
                        AND array_agg(x.kind || ':' || x.version ORDER BY x.kind) = ARRAY['booking_terms:2', 'privacy:1']
                     FROM hospitality.booking_document_acceptances x
                     JOIN hospitality.site_document_versions v ON v.id = x.version_id
                    WHERE x.booking_id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = %1$L AND e.kind = 'documents_accepted'
                            AND e.changes -> 'documents' @> '[{"kind": "privacy", "version": 1}]'::jsonb)$$,
         :'b1'));
SELECT pg_temp.srv(:'st', pg_temp.req_sql(:'st', :'u1', pg_temp.d(20), pg_temp.d(22), 'guest@example.com', 'm60-key-ok-001', :'docs')) AS r1b \gset
SELECT tests.check('the same request again: the same booking, no second record',
  format($$SELECT %1$L::jsonb ->> 'booking_id' = %2$L AND (%1$L::jsonb ->> 'duplicate')::boolean
             AND (SELECT count(*) FROM hospitality.booking_document_acceptances WHERE booking_id = %2$L) = 2
             AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = %2$L AND kind = 'documents_accepted') = 1$$,
         :'r1b', :'b1'));
SELECT tests.check('the staff booking page lists the accepted documents (titles, versions); another business is refused',
  format($$SELECT (SELECT array_agg(e ->> 'title' || ' v' || (e ->> 'version')) FROM jsonb_array_elements(
                     pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_booking_documents(%%L)', %3$L))) e)
                  = ARRAY['תנאי הזמנה v2', 'מדיניות פרטיות v1']
             AND pg_temp.err_of(%4$L, %5$L, format('SELECT hospitality.staff_booking_documents(%%L)', %3$L)) = 'ההזמנה לא נמצאה'$$,
         :'st', :OWNER60, :'b1', :'so', :OTHER60));
-- several rooms in one request: each booking gets the record
SELECT pg_temp.srv(:'st', format($q$SELECT hospitality.request_booking_group_with_documents(_documents => %L, _rooms => %L,
  _check_in => %L, _check_out => %L, _full_name => 'אורח קבוצה', _email => 'group@example.com', _phone => '0542630461',
  _idempotency_key => 'm60-key-group1', _policy_accepted => true)$q$,
  :'docs',
  jsonb_build_array(
    jsonb_build_object('unit_id', :'u1', 'adults', 2, 'children', 0, 'policy_hash',
                       pg_temp.call(:'st', NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', :'u1', pg_temp.d(40), pg_temp.d(42))) ->> 'policy_hash'),
    jsonb_build_object('unit_id', :'u2', 'adults', 2, 'children', 0, 'policy_hash',
                       pg_temp.call(:'st', NULL, format('SELECT hospitality.quote(%L, %L, %L, 2, 0)', :'u2', pg_temp.d(40), pg_temp.d(42))) ->> 'policy_hash')),
  pg_temp.d(40), pg_temp.d(42))) AS g1 \gset
SELECT tests.check('several rooms: both bookings of the group have both documents',
  format($$SELECT (SELECT count(*) FROM hospitality.booking_document_acceptances x
                     JOIN hospitality.bookings b ON b.id = x.booking_id
                    WHERE b.group_id = (%1$L::jsonb ->> 'group_id')::uuid) = 4$$, :'g1'));
-- a package
SELECT pg_temp.call(:'st', :OWNER60, format($q$SELECT hospitality.package_save(_id => NULL, _unit_id => %L, _kind => 'special',
  _name => 'חבילת מסמכים', _nights => 2, _price => 1500, _max_guests => 2)$q$, :'u2')) ->> 'id' AS pk \gset
SELECT pg_temp.call(:'st', :OWNER60, format('SELECT to_jsonb(hospitality.package_set_active(%L, true))', :'pk')) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', format($q$SELECT hospitality.request_booking_package_with_documents(_documents => %L, _package_id => %L,
  _check_in => %L, _full_name => 'כלה', _email => 'bride@example.com', _phone => '0542630462',
  _idempotency_key => 'm60-key-pkg-01', _policy_accepted => true, _policy_hash => %L)$q$,
  :'docs', :'pk', pg_temp.d(60),
  pg_temp.srv(:'st', format('SELECT hospitality.package_quote(%L, %L, 2, 0)', :'pk', pg_temp.d(60))) ->> 'policy_hash')) ->> 'booking_id' AS bp \gset
SELECT tests.check('a package booking: the documents accepted with it',
  format($$SELECT (SELECT count(*) FROM hospitality.booking_document_acceptances WHERE booking_id = %L) = 2$$, :'bp'));
SELECT tests.check('the documents view: the acceptances counted per version (the evidence stays with the version)',
  format($$SELECT (SELECT (e ->> 'acceptances')::integer FROM jsonb_array_elements(
                     pg_temp.call(%1$L, %2$L, 'SELECT hospitality.site_documents_view()') -> 'versions') e
                    WHERE e ->> 'kind' = 'privacy' AND (e ->> 'version')::integer = 1) = 4$$,
         :'st', :OWNER60));

-- ---------- cleanup ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m60_flags m WHERE f.key = m.key;
DROP TABLE m60_flags;

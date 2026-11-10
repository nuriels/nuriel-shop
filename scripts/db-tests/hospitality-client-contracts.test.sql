-- ============================================================
-- Hospitality — client contracts for digital signing (migration 64 — 20261111120000_hosp_client_contracts.sql)
--   • structure: the tables closed to the API roles; the templates never change; a signed contract never
--     changes and is never deleted; the history is append-only; the private bucket (PDF only, no policy);
--   • access: the new "contracts" permission — the owner always, a manager only when the owner grants it;
--   • the gate: before the legal approval (flag) — preview only, no send; and the owner confirms the terms;
--   • the right contract for the right booking: lodging → hosting, event → pool compound (also in the table);
--   • sending: the link only as a hash, made by the server; a failed email does not mark "sent";
--   • signing: once (the link dies), only after "read and agree", a valid ID, a real signature (no free SVG);
--     the signed text with its sha-256; the PDF recorded once; a corrected contract supersedes the old one
--     only when it is signed, and the old one stays in the archive;
--   • the customer's own area lists only that customer's signed documents; another business sees nothing.
-- ============================================================
\set OWNER64 '''a0000000-0000-0000-0000-000000064a01'''
\set MGR64 '''a0000000-0000-0000-0000-000000064a02'''
\set OTHER64 '''a0000000-0000-0000-0000-000000064a03'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.64')::text, true);
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
CREATE OR REPLACE FUNCTION pg_temp.h(_s text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex') $$;
-- the signature the customer drew (three short strokes)
CREATE OR REPLACE FUNCTION pg_temp.sig() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"kind": "drawn", "paths": ["M10,20 L40,60 L80,30", "M100,50 L150,90", "M200,40 L260,70 L300,20"]}'::jsonb $$;
CREATE OR REPLACE FUNCTION pg_temp.sign_sql(_token text, _fields jsonb, _sig jsonb, _agreed boolean) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT hospitality.contract_sign(%L, %L, %L, %L, %L, %L)', pg_temp.h(_token), _fields, _sig, _agreed,
                '198.51.100.64', 'Mozilla/5.0 db-test');
$$;
-- the server's send: a new link (only its hash), then the result of the email
CREATE OR REPLACE FUNCTION pg_temp.send(_site text, _id text, _token text, _ok boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.contract_issue_link(%L, %L, %L, %L)', _site, _id, pg_temp.h(_token),
                                   'a0000000-0000-0000-0000-000000064a01'))
         || pg_temp.srv(_site, format('SELECT hospitality.contract_send_result(%L, %L, %L, %L, %L)', _site, _id, _ok,
                                      CASE WHEN _ok THEN NULL ELSE 'smtp 550' END, 'a0000000-0000-0000-0000-000000064a01'));
$$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000064a01', 'm64.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000064a02', 'm64.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000064a03', 'm64.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m64_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m64-contracts', 'נופי החוזים', 'm64.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm64.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m64-other', 'אתר שכן לחוזים', 'm64.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm64.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR64, 'm64.manager@test.local', 'm64_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
UPDATE hospitality.settings SET business_name = 'נופי החוזים', contact_phone = '0503822300', contact_email = 'nofi@example.com',
       address = 'מושב ישעי 22', check_in_time = '14:00', check_out_time = '11:00'
 WHERE tenant_id = :'st';
SELECT pg_temp.call(:'st', :OWNER64,
  $q$SELECT hospitality.property_create('{"name": "מתחם החוזים", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS p1 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר אדיר", "unit_type": "suite", "capacity": 5}')$q$, :'p1')) ->> 'id' AS u1 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר מוריה", "unit_type": "suite", "capacity": 5}')$q$, :'p1')) ->> 'id' AS u2 \gset
UPDATE hospitality.units SET base_price = 700, is_active = true WHERE tenant_id = :'st';
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'רונית לינה', _phone => '0546400001', _email => 'ronit@example.com',
   _terms_explained => true, _total_override => 1400)$q$, :'u1', pg_temp.d(30), pg_temp.d(32))) ->> 'booking_id' AS bk \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'אבי שני', _phone => '0546400002', _email => 'avi@example.com',
   _terms_explained => true, _total_override => 900)$q$, :'u2', pg_temp.d(40), pg_temp.d(41))) ->> 'booking_id' AS bk2 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'bridal_shower', 'event_date', pg_temp.d(50), 'start_time', '10:00', 'end_time', '17:00',
  'participants', 40, 'price', 3500, 'customer', jsonb_build_object('full_name', 'שירה כלה', 'phone', '0546400003',
                                                                    'email', 'shira@example.com')))) ->> 'id' AS ev \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: contracts, their history and the templates — RLS, no access for the API roles; the business tables with the tenant guard',
  $$SELECT bool_and(c.relrowsecurity AND NOT (SELECT bool_or(has_table_privilege(r, c.oid, p))
                               FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                                    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p))
       AND count(*) = 3
       AND (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'tenant_guard'
             AND t.tgrelid IN ('hospitality.client_contracts'::regclass, 'hospitality.client_contract_log'::regclass)) = 2
     FROM pg_class c
    WHERE c.oid IN ('hospitality.client_contracts'::regclass, 'hospitality.client_contract_log'::regclass,
                    'hospitality.contract_templates'::regclass)$$);
SELECT tests.check('structure: staff functions for signed-in staff; the link, the result, the PDF, the customer''s open / sign and "my documents" — the app server only; helpers for nobody',
  $$SELECT has_function_privilege('authenticated', 'hospitality.contract_create(text,uuid,uuid,uuid,jsonb,jsonb,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contract_preview(text,uuid,uuid,uuid,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.contract_issue_link(uuid,uuid,text,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.contract_send_result(uuid,uuid,boolean,text,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.contract_pdf_stored(uuid,uuid,text,text,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contract_open(text,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.contract_sign(text,jsonb,jsonb,boolean,text,text)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.contract_sign(text,jsonb,jsonb,boolean,text,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.guest_area_documents(text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._contract_data(uuid,text,uuid,uuid,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('service_role', 'hospitality._contract_render(text,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.client_contracts_guard()', 'EXECUTE')$$);
SELECT tests.check('structure: the two templates from the source contracts; the contracts flag registered and off; a private bucket for PDF only',
  $$SELECT (SELECT count(*) FROM hospitality.contract_templates WHERE key IN ('hosting', 'pool_event')) = 2
       AND (SELECT title FROM hospitality.contract_templates WHERE key = 'hosting') = 'הסכם הזמנת אירוח ושכירות לטווח קצר'
       AND (SELECT title FROM hospitality.contract_templates WHERE key = 'pool_event') = 'הסכם שכירות והזמנת אירוח - מתחם הבריכה לאירועים'
       AND (SELECT body LIKE '%אין שירותי מציל בבריכת השחייה!%' AND body LIKE '%עד {{max_event_guests}} אורחים לכל היותר%'
              FROM hospitality.contract_templates WHERE key = 'pool_event')
       AND NOT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_contracts_enabled')
       AND (to_regclass('storage.buckets') IS NULL OR (SELECT NOT public AND allowed_mime_types = ARRAY['application/pdf']
                                                         FROM storage.buckets WHERE id = 'hosp-contracts'))$$);
DO $$
BEGIN
  BEGIN
    UPDATE hospitality.contract_templates SET title = 'שונה' WHERE key = 'hosting';
    INSERT INTO tests.results (name, ok, detail) VALUES ('a contract template never changes', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a contract template never changes', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 2. Access: the "contracts" permission
-- ============================================================
SELECT tests.check('access: the owner has "contracts"; a manager — not until the owner grants it; a manager cannot grant; revoke works; in the action log',
  format($$SELECT pg_temp.err_of(%1$L, %3$L, 'SELECT hospitality.contracts_view()') IS NOT NULL
             AND pg_temp.call(%1$L, %2$L, 'SELECT hospitality.contracts_view()') ? 'enabled'
             AND pg_temp.err_of(%1$L, %3$L, format('SELECT hospitality.team_set_contracts(%%L, true)', %3$L)) IS NOT NULL$$,
         :'st', :OWNER64, :MGR64));
SELECT pg_temp.call(:'st', :OWNER64, format('SELECT hospitality.team_set_contracts(%L, true)', :MGR64)) AS g1 \gset
SELECT tests.check('access: granted — the manager sees the contracts; the team list shows it',
  format($$SELECT pg_temp.call(%1$L, %2$L, 'SELECT hospitality.contracts_view()') ? 'enabled'
             AND (SELECT (m ->> 'contracts')::boolean FROM jsonb_array_elements(%3$L::jsonb -> 'members') m
                   WHERE m ->> 'user_id' = %2$L)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'team.contracts_granted')$$,
         :'st', :MGR64, :'g1'));

-- ============================================================
-- 3. The gate: legal approval (flag) and the owner's confirmed terms
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER64, $q$SELECT hospitality.business_terms_save('{"representative_name": "אמציה בשארי",
  "business_tax_id": "58731621"}', 0)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_preview('pool_event', NULL, %L)$q$, :'ev')) AS pv \gset
SELECT tests.check('gate: before the legal approval — the full preview (with the business details), marked pending; sending refused',
  format($$SELECT (%1$L::jsonb ->> 'legal_pending')::boolean AND NOT (%1$L::jsonb ->> 'can_send')::boolean
             AND %1$L::jsonb ->> 'body' LIKE '%%נציג מורשה: אמציה בשארי%%' AND %1$L::jsonb ->> 'body' LIKE '%%מהות האירוע%%מסיבת כלה%%'
             AND %1$L::jsonb ->> 'body' LIKE '%%תעודת זהות / ח.פ: ________%%'
             AND pg_temp.err_of(%2$L, %3$L, format($s$SELECT hospitality.contract_create('pool_event', NULL, %%L)$s$, %4$L))
                 LIKE 'החוזים ממתינים לאישור משפטי%%'$$,
         :'pv', :'st', :OWNER64, :'ev'));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_contracts_enabled', true),
       public.platform_set_flag('hospitality_contracts_enabled', true, %L)])$$, :'st')) IS NOT NULL AS ok \gset
SELECT tests.check('gate: approved, but the owner has not confirmed the terms — refused; another business (flag off there) — refused',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.contract_create('pool_event', NULL, %%L)$s$, %3$L))
                    LIKE 'בעל העסק צריך לאשר%%'$$,
         :'st', :OWNER64, :'ev'));
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.business_terms_save(%L, 1)$q$,
  jsonb_build_object('unit_lines', jsonb_build_array(
    jsonb_build_object('unit_id', :'u1', 'name', 'אדיר', 'description', 'מיועד לזוג ועד 3 ילדים'),
    jsonb_build_object('name', 'מוריה', 'description', 'מיועד לזוג ועד 3 ילדים'),
    jsonb_build_object('name', 'גן עדן', 'description', 'מיועד לזוג בלבד'))))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER64, 'SELECT hospitality.business_terms_confirm(2)') IS NOT NULL AS ok \gset

-- ============================================================
-- 4. The right contract for the right booking
-- ============================================================
SELECT tests.check('the right contract: hosting for an event, pool compound for a lodging booking, none / both — refused (functions and the table)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.contract_create('hosting', NULL, %%L)$s$, %3$L)) LIKE 'חוזה אירוח — רק להזמנת לינה%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.contract_create('pool_event', %%L, NULL)$s$, %4$L)) LIKE 'חוזה מתחם הבריכה — רק לאירוע%%'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.contract_create('hosting', %%L, %%L)$s$, %4$L, %3$L)) LIKE 'חוזה אירוח — רק להזמנת לינה%%'
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.contract_create('lease', NULL, NULL)$s$) = 'סוג החוזה לא מוכר'$$,
         :'st', :OWNER64, :'ev', :'bk'));
DO $$
DECLARE _t uuid := (SELECT id FROM public.tenants WHERE slug = 'm64-contracts');
BEGIN
  BEGIN
    INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, event_id, signer_name, signer_email, data)
    SELECT _t, 9999, 'hosting', 1, e.id, 'בדיקה', 'x@example.com', '{}'::jsonb FROM hospitality.events e WHERE e.tenant_id = _t LIMIT 1;
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses a hosting contract on an event', false, 'inserted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table itself refuses a hosting contract on an event', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 5. Create and send
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL, NULL, NULL, '{"event_fee": null}')$q$, :'bk')) AS c1 \gset
SELECT tests.check('create (lodging): #1001, a draft (no link yet), the signer from the booking; the values frozen — the units, the booked one marked, nights, price',
  format($$SELECT (%1$L::jsonb ->> 'number')::int = 1001 AND %1$L::jsonb ->> 'status' = 'draft' AND %1$L::jsonb ->> 'kind' = 'hosting'
             AND %1$L::jsonb ->> 'signer_email' = 'ronit@example.com' AND %1$L::jsonb ->> 'booking_type' = 'hosting'
             AND (SELECT token_hash IS NULL AND data ->> 'units_recital' = '3 צימרים ("אדיר", "מוריה" ו"גן עדן")'
                         AND data ->> 'units_selected' = '☒ אדיר / ☐ מוריה / ☐ גן עדן / ☐ כל המתחם'
                         AND data ->> 'nights' = '2' AND data ->> 'price' = '1,400' AND data ->> 'compound_address' = 'מושב ישעי 22'
                         AND data -> 'unit_lines' -> 2 #>> '{}' = 'צימר גן עדן: מיועד לזוג בלבד.'
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND pg_temp.err_of(%2$L, %3$L, format($s$SELECT hospitality.contract_create('hosting', %%L, NULL)$s$, %4$L))
                 LIKE 'כבר יש חוזה פתוח%%'$$,
         :'c1', :'st', :OWNER64, :'bk'));
SELECT pg_temp.send(:'st', (:'c1'::jsonb ->> 'id'), 'tok-c1-first', false) AS f1 \gset
SELECT tests.check('send: the email failed — NOT marked sent, the link dropped (it was never delivered), the error kept, in the log and the action log',
  format($$SELECT (SELECT status = 'draft' AND token_hash IS NULL AND send_error = 'smtp 550' AND sent_at IS NULL AND send_count = 0
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = %1$L AND action = 'send_failed')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'contracts.send_failed')$$,
         (:'c1'::jsonb ->> 'id'), :'st'));
SELECT pg_temp.send(:'st', (:'c1'::jsonb ->> 'id'), 'tok-c1-second', true) AS s1 \gset
SELECT tests.check('send: the email went — "sent", only the link''s sha-256 stored, valid 14 days; the old link no longer works',
  format($$SELECT (SELECT status = 'sent' AND token_hash = pg_temp.h('tok-c1-second') AND send_count = 1 AND send_error IS NULL
                          AND token_expires_at BETWEEN now() + interval '13 days' AND now() + interval '15 days'
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contracts WHERE token_hash = pg_temp.h('tok-c1-first'))
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contracts c, jsonb_each_text(to_jsonb(c)) e
                              WHERE c.id = %1$L AND e.value LIKE '%%tok-c1-second%%')$$,
         (:'c1'::jsonb ->> 'id')));

-- ============================================================
-- 6. The customer: open and sign
-- ============================================================
-- (each call with a side effect in its own statement: inside one expression PostgreSQL may run the sub-selects first)
SELECT pg_temp.srv_err(:'so', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c1-second'))) AS open_other \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_open(%L, %L)', pg_temp.h('tok-c1-second'), '198.51.100.64')) AS op1 \gset
SELECT tests.check('open: on another business''s site the link does not work; on this site — the full text, the blanks to fill; marked viewed',
  format($$SELECT %1$L IS NOT NULL AND %2$L::jsonb ->> 'body' LIKE '%%תעודת זהות: ________%%'
             AND (%2$L::jsonb ->> 'needs_deposit_method')::boolean
             AND (SELECT status = 'viewed' AND viewed_at IS NOT NULL FROM hospitality.client_contracts WHERE id = %3$L)
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = %3$L AND action = 'viewed' AND ip = '198.51.100.64')
             AND pg_temp.srv_err(%4$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('nope'))) LIKE 'הקישור לחתימה לא תקין%%'$$,
         :'open_other', :'op1', (:'c1'::jsonb ->> 'id'), :'st'));
SELECT tests.check('sign: without "read and agree", a bad ID number, no address, no deposit choice, a free-form SVG, one dot — refused; still unsigned',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי", "deposit_method": "card"}', pg_temp.sig(), false)) LIKE 'יש לאשר שקראתם%%'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456789", "address": "רחוב הגפן 3, ישעי", "deposit_method": "card"}', pg_temp.sig(), true)) LIKE 'מספר תעודת הזהות%%'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "deposit_method": "card"}', pg_temp.sig(), true)) LIKE 'יש למלא את כתובת המגורים%%'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי"}', pg_temp.sig(), true)) LIKE 'אמצעי הפיקדון%%'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי", "deposit_method": "card"}',
                   '{"kind": "drawn", "paths": ["<script>alert(1)</script>"]}', true)) = 'החתימה לא תקינה'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי", "deposit_method": "card"}',
                   '{"kind": "drawn", "paths": ["M10,10"]}', true)) LIKE 'החתימה קצרה מדי%%'
             AND (SELECT signed_at IS NULL FROM hospitality.client_contracts WHERE id = %2$L)$$,
         :'st', (:'c1'::jsonb ->> 'id')));
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-c1-second', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי", "deposit_method": "card"}', pg_temp.sig(), true)) AS sg1 \gset
SELECT tests.check('sign: signed once — the full text with the ID, the address, the chosen deposit and today''s date, its sha-256; IP and browser; the link dead',
  format($$SELECT (SELECT status = 'signed' AND signed_at IS NOT NULL AND token_hash IS NULL AND signer_ip = '198.51.100.64'
                          AND signed_body LIKE '%%תעודת זהות: 123456782%%' AND signed_body LIKE '%%כתובת מגורים: רחוב הגפן 3, ישעי%%'
                          AND signed_body LIKE '%%☐ מזומן / ☐ צ''ק ביטחון / ☒ כרטיס אשראי (תפיסת מסגרת)%%'
                          AND signed_body LIKE '%%שנערך ונחתם ביום: ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD.MM.YYYY') || '%%'
                          AND signed_body NOT LIKE '%%{{%%' AND signed_body_sha256 = encode(sha256(convert_to(signed_body, 'UTF8')), 'hex')
                          AND signature ->> 'kind' = 'drawn'
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND (%2$L::jsonb ->> 'number')::int = 1001
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'contracts.signed')$$,
         (:'c1'::jsonb ->> 'id'), :'sg1', :'st'));
SELECT tests.check('no double signing: the same link again — refused (no second contract, the signed text unchanged); opening it again — refused',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-c1-second', '{"id_number": "000000018", "address": "כתובת אחרת 9", "deposit_method": "cash"}', pg_temp.sig(), true))
                    LIKE 'הקישור לחתימה לא תקין או שכבר שומש%%'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-c1-second'))) LIKE 'הקישור לחתימה%%'
             AND (SELECT count(*) FROM hospitality.client_contracts WHERE booking_id = %2$L) = 1
             AND (SELECT signed_body LIKE '%%123456782%%' FROM hospitality.client_contracts WHERE booking_id = %2$L)$$,
         :'st', :'bk'));
DO $$
DECLARE _id uuid := (SELECT id FROM hospitality.client_contracts WHERE signer_email = 'ronit@example.com');
BEGIN
  -- even straight in the database: the signed text, the signature, the customer's fields never change; not deleted
  BEGIN
    UPDATE hospitality.client_contracts SET signed_body = 'זוייף' WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot be changed (even directly)', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot be changed (even directly)', true, SQLERRM);
  END;
  BEGIN
    UPDATE hospitality.client_contracts SET status = 'draft' WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot go back to draft', false, 'updated');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot go back to draft', true, SQLERRM);
  END;
  BEGIN
    DELETE FROM hospitality.client_contracts WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot be deleted', false, 'deleted');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed contract cannot be deleted', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 7. The PDF and the copy
-- ============================================================
SELECT pg_temp.srv_err(:'st', format('SELECT hospitality.contract_pdf_stored(%L, %L, %L, %L, 1000)', :'st',
  (:'c1'::jsonb ->> 'id'), :'so' || '/other.pdf', repeat('a', 64))) AS pdf_bad \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_pdf_stored(%L, %L, %L, %L, 2048)', :'st',
  (:'c1'::jsonb ->> 'id'), :'st' || '/' || (:'c1'::jsonb ->> 'id') || '.pdf', repeat('b', 64))) AS pdf_ok \gset
SELECT pg_temp.srv_err(:'st', format('SELECT hospitality.contract_pdf_stored(%L, %L, %L, %L, 2048)', :'st',
  (:'c1'::jsonb ->> 'id'), :'st' || '/' || (:'c1'::jsonb ->> 'id') || '.pdf', repeat('c', 64))) AS pdf_again \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_copy_result(%L, %L, true, NULL, NULL)', :'st',
  (:'c1'::jsonb ->> 'id'))) AS copy1 \gset
SELECT tests.check('PDF: a path outside the contract''s own — refused; recorded once with its sha-256; a second time — refused; the copy recorded',
  format($$SELECT %1$L = 'נתיב הקובץ לא תקין' AND %2$L::jsonb ->> 'has_pdf' = 'true' AND %3$L LIKE 'הקובץ כבר נשמר%%'
             AND (%4$L::jsonb ->> 'copy_sent_at') IS NOT NULL
             AND (SELECT pdf_sha256 = repeat('b', 64) FROM hospitality.client_contracts WHERE id = %5$L)$$,
         :'pdf_bad', :'pdf_ok', :'pdf_again', :'copy1', (:'c1'::jsonb ->> 'id')));
SELECT pg_temp.call(:'st', :OWNER64, format('SELECT hospitality.contract_file_request(%L, %L)', (:'c1'::jsonb ->> 'id'), 'download')) AS file1 \gset
SELECT tests.check('the file for staff: the path in the private bucket, logged and in the action log; another business — not found',
  format($$SELECT %6$L::jsonb ->> 'path' = %1$L || '/' || %3$L || '.pdf'
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = %3$L AND action = 'staff_download')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'contracts.file_download')
             AND pg_temp.err_of(%4$L, %5$L, format('SELECT hospitality.contract_file_request(%%L)', %3$L)) LIKE 'אין עדיין קובץ%%'$$,
         :'st', :OWNER64, (:'c1'::jsonb ->> 'id'), :'so', :OTHER64, :'file1'));

-- ============================================================
-- 8. A corrected contract: the old one stays until the new one is signed
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL, NULL,
  '{"full_name": "רונית לינה-כהן", "email": "ronit.cohen@example.com"}', '{}', %L)$q$, :'bk', (:'c1'::jsonb ->> 'id'))) AS c2 \gset
SELECT tests.check('correct: a new draft with the corrected details, linked to the old one; the old one is still the signed contract',
  format($$SELECT (%1$L::jsonb ->> 'number')::int = 1002 AND %1$L::jsonb ->> 'supersedes_id' = %2$L
             AND %1$L::jsonb ->> 'signer_email' = 'ronit.cohen@example.com'
             AND (SELECT status FROM hospitality.client_contracts WHERE id = %2$L) = 'signed'
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %3$L AND a.action = 'contracts.corrected')$$,
         :'c2', (:'c1'::jsonb ->> 'id'), :'st'));
SELECT pg_temp.send(:'st', (:'c2'::jsonb ->> 'id'), 'tok-c2', true) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-c2', '{"id_number": "123456782", "address": "רחוב הגפן 3, ישעי", "deposit_method": "cash"}',
  '{"kind": "typed", "name": "רונית לינה-כהן"}', true)) IS NOT NULL AS ok \gset
SELECT tests.check('correct: once the new one is signed (a typed signature) — the old one "superseded", pointing to the new; both kept; the old text unchanged',
  format($$SELECT (SELECT status = 'superseded' AND superseded_by_id = %1$L AND signed_body LIKE '%%שם מלא: רונית לינה%%'
                     FROM hospitality.client_contracts WHERE id = %2$L)
             AND (SELECT status = 'signed' AND signature ->> 'kind' = 'typed' AND signed_body LIKE '%%שם מלא: רונית לינה-כהן%%'
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND (SELECT count(*) FROM hospitality.client_contracts WHERE booking_id = %3$L) = 2$$,
         (:'c2'::jsonb ->> 'id'), (:'c1'::jsonb ->> 'id'), :'bk'));

-- ============================================================
-- 9. Event contract, cancel, archive, "my documents", isolation
-- ============================================================
SELECT pg_temp.call(:'st', :MGR64, format($q$SELECT hospitality.contract_create('pool_event', NULL, %L)$q$, :'ev')) AS c3 \gset
SELECT tests.check('event contract (by the granted manager): the event''s customer, the purpose, the date and hours, 3 צימרים in clause 1',
  format($$SELECT %1$L::jsonb ->> 'kind' = 'pool_event' AND %1$L::jsonb ->> 'signer_email' = 'shira@example.com'
             AND (SELECT data ->> 'event_purpose' = 'מסיבת כלה' AND data ->> 'units_count_text' = '3 הצימרים'
                         AND data ->> 'start_time' = '10:00' AND data ->> 'price' = '3,500'
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)$$, :'c3'));
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'bk2')) AS c4 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_cancel(%L, 'נשלח בטעות')$q$, (:'c4'::jsonb ->> 'id'))) AS x4 \gset
SELECT tests.check('cancel: an unsigned contract — cancelled with the reason (a signed one cannot be cancelled)',
  format($$SELECT %1$L::jsonb ->> 'status' = 'cancelled' AND %1$L::jsonb ->> 'cancel_reason' = 'נשלח בטעות'
             AND pg_temp.err_of(%2$L, %3$L, format('SELECT hospitality.contract_cancel(%%L)', %4$L)) LIKE 'חוזה חתום לא מבטלים%%'$$,
         :'x4', :'st', :OWNER64, (:'c2'::jsonb ->> 'id')));
SELECT tests.check('archive: search by name / email / phone / number; filter by kind, status, event type and service date; another business sees nothing',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_contracts()') ->> 'total')::int = 4
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts('שירה')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts('ronit')$s$) ->> 'total')::int = 2
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts('054-6400003')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts('1002')$s$) ->> 'total')::int >= 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts(NULL, 'pool_event')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts(NULL, NULL, 'signed')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts(NULL, NULL, 'superseded')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts(NULL, NULL, NULL, 'bridal_shower')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.staff_contracts(NULL, NULL, NULL, NULL, %%L, %%L)$s$, pg_temp.d(45), pg_temp.d(60))) ->> 'total')::int = 1
             AND (pg_temp.call(%3$L, %4$L, 'SELECT hospitality.staff_contracts()') ->> 'total')::int = 0
             AND pg_temp.err_of(%3$L, %4$L, format('SELECT hospitality.staff_contract_detail(%%L)', %5$L)) = 'החוזה לא נמצא'$$,
         :'st', :OWNER64, :'so', :OTHER64, (:'c2'::jsonb ->> 'id')));
SELECT tests.check('detail: the signed text, the ID shown masked only, the history; the booking page lists its contracts',
  format($$SELECT (d ->> 'body') LIKE '%%רונית לינה-כהן%%' AND d -> 'customer_fields' ->> 'id_number_masked' = '•••••6782'
             AND NOT (d -> 'customer_fields' ? 'id_number') AND jsonb_array_length(d -> 'log') >= 3
             AND jsonb_array_length(pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_contracts_for(%%L, NULL)', %4$L))) = 2
          FROM (SELECT pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_contract_detail(%%L)', %3$L)) AS d) x$$,
         :'st', :OWNER64, (:'c2'::jsonb ->> 'id'), :'bk'));
INSERT INTO hospitality.guest_sessions (tenant_id, email, token_hash, expires_at)
VALUES (:'st', 'ronit.cohen@example.com', pg_temp.h('guest-ronit'), now() + interval '1 day'),
       (:'st', 'shira@example.com', pg_temp.h('guest-shira'), now() + interval '1 day');
SELECT tests.check('"my documents": the signed-in customer sees only own signed contracts; another customer — none of them; the file — only own (and logged)',
  format($$SELECT jsonb_array_length(pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-ronit')))) = 1
             AND jsonb_array_length(pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-shira')))) = 0
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_document_file(%%L, %%L)', pg_temp.h('guest-shira'), %2$L)) = 'המסמך לא נמצא'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('nobody'))) LIKE 'החיבור הסתיים%%'
             AND pg_temp.srv_err(%3$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-ronit'))) IS NOT NULL$$,
         :'st', (:'c1'::jsonb ->> 'id'), :'so'));
DO $$
BEGIN
  BEGIN
    UPDATE hospitality.client_contract_log SET action = 'xxx' WHERE id = (SELECT min(id) FROM hospitality.client_contract_log);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the contract history cannot be edited', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the contract history cannot be edited', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 10. A chain of corrections: A signed → B corrected (not signed) → C instead of B → C signed
--     C replaces the signed one in force (A), B points to C, one signed contract for the event
-- ============================================================
SELECT pg_temp.send(:'st', (:'c3'::jsonb ->> 'id'), 'tok-c3', true) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-c3', '{"id_number": "123456782", "address": "רחוב הזית 9, ישעי"}',
  pg_temp.sig(), true)) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('pool_event', NULL, %L, NULL,
  '{"full_name": "שירה לוי", "email": "shira@example.com"}', '{}', %L)$q$, :'ev', (:'c3'::jsonb ->> 'id'))) AS c5 \gset
SELECT pg_temp.send(:'st', (:'c5'::jsonb ->> 'id'), 'tok-c5', true) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('pool_event', NULL, %L, NULL,
  '{"full_name": "שירה לוי-אברהם", "email": "shira@example.com"}', '{}', %L)$q$, :'ev', (:'c5'::jsonb ->> 'id'))) AS c6 \gset
SELECT tests.check('chain: replacing the unsigned correction — it is "superseded" at once and points to the new one; its link is dead; A is still signed',
  format($$SELECT (SELECT status = 'superseded' AND superseded_by_id = %2$L AND token_hash IS NULL
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND (SELECT status FROM hospitality.client_contracts WHERE id = %3$L) = 'signed'
             AND pg_temp.srv_err(%4$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-c5'))) IS NOT NULL$$,
         (:'c5'::jsonb ->> 'id'), (:'c6'::jsonb ->> 'id'), (:'c3'::jsonb ->> 'id'), :'st'));
SELECT pg_temp.send(:'st', (:'c6'::jsonb ->> 'id'), 'tok-c6', true) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', pg_temp.sign_sql('tok-c6', '{"id_number": "123456782", "address": "רחוב הזית 9, ישעי"}',
  pg_temp.sig(), true)), 'ok') AS sign6 \gset
SELECT tests.check('chain: signing C works, replaces A (the signed one in force) — one signed contract for the event; all three kept',
  format($$SELECT %1$L = 'ok'
             AND (SELECT status = 'superseded' AND superseded_by_id = %2$L FROM hospitality.client_contracts WHERE id = %3$L)
             AND (SELECT status FROM hospitality.client_contracts WHERE id = %2$L) = 'signed'
             AND (SELECT count(*) FROM hospitality.client_contracts WHERE event_id = %4$L AND status = 'signed') = 1
             AND (SELECT count(*) FROM hospitality.client_contracts WHERE event_id = %4$L) = 3
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = %3$L AND action = 'superseded')$$,
         :'sign6', (:'c6'::jsonb ->> 'id'), (:'c3'::jsonb ->> 'id'), :'ev'));

SELECT tests.check('"my documents": a customer with a signed contract and no booking (an event) can sign in to the area; an unknown address cannot',
  format($$SELECT hospitality._guest_area_has_bookings(%1$L, 'shira@example.com')
             AND NOT hospitality._guest_area_has_bookings(%1$L, 'nobody@example.com')
             AND NOT hospitality._guest_area_has_bookings(%2$L, 'shira@example.com')$$, :'st', :'so'));

-- ============================================================
-- 11. Several rooms in one request (a booking group): one contract covers the whole group
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'דנה קבוצה', _phone => '0546400005', _email => 'dana@example.com',
   _terms_explained => true, _total_override => 1400)$q$, :'u1', pg_temp.d(70), pg_temp.d(72))) ->> 'booking_id' AS g1 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'דנה קבוצה', _phone => '0546400005', _email => 'dana@example.com',
   _terms_explained => true, _total_override => 1400)$q$, :'u2', pg_temp.d(70), pg_temp.d(72))) ->> 'booking_id' AS g2 \gset
UPDATE hospitality.bookings SET group_id = 'b0000000-0000-0000-0000-000000064b01' WHERE id IN (:'g1', :'g2');
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'g1')) AS gc \gset
SELECT tests.check('booking group: one contract covers both rooms (the group total); a second contract for the other room — refused; the other room lists the group contract and the preview shows it as open',
  format($$SELECT (SELECT data ->> 'price' = '2,800' FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND pg_temp.err_of(%2$L, %3$L, format($s$SELECT hospitality.contract_create('hosting', %%L, NULL)$s$, %4$L))
                 LIKE 'כבר יש חוזה פתוח%%'
             AND jsonb_array_length(pg_temp.call(%2$L, %3$L, format('SELECT hospitality.staff_contracts_for(%%L, NULL)', %4$L))) = 1
             AND pg_temp.call(%2$L, %3$L, format($s$SELECT hospitality.contract_preview('hosting', %%L, NULL)$s$, %4$L))
                   -> 'open_contract' ->> 'id' = %1$L::jsonb ->> 'id'$$,
         :'gc', :'st', :OWNER64, :'g2'));
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL, NULL, NULL, '{}', %L)$q$,
  :'g2', (:'gc'::jsonb ->> 'id'))) AS gc2 \gset
SELECT tests.check('booking group: a corrected contract from the other room replaces the open one (same group); a contract of another booking cannot be replaced from here',
  format($$SELECT (SELECT status = 'superseded' AND superseded_by_id = (%1$L::jsonb ->> 'id')::uuid
                     FROM hospitality.client_contracts WHERE id = (%2$L::jsonb ->> 'id')::uuid)
             AND pg_temp.err_of(%3$L, %4$L, format($s$SELECT hospitality.contract_create('hosting', %%L, NULL, NULL, NULL, '{}', %%L)$s$,
                                                  %5$L, %1$L::jsonb ->> 'id')) LIKE 'החוזה הקודם לא נמצא%%'$$,
         :'gc2', :'gc', :'st', :OWNER64, :'bk2'));

-- ============================================================
-- 12. A contract that no longer matches its event / booking cannot be signed; the pool notice for the customer
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'birthday', 'event_date', pg_temp.d(60), 'start_time', '16:00', 'end_time', '22:00',
  'participants', 30, 'price', 2500, 'customer', jsonb_build_object('full_name', 'נועה ערב', 'phone', '0546400007',
                                                                    'email', 'noa@example.com')))) AS ev2 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('pool_event', NULL, %L)$q$, (:'ev2'::jsonb ->> 'id'))) AS c7 \gset
SELECT pg_temp.send(:'st', (:'c7'::jsonb ->> 'id'), 'tok-c7', true) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c7'))) AS op7 \gset
SELECT tests.check('pool notice: the customer gets the pool hours and this event''s pool-use window (16:00–18:00 of a 16:00–22:00 event), kept in the snapshot',
  format($$SELECT %1$L::jsonb -> 'pool' ->> 'open' = '08:00' AND %1$L::jsonb -> 'pool' ->> 'close' = '18:00'
             AND %1$L::jsonb -> 'pool' ->> 'start' = '16:00' AND %1$L::jsonb -> 'pool' ->> 'end' = '18:00'
             AND %1$L::jsonb -> 'pool' ->> 'event_end' = '22:00'
             AND (%1$L::jsonb -> 'pool' ->> 'window_known')::boolean
             AND (SELECT data ->> 'pool_end_time' = '18:00' AND data ? 'options'
                    FROM hospitality.client_contracts WHERE id = (%2$L::jsonb ->> 'id')::uuid)
             AND (SELECT hospitality._contract_stale(c) IS NULL FROM hospitality.client_contracts c
                   WHERE c.id = (%2$L::jsonb ->> 'id')::uuid)$$,
         :'op7', :'c7'));
-- the event moves to another day after the contract was sent
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_update(%L, 1, '{"event_date": "%s"}')$q$,
  (:'ev2'::jsonb ->> 'id'), pg_temp.d(61))) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c7'))), 'ok') AS open_changed \gset
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER64, format('SELECT hospitality.contract_send_prepare(%L)', (:'c7'::jsonb ->> 'id'))), 'ok') AS resend_changed \gset
SELECT COALESCE(pg_temp.srv_err(:'st', pg_temp.sign_sql('tok-c7', '{"id_number": "123456782", "address": "רחוב התאנה 2, ישעי"}',
  pg_temp.sig(), true)), 'ok') AS sign_changed \gset
SELECT tests.check('stale: the event date changed after sending — the customer cannot open or sign the old text (told an updated one will come), the business cannot resend it, and the staff see "changed"',
  format($$SELECT %1$L LIKE 'פרטי ההזמנה / האירוע השתנו מאז שנשלח ההסכם%%'
             AND %2$L LIKE 'פרטי ההזמנה / האירוע השתנו מאז שהחוזה נוצר%%'
             AND %3$L LIKE 'פרטי ההזמנה / האירוע השתנו מאז שנשלח ההסכם%%'
             AND (SELECT status FROM hospitality.client_contracts WHERE id = (%4$L::jsonb ->> 'id')::uuid) <> 'signed'
             AND pg_temp.call(%5$L, %6$L, format('SELECT hospitality.staff_contract_detail(%%L)', %4$L::jsonb ->> 'id')) ->> 'stale' = 'changed'$$,
         :'open_changed', :'resend_changed', :'sign_changed', :'c7', :'st', :OWNER64));
-- back to the original day: it matches again; then only the pool window changes
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_update(%L, 2, '{"event_date": "%s"}')$q$,
  (:'ev2'::jsonb ->> 'id'), pg_temp.d(60))) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c7'))), 'ok') AS open_back \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_update(%L, 3, '{"pool_start_time": "16:00", "pool_end_time": "17:00"}')$q$,
  (:'ev2'::jsonb ->> 'id'))) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c7'))), 'ok') AS open_pool \gset
SELECT tests.check('stale: back to the sent details — the link works again; a change of the pool-use window alone also makes it "changed"',
  format($$SELECT %1$L = 'ok' AND %2$L LIKE 'פרטי ההזמנה / האירוע השתנו%%'$$, :'open_back', :'open_pool'));
-- the event is cancelled
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_update(%L, 4, '{"pool_start_time": "16:00", "pool_end_time": "18:00"}')$q$,
  (:'ev2'::jsonb ->> 'id'))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_set_status(%L, 5, 'cancelled', 'בוטל')$q$,
  (:'ev2'::jsonb ->> 'id'))) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c7'))), 'ok') AS open_cancelled \gset
SELECT tests.check('stale: the event cancelled — the contract can no longer be opened or signed ("no longer valid"), and the staff see "unavailable"',
  format($$SELECT %1$L LIKE 'ההסכם כבר לא בתוקף%%'
             AND pg_temp.call(%2$L, %3$L, format('SELECT hospitality.staff_contract_detail(%%L)', %4$L::jsonb ->> 'id')) ->> 'stale' = 'unavailable'$$,
         :'open_cancelled', :'st', :OWNER64, :'c7'));
-- a lodging booking whose price changes after the contract was sent
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'יעל לינה', _phone => '0546400008', _email => 'yael@example.com',
   _terms_explained => true, _total_override => 1200)$q$, :'u1', pg_temp.d(80), pg_temp.d(82))) ->> 'booking_id' AS bk8 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'bk8')) AS c8 \gset
SELECT (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c WHERE c.id = (:'c8'::jsonb ->> 'id')::uuid) IS NULL AS fresh8 \gset
SELECT revision AS bk8rev FROM hospitality.bookings WHERE id = :'bk8' \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.modify_booking(%L, %s, %L, %L, _total_override => 1500)$q$,
  :'bk8', :bk8rev, pg_temp.d(80), pg_temp.d(82))) IS NOT NULL AS ok \gset
SELECT tests.check('stale: a lodging contract — fresh when created, "changed" once the booking total changes (the price in the text)',
  format($$SELECT %1$L::boolean AND (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c
                                       WHERE c.id = (%2$L::jsonb ->> 'id')::uuid) = 'changed'$$, :'fresh8', :'c8'));

-- ============================================================
-- 13. Privacy: deleting a customer's details now covers events and contracts; retention; the export
-- ============================================================
-- customer X: a lodging contract signed, then the booking cancelled; an event contract sent (unsigned), then the event cancelled
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'פרטית מחיקה', _phone => '0546400011', _email => 'erase@example.com',
   _terms_explained => true, _total_override => 900)$q$, :'u2', pg_temp.d(90), pg_temp.d(91))) ->> 'booking_id' AS bk9 \gset
SELECT guest_id AS gx FROM hospitality.bookings WHERE id = :'bk9' \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'bk9')) AS c9 \gset
SELECT pg_temp.send(:'st', (:'c9'::jsonb ->> 'id'), 'tok-c9', true) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-c9', '{"id_number": "123456782", "address": "רחוב האלה 4, ישעי", "deposit_method": "cash"}',
  pg_temp.sig(), true)) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER64, format($s$SELECT hospitality.cancel_booking(%L, 'בדיקה')$s$, :'bk9')), 'ok') AS cx9 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'family_event', 'event_date', pg_temp.d(95), 'start_time', '10:00', 'end_time', '14:00',
  'participants', 20, 'price', 1500, 'guest_id', :'gx', 'internal_notes', 'הערה פרטית על הלקוחה'))) AS ev9 \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.contract_create('pool_event', NULL, %L)$q$, (:'ev9'::jsonb ->> 'id'))) AS c10 \gset
SELECT pg_temp.send(:'st', (:'c10'::jsonb ->> 'id'), 'tok-c10', true) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER64, format($s$SELECT to_jsonb(hospitality.anonymize_guest(%L))$s$, :'gx')), 'ok') AS anon_refused \gset
SELECT pg_temp.call(:'st', :OWNER64, format('SELECT hospitality.export_guest_logged(%L)', :'gx')) AS exp9 \gset
SELECT tests.check('privacy: a customer with a future event cannot be deleted yet (like a future booking); the export holds the events and every contract',
  format($$SELECT %1$L = 'ok' AND %2$L LIKE 'ללקוח יש אירוע פעיל או עתידי%%'
             AND jsonb_array_length(%3$L::jsonb -> 'pool_events') = 1
             AND jsonb_array_length(%3$L::jsonb -> 'contracts') = 2
             AND %3$L::jsonb -> 'contracts' @> '[{"status": "signed"}]'::jsonb$$,
         :'cx9', :'anon_refused', :'exp9'));
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_set_status(%L, 1, 'cancelled', 'הלקוחה ביטלה')$q$,
  (:'ev9'::jsonb ->> 'id'))) IS NOT NULL AS ok \gset
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER64, format($s$SELECT to_jsonb(hospitality.anonymize_guest(%L))$s$, :'gx')), 'ok') AS anon_ok \gset
SELECT COALESCE(pg_temp.srv_err(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-c10'))), 'ok') AS open_after \gset
SELECT tests.check('privacy: deleting the details — the unsigned contract is gone with its history and its link; the signed one is kept exactly as signed; the event keeps its amounts but loses the free-text notes',
  format($$SELECT %1$L = 'ok'
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contracts WHERE id = (%2$L::jsonb ->> 'id')::uuid)
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = (%2$L::jsonb ->> 'id')::uuid)
             AND %3$L LIKE 'הקישור לחתימה לא תקין%%'
             AND (SELECT status = 'signed' AND signer_name = 'פרטית מחיקה' AND signed_body IS NOT NULL
                    FROM hospitality.client_contracts WHERE id = (%4$L::jsonb ->> 'id')::uuid)
             AND (SELECT internal_notes IS NULL AND cancel_reason IS NULL AND price = 1500
                    FROM hospitality.events WHERE id = (%5$L::jsonb ->> 'id')::uuid)
             AND (SELECT anonymized_at IS NOT NULL FROM hospitality.guests WHERE id = %6$L)$$,
         :'anon_ok', :'c10', :'open_after', :'c9', :'ev9', :'gx'));

-- retention: a customer of an event only — deleted on time; one whose event ended inside the period — kept
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'birthday', 'event_date', pg_temp.d(-300), 'start_time', '10:00', 'end_time', '12:00',
  'participants', 10, 'price', 500, 'customer', jsonb_build_object('full_name', 'ישן מאוד', 'phone', '0546400012')))) AS old_ev \gset
SELECT pg_temp.call(:'st', :OWNER64, format($q$SELECT hospitality.event_create(%L)$q$, jsonb_build_object(
  'property_id', :'p1', 'event_type', 'birthday', 'event_date', pg_temp.d(-30), 'start_time', '10:00', 'end_time', '12:00',
  'participants', 10, 'price', 500, 'customer', jsonb_build_object('full_name', 'לא מזמן', 'phone', '0546400013')))) AS new_ev \gset
SELECT guest_id AS g_old FROM hospitality.events WHERE id = (:'old_ev'::jsonb ->> 'id')::uuid \gset
SELECT guest_id AS g_new FROM hospitality.events WHERE id = (:'new_ev'::jsonb ->> 'id')::uuid \gset
UPDATE hospitality.guests SET created_at = now() - interval '2 years' WHERE id IN (:'g_old', :'g_new');
UPDATE hospitality.settings SET guest_retention_months = 6 WHERE tenant_id = :'st';
SELECT hospitality.apply_retention() >= 1 AS ran \gset
SELECT tests.check('retention: an event-only customer whose event ended 300 days ago (period 6 months) is deleted; one whose event ended 30 days ago is kept',
  format($$SELECT %1$L::boolean
             AND (SELECT anonymized_at IS NOT NULL FROM hospitality.guests WHERE id = %2$L)
             AND (SELECT anonymized_at IS NULL FROM hospitality.guests WHERE id = %3$L)$$,
         :'ran', :'g_old', :'g_new'));
UPDATE hospitality.settings SET guest_retention_months = NULL WHERE tenant_id = :'st';

-- ---------- cleanup: the platform flags as they were ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m64_flags m WHERE f.key = m.key;
DROP TABLE m64_flags;

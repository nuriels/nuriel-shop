-- ============================================================
-- Hospitality — standalone documents for signing (20261111140000_hosp_standalone_documents.sql)
--   • structure: origin / fill mode / "seen" columns; a standalone document has no booking and no event; a
--     policy document is standalone only; "the customer fills" only on a standalone document; the policy
--     template is frozen like the others; the new functions — staff / app server only, helpers for nobody;
--   • access: the "contracts" permission (a manager without it — refused); another business sees nothing;
--   • the gate: before the legal approval — preview only; policy documents need no business terms, contracts do;
--   • way A (the business fills): an existing customer or a new one (a customer card), the details checked, the
--     link by email; the customer adds only the ID and the address; signing once; the signed text with its
--     sha-256; the owner notified (an email in the queue + "not seen" in the management area);
--   • way B (the customer fills): no email needed to create it; a link to copy (only its hash stored); the
--     customer writes name + email (+ phone, + ID and address in a contract) and signs; the copy goes to the
--     email the customer wrote; the document in that customer's own area;
--   • the link: one business only, once, until it expires; a business-filled document never gets a copy link;
--   • a signed standalone document never changes (also its origin and way) and is never deleted; resending the
--     copy does not change it; a document whose policy / business details changed cannot be signed;
--   • the signed documents area: search by customer / email / phone / number / document title, kind, origin,
--     signed dates; the "seen" mark; the linked contracts (bookings / events) also notify the owner;
--   • privacy: deleting a customer's details removes unsigned standalone documents (by card and by email) and
--     keeps the signed ones; the export lists standalone documents by email.
-- ============================================================
\set OWNER68 '''a0000000-0000-0000-0000-000000068a01'''
\set MGR68 '''a0000000-0000-0000-0000-000000068a02'''
\set OTHER68 '''a0000000-0000-0000-0000-000000068a03'''

CREATE OR REPLACE FUNCTION pg_temp.d(_n integer) RETURNS date LANGUAGE sql AS $$ SELECT current_date + _n $$;
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', json_build_object('x-tenant-id', _site, 'user-agent', 'db-test',
                                                          'x-forwarded-for', '203.0.113.68')::text, true);
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
CREATE OR REPLACE FUNCTION pg_temp.sig() RETURNS jsonb LANGUAGE sql AS $$
  SELECT '{"kind": "drawn", "paths": ["M10,20 L40,60 L80,30", "M100,50 L150,90", "M200,40 L260,70 L300,20"]}'::jsonb $$;
CREATE OR REPLACE FUNCTION pg_temp.sign_sql(_token text, _fields jsonb, _sig jsonb, _agreed boolean) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT hospitality.contract_sign(%L, %L, %L, %L, %L, %L)', pg_temp.h(_token), _fields, _sig, _agreed,
                '198.51.100.68', 'Mozilla/5.0 db-test');
$$;
-- way A: the server's send (a new link — only its hash — then the result of the email)
CREATE OR REPLACE FUNCTION pg_temp.send(_site text, _id text, _token text, _ok boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.contract_issue_link(%L, %L, %L, %L)', _site, _id, pg_temp.h(_token),
                                   'a0000000-0000-0000-0000-000000068a01'))
         || pg_temp.srv(_site, format('SELECT hospitality.contract_send_result(%L, %L, %L, %L, %L)', _site, _id, _ok,
                                      CASE WHEN _ok THEN NULL ELSE 'smtp 550' END, 'a0000000-0000-0000-0000-000000068a01'));
$$;
-- way B: the server makes a link for the staff to copy (only its hash stored) and records it
CREATE OR REPLACE FUNCTION pg_temp.share(_site text, _id text, _token text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.srv(_site, format('SELECT hospitality.contract_issue_link(%L, %L, %L, %L)', _site, _id, pg_temp.h(_token),
                                   'a0000000-0000-0000-0000-000000068a01'))
         || pg_temp.srv(_site, format('SELECT hospitality.contract_link_shared(%L, %L, %L)', _site, _id,
                                      'a0000000-0000-0000-0000-000000068a01'));
$$;
CREATE OR REPLACE FUNCTION pg_temp.create_sql(_kind text, _mode text, _guest uuid, _signer jsonb, _input jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT hospitality.contract_standalone_create(%L, %L, %L, %L, %L)', _kind, _mode, _guest, _signer, _input);
$$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000068a01', 'm68.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000068a02', 'm68.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000068a03', 'm68.other@test.local', now())
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE m68_flags AS
  SELECT key, enabled FROM public.platform_feature_flags WHERE key LIKE 'hospitality%';
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m68-docs', 'נופי המסמכים', 'm68.owner@test.local')$$) ->> 'id' AS st \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm68.owner@test.local')$$, :'st')) IS NOT NULL AS ok \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m68-other', 'אתר שכן למסמכים', 'm68.other@test.local')$$) ->> 'id' AS so \gset
SELECT pg_temp.as_platform(format($$SELECT hospitality.admin_set_owner(%L, 'm68.other@test.local')$$, :'so')) IS NOT NULL AS ok \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES (:'st', :MGR68, 'm68.manager@test.local', 'm68_manager', 'admin', true);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
       public.platform_set_flag('hospitality_backend_enabled', true),
       public.platform_set_flag('hospitality_management_enabled', true),
       public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
       public.platform_set_flag('hospitality_management_enabled', true, %1$L),
       public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
       public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
UPDATE hospitality.settings SET business_name = 'נופי המסמכים', contact_phone = '0503822368', contact_email = 'docs68@example.com',
       address = 'מושב ישעי 68', check_in_time = '15:00', check_out_time = '11:00'
 WHERE tenant_id = :'st';
UPDATE hospitality.settings SET business_name = 'אתר שכן', contact_phone = '0503822369', contact_email = 'other68@example.com'
 WHERE tenant_id = :'so';
SELECT pg_temp.call(:'st', :OWNER68,
  $q$SELECT hospitality.property_create('{"name": "מתחם המסמכים", "property_type": "zimmer_complex", "status": "active"}')$q$) ->> 'id' AS p1 \gset
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.unit_create(%L, '{"name": "צימר אלון", "unit_type": "suite", "capacity": 4}')$q$, :'p1')) ->> 'id' AS u1 \gset
UPDATE hospitality.units SET base_price = 800, is_active = true WHERE tenant_id = :'st';
-- a published site document (house rules): a heading, items, paragraphs — and lines that look like contract markup
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.site_document_save('house_rules', 'כללי המקום',
  E'## שעות שקט\n- בין 22:00 ל-08:00\n- בלי מוזיקה בחוץ\nאורחים מתבקשים לשמור על הניקיון.\n# לא כותרת — פסקה\n**שורה עם כוכביות**')$q$) AS hr_saved \gset
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.site_document_publish('house_rules', 'כללי המקום', %L, %s)$q$,
  E'## שעות שקט\n- בין 22:00 ל-08:00\n- בלי מוזיקה בחוץ\nאורחים מתבקשים לשמור על הניקיון.\n# לא כותרת — פסקה\n**שורה עם כוכביות**',
  (:'hr_saved'::jsonb ->> 'revision'))) AS hr_pub \gset
-- an existing customer card (for way A with a chosen customer)
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L,
   _check_out => %L, _full_name => 'דנה קיימת', _phone => '0546800001', _email => 'dana68@example.com',
   _terms_explained => true, _total_override => 1600)$q$, :'u1', pg_temp.d(20), pg_temp.d(22))) ->> 'booking_id' AS bk \gset
SELECT guest_id AS g_dana FROM hospitality.bookings WHERE id = :'bk' \gset

-- ============================================================
-- 1. Structure
-- ============================================================
SELECT tests.check('structure: origin / fill mode / seen columns; the new link rule replaces the old one; the policy template',
  $$SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'client_contracts'
             AND column_name IN ('origin', 'fill_mode', 'staff_seen_at')) = 3
       AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.client_contracts'::regclass
                     AND conname IN ('client_contracts_link_check'))
       AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.client_contracts'::regclass
                         AND conname = 'client_contracts_check')
       AND (SELECT title FROM hospitality.contract_templates WHERE key = 'policy' AND version = 1) = 'אישור מסמך מדיניות ותנאים'
       AND (SELECT body LIKE '%{{document_lines}}%' AND body LIKE '%[[signatures]]%' AND body LIKE '%אני מאשר/ת שקראתי%'
              FROM hospitality.contract_templates WHERE key = 'policy')
       AND (SELECT count(*) FROM hospitality.contract_templates) = 3$$);
SELECT tests.check('structure: the new staff functions — signed-in staff (never anon); the copy-link record — the app server only; the helpers — nobody',
  $$SELECT has_function_privilege('authenticated', 'hospitality.contract_standalone_create(text,text,uuid,jsonb,jsonb)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.contract_standalone_preview(text,text,uuid,jsonb,jsonb)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.staff_signed_documents(text,text,text,date,date,integer,integer)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.contract_link_prepare(uuid)', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.contracts_unseen()', 'EXECUTE')
       AND has_function_privilege('authenticated', 'hospitality.contracts_mark_seen(uuid[])', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contract_standalone_create(text,text,uuid,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contract_standalone_preview(text,text,uuid,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.staff_signed_documents(text,text,text,date,date,integer,integer)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contracts_mark_seen(uuid[])', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.contract_link_shared(uuid,uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.contract_link_shared(uuid,uuid,uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.contract_link_shared(uuid,uuid,uuid)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._contract_data_standalone(uuid,text,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('service_role', 'hospitality._contract_data_standalone(uuid,text,jsonb,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('service_role', 'hospitality._policy_lines(text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._standalone_signer(uuid,text,uuid,jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._documents_gate(uuid,text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality._contract_doc_title(text,integer,jsonb)', 'EXECUTE')$$);
DO $$
DECLARE
  _t uuid := (SELECT id FROM public.tenants WHERE slug = 'm68-docs');
  _b uuid := (SELECT id FROM hospitality.bookings WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'm68-docs') LIMIT 1);
BEGIN
  BEGIN
    INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, origin, booking_id, signer_name, signer_email, data)
    VALUES (_t, 9001, 'hosting', 1, 'standalone', _b, 'בדיקה', 'x@example.com', '{}'::jsonb);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a standalone document tied to a booking', false, 'inserted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a standalone document tied to a booking', true, SQLERRM);
  END;
  BEGIN
    INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, booking_id, signer_name, signer_email, data)
    VALUES (_t, 9002, 'policy', 1, _b, 'בדיקה', 'x@example.com', '{}'::jsonb);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a policy document on a booking (policy — standalone only)', false, 'inserted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a policy document on a booking (policy — standalone only)', true, SQLERRM);
  END;
  BEGIN
    INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, fill_mode, booking_id, signer_name, signer_email, data)
    VALUES (_t, 9003, 'hosting', 1, 'customer', _b, 'בדיקה', 'x@example.com', '{}'::jsonb);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses "the customer fills" on a booking contract', false, 'inserted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses "the customer fills" on a booking contract', true, SQLERRM);
  END;
  BEGIN
    INSERT INTO hospitality.client_contracts (tenant_id, number, kind, template_version, origin, signer_name, signer_email, data)
    VALUES (_t, 9004, 'policy', 1, 'standalone', NULL, NULL, '{}'::jsonb);
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a business-filled document without a customer name and email', false, 'inserted');
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the table refuses a business-filled document without a customer name and email', true, SQLERRM);
  END;
  BEGIN
    UPDATE hospitality.contract_templates SET title = 'שונה' WHERE key = 'policy';
    INSERT INTO tests.results (name, ok, detail) VALUES ('the policy template never changes', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('the policy template never changes', true, SQLERRM);
  END;
END $$;

-- ============================================================
-- 2. Access and the gate
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.contract_standalone_preview('policy', 'business', NULL,
  '{"full_name": "נועה חדשה", "email": "Noa68@Example.com"}', '{"document_kind": "house_rules"}')$q$) AS pv1 \gset
SELECT tests.check('gate: before the legal approval — the full preview of a policy document (the published text, as signed), creating refused',
  format($$SELECT (%1$L::jsonb ->> 'legal_pending')::boolean AND NOT (%1$L::jsonb ->> 'can_send')::boolean
             AND %1$L::jsonb ->> 'title' = 'כללי המקום' AND %1$L::jsonb ->> 'origin' = 'standalone'
             AND %1$L::jsonb ->> 'body' LIKE '# כללי המקום%%'
             AND %1$L::jsonb ->> 'body' LIKE '%%## שעות שקט%%- בין 22:00 ל-08:00%%'
             AND %1$L::jsonb ->> 'body' LIKE '%%\ # לא כותרת — פסקה%%' AND %1$L::jsonb ->> 'body' LIKE '%%\ **שורה עם כוכביות**%%'
             AND %1$L::jsonb ->> 'body' LIKE '%%גרסה 1 מיום%%' AND %1$L::jsonb ->> 'body' LIKE '%%אימייל: noa68@example.com%%'
             AND %1$L::jsonb -> 'signer' ->> 'email' = 'noa68@example.com'
             AND NOT (%1$L::jsonb -> 'data' ? 'input')
             AND pg_temp.err_of(%2$L, %3$L, pg_temp.create_sql('policy', 'business', NULL,
                   '{"full_name": "נועה חדשה", "email": "noa68@example.com"}', '{"document_kind": "house_rules"}'))
                 LIKE 'החוזים ממתינים לאישור משפטי%%'$$,
         :'pv1', :'st', :OWNER68));
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_contracts_enabled', true),
       public.platform_set_flag('hospitality_contracts_enabled', true, %L),
       public.platform_set_flag('hospitality_contracts_enabled', true, %L)])$$, :'st', :'so')) IS NOT NULL AS ok \gset
SELECT tests.check('access: a manager without the contracts permission — refused everywhere new; another business sees nothing of this one',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'business', NULL,
                    '{"full_name": "נועה חדשה", "email": "noa68@example.com"}', '{"document_kind": "house_rules"}')) IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.contract_standalone_preview('policy', 'customer', NULL, NULL, '{"document_kind": "house_rules"}')$s$) IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.staff_signed_documents()') IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.contracts_unseen()') IS NOT NULL
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.contracts_mark_seen()') IS NOT NULL
             AND pg_temp.err_of(%3$L, %4$L, $s$SELECT hospitality.contract_standalone_preview('policy', 'customer', NULL, NULL, '{"document_kind": "house_rules"}')$s$)
                 LIKE 'המסמך הזה לא מפורסם באתר%%'$$,
         :'st', :MGR68, :'so', :OTHER68));
SELECT tests.check('gate: approved — a hosting / event contract still needs the owner''s confirmed terms; a policy document does not',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'business', NULL,
                    '{"full_name": "נועה חדשה", "email": "noa68@example.com"}',
                    jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(32), 'whole', true, 'price', 1500)))
                 LIKE 'בעל העסק צריך לאשר%%'$$,
         :'st', :OWNER68));
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.business_terms_save('{"representative_name": "אורי שליח",
  "business_tax_id": "58731621", "deposit_amount": 1500, "max_event_guests": 40}', 0)$q$) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.business_terms_save(%L, 1)$q$,
  jsonb_build_object('unit_lines', jsonb_build_array(
    jsonb_build_object('unit_id', :'u1', 'name', 'אלון', 'description', 'מיועד לזוג ועד 2 ילדים'),
    jsonb_build_object('name', 'אורן', 'description', 'מיועד לזוג בלבד'))))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER68, 'SELECT hospitality.business_terms_confirm(2)') IS NOT NULL AS ok \gset

-- ============================================================
-- 3. Checking what the business fills
-- ============================================================
SELECT tests.check('checks: unknown kind / way, unknown field, dates (missing, reversed, too long, too far), units (none, not on the list), price, deposit method',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('lease', 'business', NULL, NULL, '{}')) = 'סוג המסמך לא מוכר'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'nobody', NULL, NULL, '{}')) = 'דרך המילוי לא מוכרת'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'customer', NULL, NULL, '{"document_kind": "house_rules", "x": 1}')) = 'שדה לא מוכר: x'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'customer', NULL, NULL, '{"document_kind": "accessibility"}')) LIKE 'המסמך — יש לבחור מהרשימה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'customer', NULL, NULL, '{"document_kind": "privacy"}')) LIKE 'המסמך הזה לא מפורסם באתר%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL, '{"whole": true, "price": 100}')) = 'יש למלא תאריך כניסה ותאריך יציאה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(32), 'check_out', pg_temp.d(30), 'whole', true, 'price', 100))) = 'תאריך היציאה צריך להיות אחרי תאריך הכניסה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(100), 'whole', true, 'price', 100))) = 'עד 60 לילות במסמך אחד'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(2000), 'check_out', pg_temp.d(2002), 'whole', true, 'price', 100))) = 'תאריך הכניסה רחוק מדי'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(32), 'price', 100))) LIKE 'בחרו את היחידות שבחוזה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(32), 'units', jsonb_build_array('ארמון'), 'price', 100))) LIKE 'בחרו יחידות מהרשימה%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(32), 'whole', true))) = 'יש למלא את המחיר'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
                   jsonb_build_object('check_in', pg_temp.d(30), 'check_out', pg_temp.d(32), 'whole', true, 'price', 100,
                                      'deposit_method', 'bitcoin'))) LIKE 'אמצעי הפיקדון — יש לבחור מהרשימה'$$,
         :'st', :OWNER68));
SELECT tests.check('checks (event): more participants than the contract allows, a pool window outside the event / pool hours, a half window',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('pool_event', 'customer', NULL, NULL,
                    jsonb_build_object('event_date', pg_temp.d(40), 'start_time', '10:00', 'end_time', '16:00', 'event_type', 'birthday',
                                       'participants', 45, 'price', 2000))) LIKE 'עד 40 משתתפים באירוע%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('pool_event', 'customer', NULL, NULL,
                    jsonb_build_object('event_date', pg_temp.d(40), 'start_time', '10:00', 'end_time', '16:00', 'event_type', 'birthday',
                                       'participants', 20, 'price', 2000, 'pool_start_time', '09:00', 'pool_end_time', '12:00'))) LIKE 'השימוש בבריכה באירוע הזה — רק בין 10:00 ל-16:00%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('pool_event', 'customer', NULL, NULL,
                    jsonb_build_object('event_date', pg_temp.d(40), 'start_time', '10:00', 'end_time', '16:00', 'event_type', 'birthday',
                                       'participants', 20, 'price', 2000, 'pool_start_time', '11:00'))) LIKE 'השימוש בבריכה — יש למלא גם%%'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('pool_event', 'customer', NULL, NULL,
                    jsonb_build_object('event_date', pg_temp.d(40), 'start_time', '19:00', 'end_time', '23:00', 'event_type', 'other',
                                       'participants', 20, 'price', 2000))) = 'יש למלא את סוג האירוע (אחר)'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'business', NULL, '{"full_name": "נועה"}', '{"document_kind": "house_rules"}'))
                 = 'לשליחת המסמך צריך אימייל תקין של הלקוח'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'business', NULL, '{"full_name": "נועה", "email": "לא-אימייל"}', '{"document_kind": "house_rules"}'))
                 = 'כתובת האימייל לא תקינה'
             AND pg_temp.err_of(%1$L, %2$L, pg_temp.create_sql('policy', 'business', %3$L, NULL, '{"document_kind": "house_rules"}')) = 'הלקוח לא נמצא'$$,
         :'st', :OWNER68, gen_random_uuid()));

-- ============================================================
-- 4. Way A — a policy document to a new customer (the business fills, the link by email)
-- ============================================================
SELECT count(*) AS guests_before FROM hospitality.guests WHERE tenant_id = :'st' \gset
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('policy', 'business', NULL,
  '{"full_name": "נועה חדשה", "email": "Noa68@Example.com"}', '{"document_kind": "house_rules"}')) AS a1 \gset
SELECT tests.check('way A: a draft — standalone, business-filled, no booking / event; the title is the document''s; a new customer card; logged and in the action log',
  format($$SELECT %1$L::jsonb ->> 'origin' = 'standalone' AND %1$L::jsonb ->> 'fill_mode' = 'business'
             AND %1$L::jsonb ->> 'status' = 'draft' AND %1$L::jsonb ->> 'kind' = 'policy'
             AND %1$L::jsonb ->> 'title' = 'כללי המקום' AND %1$L::jsonb ->> 'document_kind' = 'house_rules'
             AND %1$L::jsonb ->> 'document_hash' ~ '^[0-9a-f]{64}$' AND %1$L::jsonb ->> 'document_version' = '1'
             AND %1$L::jsonb -> 'booking_type' = 'null'::jsonb AND %1$L::jsonb ->> 'stale' IS NULL
             AND (%1$L::jsonb ->> 'number')::int > 1000
             AND (SELECT booking_id IS NULL AND event_id IS NULL AND guest_id IS NOT NULL AND token_hash IS NULL
                         AND signer_email = 'noa68@example.com' AND data ->> 'document_version' = '1'
                         AND data ->> 'document_hash' = (SELECT body_hash FROM hospitality.site_document_versions
                                                          WHERE tenant_id = %2$L AND kind = 'house_rules' AND version = 1)
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND (SELECT count(*) FROM hospitality.guests WHERE tenant_id = %2$L) = %3$s + 1
             AND EXISTS (SELECT 1 FROM hospitality.guests WHERE tenant_id = %2$L AND email_normalized = 'noa68@example.com')
             AND EXISTS (SELECT 1 FROM hospitality.client_contract_log WHERE contract_id = (%1$L::jsonb ->> 'id')::uuid
                           AND action = 'created' AND details ->> 'origin' = 'standalone' AND (details ->> 'new_customer')::boolean)
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'contracts.created'
                           AND a.target_label = 'מסמך #' || (%1$L::jsonb ->> 'number'))$$,
         :'a1', :'st', :'guests_before'));
SELECT tests.check('way A: never a link to copy (only by email); the email send prepares (the business details for the email)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.contract_link_prepare(%%L)', %3$L)) LIKE 'קישור להעתקה — רק במסמך שהלקוח ממלא%%'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.contract_link_shared(%%L, %%L, NULL)', %1$L, %3$L)) LIKE 'הקישור לא נוצר%%'
             AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.contract_send_prepare(%%L)', %3$L)) ->> 'business_email' = 'docs68@example.com'$$,
         :'st', :OWNER68, (:'a1'::jsonb ->> 'id')));
SELECT pg_temp.send(:'st', (:'a1'::jsonb ->> 'id'), 'tok-a1', true) AS a1s \gset
SELECT pg_temp.srv_err(:'so', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-a1'))) AS a1_other \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_open(%L, %L)', pg_temp.h('tok-a1'), '198.51.100.68')) AS a1o \gset
SELECT tests.check('way A, the customer: another business''s site — not found; here — the document text, nothing to fill but the signature',
  format($$SELECT %1$L LIKE 'הקישור לחתימה לא תקין%%'
             AND %2$L::jsonb ->> 'title' = 'כללי המקום' AND %2$L::jsonb ->> 'origin' = 'standalone'
             AND NOT (%2$L::jsonb ->> 'needs_identity')::boolean AND NOT (%2$L::jsonb ->> 'needs_id_address')::boolean
             AND NOT (%2$L::jsonb ->> 'needs_deposit_method')::boolean
             AND %2$L::jsonb ->> 'body' LIKE '%%שם מלא: נועה חדשה%%' AND strpos(%2$L::jsonb ->> 'body', 'טלפון: ________') > 0
             AND %2$L::jsonb ->> 'body' LIKE '%%אורחים מתבקשים לשמור על הניקיון.%%'$$,
         :'a1_other', :'a1o'));
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-a1', '{}', pg_temp.sig(), true)) AS a1g \gset
SELECT tests.check('way A, signed: once; the published text with the customer''s name, "—" for the missing phone, today''s date; its sha-256; the link dead',
  format($$SELECT %1$L::jsonb ->> 'kind' = 'policy'
             AND (SELECT status = 'signed' AND token_hash IS NULL AND customer_fields = '{}'::jsonb AND signer_ip = '198.51.100.68'
                         AND signed_body LIKE '# כללי המקום%%' AND signed_body LIKE '%%שם מלא: נועה חדשה%%'
                         AND signed_body LIKE '%%טלפון: —%%' AND signed_body LIKE '%%אימייל: noa68@example.com%%'
                         AND signed_body LIKE '%%נחתם ביום: ' || to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'DD.MM.YYYY') || '%%'
                         AND signed_body LIKE '%%- בלי מוזיקה בחוץ%%' AND signed_body NOT LIKE '%%{{%%' AND strpos(signed_body, '________') = 0
                         AND signed_body_sha256 = encode(sha256(convert_to(signed_body, 'UTF8')), 'hex')
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND pg_temp.srv_err(%2$L, pg_temp.sign_sql('tok-a1', '{}', pg_temp.sig(), true)) LIKE 'הקישור לחתימה לא תקין או שכבר שומש%%'$$,
         :'a1g', :'st'));
SELECT tests.check('the owner is notified: one email in the queue per notification address (document_signed — the number, the title, the signer), and "not seen" in the management area',
  format($$SELECT (SELECT count(*) FROM hospitality.notifications n WHERE n.tenant_id = %1$L AND n.event = 'document_signed'
                     AND n.recipient_kind = 'owner' AND n.recipient_email = 'docs68@example.com' AND n.booking_id IS NULL
                     AND n.payload ->> 'contract_id' = %2$L AND n.payload ->> 'title' = 'כללי המקום'
                     AND n.payload ->> 'signer_name' = 'נועה חדשה' AND n.payload ->> 'origin' = 'standalone') = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT hospitality.contracts_unseen()') ->> 'unseen')::int = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT hospitality.contracts_view()') -> 'counts' ->> 'unseen')::int = 1
             AND (pg_temp.call(%1$L, %3$L, 'SELECT hospitality.contracts_view()') -> 'counts' ->> 'standalone')::int = 1
             AND pg_temp.call(%1$L, %3$L, 'SELECT hospitality.contracts_view()') -> 'documents' @> '[{"kind": "house_rules", "title": "כללי המקום", "version": 1}]'::jsonb$$,
         :'st', (:'a1'::jsonb ->> 'id'), :OWNER68));

-- ============================================================
-- 5. Way B — a hosting contract the customer fills (a link to copy)
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('hosting', 'customer', NULL, NULL,
  jsonb_build_object('check_in', pg_temp.d(60), 'check_out', pg_temp.d(63), 'units', jsonb_build_array('אלון', 'אורן', 'אלון'),
                     'price', 2400, 'event_fee', 300))) AS b1 \gset
SELECT tests.check('way B: created with no customer details at all (the customer writes them); no card; the values from what the business filled',
  format($$SELECT %1$L::jsonb ->> 'fill_mode' = 'customer' AND %1$L::jsonb ->> 'signer_name' IS NULL AND %1$L::jsonb ->> 'signer_email' IS NULL
             AND %1$L::jsonb ->> 'booking_type' = 'hosting' AND %1$L::jsonb ->> 'service_date' = %2$L
             AND (SELECT guest_id IS NULL AND data ->> 'nights' = '3' AND data ->> 'price' = '2,400' AND data ->> 'event_fee' = '300'
                         AND data ->> 'units_selected' = '☒ אלון / ☒ אורן / ☐ כל המתחם'
                         AND data ->> 'units_recital' = '2 צימרים ("אלון" ו"אורן")'
                         AND data ->> 'check_in_time' = '15:00' AND data ->> 'compound_address' = 'מושב ישעי 68'
                         AND data ->> 'deposit_amount' = '1,500' AND data -> 'input' -> 'units' = '["אורן", "אלון"]'::jsonb
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)$$,
         :'b1', pg_temp.d(60)));
SELECT tests.check('way B: no email to send to — the email send refused (copy the link instead)',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.contract_send_prepare(%%L)', %3$L)) LIKE 'אין אימייל ללקוח%%'
             AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.contract_link_prepare(%%L)', %3$L)) ->> 'tenant_id' = %1$L$$,
         :'st', :OWNER68, (:'b1'::jsonb ->> 'id')));
SELECT pg_temp.share(:'st', (:'b1'::jsonb ->> 'id'), 'tok-b1-first') AS b1s \gset
SELECT pg_temp.share(:'st', (:'b1'::jsonb ->> 'id'), 'tok-b1') AS b1s2 \gset
SELECT tests.check('way B: the link made for the staff to copy — "sent", only its sha-256 kept, 14 days; a new link kills the previous one; logged (no link in the log)',
  format($$SELECT (SELECT status = 'sent' AND token_hash = pg_temp.h('tok-b1') AND send_count = 2
                          AND token_expires_at BETWEEN now() + interval '13 days' AND now() + interval '15 days'
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contracts WHERE token_hash = pg_temp.h('tok-b1-first'))
             AND (SELECT count(*) FROM hospitality.client_contract_log WHERE contract_id = %1$L AND action = 'link_created') = 2
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contract_log l, jsonb_each_text(l.details) e
                              WHERE l.contract_id = %1$L AND e.value LIKE '%%tok-b1%%')
             AND EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %2$L AND a.action = 'contracts.link_created')
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-b1-first'))) LIKE 'הקישור לחתימה לא תקין%%'$$,
         (:'b1'::jsonb ->> 'id'), :'st'));
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_open(%L)', pg_temp.h('tok-b1'))) AS b1o \gset
SELECT tests.check('way B, the customer: asked for name, email (and phone), ID and address, the deposit method; the blanks in the text',
  format($$SELECT (%1$L::jsonb ->> 'needs_identity')::boolean AND (%1$L::jsonb ->> 'needs_id_address')::boolean
             AND (%1$L::jsonb ->> 'needs_deposit_method')::boolean AND %1$L::jsonb ->> 'signer_name' IS NULL
             AND %1$L::jsonb ->> 'fill_mode' = 'customer'
             AND strpos(%1$L::jsonb ->> 'body', 'שם מלא: ________') > 0 AND strpos(%1$L::jsonb ->> 'body', 'תעודת זהות: ________') > 0
             AND %1$L::jsonb ->> 'body' LIKE '%%בסך של 2,400 ₪%%'$$,
         :'b1o'));
SELECT tests.check('way B, signing: no name, a bad email, a bad phone, a bad ID — refused; still unsigned',
  format($$SELECT pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-b1', '{"email": "yael68@example.com", "id_number": "123456782", "address": "הגפן 3, ישעי", "deposit_method": "cash"}', pg_temp.sig(), true)) = 'יש למלא את השם המלא'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-b1', '{"full_name": "יעל לקוחה", "email": "yael68", "id_number": "123456782", "address": "הגפן 3, ישעי", "deposit_method": "cash"}', pg_temp.sig(), true)) = 'כתובת האימייל לא תקינה'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-b1', '{"full_name": "יעל לקוחה", "email": "yael68@example.com", "phone": "12", "id_number": "123456782", "address": "הגפן 3, ישעי", "deposit_method": "cash"}', pg_temp.sig(), true)) = 'מספר הטלפון לא תקין'
             AND pg_temp.srv_err(%1$L, pg_temp.sign_sql('tok-b1', '{"full_name": "יעל לקוחה", "email": "yael68@example.com", "id_number": "123456789", "address": "הגפן 3, ישעי", "deposit_method": "cash"}', pg_temp.sig(), true)) LIKE 'מספר תעודת הזהות%%'
             AND (SELECT signed_at IS NULL AND signer_name IS NULL FROM hospitality.client_contracts WHERE id = %2$L)$$,
         :'st', (:'b1'::jsonb ->> 'id')));
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-b1', '{"full_name": "יעל לקוחה", "email": "Yael68@Example.com", "phone": "054-6800002",
  "id_number": "123456782", "address": "הגפן 3, ישעי", "deposit_method": "check"}', pg_temp.sig(), true)) AS b1g \gset
SELECT tests.check('way B, signed: the customer''s details on the document (the copy goes to that email) and in the signed text with the ID; the owner notified',
  format($$SELECT (SELECT status = 'signed' AND signer_name = 'יעל לקוחה' AND signer_email = 'yael68@example.com'
                          AND signer_phone = '054-6800002' AND customer_fields ->> 'full_name' = 'יעל לקוחה'
                          AND customer_fields ->> 'id_number' = '123456782' AND customer_fields ->> 'deposit_method' = 'check'
                          AND signed_body LIKE '%%שם מלא: יעל לקוחה%%' AND signed_body LIKE '%%תעודת זהות: 123456782%%'
                          AND signed_body LIKE '%%טלפון נייד: 054-6800002%%' AND signed_body LIKE '%%☐ מזומן / ☒ צ''ק ביטחון%%'
                          AND strpos(signed_body, '________') = 0
                     FROM hospitality.client_contracts WHERE id = %1$L)
             AND EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.tenant_id = %2$L AND n.event = 'document_signed'
                           AND n.payload ->> 'contract_id' = %1$L AND n.payload ->> 'signer_name' = 'יעל לקוחה')
             AND (pg_temp.call(%2$L, %3$L, 'SELECT hospitality.contracts_unseen()') ->> 'unseen')::int = 2$$,
         (:'b1'::jsonb ->> 'id'), :'st', :OWNER68));
INSERT INTO hospitality.guest_sessions (tenant_id, email, token_hash, expires_at)
VALUES (:'st', 'yael68@example.com', pg_temp.h('guest-yael68'), now() + interval '1 day'),
       (:'st', 'noa68@example.com', pg_temp.h('guest-noa68'), now() + interval '1 day');
SELECT tests.check('"my documents": each customer sees only the documents signed with own email (way B — the email the customer wrote); the code login is open to them',
  format($$SELECT jsonb_array_length(pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-yael68')))) = 1
             AND pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-yael68'))) -> 0 ->> 'id' = %2$L
             AND pg_temp.srv(%1$L, format('SELECT hospitality.guest_area_documents(%%L)', pg_temp.h('guest-noa68'))) -> 0 ->> 'title' = 'כללי המקום'
             AND hospitality._guest_area_has_bookings(%1$L, 'yael68@example.com')
             AND NOT hospitality._guest_area_has_bookings(%3$L, 'yael68@example.com')$$,
         :'st', (:'b1'::jsonb ->> 'id'), :'so'));

-- ============================================================
-- 6. Way A — an event contract for an existing customer card
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('pool_event', 'business', :'g_dana', NULL,
  jsonb_build_object('event_date', pg_temp.d(45), 'start_time', '10:00', 'end_time', '20:00', 'event_type', 'bridal_shower',
                     'participants', 30, 'price', 3500, 'deposit_amount', 1000))) AS e1 \gset
SELECT tests.check('event (way A, a chosen customer): the customer from the card (no new card); the event values; the pool window — inside the event and the pool hours',
  format($$SELECT %1$L::jsonb ->> 'signer_email' = 'dana68@example.com' AND %1$L::jsonb ->> 'guest_id' = %2$L
             AND %1$L::jsonb ->> 'booking_type' = 'event' AND %1$L::jsonb ->> 'event_purpose' = 'מסיבת כלה'
             AND (%1$L::jsonb -> 'pool' ->> 'window_known')::boolean
             AND %1$L::jsonb -> 'pool' ->> 'start' = '10:00' AND %1$L::jsonb -> 'pool' ->> 'end' = '18:00'
             AND (SELECT data ->> 'deposit_amount' = '1,000' AND data ->> 'event_late_fee' = '200' AND data ->> 'participants' = '30'
                         AND data ->> 'units_count_text' = '2 הצימרים'
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND (SELECT count(*) FROM hospitality.guests WHERE tenant_id = %3$L AND email_normalized = 'dana68@example.com') = 1$$,
         :'e1', :'g_dana', :'st'));

-- ============================================================
-- 7. The link: one business, once, until it expires
-- ============================================================
SELECT pg_temp.send(:'st', (:'e1'::jsonb ->> 'id'), 'tok-e1', true) IS NOT NULL AS ok \gset
UPDATE hospitality.client_contracts SET token_expires_at = now() - interval '1 minute' WHERE id = (:'e1'::jsonb ->> 'id')::uuid;
SELECT tests.check('the link: expired — refused (and shown as expired to the staff); a linked contract never gets a copy link',
  format($$SELECT pg_temp.srv_err(%1$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-e1'))) LIKE 'הקישור לחתימה פג תוקף%%'
             AND pg_temp.call(%1$L, %2$L, format('SELECT hospitality.staff_contract_detail(%%L)', %3$L)) ->> 'status' = 'expired'
             AND pg_temp.srv_err(%1$L, format('SELECT hospitality.contract_link_shared(%%L, %%L, NULL)', %1$L, %3$L)) LIKE 'הקישור לא נוצר%%'$$,
         :'st', :OWNER68, (:'e1'::jsonb ->> 'id')));

-- ============================================================
-- 8. A signed standalone document never changes; resending the copy changes nothing
-- ============================================================
SELECT signed_body_sha256 AS b1_hash, signed_body AS b1_body FROM hospitality.client_contracts WHERE id = (:'b1'::jsonb ->> 'id')::uuid \gset
DO $$
DECLARE _id uuid := (SELECT id FROM hospitality.client_contracts WHERE signer_email = 'yael68@example.com');
BEGIN
  BEGIN
    UPDATE hospitality.client_contracts SET origin = 'linked' WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its origin', false, 'updated');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its origin', true, SQLERRM);
  END;
  BEGIN
    UPDATE hospitality.client_contracts SET fill_mode = 'business' WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its way of filling', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its way of filling', true, SQLERRM);
  END;
  BEGIN
    UPDATE hospitality.client_contracts SET signer_email = 'other@example.com' WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its signer', false, 'updated');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot change its signer', true, SQLERRM);
  END;
  BEGIN
    DELETE FROM hospitality.client_contracts WHERE id = _id;
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot be deleted', false, 'deleted');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO tests.results (name, ok, detail) VALUES ('a signed standalone document cannot be deleted', true, SQLERRM);
  END;
END $$;
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_pdf_stored(%L, %L, %L, %L, 4096)', :'st',
  (:'b1'::jsonb ->> 'id'), :'st' || '/' || (:'b1'::jsonb ->> 'id') || '.pdf', repeat('d', 64))) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_copy_result(%L, %L, true, NULL, NULL)', :'st', (:'b1'::jsonb ->> 'id'))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER68, format('SELECT hospitality.contract_copy_prepare(%L)', (:'b1'::jsonb ->> 'id'))) AS b1c \gset
SELECT pg_temp.srv(:'st', format('SELECT hospitality.contract_copy_result(%L, %L, true, NULL, %L)', :'st', (:'b1'::jsonb ->> 'id'), :OWNER68)) IS NOT NULL AS ok \gset
SELECT tests.check('resending the signed copy (staff): to the customer''s email; counted and logged — the signed text, its sha-256, the PDF unchanged',
  format($$SELECT %1$L::jsonb ->> 'signer_email' = 'yael68@example.com' AND %1$L::jsonb ->> 'path' IS NOT NULL
             AND (SELECT copy_count = 2 AND signed_body_sha256 = %2$L AND signed_body = %3$L AND pdf_sha256 = repeat('d', 64)
                    FROM hospitality.client_contracts WHERE id = %4$L)
             AND (SELECT count(*) FROM hospitality.client_contract_log WHERE contract_id = %4$L AND action = 'copy_sent') = 2$$,
         :'b1c', :'b1_hash', :'b1_body', (:'b1'::jsonb ->> 'id')));

-- ============================================================
-- 9. The signed documents area: search, filters, the "seen" mark; another business — nothing
-- ============================================================
SELECT tests.check('signed documents: by customer name / email / phone / number / document title; by kind, origin and signed date; only signed ones',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_signed_documents()') ->> 'total')::int = 2
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents('יעל')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents('NOA68@')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents('6800002')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.staff_signed_documents(%%L)$s$, %3$L)) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents('כללי')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents(NULL, 'policy')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents(NULL, NULL, 'linked')$s$) ->> 'total')::int = 0
             AND (pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.staff_signed_documents(NULL, NULL, NULL, %%L, %%L)$s$,
                    current_date - 1, current_date + 1)) ->> 'total')::int = 2
             AND (pg_temp.call(%1$L, %2$L, format($s$SELECT hospitality.staff_signed_documents(NULL, NULL, NULL, %%L)$s$,
                    current_date + 2)) ->> 'total')::int = 0
             AND pg_temp.err_of(%1$L, %2$L, $s$SELECT hospitality.staff_signed_documents(NULL, 'lease')$s$) = 'סוג המסמך לא מוכר'
             AND pg_temp.err_of(%1$L, %2$L, format($s$SELECT hospitality.staff_signed_documents(NULL, NULL, NULL, %%L, %%L)$s$,
                    current_date, current_date - 3)) = 'טווח התאריכים לא תקין'
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts(NULL, 'policy')$s$) ->> 'total')::int = 1
             AND (pg_temp.call(%1$L, %2$L, $s$SELECT hospitality.staff_contracts('כללי')$s$) ->> 'total')::int = 1$$,
         :'st', :OWNER68, (:'b1'::jsonb ->> 'number')));
SELECT pg_temp.call(:'so', :OTHER68, format('SELECT hospitality.contracts_mark_seen(ARRAY[%L, %L]::uuid[])',
  (:'a1'::jsonb ->> 'id'), (:'b1'::jsonb ->> 'id'))) AS other_seen \gset
SELECT tests.check('isolation: another business — no signed documents, cannot open the details, the file or the copy, cannot mark them seen',
  format($$SELECT (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.staff_signed_documents()') ->> 'total')::int = 0
             AND (pg_temp.call(%1$L, %2$L, 'SELECT hospitality.contracts_unseen()') ->> 'unseen')::int = 0
             AND (%3$L::jsonb ->> 'seen')::int = 0
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.staff_contract_detail(%%L)', %4$L)) = 'החוזה לא נמצא'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.contract_file_request(%%L)', %4$L)) LIKE 'אין עדיין קובץ%%'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.contract_copy_prepare(%%L)', %4$L)) = 'החוזה לא נמצא'
             AND pg_temp.err_of(%1$L, %2$L, format('SELECT hospitality.contract_link_prepare(%%L)', %4$L)) = 'המסמך לא נמצא'
             AND (SELECT count(*) FROM hospitality.client_contracts WHERE tenant_id = %5$L AND staff_seen_at IS NOT NULL) = 0$$,
         :'so', :OTHER68, :'other_seen', (:'b1'::jsonb ->> 'id'), :'st'));
SELECT pg_temp.call(:'st', :OWNER68, format('SELECT hospitality.contracts_mark_seen(ARRAY[%L]::uuid[])', (:'b1'::jsonb ->> 'id'))) AS seen1 \gset
SELECT pg_temp.call(:'st', :OWNER68, 'SELECT hospitality.contracts_mark_seen()') AS seen_all \gset
SELECT tests.check('"seen": one by one or all at once — by this business''s staff; then nothing is waiting',
  format($$SELECT (%1$L::jsonb ->> 'seen')::int = 1 AND (%2$L::jsonb ->> 'seen')::int = 1
             AND (pg_temp.call(%3$L, %4$L, 'SELECT hospitality.contracts_unseen()') ->> 'unseen')::int = 0
             AND NOT (pg_temp.call(%3$L, %4$L, 'SELECT hospitality.staff_signed_documents()') -> 'rows' -> 0 ->> 'unseen')::boolean$$,
         :'seen1', :'seen_all', :'st', :OWNER68));

-- ============================================================
-- 10. A document whose details changed cannot be signed
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('policy', 'customer', NULL, '{"email": "late68@example.com"}',
  '{"document_kind": "house_rules"}')) AS p2 \gset
SELECT pg_temp.share(:'st', (:'p2'::jsonb ->> 'id'), 'tok-p2') IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.site_document_save('house_rules', 'כללי המקום',
  E'## שעות שקט\n- בין 23:00 ל-08:00')$q$) AS hr2 \gset
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.site_document_publish('house_rules', 'כללי המקום', %L, %s)$q$,
  E'## שעות שקט\n- בין 23:00 ל-08:00', (:'hr2'::jsonb ->> 'revision'))) IS NOT NULL AS ok \gset
SELECT tests.check('a newer version of the policy was published: the open document is "changed" — the customer cannot sign it, the staff cannot resend it',
  format($$SELECT (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c WHERE c.id = %1$L) = 'changed'
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-p2'))) LIKE 'פרטי המסמך השתנו מאז שנשלח%%'
             AND pg_temp.err_of(%2$L, %3$L, format('SELECT hospitality.contract_link_prepare(%%L)', %1$L)) LIKE 'פרטי העסק / התנאים / גרסת המסמך השתנו%%'
             AND pg_temp.err_of(%2$L, %3$L, format('SELECT hospitality.contract_send_prepare(%%L)', %1$L)) LIKE 'פרטי העסק / התנאים / גרסת המסמך השתנו%%'
             AND (SELECT signed_body LIKE '%%בין 22:00 ל-08:00%%' FROM hospitality.client_contracts WHERE id = %4$L)$$,
         (:'p2'::jsonb ->> 'id'), :'st', :OWNER68, (:'a1'::jsonb ->> 'id')));
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.site_document_unpublish('house_rules')$q$) IS NOT NULL AS ok \gset
SELECT tests.check('the policy was taken off the site: the open document is "unavailable"; the signed one is kept exactly as signed',
  format($$SELECT (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c WHERE c.id = %1$L) = 'unavailable'
             AND pg_temp.srv_err(%2$L, format('SELECT hospitality.contract_open(%%L)', pg_temp.h('tok-p2'))) LIKE 'המסמך כבר לא בתוקף%%'
             AND (SELECT status = 'signed' AND signed_body LIKE '%%בין 22:00 ל-08:00%%' FROM hospitality.client_contracts WHERE id = %3$L)$$,
         (:'p2'::jsonb ->> 'id'), :'st', (:'a1'::jsonb ->> 'id')));
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('hosting', 'business', :'g_dana', NULL,
  jsonb_build_object('check_in', pg_temp.d(70), 'check_out', pg_temp.d(71), 'whole', true, 'price', 900))) AS h2 \gset
UPDATE hospitality.business_terms SET deposit_amount = 2500 WHERE tenant_id = :'st';
SELECT tests.check('a standalone contract whose business terms changed (the deposit) is "changed"; the event contract is not (its deposit was set)',
  format($$SELECT (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c WHERE c.id = %1$L) = 'changed'
             AND (SELECT data ->> 'units_selected' = '☐ אלון / ☐ אורן / ☒ כל המתחם' FROM hospitality.client_contracts WHERE id = %1$L)
             AND (SELECT hospitality._contract_stale(c) FROM hospitality.client_contracts c WHERE c.id = %2$L) IS NULL$$,
         (:'h2'::jsonb ->> 'id'), (:'e1'::jsonb ->> 'id')));
UPDATE hospitality.business_terms SET deposit_amount = 1500 WHERE tenant_id = :'st';

-- ============================================================
-- 11. A contract of a booking (linked) — unchanged, and now it also notifies the owner
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.contract_create('hosting', %L, NULL)$q$, :'bk')) AS l1 \gset
SELECT pg_temp.send(:'st', (:'l1'::jsonb ->> 'id'), 'tok-l1', true) IS NOT NULL AS ok \gset
SELECT pg_temp.srv(:'st', pg_temp.sign_sql('tok-l1', '{"id_number": "123456782", "address": "האלה 5, ישעי", "deposit_method": "cash", "full_name": "מישהו אחר", "email": "evil@example.com"}',
  pg_temp.sig(), true)) AS l1g \gset
SELECT tests.check('a booking contract: origin linked, business-filled; the customer cannot replace the signer''s name / email; signed; the owner notified (with the booking number)',
  format($$SELECT %1$L::jsonb ->> 'origin' = 'linked' AND %1$L::jsonb ->> 'fill_mode' = 'business'
             AND (SELECT status = 'signed' AND signer_name = 'דנה קיימת' AND signer_email = 'dana68@example.com'
                         AND NOT (customer_fields ? 'full_name') AND NOT (customer_fields ? 'email')
                         AND signed_body LIKE '%%שם מלא: דנה קיימת%%' AND signed_body NOT LIKE '%%מישהו אחר%%'
                    FROM hospitality.client_contracts WHERE id = (%1$L::jsonb ->> 'id')::uuid)
             AND EXISTS (SELECT 1 FROM hospitality.notifications n WHERE n.tenant_id = %2$L AND n.event = 'document_signed'
                           AND n.payload ->> 'contract_id' = %1$L::jsonb ->> 'id' AND n.payload ->> 'origin' = 'linked'
                           AND n.payload ->> 'kind' = 'hosting' AND n.payload ->> 'link_number' IS NOT NULL)$$,
         :'l1', :'st'));

-- ============================================================
-- 12. Privacy: deleting a customer's details; the export
-- ============================================================
SELECT pg_temp.call(:'st', :OWNER68, $q$SELECT hospitality.site_document_save('booking_terms', 'תנאי ההזמנה',
  E'## ההזמנה\n- ההזמנה מאושרת רק אחרי אישור העסק')$q$) AS bt \gset
SELECT pg_temp.call(:'st', :OWNER68, format($q$SELECT hospitality.site_document_publish('booking_terms', 'תנאי ההזמנה', %L, %s)$q$,
  E'## ההזמנה\n- ההזמנה מאושרת רק אחרי אישור העסק', (:'bt'::jsonb ->> 'revision'))) IS NOT NULL AS ok \gset
SELECT pg_temp.call(:'st', :OWNER68, pg_temp.create_sql('policy', 'customer', NULL, '{"email": "noa68@example.com"}',
  '{"document_kind": "booking_terms"}')) AS q1 \gset
SELECT guest_id AS g_noa FROM hospitality.client_contracts WHERE id = (:'a1'::jsonb ->> 'id')::uuid \gset
SELECT pg_temp.call(:'st', :OWNER68, format('SELECT hospitality.export_guest_logged(%L)', :'g_noa')) AS exp1 \gset
SELECT COALESCE(pg_temp.err_of(:'st', :OWNER68, format($s$SELECT to_jsonb(hospitality.anonymize_guest(%L))$s$, :'g_noa')), 'ok') AS anon1 \gset
SELECT tests.check('privacy: the export lists the standalone documents (also by email, with no card); deleting the details removes the unsigned one (found by email) and keeps the signed one',
  format($$SELECT jsonb_array_length(%1$L::jsonb -> 'contracts') = 2
             AND %1$L::jsonb -> 'contracts' @> '[{"status": "signed", "origin": "standalone", "title": "כללי המקום"}]'::jsonb
             AND %1$L::jsonb -> 'contracts' @> '[{"status": "draft", "title": "תנאי ההזמנה"}]'::jsonb
             AND %2$L = 'ok'
             AND NOT EXISTS (SELECT 1 FROM hospitality.client_contracts WHERE id = (%3$L::jsonb ->> 'id')::uuid)
             AND (SELECT status = 'signed' AND signer_name = 'נועה חדשה' FROM hospitality.client_contracts WHERE id = (%4$L::jsonb ->> 'id')::uuid)$$,
         :'exp1', :'anon1', :'q1', :'a1'));

-- ---------- cleanup: the platform flags as they were ----------
UPDATE public.platform_feature_flags f SET enabled = m.enabled FROM m68_flags m WHERE f.key = m.key;
DROP TABLE m68_flags;

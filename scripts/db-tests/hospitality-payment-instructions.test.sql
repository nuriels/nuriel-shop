-- ============================================================
-- Hospitality — payment instructions for guests (20261105140000_hosp_payment_instructions.sql, migration 37)
--   • the table: RLS, no direct grants, isolation + backend policies, tenant guard;
--   • staff view (settings permission) — owner and manager; save — the owner only (where the money goes);
--   • validation, revision (parallel edit), audit without values;
--   • the guest sees the details only for their own booking (token), only when it is approved and money
--     is still due; before approval — only which methods exist; never another business's details;
--   • instructions never change the payment status (only the payments ledger does);
--   • the public site gets only which methods exist; emails — server only;
--   • the setup guide's "payment" step follows.
-- ============================================================
\set OWNER_P '''a0000000-0000-0000-0000-000000037a01'''
\set MGR_P '''a0000000-0000-0000-0000-000000037a02'''
\set OWNER_X '''a0000000-0000-0000-0000-000000037a03'''
\set PP '''73700000-0000-0000-0000-0000000000f1'''
\set P1 '''73700000-0000-0000-0000-0000000000a1'''
\set XP '''73700000-0000-0000-0000-0000000000f2'''
\set X1 '''73700000-0000-0000-0000-0000000000b1'''

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
CREATE OR REPLACE FUNCTION pg_temp.manual(_site text, _uid uuid, _unit uuid, _in date, _out date,
                                          _status text DEFAULT 'confirmed') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format(
    'SELECT hospitality.create_manual_booking(_unit_id => %L, _check_in => %L, _check_out => %L, _full_name => %L,
       _phone => %L, _terms_explained => true, _status => %L)',
    _unit, _in, _out, 'אורח בדיקה', '0541234567', _status));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.view(_site text, _uid uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, 'SELECT hospitality.payment_settings_view()');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.save(_site text, _uid uuid, _changes text, _rev integer) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, _uid, format('SELECT hospitality.payment_settings_save(%L::jsonb, %s)', _changes, _rev));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.guest(_site text, _token text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.call(_site, NULL, format('SELECT hospitality.guest_payment_info(%L)', _token));
$f$;

-- ---------- fixtures ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a0000000-0000-0000-0000-000000037a01', 'm37.owner@test.local', now()),
  ('a0000000-0000-0000-0000-000000037a02', 'm37.manager@test.local', now()),
  ('a0000000-0000-0000-0000-000000037a03', 'm37.other@test.local', now())
ON CONFLICT DO NOTHING;
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m37-pay', 'צימרי התשלום', 'm37.owner@test.local')$$) ->> 'id' AS sp \gset
SELECT pg_temp.as_platform($$SELECT hospitality.admin_open_site('m37-other', 'עסק אחר 37', 'm37.other@test.local')$$) ->> 'id' AS sx \gset
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name) VALUES
  (:'sp', :OWNER_P, 'm37.owner@test.local', 'm37_owner', 'admin', true, 'שירה'),
  (:'sp', :MGR_P, 'm37.manager@test.local', 'm37_manager', 'admin', true, 'עומר'),
  (:'sx', :OWNER_X, 'm37.other@test.local', 'm37_other', 'admin', true, NULL);
SELECT pg_temp.as_platform(format($$SELECT to_jsonb(ARRAY[
     public.platform_set_flag('hospitality_backend_enabled', true),
     public.platform_set_flag('hospitality_management_enabled', true),
     public.platform_set_flag('hospitality_backend_enabled', true, %1$L),
     public.platform_set_flag('hospitality_management_enabled', true, %1$L),
     public.platform_set_flag('hospitality_backend_enabled', true, %2$L),
     public.platform_set_flag('hospitality_management_enabled', true, %2$L)])$$, :'sp', :'sx')) IS NOT NULL AS ok \gset
UPDATE hospitality.settings SET contact_phone = '04-6001234' WHERE tenant_id = :'sp';
INSERT INTO hospitality.properties (id, tenant_id, name, slug, status) VALUES
  (:PP, :'sp', 'מתחם התשלום', 'm37-p', 'active'),
  (:XP, :'sx', 'מתחם אחר', 'm37-x', 'active');
INSERT INTO hospitality.units (id, tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price) VALUES
  (:P1, :'sp', :PP, 'unit', 'בקתת התשלום', 'm37-p1', 4, 2, 500),
  (:X1, :'sx', :XP, 'unit', 'יחידה זרה', 'm37-x1', 4, 2, 500);

-- ============================================================
-- 1. The table and who may call what
-- ============================================================
SELECT tests.check('payments (37): the table has RLS, no direct grants, restrictive isolation + backend policies and the tenant guard',
  $$SELECT c.relrowsecurity
       AND NOT bool_or(has_table_privilege(r, 'hospitality.payment_settings', p))
       AND (SELECT count(*) FROM pg_policies x WHERE x.schemaname = 'hospitality' AND x.tablename = 'payment_settings'
              AND x.permissive = 'RESTRICTIVE' AND x.policyname IN ('tenant_isolation', 'backend_enabled')) = 2
       AND EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'tenant_guard')
      FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
     WHERE c.oid = 'hospitality.payment_settings'::regclass
     GROUP BY c.relrowsecurity, c.oid$$);
SELECT tests.check('payments (37): staff functions are not for guests; the email helper is for the server only',
  $$SELECT NOT has_function_privilege('anon', 'hospitality.payment_settings_view()', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.payment_settings_save(jsonb,integer)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'hospitality.email_payment_methods(uuid)', 'EXECUTE')
       AND NOT has_function_privilege('anon', 'hospitality.email_payment_methods(uuid)', 'EXECUTE')
       AND has_function_privilege('service_role', 'hospitality.email_payment_methods(uuid)', 'EXECUTE')$$);

-- ============================================================
-- 2. Staff: defaults, owner saves, manager reads only, other business refused
-- ============================================================
SELECT tests.check('payments: a new business — phone payment as today, nothing else; the owner may edit, the manager may not',
  format($$SELECT pg_temp.view(%1$L, %2$L) -> 'methods' = '["phone"]'::jsonb
             AND (pg_temp.view(%1$L, %2$L) ->> 'revision')::int = 0
             AND (pg_temp.view(%1$L, %2$L) ->> 'editable')::boolean
             AND NOT (pg_temp.view(%1$L, %3$L) ->> 'editable')::boolean
             AND pg_temp.view(%1$L, %2$L) ->> 'business_phone' = '04-6001234'$$, :'sp', :OWNER_P, :MGR_P));
SELECT pg_temp.save(:'sp', :OWNER_P,
  '{"bank_enabled": true, "bank_name": "  בנק  הפועלים ", "bank_branch": "612", "bank_account": "123 456", "bank_holder": "שירה כהן",
    "bit_enabled": true, "bit_phone": "052 1234567", "note": "בהעברה — ציינו את מספר ההזמנה."}', 0) AS saved \gset
SELECT tests.check('payments: the owner saves bank transfer, Bit and a note — cleaned, revision 1, methods in a fixed order',
  format($$SELECT %1$L::jsonb -> 'methods' = '["bank", "bit", "phone", "note"]'::jsonb
             AND %1$L::jsonb ->> 'bank_name' = 'בנק הפועלים' AND %1$L::jsonb ->> 'bank_account' = '123456'
             AND %1$L::jsonb ->> 'bit_phone' = '0521234567' AND (%1$L::jsonb ->> 'revision')::int = 1$$, :'saved'));
SELECT tests.check('payments: a manager reads the same details but cannot change where the money goes',
  format($$SELECT pg_temp.view(%1$L, %2$L) ->> 'bank_account' = '123456'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bank_account": "999999"}''::jsonb, 1)') LIKE '%%רק בעלי העסק%%'
             AND (SELECT bank_account FROM hospitality.payment_settings WHERE tenant_id = %1$L) = '123456'$$, :'sp', :MGR_P));
SELECT tests.check('payments: another business''s owner and guests get nothing of this business',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_view()') LIKE '%%אין הרשאה%%'
             AND pg_temp.err_of(%1$L, NULL, 'SELECT hospitality.payment_settings_view()') LIKE '%%permission denied%%'
             AND pg_temp.view(%3$L, %2$L) -> 'methods' = '["phone"]'::jsonb$$, :'sp', :OWNER_X, :'sx'));
SELECT tests.check('payments: validation — complete bank details, branch, account, Bit mobile, unknown field, wrong type',
  format($$SELECT pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bank_holder": ""}''::jsonb, 1)') LIKE '%%בנק, סניף, מספר חשבון%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bank_branch": "12345"}''::jsonb, 1)') LIKE '%%סניף%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bank_account": "12"}''::jsonb, 1)') LIKE '%%מספר חשבון%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bit_phone": "031234567"}''::jsonb, 1)') LIKE '%%Bit%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"iban": "x"}''::jsonb, 1)') LIKE '%%שדה לא מוכר%%'
             AND pg_temp.err_of(%1$L, %2$L, 'SELECT hospitality.payment_settings_save(''{"bank_enabled": "yes"}''::jsonb, 1)') LIKE '%%ערך לא תקין%%'
             AND (SELECT revision FROM hospitality.payment_settings WHERE tenant_id = %1$L) = 1$$, :'sp', :OWNER_P));
SELECT tests.check('payments: an edit from an old screen (stale revision) is refused',
  format($$SELECT pg_temp.err_of(%L, %L, 'SELECT hospitality.payment_settings_save(''{"note": "x"}''::jsonb, 0)') LIKE '%%השתנו בינתיים%%'$$,
         :'sp', :OWNER_P));
SELECT tests.check('payments: the change is in the business action log — which fields, never the values',
  format($$SELECT EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L AND a.action = 'payments.instructions_updated'
                            AND a.changes ? 'bank_account' AND a.changes ? 'bit_phone')
             AND NOT EXISTS (SELECT 1 FROM hospitality.audit_log a WHERE a.tenant_id = %1$L
                              AND (a.changes::text LIKE '%%123456%%' OR a.changes::text LIKE '%%0521234567%%'))$$, :'sp'));

-- ============================================================
-- 3. The guest: their own booking only, after approval, while money is due
-- ============================================================
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(30), pg_temp.d(32), 'pending_approval') ->> 'manage_token' AS pending_token \gset
SELECT tests.check('guest: a request not approved yet — which methods exist, but no account details',
  format($$SELECT NOT (g ->> 'available')::boolean AND g ->> 'reason' = 'not_confirmed'
             AND g -> 'methods' = '["bank", "bit", "phone", "note"]'::jsonb
             AND g::text NOT LIKE '%%123456%%' AND g::text NOT LIKE '%%0521234567%%'
            FROM pg_temp.guest(%L, %L) g$$, :'sp', :'pending_token'));
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(40), pg_temp.d(42)) AS bk_json \gset
SELECT (:'bk_json'::jsonb) ->> 'booking_id' AS bk, (:'bk_json'::jsonb) ->> 'manage_token' AS bk_token \gset
SELECT tests.check('guest: an approved booking — the details, the amount due and the booking number as the reference',
  format($$SELECT (g ->> 'available')::boolean
             AND g -> 'bank' = '{"name": "בנק הפועלים", "branch": "612", "account": "123456", "holder": "שירה כהן"}'::jsonb
             AND g -> 'bit' = '{"phone": "0521234567"}'::jsonb
             AND g -> 'phone' = '{"number": "04-6001234"}'::jsonb
             AND g ->> 'note' = 'בהעברה — ציינו את מספר ההזמנה.'
             AND (g ->> 'amount_due')::numeric = (SELECT total FROM hospitality.bookings WHERE id = %3$L)
             AND g ->> 'reference' = '#' || (SELECT number FROM hospitality.bookings WHERE id = %3$L)
            FROM pg_temp.guest(%1$L, %2$L) g$$, :'sp', :'bk_token', :'bk'));
SELECT tests.check('guest: instructions are not a payment — the booking is still unpaid after the guest reads them',
  format($$SELECT payment_status = 'unpaid' AND amount_paid = 0 FROM hospitality.bookings WHERE id = %L$$, :'bk'));
SELECT pg_temp.call(:'sp', :OWNER_P, format($$SELECT hospitality.payment_record(%L, 'deposit', 'transfer', 300, current_date)$$, :'bk')) IS NOT NULL AS ok \gset
SELECT tests.check('guest: after the business records 300 received — the amount due drops by 300 (only the ledger moves it)',
  format($$SELECT (g ->> 'amount_due')::numeric = (SELECT total - 300 FROM hospitality.bookings WHERE id = %3$L)
             AND (SELECT payment_status FROM hospitality.bookings WHERE id = %3$L) = 'deposit_paid'
            FROM pg_temp.guest(%1$L, %2$L) g$$, :'sp', :'bk_token', :'bk'));
SELECT pg_temp.call(:'sp', :OWNER_P, format($$SELECT hospitality.payment_record(%L, 'balance', 'transfer', %s, current_date)$$,
       :'bk', (SELECT total - 300 FROM hospitality.bookings WHERE id = :'bk'))) IS NOT NULL AS ok \gset
SELECT tests.check('guest: paid in full — no details any more ("paid")',
  format($$SELECT NOT (g ->> 'available')::boolean AND g ->> 'reason' = 'paid' AND g::text NOT LIKE '%%123456%%'
            FROM pg_temp.guest(%L, %L) g$$, :'sp', :'bk_token'));
SELECT tests.check('guest: a wrong token, or this business''s token on another business''s address → not found',
  format($$SELECT pg_temp.err_of(%1$L, NULL, format('SELECT hospitality.guest_payment_info(%%L)', repeat('a', 64))) LIKE '%%לא נמצאה%%'
             AND pg_temp.err_of(%2$L, NULL, format('SELECT hospitality.guest_payment_info(%%L)', %3$L)) LIKE '%%לא נמצאה%%'$$,
         :'sp', :'sx', :'pending_token'));
SELECT pg_temp.manual(:'sp', :OWNER_P, :P1, pg_temp.d(50), pg_temp.d(51)) AS bk2_json \gset
SELECT (:'bk2_json'::jsonb) ->> 'booking_id' AS bk2, (:'bk2_json'::jsonb) ->> 'manage_token' AS bk2_token \gset
SELECT pg_temp.call(:'sp', :OWNER_P, format($$SELECT to_jsonb(hospitality.cancel_booking(%L, 'בדיקה'))$$, :'bk2')) IS NOT NULL AS ok \gset
SELECT tests.check('guest: a cancelled booking — no details ("closed")',
  format($$SELECT g ->> 'reason' = 'closed' AND g::text NOT LIKE '%%123456%%' FROM pg_temp.guest(%L, %L) g$$, :'sp', :'bk2_token'));

-- ============================================================
-- 4. The public site and emails: which methods only
-- ============================================================
-- migration 55: bank transfer is offered only for an arrival at least 7 days away (the site sends the arrival date)
SELECT tests.check('site: guests see which methods the business takes — no details; another business keeps its own',
  format($$SELECT pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(30))) -> 'methods'
                = '["bank", "bit", "phone", "note"]'::jsonb
             AND pg_temp.call(%1$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(30)))::text NOT LIKE '%%123456%%'
             AND pg_temp.call(%2$L, NULL, format('SELECT hospitality.public_payment_methods(%%L)', pg_temp.d(30))) -> 'methods'
                = '["phone"]'::jsonb$$,
         :'sp', :'sx'));
SELECT tests.check('emails: the server learns which methods to mention (no details)',
  format($$SELECT hospitality.email_payment_methods(%L) = ARRAY['bank', 'bit', 'phone', 'note']$$, :'sp'));
SELECT pg_temp.save(:'sp', :OWNER_P, '{"phone_enabled": false, "bit_enabled": false, "note": ""}', 1) IS NOT NULL AS ok \gset
SELECT tests.check('payments: switching methods off and clearing the note — bank transfer only',
  format($$SELECT pg_temp.view(%L, %L) -> 'methods' = '["bank"]'::jsonb$$, :'sp', :OWNER_P));

-- ============================================================
-- 5. The setup guide
-- ============================================================
SELECT tests.check('setup guide: "payment" is done once payment instructions were saved, and lists the methods',
  format($$SELECT (g -> 'steps' -> 'payments' ->> 'done')::boolean AND (g -> 'steps' -> 'payments' ->> 'configured')::boolean
             AND g -> 'steps' -> 'payments' -> 'methods' = '["bank"]'::jsonb
             AND NOT (x -> 'steps' -> 'payments' ->> 'configured')::boolean
            FROM pg_temp.call(%1$L, %2$L, 'SELECT hospitality.setup_guide()') g,
                 pg_temp.call(%3$L, %4$L, 'SELECT hospitality.setup_guide()') x$$, :'sp', :OWNER_P, :'sx', :OWNER_X));

-- ---------- cleanup: the platform-wide switches back off (other test files expect them off) ----------
SELECT pg_temp.as_platform($$SELECT to_jsonb(ARRAY[public.platform_set_flag('hospitality_backend_enabled', false),
                                    public.platform_set_flag('hospitality_management_enabled', false)])$$) IS NOT NULL AS ok \gset

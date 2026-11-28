-- ============================================================
-- Online card payments (migration 208, MAX / Hyp Pay hosted page) — DEMO stage, D3 database tests.
-- Test names carry the DM-* IDs of MAX-DEMO-PLAN.md Appendix D.
-- Rules of this file (plan §7.3):
--   • store B is the main actor everywhere — a NON-default store (the default store would hide a fallback to it);
--     store A is "the other store"; store D is deleted at the end (decision 15); store E's owner is also a platform
--     admin, store F's owner is blocked (each store keeps exactly one owner); every store here is this file's own.
--   • every server call runs as service_role with no signed-in user and NO store header (like the app's server);
--     the owner's two reads run as the signed-in user with the store header (like my_billing_summary).
--   • billing.ledger cannot be cleaned (append-only) and billing-agreements.test.sql — which runs before this file —
--     checks the whole ledger has no provider row: this file writes provider rows for its own stores only and asserts
--     on its own stores only.
--   • fake values only: terminal numbers are built from two parts at run time, credentials are obviously fake sealed
--     tokens ('…FAKE-…'), transaction ids are 'fake-…'. No real or published card, terminal or credential.
--   • the production rehearsal runs inside a sub-transaction that is always rolled back (a database that held live
--     data can never become DEMO, and a DEMO database never becomes production). The file leaves the database
--     unmarked and both switches off.
-- ============================================================
\set PLAT '''a0000000-0000-0000-0000-0000000000f0'''
\set PLAT2 '''c2080000-0000-4000-8000-0000000000f2'''
\set PLAT3 '''c2080000-0000-4000-8000-0000000000f3'''
\set SA '''c2080000-0000-4000-8000-00000000000a'''
\set SB '''c2080000-0000-4000-8000-00000000000b'''
\set SD '''c2080000-0000-4000-8000-00000000000d'''
\set SE '''c2080000-0000-4000-8000-00000000000e'''
\set SF '''c2080000-0000-4000-8000-00000000000f'''
\set SH '''c2080000-0000-4000-8000-0000000000e0'''
\set DEFAULT_STORE '''00000000-0000-0000-0000-000000000001'''
\set A_OWNER '''c2080000-0000-4000-8000-0000000000a1'''
\set B_OWNER '''c2080000-0000-4000-8000-0000000000b1'''
\set B_MGR '''c2080000-0000-4000-8000-0000000000b2'''
\set B_AGENT '''c2080000-0000-4000-8000-0000000000b3'''
\set A_BLOCKED '''c2080000-0000-4000-8000-0000000000a4'''
\set D_OWNER '''c2080000-0000-4000-8000-0000000000d1'''
\set H_OWNER '''c2080000-0000-4000-8000-0000000000e1'''
\set H_ADMIN '''c2080000-0000-4000-8000-0000000000e2'''
\set C1 '''c2080000-0000-4000-8000-0000000000c1'''
\set C2 '''c2080000-0000-4000-8000-0000000000c2'''
\set C3 '''c2080000-0000-4000-8000-0000000000c3'''
\set C4 '''c2080000-0000-4000-8000-0000000000c4'''
\set C5 '''c2080000-0000-4000-8000-0000000000c5'''
\set CA '''c2080000-0000-4000-8000-0000000000ca'''
\set CD '''c2080000-0000-4000-8000-0000000000cd'''
\set P10 '''c2080000-0000-4000-8000-00000000b010'''
\set P60 '''c2080000-0000-4000-8000-00000000b060'''
\set PA10 '''c2080000-0000-4000-8000-00000000a010'''
\set PD10 '''c2080000-0000-4000-8000-00000000d010'''
\set PM3 '''c2080000-0000-4000-8000-00000000b013'''
\set PV '''c2080000-0000-4000-8000-00000000b014'''
\set VR1 '''c2080000-0000-4000-8000-00000000f101'''
\set VR2 '''c2080000-0000-4000-8000-00000000f102'''
\set SHIP_B '''c2080000-0000-4000-8000-00000000500b'''
\set SHIP_A '''c2080000-0000-4000-8000-00000000500a'''
\set SHIP_D '''c2080000-0000-4000-8000-00000000500d'''

-- fake terminal numbers, assembled at run time (no 10-digit literal in the repository); 00100… = Hyp's documented
-- test prefix; the last one is "live-shaped" (for the production rehearsal only)
SELECT '00100' || '99991' AS t_plat, '00100' || '99992' AS t_a, '00100' || '99993' AS t_b,
       '00100' || '99994' AS t_b2, '00100' || '99995' AS t_d, '00100' || '99998' AS t_spare,
       '70000' || '99996' AS t_live, '70000' || '99997' AS t_live_plat \gset

-- ---------- helpers ----------
-- the app's server: service_role, no signed-in user, no store header
CREATE OR REPLACE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.svc_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.svc(_sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  RETURN e;
END $f$;
-- a signed-in user (or anon when _uid is NULL) on a store's address (the x-tenant-id header), as the browser
CREATE OR REPLACE FUNCTION pg_temp.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
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
CREATE OR REPLACE FUNCTION pg_temp.err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    PERFORM pg_temp.call(_site, _uid, _sql);
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN e;
END $f$;
-- the error of a statement run as the database owner
CREATE OR REPLACE FUNCTION pg_temp.db_err(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE e text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN e := SQLERRM;
  END;
  RETURN e;
END $f$;
-- runs the steps in order inside a sub-transaction that is ALWAYS rolled back; per step 'ok:<value>' or 'error:<message>'
CREATE OR REPLACE FUNCTION pg_temp.probe(_steps text[]) RETURNS text[] LANGUAGE plpgsql AS $f$
DECLARE
  _out text[] := '{}';
  _s   text;
  _v   text;
BEGIN
  BEGIN
    FOREACH _s IN ARRAY _steps LOOP
      BEGIN
        EXECUTE _s INTO _v;
        _out := _out || ('ok:' || COALESCE(_v, ''));
      EXCEPTION WHEN OTHERS THEN
        _out := _out || ('error:' || SQLERRM);
      END;
      RESET ROLE;
    END LOOP;
    RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'P0001';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  RETURN _out;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.h(_s text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex');
$f$;
-- an obviously fake sealed token in the app's exact format v1:<kid 8 hex>:<iv 16>:<tag 22>:<ct> (base64url, no padding)
CREATE OR REPLACE FUNCTION pg_temp.tok(_label text, _kid text DEFAULT '0badc0de') RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'v1:' || _kid || ':IVfakeIVfakeIV00:TAGfakeTAGfakeTAGfake0:FAKE-' || _label;
$f$;
-- a signed-in customer's order on the store's address (place_order, as the browser sends it)
CREATE OR REPLACE FUNCTION pg_temp.order_of(_site uuid, _cust uuid, _product uuid, _ship uuid, _qty integer, _method text)
RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (pg_temp.call(_site::text, _cust, format(
    $q$SELECT to_jsonb(x) FROM public.place_order('order',
         jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', %s, 'unit_price', 10)), 18, true,
         jsonb_build_object('customer_name', 'לקוח תשלום מקוון', 'customer_tax_id', '123456782',
           'customer_phone', '0501234567', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1',
           'billing_zip', '6100001', 'accepted_terms', true, 'shipping_method_id', %L, 'payment_method', %L)) x$q$,
    _product, _qty, _ship, _method)) ->> 'id')::uuid;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.t_open(_tenant uuid, _order uuid, _cust uuid, _env text DEFAULT 'demo')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', _tenant, _order, _cust, _env));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.t_sign(_tenant uuid, _attempt text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_signed(%L, %L, true, NULL)', _tenant, _attempt));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.t_ret(_host uuid, _ref text, _payload text, _ccode text, _txn text, _amount bigint)
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_record_return(%L, %L, %L, %L, %L, %L, NULL)',
                            _host, _ref, _payload, _ccode, _txn, _amount));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.t_settle(_tenant uuid, _ref text, _payload text, _verify text, _ccode text,
  _terminal text, _txn text, _amount bigint, _currency text DEFAULT 'ILS', _inst integer DEFAULT 1,
  _flags text[] DEFAULT '{}', _env text DEFAULT 'demo') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    _tenant, _ref, _payload, _verify, _ccode, _terminal, _txn, _amount, _currency, _inst, 'A0001', 'visa', '0000',
    _flags, _env));
$f$;
-- the whole store path up to the settle: open → SIGN ok → browser return → VERIFY 0 → mark_paid with these values
CREATE OR REPLACE FUNCTION pg_temp.t_pay(_tenant uuid, _order uuid, _cust uuid, _txn text, _ccode text DEFAULT '0',
  _amount bigint DEFAULT NULL, _currency text DEFAULT 'ILS', _inst integer DEFAULT 1, _flags text[] DEFAULT '{}',
  _terminal text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o jsonb; r jsonb; _p text;
BEGIN
  o := pg_temp.t_open(_tenant, _order, _cust);
  PERFORM pg_temp.t_sign(_tenant, o ->> 'attempt_id');
  _p := pg_temp.h(format('fake-return|%s|%s|%s', o ->> 'reference', _txn, _ccode));
  PERFORM pg_temp.t_ret(_tenant, o ->> 'reference', _p, _ccode, _txn, COALESCE(_amount, (o ->> 'amount_minor')::bigint));
  r := pg_temp.t_settle(_tenant, o ->> 'reference', _p, '0', _ccode, COALESCE(_terminal, o ->> 'terminal_number'), _txn,
                        COALESCE(_amount, (o ->> 'amount_minor')::bigint), _currency, _inst, _flags);
  RETURN r || jsonb_build_object('reference', o ->> 'reference', 'payload', _p, 'opened', o);
END $f$;
-- a consumed step-up code of this platform admin (fake HMAC / purpose hash repeat('p', 64): the DB compares opaque
-- strings): {ok, challenge_id} — platform_terminal_save names that exact challenge and purpose (review L7)
CREATE OR REPLACE FUNCTION pg_temp.stepup(_actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE c jsonb;
BEGIN
  c := pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', _actor, repeat('p', 64), repeat('c', 64)));
  RETURN pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', _actor, c ->> 'challenge_id',
                            repeat('p', 64), repeat('c', 64))) || jsonb_build_object('challenge_id', c ->> 'challenge_id');
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_open(_actor uuid, _tenant uuid, _charge uuid, _origin text DEFAULT NULL,
  _env text DEFAULT 'demo') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)',
                            _actor, _tenant, 'ledger_charge', _charge, _origin, _env));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.p_settle(_ref text, _payload text, _verify text, _ccode text, _terminal text,
  _txn text, _amount bigint, _flags text[] DEFAULT '{}', _env text DEFAULT 'demo') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.platform_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
    _ref, _payload, _verify, _ccode, _terminal, _txn, _amount, 'ILS', 1, 'A0002', 'mastercard', '0000', _flags, _env));
$f$;
-- the whole platform path: open → SIGN ok → return on the platform host → VERIFY 0 → mark_paid
CREATE OR REPLACE FUNCTION pg_temp.p_pay(_actor uuid, _tenant uuid, _charge uuid, _txn text, _ccode text DEFAULT '0',
  _flags text[] DEFAULT '{}', _origin text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o jsonb; r jsonb; _p text;
BEGIN
  o := pg_temp.p_open(_actor, _tenant, _charge, _origin);
  PERFORM pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', o ->> 'attempt_id'));
  _p := pg_temp.h(format('fake-platform-return|%s|%s|%s', o ->> 'reference', _txn, _ccode));
  PERFORM pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)',
                             o ->> 'reference', _p, _ccode, _txn, o ->> 'amount_minor'));
  r := pg_temp.p_settle(o ->> 'reference', _p, '0', _ccode, o ->> 'terminal_number', _txn,
                        (o ->> 'amount_minor')::bigint, _flags);
  RETURN r || jsonb_build_object('reference', o ->> 'reference', 'payload', _p, 'opened', o);
END $f$;

-- ---------- fixtures: stores A, B (main), D (deleted at the end), a hospitality site H; people; products ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('c2080000-0000-4000-8000-0000000000f2', 'op.plat2@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000f3', 'op.plat3@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000a1', 'op.a.owner@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000b1', 'op.b.owner@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000b2', 'op.b.mgr@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000b3', 'op.b.agent@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000a4', 'op.a.blocked@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000d1', 'op.d.owner@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000e1', 'op.h.owner@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000e2', 'op.h.admin@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000c1', 'op.b.c1@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000c2', 'op.b.c2@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000c3', 'op.b.c3@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000c4', 'op.b.c4@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000c5', 'op.b.c5@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000ca', 'op.a.c1@test.local', now()),
  ('c2080000-0000-4000-8000-0000000000cd', 'op.d.c1@test.local', now())
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  (:SA, 'op-store-a', 'חנות תשלומים A', 'op.a.owner@test.local'),
  (:SB, 'op-store-b', 'חנות תשלומים B', 'op.b.owner@test.local'),
  (:SD, 'op-store-d', 'חנות תשלומים D', 'op.d.owner@test.local'),
  (:SE, 'op-store-e', 'חנות תשלומים E', 'op.plat2@test.local'),
  (:SF, 'op-store-f', 'חנות תשלומים F', 'op.a.blocked@test.local')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, slug, name, site_type) VALUES (:SH, 'op-zimmer', 'צימר תשלומים', 'hospitality')
ON CONFLICT DO NOTHING;
INSERT INTO public.platform_admins (user_id) VALUES (:PLAT2), (:PLAT3) ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:SA, :A_OWNER, 'op.a.owner@test.local', 'op_a_owner', 'admin', true, true),
  (:SB, :B_OWNER, 'op.b.owner@test.local', 'op_b_owner', 'admin', true, true),
  (:SB, :B_MGR, 'op.b.mgr@test.local', 'op_b_mgr', 'admin', true, false),
  (:SB, :B_AGENT, 'op.b.agent@test.local', 'op_b_agent', 'agent', true, false),
  (:SE, :PLAT2, 'op.plat2@test.local', 'op_plat2', 'admin', true, true),
  (:SD, :D_OWNER, 'op.d.owner@test.local', 'op_d_owner', 'admin', true, true),
  (:SH, :H_OWNER, 'op.h.owner@test.local', 'op_h_owner', 'admin', true, true),
  (:SB, :C1, 'op.b.c1@test.local', 'op_b_c1', 'customer', true, false),
  (:SB, :C2, 'op.b.c2@test.local', 'op_b_c2', 'customer', true, false),
  (:SB, :C3, 'op.b.c3@test.local', 'op_b_c3', 'customer', true, false),
  (:SB, :C4, 'op.b.c4@test.local', 'op_b_c4', 'customer', true, false),
  (:SB, :C5, 'op.b.c5@test.local', 'op_b_c5', 'customer', true, false),
  (:SA, :CA, 'op.a.c1@test.local', 'op_a_c1', 'customer', true, false),
  (:SD, :CD, 'op.d.c1@test.local', 'op_d_c1', 'customer', true, false)
ON CONFLICT DO NOTHING;
-- a protected admin cannot be blocked afterwards (guard_protected_admin_update): this one is created blocked
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected, is_blocked)
VALUES (:SF, :A_BLOCKED, 'op.a.blocked@test.local', 'op_a_blocked', 'admin', true, true, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, age_confirmed, profile_completed)
SELECT u.user_id, u.tenant_id, 'לקוח תשלום מקוון', true, true
  FROM (VALUES (:C1::uuid, :SB::uuid), (:C2, :SB), (:C3, :SB), (:C4, :SB), (:C5, :SB), (:CA, :SA), (:CD, :SD)) u(user_id, tenant_id)
ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active) VALUES
  (:SHIP_A, :SA, 'איסוף (תשלום מקוון)', 'pickup', 0, true),
  (:SHIP_B, :SB, 'איסוף (תשלום מקוון)', 'pickup', 0, true),
  (:SHIP_D, :SD, 'איסוף (תשלום מקוון)', 'pickup', 0, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES (:SA, 'תשלום מקוון'), (:SB, 'תשלום מקוון'), (:SD, 'תשלום מקוון')
ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity) VALUES
  (:P10, :SB, '20800010', 'מוצר בדיקה 10', 'תשלום מקוון', :B_OWNER, 10, 100000),
  (:P60, :SB, '20800060', 'מוצר בדיקה 60', 'תשלום מקוון', :B_OWNER, 60, 100000),
  (:PA10, :SA, '20800110', 'מוצר בדיקה A', 'תשלום מקוון', :A_OWNER, 10, 100000),
  (:PD10, :SD, '20800210', 'מוצר בדיקה D', 'תשלום מקוון', :D_OWNER, 10, 100000),
  (:PM3, :SB, '20800013', 'מוצר בדיקה (מלאי מוחזק)', 'תשלום מקוון', :B_OWNER, 10, 50),
  (:PV, :SB, '20800014', 'מוצר בדיקה עם וריאנטים', 'תשלום מקוון', :B_OWNER, 10, 100000)
ON CONFLICT DO NOTHING;
INSERT INTO public.product_variants (id, tenant_id, product_id, options, sku, price, stock_quantity) VALUES
  (:VR1, :SB, :PV, '{"color":"red"}', 'op-v-red', 10, 50),
  (:VR2, :SB, :PV, '{"color":"blue"}', 'op-v-blue', 10, 50);
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id IN (:SA, :SB, :SD);

SELECT tests.check('online payments fixtures: stores A / B / D / E / F are ordinary, non-default stores with exactly one owner each; B has an owner, a manager, an agent and five customers',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id IN (%1$L, %2$L, %3$L, %7$L, %8$L) AND (is_default OR site_type <> 'ecommerce'))
             AND (SELECT count(*) FROM public.user_roles WHERE tenant_id = %2$L AND role = 'customer') = 5
             AND (SELECT is_protected FROM public.user_roles WHERE tenant_id = %2$L AND user_id = %4$L)
             AND NOT (SELECT is_protected FROM public.user_roles WHERE tenant_id = %2$L AND user_id = %5$L)
             AND (SELECT is_blocked AND is_protected FROM public.user_roles WHERE tenant_id = %8$L AND user_id = %6$L)
             AND (SELECT bool_and(n = 1) FROM (SELECT count(*) FILTER (WHERE is_protected) AS n FROM public.user_roles
                   WHERE role = 'admin' AND tenant_id IN (%1$L, %2$L, %3$L, %7$L, %8$L, %9$L) GROUP BY tenant_id) o)$$,
         :SA, :SB, :SD, :B_OWNER, :B_MGR, :A_BLOCKED, :SE, :SF, :SH));

-- ============================================================
-- 1. Structure, grants, naming (static)
-- ============================================================
SELECT tests.check('online payments structure: the closed schema payments — no USAGE for anon, authenticated or service_role',
  $$SELECT to_regnamespace('payments') IS NOT NULL
       AND NOT has_schema_privilege('anon', 'payments', 'USAGE')
       AND NOT has_schema_privilege('authenticated', 'payments', 'USAGE')
       AND NOT has_schema_privilege('service_role', 'payments', 'USAGE')$$);
SELECT tests.check('online payments structure: 18 tables (pilot_stores and pilot_testers included, P-2 / P-4), RLS on all; the 7 store tables RESTRICTIVE tenant_isolation, the 11 platform / cross-scope tables RESTRICTIVE deny-all',
  $$SELECT (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'r') = 18
       AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity)
       AND (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_policies
             WHERE schemaname = 'payments' AND policyname = 'tenant_isolation' AND permissive = 'RESTRICTIVE'
               AND qual LIKE '%current_tenant_id()%')
           = ARRAY['tenant_accounts', 'tenant_attempts', 'tenant_config_audit', 'tenant_events', 'tenant_order_access',
                   'tenant_returns', 'tenant_store_settings']
       AND (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_policies
             WHERE schemaname = 'payments' AND policyname = 'platform_only' AND permissive = 'RESTRICTIVE' AND qual = 'false')
           = ARRAY['environment', 'pilot_stores', 'pilot_testers', 'platform_accounts', 'platform_attempts', 'platform_config_audit',
                   'platform_events', 'platform_returns', 'platform_stepup_challenges', 'terminal_registry', 'unknown_returns']$$);
SELECT tests.check('online payments structure: no table or sequence privilege for any API role',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role)
                        WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'r'
                          AND (has_table_privilege(r.role, c.oid, 'SELECT') OR has_table_privilege(r.role, c.oid, 'INSERT')
                               OR has_table_privilege(r.role, c.oid, 'UPDATE') OR has_table_privilege(r.role, c.oid, 'DELETE')
                               OR has_table_privilege(r.role, c.oid, 'TRUNCATE') OR has_table_privilege(r.role, c.oid, 'REFERENCES')))
       AND NOT EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role)
                        WHERE c.relnamespace = 'payments'::regnamespace AND c.relkind = 'S'
                          AND (has_sequence_privilege(r.role, c.oid, 'USAGE') OR has_sequence_privilege(r.role, c.oid, 'SELECT')
                               OR has_sequence_privilege(r.role, c.oid, 'UPDATE')))$$);
SELECT tests.check('online payments structure: no internal payments function is executable by any API role',
  $$SELECT count(*) > 0 AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                                      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
      FROM pg_proc p WHERE p.pronamespace = 'payments'::regnamespace$$);
CREATE TEMP TABLE op_api(name text PRIMARY KEY, auth boolean NOT NULL DEFAULT false);
INSERT INTO op_api (name) SELECT unnest(ARRAY[
  'max_payments_active', 'max_order_access_issue', 'max_attempt_open', 'max_attempt_secrets', 'max_attempt_signed',
  'max_attempt_record_return', 'max_attempt_mark_paid', 'max_attempts_expire', 'max_attempt_cancel', 'max_review_resolve',
  'max_order_payment_status', 'max_account_status', 'max_store_settings_save', 'max_unreturned_attempts',
  'max_attempts_pending_verify', 'platform_attempts_pending_verify',
  'max_return_keep', 'max_return_get', 'platform_store_terminal_save', 'platform_store_terminal_verified',
  'platform_store_terminal_check_secrets', 'platform_attempt_open', 'platform_attempt_secrets', 'platform_attempt_signed',
  'platform_attempt_record_return', 'platform_attempt_mark_paid', 'platform_attempts_expire',
  'platform_card_payment_resolve', 'platform_card_payments', 'platform_unreturned_attempts', 'platform_terminal_save',
  'platform_terminal_verified', 'platform_terminal_check_secrets', 'platform_terminal_status', 'platform_stepup_issue',
  'platform_stepup_consume', 'platform_payment_unknown_return', 'platform_return_keep', 'platform_return_get',
  'platform_payment_returns_purge']);
INSERT INTO op_api (name, auth) VALUES ('platform_card_my_payments', true), ('platform_card_my_options', true);
INSERT INTO op_api (name) VALUES ('max_review_alerts_claim'), ('platform_attempt_review_alerts_claim');
SELECT tests.check('online payments grants: the 44 API functions (contract §5 + the two re-VERIFY lists + the two alert claims, X-17) exist once each, SECURITY DEFINER, search_path empty',
  $$SELECT (SELECT count(*) FROM op_api) = 44
       AND NOT EXISTS (SELECT 1 FROM op_api a
                        WHERE (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = a.name
                                 AND p.prosecdef AND 'search_path=""' = ANY (COALESCE(p.proconfig, '{}'))) <> 1)$$);
SELECT tests.check('online payments grants: service_role on every API function; authenticated only on platform_card_my_payments / _options; anon on none',
  $$SELECT bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = a.auth)
      FROM op_api a JOIN pg_proc p ON p.proname = a.name AND p.pronamespace = 'public'::regnamespace$$);
SELECT tests.check('online payments grants (H1): no function that takes _actor is executable by authenticated or anon',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname IN (SELECT name FROM op_api)
                        AND '_actor' = ANY (COALESCE(p.proargnames, '{}'))
                        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')))
       AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN (SELECT name FROM op_api) AND '_actor' = ANY (COALESCE(p.proargnames, '{}'))) = 19$$);
-- the static name check (plan §5.4 row 1): every name-pattern assertion in scripts/db-tests/*.sql
SELECT tests.check('DM-REG-2: no new function name falls under an existing name-pattern assertion (my_billing_% / platform_billing_% of billing-agreements and billing-seller-vat, hosp% of hospitality-schema, the remove-hyp banned names)',
  $$SELECT NOT EXISTS (SELECT 1 FROM op_api a
                        WHERE a.name LIKE 'my\_billing\_%' OR a.name LIKE 'platform\_billing\_%' OR a.name ~ '^(my_billing_|platform_billing_)'
                           OR a.name LIKE 'hosp%'
                           OR a.name IN ('hyp_credentials', 'payment_intent_lookup', 'payment_intent_complete', 'payment_intent_fail',
                                         'payment_test_start', 'payment_last_test', 'order_payment_intent', 'checkout_payment_request',
                                         'card_payments_active', 'card_clearing_live', 'platform_payments_ready',
                                         'platform_payments_configured', 'platform_payment_settings', 'platform_save_payment_settings',
                                         'store_payment_settings', 'store_save_payment_settings', 'site_settings_card_payments_guard',
                                         'orders_card_payment_default', 'addon_checkout_start', 'plan_checkout_start', 'plan_quote',
                                         'plan_quote_for'))
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'payments'::regnamespace
                        AND (p.proname LIKE 'my\_billing\_%' OR p.proname LIKE 'platform\_billing\_%' OR p.proname LIKE 'hosp%'))$$);
SELECT tests.check('DM-REG-2: billing-agreements still counts exactly 14 my_billing_* / platform_billing_* functions, all for signed-in users, none for anon',
  $$SELECT (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND (p.proname LIKE 'my\_billing\_%' OR (p.proname LIKE 'platform\_billing\_%' AND p.proname <> 'platform_billing_history'))) = 14
       AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
              FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
               AND (p.proname LIKE 'my\_billing\_%' OR p.proname LIKE 'platform\_billing\_%') AND p.proname <> 'platform_billing_history')$$);
SELECT tests.check('DM-REG-2: no API, patched or payments.* function body matches the remove-hyp pattern, and none returns a payments_ready key',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p
                        WHERE (p.pronamespace = 'payments'::regnamespace
                               OR (p.pronamespace = 'public'::regnamespace
                                   AND (p.proname IN (SELECT name FROM op_api) OR p.proname IN ('orders_default_payment', 'place_order', 'place_guest_order'))))
                          AND (p.prosrc ~* '(hyp_|payment_intent|tenant_payment_secrets|platform_settings|card_payments_|card_clearing|platform_payments_|checkout_payment_request|payment_token)'
                               OR p.prosrc LIKE '%payments\_ready%'))$$);
SELECT tests.check('decision ה-4: no test-user allow-list — no payments.test_users, no platform_payment_tester_*, no test_access column anywhere',
  $$SELECT to_regclass('payments.test_users') IS NULL
       AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'platform\_payment\_tester%')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'payments' AND column_name = 'test_access')$$);
SELECT tests.check('decision ה-3: a platform attempt pays one billing.ledger charge — no add-on target, no add-on columns',
  $$SELECT pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'payments.platform_attempts'::regclass
                                   AND conname = 'platform_attempts_target_kind_check')) NOT LIKE '%addon%'
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'payments' AND table_name = 'platform_attempts'
                        AND column_name IN ('addon_id', 'billing_history_id'))
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace IN ('payments'::regnamespace, 'public'::regnamespace)
                        AND p.proname IN (SELECT name FROM op_api UNION SELECT proname FROM pg_proc WHERE pronamespace = 'payments'::regnamespace)
                        AND (p.prosrc LIKE '%tenant_addons%' OR p.prosrc LIKE '%billing_history%'))$$);
SELECT tests.check('decision 14 (L6): the raw-return tables are part of migration 208 — same schema, RLS on, sealed format only',
  $$SELECT to_regclass('payments.tenant_returns') IS NOT NULL AND to_regclass('payments.platform_returns') IS NOT NULL
       AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'payments.tenant_returns'::regclass)
       AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'payments.platform_returns'::regclass)
       AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'payments.tenant_returns'::regclass
                                   AND conname = 'tenant_returns_ceiling')) LIKE '%02:00:00%'$$);
SELECT tests.check('orders: orders_payment_check accepts online; credit_card, the Bit and the Grow clauses are kept',
  $$SELECT d LIKE '%''online''%' AND d LIKE '%''credit_card''%' AND d LIKE '%bit_transaction_id IS NULL%'
           AND d LIKE '%grow_asmachta IS NULL%' AND d LIKE '%''grow''%'
      FROM (SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
             WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_payment_check') x$$);
SELECT tests.check('orders: the online branch sits in orders_default_payment after the staff early return; place_order / place_guest_order map online right after the Bit line',
  $$SELECT position('max_payments_active' IN pg_get_functiondef('public.orders_default_payment()'::regprocedure))
             > position('public.is_staff(auth.uid())' IN pg_get_functiondef('public.orders_default_payment()'::regprocedure))
       AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('place_order', 'place_guest_order')
             AND position(E'WHEN _details ->> ''payment_method'' = ''bit'' THEN ''bit''\n           WHEN _details ->> ''payment_method'' = ''online'' THEN ''online''' IN pg_get_functiondef(p.oid)) > 0) = 2$$);
SELECT tests.check('orders: three new triggers (BEFORE DELETE keep, AFTER UPDATE amount lock, BEFORE I/U/D lines lock), no new BEFORE INSERT trigger on orders',
  $$SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'orders_online_payment_keep'
                    AND tgtype & 2 = 2 AND tgtype & 8 = 8 AND tgtype & 4 = 0)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND tgname = 'orders_payment_amount_lock'
                    AND tgtype & 2 = 0 AND tgtype & 16 = 16)
       AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.order_items'::regclass AND tgname = 'order_items_a_payment_lock'
                    AND tgtype & 2 = 2 AND tgtype & 4 = 4 AND tgtype & 8 = 8 AND tgtype & 16 = 16)
       AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
                        WHERE t.tgrelid = 'public.orders'::regclass AND f.pronamespace = 'payments'::regnamespace
                          AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)$$);
SELECT tests.check('ecommerce guard: no Ecommerce guard trigger on any payments table',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
                        WHERE c.relnamespace = 'payments'::regnamespace
                          AND tg.tgname IN ('ecommerce_rows_guard', 'ecommerce_row_move_guard'))$$);
-- DM-SEP-2: the bodies, scanned (only the cross-scope purge / unknown-return may see both sides)
SELECT tests.check('DM-SEP-2: store-scope API bodies never name a payments.platform_* table; platform-scope API bodies never a payments.tenant_* one',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND (p.proname LIKE 'max\_%' OR p.proname LIKE 'platform\_store\_terminal\_%')
                        AND p.prosrc LIKE '%payments.platform\_%')
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND p.proname IN (SELECT name FROM op_api) AND p.proname NOT LIKE 'max\_%'
                        AND p.proname NOT LIKE 'platform\_store\_terminal\_%'
                        AND p.proname NOT IN ('platform_payment_returns_purge', 'platform_payment_unknown_return', 'platform_terminal_status')
                        AND p.prosrc LIKE '%payments.tenant\_%')
       AND (SELECT prosrc LIKE '%payments.tenant_attempts%' AND prosrc NOT LIKE '%payments.platform\_%'
              FROM pg_proc WHERE oid = 'public.max_attempt_mark_paid(uuid,text,text,text,text,text,text,bigint,text,integer,text,text,text,text[],text)'::regprocedure)
       AND (SELECT prosrc LIKE '%payments.platform_attempts%' AND prosrc NOT LIKE '%payments.tenant\_%'
              FROM pg_proc WHERE oid = 'public.platform_attempt_mark_paid(text,text,text,text,text,text,bigint,text,integer,text,text,text,text[],text)'::regprocedure)$$);
SELECT tests.check('DM-SEP-2: only the platform side writes billing.ledger (one internal writer, called only by platform_attempt_mark_paid); the store settle never touches billing',
  $$SELECT (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
             WHERE p.pronamespace IN ('payments'::regnamespace, 'public'::regnamespace)
               AND (p.proname IN (SELECT name FROM op_api) OR p.pronamespace = 'payments'::regnamespace)
               AND p.prosrc ~* 'INSERT INTO billing\.ledger') = ARRAY['ledger_provider_payment']
       AND (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc LIKE '%payments.ledger_provider_payment%') = ARRAY['platform_attempt_mark_paid']
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'max\_%'
                        AND p.prosrc ~* 'billing\.')$$);
SELECT tests.check('DM-PAY-7 structure: nothing can hold a Hesh / HeshASM value — return_flags are presence flags (document | hk | multi) and no column is named after them',
  $$SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'payments' AND column_name ~* 'hesh')
       AND (SELECT count(*) FROM pg_constraint WHERE connamespace = 'payments'::regnamespace
             AND pg_get_constraintdef(oid) LIKE '%return_flags <@ ARRAY[''document''::text, ''hk''::text, ''multi''::text]%') = 2$$);
SELECT tests.check('DM-REG-1: Grow, Bit, phone payment, expiry, the payment guard, billing, store deletion and tenant resolution keep their md5 (unchanged by 208)',
  $$SELECT bool_and(md5(pg_get_functiondef(p.oid)) = CASE p.oid::regprocedure::text
             WHEN 'grow_mark_paid(text,boolean,text,numeric,text,text,text,text,text,integer)' THEN 'b8520c165606643c386251833c7a63dc'
             WHEN 'grow_payments_active(uuid)' THEN '9111e75769b233fef5a096125c6b0fb8'
             WHEN 'bit_payment_review(uuid,boolean)' THEN '280d68c997b837e9b94d7c60d02d43f1'
             WHEN 'bit_payments_active(uuid)' THEN 'a73657ead2e492aaf77d3ae08c4d2c17'
             WHEN 'expire_unpaid_orders()' THEN '8fa6bc8d47665c1d802a01a6cacbb0a7'
             WHEN 'orders_payment_guard()' THEN '4c2ef1245ef538fd1cb68bfeaa1a3fea'
             WHEN 'order_amount_due(numeric,boolean,numeric)' THEN '6181e83dd4ac8ad1ce4171fc1e079cb4'
             WHEN 'billing_history_guard()' THEN '8801e3da560c241242939bfa9441c168'
             WHEN 'platform_delete_tenant(uuid,text)' THEN '0830b7338656b03a1b13a59c8a1122df'
             WHEN 'current_tenant_id()' THEN '376715b1750ed5d9cb145658add34bf2'
             WHEN 'addon_purchase(text,numeric)' THEN 'bd3c1a3b3dd09a327994c0e51dbe599c'
             WHEN 'platform_approve_addon(uuid,text)' THEN 'fe6cbbe0dd576bda63c4f6d80c148a54'
             WHEN 'store_billing()' THEN '15576f49a14e7457e843679230ca0aa1'
             WHEN 'addons_store()' THEN 'df874c3512475dcc8efac3bc689045ab'
             WHEN 'is_staff(uuid)' THEN '41ac5169df1cf53ed87e409ddbb7185a'
             WHEN 'is_platform_admin(uuid)' THEN '8af3203fd488f8d9e8a3009a0539393b' END) AND count(*) = 16
      FROM pg_proc p
     WHERE p.oid IN ('public.grow_mark_paid(text,boolean,text,numeric,text,text,text,text,text,integer)'::regprocedure,
                     'public.grow_payments_active(uuid)'::regprocedure, 'public.bit_payment_review(uuid,boolean)'::regprocedure,
                     'public.bit_payments_active(uuid)'::regprocedure, 'public.expire_unpaid_orders()'::regprocedure,
                     'public.orders_payment_guard()'::regprocedure, 'public.order_amount_due(numeric,boolean,numeric)'::regprocedure,
                     'public.billing_history_guard()'::regprocedure, 'public.platform_delete_tenant(uuid,text)'::regprocedure,
                     'public.current_tenant_id()'::regprocedure, 'public.addon_purchase(text,numeric)'::regprocedure,
                     'public.platform_approve_addon(uuid,text)'::regprocedure, 'public.store_billing()'::regprocedure,
                     'public.addons_store()'::regprocedure, 'public.is_staff(uuid)'::regprocedure,
                     'public.is_platform_admin(uuid)'::regprocedure)$$);
SELECT tests.check('DM-REG-1: billing.guard and billing.add_entry are unchanged (md5) — the provider gate and the manual writer',
  $$SELECT md5(pg_get_functiondef('billing.guard()'::regprocedure)) = '805a177948e4964354a050987c561892'
       AND md5(pg_get_functiondef('billing.add_entry(uuid,text,text,numeric,numeric,date,text,jsonb)'::regprocedure)) = 'd42f07c3f709df2ca8f7c5b285846976'$$);

-- ============================================================
-- 2. Defaults — the database is created unmarked: online payments off (DM-ENV-2)
-- ============================================================
SELECT tests.check('DM-ENV-2: payments.environment is created unmarked (NULL = off), never DEMO yet; both switches exist and are off',
  $$SELECT (SELECT name IS NULL AND demo_since IS NULL FROM payments.environment) AND (SELECT count(*) FROM payments.environment) = 1
       AND (SELECT count(*) FROM public.platform_feature_flags WHERE key IN ('max_payments', 'platform_terminal_payments') AND NOT enabled) = 2$$);
SELECT tests.check('DM-ENV-2: unmarked — no store offers online payment, and the checkout refuses online with a clear message',
  format($$SELECT NOT (pg_temp.svc(format('SELECT to_jsonb(public.max_payments_active(%%L))', %1$L)))::text::boolean
             AND pg_temp.err(%1$L, %2$L, format($q$SELECT to_jsonb(x) FROM public.place_order('order',
                   jsonb_build_array(jsonb_build_object('product_id', %%L, 'quantity', 1, 'unit_price', 10)), 18, true,
                   jsonb_build_object('customer_name', 'לקוח תשלום מקוון', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
                     'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001', 'accepted_terms', true,
                     'shipping_method_id', %%L, 'payment_method', 'online')) x$q$, %3$L, %4$L)) LIKE '%%התשלום המקוון בכרטיס אינו זמין%%'$$,
         :SB, :C1, :P10, :SHIP_B));
SELECT tests.check('DM-ENV-2: unmarked — a store terminal save is refused whatever the app says (demo / production / no marker)',
  format($$SELECT pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %1$L, %2$L, '{}', 'demo')) LIKE '%%environments differ%%'
             AND pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %1$L, %2$L, '{}', 'production')) LIKE '%%environments differ%%'
             AND pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, NULL)', %1$L, %2$L, '{}')) LIKE '%%environments differ%%'
             AND NOT EXISTS (SELECT 1 FROM payments.tenant_accounts)$$, :PLAT, :SB));
SELECT tests.check('DM-ENV-2: unmarked — not even the database owner can create a terminal row',
  format($$SELECT pg_temp.db_err(format('INSERT INTO payments.tenant_accounts (tenant_id, provider) VALUES (%%L, %%L)', %L, 'max'))
             LIKE '%%online payments are off in this database%%'$$, :SB));
-- (each action in its own statement: a check's own subqueries see the snapshot of its statement, not the effects of
--  the functions it calls, and a TRUNCATE cannot run while the same statement reads the table)
SELECT COALESCE(pg_temp.db_err('DELETE FROM payments.environment'), '') AS env_del \gset
SELECT COALESCE(pg_temp.db_err('TRUNCATE payments.environment'), '') AS env_trunc \gset
SELECT COALESCE(pg_temp.db_err('INSERT INTO payments.environment (id, name) VALUES (false, NULL)'), '') AS env_ins \gset
SELECT COALESCE(pg_temp.db_err($q$UPDATE payments.environment SET name = 'staging'$q$), '') AS env_upd \gset
SELECT tests.check('DM-ENV-2: the environment row is never deleted, truncated or duplicated',
  format($$SELECT %L LIKE '%%never deleted%%' AND %L LIKE '%%never deleted%%' AND %L LIKE '%%environment_id_check%%'
             AND %L LIKE '%%environment_name_check%%' AND (SELECT count(*) FROM payments.environment) = 1$$,
         :'env_del', :'env_trunc', :'env_ins', :'env_upd'));

-- ============================================================
-- 3. The production rehearsal (always rolled back): DM-ENV-2 / DM-ENV-3 for production
-- ============================================================
CREATE TEMP TABLE op_prod AS
SELECT n, r FROM unnest(pg_temp.probe(ARRAY[
  -- 1 a fresh database that was never DEMO can be marked production
  $q$UPDATE payments.environment SET name = 'production', note = 'rehearsal (rolled back)' RETURNING name$q$,
  -- 2 production: a test terminal (00100…) is refused
  format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('k'), 'api_password_enc', pg_temp.tok('p')), 'production'))::text$q$,
         :PLAT, :SB, :'t_b'),
  -- 3 production: mode test is refused
  format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('mode', 'test', 'terminal_number', %L, 'api_key_enc', pg_temp.tok('k'), 'api_password_enc', pg_temp.tok('p')), 'production'))::text$q$,
         :PLAT, :SB, :'t_live'),
  -- 4 production: a live terminal is saved, in mode live
  format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('k'), 'api_password_enc', pg_temp.tok('p')), 'production')) ->> 'mode'$q$,
         :PLAT, :SB, :'t_live'),
  -- 5 the stored account
  format($q$SELECT mode || '/' || terminal_number FROM payments.tenant_accounts WHERE tenant_id = %L$q$, :SB),
  -- 6 production: an application that says demo is refused
  format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L, '{"enabled": false}', 'demo'))::text$q$,
         :PLAT, :SB),
  -- 7 a database that holds a live terminal can never become DEMO
  $q$UPDATE payments.environment SET name = 'demo' RETURNING name$q$,
  -- 8 production: a test attempt cannot even be inserted by the database owner
  format($q$INSERT INTO payments.tenant_attempts (tenant_id, store_label, order_number, attempt_no, provider, mode, terminal_number,
             key_id, amount_minor, reference, expires_at)
           VALUES (%L, 'x', 'x', 1, 'max', 'test', %L, '0badc0de', 100, repeat('a', 32), now() + interval '1 hour') RETURNING 'inserted'$q$,
         :SB, :'t_b'),
  -- 9 production: NURIEL's terminal — a test terminal is refused (after a consumed step-up code)
  format($q$SELECT (su ->> 'ok') || '/' || COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%%L, %%L, %%L, %%L, %%L)', %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('k'), 'api_password_enc', pg_temp.tok('p')), 'production',
           su ->> 'challenge_id', repeat('p', 64))), 'saved') FROM (SELECT pg_temp.stepup(%L) AS su) x$q$,
         :PLAT, :'t_plat', :PLAT),
  -- 10 production: NURIEL's live terminal is saved (a new step-up code: one code, one save)
  format($q$SELECT (su ->> 'ok') || '/' || (pg_temp.svc(format('SELECT public.platform_terminal_save(%%L, %%L, %%L, %%L, %%L)', %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('k'), 'api_password_enc', pg_temp.tok('p')), 'production',
           su ->> 'challenge_id', repeat('p', 64))) ->> 'mode') FROM (SELECT pg_temp.stepup(%L) AS su) x$q$,
         :PLAT, :'t_live_plat', :PLAT),
  -- 11 off is always allowed, and a never-DEMO database can be marked production again
  $q$UPDATE payments.environment SET name = NULL RETURNING COALESCE(name, 'off')$q$,
  $q$UPDATE payments.environment SET name = 'production' RETURNING name$q$
])) WITH ORDINALITY AS t(r, n);
SELECT tests.check('DM-ENV-2: a fresh database that was never DEMO can be marked production (rehearsal, rolled back)',
  $$SELECT r = 'ok:production' FROM op_prod WHERE n = 1$$);
SELECT tests.check('DM-ENV-3: production — a test terminal (00100…) is refused',
  $$SELECT r LIKE 'error:%test terminals (00100…) are refused%' FROM op_prod WHERE n = 2$$);
SELECT tests.check('DM-ENV-3: production — mode test is refused',
  $$SELECT r LIKE 'error:%only live terminals can be saved%' FROM op_prod WHERE n = 3$$);
SELECT tests.check('DM-ENV-3: production — a live terminal is saved, and it is live',
  format($$SELECT (SELECT r = 'ok:live' FROM op_prod WHERE n = 4) AND (SELECT r = 'ok:live/' || %L FROM op_prod WHERE n = 5)$$, :'t_live'));
SELECT tests.check('DM-ENV-2: production — an application marked demo is refused (the two markers must agree)',
  $$SELECT r LIKE 'error:%environments differ%' FROM op_prod WHERE n = 6$$);
SELECT tests.check('DM-ENV-2: a database that holds a live terminal can never become DEMO',
  $$SELECT r LIKE 'error:%cannot become a DEMO database%' FROM op_prod WHERE n = 7$$);
SELECT tests.check('DM-ENV-3: production — a test payment cannot even be inserted by the database owner',
  $$SELECT r LIKE 'error:%a test payment can start only in a DEMO database%' FROM op_prod WHERE n = 8$$);
SELECT tests.check('DM-ENV-3: production — NURIEL''s terminal: a test terminal is refused, a live one is saved live',
  $$SELECT (SELECT r LIKE 'ok:true/%test terminals (00100…) are refused%' FROM op_prod WHERE n = 9)
       AND (SELECT r = 'ok:true/live' FROM op_prod WHERE n = 10)$$);
SELECT tests.check('DM-ENV-2: back to off is always allowed; a never-DEMO database can be marked production again',
  $$SELECT (SELECT r = 'ok:off' FROM op_prod WHERE n = 11) AND (SELECT r = 'ok:production' FROM op_prod WHERE n = 12)$$);
SELECT tests.check('the production rehearsal left nothing behind (rolled back: unmarked, no terminal, no registry row, no audit, no step-up)',
  $$SELECT (SELECT name IS NULL AND demo_since IS NULL FROM payments.environment)
       AND NOT EXISTS (SELECT 1 FROM payments.tenant_accounts) AND NOT EXISTS (SELECT 1 FROM payments.platform_accounts)
       AND NOT EXISTS (SELECT 1 FROM payments.terminal_registry) AND NOT EXISTS (SELECT 1 FROM payments.platform_config_audit)
       AND NOT EXISTS (SELECT 1 FROM payments.platform_stepup_challenges)$$);

-- ============================================================
-- 3b. The production pilot rehearsal (contract §7.2 P-1 … P-6), always rolled back: a database that was never DEMO is
--     marked 'pilot', store B goes into the pilot list, customer C3 is its named test customer (P-4, revised). It runs before section 4 because a
--     database that was ever DEMO can never become a pilot. Each step has a name; the checks read the results by name.
-- ============================================================
CREATE TEMP TABLE op_pilot_kv (k text PRIMARY KEY, v text);
CREATE OR REPLACE FUNCTION pg_temp.pset(_k text, _v text) RETURNS text LANGUAGE sql AS $f$
  INSERT INTO op_pilot_kv VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v RETURNING v;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.pv(_k text) RETURNS text LANGUAGE sql AS $f$
  SELECT v FROM op_pilot_kv WHERE k = _k;
$f$;
-- the shape of an online order awaiting payment, made by the database owner from an offline order (triggers off): the
-- open must refuse it for a non-tester or a guest whatever the order path did
CREATE OR REPLACE FUNCTION pg_temp.forced_online(_tenant uuid, _cust uuid, _guest boolean) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE o uuid := pg_temp.order_of(_tenant, _cust,
          CASE WHEN _tenant = 'c2080000-0000-4000-8000-00000000000a' THEN 'c2080000-0000-4000-8000-00000000a010'::uuid
               ELSE 'c2080000-0000-4000-8000-00000000b010'::uuid END,
          CASE WHEN _tenant = 'c2080000-0000-4000-8000-00000000000a' THEN 'c2080000-0000-4000-8000-00000000500a'::uuid
               ELSE 'c2080000-0000-4000-8000-00000000500b'::uuid END, 1, 'offline');
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.orders SET payment_method = 'online', payment_status = 'awaiting', payment_due_at = now() + interval '2 hours',
         customer_id = CASE WHEN _guest THEN NULL ELSE customer_id END
   WHERE id = o;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN o;
END $f$;
-- store B: open → SIGN ok → browser return (app marker 'pilot'); the result of the open
CREATE OR REPLACE FUNCTION pg_temp.pilot_returned(_order uuid, _cust uuid, _label text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o jsonb;
BEGIN
  o := pg_temp.t_open('c2080000-0000-4000-8000-00000000000b', _order, _cust, 'pilot');
  PERFORM pg_temp.t_sign('c2080000-0000-4000-8000-00000000000b', o ->> 'attempt_id');
  PERFORM pg_temp.t_ret('c2080000-0000-4000-8000-00000000000b', o ->> 'reference', pg_temp.h('pilot|' || _label), '0',
                        'fake-pilot-' || _label, (o ->> 'amount_minor')::bigint);
  RETURN o;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.pilot_settle(_o jsonb, _label text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.t_settle('c2080000-0000-4000-8000-00000000000b', _o ->> 'reference', pg_temp.h('pilot|' || _label), '0', '0',
                          _o ->> 'terminal_number', 'fake-pilot-' || _label, (_o ->> 'amount_minor')::bigint, 'ILS', 1, '{}', 'pilot');
$f$;
CREATE TEMP TABLE op_pilot_steps (n serial PRIMARY KEY, k text UNIQUE NOT NULL, q text NOT NULL);
INSERT INTO op_pilot_steps (k, q) VALUES
  -- P-1: an unmarked database that was never DEMO and never live becomes a pilot
  ('mark', $q$UPDATE payments.environment SET name = 'pilot', note = 'pilot rehearsal (rolled back)' RETURNING name || '/' || (pilot_since IS NOT NULL)$q$),
  -- P-2: before B is in the list, the platform admin's save is refused
  ('b_unlisted', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('pk'), 'api_password_enc', pg_temp.tok('pp')), 'pilot'))::text$q$,
         :PLAT, :SB, :'t_b')),
  ('b_add', format($q$INSERT INTO payments.pilot_stores (tenant_id, note) VALUES (%L, 'the owner''s store') RETURNING 'added'$q$, :SB)),
  ('b_add_audit', format($q$SELECT action || '/' || actor_role || '/' || (actor_id IS NULL) || '/' || changed_fields::text
           FROM payments.tenant_config_audit WHERE tenant_id = %L ORDER BY id DESC LIMIT 1$q$, :SB)),
  -- P-4: a person lists the named test customers: C3 for B; C4 for A only; CA for A, which is not (yet) a pilot store;
  -- B's owner (a staff user) for B
  ('testers_add', format($q$WITH i AS (INSERT INTO payments.pilot_testers (tenant_id, user_id, note)
           VALUES (%1$L, %3$L, 'tester'), (%2$L, %4$L, 'tester of A'), (%2$L, %5$L, 'tester of A'), (%1$L, %6$L, 'staff, listed') RETURNING 1)
           SELECT count(*)::text FROM i$q$, :SB, :SA, :C3, :C4, :CA, :B_OWNER)),
  ('testers_audit', format($q$SELECT string_agg(DISTINCT action || '/' || actor_role || '/' || (actor_id IS NULL) || '/' || changed_fields::text, ',')
           || '/' || count(*) FROM payments.tenant_config_audit WHERE action = 'pilot_tester_added' AND tenant_id IN (%L, %L)$q$, :SB, :SA)),
  ('owner_status_before', format($q$SELECT pg_temp.svc(format('SELECT public.max_account_status(%%L, %%L)', %L, %L))::text$q$, :B_OWNER, :SB)),
  ('flag', format($q$SELECT pg_temp.call(NULL, %L, 'SELECT to_jsonb(public.platform_set_flag(''max_payments'', true))')::text$q$, :PLAT)),
  -- P-1 / P-3: the app must say pilot; mode live and a non-00100 number are refused
  ('save_app_demo', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'demo'))::text$q$, :PLAT, :SB, :'t_b')),
  ('save_live_mode', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('mode', 'live', 'terminal_number', %L), 'pilot'))::text$q$, :PLAT, :SB, :'t_b')),
  ('save_live_number', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot'))::text$q$, :PLAT, :SB, :'t_live')),
  -- P-6: the platform admin saves B's test terminal, verifies and enables it
  ('b_save', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L, 'api_key_enc', pg_temp.tok('pilot-key'), 'api_password_enc', pg_temp.tok('pilot-pass'),
                              'verified_brands', jsonb_build_array('visa', 'mastercard')), 'pilot')) ->> 'mode'$q$, :PLAT, :SB, :'t_b')),
  ('b_verified', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%%L, %%L, true, %%L)', %L, %L, '0')) ->> 'status'$q$, :PLAT, :SB)),
  ('b_enable', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L, '{"enabled": true}', 'pilot')) ->> 'enabled'$q$, :PLAT, :SB)),
  -- P-2: store A, not in the list: the admin's save, and even the table owner's direct insert, are refused
  ('a_save', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot'))::text$q$, :PLAT, :SA, :'t_a')),
  ('a_insert', format($q$INSERT INTO payments.tenant_accounts (tenant_id, provider, mode) VALUES (%L, 'max', 'test') RETURNING 'inserted'$q$, :SA)),
  -- P-4: active only for B's named test customer — not another customer, a guest, A's tester, B's (unlisted) staff;
  -- P-2: never in A (not in the list), even for its listed tester
  ('active', format($q$SELECT format('%%s/%%s/%%s/%%s/%%s/%%s/%%s', public.max_payments_active(%1$L, %2$L), public.max_payments_active(%1$L, %3$L),
           public.max_payments_active(%1$L, NULL), public.max_payments_active(%1$L, %4$L), public.max_payments_active(%1$L, %5$L),
           public.max_payments_active(%1$L, %6$L), public.max_payments_active(%7$L, %8$L))$q$, :SB, :C3, :C1, :C4, :B_MGR, :B_AGENT, :SA, :CA)),
  -- P-4: an ordinary customer's and a guest's online order are refused at the order already
  ('c1_order', format($q$SELECT COALESCE(pg_temp.db_err(format('SELECT pg_temp.order_of(%%L, %%L, %%L, %%L, 1, %%L)', %L, %L, %L, %L, 'online')), 'placed')$q$,
         :SB, :C1, :P10, :SHIP_B)),
  ('guest_order', format($q$SELECT COALESCE(pg_temp.svc_err(format($g$SELECT to_jsonb(x) FROM (SELECT set_config('request.headers', %%L, true)) s,
           public.place_guest_order('order', jsonb_build_array(jsonb_build_object('product_id', %%L, 'quantity', 1, 'unit_price', 10)),
             jsonb_build_object('customer_name', 'אורח פיילוט', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
               'customer_email', 'op.pilot.guest@test.local', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1',
               'billing_zip', '6100001', 'accepted_terms', true, 'shipping_method_id', %%L, 'payment_method', 'online')) x$g$,
           json_build_object('x-tenant-id', %L)::text, %L, %L)), 'placed')$q$, :SB, :P10, :SHIP_B)),
  -- P-4: the store's owner, even listed as a tester, gets no online order: staff orders stay offline (unchanged)
  -- (a statement does not see rows its own functions wrote: placing and reading are separate steps)
  ('owner_order_place', format($q$SELECT pg_temp.pset('o0', pg_temp.order_of(%L, %L, %L, %L, 1, 'online')::text)$q$, :SB, :B_OWNER, :P10, :SHIP_B)),
  ('owner_order', $q$SELECT payment_method || '/' || payment_status FROM public.orders WHERE id = pg_temp.pv('o0')::uuid$q$),
  -- P-4: the named test customer places an online order (place_order) and pays: open → SIGN → return → VERIFY 0 →
  -- settle, app marker 'pilot'
  ('tester_order_place', format($q$SELECT pg_temp.pset('o1', pg_temp.order_of(%L, %L, %L, %L, 1, 'online')::text)$q$, :SB, :C3, :P10, :SHIP_B)),
  ('tester_order', format($q$SELECT payment_method || '/' || payment_status || '/' || (customer_id = %L)
           FROM public.orders WHERE id = pg_temp.pv('o1')::uuid$q$, :C3)),
  ('tester_open', format($q$SELECT (o ->> 'mode') || '/' || (o ->> 'amount_minor') || '/' || (o ->> 'terminal_number' = %L)
           FROM (SELECT pg_temp.pset('a1', pg_temp.pilot_returned(pg_temp.pv('o1')::uuid, %L, 'o1')::text)::jsonb AS o) x$q$, :'t_b', :C3)),
  ('tester_pay', $q$SELECT (s ->> 'result') || '/' || (s ->> 'applied') FROM (SELECT pg_temp.pilot_settle(pg_temp.pv('a1')::jsonb, 'o1') AS s) x$q$),
  ('tester_paid', $q$SELECT payment_status FROM public.orders WHERE id = pg_temp.pv('o1')::uuid$q$),
  -- P-3: the ₪50 cap (a forced order of ₪60 for the tester)
  ('tester_cap', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, %%L, NULL, %%L)', %1$L,
           (SELECT o FROM (SELECT pg_temp.call(%1$L, %2$L, format($o$SELECT to_jsonb(x) FROM public.place_order('order',
              jsonb_build_array(jsonb_build_object('product_id', %%L, 'quantity', 6, 'unit_price', 10)), 18, true,
              jsonb_build_object('customer_name', 'בודק פיילוט', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
                'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001', 'accepted_terms', true,
                'shipping_method_id', %%L, 'payment_method', 'online')) x$o$, %3$L, %4$L)) ->> 'id' AS o) z), %2$L, 'pilot')), 'opened')$q$,
         :SB, :C3, :P10, :SHIP_B)),
  -- P-4: A's tester on B, and a tester of A (not a pilot store) in A: refused
  ('c4_on_b', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, %%L, NULL, %%L)', %1$L,
           pg_temp.forced_online(%1$L, %2$L, false), %2$L, 'pilot')), 'opened')$q$, :SB, :C4)),
  ('ca_on_a', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, %%L, NULL, %%L)', %1$L,
           pg_temp.forced_online(%1$L, %2$L, false), %2$L, 'pilot')), 'opened')$q$, :SA, :CA)),
  -- P-4: the open refuses an ordinary customer's and a guest's online order (forced shapes)
  ('c1_open', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, %%L, NULL, %%L)', %1$L,
           pg_temp.forced_online(%1$L, %2$L, false), %2$L, 'pilot')), 'opened')$q$, :SB, :C1)),
  ('guest_token', format($q$SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_order_access_issue(%%L, %%L, %%L))', %1$L,
           pg_temp.pset('g', pg_temp.forced_online(%1$L, %2$L, true)::text), pg_temp.h('pilot-guest')))::text$q$, :SB, :C2)),
  ('guest_open', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, NULL, %%L, %%L)', %L,
           pg_temp.pv('g'), pg_temp.h('pilot-guest'), 'pilot')), 'opened')$q$, :SB)),
  -- P-6: the store owner reads only whether online payment is active; the platform admin reads the full status
  ('owner_status', format($q$SELECT pg_temp.svc(format('SELECT public.max_account_status(%%L, %%L)', %L, %L))::text$q$, :B_OWNER, :SB)),
  ('plat_status', format($q$SELECT pg_temp.svc(format('SELECT public.max_account_status(%%L, %%L)', %L, %L)) ->> 'terminal_hint'$q$, :PLAT, :SB)),
  -- P-6: no store-owner path saves, clears or changes the terminal (the terminal functions are the platform admin's)
  ('owner_term_save', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot')), 'saved')$q$, :B_OWNER, :SB, :'t_spare')),
  ('owner_term_clear', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           '{"clear_credentials": true}', 'pilot')), 'saved')$q$, :B_OWNER, :SB)),
  ('owner_term_off', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           '{"enabled": false}', 'pilot')), 'saved')$q$, :B_OWNER, :SB)),
  ('owner_term_verified', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_verified(%%L, %%L, false, %%L)', %L, %L, '1')), 'saved')$q$, :B_OWNER, :SB)),
  ('owner_term_secrets', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_check_secrets(%%L, %%L)', %L, %L)), 'read')$q$, :B_OWNER, :SB)),
  ('owner_settings', format($q$SELECT pg_temp.svc(format('SELECT public.max_store_settings_save(%%L, %%L, 1, 0, NULL, NULL)', %L, %L))::text$q$, :B_OWNER, :SB)),
  -- P-5: NURIEL's terminal is not saved, no platform attempt, nothing payable; the jobs still run
  ('plat_save', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%%L, %%L, %%L, %%L, %%L)', %1$L,
           jsonb_build_object('terminal_number', %2$L), 'pilot', (pg_temp.stepup(%1$L) ->> 'challenge_id'), repeat('p', 64))), 'saved')$q$, :PLAT, :'t_plat')),
  ('plat_verified', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_verified(%%L, true, %%L)', %L, '0')), 'verified')$q$, :PLAT)),
  ('plat_open', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%%L, %%L, %%L, %%L, NULL, %%L)', %L, %L,
           'ledger_charge', gen_random_uuid(), 'pilot')), 'opened')$q$, :B_OWNER, :SB)),
  ('plat_options', format($q$SELECT pg_temp.call(%L, %L, 'SELECT public.platform_card_my_options()') ->> 'available'$q$, :SB, :B_OWNER)),
  ('jobs', $q$SELECT format('%s/%s/%s/%s/%s', pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') IS NOT NULL,
           pg_temp.svc('SELECT to_jsonb(public.platform_attempts_expire())') IS NOT NULL,
           pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') IS NOT NULL,
           jsonb_typeof(pg_temp.svc('SELECT to_jsonb(public.max_review_alerts_claim(200))')),
           jsonb_typeof(pg_temp.svc('SELECT to_jsonb(public.platform_attempt_review_alerts_claim(200))')))$q$),
  -- P-3: one terminal is one store, in either order (A joins the pilot for this)
  ('a_add', format($q$INSERT INTO payments.pilot_stores (tenant_id) VALUES (%L) RETURNING 'added'$q$, :SA)),
  ('a_takes_b', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot')), 'saved')$q$, :PLAT, :SA, :'t_b')),
  ('a_save_own', format($q$SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot')) ->> 'mode'$q$, :PLAT, :SA, :'t_a')),
  ('b_takes_a', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           jsonb_build_object('terminal_number', %L), 'pilot')), 'saved')$q$, :PLAT, :SB, :'t_a')),
  -- P-2: a payment is on its way (returned) when a person removes B from the list
  ('o3_returned', format($q$SELECT pg_temp.pset('a3', pg_temp.pilot_returned(pg_temp.forced_online(%1$L, %2$L, false), %2$L, 'o3')::text)::jsonb ->> 'reference' IS NOT NULL$q$,
         :SB, :C3)),
  ('b_remove', format($q$DELETE FROM payments.pilot_stores WHERE tenant_id = %L RETURNING 'removed'$q$, :SB)),
  ('b_remove_audit', format($q$SELECT action FROM payments.tenant_config_audit WHERE tenant_id = %L ORDER BY id DESC LIMIT 1$q$, :SB)),
  ('b_gone_active', format($q$SELECT public.max_payments_active(%L, %L)::text$q$, :SB, :C3)),
  ('b_gone_open', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%%L, %%L, %%L, NULL, %%L)', %1$L,
           pg_temp.forced_online(%1$L, %2$L, false), %2$L, 'pilot')), 'opened')$q$, :SB, :C3)),
  ('tester_remove', format($q$DELETE FROM payments.pilot_testers WHERE tenant_id = %L AND user_id = %L RETURNING 'removed'$q$, :SA, :C4)),
  ('tester_remove_audit', format($q$SELECT action || '/' || changed_fields::text FROM payments.tenant_config_audit WHERE tenant_id = %L ORDER BY id DESC LIMIT 1$q$, :SA)),
  ('b_gone_save', format($q$SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
           '{"enabled": false}', 'pilot')), 'saved')$q$, :PLAT, :SB)),
  ('o3_settles', $q$SELECT (s ->> 'result') || '/' || (s ->> 'applied') FROM (SELECT pg_temp.pilot_settle(pg_temp.pv('a3')::jsonb, 'o3') AS s) x$q$),
  ('truncate', $q$TRUNCATE payments.pilot_stores$q$),
  ('truncate_testers', $q$TRUNCATE payments.pilot_testers$q$),
  -- P-1: the marker transitions
  ('to_demo', $q$UPDATE payments.environment SET name = 'demo' RETURNING name$q$),
  ('to_production', $q$UPDATE payments.environment SET name = 'production' RETURNING name$q$),
  ('to_off', $q$UPDATE payments.environment SET name = NULL RETURNING COALESCE(name, 'off') || '/' || (pilot_since IS NOT NULL)$q$),
  ('to_pilot_again', $q$UPDATE payments.environment SET name = 'pilot' RETURNING name$q$),
  ('to_off_again', $q$UPDATE payments.environment SET name = NULL RETURNING COALESCE(name, 'off')$q$),
  ('off_to_demo', $q$UPDATE payments.environment SET name = 'demo' RETURNING name$q$),
  ('off_to_production', $q$UPDATE payments.environment SET name = 'production' RETURNING name$q$),
  ('clear_stamp', $q$UPDATE payments.environment SET pilot_since = NULL RETURNING 'cleared'$q$);
CREATE TEMP TABLE op_pilot AS
SELECT s.k, u.r FROM unnest(pg_temp.probe((SELECT array_agg(q ORDER BY n) FROM op_pilot_steps))) WITH ORDINALITY AS u(r, n)
  JOIN op_pilot_steps s USING (n);
CREATE OR REPLACE FUNCTION pg_temp.pr(_k text) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE((SELECT r FROM op_pilot WHERE k = _k), 'missing:' || _k);
$f$;
SELECT tests.check('P-1 (pilot): an unmarked database that was never DEMO and never live becomes a pilot; pilot_since is stamped',
  $$SELECT pg_temp.pr('mark') = 'ok:pilot/true'$$);
SELECT tests.check('P-2 (pilot): a store outside the list gets no terminal — the platform admin''s save (before B joins; store A; B after it left) and the table owner''s direct insert are refused',
  $$SELECT pg_temp.pr('b_unlisted') LIKE 'error:%this store is not in the pilot%' AND pg_temp.pr('a_save') LIKE 'error:%this store is not in the pilot%'
       AND pg_temp.pr('a_insert') LIKE 'error:%this store is not in the pilot%' AND pg_temp.pr('b_gone_save') LIKE 'ok:%this store is not in the pilot%'$$);
SELECT tests.check('P-2 (pilot): a person adds and removes a store with SQL; each change is audited (system actor, no user, field name only); the list is never truncated',
  $$SELECT pg_temp.pr('b_add') = 'ok:added' AND pg_temp.pr('b_add_audit') = 'ok:pilot_store_added/system/true/{pilot_store}'
       AND pg_temp.pr('b_remove') = 'ok:removed' AND pg_temp.pr('b_remove_audit') = 'ok:pilot_store_removed'
       AND pg_temp.pr('truncate') LIKE 'error:%pilot_stores is never truncated%'$$);
SELECT tests.check('P-2 / P-4 (pilot): no grants on payments.pilot_stores and payments.pilot_testers — anon, authenticated and service_role cannot read or write them; no API function writes them',
  $$SELECT NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role),
                              unnest(ARRAY['payments.pilot_stores', 'payments.pilot_testers']) t(tbl)
                        WHERE has_table_privilege(r.role, t.tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
       AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
                        AND (p.prosrc LIKE '%pilot_stores%' OR p.prosrc LIKE '%pilot_testers%')
                        AND p.prosrc ~* '(insert|update|delete)[^;]*payments\.pilot_(stores|testers)')$$);
SELECT tests.check('P-4 (pilot): a person lists the named test customers with SQL; each listing and removal is audited (system actor, field name only — the tester''s user id is not copied); the list is never truncated',
  $$SELECT pg_temp.pr('testers_add') = 'ok:4' AND pg_temp.pr('testers_audit') = 'ok:pilot_tester_added/system/true/{pilot_tester}/4'
       AND pg_temp.pr('tester_remove') = 'ok:removed' AND pg_temp.pr('tester_remove_audit') = 'ok:pilot_tester_removed/{pilot_tester}'
       AND pg_temp.pr('truncate_testers') LIKE 'error:%pilot_testers is never truncated%'$$);
SELECT tests.check('P-1 / P-3 / P-6 (pilot): the platform admin saves the pilot store''s test terminal (verified, enabled); an app not marked pilot, mode live and a non-00100 number are refused',
  $$SELECT pg_temp.pr('save_app_demo') LIKE 'error:%environments differ%' AND pg_temp.pr('save_live_mode') LIKE 'error:%only test terminals%'
       AND pg_temp.pr('save_live_number') LIKE 'error:%only test terminals%'
       AND pg_temp.pr('b_save') = 'ok:test' AND pg_temp.pr('b_verified') = 'ok:verified' AND pg_temp.pr('b_enable') = 'ok:true'$$);
SELECT tests.check('P-3 (pilot): one terminal number is one store, in either order — B''s number refused for A, A''s own saved, A''s number refused for B',
  $$SELECT pg_temp.pr('a_add') = 'ok:added' AND pg_temp.pr('a_takes_b') LIKE 'ok:%already registered to another store%'
       AND pg_temp.pr('a_save_own') = 'ok:test' AND pg_temp.pr('b_takes_a') LIKE 'ok:%already registered to another store%'$$);
SELECT tests.check('P-4 (pilot): online payment is active only for the store''s named test customer — not another customer, a guest, a tester of another store, or unlisted staff; never in a store outside the list, even for its listed tester',
  $$SELECT pg_temp.pr('active') = 'ok:t/f/f/f/f/f/f'$$);
SELECT tests.check('P-4 (pilot): an ordinary customer and a guest cannot place an online order, and the open refuses their online orders',
  $$SELECT pg_temp.pr('c1_order') LIKE 'ok:%אינו זמין%' AND pg_temp.pr('guest_order') LIKE 'ok:%אינו זמין%'
       AND pg_temp.pr('c1_open') LIKE 'ok:%named test customers only%'
       AND pg_temp.pr('guest_token') = 'ok:true' AND pg_temp.pr('guest_open') LIKE 'ok:%named test customers only%'$$);
SELECT tests.check('P-4 (pilot): a tester of store A is refused on store B; a tester row for a store outside pilot_stores has no effect (refused)',
  $$SELECT pg_temp.pr('c4_on_b') LIKE 'ok:%named test customers only%' AND pg_temp.pr('ca_on_a') LIKE 'ok:%not available in this store (pilot)%'$$);
SELECT tests.check('P-4 (pilot): a store admin listed in pilot_testers still gets no online order — staff orders stay offline (orders_default_payment unchanged)',
  $$SELECT pg_temp.pr('owner_order') = 'ok:offline/not_required'$$);
SELECT tests.check('P-3 / P-4 (pilot): the named test customer places an online order and pays — test mode, B''s terminal; test_paid, applied, the order paid; above ₪50 refused',
  $$SELECT pg_temp.pr('tester_order') = 'ok:online/awaiting/true' AND pg_temp.pr('tester_open') LIKE 'ok:test/%/true'
       AND pg_temp.pr('tester_pay') = 'ok:test_paid/true' AND pg_temp.pr('tester_paid') = 'ok:paid' AND pg_temp.pr('tester_cap') LIKE 'ok:%limited to 50 ILS%'$$);
SELECT tests.check('P-6 (pilot): the store owner reads only {"active": …} (active = for at least one named tester) — no terminal, hint, mode or key metadata; the platform admin reads the full status; the owner''s settings save is kept, its answer trimmed the same way',
  format($$SELECT pg_temp.pr('owner_status_before') = 'ok:{"active": false}' AND pg_temp.pr('owner_status') = 'ok:{"active": true}'
             AND pg_temp.pr('plat_status') = 'ok:********' || right(%L, 2) AND pg_temp.pr('owner_settings') = 'ok:{"active": true}'$$, :'t_b'));
SELECT tests.check('P-6 (pilot): every store-owner attempt to save, clear, switch off, mark verified or inspect the terminal is refused in the database',
  $$SELECT pg_temp.pr('owner_term_save') LIKE 'ok:%only the platform admin sets up a payment terminal%'
       AND pg_temp.pr('owner_term_clear') LIKE 'ok:%only the platform admin sets up a payment terminal%'
       AND pg_temp.pr('owner_term_off') LIKE 'ok:%only the platform admin sets up a payment terminal%'
       AND pg_temp.pr('owner_term_verified') LIKE 'ok:%only the platform admin verifies a terminal%'
       AND pg_temp.pr('owner_term_secrets') LIKE 'ok:%only the platform admin checks a terminal%'$$);
SELECT tests.check('P-5 (pilot): the platform scope is off — NURIEL''s terminal not saved or verified, no platform attempt, nothing available; the sweeps, the purge and the alert claims still run',
  $$SELECT pg_temp.pr('plat_save') LIKE 'ok:%the platform terminal is off%' AND pg_temp.pr('plat_verified') LIKE 'ok:%the platform terminal is off%'
       AND pg_temp.pr('plat_open') LIKE 'ok:%not available in the pilot%'
       AND pg_temp.pr('plat_options') = 'ok:false' AND pg_temp.pr('jobs') = 'ok:t/t/t/array/array'$$);
SELECT tests.check('P-2 (pilot): a store that left the list is no longer active and opens no new attempt, but a payment already on its way still settles',
  $$SELECT pg_temp.pr('o3_returned') = 'ok:true' AND pg_temp.pr('b_gone_active') = 'ok:false'
       AND pg_temp.pr('b_gone_open') LIKE 'ok:%not available in this store (pilot)%' AND pg_temp.pr('o3_settles') = 'ok:test_paid/true'$$);
SELECT tests.check('P-1 (pilot): pilot → demo and pilot → production refused; pilot → off and back allowed; once a pilot, never DEMO or production; pilot_since is never cleared',
  $$SELECT pg_temp.pr('to_demo') LIKE 'error:%was a pilot%' AND pg_temp.pr('to_production') LIKE 'error:%was a pilot%'
       AND pg_temp.pr('to_off') = 'ok:off/true' AND pg_temp.pr('to_pilot_again') = 'ok:pilot' AND pg_temp.pr('to_off_again') = 'ok:off'
       AND pg_temp.pr('off_to_demo') LIKE 'error:%was a pilot%' AND pg_temp.pr('off_to_production') LIKE 'error:%was a pilot%'
       AND pg_temp.pr('clear_stamp') LIKE 'error:%pilot_since is never cleared%'$$);
SELECT tests.check('the pilot rehearsal left nothing behind (rolled back: unmarked, no pilot store, no terminal, no attempt, no pilot audit)',
  $$SELECT (SELECT name IS NULL AND demo_since IS NULL AND pilot_since IS NULL FROM payments.environment)
       AND NOT EXISTS (SELECT 1 FROM payments.pilot_stores) AND NOT EXISTS (SELECT 1 FROM payments.pilot_testers)
       AND NOT EXISTS (SELECT 1 FROM payments.tenant_accounts)
       AND NOT EXISTS (SELECT 1 FROM payments.tenant_attempts) AND NOT EXISTS (SELECT 1 FROM payments.terminal_registry)
       AND NOT EXISTS (SELECT 1 FROM payments.tenant_config_audit)$$);
CREATE TEMP TABLE op_prod_pilot AS
SELECT n, r FROM unnest(pg_temp.probe(ARRAY[
  $q$UPDATE payments.environment SET name = 'production' RETURNING name$q$,
  $q$UPDATE payments.environment SET name = 'pilot' RETURNING name$q$
])) WITH ORDINALITY AS t(r, n);
SELECT tests.check('P-1 (pilot): production → pilot is refused (rehearsal, rolled back)',
  $$SELECT (SELECT r = 'ok:production' FROM op_prod_pilot WHERE n = 1)
       AND (SELECT r LIKE 'error:%only an unmarked database%' FROM op_prod_pilot WHERE n = 2)$$);

-- ============================================================
-- 4. The DB owner marks this database DEMO (DM-ENV-2 / DM-ENV-3)
-- ============================================================
UPDATE payments.environment SET name = 'demo', note = 'local test DB (online-payments.test.sql)';
SELECT tests.check('DM-ENV-2: the DB owner marks the database demo — demo_since stamped, one system audit row with the field name only',
  $$SELECT (SELECT name = 'demo' AND demo_since IS NOT NULL AND changed_by = session_user::text FROM payments.environment)
       AND (SELECT count(*) = 1 AND bool_and(actor_role = 'system' AND actor_id IS NULL AND changed_fields = ARRAY['environment'])
              FROM payments.platform_config_audit WHERE action = 'environment_changed')$$);
SELECT tests.check('DM-ENV-2 (M5): a DEMO database never becomes production — not directly, not after being switched off',
  $$SELECT pg_temp.db_err($q$UPDATE payments.environment SET name = 'production'$q$) LIKE '%can never become production%'
       AND pg_temp.db_err($q$UPDATE payments.environment SET name = NULL; UPDATE payments.environment SET name = 'production'$q$)
             LIKE '%can never become production%'
       AND (SELECT name = 'demo' FROM payments.environment)$$);
SELECT tests.check('P-1 (pilot): a database that was DEMO never becomes a pilot — not directly, not after being switched off',
  $$SELECT pg_temp.db_err($q$UPDATE payments.environment SET name = 'pilot'$q$) LIKE '%only an unmarked database that was never DEMO%'
       AND pg_temp.db_err($q$UPDATE payments.environment SET name = NULL; UPDATE payments.environment SET name = 'pilot'$q$)
             LIKE '%only an unmarked database that was never DEMO%'
       AND (SELECT name = 'demo' AND pilot_since IS NULL FROM payments.environment)$$);
SELECT tests.check('DM-ENV-2 (M5): demo_since can never be cleared (it is what keeps a DEMO database out of production)',
  $$SELECT pg_temp.db_err('UPDATE payments.environment SET demo_since = NULL') LIKE '%demo_since is never cleared%'
       AND (SELECT demo_since IS NOT NULL FROM payments.environment)$$);
SELECT tests.check('DM-ENV-3: DEMO — mode live is refused',
  format($$SELECT pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
                    jsonb_build_object('mode', 'live', 'terminal_number', %L), 'demo')) LIKE '%%only test terminals%%'$$,
         :PLAT, :SA, :'t_live'));
SELECT tests.check('DM-ENV-3: DEMO — a terminal number without the 00100 test prefix is refused',
  format($$SELECT pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%%L, %%L, %%L, %%L)', %L, %L,
                    jsonb_build_object('terminal_number', %L), 'demo')) LIKE '%%only test terminals%%'
             AND NOT EXISTS (SELECT 1 FROM payments.terminal_registry)$$,
         :PLAT, :SA, :'t_live'));
SELECT tests.check('DM-ENV-3: DEMO — not even the database owner can write a live account (guard + CHECK)',
  format($$SELECT pg_temp.db_err(format('INSERT INTO payments.tenant_accounts (tenant_id, provider, mode) VALUES (%%L, %%L, %%L)', %L, 'max', 'live'))
             LIKE '%%only test terminals%%'$$, :SA));

-- ============================================================
-- 5. Step-up for NURIEL's terminal (M6; DM-SEP-6, the database part): HMAC only, 10 minutes, 5 tries, single use
--    From here on every action runs in its own statement (\gset); the checks only read.
-- ============================================================
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :B_OWNER, repeat('p', 64), repeat('c', 64))), '') AS su_owner \gset
SELECT tests.check('step-up: only a platform admin can request a code (a store owner is refused)',
  format($$SELECT %L LIKE '%%only a platform admin%%'$$, :'su_owner'));
SELECT pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT2, repeat('a', 64), repeat('1', 64))) AS su1 \gset
SELECT tests.check('step-up: issue returns {challenge_id, expires_at} — 10 minutes; the row holds only the code HMAC and the purpose hash',
  format($$SELECT (%1$L::jsonb ->> 'expires_at')::timestamptz BETWEEN now() + interval '9 minutes 50 seconds' AND now() + interval '10 minutes'
             AND (SELECT code_hmac = repeat('1', 64) AND purpose_hash = repeat('a', 64) AND tries = 0 AND consumed_at IS NULL
                    FROM payments.platform_stepup_challenges WHERE id = (%1$L::jsonb ->> 'challenge_id')::uuid)
             AND (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
                   WHERE table_schema = 'payments' AND table_name = 'platform_stepup_challenges')
                 = ARRAY['actor_id', 'code_hmac', 'consumed_at', 'created_at', 'expires_at', 'id', 'purpose_hash', 'spent_at',
                         'superseded_at', 'tries']$$, :'su1'));
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su1'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('2', 64))) AS su1_wrong \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su1'::jsonb ->> 'challenge_id', repeat('b', 64), repeat('1', 64))) AS su1_purpose \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT3, :'su1'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('1', 64))) AS su1_other \gset
SELECT tests.check('step-up: a wrong code counts a try (wrong_code); a different purpose counts a try (purpose_mismatch); another platform admin cannot use it (not_found)',
  format($$SELECT %1$L::jsonb = '{"ok": false, "reason": "wrong_code"}' AND %2$L::jsonb = '{"ok": false, "reason": "purpose_mismatch"}'
             AND %3$L::jsonb = '{"ok": false, "reason": "not_found"}'
             AND (SELECT tries = 2 AND consumed_at IS NULL FROM payments.platform_stepup_challenges WHERE id = %4$L)$$,
         :'su1_wrong', :'su1_purpose', :'su1_other', :'su1'::jsonb ->> 'challenge_id'));
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su1'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('1', 64))) AS su1_ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su1'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('1', 64))) AS su1_again \gset
SELECT tests.check('step-up: the right code is consumed once (ok); the same challenge never verifies again (used)',
  format($$SELECT %L::jsonb = '{"ok": true}' AND %L::jsonb = '{"ok": false, "reason": "used"}'$$, :'su1_ok', :'su1_again'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT3, '{"enabled": false}', 'demo',
         :'su1'::jsonb ->> 'challenge_id', repeat('a', 64))), '') AS save_no_code \gset
SELECT tests.check('step-up (M6): NURIEL''s terminal is never saved without a consumed code (another admin''s code does not count)',
  format($$SELECT %L LIKE '%%verification code%%' AND NOT EXISTS (SELECT 1 FROM payments.platform_accounts)$$, :'save_no_code'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT2, '{}', 'demo',
         :'su1'::jsonb ->> 'challenge_id', repeat('b', 64))), '') AS l7_purpose,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT2, '{}', 'demo',
         NULL, repeat('a', 64))), '') AS l7_none,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT2, '{}', 'demo',
         gen_random_uuid(), repeat('a', 64))), '') AS l7_other \gset
SELECT tests.check('DM-SEP-6 (review L7): the save names the exact challenge the admin consumed and its purpose — another purpose, no challenge or an unknown one is refused (and spends nothing)',
  format($$SELECT %L LIKE '%%verification code%%' AND %L LIKE '%%verification code%%' AND %L LIKE '%%verification code%%'
             AND (SELECT spent_at IS NULL FROM payments.platform_stepup_challenges WHERE id = %L)
             AND (SELECT count(*) FROM pg_proc WHERE proname = 'platform_terminal_save') = 1
             AND (SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'platform_terminal_save')
                 = '_actor uuid, _patch jsonb, _app_environment text, _challenge uuid, _purpose_hash text'$$,
         :'l7_purpose', :'l7_none', :'l7_other', :'su1'::jsonb ->> 'challenge_id'));
SELECT pg_temp.svc(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT2, '{}', 'demo',
         :'su1'::jsonb ->> 'challenge_id', repeat('a', 64))) AS su1_save \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT2, '{}', 'demo',
         :'su1'::jsonb ->> 'challenge_id', repeat('a', 64))), '') AS su1_save2 \gset
SELECT tests.check('step-up (M6): one consumed code authorizes exactly one save',
  format($$SELECT %1$L::jsonb ->> 'configured' = 'true' AND %2$L LIKE '%%verification code%%'
             AND (SELECT spent_at IS NOT NULL FROM payments.platform_stepup_challenges WHERE id = %3$L)$$,
         :'su1_save', :'su1_save2', :'su1'::jsonb ->> 'challenge_id'));
SELECT pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT2, repeat('a', 64), repeat('3', 64))) AS su2 \gset
DO $$
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', 'c2080000-0000-4000-8000-0000000000f2',
                               (SELECT id FROM payments.platform_stepup_challenges WHERE code_hmac = repeat('3', 64)),
                               repeat('a', 64), repeat('9', 64)));
  END LOOP;
END $$;
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su2'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('3', 64))) AS su2_right \gset
SELECT tests.check('step-up: five wrong tries lock the challenge — then even the right code is refused (locked)',
  format($$SELECT (SELECT tries = 5 AND consumed_at IS NULL FROM payments.platform_stepup_challenges WHERE id = %L)
             AND %L::jsonb = '{"ok": false, "reason": "locked"}'$$, :'su2'::jsonb ->> 'challenge_id', :'su2_right'));
SELECT pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT2, repeat('a', 64), repeat('4', 64))) AS su3 \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT2, repeat('a', 64), repeat('5', 64))) AS su4 \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su3'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('4', 64))) AS su3_old \gset
SELECT tests.check('step-up: a new code supersedes the open one (superseded)',
  format($$SELECT %L::jsonb = '{"ok": false, "reason": "superseded"}'$$, :'su3_old'));
-- age the open challenge (a test-only rewrite: the guard trigger refuses it in normal operation)
SET session_replication_role = replica;
UPDATE payments.platform_stepup_challenges SET created_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
 WHERE id = (:'su4'::jsonb ->> 'challenge_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT2, :'su4'::jsonb ->> 'challenge_id', repeat('a', 64), repeat('5', 64))) AS su4_late \gset
SELECT tests.check('step-up: an expired challenge is refused (expired)',
  format($$SELECT %L::jsonb = '{"ok": false, "reason": "expired"}'$$, :'su4_late'));
SELECT count(*) AS su_window FROM payments.platform_stepup_challenges
 WHERE actor_id = :PLAT2 AND created_at > now() - interval '10 minutes' \gset
CREATE TEMP TABLE op_issue (g integer, e text);
DO $$
BEGIN
  FOR g IN 1..8 LOOP
    INSERT INTO op_issue VALUES (g, pg_temp.svc_err(format('SELECT public.platform_stepup_issue(%L, %L, %L)',
                                   'c2080000-0000-4000-8000-0000000000f2', repeat('a', 64), repeat('6', 60) || lpad(g::text, 4, '0'))));
  END LOOP;
END $$;
SELECT tests.check('step-up: at most 5 codes per admin per 10 minutes (the 6th within the window is refused)',
  format($$SELECT (SELECT count(*) FROM op_issue WHERE e IS NULL) = 5 - %1$s
             AND (SELECT bool_and(e LIKE '%%too many verification codes%%') FROM op_issue WHERE e IS NOT NULL)
             AND (SELECT count(*) FROM payments.platform_stepup_challenges WHERE actor_id = %2$L AND created_at > now() - interval '10 minutes') = 5$$,
         :su_window, :PLAT2));
SELECT COALESCE(pg_temp.db_err(format('UPDATE payments.platform_stepup_challenges SET code_hmac = repeat(%L, 64) WHERE id = %L', 'z', :'su1'::jsonb ->> 'challenge_id')), '') AS su_rw1 \gset
SELECT COALESCE(pg_temp.db_err(format('UPDATE payments.platform_stepup_challenges SET tries = 0 WHERE id = %L', :'su2'::jsonb ->> 'challenge_id')), '') AS su_rw2 \gset
SELECT COALESCE(pg_temp.db_err(format('UPDATE payments.platform_stepup_challenges SET expires_at = expires_at + interval %L WHERE id = %L', '1 minute', :'su1'::jsonb ->> 'challenge_id')), '') AS su_rw3 \gset
SELECT COALESCE(pg_temp.db_err('DELETE FROM payments.platform_stepup_challenges'), '') AS su_del \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT3, 'short', repeat('c', 64))), '') AS su_bad \gset
SELECT tests.check('step-up: a challenge only moves forward (no rewrite of its hash, times or tries; no early delete); malformed input refused',
  format($$SELECT %L LIKE '%%only moves forward%%' AND %L LIKE '%%only moves forward%%' AND %L LIKE '%%only moves forward%%'
             AND %L LIKE '%%kept for a day%%' AND %L LIKE '%%malformed%%'$$,
         :'su_rw1', :'su_rw2', :'su_rw3', :'su_del', :'su_bad'));

-- ============================================================
-- 6. Terminals: NURIEL's and the stores' (platform admin only), the registry (DM-SEP-1), status, audit
-- ============================================================
SELECT pg_temp.stepup(:PLAT) AS su_p1 \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT,
         jsonb_build_object('terminal_number', :'t_plat', 'api_key_enc', pg_temp.tok('plat-key'),
                            'api_password_enc', pg_temp.tok('plat-pass'), 'enabled', true), 'demo',
         :'su_p1'::jsonb ->> 'challenge_id', repeat('p', 64))) AS pt \gset
SELECT tests.check('platform terminal: saved after a step-up code — test mode, unverified; the status shows the last 2 digits only (L5), no ciphertext, no kid',
  format($$SELECT %1$L::jsonb ->> 'mode' = 'test' AND %1$L::jsonb ->> 'status' = 'unverified' AND (%1$L::jsonb ->> 'enabled')::boolean
             AND %1$L::jsonb ->> 'terminal_hint' = '********' || right(%2$L, 2)
             AND position(%2$L IN %1$L) = 0 AND position('FAKE-' IN %1$L) = 0 AND position('v1:' IN %1$L) = 0
             AND (%1$L::jsonb ->> 'has_api_key')::boolean AND (%1$L::jsonb ->> 'has_api_password')::boolean
             AND (%1$L::jsonb ->> 'stepup_required')::boolean AND (%1$L::jsonb ->> 'test_amount_cap_minor')::int = 5000
             AND (SELECT mode = 'test' AND api_key_enc = pg_temp.tok('plat-key') AND key_id = '0badc0de' FROM payments.platform_accounts)$$,
         :'pt', :'t_plat'));
SELECT tests.check('platform terminal: the audit has field names only (created, credentials replaced with the key id, enabled) — no value column',
  format($$SELECT (SELECT array_agg(action ORDER BY id) FROM payments.platform_config_audit WHERE actor_role = 'platform_admin' AND provider = 'max')
             @> ARRAY['account_created', 'credentials_replaced', 'enabled']
       AND (SELECT changed_fields @> ARRAY['terminal_number', 'api_key', 'api_password', 'key_id'] AND actor_id = %L FROM payments.platform_config_audit
             WHERE action = 'credentials_replaced' ORDER BY id DESC LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'payments'
                        AND table_name IN ('platform_config_audit', 'tenant_config_audit')
                        AND column_name NOT IN ('id', 'tenant_id', 'provider', 'actor_id', 'actor_role', 'action', 'changed_fields', 'created_at'))$$,
         :PLAT));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_status(%L)', :B_OWNER)), '') AS pe1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_check_secrets(%L)', :B_OWNER)), '') AS pe2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_verified(%L, true, NULL)', :B_OWNER)), '') AS pe3 \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_check_secrets(%L)', :PLAT)) AS pt_secrets \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_verified(%L, true, %L)', :PLAT, '0')) AS pt_verified \gset
SELECT tests.check('platform terminal: status / verified / check_secrets — platform admins only; ciphertext (and its kid) only through check_secrets',
  format($$SELECT %L LIKE '%%only the platform admin%%' AND %L LIKE '%%only the platform admin%%' AND %L LIKE '%%only the platform admin%%'
             AND %L::jsonb ->> 'api_key_enc' = pg_temp.tok('plat-key') AND %5$L::jsonb ->> 'key_id' = '0badc0de'
             AND %6$L::jsonb ->> 'status' = 'verified'$$,
         :'pe1', :'pe2', :'pe3', :'pt_secrets', :'pt_secrets', :'pt_verified'));
SELECT COALESCE(pg_temp.db_err(format($q$UPDATE payments.platform_accounts SET api_key_enc = %L$q$, pg_temp.tok('plat-key', '0deadbee'))), '') AS kid_mix,
       COALESCE(pg_temp.db_err($q$UPDATE payments.platform_accounts SET api_key_enc = 'v1:0badc0de:short:TAGfakeTAGfakeTAGfake0:FAKE'$q$), '') AS tok_bad \gset
SELECT tests.check('lead decision: a token must be exactly v1:<8 hex>:<16>:<22>:<ct>, and the kid inside each token equals the account''s key_id',
  format($$SELECT %L LIKE '%%platform_accounts_key_id%%' AND %L LIKE '%%platform_accounts_api_key_enc_check%%'$$, :'kid_mix', :'tok_bad'));
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('terminal_number', :'t_b2', 'api_key_enc', pg_temp.tok('b-key'), 'api_password_enc', pg_temp.tok('b-pass'),
                            'verified_brands', jsonb_build_array('visa', 'mastercard')), 'demo')) AS sb1 \gset
SELECT tests.check('store terminal: the platform admin saves B''s terminal — test mode, unverified, last 2 digits, no ciphertext in the status; one account per store',
  format($$SELECT %1$L::jsonb ->> 'mode' = 'test' AND %1$L::jsonb ->> 'status' = 'unverified' AND NOT (%1$L::jsonb ->> 'enabled')::boolean
             AND %1$L::jsonb ->> 'terminal_hint' = '********' || right(%2$L, 2) AND position(%2$L IN %1$L) = 0
             AND position('FAKE-' IN %1$L) = 0 AND (%1$L::jsonb ->> 'has_api_key')::boolean
             AND (SELECT scope = 'tenant' AND tenant_id = %3$L FROM payments.terminal_registry WHERE terminal_number = %2$L)
             AND (SELECT count(*) = 1 AND bool_and(key_id = '0badc0de') FROM payments.tenant_accounts WHERE tenant_id = %3$L)
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_accounts_one_per_store' AND contype = 'u')
             AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_accounts_one_per_provider' AND contype = 'u')$$,
         :'sb1', :'t_b2', :SB));
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('terminal_number', :'t_b'), 'demo')) AS sb_move \gset
SELECT COALESCE(pg_temp.db_err(format('DELETE FROM payments.terminal_registry WHERE terminal_number = %L', :'t_b2')), '') AS reg_del \gset
SELECT tests.check('DM-SEP-1: an unused registered terminal can be released (B moves to another number; the old one is removed)',
  format($$SELECT %1$L::jsonb ->> 'terminal_hint' = '********' || right(%2$L, 2) AND %3$L = ''
             AND NOT EXISTS (SELECT 1 FROM payments.terminal_registry WHERE terminal_number = %4$L)$$,
         :'sb_move', :'t_b', :'reg_del', :'t_b2'));
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SA,
         jsonb_build_object('terminal_number', :'t_a', 'api_key_enc', pg_temp.tok('a-key'), 'api_password_enc', pg_temp.tok('a-pass')), 'demo')) AS sa1 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('terminal_number', :'t_a'), 'demo')), '') AS reg_a_for_b \gset
SELECT tests.check('DM-SEP-1: a store''s terminal number cannot be used by another store',
  format($$SELECT %1$L::jsonb ->> 'terminal_hint' = '********' || right(%2$L, 2) AND %3$L LIKE '%%already registered to another store%%'
             AND (SELECT terminal_number = %4$L FROM payments.tenant_accounts WHERE tenant_id = %5$L)$$,
         :'sa1', :'t_a', :'reg_a_for_b', :'t_b', :SB));
SELECT pg_temp.stepup(:PLAT) AS su_p2 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT, jsonb_build_object('terminal_number', :'t_b'), 'demo',
         :'su_p2'::jsonb ->> 'challenge_id', repeat('p', 64))), '') AS reg_b_for_plat \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('terminal_number', :'t_plat'), 'demo')), '') AS reg_plat_for_b \gset
SELECT tests.check('DM-SEP-1: a store terminal never becomes the platform terminal, and the platform terminal never a store terminal',
  format($$SELECT %L LIKE '%%already registered to another store%%' AND %L LIKE '%%already registered to the NURIEL platform terminal%%'
             AND (SELECT terminal_number = %L FROM payments.platform_accounts)$$,
         :'reg_b_for_plat', :'reg_plat_for_b', :'t_plat'));
SET client_min_messages = warning;  -- TRUNCATE … CASCADE lists the tables it would reach
SELECT COALESCE(pg_temp.db_err(format('UPDATE payments.terminal_registry SET tenant_id = %L WHERE terminal_number = %L', :SA, :'t_b')), '') AS reg_move,
       COALESCE(pg_temp.db_err('TRUNCATE payments.terminal_registry CASCADE'), '') AS reg_trunc \gset
RESET client_min_messages;
SELECT tests.check('DM-SEP-1: a registered terminal is never moved to another owner, nor truncated',
  format($$SELECT %L LIKE '%%cannot be moved%%' AND %L LIKE '%%never truncated%%'$$, :'reg_move', :'reg_trunc'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :B_OWNER, :SB, '{"enabled": true}', 'demo')), '') AS st1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :B_MGR, :SB, '{"enabled": true}', 'demo')), '') AS st2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_verified(%L, %L, true, NULL)', :B_OWNER, :SB)), '') AS st3,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_check_secrets(%L, %L)', :B_OWNER, :SB)), '') AS st4 \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_check_secrets(%L, %L)', :PLAT, :SB)) AS sb_secrets \gset
SELECT tests.check('store terminal: only the platform admin saves, verifies or reads the ciphertext (the store owner and a manager are refused)',
  format($$SELECT %L LIKE '%%only the platform admin%%' AND %L LIKE '%%only the platform admin%%' AND %L LIKE '%%only the platform admin%%'
             AND %L LIKE '%%only the platform admin%%' AND %L::jsonb ->> 'api_key_enc' = pg_temp.tok('b-key')$$,
         :'st1', :'st2', :'st3', :'st4', :'sb_secrets'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB, '{"test_access": "open"}', 'demo')), '') AS bad1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB, '{"key_version": 2}', 'demo')), '') AS bad2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('clear_credentials', true, 'api_key_enc', pg_temp.tok('x')), 'demo')), '') AS bad3 \gset
SELECT tests.check('store terminal: an unknown patch key (test_access, key_version) or clear + replace together is refused',
  format($$SELECT %L LIKE '%%invalid settings%%' AND %L LIKE '%%invalid settings%%' AND %L LIKE '%%not both%%'$$, :'bad1', :'bad2', :'bad3'));
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB, '{"enabled": true}', 'demo')) AS sb2 \gset
SELECT pg_temp.svc(format('SELECT public.max_account_status(%L, %L)', :B_OWNER, :SB)) AS st_owner,
       pg_temp.svc(format('SELECT public.max_account_status(%L, %L)', :PLAT, :SB)) AS st_plat,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_account_status(%L, %L)', :B_MGR, :SB)), '') AS st_mgr,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_account_status(%L, %L)', :B_AGENT, :SB)), '') AS st_agent,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_account_status(%L, %L)', :A_OWNER, :SB)), '') AS st_a \gset
SELECT tests.check('max_account_status: the store owner and the platform admin read B''s status (verified, enabled, no ciphertext); a manager, an agent and A''s owner are refused (DM-SEP-5)',
  format($$SELECT %1$L::jsonb ->> 'status' = 'verified' AND (%2$L::jsonb ->> 'enabled')::boolean AND position('FAKE-' IN %1$L) = 0
             AND position('0badc0de' IN %1$L) = 0
             AND %3$L LIKE '%%not allowed%%' AND %4$L LIKE '%%not allowed%%' AND %5$L LIKE '%%not allowed%%'$$,
         :'st_owner', :'st_plat', :'st_mgr', :'st_agent', :'st_a'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_store_settings_save(%L, %L, 3, 0, NULL, NULL)', :B_OWNER, :SB)), '') AS ss1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB, '{"terminal_max_installments": 3}', 'demo')), '') AS ss2 \gset
SELECT pg_temp.svc(format('SELECT public.max_store_settings_save(%L, %L, 1, 0, ARRAY[%L], ARRAY[%L])', :B_OWNER, :SB, 'card', 'visa')) AS ss3 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_store_settings_save(%L, %L, 1, 0, ARRAY[%L], NULL)', :B_OWNER, :SB, 'bit')), '') AS ss4,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_store_settings_save(%L, %L, 1, 0, NULL, NULL)', :B_MGR, :SB)), '') AS ss5 \gset
SELECT tests.check('max_store_settings_save (M10): DEMO — more than one payment is refused (store owner and the terminal save alike); one payment is saved, audited by field name; only verified methods; a manager is refused',
  format($$SELECT %1$L LIKE '%%one payment only%%' AND %2$L LIKE '%%one payment only%%'
             AND %3$L::jsonb -> 'store' ->> 'max_installments' = '1' AND %3$L::jsonb -> 'store' -> 'allowed_brands' = '["visa"]'
             AND %4$L LIKE '%%verified for the terminal%%' AND %5$L LIKE '%%only the store owner%%'
             AND (SELECT changed_fields @> ARRAY['allowed_brands'] AND actor_role = 'store_owner' FROM payments.tenant_config_audit
                   WHERE tenant_id = %6$L AND action = 'store_settings_changed' ORDER BY id DESC LIMIT 1)$$,
         :'ss1', :'ss2', :'ss3', :'ss4', :'ss5', :SB));
SET client_min_messages = warning;  -- TRUNCATE … CASCADE lists the tables it would reach
SELECT COALESCE(pg_temp.db_err('UPDATE payments.tenant_config_audit SET action = action'), '') AS ao1,
       COALESCE(pg_temp.db_err('DELETE FROM payments.platform_config_audit'), '') AS ao2,
       COALESCE(pg_temp.db_err('TRUNCATE payments.tenant_config_audit'), '') AS ao3,
       COALESCE(pg_temp.db_err('TRUNCATE payments.tenant_attempts CASCADE'), '') AS ao4,
       COALESCE(pg_temp.db_err('UPDATE payments.tenant_events SET result = result'), '') AS ao5 \gset
RESET client_min_messages;
SELECT tests.check('audit: events and config audit are append-only — UPDATE, DELETE and TRUNCATE are refused, even for the database owner',
  format($$SELECT %L LIKE '%%append-only%%' AND %L LIKE '%%append-only%%' AND %L LIKE '%%append-only%%' AND %L LIKE '%%append-only%%'
             AND (%L LIKE '%%append-only%%' OR NOT EXISTS (SELECT 1 FROM payments.tenant_events))$$,
         :'ao1', :'ao2', :'ao3', :'ao4', :'ao5'));

-- ============================================================
-- 7. A store payment, store B (DM-ENV-6 DB part, DM-SEP-5, the settle path)
-- ============================================================
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_payments_active(%L))', :SB)) AS act_off \gset
SELECT tests.check('DM-ENV-6 (DB): with max_payments off nothing is offered — even with an enabled, verified terminal',
  format($$SELECT NOT %L::boolean$$, :'act_off'));
SELECT pg_temp.call(NULL, :PLAT, $$SELECT to_jsonb(public.platform_set_flag('max_payments', true))$$) AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_payments_active(%L))', :SB)) AS act_b,
       pg_temp.svc(format('SELECT to_jsonb(public.max_payments_active(%L))', :SA)) AS act_a,
       pg_temp.svc(format('SELECT to_jsonb(public.max_payments_active(%L))', :DEFAULT_STORE)) AS act_default,
       pg_temp.svc('SELECT to_jsonb(public.max_payments_active(NULL))') AS act_null \gset
SELECT tests.check('max_payments_active: on for B; off for A (unverified) and for the default store (no terminal) — the store is always explicit',
  format($$SELECT %L::boolean AND NOT %L::boolean AND NOT %L::boolean AND NOT %L::boolean$$,
         :'act_b', :'act_a', :'act_default', :'act_null'));
SELECT pg_temp.order_of(:SB, :C1, :P10, :SHIP_B, 1, 'online') AS o1 \gset
SELECT tests.check('checkout: a customer of B places an online order — pending, awaiting payment, due in 2 hours, ₪10',
  format($$SELECT status = 'pending' AND payment_method = 'online' AND payment_status = 'awaiting' AND total = 10
                  AND payment_due_at BETWEEN now() + interval '1 hour 59 minutes' AND now() + interval '2 hours 1 minute'
             FROM public.orders WHERE id = %L$$, :'o1'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SA, :'o1', :C1, 'demo')), '') AS op1,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'o1', :C2, 'demo')), '') AS op2,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, NULL, NULL, %L)', :SB, :'o1', 'demo')), '') AS op3,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(NULL, %L, %L, NULL, %L)', :'o1', :C1, 'demo')), '') AS op4,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'o1', :C1, 'production')), '') AS op5,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, NULL)', :SB, :'o1', :C1)), '') AS op6 \gset
SELECT tests.check('DM-SEP-5: open with store A for B''s order, by another customer, or with no customer → order not found; no store → refused',
  format($$SELECT %L LIKE '%%order not found%%' AND %L LIKE '%%order not found%%' AND %L LIKE '%%order not found%%'
             AND %L LIKE '%%store and order are required%%' AND NOT EXISTS (SELECT 1 FROM payments.tenant_attempts WHERE order_id = %L)$$,
         :'op1', :'op2', :'op3', :'op4', :'o1'));
SELECT tests.check('DM-ENV-2: open with the app marker production, or none, is refused (the two markers must agree)',
  format($$SELECT %L LIKE '%%environments differ%%' AND %L LIKE '%%environments differ%%'$$, :'op5', :'op6'));
SELECT pg_temp.t_open(:SB, :'o1', :C1) AS a1 \gset
SELECT pg_temp.t_open(:SB, :'o1', :C1) AS a1_again \gset
SELECT tests.check('open: a test attempt for the order amount in agorot, one payment, on B''s terminal, with the key id; opening again reuses it',
  format($$SELECT %1$L::jsonb ->> 'mode' = 'test' AND (%1$L::jsonb ->> 'amount_minor')::bigint = 1000 AND %1$L::jsonb ->> 'currency' = 'ILS'
             AND (%1$L::jsonb ->> 'max_installments')::int = 1 AND %1$L::jsonb ->> 'terminal_number' = %2$L
             AND NOT (%1$L::jsonb ->> 'reused')::boolean AND %1$L::jsonb ->> 'reference' ~ '^[0-9a-f]{32}$'
             AND (%3$L::jsonb ->> 'reused')::boolean AND %3$L::jsonb ->> 'attempt_id' = %1$L::jsonb ->> 'attempt_id'
             AND (SELECT count(*) = 1 AND bool_and(key_id = '0badc0de') FROM payments.tenant_attempts WHERE order_id = %4$L)$$,
         :'a1', :'t_b', :'a1_again', :'o1'));
SELECT pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'a1'::jsonb ->> 'attempt_id', 'sign')) AS sec_sign,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SA, :'a1'::jsonb ->> 'attempt_id', 'sign')), '') AS sec_a,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'a1'::jsonb ->> 'attempt_id', 'refund')), '') AS sec_bad,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'a1'::jsonb ->> 'attempt_id', 'verify')), '') AS sec_early \gset
SELECT tests.check('secrets(sign): B''s ciphertext and key id for B''s attempt only — another store''s id → unknown attempt; an unknown purpose → refused; nothing to verify yet',
  format($$SELECT %1$L::jsonb ->> 'api_key_enc' = pg_temp.tok('b-key') AND %1$L::jsonb ->> 'key_id' = '0badc0de'
             AND %2$L LIKE '%%unknown attempt%%' AND %3$L LIKE '%%unknown purpose%%' AND %4$L LIKE '%%nothing to verify%%'$$,
         :'sec_sign', :'sec_a', :'sec_bad', :'sec_early'));
SELECT pg_temp.t_sign(:SB, :'a1'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.h('fake-return|order-1|payload-1') AS pl1, pg_temp.h('fake-return|order-1|payload-2') AS pl1b \gset
SELECT pg_temp.t_ret(:SA, :'a1'::jsonb ->> 'reference', :'pl1', '0', 'fake-b-0001', 1000) AS ret_wrong \gset
SELECT tests.check('DM-SEP-5: B''s return arriving on store A''s address → unknown, without a payload slot; the real attempt keeps a wrong_host event',
  format($$SELECT %1$L::jsonb ->> 'result' = 'unknown'
             AND (SELECT count(*) FROM payments.tenant_events WHERE attempt_id = %2$L AND source = 'wrong_host' AND payload_sha256 IS NULL) = 1
             AND NOT EXISTS (SELECT 1 FROM payments.tenant_events WHERE attempt_id = %2$L AND source = 'return')
             AND (SELECT state = 'redirected' AND signed_at IS NOT NULL FROM payments.tenant_attempts WHERE id = %2$L)$$,
         :'ret_wrong', :'a1'::jsonb ->> 'attempt_id'));
SELECT pg_temp.t_ret(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', 'fake-b-0001', 1000) AS ret1 \gset
SELECT pg_temp.t_ret(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', 'fake-b-0001', 1000) AS ret1_again \gset
SELECT tests.check('record_return on B (X-14): received → the attempt is returned; the same payload again → replay; the order is held in the database (no due time)',
  format($$SELECT %1$L::jsonb ->> 'result' = 'received' AND %2$L::jsonb ->> 'result' = 'replay'
             AND %1$L::jsonb ->> 'terminal_number' = %5$L
             AND (SELECT state = 'returned' AND returned_at IS NOT NULL FROM payments.tenant_attempts WHERE id = %3$L)
             AND (SELECT payment_due_at IS NULL AND status = 'pending' AND payment_status = 'awaiting' FROM public.orders WHERE id = %4$L)
             AND (SELECT count(*) FROM payments.tenant_events WHERE attempt_id = %3$L AND source = 'return') = 1$$,
         :'ret1', :'ret1_again', :'a1'::jsonb ->> 'attempt_id', :'o1', :'t_b'));
SELECT pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'a1'::jsonb ->> 'attempt_id', 'verify')) AS lease1 \gset
SELECT pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'a1'::jsonb ->> 'attempt_id', 'verify')) AS lease2 \gset
SELECT tests.check('verify lease: the first VERIFY gets the ciphertext; a second one meanwhile is told busy',
  format($$SELECT %L::jsonb ->> 'result' = 'ok' AND %L::jsonb ->> 'result' = 'busy'$$, :'lease1', :'lease2'));
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1b', '0', '0', :'t_b', 'fake-b-0001', 1000) AS se1,
       pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '3', '0', :'t_b', 'fake-b-0001', 1000) AS se2 \gset
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '0', :'t_b', 'fake-b-0001', 1000, 'ILS', 1, '{}', 'production') AS se3,
       pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '0', :'t_b', 'fake-b-0001', 1000, 'ILS', 1, '{}', NULL) AS se4 \gset
SELECT tests.check('settle: a payload that never arrived → unknown_payload; VERIFY not 0 → unverified; the app marker differs → environment_mismatch; nothing changed',
  format($$SELECT %1$L::jsonb ->> 'result' = 'unknown_payload' AND %2$L::jsonb ->> 'result' = 'unverified'
             AND %3$L::jsonb ->> 'result' = 'environment_mismatch' AND %4$L::jsonb ->> 'result' = 'environment_mismatch'
             AND (SELECT state = 'returned' AND NOT applied AND provider_txn_id IS NULL FROM payments.tenant_attempts WHERE id = %5$L)
             AND (SELECT payment_status = 'awaiting' FROM public.orders WHERE id = %6$L)
             AND (SELECT count(*) FROM payments.tenant_events WHERE attempt_id = %5$L AND source = 'verify' AND result = 'env_mismatch') = 2$$,
         :'se1', :'se2', :'se3', :'se4', :'a1'::jsonb ->> 'attempt_id', :'o1'));
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '0', :'t_b', 'fake-b-0001', 1000) AS s1 \gset
SELECT tests.check('settle: verified and matching → test_paid, applied; the order is paid; no return flags; the lease is released',
  format($$SELECT %1$L::jsonb ->> 'result' = 'test_paid' AND (%1$L::jsonb ->> 'applied')::boolean
             AND (SELECT state = 'test_paid' AND applied AND provider_txn_id = 'fake-b-0001' AND return_flags = '{}'
                         AND verify_lease_until IS NULL AND card_last4 = '0000' AND card_brand = 'visa' FROM payments.tenant_attempts WHERE id = %2$L)
             AND (SELECT payment_status = 'paid' AND paid_at IS NOT NULL AND payment_due_at IS NULL AND status = 'pending'
                    FROM public.orders WHERE id = %3$L)$$,
         :'s1', :'a1'::jsonb ->> 'attempt_id', :'o1'));
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '0', :'t_b', 'fake-b-0001', 1000) AS s1_again \gset
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '0', :'t_b', 'fake-b-0099', 1000) AS s1_other \gset
SELECT tests.check('settle: the same settle again → already_paid; another approved transaction for the settled attempt → duplicate_charge (a refund case)',
  format($$SELECT %1$L::jsonb ->> 'result' = 'already_paid' AND %2$L::jsonb ->> 'result' = 'duplicate_charge'
             AND (SELECT state = 'test_paid' AND review_reason = 'duplicate_charge' AND provider_txn_id = 'fake-b-0001'
                    FROM payments.tenant_attempts WHERE id = %3$L)$$,
         :'s1_again', :'s1_other', :'a1'::jsonb ->> 'attempt_id'));
SELECT pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'o1', :C1)) AS ps_cust,
       pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'o1', :B_AGENT)) AS ps_staff,
       pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'o1', :PLAT)) AS ps_plat,
       COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'o1', :C2))::text, 'null') AS ps_other,
       COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'o1', :A_OWNER))::text, 'null') AS ps_a,
       COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SA, :'o1', :C1))::text, 'null') AS ps_wrong \gset
SELECT tests.check('DM-SEP-5: the payment status — the customer and B''s staff see it; another customer, A''s owner and a wrong store get nothing',
  format($$SELECT %1$L::jsonb -> 'attempt' ->> 'state' = 'test_paid' AND %2$L::jsonb ->> 'payment_status' = 'paid'
             AND %3$L = 'null' AND %4$L = 'null' AND %5$L = 'null'$$,
         :'ps_cust', :'ps_staff', :'ps_other', :'ps_a', :'ps_wrong'));
SELECT tests.check('lead decision: attempt_id and review_reason are shown to B''s staff and platform admins only — never to the customer',
  format($$SELECT NOT (%1$L::jsonb -> 'attempt' ? 'attempt_id') AND NOT (%1$L::jsonb -> 'attempt' ? 'review_reason')
             AND %2$L::jsonb -> 'attempt' ->> 'attempt_id' = %4$L AND %2$L::jsonb -> 'attempt' ->> 'review_reason' = 'duplicate_charge'
             AND %3$L::jsonb -> 'attempt' ->> 'attempt_id' = %4$L$$,
         :'ps_cust', :'ps_staff', :'ps_plat', :'a1'::jsonb ->> 'attempt_id'));

-- ============================================================
-- 8. Settle checks (DM-PAY-5): every mismatch goes to a person (needs_review), never to "paid"
-- ============================================================
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o2 \gset
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o3 \gset
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o4 \gset
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o5 \gset
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o6 \gset
SELECT pg_temp.order_of(:SB, :C2, :P10, :SHIP_B, 1, 'online') AS o7 \gset
SELECT pg_temp.t_pay(:SB, :'o2', :C2, 'fake-b-0002', '0', 999) AS r2 \gset
SELECT pg_temp.t_pay(:SB, :'o3', :C2, 'fake-b-0003', '0', NULL, 'USD') AS r3 \gset
SELECT pg_temp.t_pay(:SB, :'o4', :C2, 'fake-b-0004', '0', NULL, 'ILS', 2) AS r4 \gset
SELECT pg_temp.t_pay(:SB, :'o5', :C2, 'fake-b-0005', '0', NULL, 'ILS', 1, '{}', :'t_a') AS r5 \gset
SELECT pg_temp.t_pay(:SB, :'o6', :C2, 'fake-b-0001') AS r6 \gset
SELECT pg_temp.t_pay(:SB, :'o7', :C2, 'fake-b-0007', '33') AS r7 \gset
SELECT tests.check('DM-PAY-5: the amount returned differs → needs_review amount_mismatch; the order stays awaiting; a review event is logged',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'amount_mismatch'
             AND (SELECT payment_status = 'awaiting' FROM public.orders WHERE id = %2$L)
             AND (SELECT state = 'needs_review' AND NOT applied AND review_reason = 'amount_mismatch' FROM payments.tenant_attempts WHERE order_id = %2$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events e JOIN payments.tenant_attempts a ON a.id = e.attempt_id
                          WHERE a.order_id = %2$L AND e.source = 'review' AND e.result = 'amount_mismatch')$$, :'r2', :'o2'));
SELECT tests.check('DM-PAY-5: another currency → needs_review currency_mismatch',
  format($$SELECT %L::jsonb ->> 'reason' = 'currency_mismatch'$$, :'r3'));
SELECT tests.check('DM-PAY-5 (M10): more than one payment returned → needs_review installments_exceeded',
  format($$SELECT %L::jsonb ->> 'reason' = 'installments_exceeded'$$, :'r4'));
SELECT tests.check('DM-PAY-5: VERIFY ran with another terminal than the attempt''s → needs_review terminal_mismatch',
  format($$SELECT %L::jsonb ->> 'reason' = 'terminal_mismatch'$$, :'r5'));
SELECT tests.check('DM-PAY-5: a transaction id already used on this terminal → needs_review duplicate_txn (the id is not stored twice)',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'duplicate_txn'
             AND (SELECT provider_txn_id IS NULL FROM payments.tenant_attempts WHERE order_id = %2$L)
             AND (SELECT count(*) FROM payments.tenant_attempts WHERE provider_txn_id = 'fake-b-0001') = 1$$, :'r6', :'o6'));
SELECT tests.check('DM-PAY-5: a plain decline (CCode 33) → not_paid, the attempt failed with its code; the order still awaits',
  format($$SELECT %1$L::jsonb ->> 'result' = 'not_paid'
             AND (SELECT state = 'failed' AND failure_code = '33' AND verified_at IS NOT NULL FROM payments.tenant_attempts WHERE order_id = %2$L)
             AND (SELECT payment_status = 'awaiting' FROM public.orders WHERE id = %2$L)$$, :'r7', :'o7'));
-- late returns (decision 5 / M09): the attempt expired, the order still awaits → paid; the order moved on → late
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS o8 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS o9 \gset
SELECT pg_temp.t_open(:SB, :'o8', :C3) AS a8 \gset
SELECT pg_temp.t_open(:SB, :'o9', :C3) AS a9 \gset
SELECT pg_temp.t_sign(:SB, :'a8'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.t_sign(:SB, :'a9'::jsonb ->> 'attempt_id') AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_attempts SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute'
 WHERE id IN ((:'a8'::jsonb ->> 'attempt_id')::uuid, (:'a9'::jsonb ->> 'attempt_id')::uuid);
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS swept \gset
SELECT tests.check('expiry sweep: time-expired attempts → expired (SKIP LOCKED sweep, an event each)',
  format($$SELECT %L::int >= 2 AND (SELECT bool_and(state = 'expired') FROM payments.tenant_attempts WHERE id IN (%L, %L))
             AND (SELECT count(*) FROM payments.tenant_events WHERE attempt_id IN (%2$L, %3$L) AND source = 'expire') = 2$$,
         :'swept', :'a8'::jsonb ->> 'attempt_id', :'a9'::jsonb ->> 'attempt_id'));
UPDATE public.orders SET status = 'cancelled' WHERE id = :'o9';
SELECT pg_temp.h('fake-return|late-8') AS pl8, pg_temp.h('fake-return|late-9') AS pl9 \gset
SELECT pg_temp.t_ret(:SB, :'a8'::jsonb ->> 'reference', :'pl8', '0', 'fake-b-0008', 1000) AS ok \gset
SELECT pg_temp.t_ret(:SB, :'a9'::jsonb ->> 'reference', :'pl9', '0', 'fake-b-0009', 1000) AS ok \gset
SELECT pg_temp.t_settle(:SB, :'a8'::jsonb ->> 'reference', :'pl8', '0', '0', :'t_b', 'fake-b-0008', 1000) AS s8 \gset
SELECT pg_temp.t_settle(:SB, :'a9'::jsonb ->> 'reference', :'pl9', '0', '0', :'t_b', 'fake-b-0009', 1000) AS s9 \gset
SELECT tests.check('DM-PAY-5 (late): the attempt expired but the order still awaits the same amount → paid',
  format($$SELECT %L::jsonb ->> 'result' = 'test_paid' AND (SELECT payment_status = 'paid' FROM public.orders WHERE id = %L)$$, :'s8', :'o8'));
SELECT tests.check('DM-PAY-5 (late): the order was cancelled meanwhile → needs_review late; the order is not touched',
  format($$SELECT %L::jsonb ->> 'reason' = 'late'
             AND (SELECT status = 'cancelled' AND payment_status <> 'paid' FROM public.orders WHERE id = %L)$$, :'s9', :'o9'));

-- ============================================================
-- 9. Holds (DM-PAY-6): CCode 10 (partial approval) / 600 / 700 / 800, HKId, MULTI → needs_review unexpected_hold
-- 10. Documents (DM-PAY-7): Hesh / HeshASM returned → needs_review document_issued; only the flag is kept
-- ============================================================
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h0 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h1 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h2 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h3 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h4 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS h5 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS d1 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS d2 \gset
SELECT pg_temp.order_of(:SB, :C3, :P10, :SHIP_B, 1, 'online') AS d3 \gset
SELECT pg_temp.t_pay(:SB, :'h0', :C3, 'fake-h-0010', '10') AS rh0 \gset
SELECT pg_temp.t_pay(:SB, :'h1', :C3, 'fake-h-0600', '600') AS rh1 \gset
SELECT pg_temp.t_pay(:SB, :'h2', :C3, 'fake-h-0700', '700') AS rh2 \gset
SELECT pg_temp.t_pay(:SB, :'h3', :C3, 'fake-h-0800', '800') AS rh3 \gset
SELECT pg_temp.t_pay(:SB, :'h4', :C3, 'fake-h-0hk1', '0', NULL, 'ILS', 1, '{hk}') AS rh4 \gset
SELECT pg_temp.t_pay(:SB, :'h5', :C3, 'fake-h-0mu1', '0', NULL, 'ILS', 1, '{multi}') AS rh5 \gset
SELECT tests.check('DM-PAY-6: CCode 10 (partial approval) → needs_review unexpected_hold — never failed, never paid; the order stays awaiting',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'unexpected_hold'
             AND (SELECT state = 'needs_review' AND failure_code IS NULL AND NOT applied AND verification ->> 'ccode' = '10'
                    FROM payments.tenant_attempts WHERE order_id = %2$L)
             AND (SELECT payment_status = 'awaiting' AND paid_at IS NULL FROM public.orders WHERE id = %2$L)$$, :'rh0', :'h0'));
SELECT tests.check('DM-PAY-6: CCode 600 / 700 / 800 → needs_review unexpected_hold (before the failed branch); the orders stay awaiting',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'unexpected_hold' AND %2$L::jsonb ->> 'reason' = 'unexpected_hold'
             AND %3$L::jsonb ->> 'reason' = 'unexpected_hold'
             AND (SELECT bool_and(state = 'needs_review' AND failure_code IS NULL AND NOT applied) FROM payments.tenant_attempts
                   WHERE order_id IN (%4$L, %5$L, %6$L))
             AND (SELECT bool_and(payment_status = 'awaiting') FROM public.orders WHERE id IN (%4$L, %5$L, %6$L))$$,
         :'rh1', :'rh2', :'rh3', :'h1', :'h2', :'h3'));
SELECT tests.check('DM-PAY-6: an approved return carrying HKId (standing order) or MULTI → needs_review unexpected_hold, the flag kept',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'unexpected_hold' AND %2$L::jsonb ->> 'reason' = 'unexpected_hold'
             AND (SELECT return_flags = '{hk}' FROM payments.tenant_attempts WHERE order_id = %3$L)
             AND (SELECT return_flags = '{multi}' FROM payments.tenant_attempts WHERE order_id = %4$L)$$,
         :'rh4', :'rh5', :'h4', :'h5'));
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '10', :'t_b', 'fake-b-0098', 1000) AS hold_on_paid \gset
SELECT pg_temp.t_settle(:SB, :'a1'::jsonb ->> 'reference', :'pl1', '0', '33', :'t_b', 'fake-b-0097', 1000) AS decline_on_paid \gset
SELECT tests.check('DM-PAY-6: a hold (CCode 10) with another transaction for an attempt already settled → duplicate_charge (money may have moved); a plain decline → already_paid',
  format($$SELECT %1$L::jsonb ->> 'result' = 'duplicate_charge' AND %2$L::jsonb ->> 'result' = 'already_paid'
             AND (SELECT state = 'test_paid' AND provider_txn_id = 'fake-b-0001' FROM payments.tenant_attempts WHERE id = %3$L)$$,
         :'hold_on_paid', :'decline_on_paid', :'a1'::jsonb ->> 'attempt_id'));
SELECT pg_temp.t_pay(:SB, :'d1', :C3, 'fake-d-0001', '0', NULL, 'ILS', 1, '{document}') AS rd1 \gset
SELECT pg_temp.t_pay(:SB, :'d2', :C3, 'fake-d-0002', '33', NULL, 'ILS', 1, '{hk,document}') AS rd2 \gset
SELECT tests.check('DM-PAY-7: an approved return with Hesh / HeshASM → needs_review document_issued; the order is NOT paid; only the presence flag is stored (attempt and event)',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'document_issued'
             AND (SELECT state = 'needs_review' AND NOT applied AND return_flags = '{document}' AND verification -> 'flags' = '["document"]'
                    FROM payments.tenant_attempts WHERE order_id = %2$L)
             AND (SELECT payment_status = 'awaiting' FROM public.orders WHERE id = %2$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events e JOIN payments.tenant_attempts a ON a.id = e.attempt_id
                          WHERE a.order_id = %2$L AND e.source = 'verify' AND e.summary -> 'flags' = '["document"]')
             AND EXISTS (SELECT 1 FROM payments.tenant_events e JOIN payments.tenant_attempts a ON a.id = e.attempt_id
                          WHERE a.order_id = %2$L AND e.source = 'review' AND e.result = 'document_issued')$$, :'rd1', :'d1'));
SELECT tests.check('DM-PAY-7: a document flag wins over a hold, also on a non-zero CCode (never a plain "failed"); both flags kept',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'document_issued'
             AND (SELECT return_flags = '{document,hk}' AND state = 'needs_review' FROM payments.tenant_attempts WHERE order_id = %2$L)$$,
         :'rd2', :'d2'));
SELECT pg_temp.t_open(:SB, :'d3', :C3) AS ad3 \gset
SELECT pg_temp.t_sign(:SB, :'ad3'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.h('fake-return|d3') AS pld3 \gset
SELECT pg_temp.t_ret(:SB, :'ad3'::jsonb ->> 'reference', :'pld3', '0', 'fake-d-0003', 1000) AS ok \gset
SELECT pg_temp.t_settle(:SB, :'ad3'::jsonb ->> 'reference', :'pld3', '0', '0', :'t_b', 'fake-d-0003', 1000, 'ILS', 1, '{hesh}') AS sd3 \gset
SELECT tests.check('settle: an unknown return flag is a malformed call — nothing changes',
  format($$SELECT %1$L::jsonb ->> 'result' = 'malformed'
             AND (SELECT state = 'returned' FROM payments.tenant_attempts WHERE id = %2$L)
             AND NOT EXISTS (SELECT 1 FROM payments.tenant_events WHERE attempt_id = %2$L AND source = 'verify')$$,
         :'sd3', :'ad3'::jsonb ->> 'attempt_id'));

-- ============================================================
-- 11. Test-mode cap (DM-ENV-5): at most ₪50 per attempt, in both attempt tables
-- ============================================================
SELECT pg_temp.order_of(:SB, :C3, :P60, :SHIP_B, 1, 'online') AS o60 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'o60', :C3, 'demo')), '') AS cap_err \gset
SELECT tests.check('DM-ENV-5: a ₪60 order cannot be paid in test mode (open refused, no attempt)',
  format($$SELECT %L LIKE '%%limited to 50 ILS%%' AND NOT EXISTS (SELECT 1 FROM payments.tenant_attempts WHERE order_id = %L)$$,
         :'cap_err', :'o60'));
SELECT tests.check('DM-ENV-5: the cap is a CHECK on both attempt tables (5000 agorot), and test attempts are one payment only',
  $$SELECT (SELECT count(*) FROM pg_constraint WHERE connamespace = 'payments'::regnamespace
             AND conname IN ('tenant_attempts_test_cap', 'platform_attempts_test_cap')
             AND pg_get_constraintdef(oid) LIKE '%amount_minor <= 5000%') = 2
       AND (SELECT count(*) FROM pg_constraint WHERE connamespace = 'payments'::regnamespace
             AND conname IN ('tenant_attempts_test_one_payment', 'platform_attempts_test_one_payment')) = 2$$);

-- ============================================================
-- 12. The amount lock (DM-PAY-8): while being paid — for everyone; once paid — for everyone, staff included (M11)
-- ============================================================
SELECT pg_temp.order_of(:SB, :C1, :P10, :SHIP_B, 1, 'online') AS l1 \gset
SELECT pg_temp.t_open(:SB, :'l1', :C1) AS al1 \gset
SELECT pg_temp.t_sign(:SB, :'al1'::jsonb ->> 'attempt_id') AS ok \gset
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET quantity = 2 WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS lk1,
       COALESCE(pg_temp.err(:SB, :PLAT, format('WITH u AS (UPDATE public.order_items SET quantity = 2 WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS lk2,
       COALESCE(pg_temp.db_err(format('UPDATE public.orders SET shipping_price = 5 WHERE id = %L', :'l1')), '') AS lk3,
       COALESCE(pg_temp.err(:SB, :C1, format('WITH u AS (INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) VALUES (%L, %L, 1, 10) RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1', :P10)), '') AS lk4 \gset
SELECT tests.check('DM-PAY-8: while an attempt is active the lines cannot change — not by the store owner, not by a platform admin; the total (a shipping-price edit) not even by the database owner; a customer adds no line',
  format($$SELECT %L LIKE '%%being paid online%%' AND %L LIKE '%%being paid online%%' AND %L LIKE '%%being paid online%%' AND %L <> ''
             AND (SELECT total = 10 FROM public.orders WHERE id = %L) AND (SELECT count(*) FROM public.order_items WHERE order_id = %5$L) = 1$$,
         :'lk1', :'lk2', :'lk3', :'lk4', :'l1'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_cancel(%L, %L, %L)', :C1, :SB, :'l1')), '') AS cn1,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_cancel(%L, %L, %L)', :B_AGENT, :SB, :'l1')), '') AS cn2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :B_MGR, :SB, :'l1')) AS cn3 \gset
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET quantity = 2 WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS cn4 \gset
SELECT tests.check('DM-PAY-8: only a store admin cancels the attempt (a customer / agent cannot); after that, staff can edit the lines again (the total follows)',
  format($$SELECT %L LIKE '%%only a store admin%%' AND %L LIKE '%%only a store admin%%' AND %L::int = 1 AND %L = ''
             AND (SELECT total = 20 FROM public.orders WHERE id = %L)
             AND (SELECT state = 'cancelled' FROM payments.tenant_attempts WHERE id = %L)$$,
         :'cn1', :'cn2', :'cn3', :'cn4', :'l1', :'al1'::jsonb ->> 'attempt_id'));
SELECT pg_temp.t_open(:SB, :'l1', :C1) AS al1b \gset
SELECT pg_temp.t_sign(:SB, :'al1b'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.h('fake-return|lock-1') AS pll1 \gset
SELECT pg_temp.t_ret(:SB, :'al1b'::jsonb ->> 'reference', :'pll1', '0', 'fake-l-0001', 2000) AS ok \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_cancel(%L, %L, %L)', :B_OWNER, :SB, :'l1')), '') AS cn5 \gset
SELECT tests.check('DM-PAY-8: the attempt is not cancelled while its payment is being verified (returned)',
  format($$SELECT %L LIKE '%%being verified%%'$$, :'cn5'));
-- decision 14: keep the sealed raw return of this payload (for the re-VERIFY job) before settling it
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'al1b'::jsonb ->> 'attempt_id', :'pll1', pg_temp.tok('raw-1'))) AS keep1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'al1b'::jsonb ->> 'attempt_id', :'pll1', pg_temp.tok('raw-2'))) AS keep2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'al1b'::jsonb ->> 'attempt_id', repeat('f', 64), pg_temp.tok('raw-3'))) AS keep3 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SA, :'al1b'::jsonb ->> 'attempt_id', :'pll1', pg_temp.tok('raw-4'))) AS keep4 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_get(%L, %L, %L))', :SB, :'al1b'::jsonb ->> 'attempt_id', :'pll1')) AS get1,
       COALESCE(pg_temp.svc(format('SELECT to_jsonb(public.max_return_get(%L, %L, %L))', :SA, :'al1b'::jsonb ->> 'attempt_id', :'pll1'))::text, 'null') AS get2,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_return_keep(%L, %L, %L, %L)', :SB, :'ad3'::jsonb ->> 'attempt_id', :'pld3', 'plain query text')), '') AS keep_plain \gset
SELECT tests.check('decision 14: a raw return is kept only for a payload recorded as received, read back only by its own store, never twice, sealed format only',
  format($$SELECT %L::boolean AND NOT %L::boolean AND NOT %L::boolean AND NOT %L::boolean
             AND %L::jsonb = to_jsonb(pg_temp.tok('raw-1')) AND %L = 'null' AND %L LIKE '%%tenant_returns_return_enc_check%%'$$,
         :'keep1', :'keep2', :'keep3', :'keep4', :'get1', :'get2', :'keep_plain'));
SELECT pg_temp.svc('SELECT public.max_attempts_pending_verify()') AS pv1 \gset
SELECT tests.check('lead decision (re-VERIFY job): max_attempts_pending_verify lists the kept return not yet verified — attempt, tenant, reference, payload, mode',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e
                    WHERE e ->> 'attempt_id' = %2$L AND e ->> 'tenant_id' = %3$L AND e ->> 'reference' = %4$L
                      AND e ->> 'payload_sha256' = %5$L AND e ->> 'mode' = 'test')
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ? 'return_enc' OR position('FAKE-' IN e::text) > 0)$$,
         :'pv1', :'al1b'::jsonb ->> 'attempt_id', :SB, :'al1b'::jsonb ->> 'reference', :'pll1'));
SELECT pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'al1b'::jsonb ->> 'attempt_id', 'verify')) AS al1b_lease \gset
SELECT pg_temp.svc('SELECT public.max_attempts_pending_verify()') AS pv1b,
       pg_temp.svc('SELECT public.max_attempts_pending_verify(0)') AS pv1c,
       COALESCE(pg_temp.err(:SB, :B_OWNER, 'SELECT public.max_attempts_pending_verify()'), '') AS pv_user \gset
SELECT tests.check('lead decision (re-VERIFY job): an attempt whose VERIFY holds the lease is not listed (the job never races a live VERIFY); the list is bounded; a user cannot call it',
  format($$SELECT %1$L::jsonb ->> 'result' = 'ok'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e WHERE e ->> 'attempt_id' = %3$L)
             AND jsonb_array_length(%4$L::jsonb) <= 1 AND %5$L LIKE '%%permission denied%%'$$,
         :'al1b_lease', :'pv1b', :'al1b'::jsonb ->> 'attempt_id', :'pv1c', :'pv_user'));
SELECT pg_temp.t_settle(:SB, :'al1b'::jsonb ->> 'reference', :'pll1', '0', '0', :'t_b', 'fake-l-0001', 2000) AS sl1 \gset
SELECT pg_temp.svc('SELECT public.max_attempts_pending_verify()') AS pv2 \gset
SELECT tests.check('settle after a staff edit: the new attempt carries the new amount (₪20) and settles; it leaves the re-VERIFY list',
  format($$SELECT %1$L::jsonb ->> 'result' = 'test_paid'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e WHERE e ->> 'attempt_id' = %3$L)$$,
         :'sl1', :'pv2', :'al1b'::jsonb ->> 'attempt_id'));
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS purged \gset
SELECT tests.check('decision 14: the purge removes a raw return whose VERIFY concluded',
  format($$SELECT %L::int >= 1 AND NOT EXISTS (SELECT 1 FROM payments.tenant_returns WHERE attempt_id = %L)$$,
         :'purged', :'al1b'::jsonb ->> 'attempt_id'));
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET quantity = 3 WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS pl_1,
       COALESCE(pg_temp.err(:SB, :PLAT, format('WITH u AS (DELETE FROM public.order_items WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS pl_2,
       COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (INSERT INTO public.order_items (order_id, product_id, quantity, unit_price) VALUES (%L, %L, 1, 10) RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1', :P10)), '') AS pl_3,
       COALESCE(pg_temp.db_err(format('UPDATE public.orders SET shipping_price = 7 WHERE id = %L', :'l1')), '') AS pl_4,
       COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.orders SET shipping_price = 9 WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS pl_5 \gset
SELECT tests.check('DM-PAY-8 (M11): a paid online order — total and lines locked for everyone: the store owner, a platform admin, even the database owner (a shipping-price edit included)',
  format($$SELECT %L LIKE '%%paid online%%' AND %L LIKE '%%paid online%%' AND %L LIKE '%%paid online%%' AND %L LIKE '%%paid online%%'
             AND %L LIKE '%%paid online%%'
             AND (SELECT total = 20 AND shipping_price = 0 FROM public.orders WHERE id = %6$L)
             AND (SELECT sum(quantity) = 2 FROM public.order_items WHERE order_id = %6$L)$$,
         :'pl_1', :'pl_2', :'pl_3', :'pl_4', :'pl_5', :'l1'));
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET picked = true, picked_qty = quantity WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS pick \gset
SELECT tests.check('DM-PAY-8: picking a paid online order still works (columns that do not change the amount are free)',
  format($$SELECT %L = '' AND (SELECT bool_and(picked) FROM public.order_items WHERE order_id = %L)$$, :'pick', :'l1'));
SELECT pg_temp.order_of(:SB, :C1, :P10, :SHIP_B, 1, 'offline') AS off1 \gset
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET quantity = 4 WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'off1')), '') AS off_edit \gset
SELECT (SELECT total FROM public.orders WHERE id = :'off1') AS off_total \gset
SELECT COALESCE(pg_temp.db_err(format('DELETE FROM public.orders WHERE id = %L', :'off1')), '') AS off_del \gset
SELECT tests.check('DM-REG-1: an offline (phone) order of the same store is unaffected — staff edit its lines and it can be deleted as before',
  format($$SELECT %L = '' AND %L::numeric = 40 AND %L = '' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = %L)$$,
         :'off_edit', :'off_total', :'off_del', :'off1'));
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (DELETE FROM public.orders WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :'l1')), '') AS keep_1,
       COALESCE(pg_temp.db_err(format('DELETE FROM public.orders WHERE id = %L', :'o2')), '') AS keep_2 \gset
SELECT tests.check('decision 15: an order with an online payment record is never deleted by the store (cancel it instead)',
  format($$SELECT %L LIKE '%%online payment record%%' AND %L LIKE '%%online payment record%%'
             AND EXISTS (SELECT 1 FROM public.orders WHERE id = %L) AND EXISTS (SELECT 1 FROM public.orders WHERE id = %L)$$,
         :'keep_1', :'keep_2', :'l1', :'o2'));
SELECT pg_temp.order_of(:SB, :C1, :P10, :SHIP_B, 1, 'online') AS cap5 \gset
DO $$
DECLARE _o uuid := (SELECT id FROM public.orders WHERE tenant_id = 'c2080000-0000-4000-8000-00000000000b'
                     AND customer_id = 'c2080000-0000-4000-8000-0000000000c1' AND payment_method = 'online'
                     AND NOT EXISTS (SELECT 1 FROM payments.tenant_attempts a WHERE a.order_id = orders.id)
                   ORDER BY created_at DESC LIMIT 1);
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM pg_temp.t_open('c2080000-0000-4000-8000-00000000000b', _o, 'c2080000-0000-4000-8000-0000000000c1');
    PERFORM pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', 'c2080000-0000-4000-8000-0000000000b1',
                               'c2080000-0000-4000-8000-00000000000b', _o));
  END LOOP;
END $$;
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'cap5', :C1, 'demo')), '') AS cap6 \gset
SELECT tests.check('rate limit: at most 5 payment attempts per order',
  format($$SELECT (SELECT count(*) FROM payments.tenant_attempts WHERE order_id = %L) = 5 AND %L LIKE '%%too many payment attempts%%'$$,
         :'cap5', :'cap6'));

-- ============================================================
-- 13. Unknown returns and "sent to Hyp, never returned" (DM-PAY-10)
-- ============================================================
SELECT pg_temp.h('fake-unknown|1') AS un1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_payment_unknown_return(%L, %L, %L))', 'tenant', 'OP-Store-B.shop.example', :'un1')) AS uk1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_payment_unknown_return(%L, %L, %L))', 'tenant', 'op-store-b.shop.example', :'un1')) AS uk2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_payment_unknown_return(%L, %L, %L))', 'other', 'x.example', :'un1')) AS uk3 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_payment_unknown_return(%L, %L, %L))', 'platform', 'bad host/x', :'un1')) AS uk4 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_payment_unknown_return(%L, %L, %L))', 'platform', 'nuriel.shop.example', :'un1')) AS uk5 \gset
SELECT tests.check('DM-PAY-10: a return with no attempt is recorded once — scope, host, hash, time; a repeat or a malformed call records nothing',
  format($$SELECT %L::boolean AND NOT %L::boolean AND NOT %L::boolean AND NOT %L::boolean AND %L::boolean
             AND (SELECT count(*) FROM payments.unknown_returns WHERE payload_sha256 = %6$L) = 2
             AND (SELECT host = 'op-store-b.shop.example' FROM payments.unknown_returns WHERE payload_sha256 = %6$L AND scope = 'tenant')
             AND (SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
                   WHERE table_schema = 'payments' AND table_name = 'unknown_returns') = ARRAY['host', 'id', 'payload_sha256', 'received_at', 'scope']$$,
         :'uk1', :'uk2', :'uk3', :'uk4', :'uk5', :'un1'));
SELECT COALESCE(pg_temp.db_err('UPDATE payments.unknown_returns SET host = host'), '') AS uk_upd,
       COALESCE(pg_temp.db_err('DELETE FROM payments.unknown_returns'), '') AS uk_del \gset
SELECT tests.check('DM-PAY-10: unknown returns are append-only, kept 30 days',
  format($$SELECT %L LIKE '%%append-only%%' AND %L LIKE '%%kept for 30 days%%'$$, :'uk_upd', :'uk_del'));
SELECT pg_temp.svc(format('SELECT public.max_unreturned_attempts(%L, %L)', :B_OWNER, :SB)) AS unr_b,
       pg_temp.svc(format('SELECT public.max_unreturned_attempts(%L, %L)', :A_OWNER, :SA)) AS unr_a,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_unreturned_attempts(%L, %L)', :B_MGR, :SB)), '') AS unr_mgr \gset
SELECT tests.check('DM-PAY-10: max_unreturned_attempts lists B''s attempts that went to Hyp and never came back (last 2 digits, full reference); none of A''s; a manager is refused',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e
                    WHERE e ->> 'reference' = %2$L AND e ->> 'terminal_hint' = '********' || right(%3$L, 2) AND e ->> 'state' = 'cancelled')
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'reference' = %4$L)
             AND %5$L::jsonb = '[]' AND %6$L LIKE '%%not allowed%%' AND position(%3$L IN %1$L) = 0$$,
         :'unr_b', :'al1'::jsonb ->> 'reference', :'t_b', :'a1'::jsonb ->> 'reference', :'unr_a', :'unr_mgr'));

-- ============================================================
-- 14. A guest (decision 11): the order id alone never opens the payment page
-- ============================================================
SELECT pg_temp.svc(format($q$SELECT to_jsonb(x) FROM (SELECT set_config('request.headers', %L, true)) s,
         public.place_guest_order('order', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 10)),
           jsonb_build_object('customer_name', 'אורח תשלום מקוון', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
             'customer_email', 'op.guest@test.local', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1',
             'billing_zip', '6100001', 'accepted_terms', true, 'shipping_method_id', %L, 'payment_method', 'online')) x$q$,
         json_build_object('x-tenant-id', :SB)::text, :P10, :SHIP_B)) ->> 'id' AS g1 \gset
SELECT pg_temp.h('fake-guest-token-1') AS gt1 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, NULL, NULL, %L)', :SB, :'g1', 'demo')), '') AS g_open0 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_order_access_issue(%L, %L, %L))', :SB, :'g1', :'gt1')) AS g_issue1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_order_access_issue(%L, %L, %L))', :SB, :'g1', repeat('e', 64))) AS g_issue2 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, NULL, %L, %L)', :SB, :'g1', repeat('e', 64), 'demo')), '') AS g_open1 \gset
SELECT pg_temp.svc(format('SELECT public.max_attempt_open(%L, %L, NULL, %L, %L)', :SB, :'g1', :'gt1', 'demo')) AS g_open2 \gset
SELECT pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, NULL, %L)', :SB, :'g1', :'gt1')) AS g_status1,
       COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, NULL, %L)', :SB, :'g1', repeat('e', 64)))::text, 'null') AS g_status2,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_order_access_issue(%L, %L, %L)', :SB, :'g1', 'not-a-hash')), '') AS g_bad \gset
SELECT tests.check('guest: the online guest order awaits payment; without the token the payment page is not found; the first token wins; the status by token hides staff fields',
  format($$SELECT (SELECT customer_id IS NULL AND payment_method = 'online' AND payment_status = 'awaiting' FROM public.orders WHERE id = %1$L)
             AND %2$L LIKE '%%order not found%%' AND %3$L::boolean AND NOT %4$L::boolean AND %5$L LIKE '%%order not found%%'
             AND %6$L::jsonb ->> 'mode' = 'test' AND %7$L::jsonb ->> 'payment_status' = 'awaiting'
             AND NOT (%7$L::jsonb -> 'attempt' ? 'attempt_id') AND %8$L = 'null' AND %9$L LIKE '%%malformed%%'$$,
         :'g1', :'g_open0', :'g_issue1', :'g_issue2', :'g_open1', :'g_open2', :'g_status1', :'g_status2', :'g_bad'));

-- ============================================================
-- 15. Paying NURIEL (decisions ה-3, ה-8; DM-PLAT-1 … 4) — store B pays one open billing.ledger charge
-- ============================================================
SELECT (SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY s.tenant_id)) FROM public.tenant_subscriptions s WHERE s.tenant_id IN (:SA, :SB)) AS subs_md5,
       (SELECT count(*) FROM public.billing_history) AS bh_count, (SELECT count(*) FROM public.tenant_addons) AS addons_count \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":30,"description":"חיוב בדיקה 30 (תשלום מקוון)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"setup","amount":60,"description":"חיוב בדיקה 60 (מעל התקרה)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":12,"description":"חיוב בדיקה 12 (יבוטל)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SA,
         '{"kind":"charge","category":"other","amount":15,"description":"חיוב בדיקה של A"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SE,
         '{"kind":"charge","category":"other","amount":15,"description":"חיוב בדיקה של E"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SF,
         '{"kind":"charge","category":"other","amount":15,"description":"חיוב בדיקה של F"}')) IS NOT NULL AS ok \gset
-- an authorized-dealer charge with 18% VAT (a snapshot row, as an agreement of an authorized dealer would have written it)
INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_business_type, vat_rate, vat_amount,
                            net_amount, occurred_on, description, source)
VALUES (:SB, 'חנות תשלומים B (op-store-b)', 'ecommerce', 'charge', 'subscription', 23.60, 'authorized', 18, 3.60, 20.00,
        current_date, 'מנוי בדיקה (מע"מ 18%)', 'platform_admin');
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 30 (תשלום מקוון)') AS ch30,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 60 (מעל התקרה)') AS ch60,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 12 (יבוטל)') AS ch12,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SA AND description = 'חיוב בדיקה של A') AS cha,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SE AND description = 'חיוב בדיקה של E') AS che,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SF AND description = 'חיוב בדיקה של F') AS chf,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'מנוי בדיקה (מע"מ 18%)') AS chv \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS pf_off \gset
SELECT tests.check('DM-PLAT-*: with platform_terminal_payments off nobody can open a payment to NURIEL',
  format($$SELECT %L LIKE '%%not available right now%%'$$, :'pf_off'));
SELECT pg_temp.call(NULL, :PLAT, $$SELECT to_jsonb(public.platform_set_flag('platform_terminal_payments', true))$$) AS ok \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :PLAT, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS py1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :PLAT2, :SE, 'ledger_charge', :'che', 'demo')), '') AS py2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_MGR, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS py3,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_AGENT, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS py4,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :A_OWNER, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS py5,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :A_BLOCKED, :SF, 'ledger_charge', :'chf', 'demo')), '') AS py6,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :H_OWNER, :SH, 'ledger_charge', :'ch30', 'demo')), '') AS py7,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :A_OWNER, :SA, 'ledger_charge', :'ch30', 'demo')), '') AS py8 \gset
SELECT tests.check('DM-PLAT-1: a platform admin never pays NURIEL — not even one who is also the owner (protected admin) of store E (ה-8)',
  format($$SELECT %L LIKE '%%only the owner%%' AND %L LIKE '%%only the owner%%'
             AND (SELECT is_protected FROM public.user_roles WHERE tenant_id = %L AND user_id = %L)$$, :'py1', :'py2', :SE, :PLAT2));
SELECT tests.check('DM-PLAT-1: a manager (unprotected admin), an agent and another store''s owner are refused for B; a blocked owner is refused for its own store F',
  format($$SELECT %L LIKE '%%only the owner%%' AND %L LIKE '%%only the owner%%' AND %L LIKE '%%only the owner%%' AND %L LIKE '%%only the owner%%'$$,
         :'py3', :'py4', :'py5', :'py6'));
SELECT tests.check('DM-PLAT-1: the owner of a hospitality business is refused (DEMO: stores only); A''s owner cannot pay B''s charge as A',
  format($$SELECT %L LIKE '%%not available for this business%%' AND %L LIKE '%%cannot be paid online%%'$$, :'py7', :'py8'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'addon_request', :'ch30', 'demo')), '') AS pk1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', gen_random_uuid(), 'demo')), '') AS pk2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch60', 'demo')), '') AS pk3,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'production')), '') AS pk4 \gset
SELECT tests.check('DM-PLAT-2: decision ה-3 — only ledger_charge (an add-on request is refused); an unknown charge cannot be paid; the app marker must match',
  format($$SELECT %L LIKE '%%unknown payable item%%' AND %L LIKE '%%cannot be paid online%%' AND %L LIKE '%%environments differ%%'$$,
         :'pk1', :'pk2', :'pk4'));
SELECT tests.check('DM-ENV-5: a ₪60 charge cannot be paid in test mode (no attempt)',
  format($$SELECT %L LIKE '%%limited to 50 ILS%%' AND NOT EXISTS (SELECT 1 FROM payments.platform_attempts WHERE target_id = %L)$$, :'pk3', :'ch60'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://evil.example', 'demo')), '') AS or1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://op-store-a.shop.example', 'demo')), '') AS or2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://op-store-b.shop.example/admin', 'demo')), '') AS or3,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'http://op-store-b.shop.example', 'demo')), '') AS or4,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://op-store-b.shop.example?x=1', 'demo')), '') AS or5,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://op-store-b.' || repeat('x', 250) || '.example', 'demo')), '') AS or6 \gset
SELECT tests.check('L2: the return address must be one of B''s own origins — a foreign host, another store''s subdomain, a path, a query, plain http off localhost, or over 255 characters are refused',
  format($$SELECT %L LIKE '%%not one of this store%%' AND %L LIKE '%%not one of this store%%' AND %L LIKE '%%not a store address%%'
             AND %L LIKE '%%not a store address%%' AND %L LIKE '%%not a store address%%' AND %L LIKE '%%not a store address%%'
             AND NOT EXISTS (SELECT 1 FROM payments.platform_attempts WHERE target_id = %L)$$,
         :'or1', :'or2', :'or3', :'or4', :'or5', :'or6', :'ch30'));
UPDATE public.tenants SET custom_domain = 'op-shop-b.example' WHERE id = :SB;
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'https://op-shop-b.example', 'demo')), '') AS or7 \gset
SELECT tests.check('L2: an unverified custom domain is refused',
  format($$SELECT %L LIKE '%%not one of this store%%'$$, :'or7'));
UPDATE public.tenants SET custom_domain_verified_at = now() WHERE id = :SB;
SELECT pg_temp.p_open(:B_OWNER, :SB, :'ch30', 'https://OP-SHOP-B.example:8443') AS pa1 \gset
SELECT tests.check('DM-PLAT-2: the owner opens — amount from the charge (₪30 = 3000 agorot), one payment, NURIEL''s terminal and key id; the verified custom domain (with a port) is the return address (L2)',
  format($$SELECT %1$L::jsonb ->> 'mode' = 'test' AND (%1$L::jsonb ->> 'amount_minor')::bigint = 3000 AND (%1$L::jsonb ->> 'max_installments')::int = 1
             AND %1$L::jsonb ->> 'terminal_number' = %2$L AND %1$L::jsonb ->> 'return_origin' = 'https://op-shop-b.example:8443'
             AND (SELECT payer_user_id = %3$L AND payer_tenant_id = %4$L AND ledger_charge_id = %5$L AND target_kind = 'ledger_charge'
                         AND key_id = '0badc0de'
                    FROM payments.platform_attempts WHERE id = (%1$L::jsonb ->> 'attempt_id')::uuid)$$,
         :'pa1', :'t_plat', :B_OWNER, :SB, :'ch30'));
SELECT pg_temp.p_open(:B_OWNER, :SB, :'ch30', 'https://op-shop-b.example:8443') AS pa1_again \gset
SELECT pg_temp.p_open(:B_OWNER, :SB, :'ch30', 'http://op-store-b.shop.localhost:3100') AS pa2 \gset
SELECT tests.check('DM-PLAT-2: one active attempt per charge — the same request reuses it; another return address supersedes it (still one active)',
  format($$SELECT (%1$L::jsonb ->> 'reused')::boolean AND %2$L::jsonb ->> 'return_origin' = 'http://op-store-b.shop.localhost:3100'
             AND NOT (%2$L::jsonb ->> 'reused')::boolean
             AND (SELECT count(*) FROM payments.platform_attempts WHERE target_id = %3$L AND state IN ('created', 'redirected', 'returned')) = 1
             AND (SELECT count(*) FROM payments.platform_attempts WHERE target_id = %3$L) = 2
             AND (SELECT state = 'expired' FROM payments.platform_attempts WHERE id = (%4$L::jsonb ->> 'attempt_id')::uuid)$$,
         :'pa1_again', :'pa2', :'ch30', :'pa1'));
SELECT pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', :'pa2'::jsonb ->> 'attempt_id')) AS ok \gset
SELECT pg_temp.h('fake-platform-return|30') AS ppl1 \gset
SELECT pg_temp.t_ret(:SB, :'pa2'::jsonb ->> 'reference', :'ppl1', '0', 'fake-p-0001', 3000) AS x_store \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'a1'::jsonb ->> 'reference', :'ppl1', '0', 'fake-b-0001', 1000)) AS x_plat \gset
SELECT tests.check('DM-SEP-2: a platform reference arriving on a store return → unknown; a store reference on the platform return → unknown',
  format($$SELECT %L::jsonb ->> 'result' = 'unknown' AND %L::jsonb ->> 'result' = 'unknown'
             AND NOT EXISTS (SELECT 1 FROM payments.platform_events WHERE source = 'return' AND payload_sha256 = %L)$$,
         :'x_store', :'x_plat', :'ppl1'));
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pa2'::jsonb ->> 'reference', :'ppl1', '0', 'fake-p-0001', 3000)) AS pr1 \gset
SELECT tests.check('platform return: recorded on the platform side only, with the return address for the redirect back (lead decision)',
  format($$SELECT %1$L::jsonb ->> 'result' = 'received' AND %1$L::jsonb ->> 'return_origin' = 'http://op-store-b.shop.localhost:3100'
             AND %1$L::jsonb ->> 'payer_tenant_id' = %2$L$$, :'pr1', :SB));
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_return_keep(%L, %L, %L))', :'pa2'::jsonb ->> 'attempt_id', :'ppl1', pg_temp.tok('praw-1'))) AS pkeep \gset
SELECT pg_temp.svc('SELECT public.platform_attempts_pending_verify()') AS ppv1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_return_get(%L, %L))', :'pa2'::jsonb ->> 'attempt_id', :'ppl1')) AS pget \gset
SELECT tests.check('decision 14 + re-VERIFY list (platform): the kept raw return is listed (attempt, reference, payload, mode — no tenant id) and read back',
  format($$SELECT %1$L::boolean AND %3$L::jsonb = to_jsonb(pg_temp.tok('praw-1'))
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e
                          WHERE e ->> 'attempt_id' = %4$L AND e ->> 'reference' = %5$L AND e ->> 'payload_sha256' = %6$L
                            AND e ->> 'mode' = 'test' AND NOT (e ? 'tenant_id'))$$,
         :'pkeep', :'ppv1', :'pget', :'pa2'::jsonb ->> 'attempt_id', :'pa2'::jsonb ->> 'reference', :'ppl1'));
SELECT (pg_temp.call(:SB, :B_OWNER, 'SELECT public.my_billing_summary()') -> 'other' ->> 'balance') AS other_balance_before \gset
SELECT pg_temp.p_settle(:'pa2'::jsonb ->> 'reference', :'ppl1', '0', '0', :'t_plat', 'fake-p-0001', 3000) AS ps1 \gset
SELECT tests.check('DM-PLAT-3: settle → test_paid, applied; exactly one provider payment row in billing.ledger (kind payment, credit_card, provider confirmation and source, max:test:<txn>), category / amount / VAT of the charge; the return address for the redirect',
  format($$SELECT %1$L::jsonb ->> 'result' = 'test_paid' AND (%1$L::jsonb ->> 'applied')::boolean
             AND %1$L::jsonb ->> 'return_origin' = 'http://op-store-b.shop.localhost:3100'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %2$L AND (source = 'provider' OR confirmation = 'provider')) = 1
             AND (SELECT l.kind = 'payment' AND l.method = 'credit_card' AND l.confirmation = 'provider' AND l.source = 'provider'
                         AND l.provider_ref = 'max:test:fake-p-0001' AND l.category = c.category AND l.amount = c.amount
                         AND l.vat_rate = c.vat_rate AND l.vat_business_type IS NOT DISTINCT FROM c.vat_business_type
                         AND l.net_amount + l.vat_amount = l.amount AND l.reverses_id IS NULL AND l.recorded_by IS NULL
                         AND l.reference = %3$L AND l.engine = 'ecommerce'
                    FROM billing.ledger l, billing.ledger c
                   WHERE l.id = (%1$L::jsonb ->> 'ledger_payment_id')::uuid AND c.id = %4$L)
             AND (SELECT ledger_payment_id = (%1$L::jsonb ->> 'ledger_payment_id')::uuid AND state = 'test_paid' AND applied
                    FROM payments.platform_attempts WHERE id = (%5$L)::uuid)$$,
         :'ps1', :SB, :'pa2'::jsonb ->> 'reference', :'ch30', :'pa2'::jsonb ->> 'attempt_id'));
SELECT (pg_temp.call(:SB, :B_OWNER, 'SELECT public.my_billing_summary()') -> 'other' ->> 'balance') AS other_balance_after \gset
SELECT pg_temp.svc('SELECT public.platform_attempts_pending_verify()') AS ppv2 \gset
SELECT tests.check('re-VERIFY list (platform): a concluded VERIFY leaves the list',
  format($$SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%L::jsonb) e WHERE e ->> 'attempt_id' = %L)$$,
         :'ppv2', :'pa2'::jsonb ->> 'attempt_id'));
SELECT tests.check('DM-PLAT-3: the owner''s balance for the category drops by exactly the charge; nothing is renewed, activated or copied (subscriptions, add-ons, billing_history unchanged)',
  format($$SELECT %1$L::numeric = %2$L::numeric - 30
             AND (SELECT md5(string_agg(to_jsonb(s)::text, ',' ORDER BY s.tenant_id)) FROM public.tenant_subscriptions s WHERE s.tenant_id IN (%3$L, %4$L)) = %5$L
             AND (SELECT count(*) FROM public.billing_history) = %6$s AND (SELECT count(*) FROM public.tenant_addons) = %7$s$$,
         :'other_balance_after', :'other_balance_before', :SA, :SB, :'subs_md5', :'bh_count', :'addons_count'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch30', 'demo')), '') AS again_open \gset
SELECT pg_temp.p_settle(:'pa2'::jsonb ->> 'reference', :'ppl1', '0', '0', :'t_plat', 'fake-p-0001', 3000) AS ps1_again \gset
SELECT tests.check('DM-PLAT-3: the same charge cannot be paid again (refused at open); a repeat settle → already_paid; still one provider row',
  format($$SELECT %L LIKE '%%already paid%%' AND %L::jsonb ->> 'result' = 'already_paid'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1$$,
         :'again_open', :'ps1_again', :SB));
-- the superseded first attempt (sent to Hyp earlier) comes back late with another approved transaction
SELECT pg_temp.h('fake-platform-return|30-late') AS ppl_late \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pa1'::jsonb ->> 'reference', :'ppl_late', '0', 'fake-p-0002', 3000)) AS ok \gset
SELECT pg_temp.p_settle(:'pa1'::jsonb ->> 'reference', :'ppl_late', '0', '0', :'t_plat', 'fake-p-0002', 3000) AS ps_late \gset
SELECT tests.check('DM-PLAT-3: a second attempt of a paid charge settling later → needs_review duplicate_charge (a refund case), no second ledger row',
  format($$SELECT %L::jsonb ->> 'reason' = 'duplicate_charge'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1$$, :'ps_late', :SB));
SELECT pg_temp.p_open(:B_OWNER, :SB, :'ch12') AS pc12 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', :'pc12'::jsonb ->> 'attempt_id')) AS ok \gset
SELECT pg_temp.h('fake-platform-return|12') AS ppl12 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pc12'::jsonb ->> 'reference', :'ppl12', '0', 'fake-p-0012', 1200)) AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_reverse_entry(%L, %L)$q$, :'ch12', 'בוטל לפני התשלום')) IS NOT NULL AS ok \gset
SELECT pg_temp.p_settle(:'pc12'::jsonb ->> 'reference', :'ppl12', '0', '0', :'t_plat', 'fake-p-0012', 1200) AS ps12 \gset
SELECT tests.check('DM-PLAT-3: the charge was reversed while its payment was being verified → needs_review target_changed, no ledger row',
  format($$SELECT %L::jsonb ->> 'reason' = 'target_changed'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1$$, :'ps12', :SB));
SELECT pg_temp.p_open(:B_OWNER, :SB, :'chv') AS pcv \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', :'pcv'::jsonb ->> 'attempt_id')) AS ok \gset
SELECT pg_temp.h('fake-platform-return|vat') AS pplv \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pcv'::jsonb ->> 'reference', :'pplv', '0', 'fake-p-0023', 2360)) AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"payment","category":"subscription","amount":23.60,"method":"bank_transfer","description":"העברה בנקאית בינתיים"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.p_settle(:'pcv'::jsonb ->> 'reference', :'pplv', '0', '0', :'t_plat', 'fake-p-0023', 2360) AS psv \gset
SELECT tests.check('DM-PLAT-3: the charge was paid meanwhile by bank transfer (manual) → needs_review target_settled, no provider row for it',
  format($$SELECT %L::jsonb ->> 'reason' = 'target_settled'
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1$$, :'psv', :SB));
SELECT COALESCE(pg_temp.err(NULL, :PLAT, format('SELECT public.platform_billing_reverse_entry(%L, %L)', :'ps1'::jsonb ->> 'ledger_payment_id', 'ניסיון ביטול')), '') AS rev_provider \gset
SELECT tests.check('DM-PLAT-4: the platform admin''s reversal refuses a provider payment row with the ledger''s fixed message; the row stays',
  format($$SELECT %L LIKE '%%אישור ספק תשלומים לא נרשם ידנית%%' AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE reverses_id = %L)$$,
         :'rev_provider', :'ps1'::jsonb ->> 'ledger_payment_id'));
SELECT COALESCE(pg_temp.db_err(format($q$INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_business_type,
             vat_rate, vat_amount, net_amount, occurred_on, confirmation, provider_ref, method, source)
             VALUES (%L, 'x', 'ecommerce', 'payment', 'other', 1, 'exempt', 0, 0, 1, current_date, 'provider', 'max:test:x', 'credit_card', 'provider')$q$, :SB)), '') AS manual_provider \gset
SELECT tests.check('DM-PLAT-4: a provider row can still never be written manually (billing.guard unchanged)',
  format($$SELECT %L LIKE '%%לא נרשם ידנית%%'$$, :'manual_provider'));
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":11,"description":"חיוב בדיקה 11 (החזקה)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":13,"description":"חיוב בדיקה 13 (מסמך)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":10,"description":"חיוב בדיקה 10 (אישור חלקי)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 11 (החזקה)') AS ch11,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 13 (מסמך)') AS ch13,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 10 (אישור חלקי)') AS chp \gset
SELECT pg_temp.p_pay(:B_OWNER, :SB, :'ch11', 'fake-p-0700', '700') AS pp700 \gset
SELECT pg_temp.p_pay(:B_OWNER, :SB, :'ch13', 'fake-p-0doc', '0', '{document}') AS ppdoc \gset
SELECT pg_temp.p_pay(:B_OWNER, :SB, :'chp', 'fake-p-0010', '10') AS pp10 \gset
SELECT tests.check('DM-PAY-6 / DM-PAY-7 (platform): CCode 700 → unexpected_hold; a returned Hesh → document_issued (flag kept); no ledger row for either',
  format($$SELECT %L::jsonb ->> 'reason' = 'unexpected_hold' AND %L::jsonb ->> 'reason' = 'document_issued'
             AND (SELECT return_flags = '{document}' FROM payments.platform_attempts WHERE target_id = %L)
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1$$,
         :'pp700', :'ppdoc', :'ch13', :SB));
SELECT tests.check('DM-PAY-6 (platform): CCode 10 (partial approval) → needs_review unexpected_hold — never failed, never paid, no ledger row',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'unexpected_hold'
             AND (SELECT state = 'needs_review' AND NOT applied AND failure_code IS NULL AND ledger_payment_id IS NULL
                    FROM payments.platform_attempts WHERE target_id = %2$L)
             AND (SELECT count(*) FROM billing.ledger WHERE tenant_id = %3$L AND source = 'provider') = 1$$,
         :'pp10', :'chp', :SB));
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_payments()') AS myp \gset
SELECT tests.check('platform_card_my_payments (auth): B''s owner on B''s address sees B''s payments — no terminal, no transaction id, no internal fields',
  format($$SELECT jsonb_array_length(%1$L::jsonb) >= 5
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'target_id' = %2$L AND e ->> 'state' = 'test_paid' AND (e ->> 'test')::boolean)
             AND position(%3$L IN %1$L) = 0 AND position('fake-p-0001' IN %1$L) = 0 AND position('terminal' IN %1$L) = 0
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ? 'provider_txn_id' OR e ? 'review_note' OR e ? 'payer_user_id')$$,
         :'myp', :'ch30', :'t_plat'));
SELECT pg_temp.call(:SA, :A_OWNER, 'SELECT public.platform_card_my_payments()') AS myp_a,
       COALESCE(pg_temp.err(:SB, :B_MGR, 'SELECT public.platform_card_my_payments()'), '') AS myp_mgr,
       COALESCE(pg_temp.err(:SB, NULL, 'SELECT public.platform_card_my_payments()'), '') AS myp_anon,
       COALESCE(pg_temp.err(:SB, NULL, 'SELECT public.platform_card_my_options()'), '') AS myo_anon,
       COALESCE(pg_temp.err(:SB, :A_OWNER, 'SELECT public.platform_card_my_payments()'), '') AS myp_a_on_b,
       COALESCE(pg_temp.err(:SB, :A_OWNER, 'SELECT public.platform_card_my_options()'), '') AS myo_a_on_b \gset
SELECT tests.check('DM-SEP-5: A''s owner sees none of B''s payments on A''s address and is refused on B''s; B''s manager and anon are refused',
  format($$SELECT %L::jsonb = '[]' AND %L LIKE '%%בעל העסק%%' AND %L LIKE '%%permission denied%%' AND %L LIKE '%%permission denied%%'
             AND %L LIKE '%%בעל העסק%%' AND %L LIKE '%%בעל העסק%%'$$,
         :'myp_a', :'myp_mgr', :'myp_anon', :'myo_anon', :'myp_a_on_b', :'myo_a_on_b'));
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_options()') AS myo,
       pg_temp.call(:SB, :PLAT, 'SELECT public.platform_card_my_options()') AS myo_plat \gset
SELECT tests.check('platform_card_my_options (auth): the owner sees what is payable now — the paid charge no, the ₪60 one no (test cap), A''s and reversed charges not at all; a platform admin on B''s address sees nothing available',
  format($$SELECT (%1$L::jsonb ->> 'available')::boolean AND (%1$L::jsonb ->> 'test')::boolean AND (%1$L::jsonb ->> 'test_amount_cap_minor')::int = 5000
             AND %1$L::jsonb ->> 'environment' = 'demo'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'charges') e WHERE e ->> 'id' = %2$L AND NOT (e ->> 'payable')::boolean AND (e ->> 'paid_online')::boolean)
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'charges') e WHERE e ->> 'id' = %3$L AND NOT (e ->> 'payable')::boolean AND (e ->> 'amount_minor')::bigint = 6000)
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb -> 'charges') e WHERE e ->> 'id' IN (%4$L, %5$L))
             AND NOT (%6$L::jsonb ->> 'available')::boolean$$,
         :'myo', :'ch30', :'ch60', :'cha', :'ch12', :'myo_plat'));
SELECT pg_temp.svc(format('SELECT public.platform_card_payments(%L, %L)', :PLAT, :SB)) AS pcp,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_card_payments(%L)', :B_OWNER)), '') AS pcp_owner \gset
SELECT tests.check('platform_card_payments: the platform admin lists payments to NURIEL (last 2 digits, flags, review reasons, no ciphertext); a store owner is refused',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'target_id' = %2$L AND e ->> 'terminal_hint' = '********' || right(%3$L, 2))
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'review_reason' = 'document_issued' AND e -> 'return_flags' = '["document"]')
             AND position(%3$L IN %1$L) = 0 AND position('FAKE-' IN %1$L) = 0 AND %4$L LIKE '%%only the platform admin%%'$$,
         :'pcp', :'ch30', :'t_plat', :'pcp_owner'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_card_payment_resolve(%L, %L, %L)', :B_OWNER, :'pa1'::jsonb ->> 'attempt_id', 'x')), '') AS rs1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_card_payment_resolve(%L, %L, %L))', :PLAT, :'pa1'::jsonb ->> 'attempt_id', 'הוחזר בפורטל')) AS rs2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_card_payment_resolve(%L, %L, %L))', :PLAT, :'pa1'::jsonb ->> 'attempt_id', 'שוב')) AS rs3 \gset
SELECT tests.check('platform review: only a platform admin resolves; a note is kept; resolving twice changes nothing',
  format($$SELECT %L LIKE '%%only the platform admin%%' AND %L::boolean AND NOT %L::boolean
             AND (SELECT review_note = 'הוחזר בפורטל' AND review_resolved_by = %L FROM payments.platform_attempts WHERE id = %L)$$,
         :'rs1', :'rs2', :'rs3', :PLAT, :'pa1'::jsonb ->> 'attempt_id'));
-- a platform attempt sent to Hyp that never came back (expired)
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":14,"description":"חיוב בדיקה 14 (לא חזר)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 14 (לא חזר)') AS ch14 \gset
SELECT pg_temp.p_open(:B_OWNER, :SB, :'ch14') AS pc14 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', :'pc14'::jsonb ->> 'attempt_id')) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.platform_attempts SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute'
 WHERE id = (:'pc14'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc(format('SELECT public.platform_unreturned_attempts(%L)', :PLAT)) AS punr1 \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_attempts_expire())') AS pswept \gset
SELECT pg_temp.svc(format('SELECT public.platform_unreturned_attempts(%L)', :PLAT)) AS punr2,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_unreturned_attempts(%L)', :B_OWNER)), '') AS punr_owner \gset
SELECT tests.check('DM-PAY-10: platform_unreturned_attempts lists the platform attempt that went to Hyp and never returned (also before the sweep); a store owner is refused',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e
                    WHERE e ->> 'id' = %2$L AND e ->> 'state' = 'redirected' AND e ->> 'terminal_hint' = '********' || right(%3$L, 2))
             AND %4$L::int >= 1
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%5$L::jsonb) e WHERE e ->> 'id' = %2$L AND e ->> 'state' = 'expired')
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%5$L::jsonb) e WHERE e ->> 'target_id' = %6$L)
             AND %7$L LIKE '%%only the platform admin%%'$$,
         :'punr1', :'pc14'::jsonb ->> 'attempt_id', :'t_plat', :'pswept', :'punr2', :'ch30', :'punr_owner'));
SELECT pg_temp.svc(format('SELECT public.platform_terminal_status(%L)', :PLAT)) AS pts \gset
SELECT tests.check('DM-PAY-10: NURIEL''s terminal status counts the unknown returns of the last 24 hours (the misconfiguration alert)',
  format($$SELECT (%1$L::jsonb -> 'unknown_returns' ->> 'platform_24h')::int >= 1 AND (%1$L::jsonb -> 'unknown_returns' ->> 'tenant_24h')::int >= 1$$, :'pts'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_secrets(%L, %L)', :'pc14'::jsonb ->> 'attempt_id', 'sign')), '') AS psec1,
       COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_secrets(%L, %L)', :'pc14'::jsonb ->> 'attempt_id', 'verify')), '') AS psec2 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_secrets(%L, %L)', :'pa2'::jsonb ->> 'attempt_id', 'verify')) AS psec3 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_secrets(%L, %L)', :'pa2'::jsonb ->> 'attempt_id', 'verify')) AS psec4 \gset
SELECT tests.check('platform secrets: sign refused for an expired attempt, nothing to verify without a return; VERIFY lease then busy',
  format($$SELECT %L LIKE '%%cannot be signed%%' AND %L LIKE '%%nothing to verify%%' AND %L::jsonb ->> 'result' = 'ok'
             AND %L::jsonb ->> 'result' = 'busy'$$, :'psec1', :'psec2', :'psec3', :'psec4'));
SELECT tests.check('DM-PLAT-3: only this file''s store B has provider rows, exactly one; store A none',
  format($$SELECT (SELECT count(*) FROM billing.ledger WHERE tenant_id = %L AND source = 'provider') = 1
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE tenant_id = %L AND source = 'provider')$$, :SB, :SA));

-- ============================================================
-- 16. Credentials replaced while a payment is being verified; RLS as a second layer
-- ============================================================
SELECT pg_temp.order_of(:SB, :C1, :P10, :SHIP_B, 1, 'online') AS r1 \gset
SELECT pg_temp.t_open(:SB, :'r1', :C1) AS ar1 \gset
SELECT pg_temp.t_sign(:SB, :'ar1'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.t_ret(:SB, :'ar1'::jsonb ->> 'reference', pg_temp.h('fake-return|r1'), '0', 'fake-r-0001', 1000) AS ok \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('api_key_enc', pg_temp.tok('b-key-2', '0deadbee'), 'api_password_enc', pg_temp.tok('b-pass-2', '0deadbee')), 'demo')), '') AS cr1 \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('api_key_enc', pg_temp.tok('b-key-2', '0deadbee'), 'api_password_enc', pg_temp.tok('b-pass-2', '0deadbee'), 'force', true), 'demo')) AS cr2 \gset
SELECT tests.check('credentials: replacing B''s credentials while a payment is being verified needs force; with force that payment goes to review (credentials_changed); unverified again; the new key id is taken from the tokens',
  format($$SELECT %1$L LIKE '%%being verified%%' AND %2$L::jsonb ->> 'status' = 'unverified'
             AND (SELECT state = 'needs_review' AND review_reason = 'credentials_changed' FROM payments.tenant_attempts WHERE id = %3$L)
             AND (SELECT key_id = '0deadbee' FROM payments.tenant_accounts WHERE tenant_id = %4$L)
             AND (SELECT action = 'credentials_replaced' AND changed_fields @> ARRAY['api_key', 'api_password', 'key_id'] FROM payments.tenant_config_audit
                   WHERE tenant_id = %4$L ORDER BY id DESC LIMIT 1)$$,
         :'cr1', :'cr2', :'ar1'::jsonb ->> 'attempt_id', :SB));
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, 'SELECT to_jsonb(count(*)) FROM payments.tenant_attempts'), '') AS rl1,
       COALESCE(pg_temp.err(:SB, NULL, 'SELECT to_jsonb(count(*)) FROM payments.tenant_accounts'), '') AS rl2,
       COALESCE(pg_temp.svc_err('SELECT to_jsonb(count(*)) FROM payments.platform_accounts'), '') AS rl3,
       COALESCE(pg_temp.svc_err('SELECT to_jsonb(count(*)) FROM payments.environment'), '') AS rl4,
       COALESCE(pg_temp.err(:SB, :B_OWNER, format('SELECT public.max_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %L, 1, %L, 1, NULL, NULL, NULL, NULL, %L)',
         :SB, repeat('a', 32), repeat('b', 64), '0', '0', 'x', 'x', 'ILS', 'demo')), '') AS rl5 \gset
SELECT tests.check('RLS / grants: a signed-in store owner, anon and service_role reading payments tables directly → permission denied; the settle is not callable by a user',
  format($$SELECT %L LIKE '%%permission denied%%' AND %L LIKE '%%permission denied%%' AND %L LIKE '%%permission denied%%'
             AND %L LIKE '%%permission denied%%' AND %L LIKE '%%permission denied%%'$$, :'rl1', :'rl2', :'rl3', :'rl4', :'rl5'));
SELECT tests.check('RLS (second layer): every payments table carries its RESTRICTIVE policy for all roles',
  $$SELECT (SELECT count(*) FROM pg_policies WHERE schemaname = 'payments' AND roles = '{public}' AND permissive = 'RESTRICTIVE') = 18$$);

-- ============================================================
-- 17. Store deletion (decision 15): payment records outlive the store; its credentials go with it
-- ============================================================
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SD,
         jsonb_build_object('terminal_number', :'t_d', 'api_key_enc', pg_temp.tok('d-key'), 'api_password_enc', pg_temp.tok('d-pass'), 'enabled', true), 'demo')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SD, '0')) AS ok \gset
SELECT pg_temp.order_of(:SD, :CD, :PD10, :SHIP_D, 1, 'online') AS od \gset
SELECT pg_temp.t_pay(:SD, :'od', :CD, 'fake-dd-0001') AS pd \gset
SELECT COALESCE(pg_temp.db_err(format('DELETE FROM payments.terminal_registry WHERE terminal_number = %L', :'t_d')), '') AS reg_used \gset
SELECT tests.check('decision 15: store D paid online; a terminal that took an attempt cannot be removed from the registry',
  format($$SELECT %L::jsonb ->> 'result' = 'test_paid' AND %L <> ''$$, :'pd', :'reg_used'));
-- pre-existing, not part of 208: platform_delete_tenant stops on any store whose product has order lines (its delete
-- loop reaches product_categories while the product still exists, and product_categories_keep_primary raises a
-- check_violation the loop does not catch — the same without 208). The category sync switch lets this one call through.
SELECT set_config('kobi.product_category_sync', 'on', false) AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_delete_tenant(%L, 'op-store-d')$q$, :SD)) AS del \gset
SELECT set_config('kobi.product_category_sync', '', false) AS ok \gset
SELECT tests.check('decision 15: deleting store D keeps its attempts, events and audit (order link NULL, snapshots intact) and the registry row; its credentials are gone',
  format($$SELECT NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = %1$L)
             AND (SELECT count(*) = 1 AND bool_and(order_id IS NULL AND state = 'test_paid' AND store_label LIKE '%%op-store-d%%' AND order_number IS NOT NULL)
                    FROM payments.tenant_attempts WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_config_audit WHERE tenant_id = %1$L)
             AND NOT EXISTS (SELECT 1 FROM payments.tenant_accounts WHERE tenant_id = %1$L)
             AND EXISTS (SELECT 1 FROM payments.terminal_registry WHERE terminal_number = %2$L AND tenant_id = %1$L)$$,
         :SD, :'t_d'));

-- ============================================================
-- 18. Independent review fix round (H1, H2, M1, M3, M4, M5, L4): each check failed before the fix
-- ============================================================
-- B's credentials were replaced in 16: verified again for the store payments below
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset
-- open → SIGN ok → browser return (one payload), the attempt waiting for its VERIFY
CREATE OR REPLACE FUNCTION pg_temp.t_returned(_tenant uuid, _order uuid, _cust uuid, _payload text, _txn text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o jsonb;
BEGIN
  o := pg_temp.t_open(_tenant, _order, _cust);
  PERFORM pg_temp.t_sign(_tenant, o ->> 'attempt_id');
  PERFORM pg_temp.t_ret(_tenant, o ->> 'reference', _payload, '0', _txn, (o ->> 'amount_minor')::bigint);
  RETURN o;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_returned(_actor uuid, _tenant uuid, _charge uuid, _origin text, _payload text, _txn text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o jsonb;
BEGIN
  o := pg_temp.p_open(_actor, _tenant, _charge, _origin);
  PERFORM pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', o ->> 'attempt_id'));
  IF _payload IS NOT NULL THEN
    PERFORM pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)',
                               o ->> 'reference', _payload, '0', _txn, (o ->> 'amount_minor')::bigint));
  END IF;
  RETURN o;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_fail_verify(_o jsonb, _payload text, _terminal text, _n integer) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  FOR i IN 1.._n LOOP
    PERFORM pg_temp.svc(format('SELECT public.platform_attempt_secrets(%L, %L)', _o ->> 'attempt_id', 'verify'));
    r := pg_temp.p_settle(_o ->> 'reference', _payload, NULL, '0', _terminal, 'fake-x-0001', (_o ->> 'amount_minor')::bigint);
  END LOOP;
  RETURN r;
END $f$;
-- n rounds of: VERIFY lease (max_attempt_secrets 'verify'), then a VERIFY that failed in transport (no CCode)
CREATE OR REPLACE FUNCTION pg_temp.t_fail_verify(_tenant uuid, _o jsonb, _payload text, _n integer) RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  FOR i IN 1.._n LOOP
    PERFORM pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', _tenant, _o ->> 'attempt_id', 'verify'));
    r := pg_temp.t_settle(_tenant, _o ->> 'reference', _payload, NULL, '0', _o ->> 'terminal_number', 'fake-x-0001',
                          (_o ->> 'amount_minor')::bigint);
  END LOOP;
  RETURN r;
END $f$;

-- H1 (tenant): the 6th failed VERIFY parks the attempt — no 7th call needed; the order is held
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS v1o \gset
SELECT pg_temp.h('fake-return|review-h1-a') AS pv1 \gset
SELECT pg_temp.t_returned(:SB, :'v1o', :C4, :'pv1', 'fake-v1-0001') AS v1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'v1'::jsonb ->> 'attempt_id', :'pv1', pg_temp.tok('raw-v1'))) AS ok \gset
SELECT pg_temp.t_fail_verify(:SB, :'v1'::jsonb, :'pv1', 5) AS v1_r5 \gset
SELECT pg_temp.svc('SELECT public.max_attempts_pending_verify(200)') AS v1_list5 \gset
SELECT pg_temp.t_fail_verify(:SB, :'v1'::jsonb, :'pv1', 1) AS v1_r6 \gset
SELECT pg_temp.svc('SELECT public.max_attempts_pending_verify(200)') AS v1_list6,
       pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :SB, :'v1'::jsonb ->> 'attempt_id', 'verify')) AS v1_sec7 \gset
SELECT tests.check('DM-PAY-4 (review H1): after 5 failed VERIFYs the return is still listed for the job; the 6th failed result parks it (needs_review verify_exhausted, a review event) — no 7th call',
  format($$SELECT %1$L::jsonb ->> 'result' = 'unverified'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e WHERE e ->> 'attempt_id' = %5$L)
             AND %3$L::jsonb ->> 'result' = 'needs_review' AND %3$L::jsonb ->> 'reason' = 'verify_exhausted'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%4$L::jsonb) e WHERE e ->> 'attempt_id' = %5$L)
             AND %6$L::jsonb ->> 'result' = 'exhausted'
             AND (SELECT state = 'needs_review' AND review_reason = 'verify_exhausted' AND verify_attempts = 6
                    FROM payments.tenant_attempts WHERE id = %5$L)
             AND (SELECT count(*) FROM payments.tenant_events WHERE attempt_id = %5$L AND source = 'review'
                    AND result = 'verify_exhausted') = 1$$,
         :'v1_r5', :'v1_list5', :'v1_r6', :'v1_list6', :'v1'::jsonb ->> 'attempt_id', :'v1_sec7'));
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT tests.check('DM-PAY-4 (review H1, M3): the parked attempt''s order is held — no due time, so expire_unpaid_orders never cancels it; the sweep leaves it in review',
  format($$SELECT (SELECT status = 'pending' AND payment_status = 'awaiting' AND payment_due_at IS NULL FROM public.orders WHERE id = %L)
             AND (SELECT state = 'needs_review' FROM payments.tenant_attempts WHERE id = %L)$$,
         :'v1o', :'v1'::jsonb ->> 'attempt_id'));
-- M4 on an attempt parked before any verified charge: the charge is kept on it; a further one is duplicate_charge
SELECT pg_temp.t_settle(:SB, :'v1'::jsonb ->> 'reference', :'pv1', '0', '0', :'t_b', 'fake-v1-0001', 1000) AS v1_late \gset
SELECT pg_temp.t_settle(:SB, :'v1'::jsonb ->> 'reference', :'pv1', '0', '0', :'t_b', 'fake-v1-0002', 1000) AS v1_second \gset
SELECT pg_temp.t_settle(:SB, :'v1'::jsonb ->> 'reference', :'pv1', '0', '0', :'t_b', 'fake-v1-0002', 1000) AS v1_second_again \gset
SELECT tests.check('DM-PAY-5 (review M4): a verified charge for an attempt parked before any charge is kept on it (still in review); a second, different one → duplicate_charge, its transaction id kept; a replay adds nothing',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'verify_exhausted'
             AND %2$L::jsonb ->> 'result' = 'duplicate_charge' AND %3$L::jsonb ->> 'result' = 'needs_review'
             AND (SELECT state = 'needs_review' AND review_reason = 'duplicate_charge' AND provider_txn_id = 'fake-v1-0001'
                         AND extra_txn_ids = '{fake-v1-0002}' AND NOT applied FROM payments.tenant_attempts WHERE id = %4$L)
             AND (SELECT payment_status = 'awaiting' AND payment_due_at IS NULL FROM public.orders WHERE id = %5$L)$$,
         :'v1_late', :'v1_second', :'v1_second_again', :'v1'::jsonb ->> 'attempt_id', :'v1o'));

-- H1 (tenant): the sweep never expires a returned attempt; 90 minutes after an unverified return it parks it
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS v2o \gset
SELECT pg_temp.h('fake-return|review-h1-b') AS pv2 \gset
SELECT pg_temp.t_returned(:SB, :'v2o', :C4, :'pv2', 'fake-v2-0001') AS v2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'v2'::jsonb ->> 'attempt_id', :'pv2', pg_temp.tok('raw-v2'))) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_attempts SET created_at = now() - interval '40 minutes', expires_at = now() - interval '5 minutes'
 WHERE id = (:'v2'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT (SELECT state FROM payments.tenant_attempts WHERE id = (:'v2'::jsonb ->> 'attempt_id')::uuid) AS v2_state_timed_out \gset
SET session_replication_role = replica;
UPDATE payments.tenant_attempts SET created_at = now() - interval '3 hours', expires_at = now() - interval '150 minutes',
       returned_at = now() - interval '91 minutes'
 WHERE id = (:'v2'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS ok \gset
SELECT tests.check('DM-PAY-4 (review H1): a timed-out returned attempt is not expired; 90 minutes after its unverified return the sweep parks it (verify_exhausted) and holds the order; its raw return stays until the 2-hour ceiling',
  format($$SELECT %1$L = 'returned'
             AND (SELECT state = 'needs_review' AND review_reason = 'verify_exhausted' FROM payments.tenant_attempts WHERE id = %2$L)
             AND (SELECT payment_due_at IS NULL AND status = 'pending' FROM public.orders WHERE id = %3$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_returns WHERE attempt_id = %2$L)$$,
         :'v2_state_timed_out', :'v2'::jsonb ->> 'attempt_id', :'v2o'));
SET session_replication_role = replica;
UPDATE payments.tenant_returns SET received_at = now() - interval '3 hours', purge_after = now() - interval '1 hour'
 WHERE attempt_id = (:'v2'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS ok \gset
SELECT tests.check('DM-PAY-4 (review H1): past its ceiling, the raw return of a parked attempt is purged',
  format($$SELECT NOT EXISTS (SELECT 1 FROM payments.tenant_returns WHERE attempt_id = %L)$$, :'v2'::jsonb ->> 'attempt_id'));

-- H1 (tenant): the purge parks an unverified kept return before it can delete it
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS v3o \gset
SELECT pg_temp.h('fake-return|review-h1-c') AS pv3 \gset
SELECT pg_temp.t_returned(:SB, :'v3o', :C4, :'pv3', 'fake-v3-0001') AS v3 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'v3'::jsonb ->> 'attempt_id', :'pv3', pg_temp.tok('raw-v3'))) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_returns SET received_at = now() - interval '125 minutes', purge_after = now() - interval '5 minutes'
 WHERE attempt_id = (:'v3'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS ok \gset
SELECT tests.check('DM-PAY-4 (review H1): a raw return past its ceiling that no VERIFY confirmed parks its attempt (verify_exhausted, order held) in the same purge run, before it is deleted',
  format($$SELECT (SELECT state = 'needs_review' AND review_reason = 'verify_exhausted' FROM payments.tenant_attempts WHERE id = %1$L)
             AND (SELECT payment_due_at IS NULL FROM public.orders WHERE id = %2$L)
             AND NOT EXISTS (SELECT 1 FROM payments.tenant_returns WHERE attempt_id = %1$L)$$,
         :'v3'::jsonb ->> 'attempt_id', :'v3o'));

-- M3: a verified, approved payment in review holds its order (not cancelled, stock kept); expire_unpaid_orders unchanged
SELECT (SELECT stock_quantity FROM public.global_products WHERE id = :PM3) AS m3_stock0 \gset
SELECT pg_temp.order_of(:SB, :C5, :PM3, :SHIP_B, 1, 'online') AS m3o \gset
SELECT pg_temp.order_of(:SB, :C5, :PM3, :SHIP_B, 1, 'online') AS m3c \gset
SELECT pg_temp.t_pay(:SB, :'m3o', :C5, 'fake-m3-0001', '0', NULL, 'ILS', 1, '{document}') AS m3r \gset
SET session_replication_role = replica;
UPDATE public.orders SET payment_due_at = now() - interval '1 minute' WHERE id = :'m3c';
SET session_replication_role = origin;
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT tests.check('DM-PAY-5 (review M3): an approved, verified payment that ends in needs_review holds its order — expire_unpaid_orders cancels an unpaid control order and returns its stock, never the held one',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'document_issued'
             AND (SELECT status = 'pending' AND payment_status = 'awaiting' AND payment_due_at IS NULL FROM public.orders WHERE id = %2$L)
             AND (SELECT status = 'cancelled' AND payment_status = 'expired' FROM public.orders WHERE id = %3$L)
             AND (SELECT stock_quantity FROM public.global_products WHERE id = %4$L) = %5$s - 1$$,
         :'m3r', :'m3o', :'m3c', :PM3, :m3_stock0));
SELECT tests.check('DM-REG-1 (review M3): expire_unpaid_orders (Bit / phone / manual expiry) is byte-identical to migration 207 — not touched by 208',
  $$SELECT md5(pg_get_functiondef('public.expire_unpaid_orders()'::regprocedure)) = '8fa6bc8d47665c1d802a01a6cacbb0a7'$$);
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'m3o', :C5, 'demo')), '') AS m3_reopen \gset
SELECT tests.check('DM-PAY-5 (review M3): a held order cannot start another card payment (no second charge while a person reviews the first)',
  format($$SELECT %L <> '' AND (SELECT count(*) FROM payments.tenant_attempts WHERE order_id = %L) = 1$$, :'m3_reopen', :'m3o'));

-- M4 (tenant): a second, different approved charge on an attempt in review → duplicate_charge, the transaction id kept
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS m4o \gset
SELECT pg_temp.h('fake-return|review-m4-a') AS pm4a, pg_temp.h('fake-return|review-m4-b') AS pm4b \gset
SELECT pg_temp.t_returned(:SB, :'m4o', :C5, :'pm4a', 'fake-m4-0001') AS m4 \gset
SELECT pg_temp.t_settle(:SB, :'m4'::jsonb ->> 'reference', :'pm4a', '0', '0', :'t_b', 'fake-m4-0001', 1001) AS m4_first \gset
SELECT pg_temp.t_ret(:SB, :'m4'::jsonb ->> 'reference', :'pm4b', '0', 'fake-m4-0002', 1000) AS ok \gset
SELECT pg_temp.t_settle(:SB, :'m4'::jsonb ->> 'reference', :'pm4b', '0', '0', :'t_b', 'fake-m4-0002', 1000) AS m4_second \gset
SELECT tests.check('DM-PAY-5 (review M4): first verified return amount_mismatch; a second, different approved charge → duplicate_charge, both transaction ids on the attempt, never applied',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'amount_mismatch' AND %2$L::jsonb ->> 'result' = 'duplicate_charge'
             AND (SELECT review_reason = 'duplicate_charge' AND provider_txn_id = 'fake-m4-0001' AND extra_txn_ids = '{fake-m4-0002}'
                         AND NOT applied FROM payments.tenant_attempts WHERE id = %3$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events WHERE attempt_id = %3$L AND source = 'review' AND result = 'duplicate_charge')$$,
         :'m4_first', :'m4_second', :'m4'::jsonb ->> 'attempt_id'));

-- M1 (store): a terminal / credential change while a payer is on the payment page needs force, then parks the attempt
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS m1o \gset
SELECT pg_temp.t_open(:SB, :'m1o', :C5) AS m1 \gset
SELECT pg_temp.t_sign(:SB, :'m1'::jsonb ->> 'attempt_id') AS ok \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('api_key_enc', pg_temp.tok('b-key-3', '0deadbee'), 'api_password_enc', pg_temp.tok('b-pass-3', '0deadbee')), 'demo')), '') AS m1_noforce \gset
SELECT (SELECT state FROM payments.tenant_attempts WHERE id = (:'m1'::jsonb ->> 'attempt_id')::uuid) AS m1_state_noforce \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('api_key_enc', pg_temp.tok('b-key-3', '0deadbee'), 'api_password_enc', pg_temp.tok('b-pass-3', '0deadbee'), 'force', true), 'demo')) AS m1_force \gset
SELECT pg_temp.h('fake-return|review-m1') AS pm1 \gset
SELECT pg_temp.t_ret(:SB, :'m1'::jsonb ->> 'reference', :'pm1', '0', 'fake-m1-0001', 1000) AS m1_ret \gset
SELECT tests.check('DM-SEP-1 (review M1): replacing a store''s credentials while a payer is on the payment page (redirected) needs force; with force the attempt is parked credentials_changed; its later return holds the order',
  format($$SELECT %1$L LIKE '%%on the payment page%%' AND %2$L = 'redirected' AND %3$L::jsonb ->> 'status' = 'unverified'
             AND (SELECT state = 'needs_review' AND review_reason = 'credentials_changed' FROM payments.tenant_attempts WHERE id = %4$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events WHERE attempt_id = %4$L AND source = 'review' AND result = 'credentials_changed')
             AND %5$L::jsonb ->> 'result' = 'received'
             AND (SELECT payment_due_at IS NULL AND status = 'pending' FROM public.orders WHERE id = %6$L)$$,
         :'m1_noforce', :'m1_state_noforce', :'m1_force', :'m1'::jsonb ->> 'attempt_id', :'m1_ret', :'m1o'));
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset

-- M5: a variant sold in an online-paid order can still be removed from the product; the order's amounts do not move
SELECT (pg_temp.call(:SB, :C5, format(
    $q$SELECT to_jsonb(x) FROM public.place_order('order',
         jsonb_build_array(jsonb_build_object('product_id', %L, 'variant_id', %L, 'quantity', 1, 'unit_price', 10)), 18, true,
         jsonb_build_object('customer_name', 'לקוח תשלום מקוון', 'customer_tax_id', '123456782',
           'customer_phone', '0501234567', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1',
           'billing_zip', '6100001', 'accepted_terms', true, 'shipping_method_id', %L, 'payment_method', 'online')) x$q$,
    :PV, :VR1, :SHIP_B)) ->> 'id') AS m5o \gset
SELECT pg_temp.t_pay(:SB, :'m5o', :C5, 'fake-m5-0001') AS m5pay \gset
SELECT (SELECT total FROM public.orders WHERE id = :'m5o') AS m5_total,
       (SELECT string_agg(quantity || '/' || unit_price, ',') FROM public.order_items WHERE order_id = :'m5o') AS m5_lines \gset
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('WITH u AS (UPDATE public.order_items SET variant_id = %L WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :VR2, :'m5o')), '') AS m5_swap \gset
SELECT COALESCE(pg_temp.err(:SB, :B_OWNER, format('SELECT to_jsonb(public.save_product_variants(%L, %L, %L))', :PV, '[]', '[]')), '') AS m5_save \gset
SELECT tests.check('DM-REG-1 (review M5): the store owner removes a variant sold in an online-paid order (ON DELETE SET NULL passes the lock); the order''s total and lines are unchanged; swapping the variant is still refused',
  format($$SELECT %1$L::jsonb ->> 'result' = 'test_paid' AND %2$L LIKE '%%paid online%%' AND %3$L = ''
             AND NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id IN (%4$L, %5$L))
             AND (SELECT bool_and(variant_id IS NULL) FROM public.order_items WHERE order_id = %6$L)
             AND (SELECT total FROM public.orders WHERE id = %6$L) = %7$L::numeric
             AND (SELECT string_agg(quantity || '/' || unit_price, ',') FROM public.order_items WHERE order_id = %6$L) = %8$L$$,
         :'m5pay', :'m5_swap', :'m5_save', :VR1, :VR2, :'m5o', :'m5_total', :'m5_lines'));

-- L4: the guest's status view refuses an expired token, as max_attempt_open does
SET session_replication_role = replica;
UPDATE payments.tenant_order_access SET created_at = now() - interval '30 hours', expires_at = now() - interval '6 hours'
 WHERE order_id = :'g1';
SET session_replication_role = origin;
SELECT COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, NULL, %L)', :SB, :'g1', :'gt1'))::text, 'null') AS l4_status \gset
SELECT tests.check('DM-SEP-5 (review L4): an expired guest token no longer opens the payment status',
  format($$SELECT %L = 'null'$$, :'l4_status'));

-- H1 (platform): the 6th failed VERIFY parks the platform attempt; the charge is not payable until the review is resolved
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":8,"description":"חיוב בדיקה 8 (אימות נכשל)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":9,"description":"חיוב בדיקה 9 (מסמך ואז ניסיון ישן)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":7,"description":"חיוב בדיקה 7 (חיוב שני)"}')) IS NOT NULL AS ok \gset
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":6,"description":"חיוב בדיקה 6 (מסוף הוחלף)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 8 (אימות נכשל)') AS chv1,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 9 (מסמך ואז ניסיון ישן)') AS chv2,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 7 (חיוב שני)') AS chv3,
       (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 6 (מסוף הוחלף)') AS chv4 \gset
SELECT pg_temp.h('fake-platform-return|review-h1') AS ppv1 \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chv1', NULL, :'ppv1', 'fake-pv-0001') AS pv1a \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_return_keep(%L, %L, %L))', :'pv1a'::jsonb ->> 'attempt_id', :'ppv1', pg_temp.tok('praw-v1'))) AS ok \gset
SELECT pg_temp.p_fail_verify(:'pv1a'::jsonb, :'ppv1', :'t_plat', 5) AS ok \gset
SELECT pg_temp.svc('SELECT public.platform_attempts_pending_verify(200)') AS ppv_list5 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_secrets(%L, %L)', :'pv1a'::jsonb ->> 'attempt_id', 'verify')) AS ok \gset
SELECT pg_temp.p_settle(:'pv1a'::jsonb ->> 'reference', :'ppv1', NULL, '0', :'t_plat', 'fake-pv-0001', 800) AS ppv_r6 \gset
SELECT pg_temp.svc('SELECT public.platform_attempts_pending_verify(200)') AS ppv_list6 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'chv1', 'demo')), '') AS ppv_reopen \gset
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_options()') AS ppv_opts \gset
SELECT tests.check('DM-PAY-4 (review H1, platform): listed after 5 failed VERIFYs; the 6th parks it (verify_exhausted); the charge is not payable and cannot be opened again while the review is open',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'attempt_id' = %2$L)
             AND %3$L::jsonb ->> 'result' = 'needs_review' AND %3$L::jsonb ->> 'reason' = 'verify_exhausted'
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(%4$L::jsonb) e WHERE e ->> 'attempt_id' = %2$L)
             AND %5$L LIKE '%%being verified or reviewed%%'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%6$L::jsonb -> 'charges') e
                          WHERE e ->> 'id' = %7$L AND NOT (e ->> 'payable')::boolean AND (e ->> 'in_review')::boolean)$$,
         :'ppv_list5', :'pv1a'::jsonb ->> 'attempt_id', :'ppv_r6', :'ppv_list6', :'ppv_reopen', :'ppv_opts', :'chv1'));
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_card_payment_resolve(%L, %L, %L))', :PLAT, :'pv1a'::jsonb ->> 'attempt_id', 'נבדק בפורטל: לא חויב')) AS ok \gset
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_options()') AS ppv_opts2 \gset
SELECT tests.check('DM-PLAT-3 (review H2): once the platform admin resolved the review, the charge is payable again',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%L::jsonb -> 'charges') e
                           WHERE e ->> 'id' = %L AND (e ->> 'payable')::boolean AND NOT (e ->> 'in_review')::boolean)$$,
         :'ppv_opts2', :'chv1'));

-- H2: a charge whose payment is in review (approved, money moved) is not payable; a late approved sibling → duplicate_charge
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chv2', NULL, NULL, NULL) AS h2a \gset
SELECT pg_temp.h('fake-platform-return|review-h2-b') AS ph2b, pg_temp.h('fake-platform-return|review-h2-a') AS ph2a \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chv2', 'http://op-store-b.shop.localhost:3100', :'ph2b', 'fake-ph2-0002') AS h2b \gset
SELECT pg_temp.p_settle(:'h2b'::jsonb ->> 'reference', :'ph2b', '0', '0', :'t_plat', 'fake-ph2-0002', 900, '{document}') AS h2b_settle \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'chv2', 'demo')), '') AS h2_reopen \gset
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_options()') AS h2_opts \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'h2a'::jsonb ->> 'reference', :'ph2a', '0', 'fake-ph2-0001', 900)) AS ok \gset
SELECT pg_temp.p_settle(:'h2a'::jsonb ->> 'reference', :'ph2a', '0', '0', :'t_plat', 'fake-ph2-0001', 900) AS h2a_settle \gset
SELECT tests.check('DM-PLAT-3 (review H2): with an approved payment in review (document_issued) the charge is not payable and not opened again; the superseded attempt''s late approved payment → duplicate_charge, no ledger row',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'document_issued' AND %2$L LIKE '%%being verified or reviewed%%'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%3$L::jsonb -> 'charges') e WHERE e ->> 'id' = %4$L AND NOT (e ->> 'payable')::boolean)
             AND %5$L::jsonb ->> 'result' = 'needs_review' AND %5$L::jsonb ->> 'reason' = 'duplicate_charge'
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE provider_ref IN ('max:test:fake-ph2-0001', 'max:test:fake-ph2-0002'))$$,
         :'h2b_settle', :'h2_reopen', :'h2_opts', :'chv2', :'h2a_settle'));

-- M4 (platform): a second, different approved charge on a platform attempt in review → duplicate_charge, id kept
SELECT pg_temp.h('fake-platform-return|review-m4-a') AS ppm4a, pg_temp.h('fake-platform-return|review-m4-b') AS ppm4b \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chv3', NULL, :'ppm4a', 'fake-pm4-0001') AS pm4 \gset
SELECT pg_temp.p_settle(:'pm4'::jsonb ->> 'reference', :'ppm4a', '0', '0', :'t_plat', 'fake-pm4-0001', 701) AS pm4_first \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pm4'::jsonb ->> 'reference', :'ppm4b', '0', 'fake-pm4-0002', 700)) AS ok \gset
SELECT pg_temp.p_settle(:'pm4'::jsonb ->> 'reference', :'ppm4b', '0', '0', :'t_plat', 'fake-pm4-0002', 700) AS pm4_second \gset
SELECT tests.check('DM-PLAT-3 (review M4): platform — first verified return amount_mismatch, a second different approved charge → duplicate_charge with its transaction id kept; no ledger row',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'amount_mismatch' AND %2$L::jsonb ->> 'result' = 'duplicate_charge'
             AND (SELECT review_reason = 'duplicate_charge' AND provider_txn_id = 'fake-pm4-0001' AND extra_txn_ids = '{fake-pm4-0002}'
                    FROM payments.platform_attempts WHERE id = %3$L)
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE provider_ref IN ('max:test:fake-pm4-0001', 'max:test:fake-pm4-0002'))$$,
         :'pm4_first', :'pm4_second', :'pm4'::jsonb ->> 'attempt_id'));

-- M1 (platform): NURIEL's terminal changed while a store owner is on the payment page: force, then parked
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chv4', NULL, NULL, NULL) AS pm1 \gset
SELECT pg_temp.stepup(:PLAT) AS su_m1 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT,
         jsonb_build_object('api_key_enc', pg_temp.tok('plat-key-2'), 'api_password_enc', pg_temp.tok('plat-pass-2')), 'demo',
         :'su_m1'::jsonb ->> 'challenge_id', repeat('p', 64))), '') AS pm1_noforce \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT,
         jsonb_build_object('api_key_enc', pg_temp.tok('plat-key-2'), 'api_password_enc', pg_temp.tok('plat-pass-2'), 'force', true), 'demo',
         :'su_m1'::jsonb ->> 'challenge_id', repeat('p', 64))) AS pm1_force \gset
SELECT tests.check('DM-SEP-6 (review M1): replacing NURIEL''s credentials while a payer is on the payment page needs force (the code is not spent by the refusal); with force the attempt is parked credentials_changed',
  format($$SELECT %1$L LIKE '%%on the payment page%%' AND %2$L::jsonb ->> 'status' = 'unverified'
             AND (SELECT state = 'needs_review' AND review_reason = 'credentials_changed' FROM payments.platform_attempts WHERE id = %3$L)
             AND (SELECT spent_at IS NOT NULL FROM payments.platform_stepup_challenges WHERE id = %4$L)$$,
         :'pm1_noforce', :'pm1_force', :'pm1'::jsonb ->> 'attempt_id', :'su_m1'::jsonb ->> 'challenge_id'));
SELECT pg_temp.svc(format('SELECT public.platform_terminal_verified(%L, true, %L)', :PLAT, '0')) AS ok \gset

-- ============================================================
-- 19. Fix round 3 (contract §7.1 X-14 … X-17; second review R2-1, R2-2, R2-3, R2-7, R2-8; first review N1–N3)
-- ============================================================
-- drain the review alerts of the sections above (X-17): from here on each new reason must be claimed exactly once
DO $$
BEGIN
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.max_review_alerts_claim(200)')) > 0 LOOP END LOOP;
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)')) > 0 LOOP END LOOP;
END $$;
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset
-- the attempts of one order in the alert claim result
CREATE OR REPLACE FUNCTION pg_temp.claimed(_claim jsonb, _attempt text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::int FROM jsonb_array_elements(_claim) e WHERE e ->> 'attempt_id' = _attempt;
$f$;

-- X-14 (R2-2): the return is recorded, VERIFY never succeeds, the payment jobs never run, time passes → nothing expires
SELECT (SELECT stock_quantity FROM public.global_products WHERE id = :P10) AS r3_stock0 \gset
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS x14o \gset
SELECT (SELECT payment_due_at IS NOT NULL FROM public.orders WHERE id = :'x14o') AS x14_due_before \gset
SELECT pg_temp.h('fake-return|r3-x14') AS px14 \gset
SELECT pg_temp.t_returned(:SB, :'x14o', :C4, :'px14', 'fake-x14-0001') AS x14 \gset
SELECT pg_temp.t_fail_verify(:SB, :'x14'::jsonb, :'px14', 1) AS x14_unverified \gset
SET session_replication_role = replica;
UPDATE public.orders SET created_at = now() - interval '20 hours' WHERE id = :'x14o';
UPDATE payments.tenant_attempts SET created_at = now() - interval '20 hours', expires_at = now() - interval '19 hours 30 minutes',
       returned_at = now() - interval '19 hours 40 minutes'
 WHERE id = (:'x14'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT to_jsonb(public.expire_unpaid_orders()) AS x14_expired \gset
SELECT pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'x14o', :C4)) AS x14_status \gset
SELECT tests.check('DM-PAY-4 (X-14, R2-2): a recorded return holds the order in the DB — VERIFY never succeeds, no payment job runs, hours pass: expire_unpaid_orders cancels 0 orders, the stock stays reserved, the order is still pending/awaiting (payment_held)',
  format($$SELECT %1$L::boolean AND %2$L::jsonb ->> 'result' = 'unverified' AND %3$L::int = 0
             AND (SELECT status = 'pending' AND payment_status = 'awaiting' AND payment_due_at IS NULL FROM public.orders WHERE id = %4$L)
             AND (SELECT stock_quantity FROM public.global_products WHERE id = %5$L) = %6$s - 1
             AND (%7$L::jsonb ->> 'payment_held')::boolean
             AND (SELECT state = 'returned' FROM payments.tenant_attempts WHERE id = %8$L)$$,
         :'x14_due_before', :'x14_unverified', :'x14_expired', :'x14o', :P10, :r3_stock0, :'x14_status',
         :'x14'::jsonb ->> 'attempt_id'));
-- X-14: a decline VERIFY confirmed releases the order (a fresh window, capped 24 h after placing)
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS x14d \gset
SELECT pg_temp.h('fake-return|r3-x14-decline') AS px14d \gset
SELECT pg_temp.t_returned(:SB, :'x14d', :C4, :'px14d', 'fake-x14d-0001') AS x14da \gset
SELECT (SELECT payment_due_at IS NULL FROM public.orders WHERE id = :'x14d') AS x14d_held \gset
SELECT pg_temp.t_settle(:SB, :'x14da'::jsonb ->> 'reference', :'px14d', '0', '33', :'t_b', 'fake-x14d-0001', 1000) AS x14d_settle \gset
SELECT pg_temp.t_open(:SB, :'x14d', :C4) AS x14d_retry \gset
SELECT tests.check('DM-PAY-5 (X-14): a VERIFY-confirmed decline releases the held order — a fresh window of about 2 hours; the customer can try again',
  format($$SELECT %1$L::boolean AND %2$L::jsonb ->> 'result' = 'not_paid'
             AND (SELECT payment_due_at BETWEEN now() + interval '1 hour 59 minutes' AND now() + interval '2 hours 1 minute'
                    FROM public.orders WHERE id = %3$L)
             AND NOT (%4$L::jsonb ->> 'reused')::boolean$$,
         :'x14d_held', :'x14d_settle', :'x14d', :'x14d_retry'));

-- X-15 (R2-1, the second reviewer's repro1): staff cancels the attempt while the payer is on the Hyp page; the payer pays,
-- the late return arrives, VERIFY times out → a second attempt is refused; the first then verifies as paid, no duplicate
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS x15o \gset
SELECT pg_temp.t_open(:SB, :'x15o', :C4) AS x15a \gset
SELECT pg_temp.t_sign(:SB, :'x15a'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :B_OWNER, :SB, :'x15o')) AS x15_cancel \gset
SELECT pg_temp.h('fake-return|r3-x15') AS px15 \gset
SELECT pg_temp.t_ret(:SB, :'x15a'::jsonb ->> 'reference', :'px15', '0', 'fake-x15-0001', 1000) AS x15_ret \gset
SELECT pg_temp.t_fail_verify(:SB, :'x15a'::jsonb, :'px15', 1) AS x15_unverified \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'x15o', :C4, 'demo')), '') AS x15_reopen \gset
SELECT pg_temp.t_settle(:SB, :'x15a'::jsonb ->> 'reference', :'px15', '0', '0', :'t_b', 'fake-x15-0001', 1000) AS x15_late \gset
SELECT tests.check('DM-PAY-5 (X-15, R2-1): a late return of a cancelled attempt that VERIFY could not confirm keeps the order busy — a second attempt is refused; the late VERIFY then pays it once',
  format($$SELECT %1$L::int = 1 AND %2$L::jsonb ->> 'result' = 'received' AND %3$L::jsonb ->> 'result' = 'unverified'
             AND %4$L LIKE '%%being verified%%' AND %5$L::jsonb ->> 'result' = 'test_paid'
             AND (SELECT count(*) FROM payments.tenant_attempts WHERE order_id = %6$L) = 1
             AND (SELECT payment_status = 'paid' FROM public.orders WHERE id = %6$L)$$,
         :'x15_cancel', :'x15_ret', :'x15_unverified', :'x15_reopen', :'x15_late', :'x15o'));

-- X-16 (R2-3 / N2, R2-8 / N3) + X-17: a forged return (VERIFY rejects it) is parked by the sweep; a person decides
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS f1o \gset
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS f2o \gset
SELECT pg_temp.h('fake-return|r3-forged-1') AS pf1, pg_temp.h('fake-return|r3-forged-2') AS pf2 \gset
SELECT pg_temp.t_returned(:SB, :'f1o', :C5, :'pf1', 'fake-f1-0001') AS f1 \gset
SELECT pg_temp.t_returned(:SB, :'f2o', :C5, :'pf2', 'fake-f2-0001') AS f2 \gset
SELECT pg_temp.t_settle(:SB, :'f1'::jsonb ->> 'reference', :'pf1', '902', '0', :'t_b', 'fake-f1-0001', 1000) AS f1_rejected \gset
SELECT pg_temp.t_settle(:SB, :'f2'::jsonb ->> 'reference', :'pf2', '902', '0', :'t_b', 'fake-f2-0001', 1000) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_attempts SET returned_at = now() - interval '95 minutes'
 WHERE id IN ((:'f1'::jsonb ->> 'attempt_id')::uuid, (:'f2'::jsonb ->> 'attempt_id')::uuid);
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS f_claim1 \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS f_claim2 \gset
SELECT tests.check('DM-PAY-10 (X-17, R2-7): an attempt parked by the sweep is alerted exactly once — the claim returns it (attempt, store, order, number, reason, state), the next claim does not',
  format($$SELECT %1$L::jsonb ->> 'result' = 'unverified'
             AND pg_temp.claimed(%2$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%2$L::jsonb, %5$L) = 1
             AND pg_temp.claimed(%3$L::jsonb, %4$L) = 0 AND pg_temp.claimed(%3$L::jsonb, %5$L) = 0
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e
                          WHERE e ->> 'attempt_id' = %4$L AND e ->> 'tenant_id' = %6$L AND e ->> 'order_id' = %7$L
                            AND e ->> 'order_number' IS NOT NULL AND e ->> 'review_reason' = 'verify_exhausted'
                            AND e ->> 'state' = 'needs_review'
                            AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k)
                                = ARRAY['attempt_id', 'order_id', 'order_number', 'review_reason', 'state', 'tenant_id'])
             AND (SELECT review_alerted_at IS NOT NULL FROM payments.tenant_attempts WHERE id = %4$L)$$,
         :'f1_rejected', :'f_claim1', :'f_claim2', :'f1'::jsonb ->> 'attempt_id', :'f2'::jsonb ->> 'attempt_id', :SB, :'f1o'));
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'f1o', :C5, 'demo')), '') AS f1_open_parked,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_review_resolve(%L, %L, %L, %L, NULL)', :B_OWNER, :SB, :'f1'::jsonb ->> 'attempt_id', 'x')), '') AS f1_no_outcome,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_review_resolve(%L, %L, %L, %L, %L)', :B_OWNER, :SB, :'f1'::jsonb ->> 'attempt_id', 'x', 'refunded')), '') AS f1_bad_outcome,
       COALESCE(pg_temp.svc_err(format('SELECT public.max_review_resolve(%L, %L, %L, %L, %L)', :B_MGR, :SB, :'f1'::jsonb ->> 'attempt_id', 'x', 'not_charged')), '') AS f1_mgr \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'f1'::jsonb ->> 'attempt_id', 'בדקתי בפורטל: לא חויב', 'not_charged')) AS f1_resolve \gset
SELECT pg_temp.t_open(:SB, :'f1o', :C5) AS f1_retry \gset
SELECT tests.check('DM-PAY-5 (X-16, R2-3 / N2 / N3): a parked order is not payable; the resolve needs an outcome (not_charged | charged) from the owner; not_charged releases it — payable again, the audit names review, review_outcome, payment_due_at',
  format($$SELECT %1$L LIKE '%%being reviewed%%' AND %2$L LIKE '%%resolve with an outcome%%' AND %3$L LIKE '%%not_charged or charged%%'
             AND %4$L LIKE '%%only the store owner%%' AND %5$L::boolean
             AND (SELECT review_outcome = 'not_charged' AND review_resolved_by = %6$L FROM payments.tenant_attempts WHERE id = %7$L)
             AND (SELECT payment_due_at > now() FROM public.orders WHERE id = %8$L)
             AND NOT (%9$L::jsonb ->> 'reused')::boolean
             AND (SELECT changed_fields = ARRAY['review', 'review_outcome', 'payment_due_at'] FROM payments.tenant_config_audit
                   WHERE tenant_id = %10$L AND action = 'review_resolved' ORDER BY id DESC LIMIT 1)
             AND (SELECT count(*) FROM pg_proc WHERE proname = 'max_review_resolve') = 1$$,
         :'f1_open_parked', :'f1_no_outcome', :'f1_bad_outcome', :'f1_mgr', :'f1_resolve', :B_OWNER,
         :'f1'::jsonb ->> 'attempt_id', :'f1o', :'f1_retry', :SB));
SELECT (SELECT stock_quantity FROM public.global_products WHERE id = :P10) AS f_stock0 \gset
SET session_replication_role = replica;
UPDATE public.orders SET payment_due_at = now() - interval '1 minute' WHERE id = :'f1o';
SET session_replication_role = origin;
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'f2'::jsonb ->> 'attempt_id', 'בדקתי בפורטל: חויב', 'charged')) AS f2_resolve \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'f2o', :C5, 'demo')), '') AS f2_open \gset
SELECT tests.check('DM-PAY-5 (X-16): released, the order expires normally and its stock comes back; resolved charged, the other order stays held for good — never expired, a new attempt refused',
  format($$SELECT (SELECT status = 'cancelled' AND payment_status = 'expired' FROM public.orders WHERE id = %1$L)
             AND (SELECT stock_quantity FROM public.global_products WHERE id = %2$L) = %3$s + 1
             AND %4$L::boolean
             AND (SELECT status = 'pending' AND payment_status = 'awaiting' AND payment_due_at IS NULL FROM public.orders WHERE id = %5$L)
             AND (SELECT review_outcome = 'charged' FROM payments.tenant_attempts WHERE id = %6$L)
             AND %7$L LIKE '%%held for the store%%'
             AND (SELECT changed_fields = ARRAY['review', 'review_outcome'] FROM payments.tenant_config_audit
                   WHERE tenant_id = %8$L AND action = 'review_resolved' ORDER BY id DESC LIMIT 1)$$,
         :'f1o', :P10, :f_stock0, :'f2_resolve', :'f2o', :'f2'::jsonb ->> 'attempt_id', :'f2_open', :SB));

-- X-17: parked by the purge, by the 6th VERIFY, by a credentials change — each alerted exactly once; a new reason re-arms
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS k1o \gset
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS k2o \gset
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS k3o \gset
SELECT pg_temp.h('fake-return|r3-purge') AS pk1, pg_temp.h('fake-return|r3-6th') AS pk2 \gset
SELECT pg_temp.t_returned(:SB, :'k1o', :C5, :'pk1', 'fake-k1-0001') AS k1 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :SB, :'k1'::jsonb ->> 'attempt_id', :'pk1', pg_temp.tok('raw-k1'))) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_returns SET received_at = now() - interval '95 minutes', purge_after = now() + interval '25 minutes'
 WHERE attempt_id = (:'k1'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS ok \gset
SELECT pg_temp.t_returned(:SB, :'k2o', :C5, :'pk2', 'fake-k2-0001') AS k2 \gset
SELECT pg_temp.t_fail_verify(:SB, :'k2'::jsonb, :'pk2', 6) AS k2_r6 \gset
SELECT pg_temp.t_open(:SB, :'k3o', :C5) AS k3 \gset
SELECT pg_temp.t_sign(:SB, :'k3'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :SB,
         jsonb_build_object('api_key_enc', pg_temp.tok('b-key-4', '0deadbee'), 'api_password_enc', pg_temp.tok('b-pass-4', '0deadbee'), 'force', true), 'demo')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS k_claim1 \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS k_claim2 \gset
SELECT tests.check('DM-PAY-10 (X-17): parked by the purge, by the 6th failed VERIFY and by a credentials change — each claimed exactly once, with its reason',
  format($$SELECT pg_temp.claimed(%1$L::jsonb, %3$L) = 1 AND pg_temp.claimed(%1$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%1$L::jsonb, %5$L) = 1
             AND pg_temp.claimed(%2$L::jsonb, %3$L) + pg_temp.claimed(%2$L::jsonb, %4$L) + pg_temp.claimed(%2$L::jsonb, %5$L) = 0
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'attempt_id' = %3$L AND e ->> 'review_reason' = 'verify_exhausted')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'attempt_id' = %4$L AND e ->> 'review_reason' = 'verify_exhausted')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'attempt_id' = %5$L AND e ->> 'review_reason' = 'credentials_changed')
             AND %6$L::jsonb ->> 'reason' = 'verify_exhausted'$$,
         :'k_claim1', :'k_claim2', :'k1'::jsonb ->> 'attempt_id', :'k2'::jsonb ->> 'attempt_id', :'k3'::jsonb ->> 'attempt_id', :'k2_r6'));
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS k4o \gset
SELECT pg_temp.h('fake-return|r3-rearm-a') AS pk4a, pg_temp.h('fake-return|r3-rearm-b') AS pk4b \gset
SELECT pg_temp.t_returned(:SB, :'k4o', :C5, :'pk4a', 'fake-k4-0001') AS k4 \gset
SELECT pg_temp.t_settle(:SB, :'k4'::jsonb ->> 'reference', :'pk4a', '0', '0', :'t_b', 'fake-k4-0001', 1001) AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS k4_claim1 \gset
SELECT pg_temp.t_ret(:SB, :'k4'::jsonb ->> 'reference', :'pk4b', '0', 'fake-k4-0002', 1000) AS ok \gset
SELECT pg_temp.t_settle(:SB, :'k4'::jsonb ->> 'reference', :'pk4b', '0', '0', :'t_b', 'fake-k4-0002', 1000) AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS k4_claim2 \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS k4_claim3 \gset
SELECT tests.check('DM-PAY-10 (X-17): a new reason on the same attempt is a new alert (amount_mismatch, then a second charge: duplicate_charge) — each once',
  format($$SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(%1$L::jsonb) e WHERE e ->> 'attempt_id' = %4$L AND e ->> 'review_reason' = 'amount_mismatch')
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e WHERE e ->> 'attempt_id' = %4$L AND e ->> 'review_reason' = 'duplicate_charge')
             AND pg_temp.claimed(%1$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%2$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%3$L::jsonb, %4$L) = 0$$,
         :'k4_claim1', :'k4_claim2', :'k4_claim3', :'k4'::jsonb ->> 'attempt_id'));
-- X-17 (platform): a platform attempt parked by its 6th failed VERIFY is claimed once, with its charge and paying store
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":5,"description":"חיוב בדיקה 5 (התראה)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 5 (התראה)') AS chk \gset
SELECT pg_temp.h('fake-platform-return|r3-alert') AS ppk \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'chk', NULL, :'ppk', 'fake-pk-0001') AS pk \gset
SELECT pg_temp.p_fail_verify(:'pk'::jsonb, :'ppk', :'t_plat', 6) AS pk_r6 \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pk_claim1 \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pk_claim2 \gset
SELECT tests.check('DM-PLAT-3 (X-17): a parked platform attempt is claimed exactly once — attempt, target kind and id, paying store, reason, state',
  format($$SELECT %1$L::jsonb ->> 'reason' = 'verify_exhausted'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%2$L::jsonb) e
                          WHERE e ->> 'attempt_id' = %4$L AND e ->> 'target_kind' = 'ledger_charge' AND e ->> 'target_id' = %5$L
                            AND e ->> 'tenant_id' = %6$L AND e ->> 'review_reason' = 'verify_exhausted' AND e ->> 'state' = 'needs_review'
                            AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k)
                                = ARRAY['attempt_id', 'review_reason', 'state', 'target_id', 'target_kind', 'tenant_id'])
             AND pg_temp.claimed(%2$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%3$L::jsonb, %4$L) = 0$$,
         :'pk_r6', :'pk_claim1', :'pk_claim2', :'pk'::jsonb ->> 'attempt_id', :'chk', :SB));

-- ============================================================
-- 20. Fix round 4 (contract §7.1b X-22 … X-25; owner's acceptance criteria A–E; findings R3-1 … R3-4, N4)
-- ============================================================
CREATE OR REPLACE FUNCTION pg_temp.drain() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.max_review_alerts_claim(200)')) > 0 LOOP END LOOP;
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)')) > 0 LOOP END LOOP;
END $f$;
-- age an attempt's return(s) by _ago (test-only rewrite of timestamps, triggers off)
CREATE OR REPLACE FUNCTION pg_temp.age_return(_scope text, _attempt text, _ago interval) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  SET LOCAL session_replication_role = replica;
  IF _scope = 'tenant' THEN
    UPDATE payments.tenant_attempts SET returned_at = returned_at - _ago WHERE id = _attempt::uuid;
    UPDATE payments.tenant_events SET created_at = created_at - _ago WHERE attempt_id = _attempt::uuid;
  ELSE
    UPDATE payments.platform_attempts SET returned_at = returned_at - _ago WHERE id = _attempt::uuid;
    UPDATE payments.platform_events SET created_at = created_at - _ago WHERE attempt_id = _attempt::uuid;
  END IF;
  SET LOCAL session_replication_role = origin;
END $f$;
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :SB, '0')) AS ok \gset

-- A + B + C (store): parked → claimed → resolved not_charged → a later payload reopens; a verified charge after it
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS a4o \gset
SELECT pg_temp.h('fake-return|r4-a-timeout') AS pa4t, pg_temp.h('fake-return|r4-a-genuine') AS pa4g \gset
SELECT pg_temp.t_returned(:SB, :'a4o', :C4, :'pa4t', 'fake-a4-0000') AS a4 \gset
SELECT pg_temp.t_fail_verify(:SB, :'a4'::jsonb, :'pa4t', 1) AS ok \gset
SELECT pg_temp.age_return('tenant', :'a4'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS a4_claim0 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'a4'::jsonb ->> 'attempt_id', 'portal: nothing', 'not_charged')) AS ok \gset
SELECT (SELECT payment_due_at IS NOT NULL FROM public.orders WHERE id = :'a4o') AS a4_released \gset
SELECT pg_temp.t_ret(:SB, :'a4'::jsonb ->> 'reference', :'pa4g', '0', 'fake-a4-0001', 1000) AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS a4_claim1 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'a4o', :C4, 'demo')), '') AS a4_open1 \gset
SELECT tests.check('Criterion A (store, X-22): a ''not_charged'' decision is never treated as proof that no late charge will come — a later payload on that attempt reopens the review (cleared decision, a reopened event), the order is held again and alerted once',
  format($$SELECT pg_temp.claimed(%1$L::jsonb, %3$L) = 1 AND %4$L::boolean
             AND jsonb_array_length(%2$L::jsonb) = 1 AND pg_temp.claimed(%2$L::jsonb, %3$L) = 1
             AND (SELECT state = 'needs_review' AND review_resolved_at IS NULL AND review_resolved_by IS NULL AND review_outcome IS NULL
                    FROM payments.tenant_attempts WHERE id = %3$L)
             AND EXISTS (SELECT 1 FROM payments.tenant_events WHERE attempt_id = %3$L AND source = 'review' AND result = 'reopened')
             AND (SELECT payment_due_at IS NULL FROM public.orders WHERE id = %5$L)$$,
         :'a4_claim0', :'a4_claim1', :'a4'::jsonb ->> 'attempt_id', :'a4_released', :'a4o'));
SELECT tests.check('Criterion C (store): no new payment attempt can be opened before the earlier attempt is fully clarified — refused while the reopened review is open',
  format($$SELECT %L LIKE '%%being reviewed%%'$$, :'a4_open1'));
-- the same attempt: resolve again, then the genuine charge verifies → charge_after_resolution, reopened, alerted once
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'a4'::jsonb ->> 'attempt_id', 'portal: still nothing', 'not_charged')) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'a4'::jsonb ->> 'reference', :'pa4g', '0', '0', :'t_b', 'fake-a4-0001', 1000) AS a4_charge \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS a4_claim2 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'a4o', :C4, 'demo')), '') AS a4_open2 \gset
SELECT tests.check('Criterion A + B (store, X-22): a verified charge after a ''not_charged'' decision reopens the review with reason charge_after_resolution, keeps the transaction id, and leaves exactly one claimable alert; a new attempt is refused (C)',
  format($$SELECT %1$L::jsonb ->> 'result' = 'needs_review' AND %1$L::jsonb ->> 'reason' = 'charge_after_resolution'
             AND jsonb_array_length(%2$L::jsonb) = 1 AND pg_temp.claimed(%2$L::jsonb, %3$L) = 1
             AND (SELECT review_reason = 'charge_after_resolution' AND provider_txn_id = 'fake-a4-0001' AND review_resolved_at IS NULL
                         AND review_outcome IS NULL AND NOT applied FROM payments.tenant_attempts WHERE id = %3$L)
             AND (SELECT payment_due_at IS NULL FROM public.orders WHERE id = %4$L)
             AND %5$L <> ''$$,
         :'a4_charge', :'a4_claim2', :'a4'::jsonb ->> 'attempt_id', :'a4o', :'a4_open2'));
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'a4'::jsonb ->> 'attempt_id', 'x', 'not_charged')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'a4o', :B_OWNER)) AS a4_staff,
       pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, %L, NULL)', :SB, :'a4o', :C4)) AS a4_cust \gset
SELECT tests.check('X-25 (R3-4): the order status gives store staff review_outcome and review_resolved_at — never the customer; a verified charge kept on the attempt keeps the order held even after not_charged (X-23)',
  format($$SELECT %1$L::jsonb -> 'attempt' ->> 'review_outcome' = 'not_charged' AND %1$L::jsonb -> 'attempt' ->> 'review_resolved_at' IS NOT NULL
             AND NOT (%2$L::jsonb -> 'attempt' ? 'review_outcome') AND NOT (%2$L::jsonb -> 'attempt' ? 'review_resolved_at')
             AND (%1$L::jsonb ->> 'payment_held')::boolean$$,
         :'a4_staff', :'a4_cust'));

-- A + B + C (platform): resolved → a later payload reopens → a verified charge: charge_after_resolution, one alert,
-- the charge not payable, a second attempt refused, no ledger row (the reviewer's repro9 scenario)
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":4,"description":"חיוב בדיקה 4 (סבב 4)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 4 (סבב 4)') AS ch4 \gset
SELECT pg_temp.h('fake-platform-return|r4-timeout') AS pp4t, pg_temp.h('fake-platform-return|r4-genuine') AS pp4g \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'ch4', NULL, :'pp4t', 'fake-p4r-0000') AS pa4 \gset
SELECT pg_temp.p_fail_verify(:'pa4'::jsonb, :'pp4t', :'t_plat', 1) AS ok \gset
SELECT pg_temp.age_return('platform', :'pa4'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_attempts_expire())') AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_card_payment_resolve(%L, %L, %L))', :PLAT, :'pa4'::jsonb ->> 'attempt_id', 'portal: nothing')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pa4'::jsonb ->> 'reference', :'pp4g', '0', 'fake-p4r-0001', 400)) AS ok \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pa4_claim1 \gset
SELECT pg_temp.p_settle(:'pa4'::jsonb ->> 'reference', :'pp4g', '0', '0', :'t_plat', 'fake-p4r-0001', 400) AS pa4_charge \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pa4_claim2 \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :B_OWNER, :SB, 'ledger_charge', :'ch4', 'demo')), '') AS pa4_open \gset
SELECT pg_temp.call(:SB, :B_OWNER, 'SELECT public.platform_card_my_options()') AS pa4_opts \gset
SELECT tests.check('Criterion A + B + C (platform, X-22, repro9): after the platform admin resolved, a later payload reopens the review (one alert), the verified charge gets charge_after_resolution (one more alert), the charge is not payable and a second attempt is refused — no ledger row',
  format($$SELECT jsonb_array_length(%1$L::jsonb) = 1 AND pg_temp.claimed(%1$L::jsonb, %4$L) = 1
             AND %2$L::jsonb ->> 'reason' = 'charge_after_resolution'
             AND jsonb_array_length(%3$L::jsonb) = 1 AND pg_temp.claimed(%3$L::jsonb, %4$L) = 1
             AND (SELECT review_resolved_at IS NULL AND provider_txn_id = 'fake-p4r-0001' AND NOT applied FROM payments.platform_attempts WHERE id = %4$L)
             AND %5$L LIKE '%%being verified or reviewed%%'
             AND EXISTS (SELECT 1 FROM jsonb_array_elements(%6$L::jsonb -> 'charges') e WHERE e ->> 'id' = %7$L AND NOT (e ->> 'payable')::boolean)
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE provider_ref = 'max:test:fake-p4r-0001')$$,
         :'pa4_claim1', :'pa4_charge', :'pa4_claim2', :'pa4'::jsonb ->> 'attempt_id', :'pa4_open', :'pa4_opts', :'ch4'));

-- B: a late return that confirms a charge alerts exactly once, whatever the attempt's state
-- (parked: its first charge; failed: a decline then an approved retry; expired; cancelled; paid: a second charge)
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS b1o \gset
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS b2o \gset
SELECT pg_temp.order_of(:SB, :C4, :P10, :SHIP_B, 1, 'online') AS b3o \gset
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS b4o \gset
SELECT pg_temp.h('fake-return|r4-b1') AS pb1, pg_temp.h('fake-return|r4-b2-decline') AS pb2d, pg_temp.h('fake-return|r4-b2-ok') AS pb2,
       pg_temp.h('fake-return|r4-b3') AS pb3, pg_temp.h('fake-return|r4-b4') AS pb4, pg_temp.h('fake-return|r4-b4-second') AS pb4s \gset
-- parked (never resolved) — its first verified charge
SELECT pg_temp.t_returned(:SB, :'b1o', :C4, :'pb1', 'fake-b1-0001') AS b1 \gset
SELECT pg_temp.t_fail_verify(:SB, :'b1'::jsonb, :'pb1', 6) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'b1'::jsonb ->> 'reference', :'pb1', '0', '0', :'t_b', 'fake-b1-0001', 1000) AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_parked \gset
-- failed: a VERIFY-confirmed decline, then an approved retry on the same page
SELECT pg_temp.t_returned(:SB, :'b2o', :C4, :'pb2d', 'fake-b2-0000') AS b2 \gset
SELECT pg_temp.t_settle(:SB, :'b2'::jsonb ->> 'reference', :'pb2d', '0', '33', :'t_b', 'fake-b2-0000', 1000) AS ok \gset
SELECT pg_temp.t_ret(:SB, :'b2'::jsonb ->> 'reference', :'pb2', '0', 'fake-b2-0001', 1000) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'b2'::jsonb ->> 'reference', :'pb2', '0', '0', :'t_b', 'fake-b2-0001', 1000) AS b2_paid \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_failed \gset
-- expired: the attempt timed out by the sweep, the late approved return arrives
SELECT pg_temp.t_open(:SB, :'b3o', :C4) AS b3 \gset
SELECT pg_temp.t_sign(:SB, :'b3'::jsonb ->> 'attempt_id') AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_attempts SET created_at = now() - interval '40 minutes', expires_at = now() - interval '1 minute'
 WHERE id = (:'b3'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.t_ret(:SB, :'b3'::jsonb ->> 'reference', :'pb3', '0', 'fake-b3-0001', 1000) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'b3'::jsonb ->> 'reference', :'pb3', '0', '0', :'t_b', 'fake-b3-0001', 1000) AS b3_paid \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_expired \gset
-- cancelled by staff while the payer was on the page, then paid
SELECT pg_temp.t_open(:SB, :'b4o', :C5) AS b4 \gset
SELECT pg_temp.t_sign(:SB, :'b4'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :B_OWNER, :SB, :'b4o')) AS ok \gset
SELECT pg_temp.t_ret(:SB, :'b4'::jsonb ->> 'reference', :'pb4', '0', 'fake-b4-0001', 1000) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'b4'::jsonb ->> 'reference', :'pb4', '0', '0', :'t_b', 'fake-b4-0001', 1000) AS b4_paid \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_cancelled \gset
-- paid: a second, different charge on the same attempt
SELECT pg_temp.t_ret(:SB, :'b4'::jsonb ->> 'reference', :'pb4s', '0', 'fake-b4-0002', 1000) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.t_settle(:SB, :'b4'::jsonb ->> 'reference', :'pb4s', '0', '0', :'t_b', 'fake-b4-0002', 1000) AS b4_second \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_paid \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS b_claim_after \gset
SELECT tests.check('Criterion B (store): every late return that confirms a charge is detected and alerts — exactly one claimable alert row after it, whether the attempt was parked, failed, expired, cancelled or paid',
  format($$SELECT jsonb_array_length(%1$L::jsonb) = 1 AND pg_temp.claimed(%1$L::jsonb, %7$L) = 1
             AND %2$L::jsonb ->> 'result' = 'test_paid' AND jsonb_array_length(%3$L::jsonb) = 1 AND pg_temp.claimed(%3$L::jsonb, %8$L) = 1
             AND %4$L::jsonb ->> 'result' = 'test_paid' AND jsonb_array_length(%5$L::jsonb) = 1 AND pg_temp.claimed(%5$L::jsonb, %9$L) = 1
             AND %6$L::jsonb ->> 'result' = 'test_paid' AND jsonb_array_length(%11$L::jsonb) = 1 AND pg_temp.claimed(%11$L::jsonb, %10$L) = 1
             AND %12$L::jsonb ->> 'result' = 'duplicate_charge' AND jsonb_array_length(%13$L::jsonb) = 1 AND pg_temp.claimed(%13$L::jsonb, %10$L) = 1
             AND %14$L::jsonb = '[]'
             AND (SELECT count(*) FROM payments.tenant_attempts WHERE id IN (%8$L, %9$L, %10$L) AND review_reason IN ('late_paid', 'duplicate_charge')) = 3$$,
         :'b_claim_parked', :'b2_paid', :'b_claim_failed', :'b3_paid', :'b_claim_expired', :'b4_paid',
         :'b1'::jsonb ->> 'attempt_id', :'b2'::jsonb ->> 'attempt_id', :'b3'::jsonb ->> 'attempt_id', :'b4'::jsonb ->> 'attempt_id',
         :'b_claim_cancelled', :'b4_second', :'b_claim_paid', :'b_claim_after'));
-- B (platform): a late charge on an expired attempt, and a second charge on a paid one
SELECT pg_temp.call(NULL, :PLAT, format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, :SB,
         '{"kind":"charge","category":"other","amount":3,"description":"חיוב בדיקה 3 (חיוב מאוחר)"}')) IS NOT NULL AS ok \gset
SELECT (SELECT id FROM billing.ledger WHERE tenant_id = :SB AND description = 'חיוב בדיקה 3 (חיוב מאוחר)') AS ch3 \gset
SELECT pg_temp.h('fake-platform-return|r4-late') AS pp3, pg_temp.h('fake-platform-return|r4-late-2') AS pp3s \gset
SELECT pg_temp.p_returned(:B_OWNER, :SB, :'ch3', NULL, NULL, NULL) AS pb3 \gset
SET session_replication_role = replica;
UPDATE payments.platform_attempts SET created_at = now() - interval '40 minutes', expires_at = now() - interval '1 minute'
 WHERE id = (:'pb3'::jsonb ->> 'attempt_id')::uuid;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_attempts_expire())') AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pb3'::jsonb ->> 'reference', :'pp3', '0', 'fake-pb3-0001', 300)) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.p_settle(:'pb3'::jsonb ->> 'reference', :'pp3', '0', '0', :'t_plat', 'fake-pb3-0001', 300) AS pb3_paid \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pb3_claim1 \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', :'pb3'::jsonb ->> 'reference', :'pp3s', '0', 'fake-pb3-0002', 300)) AS ok \gset
SELECT pg_temp.p_settle(:'pb3'::jsonb ->> 'reference', :'pp3s', '0', '0', :'t_plat', 'fake-pb3-0002', 300) AS pb3_second \gset
SELECT pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)') AS pb3_claim2 \gset
SELECT tests.check('Criterion B (platform): a late charge on an expired platform attempt is applied once and alerted once; a second charge on the paid attempt is alerted once more — one ledger row',
  format($$SELECT %1$L::jsonb ->> 'result' = 'test_paid' AND jsonb_array_length(%2$L::jsonb) = 1 AND pg_temp.claimed(%2$L::jsonb, %5$L) = 1
             AND %3$L::jsonb ->> 'result' = 'duplicate_charge' AND jsonb_array_length(%4$L::jsonb) = 1 AND pg_temp.claimed(%4$L::jsonb, %5$L) = 1
             AND (SELECT count(*) FROM billing.ledger WHERE provider_ref IN ('max:test:fake-pb3-0001', 'max:test:fake-pb3-0002')) = 1$$,
         :'pb3_paid', :'pb3_claim1', :'pb3_second', :'pb3_claim2', :'pb3'::jsonb ->> 'attempt_id'));

-- D / X-23 (R3-1, repro6): a 'charged' decision on attempt Y is never undone by attempt X — not by X's verified decline,
-- not by 'not_charged' on X, not by a payload on X; the order stays held, no new attempt
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS d4o \gset
SELECT pg_temp.t_open(:SB, :'d4o', :C5) AS d4x \gset
SELECT pg_temp.t_sign(:SB, :'d4x'::jsonb ->> 'attempt_id') AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :B_OWNER, :SB, :'d4o')) AS ok \gset
SELECT pg_temp.h('fake-return|r4-d-y') AS pdy, pg_temp.h('fake-return|r4-d-x-decline') AS pdx, pg_temp.h('fake-return|r4-d-x2') AS pdx2 \gset
SELECT pg_temp.t_returned(:SB, :'d4o', :C5, :'pdy', 'fake-d4y-0001') AS d4y \gset
SELECT pg_temp.t_settle(:SB, :'d4y'::jsonb ->> 'reference', :'pdy', '0', '0', :'t_b', 'fake-d4y-0001', 999) AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'d4y'::jsonb ->> 'attempt_id', 'portal: charged', 'charged')) AS ok \gset
SELECT (SELECT review_resolved_at FROM payments.tenant_attempts WHERE id = (:'d4y'::jsonb ->> 'attempt_id')::uuid) AS d4y_resolved_at \gset
SELECT pg_temp.t_ret(:SB, :'d4x'::jsonb ->> 'reference', :'pdx', '33', 'fake-d4x-0000', 1000) AS ok \gset
SELECT pg_temp.t_settle(:SB, :'d4x'::jsonb ->> 'reference', :'pdx', '0', '33', :'t_b', 'fake-d4x-0000', 1000) AS d4x_decline \gset
SELECT (SELECT payment_due_at IS NULL FROM public.orders WHERE id = :'d4o') AS d4_held_after_decline \gset
SELECT pg_temp.t_ret(:SB, :'d4x'::jsonb ->> 'reference', :'pdx2', '0', 'fake-d4x-0002', 1000) AS ok \gset
SELECT pg_temp.age_return('tenant', :'d4x'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))', :B_OWNER, :SB, :'d4x'::jsonb ->> 'attempt_id', 'portal: x not charged', 'not_charged')) AS d4x_resolve \gset
SELECT COALESCE(pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', :SB, :'d4o', :C5, 'demo')), '') AS d4_open \gset
SELECT tests.check('Criterion D (X-23, R3-1 / repro6): a decision on one attempt is never changed by another — the charged attempt''s review_resolved_at / review_outcome stay; X''s verified decline, X''s payload and ''not_charged'' on X never release the order; a new attempt is refused',
  format($$SELECT %1$L::jsonb ->> 'result' = 'not_paid' AND %2$L::boolean AND %3$L::boolean
             AND (SELECT review_outcome = 'charged' AND review_resolved_at = %4$L::timestamptz FROM payments.tenant_attempts WHERE id = %5$L)
             AND (SELECT payment_due_at IS NULL AND status = 'pending' FROM public.orders WHERE id = %6$L)
             AND %7$L LIKE '%%held for the store%%'$$,
         :'d4x_decline', :'d4_held_after_decline', :'d4x_resolve', :'d4y_resolved_at', :'d4y'::jsonb ->> 'attempt_id', :'d4o', :'d4_open'));

-- X-24 (R3-2 / N4, repro7): a failed attempt gets a second payload that is never kept nor verified → parked, alerted once
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS f4o \gset
SELECT pg_temp.h('fake-return|r4-f-decline') AS pfd, pg_temp.h('fake-return|r4-f-second') AS pfs \gset
SELECT pg_temp.t_returned(:SB, :'f4o', :C5, :'pfd', 'fake-f4-0000') AS f4 \gset
SELECT pg_temp.t_settle(:SB, :'f4'::jsonb ->> 'reference', :'pfd', '0', '33', :'t_b', 'fake-f4-0000', 1000) AS ok \gset
SELECT (SELECT payment_due_at IS NOT NULL FROM public.orders WHERE id = :'f4o') AS f4_released \gset
SELECT pg_temp.t_ret(:SB, :'f4'::jsonb ->> 'reference', :'pfs', '0', 'fake-f4-0001', 1000) AS ok \gset
SELECT pg_temp.age_return('tenant', :'f4'::jsonb ->> 'attempt_id', interval '3 hours') AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())') AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS f4_claim1 \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS f4_claim2 \gset
SELECT tests.check('X-24 (R3-2 / N4, repro7): a failed attempt whose later payload was never kept nor verified is parked by the sweep after 90 minutes (verify_exhausted), its order held, alerted exactly once',
  format($$SELECT %1$L::boolean AND pg_temp.claimed(%2$L::jsonb, %4$L) = 1 AND pg_temp.claimed(%3$L::jsonb, %4$L) = 0
             AND (SELECT state = 'needs_review' AND review_reason = 'verify_exhausted' FROM payments.tenant_attempts WHERE id = %4$L)
             AND (SELECT payment_due_at IS NULL FROM public.orders WHERE id = %5$L)$$,
         :'f4_released', :'f4_claim1', :'f4_claim2', :'f4'::jsonb ->> 'attempt_id', :'f4o'));

-- E (backstop): an order held with no review and no 'charged' decision (an injected inconsistency) is parked
-- held_unexplained by the sweep after 90 minutes, and alerted once
SELECT pg_temp.order_of(:SB, :C5, :P10, :SHIP_B, 1, 'online') AS e4o \gset
SELECT pg_temp.h('fake-return|r4-e') AS pe4 \gset
SELECT pg_temp.t_returned(:SB, :'e4o', :C5, :'pe4', 'fake-e4-0000') AS e4 \gset
SELECT pg_temp.t_settle(:SB, :'e4'::jsonb ->> 'reference', :'pe4', '0', '33', :'t_b', 'fake-e4-0000', 1000) AS ok \gset
SET session_replication_role = replica;
UPDATE public.orders SET payment_due_at = NULL WHERE id = :'e4o';
SET session_replication_role = origin;
SELECT pg_temp.age_return('tenant', :'e4'::jsonb ->> 'attempt_id', interval '2 hours') AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS e4_claim1 \gset
SELECT pg_temp.svc('SELECT public.max_review_alerts_claim(200)') AS e4_claim2 \gset
SELECT tests.check('Criterion E (DB backstop): every order that gets held has an alert and a handling route — a held order with no review and no charged decision is parked held_unexplained by the sweep after 90 minutes and claimed exactly once',
  format($$SELECT pg_temp.claimed(%1$L::jsonb, %3$L) = 1 AND pg_temp.claimed(%2$L::jsonb, %3$L) = 0
             AND (SELECT state = 'needs_review' AND review_reason = 'held_unexplained' FROM payments.tenant_attempts WHERE id = %3$L)$$,
         :'e4_claim1', :'e4_claim2', :'e4'::jsonb ->> 'attempt_id'));

-- Criterion E (invariant over every scenario of this file): time passes (every return of this file's stores 2 hours
-- older), the sweep runs — then no held order is left without an unresolved review (alerted or claimable) or a
-- 'charged' decision
SET session_replication_role = replica;
UPDATE payments.tenant_events SET created_at = created_at - interval '2 hours'
 WHERE tenant_id IN (:SA, :SB, :SE, :SF) AND source IN ('return', 'notify');
UPDATE payments.tenant_attempts SET returned_at = returned_at - interval '2 hours'
 WHERE tenant_id IN (:SA, :SB, :SE, :SF) AND returned_at IS NOT NULL;
SET session_replication_role = origin;
SELECT pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())') AS ok \gset
SELECT tests.check('Criterion E (invariant, all scenarios of this file): no held order exists without an unresolved review that is alerted or claimable, or a charged decision',
  format($$SELECT NOT EXISTS (
             SELECT 1 FROM public.orders o
              WHERE o.tenant_id IN (%L, %L, %L, %L) AND o.payment_method = 'online' AND o.status = 'pending'
                AND o.payment_status = 'awaiting' AND o.payment_due_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM payments.tenant_attempts x
                                 WHERE x.order_id = o.id
                                   AND ((x.review_reason IS NOT NULL AND x.review_resolved_at IS NULL)
                                        OR x.review_outcome = 'charged')))
           AND EXISTS (SELECT 1 FROM public.orders o WHERE o.tenant_id = %2$L AND o.payment_method = 'online'
                        AND o.payment_status = 'awaiting' AND o.payment_due_at IS NULL)$$,
         :SA, :SB, :SE, :SF));

-- ============================================================
-- 21. Cleanup: the switches off, the database unmarked (later files see online payments off)
-- ============================================================
SELECT pg_temp.call(NULL, :PLAT, $$SELECT to_jsonb(ARRAY[public.platform_set_flag('max_payments', false),
         public.platform_set_flag('platform_terminal_payments', false)])$$) AS ok \gset
UPDATE payments.environment SET name = NULL, note = 'unmarked again by online-payments.test.sql';
UPDATE public.tenants SET custom_domain = NULL, custom_domain_verified_at = NULL WHERE id = :SB;
SELECT COALESCE(pg_temp.db_err($q$UPDATE payments.environment SET name = 'production'$q$), '') AS final_prod \gset
SELECT tests.check('cleanup: both switches off; the database unmarked (and, having been DEMO, never production)',
  format($$SELECT (SELECT count(*) FROM public.platform_feature_flags WHERE key IN ('max_payments', 'platform_terminal_payments') AND NOT enabled) = 2
             AND (SELECT name IS NULL AND demo_since IS NOT NULL FROM payments.environment) AND %L LIKE '%%can never become production%%'$$,
         :'final_prod'));
DROP TABLE IF EXISTS op_api;
DROP TABLE IF EXISTS op_prod;
DROP TABLE IF EXISTS op_issue;

-- ============================================================
-- Online card payments (migration 208): the independent reviewers' SQL repros and probes, all rounds, kept as
-- permanent tests. Each keeps the reviewer's scenario and asserts the FIXED behaviour; the test name starts with the
-- finding (H1, H2, M1, M3, M4, M5, L2, L3, L4, N1–N4, X-14, R1–R5 of the first reviewer; R2-1 … R3-3 of the second).
-- Sources: the first reviewer's probes.sh / probes2.sh / p10.sql / p10b.sql / probes-fixed.sh / probes3.sh /
-- regress.sql / n4.sh; the second reviewer's probes-r2/repro1 … repro9 (+ 2b, 3b, 8b).
-- Not ported (not database scenarios): amount-drift.sql / amount-drift-paid.sql (Grow orders, before migration 208;
-- the Grow flow is out of scope and unchanged), the vitest probes r2-probes.test.ts and zz-review-probes.test.ts
-- (application code: tick order, platform return order, step-up intent — the app agents' suites).
-- Runs after online-payments.test.sql (file name order): own stores RX / RW, marks the database DEMO for itself and
-- leaves it unmarked with both switches off, as it found it. Fake values only; terminal numbers built at run time.
-- ============================================================
\set PLAT '''a0000000-0000-0000-0000-0000000000f0'''
\set RX '''c2100000-0000-4000-8000-00000000000a'''
\set RW '''c2100000-0000-4000-8000-00000000000d'''
\set OX '''c2100000-0000-4000-8000-0000000000a1'''
\set OW '''c2100000-0000-4000-8000-0000000000d1'''
\set P '''c2100000-0000-4000-8000-00000000b010'''
\set PV '''c2100000-0000-4000-8000-00000000b011'''
\set V1 '''c2100000-0000-4000-8000-00000000f001'''
\set V2 '''c2100000-0000-4000-8000-00000000f002'''
\set SHIP '''c2100000-0000-4000-8000-00000000500a'''
SELECT '00100' || '55551' AS t_x, '00100' || '55552' AS t_p, '00100' || '55553' AS t_x2 \gset

-- ---------- helpers (the reviewers' cpt.* helpers, as pg_temp) ----------
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
BEGIN
  PERFORM pg_temp.svc(_sql);
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLERRM;
END $f$;
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
CREATE OR REPLACE FUNCTION pg_temp.call_err(_site text, _uid uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.call(_site, _uid, _sql);
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN SQLERRM;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.h(_s text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT encode(sha256(convert_to('rr|' || _s, 'UTF8')), 'hex');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.tok(_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'v1:0badc0de:IVfakeIVfakeIV00:TAGfakeTAGfakeTAGfake0:FAKE-' || _label;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.cust(_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$
  SELECT format('c2100000-0000-4000-8000-0000000c%s', lpad(_n::text, 4, '0'))::uuid;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ord(_n integer, _variant uuid DEFAULT NULL, _product uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (pg_temp.call('c2100000-0000-4000-8000-00000000000a', pg_temp.cust(_n), format(
    $q$SELECT to_jsonb(x) FROM public.place_order('order',
         jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('product_id', %L, 'variant_id', %L, 'quantity', 1, 'unit_price', 10))), 18, true,
         jsonb_build_object('customer_name', 'לקוח בדיקת סוקרים', 'customer_tax_id', '123456782', 'customer_phone', '0501234567',
           'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001', 'accepted_terms', true,
           'shipping_method_id', 'c2100000-0000-4000-8000-00000000500a', 'payment_method', 'online')) x$q$,
    COALESCE(_product, 'c2100000-0000-4000-8000-00000000b010'), _variant)) ->> 'id')::uuid;
END $f$;
-- open + SIGN ok for customer n (a new order, or the given one): the attempt + order_id
CREATE OR REPLACE FUNCTION pg_temp.opened(_n integer, _order uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o uuid := COALESCE(_order, pg_temp.ord(_n)); a jsonb;
BEGIN
  a := pg_temp.svc(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', 'c2100000-0000-4000-8000-00000000000a', o, pg_temp.cust(_n), 'demo'));
  PERFORM pg_temp.svc(format('SELECT public.max_attempt_signed(%L, %L, true, NULL)', 'c2100000-0000-4000-8000-00000000000a', a ->> 'attempt_id'));
  RETURN a || jsonb_build_object('order_id', o);
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(_a jsonb, _label text, _ccode text, _txn text, _amount bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_record_return(%L, %L, %L, %L, %L, %L, NULL)', 'c2100000-0000-4000-8000-00000000000a',
    _a ->> 'reference', pg_temp.h(_label), _ccode, _txn, COALESCE(_amount, (_a ->> 'amount_minor')::bigint)));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ret(_n integer, _label text, _txn text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a jsonb := pg_temp.opened(_n);
BEGIN
  PERFORM pg_temp.rec(a, _label, '0', _txn);
  RETURN a;
END $f$;
-- the settle after VERIFY (_verify NULL = VERIFY timed out), with the attempt's own terminal
CREATE OR REPLACE FUNCTION pg_temp.settle(_a jsonb, _label text, _verify text, _ccode text, _txn text, _amount bigint DEFAULT NULL,
  _flags text[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.max_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %L, %s, %L, 1, %L, NULL, NULL, %L, %L)',
    'c2100000-0000-4000-8000-00000000000a', _a ->> 'reference', pg_temp.h(_label), _verify, _ccode, _a ->> 'terminal_number', _txn,
    COALESCE(_amount, (_a ->> 'amount_minor')::bigint), 'ILS', 'A0001', _flags, 'demo'));
$f$;
-- n rounds of: VERIFY lease, then a VERIFY that timed out
CREATE OR REPLACE FUNCTION pg_temp.fail(_a jsonb, _label text, _n integer) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  FOR i IN 1.._n LOOP
    UPDATE payments.tenant_attempts SET verify_lease_until = NULL WHERE id = (_a ->> 'attempt_id')::uuid AND verify_lease_until IS NOT NULL;
    PERFORM pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', 'c2100000-0000-4000-8000-00000000000a', _a ->> 'attempt_id', 'verify'));
    r := pg_temp.settle(_a, _label, NULL, '0', 'fake-rr-timeout');
  END LOOP;
  RETURN r;
END $f$;
-- time travel for one attempt's returns (test-only; triggers off for these UPDATEs only)
CREATE OR REPLACE FUNCTION pg_temp.age(_scope text, _attempt text, _ago interval) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  SET LOCAL session_replication_role = replica;
  IF _scope = 'tenant' THEN
    UPDATE payments.tenant_attempts SET returned_at = returned_at - _ago, created_at = created_at - _ago, expires_at = expires_at - _ago
     WHERE id = _attempt::uuid;
    UPDATE payments.tenant_events SET created_at = created_at - _ago WHERE attempt_id = _attempt::uuid;
    UPDATE payments.tenant_returns SET received_at = received_at - _ago, purge_after = purge_after - _ago WHERE attempt_id = _attempt::uuid;
  ELSE
    UPDATE payments.platform_attempts SET returned_at = returned_at - _ago, created_at = created_at - _ago, expires_at = expires_at - _ago
     WHERE id = _attempt::uuid;
    UPDATE payments.platform_events SET created_at = created_at - _ago WHERE attempt_id = _attempt::uuid;
  END IF;
  SET LOCAL session_replication_role = origin;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.jobs() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.svc('SELECT to_jsonb(public.max_attempts_expire())');
  PERFORM pg_temp.svc('SELECT to_jsonb(public.platform_attempts_expire())');
  PERFORM pg_temp.svc('SELECT to_jsonb(public.platform_payment_returns_purge())');
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.drain() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.max_review_alerts_claim(200)')) > 0 LOOP END LOOP;
  WHILE jsonb_array_length(pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)')) > 0 LOOP END LOOP;
END $f$;
-- claims now (consumes every claimable row) and says how many times this attempt was in it
CREATE OR REPLACE FUNCTION pg_temp.claim_has(_attempt text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::int FROM jsonb_array_elements(pg_temp.svc('SELECT public.max_review_alerts_claim(200)')) e WHERE e ->> 'attempt_id' = _attempt;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.pclaim_has(_attempt text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::int FROM jsonb_array_elements(pg_temp.svc('SELECT public.platform_attempt_review_alerts_claim(200)')) e WHERE e ->> 'attempt_id' = _attempt;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.ostate(_order uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT status || '/' || payment_status || '/' || CASE WHEN payment_due_at IS NULL THEN 'held' ELSE 'due' END
    FROM public.orders WHERE id = _order;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.astate(_a jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT state || '/' || COALESCE(review_reason, 'none') FROM payments.tenant_attempts WHERE id = (_a ->> 'attempt_id')::uuid;
$f$;
CREATE OR REPLACE FUNCTION pg_temp.open_err(_n integer, _order uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', 'c2100000-0000-4000-8000-00000000000a', _order, pg_temp.cust(_n), 'demo'));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.resolve(_a jsonb, _outcome text) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(NULLIF(pg_temp.svc_err(format('SELECT to_jsonb(public.max_review_resolve(%L, %L, %L, %L, %L))',
    'c2100000-0000-4000-8000-0000000000a1', 'c2100000-0000-4000-8000-00000000000a', _a ->> 'attempt_id', 'reviewer repro', _outcome)), ''), 'resolved');
$f$;
CREATE OR REPLACE FUNCTION pg_temp.charge(_amount numeric, _label text, _tenant uuid DEFAULT 'c2100000-0000-4000-8000-00000000000a') RETURNS uuid
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.call(NULL, 'a0000000-0000-0000-0000-0000000000f0', format($q$SELECT public.platform_billing_record_entry(%L, %L)$q$, _tenant,
    jsonb_build_object('kind', 'charge', 'category', 'other', 'amount', _amount, 'description', 'rr ' || _label)));
  RETURN (SELECT id FROM billing.ledger WHERE tenant_id = _tenant AND description = 'rr ' || _label);
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_opened(_charge uuid, _origin text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a jsonb;
BEGIN
  a := pg_temp.svc(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', 'c2100000-0000-4000-8000-0000000000a1',
    'c2100000-0000-4000-8000-00000000000a', 'ledger_charge', _charge, _origin, 'demo'));
  PERFORM pg_temp.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', a ->> 'attempt_id'));
  RETURN a;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_rec(_a jsonb, _label text, _txn text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', _a ->> 'reference',
    pg_temp.h(_label), '0', _txn, (_a ->> 'amount_minor')::bigint));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.p_settle(_a jsonb, _label text, _verify text, _ccode text, _txn text, _flags text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE sql AS $f$
  SELECT pg_temp.svc(format('SELECT public.platform_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %s, %L, 1, %L, NULL, NULL, %L, %L)',
    _a ->> 'reference', pg_temp.h(_label), _verify, _ccode, _a ->> 'terminal_number', _txn, (_a ->> 'amount_minor')::bigint, 'ILS', 'A0002', _flags, 'demo'));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.p_fail(_a jsonb, _label text, _n integer) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  FOR i IN 1.._n LOOP
    UPDATE payments.platform_attempts SET verify_lease_until = NULL WHERE id = (_a ->> 'attempt_id')::uuid AND verify_lease_until IS NOT NULL;
    PERFORM pg_temp.svc(format('SELECT public.platform_attempt_secrets(%L, %L)', _a ->> 'attempt_id', 'verify'));
    r := pg_temp.p_settle(_a, _label, NULL, '0', 'fake-rp-timeout');
  END LOOP;
  RETURN r;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.p_open_err(_charge uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', 'c2100000-0000-4000-8000-0000000000a1',
    'c2100000-0000-4000-8000-00000000000a', 'ledger_charge', _charge, 'demo'));
$f$;
CREATE OR REPLACE FUNCTION pg_temp.payable(_charge uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT (e ->> 'payable') || '/' || (e ->> 'in_review')
    FROM jsonb_array_elements(pg_temp.call('c2100000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-0000000000a1',
                              'SELECT public.platform_card_my_options()') -> 'charges') e WHERE e ->> 'id' = _charge::text;
$f$;

-- ---------- fixtures: store RX (owner, 60 customers, a ₪10 product, a product with two variants), store RW ----------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (:OX, 'rr.x.owner@test.local', now()), (:OW, 'rr.w.owner@test.local', now()) ON CONFLICT DO NOTHING;
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.cust(g), 'rr.c' || g || '@test.local', now() FROM generate_series(1, 60) g ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  (:RX, 'rr-store-x', 'חנות בדיקות סוקרים X', 'rr.x.owner@test.local'),
  (:RW, 'rr-store-w', 'חנות בדיקות סוקרים W', 'rr.w.owner@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  (:RX, :OX, 'rr.x.owner@test.local', 'rr_x_owner', 'admin', true, true),
  (:RW, :OW, 'rr.w.owner@test.local', 'rr_w_owner', 'admin', true, true) ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT :RX, pg_temp.cust(g), 'rr.c' || g || '@test.local', 'rr_c' || g, 'customer', true FROM generate_series(1, 60) g ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, age_confirmed, profile_completed)
SELECT pg_temp.cust(g), :RX, 'לקוח ' || g, true, true FROM generate_series(1, 60) g ON CONFLICT DO NOTHING;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active) VALUES (:SHIP, :RX, 'איסוף (סוקרים)', 'pickup', 0, true)
ON CONFLICT DO NOTHING;
INSERT INTO public.categories (tenant_id, name) VALUES (:RX, 'בדיקות סוקרים') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity) VALUES
  (:P, :RX, '21000010', 'מוצר בדיקות סוקרים', 'בדיקות סוקרים', :OX, 10, 100000),
  (:PV, :RX, '21000011', 'מוצר עם וריאנטים (סוקרים)', 'בדיקות סוקרים', :OX, 10, 100000) ON CONFLICT DO NOTHING;
INSERT INTO public.product_variants (id, tenant_id, product_id, options, sku, price, stock_quantity) VALUES
  (:V1, :RX, :PV, '{"color":"red"}', 'rr-v-red', 10, 50), (:V2, :RX, :PV, '{"color":"blue"}', 'rr-v-blue', 10, 50);
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id = :RX;
UPDATE payments.environment SET name = 'demo', note = 'online-review-repros.test.sql';
SELECT pg_temp.call(NULL, :PLAT, $$SELECT to_jsonb(ARRAY[public.platform_set_flag('max_payments', true),
         public.platform_set_flag('platform_terminal_payments', true)])$$) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RX,
         jsonb_build_object('terminal_number', :'t_x', 'api_key_enc', pg_temp.tok('rx-key'), 'api_password_enc', pg_temp.tok('rx-pass'), 'enabled', true), 'demo')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :RX, '0')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', :PLAT, repeat('r', 64), repeat('s', 64))) AS su \gset
SELECT pg_temp.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', :PLAT, :'su'::jsonb ->> 'challenge_id', repeat('r', 64), repeat('s', 64))) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_save(%L, %L, %L, %L, %L)', :PLAT,
         jsonb_build_object('terminal_number', :'t_p', 'api_key_enc', pg_temp.tok('rp-key'), 'api_password_enc', pg_temp.tok('rp-pass'),
                            'enabled', true, 'force', true), 'demo', :'su'::jsonb ->> 'challenge_id', repeat('r', 64))) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_terminal_verified(%L, true, %L)', :PLAT, '0')) AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT tests.check('reviewer repros: fixtures — store RX with its verified test terminal, NURIEL''s terminal verified, the database DEMO',
  format($$SELECT (SELECT status = 'verified' AND enabled FROM payments.tenant_accounts WHERE tenant_id = %L)
             AND (SELECT status = 'verified' AND enabled AND terminal_number = %L FROM payments.platform_accounts)
             AND payments.env() = 'demo'$$, :RX, :'t_p'));

-- =========================== first reviewer, round 1 (probes.sh, probes2.sh, p10.sql) ===========================
-- H1 / P1: six transient VERIFY failures
SELECT pg_temp.ret(1, 'p1', 'fake-p1-0001') AS p1 \gset
SELECT pg_temp.fail(:'p1'::jsonb, 'p1', 5) AS p1_5 \gset
SELECT pg_temp.fail(:'p1'::jsonb, 'p1', 1) AS p1_6 \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT pg_temp.open_err(1, (:'p1'::jsonb ->> 'order_id')::uuid) AS p1_open \gset
SELECT tests.check('H1 / P1 (first reviewer): after 5 transient VERIFY failures still unverified; the 6th parks it (needs_review verify_exhausted), the order is held through the expiry job, a new attempt is refused',
  format($$SELECT %L::jsonb ->> 'result' = 'unverified' AND %L::jsonb ->> 'reason' = 'verify_exhausted'
             AND pg_temp.astate(%L::jsonb) = 'needs_review/verify_exhausted' AND pg_temp.ostate((%3$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND %L LIKE '%%being reviewed%%'$$, :'p1_5', :'p1_6', :'p1', :'p1_open'));
-- H1 / P1b: Hyp down 90 minutes after 2 failed VERIFYs (no 6th call)
SELECT pg_temp.ret(2, 'p1b', 'fake-p1b-0001') AS p1b \gset
SELECT pg_temp.fail(:'p1b'::jsonb, 'p1b', 2) AS ok \gset
SELECT pg_temp.age('tenant', :'p1b'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT tests.check('H1 / P1b (first reviewer): Hyp down for 90 minutes after 2 failed VERIFYs — the sweep parks the attempt (not expired), the order is held',
  format($$SELECT pg_temp.astate(%1$L::jsonb) = 'needs_review/verify_exhausted' AND pg_temp.ostate((%1$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'$$, :'p1b'));
-- H1 + H2 / P2: the same on NURIEL's terminal
SELECT pg_temp.charge(12, 'p2') AS p2c \gset
SELECT pg_temp.p_opened(:'p2c') AS p2 \gset
SELECT pg_temp.p_rec(:'p2'::jsonb, 'p2', 'fake-p2-0001') AS ok \gset
SELECT pg_temp.p_fail(:'p2'::jsonb, 'p2', 6) AS p2_6 \gset
SELECT pg_temp.p_open_err(:'p2c') AS p2_open, pg_temp.payable(:'p2c') AS p2_payable \gset
SELECT tests.check('H1 + H2 / P2 (first reviewer): six transient failures park the platform attempt; the charge is not payable and a second payment is refused',
  format($$SELECT %L::jsonb ->> 'reason' = 'verify_exhausted' AND %L LIKE '%%being verified or reviewed%%' AND %L = 'false/true'$$,
         :'p2_6', :'p2_open', :'p2_payable'));
-- M1 / P3: the store's terminal changes while a payer is on Hyp's page
SELECT pg_temp.opened(3) AS p3 \gset
SELECT pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RX,
         jsonb_build_object('terminal_number', :'t_x2', 'api_key_enc', pg_temp.tok('rx2-key'), 'api_password_enc', pg_temp.tok('rx2-pass')), 'demo')) AS p3_noforce \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RX,
         jsonb_build_object('terminal_number', :'t_x2', 'api_key_enc', pg_temp.tok('rx2-key'), 'api_password_enc', pg_temp.tok('rx2-pass'), 'force', true), 'demo')) AS ok \gset
SELECT pg_temp.rec(:'p3'::jsonb, 'p3', '0', 'fake-p3-0001') AS ok \gset
SELECT pg_temp.astate(:'p3'::jsonb) AS p3_state, pg_temp.ostate((:'p3'::jsonb ->> 'order_id')::uuid) AS p3_order \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RX,
         jsonb_build_object('terminal_number', :'t_x', 'api_key_enc', pg_temp.tok('rx-key'), 'api_password_enc', pg_temp.tok('rx-pass'), 'force', true), 'demo')) AS ok \gset
SELECT pg_temp.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', :PLAT, :RX, '0')) AS ok \gset
SELECT tests.check('M1 / P3 (first reviewer): a terminal change while a payer is on the payment page needs force; with force the attempt is parked credentials_changed; the later return holds the order',
  format($$SELECT %L LIKE '%%on the payment page%%' AND %L = 'needs_review/credentials_changed' AND %L = 'pending/awaiting/held'$$,
         :'p3_noforce', :'p3_state', :'p3_order'));
-- M4 / P4: a second approved charge on an attempt in review
SELECT pg_temp.ret(4, 'p4a', 'fake-p4-0001') AS p4 \gset
SELECT pg_temp.settle(:'p4'::jsonb, 'p4a', '0', '0', 'fake-p4-0001', (:'p4'::jsonb ->> 'amount_minor')::bigint + 1) AS p4_first \gset
SELECT pg_temp.rec(:'p4'::jsonb, 'p4b', '0', 'fake-p4-0002') AS ok \gset
SELECT pg_temp.settle(:'p4'::jsonb, 'p4b', '0', '0', 'fake-p4-0002') AS p4_second \gset
SELECT tests.check('M4 / P4 (first reviewer): a second, different approved charge on an attempt in review → duplicate_charge; both transaction ids kept',
  format($$SELECT %L::jsonb ->> 'reason' = 'amount_mismatch' AND %L::jsonb ->> 'result' = 'duplicate_charge'
             AND (SELECT review_reason = 'duplicate_charge' AND provider_txn_id = 'fake-p4-0001' AND extra_txn_ids = '{fake-p4-0002}'
                    FROM payments.tenant_attempts WHERE id = (%3$L::jsonb ->> 'attempt_id')::uuid)$$, :'p4_first', :'p4_second', :'p4'));
-- L2 / P5 and R2-5 / repro5 (accepted, documented in db.md: the DB has no list of the platform's base domains; the
-- app restricts return origins to its own allowed set)
SELECT pg_temp.charge(12, 'r2-5') AS r25c \gset
SELECT pg_temp.svc(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', :OX, :RX, 'ledger_charge', :'r25c',
         'https://rr-store-x.attacker.example', 'demo')) AS r25 \gset
SELECT tests.check('L2 / P5 (first reviewer) and R2-5 / repro5 (second reviewer) — accepted, documented: the DB keeps the slug rule (no list of base domains); a foreign host, a path or plain http are still refused',
  format($$SELECT payments.store_origin(%L, 'https://rr-store-x.attacker.example') = 'https://rr-store-x.attacker.example'
             AND %L::jsonb ->> 'return_origin' = 'https://rr-store-x.attacker.example'
             AND pg_temp.svc_err(format('SELECT to_jsonb(payments.store_origin(%%L, %%L))', %1$L, 'https://evil.example')) <> ''$$,
         :RX, :'r25'));
-- L3 / P6 (the database part): a platform return the app recorded makes the charge busy (the app refuses an unsigned
-- return before recording it — X-11, X-18 — the DB cannot see a Sign)
SELECT pg_temp.charge(7, 'p6') AS p6c \gset
SELECT pg_temp.p_opened(:'p6c') AS p6 \gset
SELECT pg_temp.p_rec(:'p6'::jsonb, 'unsigned-forged', NULL) AS ok \gset
SELECT tests.check('L3 / P6 (first reviewer, DB part): a recorded platform return leaves the attempt returned and the charge not payable (busy) — the app refuses unsigned returns before recording them',
  format($$SELECT (SELECT state FROM payments.platform_attempts WHERE id = (%L::jsonb ->> 'attempt_id')::uuid) = 'returned'
             AND payments.platform_target_busy('ledger_charge', %L) AND pg_temp.p_open_err(%2$L) LIKE '%%being verified%%'$$, :'p6', :'p6c'));
-- M3 / P7: a verified approved payment in review holds the order and keeps the stock
SELECT pg_temp.ret(7, 'p7', 'fake-p7-0001') AS p7 \gset
SELECT pg_temp.settle(:'p7'::jsonb, 'p7', '0', '0', 'fake-p7-0001', NULL, '{document}') AS p7_settle \gset
SELECT (SELECT stock_quantity FROM public.global_products WHERE id = :P) AS p7_stock \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT tests.check('M3 / P7 (first reviewer): a verified, approved payment in review (document) holds its order — not cancelled, the stock kept',
  format($$SELECT %L::jsonb ->> 'reason' = 'document_issued' AND pg_temp.ostate((%L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND (SELECT stock_quantity FROM public.global_products WHERE id = %L) = %s$$, :'p7_settle', :'p7', :P, :p7_stock));
-- H2 / P8: a charged platform attempt in review leaves the charge not payable
SELECT pg_temp.charge(9, 'p8') AS p8c \gset
SELECT pg_temp.p_opened(:'p8c') AS p8 \gset
SELECT pg_temp.p_rec(:'p8'::jsonb, 'p8', 'fake-p8-0001') AS ok \gset
SELECT pg_temp.p_settle(:'p8'::jsonb, 'p8', '0', '0', 'fake-p8-0001', '{document}') AS p8_settle \gset
SELECT tests.check('H2 / P8 (first reviewer): a charged platform attempt in review → the charge is not payable, a second payment is refused',
  format($$SELECT %L::jsonb ->> 'reason' = 'document_issued' AND pg_temp.payable(%L) = 'false/true' AND pg_temp.p_open_err(%2$L) LIKE '%%being verified or reviewed%%'$$,
         :'p8_settle', :'p8c'));
-- L4 / P9: an expired guest token
SELECT (pg_temp.svc(format($q$SELECT to_jsonb(x) FROM (SELECT set_config('request.headers', %L, true)) s,
         public.place_guest_order('order', jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 10)),
           jsonb_build_object('customer_name', 'אורח בדיקה', 'customer_tax_id', '123456782', 'customer_email', 'rr.guest@test.local',
             'customer_phone', '0501234567', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1', 'billing_zip', '6100001',
             'accepted_terms', true, 'shipping_method_id', %L, 'payment_method', 'online')) x$q$,
         json_build_object('x-tenant-id', :RX)::text, :P, :SHIP)) ->> 'id') AS p9o \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_order_access_issue(%L, %L, %L))', :RX, :'p9o', pg_temp.h('p9-token'))) AS ok \gset
SET session_replication_role = replica;
UPDATE payments.tenant_order_access SET created_at = now() - interval '30 hours', expires_at = now() - interval '6 hours' WHERE order_id = :'p9o';
SET session_replication_role = origin;
SELECT pg_temp.svc_err(format('SELECT public.max_attempt_open(%L, %L, NULL, %L, %L)', :RX, :'p9o', pg_temp.h('p9-token'), 'demo')) AS p9_open,
       COALESCE(pg_temp.svc(format('SELECT public.max_order_payment_status(%L, %L, NULL, %L)', :RX, :'p9o', pg_temp.h('p9-token')))::text, 'null') AS p9_status \gset
SELECT tests.check('L4 / P9 (first reviewer): an expired guest token opens neither the payment page nor the status view',
  format($$SELECT %L LIKE '%%order not found%%' AND %L = 'null'$$, :'p9_open', :'p9_status'));
-- M5 / P10 (+ p10b control): a variant sold in an online-paid order can be removed; a variant swap is still refused
SELECT pg_temp.ord(10, :V1, :PV) AS p10o \gset
SELECT pg_temp.opened(10, :'p10o') AS p10 \gset
SELECT pg_temp.rec(:'p10'::jsonb, 'p10', '0', 'fake-p10-0001') AS ok \gset
SELECT pg_temp.settle(:'p10'::jsonb, 'p10', '0', '0', 'fake-p10-0001') AS p10_settle \gset
SELECT (SELECT total FROM public.orders WHERE id = :'p10o') AS p10_total \gset
SELECT pg_temp.call_err(:RX, :OX, format('WITH u AS (UPDATE public.order_items SET variant_id = %L WHERE order_id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM u', :V2, :'p10o')) AS p10_swap \gset
SELECT pg_temp.call(:RX, :OX, format('SELECT to_jsonb(public.save_product_variants(%L, %L, %L))', :PV, '[]', '[]')) IS NOT NULL AS p10_saved \gset
SELECT tests.check('M5 / P10 + p10b (first reviewer): the store owner removes a variant sold in an online-paid order; the paid line keeps its amount with the variant cleared',
  format($$SELECT %L::jsonb ->> 'result' = 'test_paid' AND %L::boolean
             AND NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id IN (%L, %L))
             AND (SELECT bool_and(variant_id IS NULL) FROM public.order_items WHERE order_id = %L)
             AND (SELECT total FROM public.orders WHERE id = %5$L) = %L::numeric$$,
         :'p10_settle', :'p10_saved', :V1, :V2, :'p10o', :'p10_total'));
SELECT tests.check('M5 / P10 (first reviewer): changing the line of an online-paid order to another variant is still refused',
  format($$SELECT %L LIKE '%%locked%%'$$, :'p10_swap'));

-- =========================== first reviewer, round 3 (probes3.sh, n4.sh, regress.sql) ===========================
-- N1: one alert per review reason, never per retry / tick
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(11, 'n1-park', 'fake-n1-0000') AS n1p \gset
SELECT pg_temp.fail(:'n1p'::jsonb, 'n1-park', 6) AS ok \gset
SELECT pg_temp.claim_has(:'n1p'::jsonb ->> 'attempt_id') AS n1_c1 \gset
SELECT pg_temp.fail(:'n1p'::jsonb, 'n1-park', 1) AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.claim_has(:'n1p'::jsonb ->> 'attempt_id') AS n1_c2 \gset
SELECT pg_temp.ret(12, 'n1a', 'fake-n1-0001') AS n1 \gset
SELECT pg_temp.settle(:'n1'::jsonb, 'n1a', '0', '0', 'fake-n1-0001', (:'n1'::jsonb ->> 'amount_minor')::bigint + 1) AS ok \gset
SELECT pg_temp.claim_has(:'n1'::jsonb ->> 'attempt_id') AS n1_c3, pg_temp.claim_has(:'n1'::jsonb ->> 'attempt_id') AS n1_c4 \gset
SELECT pg_temp.rec(:'n1'::jsonb, 'n1b', '0', 'fake-n1-0002') AS ok \gset
SELECT pg_temp.settle(:'n1'::jsonb, 'n1b', '0', '0', 'fake-n1-0002') AS ok \gset
SELECT pg_temp.claim_has(:'n1'::jsonb ->> 'attempt_id') AS n1_c5, pg_temp.claim_has(:'n1'::jsonb ->> 'attempt_id') AS n1_c6 \gset
SELECT tests.check('N1 (first reviewer): a parked attempt is alerted once — a later retry, the sweep and the purge do not re-arm it; amount_mismatch once, then a second charge (duplicate_charge) exactly once more',
  format($$SELECT %s = 1 AND %s = 0 AND %s = 1 AND %s = 0 AND %s = 1 AND %s = 0$$, :n1_c1, :n1_c2, :n1_c3, :n1_c4, :n1_c5, :n1_c6));
-- X-14: held from the first recorded return; a VERIFY-confirmed decline releases
SELECT pg_temp.ret(13, 'x14', 'fake-x14-0001') AS x14 \gset
SELECT pg_temp.ostate((:'x14'::jsonb ->> 'order_id')::uuid) AS x14_before \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT pg_temp.settle(:'x14'::jsonb, 'x14', '0', '33', 'fake-x14-0001') AS ok \gset
SELECT pg_temp.astate(:'x14'::jsonb) AS x14_state, pg_temp.ostate((:'x14'::jsonb ->> 'order_id')::uuid) AS x14_after,
       pg_temp.open_err(13, (:'x14'::jsonb ->> 'order_id')::uuid) AS x14_open \gset
SELECT tests.check('X-14 (first reviewer, round 3): the order is held right after the first recorded return and through the expiry tick; a VERIFY-confirmed decline fails the attempt and releases the order; the customer can try again',
  format($$SELECT %L = 'pending/awaiting/held' AND %L = 'failed/none' AND %L = 'pending/awaiting/due' AND %L = ''$$,
         :'x14_before', :'x14_state', :'x14_after', :'x14_open'));
-- N2 / N3: one forged return that VERIFY rejects
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(14, 'forged', 'fake-forged-1') AS n2 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :RX, :'n2'::jsonb ->> 'attempt_id', pg_temp.h('forged'), pg_temp.tok('raw-forged'))) AS ok \gset
SELECT pg_temp.settle(:'n2'::jsonb, 'forged', '902', '0', 'fake-forged-1') AS ok \gset
SELECT pg_temp.ostate((:'n2'::jsonb ->> 'order_id')::uuid) || '/' || pg_temp.astate(:'n2'::jsonb) AS n2_before \gset
SELECT pg_temp.age('tenant', :'n2'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.astate(:'n2'::jsonb) AS n2_parked, pg_temp.claim_has(:'n2'::jsonb ->> 'attempt_id') AS n2_c1,
       pg_temp.claim_has(:'n2'::jsonb ->> 'attempt_id') AS n2_c2 \gset
SELECT pg_temp.resolve(:'n2'::jsonb, NULL) AS n3_no_outcome \gset
SELECT pg_temp.resolve(:'n2'::jsonb, 'not_charged') AS n3_resolve \gset
SELECT pg_temp.ostate((:'n2'::jsonb ->> 'order_id')::uuid) AS n3_order, pg_temp.open_err(14, (:'n2'::jsonb ->> 'order_id')::uuid) AS n3_open \gset
SELECT tests.check('N2 / N3 (first reviewer): a forged return VERIFY rejected holds the order; after 90 minutes it is parked and alerted once; resolving without an outcome is refused; not_charged releases it and it is payable again',
  format($$SELECT %L = 'pending/awaiting/held/returned/none' AND %L = 'needs_review/verify_exhausted' AND %s = 1 AND %s = 0
             AND %L LIKE '%%resolve with an outcome%%' AND %L = 'resolved' AND %L = 'pending/awaiting/due' AND %L = ''$$,
         :'n2_before', :'n2_parked', :n2_c1, :n2_c2, :'n3_no_outcome', :'n3_resolve', :'n3_order', :'n3_open'));
-- N3b: resolve charged → held for good
SELECT pg_temp.resolve(:'p7'::jsonb, 'charged') AS n3b_resolve \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT tests.check('N3b (first reviewer): resolved charged, P7''s order stays held for good — never expired, a new attempt refused',
  format($$SELECT %L = 'resolved' AND pg_temp.ostate((%L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.open_err(7, (%2$L::jsonb ->> 'order_id')::uuid) LIKE '%%held for the store%%'$$, :'n3b_resolve', :'p7'));
-- N2c: a forged return on an already FAILED attempt (the genuine decline confirmed first)
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.rec(:'x14'::jsonb, 'forged-on-failed', '0', 'fake-ff-1') AS ok \gset
SELECT pg_temp.ostate((:'x14'::jsonb ->> 'order_id')::uuid) AS n2c_held, payments.tenant_order_busy((:'x14'::jsonb ->> 'order_id')::uuid) AS n2c_busy \gset
SELECT pg_temp.age('tenant', :'x14'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT tests.check('N2c (first reviewer): a forged return on an already failed attempt holds the order and keeps it busy; after 90 minutes the attempt is parked and alerted exactly once (X-24)',
  format($$SELECT %L = 'pending/awaiting/held' AND %L::boolean AND pg_temp.astate(%L::jsonb) = 'needs_review/verify_exhausted'
             AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 1 AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 0$$,
         :'n2c_held', :'n2c_busy', :'x14'));
-- H1-late: a late return on an expired attempt — approved → paid (and alerted once: late_paid); a staff-cancelled
-- attempt whose late return timed out → parked after 90 minutes, held, alerted once
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.opened(15) AS hl \gset
SELECT pg_temp.age('tenant', :'hl'::jsonb ->> 'attempt_id', interval '40 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT (SELECT state FROM payments.tenant_attempts WHERE id = (:'hl'::jsonb ->> 'attempt_id')::uuid) AS hl_expired \gset
SELECT pg_temp.rec(:'hl'::jsonb, 'late', '0', 'fake-late-1') AS ok \gset
SELECT pg_temp.ostate((:'hl'::jsonb ->> 'order_id')::uuid) AS hl_held \gset
SELECT pg_temp.settle(:'hl'::jsonb, 'late', '0', '0', 'fake-late-1') AS hl_paid \gset
SELECT pg_temp.claim_has(:'hl'::jsonb ->> 'attempt_id') AS hl_claim \gset
SELECT pg_temp.opened(16) AS hc \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :OX, :RX, :'hc'::jsonb ->> 'order_id')) AS ok \gset
SELECT pg_temp.rec(:'hc'::jsonb, 'late-c', '0', 'fake-late-2') AS ok \gset
SELECT pg_temp.settle(:'hc'::jsonb, 'late-c', NULL, '0', 'fake-late-2') AS ok \gset
SELECT pg_temp.age('tenant', :'hc'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT tests.check('H1-late (first reviewer): an approved late return on an expired attempt holds, then pays the still-awaiting order (alerted once, late_paid); a staff-cancelled attempt whose late return timed out is parked, its order held, alerted once',
  format($$SELECT %L = 'expired' AND %L = 'pending/awaiting/held' AND %L::jsonb ->> 'result' = 'test_paid' AND %s = 1
             AND pg_temp.astate(%L::jsonb) = 'needs_review/verify_exhausted' AND pg_temp.ostate((%5$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.claim_has(%5$L::jsonb ->> 'attempt_id') = 1$$,
         :'hl_expired', :'hl_held', :'hl_paid', :hl_claim, :'hc'));
-- H2-late: a late unverified platform return on an expired attempt keeps the charge unpayable
SELECT pg_temp.charge(8, 'h2-late') AS h2lc \gset
SELECT pg_temp.p_opened(:'h2lc') AS h2l \gset
SELECT pg_temp.age('platform', :'h2l'::jsonb ->> 'attempt_id', interval '40 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.p_rec(:'h2l'::jsonb, 'p-late', 'fake-pl-1') AS ok \gset
SELECT pg_temp.p_settle(:'h2l'::jsonb, 'p-late', NULL, '0', 'fake-pl-1') AS ok \gset
SELECT tests.check('H2-late (first reviewer): a late unverified return on an expired platform attempt — the charge is not payable (in review / being verified) and a new attempt is refused',
  format($$SELECT pg_temp.payable(%1$L) = 'false/true' AND pg_temp.p_open_err(%1$L) LIKE '%%being verified or reviewed%%'$$, :'h2lc'));
-- N4 (n4.sh): a confirmed decline, then an approved return that could not be verified (raw kept, and not kept)
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(17, 'dec-yes', 'fake-dec-yes') AS n4a \gset
SELECT pg_temp.ret(18, 'dec-no', 'fake-dec-no') AS n4b \gset
SELECT pg_temp.settle(:'n4a'::jsonb, 'dec-yes', '0', '33', 'fake-dec-yes') AS ok \gset
SELECT pg_temp.settle(:'n4b'::jsonb, 'dec-no', '0', '33', 'fake-dec-no') AS ok \gset
SELECT pg_temp.rec(:'n4a'::jsonb, 'appr-yes', '0', 'fake-appr-yes') AS ok \gset
SELECT pg_temp.rec(:'n4b'::jsonb, 'appr-no', '0', 'fake-appr-no') AS ok \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_return_keep(%L, %L, %L, %L))', :RX, :'n4a'::jsonb ->> 'attempt_id', pg_temp.h('appr-yes'), pg_temp.tok('raw-yes'))) AS ok \gset
SELECT pg_temp.settle(:'n4a'::jsonb, 'appr-yes', NULL, '0', 'fake-appr-yes') AS ok \gset
SELECT pg_temp.settle(:'n4b'::jsonb, 'appr-no', NULL, '0', 'fake-appr-no') AS ok \gset
SELECT pg_temp.age('tenant', :'n4a'::jsonb ->> 'attempt_id', interval '3 hours') AS ok \gset
SELECT pg_temp.age('tenant', :'n4b'::jsonb ->> 'attempt_id', interval '3 hours') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT to_jsonb(public.expire_unpaid_orders()) AS ok \gset
SELECT tests.check('N4 (first reviewer, n4.sh): a confirmed decline, then an approved return that could not be verified — kept or not, 3 hours later the attempt is parked, the order held, alerted exactly once',
  format($$SELECT pg_temp.astate(%1$L::jsonb) = 'needs_review/verify_exhausted' AND pg_temp.astate(%2$L::jsonb) = 'needs_review/verify_exhausted'
             AND pg_temp.ostate((%1$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.ostate((%2$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.svc('SELECT public.max_review_alerts_claim(200)')) e
                   WHERE e ->> 'attempt_id' IN (%1$L::jsonb ->> 'attempt_id', %2$L::jsonb ->> 'attempt_id')) = 2$$,
         :'n4a', :'n4b'));
-- regress.sql R1: no real-charge path on this DEMO database
SELECT pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RW, jsonb_build_object('mode', 'live', 'terminal_number', '00100' || '66661'), 'demo')) AS r1a,
       pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RW, jsonb_build_object('terminal_number', '70000' || '66662'), 'demo')) AS r1b,
       pg_temp.svc_err(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', :PLAT, :RW, jsonb_build_object('enabled', false), 'production')) AS r1c \gset
SELECT tests.check('R1 (first reviewer, regress.sql): the DEMO database refuses a live terminal, a non-00100 terminal and a production app; both ₪50 CHECKs exist; the production marker is refused',
  format($$SELECT %L LIKE '%%only test terminals%%' AND %L LIKE '%%only test terminals%%' AND %L LIKE '%%environments differ%%'
             AND (SELECT count(*) FROM pg_constraint WHERE conname IN ('tenant_attempts_test_cap', 'platform_attempts_test_cap')) = 2$$,
         :'r1a', :'r1b', :'r1c'));
DO $$ BEGIN
  UPDATE payments.environment SET name = 'production';
  RAISE EXCEPTION 'R1: production marker NOT refused';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
-- regress.sql R2 / R3 / R4: scope separation, store A/B, a payload that never arrived
SELECT pg_temp.svc(format('SELECT public.max_attempt_record_return(%L, %L, %L, %L, NULL, NULL, NULL)', :RX, :'p2'::jsonb ->> 'reference', pg_temp.h('r2-a'), '0')) AS r2a,
       pg_temp.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, NULL, NULL, NULL)', :'p1'::jsonb ->> 'reference', pg_temp.h('r2-b'), '0')) AS r2b,
       pg_temp.svc(format('SELECT public.platform_attempt_mark_paid(%L, %L, %L, %L, %L, %L, 100, %L, 1, NULL, NULL, NULL, %L, %L)', :'p1'::jsonb ->> 'reference', pg_temp.h('r2-b'), '0', '0', :'t_p', 'fake-r2', 'ILS', '{}', 'demo')) AS r2c,
       pg_temp.svc(format('SELECT public.max_attempt_record_return(%L, %L, %L, %L, NULL, NULL, NULL)', :RW, :'p1'::jsonb ->> 'reference', pg_temp.h('r3'), '0')) AS r3a,
       pg_temp.svc(format('SELECT public.max_attempt_mark_paid(%L, %L, %L, %L, %L, %L, %L, 100, %L, 1, NULL, NULL, NULL, %L, %L)', :RW, :'p1'::jsonb ->> 'reference', pg_temp.h('r3'), '0', '0', :'t_x', 'fake-r3', 'ILS', '{}', 'demo')) AS r3b,
       pg_temp.settle(:'p4'::jsonb, 'never-arrived', '0', '0', 'fake-r4') AS r4 \gset
SELECT tests.check('R2 / R3 / R4 (first reviewer, regress.sql): a platform reference on the store route, a store reference on the platform route and settle, store X''s reference on store W''s host or settled as W → unknown; a payload that never arrived → unknown_payload',
  format($$SELECT %L::jsonb ->> 'result' = 'unknown' AND %L::jsonb ->> 'result' = 'unknown' AND %L::jsonb ->> 'result' = 'unknown'
             AND %L::jsonb ->> 'result' = 'unknown' AND %L::jsonb ->> 'result' = 'unknown' AND %L::jsonb ->> 'result' = 'unknown_payload'$$,
         :'r2a', :'r2b', :'r2c', :'r3a', :'r3b', :'r4'));
-- regress.sql R5: the payer rule and the grants
SELECT pg_temp.charge(6, 'r5') AS r5c \gset
SELECT pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :PLAT, :RX, 'ledger_charge', :'r5c', 'demo')) AS r5a,
       pg_temp.svc_err(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, NULL, %L)', :OW, :RX, 'ledger_charge', :'r5c', 'demo')) AS r5b \gset
SELECT tests.check('R5 (first reviewer, regress.sql): a platform admin and another store''s owner cannot pay NURIEL; authenticated has no EXECUTE on an _actor function or platform_terminal_save; anon none on the settle',
  format($$SELECT %L LIKE '%%only the owner%%' AND %L LIKE '%%only the owner%%'
             AND NOT has_function_privilege('authenticated', 'public.platform_attempt_open(uuid,uuid,text,uuid,text,text)', 'EXECUTE')
             AND NOT has_function_privilege('authenticated', 'public.platform_terminal_save(uuid,jsonb,text,uuid,text)', 'EXECUTE')
             AND NOT has_function_privilege('anon', 'public.max_attempt_mark_paid(uuid,text,text,text,text,text,text,bigint,text,integer,text,text,text,text[],text)', 'EXECUTE')$$,
         :'r5a', :'r5b'));

-- =========================== second reviewer (probes-r2: repro1 … repro9) ===========================
-- R2-1 / repro1: staff cancels while the payer is on the page; the late return's VERIFY times out
SELECT pg_temp.opened(21) AS r21 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :OX, :RX, :'r21'::jsonb ->> 'order_id')) AS ok \gset
SELECT pg_temp.rec(:'r21'::jsonb, 'ret-1', '0', 'fake-txn-1') AS ok \gset
SELECT pg_temp.fail(:'r21'::jsonb, 'ret-1', 1) AS ok \gset
SELECT pg_temp.open_err(21, (:'r21'::jsonb ->> 'order_id')::uuid) AS r21_open \gset
SELECT pg_temp.settle(:'r21'::jsonb, 'ret-1', '0', '0', 'fake-txn-1') AS r21_late \gset
SELECT tests.check('R2-1 / repro1 (second reviewer): a second attempt is refused while the late return of a cancelled attempt is unverified; the late VERIFY then pays the order once — one attempt, no second charge',
  format($$SELECT %L LIKE '%%being verified%%' AND %L::jsonb ->> 'result' = 'test_paid'
             AND (SELECT count(*) FROM payments.tenant_attempts WHERE order_id = (%3$L::jsonb ->> 'order_id')::uuid) = 1
             AND (SELECT payment_status = 'paid' FROM public.orders WHERE id = (%3$L::jsonb ->> 'order_id')::uuid)$$,
         :'r21_open', :'r21_late', :'r21'));
-- R2-2 / repro2 + repro2b: the return held the order, the payment jobs never ran, time passed
SELECT (SELECT stock_quantity FROM public.global_products WHERE id = :P) AS r22_stock \gset
SELECT pg_temp.ret(22, 'r2-ret', 'fake-txn-r2') AS r22 \gset
SELECT pg_temp.fail(:'r22'::jsonb, 'r2-ret', 1) AS ok \gset
SET session_replication_role = replica;
UPDATE public.orders SET created_at = now() - interval '20 hours' WHERE id = (:'r22'::jsonb ->> 'order_id')::uuid;
SET session_replication_role = origin;
SELECT to_jsonb(public.expire_unpaid_orders()) AS r22_expired \gset
SELECT pg_temp.opened(23) AS r22b \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :OX, :RX, :'r22b'::jsonb ->> 'order_id')) AS ok \gset
SELECT pg_temp.rec(:'r22b'::jsonb, 'r2b-2', '0', 'fake-r2b-2') AS ok \gset
SELECT tests.check('R2-2 / repro2 + repro2b (second reviewer): a recorded return holds the order in the database — with no payment job and time passing, expire_unpaid_orders cancels nothing, the stock stays reserved; a late return on a cancelled attempt holds too',
  format($$SELECT %s = 0 AND pg_temp.ostate((%L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND (SELECT stock_quantity FROM public.global_products WHERE id = %L) = %s - 2
             AND pg_temp.ostate((%L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'$$,
         :r22_expired, :'r22', :P, :r22_stock, :'r22b'));
-- R2-3 / repro3 + repro3b: one forged return VERIFY rejects
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(24, 'forged-r2', 'fake-forged') AS r23 \gset
SELECT pg_temp.settle(:'r23'::jsonb, 'forged-r2', '902', '0', 'fake-forged') AS ok \gset
SELECT pg_temp.age('tenant', :'r23'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.astate(:'r23'::jsonb) AS r23_state, pg_temp.open_err(24, (:'r23'::jsonb ->> 'order_id')::uuid) AS r23_open,
       pg_temp.claim_has(:'r23'::jsonb ->> 'attempt_id') AS r23_c1, pg_temp.claim_has(:'r23'::jsonb ->> 'attempt_id') AS r23_c2 \gset
SELECT pg_temp.resolve(:'r23'::jsonb, 'not_charged') AS ok \gset
SELECT tests.check('R2-3 / repro3 + repro3b (second reviewer): a forged return pins the order only until a person decides — parked after 90 minutes, a new attempt refused, alerted exactly once; not_charged releases it',
  format($$SELECT %L = 'needs_review/verify_exhausted' AND %L LIKE '%%being reviewed%%' AND %s = 1 AND %s = 0
             AND pg_temp.ostate((%L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/due'$$,
         :'r23_state', :'r23_open', :r23_c1, :r23_c2, :'r23'));
-- R3-1 / repro6: a 'charged' decision is not undone by another attempt's decline or 'not_charged'
SELECT pg_temp.opened(26) AS r31a \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.max_attempt_cancel(%L, %L, %L))', :OX, :RX, :'r31a'::jsonb ->> 'order_id')) AS ok \gset
SELECT pg_temp.opened(26, (:'r31a'::jsonb ->> 'order_id')::uuid) AS r31b \gset
SELECT pg_temp.rec(:'r31b'::jsonb, 'r6-a1', '0', 'fake-r6-1', (:'r31b'::jsonb ->> 'amount_minor')::bigint - 1) AS ok \gset
SELECT pg_temp.settle(:'r31b'::jsonb, 'r6-a1', '0', '0', 'fake-r6-1', (:'r31b'::jsonb ->> 'amount_minor')::bigint - 1) AS ok \gset
SELECT pg_temp.resolve(:'r31b'::jsonb, 'charged') AS r31_charged \gset
SELECT pg_temp.rec(:'r31a'::jsonb, 'r6-a0-decline', '33', 'fake-r6-0') AS ok \gset
SELECT pg_temp.settle(:'r31a'::jsonb, 'r6-a0-decline', '0', '33', 'fake-r6-0') AS r31_decline \gset
SELECT pg_temp.ostate((:'r31a'::jsonb ->> 'order_id')::uuid) AS r31_order1, pg_temp.open_err(26, (:'r31a'::jsonb ->> 'order_id')::uuid) AS r31_open1 \gset
SELECT tests.check('R3-1 / repro6 (second reviewer): a ''charged'' decision stays final — another attempt''s VERIFY-confirmed decline does not release the order, and attempt #3 is refused',
  format($$SELECT %L = 'resolved' AND %L::jsonb ->> 'result' = 'not_paid' AND %L = 'pending/awaiting/held' AND %L LIKE '%%held for the store%%'
             AND (SELECT review_outcome = 'charged' FROM payments.tenant_attempts WHERE id = (%L::jsonb ->> 'attempt_id')::uuid)$$,
         :'r31_charged', :'r31_decline', :'r31_order1', :'r31_open1', :'r31b'));
-- R3-2 / repro7: a failed attempt's second payload, never kept nor verified
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(27, 'r7-decline', 'fake-r7-0') AS r32 \gset
SELECT pg_temp.settle(:'r32'::jsonb, 'r7-decline', '0', '33', 'fake-r7-0') AS ok \gset
SELECT pg_temp.ostate((:'r32'::jsonb ->> 'order_id')::uuid) AS r32_released \gset
SELECT pg_temp.rec(:'r32'::jsonb, 'r7-second', '0', 'fake-r7-1') AS ok \gset
SELECT pg_temp.age('tenant', :'r32'::jsonb ->> 'attempt_id', interval '3 hours') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT tests.check('R3-2 / repro7 (second reviewer, = N4): a failed attempt''s later payload (not kept, not verified) → parked after 90 minutes, the order held, claimable exactly once',
  format($$SELECT %L = 'pending/awaiting/due' AND pg_temp.astate(%L::jsonb) = 'needs_review/verify_exhausted'
             AND pg_temp.ostate((%2$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.claim_has(%2$L::jsonb ->> 'attempt_id') = 1 AND pg_temp.claim_has(%2$L::jsonb ->> 'attempt_id') = 0$$,
         :'r32_released', :'r32'));
-- R3-3 / repro8 (the realistic variant): parked by 6 VERIFY timeouts, resolved not_charged, the genuine payload arrives
-- but can never be verified (exhausted)
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(28, 'r8-timeout', 'fake-r8') AS r33 \gset
SELECT pg_temp.fail(:'r33'::jsonb, 'r8-timeout', 6) AS ok \gset
SELECT pg_temp.claim_has(:'r33'::jsonb ->> 'attempt_id') AS r33_c0 \gset
SELECT pg_temp.resolve(:'r33'::jsonb, 'not_charged') AS ok \gset
SELECT pg_temp.rec(:'r33'::jsonb, 'r8-genuine', '0', 'fake-r8-real') AS ok \gset
SELECT pg_temp.svc(format('SELECT public.max_attempt_secrets(%L, %L, %L)', :RX, :'r33'::jsonb ->> 'attempt_id', 'verify')) AS r33_lease \gset
SELECT tests.check('R3-3 / repro8 (second reviewer): parked by 6 VERIFY timeouts and resolved not_charged — the genuine payload (never verifiable: exhausted) reopens the review: unresolved, the order held, alerted again exactly once',
  format($$SELECT %s = 1 AND %L::jsonb ->> 'result' = 'exhausted'
             AND (SELECT review_resolved_at IS NULL AND review_outcome IS NULL AND state = 'needs_review' FROM payments.tenant_attempts WHERE id = (%L::jsonb ->> 'attempt_id')::uuid)
             AND pg_temp.ostate((%3$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 1 AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 0
             AND pg_temp.open_err(28, (%3$L::jsonb ->> 'order_id')::uuid) LIKE '%%being reviewed%%'$$,
         :r33_c0, :'r33_lease', :'r33'));
-- R3-3 / repro8b: one timeout, parked by the sweep, resolved not_charged, the genuine charge VERIFY confirms
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.ret(29, 'r8b-timeout', 'fake-r8b') AS r34 \gset
SELECT pg_temp.fail(:'r34'::jsonb, 'r8b-timeout', 1) AS ok \gset
SELECT pg_temp.age('tenant', :'r34'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.claim_has(:'r34'::jsonb ->> 'attempt_id') AS r34_c0 \gset
SELECT pg_temp.resolve(:'r34'::jsonb, 'not_charged') AS ok \gset
SELECT pg_temp.rec(:'r34'::jsonb, 'r8b-genuine', '0', 'fake-r8b-real') AS ok \gset
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.settle(:'r34'::jsonb, 'r8b-genuine', '0', '0', 'fake-r8b-real') AS r34_settle \gset
SELECT tests.check('R3-3 / repro8b (second reviewer): after a not_charged decision the genuine charge VERIFY confirms → charge_after_resolution, the charge kept, the review unresolved, the order held, alerted exactly once',
  format($$SELECT %s = 1 AND %L::jsonb ->> 'reason' = 'charge_after_resolution'
             AND (SELECT provider_txn_id = 'fake-r8b-real' AND review_resolved_at IS NULL AND review_outcome IS NULL FROM payments.tenant_attempts WHERE id = (%L::jsonb ->> 'attempt_id')::uuid)
             AND pg_temp.ostate((%3$L::jsonb ->> 'order_id')::uuid) = 'pending/awaiting/held'
             AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 1 AND pg_temp.claim_has(%3$L::jsonb ->> 'attempt_id') = 0$$,
         :r34_c0, :'r34_settle', :'r34'));
-- R3-3 / repro9 (platform): resolved, then the genuine charge on the same attempt; the owner tries to pay again
SELECT pg_temp.drain() AS ok \gset
SELECT pg_temp.charge(15, 'r9') AS r9c \gset
SELECT pg_temp.p_opened(:'r9c') AS r9 \gset
SELECT pg_temp.p_rec(:'r9'::jsonb, 'r9-timeout', 'fake-r9') AS ok \gset
SELECT pg_temp.p_fail(:'r9'::jsonb, 'r9-timeout', 1) AS ok \gset
SELECT pg_temp.age('platform', :'r9'::jsonb ->> 'attempt_id', interval '95 minutes') AS ok \gset
SELECT pg_temp.jobs() AS ok \gset
SELECT pg_temp.pclaim_has(:'r9'::jsonb ->> 'attempt_id') AS r9_c0 \gset
SELECT pg_temp.svc(format('SELECT to_jsonb(public.platform_card_payment_resolve(%L, %L, %L))', :PLAT, :'r9'::jsonb ->> 'attempt_id', 'nothing in portal')) AS ok \gset
SELECT pg_temp.p_rec(:'r9'::jsonb, 'r9-genuine', 'fake-r9-real') AS ok \gset
SELECT pg_temp.p_settle(:'r9'::jsonb, 'r9-genuine', '0', '0', 'fake-r9-real') AS r9_settle \gset
SELECT pg_temp.pclaim_has(:'r9'::jsonb ->> 'attempt_id') AS r9_c1, pg_temp.pclaim_has(:'r9'::jsonb ->> 'attempt_id') AS r9_c2 \gset
SELECT tests.check('R3-3 / repro9 (second reviewer, platform): after the resolution the genuine charge reopens the review (charge_after_resolution), one claimable alert, the charge busy, a second attempt refused, no ledger row',
  format($$SELECT %s = 1 AND %L::jsonb ->> 'reason' = 'charge_after_resolution' AND %s = 1 AND %s = 0
             AND payments.platform_target_busy('ledger_charge', %L) AND pg_temp.p_open_err(%5$L) LIKE '%%being verified or reviewed%%'
             AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE provider_ref = 'max:test:fake-r9-real')$$,
         :r9_c0, :'r9_settle', :r9_c1, :r9_c2, :'r9c'));

-- ---------- cleanup: the switches off, the database unmarked (as found) ----------
SELECT pg_temp.call(NULL, :PLAT, $$SELECT to_jsonb(ARRAY[public.platform_set_flag('max_payments', false),
         public.platform_set_flag('platform_terminal_payments', false)])$$) AS ok \gset
UPDATE payments.environment SET name = NULL, note = 'unmarked again by online-review-repros.test.sql';
SELECT tests.check('reviewer repros: cleanup — both switches off, the database unmarked',
  $$SELECT payments.env() IS NULL
       AND (SELECT count(*) FROM public.platform_feature_flags WHERE key IN ('max_payments', 'platform_terminal_payments') AND NOT enabled) = 2$$);

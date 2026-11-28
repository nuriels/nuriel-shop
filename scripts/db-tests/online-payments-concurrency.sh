#!/usr/bin/env bash
# ============================================================
# Online card payments (migration 208, MAX / Hyp DEMO) — real concurrency tests (local only, a throw-away database
# conc_payments). Separate psql sessions (independent transactions, like several app servers) released together by
# an advisory-lock barrier — the order-guard-concurrency.sh pattern. The database is marked DEMO; every terminal number
# is assembled at run time and every credential is an obviously fake sealed token.
#   C1  two parallel opens of one order → one attempt (the second reuses it)
#   C2  two parallel settles of the same return → one test_paid, one already_paid
#   C3  two returns with different payloads racing → both recorded, the order window extended once (+2 h, not +4 h)
#   C4  settle vs expire_unpaid_orders → never "paid and cancelled"; the attempt is applied only if the order is paid
#   C5  settle vs max_attempts_expire (SKIP LOCKED) → paid either way
#   C6  one transaction id on two orders → one paid, one needs_review duplicate_txn
#   C7  two parallel platform settles of the same return → one ledger row, one already_paid
#   C8  platform settle vs platform_billing_reverse_entry of the charge → no deadlock, consistent outcome
#   C9  two platform admins registering one terminal number for two stores → one wins
#   C10 two attempts of one charge settling in parallel → one ledger row, the other needs_review duplicate_charge
#   C11 one step-up code consumed twice in parallel → exactly one ok
#   C12 one consumed step-up code, two parallel saves of NURIEL's terminal → exactly one save
#   C13 eight parallel step-up requests of one admin → exactly five codes (5 per 10 minutes)
# Usage:  bash scripts/db-tests/online-payments-concurrency.sh   (after run.sh — the same local Postgres)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
DB=conc_payments
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
FAILED=0
PASSED=0
PLAT=a0000000-0000-0000-0000-0000000000f0
PLAT2=c2090000-0000-4000-8000-0000000000f2
PLAT3=c2090000-0000-4000-8000-0000000000f3
X=c2090000-0000-4000-8000-00000000000a
W=c2090000-0000-4000-8000-00000000000d
Z=c2090000-0000-4000-8000-00000000000c
OX=c2090000-0000-4000-8000-0000000000a1
OW=c2090000-0000-4000-8000-0000000000d1
OZ=c2090000-0000-4000-8000-0000000000c1
PRODUCT=c2090000-0000-4000-8000-00000000b010
SHIP=c2090000-0000-4000-8000-00000000500a
# fake terminal numbers (Hyp's documented test prefix + a fake suffix), never a literal in the repository
T_X="00100""88881"
T_PLAT="00100""88882"
T_PLAT2="00100""88883"
T_9="00100""88889"

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null 2>&1
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null

# helpers (this throw-away database only): the app's server = service_role with no user and no store header
"${Q[@]}" >/dev/null <<'SQL'
CREATE SCHEMA cpt;
CREATE FUNCTION cpt.svc(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  EXECUTE _sql INTO r;
  RESET ROLE;
  RETURN r;
END $f$;
CREATE FUNCTION cpt.call(_site text, _uid uuid, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.headers', CASE WHEN _site IS NULL THEN '' ELSE json_build_object('x-tenant-id', _site)::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE _sql INTO r;
  RESET ROLE;
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN r;
END $f$;
CREATE FUNCTION cpt.h(_s text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT encode(sha256(convert_to(_s, 'UTF8')), 'hex');
$f$;
CREATE FUNCTION cpt.tok(_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'v1:0badc0de:IVfakeIVfakeIV00:TAGfakeTAGfakeTAGfake0:FAKE-' || _label;
$f$;
CREATE FUNCTION cpt.order_of(_site uuid, _cust uuid, _product uuid, _ship uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (cpt.call(_site::text, _cust, format(
    $q$SELECT to_jsonb(x) FROM public.place_order('order',
         jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1, 'unit_price', 10)), 18, true,
         jsonb_build_object('customer_name', 'לקוח תשלום מקבילי', 'customer_tax_id', '123456782',
           'customer_phone', '0501234567', 'billing_city', 'תל אביב', 'billing_address', 'הרצל 1',
           'billing_zip', '6100001', 'accepted_terms', true, 'shipping_method_id', %L, 'payment_method', 'online')) x$q$,
    _product, _ship)) ->> 'id')::uuid;
END $f$;
-- an order of the customer, opened, signed and returned with this payload: the attempt waits for its settle
CREATE FUNCTION cpt.returned(_site uuid, _cust uuid, _product uuid, _ship uuid, _payload text, _txn text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE o uuid; a jsonb;
BEGIN
  o := cpt.order_of(_site, _cust, _product, _ship);
  a := cpt.svc(format('SELECT public.max_attempt_open(%L, %L, %L, NULL, %L)', _site, o, _cust, 'demo'));
  PERFORM cpt.svc(format('SELECT public.max_attempt_signed(%L, %L, true, NULL)', _site, a ->> 'attempt_id'));
  IF _payload IS NOT NULL THEN
    PERFORM cpt.svc(format('SELECT public.max_attempt_record_return(%L, %L, %L, %L, %L, %L, NULL)',
                           _site, a ->> 'reference', _payload, '0', _txn, (a ->> 'amount_minor')::bigint));
  END IF;
  RETURN a || jsonb_build_object('order_id', o);
END $f$;
CREATE FUNCTION cpt.stepup(_actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE c jsonb;
BEGIN
  c := cpt.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', _actor, repeat('p', 64), repeat('c', 64)));
  RETURN cpt.svc(format('SELECT public.platform_stepup_consume(%L, %L, %L, %L)', _actor, c ->> 'challenge_id',
                        repeat('p', 64), repeat('c', 64)));
END $f$;
-- a platform attempt of the owner for a charge, signed, and (with a payload) returned on the platform host
CREATE FUNCTION cpt.p_returned(_owner uuid, _site uuid, _charge uuid, _origin text, _payload text, _txn text)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE a jsonb;
BEGIN
  a := cpt.svc(format('SELECT public.platform_attempt_open(%L, %L, %L, %L, %L, %L)', _owner, _site, 'ledger_charge',
                      _charge, _origin, 'demo'));
  PERFORM cpt.svc(format('SELECT public.platform_attempt_signed(%L, true, NULL)', a ->> 'attempt_id'));
  IF _payload IS NOT NULL THEN
    PERFORM cpt.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)',
                           a ->> 'reference', _payload, '0', _txn, (a ->> 'amount_minor')::bigint));
  END IF;
  RETURN a;
END $f$;
SQL

# fixtures: store X (owner, 30 customers, a ₪10 product), stores W and Z (terminal race), three platform admins;
# the database marked DEMO, both switches on, store X's terminal and NURIEL's terminal saved and verified
"${Q[@]}" >/dev/null <<SQL
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$PLAT2', 'cp.plat2@test.local', now()), ('$PLAT3', 'cp.plat3@test.local', now()),
  ('$OX', 'cp.x.owner@test.local', now()), ('$OW', 'cp.w.owner@test.local', now()), ('$OZ', 'cp.z.owner@test.local', now());
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT format('c2090000-0000-4000-8000-0000000c%s', lpad(g::text, 4, '0'))::uuid, 'cp.c' || g || '@test.local', now()
  FROM generate_series(1, 30) g;
INSERT INTO public.tenants (id, slug, name, owner_email) VALUES
  ('$X', 'cp-store-x', 'חנות מקבילית X', 'cp.x.owner@test.local'),
  ('$W', 'cp-store-w', 'חנות מקבילית W', 'cp.w.owner@test.local'),
  ('$Z', 'cp-store-z', 'חנות מקבילית Z', 'cp.z.owner@test.local');
INSERT INTO public.platform_admins (user_id) VALUES ('$PLAT2'), ('$PLAT3');
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
  ('$X', '$OX', 'cp.x.owner@test.local', 'cp_x_owner', 'admin', true, true),
  ('$W', '$OW', 'cp.w.owner@test.local', 'cp_w_owner', 'admin', true, true),
  ('$Z', '$OZ', 'cp.z.owner@test.local', 'cp_z_owner', 'admin', true, true);
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT '$X', format('c2090000-0000-4000-8000-0000000c%s', lpad(g::text, 4, '0'))::uuid, 'cp.c' || g || '@test.local',
       'cp_c' || g, 'customer', true FROM generate_series(1, 30) g;
INSERT INTO public.customer_profiles (user_id, tenant_id, business_name, age_confirmed, profile_completed)
SELECT format('c2090000-0000-4000-8000-0000000c%s', lpad(g::text, 4, '0'))::uuid, '$X', 'לקוח ' || g, true, true
  FROM generate_series(1, 30) g;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active) VALUES ('$SHIP', '$X', 'איסוף (מקבילי)', 'pickup', 0, true);
INSERT INTO public.categories (tenant_id, name) VALUES ('$X', 'תשלום מקבילי');
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity) VALUES
  ('$PRODUCT', '$X', '20900010', 'מוצר תשלום מקבילי', 'תשלום מקבילי', '$OX', 10, 100000);
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id = '$X';
UPDATE payments.environment SET name = 'demo', note = 'local concurrency test DB (online-payments-concurrency.sh)';
SELECT cpt.call(NULL, '$PLAT', \$q\$SELECT to_jsonb(ARRAY[public.platform_set_flag('max_payments', true),
         public.platform_set_flag('platform_terminal_payments', true)])\$q\$);
SELECT cpt.svc(format('SELECT public.platform_store_terminal_save(%L, %L, %L, %L)', '$PLAT', '$X',
         jsonb_build_object('terminal_number', '$T_X', 'api_key_enc', cpt.tok('x-key'), 'api_password_enc', cpt.tok('x-pass'),
                            'enabled', true), 'demo'));
SELECT cpt.svc(format('SELECT public.platform_store_terminal_verified(%L, %L, true, %L)', '$PLAT', '$X', '0'));
SELECT cpt.stepup('$PLAT');
SELECT cpt.svc(format('SELECT public.platform_terminal_save(%L, %L, %L)', '$PLAT',
         jsonb_build_object('terminal_number', '$T_PLAT', 'api_key_enc', cpt.tok('p-key'), 'api_password_enc', cpt.tok('p-pass'),
                            'enabled', true), 'demo'));
SELECT cpt.svc(format('SELECT public.platform_terminal_verified(%L, true, %L)', '$PLAT', '0'));
SQL

u() { printf 'c2090000-0000-4000-8000-0000000c%04d' "$1"; }
q() { "${Q[@]}" -c "$1"; }
expect_eq() { # expect_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1 (got $2, expected $3)"; FAILED=$((FAILED + 1)); fi
}
expect_t() { expect_eq "$1" "$(q "$2")" "t"; }

# parallel <name> <sql>... — one session per SQL, all released at the same moment
parallel() {
  local name=$1; shift
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  "${PG[@]}" -d "$DB" -c "SELECT pg_advisory_lock(4547)" -c "SELECT pg_sleep(1.5)" -c "SELECT pg_advisory_unlock(4547)" >/dev/null &
  sleep 0.3
  local i=0
  for s in "$@"; do
    i=$((i + 1))
    ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 \
        -c "SELECT pg_advisory_lock_shared(4547); SELECT pg_advisory_unlock_shared(4547);" -c "$s" \
        > "$TMP/$name/$i.out" 2> "$TMP/$name/$i.err"; echo $? > "$TMP/$name/$i.rc" ) &
  done
  wait
}
rc_ok() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }
errs() { cat "$TMP/$1"/*.err 2>/dev/null | grep -c "$2" || true; }
outs() { cat "$TMP/$1"/*.out 2>/dev/null | grep -c "$2" || true; }
no_deadlock() { expect_eq "$2: no deadlock, no serialization failure" "$(errs "$1" 'deadlock\|could not serialize')" "0"; }
# the server's calls: service_role, no user, no store header
svc() { echo "SET ROLE service_role; SELECT 'RESULT:' || ($1)::text;"; }
settle_sql() { # settle_sql <reference> <payload> <txn>
  svc "public.max_attempt_mark_paid('$X', '$1', '$2', '0', '0', '$T_X', '$3', 1000, 'ILS', 1, 'A0001', 'visa', '0000', '{}', 'demo')"
}
p_settle_sql() { # p_settle_sql <reference> <payload> <txn> <amount_minor>
  svc "public.platform_attempt_mark_paid('$1', '$2', '0', '0', '$T_PLAT', '$3', $4, 'ILS', 1, 'A0002', 'mastercard', '0000', '{}', 'demo')"
}
charge() { # charge <amount> <description> → the new charge id of store X
  q "SELECT cpt.call(NULL, '$PLAT', format(\$q\$SELECT public.platform_billing_record_entry(%L, %L)\$q\$, '$X',
       jsonb_build_object('kind', 'charge', 'category', 'other', 'amount', $1, 'description', '$2')))" >/dev/null
  q "SELECT id FROM billing.ledger WHERE tenant_id = '$X' AND description = '$2'"
}

echo "C1. two parallel opens of one order"
O1=$(q "SELECT cpt.order_of('$X', '$(u 1)', '$PRODUCT', '$SHIP')")
OPEN1=$(svc "public.max_attempt_open('$X', '$O1', '$(u 1)', NULL, 'demo') ->> 'attempt_id'")
parallel c1 "$OPEN1" "$OPEN1"
expect_eq "both sessions succeeded" "$(rc_ok c1)" "2"
expect_eq "both got the same attempt" "$(cat "$TMP"/c1/*.out | grep RESULT: | sort -u | wc -l | tr -d ' ')" "1"
expect_eq "one attempt for the order" "$(q "SELECT count(*) FROM payments.tenant_attempts WHERE order_id = '$O1'")" "1"

echo "C2. two parallel settles of the same return"
A2=$(q "SELECT cpt.returned('$X', '$(u 2)', '$PRODUCT', '$SHIP', cpt.h('c2'), 'fake-c2-0001')")
REF2=$(q "SELECT '$A2'::jsonb ->> 'reference'"); PL2=$(q "SELECT cpt.h('c2')")
parallel c2 "$(settle_sql "$REF2" "$PL2" fake-c2-0001)" "$(settle_sql "$REF2" "$PL2" fake-c2-0001)"
expect_eq "both sessions succeeded" "$(rc_ok c2)" "2"
expect_eq "exactly one test_paid" "$(outs c2 '"result": "test_paid"')" "1"
expect_eq "exactly one already_paid" "$(outs c2 '"result": "already_paid"')" "1"
expect_t "the order is paid once, the attempt applied" \
  "SELECT o.payment_status = 'paid' AND a.state = 'test_paid' AND a.applied FROM public.orders o
     JOIN payments.tenant_attempts a ON a.order_id = o.id WHERE a.reference = '$REF2'"

echo "C3. two returns with different payloads racing"
A3=$(q "SELECT cpt.returned('$X', '$(u 3)', '$PRODUCT', '$SHIP', NULL, NULL)")
REF3=$(q "SELECT '$A3'::jsonb ->> 'reference'"); O3=$(q "SELECT '$A3'::jsonb ->> 'order_id'")
PL3A=$(q "SELECT cpt.h('c3-a')"); PL3B=$(q "SELECT cpt.h('c3-b')")
parallel c3 "$(svc "public.max_attempt_record_return('$X', '$REF3', '$PL3A', '0', 'fake-c3-0001', 1000, NULL)")" \
            "$(svc "public.max_attempt_record_return('$X', '$REF3', '$PL3B', '0', 'fake-c3-0001', 1000, NULL)")"
expect_eq "both sessions succeeded" "$(rc_ok c3)" "2"
expect_eq "both returns were received" "$(outs c3 '"result": "received"')" "2"
expect_t "two return events, the attempt returned, the window extended once (+2 h, not +4 h)" \
  "SELECT (SELECT count(*) FROM payments.tenant_events e JOIN payments.tenant_attempts a ON a.id = e.attempt_id
            WHERE a.reference = '$REF3' AND e.source = 'return') = 2
      AND (SELECT state = 'returned' FROM payments.tenant_attempts WHERE reference = '$REF3')
      AND (SELECT payment_due_at BETWEEN now() + interval '1 hour 58 minutes' AND now() + interval '2 hours 1 minute'
             FROM public.orders WHERE id = '$O3')"

echo "C4. settle vs expire_unpaid_orders"
A4=$(q "SELECT cpt.returned('$X', '$(u 4)', '$PRODUCT', '$SHIP', cpt.h('c4'), 'fake-c4-0001')")
REF4=$(q "SELECT '$A4'::jsonb ->> 'reference'"); O4=$(q "SELECT '$A4'::jsonb ->> 'order_id'"); PL4=$(q "SELECT cpt.h('c4')")
q "SET session_replication_role = replica; UPDATE public.orders SET payment_due_at = now() - interval '1 minute' WHERE id = '$O4'" >/dev/null
parallel c4 "$(settle_sql "$REF4" "$PL4" fake-c4-0001)" "SELECT 'RESULT:' || public.expire_unpaid_orders();"
expect_eq "both sessions succeeded" "$(rc_ok c4)" "2"
no_deadlock c4 "C4"
expect_t "never paid and cancelled; the attempt is applied exactly when the order is paid; a lost race goes to review" \
  "SELECT NOT (o.payment_status = 'paid' AND o.status = 'cancelled')
      AND (o.payment_status = 'paid') = a.applied
      AND (a.applied OR (a.state = 'needs_review' AND o.status = 'cancelled'))
     FROM public.orders o JOIN payments.tenant_attempts a ON a.order_id = o.id WHERE o.id = '$O4'"
echo "     (outcome: $(q "SELECT o.status || '/' || o.payment_status || ' — attempt ' || a.state || COALESCE(' ' || a.review_reason, '')
                        FROM public.orders o JOIN payments.tenant_attempts a ON a.order_id = o.id WHERE o.id = '$O4'"))"

echo "C5. settle vs max_attempts_expire (SKIP LOCKED)"
A5=$(q "SELECT cpt.returned('$X', '$(u 5)', '$PRODUCT', '$SHIP', cpt.h('c5'), 'fake-c5-0001')")
REF5=$(q "SELECT '$A5'::jsonb ->> 'reference'"); O5=$(q "SELECT '$A5'::jsonb ->> 'order_id'"); PL5=$(q "SELECT cpt.h('c5')")
q "SET session_replication_role = replica; UPDATE payments.tenant_attempts SET created_at = now() - interval '1 hour', expires_at = now() - interval '1 minute' WHERE reference = '$REF5'" >/dev/null
parallel c5 "$(settle_sql "$REF5" "$PL5" fake-c5-0001)" "$(svc "public.max_attempts_expire()")"
expect_eq "both sessions succeeded" "$(rc_ok c5)" "2"
no_deadlock c5 "C5"
expect_t "paid either way (the sweep skips the locked attempt, or the late settle pays the expired one)" \
  "SELECT o.payment_status = 'paid' AND a.state = 'test_paid' AND a.applied
     FROM public.orders o JOIN payments.tenant_attempts a ON a.order_id = o.id WHERE o.id = '$O5'"

echo "C6. one transaction id on two orders"
A6A=$(q "SELECT cpt.returned('$X', '$(u 6)', '$PRODUCT', '$SHIP', cpt.h('c6-a'), 'fake-c6-0001')")
A6B=$(q "SELECT cpt.returned('$X', '$(u 7)', '$PRODUCT', '$SHIP', cpt.h('c6-b'), 'fake-c6-0001')")
REF6A=$(q "SELECT '$A6A'::jsonb ->> 'reference'"); REF6B=$(q "SELECT '$A6B'::jsonb ->> 'reference'")
parallel c6 "$(settle_sql "$REF6A" "$(q "SELECT cpt.h('c6-a')")" fake-c6-0001)" \
            "$(settle_sql "$REF6B" "$(q "SELECT cpt.h('c6-b')")" fake-c6-0001)"
expect_eq "both sessions succeeded" "$(rc_ok c6)" "2"
expect_eq "exactly one test_paid" "$(outs c6 '"result": "test_paid"')" "1"
expect_eq "exactly one needs_review duplicate_txn" "$(outs c6 '"reason": "duplicate_txn"')" "1"
expect_eq "the transaction id is stored once" "$(q "SELECT count(*) FROM payments.tenant_attempts WHERE provider_txn_id = 'fake-c6-0001'")" "1"
expect_eq "one of the two orders is paid" "$(q "SELECT count(*) FROM public.orders o JOIN payments.tenant_attempts a ON a.order_id = o.id
                                                 WHERE a.reference IN ('$REF6A', '$REF6B') AND o.payment_status = 'paid'")" "1"

echo "C7. two parallel platform settles of the same return"
CH7=$(charge 20 'חיוב מקבילי C7')
PA7=$(q "SELECT cpt.p_returned('$OX', '$X', '$CH7', NULL, cpt.h('c7'), 'fake-c7-0001')")
PREF7=$(q "SELECT '$PA7'::jsonb ->> 'reference'"); PPL7=$(q "SELECT cpt.h('c7')")
parallel c7 "$(p_settle_sql "$PREF7" "$PPL7" fake-c7-0001 2000)" "$(p_settle_sql "$PREF7" "$PPL7" fake-c7-0001 2000)"
expect_eq "both sessions succeeded" "$(rc_ok c7)" "2"
expect_eq "exactly one test_paid" "$(outs c7 '"result": "test_paid"')" "1"
expect_eq "exactly one already_paid" "$(outs c7 '"result": "already_paid"')" "1"
expect_eq "exactly one provider payment row in billing.ledger" \
  "$(q "SELECT count(*) FROM billing.ledger WHERE tenant_id = '$X' AND source = 'provider' AND provider_ref = 'max:test:fake-c7-0001'")" "1"

echo "C8. platform settle vs platform_billing_reverse_entry of the charge"
CH8=$(charge 15 'חיוב מקבילי C8')
PA8=$(q "SELECT cpt.p_returned('$OX', '$X', '$CH8', NULL, cpt.h('c8'), 'fake-c8-0001')")
PREF8=$(q "SELECT '$PA8'::jsonb ->> 'reference'"); PPL8=$(q "SELECT cpt.h('c8')")
parallel c8 "$(p_settle_sql "$PREF8" "$PPL8" fake-c8-0001 1500)" \
  "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '$PLAT', true); SELECT 'RESULT:' || public.platform_billing_reverse_entry('$CH8', 'בוטל במקביל')::text;"
no_deadlock c8 "C8"
expect_eq "the settle session succeeded" "$(cat "$TMP/c8/1.rc")" "0"
expect_t "consistent: paid with exactly one provider row, or needs_review target_changed with none" \
  "SELECT (a.state = 'test_paid' AND a.applied AND (SELECT count(*) FROM billing.ledger WHERE source = 'provider' AND provider_ref = 'max:test:fake-c8-0001') = 1)
       OR (a.state = 'needs_review' AND a.review_reason = 'target_changed' AND NOT a.applied
           AND NOT EXISTS (SELECT 1 FROM billing.ledger WHERE provider_ref = 'max:test:fake-c8-0001'))
     FROM payments.platform_attempts a WHERE a.reference = '$PREF8'"
C8_REV=$( [ "$(cat "$TMP/c8/2.rc")" = "0" ] && echo recorded || echo "refused: $(head -1 "$TMP/c8/2.err")")
echo "     (outcome: $(q "SELECT state || COALESCE(' ' || review_reason, '') FROM payments.platform_attempts WHERE reference = '$PREF8'"); reversal $C8_REV)"

echo "C9. two platform admins register one terminal number for two stores"
parallel c9 "$(svc "public.platform_store_terminal_save('$PLAT', '$W', jsonb_build_object('terminal_number', '$T_9'), 'demo')")" \
            "$(svc "public.platform_store_terminal_save('$PLAT2', '$Z', jsonb_build_object('terminal_number', '$T_9'), 'demo')")"
expect_eq "exactly one session succeeded" "$(rc_ok c9)" "1"
expect_eq "the other was told the number belongs to another store" "$(errs c9 'already registered to another store')" "1"
expect_t "one registry row for the number, and only one store carries it" \
  "SELECT (SELECT count(*) FROM payments.terminal_registry WHERE terminal_number = '$T_9') = 1
      AND (SELECT count(*) FROM payments.tenant_accounts WHERE terminal_number = '$T_9') = 1
      AND (SELECT tenant_id FROM payments.terminal_registry WHERE terminal_number = '$T_9')
          = (SELECT tenant_id FROM payments.tenant_accounts WHERE terminal_number = '$T_9')"

echo "C10. two attempts of one charge settling in parallel"
CH10=$(charge 10 'חיוב מקבילי C10')
PA10A=$(q "SELECT cpt.p_returned('$OX', '$X', '$CH10', NULL, NULL, NULL)")
PA10B=$(q "SELECT cpt.p_returned('$OX', '$X', '$CH10', 'http://cp-store-x.shop.localhost:3100', cpt.h('c10-b'), 'fake-c10-0002')")
PREF10A=$(q "SELECT '$PA10A'::jsonb ->> 'reference'"); PREF10B=$(q "SELECT '$PA10B'::jsonb ->> 'reference'")
q "SELECT cpt.svc(format('SELECT public.platform_attempt_record_return(%L, %L, %L, %L, %L, NULL)', '$PREF10A', cpt.h('c10-a'), '0', 'fake-c10-0001', 1000))" >/dev/null
expect_t "the first attempt was superseded (expired) and still took its late return" \
  "SELECT state = 'expired' AND returned_at IS NOT NULL FROM payments.platform_attempts WHERE reference = '$PREF10A'"
parallel c10 "$(p_settle_sql "$PREF10A" "$(q "SELECT cpt.h('c10-a')")" fake-c10-0001 1000)" \
             "$(p_settle_sql "$PREF10B" "$(q "SELECT cpt.h('c10-b')")" fake-c10-0002 1000)"
expect_eq "both sessions succeeded" "$(rc_ok c10)" "2"
no_deadlock c10 "C10"
expect_eq "exactly one test_paid" "$(outs c10 '"result": "test_paid"')" "1"
expect_eq "exactly one needs_review duplicate_charge" "$(outs c10 '"reason": "duplicate_charge"')" "1"
expect_eq "exactly one provider payment row for the charge" \
  "$(q "SELECT count(*) FROM billing.ledger WHERE tenant_id = '$X' AND source = 'provider' AND provider_ref IN ('max:test:fake-c10-0001', 'max:test:fake-c10-0002')")" "1"

echo "C11. one step-up code consumed twice in parallel"
CHAL=$(q "SELECT cpt.svc(format('SELECT public.platform_stepup_issue(%L, %L, %L)', '$PLAT2', repeat('a', 64), repeat('b', 64))) ->> 'challenge_id'")
CONSUME="$(svc "public.platform_stepup_consume('$PLAT2', '$CHAL', repeat('a', 64), repeat('b', 64))")"
parallel c11 "$CONSUME" "$CONSUME"
expect_eq "both sessions succeeded" "$(rc_ok c11)" "2"
expect_eq "exactly one ok" "$(outs c11 '"ok": true')" "1"
expect_eq "the other: used" "$(outs c11 '"reason": "used"')" "1"

echo "C12. one consumed code, two parallel saves of NURIEL's terminal"
parallel c12 "$(svc "public.platform_terminal_save('$PLAT2', jsonb_build_object('terminal_number', '$T_PLAT2'), 'demo')")" \
             "$(svc "public.platform_terminal_save('$PLAT2', jsonb_build_object('enabled', false), 'demo')")"
expect_eq "exactly one save" "$(rc_ok c12)" "1"
expect_eq "the other needs a new code" "$(errs c12 'verification code')" "1"
expect_t "the code is spent once" "SELECT spent_at IS NOT NULL FROM payments.platform_stepup_challenges WHERE id = '$CHAL'"

echo "C13. eight parallel step-up requests of one admin"
SQLS=(); for i in $(seq 1 8); do SQLS+=("$(svc "public.platform_stepup_issue('$PLAT3', repeat('a', 64), repeat('d', 60) || lpad('$i', 4, '0'))")"); done
parallel c13 "${SQLS[@]}"
expect_eq "exactly five codes" "$(rc_ok c13)" "5"
expect_eq "three refused (5 per 10 minutes)" "$(errs c13 'too many verification codes')" "3"
expect_eq "five challenges stored, one of them open" \
  "$(q "SELECT count(*) || '/' || count(*) FILTER (WHERE superseded_at IS NULL) FROM payments.platform_stepup_challenges WHERE actor_id = '$PLAT3'")" "5/1"

rm -rf "$TMP"
"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
echo "online payments concurrency: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]

#!/usr/bin/env bash
# ============================================================
# הגנת place_order (מיגרציה 200) — בדיקות מקביליות אמיתיות (מקומי, מסד חד-פעמי conc_orders).
# חיבורי psql נפרדים (טרנזקציות עצמאיות — כמו כמה שרתי PostgREST) שמשוחררים יחד (מחסום advisory lock):
#   1. 50 הזמנות מקבילות של אותו לקוח (תקרה 30 ל-10 דקות) → בדיוק 30 עוברות, 20 נחסמות, 30 הזמנות במסד.
#   2. קופון עם max_uses = 1, 12 לקוחות שונים (לכל אחד אישור) במקביל → בדיוק אחד מקבל אותו.
#   3. אישור אחד, 10 חיבורים מקבילים של אותו לקוח → בדיוק חיבור אחד צורך אותו (צריכה אטומית).
#   4. מלאי 5, 12 לקוחות שונים מזמינים יחידה אחת במקביל → בדיוק 5 הזמנות, המלאי 0, בלי מכירת יתר.
#   5. ביטול הזמנה משחרר את ההחזקה, ואז לקוח נוסף מצליח.
# שימוש:  bash scripts/db-tests/order-guard-concurrency.sh   (אחרי run.sh — אותו Postgres)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
DB=conc_orders
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
FAILED=0
PASSED=0
A=70000000-0000-0000-0000-00000000000a
OWNER=a0000000-0000-0000-0000-0000000000a1
PRODUCT=9e200000-0000-0000-0000-000000000001
LIMITED=9e200000-0000-0000-0000-000000000002
SHIP=5e000000-0000-0000-0000-000000000003

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null

# 80 לקוחות מאושרים, מוצר רגיל, מוצר עם מלאי 5, שיטת משלוח, שני קופונים
"${Q[@]}" >/dev/null <<SQL
SELECT set_config('request.headers', json_build_object('x-tenant-id', '$A')::text, false);
INSERT INTO auth.users (id, email)
SELECT format('b3000000-0000-4000-8000-%s', lpad(g::text, 12, '0'))::uuid, 'conc.' || g || '@test.local' FROM generate_series(1, 80) g;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
SELECT '$A', format('b3000000-0000-4000-8000-%s', lpad(g::text, 12, '0'))::uuid, 'conc.' || g || '@test.local', 'conc_' || g, 'customer', true FROM generate_series(1, 80) g;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed)
SELECT format('b3000000-0000-4000-8000-%s', lpad(g::text, 12, '0'))::uuid, 'לקוח ' || g, true, true FROM generate_series(1, 80) g;
INSERT INTO public.shipping_methods (id, tenant_id, name, kind, price, is_active) VALUES ('$SHIP', '$A', 'איסוף (מקבילי)', 'pickup', 0, true);
INSERT INTO public.categories (tenant_id, name) VALUES ('$A', 'מקבילי');
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, stock_quantity) VALUES
  ('$PRODUCT', '$A', '96100001', 'מוצר מקבילי', 'מקבילי', '$OWNER', 100, 100000),
  ('$LIMITED', '$A', '96100002', 'מוצר מוגבל', 'מקבילי', '$OWNER', 100, 5);
UPDATE public.site_settings SET payment_phone_enabled = true WHERE tenant_id = '$A';
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value, max_uses) VALUES ('$A', 'SINGLE', 'percent', 10, 1);
INSERT INTO public.coupons (tenant_id, code, discount_type, discount_value) VALUES ('$A', 'OPEN10', 'percent', 10);
SQL

# check_coupon כמו השרת: הכותרת של העסק + ללא משתמש מחובר (service)
grant_for() { q "SELECT set_config('request.headers','{\"x-tenant-id\":\"$A\"}', false); SELECT public.check_coupon('$1', 100, '$2', NULL, false)" >/dev/null; }
u() { printf 'b3000000-0000-4000-8000-%012d' "$1"; }
q() { "${Q[@]}" -c "$1"; }
expect_eq() { # expect_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1 (got $2, expected $3)"; FAILED=$((FAILED + 1)); fi
}
DETAILS="jsonb_build_object('customer_name','לקוח','customer_tax_id','123456782','customer_phone','0501234567','customer_email','c@test.local','billing_city','תל אביב','billing_address','הרצל 1','billing_zip','6100001','accepted_terms',true,'shipping_method_id','$SHIP','payment_method','phone')"
# order_sql <user-number> <product> <coupon|""> — אותו מה שהדפדפן שולח ל-PostgREST: משתמש מחובר + הכותרת של העסק
order_sql() {
  local det="$DETAILS"
  [ -n "$3" ] && det="$DETAILS || jsonb_build_object('coupon_code','$3')"
  echo "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$(u "$1")', true), set_config('request.headers','{\"x-tenant-id\":\"$A\"}', true); SELECT 'RESULT:' || id FROM public.place_order('order', jsonb_build_array(jsonb_build_object('product_id','$2','quantity',1,'unit_price',100)), 18, true, $det);"
}

# parallel <name> <sql>... — session אחד לכל SQL, כולם משתחררים באותו רגע
parallel() {
  local name=$1; shift
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  "${PG[@]}" -d "$DB" -c "SELECT pg_advisory_lock(4546)" -c "SELECT pg_sleep(1.5)" -c "SELECT pg_advisory_unlock(4546)" >/dev/null &
  sleep 0.3
  local i=0
  for s in "$@"; do
    i=$((i + 1))
    ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 \
        -c "SELECT pg_advisory_lock_shared(4546); SELECT pg_advisory_unlock_shared(4546);" -c "$s" \
        > "$TMP/$name/$i.out" 2> "$TMP/$name/$i.err"; echo $? > "$TMP/$name/$i.rc" ) &
  done
  wait
}
rc_ok() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }
errs() { cat "$TMP/$1"/*.err 2>/dev/null | grep -c "$2" || true; }

echo "1. 50 simultaneous orders of ONE customer (30 per 10 minutes)"
SQLS=(); for i in $(seq 1 50); do SQLS+=("$(order_sql 1 "$PRODUCT" "")"); done
parallel rate "${SQLS[@]}"
expect_eq "exactly 30 sessions succeeded" "$(rc_ok rate)" "30"
expect_eq "the other 20 were refused by the guard" "$(errs rate 'יותר מדי הזמנות')" "20"
expect_eq "30 orders in the database" "$(q "SELECT count(*) FROM public.orders WHERE customer_id = '$(u 1)'")" "30"
expect_eq "another customer is not affected" "$(q "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','$(u 2)', true), set_config('request.headers','{\"x-tenant-id\":\"$A\"}', true); SELECT count(*) FROM public.place_order('order', jsonb_build_array(jsonb_build_object('product_id','$PRODUCT','quantity',1,'unit_price',100)), 18, true, $DETAILS)" | tail -1)" "1"

echo "2. a single-use coupon (max_uses = 1), 12 different customers with a grant, at once"
for i in $(seq 10 21); do grant_for SINGLE "$(u "$i")"; done
SQLS=(); for i in $(seq 10 21); do SQLS+=("$(order_sql "$i" "$PRODUCT" SINGLE)"); done
parallel single "${SQLS[@]}"
expect_eq "exactly one customer got the coupon" "$(rc_ok single)" "1"
expect_eq "the other 11 were told it is used up" "$(errs single 'הקופון כבר נוצל')" "11"
expect_eq "one order carries the coupon" "$(q "SELECT count(*) FROM public.orders WHERE coupon_code = 'SINGLE'")" "1"
expect_eq "the 11 failed attempts left no order behind" "$(q "SELECT count(*) FROM public.orders WHERE customer_id IN (SELECT format('b3000000-0000-4000-8000-%s', lpad(g::text, 12, '0'))::uuid FROM generate_series(10, 21) g)")" "1"
expect_eq "the 11 failed customers still hold their grants (rolled back with the failed order)" "$(q "SELECT count(*) FROM public.coupon_grants WHERE code = 'SINGLE'")" "11"

echo "3. ONE grant, 10 simultaneous connections of the same customer"
grant_for OPEN10 "$(u 30)"
SQLS=(); for i in $(seq 1 10); do SQLS+=("$(order_sql 30 "$PRODUCT" OPEN10)"); done
parallel grant "${SQLS[@]}"
expect_eq "exactly one connection used the grant" "$(rc_ok grant)" "1"
expect_eq "the other 9 were told the coupon is not verified" "$(errs grant 'הקופון לא אומת')" "9"
expect_eq "one order with the coupon for that customer" "$(q "SELECT count(*) FROM public.orders WHERE customer_id = '$(u 30)' AND coupon_code = 'OPEN10'")" "1"
expect_eq "the grant is gone" "$(q "SELECT count(*) FROM public.coupon_grants WHERE user_id = '$(u 30)'")" "0"

echo "4. stock of 5, 12 different customers order one unit each at once"
SQLS=(); for i in $(seq 40 51); do SQLS+=("$(order_sql "$i" "$LIMITED" "")"); done
parallel stock "${SQLS[@]}"
expect_eq "exactly 5 orders were accepted" "$(rc_ok stock)" "5"
expect_eq "5 order lines for the limited product" "$(q "SELECT count(*) FROM public.order_items WHERE product_id = '$LIMITED'")" "5"
expect_eq "the stock is exactly 0 (no oversell, no negative)" "$(q "SELECT stock_quantity FROM public.global_products WHERE id = '$LIMITED'")" "0"
expect_eq "the other 7 were refused for stock" "$(errs stock 'מלאי\|אזל\|אין מספיק')" "7"

echo "5. cancelling an order releases its hold; then one more customer succeeds"
FIRST=$(q "SELECT o.id FROM public.orders o JOIN public.order_items i ON i.order_id = o.id WHERE i.product_id = '$LIMITED' ORDER BY o.created_at LIMIT 1")
q "UPDATE public.orders SET status = 'cancelled' WHERE id = '$FIRST'" >/dev/null
expect_eq "the stock is back to 1" "$(q "SELECT stock_quantity FROM public.global_products WHERE id = '$LIMITED'")" "1"
parallel after "$(order_sql 60 "$LIMITED" "")" "$(order_sql 61 "$LIMITED" "")"
expect_eq "exactly one of two simultaneous customers got the freed unit" "$(rc_ok after)" "1"
expect_eq "the stock is 0 again" "$(q "SELECT stock_quantity FROM public.global_products WHERE id = '$LIMITED'")" "0"

rm -rf "$TMP"
"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
echo "order guard concurrency: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]

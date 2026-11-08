#!/usr/bin/env bash
# ============================================================
# NURIEL AI ASSISTANT — בדיקות מקביליות אמיתיות (מקומי, מסד חד-פעמי conc_ai).
# חיבורי psql נפרדים (טרנזקציות עצמאיות — כמו כמה שרתי אפליקציה) שמשוחררים יחד (מחסום advisory lock):
#   1. 20 שאלות במקביל של אותו משתמש (מגבלה 5 בדקה) → בדיוק 5 עוברות, 15 נחסמות, המונה עוצר ב-5.
#   2. 12 משתמשים של אותו עסק במקביל (מגבלה 4 לעסק בשעה) → בדיוק 4 עוברים.
#   3. 10 "שרתים" תופסים את אותה התראת חידוש במקביל → בדיוק אחד מקבל אותה; שורה אחת במסד.
#   4. ניסיון חוזר לשליחה שנכשלה — 8 שרתים במקביל → בדיוק אחד לוקח אותו (ניסיון 2), באותה שורה.
#   5. "חידוש" שנלחץ 8 פעמים במקביל (לחיצה כפולה, שני שרתים, שני מנהלים) → תקופה אחת חדשה בלבד.
#   6. "הפעלה" של עסק חדש 8 פעמים במקביל → חבילה אחת ותקופה אחת בלבד.
# שימוש:  bash scripts/db-tests/ai-concurrency.sh   (אחרי run.sh — אותו Postgres)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
DB=conc_ai
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
FAILED=0
PASSED=0
A=70000000-0000-0000-0000-00000000000a
B=70000000-0000-0000-0000-00000000000b
PA=a0000000-0000-0000-0000-0000000000f0

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null

# מכסות נמוכות לבדיקה; חבילה לחנות A שמסתיימת היום (התראת d0 של היום)
"${Q[@]}" >/dev/null <<SQL
UPDATE public.ai_settings SET user_minute_limit = 5, tenant_hourly_limit = 300, monthly_budget_usd = 1000;
INSERT INTO public.ai_subscriptions (tenant_id, package_code, product)
VALUES ('$A', 'nuriel_ai_ecommerce', 'ecommerce');
INSERT INTO public.ai_subscription_periods (subscription_id, tenant_id, kind, starts_on, ends_on, price_agorot)
SELECT s.id, s.tenant_id, 'activation', d.start, public.ai_period_end(d.start), 15000
  FROM public.ai_subscriptions s, (SELECT ((public.ai_today() + 1) - interval '12 months')::date AS start) d
 WHERE s.tenant_id = '$A';
SQL

q() { "${Q[@]}" -c "$1"; }
expect_eq() { # expect_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1 (got $2, expected $3)"; FAILED=$((FAILED + 1)); fi
}
AS_SERVER="SET ROLE service_role;"

# parallel <name> <sql>... — one session per SQL, all released at the same moment
parallel() {
  local name=$1; shift
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  "${PG[@]}" -d "$DB" -c "SELECT pg_advisory_lock(4545)" -c "SELECT pg_sleep(1)" -c "SELECT pg_advisory_unlock(4545)" >/dev/null &
  sleep 0.3
  local i=0
  for s in "$@"; do
    i=$((i + 1))
    ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 \
        -c "SELECT pg_advisory_lock_shared(4545); SELECT pg_advisory_unlock_shared(4545);" -c "$s" \
        > "$TMP/$name/$i.out" 2> "$TMP/$name/$i.err"; echo $? > "$TMP/$name/$i.rc" ) &
  done
  wait
}
results() { cat "$TMP/$1"/*.out 2>/dev/null | grep -c "^RESULT:$2$" || true; }
rc_ok() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }

echo "1. 20 simultaneous questions of one user (5 a minute)"
U1=a1000000-0000-4000-8000-000000000001
SQLS=()
for i in $(seq 1 20); do
  SQLS+=("$AS_SERVER SELECT 'RESULT:' || (public.ai_quota_take('$A', '$U1', 'question $i', true) ->> 'result');")
done
parallel user "${SQLS[@]}"
expect_eq "every session finished without an error" "$(rc_ok user)" "20"
expect_eq "exactly 5 passed" "$(results user ok)" "5"
expect_eq "exactly 15 were refused by the user limit" "$(results user user)" "15"
expect_eq "the user counter stopped at 5" "$(q "SELECT hits FROM public.ai_rate_buckets WHERE key = 'u:$U1'")" "5"
expect_eq "the business counter counted only the 5 that passed" "$(q "SELECT hits FROM public.ai_rate_buckets WHERE key = 't:$A'")" "5"
expect_eq "the system counter counted only the 5 that passed" "$(q "SELECT hits FROM public.ai_rate_buckets WHERE key = 'g'")" "5"

echo "2. 12 users of one business at once (4 an hour for the business)"
q "UPDATE public.ai_settings SET tenant_hourly_limit = 9; DELETE FROM public.ai_rate_buckets;" >/dev/null
SQLS=()
for i in $(seq 1 12); do
  U=$(printf 'a2000000-0000-4000-8000-%012d' "$i")
  SQLS+=("$AS_SERVER SELECT 'RESULT:' || (public.ai_quota_take('$A', '$U', 'question $i', true) ->> 'result');")
done
# 5 earlier questions of the business in this hour (9 − 5 = 4 left)
for i in 1 2 3 4 5; do
  q "SET ROLE service_role; SELECT public.ai_quota_take('$A', 'a3000000-0000-4000-8000-00000000000$i', 'earlier $i', true)" >/dev/null
done
parallel tenant "${SQLS[@]}"
expect_eq "every session finished without an error" "$(rc_ok tenant)" "12"
expect_eq "exactly 4 passed (the 4 left of 9)" "$(results tenant ok)" "4"
expect_eq "exactly 8 were refused by the business limit" "$(results tenant tenant)" "8"
expect_eq "the business counter stopped at 9" "$(q "SELECT hits FROM public.ai_rate_buckets WHERE key = 't:$A'")" "9"

echo "3. 10 servers claim the same renewal notice at once"
SUB=$(q "SELECT id FROM public.ai_subscriptions WHERE tenant_id = '$A'")
CLAIM="$AS_SERVER SELECT 'RESULT:' || COALESCE(public.ai_notification_claim('$SUB', public.ai_today(), 'd0', 'o***@e2e.test')::text, 'none');"
parallel claim "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM"
expect_eq "every session finished without an error" "$(rc_ok claim)" "10"
expect_eq "exactly 9 got nothing" "$(results claim none)" "9"
expect_eq "one row in the database for that notice" "$(q "SELECT count(*) FROM public.ai_notifications WHERE tenant_id = '$A'")" "1"
expect_eq "it is pending — claimed once" "$(q "SELECT status || ':' || attempts FROM public.ai_notifications WHERE tenant_id = '$A'")" "pending:1"

echo "4. the send failed; an hour later 8 servers retry at once"
q "SET ROLE service_role; SELECT public.ai_notification_finish(n.id, 'failed', 'provider down') FROM public.ai_notifications n WHERE n.tenant_id = '$A'" >/dev/null
q "UPDATE public.ai_notifications SET finished_at = now() - interval '2 hours' WHERE tenant_id = '$A'" >/dev/null
parallel retry "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM" "$CLAIM"
expect_eq "every session finished without an error" "$(rc_ok retry)" "8"
expect_eq "exactly 7 got nothing" "$(results retry none)" "7"
expect_eq "the same row, attempt 2, pending" "$(q "SELECT count(*) || ':' || max(status) || ':' || max(attempts) FROM public.ai_notifications WHERE tenant_id = '$A'")" "1:pending:2"

echo "5. 'renew' pressed 8 times at once (a double click, two servers, two admins)"
LAST=$(q "SELECT max(ends_on) FROM public.ai_subscription_periods WHERE tenant_id = '$A'")
RENEW="$AS_SERVER SELECT 'RESULT:' || (public.ai_admin_renew('$PA', '$A', '$LAST', NULL, true) ->> 'status');"
parallel renew "$RENEW" "$RENEW" "$RENEW" "$RENEW" "$RENEW" "$RENEW" "$RENEW" "$RENEW"
expect_eq "exactly one renewal went through" "$(rc_ok renew)" "1"
expect_eq "the others were refused (changed meanwhile / already scheduled)" "$(cat "$TMP"/renew/*.err | grep -cE 'changed meanwhile|already scheduled')" "7"
expect_eq "one new period of 12 months, starting the day after the end" "$(q "SELECT count(*) || ':' || bool_and(starts_on = '$LAST'::date + 1 AND ends_on = public.ai_period_end('$LAST'::date + 1)) FROM public.ai_subscription_periods WHERE tenant_id = '$A' AND kind = 'renewal'")" "1:true"
expect_eq "one 'renewed' event, with the payment confirmation" "$(q "SELECT count(*) || ':' || bool_and(payment_confirmed) FROM public.ai_subscription_events WHERE tenant_id = '$A' AND kind = 'renewed'")" "1:true"

echo "6. 'activate' a new business 8 times at once"
ACT="$AS_SERVER SELECT 'RESULT:' || (public.ai_admin_activate('$PA', '$B', 'ecommerce', public.ai_today(), NULL, true) ->> 'status');"
parallel activate "$ACT" "$ACT" "$ACT" "$ACT" "$ACT" "$ACT" "$ACT" "$ACT"
expect_eq "exactly one activation went through" "$(rc_ok activate)" "1"
expect_eq "the others were refused (already has a package)" "$(cat "$TMP"/activate/*.err | grep -c 'renew it instead')" "7"
expect_eq "one package, one period" "$(q "SELECT (SELECT count(*) FROM public.ai_subscriptions WHERE tenant_id = '$B') || ':' || (SELECT count(*) FROM public.ai_subscription_periods WHERE tenant_id = '$B')")" "1:1"

rm -rf "$TMP"
"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
echo "AI concurrency: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]

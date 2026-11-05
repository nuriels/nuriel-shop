#!/usr/bin/env bash
# ============================================================
# מודול הרישיונות — בדיקות מקביליות אמיתיות (מקומי, מסד חד-פעמי conc_lic).
# חיבורי psql נפרדים (טרנזקציות עצמאיות) שמשוחררים יחד (מחסום advisory lock):
#   1. 12 הורדות במקביל של אותו קישור (מגבלה 3) → בדיוק 3 מצליחות, 9 נחסמות,
#      המונה עוצר ב-3, וביומן בדיוק 3 הורדות ו-9 סירובים.
#   2. 5 החלפות ברירת מחדל במקביל (אותה חנות / מוצר / סוג) → כולן מצליחות,
#      ובסוף יש בדיוק ברירת מחדל אחת.
# שימוש:  bash scripts/db-tests/licenses-concurrency.sh   (אחרי run.sh — אותו Postgres)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
DB=conc_lic
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
FAILED=0
PASSED=0
A=70000000-0000-0000-0000-00000000000a

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null

HASH=$(printf %s 'conc-token' | sha256sum | cut -d' ' -f1)
"${Q[@]}" >/dev/null <<SQL
INSERT INTO public.license_files (id, tenant_id, product, kind, storage_path, file_name, size_bytes, is_default) VALUES
  ('1c000000-0000-0000-0000-0000000000d1', '$A', 'office', 'installer', '$A/1c000000-0000-0000-0000-0000000000d1.exe', 'a.exe', 10, true),
  ('1c000000-0000-0000-0000-0000000000d2', '$A', 'office', 'installer', '$A/1c000000-0000-0000-0000-0000000000d2.exe', 'b.exe', 10, false),
  ('1c000000-0000-0000-0000-0000000000d3', '$A', 'office', 'installer', '$A/1c000000-0000-0000-0000-0000000000d3.exe', 'c.exe', 10, false);
INSERT INTO public.license_deliveries (id, tenant_id, idempotency_key, product, customer_name, customer_email, customer_phone,
  key_ciphertext, key_tail, key_fingerprint, installer_file_id)
VALUES ('1d000000-0000-0000-0000-0000000000d1', '$A', gen_random_uuid(), 'office', 'מקביל', 'conc@example.com', '0500000000',
        'v1:eA==', 'AAAAA', repeat('e', 64), '1c000000-0000-0000-0000-0000000000d1');
INSERT INTO public.license_download_links (id, tenant_id, delivery_id, file_id, token_hash, expires_at)
VALUES ('1e000000-0000-0000-0000-0000000000d1', '$A', '1d000000-0000-0000-0000-0000000000d1',
        '1c000000-0000-0000-0000-0000000000d1', '$HASH', now() + interval '7 days');
SQL

q() { "${Q[@]}" -c "$1"; }
check() { # check <label> <sql returning t>
  if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1"; FAILED=$((FAILED + 1)); fi
}
expect_eq() { # expect_eq <label> <actual> <expected>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1 (got $2, expected $3)"; FAILED=$((FAILED + 1)); fi
}
# the app server: service role, the store comes from the request host (x-tenant-id)
AS_SERVER="SET ROLE service_role; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$A\"}', false);"

# parallel <name> <sql>... — one session per SQL, all released at the same moment
parallel() {
  local name=$1; shift
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  "${PG[@]}" -d "$DB" -c "SELECT pg_advisory_lock(4343)" -c "SELECT pg_sleep(1)" -c "SELECT pg_advisory_unlock(4343)" >/dev/null &
  sleep 0.3
  local i=0
  for s in "$@"; do
    i=$((i + 1))
    ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 \
        -c "SELECT pg_advisory_lock_shared(4343); SELECT pg_advisory_unlock_shared(4343);" -c "$s" \
        > "$TMP/$name/$i.out" 2> "$TMP/$name/$i.err"; echo $? > "$TMP/$name/$i.rc" ) &
  done
  wait
}
results() { cat "$TMP/$1"/*.out 2>/dev/null | grep -c "^RESULT:$2$" || true; }
rc_ok() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }

echo "1. 12 simultaneous downloads of one link (limit 3)"
CONSUME="$AS_SERVER SELECT 'RESULT:' || (public.license_consume_download('$HASH')->>'ok');"
parallel downloads "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME" \
                   "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME" "$CONSUME"
expect_eq "every session finished without an error" "$(rc_ok downloads)" "12"
expect_eq "exactly 3 downloads succeeded" "$(results downloads true)" "3"
expect_eq "exactly 9 were refused" "$(results downloads false)" "9"
check "the counter stopped at the limit (3)" \
  "SELECT download_count = 3 FROM public.license_download_links WHERE id = '1e000000-0000-0000-0000-0000000000d1'"
check "the log has exactly 3 downloads and 9 refusals" \
  "SELECT (SELECT count(*) FROM public.license_audit WHERE action = 'download') = 3
      AND (SELECT count(*) FROM public.license_audit WHERE action = 'download_denied' AND details->>'state' = 'exhausted') = 9"

echo "2. 5 simultaneous switches of the default installer"
SET2="$AS_SERVER SELECT 'RESULT:' || public.license_set_default_file('1c000000-0000-0000-0000-0000000000d2');"
SET3="$AS_SERVER SELECT 'RESULT:' || public.license_set_default_file('1c000000-0000-0000-0000-0000000000d3');"
SET1="$AS_SERVER SELECT 'RESULT:' || public.license_set_default_file('1c000000-0000-0000-0000-0000000000d1');"
parallel defaults "$SET2" "$SET3" "$SET2" "$SET3" "$SET1"
expect_eq "every switch finished without an error (no unique violation)" "$(rc_ok defaults)" "5"
expect_eq "every switch reported success" "$(results defaults true)" "5"
check "exactly one default installer remains" \
  "SELECT count(*) = 1 FROM public.license_files WHERE tenant_id = '$A' AND product = 'office' AND kind = 'installer' AND is_default"

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
rm -rf "$TMP"
echo "license concurrency: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]

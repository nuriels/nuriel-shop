#!/usr/bin/env bash
# ============================================================
# חבילת כלה (אפיון — docs/hospitality/bridal-package-spec.md): בדיקה שמנגנון החבילות הקיים (מיגרציה 59) כבר מבטיח
# את מה שהחבילה צריכה — בלי שום שינוי קוד. מסד חד-פעמי (bridal_test), מקומי / CI בלבד, על אותו Postgres של run.sh.
#   חבילה "special" על יחידה אחת ("VIP"), 2 לילות, 4,000 ₪ — מוגדרת כמו שהמסך הקיים שומר אותה.
#   1. שתי כלות במקביל, אותו תאריך → בדיוק אחת מצליחה (EXCLUDE במסד, לא רק בממשק)
#   2. חבילה + הזמנה רגילה של אותה יחידה במקביל → בדיוק אחת
#   3. הזמנה רגילה שתופסת רק את הלילה השני → החבילה לא זמינה (שני הלילות נבדקים)
#   4. ה-VIP חלק מ"כל המתחם" — אחרי החבילה "כל המתחם" לא זמין באותם לילות
#   5. המחיר — 4,000 ₪ קבוע לשני לילות (לא מהתעריף), והעזיבה — אחרי שני לילות בדיוק
#   6. מיגרציה 202 סוגרת את הפער: חדר נוסף לחבילה — במחיר קבוע של 1,200 ₪ ללילה, באותם לילות, והכול בבקשה אחת
#   7. שתי כלות (שתי חבילות על יחידות שונות) על אותו חדר נוסף, במקביל → בדיוק אחת מקבלת אותו; השנייה — שום הזמנה
#   8. כלה עם חדר נוסף מול אורח רגיל על אותו חדר, במקביל → בדיוק אחת; אם האורח זכה — גם ה-VIP לא נתפס (הכול או כלום)
#   9. 10 בקשות במקביל (5 כלות עם החדר הנוסף + 5 אורחים על החדר) → בדיוק בקשה אחת מצליחה, ואין חבילה בלי החדר שלה
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
PORT=${PGPORT:-5499}
DB=bridal_test
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILED=0
PASSED=0
"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null
"${Q[@]}" -f "$HERE/concurrency/setup.sql" >/dev/null
SITE=$("${Q[@]}" -c "SELECT id FROM public.tenants WHERE slug = 'conc-site'")
# כל חיבור חדש למסד הבדיקה — באתר הזה (כמו x-tenant-id ש-PostgREST מעביר), גם לבדיקות ההצעה (quote)
"${PG[@]}" -d postgres -c "ALTER DATABASE $DB SET request.headers = '{\"x-tenant-id\": \"$SITE\"}'" >/dev/null
q() { "${Q[@]}" -c "$1"; }
check() { if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1"; FAILED=$((FAILED + 1)); fi; }
as_guest() { echo "SET ROLE service_role; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false);"; }
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
ok_count() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }
err_count() { grep -l -- "$2" "$TMP/$1"/*.err 2>/dev/null | wc -l | tr -d ' '; }

# "VIP" = יחידה 21 (חלק מ"כל המתחם 1"); חדרים נוספים אפשריים = 22 (באותו מתחם), 25
VIP=c2000000-0000-0000-0000-000000000021
WHOLE=c2000000-0000-0000-0000-0000000000f1
PKG=b1000000-0000-0000-0000-0000000000b1
q "UPDATE hospitality.units SET base_price = 1400, capacity = 2 WHERE id = '$VIP'" >/dev/null
q "INSERT INTO hospitality.packages (id, tenant_id, unit_id, kind, name, slug, description, nights, price, max_guests, is_active)
   VALUES ('$PKG', '$SITE', '$VIP', 'special', 'חבילת כלה – נופי דורית VIP', 'bridal', 'בדיקה', 2, 4000, 2, true)" >/dev/null
q "CREATE OR REPLACE FUNCTION conc.bride(_in integer, _email text, _key text) RETURNS jsonb LANGUAGE sql AS \$\$
     SELECT hospitality.request_booking_package(
       _package_id => '$PKG', _check_in => current_date + _in, _full_name => 'כלה מקבילית', _email => _email,
       _phone => '05' || lpad((abs(hashtext(_email)) % 100000000)::text, 8, '0'), _idempotency_key => _key,
       _policy_accepted => true,
       _policy_hash => hospitality.package_quote('$PKG', current_date + _in) ->> 'policy_hash') \$\$;
   GRANT EXECUTE ON FUNCTION conc.bride(integer, text, text) TO service_role;" >/dev/null

echo "bridal package on the existing package engine ($DB)"

# ---- 1. two brides, same dates, at the same moment ----
parallel b1 "$(as_guest) SELECT conc.bride(60, 'bride1@example.com', 'b1-key-a');" \
            "$(as_guest) SELECT conc.bride(60, 'bride2@example.com', 'b1-key-b');"
check "1  two brides in parallel, same check-in → exactly one succeeds, the other is told the dates are taken" \
  "SELECT $(ok_count b1) = 1 AND $(err_count b1 'כבר לא פנויים') = 1"
check "1  … and the database holds exactly two occupied nights on the VIP (one booking)" \
  "SELECT count(*) = 1 AND sum(upper(nights) - lower(nights)) = 2 FROM hospitality.unit_occupancy
    WHERE unit_id = '$VIP' AND lower(nights) = current_date + 60"

# ---- 2. a bride and a regular guest, same unit, overlapping nights, at the same moment ----
parallel b2 "$(as_guest) SELECT conc.bride(70, 'bride3@example.com', 'b2-key-a');" \
            "$(as_guest) SELECT conc.req('$VIP', 71, 73, 'guest2@example.com', 'b2-key-b');"
check "2  bride package + regular booking of the VIP in parallel → exactly one succeeds" \
  "SELECT $(ok_count b2) = 1 AND $(err_count b2 'כבר לא פנויים') = 1"

# ---- 3. only the second night is taken ----
q "$(as_guest) SELECT conc.req('$VIP', 81, 82, 'guest3@example.com', 'b3-key-guest');" >/dev/null
check "3  a booking of only the 2nd night → the package for that check-in is unavailable (both nights checked)" \
  "SELECT NOT (hospitality.package_quote('$PKG', current_date + 80) ->> 'available')::boolean"
check "3  … and a direct request is refused by the database, not only by the screen" \
  "SELECT (SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = '$VIP' AND lower(nights) = current_date + 80) = 0"
if q "$(as_guest) SELECT conc.bride(80, 'bride4@example.com', 'b3-key-bride-1');" >/dev/null 2>"$TMP/b3.err"; then
  echo "  FAIL 3  the package was booked over a taken night"; FAILED=$((FAILED + 1))
else
  grep -q "כבר לא פנויים" "$TMP/b3.err" && { echo "  ok   3  request_booking_package refuses it: the dates are taken"; PASSED=$((PASSED + 1)); } \
    || { echo "  FAIL 3  unexpected error: $(cat "$TMP/b3.err")"; FAILED=$((FAILED + 1)); }
fi

# ---- 4. the VIP is part of "the whole property" ----
q "$(as_guest) SELECT conc.bride(90, 'bride5@example.com', 'b4-key-bride');" >/dev/null
check "4  after the package, the whole property (which includes the VIP) is unavailable on those nights" \
  "SELECT NOT (hospitality.quote('$WHOLE', current_date + 90, current_date + 92) ->> 'available')::boolean"
check "4  … while another unit of the property stays bookable (extra room for companions)" \
  "SELECT (hospitality.quote('c2000000-0000-0000-0000-000000000022', current_date + 90, current_date + 92) ->> 'available')::boolean"

# ---- 5. price and nights ----
check "5  the package price is fixed: 4,000 for 2 nights (not 2 × the 1,400 nightly rate), check-out = check-in + 2" \
  "SELECT b.total = 4000 AND b.check_out - b.check_in = 2 AND b.package_snapshot ->> 'nights' = '2'
     FROM hospitality.bookings b WHERE b.package_id = '$PKG' AND b.check_in = current_date + 90"
check "5  the quote shows the same total before the guest confirms" \
  "SELECT (hospitality.package_quote('$PKG', current_date + 100) ->> 'total')::numeric = 4000"

# ---- 6. migration 202: an add-on room for the package — 1,200 a night, the same nights, in the same request ----
ADIR=c2000000-0000-0000-0000-000000000022
PKG2=b1000000-0000-0000-0000-0000000000b2
q "UPDATE hospitality.packages SET addon_unit_ids = ARRAY['$ADIR']::uuid[], addon_nightly_price = 1200, addon_max = 1
    WHERE id = '$PKG'" >/dev/null
# a second package on another unit (25) that offers the same add-on room — to make two brides compete for it
q "INSERT INTO hospitality.packages (id, tenant_id, unit_id, kind, name, slug, nights, price, max_guests, is_active,
                                     addon_unit_ids, addon_nightly_price, addon_max)
   VALUES ('$PKG2', '$SITE', 'c2000000-0000-0000-0000-000000000025', 'special', 'חבילה שנייה', 'bridal-2', 2, 3000, 2, true,
           ARRAY['$ADIR']::uuid[], 1200, 1)" >/dev/null
q "CREATE OR REPLACE FUNCTION conc.bride_room(_pkg uuid, _in integer, _email text, _key text) RETURNS jsonb LANGUAGE sql AS \$\$
     SELECT hospitality.request_booking_package_with_rooms(
       _package_id => _pkg, _check_in => current_date + _in,
       _rooms => jsonb_build_array(jsonb_build_object('unit_id', '$ADIR', 'adults', 2, 'children', 0)),
       _full_name => 'כלה עם חדר', _email => _email,
       _phone => '05' || lpad((abs(hashtext(_email)) % 100000000)::text, 8, '0'), _idempotency_key => _key,
       _policy_accepted => true,
       _policy_hash => hospitality.package_rooms_quote(_pkg, current_date + _in, 2, 0,
                         jsonb_build_array(jsonb_build_object('unit_id', '$ADIR', 'adults', 2, 'children', 0))) ->> 'policy_hash') \$\$;
   GRANT EXECUTE ON FUNCTION conc.bride_room(uuid, integer, text, text) TO service_role;" >/dev/null
check "6  the package + the add-on room: 4,000 + 1,200 × 2 = 6,400, computed in the database; the room alone at its rate stays 1,000" \
  "SELECT (hospitality.package_rooms_quote('$PKG', current_date + 100, 2, 0,
             jsonb_build_array(jsonb_build_object('unit_id', '$ADIR'))) ->> 'grand_total')::numeric = 6400
      AND (hospitality.quote('$ADIR', current_date + 100, current_date + 102) ->> 'total')::numeric = 1000"

# ---- 7. two brides (two packages) want the same add-on room at the same moment ----
parallel b7 "$(as_guest) SELECT conc.bride_room('$PKG', 110, 'bride7a@example.com', 'b7-key-a');" \
            "$(as_guest) SELECT conc.bride_room('$PKG2', 110, 'bride7b@example.com', 'b7-key-b');"
check "7  two brides, the same add-on room, in parallel → exactly one gets it; the other is told the room is taken" \
  "SELECT $(ok_count b7) = 1 AND $(err_count b7 'כבר לא פנוי') = 1"
check "7  … and the loser has no booking at all — her package unit stays free (all or nothing)" \
  "SELECT (SELECT count(*) FROM hospitality.bookings WHERE idempotency_key LIKE 'b7-key-%') = 2
      AND (SELECT count(DISTINCT group_id) FROM hospitality.bookings WHERE idempotency_key LIKE 'b7-key-%') = 1
      AND (SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = '$ADIR' AND lower(nights) = current_date + 110) = 1"

# ---- 8. a bride with the add-on room vs a regular guest on that room, at the same moment ----
parallel b8 "$(as_guest) SELECT conc.bride_room('$PKG', 120, 'bride8@example.com', 'b8-key-a');" \
            "$(as_guest) SELECT conc.req('$ADIR', 121, 123, 'guest8@example.com', 'b8-key-b');"
check "8  bride + add-on room vs a regular guest on the room → exactly one succeeds" \
  "SELECT $(ok_count b8) = 1"
check "8  … if the guest won, the VIP is not held either; if the bride won, she holds both (never the package alone)" \
  "SELECT CASE WHEN EXISTS (SELECT 1 FROM hospitality.bookings WHERE idempotency_key = 'b8-key-b')
               THEN NOT EXISTS (SELECT 1 FROM hospitality.bookings WHERE idempotency_key LIKE 'b8-key-a%')
                    AND NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy WHERE unit_id = '$VIP' AND lower(nights) = current_date + 120)
               ELSE (SELECT count(*) FROM hospitality.bookings WHERE idempotency_key LIKE 'b8-key-a-%') = 2 END"

# ---- 9. ten requests at the same moment ----
B9=()
for i in 1 2 3 4 5; do
  B9+=("$(as_guest) SELECT conc.bride_room('$PKG', 130, 'bride9$i@example.com', 'b9-key-bride$i');")
  B9+=("$(as_guest) SELECT conc.req('$ADIR', 130, 132, 'guest9$i@example.com', 'b9-key-guest$i');")
done
parallel b9 "${B9[@]}"
check "9  10 requests in parallel (5 brides with the room + 5 guests on the room) → exactly one succeeds" \
  "SELECT $(ok_count b9) = 1"
check "9  … the room is held once, and no bride holds the VIP without her room" \
  "SELECT (SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = '$ADIR' AND lower(nights) = current_date + 130) = 1
      AND NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.idempotency_key LIKE 'b9-key-bride%'
                        AND NOT EXISTS (SELECT 1 FROM hospitality.bookings x WHERE x.group_id = b.group_id AND x.unit_id = '$ADIR'))"

"${PG[@]}" -d postgres -c "DROP DATABASE $DB" >/dev/null 2>&1 || true
echo "bridal package availability: $PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ]

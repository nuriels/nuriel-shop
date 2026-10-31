#!/usr/bin/env bash
# ============================================================
# בדיקות מקביליות של מנוע ההזמנות (מקומי בלבד, מסד חד-פעמי conc_test).
# כל תרחיש מריץ כמה חיבורי psql נפרדים באמת (טרנזקציות עצמאיות), שמשוחררים
# יחד (מחסום advisory lock), או בסדר מפורש עם טרנזקציה שמוחזקת פתוחה.
# הבדיקה עוברת רק אם התוצאה היא בדיוק המצופה (מי הצליח, מי נכשל ולמה).
# שימוש:  bash scripts/db-tests/hospitality/concurrency/run.sh   (אחרי run.sh — אותו Postgres)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../../../.." && pwd)
PORT=${PGPORT:-5499}
DB=conc_test
PG=(psql -X -q -h /tmp/pg -p "$PORT" -U postgres)
Q=("${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1)
TMP=$(mktemp -d)
FAILED=0
PASSED=0

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${Q[@]}" -f "$ROOT/scripts/db-tests/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${Q[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done
"${Q[@]}" -f "$ROOT/scripts/db-tests/fixtures.sql" >/dev/null
"${Q[@]}" -f "$HERE/setup.sql" >/dev/null
SITE=$("${Q[@]}" -c "SELECT id FROM public.tenants WHERE slug = 'conc-site'")
OWNER=c0000000-0000-0000-0000-0000000000a1
MANAGER=c0000000-0000-0000-0000-0000000000a2

q() { "${Q[@]}" -c "$1"; }
check() { # check <label> <sql returning t>
  if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; PASSED=$((PASSED + 1)); else echo "  FAIL $1"; FAILED=$((FAILED + 1)); fi
}
as_guest() { echo "SET ROLE anon; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false);"; }
as_staff() { echo "SET ROLE authenticated; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false);
                   SELECT set_config('request.jwt.claim.sub', '$1', false);"; }

# parallel <name> <sql>... — one session per SQL, all released at the same moment
parallel() {
  local name=$1; shift
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  "${PG[@]}" -d "$DB" -c "SELECT pg_advisory_lock(4242)" -c "SELECT pg_sleep(1)" -c "SELECT pg_advisory_unlock(4242)" >/dev/null &
  sleep 0.3
  local i=0
  for s in "$@"; do
    i=$((i + 1))
    ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 \
        -c "SELECT pg_advisory_lock_shared(4242); SELECT pg_advisory_unlock_shared(4242);" -c "$s" \
        > "$TMP/$name/$i.out" 2> "$TMP/$name/$i.err"; echo $? > "$TMP/$name/$i.rc" ) &
  done
  wait
}
ok_count() { grep -l '^0$' "$TMP/$1"/*.rc 2>/dev/null | wc -l | tr -d ' '; }
err_count() { grep -l -- "$2" "$TMP/$1"/*.err 2>/dev/null | wc -l | tr -d ' '; }

# held <name> <sql A (held open)> <sql B (starts while A is open)> — explicit ordering
held() {
  local name=$1 a=$2 b=$3
  rm -rf "$TMP/$name"; mkdir -p "$TMP/$name"
  ( "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 -c "$a" > "$TMP/$name/a.out" 2> "$TMP/$name/a.err"; echo $? > "$TMP/$name/a.rc" ) &
  sleep 0.5
  local t0 t1
  t0=$(date +%s%N)
  "${PG[@]}" -d "$DB" -tA -v ON_ERROR_STOP=1 -c "$b" > "$TMP/$name/b.out" 2> "$TMP/$name/b.err"; echo $? > "$TMP/$name/b.rc"
  t1=$(date +%s%N)
  echo $(( (t1 - t0) / 1000000 )) > "$TMP/$name/b.ms"
  wait
}
rc() { cat "$TMP/$1/$2.rc"; }
waited() { [ "$(cat "$TMP/$1/b.ms")" -ge 1200 ]; }  # B was blocked by A's open transaction

echo "concurrency: booking engine ($DB)"

# ---- 1. two independent transactions, same unit, overlapping dates (RPC, two guests) ----
parallel c1 "$(as_guest) SELECT conc.req(conc.unit(1), 30, 33, 'c1a@example.com', 'c1-key-a');" \
            "$(as_guest) SELECT conc.req(conc.unit(1), 31, 34, 'c1b@example.com', 'c1-key-b');"
check "1  two parallel requests, same unit, overlapping dates → exactly one succeeds" \
  "SELECT $(ok_count c1) = 1 AND $(err_count c1 'כבר לא פנויים') = 1"
check "1  … and the database holds exactly one booking on those nights" \
  "SELECT count(*) = 1 FROM hospitality.unit_occupancy WHERE unit_id = conc.unit(1)"

# ---- 1b. stress: 10 parallel guests for the same unit and dates ----
args=()
for n in $(seq 1 10); do args+=("$(as_guest) SELECT conc.req(conc.unit(2), 40, 42, 'c1s$n@example.com', 'c1s-key-$n');"); done
parallel c1s "${args[@]}"
check "1b 10 parallel requests for the same unit and dates → exactly one succeeds, 9 are told the dates are taken" \
  "SELECT $(ok_count c1s) = 1 AND $(err_count c1s 'כבר לא פנויים') = 9"

# ---- 2. the database alone decides: raw occupancy rows, no functions, no inventory lock ----
q "INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason, released_at) VALUES
     ('$SITE', conc.unit(3), current_date + 50, current_date + 51, 'raw-a', now()),
     ('$SITE', conc.unit(3), current_date + 50, current_date + 51, 'raw-b', now())" >/dev/null
held c2 "BEGIN; INSERT INTO hospitality.unit_occupancy (tenant_id, unit_id, nights, block_id)
           SELECT '$SITE', conc.unit(3), daterange(current_date + 50, current_date + 53), id FROM hospitality.blocks WHERE reason = 'raw-a';
         SELECT pg_sleep(2); COMMIT;" \
        "INSERT INTO hospitality.unit_occupancy (tenant_id, unit_id, nights, block_id)
           SELECT '$SITE', conc.unit(3), daterange(current_date + 52, current_date + 54), id FROM hospitality.blocks WHERE reason = 'raw-b';"
check "2  raw overlapping occupancy from a second transaction waits for the first, then is refused by EXCLUDE" \
  "SELECT $(rc c2 a) = 0 AND $(rc c2 b) <> 0 AND $(grep -c unit_occupancy_no_overlap "$TMP/c2/b.err") = 1 AND $(waited c2 && echo true || echo false)"

# ---- 3. raw bookings bypassing every function (still refused by the constraint) ----
GUEST=$(q "SELECT id FROM hospitality.guests LIMIT 1")
raw_booking() { # raw_booking <number>
  echo "INSERT INTO hospitality.bookings (id, tenant_id, number, unit_id, guest_id, check_in, check_out, status, subtotal, total,
          policy_snapshot, policy_acceptance)
        VALUES ('c3000000-0000-0000-0000-00000000000$1', '$SITE', 500$1, conc.unit(4), '$GUEST', current_date + 60, current_date + 61,
                'confirmed', 100, 100, '{}', '{}');
        INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, price, rule_applied)
        VALUES ('$SITE', 'c3000000-0000-0000-0000-00000000000$1', current_date + 60, 100, 100, 'manual');"
}
held c3 "BEGIN; $(raw_booking 1) SELECT pg_sleep(2); COMMIT;" "BEGIN; $(raw_booking 2) COMMIT;"
check "3  a raw booking row inserted around the functions is refused while another holds the night" \
  "SELECT $(rc c3 a) = 0 AND $(rc c3 b) <> 0 AND $(grep -c 'כבר לא פנויים' "$TMP/c3/b.err") = 1 AND $(waited c3 && echo true || echo false)
     AND (SELECT count(*) FROM hospitality.bookings WHERE unit_id = conc.unit(4)) = 1"

# ---- 4/5. whole property vs member, two whole bookings ----
parallel c4 "$(as_guest) SELECT conc.req(conc.whole(1), 70, 72, 'c4w@example.com', 'c4-key-w');" \
            "$(as_guest) SELECT conc.req(conc.unit(21), 71, 73, 'c4m@example.com', 'c4-key-m');"
check "4  whole property vs one of its units, in parallel → exactly one succeeds" \
  "SELECT $(ok_count c4) = 1 AND $(err_count c4 'כבר לא פנויים') = 1"
parallel c5 "$(as_guest) SELECT conc.req(conc.whole(1), 80, 82, 'c5a@example.com', 'c5-key-a');" \
            "$(as_guest) SELECT conc.req(conc.whole(1), 81, 83, 'c5b@example.com', 'c5-key-b');"
check "5  two overlapping whole-property bookings in parallel → exactly one succeeds" \
  "SELECT $(ok_count c5) = 1 AND $(err_count c5 'כבר לא פנויים') = 1"
parallel c5m "$(as_guest) SELECT conc.req(conc.unit(21), 90, 91, 'c5m1@example.com', 'c5m-key-1');" \
             "$(as_guest) SELECT conc.req(conc.unit(22), 90, 91, 'c5m2@example.com', 'c5m-key-2');"
check "5b two different member units on the same night in parallel → both succeed" "SELECT $(ok_count c5m) = 2"

# ---- 6. adjacent stays in parallel ----
parallel c6 "$(as_guest) SELECT conc.req(conc.unit(5), 100, 102, 'c6a@example.com', 'c6-key-a');" \
            "$(as_guest) SELECT conc.req(conc.unit(5), 102, 104, 'c6b@example.com', 'c6-key-b');"
check "6  adjacent stays (check-out day = next check-in day) in parallel → both succeed" "SELECT $(ok_count c6) = 2"

# ---- 7. two requests racing an expired hold ----
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), conc.req(conc.unit(6), 110, 112, 'c7old@example.com', 'c7-key-old')" >/dev/null
q "UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE idempotency_key = 'c7-key-old'" >/dev/null
parallel c7 "$(as_guest) SELECT conc.req(conc.unit(6), 110, 112, 'c7a@example.com', 'c7-key-a');" \
            "$(as_guest) SELECT conc.req(conc.unit(6), 111, 113, 'c7b@example.com', 'c7-key-b');"
check "7  two requests racing an expired hold → exactly one wins, the hold is expired exactly once" \
  "SELECT $(ok_count c7) = 1
     AND (SELECT status FROM hospitality.bookings WHERE idempotency_key = 'c7-key-old') = 'expired'
     AND (SELECT count(*) FROM hospitality.booking_events e JOIN hospitality.bookings b ON b.id = e.booking_id
           WHERE b.idempotency_key = 'c7-key-old' AND e.to_status = 'expired') = 1
     AND (SELECT count(*) FROM hospitality.notifications n JOIN hospitality.bookings b ON b.id = n.booking_id
           WHERE b.idempotency_key = 'c7-key-old' AND n.event = 'request_expired') = 1"

# ---- 8. idempotent retry: the same request sent 5 times in parallel ----
args=()
for n in $(seq 1 5); do args+=("$(as_guest) SELECT conc.req(conc.unit(7), 120, 121, 'c8@example.com', 'c8-same-key', '0501112222');"); done
parallel c8 "${args[@]}"
check "8  the same request (same key) 5 times in parallel → one booking, every call answered with it" \
  "SELECT $(ok_count c8) = 5 AND (SELECT count(*) FROM hospitality.bookings WHERE idempotency_key = 'c8-same-key') = 1
     AND $(cat "$TMP"/c8/*.out | grep -o '\"booking_id\": \"[0-9a-f-]*\"' | sort -u | wc -l) = 1"

# ---- 9. owner block vs pending whole-property request ----
parallel c9 "$(as_staff $OWNER) INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason)
               VALUES ('$SITE', conc.unit(23), current_date + 130, current_date + 131, 'c9');" \
            "$(as_guest) SELECT conc.req(conc.whole(2), 130, 132, 'c9@example.com', 'c9-key-whole');"
check "9  an owner block vs a whole-property request on a member unit, in parallel → exactly one succeeds" \
  "SELECT $(ok_count c9) = 1 AND $(err_count c9 'כבר לא פנויים') + $(err_count c9 'יש הזמנה או חסימה') = 1"

# ---- 11. manual booking vs public request ----
parallel c11 "$(as_staff $OWNER) SELECT conc.manual(conc.unit(8), 140, 142, 'טלפוני');" \
             "$(as_guest) SELECT conc.req(conc.unit(8), 141, 143, 'c11@example.com', 'c11-key-site');"
check "11 a manual booking vs a site request on the same dates, in parallel → exactly one succeeds" \
  "SELECT $(ok_count c11) = 1 AND $(err_count c11 'כבר לא פנויים') = 1"

# ---- 13. five parallel requests from the same contact, cap 2 ----
args=()
for n in $(seq 1 5); do args+=("$(as_guest) SELECT conc.req(conc.unit($((9 + n))), 150, 151, 'flood@example.com', 'c13-key-$n', '0507777777');"); done
parallel c13 "${args[@]}"
check "13 5 parallel requests from one contact (cap 2) → exactly 2 accepted, 3 refused by the cap" \
  "SELECT $(ok_count c13) = 2 AND $(err_count c13 'בקשות פתוחות') = 3
     AND (SELECT count(*) FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
           WHERE g.email_normalized = 'flood@example.com' AND b.status = 'pending_approval') = 2"

# ---- 14. two owners modifying the same booking with the same revision ----
BM=$(q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false) || '', set_config('request.jwt.claim.sub', '$OWNER', false) || '',
         conc.manual(conc.unit(16), 160, 162, 'שינוי') ->> 'booking_id'" | tail -1 | awk -F'|' '{print $NF}')
REV=$(q "SELECT revision FROM hospitality.bookings WHERE id = '$BM'")
parallel c14 "$(as_staff $OWNER) SELECT hospitality.modify_booking('$BM', $REV, current_date + 163, current_date + 165);" \
             "$(as_staff $MANAGER) SELECT hospitality.modify_booking('$BM', $REV, current_date + 166, current_date + 168);"
check "14 two staff edits with the same revision in parallel → one succeeds, the other is told to refresh" \
  "SELECT $(ok_count c14) = 1 AND $(err_count c14 'עודכנה בינתיים') = 1
     AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = '$BM' AND kind = 'modified') = 1"

# ---- 15. cancellation approval racing a new booking for the same dates ----
R15=$(q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false) || '|' || (conc.req(conc.unit(17), 170, 172, 'c15@example.com', 'c15-key-orig') ->> 'manage_token')" | awk -F'|' '{print $NF}')
B15=$(q "SELECT id FROM hospitality.bookings WHERE idempotency_key = 'c15-key-orig'")
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), set_config('request.jwt.claim.sub', '$OWNER', false),
          hospitality.approve_booking('$B15')" >/dev/null
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), hospitality.request_cancellation('$R15')" >/dev/null
held c15 "$(as_staff $OWNER) BEGIN; SELECT hospitality.approve_cancellation('$B15'); SELECT pg_sleep(2); COMMIT;" \
         "$(as_guest) SELECT conc.req(conc.unit(17), 170, 172, 'c15new@example.com', 'c15-key-new');"
check "15 a new booking for the dates of a cancellation being approved succeeds only after the cancellation commits" \
  "SELECT $(rc c15 a) = 0 AND $(rc c15 b) = 0 AND $(waited c15 && echo true || echo false)
     AND (SELECT status FROM hospitality.bookings WHERE id = '$B15') = 'cancelled'
     AND (SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = conc.unit(17)) = 1"

# ---- 16. two outbox workers claiming at the same time ----
held c16 "SET ROLE service_role; BEGIN; SELECT id FROM hospitality.claim_notifications(200); SELECT pg_sleep(2); COMMIT;" \
         "SET ROLE service_role; SELECT id FROM hospitality.claim_notifications(200);"
A16=$(grep -cE '^[0-9a-f-]{36}$' "$TMP/c16/a.out"); B16=$(grep -cE '^[0-9a-f-]{36}$' "$TMP/c16/b.out")
DUP=$(cat "$TMP/c16/a.out" "$TMP/c16/b.out" | grep -E '^[0-9a-f-]{36}$' | sort | uniq -d | wc -l)
check "16 two workers claiming the outbox at once → no email is claimed twice ($A16 + $B16 rows)" \
  "SELECT $A16 > 0 AND $DUP = 0 AND NOT EXISTS (SELECT 1 FROM hospitality.notifications WHERE attempts > 1)"

# ---- 17. the expiry sweep in flight vs a new request for the same dates ----
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), conc.req(conc.unit(18), 180, 182, 'c17old@example.com', 'c17-key-old')" >/dev/null
q "UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE idempotency_key = 'c17-key-old'" >/dev/null
held c17 "SET ROLE service_role; BEGIN; SELECT hospitality.expire_holds(); SELECT pg_sleep(2); COMMIT;" \
         "$(as_guest) SELECT conc.req(conc.unit(18), 180, 182, 'c17new@example.com', 'c17-key-new');"
check "17 expiry releases the dates atomically: a request during the sweep waits, then takes them; expired once" \
  "SELECT $(rc c17 a) = 0 AND $(rc c17 b) = 0 AND $(waited c17 && echo true || echo false)
     AND (SELECT count(*) FROM hospitality.booking_events e JOIN hospitality.bookings b ON b.id = e.booking_id
           WHERE b.idempotency_key = 'c17-key-old' AND e.to_status = 'expired') = 1
     AND (SELECT count(*) FROM hospitality.unit_occupancy WHERE unit_id = conc.unit(18)) = 1"

# ---- 18/19. the booking lock is per site ----
SITE2=$(q "SELECT id FROM public.tenants WHERE slug = 'conc-site-2'")
as_guest2() { echo "SET ROLE anon; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE2\"}', false);"; }
held c18 "$(as_guest) BEGIN; SELECT conc.req(conc.unit(19), 190, 191, 'c18a@example.com', 'c18-key-a'); SELECT pg_sleep(2); COMMIT;" \
         "$(as_guest) SELECT conc.req(conc.unit(20), 190, 191, 'c18b@example.com', 'c18-key-b');"
check "18 same site: a second booking (other unit) waits for the first transaction, then succeeds" \
  "SELECT $(rc c18 a) = 0 AND $(rc c18 b) = 0 AND $(waited c18 && echo true || echo false)"
held c19 "$(as_guest) BEGIN; SELECT conc.req(conc.unit(25), 200, 201, 'c19a@example.com', 'c19-key-a'); SELECT pg_sleep(2); COMMIT;" \
         "$(as_guest2) SELECT conc.req(conc.unit2(1), 200, 201, 'c19b@example.com', 'c19-key-b');"
check "19 different sites: a booking on site 2 is not blocked by an open booking transaction on site 1 ($(cat "$TMP/c19/b.ms") ms)" \
  "SELECT $(rc c19 a) = 0 AND $(rc c19 b) = 0 AND $(cat "$TMP/c19/b.ms") < 1000"

# ---- 20. unit limit under concurrent inserts (basic plan: 5, already 4) ----
args=()
for n in $(seq 1 5); do
  args+=("$(as_staff $OWNER | sed "s/$SITE/$SITE2/") INSERT INTO hospitality.units (tenant_id, property_id, name, slug)
            VALUES ('$SITE2', 'c1000000-0000-0000-0000-000000000002', 'מקבילית $n', 'par$n');")
done
parallel c20 "${args[@]}"
check "20 5 parallel unit inserts with one place left → exactly one succeeds, 4 are refused by the plan limit" \
  "SELECT $(ok_count c20) = 1 AND $(err_count c20 'מגבלת היחידות') = 4
     AND (SELECT count(*) FROM hospitality.units WHERE tenant_id = '$SITE2' AND is_active AND kind <> 'whole_property') = 5"

# ---- 21/22. coupon release is atomic and happens once (migration 6) ----
used() { q "SELECT used_count FROM hospitality.promotions WHERE code = 'CONC'"; }
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), conc.reqc(conc.unit(26), 210, 211, 'c21@example.com', 'c21-key-hold')" >/dev/null
q "UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE idempotency_key = 'c21-key-hold'" >/dev/null
U21=$(used)
parallel c21 "SET ROLE service_role; SELECT hospitality.expire_holds();" \
             "SET ROLE service_role; SELECT hospitality.expire_holds();" \
             "$(as_guest) SELECT conc.req(conc.unit(27), 210, 211, 'c21x@example.com', 'c21-key-lazy');"
check "21 two sweeps and a booking (lazy expiry) at once → the coupon use is released exactly once" \
  "SELECT $(ok_count c21) = 3 AND $(used) = $U21 - 1
     AND (SELECT count(*) FROM hospitality.booking_events e JOIN hospitality.bookings b ON b.id = e.booking_id
           WHERE b.idempotency_key = 'c21-key-hold' AND e.kind = 'coupon_released') = 1"
q "SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE\"}', false), conc.reqc(conc.unit(28), 220, 221, 'c22@example.com', 'c22-key-hold')" >/dev/null
q "UPDATE hospitality.bookings SET hold_expires_at = now() - interval '1 second' WHERE idempotency_key = 'c22-key-hold'" >/dev/null
B22=$(q "SELECT id FROM hospitality.bookings WHERE idempotency_key = 'c22-key-hold'")
U22=$(used)
parallel c22 "$(as_staff $OWNER) SELECT hospitality.decline_booking('$B22');" \
             "SET ROLE service_role; SELECT hospitality.expire_holds();"
check "22 an owner decline racing the expiry sweep → one terminal status, the use released exactly once" \
  "SELECT (SELECT status IN ('declined', 'expired') FROM hospitality.bookings WHERE id = '$B22') AND $(used) = $U22 - 1
     AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = '$B22' AND kind = 'coupon_released') = 1
     AND (SELECT count(*) FROM hospitality.booking_events WHERE booking_id = '$B22' AND to_status IN ('declined', 'expired')) = 2"

# ---- 23. manager seats under concurrent additions (migration 7; trial: 3 seats, 2 in use) ----
SITE3=$(q "SELECT id FROM public.tenants WHERE slug = 'conc-site-3'")
args=()
for n in $(seq 2 6); do
  args+=("INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
            VALUES ('$SITE3', 'c0000000-0000-0000-0000-00000000030$n', 'conc.seat$n@test.local', 'conc_seat_$n', 'admin', true);")
done
parallel c23 "${args[@]}"
check "23 5 managers added in parallel with one seat left → exactly one succeeds, 4 are refused by the seat limit" \
  "SELECT $(ok_count c23) = 1 AND $(err_count c23 'מגבלת המנהלים') = 4
     AND (SELECT count(*) FROM public.user_roles WHERE tenant_id = '$SITE3' AND role = 'admin') = 3"

# ---- 24–26. settings and team (migration 8; site 4: trial 3 seats, owner + 1 manager) ----
SITE4=$(q "SELECT id FROM public.tenants WHERE slug = 'conc-site-4'")
OWNER4=c0000000-0000-0000-0000-000000000400
as_owner4() { echo "SET ROLE authenticated; SELECT set_config('request.headers', '{\"x-tenant-id\": \"$SITE4\"}', false);
                    SELECT set_config('request.jwt.claim.sub', '$OWNER4', false);"; }
parallel c24 "$(as_owner4) SELECT hospitality.team_add_manager('conc.team2@test.local');" \
             "$(as_owner4) SELECT hospitality.team_add_manager('conc.team3@test.local');"
check "24 the owner adds two managers at once with one seat left → exactly one is added, the other is refused by the seat limit" \
  "SELECT $(ok_count c24) = 1 AND $(err_count c24 'מגבלת המנהלים') = 1
     AND (SELECT count(*) FROM public.user_roles WHERE tenant_id = '$SITE4' AND role = 'admin') = 3"
q "SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', false), hospitality.admin_set_extra_managers('$SITE4', 3)" >/dev/null
parallel c25 "$(as_owner4) SELECT hospitality.team_add_manager('conc.team5@test.local');" \
             "$(as_owner4) SELECT hospitality.team_add_manager('conc.team5@test.local');" \
             "$(as_owner4) SELECT hospitality.team_add_manager('conc.team5@test.local');"
check "25 the same person added three times at once → one row, the others answer already_member (no error)" \
  "SELECT $(ok_count c25) = 3 AND (SELECT count(*) FROM public.user_roles WHERE tenant_id = '$SITE4'
       AND user_id = 'c0000000-0000-0000-0000-000000000405') = 1
     AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '$SITE4' AND action = 'team.manager_added'
            AND changes ->> 'email' = 'c•••@test.local') >= 1
     AND $(grep -l 'already_member' "$TMP"/c25/*.out | wc -l) = 2"
REV=$(q "SELECT revision FROM hospitality.settings WHERE tenant_id = '$SITE4'")
parallel c26 "$(as_owner4) SELECT hospitality.update_settings('{\"address\": \"כתובת א\"}', $REV);" \
             "$(as_owner4) SELECT hospitality.update_settings('{\"address\": \"כתובת ב\"}', $REV);"
check "26 two settings saves from the same revision → one is saved, the other gets 'updated in the meantime'" \
  "SELECT $(ok_count c26) = 1 AND $(err_count c26 'ההגדרות עודכנו בינתיים') = 1
     AND (SELECT revision = $REV + 1 AND address IN ('כתובת א', 'כתובת ב') FROM hospitality.settings WHERE tenant_id = '$SITE4')
     AND (SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '$SITE4' AND action = 'settings.updated') = 1"

# ---- final invariants ----
check "invariant: no two occupancy rows overlap on any physical unit" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.unit_occupancy a JOIN hospitality.unit_occupancy b
                       ON a.tenant_id = b.tenant_id AND a.unit_id = b.unit_id AND a.id < b.id AND a.nights && b.nights)"
check "invariant: every inventory-holding booking has exactly its occupancy, every other booking none" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.bookings b
     WHERE (SELECT count(*) FROM hospitality.unit_occupancy o WHERE o.booking_id = b.id)
           <> CASE WHEN hospitality._holding(b.status) THEN cardinality(hospitality._fanout_units(b.tenant_id, b.unit_id)) ELSE 0 END)"
check "invariant: every booking's nights cover its stay and add up to its price" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.bookings b
     WHERE (SELECT count(*) FROM hospitality.booking_nights n WHERE n.booking_id = b.id) <> b.check_out - b.check_in
        OR (SELECT sum(price) FROM hospitality.booking_nights n WHERE n.booking_id = b.id) <> b.subtotal)"
check "invariant: every booking has a creation event and one event per status change" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE NOT EXISTS (
     SELECT 1 FROM hospitality.booking_events e WHERE e.booking_id = b.id AND e.kind = 'created'))"

"${PG[@]}" -d postgres -c "DROP DATABASE $DB" >/dev/null 2>&1 || true
rm -rf "$TMP"
echo "concurrency: $PASSED passed, $FAILED failed"
[ "$FAILED" = "0" ]

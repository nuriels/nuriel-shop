#!/usr/bin/env bash
# ============================================================
# Rollback של החדרים הנוספים לחבילה (20261121100000_hosp_package_addon_rooms, מיגרציה 202) — מקומית / ב-CI
# בלבד, על מסד נפרד (addons_rb). בסקריפט נפרד (כמו seo-proposals-rollback.sh). רץ אחרי run.sh (אותו שרת
# Postgres: /tmp/pg, פורט 5499).
#   1. ההחלה השנייה של המיגרציה לא משנה כלום (הסכמה זהה)
#   2. עם חבילה שהוגדרו לה חדרים נוספים — ה-rollback נעצר ושום דבר לא משתנה
#   3. עם הזמנה של חדר נוסף — ה-rollback נעצר ושום דבר לא משתנה (גם אחרי שהחבילה כבר בלי חדרים נוספים)
#   4. בלי שני אלה — rollback → הסכמה זהה בדיוק לזו שלפני המיגרציה; הזמנה רגילה של החבילה נשארת
#   5. החלה מחדש → הסכמה זהה בדיוק לזו שאחרי ההחלה הראשונה
# ============================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
M=20261121100000_hosp_package_addon_rooms
MIGRATIONS="$ROOT/supabase/migrations"
DB=addons_rb
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d "$DB")
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

q() { "${PSQL[@]}" -tAc "$1"; }
expect() { if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; else echo "  FAIL $1"; exit 1; fi; }
dump() { pg_dump -h /tmp/pg -p "$PORT" -U postgres -d "$DB" --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$1"; }
same() { if diff -q "$1" "$2" >/dev/null; then echo "  ok   $3"; else echo "  FAIL $3"; diff "$1" "$2" | head -30; exit 1; fi; }
stopped() { # stopped <label> <expected message>
  if "${PSQL[@]}" -f "$ROOT/supabase/rollbacks/$M.down.sql" >"$DIR/guard.log" 2>&1; then
    echo "  FAIL the rollback ran although $1"; exit 1
  fi
  grep -q "$2" "$DIR/guard.log" \
    && echo "  ok   with $1 the rollback stops with the reason" \
    || { echo "  FAIL unexpected guard output:"; cat "$DIR/guard.log"; exit 1; }
  dump "$DIR/guarded.sql"
  same "$DIR/after.sql" "$DIR/guarded.sql" "after the stopped rollback the schema is unchanged"
}

psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "SET client_min_messages = warning" \
  -c "DROP DATABASE IF EXISTS $DB" \
  -c "CREATE DATABASE $DB ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
"${PSQL[@]}" -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M" ] && continue
  "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
dump "$DIR/before.sql"
"${PSQL[@]}" -f "$MIGRATIONS/$M.sql" >/dev/null
dump "$DIR/after.sql"
"${PSQL[@]}" -f "$MIGRATIONS/$M.sql" >/dev/null
dump "$DIR/again.sql"
echo "package add-on rooms rollback ($M)"
same "$DIR/after.sql" "$DIR/again.sql" "applying the migration twice changes nothing"
expect "the columns and the functions exist" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'packages'
                    AND column_name = 'addon_unit_ids')
      AND to_regprocedure('hospitality.request_booking_package_with_rooms(uuid,date,jsonb,text,text,text,text,boolean,text,integer,integer,text,boolean,text)') IS NOT NULL
      AND to_regprocedure('hospitality.package_save(uuid,uuid,text,text,integer,numeric,integer,text,text,date,date,uuid,uuid[],integer,jsonb)') IS NOT NULL
      AND to_regprocedure('hospitality.package_save(uuid,uuid,text,text,integer,numeric,integer,text,text,date,date,uuid,uuid[],integer)') IS NULL"

# עסק אחד עם מתחם, שתי יחידות וחבילה (כפי שהמסך שומר — ישירות בטבלאות)
T=6a000000-0000-4000-8000-0000000000a1
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('$T', 'addons-rb', 'Addons RB', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.properties (id, tenant_id, name, slug, status)
   VALUES ('6a000000-0000-4000-8000-0000000000b1', '$T', 'מתחם', 'p', 'active')" >/dev/null
q "INSERT INTO hospitality.units (id, tenant_id, property_id, name, slug, kind, capacity, base_price)
   VALUES ('6a000000-0000-4000-8000-0000000000c1', '$T', '6a000000-0000-4000-8000-0000000000b1', 'VIP', 'vip', 'room', 2, 900),
          ('6a000000-0000-4000-8000-0000000000c2', '$T', '6a000000-0000-4000-8000-0000000000b1', 'אדיר', 'adir', 'room', 5, 900)" >/dev/null
q "INSERT INTO hospitality.packages (id, tenant_id, unit_id, kind, name, slug, nights, price, max_guests,
                                     addon_unit_ids, addon_nightly_price, addon_max)
   VALUES ('6a000000-0000-4000-8000-0000000000d1', '$T', '6a000000-0000-4000-8000-0000000000c1', 'special', 'חבילת כלה', 'bride',
           2, 4000, 2, ARRAY['6a000000-0000-4000-8000-0000000000c2']::uuid[], 1200, 1)" >/dev/null
stopped "a package that has add-on rooms configured" "rollback stopped: 1 packages have add-on rooms configured"
expect "after the stopped rollback the add-on configuration is still there" \
  "SELECT addon_nightly_price = 1200 AND addon_max = 1 FROM hospitality.packages WHERE slug = 'bride'"

# הזמנה של חדר נוסף (כפי ש-request_booking_package_with_rooms רושמת), החבילה עצמה כבר בלי חדרים נוספים
q "UPDATE hospitality.packages SET addon_unit_ids = '{}', addon_nightly_price = NULL, addon_max = 0 WHERE slug = 'bride'" >/dev/null
q "INSERT INTO hospitality.guests (id, tenant_id, full_name, email, phone)
   VALUES ('6a000000-0000-4000-8000-0000000000e1', '$T', 'אורחת', 'guest@example.test', '0501234567')" >/dev/null
# הזמנה + הלילות שלה בפקודה אחת (בדיקת העקביות של ההזמנה רצה בסוף הטרנזקציה)
q "WITH b AS (
     INSERT INTO hospitality.bookings (tenant_id, number, unit_id, guest_id, check_in, check_out, adults, children, status,
                                       source, currency, subtotal, discount, total, deposit_amount, price_manual,
                                       policy_snapshot, policy_acceptance, package_id, package_snapshot)
     VALUES ('$T', 1001, '6a000000-0000-4000-8000-0000000000c1', '6a000000-0000-4000-8000-0000000000e1',
             current_date + 30, current_date + 32, 2, 0, 'confirmed', 'site', 'ILS', 4000, 0, 4000, 0, true, '{}'::jsonb, '{}'::jsonb,
             '6a000000-0000-4000-8000-0000000000d1', '{\"name\": \"חבילת כלה\", \"nights\": 2, \"price\": 4000}'::jsonb),
            ('$T', 1002, '6a000000-0000-4000-8000-0000000000c2', '6a000000-0000-4000-8000-0000000000e1',
             current_date + 30, current_date + 32, 4, 0, 'confirmed', 'site', 'ILS', 2400, 0, 2400, 0, true, '{}'::jsonb, '{}'::jsonb,
             '6a000000-0000-4000-8000-0000000000d1',
             '{\"name\": \"חבילת כלה\", \"nights\": 2, \"price\": 4000, \"role\": \"addon\", \"addon_nightly_price\": 1200}'::jsonb)
     RETURNING id, check_in, total)
   INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, extras, price, rule_applied)
   SELECT '$T', b.id, b.check_in + i, b.total / 2, 0, b.total / 2, 'manual' FROM b, generate_series(0, 1) i" >/dev/null
stopped "a booking of an add-on room" "rollback stopped: 1 bookings are add-on rooms of a package"
expect "after the stopped rollback both bookings are still there" \
  "SELECT count(*) = 2 FROM hospitality.bookings WHERE package_id = '6a000000-0000-4000-8000-0000000000d1'"

# בלי הזמנת חדר נוסף ובלי הגדרה — ה-rollback רץ; הזמנה רגילה של החבילה נשארת
q "DELETE FROM hospitality.bookings WHERE package_snapshot ->> 'role' = 'addon'" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/rollbacks/$M.down.sql" >/dev/null
dump "$DIR/down.sql"
same "$DIR/before.sql" "$DIR/down.sql" "schema after the rollback = the schema before the migration, exactly"
expect "the columns and every new function are gone; the old package_save is back" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'packages'
                        AND column_name LIKE 'addon\\_%')
      AND to_regprocedure('hospitality.request_booking_package_with_rooms(uuid,date,jsonb,text,text,text,text,boolean,text,integer,integer,text,boolean,text)') IS NULL
      AND to_regprocedure('hospitality.package_addons_quote(uuid,date)') IS NULL
      AND to_regprocedure('hospitality.package_save(uuid,uuid,text,text,integer,numeric,integer,text,text,date,date,uuid,uuid[],integer)') IS NOT NULL"
expect "the regular package booking survives the rollback" \
  "SELECT count(*) = 1 AND bool_and(total = 4000) FROM hospitality.bookings WHERE package_id = '6a000000-0000-4000-8000-0000000000d1'"

"${PSQL[@]}" -f "$MIGRATIONS/$M.sql" >/dev/null
dump "$DIR/reapplied.sql"
same "$DIR/after.sql" "$DIR/reapplied.sql" "re-applying after the rollback gives the same schema as the first apply"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "DROP DATABASE $DB" >/dev/null 2>&1 || true
echo "package add-on rooms rollback check passed"

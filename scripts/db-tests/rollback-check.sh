#!/usr/bin/env bash
# ============================================================
# בדיקת Rollback (מקומית בלבד): מסד חדש (rollback_test) עם כל המיגרציות.
# המיגרציות של Hospitality נבדקות בסדר הפוך (האחרונה קודם):
#   • hosp_calendar (3a): בלי נתונים חדשים; rollback → הצוות כותב שוב ישירות לחסימות, _quote
#     בגרסה של מיגרציה 11, הסכמה זהה בדיוק למצב של מיגרציה 13
#   • hosp_pricing (2f): בלי נתונים חדשים; rollback → הצוות כותב שוב ישירות לכללי המחיר
#     ולמדיניות, הסכמה זהה בדיוק למצב של מיגרציה 12
#   • hosp_media (2e): הגנה (נשמרו תמונות עם גדלים / מקישור), rollback → הצוות כותב שוב
#     ישירות ל-media, הסכמה זהה בדיוק למצב של מיגרציה 11
#   • hosp_details (2d): הגנה (נשמרו פרטים חדשים — חניה / מידע פרטי להגעה / כללים בהזמנה),
#     rollback → הצוות כותב שוב ישירות למיטות ולמתקנים, הסכמה זהה בדיוק למצב של מיגרציה 10
#   • hosp_catalog (2c.1): הגנה (נשמרו סוגי מתחם / יחידה), rollback → הצוות כותב שוב ישירות,
#     12 הרשאות, פונקציות הקטלוג והעמודות נעלמו
#   • hosp_site_identity (R-1): rollback → site_identity נעלמה, ההגדרות והצוות במקומם
#   • hosp_settings_team (2b.1): הגנה (יש רשומות ביומן הפעולות), rollback → עדכון ישיר
#     של ההגדרות לצוות חוזר, 11 הרשאות, היומן, פונקציות הצוות וה-trigger נעלמו
#   • hosp_management_foundation (2a): הגנה (מקומות מנהל נוספים שהוקצו), rollback →
#     כלל המנהלים של Ecommerce חוזר בדיוק, דגל הניהול, העמודות והפונקציות נעלמו,
#     הצוות קורא שוב את תור המיילים, ייצוא / מחיקת אורח חוזרים להרשאת guests
#   • hosp_billing_admin (1e): הגנה (מנוי ששונה / היסטוריית מדיניות), rollback →
#     חבילות, מנויים, היסטוריה, מגבלות וסטטיסטיקות נעלמו; פונקציות 1d חוזרות
#   • hosp_booking (1d): הגנה (נעצר כשיש הזמנות / אורחים / חסימות / מיילים),
#     rollback → טבלאות 12–18 והפונקציות נעלמו, ההגדרות חוזרות למצב של 1c
#   • hosp_schema (1c): הגנות (נעצר כשיש אתר אירוח / אובייקטים של מיגרציה מאוחרת),
#     rollback → הטבלאות, הפונקציות, הדלי והרישומים נעלמו, הסכמה עצמה נשארת ריקה
#   • ecommerce_engine_guard (1b): rollback → הטריגרים, המדיניות ורישום התפקידים נעלמו,
#     הנתונים במקומם
#   • platform_products_flags (1a): הגנה (נעצר כשיש אתר שאינו ecommerce),
#     rollback → המצב הקודם בדיוק (טריגר ה-seed בלי WHEN)
#   ואז כל המיגרציות מורצות שוב, והמצב חוזר.
# שימוש:  bash scripts/db-tests/rollback-check.sh   (Postgres 16 מקומי — כמו run.sh)
# ============================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_test)
M1=20261101090000_platform_products_flags
M2=20261101100000_ecommerce_engine_guard
M3=20261101110000_hosp_schema
M4=20261101120000_hosp_booking
M5=20261101130000_hosp_billing_admin
M6=20261101140000_hosp_coupon_release
M7=20261101150000_hosp_management_foundation
M8=20261101160000_hosp_settings_team
M9=20261101170000_hosp_site_identity
M10=20261101180000_hosp_catalog
M11=20261101190000_hosp_details
M12=20261101200000_hosp_media
M13=20261101210000_hosp_pricing
M14=20261101220000_hosp_calendar
M15=20261102090000_hosp_platform_open
M16=20261102100000_hosp_bookings_staff
M17=20261102110000_hosp_guests
M18=20261102120000_hosp_emails_dashboard
M19=20261102130000_hosp_public_site
M20=20261102140000_hosp_site_switches
M21=20261102150000_hosp_site_design
M22=20261102160000_hosp_room_types
M23=20261102170000_hosp_payments
M24=20261102180000_hosp_channels
M25=20261103090000_hosp_security
M26=20261103100000_hosp_site_theme
MIGRATIONS="$ROOT/supabase/migrations"

q() { "${PSQL[@]}" -tAc "$1"; }
expect() { # expect <label> <sql returning true>
  if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; else echo "  FAIL $1"; exit 1; fi
}
down() { "${PSQL[@]}" -f "$ROOT/supabase/rollbacks/$1.down.sql" >/dev/null; }
up() { "${PSQL[@]}" -f "$MIGRATIONS/$1.sql" >/dev/null; }

psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS rollback_test" \
  -c "CREATE DATABASE rollback_test ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
"${PSQL[@]}" -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }; done
q "INSERT INTO public.shipping_methods (tenant_id, name, kind, price) SELECT id, 'rb-row', 'pickup', 0 FROM public.tenants WHERE is_default" >/dev/null
# the whole schema (every object, privilege, policy and function body) before rolling back —
# compared with the schema after rolling everything back and re-applying (end of the script)
SCHEMA_DIR=$(mktemp -d)
schema_dump() { pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_test --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$1"; }
schema_dump "$SCHEMA_DIR/before.sql"

# ---------- D2: the site's theme when a business is opened (migration 26) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M26" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M26"
down "$M26"
expect "admin_site_theme is gone" "SELECT to_regprocedure('hospitality.admin_site_theme(uuid, text)') IS NULL"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m25.sql"
schema_dump "$SCHEMA_DIR/after-m26-down.sql"
if diff -q "$SCHEMA_DIR/m25.sql" "$SCHEMA_DIR/after-m26-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 25, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 25:"; diff "$SCHEMA_DIR/m25.sql" "$SCHEMA_DIR/after-m26-down.sql" | head -20; exit 1
fi

# ---------- D1 security: shared rate counters, server-only booking requests (migration 25) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M25" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M25"
q "SELECT hospitality.rate_check('[{\"key\": \"rollback-check-key-0001\", \"limit\": 5, \"window\": 60}]')" >/dev/null
down "$M25"
expect "the counters and their functions are gone; booking requests are callable by the API roles again" \
  "SELECT to_regclass('hospitality.rate_buckets') IS NULL AND to_regprocedure('hospitality.rate_check(jsonb)') IS NULL
      AND has_function_privilege('anon', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m24.sql"
schema_dump "$SCHEMA_DIR/after-m25-down.sql"
if diff -q "$SCHEMA_DIR/m24.sql" "$SCHEMA_DIR/after-m25-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 24, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 24:"; diff "$SCHEMA_DIR/m24.sql" "$SCHEMA_DIR/after-m25-down.sql" | head -20; exit 1
fi

# ---------- channel sync (migration 24) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M24" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M24"
down "$M24"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m23.sql"
schema_dump "$SCHEMA_DIR/after-m24-down.sql"
if diff -q "$SCHEMA_DIR/m23.sql" "$SCHEMA_DIR/after-m24-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 23, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 23:"; diff "$SCHEMA_DIR/m23.sql" "$SCHEMA_DIR/after-m24-down.sql" | head -20; exit 1
fi

# ---------- payments ledger (migration 23) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M23" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M23"
down "$M23"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m22.sql"
schema_dump "$SCHEMA_DIR/after-m23-down.sql"
if diff -q "$SCHEMA_DIR/m22.sql" "$SCHEMA_DIR/after-m23-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 22, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 22:"; diff "$SCHEMA_DIR/m22.sql" "$SCHEMA_DIR/after-m23-down.sql" | head -20; exit 1
fi

# ---------- RT: hotel room types (migration 22) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M22" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M22"
down "$M22"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m21.sql"
schema_dump "$SCHEMA_DIR/after-m22-down.sql"
if diff -q "$SCHEMA_DIR/m21.sql" "$SCHEMA_DIR/after-m22-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 21, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 21:"; diff "$SCHEMA_DIR/m21.sql" "$SCHEMA_DIR/after-m22-down.sql" | head -20; exit 1
fi

# ---------- 5a: site document, drafts and versions (migration 21) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M21" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M21"
down "$M21"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m20.sql"
schema_dump "$SCHEMA_DIR/after-m21-down.sql"
if diff -q "$SCHEMA_DIR/m20.sql" "$SCHEMA_DIR/after-m21-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 20, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 20:"; diff "$SCHEMA_DIR/m20.sql" "$SCHEMA_DIR/after-m21-down.sql" | head -20; exit 1
fi

# ---------- 4c: website switches in the platform panel (migration 20) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M20" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M20"
down "$M20"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m19.sql"
schema_dump "$SCHEMA_DIR/after-m20-down.sql"
if diff -q "$SCHEMA_DIR/m19.sql" "$SCHEMA_DIR/after-m20-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 19, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 19:"; diff "$SCHEMA_DIR/m19.sql" "$SCHEMA_DIR/after-m20-down.sql" | head -20; exit 1
fi

# ---------- 4a: public website reads (migration 19) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M19" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M19"
down "$M19"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m18.sql"
schema_dump "$SCHEMA_DIR/after-m19-down.sql"
if diff -q "$SCHEMA_DIR/m18.sql" "$SCHEMA_DIR/after-m19-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 18, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 18:"; diff "$SCHEMA_DIR/m18.sql" "$SCHEMA_DIR/after-m19-down.sql" | head -20; exit 1
fi

# ---------- 2k: emails screen and dashboard (migration 18) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M18" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M18"
down "$M18"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m17.sql"
schema_dump "$SCHEMA_DIR/after-m18-down.sql"
if diff -q "$SCHEMA_DIR/m17.sql" "$SCHEMA_DIR/after-m18-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 17, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 17:"; diff "$SCHEMA_DIR/m17.sql" "$SCHEMA_DIR/after-m18-down.sql" | head -20; exit 1
fi

# ---------- 2j: guests and privacy (migration 17) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M17" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M17"
down "$M17"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m16.sql"
schema_dump "$SCHEMA_DIR/after-m17-down.sql"
if diff -q "$SCHEMA_DIR/m16.sql" "$SCHEMA_DIR/after-m17-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 16, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 16:"; diff "$SCHEMA_DIR/m16.sql" "$SCHEMA_DIR/after-m17-down.sql" | head -20; exit 1
fi

# ---------- 2h: bookings list and card (migration 16) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M16" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M16"
down "$M16"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m15.sql"
schema_dump "$SCHEMA_DIR/after-m16-down.sql"
if diff -q "$SCHEMA_DIR/m15.sql" "$SCHEMA_DIR/after-m16-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 15, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 15:"; diff "$SCHEMA_DIR/m15.sql" "$SCHEMA_DIR/after-m16-down.sql" | head -20; exit 1
fi

# ---------- P1: opening a business from the platform panel (migration 15) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M15" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M15"
down "$M15"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m14.sql"
schema_dump "$SCHEMA_DIR/after-m15-down.sql"
if diff -q "$SCHEMA_DIR/m14.sql" "$SCHEMA_DIR/after-m15-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 14, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 14:"; diff "$SCHEMA_DIR/m14.sql" "$SCHEMA_DIR/after-m15-down.sql" | head -20; exit 1
fi

# ---------- 3a: calendar and blocks (migration 14) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M14" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M14"
down "$M14"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m13.sql"
schema_dump "$SCHEMA_DIR/after-m14-down.sql"
if diff -q "$SCHEMA_DIR/m13.sql" "$SCHEMA_DIR/after-m14-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 13, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 13:"; diff "$SCHEMA_DIR/m13.sql" "$SCHEMA_DIR/after-m14-down.sql" | head -20; exit 1
fi
expect "staff write blocks directly again; calendar functions gone" \
  "SELECT has_table_privilege('authenticated', 'hospitality.blocks', 'INSERT')
     AND to_regprocedure('hospitality.calendar(date, date, uuid[], boolean)') IS NULL"

# ---------- 2f: prices and policies (migration 13) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M13" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M13"
down "$M13"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m12.sql"
schema_dump "$SCHEMA_DIR/after-m13-down.sql"
if diff -q "$SCHEMA_DIR/m12.sql" "$SCHEMA_DIR/after-m13-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 12, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 12:"; diff "$SCHEMA_DIR/m12.sql" "$SCHEMA_DIR/after-m13-down.sql" | head -20; exit 1
fi
expect "staff write rate rules and policies directly again; pricing functions gone; version history kept" \
  "SELECT has_table_privilege('authenticated', 'hospitality.rate_rules', 'UPDATE')
     AND has_table_privilege('authenticated', 'hospitality.policies', 'INSERT')
     AND to_regprocedure('hospitality.pricing_view()') IS NULL
     AND to_regclass('hospitality.policy_versions') IS NOT NULL"

# ---------- 2e: photos and galleries (migration 12) ----------
echo "rollback guard: $M12 refuses while 2e media are saved"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('72e10000-0000-0000-0000-000000000001', 'rb-stay-2e', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.media (tenant_id, owner_kind, kind, storage_path, source_url) VALUES ('72e10000-0000-0000-0000-000000000001', 'site', 'image', '72e10000-0000-0000-0000-000000000001/a.webp', 'https://example.com/a.jpg')" >/dev/null
if down "$M12" 2>/dev/null; then
  echo "  FAIL rollback ran although an imported image exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regprocedure('hospitality.media_list(text, uuid)') IS NOT NULL"
q "DELETE FROM public.tenants WHERE id = '72e10000-0000-0000-0000-000000000001'" >/dev/null
# the exact schema of migration 11: a database with every migration up to M11
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M12" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M12"
down "$M12"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m11.sql"
schema_dump "$SCHEMA_DIR/after-m12-down.sql"
if diff -q "$SCHEMA_DIR/m11.sql" "$SCHEMA_DIR/after-m12-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 11, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 11:"; diff "$SCHEMA_DIR/m11.sql" "$SCHEMA_DIR/after-m12-down.sql" | head -20; exit 1
fi
expect "staff write media directly again; gallery functions gone" \
  "SELECT has_table_privilege('authenticated', 'hospitality.media', 'INSERT')
     AND to_regprocedure('hospitality.media_add(text, uuid, jsonb)') IS NULL"

# ---------- 2d: unit and property details (migration 11) ----------
echo "rollback guard: $M11 refuses while 2d details are saved"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('72d10000-0000-0000-0000-000000000001', 'rb-stay-2d', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.properties (id, tenant_id, name, slug, parking, parking_type) VALUES ('72d10000-0000-0000-0000-0000000000a1', '72d10000-0000-0000-0000-000000000001', 'x', 'x', 'free', 'shared')" >/dev/null
if down "$M11" 2>/dev/null; then
  echo "  FAIL rollback ran although a property has parking details"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('hospitality.arrival_info') IS NOT NULL AND to_regprocedure('hospitality.amenity_presets()') IS NOT NULL"
q "DELETE FROM public.tenants WHERE id = '72d10000-0000-0000-0000-000000000001'" >/dev/null
# the exact schema of migration 10: a second database with every migration up to M10
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M11" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M11"
down "$M11"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m10.sql"
schema_dump "$SCHEMA_DIR/after-m11-down.sql"
if diff -q "$SCHEMA_DIR/m10.sql" "$SCHEMA_DIR/after-m11-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 10, exactly (functions, grants, columns)"
else
  echo "  FAIL schema after the rollback differs from migration 10:"; diff "$SCHEMA_DIR/m10.sql" "$SCHEMA_DIR/after-m11-down.sql" | head -20; exit 1
fi
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "DROP DATABASE IF EXISTS rollback_ref" >/dev/null
expect "staff write beds and amenities directly again; no arrival info; _quote without guest limits" \
  "SELECT has_table_privilege('authenticated', 'hospitality.unit_beds', 'INSERT')
     AND has_table_privilege('authenticated', 'hospitality.amenities', 'UPDATE')
     AND to_regclass('hospitality.arrival_info') IS NULL
     AND (SELECT prosrc NOT LIKE '%max_adults%' FROM pg_proc WHERE oid = 'hospitality._quote(uuid, uuid, date, date, integer, integer, text, boolean, uuid, uuid)'::regprocedure)"

# ---------- 2c.1: properties and units (migration 10) ----------
echo "rollback guard: $M10 refuses while a property / unit has a saved type"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('72c10000-0000-0000-0000-000000000001', 'rb-stay-2c', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.properties (id, tenant_id, name, slug, property_type) VALUES ('72c10000-0000-0000-0000-0000000000a1', '72c10000-0000-0000-0000-000000000001', 'x', 'x', 'villa')" >/dev/null
if down "$M10" 2>/dev/null; then
  echo "  FAIL rollback ran although a property has a saved type"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regprocedure('hospitality.catalog_view()') IS NOT NULL AND cardinality(hospitality.permissions()) = 13"
q "DELETE FROM public.tenants WHERE id = '72c10000-0000-0000-0000-000000000001'" >/dev/null
echo "rollback: $M10"
down "$M10"
expect "catalog functions, types and revision removed; staff write directly again; 12 permissions" \
  "SELECT to_regprocedure('hospitality.unit_create(uuid, jsonb)') IS NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                      AND column_name IN ('property_type', 'unit_type') OR (table_schema = 'hospitality' AND table_name IN ('units', 'properties') AND column_name = 'revision'))
     AND has_table_privilege('authenticated', 'hospitality.units', 'INSERT')
     AND has_table_privilege('authenticated', 'hospitality.unit_members', 'DELETE')
     AND cardinality(hospitality.permissions()) = 12"

# ---------- R-1: site identity (migration 9) ----------
echo "rollback: $M9"
down "$M9"
expect "site_identity removed, settings and team untouched" \
  "SELECT to_regprocedure('hospitality.site_identity()') IS NULL
     AND to_regclass('hospitality.audit_log') IS NOT NULL
     AND to_regprocedure('hospitality.team_members()') IS NOT NULL"

# ---------- 2b.1: settings and team ----------
echo "rollback guard: $M8 refuses while the action log has rows"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('72b00000-0000-0000-0000-000000000001', 'rb-stay-2b', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.audit_log (tenant_id, actor_role, action) VALUES ('72b00000-0000-0000-0000-000000000001', 'system', 'test.row')" >/dev/null
if down "$M8" 2>/dev/null; then
  echo "  FAIL rollback ran although the action log has rows"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('hospitality.audit_log') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_row_guard')"
# the site's history goes only with the site itself (cascade from tenants)
q "DELETE FROM public.tenants WHERE id = '72b00000-0000-0000-0000-000000000001'" >/dev/null
expect "deleting the site removed its action-log rows (append-only otherwise)" "SELECT NOT EXISTS (SELECT 1 FROM hospitality.audit_log)"

echo "rollback: $M8"
down "$M8"
expect "action log, team / settings functions and the user_roles guard removed" \
  "SELECT to_regclass('hospitality.audit_log') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_row_guard')
     AND to_regprocedure('hospitality.update_settings(jsonb, integer)') IS NULL
     AND to_regprocedure('hospitality.team_add_manager(text, text)') IS NULL
     AND to_regprocedure('hospitality.settings_view()') IS NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                       AND table_name = 'settings' AND column_name = 'revision')"
expect "back to the migration 7 rules: 11 permissions, staff update settings columns (not the counter)" \
  "SELECT cardinality(hospitality.permissions()) = 11
     AND has_column_privilege('authenticated', 'hospitality.settings', 'check_in_time', 'UPDATE')
     AND NOT has_column_privilege('authenticated', 'hospitality.settings', 'last_booking_number', 'UPDATE')"
expect "migration 7 objects untouched by this rollback (seat trigger, Ecommerce guard branch)" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_seat_guard')
     AND (SELECT prosrc LIKE '%site_type <> ''ecommerce''%' FROM pg_proc WHERE oid = 'public.user_roles_admin_seat_guard()'::regprocedure)"

# ---------- 2a: management foundation ----------
echo "rollback guard: $M7 refuses while extra manager seats are assigned"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('72a00000-0000-0000-0000-000000000001', 'rb-stay-2a', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at, extra_managers) VALUES ('72a00000-0000-0000-0000-000000000001', 'trial', 'trialing', now() + interval '1 day', 2)" >/dev/null
if down "$M7" 2>/dev/null; then
  echo "  FAIL rollback ran although extra manager seats were assigned"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_seat_guard')"
q "DELETE FROM public.tenants WHERE id = '72a00000-0000-0000-0000-000000000001'" >/dev/null

echo "rollback: $M7"
down "$M7"
expect "Ecommerce seat guard restored to its original body (no site-type branch)" \
  "SELECT prosrc NOT LIKE '%site_type%' AND prosrc LIKE '%tenant_admin_limit(NEW.tenant_id)%'
     FROM pg_proc WHERE oid = 'public.user_roles_admin_seat_guard()'::regprocedure"
expect "Hospitality seat trigger, functions, columns and the management flag removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_seat_guard')
     AND to_regprocedure('hospitality.management_context()') IS NULL
     AND to_regprocedure('hospitality.staff_email_status(uuid)') IS NULL
     AND to_regprocedure('hospitality.admin_set_extra_managers(uuid, integer)') IS NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                       AND column_name IN ('max_managers', 'extra_managers'))
     AND NOT EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key = 'hospitality_management_enabled')"
expect "back to the migration 6 rules: staff read the outbox, 10 permissions, entitlements without seats" \
  "SELECT has_table_privilege('authenticated', 'hospitality.notifications', 'SELECT')
     AND cardinality(hospitality.permissions()) = 10
     AND (SELECT prosrc NOT LIKE '%max_managers%' FROM pg_proc WHERE oid = 'hospitality.entitlements(uuid)'::regprocedure)
     AND (SELECT prosrc LIKE '%_staff_tenant(''guests'')%' FROM pg_proc WHERE oid = 'hospitality.export_guest(uuid)'::regprocedure)"

# ---------- coupon release ----------
echo "rollback: $M6"
down "$M6"
expect "coupon release trigger and column removed (back to: counted at creation, never released)" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_coupon_usage')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                       AND table_name = 'bookings' AND column_name = 'promotion_released_at')"

# ---------- 1e ----------
echo "rollback guard: $M5 refuses while a platform-changed subscription exists"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71e00000-0000-0000-0000-000000000001', 'rb-stay-1e', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status) VALUES ('71e00000-0000-0000-0000-000000000001', 'pro', 'active')" >/dev/null
if down "$M5" 2>/dev/null; then
  echo "  FAIL rollback ran although a changed subscription exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" "SELECT to_regclass('hospitality.plans') IS NOT NULL"
q "DELETE FROM public.tenants WHERE id = '71e00000-0000-0000-0000-000000000001'" >/dev/null

echo "rollback: $M5"
down "$M5"
expect "plans, subscriptions and policy history removed" \
  "SELECT to_regclass('hospitality.plans') IS NULL AND to_regclass('hospitality.subscriptions') IS NULL
     AND to_regclass('hospitality.policy_versions') IS NULL"
expect "limit, terms guard and statistics removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('units_limit_guard', 'bookings_terms_guard', 'policies_record_version',
                                                                'settings_create_subscription'))
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
                       AND proname IN ('entitlements', 'admin_site_stats', 'admin_overview', 'admin_set_subscription', 'my_entitlements'))"
expect "the Stage 1d versions of _public_tenant and _owner_emails are back" \
  "SELECT (SELECT prosrc NOT LIKE '%entitlements%' FROM pg_proc WHERE proname = '_public_tenant' AND pronamespace = 'hospitality'::regnamespace)
     AND (SELECT prosrc NOT LIKE '%email_confirmed_at%' FROM pg_proc WHERE proname = '_owner_emails' AND pronamespace = 'hospitality'::regnamespace)
     AND NOT has_function_privilege('anon', 'hospitality._public_tenant(boolean)', 'EXECUTE')"
expect "Stage 1d tables untouched (18)" \
  "SELECT count(*) = 18 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'"

# ---------- 1d ----------
echo "rollback guard: $M4 refuses while bookings exist"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71d00000-0000-0000-0000-000000000001', 'rb-stay-1d', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.settings (tenant_id) VALUES ('71d00000-0000-0000-0000-000000000001')" >/dev/null
q "INSERT INTO hospitality.guests (tenant_id, full_name, email) VALUES ('71d00000-0000-0000-0000-000000000001', 'rb guest', 'rb@example.com')" >/dev/null
if down "$M4" 2>/dev/null; then
  echo "  FAIL rollback ran although guest data exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" "SELECT EXISTS (SELECT 1 FROM hospitality.guests WHERE email = 'rb@example.com')"
q "DELETE FROM public.tenants WHERE id = '71d00000-0000-0000-0000-000000000001'" >/dev/null

echo "rollback: $M4"
down "$M4"
expect "booking tables removed (12–18)" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relname IN
     ('guests','bookings','booking_nights','booking_events','blocks','unit_occupancy','notifications'))"
expect "booking functions removed, Stage 1c functions kept" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
       AND proname IN ('quote','request_booking','expire_holds','claim_notifications','_quote','policy_schedule','normalize_email'))
     AND EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND proname = 'admin_create_site')"
expect "settings back to the Stage 1c shape (no counter, retention 36 not null, table-level update)" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'settings'
                        AND column_name = 'last_booking_number')
     AND (SELECT is_nullable = 'NO' AND column_default = '36' FROM information_schema.columns
           WHERE table_schema = 'hospitality' AND table_name = 'settings' AND column_name = 'guest_retention_months')
     AND has_table_privilege('authenticated', 'hospitality.settings', 'UPDATE')"
expect "Stage 1c tables untouched (11)" \
  "SELECT count(*) = 11 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'"

# ---------- 1c ----------
echo "rollback guard: $M3 refuses while a Hospitality site exists"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71c00000-0000-0000-0000-000000000001', 'rb-stay-1c', 'x', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.amenities (tenant_id, name) VALUES ('71c00000-0000-0000-0000-000000000001', 'rb-amenity')" >/dev/null
if down "$M3" 2>/dev/null; then
  echo "  FAIL rollback ran although a Hospitality site exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT EXISTS (SELECT 1 FROM hospitality.amenities WHERE name = 'rb-amenity')"
q "DELETE FROM public.tenants WHERE id = '71c00000-0000-0000-0000-000000000001'" >/dev/null
expect "deleting the site removed its Hospitality rows (cascade)" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.amenities)"

echo "rollback guard: $M3 refuses while objects of a later migration remain in the schema"
q "CREATE TABLE hospitality.rb_later (x int)" >/dev/null
if down "$M3" 2>/dev/null; then
  echo "  FAIL rollback ran although a later object exists"; exit 1
fi
expect "nothing was removed" "SELECT to_regclass('hospitality.units') IS NOT NULL"
q "DROP TABLE hospitality.rb_later" >/dev/null

echo "rollback: $M3"
down "$M3"
expect "Hospitality tables and functions removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace)
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace)"
expect "the schema itself is kept (an exposed but missing schema breaks the whole API)" \
  "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'hospitality')"
expect "hosp-media bucket and its policies removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-media')
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'hosp media%')"
expect "Hospitality roles and flag keys unregistered" \
  "SELECT NOT EXISTS (SELECT 1 FROM public.platform_product_roles WHERE product = 'hospitality')
      AND NOT EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key LIKE 'hospitality%')"
expect "Ecommerce guard (1b) untouched: 80 triggers, 5 roles" \
  "SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard')) = 80
      AND (SELECT count(*) FROM public.platform_product_roles WHERE product = 'ecommerce') = 5"
expect "store data untouched" "SELECT EXISTS (SELECT 1 FROM public.shipping_methods WHERE name = 'rb-row')"

# ---------- 1b ----------
echo "rollback: $M2"
down "$M2"
expect "guard triggers removed from every table" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard'))"
expect "guard functions removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('ecommerce_rows_guard','ecommerce_row_move_guard'))"
expect "storage policies removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname LIKE 'product images not on hospitality sites%')"
expect "Ecommerce roles unregistered (role rule inactive for stores, as before)" \
  "SELECT NOT EXISTS (SELECT 1 FROM public.platform_product_roles WHERE product = 'ecommerce')"
expect "store data untouched" "SELECT EXISTS (SELECT 1 FROM public.shipping_methods WHERE name = 'rb-row')"

# ---------- 1a ----------
echo "rollback guard: $M1 refuses while a non-ecommerce store exists"
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('71b00000-0000-0000-0000-000000000001', 'rb-stay', 'x', 'hospitality')" >/dev/null
if down "$M1" 2>/dev/null; then
  echo "  FAIL rollback ran although a hospitality store exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='site_type')"
q "DELETE FROM public.tenants WHERE id = '71b00000-0000-0000-0000-000000000001'" >/dev/null

echo "rollback: $M1"
down "$M1"
expect "site_type column removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='site_type')"
expect "flag tables removed" \
  "SELECT to_regclass('public.platform_feature_flags') IS NULL AND to_regclass('public.tenant_feature_flags') IS NULL"
expect "product-role rule removed" \
  "SELECT to_regclass('public.platform_product_roles') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='user_roles_product_role_guard')"
expect "functions removed" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('current_site_type','platform_feature_enabled','platform_set_flag','platform_seed_tenant_shared','tenants_site_type_immutable'))"
expect "seed trigger restored exactly (no WHEN)" \
  "SELECT pg_get_triggerdef(oid) = 'CREATE TRIGGER tenants_seed_settings AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_seed_settings()' FROM pg_trigger WHERE tgname='tenants_seed_settings'"
expect "stores and their data still there" \
  "SELECT count(*) > 0 FROM public.tenants WHERE EXISTS (SELECT 1 FROM public.shipping_methods WHERE name = 'rb-row')"

# ---------- re-apply ----------
echo "re-apply: $M1 … $M24"
up "$M1"
up "$M2"
up "$M3"
up "$M4"
up "$M5"
up "$M6"
up "$M7"
up "$M8"
up "$M9"
up "$M10"
up "$M11"
up "$M12"
up "$M13"
up "$M14"
up "$M15"
up "$M16"
up "$M17"
up "$M18"
up "$M19"
up "$M20"
up "$M21"
up "$M22"
up "$M23"
up "$M24"
up "$M25"
up "$M26"
expect "site_type back, every store ecommerce" \
  "SELECT bool_and(site_type = 'ecommerce') FROM public.tenants"
expect "seed trigger has the WHEN condition again" \
  "SELECT pg_get_triggerdef(oid) LIKE '%WHEN ((new.site_type = ''ecommerce''::text))%' FROM pg_trigger WHERE tgname='tenants_seed_settings'"
expect "guard triggers back on all 40 Ecommerce tables (80 triggers)" \
  "SELECT count(*) = 80 FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard')"
expect "Ecommerce roles registered again" \
  "SELECT count(*) = 5 FROM public.platform_product_roles WHERE product = 'ecommerce'"
expect "Hospitality schema back: 29 tables (incl. the action log, arrival info, site versions, room types, payments, channels and the rate counters), RLS on all, role admin, 6 flags off (incl. management)" \
  "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r' AND relrowsecurity) = 29
      AND (SELECT array_agg(role) FROM public.platform_product_roles WHERE product = 'hospitality') = ARRAY['admin']
      AND (SELECT count(*) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%' AND NOT enabled) = 6"
expect "hosp-media bucket back" "SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-media' AND public)"
expect "coupon release back" "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_coupon_usage')"
expect "management foundation back: seat trigger, Ecommerce guard branch, no staff outbox read" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_seat_guard')
     AND (SELECT prosrc LIKE '%site_type <> ''ecommerce''%' FROM pg_proc WHERE oid = 'public.user_roles_admin_seat_guard()'::regprocedure)
     AND NOT has_table_privilege('authenticated', 'hospitality.notifications', 'SELECT')
     AND (SELECT max_managers FROM hospitality.plans WHERE code = 'basic') = 2"
expect "settings and team back: guard trigger, action log, no direct settings writes, 13 permissions (12 + catalog.owner of migration 10)" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_row_guard')
     AND to_regclass('hospitality.audit_log') IS NOT NULL
     AND NOT has_column_privilege('authenticated', 'hospitality.settings', 'check_in_time', 'UPDATE')
     AND cardinality(hospitality.permissions()) = 13"
expect "catalog back: functions, types, revision, no direct staff writes, 13 permissions" \
  "SELECT to_regprocedure('hospitality.whole_property_set(uuid, boolean, uuid[])') IS NOT NULL
     AND NOT has_table_privilege('authenticated', 'hospitality.units', 'INSERT')
     AND cardinality(hospitality.permissions()) = 13"
expect "site identity back: public name only, anon may call it" \
  "SELECT has_function_privilege('anon', 'hospitality.site_identity()', 'EXECUTE')
     AND (SELECT prosecdef FROM pg_proc WHERE oid = 'hospitality.site_identity()'::regprocedure)"
expect "plans back (4 unpublished placeholders), unit limit and terms guard active" \
  "SELECT (SELECT count(*) FROM hospitality.plans WHERE NOT is_published AND price_monthly IS NULL) = 4
     AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('units_limit_guard', 'bookings_terms_guard')) = 2"
expect "booking engine back: EXCLUDE constraint, deferred integrity checks, guest functions (booking requests: app server only, migration 25)" \
  "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unit_occupancy_no_overlap')
     AND (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%consistency' AND tgdeferrable) = 3
     AND has_function_privilege('anon', 'hospitality.quote(uuid,date,date,integer,integer,text)', 'EXECUTE')
     AND has_function_privilege('service_role', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"

schema_dump "$SCHEMA_DIR/after.sql"
if diff -u "$SCHEMA_DIR/before.sql" "$SCHEMA_DIR/after.sql" > "$SCHEMA_DIR/schema.diff"; then
  echo "  ok   whole schema after rollback 26 → 1 and re-apply 1 → 26 is identical to the original ($(grep -c '^CREATE' "$SCHEMA_DIR/before.sql") CREATE statements compared)"
else
  echo "  FAIL the schema differs after rollback and re-apply:"; head -60 "$SCHEMA_DIR/schema.diff"; exit 1
fi
rm -rf "$SCHEMA_DIR"
"${PSQL[@]}" -d postgres -c "DROP DATABASE rollback_test" >/dev/null 2>&1 || true
echo "rollback check passed"

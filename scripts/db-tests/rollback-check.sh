#!/usr/bin/env bash
# ============================================================
# בדיקת Rollback (מקומית בלבד): מסד חדש (rollback_test) עם כל המיגרציות.
# המיגרציות של Hospitality נבדקות בסדר הפוך (האחרונה קודם):
#   • ai_assistant (61): הגנה (נעצר כשיש חבילות / תקופות / היסטוריה / התראות / יומן, או מפתח שמור / מצב פעיל),
#     rollback → שבע הטבלאות והפונקציות נעלמו; יומן הפלטפורמה נשאר; הסכמה זהה בדיוק ל-60
#   • hosp_site_documents (60): הגנה (נעצר כשיש אישורי מסמכים / גרסאות / הסדרי נגישות / פרטי עוסק / טיוטות),
#     rollback → חמש הטבלאות והפונקציות נעלמו; הבקשות הקיימות להזמנה לא השתנו; הסכמה זהה בדיוק ל-59
#   • hosp_packages (59): הגנה (נעצר כשיש חבילות / הזמנות של חבילות), rollback → הטבלה, שתי העמודות בהזמנות
#     ופונקציות החבילות נעלמו; _enqueue / _guest_view בגרסה של 13 ו-staff_booking_detail בגרסה של 16 מילה
#     במילה; הסכמה זהה בדיוק ל-58
#   • hosp_platform_separation (58): rollback → platform_list_tenants (כל האתרים) ו-admin_sites בגרסאות הקודמות מילה
#     במילה; הסכמה זהה בדיוק ל-57
#   • hosp_shabbat (57): rollback → העמודה shabbat_observant והמתג נעלמו; _settings_values בגרסה של 8 ו-_site_payload
#     בגרסה של 42 מילה במילה; הסכמה זהה בדיוק ל-56
#   • hosp_guest_area (56): rollback → קודי הכניסה, החיבורים ופונקציות "ההזמנות שלי" נעלמו;
#     guest_payment_info / guest_set_payment_method / guest_proof_slot בגרסה של 55 מילה במילה; הסכמה זהה בדיוק ל-55
#   • hosp_bank_transfer (55): הגנה (נעצר כשיש אישורי העברה / קבצים בדלי), rollback → הטבלה, הדלי
#     הפרטי, העמודה payment_method ופונקציות ההעברה נעלמו; guest_payment_info ו-public_payment_methods()
#     בגרסה של 37 מילה במילה; הסכמה זהה בדיוק ל-54
#   • hosp_unit_size (41): rollback → העמודה size_sqm נמחקה, _unit_json / _unit_apply / unit_create /
#     unit_update בגרסה של 11 ו-_site_payload בגרסה של 21 מילה במילה; הסכמה זהה בדיוק ל-40
#   • hosp_portal_open (40): rollback → portal_open_site, portal_trial_days, טריגר "האתר נפתח בפרסום"
#     ופונקציות העזר נעלמו, שתי העמודות של הבקשות נמחקו, _site_request_json / setup_guide / setup_save /
#     site_editor בגרסאות של 31 / 35 / 35 / 21 מילה במילה, הניסיון חוזר ל-14 יום; הסכמה זהה בדיוק ל-39
#   • hosp_confirm_link (39): rollback → הטוקן השני (עמודה, CHECK, אינדקס) נמחק, _guest_booking,
#     approve_booking ו-_anonymize_guest בגרסה של מיגרציה 14 מילה במילה, הסכמה זהה בדיוק למצב של 38
#   • hosp_unit_photos_public (38): בלי נתונים חדשים; rollback → _public_media בגרסה של מיגרציה 19
#     מילה במילה, הסכמה זהה בדיוק למצב של מיגרציה 37
#   • hosp_reports (F7): בלי נתונים חדשים; rollback → פונקציות הדוחות נעלמו, הפונקציות של לוח הבקרה
#     חוזרות לגרסה של מיגרציה 32 מילה במילה, הסכמה זהה בדיוק למצב של מיגרציה 33
#   • hosp_support (E4): הגנה (נעצר כשיש פניות / קבצים), rollback → הטבלאות, הפונקציות והדלי
#     הפרטי נעלמו, הסכמה זהה בדיוק למצב של מיגרציה 32
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
M27=20261103110000_hosp_channel_alerts
M28=20261103120000_hosp_phone_payments
M29=20261104090000_portal_business_details
M30=20261104100000_hosp_plans_pricing
M31=20261104110000_hosp_site_requests
M32=20261105090000_hosp_dashboard
M33=20261105100000_hosp_support
M34=20261105110000_hosp_reports
M35=20261105120000_hosp_setup_guide
M36=20261105130000_hosp_rate_check
M37=20261105140000_hosp_payment_instructions
M38=20261105150000_hosp_unit_photos_public
M39=20261105160000_hosp_confirm_link
M40=20261105170000_hosp_portal_open
M41=20261105180000_hosp_unit_size
M42=20261105190000_hosp_logo_brand
M43=20261105200000_hosp_open_dates
M44=20261105210000_hosp_booking_groups
M45=20261106120000_hosp_sec_c1_guest_claim
M46=20261106130000_sec_h1_trusted_account
M47=20261106140000_sec_h4_bucket_mime
M48=20261106150000_sec_h5_double_opt_in
M49=20261106160000_sec_m3_online_hold_guard
M50=20261106170000_sec_m5_keep_platform_records
M51=20261106180000_sec_p3_low_findings
M52=20261106190000_sec_p3_helpers_quote_email
M53=20261106200000_sec_prv_guest_privacy
M54=20261107100000_lic_digital_licenses
M55=20261108100000_hosp_bank_transfer
M56=20261108110000_hosp_guest_area
M57=20261108120000_hosp_shabbat
M58=20261108130000_hosp_platform_separation
M59=20261108140000_hosp_packages
M60=20261109100000_hosp_site_documents
M61=20261110100000_ai_assistant
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

# ---------- NURIEL AI ASSISTANT (migration 61) ----------
expect "before the rollback: the 9 AI tables (RLS) closed to the browser (server: read only), the functions for the server only" \
  "SELECT (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
                                           AND c.relname LIKE 'ai\\_%' AND c.relrowsecurity) = 9
      AND NOT EXISTS (SELECT 1 FROM pg_class c, unnest(ARRAY['anon', 'authenticated']) r(role),
                                    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p(priv)
                       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'ai\\_%'
                         AND has_table_privilege(r.role, c.oid, p.priv))
      AND NOT has_table_privilege('authenticated', 'public.ai_settings', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.ai_subscriptions', 'SELECT')
      AND has_table_privilege('service_role', 'public.ai_subscriptions', 'SELECT')
      AND NOT has_table_privilege('service_role', 'public.ai_subscription_periods', 'INSERT')
      AND has_function_privilege('service_role', 'public.ai_entitlement(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ai_entitlement(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ai_admin_activate(uuid,uuid,text,date,text,boolean)', 'EXECUTE')"
echo "rollback guard: $M61 refuses while a package exists, and while the assistant is configured"
q "SET session_replication_role = replica;
   INSERT INTO public.ai_subscriptions (tenant_id, package_code, product)
   SELECT id, 'nuriel_ai_ecommerce', 'ecommerce' FROM public.tenants WHERE is_default" >/dev/null
if down "$M61" 2>/dev/null; then
  echo "  FAIL rollback ran although a package exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('public.ai_subscriptions') IS NOT NULL AND (SELECT count(*) FROM public.ai_subscriptions) = 1"
q "DELETE FROM public.ai_subscriptions" >/dev/null
q "UPDATE public.ai_settings SET mode = 'test'" >/dev/null
if down "$M61" 2>/dev/null; then
  echo "  FAIL rollback ran although the assistant is not off"; exit 1
fi
q "UPDATE public.ai_settings SET mode = 'off'" >/dev/null
q "INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details) VALUES (NULL, NULL, 'ai_settings_changed', '{\"rb\": true}')" >/dev/null
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M61" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M61"
down "$M61"
expect "the AI add-on is gone: the 9 tables and every ai_ function; the platform log keeps its rows" \
  "SELECT to_regclass('public.ai_packages') IS NULL
      AND to_regclass('public.ai_subscriptions') IS NULL
      AND to_regclass('public.ai_subscription_periods') IS NULL
      AND to_regclass('public.ai_subscription_events') IS NULL
      AND to_regclass('public.ai_settings') IS NULL
      AND to_regclass('public.ai_usage_log') IS NULL
      AND to_regclass('public.ai_usage_daily') IS NULL
      AND to_regclass('public.ai_rate_buckets') IS NULL
      AND to_regclass('public.ai_notifications') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'ai\_%')
      AND EXISTS (SELECT 1 FROM public.platform_audit_log WHERE action = 'ai_settings_changed')"
q "DELETE FROM public.platform_audit_log WHERE action = 'ai_settings_changed'" >/dev/null
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m60.sql"
schema_dump "$SCHEMA_DIR/after-m61-down.sql"
if diff -q "$SCHEMA_DIR/m60.sql" "$SCHEMA_DIR/after-m61-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 60, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 60:"; diff "$SCHEMA_DIR/m60.sql" "$SCHEMA_DIR/after-m61-down.sql" | head -20; exit 1
fi

# ---------- site documents, accessibility statement and arrangements (migration 60) ----------
expect "before the rollback: the 5 tables (functions only), public documents for the site, the booking wrappers for the server only" \
  "SELECT to_regclass('hospitality.site_documents') IS NOT NULL
      AND to_regclass('hospitality.site_document_versions') IS NOT NULL
      AND to_regclass('hospitality.booking_document_acceptances') IS NOT NULL
      AND to_regclass('hospitality.property_accessibility') IS NOT NULL
      AND to_regclass('hospitality.site_legal_profile') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'hospitality.site_documents', 'SELECT')
      AND NOT has_table_privilege('anon', 'hospitality.site_document_versions', 'SELECT')
      AND has_function_privilege('anon', 'hospitality.public_site_documents()', 'EXECUTE')
      AND has_function_privilege('anon', 'hospitality.public_site_document(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"
echo "rollback guard: $M60 refuses while a document draft exists"
q "SET session_replication_role = replica;
   INSERT INTO hospitality.site_documents (tenant_id, kind, draft_title, draft_body)
   VALUES (gen_random_uuid(), 'privacy', 'rb-doc', 'rb-body')" >/dev/null
if down "$M60" 2>/dev/null; then
  echo "  FAIL rollback ran although a document exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('hospitality.site_documents') IS NOT NULL AND (SELECT count(*) FROM hospitality.site_documents) = 1"
q "DELETE FROM hospitality.site_documents" >/dev/null
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M60" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M60"
down "$M60"
expect "the documents are gone: the 5 tables and the functions; the booking requests are the originals" \
  "SELECT to_regclass('hospitality.site_documents') IS NULL
      AND to_regclass('hospitality.booking_document_acceptances') IS NULL
      AND to_regclass('hospitality.property_accessibility') IS NULL
      AND to_regprocedure('hospitality.public_site_documents()') IS NULL
      AND to_regprocedure('hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)') IS NULL
      AND (SELECT prosrc NOT LIKE '%document%' FROM pg_proc WHERE oid = 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m59.sql"
schema_dump "$SCHEMA_DIR/after-m60-down.sql"
if diff -q "$SCHEMA_DIR/m59.sql" "$SCHEMA_DIR/after-m60-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 59, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 59:"; diff "$SCHEMA_DIR/m59.sql" "$SCHEMA_DIR/after-m60-down.sql" | head -20; exit 1
fi

# ---------- A7: packages (migration 59) ----------
expect "before the rollback: the packages table (functions only), the booking columns, quote / request for the server only, the package in emails and pages" \
  "SELECT to_regclass('hospitality.packages') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'hospitality.packages', 'SELECT')
      AND NOT has_table_privilege('anon', 'hospitality.packages', 'SELECT')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings'
                   AND column_name = 'package_snapshot')
      AND has_function_privilege('anon', 'hospitality.public_packages()', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'hospitality.request_booking_package(uuid,date,text,text,text,text,boolean,text,integer,integer,text,boolean,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'hospitality.request_booking_package(uuid,date,text,text,text,text,boolean,text,integer,integer,text,boolean,text)', 'EXECUTE')
      AND (SELECT prosrc LIKE '%package_name%' FROM pg_proc WHERE oid = 'hospitality._enqueue(hospitality.bookings,text,text,jsonb,boolean)'::regprocedure)
      AND (SELECT prosrc LIKE '%package_name%' FROM pg_proc WHERE oid = 'hospitality._guest_view(hospitality.bookings)'::regprocedure)
      AND (SELECT prosrc LIKE '%package_snapshot%' FROM pg_proc WHERE oid = 'hospitality.staff_booking_detail(uuid)'::regprocedure)"
echo "rollback guard: $M59 refuses while a package exists"
# a package row only for the guard (no business needed: replica mode skips the foreign keys and triggers)
q "SET session_replication_role = replica;
   INSERT INTO hospitality.packages (tenant_id, unit_id, name, slug, nights, price, max_guests)
   VALUES (gen_random_uuid(), gen_random_uuid(), 'rb-package', 'rb-package', 2, 1000, 2)" >/dev/null
if down "$M59" 2>/dev/null; then
  echo "  FAIL rollback ran although a package exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('hospitality.packages') IS NOT NULL AND (SELECT count(*) FROM hospitality.packages) = 1"
q "DELETE FROM hospitality.packages" >/dev/null
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M59" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M59"
down "$M59"
expect "the packages are gone: table, booking columns, functions; the email queue, the guest view and the staff booking page are the originals" \
  "SELECT to_regclass('hospitality.packages') IS NULL
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings'
                       AND column_name IN ('package_id', 'package_snapshot'))
      AND to_regprocedure('hospitality.public_packages()') IS NULL
      AND to_regprocedure('hospitality.package_quote(uuid,date,integer,integer)') IS NULL
      AND (SELECT prosrc NOT LIKE '%package%' FROM pg_proc WHERE oid = 'hospitality._enqueue(hospitality.bookings,text,text,jsonb,boolean)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%package%' FROM pg_proc WHERE oid = 'hospitality._guest_view(hospitality.bookings)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%package%' FROM pg_proc WHERE oid = 'hospitality.staff_booking_detail(uuid)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m58.sql"
schema_dump "$SCHEMA_DIR/after-m59-down.sql"
if diff -q "$SCHEMA_DIR/m58.sql" "$SCHEMA_DIR/after-m59-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 58, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 58:"; diff "$SCHEMA_DIR/m58.sql" "$SCHEMA_DIR/after-m59-down.sql" | head -20; exit 1
fi

# ---------- A4: the platform panel keeps stores and hospitality sites apart (migration 58) ----------
expect "before the rollback: the stores list is online stores only; the site list has the plan screen's fields" \
  "SELECT (SELECT prosrc LIKE '%site_type = ''ecommerce''%' FROM pg_proc WHERE oid = 'public.platform_list_tenants()'::regprocedure)
      AND (SELECT prosrc LIKE '%current_period_end%' FROM pg_proc WHERE oid = 'hospitality.admin_sites()'::regprocedure)"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M58" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M58"
down "$M58"
expect "both functions are the originals" \
  "SELECT (SELECT prosrc NOT LIKE '%site_type%' FROM pg_proc WHERE oid = 'public.platform_list_tenants()'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%current_period_end%' FROM pg_proc WHERE oid = 'hospitality.admin_sites()'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m57.sql"
schema_dump "$SCHEMA_DIR/after-m58-down.sql"
if diff -q "$SCHEMA_DIR/m57.sql" "$SCHEMA_DIR/after-m58-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 57, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 57:"; diff "$SCHEMA_DIR/m57.sql" "$SCHEMA_DIR/after-m58-down.sql" | head -20; exit 1
fi

# ---------- A6: "מתחם שומר שבת" (migration 57) ----------
expect "before the rollback: the column (off everywhere), the switch for staff, the value on the site" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'settings'
                   AND column_name = 'shabbat_observant')
      AND NOT EXISTS (SELECT 1 FROM hospitality.settings WHERE shabbat_observant)
      AND has_function_privilege('authenticated', 'hospitality.settings_set_shabbat(boolean)', 'EXECUTE')
      AND (SELECT prosrc LIKE '%shabbat_observant%' FROM pg_proc WHERE oid = 'hospitality._site_payload(uuid)'::regprocedure)"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M57" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M57"
down "$M57"
expect "the column and the switch are gone; the site payload and the settings values are the originals" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'settings'
                       AND column_name = 'shabbat_observant')
      AND to_regprocedure('hospitality.settings_set_shabbat(boolean)') IS NULL
      AND (SELECT prosrc NOT LIKE '%shabbat%' FROM pg_proc WHERE oid = 'hospitality._site_payload(uuid)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%shabbat%' FROM pg_proc WHERE oid = 'hospitality._settings_values(hospitality.settings)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m56.sql"
schema_dump "$SCHEMA_DIR/after-m57-down.sql"
if diff -q "$SCHEMA_DIR/m56.sql" "$SCHEMA_DIR/after-m57-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 56, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 56:"; diff "$SCHEMA_DIR/m56.sql" "$SCHEMA_DIR/after-m57-down.sql" | head -20; exit 1
fi

# ---------- A2: the guest area "ההזמנות שלי" (migration 56) ----------
expect "before the rollback: codes and sessions (functions only), every area function server-only, the 55 functions call the shared helpers" \
  "SELECT to_regclass('hospitality.guest_codes') IS NOT NULL
      AND to_regclass('hospitality.guest_sessions') IS NOT NULL
      AND NOT has_table_privilege('service_role', 'hospitality.guest_sessions', 'SELECT')
      AND NOT has_function_privilege('anon', 'hospitality.guest_area_bookings(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'hospitality.guest_code_consume(text,text,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'hospitality.guest_area_proof_slot(text,uuid,text,text,integer)', 'EXECUTE')
      AND (SELECT prosrc LIKE '%_guest_payment_json%' FROM pg_proc WHERE oid = 'hospitality.guest_payment_info(text,uuid)'::regprocedure)"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M56" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M56"
down "$M56"
expect "the guest area is gone; the three 55 functions are the originals" \
  "SELECT to_regclass('hospitality.guest_codes') IS NULL
      AND to_regclass('hospitality.guest_sessions') IS NULL
      AND to_regprocedure('hospitality.guest_area_bookings(text)') IS NULL
      AND to_regprocedure('hospitality._guest_payment_json(uuid,hospitality.bookings)') IS NULL
      AND (SELECT prosrc NOT LIKE '%_guest_payment_json%' FROM pg_proc WHERE oid = 'hospitality.guest_payment_info(text,uuid)'::regprocedure)
      AND (SELECT prosrc LIKE '%_transfer_state%' FROM pg_proc WHERE oid = 'hospitality.guest_proof_slot(text,uuid,text,text,integer)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m55.sql"
schema_dump "$SCHEMA_DIR/after-m56-down.sql"
if diff -q "$SCHEMA_DIR/m55.sql" "$SCHEMA_DIR/after-m56-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 55, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 55:"; diff "$SCHEMA_DIR/m55.sql" "$SCHEMA_DIR/after-m56-down.sql" | head -20; exit 1
fi

# ---------- A5: bank-transfer policy and transfer proofs (migration 55) ----------
expect "before the rollback: proofs table (functions only), private bucket, the 7-day rule, dated payment methods, server-only 'ready'" \
  "SELECT to_regclass('hospitality.payment_proofs') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'hospitality.payment_proofs', 'SELECT')
      AND NOT has_table_privilege('anon', 'hospitality.payment_proofs', 'SELECT')
      AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-payment-proofs' AND NOT public)
      AND hospitality._bank_transfer_min_days() = 7
      AND to_regprocedure('hospitality.public_payment_methods(date)') IS NOT NULL
      AND to_regprocedure('hospitality.public_payment_methods()') IS NULL
      AND NOT has_function_privilege('anon', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
      AND has_function_privilege('service_role', 'hospitality.guest_proof_ready(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'hospitality.payment_proof_review(uuid,text,numeric,text)', 'EXECUTE')"
echo "rollback guard: $M55 refuses while a transfer-proof file is stored"
q "INSERT INTO storage.objects (bucket_id, name) VALUES ('hosp-payment-proofs', 'rb/a/b')" >/dev/null
if down "$M55" 2>/dev/null; then
  echo "  FAIL rollback ran although a transfer-proof file exists"; exit 1
fi
expect "nothing was removed (transaction rolled back)" \
  "SELECT to_regclass('hospitality.payment_proofs') IS NOT NULL
      AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-payment-proofs')"
q "DELETE FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs'" >/dev/null
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M55" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M55"
down "$M55"
expect "the transfer module is gone: table, column, functions, bucket; the payment-instruction functions are the migration-37 versions" \
  "SELECT to_regclass('hospitality.payment_proofs') IS NULL
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'hospitality' AND table_name = 'bookings' AND column_name = 'payment_method')
      AND to_regprocedure('hospitality.guest_proof_slot(text,uuid,text,text,integer)') IS NULL
      AND to_regprocedure('hospitality._bank_for_booking(hospitality.bookings)') IS NULL
      AND to_regprocedure('hospitality.public_payment_methods()') IS NOT NULL
      AND to_regprocedure('hospitality.public_payment_methods(date)') IS NULL
      AND (SELECT prosrc NOT LIKE '%_transfer_state%' FROM pg_proc WHERE oid = 'hospitality.guest_payment_info(text,uuid)'::regprocedure)
      AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-payment-proofs')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m54.sql"
schema_dump "$SCHEMA_DIR/after-m55-down.sql"
if diff -q "$SCHEMA_DIR/m54.sql" "$SCHEMA_DIR/after-m55-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 54, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 54:"; diff "$SCHEMA_DIR/m54.sql" "$SCHEMA_DIR/after-m55-down.sql" | head -20; exit 1
fi

# ---------- LIC: digital licenses — tables, private bucket, pilot flag (migration 54) ----------
expect "before the rollback: 4 license tables (server only), atomic consume, the pilot flag on no store" \
  "SELECT to_regclass('public.license_files') IS NOT NULL
      AND to_regclass('public.license_deliveries') IS NOT NULL
      AND to_regclass('public.license_download_links') IS NOT NULL
      AND to_regclass('public.license_audit') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'public.license_deliveries', 'SELECT')
      AND NOT has_function_privilege('anon', 'public.license_consume_download(text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.license_consume_download(text)', 'EXECUTE')
      AND EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key = 'digital_licenses')
      AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE key = 'digital_licenses')"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M54" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M54"
down "$M54"
expect "the module is gone: tables, functions and the flag" \
  "SELECT to_regclass('public.license_files') IS NULL
      AND to_regclass('public.license_audit') IS NULL
      AND to_regprocedure('public.license_link_peek(text)') IS NULL
      AND to_regprocedure('public.license_check_refs()') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key = 'digital_licenses')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m53.sql"
schema_dump "$SCHEMA_DIR/after-m54-down.sql"
if diff -q "$SCHEMA_DIR/m53.sql" "$SCHEMA_DIR/after-m54-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 53, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 53:"; diff "$SCHEMA_DIR/m53.sql" "$SCHEMA_DIR/after-m54-down.sql" | head -20; exit 1
fi

# ---------- SEC-PRV: guest privacy — outbox links, anonymization, export (migration 53) ----------
expect "before the rollback: links stripped per room after sending, notes cleared on anonymization, the export includes history and payments" \
  "SELECT (SELECT prosrc LIKE '%PRV-17%' AND prosrc LIKE '%WITH ORDINALITY%' FROM pg_proc WHERE oid = 'hospitality.mark_notification(uuid,boolean,text,text)'::regprocedure)
      AND (SELECT prosrc LIKE '%cancellation_reason = NULL%' FROM pg_proc WHERE oid = 'hospitality._anonymize_guest(uuid,uuid)'::regprocedure)
      AND (SELECT prosrc LIKE '%''payments''%' FROM pg_proc WHERE oid = 'hospitality.export_guest(uuid)'::regprocedure)"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M53" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M53"
down "$M53"
expect "the three functions are the originals (top-level link only, notes kept, the shorter export)" \
  "SELECT (SELECT prosrc NOT LIKE '%PRV-17%' FROM pg_proc WHERE oid = 'hospitality.mark_notification(uuid,boolean,text,text)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%cancellation_reason = NULL%' FROM pg_proc WHERE oid = 'hospitality._anonymize_guest(uuid,uuid)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%''payments''%' FROM pg_proc WHERE oid = 'hospitality.export_guest(uuid)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m52.sql"
schema_dump "$SCHEMA_DIR/after-m53-down.sql"
if diff -q "$SCHEMA_DIR/m52.sql" "$SCHEMA_DIR/after-m53-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 52, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 52:"; diff "$SCHEMA_DIR/m52.sql" "$SCHEMA_DIR/after-m53-down.sql" | head -20; exit 1
fi

# ---------- SEC P3 (b): helpers, coupon quotes, own email on self-registration (migration 52) ----------
expect "before the rollback: helper grants narrowed, the coupon guard in both quote functions, the email trigger exists" \
  "SELECT NOT has_function_privilege('authenticated', 'public.product_serial_gap(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.staff_display_name(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.can_pick(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.is_warehouse(uuid)', 'EXECUTE')
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
            AND proname IN ('quote', 'quote_type') AND prosrc LIKE '%SEC-L4%') = 2
      AND (SELECT prosrc LIKE '%SEC-L3%' FROM pg_proc WHERE oid = 'public.order_coupon_verify(uuid)'::regprocedure)
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_roles_auth_email')"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M52" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M52"
down "$M52"
expect "the grants, the quote functions and order_coupon_verify are the originals; no email trigger" \
  "SELECT has_function_privilege('authenticated', 'public.product_serial_gap(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.staff_display_name(uuid)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.can_pick(uuid)', 'EXECUTE')
      AND has_function_privilege('anon', 'public.is_warehouse(uuid)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
                       AND proname IN ('quote', 'quote_type') AND prosrc LIKE '%SEC-L4%')
      AND (SELECT prosrc NOT LIKE '%SEC-L3%' FROM pg_proc WHERE oid = 'public.order_coupon_verify(uuid)'::regprocedure)
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'user_roles_auth_email')
      AND to_regprocedure('public.user_roles_auth_email()') IS NULL"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m51.sql"
schema_dump "$SCHEMA_DIR/after-m52-down.sql"
if diff -q "$SCHEMA_DIR/m51.sql" "$SCHEMA_DIR/after-m52-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 51, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 51:"; diff "$SCHEMA_DIR/m51.sql" "$SCHEMA_DIR/after-m52-down.sql" | head -20; exit 1
fi

# ---------- SEC P3: low findings (migration 51) ----------
expect "before the rollback: login-email map is server-only, no anon reset requests, site requests keep guest cards" \
  "SELECT NOT has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'password_reset_requests' AND policyname = 'anyone can request reset')
      AND (SELECT bool_and(prosrc NOT LIKE '%SET marketing_consent = true%') FROM pg_proc
            WHERE pronamespace = 'hospitality'::regnamespace AND proname IN ('request_booking', 'request_booking_group'))"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M51" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M51"
down "$M51"
expect "the grant, the reset policy and the earlier request functions are back" \
  "SELECT has_function_privilege('authenticated', 'public.resolve_login_email(text)', 'EXECUTE')
      AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'password_reset_requests' AND policyname = 'anyone can request reset')
      AND (SELECT bool_and(prosrc LIKE '%SET marketing_consent = true%') FROM pg_proc
            WHERE pronamespace = 'hospitality'::regnamespace AND proname IN ('request_booking', 'request_booking_group'))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m50.sql"
schema_dump "$SCHEMA_DIR/after-m51-down.sql"
if diff -q "$SCHEMA_DIR/m50.sql" "$SCHEMA_DIR/after-m51-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 50, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 50:"; diff "$SCHEMA_DIR/m50.sql" "$SCHEMA_DIR/after-m51-down.sql" | head -20; exit 1
fi

# ---------- SEC-M5: store deletion keeps Nuriel's own records (migration 50) ----------
expect "before the rollback: billing / audit rows are not cascaded or purged; billing keeps a store label" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('billing_history_tenant_id_fkey', 'platform_audit_log_tenant_id_fkey'))
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'billing_history' AND column_name = 'store_label')
      AND (SELECT prosrc LIKE '%tenant_deleted%' FROM pg_proc WHERE oid = 'public.platform_delete_tenant(uuid,text)'::regprocedure)"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M50" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M50"
down "$M50"
expect "the cascading foreign keys are back, the label column is gone, the delete function is the original" \
  "SELECT (SELECT count(*) FROM pg_constraint WHERE conname IN ('billing_history_tenant_id_fkey', 'platform_audit_log_tenant_id_fkey')
            AND pg_get_constraintdef(oid) LIKE '%ON DELETE CASCADE%') = 2
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'billing_history' AND column_name = 'store_label')
      AND (SELECT prosrc NOT LIKE '%tenant_deleted%' FROM pg_proc WHERE oid = 'public.platform_delete_tenant(uuid,text)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m49.sql"
schema_dump "$SCHEMA_DIR/after-m50-down.sql"
if diff -q "$SCHEMA_DIR/m49.sql" "$SCHEMA_DIR/after-m50-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 49, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 49:"; diff "$SCHEMA_DIR/m49.sql" "$SCHEMA_DIR/after-m50-down.sql" | head -20; exit 1
fi

# ---------- SEC-M3: hold guard on site requests (migration 49) ----------
expect "before the rollback: the hold guard exists and both site request functions call it" \
  "SELECT to_regprocedure('hospitality._online_hold_guard(uuid,uuid[],date,date)') IS NOT NULL
      AND (SELECT count(*) FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
            AND proname IN ('request_booking', 'request_booking_group') AND prosrc LIKE '%_online_hold_guard%') = 2"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M49" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M49"
down "$M49"
expect "the guard is gone and the site request functions no longer call it" \
  "SELECT to_regprocedure('hospitality._online_hold_guard(uuid,uuid[],date,date)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
                       AND proname IN ('request_booking', 'request_booking_group') AND prosrc LIKE '%_online_hold_guard%')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m48.sql"
schema_dump "$SCHEMA_DIR/after-m49-down.sql"
if diff -q "$SCHEMA_DIR/m48.sql" "$SCHEMA_DIR/after-m49-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 48, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 48:"; diff "$SCHEMA_DIR/m48.sql" "$SCHEMA_DIR/after-m49-down.sql" | head -20; exit 1
fi

# ---------- SEC-H5: marketing double opt-in (migration 48) ----------
expect "before the rollback: consent is double opt-in (confirm function, token + evidence columns)" \
  "SELECT to_regprocedure('public.marketing_confirm(text,text,text)') IS NOT NULL
      AND to_regprocedure('public.marketing_set_consent(text,boolean,text,text,uuid,text,text,text,text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.marketing_set_consent(text,boolean,text,text,uuid)') IS NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'marketing_consents' AND column_name = 'confirm_token_hash')"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M48" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M48"
down "$M48"
expect "single opt-in is back: the part-40 consent function, no confirm function, no new columns" \
  "SELECT to_regprocedure('public.marketing_confirm(text,text,text)') IS NULL
      AND to_regprocedure('public.marketing_release_confirm(text,text)') IS NULL
      AND to_regprocedure('public.marketing_set_consent(text,boolean,text,text,uuid)') IS NOT NULL
      AND to_regprocedure('public.marketing_set_consent(text,boolean,text,text,uuid,text,text,text,text,jsonb)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name IN ('marketing_consents', 'marketing_consent_events')
                       AND column_name IN ('confirm_token_hash', 'confirm_sent_at', 'confirm_context', 'confirmed_at',
                                           'consent_ip_hash', 'consent_user_agent', 'consent_method',
                                           'kind', 'ip_hash', 'user_agent', 'method'))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m47.sql"
schema_dump "$SCHEMA_DIR/after-m48-down.sql"
if diff -q "$SCHEMA_DIR/m47.sql" "$SCHEMA_DIR/after-m48-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 47, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 47:"; diff "$SCHEMA_DIR/m47.sql" "$SCHEMA_DIR/after-m48-down.sql" | head -20; exit 1
fi

# ---------- SEC-H4: MIME allowlist on the public Ecommerce buckets (migration 47, data only) ----------
expect "before the rollback: product-images and branding accept raster (+ banner video) only — no SVG" \
  "SELECT count(*) = 2 AND bool_and(allowed_mime_types IS NOT NULL AND file_size_limit IS NOT NULL
                                  AND NOT ('image/svg+xml' = ANY (allowed_mime_types)))
     FROM storage.buckets WHERE id IN ('product-images', 'branding')"
echo "rollback: $M47"
down "$M47"
expect "the buckets are kept (they hold every product image and logo) with no type or size limit again" \
  "SELECT count(*) = 2 AND bool_and(allowed_mime_types IS NULL AND file_size_limit IS NULL AND public)
     FROM storage.buckets WHERE id IN ('product-images', 'branding')"
schema_dump "$SCHEMA_DIR/after-m47-down.sql"
# (the schema just before this rollback is the one after the migration-48 rollback above)
if diff -q "$SCHEMA_DIR/after-m48-down.sql" "$SCHEMA_DIR/after-m47-down.sql" >/dev/null; then
  echo "  ok   data-only migration: the schema is unchanged by the rollback"
else
  echo "  FAIL migration 47 changed the schema:"; diff "$SCHEMA_DIR/after-m48-down.sql" "$SCHEMA_DIR/after-m47-down.sql" | head -20; exit 1
fi

# ---------- SEC-H1: trusted-account binding (migration 46) ----------
expect "before the rollback: the trusted-account helper exists and the six binding functions use it" \
  "SELECT to_regprocedure('public._platform_account_id(text)') IS NOT NULL
      AND (SELECT bool_and(prosrc LIKE '%_platform_account_id%') FROM pg_proc
            WHERE oid IN ('hospitality.admin_set_owner(uuid,text,text)'::regprocedure,
                          'hospitality.team_add_manager(text,text)'::regprocedure,
                          'hospitality.portal_open_site(text,text,jsonb)'::regprocedure,
                          'public.platform_link_store_admin(uuid,text)'::regprocedure,
                          'public.portal_create_store(text,text,text)'::regprocedure,
                          'public.store_link_existing_account(text,text,text)'::regprocedure))"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M46" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M46"
down "$M46"
expect "the helper is gone and the six binding functions resolve the account by email again" \
  "SELECT to_regprocedure('public._platform_account_id(text)') IS NULL
      AND (SELECT bool_and(prosrc NOT LIKE '%_platform_account_id%' AND prosrc LIKE '%auth.users%') FROM pg_proc
            WHERE oid IN ('hospitality.admin_set_owner(uuid,text,text)'::regprocedure,
                          'hospitality.team_add_manager(text,text)'::regprocedure,
                          'hospitality.portal_open_site(text,text,jsonb)'::regprocedure,
                          'public.platform_link_store_admin(uuid,text)'::regprocedure,
                          'public.portal_create_store(text,text,text)'::regprocedure,
                          'public.store_link_existing_account(text,text,text)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m45.sql"
schema_dump "$SCHEMA_DIR/after-m46-down.sql"
if diff -q "$SCHEMA_DIR/m45.sql" "$SCHEMA_DIR/after-m46-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 45, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 45:"; diff "$SCHEMA_DIR/m45.sql" "$SCHEMA_DIR/after-m46-down.sql" | head -20; exit 1
fi

# ---------- SEC-C1: token-gated guest claim (migration 45) ----------
expect "before the rollback: claim is token-gated; the booking functions carry no email auto-link" \
  "SELECT to_regprocedure('hospitality.claim_guest_bookings(text)') IS NOT NULL
      AND to_regprocedure('hospitality.claim_guest_bookings()') IS NULL
      AND (SELECT bool_and(prosrc NOT LIKE '%email_confirmed_at IS NOT NULL%') FROM pg_proc
            WHERE oid IN ('hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)'::regprocedure,
                          'hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)'::regprocedure))"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M45" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M45"
down "$M45"
expect "the no-arg claim is restored; the booking functions carry the email auto-link again" \
  "SELECT to_regprocedure('hospitality.claim_guest_bookings()') IS NOT NULL
      AND to_regprocedure('hospitality.claim_guest_bookings(text)') IS NULL
      AND (SELECT bool_and(prosrc LIKE '%email_confirmed_at IS NOT NULL%') FROM pg_proc
            WHERE oid IN ('hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)'::regprocedure,
                          'hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m44.sql"
schema_dump "$SCHEMA_DIR/after-m45-down.sql"
if diff -q "$SCHEMA_DIR/m44.sql" "$SCHEMA_DIR/after-m45-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 44, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 44:"; diff "$SCHEMA_DIR/m44.sql" "$SCHEMA_DIR/after-m45-down.sql" | head -20; exit 1
fi

# ---------- several rooms in one request (migration 44) ----------
expect "before the rollback: bookings have a group; the group functions exist" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings' AND column_name = 'group_id')
      AND to_regprocedure('hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)') IS NOT NULL
      AND to_regprocedure('hospitality.booking_group_decide(uuid,boolean,text)') IS NOT NULL"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M44" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M44"
down "$M44"
expect "the group column, its index and the four functions are gone" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings' AND column_name = 'group_id')
      AND to_regclass('hospitality.bookings_group_idx') IS NULL
      AND to_regprocedure('hospitality.public_free_units(date,date)') IS NULL
      AND to_regprocedure('hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)') IS NULL
      AND to_regprocedure('hospitality.booking_group(uuid)') IS NULL
      AND to_regprocedure('hospitality.booking_group_decide(uuid,boolean,text)') IS NULL"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m43.sql"
schema_dump "$SCHEMA_DIR/after-m44-down.sql"
if diff -q "$SCHEMA_DIR/m43.sql" "$SCHEMA_DIR/after-m44-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 43, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 43:"; diff "$SCHEMA_DIR/m43.sql" "$SCHEMA_DIR/after-m44-down.sql" | head -20; exit 1
fi

# ---------- open dates (migration 43) ----------
expect "before the rollback: units have an open-dates column; opening and the reminder exist" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units' AND column_name = 'open_until')
      AND to_regprocedure('hospitality.units_open_dates(uuid[],date)') IS NOT NULL
      AND to_regprocedure('hospitality.open_dates_remind()') IS NOT NULL"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M43" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M43"
down "$M43"
expect "the column and the two functions are gone; the six availability functions are the earlier versions" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units' AND column_name = 'open_until')
      AND to_regprocedure('hospitality.units_open_dates(uuid[],date)') IS NULL
      AND to_regprocedure('hospitality.open_dates_remind()') IS NULL
      AND (SELECT bool_and(prosrc NOT LIKE '%open_until%' AND prosrc NOT LIKE '%open_dates%') FROM pg_proc
            WHERE oid IN ('hospitality._quote(uuid,uuid,date,date,integer,integer,text,boolean,uuid,uuid)'::regprocedure,
                          'hospitality.calendar(date,date,uuid[],boolean)'::regprocedure,
                          'hospitality.public_availability(uuid,date,date)'::regprocedure,
                          'hospitality.public_type_availability(uuid,date,date)'::regprocedure,
                          'hospitality.channel_feed(uuid,text)'::regprocedure,
                          'hospitality.dashboard_tasks()'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m42.sql"
schema_dump "$SCHEMA_DIR/after-m43-down.sql"
if diff -q "$SCHEMA_DIR/m42.sql" "$SCHEMA_DIR/after-m43-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 42, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 42:"; diff "$SCHEMA_DIR/m42.sql" "$SCHEMA_DIR/after-m43-down.sql" | head -20; exit 1
fi

# ---------- the logo outside the galleries (migration 42) ----------
expect "before the rollback: a logo is its own kind ('brand'), outside the site gallery" \
  "SELECT pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname = 'media_owner_kind_check')) LIKE '%brand%'
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname = 'media_owner_check')"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M42" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M42"
down "$M42"
expect "no logo kind left; the table checks are the original ones; the media functions are the migration-12 / 38 / 41 versions" \
  "SELECT NOT EXISTS (SELECT 1 FROM hospitality.media WHERE owner_kind = 'brand')
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname = 'media_owner_check')
      AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname = 'media_owner_kind_check')) NOT LIKE '%brand%'
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname = 'media_check')
      AND (SELECT bool_and(prosrc NOT LIKE '%brand%') FROM pg_proc
            WHERE oid IN ('hospitality._media_owner(uuid,text,uuid)'::regprocedure,
                          'hospitality._media_ensure_cover(uuid,text,uuid,uuid)'::regprocedure,
                          'hospitality._public_media(uuid,text,uuid,uuid)'::regprocedure,
                          'hospitality._site_payload(uuid)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m41.sql"
schema_dump "$SCHEMA_DIR/after-m42-down.sql"
if diff -q "$SCHEMA_DIR/m41.sql" "$SCHEMA_DIR/after-m42-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 41, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 41:"; diff "$SCHEMA_DIR/m41.sql" "$SCHEMA_DIR/after-m42-down.sql" | head -20; exit 1
fi

# ---------- the size of a unit (migration 41) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M41" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M41"
down "$M41"
expect "the size column is gone; the unit functions are the migration-11 versions and _site_payload the migration-21 one" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'units' AND column_name = 'size_sqm')
      AND (SELECT bool_and(prosrc NOT LIKE '%size_sqm%') FROM pg_proc
            WHERE oid IN ('hospitality._unit_json(hospitality.units)'::regprocedure,
                          'hospitality._unit_apply(hospitality.units,jsonb,boolean)'::regprocedure,
                          'hospitality.unit_create(uuid,jsonb)'::regprocedure,
                          'hospitality.unit_update(uuid,jsonb,integer)'::regprocedure,
                          'hospitality._site_payload(uuid)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m40.sql"
schema_dump "$SCHEMA_DIR/after-m41-down.sql"
if diff -q "$SCHEMA_DIR/m40.sql" "$SCHEMA_DIR/after-m41-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 40, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 40:"; diff "$SCHEMA_DIR/m40.sql" "$SCHEMA_DIR/after-m41-down.sql" | head -20; exit 1
fi

# ---------- the portal opens a zimmer business by itself (migration 40) ----------
expect "before the rollback: a new business gets 30 days of trial" \
  "SELECT (SELECT trial_days FROM hospitality.plans WHERE code = 'trial') = 30"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M40" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M40"
down "$M40"
expect "the portal opening, its trigger and helpers are gone; the request columns are dropped; the trial is 14 days again" \
  "SELECT to_regprocedure('hospitality.portal_open_site(text,text,jsonb)') IS NULL
      AND to_regprocedure('hospitality.portal_trial_days()') IS NULL
      AND to_regprocedure('hospitality._opens_on_publish(uuid)') IS NULL
      AND to_regprocedure('hospitality._portal_opened(uuid)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'site_versions_portal_open')
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'site_requests'
                       AND column_name IN ('opened_tenant_id', 'opened_at'))
      AND (SELECT trial_days FROM hospitality.plans WHERE code = 'trial') = 14
      AND (SELECT bool_and(prosrc NOT LIKE '%opens_on_publish%' AND prosrc NOT LIKE '%opened_%') FROM pg_proc
            WHERE oid IN ('hospitality.setup_guide()'::regprocedure, 'hospitality.setup_save(text,text)'::regprocedure,
                          'hospitality.site_editor()'::regprocedure,
                          'hospitality._site_request_json(hospitality.site_requests)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m39.sql"
schema_dump "$SCHEMA_DIR/after-m40-down.sql"
if diff -q "$SCHEMA_DIR/m39.sql" "$SCHEMA_DIR/after-m40-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 39, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 39:"; diff "$SCHEMA_DIR/m39.sql" "$SCHEMA_DIR/after-m40-down.sql" | head -20; exit 1
fi

# ---------- a personal link in the booking-confirmed email (migration 39) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M39" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M39"
down "$M39"
expect "the second token is gone; _guest_booking, approve_booking and _anonymize_guest are the migration-14 versions again" \
  "SELECT NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings' AND column_name = 'manage_token2_hash')
      AND (SELECT bool_and(prosrc NOT LIKE '%manage_token2_hash%') FROM pg_proc
            WHERE oid IN ('hospitality._guest_booking(uuid,text,uuid,boolean)'::regprocedure,
                          'hospitality.approve_booking(uuid,integer)'::regprocedure,
                          'hospitality._anonymize_guest(uuid,uuid)'::regprocedure))"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m38.sql"
schema_dump "$SCHEMA_DIR/after-m39-down.sql"
if diff -q "$SCHEMA_DIR/m38.sql" "$SCHEMA_DIR/after-m39-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 38, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 38:"; diff "$SCHEMA_DIR/m38.sql" "$SCHEMA_DIR/after-m39-down.sql" | head -20; exit 1
fi

# ---------- unit photos on the public site (migration 38) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M38" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M38"
down "$M38"
expect "_public_media is the migration-19 version again (matches a unit photo by property and unit)" \
  "SELECT (SELECT prosrc LIKE '%property_id IS NOT DISTINCT FROM _property%' AND prosrc NOT LIKE '%WHEN ''unit''%'
             FROM pg_proc WHERE oid = 'hospitality._public_media(uuid,text,uuid,uuid)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m37.sql"
schema_dump "$SCHEMA_DIR/after-m38-down.sql"
if diff -q "$SCHEMA_DIR/m37.sql" "$SCHEMA_DIR/after-m38-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 37, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 37:"; diff "$SCHEMA_DIR/m37.sql" "$SCHEMA_DIR/after-m38-down.sql" | head -20; exit 1
fi

# ---------- payment instructions for guests (migration 37) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M37" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M37"
down "$M37"
expect "payment instructions table and functions are gone; the setup guide view is the migration-35 version again" \
  "SELECT to_regclass('hospitality.payment_settings') IS NULL
      AND to_regprocedure('hospitality.guest_payment_info(text,uuid)') IS NULL
      AND to_regprocedure('hospitality.payment_settings_save(jsonb,integer)') IS NULL
      AND (SELECT prosrc NOT LIKE '%payment_settings%' FROM pg_proc WHERE oid = 'hospitality._setup_view(uuid)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m36.sql"
schema_dump "$SCHEMA_DIR/after-m37-down.sql"
if diff -q "$SCHEMA_DIR/m36.sql" "$SCHEMA_DIR/after-m37-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 36, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 36:"; diff "$SCHEMA_DIR/m36.sql" "$SCHEMA_DIR/after-m37-down.sql" | head -20; exit 1
fi

# ---------- the shared rate counter (migration 36) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M36" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M36"
down "$M36"
expect "rate_check is the migration-25 version again (counts every attempt)" \
  "SELECT (SELECT prosrc NOT LIKE '%pg_advisory_xact_lock%' FROM pg_proc WHERE oid = 'hospitality.rate_check(jsonb)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m35.sql"
schema_dump "$SCHEMA_DIR/after-m36-down.sql"
if diff -q "$SCHEMA_DIR/m35.sql" "$SCHEMA_DIR/after-m36-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 35, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 35:"; diff "$SCHEMA_DIR/m35.sql" "$SCHEMA_DIR/after-m36-down.sql" | head -20; exit 1
fi

# ---------- the setup guide (migration 35) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M35" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M35"
down "$M35"
expect "setup guide table and functions are gone; management_context is the migration-7 version again" \
  "SELECT to_regclass('hospitality.setup_state') IS NULL
      AND to_regprocedure('hospitality.setup_guide()') IS NULL
      AND to_regprocedure('hospitality.setup_save(text,text)') IS NULL
      AND to_regprocedure('hospitality._setup_site_ready(uuid)') IS NULL
      AND (SELECT prosrc NOT LIKE '%_setup_%' FROM pg_proc WHERE oid = 'hospitality.management_context()'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m34.sql"
schema_dump "$SCHEMA_DIR/after-m35-down.sql"
if diff -q "$SCHEMA_DIR/m34.sql" "$SCHEMA_DIR/after-m35-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 34, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 34:"; diff "$SCHEMA_DIR/m34.sql" "$SCHEMA_DIR/after-m35-down.sql" | head -20; exit 1
fi

# ---------- F7: reports and export (migration 34) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M34" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M34"
down "$M34"
expect "report functions are gone; the dashboard helpers are the migration-32 versions again" \
  "SELECT to_regprocedure('hospitality.reports_view(date,date,uuid[],text[],text[])') IS NULL
      AND to_regprocedure('hospitality._report_nights(uuid,date,date,uuid[],text[])') IS NULL
      AND (SELECT prosrc NOT LIKE '%_report_%' FROM pg_proc WHERE oid = 'hospitality._dashboard_numbers(uuid,text,date,date,integer,boolean)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m33.sql"
schema_dump "$SCHEMA_DIR/after-m34-down.sql"
if diff -q "$SCHEMA_DIR/m33.sql" "$SCHEMA_DIR/after-m34-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 33, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 33:"; diff "$SCHEMA_DIR/m33.sql" "$SCHEMA_DIR/after-m34-down.sql" | head -20; exit 1
fi

# ---------- E4: the support system of the hospitality businesses (migration 33) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M33" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M33"
down "$M33"
expect "support tables, functions and the private bucket are gone" \
  "SELECT to_regclass('hospitality.support_tickets') IS NULL
      AND to_regclass('hospitality.support_messages') IS NULL
      AND to_regclass('hospitality.support_attachments') IS NULL
      AND to_regclass('hospitality.support_settings') IS NULL
      AND to_regprocedure('hospitality.support_open(text,text,text,text,jsonb)') IS NULL
      AND to_regprocedure('hospitality.admin_support_tickets(text,text,date,date,text,boolean,integer,integer)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-support')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m32.sql"
schema_dump "$SCHEMA_DIR/after-m33-down.sql"
if diff -q "$SCHEMA_DIR/m32.sql" "$SCHEMA_DIR/after-m33-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 32, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 32:"; diff "$SCHEMA_DIR/m32.sql" "$SCHEMA_DIR/after-m33-down.sql" | head -20; exit 1
fi

# ---------- F3: the owner's dashboard (migration 32) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M32" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M32"
down "$M32"
expect "dashboard functions, finance grants and the new indexes are gone; 13 permissions again" \
  "SELECT to_regprocedure('hospitality.dashboard_overview(date,date)') IS NULL
      AND to_regprocedure('hospitality.team_set_finance(uuid,boolean)') IS NULL
      AND to_regclass('hospitality.staff_grants') IS NULL
      AND to_regclass('hospitality.bookings_created_idx') IS NULL
      AND cardinality(hospitality.permissions()) = 13"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m31.sql"
schema_dump "$SCHEMA_DIR/after-m32-down.sql"
if diff -q "$SCHEMA_DIR/m31.sql" "$SCHEMA_DIR/after-m32-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 31, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 31:"; diff "$SCHEMA_DIR/m31.sql" "$SCHEMA_DIR/after-m32-down.sql" | head -20; exit 1
fi

# ---------- E2: zimmer site requests from the portal (migration 31) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M31" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M31"
down "$M31"
expect "the requests table and its functions are gone" \
  "SELECT to_regclass('hospitality.site_requests') IS NULL
      AND to_regprocedure('hospitality.site_request_submit(text,jsonb)') IS NULL
      AND to_regprocedure('hospitality.admin_site_requests()') IS NULL"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m30.sql"
schema_dump "$SCHEMA_DIR/after-m31-down.sql"
if diff -q "$SCHEMA_DIR/m30.sql" "$SCHEMA_DIR/after-m31-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 30, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 30:"; diff "$SCHEMA_DIR/m30.sql" "$SCHEMA_DIR/after-m31-down.sql" | head -20; exit 1
fi

# ---------- E3: plans with prices, setup fee, details and enforced limits (migration 30) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M30" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M30"
down "$M30"
expect "plan limits, plan editing and the new columns are gone; premium removed; placeholders back (no prices)" \
  "SELECT to_regprocedure('hospitality.admin_save_plan(text,jsonb)') IS NULL
      AND to_regprocedure('hospitality.public_plans()') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE '%plan_guard')
      AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
                        AND table_name = 'plans' AND column_name IN ('setup_fee', 'max_properties', 'max_media'))
      AND (SELECT count(*) FROM hospitality.plans WHERE NOT is_published AND price_monthly IS NULL) = 4
      AND (SELECT max_units = 5 AND max_managers = 2 FROM hospitality.plans WHERE code = 'basic')"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m29.sql"
schema_dump "$SCHEMA_DIR/after-m30-down.sql"
if diff -q "$SCHEMA_DIR/m29.sql" "$SCHEMA_DIR/after-m30-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 29, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 29:"; diff "$SCHEMA_DIR/m29.sql" "$SCHEMA_DIR/after-m30-down.sql" | head -20; exit 1
fi

# ---------- E1: business details when opening a store from the portal (migration 29) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M29" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M29"
down "$M29"
expect "the portal business-details functions are gone; the plain portal_create_store stays" \
  "SELECT to_regprocedure('public.portal_create_store_business(text,text,text,jsonb)') IS NULL
      AND to_regprocedure('public.portal_set_store_logo(text,uuid,text)') IS NULL
      AND to_regprocedure('public.portal_create_store(text,text,text)') IS NOT NULL"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m28.sql"
schema_dump "$SCHEMA_DIR/after-m29-down.sql"
if diff -q "$SCHEMA_DIR/m28.sql" "$SCHEMA_DIR/after-m29-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 28, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 28:"; diff "$SCHEMA_DIR/m28.sql" "$SCHEMA_DIR/after-m29-down.sql" | head -20; exit 1
fi

# ---------- D4: phone payments on the payments ledger (migration 28) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M28" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M28"
down "$M28"
expect "the card guard is gone; the payment functions are those of migrations 4 and 23" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_note_no_card')
      AND (SELECT prosrc NOT LIKE '%payment_status%' FROM pg_proc WHERE oid = 'hospitality._payments_sync(uuid, uuid)'::regprocedure)
      AND (SELECT prosrc NOT LIKE '%_payment_insert%' FROM pg_proc WHERE oid = 'hospitality.confirm_payment(uuid, numeric)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m27.sql"
schema_dump "$SCHEMA_DIR/after-m28-down.sql"
if diff -q "$SCHEMA_DIR/m27.sql" "$SCHEMA_DIR/after-m28-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 27, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 27:"; diff "$SCHEMA_DIR/m27.sql" "$SCHEMA_DIR/after-m28-down.sql" | head -20; exit 1
fi

# ---------- D3: conflict emails, occupancy source on the board (migration 27) ----------
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres \
  -c "SET client_min_messages = warning" -c "DROP DATABASE IF EXISTS rollback_ref" \
  -c "CREATE DATABASE rollback_ref ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$MIGRATIONS"/*.sql | sort); do
  [ "$(basename "$f" .sql)" = "$M27" ] && break
  psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; exit 1; }
done
echo "rollback: $M27"
down "$M27"
expect "the conflict trigger is gone; blocks are reported as in migration 14" \
  "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'channel_conflicts_notify')
      AND to_regprocedure('hospitality.channel_conflicts_notify()') IS NULL
      AND (SELECT provolatile = 'i' FROM pg_proc WHERE oid = 'hospitality._block_json(hospitality.blocks, text)'::regprocedure)"
pg_dump -h /tmp/pg -p "$PORT" -U postgres -d rollback_ref --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$SCHEMA_DIR/m26.sql"
schema_dump "$SCHEMA_DIR/after-m27-down.sql"
if diff -q "$SCHEMA_DIR/m26.sql" "$SCHEMA_DIR/after-m27-down.sql" >/dev/null; then
  echo "  ok   schema after the rollback = the schema of migration 26, exactly"
else
  echo "  FAIL schema after the rollback differs from migration 26:"; diff "$SCHEMA_DIR/m26.sql" "$SCHEMA_DIR/after-m27-down.sql" | head -20; exit 1
fi

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
echo "re-apply: $M1 … $M44"
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
up "$M27"
up "$M28"
up "$M29"
up "$M30"
up "$M31"
up "$M32"
up "$M33"
up "$M34"
up "$M35"
up "$M36"
up "$M37"
up "$M38"
up "$M39"
up "$M40"
up "$M41"
up "$M42"
up "$M43"
up "$M44"
up "$M45"
up "$M46"
up "$M47"
up "$M48"
up "$M49"
up "$M50"
up "$M51"
up "$M52"
up "$M53"
up "$M54"
up "$M55"
up "$M56"
up "$M57"
up "$M58"
up "$M59"
up "$M60"
up "$M61"
expect "the AI add-on is back: 9 tables closed to the browser, 2 packages at 150 ILS, the assistant off, functions for the server only" \
  "SELECT to_regclass('public.ai_subscriptions') IS NOT NULL
      AND to_regclass('public.ai_usage_daily') IS NOT NULL
      AND to_regclass('public.ai_rate_buckets') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'public.ai_settings', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.ai_usage_daily', 'SELECT')
      AND (SELECT count(*) FROM public.ai_packages WHERE price_agorot = 15000) = 2
      AND (SELECT mode FROM public.ai_settings) = 'off'
      AND has_function_privilege('service_role', 'public.ai_entitlement(uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.ai_entitlement(uuid)', 'EXECUTE')"
expect "the site documents are back: 5 tables (functions only), the public list, the booking wrappers for the server only" \
  "SELECT to_regclass('hospitality.site_documents') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'hospitality.site_documents', 'SELECT')
      AND has_function_privilege('anon', 'hospitality.public_site_documents()', 'EXECUTE')
      AND has_function_privilege('service_role', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"
expect "the packages are back: table (functions only), the booking columns, the site list" \
  "SELECT to_regclass('hospitality.packages') IS NOT NULL
      AND NOT has_table_privilege('authenticated', 'hospitality.packages', 'SELECT')
      AND has_function_privilege('anon', 'hospitality.public_packages()', 'EXECUTE')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings'
                   AND column_name = 'package_id')"
expect "the stores list is online stores only again" \
  "SELECT prosrc LIKE '%site_type = ''ecommerce''%' FROM pg_proc WHERE oid = 'public.platform_list_tenants()'::regprocedure"
expect "the shabbat switch is back (off everywhere)" \
  "SELECT to_regprocedure('hospitality.settings_set_shabbat(boolean)') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM hospitality.settings WHERE shabbat_observant)"
expect "the guest area is back: codes, sessions, the list for the server only" \
  "SELECT to_regclass('hospitality.guest_sessions') IS NOT NULL
      AND has_function_privilege('service_role', 'hospitality.guest_area_bookings(text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'hospitality.guest_area_bookings(text)', 'EXECUTE')"
expect "the transfer proofs are back: table, private bucket, dated payment methods" \
  "SELECT to_regclass('hospitality.payment_proofs') IS NOT NULL
      AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-payment-proofs' AND NOT public)
      AND to_regprocedure('hospitality.public_payment_methods(date)') IS NOT NULL"
expect "the license module is back: tables, atomic consume, the pilot flag (on no store)" \
  "SELECT to_regclass('public.license_download_links') IS NOT NULL
      AND to_regprocedure('public.license_consume_download(text)') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.platform_feature_flags WHERE key = 'digital_licenses')
      AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags WHERE key = 'digital_licenses')"
expect "site_type back, every store ecommerce" \
  "SELECT bool_and(site_type = 'ecommerce') FROM public.tenants"
expect "seed trigger has the WHEN condition again" \
  "SELECT pg_get_triggerdef(oid) LIKE '%WHEN ((new.site_type = ''ecommerce''::text))%' FROM pg_trigger WHERE tgname='tenants_seed_settings'"
expect "guard triggers back on all 40 Ecommerce tables (80 triggers)" \
  "SELECT count(*) = 80 FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard')"
expect "Ecommerce roles registered again" \
  "SELECT count(*) = 5 FROM public.platform_product_roles WHERE product = 'ecommerce'"
expect "Hospitality schema back: 46 tables (incl. the action log, arrival info, site versions, room types, payments, channels, the rate counters, the site requests, the staff grants, the 4 support tables, the setup guide state, the payment instructions, the transfer proofs and the guest-area codes and sessions, the packages and the 5 site-document tables), RLS on all, role admin, 6 flags off (incl. management)" \
  "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r' AND relrowsecurity) = 46
      AND (SELECT array_agg(role) FROM public.platform_product_roles WHERE product = 'hospitality') = ARRAY['admin']
      AND (SELECT count(*) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%' AND NOT enabled) = 6"
expect "hosp-media bucket back" "SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-media' AND public)"
expect "hosp-support bucket back, private" "SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-support' AND NOT public)"
expect "coupon release back" "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_coupon_usage')"
expect "management foundation back: seat trigger, Ecommerce guard branch, no staff outbox read" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_seat_guard')
     AND (SELECT prosrc LIKE '%site_type <> ''ecommerce''%' FROM pg_proc WHERE oid = 'public.user_roles_admin_seat_guard()'::regprocedure)
     AND NOT has_table_privilege('authenticated', 'hospitality.notifications', 'SELECT')
     AND (SELECT max_managers FROM hospitality.plans WHERE code = 'trial') = 3"
expect "settings and team back: guard trigger, action log, no direct settings writes, 14 permissions (12 + catalog.owner of migration 10 + reports.finance of migration 32)" \
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hospitality_admin_row_guard')
     AND to_regclass('hospitality.audit_log') IS NOT NULL
     AND NOT has_column_privilege('authenticated', 'hospitality.settings', 'check_in_time', 'UPDATE')
     AND cardinality(hospitality.permissions()) = 14"
expect "catalog back: functions, types, revision, no direct staff writes, 14 permissions" \
  "SELECT to_regprocedure('hospitality.whole_property_set(uuid, boolean, uuid[])') IS NOT NULL
     AND NOT has_table_privilege('authenticated', 'hospitality.units', 'INSERT')
     AND cardinality(hospitality.permissions()) = 14"
expect "site identity back: public name only, anon may call it" \
  "SELECT has_function_privilege('anon', 'hospitality.site_identity()', 'EXECUTE')
     AND (SELECT prosecdef FROM pg_proc WHERE oid = 'hospitality.site_identity()'::regprocedure)"
expect "plans back (3 unpublished placeholders + basic and premium with prices, stage E3), unit limit and terms guard active" \
  "SELECT (SELECT count(*) FROM hospitality.plans WHERE NOT is_published AND price_monthly IS NULL) = 3
     AND (SELECT count(*) FROM hospitality.plans WHERE is_published AND price_monthly IN (200, 400)) = 2
     AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('units_limit_guard', 'bookings_terms_guard')) = 2"
expect "booking engine back: EXCLUDE constraint, deferred integrity checks, guest functions (booking requests: app server only, migration 25)" \
  "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unit_occupancy_no_overlap')
     AND (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%consistency' AND tgdeferrable) = 3
     AND has_function_privilege('anon', 'hospitality.quote(uuid,date,date,integer,integer,text)', 'EXECUTE')
     AND has_function_privilege('service_role', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"

schema_dump "$SCHEMA_DIR/after.sql"
if diff -u "$SCHEMA_DIR/before.sql" "$SCHEMA_DIR/after.sql" > "$SCHEMA_DIR/schema.diff"; then
  echo "  ok   whole schema after rollback 44 → 1 and re-apply 1 → 44 is identical to the original ($(grep -c '^CREATE' "$SCHEMA_DIR/before.sql") CREATE statements compared)"
else
  echo "  FAIL the schema differs after rollback and re-apply:"; head -60 "$SCHEMA_DIR/schema.diff"; exit 1
fi
rm -rf "$SCHEMA_DIR"
"${PSQL[@]}" -d postgres -c "DROP DATABASE rollback_test" >/dev/null 2>&1 || true
echo "rollback check passed"

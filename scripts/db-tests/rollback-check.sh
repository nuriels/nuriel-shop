#!/usr/bin/env bash
# ============================================================
# בדיקת Rollback (מקומית בלבד): מסד חדש (rollback_test) עם כל המיגרציות.
# המיגרציות של Hospitality Stage 1 נבדקות בסדר הפוך (האחרונה קודם):
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
echo "re-apply: $M1 … $M6"
up "$M1"
up "$M2"
up "$M3"
up "$M4"
up "$M5"
up "$M6"
expect "site_type back, every store ecommerce" \
  "SELECT bool_and(site_type = 'ecommerce') FROM public.tenants"
expect "seed trigger has the WHEN condition again" \
  "SELECT pg_get_triggerdef(oid) LIKE '%WHEN ((new.site_type = ''ecommerce''::text))%' FROM pg_trigger WHERE tgname='tenants_seed_settings'"
expect "guard triggers back on all 40 Ecommerce tables (80 triggers)" \
  "SELECT count(*) = 80 FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard')"
expect "Ecommerce roles registered again" \
  "SELECT count(*) = 5 FROM public.platform_product_roles WHERE product = 'ecommerce'"
expect "Hospitality schema back: 21 tables, RLS on all, role admin, 5 flags off" \
  "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r' AND relrowsecurity) = 21
      AND (SELECT array_agg(role) FROM public.platform_product_roles WHERE product = 'hospitality') = ARRAY['admin']
      AND (SELECT count(*) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%' AND NOT enabled) = 5"
expect "hosp-media bucket back" "SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-media' AND public)"
expect "coupon release back" "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_coupon_usage')"
expect "plans back (4 unpublished placeholders), unit limit and terms guard active" \
  "SELECT (SELECT count(*) FROM hospitality.plans WHERE NOT is_published AND price_monthly IS NULL) = 4
     AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('units_limit_guard', 'bookings_terms_guard')) = 2"
expect "booking engine back: EXCLUDE constraint, deferred integrity checks, guest functions" \
  "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unit_occupancy_no_overlap')
     AND (SELECT count(*) FROM pg_trigger WHERE tgname LIKE '%consistency' AND tgdeferrable) = 3
     AND has_function_privilege('anon', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE')"

"${PSQL[@]}" -d postgres -c "DROP DATABASE rollback_test" >/dev/null 2>&1 || true
echo "rollback check passed"

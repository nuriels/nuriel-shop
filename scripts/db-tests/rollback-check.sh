#!/usr/bin/env bash
# ============================================================
# בדיקת Rollback (מקומית בלבד): מסד חדש (rollback_test) עם כל המיגרציות.
# המיגרציות של Hospitality Stage 1 נבדקות בסדר הפוך (האחרונה קודם):
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
echo "re-apply: $M1, $M2"
up "$M1"
up "$M2"
expect "site_type back, every store ecommerce" \
  "SELECT bool_and(site_type = 'ecommerce') FROM public.tenants"
expect "seed trigger has the WHEN condition again" \
  "SELECT pg_get_triggerdef(oid) LIKE '%WHEN ((new.site_type = ''ecommerce''::text))%' FROM pg_trigger WHERE tgname='tenants_seed_settings'"
expect "guard triggers back on all 40 Ecommerce tables (80 triggers)" \
  "SELECT count(*) = 80 FROM pg_trigger WHERE tgname IN ('ecommerce_rows_guard','ecommerce_row_move_guard')"
expect "Ecommerce roles registered again" \
  "SELECT count(*) = 5 FROM public.platform_product_roles WHERE product = 'ecommerce'"

"${PSQL[@]}" -d postgres -c "DROP DATABASE rollback_test" >/dev/null 2>&1 || true
echo "rollback check passed"

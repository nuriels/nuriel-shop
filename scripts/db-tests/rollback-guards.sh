#!/usr/bin/env bash
# ============================================================
# הגנות הנתונים בקבצי ה-rollback (ביקורת R-3) — מוכיחות שה-rollback לא מוחק נתוני לקוחות בשקט.
# לכל הגנה: מסד משוכפל מתבנית (כל המיגרציות), שורת "לקוח" אחת נזרעת (עוקפת FK וטריגרים בלבד — CHECK ו-NOT NULL נשארים),
# ואז מריצים את קובץ ה-rollback עם ON_ERROR_STOP ובודקים:
#   1. הקובץ נכשל עם ההודעה "יש N שורות" (ההגנה נורתה, ולא שגיאה אחרת);
#   2. הנתונים והטבלה עדיין קיימים (שום דבר לא נמחק).
# בנוסף: ההגנה לא נורית על מסד נקי — זה מכוסה ב-rollback-check.sh (כל ה-rollback-ים רצים שם על מסד בלי נתונים).
# שימוש:  bash scripts/db-tests/rollback-guards.sh   (אחרי run.sh — אותו Postgres, מקומי בלבד)
# ============================================================
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
SOCK=${KOBI_PGSOCKET:-/tmp/pg}
PG=(psql -X -q -h "$SOCK" -p "$PORT" -U postgres)
TMPL=rbg_template
WORK=rbg_work
FAILED=0
PASSED=0

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $TMPL" -c "DROP DATABASE IF EXISTS $WORK" \
  -c "CREATE DATABASE $TMPL ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null 2>&1
"${PG[@]}" -d "$TMPL" -v ON_ERROR_STOP=1 -f "$HERE/supabase-stubs.sql" >/dev/null
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  "${PG[@]}" -d "$TMPL" -f "$f" >/dev/null 2>&1 || { echo "FAILED migration: $f"; exit 1; }
done

# עזר: seed(<table>, <overrides jsonb: column → ביטוי SQL>) — שורה אחת עם ערכי דמה לעמודות החובה (כללי CHECK מוסרים מהעותק בלבד)
SEED_FN=$(cat <<'SQL'
CREATE FUNCTION pg_temp.seed(_tbl regclass, _over jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $f$
DECLARE r record; cols text[] := '{}'; vals text[] := '{}'; v text; ty regtype; lbl text;
BEGIN
  -- שורת הדמה לא צריכה לעמוד בכללי העסק (CHECK) — רק להתקיים; ה-rollback נבדק על קיום שורות
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = _tbl AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', _tbl, r.conname);
  END LOOP;
  FOR r IN SELECT a.attname, a.atttypid, a.attnotnull, a.atthasdef, a.attidentity, a.attgenerated, t.typtype, t.typbasetype
             FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
            WHERE a.attrelid = _tbl AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
  LOOP
    IF r.attgenerated <> '' OR r.attidentity = 'a' THEN CONTINUE; END IF;
    IF _over ? r.attname THEN
      v := _over ->> r.attname;
    ELSIF r.attnotnull AND NOT r.atthasdef AND r.attidentity = '' THEN
      ty := CASE WHEN r.typtype = 'd' THEN r.typbasetype ELSE r.atttypid END;
      IF r.typtype = 'e' THEN
        SELECT enumlabel INTO lbl FROM pg_enum WHERE enumtypid = r.atttypid ORDER BY enumsortorder LIMIT 1;
        v := quote_literal(lbl);
      ELSE
        v := CASE ty::text
          WHEN 'uuid' THEN 'gen_random_uuid()'
          WHEN 'boolean' THEN 'false'
          WHEN 'smallint' THEN '1' WHEN 'integer' THEN '1' WHEN 'bigint' THEN '1'
          WHEN 'numeric' THEN '1' WHEN 'double precision' THEN '1' WHEN 'real' THEN '1'
          WHEN 'date' THEN 'current_date'
          WHEN 'timestamp with time zone' THEN 'now()' WHEN 'timestamp without time zone' THEN 'now()'
          WHEN 'time without time zone' THEN '''12:00''::time' WHEN 'time with time zone' THEN '''12:00+00''::timetz'
          WHEN 'jsonb' THEN '''{}''::jsonb' WHEN 'json' THEN '''{}''::json'
          WHEN 'inet' THEN '''127.0.0.1''::inet' WHEN 'bytea' THEN '''\x00''::bytea'
          WHEN 'interval' THEN '''1 hour''::interval'
          ELSE CASE WHEN ty::text LIKE '%[]' THEN '''{}''' ELSE '''x''' END
        END;
      END IF;
    ELSE
      CONTINUE;
    END IF;
    cols := cols || quote_ident(r.attname);
    vals := vals || v;
  END LOOP;
  EXECUTE format('INSERT INTO %s (%s) VALUES (%s)', _tbl, array_to_string(cols, ', '), array_to_string(vals, ', '));
END $f$;
SQL
)

# check_guard <rollback file (no extension)> <table (qualified)> <seed SQL, run with FK/triggers off>
check_guard() {
  local file=$1 tbl=$2 seed=$3 label out rc rows
  label="$file → $tbl"
  "${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $WORK" -c "CREATE DATABASE $WORK TEMPLATE $TMPL" >/dev/null 2>&1
  if ! out=$("${PG[@]}" -d "$WORK" -v ON_ERROR_STOP=1 <<SQL 2>&1
$SEED_FN
SET session_replication_role = replica;
$seed
SQL
  ); then
    echo "  FAIL $label — the seed failed: $(echo "$out" | head -3 | tr '\n' ' ')"; FAILED=$((FAILED + 1)); return
  fi
  out=$("${PG[@]}" -d "$WORK" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/rollbacks/$file.down.sql" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "  FAIL $label — the rollback RAN with customer data present"; FAILED=$((FAILED + 1)); return
  fi
  if ! echo "$out" | grep -q "יש [0-9]* שורות"; then
    echo "  FAIL $label — it failed, but not on the data guard: $(echo "$out" | head -3 | tr '\n' ' ')"; FAILED=$((FAILED + 1)); return
  fi
  # הטבלה והשורה עדיין קיימות (ה-rollback לא נגע בדבר)
  rows=$("${PG[@]}" -d "$WORK" -tA -c "SELECT count(*) FROM $tbl" 2>&1)
  if [ "${rows:-0}" -ge 1 ] 2>/dev/null; then
    echo "  ok   $label — stopped on the guard; the table and its row are intact ($rows)"; PASSED=$((PASSED + 1))
  else
    echo "  FAIL $label — the table/rows are gone after the guard: $rows"; FAILED=$((FAILED + 1))
  fi
}

S() { local o=${2:-}; o=${o//\'/\'\'}; echo "SELECT pg_temp.seed('$1'$([ -n "$o" ] && echo ", '$o'::jsonb"));"; }

echo "== data guards stop the rollback when customer data exists =="
check_guard 20261019570000_announcement_coupon_email public.coupon_email_sends "$(S public.coupon_email_sends)"
check_guard 20261019570000_announcement_coupon_email public.site_settings "UPDATE public.site_settings SET announcement_text = 'מבצע' WHERE tenant_id = (SELECT id FROM public.tenants WHERE is_default);"
check_guard 20261019580000_announcement_rotation public.site_settings "UPDATE public.site_settings SET announcement_items = '[{\"text\":\"x\"}]'::jsonb WHERE tenant_id = (SELECT id FROM public.tenants WHERE is_default);"
check_guard 20261019590000_first_order_coupon public.coupons "$(S public.coupons '{"first_order_mode":"'"'"'auto'"'"'"}')"
check_guard 20261019600000_seo_keywords_llms public.site_settings "UPDATE public.site_settings SET seo_keywords = 'חנות' WHERE tenant_id = (SELECT id FROM public.tenants WHERE is_default);"
check_guard 20261101090000_platform_products_flags public.tenant_feature_flags "$(S public.tenant_feature_flags)"
check_guard 20261102150000_hosp_site_design hospitality.site_versions "$(S hospitality.site_versions)"
check_guard 20261102160000_hosp_room_types hospitality.unit_categories "$(S hospitality.unit_categories)"
check_guard 20261102160000_hosp_room_types hospitality.units "$(S hospitality.units '{"category_id":"gen_random_uuid()"}')"
check_guard 20261102170000_hosp_payments hospitality.payments "$(S hospitality.payments)"
check_guard 20261102180000_hosp_channels hospitality.channel_calendars "$(S hospitality.channel_calendars)"
check_guard 20261102180000_hosp_channels hospitality.channel_feeds "$(S hospitality.channel_feeds)"
check_guard 20261102180000_hosp_channels hospitality.blocks "$(S hospitality.blocks '{"external_uid":"'"'"'uid-1'"'"'"}')"
check_guard 20261105090000_hosp_dashboard hospitality.staff_grants "$(S hospitality.staff_grants)"
check_guard 20261105140000_hosp_payment_instructions hospitality.payment_settings "$(S hospitality.payment_settings)"
check_guard 20261105210000_hosp_booking_groups hospitality.bookings "$(S hospitality.bookings '{"group_id":"gen_random_uuid()"}')"
check_guard 20261107100000_lic_digital_licenses public.license_files "$(S public.license_files)"
check_guard 20261107100000_lic_digital_licenses public.license_deliveries "$(S public.license_deliveries)"
check_guard 20261107100000_lic_digital_licenses public.license_download_links "$(S public.license_download_links)"
check_guard 20261107100000_lic_digital_licenses public.license_audit "$(S public.license_audit)"
check_guard 20261108120000_hosp_shabbat hospitality.settings "$(S hospitality.settings '{"shabbat_observant":"true"}')"
check_guard 20261110210000_hosp_consent hospitality.consent_records "$(S hospitality.consent_records)"
check_guard 20261105180000_hosp_unit_size hospitality.units "$(S hospitality.units '{"size_sqm":"30"}')"
check_guard 20261105200000_hosp_open_dates hospitality.units "$(S hospitality.units '{"open_until":"current_date"}')"
check_guard 20261019560000_home_design public.home_banner_slides "$(S public.home_banner_slides '{"desktop_poster_url":"'"'"'https://example.test/p.jpg'"'"'"}')"
check_guard 20261019560000_home_design public.site_settings "UPDATE public.site_settings SET banner_interval_seconds = 9 WHERE tenant_id = (SELECT id FROM public.tenants WHERE is_default);"
check_guard 20261106150000_sec_h5_double_opt_in public.marketing_consents "$(S public.marketing_consents '{"confirmed_at":"now()"}')"
check_guard 20261106150000_sec_h5_double_opt_in public.marketing_consent_events "$(S public.marketing_consent_events '{"kind":"'"'"'confirm'"'"'"}')"
check_guard 20261106170000_sec_m5_keep_platform_records public.billing_history "$(S public.billing_history)"
check_guard 20261106170000_sec_m5_keep_platform_records public.platform_audit_log "$(S public.platform_audit_log '{"tenant_id":"gen_random_uuid()"}')"
check_guard 20261117090000_bp_site_address business_profile.domain_settings "$(S business_profile.domain_settings)"
check_guard 20261127100000_product_brand_condition public.global_products "$(S public.global_products '{"brand":"'"'"'Lenovo'"'"'","created_by":"gen_random_uuid()"}')"
check_guard 20261127100000_product_brand_condition public.store_seo_proposals "$(S public.store_seo_proposals '{"field":"'"'"'item_condition'"'"'","target_kind":"'"'"'product'"'"'"}')"
M92=20261128100000_online_payments_foundation
check_guard $M92 payments.tenant_attempts "$(S payments.tenant_attempts)"
check_guard $M92 payments.platform_attempts "$(S payments.platform_attempts)"
check_guard $M92 payments.tenant_accounts "$(S payments.tenant_accounts)"
check_guard $M92 payments.platform_accounts "$(S payments.platform_accounts)"
check_guard $M92 payments.terminal_registry "$(S payments.terminal_registry)"
check_guard $M92 payments.tenant_config_audit "$(S payments.tenant_config_audit)"
check_guard $M92 payments.platform_config_audit "$(S payments.platform_config_audit '{"action":"'"'"'credentials_replaced'"'"'"}')"
check_guard $M92 payments.unknown_returns "$(S payments.unknown_returns)"
check_guard $M92 payments.environment "UPDATE payments.environment SET name = 'demo', demo_since = now();"
# review L5: a database that was ever marked keeps its history — DEMO switched off again (demo_since stays), or only
# the system's environment_changed audit row
check_guard $M92 payments.environment "UPDATE payments.environment SET name = NULL, demo_since = now() - interval '1 day';"
check_guard $M92 payments.platform_config_audit "$(S payments.platform_config_audit '{"action":"'"'"'environment_changed'"'"'"}')"
# pilot (contract §7.2 P-1, P-2, P-4): a database that was ever a pilot (pilot_since stays when switched off), a pilot
# store, a pilot tester
check_guard $M92 payments.environment "UPDATE payments.environment SET name = NULL, pilot_since = now() - interval '1 day';"
check_guard $M92 payments.pilot_stores "$(S payments.pilot_stores)"
check_guard $M92 payments.pilot_testers "$(S payments.pilot_testers)"
check_guard $M92 public.orders "$(S public.orders '{"payment_method":"'"'"'online'"'"'"}')"
check_guard $M92 billing.ledger "$(S billing.ledger '{"source":"'"'"'provider'"'"'"}')"

"${PG[@]}" -d postgres -c "DROP DATABASE IF EXISTS $WORK" -c "DROP DATABASE IF EXISTS $TMPL" >/dev/null 2>&1
echo
echo "rollback data guards: $PASSED ok, $FAILED failed"
[ "$FAILED" -eq 0 ]

#!/usr/bin/env bash
# ============================================================
# בדיקת "אין דריסה של נתונים קיימים" — מקומית, על מסד scratch בלבד (לא נוגע בשרת, לא בייצור).
#
# מה היא מוכיחה: אחרי שמחילים את שתי המיגרציות החדשות (200 order_guard, 201 hosp_seo_proposals) על מסד שנמצא
# במצב הייצור (199 מיגרציות) ויש בו נתונים — חתימת בעל העסק, תנאי העסק, מסמך מדיניות חתום, מסמכי האתר ורשומות
# הסכמה — כל השורות האלה זהות בייט-לבייט; וגם אחרי ה-rollback של שתיהן. בנוסף: הגדרת כל טבלה / עמודה קיימת וגוף
# כל פונקציה קיימת בסכמות hospitality / business_profile / billing — לא השתנו; ובסכמת public השתנו רק הפונקציות
# שהמיגרציה 200 מגדירה מחדש במפורש.
#
# שימוש:   bash scripts/audit/data-survival-check.sh [<שורש עץ שיש בו את שתי המיגרציות>]
# דרישות:  אשכול Postgres 16 מקומי (כמו scripts/db-tests/run.sh) ומסד ייחוס `fp_ref` עם מיגרציות עד 199.
#          אפשר לבנות אותו: python3 scripts/audit/gen-migration-fingerprint.py fp_ref (או ידנית, 199 המיגרציות הראשונות).
# ============================================================
set -euo pipefail
ROOT=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
SOCK=${PGSOCK:-/tmp/pg}; PORT=${PGPORT:-5499}; REF=${REF_DB:-fp_ref}; DB=ds_signature_check
M200="$ROOT/supabase/migrations/20261118110000_order_guard.sql"
M201="$ROOT/supabase/migrations/20261118200000_hosp_seo_proposals.sql"
D200="$ROOT/supabase/rollbacks/20261118110000_order_guard.down.sql"
D201="$ROOT/supabase/rollbacks/20261118200000_hosp_seo_proposals.down.sql"
for f in "$M200" "$M201" "$D200" "$D201"; do [ -f "$f" ] || { echo "missing: $f"; exit 2; }; done
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres)
q() { "${PSQL[@]}" -d "$DB" -tA -c "$1"; }

[ "$("${PSQL[@]}" -d "$REF" -tA -c "SELECT count(*) FROM public._migrations_applied")" = "199" ] || { echo "reference DB is not at 199 migrations"; exit 2; }
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB TEMPLATE $REF"

# ---------- נתוני "ייצור" לדוגמה (דמה בלבד; אין שום נתון אמיתי) ----------
"${PSQL[@]}" -d "$DB" <<'SQL' >/dev/null
SET session_replication_role = replica;  -- כמו בבדיקות ה-rollback הקיימות: מחדירים שורות ישירות
INSERT INTO public.tenants (id, slug, name, owner_email, site_type)
VALUES ('70000000-0000-0000-0000-0000000000d1', 'nofi-test', 'נופי בדיקה', 'owner@test.local', 'hospitality')
ON CONFLICT (id) DO NOTHING;
INSERT INTO hospitality.business_terms
  (tenant_id, representative_name, business_tax_id, facilities, representative_signature, unit_lines,
   max_lodging_guests, max_event_guests, deposit_amount, free_cancellation_days, confirmed_at, confirmed_by, revision)
VALUES ('70000000-0000-0000-0000-0000000000d1', 'נציג בדיקה', '123456789', 'מתקנים כפי שהוגדרו בעסק',
        '["M 10,10 L 60,40 L 90,12", "M 20,50 L 80,52"]'::jsonb, '[{"unit":"A","beds":6}]'::jsonb,
        14, 40, 2500, 21, now() - interval '9 days', 'a0000000-0000-0000-0000-0000000000a1', 4);
INSERT INTO hospitality.client_contracts
  (tenant_id, number, kind, template_version, origin, fill_mode, signer_name, signer_email, data, customer_fields, status,
   signed_at, signed_body, signed_body_sha256, signature, signer_ip, pdf_path, pdf_sha256, pdf_size)
VALUES ('70000000-0000-0000-0000-0000000000d1', 1002, 'policy', 1, 'standalone', 'customer', 'חותם בדיקה', 'signer@test.local',
        '{"note":"מסמך מדיניות חתום"}'::jsonb, '{"id_number":"123456789"}'::jsonb, 'signed', now() - interval '3 days',
        'גוף המסמך החתום', repeat('a', 64), '{"paths":["M 1,1 L 30,30"]}'::jsonb, '203.0.113.7',
        '70000000-0000-0000-0000-0000000000d1/84ac87c3-f912-4b5b-bb1e-5945918f0ccb.pdf', repeat('b', 64), 12345);
INSERT INTO hospitality.site_documents (tenant_id, kind, draft_title, draft_body, published_version, revision)
VALUES ('70000000-0000-0000-0000-0000000000d1', 'site_terms', 'תנאי האתר', 'טקסט תנאי האתר כפי שפורסם', 2, 5);
INSERT INTO public.site_settings (tenant_id) VALUES ('70000000-0000-0000-0000-0000000000d1') ON CONFLICT DO NOTHING;
SQL

# טבלאות שנבדקות (נתוני לקוח): כל שורה, כל עמודה, בסדר קבוע
TABLES="hospitality.business_terms hospitality.client_contracts hospitality.client_contract_log hospitality.contract_templates
hospitality.site_documents hospitality.site_document_versions hospitality.consent_records hospitality.booking_document_acceptances
public.site_settings public.tenants public.orders public.coupons"
data_fp() { for t in $TABLES; do echo "$t $(q "SELECT count(*) || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), 'empty') FROM $t x")"; done; }
# הגדרות: עמודות כל טבלה קיימת (סכמות המוצר) + גוף כל פונקציה קיימת
cols_fp() { q "SELECT table_schema||'.'||table_name, md5(string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' ORDER BY ordinal_position))
               FROM information_schema.columns WHERE table_schema IN ('public','hospitality','business_profile','billing') GROUP BY 1 ORDER BY 1"; }
fn_fp() { q "SELECT n.nspname||'.'||p.oid::regprocedure::text, md5(p.prosrc||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||coalesce(p.proconfig::text,''))
               FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','hospitality','business_profile','billing') ORDER BY 1"; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
data_fp > "$TMP/data.0"; cols_fp > "$TMP/cols.0"; fn_fp > "$TMP/fn.0"
echo "== before: $(wc -l < "$TMP/data.0") data fingerprints, $(wc -l < "$TMP/cols.0") tables, $(wc -l < "$TMP/fn.0") functions (production state, 199 migrations)"
echo "   signature row: $(q "SELECT jsonb_array_length(representative_signature) || ' paths, revision ' || revision FROM hospitality.business_terms WHERE tenant_id='70000000-0000-0000-0000-0000000000d1'")"

"${PSQL[@]}" -d "$DB" -f "$M200" >/dev/null || { echo "FAIL: applied 200 order_guard did not run cleanly"; exit 1; }; echo "== applied 200 order_guard"
"${PSQL[@]}" -d "$DB" -f "$M201" >/dev/null || { echo "FAIL: applied 201 hosp_seo_proposals did not run cleanly"; exit 1; }; echo "== applied 201 hosp_seo_proposals"
data_fp > "$TMP/data.1"; cols_fp > "$TMP/cols.1"; fn_fp > "$TMP/fn.1"

FAIL=0
if diff -q "$TMP/data.0" "$TMP/data.1" >/dev/null; then echo "OK  data identical after 200+201 (signature, terms, signed policy, site documents, consent, settings, orders, coupons, tenants)"; else echo "FAIL data changed:"; diff "$TMP/data.0" "$TMP/data.1" | cut -c1-150 || true; FAIL=1; fi
echo "   still there: signature $(q "SELECT jsonb_array_length(representative_signature) FROM hospitality.business_terms WHERE tenant_id='70000000-0000-0000-0000-0000000000d1'") paths · terms revision $(q "SELECT revision FROM hospitality.business_terms WHERE tenant_id='70000000-0000-0000-0000-0000000000d1'") · signed policy #$(q "SELECT number FROM hospitality.client_contracts WHERE status='signed' AND tenant_id='70000000-0000-0000-0000-0000000000d1'") · site terms v$(q "SELECT published_version FROM hospitality.site_documents WHERE tenant_id='70000000-0000-0000-0000-0000000000d1' AND kind='site_terms'")"
# השוואה: שורות (שם|טביעת-אצבע) ששונו = שם שמופיע גם בין השורות שנעלמו וגם בין החדשות; שם שנעלם = הוסר
changed_names() { # changed_names <before> <after>  → שמות שהטביעה שלהם השתנתה
  comm -23 <(LC_ALL=C sort "$1") <(LC_ALL=C sort "$2") | cut -d'|' -f1 | LC_ALL=C sort -u > "$TMP/gone.txt"
  comm -13 <(LC_ALL=C sort "$1") <(LC_ALL=C sort "$2") | cut -d'|' -f1 | LC_ALL=C sort -u > "$TMP/new.txt"
  LC_ALL=C comm -12 "$TMP/gone.txt" "$TMP/new.txt"
}
removed_names() { LC_ALL=C comm -23 "$TMP/gone.txt" "$TMP/new.txt"; }
added_names() { LC_ALL=C comm -13 "$TMP/gone.txt" "$TMP/new.txt"; }
# טבלאות קיימות: אסור שהעמודות שלהן ישתנו (טבלאות חדשות מותרות)
CHANGED_COLS="$(changed_names "$TMP/cols.0" "$TMP/cols.1")$(removed_names)"
if [ -z "$CHANGED_COLS" ]; then echo "OK  no existing table/column definition changed (new tables only: $(added_names | tr '\n' ' '))"; else echo "FAIL changed/removed table definitions: $CHANGED_COLS"; FAIL=1; fi
# פונקציות קיימות: מותר רק מה שהמיגרציה 200 מגדירה מחדש
CHANGED_FN="$(changed_names "$TMP/fn.0" "$TMP/fn.1")"; REMOVED_FN="$(removed_names)"
echo "   pre-existing functions whose body changed: $(echo "$CHANGED_FN" | grep -c . || true) → $(echo $CHANGED_FN)"
UNEXPECTED=$(printf '%s\n%s\n' "$CHANGED_FN" "$REMOVED_FN" | grep -vE '^public\.(check_coupon|orders_apply_coupon)\(' | grep . || true)
if [ -z "$UNEXPECTED" ]; then echo "OK  only check_coupon / orders_apply_coupon (migration 200) were redefined; no function was removed; none in hospitality / business_profile / billing changed"; else echo "FAIL unexpected function changes: $UNEXPECTED"; FAIL=1; fi

"${PSQL[@]}" -d "$DB" -f "$D201" >/dev/null || { echo "FAIL: rolled back 201 did not run cleanly"; exit 1; }; echo "== rolled back 201"
"${PSQL[@]}" -d "$DB" -f "$D200" >/dev/null || { echo "FAIL: rolled back 200 did not run cleanly"; exit 1; }; echo "== rolled back 200"
data_fp > "$TMP/data.2"; cols_fp > "$TMP/cols.2"; fn_fp > "$TMP/fn.2"
diff -q "$TMP/data.0" "$TMP/data.2" >/dev/null && echo "OK  data identical after the rollbacks" || { echo "FAIL data changed after rollback"; diff "$TMP/data.0" "$TMP/data.2" | cut -c1-150 || true; FAIL=1; }
diff -q "$TMP/cols.0" "$TMP/cols.2" >/dev/null && echo "OK  table definitions identical to production state after the rollbacks" || { echo "FAIL table definitions differ after rollback"; FAIL=1; }
diff -q "$TMP/fn.0" "$TMP/fn.2" >/dev/null && echo "OK  function bodies identical to production state after the rollbacks" || { echo "FAIL function bodies differ after rollback"; diff "$TMP/fn.0" "$TMP/fn.2" | head -4 | cut -c1-150 || true; FAIL=1; }

"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB"
[ "$FAIL" = 0 ] && echo "PASS: no existing data or definition was overwritten" || { echo "FAILED"; exit 1; }

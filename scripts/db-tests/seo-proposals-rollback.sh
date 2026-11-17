#!/usr/bin/env bash
# ============================================================
# Rollback של הצעות ה-SEO (20261118200000_hosp_seo_proposals) — מקומית / ב-CI בלבד, על מסד נפרד (seo_rb).
# בסקריפט נפרד (ולא בתוך rollback-check.sh) כדי לא להתנגש בעבודה מקבילה על אותו קובץ. רץ אחרי run.sh
# (אותו שרת Postgres: /tmp/pg, פורט 5499).
#   1. כל המיגרציות פעמיים ברצף — ההחלה השנייה של המיגרציה לא משנה כלום (הסכמה זהה)
#   2. עם הצעה שמורה — ה-rollback נעצר ושום דבר לא משתנה
#   3. בלי הצעות — rollback → הסכמה זהה בדיוק לזו שלפני המיגרציה; ומה שאושר נשאר בשדות עצמם
#   4. החלה מחדש → הסכמה זהה בדיוק לזו שאחרי ההחלה הראשונה
# ============================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PORT=${PGPORT:-5499}
M=20261118200000_hosp_seo_proposals
MIGRATIONS="$ROOT/supabase/migrations"
DB=seo_rb
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h /tmp/pg -p "$PORT" -U postgres -d "$DB")
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

q() { "${PSQL[@]}" -tAc "$1"; }
expect() { if [ "$(q "$2")" = "t" ]; then echo "  ok   $1"; else echo "  FAIL $1"; exit 1; fi; }
dump() { pg_dump -h /tmp/pg -p "$PORT" -U postgres -d "$DB" --schema-only --no-comments | grep -Ev "^\\\\(un)?restrict " > "$1"; }
same() { if diff -q "$1" "$2" >/dev/null; then echo "  ok   $3"; else echo "  FAIL $3"; diff "$1" "$2" | head -30; exit 1; fi; }

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
echo "seo proposals rollback ($M)"
same "$DIR/after.sql" "$DIR/again.sql" "applying the migration twice changes nothing"
expect "the tables and the functions exist" \
  "SELECT to_regclass('hospitality.seo_proposals') IS NOT NULL AND to_regclass('hospitality.seo_runs') IS NOT NULL
      AND to_regprocedure('hospitality.seo_proposal_decide(uuid,text,text)') IS NOT NULL"

# a hospitality site with one saved proposal (as the app server would write it)
q "INSERT INTO public.tenants (id, slug, name, site_type) VALUES ('5e000000-0000-4000-8000-0000000000a1', 'seo-rb', 'SEO RB', 'hospitality')" >/dev/null
q "INSERT INTO hospitality.seo_runs (id, tenant_id, kind, scope, status) VALUES
     ('5e000000-0000-4000-8000-0000000000b1', '5e000000-0000-4000-8000-0000000000a1', 'template', 'initial', 'done')" >/dev/null
q "INSERT INTO hospitality.seo_proposals (tenant_id, run_id, target_kind, field, proposed, source)
   VALUES ('5e000000-0000-4000-8000-0000000000a1', '5e000000-0000-4000-8000-0000000000b1', 'site', 'seo_title', 'כותרת', 'template')" >/dev/null
if "${PSQL[@]}" -f "$ROOT/supabase/rollbacks/$M.down.sql" >"$DIR/guard.log" 2>&1; then
  echo "  FAIL the rollback ran although a proposal is saved"; exit 1
fi
grep -q "rollback stopped: 1 SEO proposals are saved" "$DIR/guard.log" \
  && echo "  ok   with a saved proposal the rollback stops with the reason" \
  || { echo "  FAIL unexpected guard output:"; cat "$DIR/guard.log"; exit 1; }
dump "$DIR/guarded.sql"
same "$DIR/after.sql" "$DIR/guarded.sql" "after the stopped rollback the schema is unchanged"
expect "after the stopped rollback the proposal is still there" "SELECT count(*) = 1 FROM hospitality.seo_proposals"

q "DELETE FROM hospitality.seo_runs" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/rollbacks/$M.down.sql" >/dev/null
dump "$DIR/down.sql"
same "$DIR/before.sql" "$DIR/down.sql" "schema after the rollback = the schema before the migration, exactly"
expect "both tables and every new function are gone" \
  "SELECT to_regclass('hospitality.seo_proposals') IS NULL AND to_regclass('hospitality.seo_runs') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace
                        AND (proname LIKE 'seo\\_%' OR proname LIKE '\\_seo\\_%'))"

"${PSQL[@]}" -f "$MIGRATIONS/$M.sql" >/dev/null
dump "$DIR/reapplied.sql"
same "$DIR/after.sql" "$DIR/reapplied.sql" "re-applying after the rollback gives the same schema as the first apply"
psql -X -q -h /tmp/pg -p "$PORT" -U postgres -d postgres -c "DROP DATABASE $DB" >/dev/null 2>&1 || true
echo "seo proposals rollback check passed"

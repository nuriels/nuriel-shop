#!/usr/bin/env bash
# ============================================================
# בדיקות מסד מקומיות (לא נוגע בשרת):
#   Postgres 16 + stubs של Supabase → כל המיגרציות מאפס → שוב כולן (אידמפוטנטיות)
#   → קבצי הבדיקה. ובנוסף: מסד "עם נתונים" — כל המיגרציות חוץ מהאחרונה, נתונים,
#   ואז האחרונה — והבדיקות שוב.
# שימוש:  bash scripts/db-tests/run.sh            (דורש postgresql-16)
# ============================================================
set -euo pipefail
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PORT=${PGPORT:-5499}
SOCK=/tmp/pg
DATA=${KOBI_PGDATA:-/tmp/kobi-pgdata}
HERE=$(cd "$(dirname "$0")" && pwd)
MIGRATIONS=$(cd "$HERE/../../supabase/migrations" && pwd)
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

mkdir -p "$SOCK" && chmod 777 "$SOCK"
if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA" && chown -R postgres "$DATA" 2>/dev/null || true
  as_pg "$PGBIN/initdb" -D "$DATA" -A trust -U postgres >/dev/null
fi
if ! as_pg "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK" -l "$DATA/server.log" -w start >/dev/null
fi
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -U postgres)

fresh_db() {
  "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS shop_test" -c "CREATE DATABASE shop_test ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0" >/dev/null
  "${PSQL[@]}" -d shop_test -f "$HERE/supabase-stubs.sql" >/dev/null
}
apply() { # apply <file...>
  for f in "$@"; do
    if ! "${PSQL[@]}" -d shop_test -f "$f" >/tmp/shop-migration.log 2>&1; then
      echo "FAILED: $(basename "$f")"; tail -5 /tmp/shop-migration.log; exit 1
    fi
  done
}
run_tests() { # run_tests <label>
  "${PSQL[@]}" -d shop_test -f "$HERE/fixtures.sql" >/dev/null
  "${PSQL[@]}" -d shop_test -f "$HERE/test-helpers.sql" >/dev/null
  for t in "$HERE"/*.test.sql; do "${PSQL[@]}" -d shop_test -f "$t" >/dev/null; done
  local failed total
  total=$("${PSQL[@]}" -d shop_test -tAc "select count(*) from tests.results")
  failed=$("${PSQL[@]}" -d shop_test -tAc "select count(*) from tests.results where not ok")
  echo "[$1] $((total - failed))/$total passed"
  if [ "$failed" != "0" ]; then
    "${PSQL[@]}" -d shop_test -c "select name, detail from tests.results where not ok order by id"
    exit 1
  fi
}

mapfile -t ALL < <(ls "$MIGRATIONS"/*.sql | sort)
# המיגרציות החדשות (ברירת מחדל: האחרונה) — אותן מריצים פעמיים. המיגרציות הישנות
# של Lovable לא נכתבו אידמפוטנטיות, והשרת מריץ כל מיגרציה פעם אחת (_migrations_applied)
NEW=${NEW_MIGRATIONS:-1}
OLD=("${ALL[@]:0:${#ALL[@]}-NEW}")
NEWEST=("${ALL[@]: -NEW}")

# 1+2) מסד נקי — פעמיים, כל פעם מאפס: הכל, ואז החדשות שוב (אידמפוטנטיות) → בדיקות
for round in 1 2; do
  fresh_db; apply "${ALL[@]}"; apply "${NEWEST[@]}"
  echo "clean db #$round: ${#ALL[@]} migrations, newest $NEW re-applied"
  run_tests "clean #$round"
done

# 3) מסד עם נתונים: הישנות → נתונים → החדשות (פעמיים) → בדיקות
fresh_db; apply "${OLD[@]}"
apply "$HERE/fixtures.sql"
apply "${NEWEST[@]}"; apply "${NEWEST[@]}"
echo "data db: newest $NEW applied over existing data (twice)"
run_tests "with data"

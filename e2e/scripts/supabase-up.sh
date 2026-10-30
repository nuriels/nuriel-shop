#!/usr/bin/env bash
# ============================================================
# Supabase מקומי וחד-פעמי לבדיקות E2E (Docker). לא מתחבר לשום שרת אמיתי.
#   • תיקיית עבודה זמנית: e2e/.supabase (ב-.gitignore) — config.toml של
#     הפרויקט לא נוגעים בו.
#   • כל המיגרציות מ-supabase/migrations רצות מאפס, ואז נתוני הבדיקה
#     (e2e/scripts/seed.sql + משתמשים עם סיסמה דרך ה-Auth API המקומי).
#   • מפתחות: מפתחות ההדגמה הקבועים של Supabase CLI — לא סודות.
# שימוש:  bash e2e/scripts/supabase-up.sh      (עצירה: supabase-down.sh)
# ============================================================
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK="$ROOT/e2e/.supabase"
SUPABASE=(npx -y supabase@2.122.0 --workdir "$WORK")

rm -rf "$WORK/supabase/migrations"
mkdir -p "$WORK/supabase"
[ -f "$WORK/supabase/config.toml" ] || "${SUPABASE[@]}" init --force >/dev/null
sed -i 's/^project_id = .*/project_id = "nuriel-e2e"/' "$WORK/supabase/config.toml"
cp -r "$ROOT/supabase/migrations" "$WORK/supabase/migrations"

"${SUPABASE[@]}" stop --no-backup >/dev/null 2>&1 || true
"${SUPABASE[@]}" start \
  -x studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit

eval "$("${SUPABASE[@]}" status -o env | sed 's/^/export SB_/')"
node "$HERE/seed.mjs" "$SB_API_URL" "$SB_SERVICE_ROLE_KEY" "$SB_DB_URL"

cat > "$ROOT/e2e/.env.e2e" <<ENV
SUPABASE_URL=$SB_API_URL
SUPABASE_PUBLISHABLE_KEY=$SB_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE_ROLE_KEY
VITE_SUPABASE_URL=$SB_API_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$SB_ANON_KEY
DB_URL=$SB_DB_URL
ENV
echo "e2e supabase ready → e2e/.env.e2e"

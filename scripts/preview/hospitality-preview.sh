#!/usr/bin/env bash
# ============================================================
# תצוגה מקומית של Hospitality (P0) — פקודה אחת:
#   1. Supabase מקומי וחד-פעמי (Docker) עם כל המיגרציות + נתוני הבדיקה
#   2. נתוני הדגמה: מתחם צימרים, וילה ומלון בוטיק (scripts/preview/hospitality-demo.mjs)
#   3. האפליקציה על http://*.shop.localhost:3100 (מתג המנוע פתוח — מקומית בלבד)
# לא מתחבר לשום שרת אמיתי; מיילים ותשלומים מדומים. עצירה: Ctrl+C, ואז bun run e2e:down.
#
# שימוש:  bun run hosp:preview            (מסד חדש + נתוני הדגמה + בנייה + הפעלה)
#         bun run hosp:preview --keep     (בלי לאפס את המסד — רק נתוני ההדגמה מחדש)
# ============================================================
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

if [ "${1:-}" != "--keep" ]; then
  echo "▶ Supabase מקומי (מסד חדש)…"
  bash e2e/scripts/supabase-up.sh
fi
echo "▶ נתוני הדגמה…"
node scripts/preview/hospitality-demo.mjs
echo
echo "▶ האפליקציה (בנייה והפעלה על פורט 3100; Ctrl+C לעצירה)…"
exec bash e2e/scripts/app-up.sh

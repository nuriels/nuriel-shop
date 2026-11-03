#!/usr/bin/env bash
# ============================================================
# SEC-M4 — בדיקה לקריאה בלבד בשרת (לא משנה כלום, לא מדפיס אף ערך סודי):
#   1. אילו סודות של סטאק Supabase עדיין בערך ברירת-המחדל הציבורי — זהים ל-.env.example שליד
#      ה-.env (אותו קובץ שממנו נוצר). כך הבדיקה לא תלויה ברשימה קשיחה של ערכים.
#   2. אילו קונטיינרים של Supabase רצים (analytics / vector — אם רצים, גם הם צריכים מפתחות חדשים).
#   3. מה מאזין על כל הממשקים (0.0.0.0 / [::]) — פורט של Supabase (למשל 4000 של Logflare) לא
#      אמור להופיע שם.
# שימוש:  bash deploy/check-default-secrets.sh [תיקיית docker של Supabase]
#         ברירת מחדל: /root/${PROJECT:-nuriel-shop}-supabase/docker
# יציאה 0 = אין סודות בברירת מחדל; 1 = יש; 2 = הקבצים לא נמצאו.
# ============================================================
set -uo pipefail
DIR="${1:-/root/${PROJECT:-nuriel-shop}-supabase/docker}"
ENV_FILE="$DIR/.env"
EXAMPLE="$DIR/.env.example"
[ -f "$ENV_FILE" ] || { echo "לא נמצא $ENV_FILE"; exit 2; }
[ -f "$EXAMPLE" ] || { echo "לא נמצא $EXAMPLE"; exit 2; }

value_of() { grep -m1 "^$1=" "$2" 2>/dev/null | cut -d= -f2- ; }
is_secret_key() { [[ "$1" =~ (SECRET|PASSWORD|TOKEN|CRYPTO|_KEY$|^JWT|ANON_KEY|SERVICE_ROLE) ]]; }

defaults=0
checked=0
while IFS= read -r line; do
  key="${line%%=*}"
  is_secret_key "$key" || continue
  example="$(value_of "$key" "$EXAMPLE")"
  [ -n "$example" ] || continue
  current="$(value_of "$key" "$ENV_FILE")"
  checked=$((checked + 1))
  if [ -z "$current" ] || [ "$current" = "$example" ]; then
    echo "DEFAULT  $key  — עדיין בערך הציבורי של .env.example: יש להחליף ולהפעיל מחדש"
    defaults=$((defaults + 1))
  else
    echo "ok       $key"
  fi
done < <(grep -E '^[A-Z0-9_]+=' "$EXAMPLE")

echo
echo "קונטיינרים של Supabase שרצים:"
if command -v docker >/dev/null 2>&1; then
  running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i supabase || true)"
  echo "${running:-  (אין / אין הרשאה ל-docker)}" | sed 's/^/  /'
  for svc in analytics vector; do
    if echo "$running" | grep -qi "$svc"; then
      echo "  ⚠ $svc רץ — ודאו שהמפתחות שלו הוחלפו ושהפורט שלו לא חשוף לרשת"
    fi
  done
else
  echo "  (docker לא זמין)"
fi

echo
echo "מאזינים על כל הממשקים (בדקו שאין כאן פורט של Supabase, למשל 4000 / 5432 / 8000):"
if command -v ss >/dev/null 2>&1; then
  ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' | sort -u | sed 's/^/  /' || true
else
  echo "  (ss לא זמין)"
fi

echo
echo "סיכום: נבדקו $checked סודות — $defaults בערך ברירת המחדל"
[ "$defaults" -eq 0 ] && exit 0 || exit 1

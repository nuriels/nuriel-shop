#!/usr/bin/env bash
# ============================================================
# הקמת Supabase self-hosted עצמאי + קבצי הסביבה של האפליקציה (nuriel-shop)
#
# אותה שיטה כמו שאר הפרויקטים בשרת: סטאק Supabase נפרד לכל פרויקט, Kong
# ואפליקציה קשורים ל-127.0.0.1 בלבד, ו-Nginx + certbot מחזיקים את 80/443.
# סטאק מבודד לגמרי מהסטאקים הקיימים (nuri / moments / inv / kobi / kaia):
# שמות קונטיינרים, פורטים, רשתות ותיקיות — הכל נפרד.
#
# שימוש (מתוך תיקיית הריפו, למשל /root/nuriel-shop-git):
#   הרצה ראשונה (יוצרת סודות + משתמש אדמין; סיסמת האדמין תתבקש בהקלדה נסתרת):
#     bash deploy/setup-selfhost.sh
#   הרצה חוזרת (למשל אחרי git pull עם מיגרציה חדשה) — מריצה רק מה שעוד לא הוחל:
#     bash deploy/setup-selfhost.sh
#   רק כתיבת קבצי env מחדש (בלי לגעת ב-DB):
#     bash deploy/setup-selfhost.sh --env-only
#
# כל ההגדרות ניתנות לשינוי במשתני סביבה (ברירות המחדל — של nuriel-shop):
#   PROJECT, SB_DIR, API_URL, SITE_URL, TENANT_BASE_DOMAIN, APP_PORT,
#   KONG_HTTP_PORT, KONG_HTTPS_PORT, ADMIN_EMAIL, DEFAULT_TENANT_SLUG,
#   DEFAULT_TENANT_NAME, RESEND_API_KEY, GOOGLE_CLIENT_ID + GOOGLE_SECRET
#
# מה הסקריפט עושה:
#   1. מושך את קבצי ה-Docker הרשמיים של Supabase (גרסת Kong נעוצה, כמו בסטאקים הקיימים)
#   2. מייצר סודות ומפתחות JWT מקומיים (פעם אחת — הרצה חוזרת לא דורסת)
#   3. משנה שמות קונטיינרים (${PROJECT}-*) ופורטים כדי לא להתנגש בסטאקים הקיימים
#   4. מרים 7 קונטיינרים בלבד (בלי realtime/supavisor/functions שאינם נחוצים)
#   5. מריץ את כל מיגרציות האפליקציה, יוצר buckets ציבוריים, חנות ברירת מחדל ומשתמש אדמין
#   6. כותב את .env ואת docker-compose.override.yml של האפליקציה (לא ב-git)
# ============================================================
set -Eeuo pipefail
# בלי זה, set -e + pipefail מפילים את הסקריפט בשקט (למשל grep שלא מצא שורה)
trap 'echo -e "\033[1;31m✗ הסקריפט נעצר בשורה ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

PROJECT="${PROJECT:-nuriel-shop}"
SB_DIR="${SB_DIR:-/root/${PROJECT}-supabase}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# גרסת ה-Kong המוכחת — אותו דור כמו הסטאקים הקיימים בשרת
SB_COMMIT="712387bbac26f521783658aada8d9b26d27c56b3"
API_URL="${API_URL:-https://api-nuriel.nuri1.fit}"
SITE_URL="${SITE_URL:-https://nuriel-shop.nuri1.fit}"
# חנויות בתת-דומיין: <slug>.${TENANT_BASE_DOMAIN}
TENANT_BASE_DOMAIN="${TENANT_BASE_DOMAIN:-nuri1.fit}"
APP_PORT="${APP_PORT:-3700}"
KONG_HTTP_PORT="${KONG_HTTP_PORT:-8500}"
KONG_HTTPS_PORT="${KONG_HTTPS_PORT:-8545}"
# supavisor לא מורם, אבל compose מאמת את כל הקובץ — פורטים ייחודיים בכל זאת
POOLER_PORT="${POOLER_PORT:-5437}"
POOLER_TX_PORT="${POOLER_TX_PORT:-6547}"
SERVICES="db meta studio kong auth rest storage"
ADMIN_EMAIL="${ADMIN_EMAIL:-nuriel.sh1@gmail.com}"
DEFAULT_TENANT_SLUG="${DEFAULT_TENANT_SLUG:-nuriel-shop}"
DEFAULT_TENANT_NAME="${DEFAULT_TENANT_NAME:-Nuriel Shop}"
# כתובות שמותר לחזור אליהן אחרי התחברות (Google / קישורי מייל) — האתר הראשי וכל החנויות
REDIRECT_URLS="${REDIRECT_URLS:-${SITE_URL}/**,https://*.${TENANT_BASE_DOMAIN}/**}"

DB="${PROJECT}-db"
KONG="${PROJECT}-kong"
AUTH="${PROJECT}-auth"

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
fail() { echo -e "\033[1;31m✗ $*\033[0m" >&2; exit 1; }
psql_db() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

# --- set_env: עדכון מפתח ב-.env עם אימות שההחלפה באמת קרתה ---
set_env() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
  grep -qxF "${key}=${value}" "$file" || fail "set_env נכשל עבור ${key} ב-${file}"
}

# --- כתיבת קבצי הסביבה של האפליקציה (נקרא גם ב---env-only) ---
write_app_env() {
  local anon="$1" service="$2"
  # מפתח JWT תקין = ASCII בלבד (base64url + נקודות). תו אחר — למשל "•" ממסך
  # שמסתיר סודות, או סימן כיווניות RTL מהעתקה — נאפה לבאנדל הדפדפן ומפיל
  # כל התחברות ("Failed to construct 'Headers'"). עוצרים כאן במקום לכתוב קובץ שבור.
  local k
  for k in "$anon" "$service"; do
    printf '%s' "$k" | LC_ALL=C grep -qE '^[A-Za-z0-9._-]{100,}$' || fail "מפתח ANON_KEY/SERVICE_ROLE_KEY ב-$SB_DIR/docker/.env פגום (תווים לא חוקיים או קצר מדי) — לתקן שם לפני שממשיכים"
  done
  # מגיע ממשתנה סביבה שהועבר להרצת הסקריפט — לעולם לא מוטבע בקוד/ב-git.
  # אם לא הועבר בהרצה הזו, שומרים על המפתח שכבר קיים בקובץ הקודם במקום
  # לדרוס אותו בריק (אחרת כל הרצה חוזרת בלי המפתח הייתה מפילה מיילים בשקט).
  local resend_key="${RESEND_API_KEY:-}"
  if [[ -z "$resend_key" && -f "$APP_DIR/.env" ]]; then
    resend_key=$(grep '^RESEND_API_KEY=' "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//' || true)
  fi
  log "כותב את קבצי הסביבה של האפליקציה"
  umask 077
  # docker compose קורא את הקובץ הזה אוטומטית (משתני ${...} ב-docker-compose.yml)
  cat > "$APP_DIR/.env" <<EOF
# נכתב ע"י deploy/setup-selfhost.sh — לא ב-git. הרצה חוזרת עם --env-only משחזרת אותו.
# שם נפרד מהסטאק של Supabase (-p ${PROJECT}) — אחרת compose רואה בקונטיינרים של ה-DB "יתומים"
COMPOSE_PROJECT_NAME=${PROJECT}-app
SUPABASE_URL=${API_URL}
SUPABASE_PUBLISHABLE_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}
# מיילים (Resend) — ריק = ההזמנות נקלטות אבל מיילים לא נשלחים
RESEND_API_KEY=${resend_key}
# כתובת חנות ברירת המחדל — לקישורים במיילים
PUBLIC_SITE_URL=${SITE_URL}
# חנויות בתת-דומיין: <slug>.${TENANT_BASE_DOMAIN}
TENANT_BASE_DOMAIN=${TENANT_BASE_DOMAIN}
EOF
  umask 022
  # פורט מקומי בלבד — הגישה מבחוץ רק דרך Nginx (כמו שאר האפליקציות בשרת)
  cat > "$APP_DIR/docker-compose.override.yml" <<EOF
# נכתב ע"י deploy/setup-selfhost.sh — פריסה בשרת עם Nginx (לא ב-git)
services:
  app:
    container_name: ${PROJECT}-app
    ports:
      - "127.0.0.1:${APP_PORT}:3000"
EOF
  if [[ -n "$resend_key" ]]; then
    echo "  ✓ $APP_DIR/.env + docker-compose.override.yml (RESEND_API_KEY מולא)"
  else
    echo "  ✓ $APP_DIR/.env + docker-compose.override.yml (RESEND_API_KEY ריק — מיילים לא יישלחו עד שימולא)"
  fi
}

# ============================================================
# מצב --env-only: שחזור קבצי env אחרי git pull (הם לא ב-git)
# ============================================================
# קריאת מפתח: קודם מ-docker/.env, ואם חסר שם — מקונטיינר ה-Kong שרץ
# (הוא זה שמאמת את המפתח בפועל). בלי "|| true" — pipefail היה מפיל את
# הסקריפט בשקט כשהשורה לא נמצאת, בלי שום הודעה.
read_key() {
  local file_key="$1" kong_key="$2" v=""
  if [[ -f "$SB_DIR/docker/.env" ]]; then
    v=$(grep -E "^${file_key}=" "$SB_DIR/docker/.env" | tail -1 | cut -d= -f2- | tr -d '\r"' || true)
  fi
  if [[ -z "$v" ]]; then
    v=$(docker inspect "$KONG" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
          | grep -E "^${kong_key}=" | cut -d= -f2- | tr -d '\r"' || true)
    [[ -n "$v" ]] && echo -e "\033[1;33m  ⚠ ${file_key} חסר ב-$SB_DIR/docker/.env — נלקח מהקונטיינר $KONG. לבדוק את הקובץ!\033[0m" >&2
  fi
  [[ -n "$v" ]] || fail "${file_key} לא נמצא — לא ב-$SB_DIR/docker/.env ולא בקונטיינר $KONG"
  printf '%s' "$v"
}

if [[ "${1:-}" == "--env-only" ]]; then
  ANON=$(read_key ANON_KEY SUPABASE_ANON_KEY)
  SERVICE=$(read_key SERVICE_ROLE_KEY SUPABASE_SERVICE_KEY)
  write_app_env "$ANON" "$SERVICE"
  # אימות מול Kong המקומי: המפתח שנכתב חייב להתקבל
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${ANON}" "http://127.0.0.1:${KONG_HTTP_PORT}/auth/v1/settings" || echo 000)
  [[ "$code" == "200" ]] && echo "  ✓ Kong מקבל את המפתח (200)" \
    || fail "Kong דחה את המפתח שנכתב (HTTP ${code}) — לא לבנות את האפליקציה עד שזה מתוקן"
  exit 0
fi

command -v node >/dev/null || fail "node לא נמצא (נדרש ליצירת מפתחות)"

# ============================================================
# 0. בדיקות מקדימות: פורטים פנויים ושמות קונטיינרים לא תפוסים
# ============================================================
log "בדיקות מקדימות ($PROJECT)"
if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB"; then
  for p in "$KONG_HTTP_PORT" "$KONG_HTTPS_PORT" "$APP_PORT"; do
    ss -ltn | grep -qE "[:.]${p}\b" && fail "פורט ${p} כבר תפוס בשרת — לבחור אחר (KONG_HTTP_PORT / KONG_HTTPS_PORT / APP_PORT)"
  done
  echo "  ✓ פורטים פנויים: Kong ${KONG_HTTP_PORT}/${KONG_HTTPS_PORT}, אפליקציה ${APP_PORT}"
else
  echo "  ✓ הסטאק $PROJECT כבר קיים — הרצה חוזרת"
fi

# ============================================================
# 1. משיכת קבצי Supabase (רק תיקיית docker, בקומיט נעוץ)
# ============================================================
if [[ ! -f "$SB_DIR/docker/docker-compose.yml" ]]; then
  log "מושך קבצי Supabase (גרסת Kong נעוצה) ל-$SB_DIR"
  rm -rf "$SB_DIR"
  git clone --filter=blob:none --no-checkout https://github.com/supabase/supabase.git "$SB_DIR"
  git -C "$SB_DIR" sparse-checkout set docker
  git -C "$SB_DIR" checkout -q "$SB_COMMIT"
else
  log "קבצי Supabase כבר קיימים ב-$SB_DIR — מדלג על משיכה"
fi
cd "$SB_DIR/docker"

# ============================================================
# 2. סודות: יצירה חד-פעמית (הרצה חוזרת לא דורסת מפתחות קיימים!)
# ============================================================
if [[ ! -f .env ]]; then
  log "מייצר סודות ומפתחות JWT"
  cp .env.example .env
  chmod 600 .env
  eval "$(node "$APP_DIR/deploy/gen-keys.mjs")"
  set_env .env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  set_env .env JWT_SECRET "$JWT_SECRET"
  set_env .env ANON_KEY "$ANON_KEY"
  set_env .env SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
  set_env .env DASHBOARD_USERNAME "nuriels"
  set_env .env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
  set_env .env SECRET_KEY_BASE "$SECRET_KEY_BASE"
  set_env .env VAULT_ENC_KEY "$VAULT_ENC_KEY"
  set_env .env POOLER_TENANT_ID "$PROJECT"
  # פורטים — מקומיים בלבד, לא מתנגשים בסטאקים הקיימים
  set_env .env KONG_HTTP_PORT "127.0.0.1:${KONG_HTTP_PORT}"
  set_env .env KONG_HTTPS_PORT "127.0.0.1:${KONG_HTTPS_PORT}"
  # הלקח מהסטאקים הקודמים: בלי SMTP חובה אישור-עצמי של הרשמות
  set_env .env ENABLE_EMAIL_AUTOCONFIRM "true"
  set_env .env DISABLE_SIGNUP "false"
  set_env .env STUDIO_DEFAULT_ORGANIZATION "nuriel"
  set_env .env STUDIO_DEFAULT_PROJECT "$PROJECT"
else
  log "קובץ .env קיים — משתמש בסודות הקיימים"
fi
# כתובות: מתעדכנות בכל הרצה (אפשר לשנות דומיין ולהריץ שוב)
set_env .env SITE_URL "$SITE_URL"
set_env .env API_EXTERNAL_URL "$API_URL"
set_env .env SUPABASE_PUBLIC_URL "$API_URL"
set_env .env ADDITIONAL_REDIRECT_URLS "$REDIRECT_URLS"
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
SERVICE=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)

# ============================================================
# 3. התאמות compose: שמות קונטיינרים + פורטים של supavisor
#    (כל החלפה מאומתת — החלפה שקטה שנכשלת הפילה אותנו בעבר)
# ============================================================
log "מתאים שמות קונטיינרים ופורטים"
if grep -q "container_name: supabase-" docker-compose.yml; then
  sed -i "s/container_name: realtime-dev\.supabase-realtime/container_name: realtime-dev.${PROJECT}-realtime/" docker-compose.yml
  sed -i "s/container_name: supabase-/container_name: ${PROJECT}-/" docker-compose.yml
fi
grep -q "container_name: supabase-" docker-compose.yml && fail "שינוי שמות קונטיינרים נכשל"
grep -q "container_name: ${DB}$" docker-compose.yml || fail "$DB לא נמצא אחרי ההחלפה"

if grep -q '\${POSTGRES_PORT}:5432' docker-compose.yml; then
  sed -i "s|\${POSTGRES_PORT}:5432|127.0.0.1:${POOLER_PORT}:5432|" docker-compose.yml
  sed -i "s|\${POOLER_PROXY_PORT_TRANSACTION}:6543|127.0.0.1:${POOLER_TX_PORT}:6543|" docker-compose.yml
fi
grep -q "127.0.0.1:${POOLER_PORT}:5432" docker-compose.yml || fail "החלפת פורט ה-pooler נכשלה"

# ============================================================
# 3ב. התחברות עם Google (אופציונלי): מעבירים GOOGLE_CLIENT_ID + GOOGLE_SECRET בהרצה.
#     בלי שניהם — לא נוגעים (Google נשאר כמו שהוא).
# ============================================================
if [[ -n "${GOOGLE_CLIENT_ID:-}" || -n "${GOOGLE_SECRET:-}" ]]; then
  [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_SECRET:-}" ]] || fail "צריך גם GOOGLE_CLIENT_ID וגם GOOGLE_SECRET"
  gid=$(printf %s "$GOOGLE_CLIENT_ID" | tr -cd 'A-Za-z0-9._-')
  gsec=$(printf %s "$GOOGLE_SECRET" | tr -cd 'A-Za-z0-9_-')
  [[ "$gid" == *.apps.googleusercontent.com ]] || fail "GOOGLE_CLIENT_ID לא תקין (צריך להסתיים ב-.apps.googleusercontent.com)"
  [[ "$gsec" == GOCSPX-?* ]] || fail "GOOGLE_SECRET לא תקין (צריך להתחיל ב-GOCSPX-)"
  log "מגדיר התחברות עם Google ל-$AUTH"
  set_env .env GOOGLE_CLIENT_ID "$gid"
  set_env .env GOOGLE_SECRET "$gsec"
  cat > docker-compose.override.yml <<EOF
# Google sign-in for ${PROJECT} - written by deploy/setup-selfhost.sh
# Values: GOOGLE_CLIENT_ID / GOOGLE_SECRET in this folder's .env
services:
  auth:
    environment:
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: "true"
      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: \${GOOGLE_CLIENT_ID}
      GOTRUE_EXTERNAL_GOOGLE_SECRET: \${GOOGLE_SECRET}
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${API_URL}/auth/v1/callback
EOF
  # הלקח מ-Moments: COMPOSE_FILE ב-.env גורם ל-compose להתעלם מ-override
  if grep -q '^COMPOSE_FILE=' .env && ! grep -q '^COMPOSE_FILE=.*docker-compose.override.yml' .env; then
    sed -i 's|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:docker-compose.override.yml|' .env
  fi
  unset gsec
  echo "  ✓ Google מוגדר (Redirect: ${API_URL}/auth/v1/callback)"
fi

# ============================================================
# 4. הרמת הסטאק (7 קונטיינרים; התלויות נפתרות אוטומטית)
# ============================================================
log "מרים את הסטאק: $SERVICES"
docker compose -p "$PROJECT" up -d $SERVICES

log "ממתין ל-Postgres"
for i in $(seq 1 60); do
  docker exec "$DB" pg_isready -U postgres -q 2>/dev/null && break
  sleep 2; [[ $i -eq 60 ]] && fail "Postgres לא עלה בזמן"
done

log "ממתין לסכמת storage (נוצרת ע\"י שירות ה-storage בעלייה ראשונה)"
for i in $(seq 1 60); do
  ok=$(docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT to_regclass('storage.buckets') IS NOT NULL" 2>/dev/null || echo f)
  [[ "$ok" == "t" ]] && break
  sleep 2; [[ $i -eq 60 ]] && fail "סכמת storage לא נוצרה — לבדוק: docker logs ${PROJECT}-storage"
done

if [[ -f docker-compose.override.yml ]]; then
  for i in $(seq 1 30); do
    docker exec "$AUTH" sh -c 'env | grep -q "^GOTRUE_EXTERNAL_GOOGLE_ENABLED=true"' 2>/dev/null && break
    sleep 2; [[ $i -eq 30 ]] && fail "Google לא נטען ב-$AUTH — לבדוק: docker logs $AUTH"
  done
  echo "  ✓ Google פעיל ב-$AUTH"
fi

# ============================================================
# 5. מיגרציות האפליקציה (לפי סדר), buckets, חנות ברירת מחדל ואדמין
# ============================================================
log "מריץ את מיגרציות האפליקציה (כל קובץ מסומן בנפרד — הרצה חוזרת מדלגת רק על מה שכבר הוחל)"
psql_db -c "
  CREATE TABLE IF NOT EXISTS public._migrations_applied (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null
for f in "$APP_DIR"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  already=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
    "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '${name}')")
  if [[ "$already" == "t" ]]; then
    echo "  === $name (כבר הוחל, מדלג) ==="
    continue
  fi
  echo "  === $name ==="
  psql_db < "$f"
  psql_db -c "INSERT INTO public._migrations_applied (filename) VALUES ('${name}');" >/dev/null
done

# הקטלוג הציבורי (אורחים) והלוגו באתר חייבים דלי ציבורי לקריאה —
# הכתיבה נעולה ב-RLS: מנהל, ורק לתיקייה <tenant_id>/ של החנות שלו.
log "יוצר buckets לאחסון (ציבוריים לקריאה)"
psql_db -c "
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('product-images','product-images', true), ('branding','branding', true)
  ON CONFLICT (id) DO NOTHING;
  UPDATE storage.buckets SET public = true WHERE id IN ('product-images','branding');"

# המיגרציות יוצרות חנות ברירת מחדל עם slug זמני — כאן היא מקבלת את שם הפרויקט
log "חנות ברירת המחדל: ${DEFAULT_TENANT_SLUG} (${DEFAULT_TENANT_NAME})"
psql_db -qAt -v slug="$DEFAULT_TENANT_SLUG" -v name="$DEFAULT_TENANT_NAME" <<'SQL'
UPDATE public.tenants SET slug = :'slug', name = :'name' WHERE is_default;
UPDATE public.site_settings s SET site_title = :'name', business_name = :'name'
  FROM public.tenants t
 WHERE t.is_default AND s.tenant_id = t.id AND s.business_name = '';
SELECT '  ✓ ' || slug || ' | ' || name || ' | ' || id FROM public.tenants WHERE is_default;
SQL

log "בודק אם משתמש האדמין כבר קיים ($ADMIN_EMAIL)"
admin_exists=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
  "SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = '$ADMIN_EMAIL')")
if [[ "$admin_exists" == "t" ]]; then
  echo "  ✓ המשתמש כבר קיים — מדלג על יצירה, הסיסמה הקיימת לא נוגעת בה"
else
  if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
    # הקלדה נסתרת: הסיסמה לא נשמרת בהיסטוריית הטרמינל
    read -r -s -p "  סיסמה למנהל ${ADMIN_EMAIL} (לפחות 8 תווים, לא תוצג): " ADMIN_PASSWORD; echo
  fi
  [[ ${#ADMIN_PASSWORD} -ge 8 ]] || fail "הסיסמה קצרה מ-8 תווים"
  log "יוצר משתמש אדמין ($ADMIN_EMAIL)"
  payload=$(ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node -e \
    'process.stdout.write(JSON.stringify({email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, email_confirm: true}))')
  CREATE_RESP=$(curl -s -X POST "http://127.0.0.1:${KONG_HTTP_PORT}/auth/v1/admin/users" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: application/json" -d "$payload")
  unset payload ADMIN_PASSWORD
  echo "$CREATE_RESP" | grep -q '"id"' || fail "יצירת האדמין נכשלה: $CREATE_RESP"
fi
# תמיד מוודא שהתפקיד admin/מאושר/לא-חסום, בחנות ברירת המחדל
psql_db -c "
  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_blocked)
  SELECT t.id, u.id, u.email, 'admin', true, false
    FROM auth.users u, public.tenants t
   WHERE u.email = '$ADMIN_EMAIL' AND t.is_default
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_approved = true, is_blocked = false;"

# ============================================================
# 6. קבצי הסביבה של האפליקציה
# ============================================================
write_app_env "$ANON" "$SERVICE"

log "הסתיים! ✅"
echo "  Kong (API מקומי):     http://127.0.0.1:${KONG_HTTP_PORT}   ← ${API_URL}"
echo "  אפליקציה (אחרי build): http://127.0.0.1:${APP_PORT}         ← ${SITE_URL}"
echo "  Studio:               דרך ${API_URL} אחרי הגדרת Nginx (משתמש: nuriels)"
echo "  סיסמת Studio:         grep DASHBOARD_PASSWORD $SB_DIR/docker/.env"
echo "  סודות הסטאק:          $SB_DIR/docker/.env — לגבות!"

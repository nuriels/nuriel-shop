#!/usr/bin/env bash
# ============================================================
# הקמת Supabase self-hosted עצמאי לפורטל B2B — kobi.nuri1.fit
# סטאק רביעי בשרת, מבודד לחלוטין מ-nuri (Kong 8000), Moments (Kong 8100)
# ומ-מלאי הישן / inv (Kong 8200, אפליקציה 3400).
#
# שימוש:
#   הרצה ראשונה (יוצרת סודות + משתמש אדמין):
#     ADMIN_PASSWORD='סיסמה-חזקה' RESEND_API_KEY='re_...' bash deploy/setup-selfhost.sh
#   הרצה חוזרת (למשל אחרי git pull עם מיגרציה חדשה) — אין צורך בשני המשתנים:
#     bash deploy/setup-selfhost.sh
#   רק כתיבת קבצי env מחדש (בלי לגעת ב-DB):
#     bash deploy/setup-selfhost.sh --env-only
#
# ‏ADMIN_PASSWORD נדרש רק אם עדיין אין משתמש אדמין ב-$ADMIN_EMAIL — אם הוא
# כבר קיים, ההרצה מדלגת על יצירתו ולא נוגעת בסיסמה הקיימת שלו.
# ‏RESEND_API_KEY נדרש רק כשרוצים לשנות/להגדיר אותו — אם לא הועבר, נשמר
# המפתח הקיים מההרצה הקודמת (לא נדרס בריק).
#
# מה הסקריפט עושה:
#   1. מושך את קבצי ה-Docker הרשמיים של Supabase בגרסת Kong (זהה לסטאקים הקיימים)
#   2. מייצר סודות ומפתחות JWT מקומיים
#   3. משנה שמות קונטיינרים (kobi-*) ופורטים כדי לא להתנגש בסטאקים הקיימים
#   4. מרים 7 קונטיינרים בלבד (בלי realtime/supavisor/functions שאינם נחוצים)
#   5. מריץ את כל מיגרציות האפליקציה, יוצר buckets ציבוריים ומשתמש אדמין
#   6. כותב את .env (לבנייה) ואת .env.production (לריצה) של האפליקציה
# ============================================================
set -Eeuo pipefail
# בלי זה, set -e + pipefail מפילים את הסקריפט בשקט (למשל grep שלא מצא שורה)
trap 'echo -e "\033[1;31m✗ הסקריפט נעצר בשורה ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

SB_DIR="/root/kobi-supabase"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# גרסת ה-Kong המוכחת — אותו דור כמו הסטאקים הקיימים (nuri / Moments / inv)
SB_COMMIT="712387bbac26f521783658aada8d9b26d27c56b3"
API_URL="https://api-kobi.nuri1.fit"
SITE_URL="https://kobi.nuri1.fit"
SERVICES="db meta studio kong auth rest storage"
ADMIN_EMAIL="${ADMIN_EMAIL:-nuriel.sh1@gmail.com}"

log()  { echo -e "\n\033[1;34m▶ $*\033[0m"; }
fail() { echo -e "\033[1;31m✗ $*\033[0m" >&2; exit 1; }

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
  if [[ -z "$resend_key" && -f "$APP_DIR/.env.production" ]]; then
    resend_key=$(grep '^RESEND_API_KEY=' "$APP_DIR/.env.production" | tail -1 | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//' || true)
  fi
  log "כותב את קבצי הסביבה של האפליקציה"
  cat > "$APP_DIR/.env" <<EOF
SUPABASE_PROJECT_ID="kobi-selfhosted"
SUPABASE_PUBLISHABLE_KEY="${anon}"
SUPABASE_URL="${API_URL}"
VITE_SUPABASE_PROJECT_ID="kobi-selfhosted"
VITE_SUPABASE_PUBLISHABLE_KEY="${anon}"
VITE_SUPABASE_URL="${API_URL}"
EOF
  cat > "$APP_DIR/.env.production" <<EOF
SUPABASE_URL="${API_URL}"
SUPABASE_PUBLISHABLE_KEY="${anon}"
SUPABASE_SERVICE_ROLE_KEY="${service}"
# מיילי הזמנה (סיכום לסוכן/מנהלים + אישור ללקוח) — ריק = ההזמנות נקלטות
# כרגיל אך המיילים לא יישלחו. כתובת השולח עצמה (ה"מאת") מוגדרת בפאנל
# הניהול באתר → הגדרות מייל, לא כאן — כאן רק המפתח לשליחה עצמה.
RESEND_API_KEY="${resend_key}"
# כתובת הבסיס של האתר — משמשת לבניית קישורי איפוס הסיסמה שנשלחים במייל.
PUBLIC_SITE_URL="${SITE_URL}"
EOF
  if [[ -n "$resend_key" ]]; then
    echo "  ✓ $APP_DIR/.env  +  $APP_DIR/.env.production (RESEND_API_KEY מולא)"
  else
    echo "  ✓ $APP_DIR/.env  +  $APP_DIR/.env.production (RESEND_API_KEY ריק — מיילים לא יישלחו עד שימולא)"
  fi
}

# ============================================================
# מצב --env-only: שחזור קבצי env אחרי git pull (הם לא ב-git)
# ============================================================
# קריאת מפתח: קודם מ-docker/.env, ואם חסר שם — מהקונטיינר kobi-kong שרץ
# (הוא זה שמאמת את המפתח בפועל). בלי "|| true" — pipefail היה מפיל את
# הסקריפט בשקט כשהשורה לא נמצאת, בלי שום הודעה.
read_key() {
  local file_key="$1" kong_key="$2" v=""
  if [[ -f "$SB_DIR/docker/.env" ]]; then
    v=$(grep -E "^${file_key}=" "$SB_DIR/docker/.env" | tail -1 | cut -d= -f2- | tr -d '\r"' || true)
  fi
  if [[ -z "$v" ]]; then
    v=$(docker inspect kobi-kong --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
          | grep -E "^${kong_key}=" | cut -d= -f2- | tr -d '\r"' || true)
    [[ -n "$v" ]] && echo -e "\033[1;33m  ⚠ ${file_key} חסר ב-$SB_DIR/docker/.env — נלקח מהקונטיינר kobi-kong. לבדוק את הקובץ!\033[0m" >&2
  fi
  [[ -n "$v" ]] || fail "${file_key} לא נמצא — לא ב-$SB_DIR/docker/.env ולא בקונטיינר kobi-kong"
  printf '%s' "$v"
}

if [[ "${1:-}" == "--env-only" ]]; then
  ANON=$(read_key ANON_KEY SUPABASE_ANON_KEY)
  SERVICE=$(read_key SERVICE_ROLE_KEY SUPABASE_SERVICE_KEY)
  write_app_env "$ANON" "$SERVICE"
  # אימות מול Kong: המפתח שנכתב חייב להתקבל, אחרת הדפדפן יקבל Unauthorized
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: ${ANON}" "${API_URL}/auth/v1/settings" || echo 000)
  if [[ "$code" == "200" ]]; then
    echo "  ✓ Kong מקבל את המפתח (200)"
  else
    fail "Kong דחה את המפתח שנכתב (HTTP ${code}) — לא לבנות את האפליקציה עד שזה מתוקן"
  fi
  exit 0
fi

# ‏ADMIN_PASSWORD נדרש רק כשעדיין אין משתמש אדמין (נבדק בפועל בסעיף 5,
# אחרי שה-DB עולה) — כדי שהרצות חוזרות (למשל אחרי git pull למיגרציה חדשה)
# לא ידרשו סיסמה מחדש בכל פעם.
command -v node >/dev/null || fail "node לא נמצא (נדרש ליצירת מפתחות)"

# ============================================================
# 1. משיכת קבצי Supabase (רק תיקיית docker, בקומיט נעוץ)
# ============================================================
if [[ ! -f "$SB_DIR/docker/docker-compose.yml" ]]; then
  log "מושך קבצי Supabase (גרסת Kong נעוצה)"
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
  eval "$(node "$APP_DIR/deploy/gen-keys.mjs")"
  set_env .env POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  set_env .env JWT_SECRET "$JWT_SECRET"
  set_env .env ANON_KEY "$ANON_KEY"
  set_env .env SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
  set_env .env DASHBOARD_USERNAME "nuriels"
  set_env .env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
  set_env .env SECRET_KEY_BASE "$SECRET_KEY_BASE"
  set_env .env VAULT_ENC_KEY "$VAULT_ENC_KEY"
  set_env .env POOLER_TENANT_ID "kobi"
  # כתובות
  set_env .env SITE_URL "$SITE_URL"
  set_env .env API_EXTERNAL_URL "$API_URL"
  set_env .env SUPABASE_PUBLIC_URL "$API_URL"
  set_env .env ADDITIONAL_REDIRECT_URLS "${SITE_URL}/*"
  # פורטים — 8000/8443 תפוסים ע"י nuri, 8100 ע"י Moments, 8200/8245 ע"י inv (המלאי הישן)
  set_env .env KONG_HTTP_PORT "127.0.0.1:8300"
  set_env .env KONG_HTTPS_PORT "127.0.0.1:8345"
  # הלקח מהסטאקים הקודמים: בלי SMTP חובה אישור-עצמי של הרשמות
  set_env .env ENABLE_EMAIL_AUTOCONFIRM "true"
  set_env .env DISABLE_SIGNUP "false"
  set_env .env STUDIO_DEFAULT_ORGANIZATION "nuriel"
  set_env .env STUDIO_DEFAULT_PROJECT "kobi"
else
  log "קובץ .env קיים — משתמש בסודות הקיימים"
fi
ANON=$(grep '^ANON_KEY=' .env | cut -d= -f2-)
SERVICE=$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)

# ============================================================
# 3. התאמות compose: שמות קונטיינרים + פורטים של supavisor
#    (כל החלפה מאומתת — החלפה שקטה שנכשלת הפילה אותנו בעבר)
# ============================================================
log "מתאים שמות קונטיינרים ופורטים"
if grep -q "container_name: supabase-" docker-compose.yml; then
  sed -i 's/container_name: realtime-dev\.supabase-realtime/container_name: realtime-dev.kobi-realtime/' docker-compose.yml
  sed -i 's/container_name: supabase-/container_name: kobi-/' docker-compose.yml
fi
grep -q "container_name: supabase-" docker-compose.yml && fail "שינוי שמות קונטיינרים נכשל"
grep -q "container_name: kobi-db" docker-compose.yml || fail "kobi-db לא נמצא אחרי ההחלפה"

# supavisor לא מורם, אבל compose מאמת את כל הקובץ — הפורטים חייבים לא להתנגש
# (5432/6543 = ברירת מחדל, 5435/6544 = inv הישן)
if grep -q '\${POSTGRES_PORT}:5432' docker-compose.yml; then
  sed -i 's|\${POSTGRES_PORT}:5432|127.0.0.1:5436:5432|' docker-compose.yml
  sed -i 's|\${POOLER_PROXY_PORT_TRANSACTION}:6543|127.0.0.1:6545:6543|' docker-compose.yml
fi
grep -q '127.0.0.1:5436:5432' docker-compose.yml || fail "החלפת פורט ה-pooler נכשלה"

# ============================================================
# 4. הרמת הסטאק (7 קונטיינרים; התלויות נפתרות אוטומטית)
# ============================================================
# ============================================================
# 3ב. התחברות עם Google (אופציונלי): מעבירים GOOGLE_CLIENT_ID + GOOGLE_SECRET בהרצה.
#     בלי שניהם — לא נוגעים (Google נשאר כמו שהוא). נכתב רק לסטאק של קובי.
# ============================================================
if [[ -n "${GOOGLE_CLIENT_ID:-}" || -n "${GOOGLE_SECRET:-}" ]]; then
  [[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_SECRET:-}" ]] || fail "צריך גם GOOGLE_CLIENT_ID וגם GOOGLE_SECRET"
  gid=$(printf %s "$GOOGLE_CLIENT_ID" | tr -cd 'A-Za-z0-9._-')
  gsec=$(printf %s "$GOOGLE_SECRET" | tr -cd 'A-Za-z0-9_-')
  [[ "$gid" == *.apps.googleusercontent.com ]] || fail "GOOGLE_CLIENT_ID לא תקין (צריך להסתיים ב-.apps.googleusercontent.com)"
  [[ "$gsec" == GOCSPX-?* ]] || fail "GOOGLE_SECRET לא תקין (צריך להתחיל ב-GOCSPX-)"
  log "מגדיר התחברות עם Google ל-kobi-auth"
  set_env .env GOOGLE_CLIENT_ID "$gid"
  set_env .env GOOGLE_SECRET "$gsec"
  cat > docker-compose.override.yml <<EOF
# Google sign-in for Kobi - written by deploy/setup-selfhost.sh
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

log "מרים את הסטאק: $SERVICES"
docker compose -p kobi up -d $SERVICES

log "ממתין ל-Postgres"
for i in $(seq 1 60); do
  docker exec kobi-db pg_isready -U postgres -q 2>/dev/null && break
  sleep 2; [[ $i -eq 60 ]] && fail "Postgres לא עלה בזמן"
done

log "ממתין לסכמת storage (נוצרת ע\"י שירות ה-storage בעלייה ראשונה)"
for i in $(seq 1 60); do
  ok=$(docker exec kobi-db psql -U postgres -d postgres -tAc "SELECT to_regclass('storage.buckets') IS NOT NULL" 2>/dev/null || echo f)
  [[ "$ok" == "t" ]] && break
  sleep 2; [[ $i -eq 60 ]] && fail "סכמת storage לא נוצרה — לבדוק: docker logs kobi-storage"
done

# ============================================================
# 5. מיגרציות האפליקציה (לפי סדר), buckets וסופר-אדמין
# ============================================================
if [[ -f docker-compose.override.yml ]]; then
  for i in $(seq 1 30); do
    docker exec kobi-auth sh -c 'env | grep -q "^GOTRUE_EXTERNAL_GOOGLE_ENABLED=true"' 2>/dev/null && break
    sleep 2; [[ $i -eq 30 ]] && fail "Google לא נטען ב-kobi-auth — לבדוק: docker logs kobi-auth"
  done
  echo "  ✓ Google פעיל ב-kobi-auth"
fi
log "מריץ את מיגרציות האפליקציה (כל קובץ מסומן בנפרד — הרצה חוזרת מדלגת רק על מה שכבר הוחל, לא הכל-או-כלום)"
docker exec kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS public._migrations_applied (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );" >/dev/null
for f in "$APP_DIR"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  already=$(docker exec kobi-db psql -U postgres -d postgres -tAc \
    "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '${name}')")
  if [[ "$already" == "t" ]]; then
    echo "  === $name (כבר הוחל, מדלג) ==="
    continue
  fi
  echo "  === $name ==="
  docker exec -i kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
  docker exec kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
    "INSERT INTO public._migrations_applied (filename) VALUES ('${name}');" >/dev/null
done

# הקטלוג הציבורי (אורחים) והלוגו באתר חייבים דלי ציבורי לקריאה —
# בניגוד לגרסת המלאי הישנה, כאן הכתיבה בלבד נעולה ל-RLS/אדמין.
log "יוצר buckets לאחסון (ציבוריים לקריאה)"
docker exec kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('product-images','product-images', true), ('branding','branding', true)
  ON CONFLICT (id) DO NOTHING;
  DO \$\$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='storage' AND table_name='buckets' AND column_name='public') THEN
      UPDATE storage.buckets SET public = true WHERE id IN ('product-images','branding');
    END IF;
  END \$\$;"

log "בודק אם משתמש האדמין כבר קיים ($ADMIN_EMAIL)"
admin_exists=$(docker exec kobi-db psql -U postgres -d postgres -tAc \
  "SELECT EXISTS (SELECT 1 FROM auth.users WHERE email = '$ADMIN_EMAIL')")
if [[ "$admin_exists" == "t" ]]; then
  echo "  ✓ המשתמש כבר קיים — מדלג על יצירה, הסיסמה הקיימת לא נוגעת בה"
else
  [[ -n "${ADMIN_PASSWORD:-}" ]] || fail "המשתמש $ADMIN_EMAIL עדיין לא קיים — חובה להגדיר סיסמה ליצירתו: ADMIN_PASSWORD='...' bash $0"
  log "יוצר משתמש אדמין ($ADMIN_EMAIL)"
  CREATE_RESP=$(curl -s -X POST "http://127.0.0.1:8300/auth/v1/admin/users" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"email_confirm\":true}")
  echo "$CREATE_RESP" | grep -q '"id"' || fail "יצירת האדמין נכשלה: $CREATE_RESP"
fi
# תמיד מוודא שהתפקיד admin/מאושר/לא-חסום, גם אם המשתמש כבר קיים מקודם
docker exec kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
  INSERT INTO public.user_roles (user_id, email, role, is_approved, is_blocked)
  SELECT id, email, 'admin', true, false FROM auth.users WHERE email = '$ADMIN_EMAIL'
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_approved = true, is_blocked = false;"

# ============================================================
# 6. קבצי הסביבה של האפליקציה
# ============================================================
write_app_env "$ANON" "$SERVICE"

log "הסתיים! ✅"
echo "  Kong (API פנימי):     http://127.0.0.1:8300"
echo "  Studio:               דרך $API_URL אחרי הגדרת Nginx (משתמש: nuriels)"
echo "  סיסמת Studio:         grep DASHBOARD_PASSWORD $SB_DIR/docker/.env"
echo "  השלב הבא:             Nginx + certbot ל-kobi.nuri1.fit ול-api-kobi.nuri1.fit,"
echo "                        ואז build לאפליקציה + מילוי RESEND_API_KEY"

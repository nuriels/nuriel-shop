#!/usr/bin/env bash
# ============================================================
# תעודת SSL אוטומטית לכל חנות בתת-דומיין (<slug>.nuri1.fit)
# ============================================================
# רץ כל דקה (systemd: nuriel-store-certs.timer — מותקן ע"י
# install-store-certs.sh). בכל ריצה:
#   1. קורא את רשימת החנויות מהמסד (דרך Kong המקומי, service role).
#   2. לחנות שאין לה עדיין תעודה — מנפיק תעודת Let's Encrypt (HTTP-01,
#      webroot). ה-DNS הכללי (*.nuri1.fit) כבר מפנה לשרת, ובלוק ה-80
#      הכללי (nuriel-stores-wildcard) מגיש את קובץ האימות.
#   3. כותב מחדש את /etc/nginx/sites-available/nuriel-stores-ssl: בלוק
#      80 (הפניה ל-https) + בלוק 443 לכל חנות שיש לה תעודה. אם השתנה —
#      nginx -t ואז reload; אם הבדיקה נכשלת — מחזיר את הקובץ הקודם.
# חידוש התעודות: certbot.timer הרגיל של השרת (עם reload ל-nginx).
#
# לא נוגע באתרים אחרים בשרת: שם שכבר מוגדר בבלוק nginx אחר (למשל
# kobi.nuri1.fit) מדלגים עליו, וחנות ברירת המחדל (nuriel-shop) כבר
# מוגדרת בקובץ משלה. תקלה זמנית (Kong לא עונה) — לא משנה כלום.
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
KONG_URL="${KONG_URL:-http://127.0.0.1:8500}"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
LE_DIR="${LE_DIR:-/etc/letsencrypt}"
WEBROOT="${WEBROOT:-/var/www/nuriel-acme}"
STATE_DIR="${STATE_DIR:-/var/lib/nuriel-store-certs}"
LOCK_FILE="${LOCK_FILE:-/run/nuriel-store-certs.lock}"
# אחרי כישלון בהנפקה — לא לנסות שוב לפני שעה (מגבלות Let's Encrypt)
RETRY_AFTER_SECONDS="${RETRY_AFTER_SECONDS:-3600}"

SITE_NAME=nuriel-stores-ssl
SITE_FILE="$NGINX_DIR/sites-available/$SITE_NAME"
SITE_LINK="$NGINX_DIR/sites-enabled/$SITE_NAME"
PROXY_SNIPPET="$NGINX_DIR/snippets/nuriel-app-proxy.conf"

log() { echo "[store-certs] $*"; }
# הודעה שחוזרת בכל ריצה (דילוג קבוע) — רק בפעם הראשונה, שהלוג לא יוצף
log_once() {
  local key="$STATE_DIR/notes/$1"
  shift
  [[ -f "$key" ]] && return 0
  mkdir -p "$STATE_DIR/notes"
  touch "$key"
  log "$@"
}

# ריצה אחת בכל רגע
mkdir -p "$(dirname "$LOCK_FILE")" "$STATE_DIR"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r'; }
BASE_DOMAIN="$(env_get TENANT_BASE_DOMAIN)"
SERVICE_KEY="$(env_get SUPABASE_SERVICE_ROLE_KEY)"
[[ -n "$BASE_DOMAIN" && -n "$SERVICE_KEY" ]] || {
  log "חסר TENANT_BASE_DOMAIN או SUPABASE_SERVICE_ROLE_KEY ב-$ENV_FILE"
  exit 1
}

# --- 1. החנויות (בלי חנות ברירת המחדל) ---
# תקלה כאן עוצרת את הריצה בלי לגעת בהגדרות הקיימות
slugs="$(
  curl -fsS --max-time 20 \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Accept: text/csv" \
    "$KONG_URL/rest/v1/tenants?select=slug&is_default=is.false&order=slug" | tail -n +2
)"

# --- שמות שכבר מוגדרים בבלוקים אחרים של nginx (אתרים אחרים בשרת) ---
taken_names="$(
  nginx -T 2>/dev/null | awk -v own="$SITE_NAME" '
    /^# configuration file / { file = $4; next }
    index(file, own) == 0 && $1 == "server_name" {
      for (i = 2; i <= NF; i++) {
        if ($i ~ /^#/) break
        gsub(/;/, "", $i)
        if ($i != "") print $i
      }
    }' | sort -u
)"

has_cert() { [[ -f "$LE_DIR/renewal/$1.conf" && -f "$LE_DIR/live/$1/fullchain.pem" ]]; }

ready_hosts=()
while IFS= read -r slug; do
  [[ -z "$slug" ]] && continue
  # רק תווים חוקיים לשם דומיין — לא מעבירים שום דבר אחר ל-certbot / nginx
  if [[ ! "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    log_once "invalid-${slug//[^A-Za-z0-9_-]/_}" "מדלג על slug לא תקין: $slug"
    continue
  fi
  host="$slug.$BASE_DOMAIN"

  if grep -qxF -- "$host" <<<"$taken_names"; then
    log_once "taken-$host" "מדלג על $host — השם כבר מוגדר באתר אחר בשרת"
    continue
  fi

  if ! has_cert "$host"; then
    marker="$STATE_DIR/$host.failed"
    if [[ -f "$marker" ]] && (($(date +%s) - $(stat -c %Y "$marker") < RETRY_AFTER_SECONDS)); then
      continue
    fi
    log "מנפיק תעודה ל-$host"
    if certbot certonly --webroot -w "$WEBROOT" -d "$host" --cert-name "$host" \
      --non-interactive --agree-tos --keep-until-expiring \
      --deploy-hook "systemctl reload nginx" >"$STATE_DIR/$host.log" 2>&1; then
      rm -f "$marker"
      log "✓ תעודה הונפקה ל-$host"
    else
      touch "$marker"
      log "✗ ההנפקה ל-$host נכשלה (ניסיון חוזר בעוד שעה) — פרטים: $STATE_DIR/$host.log"
      continue
    fi
  fi

  has_cert "$host" && ready_hosts+=("$host")
done <<<"$slugs"

# --- 3. קובץ ה-nginx של החנויות ---
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  echo "# נוצר אוטומטית ע\"י deploy/ssl/store-certs.sh — לא לערוך ידנית"
  echo "# חנויות עם תעודת SSL משלהן: ${#ready_hosts[@]}"
  ssl_options=""
  [[ -f "$LE_DIR/options-ssl-nginx.conf" ]] && ssl_options="    include $LE_DIR/options-ssl-nginx.conf;"
  # IPv6 רק אם השרת תומך בו (אחרת nginx לא עולה)
  listen6_80="" listen6_443=""
  if [[ -f /proc/net/if_inet6 ]]; then
    listen6_80="    listen [::]:80;"
    listen6_443="    listen [::]:443 ssl;"
  fi
  for host in "${ready_hosts[@]}"; do
    cat <<EOF

server {
    listen 80;
$listen6_80
    server_name $host;
    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
$listen6_443
    server_name $host;
    ssl_certificate $LE_DIR/live/$host/fullchain.pem;
    ssl_certificate_key $LE_DIR/live/$host/privkey.pem;
$ssl_options
    include $PROXY_SNIPPET;
}
EOF
  done
} >"$tmp"

if [[ -f "$SITE_FILE" ]] && cmp -s "$tmp" "$SITE_FILE" && [[ -L "$SITE_LINK" ]]; then
  exit 0
fi

backup=""
if [[ -f "$SITE_FILE" ]]; then
  backup="$STATE_DIR/$SITE_NAME.previous"
  cp "$SITE_FILE" "$backup"
fi
install -m 0644 "$tmp" "$SITE_FILE"
ln -sfn "$SITE_FILE" "$SITE_LINK"

if nginx -t >/dev/null 2>"$STATE_DIR/nginx-test.log"; then
  systemctl reload nginx
  log "✓ nginx עודכן — ${#ready_hosts[@]} חנויות עם SSL"
else
  # לא משאירים את nginx עם הגדרה שבורה
  if [[ -n "$backup" ]]; then cp "$backup" "$SITE_FILE"; else rm -f "$SITE_LINK" "$SITE_FILE"; fi
  log "✗ בדיקת nginx נכשלה — הוחזרה ההגדרה הקודמת. פרטים: $STATE_DIR/nginx-test.log"
  exit 1
fi

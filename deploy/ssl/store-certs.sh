#!/usr/bin/env bash
# ============================================================
# תעודות SSL של החנויות — סנכרון בין השרת לפאנל הפלטפורמה
# ============================================================
# רץ כל דקה (systemd: nuriel-store-certs.timer — מותקן ע"י
# install-store-certs.sh). בכל ריצה:
#   1. קורא מהמסד (Kong המקומי, service role — ssl_agent_targets): כל
#      החנויות, בקשות "חידוש תעודה" מהפאנל, וכתובות של חנויות שנמחקו.
#   2. חנות בתת-דומיין (<slug>.nuri1.fit) שאין לה תעודה — מנפיק תעודת
#      Let's Encrypt (HTTP-01, webroot). ה-DNS הכללי מפנה לשרת, ובלוק
#      ה-80 הכללי (nuriel-stores-wildcard) מגיש את קובץ האימות.
#   3. בקשת חידוש מהפאנל — certbot renew --force-renewal לתעודה הזו.
#   4. חנות שנמחקה — מוחק את התעודה שלה (רק תעודה שהסקריפט הזה הנפיק).
#   5. מדווח למסד (ssl_agent_report) את התוקף / השגיאה של כל תעודה —
#      זה מה שמוצג בפאנל ליד כל חנות.
#   6. כותב מחדש את /etc/nginx/sites-available/nuriel-stores-ssl: בלוק
#      80 (הפניה ל-https) + בלוק 443 לכל חנות שיש לה תעודה. אם השתנה —
#      nginx -t ואז reload; אם הבדיקה נכשלת — מחזיר את הקובץ הקודם.
#   7. דומיינים מותאמים אישית (custom_domain שה-DNS שלו אומת בפאנל החנות —
#      custom_domain_targets), בקובץ nginx נפרד: nuriel-stores-custom.
#      ריצה ראשונה: בלוק 80 (קבצי אימות + האתר ב-http). ריצה שאחריה: תעודת
#      Let's Encrypt (HTTP-01) + בלוק 443 + הפניה ל-https. מדווח למסד
#      (custom_domain_report) → "פעיל" בפאנל החנות. דומיין שהוסר — יוצא
#      מ-nginx והתעודה שלו נמחקת. תקלה בחלק הזה לא נוגעת בתתי-הדומיין.
# חידוש שוטף: certbot.timer הרגיל של השרת (עם reload ל-nginx).
#
# לא נוגע באתרים אחרים בשרת: שם שכבר מוגדר בבלוק nginx אחר (למשל
# kobi.nuri1.fit) מדלגים עליו. חנות ברירת המחדל (nuriel-shop) מוגדרת
# בקובץ משלה — לה רק מדווחים תוקף ומחדשים לפי בקשה. תקלה זמנית (Kong
# לא עונה) — לא משנה כלום.
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
# הכתובת של חנות ברירת המחדל (התעודה שלה מנוהלת ע"י certbot --nginx)
DEFAULT_HOST="$(env_get PUBLIC_SITE_URL)"
DEFAULT_HOST="${DEFAULT_HOST#*://}"
DEFAULT_HOST="${DEFAULT_HOST%%/*}"
DEFAULT_HOST="${DEFAULT_HOST%%:*}"
DEFAULT_HOST="${DEFAULT_HOST,,}"

rpc() {
  curl -fsS --max-time 30 -X POST \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" "$@"
}

# ------------------------------------------------------------
# עזרים לתעודות
# ------------------------------------------------------------
HOST_RE='^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
has_cert() { [[ -f "$LE_DIR/renewal/$1.conf" && -f "$LE_DIR/live/$1/fullchain.pem" ]]; }
# תעודה שהסקריפט הזה הנפיק (ולא של אתר אחר / certbot --nginx)
is_ours() { [[ -f "$LE_DIR/renewal/$1.conf" ]] && grep -qF -- "$WEBROOT" "$LE_DIR/renewal/$1.conf"; }

# "<issued> <expires>" בפורמט ISO
cert_dates() {
  local pem="$LE_DIR/live/$1/cert.pem" nb na
  [[ -f "$pem" ]] || pem="$LE_DIR/live/$1/fullchain.pem"
  nb="$(openssl x509 -noout -startdate -in "$pem" 2>/dev/null | cut -d= -f2)" || return 1
  na="$(openssl x509 -noout -enddate -in "$pem" 2>/dev/null | cut -d= -f2)" || return 1
  [[ -n "$nb" && -n "$na" ]] || return 1
  echo "$(date -u -d "$nb" +%Y-%m-%dT%H:%M:%SZ) $(date -u -d "$na" +%Y-%m-%dT%H:%M:%SZ)"
}

# השורה המשמעותית בלוג של certbot (לתצוגה בפאנל)
cert_error() {
  local line
  line="$(grep -E 'Detail:|[Ee]rror' "$1" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$line" ]] || line="$(grep -v '^[[:space:]]*$' "$1" 2>/dev/null | tail -n 1 || true)"
  sed 's/^[[:space:]]*//' <<<"${line:-certbot נכשל}" | cut -c1-300
}

issue() {
  local host=$1
  log "מנפיק תעודה ל-$host"
  if certbot certonly --webroot -w "$WEBROOT" -d "$host" --cert-name "$host" \
    --non-interactive --agree-tos --keep-until-expiring \
    --deploy-hook "systemctl reload nginx" >"$STATE_DIR/$host.log" 2>&1; then
    rm -f "$STATE_DIR/$host.failed"
    log "✓ תעודה הונפקה ל-$host"
  else
    touch "$STATE_DIR/$host.failed"
    log "✗ ההנפקה ל-$host נכשלה (ניסיון חוזר בעוד שעה) — פרטים: $STATE_DIR/$host.log"
    return 1
  fi
}

# חידוש מיידי לפי בקשה מהפאנל (ההגדרות של התעודה — מקובץ ה-renewal שלה)
renew_now() {
  local host=$1
  log "מחדש את התעודה של $host (בקשה מהפאנל)"
  if certbot renew --cert-name "$host" --force-renewal --non-interactive \
    >"$STATE_DIR/$host.renew.log" 2>&1; then
    log "✓ התעודה של $host חודשה"
  else
    log "✗ החידוש של $host נכשל — פרטים: $STATE_DIR/$host.renew.log"
    return 1
  fi
}

# חידוש ידני שנכשל — השגיאה נשארת בפאנל עד שהתעודה מתחדשת (ידנית או אוטומטית):
# נשמרת יחד עם תאריך התפוגה של התעודה באותו רגע
remember_renew_error() { # host error
  local dates
  dates="$(cert_dates "$1" || true)"
  printf '%s\n%s\n' "${dates#* }" "$2" >"$STATE_DIR/$1.renew-error"
}
renew_error() { # host expires → השגיאה, אם התעודה לא התחדשה מאז
  local f="$STATE_DIR/$1.renew-error"
  [[ -f "$f" ]] || return 0
  if [[ "$(head -n 1 "$f")" == "$2" ]]; then tail -n +2 "$f"; else rm -f "$f"; fi
}

json_str() {
  local v=${1//\\/\\\\}
  v=${v//\"/\\\"}
  printf '"%s"' "$(printf '%s' "$v" | tr -d '\000-\037')"
}
reports=()
add_report() { # host tenant status issued expires error handled
  reports+=("{\"host\":$(json_str "$1"),\"tenant_id\":$(json_str "$2"),\"status\":$(json_str "$3"),\"issued_at\":$(json_str "$4"),\"expires_at\":$(json_str "$5"),\"error\":$(json_str "$6"),\"renewal_handled\":$(json_str "$7")}")
}

# ------------------------------------------------------------
# 1. מה לטפל בו
# ------------------------------------------------------------
# תקלה כאן עוצרת את הריצה בלי לגעת בהגדרות הקיימות.
# CSV: kind,tenant_id,slug,is_default,host,renew_requested_at
targets="$(rpc -H "Accept: text/csv" -d '{}' "$KONG_URL/rest/v1/rpc/ssl_agent_targets" | tail -n +2)"

# שמות שכבר מוגדרים בבלוקים אחרים של nginx (אתרים אחרים בשרת) — בלי
# הקבצים של הסקריפט הזה עצמו (nuriel-stores-ssl / -custom / -wildcard)
taken_names="$(
  nginx -T 2>/dev/null | awk '
    /^# configuration file / { file = $4; next }
    index(file, "nuriel-stores-") == 0 && $1 == "server_name" {
      for (i = 2; i <= NF; i++) {
        if ($i ~ /^#/) break
        gsub(/;/, "", $i)
        if ($i != "") print $i
      }
    }' | sort -u
)"

ready_hosts=()
removed_hosts=()
while IFS=, read -r kind tenant_id slug is_default host renew_at; do
  [[ -z "$kind" ]] && continue

  # --- חנות שנמחקה: התעודה שלה כבר לא נחוצה ---
  if [[ "$kind" == deleted ]]; then
    [[ "$host" =~ $HOST_RE ]] || continue
    if is_ours "$host"; then
      if certbot delete --cert-name "$host" --non-interactive >"$STATE_DIR/$host.delete.log" 2>&1; then
        log "✓ התעודה של $host נמחקה (החנות נמחקה)"
      else
        log_once "delete-$host" "✗ מחיקת התעודה של $host נכשלה — פרטים: $STATE_DIR/$host.delete.log"
        continue
      fi
    fi
    rm -f "$STATE_DIR/$host".* "$STATE_DIR/notes/"*"-$host"
    removed_hosts+=("$host")
    continue
  fi

  handled=""

  # --- חנות ברירת המחדל: רק תוקף + חידוש לפי בקשה ---
  if [[ "$is_default" == t || "$is_default" == true ]]; then
    [[ "$DEFAULT_HOST" =~ $HOST_RE ]] || continue
    host="$DEFAULT_HOST"
    if [[ -n "$renew_at" ]]; then
      handled="$renew_at"
      if has_cert "$host"; then
        if renew_now "$host"; then
          rm -f "$STATE_DIR/$host.renew-error"
        else
          remember_renew_error "$host" "$(cert_error "$STATE_DIR/$host.renew.log")"
        fi
      fi
    fi
    if has_cert "$host" && dates="$(cert_dates "$host")"; then
      error="$(renew_error "$host" "${dates#* }")"
      add_report "$host" "$tenant_id" active "${dates% *}" "${dates#* }" "$error" "$handled"
    else
      add_report "$host" "$tenant_id" external "" "" "" "$handled"
    fi
    continue
  fi

  # --- חנות בתת-דומיין ---
  # רק תווים חוקיים לשם דומיין — לא מעבירים שום דבר אחר ל-certbot / nginx
  if [[ ! "$slug" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    log_once "invalid-${slug//[^A-Za-z0-9_-]/_}" "מדלג על slug לא תקין: $slug"
    continue
  fi
  host="$slug.$BASE_DOMAIN"

  if grep -qxF -- "$host" <<<"$taken_names"; then
    log_once "taken-$host" "מדלג על $host — השם כבר מוגדר באתר אחר בשרת"
    add_report "$host" "$tenant_id" blocked "" "" "" "$renew_at"
    continue
  fi

  if [[ -n "$renew_at" ]]; then
    handled="$renew_at"
    if has_cert "$host"; then
      if renew_now "$host"; then
        rm -f "$STATE_DIR/$host.renew-error"
      else
        remember_renew_error "$host" "$(cert_error "$STATE_DIR/$host.renew.log")"
      fi
    else
      # בקשה מהפאנל = לנסות עכשיו, גם בתוך שעת ההמתנה אחרי כישלון
      rm -f "$STATE_DIR/$host.failed"
    fi
  fi

  if ! has_cert "$host"; then
    marker="$STATE_DIR/$host.failed"
    if [[ ! -f "$marker" ]] || (($(date +%s) - $(stat -c %Y "$marker") >= RETRY_AFTER_SECONDS)); then
      issue "$host" || true
    fi
  fi

  if has_cert "$host" && dates="$(cert_dates "$host")"; then
    error="$(renew_error "$host" "${dates#* }")"
    add_report "$host" "$tenant_id" active "${dates% *}" "${dates#* }" "$error" "$handled"
    ready_hosts+=("$host")
  elif has_cert "$host"; then
    add_report "$host" "$tenant_id" active "" "" "" "$handled"
    ready_hosts+=("$host")
  elif [[ -f "$STATE_DIR/$host.failed" ]]; then
    add_report "$host" "$tenant_id" error "" "" "$(cert_error "$STATE_DIR/$host.log")" "$handled"
  else
    add_report "$host" "$tenant_id" pending "" "" "" "$handled"
  fi
done < <(tr -d '"\r' <<<"$targets")

# ------------------------------------------------------------
# 2. דיווח למסד (מה שמוצג בפאנל)
# ------------------------------------------------------------
rows_json="[$(IFS=,; echo "${reports[*]}")]"
removed_json="["
for h in "${removed_hosts[@]}"; do removed_json+="$(json_str "$h"),"; done
removed_json="${removed_json%,}]"
rpc -o /dev/null -d "{\"_rows\":$rows_json,\"_removed\":$removed_json}" \
  "$KONG_URL/rest/v1/rpc/ssl_agent_report" || log "✗ הדיווח למסד נכשל"

# ------------------------------------------------------------
# 2ב. דומיינים מותאמים אישית (www.his-shop.co.il → החנות)
# ------------------------------------------------------------
CUSTOM_SITE_NAME=nuriel-stores-custom
CUSTOM_SITE_FILE="$NGINX_DIR/sites-available/$CUSTOM_SITE_NAME"
CUSTOM_SITE_LINK="$NGINX_DIR/sites-enabled/$CUSTOM_SITE_NAME"
# הדומיינים שהסקריפט מנהל — כדי למחוק תעודה של דומיין שהוסר מהחנות
CUSTOM_LIST="$STATE_DIR/custom-domains.list"
DOMAIN_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'

custom_block() { # host → בלוקי nginx (80 תמיד; 443 + הפניה כשיש תעודה)
  local host=$1 l6_80="" l6_443="" ssl_opts=""
  if [[ -f /proc/net/if_inet6 ]]; then
    l6_80="    listen [::]:80;"
    l6_443="    listen [::]:443 ssl;"
  fi
  [[ -f "$LE_DIR/options-ssl-nginx.conf" ]] && ssl_opts="    include $LE_DIR/options-ssl-nginx.conf;"
  if has_cert "$host"; then
    cat <<EOF

server {
    listen 80;
$l6_80
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
$l6_443
    server_name $host;
    ssl_certificate $LE_DIR/live/$host/fullchain.pem;
    ssl_certificate_key $LE_DIR/live/$host/privkey.pem;
$ssl_opts
    include $PROXY_SNIPPET;
}
EOF
  else
    # עד שהתעודה מוכנה: קבצי האימות של Let's Encrypt, והאתר עצמו ב-http
    cat <<EOF

server {
    listen 80;
$l6_80
    server_name $host;
    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
    }
    include $PROXY_SNIPPET;
}
EOF
  fi
}

custom_row() { # tenant domain status [expires] [error]
  local row="{\"tenant_id\":$(json_str "$1"),\"domain\":$(json_str "$2"),\"status\":$(json_str "$3")"
  [[ -n "${4:-}" ]] && row+=",\"expires_at\":$(json_str "$4")"
  [[ -n "${5:-}" ]] && row+=",\"error\":$(json_str "$5")"
  printf '%s}' "$row"
}

sync_custom_domains() {
  local csv
  # מסד בלי הפונקציה (לפני המיגרציה) או תקלה זמנית — לא נוגעים בכלום
  if ! csv="$(rpc -H "Accept: text/csv" -d '{}' "$KONG_URL/rest/v1/rpc/custom_domain_targets" 2>/dev/null)"; then
    log_once "custom-targets-unavailable" "דומיינים מותאמים: custom_domain_targets לא זמין (מיגרציה 20261019110000?) — מדלג"
    return 0
  fi

  local -a hosts=() rows=()
  local tenant_id slug domain status marker dates
  while IFS=, read -r tenant_id slug domain status; do
    [[ -z "$domain" ]] && continue
    # רק שם דומיין תקין — לא מעבירים שום דבר אחר ל-certbot / nginx
    if [[ ! "$domain" =~ $DOMAIN_RE || "$domain" == "$BASE_DOMAIN" || "$domain" == *".$BASE_DOMAIN" ]]; then
      log_once "custom-invalid-${domain//[^a-z0-9.-]/_}" "מדלג על דומיין מותאם לא תקין: $domain"
      continue
    fi
    if grep -qxF -- "$domain" <<<"$taken_names"; then
      log_once "custom-taken-$domain" "מדלג על $domain — השם כבר מוגדר באתר אחר בשרת"
      rows+=("$(custom_row "$tenant_id" "$domain" error "" "הדומיין כבר מוגדר באתר אחר בשרת — פנו לתמיכה")")
      continue
    fi
    hosts+=("$domain")

    # הנפקה רק אחרי שבלוק ה-80 של הדומיין כבר פעיל ב-nginx (מהריצה הקודמת) —
    # אחרת Let's Encrypt לא ימצא את קובץ האימות
    if ! has_cert "$domain" && [[ -L "$CUSTOM_SITE_LINK" ]] &&
      grep -qF -- "server_name $domain;" "$CUSTOM_SITE_FILE" 2>/dev/null; then
      marker="$STATE_DIR/$domain.failed"
      if [[ ! -f "$marker" ]] || (($(date +%s) - $(stat -c %Y "$marker") >= RETRY_AFTER_SECONDS)); then
        issue "$domain" || true
      fi
    fi

    if has_cert "$domain"; then
      dates="$(cert_dates "$domain" || true)"
      rows+=("$(custom_row "$tenant_id" "$domain" active "${dates#* }")")
    elif [[ -f "$STATE_DIR/$domain.failed" ]]; then
      rows+=("$(custom_row "$tenant_id" "$domain" error "" "$(cert_error "$STATE_DIR/$domain.log")")")
    else
      rows+=("$(custom_row "$tenant_id" "$domain" pending)")
    fi
  done < <(tail -n +2 <<<"$csv" | tr -d '"\r')

  # --- קובץ ה-nginx של הדומיינים המותאמים ---
  if ((${#hosts[@]} > 0)) || [[ -f "$CUSTOM_SITE_FILE" ]]; then
    local ctmp cbackup="" host
    ctmp="$(mktemp)"
    {
      echo "# נוצר אוטומטית ע\"י deploy/ssl/store-certs.sh — דומיינים מותאמים של חנויות. לא לערוך ידנית"
      echo "# דומיינים: ${#hosts[@]}"
      for host in "${hosts[@]}"; do custom_block "$host"; done
    } >"$ctmp"
    if [[ -f "$CUSTOM_SITE_FILE" ]] && cmp -s "$ctmp" "$CUSTOM_SITE_FILE" && [[ -L "$CUSTOM_SITE_LINK" ]]; then
      rm -f -- "$ctmp"
    else
      if [[ -f "$CUSTOM_SITE_FILE" ]]; then
        cbackup="$STATE_DIR/$CUSTOM_SITE_NAME.previous"
        cp "$CUSTOM_SITE_FILE" "$cbackup"
      fi
      install -m 0644 "$ctmp" "$CUSTOM_SITE_FILE"
      rm -f -- "$ctmp"
      ln -sfn "$CUSTOM_SITE_FILE" "$CUSTOM_SITE_LINK"
      if nginx -t >/dev/null 2>"$STATE_DIR/nginx-test-custom.log"; then
        systemctl reload nginx
        log "✓ nginx עודכן — ${#hosts[@]} דומיינים מותאמים"
      else
        if [[ -n "$cbackup" ]]; then
          cp "$cbackup" "$CUSTOM_SITE_FILE"
        else
          rm -f -- "$CUSTOM_SITE_LINK" "$CUSTOM_SITE_FILE"
        fi
        log "✗ בדיקת nginx לדומיינים המותאמים נכשלה — הוחזרה ההגדרה הקודמת. פרטים: $STATE_DIR/nginx-test-custom.log"
        return 1
      fi
    fi
  fi

  # --- דומיין שהוסר מהחנות: התעודה שלו נמחקת (אחרי שיצא מ-nginx) ---
  local old
  if [[ -f "$CUSTOM_LIST" ]]; then
    while IFS= read -r old; do
      [[ -z "$old" || ! "$old" =~ $DOMAIN_RE ]] && continue
      printf '%s\n' "${hosts[@]}" | grep -qxF -- "$old" && continue
      if is_ours "$old"; then
        if certbot delete --cert-name "$old" --non-interactive >"$STATE_DIR/$old.delete.log" 2>&1; then
          log "✓ התעודה של $old נמחקה (הדומיין הוסר מהחנות)"
        else
          log_once "delete-$old" "✗ מחיקת התעודה של $old נכשלה — פרטים: $STATE_DIR/$old.delete.log"
          continue
        fi
      fi
      rm -f -- "${STATE_DIR:?}/${old:?}".* "${STATE_DIR:?}/notes/"*"-${old:?}"
    done <"$CUSTOM_LIST"
  fi
  printf '%s\n' "${hosts[@]}" | grep -v '^$' >"$CUSTOM_LIST" || true

  # --- דיווח למסד (מה שמנהל החנות רואה בפאנל) ---
  if ((${#rows[@]} > 0)); then
    rpc -o /dev/null -d "{\"_rows\":[$(
      IFS=,
      echo "${rows[*]}"
    )]}" "$KONG_URL/rest/v1/rpc/custom_domain_report" || log "✗ הדיווח על הדומיינים המותאמים נכשל"
  fi
  return 0
}

# תקלה בדומיינים המותאמים לא עוצרת את הטיפול בתתי-הדומיין
sync_custom_domains || log "✗ הטיפול בדומיינים המותאמים נכשל בריצה הזו (ניסיון חוזר בעוד דקה)"

# ------------------------------------------------------------
# 3. קובץ ה-nginx של החנויות
# ------------------------------------------------------------
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

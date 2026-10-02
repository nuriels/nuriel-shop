#!/usr/bin/env bash
# ============================================================
# התקנת SSL אוטומטי לחנויות בתת-דומיין — מריצים פעם אחת בשרת:
#   bash /root/nuriel-shop-git/deploy/ssl/install-store-certs.sh
# דרישה מוקדמת: רשומת DNS כללית  *.nuri1.fit → IP של השרת.
# מה זה עושה:
#   1. תיקיית אימות ל-Let's Encrypt (/var/www/nuriel-acme)
#   2. snippet משותף של הפרוקסי לקונטיינר (127.0.0.1:3700)
#   3. בלוק nginx כללי לפורט 80: *.nuri1.fit → האפליקציה + קבצי אימות.
#      שמות שמוגדרים בבלוק משלהם (nuriel, nuriel-shop, api-nuriel, kobi…)
#      ממשיכים ללכת לבלוק שלהם — ב-nginx שם מדויק תמיד גובר על כללי.
#   4. systemd timer שמריץ את store-certs.sh כל דקה
#   5. הרצה ראשונה עכשיו
# בטוח להרצה חוזרת.
# ============================================================
set -Eeuo pipefail
trap 'echo -e "\033[1;31m✗ ההתקנה נעצרה בשורה ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/store-certs.sh"
ENV_FILE="$APP_DIR/.env"
WEBROOT=/var/www/nuriel-acme
WILDCARD_SITE=nuriel-stores-wildcard
PROXY_SNIPPET=/etc/nginx/snippets/nuriel-app-proxy.conf

fail() { echo -e "\033[1;31m✗ $*\033[0m" >&2; exit 1; }
ok() { echo "  ✓ $*"; }

[[ $EUID -eq 0 ]] || fail "יש להריץ כ-root"
[[ -f "$SYNC_SCRIPT" ]] || fail "לא נמצא $SYNC_SCRIPT — קודם git pull"
[[ -f "$ENV_FILE" ]] || fail "לא נמצא $ENV_FILE"
command -v nginx >/dev/null || fail "nginx לא מותקן"
command -v certbot >/dev/null || fail "certbot לא מותקן"

env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r'; }
BASE_DOMAIN="$(env_get TENANT_BASE_DOMAIN)"
APP_PORT="$(grep -oE '127\.0\.0\.1:[0-9]+:3000' "$APP_DIR/docker-compose.override.yml" 2>/dev/null | head -n 1 | cut -d: -f2)"
APP_PORT="${APP_PORT:-3700}"
[[ -n "$BASE_DOMAIN" ]] || fail "TENANT_BASE_DOMAIN ריק ב-$ENV_FILE"

echo "▶ 1. בדיקות מקדימות (*.${BASE_DOMAIN}, אפליקציה על 127.0.0.1:${APP_PORT})"
server_ip="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
probe="dns-check-$RANDOM.$BASE_DOMAIN"
probe_ip="$(getent ahostsv4 "$probe" | awk 'NR == 1 { print $1 }')"
[[ -n "$probe_ip" ]] || fail "רשומת ה-DNS *.$BASE_DOMAIN עדיין לא פעילה ($probe לא קיים) — לחכות כמה דקות ולהריץ שוב"
ok "*.$BASE_DOMAIN → $probe_ip"
if [[ -n "$server_ip" && "$probe_ip" != "$server_ip" ]]; then
  echo -e "\033[1;33m  ⚠ כתובת השרת כלפי חוץ היא $server_ip — לוודא ש-$probe_ip היא אכן כתובת השרת הזה\033[0m"
fi

# אסור שבלוק אחר כבר יתפוס את כל תתי-הדומיין (שני בלוקים כלליים מתנגשים)
other_wildcard="$(nginx -T 2>/dev/null | awk -v own="$WILDCARD_SITE" '
  /^# configuration file / { file = $4; next }
  index(file, own) == 0 && $1 == "server_name" { print file ": " $0 }' |
  grep -E "[[:space:]](\*\.|\.)${BASE_DOMAIN//./\\.}([[:space:];]|$)" || true)"
[[ -z "$other_wildcard" ]] || fail "יש כבר בלוק nginx כללי ל-*.$BASE_DOMAIN:
$other_wildcard"
# (בלי הקבצים של החנויות עצמן — nuriel-stores-*)
existing="$(nginx -T 2>/dev/null | awk '
  /^# configuration file / { file = $4; next }
  index(file, "nuriel-stores-") == 0 && $1 == "server_name" {
    for (i = 2; i <= NF; i++) { if ($i ~ /^#/) break; gsub(/;/, "", $i); print $i }
  }' |
  grep -E "^[a-z0-9.-]+\.${BASE_DOMAIN//./\\.}$" | sort -u | tr '\n' ' ' || true)"
ok "אתרים קיימים שנשארים בדיוק כמו שהם: ${existing:-אין}"
curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:${APP_PORT}/robots.txt" ||
  fail "האפליקציה לא עונה על 127.0.0.1:${APP_PORT}"
ok "האפליקציה עונה"

echo "▶ 2. תיקיית אימות + snippet של הפרוקסי"
mkdir -p "$WEBROOT/.well-known/acme-challenge"
chmod 755 "$WEBROOT" "$WEBROOT/.well-known" "$WEBROOT/.well-known/acme-challenge"
mkdir -p "$(dirname "$PROXY_SNIPPET")"
cat >"$PROXY_SNIPPET" <<EOF
# נוצר ע"י deploy/ssl/install-store-certs.sh — פרוקסי לקונטיינר nuriel-shop-app
# תמונות מוצר מועלות עד 20MB לקובץ, עם מרווח לאצוות
client_max_body_size 25m;

location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    # האפליקציה מזהה את החנות לפי הכותרת הזו — דורסים כל ערך שהגיע מהדפדפן
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
EOF
ok "$WEBROOT"
ok "$PROXY_SNIPPET"

echo "▶ 3. בלוק nginx כללי לפורט 80 (*.${BASE_DOMAIN})"
# IPv6 רק אם השרת תומך בו (אחרת nginx לא עולה)
listen6=""
[[ -f /proc/net/if_inet6 ]] && listen6="    listen [::]:80;"
cat >"/etc/nginx/sites-available/$WILDCARD_SITE" <<EOF
# נוצר ע"י deploy/ssl/install-store-certs.sh
# כל תת-דומיין של ${BASE_DOMAIN} שאין לו בלוק משלו. חנות חדשה מקבלת כאן
# את אימות Let's Encrypt, ועד שהתעודה שלה מוכנה (כדקה) — האתר ב-http.
# תת-דומיין שאינו חנות — האפליקציה מחזירה "החנות לא נמצאה".
server {
    listen 80;
${listen6}
    server_name *.${BASE_DOMAIN};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type text/plain;
    }

    include ${PROXY_SNIPPET};
}
EOF
ln -sfn "/etc/nginx/sites-available/$WILDCARD_SITE" "/etc/nginx/sites-enabled/$WILDCARD_SITE"
if ! nginx -t 2>/tmp/nuriel-nginx-test.log; then
  rm -f "/etc/nginx/sites-enabled/$WILDCARD_SITE"
  cat /tmp/nuriel-nginx-test.log >&2
  fail "בדיקת nginx נכשלה — הבלוק הוסר, שום דבר לא השתנה"
fi
systemctl reload nginx
ok "nginx עודכן"

# בדיקה: קובץ אימות נגיש דרך תת-דומיין אקראי.
# reload של nginx נטען ברקע — נותנים לו עד 10 שניות לפני שקובעים שנכשל
token="check-$RANDOM$RANDOM"
token_file="$WEBROOT/.well-known/acme-challenge/$token"
token_url="http://127.0.0.1/.well-known/acme-challenge/$token"
echo "$token" >"$token_file"
chmod 644 "$token_file"
got=""
for _ in $(seq 1 20); do
  got="$(curl -sS --max-time 5 -H "Host: $probe" "$token_url" 2>/dev/null || true)"
  [[ "$got" == "$token" ]] && break
  sleep 0.5
done
if [[ "$got" != "$token" ]]; then
  echo "  התשובה שהתקבלה מ-nginx עבור $probe:" >&2
  curl -sS -i --max-time 5 -H "Host: $probe" "$token_url" 2>&1 | head -n 15 | sed 's/^/    /' >&2 || true
  rm -f "$token_file"
  fail "קובץ האימות לא נגיש דרך $probe (בלוק ה-nginx נשאר, ההתקנה לא הושלמה — שלחו את הפלט)"
fi
rm -f "$token_file"
ok "אימות Let's Encrypt נגיש דרך תתי-הדומיין"

echo "▶ 4. systemd timer (כל דקה)"
cat >/etc/systemd/system/nuriel-store-certs.service <<EOF
[Unit]
Description=nuriel-shop: SSL certificates for store subdomains
After=network-online.target nginx.service docker.service

[Service]
Type=oneshot
ExecStart=/bin/bash ${SYNC_SCRIPT}
EOF
cat >/etc/systemd/system/nuriel-store-certs.timer <<EOF
[Unit]
Description=nuriel-shop: SSL certificates for new stores (every minute)

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now nuriel-store-certs.timer >/dev/null 2>&1
ok "nuriel-store-certs.timer פעיל"

echo "▶ 5. הרצה ראשונה (תעודות לחנויות הקיימות)"
systemctl start nuriel-store-certs.service || true
journalctl -u nuriel-store-certs.service --since "-2min" --no-pager -o cat | grep '\[store-certs\]' || echo "  (אין חנויות חדשות שצריכות תעודה)"

echo
echo "הסתיים! ✅"
echo "  לוג:     journalctl -u nuriel-store-certs -f"
echo "  תעודות:  certbot certificates"

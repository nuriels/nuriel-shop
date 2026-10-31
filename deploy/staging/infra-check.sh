#!/usr/bin/env bash
# ============================================================
# בדיקת תשתית לקריאה בלבד — לפני תכנון Staging (docs/hospitality/staging-plan.md)
#
# לא משנה כלום: לא מתקין, לא כותב קבצים, לא נוגע ב-DNS / Nginx / Coolify / Docker.
# מדפיס רק שמות, פורטים, גדלים ושמות דומיין — לא קבצי .env, לא מפתחות, לא קונפיגורציה
# מלאה. כדאי להריץ עם sudo (כדי לראות איזה תהליך מאזין לכל פורט ואת הגדרות Nginx).
#
#   sudo bash deploy/staging/infra-check.sh | tee /tmp/infra-check.txt
# ============================================================
set -u
section() { printf '\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

section "1. מי מקבל את התעבורה (80 / 443)"
ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || echo "ss not available"
if have systemctl; then
  echo "nginx service: $(systemctl is-active nginx 2>/dev/null || echo 'not installed')"
fi
if have docker; then
  echo "proxy-like containers:"
  docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}' | grep -Ei 'coolify|traefik|caddy|nginx|proxy' || echo "  (none)"
fi
[ -d /data/coolify ] && echo "Coolify data directory: present (/data/coolify)" || echo "Coolify data directory: not found"

section "2. זיכרון (RAM)"
free -h
free -b | awk '/^Mem:/ {printf "total_GiB=%.1f used_GiB=%.1f available_GiB=%.1f\n", $2/2^30, $3/2^30, $7/2^30}'
free -b | awk '/^Swap:/ {printf "swap_total_GiB=%.1f swap_used_GiB=%.1f\n", $2/2^30, $3/2^30}'

section "3. דיסק"
df -h / /var/lib/docker /data /root 2>/dev/null | awk 'NR == 1 || !seen[$1]++'
have docker && docker system df 2>/dev/null

section "4. פורטים בשימוש (מאזינים)"
ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ' '
echo
echo "with process (needs sudo):"
ss -ltnpH 2>/dev/null | awk '{print "  " $4 "  " $6}' | sort -u

section "5. דומיינים ו-proxy קיימים"
if have nginx; then
  echo "nginx server_name entries:"
  nginx -T 2>/dev/null | grep -E '^\s*server_name' | sed 's/^\s*server_name\s*//; s/;//' | tr ' ' '\n' | grep -v '^$' | sort -u | sed 's/^/  /'
fi
if [ -d /data/coolify/proxy/dynamic ]; then
  echo "Coolify proxy dynamic config files (names only):"
  ls -1 /data/coolify/proxy/dynamic 2>/dev/null | sed 's/^/  /'
fi
if have docker; then
  echo "container Host rules (Traefik / Coolify labels):"
  docker ps --format '{{.Names}}' | while read -r n; do
    docker inspect -f '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}' "$n" 2>/dev/null \
      | grep -E '\.rule=' | grep -oE 'Host(Regexp)?\(`[^`]+`\)' | sed "s/^/  $n: /"
  done
fi
echo "TLS certificates (Let's Encrypt, names only):"
ls -1 /etc/letsencrypt/live 2>/dev/null | grep -v README | sed 's/^/  /' || echo "  (none found)"

section "6. סטאקים וקונטיינרים קיימים (שמות בלבד)"
if have docker; then
  docker compose ls 2>/dev/null || true
  docker ps --format '  {{.Names}}  ({{.Status}})' | sort
fi

section "7. השמות של Staging"
echo "server addresses: $(hostname -I 2>/dev/null)"
for h in stg.nuri1.fit api-stg.nuri1.fit demo.stg.nuri1.fit "zz-check-$RANDOM.nuri1.fit"; do
  r=$(getent ahostsv4 "$h" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
  echo "  $h → ${r:-no DNS record}"
done
echo "proposed staging ports (127.0.0.1):"
for p in 3800 8600 8645 5437; do
  if ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q .; then echo "  $p: IN USE"; else echo "  $p: free"; fi
done

section "8. סיכום"
avail=$(free -b | awk '/^Mem:/ {print $7}')
if [ "${avail:-0}" -ge $((4 * 2**30)) ]; then
  echo "RAM: at least 4 GiB available → Staging can fit (with memory limits on its containers)"
else
  echo "RAM: less than 4 GiB available → recommend a small separate VPS for Staging"
fi
echo "done — nothing was changed."

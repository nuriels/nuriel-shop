#!/usr/bin/env bash
# ===========================================================================================
# DEMO בלבד — בדיקות תקינות ואבטחה לשרת ה-DEMO של MAX/Hyp (docs/payment-gateways/DEMO-SERVER-GUIDE.md §9).
#
#   bash deploy/demo/demo-check.sh                  # C1–C10, שלב D6 (Hyp חייבת להיות חסומה)
#   bash deploy/demo/demo-check.sh --stage d7       # אחרי אישור D7: החסימה של Hyp כבר הוסרה
#   bash deploy/demo/demo-check.sh --proofs         # גם בדיקות ההוכחה של D6 (§9.2)
#
# קריאה בלבד:
#   • לא משנה כלום. ההוכחות במסד רצות בטרנזקציה שתמיד מבוטלת (ROLLBACK). ההוכחות של האפליקציה רצות
#     בקונטיינר זמני, בלי רשת, שנמחק בסוף.
#   • לא מדפיס אף סוד: את המפתחות בודקים בתוך הקונטיינר, ומודפסות רק התוצאות (ok / fail ושם הבדיקה).
#   • לא פונה ל-Hyp, ולא לשום שירות מחוץ לשרת.
# לפני כל בדיקה אחרת — עוצר (יציאה 2) אם זה שרת הייצור.
# יציאה: 0 = הכול עבר; 1 = בדיקה נכשלה; 2 = סירוב (ייצור / שימוש שגוי).
# הערכים למטה הם של שרת ה-DEMO; אפשר לעקוף במשתני סביבה (כך רצה הבדיקה המקומית, מול docker מדומה).
# ===========================================================================================
set -uo pipefail

PROJECT="${PROJECT:-nuriel-demo}"
APP_DIR="${APP_DIR:-/root/nuriel-demo-git}"
SB_DIR="${SB_DIR:-/root/nuriel-demo-supabase}"
APP="${APP:-$PROJECT-app}"
DB="${DB:-$PROJECT-db}"
SINK="${SINK:-$PROJECT-mailsink}"
APP_PORT="${APP_PORT:-3800}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/nuriel-demo.conf}"
NGINX_ACCESS_LOGS="${NGINX_ACCESS_LOGS:-/var/log/nginx/nuriel-demo.access.log /var/log/nginx/nuriel-demo-api.access.log}"
DEFAULT_SECRETS_CHECK="${DEFAULT_SECRETS_CHECK:-$APP_DIR/deploy/check-default-secrets.sh}"
PROOF_WAIT="${PROOF_WAIT:-40}"
PRODUCTION_PLATFORM_HOST="nuriel.nuri1.fit"
MIGRATION_208="20261128100000_online_payments_foundation.sql"

STAGE=d6
PROOFS=no
while (($#)); do
  case "$1" in
    --stage) STAGE="${2:-}"; shift 2 ;;
    --proofs) PROOFS=yes; shift ;;
    *) echo "usage: bash deploy/demo/demo-check.sh [--stage d6|d7] [--proofs]" >&2; exit 2 ;;
  esac
done
[[ "$STAGE" == d6 || "$STAGE" == d7 ]] || { echo "usage: --stage d6|d7" >&2; exit 2; }

FAILS=0
pass() { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; FAILS=$((FAILS + 1)); }
note() { printf '  · %s\n' "$*"; }
section() { printf '\n== %s\n' "$*"; }
lower_trim() { tr -d '[:space:]"'"'" | tr '[:upper:]' '[:lower:]'; }
psql_q() { docker exec "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -tAc "$1" 2>/dev/null; }

# ------------------------------------------------------------------ C1. זהות — לפני כל דבר אחר
section "C1 identity (stops here on a production server)"
prod_names=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -c '^nuriel-shop-' || true)
if [[ "${prod_names:-0}" != 0 ]]; then
  echo "  ✗ containers named nuriel-shop-* exist here — this looks like the PRODUCTION server. Nothing was checked."
  exit 2
fi
pah=$(docker exec "$APP" printenv PLATFORM_ADMIN_HOST 2>/dev/null | lower_trim)
if [[ -z "$pah" ]]; then
  echo "  ✗ cannot read PLATFORM_ADMIN_HOST from $APP (is the app container running?). Nothing was checked."
  exit 2
fi
if [[ "$pah" == "$PRODUCTION_PLATFORM_HOST" ]]; then
  echo "  ✗ PLATFORM_ADMIN_HOST is the production platform host — this is not a DEMO server. Nothing was checked."
  exit 2
fi
pass "no production container names; the platform host is not the production one"
penv=$(docker exec "$APP" printenv PAYMENTS_ENV 2>/dev/null | lower_trim)
if [[ "$penv" == demo ]]; then pass "PAYMENTS_ENV=demo in $APP"; else fail "PAYMENTS_ENV in $APP is '${penv:-empty}' (expected demo)"; fi

# ------------------------------------------------------------------ C2. קונטיינרים
section "C2 containers"
health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP" 2>/dev/null || echo missing)
if [[ "$health" == healthy ]]; then pass "$APP healthy"; else fail "$APP health: $health"; fi
for c in "$SINK" "$DB"; do
  running=$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || echo false)
  if [[ "$running" == true ]]; then pass "$c running"; else fail "$c not running"; fi
done
if docker exec "$DB" pg_isready -U postgres -q 2>/dev/null; then pass "database accepts connections"; else fail "database not ready"; fi

# ------------------------------------------------------------------ C3. פורטים
section "C3 published ports (only 127.0.0.1)"
open_ports=$(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -E '0\.0\.0\.0:|:::|\[::\]:' || true)
if [[ -z "$open_ports" ]]; then pass "no docker port is published on all interfaces"; else
  fail "docker ports published on all interfaces:"; printf '%s\n' "$open_ports" | sed 's/^/      /'
fi
if command -v ss >/dev/null 2>&1; then
  extra=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\*|\[::\]):' | grep -vE ':(22|80|443)$' | sort -u || true)
  if [[ -z "$extra" ]]; then pass "listeners on all interfaces: only 22 / 80 / 443"; else
    fail "other listeners on all interfaces:"; printf '%s\n' "$extra" | sed 's/^/      /'
  fi
else
  note "ss not available — listener check skipped"
fi

# ------------------------------------------------------------------ C4. סודות ברירת מחדל של הסטאק
section "C4 Supabase stack secrets are not the public defaults"
if [[ -f "$DEFAULT_SECRETS_CHECK" ]]; then
  if PROJECT="$PROJECT" bash "$DEFAULT_SECRETS_CHECK" "$SB_DIR/docker" >/dev/null 2>&1; then
    pass "no stack secret left at its default value"
  else
    fail "a stack secret is at its default value (run: PROJECT=$PROJECT bash $DEFAULT_SECRETS_CHECK $SB_DIR/docker)"
  fi
else
  fail "check script not found: $DEFAULT_SECRETS_CHECK"
fi

# ------------------------------------------------------------------ C5. הסביבה בתוך הקונטיינר — בלי להדפיס ערכים
section "C5 app environment (checked inside the container; only results are printed)"
env_report=$(docker exec -i "$APP" node - 2>/dev/null <<'NODE'
const e = process.env;
const v = (n) => (e[n] ?? "").trim();
const out = [];
const check = (ok, name) => out.push(`${ok ? "ok" : "fail"} ${name}`);
const roots = ["PAYMENTS_SECRETS_KEY", "PLATFORM_TERMINAL_SECRETS_KEY"];
const placeholder = /^(x+|0+|1+|changeme|change-me|placeholder|secret|test|demo|example|todo)$/i;
for (const r of roots) {
  check(v(r).length >= 32, `${r} set and at least 32 characters`);
  check(!placeholder.test(v(r)), `${r} is not a placeholder`);
}
check(v(roots[0]) !== v(roots[1]), "the two payment roots differ");
const others = Object.keys(e).filter((n) => !roots.includes(n) && /(KEY|SECRET|TOKEN|PASSWORD)/.test(n) && v(n));
for (const r of roots) check(!others.some((n) => v(n) === v(r)), `${r} is not reused by another secret`);
for (const n of ["MAX_PAY_TEST_URL", "GROW_SANDBOX_URL", "DNS_TEST_FIXTURES", "SITEMAP_TTL_MS"]) check(!(n in e), `${n} absent`);
check(/^http:\/\/[a-z0-9-]*mailsink(:\d+)?\/?$/.test(v("RESEND_API_URL")), "email goes to the DEMO mail sink");
check(v("RESEND_API_KEY") === "demo-mail-sink", "no real Resend key");
check(!v("GROW_SECRETS_KEY") && !v("GROW_API_URL"), "Grow off");
check(["", "on"].includes(v("PAYMENTS_JOBS").toLowerCase()), "payment jobs on");
console.log(out.join("\n"));
NODE
)
if [[ -z "$env_report" ]]; then fail "could not run the environment check inside $APP"; else
  while IFS= read -r line; do
    case "$line" in ok\ *) pass "${line#ok }" ;; fail\ *) fail "${line#fail }" ;; esac
  done <<<"$env_report"
fi

# ------------------------------------------------------------------ C6. חסימת Hyp
section "C6 Hyp block (stage $STAGE)"
resolved=$(docker exec "$APP" getent hosts pay.hyp.co.il 2>/dev/null | awk '{print $1}' | head -n 1)
if [[ "$resolved" == 127.0.0.1 ]]; then
  if [[ "$STAGE" == d6 ]]; then pass "pay.hyp.co.il is blocked inside $APP (D6)"; else fail "pay.hyp.co.il is still blocked (stage d7 expects the block removed)"; fi
else
  if [[ "$STAGE" == d6 ]]; then fail "pay.hyp.co.il is NOT blocked inside $APP — only allowed after a D7 approval"; else pass "the Hyp block was removed (D7 — runs against Hyp need approval each time)"; fi
fi

# ------------------------------------------------------------------ C7. בריאות
section "C7 health"
for p in /healthz /readyz; do
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$APP_PORT$p" 2>/dev/null || true)
  if [[ "$code" == 200 ]]; then pass "$p: 200"; else fail "$p: ${code:-no answer}"; fi
done

# ------------------------------------------------------------------ C8. Nginx
section "C8 Nginx (password, noindex, closed Studio, logs without query strings)"
probe() { # probe <host> <path> → HTTP status (https with SNI to this server; http before certbot)
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$1:443:127.0.0.1" "https://$1$2" 2>/dev/null || true)
  if [[ -z "$code" || "$code" == 000 ]]; then
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Host: $1" "http://127.0.0.1$2" 2>/dev/null || true)
  fi
  printf '%s' "${code:-000}"
}
headers_of() {
  curl -s -o /dev/null -D - -m 10 --resolve "$1:443:127.0.0.1" "https://$1$2" 2>/dev/null ||
    curl -s -o /dev/null -D - -m 10 -H "Host: $1" "http://127.0.0.1$2" 2>/dev/null || true
}
if [[ -f "$NGINX_SITE" ]]; then
  mapfile -t names < <(grep -E '^\s*server_name\s' "$NGINX_SITE" | sed -E 's/^\s*server_name\s+//; s/;.*$//')
  APP_HOSTS="${DEMO_APP_HOSTS:-${names[0]:-}}"
  API_HOST="${DEMO_API_HOST:-${names[1]:-}}"
  if [[ -z "$APP_HOSTS" || -z "$API_HOST" ]]; then fail "could not read the host names from $NGINX_SITE"; fi
  for h in $APP_HOSTS; do
    code=$(probe "$h" /)
    if [[ "$code" == 401 ]]; then pass "$h/ without a password: 401"; else fail "$h/ without a password: $code (expected 401)"; fi
  done
  first="${APP_HOSTS%% *}"
  if [[ -n "$first" ]]; then
    if headers_of "$first" / | grep -qi '^x-robots-tag: *noindex'; then pass "X-Robots-Tag: noindex"; else fail "no X-Robots-Tag: noindex on $first"; fi
    robots=$(curl -s -m 10 --resolve "$first:443:127.0.0.1" "https://$first/robots.txt" 2>/dev/null || curl -s -m 10 -H "Host: $first" "http://127.0.0.1/robots.txt" 2>/dev/null || true)
    if grep -q '^Disallow: /$' <<<"$robots"; then pass "robots.txt blocks everything"; else fail "robots.txt does not block everything"; fi
  fi
  if [[ -n "$API_HOST" ]]; then
    for p in / /project/default /pg/tables; do
      code=$(probe "$API_HOST" "$p")
      if [[ "$code" == 404 ]]; then pass "$API_HOST$p: 404 (closed)"; else fail "$API_HOST$p: $code (expected 404)"; fi
    done
  fi
  crit=$(grep -cE 'error_log\s+\S+\s+crit;' "$NGINX_SITE" || true)
  if [[ "$crit" == 2 ]]; then pass "error logs at crit (no full request lines)"; else fail "error_log at crit in $crit of 2 server blocks"; fi
else
  fail "Nginx site file not found: $NGINX_SITE"
fi
query_lines=0
for log in $NGINX_ACCESS_LOGS; do
  [[ -f "$log" ]] || continue
  n=$(grep -cE '"[A-Z]+ [^ "]*\?' "$log" || true)
  query_lines=$((query_lines + ${n:-0}))
done
if [[ "$query_lines" == 0 ]]; then pass "access logs: no request line with a query string"; else fail "access logs: $query_lines request lines with a query string"; fi

# ------------------------------------------------------------------ C9. המסד
section "C9 database"
if [[ "$(psql_q "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$MIGRATION_208')")" == t ]]; then
  pass "migration 208 recorded"
  marker=$(psql_q "SELECT coalesce(name, 'unset') FROM payments.environment")
  case "$marker" in
    demo) pass "database marked demo" ;;
    unset) note "database not marked yet (online payments off until it is marked demo — §8, approval)" ;;
    *) fail "database marker is '${marker:-unreadable}' (expected demo or unset)" ;;
  esac
  row=$(psql_q "SELECT concat_ws('|',
      (SELECT count(*) FROM payments.tenant_accounts WHERE mode <> 'test') + (SELECT count(*) FROM payments.platform_accounts WHERE mode <> 'test'),
      (SELECT count(*) FROM payments.tenant_accounts WHERE terminal_number IS NOT NULL AND terminal_number NOT LIKE '00100%')
        + (SELECT count(*) FROM payments.platform_accounts WHERE terminal_number IS NOT NULL AND terminal_number NOT LIKE '00100%'),
      (NOT has_schema_privilege('anon', 'payments', 'USAGE') AND NOT has_schema_privilege('authenticated', 'payments', 'USAGE')),
      (SELECT count(*) FROM pg_class WHERE relnamespace = 'payments'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity))")
  IFS='|' read -r not_test non_prefix closed no_rls <<<"$row"
  if [[ "$not_test" == 0 ]]; then pass "every terminal account is in test mode"; else fail "terminal accounts not in test mode: ${not_test:-?}"; fi
  if [[ "$non_prefix" == 0 ]]; then pass "every terminal number has the test prefix"; else fail "terminal numbers without the test prefix: ${non_prefix:-?}"; fi
  if [[ "$closed" == t ]]; then pass "the payments schema is closed to anon and authenticated"; else fail "the payments schema is open to an API role"; fi
  if [[ "$no_rls" == 0 ]]; then pass "RLS on every payments table"; else fail "payments tables without RLS: ${no_rls:-?}"; fi
else
  note "migration 208 not applied yet — online payments off (expected before §7)"
fi

# ------------------------------------------------------------------ C10. שרת הדמה למיילים
section "C10 mail sink stays inside docker"
sink_ports=$(docker port "$SINK" 2>/dev/null || true)
if [[ -z "$sink_ports" ]]; then pass "$SINK publishes no port"; else fail "$SINK publishes: $sink_ports"; fi

# ------------------------------------------------------------------ הוכחות D6 (§9.2)
if [[ "$PROOFS" == yes ]]; then
  section "D6 proofs (database: always rolled back; app: throwaway container without network)"
  db_refuses() { # db_refuses <name> <sql> → the statement must fail inside a transaction that is rolled back
    local out
    out=$(printf 'BEGIN;\n%s\nROLLBACK;\n' "$2" | docker exec -i "$DB" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 2>&1)
    if [[ $? -ne 0 ]] && grep -q 'ERROR' <<<"$out"; then pass "$1: refused"; else fail "$1: NOT refused"; fi
  }
  if [[ "$(psql_q "SELECT to_regclass('payments.environment') IS NOT NULL")" == t ]]; then
    db_refuses "marking the DEMO database production" "UPDATE payments.environment SET name = 'production' WHERE id;"
    db_accepts() { # db_accepts <name> <sql> → the statement must succeed inside a transaction that is rolled back
      local out
      out=$(printf 'BEGIN;\n%s\nROLLBACK;\n' "$2" | docker exec -i "$DB" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 2>&1)
      if [[ $? -eq 0 ]] && ! grep -q 'ERROR' <<<"$out"; then pass "$1: accepted (positive control)"; else fail "$1: refused — the proofs below would prove nothing"; fi
    }
    if [[ "$(psql_q "SELECT coalesce(name, 'unset') FROM payments.environment")" != demo ]]; then
      fail "the database is not marked demo yet — mark it first (§8), then run the proofs"
    else
      # a store that has no terminal account yet; every row is rolled back
      pick="FROM public.tenants t WHERE NOT t.is_default AND NOT EXISTS (SELECT 1 FROM payments.tenant_accounts a WHERE a.tenant_id = t.id) ORDER BY t.created_at LIMIT 1"
      db_accepts "a store test account with a 00100 terminal" "INSERT INTO payments.tenant_accounts (tenant_id, provider, mode, terminal_number) SELECT t.id, 'max', 'test', '0010000001' $pick; SELECT CASE WHEN EXISTS (SELECT 1 FROM payments.tenant_accounts WHERE terminal_number = '0010000001') THEN 1 ELSE 1 / 0 END;"
      db_refuses "a store terminal account in live mode" "INSERT INTO payments.tenant_accounts (tenant_id, provider, mode, terminal_number) SELECT t.id, 'max', 'live', '0010000001' $pick;"
      db_refuses "a store terminal number without the test prefix" "INSERT INTO payments.tenant_accounts (tenant_id, provider, mode, terminal_number) SELECT t.id, 'max', 'test', '1234567890' $pick;"
    fi
  else
    fail "migration 208 is not applied — the database proofs cannot run"
  fi
  img=$(docker inspect -f '{{.Config.Image}}' "$APP" 2>/dev/null || true)
  startup_line() { # startup_line <docker run -e …> → the app's "[payments] env=" line from a throwaway container
    local name="$PROJECT-proof-$$-$RANDOM" line="" i
    docker run -d --rm --name "$name" --network none --env-file "$APP_DIR/.env" \
      -e PAYMENTS_JOBS=off -e SEO_WORKER=off -e AI_RENEWAL_JOB=off "$@" "$img" >/dev/null 2>&1 || { printf ''; return; }
    for ((i = 0; i < PROOF_WAIT; i++)); do
      line=$(docker logs "$name" 2>&1 | grep -m1 -oE '\[payments\] env=[^ ]+ endpoint=[^ ]+ tenant=[^ ]+ platform=[^ ]+' || true)
      [[ -n "$line" ]] && break
      sleep 1
    done
    docker rm -f "$name" >/dev/null 2>&1 || true
    printf '%s' "$line"
  }
  if [[ -z "$img" ]]; then fail "cannot find the app image"; else
    l=$(startup_line -e PAYMENTS_ENV=demo)
    if [[ "$l" == "[payments] env=demo endpoint=hyp tenant=ready platform=ready" ]]; then pass "positive control: $l"; else fail "positive control: '${l:-no line}'"; fi
    l=$(startup_line -e PAYMENTS_ENV=production)
    if [[ "$l" == "[payments] env=off:host_mismatch "* ]]; then pass "PAYMENTS_ENV=production on a non-production host: payments off"; else fail "PAYMENTS_ENV=production: '${l:-no line}'"; fi
    l=$(startup_line -e PAYMENTS_ENV=demo -e MAX_PAY_TEST_URL=http://127.0.0.1:9/hyp/p/)
    if [[ "$l" == *" endpoint=hyp "* ]]; then pass "the mock-server override is ignored on a non-local host"; else fail "mock-server override: '${l:-no line}'"; fi
  fi
  note "production untouched: confirmed by you (no step of the guide runs on the production server)"
fi

echo
WITH=""; [[ "$PROOFS" == yes ]] && WITH=", with proofs"
if ((FAILS == 0)); then echo "DEMO CHECK OK — stage $STAGE$WITH"; exit 0; fi
echo "DEMO CHECK FAILED — $FAILS check(s) failed. Fix before continuing."
exit 1

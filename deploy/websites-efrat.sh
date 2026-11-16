#!/usr/bin/env bash
# ===========================================================================================
# האתר של אפרת בייצור — אחרי deploy/release-websites.sh. שלב אחד בכל פקודה, כל שלב חוזר על עצמו בבטחה:
#
#   bash deploy/websites-efrat.sh open-site   פתיחת האתר efrat (טיוטה, בלי בעלים, בלי פרסום) בשם מנהל הפלטפורמה
#   bash deploy/websites-efrat.sh tools       seroval (מה-build של האפליקציה) לסקריפטים — בלי התקנה על השרת
#   bash deploy/websites-efrat.sh fetch       94 קובצי המקור מ-efratadir.com + 6 מ-Git → בדיקת SHA-256 מול המניפסט
#   bash deploy/websites-efrat.sh import      העלאת 100 הקבצים לאחסון ושמירת הטיוטה (הסיסמה נשאלת, לא מוצגת)
#   bash deploy/websites-efrat.sh audit       בדיקת המדיה והתוכן: במסד, באחסון ובכתובות הציבוריות (קריאה בלבד)
#   bash deploy/websites-efrat.sh checks      בדיקת ה-Preview: לא מפורסם, noindex, robots, הניהול בלבד (קריאה בלבד)
#
# לא מפרסם, לא משנה DNS / nginx / דומיין, לא שולח הזמנה ולא מיילים, לא נוגע באתרים אחרים.
# הסקריפטים של Node רצים ב-node:22-slim (ה-image שעליו האפליקציה בנויה) — אין צורך ב-Node על השרת.
# ADMIN_EMAIL — האימייל של מנהל הפלטפורמה (חובה ל-open-site כשיש יותר ממנהל אחד, ול-import).
# import ‎--server-session — לחשבון בלי סיסמה (כניסה בקוד במייל): החיבור נוצר בשרת כמו בכניסת הקוד באפליקציה,
# בלי מייל ובלי סיסמה, ומנותק בסוף.
# ===========================================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/nuriel-shop-git}"
DB="${DB:-nuriel-shop-db}"
PORT="${PORT:-3700}"
SLUG="${SLUG:-efrat}"
NAME="${NAME:-אפרת אדיר}"
APP_IMAGE="${APP_IMAGE:-nuriel-shop-app-app:latest}"
NODE_IMAGE="${NODE_IMAGE:-}" # empty: node:22-slim if present, else the app image (Node 22 too); "host": the server's own node
DEPS_IMAGE="${DEPS_IMAGE:-nuriel-shop-websites-deps}"
TOOLS="$APP_DIR/.cache/websites-tools"
STEP="${1:-}"

say() { printf '%s\n' "$*"; }
ok() { say "  ✓ $*"; }
fail() {
  say "  ✗ $*"
  exit 1
}
psql_q() { docker exec "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -tAc "$1"; }
env_value() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r'; }
# node <args…> inside node:22-slim, the repository mounted at /w (read/write for .cache only in practice)
node_run() {
  if [[ "$NODE_IMAGE" == host ]]; then
    local kv=() a
    for a in "${NODE_ENV_ARGS[@]}"; do [[ "$a" == *=* ]] && kv+=("$a"); done
    env "${kv[@]}" NODE_PATH="$TOOLS/node_modules" node "$@"
    return
  fi
  local tty=()
  [[ -t 0 && -t 1 ]] && tty=(-it)
  docker run --rm "${tty[@]}" --user 0:0 --network host -v "$APP_DIR:/w" -w /w --entrypoint node \
    -e NODE_PATH=/w/.cache/websites-tools/node_modules "${NODE_ENV_ARGS[@]}" "$NODE_IMAGE" "$@"
}
if [[ -z "$NODE_IMAGE" ]]; then
  if docker image inspect node:22-slim >/dev/null 2>&1; then NODE_IMAGE=node:22-slim; else NODE_IMAGE="$APP_IMAGE"; fi
fi
NODE_ENV_ARGS=()
need_tools() { [[ -d "$TOOLS/node_modules/seroval" ]] || fail "run first: bash deploy/websites-efrat.sh tools"; }
site_id() { psql_q "SELECT id FROM public.tenants WHERE slug = '$SLUG' AND site_type = 'business_profile'"; }

cd "$APP_DIR"
BASE=$(env_value TENANT_BASE_DOMAIN)
[[ -n "$BASE" ]] || fail ".env has no TENANT_BASE_DOMAIN"
HOST="$SLUG.$BASE"

case "$STEP" in
  # ---------------------------------------------------------------- open-site
  open-site)
    say "== open the site $HOST (draft only — no owner, nothing published)"
    [[ "$(psql_q "SELECT to_regclass('business_profile.owner_invites') IS NOT NULL")" == t ]] ||
      fail "migration 198 is not applied — run deploy/release-websites.sh first"
    [[ "$(psql_q "SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_enabled'")" == t ]] ||
      fail "the Websites engine flag is off — run deploy/release-websites.sh first"
    if [[ -n "$(site_id)" ]]; then
      ok "the site $SLUG is already open (nothing changed)"
    else
      if [[ -n "${ADMIN_EMAIL:-}" ]]; then
        admin=$(psql_q "SELECT a.user_id FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id WHERE lower(u.email) = lower('${ADMIN_EMAIL//\'/}')")
      else
        [[ "$(psql_q "SELECT count(*) FROM public.platform_admins")" == 1 ]] || fail "more than one platform admin — set ADMIN_EMAIL=<your platform admin email>"
        admin=$(psql_q "SELECT user_id FROM public.platform_admins")
      fi
      [[ -n "$admin" ]] || fail "ADMIN_EMAIL is not a platform admin"
      out=$(printf '%s\n' "BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', '$admin', 'role', 'authenticated')::text, true);
SELECT public.platform_bp_open_site('$SLUG', '$NAME');
COMMIT;" | docker exec -i "$DB" psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1)
      say "  $(printf '%s' "$out" | grep -o '{.*}' | tail -n 1)"
    fi
    id=$(site_id)
    [[ -n "$id" ]] || fail "the site was not opened"
    [[ "$(psql_q "SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE tenant_id = '$id')
                     AND (SELECT live_version_id IS NULL FROM business_profile.sites WHERE tenant_id = '$id')
                     AND NOT coalesce((SELECT enabled FROM public.tenant_feature_flags WHERE tenant_id = '$id' AND key = 'business_profile_public'), false)")" == t ]] ||
      fail "the site is not in the expected state (an owner / a published version / public)"
    ok "site $SLUG ($id): open, no owner yet, nothing published, not public"
    [[ "$(psql_q "SELECT EXISTS (SELECT 1 FROM public.platform_audit_log WHERE tenant_id = '$id' AND action = 'bp_site_opened')
                     AND EXISTS (SELECT 1 FROM business_profile.audit_log WHERE tenant_id = '$id' AND action = 'site.opened')")" == t ]] ||
      fail "the opening is missing from the security log"
    ok "the opening is in the security log (platform + site)"
    say "NEXT: bash deploy/websites-efrat.sh tools"
    ;;

  # ---------------------------------------------------------------- tools
  tools)
    say "== tools: seroval from the app's own dependency build (no install on the server)"
    docker build -q --target deps -t "$DEPS_IMAGE" "$APP_DIR" >/dev/null
    cid=$(docker create "$DEPS_IMAGE")
    rm -rf "$TOOLS"
    mkdir -p "$TOOLS/node_modules"
    docker cp "$cid:/app/node_modules/seroval" "$TOOLS/node_modules/seroval" >/dev/null
    docker rm "$cid" >/dev/null
    v=$(node_run -e 'console.log(require("seroval/package.json").version)')
    ok "seroval $v ready in .cache/websites-tools (runs in $NODE_IMAGE)"
    say "NEXT: bash deploy/websites-efrat.sh fetch"
    ;;

  # ---------------------------------------------------------------- fetch
  fetch)
    say "== files: 94 originals from efratadir.com + 6 from Git → SHA-256 check against the tested set"
    node_run scripts/websites/fetch-efrat-originals.mjs .cache/efrat-faithful
    ok "100/100 files identical to the files tested in the test environment"
    say "NEXT: ADMIN_EMAIL=<your platform admin email> bash deploy/websites-efrat.sh import"
    ;;

  # ---------------------------------------------------------------- import
  import)
    need_tools
    [[ -n "${ADMIN_EMAIL:-}" ]] || fail "set ADMIN_EMAIL=<your platform admin email> (the password is asked, not shown)"
    [[ -n "$(site_id)" ]] || fail "the site $SLUG is not open — run: bash deploy/websites-efrat.sh open-site"
    say "== import into $HOST: the 100 files (uploads, as in the editor) + the draft — never published"
    NODE_ENV_ARGS=(-e "TARGET_ORIGIN=https://$HOST" -e "CONNECT_TO=127.0.0.1:$PORT" -e "EXPECT_SLUG=$SLUG"
      -e "SUPABASE_URL=$(env_value SUPABASE_URL)" -e "SUPABASE_PUBLISHABLE_KEY=$(env_value SUPABASE_PUBLISHABLE_KEY)"
      -e "EMAIL=$ADMIN_EMAIL" -e PASSWORD -e ASSETS_DIR=.cache/efrat-faithful)
    if [[ " ${*:2} " == *" --server-session "* ]]; then
      # an account without a password (email-code sign-in): a session made on the server, like the app's own
      # email-code login — only for a platform admin; the service key goes by environment (not argv), never printed
      [[ "$(psql_q "SELECT count(*) FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id WHERE lower(u.email) = lower('${ADMIN_EMAIL//\'/}')")" == 1 ]] ||
        fail "ADMIN_EMAIL is not a platform admin"
      SUPABASE_SERVICE_ROLE_KEY=$(env_value SUPABASE_SERVICE_ROLE_KEY)
      [[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]] || fail ".env has no SUPABASE_SERVICE_ROLE_KEY"
      export SUPABASE_SERVICE_ROLE_KEY
      NODE_ENV_ARGS+=(-e SUPABASE_SERVICE_ROLE_KEY)
    fi
    node_run scripts/websites/import-efrat-site.mjs "${@:2}"
    if [[ " ${*:2} " == *" --dry-run "* ]]; then
      ok "dry run only — nothing uploaded or saved"
      say "NEXT: the same command without --dry-run"
      exit 0
    fi
    id=$(site_id)
    [[ "$(psql_q "SELECT live_version_id IS NULL FROM business_profile.sites WHERE tenant_id = '$id'")" == t ]] || fail "the site has a published version"
    ok "draft saved; the site is still unpublished"
    say "NEXT: bash deploy/websites-efrat.sh audit"
    ;;

  # ---------------------------------------------------------------- audit
  audit)
    need_tools
    say "== audit (read only): every file in the library, in storage, identical to the tested file, loading from the public URL"
    mkdir -p .cache
    node_run scripts/websites/audit-efrat-media.mjs --slug "$SLUG" --print-sql | docker exec -i "$DB" psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 >.cache/efrat-audit-db.json
    NODE_ENV_ARGS=()
    node_run scripts/websites/audit-efrat-media.mjs --slug "$SLUG" --db-json .cache/efrat-audit-db.json \
      --supabase-url "$(env_value SUPABASE_URL)" --out .cache/efrat-media-audit.json
    ok "audit passed — full result: $APP_DIR/.cache/efrat-media-audit.json"
    say "NEXT: bash deploy/websites-efrat.sh checks"
    ;;

  # ---------------------------------------------------------------- checks
  checks)
    say "== preview checks on $HOST (read only)"
    fails=0
    probe() { # probe <path> <want code> <what must hold: noindex|robots|frame|-> …
      local path="$1" want="$2"
      shift 2
      local body head code
      body=$(mktemp)
      head=$(mktemp)
      code=$(curl -s -o "$body" -D "$head" -m 20 -w '%{http_code}' -H "Host: $HOST" -H "X-Forwarded-Host: $HOST" "http://127.0.0.1:$PORT$path") || true
      local good=yes
      [[ "$code" == "$want" ]] || good=no
      for c in "$@"; do
        case "$c" in
          noindex) grep -qi '^x-robots-tag: *noindex' "$head" || grep -q 'name="robots" content="noindex' "$body" || good=no ;;
          robots-closed) grep -q '^Disallow: /$' "$body" || good=no ;;
          frame) grep -qi '^x-frame-options: *SAMEORIGIN' "$head" || good=no ;;
        esac
      done
      if [[ "$good" == yes ]]; then ok "$path: $code ${*}"; else
        say "  ✗ $path: $code (wanted $want ${*})"
        fails=1
      fi
      rm -f "$body" "$head"
    }
    probe / 404 noindex
    probe /accessibility 404 noindex
    probe /sitemap.xml 404 noindex
    probe /robots.txt 200 robots-closed
    probe /studio 200 noindex frame
    probe /studio/preview 200 noindex frame
    probe /studio/invite 200 noindex frame
    id=$(site_id)
    [[ "$(psql_q "SELECT (SELECT live_version_id IS NULL FROM business_profile.sites WHERE tenant_id = '$id')
                     AND NOT coalesce((SELECT enabled FROM public.tenant_feature_flags WHERE tenant_id = '$id' AND key = 'business_profile_public'), false)
                     AND NOT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_public')")" == t ]] &&
      ok "database: no published version; public flags off (site + platform)" || {
      say "  ✗ the site or the platform is set public"
      fails=1
    }
    code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$HOST/robots.txt" || true)
    if [[ "$code" == 200 ]]; then ok "https://$HOST answers through nginx with a certificate"; else
      say "  · https://$HOST: ${code:-no answer} — the certificate agent (deploy/ssl/store-certs.sh, every minute) issues it for every site; check again in a few minutes"
    fi
    ((fails == 0)) || fail "a preview check failed"
    say "PREVIEW OK — https://$HOST/studio (sign in) · the panel: אתרי אינטרנט → אפרת אדיר → תצוגה מקדימה"
    ;;
  *)
    say "usage: bash deploy/websites-efrat.sh open-site|tools|fetch|import|audit|checks"
    exit 2
    ;;
esac

#!/usr/bin/env bash
# ===========================================================================================
# Release 207: crawl parity (the iStores comparison) + product brand / condition (migration 207) — one command,
# stops by itself.
#
#   bash release-crawl-parity.sh --check  <commit>            # read only — changes nothing
#   bash release-crawl-parity.sh --deploy <commit>            # backup → build → 207 → restart → checks
#   bash release-crawl-parity.sh --print-migration-sql <commit>   # the one-transaction SQL of 207 (read only)
#   bash release-crawl-parity.sh --print-rollback-sql  <commit>   # the one-transaction SQL of 207's rollback
#   bash release-crawl-parity.sh --rollback-db <commit>       # ⛔ only with approval, after the app rollback
#
# What it guarantees (the same phases as release 206, which ran in production):
#   • preflight: clean code folder, the commit is on origin, a fast-forward from what runs, the containers run,
#     206 migrations applied = every migration of the target except 207, the files of 207 and of its rollback have
#     the pinned fingerprints, free disk, the site answers; the full list of sites from the database (every store,
#     zimmer site and business site). --check stops here.
#   • backup: a database dump read back to the end, the applied list, the running code, an image tag to go back to,
#     the release files, the Nofi Dorit snapshot and the titles / descriptions of every site's home page.
#   • build while the site keeps running the previous version.
#   • 207 in ONE transaction (REPEATABLE READ — a single snapshot): gate (206 applied, 207 not) → the migration →
#     its registration → checks: whole rows of every business table identical inside the same snapshot
#     (deploy/crawl-parity/guard-tx.sql — a product row without the two new keys), the new columns empty, the rules
#     and permissions right. Anything wrong → the transaction is rolled back and NOTHING changed. lock_timeout 10s:
#     if the products table is busy, it gives up instead of blocking the site.
#   • restart → healthy → checks on EVERY active site: health, titles unchanged, Nofi Dorit unchanged, and what this
#     release changes as Google gets it (real 404, one 308, Product data without the store as brand, the
#     accessibility statement in the HTML, llms.txt of open zimmer / business sites). A failure after the restart puts
#     the previous image and code back automatically. The database is never rolled back automatically (the previous
#     version works with 207: two extra empty columns); its rollback is printed and runs only with approval.
#   • a second run continues: when 207 is already in (a stop after the migration), it skips the migration.
#
# Never reads or prints a secret: from .env only TENANT_BASE_DOMAIN and PLATFORM_ADMIN_HOST (host names).
# The values below are the server's; they can be overridden by environment variables (the local test does that).
# ===========================================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/nuriel-shop-git}"
DB="${DB:-nuriel-shop-db}"
APP="${APP:-nuriel-shop-app}"
IMAGE="${IMAGE:-nuriel-shop-app-app}"
PORT="${PORT:-3700}"
BRANCH="${BRANCH:-platform/crawl-parity}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/nuriel-shop}"
EXPECTED_BEFORE="${EXPECTED_BEFORE:-206}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"
WAIT_STEPS="${WAIT_STEPS:-36}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"
MIG=20261127100000_product_brand_condition
MIG_SHA="${MIG_SHA:-cedc6cf3dc7f33bffc11fe8b89a2e1354d0e42e3a839ded98fb47df1c08c973b}"
DOWN_SHA="${DOWN_SHA:-12429f083b9c434e62761a5cd0ddada89db90cdb2ef090470407aefda7ead230}"
LABEL=before-crawl-parity
GUARD_FILE=deploy/crawl-parity/guard-tx.sql
NOFI_FILE=deploy/seo-engine/nofi-snapshot.sql
# a product id that exists nowhere (the "real 404" check)
MISSING_PRODUCT=00000000-0000-4000-8000-0000000000ff
# this release's code must be in the new image (strings that survive the minifier)
BUNDLE_MARKS=(out-of-stock-help RefurbishedCondition store-seo-condition)

# what 207 leaves behind — true or false
POST_CHECK="(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'global_products'
       AND column_name IN ('brand', 'item_condition')) = 2
  AND NOT EXISTS (SELECT 1 FROM public.global_products WHERE brand IS NOT NULL OR item_condition IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.store_seo_proposals WHERE field IN ('brand', 'item_condition'))
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'global_products_brand_check')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'global_products_item_condition_check')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_seo_proposals_product_fields')
  AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'store_seo_proposals_field_check')) LIKE '%item_condition%'
  AND pg_get_functiondef('public.store_seo_snapshot(uuid,boolean,integer)'::regprocedure) LIKE '%facts%'
  AND NOT has_function_privilege('anon', 'public.store_seo_proposals_add(uuid,jsonb,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.store_seo_proposals_add(uuid,jsonb,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.store_seo_snapshot(uuid,boolean,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._store_seo_write(uuid,text,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.store_seo_proposal_decide(uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.store_seo_proposal_decide(uuid,text,text)', 'EXECUTE')"
# after the rollback: the columns, the product-only rule and the facts are gone; the field rule takes 3 fields again
ROLLBACK_CHECK="(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'global_products'
       AND column_name IN ('brand', 'item_condition')) = 0
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_seo_proposals_product_fields')
  AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'store_seo_proposals_field_check')) NOT LIKE '%brand%'
  AND pg_get_functiondef('public.store_seo_snapshot(uuid,boolean,integer)'::regprocedure) NOT LIKE '%facts%'"
# every site in the database (read only): kind, slug, status, products (stores)
SITES_LIST="SELECT coalesce(t.site_type, 'ecommerce') || ' ' || t.slug || ' ' || t.status
    || CASE WHEN coalesce(t.site_type, 'ecommerce') = 'ecommerce'
            THEN ' ' || (SELECT count(*) FROM public.global_products g WHERE g.tenant_id = t.id AND NOT g.is_hidden) || ' products'
            ELSE '' END
  FROM public.tenants t ORDER BY t.is_default DESC, coalesce(t.site_type, 'ecommerce'), t.slug"

MODE="${1:-}"
TARGET="${2:-}"
PHASE="preflight"
B=""
LOG=/dev/null
PREV_SHA=""
PREV_BRANCH=""
ROLLBACK_TAG=""
MIGRATED_NOW=no
TMPD=""

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
ok() { say "  ✓ $*"; }
psql_q() { docker exec "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -tAc "$1"; }
psql_file() { docker exec -i "$DB" psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1; }

usage() {
  echo "usage: bash release-crawl-parity.sh --check|--deploy|--print-migration-sql|--print-rollback-sql|--rollback-db <commit>" >&2
  exit 2
}

# the release's own files, from the target commit (never from the working tree)
release_file() { git -C "$APP_DIR" show "$TARGET_SHA:$1"; }

# the business data that no step may change — whole rows of every table a business owns ($GUARD_FILE: the 61 tables
# of release 206; a product row without the two new keys), one SELECT; compared inside the migration's own snapshot
guard_select() { release_file "$GUARD_FILE" | grep -v '^[[:space:]]*--' | sed 's/;[[:space:]]*$//'; }

# the file's body inside its transaction: everything after the line "BEGIN;", without the last line "COMMIT;"
tx_body() { sed -n '/^BEGIN;$/,$p' | sed '1d;$d'; }

# check that a release SQL file has the pinned fingerprint and one transaction: one "BEGIN;" line, ends "COMMIT;"
check_sql_file() { # check_sql_file <path in commit> <sha256>
  local text
  text=$(release_file "$1") || { say "  ✗ $1 is missing in the target"; return 1; }
  [[ "$(printf '%s\n' "$text" | sha256sum | cut -d' ' -f1)" == "$2" ]] || { say "  ✗ $1: fingerprint differs from the pinned one"; return 1; }
  [[ "$(printf '%s\n' "$text" | grep -c '^BEGIN;$')" == 1 && "$(printf '%s\n' "$text" | tail -n 1)" == "COMMIT;" ]] ||
    { say "  ✗ $1: not one transaction (BEGIN; … COMMIT;)"; return 1; }
}

migration_sql() { # 207 + its registration + every check, in one REPEATABLE READ transaction
  local guard
  guard=$(guard_select)
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _release_guard ON COMMIT DROP AS SELECT ($guard) AS customers;
DO \$g\$ BEGIN
  IF (SELECT count(*) FROM public._migrations_applied) <> $EXPECTED_BEFORE
     OR EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$MIG.sql') THEN
    RAISE EXCEPTION 'gate: expected $EXPECTED_BEFORE applied migrations and $MIG not applied - nothing changed';
  END IF;
END \$g\$;
SQL
  release_file "supabase/migrations/$MIG.sql" | tx_body
  cat <<SQL
INSERT INTO public._migrations_applied (filename) VALUES ('$MIG.sql');
DO \$g\$ BEGIN
  IF (SELECT customers FROM _release_guard) IS DISTINCT FROM ($guard) THEN
    RAISE EXCEPTION 'guard: the customers data would change - rolled back, nothing changed';
  END IF;
  IF NOT ($POST_CHECK AND (SELECT count(*) FROM public._migrations_applied) = $((EXPECTED_BEFORE + 1))) THEN
    RAISE EXCEPTION 'post-check: 207 did not leave what it should - rolled back, nothing changed';
  END IF;
END \$g\$;
COMMIT;
SQL
}

rollback_sql() { # 207's rollback + removing its registration + checks, in one REPEATABLE READ transaction
  local guard
  guard=$(guard_select)
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _release_guard ON COMMIT DROP AS SELECT ($guard) AS customers;
DO \$g\$ BEGIN
  IF (SELECT count(*) FROM public._migrations_applied) <> $((EXPECTED_BEFORE + 1))
     OR NOT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$MIG.sql') THEN
    RAISE EXCEPTION 'gate: expected $((EXPECTED_BEFORE + 1)) applied migrations including $MIG - nothing changed';
  END IF;
END \$g\$;
SQL
  release_file "supabase/rollbacks/$MIG.down.sql" | tx_body
  cat <<SQL
DELETE FROM public._migrations_applied WHERE filename = '$MIG.sql';
DO \$g\$ BEGIN
  IF (SELECT customers FROM _release_guard) IS DISTINCT FROM ($guard) THEN
    RAISE EXCEPTION 'guard: the customers data would change - rolled back, nothing changed';
  END IF;
  IF NOT ($ROLLBACK_CHECK AND (SELECT count(*) FROM public._migrations_applied) = $EXPECTED_BEFORE) THEN
    RAISE EXCEPTION 'post-check: the rollback did not leave the state of $EXPECTED_BEFORE - rolled back, nothing changed';
  END IF;
END \$g\$;
COMMIT;
SQL
}

# put the code and the image back to the version that was running (nothing restarts here)
restore_code_and_tag() {
  if [[ -n "$PREV_SHA" ]]; then
    if [[ -n "$PREV_BRANCH" ]]; then
      git -C "$APP_DIR" checkout -q -B "$PREV_BRANCH" "$PREV_SHA" || true
    else
      git -C "$APP_DIR" checkout -q "$PREV_SHA" || true
    fi
  fi
  if [[ -n "$ROLLBACK_TAG" ]]; then docker tag "$IMAGE:$ROLLBACK_TAG" "$IMAGE:latest" || true; fi
}

print_db_rollback() {
  [[ "$MIGRATED_NOW" == yes ]] || return 0
  say "  migration 207 stays in (the previous version works with it: two extra empty columns, extra proposal fields)."
  say "  its rollback, only with approval and only after the app runs the previous version:"
  say "    bash $0 --rollback-db $TARGET_SHA"
}

wait_healthy() { # wait_healthy <expected image id> → 0 when running that image and healthy
  local want="$1" i status running
  for ((i = 0; i < WAIT_STEPS; i++)); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$APP" 2>/dev/null || echo missing)
    running=$(docker inspect -f '{{.Image}}' "$APP" 2>/dev/null || echo none)
    if [[ "$running" == "$want" && "$status" == "healthy" ]]; then return 0; fi
    if [[ "$status" == "unhealthy" && "$running" == "$want" && $i -ge 6 ]]; then break; fi
    sleep "$WAIT_SECONDS"
  done
  say "  health: $status, running image ${running:0:19}, expected ${want:0:19}"
  return 1
}

env_host() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r'; }

# the hosts to check: "<kind> <host>" — the platform, then EVERY active site in the database: every store (not only
# the main one), every zimmer site, every business site (release 206 checked only the main store)
site_hosts() {
  local base platform
  base=$(env_host TENANT_BASE_DOMAIN)
  platform=$(env_host PLATFORM_ADMIN_HOST)
  [[ -n "$platform" ]] && echo "platform $platform"
  [[ -n "$base" ]] || return 0
  psql_q "SELECT CASE WHEN coalesce(site_type, 'ecommerce') = 'ecommerce' THEN 'store' ELSE site_type END || ' ' || slug
            FROM public.tenants WHERE status = 'active'
           ORDER BY is_default DESC, coalesce(site_type, 'ecommerce'), slug LIMIT 60" | while read -r kind slug; do
    [[ -n "$slug" ]] && echo "$kind $slug.$base"
  done
}

page() { # page <host> <path> → the HTML the server sends (as Google gets it: no JavaScript)
  curl -s -m 20 -H "Host: $1" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT$2" || true
}

# the title and the description of the zimmer home pages and of the store's home page
titles() {
  local kind host path
  site_hosts | while read -r kind host; do
    case "$kind" in hospitality) path=/stay ;; store) path=/ ;; *) continue ;; esac
    printf '%s%s\n' "$host" "$path"
    page "$host" "$path" | grep -aoE '<title>[^<]*</title>|<meta name="description" content="[^"]*"' | head -n 2
  done
}

health_checks() { # robots, liveness, readiness, every site answers below 500
  local code kind host path fails=0
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
  if [[ "$code" == 200 ]]; then ok "local robots.txt: 200"; else say "  ✗ local robots.txt: $code"; fails=1; fi
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/healthz") || true
  if [[ "$code" == 200 ]]; then ok "local /healthz: 200"; else say "  ✗ local /healthz: $code"; fails=1; fi
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/readyz") || true
  if [[ "$code" == 200 ]]; then ok "local /readyz (database): 200"; else say "  ✗ local /readyz (database): $code"; fails=1; fi
  while read -r kind host; do
    for path in / /manage/login /stay; do
      [[ "$path" != / && "$kind" != hospitality ]] && continue
      code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Host: $host" "http://127.0.0.1:$PORT$path") || true
      if [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then ok "$host$path: $code"; else say "  ✗ $host$path: $code"; fails=1; fi
    done
  done < <(site_hosts)
  return "$fails"
}

code_of() { # code_of <host> <path> → the status code (no redirect is followed)
  curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Host: $1" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT$2" || true
}
location_of() { # location_of <host> <path> → the Location header (relative or absolute)
  curl -s -o /dev/null -D - -m 15 -H "Host: $1" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT$2" |
    tr -d '\r' | sed -n 's/^[Ll]ocation: //p' | head -n 1 || true
}
text_after() { # text_after <html> <marker> → bytes of visible text after the marker (first 3000 bytes; any locale —
  # word counts are locale-dependent and miss Hebrew in a POSIX locale)
  local rest="${1#*"$2"}"
  [[ "$rest" == "$1" ]] && { echo 0; return; }
  printf '%s' "$rest" | LC_ALL=C head -c 3000 | LC_ALL=C sed 's/<[^>]*>//g' | LC_ALL=C tr -d '[:space:]' | LC_ALL=C wc -c | tr -d ' '
}

# what this release changes, as Google gets it (the HTML the server sends) — on every active site
release_checks() {
  local kind host html fails=0 links code loc product words
  while read -r kind host; do
    case "$kind" in
      hospitality)
        # only a site that is open and public: a closed / unpublished one answers 404 or a noindex gate page
        code=$(code_of "$host" /stay)
        if [[ "$code" != 200 ]]; then ok "$host/stay: $code — not open, nothing to check"; continue; fi
        html=$(page "$host" /stay)
        if grep -aqiE '<meta name="robots" content="[^"]*noindex' <<<"$html"; then ok "$host/stay: not public (noindex) — nothing to check"; continue; fi
        if grep -aq '"@type":"WebSite"' <<<"$html"; then ok "$host/stay: WebSite structured data (the site name for Google)"; else
          say "  ✗ $host/stay: no WebSite structured data"; fails=1; fi
        code=$(code_of "$host" /stay/); loc=$(location_of "$host" /stay/)
        if [[ "$code" == 308 && "$loc" == /stay ]]; then ok "$host/stay/: one 308 → /stay"; else
          say "  ✗ $host/stay/: $code → ${loc:-none} (expected 308 → /stay)"; fails=1; fi
        if page "$host" /llms.txt | head -n 1 | grep -aq '^# '; then ok "$host/llms.txt: the public summary (name, contact shown on the site, units, packages, documents)"; else
          say "  ✗ $host/llms.txt: no summary on an open site"; fails=1; fi
        ;;
      business_profile)
        code=$(code_of "$host" /)
        if [[ "$code" =~ ^30[178]$ ]]; then ok "$host/: $code — served on its own domain, nothing to check here"; continue; fi
        if [[ "$code" != 200 ]]; then ok "$host/: $code — not published, nothing to check"; continue; fi
        if page "$host" /llms.txt | head -n 1 | grep -aq '^# '; then ok "$host/llms.txt: the published version's summary"; else
          say "  ✗ $host/llms.txt: no summary on a published site"; fails=1; fi
        ;;
      store)
        html=$(page "$host" /)
        # a store in maintenance mode / locked shows only its gate screen (noindex) — nothing to check
        if grep -aqiE '<meta name="robots" content="[^"]*noindex' <<<"$html"; then ok "$host/: not public (noindex) — nothing to check"; continue; fi
        if page "$host" /sitemap.xml | grep -aq '?category='; then
          links=$(grep -aoE 'href="/\?category=[^"]+"' <<<"$html" | sort -u | wc -l)
          if ((links > 0)); then ok "$host/: $links categories are real links in the server HTML"; else
            say "  ✗ $host/: the sitemap has categories but the home page has no category link"; fails=1; fi
        else
          ok "$host/: no categories in the sitemap — nothing to link"
        fi
        if page "$host" /about | grep -aqE '<title>[^<]+ \| [^<]+</title>'; then ok "$host/about: \"page | store name\" title"; else
          say "  ✗ $host/about: the title is not \"page | store name\""; fails=1; fi
        # 207: a missing product is a real 404 (was 200 + noindex)
        code=$(code_of "$host" "/product/$MISSING_PRODUCT")
        if [[ "$code" == 404 ]]; then ok "$host/product/<missing>: 404 (a real not-found)"; else
          say "  ✗ $host/product/<missing>: $code (expected 404)"; fails=1; fi
        # 207: "/" at the end → one permanent 308 (was 307 from the router)
        code=$(code_of "$host" /about/); loc=$(location_of "$host" /about/)
        if [[ "$code" == 308 && "$loc" == /about ]]; then ok "$host/about/: one 308 → /about"; else
          say "  ✗ $host/about/: $code → ${loc:-none} (expected 308 → /about)"; fails=1; fi
        # 207: the accessibility statement is in the server HTML (it was "loading…")
        words=$(text_after "$(page "$host" /accessibility)" 'data-testid="accessibility-statement"')
        if ((words >= 150)); then ok "$host/accessibility: the statement is in the server HTML ($words bytes of text)"; else
          say "  ✗ $host/accessibility: the statement is not in the server HTML ($words bytes of text)"; fails=1; fi
        # 207: a product page — Product data, and the store's name is no longer every product's brand
        product=$(page "$host" /sitemap.xml | grep -aoE '/product/[0-9a-f-]{36}' | head -n 1 || true)
        if [[ -z "$product" ]]; then ok "$host: no product in the sitemap — nothing to check"; else
          html=$(page "$host" "$product")
          if ! grep -aq '"@type":"Product"' <<<"$html"; then say "  ✗ $host$product: no Product structured data"; fails=1
          elif grep -aq '"@type":"Brand"' <<<"$html"; then say "  ✗ $host$product: a brand before any owner set one (the old store-name brand?)"; fails=1
          else ok "$host$product: Product data, no store-name brand ($(grep -aoE 'href="/product/[0-9a-f-]{36}"' <<<"$html" | sort -u | wc -l) product links on the page)"; fi
        fi
        ;;
    esac
  done < <(site_hosts)
  return "$fails"
}

on_error() {
  local line="$1"
  trap - ERR
  say ""
  say "STOPPED — phase: $PHASE (line $line)"
  case "$PHASE" in
    preflight) say "  nothing was changed." ;;
    backup) say "  nothing was changed on the site or the database (only the backup folder: $B)." ;;
    build)
      restore_code_and_tag
      say "  the site still runs the previous version (${PREV_SHA:0:7}); code and image tag restored; the database untouched."
      ;;
    migration)
      restore_code_and_tag
      if [[ "$MIGRATED_NOW" == yes ]]; then
        say "  the site still runs the previous version (${PREV_SHA:0:7}). 207 was committed, but a check after the"
        say "  commit failed. Send me this output."
        print_db_rollback
      else
        say "  the site still runs the previous version (${PREV_SHA:0:7}); migration 207 was rolled back inside its"
        say "  transaction — the database is exactly as before. Send me this output."
      fi
      ;;
    restart | health)
      say "  automatic application rollback to ${PREV_SHA:0:7} ..."
      restore_code_and_tag
      (cd "$APP_DIR" && docker compose up -d >>"$LOG" 2>&1) || true
      local old
      old=$(docker image inspect -f '{{.Id}}' "$IMAGE:latest" 2>/dev/null || echo none)
      if wait_healthy "$old" && health_checks; then
        say "ROLLED BACK — the previous version runs again and answers."
      else
        say "ROLLBACK NEEDS ATTENTION — the previous image did not come back healthy. Send me this output."
      fi
      print_db_rollback
      ;;
  esac
  [[ -n "$B" ]] && say "  log: $B/deploy.log"
  exit 1
}
trap 'on_error $LINENO' ERR

case "$MODE" in
  --check | --deploy | --print-migration-sql | --print-rollback-sql | --rollback-db) ;;
  *) usage ;;
esac
[[ -n "$TARGET" ]] || usage
cd "$APP_DIR"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
git fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA=$(git rev-parse --verify -q "$TARGET^{commit}") || { say "  ✗ commit $TARGET not found after fetch"; false; }
git merge-base --is-ancestor "$TARGET_SHA" "origin/$BRANCH" || { say "  ✗ $TARGET is not on origin/$BRANCH"; false; }

if [[ "$MODE" == --print-migration-sql ]]; then
  check_sql_file "supabase/migrations/$MIG.sql" "$MIG_SHA" >&2
  migration_sql
  exit 0
fi
if [[ "$MODE" == --print-rollback-sql ]]; then
  check_sql_file "supabase/rollbacks/$MIG.down.sql" "$DOWN_SHA" >&2
  rollback_sql
  exit 0
fi

if [[ "$MODE" == --rollback-db ]]; then
  # ⛔ only with approval. The new version reads 207's columns, so the app must run the previous version first.
  PHASE=preflight
  say "== DB rollback of 207 (one transaction)"
  [[ "$(git rev-parse HEAD)" != "$TARGET_SHA" ]] && git merge-base --is-ancestor HEAD "$TARGET_SHA" ||
    { say "  ✗ the code folder is on the release (${TARGET_SHA:0:7}) — roll the app back first (see DEPLOY OK / the runbook)"; false; }
  [[ "$(docker inspect -f '{{.Image}}' "$APP")" == "$(docker image inspect -f '{{.Id}}' "$IMAGE:latest")" ]] ||
    { say "  ✗ the running app is not $IMAGE:latest — stop and check"; false; }
  ok "the app runs the previous version ($(git log --oneline -1 | cut -c1-60))"
  check_sql_file "supabase/rollbacks/$MIG.down.sql" "$DOWN_SHA"
  ok "rollback file: pinned fingerprint, one transaction"
  rollback_sql | psql_file >/dev/null || { say "  ✗ the rollback failed — rolled back inside its transaction, nothing changed"; false; }
  [[ "$(psql_q "SELECT ($ROLLBACK_CHECK) AND (SELECT count(*) FROM public._migrations_applied) = $EXPECTED_BEFORE")" == t ]] ||
    { say "  ✗ after the rollback: unexpected state"; false; }
  ok "207 rolled back: $EXPECTED_BEFORE migrations, the two columns and the product-only rule gone, the customers' data unchanged"
  trap - ERR
  say "DB ROLLBACK OK"
  exit 0
fi

# ------------------------------------------------------------------ 1. preflight (read only)
say "== 1/6 preflight (read only)"
test -z "$(git status --porcelain --untracked-files=no)" || { say "  ✗ the code folder has uncommitted changes"; false; }
ok "code folder clean"
PREV_SHA=$(git rev-parse HEAD)
PREV_BRANCH=$(git symbolic-ref --short -q HEAD || true)
git merge-base --is-ancestor "$PREV_SHA" "$TARGET_SHA" || { say "  ✗ ${PREV_SHA:0:7} → ${TARGET_SHA:0:7} is not a fast-forward"; false; }
ok "running ${PREV_SHA:0:7}${PREV_BRANCH:+ ($PREV_BRANCH)} → target ${TARGET_SHA:0:7} on origin/$BRANCH, fast-forward"
[[ "$(docker inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" == true ]] || { say "  ✗ database container $DB is not running"; false; }
[[ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" == true ]] || { say "  ✗ app container $APP is not running"; false; }
RUNNING_ID=$(docker inspect -f '{{.Image}}' "$APP")
[[ "$RUNNING_ID" == "$(docker image inspect -f '{{.Id}}' "$IMAGE:latest")" ]] || { say "  ✗ the running app is not $IMAGE:latest — stop and check"; false; }
ok "containers running; the app runs $IMAGE:latest"
check_sql_file "supabase/migrations/$MIG.sql" "$MIG_SHA"
check_sql_file "supabase/rollbacks/$MIG.down.sql" "$DOWN_SHA"
ok "207 and its rollback: in the target, pinned fingerprints, one transaction each"
psql_q "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort >"$TMPD/applied"
git ls-tree --name-only "$TARGET_SHA" supabase/migrations/ | sed 's#.*/##' | grep '\.sql$' | LC_ALL=C sort >"$TMPD/target"
n=$(grep -c . "$TMPD/applied" || true)
if grep -qx "$MIG.sql" "$TMPD/applied"; then
  # a previous run stopped after the migration: continue without it
  cmp -s "$TMPD/applied" "$TMPD/target" || { say "  ✗ 207 is applied but the applied list differs from the target's migrations"; false; }
  # a previous run: the owner may have approved a brand meanwhile — the structure only (not "all empty")
  [[ "$(psql_q "SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'global_products' AND column_name IN ('brand', 'item_condition')) = 2 AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_seo_proposals_product_fields')")" == t ]] ||
    { say "  ✗ 207 is applied but its structure is not there — stop and check"; false; }
  MIGRATION_STATE=done
  ok "applied: $n = every migration of the target; 207 already in (a previous run) and checked — it will be skipped"
else
  [[ "$n" == "$EXPECTED_BEFORE" ]] || { say "  ✗ applied migrations: $n (expected $EXPECTED_BEFORE)"; false; }
  grep -vx "$MIG.sql" "$TMPD/target" >"$TMPD/expected" || true
  if ! cmp -s "$TMPD/applied" "$TMPD/expected"; then
    say "  ✗ the applied list differs from the target's migrations (other than 207):"
    LC_ALL=C comm -3 "$TMPD/applied" "$TMPD/expected" | head -n 10 | sed 's/^/      /' | tee -a "$LOG"
    false
  fi
  MIGRATION_STATE=pending
  ok "applied: $n = every migration of the target except 207"
fi
for d in "$APP_DIR" "$(dirname "$BACKUP_ROOT")"; do
  free=$(df -Pk "$d" | awk 'NR == 2 { print int($4 / 1048576) }')
  ((free >= MIN_FREE_GB)) || { say "  ✗ free disk at $d: ${free} GB (need $MIN_FREE_GB)"; false; }
done
ok "free disk ≥ ${MIN_FREE_GB} GB"
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
[[ "$code" == 200 ]] || { say "  ✗ the site does not answer now (robots.txt: $code)"; false; }
ok "the site answers now (robots.txt: 200)"
say "  · every site in the database (kind slug status; products per store) — all of them are checked after the deploy:"
psql_q "$SITES_LIST" | sed 's/^/      /' | tee -a "$LOG"
if [[ "$MODE" == --check ]]; then
  say "PREFLIGHT OK — nothing was changed. To deploy: the same command with --deploy."
  exit 0
fi

# ------------------------------------------------------------------ 2. backup
PHASE=backup
STAMP=$(date -u +%Y%m%d-%H%M%S)
B="$BACKUP_ROOT/$LABEL-$STAMP"
i=1
while [[ -e "$B" ]]; do B="$BACKUP_ROOT/$LABEL-$STAMP-$i" && i=$((i + 1)); done # a second run in the same second
mkdir -p -m 700 "$BACKUP_ROOT"
mkdir -m 700 "$B"
LOG="$B/deploy.log"
say "== 2/6 backup → $B"
docker exec "$DB" pg_dump -U postgres -d postgres -Fc >"$B/db.dump"
docker exec -i "$DB" pg_restore -l <"$B/db.dump" >/dev/null
sha256sum "$B/db.dump" >"$B/db.dump.sha256"
ok "database dump written and read back to the end ($(du -h "$B/db.dump" | cut -f1))"
cp "$TMPD/applied" "$B/applied-before.txt"
printf '%s %s\n' "$PREV_SHA" "${PREV_BRANCH:-detached}" >"$B/previous-code.txt"
ROLLBACK_TAG=$(basename "$B")
docker tag "$IMAGE:latest" "$IMAGE:$ROLLBACK_TAG"
printf '%s\n' "$RUNNING_ID" >"$B/image-id.txt"
ok "rollback image $IMAGE:$ROLLBACK_TAG; previous code ${PREV_SHA:0:7} recorded"
mkdir "$B/release"
git archive "$TARGET_SHA" deploy/crawl-parity "$NOFI_FILE" "supabase/migrations/$MIG.sql" "supabase/rollbacks/$MIG.down.sql" | tar -x -C "$B/release"
ok "release files copied (207, its rollback, the guard and the Nofi Dorit snapshot)"
release_file "$NOFI_FILE" | psql_file >"$B/nofi-before.txt"
ok "Nofi Dorit snapshot: $(grep -c . "$B/nofi-before.txt") lines (signature, units, bridal package, jacuzzi note, site, signed documents)"
titles >"$B/titles-before.txt"
ok "titles and descriptions of $(grep -c '^[^<]' "$B/titles-before.txt" || true) home pages recorded (every store and zimmer site)"

# ------------------------------------------------------------------ 3. code + build (the site keeps running)
PHASE=build
say "== 3/6 code + build (the site keeps running ${PREV_SHA:0:7})"
git checkout -q -B "$BRANCH" "$TARGET_SHA"
ok "code: $(git log --oneline -1 | cut -c1-90)"
docker compose build >"$B/build.log" 2>&1 || { tail -n 30 "$B/build.log" | tee -a "$LOG"; false; }
NEW_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE:latest")
[[ "$NEW_ID" != "$RUNNING_ID" ]] || { say "  ✗ the build did not produce a new image"; false; }
for mark in "${BUNDLE_MARKS[@]}"; do
  marks=$(docker run --rm --entrypoint sh "$IMAGE:latest" -c "grep -rlF '$mark' /app/.output | wc -l")
  ((marks > 0)) || { say "  ✗ the new image does not contain $mark"; false; }
done
ok "build ok (new image ${NEW_ID:0:19}; this release's code in the bundle: ${BUNDLE_MARKS[*]})"

# ------------------------------------------------------------------ 4. migration 207 (one transaction)
PHASE=migration
say "== 4/6 migration 207 (one transaction: gate → migration → registration → checks)"
if [[ "$MIGRATION_STATE" == done ]]; then
  ok "207 already applied and checked (a previous run) — skipped"
else
  migration_sql >"$B/migration-207.sql"
  psql_file <"$B/migration-207.sql" >>"$LOG" 2>&1 || {
    tail -n 5 "$LOG" | sed 's/^/      /'
    say "  ✗ migration 207 did not go in — rolled back inside its transaction"
    false
  }
  MIGRATED_NOW=yes
  [[ "$(psql_q "SELECT ($POST_CHECK) AND (SELECT count(*) FROM public._migrations_applied) = $((EXPECTED_BEFORE + 1))")" == t ]] ||
    { say "  ✗ after the commit: the checks of 207 fail"; false; }
  ok "207 applied and registered; inside the same snapshot: every business table identical (a product without the two new keys);"
  ok "brand / condition empty on every product, no such proposal yet; server functions closed to guests and staff as before"
fi

# ------------------------------------------------------------------ 5. restart
PHASE=restart
say "== 5/6 restart on the new image"
docker compose up -d >>"$LOG" 2>&1
wait_healthy "$NEW_ID" || { say "  ✗ the new version did not become healthy"; false; }
ok "running the new image, healthy"

# ------------------------------------------------------------------ 6. checks
PHASE=health
say "== 6/6 checks"
health_checks || { say "  ✗ a health check failed"; false; }
release_file "$NOFI_FILE" | psql_file >"$B/nofi-after.txt"
diff "$B/nofi-before.txt" "$B/nofi-after.txt" >>"$LOG" || { say "  ✗ Nofi Dorit changed (see $B/nofi-before.txt / nofi-after.txt)"; false; }
ok "Nofi Dorit unchanged: signature, units and prices, the bridal package, the jacuzzi note (Moriah), site, documents"
titles >"$B/titles-after.txt"
diff "$B/titles-before.txt" "$B/titles-after.txt" >>"$LOG" || { say "  ✗ a title / description changed (see $B/titles-*.txt)"; false; }
ok "titles and descriptions of every home page unchanged"
release_checks || { say "  ✗ a check of this release failed"; false; }
workers=$(docker logs --since 5m "$APP" 2>&1 | grep -c '\[seo\] worker started' || true)
((workers > 0)) || { say "  ✗ the SEO worker did not start"; false; }
ok "SEO worker started"
errs=$(docker logs --since 5m "$APP" 2>&1 | grep -icE "fatal|unhandled" || true)
ok "log: ${errs:-0} fatal / unhandled lines in the last 5 minutes"
trap - ERR
say ""
say "DEPLOY OK — ${TARGET_SHA:0:7} runs; migration 207 in; backup: $B; rollback image: $IMAGE:$ROLLBACK_TAG"
say "App rollback (only if needed, with approval):"
say "  docker tag $IMAGE:$ROLLBACK_TAG $IMAGE:latest && git -C $APP_DIR checkout -q -B ${PREV_BRANCH:-previous} $PREV_SHA && (cd $APP_DIR && docker compose up -d)"
say "DB rollback of 207 (only after the app rollback, with approval): bash $0 --rollback-db $TARGET_SHA"

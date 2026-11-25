#!/usr/bin/env bash
# ===========================================================================================
# Release: SEO sitelinks engine + failed-email alerts (migration 206) — one command, stops by itself.
#
#   bash release-seo-sitelinks.sh --check  <commit>            # read only — changes nothing
#   bash release-seo-sitelinks.sh --deploy <commit>            # backup → build → 206 → restart → checks
#   bash release-seo-sitelinks.sh --print-migration-sql <commit>   # the one-transaction SQL of 206 (read only)
#   bash release-seo-sitelinks.sh --print-rollback-sql  <commit>   # the one-transaction SQL of 206's rollback
#   bash release-seo-sitelinks.sh --rollback-db <commit>       # ⛔ only with approval, after the app rollback
#
# What it guarantees:
#   • preflight: clean code folder, the commit is on origin, a fast-forward from what runs, the containers run,
#     205 migrations applied = every migration of the target except 206, the files of 206 and of its rollback have
#     the pinned fingerprints, free disk, the site answers. --check stops here.
#   • backup: a database dump read back to the end, the applied list, the running code, an image tag to go back to,
#     the release files, the Nofi Dorit snapshot and the titles / descriptions of the sites.
#   • build while the site keeps running the previous version.
#   • 206 in ONE transaction (REPEATABLE READ — a single snapshot): gate (205 applied, 206 not) → the migration →
#     its registration → checks: whole rows of every business table (deploy/seo-engine/guard-tx.sql) and the email
#     history are identical inside the same snapshot (so a guest booking at that second cannot fail the check), the
#     new columns are empty, the permissions are right. Anything wrong → the transaction is rolled back and NOTHING changed. lock_timeout 10s: if the emails
#     table is busy, it gives up instead of blocking the site.
#   • restart → healthy → checks (sites, titles, Nofi Dorit, the new structured data and links). A failure after the
#     restart puts the previous image and code back automatically. The database is never rolled back automatically
#     (the previous version works with 206); its rollback is printed and runs only with approval (--rollback-db).
#   • a second run continues: when 206 is already in (a stop after the migration), it skips the migration.
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
BRANCH="${BRANCH:-hospitality/seo-sitelinks-engine}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/nuriel-shop}"
EXPECTED_BEFORE="${EXPECTED_BEFORE:-205}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"
WAIT_STEPS="${WAIT_STEPS:-36}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"
MIG=20261125100000_hosp_email_alerts
MIG_SHA="${MIG_SHA:-9dac648b39c6f0a32a8da04ee773e845998c75e3c7b4b4d9604a2b8138e59ec4}"
DOWN_SHA="${DOWN_SHA:-57c927f6c1c881a08906b7bb0c9da6e11bdc7c87c687f959e2030ebf00cf165d}"
LABEL=before-seo-sitelinks
# this release's code must be in the new image (strings that survive the minifier)
BUNDLE_MARKS=(email_alerts_mark_all structure.home_links schema.website_missing)

# the email history (what 206 must never change): every row of the emails table, without the new alert columns
EMAILS_SUM="(SELECT md5(coalesce(string_agg(concat_ws(',', n.id, n.status, n.attempts, n.last_error, n.sent_at,
  n.recipient_email, n.booking_id, md5(n.payload::text)), ';' ORDER BY n.id), '')) FROM hospitality.notifications n)"
# what 206 leaves behind — true or false
POST_CHECK="(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'notifications'
       AND column_name IN ('alert_seen_at', 'alert_handled_at', 'alert_handled_by')) = 3
  AND NOT EXISTS (SELECT 1 FROM hospitality.notifications
       WHERE alert_seen_at IS NOT NULL OR alert_handled_at IS NOT NULL OR alert_handled_by IS NOT NULL)
  AND to_regclass('hospitality.notifications_open_alerts_idx') IS NOT NULL
  AND has_function_privilege('authenticated', 'hospitality.email_alerts_mark(uuid[],text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'hospitality.email_alerts_mark(uuid[],text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'hospitality.email_alerts_mark_all(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'hospitality.email_alerts_mark_all(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'hospitality._email_cancelled(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'hospitality.staff_emails(text,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'hospitality.dashboard_tasks()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'hospitality.requeue_notification(uuid)', 'EXECUTE')"
# after the rollback: the columns and the new functions are gone, the three functions are the old ones
ROLLBACK_CHECK="(SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'notifications'
       AND column_name LIKE 'alert\\_%') = 0
  AND to_regprocedure('hospitality.email_alerts_mark(uuid[],text)') IS NULL
  AND to_regprocedure('hospitality.email_alerts_mark_all(text)') IS NULL
  AND to_regprocedure('hospitality._email_cancelled(text,text)') IS NULL
  AND to_regclass('hospitality.notifications_open_alerts_idx') IS NULL
  AND has_function_privilege('authenticated', 'hospitality.staff_emails(text,integer)', 'EXECUTE')"
# open failed-email alerts per business (read only; before 206 every failed email is one)
ALERTS_BEFORE="SELECT t.slug || ': ' || count(*) FROM hospitality.notifications n JOIN public.tenants t ON t.id = n.tenant_id
  WHERE n.status IN ('failed', 'dead') GROUP BY t.slug ORDER BY t.slug"
ALERTS_AFTER="SELECT t.slug || ': ' || count(*) FILTER (WHERE NOT hospitality._email_cancelled(n.status, n.last_error))
  || ' open (cancelled on purpose: ' || count(*) FILTER (WHERE hospitality._email_cancelled(n.status, n.last_error)) || ')'
  FROM hospitality.notifications n JOIN public.tenants t ON t.id = n.tenant_id
  WHERE n.status IN ('failed', 'dead') AND n.alert_handled_at IS NULL GROUP BY t.slug ORDER BY t.slug"

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
  echo "usage: bash release-seo-sitelinks.sh --check|--deploy|--print-migration-sql|--print-rollback-sql|--rollback-db <commit>" >&2
  exit 2
}

# the release's own files, from the target commit (never from the working tree)
release_file() { git -C "$APP_DIR" show "$TARGET_SHA:$1"; }

# the business data that no step may change — whole rows of every table a business owns (deploy/seo-engine/guard-tx.sql:
# 61 tables — stores, billing, business sites, zimmer units / packages / policies / prices / bookings / payments /
# signature / site / documents …), one SELECT; compared inside the migration's own snapshot
guard_select() { release_file deploy/seo-engine/guard-tx.sql | grep -v '^[[:space:]]*--' | sed 's/;[[:space:]]*$//'; }

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

migration_sql() { # 206 + its registration + every check, in one REPEATABLE READ transaction
  local guard
  guard=$(guard_select)
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _release_guard ON COMMIT DROP AS SELECT ($guard) AS customers, $EMAILS_SUM AS emails;
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
  IF (SELECT emails FROM _release_guard) IS DISTINCT FROM $EMAILS_SUM THEN
    RAISE EXCEPTION 'guard: the email history would change - rolled back, nothing changed';
  END IF;
  IF NOT ($POST_CHECK AND (SELECT count(*) FROM public._migrations_applied) = $((EXPECTED_BEFORE + 1))) THEN
    RAISE EXCEPTION 'post-check: 206 did not leave what it should - rolled back, nothing changed';
  END IF;
END \$g\$;
COMMIT;
SQL
}

rollback_sql() { # 206's rollback + removing its registration + checks, in one REPEATABLE READ transaction
  local guard
  guard=$(guard_select)
  cat <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _release_guard ON COMMIT DROP AS SELECT ($guard) AS customers, $EMAILS_SUM AS emails;
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
  IF (SELECT emails FROM _release_guard) IS DISTINCT FROM $EMAILS_SUM THEN
    RAISE EXCEPTION 'guard: the email history would change - rolled back, nothing changed';
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
  say "  migration 206 stays in (the previous version works with it: the new columns and filters are extra)."
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

# the hosts to check: "<kind> <host>" — the platform, the main store, the zimmer sites, the business sites
site_hosts() {
  local base platform
  base=$(env_host TENANT_BASE_DOMAIN)
  platform=$(env_host PLATFORM_ADMIN_HOST)
  [[ -n "$platform" ]] && echo "platform $platform"
  [[ -n "$base" ]] || return 0
  psql_q "SELECT CASE WHEN is_default THEN 'store' ELSE coalesce(site_type, 'store') END || ' ' || slug FROM public.tenants
           WHERE is_default OR site_type IN ('hospitality', 'business_profile')
           ORDER BY is_default DESC, site_type, slug LIMIT 16" | while read -r kind slug; do
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

# what this release changes, as Google sees it (the HTML the server sends)
release_checks() {
  local kind host html fails=0 links code
  while read -r kind host; do
    case "$kind" in
      hospitality)
        # only a site that is open and public: a closed / unpublished one answers 404 or a noindex gate page
        code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Host: $host" -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/stay") || true
        if [[ "$code" != 200 ]]; then ok "$host/stay: $code — not open, nothing to check"; continue; fi
        html=$(page "$host" /stay)
        if grep -aqiE '<meta name="robots" content="[^"]*noindex' <<<"$html"; then ok "$host/stay: not public (noindex) — nothing to check"; continue; fi
        if grep -aq '"@type":"WebSite"' <<<"$html"; then ok "$host/stay: WebSite structured data (the site name for Google)"; else
          say "  ✗ $host/stay: no WebSite structured data"; fails=1; fi
        ;;
      store)
        html=$(page "$host" /)
        # a store in maintenance mode shows only the maintenance screen (noindex) — nothing to check
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
        say "  the site still runs the previous version (${PREV_SHA:0:7}). 206 was committed, but a check after the"
        say "  commit failed. Send me this output."
        print_db_rollback
      else
        say "  the site still runs the previous version (${PREV_SHA:0:7}); migration 206 was rolled back inside its"
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
  # ⛔ only with approval. The new version uses 206's functions, so the app must run the previous version first.
  PHASE=preflight
  say "== DB rollback of 206 (one transaction)"
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
  ok "206 rolled back: $EXPECTED_BEFORE migrations, the alert columns and functions gone, the emails and customers' data unchanged"
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
ok "206 and its rollback: in the target, pinned fingerprints, one transaction each"
psql_q "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort >"$TMPD/applied"
git ls-tree --name-only "$TARGET_SHA" supabase/migrations/ | sed 's#.*/##' | grep '\.sql$' | LC_ALL=C sort >"$TMPD/target"
n=$(grep -c . "$TMPD/applied" || true)
if grep -qx "$MIG.sql" "$TMPD/applied"; then
  # a previous run stopped after the migration: continue without it
  cmp -s "$TMPD/applied" "$TMPD/target" || { say "  ✗ 206 is applied but the applied list differs from the target's migrations"; false; }
  [[ "$(psql_q "SELECT $POST_CHECK")" == t ]] || { say "  ✗ 206 is applied but its checks fail — stop and check"; false; }
  MIGRATION_STATE=done
  ok "applied: $n = every migration of the target; 206 already in (a previous run) and checked — it will be skipped"
else
  [[ "$n" == "$EXPECTED_BEFORE" ]] || { say "  ✗ applied migrations: $n (expected $EXPECTED_BEFORE)"; false; }
  grep -vx "$MIG.sql" "$TMPD/target" >"$TMPD/expected" || true
  if ! cmp -s "$TMPD/applied" "$TMPD/expected"; then
    say "  ✗ the applied list differs from the target's migrations (other than 206):"
    LC_ALL=C comm -3 "$TMPD/applied" "$TMPD/expected" | head -n 10 | sed 's/^/      /' | tee -a "$LOG"
    false
  fi
  MIGRATION_STATE=pending
  ok "applied: $n = every migration of the target except 206"
fi
for d in "$APP_DIR" "$(dirname "$BACKUP_ROOT")"; do
  free=$(df -Pk "$d" | awk 'NR == 2 { print int($4 / 1048576) }')
  ((free >= MIN_FREE_GB)) || { say "  ✗ free disk at $d: ${free} GB (need $MIN_FREE_GB)"; false; }
done
ok "free disk ≥ ${MIN_FREE_GB} GB"
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
[[ "$code" == 200 ]] || { say "  ✗ the site does not answer now (robots.txt: $code)"; false; }
ok "the site answers now (robots.txt: 200)"
say "  · failed-email alerts per business now (read only):"
if [[ "$MIGRATION_STATE" == done ]]; then psql_q "$ALERTS_AFTER"; else psql_q "$ALERTS_BEFORE"; fi | sed 's/^/      /' | tee -a "$LOG"
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
git archive "$TARGET_SHA" deploy/seo-engine "supabase/migrations/$MIG.sql" "supabase/rollbacks/$MIG.down.sql" | tar -x -C "$B/release"
ok "release files copied (206, its rollback, the guard and the Nofi Dorit snapshot)"
release_file deploy/seo-engine/nofi-snapshot.sql | psql_file >"$B/nofi-before.txt"
ok "Nofi Dorit snapshot: $(grep -c . "$B/nofi-before.txt") lines (signature, units, bridal package, jacuzzi note, site, signed documents)"
titles >"$B/titles-before.txt"
ok "titles and descriptions of $(grep -c '^[^<]' "$B/titles-before.txt" || true) home pages recorded"

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

# ------------------------------------------------------------------ 4. migration 206 (one transaction)
PHASE=migration
say "== 4/6 migration 206 (one transaction: gate → migration → registration → checks)"
if [[ "$MIGRATION_STATE" == done ]]; then
  ok "206 already applied and checked (a previous run) — skipped"
else
  migration_sql >"$B/migration-206.sql"
  psql_file <"$B/migration-206.sql" >>"$LOG" 2>&1 || {
    tail -n 5 "$LOG" | sed 's/^/      /'
    say "  ✗ migration 206 did not go in — rolled back inside its transaction"
    false
  }
  MIGRATED_NOW=yes
  [[ "$(psql_q "SELECT ($POST_CHECK) AND (SELECT count(*) FROM public._migrations_applied) = $((EXPECTED_BEFORE + 1))")" == t ]] ||
    { say "  ✗ after the commit: the checks of 206 fail"; false; }
  ok "206 applied and registered; inside the same snapshot: the customers' data and the email history identical;"
  ok "the new alert columns empty (nothing marked); permissions: signed-in staff only, never anon"
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
release_file deploy/seo-engine/nofi-snapshot.sql | psql_file >"$B/nofi-after.txt"
diff "$B/nofi-before.txt" "$B/nofi-after.txt" >>"$LOG" || { say "  ✗ Nofi Dorit changed (see $B/nofi-before.txt / nofi-after.txt)"; false; }
ok "Nofi Dorit unchanged: signature, units and prices, the bridal package, the jacuzzi note (Moriah), site, documents"
titles >"$B/titles-after.txt"
diff "$B/titles-before.txt" "$B/titles-after.txt" >>"$LOG" || { say "  ✗ a title / description changed (see $B/titles-*.txt)"; false; }
ok "titles and descriptions of the home pages unchanged"
release_checks || { say "  ✗ a check of this release failed"; false; }
workers=$(docker logs --since 5m "$APP" 2>&1 | grep -c '\[seo\] worker started' || true)
((workers > 0)) || { say "  ✗ the SEO worker did not start"; false; }
ok "SEO worker started"
say "  · open failed-email alerts per business (the owner can now mark them read / handled):"
psql_q "$ALERTS_AFTER" | sed 's/^/      /' | tee -a "$LOG"
errs=$(docker logs --since 5m "$APP" 2>&1 | grep -icE "fatal|unhandled" || true)
ok "log: ${errs:-0} fatal / unhandled lines in the last 5 minutes"
trap - ERR
say ""
say "DEPLOY OK — ${TARGET_SHA:0:7} runs; migration 206 in; backup: $B; rollback image: $IMAGE:$ROLLBACK_TAG"
say "App rollback (only if needed, with approval):"
say "  docker tag $IMAGE:$ROLLBACK_TAG $IMAGE:latest && git -C $APP_DIR checkout -q -B ${PREV_BRANCH:-previous} $PREV_SHA && (cd $APP_DIR && docker compose up -d)"
say "DB rollback of 206 (only after the app rollback, with approval): bash $0 --rollback-db $TARGET_SHA"

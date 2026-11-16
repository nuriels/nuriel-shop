#!/usr/bin/env bash
# ===========================================================================================
# פריסת Nuriel Websites (הענף websites/engine) לייצור בפקודה אחת — אותו מבנה כמו deploy/release-next.sh:
# בדיקות מקדימות → גיבוי (מסד + אחסון + image) → קוד + בנייה → המיגרציות החדשות 193–198 (מנוע אתרי העסקים,
# מדיה, גופנים, פניות, כתובת האתר, הזמנת בעלת האתר) → המתג של המנוע (BUSINESS_PROFILE_ENGINE=on + דגל הפלטפורמה)
# → הפעלה מחדש → Health Check → בדיקות עשן. כל שלב נעצר מעצמו בכישלון; כישלון אחרי ההפעלה מחזיר אוטומטית את
# האפליקציה לגרסה הקודמת (image + קוד). המסד לא מוחזר אוטומטית — הפקודות מודפסות (Rollback מוגן לכל מיגרציה).
#
# מה הסקריפט *לא* עושה: לא פותח אתר, לא מעלה תוכן, לא מפרסם (הדגל business_profile_public נשאר כבוי בפלטפורמה),
# לא משנה DNS ולא nginx, לא נוגע בדומיינים, לא שולח הזמנות ולא מיילים. תוכן האתר של אפרת — deploy/websites-efrat.sh.
#
#   bash deploy/release-websites.sh --check  <commit>   # בדיקות מקדימות בלבד — קריאה בלבד, לא משנה כלום
#   bash deploy/release-websites.sh --deploy <commit>   # הכול, עם עצירה אוטומטית
#
# לא קורא ולא מדפיס סודות: מתוך ‎.env נקראים רק TENANT_BASE_DOMAIN, PLATFORM_ADMIN_HOST, BUSINESS_PROFILE_ENGINE,
# ולגבי RESEND_API_KEY / DNS_TEST_FIXTURES — רק אם מוגדרים (כן / לא), בלי הערך.
# ===========================================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/nuriel-shop-git}"
DB="${DB:-nuriel-shop-db}"
APP="${APP:-nuriel-shop-app}"
IMAGE="${IMAGE:-nuriel-shop-app-app}"
STORAGE="${STORAGE:-nuriel-shop-storage}"
STORAGE_DIR_FALLBACK="${STORAGE_DIR_FALLBACK:-/root/nuriel-shop-supabase/docker/volumes/storage}"
PORT="${PORT:-3700}"
BRANCH="${BRANCH:-websites/engine}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/nuriel-shop}"
EXPECTED_BEFORE="${EXPECTED_BEFORE:-192}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"
WAIT_STEPS="${WAIT_STEPS:-36}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"
NEW_MIGRATIONS=(20261116090000_bp_engine 20261116100000_bp_media 20261116110000_bp_site_fonts 20261116120000_bp_inquiries 20261117090000_bp_site_address 20261117100000_bp_owner_invites)
MIGRATION_LABEL=(193 194 195 196 197 198)
LABELS="${MIGRATION_LABEL[*]}"
LABELS="${LABELS// / + }"
# what each migration must leave behind (one query each, must print exactly: t). Every new table starts empty,
# the engine's flags start off: nothing is copied, opened or published for anyone.
MIGRATION_CHECK=(
  "SELECT to_regnamespace('business_profile') IS NOT NULL AND has_function_privilege('anon', 'public.bp_public_site()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.bp_draft_save(jsonb,integer)', 'EXECUTE') AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'tenants_site_type_check')) LIKE '%business_profile%' AND (SELECT count(*) FROM public.tenants WHERE site_type = 'business_profile') = 0 AND NOT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_enabled') AND NOT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_public')"
  "SELECT to_regclass('business_profile.media') IS NOT NULL AND NOT has_table_privilege('authenticated', 'business_profile.media', 'SELECT') AND has_function_privilege('anon', 'public.bp_media_public()', 'EXECUTE') AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'bp-media') AND (SELECT count(*) FROM business_profile.media) = 0"
  "SELECT EXISTS (SELECT 1 FROM business_profile.templates WHERE key = 'classic' AND status = 'available') AND has_function_privilege('authenticated', 'public.bp_media_add_font(uuid,text,bigint,jsonb,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.bp_media_add_font(uuid,text,bigint,jsonb,text)', 'EXECUTE') AND (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'bp-media') = ARRAY['image/webp', 'image/avif', 'font/woff2']"
  "SELECT to_regclass('business_profile.inquiries') IS NOT NULL AND NOT has_table_privilege('authenticated', 'business_profile.inquiries', 'SELECT') AND has_function_privilege('service_role', 'public.bp_inquiry_submit(uuid,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.bp_inquiry_submit(uuid,text,text,text,text,text,text,text,text,boolean)', 'EXECUTE') AND (SELECT count(*) FROM business_profile.inquiries) = 0"
  "SELECT to_regclass('public.tenant_host_redirects') IS NOT NULL AND NOT has_table_privilege('authenticated', 'public.tenant_host_redirects', 'SELECT') AND (SELECT count(*) FROM public.tenant_host_redirects) = 0 AND pg_get_functiondef('public.ssl_agent_targets()'::regprocedure) LIKE '%alias%' AND has_function_privilege('authenticated', 'public.bp_address_state()', 'EXECUTE')"
  "SELECT to_regclass('business_profile.owner_invites') IS NOT NULL AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'business_profile.owner_invites'::regclass) AND NOT has_table_privilege('authenticated', 'business_profile.owner_invites', 'SELECT') AND has_function_privilege('service_role', 'public.bp_invite_redeem(text,uuid,uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.bp_invite_redeem(text,uuid,uuid,text,text)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.bp_invite_check(text,uuid,text)', 'EXECUTE') AND (SELECT count(*) FROM business_profile.owner_invites) = 0"
)
# the code of this release must be in the new image (strings of the server bundle)
BUNDLE_MARKS=(bp_invite_redeem platform_bp_site_file)
# customer data that no migration may touch: every site (address, type, status, domain), every role, the store
# VAT settings, the orders, the old payment history, subscriptions and the zimmer bookings — checksums before the
# migrations must equal the checksums after
GUARD_SUM="SELECT md5(concat_ws('|',
  (SELECT string_agg(concat_ws(',', t.id, t.slug, t.status, t.site_type, t.custom_domain, t.custom_domain_status, t.owner_email), ';' ORDER BY t.id) FROM public.tenants t),
  (SELECT string_agg(concat_ws(',', r.tenant_id, r.user_id, r.role, r.is_protected, r.is_blocked), ';' ORDER BY r.tenant_id, r.user_id, r.role) FROM public.user_roles r),
  (SELECT string_agg(concat_ws(',', s.tenant_id, s.business_type, s.vat_rate, s.prices_include_vat), ';' ORDER BY s.tenant_id) FROM public.site_settings s),
  (SELECT string_agg(concat_ws(',', o.id, o.total, o.vat_rate, o.prices_include_vat, o.status), ';' ORDER BY o.id) FROM public.orders o),
  (SELECT string_agg(concat_ws(',', h.id, h.amount, h.payment_status), ';' ORDER BY h.id) FROM public.billing_history h),
  (SELECT string_agg(concat_ws(',', s.tenant_id, s.plan_type, s.status), ';' ORDER BY s.tenant_id) FROM public.tenant_subscriptions s),
  (SELECT string_agg(concat_ws(',', b.id, b.status, b.total), ';' ORDER BY b.id) FROM hospitality.bookings b)))"
# order creation, never kept: a guest pickup order in the main store inside a transaction that is rolled back
SMOKE_ORDER_INSERT="INSERT INTO public.orders (tenant_id, status, kind, order_number, customer_name, customer_tax_id, customer_phone, customer_email, shipping_kind)
  SELECT id, 'pending', 'order', 'SMOKE', 'deploy smoke', '123456782', '0500000000', 'deploy.smoke@invalid.test', 'pickup' FROM public.tenants WHERE is_default"

MODE="${1:-}"
TARGET="${2:-}"
PHASE="preflight"
B=""
LOG=/dev/null
PREV_SHA=""
PREV_BRANCH=""
ROLLBACK_TAG=""
PREV_ENGINE_LINE=""
ENV_CHANGED=no
APPLIED_NOW=()

say() { printf '%s\n' "$*" | tee -a "$LOG"; }
ok() { say "  ✓ $*"; }
psql_q() { docker exec "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -tAc "$1"; }
# smoke_sql "<sql>" → 0 when the script prints exactly: t (run from stdin, so BEGIN … ROLLBACK works)
smoke_sql() {
  local out
  out=$(printf '%s\n' "$1" | docker exec -i "$DB" psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 2>>"$LOG") || return 1
  [[ "$(printf '%s' "$out" | tr -d '[:space:]')" == t ]]
}
env_value() { sed -n "s/^$1=//p" "$APP_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r'; }
env_is_set() { [[ -n "$(env_value "$1")" ]]; }

usage() {
  echo "usage: bash deploy/release-websites.sh --check|--deploy <commit>" >&2
  exit 2
}

# the engine switch in .env: back to what it was (only the one line this script writes)
restore_env() {
  [[ "$ENV_CHANGED" == yes ]] || return 0
  sed -i '/^BUSINESS_PROFILE_ENGINE=/d' "$APP_DIR/.env"
  [[ -n "$PREV_ENGINE_LINE" ]] && printf '%s\n' "$PREV_ENGINE_LINE" >>"$APP_DIR/.env"
  ENV_CHANGED=no
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
  restore_env || true
}

print_db_rollback() {
  ((${#APPLIED_NOW[@]} == 0)) && return 0
  say "  migrations applied in this run: ${APPLIED_NOW[*]} — they stay (the previous version works with them: new schema / tables only)."
  say "  DB rollback only with explicit approval, newest first:"
  local i
  for ((i = ${#APPLIED_NOW[@]} - 1; i >= 0; i--)); do
    local f="${APPLIED_NOW[$i]}"
    say "    docker exec -i $DB psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < $B/$f.down.sql && docker exec $DB psql -U postgres -d postgres -qc \"DELETE FROM public._migrations_applied WHERE filename = '$f.sql'\""
  done
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

health_checks() { # robots 200 + every existing site host answers below 500 (stores, zimmer sites, the panel)
  local code base platform h fails=0
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
  if [[ "$code" == 200 ]]; then ok "local robots.txt: 200"; else say "  ✗ local robots.txt: $code"; fails=1; fi
  base=$(env_value TENANT_BASE_DOMAIN)
  platform=$(env_value PLATFORM_ADMIN_HOST)
  local hosts=()
  [[ -n "$platform" ]] && hosts+=("$platform")
  if [[ -n "$base" ]]; then
    while IFS= read -r slug; do [[ -n "$slug" ]] && hosts+=("$slug.$base"); done < <(psql_q "SELECT slug FROM public.tenants WHERE is_default OR site_type = 'hospitality' ORDER BY is_default DESC, slug LIMIT 12")
  fi
  for h in "${hosts[@]}"; do
    for path in / /manage/login; do
      [[ "$path" == /manage/login && "$h" == "$platform" ]] && continue
      code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Host: $h" "http://127.0.0.1:$PORT$path") || true
      if [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then ok "$h$path: $code"; else say "  ✗ $h$path: $code"; fails=1; fi
    done
  done
  if [[ -n "$platform" ]]; then
    code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' -H "Host: $platform" "http://127.0.0.1:$PORT/platform/websites") || true
    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then ok "$platform/platform/websites (\"אתרי אינטרנט\" בפאנל): $code"; else say "  ✗ $platform/platform/websites: $code"; fails=1; fi
  fi
  return "$fails"
}

on_error() {
  local line="$1"
  trap - ERR
  say ""
  say "STOPPED — phase: $PHASE (line $line)"
  case "$PHASE" in
    preflight)
      say "  nothing was changed."
      ;;
    backup)
      say "  nothing was changed on the site or the database (only the backup folder: $B)."
      ;;
    build)
      restore_code_and_tag
      say "  the site still runs the previous version ($PREV_SHA); code, .env line and image tag restored; the database untouched."
      ;;
    migrations)
      restore_code_and_tag
      say "  the site still runs the previous version ($PREV_SHA); the failed migration left nothing (one transaction)."
      print_db_rollback
      ;;
    restart | health)
      say "  automatic application rollback to $PREV_SHA ..."
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

[[ "$MODE" == --check || "$MODE" == --deploy ]] || usage
[[ -n "$TARGET" ]] || usage
cd "$APP_DIR"

# ------------------------------------------------------------------ 1. preflight (read only)
say "== 1/7 preflight (read only)"
test -z "$(git status --porcelain --untracked-files=no)" || { say "  ✗ the code folder has uncommitted changes"; false; }
ok "code folder clean"
git fetch -q origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
TARGET_SHA=$(git rev-parse --verify -q "$TARGET^{commit}") || { say "  ✗ commit $TARGET not found after fetch"; false; }
git merge-base --is-ancestor "$TARGET_SHA" "origin/$BRANCH" || { say "  ✗ $TARGET is not on origin/$BRANCH"; false; }
PREV_SHA=$(git rev-parse HEAD)
PREV_BRANCH=$(git symbolic-ref --short -q HEAD || true)
git merge-base --is-ancestor "$PREV_SHA" "$TARGET_SHA" || { say "  ✗ ${PREV_SHA:0:7} → ${TARGET_SHA:0:7} is not a fast-forward"; false; }
ok "running ${PREV_SHA:0:7}${PREV_BRANCH:+ ($PREV_BRANCH)} → target ${TARGET_SHA:0:7} on origin/$BRANCH, fast-forward"
[[ "$(docker inspect -f '{{.State.Running}}' "$DB" 2>/dev/null)" == true ]] || { say "  ✗ database container $DB is not running"; false; }
[[ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" == true ]] || { say "  ✗ app container $APP is not running"; false; }
RUNNING_ID=$(docker inspect -f '{{.Image}}' "$APP")
[[ "$RUNNING_ID" == "$(docker image inspect -f '{{.Id}}' "$IMAGE:latest")" ]] || { say "  ✗ the running app is not $IMAGE:latest — stop and check"; false; }
ok "containers running; the app runs $IMAGE:latest"
n=$(psql_q "SELECT count(*) FROM public._migrations_applied")
[[ "$n" == "$EXPECTED_BEFORE" ]] || { say "  ✗ applied migrations: $n (expected $EXPECTED_BEFORE)"; false; }
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
psql_q "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort >"$TMPD/applied"
git ls-tree --name-only "$TARGET_SHA" supabase/migrations/ | sed 's#.*/##' | grep '\.sql$' | LC_ALL=C sort >"$TMPD/target"
printf '%s.sql\n' "${NEW_MIGRATIONS[@]}" | LC_ALL=C sort >"$TMPD/new"
LC_ALL=C comm -23 "$TMPD/target" "$TMPD/new" >"$TMPD/expected"
if ! cmp -s "$TMPD/applied" "$TMPD/expected"; then
  say "  ✗ the applied list differs from the target's migrations (other than $LABELS):"
  LC_ALL=C comm -3 "$TMPD/applied" "$TMPD/expected" | head -n 10 | sed 's/^/      /' | tee -a "$LOG"
  false
fi
for f in "${NEW_MIGRATIONS[@]}"; do
  { git cat-file -e "$TARGET_SHA:supabase/migrations/$f.sql" && git cat-file -e "$TARGET_SHA:supabase/rollbacks/$f.down.sql"; } 2>/dev/null ||
    { say "  ✗ $f (migration or rollback) is missing in the target"; false; }
done
ok "applied: $n = every migration of the target except $LABELS; the new files and their rollbacks are in the target"
# the engine switch reaches the container only if the target's compose file passes it
git show "$TARGET_SHA:docker-compose.yml" | grep -q 'BUSINESS_PROFILE_ENGINE: \${BUSINESS_PROFILE_ENGINE' ||
  { say "  ✗ the target's docker-compose.yml does not pass BUSINESS_PROFILE_ENGINE to the app"; false; }
ok "the target's docker-compose.yml passes BUSINESS_PROFILE_ENGINE to the app"
if env_is_set DNS_TEST_FIXTURES; then say "  ✗ .env sets DNS_TEST_FIXTURES (tests only) — remove it before deploying"; false; fi
ok ".env: no DNS_TEST_FIXTURES (real DNS for custom domains)"
PREV_ENGINE_VALUE=$(env_value BUSINESS_PROFILE_ENGINE)
ok ".env: BUSINESS_PROFILE_ENGINE is '${PREV_ENGINE_VALUE:-not set}' now — the deploy sets it to 'on'"
if env_is_set RESEND_API_KEY; then
  ok "email service: RESEND_API_KEY is set (the owner's email can be verified by a code)"
else
  say "  · email service: RESEND_API_KEY is not set — accounts open normally, email verification waits (shown in the panel)"
fi
[[ -n "$(env_value TENANT_BASE_DOMAIN)" ]] || { say "  ✗ .env has no TENANT_BASE_DOMAIN (site addresses)"; false; }
ok "site addresses under *.$(env_value TENANT_BASE_DOMAIN)"
STORAGE_DIR=$(docker inspect "$STORAGE" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)
[[ -z "$STORAGE_DIR" && -d "$STORAGE_DIR_FALLBACK" ]] && STORAGE_DIR="$STORAGE_DIR_FALLBACK"
[[ -n "$STORAGE_DIR" && -d "$STORAGE_DIR" ]] || { say "  ✗ storage folder not found (container $STORAGE / $STORAGE_DIR_FALLBACK) — set STORAGE_DIR_FALLBACK"; false; }
STORAGE_KB=$(du -sk "$STORAGE_DIR" | cut -f1)
ok "storage files: $STORAGE_DIR ($((STORAGE_KB / 1024)) MB)"
for d in "$APP_DIR" "$(dirname "$BACKUP_ROOT")"; do
  free=$(df -Pk "$d" | awk 'NR == 2 { print int($4 / 1048576) }')
  need=$((MIN_FREE_GB + STORAGE_KB / 1048576 + 1))
  ((free >= need)) || { say "  ✗ free disk at $d: ${free} GB (need $need)"; false; }
done
ok "free disk ≥ ${MIN_FREE_GB} GB + the storage backup"
SMOKE_ORDER=no
if smoke_sql "-- smoke: order before
BEGIN;
WITH o AS ($SMOKE_ORDER_INSERT RETURNING id) SELECT (count(*) = 1)::text FROM o;
ROLLBACK;"; then
  SMOKE_ORDER=yes
  ok "order creation works now (a test order in the main store, rolled back — nothing kept)"
else
  say "  · the order test cannot run on this store setup — it will be skipped after the deploy too"
fi
code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
[[ "$code" == 200 ]] || { say "  ✗ the site does not answer now (robots.txt: $code)"; false; }
ok "the site answers now (robots.txt: 200)"
if [[ "$MODE" == --check ]]; then
  say "PREFLIGHT OK — nothing was changed. To deploy: the same command with --deploy."
  exit 0
fi

# ------------------------------------------------------------------ 2. backup (database + storage + image)
PHASE=backup
STAMP=$(date -u +%Y%m%d-%H%M%S)
B="$BACKUP_ROOT/before-websites-$STAMP"
mkdir -p -m 700 "$BACKUP_ROOT"
mkdir -m 700 "$B"
LOG="$B/deploy.log"
say "== 2/7 backup → $B"
docker exec "$DB" pg_dump -U postgres -d postgres -Fc >"$B/db.dump"
docker exec -i "$DB" pg_restore -l <"$B/db.dump" >/dev/null
ok "database dump written and read back to the end ($(du -h "$B/db.dump" | cut -f1))"
tar -C "$STORAGE_DIR" -czf "$B/storage.tar.gz" .
in_tar=$(tar -tzf "$B/storage.tar.gz" | grep -vc '/$' || true)
on_disk=$(find "$STORAGE_DIR" -type f | wc -l)
((in_tar >= on_disk)) || { say "  ✗ storage backup has $in_tar files, the folder $on_disk"; false; }
ok "storage backup: $on_disk files ($(du -h "$B/storage.tar.gz" | cut -f1)), read back"
cp "$TMPD/applied" "$B/applied-before.txt"
printf '%s %s\n' "$PREV_SHA" "${PREV_BRANCH:-detached}" >"$B/previous-code.txt"
printf 'BUSINESS_PROFILE_ENGINE=%s\n' "${PREV_ENGINE_VALUE:-}" >"$B/engine-switch-before.txt"
ROLLBACK_TAG="before-websites-$STAMP"
docker tag "$IMAGE:latest" "$IMAGE:$ROLLBACK_TAG"
ok "rollback image $IMAGE:$ROLLBACK_TAG; previous code ${PREV_SHA:0:7} recorded"
for f in "${NEW_MIGRATIONS[@]}"; do git show "$TARGET_SHA:supabase/rollbacks/$f.down.sql" >"$B/$f.down.sql"; done
ok "rollback files of $LABELS copied"
GUARD_BEFORE=$(psql_q "$GUARD_SUM")
printf '%s\n' "$GUARD_BEFORE" >"$B/customer-data-checksum-before.txt"
ok "checksum of every site, role, store VAT setting, order, payment, subscription and zimmer booking recorded"

# ------------------------------------------------------------------ 3. code + build (the site keeps running)
PHASE=build
say "== 3/7 code + build (the site keeps running ${PREV_SHA:0:7})"
git checkout -q -B "$BRANCH" "$TARGET_SHA"
ok "code: $(git log --oneline -1)"
PREV_ENGINE_LINE=$(grep '^BUSINESS_PROFILE_ENGINE=' .env | tail -n 1 || true)
if [[ "$PREV_ENGINE_VALUE" != on ]]; then
  sed -i '/^BUSINESS_PROFILE_ENGINE=/d' .env
  printf 'BUSINESS_PROFILE_ENGINE=on\n' >>.env
  ENV_CHANGED=yes
  ok ".env: BUSINESS_PROFILE_ENGINE=on (was '${PREV_ENGINE_VALUE:-not set}'; restored automatically if this deploy fails)"
else
  ok ".env: BUSINESS_PROFILE_ENGINE=on already"
fi
docker compose build >"$B/build.log" 2>&1 || { tail -n 30 "$B/build.log" | tee -a "$LOG"; false; }
NEW_ID=$(docker image inspect -f '{{.Id}}' "$IMAGE:latest")
[[ "$NEW_ID" != "$RUNNING_ID" ]] || { say "  ✗ the build did not produce a new image"; false; }
for mark in "${BUNDLE_MARKS[@]}"; do
  marks=$(docker run --rm --entrypoint sh "$IMAGE:latest" -c "grep -rl $mark /app/.output | wc -l")
  ((marks > 0)) || { say "  ✗ the new image does not contain $mark"; false; }
done
ok "build ok (new image ${NEW_ID:0:19}; this release's code in the bundle: ${BUNDLE_MARKS[*]})"

# ------------------------------------------------------------------ 4. migrations (one transaction each)
PHASE=migrations
say "== 4/7 migrations"
for i in "${!NEW_MIGRATIONS[@]}"; do
  f="${NEW_MIGRATIONS[$i]}"
  want=$((EXPECTED_BEFORE + i))
  n=$(psql_q "SELECT count(*) FROM public._migrations_applied")
  [[ "$n" == "$want" ]] || { say "  ✗ before ${MIGRATION_LABEL[$i]}: applied $n (expected $want)"; false; }
  docker exec -i "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q <"supabase/migrations/$f.sql" >>"$LOG" 2>&1 || {
    say "  ✗ migration ${MIGRATION_LABEL[$i]} ($f) failed — rolled back inside its transaction"
    false
  }
  APPLIED_NOW+=("$f")
  psql_q "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" >/dev/null
  [[ "$(psql_q "${MIGRATION_CHECK[$i]}")" == t ]] || { say "  ✗ migration ${MIGRATION_LABEL[$i]}: post-check failed"; false; }
  ok "migration ${MIGRATION_LABEL[$i]} ($f): applied, recorded, checked"
done
n=$(psql_q "SELECT count(*) FROM public._migrations_applied")
[[ "$n" == "$((EXPECTED_BEFORE + ${#NEW_MIGRATIONS[@]}))" ]] || { say "  ✗ applied after: $n"; false; }
ok "applied: $EXPECTED_BEFORE → $n"
[[ "$(psql_q "$GUARD_SUM")" == "$GUARD_BEFORE" ]] || { say "  ✗ existing customer data changed during the migrations"; false; }
ok "existing sites, roles, store VAT settings, orders, payments, subscriptions and zimmer bookings: unchanged"

# ------------------------------------------------------------------ 5. the engine switch (no site is opened or published)
say "== 5/7 the Nuriel Websites engine: on (the management area); public sites stay off"
psql_q "UPDATE public.platform_feature_flags SET enabled = true, updated_at = now() WHERE key = 'business_profile_enabled'" >/dev/null
[[ "$(psql_q "SELECT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_enabled') AND NOT (SELECT enabled FROM public.platform_feature_flags WHERE key = 'business_profile_public')")" == t ]] ||
  { say "  ✗ the engine flags are not as expected"; false; }
ok "platform flags: business_profile_enabled = on, business_profile_public = off (no site can be public)"

# ------------------------------------------------------------------ 6. restart
PHASE=restart
say "== 6/7 restart on the new image"
docker compose up -d >>"$LOG" 2>&1
wait_healthy "$NEW_ID" || { say "  ✗ the new version did not become healthy"; false; }
ok "running the new image, healthy"

# ------------------------------------------------------------------ 7. health
PHASE=health
say "== 7/7 health check"
health_checks || { say "  ✗ a health check failed"; false; }
[[ "$(docker exec "$APP" printenv BUSINESS_PROFILE_ENGINE 2>/dev/null || true)" == on ]] || { say "  ✗ the app does not see BUSINESS_PROFILE_ENGINE=on"; false; }
ok "the app sees BUSINESS_PROFILE_ENGINE=on"
if [[ "$SMOKE_ORDER" == yes ]]; then
  smoke_sql "-- smoke: order after
BEGIN;
WITH o AS ($SMOKE_ORDER_INSERT RETURNING tenant_id, vat_business_type, vat_rate, prices_include_vat, total, net_amount, vat_amount, gross_amount)
SELECT bool_and(vat_business_type = public.tenant_vat_profile(tenant_id) ->> 'business_type'
                AND vat_rate = (public.tenant_vat_profile(tenant_id) ->> 'vat_rate')::numeric
                AND gross_amount = public.order_gross(total, prices_include_vat, vat_rate)
                AND net_amount + vat_amount = gross_amount)::text FROM o;
ROLLBACK;" || { say "  ✗ a new order does not work as before"; false; }
  ok "order creation: a test order works exactly as before (rolled back)"
fi
[[ "$(psql_q "SELECT count(*) FROM public.orders WHERE customer_email = 'deploy.smoke@invalid.test'")" == 0 ]] || { say "  ✗ a test order was kept"; false; }
ok "no test order kept"
[[ "$(psql_q "SELECT (SELECT count(*) FROM public.tenants WHERE site_type = 'business_profile') + (SELECT count(*) FROM business_profile.owner_invites) + (SELECT count(*) FROM public.tenant_host_redirects)")" == 0 ]] || { say "  ✗ unexpected rows in the new tables"; false; }
ok "no business site, invite or redirect yet (nothing opened, sent or published)"
errs=$(docker logs --since 3m "$APP" 2>&1 | grep -icE "fatal|unhandled" || true)
ok "log: ${errs:-0} fatal / unhandled lines in the last 3 minutes"
trap - ERR
say ""
say "DEPLOY OK — ${TARGET_SHA:0:7} runs; migrations $LABELS applied; backup (database + storage) and rollback image: $B, $IMAGE:$ROLLBACK_TAG"
say "Next (content, preview only — nothing is published): bash deploy/websites-efrat.sh open-site"
say "App rollback (only if needed, with approval): docker tag $IMAGE:$ROLLBACK_TAG $IMAGE:latest && git -C $APP_DIR checkout -q -B ${PREV_BRANCH:-previous} $PREV_SHA && (cd $APP_DIR && docker compose up -d)"

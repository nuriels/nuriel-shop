#!/usr/bin/env bash
# ===========================================================================================
# פריסת release/next לייצור בפקודה אחת: בדיקות מקדימות → גיבוי → קוד + בנייה → המיגרציות החדשות (כאן:
# 189–192, Billing & Agreements, מע"מ לפי סוג העוסק, Google Tag Manager) → הפעלה מחדש → Health Check →
# בדיקות עשן במסד (קריאה בלבד, או טרנזקציה שתמיד מבוטלת). כל שלב נעצר מעצמו בכישלון; כישלון אחרי ההפעלה
# מחזיר אוטומטית את האפליקציה לגרסה הקודמת (image + קוד). המסד לא מוחזר אוטומטית: ה-Rollback של המסד נעשה רק
# באישור (הפקודות מודפסות; לכל מיגרציה יש Rollback עם הגנה שנבדק).
#
#   bash deploy/release-next.sh --check  <commit>   # בדיקות מקדימות בלבד — קריאה בלבד, לא משנה כלום
#   bash deploy/release-next.sh --deploy <commit>   # הכול, עם עצירה אוטומטית
#
# לא קורא ולא מדפיס סודות: מתוך ‎.env נקראים רק TENANT_BASE_DOMAIN ו-PLATFORM_ADMIN_HOST (שמות מארחים).
# הערכים למטה הם של השרת; אפשר לעקוף אותם במשתני סביבה (כך רצה הבדיקה המקומית, מול docker מדומה).
# ===========================================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/nuriel-shop-git}"
DB="${DB:-nuriel-shop-db}"
APP="${APP:-nuriel-shop-app}"
IMAGE="${IMAGE:-nuriel-shop-app-app}"
PORT="${PORT:-3700}"
BRANCH="${BRANCH:-release/next}"
BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/nuriel-shop}"
EXPECTED_BEFORE="${EXPECTED_BEFORE:-188}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"
WAIT_STEPS="${WAIT_STEPS:-36}"
WAIT_SECONDS="${WAIT_SECONDS:-5}"
NEW_MIGRATIONS=(20261114100000_billing_agreements 20261114110000_billing_owner_access 20261115090000_vat_settings 20261115100000_site_tag_manager)
MIGRATION_LABEL=(189 190 191 192)
LABELS="${MIGRATION_LABEL[*]}"
LABELS="${LABELS// / + }"
# what each migration must leave behind (one query each, must print exactly: t). Every new table starts empty:
# nothing is copied, synced or changed for existing customers.
MIGRATION_CHECK=(
  "SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'billing'::regnamespace AND relkind = 'r' AND relrowsecurity) = 4 AND NOT has_schema_privilege('authenticated', 'billing', 'USAGE') AND has_function_privilege('authenticated', 'public.my_billing_summary()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.my_billing_summary()', 'EXECUTE') AND billing.vat_profile() ->> 'business_type' = 'exempt' AND (SELECT count(*) FROM billing.agreements) = 0 AND (SELECT count(*) FROM billing.ledger) = 0"
  "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'billing_history_guard') AND (SELECT qual LIKE '%staff_can(''billing.manage''%' FROM pg_policies WHERE tablename = 'tenant_subscriptions' AND policyname = 'store admin reads subscription')"
  "SELECT public.vat_rate_on() = 18 AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_vat_snapshot_guard') AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name IN ('vat_business_type', 'net_amount', 'vat_amount', 'gross_amount')) = 4 AND public.order_gross(100, false, 18) = 118 AND public.order_gross(118, true, 18) = 118"
  "SELECT to_regclass('public.site_tracking') IS NOT NULL AND (SELECT count(*) FROM public.site_tracking) = 0 AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_tracking'::regclass) AND NOT has_table_privilege('anon', 'public.site_tracking', 'SELECT') AND has_function_privilege('anon', 'public.site_tag_manager()', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.save_my_tag_manager(text,boolean)', 'EXECUTE')"
)
# the code of this release must be in the new image (strings of the server bundle)
BUNDLE_MARKS=(save_my_tag_manager my_billing_summary)
# customer data that no migration may touch: the store VAT settings, the orders' amounts and VAT, the old
# "record payment" history — checksums before the migrations must equal the checksums after
GUARD_SUM="SELECT md5(concat_ws('|',
  (SELECT string_agg(concat_ws(',', s.tenant_id, s.business_type, s.vat_rate, s.prices_include_vat), ';' ORDER BY s.tenant_id) FROM public.site_settings s),
  (SELECT string_agg(concat_ws(',', o.id, o.total, o.vat_rate, o.prices_include_vat, o.status), ';' ORDER BY o.id) FROM public.orders o),
  (SELECT string_agg(concat_ws(',', h.id, h.amount, h.payment_status), ';' ORDER BY h.id) FROM public.billing_history h),
  (SELECT string_agg(concat_ws(',', t.tenant_id, t.plan_type, t.status), ';' ORDER BY t.tenant_id) FROM public.tenant_subscriptions t)))"
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

usage() {
  echo "usage: bash deploy/release-next.sh --check|--deploy <commit>" >&2
  exit 2
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
  ((${#APPLIED_NOW[@]} == 0)) && return 0
  say "  migrations applied in this run: ${APPLIED_NOW[*]} — they stay (the previous version works with them)."
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

health_checks() { # robots 200 + every site host answers below 500
  local code base platform h fails=0
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/robots.txt") || true
  if [[ "$code" == 200 ]]; then ok "local robots.txt: 200"; else say "  ✗ local robots.txt: $code"; fails=1; fi
  # R-4: חיות (בלי מסד) ומוכנות (המסד). גרסה ישנה (חזרה לאחור) עונה 404 לשתיהן — לא כשל
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/healthz") || true
  if [[ "$code" == 200 ]]; then ok "local /healthz: 200"; elif [[ "$code" == 404 ]]; then ok "local /healthz: 404 (a version from before R-4)"; else say "  ✗ local /healthz: $code"; fails=1; fi
  code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:$PORT/readyz") || true
  if [[ "$code" == 200 ]]; then ok "local /readyz (database): 200"; elif [[ "$code" == 404 ]]; then ok "local /readyz: 404 (a version from before R-4)"; else say "  ✗ local /readyz (database): $code"; fails=1; fi
  base=$(sed -n 's/^TENANT_BASE_DOMAIN=//p' "$APP_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r')
  platform=$(sed -n 's/^PLATFORM_ADMIN_HOST=//p' "$APP_DIR/.env" 2>/dev/null | tail -n 1 | tr -d '"'"'"' \r')
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
      say "  the site still runs the previous version ($PREV_SHA); code and image tag restored; the database untouched."
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
say "== 1/6 preflight (read only)"
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
for d in "$APP_DIR" "$(dirname "$BACKUP_ROOT")"; do
  free=$(df -Pk "$d" | awk 'NR == 2 { print int($4 / 1048576) }')
  ((free >= MIN_FREE_GB)) || { say "  ✗ free disk at $d: ${free} GB (need $MIN_FREE_GB)"; false; }
done
ok "free disk ≥ ${MIN_FREE_GB} GB"
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

# ------------------------------------------------------------------ 2. backup
PHASE=backup
STAMP=$(date -u +%Y%m%d-%H%M%S)
B="$BACKUP_ROOT/before-release-next-$STAMP"
mkdir -p -m 700 "$BACKUP_ROOT"
mkdir -m 700 "$B"
LOG="$B/deploy.log"
say "== 2/6 backup → $B"
docker exec "$DB" pg_dump -U postgres -d postgres -Fc >"$B/db.dump"
docker exec -i "$DB" pg_restore -l <"$B/db.dump" >/dev/null
ok "database dump written and read back to the end ($(du -h "$B/db.dump" | cut -f1))"
cp "$TMPD/applied" "$B/applied-before.txt"
printf '%s %s\n' "$PREV_SHA" "${PREV_BRANCH:-detached}" >"$B/previous-code.txt"
ROLLBACK_TAG="before-release-next-$STAMP"
docker tag "$IMAGE:latest" "$IMAGE:$ROLLBACK_TAG"
ok "rollback image $IMAGE:$ROLLBACK_TAG; previous code ${PREV_SHA:0:7} recorded"
for f in "${NEW_MIGRATIONS[@]}"; do git show "$TARGET_SHA:supabase/rollbacks/$f.down.sql" >"$B/$f.down.sql"; done
ok "rollback files of $LABELS copied"
GUARD_BEFORE=$(psql_q "$GUARD_SUM")
printf '%s\n' "$GUARD_BEFORE" >"$B/customer-data-checksum-before.txt"
ok "checksum of store VAT settings, orders, old payment history, subscriptions recorded"
if git cat-file -e "$TARGET_SHA:scripts/billing/vat-precheck.sql" 2>/dev/null; then
  git show "$TARGET_SHA:scripts/billing/vat-precheck.sql" | docker exec -i "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 >"$B/vat-precheck.txt" 2>&1
  ok "VAT precheck (read only) saved: $B/vat-precheck.txt"
fi

# ------------------------------------------------------------------ 3. code + build (the site keeps running)
PHASE=build
say "== 3/6 code + build (the site keeps running ${PREV_SHA:0:7})"
git checkout -q -B "$BRANCH" "$TARGET_SHA"
ok "code: $(git log --oneline -1)"
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
say "== 4/6 migrations"
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
ok "existing store VAT settings, orders, old payment history and subscriptions: unchanged"

# ------------------------------------------------------------------ 5. restart
PHASE=restart
say "== 5/6 restart on the new image"
docker compose up -d >>"$LOG" 2>&1
wait_healthy "$NEW_ID" || { say "  ✗ the new version did not become healthy"; false; }
ok "running the new image, healthy"

# ------------------------------------------------------------------ 6. health
PHASE=health
say "== 6/6 health check"
health_checks || { say "  ✗ a health check failed"; false; }
if [[ "$SMOKE_ORDER" == yes ]]; then
  smoke_sql "-- smoke: order after
BEGIN;
WITH o AS ($SMOKE_ORDER_INSERT RETURNING tenant_id, vat_business_type, vat_rate, prices_include_vat, total, net_amount, vat_amount, gross_amount)
SELECT bool_and(vat_business_type = public.tenant_vat_profile(tenant_id) ->> 'business_type'
                AND vat_rate = (public.tenant_vat_profile(tenant_id) ->> 'vat_rate')::numeric
                AND gross_amount = public.order_gross(total, prices_include_vat, vat_rate)
                AND net_amount + vat_amount = gross_amount)::text FROM o;
ROLLBACK;" || { say "  ✗ a new order does not get the server's VAT snapshot"; false; }
  ok "order creation: a test order gets the store's dealer type, the central rate and the right amounts (rolled back)"
fi
[[ "$(psql_q "SELECT count(*) FROM public.orders WHERE customer_email = 'deploy.smoke@invalid.test'")" == 0 ]] || { say "  ✗ a test order was kept"; false; }
ok "no test order kept"
[[ "$(psql_q "SELECT (SELECT count(*) FROM billing.agreements) + (SELECT count(*) FROM billing.ledger) + (SELECT count(*) FROM public.site_tracking)")" == 0 ]] || { say "  ✗ unexpected rows in the new tables"; false; }
ok "billing and Tag Manager tables empty (nothing copied or synced)"
errs=$(docker logs --since 3m "$APP" 2>&1 | grep -icE "fatal|unhandled" || true)
ok "log: ${errs:-0} fatal / unhandled lines in the last 3 minutes"
trap - ERR
say ""
say "DEPLOY OK — ${TARGET_SHA:0:7} runs; migrations $LABELS applied; backup and rollback image: $B, $IMAGE:$ROLLBACK_TAG"
say "App rollback (only if needed, with approval): docker tag $IMAGE:$ROLLBACK_TAG $IMAGE:latest && git -C $APP_DIR checkout -q -B ${PREV_BRANCH:-previous} $PREV_SHA && (cd $APP_DIR && docker compose up -d)"

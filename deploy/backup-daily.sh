#!/usr/bin/env bash
# ============================================================
# גיבוי יומי — קובי (kobi-*) בלבד
# ============================================================
# מה נשמר בכל גיבוי (תיקייה אחת לכל יום):
#   db.dump        — כל מסד הנתונים (pg_dump -Fc), כולל משתמשים, הזמנות ומוצרים
#   db.toc         — תוכן הקובץ לפי pg_restore --list (הוכחה שהקובץ תקין וניתן לשחזור)
#   counts.txt     — כמה מוצרים / הזמנות / לקוחות / משתמשים היו ברגע הגיבוי
#   storage/       — קבצי ה-Storage (תמונות מוצרים, לוגו, באנרים). עותק "חכם":
#                    קובץ שלא השתנה מאתמול לא תופס מקום נוסף (hard link דרך rsync)
#   secrets/       — קובץ הסודות של Supabase (בלעדיו אין שחזור!), env של האפליקציה, הגדרות Nginx
#   SHA256SUMS     — טביעת אצבע לכל קובץ
#
# שמירה: 14 גיבויים יומיים אחרונים + הגיבוי הראשון של כל חודש ל-12 חודשים.
# הסקריפט רק קורא: pg_dump והעתקת קבצים. לא עוצר, לא מפעיל מחדש ולא משנה שום
# קונטיינר — ולא נוגע במערכות האחרות על השרת (nuri, Moments, n).
#
# שימוש:
#   bash deploy/backup-daily.sh            ← גיבוי עכשיו
#   bash deploy/backup-daily.sh --status   ← מצב הגיבויים
# ============================================================
set -Eeuo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/root/backups/kobi}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
DB_CONTAINER="${DB_CONTAINER:-kobi-db}"
DB_NAME="${DB_NAME:-postgres}"
STORAGE_CONTAINER="${STORAGE_CONTAINER:-kobi-storage}"
STORAGE_FALLBACK="${STORAGE_FALLBACK:-/root/kobi-supabase/docker/volumes/storage}"
SUPABASE_ENV="${SUPABASE_ENV:-/root/kobi-supabase/docker/.env}"
APP_DIR="${APP_DIR:-/root/kobi-git}"
# אופציונלי — העתקה מחוץ לשרת. קובץ עם: RCLONE_REMOTE="שם-remote:תיקייה"
OFFSITE_CONF="${OFFSITE_CONF:-/root/.kobi-backup-offsite}"

log() { echo "[$(date '+%F %T')] $*"; }
sql_quote() { printf "'%s'" "${1//\'/\'\'}"; }

# ---------- מצב הגיבויים ----------
if [[ "${1:-}" == "--status" ]]; then
  echo "תיקיית הגיבויים: $BACKUP_ROOT"
  [[ -f "$BACKUP_ROOT/LAST_OK" ]] && echo "✓ גיבוי אחרון שהצליח: $(cat "$BACKUP_ROOT/LAST_OK")" \
    || echo "✗ עוד לא היה גיבוי שהצליח"
  [[ -f "$BACKUP_ROOT/LAST_FAILED" ]] && echo "✗ כישלון אחרון: $(tr '\n' ' ' < "$BACKUP_ROOT/LAST_FAILED")"
  echo "גיבויים יומיים: $(find "$BACKUP_ROOT/daily" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' 2>/dev/null | wc -l)" \
       " · חודשיים: $(find "$BACKUP_ROOT/monthly" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  if [[ -d "$BACKUP_ROOT/latest" ]]; then
    echo "האחרון: $(readlink -f "$BACKUP_ROOT/latest")"
    echo "  מסד: $(du -h "$BACKUP_ROOT/latest/db.dump" | cut -f1) · קבצים: $(du -sh "$BACKUP_ROOT/latest/storage" | cut -f1)"
    sed 's/^/  /' "$BACKUP_ROOT/latest/counts.txt"
  fi
  echo "סה\"כ בדיסק (בלי כפילויות): $(du -sh "$BACKUP_ROOT" 2>/dev/null | cut -f1) · פנוי: $(df -Ph "$BACKUP_ROOT" | awk 'NR==2{print $4}')"
  exit 0
fi

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/monthly"
chmod 700 "$BACKUP_ROOT"

STAMP="$(date +%Y%m%d-%H%M%S)"
# הרצה ידנית באותה שנייה כמו התזמון — לא דורסים ולא מקננים תיקייה
if [[ -e "$BACKUP_ROOT/daily/$STAMP" || -e "$BACKUP_ROOT/daily/$STAMP.partial" ]]; then STAMP="$STAMP-$$"; fi
DAY_DIR="$BACKUP_ROOT/daily/$STAMP"
WORK="$DAY_DIR.partial"
STEP="התחלה"
HAD_FAILED=0
[[ -f "$BACKUP_ROOT/LAST_FAILED" ]] && HAD_FAILED=1

notify_admins() {
  docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt \
    -c "select public.notify_admins_system($(sql_quote "$1"), $(sql_quote "$2"))" >/dev/null 2>&1 || true
}

on_error() {
  local code=$? line=$1
  trap - ERR
  log "✗ הגיבוי נכשל בשלב: $STEP (שורה $line, קוד $code)"
  { date '+%F %T'; echo "$STEP"; } > "$BACKUP_ROOT/LAST_FAILED" 2>/dev/null || true
  rm -rf "$WORK" 2>/dev/null || true
  notify_admins "הגיבוי היומי נכשל" \
    "שלב: $STEP · $(date '+%d.%m %H:%M') · פרטים בשרת: /var/log/kobi-backup.log"
  exit "$code"
}
trap 'on_error $LINENO' ERR

# ---------- נעילה: לא שני גיבויים במקביל ----------
exec 9>"$BACKUP_ROOT/.lock"
if ! flock -n 9; then
  log "גיבוי אחר כבר רץ — מדלג"
  exit 0
fi

STEP="בדיקת מקום פנוי בדיסק"
free_mb="$(df -Pm "$BACKUP_ROOT" | awk 'NR==2{print $4}')"
if (( free_mb < MIN_FREE_MB )); then
  log "נשארו רק ${free_mb}MB פנויים (מינימום ${MIN_FREE_MB}MB)"
  false
fi

rm -rf "$BACKUP_ROOT"/daily/*.partial 2>/dev/null || true
mkdir -p "$WORK"
log "▶ גיבוי $STAMP"

# ---------- 1. מסד הנתונים ----------
STEP="גיבוי מסד הנתונים (pg_dump)"
docker exec "$DB_CONTAINER" pg_dump -U postgres -d "$DB_NAME" -Fc > "$WORK/db.dump"
[[ -s "$WORK/db.dump" ]]

STEP="בדיקה שקובץ המסד תקין (pg_restore --list)"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$WORK/db.dump" > "$WORK/db.toc"
grep -q "TABLE DATA public global_products" "$WORK/db.toc"
grep -q "TABLE DATA public orders" "$WORK/db.toc"
grep -q "TABLE DATA auth users" "$WORK/db.toc"

STEP="ספירת נתונים לתיעוד"
docker exec "$DB_CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -qAt -F ': ' -c "
  select 'מוצרים', count(*) from public.global_products
  union all select 'הזמנות', count(*) from public.orders
  union all select 'לקוחות', count(*) from public.customer_profiles
  union all select 'משתמשים', count(*) from auth.users" > "$WORK/counts.txt"
log "  ✓ מסד: $(du -h "$WORK/db.dump" | cut -f1) · $(tr '\n' ' ' < "$WORK/counts.txt")"

# ---------- 2. קבצי Storage ----------
STEP="איתור תיקיית הקבצים (Storage)"
storage_src="$(docker inspect "$STORAGE_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
if [[ -z "$storage_src" && -d "$STORAGE_FALLBACK" ]]; then storage_src="$STORAGE_FALLBACK"; fi
if [[ -z "$storage_src" || ! -d "$storage_src" ]]; then
  log "לא נמצאה תיקיית ה-Storage של $STORAGE_CONTAINER"
  false
fi

STEP="העתקת קבצי Storage"
prev_storage="$(find "$BACKUP_ROOT/daily" -mindepth 2 -maxdepth 2 -type d -name storage \
  ! -path '*.partial/*' 2>/dev/null | sort | tail -1 || true)"
if command -v rsync >/dev/null 2>&1; then
  rsync_rc=0
  rsync -a --delete ${prev_storage:+--link-dest="$prev_storage"} "$storage_src/" "$WORK/storage/" || rsync_rc=$?
  # 24 = קובץ נמחק בזמן ההעתקה (העלאה/מחיקה באמצע) — תקין
  if (( rsync_rc != 0 && rsync_rc != 24 )); then false; fi
else
  mkdir -p "$WORK/storage"
  cp -a "$storage_src/." "$WORK/storage/"
fi
files_count="$(find "$WORK/storage" -type f | wc -l)"
log "  ✓ קבצים: $files_count ($(du -sh "$WORK/storage" | cut -f1))"

# ---------- 3. סודות והגדרות ----------
STEP="גיבוי קובץ הסודות של Supabase"
mkdir -p "$WORK/secrets"
cp -p "$SUPABASE_ENV" "$WORK/secrets/supabase-docker.env"
for name in .env .env.production; do
  if [[ -f "$APP_DIR/$name" ]]; then cp -p "$APP_DIR/$name" "$WORK/secrets/app${name}"; fi
done
for conf in /etc/nginx/sites-available/*kobi*; do
  if [[ -f "$conf" ]]; then cp -p "$conf" "$WORK/secrets/"; fi
done
git -C "$APP_DIR" log --oneline -1 > "$WORK/app-commit.txt" 2>/dev/null || echo "לא ידוע" > "$WORK/app-commit.txt"

STEP="טביעת אצבע לקבצים (SHA256SUMS)"
( cd "$WORK" && find . -type f ! -path './storage/*' ! -name SHA256SUMS -print0 | sort -z \
    | xargs -0 sha256sum > SHA256SUMS )

# ---------- 4. סגירה: רק גיבוי שלם מקבל שם סופי ----------
STEP="סגירת הגיבוי"
mv "$WORK" "$DAY_DIR"
ln -sfn "$DAY_DIR" "$BACKUP_ROOT/latest"

month="$(date +%Y-%m)"
if [[ ! -d "$BACKUP_ROOT/monthly/$month" ]]; then
  STEP="שמירת עותק חודשי"
  # hard links — העותק החודשי לא תופס מקום נוסף ונשאר גם כשהיומי נמחק
  cp -al "$DAY_DIR" "$BACKUP_ROOT/monthly/$month"
  log "  ✓ עותק חודשי: $month"
fi

STEP="מחיקת גיבויים ישנים"
mapfile -t old_daily < <(find "$BACKUP_ROOT/daily" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | head -n "-$KEEP_DAILY")
if (( ${#old_daily[@]} > 0 )); then rm -rf "${old_daily[@]}"; fi
mapfile -t old_monthly < <(find "$BACKUP_ROOT/monthly" -mindepth 1 -maxdepth 1 -type d | sort | head -n "-$KEEP_MONTHLY")
if (( ${#old_monthly[@]} > 0 )); then rm -rf "${old_monthly[@]}"; fi

# ---------- 5. אופציונלי: העתקה מחוץ לשרת ----------
if [[ -f "$OFFSITE_CONF" ]]; then
  # shellcheck disable=SC1090
  source "$OFFSITE_CONF"
  if [[ -n "${RCLONE_REMOTE:-}" ]]; then
    STEP="העתקה מחוץ לשרת (rclone → $RCLONE_REMOTE)"
    command -v rclone >/dev/null 2>&1
    rclone copy "$DAY_DIR" "$RCLONE_REMOTE/daily/$STAMP" --exclude "storage/**"
    rclone sync "$DAY_DIR/storage" "$RCLONE_REMOTE/storage"
    rclone delete "$RCLONE_REMOTE/daily" --min-age "${OFFSITE_KEEP_DAYS:-30}d" || true
    rclone rmdirs "$RCLONE_REMOTE/daily" --leave-root || true
    log "  ✓ הועתק מחוץ לשרת: $RCLONE_REMOTE"
  fi
fi

date '+%F %T' > "$BACKUP_ROOT/LAST_OK"
rm -f "$BACKUP_ROOT/LAST_FAILED"
if (( HAD_FAILED )); then
  notify_admins "הגיבוי היומי חזר לעבוד" "הגיבוי של $(date '+%d.%m %H:%M') הצליח"
fi
log "✓ הגיבוי הסתיים: $DAY_DIR"

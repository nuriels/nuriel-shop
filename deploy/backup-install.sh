#!/usr/bin/env bash
# ============================================================
# התקנת הגיבוי היומי — מריצים פעם אחת בשרת, לכל סטאק:
#   bash /root/kobi-git/deploy/backup-install.sh                                  ← kobi (ברירת מחדל)
#   BACKUP_PROJECT=nuriel-shop bash /root/nuriel-shop-git/deploy/backup-install.sh
# עם הצפנה (SEC-H6) — מפתח age ציבורי; את המפתח הפרטי יוצרים ושומרים מחוץ לשרת
# (age-keygen -o key.txt במחשב אישי) — בלעדיו אין שחזור:
#   BACKUP_PROJECT=nuriel-shop BACKUP_AGE_RECIPIENT=age1… bash …/deploy/backup-install.sh
# מה זה עושה (P = BACKUP_PROJECT):
#   1. מתקין rsync אם חסר (לעותקים "חכמים" של קבצי ה-Storage), ו-age כשמוגדרת הצפנה
#   2. שומר את המפתח הציבורי ב-/root/.P-backup-recipients (הגיבוי הלילי קורא אותו משם)
#   3. יוצר את /root/backups/P (הרשאות root בלבד)
#   4. מתזמן גיבוי כל לילה (/etc/cron.d/P-backup): kobi ב-00:30, סטאק אחר ב-00:50 —
#      לא שני pg_dump במקביל. אפשר לשנות: BACKUP_CRON_TIME="15 1"
#   5. מגדיר סבב ללוג (/var/log/P-backup.log)
#   6. מריץ גיבוי ראשון עכשיו ומציג את המצב
# בטוח להרצה חוזרת — פשוט כותב את אותם קבצים מחדש.
# ============================================================
set -Eeuo pipefail
trap 'echo -e "\033[1;31m✗ ההתקנה נעצרה בשורה ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-daily.sh"
P="${BACKUP_PROJECT:-kobi}"
[[ "$P" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "BACKUP_PROJECT לא תקין: $P (אותיות קטנות, ספרות, - ו-_)"; exit 1; }
LOG="/var/log/$P-backup.log"
CRON_FILE="/etc/cron.d/$P-backup"
ROTATE_FILE="/etc/logrotate.d/$P-backup"
BACKUP_DIR="/root/backups/$P"
RECIPIENTS_FILE="/root/.$P-backup-recipients"
if [[ "$P" == kobi ]]; then DEFAULT_TIME="30 0"; else DEFAULT_TIME="50 0"; fi
CRON_TIME="${BACKUP_CRON_TIME:-$DEFAULT_TIME}"
[[ "$CRON_TIME" =~ ^([0-9]{1,2})\ ([0-9]{1,2})$ ]] && (( 10#${BASH_REMATCH[1]} < 60 && 10#${BASH_REMATCH[2]} < 24 )) \
  || { echo "BACKUP_CRON_TIME לא תקין: $CRON_TIME (דקה שעה, למשל \"50 0\")"; exit 1; }
CRON_HHMM="$(printf '%02d:%02d' "$((10#${CRON_TIME#* }))" "$((10#${CRON_TIME%% *}))")"
AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"

[[ $EUID -eq 0 ]] || { echo "יש להריץ כ-root"; exit 1; }
[[ -f "$BACKUP_SCRIPT" ]] || { echo "לא נמצא $BACKUP_SCRIPT — קודם git pull"; exit 1; }

echo "▶ 1. כלים"
if command -v rsync >/dev/null 2>&1; then
  echo "  ✓ rsync כבר מותקן"
else
  apt-get install -y -q rsync >/dev/null
  echo "  ✓ rsync הותקן"
fi
if [[ -n "$AGE_RECIPIENT" || -s "$RECIPIENTS_FILE" ]]; then
  if command -v age >/dev/null 2>&1; then
    echo "  ✓ age כבר מותקן"
  else
    apt-get install -y -q age >/dev/null
    echo "  ✓ age הותקן"
  fi
fi

echo "▶ 2. הצפנה (SEC-H6)"
if [[ -n "$AGE_RECIPIENT" ]]; then
  if [[ -f "$AGE_RECIPIENT" ]]; then
    grep -Eq '^age1[0-9a-z]{58}$' "$AGE_RECIPIENT" || { echo "  ✗ בקובץ $AGE_RECIPIENT אין מפתח age ציבורי (age1…)"; exit 1; }
    install -m 600 "$AGE_RECIPIENT" "$RECIPIENTS_FILE"
  else
    [[ "$AGE_RECIPIENT" =~ ^age1[0-9a-z]{58}$ ]] || { echo "  ✗ BACKUP_AGE_RECIPIENT אינו מפתח age ציבורי (age1…). מפתח פרטי (AGE-SECRET-KEY-…) לא מעבירים לשרת"; exit 1; }
    ( umask 077; printf '%s\n' "$AGE_RECIPIENT" > "$RECIPIENTS_FILE" )
  fi
  # בדיקה שההצפנה עובדת עם המפתח לפני שמסתמכים עליה
  echo test | age -R "$RECIPIENTS_FILE" > /dev/null
  echo "  ✓ המפתח הציבורי נשמר: $RECIPIENTS_FILE — המסד, הסודות וה-buckets הפרטיים יוצפנו"
elif [[ -s "$RECIPIENTS_FILE" ]]; then
  echo "  ✓ הצפנה כבר מוגדרת: $RECIPIENTS_FILE"
else
  echo "  ⚠ אין מפתח הצפנה — הגיבויים יישמרו לא מוצפנים (מסומנים UNENCRYPTED)."
  echo "    להפעלה: במחשב אישי age-keygen -o key.txt, ואז להריץ שוב עם BACKUP_AGE_RECIPIENT=age1…"
fi

echo "▶ 3. תיקיית הגיבויים"
mkdir -p "$BACKUP_DIR"
chmod 700 /root/backups "$BACKUP_DIR"
echo "  ✓ $BACKUP_DIR"

echo "▶ 4. תזמון לילי"
cat > "$CRON_FILE" <<EOF
# גיבוי יומי ל-$P (deploy/backup-daily.sh) — כל לילה ב-$CRON_HHMM לפי שעון השרת
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
$CRON_TIME * * * root BACKUP_PROJECT=$P /bin/bash $BACKUP_SCRIPT >> $LOG 2>&1
EOF
chmod 644 "$CRON_FILE"
echo "  ✓ $CRON_FILE (שעון השרת: $(date '+%H:%M %Z'))"

echo "▶ 5. סבב לוג"
cat > "$ROTATE_FILE" <<EOF
$LOG {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
echo "  ✓ $ROTATE_FILE"

echo "▶ 6. גיבוי ראשון (יכול לקחת דקה-שתיים)"
BACKUP_PROJECT="$P" /bin/bash "$BACKUP_SCRIPT" 2>&1 | tee -a "$LOG"
echo
BACKUP_PROJECT="$P" /bin/bash "$BACKUP_SCRIPT" --status

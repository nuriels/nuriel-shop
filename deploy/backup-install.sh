#!/usr/bin/env bash
# ============================================================
# התקנת הגיבוי היומי של קובי — מריצים פעם אחת בשרת:
#   bash /root/kobi-git/deploy/backup-install.sh
# מה זה עושה:
#   1. מתקין rsync אם חסר (לעותקים "חכמים" של קבצי ה-Storage)
#   2. יוצר את /root/backups/kobi (הרשאות root בלבד)
#   3. מתזמן גיבוי כל לילה ב-00:30 לפי שעון השרת (/etc/cron.d/kobi-backup)
#   4. מגדיר סבב ללוג (/var/log/kobi-backup.log)
#   5. מריץ גיבוי ראשון עכשיו ומציג את המצב
# בטוח להרצה חוזרת — פשוט כותב את אותם קבצים מחדש.
# ============================================================
set -Eeuo pipefail
trap 'echo -e "\033[1;31m✗ ההתקנה נעצרה בשורה ${LINENO}: ${BASH_COMMAND}\033[0m" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-daily.sh"
LOG=/var/log/kobi-backup.log

[[ $EUID -eq 0 ]] || { echo "יש להריץ כ-root"; exit 1; }
[[ -f "$BACKUP_SCRIPT" ]] || { echo "לא נמצא $BACKUP_SCRIPT — קודם git pull"; exit 1; }

echo "▶ 1. rsync"
if command -v rsync >/dev/null 2>&1; then
  echo "  ✓ כבר מותקן"
else
  apt-get install -y -q rsync >/dev/null
  echo "  ✓ הותקן"
fi

echo "▶ 2. תיקיית הגיבויים"
mkdir -p /root/backups/kobi
chmod 700 /root/backups /root/backups/kobi
echo "  ✓ /root/backups/kobi"

echo "▶ 3. תזמון לילי"
cat > /etc/cron.d/kobi-backup <<EOF
# גיבוי יומי לקובי (deploy/backup-daily.sh) — כל לילה ב-00:30 לפי שעון השרת
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 0 * * * root /bin/bash $BACKUP_SCRIPT >> $LOG 2>&1
EOF
chmod 644 /etc/cron.d/kobi-backup
echo "  ✓ /etc/cron.d/kobi-backup (שעון השרת: $(date '+%H:%M %Z'))"

echo "▶ 4. סבב לוג"
cat > /etc/logrotate.d/kobi-backup <<EOF
$LOG {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF
echo "  ✓ /etc/logrotate.d/kobi-backup"

echo "▶ 5. גיבוי ראשון (יכול לקחת דקה-שתיים)"
/bin/bash "$BACKUP_SCRIPT" 2>&1 | tee -a "$LOG"
echo
/bin/bash "$BACKUP_SCRIPT" --status

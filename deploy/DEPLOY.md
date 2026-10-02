# פריסה עצמאית מלאה על kobi.nuri1.fit — אפס תלות ב-Lovable

הכל רץ בשרת שלך: האפליקציה בקונטיינר `kobi-app` (פורט 3500), ומסד הנתונים +
Auth + Storage בסטאק Supabase self-hosted **רביעי** (7 קונטיינרים בשמות
`kobi-*`, Kong על `127.0.0.1:8300`). מבודד לחלוטין מ-nuri (8000), Moments
(8100) ומהמלאי הישן / inv (8200, אפליקציה 3400): שמות קונטיינרים, פורטים,
רשתות ותיקיות — הכל נפרד.

| רכיב | ערך |
|---|---|
| אפליקציה | https://kobi.nuri1.fit → 127.0.0.1:3500 → קונטיינר `kobi-app` |
| API מקומי | https://api-kobi.nuri1.fit → 127.0.0.1:8300 → Kong של `kobi-*` |
| סטאק Supabase | `/root/kobi-supabase/docker` · פרויקט compose בשם `kobi` |
| קונטיינרים | kobi-db, kobi-kong, kobi-auth, kobi-rest, kobi-storage, kobi-meta, kobi-studio |
| לא מורמים | realtime, supavisor, functions, imgproxy — האפליקציה לא צריכה אותם |
| פורטים תפוסים שנעקפו | 5432/6543 → 5436/6545 · 8000/8100/8200 → 8300 · 8443/8245 → 8345 |
| סודות | `/root/kobi-supabase/docker/.env` — לגבות! |
| ריפו בשרת | לבחירתך, למשל `/root/kobi-git` |

## סדר ההקמה (פעם אחת)

1. **DNS** (Namecheap): רשומות A בשם `kobi` וב-`api-kobi` → `62.219.106.202`
   (אותו דפוס כמו `n` + `api-n` הקיימים).
2. **שכפול הריפו** ל-`/root/kobi-git` מהענף שרוצים לפרוס (ראו את הפקודה
   המדויקת שנמסרה בצ'אט — כוללת טוקן).
3. **הקמת הסטאק**: `ADMIN_PASSWORD='...' bash deploy/setup-selfhost.sh`
   (מריץ את כל המיגרציות, כולל יצירת buckets ציבוריים ומשתמש אדמין).
4. **Nginx + certbot** לשני תתי-הדומיינים (קבצי התבנית ב-`deploy/nginx-*.conf`).
5. **Build לאפליקציה**: `docker compose build && docker compose up -d`.
6. **הגדרות מייל**: להירשם/להתחבר כאדמין ב-https://kobi.nuri1.fit, לפתוח
   ניהול → הגדרות מייל, ולמלא כתובת שולחת מאומתת ב-Resend + נמעני התראה.
   בצד השרת יש להגדיר גם את `RESEND_API_KEY` ב-`.env.production` ואז
   `docker compose up -d` מחדש.
7. **נטפרי**: לוודא שהבקשה הקיימת ל-`*.nuri1.fit` מכסה גם את kobi/api-kobi
   (אם לא — HTTP 418 בגלישה מרשתות מסוננות).

הסקריפט אידמפוטנטי: הרצה חוזרת לא דורסת סודות קיימים ולא מריצה מיגרציות פעמיים.

## עדכון גרסה שוטף

```bash
cd /root/kobi-git && git pull
bash deploy/setup-selfhost.sh --env-only   # משחזר .env/.env.production (אינם ב-git)
docker compose build && docker compose up -d
```

## מיגרציה חדשה

```bash
docker exec -i kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /root/kobi-git/supabase/migrations/FILE.sql
docker restart kobi-rest
```

## פקודות שימושיות

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep kobi-      # סטטוס הסטאק
docker compose -p kobi -f /root/kobi-supabase/docker/docker-compose.yml logs -f kong
docker exec kobi-db psql -U postgres -d postgres -c "\dt public.*"
docker logs --since 5m kobi-storage
docker logs --since 5m kobi-app
```

## אבטחה

מחירי דרג אחר לא נחשפים ללקוח — `get_catalog()` מחזיר רק את המחיר שכבר
מחושב לקבוצת המחיר שלו. פאנל הניהול נעול ב-RLS לתפקיד `admin` בטבלת
`user_roles`, לא לאימייל ספציפי בקוד. Kong, Postgres וה-Studio קשורים
ל-loopback בלבד — הגישה היחידה מבחוץ דרך Nginx עם TLS. Studio זמין
ב-https://api-kobi.nuri1.fit (משתמש `nuriels`, סיסמה ב-`.env` של הסטאק).

הרשמת לקוחות חדשים פתוחה (בכפוף לאישור מנהל) עם אישור-מייל אוטומטי, כי אין
SMTP; מיילי הזמנה עצמם עוברים דרך Resend (`RESEND_API_KEY`), לא דרך ה-SMTP
של GoTrue. בקשות איפוס סיסמה מבוצעות ע"י אדמין/סוכן מפאנל הניהול/הסוכן.

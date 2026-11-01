# מדריך התקנה ועדכון — Nuriel Hospitality בשרת המאובטח

המדריך מיועד לשרת שכבר מריץ את הפלטפורמה. הסטאק הוקם ב-`deploy/setup-selfhost.sh`: אפליקציה
בקונטיינר, Supabase self-hosted ו-Nginx. הוא מתאר את הענף `hospitality/stage-2`.

**שום דבר כאן לא בוצע על ידי Claude** — כל הפקודות הן לביצוע שלך, לפי הסדר.

**עקרון ההפעלה:** Hospitality כבוי כברירת מחדל בשלוש שכבות:
1. משתנה הסביבה `HOSPITALITY_ENGINE`;
2. דגלי הפלטפורמה;
3. דגלים לכל עסק.

החנויות (Ecommerce) לא מושפעות מאף שלב. כל שלב הפיך (§12).

> **משתני `HOSPITALITY_*` ("תיקון A"):**
> - `docker-compose.yml` מעביר אותם לקונטיינר;
> - `setup-selfhost.sh` שומר אותם בין הרצות.
>
> בגרסאות שלפני התיקון הם לא הגיעו לאפליקציה, והמנוע לא נדלק.
>
> בדיקה שהקוד בשרת כולל את התיקון: `grep -c HOSPITALITY_ "$APP_DIR/docker-compose.yml"` — 3 ומעלה.

---

## משתנים — מגדירים פעם אחת בכל חלון טרמינל

```bash
PROJECT=nuriel-shop                  # הקידומת של הקונטיינרים (nuriel-shop-db, nuriel-shop-rest …)
APP_DIR=/root/nuriel-shop-git        # הריפו שממנו נבנית האפליקציה
SB_DIR=/root/nuriel-shop-supabase    # הסטאק של Supabase (הקבצים ב-$SB_DIR/docker)
APP_PORT=3700                        # האפליקציה ב-127.0.0.1
KONG=http://127.0.0.1:8500           # ה-API המקומי (Kong)
SB_SERVICES="db meta studio kong auth rest storage imgproxy"   # imgproxy עולה עם ה-storage
DB=$PROJECT-db
APP=$PROJECT-app
```

**אימות השמות** (אם משהו שונה — מתקנים את המשתנים, לא את הפקודות):

```bash
docker ps --format '{{.Names}}' | grep "^$PROJECT-"                                              # 9 קונטיינרים (כולל imgproxy)
docker inspect "$APP" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' # = $APP_DIR
docker inspect "$DB"  --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' # = $SB_DIR/docker
docker port "$APP"                                                                               # 127.0.0.1:3700
```

שרת במבנה הישן של `deploy/DEPLOY.md`:
- `PROJECT=kobi`, `APP_DIR=/root/kobi-git`, `SB_DIR=/root/kobi-supabase`;
- `APP_PORT=3500`, `KONG=http://127.0.0.1:8300`.

---

## 0. בדיקות מקדימות (קריאה בלבד)

```bash
cd "$APP_DIR" && git status --short | grep -v '^??'        # ריק — אין שינויים מקומיים בקבצים של git
git -C "$APP_DIR" log --oneline -1                          # הגרסה שרצה היום
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT to_regclass('public._migrations_applied')"
                                                            # public._migrations_applied
df -h /root | tail -1                                       # מקום פנוי לגיבוי (לפחות פי 3 מגודל המסד + הקבצים)
```

## 1. גיבוי — לפני כל שינוי

```bash
BK=/root/backups/$PROJECT/pre-hospitality-$(date +%Y%m%d-%H%M)
mkdir -p "$BK" && chmod 700 "$(dirname "$BK")" "$BK" && echo "$BK"
```

**לרשום את הנתיב.** בחלון טרמינל חדש מגדירים אותו מחדש:
`BK=$(ls -d /root/backups/$PROJECT/pre-hospitality-* | tail -1)`.

### 1.1 מסד הנתונים (בלי השבתה)

```bash
docker exec "$DB" pg_dump -U postgres -d postgres -Fc > "$BK/db.dump"
docker exec -i "$DB" pg_restore --list < "$BK/db.dump" > "$BK/db.toc"
grep -c "TABLE DATA" "$BK/db.toc"                           # מספר גדול מ-0 — הקובץ תקין
docker exec "$DB" psql -U postgres -d postgres -tAc \
  "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$BK/applied-before.txt"
```

### 1.2 סודות, הגדרות, תעודות וקבצים

```bash
cp -p "$APP_DIR/.env" "$BK/app.env"
cp -p "$APP_DIR/docker-compose.override.yml" "$BK/app-compose.override.yml"
cp -p "$SB_DIR/docker/.env" "$BK/supabase.env"
cp -p "$SB_DIR/docker/docker-compose.override.yml" "$BK/supabase-compose.override.yml" 2>/dev/null || true
tar -czf "$BK/nginx.tgz" -C / etc/nginx
tar -czf "$BK/letsencrypt.tgz" -C / etc/letsencrypt
STORAGE_SRC=$(docker inspect "$PROJECT-storage" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Source}}{{end}}{{end}}')
echo "$STORAGE_SRC"                                         # לא ריק
tar -czf "$BK/storage.tgz" -C "$STORAGE_SRC" .
git -C "$APP_DIR" rev-parse HEAD > "$BK/app-commit.txt"
```

### 1.3 ה-image הנוכחי של האפליקציה — לחזרה מיידית

```bash
IMG=$(docker inspect "$APP" --format '{{.Config.Image}}'); echo "$IMG" | tee "$BK/app-image.txt"
docker tag "$IMG" "${IMG%:*}:pre-hospitality"
```

### 1.4 טביעות אצבע ועותק מוצפן מחוץ לשרת

```bash
(cd "$BK" && sha256sum -- * > SHA256SUMS)
tar -C "$(dirname "$BK")" -cf - "$(basename "$BK")" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out "$BK.tar.enc"
```

- **הסיסמה:** `openssl` מבקש סיסמה **חדשה** שבוחרים עכשיו (פעמיים, בלי שתוצג).
  - היא רק לקובץ המוצפן — לא סיסמה של השרת או של Supabase.
  - שומרים אותה במנהל סיסמאות, בנפרד מהקובץ. בלעדיה אי אפשר לפתוח את העותק.
- **בדיקה שהסיסמה עובדת** (מבקש אותה שוב ומציג את רשימת הקבצים):
  `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$BK.tar.enc" | tar -tf - | head`.
- **העותק:** מעתיקים את `$BK.tar.enc` אל מחוץ לשרת (`scp` / `rclone`).
- **פתיחה:** `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in <file> | tar -xf -`.

### 1.5 מומלץ לפני ההתקנה הראשונה — עותק "קר" מלא (2–5 דקות השבתה של האתרים)

זה העותק היחיד שמשחזר את **הכול** בדיוק: המסד, הקבצים וההגדרות של Supabase.
- `pg_dump` (1.1) טוב לשחזור נתונים נקודתי.
- שחזור מלא של מסד Supabase מתוך `pg_dump` מסובך — בעיות בעלות ותפקידים.

עושים את זה בשעה שקטה:

```bash
docker stop "$APP"
cd "$SB_DIR/docker" && docker compose -p "$PROJECT" stop $SB_SERVICES
tar -czf "$BK/supabase-volumes.tgz" -C "$SB_DIR/docker" volumes
docker volume ls --format '{{.Name}}' | grep db-config      # ${PROJECT}_db-config
tar -czf "$BK/db-config.tgz" -C "$(docker volume inspect "${PROJECT}_db-config" --format '{{.Mountpoint}}')" .
docker compose -p "$PROJECT" start $SB_SERVICES
until docker exec "$DB" pg_isready -U postgres -q; do sleep 2; done
docker start "$APP"
sleep 15; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$APP_PORT/robots.txt"   # 200
```

השחזור של כל חלק — ב-§12.

**הגיבוי היומי** (`deploy/backup-daily.sh`):
- ברירות המחדל שלו הן של `kobi`. לסטאק הזה מעבירים משתנים:
  ```bash
  BACKUP_ROOT=/root/backups/nuriel-shop DB_CONTAINER=nuriel-shop-db \
    STORAGE_CONTAINER=nuriel-shop-storage SUPABASE_ENV=/root/nuriel-shop-supabase/docker/.env \
    APP_DIR=/root/nuriel-shop-git bash /root/nuriel-shop-git/deploy/backup-daily.sh
  ```
- הוא מעתיק הגדרות Nginx רק לשמות `*kobi*`. Nginx של הסטאק הזה — ב-1.2.
- לפני שנכנס מידע אמיתי של אורחים: לוודא שהגיבוי היומי רץ, ושהעותק מחוץ לשרת **מוצפן**
  (ממצא PRIV-08).

## 2. הקוד

```bash
cd "$APP_DIR"
git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2"
git checkout -B hospitality/stage-2 origin/hospitality/stage-2
git log --oneline -1
cp -r supabase/rollbacks "$BK/rollbacks"                    # קובצי ה-rollback — גם אחרי חזרה לגרסה הקודמת
```

**התיקייה:** אותה תיקייה שממנה רצה האפליקציה.
- בה נמצאים `.env` ו-`docker-compose.override.yml`. הם לא ב-git.
- שכפול לתיקייה אחרת ו-`docker compose up` משם יחליפו את הקונטיינר `$APP` הקיים (אותו שם).

**החנויות:** הענף כולל את כל `main` (0 קומיטים מאחור). החנויות מקבלות אותו קוד.

## 3. מיגרציות המסד

הענף מוסיף 28 מיגרציות על `main`: 2 של הפלטפורמה, 26 של Hospitality. לכל אחת יש קובץ rollback
ב-`supabase/rollbacks/` (§12).

| # | קובץ | מה |
|---|---|---|
| 1 | `20261101090000_platform_products_flags` | סוג אתר (ecommerce / hospitality), מוצרי פלטפורמה, דגלים |
| 2 | `20261101100000_ecommerce_engine_guard` | חנות לא כותבת לטבלאות של מנוע אחר |
| 3 | `20261101110000_hosp_schema` | הסכמה `hospitality`, הגדרות, מדיניות, יחידות, דלי `hosp-media` |
| 4 | `20261101120000_hosp_booking` | מנוע ההזמנות (EXCLUDE נגד הזמנה כפולה), אורחים, תור מיילים |
| 5 | `20261101130000_hosp_billing_admin` | חבילות, מנויים, מגבלות |
| 6 | `20261101140000_hosp_coupon_release` | שחרור קופון |
| 7 | `20261101150000_hosp_management_foundation` | אזור הניהול, מקומות מנהלים |
| 8 | `20261101160000_hosp_settings_team` | הגדרות, צוות, יומן פעולות |
| 9 | `20261101170000_hosp_site_identity` | שם האתר לכותרת |
| 10 | `20261101180000_hosp_catalog` | מתחמים ויחידות |
| 11 | `20261101190000_hosp_details` | פרטים, מידע הגעה |
| 12 | `20261101200000_hosp_media` | תמונות וגלריות |
| 13 | `20261101210000_hosp_pricing` | מחירים, כללים, מדיניות ביטול |
| 14 | `20261101220000_hosp_calendar` | לוח וחסימות |
| 15 | `20261102090000_hosp_platform_open` | פתיחת עסק מהפאנל |
| 16 | `20261102100000_hosp_bookings_staff` | הזמנות לצוות |
| 17 | `20261102110000_hosp_guests` | אורחים ופרטיות |
| 18 | `20261102120000_hosp_emails_dashboard` | מיילים ולוח בקרה |
| 19 | `20261102130000_hosp_public_site` | האתר הציבורי |
| 20 | `20261102140000_hosp_site_switches` | מתגי האתר וההזמנות |
| 21 | `20261102150000_hosp_site_design` | עורך האתר, גרסאות |
| 22 | `20261102160000_hosp_room_types` | סוגי חדרים (מלונות) |
| 23 | `20261102170000_hosp_payments` | יומן תשלומים |
| 24 | `20261102180000_hosp_channels` | סנכרון iCal |
| 25 | `20261103090000_hosp_security` | **D1:** הגבלת קצב משותפת, בקשת הזמנה לשרת בלבד |
| 26 | `20261103100000_hosp_site_theme` | **D2:** ערכה בפתיחת עסק |
| 27 | `20261103110000_hosp_channel_alerts` | **D3:** מייל על התנגשות, מקור התפוסה |
| 28 | `20261103120000_hosp_phone_payments` | **D4:** תשלום טלפוני — תיקון מצב תשלום, מערכת אחת, בלי מספרי כרטיס |

**טרנזקציות:**
- **מיגרציות 1–24:** כל אחת עטופה ב-`BEGIN` / `COMMIT`. שגיאה = כלום לא נשאר.
- **מיגרציות 25–28:** לא עטופות, אבל כתובות להרצה חוזרת (`CREATE OR REPLACE`, `IF NOT EXISTS`,
  `DROP … IF EXISTS` לפני `CREATE`). אם אחת נעצרת באמצע — מתקנים ומריצים שוב, והיא משלימה.

**המנגנון:** אותו מנגנון כמו `deploy/setup-selfhost.sh` — הטבלה `public._migrations_applied`, ורק
מה שעוד לא הוחל. כאן הוא מורץ ישירות, בלי הרצה מלאה של `setup-selfhost.sh`. הסיבות:
- הסקריפט גם כותב מחדש את `.env` (§5);
- הוא מחזיר את השם וה-slug של חנות ברירת המחדל לערכי ברירת המחדל שלו;
- הוא מעדכן את כתובות ה-Auth לפי ברירות המחדל, אם לא מעבירים אותן.

### 3.1 בדיקה יבשה — מה עומד לרוץ

```bash
cd "$APP_DIR"
ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > "$BK/files.txt"
LC_ALL=C comm -23 "$BK/files.txt" "$BK/applied-before.txt" | tee "$BK/pending.txt"
wc -l < "$BK/pending.txt"                                   # 28
grep -vc '^2026110[123]' "$BK/pending.txt"                  # 0
```

**עוצרים אם התוצאה שונה** — למשל, מופיע קובץ ישן של החנויות.
- **מה זה אומר:** הקובץ הוחל פעם ידנית ולא נרשם.
- **סכנה:** הלולאה תריץ אותו שוב.
- **מה עושים:** מוודאים במסד שהשינוי שלו קיים, ורושמים אותו בלבד:
  `INSERT INTO public._migrations_applied (filename) VALUES ('<file>')`.
- **בספק:** לא ממשיכים.

### 3.2 הרצה

```bash
cd "$APP_DIR"
for name in $(cat "$BK/pending.txt"); do
  echo "=== $name"
  docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "supabase/migrations/$name" \
    || { echo "נעצר ב-$name"; break; }
  docker exec "$DB" psql -U postgres -d postgres -qc \
    "INSERT INTO public._migrations_applied (filename) VALUES ('$name')"
done
```

הלולאה נעצרת בשגיאה הראשונה, וקובץ שנכשל לא נרשם. אחרי תיקון מריצים שוב את 3.1 ו-3.2. הלולאה
ממשיכה מאותו מקום.

### 3.3 בדיקה ורענון ה-API

```bash
docker exec "$DB" psql -U postgres -d postgres -c "
  SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '2026110%') AS applied,  -- 28
         (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r') AS tables,  -- 29
         (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r') AS rls_all,  -- t
         (SELECT count(*) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%' AND enabled) AS flags_on,  -- 0
         (SELECT bool_and(site_type = 'ecommerce') FROM public.tenants) AS stores_untouched,  -- t
         has_function_privilege('anon', 'hospitality.rate_check(jsonb)', 'EXECUTE') AS anon_rate_check,  -- f
         has_function_privilege('anon', 'hospitality.request_booking(uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE') AS anon_request;  -- f"
docker exec "$DB" psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

## 4. חשיפת הסכמה ל-API

**רק אחרי §3.** סכמה חשופה שעוד לא קיימת מפילה את **כל** ה-API (503), כולל החנויות.

```bash
cd "$SB_DIR/docker"
grep '^PGRST_DB_SCHEMAS=' .env                              # הערך הנוכחי — מוסיפים לו, לא מחליפים
grep -q '^PGRST_DB_SCHEMAS=.*hospitality' .env \
  || sed -i -E 's/^PGRST_DB_SCHEMAS="?([^"]*)"?$/PGRST_DB_SCHEMAS=\1,hospitality/' .env
grep '^PGRST_DB_SCHEMAS=' .env                              # …,hospitality
docker compose -p "$PROJECT" up -d --no-deps rest           # יצירה מחדש עם הערך החדש
docker inspect "$PROJECT-rest" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_DB_SCHEMAS
sleep 15; docker inspect "$PROJECT-rest" --format '{{.State.Health.Status}}'   # healthy
```

**למה לא `docker restart`:**
- `docker restart` שומר את הסביבה הישנה של הקונטיינר.
- רק `up -d` יוצר אותו מחדש עם `.env`.
- `--no-deps` — לא נוגע במסד ובשאר השירותים.

**בדיקה** — דרך Kong המקומי, ישירות:

```bash
ANON=$(grep '^ANON_KEY=' "$SB_DIR/docker/.env" | cut -d= -f2-)
SERVICE=$(grep '^SERVICE_ROLE_KEY=' "$SB_DIR/docker/.env" | cut -d= -f2-)
# 1. החנויות עובדות (ה-SSR קורא מה-API) — 200
curl -s -o /dev/null -w 'store: %{http_code}\n' "$(grep '^PUBLIC_SITE_URL=' "$APP_DIR/.env" | cut -d= -f2-)/"
# 2. גולש אנונימי חסום בסכמה — 401 עם "42501" (ולא PGRST106 — זה אומר שהסכמה לא חשופה)
curl -s "$KONG/rest/v1/units?limit=1" -H "apikey: $ANON" -H "Accept-Profile: hospitality"; echo
# 3. המונה המשותף של הגבלת הקצב עובד עם מפתח השירות — {"hits": [1], "allowed": true, "retry_after": 0}
curl -s -X POST "$KONG/rest/v1/rpc/rate_check" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -H "Content-Profile: hospitality" \
  -d '{"_rules":[{"key":"install-check-0001","limit":5,"window":60}]}'; echo
unset ANON SERVICE
```

## 5. משתני הסביבה של האפליקציה

**איפה:** רק ב-`$APP_DIR/.env`.
- `docker compose` קורא אותו לבד. הוא לא ב-git ולא בתוך ה-image.
- `.env.production` **לא** נקרא (שם ישן מ-`DEPLOY.md`).

**איך מגיעים לקונטיינר:** רק משתנה שרשום תחת `environment:` ב-`docker-compose.yml` מגיע
לאפליקציה. שלושת `HOSPITALITY_*` רשומים שם.

| משתנה | ערך | הערה |
|---|---|---|
| `HOSPITALITY_ENGINE` | **ריק** עד §9; אז `on` | **המתג הכללי.** רק `on` מפעיל. ריק או כל ערך אחר — כבוי: אין עמוד, פונקציה או תהליך רקע של Hospitality |
| `HOSPITALITY_SECRET` | `openssl rand -hex 32` (64 תווים) | **חדש (D1).** HMAC למפתחות של הגבלת הקצב ולחתימת אתגרי ה-CAPTCHA. פרטים מתחת לטבלה |
| `HOSPITALITY_POW_MAX` | לא חובה (ברירת מחדל 50000) | הקושי של אתגר ה-CAPTCHA. ערך מחוץ ל-1000–2000000 — ברירת המחדל |
| `LOGIN_CODE_SECRET` | קיים / מומלץ | סוד לקודי הכניסה במייל, נפרד ממפתח השירות (AUTH-09). גם הוא נמחק בהרצה של `setup-selfhost.sh` (פרטים מתחת לטבלה) |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | קיימים | המיילים של העסקים יוצאים דרכם |
| `TENANT_BASE_DOMAIN` | קיים | כתובות העסקים: `<slug>.<domain>` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | קיימים | |

**`HOSPITALITY_SECRET`:**
- **בלעדיו:** נגזר מ-`LOGIN_CODE_SECRET`, ואם גם הוא חסר — ממפתח השירות. זה עובד, אבל עדיף סוד
  נפרד.
- **כמה שרתים:** **אותו ערך בכל שרתי האפליקציה.** עם ערכים שונים כל שרת סופר לבד, ואתגר שנוצר
  בשרת אחד נכשל בשני.
- **גיבוי:** לשמור בגיבוי הסודות.
- **החלפה:** המונים מתאפסים, ואתגרים פתוחים נכשלים (לכל היותר 30 דקות).

**הרצה חוזרת של `setup-selfhost.sh`:** הסקריפט כותב את `.env` מחדש (גם עם `--env-only`).
- **`HOSPITALITY_*`:** נשמרים, ו-`HOSPITALITY_SECRET` נוצר פעם אחת אם חסר.
- **משתנים שהסקריפט לא כותב:** נמחקים — למשל `LOGIN_CODE_SECRET` ו-`SERVER_PUBLIC_IPS`.
  אחרי הרצה מוסיפים אותם שוב.

**כבר עכשיו** (המנוע עדיין כבוי, אז זה לא משנה כלום):

```bash
cd "$APP_DIR"
sed -i '/^HOSPITALITY_SECRET=$/d' .env
grep -q '^HOSPITALITY_SECRET=.' .env || echo "HOSPITALITY_SECRET=$(openssl rand -hex 32)" >> .env
grep -c '^HOSPITALITY_ENGINE=on' .env                       # 0 — עדיין כבוי
cp -p .env "$BK/app.env.with-secret"                        # הסוד בגיבוי
```

## 6. Nginx ו-HTTPS

### 6.1 IP אמיתי — קיים, לבדיקה

```bash
nginx -T 2>/dev/null | grep -n 'X-Real-IP'                  # בכל השורות: X-Real-IP $remote_addr
```

- **בצד של Hospitality:** הקוד קורא קודם את `X-Real-IP` (`security/client-ip.ts`), ואחריו את
  **ההופ האחרון** ב-`X-Forwarded-For`.
- **מה זה נותן:** כותרת מזויפת מהדפדפן לא משנה את הכתובת שנספרת.

### 6.2 מומלץ: `X-Forwarded-For $remote_addr` — רק בבלוקים של האתרים

**מה זה סוגר:** את ממצא AUTH-03 בקוד הכניסה המשותף של החנויות. הקוד הזה קורא את הערך **הראשון**
ב-`X-Forwarded-For`, ואפשר לזייף אותו.

**איפה:** רק בבלוקים שמפנים ל-`127.0.0.1:$APP_PORT`:
- הבלוק הראשי של האתר;
- ה-snippet המשותף של העסקים והחנויות (`/etc/nginx/snippets/nuriel-app-proxy.conf`).

```bash
for f in $(grep -l "127.0.0.1:$APP_PORT" /etc/nginx/sites-available/* /etc/nginx/snippets/*); do
  echo "== $f"
  sed -i 's/X-Forwarded-For \$proxy_add_x_forwarded_for/X-Forwarded-For $remote_addr/' "$f"
done
nginx -t && systemctl reload nginx
```

- **לא בבלוק של ה-API** (`api-…` → `127.0.0.1:8500`):
  - האפליקציה שולחת למסד את ה-IP של האורח בכותרת הזו, ואסור לדרוס אותה שם.
  - דריסה שם תרשום את כתובת השרת בכל הזמנה (בדיקה S8).
- **`install-store-certs.sh`:** הרצה חוזרת כותבת את ה-snippet מחדש. אחריה — לחזור על הצעד.

### 6.3 הגבלת קצב ב-Nginx — לא חובה

**כבר מוגן באפליקציה, בלי Nginx:**
- **בקשות הזמנה:** מונה משותף במסד, לכל השרתים.
- **הכניסה לניהול:**
  - 5 קודים שגויים מבטלים את הקוד — במסד;
  - בקשת קודים ובדיקתם מוגבלות לפי כתובת — בזיכרון של כל שרת.

**לא להוסיף `limit_req` לפי כתובת:**
- **ל-`/rest/v1/` או לכל ה-API:**
  - האפליקציה קוראת ל-API מהכתובת של השרת עצמו: SSR של כל החנויות, `rate_check` וההזמנות;
  - הגבלה לפי כתובת שם מגבילה את כל המשתמשים יחד ומפילה את האתרים;
  - `rate_check` שנחסם נופל להגבלה בזיכרון.
- **ל-`/_serverFn/`:**
  - הנתיב משותף לחנויות;
  - גולשים מאחורי פרוקסי משותף (נטפרי, רשת של מקום עבודה) חולקים כתובת אחת.

**אופציונלי — כניסה ישירה ל-Auth מבחוץ (ממצא AUTH-02):** הגבלה רק על
- כניסה בסיסמה ישירות ל-`/auth/v1/token`;
- קודים, אימות והרשמה ישירים.

הכתובות של השרת עצמו פטורות. מתחילים במצב **ניסיון** (`limit_req_dry_run` — רק רישום בלוג).

```bash
SERVER_IP=$(curl -fsS --max-time 10 https://api.ipify.org); echo "$SERVER_IP"    # לא ריק
cat > /etc/nginx/conf.d/nuriel-auth-limit.conf <<'EOF'
# Nuriel — הגבלת כניסה ישירה ל-Auth (נטען בתוך http {}). מפתח ריק = לא נספר.
geo $nuriel_internal {
    default        0;
    127.0.0.0/8    1;
    ::1            1;
    172.16.0.0/12  1;     # רשתות Docker — האפליקציה
    SERVER_IP      1;     # הכתובת הציבורית של השרת
}
# כניסה בסיסמה מבחוץ — לפי כתובת. רענון טוקן (grant_type=refresh_token) — לא מוגבל
map "$nuriel_internal:$arg_grant_type" $nuriel_pw_key {
    "0:password"  $binary_remote_addr;
    default       "";
}
map $nuriel_internal $nuriel_ext_key {
    0        $binary_remote_addr;
    default  "";
}
limit_req_zone $nuriel_pw_key  zone=nuriel_pw:10m   rate=10r/m;
limit_req_zone $nuriel_ext_key zone=nuriel_code:10m rate=10r/m;
EOF
sed -i "s/SERVER_IP /$SERVER_IP /" /etc/nginx/conf.d/nuriel-auth-limit.conf
grep -A6 '^geo' /etc/nginx/conf.d/nuriel-auth-limit.conf     # הכתובת במקום SERVER_IP

cat > /etc/nginx/snippets/nuriel-api-auth-limit.conf <<'EOF'
# Nuriel — נכלל בבלוק ה-443 של כתובת ה-API, לפני "location /"
location = /auth/v1/token {
    limit_req zone=nuriel_pw burst=10 nodelay;
    limit_req_status 429;
    limit_req_dry_run on;
    proxy_pass KONG_URL;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ~ ^/auth/v1/(otp|verify|recover|signup|magiclink)$ {
    limit_req zone=nuriel_code burst=10 nodelay;
    limit_req_status 429;
    limit_req_dry_run on;
    proxy_pass KONG_URL;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
EOF
sed -i "s|KONG_URL|$KONG|" /etc/nginx/snippets/nuriel-api-auth-limit.conf
grep -l "proxy_pass $KONG" /etc/nginx/sites-available/*      # הקובץ של ה-API
```

**חיבור לבלוק של ה-API** — עריכה ידנית בקובץ שהודפס:
1. בבלוק `server {` שיש בו `listen 443 ssl`, מוסיפים שורה **מעל** `location / {`:
   `include /etc/nginx/snippets/nuriel-api-auth-limit.conf;`
2. בודקים וטוענים: `nginx -t && systemctl reload nginx`.

**ניסיון — שבוע:**

```bash
grep 'dry run' /var/log/nginx/error.log | grep -c 'nuriel_'   # כמה בקשות היו נחסמות
```

- **אם אין חסימות של משתמשים אמיתיים**, מפעילים בפועל:
  ```bash
  sed -i '/limit_req_dry_run on;/d' /etc/nginx/snippets/nuriel-api-auth-limit.conf && nginx -t && systemctl reload nginx
  ```
- **ביטול:** מוחקים את שני הקבצים ואת שורת ה-`include`, ואז `nginx -t && systemctl reload nginx`.

**דרישות ובדיקה:**
- `nginx -v` 1.17.1 ומעלה (בגלל `limit_req_dry_run`).
- כניסה רגילה באתר ממשיכה לעבוד: היא עוברת דרך השרת, והשרת פטור.

### 6.4 HTTPS לכל עסק

**כמו לחנויות:**
- סוכן התעודות (`deploy/ssl/store-certs.sh`, כל דקה) מוציא תעודת Let's Encrypt לכל אתר ב-`tenants`,
  כולל עסקי אירוח.
- הוא דורש:
  - רשומת DNS כללית `*.<TENANT_BASE_DOMAIN>`;
  - הרצה חד-פעמית של `deploy/ssl/install-store-certs.sh`.

```bash
systemctl is-active nuriel-store-certs.timer               # active
journalctl -u nuriel-store-certs --since "-15min" -o cat | grep '\[store-certs\]'
```

**אחרי פתיחת עסק** (§9.3) — בודקים לפני הדלקת האתר שלו:

```bash
curl -sI "http://<slug>.<domain>/" | head -3               # 301 → https
curl -s -o /dev/null -D - "https://<slug>.<domain>/manage/login" | grep -i strict-transport   # HSTS
```

- **עד שהתעודה מוכנה** (כדקה): הכתובת עונה ב-http בלבד.
- **לא מדליקים אתר או הזמנות** של עסק בלי https.
- **HSTS:** האפליקציה שולחת אותו בעמודי Hospitality — 180 יום, בלי `includeSubDomains`.

### 6.5 גודל העלאה

**היום:** `client_max_body_size 25m`.
- לתמונות זה מספיק — הדפדפן מקטין לפני ההעלאה.
- הדלי `hosp-media` מקבל עד 50MB לקובץ.

**לסרטונים גדולים:** `50m` ב-snippet של האפליקציה, ואז `nginx -t && systemctl reload nginx`.

## 7. GoTrue (Supabase Auth)

**ל-Hospitality לא נדרש שינוי:**
- **בקשת הזמנה:** לא משתמשת בחשבונות GoTrue. היא עוברת רק דרך שרת האפליקציה (D1).
- **כניסת בעלים וצוות:** קוד במייל דרך האפליקציה.

**לא להגדיר `GOTRUE_RATE_LIMIT_HEADER`:**
- הכניסה בסיסמה עוברת דרך שרת האפליקציה, ולכן GoTrue רואה כתובת אחת לכל המשתמשים.
- מגבלה לפי כתובת תהיה מגבלה משותפת: כמה עשרות כניסות ב-5 דקות יחסמו את כולם.
- בלי הכותרת GoTrue לא מפעיל מגבלות לפי כתובת. ההגנה מכניסה ישירה מבחוץ — §6.3.

**`GOTRUE_RATE_LIMIT_*` ב-`$SB_DIR/docker/.env` לבד לא עושים כלום:** שירות ה-`auth` מקבל רק את
המשתנים שרשומים לו ב-compose של Supabase. אם בכל זאת רוצים לשנות:
1. מוסיפים אותם ב-`$SB_DIR/docker/docker-compose.override.yml`, תחת `services.auth.environment`.
2. מוודאים ש-`COMPOSE_FILE` ב-`.env` שם כולל את הקובץ.
3. מריצים `docker compose -p "$PROJECT" up -d --no-deps auth`.

הערות:
- `setup-selfhost.sh` עם `GOOGLE_*` כותב את הקובץ הזה מחדש.
- הגרסה: `docker inspect $PROJECT-auth --format '{{.Config.Image}}'`. בקומיט הנעוץ של הסקריפט:
  `v2.189.0`.

**הרשמה פתוחה** (`DISABLE_SIGNUP=false`, ללקוחות החנויות) — בסדר ל-Hospitality.

## 8. בנייה והעלאה — המנוע עדיין כבוי

```bash
cd "$APP_DIR"
docker compose build
docker compose up -d
docker compose ps                                           # healthy אחרי כדקה
docker logs --since 3m "$APP" 2>&1 | tail -50
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$APP_PORT/robots.txt"   # 200
docker exec "$APP" sh -c 'printf %s "$HOSPITALITY_SECRET" | wc -c'   # 64
docker exec "$APP" printenv HOSPITALITY_ENGINE              # ריק — כבוי
```

**בדיקת חנויות (Ecommerce):**
- עמוד בית, מוצר, כניסה, עגלה → תשלום, ניהול, פאנל הפלטפורמה;
- `sitemap.xml` ו-`robots.txt`;
- בלי שגיאות בלוגים: `docker logs --since 30m "$APP" 2>&1 | grep -i error | tail -20`.

> **פתוח מ-Stage 1:** ה-health check של Docker בודק רק את `/robots.txt`, שלא עובר דרך ה-SSR. זה
> לא מזהה build שבור. **לפני ייצור:** health check שעובר דרך ה-handler.

## 9. הפעלת Hospitality — בהדרגה

### 9.1 המתג

```bash
cd "$APP_DIR"
grep -c HOSPITALITY_ docker-compose.yml                     # 3 ומעלה
sed -i '/^HOSPITALITY_ENGINE=/d' .env && echo 'HOSPITALITY_ENGINE=on' >> .env
docker compose up -d                                        # יוצר מחדש את הקונטיינר עם הערכים (בלי build)
docker exec "$APP" printenv HOSPITALITY_ENGINE              # on
docker exec "$APP" sh -c 'printf %s "$HOSPITALITY_SECRET" | wc -c'   # 64
docker logs --since 2m "$APP" 2>&1 | grep '\[hospitality' | tail
```

- **ריק:** אם `printenv` מחזיר ריק, הקוד בשרת מלפני תיקון A. בודקים עם `git log --oneline -3`.
  המנוע כבוי.
- **תהליך הרקע** עולה עם האפליקציה:
  - כל 30 שניות: מיילים ותפוגת בקשות;
  - כל 5 דקות: סנכרון יומנים;
  - כל 10 דקות: ניקוי מוני הגבלת הקצב;
  - פעם ביום: שמירת מידע (מחיקת אורחים ישנים לפי ההגדרה).
- **כמה קונטיינרים במקביל:** בטוח. התור והסנכרון נועלים שורות (`SKIP LOCKED`, lease). צריך אותו
  `HOSPITALITY_SECRET` בכולם.

### 9.2 פאנל הפלטפורמה ← "ניהול Hospitality"

**הדגלים הכלליים, לפי הסדר:** מסד ← ניהול ← אתר ← הזמנות. הדגלים הכלליים לא פותחים שום עסק
לבד.

### 9.3 "פתיחת עסק אירוח"

- **השדות:** שם, כתובת (slug), אימייל הבעלים, חבילה ו**ערכת עיצוב** (D2).
- **התוצאה:** נפתחים המסד ואזור הניהול של העסק. האתר וההזמנות כבויים.
- **מכאן:** בודקים את התעודה של העסק (§6.4).

### 9.4 בעל העסק נכנס

נכנסים ל-`https://<slug>.<domain>/manage` עם קוד במייל, ועוברים על רשימת ההקמה:
- פרטי העסק, יחידות, מחירים, תמונות ומדיניות ביטול;
- "עיצוב האתר": ערכה, צבעים, גופנים, לוגו, עריכה ישירה ← **פרסום**.

### 9.5 הדלקת האתר וההזמנות

1. מדליקים את **האתר** של העסק בפאנל ("האתר" — לעסק).
2. בודקים.
3. מדליקים את **ההזמנות** ("הזמנות").

### 9.6 ערוצים (לא חובה)

- בעל העסק מעתיק את קישור הייצוא (`https://<slug>.<domain>/ical/<token>`) ל-Airbnb /
  Booking.com.
- הוא מוסיף את קישורי ה-iCal שלהם במסך "ערוצים".

### 9.7 תשלום טלפוני (D4)

לא דורש הגדרה. אין ספק סליקה.

**כתובת לכל עסק:**
- הכתובת היא `<slug>.<TENANT_BASE_DOMAIN>`.
- צריך רשומת DNS (wildcard או רשומה לעסק) ותעודה — כמו בחנות.
- דומיין משלו — כמו בחנות.

## 10. בדיקות סופיות

לפי `docs/hospitality/launch-checklist.md`:
- אבטחה (S1–S15);
- פרטיות (P1–P10);
- נגישות ידנית (A1–A14);
- הזרימות העסקיות.

תוספות של D2–D4:

| # | בדיקה | מצופה |
|---|---|---|
| F6 | לוגו וגופן בעורך → פרסום | הלוגו בכותרת. הגופן באתר. הלוגו לא בגלריה |
| F7 | עריכה ישירה: לחיצה על כותרת בתצוגה המקדימה, הקלדה, יציאה | השינוי בשדה בצד ובטיוטה. אחרי פרסום — באתר |
| F8 | פתיחת עסק עם ערכה "טבע" | העורך נפתח בערכה "טבע" |
| F9 | התנגשות: חסימה ב-Airbnb על תאריכים של הזמנה אצלנו | מייל "התנגשות ביומן Airbnb" (פעם אחת), כרטיס בלוח הבקרה. ההזמנה לא השתנתה |
| F10 | לוח: חסימה מסנכרון | גוון סגול, "Airbnb · סנכרון", חלון לקריאה בלבד |
| F11 | בקשה מהאתר | "בקשת ההזמנה התקבלה. נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה" |
| F12 | בניהול: כרטיס "תשלום טלפוני" → התקשרות → רישום מקדמה → אישור | השלבים מסומנים בנפרד. "שולמה מקדמה" רק אחרי הרישום |
| F13 | הערת תשלום עם מספר כרטיס | נחסם עם הסבר |
| F14 | **ערוצים אמיתיים:** האם Airbnb / Booking.com מחזירים את התאריכים שייצאנו | אם כן — כל הזמנה תופיע כ"אולי הד". לדווח (שלב סינון) |

## 11. עדכון גרסה בעתיד

```bash
# 1. גיבוי בלי השבתה: §1 (BK חדש) — 1.1 עד 1.4
# 2. קוד
cd "$APP_DIR" && git pull --ff-only origin hospitality/stage-2 && cp -r supabase/rollbacks "$BK/rollbacks"
# 3. מיגרציות חדשות בלבד: §3.1 (בדיקה יבשה) → §3.2 → NOTIFY של §3.3
# 4. בנייה
docker compose build && docker compose up -d
```

**על המיגרציות:**
- כל מיגרציה חדשה מגיעה עם קובץ rollback.
- בפיתוח הן נבדקות ב-`scripts/db-tests/run.sh` (מסד נקי ומסד עם נתונים) וב-`rollback-check.sh`
  (שחזור מלא, והסכמה זהה).
- את הכלים האלה **לא** מריצים בשרת.

## 12. החזרה לאחור (rollback) ושחזור

מהקל לכבד, לפי הסדר.

**1. דגל של עסק / דגל כללי** — כיבוי בפאנל. מיידי, בלי פריסה.

**2. המנוע** — כל עמודי Hospitality, הפונקציות ותהליך הרקע נכבים:

```bash
cd "$APP_DIR" && sed -i '/^HOSPITALITY_ENGINE=/d' .env && docker compose up -d
docker exec "$APP" printenv HOSPITALITY_ENGINE              # ריק
```

**3. האפליקציה לגרסה הקודמת** (ה-image מ-§1.3, בלי build):

```bash
cd "$APP_DIR"
IMG=$(cat "$BK/app-image.txt"); docker tag "${IMG%:*}:pre-hospitality" "$IMG"
git checkout "$(cat "$BK/app-commit.txt")"
docker compose up -d --no-build --force-recreate
```

**4. חשיפת ה-API** — תמיד לפני rollback של המסד:

```bash
cd "$SB_DIR/docker"
sed -i -E 's/^(PGRST_DB_SCHEMAS=.*),hospitality/\1/' .env && grep '^PGRST_DB_SCHEMAS=' .env
docker compose -p "$PROJECT" up -d --no-deps rest
```

**5. המסד** — קובצי ה-rollback (מ-`$BK/rollbacks`, §2) בסדר הפוך, 28 ← 1. הלולאה מדלגת על מה
שלא הוחל, ועוצרת בשגיאה הראשונה.

```bash
for f in $(ls "$BK"/rollbacks/2026110[123]*.down.sql | LC_ALL=C sort -r); do
  name=$(basename "$f" .down.sql).sql
  applied=$(docker exec "$DB" psql -U postgres -d postgres -tAc \
    "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$name')")
  [ "$applied" = "t" ] || continue
  echo "=== rollback $name"
  docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" || { echo "נעצר ב-$name"; break; }
  docker exec "$DB" psql -U postgres -d postgres -qc \
    "DELETE FROM public._migrations_applied WHERE filename = '$name'"
done
docker exec "$DB" psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

- **מספר המיגרציות:** אפשר לעצור אחרי כמה שצריך — Ctrl+C אחרי הקובץ הרצוי, או קובץ בודד ידנית.
- **נתונים:** rollback של מיגרציות 25–28 לא מוחק נתונים.
- **הגנות:** מיגרציות מוקדמות מסרבות כשיש נתונים, לפי התיאור בכל קובץ. למשל, מיגרציה 3 לא
  נמחקת כל עוד קיים עסק אירוח או קובץ ב-`hosp-media`. אז יש שתי אפשרויות:
  - מוחקים את העסק בפאנל **לפני** צעדים 2–3;
  - עוצרים שם. המיגרציות שנשארות לא משפיעות על החנויות.
- **החנויות:** הקבצים נבדקו בפיתוח — החזרה מלאה, והסכמה של החנויות זהה ל-`main`.

**6. מוצא אחרון — שחזור מהגיבוי של §1.**

**עותק קר (1.5)** — שחזור מלא ומדויק של Supabase:

```bash
docker stop "$APP"
cd "$SB_DIR/docker" && docker compose -p "$PROJECT" stop $SB_SERVICES
mv volumes "volumes.broken-$(date +%Y%m%d-%H%M)"
tar -xzpf "$BK/supabase-volumes.tgz" -C "$SB_DIR/docker"
V=$(docker volume inspect "${PROJECT}_db-config" --format '{{.Mountpoint}}')
find "$V" -mindepth 1 -delete && tar -xzpf "$BK/db-config.tgz" -C "$V"
cp -p "$BK/supabase.env" "$SB_DIR/docker/.env"
docker compose -p "$PROJECT" up -d $SB_SERVICES
until docker exec "$DB" pg_isready -U postgres -q; do sleep 2; done
# והאפליקציה — צעד 3 למעלה
```

**סודות, Nginx ותעודות:**

```bash
cp -p "$BK/app.env" "$APP_DIR/.env"
cp -p "$BK/app-compose.override.yml" "$APP_DIR/docker-compose.override.yml"
tar -xzpf "$BK/nginx.tgz" -C / && nginx -t && systemctl reload nginx
tar -xzpf "$BK/letsencrypt.tgz" -C /                        # רק אם תעודות נפגעו
```

**קבצי Storage:**

```bash
STORAGE_SRC=$(docker inspect "$PROJECT-storage" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/storage"}}{{.Source}}{{end}}{{end}}')
tar -xzpf "$BK/storage.tgz" -C "$STORAGE_SRC"
```

**נתונים נקודתיים מ-`db.dump`** — למסד נפרד, **לעולם לא** מעל המסד החי:

```bash
docker exec "$DB" psql -U postgres -d postgres -c "CREATE DATABASE restore_check"
docker exec -i "$DB" pg_restore -U postgres -d restore_check --no-owner --no-privileges < "$BK/db.dump"
# שגיאות על אובייקטים פנימיים של Supabase צפויות. הטבלאות והנתונים משוחזרים.
# … בדיקה / העתקה של מה שצריך …
docker exec "$DB" psql -U postgres -d postgres -c "DROP DATABASE restore_check"
```

**בלי עותק קר:** השחזור המלא הוא
- קובצי ה-rollback — נבדקו: הסכמה חוזרת זהה;
- ונתונים נקודתיים מ-`db.dump`.

לכן מומלץ לעשות את 1.5 לפני ההתקנה הראשונה.

## 13. ניטור (48 השעות הראשונות ואחר כך)

**מיילים** — מסך "מיילים" באזור הניהול של כל עסק, ובמסד:

```bash
docker exec "$DB" psql -U postgres -d postgres -c \
  "SELECT status, count(*) FROM hospitality.notifications GROUP BY 1"
```

**יומנים חיצוניים** — כרטיס ההתראות בלוח הבקרה: התנגשויות, יומן שלא מסתנכרן.

**לוגים** — `docker logs "$APP" 2>&1 | grep "\[hospitality"`:
- `shared rate limit unavailable — local fallback`:
  - המונה במסד לא היה זמין, וההגבלה עברה לזיכרון של השרת.
  - צריך להיות 0. אם חוזר — §4, בדיקה 3.
- `booking request refused: trap field filled` — בוט.

**הגבלת קצב:**
- "יותר מדי בקשות" באתר; ו-429 ב-`access.log` אם הופעל §6.3.
- **ההגבלות לפי כתובת:**
  - 3 בקשות הזמנה ל-10 דקות ו-6 לשעה — לכל העסקים יחד;
  - פרוקסי משותף (נטפרי, רשת של מקום עבודה) הוא כתובת אחת.
- **תלונות של גולשים כאלה:** הערכים ב-`src/engines/hospitality/security/limits.ts`.

# מדריך התקנה ועדכון — Nuriel Hospitality בשרת המאובטח

המדריך מיועד להתקנה על השרת שלך, על גבי הסטאק הקיים: אפליקציה בקונטיינר, Supabase self-hosted
ו-Nginx — ראו `deploy/DEPLOY.md`. הוא מתאר את הענף `hospitality/stage-2`.

**שום דבר כאן לא בוצע על ידי Claude** — כל הפקודות הן לביצוע שלך. הדוגמאות משתמשות בשמות של
`deploy/DEPLOY.md` (`kobi-db`, `kobi-rest`, `/root/kobi-git`, `/root/kobi-supabase`). אם השמות
אצלך שונים — מחליפים.

**עקרון ההפעלה:** Hospitality כבוי כברירת מחדל בשלוש שכבות:
1. משתנה הסביבה `HOSPITALITY_ENGINE`;
2. דגלי הפלטפורמה;
3. דגלים לכל עסק.

החנויות (Ecommerce) לא מושפעות מאף שלב. כל שלב הפיך.

---

## 0. לפני הכול — גיבוי

```bash
# מסד הנתונים (מלא) + הסודות של הסטאק ושל האפליקציה
docker exec kobi-db pg_dump -U postgres -d postgres -Fc > /root/backups/before-hospitality-$(date +%F).dump
cp /root/kobi-supabase/docker/.env /root/backups/supabase-env-$(date +%F)
cp /root/kobi-git/.env.production /root/backups/app-env-$(date +%F) 2>/dev/null || true
```

כדאי לוודא שהגיבוי היומי (`deploy/backup-daily.sh`) עובד, ושהעותק מחוץ לשרת **מוצפן** (ממצא
PRIV-08) — לפני שנכנס מידע אמיתי של אורחים.

## 1. הקוד

מומלץ תיקייה נפרדת לבדיקה הראשונה, כדי לא לגעת בתיקייה שממנה רצה הגרסה הנוכחית:

```bash
git clone --branch hospitality/stage-2 <כתובת הריפו> /root/nuriel-hospitality
cd /root/nuriel-hospitality && git log --oneline -5
```

## 2. מיגרציות המסד (לפי הסדר)

הענף מוסיף 28 מיגרציות על `main` (2 של הפלטפורמה + 26 של Hospitality). כל אחת היא טרנזקציה
אחת, עם קובץ rollback תואם ב-`supabase/rollbacks/`.

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

**הרצה** — אותו מנגנון כמו `deploy/setup-selfhost.sh`: הטבלה `_migrations_applied`, ורק מה שעוד
לא הוחל.

```bash
cd /root/nuriel-hospitality
for f in supabase/migrations/*.sql; do
  name=$(basename "$f")
  done=$(docker exec kobi-db psql -U postgres -d postgres -tAc \
    "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$name')")
  [ "$done" = "t" ] && continue
  echo "=== $name"
  docker exec -i kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f" || { echo "נעצר ב-$name"; break; }
  docker exec kobi-db psql -U postgres -d postgres -c \
    "INSERT INTO public._migrations_applied (filename) VALUES ('$name')"
done
```

הלולאה נעצרת בשגיאה הראשונה. אחרי תיקון — מריצים שוב, והיא ממשיכה מאותו מקום.

**בדיקה אחרי המיגרציות:**

```bash
docker exec kobi-db psql -U postgres -d postgres -c "
  SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r') AS tables,      -- 29
         (SELECT bool_and(relrowsecurity) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r') AS rls_all,
         (SELECT count(*) FROM public.platform_feature_flags WHERE key LIKE 'hospitality%' AND enabled) AS flags_on,             -- 0
         (SELECT bool_and(site_type = 'ecommerce') FROM public.tenants) AS stores_untouched;"
```

## 3. חשיפת הסכמה ל-API

**רק אחרי שלב 2.**

```bash
# /root/kobi-supabase/docker/.env
PGRST_DB_SCHEMAS=public,storage,graphql_public,hospitality

docker restart kobi-rest
```

**בדיקה:** קריאה ל-REST של חנות מחזירה 200. קריאה של `anon` לטבלה ב-`hospitality` מחזירה
`permission denied` (ולא `PGRST106`).

## 4. משתני הסביבה של האפליקציה

ב-`.env.production` של האפליקציה (או ב-`docker-compose.override.yml`):

| משתנה | ערך | הערה |
|---|---|---|
| `HOSPITALITY_ENGINE` | **לא מוגדר** בפריסה הראשונה; `on` כשמפעילים | המתג הכללי. כבוי — אין שום עמוד, פונקציה או worker של Hospitality |
| `HOSPITALITY_SECRET` | `openssl rand -hex 32` | **חדש (D1).** HMAC של הגבלת הקצב ושל אתגרי ה-CAPTCHA. בלעדיו נגזר מ-`LOGIN_CODE_SECRET` / מפתח השירות — עובד, אבל עדיף סוד נפרד. **לשמור בגיבוי הסודות** |
| `HOSPITALITY_POW_MAX` | לא חובה (ברירת מחדל 50000) | הקושי של אתגר ה-CAPTCHA (1000–2000000) |
| `LOGIN_CODE_SECRET` | קיים | מומלץ שיהיה מוגדר ונפרד ממפתח השירות (AUTH-09) |
| `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` | קיימים | המיילים של העסקים יוצאים דרכם |
| `TENANT_BASE_DOMAIN` | קיים | כתובות העסקים: `<slug>.<domain>` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | קיימים | |

## 5. Nginx — מומלץ לפני פתיחה לציבור

1. **IP אמיתי** — כבר קיים: `proxy_set_header X-Real-IP $remote_addr;`.
   - Hospitality קורא אותו קודם (`security/client-ip.ts`).
   - **מומלץ גם:** `proxy_set_header X-Forwarded-For $remote_addr;` במקום
     `$proxy_add_x_forwarded_for`. זה סוגר את ממצא AUTH-03 גם בקוד הכניסה המשותף של החנויות,
     שקורא את הערך הראשון.
2. **הגבלת קצב ברמת Nginx** — לכניסה לאזור הניהול ולגישה הישירה ל-API של Supabase.
   - **למה:** ההגבלה של האפליקציה לא רואה בקשות שהולכות ישירות ל-GoTrue / PostgREST.
   - **המספרים** הם נקודת התחלה ומותאמים בבדיקות.

   ```nginx
   # /etc/nginx/conf.d/nuriel-limits.conf  (בתוך http {})
   limit_req_zone $binary_remote_addr zone=nuriel_fn:20m   rate=20r/s;
   limit_req_zone $binary_remote_addr zone=nuriel_auth:10m rate=10r/m;
   limit_req_zone $binary_remote_addr zone=nuriel_api:20m  rate=30r/s;
   limit_req_status 429;
   ```

   ```nginx
   # בבלוק של האפליקציה — בתוך location /_serverFn/ הקיים
   limit_req zone=nuriel_fn burst=40 nodelay;

   # בבלוק של ה-API (api-…):
   location /auth/v1/token { limit_req zone=nuriel_auth burst=10 nodelay; proxy_pass http://127.0.0.1:8300; # + אותן כותרות
   }
   location /auth/v1/otp   { limit_req zone=nuriel_auth burst=5  nodelay; proxy_pass http://127.0.0.1:8300; }
   location /rest/v1/      { limit_req zone=nuriel_api  burst=60 nodelay; proxy_pass http://127.0.0.1:8300; }
   ```
3. **גודל העלאה:** `client_max_body_size` — 25m היום.
   - Hospitality מקבל עד 50MB לסרטון. לתמונות 25m מספיק, כי הדפדפן מקטין לפני ההעלאה.
   - אם רוצים סרטונים גדולים: `50m` בבלוק של האפליקציה.
4. **HTTPS לכל עסק** — כמו לחנויות: `deploy/ssl/store-certs.sh` / סוכן התעודות.
   - האפליקציה שולחת HSTS בעמודי Hospitality.
   - **לא פותחים עסק אמיתי על כתובת בלי תעודה.**

אחרי שינוי: `nginx -t && systemctl reload nginx`.

## 6. GoTrue (Supabase Auth)

- **מגבלות קצב:** משתני `GOTRUE_RATE_LIMIT_*` ב-`.env` של הסטאק — כניסה, קודים, אימות ומיילים
  (ממצא AUTH-02). את שמות המשתנים המדויקים צריך **לאמת מול גרסת GoTrue** שמותקנת. מפעילים
  מחדש את `kobi-auth`.
- **הרשמה פתוחה:** אם היא פתוחה (בגלל לקוחות החנויות) — זה בסדר ל-Hospitality. בקשת הזמנה לא
  פתוחה לחשבונות (D1 — רק דרך שרת האפליקציה).

## 7. בנייה והעלאה

```bash
cd /root/nuriel-hospitality
docker compose build && docker compose up -d
docker logs --since 2m kobi-app | tail -50
```

**בדיקת חנויות (Ecommerce)** — עם `HOSPITALITY_ENGINE` עדיין כבוי:
- עמוד בית, מוצר, כניסה, עגלה → תשלום, ניהול, פאנל הפלטפורמה;
- `sitemap.xml` ו-`robots.txt`;
- בלי 5xx בלוגים.

> **פתוח מ-Stage 1:** ה-health check של Docker בודק רק את `/robots.txt`, שלא עובר דרך ה-SSR. זה
> לא מזהה build שבור. **לפני ייצור:** health check שעובר דרך ה-handler (`Dockerfile` /
> `docker-compose.yml`).

## 8. הפעלת Hospitality — בהדרגה

1. **הדלקה:** `HOSPITALITY_ENGINE=on` ו-`HOSPITALITY_SECRET`, ואז `docker compose up -d`.
   - **תהליך הרקע עולה עם האפליקציה.** בכל 30 שניות: מיילים ותפוגת בקשות. פעם ביום: שמירת מידע
     (מחיקת אורחים ישנים לפי ההגדרה). כל 5 דקות: סנכרון יומנים. כל 10 דקות: ניקוי מוני הגבלת
     הקצב.
   - **כמה קונטיינרים במקביל:** זה בטוח — התור והסנכרון נועלים שורות (`SKIP LOCKED`, lease).
2. **פאנל הפלטפורמה** ← "ניהול Hospitality":
   - **הדגלים הכלליים:** מסד ← ניהול ← אתר ← הזמנות. הדגלים הכלליים לא פותחים שום עסק לבד.
   - **"פתיחת עסק אירוח":** שם, כתובת (slug), אימייל הבעלים, חבילה ו**ערכת עיצוב** (D2).
     נפתחים המסד ואזור הניהול של העסק. האתר וההזמנות כבויים.
3. **בעל העסק נכנס** ל-`https://<slug>.<domain>/manage` עם קוד במייל, ועובר על רשימת ההקמה:
   - פרטי העסק, יחידות, מחירים, תמונות ומדיניות ביטול;
   - "עיצוב האתר": ערכה, צבעים, גופנים, לוגו, עריכה ישירה ← **פרסום**.
4. **הדלקת האתר** של העסק בפאנל ("האתר" — לעסק) ← בדיקה ← **הדלקת ההזמנות** ("הזמנות").
5. **ערוצים** (לא חובה):
   - בעל העסק מעתיק את קישור הייצוא (`https://<slug>.<domain>/ical/<token>`) ל-Airbnb /
     Booking.com.
   - מוסיף את קישורי ה-iCal שלהם במסך "ערוצים".
6. **תשלום טלפוני** (D4) — לא דורש הגדרה. אין ספק סליקה.

**כתובת לכל עסק:** `<slug>.<TENANT_BASE_DOMAIN>`. צריך רשומת DNS (wildcard
`*.<domain>` או רשומה לעסק) ותעודה — כמו בחנות. דומיין משלו — כמו בחנות.

## 9. בדיקות סופיות

לפי `docs/hospitality/launch-checklist.md`: אבטחה (S1–S13), פרטיות (P1–P10), נגישות ידנית
(A1–A14), והזרימות העסקיות. תוספות של D2–D4:

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

## 10. עדכון גרסה בעתיד

```bash
cd /root/nuriel-hospitality && git pull
# המיגרציות החדשות בלבד — אותה לולאה של שלב 2
docker compose build && docker compose up -d
```

מיגרציה חדשה תמיד מגיעה עם קובץ rollback. הן נבדקות ב-`scripts/db-tests/run.sh` (מסד נקי
ומסד עם נתונים) וב-`scripts/db-tests/rollback-check.sh` (שחזור מלא, והסכמה זהה).

## 11. החזרה לאחור (rollback)

מהקל לכבד:
1. **דגל של עסק / דגל כללי** — כיבוי בפאנל. מיידי, בלי פריסה.
2. **`HOSPITALITY_ENGINE`** — הסרה ו-`docker compose up -d`. כל עמודי Hospitality, הפונקציות
   וה-worker כבויים.
3. **האפליקציה** — חזרה ל-image / commit הקודם.
4. **חשיפת ה-API** — הסרת `hospitality` מ-`PGRST_DB_SCHEMAS` והפעלה מחדש של `kobi-rest`.
   **תמיד לפני** rollback של המסד.
5. **המסד** — קובצי `supabase/rollbacks/*.down.sql` בסדר הפוך (28 ← 1), רק כמה שצריך:

   ```bash
   docker exec -i kobi-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
     < supabase/rollbacks/20261103120000_hosp_phone_payments.down.sql
   docker exec kobi-db psql -U postgres -d postgres -c \
     "DELETE FROM public._migrations_applied WHERE filename = '20261103120000_hosp_phone_payments.sql'"
   ```

   M25–M28 לא מוחקים נתונים. rollback של המיגרציות המוקדמות נעצר בעצמו כשיש נתונים — לפי
   התיאור בכל קובץ.
6. **מוצא אחרון** — שחזור הגיבוי משלב 0.

## 12. ניטור (48 השעות הראשונות ואחר כך)

- **מיילים:** מסך "מיילים" באזור הניהול של כל עסק, ובמסד:

  ```bash
  docker exec kobi-db psql -U postgres -d postgres -c \
    "SELECT status, count(*) FROM hospitality.notifications GROUP BY 1"
  ```
- **יומנים חיצוניים:** כרטיס ההתראות בלוח הבקרה (התנגשויות, יומן שלא מסתנכרן).
- **לוגים:**
  - `docker logs kobi-app | grep "\[hospitality"`;
  - "shared rate limit unavailable — local fallback" = המסד לא היה זמין להגבלת הקצב (נפילה
    לזיכרון);
  - "booking request refused: trap field filled" = בוט.
- **הגבלת קצב:** תשובות 429 ב-Nginx (`access.log`), ו"יותר מדי בקשות" באתר.

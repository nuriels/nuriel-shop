# שרת ה-DEMO של MAX/Hyp — מדריך הקמה, בדיקה, גיבוי ופירוק

> **מסמך הכנה בלבד.** שום שרת לא הוקם, ושום פקודה כאן לא הורצה על שרת אמיתי. כל צעד מסומן
> בנקודת האישור שלו מהתוכנית (`MAX-DEMO-PLAN.md` §8): **D6** — הקמת השרת, מיגרציה 208 עליו
> וסימון המסד `demo`; **D7/D8** — כל הרצה מול Hyp. בלי האישור המתאים לא מתחילים את הצעד.

**מה כן נבדק מקומית** (על הקבצים במאגר, לא על שרת):
- תבנית ה-Nginx: תחביר, והתנהגות מול בקשות אמיתיות (§6.7);
- הרכבת קובצי ה-compose של ה-DEMO (§6.5);
- שרת הדמה למיילים — בדיקות יחידה (`tests/unit/demo-mail-sink.test.ts`);
- סקריפט הבדיקה `deploy/demo/demo-check.sh` — מול מסד מקומי ומול docker מדומה (§9).

**מה לא נבדק, כי אין שרת:** ההקמה עצמה, התעודות, ה-DNS, ‏NetFree, וכל מה שתלוי ב-Hyp.

**מסמכים קשורים:**
- `MAX-DEMO-PLAN.md` — התוכנית;
- `DEMO-IMPLEMENTATION-CONTRACT.md` — השמות והממשקים;
- `HYP-REQUEST-DRAFT.md` — הפנייה ל-Hyp (טיוטה, לא נשלחה);
- `DEMO-DEPLOY-CHECKLIST.md` — רשימת הבדיקה;
- `DEMO-RELEASE-NOTES.md` — מה בגרסה.

---

## 1. העקרונות

1. **שרת נפרד.** שום רכיב לא משותף עם הייצור:
   - לא מסד, לא סודות, לא גיבויים;
   - לא חשבון Resend, ולא ה-DNS של חנויות קיימות.
2. **שמות שונים מהייצור בכל מקום**: קונטיינרים, תיקיות, פורטים וכתובות.
   - פקודה של הייצור שמודבקת בשרת ה-DEMO נכשלת ב-"No such container".
   - פקודה של ה-DEMO שמודבקת בייצור נכשלת באותה צורה.
3. **אין פרטי מסוף אמיתי, ואין כרטיס אמיתי.** מותרים רק מסופי בדיקות של Hyp (מספר שמתחיל ב-`00100`).
   - את פרטי המסופים מקלידים רק במסכי הניהול של שרת ה-DEMO, והם מוצפנים מיד.
   - אף פעם לא ב-SQL, בקובץ, בצ'אט או בצילום מסך.
4. **Hyp חסומה מתוך האפליקציה עד אישור D7** (`compose.demo-block-hyp.yml`).
5. **שום מייל לא יוצא מהשרת.** הכול נשמר בשרת הדמה למיילים (`mailsink`).
6. **הגנת סיסמה על כל כתובות האפליקציה, ו-`noindex` בכל תשובה.**
7. **הסודות נוצרים על השרת ולא עוזבים אותו.**
8. **הייצור לא נוגע.** אף צעד כאן לא מתחבר לשרת הייצור, למסד שלו או לגיבויים שלו.

## 2. השרת

| נושא | הדרישה |
| --- | --- |
| מכונה | ‏VPS נפרד: ‏2 ‏vCPU, ‏4 GB RAM ועוד 2 GB swap (הבנייה של האפליקציה צריכה זיכרון), ‏40 GB דיסק |
| מערכת | ‏Ubuntu 24.04 LTS, עדכוני אבטחה אוטומטיים (`unattended-upgrades`), סנכרון שעון פעיל |
| כתובת IP | קבועה. ייתכן ש-Hyp תבקש לרשום אותה (שאלה H8) |
| תוכנה | ‏Docker Engine עם compose, ‏Nginx, ‏certbot (‏`python3-certbot-nginx`), ‏`apache2-utils` (‏htpasswd), ‏git, ‏Node 22 (למחולל המפתחות של הסטאק) |
| חומת אש | ‏`ufw`: פתוחים רק 22, ‏80 ו-443. את 22 מומלץ להגביל לכתובות של הבודקים |
| פורטים של docker | רק על `127.0.0.1`. ‏docker עוקף את `ufw` בפורט שמפורסם על כל הממשקים — לכן זה נבדק (§9) |
| גישה | מפתח SSH ייעודי לשרת הזה. בלי מפתחות של הייצור, ובלי העברת agent |
| הריפו | מפתח פריסה (deploy key) לקריאה בלבד, רק למאגר הזה |

**השעון חשוב:** לתעודות, לתוקף של החיבורים ולקוד האימות של 10 דקות.

## 3. כתובות ו-DNS (החלטה ב-D6)

**ההמלצה:** תת-אזור נפרד, `demo.nuri1.fit`, עם רשומת A לכל כתובת, בלי wildcard.

| תפקיד | כתובת מוצעת | בייצור (לא נוגעים) |
| --- | --- | --- |
| ניהול הפלטפורמה (`PLATFORM_ADMIN_HOST`) | `admin.demo.nuri1.fit` | `nuriel.nuri1.fit` |
| בסיס לחנויות (`TENANT_BASE_DOMAIN`) | `demo.nuri1.fit` | `nuri1.fit` |
| חנות A (לא חנות ברירת המחדל) | `store-a.demo.nuri1.fit` | — |
| חנות B | `store-b.demo.nuri1.fit` | — |
| חנות ברירת המחדל (`PUBLIC_SITE_URL`) | `www.demo.nuri1.fit` | — |
| ‏Supabase (‏`SUPABASE_URL`) | `api.demo.nuri1.fit` | `api-nuriel.nuri1.fit` |

**למה שתי חנויות שאינן חנות ברירת המחדל:**
- כתובת לא מוכרת מגיעה בקוד לחנות ברירת המחדל.
- אם A או B היו ברירת המחדל, בקשה שהגיעה לחנות הלא נכונה הייתה נראית תקינה.
- בחנות ברירת המחדל לא מגדירים מסוף אף פעם.

**עוגיות:** העוגיות של האפליקציה נקבעות רק לכתובת המדויקת, בלי `Domain`:
- `src/engines/hospitality/api/guest-area.functions.ts:153`;
- ה-GA משתמש בכתובת הדף (`cookie_domain: window.location.hostname`);
- ההתחברות ל-Supabase נשמרת בדפדפן, לכל כתובת בנפרד.

לכן אותו דומיין-אב כמו הייצור אפשרי. דומיין נפרד לגמרי הוא חלופה מחמירה יותר.

**NetFree:** לבדוק שהבקשה הקיימת ל-`*.nuri1.fit` מכסה גם רמה שנייה (`*.demo.nuri1.fit`). אם לא, יוצאת שגיאת HTTP 418 מרשתות מסוננות.

## 4. משתני הסביבה של האפליקציה

שני מקורות:
- **ערכים קבועים** ב-`deploy/demo/compose.demo.yml`, שגוברים על ה-`.env`;
- **ערכים מה-`.env`** של האפליקציה בשרת (לא ב-git, הרשאות 600).

| משתנה | ב-DEMO | מאיפה | סוד |
| --- | --- | --- | --- |
| `PAYMENTS_ENV` | `demo` | קבוע ב-compose | לא |
| `PAYMENTS_JOBS` | `on` | קבוע ב-compose | לא |
| `PAYMENTS_SECRETS_KEY` | 64 תווי hex אקראיים, נוצרים על השרת (§6.6) | `.env` | **כן** |
| `PLATFORM_TERMINAL_SECRETS_KEY` | 64 תווי hex אקראיים אחרים | `.env` | **כן** |
| `SUPABASE_URL` | `https://api.demo.nuri1.fit` | `.env` | לא |
| `SUPABASE_PUBLISHABLE_KEY` | המפתח הציבורי של סטאק ה-DEMO | `.env` | לא (ציבורי) |
| `SUPABASE_SERVICE_ROLE_KEY` | המפתח של סטאק ה-DEMO | `.env` | **כן** |
| `LOGIN_CODE_SECRET` | חדש, של ה-DEMO בלבד | `.env` | **כן** |
| `HOSPITALITY_SECRET` | חדש, של ה-DEMO בלבד (המנוע כבוי) | `.env` | **כן** |
| `TENANT_BASE_DOMAIN` | `demo.nuri1.fit` | `.env` | לא |
| `PLATFORM_ADMIN_HOST` | `admin.demo.nuri1.fit` — **אסור** `nuriel.nuri1.fit` | `.env` | לא |
| `PUBLIC_SITE_URL` | `https://www.demo.nuri1.fit` | `.env` | לא |
| `RESEND_API_KEY` | `demo-mail-sink` (לא מפתח אמיתי) | קבוע ב-compose | לא |
| `RESEND_API_URL` | `http://nuriel-demo-mailsink:4025` | קבוע ב-compose | לא |
| `EMAIL_FROM_ADDRESS` | `orders@demo.invalid` | קבוע ב-compose | לא |
| `GROW_SECRETS_KEY`, `GROW_API_URL` | ריק — Grow לא מופעל | קבוע ב-compose | — |
| `LICENSE_KEYS_SECRET` | ריק — מודול הרישיונות כבוי | קבוע ב-compose | — |
| `HOSPITALITY_ENGINE`, `BUSINESS_PROFILE_ENGINE` | ריק — כבויים | קבוע ב-compose | — |
| `AI_RENEWAL_JOB`, `SEO_WORKER` | `off` | קבוע ב-compose | — |
| `SEO_BACKGROUND_AI`, `GSC_OAUTH_*`, `CUSTOM_DOMAIN_CNAME_TARGET`, `IMPORT_IMAGE_ALLOW_HOSTS` | ריק | קבוע ב-compose | — |
| `SERVER_PUBLIC_IPS`, `SUPPORT_NOTIFY_EMAIL`, `BUSINESS_PROFILE_SECRET`, `HOSPITALITY_POW_MAX` | ריק | `.env` | — |
| `COMPOSE_FILE` | `docker-compose.yml:deploy/demo/compose.demo.yml:deploy/demo/compose.demo-block-hyp.yml` (החלק האחרון יורד רק באישור D7) | `.env` | לא |
| `COMPOSE_PROJECT_NAME` | `nuriel-demo-app` | `.env` | לא |

**אסור שיהיו בקונטיינר:**
- `MAX_PAY_TEST_URL`, ‏`GROW_SANDBOX_URL`, ‏`DNS_TEST_FIXTURES`, ‏`SITEMAP_TTL_MS` — משתני בדיקות בלבד.
- `demo-check.sh` בודק שהם לא קיימים.
- היוצא מן הכלל הוא `RESEND_API_URL`: גם הוא משתנה בדיקות, אבל ב-DEMO הוא מכוון בכוונה לשרת הדמה. הוא מופיע רק בקובץ של ה-DEMO, ולא ב-`docker-compose.yml`. זה נבדק ב-`tests/unit/env-forwarding.test.ts`.

**שני מפתחות השורש:**
- לפחות 32 תווים;
- שונים זה מזה ומכל סוד אחר;
- לא ערך לדוגמה;
- לעולם לא אותו ערך כמו בייצור.

האפליקציה בודקת את כל אלה בהפעלה. אם אחד מהם לא עומד בדרישות, התשלומים בצד שלו כבויים.

## 5. הסודות — כולם מחוץ ל-Git

| סוד | נוצר | נשמר | גיבוי | בסוף ה-DEMO |
| --- | --- | --- | --- | --- |
| סודות סטאק ה-Supabase (סיסמת Postgres, ‏JWT, ‏anon/service, ‏Studio, ‏Vault, ‏meta, ‏Logflare) | על השרת, במחולל של הסטאק (`deploy/gen-keys.mjs`) | `/root/nuriel-demo-supabase/docker/.env` (600) | בגיבוי של השרת בלבד | נמחקים עם השרת |
| `SUPABASE_SERVICE_ROLE_KEY`, ‏`LOGIN_CODE_SECRET`, ‏`HOSPITALITY_SECRET` | על השרת | `/root/nuriel-demo-git/.env` (600) | כנ"ל | כנ"ל |
| **`PAYMENTS_SECRETS_KEY`, ‏`PLATFORM_TERMINAL_SECRETS_KEY`** | על השרת, ב-`openssl rand -hex 32`, ישר לקובץ, בלי הדפסה (§6.6) | `/root/nuriel-demo-git/.env` | כנ"ל. אם יאבדו, את פרטי המסופים מקלידים מחדש | נמחקים עם השרת |
| **פרטי מסופי הבדיקות** (מספר מסוף, ‏`KEY`, ‏`PassP` × 3) | מ-Hyp | **רק מוצפנים במסד ה-DEMO**. מוקלדים במסך הניהול, ולא נשמרים בשום קובץ | בגיבוי המסד, מוצפנים | נמחקים במסך הניהול, ו-Hyp מתבקשת לסגור את המסופים (§11) |
| `zPass` (סיסמת זיכויים) | — | **לא מבקשים ולא נשמר** | — | — |
| סיסמאות הגנת האתר (basic auth) | ‏`htpasswd -B` על השרת | גיבוב bcrypt ב-`/etc/nginx/nuriel-demo.htpasswd`. הסיסמאות — במנהל סיסמאות | — | נמחקות |
| סיסמת מנהל הפלטפורמה של ה-DEMO | בהקמת הסטאק | מנהל סיסמאות | — | — |
| מפתח SSH ומפתח הפריסה לריפו | במחשב שלכם / ב-GitHub | המחשב שלכם; המפתח הציבורי בשרת | — | מוסרים מ-GitHub |
| מפתחות התעודות (Let's Encrypt) | ‏certbot | `/etc/letsencrypt` | — | נמחקים |
| מפתח פרטי להצפנת גיבויים (age), אם מפעילים גיבוי יומי | במחשב שלכם | במחשב שלכם בלבד; בשרת רק המפתח הציבורי | — | נמחק |

**לעולם לא:**
- ב-Git, בכרטיס משימה, בצ'אט, ב-CI;
- ביומן, בצילום מסך, ב-HAR או בהקלטה.

**אם סיסמת בדיקה (`KEY`/`PassP`) הופיעה מחוץ לטופס:** מבקשים מ-Hyp להחליף אותה.

## 6. ההקמה, צעד אחר צעד (D6 — רק באישור)

**משתנים — מגדירים פעם אחת בכל חלון טרמינל בשרת ה-DEMO:**

```bash
PROJECT=nuriel-demo
APP_DIR=/root/nuriel-demo-git
SB_DIR=/root/nuriel-demo-supabase
APP_PORT=3800
KONG_PORT=8600                      # לפי הסטאק שהוקם; מאמתים ב-6.4
DB=$PROJECT-db
APP=$PROJECT-app
DEMO_BASE=910b1f9c9                 # בסיס: platform/crawl-parity (מיגרציות עד 207)
DEMO_COMMIT=<הקומיט של DEMO-RELEASE-NOTES.md>
```

### 6.1 הכנת השרת

```bash
apt-get update && apt-get install -y docker.io docker-compose-v2 nginx python3-certbot-nginx apache2-utils git
ufw default deny incoming && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
timedatectl set-ntp true && timedatectl | grep -E "synchronized|NTP"
```

את Node 22 מתקינים לפי ההוראות הרשמיות של Node, או מהמאגר של ההפצה אם הגרסה שם מתאימה.

### 6.2 ‏DNS

- רשומות A לחמש הכתובות של §3, אל ה-IP של שרת ה-DEMO.
- בדיקה: `getent hosts admin.demo.nuri1.fit` מחזיר את ה-IP של שרת ה-DEMO, **לא** של הייצור.

### 6.3 הקוד — בבסיס, לפני מיגרציה 208

```bash
git clone <כתובת המאגר> "$APP_DIR"      # עם מפתח הפריסה של השרת הזה
git -C "$APP_DIR" checkout --detach "$DEMO_BASE" && git -C "$APP_DIR" log --oneline -1
ls "$APP_DIR"/supabase/migrations/*.sql | wc -l                       # 207
```

**למה בבסיס:** הסטאק מריץ בהקמה את כל המיגרציות שבתיקייה. כך מיגרציה 208 רצה לבד, אחר כך (§7), בדיוק כמו שתרוץ בייצור — עם בדיקה, רישום ו-Rollback.

### 6.4 הסטאק של Supabase

ההקמה היא אותה הקמה של הייצור (`deploy/DEPLOY.md`, שלב 3), בשרת ה-DEMO בלבד:
- תיקיית הסטאק: `$SB_DIR`;
- הקידומת של הקונטיינרים: `nuriel-demo` (‏`nuriel-demo-db`, ‏`nuriel-demo-rest`…);
- כתובת ה-API: `api.demo.nuri1.fit`;
- הסיסמה של המנהל — חדשה, של ה-DEMO בלבד.

**הסתייגות:** את סקריפט ההקמה לא פתחתי — כלל הפרטיות של הפרויקט אוסר עליי לקרוא אותו. לכן:
- את השמות המדויקים של הפרמטרים שלו בודקים אתם, לפני ההרצה.
- כל מה שאחרי ההקמה כן נבדק — בבדיקות שבסוף הסעיף ובסקריפט הבדיקה (§9).

**בדיקה אחרי ההקמה:**

```bash
docker ps --format '{{.Names}}' | grep "^$PROJECT-"                       # הקונטיינרים של הסטאק, בשמות nuriel-demo-*
docker ps --format '{{.Names}}' | grep -c '^nuriel-shop-'                 # 0 — אין כאן שום שם של הייצור
PROJECT=$PROJECT bash "$APP_DIR/deploy/check-default-secrets.sh" "$SB_DIR/docker"   # יציאה 0: אין סוד בערך ברירת מחדל
docker port "$PROJECT-kong"                                               # 127.0.0.1:<פורט> בלבד → זה KONG_PORT
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"   # 207
```

### 6.5 קובץ הסביבה של האפליקציה

ההקמה כותבת `.env` בתיקיית הריפו. **לא מדפיסים אותו.** בודקים רק שמות וערכים שאינם סודות, ומשלימים את מה שחסר עם עורך טקסט:

```bash
cd "$APP_DIR" && chmod 600 .env
for v in SUPABASE_URL TENANT_BASE_DOMAIN PLATFORM_ADMIN_HOST PUBLIC_SITE_URL; do printf '%s=' "$v"; sed -n "s/^$v=//p" .env | tail -n 1; done
for v in SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY LOGIN_CODE_SECRET HOSPITALITY_SECRET; do grep -q "^$v=." .env && echo "$v: set" || echo "$v: MISSING"; done
```

הערכים שמודפסים חייבים להיות של ה-DEMO (§3, §4). `PLATFORM_ADMIN_HOST=nuriel.nuri1.fit` = עצירה.

**הוספת שורות ה-compose:**

```bash
cd "$APP_DIR" && printf '%s\n' \
  'COMPOSE_FILE=docker-compose.yml:deploy/demo/compose.demo.yml:deploy/demo/compose.demo-block-hyp.yml' \
  'COMPOSE_PROJECT_NAME=nuriel-demo-app' >> .env
docker compose config | grep -E 'container_name|published|PAYMENTS_ENV|RESEND_API_URL|pay.hyp.co.il'
# nuriel-demo-app, nuriel-demo-mailsink, "3800", PAYMENTS_ENV: demo, RESEND_API_URL: http://nuriel-demo-mailsink:4025, pay.hyp.co.il=127.0.0.1
```

`docker compose config` מדפיס גם סודות. לכן חובה הסינון ב-`grep` שבסוף הפקודה. בלעדיו — לא מריצים.

### 6.6 שני מפתחות השורש של התשלומים

נוצרים ישר לתוך הקובץ, בלי שיוצגו על המסך:

```bash
cd "$APP_DIR" && grep -c '^PAYMENTS_SECRETS_KEY=\|^PLATFORM_TERMINAL_SECRETS_KEY=' .env    # 0 — עוד לא קיימים
umask 077 && printf 'PAYMENTS_SECRETS_KEY=%s\nPLATFORM_TERMINAL_SECRETS_KEY=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >> .env
grep -c '^PAYMENTS_SECRETS_KEY=.\{64\}$\|^PLATFORM_TERMINAL_SECRETS_KEY=.\{64\}$' .env      # 2
```

- **אם השורה הראשונה מחזירה מספר שאינו 0:** המפתחות כבר קיימים. **לא מחליפים אותם.** החלפה = פרטי המסופים השמורים לא מתפענחים.
- הם לא מועתקים לשום מקום אחר.

### 6.7 ‏Nginx, הגנת סיסמה ותעודות

```bash
cp "$APP_DIR/deploy/demo/nginx/nuriel-demo-log.conf" /etc/nginx/conf.d/
sed -e 's/@@DEMO_PLATFORM_HOST@@/admin.demo.nuri1.fit/' \
    -e 's/@@DEMO_STORE_HOSTS@@/www.demo.nuri1.fit store-a.demo.nuri1.fit store-b.demo.nuri1.fit/' \
    -e 's/@@DEMO_API_HOST@@/api.demo.nuri1.fit/' \
    -e "s/@@DEMO_APP_PORT@@/$APP_PORT/g" -e "s/@@DEMO_KONG_PORT@@/$KONG_PORT/g" \
    "$APP_DIR/deploy/demo/nginx/nuriel-demo.conf.template" > /etc/nginx/sites-available/nuriel-demo.conf
grep -c '@@' /etc/nginx/sites-available/nuriel-demo.conf                                   # 0
ln -sf /etc/nginx/sites-available/nuriel-demo.conf /etc/nginx/sites-enabled/nuriel-demo.conf
htpasswd -B -c /etc/nginx/nuriel-demo.htpasswd <שם-בודק>      # מבקש סיסמה; לבודק נוסף: בלי -c
chmod 640 /etc/nginx/nuriel-demo.htpasswd && chgrp www-data /etc/nginx/nuriel-demo.htpasswd
nginx -t && systemctl reload nginx
certbot --nginx -d admin.demo.nuri1.fit -d www.demo.nuri1.fit -d store-a.demo.nuri1.fit -d store-b.demo.nuri1.fit -d api.demo.nuri1.fit
```

**מה התבנית עושה** (נבדק מקומית — ראו ראש המסמך):
- בלי סיסמה: ‏401;
- ‏`robots.txt` פתוח, וחוסם הכול;
- בכל תשובה: `X-Robots-Tag: noindex`;
- ביומן: הנתיב בלבד, בלי שאילתה ובלי Referer;
- יומן השגיאות ברמת `crit` — ברמות נמוכות יותר Nginx כותב את שורת הבקשה המלאה;
- בכתובת ה-API פתוחים רק `auth`, ‏`rest` ו-`storage`. ה-Studio וה-meta API סגורים (404). ל-Studio נכנסים רק במנהרת SSH: `ssh -L 8601:127.0.0.1:$KONG_PORT root@<שרת>`.

**נתיבי החזרה מ-Hyp** (`/payments/return/max`, ‏`/platform/payments/return/max`) נשארים מאחורי הסיסמה.
- רק אם ב-M03 הדפדפן לא שולח את הסיסמה שוב אחרי ההפניה מ-Hyp (נראה כ-401): מסירים את ה-`#` מ-`auth_basic off;` בשני הבלוקים, ואז `nginx -t && systemctl reload nginx`.
- בנתיבים האלה אין שום סמכות. התשלום נקבע רק אחרי VERIFY בצד השרת.

### 6.8 הגרסה של ה-DEMO, בנייה והפעלה (עדיין בלי מיגרציה 208)

```bash
cd "$APP_DIR" && git fetch origin payments/max-hyp && git merge-base --is-ancestor "$DEMO_BASE" "$DEMO_COMMIT" && git checkout --detach "$DEMO_COMMIT" && git log --oneline -1
docker compose build > /root/nuriel-demo-build.log 2>&1; tail -n 3 /root/nuriel-demo-build.log
docker compose up -d && sleep 20 && docker ps --format '{{.Names}} {{.Status}}' | grep -E "nuriel-demo-(app|mailsink)"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$APP_PORT/healthz        # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$APP_PORT/readyz         # 200
docker logs "$APP" 2>&1 | grep -m1 '\[payments\] env='                             # [payments] env=demo endpoint=hyp tenant=ready platform=ready
```

- **לפני מיגרציה 208, התשלומים המקוונים כבויים.** אין להם טבלאות. זה המצב הצפוי.
- הקוד החדש לא משנה דבר בחנויות עד שיש מסוף, דגל וסימון סביבה.

### 6.9 מיגרציה 208 — סעיף 7. סימון המסד — סעיף 8.

### 6.10 נתוני הבדיקה

הכול דרך המסכים, בלי SQL ובלי נתונים אמיתיים:
1. **מנהל הפלטפורמה** נכנס ב-`https://admin.demo.nuri1.fit`, עם המשתמש שנוצר בהקמה.
2. **פותחים שתי חנויות:** `store-a` ו-`store-b`.
   - כל אחת עם בעלים בדויים, בכתובת `@demo.invalid`. כל המיילים מגיעים לשרת הדמה ממילא.
   - שתיהן אינן חנות ברירת המחדל.
3. **בכל חנות:** 2–3 מוצרים במחיר 1–10 ₪.
   - מחיר מעל 50 ₪ ייחסם בתקרת מצב הבדיקה. זו הבדיקה DM-ENV-5.
4. **בחשבון של חנות A:** חיוב פתוח ביומן הכספי (חיוב מנוי ידני) של 5–10 ₪. הוא ישמש את התשלום לפלטפורמה (M13).
5. **פרטי מסופים — לא בשלב הזה.** הם נכנסים רק ב-D7, אחרי תשובות Hyp ואישור (§11).

**קריאת מייל** (למשל קוד האימות לשמירת מסוף הפלטפורמה) — רק מתוך השרת:

```bash
docker exec nuriel-demo-mailsink node -e "fetch('http://127.0.0.1:4025/__mail?limit=3').then(r=>r.text()).then(console.log)"
```

## 7. מיגרציה 208 ו-Rollback (D6 — רק באישור)

**הקבצים:**
- `supabase/migrations/20261128100000_online_payments_foundation.sql`;
- `supabase/rollbacks/20261128100000_online_payments_foundation.down.sql`.

הכול בטרנזקציה אחת. כישלון לא משאיר כלום.

### 7.1 לפני — גיבוי (§10.1) ובדיקות

```bash
cd "$APP_DIR" && test -f supabase/migrations/20261128100000_online_payments_foundation.sql && test -f supabase/rollbacks/20261128100000_online_payments_foundation.down.sql && echo "files: ok"
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"                                # 207
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261128100000%'"   # 0
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT to_regnamespace('payments') IS NULL"                                    # t
```

### 7.2 ההרצה

```bash
cd "$APP_DIR" && docker exec -i "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q < supabase/migrations/20261128100000_online_payments_foundation.sql \
  && docker exec "$DB" psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261128100000_online_payments_foundation.sql')" \
  && docker restart "$PROJECT-rest" && echo "migration 208: applied and recorded"
```

### 7.3 בדיקה אחרי

`demo-check.sh` (§9) בודק את כל אלה. ידנית:

```bash
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT name IS NULL FROM payments.environment"                # t — עוד לא מסומן
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT NOT has_schema_privilege('authenticated','payments','USAGE') AND NOT has_schema_privilege('anon','payments','USAGE')"   # t
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT count(*) FROM pg_class WHERE relnamespace='payments'::regnamespace AND relkind='r' AND NOT relrowsecurity"   # 0
```

### 7.4 תרגול Rollback (מומלץ, באותו אישור)

רק לפני סימון המסד, ולפני שיש נתוני תשלום. ה-Rollback מסרב מעצמו כשיש נתונים.

```bash
cd "$APP_DIR" && docker exec -i "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q < supabase/rollbacks/20261128100000_online_payments_foundation.down.sql \
  && docker exec "$DB" psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261128100000_online_payments_foundation.sql'" \
  && docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT to_regnamespace('payments') IS NULL, (SELECT count(*) FROM public._migrations_applied)"   # t|207
```

- **אחרי התרגול:** מריצים שוב את 7.2 ואת 7.3.
- **מה ה-Rollback מוכיח:** הפונקציות הקיימות שהמיגרציה שינתה חוזרות בדיוק לגרסה הקודמת. הוא בודק את טביעת האצבע (md5) של כל אחת, ונכשל אם יש הבדל.

### 7.5 ‏Rollback אחרי שיש נתוני תשלום

- **ה-Rollback מסרב.** זה בכוונה: נתוני תשלום לא נמחקים בשקט.
- ב-DEMO הדרך היא:
  - כיבוי (§8.3);
  - או שחזור מלא מהעותק הקר שלפני המיגרציה (§10.3). הנתונים בדויים, ולכן אפשר.

## 8. סימון המסד (D6 — רק באישור)

### 8.1 הסימון

**הכלל:**
- המסד נוצר לא מסומן, ואז התשלומים כבויים בשני הצדדים.
- את הסימון עושה רק בעל המסד, ב-SQL, ופעם אחת.
- לא מיגרציה, ולא שום תפקיד של ה-API.

```bash
docker exec "$DB" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -tAc "UPDATE payments.environment SET name = 'demo', note = 'NURIEL DEMO server' WHERE id RETURNING name"   # demo
```

### 8.2 מה חייב להיכשל אחרי הסימון

כל בדיקה כאן רצה בטרנזקציה שתמיד מבוטלת. שום דבר לא נשמר.

```bash
docker exec -i "$DB" psql -U postgres -d postgres -X -q <<'SQL'
BEGIN; UPDATE payments.environment SET name = 'production' WHERE id; ROLLBACK;
SQL
# ERROR — מסד DEMO לא יכול להפוך למסד ייצור
```

את שאר בדיקות ההוכחה של D6 מריץ `demo-check.sh --proofs` (§9.2).

### 8.3 כיבוי

אפשר מיד, בלי לשנות את הסימון. מספיק אחד מאלה:

| מה | איך | תוך כמה זמן |
| --- | --- | --- |
| מתג החירום של כל צד | מסך הניהול של הפלטפורמה | 15 שניות |
| הדגלים | `max_payments`, ‏`platform_terminal_payments` | — |
| עצירת האפליקציה | ‏`docker stop nuriel-demo-app` | מיד |

## 9. בדיקות תקינות ואבטחה

### 9.1 בדיקה אוטומטית — `deploy/demo/demo-check.sh`

```bash
bash "$APP_DIR/deploy/demo/demo-check.sh"            # קריאה בלבד
```

**מה הסקריפט לא עושה:**
- לא משנה כלום;
- לא מדפיס אף סוד;
- לא פונה ל-Hyp.

**לפני כל בדיקה אחרת, הוא עוצר אם:**
- מדובר בשרת הייצור, כלומר `PLATFORM_ADMIN_HOST` הוא כתובת הייצור;
- או שקיים כאן קונטיינר בשם של הייצור.

**מה הוא בודק:**

| # | בדיקה |
| --- | --- |
| C1 | זהות: ‏`PAYMENTS_ENV=demo`, ‏`PLATFORM_ADMIN_HOST` שאינו של הייצור, ואין קונטיינר `nuriel-shop-*` |
| C2 | הקונטיינרים רצים ובריאים: `nuriel-demo-app`, ‏`nuriel-demo-mailsink`, ‏`nuriel-demo-db` |
| C3 | שום פורט של docker לא פתוח החוצה. רק `127.0.0.1` |
| C4 | אין סוד של הסטאק בערך ברירת המחדל (`check-default-secrets.sh`) |
| C5 | בקונטיינר:<br>• שני מפתחות השורש קיימים, ארוכים מ-32 תווים, שונים זה מזה ומכל סוד אחר;<br>• אין משתני בדיקות;<br>• המיילים לשרת הדמה;<br>• ‏Grow כבוי.<br>הבדיקה מתבצעת בתוך הקונטיינר, ומודפסות רק התוצאות |
| C6 | חסימת Hyp: פעילה (D6) או הוסרה (D7 ואילך), ו-`pay.hyp.co.il` בתוך הקונטיינר |
| C7 | ‏`/healthz` ו-`/readyz`: ‏200 |
| C8 | ‏Nginx:<br>• בלי סיסמה — 401;<br>• `robots.txt` חוסם;<br>• `X-Robots-Tag` קיים;<br>• ה-Studio סגור;<br>• אין שורת שאילתה ביומן של נתיבי החזרה |
| C9 | המסד:<br>• מיגרציה 208 רשומה;<br>• הסימון `demo` (או עדיין ריק);<br>• אין חשבון במצב `live`;<br>• אין מסוף בלי הקידומת `00100`;<br>• ל-`anon` ול-`authenticated` אין גישה לסכמה `payments`;<br>• בכל הטבלאות RLS |
| C10 | שרת הדמה למיילים לא נגיש מחוץ לרשת של docker |

**התוצאה:**
- כל בדיקה מודפסת כ-`✓` או `✗`;
- יציאה 0 = הכול עבר;
- אחרת — יציאה 1, ולא ממשיכים.

### 9.2 בדיקות ההוכחה של D6 — `demo-check.sh --proofs`

כל בדיקה:
- רצה במסד בטרנזקציה שתמיד מבוטלת;
- או בקונטיינר זמני של האפליקציה, בלי רשת.

שום דבר לא נשמר.

| הוכחה | התוצאה הנדרשת |
| --- | --- |
| חשבון חנות במצב `live` | נדחה |
| מסוף בלי הקידומת `00100` | נדחה |
| האפליקציה אומרת `production` והמסד `demo` | נדחה ("סביבה לא תואמת") |
| ‏`PAYMENTS_ENV=production` בכתובת שאינה של הייצור | האפליקציה מכבה את התשלומים |
| סימון המסד `production` | נדחה |
| עקיפה לשרת מדומה (`MAX_PAY_TEST_URL`) בכתובת שאינה מקומית | לא פועלת |
| הייצור לא נגע | מאשרים אתם: אף פקודה של המדריך לא רצה בשרת הייצור |

### 9.3 בדיקות בדפדפן (ידני)

- בכל כתובת עולה בקשת סיסמה.
- בכל מסך של תשלום מקוון רואים את ההודעה "סביבת DEMO — אין חיובים אמיתיים":
  - בקופה ובדף התשלום;
  - בתשלום לפלטפורמה;
  - במסוף הפלטפורמה;
  - בלשונית MAX.
- שאר הדפים נראים כמו בייצור. זה בכוונה: פס קבוע בכל עמוד שינה את האתרים הקיימים (CI ‏210).
- מייל שנשלח (למשל הזמנה בחנות A) מופיע בשרת הדמה ולא מגיע לשום תיבה.
- בחנות ברירת המחדל אין "תשלום בכרטיס".

## 10. גיבוי ושחזור

**הכללים:**
- הגיבויים של ה-DEMO נשארים בשרת ה-DEMO.
- הם לא מועתקים לתיקיית הגיבויים של הייצור, ולא לעותק החיצוני שלו.
- אין בהם נתונים אמיתיים, אבל יש בהם פרטי מסופי הבדיקות, מוצפנים.

### 10.1 לפני כל שינוי (מיגרציה, גרסה חדשה, סימון)

```bash
BK=/root/backups/$PROJECT/before-$(date -u +%Y%m%d-%H%M%S); mkdir -p -m 700 "$BK" && echo "$BK"
docker exec "$DB" pg_dump -U postgres -d postgres -Fc > "$BK/db.dump" && docker exec -i "$DB" pg_restore --list < "$BK/db.dump" > "$BK/db.toc" && grep -c "TABLE DATA" "$BK/db.toc"
docker exec "$DB" psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$BK/applied-before.txt" && wc -l < "$BK/applied-before.txt"
git -C "$APP_DIR" rev-parse HEAD > "$BK/app-commit.txt" && cp -p "$APP_DIR/.env" "$BK/app.env" && chmod 600 "$BK/app.env"
IMG=$(docker inspect "$APP" --format '{{.Config.Image}}' 2>/dev/null) && docker tag "$IMG" "${IMG%:*}:before-$(basename "$BK" | cut -d- -f2-)" && echo "image tagged"
```

### 10.2 עותק קר מלא — לפני מיגרציה 208

**זה העותק היחיד שמשחזר הכול בדיוק.** ‏`pg_dump` טוב לשחזור נקודתי, אבל לא לשחזור מלא של Supabase.
- ב-DEMO ההשבתה לא מפריעה לאף אחד.
- התהליך זהה ל-`docs/hospitality/install-guide.md` §1.5, עם המשתנים של ה-DEMO. הבלוק עוצר רק אם כל המשתנים מוגדרים, ותמיד מעלה בחזרה.

```bash
SB_SERVICES="db meta studio kong auth rest storage imgproxy"
if [ -n "$APP" ] && [ -n "$DB" ] && [ -d "$BK" ] && [ -f "$SB_DIR/docker/docker-compose.yml" ]; then
  docker stop "$APP"
  (cd "$SB_DIR/docker" && docker compose -p "$PROJECT" stop $SB_SERVICES)
  tar -czf "$BK/supabase-volumes.tgz" -C "$SB_DIR/docker" volumes
  V=$(docker volume inspect "${PROJECT}_db-config" --format '{{.Mountpoint}}' 2>/dev/null) \
    && tar -czf "$BK/db-config.tgz" -C "$V" .
  (cd "$SB_DIR/docker" && docker compose -p "$PROJECT" start $SB_SERVICES)
  for i in $(seq 1 60); do docker exec "$DB" pg_isready -U postgres -q && break; sleep 2; done
  docker start "$APP"
  sleep 15; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$APP_PORT/healthz"   # 200
else
  echo "עצירה: המשתנים לא מוגדרים בטרמינל הזה, או ש-BK לא קיים (10.1)"
fi
```

### 10.3 שחזור

| מה | איך |
| --- | --- |
| הכול (מסד, קבצים, הגדרות Supabase) | מהעותק הקר — `install-guide.md` §12, עם המשתנים של ה-DEMO |
| מבנה המסד בלבד (בלי נתוני תשלום) | ה-Rollback של 208 (§7.4) |
| בדיקה שהגיבוי ניתן לשחזור | למסד נפרד `restore_check` שנוצר ונמחק (10.4). **לעולם לא** מעל המסד החי |
| האפליקציה | ה-image המתויג (10.1) ו-`git checkout` לקומיט שב-`app-commit.txt` |
| מפתחות השורש אבדו | פרטי המסופים לא מתפענחים. יוצרים מפתחות חדשים, ומקלידים מחדש את פרטי המסופים |

**אף פעם:**
- לא משחזרים גיבוי של DEMO לייצור, ולא להפך.
- גם אם זה יקרה בטעות — הסימון במסד, וקשירת ההצפנה לסביבה (DM-ENV-4), מונעים שימוש בפרטים מוצפנים של סביבה אחרת.

### 10.4 תרגיל שחזור (פעם אחת ב-D6)

```bash
docker exec "$DB" psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" \
  && docker exec -i "$DB" pg_restore -U postgres -d restore_check --no-owner --no-privileges < "$BK/db.dump" > /dev/null 2>&1; \
  for d in postgres restore_check; do docker exec "$DB" psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public._migrations_applied)"; done \
  && docker exec "$DB" psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

שתי השורות שמודפסות חייבות להיות זהות.

### 10.5 גיבוי יומי (לא חובה)

הנתונים בדויים. אם בכל זאת רוצים גיבוי יומי:

```bash
BACKUP_PROJECT=nuriel-demo KEEP_DAILY=7 KEEP_MONTHLY=0 BACKUP_AGE_RECIPIENT=<מפתח age ציבורי של ה-DEMO> bash "$APP_DIR/deploy/backup-install.sh"
```

- **מפתח age נפרד מזה של הייצור.**
- את המפתח הפרטי שומרים במחשב שלכם, לא בשרת.

## 11. פעולות ידניות בפורטל של Hyp (D7 — רק באישור)

**מתי:** רק אחרי ש-Hyp פתחה את מסופי הבדיקות וענתה על H1–H5, ‏H7 ו-H8 (`HYP-REQUEST-DRAFT.md`), ורק באישור שלכם.

**כלל:** בשלב הזה אני לא נכנס לפורטל, לא משנה שום הגדרה במסוף, ולא שולח את הפנייה.

| # | בכל אחד משלושת המסופים (פלטפורמה, חנות A, חנות B) | אם לא |
| --- | --- | --- |
| P1 | מספר המסוף מתחיל ב-`00100` | **עוצרים.** לא מקלידים אותו בשום מקום |
| P2 | כתובת ההצלחה:<br>• פלטפורמה: `https://admin.demo.nuri1.fit/platform/payments/return/max`<br>• חנות A: `https://store-a.demo.nuri1.fit/payments/return/max`<br>• חנות B: `https://store-b.demo.nuri1.fit/payments/return/max` | — |
| P3 | כתובת השגיאה: ריקה (ברירת המחדל) | — |
| P4 | "אימות לפי חתימה בדף התשלום" — מופעל (H4). רק בודקים | פונים ל-Hyp |
| P5 | **מודול החשבוניות כבוי** (H3). רק בודקים | **עוצרים.** בלי זה כל עסקת בדיקה מפיקה מסמך |
| P6 | ארנקים, ‏bit, כרטיסי מתנה וקישורי תשלום — כבויים. מקסימום תשלומים: 1 (H7) | פונים ל-Hyp |
| P7 | ‏**3DS: לא נוגעים בהגדרות.** ייבדק מול MAX/Hyp בנפרד | — |
| P8 | לא יוצרים סיסמת זיכויים (`zPass`), ולא מבקשים הרשאת זיכוי | — |
| P9 | כתובת ה-IP של שרת ה-DEMO נרשמה, אם Hyp ביקשה (H8) | — |
| P10 | צילום מסך של הגדרות הפורטל — רק בלי `KEY`, ‏`PassP` ומספר המסוף המלא | — |

**אחר כך, במסכי הניהול של שרת ה-DEMO:**
1. **מסוף הפלטפורמה:** ב-`admin.demo.nuri1.fit`, במסך מסוף הפלטפורמה.
   - נדרש קוד אימות שנשלח במייל, ומגיע לשרת הדמה (§6.10).
   - הקוד חד-פעמי, ל-10 דקות, ולשינוי הזה בלבד.
2. **מסופי החנויות:** בתיק הלקוח של כל חנות, בלשונית MAX, על ידי מנהל פלטפורמה.
3. **בדיקת חיבור (M01):** בכל מסוף. רק SIGN, בלי חיוב. זו כבר הרצה מול Hyp, ולכן היא אחרי הסרת החסימה (§6.5), באישור D7.

**הסרת החסימה של Hyp (באישור D7):**
- מוחקים את `:deploy/demo/compose.demo-block-hyp.yml` משורת `COMPOSE_FILE` ב-`.env`;
- מריצים `docker compose up -d`;
- מריצים `demo-check.sh`, ומוודאים ש-C6 מדווח "הוסרה".

## 12. פירוק השרת בסוף ה-DEMO

1. **פרטי המסופים:** מוחקים במסכי הניהול (מסוף הפלטפורמה, ומסופי חנויות A ו-B).
2. **Hyp:** מבקשים לסגור את מסופי הבדיקות. אם סיסמה הופיעה מחוץ לטופס — מבקשים להחליף אותה.
3. **ראיות:** שומרים את קובץ הראיות המסונן (`MAX-DEMO-PLAN.md` §7.7). החומר הגולמי נמחק.
4. **השרת:** עוצרים את הקונטיינרים, ומוחקים את:
   - `/root/nuriel-demo-*` ו-`/root/backups/nuriel-demo`;
   - האחסון של docker;
   - ‏`/etc/nginx/nuriel-demo.htpasswd` ו-`/etc/letsencrypt`.
   - לבסוף — מוחקים את ה-VPS אצל הספק, כולל הדיסקים.
5. **DNS:** מוחקים את רשומות ה-A של `*.demo.nuri1.fit`.
6. **גישה:** מוחקים את מפתח הפריסה מ-GitHub, ואת מפתח ה-SSH של השרת.
7. **גיבוי יומי, אם הותקן:** מפתח ה-age של ה-DEMO נמחק.

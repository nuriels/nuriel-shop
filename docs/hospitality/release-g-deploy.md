# שלב G (Morning Sprint + סבב השלמת המוצר) — סדר פריסה בטוח ופקודות עדכון לשרת

> **בוצע בשרת — 2 בנובמבר 2026:** E1–E3 (U2–U8), F (FU1–FU8) ו-G (GU1–GU8, מיגרציות 33–39) — הקוד בשרת
> נעוץ ב-`f6bc626`, 155 מיגרציות רשומות, כל הבדיקות עברו (GU5: `7|37|t|t|t|1|f|f|f|f|f|t|t|1`, לוג נקי).
> לפני U2 נלקח גיבוי עדכני נוסף (`before-e1-e2-e3/db-fresh.dump`). במהלך FU6 השרת הופעל מחדש ידנית;
> הבנייה הורצה שוב והצליחה. נקודות חזרה: התגים `before-e1-e2-e3`, `before-f`, `before-g` והגיבויים
> בתיקיות המתאימות. **אין פקודה ממתינה מהמסמך הזה.**
>
> (המקור, לפני הפריסה:) **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.

## הסדר — ולמה

1. **E1–E3** (U2–U8 ב-`release-f-deploy.md`), נעוץ ב-`2e53763` — **בלי שינוי**. U1 (גיבוי) כבר רץ.
   **הפקודה הבאה לשרת היא עדיין U2.**
2. **F** (FU1–FU8 ב-`release-f-deploy.md`), נעוץ ב-`2d0b5f0` — מיגרציה 32 — **בלי שינוי**.
3. **רק אחרי ש-F עובד ונבדק — G** (GU1–GU8 כאן), נעוץ ב-`f6bc626`: שבע מיגרציות (33–39) ובנייה
   מחדש. (בגרסאות קודמות של המסמך: `f0c5bb9` / `b67f7ff` — הוחלף; שום דבר מזה עוד לא רץ בשרת.)

כל שלב נבדק לבד, ולכל אחד גיבוי ותג image משלו (`before-e1-e2-e3`, `before-f`, `before-g`) — חזרה
מהירה לנקודה האחרונה שעבדה.

## מה נכנס ב-G

| | מיגרציה | מה |
|---|---|---|
| E4 | `20261105100000_hosp_support.sql` (33) | מערכת תמיכה לעסקי האירוח: פניות, הודעות, הערות פנימיות, קבצים (דלי פרטי `hosp-support`), תיבת פניות בפאנל הפלטפורמה |
| E5 | — (בלי מיגרציה) | sitemap.xml ו-robots.txt לכל אתר, הגדרות גוגל ושיתוף (כותרת, תיאור, תמונה, כתובת קנונית, אימות Search Console) |
| Calendar Pro | — | תצוגת יחידות, שורת "פנויות", סימון התנגשויות, מעבר מהיר לחודש |
| יחידות | — | כרטיסים עם תמונה, מחיר, זמינות ומצב באתר; כרטיס מחיר בעמוד היחידה |
| F7 | `20261105110000_hosp_reports.sql` (34) | דוחות וייצוא CSV / הדפסה — אותו חישוב כמו לוח הבקרה |
| הקמה | `20261105120000_hosp_setup_guide.sql` (35) | מדריך "הקמת העסק": 13 צעדים, 5 אבני דרך, המשך מאותה נקודה |
| עיצוב | — | פעילות בשפה פשוטה לכל פעולה, מסך "לא נטען" עם כותרת וחזרה למקום הנכון |
| אבטחה | `20261105130000_hosp_rate_check.sql` (36) | מונה הקצב המשותף: ניסיון שנחסם כבר לא "שורף" מכסות של כללים אחרים (העסק, הרשת, אסימון CAPTCHA); נעילה לכל מונה — נכון גם בבקשות מקבילות. אותן מגבלות |
| תשלומים | `20261105140000_hosp_payment_instructions.sql` (37) | הוראות תשלום לאורחים: העברה בנקאית, Bit, תשלום טלפוני, הוראות משלכם. בעלי העסק בלבד עורכים; האורח רואה אותן בעמוד ההזמנה שלו אחרי האישור. ההוראות אינן אישור תשלום |
| האתר | `20261105150000_hosp_unit_photos_public.sql` (38) | התמונות שבעל העסק מעלה ליחידה מופיעות באתר הציבורי, בתצוגה המקדימה ובתמונת השיתוף (עד עכשיו: "התמונות יעלו בקרוב") |
| אורחים | `20261105160000_hosp_confirm_link.sql` (39) | קישור אישי לעמוד ההזמנה גם במייל "ההזמנה אושרה": טוקן שני שנוצר באישור (רק hash במסד, נמחק מהמייל אחרי השליחה); הקישור מהמייל הראשון ממשיך לעבוד |
| מסלול עסק חדש | — | טופס ההזמנה לא דוחה אורח שממלא מהר; "הבקשה התקבלה" נפתח מלמעלה; התשלומים מתעדכנים אחרי אישור; רישום תשלום בלי ברירות מחדל שגויות; טקסטים |
| מוכנות מסחרית | — | מה קורה אחרי הניסיון, החבילות כפי שהוגדרו בפלטפורמה, מעבר לחבילה בתשלום דרך פנייה, "עזרה ותמיכה" בכל מסך |

## תאימות

- **G תלוי במיגרציה 32 (F):** מיגרציה 34 מגדירה מחדש את פונקציות העזר של לוח הבקרה ממיגרציה 32
  (אותן חתימות, אותן תוצאות — נבדק). לכן G רק אחרי F. אם 32 לא רצה, הבדיקה היבשה (GU3) תראה יותר
  משבע שורות — **עוצרים.**
- **33–39 תואמות לאחור:** האפליקציה של F (`2d0b5f0`) ממשיכה לעבוד מעליהן.
  - היא לא קוראת לפונקציות החדשות;
  - לוח הבקרה מחזיר אותם מספרים;
  - ב-`management_context()` נוסף רק המפתח `site`, ו-`policy` נשאר;
  - `rate_check` (36) — אותה חתימה ואותה צורת תשובה;
  - `_public_media` (38) פנימית — גם האתר של F יתחיל להציג את התמונות של היחידות;
  - `approve_booking` ו-`get_booking_by_token` (39) — אותן חתימות ואותה תשובה; גם האפליקציה של F תציג
    את הכפתור במייל האישור (הקישור עובד).
  - לכן המיגרציות קודם (GU4) והבנייה אחריהן (GU6–GU7), ובדקות שביניהן האתר ממשיך לעבוד.
- **הגרסה החדשה של האפליקציה צריכה את 33–39.** אם היא עולה לפני המיגרציות:
  - "תמיכה", "דוחות" ו"הקמת העסק" יציגו "המסך לא נטען";
  - ב"הגדרות העסק" הכרטיס "תשלום מאורחים" לא ייטען; האורחים יראו את נוסח התשלום הטלפוני (כמו היום);
  - התמונות של היחידות לא יופיעו באתר (כמו היום);
  - ברשימה בלוח הבקרה, "האתר מוכן לפרסום" יופיע כלא הושלם;
  - שאר המסכים עובדים.
- **E1–E3:** אין שינוי בפונקציות של השער (פתיחת חנות, בקשות לאתרי צימר, חבילות). כרטיס "החבילה
  שלי" קורא את החבילות המפורסמות דרך `public_plans()` הקיימת (מיגרציה 30) — בלי שינוי בחבילות,
  במחירים או בתנאים.
- **החנויות (Ecommerce):** אין שינוי בקוד, בנתונים, בעיצוב או בסכמת `public` שלהן.
  - המיגרציות לא משנות אף אובייקט ב-`public`. הפונקציות החדשות רק כותבות שורות ליומן הפלטפורמה
    הקיים (`platform_audit_log`), כמו שאר פונקציות מנהל הפלטפורמה.
  - מיגרציה 33 מוסיפה דלי אחסון פרטי אחד (`hosp-support`), בלי לגעת בדליים הקיימים.
- **משתני סביבה — אין חדשים.** הקוד החדש משתמש בשלושה שכבר קיימים ומשמשים את החנויות:
  - `SUPPORT_NOTIFY_EMAIL` (לא חובה) — לאן נשלחת התראה על פנייה חדשה מעסק אירוח. בלי ערך — לכל
    מנהלי הפלטפורמה.
  - `PLATFORM_ADMIN_HOST` — הקישור במייל להתראה ("לפנייה בפאנל").
  - `SITEMAP_TTL_MS` (לא חובה) — זמן המטמון של מפות האתר. בלי ערך — 5 דקות.
- **בלי שינוי ב-Nginx, ב-GoTrue, ב-Kong או ב-docker-compose.**

---

## ג. עדכון G (אחרי ש-F נבדק)

### GU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-g && chmod 700 /root/backups/nuriel-shop/before-g && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-g/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-g/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-g/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-g/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-g/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-g && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:**
1. מספר של בערך 140 ומעלה (הטבלאות בגיבוי).
2. `148` (147 + מיגרציה 32).
3. `2d0b5f0 …`.
4. התגים `latest`, `pre-hospitality`, `before-e1-e2-e3`, `before-f`, `before-g`.

### GU2 — הקוד (נעוץ ב-`f6bc626`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only f6bc626 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-g/rollbacks && ls /root/backups/nuriel-shop/before-g/rollbacks | grep -c 20261105
```

**מצופה:**
- **שורת ה-fetch** תראה את ה-commit **האחרון** בענף (מסמכים שנוספו אחרי `f6bc626`). זה בסדר: ה-merge
  נעוץ ב-`f6bc626`, הקוד של שלב G.
- `Updating 2d0b5f0..f6bc626`, `Fast-forward`;
- `f6bc626 Hospitality plan card: the real billing process — a payment link after the trial, billing outside the system`;
- `8` (קובצי ה-rollback של 32–39).

### GU3 — בדיקה יבשה: בדיוק שבע מיגרציות ממתינות

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-g/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-g/files.txt /root/backups/nuriel-shop/before-g/applied-before.txt
```

**מצופה:** שבע שורות בדיוק, בסדר הזה:

- `20261105100000_hosp_support.sql`
- `20261105110000_hosp_reports.sql`
- `20261105120000_hosp_setup_guide.sql`
- `20261105130000_hosp_rate_check.sql`
- `20261105140000_hosp_payment_instructions.sql`
- `20261105150000_hosp_unit_photos_public.sql`
- `20261105160000_hosp_confirm_link.sql`

**אחרת — עוצרים.**

### GU4 — הרצת המיגרציות, אחת-אחת

כל מיגרציה עטופה ב-BEGIN / COMMIT: שגיאה = כלום ממנה לא נשאר, והיא לא נרשמת. **שגיאה — עוצרים
ושולחים את הפלט** (לא ממשיכים לבאה).

**GU4a — מיגרציה 33 (תמיכה):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105100000_hosp_support.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105100000_hosp_support.sql')" && echo "33 ok"
```

**מצופה:** `33 ok`.

**GU4b — מיגרציה 34 (דוחות):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105110000_hosp_reports.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105110000_hosp_reports.sql')" && echo "34 ok"
```

**מצופה:** `34 ok`.

**GU4c — מיגרציה 35 (מדריך ההקמה):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105120000_hosp_setup_guide.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105120000_hosp_setup_guide.sql')" && echo "35 ok"
```

**מצופה:** `35 ok`.

**GU4d — מיגרציה 36 (מונה הקצב):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105130000_hosp_rate_check.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105130000_hosp_rate_check.sql')" && echo "36 ok"
```

**מצופה:** `36 ok`.

**GU4e — מיגרציה 37 (הוראות תשלום לאורחים):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105140000_hosp_payment_instructions.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105140000_hosp_payment_instructions.sql')" && echo "37 ok"
```

**מצופה:** `37 ok`.

**GU4f — מיגרציה 38 (התמונות של היחידות באתר):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105150000_hosp_unit_photos_public.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105150000_hosp_unit_photos_public.sql')" && echo "38 ok"
```

**מצופה:** `38 ok`.

**GU4g — מיגרציה 39 (קישור במייל האישור):**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105160000_hosp_confirm_link.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105160000_hosp_confirm_link.sql')" && echo "39 ok"
```

**מצופה:** `39 ok`.

### GU5 — בדיקה ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename IN ('20261105100000_hosp_support.sql', '20261105110000_hosp_reports.sql', '20261105120000_hosp_setup_guide.sql', '20261105130000_hosp_rate_check.sql', '20261105140000_hosp_payment_instructions.sql', '20261105150000_hosp_unit_photos_public.sql', '20261105160000_hosp_confirm_link.sql')), (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.setup_state'::regclass), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.support_tickets'::regclass), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.payment_settings'::regclass), (SELECT count(*) FROM storage.buckets WHERE id = 'hosp-support' AND NOT public), has_function_privilege('anon', 'hospitality.reports_view(date,date,uuid[],text[],text[])', 'EXECUTE'), has_function_privilege('anon', 'hospitality.setup_guide()', 'EXECUTE'), has_function_privilege('anon', 'hospitality.support_open(text,text,text,text,jsonb)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.payment_settings_save(jsonb,integer)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.rate_check(jsonb)', 'EXECUTE'), (SELECT prosrc LIKE '%pg_advisory_xact_lock%' FROM pg_proc WHERE oid = 'hospitality.rate_check(jsonb)'::regprocedure), (SELECT prosrc LIKE '%m.unit_id = _unit%' FROM pg_proc WHERE oid = 'hospitality._public_media(uuid,text,uuid,uuid)'::regprocedure), (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings' AND column_name = 'manage_token2_hash')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:**
- `7|37|t|t|t|1|f|f|f|f|f|t|t|1`:
  - 7 מיגרציות נרשמו;
  - 37 טבלאות (31 + 4 של התמיכה + 1 של המדריך + 1 של הוראות התשלום);
  - RLS פעיל בטבלאות החדשות;
  - הדלי `hosp-support` קיים ופרטי;
  - אורח לא מחובר לא יכול לקרוא לפונקציות החדשות של הצוות, וגם לא למונה הקצב;
  - מונה הקצב — הגרסה של 36 (עם נעילה); התמונות — הגרסה של 38; הטוקן השני של 39 קיים.
- אחריו `NOTIFY`.

(נבדק על מסד מקומי עם כל המיגרציות: בדיוק הפלט הזה.)

### GU6 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### GU7 — העלאה ובדיקות

```bash
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE
```

**מצופה:**
- `healthy`;
- `robots: 200`;
- `fonts: 200 font/woff2`;
- `on`.

### GU8 — לוג ובדיקה בדפדפן

```bash
docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** ריק.

**בדפדפן — `/manage` של עסק האירוח (בעלים).** בלי לפתוח הזמנות ציבוריות ובלי לשלוח הזמנה מהאתר:
- **"הקמת העסק":** הצעדים, אבני הדרך ו"ממשיכים מאיפה שעצרתם" (אחרי מעבר למסך אחר וחזרה).
  - בלוח הבקרה, ברשימה, מופיע "האתר מוכן לפרסום".
- **"עזרה ותמיכה"** בסרגל העליון (בכל מסך) → מסך התמיכה.
- **"תמיכה":** פתיחת פנייה עם תמונה.
  - בפאנל הפלטפורמה (`/platform/hospitality#support`) הפנייה מופיעה.
  - תשובה משם → העסק רואה "צוות התמיכה" ומקבל מייל.
  - הערה פנימית לא מופיעה לעסק.
- **"החבילה שלי"** (לוח הבקרה, בעלים): בזמן ניסיון — "אחרי תקופת הניסיון" והחבילות בסיסית ופרימיום,
  במחירים שמוגדרים בפאנל; הכפתור "מעבר לחבילה בתשלום" פותח פנייה ממולאת. הקישור "מה קורה אחר כך?"
  בהודעה העליונה מוביל לכרטיס.
- **"הגדרות העסק" → "תשלום מאורחים":** בעלים — שמירה של העברה בנקאית / Bit והתצוגה "כך האורח
  יראה"; מנהל — לקריאה בלבד.
- **"עיצוב האתר" → תצוגה מקדימה:** התמונות שהועלו ליחידות מופיעות (לא "התמונות יעלו בקרוב").
- **"דוחות":** תקופה, ייצוא CSV שנפתח ב-Excel בעברית, הדפסה.
- **"יומן":** תצוגת "יחידות" ושורת "פנויות".
- **"יחידות":** הכרטיסים; בעמוד יחידה — כרטיס המחיר.
- **"עיצוב האתר":**
  - הלשונית "גוגל ושיתוף" → פרסום → בקוד המקור של האתר: canonical ו-og.
  - `/sitemap.xml` של האתר (רק כשהאתר פתוח).
- **מנהל (לא בעלים):** בלי הכנסות, בלי סכומים בדוחות, ובלי שמות מלאים של אורחים אם אין לו
  הרשאת אורחים; בלי כרטיס החבילה.
- **האתר הציבורי:** הקרדיט בפוטר, בכל עמוד.
- **חנות:** הכול כרגיל — דף הבית, מוצר, `/admin`, `/sitemap.xml` של החנות.

### חזרה (G) — קודם האפליקציה, אחר כך המסד

1. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-g nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   - ה-image של F עולה מיד, בלי בנייה, והוא עובד מעל 33–39 (תואמות לאחור).
   - **התיקייה נשארת על `f6bc626`.** לא בונים ממנה שוב עד שמחליטים איך ממשיכים.

2. **המסד — רק אם צריך, בסדר הפוך (39 → 38 → 37 → 36 → 35 → 34 → 33), פקודה לכל מיגרציה:**

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105160000_hosp_confirm_link.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105160000_hosp_confirm_link.sql'" && echo "39 down"
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105150000_hosp_unit_photos_public.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105150000_hosp_unit_photos_public.sql'" && echo "38 down"
   ```

   לפני 37 — עותק של הוראות התשלום שהעסקים שמרו (קריאה בלבד):

   ```bash
   docker exec nuriel-shop-db pg_dump -U postgres -d postgres --data-only -t hospitality.payment_settings > /root/backups/nuriel-shop/before-g/payment_settings.sql && wc -l < /root/backups/nuriel-shop/before-g/payment_settings.sql
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105140000_hosp_payment_instructions.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105140000_hosp_payment_instructions.sql'" && echo "37 down"
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105130000_hosp_rate_check.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105130000_hosp_rate_check.sql'" && echo "36 down"
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105120000_hosp_setup_guide.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105120000_hosp_setup_guide.sql'" && echo "35 down"
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105110000_hosp_reports.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105110000_hosp_reports.sql'" && echo "34 down"
   ```

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-g/rollbacks/20261105100000_hosp_support.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105100000_hosp_support.sql'" && echo "33 down"
   ```

   ```bash
   docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
   ```

   **מה נמחק:**
   - **39:** הטוקן השני — הקישורים שנשלחו במיילי האישור מפסיקים לעבוד; הקישורים מהמייל הראשון ממשיכים.
     מיילי אישור חדשים — שוב בלי קישור.
   - **38:** פונקציה בלבד — התמונות של היחידות שוב לא מופיעות באתר (כמו לפני). התמונות עצמן נשארות.
   - **37:** הטבלה של הוראות התשלום (העותק נשמר בצעד שלפני) והפונקציות שלה. מצב התשלום של ההזמנות
     ויומן התשלומים לא נוגעים; האורחים רואים שוב את נוסח התשלום הטלפוני. מדריך ההקמה חוזר לגרסה של 35.
   - **36:** פונקציה בלבד — המונה חוזר לגרסה של מיגרציה 25, מילה במילה.
   - **35:** רק המקום שבו כל עסק עצר במדריך, האישורים והדילוגים. אלה מצב תצוגה — היחידות, המחירים,
     ההגדרות והאתר לא נוגעים.
   - **34:** פונקציות בלבד. לוח הבקרה חוזר לפונקציות של מיגרציה 32, מילה במילה.
   - **33 מסרבת לרדת כשיש פניות או קבצים** (כדי לא למחוק פניות של עסקים). במקרה כזה משאירים אותה:
     האפליקציה של F לא משתמשת בה.

   **מה נשאר:** הזמנות, תשלומים, אורחים, תמונות, האתר ושאר הנתונים.

   (נבדק מקומית: rollback של כל מיגרציה מחזיר את הסכמה בדיוק למצב שלפניה, והמחזור 39 → 1 → 39
   זהה למקור.)

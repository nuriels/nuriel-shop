# שלבים J + K — הלוגו, פתיחת תאריכים, לוחות שנה, כמה חדרים בבקשה אחת: סדר פריסה ופקודות לשרת

> **עוד לא לפרוס.** המסמך מכין עדכון אחד לשרת (לפי ההחלטה: J ו-K יחד); הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.
>
> **מצב השרת לפני העדכון:** I פרוס (`4da712f`), 157 מיגרציות רשומות, תגי חזרה עד `before-i`.
> המסמך הזה מחליף את `release-j-deploy.md` (J לבד — לא נפרס).

## מה נכנס

|                     | מיגרציה                                       | מה                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| הלוגו               | `20261105190000_hosp_logo_brand.sql` (42)     | לוגו שמעלים בעורך נשמר בנפרד — לא נכנס ל"תמונות" ולא דורס את התמונה הראשית. לוגואים שכבר בגלריית האתר עוברים החוצה, וגלריה שנשארה בלי ראשית מקבלת את התמונה הראשונה שלה                                                                                                                                                                                                |
| פתיחת תאריכים       | `20261105200000_hosp_open_dates.sql` (43)     | אורחים מזמינים באתר רק בתאריכים שבעל המקום פתח לכל יחידה ("פתוח עד…"). **כברירת מחדל — סגור: גם כל היחידות שכבר קיימות** (ההחלטה שלך). הצוות יכול להזמין ידנית גם בסגור. "כל המתחם" באתר תפוס גם כשאחת היחידות שלו תפוסה (ולהפך) — גם בלוח השנה באתר וגם ביומן ה-iCal של המתחם. משימה בלוח הבקרה, ותזכורת במייל לבעל העסק — לכל היותר פעם בשבוע, רק לאתר שפתוח להזמנות |
| היומן בניהול        | —                                             | "פתיחת תאריכים" (כמה יחידות בבת אחת: חודש / 3 חודשים / חצי שנה / סוף השנה / תאריך), פס התראה, לילות שלא פתוחים מסומנים בפסים; לוח בשלושה גדלים (רגיל — חדש, גדול יותר); התצוגה והגודל נשמרים                                                                                                                                                                           |
| לוח השנה באתר       | —                                             | ימים גדולים יותר, שלושה מצבים — פנוי / תפוס / עוד לא נפתח, מקרא ברור; שלושה סגנונות שבעל העסק בוחר בעורך האתר (קלאסי / צבעוני / מינימלי)                                                                                                                                                                                                                               |
| כמה חדרים בבקשה אחת | `20261105210000_hosp_booking_groups.sql` (44) | אורח מוסיף חדרים פנויים באותם תאריכים — בקשה אחת (כל החדרים או אף אחד), מייל אחד לאורח (קישור אישי לכל חדר) ומייל אחד לעסק; בעמוד ההזמנה — "אישור כל החדרים" / "דחיית כל החדרים", ומייל אחד לאורח. כל חדר — הזמנה רגילה (תשלומים, ביטול ושינוי לכל חדר)                                                                                                                |

## חשוב לדעת לפני — ואחרי

- **מרגע העדכון, אף יחידה לא ניתנת להזמנה באתר עד שבעל המקום פותח תאריכים** (ביומן ← "פתיחת
  תאריכים"). ב-JKU3 רואים, לכל עסק, כמה יחידות פעילות ייסגרו. מיד אחרי העדכון — לפתוח תאריכים לעסקים
  שצריכים להמשיך לקבל הזמנות (למשל נופי דורית, כשהאתר שלה יעלה).
- **תזכורת במייל:** בהפעלה הראשונה (כדקה אחרי JKU5) יוצא מייל "יש יחידות שלא פתוחות להזמנה באתר" —
  רק לבעלים של אתרים שכבר פתוחים להזמנות, ולכל היותר פעם בשבוע.
- **Airbnb / Booking:** היומנים החיצוניים מקבלים, כמו היום, רק הזמנות וחסימות — לא "עוד לא נפתח".
  חדש: היומן של "כל המתחם" כולל גם את ההזמנות של היחידות שלו.

## תאימות — הסדר חשוב

- **הגרסה הקודמת (I) מעל 42–44:** לא מוצאת לוגו שעבר החוצה (שם העסק בטקסט במקום הלוגו), ולוח השנה
  שלה מציג את כל הימים כתפוסים (היחידות סגורות). לכן **בונים קודם** (JKU4 — האתר ממשיך לרוץ),
  ו**המיגרציות וההעלאה — באותה פקודה** (JKU5): החלון — שניות. אם מיגרציה נכשלת, הפקודה עוצרת לפני
  ההעלאה; מה שכבר רץ — עטוף בטרנזקציה משלו (כל מיגרציה או כולה או כלום).
- **החנויות (Ecommerce):** בלי שינוי. המיגרציות נוגעות רק בסכמת `hospitality`.
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-GoTrue, ב-Kong או ב-docker-compose.

(נבדק מקומית: 2401 בדיקות מסד בשלושה מעברים; 45 תרחישי מקביליות; rollback של כל אחת (44, 43, 42)
מחזיר את הסכמה בדיוק למצב שלפניה, והמחזור 44 → 1 → 44 זהה למקור; בדיקות דפדפן: לוגו, פתיחת תאריכים
(מהמשימה ועד לוח השנה באתר), גודל הלוח, שני חדרים בבקשה אחת (עד אישור כולם), ההזמנה הרגילה באתר
במחשב ובטלפון, היומן — גם 300 חדרים.)

---

## עדכון J + K

### JKU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-jk && chmod 700 /root/backups/nuriel-shop/before-jk && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-jk/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-jk/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-jk/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-jk/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-jk/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-jk && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:** מספר בסביבות 147 (טבלאות בגיבוי); `157`; `4da712f …`; התגים כולל `before-jk`.

### JKU2 — הקוד (נעוץ ב-`c13cd00`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only c13cd00 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-jk/rollbacks && ls /root/backups/nuriel-shop/before-jk/rollbacks | grep -c 20261105
```

**מצופה:**

- בשורת ה-fetch יכול להופיע commit מאוחר יותר (תיעוד) — בסדר: ה-merge נעוץ ב-`c13cd00`.
- `Updating 4da712f..c13cd00`, `Fast-forward`;
- `c13cd00 Hospitality concurrency tests: open the units they create (migration 43)`;
- `13` (קובצי ה-rollback של 32–44).

### JKU3 — בדיקה יבשה: 3 מיגרציות ממתינות, ומה ישתנה (קריאה בלבד)

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-jk/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-jk/files.txt /root/backups/nuriel-shop/before-jk/applied-before.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, count(u.id) FILTER (WHERE u.is_active) AS units_to_close, (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = t.id AND m.owner_kind = 'site' AND m.kind = 'image' AND (m.alt LIKE 'הלוגו של %' OR EXISTS (SELECT 1 FROM hospitality.site_versions v WHERE v.tenant_id = m.tenant_id AND lower(v.document ->> 'logo') = m.id::text))) AS logos_to_move FROM public.tenants t LEFT JOIN hospitality.units u ON u.tenant_id = t.id WHERE t.site_type = 'hospitality' GROUP BY t.id, t.slug ORDER BY t.slug"
```

**מצופה:**

- שלוש שורות בדיוק, בסדר הזה: `20261105190000_hosp_logo_brand.sql`, `20261105200000_hosp_open_dates.sql`,
  `20261105210000_hosp_booking_groups.sql`. **אחרת — עוצרים.**
- טבלה: לכל עסק אירוח — כמה יחידות פעילות ייסגרו להזמנה (`units_to_close`) וכמה לוגואים יעברו
  החוצה מגלריית האתר (`logos_to_move`).

### JKU4 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### JKU5 — שלוש המיגרציות והעלאת הגרסה החדשה — פקודה אחת

כל מיגרציה עטופה ב-BEGIN / COMMIT. שגיאה = המיגרציה הזו לא נשארת ולא נרשמת, והפקודה עוצרת לפני
ההעלאה (האתר נשאר על I). **שגיאה — עוצרים ושולחים את הפלט.**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105190000_hosp_logo_brand.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105190000_hosp_logo_brand.sql')" && echo "42 ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105200000_hosp_open_dates.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105200000_hosp_open_dates.sql')" && echo "43 ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105210000_hosp_booking_groups.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105210000_hosp_booking_groups.sql')" && echo "44 ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && docker compose up -d
```

**מצופה:** `42 ok`, `43 ok`, `44 ok`, `NOTIFY`, ואחריהן שורות ה-compose (`Started` / `Running`).

### JKU6 — בדיקות העלאה (הפקודה מחכה דקה — זה לא תקוע)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE
```

**מצופה:** `healthy`; `robots: 200`; `fonts: 200 font/woff2`; `on`.

### JKU7 — בדיקת המסד והלוג

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename IN ('20261105190000_hosp_logo_brand.sql', '20261105200000_hosp_open_dates.sql', '20261105210000_hosp_booking_groups.sql')), (SELECT count(*) FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname IN ('media_owner_check', 'media_owner_kind_check')), (SELECT count(*) FROM hospitality.media WHERE owner_kind = 'site' AND alt LIKE 'הלוגו של %'), (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND ((table_name = 'units' AND column_name = 'open_until') OR (table_name = 'bookings' AND column_name = 'group_id'))), (SELECT count(*) FROM hospitality.units WHERE open_until IS NOT NULL), (SELECT count(*) FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace AND proname IN ('units_open_dates', 'open_dates_remind', 'public_free_units', 'request_booking_group', 'booking_group', 'booking_group_decide')), has_function_privilege('anon', 'hospitality.request_booking_group(jsonb,date,date,text,text,text,text,boolean,text,boolean,text)', 'EXECUTE')" && docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** `3|2|0|2|0|6|f` — שלוש המיגרציות נרשמו; שתי הבדיקות החדשות של התמונות; אין לוגו שנשאר
בגלריית האתר; שתי העמודות החדשות; **אף יחידה עוד לא פתוחה** (0 — עד שבעלי העסקים פותחים); שש
הפונקציות החדשות; ואורח לא יכול לשלוח בקשה לכמה חדרים ישירות (רק דרך השרת). אחרי זה — לוג ריק.

**בדפדפן (עסק אירוח שלך):**

- **לוח הבקרה:** משימה "יחידות לא פתוחות להזמנה באתר" ← "פתיחת תאריכים" ← היומן נפתח עם החלון:
  בוחרים יחידות ו"3 חודשים" (או תאריך) ← "פתיחה עד…". הפס האדום נעלם, והלילות שאחרי התאריך מסומנים
  בפסים.
- **היומן:** "גודל: רגיל / גדול / קומפקטי" — נשמר בכניסה הבאה.
- **האתר:** לוח השנה — פנוי / תפוס / "עוד לא נפתח" (אחרי התאריך שנפתח). בעמוד ההזמנה, אחרי בחירת
  תאריכים — "חדרים נוספים באותם תאריכים"; בקשה לשני חדרים ← מייל אחד לאורח, מייל אחד אליך; בעמוד
  ההזמנה אצלך — "בקשה אחת ל-2 חדרים" ← "אישור כל החדרים".
- **עורך האתר ← עיצוב:** "לוח השנה באתר" — קלאסי / צבעוני / מינימלי; הלוגו — "החלפת לוגו" לא משנה
  את התמונה הראשית.
- **חנות:** הכול כרגיל.

### חזרה (J + K) — קודם המסד (מהחדשה לישנה), אחר כך האפליקציה

1. **המסד** — 44, 43, 42 (כל אחת בטרנזקציה משלה):

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-jk/rollbacks/20261105210000_hosp_booking_groups.down.sql && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-jk/rollbacks/20261105200000_hosp_open_dates.down.sql && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-jk/rollbacks/20261105190000_hosp_logo_brand.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename IN ('20261105190000_hosp_logo_brand.sql', '20261105200000_hosp_open_dates.sql', '20261105210000_hosp_booking_groups.sql')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && echo "44 43 42 down"
   ```

   **מה קורה:** הזמנות של כמה חדרים נשארות — כל חדר הזמנה רגילה (בלי הקישור ביניהן); כל התאריכים
   פתוחים שוב לאורחים כמו לפני העדכון (והתאריכים שנפתחו נמחקים); הלוגואים חוזרים לגלריית האתר.

2. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-jk nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   ה-image של I עולה מיד, בלי בנייה. **התיקייה נשארת על `c13cd00`.**

   (נבדק מקומית: rollback של כל אחת מהשלוש מחזיר את הסכמה בדיוק למצב שלפניה.)

# שלב J — הלוגו לא דורס את התמונה הראשית: סדר פריסה ופקודות לשרת

> **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.
>
> **מצב השרת לפני J:** I פרוס (`4da712f`), 157 מיגרציות רשומות, תגי חזרה עד `before-i`.

## מה נכנס ב-J

|               | מיגרציה                                   | מה                                                                                                                                                                                               |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| הבעיה         | —                                         | לוגו שהועלה בעורך האתר נשמר בגלריית האתר. כשבגלריה עוד לא הייתה תמונה ראשית — הוא נהיה התמונה הראשית: ב"תמונות" סומן "תמונה ראשית", ובאתר הציבורי הוצג כתמונת הפתיח עד שפורסם עיצוב עם הלוגו     |
| המסד          | `20261105190000_hosp_logo_brand.sql` (42) | הלוגו נשמר בנפרד (`'brand'`): לא ב"תמונות", לא בגלריה, ואין לו תמונה ראשית. האתר והעורך מקבלים את הלוגואים בנפרד ומוצאים את הלוגו לפי המזהה שבעיצוב                                              |
| נתונים קיימים | (42)                                      | לוגו שכבר נמצא בגלריית האתר עובר החוצה — תמונה שמשמשת כלוגו באחת מגרסאות העיצוב, או שהועלתה בכפתור הלוגו. גלריה שנשארה בלי תמונה ראשית מקבלת את התמונה הראשונה שלה. תמונה ראשית אחרת — לא נוגעים |
| העורך         | —                                         | "בחירה מהלוגואים שהועלו או מהתמונות" (במקום "בחירה מהתמונות של האתר"), ואפשרות "בלי לוגו". הלוגו — תמונה בלבד                                                                                    |

## תאימות — הפעם הסדר חשוב

- **האפליקציה של I לא מכירה את 42:** מעל 42 היא לא מוצאת לוגו שעבר החוצה, והאתר מציג את שם העסק
  בטקסט במקום הלוגו. לכן **בונים קודם** (JU4 — האתר ממשיך לרוץ בזמן הבנייה), ו**המיגרציה וההעלאה של
  הגרסה החדשה — באותה פקודה** (JU5): החלון שבו הלוגו חסר — כמה שניות. אם המיגרציה נכשלת, הפקודה עוצרת
  לפני ההעלאה, והאתר נשאר על I כמו שהוא.
- **הגרסה החדשה מעל המסד הישן** (אם מחזירים רק את המסד): האתר מוצא את הלוגו בגלריה כמו קודם; רק העלאת
  לוגו חדש נכשלת ("הגלריה לא נמצאה").
- **החנויות (Ecommerce):** בלי שינוי. המיגרציה נוגעת רק בטבלת `hospitality.media` (שתי בדיקות CHECK)
  ובארבע פונקציות שקיימות כבר — אותן חתימות, אותן הרשאות.
- **בלי משתני סביבה חדשים**, בלי שינוי ב-Nginx, ב-GoTrue, ב-Kong או ב-docker-compose.

(נבדק מקומית: 2365 בדיקות מסד בשלושה מעברים — כולל העברת לוגואים קיימים; rollback של 42 מחזיר את
הסכמה בדיוק למצב של 41, והמחזור 42 → 1 → 42 זהה למקור; בדיקת דפדפן של העלאה אמיתית: לוגו כשהגלריה
ריקה, תמונה ראשונה בגלריה — ראשית, לוגו שני — הראשית נשארת, והתצוגה המקדימה מציגה את הלוגו החדש.)

---

## עדכון J

### JU1 — גיבוי בלי השבתה

```bash
mkdir -p /root/backups/nuriel-shop/before-j && chmod 700 /root/backups/nuriel-shop/before-j && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-j/db.dump && docker exec -i nuriel-shop-db pg_restore --list < /root/backups/nuriel-shop/before-j/db.dump | grep -c "TABLE DATA" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /root/backups/nuriel-shop/before-j/applied-before.txt && wc -l < /root/backups/nuriel-shop/before-j/applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee /root/backups/nuriel-shop/before-j/app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-j && docker images nuriel-shop-app-app --format '{{.Tag}}'
```

**מצופה:** מספר בסביבות 147 (טבלאות בגיבוי); `157`; `4da712f …`; התגים כולל `before-j`.

### JU2 — הקוד (נעוץ ב-`5b06732`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only 5b06732 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-j/rollbacks && ls /root/backups/nuriel-shop/before-j/rollbacks | grep -c 20261105
```

**מצופה:**

- בשורת ה-fetch יכול להופיע commit מאוחר יותר (תיעוד) — בסדר: ה-merge נעוץ ב-`5b06732`.
- `Updating 4da712f..5b06732`, `Fast-forward`;
- `5b06732 Hospitality logo: kept apart from the photos — never the main image (migration 42)`;
- `11` (קובצי ה-rollback של 32–42).

### JU3 — בדיקה יבשה: מיגרציה אחת ממתינה, ואילו לוגואים יעברו (קריאה בלבד)

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-j/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-j/files.txt /root/backups/nuriel-shop/before-j/applied-before.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, count(*) AS logos, count(*) FILTER (WHERE m.is_cover) AS main_image FROM hospitality.media m JOIN public.tenants t ON t.id = m.tenant_id WHERE m.owner_kind = 'site' AND m.kind = 'image' AND (m.alt LIKE 'הלוגו של %' OR EXISTS (SELECT 1 FROM hospitality.site_versions v WHERE v.tenant_id = m.tenant_id AND lower(v.document ->> 'logo') = m.id::text)) GROUP BY t.slug ORDER BY t.slug"
```

**מצופה:**

- שורה אחת בדיוק: `20261105190000_hosp_logo_brand.sql`. **אחרת — עוצרים.**
- טבלה קטנה: לכל עסק שהעלה לוגו — כמה לוגואים יעברו (`logos`), וכמה מהם הם היום התמונה הראשית
  (`main_image` — שם רואים את הבעיה). אפשר גם `(0 rows)` — אם עוד אף עסק לא העלה לוגו.

### JU4 — בנייה (האתר ממשיך לרוץ בזמן הבנייה)

```bash
cd /root/nuriel-shop-git && docker compose build
```

### JU5 — מיגרציה 42 והעלאת הגרסה החדשה — פקודה אחת

עטופה ב-BEGIN / COMMIT: שגיאה = כלום ממנה לא נשאר, היא לא נרשמת, וההעלאה לא רצה (האתר נשאר על I).
**שגיאה — עוצרים ושולחים את הפלט.**

```bash
cd /root/nuriel-shop-git && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20261105190000_hosp_logo_brand.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('20261105190000_hosp_logo_brand.sql')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && echo "42 ok" && docker compose up -d
```

**מצופה:** `NOTIFY`, `42 ok`, ואחריהן שורות ה-compose (`Started` / `Running`).

### JU6 — בדיקות העלאה (הפקודה מחכה דקה — זה לא תקוע)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && curl -s -o /dev/null -w 'fonts: %{http_code} %{content_type}\n' http://127.0.0.1:3700/fonts/hosp/heebo-hebrew-wght.woff2 && docker exec nuriel-shop-app printenv HOSPITALITY_ENGINE
```

**מצופה:** `healthy`; `robots: 200`; `fonts: 200 font/woff2`; `on`.

### JU7 — בדיקת המסד והלוג

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '20261105190000_hosp_logo_brand.sql'), (SELECT count(*) FROM pg_constraint WHERE conrelid = 'hospitality.media'::regclass AND conname IN ('media_owner_check', 'media_owner_kind_check')), (SELECT bool_and(prosrc LIKE '%brand%') FROM pg_proc WHERE oid IN ('hospitality._media_owner(uuid,text,uuid)'::regprocedure, 'hospitality._media_ensure_cover(uuid,text,uuid,uuid)'::regprocedure, 'hospitality._public_media(uuid,text,uuid,uuid)'::regprocedure, 'hospitality._site_payload(uuid)'::regprocedure)), (SELECT count(*) FROM hospitality.media WHERE owner_kind = 'brand'), (SELECT count(*) FROM hospitality.media WHERE owner_kind = 'brand' AND is_cover), (SELECT count(*) FROM hospitality.media WHERE owner_kind = 'site' AND alt LIKE 'הלוגו של %')" && docker logs --since 5m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**מצופה:** `1|2|t|N|0|0` — המיגרציה נרשמה; שתי הבדיקות החדשות של הטבלה; ארבע הפונקציות מכירות את
הלוגו; `N` = סכום העמודה `logos` מ-JU3 (הלוגואים שעברו); אף לוגו אינו תמונה ראשית; ואין לוגו שנשאר
בגלריית האתר. אחרי זה — לוג ריק.

**בדפדפן:**

- **העסק שבו ראית את הבעיה:** ב"תמונות" — הלוגו כבר לא בגלריית האתר, והתמונה הראשית היא התמונה הראשונה
  שלה (או אין ראשית, אם הגלריה ריקה — אז האתר לוקח את התמונה של המתחם / היחידה). רוצים תמונה ראשית
  אחרת — "תמונה ראשית" על התמונה הרצויה. **באתר:** הלוגו בראש העמוד, ותמונת הפתיח — תמונה, לא הלוגו.
- **עיצוב האתר ← עיצוב ← "החלפת לוגו":** הלוגו החדש מופיע בתיבה ובתצוגה המקדימה; ב"תמונות" — שום דבר
  לא השתנה.
- **"בחירה מהלוגואים שהועלו או מהתמונות":** הלוגואים שהועלו ותמונות האתר; "בלי לוגו (שם העסק בטקסט)".
- **חנות:** הכול כרגיל.

### חזרה (J) — הפעם קודם המסד, אחר כך האפליקציה

1. **המסד** (הלוגואים חוזרים לגלריית האתר — כמו לפני J; התמונה הראשית לא משתנה):

   ```bash
   docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-j/rollbacks/20261105190000_hosp_logo_brand.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261105190000_hosp_logo_brand.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && echo "42 down"
   ```

   הגרסה החדשה ממשיכה להציג את הלוגו (היא מוצאת אותו גם בגלריה); רק העלאת לוגו חדש נכשלת עד הצעד הבא.

2. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-j nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   ה-image של I עולה מיד, בלי בנייה. **התיקייה נשארת על `5b06732`.**

   (נבדק מקומית: rollback של 42 מחזיר את הסכמה בדיוק למצב של 41.)

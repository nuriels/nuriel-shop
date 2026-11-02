# שלב G (Morning Sprint) — סדר פריסה בטוח ופקודות עדכון לשרת

> **עוד לא לפרוס.** המסמך מכין את העדכון; הפריסה רק באישור שלך.
> כל פקודה — שורה אחת, שמות מלאים, בלי משתני מעטפת. שולחים פלט אחרי כל שלב.
> שום פקודה כאן לא מדפיסה סוד.

## הסדר — ולמה

1. **E1–E3** (U2–U8 ב-`release-f-deploy.md`), נעוץ ב-`2e53763` — **בלי שינוי**. U1 (גיבוי) כבר רץ.
   **הפקודה הבאה לשרת היא עדיין U2.**
2. **F** (FU1–FU8 ב-`release-f-deploy.md`), נעוץ ב-`2d0b5f0` — מיגרציה 32 — **בלי שינוי**.
3. **רק אחרי ש-F עובד ונבדק — G** (GU1–GU8 כאן), נעוץ ב-`f0c5bb9`: שלוש מיגרציות (33, 34, 35)
   ובנייה מחדש.

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

## תאימות

- **G תלוי במיגרציה 32 (F):** מיגרציה 34 מגדירה מחדש את פונקציות העזר של לוח הבקרה ממיגרציה 32
  (אותן חתימות, אותן תוצאות — נבדק). לכן G רק אחרי F. אם 32 לא רצה, הבדיקה היבשה (GU3) תראה יותר
  משלוש שורות — **עוצרים.**
- **33–35 תואמות לאחור:** האפליקציה של F (`2d0b5f0`) ממשיכה לעבוד מעליהן.
  - היא לא קוראת לפונקציות החדשות;
  - לוח הבקרה מחזיר אותם מספרים;
  - ב-`management_context()` נוסף רק המפתח `site`, ו-`policy` נשאר.
  - לכן המיגרציות קודם (GU4) והבנייה אחריהן (GU6–GU7), ובדקות שביניהן האתר ממשיך לעבוד.
- **הגרסה החדשה של האפליקציה צריכה את 33–35.** אם היא עולה לפני המיגרציות:
  - "תמיכה", "דוחות" ו"הקמת העסק" יציגו "המסך לא נטען";
  - ברשימה בלוח הבקרה, "האתר מוכן לפרסום" יופיע כלא הושלם;
  - שאר המסכים עובדים.
- **E1–E3:** אין שינוי בפונקציות של השער (פתיחת חנות, בקשות לאתרי צימר, חבילות).
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

### GU2 — הקוד (נעוץ ב-`f0c5bb9`)

```bash
cd /root/nuriel-shop-git && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge --ff-only f0c5bb9 && git log --oneline -1 && cp -r supabase/rollbacks /root/backups/nuriel-shop/before-g/rollbacks && ls /root/backups/nuriel-shop/before-g/rollbacks | grep -c 20261105
```

**מצופה:**
- **שורת ה-fetch** תראה את ה-commit **האחרון** בענף (מסמכים שנוספו אחרי `f0c5bb9`). זה בסדר: ה-merge
  נעוץ ב-`f0c5bb9`, הקוד של שלב G.
- `Updating 2d0b5f0..f0c5bb9`, `Fast-forward`;
- `f0c5bb9 Hospitality security pass: PDF check, authorize before rate counters, safe file names, support privacy`;
- `4` (קובצי ה-rollback של 32–35).

### GU3 — בדיקה יבשה: בדיוק שלוש מיגרציות ממתינות

```bash
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort > /root/backups/nuriel-shop/before-g/files.txt && LC_ALL=C comm -23 /root/backups/nuriel-shop/before-g/files.txt /root/backups/nuriel-shop/before-g/applied-before.txt
```

**מצופה:** שלוש שורות בדיוק, בסדר הזה:

- `20261105100000_hosp_support.sql`
- `20261105110000_hosp_reports.sql`
- `20261105120000_hosp_setup_guide.sql`

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

### GU5 — בדיקה ורענון ה-API

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename IN ('20261105100000_hosp_support.sql', '20261105110000_hosp_reports.sql', '20261105120000_hosp_setup_guide.sql')), (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relkind = 'r'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.setup_state'::regclass), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.support_tickets'::regclass), (SELECT count(*) FROM storage.buckets WHERE id = 'hosp-support' AND NOT public), has_function_privilege('anon', 'hospitality.reports_view(date,date,uuid[],text[],text[])', 'EXECUTE'), has_function_privilege('anon', 'hospitality.setup_guide()', 'EXECUTE'), has_function_privilege('anon', 'hospitality.support_open(text,text,text,text,jsonb)', 'EXECUTE')" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**מצופה:**
- `3|36|t|t|1|f|f|f`:
  - 3 מיגרציות נרשמו;
  - 36 טבלאות (31 + 4 של התמיכה + 1 של המדריך);
  - RLS פעיל בטבלאות החדשות;
  - הדלי `hosp-support` קיים ופרטי;
  - אורח לא מחובר לא יכול לקרוא לפונקציות החדשות.
- אחריו `NOTIFY`.

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

**בדפדפן — `/manage` של עסק האירוח (בעלים):**
- **"הקמת העסק":** הצעדים, אבני הדרך ו"ממשיכים מאיפה שעצרתם" (אחרי מעבר למסך אחר וחזרה).
  - בלוח הבקרה, ברשימה, מופיע "האתר מוכן לפרסום".
- **"תמיכה":** פתיחת פנייה עם תמונה.
  - בפאנל הפלטפורמה (`/platform/hospitality#support`) הפנייה מופיעה.
  - תשובה משם → העסק רואה "צוות התמיכה" ומקבל מייל.
  - הערה פנימית לא מופיעה לעסק.
- **"דוחות":** תקופה, ייצוא CSV שנפתח ב-Excel בעברית, הדפסה.
- **"יומן":** תצוגת "יחידות" ושורת "פנויות".
- **"יחידות":** הכרטיסים; בעמוד יחידה — כרטיס המחיר.
- **"עיצוב האתר":**
  - הלשונית "גוגל ושיתוף" → פרסום → בקוד המקור של האתר: canonical ו-og.
  - `/sitemap.xml` של האתר (רק כשהאתר פתוח).
- **מנהל (לא בעלים):** בלי הכנסות, בלי סכומים בדוחות, ובלי שמות מלאים של אורחים אם אין לו
  הרשאת אורחים.
- **האתר הציבורי:** הקרדיט בפוטר, בכל עמוד.
- **חנות:** הכול כרגיל — דף הבית, מוצר, `/admin`, `/sitemap.xml` של החנות.

### חזרה (G) — קודם האפליקציה, אחר כך המסד

1. **האפליקציה:**

   ```bash
   docker tag nuriel-shop-app-app:before-g nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && docker compose ps
   ```

   - ה-image של F עולה מיד, בלי בנייה, והוא עובד מעל 33–35 (תואמות לאחור).
   - **התיקייה נשארת על `f0c5bb9`.** לא בונים ממנה שוב עד שמחליטים איך ממשיכים.

2. **המסד — רק אם צריך, בסדר הפוך (35 → 34 → 33), פקודה לכל מיגרציה:**

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
   - **35:** רק המקום שבו כל עסק עצר במדריך, האישורים והדילוגים. אלה מצב תצוגה — היחידות, המחירים,
     ההגדרות והאתר לא נוגעים.
   - **34:** פונקציות בלבד. לוח הבקרה חוזר לפונקציות של מיגרציה 32, מילה במילה.
   - **33 מסרבת לרדת כשיש פניות או קבצים** (כדי לא למחוק פניות של עסקים). במקרה כזה משאירים אותה:
     האפליקציה של F לא משתמשת בה.

   **מה נשאר:** הזמנות, תשלומים, אורחים, האתר ושאר הנתונים.

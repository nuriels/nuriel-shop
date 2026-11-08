# פריסה לייצור: נגישות, תקנון ומסמכים משפטיים (מיגרציה 60), התאמה לטלפון ותמונה ראשית + סרטון — nuriel-shop

> **פריסה נפרדת — רק אחרי שלב א'.** מיגרציה 60 נשענת על מיגרציה 59 (חבילות): אם שלב א' עוד לא נפרס
> (175 מיגרציות בשרת) — עוצרים כאן. **אף פקודה כאן לא הורצה בשרת.**
>
> **הקוד לפריסה:** `919ae23` (ענף `hospitality/stage-2`). שולחים לי פקודה אחת, מריצים, ומחזירים את
> הפלט — ורק אז הפקודה הבאה. שום פקודה לא מדפיסה סוד.
>
> 🔍 = קריאה בלבד · ✏️ = משנה משהו בשרת (כתוב בדיוק מה) · ⛔ = נקודת אישור שלך.
>
> **מצב השרת לפני:** אחרי שלב א' — הקוד על `d1df489`, 175 מיגרציות, תג חזרה `before-stage-a`.
> **אחרי:** הקוד על `919ae23`, 176 מיגרציות, תג חזרה חדש `before-a11y-docs`.
>
> **נבדק מראש (בלי השרת):** מיגרציה 60 על מסד נקי ועל מסד עם נתונים (2655/2655 בדיקות, פעמיים), Rollback
> ← הסכמה זהה בדיוק למיגרציה 59, ושוב קדימה. לא נבדקו מקומית: הבנייה, ההפעלה והכתובות האמיתיות.

## מה נכנס

| קומיט     | מה                                                                                 | בשרת                  |
| --------- | ---------------------------------------------------------------------------------- | --------------------- |
| `33e5b8f` | "ההזמנות שלי": כותרת לעמוד גם בטעינה ובשגיאה (נמצא בבדיקת הנגישות)                 | אפליקציה              |
| `0cc33c1` | כפתור נגישות צף בכל אתר אירוח (העדפות תצוגה — לא הצהרת עמידה בתקן) ותיקונים שנמצאו | אפליקציה              |
| `2c660bf` | בדיקת E2E בלבד: בבדיקות "עודכן בינתיים" שני הדפדפנים מחכים שהנתונים ייטענו         | אין (בדיקות בלבד)     |
| `39dabcc` | מסמכים ומדיניות האתר, הצהרת נגישות, הסדרי נגישות במתחם, אישור מסמכים בהזמנה        | אפליקציה + מיגרציה 60 |
| `009ec72` | ניהול בטלפון: שם המתחם בשורה משלו, סינון היומן מקופל, כותרות שלא נקטעות            | אפליקציה              |
| `919ae23` | עיצוב האתר: העלאת תמונה ראשית וסרטון עד 12 שניות (התמונה 5 שניות ואז הסרטון)       | אפליקציה              |

**מיגרציה אחת** — `20261109100000_hosp_site_documents.sql`, עטופה ב-`BEGIN` / `COMMIT`. **לא משנה נתונים
קיימים ולא משנה פונקציה קיימת:** חמש טבלאות חדשות ריקות (מסמכים, גרסאות, אישורי אורחים, הסדרי נגישות,
פרטי עוסק) ופונקציות חדשות. הבקשות להזמנה הקיימות לא נגעו — נוספו עטיפות שרושמות את אישור המסמכים באותה
טרנזקציה.

- **בלי משתני סביבה חדשים** ובלי שינוי ב-`docker-compose.yml` / Nginx. **החנויות לא משתנות.**
- **התמונה הראשית והסרטון — בלי שינוי במסד:** נשמרים בגלריית האתר הקיימת. הסרטון עד 20MB ו-12 שניות —
  בתוך מגבלת ההעלאה של Nginx היום (`client_max_body_size 25m`), בלי שינוי בשרת. עד שבעל העסק מעלה סרטון —
  האתר נראה בדיוק כמו היום.
- **אחרי הפריסה שום מסמך לא מתפרסם לבד.** באתר: מדיניות הפרטיות הכללית (כמו היום) ועמוד נגישות קצר עם
  הדרך לפנות — עד שבעל העסק מפרסם. בטופס ההזמנה: ההודעה על עסקת מכר מרחוק; רשימת המסמכים לאישור מופיעה
  רק כשיש מסמכים שפורסמו.
- **לפני פרסום מסמכים בייצור:** בדיקה של עורך דין (ובהצהרת הנגישות — של מורשה נגישות שירות). המסך בניהול
  מסמן את זה ליד כל מסמך.
- **הסדר:** הקוד והבנייה קודם (האתר ממשיך לרוץ), אחר כך מיגרציה 60, ומיד ההפעלה. הגרסה הקודמת עובדת גם מול
  60 (רק מוסיפה), כך שחזרה של האפליקציה בלבד (R1) אפשרית בלי לגעת במסד.

---

## שלב 1 — בדיקות מקדימות (🔍)

### P1 — הענף והקומיט

```bash
cd /root/nuriel-shop-git && git branch --show-current && git log --oneline -1 && git status --short --untracked-files=no | wc -l && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge-base --is-ancestor HEAD 919ae23 && echo "fast-forward possible" && git merge-base --is-ancestor 919ae23 origin/hospitality/stage-2 && echo "919ae23 is on origin" && git log --oneline -1 919ae23
```

**תקין:** `hospitality/stage-2`; `d1df489 CI fixes for stage A; …` (שלב א' נפרס); `0`; `fast-forward possible`;
`919ae23 is on origin`; השורה של הקומיט. אחרת — עוצרים.

### P2 — Docker, המיגרציות, הדיסק

```bash
cd /root/nuriel-shop-git && docker ps --format '{{.Names}}\t{{.Status}}' | grep '^nuriel-shop-' && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.CreatedSince}}' && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && LC_ALL=C comm -23 <(git ls-tree --name-only 919ae23 supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) && df -h /var/lib/docker /root/backups/nuriel-shop | tail -n +2
```

**תקין:** הקונטיינרים ב-`Up` (ליד האפליקציה `(healthy)`); התגים כוללים `before-stage-a`; `175`; **שורה אחת**
— `20261109100000_hosp_site_documents.sql`; לפחות 5G פנויים ב-`/var/lib/docker`.

**⛔ אישור 1 — רק אם P1–P2 תקינים.** מכאן הפקודות כותבות בשרת.

---

## שלב 2 — גיבוי (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-a11y-docs` ומוסיף תג ל-image)

### B1

```bash
mkdir -m 700 /root/backups/nuriel-shop/before-a11y-docs && cd /root/backups/nuriel-shop/before-a11y-docs && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > db.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < db.dump && echo "dump read to the end: ok" && ls -lh db.dump && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > applied-before.txt && wc -l < applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee app-commit.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-a11y-docs && docker images nuriel-shop-app-app --format '{{.Tag}}' && ls
```

**תקין:** `dump read to the end: ok`; הגודל; `175`; `d1df489 …`; התגים כוללים `before-a11y-docs`; ארבעה
קבצים: `app-commit.txt applied-before.txt db.dump` + (בלי סודות — קובצי התצורה לא משתנים בפריסה הזו).

### B2 — הגיבוי ניתן לשחזור (✏️ מסד בדיקה נפרד `restore_check` — נוצר ונמחק)

```bash
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-a11y-docs/db.dump > /dev/null 2>&1; for d in postgres restore_check; do docker exec nuriel-shop-db psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM hospitality.bookings), (SELECT count(*) FROM public._migrations_applied)"; done && docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

**תקין:** שתי שורות **זהות** (… | 175) ואז `restore check: done`.

---

## שלב 3 — הקוד והבנייה (האתר ממשיך לרוץ)

### S1 — הקוד (✏️ קבצים + עותק של קובץ ה-Rollback ליד הגיבוי)

```bash
cd /root/nuriel-shop-git && git merge -q --ff-only 919ae23 && git log --oneline -1 && mkdir -p /root/backups/nuriel-shop/before-a11y-docs/rollbacks && cp supabase/rollbacks/20261109100000_hosp_site_documents.down.sql /root/backups/nuriel-shop/before-a11y-docs/rollbacks/ && ls /root/backups/nuriel-shop/before-a11y-docs/rollbacks
```

**תקין:** שורת הקומיט; `20261109100000_hosp_site_documents.down.sql`.

### S2 — בנייה (✏️ image חדש; האתר ממשיך לרוץ על הישן)

```bash
cd /root/nuriel-shop-git && docker compose build
```

**תקין:** `Built`, בלי שגיאה. שגיאה — עוצרים (האתר לא נפגע).

**⛔ אישור 2 — מכאן משנים את המסד ומפעילים את הגרסה החדשה.** בשעה שקטה.

---

## שלב 4 — מיגרציה 60 והפעלה (✏️ המסד + הפעלה מחדש)

### M1

```bash
cd /root/nuriel-shop-git && f=20261109100000_hosp_site_documents && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261109%'), (SELECT count(*) FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace AND relname IN ('site_documents','site_document_versions','booking_document_acceptances','property_accessibility','site_legal_profile') AND relrowsecurity), (SELECT count(*) FROM hospitality.site_documents), has_function_privilege('anon', 'hospitality.request_booking_with_documents(jsonb,uuid,date,date,text,text,text,text,boolean,text,integer,integer,text,text,boolean,text)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.public_site_documents()', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|5|0|f|t|176" ] && echo "60 checks ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && docker compose up -d
```

**תקין:** `… ok` (שורות `NOTICE: … does not exist, skipping` — רגילות); `1|5|0|f|t|176` — לפי הסדר: רשומה
אחת; חמש הטבלאות עם RLS; 0 מסמכים; הבקשה עם המסמכים **לא** פתוחה לגולש (רק דרך השרת); רשימת המסמכים
לאתר — פתוחה; 176 מיגרציות. ואז `60 checks ok`, `NOTIFY`, שורות ה-compose.

**נעצר:** לא מפעילים — האתר נשאר על הגרסה הקודמת (והיא עובדת גם מול מה שנכנס). שולחים לי את הפלט.

---

## שלב 5 — בדיקות אחרי ההפעלה

### V1 — נופי דורית, כפתור הנגישות, העמודים (🔍; מחכה דקה)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps app && for p in /stay /stay/book /stay/account /stay/privacy /stay/accessibility /manage/login; do curl -s -o /dev/null -w "nofi-dorit $p: %{http_code}\n" "https://nofi-dorit.nuri1.fit$p"; done && curl -s -o /dev/null -w "nofi-dorit /stay/docs/terms (not published yet): %{http_code}\n" https://nofi-dorit.nuri1.fit/stay/docs/terms && curl -s https://nofi-dorit.nuri1.fit/stay | grep -c 'hosp-a11y-prefs-v1' && curl -s https://nofi-dorit.nuri1.fit/stay | grep -o 'aria-label="תפריט נגישות"' | head -1 && curl -s -o /dev/null -w 'store nuriel-shop: %{http_code}\n' https://nuriel-shop.nuri1.fit/ && docker logs --since 3m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**תקין:** `Up … (healthy)`; שש שורות `200`; `…/stay/docs/terms (not published yet): 404`; `1` (הסקריפט המוקדם
של כפתור הנגישות ב-`<head>`); `aria-label="תפריט נגישות"`; `store nuriel-shop: 200`; לוג ריק (שורות
`aborted` — לא בעיה).

### V2 — המסד אחרי (🔍)

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id) AS bookings, (SELECT count(*) FROM hospitality.site_documents d WHERE d.tenant_id = t.id) AS documents, (SELECT count(*) FROM hospitality.property_accessibility a WHERE a.tenant_id = t.id) AS arrangements FROM public.tenants t WHERE t.site_type = 'hospitality' ORDER BY t.created_at"
```

**תקין:** מספרי ההזמנות כמו לפני; `documents = 0`, `arrangements = 0` בכל האתרים (אין מילוי אוטומטי).

### V3 — בדפדפן (אתה)

1. **כפתור הנגישות** באתר של נופי דורית (פינה ימנית למטה; בטלפון — מעל שורת הפעולות): נפתח בלחיצה וב-Alt+A,
   "הגדלת טקסט" / "ניגודיות גבוהה" עובדים, ואחרי רענון ההגדרות נשמרות. "איפוס כל ההגדרות" מחזיר הכול.
2. **הפוטר:** "מדיניות פרטיות" ו"הצהרת נגישות" (עמוד קצר עם הדרך לפנות — עד שתפרסמו הצהרה).
3. **בניהול:** "מסמכים ומדיניות" — שמונה מסמכים עם "לא מוצג באתר" ו"לבדיקת עורך דין / מורשה נגישות".
   **לא מפרסמים** לפני בדיקה. בעמוד המתחם — הכרטיס "הסדרי נגישות במתחם" (ריק).
4. **הזמנה:** `/stay/book` — בשלב הפרטים ההודעה על עסקת מכר מרחוק, ותיבת האישור לא מסומנת. בלי לשלוח.
5. **בטלפון, בניהול:** "יחידות" — שם המתחם בשורה אחת והכפתורים מתחתיו; "יומן" — "סינון וחיפוש" מקופל.
6. **עיצוב האתר:** בלשונית "עיצוב" — "תמונה ראשית וסרטון". אפשר לנסות סרטון קצר מהטלפון (עד 12 שניות),
   לפרסם, ולראות באתר: התמונה 5 שניות ואז הסרטון, עם כפתור עצירה. לא חובה בפריסה.

---

## שלב 6 — Rollback (רק אם צריך; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה בלבד (✏️ הכי מהיר)

```bash
docker tag nuriel-shop-app-app:before-a11y-docs nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `Up … (healthy)`; `robots: 200`. האפליקציה של שלב א' עולה מיד; מיגרציה 60 נשארת (רק תוספות).

### R2 — גם המסד: 60 ← 59 (✏️; רק אחרי R1, ורק אם המסד עצמו בעייתי)

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-a11y-docs/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-a11y-docs/rollbacks/20261109100000_hosp_site_documents.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261109100000_hosp_site_documents.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** `backup ok`; `175`; `NOTIFY`.

**הגנה:** ה-Rollback נעצר אם כבר יש טיוטות, גרסאות שפורסמו, הסדרי נגישות, פרטי עוסק — ובעיקר אישורים של
אורחים בהזמנות (ראיה לגרסה שאושרה). לא מוחקים אותם בשקט: שולחים לי, ומחליטים יחד.

---

## כל הפקודות לפי הסדר

| #     | סוג            | מה                                 | תקין                        |
| ----- | -------------- | ---------------------------------- | --------------------------- |
| P1    | 🔍             | הענף והקומיט (אחרי שלב א')         | `d1df489`, `fast-forward …` |
| P2    | 🔍             | Docker, מיגרציות, דיסק             | `175`, ממתינה אחת           |
| ⛔ 1  |                |                                    |                             |
| B1    | ✏️ גיבוי       | מסד, תג `before-a11y-docs`         | `dump read to the end: ok`  |
| B2    | ✏️ מסד נפרד    | בדיקת שחזור                        | שתי שורות זהות              |
| S1    | ✏️ קבצים       | הקוד ← `919ae23`                   | קובץ ה-Rollback             |
| S2    | ✏️ image       | בנייה                              | `Built`                     |
| ⛔ 2  |                |                                    |                             |
| M1    | ✏️ מסד + הפעלה | מיגרציה 60 + בדיקה + הפעלה         | `60 checks ok`, `Started`   |
| V1    | 🔍             | נופי דורית, כפתור הנגישות, העמודים | `200`, `404` ל-terms, `1`   |
| V2    | 🔍             | המסד אחרי                          | 0 מסמכים, 0 הסדרים          |
| V3    | דפדפן          | הכפתור, הפוטר, הניהול, טופס ההזמנה | —                           |
| R1/R2 | ✏️             | רק בתקלה                           | —                           |

# Google SEO — שלב 2: פריסה לייצור (Hospitality בלבד)

> **✅ נפרס ב-10.11.2026** — S, M, U הורצו בדיוק כפי שמופיעות כאן (M ו-U בגרסה שמדפיסה את המצב ו-`STOPPED`),
> כל הפלטים תקינים, ובדיקות V: 0 קריטיים בנופי דורית, 0 הבדלים בחנות ובפורטל (ראו "V — התוצאות בפועל").

**הקוד:** `de766ac` בענף `hospitality/seo` (נבנה מ-`6dd034b`, הגרסה שרצה היום בייצור).
**מיגרציה:** אחת — `20261110200000_hosp_unit_seo.sql` (שתי פונקציות חדשות, בלי שינוי בטבלאות ובלי נתונים).
**כל פקודה בנפרד, ואחרי אישור.** מיגרציה, בנייה והפעלה מחדש — לא באותה פקודה.

סימנים: 🔍 קריאה בלבד · ✏️ משנה · ⛔ עוצרים לאישור.

## מה נכנס

| שינוי                                   | איפה              | ההשפעה על הקידום הקיים                                                                                                                   |
| --------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Allow: /stay/packages/` ב-robots.txt   | כל אתר אירוח      | עמודי החבילות כבר ב-sitemap, אבל robots.txt חסם אותם — עכשיו גוגל יכול לסרוק אותם                                                        |
| `Allow: /stay/brand/` ב-robots.txt      | כל אתר אירוח      | האייקון, תמונת השיתוף והמניפסט פתוחים לגוגל (גוגל מחייב שקובץ ה-favicon יהיה פתוח לסריקה)                                                |
| כתובת ב-JSON-LD כ-`PostalAddress`       | עמוד הבית של האתר | `"address": "ישעי 22"` ← `{"@type":"PostalAddress","streetAddress":"ישעי 22","addressCountry":"IL"}` — הפורמט שגוגל דורש ל-LocalBusiness |
| כרטיס "גוגל ושיתוף" בעמוד היחידה בניהול | ניהול האתר        | בעל העסק כותב כותרת ותיאור לגוגל ליחידה; ריק = כמו היום (שם היחידה \| שם העסק)                                                           |

**לא משתנה:** כתובות, slugs, sitemap.xml, canonical, ההפניות (`/` → 302 → `/stay`, ‏`/stay/` → 307 → `/stay`),
קודי Google, אנליטיקס ו-Cookies. Ecommerce — אף קובץ ואף נתון.

**לא נכנס (בכוונה):** אירועים וחוזים (מיגרציות 62–65 ב-`hospitality/stage-2`), פתיחת `/` ל-favicon (מחכה
להחלטה, ראו בסוף), קודי Google והסכמה ל-Cookies (שלבים 3–4).

## לפני — כבר בוצע

- **שלב 0:** צילום מצב — `docs/hospitality/seo/baseline/2026-11-09-nofi-dorit.json` (5 כתובות, כולן 200 וניתנות
  לאינדוקס; 4 קבצי המותג חסומים ב-robots.txt).
- **שלב 1:** גיבוי ב-`/root/backups/nuriel-shop/before-seo` (`db.dump` + בדיקת שחזור זהה, 177 מיגרציות) ותג
  `nuriel-shop-app-app:before-seo`.
- **צילום טרי לפני הפריסה** (מהסשן, קריאה בלבד): נופי דורית — 0 הבדלים מול שלב 0; החנות `nuriel-shop` (165
  כתובות ב-sitemap, 60 עמודים נבדקו) ו-`nuriel-app2` — צולמו להשוואה אחרי.

## בדיקות מקומיות (על `de766ac`)

- Unit: 954/954 · SQL: 2786/2786 (מסד נקי ×2 + מסד עם נתונים, המיגרציה פעמיים) · Rollback: הסכמה אחרי החזרה זהה
  בדיוק למיגרציה 61 · E2E: הכרטיס החדש 4/4, וקבצי הקטלוג / היחידות / ה-SEO / ה-head / החבילות 45/45.
- השוואת צילומים לפני ↔ אחרי על אותו מסד: אתר אירוח לדוגמה — 0 קריטיים (שתי שורות robots נוספו, ה-JSON-LD
  של הבית השתנה רק בכתובת, עמוד החבילה נפתח לסריקה); החנות `kobi` והפורטל `nuriel-app2` — **0 הבדלים**.

---

## ⛔ אישור 1 — S: הקוד והבנייה (✏️ קבצים + image חדש; האתר ממשיך לרוץ על הגרסה הקודמת)

```bash
cd /root/nuriel-shop-git && test -z "$(git status --porcelain --untracked-files=no)" && echo "clean" && git fetch -q origin "+refs/heads/hospitality/seo:refs/remotes/origin/hospitality/seo" && git merge-base --is-ancestor HEAD de766ac && echo "fast-forward possible" && git merge-base --is-ancestor de766ac origin/hospitality/seo && echo "de766ac is on origin" && docker images nuriel-shop-app-app --format '{{.Tag}}' | grep -qx before-seo && echo "rollback image before-seo: ok" && git checkout -q -B hospitality/seo de766ac && git log --oneline -1 && cp supabase/rollbacks/20261110200000_hosp_unit_seo.down.sql /root/backups/nuriel-shop/before-seo/ && docker compose build > /root/backups/nuriel-shop/before-seo/build.log 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo unit_seo_set: \$(grep -rl unit_seo_set /app/.output/server | wc -l) PostalAddress: \$(grep -rl PostalAddress /app/.output/server | wc -l)" || { echo "STOPPED"; tail -n 30 /root/backups/nuriel-shop/before-seo/build.log 2>/dev/null; }
```

**תקין:** `clean`; `fast-forward possible`; `de766ac is on origin`; `rollback image before-seo: ok`; שורת הקומיט
`de766ac SEO stage 2: …`; `build ok`; `unit_seo_set: 1 PostalAddress: 3` (מספרים גדולים מ-0).
**`STOPPED`** — עוצרים ושולחים לי את הפלט. האתר לא נפגע: הקונטיינר הרץ לא מתחלף עד ההפעלה מחדש.

## ⛔ אישור 2 — M: המיגרציה (✏️ המסד; שתי פונקציות חדשות בלבד)

```bash
cd /root/nuriel-shop-git && f=20261110200000_hosp_unit_seo && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = de766ac ] && [ "$n" = 177 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), has_function_privilege('authenticated', 'hospitality.unit_seo_get(uuid)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.unit_seo_get(uuid)', 'EXECUTE'), has_function_privilege('authenticated', 'hospitality.unit_seo_set(uuid,text,text,integer)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.unit_seo_set(uuid,text,text,integer)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|t|f|178" ] && echo "SEO migration checks ok" || echo "STOPPED"
```

**תקין:** `code de766ac, applied before: 177`; `20261110200000_hosp_unit_seo ok`; `1|t|f|t|f|178` — לפי הסדר: רשומה
אחת; צוות מחובר יכול לקרוא; אורח אנונימי **לא**; צוות מחובר יכול לשמור; אורח אנונימי **לא**; 178 מיגרציות. ואז
`SEO migration checks ok`.

**בטוח לפני ההפעלה מחדש:** הגרסה שרצה עכשיו לא קוראת לפונקציות החדשות — היא ממשיכה לעבוד בדיוק כמו קודם.
המיגרציה עטופה ב-`BEGIN … COMMIT`: אם משהו נכשל — שום דבר לא נשאר.

## ⛔ אישור 3 — U: הפעלה מחדש על הגרסה החדשה (✏️ זו הפריסה עצמה; בשעה שקטה)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = de766ac ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:** שורות ה-compose (רק האפליקציה מתחלפת); `Up … (healthy)`; `running the new image`; `local: 200`; לוג ריק.
**לא תקין** (`unhealthy`, לא 200, שגיאות) — R1 מיד (אחרי אישור).

## V — בדיקות אחרי (🔍; אני מריץ מהסשן, בלי פקודה בשרת)

1. **צילום חי של נופי דורית** מול שלב 0 ומול הצילום הטרי. **מצופה:** 0 קריטיים; `robots.txt · line added` ×2
   (`Allow: /stay/packages/`, `Allow: /stay/brand/`); `json-ld` בעמוד הבית (רק הכתובת); 4 קבצי המותג
   `robots.txt verdict false → true`. כל השאר — זהה (סטטוס, canonical, noindex, ההפניות, title, description, sitemap).
2. **החנות `nuriel-shop` והפורטל `nuriel-app2`** מול הצילום הטרי — **0 הבדלים** (כולל קודי Google ו-GA הקיימים).
3. **robots.txt החי** — כל כתובת ב-sitemap פתוחה לסריקה; `/`, ההזמנה, אזור האורח והניהול — חסומים כמו היום.
4. **בדפדפן (אתה, לא חובה):** ניהול נופי דורית ← יחידה ← כרטיס "גוגל ושיתוף" מופיע, השדות ריקים (= כמו היום).
   לא שומרים כלום כרגע — את הכותרות והתיאורים כותבים בשלב התוכן.

### V — התוצאות בפועל (10.11.2026)

- **נופי דורית מול שלב 0** (וגם מול הצילום הטרי שלפני): `7 differences: 0 critical, 3 warning, 4 info` — בדיוק
  המצופה: שתי שורות robots, ה-JSON-LD של `/stay` (הכתובת — עכשיו
  `{"@type":"PostalAddress","streetAddress":"ישעי 22","addressCountry":"IL"}`), וארבעת קבצי המותג נפתחו לסריקה.
  סטטוס, canonical, noindex, ההפניות, title, description ו-sitemap — זהים.
- **החנות `nuriel-shop` (60 עמודים) והפורטל `nuriel-app2`:** `0 differences`.
- **robots.txt החי:** 5/5 כתובות ה-sitemap פתוחות; `/`, `/stay/book`, `/stay/my-booking`, `/manage/login`, `/admin`
  — חסומים כמו קודם.
- **כ-Googlebot:** `/` → 302 → `/stay` (כמו קודם); `/stay` → 200, canonical `/stay`, `index, follow`, 3 קישורי אייקון,
  בלי קוד אימות ובלי GA/GTM (נכנסים בשלבים 3–4). **כ-Googlebot-Image:** 4 קבצי המותג → 200, הסוג הנכון, בלי
  `x-robots-tag`.

---

## Rollback (רק בתקלה; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה בלבד (✏️ הכי מהיר; הקוד חוזר ל-`6dd034b`)

```bash
docker tag nuriel-shop-app-app:before-seo nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q hospitality/stage-2 && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `6dd034b …`; `Up … (healthy)`; `local: 200`. robots.txt והכתובת ב-JSON-LD חוזרים בדיוק לשלב 0. המיגרציה
יכולה להישאר (הגרסה הקודמת לא קוראת לפונקציות).

### R2 — גם המסד (✏️; רק אחרי R1, ורק אם צריך)

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-seo/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-seo/20261110200000_hosp_unit_seo.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110200000_hosp_unit_seo.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"
```

**תקין:** `backup ok`; `177`. מוחק רק את שתי הפונקציות. כותרות ותיאורים שכבר נשמרו נשארים בעמודות (הן היו קיימות
קודם, והגרסה הקודמת כבר מציגה אותן באתר).

---

## הערות להמשך

- **מיזוג עם `hospitality/stage-2`** (לפני פריסת האירועים והחוזים): המיגרציה הזו (`20261110200000`) נכנסת לפני
  62–65 לפי התאריך. ב-`scripts/db-tests/rollback-check.sh` היא `M62` כאן, ושם 62–65 הן של האירועים — במיזוג:
  SEO = `M62`, האירועים `M63`–`M66` (ובדיקת הארכיטקטורה של סדר ה-down/up). בפריסת האירועים בדיקת P2 תראה 4
  מיגרציות ממתינות (לא 5), כי זו כבר תהיה בייצור.
- **ה-favicon של `/` (מחכה להחלטה):** לפי התיעוד של גוגל ("Favicon in Search"), favicon אחד לכל hostname, ועמוד
  הבית הוא `https://nofi-dorit.nuri1.fit/` — עמוד בתת-תיקייה (`/stay`) "Not supported" כעמוד בית. ו-"Googlebot must
  be able to crawl the home page, follow any redirects from there to the page where the favicon is specified, and
  Googlebot-Image must be able to crawl the favicon file. These URLs must not be blocked from crawling by a robots.txt
  file". הפריסה הזו פתחה את קבצי האייקון; `/` עדיין חסום ב-`Disallow: /`. ההצעה: `Allow: /$` (רק השורש) + `/` →
  **301** ל-`/stay` במקום 302 (עם `no-store`), כך ש-`/stay` נשאר הכתובת הקנונית. זה שינוי בהפניה ובאינדוקס — אם
  יאושר, ייכנס לפריסה של שלבים 3–4, בלי פקודות נוספות. אותו שינוי גם מבטיח שבדיקת האימות של Search Console (תגית
  Meta בעמוד הבית — "the page where your browser goes when you visit the URL that defines your Search Console
  property") תגיע ל-`/stay` בלי חסימה.
- **תיאור אחד ל-5 העמודים (178 תווים):** ליחידות בנופי דורית אין תיאור, ולכן כולן מקבלות את התיאור של האתר. אחרי
  הפריסה בעל העסק כותב בכרטיס החדש כותרת ותיאור לכל יחידה (עד 60 / 155 תווים מומלץ).

## כל הפקודות לפי הסדר

| #        | סוג              | מה                               | תקין                                                        |
| -------- | ---------------- | -------------------------------- | ----------------------------------------------------------- |
| ⛔ 1 · S | ✏️ קבצים + image | הקוד ← `de766ac` + בנייה         | `build ok`, `unit_seo_set: 1 PostalAddress: 3`              |
| ⛔ 2 · M | ✏️ מסד           | מיגרציה `20261110200000` + בדיקה | `1\|t\|f\|t\|f\|178`, `SEO migration checks ok`             |
| ⛔ 3 · U | ✏️ הפעלה מחדש    | הגרסה החדשה עולה                 | `(healthy)`, `running the new image`, `local: 200`, לוג ריק |
| V        | 🔍 מהסשן         | צילומים חיים מול שלב 0 ומול לפני | 0 קריטיים; Ecommerce — 0 הבדלים                             |
| R1 / R2  | ✏️               | רק בתקלה                         | `6dd034b` / `177`                                           |

# Google SEO — שלבים 3–4: פריסה לייצור (Hospitality בלבד)

> **✅ נפרס ב-10.11.2026** — BS, M ו-U הורצו בדיוק כפי שמופיעות כאן, כל הפלטים תקינים (`consent: 1 analytics: 3`;
> `1|t|f|f|f|t|179`; `(healthy)`, `running the new image`, `local: 200`). בדיקות V ושלב 5 — ראו "V — התוצאות בפועל".

**הקוד:** `6a8ce22` בענף `hospitality/seo` (מעל `de766ac`, שלב 2 שכבר בייצור).
**מיגרציה:** אחת — `20261110210000_hosp_consent.sql` (טבלה חדשה, שתי פונקציות ומתג כבוי; בלי שינוי בשום דבר קיים).
**שלוש פקודות, כל אחת אחרי אישור:** גיבוי + קוד + בנייה (האתר לא מושפע) · מיגרציה · הפעלה מחדש.

סימנים: 🔍 קריאה בלבד · ✏️ משנה · ⛔ עוצרים לאישור.

## מה נכנס

| שינוי                                           | ההשפעה על האתר החי                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Allow: /$` ב-robots.txt (שלב 3, אושר)          | רק כתובת הבית `/` נפתחת לסריקה — לפי גוגל זה תנאי ל-favicon בתוצאות, ולאימות Search Console. שום כתובת אחרת לא נפתחת                                              |
| `/` → **301** ל-`/stay` במקום 302 (שלב 3, אושר) | גוגל מבין ש-`/stay` הוא עמוד הבית הקבוע (כמו ה-canonical וה-sitemap). `no-store` — דפדפן לא שומר את ההפניה                                                        |
| קישור "הגדרות Cookies" בפוטר (שלב 4)            | חלון שמסביר שהאתר משתמש רק בשמירה הכרחית. **אין באנר** — אין באתר שום דבר שדורש הסכמה                                                                             |
| מנגנון הסכמה מלא — **כבוי** (שלב 4)             | באנר, הגדרות, Consent Mode ורשומה אנונימית בשרת — פועלים רק כשמדליקים את המתג `hospitality_analytics_enabled` ומזינים מזהה GA4. עד אז — שום קוד של Google לא נטען |
| Vimeo עם `dnt=1`                                | סרטון Vimeo (נטען רק כשפותחים אותו) — בלי מעקב ובלי Cookies של Vimeo                                                                                              |

**לא משתנה:** כל שאר הכתובות, slugs, sitemap.xml, canonical, title, description, JSON-LD, קודי Google, ה-Cookies
(אין חדשים). Ecommerce — אף קובץ ואף נתון.

## בדיקות מקומיות (על `6a8ce22`)

- Unit: 977/977 · SQL: 2804/2804 (מסד נקי ×2 + מסד עם נתונים) · Rollback: אחרי החזרת מיגרציית ההסכמה — הסכמה זהה
  בדיוק לשלב 2; כל הסכמה זהה אחרי החזרה של הכול והחלה מחדש · E2E: ההסכמה 8/8 (כבוי, דולק, סירוב, הגדרות, ביטול,
  אישור, טלפון, עורך), ובדיקות האתר / הפוטר / הנגישות / ה-head / העורך — ראו "תוצאות".
- השוואת צילומים מקומית מול שלב 2: אתר אירוח — **בדיוק** שני ההבדלים המתוכננים (`/` 302 → 301, ו-`Allow: /$`);
  החנות `kobi` והפורטל `nuriel-app2` — **0 הבדלים**.

---

## ⛔ אישור 1 — BS: גיבוי + קוד + בנייה (✏️ גיבוי, קבצים, image חדש; האתר ממשיך לרוץ על שלב 2)

```bash
B=/root/backups/nuriel-shop/before-seo-34 && mkdir -m 700 "$B" && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > "$B/db.dump" && docker exec -i nuriel-shop-db pg_restore -f /dev/null < "$B/db.dump" && echo "dump read to the end: ok ($(du -h "$B/db.dump" | cut -f1))" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$B/applied-before.txt" && echo "applied: $(wc -l < "$B/applied-before.txt")" && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-seo-34 && echo "rollback image before-seo-34: ok" && cd /root/nuriel-shop-git && test -z "$(git status --porcelain --untracked-files=no)" && git fetch -q origin "+refs/heads/hospitality/seo:refs/remotes/origin/hospitality/seo" && git merge-base --is-ancestor HEAD 6a8ce22 && git merge-base --is-ancestor 6a8ce22 origin/hospitality/seo && echo "6a8ce22: fast-forward, on origin" && git checkout -q -B hospitality/seo 6a8ce22 && git log --oneline -1 && cp supabase/rollbacks/20261110210000_hosp_consent.down.sql "$B/" && docker compose build > "$B/build.log" 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo consent: \$(grep -rl site_consent_record /app/.output/server | wc -l) analytics: \$(grep -rl analytics_enabled /app/.output/server | wc -l)" || { echo "STOPPED"; tail -n 30 "$B/build.log" 2>/dev/null; }
```

**תקין:** `dump read to the end: ok (…)`; `applied: 178`; `rollback image before-seo-34: ok`; `6a8ce22: fast-forward, on
origin`; שורת הקומיט; `build ok`; `consent: … analytics: …` — שני מספרים גדולים מ-0.
**`STOPPED`** — עוצרים ושולחים לי את הפלט. האתר לא נפגע (הקונטיינר הרץ לא מתחלף עד U).

## ⛔ אישור 2 — M: המיגרציה (✏️ המסד; טבלה + שתי פונקציות + מתג כבוי)

```bash
cd /root/nuriel-shop-git && f=20261110210000_hosp_consent && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 6a8ce22 ] && [ "$n" = 178 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'hospitality.consent_records'::regclass), has_table_privilege('anon', 'hospitality.consent_records', 'SELECT'), (SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_analytics_enabled'), has_function_privilege('anon', 'hospitality.site_consent_record(uuid,boolean,text,text)', 'EXECUTE'), has_function_privilege('service_role', 'hospitality.site_consent_record(uuid,boolean,text,text)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|f|f|t|179" ] && echo "consent migration checks ok" || echo "STOPPED"
```

**תקין:** `code 6a8ce22, applied before: 178`; `20261110210000_hosp_consent ok`; `1|t|f|f|f|t|179` — לפי הסדר: רשומה
אחת; RLS על הטבלה; אורח אנונימי **לא** קורא אותה; מתג המדידה **כבוי**; אורח אנונימי **לא** רושם; השרת כן; 179
מיגרציות. ואז `consent migration checks ok`.
**בטוח לפני ההפעלה מחדש:** הגרסה שרצה (שלב 2) לא קוראת לטבלה או לפונקציות. `BEGIN … COMMIT` — כישלון לא משאיר כלום.

## ⛔ אישור 3 — U: הפעלה מחדש (✏️ זו הפריסה עצמה; בשעה שקטה)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = 6a8ce22 ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:** `Container nuriel-shop-app … Started`; `Up … (healthy)`; `running the new image`; `local: 200`; לוג ריק.

## V — בדיקות אחרי (🔍; אני מריץ מהסשן, בלי פקודה בשרת)

1. **נופי דורית מול הצילום שאחרי שלב 2:** מצופה **בדיוק** `CRITICAL redirect · / 302 → 301` (המאושר) ו-`robots.txt ·
line added Allow: /$`. שום הבדל אחר.
2. **החנות והפורטל:** `0 differences`.
3. **כ-Googlebot:** `/` → 301 → `/stay`, ו-robots.txt מאפשר את `/`; כל כתובות ה-sitemap פתוחות; הפרטיים חסומים.
4. **בלי מדידה ובלי Cookies:** אין באנר, אין `googletagmanager` בעמוד, אין `Set-Cookie`; בפוטר — "הגדרות Cookies".

### V — התוצאות בפועל (10.11.2026) — וגם בדיקות שלב 5

- **נופי דורית מול הצילום שאחרי שלב 2:** `2 differences: 1 critical, 1 warning` — בדיוק `/` 302 → 301 ו-`Allow: /$`.
  מול שלב 0: `9 differences` — כולם מתוכננים ומאושרים (שלב 2: שתי שורות robots, הכתובת ב-JSON-LD, 4 קבצי מותג
  פתוחים; שלבים 3–4: ה-301 ו-`Allow: /$`). title, description, canonical, sitemap ו-noindex — זהים לשלב 0.
- **הפורטל `nuriel-app2`:** `0 differences`. **החנות `nuriel-shop`:** בצילום הראשון עמוד מוצר אחד מ-60 החזיר סטטוס 0
  (בקשה שנכשלה בדרך — בדיקה ישירה: 200 שלוש פעמים, עם תגית האימות של החנות); צילום חוזר — 60/60 עמודים 200 ו-`0
differences`. ה-GA וקוד האימות של החנות — בדיוק כמו קודם.
- **כ-Googlebot:** `/` → 301 → `/stay`; `/stay` → 200; robots.txt: `/` מותר, 5/5 כתובות ה-sitemap פתוחות,
  `/stay/book`, `/stay/my-booking`, `/manage/login`, `/admin` ו-`/x` — חסומים.
- **בלי מדידה ובלי Cookies:** `Set-Cookie` על `/stay` — 0; `googletagmanager` / `gtag(` בעמוד — 0; באנר — 0; הקישור
  "הגדרות Cookies" בפוטר — קיים ב-SSR.
- **בדפדפן אמיתי (Playwright, קריאה בלבד), מחשב 1366px וטלפון Pixel 7:** `/` → `/stay`, 200; בלי גלילה לצדדים; 0
  שגיאות בקונסול; 0 בקשות ל-Google; 0 Cookies; "הגדרות Cookies" פותח את החלון ("האתר משתמש רק בשמירה הכרחית…");
  axe (WCAG 2 A/AA) עם החלון פתוח — **0 הפרות** בשניהם.
- **מה שנשאר משלב 5:** קוד האימות של Search Console — אחרי שתוסיף את הנכס ותפרסם את הקוד בעורך (הוראות למטה),
  אבדוק שהתגית מופיעה בעמוד החי.

---

## Rollback (רק בתקלה; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה (✏️; חוזרים לשלב 2 — `de766ac`)

```bash
docker tag nuriel-shop-app-app:before-seo-34 nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q -B hospitality/seo de766ac && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `de766ac …`; `(healthy)`; `local: 200`. ההפניה חוזרת ל-302 ו-robots.txt לשלב 2. המיגרציה יכולה להישאר.

### R2 — גם המסד (✏️; רק אחרי R1, ורק אם צריך)

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-seo-34/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-seo-34/20261110210000_hosp_consent.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110210000_hosp_consent.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"
```

**תקין:** `backup ok`; `178`.

---

## אחרי הפריסה — Search Console (אתה, בחשבון Google שלך; ⛔ שינוי בחשבון Google — רק כשתחליט)

1. [Search Console](https://search.google.com/search-console) → הוספת נכס → **"קידומת של כתובת URL"** →
   `https://nofi-dorit.nuri1.fit/` (לא "דומיין": הדומיין `nuri1.fit` משותף לכל האתרים בפלטפורמה, כולל החנויות).
2. אימות ב-**"תג HTML"** → מעתיקים את התגית.
3. ניהול נופי דורית → **האתר** → **גוגל ושיתוף** → "קוד האימות" → מדביקים → **פרסום**.
4. חוזרים ל-Search Console → **אימות**. אחר כך: **Sitemaps** → `https://nofi-dorit.nuri1.fit/sitemap.xml` → שליחה;
   **בדיקת כתובת** ל-`https://nofi-dorit.nuri1.fit/stay` → "בקשה להוספה לאינדקס".

## בעתיד — הפעלת מדידה (GA4) — לא עכשיו

לפני: לעדכן את מדיניות הפרטיות של האתר (מסמכי האתר) — מדידה ב-Google Analytics, אילו נתונים, ושאפשר לסרב / לבטל;
ב-Google Analytics: שמירת נתונים 2 חודשים, בלי Google Signals ובלי קישור לפרסום.
הפעלה (פקודה אחת בשרת + מזהה בעורך): המתג לפלטפורמה ולאתר —

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "UPDATE public.platform_feature_flags SET enabled = true WHERE key = 'hospitality_analytics_enabled'" -c "INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) SELECT id, 'hospitality_analytics_enabled', true FROM public.tenants WHERE slug = 'nofi-dorit' AND site_type = 'hospitality' ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true"
```

ואז בעל העסק: **גוגל ושיתוף** → "Google Analytics 4" → מזהה `G-…` → **פרסום**. הבאנר מופיע מעצמו; שום קוד של Google
לא נטען עד שגולש מאשר. כיבוי: אותה פקודה עם `false` — הבאנר והמדידה נעלמים מיד.

## הערות

- **מיזוג עם `hospitality/stage-2`:** שתי המיגרציות של SEO (`20261110200000`, `20261110210000`) נכנסות לפני 62–65
  של האירועים לפי התאריך. ב-`rollback-check.sh` הן `M62`–`M63` כאן; במיזוג — האירועים `M64`–`M67`. בדיקת P2 בפריסת
  האירועים תראה 4 מיגרציות ממתינות.
- **Cookies של GA4 כשתופעל:** `cookie_domain` = הכתובת של האתר בלבד — לא `nuri1.fit`, כך שלא מתערבבים עם ה-GA של
  החנות `nuriel-shop`.

## כל הפקודות לפי הסדר

| #         | סוג                      | מה                               | תקין                                               |
| --------- | ------------------------ | -------------------------------- | -------------------------------------------------- |
| ⛔ 1 · BS | ✏️ גיבוי + קבצים + image | גיבוי, הקוד ← `6a8ce22`, בנייה   | `dump … ok`, `applied: 178`, `build ok`            |
| ⛔ 2 · M  | ✏️ מסד                   | מיגרציה `20261110210000` + בדיקה | `1\|t\|f\|f\|f\|t\|179`                            |
| ⛔ 3 · U  | ✏️ הפעלה מחדש            | הגרסה החדשה עולה                 | `(healthy)`, `running the new image`, `local: 200` |
| V         | 🔍 מהסשן                 | צילומים חיים מול שלב 2           | רק `/` 301 ו-`Allow: /$`; Ecommerce — 0            |
| R1 / R2   | ✏️                       | רק בתקלה                         | `de766ac` / `178`                                  |

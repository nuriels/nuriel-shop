# פריסה לייצור: שלב א' — תיקוני נופי דורית (מיגרציות 55–59) — nuriel-shop

> **הקוד לפריסה:** `d1df489` (ענף `hospitality/stage-2`). **אף פקודה כאן לא הורצה בשרת.**
> שולחים לי פקודה אחת, מריצים, ומחזירים את הפלט — ורק אז הפקודה הבאה. שום פקודה לא מדפיסה סוד.
>
> 🔍 = קריאה בלבד · ✏️ = משנה משהו בשרת (כתוב בדיוק מה) · ⛔ = נקודת אישור שלך.
>
> **מצב השרת לפני** (הפריסה הקודמת, 7 בנובמבר): הקוד על `7ec7a26`, 170 מיגרציות רשומות, תגי חזרה
> `before-sec-lic`, `before-landing`, `before-jk`. P1–P2 מאמתים את זה — אחרת עוצרים.
>
> **מצב השרת אחרי:** הקוד על `d1df489`, 175 מיגרציות, תג חזרה חדש `before-stage-a`.
>
> **נבדק מראש (בלי השרת):** פקודות ה-SQL (M1 ו-R2.1) הורצו מילה במילה על מסד מקומי במצב של השרת — כל
> המיגרציות עד 54 וטבלת `_migrations_applied` עם 170 שורות: 55–59 ← בדיקות (`5|f|t|0|t|0|f|t|175`) ←
> Rollback ל-170 ← שוב קדימה ל-175. לא נבדקו מקומית: הבנייה, ההפעלה, והכתובות האמיתיות.

## מה נכנס

| קומיט     | מה                                                                     | בשרת                  |
| --------- | ---------------------------------------------------------------------- | --------------------- |
| `789843a` | כניסת מנהל: בלי "קפיצה" חזרה למסך הכניסה                               | אפליקציה              |
| `beff543` | הלוגו של העסק בתצוגה מקדימה בשיתוף, ב-favicon ובאייקון מסך הבית        | אפליקציה              |
| `d79ed30` | העברה בנקאית: כלל 7 הימים, אישורי העברה מהאורח, אישור / דחייה בניהול   | אפליקציה + מיגרציה 55 |
| `9fe1a31` | "ההזמנות שלי": כניסה בקוד למייל, ההזמנות של האורח, תשלום ואישורי העברה | אפליקציה + מיגרציה 56 |
| `a0ae796` | "מתחם שומר שבת": מתג בהגדרות, תג בכותרת ובתחתית, הודעה בהזמנה          | אפליקציה + מיגרציה 57 |
| `8ca0288` | כניסת מנהל עם Google (דרך הכניסה המרכזית) ואיפוס סיסמה בקוד למייל      | אפליקציה              |
| `0579a2b` | פאנל הפלטפורמה: חנויות ואתרי אירוח בנפרד; שינוי חבילה לאתר אירוח       | אפליקציה + מיגרציה 58 |
| `4d1e565` | חבילות אירוח / חבילות מיוחדות (למשל חבילת כלה)                         | אפליקציה + מיגרציה 59 |
| `d1df489` | "היכנס לניהול" בכרטיס אתר אירוח בפאנל; תיקוני CI                       | אפליקציה              |

**5 מיגרציות** — כל אחת עטופה ב-`BEGIN` / `COMMIT` (או כולה, או כלום). **אף אחת לא משנה נתונים קיימים:**

| #   | קובץ                                          | מה                                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------- |
| 55  | `20261108100000_hosp_bank_transfer.sql`       | עמודה ריקה בהזמנות (אמצעי תשלום), טבלה חדשה, דלי פרטי חדש, פונקציות |
| 56  | `20261108110000_hosp_guest_area.sql`          | שתי טבלאות חדשות (קודי כניסה, חיבורים), פונקציות                    |
| 57  | `20261108120000_hosp_shabbat.sql`             | עמודה בהגדרות — **כבויה בכל העסקים**                                |
| 58  | `20261108130000_hosp_platform_separation.sql` | שתי פונקציות של הפאנל (רשימת החנויות, רשימת אתרי האירוח)            |
| 59  | `20261108140000_hosp_packages.sql`            | טבלה חדשה ריקה, שתי עמודות ריקות בהזמנות, פונקציות                  |

- **בלי משתני סביבה חדשים** ובלי שינוי ב-`docker-compose.yml` / Nginx. הקודים של "ההזמנות שלי" משתמשים
  ב-`HOSPITALITY_SECRET` הקיים (P2 מוודא שהוא מוגדר).
- **החנויות (Ecommerce) לא משתנות.** 58 משנה רק את רשימת "חנויות" בפאנל — אתרי האירוח עוברים למסך משלהם.
- **הסדר:** הקוד והבנייה קודם (האתר ממשיך לרוץ), אחר כך 55 ← 59 ברצף, ומיד ההפעלה. הגרסה הקודמת עובדת
  גם מול 55–59 (רק מוסיפות), כך שהחלון בין המיגרציות להפעלה בטוח — וגם חזרה של האפליקציה בלבד (R1)
  אפשרית בלי לגעת במסד.

---

## שלב 1 — בדיקות מקדימות (🔍)

### P1 — הענף והקומיט

```bash
cd /root/nuriel-shop-git && git branch --show-current && git log --oneline -1 && git status --short --untracked-files=no | wc -l && git fetch origin "+refs/heads/hospitality/stage-2:refs/remotes/origin/hospitality/stage-2" && git merge-base --is-ancestor HEAD d1df489 && echo "fast-forward possible" && git merge-base --is-ancestor d1df489 origin/hospitality/stage-2 && echo "d1df489 is on origin" && git log --oneline -1 d1df489
```

**תקין:** `hospitality/stage-2`; `7ec7a26 Digital license sending module …`; `0`; `fast-forward possible`;
`d1df489 is on origin`; `d1df489 CI fixes for stage A; …`. אחרת — עוצרים.

### P2 — Docker, המיגרציות, הדיסק, המשתנים (שמות בלבד)

```bash
cd /root/nuriel-shop-git && docker ps --format '{{.Names}}\t{{.Status}}' | grep '^nuriel-shop-' && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.CreatedSince}}' && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && LC_ALL=C comm -23 <(git ls-tree --name-only d1df489 supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) && LC_ALL=C comm -13 <(git ls-tree --name-only d1df489 supabase/migrations/ | xargs -n1 basename | LC_ALL=C sort) <(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort) | wc -l && df -h /var/lib/docker /root/backups/nuriel-shop | tail -n +2 && for v in HOSPITALITY_SECRET RESEND_API_KEY TENANT_BASE_DOMAIN HOSPITALITY_ENGINE; do grep -q "^$v=." .env && echo "$v: set" || echo "$v: NOT SET"; done
```

**תקין:**

- הקונטיינרים של nuriel-shop ב-`Up`; ליד `nuriel-shop-app`: `(healthy)`.
- התגים: `latest`, `before-sec-lic`, `before-landing`, `before-jk`.
- `170`; חמש שורות בדיוק — חמשת הקבצים `20261108…` (55–59); ואז `0`.
- בעמודת `Avail` של `/var/lib/docker` — לפחות 5G.
- ארבע שורות `set`.

**⛔ אישור 1 — רק אם P1–P2 תקינים.** מכאן הפקודות כותבות בשרת.

---

## שלב 2 — גיבוי (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-stage-a` ומוסיף תג ל-image; האתר לא מושפע)

### B1 — המסד, רשימת המיגרציות, גרסת האפליקציה, קובצי התצורה ותג חזרה

```bash
mkdir -m 700 /root/backups/nuriel-shop/before-stage-a && cd /root/backups/nuriel-shop/before-stage-a && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > db.dump && docker exec -i nuriel-shop-db pg_restore --list < db.dump > db.toc && grep -c "TABLE DATA" db.toc && docker exec -i nuriel-shop-db pg_restore -f /dev/null < db.dump && echo "dump read to the end: ok" && ls -lh db.dump && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > applied-before.txt && wc -l < applied-before.txt && git -C /root/nuriel-shop-git log --oneline -1 | tee app-commit.txt && cp -p /root/nuriel-shop-git/.env app.env && cp -p /root/nuriel-shop-git/docker-compose.override.yml app-compose.override.yml && cp -p /root/nuriel-shop-supabase/docker/.env supabase.env && cp -p /root/nuriel-shop-supabase/docker/docker-compose.yml supabase-compose.yml && chmod 600 app.env supabase.env && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-stage-a && docker images nuriel-shop-app-app --format '{{.Tag}}' && ls
```

**תקין:** מספר הטבלאות בגיבוי (ב-7 בנובמבר: כ-150); `dump read to the end: ok`; הגודל (כ-3M); `170`;
`7ec7a26 …`; התגים כוללים `before-stage-a`; בתיקייה 8 קבצים: `app-commit.txt app-compose.override.yml app.env
applied-before.txt db.dump db.toc supabase-compose.yml supabase.env`.

(קבצים באחסון — תמונות, לוגואים — לא משתנים בפריסה הזו; הדלי הפרטי של אישורי ההעברה נוצר עכשיו, ריק.)

### B2 — הגיבוי ניתן לשחזור (✏️ מסד בדיקה נפרד `restore_check` — נוצר ונמחק; המסד החי לא נוגע)

```bash
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-stage-a/db.dump > /dev/null 2>&1; for d in postgres restore_check; do docker exec nuriel-shop-db psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM hospitality.bookings), (SELECT count(*) FROM public._migrations_applied)"; done && docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```

**תקין:** (שורת `NOTICE: database "restore_check" does not exist, skipping` — רגילה) שתי שורות **זהות**
(חנויות | משתמשים | הזמנות חנות | הזמנות אירוח | 170) ואז `restore check: done`. שורות שונות — עוצרים.

---

## שלב 3 — הקוד והבנייה (האתר ממשיך לרוץ על הגרסה הקודמת)

### S1 — הקוד (✏️ קבצים ב-`/root/nuriel-shop-git` + עותק של קובצי ה-Rollback ליד הגיבוי)

```bash
cd /root/nuriel-shop-git && git merge -q --ff-only d1df489 && git log --oneline -1 && mkdir -p /root/backups/nuriel-shop/before-stage-a/rollbacks && cp supabase/rollbacks/202611081*.down.sql /root/backups/nuriel-shop/before-stage-a/rollbacks/ && ls /root/backups/nuriel-shop/before-stage-a/rollbacks
```

**תקין:** `d1df489 CI fixes for stage A; …`; חמשת קובצי `202611081…down.sql`.

### S2 — בדיקה יבשה (🔍): מה ממתין, ונופי דורית לפני

```bash
cd /root/nuriel-shop-git && LC_ALL=C comm -23 <(ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort) /root/backups/nuriel-shop/before-stage-a/applied-before.txt && docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, t.name, t.site_type, (SELECT count(*) FROM hospitality.units u WHERE u.tenant_id = t.id) AS units, (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id) AS bookings, (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = t.id AND m.owner_kind = 'brand') AS logos FROM public.tenants t WHERE t.site_type = 'hospitality' ORDER BY t.created_at"
```

**תקין:** חמש שורות — 55–59. ואז טבלת אתרי האירוח: שורה ל-`nofi-dorit` (4 יחידות, מספר ההזמנות,
`logos = 1`) ושאר האתרים. את המספרים משווים ב-V2 — הם לא צריכים להשתנות.

### S3 — בנייה (✏️ image חדש; האתר ממשיך לרוץ על הישן)

```bash
cd /root/nuriel-shop-git && docker compose build
```

**תקין:** מסתיים בלי שגיאה (`Built`). כמה דקות. שגיאה — עוצרים (האתר לא נפגע).

**⛔ אישור 2 — מכאן משנים את המסד ומפעילים את הגרסה החדשה.** בשעה שקטה.

---

## שלב 4 — מיגרציות 55–59 והפעלה (✏️ המסד + הפעלה מחדש)

### M1

כל מיגרציה בטרנזקציה משלה, ונרשמת רק אם הצליחה. שגיאה — הלולאה עוצרת (`STOPPED at …`) והאתר נשאר על
הגרסה הקודמת. אחרי החמש — שורת בדיקה אחת, ורק אם היא תקינה: רענון ה-API ו-`docker compose up -d`.

```bash
cd /root/nuriel-shop-git && ( for f in 20261108100000_hosp_bank_transfer 20261108110000_hosp_guest_area 20261108120000_hosp_shabbat 20261108130000_hosp_platform_separation 20261108140000_hosp_packages; do docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" || { echo "STOPPED at $f"; exit 1; }; done ) && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename LIKE '20261108%'), (SELECT public FROM storage.buckets WHERE id = 'hosp-payment-proofs'), to_regclass('hospitality.guest_sessions') IS NOT NULL, (SELECT count(*) FROM hospitality.settings WHERE shabbat_observant), (SELECT prosrc LIKE '%site_type = ''ecommerce''%' FROM pg_proc WHERE oid = 'public.platform_list_tenants()'::regprocedure), (SELECT count(*) FROM hospitality.packages), has_function_privilege('anon', 'hospitality.request_booking_package(uuid,date,text,text,text,text,boolean,text,integer,integer,text,boolean,text)', 'EXECUTE'), has_function_privilege('anon', 'hospitality.public_packages()', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "5|f|t|0|t|0|f|t|175" ] && echo "55-59 checks ok" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'" && docker compose up -d
```

**תקין:**

- חמש שורות `… ok` (55 עד 59). ביניהן שורות `NOTICE: … does not exist, skipping` (מדיניות / טריגר / אילוץ /
  פונקציה — יצירה ראשונה) — רגילות.
- `5|f|t|0|t|0|f|t|175` — לפי הסדר: חמש רשומות; הדלי של אישורי ההעברה **פרטי**; טבלת החיבורים של
  "ההזמנות שלי" קיימת; "שומר שבת" כבוי בכל העסקים; רשימת החנויות — חנויות בלבד; 0 חבילות; בקשת חבילה
  **לא** פתוחה לגולש ישירות (רק דרך השרת); רשימת החבילות לאתר — פתוחה; 175 מיגרציות.
- `55-59 checks ok`; `NOTIFY`; שורות ה-compose (`Recreate` / `Started`).

**נעצר (`STOPPED`, או שורה אחרת, או בלי `checks ok`):** לא מפעילים. האתר עדיין על הגרסה הקודמת (והיא עובדת
גם מול מה שכבר נכנס). שולחים לי את הפלט — שלב 7 מסביר מה עושים.

---

## שלב 5 — בדיקות אחרי ההפעלה

### V1 — האתר של נופי דורית, הכניסה, הלוגו (🔍; מחכה דקה — זה לא תקוע)

```bash
cd /root/nuriel-shop-git && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt && for p in /stay /stay/account /stay/book /manage/login /sitemap.xml; do curl -s -o /dev/null -w "nofi-dorit $p: %{http_code}\n" "https://nofi-dorit.nuri1.fit$p"; done && curl -s https://nofi-dorit.nuri1.fit/stay | grep -oE '/stay/brand/[a-z0-9-]+' | sort | uniq -c && og=$(curl -s https://nofi-dorit.nuri1.fit/stay | grep -oE 'property="og:image" content="[^"]*"' | head -1 | cut -d'"' -f4) && echo "og:image: ${og%%\?*}" && curl -s -o /dev/null -w 'og-image file: %{http_code} %{content_type}\n' "$og" && curl -s -o /dev/null -w 'manifest: %{http_code} %{content_type}\n' "https://nofi-dorit.nuri1.fit/stay/brand/manifest" && curl -s -o /dev/null -w 'store nuriel-shop: %{http_code}\n' https://nuriel-shop.nuri1.fit/ && docker logs --since 3m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | tail -20
```

**תקין:**

- `app` — `Up … (healthy)`; `robots: 200`.
- חמש שורות `nofi-dorit …: 200`.
- רשימת `/stay/brand/…` — לפחות `og-image`, `icon-192`, `apple-touch-icon`, `manifest`.
- `og:image: https://nofi-dorit.nuri1.fit/stay/brand/og-image` — הלוגו של נופי דורית (לא של נוריאל);
  `og-image file: 200 image/png`; `manifest: 200 application/manifest+json`.
- `store nuriel-shop: 200` — החנות לא נפגעה.
- לוג ריק (שורות `aborted` — לא בעיה). כל שגיאה אחרת — שולחים לי.

### V2 — המסד אחרי (🔍): כלום לא אבד, ושום דבר לא נפתח בטעות

```bash
docker exec nuriel-shop-db psql -U postgres -d postgres -c "SELECT t.slug, (SELECT count(*) FROM hospitality.units u WHERE u.tenant_id = t.id) AS units, (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = t.id) AS bookings, (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = t.id AND m.owner_kind = 'brand') AS logos, (SELECT shabbat_observant FROM hospitality.settings s WHERE s.tenant_id = t.id) AS shabbat FROM public.tenants t WHERE t.site_type = 'hospitality' ORDER BY t.created_at" -c "SELECT count(*) AS stores_in_platform_list FROM public.tenants WHERE site_type = 'ecommerce'" -c "SELECT (SELECT count(*) FROM hospitality.payment_proofs) AS proofs, (SELECT count(*) FROM hospitality.guest_codes) AS guest_codes, (SELECT count(*) FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs') AS proof_files"
```

**תקין:** אותם מספרי יחידות, הזמנות ולוגואים כמו ב-S2; `shabbat = f` בכולם; מספר החנויות (מה שהפאנל יראה
ב"חנויות אונליין"); `0 | 0 | 0` (או מעט קודי כניסה, אם אורח כבר ניסה את "ההזמנות שלי").

### V3 — בדפדפן (אתה)

1. **הלוגו בשיתוף:** שולחים לעצמך בווטסאפ את `https://nofi-dorit.nuri1.fit/stay?v=1` — בתצוגה המקדימה הלוגו
   של נופי דורית. (ווטסאפ שומר תצוגות ישנות במטמון לפי כתובת — לכן `?v=1`.)
2. **כניסת מנהל:** `https://nofi-dorit.nuri1.fit/manage/login` — כניסה בקוד למייל ואחריה נשארים בניהול (בלי
   חזרה למסך הכניסה). בלשונית הסיסמה — הקישור "שכחתי סיסמה", והכפתור "כניסה עם Google" מוביל ל-nuriel-app2.
3. **בניהול של נופי דורית:** בתפריט — "חבילות" (ריק); בהגדרות — המתג "מתחם שומר שבת" (כבוי).
4. **באתר:** בכותרת — "ההזמנות שלי"; "מתחם שומר שבת" לא מופיע (כבוי); הזמנה רגילה נפתחת כרגיל
   (`/stay/book`) — בלי לשלוח.
5. **פאנל הפלטפורמה:** "חנויות אונליין" — בלי אתרי אירוח, עם כרטיס "לאתרי האירוח"; ב"אתרי אירוח" — נופי
   דורית, "שינוי חבילה" (רק לראות — בלי לשמור), ו"היכנס לניהול" פותח את הניהול שלה בלשונית חדשה.

### V4 — הזמנת בדיקה עם אישור העברה (⛔ אישור 3 — לא חובה; יוצרת הזמנה אמיתית ומיילים)

רק אם רוצים לבדוק בייצור גם הזמנה והעלאת אישור (בבדיקות האוטומטיות זה עבר):

1. באתר של נופי דורית — הזמנה לתאריך רחוק (חודשיים קדימה), עם **המייל שלך**, ובחירה "העברה בנקאית".
2. בעמוד ההזמנה שבמייל — העלאת צילום מסך קטן כאישור העברה ← "התקבל — ממתין לבדיקת המתחם".
3. בניהול — ההזמנה מופיעה עם אישור ההעברה; **דוחים את הבקשה** (או מבטלים) כדי לשחרר את התאריכים.

---

## שלב 6 — עותק מוצפן של הגיבוי, מחוץ לשרת

### B3 — קובץ מוצפן אחד (✏️)

`openssl` מבקש סיסמה **חדשה** (פעמיים) — רק לקובץ הזה; שומרים אותה במנהל סיסמאות. ואז שוב, לבדיקה.

```bash
tar -C /root/backups/nuriel-shop -cf - before-stage-a | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -out /root/backups/nuriel-shop/before-stage-a.tar.enc && ls -lh /root/backups/nuriel-shop/before-stage-a.tar.enc && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in /root/backups/nuriel-shop/before-stage-a.tar.enc | tar -tf - | grep -c 'db.dump'
```

**תקין:** גודל הקובץ (כ-3M); `1`. אחר כך, **מהמחשב שלך**:
`scp root@<כתובת השרת>:/root/backups/nuriel-shop/before-stage-a.tar.enc .`

---

## שלב 7 — Rollback (רק אם צריך; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה בלבד (✏️ הכי מהיר; לכל תקלה בממשק)

הגרסה הקודמת עובדת מול 55–59 (רק תוספות), כך שאין צורך לגעת במסד.

```bash
docker tag nuriel-shop-app-app:before-stage-a nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'robots: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** שורות ה-compose; `Up … (healthy)`; `robots: 200`. ה-image של `7ec7a26` עולה מיד, בלי בנייה.

### R2 — גם המסד: 59 ← 55 (✏️; רק אחרי R1, ורק אם המסד עצמו בעייתי)

**R2.0 — גיבוי של המצב הנוכחי:**

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-stage-a/before-rollback.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < /root/backups/nuriel-shop/before-stage-a/before-rollback.dump && ls -lh /root/backups/nuriel-shop/before-stage-a/before-rollback.dump && echo "backup ok"
```

**R2.1 — המסד (רק מה שרשום — מתאים גם לעצירה באמצע M1):**

```bash
for f in $(ls /root/backups/nuriel-shop/before-stage-a/rollbacks/202611081*.down.sql | LC_ALL=C sort -r); do name=$(basename "$f" .down.sql).sql; applied=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$name')"); [ "$applied" = "t" ] || continue; echo "=== rollback $name"; docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f" || { echo "STOPPED at $name"; break; }; docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '$name'"; done; docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied" && docker exec nuriel-shop-db psql -U postgres -d postgres -c "NOTIFY pgrst, 'reload schema'"
```

**תקין:** חמש שורות `=== rollback …` מ-`…140000_hosp_packages` עד `…100000_hosp_bank_transfer`, בלי
`STOPPED`; `170`; `NOTIFY`.

**הגנות:** ה-Rollback של 59 נעצר אם כבר נוצרו חבילות או הזמנות של חבילות, ושל 55 — אם אורחים כבר העלו
אישורי העברה (רשומות או קבצים בדלי). הם של העסק ושל האורחים — לא מוחקים אותם בשקט. במקרה כזה הלולאה
נעצרת (`STOPPED at …`) והמסד נשאר תקין — שולחים לי, ומחליטים יחד.

---

## כל הפקודות לפי הסדר

| #     | סוג            | מה                              | תקין                                |
| ----- | -------------- | ------------------------------- | ----------------------------------- |
| P1    | 🔍             | הענף והקומיט                    | `7ec7a26`, `fast-forward possible`  |
| P2    | 🔍             | Docker, מיגרציות, דיסק, משתנים  | `170`, 5 ממתינות, `0`, 4× `set`     |
| ⛔ 1  |                |                                 |                                     |
| B1    | ✏️ גיבוי       | מסד, תצורה, תג `before-stage-a` | `dump read to the end: ok`, 8 קבצים |
| B2    | ✏️ מסד נפרד    | בדיקת שחזור                     | שתי שורות זהות                      |
| S1    | ✏️ קבצים       | הקוד ← `d1df489`                | 5 קובצי Rollback                    |
| S2    | 🔍             | ממתינות + נופי דורית לפני       | 5 ממתינות                           |
| S3    | ✏️ image       | בנייה                           | `Built`                             |
| ⛔ 2  |                |                                 |                                     |
| M1    | ✏️ מסד + הפעלה | 55–59 + בדיקות + הפעלה          | `55-59 checks ok`, `Started`        |
| V1    | 🔍             | נופי דורית, לוגו, החנות         | `200`, `og-image`, `healthy`        |
| V2    | 🔍             | המסד אחרי                       | אותם מספרים כמו ב-S2                |
| V3    | דפדפן          | שיתוף, כניסה, חבילות, שבת, פאנל | —                                   |
| V4    | ⛔ 3 לא חובה   | הזמנת בדיקה + אישור העברה       | "התקבל — ממתין לבדיקת המתחם"        |
| B3    | ✏️ קובץ מוצפן  | עותק מחוץ לשרת                  | `1`                                 |
| R1/R2 | ✏️             | רק בתקלה                        | —                                   |

# NURIEL AI SEO ENGINE — פריסה לייצור, פקודה אחר פקודה

ענף: **`feature/ai-seo-engine`** (יוצא מ-`main` = `696ccf0`, גרסת 21.11). **`<REL>`** = ה-commit שנבדק ב-CI (נמסר בהודעה).

> **כל צעד בשרת — בעל המערכת מריץ, פקודה אחת בכל פעם, ומדביק את הפלט.** כל פקודה עצמאית, נעצרת בשגיאה (`&&`), ולא מדפיסה
> סודות. ⛔ = נקודת אישור. 🔍 = קריאה בלבד. ✏️ = משנה משהו (מה בדיוק — כתוב ליד). ✋ = בדיקה בדפדפן.
> **שום פעולה כאן לא שולחת הודעה ללקוח, לא משנה הזמנה / מחיר / מדיניות, ולא מפרסמת תוכן באתר של עסק.**

## 1. מה נכנס לייצור

| | |
| --- | --- |
| מיגרציה **203** | `20261122100000_seo_engine.sql` — 7 טבלאות חדשות (RLS, בלי גישה ישירה מהדפדפן), תור משימות, טריגרים להוספה בלבד (עסק / מוצר / קטגוריה חדשים), עמודות Google חדשות לקטגוריות (ריקות), שורת הגדרות לכל עסק — **כל מילוי אוטומטי כבוי** |
| מיגרציה **204** | `20261122110000_hosp_seo_engine.sql` — עמודות Google לחבילות (ריקות), "לאחר כך" ו"שחזור" להצעות, מילוי אוטומטי (כבוי) לשדות ריקים בלבד, טריגרים ליחידה / חבילה / תמונה חדשות |
| אפליקציה | מסך **"SEO וגוגל"** לחנויות (`/admin?tab=seo`) ולאתרי אירוח (`/manage/seo`), **"SEO — כל העסקים"** בפאנל הפלטפורמה (`/platform/seo`), העובד ברקע, Search Console (מוכן — לא מוגדר), פירורי לחם בעמודי יחידה / חבילה, כותרת Google לחבילות ולקטגוריות |

**מה רץ מעצמו אחרי ההפעלה (ברירות המחדל — אין צורך לשנות `.env`):**
- `SEO_WORKER` ריק = **העובד פועל**: תוך כשעה — **בדיקה טכנית שבועית לכל עסק פעיל** (קריאה בלבד של עד 30 עמודים ציבוריים
  של האתר שלו; לא משנה כלום, לא שולח מיילים, בלי AI). עסק / מוצר / יחידה / חבילה / תמונה **חדשים** — הצעות בסיסיות לשדות ריקים,
  **ממתינות לאישור** בעל העסק.
- `SEO_BACKGROUND_AI` ריק = **בלי AI ברקע**. בעל עסק עם חבילת NURIEL AI בתוקף יכול לבקש הצעות AI מהמסך (אותו מפתח, מכסות,
  תקציב ויומן — אין מערכת מקבילה).
- `GSC_OAUTH_*` ריקים = אין חיבור ישיר ל-Search Console; **ייבוא CSV עובד**.
- רוצים לפרוס "כבוי"? `SEO_WORKER=off` ב-`.env` לפני A1 (ראו R0) — המסכים עובדים, שום דבר לא רץ ברקע.

## 2. סדר ותאימות

**מסד לפני אפליקציה: 203 ← 204 ← הפעלה.** האפליקציה הנוכחית (`696ccf0`) **עובדת מול מסד 204** — נבדק: כל 18 פונקציות ה-SEO
של Hospitality שהיא קוראת קיימות עם **אותה חתימה בדיוק** (204 רק הוסיפה פונקציות ושדות). לכן החלון בין המיגרציות להפעלה בטוח,
וגם **חזרה של האפליקציה לבדה (R1)** בטוחה. ב-Rollback: **R1 ← R204 ← R203.**

## 3. בדיקות מקדימות (🔍 קריאה בלבד)

**P1 — הקוד בשרת נקי, ואפשר להתקדם ל-`<REL>` בלי מיזוג:**
```bash
# P1
cd /root/nuriel-shop-git && git status --short | wc -l && git log --oneline -1 && git fetch -q origin feature/ai-seo-engine && git merge-base --is-ancestor HEAD <REL> && echo "fast-forward ok"
```
**תקין:** `0`, השורה של הגרסה הנוכחית (`696ccf0 …` — גרסת 21.11), `fast-forward ok`.

**P2 — הקונטיינרים, ה-images, מקום פנוי, ומשתני SEO שכבר קיימים (רק מספר — בלי ערכים):**
```bash
# P2
cd /root/nuriel-shop-git && docker compose ps && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.ID}}' && df -h / /var/lib/docker /root/backups/nuriel-shop && echo "SEO variables already in .env: $(grep -cE '^(SEO_WORKER|SEO_BACKGROUND_AI|GSC_OAUTH_[A-Z_]+)=' .env)"
```
**תקין:** `app` — `Up … (healthy)`; כמה GB פנויים לפחות; `SEO variables already in .env: 0`.

**P3 — 202 מיגרציות, ואף אחת משתי החדשות:**
```bash
# P3
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*), count(*) FILTER (WHERE filename IN ('20261122100000_seo_engine.sql', '20261122110000_hosp_seo_engine.sql')), to_regclass('public.seo_jobs') IS NULL, to_regprocedure('hospitality.seo_proposal_revert(uuid)') IS NULL FROM public._migrations_applied"
```
**תקין:** `202|0|t|t`.

⛔ **אישור 1** — רק אם P1–P3 תקינים.

## 4. גיבוי ונקודות השוואה (✏️ כותב רק ל-`/root/backups/nuriel-shop/before-seo-engine` + תג ל-image; האתר לא מושפע)

**B1 — קובצי הגרסה (מתוך `<REL>`), גיבוי המסד, רשימת המיגרציות, checksum של נתוני הלקוחות, תמונת מצב של נופי דורית, תג חזרה:**
```bash
# B1
B=/root/backups/nuriel-shop/before-seo-engine && mkdir -m 700 $B && mkdir $B/release && git -C /root/nuriel-shop-git archive <REL> deploy/seo-engine supabase/migrations/20261122100000_seo_engine.sql supabase/migrations/20261122110000_hosp_seo_engine.sql supabase/rollbacks/20261122100000_seo_engine.down.sql supabase/rollbacks/20261122110000_hosp_seo_engine.down.sql | tar -x -C $B/release && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > $B/db.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < $B/db.dump && echo "dump read to the end: ok" && sha256sum $B/db.dump | tee $B/db.dump.sha256 && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > $B/applied-before.txt && wc -l < $B/applied-before.txt && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/guard.sql | tee $B/guard-before.txt && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/nofi-snapshot.sql | tee $B/nofi-before.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-seo-engine && docker image inspect nuriel-shop-app-app:before-seo-engine --format '{{.Id}}' | tee $B/image-id.txt
```
**תקין:** `dump read to the end: ok`; שורת sha256; `202`; checksum אחד (32 תווים); תמונת המצב של נופי דורית — החתימה
(`fingerprint` ו-`revision`), היחידות, **חבילת הכלה** (2 לילות, המחיר, `description_md5`), **הג'קוזי — "רק בחדר מוריה"**, גרסאות
האתר, המסמכים החתומים, מספר ההזמנות; ID של image.

**B1b — הכותרות והתיאורים שגוגל רואה היום (נשווה אחרי ההפעלה — חייבים להיות זהים עד שבעל העסק מאשר משהו):**
```bash
# B1b
B=/root/backups/nuriel-shop/before-seo-engine && for u in https://nofi-dorit.nuri1.fit/stay https://nofi-dorit.nuri1.fit/stay/units/%D7%9E%D7%95%D7%A8%D7%99%D7%94 https://nofi-dorit.nuri1.fit/stay/packages/%D7%97%D7%91%D7%99%D7%9C%D7%AA-%D7%94%D7%9B%D7%9C%D7%94-vip-%D7%A8%D7%92%D7%A2%D7%99%D7%9D-%D7%A9%D7%9C-%D7%A7%D7%A1%D7%9D-%D7%91%D7%A0%D7%95%D7%A4%D7%99-%D7%93%D7%95%D7%A8%D7%99%D7%AA https://nuriel-shop.nuri1.fit/; do printf '%s\n' "$u"; curl -s -m 20 "$u" | grep -aoE '<title>[^<]*</title>|<meta name="description" content="[^"]*"' | head -2; done | tee $B/titles-before.txt
```
**תקין:** לכל כתובת — שורת `<title>` ושורת `description`.

**B2 — בדיקה שהגיבוי משתחזר (✏️ מסד בדיקה נפרד שנוצר ונמחק):**
```bash
# B2
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-seo-engine/db.dump > /dev/null 2>&1; for d in postgres restore_check; do docker exec nuriel-shop-db psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied), (SELECT count(*) FROM hospitality.client_contracts), (SELECT count(*) FROM hospitality.bookings)"; done; docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```
**תקין:** שתי שורות **זהות**, ו-`restore check: done`.

## 5. קוד ו-image (✏️ `/root/nuriel-shop-git` + image חדש; **האתר ממשיך על הגרסה הנוכחית**)

**S1 — הקוד:**
```bash
# S1
cd /root/nuriel-shop-git && git merge -q --ff-only <REL> && git log --oneline -1 && ls /root/backups/nuriel-shop/before-seo-engine/release/supabase/rollbacks
```
**תקין:** השורה של `<REL>`; שני קובצי ה-Rollback.

**S2 — בדיוק שתי מיגרציות ממתינות, וטביעות האצבע שלהן (🔍):**
```bash
# S2
cd /root/nuriel-shop-git && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort | LC_ALL=C comm -23 - /root/backups/nuriel-shop/before-seo-engine/applied-before.txt && sha256sum supabase/migrations/20261122100000_seo_engine.sql supabase/migrations/20261122110000_hosp_seo_engine.sql
```
**תקין:** שתי השורות `20261122100000_seo_engine.sql`, `20261122110000_hosp_seo_engine.sql`; ה-sha256 = סעיף 9.

**S3 — בנייה:**
```bash
# S3
cd /root/nuriel-shop-git && docker compose build && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
```
**תקין:** `latest` עם ID **חדש**; `before-seo-engine` = ה-ID מ-B1.

⛔ **אישור 2 — מכאן משנים את המסד ומפעילים.** M1 ← M2 ← M3 ← A1 ברצף, בשעה שקטה.

## 6. המיגרציות (✏️ המסד — כל מיגרציה והרישום שלה בטרנזקציה אחת)

**M1 — 203:**
```bash
# M1
cd /root/nuriel-shop-git && f=20261122100000_seo_engine && echo "<SHA203>  supabase/migrations/$f.sql" | sha256sum -c --quiet - && [ "$(tail -n 1 supabase/migrations/$f.sql)" = "COMMIT;" ] && { printf '%s\n' "DO \$g\$ BEGIN IF (SELECT count(*) FROM public._migrations_applied) <> 202 OR EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$f.sql') THEN RAISE EXCEPTION 'gate: expected 202 applied migrations and % not applied - nothing changed', '$f'; END IF; END \$g\$;"; sed '$d' supabase/migrations/$f.sql; printf '%s\n' "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql');" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "$f applied + registered (one transaction)"
```
**תקין:** `20261122100000_seo_engine applied + registered (one transaction)`.

**M2 — 204:**
```bash
# M2
cd /root/nuriel-shop-git && f=20261122110000_hosp_seo_engine && echo "<SHA204>  supabase/migrations/$f.sql" | sha256sum -c --quiet - && [ "$(tail -n 1 supabase/migrations/$f.sql)" = "COMMIT;" ] && { printf '%s\n' "DO \$g\$ BEGIN IF (SELECT count(*) FROM public._migrations_applied) <> 203 OR NOT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '20261122100000_seo_engine.sql') OR EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$f.sql') THEN RAISE EXCEPTION 'gate: expected 203 applied migrations incl. 20261122100000_seo_engine, and % not applied - nothing changed', '$f'; END IF; END \$g\$;"; sed '$d' supabase/migrations/$f.sql; printf '%s\n' "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql');" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "$f applied + registered (one transaction)"
```
**תקין:** `20261122110000_hosp_seo_engine applied + registered (one transaction)`.

**נעצר** (טביעת אצבע שונה / `gate:` / שגיאת SQL) — **שום דבר לא השתנה** באותה מיגרציה (שער לפני הטרנזקציה; טרנזקציה אחת
אחריו). אם M1 עבר ו-M2 נעצר — המסד ב-203, האתר על הגרסה הנוכחית ועובד. לא ממשיכים; שולחים את הפלט.

**M3 — בדיקות אחרי (🔍): ההרשאות, ההגדרות כבויות, שום דבר לא נוצר לעסקים קיימים, ונתוני הלקוחות ונופי דורית זהים:**
```bash
# M3
B=/root/backups/nuriel-shop/before-seo-engine && out=$(docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/checks-after.sql) && echo "$out" && [ "$out" = "t|t|t|t|t|t|t|204" ] && echo "checks: ok" && [ "$(docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/guard.sql)" = "$(cat $B/guard-before.txt)" ] && echo "customers' data unchanged: ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/nofi-snapshot.sql | diff - $B/nofi-before.txt && echo "nofi-dorit unchanged: ok"
```
**תקין:** `t|t|t|t|t|t|t|204`, `checks: ok`, `customers' data unchanged: ok`, `nofi-dorit unchanged: ok`.

## 7. הפעלה ובדיקות עשן

**A1 — הגרסה החדשה (✏️ שניות עד דקה):**
```bash
# A1
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -o /dev/null -w 'healthz: %{http_code}\n' http://127.0.0.1:3700/healthz && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz && docker inspect -f 'health: {{.State.Health.Status}}' nuriel-shop-app && echo "seo worker started: $(docker logs --since 3m nuriel-shop-app 2>&1 | grep -c '\[seo\] worker started')" && echo "seo registration problems: $(docker logs --since 3m nuriel-shop-app 2>&1 | grep -c '\[seo\].*not registered')"
```
**תקין:** `app` — `Up … (healthy)`; `healthz: 200`; `readyz: 200`; `health: healthy`; `seo worker started: 1`;
`seo registration problems: 0`. **אחרת — R1 מיד.**

**A2 — הלוג (🔍):**
```bash
# A2
docker logs --since 10m nuriel-shop-app 2>&1 | grep -ciE 'error|unhandled'; docker logs --since 10m nuriel-shop-app 2>&1 | grep -E '\[seo\]' | tail -5
```
**תקין:** 0 או מספר קטן ומוסבר; שורת `[seo] worker started …(background AI off)`.

**SM1 — האתרים עונים, והכותרות והתיאורים בגוגל לא השתנו (🔍):**
```bash
# SM1
B=/root/backups/nuriel-shop/before-seo-engine && for u in https://nuriel-shop.nuri1.fit https://nuri1.nuri1.fit https://nofi-dorit.nuri1.fit https://nuriel-app2.nuri1.fit; do curl -s -L -o /dev/null -w "$u -> %{http_code}\n" "$u/"; done && for u in https://nofi-dorit.nuri1.fit/stay https://nofi-dorit.nuri1.fit/stay/units/%D7%9E%D7%95%D7%A8%D7%99%D7%94 https://nofi-dorit.nuri1.fit/stay/packages/%D7%97%D7%91%D7%99%D7%9C%D7%AA-%D7%94%D7%9B%D7%9C%D7%94-vip-%D7%A8%D7%92%D7%A2%D7%99%D7%9D-%D7%A9%D7%9C-%D7%A7%D7%A1%D7%9D-%D7%91%D7%A0%D7%95%D7%A4%D7%99-%D7%93%D7%95%D7%A8%D7%99%D7%AA https://nuriel-shop.nuri1.fit/; do printf '%s\n' "$u"; curl -s -m 20 "$u" | grep -aoE '<title>[^<]*</title>|<meta name="description" content="[^"]*"' | head -2; done | diff - $B/titles-before.txt && echo "titles and descriptions unchanged: ok" && echo "breadcrumbs on the Moriah page: $(curl -s -m 20 https://nofi-dorit.nuri1.fit/stay/units/%D7%9E%D7%95%D7%A8%D7%99%D7%94 | grep -ac BreadcrumbList)"
```
**תקין:** `200` לכולם; `titles and descriptions unchanged: ok`; `breadcrumbs on the Moriah page: 1` (התיקון הטכני החדש).

**SM2 (✋ דפדפן):**
- חנות (בעל החנות): ניהול ← **"SEO וגוגל"** — המסך נטען; "בדיקה טכנית — לא תחזית למיקום בגוגל"; בהגדרות — כל המילוי האוטומטי
  **כבוי**. **לא לאשר כלום.**
- נופי דורית (`/manage/seo`): המסך נטען, ההצעות (אם יש) **ממתינות** — **לא לאשר כלום** בשלב הזה.
- פאנל הפלטפורמה ← **"SEO — כל העסקים"**: טבלה עם מספרים בלבד (ציון, ממצאים, ממתינות, בתור) — בלי טקסטים של עסקים.

⛔ **אישור 3 — הפיילוט של נופי דורית.**

## 8. הפיילוט — נופי דורית

**PL1 — שבעת הביטויים כרעיונות (בלי מספרים, בעל העסק בוחר) + הרצה ראשונית עכשיו (✏️ טרנזקציה אחת, עם שער):**
```bash
# PL1
docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA -v ON_ERROR_STOP=1 < /root/backups/nuriel-shop/before-seo-engine/release/deploy/seo-engine/pilot.sql
```
**תקין:** `keyword ideas added|7`, `initial run queued|t`. **נעצר עם `gate:`** — שום דבר לא השתנה; שולחים את הפלט.

**PL2 — אחרי 4–5 דקות (🔍): המשימה, הבדיקה הטכנית, ההצעות שממתינות (שום דבר לא הוחל), הביטויים — ונופי דורית זהה:**
```bash
# PL2
B=/root/backups/nuriel-shop/before-seo-engine && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/pilot-check.sql && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/nofi-snapshot.sql | diff - $B/nofi-before.txt && echo "nofi-dorit unchanged: ok"
```
**תקין:** `job|initial|store|done|1|-`; שורת `audit` עם ציון; שורות `proposal|pending|template|…` — כ-11 (כותרת "על המקום", כותרת
ותיאור לגוגל ל-4 יחידות בלי טקסט כזה, וכותרת + תיאור לחבילת הכלה מהמילים שלכם); `applied by the engine (must be 0)|0`; 7 שורות
`phrase|…|owner|new|t`; `nofi-dorit unchanged: ok`. (אם `job … queued` — עוד לא רץ; מריצים שוב בעוד דקה-שתיים.)

**PL3 (✋):** בעל העסק (או אתם בשמו, באישורו) נכנס ל-`/manage/seo` ← בכל הצעה: **"עכשיו"**, ההצעה, **"למה"** ו**תצוגה בגוגל**
← אישור / עריכה / "לאחר כך" / ביטול. אחרי אישור — אפשר **"שחזור"** מהרשימה "החלטות אחרונות".

## 9. טביעות אצבע

| קובץ | sha256 |
| --- | --- |
| `supabase/migrations/20261122100000_seo_engine.sql` | `<SHA203>` |
| `supabase/migrations/20261122110000_hosp_seo_engine.sql` | `<SHA204>` |
| `supabase/rollbacks/20261122100000_seo_engine.down.sql` | `<SHA203DOWN>` |
| `supabase/rollbacks/20261122110000_hosp_seo_engine.down.sql` | `<SHA204DOWN>` |

## 10. Rollback (⛔ אישור לפני כל פעולה)

| תקלה | פעולה |
| --- | --- |
| עומס / משהו לא צפוי מהעבודה ברקע | **R0** — עצירת העובד בלבד (המסכים נשארים; שום נתון לא נמחק) |
| האתר לא עולה / `readyz` ≠ 200 / שגיאות | **R1** (האפליקציה; דקה). המסד נשאר 204 — הגרסה הקודמת עובדת מולו |
| בעיה במסד עצמו | R1, ואז R204 ← R203 (רק אם צריך) |
| סטייה כלשהי בנתוני נופי דורית / בחתימה | R1 + **דיווח לפני כל פעולה נוספת** (לא אמור לקרות — נבדק ב-M3) |

**R0 — עצירת העובד ברקע (✏️ `.env` + הפעלה מחדש):**
```bash
# R0
cd /root/nuriel-shop-git && (grep -q '^SEO_WORKER=' .env && sed -i 's/^SEO_WORKER=.*/SEO_WORKER=off/' .env || echo 'SEO_WORKER=off' >> .env) && docker compose up -d && sleep 45 && docker exec nuriel-shop-app printenv SEO_WORKER && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz
```
**תקין:** `off`; `readyz: 200`.

**R1 — האפליקציה בלבד:**
```bash
# R1
docker tag nuriel-shop-app-app:before-seo-engine nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz && docker image inspect nuriel-shop-app-app:latest --format '{{.Id}}' && cat /root/backups/nuriel-shop/before-seo-engine/image-id.txt
```
**תקין:** `healthy`; `readyz: 200`; שני ה-ID **זהים**.

**R204 — המסד (רק אחרי R1). קודם גיבוי של המצב הנוכחי, ואז הורדה + מחיקת הרישום בטרנזקציה אחת:**
```bash
# R204
B=/root/backups/nuriel-shop/before-seo-engine && f=20261122110000_hosp_seo_engine && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > $B/before-rollback-204.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < $B/before-rollback-204.dump && echo "<SHA204DOWN>  $B/release/supabase/rollbacks/$f.down.sql" | sha256sum -c --quiet - && [ "$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'")" = "1" ] && [ "$(tail -n 1 $B/release/supabase/rollbacks/$f.down.sql)" = "COMMIT;" ] && { sed '$d' $B/release/supabase/rollbacks/$f.down.sql; printf '%s\n' "DELETE FROM public._migrations_applied WHERE filename = '$f.sql';" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "$f rolled back + unregistered (one transaction)"
```
**נעצר עם `rollback stopped: …`** — ההגנה: יש עבודה של בעל עסק שתאבד (חבילה עם כותרת Google, הצעה לחבילה, הצעה ששוחזרה). שום
דבר לא השתנה. אחרי הפיילוט יש **הצעות פתוחות לחבילת הכלה** — הן חוסמות. אם כולן עדיין פתוחות (אף אחת לא אושרה) — R204a
מוחק רק אותן, ואז R204 שוב:
```bash
# R204a
printf '%s\n' "BEGIN;" "DO \$g\$ BEGIN IF EXISTS (SELECT 1 FROM hospitality.seo_proposals WHERE target_kind = 'package' AND status NOT IN ('pending', 'later', 'superseded')) THEN RAISE EXCEPTION 'stop: an owner already decided on a package proposal - nothing changed'; END IF; END \$g\$;" "DELETE FROM hospitality.seo_proposals WHERE target_kind = 'package';" "COMMIT;" | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "open package proposals removed"
```

**R203 — רק אחרי R204:**
```bash
# R203
B=/root/backups/nuriel-shop/before-seo-engine && f=20261122100000_seo_engine && echo "<SHA203DOWN>  $B/release/supabase/rollbacks/$f.down.sql" | sha256sum -c --quiet - && [ "$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FILTER (WHERE filename = '$f.sql') || '|' || count(*) FILTER (WHERE filename = '20261122110000_hosp_seo_engine.sql') FROM public._migrations_applied")" = "1|0" ] && [ "$(tail -n 1 $B/release/supabase/rollbacks/$f.down.sql)" = "COMMIT;" ] && { sed '$d' $B/release/supabase/rollbacks/$f.down.sql; printf '%s\n' "DELETE FROM public._migrations_applied WHERE filename = '$f.sql';" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "$f rolled back + unregistered (one transaction)"
```
**נעצר עם `rollback stopped: …`** — בעל עסק בחר ביטוי, שינה הגדרות SEO, חיבר / ייבא Search Console, אישר הצעה בחנות או מילא
כותרת Google לקטגוריה. שום דבר לא השתנה; מדווחים לפני כל פעולה. (שורות שהמנוע יצר — בדיקות, משימות, הצעות פתוחות, רעיונות
חדשים, כולל שבעת ביטויי הפיילוט — נמחקות עם ה-Rollback.)

**R-check (🔍):**
```bash
# RCHECK
docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied), to_regclass('public.seo_jobs') IS NULL, to_regprocedure('hospitality.seo_proposal_revert(uuid)') IS NULL, (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'packages' AND column_name LIKE 'seo%')"
```
**תקין אחרי R204 + R203:** `202|t|t|0`. **R3 — שחזור מלא מ-`db.dump`:** קיצון בלבד, באישור מפורש.

## 11. תנאי עצירה (כל אחד = להפסיק ולדווח)

P3 ≠ `202|0|t|t` · B1/B2 נכשלו · S2 לא בדיוק שתי מיגרציות / sha256 שונה · M1/M2 `gate:` או שגיאה · M3 ≠ `checks: ok` /
`customers' data unchanged: ok` / `nofi-dorit unchanged: ok` · `readyz` ≠ 200 · `seo worker started` ≠ 1 · אתר ≥ 500 ·
SM1 — כותרת או תיאור שהשתנו · PL2 — `applied by the engine` ≠ 0 או נופי דורית לא זהה · מישהו מבקש לדלג על שלב.

## 12. נבדק לפני המסירה

כל הפקודות של סעיפים 3–10 שאינן docker (P1, P3, B1, S1, S2, M1, M2, M3, PL1, PL2, R204a, R204, R203, R-check) הורצו **מילה במילה**
על מסד מקומי במצב של הייצור (202 מיגרציות רשומות + נתוני בדיקה + העתק של נופי דורית עם חבילת הכלה והג'קוזי) — רק החיבור והנתיבים
הוחלפו. התוצאות — ב-[`MORNING-REPORT.md`](MORNING-REPORT.md).

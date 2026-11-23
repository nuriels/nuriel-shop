# פריסה: מחיקה בטוחה של יחידה + "תקנו לי" במרכז ה-SEO (מיגרציה 205)

הגרסה: `541437c` (ענף `hospitality/unit-delete-seo-actions`, מעל `9ceae73` שרץ בשרת — fast-forward, בלי מיזוג). הקוד —
`a9746a2`; מעליו `9ce6f30` (רק בדיקה — בדיקה לא יציבה של Search Console) ו-`541437c` (שורת הרענון של ה-API,
`NOTIFY pgrst, 'reload schema'`, בסוף מיגרציה 205 ובקובץ הביטול שלה — כמו ב-202 עד 204).
כל פקודה עצמאית, נעצרת בשגיאה, ומדפיסה מה לבדוק. מריצים **אחת-אחת** ושולחים את הפלט.

## 1. מה נכנס

- **מחיקת יחידה מהרשימה:** כפתור "מחיקה" בכל כרטיס יחידה (בעל העסק / מנהל עסק בלבד), וחלון "האם למחוק?" שאומר מה יימחק יחד
  איתה — או למה אי אפשר ומה כן אפשר (להשבית / החבילה / "כל המתחם"). מחלון העריכה המהירה — קישור לעמוד היחידה המלא.
- **מיגרציה 205 (פונקציות בלבד — בלי טבלה ובלי שינוי בנתונים):** `unit_delete_preview` (קריאה בלבד); `unit_delete` נעצרת כשהיחידה
  היא היחידה של חבילה (קודם — החבילה נמחקה בשקט), מוציאה את היחידה מהחדרים הנוספים של חבילות, סוגרת הצעות SEO פתוחות שלה,
  ומחזירה את קובצי התמונות כדי שהשרת ימחק אותם מהדלי.
- **מרכז ה-SEO:** "/" שמפנה ל-"/stay" נספר עכשיו כעמוד אחד (בלי "כותרת זהה ב-2 עמודים" / "תיאור זהה" / "חסר במפת האתר" המדומים
  — בבדיקה החיה: 84 ← 98); כפתור "תקנו לי" ליד כל ממצא של כותרת / תיאור (הצעה ממתינה לאישור — שום דבר לא משתנה באתר בלי
  אישור); לכל ממצא — משפט פשוט למה זה חשוב, וממצאים טכניים של המערכת מסומנים "לא צריך לעשות כלום".

## 2. סדר ותאימות

מיגרציה ← אפליקציה. האפליקציה הנוכחית (`9ceae73`) עובדת עם 205 (היא מתעלמת ממה ש-`unit_delete` מחזירה), כך שבין M1 ל-A1
האתר עובד כרגיל. Rollback של האפליקציה בלבד (R1) בטוח גם כשהמיגרציה נשארת.

## 3. בדיקות מקדימות (🔍 קריאה בלבד)

**P1 — הקוד בשרת נקי, ואפשר להתקדם ל-`541437c` בלי מיזוג:**
```bash
# P1
cd /root/nuriel-shop-git && git status --short | wc -l && git log --oneline -1 && git fetch -q origin hospitality/unit-delete-seo-actions && git merge-base --is-ancestor HEAD 541437cfbc25e2a152db0de1dbb3ba4a1a6d88ec && echo "fast-forward ok"
```
**תקין:** `0`, השורה של `9ceae73`, `fast-forward ok`.

**P2 — הקונטיינרים, מקום פנוי, 204 מיגרציות ו-205 עוד לא:**
```bash
# P2
cd /root/nuriel-shop-git && docker compose ps --format '{{.Name}} {{.Status}}' && df -h / | tail -1 && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*), count(*) FILTER (WHERE filename = '20261123100000_hosp_unit_delete_safe.sql'), pg_get_function_result('hospitality.unit_delete(uuid)'::regprocedure), to_regprocedure('hospitality.unit_delete_preview(uuid)') IS NULL FROM public._migrations_applied"
```
**תקין:** `app` — `Up … (healthy)`; מקום פנוי; `204|0|boolean|t`.

## 4. גיבוי (✏️ רק `/root/backups/nuriel-shop/before-unit-delete` + תג ל-image; האתר לא מושפע)

**B1 — קובצי הגרסה, גיבוי המסד (ובדיקה שהוא נקרא עד הסוף), רשימת המיגרציות, checksum של נתוני הלקוחות, תמונת מצב של נופי
דורית, תג חזרה:**
```bash
# B1
B=/root/backups/nuriel-shop/before-unit-delete && mkdir -m 700 $B && mkdir $B/release && git -C /root/nuriel-shop-git archive 541437cfbc25e2a152db0de1dbb3ba4a1a6d88ec deploy/seo-engine supabase/migrations/20261123100000_hosp_unit_delete_safe.sql supabase/rollbacks/20261123100000_hosp_unit_delete_safe.down.sql | tar -x -C $B/release && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > $B/db.dump && docker exec -i nuriel-shop-db pg_restore -f /dev/null < $B/db.dump && echo "dump read to the end: ok" && sha256sum $B/db.dump | tee $B/db.dump.sha256 && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > $B/applied-before.txt && wc -l < $B/applied-before.txt && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/guard.sql | tee $B/guard-before.txt && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/nofi-snapshot.sql | tee $B/nofi-before.txt && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-unit-delete && docker image inspect nuriel-shop-app-app:before-unit-delete --format '{{.Id}}' | tee $B/image-id.txt
```
**תקין:** `dump read to the end: ok`; שורת sha256; `204`; checksum אחד (32 תווים); תמונת המצב של נופי דורית — החתימה
(`fingerprint` ו-`revision`), היחידות (כולל **צימר 6**), **חבילת הכלה**, **הג'קוזי — "רק בחדר מוריה"**, גרסאות האתר, המסמכים
החתומים, מספר ההזמנות; ID של image.

**B1b — הכותרות והתיאורים שגוגל רואה היום (הגרסה לא משנה אותם — נשווה אחרי ההפעלה):**
```bash
# B1b
B=/root/backups/nuriel-shop/before-unit-delete && for u in https://nofi-dorit.nuri1.fit/stay https://nofi-dorit.nuri1.fit/stay/units/%D7%9E%D7%95%D7%A8%D7%99%D7%94 https://nofi-dorit.nuri1.fit/stay/packages/%D7%97%D7%91%D7%99%D7%9C%D7%AA-%D7%94%D7%9B%D7%9C%D7%94-vip-%D7%A8%D7%92%D7%A2%D7%99%D7%9D-%D7%A9%D7%9C-%D7%A7%D7%A1%D7%9D-%D7%91%D7%A0%D7%95%D7%A4%D7%99-%D7%93%D7%95%D7%A8%D7%99%D7%AA https://nuriel-shop.nuri1.fit/; do printf '%s\n' "$u"; curl -s -m 20 "$u" | grep -aoE '<title>[^<]*</title>|<meta name="description" content="[^"]*"' | head -2; done | tee $B/titles-before.txt
```
**תקין:** לכל כתובת — שורת `<title>` ושורת `description`.

**B2 — הגיבוי משתחזר (✏️ מסד בדיקה נפרד שנוצר ונמחק):**
```bash
# B2
docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE IF EXISTS restore_check" -c "CREATE DATABASE restore_check" && docker exec -i nuriel-shop-db pg_restore -U postgres -d restore_check --no-owner --no-privileges < /root/backups/nuriel-shop/before-unit-delete/db.dump > /dev/null 2>&1; for d in postgres restore_check; do docker exec nuriel-shop-db psql -U postgres -d $d -tAc "SELECT (SELECT count(*) FROM public.tenants), (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public._migrations_applied), (SELECT count(*) FROM hospitality.units), (SELECT count(*) FROM hospitality.bookings)"; done; docker exec nuriel-shop-db psql -U postgres -q -c "DROP DATABASE restore_check" && echo "restore check: done"
```
**תקין:** שתי שורות **זהות**, ו-`restore check: done`.

⛔ **אישור 1** — רק אם P1–B2 תקינים.

## 5. קוד ו-image (✏️ `/root/nuriel-shop-git` + image חדש; **האתר ממשיך על הגרסה הנוכחית**)

**S1 — הקוד, ובדיוק מיגרציה אחת ממתינה עם טביעת האצבע הנכונה:**
```bash
# S1
cd /root/nuriel-shop-git && git merge -q --ff-only 541437cfbc25e2a152db0de1dbb3ba4a1a6d88ec && git log --oneline -1 && ls supabase/migrations/*.sql | xargs -n1 basename | LC_ALL=C sort | LC_ALL=C comm -23 - /root/backups/nuriel-shop/before-unit-delete/applied-before.txt && echo "f8a1b02126898048f196ca61b45cbb40dbc8eb2f101d83c4f7b1f847b12324d2  supabase/migrations/20261123100000_hosp_unit_delete_safe.sql" | sha256sum -c -
```
**תקין:** השורה של `541437c`; שורה אחת: `20261123100000_hosp_unit_delete_safe.sql`; `…: OK`.

**S2 — בנייה:**
```bash
# S2
cd /root/nuriel-shop-git && docker compose build && docker images nuriel-shop-app-app --format '{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'
```
**תקין:** `latest` עם ID **חדש**; `before-unit-delete` = ה-ID מ-B1.

⛔ **אישור 2 — מכאן משנים את המסד ומפעילים.** M1 ← M2 ← A1 ברצף.

## 6. המיגרציה (✏️ המסד — המיגרציה והרישום שלה בטרנזקציה אחת)

**M1 — 205:**
```bash
# M1
cd /root/nuriel-shop-git && f=20261123100000_hosp_unit_delete_safe && echo "f8a1b02126898048f196ca61b45cbb40dbc8eb2f101d83c4f7b1f847b12324d2  supabase/migrations/$f.sql" | sha256sum -c --quiet - && [ "$(tail -n 1 supabase/migrations/$f.sql)" = "COMMIT;" ] && { printf '%s\n' "DO \$g\$ BEGIN IF (SELECT count(*) FROM public._migrations_applied) <> 204 OR EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$f.sql') THEN RAISE EXCEPTION 'gate: expected 204 applied migrations and % not applied - nothing changed', '$f'; END IF; END \$g\$;"; sed '$d' supabase/migrations/$f.sql; printf '%s\n' "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql');" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && echo "$f applied + registered (one transaction)"
```
**תקין:** `20261123100000_hosp_unit_delete_safe applied + registered (one transaction)`.
**נעצר** (טביעת אצבע / `gate:` / שגיאת SQL) — שום דבר לא השתנה; האתר ממשיך כרגיל. לא ממשיכים; שולחים את הפלט.

**M2 — בדיקות אחרי (🔍): הפונקציות וההרשאות, 205 מיגרציות, ונתוני הלקוחות ונופי דורית זהים:**
```bash
# M2
B=/root/backups/nuriel-shop/before-unit-delete && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT pg_get_function_result('hospitality.unit_delete(uuid)'::regprocedure) = 'jsonb', to_regprocedure('hospitality.unit_delete_preview(uuid)') IS NOT NULL, has_function_privilege('authenticated', 'hospitality.unit_delete_preview(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'hospitality.unit_delete_preview(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'hospitality.unit_delete(uuid)', 'EXECUTE'), NOT has_function_privilege('authenticated', 'hospitality._unit_delete_block(uuid,uuid)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)" && [ "$(docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/guard.sql)" = "$(cat $B/guard-before.txt)" ] && echo "customers' data unchanged: ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -q -tA < $B/release/deploy/seo-engine/nofi-snapshot.sql | diff - $B/nofi-before.txt && echo "nofi-dorit unchanged: ok"
```
**תקין:** `t|t|t|t|205`, `customers' data unchanged: ok`, `nofi-dorit unchanged: ok`.
(אם רק ה-checksum שונה — ייתכן שאורח הזמין / בעל עסק שינה משהו בדקות האלה. לא ממשיכים; שולחים את הפלט ונבדוק.)

## 7. הפעלה ובדיקות עשן

**A1 — הגרסה החדשה (✏️ שניות עד דקה):**
```bash
# A1
cd /root/nuriel-shop-git && docker compose up -d && sleep 60 && docker compose ps --format '{{.Name}} {{.Status}}' && curl -s -o /dev/null -w 'healthz: %{http_code}\n' http://127.0.0.1:3700/healthz && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz && docker inspect -f 'health: {{.State.Health.Status}}' nuriel-shop-app && echo "seo worker started: $(docker logs --since 3m nuriel-shop-app 2>&1 | grep -c '\[seo\] worker started')"
```
**תקין:** `app` — `Up … (healthy)`; `healthz: 200`; `readyz: 200`; `health: healthy`; `seo worker started: 1`.
**אחרת — R1 מיד.**

**A2 — הלוג (🔍):**
```bash
# A2
docker logs --since 10m nuriel-shop-app 2>&1 | grep -ciE 'error|unhandled'; docker logs --since 10m nuriel-shop-app 2>&1 | grep -E '\[seo\]' | tail -3
```
**תקין:** 0 או מספר קטן ומוסבר; שורת `[seo] worker started …`.

**SM1 — האתרים עונים, והכותרות והתיאורים בגוגל לא השתנו (🔍):**
```bash
# SM1
B=/root/backups/nuriel-shop/before-unit-delete && for u in https://nuriel-shop.nuri1.fit https://nofi-dorit.nuri1.fit https://nuriel-app2.nuri1.fit; do curl -s -L -o /dev/null -w "$u -> %{http_code}\n" "$u/"; done && for u in https://nofi-dorit.nuri1.fit/stay https://nofi-dorit.nuri1.fit/stay/units/%D7%9E%D7%95%D7%A8%D7%99%D7%94 https://nofi-dorit.nuri1.fit/stay/packages/%D7%97%D7%91%D7%99%D7%9C%D7%AA-%D7%94%D7%9B%D7%9C%D7%94-vip-%D7%A8%D7%92%D7%A2%D7%99%D7%9D-%D7%A9%D7%9C-%D7%A7%D7%A1%D7%9D-%D7%91%D7%A0%D7%95%D7%A4%D7%99-%D7%93%D7%95%D7%A8%D7%99%D7%AA https://nuriel-shop.nuri1.fit/; do printf '%s\n' "$u"; curl -s -m 20 "$u" | grep -aoE '<title>[^<]*</title>|<meta name="description" content="[^"]*"' | head -2; done | diff - $B/titles-before.txt && echo "titles and descriptions unchanged: ok"
```
**תקין:** `200` לשלושה; `titles and descriptions unchanged: ok`.

**SM2 (✋ דפדפן, כבעל העסק בנופי דורית):**
1. **"יחידות ומתחמים"** — בכל כרטיס יש כפתור **"מחיקה"**. לוחצים על "מחיקה" ב-**צימר 6**:
   - החלון כותב **"למחוק את "צימר 6" לצמיתות?"** ומה יימחק איתו — אם באמת נפתח בטעות: **"מחיקה לצמיתות"** ← "היחידה "צימר 6" נמחקה".
   - אם החלון כותב **"אי אפשר למחוק"** — הוא מסביר למה (הזמנה / חסימה / חבילה / "כל המתחם") ומציע מה כן: **"להשבית במקום"** מסתיר
     את היחידה מהאתר ומההזמנות. שולחים צילום מסך ונחליט יחד.
2. **"SEO וגוגל"** ← **"לבדוק עכשיו"**, ואחרי 2–4 דקות מרעננים: הממצאים המדומים של "/" (כותרת / תיאור זהים, "חסר במפת האתר")
   **לא מופיעים**. ליד הממצאים של חבילת הכלה — **"תקנו לי"**: נוצרת הצעה **ממתינה** ברשימה למטה (המסך קופץ אליה) —
   מאשרים / עורכים / דוחים. שום דבר לא משתנה באתר בלי האישור.

## 8. טביעות אצבע

| קובץ | sha256 |
|---|---|
| `supabase/migrations/20261123100000_hosp_unit_delete_safe.sql` | `f8a1b02126898048f196ca61b45cbb40dbc8eb2f101d83c4f7b1f847b12324d2` |
| `supabase/rollbacks/20261123100000_hosp_unit_delete_safe.down.sql` | `83bb645cb7723ad7a7c736ab6fc9c0a7f0537ac0d0213a7bb078ac81230afc54` |

## 9. Rollback (⛔ אישור לפני כל פעולה)

**R1 — האפליקציה חוזרת לגרסה הקודמת (מספיק כמעט תמיד — הגרסה הקודמת עובדת גם עם מיגרציה 205):**
```bash
# R1
cd /root/nuriel-shop-git && docker tag nuriel-shop-app-app:before-unit-delete nuriel-shop-app-app:latest && docker compose up -d && sleep 60 && docker compose ps --format '{{.Name}} {{.Status}}' && curl -s -o /dev/null -w 'healthz: %{http_code}\n' http://127.0.0.1:3700/healthz && curl -s -w ' -> readyz: %{http_code}\n' http://127.0.0.1:3700/readyz
```
**תקין:** `healthy`, `200`, `200`.

**R2 — המסד (רק אחרי R1, ורק אם צריך): הפונקציות חוזרות לגרסה של מיגרציה 10, והרישום נמחק — בטרנזקציה אחת:**
```bash
# R2
B=/root/backups/nuriel-shop/before-unit-delete && f=20261123100000_hosp_unit_delete_safe && echo "83bb645cb7723ad7a7c736ab6fc9c0a7f0537ac0d0213a7bb078ac81230afc54  $B/release/supabase/rollbacks/$f.down.sql" | sha256sum -c --quiet - && [ "$(tail -n 1 $B/release/supabase/rollbacks/$f.down.sql)" = "COMMIT;" ] && { printf '%s\n' "DO \$g\$ BEGIN IF (SELECT count(*) FROM public._migrations_applied) <> 205 OR NOT EXISTS (SELECT 1 FROM public._migrations_applied WHERE filename = '$f.sql') THEN RAISE EXCEPTION 'gate: expected 205 applied migrations including % - nothing changed', '$f'; END IF; END \$g\$;"; sed '$d' $B/release/supabase/rollbacks/$f.down.sql; printf '%s\n' "DELETE FROM public._migrations_applied WHERE filename = '$f.sql';" "COMMIT;"; } | docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*), pg_get_function_result('hospitality.unit_delete(uuid)'::regprocedure), to_regprocedure('hospitality.unit_delete_preview(uuid)') IS NULL FROM public._migrations_applied"
```
**תקין:** `204|boolean|t`. **נעצר** (`gate:` / שגיאה) — שום דבר לא השתנה.

**חשוב:** יחידה שנמחקה — נמחקה (כמו כל מחיקה). Rollback לא מחזיר אותה; רק שחזור מלא מהגיבוי, שמחזיר גם את כל מה שהשתנה
מאז (הזמנות וכו') — לא עושים בלי לבדוק יחד.

## 10. תנאי עצירה

- P1–P2 לא כמו "תקין" · B1 בלי `dump read to the end: ok` · B2 עם שורות שונות.
- S1: יותר ממיגרציה אחת ממתינה / טביעת אצבע שונה · S2: שגיאת בנייה.
- M1: `gate:` / שגיאה · M2: לא `t|t|t|t|205` / נתונים שונים.
- A1: לא `healthy` / לא `200` — R1 מיד.

## 11. נבדק לפני המסירה

- בדיקות יחידה: 1490/1490 (106 קבצים) — כולל: "/" שמפנה ל-"/stay" (4 בדיקות שנכשלות על הקוד הישן ועוברות על החדש), "תקנו לי"
  מול מסד ודגם מדומים (תבנית בחינם; הצעה שכבר ממתינה; NURIEL AI רק לעסק זכאי; עמוד שנמחק; לא מנהל של העסק).
- SQL: 3612/3612 ×3 (נקי, שוב, עם נתונים) — כולל `hospitality-unit-delete.test.sql` (18 בדיקות: הרשאות, חלון ההסבר, חבילה,
  חדרים נוספים, הצעות SEO, קבצים, יומן, עסק אחר).
- Rollback: 307 בדיקות — המבנה אחרי Rollback של 205 = בדיוק המבנה של 204; כל השרשרת חזרה והוחלה מחדש — זהה.
- מקביליות (49/49, כולל מחיקה מול חסימה באותו רגע), שומרי Rollback (31/31), חבילת הכלה (17/17).
- E2E מקומי (Supabase מקומי + השרת הבנוי): `manage-unit-delete.spec.ts` חדש (5), "תקנו לי" ב-`seo-engine.spec.ts`, וכל מסכי
  היחידות במחשב ובטלפון — 61 עברו.
- בדיקה חיה (קריאה בלבד) של nofi-dorit.nuri1.fit עם הקוד החדש: ציון 98 (במקום 84), 8 עמודים (במקום 9 — "/" ו-"/stay" עמוד אחד).
- **חזרה גנרלית של המסמך הזה** (מקומית, Postgres 16 במצב של השרת: 204 מיגרציות + `_migrations_applied` + נתוני בדיקה): השורות
  של P2, B1, B2, S1, M1, M2 ו-R2 נלקחו מהמסמך עצמו ורצו כמו שהן (רק `docker exec nuriel-shop-db` הופנה למסד המקומי). הפלטים:
  `204|0|boolean|t` · `dump read to the end: ok` · שתי שורות זהות + `restore check: done` · שורה אחת ממתינה + `OK` ·
  `… applied + registered (one transaction)` · `t|t|t|t|205` + `customers' data unchanged: ok` + `nofi-dorit unchanged: ok` ·
  `204|boolean|t`. M1 בפעם השנייה ו-R2 בפעם השנייה — נעצרו ב-`gate:` בלי לשנות כלום; M1 אחרי R2 — הוחל שוב נקי.
- בדיקה לא יציבה שנמצאה ב-CI (ריצה 200, לא קשורה לשינוי): "כרטיס החיבור ל-Search Console" — הבדיקה "זייפה" חתימה אקראית
  בהחלפת התו הראשון ב-x, ופעם ב-64 החתימה כבר התחילה ב-x. שוחזרה במכוון (חתימה שמתחילה ב-x — הבדיקה הישנה נכשלת) ותוקנה
  ב-`9ce6f30` (רק הבדיקה; הקוד לא השתנה).
- נמצא בבדיקה לפני הפריסה: מיגרציה 205 לא הסתיימה בבקשה מה-API לרענן את רשימת הפונקציות (`NOTIFY pgrst, 'reload schema'`),
  בשונה מ-202 עד 204. השרת מריץ מיגרציות כשה-API עובד, ובלי רענון חלון "האם למחוק?" עלול לא למצוא את הפונקציה החדשה עד
  שה-API מתרענן. בבדיקות המקומיות זה לא נראה — שם ה-API עולה אחרי המיגרציות. נוסף ב-`541437c` (למיגרציה ולקובץ הביטול), ואחריו
  כל בדיקות ה-SQL, ה-Rollback והחזרה הגנרלית רצו שוב.

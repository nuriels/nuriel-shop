# שחרור הצימרים: סרטון הפתיח, אירועים, חוזים, תיקון פרטי לקוח, מסמכים לחתימה ומדידה — פריסה לייצור

> **נפרס ב-10.11.2026** (BS → M66 → M67 → M68 → M69 → M70 → U, כל אחת באישור): `applied: 181` → `186`, `build ok`,
> `documents: 1 events: 1 store: 1`, כל בדיקות המיגרציות תקינות (הדגל של החוזים כבוי), `running the new image`, `local: 200`,
> יומן נקי. אחרי (מהסשן): נופי דורית, עמוד יחידה, sitemap, robots, החנות והפורטל — 200; תגית האימות של Google במקומה;
> אין קוד Google Analytics.
>
> **(לפני הפריסה):** אף פקודה כאן לא הורצה בשרת. כל שלב מסומן ⛔ — מריצים רק אחרי אישור מפורש, פקודה אחת בכל פעם,
> ושולחים את הפלט לפני הפקודה הבאה. מה נכנס ולמה — `release-events-contracts.md`.

**הקוד:** `538f336` בענף `hospitality/release` — המשך ישיר של מה שרץ בייצור (`0206a99`, שחרור החנויות): העבודה על
הצימרים מוזגה **מעל** גרסת החנויות, כך שתיקון הייבוא ומנהל הכפילויות נשארים.
**מיגרציות (5, כל אחת באישור נפרד, לפי הסדר):**

| #   | קובץ                                           | מה                                                                                       |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 66  | `20261111100000_hosp_hero_video_verified.sql`  | אורך סרטון הפתיח נמדד בשרת                                                               |
| 67  | `20261111110000_hosp_events.sql`               | אירועים במתחם (בלי לינה), תנאי העסק                                                      |
| 68  | `20261111120000_hosp_client_contracts.sql`     | חוזים לחתימה, הדלי הפרטי `hosp-contracts`, הדגל `hospitality_contracts_enabled` **כבוי** |
| 69  | `20261111130000_hosp_customer_details.sql`     | תיקון פרטי לקוח בהזמנה / באירוע ושליחה חוזרת                                             |
| 70  | `20261111140000_hosp_standalone_documents.sql` | מסמכים לחתימה בלי הזמנה, מסמכי מדיניות, "מסמכים חתומים" — באותו דגל כבוי                 |

(במסמכים הישנים — 62–65 ו-68; המספור כאן הוא הסדר בשרת, אחרי 64–65 של החנויות.)

**כבוי אחרי הפריסה:** החוזים והמסמכים לחתימה (הדגל `hospitality_contracts_enabled`, עד אישור משפטי של הנוסח);
המדידה (`hospitality_analytics_enabled`, בלי מזהה GA4) — בלי שום בקשה ל-Google. **פעיל:** אירועים במתחם, בדיקת
סרטון הפתיח, תיקון פרטי לקוח.

סימנים: 🔍 קריאה בלבד · ✏️ משנה · ⛔ עוצרים לאישור.

## בדיקות מקומיות (על `538f336`)

- Typecheck · Lint (הרשימה המחמירה של ה-CI) · Build: תקין. Unit: 1107/1107.
- SQL: 3077/3077 בשלושה מעברים (5 המיגרציות החדשות מוחלות פעמיים, גם על מסד עם נתונים).
- Rollback: 70 → 66 ואז 65 → 64 — אחרי כל אחת הסכמה זהה **בדיוק** לזו שלפניה; ההגנות עוצרות כשיש נתונים.
- E2E (החנויות + הצימרים יחד, מחשב): 71/71 — מסמכים לחתימה בשתי הדרכים, חוזים, אירועים, הסכמה ומדידה, מסמכי האתר, הייבוא החדש, מנהל הכפילויות, ניהול וחזית החנות, קטלוג, בידוד, סל, מנועים, ניתוב. Rollback: 224 בדיקות, כל הסכמה זהה אחרי החזרה והחלה מחדש.

---

## ⛔ אישור 1 — BS: גיבוי + קוד + בנייה (✏️ גיבוי, קבצים, image חדש; האתר ממשיך לרוץ על `0206a99`)

```bash
B=/root/backups/nuriel-shop/before-hosp-release && mkdir -m 700 "$B" && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > "$B/db.dump" && docker exec -i nuriel-shop-db pg_restore -f /dev/null < "$B/db.dump" && echo "dump read to the end: ok ($(du -h "$B/db.dump" | cut -f1))" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$B/applied-before.txt" && echo "applied: $(wc -l < "$B/applied-before.txt")" && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-hosp-release && echo "rollback image before-hosp-release: ok" && cd /root/nuriel-shop-git && test -z "$(git status --porcelain --untracked-files=no)" && git fetch -q origin "+refs/heads/hospitality/release:refs/remotes/origin/hospitality/release" && git merge-base --is-ancestor HEAD 538f336 && git merge-base --is-ancestor 538f336 origin/hospitality/release && echo "538f336: fast-forward, on origin" && git checkout -q -B hospitality/release 538f336 && git log --oneline -1 && cp supabase/rollbacks/20261111100000_hosp_hero_video_verified.down.sql supabase/rollbacks/20261111110000_hosp_events.down.sql supabase/rollbacks/20261111120000_hosp_client_contracts.down.sql supabase/rollbacks/20261111130000_hosp_customer_details.down.sql supabase/rollbacks/20261111140000_hosp_standalone_documents.down.sql "$B/" && docker compose build > "$B/build.log" 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo documents: \$(grep -rl contract_standalone_create /app/.output | wc -l) events: \$(grep -rl event_create /app/.output | wc -l) store: \$(grep -rl product_duplicate_groups /app/.output | wc -l)" || { echo "STOPPED"; tail -n 30 "$B/build.log" 2>/dev/null; }
```

**תקין:** `dump … ok`; `applied: 181`; `rollback image before-hosp-release: ok`; `538f336: fast-forward, on origin`; שורת
הקומיט; `build ok` (כמה דקות, בלי פלט בינתיים); `documents: … events: … store: …` — שלושה מספרים גדולים מ-0
(`store` — תיקון החנויות נשאר בגרסה).

## ⛔ אישורים 2–6 — M66…M70: המיגרציות, אחת בכל פעם (✏️ המסד)

כל פקודה: בודקת שהקוד הוא `538f336` ושמספר המיגרציות הוא בדיוק המצופה, מריצה את המיגרציה (`BEGIN … COMMIT` — כישלון לא
משאיר כלום), רושמת אותה ובודקת. הגרסה שרצה (`0206a99`) לא נוגעת בטבלאות / בפונקציות החדשות — האתר ממשיך כרגיל עד U.

**M66 — סרטון הפתיח** (לפני: 181 → אחרי: 182)

```bash
cd /root/nuriel-shop-git && f=20261111100000_hosp_hero_video_verified && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && [ "$n" = 181 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'media' AND column_name = 'duration_checked_at'), has_function_privilege('service_role', 'hospitality.media_video_verified(uuid,uuid,numeric,text)', 'EXECUTE'), has_function_privilege('authenticated', 'hospitality.media_video_verified(uuid,uuid,numeric,text)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|t|f|182" ] && echo "M66 checks ok" || echo "STOPPED"
```

**תקין:** `1|t|t|f|182` ואז `M66 checks ok`.

**M67 — אירועים במתחם** (182 → 183)

```bash
cd /root/nuriel-shop-git && f=20261111110000_hosp_events && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && [ "$n" = 182 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), to_regclass('hospitality.events') IS NOT NULL, has_table_privilege('authenticated', 'hospitality.events', 'SELECT'), EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'hospitality.events'::regclass AND contype = 'x'), has_function_privilege('authenticated', 'hospitality.event_create(jsonb)', 'EXECUTE'), (SELECT count(*) FROM hospitality.events), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|t|t|0|183" ] && echo "M67 checks ok" || echo "STOPPED"
```

**תקין:** `1|t|f|t|t|0|183` — הטבלה קיימת, סגורה לדפדפן, החפיפה נחסמת במסד, הצוות יוצר אירוע דרך הפונקציה; 0 אירועים.

**M68 — חוזים** (183 → 184)

```bash
cd /root/nuriel-shop-git && f=20261111120000_hosp_client_contracts && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && [ "$n" = 183 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), to_regclass('hospitality.client_contracts') IS NOT NULL, has_table_privilege('authenticated', 'hospitality.client_contracts', 'SELECT'), (SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_contracts_enabled'), EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'hosp-contracts' AND NOT public), (SELECT count(*) FROM hospitality.contract_templates WHERE key IN ('hosting', 'pool_event')), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|f|t|2|184" ] && echo "M68 checks ok" || echo "STOPPED"
```

**תקין:** `1|t|f|f|t|2|184` — הטבלה קיימת וסגורה לדפדפן; **הדגל כבוי**; הדלי הפרטי קיים ולא ציבורי; שתי התבניות.

**M69 — תיקון פרטי לקוח** (184 → 185)

```bash
cd /root/nuriel-shop-git && f=20261111130000_hosp_customer_details && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && [ "$n" = 184 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), has_function_privilege('authenticated', 'hospitality.booking_customer_update(uuid,integer,jsonb,text,boolean)', 'EXECUTE'), has_function_privilege('authenticated', 'hospitality._send_booking_details(uuid,uuid)', 'EXECUTE'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|185" ] && echo "M69 checks ok" || echo "STOPPED"
```

**תקין:** `1|t|f|185`.

**M70 — מסמכים לחתימה** (185 → 186)

```bash
cd /root/nuriel-shop-git && f=20261111140000_hosp_standalone_documents && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && [ "$n" = 185 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'client_contracts' AND column_name IN ('origin', 'fill_mode', 'staff_seen_at')), EXISTS (SELECT 1 FROM hospitality.contract_templates WHERE key = 'policy'), has_function_privilege('authenticated', 'hospitality.contract_link_shared(uuid,uuid,uuid)', 'EXECUTE'), (SELECT enabled FROM public.platform_feature_flags WHERE key = 'hospitality_contracts_enabled'), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|3|t|f|f|186" ] && echo "M70 checks ok" || echo "STOPPED"
```

**תקין:** `1|3|t|f|f|186` — שלוש העמודות החדשות, תבנית מסמך המדיניות, רישום הקישור לשרת בלבד, הדגל עדיין כבוי.

## ⛔ אישור 7 — U: הפעלה מחדש (✏️ זו הפריסה עצמה; בשעה שקטה)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = 538f336 ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:** `Started`; `(healthy)`; `running the new image`; `local: 200`; לוג ריק. תהליך הרקע מודד סרטוני פתיח ישנים בדקות
הראשונות (עד אז מוצגת התמונה הראשית).

## V — בדיקות אחרי

1. **(אני, קריאה בלבד):** נופי דורית, החנות והפורטל — 200; sitemap; תגית Google; אין קוד Google Analytics; החנות
   עדיין עם הייבוא החדש ומנהל הכפילויות.
2. **(את/ה, בניהול של נופי דורית):** `/manage/events` נפתח; "מסמכי לקוחות" מציג "ממתינים לאישור משפטי" (הדגל כבוי);
   סרטון הפתיח מוצג.

---

## ✅ הפעלת "מסמכי לקוחות" לנופי דורית בלבד — בוצע 10.11.2026

`hospitality_contracts_enabled` = דגל הפלטפורמה **וגם** הדגל של האתר (`platform_feature_enabled`); אתר בלי שורה משלו —
כבוי. לכן הודלקו שניהם, בטרנזקציה אחת עם בדיקה שאף אתר אחר לא מקבל את התכונה (אחרת `STOP` ו-ROLLBACK), ושתי שורות
ביומן (`platform_audit_log`, `via: server psql` — אין `auth.uid()` ב-psql, לכן לא `platform_set_flag`).

- **לפני:** אתר צימרים אחד (`nofi-dorit`); הדגל כבוי; אין שורות לאתרים; 2 מסמכי אתר פורסמו; "תנאים ופרטי החוזה" עוד
  לא אושרו (בלי האישור — רק מסמכי מדיניות, לא חוזה אירוח / אירוע).
- **אחרי:** `nofi-dorit documents switch : true`, `other sites with it on : 0`; 4 דפים 200 (`/stay`, `/stay/contract`,
  `/manage/login`, החנות); 2 שורות ביומן; 0 שגיאות. בלי קוד, בלי restart (מטמון הדגלים באפליקציה — 15 שניות).
- **כיבוי (רק אם צריך; ⛔ אישור):**

```bash
docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE public.tenant_feature_flags SET enabled = false, updated_at = now()
 WHERE key = 'hospitality_contracts_enabled' AND tenant_id = (SELECT id FROM public.tenants WHERE slug = 'nofi-dorit');
UPDATE public.platform_feature_flags SET enabled = false, updated_at = now() WHERE key = 'hospitality_contracts_enabled';
INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details) VALUES
  (NULL, NULL, 'feature_flag_set', '{"key":"hospitality_contracts_enabled","enabled":false,"scope":"platform","via":"server psql"}');
COMMIT;
SQL
```

מסמכים שכבר נשלחו / נחתמו נשמרים גם אחרי כיבוי (הקישורים שלא נחתמו מפסיקים לעבוד).

---

## Rollback (רק בתקלה; ⛔ אישור לפני כל פעולה)

**R1 — האפליקציה** (חוזרים ל-`0206a99`, שחרור החנויות):

```bash
docker tag nuriel-shop-app-app:before-hosp-release nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q -B ecommerce/store-release 0206a99 && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**המיגרציות יכולות להישאר** אחרי R1 — הגרסה הקודמת לא נוגעת בהן. **R2 (המסד)** — רק אם צריך, בסדר הפוך 70 → 66,
מקובצי ה-rollback שבתיקיית הגיבוי; כל אחד מסרב כשיש בו נתונים (מסמכים / חוזים / אירועים) — פקודות נפרדות, אכין לפי
המצב.

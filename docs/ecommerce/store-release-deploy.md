# החנויות: ייבוא שמזהה מוצרים קיימים + מנהל כפילויות — פריסה לייצור

> **לא נפרס.** אף פקודה כאן לא הורצה בשרת. כל שלב מסומן ⛔ — מריצים רק אחרי אישור מפורש, פקודה אחת בכל פעם,
> ושולחים את הפלט לפני הפקודה הבאה. (מחליף את `import-sync-deploy.md` — הייבוא לבד.)

**הקוד:** `0206a99` בענף `ecommerce/store-release` — מעל `6a8ce22` שבייצור (דרך `80ddb09`, שני קומיטים של מסמכים
בלבד): הייבוא החדש (`ecommerce/import-sync`) + מנהל הכפילויות (`ecommerce/product-duplicates`) + תיקון קטן בבדיקה
המוקדמת של הייבוא הישן (רק מול החנות הנוכחית).
**מיגרציות:** שתיים, כל אחת באישור נפרד —
`20261110220000_product_import_sync.sql` (64: שלוש טבלאות + פונקציות של הייבוא) ו-
`20261110230000_product_duplicates.sql` (65: שתי טבלאות + פונקציות של הכפילויות). שום טבלה קיימת לא משתנה;
`import_products` והקטלוג **לא משתנים**.
**ארבע פקודות:** גיבוי + קוד + בנייה (האתר לא מושפע) · מיגרציה 64 · מיגרציה 65 · הפעלה מחדש.

סימנים: 🔍 קריאה בלבד · ✏️ משנה · ⛔ עוצרים לאישור.

## מה נכנס

| שינוי                          | מה המנהל רואה                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **בדיקה מול החנות לפני ייבוא** | אחרי בחירת הקובץ: "בדיקה מול המוצרים בחנות" (קריאה בלבד). לכל שורה — מוצר חדש / כבר בחנות (לפי ברקוד → מק"ט → מק"ט של הספק שנשמר → שם) / כמה מוצרים מתאימים / לא תקין, וגם כפולים בתוך הקובץ |
| **בחירה חובה למוצרים קיימים**  | לעדכן כמות מלאי / מלאי ומחיר / לא לשנות. אין ברירת מחדל — בלי בחירה אין ייבוא. כמות 0 בקובץ = "אזל" (כמו בספירת מלאי)                                                                        |
| **מוצרים חדשים**               | להוסיף / לא להוסיף. מוצר חדש מקבל מק"ט פנימי, והמק"ט מהקובץ נשמר כמפתח — הייבוא הבא מזהה אותו                                                                                                |
| **מוצרים שבחנות ולא בקובץ**    | להשאיר (ברירת מחדל) / לאפס מלאי / להסתיר — עם המספר האמיתי ודוגמאות, ורק אחרי שכל הקובץ יובא                                                                                                 |
| **דוח שינויים**                | נוספו, עודכנו (לפני → אחרי), מלאי עלה / ירד / ירד ל-0, לא בקובץ, דולגו, לא בוצעו — בחלון ובקובץ CSV לאקסל                                                                                    |
| **ביטול יבוא**                 | מה שנוסף — נמחק (מוצר שכבר הוזמן — מוסתר); מה שעודכן / אופס / הוסתר — חוזר. ערך ששונה ידנית אחרי היבוא — לא נדרס. "יבואים אחרונים" בחלון הייבוא                                              |
| **מנהל כפילויות**              | כפתור "מוצרים כפולים" (עם מספר הקבוצות): קבוצות לפי שם / ברקוד / תמונה זהים; בוחרים מה נשאר ואיזו כמות (שלו / של אחר / סכום / מספר); השאר נמחקים — או מוסתרים (מוצר שהוזמן — תמיד מוסתר)     |
| **מה עובר למוצר שנשאר**        | ביקורות (אחת לכל לקוח), מוצרים קשורים, מחירים מיוחדים ללקוחות, מבצעי "מתנה בעגלה". כל מיזוג נרשם עם צילום מלא — אפשר לשחזר. "לא כפול" — הקבוצה לא מוצגת שוב                                  |
| **הצעות AI (תוסף NURIEL AI)**  | רק בחנות עם התוסף: הצעות לשמות שונים של אותו מוצר. רק שם / מק"ט / מחיר / קטגוריה, בלי מידע על לקוחות; ה-AI לא ממזג כלום; נספר בתקציב התוסף; 3 בדיקות ב-10 דקות                               |

**השרת לא סומך על הדפדפן:** לעולם לא נוצר מוצר כשיש כבר מוצר עם אותו ברקוד / מק"ט / מק"ט ספק; שם זהה — רק כשהמנהל
סימן "מוצר חדש"; עדכון — רק למוצר של החנות; "לא בקובץ" — רק אחרי שכל השורות טופלו ורק עד המספר שהמנהל ראה ואישר.
מוצר עם מספרים סידוריים — המלאי לא משתנה; מוצר דיגיטלי — לא מאופס ולא מוסתר; מחיר — רק כשלמוצר מחיר אחיד.
מיזוג — רק מוצרים של החנות, עד 20, נעילה בסדר קבוע (שני מיזוגים במקביל לא נתקעים), הכול או כלום.

**לא משתנה:** סריקת אתר מקור (משתמשת ב-`import_products` כמו קודם — רק הבדיקה המוקדמת שלה עכשיו מול החנות הנוכחית
בלבד), עריכת מוצר, הקטלוג באתר, ההזמנות, הכתובות, SEO, Hospitality.

## בדיקות מקומיות (על `0206a99`)

- Typecheck (אפליקציה + בדיקות): תקין · Lint (הרשימה המחמירה של ה-CI, כולל קובצי הייבוא והכפילויות): תקין · Build: תקין.
- Unit: 1028/1028.
- SQL: 2932/2932 בשלושה מעברים (מסד נקי ×2 + מסד עם נתונים; שתי המיגרציות החדשות מוחלות פעמיים) — כולל 73 של
  הייבוא ו-56 של הכפילויות (זיהוי, מיזוג בכל מצבי הכמות, מוצר שהוזמן מוסתר ולא נמחק, ביקורות עוברות, צילום
  ביומן, "לא כפול", חנות אחרת, מי שאינו מנהל, מגבלת 20).
- Rollback: 65 ואז 64 — אחרי כל אחת הסכמה זהה **בדיוק** לזו שלפניה; שתי ההגנות עוצרות כשיש נתונים; כל הסכמה זהה
  אחרי החזרה של הכול והחלה מחדש.
- E2E (Supabase מקומי עם שתי המיגרציות): מחשב — 63 עברו + 1 שרץ רק בטלפון (ייבוא אותו קובץ פעמיים בלי כפולים,
  מלאי כולל 0, דוח ו-CSV, ביטול; כפילויות: מיזוג, "לא כפול", AI כבוי / פעיל עם מודל מדומה; ויחד איתם ניהול, חזית
  החנות, קטלוג, בידוד בין חנויות, סל ותשלום, מנועים, ניתוב, עוזר ה-AI, SEO, התחברות, פלטפורמה); טלפון — 7/7.

---

## ⛔ אישור 1 — BS: גיבוי + קוד + בנייה (✏️ גיבוי, קבצים, image חדש; האתר ממשיך לרוץ על `6a8ce22`)

```bash
B=/root/backups/nuriel-shop/before-store-release && mkdir -m 700 "$B" && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > "$B/db.dump" && docker exec -i nuriel-shop-db pg_restore -f /dev/null < "$B/db.dump" && echo "dump read to the end: ok ($(du -h "$B/db.dump" | cut -f1))" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$B/applied-before.txt" && echo "applied: $(wc -l < "$B/applied-before.txt")" && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-store-release && echo "rollback image before-store-release: ok" && cd /root/nuriel-shop-git && test -z "$(git status --porcelain --untracked-files=no)" && git fetch -q origin "+refs/heads/ecommerce/store-release:refs/remotes/origin/ecommerce/store-release" && git merge-base --is-ancestor HEAD 0206a99 && git merge-base --is-ancestor 0206a99 origin/ecommerce/store-release && echo "0206a99: fast-forward, on origin" && git checkout -q -B ecommerce/store-release 0206a99 && git log --oneline -1 && cp supabase/rollbacks/20261110220000_product_import_sync.down.sql supabase/rollbacks/20261110230000_product_duplicates.down.sql "$B/" && docker compose build > "$B/build.log" 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo import-sync: \$(grep -rl product_import_match /app/.output | wc -l) duplicates: \$(grep -rl product_duplicate_groups /app/.output | wc -l)" || { echo "STOPPED"; tail -n 30 "$B/build.log" 2>/dev/null; }
```

**תקין:** `dump read to the end: ok (…)`; `applied: 179`; `rollback image before-store-release: ok`; `0206a99: fast-forward,
on origin`; שורת הקומיט; `build ok`; `import-sync: … duplicates: …` — שני מספרים גדולים מ-0.
**`STOPPED`** — עוצרים ושולחים לי את הפלט. האתר לא נפגע (הקונטיינר הרץ לא מתחלף עד U).
**אם `applied` אינו 179** — עוצרים; אעדכן את המספרים ב-M1 / M2.

## ⛔ אישור 2 — M1: מיגרציה 64, הייבוא (✏️ המסד; שלוש טבלאות + פונקציות חדשות)

```bash
cd /root/nuriel-shop-git && f=20261110220000_product_import_sync && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 0206a99 ] && [ "$n" = 179 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_imports'::regclass), has_table_privilege('authenticated', 'public.product_imports', 'SELECT'), has_function_privilege('authenticated', 'public.product_import_apply(uuid,jsonb)', 'EXECUTE'), has_function_privilege('anon', 'public.product_import_apply(uuid,jsonb)', 'EXECUTE'), (SELECT count(*) FROM public.product_imports), to_regprocedure('public.import_products(jsonb)') IS NOT NULL, (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|t|f|0|t|180" ] && echo "import-sync migration checks ok" || echo "STOPPED"
```

**תקין:** `code 0206a99, applied before: 179`; `20261110220000_product_import_sync ok`; `1|t|f|t|f|0|t|180` — לפי הסדר:
רשומה אחת; RLS על טבלת היבואים; הדפדפן **לא** קורא אותה ישירות; מנהל מחובר מפעיל את הייבוא (הבדיקה בפנים: מנהל
החנות בלבד); אורח **לא**; 0 יבואים; `import_products` הישנה במקומה; 180 מיגרציות. ואז `import-sync migration checks ok`.

## ⛔ אישור 3 — M2: מיגרציה 65, הכפילויות (✏️ המסד; שתי טבלאות + פונקציות חדשות)

```bash
cd /root/nuriel-shop-git && f=20261110230000_product_duplicates && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = 0206a99 ] && [ "$n" = 180 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_merges'::regclass), has_table_privilege('authenticated', 'public.product_merges', 'SELECT'), has_function_privilege('authenticated', 'public.product_merge(uuid,uuid[],text,uuid,integer,uuid[])', 'EXECUTE'), has_function_privilege('anon', 'public.product_duplicate_groups()', 'EXECUTE'), has_function_privilege('authenticated', 'public.product_duplicate_ai_candidates(uuid,text,integer)', 'EXECUTE'), (SELECT count(*) FROM public.product_merges), (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|t|f|f|0|181" ] && echo "duplicates migration checks ok" || echo "STOPPED"
```

**תקין:** `code 0206a99, applied before: 180`; `20261110230000_product_duplicates ok`; `1|t|f|t|f|f|0|181` — רשומה אחת;
RLS על יומן המיזוגים; הדפדפן **לא** קורא אותו ישירות; מנהל מחובר ממזג (הבדיקה בפנים: מנהל החנות בלבד); אורח **לא**
רואה קבוצות; רשימת ה-AI — לשרת בלבד; 0 מיזוגים; 181 מיגרציות. ואז `duplicates migration checks ok`.
**בטוח לפני ההפעלה מחדש (גם אחרי M1 בלבד):** הגרסה שרצה (`6a8ce22`) לא קוראת לטבלאות או לפונקציות החדשות.
`BEGIN … COMMIT` — כישלון לא משאיר כלום.

## ⛔ אישור 4 — U: הפעלה מחדש (✏️ זו הפריסה עצמה; בשעה שקטה)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = 0206a99 ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:** `Container nuriel-shop-app … Started`; `Up … (healthy)`; `running the new image`; `local: 200`; לוג ריק.

## V — בדיקות אחרי

1. **(אני, מהסשן, קריאה בלבד):** החנות והפורטל מול הצילום שלפני — `0 differences` (שום כתובת, title, sitemap או
   קוד Google לא השתנו).
2. **(את/ה, בפאנל הניהול — בלי לשנות):** מוצרים וקטגוריות → **ייבא מ-CSV** → אותו קובץ (`product_export (3).csv`)
   → **בדיקה מול המוצרים בחנות**. מצופה: כמעט הכול ב"כבר בחנות", 0 או מעט מאוד ב"מוצרים חדשים". **לא** לוחצים
   "ייבוא" — שולחים לי צילום של המסך, ונחליט יחד.
3. **(את/ה):** **מוצרים כפולים** — נפתח עם הקבוצות (למשל שני דגמי פעמון הדלת, שני העותקים המוסתרים לבדיקה מול
   המוצרים הדומים). לא ממזגים לפני שעוברים עליהן יחד.
4. **(אני, פקודה 🔍 אחת אחרי הייבוא הראשון שלך):** שורות `[product-import]` ביומן + המונים מ-`product_imports`.

---

## Rollback (רק בתקלה; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה (✏️; חוזרים ל-`6a8ce22`)

```bash
docker tag nuriel-shop-app-app:before-store-release nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q -B hospitality/seo 6a8ce22 && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `6a8ce22 …`; `(healthy)`; `local: 200`. חלון הייבוא חוזר לגרסה הקודמת, וכפתור הכפילויות נעלם. **המיגרציות
יכולות להישאר** — הגרסה הקודמת לא נוגעת בטבלאות החדשות.

### R2 — גם המסד (✏️; רק אחרי R1, ורק אם צריך) — 65 ואז 64

ה-rollback של 65 **מסרב** כשיש מיזוגים ביומן; של 64 — כשיש יבואים או מק"טים של ספקים. אם כבר היו — קודם מייצאים את
הטבלאות, ורק אחרי החלטה מרוקנים אותן (אישור נפרד).

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-store-release/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-store-release/20261110230000_product_duplicates.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110230000_product_duplicates.sql'" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-store-release/20261110220000_product_import_sync.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110220000_product_import_sync.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"
```

**תקין:** `backup ok`; `179`. (הודעת סירוב — ה-rollback עצר; מה שכבר הוחזר נשאר מוחזר, ושולחים לי את הפלט.)

---

## איך משתמשים (לבעל החנות)

**ייבוא:**

1. מוצרים וקטגוריות → **ייבא מ-CSV** → בוחרים קובץ (מאקסל: "CSV UTF-8").
2. **בדיקה מול המוצרים בחנות** — שום דבר לא משתנה בשלב הזה.
3. בוחרים: מה לעשות במוצרים שכבר בחנות (חובה), האם להוסיף מוצרים חדשים, ומה לעשות במוצרים שלא בקובץ. בשורות
   שמתאימות לכמה מוצרים — בוחרים לכל שורה (או "לדלג על כולן").
4. **ייבוא** → בסוף: דוח שינויים + "הורדת דוח (CSV)". טעות? **ביטול היבוא הזה** (גם אחר כך, מ"יבואים אחרונים").

**כפילויות:**

1. מוצרים וקטגוריות → **מוצרים כפולים**.
2. בכל קבוצה: איזה מוצר נשאר, איזו כמות תהיה לו, והאם להסתיר במקום למחוק → **מיזוג…** → אישור.
3. לא כפילות? **לא כפול** — הקבוצה לא תוצג שוב (אפשר להחזיר).
4. בחנות עם NURIEL AI — לשונית **הצעות AI**: הצעות בלבד, ממזגים רק באישור.

## הערות

- **סדר מול Hospitality:** `hospitality/documents` (מיגרציות 20261111…) נפרס בנפרד, אחרי השחרור הזה; התאריכים
  שלו מאוחרים יותר, כך שהסדר נשמר.
- **סל שמור** (`shared_carts` / `customer_carts`) שמכיל מוצר שנמחק במיזוג — כמו אחרי מחיקה רגילה של מוצר.
- **יומן:** כל פעולה כותבת שורת `[product-import]` / `[product-duplicates]` עם מזהה המשתמש והמונים — בלי פרטי מוצר
  ובלי פרטי לקוחות.

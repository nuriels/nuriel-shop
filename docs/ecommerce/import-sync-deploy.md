# ייבוא מוצרים שמזהה מוצרים קיימים (STORE-2): פריסה לייצור

> **לא נפרס.** אף פקודה כאן לא הורצה בשרת. כל שלב מסומן ⛔ — מריצים רק אחרי אישור מפורש, פקודה אחת בכל פעם,
> ושולחים את הפלט לפני הפקודה הבאה.

**הקוד:** `cc79c8f` בענף `ecommerce/import-sync` (מעל `6a8ce22` שבייצור, דרך `80ddb09`, שני קומיטים של מסמכים בלבד).
**מיגרציה:** אחת — `20261110220000_product_import_sync.sql` (מיגרציה 64): שלוש טבלאות חדשות ופונקציות חדשות.
`import_products` ושאר הקטלוג **לא משתנים**.
**שלוש פקודות, כל אחת אחרי אישור:** גיבוי + קוד + בנייה (האתר לא מושפע) · מיגרציה · הפעלה מחדש.

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

**השרת לא סומך על הדפדפן:** לעולם לא נוצר מוצר כשיש כבר מוצר עם אותו ברקוד / מק"ט / מק"ט ספק; שם זהה — רק כשהמנהל
סימן "מוצר חדש"; עדכון — רק למוצר של החנות; "לא בקובץ" — רק אחרי שכל השורות טופלו ורק עד המספר שהמנהל ראה ואישר.
מוצר עם מספרים סידוריים — המלאי לא משתנה; מוצר דיגיטלי — לא מאופס ולא מוסתר; מחיר — רק כשלמוצר מחיר אחיד.

**לא משתנה:** סריקת אתר מקור (משתמשת ב-`import_products` כמו קודם), עריכת מוצר, הקטלוג באתר, ההזמנות, הכתובות,
SEO, Hospitality.

## בדיקות מקומיות (על `cc79c8f`)

- Unit: 995/995 (מתוכן 18 חדשות) · Typecheck: תקין · Lint (הרשימה המחמירה של ה-CI, כולל קובצי הייבוא): תקין.
- SQL: 2877/2877 בשלושה מעברים (מסד נקי ×2 + מסד עם נתונים) — מתוכן 73 של הייבוא: ייבוא חוזר בלי כפולים (ברקוד,
  מק"ט, מק"ט ספק, שם), מלאי (גם 0) ו"אזל", מחיר אחיד / דרגות / מבצע שפג, מספרים סידוריים, להשאיר / לאפס / להסתיר,
  כמה מוצרים באותו שם, כפולים בקובץ, דוח, ביטול (כולל מוצר שהוזמן והתנגשות), מנהל אחר, סוכן, אורח, חנות אחרת.
- Rollback: אחרי החזרת מיגרציה 64 — הסכמה זהה **בדיוק** לשלב SEO 3–4; כל הסכמה זהה אחרי החזרה של הכול והחלה מחדש.
- E2E (Supabase מקומי): אותו קובץ פעמיים → אין כפולים, המלאי מתעדכן (כולל 0), הדוח וה-CSV נכונים, ביטול מחזיר
  ומוחק — מחשב וטלפון; axe על מסך הבדיקה ועל הדוח — 0 הפרות. יחד עם בדיקות החנות (ניהול, חזית החנות כולל צילום
  המסך, קטלוג, בידוד, סל, מנועים, ניתוב חנויות): 33/33; אחרי התיקון האחרון (`cc79c8f`): ייבוא + ניהול + חזית + קטלוג
  17/17, וטלפון 5/5 (כולל ההתחברויות).

---

## ⛔ אישור 1 — BS: גיבוי + קוד + בנייה (✏️ גיבוי, קבצים, image חדש; האתר ממשיך לרוץ על `6a8ce22`)

```bash
B=/root/backups/nuriel-shop/before-import-sync && mkdir -m 700 "$B" && docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > "$B/db.dump" && docker exec -i nuriel-shop-db pg_restore -f /dev/null < "$B/db.dump" && echo "dump read to the end: ok ($(du -h "$B/db.dump" | cut -f1))" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > "$B/applied-before.txt" && echo "applied: $(wc -l < "$B/applied-before.txt")" && docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-import-sync && echo "rollback image before-import-sync: ok" && cd /root/nuriel-shop-git && test -z "$(git status --porcelain --untracked-files=no)" && git fetch -q origin "+refs/heads/ecommerce/import-sync:refs/remotes/origin/ecommerce/import-sync" && git merge-base --is-ancestor HEAD cc79c8f && git merge-base --is-ancestor cc79c8f origin/ecommerce/import-sync && echo "cc79c8f: fast-forward, on origin" && git checkout -q -B ecommerce/import-sync cc79c8f && git log --oneline -1 && cp supabase/rollbacks/20261110220000_product_import_sync.down.sql "$B/" && docker compose build > "$B/build.log" 2>&1 && echo "build ok" && docker run --rm --entrypoint sh nuriel-shop-app-app:latest -c "echo import-sync: \$(grep -rl product_import_match /app/.output | wc -l)" || { echo "STOPPED"; tail -n 30 "$B/build.log" 2>/dev/null; }
```

**תקין:** `dump read to the end: ok (…)`; `applied: 179`; `rollback image before-import-sync: ok`; `cc79c8f: fast-forward,
on origin`; שורת הקומיט; `build ok`; `import-sync: …` — מספר גדול מ-0.
**`STOPPED`** — עוצרים ושולחים לי את הפלט. האתר לא נפגע (הקונטיינר הרץ לא מתחלף עד U).
**אם `applied` אינו 179** (נפרסה מאז מיגרציה אחרת, למשל של מנהל הכפילויות) — עוצרים; אעדכן את המספרים ב-M.

## ⛔ אישור 2 — M: המיגרציה (✏️ המסד; שלוש טבלאות + פונקציות חדשות; שום טבלה קיימת לא משתנה)

```bash
cd /root/nuriel-shop-git && f=20261110220000_product_import_sync && n=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied") && echo "code $(git rev-parse --short=7 HEAD), applied before: $n" && [ "$(git rev-parse --short=7 HEAD)" = cc79c8f ] && [ "$n" = 179 ] && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/$f.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "INSERT INTO public._migrations_applied (filename) VALUES ('$f.sql')" && echo "$f ok" && row=$(docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT (SELECT count(*) FROM public._migrations_applied WHERE filename = '$f.sql'), (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_imports'::regclass), has_table_privilege('authenticated', 'public.product_imports', 'SELECT'), has_function_privilege('authenticated', 'public.product_import_apply(uuid,jsonb)', 'EXECUTE'), has_function_privilege('anon', 'public.product_import_apply(uuid,jsonb)', 'EXECUTE'), (SELECT count(*) FROM public.product_imports), to_regprocedure('public.import_products(jsonb)') IS NOT NULL, (SELECT count(*) FROM public._migrations_applied)") && echo "$row" && [ "$row" = "1|t|f|t|f|0|t|180" ] && echo "import-sync migration checks ok" || echo "STOPPED"
```

**תקין:** `code cc79c8f, applied before: 179`; `20261110220000_product_import_sync ok`; `1|t|f|t|f|0|t|180` — לפי הסדר:
רשומה אחת; RLS על טבלת היבואים; מנהל **לא** קורא אותה ישירות מהדפדפן; מנהל מחובר כן מפעיל את הייבוא (הבדיקה
בפנים: מנהל החנות בלבד); אורח **לא**; 0 יבואים; `import_products` הישנה במקומה; 180 מיגרציות. ואז
`import-sync migration checks ok`.
**בטוח לפני ההפעלה מחדש:** הגרסה שרצה (`6a8ce22`) לא קוראת לטבלאות או לפונקציות החדשות. `BEGIN … COMMIT` — כישלון
לא משאיר כלום.

## ⛔ אישור 3 — U: הפעלה מחדש (✏️ זו הפריסה עצמה; בשעה שקטה, לא באמצע ייבוא של מנהל)

```bash
cd /root/nuriel-shop-git && [ "$(git rev-parse --short=7 HEAD)" = cc79c8f ] && docker compose up -d && sleep 60 && docker compose ps app && [ "$(docker inspect -f '{{.Image}}' nuriel-shop-app)" = "$(docker image inspect -f '{{.Id}}' nuriel-shop-app-app:latest)" ] && echo "running the new image" && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt && docker logs --since 2m nuriel-shop-app 2>&1 | grep -iE "error|fatal" | grep -v aborted | tail -20 || echo "STOPPED"
```

**תקין:** `Container nuriel-shop-app … Started`; `Up … (healthy)`; `running the new image`; `local: 200`; לוג ריק.

## V — בדיקות אחרי

1. **(אני, מהסשן, קריאה בלבד):** החנות והפורטל מול הצילום שלפני — `0 differences` (שום כתובת, title, sitemap או
   קוד Google לא השתנו).
2. **(את/ה, בפאנל הניהול — קריאה בלבד):** מוצרים וקטגוריות → **ייבא מ-CSV** → בוחרים את קובץ המלאי → **בדיקה מול
   המוצרים בחנות**. מצופה: המוצרים שכבר בחנות מופיעים ב"כבר בחנות" (ולא ב"מוצרים חדשים"). **לא** לוחצים "ייבוא" —
   שולחים לי צילום של המסך, ונחליט יחד.
3. **(אני, פקודה 🔍 אחת אחרי הייבוא הראשון שלך):** שורות `[product-import]` ביומן + המונים מ-`product_imports`.

---

## Rollback (רק בתקלה; ⛔ אישור לפני כל פעולה)

### R1 — האפליקציה (✏️; חוזרים ל-`6a8ce22`)

```bash
docker tag nuriel-shop-app-app:before-import-sync nuriel-shop-app-app:latest && cd /root/nuriel-shop-git && git checkout -q -B hospitality/seo 6a8ce22 && git log --oneline -1 && docker compose up -d && sleep 60 && docker compose ps app && curl -s -o /dev/null -w 'local: %{http_code}\n' http://127.0.0.1:3700/robots.txt
```

**תקין:** `6a8ce22 …`; `(healthy)`; `local: 200`. חלון הייבוא חוזר לגרסה הקודמת. **המיגרציה יכולה להישאר** — הגרסה
הקודמת לא נוגעת בטבלאות החדשות.

### R2 — גם המסד (✏️; רק אחרי R1, ורק אם צריך)

ה-rollback **מסרב** כשיש יבואים או מק"טים של ספקים שנשמרו (בלעדיהם אי אפשר לבטל יבוא ולזהות מוצרים לפי המק"ט של
הספק). אם כבר היו יבואים — קודם מייצאים את שלוש הטבלאות, ורק אחרי החלטה מרוקנים אותן (אישור נפרד).

```bash
docker exec nuriel-shop-db pg_dump -U postgres -d postgres -Fc > /root/backups/nuriel-shop/before-import-sync/before-rollback.dump && echo "backup ok" && docker exec -i nuriel-shop-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < /root/backups/nuriel-shop/before-import-sync/20261110220000_product_import_sync.down.sql && docker exec nuriel-shop-db psql -U postgres -d postgres -qc "DELETE FROM public._migrations_applied WHERE filename = '20261110220000_product_import_sync.sql'" && docker exec nuriel-shop-db psql -U postgres -d postgres -tAc "SELECT count(*) FROM public._migrations_applied"
```

**תקין:** `backup ok`; `179`. (`יש N שורות: …` — ה-rollback עצר; המסד לא השתנה.)

---

## איך משתמשים (לבעל החנות)

1. מוצרים וקטגוריות → **ייבא מ-CSV** → בוחרים קובץ (מאקסל: "CSV UTF-8").
2. **בדיקה מול המוצרים בחנות** — שום דבר לא משתנה בשלב הזה.
3. בוחרים: מה לעשות במוצרים שכבר בחנות (חובה), האם להוסיף מוצרים חדשים, ומה לעשות במוצרים שלא בקובץ. בשורות
   שמתאימות לכמה מוצרים — בוחרים לכל שורה (או "לדלג על כולן").
4. **ייבוא** → בסוף: דוח שינויים + "הורדת דוח (CSV)". טעות? **ביטול היבוא הזה** (גם אחר כך, מ"יבואים אחרונים").

## הערות

- **מיזוג עם ענפים אחרים:** `hospitality/documents` (מיגרציות 20261111…) ו-`ecommerce/product-duplicates` (מנהל
  הכפילויות) נוצרו מאותו בסיס. במיזוג: `rollback-check.sh` (מספור ה-`M`), `db-classification` (רשימות הטבלאות)
  ו-`src/integrations/supabase/types.ts` — לחבר את שני הצדדים; סדר המיגרציות לפי התאריך.
- **מחוץ להיקף, נמצא בדרך:** בייבוא הישן (`importCsvBatch` / סריקת אתר מקור) הבדיקה המוקדמת של ברקוד / מק"ט קיים
  (`rowsThatWillFail`) לא מסוננת לפי חנות — ברקוד שקיים **בחנות אחרת** גורם לדלג על הורדת התמונות של השורה (המוצר
  עצמו נוצר, בלי תמונות). חלון ה-CSV כבר לא משתמש בה; סריקת אתר מקור — כן. תיקון קטן נפרד.
- **יומן:** כל פעולה כותבת שורת `[product-import]` (`op`: match / begin / batch / finish / undo) עם מזהה המשתמש,
  היבוא והמונים — בלי פרטי מוצר.

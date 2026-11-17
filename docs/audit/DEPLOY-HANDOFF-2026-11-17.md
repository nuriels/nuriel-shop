# דוח מסירה לפריסה משולבת — שלושה ענפים: ביקורת + SEO של Hospitality + SSR של החנות (גרסה 2, 17.11.2026)

**נמען:** הקלוד שמרכז את הפריסה · **נכתב ע"י:** הקלוד של ענף הביקורת, לבקשת בעל המערכת.

> ### ⚠️ תיקון גרסה 2 — קרא קודם
> - **גרסה 1 של הדוח כללה שני ענפים בלבד. הענף השלישי, `claude/store-ssr-seo` (תיקון ה-SSR של החנות), לא נכלל בעץ שנבדק ולא הוזכר בדוח.** זו הייתה השמטה שלי: בדיקת הקצוות שלי הביאה (`git fetch`) רק שלושה ענפים בשמם (ביקורת, SEO, `main`) ולא סרקה את שאר הענפים ב-origin; הענף הזה הופיע שם בינתיים ונתגלה רק כשבעל המערכת שאל עליו.
> - **גרסה 2 תיקנה את זה:** סרקתי **את כל** ענפי ה-origin (סעיף 1.2); בניתי עץ שילוב של **שלושת** הענפים; הרצתי מחדש typecheck, lint, unit, build, **E2E מלא**, ו-**CI רשמי של GitHub** על הצירוף; בניתי **Docker image** והרצתי אותו. תוצאות: סעיף 3. **גרסה 1 (שני ענפים) מבוטלת — אל תסתמך עליה.**
> - **הגרסה הסופית שנבדקת (נכון לרגע הכתיבה):** ביקורת `4ec4d52` · SEO `42c2ccd` · SSR **`ed85789`** — כולם יחד ב-commit `c97a2c1` של ענף הבדיקה (קוד זהה בייט-לבייט, ללא `docs/`, לעץ `d6cd1cf` שנבדק מקומית וב-CI ריצה 191 — אומת). CI ריצה 192 על `c97a2c1` — סעיף 3.3.
> - **12 בדיקות ה-SEO שדווחו בגרסה 1 אינן בדיקות ה-SSR.** אלו בדיקות `e2e/tests/seo-proposals.spec.ts` של **הצעות ה-SEO ב-Hospitality** (11 בדיקות; 12 הרצות עם גרסת ה-mobile). בדיקות ה-SSR של החנות הן `e2e/tests/storefront-ssr.spec.ts` (6 בדיקות; 7 הרצות), ורצו לראשונה בגרסה 2.

> ### מצב
> - **לא בוצע Merge ל-`main`. לא בוצעה פריסה. לא שונה דבר בייצור. לא הורצה מיגרציה בייצור. לא נמחק אף ענף. לא נגעתי בנתוני לקוחות או בסודות.**
> - בעל המערכת **לא אישר** מיזוג, פריסה או הרצת מיגרציות. כל צעד בסעיפים 7–9 דורש אישור מפורש שלו, צעד אחר צעד.
> - **דבר אחד שעשיתי מחוץ לעץ מקומי, בעקבות בקשת בעל המערכת לקבל "תוצאות CI על הגרסה המשולבת":** יצרתי ב-origin ענף בדיקה **`integration/ci-audit-seo-ssr-2026-11-17`** (קצה `d6cd1cf`) והפעלתי עליו את ה-CI (`workflow_dispatch`). הוא **לא** `main`, **אין** עליו PR, והוא נועד לבדיקה בלבד. **לא מחקתי אותו** (כלל "אין מחיקת ענפים"); מחיקה — רק באישור בעל המערכת.
> - ה-worktree-ים המקומיים שבהם נבדק השילוב נמחקו; שום ענף קיים לא זז.

---

## 0. תקציר בשורות

| נושא | מצב |
| --- | --- |
| ענפים בגרסה הסופית | **3:** `audit/platform-review-2026-11` · `claude/ecstatic-euler-z7wmrg` (SEO) · `claude/store-ssr-seo` (SSR). פירוט commits: סעיף 1 |
| שילוב שלושתם | ✅ מתמזג; **התנגשות אמיתית אחת** — `scripts/db-tests/rollback-check.sh` (ביקורת ↔ SEO; קובץ בדיקה, לא קוד מוצר). ה-SSR לא מתנגש עם אף אחד. הפתרון: patch שנבדק |
| בדיקות מקומיות על הצירוף | ✅ typecheck (שני tsconfig) · lint 0 שגיאות · unit **99 קבצים / 1,402** · build · **E2E 396 עברו, 0 נכשלו, 14 דולגו בכוונה** |
| **CI רשמי על הצירוף** | ✅ **ריצה 191 על `d6cd1cf`: 4/4 jobs ירוקים בניסיון הראשון** (E2E: 392 עברו, 0 נכשלו, 18 דולגו). ✅ **ריצה 192 על `c97a2c1` (הקצוות הנוכחיים: ביקורת `4ec4d52` + SEO `42c2ccd` + SSR `ed85789`): 4/4 jobs ירוקים בניסיון הראשון** (E2E: 391 עברו, 0 נכשלו, 18 דולגו, **1 flaky** — `websites-efrat-preview`, ה-flake המוכר: נכשל בניסיון הראשון ועבר ב-retry האוטומטי) |
| Docker | ✅ image נבנה מהצירוף (388MB) ורץ; `/healthz` 200, `/readyz` 503 עם מסד מת ו-200 עם מסד חי; HTML של חנות עם H1, מוצרים ומחירים |
| מיגרציות | **2 חדשות:** #200 `20261118110000_order_guard`, #201 `20261118200000_hosp_seo_proposals`. **ה-SSR: אפס** |
| **אין דריסה של נתונים קיימים** (חתימת בעל העסק, תנאי נופי דורית, מסמך מדיניות חתום) | ✅ **הוכח מקומית** על מסד במצב ייצור (199 מיגרציות) עם נתונים: אחרי #200 ו-#201 וגם אחרי שני ה-rollback — **כל השורות זהות בייט-לבייט**; אף טבלה/עמודה/פונקציה של Hospitality לא השתנתה (סעיף 4.4). קוד החתימות/החוזים/המסמכים — ללא שינוי לעומת הייצור |
| אימות 777 האובייקטים מול השרת | ✅ **בוצע בייצור ע"י בעל המערכת (17.11.2026), קריאה בלבד — תקין:** `applied_total = 199`, `the_nine_recorded_of_9 = 9`, **אפס שורות MISSING/DIFFERENT**, ו-777/777 אובייקטים זהים (56·71·29·74·135·60·92·123·137). הגרסה הסופית של 9 המיגרציות ששונו היא זו שבמסד הייצור (סעיף 4.3) |
| המלצה | מיזוג: אפשר, באישור. **פריסה: לא לפני** (1) אישור בעל המערכת לכל צעד, (2) קריאת נפח הקטלוג לפי חנות והחלטה על ה-SSR לפי הספים ב-[`SSR-LARGE-STORES.md`](SSR-LARGE-STORES.md), (3) הרצה חוזרת של 777 ושער 0 סמוך לפריסה — רשימה מלאה בסעיף 12 |

---

## 1. הענפים וה-Commits המדויקים

### 1.1 מה נכלל בגרסה הסופית

בסיס משותף: **`eccd001`** = קוד הייצור (מיגרציות עד 199). (ענף הביקורת וענף ה-SEO מבוססים על `bd7771f` = `eccd001` + commit מסמך אחד; ענף ה-SSR מבוסס ישירות על `eccd001`.)

| | ענף הביקורת | ענף ה-SEO | ענף ה-SSR |
| --- | --- | --- | --- |
| שם | `audit/platform-review-2026-11` | `claude/ecstatic-euler-z7wmrg` | `claude/store-ssr-seo` |
| קצה ב-origin היום | **`7af068f`** | **`42c2ccd`** | **`ed85789`** |
| קצה שנבדק בצירוף | `7af068f` (ריצה 191) → **`4ec4d52`** (ריצה 192; מסמכים בלבד) | `42c2ccd` | `8117412` (ריצה 191 + מקומית) → **`ed85789`** (ריצה 192). ההפרש בין השניים: **שני קבצי מסמך בלבד**; אפס קבצי קוד שונו אחרי `1849878` |
| Commit אחרון **של קוד** | `ff0518b` (אחריו: מסמכים וסקריפטי קריאה-בלבד) | `f56bd32` (אחריו מסמכים) | **`1849878`** (אחריו מסמכים) |
| Commits מעל הבסיס | 27 (25 + 2 של מסמכי הדוח הזה) | 12 | 8 |
| מיגרציות | #200 | #201 | אין |
| CI של הענף לבדו | ריצה 185: ירוק (ניסיון 2) | ריצה 188: ירוק (ניסיון 2) | ריצה 190 על `1849878`: ירוק (ניסיון 2) |

**הצירוף שנבדק:** `d6cd1cf` על `integration/ci-audit-seo-ssr-2026-11-17` = `7af068f` + merge של `42c2ccd` (התנגשות `rollback-check.sh` מוכרעת לפי סעיף 5) + merge של `8117412`. **העץ הזה זהה בייט-לבייט לעץ שנבדק מקומית** (אומת: אותו tree hash).

**ה-Commits לפי ענף** (`git log --reverse <בסיס>..<קצה>`):

- **ביקורת (27), מעל `bd7771f`:** `0f35ed9` `15d2fa6` `87f583e` `5e4368e` `f03232f` `0647ba5` `2fd08b6` `d9cdb61` `3876b82` `11fcbfa` `241ed8c` `0cd6e12` `7b101e7` `c0615dd` `4206cee` `4e2aca2` `9663db1` `d62b16d` `e2626c9` `ff0518b` `8b1ba89` `3c2d3f7` `bba622a` `70ee6e2` `b87b6c4` `f7739a1` `7af068f`.
  מהם קוד: `0f35ed9`…`3876b82` (תיקוני ביקורת B-1…B-7, C-2, D-1), `c0615dd` (מיגרציה 200), `4206cee` (Grow), `4e2aca2` (rollback guards + healthcheck); השאר — מסמכים וסקריפטי בדיקה לקריאה בלבד.
- **SEO (12), מעל `bd7771f`:** `5b0d405` `9cc31ad` `621f341` `1b9f0a6` `962ae69` `28fdccb` `fdae052` `0e12a76` `f56bd32` `126ddde` `f6cab86` `42c2ccd`.
- **SSR (8), מעל `eccd001`:** `9cc1c68` (תיקון CI — **זהה** לתיקון `0f35ed9` של הביקורת) · `4ea505a` (SSR לבית/קטגוריה/מוצר/עמודי מידע) · **`ab4cd14`** (טעינת הנתונים בשרת רק באתרי חנות — `siteType === "ecommerce"`) · `c28770f` ("מוצרים נוספים" ב-HTML של עמוד המוצר) · `1849878` (תיאור בכרטיס — עד 200 תווים) · `e026d3c` `8117412` `ed85789` (מסמכים).

### 1.2 סריקת כל ענפי ה-origin (כדי שלא יישאר ענף בחוץ)

לכל ענף: כמה commits מעל קוד הייצור `eccd001`, והאם כבר כלול ב-`audit` (נבדק עם `git merge-base --is-ancestor`):

| ענף | מעל הייצור | מצב |
| --- | --- | --- |
| `audit/platform-review-2026-11` | 27 | **נכלל** |
| `claude/ecstatic-euler-z7wmrg` | 13 (12 + `bd7771f`) | **נכלל** |
| `claude/store-ssr-seo` | 8 | **נכלל** (חדש בגרסה 2) |
| `hospitality/tracking-settings` (`bd7771f`) | 1 | כלול כבר ב-`audit` (commit מסמך) |
| `ecommerce/store-identity` (`888731a`) | 2 | **לא נכלל — בכוונה** (החלטה מוקדמת: מיזוג הענף מתנגש; cherry-pick של `888731a` בלבד נבדק ללא התנגשות, ממתין להחלטת בעל המערכת). **אם הוא נדרש בפריסה — צריך לשלב ולבדוק מחדש** |
| ענפי חתימות / מסמכים: `hospitality/signing-mobile`, `hospitality/documents`, `billing/agreements` | 0 | **כבר בייצור** (אב-קדמון של `eccd001`) — **אין בהם שינוי שטרם הגיע לייצור**, ולכן אין מה לשלב. (הענף היחיד שמוסיף משהו הקשור לחתימות הוא ענף הביקורת, ורק כמסמך — `OWNER-SIGNATURE-CHECK.md`) |
| 15 ענפים נוספים (`main`, `hospitality/stage-0`, `stage-1`, `stage-2`, `release`, `seo`, `release/next`, `websites/engine`, `ecommerce/product-duplicates`, `store-release`, `import-sync`, `maintenance/email-auth-security`, `claude/dazzling-goldberg-ndjxc4`, `claude/funny-edison-ww9exu`, `claude/multi-tenant-part2`) | 0 | כבר בייצור (אב-קדמון של `eccd001`) — אין מה למזג |

> ⚠️ הסריקה נכונה **לרגע הכתיבה**. ענף חדש יכול להופיע — שער 0 (סעיף 8.0) סורק מחדש.

---

## 2. אילו שינויים כלולים

### 2.1 ענף הביקורת (27 commits; 68 קבצי קוד/מיגרציה/בדיקות)

**שלב 1 — ביקורת פלטפורמה (כל תיקון עם בדיקה שנכשלת לפניו):**
B-1 webhook של Grow מחזיר 500 (לא 200) כשסימון "שולם" נכשל · B-2 טופס פניות באתר לא תלוי בשעון המבקר · B-3/B-4 ייבוא iCal מתעלם מהזמנות מבוטלות ודוחה פיד קטוע · B-5 מחיקת חנות/עסק מוחקת גם קבצים מהדליים של Hospitality/Websites · B-6 PDF-ים ומייל איפוס מדפיסים שעון ישראל · B-7 `sendOrderEmails` מוגבל לפי הזמנה ומשתמש · C-2 `docker-compose` מעביר את משתני המפעיל שהקוד קורא · D-1 הוסרה התלות `xlsx` (לא בשימוש), `dompurify` 3.4.14→3.4.18 · תיקון typecheck ו-28 שגיאות פורמט ב-CI.

**שלב 2 — סגירת סיכונים (`PRE-MERGE-READINESS.md`):**
- **S-1 (מיגרציה 200):** `place_order` ישיר מוגן במסד — "אישור קופון" חד-פעמי שהשרת מנפיק ללקוח+קוד; הגבלת 30 הזמנות ל-10 דקות ו-300 ל-24 שעות ללקוח בעסק (עם נעילה, גם במקביל).
- **S-2 (חלקי) Grow:** בדיקת SQL לכשל באמצע סימון; התראה בפעמון כשהתשלום הגיע אחרי הפקיעה. **האימות מול הספק עצמו לא בוצע.**
- **B8 (R-3):** 21 קבצי rollback הוגנו (נעצרים ב"יש N שורות"), 10 חריגים מתועדים; בדיקת ארכיטקטורה שמונעת rollback הרסני בלי הגנה.
- **C1 (R-4):** `/healthz` (חיות, בלי מסד) ו-`/readyz` (מוכנות המסד); Dockerfile/compose על `/healthz` עם גיבוי ל-`/robots.txt`; `deploy/release-next.sh` בודק את שניהם.
- **P3 (R-5):** נמדד בלבד — **שום מדיניות RLS לא שונתה**.
- בדיקת חתימת בעל העסק (נופי דורית) — בקריאה בלבד: החתימה קיימת בייצור, ה-PDF קורא את השדה הנכון, הענף לא משנה שום קוד חתימות/חוזים (`OWNER-SIGNATURE-CHECK.md`).

**קבצי תשתית שקשורים לפריסה** (שני הענפים האחרים **לא** נוגעים בהם): `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy/release-next.sh`, `package.json` + `bun.lock` → **הפריסה כוללת בניית image מחדש עם `bun install`**.

**שינוי התנהגות:** לקוח **מחובר** שמחיל קופון — השרת מנפיק אישור (שעתיים, חד-פעמי) והוא נדרש בהזמנה; מוגבל ל-30 הזמנות/10 דק'. צוות החנות ונתיבי שרת פטורים.

### 2.2 ענף ה-SEO של Hospitality (12 commits; 42 קבצים)

- הצעות SEO ל-Hospitality (מיגרציה 201): תבניות חינמיות לכל עסק + כותב NURIEL AI (**טיוטה בלבד** — שום דבר לא נשמר באתר בלי אישור בעל העסק); מסך ביקורת/אישור; מגבלות קצב נפרדות (פתיחת רשימה 60/דקה, הפקה 10/דקה).
- ביטויי חיפוש בעברית לכל עסק (טיוטה), רשימת בדיקת SEO, שדות SEO ליחידה/תמונה.
- נופי דורית: Preview לתוכן SEO (לא נשמר באתר); חבילת כלה — אפיון + Preview + בדיקת זמינות, **לא מומשה כקוד מוצר**.
- אבחון SEO לקריאה בלבד: Nuriel Shop ו-NURIEL APP2 (**מסמכים בלבד**).
- כל קבצי `src/` שלו תחת `src/engines/hospitality/`; מחוץ לזה רק תשתית בדיקות (`tests.yml`, `scripts/db-tests/*`, `e2e/scripts/mock-services.mjs`, `tests/architecture/boundaries.test.ts`, `tests/unit/*`).
- ⚠️ `scripts/hospitality/seo-keywords-nofi-dorit.sql` הוא **סקריפט כתיבה לנתונים** (טיוטת ביטויי חיפוש לנופי דורית). **לא רץ ואסור שירוץ בייצור בלי אישור נפרד.** הפריסה והמיגרציה אינן מריצות אותו.

### 2.3 ענף ה-SSR של החנות (8 commits; 21 קבצי קוד/בדיקות; **אין מיגרציה**)

מה הוא עושה: עמודי החנות הציבוריים נבנים בשרת — גוגל מקבל HTML מלא (H1, מוצרים, מחירים, תמונות, תיאור) במקום גוף של 15 תווים. בטעינה הראשונה של עמוד חנות, ה-loader טוען בשרת, דרך הלקוח של השרת **המוגבל לחנות של הבקשה**, את מה שאורח רואה: `get_catalog` בלי משתמש (המחירון הרגיל), ההגדרות הציבוריות, הקטגוריות והבאנרים; הדפדפן ממשיך אחר כך **כמו קודם**, לפי מי שמחובר (מחיר אישי/דרג).

**מה מכוסה — אומת בעץ המשולב** (`ssr: true` + `getStorefrontSeed` בכל הנתיבים האלה): בית וקטגוריות (`src/routes/index.tsx`, קטגוריה = `?category=`), מוצר (`product.$productId.tsx`), עמודים סטטיים: אודות, צור קשר, תקנון, פרטיות, ביטול עסקה, מפת אתר, ועמודי תוכן (`pages.$slug.tsx`).

**בידוד — אומת בקוד:** ה-loader של הבית טוען את הנתונים רק אם `!site.isPortal && isServerRender() && context.hostMode.siteType === "ecommerce"`. כלומר: **נופי דורית (Hospitality), אתרי Websites ושער הפלטפורמה (NURIEL APP2) לא מושפעים** — ועוד: E2E של החנויות/הבידוד/הניתוב/Hospitality/Websites עבר בצירוף (סעיף 3).

**מה שהוא משנה בהתנהגות:** "הוספה לסל" לא מוסיפה במחיר של אורח עד שמחירי המחובר נטענו (עד אז: "רגע, טוענים את המחירים…"); במצב תחזוקה לא נשלחים מוצרים; כתובת קנונית לא שונתה. **כלל לשילוב:** מטמונים ברמת המודול (`useSiteSettings`, `useCategories`, `banners.ts`) משותפים לכל הבקשות בשרת — **אסור למלא אותם בשרת**; הענף לא ממלא אותם. קוד עתידי שיעשה זאת ידליף נתונים בין חנויות.

---

## 3. בדיקות — מה עבר ומה נכשל

### 3.1 כל ענף בנפרד (שדווח על הקצה של הקוד שלו)

| | ענף הביקורת (`ff0518b`) | ענף ה-SEO (`f56bd32`) | ענף ה-SSR (`1849878`) |
| --- | --- | --- | --- |
| CI רשמי | ריצה 185: ניסיון 1 E2E 372/1 (`websites-efrat-preview`); ניסיון 2 — **4/4 ירוקים** | ריצה 188: ניסיון 1 E2E 383/1 (אותה בדיקה); ניסיון 2 — **385/0, ירוק** | ריצה 190: ניסיון 1 E2E 379/1 (אותה בדיקה); ניסיון 2 — **ירוק, E2E 380/0** |
| Unit | 1,360 | 1,351 (CI) | 1,317 (CI) |
| SQL ×3 / Rollback | 3,462/3,462 · 289 שלבים | ✓ · 292 ok | 3,410/3,410 ×3 · ✓ |

### 3.2 על הצירוף של שלושת הענפים — מקומית (Docker + Postgres מקומיים; לא מול שום שרת אמיתי)

| בדיקה | תוצאה |
| --- | --- |
| Typecheck (אפליקציה **ו**-`tsconfig.test.json`) | ✅ exit 0 בשניהם |
| Lint (`eslint .`) | ✅ 0 שגיאות · 43 אזהרות (41 קיימות + 2 `react-refresh` בקובץ ה-SSR החדש) |
| Unit + ארכיטקטורה | ✅ **99 קבצים · 1,402 בדיקות** (= 98/1,398 של ביקורת+SEO + 4 בדיקות SSR) |
| E2E מלא — Playwright desktop+mobile, Supabase מקומי עם **כל 201 המיגרציות**, אפליקציה שנבנתה מהצירוף | ✅ **396 עברו · 14 דולגו בכוונה · 0 נכשלו** (22.5 דק'). כולל: **12/12 בדיקות ה-SEO**, **7/7 בדיקות ה-SSR** (HTML בלי JavaScript, עמודי מידע, בידוד בין חנויות, מצב תחזוקה, הידרציה בלי שגיאות + CLS, הוספה לסל, לקוח בדרג מחיר), ו-`websites-efrat-preview` (ה-flaky המוכר) שעבר. 14 הדילוגים: 13 בדיקות `@mobile` שמדולגות ב-desktop לפי עיצוב + Google OAuth (דורש רשת) |
| SQL (3 מעברים), `seo-proposals-rollback`, `rollback-check` המלא (292 שלבים, 2,125 CREATE הושוו), `rollback-guards` (31), concurrency (49/8/24/20), בדיקת הכלה (11) | ✅ **תוצאות מהצירוף הקודם (ביקורת+SEO) תקפות לצירוף הנוכחי:** ענף ה-SSR **לא נוגע** בשום קובץ ב-`supabase/`, `scripts/`, `.github/`, `Dockerfile`, `docker-compose.yml`, `package.json`, `bun.lock` או `deploy/` — אומת ב-`git diff` בין שני העצים: **ריק** (בייט-לבייט). ובנוסף — **כולם רצו שוב ב-CI** (סעיף 3.3) |

### 3.3 CI רשמי של GitHub על הצירוף — ריצה 191 (`workflow_dispatch` על `integration/ci-audit-seo-ssr-2026-11-17`, commit `d6cd1cf`)

[actions/runs/44129176407](https://github.com/nuriels/nuriel-shop/actions/runs/44129176407) — **ניסיון 1, `conclusion: success`, 4/4 jobs ירוקים, בלי הרצה חוזרת:**

| Job | תוצאה |
| --- | --- |
| typecheck · lint · unit · build | ✅ (typecheck אפליקציה+בדיקות, lint קפדני, lint כל הריפו, unit, legacy checks, build) |
| SQL tests (Postgres 16) | ✅ כל הצעדים: בדיקות SQL, **SEO proposals rollback**, **migration rollback check** (כל המיגרציות), **rollback data guards**, concurrency של הזמנות / רישיונות / AI / **order guard** |
| E2E regression | ✅ **392 עברו · 18 דולגו · 0 נכשלו** (18.9 דק'). (18 ולא 14: ב-CI חסרה תיקיית התמונות הלא-מגויטת `.cache/efrat-faithful`, ולכן 4 בדיקות של Efrat מוגדרות לדלג; בריצה המקומית היא הייתה זמינה והן עברו) |
| Hospitality preview | ✅ |

**ריצה 192** — [actions/runs/44134982979](https://github.com/nuriels/nuriel-shop/actions/runs/44134982979), commit `c97a2c1` = **הקצוות הנוכחיים של שלושת הענפים** (ביקורת `4ec4d52`, SEO `42c2ccd`, SSR **`ed85789`**); הקוד זהה בייט-לבייט (ללא `docs/`) ל-`d6cd1cf` של ריצה 191. **ניסיון 1, `conclusion: success`, 4/4 jobs ירוקים:** typecheck·lint·unit·build ✅ · SQL (כולל SEO rollback, rollback check מלא, rollback guards, 4 סקריפטי concurrency) ✅ · Hospitality preview ✅ · E2E ✅ — **391 עברו · 18 דולגו · 0 נכשלו · 1 flaky** (18.8 דק'). ה-flaky: `websites-efrat-preview.spec.ts:60` (desktop) — **ה-flake המוכר** (סעיף 3.5); נכשל בניסיון הראשון ועבר ב-retry האוטומטי של ה-CI. לא נגרם משינוי: הוא רץ על אתר Websites, שה-SSR והצעות ה-SEO לא נוגעים בו, ונכשל בעבר גם על ענפים בנפרד.

### 3.4 Docker — בנייה והרצה של ה-image מהצירוף

| בדיקה | תוצאה |
| --- | --- |
| `docker build` (ה-`Dockerfile` של הריפו, ללא שינוי; `bun install --frozen-lockfile` + `bun run build` + שלב ה-runtime) | ✅ נבנה, **388MB**. הערת סביבה: בניסיון הראשון `bun install` נכשל על `SELF_SIGNED_CERT_IN_CHAIN` — ה-sandbox מעביר HTTPS דרך proxy עם CA משלו; **לא בעיה בקוד או ב-lockfile**. נפתר בלי לגעת ב-Dockerfile: base image זמני שמכיל את ה-CA (`--build-context`) |
| הרצה עם **מסד שלא נגיש** | ✅ `GET /healthz` → **200**; `GET /readyz` → **503** `{"status":"not_ready","db":"down"}`; `GET /robots.txt` (הבדיקה הישנה) → **500** — כלומר הבדיקה הישנה הייתה מורידה את הקונטיינר, והחדשה לא; `docker inspect` Health = **healthy** |
| הרצה מול Supabase מקומי עם 201 מיגרציות | ✅ `/readyz` → 200 `{"status":"ready","db":"up"}`; HTML של דף הבית של חנות (בלי JavaScript): **H1 "סוכנות המשקאות"**, קטגוריות, מוצרים עם מחיר ₪; `/about` ו-`/terms` — H1 ותוכן (1,856 / 6,160 תווים נראים); דף הפלטפורמה (APP2) — 307 כמו קודם |

**לא נבדק ב-Docker:** `docker compose up` עם ה-`.env` האמיתי של השרת, ערכי `VITE_*` אמיתיים (השתמשתי בערכי דמה ציבוריים), nginx/SSL של הייצור. הבנייה הראשונה עם הסביבה האמיתית תהיה בשרת.

### 3.5 כשלים וחריגים ידועים (לא מוסתרים)

1. **`websites-efrat-preview` — flaky**, נכשל לסירוגין בשלושת הענפים לפני הצירוף (ריצות 185/186/188/190-ניסיון-1); שוחזר גם על גרסה שלפני הביקורת → **לא נגרם משינויי אף ענף**. סיבה לא הוכחה (השערה: מטמון חנות-לפי-דומיין של 15 שנ'). בצירוף: ריצה 191 — עבר; מקומית — עבר פעמיים; **ריצה 192 — נכשל בניסיון הראשון ועבר ב-retry האוטומטי** (1 flaky). כלומר הוא עדיין חי ולא תוקן. לא דולג, לא שונה.
2. **אין E2E של קופה של לקוח מחובר עם קופון** (נתיב חדש של מיגרציה 200) — כיסוי SQL + concurrency; בדיקת עשן ידנית אחרי פריסה (8.5).
3. לא נבדקו: Grow / Resend / Anthropic / Supabase אמיתיים; עומס על תשתית ייצור; כותב ה-SEO מול דגם אמיתי (עולה כסף).

---

## 4. מיגרציות — מה נדרש, באיזה סדר, ושמות הקבצים

### 4.1 הרשימה המדויקת

הייצור ב-**199**. הסדר ב-`supabase/migrations/` (מיון שמות הקבצים) של הצירוף, 7 האחרונות:

| # | קובץ | מצב | `M` ב-`rollback-check.sh` | ענף |
| --- | --- | --- | --- | --- |
| 195 | `20261116110000_bp_site_fonts.sql` | בייצור | — | — |
| 196 | `20261116120000_bp_inquiries.sql` | בייצור | — | — |
| 197 | `20261117090000_bp_site_address.sql` | בייצור | — | — |
| 198 | `20261117100000_bp_owner_invites.sql` | בייצור | `M82` | — |
| 199 | `20261118100000_site_tracking_ga4.sql` | בייצור (האחרונה) | `M83` | — |
| **200** | **`20261118110000_order_guard.sql`** | **חדשה — להריץ ראשונה** | `M84` | ביקורת |
| **201** | **`20261118200000_hosp_seo_proposals.sql`** | **חדשה — להריץ שנייה** | `M85` | SEO |

שני קבצי ה-rollback: `supabase/rollbacks/20261118110000_order_guard.down.sql` ו-`supabase/rollbacks/20261118200000_hosp_seo_proposals.down.sql`. **ענף ה-SSR: אין מיגרציה ואין rollback של מסד.**

| # | מה עושה | נתוני לקוח |
| --- | --- | --- |
| **200** | טבלה חדשה `coupon_grants` (RLS, בלי גישה ל-`anon`/`authenticated`); הגדרה מחדש של `check_coupon` (VOLATILE) ו-`orders_apply_coupon`; **טריגר חדש `orders_a_rate_guard` על `public.orders`**. rollback: משחזר את הפונקציות של מיגרציה 55 מילה במילה, מוחק רק את `coupon_grants` ואת הטריגר | **לא נוגע** בהזמנות/קופונים/מלאי (נבדק עם נתונים) |
| **201** | **אובייקטים חדשים בלבד** בסכמת `hospitality`: טבלאות `seo_runs`, `seo_proposals` (+ אינדקס, RLS בשתי מדיניות מגבילות, טריגר `tenant_guard`), 6 פונקציות ציבוריות + 6 עזר. **אינה משנה שום אובייקט קיים.** rollback: **נעצר** אם יש הצעות שמורות; אחרת מוחק רק את החדש | טבלאות חדשות וריקות |

### 4.2 סדר ההרצה

1. **200** `20261118110000_order_guard.sql` — קודמת לפי חותמת הזמן ולפי `M84`.
2. **201** `20261118200000_hosp_seo_proposals.sql` — `M85`.

אין תלות SQL הדדית ביניהן (3 מעברי SQL ו-rollback+החלה חוזרת עברו על הצירוף בסדר הזה). לכל מיגרציה בייצור: `psql -v ON_ERROR_STOP=1 -f <file>` → `INSERT INTO public._migrations_applied (filename) VALUES ('<file>')` → `NOTIFY pgrst, 'reload schema'` (ל-201 חובה — הפונקציות החדשות נחשפות דרך PostgREST).

### 4.3 אימות 777 האובייקטים מול השרת — **בוצע ע"י בעל המערכת: תקין**

> ### ✅ תוצאה מהשרת (17.11.2026, קריאה בלבד, הורץ מ-`/root/nuriel-shop-git`)
> - `applied_total = 199` · `the_nine_recorded_of_9 = 9`.
> - הסעיף `2. MISSING or DIFFERENT` — **ריק**.
> - `3. summary`: כל 9 המיגרציות `identical = total`, `missing=0 different=0` — 08→56, 21→71, 23→29, 33→74, 61→135, 64→60, 67→92, 68→123, 73→137 (**777/777**).
> - **משמעות:** הגרסה הסופית של `hosp_settings_team`, `hosp_site_design`, `hosp_payments`, `hosp_support`, `ai_assistant`, `product_import_sync`, `hosp_events`, `hosp_client_contracts` ו-`billing_agreements` היא זו שבמסד הייצור; אין סטייה בין הייצור ל-199 המיגרציות שבענף.
> - **תופעת לוואי בשרת:** `git fetch` יצר שם את ה-ref‏ `origin/audit/platform-review-2026-11`. לא הוחלף ענף ולא שונו קבצי עבודה — אין השפעה על הקוד שרץ.
> - הבדיקה מציגה את מצב הייצור **ברגע הריצה**. אם עוברים ימים או מתבצעת פעולה בשרת עד הפריסה — להריץ שוב (אותה פקודה; בשער 1 בסעיף 7.3).

מה שנבדק ומה הפקודה (להרצה חוזרת):

אין לי גישה לשרת הייצור (אין SSH, ובעל המערכת מריץ כל פקודה). מה שיש:

- **סקריפט קריאה-בלבד** `scripts/audit/prod-migration-fingerprint.sql` (+ `gen-migration-fingerprint.py`): בודק 777 אובייקטים של 9 המיגרציות ששונו אחרי שנוספו (`hosp_settings_team`, `hosp_site_design`, `hosp_payments`, `hosp_support`, `ai_assistant`, `product_import_sync`, `hosp_events`, `hosp_client_contracts`, `billing_agreements`) — שהגרסה **הסופית** שלהן היא זו שבמסד. מדפיס **רק** שמות אובייקטים וספירות, **לעולם לא נתוני לקוח**; שתי שכבות קריאה-בלבד (`BEGIN READ ONLY` + `default_transaction_read_only=on`); בלי `CREATE` אפילו זמני.
- **נבדק מקומית** מול מסד ייחוס (נבנה מהמיגרציות ≤199, לא מהייצור): 777/777 זהים; בדיקת מוטציות — 3 סטיות שהוזרקו זוהו; הרצה חוזרת היום עם אותם דגלים כמו בפקודה למטה הפיקה בדיוק את הפלט שמתואר כאן.
- **ראיות לא-מקוונות (אינן הוכחה):** ה-commit האחרון ששינה כל אחד מ-9 הקבצים הוא אב-קדמון של `eccd001` (9/9). לא מוכיח שהקובץ הסופי הוא שרץ בפועל.

**הפקודה** (אחת; בעל המערכת מריץ בשרת; **לא** מחליפה קוד ולא נוגעת בעץ העבודה):

```bash
git fetch origin audit/platform-review-2026-11 && git show origin/audit/platform-review-2026-11:scripts/audit/prod-migration-fingerprint.sql | docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' nuriel-shop-db psql -U postgres -d postgres -X -q
```

**תקין:** הסעיף `2. MISSING or DIFFERENT` **ללא שורות**; `1.` מציג `applied_total = 199` ו-`the_nine_recorded_of_9 = 9`; ב-`3. summary` לכל מיגרציה `identical = total`: 8→56, 21→71, 23→29, 33→74, 61→135, 64→60, 67→92, 68→123, 73→137 (סה"כ 777). **כל תוצאה אחרת = עצירה מוחלטת ודיווח.** לא לתקן "בדרך".

### 4.4 אין דריסה של נתונים קיימים — חתימת בעל העסק, תנאי נופי דורית, מסמכים

**א. סריקה סטטית של שלושת הענפים מול קוד הייצור (`eccd001`):**
- **מיגרציות:** רק שתיים חדשות. **#200** נוגעת ב-`coupon_grants` (חדשה), `check_coupon`, `orders_apply_coupon` והטריגר `orders_a_rate_guard` על `orders`. **#201** — שתי טבלאות חדשות בסכמת `hospitality` ופונקציות חדשות. **אף אחת לא מזכירה** `business_terms`, `representative_signature`, חוזים, מסמכי לקוח, מסמכי אתר או הסכמה (חיפוש טקסט בקבצים ובקבצי ה-rollback שלהן).
- **קוד חתימות/חוזים:** `src/engines/hospitality/contracts/**` ו-`management/client-documents/**` — **ללא שינוי** לעומת הייצור. (בענף ה-SEO נוסף רק קובץ `api/seo-proposals.functions.ts`.)
- **קבצים שהשם שלהם מזכיר PDF/תנאים:** `src/lib/pdf/document.server.ts` (ביקורת B-6 — פורמט תאריך בשעון ישראל ב-PDF של **הזמנות Ecommerce**; את ה-PDF של חוזי Hospitality הוא לא מפיק); `src/routes/terms.tsx` (ה-SSR — **תקנון החנות** ב-Ecommerce, קריאה בלבד); `src/engines/hospitality/website/design/schema.ts` (ה-SEO — שדה ביטויי חיפוש). אף אחד אינו כותב ל-`business_terms` או לחתימה.
- 22 קבצי rollback ישנים שונו ע"י הביקורת (הגנות נתונים, R-3) — **הם לא רצים בפריסה**, ורק מוסיפים עצירה לפני מחיקת נתונים.

**ב. הוכחה על נתונים — `scripts/audit/data-survival-check.sh` (מקומי, על מסד scratch בלבד; אפס נגיעה בייצור):**
מסד במצב הייצור (199 מיגרציות) + נתוני דמה: **חתימת בעל עסק** (2 מסלולים ב-`business_terms.representative_signature`, גרסה 4), תנאי העסק, **מסמך מדיניות חתום #1002** עם חתימה ו-PDF, מסמך אתר מפורסם (`site_terms` גרסה 2). הבדיקה מחשבת טביעת אצבע (ספירה + md5 של כל השורות) ל-12 טבלאות — `business_terms`, `client_contracts`, `client_contract_log`, `contract_templates`, `site_documents`, `site_document_versions`, `consent_records`, `booking_document_acceptances`, `site_settings`, `tenants`, `orders`, `coupons` — לפני ואחרי. (מוזרעות בדמה: `business_terms`, `client_contracts`, `site_documents`, `site_settings`, `tenants`; השאר ריקות במסד הדמה — לגביהן נבדק שלא נוצרו שורות.)

| שלב | תוצאה |
| --- | --- |
| אחרי **#200 ואז #201** | ✅ כל 12 הטביעות **זהות** (החתימה: 2 מסלולים; תנאים: גרסה 4; מדיניות #1002 חתומה; תנאי האתר v2) |
| הגדרות טבלאות | ✅ אף טבלה/עמודה קיימת לא השתנתה (חדשות בלבד: `hospitality.seo_runs`, `hospitality.seo_proposals`, `public.coupon_grants`) |
| גופי פונקציות | ✅ מתוך 1,105 פונקציות בסכמות המוצר, **שתיים בלבד** הוגדרו מחדש: `public.check_coupon` ו-`public.orders_apply_coupon` (#200). **אפס** פונקציות ב-`hospitality` / `business_profile` / `billing` — בפרט `business_terms_save`, `contract_for_pdf` והחתימה לא שונו |
| אחרי **rollback של #201 ואז #200** | ✅ הנתונים, הגדרות הטבלאות וגופי הפונקציות **זהים למצב הייצור** |

**הבדיקה עצמה נבדקה (מוטציות):** מיגרציה #201 "מקולקלת" שמאפסת את חתימת בעל העסק, מוסיפה עמודה ל-`site_documents` ומגדירה מחדש פונקציה ב-`hospitality` — **נכשלה בכל שלוש** (שינוי נתונים, שינוי עמודות, שינוי פונקציה, ושוב אחרי rollback). על המיגרציות האמיתיות — `PASS`.
**גבולות:** הבדיקה מוכיחה שהמיגרציות לא נוגעות בנתונים; היא לא מחליפה את אימות 777 בייצור (סעיף 4.3) ולא בודקת נתוני ייצור אמיתיים. אחרי הפריסה, בבדיקת העשן: PDF חוזה של נופי דורית עם חתימת בעל העסק (8.5).

---

## 5. קבצים שעלולים להתנגש

### 5.1 מטריצת זוגות (קבצים ששני ענפים שינו מול הבסיס)

| זוג | קבצים משותפים | התנגשות? |
| --- | --- | --- |
| ביקורת ↔ SEO | `scripts/db-tests/rollback-check.sh`, `.github/workflows/tests.yml`, `tests/unit/deploy-websites-efrat.test.ts` | ✅ **אמיתית אחת:** `rollback-check.sh`. `tests.yml` מתמזג אוטומטית (שלושת הצעדים החדשים נשמרים); `deploy-websites-efrat.test.ts` זהה בשניהם |
| ביקורת ↔ SSR | `tests/unit/deploy-websites-efrat.test.ts` בלבד | ❌ אותו blob (`79bf77f`) |
| SEO ↔ SSR | `tests/unit/deploy-websites-efrat.test.ts` בלבד | ❌ אותו blob |
| **שלושתם** | — | התנגשות אחת בלבד: `rollback-check.sh` (ביקורת↔SEO). ה-SSR לא נוגע בקובץ |

### 5.2 פתרון `rollback-check.sh`

1. `M84=20261118110000_order_guard` (ביקורת) ו-`M85=20261118200000_hosp_seo_proposals` (SEO) — בשורות נפרדות.
2. גוש ה-rollback של SEO **ראשון** (החדשה ביותר): `ref_upto "$M85"` → `down "$M85"` → `same_as_ref "migration 84"`; אחריו הגוש של `order_guard` כפי שהוא (`$M84`, `same_as_ref "migration 83"`).
3. אזור ההחלה מחדש: `up "$M84"` ואחריו (מאוחר יותר) `up "$M85"` — שני `up "$M84"` כפולים הם באג שקט שאינו התנגשות טקסט.
4. ספירת טבלאות Hospitality אחרי rollback: 53→55 (שינוי של ענף ה-SEO; מתמזג נקי).

**כ-patch מדויק:** [`integration/rollback-check.sh.audit-to-integrated.patch`](integration/rollback-check.sh.audit-to-integrated.patch) — הדיף בין `rollback-check.sh` של ענף הביקורת לקובץ שעבר את כל הבדיקות; `git apply --check` נקי. **תקף כל עוד אף אחד משני הענפים לא שינה את הקובץ**; אחרת — הכרעה ידנית לפי 4 הסעיפים.

### 5.3 נקודות חמות לעתיד (שינוי בהן בענף שעדיין עובד יחזיר התנגשות)

קבצי תשתית: `package.json` + `bun.lock` · `Dockerfile` · `docker-compose.yml` · `.env.example` · `deploy/release-next.sh` · `.github/workflows/tests.yml` · `scripts/db-tests/rollback-check.sh` (**כל מיגרציה חדשה → מספר `M86`, גוש rollback ראשון, חותמת זמן אחרי `20261118200000`**).

**קבצי חנות/SEO שה-SSR שינה — חשוב במיוחד לעבודת SEO נוספת על Nuriel Shop ו-NURIEL APP2:** `src/routes/index.tsx` · `product.$productId.tsx` · `pages.$slug.tsx` · `about.tsx` · `contact.tsx` · `terms.tsx` · `privacy.tsx` · `cancellations.tsx` · `sitemap.tsx` · `src/lib/site.ts` · `src/lib/banners.ts` · `src/lib/rich-text.ts` · `src/components/legal/RichContent.tsx` · `src/hooks/useSiteSettings.ts` · `src/hooks/useCategories.ts` · `src/lib/storefront-seed*.{ts,tsx}`. אם עבודת ה-SEO של החנות/APP2 נוגעת באחד מהם — **שער 0 + שילוב מחדש.**

---

## 6. תלות בין שלושת הענפים

| סוג | ממצא |
| --- | --- |
| **קוד** | **אין.** אין קובץ מוצר ששני ענפים שינו. SEO נוגע רק ב-`src/engines/hospitality/**`; SSR רק בקבצי החנות הציבוריים שלמעלה; ביקורת בקבצים אחרים (+ תשתית) |
| **מסד** | אין הפניה הדדית בין 200 ל-201; ה-SSR לא משנה מסד. הצירוף עבר SQL ×3 + rollback + החלה חוזרת + concurrency, גם ב-CI |
| **סדר מיגרציות** | **כן:** 200 לפני 201 (חותמת זמן + `M84`/`M85`) |
| **אפליקציה ↔ מסד (SEO)** | מסך הצעות ה-SEO קורא ל-`hospitality.seo_*` — דורש את 201 לפני שהאפליקציה מוצגת; בלעדיה — שגיאה במסך ה-SEO בלבד |
| **אפליקציה ↔ מסד (ביקורת)** | הקוד החדש לא דורש אובייקט מסד חדש; עובד מול 199 וגם מול 200. מסד 200 עובד גם מול הקוד הישן → "מסד קודם, אפליקציה אחר כך" בטוח, וגם החזרת האפליקציה לבדה |
| **אפליקציה ↔ מסד (SSR)** | אין תלות — קורא `get_catalog` וטבלאות קיימות. עובד מול 199, 200 ו-201 |
| **CI** | `rollback-check.sh` חייב את הפתרון שבסעיף 5; בלעדיו ה-CI של הצירוף ייכשל |

---

## 7. סדר מומלץ למיזוג ולפריסה

### 7.1 תנאים מקדימים (כולם)

1. **אישור מפורש של בעל המערכת** לכל צעד. (כרגע: **אין אישור למיזוג, פריסה או מיגרציות.**)
2. ✅ **אימות 777 האובייקטים בייצור — בוצע (סעיף 4.3), תקין.** להריץ שוב סמוך לפריסה אם עבר זמן.
3. **קריאת נפח הקטלוג לפי חנות** (שאילתה מתוקנת — סעיף 8.1 ג; ניתוח: [`SSR-LARGE-STORES.md`](SSR-LARGE-STORES.md)) והחלטת בעל המערכת על ה-SSR: כמו שהוא (כל החנויות ≤ ~1,000) / קודם שער+מטמון / פריסה של ביקורת+SEO בלבד.
4. **הקפאה:** אין commits חדשים לשלושת הענפים עד סוף המיזוג; אם זז קוד — שער 0.
5. גיבוי DB + תג image (8.2). 6. **Grow:** לא להפעיל בעסקים נוספים.

### 7.2 סדר המיזוג (Git) — ביקורת → SEO → SSR

למה כך: הביקורת הגדולה והמוקדמת בחותמות זמן ועם שינויי התשתית; ה-SEO מתנגש רק איתה (ופתרון ידוע); ה-SSR לא מתנגש עם אף אחד ולכן אחרון ופשוט.

1. גיבוי `main`: `git branch main-before-2026-11-17 origin/main && git push origin main-before-2026-11-17` (שומר `4f7daa3`).
2. **commit שחרור** (בענף שילוב, למשל `release/2026-11-17`; יצירת ענף — באישור) — בדיוק הצעדים שנבדקו:
   ```bash
   git worktree add --detach /tmp/release origin/audit/platform-review-2026-11 && cd /tmp/release
   git merge --no-ff origin/claude/ecstatic-euler-z7wmrg          # צפוי: CONFLICT רק ב-scripts/db-tests/rollback-check.sh
   git checkout --ours scripts/db-tests/rollback-check.sh
   git apply docs/audit/integration/rollback-check.sh.audit-to-integrated.patch
   git add scripts/db-tests/rollback-check.sh && git commit --no-edit
   git merge --no-ff origin/claude/store-ssr-seo                   # צפוי: נקי
   git diff --stat d6cd1cf HEAD -- . ':(exclude)docs'              # חובה: ריק (קוד זהה לעץ שנבדק)
   ```
   אם הפלט האחרון **לא ריק** — עוצרים: הקוד שונה מזה שנבדק (סעיף 8.0).
3. **CI על ענף השחרור** (`workflow_dispatch`): חייב לצאת ירוק (אם נכשלת רק `websites-efrat-preview` — הרצה חוזרת של ה-job הכושל פעם אחת; כל כישלון אחר = עצירה). אם הפקודה בשלב 2 החזירה ריק, התוצאה זהה לריצה 191.
4. מיזוג ל-`main`: fast-forward או Merge commit — **לא Squash** (החלטת בעל המערכת). תג `release-2026-11-17`.
5. **לא נמחק אף ענף** (גם לא ענף הבדיקה `integration/ci-audit-seo-ssr-2026-11-17`) בלי רשימה מפורשת שאושרה.

### 7.3 סדר הפריסה (בעל המערכת מריץ, **פקודה אחת בכל פעם**, ומחזיר פלט)

```
0   שער 0 (8.0): הקצוות לא זזו, אין ענף חדש
1   קריאה בלבד: סקריפט 777 (4.3) + _migrations_applied = 199 בדיוק (8.1) + נפח קטלוג לפי חנות
2   גיבוי: pg_dump -Fc + בדיקת קריאה, docker tag before-audit-seo-ssr, רישום ה-commit שרץ (eccd001)
3   מיגרציה 200 → בדיקות → מיגרציה 201 → בדיקות           (מסד לפני אפליקציה)
4   אפליקציה: checkout של ה-SHA של commit השחרור → docker compose build (כולל bun install) → up -d
5   בדיקות בריאות: healthy · /healthz 200 · /readyz 200 · שלושת האתרים 200
6   בדיקות עשן (8.5) + מעקב 24 שעות
```

---

## 8. הוראות מדויקות לקלוד המתאם

> **כללי ברזל:** (1) אתה לא מריץ פקודות בייצור — בעל המערכת מריץ, **פקודה אחת בכל פעם**, ומדביק לך את הפלט; אין SSH. (2) אין שלב בלי אישור מפורש שלו. (3) כל פלט שאינו "תקין" = **עצירה ודיווח**. (4) אין סודות בצ'אט/בקוד. (5) לא מוחקים ענפים. (6) לא מריצים `seo-keywords-nofi-dorit.sql`. (7) לא מפעילים Grow בעסקים נוספים.

### 8.0 שלב 0 — שער: האם משהו זז? (ענף חדש כולל)

```bash
git fetch origin --prune
git rev-parse --short=8 origin/audit/platform-review-2026-11 origin/claude/ecstatic-euler-z7wmrg origin/claude/store-ssr-seo origin/main
# כל ענף שיש בו עבודה שעוד לא בייצור — חייב להיות ברשימה הזו:
for r in $(git branch -r | grep -v HEAD | sed 's/^ *//'); do n=$(git rev-list --count eccd001..$r); [ "$n" != 0 ] && echo "$r ahead-of-prod=$n"; done
```

מצופה: ביקורת **`7af068f`** (או צאצא ש**כל** ההפרש ממנו מסמכים: `git diff --name-only 7af068f <tip> | grep -v '^docs/'` ריק) · SEO **`42c2ccd`** (אותה בדיקה) · SSR **`ed85789`** או `8117412` (אותה בדיקה מול `1849878`) · `main` **`4f7daa3`**. הלולאה צריכה להציג **רק**: `audit/…`, `claude/ecstatic-euler-z7wmrg`, `claude/store-ssr-seo`, `hospitality/tracking-settings` (כלול), `ecommerce/store-identity` (לא כלול, בכוונה), ו-`integration/ci-audit-seo-ssr-2026-11-17` (ענף הבדיקה).
**ענף אחר עם `ahead-of-prod > 0`, או קוד שזז באחד משלושת הענפים → עצירה: לשלב ולבדוק מחדש** (worktree זמני שלא נדחף: `git worktree add --detach … <audit-tip>` → merge → הכרעה לפי סעיף 5 → typecheck ×2, `eslint .`, `vitest run`, `bash scripts/db-tests/run.sh`, `seo-proposals-rollback.sh`, `rollback-guards.sh`, 4 סקריפטי concurrency, `rollback-check.sh`, build, **E2E מלא**, ו-CI על ענף בדיקה). **לא לסמוך על הדוח הזה לגבי קוד שלא נבדק בו.**

### 8.1 קריאה בלבד בייצור

(א) סקריפט 777 — סעיף 4.3. (ב) כל 199 המיגרציות רשומות ושום דבר מעבר להן:

```bash
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' nuriel-shop-db psql -U postgres -d postgres -X -tA -c "SELECT filename FROM public._migrations_applied" | LC_ALL=C sort > /tmp/prod-migrations.txt
git ls-tree --name-only origin/audit/platform-review-2026-11 supabase/migrations/ | sed 's#.*/##' | LC_ALL=C sort | awk '$0 < "20261118110000"' > /tmp/repo-migrations-199.txt
wc -l /tmp/prod-migrations.txt /tmp/repo-migrations-199.txt && comm -3 /tmp/prod-migrations.txt /tmp/repo-migrations-199.txt
```

מצופה: **199 שורות בכל קובץ, `comm` ריק.** כל פער = עצירה (למשל 200 כבר רצה).
(ג) **נפח קטלוג לפי חנות** (קריאה בלבד — לשיקול ה-SSR; **הטבלה היא `public.global_products`, לא `public.products` — תיקון לשאילתה שנתתי קודם**): `docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' nuriel-shop-db psql -U postgres -d postgres -X -q -c "SELECT t.slug, count(*) AS products, count(*) FILTER (WHERE NOT gp.is_hidden) AS visible FROM public.global_products gp JOIN public.tenants t ON t.id = gp.tenant_id GROUP BY t.slug ORDER BY 2 DESC LIMIT 5;"` — `visible` הוא מה ש-`get_catalog()` מחזירה לאורח (קובע את עלות ה-SSR).
(ד) **נפח הזמנות** (לשיקול P3): `SELECT tenant_id, count(*) FROM public.orders GROUP BY 1 ORDER BY 2 DESC LIMIT 5;`

### 8.2 גיבוי (חובה)

`pg_dump -Fc` + בדיקת קריאה מלאה (`pg_restore -l`); `docker tag nuriel-shop-app-app:latest nuriel-shop-app-app:before-audit-seo-ssr`; רישום ה-commit שרץ (`eccd001`). **לא ממשיכים בלי גיבוי שנקרא בהצלחה.**

### 8.3 מיגרציות — אחת-אחת

לכל אחת: `psql -v ON_ERROR_STOP=1 -f supabase/migrations/<file>` → `INSERT INTO public._migrations_applied (filename) VALUES ('<file>')` → `NOTIFY pgrst, 'reload schema'`.
**#200 `20261118110000_order_guard.sql`** — בדיקות: `coupon_grants` קיימת עם RLS ובלי `anon`/`authenticated`; הטריגר `orders_a_rate_guard` על `orders`; `check_coupon` — `provolatile = 'v'`.
**#201 `20261118200000_hosp_seo_proposals.sql`** — בדיקות: `hospitality.seo_proposals` ו-`hospitality.seo_runs` עם `relrowsecurity`; 6 הפונקציות הציבוריות; שתי הטבלאות ריקות.
> נכשלה מיגרציה → `ON_ERROR_STOP` עוצר; **אין להמשיך** למיגרציה הבאה או לאפליקציה (כל אחת בטרנזקציה אחת — לא נשאר מצב חצי-מוחל). לדווח ולחכות.

### 8.4 האפליקציה

`git checkout <SHA של commit השחרור>` → `docker compose build` (**כולל** `bun install`: `package.json`/`bun.lock` השתנו) → `docker compose up -d`. בדיקות: הקונטיינר `healthy`; `/healthz` 200; `/readyz` 200 (`{"db":"up"}`); 200 לשלושת האתרים (פלטפורמה, nuriel-shop, nofi-dorit). `.env`: אין חובה לשנות — המשתנים החדשים אופציונליים; אבל `docker-compose.yml` מעביר עכשיו `SUPPORT_NOTIFY_EMAIL` / `BUSINESS_PROFILE_SECRET` / `CUSTOM_DOMAIN_CNAME_TARGET` / `IMPORT_IMAGE_ALLOW_HOSTS` / `AI_RENEWAL_JOB` **אם הם מוגדרים ב-`.env`** (לפני כן לא הגיעו לקונטיינר) — לוודא שאין שם ערך ישן ומכוון.

### 8.5 בדיקות עשן (קריאה בלבד/בטוחות)

**SSR של החנות:**
- `curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1)" https://nuriel-shop.nuri1.fit/` → `<h1`, שמות מוצרים ומחירים בגוף (לא 15 תווים).
- עמוד מוצר, `/?category=…`, `/about`, `/terms` → H1 ותוכן. חנות נוספת → **רק** המוצרים שלה. `nuriel-app2.nuri1.fit` → דף הנחיתה כמו קודם.
- בדפדפן: הוספה לסל, קופה, התחברות לקוח — בלי שגיאות בקונסול. לוגים (`docker logs --since 5m`): בלי `[storefront-seed]`.

**ביקורת / Hospitality / נופי דורית:**
- **קופה של לקוח מחובר עם קופון** (אישור → הזמנה עם ההנחה) — אין לה כיסוי E2E.
- הזמנת אורח רגילה; ייצוא PDF הזמנה; טופס פניות באתר עסק.
- **נופי דורית:** האתר עולה כרגיל (לא מושפע מה-SSR), PDF של חוזה (אירוח/אירוע) עם חתימת בעל העסק.
- מסך ה-SEO ב-Hospitality נפתח ללא שגיאה **בלי** להפיק הצעה (הפקה עולה בכסף דרך NURIEL AI).
- **לא לשלוח webhook אמיתי של Grow. לא לשמור תוכן SEO באתר נופי דורית.**

מעקב 24 שעות: "קופון לא תקף" חריג, שגיאות הגבלת הזמנות, **זמן תגובה של עמוד הבית וקטגוריות** ושגיאות `[storefront-seed]`, `/readyz` מנוטר, זיכרון הקונטיינר.

### 8.6 תנאי עצירה

סקריפט 777 מציג סטייה · `_migrations_applied` חסרה ≤199 או מכילה 200+ · גיבוי לא נקרא · מיגרציה נכשלה · `/readyz` ≠ 200 · אתר ≥ 500 · קופון מחובר נכשל · **חנות מציגה מוצר של חנות אחרת** · **דף הבית של חנות איטי מאוד / HTML ענק** · מישהו מבקש לדלג על שלב.

---

## 9. תוכנית חזרה לאחור

| מה | פעולה | הערות |
| --- | --- | --- |
| **האפליקציה (קודם)** | `docker tag nuriel-shop-app-app:before-audit-seo-ssr nuriel-shop-app-app:latest && docker compose up -d` | מחזיר גם את ה-SSR (קוד בלבד, אין מה להחזיר במסד). עובד מול מסד 201: הקוד הישן מתעלם מטבלאות ה-SEO ו-`check_coupon` באותה חתימה; בדיקת ה-Docker כוללת גיבוי ל-`/robots.txt`, כך שהתמונה הישנה נחשבת תקינה |
| **#201** | גיבוי → `psql -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261118200000_hosp_seo_proposals.down.sql` → `DELETE FROM public._migrations_applied WHERE filename = '20261118200000_hosp_seo_proposals.sql'` → `NOTIFY pgrst, 'reload schema'` | נעצר בשגיאה אם יש הצעות שמורות (ללא שינוי); מה שאושר כבר נשמר בשדות עצמם |
| **#200** | **אחרי** 201: `supabase/rollbacks/20261118110000_order_guard.down.sql` → `DELETE … '20261118110000_order_guard.sql'` → `NOTIFY pgrst` | **סדר הפוך: 201 לפני 200.** בטוח עם נתוני לקוח (נבדק); מוחק רק `coupon_grants`; הפונקציות חוזרות לגרסת מיגרציה 55 |
| **SSR בלבד** (אם הבעיה רק בו) | אין תג נפרד — החזרת ה-image מחזירה את שלושת הענפים. אם נדרש להשאיר ביקורת+SEO ולהחזיר רק SSR: מבנים מחדש `commit השחרור` עם revert של merge ה-SSR — **רק באישור בעל המערכת**, כולל CI | ה-SSR לא תלוי במסד, לכן אין סדר מול המיגרציות |
| **Git** | `main-before-2026-11-17` שומר את `4f7daa3`. החזרת `main` — רק באישור (revert של המיזוג, לא כתיבת היסטוריה מחדש) | המיזוג עצמו לא משנה את הייצור |

כל 90 קבצי ה-rollback מוגנים מפני אובדן נתונים בשקט (`ROLLBACK-GUARDS.md`); **גיבוי לפני rollback בייצור חובה**.

---

## 10. סיכונים פתוחים וגבולות הדוח

| # | סיכון | סטטוס |
| --- | --- | --- |
| **1** | **ה-SSR של הבית והקטגוריות טוען את כל הקטלוג של החנות** ומטמיע אותו ב-HTML (עמוד מוצר — לא: מוצר אחד + 8; עמודי מידע — לא). **נמדד מקומית (נתוני דמה):** קריאת הקטלוג בהחמצת מטמון: 47 ms ב-152 מוצרים · 170 ms ב-1,000 · **~3.0 שנ' ב-5,000 · ~6.6 שנ' ב-10,000** (כל דף של 1,000 מחשב מחדש את `get_catalog()` כולה); HTML מוטמע ~1.17 KB למוצר (**~9 MB ב-10,000**); זיכרון שיא ~81 MB לבקשה ו-~25 MB במטמון לחנות של 10,000. גם **עמוד מוצר** מושפע: `get_catalog()` לא מתרחבת, ולכן כל שאילתה מחשבת את כל הקטלוג — **~1.4 שנ' מסד לעמוד מוצר ב-10,000 מוצרים** (ללא מטמון). בנוסף: אין single-flight והמטמון לא מפונה לפי זמן | **לא נבדק בייצור — ממתין לפלט (8.1 ג).** חנות עד ~1,000 מוצרים: אין בעיה. חנות עם אלפי מוצרים: **לא לפרוס את ה-SSR כמו שהוא** — תוכנית מדורגת וסף החלטה ב-[`SSR-LARGE-STORES.md`](SSR-LARGE-STORES.md) §6; אפשרות חלופית: לפרוס ביקורת+SEO בלבד ולדחות את ה-SSR. **לא שיניתי קוד** |
| 2 | אימות 777 האובייקטים בייצור | ✅ **נסגר** — הורץ בשרת ע"י בעל המערכת: 777/777 זהים (4.3) |
| 3 | **S-2 Grow:** אין אימות מול הספק שהתשלום קרה | לא נסגר (תיעוד הספק חסום מהסביבה). **לא להפעיל Grow בעסקים נוספים** |
| 4 | **P3:** "ההזמנות שלי" איטי ב-150k הזמנות (15.2 שנ'; 2.9 ב-20k) | נמדד, לא תוקן (שכתוב 22 מדיניות RLS = החלטת בעל המערכת); קריאת נפח הזמנות (8.1 ד) קובעת דחיפות |
| 5 | ממצאים של ה-SSR שלא טופלו (מחוץ לשלב 1) | כרטיסי מוצר בקטגוריות הם כפתורים ולא קישורים (גוגל לא מקבל `<a href>` לעמוד המוצר); באג קיים בשאילתת `/sitemap` (400); לקוח עם מחירון משלו רואה לשנייה את מחיר האורח; מוצר שלא קיים — 200 + noindex; במצב תחזוקה תגיות ה-head של מוצר נשלחות. **אינם חוסמי פריסה** |
| 6 | E2E flaky `websites-efrat-preview` | לא תוקן; עבר בצירוף; ידוע ומתועד |
| 7 | אין E2E לקופה של לקוח מחובר עם קופון | בדיקת עשן ידנית (8.5) |
| 8 | `ecommerce/store-identity` (2 commits) לא כלול | בכוונה; אם נדרש — שילוב ובדיקה מחדש |
| 9 | Docker image נבנה כאן עם ערכי `VITE_*` של דמה ו-CA זמני של ה-sandbox | הבנייה הראשונה עם הסביבה האמיתית — בשרת |
| 10 | כותב ה-SEO מול דגם אמיתי | לא נבדק (עולה כסף) |
| 11 | ענפים או קוד שיזוזו אחרי הדוח (כולל עבודת SEO נוספת על Nuriel Shop / APP2) | שער 0 (8.0) חובה; הנקודות החמות בסעיף 5.3 |

**הדוח בודק קוד שנקבע לפי הקצוות בסעיף 1. הוא לא מחליף את שער 0, את אימות 777 בייצור, ולא את אישורו של בעל המערכת.**

---

## 12. כל התנאים שנותרו לפני פריסה משותפת

| # | תנאי | מי | סטטוס |
| --- | --- | --- | --- |
| 1 | אימות 777 האובייקטים בייצור | בעל המערכת | ✅ **סגור** (17.11: 777/777 זהים, `applied_total=199`). להריץ **שוב** סמוך לפריסה |
| 2 | **נפח קטלוג לפי חנות** (שאילתה מתוקנת, 8.1 ג) | בעל המערכת מריץ | ⏳ **ממתין לפלט** |
| 3 | **החלטה על ה-SSR** לפי הנפח: כמו שהוא / קודם שער+מטמון (שינוי קוד בענף ה-SSR + שילוב ובדיקה מחדש) / פריסה של ביקורת+SEO בלבד | בעל המערכת | ⏳ תלוי ב-2 |
| 4 | **אישור מפורש לכל צעד**: גיבוי `main` · merge · CI על ענף השחרור · מיגרציה #200 · מיגרציה #201 · build+up של האפליקציה | בעל המערכת | ⛔ אין אישור כרגע |
| 5 | **שער 0 סמוך לפריסה** (8.0): הקצוות לא זזו, אין ענף חדש עם עבודה שטרם בייצור | הקלוד המתאם | לפני הפריסה |
| 6 | גיבוי DB (`pg_dump -Fc` + `pg_restore -l`) + תג image `before-audit-seo-ssr` | בעל המערכת מריץ | לפני הפריסה |
| 7 | **CI ירוק על ענף השחרור** (או הוכחה שהקוד זהה ל-`d6cd1cf`/`c97a2c1` — ריצות 191 ו-192 ירוקות) | הקלוד המתאם | נבדק על הצירוף; לחזור עליו אם נוצר commit שחרור חדש |
| 8 | **Grow:** לא להפעיל בעסקים נוספים (S-2 לא אומת מול הספק) | — | פתוח, לא חוסם |
| 9 | בדיקות עשן אחרי הפריסה (8.5): קופה של לקוח מחובר עם קופון (אין E2E), SSR בחנות, נופי דורית + PDF חוזה עם חתימה | בעל המערכת | אחרי הפריסה |
| 10 | החלטות שאינן חוסמות: שכתוב RLS (P3 — לפי נפח הזמנות), הכנסת `ecommerce/store-identity`, מחיקת ענף הבדיקה `integration/ci-audit-seo-ssr-2026-11-17`, ה-flake של `websites-efrat-preview` | בעל המערכת | פתוח |

**מה שכבר הוכח ולא נדרש שוב:** סדר המיגרציות (#200 → #201) ואי-דריסת נתונים (חתימת בעל העסק, תנאי נופי דורית, מסמך מדיניות חתום — סעיף 4.4); E2E מלא על שלושת הענפים (396/0 מקומית; CI 191 ו-192 ירוקים); Docker נבנה ורץ; rollback לכל המיגרציות.

---

## 11. נספחים

- [`integration/rollback-check.sh.audit-to-integrated.patch`](integration/rollback-check.sh.audit-to-integrated.patch) — פתרון ההתנגשות.
- `scripts/audit/prod-migration-fingerprint.sql` + `scripts/audit/gen-migration-fingerprint.py` — אימות 777 (קריאה בלבד).
- [`SSR-LARGE-STORES.md`](SSR-LARGE-STORES.md) — ה-SSR מול חנויות גדולות: מדידות, ניתוח ותוכנית מדורגת.
- `scripts/audit/data-survival-check.sh` — הוכחת "אין דריסה של נתונים" (מקומי, מסד scratch).
- CI: [ריצה 191 (צירוף שלושה ענפים)](https://github.com/nuriels/nuriel-shop/actions/runs/44129176407) · [ריצה 190 (SSR)](https://github.com/nuriels/nuriel-shop/actions/runs/44120615416).
- [`PRE-MERGE-READINESS.md`](PRE-MERGE-READINESS.md) · [`MAIN-MERGE-PLAN.md`](MAIN-MERGE-PLAN.md) · [`ROLLBACK-GUARDS.md`](ROLLBACK-GUARDS.md) · [`HEALTHCHECK.md`](HEALTHCHECK.md) · [`GROW-VERIFICATION.md`](GROW-VERIFICATION.md) · [`OWNER-SIGNATURE-CHECK.md`](OWNER-SIGNATURE-CHECK.md).
- בענף ה-SEO: `docs/audit/seo-ai-implementation-report.md` · `docs/audit/seo-diagnosis-nuriel-shop-app2.md`. בענף ה-SSR: `docs/audit/storefront-ssr-report.md` · `docs/audit/HANDOFF-store-ssr-2026-11-17.md` · `docs/audit/ssr-html/`.

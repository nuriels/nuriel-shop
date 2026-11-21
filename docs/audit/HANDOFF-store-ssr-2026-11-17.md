# דוח מסירה לפריסה המשולבת — ענף ה-SSR של החנויות (17.11.2026)

> ### ✅ עדכון מצב — 21.11.2026 (המסמך נשמר כתיעוד היסטורי של מה שתוכנן לפני הפריסה)
> - **מוזג ל-`main`:** `20f49eb` — שלושת הענפים (ביקורת, SEO של Hospitality, SSR של החנות).
> - **נפרס לייצור:** 19.11.2026, 10:50 UTC — image `876ba03ebdfd` (תג `release-20f49eb`); **201** מיגרציות רשומות ב-`public._migrations_applied`.
> - **נקודת חזרה:** תג `before-audit-seo-ssr` = image `3839fed06c71`; גיבוי `before-deploy.dump` (sha256 `0fbc850a…`) + עותק Storage (1,369 קבצים) — בשרת.
> - **מה הלאה:** הגרסה הבאה (חבילת כלה עם חדר נוסף, `/sitemap`, מחיר אישי בלי הבהוב, E2E קופון) ותוכנית הפריסה שלה —
>   [`RELEASE-2026-11-21.md`](RELEASE-2026-11-21.md). גיבוי מחוץ לשרת — [`OFFSITE-BACKUP-PROPOSAL.md`](OFFSITE-BACKUP-PROPOSAL.md).

**נמען:** הקלוד שמרכז את הפריסה · **נכתב ע"י:** הקלוד של ענף `claude/store-ssr-seo`, לבקשת בעל המערכת.

> ### מצב — קרא קודם
>
> - **לא בוצע Merge. לא בוצעה פריסה. לא שונה דבר בייצור. לא הורצה מיגרציה. לא נגעתי בנתוני לקוחות או בסודות.**
> - בעל המערכת רוצה **פריסה מתואמת אחת**, אחרי שכל הענפים מוכנים. כל צעד מיזוג / פריסה דורש את אישורו המפורש.
> - בדיקות השילוב בדוח הזה נעשו **בלי Merge**: `git merge-tree` (אובייקטים בלבד) ותיקייה זמנית שנמחקה. שום ענף לא זז.
> - **"ענף החתימות"** — בזמן הכתיבה **אין ב-origin ענף חתימות שעוד לא נמצא בייצור** (`hospitality/signing-mobile` ו-`billing/agreements`
>   כבר בייצור; בענף הביקורת — רק בדיקת החתימה של בעל העסק, מסמכים). לכן סעיף 5 נותן את מה שצריך לבדוק ואיך, ברגע שהענף זמין.

---

## 0. תקציר בשורות

| נושא                                    | מצב                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| מה הענף עושה                            | עמודי החנות הציבוריים נבנים בשרת (SSR): גוגל מקבל HTML מלא — H1, מוצרים, מחירים, תמונות, תיאור — במקום גוף ריק (15 תווים)                                                                                                                                                                 |
| ענף / בסיס                              | `claude/store-ssr-seo`, מבוסס ישירות על **`eccd001`** (הקוד שבייצור). הענפים האחרים על `bd7771f` = `eccd001` + מסמך — מתמזג בלי בעיה                                                                                                                                                      |
| Commit אחרון של קוד                     | **`1849878`** — אחריו מסמכים בלבד (`docs/audit/…`)                                                                                                                                                                                                                                        |
| CI                                      | ריצה 190 — [actions/runs/44120615416](https://github.com/nuriels/nuriel-shop/actions/runs/44120615416): ניסיון 1 — 3/4 ירוקים, E2E 379/1 (`websites-efrat-preview` בלבד); **ניסיון 2 (אותו קוד) — 4/4 ירוקים, E2E 380 עברו, 0 נכשלו, 0 flaky**                                            |
| מיגרציות / מסד / nginx / `package.json` | **אין.** קוד אפליקציה + בדיקות בלבד                                                                                                                                                                                                                                                       |
| תלות בענפים אחרים                       | **אין**                                                                                                                                                                                                                                                                                   |
| שילוב עם ענף הביקורת (`7af068f`)        | ✅ מתמזג נקי. קובץ משותף אחד: `tests/unit/deploy-websites-efrat.test.ts` — **אותו blob** (`79bf77f`)                                                                                                                                                                                      |
| שילוב עם ענף ה-SEO (`42c2ccd`)          | ✅ מתמזג נקי. אותו קובץ משותף, אותו blob                                                                                                                                                                                                                                                  |
| שילוב משולש (ביקורת + SEO + SSR)        | התנגשות אחת בלבד — `scripts/db-tests/rollback-check.sh`, **ההתנגשות הידועה בין הביקורת ל-SEO** (הענף הזה לא נוגע בקובץ). עם ה-patch שלך (`docs/audit/integration/rollback-check.sh.audit-to-integrated.patch`): **Typecheck ✅ · Unit 99 קבצים / 1,402 ✅ · Lint 0 שגיאות ✅ · Build ✅** |
| מה עדיין צריך לרוץ על העץ המשולב        | **E2E מלא** (כולל 7 בדיקות `storefront-ssr.spec.ts`) — עדיף ב-CI על ענף שילוב זמני; SQL — הענף לא משנה מסד, התוצאות שלך בתוקף                                                                                                                                                             |

---

## 1. ה-Commits (מעל `eccd001`)

| Commit                                     | מה                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `9cc1c68`                                  | CI: `process.env["PATH"]` בבדיקת efrat (TS4111) — **זהה** לתיקון של ענף הביקורת (`0f35ed9`), אותו blob |
| `4ea505a`                                  | SSR לעמודי החנות: בית / קטגוריה, מוצר, אודות, צור קשר, תקנון, פרטיות, ביטול עסקה, מפת אתר, עמודי תוכן  |
| `ab4cd14`                                  | הנתונים מהשרת נטענים רק באתר חנות (`hostMode.siteType === "ecommerce"`)                                |
| `c28770f`                                  | "מוצרים נוספים" כבר ב-HTML של עמוד המוצר (CLS); תיקוני בדיקת ה-E2E                                     |
| `1849878`                                  | תיאור בכרטיס מוצר ב-HTML הראשוני — עד 200 תווים, טקסט פשוט (גודל HTML)                                 |
| `e026d3c`, `8117412`, והקומיט של המסמך הזה | מסמכים בלבד: `docs/audit/storefront-ssr-report.md`, `docs/audit/ssr-html/*`, הדוח הזה                  |

## 2. מה השתנה (21 קבצים מעל הייצור, בלי מסמכים)

**ההתנהגות:** בטעינה הראשונה של עמוד חנות, ה-loader טוען בשרת — דרך `supabaseAdmin` (מוגבל לחנות של הבקשה: `tenant_id` +
`x-tenant-id`) — את מה שאורח רואה: `get_catalog` בלי משתמש (המחירון הרגיל; חנות מוקפאת / שבת → ריק), ההגדרות הציבוריות
(אותן עמודות שהדפדפן קורא), הקטגוריות והבאנרים. הרכיבים מתחילים מהנתונים האלה (זהים בשרת וברינדור הראשון — אין
אי-התאמה בהידרציה), ואז הדפדפן טוען שוב **כמו קודם**, לפי מי שמחובר. עד שהטעינה בדפדפן נגמרת: "הוספה לסל" לא מוסיפה
במחיר של אורח, והסל לא מסונכרן מול נתוני השרת. במצב תחזוקה — לא נשלחים מוצרים. **קנונית — לא שונתה.**

| קבוצה                 | קבצים                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| חדשים                 | `src/lib/storefront-seed.tsx` (Context), `src/lib/storefront-seed.functions.ts` (פונקציית שרת `getStorefrontSeed` + מטמון קטלוג של אורח, 60 שנ', **לפי מזהה החנות**), `src/hooks/useHydrated.ts`                                                                                                                                                                                                                    |
| עמודים                | `src/routes/index.tsx`, `product.$productId.tsx`, `pages.$slug.tsx`, `about.tsx`, `contact.tsx`, `terms.tsx`, `privacy.tsx`, `cancellations.tsx`, `sitemap.tsx` — `ssr: true` + loader + `StorefrontSeedProvider`                                                                                                                                                                                                   |
| משותפים (API לא נשבר) | `src/lib/site.ts` — `loadSiteSettings(client = supabase)` · `src/lib/banners.ts` — `loadHomeBanners()` כמו קודם + `fetchHomeBanners(client)` בלי מטמון · `src/lib/rich-text.ts` — **רק נוספה** `serverRichContentHtml` · `src/components/legal/RichContent.tsx` — בשרת וברינדור הראשון טקסט בפסקאות, אחרי ההידרציה DOMPurify · `src/hooks/useSiteSettings.ts`, `src/hooks/useCategories.ts` — מצב התחלתי מה-Context |
| בדיקות                | `tests/unit/storefront-ssr.test.ts` (4), `e2e/tests/storefront-ssr.spec.ts` (7: 6 desktop + 1 mobile), `tests/unit/deploy-websites-efrat.test.ts` (שורה אחת, זהה לביקורת)                                                                                                                                                                                                                                           |

**חשוב לשילוב:** מטמונים ברמת המודול (`useSiteSettings`, `useCategories`, `banners.ts`) משותפים לכל הבקשות בשרת — **אסור
למלא אותם בשרת.** הענף לא ממלא אותם (הנתונים עוברים ב-Context). ענף אחר שיקרא בשרת ל-`refreshSiteSettings` /
`fetchCategoryRows` / `loadHomeBanners` ידליף נתונים בין חנויות.

## 3. בדיקות על הענף לבדו

| בדיקה                                   | תוצאה                                                                                                                                                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI 190, ניסיון 2                        | ✅ 4/4: Typecheck · Lint (0 שגיאות; 28 הידועות בכל הריפו) · Unit 1,317 · Build · SQL 3,410/3,410 ×3 + Rollback + concurrency · Hospitality preview · **E2E 380/0**                                                                                  |
| CI 190, ניסיון 1                        | אותו דבר, E2E 379 עברו / 1 נכשל — `websites-efrat-preview` (ראו 6.3)                                                                                                                                                                                |
| 7 בדיקות SSR (`storefront-ssr.spec.ts`) | ✅ בשני הניסיונות: HTML בלי JS (H1, מוצרים, מחירים, תמונה, Schema, קנונית), עמודי מידע, בידוד בין חנויות, מצב תחזוקה, הידרציה בלי שגיאות + CLS < 0.1, הוספה לסל, לקוח בדרג מחיר (48.00 ולא 50.00, גם בקופה)                                         |
| בדיקות החנות                            | ✅ בשני הניסיונות, בלי כשל חדש: storefront 5, cart-checkout 2, catalog-api 4, isolation 5, seo 5, portal-landing 9, tenant-routing 6, vat-settings 3, tag-manager 9, marketing-consent 1, product-duplicates 4, admin-product-import 3, licenses 16 |
| בדיקות חתימות / מסמכים                  | ✅ agreement-signer-ip 1, billing-agreements 4, contracts-security 4, manage-signing-devices 3, site-documents 4, manage-client-documents 10, manage-standalone-documents 8                                                                         |
| E2E מקומי מלא                           | ✅ 372 עברו, 0 נכשלו (לפני 3 התיקונים האחרונים; אחריהם — 43/43 בקבצים הרלוונטיים, ו-CI המלא)                                                                                                                                                        |
| ידני                                    | XSS: מוצר עם `</script><script>…` ו-`<img onerror>` — מוברח, לא רץ (עם JS ובלי). ביצועים (152 מוצרים, טלפון מדומה): LCP בית 12.5s→5.5s, CLS 0.70→0.002                                                                                              |

## 4. השילוב — איך נבדק (לשחזור)

קצוות: ביקורת `7af068f`, SEO `42c2ccd`, SSR `8117412` (קוד זהה ל-`1849878`).

```bash
git fetch origin
# כל ענף מול SSR — 0 = נקי
git merge-tree --write-tree --name-only origin/audit/platform-review-2026-11 origin/claude/store-ssr-seo
git merge-tree --write-tree --name-only origin/claude/ecstatic-euler-z7wmrg origin/claude/store-ssr-seo
# משולש — אובייקטים בלבד (commit-tree יוצר אובייקט בלי ענף)
T2=$(git merge-tree --write-tree origin/audit/platform-review-2026-11 origin/claude/store-ssr-seo | head -1)
C2=$(git commit-tree "$T2" -p origin/audit/platform-review-2026-11 -p origin/claude/store-ssr-seo -m tmp)
git merge-tree --write-tree --name-only "$C2" origin/claude/ecstatic-euler-z7wmrg
# → CONFLICT רק ב-scripts/db-tests/rollback-check.sh (ביקורת ↔ SEO) → הגרסה של הביקורת + ה-patch שלך
```

על העץ המשולב (תיקייה זמנית, `bun install --frozen-lockfile` מה-lockfile של הביקורת): Typecheck (שני ה-tsconfig) ✅ ·
Vitest **99 קבצים / 1,402** ✅ (= 98 / 1,398 שלך + הקובץ החדש עם 4) · `eslint .` **0 שגיאות**, 43 אזהרות (41 שלך + 2
`react-refresh` בקובץ החדש) · `vite build` ✅. **לא הורצו על העץ המשולב:** E2E ו-SQL.

## 5. שילוב עם ענף החתימות — מה לבדוק

1. **התנגשויות טקסט:**
   ```bash
   git merge-tree --write-tree --name-only origin/<ענף-החתימות> origin/claude/store-ssr-seo
   comm -12 <(git diff --name-only eccd001 origin/claude/store-ssr-seo | sort) \
            <(git diff --name-only $(git merge-base eccd001 origin/<ענף-החתימות>) origin/<ענף-החתימות> | sort)
   ```
2. **הקבצים שסביר שחתימות נוגעות בהם גם כאן:**
   - `src/components/legal/RichContent.tsx` — **משמש את עמוד ההסכם** (`src/routes/agreement.tsx`, מציג את התנאים; `ssr: false`).
     בעמודים שנבנים בשרת (תקנון, פרטיות, אודות, תיאור מוצר) **חובה** שהרינדור בשרת וברינדור הראשון ישתמש ב-`serverRichContentHtml`
     (`useHydrated`) — אחרת אי-התאמה בהידרציה, ו-React משאיר את הטקסט הלא-מעוצב. ב-`ssr: false` אין השפעה מעשית.
     ה-PDF החתום **לא** משתמש ב-RichContent.
   - `src/lib/rich-text.ts` — רק נוספה פונקציה; הפונקציות הקיימות (כולל `sanitizeRichHtml`) לא השתנו.
   - `src/lib/site.ts` / `useSiteSettings` — חתימת `loadSiteSettings` תואמת לאחור (פרמטר אופציונלי).
   - `tests/unit/deploy-websites-efrat.test.ts` — אם גם שם יש את תיקון ה-TS4111, זה אותו blob.
3. **עמוד ציבורי חדש של חנות** (אם ענף החתימות מוסיף כזה): כברירת מחדל יהיה SSR — להשתמש באותה תבנית: loader עם
   `isServerRender() && context.hostMode.siteType === "ecommerce" ? getStorefrontSeed({ data: {} }) : null` ועטיפה ב-`StorefrontSeedProvider`.
4. **E2E אחרי השילוב:** `storefront-ssr`, `storefront`, `cart-checkout`, `isolation`, `seo`, `portal-landing`, `tenant-routing`,
   ובצד החתימות: `agreement-signer-ip`, `billing-agreements`, `contracts-security`, `manage-signing-devices`, `*-documents`.

## 6. לפריסה המשולבת

1. **אין מיגרציה** מהענף הזה; אין סדר מול 200 / 201. בניית ה-image מחדש (שכבר נדרשת בגלל שינויי `package.json` של הביקורת) מכסה אותו.
2. **בדיקות עשן ייעודיות אחרי הפריסה (קריאה בלבד):**
   - `curl -s -A "Mozilla/5.0 (compatible; Googlebot/2.1)" https://nuriel-shop.nuri1.fit/` → `<h1`, שמות מוצרים ומחירים בגוף (לא 15 תווים).
   - עמוד מוצר, `/?category=…`, `/about`, `/terms` → H1 ותוכן.
   - חנות נוספת → רק המוצרים שלה. `nuriel-app2.nuri1.fit` → דף הנחיתה כמו קודם.
   - בדפדפן: הוספה לסל, קופה, לקוח מחובר — בלי שגיאות בקונסול. לוגים: בלי `[storefront-seed]`.
3. **החזרה:** קוד בלבד — ה-image הקודם. אין מה להחזיר במסד.
4. **ידוע ולא מוסתר:**
   - `websites-efrat-preview` — **flaky, לא נפתר**: נכשל פעמיים בניסיון 1 של ריצה 190, עבר בניסיון 2 (אותו קוד), נכשל גם בענפים
     אחרים לפני השינוי (185, 186, 188). רץ על אתר Websites, שבו הנתונים מהשרת לא נטענים — לא קשור. לא דולג ולא שונה.
   - ממצאים מחוץ לשלב 1 (לא תוקנו, לאישור בנפרד): כרטיסי מוצר בקטגוריות הם כפתורים ולא קישורים; באג קיים בשאילתה של `/sitemap`
     (400); לקוח עם מחירון משלו רואה לשנייה את מחיר האורח; מוצר שלא קיים — 200 + noindex; ב-תחזוקה תגיות ה-head של עמוד מוצר נשלחות.
   - עלות: +~15ms זמן שרת לעמוד; HTML בית ~20KB gzip ב-152 מוצרים; קריאת קטלוג אחת לדקה לחנות בשרת (מטמון) + הגדרות / קטגוריות בכל טעינה ראשונה.

פרטים מלאים: `docs/audit/storefront-ssr-report.md` · HTML לפני / אחרי: `docs/audit/ssr-html/`.

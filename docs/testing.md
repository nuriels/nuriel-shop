# בדיקות ו-Regression — Ecommerce

כל הבדיקות רצות **מקומית או ב-GitHub Actions בלבד**, מול מסד חד-פעמי. אין
בשום מקום חיבור ל-Supabase של Production, אין מפתחות אמיתיים ואין נתוני
לקוחות אמיתיים. מיילים ותשלומים מדומים.

התשתית הועתקה מהענף `hospitality/stage-2` (שם נבנתה) — רק החלקים של החנויות,
בלי קוד או בדיקות של Hospitality.

## פקודות

| פקודה | מה רץ | דרישות |
|---|---|---|
| `bun run typecheck` | TypeScript לאפליקציה + לקוד הבדיקות | — |
| `bun run test:unit` | Vitest — לוגיקה טהורה: הרשאות, קופונים, מע"מ, מנויים, SEO, זיהוי דומיין, זהות החנות | — |
| `bun run test:scripts` | סקריפטי הבדיקה הישנים (`scripts/*-check.ts`) | — |
| `bun run test:db` | בדיקות SQL: כל המיגרציות מאפס על Postgres 16 מקומי + `scripts/db-tests/*.test.sql` | `postgresql-16` |
| `bun run e2e:up` | Supabase מקומי ב-Docker + כל המיגרציות + נתוני בדיקה | Docker |
| `bun run test:e2e` | Playwright — Regression לחנויות (בונה ומריץ את האפליקציה מול ה-Supabase המקומי) | `e2e:up` |
| `bun run e2e:down` | עצירה ומחיקה של ה-Supabase המקומי | — |

## E2E — מה מכוסה

סביבה: `kobi.shop.localhost` (חנות A — חנות ברירת המחדל מהמיגרציות),
`store-b.shop.localhost` (חנות B), `platform.shop.localhost` (פאנל הפלטפורמה).
הנתונים ב-`e2e/scripts/seed.sql` ו-`e2e/fixtures/data.mjs` (פיקטיביים, `@e2e.test`).

| קובץ | מה נבדק |
|---|---|
| `storefront.spec.ts` | דף הבית, עמוד מוצר (מחשב + מובייל, כולל צילום מסך) |
| `cart-checkout.spec.ts` | הוספה לסל ← קופה עם הסכום הנכון; סל ריק |
| `auth.spec.ts` + `auth.setup.ts` | התחברות בסיסמה דרך המסך האמיתי, שמירת החיבור, סיסמה שגויה, אורח בניהול |
| `admin.spec.ts` | פאנל ניהול החנות: כל האזורים, מוצרים, צילום התפריט, לקוח לא נכנס |
| `platform.spec.ts` | פאנל הפלטפורמה: חנויות + הקמת חנות, אורח, בעל חנות אינו מנהל פלטפורמה, `/platform` חסום בדומיין חנות |
| `isolation.spec.ts` | כל חנות רואה רק את המוצרים שלה (ממשק, API ישיר עם טוקן, sitemap) |
| `auth-regression.spec.ts` | התחברות בקוד למייל, פתיחת חנות דרך הפורטל, כפתור Google חוזר לאותה חנות, ושרת ההתחברות מקבל רק כתובות חזרה מורשות (Google — רק ב-CI) |
| `seo.spec.ts` | `robots.txt` (צילום מדויק), `sitemap.xml` (רשימת הכתובות), `llms.txt`, meta / OG / canonical / JSON-LD ב-SSR |
| `seo-identity.spec.ts` | זהות החנות (StoreIdentity): שתי חנויות עם שמות שונים — כל אחת מקבלת רק את השם, ה-Schema וה-SEO שלה, בלי דליפה בין חנויות; שם תצוגה כ-alternateName; חנות בלי שם → "החנות שלי"; ברירת המחדל הישנה "סוכנות המשקאות" לא מוצגת; אין brand מומצא למוצרים; הכותרת הגלויה כמו קודם |

### צילומי מסך

- הסף: עד 2% פיקסלים שונים (`maxDiffPixelRatio: 0.02`, `threshold: 0.25`),
  אנימציות כבויות.
- שינוי מכוון בעיצוב = עדכון הצילום: `bun run test:e2e --update-snapshots`
  ובדיקה עינית של ההבדל.

### מגבלת התחברות

מסך ההתחברות מגביל ל-15 ניסיונות לכתובת IP ב-15 דקות (הגנה אמיתית — לא
עוקפים אותה). לכן כל משתמש מתחבר **פעם אחת** (`auth.setup.ts`) והבדיקות
משתמשות במצב שנשמר.

## ידוע / פתוח

- `scripts/excel-check.ts` ו-`scripts/watermark-check.ts` בודקים מודולים שלא
  קיימים בריפו — `run-checks.sh` מדלג עליהם ומדווח.
- `bun run lint` מחזיר 28 שגיאות עיצוב (prettier) בקבצים קיימים — בכוונה לא
  תוקנו. ב-CI: קוד הבדיקות והקוד החדש נבדקים בקפדנות, וה-lint המלא רץ לדיווח בלבד.

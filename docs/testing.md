# בדיקות ו-Regression (שלב 0)

כל הבדיקות רצות **מקומית או ב-GitHub Actions בלבד**, מול מסד חד-פעמי. אין
בשום מקום חיבור ל-Supabase של Production, אין מפתחות אמיתיים ואין נתוני
לקוחות אמיתיים. מיילים ותשלומים מדומים.

## פקודות

| פקודה | מה רץ | דרישות |
|---|---|---|
| `bun run typecheck` | TypeScript לאפליקציה + לקוד הבדיקות | — |
| `bun run test:unit` | Vitest — לוגיקה טהורה (הרשאות, קופונים, מע"מ, מנויים, SEO, זיהוי דומיין) | — |
| `bun run test:scripts` | סקריפטי הבדיקה הישנים (`scripts/*-check.ts`) | — |
| `bun run test:db` | בדיקות SQL: כל המיגרציות מאפס על Postgres 16 מקומי + קבצי `scripts/db-tests/*.test.sql` | `postgresql-16` |
| `bun run test:db:rollback` | Rollback של המיגרציה החדשה על מסד נפרד (`rollback_test`): הגנת ה-rollback, החזרה למצב הקודם בדיוק, והרצה מחדש | `postgresql-16` |
| `bun run db:classify` | מחולל מחדש את `docs/architecture/db-classification.md` ואת בדיקת הכיסוי (אחרי `test:db`) | `postgresql-16` |
| `bun run e2e:up` | Supabase מקומי ב-Docker + כל המיגרציות + נתוני בדיקה | Docker |
| `bun run test:e2e` | Playwright — Regression לחנויות (בונה ומריץ את האפליקציה מול ה-Supabase המקומי) | `e2e:up` |
| `bun run e2e:down` | עצירה ומחיקה של ה-Supabase המקומי | — |

## בדיקות SQL — איך לקרוא את התוצאה

`run.sh` מריץ את אותן בדיקות **בשלושה מעברים**: מסד נקי, מסד נקי שוב
(אידמפוטנטיות של המיגרציה האחרונה), ומסד עם נתונים קיימים. כל שורה מדווחת:

```
[clean #1] 888/888 assertions passed (886 unique test names, 0 failed)
```

- **unique test names** — מספר הבדיקות הייחודיות (לפי שם).
- **assertions** — מספר הבדיקות שרצו במעבר אחד (שם יכול לרוץ יותר מפעם אחת).
- שלושת המעברים הם **אותן בדיקות** — לא לסכם אותם.

`tenant-isolation-coverage.test.sql` בודק כל טבלה עם `tenant_id` (גם טבלאות
עתידיות): RLS מופעל, ומדיניות `tenant_isolation` מסוג RESTRICTIVE או שאין ל-API
גישה לטבלה בכלל. החריגים (טבלאות פאנל הפלטפורמה) מתועדים בקובץ.

`db-classification.test.sql` (נוצר ע"י `bun run db:classify`): כל טבלה וכל פונקציה
ב-`public` משויכת למנוע (ecommerce / platform / platform-admin / shared-utility).
אובייקט חדש שלא סווג מכשיל את הבדיקה.

`platform-products-flags.test.sql` (Hospitality 1a): `site_type`, תפקידים לפי מוצר,
דגלי פיצ'רים, ה-seed הקיים של Ecommerce זהה לחלוטין, seed משותף.

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
| `platform.spec.ts` | פאנל הפלטפורמה: חנויות + הקמת חנות, אורח, בעל חנות אינו מנהל פלטפורמה, `/platform` חסום בדומיין חנות (403) |
| `isolation.spec.ts` | כל חנות רואה רק את המוצרים שלה (ממשק, API ישיר עם טוקן, sitemap) |
| `auth-regression.spec.ts` | התחברות בקוד למייל (משתמש קיים, משתמש חדש = לקוח ממתין כמו היום, קוד שגוי), פתיחת חנות דרך הפורטל (חנות + בעלים מוגן + seed), כפתור Google מבקש חזרה לכתובת של אותה חנות, ושרת ההתחברות מקבל רק כתובות חזרה מורשות (GitHub מקומית; Google ב-CI — דורש גישה ל-Google) |
| `seo.spec.ts` | `robots.txt` (צילום מדויק), `sitemap.xml` (רשימת הכתובות), `llms.txt`, meta / OG / canonical / JSON-LD ב-SSR |

### צילומי מסך

- הסף: עד 2% פיקסלים שונים (`maxDiffPixelRatio: 0.02`, `threshold: 0.25`),
  אנימציות כבויות — הבדלי רינדור זניחים לא מכשילים.
- הצילומים נשמרים ב-`e2e/tests/__screenshots__`. שינוי מכוון בעיצוב החנות =
  עדכון הצילום: `bun run test:e2e --update-snapshots` ובדיקה עינית של ההבדל.

### מגבלת התחברות

מסך ההתחברות מגביל ל-15 ניסיונות לכתובת IP ב-15 דקות (הגנה אמיתית — לא
עוקפים אותה). לכן כל משתמש מתחבר **פעם אחת** (`auth.setup.ts`) והבדיקות
משתמשות במצב שנשמר. הרצות חוזרות מקומיות מול אותו שרת תוך 15 דקות עלולות
להגיע למגבלה — מפעילים מחדש את השרת (הוא נסגר בסוף ההרצה כשהוא הופעל ע"י
Playwright).

## ידוע / פתוח

### סקריפטים יתומים

`scripts/excel-check.ts` ו-`scripts/watermark-check.ts` בודקים את
`src/lib/excel` ו-`src/lib/watermark.server` — **המודולים האלה לא קיימים בריפו
ומעולם לא היו בו** (שני הסקריפטים הגיעו בייבוא הראשוני של הקוד, `5f9d2bc`, בלי
המודולים). ייבוא מוצרים מקובץ בקוד הנוכחי נעשה ב-`src/lib/csv-import.ts` /
`src/server/services/csv-import.ts` (החבילה `xlsx` לא מיובאת בשום מקום), ואין
בקוד חתימת מים. אי אפשר לשחזר אותם בלי
לכתוב קוד אפליקציה חדש, ולכן `run-checks.sh` מדלג עליהם ומדווח על כך.
המלצה: למחוק אותם בשלב נפרד (באישור), או לכתוב בדיקות חדשות ל-`csv-import`.

`scripts/label-visual-check.ts` — בדיקה עינית ידנית (דורשת את החבילה הנייטיבית
`canvas`, שאינה מותקנת). לא רצה אוטומטית.

### Lint

`bun run lint` מחזיר 28 שגיאות עיצוב (prettier) בקבצים קיימים — בכוונה לא
תוקנו, כדי לא לגעת בקבצים שמפותחים במקביל. ב-CI: הקוד החדש של הבדיקות נבדק
בקפדנות, וה-lint המלא רץ לדיווח בלבד.

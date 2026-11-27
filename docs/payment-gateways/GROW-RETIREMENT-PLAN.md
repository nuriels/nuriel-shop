# Grow — הוצאה משימוש: בדיקה ותוכנית פעולה

**תאריך:** 27.11.2026
**ענף:** `payments/max-hyp`. נוסף רק המסמך הזה
**סטטוס:** בדיקה ותוכנית בלבד, לאישורכם

**מה לא נעשה:**
- לא שונה קוד פעיל.
- לא שונה המסד, ולא נמחקו נתונים, הזמנות, היסטוריית תשלומים או יומנים.
- לא הורצה מיגרציה.
- לא היה שינוי בייצור, ולא הייתה פריסה.
- הענף `platform/crawl-parity` לא נגע (נשאר ב-`910b1f9`).
- עבודת MAX/HYP לא נגעה: הדוח והראיות לא השתנו.

הגישה היחידה למסד הייתה למסד הבדיקות המקומי: שאילתות קריאה, ובדיקה אחת בטרנזקציה שבוטלה (ROLLBACK).

---

## 0. התשובות בקצרה

| שאלה | תשובה |
| --- | --- |
| **באיזה ענף נשמר Grow** | `archive/grow-integration`, בקומיט `d94d1fe` (מבוסס על `910b1f9`), והוא נדחף ל-GitHub. כל הקוד, הבדיקות וההגדרות של Grow נמצאים בו כמו שהם היום. בנוסף יש בו מדריך שחזור, ורשימת קבצים עם hash לכל קובץ |
| **אילו קבצים ורכיבים** | ‏8 קבצי קוד של Grow בלבד; ‏8 קבצים שמציגים היסטוריה; ‏5 קבצים משותפים עם נקודות חיבור; ‏2 קבצים שנוצרים אוטומטית; ‏2 מיגרציות, ‏2 טבלאות, ‏2 פונקציות ו-4 עמודות במסד; ‏3 משתני סביבה; ‏11 קובצי בדיקות וכלים; תיעוד. פירוט בסעיף 2 |
| **מה להסתיר או להוציא** | **שלב 0:** בדיקה בייצור, קריאה בלבד. **שלב 1 (מומלץ):** מתג אחד בקוד מכבה את Grow בקופה, במסך מנהל הפלטפורמה ובפונקציות השרת. בלי שינוי במסד ובלי מחיקת קבצים. **שלב 2 (בהמשך, באישור נפרד):** הוצאת הקבצים עצמם. פירוט בסעיף 3 |
| **איך מחזירים** | אחרי שלב 1: מבטלים קומיט אחד (`git revert`) ופורסים. אחרי שלב 2: משחזרים את הקבצים מענף הארכיון בפקודה אחת. המסד לא צריך שחזור, כי לא נמחק בו דבר. פירוט בסעיף 5 |

**MAX/HYP לא תלוי בקוד של Grow.** נמצאה תלות אחת, בטקסט ה-DDL המוצע ולא בקוד, ויש לה תיקון פשוט בשלב ב של MAX (סעיף 4).

---

## 1. ענף הארכיון

| | |
| --- | --- |
| ענף | `archive/grow-integration` |
| קומיט | `d94d1fe`. הקומיט הקודם, `d936178`, הוא אותו ארכיון, לפני שמספרי השורות במדריך הושלמו |
| בסיס | `910b1f9`, הקצה של `platform/crawl-parity`: הקוד של Release 207 (‏`a660467`), ועליו מסמכים |
| מה נוסף על הבסיס | רק שני מסמכים, בתיקייה `docs/archive/grow-integration/`: ‏`README.md` (מה שייך ל-Grow, איך מחזירים, ומה צריך לתקן לפני הפעלה מחדש) ו-`MANIFEST.tsv` (‏41 נתיבים, ולכל אחד git blob hash) |

**איך זה נבדק:**
- `git diff --stat 910b1f9 origin/archive/grow-integration` מראה רק את שני המסמכים. כלומר, הקוד בארכיון זהה לבסיס.
- כל 41 הקבצים שברשימה זהים (לפי blob hash) גם בענף הארכיון וגם בענף `payments/max-hyp` ב-`c174836`. זה נבדק שוב אחרי הקומיט האחרון.
- תשעת הקבצים של Grow עצמו זהים גם ל-`main` ב-`696ccf0`.
- **תרגול שחזור:** בעותק זמני של הענף הפעיל מחקנו את 9 הקבצים, שחזרנו אותם מענף הארכיון, ולא נשאר אף הבדל. העותק הזמני נמחק.
- הבדיקות על הקוד הזה עברו ב-CI run 209 (על `a660467`, שבו קוד Grow זהה).

**הכללים לענף:** לא ממזגים אותו לשום ענף, ולא מוחקים אותו. משחזרים ממנו קבצים לפי הצורך.

**המלצה (פעולה שלכם ב-GitHub, לא חובה):** להגן על הענף מפני מחיקה, אם האפשרות זמינה בחשבון שלכם: ‏Settings ← Rules ← Rulesets ← New branch ruleset, עם התבנית `archive/*`, והכללים Restrict deletions ו-Block force pushes.

---

## 2. מה שייך ל-Grow, ומה קורה לכל חלק

הרשימה המלאה, עם מספרי שורות, נמצאת ב-`README.md` שבענף הארכיון (סעיף 1 שם).

| קטגוריה | מה | בשלב 1 (מתג) | בשלב 2 (הוצאה) |
| --- | --- | --- | --- |
| **A — קוד של Grow בלבד** (8 קבצים) | `src/lib/grow.server.ts`, ‏`src/lib/grow-payments.functions.ts`, ‏`src/lib/grow-webhook.server.ts`, ‏`src/lib/grow-crypto.server.ts`, ‏`src/lib/platform-grow.functions.ts`, ‏`src/routes/api.webhooks.grow.ts`, ‏`src/routes/checkout_.grow.$orderId.tsx`, ‏`src/components/checkout/GrowPaymentPage.tsx` | נשארים בקוד. הפונקציות מסרבות כשהמתג כבוי (סעיף 3.2) | יוצאים. אפשר להחזיר אותם מהארכיון |
| **H — הצגת היסטוריה** (8 קבצים) | `GrowPaymentInfo.tsx` (מוצג ב-`OrderManagementPanel.tsx`), תוויות ב-`bit-payments.ts`, טיפוסים ב-`orders.ts`, מיילים (`order-email-data.server.ts`, ‏`order-emails.server.ts`, ‏`notifications.ts`), וניקוי כתובות ב-`gtm.ts` | נשארים, כדי שהזמנות Grow ישנות יוצגו נכון. מומלץ תיקון אחד: MX-07 (סעיף 3.2) | נשארים |
| **S — נקודות חיבור בקבצים משותפים** (5 קבצים) | `src/routes/checkout.tsx`, ‏`src/components/platform/CustomerFile.tsx`, ‏`src/lib/checkout.functions.ts`, ‏`src/lib/checkout.ts`, ‏`src/platform/engines/shared-functions.ts` | הקופה לא משתנה: האפשרות נעלמת, כי השרת מחזיר "לא זמין". הלשונית של Grow מוסתרת. מסלול האורח מסרב לבקשת Grow | מוציאים רק את ענפי Grow, בלי לגעת בשאר |
| **G — נוצרים אוטומטית** | `src/routeTree.gen.ts`, ‏`src/integrations/supabase/types.ts` | ללא שינוי | ‏`routeTree.gen.ts` נוצר מחדש. ‏`types.ts` נשאר, כי המסד לא משתנה |
| **D — מסד הנתונים** | המיגרציות `20261019520000_grow_payments.sql` ו-`20261101100000_ecommerce_engine_guard.sql` (שמגינה גם על `grow_payment_processes`); הטבלאות `tenant_grow_credentials` ו-`grow_payment_processes`; הפונקציות `grow_mark_paid` ו-`grow_payments_active`; ‏4 עמודות `grow_*` ב-`orders`; האילוץ `orders_payment_check`; ‏4 פונקציות משותפות שמכירות את `'grow'` | **ללא שינוי. לא נמחק כלום** | **ללא שינוי. לא נמחק כלום** |
| **E — סביבה** | `GROW_SECRETS_KEY` ו-`GROW_API_URL` (בשרת, ומועברים ב-`docker-compose.yml:51,53`); ‏`GROW_SANDBOX_URL` (לבדיקות בלבד) | נשארים | נשארים. **את `GROW_SECRETS_KEY` לא מוחקים:** בלעדיו אי אפשר לפענח את פרטי המסוף השמורים |
| **T — בדיקות וכלים** (11) | **יחידה:** `grow-webhook-failure`, ‏`grow-paid-late-alert`, ושורות ב-`gtm.test.ts` וב-`env-forwarding.test.ts`. **SQL:** ‏`grow-payments.test.sql`, ‏`ecommerce-engine-guard.test.sql`, ‏`db-classification.test.sql` והסקריפט `db-classification.mjs`. **E2E:** השרת המדומה, `app-up.sh` ו-`cart-checkout.spec.ts` | נשארים, ונוספות בדיקות למתג | בדיקות היחידה של Grow והחלקים של Grow בשרת המדומה יוצאים יחד עם הקוד. בדיקות ה-SQL נשארות, כי המסד נשאר |
| **X — תיעוד** | `docs/audit/GROW-VERIFICATION.md`, ‏`docs/audit/SECURITY-FINDINGS.md` ועוד | נשארים, עם הערה ש-Grow הוצא משימוש והפניה לארכיון | נשארים |

**לא קשורים ל-Grow:** בקבצים האלה המילה "grow" מופיעה במשמעות אחרת, ולכן לא נוגעים בהם: `src/components/ui/carousel.tsx`, ‏`src/components/ui/slider.tsx`, ה-CSS של אתרי העסקים, ובדיקות hospitality.

**אין ל-Grow משימות מתוזמנות.** אין הפניה ל-Grow בקוד המתזמן. פקיעת הזמנות שלא שולמו (`expire_unpaid_orders`, שנקראת מ-`src/server/services/payment-expiry.ts`) כללית לכל אמצעי התשלום, ונשארת כמו שהיא.

---

## 3. מה להסתיר או להוציא — התוכנית

### 3.1 שלב 0 — בדיקה בייצור, קריאה בלבד (אתם מריצים)

**למה:** לפי מסמכי השחרור, Grow כבוי בייצור (`docs/audit/RELEASE-2026-11-21.md:199`). הבדיקה מאמתת את זה על הנתונים האמיתיים, לפני ששלב 1 מסתיר את מסך Grow.

הפקודה רצה בשרת. היא פותחת טרנזקציה לקריאה בלבד ומסתיימת ב-ROLLBACK, ולכן לא יכולה לשנות שום דבר. זו אותה דרך חיבור שסקריפטי השחרור משתמשים בה (`deploy/release-crawl-parity.sh:101`):

```bash
docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN READ ONLY;
SELECT 'stores with Grow configured' AS what, count(*)::text AS value FROM public.tenant_grow_credentials
UNION ALL SELECT 'stores with Grow enabled', count(*)::text FROM public.tenant_grow_credentials WHERE enabled
UNION ALL SELECT 'enabled in sandbox mode', count(*)::text FROM public.tenant_grow_credentials WHERE enabled AND sandbox
UNION ALL SELECT 'Grow processes pending', count(*)::text FROM public.grow_payment_processes WHERE status = 'pending'
UNION ALL SELECT 'last Grow process', coalesce(max(created_at)::text, 'never') FROM public.grow_payment_processes
UNION ALL SELECT 'Grow orders (all)', count(*)::text FROM public.orders WHERE payment_method = 'grow'
UNION ALL SELECT 'Grow orders awaiting payment', count(*)::text FROM public.orders WHERE payment_method = 'grow' AND payment_status = 'awaiting'
UNION ALL SELECT 'Grow orders paid (history)', count(*)::text FROM public.orders WHERE payment_method = 'grow' AND payment_status = 'paid';
SELECT t.slug AS store_with_grow_enabled, g.sandbox, g.updated_at
  FROM public.tenant_grow_credentials g JOIN public.tenants t ON t.id = g.tenant_id
 WHERE g.enabled ORDER BY t.slug;
ROLLBACK;
SQL
```

**מה הפלט אמור להכיל:** טבלה של 8 שורות ספירה, ורשימה של החנויות שמופעל להן Grow (ריקה, אם אין כאלה). השאילתות נבדקו על מסד הבדיקות המקומי. הן עוברות, והרשימה נבדקה גם עם חנות אחת מופעלת, בטרנזקציה שבוטלה. הפלט לא מכיל סודות: רק ספירות, תאריך ושמות חנויות.

**מה עושים לפי התוצאה:**

| התוצאה | מה עושים |
| --- | --- |
| שגיאה שהטבלה לא קיימת | ‏Grow לא הותקן בייצור. אין מה לכבות, ואין היסטוריה |
| `stores with Grow enabled` = 0 | אין מה לכבות. אפשר להמשיך לשלב 1 |
| `stores with Grow enabled` > 0 | **לפני הפריסה של שלב 1** (שמסתיר את המסך): בכרטיס הלקוח של כל חנות ברשימה ← הלשונית "סליקה (Grow)" ← מבטלים את "פעיל" ← שמירה. פרטי המסוף נשארים שמורים ומוצפנים, ולא צריך להזין אותם שוב. ביומן נרשם `grow_disabled`. מאותו רגע המסד עצמו מסרב להזמנת Grow חדשה בחנות הזו (פירוט מתחת לטבלה) |
| `Grow processes pending` או `Grow orders awaiting payment` גדולים מ-0 | מחכים שיגיעו ל-0 לפני הפריסה של שלב 1. הזמנה שממתינה לתשלום פגה אחרי שעתיים |
| `Grow orders paid (history)` גדול מ-0 | לא עושים כלום. ההיסטוריה נשארת ומוצגת |

**איך המסד מסרב:**
- `orders_default_payment` בודק את `grow_payments_active`, וזה מחזיר "לא פעיל" כשהחנות כבויה.
- זה נבדק ב-`scripts/db-tests/grow-payments.test.sql:55-67`.
- זה נבדק שוב עכשיו, בטרנזקציה שבוטלה: "פעיל" לפני הכיבוי, ו"לא פעיל" אחריו.

**למה הכיבוי חייב לבוא לפני שלב 1:** לקוח רשום יוצר הזמנה ישירות מהדפדפן (`supabase.rpc("place_order")`, ‏`src/routes/checkout.tsx:842`). מתג בקוד השרת לא נמצא בדרך הזו, ולכן רק המסד יכול לסרב לבקשה מזויפת עם `grow`. המסד מסרב רק כשהחנות כבויה.

### 3.2 שלב 1 — מתג אחד שמכבה את Grow (מומלץ, אחרי אישורכם)

**העיקרון:** קוד Grow נשאר בענף, אבל אף מסלול פעיל לא מגיע אליו. אין שינוי במסד, אין מיגרציה ואין שינוי במשתני הסביבה. כדי להחזיר, מבטלים קומיט אחד.

**מה ביקשתם להסתיר, ומה קורה לכל חלק:**

| ביקשתם להסתיר את Grow מ... | מה יש שם היום | בשלב 1 |
| --- | --- | --- |
| ממשק הניהול | הלשונית "סליקה (Grow)" בכרטיס הלקוח, אצל מנהל הפלטפורמה | מוסתרת (שורה 5 בטבלה הבאה) |
| הגדרות התשלום | קריאה, שמירה ובדיקת חיבור של פרטי המסוף | השרת מסרב (שורה 6) |
| התהליכים הפעילים | האפשרות בקופה, פתיחת תהליך תשלום, מסלול האורח וה-webhook | כבויים (שורות 2–4). ה-webhook לפי החלטה G-2 (שורה 7) |
| האפשרויות של בעלי החנויות | לבעלי החנויות אין היום הגדרות Grow, כי רק מנהל הפלטפורמה מגדיר אותו. הם רואים רק את האפשרות בקופה של החנות שלהם, ואת ההיסטוריה של הזמנות ישנות | האפשרות נעלמת מהקופה. ההיסטוריה נשארת, עם מספר האישור והכרטיס |

**השינויים בקוד:**

| # | מה | איפה | ההשפעה |
| --- | --- | --- | --- |
| 1 | מודול חדש וקטן: `GROW_ENABLED = false`. אין בו סודות, ולכן אפשר להשתמש בו גם בדפדפן | `src/lib/grow-switch.ts` (חדש) | מקום אחד שקובע |
| 2 | `getGrowAvailability` מחזיר "לא זמין" | `src/lib/grow-payments.functions.ts:150-159` | האפשרות "תשלום מקוון" נעלמת מהקופה, **בלי לשנות את `checkout.tsx`**. הקופה כבר מציגה אותה רק כשהשרת מחזיר "זמין" (שורות 236–243, ‏340–349 ו-1537–1546) |
| 3 | `startGrowPayment` מסרב, בהודעה קבועה | אותו קובץ, `:31-112` | שום תהליך תשלום חדש לא נפתח מול Grow |
| 4 | מסלול האורח מסרב לבקשת `grow`, בהודעה ברורה. הוא לא ממיר אותה בשקט לאמצעי אחר | `src/lib/checkout.functions.ts:51` | הגנה נוספת. לקוח רשום מוגן במסד (שלב 0) |
| 5 | הלשונית "סליקה (Grow)" מוסתרת | `src/components/platform/CustomerFile.tsx:185,278-279` | מנהל הפלטפורמה לא רואה מסך Grow. התוויות ביומן הפעילות (`:102-110`) נשארות, כדי שרשומות ישנות יוצגו |
| 6 | `getGrowSettings`, ‏`saveGrowSettings` ו-`testGrowConnection` מסרבים | `src/lib/platform-grow.functions.ts:58`, ‏`:94`, ‏`:198` | אי אפשר להפעיל את Grow לחנות, גם בקריאה ישירה לשרת |
| 7 | ה-webhook, לפי החלטה G-2 | `src/routes/api.webhooks.grow.ts` | ראו מתחת לטבלה |
| 8 | תיקון MX-07: ענף Grow במייל לצוות נשלח רק כשההזמנה שולמה | `src/lib/order-emails.server.ts:82`. מוסיפים `payment.status === "paid"`, כמו בענף של כרטיס האשראי בשורה 99 | היום לקוח יכול לגרום לכך שיישלח לצוות מייל שאומר "שולם אונליין (Grow)" על הזמנה שלא שולמה (`docs/payment-gateways/evidence/08-security.md`, ‏MX-07). התיקון רלוונטי גם אחרי ההסתרה, כי הזמנות Grow ישנות נשארות במערכת |
| 9 | הערה בתיעוד | `docs/audit/GROW-VERIFICATION.md`, ‏`docs/audit/SECURITY-FINDINGS.md` | ‏"Grow הוצא משימוש ב-<תאריך>. הקוד שמור בענף `archive/grow-integration`" |

**ה-webhook (החלטה G-2):** ה-webhook פסיבי. הוא פועל רק על תהליך תשלום שכבר קיים (לפי hash של הטוקן), ולא יכול לפתוח תשלום חדש. יש שתי אפשרויות:
- **(א) להשאיר אותו עד שלב 2.** אם לקוח כבר שילם בדף של Grow, התשלום עדיין נרשם, וההתראה "שולם באיחור" ממשיכה לעבוד. מומלץ אם שלב 0 מראה שהיו תהליכי Grow בייצור.
- **(ב) לכבות אותו כבר בשלב 1** (תשובת 410, בלי עיבוד). מומלץ אם שלב 0 מראה `last Grow process = never`: אין תהליך שאפשר לאבד, ונקודת הכניסה הציבורית נסגרת.

**מה לא משתנה:** המסד, משתני הסביבה (`GROW_*` נשארים), הגיבויים, ומסלולי ביט, תשלום בטלפון ותשלום ידני.

**הבדיקות של שלב 1:**
- **יחידה:** כשהמתג כבוי, `getGrowAvailability` מחזיר "לא זמין". ‏`startGrowPayment`, שלוש פונקציות הניהול ומסלול האורח מסרבים. מייל הצוות על הזמנת Grow שלא שולמה לא אומר "שולם".
- **E2E:** בקופה אין `pay-grow-option`. בכרטיס הלקוח אין `tab-grow`. הזמנה רגילה והזמנה בביט עוברות כמו היום.
- **ללא שינוי:** בדיקות ה-SQL, כולל `grow-payments.test.sql`, כי המסד לא משתנה.
- **הסוללה המלאה:** typecheck, ‏lint, יחידה, SQL, ‏E2E, ‏build, ו-CI ירוק.

**פריסה:** קוד בלבד, בלי מיגרציה. הפקודות יינתנו אחת-אחת, ואתם מריצים אותן. לפני הפריסה מריצים שוב את שלב 0, ו-`stores with Grow enabled` חייב להיות 0.

### 3.3 שלב 2 — הוצאת הקבצים (אופציונלי, בהמשך, באישור נפרד)

**ההמלצה:** לא עכשיו. עדיף אחרי ש-MAX עולה לייצור ועובד ביציבות, ואחרי ששלב 0 מראה 0 תהליכים ו-0 הזמנות ממתינות במשך 30 יום לפחות (החלטה G-3).

**מה יוצא:**
- 8 הקבצים של קטגוריה A, ומודול המתג.
- ענפי Grow בקבצים המשותפים:
  - ב-`checkout.tsx`: ‏`growAvailable`, ‏`payByGrow`, ‏`goToGrow`, ‏`order.grow`, והטקסטים;
  - ב-`CustomerFile.tsx`: הלשונית ו-`GrowTab` (שורות 820–1029);
  - ב-`checkout.functions.ts`;
  - הטיפוס ב-`checkout.ts:157`;
  - השורה ב-`shared-functions.ts:22`.
- שתי בדיקות היחידה של Grow, והחלקים של Grow בשרת המדומה וב-`app-up.sh`.
- `routeTree.gen.ts` נוצר מחדש.

**מה נשאר:** הצגת ההיסטוריה (קטגוריה H), כל המסד, ‏`types.ts`, בדיקות ה-SQL, משתני הסביבה, התיעוד, והתוויות ביומן הפעילות.

**מה בודקים בשלב 2:** אותה סוללה מלאה, ובנוסף:
- ש-`env-forwarding.test.ts` עובר כשהקוד כבר לא קורא את משתני `GROW_*`;
- שבדיקת הגבולות של MAX (U17) ירוקה;
- שלא נשאר import שבור.

### 3.4 איפה עושים את העבודה (החלטה G-1)

| אפשרות | מה | יתרון | חיסרון |
| --- | --- | --- | --- |
| **(א) ענף נפרד `payments/retire-grow` (מומלץ)** | נפתח מ-`910b1f9`, בלי לגעת בענף `platform/crawl-parity` עצמו, ומכיל רק את שלב 1. שחרור קטן ונפרד, ואחר כך ממזגים אותו ל-`payments/max-hyp` | ‏Grow מוסתר בייצור בלי לחכות ל-MAX. השינוי קטן, וקל לבדוק אותו ולבטל אותו. ‏MAX ממשיך מבסיס שבו Grow כבר מוסתר | עוד שחרור אחד |
| (ב) ישירות ב-`payments/max-hyp` | שלב 1 כקומיט בענף של MAX | פחות ענפים | ההסתרה תגיע לייצור רק יחד עם MAX (שלב ו), והשינויים של שני הנושאים מתערבבים |

**סדר השחרורים:** הענף `payments/retire-grow` מבוסס על הקוד של Release 207, ולכן הוא ייצא אחרי Release 207. ‏Release 207 עדיין ממתין לפלט של `--check` ולאישור הנפרד שלכם.

---

## 4. ‏MAX/HYP לא תלוי בקוד של Grow

| בדיקה | מצב | הראיה |
| --- | --- | --- |
| ייבוא קוד | ✓ אין. עדיין אין קוד MAX, והתכנון אוסר ייבוא בשני הכיוונים | בדיקת הגבולות U17 (`tests/architecture/max-boundaries.test.ts`): ‏MAX לא מייבא מודולים של Grow או של ביט, והם לא מייבאים את MAX (`evidence/07-testing-plan.md:318`) |
| מפתח ההצפנה | ✓ נפרד | MAX משתמש ב-`PAYMENTS_SECRETS_KEY` (עם HKDF ו-AAD). לא ב-`GROW_SECRETS_KEY`, ולא ב-`grow-crypto.server.ts` |
| טבלאות | ✓ נפרדות | ‏5 טבלאות `payment_*` (ועוד אחת, אם החלטה 14 תאושר). ‏MAX לא משתמש ב-`tenant_grow_credentials` או ב-`grow_payment_processes` |
| סימון "שולם" | ✓ נפרד | ‏`max_attempt_mark_paid`, לא `grow_mark_paid` |
| ערך אמצעי התשלום | ✓ נפרד | `'online'` (החלטה 2), לא `'grow'` |
| מסך הניהול | ✓ נפרד | ל-MAX יש לשונית משלו. הוא לא משתמש ב-`GrowTab` |
| עמוד התשלום | ✓ נפרד | `OnlinePaymentPage` חדש. הוא בנוי בדומה לעמוד של Grow, אבל לא מייבא אותו |
| **ה-DDL המוצע ל-`place_order`** | **⚠ תלות אחת — בטקסט, לא בקוד** | התיקון ל-`place_order` ול-`place_guest_order` מחפש את השורה של Grow, ומוסיף אחריה את השורה של MAX (`evidence/06b-proposed-ddl.sql.txt:1110-1122`). אם השורה של Grow תוסר מהמסד בעתיד, המיגרציה של MAX תיכשל (בגלוי, עם שגיאה). **התיקון, בשלב ב של MAX:** לחפש במקומה את השורה של ביט, `WHEN _details ->> 'payment_method' = 'bit' THEN 'bit'`. בדיקה קיימת מחייבת שהיא תישאר (`scripts/db-tests/remove-hyp.test.sql:89-92`) |
| האילוץ `orders_payment_check` | ✓ תלות מכוונת בנתונים, לא בקוד | ה-DDL המוצע משאיר את `'grow'` ואת התנאים על עמודות `grow_*` (`06b:1063-1076`), כי הזמנות Grow ישנות חייבות להישאר תקינות. זה נשאר כך |
| הבדיקות "Grow לא השתנה" | ✓ ממשיכות לעבור | בתוכנית MAX יש חתימות md5 שמוכיחות ש-`grow_mark_paid` ו-`grow_payments_active` לא השתנו (דוח MAX, סעיף 6.4). התוכנית הזו לא משנה את המסד, ולכן הן ממשיכות לעבור |

**מה משתנה בתוכנית MAX בעקבות ההחלטה** (לעדכן בדוח אחרי שתאשרו):
- **החלטה 6** (חסימת שינוי פריטים בהזמנה שממתינה לתשלום, ותיקון הפרצה הקיימת): כש-Grow כבוי, התיקון בקוד הקיים נוגע לביט בלבד.
- **המגבלה "אין שינוי במנגנון Grow"** מהבקשה הקודמת מתחלפת בתוכנית הזו: שלב 1 משנה את Grow (מכבה אותו), ורק אחרי אישורכם.
- **הערה שעלתה בבדיקה:** ה-DDL המוצע (`06b`) כתוב עם הערך `'max'`, וההמלצה בהחלטה 2 היא `'online'`. בשלב ב ה-DDL ייכתב לפי מה שתאשרו.

---

## 5. איך מחזירים את Grow

### מקרה 1 — בוצע רק שלב 1 (המתג כבוי)

1. `git revert <הקומיט של שלב 1>`, או משנים ל-`GROW_ENABLED = true`.
2. מריצים בדיקות: יחידה (`tests/unit/grow-*.test.ts`), ‏SQL (`grow-payments.test.sql`), ו-E2E של הקופה.
3. בשרת מוודאים ש-`GROW_SECRETS_KEY` ו-`GROW_API_URL` עדיין קיימים.
4. מטפלים בממצאים הפתוחים (למטה). רק אחר כך מפעילים חנות בלשונית Grow. פרטי המסוף השמורים נשארו במסד, ולכן לא צריך להזין אותם שוב.

### מקרה 2 — בוצע גם שלב 2 (הקבצים הוצאו)

```bash
git fetch origin archive/grow-integration
git checkout origin/archive/grow-integration -- \
  src/lib/grow.server.ts src/lib/grow-payments.functions.ts src/lib/grow-webhook.server.ts \
  src/lib/grow-crypto.server.ts src/lib/platform-grow.functions.ts \
  src/routes/api.webhooks.grow.ts 'src/routes/checkout_.grow.$orderId.tsx' \
  src/components/checkout/GrowPaymentPage.tsx \
  tests/unit/grow-webhook-failure.test.ts tests/unit/grow-paid-late-alert.test.ts
```

- **קובצי ההיסטוריה (H)** נשארים בענף הפעיל גם בשלב 2, ולכן הם לא ברשימה. אם בעתיד יוצאו גם הם, הרשימה המלאה נמצאת ב-README שבענף הארכיון.
- **הקבצים המשותפים (S):** מחזירים את ענפי Grow בעזרת `git revert` על הקומיט של שלב 2, או ידנית לפי `git diff 910b1f9 -- <file>`. לא דורסים אותם מהארכיון, כי סביר שהם ישתנו עד אז (למשל, MAX יוסיף להם ענף משלו).
- `routeTree.gen.ts` נוצר מחדש ב-build.
- אחר כך: אותן בדיקות ואותם תנאים כמו במקרה 1.

### המסד והמפתח

- **המסד:** אין מה לשחזר, כי לא נמחק בו דבר.
- **המפתח:** אם `GROW_SECRETS_KEY` אבד, עדיין אפשר להחזיר את Grow, אבל צריך להזין מחדש את פרטי המסוף.

### לפני הפעלה מחדש — ממצאים פתוחים

הפירוט נמצא ב-README שבענף הארכיון (סעיף 3), וב-`docs/payment-gateways/evidence/08-security.md`:
- S-2/MX-03
- MX-01, ‏MX-02, ‏MX-04
- MX-07 (אם לא תוקן בשלב 1)
- MX-10, ‏MX-13, ‏MX-14

---

## 6. ההחלטות שלכם

| # | השאלה | ההמלצה |
| --- | --- | --- |
| G-1 | איפה עושים את שלב 1 | בענף נפרד, `payments/retire-grow`, מ-`910b1f9`. שחרור קטן אחרי Release 207, ואחר כך מיזוג ל-`payments/max-hyp` (סעיף 3.4) |
| G-2 | מה עושים ב-webhook בשלב 1 | לפי שלב 0. אם היו תהליכי Grow — להשאיר אותו עד שלב 2. אם `last Grow process = never` — לכבות אותו (410) |
| G-3 | מתי שלב 2 | אחרי ש-MAX יציב בייצור, ואחרי 30 יום בלי תהליכי Grow. אפשר גם לוותר עליו, ולהשאיר את Grow מוסתר |
| G-4 | לתקן את MX-07 בשלב 1 | כן. זה שינוי של שורה אחת, והוא רלוונטי גם להזמנות ישנות |
| G-5 | חנויות שמופעל להן Grow (אם יש) | לכבות אותן בלשונית Grow לפני הפריסה של שלב 1 |
| G-6 | משתני `GROW_*` בשרת ובגיבויים | להשאיר אותם, ובמיוחד את `GROW_SECRETS_KEY` |

**אחרי שתאשרו:** ייפתח הענף שתבחרו, ויבוצע בו שלב 1 עם הבדיקות. אחר כך תרוץ הסוללה המלאה ו-CI, ותקבלו את פקודות הפריסה אחת-אחת. העבודה תיעצר לפני כל פעולה בייצור.

**מה נדרש מכם עכשיו:**
1. הפלט של שלב 0.
2. החלטות G-1 עד G-6.

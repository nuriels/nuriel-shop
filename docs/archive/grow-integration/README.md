# ארכיון: אינטגרציית Grow (משולם)

**מה זה:** ענף ארכיון. **לא ממזגים אותו ולא מוחקים אותו.** הוא שומר את המצב המלא של קוד Grow מהרגע שבו הוחלט להפסיק להשתמש בו (27.11.2026), כדי שאפשר יהיה להחזיר אותו בעתיד. ההחלטה: מתמקדים בסליקת MAX / Hyp.

| | |
| --- | --- |
| ענף | `archive/grow-integration` |
| בסיס | `910b1f9` — כל המאגר כפי שהיה, ועליו רק התיקייה הזו (מסמכים) |
| שקילות | כל 41 הקבצים הקשורים זהים (לפי git blob) לענף הפעיל `payments/max-hyp` ב-`c174836`. תשעת הקבצים של Grow עצמו זהים גם ל-`main` ב-`696ccf0` |
| בדיקות על הקוד הזה | ‏CI run 209 (על `a660467`, שבו קוד Grow זהה) עבר: יחידה, SQL כולל `grow-payments.test.sql`, ו-E2E |
| תרגול שחזור | עבר: מחקנו את 9 קבצי Grow בעותק זמני של הענף הפעיל, שחזרנו אותם מהענף הזה, ולא נשאר אף הבדל |

רשימת הקבצים המלאה, עם hash לכל קובץ: `MANIFEST.tsv` בתיקייה הזו.

---

## 1. מה שייך ל-Grow

### א. קוד של Grow בלבד (קטגוריה A)

| קובץ | תפקיד |
| --- | --- |
| `src/lib/grow.server.ts` | לקוח HTTP מול Grow: יצירת תהליך תשלום, `approveTransaction`, ניתוח ה-webhook |
| `src/lib/grow-payments.functions.ts` | ‏`startGrowPayment`, ‏`getGrowPaymentStatus`, ‏`getGrowAvailability` |
| `src/lib/grow-webhook.server.ts` | עיבוד ה-webhook: `grow_mark_paid`, מיילים, התראה על "שולם באיחור" |
| `src/lib/grow-crypto.server.ts` | ‏AES-256-GCM לפרטי המסוף (מפתח מ-`GROW_SECRETS_KEY`) |
| `src/lib/platform-grow.functions.ts` | מסך מנהל הפלטפורמה: קריאה, שמירה ובדיקת חיבור |
| `src/routes/api.webhooks.grow.ts` | נקודת ה-webhook (‏`POST /api/webhooks/grow`) |
| `src/routes/checkout_.grow.$orderId.tsx` | עמוד התשלום של הלקוח |
| `src/components/checkout/GrowPaymentPage.tsx` | רכיב עמוד התשלום |

### ב. הצגת היסטוריה (קטגוריה H) — נשארים גם בענף הפעיל

הם מציגים הזמנות Grow ישנות, ולכן **לא מוציאים אותם:**
- `src/components/orders/GrowPaymentInfo.tsx`, ושימוש בו ב-`src/components/OrderManagementPanel.tsx:36,782-783`;
- תוויות: `src/lib/bit-payments.ts:17,30,52`;
- טיפוסים ועמודות: `src/lib/orders.ts:314,323-327,338`;
- מיילים: `src/lib/order-email-data.server.ts:64-67,99,184,266,293-295`, ‏`src/lib/order-emails.server.ts:82-97`, ‏`src/server/services/notifications.ts:341-343,396-401`;
- Analytics: `src/platform/analytics/gtm.ts:92,99`, שמנקה כתובות `/checkout/grow/...`.

### ג. נקודות חיבור בקבצים משותפים (קטגוריה S)

| קובץ | שורות |
| --- | --- |
| `src/routes/checkout.tsx` | 91, ‏236–243 (טעינת הזמינות), ‏340–349 (הבחירה), ‏783, ‏816–828, ‏853, ‏867, ‏913–914 (מעבר לעמוד התשלום), ‏1475–1546 ו-1662–1685 (טקסטים וכפתורים) |
| `src/components/platform/CustomerFile.tsx` | 36–40, ‏102–110 (תוויות יומן), ‏185, ‏278–279 (הלשונית), ‏820–1029 (תוכן הלשונית: `GROW_TYPES` ו-`GrowTab`) |
| `src/lib/checkout.functions.ts` | 51, ‏140–144, ‏154 |
| `src/lib/checkout.ts` | 157 (`PaymentMethodChoice`) |
| `src/platform/engines/shared-functions.ts` | 22 (רשימת הפונקציות המשותפות) |

**קבצים שנוצרים אוטומטית (קטגוריה G):** `src/routeTree.gen.ts`, ‏`src/integrations/supabase/types.ts`.

### ד. מסד הנתונים (קטגוריה D) — **לא נמחק כלום**

המיגרציה: `supabase/migrations/20261019520000_grow_payments.sql`. **אין לה קובץ rollback**, כי היא קודמת למדיניות ה-rollback. ‏`20261101100000_ecommerce_engine_guard.sql` מוסיפה את `grow_payment_processes` לרשימת ההגנה.

**אובייקטים שקיימים במסד ונשארים בו:**
- טבלאות: `tenant_grow_credentials` (פרטי מסוף מוצפנים, `enabled`, ‏`sandbox`, ‏`max_payments`) ו-`grow_payment_processes` (היסטוריית תהליכי התשלום).
- פונקציות: `grow_mark_paid(...)` ו-`grow_payments_active(uuid)`.
- עמודות ב-`orders`: ‏`grow_asmachta`, ‏`grow_transaction_id`, ‏`grow_card`, ‏`grow_installments`.
- האילוץ `orders_payment_check`. הוא כולל `'grow'`, וחייב להישאר כך כל עוד יש הזמנות Grow ישנות.
- פונקציות משותפות שמכירות את `'grow'`: ‏`orders_default_payment`, ‏`orders_payment_guard`, ‏`place_order`, ‏`place_guest_order`.
- טריגרים על `grow_payment_processes`: ‏`ecommerce_rows_guard` ו-`ecommerce_row_move_guard`.

### ה. הגדרות וסביבה (קטגוריה E) — **שמות בלבד, ערכים לא נשמרים ב-Git**

| משתנה | מה | איפה |
| --- | --- | --- |
| `GROW_SECRETS_KEY` | מפתח ההצפנה של פרטי המסוף, לפחות 24 תווים | `.env` בשרת. מועבר ב-`docker-compose.yml:51`. נוצר פעם אחת ב-`deploy/setup-selfhost.sh` ולא נדרס. נכלל ברשימת הסודות של הגיבוי (`deploy/backup-daily.sh:229`) |
| `GROW_API_URL` | כתובת ה-API של Grow (חייבת להיות HTTPS) | `.env` בשרת, ומועבר ב-`docker-compose.yml:53` |
| `GROW_SANDBOX_URL` | כתובת לבדיקות בלבד | `TEST_ONLY` ב-`tests/unit/env-forwarding.test.ts:17` |

**חשוב:** כדי שפרטי המסוף השמורים במסד יישארו קריאים בעתיד, **לא מוחקים ולא מחליפים את `GROW_SECRETS_KEY`** בשרת ובגיבויים. אם המפתח אבד, מנהל הפלטפורמה יזין מחדש את פרטי המסוף.

ההגדרות לכל חנות (מופעל, sandbox, מספר תשלומים, סוגי עסקאות) נשמרות במסד, בטבלה `tenant_grow_credentials`, ונשארות שם.

### ו. בדיקות וכלים (קטגוריה T)

- **יחידה:** `tests/unit/grow-webhook-failure.test.ts`, ‏`tests/unit/grow-paid-late-alert.test.ts`, ‏`tests/unit/gtm.test.ts:73-74,280-282`, ‏`tests/unit/env-forwarding.test.ts:17`.
- **SQL:** `scripts/db-tests/grow-payments.test.sql`, ‏`scripts/db-tests/ecommerce-engine-guard.test.sql:44`, ‏`scripts/db-tests/db-classification.test.sql`, ‏`scripts/db-classification.mjs:35,48`.
- **E2E:** `e2e/scripts/mock-services.mjs:7` (מחזיר 503 לכל קריאת Grow), ‏`e2e/scripts/app-up.sh`, ‏`e2e/tests/cart-checkout.spec.ts:4`.

### ז. תיעוד (קטגוריה X)

- `docs/audit/GROW-VERIFICATION.md`: מה הוכח ומה לא.
- `docs/audit/SECURITY-FINDINGS.md`: ממצא S-2.
- הסקירה המלאה של הממצאים: `docs/payment-gateways/evidence/08-security.md` בענף `payments/max-hyp`.

---

## 2. איך מחזירים את Grow

### מקרה 1 — בענף הפעיל Grow רק **הוסתר** במתג (התוכנית המומלצת)

1. מבטלים את הקומיט של ההסתרה (`git revert <commit>`), או מחזירים את המתג ל"פעיל".
2. מריצים את הבדיקות: יחידה (`tests/unit/grow-*.test.ts`), SQL ‏(`scripts/db-tests/grow-payments.test.sql`) ו-E2E ‏checkout.
3. מוודאים ש-`GROW_SECRETS_KEY` ו-`GROW_API_URL` קיימים בשרת.
4. מטפלים ברשימה שבסעיף 3, ורק אחר כך מנהל הפלטפורמה מפעיל חנות במסך Grow.

### מקרה 2 — בענף הפעיל הקבצים **הוצאו** (שלב 2 בתוכנית)

```bash
git fetch origin archive/grow-integration
# קוד Grow בלבד (קטגוריות A ו-H), בדיוק כמו בארכיון:
git checkout origin/archive/grow-integration -- \
  src/lib/grow.server.ts src/lib/grow-payments.functions.ts src/lib/grow-webhook.server.ts \
  src/lib/grow-crypto.server.ts src/lib/platform-grow.functions.ts \
  src/routes/api.webhooks.grow.ts 'src/routes/checkout_.grow.$orderId.tsx' \
  src/components/checkout/GrowPaymentPage.tsx src/components/orders/GrowPaymentInfo.tsx \
  tests/unit/grow-webhook-failure.test.ts tests/unit/grow-paid-late-alert.test.ts
```

**קבצים משותפים (קטגוריה S):** סביר שהשתנו מאז, ולכן לא דורסים אותם. מחזירים רק את הקטעים של Grow לפי `git diff 910b1f9 -- <file>` והשורות בסעיף 1.ג, או עם `git revert` על קומיט ההוצאה.

**אחר כך:**
- יצירה מחדש של `src/routeTree.gen.ts` (בזמן build או dev);
- אותן בדיקות כמו במקרה 1;
- אותם תנאים לפני הפעלה (סעיף 3).

### מסד הנתונים

אין מה לשחזר: האובייקטים לא נמחקו. אם בעתיד ייכתב מיגרציה שמסירה אותם, היא תצטרך rollback משלה. המקור לשחזור הוא `supabase/migrations/20261019520000_grow_payments.sql` שבענף הזה.

---

## 3. לפני שמפעילים מחדש — ממצאים פתוחים שחייבים לטפל בהם

| ממצא | הבעיה |
| --- | --- |
| S-2 / MX-03 | אין אישור מצד Grow לפני הסימון "שולם", ומזהה העסקה לא ייחודי |
| MX-01 | לקוח יכול להוסיף פריטים להזמנה שממתינה לתשלום, וגם להזמנה שכבר שולמה. ‏`grow_mark_paid` משווה רק לסכום של התהליך. נבדק בהרצה בטרנזקציה שבוטלה: 100 → 300 → 400, וההזמנה נשארה "שולם" |
| MX-02 | תשלום במצב sandbox יכול לסמן הזמנה אמיתית כ"שולם" (ה-webhook מנסה `sandbox=false` ואחר כך `true`) |
| MX-04 | תהליך ישן או מוחלף עדיין יכול לסמן "שולם". תשלום שני מסומן "שולם אחרי שפג תוקף" |
| MX-07 | מייל לצוות אומר "שולם אונליין (Grow)" גם על הזמנה שלא שולמה, והלקוח יכול להפעיל אותו |
| MX-10 | ההצפנה בלי HKDF, בלי AAD ובלי מזהה מפתח |
| MX-13 | מזהה ההזמנה לבדו פותח את עמוד התשלום, עם פרטי הלקוח ממולאים |
| MX-14 | פונקציות הניהול לא מחייבות את כתובת הפלטפורמה |

**לא ממזגים את הענף הזה לשום ענף.** משחזרים ממנו קבצים לפי הצורך.

# ממצאי אבטחה — ביקורת הפלטפורמה (17.11.2026)

ענף: `audit/platform-review-2026-11`. הדוח הגולמי של סוכן האבטחה (Opus): [`interim/security-auditor.md`](interim/security-auditor.md).
שיטה: שאילתות קטלוג על מסד בדיקות מקומי (קריאה בלבד), סריקות סטטיות, ואחריהן קריאה ממוקדת. סבבי האבטחה הקודמים (`docs/security/remediation-2026-11.md`, `docs/maintenance/night-2026-11-13.md`) נקראו קודם ולא דווחו שוב.

## סיכום

| חומרה    | כמות | סטטוס                                                                       |
| -------- | ---- | --------------------------------------------------------------------------- |
| Critical | 0    | —                                                                           |
| High     | 0    | —                                                                           |
| Medium   | 2    | S-1 אומת (קטלוג + קוד, ושאילתות שהרצתי בעצמי); S-2 חשד (תלוי בהתנהגות Grow) |
| Low      | 2    | אחד אומת, אחד חשד                                                           |
| Info     | 2    | אומתו                                                                       |

**לא תוקן בביקורת הזו:** כל הממצאים כאן דורשים מיגרציה (שמשנה הרשאות במסד) או החלטת מוצר/תפעול, והם נוגעים בנתיב הקופה החם. אין מיגרציה חדשה בענף הביקורת בכוונה: אפשר לפרוס אותו בלי שינוי במסד. התיקונים מוצעים להמשך, באישור.
(תיקון אבטחה-קרוב שכן בוצע: B-1 — תשובת 500 ל-Grow כשסימון תשלום נכשל; B-5 — מחיקת קבצי חוזים/אסמכתאות בעת מחיקת עסק; D-1 — הסרת `xlsx` והעלאת DOMPurify. ראו `BUGS-AND-FIXES.md`.)

## ממצאים

### S-1 · Medium · `place_order` ו-INSERT ל-`orders` נגישים ישירות מ-PostgREST, בלי הגבלת קצב — **אומת**

- **איפה:** הדפדפן קורא ל-`supabase.rpc("place_order")` ישירות (`src/routes/checkout.tsx:842`); אובייקטי DB: `public.place_order`, טריגר `orders_apply_coupon`, מדיניות `orders insert by customer or staff`.
- **הוכחה (הורצה על מסד מקומי עם כל 199 המיגרציות):**
  - `place_order(text,jsonb,numeric,boolean,jsonb)`: `authenticated` = `t`, `anon` = `f`, `prosecdef` = `f` (מתבצעת בהרשאות הקורא).
  - מדיניות INSERT על `orders`: `customer_id = auth.uid() OR is_admin(...) OR (is_agent(...) ...)`.
  - אין `rate_check` / `allowAction` בגוף `place_order` או בטריגרים של `orders` (חיפוש בכל המיגרציות).
  - הודעות השגיאה של הקופון מבדילות בין "לא נמצא", "פג תוקף" ו"נוצל" — אורקל. ההגבלה הקיימת (`checkCoupon`: 20 ל-10 דקות, `marketing.functions.ts:59`) עוקפת בקלות.
- **תרחיש:** לקוח רשום בחנות מריץ סקריפט על `POST /rest/v1/rpc/place_order` עם ה-JWT שלו; מנחש קודי קופון, או מחזיק את כל המלאי בהזמנות "ממתינות", או מציף התראות צוות.
- **השפעה:** ניצול הנחות, מניעת שירות במלאי (מלאי שמור עד שהצוות מבטל), ספאם בהתראות. דורש חשבון לקוח רשום באותה חנות.
- **תיקון מומלץ:** להעביר קופה של מחובר לפונקציית שרת עם `allowAction` (כמו `placeGuestOrder`), ואז `REVOKE EXECUTE ON place_order FROM authenticated` והסרת ענף הלקוח ממדיניות ה-INSERT. חלופה: הגבלה בצד DB לפי `auth.uid()` (הזמנות לשעה, ניסיונות קופון כושלים) והחזרת שגיאת קופון אחת גנרית ללא-צוות.
- **אימות לאחר תיקון (תוכנית):** בדיקת SQL — `authenticated` לא יכול להריץ `place_order`; בדיקת E2E של קופה מחוברת; ניסיון 25 קריאות רצופות נחסם.

### S-2 · Medium (אם הטוקן נחשף ללקוח; אחרת Low) · webhook של Grow סומך על `processToken` בלי אימות מול Grow — **חשד**

- **איפה:** `src/lib/grow-webhook.server.ts:24-45`, `grow_mark_paid`, `src/routes/api.webhooks.grow.ts:16`.
- **הוכחה:** ה-webhook פתוח (רק הגבלת קצב 300 ל-10 דקות ל-IP). `grow_mark_paid` מסמן "שולם" אם `sha256(processToken)` תואם, `statusCode = '2'` והסכום תואם. `approveGrowTransaction` נקרא רק **אחרי** הסימון ותוצאתו לא נבדקת. אף קריאה ל-`getTransactionInfo` של Grow לא מאשרת את התשלום. `processId`/`processToken` נשארים בצד שרת (לדפדפן מגיע רק `url`).
- **תרחיש:** אם דף התשלום או ה-redirect של Grow חושפים את `processId`/`processToken` לשולם — הוא יכול לשלוח `statusCode=2` מזויף עם הסכום הנכון ולקבל הזמנה "שולמה". לא נבדק מול Grow (אין גישת רשת).
- **תיקון מומלץ:** לפני `grow_mark_paid` לאשר מול Grow (`getTransactionInfo` עם מפתח ה-API) שהעסקה קיימת, משולמת ובאותו סכום; לחלופין לרשום "נטען כשולם" ולהפוך ל"שולם" רק אחרי אישור; ייחודיות על `transactionId`.
- **הערה:** B-1 (500 במקום 200 בכשל סימון) לא משנה את מודל האימות — הוא רק מבטיח ש-Grow ינסה שוב כשהשרת נכשל.

### S-3 · Low · חשבון הזמנת בעלים נוצר עם `email_confirm: true` למייל שלא הוכח — **חשד** (נתיב הקוד אומת)

- **איפה:** `src/platform/auth/accounts.server.ts:66-72`; ההערה ב-`owner-invite.functions.ts:5` אומרת "המייל לא מסומן כמאומת".
- **תרחיש:** מי שמחזיק בקישור ההזמנה מקליד `victim@gmail.com` וסיסמה. אם בהמשך הקורבן נכנס עם Google ו-GoTrue מקשר זהויות לפי מייל מאומת — חשבון התוקף מקבל את הזהות ואת התפקידים העתידיים של הקורבן (pre-hijacking).
- **תיקון:** ליצור עם `email_confirm: false` ולסמן מאומת רק ב-`bp_owner_email_code_verify`; לתקן את ההערה.
- **לא נבדק:** התנהגות קישור הזהויות של גרסת GoTrue בייצור.

### S-4 · Low · "סקוואטינג" דומיין מותאם — **אומת**

- **איפה:** `20261117090000_bp_site_address.sql:373-378` (`bp_custom_domain_set`) והאינדקס `tenants_custom_domain_key UNIQUE (custom_domain)` — לא מתחשבים באימות.
- **תרחיש:** מנהל של חנות/אתר שומר `www.victim.co.il` כדומיין מותאם ולא מאמת; הבעלים האמיתי מקבל "הדומיין כבר מחובר לאתר אחר" ללא הגבלת זמן.
- **השפעה:** מניעת שירות בהקמה (עומס תמיכה). לא חוטפים תנועה — הניתוב מחייב אימות.
- **תיקון:** האינדקס הייחודי רק על דומיינים מאומתים + פינוי תביעות לא מאומתות אחרי N ימים.

### S-5 · Info · מפתח ה-HMAC של קוד האימות נופל ל-`SUPABASE_SERVICE_ROLE_KEY` — **אומת**

`owner-invite.functions.ts:63-67`: `BUSINESS_PROFILE_SECRET || LOGIN_CODE_SECRET || SUPABASE_SERVICE_ROLE_KEY`. המפתח נגזר דרך `createHmac` (סיכון נמוך), אך קושר שני סודות. כעת, אחרי C-2, אפשר סוף-סוף להגדיר `BUSINESS_PROFILE_SECRET` בשרת. מומלץ לדרוש אחד משני הסודות ולהיכשל סגור.

### S-6 · Info · הרשאות רחבות (כולל TRUNCATE) ל-`anon`/`authenticated` — **אומת בקטלוג**

`information_schema.role_table_grants`: TRUNCATE ל-`anon` על 20 טבלאות ול-`authenticated` על 25. RLS לא חל על TRUNCATE; PostgREST ו-pg_graphql לא חושפים אותו, ולכן לא ניתן לניצול כיום. מומלץ `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public, hospitality FROM anon, authenticated` ושלילת DML מטבלאות בלי מדיניות כתיבה.

## נבדק ונמצא תקין

- **RLS:** כל הטבלאות (`relkind r/p`) ב-`public`, `hospitality`, `business_profile`, `billing`, `e2e` — `relrowsecurity = true`. אין views.
- **SECURITY DEFINER:** 866 מתוך 1071 פונקציות; כולן עם `search_path` מקובע (0 בלי). אין CREATE ל-anon/authenticated בסכמות האפליקציה.
- **94 פונקציות definer שנגישות ל-anon:** טריגרים, עוזרי קריאה ציבוריים, RPC לפי טוקן (`_token`) ו-`quote`/`quote_type` (מסרבות לקוד קידום מ-anon/authenticated — SEC-L4 במקומו). `request_booking*` לא חשופות.
- **הפרדת Tenants:** ה-header `x-tenant-id` וזיהוי ה-Host לא ניתנים לזיוף בדרך שמגיעה לנתוני עסק אחר. כל פונקציות `platform_*` בודקות מנהל פלטפורמה.
- **מחירים ומע"מ:** מחושבים מחדש תמיד ב-DB. מגבלות העלאה, SSRF guard, CSRF middleware, ההזמנות ומיגרציות הכתובת החדשות, וולידציית מזהי GA4/GTM — תקינים.
- **סודות ב-Git:** סריקת התבניות (`sk-ant-`, `AKIA`, מפתחות פרטיים, JWT, `ghp_`, `xox`, `re_`) על כל הקבצים במעקב — רק מחרוזות מדומות בבדיקות. אין `.env`/dump/מפתח במעקב (`.env.example` ו-`deploy/.env.production.example` הם תבניות).
- **תלויות:** ראו `DEPENDENCY-REVIEW.md` (`bun audit`: 27 → 20, קריטי 1 → 0, אף אחת מהנותרות לא נשלחת בבאנדל הדפדפן/השרת מעבר ל-`zod` הצר).

## מגבלות

לא נסרקו מחדש שורה-שורה כל 400+ פונקציות השרת הישנות (נסרקו בלילה של 13.11); נדגמו `orders`, `checkout`, `auth` ופונקציות האורח/ציבור של Hospitality, ונקרא כל הקוד החדש מאז `e394df5`. לא ניתן היה לבדוק את התנהגות דף התשלום של Grow ואת הגדרות GoTrue/Kong בייצור (אין רשת). לוגים: `email.server.ts:311` רושם גוף שגיאת Resend, ו-`auth.functions.ts` רושם שם משתמש שלא נמצא — דליפות PII קלות שכבר מכוסות ב-PRV-16.

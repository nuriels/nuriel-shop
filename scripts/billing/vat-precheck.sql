-- ============================================================
-- בדיקה בקריאה בלבד לפני פריסת מיגרציה 191 (מע"מ לפי סוג העוסק). לא משנה דבר:
-- רצה ב-BEGIN READ ONLY ומסתיימת ב-ROLLBACK, כך שגם כתיבה בטעות הייתה נכשלת.
--
-- הרצה (רק באישור, מתיקיית הקוד בשרת):
--   docker exec -i nuriel-shop-db psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 < scripts/billing/vat-precheck.sql
--
-- מה היא מראה — מי יושפע מהשינוי, לפני שהוא קורה:
--   1. כל החנויות: סוג העוסק, השיעור השמור, "כולל מע"מ"
--   2. חנויות "מורשה" ששמור אצלן שיעור שונה מ-18% — אחרי 191 הזמנות חדשות שלהן יחושבו ב-18% (השיעור
--      המרכזי). ההזמנות הקיימות שלהן לא משתנות.
--   3. חנויות "פטור" ששמור אצלן "המחירים לא כוללים מע"מ" — אין לזה השפעה על סכום (0%), רק על התצוגה
--   4. ההזמנות לפי שיעור ו"כולל מע"מ" — מה שנשמר בהן היום (לא משתנה)
--   5. ההזמנות שהשיעור שלהן שונה מהגדרת החנות היום (היסטוריה — נשמרת כמו שהיא)
-- ============================================================
BEGIN READ ONLY;

\echo '1. חנויות: סוג עוסק, שיעור שמור, כולל מע"מ'
SELECT t.slug, t.name, s.business_type, s.vat_rate, s.prices_include_vat
  FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id
 WHERE t.site_type = 'ecommerce'
 ORDER BY t.slug;

\echo '2. עוסק מורשה עם שיעור שמור שונה מ-18% (הזמנות חדשות יחושבו ב-18% אחרי 191)'
SELECT t.slug, s.vat_rate
  FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id
 WHERE t.site_type = 'ecommerce' AND s.business_type = 'authorized' AND s.vat_rate IS DISTINCT FROM 18
 ORDER BY t.slug;

\echo '3. עוסק פטור עם "המחירים לא כוללים מע"מ" (אין השפעה על סכום — 0%)'
SELECT t.slug
  FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id
 WHERE t.site_type = 'ecommerce' AND s.business_type = 'exempt' AND NOT s.prices_include_vat
 ORDER BY t.slug;

\echo '4. הזמנות לפי שיעור ו"כולל מע"מ" (נשמרות כמו שהן)'
SELECT o.vat_rate, o.prices_include_vat, count(*) AS orders, round(sum(o.total), 2) AS total_sum
  FROM public.orders o
 GROUP BY o.vat_rate, o.prices_include_vat
 ORDER BY 1, 2;

\echo '5. הזמנות שהשיעור שלהן שונה מהגדרת החנות היום (היסטוריה — לא משתנה)'
SELECT t.slug, o.vat_rate AS order_rate,
       CASE WHEN s.business_type = 'exempt' THEN 0 ELSE s.vat_rate END AS store_rate_today, count(*) AS orders
  FROM public.orders o
  JOIN public.tenants t ON t.id = o.tenant_id
  JOIN public.site_settings s ON s.tenant_id = o.tenant_id
 WHERE o.vat_rate IS DISTINCT FROM CASE WHEN s.business_type = 'exempt' THEN 0 ELSE s.vat_rate END
 GROUP BY t.slug, o.vat_rate, s.business_type, s.vat_rate
 ORDER BY t.slug;

ROLLBACK;

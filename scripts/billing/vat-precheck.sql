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
--   6. (סבב 3) ההשפעה האפשרית על הזמנות חדשות, לכל חנות "מורשה" עם שיעור שמור שונה מ-18%: לפי ההזמנות של
--      90 הימים האחרונים (לא מבוטלות, לא הצעות מחיר) — "אם אותן הזמנות היו נכנסות שוב אחרי 191":
--        • "כולל מע"מ": הלקוח משלם אותו דבר; חלק המע"מ בתוך המחיר משתנה (וההכנסה נטו של החנות בהתאם)
--        • "לפני מע"מ": הסכום ללקוח משתנה — הבסיס כפול 1.18 במקום כפול (1 + השיעור השמור)
--   7. סיכום: כמה חנויות מושפעות, וסך ההפרש המשוער ב-90 יום
--   הערה: עוסק פטור — כבר היום 0% (טריגר מ-20261019300000), ואחרי 191 נשאר 0%. אין לו שורות בסעיפים 6–7.
--   8. (סבב 3) פיקדון מכלי משקה — כמה מע"מ נוסף על שורות הפיקדון ב-90 הימים האחרונים, בהזמנות "לפני
--      מע"מ" (שם השרת מוסיף מע"מ גם על הפיקדון). מידע בלבד, לשאלה הפתוחה ב-docs/billing/deposit-vat-research.md.
--      בהזמנות "כולל מע"מ" — המע"מ מחולץ מתוך הפיקדון (הסכום לא גדל); מוצג לצורך השוואה.
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

\echo '6. השפעה אפשרית על הזמנות חדשות — עוסק מורשה עם שיעור שונה מ-18% (לפי 90 הימים האחרונים)'
WITH affected AS (
  SELECT t.id, t.slug, s.vat_rate AS stored_rate, s.prices_include_vat
    FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id
   WHERE t.site_type = 'ecommerce' AND s.business_type = 'authorized' AND s.vat_rate IS DISTINCT FROM 18
), recent AS (
  SELECT a.slug, a.stored_rate, a.prices_include_vat,
         count(o.id) AS orders_90d, COALESCE(sum(o.total), 0) AS base_90d
    FROM affected a
    LEFT JOIN public.orders o ON o.tenant_id = a.id AND o.kind = 'order' AND o.status <> 'cancelled'
                              AND o.created_at >= now() - interval '90 days'
   GROUP BY a.slug, a.stored_rate, a.prices_include_vat
)
SELECT slug,
       stored_rate AS "שיעור שמור",
       CASE WHEN prices_include_vat THEN 'כולל מע"מ' ELSE 'לפני מע"מ' END AS "מצב",
       orders_90d AS "הזמנות 90 יום",
       round(base_90d, 2) AS "סכום ההזמנות (total)",
       -- כולל מע"מ: הלקוח משלם אותו דבר — רק חלק המע"מ שבתוך הסכום
       CASE WHEN prices_include_vat THEN round(base_90d * stored_rate / (100 + stored_rate), 2) END AS "מע״מ בפנים היום",
       CASE WHEN prices_include_vat THEN round(base_90d * 18 / 118, 2) END AS "מע״מ בפנים ב-18%",
       -- לפני מע"מ: הסכום ללקוח
       CASE WHEN NOT prices_include_vat THEN round(base_90d * (1 + stored_rate / 100), 2) END AS "ללקוח היום",
       CASE WHEN NOT prices_include_vat THEN round(base_90d * 1.18, 2) END AS "ללקוח ב-18%",
       CASE WHEN prices_include_vat
            THEN round(base_90d * 18 / 118, 2) - round(base_90d * stored_rate / (100 + stored_rate), 2)
            ELSE round(base_90d * 1.18, 2) - round(base_90d * (1 + stored_rate / 100), 2) END AS "הפרש",
       CASE WHEN prices_include_vat THEN 'המחיר ללקוח לא משתנה; ההכנסה נטו של החנות משתנה בהפרש'
            ELSE 'הלקוח ישלם את ההפרש (חיובי = יותר)' END AS "משמעות"
  FROM recent
 ORDER BY slug;

\echo '7. סיכום'
SELECT count(*) AS "חנויות מורשות עם שיעור שונה מ-18%",
       count(*) FILTER (WHERE s.prices_include_vat) AS "מתוכן כולל מע״מ",
       count(*) FILTER (WHERE NOT s.prices_include_vat) AS "מתוכן לפני מע״מ"
  FROM public.site_settings s JOIN public.tenants t ON t.id = s.tenant_id
 WHERE t.site_type = 'ecommerce' AND s.business_type = 'authorized' AND s.vat_rate IS DISTINCT FROM 18;

\echo '8. פיקדון מכלי משקה ב-90 הימים האחרונים: סך שורות הפיקדון, ומה נוסף עליהן (לפני מע"מ) או חולץ מהן (כולל מע"מ)'
SELECT t.slug,
       CASE WHEN o.prices_include_vat THEN 'כולל מע"מ' ELSE 'לפני מע"מ' END AS "מצב ההזמנה",
       o.vat_rate AS "שיעור",
       count(DISTINCT o.id) AS "הזמנות עם פיקדון",
       round(sum(i.unit_price * i.quantity), 2) AS "סך שורות הפיקדון",
       CASE WHEN NOT o.prices_include_vat
            THEN round(sum(i.unit_price * i.quantity) * o.vat_rate / 100, 2) END AS "מע״מ שנוסף מעל הפיקדון",
       CASE WHEN o.prices_include_vat
            THEN round(sum(i.unit_price * i.quantity) * o.vat_rate / (100 + o.vat_rate), 2) END AS "מע״מ שבתוך הפיקדון"
  FROM public.order_items i
  JOIN public.orders o ON o.id = i.order_id
  JOIN public.tenants t ON t.id = o.tenant_id
 WHERE i.is_deposit AND o.kind = 'order' AND o.status <> 'cancelled'
   AND o.created_at >= now() - interval '90 days' AND o.vat_rate > 0
 GROUP BY t.slug, o.prices_include_vat, o.vat_rate
 ORDER BY t.slug, 2;

ROLLBACK;

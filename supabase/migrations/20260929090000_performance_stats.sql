-- ============================================================
-- ביצועי צוות: סיכומים מחושבים במסד, כך שהדוח נשאר מהיר גם אחרי שנים
-- של הזמנות (במקום להוריד את כל ההזמנות לדפדפן ולסכם שם).
-- ============================================================
-- נספרות רק הזמנות (לא בקשות הצעת מחיר) שלא בוטלו. חודש ושנה לפי שעון
-- ישראל. הפונקציות רצות בהרשאות הקורא (SECURITY INVOKER), ולכן מדיניות
-- ה-RLS של orders חלה כרגיל: מנהל רואה הכל, סוכן — רק את ההזמנות שלו.
--
-- אידמפוטנטי: בטוח להרצה חוזרת.

-- סיכום לפי מטפל (agent_id) ולפי חודש, לשנה אחת
CREATE OR REPLACE FUNCTION public.handler_monthly_stats(_year INTEGER)
RETURNS TABLE (agent_id UUID, month INTEGER, orders BIGINT, revenue NUMERIC)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT o.agent_id,
         extract(month FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')::INTEGER AS month,
         count(*) AS orders,
         COALESCE(sum(o.total), 0) AS revenue
    FROM public.orders o
   WHERE o.kind = 'order'
     AND o.status <> 'cancelled'
     AND extract(year FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')::INTEGER = _year
   GROUP BY o.agent_id, 2;
$$;

-- השנים שיש בהן הזמנות, עם סיכום לכל שנה — לשורות "סיכום שנתי"
CREATE OR REPLACE FUNCTION public.order_activity_years()
RETURNS TABLE (year INTEGER, orders BIGINT, revenue NUMERIC)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT extract(year FROM o.created_at AT TIME ZONE 'Asia/Jerusalem')::INTEGER AS year,
         count(*) AS orders,
         COALESCE(sum(o.total), 0) AS revenue
    FROM public.orders o
   WHERE o.kind = 'order' AND o.status <> 'cancelled'
   GROUP BY 1
   ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.handler_monthly_stats(INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_activity_years() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handler_monthly_stats(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_activity_years() TO authenticated, service_role;

-- אינדקס לשאילתות לפי תאריך על הזמנות פעילות
CREATE INDEX IF NOT EXISTS orders_kind_status_created_idx
  ON public.orders (kind, status, created_at);

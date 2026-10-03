-- ============================================================
-- חלק 11: לוח הבקרה של מנהל החנות
--
-- admin_dashboard() — כל הנתונים של המסך בקריאה אחת, בשאילתות מקובצות
-- (SUM / COUNT עם FILTER) על החנות הנוכחית בלבד:
--   · הכנסות החודש (כולל מע"מ) ומספר ההזמנות — מתחילת החודש, ולהשוואה:
--     אותה תקופה בחודש הקודם (1 עד היום ה-X, באותה שעה)
--   · הזמנות פתוחות: חדשות (התקבלה / בטיפול סוכן) + ממתינות לשליח
--   · לקוחות רשומים (וכמה הצטרפו החודש)
--   · 14 הימים האחרונים — הכנסות והזמנות ליום (לגרף הקטן בכרטיסיות)
--   · 5 ההזמנות האחרונות (מספר, לקוח, סכום, סטטוס)
-- "הכנסות" = הזמנות (לא בקשות להצעת מחיר) שלא בוטלו. אין באתר סליקה —
-- ההזמנה היא ההתחייבות; הסכום כולל מע"מ ודמי משלוח, כמו שהלקוח רואה.
-- החודש והימים — לפי שעון ישראל.
-- ============================================================
BEGIN;

-- השאילתות של המסך: לפי חנות + תאריך, ולפי חנות + סטטוס
CREATE INDEX IF NOT EXISTS orders_tenant_created_idx
  ON public.orders (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_tenant_status_idx
  ON public.orders (tenant_id, status);
CREATE INDEX IF NOT EXISTS user_roles_tenant_role_idx
  ON public.user_roles (tenant_id, role);

-- הסכום לתשלום של הזמנה (כולל מע"מ) — אותו חישוב כמו calculateVat באתר
CREATE OR REPLACE FUNCTION public.order_gross(_total numeric, _prices_include_vat boolean, _vat_rate numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(_prices_include_vat, true) THEN round(COALESCE(_total, 0), 2)
    ELSE round(COALESCE(_total, 0), 2)
         + round(round(COALESCE(_total, 0), 2) * GREATEST(COALESCE(_vat_rate, 18), 0) / 100, 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _tz constant text := 'Asia/Jerusalem';
  _now timestamptz := now();
  _local timestamp := _now AT TIME ZONE _tz;
  _month_start timestamptz := date_trunc('month', _local) AT TIME ZONE _tz;
  _prev_start timestamptz := (date_trunc('month', _local) - interval '1 month') AT TIME ZONE _tz;
  -- אותה נקודה בחודש הקודם (חודש קצר יותר — עד סופו)
  _prev_cut timestamptz;
  _today timestamp := date_trunc('day', _local);
  _series_from timestamptz := (date_trunc('day', _local) - interval '13 days') AT TIME ZONE _tz;
  totals jsonb;
  open_orders jsonb;
  customers jsonb;
  series jsonb;
  recent jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות בלוח הבקרה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  _prev_cut := LEAST(_prev_start + (_now - _month_start), _month_start);

  -- הכנסות והזמנות: החודש מול אותה תקופה בחודש הקודם (סריקה אחת)
  SELECT jsonb_build_object(
           'revenue_month', COALESCE(SUM(g.gross) FILTER (WHERE g.created_at >= _month_start AND g.counts), 0),
           'revenue_prev_period', COALESCE(SUM(g.gross) FILTER (WHERE g.created_at < _prev_cut AND g.counts), 0),
           'orders_month', COUNT(*) FILTER (WHERE g.created_at >= _month_start AND g.counts),
           'orders_prev_period', COUNT(*) FILTER (WHERE g.created_at < _prev_cut AND g.counts),
           'quotes_month', COUNT(*) FILTER (WHERE g.created_at >= _month_start AND g.kind = 'quote'))
    INTO totals
    FROM (
      SELECT o.created_at, o.kind,
             (o.kind = 'order' AND o.status <> 'cancelled') AS counts,
             public.order_gross(o.total, o.prices_include_vat, o.vat_rate) AS gross
        FROM public.orders o
       WHERE o.tenant_id = _tenant AND o.created_at >= _prev_start
    ) g;

  -- הזמנות פתוחות (מכל תאריך): חדשות + ממתינות לשליח
  SELECT jsonb_build_object(
           'total', COUNT(*),
           'new', COUNT(*) FILTER (WHERE o.status IN ('pending', 'agent_review')),
           'awaiting_courier', COUNT(*) FILTER (WHERE o.status = 'awaiting_courier'))
    INTO open_orders
    FROM public.orders o
   WHERE o.tenant_id = _tenant
     AND o.status IN ('pending', 'agent_review', 'awaiting_courier');

  -- לקוחות רשומים
  SELECT jsonb_build_object(
           'total', COUNT(*),
           'new_month', COUNT(*) FILTER (WHERE ur.created_at >= _month_start),
           'awaiting_approval', COUNT(*) FILTER (WHERE NOT ur.is_approved AND NOT ur.is_blocked))
    INTO customers
    FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant AND ur.role = 'customer';

  -- 14 הימים האחרונים (כולל היום), יום בלי הזמנות = 0
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'revenue', COALESCE(x.revenue, 0),
           'orders', COALESCE(x.orders, 0)) ORDER BY d.day), '[]'::jsonb)
    INTO series
    FROM generate_series(_today - interval '13 days', _today, interval '1 day') AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', o.created_at AT TIME ZONE _tz) AS day,
             SUM(public.order_gross(o.total, o.prices_include_vat, o.vat_rate)) AS revenue,
             COUNT(*) AS orders
        FROM public.orders o
       WHERE o.tenant_id = _tenant AND o.created_at >= _series_from
         AND o.kind = 'order' AND o.status <> 'cancelled'
       GROUP BY 1
    ) x ON x.day = d.day;

  -- 5 ההזמנות האחרונות
  SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
    INTO recent
    FROM (
      SELECT o.id, o.order_number, o.kind, o.status, o.created_at, o.delivery_attempts,
             (o.customer_id IS NULL) AS is_guest,
             COALESCE(NULLIF(btrim(o.customer_name), ''), NULLIF(btrim(cp.business_name), ''),
                      NULLIF(btrim(cp.contact_name), ''), ur.email, 'לקוח') AS customer_name,
             public.order_gross(o.total, o.prices_include_vat, o.vat_rate) AS gross
        FROM public.orders o
        LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id
        LEFT JOIN public.user_roles ur ON ur.user_id = o.customer_id
       WHERE o.tenant_id = _tenant
       ORDER BY o.created_at DESC
       LIMIT 5
    ) r;

  RETURN jsonb_build_object(
    'generated_at', _now,
    'month_start', _month_start,
    'totals', totals,
    'open_orders', open_orders,
    'customers', customers,
    'series', series,
    'recent', recent);
END $$;

REVOKE ALL ON FUNCTION public.admin_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard() TO authenticated, service_role;

COMMIT;

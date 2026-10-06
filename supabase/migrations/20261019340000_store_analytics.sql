-- ============================================================
-- חלק 26: אנליטיקס לבעל החנות — store_analytics(_period)
--
-- משלים את לוח הבקרה הקיים (admin_dashboard: החודש, הזמנות פתוחות, לקוחות, הזמנות אחרונות):
--   • טווח: 'month' (החודש) · 'last_month' (החודש שעבר) · 'year' (השנה) — שעון ישראל.
--     השוואה לתקופה המקבילה: החודש/השנה — אותו פרק זמן שעבר מתחילת התקופה הקודמת;
--     החודש שעבר — החודש שלפניו (מלא).
--   • הכנסות = הזמנות ששולמו: payment_status = 'paid', או תשלום במקום (offline) שנמסר.
--     ברוטו כולל מע"מ ומשלוח, אחרי הנחות (order_gross). הזמנות מבוטלות — לא נספרות.
--   • הזמנות = כל ההזמנות שלא בוטלו בטווח · ממוצע = הכנסות / הזמנות ששולמו.
--   • סדרה לגרף: לפי יום (חודש) / לפי חודש (שנה) — הכנסות ששולמו וכמות הזמנות.
--   • הנמכרים ביותר: 5 מוצרים לפי יחידות בהזמנות ששולמו (בלי פיקדון ומתנות).
--   • התראות מלאי: עד 5 מוצרים / וריאציות עם 3 יחידות או פחות (כמו מייל המלאי הנמוך),
--     בלי מוצרים מוסתרים ודיגיטליים; מוצר עם וריאציות פעילות — לפי הווריאציות.
-- מנהל החנות בלבד (is_admin + החנות של הבקשה). אידמפוטנטית.
-- ============================================================

CREATE OR REPLACE FUNCTION public.store_analytics(_period TEXT DEFAULT 'month')
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tid UUID := public.current_tenant_id();
  _tz TEXT := 'Asia/Jerusalem';
  _local TIMESTAMP := now() AT TIME ZONE 'Asia/Jerusalem';
  _from TIMESTAMPTZ; _to TIMESTAMPTZ; _prev_from TIMESTAMPTZ; _prev_to TIMESTAMPTZ;
  _bucket TEXT;
  m RECORD;
  _series JSONB; _top JSONB; _stock JSONB; _stock_count INTEGER;
BEGIN
  IF _tid IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _period = 'month' THEN
    _from := date_trunc('month', _local) AT TIME ZONE _tz;
    _to := now();
    _prev_from := (date_trunc('month', _local) - interval '1 month') AT TIME ZONE _tz;
    _prev_to := _prev_from + (_to - _from);
    _bucket := 'day';
  ELSIF _period = 'last_month' THEN
    _from := (date_trunc('month', _local) - interval '1 month') AT TIME ZONE _tz;
    _to := date_trunc('month', _local) AT TIME ZONE _tz;
    _prev_from := (date_trunc('month', _local) - interval '2 months') AT TIME ZONE _tz;
    _prev_to := _from;
    _bucket := 'day';
  ELSIF _period = 'year' THEN
    _from := date_trunc('year', _local) AT TIME ZONE _tz;
    _to := now();
    _prev_from := (date_trunc('year', _local) - interval '1 year') AT TIME ZONE _tz;
    _prev_to := _prev_from + (_to - _from);
    _bucket := 'month';
  ELSE
    RAISE EXCEPTION 'טווח לא מוכר: %', _period USING ERRCODE = 'check_violation';
  END IF;

  WITH base AS (
    SELECT o.created_at,
           public.order_gross(o.total, o.prices_include_vat, o.vat_rate) AS gross,
           (o.payment_status = 'paid' OR (o.payment_method = 'offline' AND o.status = 'delivered')) AS paid
      FROM public.orders o
     WHERE o.tenant_id = _tid AND o.kind = 'order' AND o.status <> 'cancelled'
       AND o.created_at >= _prev_from AND o.created_at < _to)
  SELECT count(*) FILTER (WHERE created_at >= _from) AS orders,
         count(*) FILTER (WHERE created_at >= _from AND paid) AS paid_orders,
         COALESCE(sum(gross) FILTER (WHERE created_at >= _from AND paid), 0) AS revenue,
         count(*) FILTER (WHERE created_at >= _prev_from AND created_at < _prev_to) AS prev_orders,
         count(*) FILTER (WHERE created_at >= _prev_from AND created_at < _prev_to AND paid) AS prev_paid_orders,
         COALESCE(sum(gross) FILTER (WHERE created_at >= _prev_from AND created_at < _prev_to AND paid), 0) AS prev_revenue
    INTO m FROM base;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('day', to_char(b.bucket, 'YYYY-MM-DD'),
                                               'revenue', COALESCE(x.revenue, 0), 'orders', COALESCE(x.orders, 0))
                            ORDER BY b.bucket), '[]'::jsonb)
    INTO _series
    FROM generate_series(date_trunc(_bucket, _from AT TIME ZONE _tz),
                         date_trunc(_bucket, (_to - interval '1 second') AT TIME ZONE _tz),
                         CASE _bucket WHEN 'day' THEN interval '1 day' ELSE interval '1 month' END) AS b(bucket)
    LEFT JOIN (
      SELECT date_trunc(_bucket, o.created_at AT TIME ZONE _tz) AS bucket,
             SUM(public.order_gross(o.total, o.prices_include_vat, o.vat_rate))
               FILTER (WHERE o.payment_status = 'paid' OR (o.payment_method = 'offline' AND o.status = 'delivered')) AS revenue,
             count(*) AS orders
        FROM public.orders o
       WHERE o.tenant_id = _tid AND o.kind = 'order' AND o.status <> 'cancelled'
         AND o.created_at >= _from AND o.created_at < _to
       GROUP BY 1) x ON x.bucket = b.bucket;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.units DESC, t.name), '[]'::jsonb) INTO _top
    FROM (SELECT oi.product_id, max(oi.product_name) AS name, sum(oi.quantity)::INTEGER AS units
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE o.tenant_id = _tid AND o.kind = 'order' AND o.status <> 'cancelled'
             AND (o.payment_status = 'paid' OR (o.payment_method = 'offline' AND o.status = 'delivered'))
             AND o.created_at >= _from AND o.created_at < _to
             AND NOT oi.is_deposit AND NOT COALESCE(oi.is_gift, false)
           GROUP BY oi.product_id
           ORDER BY sum(oi.quantity) DESC, max(oi.product_name)
           LIMIT 5) t;

  WITH alerts AS (
    SELECT gp.id AS product_id, gp.name, NULL::TEXT AS variant, gp.stock_quantity AS stock
      FROM public.global_products gp
     WHERE gp.tenant_id = _tid AND NOT COALESCE(gp.is_hidden, false) AND NOT COALESCE(gp.is_digital, false)
       AND NOT EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = gp.id AND pv.is_active)
       AND gp.stock_quantity <= 3
    UNION ALL
    SELECT gp.id, gp.name,
           (SELECT string_agg(value, ' / ') FROM jsonb_each_text(COALESCE(pv.options, '{}'::jsonb))),
           pv.stock_quantity
      FROM public.product_variants pv
      JOIN public.global_products gp ON gp.id = pv.product_id
     WHERE gp.tenant_id = _tid AND pv.is_active AND NOT COALESCE(gp.is_hidden, false)
       AND NOT COALESCE(gp.is_digital, false) AND pv.stock_quantity <= 3)
  SELECT (SELECT count(*) FROM alerts),
         COALESCE((SELECT jsonb_agg(a ORDER BY a.stock, a.name) FROM (SELECT * FROM alerts ORDER BY stock, name LIMIT 5) a), '[]'::jsonb)
    INTO _stock_count, _stock;

  RETURN jsonb_build_object(
    'period', _period, 'from', _from, 'to', _to, 'bucket', _bucket,
    'revenue', m.revenue, 'orders', m.orders, 'paid_orders', m.paid_orders,
    'aov', CASE WHEN m.paid_orders > 0 THEN round(m.revenue / m.paid_orders, 2) ELSE 0 END,
    'prev', jsonb_build_object('revenue', m.prev_revenue, 'orders', m.prev_orders,
      'aov', CASE WHEN m.prev_paid_orders > 0 THEN round(m.prev_revenue / m.prev_paid_orders, 2) ELSE 0 END),
    'series', _series, 'top_products', _top,
    'stock_alerts', _stock, 'stock_alerts_total', _stock_count);
END; $$;
REVOKE ALL ON FUNCTION public.store_analytics(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_analytics(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

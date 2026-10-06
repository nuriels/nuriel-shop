-- ============================================================
-- חלק 24: כלים למכירות ולשירות — קופון "משלוח חינם" + מעקב משלוחים
--
-- מה כבר היה (חלק 14) ולא נוצר שוב: טבלת coupons (קוד ייחודי לכל חנות, אחוז / סכום,
-- min_order_total, max_uses, starts_at / expires_at, is_active), בדיקה מקדימה check_coupon,
-- החלה במסד ביצירת ההזמנה (orders_apply_coupon + orders_shipping_and_total), ועמודות
-- ההיסטוריה על orders (coupon_id, coupon_code, coupon_discount_type/value, discount_amount).
-- ספירת השימושים מחושבת מההזמנות שלא בוטלו (coupon_problem / coupon_usage) — ביטול מחזיר
-- את השימוש; לכן אין עמודת current_uses נפרדת (הייתה סותרת את הספירה).
--
-- חדש כאן:
-- 1. סוג קופון 'free_shipping': ההנחה = דמי המשלוח של ההזמנה (אם עברו את המינימום).
-- 2. orders: tracking_number, shipping_provider, tracking_url, tracking_updated_at —
--    רק צוות החנות (או השרת) מעדכן; ערכים ריקים → NULL; קישור http(s) בלבד.
-- אידמפוטנטית.
-- ============================================================

-- ---------- 1. משלוח חינם ----------
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_discount_type_check
  CHECK (discount_type IN ('percent', 'fixed', 'free_shipping'));
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_value_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_value_check CHECK (
  CASE WHEN discount_type = 'free_shipping'
       THEN discount_value >= 0 AND discount_value <= 1000000
       ELSE discount_value > 0 AND (discount_type <> 'percent' OR discount_value <= 100)
            AND discount_value <= 1000000 END);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_coupon_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_coupon_check CHECK (
  (coupon_discount_type IS NULL OR coupon_discount_type IN ('percent', 'fixed', 'free_shipping'))
  AND discount_amount >= 0);

-- הסכום הכולל: כמו קודם, ובקופון משלוח חינם — ההנחה היא דמי המשלוח
CREATE OR REPLACE FUNCTION public.orders_shipping_and_total()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m RECORD;
  staff BOOLEAN := public.is_staff(auth.uid());
  v_items NUMERIC := 0;
  v_products NUMERIC := 0;
  v_discount NUMERIC := 0;
  rederive BOOLEAN;
BEGIN
  rederive := TG_OP = 'INSERT'
    OR (NEW.shipping_method_id IS NOT NULL
        AND NEW.shipping_method_id IS DISTINCT FROM OLD.shipping_method_id);

  IF rederive THEN
    IF NEW.shipping_method_id IS NOT NULL THEN
      SELECT sm.name, sm.kind, sm.price, sm.is_active INTO m
        FROM public.shipping_methods sm
       WHERE sm.id = NEW.shipping_method_id AND sm.tenant_id = NEW.tenant_id;
      IF NOT FOUND OR (NOT m.is_active AND NOT staff) THEN
        RAISE EXCEPTION 'שיטת המשלוח שנבחרה אינה זמינה עוד — בחרו שיטה אחרת'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.shipping_method_name := m.name;
      NEW.shipping_kind := m.kind;
      NEW.shipping_base_price := m.price;
      NEW.shipping_free_threshold := CASE
        WHEN m.kind = 'delivery' AND TG_OP = 'INSERT' THEN
          (SELECT s.free_shipping_threshold FROM public.site_settings s WHERE s.tenant_id = NEW.tenant_id)
      END;
    ELSIF TG_OP = 'INSERT' THEN
      -- בלי שיטה: סל דיגיטלי בלבד, או הזמנה בלי משלוח מוגדר (ידנית / ישנה)
      NEW.shipping_method_name := NULL;
      NEW.shipping_kind := CASE WHEN NEW.shipping_kind = 'digital' THEN 'digital' END;
      IF NOT staff THEN
        NEW.shipping_base_price := 0;
      END IF;
      NEW.shipping_free_threshold := NULL;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0),
           COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0)
      INTO v_items, v_products
      FROM public.order_items oi
     WHERE oi.order_id = NEW.id;
    -- דמי משלוח שהוזנו ביד (עריכת הזמנה) — המחיר הקבוע מעכשיו
    IF NOT rederive AND NEW.shipping_price IS DISTINCT FROM OLD.shipping_price THEN
      NEW.shipping_base_price := GREATEST(COALESCE(NEW.shipping_price, 0), 0);
      NEW.shipping_free_threshold := NULL;
    END IF;
  END IF;

  NEW.shipping_price := CASE
    -- בקשה להצעת מחיר — בלי מחירים (גם לא משלוח) עד שהצוות ממיר להזמנה
    WHEN NEW.kind = 'quote' THEN 0
    WHEN NEW.shipping_free_threshold IS NOT NULL AND v_products >= NEW.shipping_free_threshold THEN 0
    ELSE NEW.shipping_base_price
  END;

  IF NEW.kind <> 'quote'
     AND NEW.coupon_discount_type IS NOT NULL
     AND v_products > 0
     AND v_products >= COALESCE(NEW.coupon_min_order, 0) THEN
    v_discount := CASE NEW.coupon_discount_type
      WHEN 'percent' THEN round(v_products * NEW.coupon_discount_value / 100, 2)
      -- חלק 24: משלוח חינם — ההנחה = דמי המשלוח שחושבו (המשלוח עצמו נשאר מתועד)
      WHEN 'free_shipping' THEN COALESCE(NEW.shipping_price, 0)
      ELSE NEW.coupon_discount_value
    END;
    v_discount := GREATEST(LEAST(v_discount, CASE WHEN NEW.coupon_discount_type = 'free_shipping'
                                                   THEN COALESCE(NEW.shipping_price, 0)
                                                   ELSE round(v_products, 2) END), 0);
  END IF;
  NEW.discount_amount := v_discount;
  NEW.total := v_items + NEW.shipping_price - v_discount;
  RETURN NEW;
END $function$;

-- ---------- 2. מעקב משלוחים ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipping_provider TEXT,
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_updated_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_tracking_check'
                   AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_tracking_check CHECK (
      (tracking_number IS NULL OR char_length(tracking_number) BETWEEN 1 AND 80)
      AND (shipping_provider IS NULL OR char_length(shipping_provider) BETWEEN 1 AND 60)
      AND (tracking_url IS NULL OR (tracking_url ~* '^https?://\S+$' AND char_length(tracking_url) <= 1000)));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.orders_tracking_normalize()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.tracking_number := NULLIF(btrim(NEW.tracking_number), '');
  NEW.shipping_provider := NULLIF(btrim(NEW.shipping_provider), '');
  NEW.tracking_url := NULLIF(btrim(NEW.tracking_url), '');
  IF TG_OP = 'INSERT' THEN
    -- הזמנה חדשה של לקוח לא מגיעה עם פרטי שילוח
    IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
      NEW.tracking_number := NULL; NEW.shipping_provider := NULL; NEW.tracking_url := NULL;
    END IF;
    NEW.tracking_updated_at := CASE WHEN COALESCE(NEW.tracking_number, NEW.shipping_provider, NEW.tracking_url) IS NOT NULL
                                    THEN now() END;
  ELSIF (NEW.tracking_number, NEW.shipping_provider, NEW.tracking_url)
        IS DISTINCT FROM (OLD.tracking_number, OLD.shipping_provider, OLD.tracking_url) THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
      RAISE EXCEPTION 'רק צוות החנות יכול לעדכן פרטי שילוח' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.tracking_updated_at := now();
  ELSE
    NEW.tracking_updated_at := OLD.tracking_updated_at;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.orders_tracking_normalize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orders_tracking_normalize ON public.orders;
CREATE TRIGGER orders_tracking_normalize
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_tracking_normalize();

NOTIFY pgrst, 'reload schema';

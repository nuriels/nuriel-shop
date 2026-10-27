-- ============================================================
-- קופונים — כללי שימוש (לכל החנויות):
--   max_uses_per_customer — כמה פעמים כל לקוח יכול להשתמש בקופון (NULL = ללא הגבלה).
--                           לקוח = החשבון (customer_id) או כתובת המייל בהזמנה — כך
--                           שגם קונה בלי הרשמה, או מי שנרשם אחרי קנייה כאורח, נספר.
--   audience              — all / registered (לקוחות רשומים בלבד) / guests (קנייה בלי הרשמה)
--   exclude_sale_items    — true = ההנחה לא חלה על מוצרים שכבר במבצע (בלי כפל מבצעים)
-- הכל נאכף במסד ביצירת ההזמנה (לא רק במסך). צוות החנות (קופה / הזמנה ידנית) לא
-- מוגבל בקהל היעד ובמספר השימושים ללקוח — הם מחליטים בעצמם.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS max_uses_per_customer INTEGER,
  ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS exclude_sale_items BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.coupons ADD CONSTRAINT coupons_rules_check
    CHECK ((max_uses_per_customer IS NULL OR max_uses_per_customer BETWEEN 1 AND 1000)
           AND audience IN ('all', 'registered', 'guests'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.coupons.max_uses_per_customer IS 'שימושים מקסימליים לכל לקוח (חשבון או מייל); NULL = ללא הגבלה';
COMMENT ON COLUMN public.coupons.audience IS 'all / registered / guests';
COMMENT ON COLUMN public.coupons.exclude_sale_items IS 'true = בלי הנחה על מוצרים שכבר במבצע';

-- צילום על ההזמנה (כמו שאר פרטי הקופון) — שינוי הקופון אחר כך לא משנה הזמנה קיימת
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_exclude_sale BOOLEAN;

-- שורה שנמכרה במבצע (מחיר מבצע בתוקף, או מוצר שסומן "מבצע חם") — צילום ברגע ההזמנה
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS on_sale BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.order_items_snapshot_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
BEGIN
  NEW.on_sale := false;
  IF NEW.product_id IS NULL OR COALESCE(NEW.is_deposit, false) OR COALESCE(NEW.is_gift, false) THEN
    RETURN NEW;
  END IF;
  SELECT gp.is_promo, gp.sale_price, gp.sale_starts_at, gp.sale_ends_at INTO p
    FROM public.global_products gp WHERE gp.id = NEW.product_id;
  IF FOUND THEN
    NEW.on_sale := COALESCE(p.is_promo, false)
      OR (public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at)
          AND NEW.unit_price <= p.sale_price);
  END IF;
  RETURN NEW;
END $$;
-- השם אחרי order_items_snapshot_product (טריגרים רצים לפי סדר שמות) — המחיר כבר נקבע
DROP TRIGGER IF EXISTS order_items_snapshot_sale ON public.order_items;
CREATE TRIGGER order_items_snapshot_sale
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.order_items_snapshot_sale();

-- כמה פעמים הלקוח הזה (חשבון או מייל) כבר השתמש בקופון (הזמנות שבוטלו לא נספרות)
CREATE OR REPLACE FUNCTION public.coupon_customer_uses(_coupon uuid, _customer uuid, _email text)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.orders o
   WHERE o.coupon_id = _coupon
     AND o.status <> 'cancelled'
     AND ((_customer IS NOT NULL AND o.customer_id = _customer)
          OR (NULLIF(btrim(COALESCE(_email, '')), '') IS NOT NULL
              AND lower(btrim(o.customer_email)) = lower(btrim(_email))));
$$;
REVOKE ALL ON FUNCTION public.coupon_customer_uses(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- הבעיה של הקופון ללקוח מסוים (NULL = מותר): קהל יעד + מספר שימושים ללקוח
CREATE OR REPLACE FUNCTION public.coupon_customer_problem(
  c public.coupons, _customer uuid, _email text, _is_guest boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF c.audience = 'registered' AND _is_guest IS TRUE THEN
    RETURN 'הקופון מיועד ללקוחות רשומים בלבד — התחברו לחשבון כדי להשתמש בו';
  END IF;
  IF c.audience = 'guests' AND _is_guest IS FALSE THEN
    RETURN 'הקופון מיועד לקנייה בלי הרשמה בלבד';
  END IF;
  IF c.max_uses_per_customer IS NOT NULL
     AND (_customer IS NOT NULL OR NULLIF(btrim(COALESCE(_email, '')), '') IS NOT NULL)
     AND public.coupon_customer_uses(c.id, _customer, _email) >= c.max_uses_per_customer THEN
    RETURN CASE WHEN c.max_uses_per_customer = 1
      THEN 'כבר השתמשת בקופון הזה — הוא מיועד לשימוש אחד ללקוח'
      ELSE format('כבר השתמשת בקופון הזה %s פעמים — זה המקסימום ללקוח', c.max_uses_per_customer)
    END;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.coupon_customer_problem(public.coupons, uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- החלת הקופון על ההזמנה (מחליף את חלק 14) — + קהל יעד, שימושים ללקוח, בלי כפל מבצעים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_apply_coupon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  problem text;
  _code text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.coupon_code IS NULL AND OLD.coupon_code IS NOT NULL AND public.is_staff(auth.uid()) THEN
      NEW.coupon_id := NULL;
      NEW.coupon_discount_type := NULL;
      NEW.coupon_discount_value := NULL;
      NEW.coupon_min_order := NULL;
      NEW.coupon_exclude_sale := NULL;
    ELSE
      -- קופון שנמחק (ON DELETE SET NULL): הקישור מתנתק, הצילום על ההזמנה נשאר
      NEW.coupon_id := CASE
        WHEN NEW.coupon_id IS NULL AND OLD.coupon_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.coupons cp WHERE cp.id = OLD.coupon_id) THEN NULL
        ELSE OLD.coupon_id
      END;
      NEW.coupon_code := OLD.coupon_code;
      NEW.coupon_discount_type := OLD.coupon_discount_type;
      NEW.coupon_discount_value := OLD.coupon_discount_value;
      NEW.coupon_min_order := OLD.coupon_min_order;
      NEW.coupon_exclude_sale := OLD.coupon_exclude_sale;
    END IF;
    RETURN NEW;
  END IF;

  _code := upper(btrim(COALESCE(NEW.coupon_code, '')));
  NEW.coupon_id := NULL;
  NEW.coupon_discount_type := NULL;
  NEW.coupon_discount_value := NULL;
  NEW.coupon_min_order := NULL;
  NEW.coupon_exclude_sale := NULL;
  IF _code = '' THEN
    NEW.coupon_code := NULL;
    RETURN NEW;
  END IF;

  -- נעילת הקופון: שתי הזמנות במקביל לא יעברו יחד את מגבלות השימושים
  SELECT * INTO c FROM public.coupons
   WHERE tenant_id = NEW.tenant_id AND code = _code
   FOR UPDATE;
  problem := public.coupon_problem(c, NULL);
  -- קהל יעד ושימושים ללקוח — ללקוחות ולאורחים; הצוות (קופה / הזמנה ידנית) מחליט בעצמו
  IF problem IS NULL AND NOT public.is_staff(auth.uid()) THEN
    problem := public.coupon_customer_problem(
      c, NEW.customer_id, NEW.customer_email, NEW.customer_id IS NULL);
  END IF;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '%', problem USING ERRCODE = 'check_violation';
  END IF;
  NEW.coupon_id := c.id;
  NEW.coupon_code := c.code;
  NEW.coupon_discount_type := c.discount_type;
  NEW.coupon_discount_value := c.discount_value;
  NEW.coupon_min_order := c.min_order_total;
  NEW.coupon_exclude_sale := c.exclude_sale_items;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- בדיקה מקדימה בקופה (השרת בלבד) — + קהל יעד ושימושים ללקוח, ומחזירה את הכללים
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.check_coupon(text, numeric);
CREATE OR REPLACE FUNCTION public.check_coupon(
  _code text,
  _subtotal numeric DEFAULT NULL,
  _customer uuid DEFAULT NULL,
  _email text DEFAULT NULL,
  _is_guest boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  problem text;
BEGIN
  SELECT * INTO c FROM public.coupons
   WHERE tenant_id = public.current_tenant_id()
     AND code = upper(btrim(COALESCE(_code, '')));
  problem := public.coupon_problem(c, _subtotal);
  IF problem IS NULL THEN
    problem := public.coupon_customer_problem(c, _customer, _email, _is_guest);
  END IF;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '%', problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'code', c.code,
    'discount_type', c.discount_type,
    'discount_value', c.discount_value,
    'min_order_total', c.min_order_total,
    'description', c.description,
    'audience', c.audience,
    'max_uses_per_customer', c.max_uses_per_customer,
    'exclude_sale_items', c.exclude_sale_items);
END $$;
REVOKE ALL ON FUNCTION public.check_coupon(text, numeric, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_coupon(text, numeric, uuid, text, boolean) TO service_role;

-- ------------------------------------------------------------
-- סכומי ההזמנה (מחליף את חלק 32) — ההנחה באחוזים / בסכום מחושבת על המוצרים שהקופון
-- חל עליהם: בקופון "בלי כפל מבצעים" — בלי השורות שנמכרו במבצע. המינימום להזמנה
-- נבדק כמו קודם על כל המוצרים.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_shipping_and_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  staff BOOLEAN := public.is_staff(auth.uid());
  v_items NUMERIC := 0;
  v_products NUMERIC := 0;
  v_coupon_base NUMERIC := 0;
  v_discount NUMERIC := 0;
  v_manual NUMERIC := 0;
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
      -- בלי שיטה: סל דיגיטלי בלבד, או הזמנה בלי משלוח מוגדר (ידנית / ישנה / מכירה בחנות)
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
           COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0),
           COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (
             WHERE NOT oi.is_deposit AND NOT oi.is_gift
               AND NOT (COALESCE(NEW.coupon_exclude_sale, false) AND oi.on_sale)), 0)
      INTO v_items, v_products, v_coupon_base
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
      WHEN 'percent' THEN round(v_coupon_base * NEW.coupon_discount_value / 100, 2)
      -- חלק 24: משלוח חינם — ההנחה = דמי המשלוח שחושבו (המשלוח עצמו נשאר מתועד)
      WHEN 'free_shipping' THEN COALESCE(NEW.shipping_price, 0)
      ELSE NEW.coupon_discount_value
    END;
    v_discount := GREATEST(LEAST(v_discount, CASE WHEN NEW.coupon_discount_type = 'free_shipping'
                                                   THEN COALESCE(NEW.shipping_price, 0)
                                                   ELSE round(v_coupon_base, 2) END), 0);
  END IF;

  -- חלק 32: הנחה ידנית מהקופה — על המוצרים בלבד (בלי משלוח ופיקדונות),
  -- אחרי הקופון, ולעולם לא יותר ממה שנשאר לתשלום על המוצרים
  IF NEW.kind <> 'quote' AND NEW.manual_discount_type IS NOT NULL AND v_products > 0 THEN
    v_manual := CASE NEW.manual_discount_type
      WHEN 'percent' THEN round(v_products * NEW.manual_discount_value / 100, 2)
      ELSE NEW.manual_discount_value
    END;
    v_manual := GREATEST(LEAST(v_manual,
      round(v_products, 2) - CASE WHEN NEW.coupon_discount_type = 'free_shipping' THEN 0
                                  ELSE v_discount END), 0);
  END IF;

  NEW.manual_discount_amount := v_manual;
  NEW.discount_amount := v_discount + v_manual;
  NEW.total := v_items + NEW.shipping_price - v_discount - v_manual;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

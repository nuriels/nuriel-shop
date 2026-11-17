-- ============================================================
-- Rollback של 20261118110000_order_guard.sql (מיגרציה 200 — הגנה על יצירת הזמנה ישירה)
-- חזרה בדיוק לגרסאות של מיגרציה 55 (coupon_rules): check_coupon (STABLE, בלי אישורים) ו-orders_apply_coupon
-- (בלי דרישת אישור), והטריגר orders_a_rate_guard נמחק. לא נוגע בהזמנות, בקופונים ובמלאי.
-- נתונים: הטבלה coupon_grants היא זמנית בלבד (כל שורה פגה אחרי שעתיים ונמחקת בבדיקה הבאה); מחיקתה רק
-- מחייבת לקוחות שהחילו קופון ב-checkout ולא סיימו הזמנה להחיל אותו מחדש — ולכן אין צורך בהגנת נתונים.
-- לפני ה-rollback: האפליקציה יכולה להישאר כמו שהיא (checkCoupon קוראת ל-check_coupon באותה חתימה).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DROP TRIGGER IF EXISTS orders_a_rate_guard ON public.orders;
DROP FUNCTION IF EXISTS public.orders_rate_guard();

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

DROP TABLE IF EXISTS public.coupon_grants;

COMMIT;

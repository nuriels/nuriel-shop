-- ============================================================
-- קופון להזמנה ראשונה: first_order_mode = none / offer (הצעה לאישור הלקוח) / auto
-- ============================================================
-- * none  — כמו היום (ברירת מחדל לכל הקופונים הקיימים).
-- * offer — הקופון תקף רק בהזמנה ראשונה; בסל ובקופה הלקוח רואה "יש לך קופון להזמנה
--           ראשונה" ומאשר.
-- * auto  — הקופון תקף רק בהזמנה ראשונה, ומוחל לבד בקופה.
-- "הזמנה ראשונה" = אין הזמנה קודמת שלא בוטלה על אותו חשבון או אותה כתובת מייל.
-- הכלל נאכף במסד ביצירת ההזמנה (coupon_customer_problem) — לא רק במסך. הצוות (קופה /
-- הזמנה ידנית) לא מוגבל, כמו בשאר כללי הקהל. קופון אחד לכל חנות מסומן כך.
-- דרך חזרה: supabase/rollbacks/20261019590000_first_order_coupon.down.sql
-- ============================================================
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS first_order_mode text NOT NULL DEFAULT 'none';
DO $$ BEGIN
  ALTER TABLE public.coupons ADD CONSTRAINT coupons_first_order_mode_check
    CHECK (first_order_mode IN ('none', 'offer', 'auto'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.coupons.first_order_mode IS 'none / offer (הצעה לאישור) / auto (מוחל לבד) — תקף רק בהזמנה ראשונה';
CREATE UNIQUE INDEX IF NOT EXISTS coupons_one_first_order_per_tenant
  ON public.coupons (tenant_id) WHERE first_order_mode <> 'none';

-- האם ללקוח (חשבון או מייל) כבר יש הזמנה שלא בוטלה בחנות הזו
CREATE OR REPLACE FUNCTION public.customer_has_prior_order(_tenant uuid, _customer uuid, _email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
     WHERE o.tenant_id = _tenant
       AND o.kind = 'order'
       AND o.status <> 'cancelled'
       AND ((_customer IS NOT NULL AND o.customer_id = _customer)
            OR (NULLIF(btrim(COALESCE(_email, '')), '') IS NOT NULL
                AND lower(btrim(o.customer_email)) = lower(btrim(_email)))));
$$;
REVOKE ALL ON FUNCTION public.customer_has_prior_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- כללי הקופון ללקוח — כמו חלק 47 + "הזמנה ראשונה בלבד"
CREATE OR REPLACE FUNCTION public.coupon_customer_problem(
  c public.coupons, _customer uuid, _email text, _is_guest boolean
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF c.audience = 'registered' AND _is_guest IS TRUE THEN
    RETURN 'הקופון מיועד ללקוחות רשומים בלבד — התחברו לחשבון כדי להשתמש בו';
  END IF;
  IF c.audience = 'guests' AND _is_guest IS FALSE THEN
    RETURN 'הקופון מיועד לקנייה בלי הרשמה בלבד';
  END IF;
  IF c.first_order_mode <> 'none'
     AND (_customer IS NOT NULL OR NULLIF(btrim(COALESCE(_email, '')), '') IS NOT NULL)
     AND public.customer_has_prior_order(c.tenant_id, _customer, _email) THEN
    RETURN 'הקופון מיועד להזמנה ראשונה בלבד';
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

-- ההצעה להזמנה ראשונה ללקוח הזה (השרת בלבד). NULL = אין הצעה / הלקוח לא זכאי.
-- בלי חשבון ובלי מייל (אורח שעוד לא הזין) — ההצעה מוצגת, והבדיקה הסופית בעת ההזמנה.
CREATE OR REPLACE FUNCTION public.first_order_offer(_customer uuid, _email text, _is_guest boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.coupons;
  problem text;
BEGIN
  SELECT * INTO c FROM public.coupons
   WHERE tenant_id = public.current_tenant_id() AND first_order_mode <> 'none' AND is_active
   ORDER BY created_at DESC LIMIT 1;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  problem := public.coupon_problem(c, NULL);
  IF problem IS NULL THEN
    problem := public.coupon_customer_problem(c, _customer, _email, _is_guest);
  END IF;
  IF problem IS NOT NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'code', c.code, 'mode', c.first_order_mode,
    'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'min_order_total', c.min_order_total, 'expires_at', c.expires_at,
    'exclude_sale_items', c.exclude_sale_items);
END $$;
REVOKE ALL ON FUNCTION public.first_order_offer(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_order_offer(uuid, text, boolean) TO service_role;

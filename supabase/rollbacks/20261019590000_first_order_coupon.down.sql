-- דרך חזרה ל-20261019590000 (ידני בלבד). אחריה:
--   DELETE FROM public._migrations_applied WHERE filename = '20261019590000_first_order_coupon.sql';
-- קופון שסומן "הזמנה ראשונה" יהפוך לקופון רגיל (בלי המגבלה). שאר כללי הקופונים נשארים.
BEGIN;
DROP FUNCTION IF EXISTS public.first_order_offer(uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.coupon_customer_problem(
  c public.coupons, _customer uuid, _email text, _is_guest boolean
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
DROP FUNCTION IF EXISTS public.customer_has_prior_order(uuid, uuid, text);
DROP INDEX IF EXISTS public.coupons_one_first_order_per_tenant;
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_first_order_mode_check;
ALTER TABLE public.coupons DROP COLUMN IF EXISTS first_order_mode;
COMMIT;

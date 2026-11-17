-- ============================================================
-- מיגרציה 200: הגנה על יצירת הזמנה ישירה מהדפדפן (place_order / INSERT ל-orders) — ממצא S-1 בביקורת
--
-- הבעיה: לקוח מחובר קורא ל-place_order ישירות דרך PostgREST (בלי פונקציית שרת באמצע). לכן:
--   א. קודי קופון: הודעות השגיאה מבדילות "לא נמצא" / "פג תוקף" / "נוצל", וההגבלה היחידה (checkCoupon:
--      20 לכל 10 דקות לכתובת) עוקפת בקלות — אורקל בלי הגבלה.
--   ב. אין שום הגבלה על מספר ההזמנות: אפשר להחזיק את כל המלאי בהזמנות "ממתינות" ולהציף התראות לצוות.
--
-- הפתרון (כל השכבות במסד — חלות גם על קריאה ישירה ל-API):
--   1. אישור קופון (coupon_grants): check_coupon — שהשרת בלבד קורא לה, אחרי הגבלת הקצב של checkCoupon,
--      ולקונה מחובר בלבד — רושמת אישור קצר-מועד (שעתיים) לקוד שעבר את כל הבדיקות. orders_apply_coupon
--      מחייבת אישור כזה ללקוח (לא צוות). בלי אישור — אותה שגיאה בדיוק לכל קוד (קיים או לא), כך שהאורקל
--      נסגר: את מצב הקופון אפשר ללמוד רק דרך checkCoupon, שמוגבל. האישור נצרך אטומית (חד-פעמי) ביצירת ההזמנה.
--      אורחים (place_guest_order — שרת, בלי משתמש) וצוות (קופה / הזמנה ידנית) — בלי שינוי.
--   2. הגבלת קצב להזמנות (orders_rate_guard, טריגר BEFORE INSERT על orders): לקוח (לא צוות) — עד 30 הזמנות
--      ל-10 דקות ו-300 ליממה בכל עסק. נספר מתוך orders (מסלול ההצלחה — נשמר גם כשהקריאה נכשלת אחר כך).
--      נעילת advisory לכל (עסק, משתמש) מסדרת קריאות מקבילות, כך ששתי הזמנות במקביל לא "עוברות יחד" את
--      התקרה. התקרות גבוהות בהרבה מכל שימוש עסקי (לקוח B2B מזמין בדרך כלל כמה פעמים ביום).
--   לא משתנה: place_order עצמה, החישובים, המלאי, ההרשאות. הזרימה הרגילה (checkCoupon ← place_order) זהה.
--
-- לא בוצע ובכוונה: ביטול ההרשאה ל-place_order מ-authenticated (היא רצה בהרשאות הקורא ומשתמשת ב-auth.uid()).
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261118110000_order_guard.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ---------- 1. אישורי קופון ----------
CREATE TABLE IF NOT EXISTS public.coupon_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  code        text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 60),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.coupon_grants IS
  'מיגרציה 200: אישור קצר-מועד (שעתיים) שקוד קופון עבר את בדיקת ה-checkout של השרת ללקוח מחובר. orders_apply_coupon מחייבת אותו ללקוח';
CREATE UNIQUE INDEX IF NOT EXISTS coupon_grants_key ON public.coupon_grants (tenant_id, user_id, code);
CREATE INDEX IF NOT EXISTS coupon_grants_expires_idx ON public.coupon_grants (expires_at);
ALTER TABLE public.coupon_grants ENABLE ROW LEVEL SECURITY;
-- סגורה ל-API: רק פונקציות (SECURITY DEFINER) ושירות
REVOKE ALL ON public.coupon_grants FROM PUBLIC, anon, authenticated;

-- ---------- 2. check_coupon: רושמת אישור לקונה מחובר ----------
CREATE OR REPLACE FUNCTION public.check_coupon(
  _code text,
  _subtotal numeric DEFAULT NULL,
  _customer uuid DEFAULT NULL,
  _email text DEFAULT NULL,
  _is_guest boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
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
  -- קונה מחובר: אישור לשעתיים (נחוץ ליצירת הזמנה עם הקופון — ראו orders_apply_coupon)
  IF _customer IS NOT NULL THEN
    DELETE FROM public.coupon_grants g WHERE g.tenant_id = c.tenant_id AND g.expires_at <= now();
    INSERT INTO public.coupon_grants (tenant_id, user_id, code, expires_at)
    VALUES (c.tenant_id, _customer, c.code, now() + interval '2 hours')
    ON CONFLICT (tenant_id, user_id, code) DO UPDATE SET expires_at = EXCLUDED.expires_at;
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

-- ---------- 3. orders_apply_coupon: לקוח צריך אישור ----------
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
  _needs_grant boolean;
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

  -- לקוח מחובר (לא צוות): הקופון חייב לעבור קודם את בדיקת ה-checkout של השרת (check_coupon, מוגבלת בקצב).
  -- בלי אישור — אותה שגיאה לכל קוד, קיים או לא, ולכן אי אפשר לנחש קודים דרך יצירת הזמנה ישירה
  -- האישור נצרך כאן באופן אטומי (DELETE): שתי קריאות מקבילות עם אותו אישור — רק אחת עוברת. אם ההזמנה תיכשל
  -- אחר כך (קופון שנוצל, מלאי…) — הכול מתבטל יחד והאישור נשאר
  _needs_grant := auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid());
  IF _needs_grant THEN
    DELETE FROM public.coupon_grants g
     WHERE g.tenant_id = NEW.tenant_id AND g.user_id = auth.uid()
       AND g.code = _code AND g.expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הקופון לא אומת בקופה — הסירו אותו והזינו אותו שוב' USING ERRCODE = 'check_violation';
    END IF;
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

-- ---------- 4. הגבלת קצב להזמנות של לקוח ----------
CREATE OR REPLACE FUNCTION public.orders_rate_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _recent integer;
  _day integer;
BEGIN
  -- אורח / שרת (בלי משתמש) — place_guest_order מוגבלת בשרת; צוות / סוכן / קופה — לא מוגבלים כאן
  IF _uid IS NULL OR public.is_staff(_uid) THEN
    RETURN NEW;
  END IF;
  -- סדר הקריאות המקבילות של אותו לקוח באותו עסק: כל אחת רואה את ההזמנות שהקודמת כבר יצרה
  PERFORM pg_advisory_xact_lock(hashtextextended('order-guard:' || NEW.tenant_id::text || ':' || _uid::text, 0));
  SELECT count(*) FILTER (WHERE o.created_at > now() - interval '10 minutes'), count(*)
    INTO _recent, _day
    FROM public.orders o
   WHERE o.customer_id = _uid AND o.tenant_id = NEW.tenant_id
     AND o.created_at > now() - interval '24 hours';
  IF _recent >= 30 OR _day >= 300 THEN
    RAISE EXCEPTION 'יותר מדי הזמנות בזמן קצר — נסו שוב בעוד כמה דקות' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.orders_rate_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_a_rate_guard ON public.orders;
CREATE TRIGGER orders_a_rate_guard
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_rate_guard();

COMMIT;

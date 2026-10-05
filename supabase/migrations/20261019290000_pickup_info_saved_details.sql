-- ============================================================
-- חלק 22: פרטי הלקוח נשמרים אחרי הזמנה + פרטי איסוף עצמי בעמוד התשלום בביט
--
-- 1. לקוח מחובר שמשלים הזמנה — הפרטים מהקופה (שם / שם העסק, ת.ז / ח.פ,
--    טלפון, עיר, כתובת ומיקוד) נשמרים בפרופיל שלו, והקופה ממלאת אותם
--    אוטומטית בהזמנה הבאה (היא כבר קוראת מהפרופיל). רק מה שהוזן — שדה ריק
--    לא מוחק ערך קיים (למשל באיסוף עצמי בלי כתובת). "משלוח לכתובת אחרת" הוא
--    חד-פעמי ולא נשמר. אין פרופיל עדיין (הרשמה מהירה בקוד למייל) — נוצר.
--    רק כשהלקוח עצמו שולח (לא הזמנה שאיש צוות פתח בשבילו), ורק כשאושרו
--    התנאים בקופה. תקלה בשמירה לא עוצרת את ההזמנה.
--
-- 2. bit_payment_info: האם ההזמנה באיסוף עצמי + כתובת החנות ושעות הפעילות
--    (מהגדרות האתר, מידע ציבורי) — לבלוק "ההזמנה תמתין לך באיסוף עצמי".
--
-- אידמפוטנטי: בטוח להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. שמירת פרטי הלקוח בפרופיל אחרי הזמנה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_remember_customer_details()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text := NULLIF(btrim(COALESCE(NEW.customer_name, '')), '');
  _tax text := NULLIF(btrim(COALESCE(NEW.customer_tax_id, '')), '');
  _phone text := NULLIF(btrim(COALESCE(NEW.customer_phone, '')), '');
  _city text := NULLIF(btrim(COALESCE(NEW.billing_city, '')), '');
  _address text := NULLIF(btrim(COALESCE(NEW.billing_address, '')), '');
  _zip text := NULLIF(btrim(COALESCE(NEW.billing_zip, '')), '');
BEGIN
  -- רק הלקוח עצמו (לא אורח, לא הזמנה שאיש צוות פתח), ורק עם פרטים מהקופה
  IF NEW.customer_id IS NULL
     OR NEW.customer_id IS DISTINCT FROM auth.uid()
     OR NEW.terms_accepted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
        WHERE ur.tenant_id = NEW.tenant_id AND ur.user_id = NEW.customer_id
          AND ur.role = 'customer') THEN
    RETURN NULL;
  END IF;
  -- ערכים שהמסד לא יקבל (למשל מיקוד) — לא נשמרים, בלי להכשיל
  IF _zip IS NOT NULL AND _zip !~ '^[0-9]{5,7}$' THEN
    _zip := NULL;
  END IF;
  IF _city IS NOT NULL AND char_length(_city) > 80 THEN
    _city := NULL;
  END IF;
  IF _name IS NOT NULL AND char_length(_name) NOT BETWEEN 2 AND 120 THEN
    _name := NULL;
  END IF;

  BEGIN
    UPDATE public.customer_profiles cp
       SET business_name = COALESCE(_name, cp.business_name),
           tax_id = COALESCE(_tax, cp.tax_id),
           phone = COALESCE(_phone, cp.phone),
           city = COALESCE(_city, cp.city),
           business_address = COALESCE(_address, cp.business_address),
           zip_code = COALESCE(_zip, cp.zip_code)
     WHERE cp.user_id = NEW.customer_id AND cp.tenant_id = NEW.tenant_id;
    IF NOT FOUND AND _name IS NOT NULL THEN
      -- אישור התנאים בקופה כולל את הצהרת הגיל (בחנות שמוכרת אלכוהול)
      INSERT INTO public.customer_profiles (
        user_id, tenant_id, business_name, tax_id, phone, city, business_address, zip_code,
        age_confirmed)
      VALUES (
        NEW.customer_id, NEW.tenant_id, _name, _tax, _phone, _city, _address, _zip, true)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- הפרופיל הוא נוחות להזמנה הבאה — לעולם לא סיבה להכשיל הזמנה
    RAISE WARNING '[orders_remember_customer_details] % (order %)', SQLERRM, NEW.id;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.orders_remember_customer_details() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_remember_customer_details ON public.orders;
CREATE TRIGGER orders_remember_customer_details
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_remember_customer_details();

COMMENT ON FUNCTION public.orders_remember_customer_details() IS
  'חלק 22: פרטי הקופה של לקוח מחובר נשמרים בפרופיל שלו — מילוי אוטומטי בהזמנה הבאה';

-- ------------------------------------------------------------
-- 2. עמוד התשלום בביט: פרטי איסוף עצמי
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bit_payment_info(_order uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  o public.orders;
  s public.site_settings;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order AND tenant_id = _tenant;
  IF o.id IS NULL OR o.payment_method <> 'bit' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.site_settings WHERE tenant_id = _tenant;
  RETURN jsonb_build_object(
    'order_id', o.id,
    'order_number', o.order_number,
    'amount', public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate),
    'status', o.status,
    'payment_status', o.payment_status,
    'payment_due_at', o.payment_due_at,
    'reported_at', o.payment_reported_at,
    'paid_at', o.paid_at,
    'has_reference', o.bit_transaction_id IS NOT NULL,
    'has_receipt', o.bit_receipt_url IS NOT NULL,
    'bit_phone', s.payment_bit_phone,
    'store_name', COALESCE(NULLIF(btrim(s.business_name), ''), NULLIF(btrim(s.site_title), '')),
    'store_phone', COALESCE(NULLIF(btrim(s.support_phone), ''), NULLIF(btrim(s.business_phone), '')),
    'registered', o.customer_id IS NOT NULL,
    -- חלק 22: איסוף עצמי — כתובת החנות ושעות הפעילות (מידע ציבורי של החנות)
    'pickup', o.shipping_kind = 'pickup',
    'store_address', NULLIF(btrim(COALESCE(s.business_address, '')), ''),
    'store_hours', NULLIF(btrim(COALESCE(s.business_hours, '')), ''));
END $$;
REVOKE ALL ON FUNCTION public.bit_payment_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bit_payment_info(uuid) TO service_role;

COMMIT;

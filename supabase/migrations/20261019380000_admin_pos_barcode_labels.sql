-- ============================================================
-- חלק 32 (חלק 31 בתוכנית של בעל החנות): כלי תפעול לבעל החנות
--
-- 1. קופה מהירה בניהול (/admin/orders/new): הזמנה טלפונית / מכירה בחנות.
--    admin_create_order יוצר את ההזמנה בטרנזקציה אחת, דרך אותם טריגרים
--    של כל הזמנה: מספר הזמנה, מע"מ מההגדרות, צילום המוצר בשורה, שמירת
--    מלאי (order_items_stock_sync), פיקדונות, מתנות לפי הטבות החנות,
--    דמי משלוח וסף משלוח חינם, וההתראות לצוות.
--    חדש בהזמנה:
--      • order_source — 'web' (אתר / ניהול רגיל) או 'pos' (נוצרה בקופה)
--      • created_by — המנהל שיצר אותה בקופה
--      • הנחה ידנית: manual_discount_type ('percent' / 'fixed') + ערך;
--        הסכום (manual_discount_amount) מחושב במסד, אחרי הקופון, על
--        המוצרים בלבד. discount_amount = קופון + הנחה ידנית — כך כל
--        המסכים, המיילים וה-PDF שכבר מציגים "הנחה" ממשיכים לעבוד.
--      • pos_payment_method — מזומן / אשראי / ביט / העברה / צ'ק / בהמשך.
--        "התשלום התקבל" → payment_status = 'paid' (המסלול הרגיל של
--        orders_payment_guard, עם kobi.payment_update).
--    הזמנת אורח מהקופה: מספיקים שם + טלפון (בלי ת.ז / מיקוד — הלקוח
--    בטלפון או מול הקופה); למשלוח עד הבית — עיר וכתובת.
--    מכירה בחנות ("נמסר במקום") — ההזמנה עוברת מיד ל"נמסרה ללקוח".
-- 2. חיפוש לקוחות לקופה (admin_search_customers): לקוחות רשומים + קונים
--    קודמים שהזמינו כאורחים, לפי שם / טלפון / אימייל.
-- 3. מחולל מדבקות ברקוד: גודל המדבקה של החנות נשמר (ברירת מחדל 70×40 מ"מ)
--    — site_settings.barcode_label_width_mm / barcode_label_height_mm.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. עמודות חדשות בהזמנה
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_source text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS manual_discount_type text,
  ADD COLUMN IF NOT EXISTS manual_discount_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS manual_discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pos_payment_method text;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_pos_fields_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_pos_fields_check CHECK (
  order_source IN ('web', 'pos')
  AND (manual_discount_type IS NULL OR manual_discount_type IN ('percent', 'fixed'))
  AND ((manual_discount_type IS NULL) = (manual_discount_value IS NULL))
  AND (manual_discount_value IS NULL
       OR (manual_discount_value > 0
           AND manual_discount_value <= 1000000
           AND (manual_discount_type <> 'percent' OR manual_discount_value <= 100)))
  AND manual_discount_amount >= 0
  AND (pos_payment_method IS NULL
       OR pos_payment_method IN ('cash', 'card', 'bit', 'transfer', 'check', 'later'))
);

-- המנהל שיצר את ההזמנה בקופה (מנהל-על שאינו חבר בחנות — NULL)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_created_by_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_created_by_fkey
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.user_roles (tenant_id, user_id)
  ON DELETE SET NULL (created_by);

CREATE INDEX IF NOT EXISTS orders_pos_idx
  ON public.orders (tenant_id, created_at DESC) WHERE order_source = 'pos';

-- הזמנת אורח: מהקופה (שם + טלפון) — או מהאתר (כל פרטי הקופה, כמו קודם)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_guest_details_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_guest_details_check CHECK (
  customer_id IS NOT NULL
  OR (order_source = 'pos' AND customer_name IS NOT NULL AND customer_phone IS NOT NULL)
  OR (customer_name IS NOT NULL AND customer_tax_id IS NOT NULL AND customer_phone IS NOT NULL
      AND customer_email IS NOT NULL
      AND (shipping_kind IN ('pickup', 'digital')
           OR (billing_city IS NOT NULL AND billing_address IS NOT NULL AND billing_zip IS NOT NULL)))
);

-- ============================================================
-- 2. שדות הקופה נקבעים רק ע"י מנהל (הקופה רצה בהרשאות שלו); מקור
--    ההזמנה ומי יצר אותה — לא משתנים אחרי היצירה
-- ============================================================
-- השם נבחר כך שהטריגר רץ לפני orders_shipping_and_total (סדר אלפביתי),
-- שמחשב את ההנחה הידנית
CREATE OR REPLACE FUNCTION public.orders_pos_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin boolean := public.is_admin(auth.uid());
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT admin OR NEW.order_source IS DISTINCT FROM 'pos' THEN
      NEW.order_source := 'web';
      NEW.created_by := NULL;
      IF NOT admin THEN
        NEW.manual_discount_type := NULL;
        NEW.manual_discount_value := NULL;
        NEW.pos_payment_method := NULL;
      END IF;
    ELSE
      -- תמיד המנהל שמחובר בפועל (לא ערך מהדפדפן)
      NEW.created_by := public.tenant_member_id();
    END IF;
  ELSE
    NEW.order_source := OLD.order_source;
    NEW.created_by := OLD.created_by;
    IF NOT admin THEN
      NEW.manual_discount_type := OLD.manual_discount_type;
      NEW.manual_discount_value := OLD.manual_discount_value;
      NEW.pos_payment_method := OLD.pos_payment_method;
    END IF;
  END IF;
  -- הסכום בפועל — רק מהחישוב במסד
  NEW.manual_discount_amount := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.manual_discount_amount END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_pos_guard ON public.orders;
CREATE TRIGGER orders_pos_guard
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_pos_guard();

-- ============================================================
-- 3. דמי משלוח, קופון והנחה ידנית → total (זהה לחלק 24 + ההנחה הידנית)
-- ============================================================
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

-- ============================================================
-- 4. מחיר ליחידה בקופה — כמו שהקונה היה משלם (זהה ל-snapshot_order_item_product
--    למי שאינו צוות): מחיר הוריאציה → מחירון אישי → מחיר הדרג, ומבצע בתוקף
--    שזול יותר. אורח = דרג 1. למנהלים בלבד.
-- ============================================================
CREATE OR REPLACE FUNCTION public.pos_unit_price(
  _customer_id uuid,
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  v_price numeric;
  tier smallint;
  price numeric;
  custom numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT gp.price_tier1, gp.price_tier2, gp.price_tier3,
         gp.sale_price, gp.sale_starts_at, gp.sale_ends_at
    INTO p
    FROM public.global_products gp
   WHERE gp.id = _product_id AND gp.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF _variant_id IS NOT NULL THEN
    SELECT v.price INTO v_price
      FROM public.product_variants v
     WHERE v.id = _variant_id AND v.product_id = _product_id
       AND v.tenant_id = public.current_tenant_id();
    IF v_price IS NOT NULL THEN
      RETURN round(v_price, 2);
    END IF;
  END IF;
  tier := CASE WHEN _customer_id IS NULL THEN 1 ELSE public.buyer_price_tier(_customer_id) END;
  price := CASE tier WHEN 1 THEN p.price_tier1 WHEN 2 THEN p.price_tier2 WHEN 3 THEN p.price_tier3 END;
  IF price IS NOT NULL AND _customer_id IS NOT NULL THEN
    custom := public.active_custom_price(_customer_id, _product_id);
    IF custom IS NOT NULL THEN
      price := custom;
    END IF;
  END IF;
  IF price IS NOT NULL AND public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
    price := LEAST(price, p.sale_price);
  END IF;
  RETURN round(COALESCE(price, 0), 2);
END $$;

REVOKE ALL ON FUNCTION public.pos_unit_price(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_unit_price(uuid, uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 5. הקופה המהירה: יצירת הזמנה ע"י מנהל
--
-- _customer_id — לקוח רשום (או NULL = אורח)
-- _items — [{product_id, variant_id?, quantity, unit_price?}] — בלי
--          unit_price: המחיר של הלקוח (pos_unit_price). פיקדונות ומתנות
--          נוספים כאן במסד, לא מהדפדפן.
-- _details — {customer_name, customer_phone, customer_email, city, address,
--          zip, fulfillment: 'in_store' | 'shipping', shipping_method_id,
--          payment_method, paid, discount: {type, value}, note}
--
-- רצה בהרשאות של המנהל (SECURITY INVOKER): ה-RLS והטריגרים של כל הזמנה
-- חלים כרגיל — "צוות" (מחיר כפי שנשלח, מלאי בלי חסימה, שיטת משלוח).
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_create_order(
  _customer_id uuid,
  _items jsonb,
  _details jsonb
)
RETURNS TABLE(id uuid, order_number text, total numeric, status text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
  _me uuid := auth.uid();
  d jsonb := COALESCE(_details, '{}'::jsonb);
  _fulfillment text := COALESCE(NULLIF(btrim(COALESCE(_details ->> 'fulfillment', '')), ''), 'in_store');
  _method uuid := public.uuid_or_null(_details ->> 'shipping_method_id');
  _method_kind text;
  _shipping_kind text;
  _has_physical boolean;
  _member RECORD;
  _profile RECORD;
  _name text;
  _phone text;
  _email text;
  _city text;
  _address text;
  _zip text;
  _note text;
  _pay text := COALESCE(NULLIF(btrim(COALESCE(_details ->> 'payment_method', '')), ''), 'cash');
  _paid boolean := lower(COALESCE(_details ->> 'paid', 'true')) IN ('true', 't', '1', 'yes');
  _disc_type text := NULLIF(btrim(COALESCE(_details #>> '{discount,type}', '')), '');
  _disc_raw text := btrim(COALESCE(_details #>> '{discount,value}', ''));
  _disc_value numeric;
  line jsonb;
  p RECORD;
  _variant uuid;
  _attrs text;
  _created_id uuid;
BEGIN
  IF _me IS NULL OR NOT public.is_admin(_me) THEN
    RAISE EXCEPTION 'רק מנהלי החנות יכולים ליצור הזמנה בקופה'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF jsonb_typeof(d) <> 'object' THEN
    RAISE EXCEPTION 'פרטי ההזמנה אינם תקינים' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- השורות ----------
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הוסיפו לפחות מוצר אחד להזמנה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_items) > 200 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת (עד 200)' USING ERRCODE = 'check_violation';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(line) <> 'object' OR public.uuid_or_null(line ->> 'product_id') IS NULL THEN
      RAISE EXCEPTION 'שורה לא תקינה בהזמנה — רעננו את המסך ונסו שוב'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT gp.name, gp.variant_attributes INTO p
      FROM public.global_products gp
     WHERE gp.id = public.uuid_or_null(line ->> 'product_id') AND gp.tenant_id = _tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'אחד המוצרים כבר לא קיים בקטלוג — רעננו את המסך'
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(line ->> 'quantity', '') !~ '^[0-9]{1,5}$'
       OR (line ->> 'quantity')::integer < 1 THEN
      RAISE EXCEPTION 'כמות לא תקינה עבור "%" (1–99,999)', p.name USING ERRCODE = 'check_violation';
    END IF;
    IF line ->> 'unit_price' IS NOT NULL
       AND (btrim(line ->> 'unit_price') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$') THEN
      RAISE EXCEPTION 'המחיר של "%" אינו תקין', p.name USING ERRCODE = 'check_violation';
    END IF;
    _variant := public.uuid_or_null(line ->> 'variant_id');
    IF _variant IS NULL AND EXISTS (
         SELECT 1 FROM public.product_variants v
          WHERE v.product_id = public.uuid_or_null(line ->> 'product_id')
            AND v.tenant_id = _tenant AND v.is_active) THEN
      SELECT string_agg(a ->> 'name', ' / ') INTO _attrs
        FROM jsonb_array_elements(COALESCE(p.variant_attributes, '[]'::jsonb)) a;
      RAISE EXCEPTION 'יש לבחור % עבור "%"', COALESCE(_attrs, 'אפשרות'), p.name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ---------- הלקוח ----------
  IF _customer_id IS NOT NULL THEN
    SELECT ur.email, ur.is_blocked INTO _member
      FROM public.user_roles ur
     WHERE ur.user_id = _customer_id AND ur.tenant_id = _tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הלקוח לא נמצא בחנות — חפשו אותו שוב' USING ERRCODE = 'check_violation';
    END IF;
    IF _member.is_blocked THEN
      RAISE EXCEPTION 'החשבון של הלקוח חסום — לא ניתן לפתוח לו הזמנה'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT cp.business_name, cp.phone, cp.city, cp.business_address, cp.zip_code INTO _profile
      FROM public.customer_profiles cp
     WHERE cp.user_id = _customer_id AND cp.tenant_id = _tenant;
  END IF;

  _name := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'customer_name', ''), '\s+', ' ', 'g')), '');
  IF _name IS NULL AND _customer_id IS NOT NULL THEN
    _name := NULLIF(btrim(COALESCE(_profile.business_name, '')), '');
  END IF;
  IF _name IS NULL AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'נא להזין את שם הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם הלקוח: בין 2 ל-120 תווים' USING ERRCODE = 'check_violation';
  END IF;

  _phone := NULLIF(regexp_replace(COALESCE(d ->> 'customer_phone', ''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'מספר הטלפון אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone IS NULL AND _customer_id IS NOT NULL THEN
    -- מהפרופיל — רק אם הוא בפורמט שהמסד מקבל (אחרת בלי טלפון בהזמנה)
    _phone := NULLIF(regexp_replace(COALESCE(_profile.phone, ''), '[^0-9+]', '', 'g'), '');
    IF _phone !~ '^\+?[0-9]{9,15}$' THEN
      _phone := NULL;
    END IF;
  END IF;
  IF _phone IS NULL AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'נא להזין מספר טלפון נייד של הלקוח' USING ERRCODE = 'check_violation';
  END IF;

  _email := NULLIF(lower(btrim(COALESCE(d ->> 'customer_email', ''))), '');
  IF _email IS NOT NULL AND (char_length(_email) > 254
     OR _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
    RAISE EXCEPTION 'כתובת האימייל אינה תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _email IS NULL AND _customer_id IS NOT NULL THEN
    _email := NULLIF(lower(btrim(COALESCE(_member.email, ''))), '');
    IF _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      _email := NULL;
    END IF;
  END IF;

  _city := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'city', ''), '\s+', ' ', 'g')), '');
  _address := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'address', ''), '\s+', ' ', 'g')), '');
  _zip := NULLIF(regexp_replace(COALESCE(d ->> 'zip', ''), '\D', '', 'g'), '');
  IF _city IS NOT NULL AND char_length(_city) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'שם העיר: בין 2 ל-80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _address IS NOT NULL AND char_length(_address) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'הכתובת: בין 2 ל-200 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _zip IS NOT NULL AND _zip !~ '^[0-9]{5,7}$' THEN
    RAISE EXCEPTION 'מיקוד לא תקין (5 או 7 ספרות) — או השאירו ריק' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- מסירה / משלוח ----------
  IF _fulfillment NOT IN ('in_store', 'shipping') THEN
    RAISE EXCEPTION 'אופן המסירה אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS x
      JOIN public.global_products gp
        ON gp.tenant_id = _tenant AND gp.id = public.uuid_or_null(x ->> 'product_id')
     WHERE NOT gp.is_digital
  ) INTO _has_physical;

  IF _fulfillment = 'shipping' THEN
    IF _method IS NULL THEN
      RAISE EXCEPTION 'נא לבחור שיטת משלוח' USING ERRCODE = 'check_violation';
    END IF;
    SELECT m.kind INTO _method_kind
      FROM public.shipping_methods m
     WHERE m.id = _method AND m.tenant_id = _tenant AND m.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'שיטת המשלוח שנבחרה אינה זמינה עוד — בחרו שיטה אחרת'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _method_kind = 'delivery' THEN
      -- לקוח רשום בלי כתובת בטופס — הכתובת השמורה בפרופיל שלו
      IF _city IS NULL AND _address IS NULL AND _customer_id IS NOT NULL THEN
        _city := NULLIF(btrim(COALESCE(_profile.city, '')), '');
        _address := NULLIF(btrim(COALESCE(_profile.business_address, '')), '');
        _zip := CASE WHEN COALESCE(_profile.zip_code, '') ~ '^[0-9]{5,7}$' THEN _profile.zip_code END;
        IF char_length(_city) NOT BETWEEN 2 AND 80 THEN _city := NULL; END IF;
        IF char_length(_address) NOT BETWEEN 2 AND 200 THEN _address := NULL; END IF;
      END IF;
      IF _city IS NULL OR _address IS NULL THEN
        RAISE EXCEPTION 'למשלוח עד הבית נא להזין עיר וכתובת (רחוב ומספר בית)'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    _method := NULL;
    _shipping_kind := CASE WHEN NOT _has_physical THEN 'digital' END;
  END IF;

  -- ---------- תשלום ----------
  IF _pay NOT IN ('cash', 'card', 'bit', 'transfer', 'check', 'later') THEN
    RAISE EXCEPTION 'אמצעי התשלום אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _pay = 'later' THEN
    _paid := false;
  END IF;

  -- ---------- הנחה ידנית ----------
  IF _disc_type IS NOT NULL OR _disc_raw <> '' THEN
    IF _disc_type IS NULL OR _disc_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'סוג ההנחה אינו תקין (אחוזים או סכום)' USING ERRCODE = 'check_violation';
    END IF;
    IF _disc_raw !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'סכום ההנחה אינו תקין' USING ERRCODE = 'check_violation';
    END IF;
    _disc_value := _disc_raw::numeric;
    IF _disc_value <= 0 THEN
      _disc_type := NULL;
      _disc_value := NULL;
    ELSIF _disc_type = 'percent' AND _disc_value > 100 THEN
      RAISE EXCEPTION 'הנחה באחוזים — עד 100%%' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  _note := NULLIF(btrim(COALESCE(d ->> 'note', '')), '');
  IF char_length(_note) > 1000 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 1000 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- ההזמנה ----------
  INSERT INTO public.orders AS o (
    customer_id, status, kind, total, note,
    customer_name, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    shipping_method_id, shipping_kind,
    order_source, manual_discount_type, manual_discount_value, pos_payment_method)
  VALUES (
    _customer_id, 'pending', 'order', 0, _note,
    _name, _phone, _email,
    _city, _address, _zip,
    _method, _shipping_kind,
    'pos', _disc_type, _disc_value, _pay)
  RETURNING o.id INTO _created_id;

  -- השורות — ממוינות לפי מוצר ווריאציה (נעילות המלאי תמיד באותו סדר)
  INSERT INTO public.order_items (order_id, product_id, variant_id, quantity, unit_price)
  SELECT _created_id, x.product_id, x.variant_id, x.quantity,
         COALESCE(x.unit_price, public.pos_unit_price(_customer_id, x.product_id, x.variant_id))
    FROM (
      SELECT public.uuid_or_null(e ->> 'product_id') AS product_id,
             public.uuid_or_null(e ->> 'variant_id') AS variant_id,
             (e ->> 'quantity')::integer AS quantity,
             CASE WHEN e ->> 'unit_price' IS NULL THEN NULL
                  ELSE round(btrim(e ->> 'unit_price')::numeric, 2) END AS unit_price
        FROM jsonb_array_elements(_items) AS e
    ) AS x
   ORDER BY x.product_id, x.variant_id NULLS FIRST;

  -- פיקדון למוצרים שיש להם (שורה אחת לכל מוצר — כמו בקופה של האתר)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
  SELECT _created_id, gp.id, SUM(oi.quantity)::integer, gp.deposit_price * gp.deposit_units, true
    FROM public.order_items oi
    JOIN public.global_products gp ON gp.id = oi.product_id AND gp.tenant_id = oi.tenant_id
   WHERE oi.order_id = _created_id AND NOT oi.is_deposit AND NOT oi.is_gift
     AND gp.has_deposit AND gp.deposit_price IS NOT NULL AND gp.deposit_units IS NOT NULL
   GROUP BY gp.id, gp.deposit_price, gp.deposit_units
   ORDER BY gp.id;

  -- מתנות לפי הטבות החנות (כמו בכל הזמנה)
  PERFORM public.apply_order_gifts(_created_id);

  -- התשלום התקבל בקופה — המסלול הרגיל של שדות התשלום
  IF _paid THEN
    PERFORM set_config('kobi.payment_update', 'on', true);
    UPDATE public.orders AS o
       SET payment_status = 'paid', paid_at = now(), payment_confirmed_by = _me
     WHERE o.id = _created_id;
    PERFORM set_config('kobi.payment_update', 'off', true);
  END IF;

  -- מכירה בחנות: הלקוח כבר קיבל את המוצרים
  IF _fulfillment = 'in_store' THEN
    UPDATE public.orders AS o SET status = 'delivered' WHERE o.id = _created_id;
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.total, o.status FROM public.orders AS o WHERE o.id = _created_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_order(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_order(uuid, jsonb, jsonb) TO authenticated, service_role;

-- ============================================================
-- 6. חיפוש לקוח לקופה: לקוחות רשומים + קונים שהזמינו כאורחים
--    (לפי שם / טלפון / אימייל). בלי מונח — הלקוחות האחרונים.
--    SECURITY DEFINER (הדרג האפקטיבי — buyer_price_tier); למנהלים בלבד,
--    וכל שאילתה מסוננת במפורש לחנות של האתר.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_search_customers(_term text DEFAULT '')
RETURNS TABLE(
  kind text,
  customer_id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  zip text,
  price_tier smallint,
  price_list_type text,
  orders_count integer,
  last_order_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
  _q text := lower(btrim(regexp_replace(COALESCE(_term, ''), '\s+', ' ', 'g')));
  _digits text := regexp_replace(COALESCE(_term, ''), '\D', '', 'g');
  _like text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(_q) > 80 THEN
    _q := left(_q, 80);
  END IF;
  -- +972 50... → 050...
  IF _digits LIKE '972%' AND char_length(_digits) >= 5 THEN
    _digits := '0' || substr(_digits, 4);
  END IF;
  IF char_length(_digits) < 3 THEN
    _digits := NULL;
  END IF;
  _like := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  WITH accounts AS (
    SELECT 'account'::text AS kind,
           ur.user_id AS customer_id,
           COALESCE(NULLIF(btrim(cp.business_name), ''), NULLIF(btrim(ur.display_name), ''),
                    split_part(ur.email, '@', 1)) AS name,
           cp.phone AS phone,
           ur.email AS email,
           cp.city AS city,
           cp.business_address AS address,
           cp.zip_code AS zip,
           public.buyer_price_tier(ur.user_id) AS price_tier,
           COALESCE(cp.price_list_type, 'regular') AS price_list_type,
           (SELECT count(*)::integer FROM public.orders o
             WHERE o.tenant_id = _tenant AND o.customer_id = ur.user_id) AS orders_count,
           (SELECT max(o.created_at) FROM public.orders o
             WHERE o.tenant_id = _tenant AND o.customer_id = ur.user_id) AS last_order_at
      FROM public.user_roles ur
      LEFT JOIN public.customer_profiles cp
             ON cp.user_id = ur.user_id AND cp.tenant_id = ur.tenant_id
     WHERE ur.tenant_id = _tenant
       AND ur.role = 'customer'
       AND NOT ur.is_blocked
       AND (_q = ''
            OR lower(COALESCE(cp.business_name, '')) LIKE _like
            OR lower(COALESCE(cp.contact_name, '')) LIKE _like
            OR lower(COALESCE(ur.display_name, '')) LIKE _like
            OR lower(ur.email) LIKE _like
            OR (_digits IS NOT NULL
                AND regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g') LIKE '%' || _digits || '%'))
  ),
  guest_orders AS (
    SELECT o.*,
           COALESCE(lower(o.customer_email), o.customer_phone) AS buyer_key
      FROM public.orders o
     WHERE o.tenant_id = _tenant
       AND o.customer_id IS NULL
       AND o.customer_name IS NOT NULL
       -- מי שיש לו חשבון בחנות — מופיע כלקוח רשום
       AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                        WHERE ur2.tenant_id = _tenant
                          AND lower(ur2.email) = lower(COALESCE(o.customer_email, '')))
  ),
  guests AS (
    SELECT DISTINCT ON (g.buyer_key)
           'guest'::text AS kind,
           NULL::uuid AS customer_id,
           g.customer_name AS name,
           g.customer_phone AS phone,
           g.customer_email AS email,
           g.billing_city AS city,
           g.billing_address AS address,
           g.billing_zip AS zip,
           1::smallint AS price_tier,
           'regular'::text AS price_list_type,
           (count(*) OVER (PARTITION BY g.buyer_key))::integer AS orders_count,
           max(g.created_at) OVER (PARTITION BY g.buyer_key) AS last_order_at
      FROM guest_orders g
     WHERE g.buyer_key IS NOT NULL
       AND (_q = ''
            OR lower(g.customer_name) LIKE _like
            OR lower(COALESCE(g.customer_email, '')) LIKE _like
            OR (_digits IS NOT NULL
                AND regexp_replace(COALESCE(g.customer_phone, ''), '\D', '', 'g') LIKE '%' || _digits || '%'))
     ORDER BY g.buyer_key, g.created_at DESC
  )
  SELECT r.kind, r.customer_id, r.name, r.phone, r.email, r.city, r.address, r.zip,
         r.price_tier, r.price_list_type, r.orders_count, r.last_order_at
    FROM (SELECT * FROM accounts UNION ALL SELECT * FROM guests) AS r
   ORDER BY r.last_order_at DESC NULLS LAST, r.name
   LIMIT CASE WHEN _q = '' THEN 8 ELSE 20 END;
END $$;

REVOKE ALL ON FUNCTION public.admin_search_customers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text) TO authenticated, service_role;

-- ============================================================
-- 7. מחולל מדבקות ברקוד: גודל המדבקה של החנות (ברירת מחדל 70×40 מ"מ —
--    מדפסת תרמית כמו Zebra). נפרד ממדבקת המשלוח (label_width_mm).
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS barcode_label_width_mm numeric(5,1) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS barcode_label_height_mm numeric(5,1) NOT NULL DEFAULT 40;
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_barcode_label_size_check;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_barcode_label_size_check CHECK (
  barcode_label_width_mm BETWEEN 30 AND 200 AND barcode_label_height_mm BETWEEN 20 AND 300
);

COMMIT;

-- ============================================================
-- חלק 17ב: אמצעי תשלום חלופיים (אופליין) — תשלום טלפוני מול נציג, ותשלום בביט
--
-- הגדרות החנות (site_settings, נשמר מ"הגדרות אתר" בפאנל):
--   payment_phone_enabled — "תשלום טלפוני מול נציג" (ברירת מחדל: פעיל)
--   payment_bit_enabled   — "תשלום בביט" (ברירת מחדל: כבוי)
--   payment_bit_phone     — המספר הנייד שאליו הלקוחות מעבירים בביט (חובה כשביט פעיל)
--   (המספר מוצג ללקוחות בקופה ובעמוד התשלום — לכן הוא ב-site_settings הציבורית)
--
-- הזמנה בביט — עמידה לסגירת הדפדפן במעבר לאפליקציה:
--   1. "המשך לתשלום בביט" בקופה → ההזמנה נשמרת קודם במסד:
--        payment_method = 'bit', payment_status = 'awaiting' (= pending_payment:
--        ממתינה לתשלום), payment_due_at = עוד 24 שעות. המלאי נשמר לה מיד.
--   2. הלקוח עובר ל-/checkout/bit/<order_id> — העמוד נטען מחדש מהמסד גם אם
--      הדפדפן נסגר / התרענן באמצע המעבר לביט.
--   3. הלקוח שולח מספר אסמכתא או צילום מסך (bit_payment_submit, מהשרת) →
--        payment_status = 'awaiting_verification' (ממתינה לאישור תשלום),
--        ונשלחים מיילי ההזמנה (ללקוח ולצוות).
--   4. בעל החנות רואה את האסמכתא / הצילום ומאשר (bit_payment_review) →
--        'paid'; או דוחה → 'rejected' וההזמנה מבוטלת (המלאי חוזר).
--   לא שולמה ולא נשלחה אסמכתא תוך 24 שעות → מבוטלת והמלאי חוזר
--   (expire_unpaid_orders מחלק 16 — אותו מנגנון של הסליקה באשראי).
--
-- צילומי המסך — בדלי פרטי payment-receipts (<tenant_id>/<order_id>/...),
-- רק השרת כותב / קורא; המנהל מקבל קישור צפייה זמני.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. הגדרות החנות: אמצעי התשלום החלופיים
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS payment_phone_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_bit_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_bit_phone TEXT;

COMMENT ON COLUMN public.site_settings.payment_phone_enabled IS
  'חלק 17ב: "תשלום טלפוני מול נציג" זמין בקופה';
COMMENT ON COLUMN public.site_settings.payment_bit_enabled IS
  'חלק 17ב: "תשלום בביט" זמין בקופה (דורש payment_bit_phone)';
COMMENT ON COLUMN public.site_settings.payment_bit_phone IS
  'חלק 17ב: מספר הנייד של בעל החנות לקבלת תשלום בביט (05XXXXXXXX) — מוצג ללקוחות';

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_bit_phone_check;
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_bit_phone_check CHECK (
    (payment_bit_phone IS NULL OR payment_bit_phone ~ '^05[0-9]{8}$')
    AND (NOT payment_bit_enabled OR payment_bit_phone IS NOT NULL));

-- נרמול המספר והודעות ברורות (לפני ה-CHECK): 050-123 4567 / +972501234567 → 0501234567
CREATE OR REPLACE FUNCTION public.site_settings_payment_methods_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _digits text := regexp_replace(COALESCE(NEW.payment_bit_phone, ''), '\D', '', 'g');
BEGIN
  IF _digits LIKE '972%' THEN
    _digits := '0' || substr(_digits, 4);
  END IF;
  NEW.payment_bit_phone := NULLIF(_digits, '');
  IF NEW.payment_bit_phone IS NOT NULL AND NEW.payment_bit_phone !~ '^05[0-9]{8}$' THEN
    RAISE EXCEPTION 'מספר הטלפון לביט צריך להיות מספר נייד ישראלי (למשל 050-1234567)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.payment_bit_enabled AND NEW.payment_bit_phone IS NULL THEN
    RAISE EXCEPTION 'כדי להפעיל תשלום בביט יש להזין מספר טלפון לקבלת תשלום בביט'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (NEW.payment_phone_enabled OR NEW.payment_bit_enabled OR NEW.card_payments_enabled) THEN
    RAISE EXCEPTION 'יש להשאיר לפחות אמצעי תשלום אחד פעיל בקופה'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS site_settings_payment_methods_guard ON public.site_settings;
CREATE TRIGGER site_settings_payment_methods_guard
BEFORE INSERT OR UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.site_settings_payment_methods_guard();

-- ביט פעיל בחנות: הודלק ויש מספר
CREATE OR REPLACE FUNCTION public.bit_payments_active(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_settings s
                  WHERE s.tenant_id = _tenant AND s.payment_bit_enabled
                    AND s.payment_bit_phone IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.bit_payments_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bit_payments_active(uuid) TO service_role;

-- ============================================================
-- 2. הזמנות: עמודות ביט, אמצעי תשלום ומצבי תשלום חדשים
-- ============================================================
ALTER TABLE public.orders
  -- מספר האסמכתא שהלקוח הזין (מאפליקציית ביט)
  ADD COLUMN IF NOT EXISTS bit_transaction_id TEXT,
  -- הנתיב של צילום המסך בדלי payment-receipts (<tenant_id>/<order_id>/...)
  ADD COLUMN IF NOT EXISTS bit_receipt_url TEXT,
  -- מתי הלקוח שלח את פרטי התשלום, ומי מהצוות אישר / דחה
  ADD COLUMN IF NOT EXISTS payment_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by UUID;

COMMENT ON COLUMN public.orders.bit_transaction_id IS 'חלק 17ב: מספר אסמכתא של העברה בביט (מהלקוח)';
COMMENT ON COLUMN public.orders.bit_receipt_url IS 'חלק 17ב: נתיב צילום המסך של ההעברה בדלי הפרטי payment-receipts';

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_check CHECK (
    -- offline = תשלום טלפוני מול נציג | credit_card = Hyp | bit = העברה בביט
    payment_method IN ('offline', 'credit_card', 'bit')
    -- awaiting = ממתינה לתשלום (pending_payment) | awaiting_verification = ממתינה
    -- לאישור תשלום (הלקוח שלח אסמכתא) | rejected = בעל החנות דחה את התשלום
    AND payment_status IN ('not_required', 'awaiting', 'awaiting_verification', 'paid',
                           'expired', 'rejected')
    AND (payment_status <> 'paid' OR paid_at IS NOT NULL)
    AND (payment_method = 'bit' OR (bit_transaction_id IS NULL AND bit_receipt_url IS NULL))
    AND (bit_transaction_id IS NULL OR char_length(bit_transaction_id) BETWEEN 2 AND 64)
    AND (bit_receipt_url IS NULL OR char_length(bit_receipt_url) <= 300));

CREATE INDEX IF NOT EXISTS orders_payment_review_idx
  ON public.orders (tenant_id, payment_reported_at DESC)
  WHERE payment_status = 'awaiting_verification';

-- הזמנה חדשה: אמצעי התשלום שהלקוח ביקש (place_order / place_guest_order)
-- — רק אם הוא זמין בחנות. הצוות והצעות מחיר — בלי תשלום באתר (כמו תמיד).
CREATE OR REPLACE FUNCTION public.orders_card_payment_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- הבקשה: 'credit_card' (ברירת המחדל של place_order) / 'offline' / 'bit'.
  -- הכנסה ישירה לטבלה — 'offline' (ברירת המחדל של העמודה).
  _requested text := NEW.payment_method;
  _phone_enabled boolean;
BEGIN
  -- הערכים לא מגיעים מהדפדפן
  NEW.payment_method := 'offline';
  NEW.payment_status := 'not_required';
  NEW.payment_due_at := NULL;
  NEW.paid_at := NULL;
  NEW.hyp_transaction_id := NULL;
  NEW.payment_token := NULL;
  NEW.bit_transaction_id := NULL;
  NEW.bit_receipt_url := NULL;
  NEW.payment_reported_at := NULL;
  NEW.payment_confirmed_by := NULL;
  IF NEW.kind <> 'order' OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- אשראי (חלק 16ב): רק כשהסליקה פתוחה ופעילה בחנות
  IF _requested = 'credit_card' AND public.card_payments_active(NEW.tenant_id) THEN
    NEW.payment_method := 'credit_card';
    NEW.payment_status := 'awaiting';
    NEW.payment_due_at := now() + interval '30 minutes';
    RETURN NEW;
  END IF;

  -- ביט: ההזמנה נשמרת "ממתינה לתשלום" לפני שהלקוח עובר לאפליקציה
  IF _requested = 'bit' THEN
    IF NOT public.bit_payments_active(NEW.tenant_id) THEN
      RAISE EXCEPTION 'התשלום בביט אינו זמין כרגע בחנות — בחרו אמצעי תשלום אחר'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.payment_method := 'bit';
    NEW.payment_status := 'awaiting';
    NEW.payment_due_at := now() + interval '24 hours';
    RETURN NEW;
  END IF;

  -- "תשלום טלפוני מול נציג" (או אשראי שלא זמין) — רק אם החנות מאפשרת
  SELECT s.payment_phone_enabled INTO _phone_enabled
    FROM public.site_settings s WHERE s.tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_phone_enabled, true) THEN
    RAISE EXCEPTION 'התשלום הטלפוני מול נציג אינו זמין בחנות — בחרו אמצעי תשלום אחר'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- שדות התשלום משתנים רק דרך פונקציות התשלום (לא מהממשק / הדפדפן);
-- הזמנה שממתינה לתשלום (או לאישור תשלום) לא יוצאת לטיפול — רק ביטול
CREATE OR REPLACE FUNCTION public.orders_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('kobi.payment_update', true) IS DISTINCT FROM 'on' THEN
    NEW.payment_method := OLD.payment_method;
    NEW.payment_status := OLD.payment_status;
    NEW.payment_due_at := OLD.payment_due_at;
    NEW.paid_at := OLD.paid_at;
    NEW.hyp_transaction_id := OLD.hyp_transaction_id;
    NEW.payment_token := OLD.payment_token;
    NEW.bit_transaction_id := OLD.bit_transaction_id;
    NEW.bit_receipt_url := OLD.bit_receipt_url;
    NEW.payment_reported_at := OLD.payment_reported_at;
    NEW.payment_confirmed_by := OLD.payment_confirmed_by;
    -- ביטול ידני של הזמנה שממתינה לאישור תשלום בביט = התשלום נדחה;
    -- ביטול הביטול (החזרה לטיפול) — חוזרת להמתין לאישור
    IF NEW.payment_method = 'bit' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status = 'cancelled' AND NEW.payment_status = 'awaiting_verification' THEN
        NEW.payment_status := 'rejected';
      ELSIF OLD.status = 'cancelled' AND NEW.payment_status = 'rejected' THEN
        NEW.payment_status := 'awaiting_verification';
      END IF;
    END IF;
  END IF;
  IF NEW.payment_status IN ('awaiting', 'awaiting_verification')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('pending', 'cancelled') THEN
    IF NEW.payment_method = 'bit' THEN
      RAISE EXCEPTION 'ההזמנה % עדיין לא שולמה בביט — אשרו את התשלום לפני העברה לטיפול', NEW.order_number
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'ההזמנה % עדיין ממתינה לתשלום באשראי — אי אפשר להעביר אותה לטיפול', NEW.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 3. הקופה: אמצעי התשלום שהלקוח בחר ('bit' נוסף) — place_order /
--    place_guest_order זהות לחלק 16ב, חוץ מהמיפוי של payment_method
-- ============================================================
CREATE OR REPLACE FUNCTION public.checkout_payment_request(_details jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _details ->> 'payment_method'
           WHEN 'offline' THEN 'offline'
           WHEN 'bit' THEN 'bit'
           ELSE 'credit_card'
         END;
$$;

CREATE OR REPLACE FUNCTION public.place_order(
  _kind text,
  _items jsonb,
  _vat_rate numeric,
  _prices_include_vat boolean,
  _details jsonb DEFAULT NULL
)
RETURNS TABLE(id uuid, order_number text, kind text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created RECORD;
  d jsonb;
  ship RECORD;
  staff boolean := public.is_staff(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'יש להתחבר כדי לשלוח הזמנה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הסל ריק';
  END IF;
  IF jsonb_array_length(_items) > 400 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת';
  END IF;

  SELECT * INTO ship FROM public.checkout_shipping(_items, _details);

  IF _details IS NOT NULL THEN
    d := public.normalize_checkout_details(_details, false, ship.need_address);
    -- לקוח רשום: אם לא הוזן אימייל אחר — האימייל של החשבון
    IF d ->> 'customer_email' IS NULL THEN
      d := d || jsonb_build_object('customer_email',
        (SELECT ur.email FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
    END IF;
  END IF;

  INSERT INTO public.orders AS o (
    customer_id, status, kind, total, vat_rate, prices_include_vat, note,
    customer_name, customer_tax_id, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip,
    terms_accepted_at, shipping_method_id, shipping_kind, coupon_code, payment_method)
  VALUES (
    auth.uid(), 'pending', COALESCE(_kind, 'order'), 0,
    COALESCE(_vat_rate, 18), COALESCE(_prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    COALESCE((d ->> 'ship_to_different')::boolean, false),
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    CASE WHEN d IS NULL THEN NULL ELSE now() END,
    ship.method_id, ship.kind,
    NULLIF(left(btrim(COALESCE(_details ->> 'coupon_code', '')), 40), ''),
    -- אמצעי התשלום שהלקוח בחר בקופה — בקשה בלבד; הטריגר
    -- orders_card_payment_default מחליט לפי מה שזמין בחנות
    public.checkout_payment_request(_details))
  RETURNING o.id, o.order_number, o.kind INTO created;

  -- מיון לפי מוצר ווריאציה: נעילות המלאי נלקחות תמיד באותו סדר (בלי
  -- deadlock בין הזמנות). שורות "מתנה" מהדפדפן לא נכנסות — המתנות נקבעות במסד.
  INSERT INTO public.order_items (order_id, product_id, variant_id, quantity, unit_price, is_deposit)
  SELECT created.id,
         (x ->> 'product_id')::uuid,
         CASE WHEN COALESCE((x ->> 'is_deposit')::boolean, false) THEN NULL
              ELSE public.uuid_or_null(x ->> 'variant_id') END,
         (x ->> 'quantity')::integer,
         COALESCE((x ->> 'unit_price')::numeric, 0),
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
     AND (staff OR NOT COALESCE((x ->> 'is_deposit')::boolean, false))
   ORDER BY (x ->> 'product_id'), public.uuid_or_null(x ->> 'variant_id') NULLS FIRST,
            COALESCE((x ->> 'is_deposit')::boolean, false);

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts(created.id);
  END IF;
  PERFORM public.order_coupon_verify(created.id);

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END $$;

REVOKE ALL ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb)
  TO authenticated, service_role;

-- הזמנת אורח (בלי חשבון) — מהשרת של האתר בלבד (service_role), עם קופון
CREATE OR REPLACE FUNCTION public.place_guest_order(_kind text, _items jsonb, _details jsonb)
RETURNS TABLE(id uuid, order_number text, kind text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  d jsonb;
  st RECORD;
  ship RECORD;
  created RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'משתמש מחובר שולח הזמנה מהחשבון שלו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הסל ריק';
  END IF;
  IF jsonb_array_length(_items) > 400 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת';
  END IF;

  SELECT * INTO ship FROM public.checkout_shipping(_items, _details);
  d := public.normalize_checkout_details(_details, true, ship.need_address);

  -- מצב המע"מ של החנות (לא מהדפדפן)
  SELECT s.vat_rate, s.prices_include_vat INTO st
    FROM public.site_settings s WHERE s.tenant_id = _tenant;

  INSERT INTO public.orders AS o (
    tenant_id, customer_id, status, kind, total, vat_rate, prices_include_vat, note,
    customer_name, customer_tax_id, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip,
    terms_accepted_at, shipping_method_id, shipping_kind, coupon_code, payment_method)
  VALUES (
    _tenant, NULL, 'pending', CASE WHEN _kind = 'quote' THEN 'quote' ELSE 'order' END, 0,
    COALESCE(st.vat_rate, 18), COALESCE(st.prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    (d ->> 'ship_to_different')::boolean,
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    now(), ship.method_id, ship.kind,
    NULLIF(left(btrim(COALESCE(_details ->> 'coupon_code', '')), 40), ''),
    -- אמצעי התשלום שהלקוח בחר בקופה — בקשה בלבד; הטריגר
    -- orders_card_payment_default מחליט לפי מה שזמין בחנות
    public.checkout_payment_request(_details))
  RETURNING o.id, o.order_number, o.kind INTO created;

  INSERT INTO public.order_items (tenant_id, order_id, product_id, variant_id, quantity, unit_price, is_deposit)
  SELECT _tenant,
         created.id,
         (x ->> 'product_id')::uuid,
         public.uuid_or_null(x ->> 'variant_id'),
         (x ->> 'quantity')::integer,
         0,
         false
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
     AND NOT COALESCE((x ->> 'is_deposit')::boolean, false)
   ORDER BY (x ->> 'product_id'), public.uuid_or_null(x ->> 'variant_id') NULLS FIRST;

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts_internal(created.id);
  END IF;
  PERFORM public.order_coupon_verify(created.id);

  RETURN QUERY
    SELECT o.id, o.order_number, o.kind, o.total FROM public.orders o WHERE o.id = created.id;
END $$;

REVOKE ALL ON FUNCTION public.place_guest_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_guest_order(text, jsonb, jsonb) TO service_role;

-- ============================================================
-- 4. הסכום לתשלום של הזמנה (כולל מע"מ) — כמו בקופה ובסליקה (חלק 16)
-- ============================================================
CREATE OR REPLACE FUNCTION public.order_amount_due(_total numeric, _prices_include_vat boolean, _vat_rate numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(_prices_include_vat, true) THEN round(COALESCE(_total, 0), 2)
    ELSE round(COALESCE(_total, 0), 2)
         + round(round(COALESCE(_total, 0), 2) * COALESCE(_vat_rate, 18) / 100, 2)
  END;
$$;

-- כוונת תשלום באשראי — רק להזמנה שנבחר בה אשראי (הזמנת ביט לא עוברת ל-Hyp,
-- וחלון ה-24 שעות שלה לא מתקצר). זהה לחלק 16 חוץ מהבדיקה הזו.
CREATE OR REPLACE FUNCTION public.order_payment_intent(_order uuid, _origin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  o public.orders;
  s public.site_settings;
  _token text;
  _amount numeric;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order AND tenant_id = _tenant FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  END IF;
  IF o.payment_status = 'paid' THEN
    RETURN jsonb_build_object('status', 'paid', 'order_number', o.order_number);
  END IF;
  IF o.payment_status = 'not_required' OR o.payment_method <> 'credit_card' THEN
    RETURN jsonb_build_object('status', 'not_required', 'order_number', o.order_number);
  END IF;
  IF o.payment_status = 'expired' OR o.status = 'cancelled' THEN
    RAISE EXCEPTION 'פג הזמן לתשלום וההזמנה % בוטלה. אפשר להזמין מחדש מהסל.', o.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.site_settings WHERE tenant_id = _tenant;

  -- הסכום לתשלום = הסה"כ כולל מע"מ (כמו בקופה ובאישור ההזמנה — calculateVat)
  _amount := public.order_amount_due(o.total, o.prices_include_vat, o.vat_rate);

  PERFORM set_config('kobi.payment_update', 'on', true);
  IF _amount <= 0 THEN
    UPDATE public.orders SET payment_status = 'not_required', payment_due_at = NULL WHERE id = o.id;
    PERFORM set_config('kobi.payment_update', 'off', true);
    RETURN jsonb_build_object('status', 'not_required', 'order_number', o.order_number);
  END IF;
  UPDATE public.orders SET payment_due_at = now() + interval '30 minutes' WHERE id = o.id;
  PERFORM set_config('kobi.payment_update', 'off', true);

  -- ניסיונות קודמים שלא הושלמו — נסגרים (רק האחרון בתוקף)
  UPDATE public.payment_intents SET status = 'expired'
   WHERE order_id = o.id AND status IN ('pending', 'failed');

  INSERT INTO public.payment_intents
         (scope, kind, tenant_id, order_id, amount, max_payments, description, return_origin)
  VALUES ('store', 'order', _tenant, o.id, _amount, COALESCE(s.hyp_max_payments, 1),
          left(format('הזמנה %s — %s', o.order_number,
                      COALESCE(NULLIF(btrim(s.business_name), ''), 'החנות')), 250),
          NULLIF(_origin, ''))
  RETURNING token INTO _token;

  RETURN jsonb_build_object(
    'status', 'awaiting',
    'token', _token,
    'amount', _amount,
    'order_number', o.order_number,
    'max_payments', COALESCE(s.hyp_max_payments, 1),
    'customer_name', o.customer_name,
    'customer_email', o.customer_email,
    'customer_phone', o.customer_phone,
    'customer_tax_id', o.customer_tax_id,
    'billing_city', o.billing_city,
    'billing_address', o.billing_address,
    'billing_zip', o.billing_zip,
    'description', format('הזמנה %s', o.order_number));
END $$;
REVOKE ALL ON FUNCTION public.order_payment_intent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_payment_intent(uuid, text) TO service_role;

-- ============================================================
-- 5. עמוד התשלום בביט (/checkout/bit/<order_id>) — מהשרת בלבד
-- ============================================================
-- מה שהלקוח צריך לראות, בלי פרטים אישיים: מספר ההזמנה, הסכום, מספר הביט של
-- החנות ומצב התשלום. מזהה ההזמנה (UUID אקראי) הוא ה"מפתח" לעמוד.
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
    'registered', o.customer_id IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.bit_payment_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bit_payment_info(uuid) TO service_role;

-- הלקוח שולח אסמכתא ו/או צילום מסך → "ממתינה לאישור תשלום". פעם אחת:
-- שליחה חוזרת (לחיצה כפולה / רענון) מחזירה את המצב הקיים בלי לשנות.
CREATE OR REPLACE FUNCTION public.bit_payment_submit(_order uuid, _reference text, _receipt_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  o public.orders;
  _ref text := NULLIF(btrim(regexp_replace(COALESCE(_reference, ''), '\s+', ' ', 'g')), '');
  _path text := NULLIF(btrim(COALESCE(_receipt_path, '')), '');
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order AND tenant_id = _tenant FOR UPDATE;
  IF o.id IS NULL OR o.payment_method <> 'bit' THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF o.payment_status IN ('awaiting_verification', 'paid') THEN
    RETURN jsonb_build_object('status', o.payment_status, 'order_number', o.order_number,
                              'already', true);
  END IF;
  IF o.status = 'cancelled' OR o.payment_status <> 'awaiting' THEN
    RAISE EXCEPTION 'ההזמנה % בוטלה (לא שולמה בזמן). אפשר להזמין מחדש מהחנות, או ליצור קשר עם החנות.', o.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  IF _ref IS NULL AND _path IS NULL THEN
    RAISE EXCEPTION 'יש להזין מספר אסמכתא או לצרף צילום מסך של ההעברה'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _ref IS NOT NULL AND (char_length(_ref) NOT BETWEEN 2 AND 64 OR _ref ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'מספר האסמכתא אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  -- הקובץ חייב להיות בתיקייה של ההזמנה הזו בחנות הזו
  IF _path IS NOT NULL AND (
       _path NOT LIKE _tenant::text || '/' || o.id::text || '/%'
       OR _path ~ '\.\.' OR char_length(_path) > 300) THEN
    RAISE EXCEPTION 'קובץ לא תקין' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('kobi.payment_update', 'on', true);
  UPDATE public.orders
     SET bit_transaction_id = _ref,
         bit_receipt_url = _path,
         payment_status = 'awaiting_verification',
         payment_reported_at = now(),
         payment_due_at = NULL
   WHERE id = o.id;
  PERFORM set_config('kobi.payment_update', 'off', true);

  RETURN jsonb_build_object('status', 'awaiting_verification', 'order_number', o.order_number,
                            'already', false);
END $$;
REVOKE ALL ON FUNCTION public.bit_payment_submit(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bit_payment_submit(uuid, text, text) TO service_role;

-- ============================================================
-- 6. אישור / דחייה של תשלום בביט — מנהל החנות
-- ============================================================
-- אישור: גם בלי אסמכתא (בעל החנות ראה את הכסף באפליקציה), וגם להזמנה שבוטלה
-- כי לא שולמה בזמן — היא חוזרת לטיפול (והמלאי נשמר לה שוב).
-- דחייה: ההזמנה מבוטלת והמלאי חוזר.
CREATE OR REPLACE FUNCTION public.bit_payment_review(_order uuid, _approve boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  o public.orders;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לאשר או לדחות תשלום' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order AND tenant_id = _tenant FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF o.payment_method <> 'bit' THEN
    RAISE EXCEPTION 'ההזמנה % אינה בתשלום בביט', o.order_number USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('kobi.payment_update', 'on', true);
  IF _approve THEN
    IF o.payment_status = 'paid' THEN
      PERFORM set_config('kobi.payment_update', 'off', true);
      RETURN jsonb_build_object('payment_status', 'paid', 'status', o.status,
                                'order_number', o.order_number, 'already', true);
    END IF;
    UPDATE public.orders
       SET payment_status = 'paid',
           paid_at = now(),
           payment_due_at = NULL,
           payment_confirmed_by = auth.uid(),
           status = CASE WHEN status = 'cancelled' THEN 'pending' ELSE status END
     WHERE id = o.id
    RETURNING * INTO o;
  ELSE
    IF o.payment_status = 'paid' THEN
      RAISE EXCEPTION 'התשלום על ההזמנה % כבר אושר — לביטול ההזמנה השתמשו בשינוי הסטטוס', o.order_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF o.payment_status IN ('rejected', 'expired') AND o.status = 'cancelled' THEN
      PERFORM set_config('kobi.payment_update', 'off', true);
      RETURN jsonb_build_object('payment_status', o.payment_status, 'status', o.status,
                                'order_number', o.order_number, 'already', true);
    END IF;
    UPDATE public.orders
       SET payment_status = 'rejected',
           payment_due_at = NULL,
           payment_confirmed_by = auth.uid(),
           status = 'cancelled'
     WHERE id = o.id
    RETURNING * INTO o;
  END IF;
  PERFORM set_config('kobi.payment_update', 'off', true);

  RETURN jsonb_build_object('payment_status', o.payment_status, 'status', o.status,
                            'order_number', o.order_number, 'already', false);
END $$;
REVOKE ALL ON FUNCTION public.bit_payment_review(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bit_payment_review(uuid, boolean) TO authenticated, service_role;

-- ============================================================
-- 7. דלי פרטי לצילומי ההעברה — רק השרת (service_role) קורא וכותב
-- ============================================================
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('payment-receipts', 'payment-receipts', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END $$;

COMMIT;

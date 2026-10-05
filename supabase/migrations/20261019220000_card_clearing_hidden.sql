-- ============================================================
-- חלק 16ב: סליקת אשראי (Hyp / MAX) — מוכנה, אבל סגורה עד לאישור סופי
--
-- התשתית קיימת מחלק 16 (מסופים, כוונות תשלום, דף החזרה, תשלום בקופה).
-- עד שחברת האשראי מאשרת את העסק, הממשק מוסתר בקוד (הערות JSX), וכאן —
-- מתג ראשי במסד שסוגר את הסליקה גם בצד השרת, כך שאי אפשר להפעיל אותה
-- "מסביב" לממשק (קריאה ישירה ל-API):
--
--   platform_settings.card_clearing_live (ברירת מחדל: false)
--     • הזמנות של לקוחות לא הופכות ל"ממתינות לתשלום באשראי".
--     • חנות לא יכולה להדליק "סליקה פעילה בקופה" (וכל מי שהדליק — כבה).
--     • תוספים ומנויים לא נמכרים בתשלום מאובטח (platform_payments_ready).
--     • בדיקת חיבור וחיוב בדיקה של ₪1 — עדיין אפשריים, כדי לבדוק את
--       פרטי המסוף ברגע שמגיעים.
--
-- ההפעלה, אחרי האישור (יחד עם הסרת ההערות בקוד):
--   UPDATE public.platform_settings SET card_clearing_live = true;
--
-- וגם: אמצעי התשלום בקופה הופך לבחירה של הלקוח — "תשלום באשראי (מאובטח)"
-- או "תשלום מול נציג" (בלי חיוב באתר). place_order / place_guest_order
-- מעבירים את הבחירה (details.payment_method), והטריגר מחליט.
--
-- הערה על הסודות: סיסמת ה-API של מסוף החנות לא נשמרת ב-site_settings — את
-- הטבלה הזו כל גולש יכול לקרוא (הגדרות האתר הציבוריות). היא נשמרת ב-
-- tenant_payment_secrets (חלק 16), שאין אליה גישה מהדפדפן בכלל.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. העמודות (קיימות מחלק 16 — כאן רק מוודאים)
-- ============================================================
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS hyp_terminal_number TEXT,
  ADD COLUMN IF NOT EXISTS hyp_api_password TEXT,
  -- המתג הראשי: הסליקה באשראי פתוחה לחנויות וללקוחות
  ADD COLUMN IF NOT EXISTS card_clearing_live BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS hyp_terminal_number TEXT;
ALTER TABLE public.orders
  -- מספר העסקה / השובר ב-Hyp
  ADD COLUMN IF NOT EXISTS hyp_transaction_id TEXT;

COMMENT ON COLUMN public.platform_settings.card_clearing_live IS
  'חלק 16ב: הסליקה באשראי פתוחה (false = ממתינה לאישור חברת האשראי; הממשק מוסתר בקוד)';

-- ============================================================
-- 2. מצב הסליקה
-- ============================================================
CREATE OR REPLACE FUNCTION public.card_clearing_live()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT p.card_clearing_live FROM public.platform_settings p WHERE p.id), false);
$$;
REVOKE ALL ON FUNCTION public.card_clearing_live() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.card_clearing_live() TO authenticated, service_role;

-- מסוף הפלטפורמה הוגדר (מסוף + סיסמה + מפתח) — בלי קשר למתג
CREATE OR REPLACE FUNCTION public.platform_payments_configured()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT p.hyp_terminal_number IS NOT NULL AND p.hyp_api_password IS NOT NULL
                          AND p.hyp_api_key IS NOT NULL
                     FROM public.platform_settings p WHERE p.id), false);
$$;
REVOKE ALL ON FUNCTION public.platform_payments_configured() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payments_configured() TO authenticated, service_role;

-- תשלום מאובטח על תוספים / מנויים: מסוף מוגדר וגם הסליקה פתוחה.
-- כל המסכים של בעל החנות (המנוי שלי, שדרוגים ותוספים) נשענים על זה — כשזה
-- false הם חוזרים לזרימה הרגילה (פנייה לצוות / רכישה בלי סליקה).
CREATE OR REPLACE FUNCTION public.platform_payments_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.platform_payments_configured() AND public.card_clearing_live();
$$;
GRANT EXECUTE ON FUNCTION public.platform_payments_ready() TO authenticated, service_role;

-- סליקה פעילה בקופה של חנות: המתג הראשי + החנות הדליקה + מסוף וסודות
CREATE OR REPLACE FUNCTION public.card_payments_active(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.card_clearing_live()
     AND EXISTS (SELECT 1 FROM public.site_settings s
                  WHERE s.tenant_id = _tenant AND s.card_payments_enabled
                    AND s.hyp_terminal_number IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.tenant_payment_secrets t WHERE t.tenant_id = _tenant);
$$;
REVOKE ALL ON FUNCTION public.card_payments_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_payments_active(uuid) TO service_role;

-- ============================================================
-- 3. חנות לא מדליקה סליקה כל עוד המתג הראשי סגור
-- ============================================================
CREATE OR REPLACE FUNCTION public.site_settings_card_payments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.card_payments_enabled AND (
       NEW.hyp_terminal_number IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.tenant_payment_secrets s WHERE s.tenant_id = NEW.tenant_id)) THEN
    RAISE EXCEPTION 'כדי להפעיל סליקה יש להזין מספר מסוף, סיסמת API ומפתח API'
      USING ERRCODE = 'check_violation';
  END IF;
  -- רק בהדלקה (לא בכל עדכון של חנות שכבר הדליקה)
  IF NEW.card_payments_enabled
     AND (TG_OP = 'INSERT' OR NOT OLD.card_payments_enabled)
     AND NOT public.card_clearing_live() THEN
    RAISE EXCEPTION 'הסליקה באשראי עדיין לא נפתחה במערכת — ממתינה לאישור סופי של חברת האשראי'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- מי שהדליק סליקה בזמן הבדיקות — כבה (ההגדרות של המסוף נשמרות)
UPDATE public.site_settings
   SET card_payments_enabled = false
 WHERE card_payments_enabled AND NOT public.card_clearing_live();

-- ============================================================
-- 4. הזמנה חדשה: אשראי רק אם הלקוח בחר בו והסליקה פעילה
-- ============================================================
CREATE OR REPLACE FUNCTION public.orders_card_payment_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- הבקשה: place_order שולח 'credit_card' (ברירת המחדל) או 'offline' לפי
  -- הבחירה בקופה. הכנסה ישירה לטבלה — 'offline' (ברירת המחדל של העמודה).
  _wants_card boolean := NEW.payment_method = 'credit_card';
BEGIN
  -- הערכים לא מגיעים מהדפדפן
  NEW.payment_method := 'offline';
  NEW.payment_status := 'not_required';
  NEW.payment_due_at := NULL;
  NEW.paid_at := NULL;
  NEW.hyp_transaction_id := NULL;
  NEW.payment_token := NULL;
  IF NEW.kind = 'order'
     AND _wants_card
     AND NOT public.is_staff(auth.uid())
     AND public.card_payments_active(NEW.tenant_id) THEN
    NEW.payment_method := 'credit_card';
    NEW.payment_status := 'awaiting';
    NEW.payment_due_at := now() + interval '30 minutes';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 5. בדיקת חיבור / ₪1 במסוף הפלטפורמה — גם לפני הפתיחה
-- ============================================================
CREATE OR REPLACE FUNCTION public.payment_test_start(_scope text, _origin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _tenant uuid;
  _token text;
  _email text := (SELECT u.email FROM auth.users u WHERE u.id = auth.uid());
BEGIN
  IF _scope = 'store' THEN
    _tenant := public.current_tenant_id();
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'רק מנהל החנות יכול לבצע בדיקת סליקה' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'החנות לא זוהתה';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hyp_credentials('store', _tenant)) THEN
      RAISE EXCEPTION 'קודם שמרו את פרטי המסוף (מספר מסוף, סיסמת API ומפתח API)'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF _scope = 'platform' THEN
    IF NOT public.is_platform_admin(auth.uid()) THEN
      RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- המסוף מוגדר מספיק (המתג הראשי לא נדרש — זו בדיקה של מנהל הפלטפורמה)
    IF NOT public.platform_payments_configured() THEN
      RAISE EXCEPTION 'קודם שמרו את פרטי מסוף הפלטפורמה' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'סוג בדיקה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;

  -- לא יותר מ-10 ניסיונות בשעה לכל מסוף (לא להציף את חברת האשראי)
  IF (SELECT count(*) FROM public.payment_intents
       WHERE kind = 'test' AND scope = _scope AND tenant_id IS NOT DISTINCT FROM _tenant
         AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'יותר מדי בדיקות בשעה האחרונה — נסו שוב מאוחר יותר' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.payment_intents
         (scope, kind, tenant_id, amount, max_payments, description, return_origin, created_by)
  VALUES (_scope, 'test', _tenant, 1, 1, 'בדיקת סליקה — ₪1', NULLIF(_origin, ''), auth.uid())
  RETURNING token INTO _token;

  RETURN jsonb_build_object('token', _token, 'amount', 1, 'max_payments', 1,
                            'description', 'בדיקת סליקה — ₪1', 'email', _email,
                            'profile', jsonb_build_object('company_name', 'בדיקת סליקה'));
END $$;
REVOKE ALL ON FUNCTION public.payment_test_start(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_test_start(text, text) TO authenticated, service_role;

-- ============================================================
-- 6. הגדרות המסוף — עם מצב המתג הראשי
-- ============================================================
CREATE OR REPLACE FUNCTION public.store_payment_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  s public.site_settings;
  sec public.tenant_payment_secrets;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.site_settings WHERE tenant_id = _tenant;
  SELECT * INTO sec FROM public.tenant_payment_secrets WHERE tenant_id = _tenant;
  RETURN jsonb_build_object(
    'terminal', s.hyp_terminal_number,
    'enabled', COALESCE(s.card_payments_enabled, false),
    'max_payments', COALESCE(s.hyp_max_payments, 1),
    'has_password', sec.tenant_id IS NOT NULL,
    'has_key', sec.tenant_id IS NOT NULL,
    'key_hint', CASE WHEN sec.tenant_id IS NULL THEN NULL ELSE '…' || right(sec.hyp_api_key, 4) END,
    'updated_at', sec.updated_at,
    'last_test', public.payment_last_test('store', _tenant),
    'live', public.card_clearing_live());
END $$;
REVOKE ALL ON FUNCTION public.store_payment_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_payment_settings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_payment_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.platform_settings;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO p FROM public.platform_settings WHERE id;
  RETURN jsonb_build_object(
    'terminal', p.hyp_terminal_number,
    'has_password', p.hyp_api_password IS NOT NULL,
    'has_key', p.hyp_api_key IS NOT NULL,
    'key_hint', CASE WHEN p.hyp_api_key IS NULL THEN NULL ELSE '…' || right(p.hyp_api_key, 4) END,
    'max_payments', p.hyp_max_payments,
    -- המסוף מוגדר (לבדיקות); "live" — הסליקה פתוחה לחנויות
    'ready', public.platform_payments_configured(),
    'live', COALESCE(p.card_clearing_live, false),
    'updated_at', p.updated_at,
    'last_test', public.payment_last_test('platform', NULL));
END $$;
REVOKE ALL ON FUNCTION public.platform_payment_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payment_settings() TO authenticated, service_role;

-- ============================================================
-- 7. הקופה: אמצעי התשלום שהלקוח בחר עובר להזמנה
--    (place_order / place_guest_order — זהות לחלק 14, ועמודה אחת נוספת)
-- ============================================================
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
    -- חלק 16ב: אמצעי התשלום שהלקוח בחר בקופה — בקשה בלבד; הטריגר
    -- orders_card_payment_default מחליט (אשראי רק כשהסליקה פעילה בחנות)
    CASE WHEN _details ->> 'payment_method' = 'offline' THEN 'offline' ELSE 'credit_card' END)
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
    -- חלק 16ב: אמצעי התשלום שהלקוח בחר בקופה — בקשה בלבד; הטריגר
    -- orders_card_payment_default מחליט (אשראי רק כשהסליקה פעילה בחנות)
    CASE WHEN _details ->> 'payment_method' = 'offline' THEN 'offline' ELSE 'credit_card' END)
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

COMMIT;

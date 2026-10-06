-- ============================================================
-- חלק 28: הסרה מלאה של סליקת האשראי (Hyp / MAX) — "דף חלק"
--
-- הסליקה (חלקים 16–16ב) מעולם לא נפתחה (card_clearing_live = false).
-- ההחלטה: להסיר הכל — פרטי המסופים השמורים (של הפלטפורמה ושל החנויות),
-- כוונות התשלום (היסטוריית החיובים של Hyp, כולל חיובי הבדיקה של ₪1),
-- מספרי העסקאות של Hyp בהזמנות ובהיסטוריית המנוי, הפונקציות והטריגרים.
--
-- נשאר — משותף, לא של Hyp:
--   • ביט ותשלום טלפוני מול נציג (חלק 17ב). orders_card_payment_default
--     (שהכיל גם את ביט) מוחלף ב-orders_default_payment — אותה לוגיקה בלי
--     אשראי, ובאותו מקום בסדר הטריגרים.
--   • orders_payment_guard — שדות התשלום משתנים רק במסלול התשלום (ביט).
--   • expire_unpaid_orders — ביטול הזמנות ביט שלא שולמו תוך 24 שעות.
--   • payment_due_at / paid_at / order_amount_due — של ביט.
--   • פרטי העוסק (tenant_billing_profile) — גם לזהות המשפטית של החנות.
--   • הערך 'credit_card' ב-CHECK של orders / billing_history — לשורות ישנות.
--   • תשלום מנויים ותוספים לפלטפורמה — ידני בלבד: רכישת תוסף נרשמת
--     "ממתין לתשלום", ומנהל הפלטפורמה מתעד את התשלום (העברה בנקאית וכו')
--     ב"תעד תשלום" (platform_record_payment).
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. הזמנות אשראי שעדיין "ממתינות לתשלום" — אי אפשר לשלם עליהן יותר.
--    מבוטלות והמלאי חוזר — מה שהיה קורה להן ממילא אחרי 30 דקות.
--    (הזמנות אשראי ישנות שכבר שולמו / בוטלו — נשארות כמו שהן.)
-- ============================================================
DO $$
BEGIN
  PERFORM set_config('kobi.payment_update', 'on', true);
  UPDATE public.orders
     SET status = 'cancelled', payment_status = 'expired'
   WHERE payment_method = 'credit_card' AND payment_status = 'awaiting';
  PERFORM set_config('kobi.payment_update', 'off', true);
END $$;

-- ============================================================
-- 2. הזמנה חדשה: אמצעי התשלום — ביט או טלפוני מול נציג (בלי אשראי)
-- ============================================================
-- הלקוח מבקש (place_order / place_guest_order), החנות מחליטה מה זמין.
-- הצוות והצעות מחיר — בלי תשלום באתר (כמו תמיד).
CREATE OR REPLACE FUNCTION public.orders_default_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- הבקשה מהקופה: 'bit' / 'offline'. כל ערך אחר (גם 'credit_card' מלשונית
  -- ישנה, או הכנסה ישירה לטבלה) — 'offline'.
  _requested text := NEW.payment_method;
  _phone_enabled boolean;
BEGIN
  -- הערכים לא מגיעים מהדפדפן
  NEW.payment_method := 'offline';
  NEW.payment_status := 'not_required';
  NEW.payment_due_at := NULL;
  NEW.paid_at := NULL;
  NEW.bit_transaction_id := NULL;
  NEW.bit_receipt_url := NULL;
  NEW.payment_reported_at := NULL;
  NEW.payment_confirmed_by := NULL;
  IF NEW.kind <> 'order' OR public.is_staff(auth.uid()) THEN
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

  -- "תשלום טלפוני מול נציג" — רק אם החנות מאפשרת
  SELECT s.payment_phone_enabled INTO _phone_enabled
    FROM public.site_settings s WHERE s.tenant_id = NEW.tenant_id;
  IF NOT COALESCE(_phone_enabled, true) THEN
    RAISE EXCEPTION 'התשלום הטלפוני מול נציג אינו זמין בחנות — בחרו אמצעי תשלום אחר'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- טריגרים מאותו סוג רצים לפי סדר השמות — השם נבחר כך שהטריגר רץ בדיוק
-- במקום של הקודם (אחרי orders_assign_number, לפני orders_enforce_kind)
DROP TRIGGER IF EXISTS orders_card_payment_default ON public.orders;
DROP TRIGGER IF EXISTS orders_default_payment ON public.orders;
CREATE TRIGGER orders_default_payment
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_default_payment();
DROP FUNCTION IF EXISTS public.orders_card_payment_default();

-- ============================================================
-- 3. שדות התשלום משתנים רק דרך פונקציות התשלום (ביט); הזמנה שממתינה
--    לתשלום (או לאישור תשלום) לא יוצאת לטיפול — רק ביטול
-- ============================================================
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
    RAISE EXCEPTION 'ההזמנה % עדיין ממתינה לתשלום — אי אפשר להעביר אותה לטיפול', NEW.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 4. הקופה: place_order / place_guest_order — הבקשה ממופה במקום
--    (checkout_payment_request, שברירת המחדל שלה הייתה אשראי, נמחקת).
--    תיקון נקודתי של ההגדרה מהמסד (כמו בחלק 18ב) — נכשל בקול אם הטקסט
--    לא נמצא, כדי שלא תישאר פונקציה שקוראת לפונקציה שנמחקה.
-- ============================================================
DO $$
DECLARE
  _fn regprocedure;
  _def text;
  _fixed text;
BEGIN
  FOREACH _fn IN ARRAY ARRAY[
    'public.place_order(text, jsonb, numeric, boolean, jsonb)'::regprocedure,
    'public.place_guest_order(text, jsonb, jsonb)'::regprocedure]
  LOOP
    _def := pg_get_functiondef(_fn);
    CONTINUE WHEN position('checkout_payment_request' IN _def) = 0;
    _fixed := replace(_def, 'public.checkout_payment_request(_details)',
      $r$CASE WHEN _details ->> 'payment_method' = 'bit' THEN 'bit' ELSE 'offline' END$r$);
    IF position('checkout_payment_request' IN _fixed) > 0 THEN
      RAISE EXCEPTION 'part 28: % — the checkout_payment_request call was not found', _fn;
    END IF;
    -- ההערה שמעל השורה מפנה לטריגר — השם החדש
    _fixed := replace(_fixed, 'orders_card_payment_default', 'orders_default_payment');
    EXECUTE _fixed;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.checkout_payment_request(jsonb);

-- ============================================================
-- 5. הזמנות שלא שולמו בזמן (ביט — 24 שעות) → מבוטלות והמלאי חוזר.
--    השרת מריץ כל 5 דקות (src/server/services/payment-expiry.ts).
-- ============================================================
CREATE OR REPLACE FUNCTION public.expire_unpaid_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  PERFORM set_config('kobi.payment_update', 'on', true);
  WITH expired AS (
    UPDATE public.orders
       SET status = 'cancelled', payment_status = 'expired'
     WHERE payment_status = 'awaiting' AND payment_due_at < now() AND status = 'pending'
     RETURNING id
  )
  SELECT count(*) INTO _count FROM expired;
  PERFORM set_config('kobi.payment_update', 'off', true);
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_orders() TO service_role;

-- ============================================================
-- 6. הגדרות החנות: אמצעי התשלום — טלפוני / ביט (בלי "סליקה פעילה")
-- ============================================================
DROP TRIGGER IF EXISTS site_settings_card_payments_guard ON public.site_settings;
DROP FUNCTION IF EXISTS public.site_settings_card_payments_guard();

-- נרמול מספר הביט והודעות ברורות (לפני ה-CHECK)
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
  IF NOT (NEW.payment_phone_enabled OR NEW.payment_bit_enabled) THEN
    RAISE EXCEPTION 'יש להשאיר לפחות אמצעי תשלום אחד פעיל בקופה'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- חנות שהשאירה פעילה רק את הסליקה (לא אמור להיות — הסליקה לא נפתחה):
-- התשלום הטלפוני חוזר, כדי שתמיד יהיה בקופה אמצעי תשלום
UPDATE public.site_settings
   SET payment_phone_enabled = true
 WHERE NOT payment_phone_enabled AND NOT payment_bit_enabled;

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_hyp_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS hyp_terminal_number,
  DROP COLUMN IF EXISTS hyp_max_payments,
  DROP COLUMN IF EXISTS card_payments_enabled;

-- ============================================================
-- 7. מנויים ותוספים לפלטפורמה — תשלום ידני בלבד
-- ============================================================
-- רכישת תוסף: הפיצ'ר נפתח מיד, והחיוב נרשם "ממתין לתשלום" ב"המנוי שלי";
-- מנהל הפלטפורמה גובה (העברה בנקאית וכו') ומתעד.
CREATE OR REPLACE FUNCTION public.addon_purchase(_addon text, _expected numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _q jsonb;
  _name text;
  _amount numeric;
  _end timestamptz;
  _row public.tenant_addons;
  _billing uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לרכוש תוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  PERFORM 1 FROM public.tenant_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended('addon-purchase:' || _tenant::text, 7151));

  _q := public.addon_quote_for(_tenant, _addon);
  _name := _q ->> 'addon';
  IF NOT COALESCE((_q ->> 'can_buy')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(_q ->> 'reason', 'לא ניתן לרכוש את התוסף כרגע')
      USING ERRCODE = 'check_violation';
  END IF;
  _amount := (_q ->> 'amount')::numeric;
  IF _expected IS NOT NULL AND abs(_expected - _amount) > 0.01 THEN
    RAISE EXCEPTION 'המחיר התעדכן ל-% ₪ — אשרו את הרכישה מחדש', to_char(_amount, 'FM999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;
  _end := CASE WHEN _q ->> 'billing' = 'monthly' THEN (_q ->> 'period_end')::timestamptz END;

  UPDATE public.tenant_addons
     SET status = 'canceled', canceled_at = now(), ended_reason = 'expired'
   WHERE tenant_id = _tenant AND addon_name = _name AND status = 'active';

  INSERT INTO public.tenant_addons
         (tenant_id, addon_name, status, expires_at, amount, source, purchased_by)
  VALUES (_tenant, _name, 'active', _end, _amount, 'purchase', auth.uid())
  RETURNING * INTO _row;

  INSERT INTO public.billing_history
         (tenant_id, kind, plan_type, amount, days, period_start, period_end, addon_name,
          payment_status, note, recorded_by, recorded_by_email)
  VALUES (_tenant, 'addon', _q ->> 'plan', _amount,
          CASE WHEN (_q ->> 'days_remaining')::int BETWEEN 1 AND 365
               THEN (_q ->> 'days_remaining')::int END,
          now(), _end, _name,
          CASE WHEN _amount > 0 THEN 'due' ELSE 'paid' END,
          CASE WHEN _q ->> 'billing' = 'monthly'
               THEN format('תוסף: %s — חיוב יחסי ל-%s ימים (עד סוף תקופת המנוי)',
                           _q ->> 'title', _q ->> 'days_remaining')
               ELSE format('תוסף: %s — תשלום חד-פעמי', _q ->> 'title') END,
          auth.uid(), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  RETURNING id INTO _billing;

  RETURN jsonb_build_object(
    'id', _row.id,
    'addon', _row.addon_name,
    'title', _q ->> 'title',
    'amount', _row.amount,
    'expires_at', _row.expires_at,
    'billing_id', _billing);
END $$;
REVOKE ALL ON FUNCTION public.addon_purchase(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_purchase(text, numeric) TO authenticated, service_role;

-- חנות התוספים — המנוי, פרטי העוסק וההצעות (בלי "תשלום מאובטח")
CREATE OR REPLACE FUNCTION public.addons_store()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות בתוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  RETURN jsonb_build_object(
    'subscription', public.tenant_subscription_state(_tenant),
    'billing_profile', public.billing_profile_json(_tenant),
    'addons', COALESCE((
      SELECT jsonb_agg(public.addon_quote_for(_tenant, c.addon_name)
                       || jsonb_build_object('description', c.description,
                                             'feature', c.feature,
                                             'included_in_premium', c.included_in_premium,
                                             'expires_at', (
                                               SELECT a.expires_at FROM public.tenant_addons a
                                                WHERE a.tenant_id = _tenant AND a.addon_name = c.addon_name
                                                  AND a.status = 'active'
                                                  AND (a.expires_at IS NULL OR a.expires_at > now()))
                                             )
                       ORDER BY c.sort_order, c.addon_name)
        FROM public.platform_addons c), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.addons_store() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addons_store() TO authenticated, service_role;

-- "המנוי שלי": המנוי, מספר המוצרים, ההיסטוריה, התוספים ופרטי העוסק
CREATE OR REPLACE FUNCTION public.store_billing()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות במנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  RETURN jsonb_build_object(
    'subscription', public.tenant_subscription_state(_tenant),
    'product_count', (SELECT count(*) FROM public.global_products WHERE tenant_id = _tenant),
    'history', public.billing_history_json(_tenant, false),
    'addons', public.tenant_addons_json(_tenant),
    'billing_profile', public.billing_profile_json(_tenant));
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

-- ============================================================
-- 8. הפונקציות של Hyp
-- ============================================================
DROP FUNCTION IF EXISTS public.payment_intent_lookup(text);
DROP FUNCTION IF EXISTS public.payment_intent_complete(text, text, numeric, integer, text);
DROP FUNCTION IF EXISTS public.payment_intent_fail(text, text);
DROP FUNCTION IF EXISTS public.payment_test_start(text, text);
DROP FUNCTION IF EXISTS public.payment_last_test(text, uuid);
DROP FUNCTION IF EXISTS public.order_payment_intent(uuid, text);
DROP FUNCTION IF EXISTS public.addon_checkout_start(text, numeric, text);
DROP FUNCTION IF EXISTS public.plan_checkout_start(text, numeric, text);
DROP FUNCTION IF EXISTS public.plan_quote(text);
DROP FUNCTION IF EXISTS public.plan_quote_for(uuid, text);
DROP FUNCTION IF EXISTS public.hyp_credentials(text, uuid);
DROP FUNCTION IF EXISTS public.card_payments_active(uuid);
DROP FUNCTION IF EXISTS public.platform_payments_ready();
DROP FUNCTION IF EXISTS public.platform_payments_configured();
DROP FUNCTION IF EXISTS public.card_clearing_live();
DROP FUNCTION IF EXISTS public.platform_payment_settings();
DROP FUNCTION IF EXISTS public.platform_save_payment_settings(text, text, text, integer, boolean);
DROP FUNCTION IF EXISTS public.store_payment_settings();
DROP FUNCTION IF EXISTS public.store_save_payment_settings(text, text, text, boolean, integer, boolean);

-- ============================================================
-- 9. הטבלאות והעמודות של Hyp
-- ============================================================
-- כוונות התשלום (כל ניסיונות החיוב ב-Hyp, כולל בדיקות ₪1)
DROP TABLE IF EXISTS public.payment_intents;
-- סיסמת ה-API ומפתח ה-API של מסופי החנויות
DROP TABLE IF EXISTS public.tenant_payment_secrets;
-- מסוף הפלטפורמה והמתג הראשי (card_clearing_live) — לא היה בה דבר מלבדם
DROP TABLE IF EXISTS public.platform_settings;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS hyp_transaction_id,
  DROP COLUMN IF EXISTS payment_token;
ALTER TABLE public.billing_history
  DROP COLUMN IF EXISTS hyp_transaction_id,
  DROP COLUMN IF EXISTS payment_token;

COMMENT ON COLUMN public.orders.payment_method IS
  'offline = תשלום טלפוני מול נציג | bit = העברה בביט | credit_card = הזמנות ישנות בלבד (Hyp הוסר בחלק 28)';

NOTIFY pgrst, 'reload schema';

COMMIT;

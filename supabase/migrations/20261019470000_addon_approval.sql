-- ============================================================
-- חלק 38: רכישת תוסף = בקשה. רק מנהל הפלטפורמה מפעיל, אחרי תשלום.
--
-- הבאג: addon_purchase (חלק 15/28) הכניס את התוסף כ-'active' מיד — בעל
-- החנות לחץ "אישור רכישה" והפיצ'ר (למשל "חיבור לזאפ") נפתח בלי תשלום ובלי
-- אישור. מעכשיו:
--
--  1. בעל החנות "רוכש" → tenant_addons בסטטוס 'pending' (לא פותח כלום —
--     הפיצ'רים נקבעים רק מ-status = 'active'), וחיוב "ממתין לתשלום" מקושר.
--     בקשה אחת ממתינה לכל תוסף.
--  2. מנהל הפלטפורמה רואה את הבקשות (platform_addon_requests), גובה מחוץ
--     למערכת (קישור אשראי / ביט), ורק הוא:
--       platform_approve_addon — "אשר תשלום והפעל תוסף": 'pending' → 'active'
--                                והחיוב → "שולם" (עם אסמכתא).
--       platform_reject_addon  — דחיית הבקשה (החיוב הממתין נמחק).
--  3. בעל החנות לא יכול להפעיל תוסף בעצמו: אין לו הרשאת כתיבה לטבלה (רק
--     SELECT), כל הפונקציות שכותבות 'active' בודקות is_platform_admin, וטריגר
--     חוסם כל מעבר ל-'active' שלא ממנהל הפלטפורמה / מהשרת.
--  4. תיקון הנתונים: תוספים שנרכשו והופעלו בלי תשלום (החיוב שלהם עדיין
--     "ממתין לתשלום") — חוזרים ל-'pending' עד אישור מנהל הפלטפורמה.
--  5. שם התוסף בקטלוג: "חיבור לזאפ (Zapier)" → "חיבור לזאפ — השוואת מחירים"
--     (זאפ = zap.co.il, לא Zapier), רק אם לא שונה ידנית.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. הטבלה: סטטוס 'pending', קישור לחיוב, פרטי האישור
-- ============================================================
ALTER TABLE public.tenant_addons
  ADD COLUMN IF NOT EXISTS billing_id uuid REFERENCES public.billing_history(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_reference text
    CHECK (approved_reference IS NULL OR length(approved_reference) <= 120);

ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_status_check;
ALTER TABLE public.tenant_addons
  ADD CONSTRAINT tenant_addons_status_check CHECK (status IN ('pending', 'active', 'canceled'));
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_check;
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_status_canceled_check;
ALTER TABLE public.tenant_addons
  ADD CONSTRAINT tenant_addons_status_canceled_check
  CHECK (status IN ('pending', 'active') OR canceled_at IS NOT NULL);
ALTER TABLE public.tenant_addons DROP CONSTRAINT IF EXISTS tenant_addons_ended_reason_check;
ALTER TABLE public.tenant_addons
  ADD CONSTRAINT tenant_addons_ended_reason_check
  CHECK (ended_reason IS NULL OR ended_reason IN ('expired', 'canceled', 'rejected'));

-- בקשה ממתינה אחת לכל תוסף בחנות
CREATE UNIQUE INDEX IF NOT EXISTS tenant_addons_one_pending
  ON public.tenant_addons (tenant_id, addon_name) WHERE status = 'pending';

COMMENT ON COLUMN public.tenant_addons.status IS
  'חלק 38: pending = בקשה שממתינה לתשלום ולאישור מנהל הפלטפורמה (לא פותחת פיצ''רים); active = פעיל; canceled = בוטל / פג / נדחה';

-- ============================================================
-- 2. חסימה: רק מנהל הפלטפורמה (או השרת) מעביר תוסף ל-'active'
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_addons_activation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active')
     AND auth.uid() IS NOT NULL
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להפעיל תוסף (אחרי אישור התשלום)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_addons_activation_guard ON public.tenant_addons;
CREATE TRIGGER tenant_addons_activation_guard
BEFORE INSERT OR UPDATE ON public.tenant_addons
FOR EACH ROW EXECUTE FUNCTION public.tenant_addons_activation_guard();

-- ============================================================
-- 3. הצעת המחיר: בקשה ממתינה → אי אפשר לבקש שוב
-- ============================================================
CREATE OR REPLACE FUNCTION public.addon_quote_for(_tenant uuid, _addon text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.platform_addons;
  s public.tenant_subscriptions;
  _state jsonb;
  _plan text;
  _active boolean;
  _owned boolean;
  _pending public.tenant_addons;
  _included boolean := false;
  _can boolean := false;
  _reason text := NULL;
  _amount numeric := NULL;
  _days integer := NULL;
  _end timestamptz := NULL;
  _daily numeric := NULL;
BEGIN
  SELECT * INTO c FROM public.platform_addons WHERE addon_name = lower(btrim(COALESCE(_addon, '')));
  IF c.addon_name IS NULL THEN
    RAISE EXCEPTION 'תוסף לא מוכר: %', _addon USING ERRCODE = 'check_violation';
  END IF;
  _state := public.tenant_subscription_state(_tenant);
  IF _state IS NULL THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant;
  _plan := _state ->> 'plan';
  _active := COALESCE((_state ->> 'active')::boolean, false);
  _owned := public.tenant_addon_active(_tenant, c.addon_name);
  SELECT * INTO _pending FROM public.tenant_addons
   WHERE tenant_id = _tenant AND addon_name = c.addon_name AND status = 'pending';

  IF NOT c.available THEN
    _reason := 'בקרוב — ממתין לאישור חברות אשראי';
  ELSIF _owned THEN
    _reason := 'התוסף כבר פעיל בחנות';
  ELSIF _pending.id IS NOT NULL THEN
    _reason := 'הבקשה נשלחה — התוסף יופעל אחרי אישור התשלום ע"י צוות הפלטפורמה';
  ELSIF c.included_in_premium AND _plan = 'premium' THEN
    _included := true;
    _reason := 'כלול בחבילה שלך';
  ELSIF c.included_in_premium AND _plan = 'trial' THEN
    _included := true;
    _reason := 'כלול בתקופת הניסיון';
  ELSIF NOT _active THEN
    _reason := 'המנוי של החנות לא פעיל — חדשו את המנוי כדי לרכוש תוספים';
  ELSIF c.billing = 'one_time' THEN
    _amount := c.price;
    _can := true;
  ELSE
    -- חודשי, חבילה בסיסית: עד סוף התקופה של המנוי הראשי
    _end := s.current_period_end;
    IF _end IS NULL THEN
      _reason := 'למנוי של החנות אין תאריך חידוש — פנו לתמיכה להוספת התוסף';
    ELSE
      _days := GREATEST(1, ceil(extract(epoch FROM (_end - now())) / 86400))::int;
      _daily := c.price * 12 / 365;
      _amount := round(_daily * _days, 2);
      _can := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'addon', c.addon_name,
    'title', c.title,
    'billing', c.billing,
    'price', c.price,
    'available', c.available,
    'included', _included,
    'owned', _owned,
    'pending', _pending.id IS NOT NULL,
    'requested_at', _pending.purchased_at,
    'pending_amount', _pending.amount,
    'can_buy', _can,
    'reason', _reason,
    'amount', _amount,
    'days_remaining', _days,
    'period_end', _end,
    'daily_rate', CASE WHEN _daily IS NULL THEN NULL ELSE round(_daily, 4) END,
    'plan', _plan);
END $$;
REVOKE ALL ON FUNCTION public.addon_quote_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.addon_quote_for(uuid, text) TO service_role;

-- ============================================================
-- 4. בעל החנות: "רכישה" = בקשה ממתינה + חיוב "ממתין לתשלום"
-- ============================================================
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

  INSERT INTO public.billing_history
         (tenant_id, kind, plan_type, amount, days, period_start, period_end, addon_name,
          payment_status, note, recorded_by, recorded_by_email)
  VALUES (_tenant, 'addon', _q ->> 'plan', _amount,
          CASE WHEN (_q ->> 'days_remaining')::int BETWEEN 1 AND 365
               THEN (_q ->> 'days_remaining')::int END,
          now(), _end, _name, 'due',
          CASE WHEN _q ->> 'billing' = 'monthly'
               THEN format('בקשה לתוסף: %s — חיוב יחסי ל-%s ימים (עד סוף תקופת המנוי). יופעל אחרי אישור התשלום.',
                           _q ->> 'title', _q ->> 'days_remaining')
               ELSE format('בקשה לתוסף: %s — תשלום חד-פעמי. יופעל אחרי אישור התשלום.', _q ->> 'title') END,
          auth.uid(), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()))
  RETURNING id INTO _billing;

  -- לא פעיל! רק מנהל הפלטפורמה מאשר (platform_approve_addon)
  INSERT INTO public.tenant_addons
         (tenant_id, addon_name, status, expires_at, amount, source, purchased_by, billing_id)
  VALUES (_tenant, _name, 'pending', _end, _amount, 'purchase', auth.uid(), _billing)
  RETURNING * INTO _row;

  RETURN jsonb_build_object(
    'id', _row.id,
    'addon', _row.addon_name,
    'title', _q ->> 'title',
    'status', _row.status,
    'amount', _row.amount,
    'expires_at', _row.expires_at,
    'billing_id', _billing);
END $$;
REVOKE ALL ON FUNCTION public.addon_purchase(text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_purchase(text, numeric) TO authenticated, service_role;

-- ============================================================
-- 5. מנהל הפלטפורמה: הבקשות, אישור והפעלה, דחייה
-- ============================================================

-- הבקשות הממתינות (וההחלטות של 30 הימים האחרונים) מכל החנויות
CREATE OR REPLACE FUNCTION public.platform_addon_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', a.id, 'tenant_id', a.tenant_id, 'tenant_name', t.name, 'tenant_slug', t.slug,
             'owner_email', t.owner_email,
             'requested_by_email', (SELECT u.email FROM auth.users u WHERE u.id = a.purchased_by),
             'addon', a.addon_name, 'title', c.title, 'billing', c.billing,
             'status', a.status, 'amount', a.amount, 'expires_at', a.expires_at,
             'requested_at', a.purchased_at, 'approved_at', a.approved_at,
             'approved_reference', a.approved_reference, 'ended_reason', a.ended_reason,
             'canceled_at', a.canceled_at, 'billing_id', a.billing_id,
             'billing_status', b.payment_status)
           ORDER BY (a.status = 'pending') DESC, COALESCE(a.approved_at, a.canceled_at, a.purchased_at) DESC)
      FROM public.tenant_addons a
      JOIN public.tenants t ON t.id = a.tenant_id
      JOIN public.platform_addons c ON c.addon_name = a.addon_name
      LEFT JOIN public.billing_history b ON b.id = a.billing_id
     WHERE a.source = 'purchase'
       AND (a.status = 'pending'
            OR (a.approved_at IS NOT NULL AND a.approved_at > now() - interval '30 days')
            OR (a.ended_reason = 'rejected' AND a.canceled_at > now() - interval '30 days'))
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_addon_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_addon_requests() TO authenticated, service_role;

-- "אשר תשלום והפעל תוסף": הבקשה → פעיל, החיוב → שולם
CREATE OR REPLACE FUNCTION public.platform_approve_addon(_id uuid, _reference text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  a public.tenant_addons;
  c public.platform_addons;
  s public.tenant_subscriptions;
  _ref text := NULLIF(left(btrim(COALESCE(_reference, '')), 120), '');
  _end timestamptz;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לאשר תשלום ולהפעיל תוסף'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM public.tenant_addons WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'pending' THEN
    RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר טופלה';
  END IF;
  SELECT * INTO c FROM public.platform_addons WHERE addon_name = a.addon_name;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = a.tenant_id FOR UPDATE;
  -- חודשי: עד סוף התקופה של המנוי (נכון ליום האישור)
  IF c.billing = 'monthly' THEN
    _end := CASE WHEN s.plan_type = 'trial' THEN s.trial_ends_at ELSE s.current_period_end END;
    IF _end IS NOT NULL AND _end <= now() THEN
      RAISE EXCEPTION 'המנוי של החנות פג — חדשו אותו לפני הפעלת התוסף' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- תוסף פעיל קודם מאותו סוג (פג / מתחדש) — נסגר
  UPDATE public.tenant_addons
     SET status = 'canceled', canceled_at = now(), ended_reason = 'expired'
   WHERE tenant_id = a.tenant_id AND addon_name = a.addon_name AND status = 'active';

  UPDATE public.tenant_addons
     SET status = 'active', expires_at = _end, approved_at = now(), approved_by = auth.uid(),
         approved_reference = _ref
   WHERE id = a.id;

  UPDATE public.billing_history
     SET payment_status = 'paid', paid_at = now(), reference = COALESCE(_ref, reference)
   WHERE id = a.billing_id AND payment_status = 'due';

  RETURN public.tenant_addons_json(a.tenant_id);
END $$;
REVOKE ALL ON FUNCTION public.platform_approve_addon(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_approve_addon(uuid, text) TO authenticated, service_role;

-- דחיית בקשה (לא שולם / בוטל): הבקשה נסגרת והחיוב הממתין נמחק
CREATE OR REPLACE FUNCTION public.platform_reject_addon(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.tenant_addons;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO a FROM public.tenant_addons WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'pending' THEN
    RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר טופלה';
  END IF;
  UPDATE public.tenant_addons
     SET status = 'canceled', canceled_at = now(), ended_reason = 'rejected', billing_id = NULL
   WHERE id = a.id;
  DELETE FROM public.billing_history WHERE id = a.billing_id AND payment_status = 'due';
  RETURN public.tenant_addons_json(a.tenant_id);
END $$;
REVOKE ALL ON FUNCTION public.platform_reject_addon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_reject_addon(uuid) TO authenticated, service_role;

-- ============================================================
-- 6. רשימת התוספים של חנות — כולל בקשות ממתינות
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_addons_json(_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'addon', a.addon_name, 'title', c.title, 'billing', c.billing,
           'price', c.price, 'status', a.status, 'expires_at', a.expires_at,
           'active', a.status = 'active' AND (a.expires_at IS NULL OR a.expires_at > now()),
           'pending', a.status = 'pending',
           'amount', a.amount, 'source', a.source, 'purchased_at', a.purchased_at,
           'approved_at', a.approved_at,
           'canceled_at', a.canceled_at, 'ended_reason', a.ended_reason)
         ORDER BY (a.status = 'pending') DESC, (a.status = 'active') DESC, a.purchased_at DESC),
         '[]'::jsonb)
    FROM public.tenant_addons a
    JOIN public.platform_addons c ON c.addon_name = a.addon_name
   WHERE a.tenant_id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.tenant_addons_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_addons_json(uuid) TO service_role;

-- ============================================================
-- 7. תיקון הנתונים: תוספים שהופעלו בלי תשלום → בקשה ממתינה
--    (נרכשו ע"י החנות, פעילים, והחיוב שלהם עדיין "ממתין לתשלום")
-- ============================================================
DO $$
DECLARE
  r record;
  _billing uuid;
BEGIN
  FOR r IN
    SELECT a.* FROM public.tenant_addons a
     WHERE a.source = 'purchase' AND a.status = 'active' AND a.approved_at IS NULL
  LOOP
    SELECT b.id INTO _billing
      FROM public.billing_history b
     WHERE b.tenant_id = r.tenant_id AND b.kind = 'addon' AND b.addon_name = r.addon_name
       AND b.amount = r.amount
       AND b.created_at BETWEEN r.purchased_at - interval '5 minutes' AND r.purchased_at + interval '5 minutes'
     ORDER BY abs(extract(epoch FROM (b.created_at - r.purchased_at)))
     LIMIT 1;
    IF _billing IS NULL
       OR (SELECT payment_status FROM public.billing_history WHERE id = _billing) = 'due' THEN
      -- לא שולם (או בלי חיוב מתועד) — חוזר להמתנה לאישור
      UPDATE public.tenant_addons SET status = 'pending', billing_id = _billing WHERE id = r.id;
    ELSE
      -- שולם וסומן ע"י מנהל הפלטפורמה — נשאר פעיל, מתועד כמאושר
      UPDATE public.tenant_addons
         SET billing_id = _billing, approved_at = COALESCE(approved_at, r.purchased_at)
       WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 8. שם התוסף בקטלוג (זאפ השוואת מחירים — לא Zapier)
-- ============================================================
UPDATE public.platform_addons
   SET title = 'חיבור לזאפ — השוואת מחירים'
 WHERE addon_name = 'zapier' AND title = 'חיבור לזאפ (Zapier)';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- חלק 16 (המשך): חיוב בדיקה של ₪1 — "בדיקת סליקה"
--
-- מנהל החנות (במסוף של החנות) ומנהל הפלטפורמה (במסוף של הפלטפורמה) יכולים
-- לחייב את הכרטיס שלהם ב-₪1 דרך דף התשלום של Hyp, כדי לוודא שפרטי המסוף
-- נכונים ושהכסף עובר. זו עסקה אמיתית: השקל נכנס לחשבון של אותו מסוף (פחות
-- עמלה), ואפשר לבטל אותה בממשק של MAX / Hyp.
--   • payment_intents.kind = 'test' (בלי שום פעולה אחרי התשלום).
--   • בדיקה של הפלטפורמה לא שייכת לאף חנות (tenant_id ריק).
--   • תוצאת הבדיקה האחרונה מוצגת ליד פרטי המסוף (last_test).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. כוונת תשלום מסוג "בדיקה"
-- ============================================================
ALTER TABLE public.payment_intents ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_kind_check;
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_kind_check CHECK (kind IN ('order', 'addon', 'plan', 'test'));
-- היה: (scope = 'store') = (kind = 'order') — עכשיו גם בדיקה בחנות
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_check3;
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_scope_kind_check;
ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_scope_kind_check CHECK (
    (kind <> 'order' OR scope = 'store')
    AND (kind NOT IN ('addon', 'plan') OR scope = 'platform')
    AND (kind <> 'test' OR amount = 1)
    -- בלי חנות — רק בדיקה של מסוף הפלטפורמה
    AND (tenant_id IS NOT NULL OR (scope = 'platform' AND kind = 'test')));
CREATE INDEX IF NOT EXISTS payment_intents_tests_idx
  ON public.payment_intents (scope, created_at DESC) WHERE kind = 'test';

-- תוצאת הבדיקה האחרונה: { status, amount, transaction_id, card_last4, error, created_at, completed_at }
CREATE OR REPLACE FUNCTION public.payment_last_test(_scope text, _tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('status', i.status, 'amount', i.amount,
                            'transaction_id', i.hyp_transaction_id, 'card_last4', i.card_last4,
                            'error', i.error, 'created_at', i.created_at,
                            'completed_at', i.completed_at)
    FROM public.payment_intents i
   WHERE i.kind = 'test' AND i.scope = _scope
     AND i.tenant_id IS NOT DISTINCT FROM _tenant
   ORDER BY i.created_at DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.payment_last_test(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_last_test(text, uuid) TO service_role;

-- ============================================================
-- 2. התחלת בדיקה — מנהל החנות (store) / מנהל הפלטפורמה (platform)
-- ============================================================
-- הבדיקה עובדת גם לפני שמדליקים "סליקה פעילה בקופה" — זו כל המטרה
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
    IF NOT public.platform_payments_ready() THEN
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
-- 3. השלמת תשלום — בדיקה לא עושה שום דבר מעבר לתיעוד
-- ============================================================
CREATE OR REPLACE FUNCTION public.payment_intent_complete(
  _token text,
  _transaction_id text,
  _amount numeric,
  _payments integer DEFAULT NULL,
  _card_last4 text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i public.payment_intents;
  s public.tenant_subscriptions;
  o public.orders;
  _from timestamptz;
  _to timestamptz;
  _end timestamptz;
  _email text;
  _was_expired boolean := false;
BEGIN
  SELECT * INTO i FROM public.payment_intents WHERE token = _token FOR UPDATE;
  IF i.id IS NULL THEN
    RAISE EXCEPTION 'כוונת התשלום לא נמצאה';
  END IF;
  IF i.status = 'paid' THEN
    RETURN jsonb_build_object('already', true, 'kind', i.kind, 'tenant_id', i.tenant_id,
                              'order_id', i.order_id, 'scope', i.scope);
  END IF;
  IF _transaction_id IS NULL OR _transaction_id !~ '^[0-9A-Za-z-]{1,40}$' THEN
    RAISE EXCEPTION 'מזהה עסקה לא תקין';
  END IF;
  IF _amount IS NULL OR abs(_amount - i.amount) > 0.01 THEN
    UPDATE public.payment_intents SET status = 'failed', error = 'הסכום ששולם אינו תואם'
     WHERE id = i.id;
    RAISE EXCEPTION 'הסכום ששולם (%) אינו תואם לסכום לתשלום (%)', _amount, i.amount;
  END IF;

  UPDATE public.payment_intents
     SET status = 'paid', hyp_transaction_id = _transaction_id, completed_at = now(), error = NULL,
         payments = _payments,
         card_last4 = CASE WHEN _card_last4 ~ '^[0-9]{4}$' THEN _card_last4 END
   WHERE id = i.id;

  SELECT u.email INTO _email FROM auth.users u WHERE u.id = i.created_by;

  IF i.kind = 'order' THEN
    SELECT * INTO o FROM public.orders WHERE id = i.order_id FOR UPDATE;
    _was_expired := o.payment_status = 'expired';
    PERFORM set_config('kobi.payment_update', 'on', true);
    UPDATE public.orders
       SET payment_status = 'paid', paid_at = now(), payment_due_at = NULL,
           hyp_transaction_id = _transaction_id, payment_token = i.token,
           -- שולם אחרי שפג הזמן (ההזמנה בוטלה): חוזרת לטיפול והמלאי נשמר מחדש
           status = CASE WHEN o.status = 'cancelled' AND _was_expired THEN 'pending' ELSE o.status END
     WHERE id = o.id;
    PERFORM set_config('kobi.payment_update', 'off', true);

  ELSIF i.kind = 'addon' THEN
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = i.tenant_id FOR UPDATE;
    _end := CASE WHEN (SELECT c.billing FROM public.platform_addons c WHERE c.addon_name = i.addon_name) = 'monthly'
                 THEN GREATEST(COALESCE(i.period_end, s.current_period_end), COALESCE(s.current_period_end, i.period_end))
            END;
    UPDATE public.tenant_addons
       SET status = 'canceled', canceled_at = now(), ended_reason = 'expired'
     WHERE tenant_id = i.tenant_id AND addon_name = i.addon_name AND status = 'active'
       AND expires_at IS NOT NULL AND expires_at <= now();
    IF NOT public.tenant_addon_active(i.tenant_id, i.addon_name) THEN
      INSERT INTO public.tenant_addons
             (tenant_id, addon_name, status, expires_at, amount, source, purchased_by)
      VALUES (i.tenant_id, i.addon_name, 'active', _end, i.amount, 'purchase', i.created_by);
    END IF;
    INSERT INTO public.billing_history
           (tenant_id, kind, plan_type, amount, period_start, period_end, addon_name,
            payment_status, paid_at, payment_method, note, recorded_by, recorded_by_email,
            hyp_transaction_id, payment_token)
    VALUES (i.tenant_id, 'addon', COALESCE(s.plan_type, 'trial'), i.amount, now(), _end, i.addon_name,
            'paid', now(), 'credit_card', left(i.description || ' — שולם באשראי', 500),
            i.created_by, _email, _transaction_id, i.token);

  ELSIF i.kind = 'test' THEN
    -- חיוב בדיקה של ₪1: רק מתעדים שהמסוף עובד — בלי שום פעולה נוספת
    NULL;

  ELSE -- plan
    SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = i.tenant_id FOR UPDATE;
    _from := CASE
      WHEN s.plan_type = i.plan_type AND s.status <> 'canceled' AND s.current_period_end > now()
        THEN s.current_period_end
      ELSE now()
    END;
    _to := _from + make_interval(months => i.months);
    UPDATE public.tenant_subscriptions
       SET plan_type = i.plan_type, status = 'active', current_period_end = _to
     WHERE tenant_id = i.tenant_id;
    INSERT INTO public.billing_history
           (tenant_id, kind, plan_type, amount, months, payment_method, period_start, period_end,
            reference, note, recorded_by, recorded_by_email, payment_status, paid_at,
            hyp_transaction_id, payment_token)
    VALUES (i.tenant_id, 'payment', i.plan_type, i.amount, i.months, 'credit_card', _from, _to,
            left('Hyp ' || _transaction_id, 120), left(i.description || ' — שולם באשראי', 500),
            i.created_by, _email, 'paid', now(), _transaction_id, i.token);
  END IF;

  RETURN jsonb_build_object('already', false, 'kind', i.kind, 'tenant_id', i.tenant_id,
                            'order_id', i.order_id, 'scope', i.scope, 'reopened', _was_expired);
END $$;
REVOKE ALL ON FUNCTION public.payment_intent_complete(text, text, numeric, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_intent_complete(text, text, numeric, integer, text) TO service_role;


-- ============================================================
-- 4. הגדרות המסוף — עם תוצאת הבדיקה האחרונה
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
    'last_test', public.payment_last_test('store', _tenant));
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
    'ready', public.platform_payments_ready(),
    'updated_at', p.updated_at,
    'last_test', public.payment_last_test('platform', NULL));
END $$;
REVOKE ALL ON FUNCTION public.platform_payment_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payment_settings() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

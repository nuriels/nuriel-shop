-- ============================================================
-- חלק 16: סליקת אשראי (Hyp / MAX) — לפלטפורמה ולחנויות, ופרטי עוסק
--
-- שני מסופים:
--   • הפלטפורמה (platform_settings) — מנהלי החנויות משלמים לנו על מנויים
--     ותוספים (B2B).
--   • כל חנות (site_settings.hyp_terminal_number + tenant_payment_secrets) —
--     הלקוחות של החנות משלמים לבעל החנות (B2C).
--   הסיסמה ומפתח ה-API של החנות נשמרים בטבלה נפרדת שאין אליה גישה מהדפדפן:
--   site_settings קריאה לכולם (האתר הציבורי טוען ממנה את ההגדרות), ולכן אסור
--   שסוד יישב בה. מספר המסוף (לא סודי) — ב-site_settings, כפי שהתבקש.
--
-- תהליך תשלום (payment_intents):
--   1. השרת יוצר "כוונת תשלום" (token אקראי = Order בבקשה ל-Hyp), עם הסכום
--      שנקבע כאן במסד בלבד.
--   2. השרת מבקש מ-Hyp קישור חתום (APISign / SIGN) ומעביר את הלקוח לתשלום.
--   3. Hyp מחזיר את הלקוח ל-/payments/hyp/return; השרת מאמת את החתימה מול Hyp
--      (APISign / VERIFY) ורק אז קורא ל-payment_intent_complete — שמסמן שולם
--      ומפעיל את התוצאה (הזמנה שולמה / תוסף נפתח / מנוי מתחדש). פעם אחת בלבד.
--
-- הזמנות בחנות עם סליקה פעילה: הזמנה של לקוח / אורח נוצרת "ממתינה לתשלום"
-- (payment_status = awaiting). המלאי נשמר לה כבר ביצירה — כדי שלא יימכר
-- הפריט האחרון פעמיים בזמן ששני לקוחות משלמים — ונסגר סופית עם אישור
-- התשלום. לא שולמה תוך 30 דקות → מבוטלת והמלאי חוזר (expire_unpaid_orders).
-- הזמנה שממתינה לתשלום לא יוצאת לליקוט / משלוח, ומיילי ההזמנה (ובהם התראת
-- המלאי הנמוך לבעל החנות) נשלחים רק אחרי האישור.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. בדיקת ת.ז / ע.מ / ח.פ (ספרת ביקורת ישראלית)
-- ============================================================
CREATE OR REPLACE FUNCTION public.israeli_id_valid(_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _digits text := regexp_replace(COALESCE(_value, ''), '\D', '', 'g');
  _sum integer := 0;
  _d integer;
  i integer;
BEGIN
  IF _digits !~ '^[0-9]{5,9}$' THEN
    RETURN false;
  END IF;
  _digits := lpad(_digits, 9, '0');
  IF _digits = '000000000' THEN
    RETURN false;
  END IF;
  FOR i IN 1..9 LOOP
    _d := substr(_digits, i, 1)::integer * (CASE WHEN i % 2 = 0 THEN 2 ELSE 1 END);
    _sum := _sum + CASE WHEN _d > 9 THEN _d - 9 ELSE _d END;
  END LOOP;
  RETURN _sum % 10 = 0;
END $$;
GRANT EXECUTE ON FUNCTION public.israeli_id_valid(text) TO anon, authenticated, service_role;

-- ============================================================
-- 2. מסוף הפלטפורמה
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                   BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  hyp_terminal_number  TEXT CHECK (hyp_terminal_number IS NULL OR hyp_terminal_number ~ '^[0-9]{4,12}$'),
  -- PassP — "סיסמת ה-API" של המסוף
  hyp_api_password     TEXT CHECK (hyp_api_password IS NULL OR char_length(hyp_api_password) BETWEEN 1 AND 200),
  -- KEY — מפתח ה-API של המסוף (נדרש לחתימת קישור התשלום)
  hyp_api_key          TEXT CHECK (hyp_api_key IS NULL OR char_length(hyp_api_key) BETWEEN 1 AND 200),
  -- עד כמה תשלומים מותר בתשלום על מנוי שנתי
  hyp_max_payments     INTEGER NOT NULL DEFAULT 12 CHECK (hyp_max_payments BETWEEN 1 AND 36),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           UUID
);
COMMENT ON TABLE public.platform_settings IS
  'הגדרות הפלטפורמה (חלק 16): מסוף Hyp לגביית מנויים ותוספים. אין גישה מהדפדפן — רק דרך פונקציות';
INSERT INTO public.platform_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;

-- סליקת הפלטפורמה מוגדרת (מסוף + סיסמה + מפתח)
CREATE OR REPLACE FUNCTION public.platform_payments_ready()
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
GRANT EXECUTE ON FUNCTION public.platform_payments_ready() TO authenticated, service_role;

-- מנהל הפלטפורמה: המצב (בלי הסודות עצמם — רק 4 תווים אחרונים)
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
    'updated_at', p.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.platform_payment_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_payment_settings() TO authenticated, service_role;

-- שמירה: סיסמה / מפתח ריקים = להשאיר את הקיים; _clear = לנתק את הסליקה
CREATE OR REPLACE FUNCTION public.platform_save_payment_settings(
  _terminal text,
  _password text DEFAULT NULL,
  _key text DEFAULT NULL,
  _max_payments integer DEFAULT NULL,
  _clear boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t text := NULLIF(regexp_replace(COALESCE(_terminal, ''), '\s', '', 'g'), '');
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _clear THEN
    UPDATE public.platform_settings
       SET hyp_terminal_number = NULL, hyp_api_password = NULL, hyp_api_key = NULL,
           updated_at = now(), updated_by = auth.uid()
     WHERE id;
    RETURN public.platform_payment_settings();
  END IF;
  IF _t IS NULL OR _t !~ '^[0-9]{4,12}$' THEN
    RAISE EXCEPTION 'מספר המסוף: ספרות בלבד (4 עד 12)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.platform_settings
     SET hyp_terminal_number = _t,
         hyp_api_password = COALESCE(NULLIF(btrim(COALESCE(_password, '')), ''), hyp_api_password),
         hyp_api_key = COALESCE(NULLIF(btrim(COALESCE(_key, '')), ''), hyp_api_key),
         hyp_max_payments = COALESCE(_max_payments, hyp_max_payments),
         updated_at = now(), updated_by = auth.uid()
   WHERE id;
  IF (SELECT hyp_api_password IS NULL OR hyp_api_key IS NULL FROM public.platform_settings WHERE id) THEN
    RAISE EXCEPTION 'חסרים סיסמת ה-API או מפתח ה-API של המסוף' USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.platform_payment_settings();
END $$;
REVOKE ALL ON FUNCTION public.platform_save_payment_settings(text, text, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_payment_settings(text, text, text, integer, boolean)
  TO authenticated, service_role;

-- ============================================================
-- 3. מסוף החנות
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS hyp_terminal_number TEXT,
  -- סליקה פעילה: הזמנות של לקוחות משולמות באשראי לפני שהן נכנסות לטיפול
  ADD COLUMN IF NOT EXISTS card_payments_enabled BOOLEAN NOT NULL DEFAULT false,
  -- עד כמה תשלומים הלקוח יכול לבחור בדף התשלום
  ADD COLUMN IF NOT EXISTS hyp_max_payments INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_hyp_check;
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_hyp_check CHECK (
    (hyp_terminal_number IS NULL OR hyp_terminal_number ~ '^[0-9]{4,12}$')
    AND hyp_max_payments BETWEEN 1 AND 36
    AND (NOT card_payments_enabled OR hyp_terminal_number IS NOT NULL));

-- הסודות של מסוף החנות — בלי גישה מהדפדפן בכלל
CREATE TABLE IF NOT EXISTS public.tenant_payment_secrets (
  tenant_id         UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  hyp_api_password  TEXT NOT NULL CHECK (char_length(hyp_api_password) BETWEEN 1 AND 200),
  hyp_api_key       TEXT NOT NULL CHECK (char_length(hyp_api_key) BETWEEN 1 AND 200),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        UUID
);
COMMENT ON TABLE public.tenant_payment_secrets IS
  'סיסמת ה-API ומפתח ה-API של מסוף Hyp של החנות (חלק 16) — רק לשרת';
ALTER TABLE public.tenant_payment_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_payment_secrets;
CREATE POLICY tenant_isolation ON public.tenant_payment_secrets AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.tenant_payment_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_payment_secrets TO service_role;

-- סליקה לא נדלקת בלי מסוף + סודות (גם בעדכון ישיר של site_settings)
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
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_settings_card_payments_guard ON public.site_settings;
CREATE TRIGGER site_settings_card_payments_guard
BEFORE INSERT OR UPDATE OF card_payments_enabled, hyp_terminal_number ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.site_settings_card_payments_guard();

-- מנהל החנות: המצב (בלי הסודות)
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
    'updated_at', sec.updated_at);
END $$;
REVOKE ALL ON FUNCTION public.store_payment_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_payment_settings() TO authenticated, service_role;

-- מנהל החנות: שמירה. סיסמה / מפתח ריקים = להשאיר את הקיים; _clear = ניתוק
CREATE OR REPLACE FUNCTION public.store_save_payment_settings(
  _terminal text,
  _password text DEFAULT NULL,
  _key text DEFAULT NULL,
  _enabled boolean DEFAULT true,
  _max_payments integer DEFAULT 1,
  _clear boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _t text := NULLIF(regexp_replace(COALESCE(_terminal, ''), '\s', '', 'g'), '');
  _p text := NULLIF(btrim(COALESCE(_password, '')), '');
  _k text := NULLIF(btrim(COALESCE(_key, '')), '');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לשנות את הגדרות הסליקה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _clear THEN
    UPDATE public.site_settings
       SET card_payments_enabled = false, hyp_terminal_number = NULL
     WHERE tenant_id = _tenant;
    DELETE FROM public.tenant_payment_secrets WHERE tenant_id = _tenant;
    RETURN public.store_payment_settings();
  END IF;
  IF _t IS NULL OR _t !~ '^[0-9]{4,12}$' THEN
    RAISE EXCEPTION 'מספר המסוף: ספרות בלבד (4 עד 12)' USING ERRCODE = 'check_violation';
  END IF;
  IF _max_payments IS NULL OR _max_payments NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'מספר התשלומים: 1 עד 36' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NOT NULL OR _k IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenant_payment_secrets WHERE tenant_id = _tenant)
       AND (_p IS NULL OR _k IS NULL) THEN
      RAISE EXCEPTION 'יש להזין גם סיסמת API וגם מפתח API' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.tenant_payment_secrets AS sec (tenant_id, hyp_api_password, hyp_api_key, updated_by)
    VALUES (_tenant, _p, _k, auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE
      SET hyp_api_password = COALESCE(_p, sec.hyp_api_password),
          hyp_api_key = COALESCE(_k, sec.hyp_api_key),
          updated_at = now(), updated_by = auth.uid();
  END IF;
  UPDATE public.site_settings
     SET hyp_terminal_number = _t,
         hyp_max_payments = _max_payments,
         card_payments_enabled = COALESCE(_enabled, false)
   WHERE tenant_id = _tenant;
  RETURN public.store_payment_settings();
END $$;
REVOKE ALL ON FUNCTION public.store_save_payment_settings(text, text, text, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_save_payment_settings(text, text, text, boolean, integer, boolean)
  TO authenticated, service_role;

-- השרת: פרטי המסוף לתשלום (platform / store)
CREATE OR REPLACE FUNCTION public.hyp_credentials(_scope text, _tenant uuid DEFAULT NULL)
RETURNS TABLE(terminal text, api_password text, api_key text, max_payments integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.hyp_terminal_number, p.hyp_api_password, p.hyp_api_key, p.hyp_max_payments
    FROM public.platform_settings p
   WHERE _scope = 'platform' AND p.id
     AND p.hyp_terminal_number IS NOT NULL AND p.hyp_api_password IS NOT NULL AND p.hyp_api_key IS NOT NULL
  UNION ALL
  SELECT s.hyp_terminal_number, sec.hyp_api_password, sec.hyp_api_key, s.hyp_max_payments
    FROM public.site_settings s
    JOIN public.tenant_payment_secrets sec ON sec.tenant_id = s.tenant_id
   WHERE _scope = 'store' AND s.tenant_id = _tenant AND s.hyp_terminal_number IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.hyp_credentials(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hyp_credentials(text, uuid) TO service_role;

-- ============================================================
-- 4. פרטי העוסק של בעל החנות (לחיוב מנויים ותוספים)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_billing_profile (
  tenant_id      UUID PRIMARY KEY DEFAULT public.current_tenant_id()
                 REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- exempt: עוסק פטור | licensed: עוסק מורשה | company: חברה בע"מ
  business_type  TEXT NOT NULL CHECK (business_type IN ('exempt', 'licensed', 'company')),
  company_name   TEXT NOT NULL CHECK (char_length(btrim(company_name)) BETWEEN 2 AND 120),
  -- ח.פ / ע.מ / ת.ז — 9 ספרות עם ספרת ביקורת
  tax_id         TEXT NOT NULL CHECK (tax_id ~ '^[0-9]{9}$' AND public.israeli_id_valid(tax_id)),
  address        TEXT NOT NULL CHECK (char_length(btrim(address)) BETWEEN 4 AND 200),
  billing_email  TEXT CHECK (billing_email IS NULL OR (char_length(billing_email) <= 254
                            AND billing_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.tenant_billing_profile IS
  'פרטי העוסק של בעל החנות (חלק 16) — מופיעים בחיובי המנוי והתוספים';

CREATE OR REPLACE FUNCTION public.tenant_billing_profile_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.company_name := btrim(NEW.company_name);
  NEW.address := btrim(NEW.address);
  NEW.tax_id := lpad(regexp_replace(COALESCE(NEW.tax_id, ''), '\D', '', 'g'), 9, '0');
  NEW.billing_email := NULLIF(lower(btrim(COALESCE(NEW.billing_email, ''))), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_billing_profile_normalize ON public.tenant_billing_profile;
CREATE TRIGGER tenant_billing_profile_normalize
BEFORE INSERT OR UPDATE ON public.tenant_billing_profile
FOR EACH ROW EXECUTE FUNCTION public.tenant_billing_profile_normalize();

ALTER TABLE public.tenant_billing_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_billing_profile;
CREATE POLICY tenant_isolation ON public.tenant_billing_profile AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.tenant_billing_profile FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_billing_profile TO authenticated;
GRANT ALL ON public.tenant_billing_profile TO service_role;
DROP POLICY IF EXISTS "store admin manages billing profile" ON public.tenant_billing_profile;
CREATE POLICY "store admin manages billing profile" ON public.tenant_billing_profile
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================
-- 5. עמודות תשלום בהזמנות ובהיסטוריית המנוי
-- ============================================================
ALTER TABLE public.orders
  -- offline: בלי סליקה באתר (כמו עד היום) | credit_card: תשלום מאובטח ב-Hyp
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'offline',
  -- not_required | awaiting: ממתינה לתשלום | paid: שולמה | expired: לא שולמה בזמן
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hyp_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_token TEXT;
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_payment_check CHECK (
    payment_method IN ('offline', 'credit_card')
    AND payment_status IN ('not_required', 'awaiting', 'paid', 'expired')
    AND (payment_status <> 'paid' OR paid_at IS NOT NULL));
CREATE INDEX IF NOT EXISTS orders_awaiting_payment_idx
  ON public.orders (payment_due_at) WHERE payment_status = 'awaiting';

ALTER TABLE public.billing_history
  ADD COLUMN IF NOT EXISTS hyp_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_token TEXT;
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_payment_method_check;
ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_payment_method_check CHECK (
    payment_method IS NULL
    OR payment_method IN ('annual', 'installments', 'monthly', 'other', 'credit_card'));

-- הזמנה חדשה של לקוח / אורח בחנות עם סליקה פעילה → ממתינה לתשלום.
-- הזמנה שהצוות יוצר (סוכן / מנהל), והצעות מחיר — בלי סליקה (כמו עד היום).
CREATE OR REPLACE FUNCTION public.orders_card_payment_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- הערכים לא מגיעים מהדפדפן
  NEW.payment_method := 'offline';
  NEW.payment_status := 'not_required';
  NEW.payment_due_at := NULL;
  NEW.paid_at := NULL;
  NEW.hyp_transaction_id := NULL;
  NEW.payment_token := NULL;
  IF NEW.kind = 'order'
     AND NOT public.is_staff(auth.uid())
     AND EXISTS (SELECT 1 FROM public.site_settings s
                  WHERE s.tenant_id = NEW.tenant_id AND s.card_payments_enabled) THEN
    NEW.payment_method := 'credit_card';
    NEW.payment_status := 'awaiting';
    NEW.payment_due_at := now() + interval '30 minutes';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_card_payment_default ON public.orders;
CREATE TRIGGER orders_card_payment_default
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_card_payment_default();

-- שדות התשלום משתנים רק דרך פונקציות התשלום (לא מהממשק / הדפדפן);
-- הזמנה שממתינה לתשלום לא יוצאת לטיפול (ליקוט / משלוח) — רק ביטול
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
  END IF;
  IF NEW.payment_status = 'awaiting'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('pending', 'cancelled') THEN
    RAISE EXCEPTION 'ההזמנה % עדיין ממתינה לתשלום באשראי — אי אפשר להעביר אותה לטיפול', NEW.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_payment_guard ON public.orders;
CREATE TRIGGER orders_payment_guard
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_payment_guard();

-- ============================================================
-- 6. כוונות תשלום
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- נשלח ל-Hyp כ-Order וחוזר בחזרה — אקראי, לא ניתן לניחוש
  token               TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  -- platform: לחשבון הפלטפורמה (מנוי / תוסף) | store: לחשבון החנות (הזמנה)
  scope               TEXT NOT NULL CHECK (scope IN ('platform', 'store')),
  kind                TEXT NOT NULL CHECK (kind IN ('order', 'addon', 'plan')),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id            UUID REFERENCES public.orders(id) ON DELETE CASCADE,
  addon_name          TEXT REFERENCES public.platform_addons(addon_name),
  plan_type           TEXT CHECK (plan_type IS NULL OR plan_type IN ('basic', 'premium')),
  months              INTEGER CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  -- סוף התקופה שהתוסף החודשי יקבל (לפי הצעת המחיר)
  period_end          TIMESTAMPTZ,
  amount              NUMERIC(12, 2) NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  max_payments        INTEGER NOT NULL DEFAULT 1 CHECK (max_payments BETWEEN 1 AND 36),
  description         TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 250),
  -- pending | paid | failed (נדחה — אפשר לנסות שוב) | expired
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired')),
  hyp_transaction_id  TEXT UNIQUE,
  payments            INTEGER,
  card_last4          TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  error               TEXT CHECK (error IS NULL OR char_length(error) <= 300),
  -- לאן להחזיר את הלקוח אחרי התשלום (הדומיין שממנו יצא)
  return_origin       TEXT CHECK (return_origin IS NULL OR return_origin ~ '^https?://[a-z0-9.:-]+$'),
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  CHECK ((kind = 'order') = (order_id IS NOT NULL)),
  CHECK ((kind = 'addon') = (addon_name IS NOT NULL)),
  CHECK ((kind = 'plan') = (plan_type IS NOT NULL AND months IS NOT NULL)),
  CHECK ((scope = 'store') = (kind = 'order'))
);
CREATE INDEX IF NOT EXISTS payment_intents_order_idx ON public.payment_intents (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_intents_tenant_idx ON public.payment_intents (tenant_id, created_at DESC);
COMMENT ON TABLE public.payment_intents IS
  'כוונות תשלום ב-Hyp (חלק 16) — נוצרות ומושלמות רק בשרת';

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.payment_intents;
CREATE POLICY tenant_isolation ON public.payment_intents AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.payment_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.payment_intents TO service_role;

-- ---------- הזמנה בחנות ----------
-- השרת (service_role, בחנות של הבקשה): כוונת תשלום להזמנה שממתינה לתשלום.
-- כל ניסיון מאריך את חלון התשלום ב-30 דקות. סכום 0 → אין צורך בתשלום.
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
  IF o.payment_status = 'not_required' THEN
    RETURN jsonb_build_object('status', 'not_required', 'order_number', o.order_number);
  END IF;
  IF o.payment_status = 'expired' OR o.status = 'cancelled' THEN
    RAISE EXCEPTION 'פג הזמן לתשלום וההזמנה % בוטלה. אפשר להזמין מחדש מהסל.', o.order_number
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.site_settings WHERE tenant_id = _tenant;

  -- הסכום לתשלום = הסה"כ כולל מע"מ (כמו בקופה ובאישור ההזמנה — calculateVat):
  -- בחנות שמחיריה "לפני מע"מ" — total + מע"מ, מעוגל לאגורה
  _amount := CASE
    WHEN COALESCE(o.prices_include_vat, true) THEN round(COALESCE(o.total, 0), 2)
    ELSE round(COALESCE(o.total, 0), 2)
         + round(round(COALESCE(o.total, 0), 2) * COALESCE(o.vat_rate, 18) / 100, 2)
  END;

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

-- ---------- תוסף / מנוי (לחשבון הפלטפורמה) ----------
CREATE OR REPLACE FUNCTION public.billing_profile_json(_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('business_type', b.business_type, 'company_name', b.company_name,
                            'tax_id', b.tax_id, 'address', b.address, 'billing_email', b.billing_email)
    FROM public.tenant_billing_profile b WHERE b.tenant_id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.billing_profile_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_profile_json(uuid) TO service_role;

-- מנהל החנות: התחלת רכישת תוסף בתשלום מאובטח. המחיר — מהמסד בלבד.
CREATE OR REPLACE FUNCTION public.addon_checkout_start(_addon text, _expected numeric DEFAULT NULL,
                                                       _origin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _q jsonb;
  _amount numeric;
  _token text;
  _profile jsonb;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לרכוש תוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF NOT public.platform_payments_ready() THEN
    RAISE EXCEPTION 'התשלום באשראי עדיין לא זמין — נסו שוב מאוחר יותר' USING ERRCODE = 'check_violation';
  END IF;
  _profile := public.billing_profile_json(_tenant);
  IF _profile IS NULL THEN
    RAISE EXCEPTION 'יש להשלים את פרטי העוסק לפני התשלום' USING ERRCODE = 'check_violation';
  END IF;
  _q := public.addon_quote_for(_tenant, _addon);
  IF NOT COALESCE((_q ->> 'can_buy')::boolean, false) THEN
    RAISE EXCEPTION '%', COALESCE(_q ->> 'reason', 'לא ניתן לרכוש את התוסף כרגע') USING ERRCODE = 'check_violation';
  END IF;
  _amount := (_q ->> 'amount')::numeric;
  IF _expected IS NOT NULL AND abs(_expected - _amount) > 0.01 THEN
    RAISE EXCEPTION 'המחיר התעדכן ל-% ₪ — אשרו את הרכישה מחדש', to_char(_amount, 'FM999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'סכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.payment_intents
         (scope, kind, tenant_id, addon_name, period_end, amount, max_payments, description,
          return_origin, created_by)
  VALUES ('platform', 'addon', _tenant, _q ->> 'addon',
          CASE WHEN _q ->> 'billing' = 'monthly' THEN (_q ->> 'period_end')::timestamptz END,
          _amount, 1, left(format('תוסף: %s', _q ->> 'title'), 250), NULLIF(_origin, ''), auth.uid())
  RETURNING token INTO _token;

  RETURN jsonb_build_object('token', _token, 'amount', _amount, 'max_payments', 1,
                            'description', format('תוסף: %s', _q ->> 'title'),
                            'profile', _profile,
                            'email', (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()));
END $$;
REVOKE ALL ON FUNCTION public.addon_checkout_start(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_checkout_start(text, numeric, text) TO authenticated, service_role;

-- הצעת מחיר למנוי שנתי: 12 חודשים × מחיר החבילה, ובחידוש אותה חבילה —
-- גם התוספים החודשיים הפעילים (הם מתחדשים יחד עם המנוי)
CREATE OR REPLACE FUNCTION public.plan_quote_for(_tenant uuid, _plan text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p text := lower(btrim(COALESCE(_plan, '')));
  pl public.platform_plans;
  s public.tenant_subscriptions;
  _months integer := 12;
  _addons numeric := 0;
  _titles text[] := '{}';
BEGIN
  SELECT * INTO pl FROM public.platform_plans WHERE plan_type = _p;
  IF pl.plan_type IS NULL THEN
    RAISE EXCEPTION 'חבילה לא מוכרת: %', _plan USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant;
  IF _p = 'basic' THEN
    SELECT COALESCE(sum(c.price), 0), COALESCE(array_agg(c.title ORDER BY c.sort_order), '{}')
      INTO _addons, _titles
      FROM public.tenant_addons a JOIN public.platform_addons c ON c.addon_name = a.addon_name
     WHERE a.tenant_id = _tenant AND a.status = 'active' AND c.billing = 'monthly'
       AND (a.expires_at IS NULL OR a.expires_at > now());
  END IF;
  RETURN jsonb_build_object(
    'plan', _p, 'title', pl.title, 'months', _months,
    'monthly_price', pl.monthly_price,
    'addons_monthly', _addons, 'addon_titles', to_jsonb(_titles),
    'amount', round((pl.monthly_price + _addons) * _months, 2),
    'renewal', s.plan_type = _p AND s.status <> 'canceled' AND s.current_period_end > now(),
    'current_period_end', s.current_period_end);
END $$;
REVOKE ALL ON FUNCTION public.plan_quote_for(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_quote_for(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.plan_quote(_plan text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.plan_quote_for(public.current_tenant_id(), _plan)
      || jsonb_build_object('payments_ready', public.platform_payments_ready(),
                            'max_payments', (SELECT hyp_max_payments FROM public.platform_settings WHERE id));
END $$;
REVOKE ALL ON FUNCTION public.plan_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_quote(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.plan_checkout_start(_plan text, _expected numeric DEFAULT NULL,
                                                      _origin text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _q jsonb;
  _amount numeric;
  _token text;
  _profile jsonb;
  _max integer := COALESCE((SELECT hyp_max_payments FROM public.platform_settings WHERE id), 12);
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לשלם על המנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF NOT public.platform_payments_ready() THEN
    RAISE EXCEPTION 'התשלום באשראי עדיין לא זמין — פנו אלינו בצ''אט התמיכה' USING ERRCODE = 'check_violation';
  END IF;
  _profile := public.billing_profile_json(_tenant);
  IF _profile IS NULL THEN
    RAISE EXCEPTION 'יש להשלים את פרטי העוסק לפני התשלום' USING ERRCODE = 'check_violation';
  END IF;
  _q := public.plan_quote_for(_tenant, _plan);
  _amount := (_q ->> 'amount')::numeric;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'לחבילה הזו אין מחיר לתשלום' USING ERRCODE = 'check_violation';
  END IF;
  IF _expected IS NOT NULL AND abs(_expected - _amount) > 0.01 THEN
    RAISE EXCEPTION 'המחיר התעדכן ל-% ₪ — אשרו את התשלום מחדש', to_char(_amount, 'FM999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.payment_intents
         (scope, kind, tenant_id, plan_type, months, amount, max_payments, description,
          return_origin, created_by)
  VALUES ('platform', 'plan', _tenant, _q ->> 'plan', (_q ->> 'months')::int, _amount, _max,
          left(format('%s — %s חודשים', _q ->> 'title', _q ->> 'months'), 250),
          NULLIF(_origin, ''), auth.uid())
  RETURNING token INTO _token;

  RETURN jsonb_build_object('token', _token, 'amount', _amount, 'max_payments', _max,
                            'description', format('%s — %s חודשים', _q ->> 'title', _q ->> 'months'),
                            'profile', _profile,
                            'email', (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()));
END $$;
REVOKE ALL ON FUNCTION public.plan_checkout_start(text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_checkout_start(text, numeric, text) TO authenticated, service_role;

-- ---------- החזרה מ-Hyp ----------
-- השרת: פרטי הכוונה לפי ה-token (Order) — כדי לדעת איזה מסוף לאמת מולו
CREATE OR REPLACE FUNCTION public.payment_intent_lookup(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('id', i.id, 'token', i.token, 'scope', i.scope, 'kind', i.kind,
                            'tenant_id', i.tenant_id, 'order_id', i.order_id, 'amount', i.amount,
                            'status', i.status, 'return_origin', i.return_origin,
                            'addon_name', i.addon_name, 'plan_type', i.plan_type,
                            'order_number', (SELECT o.order_number FROM public.orders o WHERE o.id = i.order_id),
                            'order_payment_status', (SELECT o.payment_status FROM public.orders o WHERE o.id = i.order_id))
    FROM public.payment_intents i
   WHERE i.token = _token;
$$;
REVOKE ALL ON FUNCTION public.payment_intent_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_intent_lookup(text) TO service_role;

-- תשלום שאומת מול Hyp → התוצאה. נקרא רק אחרי VERIFY מוצלח. פעם אחת בלבד:
-- קריאה חוזרת (רענון של דף החזרה) מחזירה already = true בלי לשנות דבר.
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

-- תשלום שנדחה / בוטל — אפשר לנסות שוב (ההזמנה עדיין ממתינה עד שיפוג הזמן)
CREATE OR REPLACE FUNCTION public.payment_intent_fail(_token text, _error text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.payment_intents
     SET status = 'failed', error = left(COALESCE(_error, 'התשלום לא הושלם'), 300)
   WHERE token = _token AND status = 'pending';
$$;
REVOKE ALL ON FUNCTION public.payment_intent_fail(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_intent_fail(text, text) TO service_role;

-- הזמנות שלא שולמו בזמן → מבוטלות, והמלאי חוזר (מכל החנויות; השרת מריץ כל 5 דקות)
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
  UPDATE public.payment_intents SET status = 'expired'
   WHERE status IN ('pending', 'failed') AND kind = 'order'
     AND order_id IN (SELECT id FROM public.orders WHERE payment_status = 'expired');
  PERFORM set_config('kobi.payment_update', 'off', true);
  -- כוונות תשלום של תוסף / מנוי שננטשו (יותר מיום)
  UPDATE public.payment_intents SET status = 'expired'
   WHERE status IN ('pending', 'failed') AND kind <> 'order' AND created_at < now() - interval '1 day';
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_orders() TO service_role;

-- ============================================================
-- 7. תוספים: עם סליקה — רק בתשלום מאובטח; זאפ פתוח לרכישה
-- ============================================================
UPDATE public.platform_addons SET available = true, updated_at = now() WHERE addon_name = 'zapier';

-- רכישה בלי תשלום (נרשם כ"ממתין לתשלום") — רק כשסליקת הפלטפורמה עוד לא מוגדרת
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
  IF public.platform_payments_ready() THEN
    RAISE EXCEPTION 'הרכישה מתבצעת בתשלום מאובטח באשראי' USING ERRCODE = 'check_violation';
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

-- חנות התוספים — גם: האם יש תשלום מאובטח, והאם פרטי העוסק מולאו
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
    'payments_ready', public.platform_payments_ready(),
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

-- "המנוי שלי": גם פרטי העוסק והאם אפשר לשלם באשראי
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
    'payments_ready', public.platform_payments_ready(),
    'billing_profile', public.billing_profile_json(_tenant));
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

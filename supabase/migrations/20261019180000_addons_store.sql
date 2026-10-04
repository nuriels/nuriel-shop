-- ============================================================
-- חלק 15: חנות התוספים (Add-ons Store), חיוב יחסי (Proration) ומודול זאפ
--
-- תוספים:
--   • platform_addons — הקטלוג: שם, מחיר, אופן חיוב (חודשי / חד-פעמי), האם
--     כלול בפרימיום, והאם פתוח לרכישה (זאפ — סגור עד שסליקת האשראי תאושר:
--     UPDATE public.platform_addons SET available = true WHERE addon_name = 'zapier').
--   • tenant_addons — התוספים של כל חנות: addon_name (google_sso /
--     custom_domain / digital_products / zapier), status (active / canceled),
--     expires_at (תוסף חודשי: מסונכרן לסוף תקופת המנוי הראשי; חד-פעמי: NULL).
--
-- חיוב יחסי:
--   • תוסף חודשי בחבילה הבסיסית משולם רק על הזמן שנותר עד
--     current_period_end של המנוי הראשי: מחיר חודשי × 12 / 365 × ימים שנותרו
--     (מעוגל לאגורה). התוסף פג יחד עם המנוי, וכשמנהל הפלטפורמה מחדש את
--     המנוי (תיעוד תשלום / הארכה) — התוספים הפעילים מתחדשים לאותו תאריך.
--   • המחיר מחושב רק במסד (addon_quote_for) — הדפדפן לא קובע סכום.
--   • אין סליקה באתר: הרכישה פותחת את הפיצ'ר מיד ונרשמת ב"היסטוריית המנוי"
--     כחיוב "ממתין לתשלום"; מנהל הפלטפורמה גובה ומסמן "שולם".
--
-- חסימת פיצ'רים:
--   • tenant_features = הפיצ'רים של החבילה + התוספים הפעילים. כל האכיפה
--     הקיימת (tenant_has_feature, enforce_plan_products, התחברות עם Google,
--     דומיין אישי) עוברת דרכה — תוסף שנרכש פותח את הפיצ'ר אוטומטית.
--   • zap_feed — רק עם תוסף זאפ פעיל (גם בפרימיום); בלעדיו /zap.xml מחזיר 403.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. קטלוג התוספים
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_addons (
  addon_name          TEXT PRIMARY KEY
                      CHECK (addon_name IN ('google_sso', 'custom_domain', 'digital_products', 'zapier')),
  title               TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  description         TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 400),
  -- monthly: לפי חודש, יחסי עד סוף תקופת המנוי | one_time: תשלום חד-פעמי
  billing             TEXT NOT NULL CHECK (billing IN ('monthly', 'one_time')),
  price               NUMERIC(10, 2) NOT NULL CHECK (price >= 0 AND price <= 100000),
  -- המפתח ב-tenant_features שהתוסף פותח
  feature             TEXT NOT NULL,
  -- כלול בחבילת פרימיום (ובתקופת הניסיון) — אין צורך לרכוש
  included_in_premium BOOLEAN NOT NULL DEFAULT true,
  -- פתוח לרכישה; false = "בקרוב"
  available           BOOLEAN NOT NULL DEFAULT true,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_addons IS
  'קטלוג התוספים (חלק 15): מחיר, אופן חיוב, כלול בפרימיום, פתוח לרכישה';

INSERT INTO public.platform_addons
       (addon_name, title, description, billing, price, feature, included_in_premium, available, sort_order)
VALUES
  ('google_sso', 'התחברות מהירה בגוגל (Google SSO)',
   'הלקוחות נכנסים ונרשמים בלחיצה אחת עם חשבון Google — בלי קוד במייל ובלי סיסמאות.',
   'monthly', 15, 'google_login', true, true, 10),
  ('custom_domain', 'חיבור דומיין פרטי',
   'כתובת משלכם (למשל www.my-shop.co.il) עם תעודת אבטחה אוטומטית.',
   'monthly', 20, 'custom_domain', true, true, 20),
  ('digital_products', 'מכירת מוצרים דיגיטליים',
   'מכירת קבצים, קורסים ורישיונות — בלי משלוח, עם שליחת קוד / קישור ללקוח.',
   'monthly', 15, 'digital', true, true, 30),
  ('zapier', 'חיבור לזאפ (Zapier)',
   'פיד מוצרים מוכן להשוואת המחירים של זאפ — המוצרים שלכם מופיעים מול מאות אלפי קונים.',
   'one_time', 250, 'zap_feed', false, false, 40)
ON CONFLICT (addon_name) DO NOTHING;

ALTER TABLE public.platform_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "addons catalog readable by everyone" ON public.platform_addons;
CREATE POLICY "addons catalog readable by everyone" ON public.platform_addons
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.platform_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.platform_addons TO anon, authenticated;
GRANT ALL ON public.platform_addons TO service_role;

-- ============================================================
-- 2. התוספים של כל חנות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_addons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  addon_name    TEXT NOT NULL REFERENCES public.platform_addons(addon_name),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  -- תוסף חודשי: סוף תקופת המנוי הראשי (מתחדש יחד איתו); חד-פעמי: NULL = לתמיד
  expires_at    TIMESTAMPTZ,
  -- הסכום שחויב ברכישה (יחסי) — לתיעוד
  amount        NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount <= 1000000),
  -- purchase: נרכש ע"י מנהל החנות | grant: הופעל ע"י מנהל הפלטפורמה
  source        TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'grant')),
  purchased_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  purchased_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at   TIMESTAMPTZ,
  -- expired: פג ונסגר כשנרכש מחדש | canceled: בוטל ע"י מנהל הפלטפורמה
  ended_reason  TEXT CHECK (ended_reason IS NULL OR ended_reason IN ('expired', 'canceled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'active' OR canceled_at IS NOT NULL)
);
COMMENT ON TABLE public.tenant_addons IS
  'תוספים שנרכשו (חלק 15) — פעיל = status active ו-expires_at ריק או בעתיד';

-- תוסף אחד פעיל מכל סוג לחנות
CREATE UNIQUE INDEX IF NOT EXISTS tenant_addons_one_active
  ON public.tenant_addons (tenant_id, addon_name) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS tenant_addons_tenant_idx
  ON public.tenant_addons (tenant_id, purchased_at DESC);

CREATE OR REPLACE FUNCTION public.tenant_addons_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_addons_touch ON public.tenant_addons;
CREATE TRIGGER tenant_addons_touch
BEFORE UPDATE ON public.tenant_addons
FOR EACH ROW EXECUTE FUNCTION public.tenant_addons_touch();

-- בידוד חנויות (כמו בכל טבלה עם tenant_id); כתיבה רק דרך הפונקציות
ALTER TABLE public.tenant_addons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_addons;
CREATE POLICY tenant_isolation ON public.tenant_addons AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.tenant_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_addons TO authenticated;
GRANT ALL ON public.tenant_addons TO service_role;
DROP POLICY IF EXISTS "store admin reads addons" ON public.tenant_addons;
CREATE POLICY "store admin reads addons" ON public.tenant_addons
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- ============================================================
-- 3. היסטוריית המנוי: חיוב תוסף + "ממתין לתשלום"
-- ============================================================
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_kind_check;
ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_kind_check
  CHECK (kind IN ('payment', 'trial_extension', 'plan_change', 'addon'));
ALTER TABLE public.billing_history
  ADD COLUMN IF NOT EXISTS addon_name TEXT,
  -- paid: שולם / לא דורש תשלום | due: ממתין לגבייה (רכישת תוסף באתר)
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_payment_status_check;
ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_payment_status_check CHECK (payment_status IN ('paid', 'due'));
ALTER TABLE public.billing_history DROP CONSTRAINT IF EXISTS billing_history_addon_check;
ALTER TABLE public.billing_history
  ADD CONSTRAINT billing_history_addon_check
  CHECK ((kind = 'addon') = (addon_name IS NOT NULL));

-- ============================================================
-- 4. הפיצ'רים של חנות = חבילה + תוספים
-- ============================================================

-- תוספים פעילים (שמות, ממוינים)
CREATE OR REPLACE FUNCTION public.tenant_active_addons(_tenant uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(a.addon_name ORDER BY a.addon_name), '{}'::text[])
    FROM public.tenant_addons a
   WHERE a.tenant_id = _tenant
     AND a.status = 'active'
     AND (a.expires_at IS NULL OR a.expires_at > now());
$$;

CREATE OR REPLACE FUNCTION public.tenant_addon_active(_tenant uuid, _addon text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _addon = ANY (public.tenant_active_addons(_tenant));
$$;

-- { max_products, custom_domain, variants, digital, google_login, vip_support, zap_feed }
-- if (plan === 'premium' OR has_addon(...)) — הפיצ'ר פתוח
CREATE OR REPLACE FUNCTION public.tenant_features(_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f jsonb := public.plan_features(
    COALESCE((SELECT s.plan_type FROM public.tenant_subscriptions s WHERE s.tenant_id = _tenant),
             'trial')) || jsonb_build_object('zap_feed', false);
  _feature text;
BEGIN
  FOR _feature IN
    SELECT c.feature
      FROM public.platform_addons c
     WHERE c.addon_name = ANY (public.tenant_active_addons(_tenant))
  LOOP
    _f := _f || jsonb_build_object(_feature, true);
  END LOOP;
  RETURN _f;
END $$;

CREATE OR REPLACE FUNCTION public.tenant_has_feature(_tenant uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.tenant_features(_tenant) ->> _feature)::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.tenant_active_addons(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_addon_active(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_features(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_has_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_active_addons(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_addon_active(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_features(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_has_feature(uuid, text) TO service_role;

-- מצב המנוי — עכשיו עם התוספים, והפיצ'רים כוללים אותם
CREATE OR REPLACE FUNCTION public.tenant_subscription_state(_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tenants;
  s public.tenant_subscriptions;
  _plan text;
  _ends timestamptz;
  _active boolean;
BEGIN
  SELECT * INTO t FROM public.tenants WHERE id = _tenant;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant;
  _plan := COALESCE(s.plan_type, 'trial');
  _ends := CASE WHEN s.plan_type = 'trial' THEN s.trial_ends_at ELSE s.current_period_end END;
  _active := t.is_default
          OR s.tenant_id IS NULL
          OR (s.status <> 'canceled' AND (_ends IS NULL OR _ends > now()));
  RETURN jsonb_build_object(
    'plan', _plan,
    'status', COALESCE(s.status, 'trialing'),
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'ends_at', _ends,
    'active', _active,
    'unlimited', _ends IS NULL,
    'days_left', CASE WHEN _ends IS NULL THEN NULL
                      ELSE GREATEST(0, ceil(extract(epoch FROM (_ends - now())) / 86400))::int END,
    'system', COALESCE(t.is_default OR (s.plan_type <> 'trial' AND s.current_period_end IS NULL), false),
    'features', public.tenant_features(_tenant),
    'addons', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('addon', a.addon_name, 'expires_at', a.expires_at,
                                          'purchased_at', a.purchased_at)
                       ORDER BY a.addon_name)
        FROM public.tenant_addons a
       WHERE a.tenant_id = _tenant AND a.status = 'active'
         AND (a.expires_at IS NULL OR a.expires_at > now())), '[]'::jsonb));
END $$;

-- מוצרים: כמו בחלק 13, אבל "מוצר דיגיטלי" / וריאציות לפי החבילה + התוספים
CREATE OR REPLACE FUNCTION public.enforce_plan_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f jsonb := public.tenant_features(NEW.tenant_id);
  _max integer := NULLIF(_f ->> 'max_products', '')::integer;
  _count integer;
BEGIN
  IF TG_OP = 'INSERT' AND _max IS NOT NULL THEN
    -- שתי הוספות במקביל לא יעברו יחד את המגבלה
    PERFORM pg_advisory_xact_lock(hashtextextended('plan-products:' || NEW.tenant_id::text, 7031));
    SELECT count(*) INTO _count FROM public.global_products WHERE tenant_id = NEW.tenant_id;
    IF _count >= _max THEN
      RAISE EXCEPTION 'בחבילה הבסיסית אפשר עד % מוצרים. מוצרים ללא הגבלה זמינים בחבילת פרימיום ("המנוי שלי" בפאנל הניהול).',
        to_char(_max, 'FM9,999') USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF COALESCE(NEW.is_digital, false)
     AND (TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_digital, false))
     AND NOT COALESCE((_f ->> 'digital')::boolean, false) THEN
    RAISE EXCEPTION 'מכירת מוצרים דיגיטליים זמינה בחבילת פרימיום או עם התוסף "מכירת מוצרים דיגיטליים"'
      USING ERRCODE = 'check_violation';
  END IF;

  IF jsonb_array_length(COALESCE(NEW.variant_attributes, '[]'::jsonb)) > 0
     AND (TG_OP = 'INSERT' OR NEW.variant_attributes IS DISTINCT FROM OLD.variant_attributes)
     AND NOT COALESCE((_f ->> 'variants')::boolean, false) THEN
    RAISE EXCEPTION 'ניהול וריאציות (צבעים / מידות) זמין בחבילת פרימיום' USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(cardinality(NEW.colors), 0) > 0
     AND (TG_OP = 'INSERT' OR NEW.colors IS DISTINCT FROM OLD.colors)
     AND NOT COALESCE((_f ->> 'variants')::boolean, false) THEN
    RAISE EXCEPTION 'ניהול וריאציות (נפח / טעם / סוג) זמין בחבילת פרימיום' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- דומיין אישי חדש: חבילת פרימיום או התוסף "חיבור דומיין פרטי"
CREATE OR REPLACE FUNCTION public.enforce_plan_custom_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.custom_domain IS NOT NULL
     AND NEW.custom_domain IS DISTINCT FROM OLD.custom_domain
     AND NOT public.tenant_has_feature(NEW.id, 'custom_domain') THEN
    RAISE EXCEPTION 'חיבור דומיין אישי זמין בחבילת פרימיום או עם התוסף "חיבור דומיין פרטי"'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 5. חיוב יחסי (Proration)
-- ============================================================
-- הצעת מחיר לתוסף בחנות מסוימת:
-- { addon, title, billing, price, available, included, owned, can_buy, reason,
--   amount, days_remaining, period_end, daily_rate, plan }
-- תוסף חודשי בחבילה הבסיסית: price × 12 / 365 × ימים עד current_period_end
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

  IF NOT c.available THEN
    _reason := 'בקרוב — ממתין לאישור חברות אשראי';
  ELSIF _owned THEN
    _reason := 'התוסף כבר פעיל בחנות';
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

-- מנהל החנות: הצעת מחיר לתוסף בחנות שלו
CREATE OR REPLACE FUNCTION public.addon_quote(_addon text)
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
    RAISE EXCEPTION 'רק מנהל החנות יכול לרכוש תוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  RETURN public.addon_quote_for(_tenant, _addon);
END $$;
REVOKE ALL ON FUNCTION public.addon_quote(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_quote(text) TO authenticated, service_role;

-- מנהל החנות: חנות התוספים — הקטלוג עם הצעת מחיר לכל תוסף + המנוי
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

-- מנהל החנות: רכישת תוסף. _expected = הסכום שהוצג לו — אם המחיר השתנה
-- בינתיים (למשל עבר יום) הרכישה נעצרת ומבקשים לאשר מחדש.
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
  -- רכישה אחת בכל פעם לחנות (גם בלחיצה כפולה)
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

  -- רכישה קודמת שפגה — נסגרת (רק אחת פעילה מכל סוג)
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

-- ============================================================
-- 6. סנכרון החידוש: המנוי הראשי הוארך → התוספים החודשיים שמסונכרנים אליו
--    (פגים בסוף התקופה הקודמת) מוארכים לאותו תאריך
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_subscriptions_sync_addons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.current_period_end IS NOT NULL
     AND OLD.current_period_end IS NOT NULL
     AND NEW.current_period_end > OLD.current_period_end THEN
    UPDATE public.tenant_addons a
       SET expires_at = NEW.current_period_end
      FROM public.platform_addons c
     WHERE c.addon_name = a.addon_name
       AND c.billing = 'monthly'
       AND a.tenant_id = NEW.tenant_id
       AND a.status = 'active'
       AND a.expires_at IS NOT NULL
       AND a.expires_at >= OLD.current_period_end - interval '1 day'
       AND a.expires_at < NEW.current_period_end;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tenant_subscriptions_sync_addons ON public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_sync_addons
AFTER UPDATE OF current_period_end ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.tenant_subscriptions_sync_addons();

-- ============================================================
-- 7. "המנוי שלי" והיסטוריית הפלטפורמה — עם התוספים וסטטוס התשלום
-- ============================================================
CREATE OR REPLACE FUNCTION public.billing_history_json(_tenant uuid, _with_email boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', h.id, 'kind', h.kind, 'plan_type', h.plan_type, 'amount', h.amount,
           'months', h.months, 'days', h.days, 'payment_method', h.payment_method,
           'period_start', h.period_start, 'period_end', h.period_end,
           'reference', h.reference, 'note', h.note, 'created_at', h.created_at,
           'addon_name', h.addon_name, 'payment_status', h.payment_status, 'paid_at', h.paid_at,
           'recorded_by_email', CASE WHEN _with_email THEN h.recorded_by_email END)
         ORDER BY h.created_at DESC), '[]'::jsonb)
    FROM public.billing_history h
   WHERE h.tenant_id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.billing_history_json(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_history_json(uuid, boolean) TO service_role;

-- כל התוספים של חנות (כולל שבוטלו / פגו) — לפאנל הפלטפורמה
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
           'amount', a.amount, 'source', a.source, 'purchased_at', a.purchased_at,
           'canceled_at', a.canceled_at, 'ended_reason', a.ended_reason)
         ORDER BY (a.status = 'active') DESC, a.purchased_at DESC), '[]'::jsonb)
    FROM public.tenant_addons a
    JOIN public.platform_addons c ON c.addon_name = a.addon_name
   WHERE a.tenant_id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.tenant_addons_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_addons_json(uuid) TO service_role;

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
    'addons', public.tenant_addons_json(_tenant));
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_billing_history(_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN jsonb_build_object(
    'subscription', public.tenant_subscription_state(_tenant),
    'history', public.billing_history_json(_tenant, true),
    'addons', public.tenant_addons_json(_tenant));
END $$;
REVOKE ALL ON FUNCTION public.platform_billing_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing_history(uuid) TO authenticated, service_role;

-- ============================================================
-- 8. מנהל הפלטפורמה: הפעלה / ביטול תוסף, סימון חיוב כשולם
-- ============================================================

-- הפעלת תוסף בלי רכישה (מתנה / תשלום שנגבה בטלפון). חודשי — עד סוף המנוי
CREATE OR REPLACE FUNCTION public.platform_grant_addon(_tenant uuid, _addon text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  c public.platform_addons;
  s public.tenant_subscriptions;
  _end timestamptz;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להפעיל תוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO c FROM public.platform_addons WHERE addon_name = lower(btrim(COALESCE(_addon, '')));
  IF c.addon_name IS NULL THEN
    RAISE EXCEPTION 'תוסף לא מוכר: %', _addon USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  IF public.tenant_addon_active(_tenant, c.addon_name) THEN
    RAISE EXCEPTION 'התוסף כבר פעיל בחנות' USING ERRCODE = 'check_violation';
  END IF;
  _end := CASE WHEN c.billing = 'monthly' THEN
            CASE WHEN s.plan_type = 'trial' THEN s.trial_ends_at ELSE s.current_period_end END
          END;
  IF _end IS NOT NULL AND _end <= now() THEN
    RAISE EXCEPTION 'המנוי של החנות פג — חדשו אותו לפני הפעלת תוסף' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.tenant_addons
     SET status = 'canceled', canceled_at = now(), ended_reason = 'expired'
   WHERE tenant_id = _tenant AND addon_name = c.addon_name AND status = 'active';
  INSERT INTO public.tenant_addons (tenant_id, addon_name, status, expires_at, amount, source, purchased_by)
  VALUES (_tenant, c.addon_name, 'active', _end, 0, 'grant', auth.uid());

  RETURN public.tenant_addons_json(_tenant);
END $$;
REVOKE ALL ON FUNCTION public.platform_grant_addon(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_grant_addon(uuid, text) TO authenticated, service_role;

-- ביטול תוסף — הפיצ'ר נסגר מיד (מה שכבר נוצר בחנות לא נמחק)
CREATE OR REPLACE FUNCTION public.platform_cancel_addon(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לבטל תוספים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.tenant_addons
     SET status = 'canceled', canceled_at = now(), ended_reason = 'canceled'
   WHERE id = _id AND status = 'active'
  RETURNING tenant_id INTO _tenant;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'התוסף לא נמצא או שכבר בוטל';
  END IF;
  RETURN public.tenant_addons_json(_tenant);
END $$;
REVOKE ALL ON FUNCTION public.platform_cancel_addon(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_cancel_addon(uuid) TO authenticated, service_role;

-- חיוב "ממתין לתשלום" → שולם
CREATE OR REPLACE FUNCTION public.platform_mark_billing_paid(_id uuid, _reference text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.billing_history
     SET payment_status = 'paid', paid_at = now(),
         reference = COALESCE(NULLIF(left(btrim(COALESCE(_reference, '')), 120), ''), reference)
   WHERE id = _id AND payment_status = 'due';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החיוב לא נמצא או שכבר סומן כשולם';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_mark_billing_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_mark_billing_paid(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 9. התראה למנהלי הפלטפורמה על רכישת תוסף (לגבייה) — צד שרת
-- ============================================================
CREATE OR REPLACE FUNCTION public.addon_purchase_notify_targets(_tenant uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT jsonb_build_object(
    'tenant_id', t.id,
    'store_name', COALESCE(NULLIF(btrim(ss.business_name), ''), t.name),
    'store_slug', t.slug,
    'owner_email', t.owner_email,
    'platform_emails', COALESCE((
      SELECT jsonb_agg(DISTINCT lower(u.email::text))
        FROM public.platform_admins pa JOIN auth.users u ON u.id = pa.user_id
       WHERE u.email IS NOT NULL), '[]'::jsonb))
    FROM public.tenants t
    LEFT JOIN public.site_settings ss ON ss.tenant_id = t.id
   WHERE t.id = _tenant;
$$;
REVOKE ALL ON FUNCTION public.addon_purchase_notify_targets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.addon_purchase_notify_targets(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- חלק 13: מנויים (SaaS Billing) ומערכת תמיכה בצ'אט (Helpdesk)
--
-- מנויים:
--   • tenant_subscriptions — מנוי אחד לכל חנות: plan_type (trial / basic /
--     premium), status (trialing / active / canceled), trial_ends_at,
--     current_period_end. זה מקור האמת; tenants.plan הוא שיקוף לתצוגה.
--     חנות חדשה מקבלת אוטומטית ניסיון של 14 יום.
--     תשלום / הארכה נרשמים ע"י מנהל הפלטפורמה (אין סליקה באתר).
--   • billing_history — כל תשלום שתועד, הארכת ניסיון ושינוי חבילה.
--   • "פעיל" = לא בוטל, ותאריך הסיום (ניסיון: trial_ends_at; חבילה בתשלום:
--     current_period_end) עוד לא עבר. חבילה בתשלום בלי תאריך סיום = ללא
--     תפוגה (החנות הראשית ושער הפלטפורמה). החנות הראשית תמיד פעילה.
--   • חנות שהמנוי שלה פג: האתר נעול ללקוחות ופאנל הניהול נעול (חוץ מ"המנוי
--     שלי" ו"תמיכה ועזרה") — באפליקציה; במסד: אי אפשר ליצור הזמנות.
--
-- חבילות ופיצ'רים (plan_features):
--   • basic — עד 1,000 מוצרים; בלי דומיין אישי, וריאציות, מוצר דיגיטלי,
--     התחברות לקוחות עם Google, ותמיכת VIP.
--   • premium / trial — הכל פתוח.
--   נאכף גם במסד (טריגרים): מוצר חדש מעבר למגבלה, הפיכת מוצר לדיגיטלי,
--   הוספת וריאציות, חיבור דומיין אישי. מה שכבר קיים בחנות שירדה לבסיסית
--   לא נמחק — רק תוספות חדשות נחסמות.
--
-- תמיכה:
--   • support_tickets (פנייה) + support_messages (הודעות: sender_type =
--     tenant / admin). סטטוס: open (ממתין לנו) / answered (ענינו, ממתין
--     ללקוח) / closed. מעקב "נקרא" לכל צד.
--   • הכל דרך פונקציות במסד (SECURITY DEFINER) שבודקות מי הקורא: מנהל
--     החנות של הפנייה, או מנהל-על. לטבלאות עצמן אין גישה ישירה.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. tenants.plan: trial / basic / premium (pro + enterprise → premium)
-- ============================================================
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
UPDATE public.tenants SET plan = 'premium' WHERE plan IN ('pro', 'enterprise');
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('trial', 'basic', 'premium'));
COMMENT ON COLUMN public.tenants.plan IS
  'שיקוף של tenant_subscriptions.plan_type (trial / basic / premium) — מקור האמת הוא טבלת המנויים';

-- ============================================================
-- 2. מנויים
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  tenant_id          UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_type          TEXT NOT NULL DEFAULT 'trial'
                     CHECK (plan_type IN ('trial', 'basic', 'premium')),
  -- trialing: בניסיון | active: חבילה בתשלום | canceled: בוטל ידנית
  status             TEXT NOT NULL DEFAULT 'trialing'
                     CHECK (status IN ('trialing', 'active', 'canceled')),
  trial_ends_at      TIMESTAMPTZ,
  -- סוף התקופה ששולמה; NULL בחבילה בתשלום = ללא תפוגה (חנויות מערכת)
  current_period_end TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenant_subscriptions_trial_end_check
    CHECK (plan_type <> 'trial' OR trial_ends_at IS NOT NULL)
);
COMMENT ON TABLE public.tenant_subscriptions IS 'המנוי של כל חנות (חלק 13) — מתעדכן רק ע"י מנהל הפלטפורמה';

CREATE TABLE IF NOT EXISTS public.billing_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- payment: תשלום שתועד | trial_extension: הארכת ניסיון / תקופה | plan_change: שינוי חבילה
  kind              TEXT NOT NULL DEFAULT 'payment'
                    CHECK (kind IN ('payment', 'trial_extension', 'plan_change')),
  plan_type         TEXT NOT NULL CHECK (plan_type IN ('trial', 'basic', 'premium')),
  amount            NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount <= 1000000),
  currency          TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  months            INTEGER CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  days              INTEGER CHECK (days IS NULL OR days BETWEEN 1 AND 365),
  -- annual: מראש לשנה | installments: 12 תשלומים | monthly: חודשי | other: אחר
  payment_method    TEXT CHECK (payment_method IS NULL
                                OR payment_method IN ('annual', 'installments', 'monthly', 'other')),
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  reference         TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  note              TEXT CHECK (note IS NULL OR length(note) <= 500),
  recorded_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start)
);
CREATE INDEX IF NOT EXISTS billing_history_tenant_idx
  ON public.billing_history (tenant_id, created_at DESC);
COMMENT ON TABLE public.billing_history IS 'היסטוריית מנוי: תשלומים שתועדו, הארכות ושינויי חבילה';

-- ============================================================
-- 3. תמיכה
-- ============================================================
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subject           TEXT NOT NULL CHECK (length(btrim(subject)) BETWEEN 2 AND 120),
  -- open: ממתין למענה שלנו | answered: ענינו, ממתין ללקוח | closed: סגור
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'answered', 'closed')),
  opened_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_by_email   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sender_type  TEXT CHECK (last_sender_type IS NULL OR last_sender_type IN ('tenant', 'admin')),
  -- עד מתי כל צד קרא (הודעות של הצד השני אחרי זה = לא נקראו)
  tenant_read_at    TIMESTAMPTZ,
  admin_read_at     TIMESTAMPTZ,
  -- התראות מייל אחרונות (כדי לא להציף: מייל אחד לכל סבב / 10 דקות)
  admin_notified_at  TIMESTAMPTZ,
  tenant_notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx
  ON public.support_tickets (tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('tenant', 'admin')),
  sender_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name TEXT CHECK (sender_name IS NULL OR length(sender_name) <= 120),
  message     TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 4000),
  -- clock_timestamp: סדר נכון גם לכמה הודעות באותה טרנזקציה
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx
  ON public.support_messages (ticket_id, created_at);

-- ההודעה תמיד בחנות של הפנייה (לא סומכים על מה שנשלח)
CREATE OR REPLACE FUNCTION public.support_messages_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT t.tenant_id INTO NEW.tenant_id FROM public.support_tickets t WHERE t.id = NEW.ticket_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS support_messages_tenant ON public.support_messages;
CREATE TRIGGER support_messages_tenant
BEFORE INSERT OR UPDATE OF ticket_id ON public.support_messages
FOR EACH ROW EXECUTE FUNCTION public.support_messages_tenant();

-- ============================================================
-- 4. הרשאות: בידוד חנויות (כמו בכל טבלה עם tenant_id) + גישה רק דרך פונקציות
-- ============================================================
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['tenant_subscriptions', 'billing_history', 'support_tickets', 'support_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', _t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public '
      'USING (tenant_id = (SELECT public.current_tenant_id())) '
      'WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', _t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', _t);
  END LOOP;
END $$;

-- מנהל החנות קורא את המנוי ואת היסטוריית התשלומים של החנות שלו
GRANT SELECT ON public.tenant_subscriptions, public.billing_history TO authenticated;
DROP POLICY IF EXISTS "store admin reads subscription" ON public.tenant_subscriptions;
CREATE POLICY "store admin reads subscription" ON public.tenant_subscriptions
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "store admin reads billing history" ON public.billing_history;
CREATE POLICY "store admin reads billing history" ON public.billing_history
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

-- ============================================================
-- 5. מצב המנוי והפיצ'רים
-- ============================================================

-- הפיצ'רים של כל חבילה (זהה ל-PLAN_FEATURES ב-src/lib/subscription.ts)
CREATE OR REPLACE FUNCTION public.plan_features(_plan text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN _plan = 'basic' THEN
    jsonb_build_object('max_products', 1000, 'custom_domain', false, 'variants', false,
                       'digital', false, 'google_login', false, 'vip_support', false)
  ELSE
    jsonb_build_object('max_products', NULL, 'custom_domain', true, 'variants', true,
                       'digital', true, 'google_login', true, 'vip_support', true)
  END;
$$;

-- מצב המנוי של חנות:
-- { plan, status, trial_ends_at, current_period_end, ends_at, active, unlimited,
--   days_left, system, features }
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
    'features', public.plan_features(_plan));
END $$;

CREATE OR REPLACE FUNCTION public.tenant_subscription_active(_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.tenant_subscription_state(_tenant) ->> 'active')::boolean, true);
$$;

CREATE OR REPLACE FUNCTION public.tenant_has_feature(_tenant uuid, _feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.plan_features(
           COALESCE((SELECT s.plan_type FROM public.tenant_subscriptions s WHERE s.tenant_id = _tenant),
                    'trial')) ->> _feature)::boolean, false);
$$;

REVOKE ALL ON FUNCTION public.tenant_subscription_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_subscription_active(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_has_feature(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_subscription_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_subscription_active(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_has_feature(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_features(text) TO authenticated, service_role;

-- ============================================================
-- 6. tenants.plan = שיקוף של המנוי; חנות חדשה = 14 ימי ניסיון
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_subscriptions_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_subscriptions_touch ON public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_touch
BEFORE UPDATE ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.tenant_subscriptions_sync();

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_mirror_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tenants SET plan = NEW.plan_type
   WHERE id = NEW.tenant_id AND plan IS DISTINCT FROM NEW.plan_type;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS tenant_subscriptions_mirror_plan ON public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_mirror_plan
AFTER INSERT OR UPDATE OF plan_type ON public.tenant_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.tenant_subscriptions_mirror_plan();

-- חנות חדשה: הגדרות (כמו קודם) + מנוי ניסיון ל-14 יום
CREATE OR REPLACE FUNCTION public.tenants_seed_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (NEW.id, NEW.name, '')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.shipping_methods m WHERE m.tenant_id = NEW.id) THEN
    INSERT INTO public.shipping_methods (tenant_id, name, description, kind, price, sort_order)
    VALUES (NEW.id, 'איסוף עצמי', '', 'pickup', 0, 0);
  END IF;
  INSERT INTO public.tenant_subscriptions (tenant_id, plan_type, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', now() + interval '14 days')
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

-- חנויות קיימות:
--  • החנות הראשית ושער הפלטפורמה (nuriel-app2) — פרימיום ללא תפוגה
--  • כל השאר — לפי החבילה שהייתה להן, עם 14 יום מעכשיו (ניסיון: עד סוף
--    הניסיון; בסיסי / פרימיום: עד שמנהל הפלטפורמה יתעד תשלום)
INSERT INTO public.tenant_subscriptions (tenant_id, plan_type, status, trial_ends_at, current_period_end)
SELECT t.id,
       CASE WHEN t.is_default OR t.slug = 'nuriel-app2' THEN 'premium'
            WHEN t.plan IN ('basic', 'premium') THEN t.plan
            ELSE 'trial' END,
       CASE WHEN t.is_default OR t.slug = 'nuriel-app2' OR t.plan IN ('basic', 'premium')
            THEN 'active' ELSE 'trialing' END,
       CASE WHEN NOT (t.is_default OR t.slug = 'nuriel-app2') AND t.plan NOT IN ('basic', 'premium')
            THEN now() + interval '14 days' END,
       CASE WHEN t.is_default OR t.slug = 'nuriel-app2' THEN NULL
            WHEN t.plan IN ('basic', 'premium') THEN now() + interval '14 days' END
  FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================================
-- 7. אכיפה במסד: חבילה בסיסית + חנות שפג תוקפה
-- ============================================================

-- מוצרים: מגבלת כמות, מוצר דיגיטלי, וריאציות (מאפיינים על המוצר, וגם
-- האפשרויות הפשוטות "נפח / טעם / סוג" — עמודת colors)
CREATE OR REPLACE FUNCTION public.enforce_plan_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f jsonb := public.plan_features(
    COALESCE((SELECT s.plan_type FROM public.tenant_subscriptions s WHERE s.tenant_id = NEW.tenant_id),
             'trial'));
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
    RAISE EXCEPTION 'מכירת מוצרים דיגיטליים זמינה בחבילת פרימיום' USING ERRCODE = 'check_violation';
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
DROP TRIGGER IF EXISTS enforce_plan_products ON public.global_products;
CREATE TRIGGER enforce_plan_products
BEFORE INSERT OR UPDATE OF is_digital, variant_attributes, colors ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_products();

-- צירופי וריאציות חדשים
CREATE OR REPLACE FUNCTION public.enforce_plan_variants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tenant_has_feature(NEW.tenant_id, 'variants') THEN
    RAISE EXCEPTION 'ניהול וריאציות (צבעים / מידות) זמין בחבילת פרימיום' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_plan_variants ON public.product_variants;
CREATE TRIGGER enforce_plan_variants
BEFORE INSERT ON public.product_variants
FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_variants();

-- דומיין אישי חדש (דומיין שכבר מחובר ממשיך לעבוד גם אחרי ירידה לבסיסית)
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
    RAISE EXCEPTION 'חיבור דומיין אישי זמין בחבילת פרימיום' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_plan_custom_domain ON public.tenants;
CREATE TRIGGER enforce_plan_custom_domain
BEFORE UPDATE OF custom_domain ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.enforce_plan_custom_domain();

-- חנות שפג תוקף המנוי שלה — לא מקבלת הזמנות (גם לא דרך ה-API ישירות)
CREATE OR REPLACE FUNCTION public.enforce_subscription_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.tenant_subscription_active(NEW.tenant_id) THEN
    RAISE EXCEPTION 'החנות אינה פעילה כרגע ולא ניתן לבצע הזמנות' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_subscription_orders ON public.orders;
CREATE TRIGGER enforce_subscription_orders
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_orders();

-- ============================================================
-- 8. מנהל החנות: המנוי שלי
-- ============================================================
-- { subscription: <tenant_subscription_state>, product_count, history: [...] }
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
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'kind', h.kind, 'plan_type', h.plan_type, 'amount', h.amount,
               'months', h.months, 'days', h.days, 'payment_method', h.payment_method,
               'period_start', h.period_start, 'period_end', h.period_end,
               'reference', h.reference, 'note', h.note, 'created_at', h.created_at)
             ORDER BY h.created_at DESC)
        FROM public.billing_history h
       WHERE h.tenant_id = _tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.store_billing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_billing() TO authenticated, service_role;

-- ============================================================
-- 9. מנהל הפלטפורמה: הארכה, תיעוד תשלום, שינוי חבילה, היסטוריה
-- ============================================================

-- הארכת ניסיון (או התקופה הנוכחית בחבילה בתשלום) ב-N ימים, מהיום או מסוף
-- התקופה — המאוחר מביניהם
CREATE OR REPLACE FUNCTION public.platform_extend_trial(_tenant uuid, _days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  s public.tenant_subscriptions;
  _from timestamptz;
  _to timestamptz;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להאריך מנויים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _days IS NULL OR _days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'מספר הימים: 1 עד 365' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;

  IF s.plan_type = 'trial' THEN
    _from := GREATEST(COALESCE(s.trial_ends_at, now()), now());
    _to := _from + make_interval(days => _days);
    UPDATE public.tenant_subscriptions
       SET trial_ends_at = _to, status = 'trialing'
     WHERE tenant_id = _tenant;
  ELSE
    IF s.current_period_end IS NULL THEN
      RAISE EXCEPTION 'לחנות הזו אין תאריך תפוגה — אין מה להאריך' USING ERRCODE = 'check_violation';
    END IF;
    _from := GREATEST(s.current_period_end, now());
    _to := _from + make_interval(days => _days);
    UPDATE public.tenant_subscriptions
       SET current_period_end = _to, status = 'active'
     WHERE tenant_id = _tenant;
  END IF;

  INSERT INTO public.billing_history
         (tenant_id, kind, plan_type, amount, days, period_start, period_end,
          recorded_by, recorded_by_email)
  VALUES (_tenant, 'trial_extension', s.plan_type, 0, _days, _from, _to,
          auth.uid(), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()));

  RETURN public.tenant_subscription_state(_tenant);
END $$;
REVOKE ALL ON FUNCTION public.platform_extend_trial(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_extend_trial(uuid, integer) TO authenticated, service_role;

-- תיעוד תשלום: נשמר בהיסטוריה, החבילה מתעדכנת, והתקופה מתחילה מהיום — או
-- מסוף התקופה הנוכחית כשמחדשים את אותה חבילה לפני שפגה
CREATE OR REPLACE FUNCTION public.platform_record_payment(
  _tenant uuid,
  _plan text,
  _amount numeric,
  _months integer DEFAULT 12,
  _method text DEFAULT 'annual',
  _reference text DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _p text := lower(btrim(COALESCE(_plan, '')));
  _m text := lower(btrim(COALESCE(_method, 'annual')));
  s public.tenant_subscriptions;
  _from timestamptz;
  _to timestamptz;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לתעד תשלומים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _p NOT IN ('basic', 'premium') THEN
    RAISE EXCEPTION 'חבילה לא מוכרת: % (בסיסית / פרימיום)', _p USING ERRCODE = 'check_violation';
  END IF;
  IF _amount IS NULL OR _amount < 0 OR _amount > 1000000 THEN
    RAISE EXCEPTION 'סכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _months IS NULL OR _months NOT BETWEEN 1 AND 36 THEN
    RAISE EXCEPTION 'מספר החודשים: 1 עד 36' USING ERRCODE = 'check_violation';
  END IF;
  IF _m NOT IN ('annual', 'installments', 'monthly', 'other') THEN
    RAISE EXCEPTION 'אמצעי תשלום לא מוכר' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;

  _from := CASE
    WHEN s.plan_type = _p AND s.status <> 'canceled' AND s.current_period_end > now()
      THEN s.current_period_end
    ELSE now()
  END;
  _to := _from + make_interval(months => _months);

  UPDATE public.tenant_subscriptions
     SET plan_type = _p, status = 'active', current_period_end = _to
   WHERE tenant_id = _tenant;

  INSERT INTO public.billing_history
         (tenant_id, kind, plan_type, amount, months, payment_method, period_start, period_end,
          reference, note, recorded_by, recorded_by_email)
  VALUES (_tenant, 'payment', _p, round(_amount, 2), _months, _m, _from, _to,
          NULLIF(left(btrim(COALESCE(_reference, '')), 120), ''),
          NULLIF(left(btrim(COALESCE(_note, '')), 500), ''),
          auth.uid(), (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()));

  RETURN public.tenant_subscription_state(_tenant);
END $$;
REVOKE ALL ON FUNCTION public.platform_record_payment(uuid, text, numeric, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_record_payment(uuid, text, numeric, integer, text, text, text)
  TO authenticated, service_role;

-- שינוי חבילה בלי תשלום (הפונקציה הקיימת מחלק 2 — עכשיו על המנוי).
-- מעבר לניסיון שפג → 14 יום מהיום; מעבר מניסיון לחבילה בתשלום שומר את
-- תאריך הסיום (לא "ללא תפוגה").
CREATE OR REPLACE FUNCTION public.platform_set_tenant_plan(_tenant uuid, _plan text)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _p text := lower(btrim(COALESCE(_plan, '')));
  s public.tenant_subscriptions;
  t public.tenants;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לשנות מנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _p = 'pro' OR _p = 'enterprise' THEN
    _p := 'premium';
  END IF;
  IF _p NOT IN ('trial', 'basic', 'premium') THEN
    RAISE EXCEPTION 'סוג מנוי לא מוכר: %', _p USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM public.tenant_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;

  IF _p = 'trial' THEN
    UPDATE public.tenant_subscriptions
       SET plan_type = 'trial', status = 'trialing',
           trial_ends_at = CASE WHEN s.trial_ends_at IS NULL OR s.trial_ends_at <= now()
                                THEN now() + interval '14 days' ELSE s.trial_ends_at END
     WHERE tenant_id = _tenant;
  ELSE
    UPDATE public.tenant_subscriptions
       SET plan_type = _p, status = 'active',
           current_period_end = CASE
             WHEN s.plan_type = 'trial' THEN GREATEST(s.trial_ends_at, now())
             ELSE s.current_period_end END
     WHERE tenant_id = _tenant;
  END IF;

  IF s.plan_type IS DISTINCT FROM _p THEN
    INSERT INTO public.billing_history
           (tenant_id, kind, plan_type, amount, recorded_by, recorded_by_email, note)
    VALUES (_tenant, 'plan_change', _p, 0, auth.uid(),
            (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
            format('שינוי חבילה: %s → %s', s.plan_type, _p));
  END IF;

  SELECT * INTO t FROM public.tenants WHERE id = _tenant;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_tenant_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tenant_plan(uuid, text) TO authenticated, service_role;

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
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', h.id, 'kind', h.kind, 'plan_type', h.plan_type, 'amount', h.amount,
               'months', h.months, 'days', h.days, 'payment_method', h.payment_method,
               'period_start', h.period_start, 'period_end', h.period_end,
               'reference', h.reference, 'note', h.note, 'created_at', h.created_at,
               'recorded_by_email', h.recorded_by_email)
             ORDER BY h.created_at DESC)
        FROM public.billing_history h
       WHERE h.tenant_id = _tenant), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.platform_billing_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing_history(uuid) TO authenticated, service_role;

-- רשימת החנויות בפאנל — עם מצב המנוי ופניות התמיכה הפתוחות
DROP FUNCTION IF EXISTS public.platform_list_tenants();
CREATE FUNCTION public.platform_list_tenants()
RETURNS TABLE(id uuid, slug text, name text, domain text, is_default boolean,
              created_at timestamptz, owner_email text, tax_id text, plan text,
              status text, status_changed_at timestamptz,
              admins integer, customers integer, products integer, orders integer,
              ssl_host text, ssl_status text, ssl_issued_at timestamptz,
              ssl_expires_at timestamptz, ssl_error text, ssl_checked_at timestamptz,
              ssl_renew_requested_at timestamptz,
              sub_plan text, sub_status text, sub_trial_ends_at timestamptz,
              sub_period_end timestamptz, sub_ends_at timestamptz, sub_active boolean,
              open_tickets integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.domain, t.is_default, t.created_at,
         t.owner_email, t.tax_id, t.plan, t.status, t.status_changed_at,
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'admin'),
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'customer'),
         (SELECT count(*)::int FROM public.global_products gp WHERE gp.tenant_id = t.id),
         (SELECT count(*)::int FROM public.orders o WHERE o.tenant_id = t.id),
         s.host, s.status, s.issued_at, s.expires_at, s.last_error, s.checked_at,
         s.renew_requested_at,
         st ->> 'plan', st ->> 'status',
         (st ->> 'trial_ends_at')::timestamptz, (st ->> 'current_period_end')::timestamptz,
         (st ->> 'ends_at')::timestamptz, (st ->> 'active')::boolean,
         (SELECT count(*)::int FROM public.support_tickets tk
           WHERE tk.tenant_id = t.id AND tk.status = 'open')
    FROM public.tenants t
    LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id
    CROSS JOIN LATERAL (SELECT public.tenant_subscription_state(t.id) AS st) sub
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY t.is_default DESC, t.created_at;
$$;
REVOKE ALL ON FUNCTION public.platform_list_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_tenants() TO authenticated, service_role;

-- ============================================================
-- 10. תמיכה: פונקציות
-- ============================================================

-- מאיזה צד הקורא בפנייה של חנות מסוימת:
--  'tenant' — מנהל של החנות (בחנות הנוכחית)
--  'admin'  — מנהל-על שאינו רשום בחנות הזו
--  NULL     — אין גישה
CREATE OR REPLACE FUNCTION public.support_side(_ticket_tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN public.is_platform_admin(auth.uid())
         AND NOT EXISTS (SELECT 1 FROM public.user_roles ur
                          WHERE ur.user_id = auth.uid() AND ur.tenant_id = _ticket_tenant)
      THEN 'admin'
    WHEN _ticket_tenant = public.current_tenant_id() AND public.is_admin(auth.uid()) THEN 'tenant'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.support_side(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_side(uuid) TO authenticated, service_role;

-- שם להצגה ליד ההודעה
CREATE OR REPLACE FUNCTION public.support_sender_name(_side text, _tenant uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT CASE WHEN _side = 'admin' THEN 'צוות התמיכה'
         ELSE COALESCE(
           (SELECT NULLIF(btrim(cp.contact_name), '') FROM public.customer_profiles cp
             WHERE cp.user_id = auth.uid()),
           (SELECT NULLIF(btrim(ur.display_name), '') FROM public.user_roles ur
             WHERE ur.user_id = auth.uid()),
           (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()),
           'מנהל החנות')
         END;
$$;
REVOKE ALL ON FUNCTION public.support_sender_name(text, uuid) FROM PUBLIC, anon, authenticated;

-- פנייה + הודעה במבנה JSON אחיד
CREATE OR REPLACE FUNCTION public.support_ticket_json(tk public.support_tickets, _side text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', tk.id,
    'tenant_id', tk.tenant_id,
    'store_name', COALESCE(NULLIF(btrim(ss.business_name), ''), t.name),
    'store_slug', t.slug,
    'plan', COALESCE(sub.plan_type, 'trial'),
    'subject', tk.subject,
    'status', tk.status,
    'opened_by_email', tk.opened_by_email,
    'created_at', tk.created_at,
    'last_message_at', tk.last_message_at,
    'last_sender_type', tk.last_sender_type,
    'unread', (SELECT count(*)::int FROM public.support_messages m
                WHERE m.ticket_id = tk.id
                  AND m.sender_type <> COALESCE(_side, 'tenant')
                  AND m.created_at > COALESCE(CASE WHEN _side = 'admin' THEN tk.admin_read_at
                                                   ELSE tk.tenant_read_at END, '-infinity')),
    'preview', (SELECT left(m.message, 140) FROM public.support_messages m
                 WHERE m.ticket_id = tk.id ORDER BY m.created_at DESC LIMIT 1))
    FROM public.tenants t
    LEFT JOIN public.site_settings ss ON ss.tenant_id = t.id
    LEFT JOIN public.tenant_subscriptions sub ON sub.tenant_id = t.id
   WHERE t.id = tk.tenant_id;
$$;
REVOKE ALL ON FUNCTION public.support_ticket_json(public.support_tickets, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.support_message_json(m public.support_messages)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'ticket_id', m.ticket_id, 'sender_type', m.sender_type,
    'sender_name', m.sender_name, 'message', m.message, 'created_at', m.created_at);
$$;
REVOKE ALL ON FUNCTION public.support_message_json(public.support_messages) FROM PUBLIC, anon, authenticated;

-- מנהל החנות: הפניות של החנות שלו (פתוחות קודם, החדשות למעלה)
CREATE OR REPLACE FUNCTION public.support_my_tickets()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF _tenant IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לפתוח פניות תמיכה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.support_ticket_json(tk, 'tenant')
                     ORDER BY (tk.status = 'closed'), tk.last_message_at DESC)
      FROM public.support_tickets tk
     WHERE tk.tenant_id = _tenant), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.support_my_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_my_tickets() TO authenticated, service_role;

-- כמה פניות יש בהן תשובה שלא נקראה (התג בתפריט "תמיכה ועזרה")
CREATE OR REPLACE FUNCTION public.support_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN NOT public.is_admin(auth.uid()) THEN 0 ELSE (
    SELECT count(*)::int FROM public.support_tickets tk
     WHERE tk.tenant_id = public.current_tenant_id()
       AND tk.last_sender_type = 'admin'
       AND tk.last_message_at > COALESCE(tk.tenant_read_at, '-infinity')) END;
$$;
REVOKE ALL ON FUNCTION public.support_unread_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_unread_count() TO authenticated, service_role;

-- פתיחת פנייה חדשה (נושא + הודעה ראשונה) ע"י מנהל החנות
CREATE OR REPLACE FUNCTION public.support_open_ticket(_subject text, _message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _s text := btrim(regexp_replace(COALESCE(_subject, ''), '\s+', ' ', 'g'));
  _m text := btrim(COALESCE(_message, ''));
  tk public.support_tickets;
  msg public.support_messages;
BEGIN
  IF _tenant IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לפתוח פניות תמיכה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_s) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נושא הפנייה: 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_m) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'ההודעה: עד 4,000 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.support_tickets
       WHERE tenant_id = _tenant AND status <> 'closed') >= 20 THEN
    RAISE EXCEPTION 'יש כבר 20 פניות פתוחות — המשיכו באחת מהן או סגרו פניות שטופלו'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.support_tickets
         (tenant_id, subject, status, opened_by, opened_by_email,
          last_message_at, last_sender_type, tenant_read_at)
  VALUES (_tenant, _s, 'open', auth.uid(),
          (SELECT u.email FROM auth.users u WHERE u.id = auth.uid()),
          clock_timestamp(), 'tenant', clock_timestamp())
  RETURNING * INTO tk;

  INSERT INTO public.support_messages (ticket_id, tenant_id, sender_type, sender_id, sender_name, message)
  VALUES (tk.id, _tenant, 'tenant', auth.uid(), public.support_sender_name('tenant', _tenant), _m)
  RETURNING * INTO msg;

  -- התראה למנהל הפלטפורמה: תמיד על פנייה חדשה
  UPDATE public.support_tickets
     SET admin_notified_at = clock_timestamp(),
         last_message_at = msg.created_at,
         tenant_read_at = msg.created_at
   WHERE id = tk.id
  RETURNING * INTO tk;

  RETURN jsonb_build_object(
    'ticket', public.support_ticket_json(tk, 'tenant'),
    'message', public.support_message_json(msg),
    'notify', true);
END $$;
REVOKE ALL ON FUNCTION public.support_open_ticket(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_open_ticket(text, text) TO authenticated, service_role;

-- הודעה בפנייה קיימת — מנהל החנות (tenant) או מנהל-על (admin).
-- notify = לשלוח מייל לצד השני: בתחילת "סבב" (הצד השני כתב אחרון) או אם
-- עברו 10 דקות מההתראה הקודמת.
CREATE OR REPLACE FUNCTION public.support_post_message(_ticket uuid, _message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _m text := btrim(COALESCE(_message, ''));
  tk public.support_tickets;
  msg public.support_messages;
  _side text;
  _notify boolean;
BEGIN
  SELECT * INTO tk FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה';
  END IF;
  _side := public.support_side(tk.tenant_id);
  IF _side IS NULL THEN
    RAISE EXCEPTION 'אין גישה לפנייה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(_m) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'ההודעה: עד 4,000 תווים' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.support_messages (ticket_id, tenant_id, sender_type, sender_id, sender_name, message)
  VALUES (tk.id, tk.tenant_id, _side, auth.uid(), public.support_sender_name(_side, tk.tenant_id), _m)
  RETURNING * INTO msg;

  _notify := CASE WHEN _side = 'tenant'
    THEN tk.last_sender_type IS DISTINCT FROM 'tenant'
         OR tk.admin_notified_at IS NULL OR tk.admin_notified_at < clock_timestamp() - interval '10 minutes'
    ELSE tk.last_sender_type IS DISTINCT FROM 'admin'
         OR tk.tenant_notified_at IS NULL OR tk.tenant_notified_at < clock_timestamp() - interval '10 minutes'
  END;

  UPDATE public.support_tickets
     SET status = CASE WHEN _side = 'tenant' THEN 'open' ELSE 'answered' END,
         last_message_at = msg.created_at,
         last_sender_type = _side,
         updated_at = clock_timestamp(),
         tenant_read_at = CASE WHEN _side = 'tenant' THEN msg.created_at ELSE tenant_read_at END,
         admin_read_at = CASE WHEN _side = 'admin' THEN msg.created_at ELSE admin_read_at END,
         admin_notified_at = CASE WHEN _side = 'tenant' AND _notify THEN clock_timestamp()
                                  ELSE admin_notified_at END,
         tenant_notified_at = CASE WHEN _side = 'admin' AND _notify THEN clock_timestamp()
                                   ELSE tenant_notified_at END
   WHERE id = tk.id
  RETURNING * INTO tk;

  RETURN jsonb_build_object(
    'ticket', public.support_ticket_json(tk, _side),
    'message', public.support_message_json(msg),
    'side', _side,
    'notify', _notify);
END $$;
REVOKE ALL ON FUNCTION public.support_post_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_post_message(uuid, text) TO authenticated, service_role;

-- הפנייה וכל ההודעות; מסמן "נקרא" לצד של הקורא
CREATE OR REPLACE FUNCTION public.support_thread(_ticket uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tk public.support_tickets;
  _side text;
BEGIN
  SELECT * INTO tk FROM public.support_tickets WHERE id = _ticket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה';
  END IF;
  _side := public.support_side(tk.tenant_id);
  IF _side IS NULL THEN
    RAISE EXCEPTION 'אין גישה לפנייה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _side = 'admin' THEN
    UPDATE public.support_tickets SET admin_read_at = clock_timestamp() WHERE id = tk.id RETURNING * INTO tk;
  ELSE
    UPDATE public.support_tickets SET tenant_read_at = clock_timestamp() WHERE id = tk.id RETURNING * INTO tk;
  END IF;

  RETURN jsonb_build_object(
    'ticket', public.support_ticket_json(tk, _side),
    'side', _side,
    'messages', COALESCE((
      SELECT jsonb_agg(public.support_message_json(m) ORDER BY m.created_at, m.id)
        FROM public.support_messages m
       WHERE m.ticket_id = tk.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.support_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_thread(uuid) TO authenticated, service_role;

-- סגירה / פתיחה מחדש (שני הצדדים)
CREATE OR REPLACE FUNCTION public.support_set_status(_ticket uuid, _status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _st text := lower(btrim(COALESCE(_status, '')));
  tk public.support_tickets;
  _side text;
BEGIN
  SELECT * INTO tk FROM public.support_tickets WHERE id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה';
  END IF;
  _side := public.support_side(tk.tenant_id);
  IF _side IS NULL THEN
    RAISE EXCEPTION 'אין גישה לפנייה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _st NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  -- פתיחה מחדש: ממתין למי שלא כתב אחרון
  UPDATE public.support_tickets
     SET status = CASE WHEN _st = 'closed' THEN 'closed'
                       WHEN last_sender_type = 'admin' THEN 'answered'
                       ELSE 'open' END,
         updated_at = clock_timestamp()
   WHERE id = tk.id
  RETURNING * INTO tk;
  RETURN public.support_ticket_json(tk, _side);
END $$;
REVOKE ALL ON FUNCTION public.support_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_set_status(uuid, text) TO authenticated, service_role;

-- מנהל הפלטפורמה: כל הפניות (ברירת מחדל: הפתוחות — ממתינות לנו), VIP קודם
CREATE OR REPLACE FUNCTION public.platform_support_tickets(_filter text DEFAULT 'open')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f text := lower(btrim(COALESCE(_filter, 'open')));
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _f NOT IN ('open', 'answered', 'closed', 'active', 'all') THEN
    RAISE EXCEPTION 'מסנן לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(j ORDER BY (j ->> 'status') = 'closed',
                                (j ->> 'status') = 'answered',
                                (j ->> 'plan') = 'basic',
                                (j ->> 'last_message_at')::timestamptz DESC)
      FROM (
        SELECT public.support_ticket_json(tk, 'admin') AS j
          FROM public.support_tickets tk
         WHERE CASE _f
                 WHEN 'all' THEN true
                 WHEN 'active' THEN tk.status <> 'closed'
                 ELSE tk.status = _f
               END
         ORDER BY tk.last_message_at DESC
         LIMIT 500
      ) x), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_support_tickets(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_support_tickets(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_support_counts()
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
  RETURN (
    SELECT jsonb_build_object(
      'open', count(*) FILTER (WHERE status = 'open'),
      'answered', count(*) FILTER (WHERE status = 'answered'),
      'closed', count(*) FILTER (WHERE status = 'closed'),
      'unread', count(*) FILTER (WHERE last_sender_type = 'tenant'
                                   AND last_message_at > COALESCE(admin_read_at, '-infinity')))
      FROM public.support_tickets);
END $$;
REVOKE ALL ON FUNCTION public.platform_support_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_support_counts() TO authenticated, service_role;

-- לשרת (מיילים): פרטי הפנייה ולמי לשלוח — מנהלי הפלטפורמה / מנהלי החנות
CREATE OR REPLACE FUNCTION public.support_notify_targets(_ticket uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT jsonb_build_object(
    'ticket_id', tk.id,
    'subject', tk.subject,
    'tenant_id', t.id,
    'store_name', COALESCE(NULLIF(btrim(ss.business_name), ''), t.name),
    'store_slug', t.slug,
    'store_domain', t.domain,
    'store_is_default', t.is_default,
    'store_custom_domain', t.custom_domain,
    'store_custom_domain_status', t.custom_domain_status,
    'plan', COALESCE(sub.plan_type, 'trial'),
    'platform_emails', COALESCE((
      SELECT jsonb_agg(DISTINCT lower(u.email::text))
        FROM public.platform_admins pa JOIN auth.users u ON u.id = pa.user_id
       WHERE u.email IS NOT NULL), '[]'::jsonb),
    'tenant_emails', COALESCE((
      SELECT jsonb_agg(DISTINCT lower(e))
        FROM (SELECT ur.email AS e FROM public.user_roles ur
               WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND NOT ur.is_blocked
                 AND ur.email IS NOT NULL
              UNION
              SELECT t.owner_email WHERE t.owner_email IS NOT NULL) x), '[]'::jsonb))
    FROM public.support_tickets tk
    JOIN public.tenants t ON t.id = tk.tenant_id
    LEFT JOIN public.site_settings ss ON ss.tenant_id = t.id
    LEFT JOIN public.tenant_subscriptions sub ON sub.tenant_id = t.id
   WHERE tk.id = _ticket;
$$;
REVOKE ALL ON FUNCTION public.support_notify_targets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_notify_targets(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

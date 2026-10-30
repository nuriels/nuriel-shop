-- ============================================================
-- Hospitality — חבילות, מנויים, מגבלת יחידות, סטטיסטיקות מנהל, היסטוריית
-- מדיניות ביטול (Hospitality Stage 1e, מיגרציה 5)
-- ============================================================
-- מה המיגרציה עושה (הכל בסכמה hospitality; החיוב והמנויים של Ecommerce לא נוגעים):
--   1. plans (קטלוג פלטפורמה, לא פורסם, בלי מחירים) ו-subscriptions (מנוי Hospitality
--      לכל אתר) — נפרדים לגמרי מ-tenant_subscriptions / platform_plans / Grow.
--   2. entitlements(): החבילה, הסטטוס, האם פעיל, מגבלת היחידות והשימוש.
--      אתר חדש מקבל מנוי ניסיון (טריגר על הגדרות האתר).
--   3. מגבלת יחידות במסד (טריגר, נעילה לכל אתר — גם בבקשות מקבילות).
--   4. מנוי לא פעיל → האתר לא מקבל בקשות הזמנה חדשות ולא מוסיף יחידות; הזמנות
--      קיימות, קישורי ניהול ופעולות הבעלים ממשיכים.
--   5. סטטיסטיקות למנהל הפלטפורמה בלבד, בלי פרטים אישיים של אורחים.
--   6. policy_versions: היסטוריה (רק הוספה) של כל גרסת מדיניות; והגנה במסד
--      על התנאים שאושרו בהזמנה (כללים, גרסה, אישור האורח) — לא ניתנים לשינוי.
--   7. מיילים לבעלים: חזרה לחשבון הבעלים רק עם אימייל מאומת ופעיל (מפורט למטה).
--   לא נשלחים מיילים, אין תשלומים.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101130000_hosp_billing_admin.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. חבילות (קטלוג פלטפורמה — אין tenant_id; גישה רק דרך פונקציות)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.plans (
  code          text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- NULL = ללא הגבלה
  max_units     integer CHECK (max_units IS NULL OR max_units >= 0),
  trial_days    integer NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365),
  features      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  -- מחירים רק אחרי אישור (שלב 11); עד אז NULL והחבילות לא מפורסמות
  price_monthly numeric(10,2) CHECK (price_monthly IS NULL OR price_monthly >= 0),
  currency      text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  is_published  boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.plans IS 'Hospitality: קטלוג החבילות (placeholders — לא מפורסמות, בלי מחירים עד אישור)';
ALTER TABLE hospitality.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.plans FROM PUBLIC, anon, authenticated;
GRANT ALL ON hospitality.plans TO service_role;

INSERT INTO hospitality.plans (code, name, max_units, trial_days, sort_order) VALUES
  ('trial', 'ניסיון', 20, 14, 0),
  ('basic', 'בסיסית', 5, 0, 10),
  ('pro', 'מקצועית', 20, 0, 20),
  ('enterprise', 'ללא הגבלה', NULL, 0, 30)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- 2. מנוי Hospitality לכל אתר
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.subscriptions (
  tenant_id          uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_code          text NOT NULL REFERENCES hospitality.plans(code),
  -- trialing: ניסיון | active: חבילה | past_due: תשלום באיחור (7 ימי חסד) |
  -- canceled: בוטל | expired: הסתיים
  status             text NOT NULL DEFAULT 'trialing'
                     CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  trial_ends_at      timestamptz,
  current_period_end timestamptz,
  extra_units        integer NOT NULL DEFAULT 0 CHECK (extra_units BETWEEN 0 AND 1000),
  note               text CHECK (note IS NULL OR char_length(note) <= 500),
  updated_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL)
);
COMMENT ON TABLE hospitality.subscriptions IS 'Hospitality: המנוי של כל אתר (נפרד ממנויי Ecommerce)';

-- ------------------------------------------------------------
-- 3. היסטוריית מדיניות ביטול (רק הוספה)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.policy_versions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- בלי מפתח זר: ההיסטוריה נשמרת גם אם המדיניות עצמה נמחקת
  policy_id  uuid NOT NULL,
  version    integer NOT NULL CHECK (version >= 1),
  name       text NOT NULL,
  rules      jsonb NOT NULL,
  is_default boolean NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, version)
);
CREATE INDEX IF NOT EXISTS policy_versions_tenant_idx ON hospitality.policy_versions (tenant_id, policy_id, version);
COMMENT ON TABLE hospitality.policy_versions IS 'Hospitality: כל גרסה של כל מדיניות ביטול (לא ניתנת לשינוי)';

CREATE OR REPLACE FUNCTION hospitality.policies_record_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.version IS DISTINCT FROM OLD.version THEN
    INSERT INTO hospitality.policy_versions (tenant_id, policy_id, version, name, rules, is_default, changed_by)
    VALUES (NEW.tenant_id, NEW.id, NEW.version, NEW.name, hospitality._policy_rules(NEW), NEW.is_default, auth.uid())
    ON CONFLICT (policy_id, version) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS policies_record_version ON hospitality.policies;
CREATE TRIGGER policies_record_version AFTER INSERT OR UPDATE ON hospitality.policies
FOR EACH ROW EXECUTE FUNCTION hospitality.policies_record_version();

CREATE OR REPLACE FUNCTION hospitality.policy_versions_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_catalog.pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'היסטוריית המדיניות לא ניתנת לשינוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS policy_versions_append_only ON hospitality.policy_versions;
CREATE TRIGGER policy_versions_append_only BEFORE UPDATE OR DELETE ON hospitality.policy_versions
FOR EACH ROW EXECUTE FUNCTION hospitality.policy_versions_append_only();

-- הגרסאות הקיימות (לפני המיגרציה הזו) נרשמות כנקודת התחלה
INSERT INTO hospitality.policy_versions (tenant_id, policy_id, version, name, rules, is_default, changed_at)
SELECT p.tenant_id, p.id, p.version, p.name, hospitality._policy_rules(p), p.is_default, p.updated_at
  FROM hospitality.policies p
ON CONFLICT (policy_id, version) DO NOTHING;

-- התנאים שהאורח אישר בהזמנה לא משתנים: מזהה המדיניות, הגרסה, השם, הכללים, אזור
-- הזמן ושעת הצ'ק-אין שב-snapshot, ואישור האורח. מותר רק: לוח הזמנים / הסכום /
-- המקדמה שמחושבים מחדש מאותם כללים בשינוי תאריכים (modify_booking), מחיקת IP
-- ודפדפן באנונימיזציה, ו-policy_id → NULL כשהמדיניות נמחקת (ה-snapshot נשאר).
CREATE OR REPLACE FUNCTION hospitality.bookings_terms_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.policy_snapshot - 'schedule' - 'total' - 'deposit_amount')
       IS DISTINCT FROM (OLD.policy_snapshot - 'schedule' - 'total' - 'deposit_amount')
     OR (NEW.policy_acceptance IS DISTINCT FROM OLD.policy_acceptance
         AND NEW.policy_acceptance IS DISTINCT FROM (OLD.policy_acceptance - 'ip' - 'user_agent'))
     OR (NEW.policy_id IS DISTINCT FROM OLD.policy_id AND NEW.policy_id IS NOT NULL) THEN
    RAISE EXCEPTION 'תנאי הביטול שאושרו בהזמנה % לא ניתנים לשינוי', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_terms_guard ON hospitality.bookings;
CREATE TRIGGER bookings_terms_guard BEFORE UPDATE OF policy_snapshot, policy_acceptance, policy_id ON hospitality.bookings
FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_terms_guard();

-- ------------------------------------------------------------
-- 4. RLS והרשאות לטבלאות של האתר
-- ------------------------------------------------------------
DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES ('subscriptions', 'settings', true), ('policy_versions', 'policies', false)) AS v(tbl, perm, touch)
  LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _t.tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated', _t.tbl);
    EXECUTE format('GRANT SELECT ON hospitality.%I TO authenticated', _t.tbl);
    EXECUTE format('GRANT ALL ON hospitality.%I TO service_role', _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))$p$, _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
                      WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')))$p$, _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS staff ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY staff ON hospitality.%I FOR ALL TO authenticated
                      USING ((SELECT hospitality.can(%L)))
                      WITH CHECK ((SELECT hospitality.can(%L)))$p$, _t.tbl, _t.perm, _t.perm);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _t.tbl);
    EXECUTE format($g$CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()$g$, _t.tbl);
    IF _t.touch THEN
      EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON hospitality.%I', _t.tbl);
      EXECUTE format($g$CREATE TRIGGER touch_updated_at BEFORE UPDATE ON hospitality.%I
                        FOR EACH ROW EXECUTE FUNCTION hospitality.touch_updated_at()$g$, _t.tbl);
    END IF;
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS touch_updated_at ON hospitality.plans;
CREATE TRIGGER touch_updated_at BEFORE UPDATE ON hospitality.plans
FOR EACH ROW EXECUTE FUNCTION hospitality.touch_updated_at();

-- ------------------------------------------------------------
-- 5. זכאויות (entitlements)
-- ------------------------------------------------------------
-- יחידות שנספרות: פעילות, ולא "כל המתחם" (שמאגד יחידות קיימות)
CREATE OR REPLACE FUNCTION hospitality._units_used(_tenant_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::integer FROM hospitality.units u
   WHERE u.tenant_id = _tenant_id AND u.is_active AND u.kind <> 'whole_property';
$$;

-- אתר בלי שורת מנוי (נפתח לפני המיגרציה / בלי הגדרות) מתנהג כמו חבילת הניסיון
-- מיום פתיחת האתר. אתר מושעה (tenants.status) — לא פעיל.
CREATE OR REPLACE FUNCTION hospitality.entitlements(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  s hospitality.subscriptions;
  p hospitality.plans;
  _implicit boolean := false;
  _active boolean;
  _max integer;
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant_id AND x.site_type = 'hospitality';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM hospitality.subscriptions x WHERE x.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    _implicit := true;
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = 'trial';
    s.plan_code := 'trial';
    s.status := 'trialing';
    s.trial_ends_at := t.created_at + make_interval(days => p.trial_days);
    s.extra_units := 0;
  ELSE
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = s.plan_code;
  END IF;
  _active := t.status = 'active' AND CASE s.status
    WHEN 'trialing' THEN s.trial_ends_at > now()
    WHEN 'active' THEN s.current_period_end IS NULL OR s.current_period_end > now()
    WHEN 'past_due' THEN s.current_period_end IS NULL OR s.current_period_end + interval '7 days' > now()
    ELSE false END;
  _max := CASE WHEN p.max_units IS NULL THEN NULL ELSE p.max_units + s.extra_units END;
  RETURN jsonb_build_object(
    'plan', p.code, 'plan_name', p.name, 'status', s.status, 'active', _active, 'implicit', _implicit,
    'trial_ends_at', hospitality._ts(s.trial_ends_at), 'current_period_end', hospitality._ts(s.current_period_end),
    'max_units', _max, 'extra_units', s.extra_units, 'units_used', hospitality._units_used(_tenant_id),
    'features', p.features);
END $$;

-- אתר חדש (שורת ההגדרות נוצרת בפתיחת האתר) → מנוי ניסיון
CREATE OR REPLACE FUNCTION hospitality.settings_create_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at)
  SELECT NEW.tenant_id, p.code, 'trialing', now() + make_interval(days => p.trial_days)
    FROM hospitality.plans p WHERE p.code = 'trial'
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS settings_create_subscription ON hospitality.settings;
CREATE TRIGGER settings_create_subscription AFTER INSERT ON hospitality.settings
FOR EACH ROW EXECUTE FUNCTION hospitality.settings_create_subscription();

-- אתרים קיימים: מנוי ניסיון מעכשיו
INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at)
SELECT s.tenant_id, 'trial', 'trialing', now() + make_interval(days => (SELECT trial_days FROM hospitality.plans WHERE code = 'trial'))
  FROM hospitality.settings s
ON CONFLICT (tenant_id) DO NOTHING;

-- מגבלת היחידות: בהוספה / הפעלה של יחידה (או הפיכת "כל המתחם" ליחידה רגילה).
-- נעילה לכל אתר — שתי הוספות במקביל לא עוברות את המגבלה. חל על כל כותב.
CREATE OR REPLACE FUNCTION hospitality.units_limit_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e jsonb;
BEGIN
  IF NEW.kind = 'whole_property' OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active AND OLD.kind <> 'whole_property' THEN
    RETURN NEW;  -- כבר נספרה
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-units:' || NEW.tenant_id::text, 0));
  e := hospitality.entitlements(NEW.tenant_id);
  IF NOT COALESCE((e ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'החבילה של האתר לא פעילה — אי אפשר להוסיף או להפעיל יחידות' USING ERRCODE = 'check_violation';
  END IF;
  IF e ->> 'max_units' IS NOT NULL AND hospitality._units_used(NEW.tenant_id) >= (e ->> 'max_units')::integer THEN
    RAISE EXCEPTION 'הגעתם למגבלת היחידות בחבילה (%)', e ->> 'max_units' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS units_limit_guard ON hospitality.units;
CREATE TRIGGER units_limit_guard BEFORE INSERT OR UPDATE OF is_active, kind ON hospitality.units
FOR EACH ROW EXECUTE FUNCTION hospitality.units_limit_guard();

-- אתר עם מנוי לא פעיל לא מקבל בקשות הזמנה חדשות (הזמנות קיימות וקישורי ניהול ממשיכים).
-- (מחליף את הגרסה של מיגרציה 4; ה-rollback מחזיר אותה)
CREATE OR REPLACE FUNCTION hospitality._public_tenant(_need_booking boolean)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR (_need_booking AND (NOT hospitality.flag_for('hospitality_booking_enabled', _t)
                            OR NOT COALESCE((hospitality.entitlements(_t) ->> 'active')::boolean, false))) THEN
    RAISE EXCEPTION 'ההזמנות באתר הזה אינן פעילות' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN _t;
END $$;

-- מיילים לבעל העסק — לפי הסדר, הראשון שקיים:
--   1. נמעני ההתראות שהעסק הגדיר (settings.notification_emails);
--   2. אימייל העסק (settings.contact_email);
--   3. אימייל הבעלים שנקבע בפתיחת האתר (tenants.owner_email);
--   4. רק אם אין אף אחד מהם — האימייל הנוכחי של חשבון הבעלים של האתר הזה: המנהל
--      המוגן (role admin + is_protected), לא חסום, והחשבון עם אימייל מאומת, לא
--      מושעה ולא מחוק. לא מנהלים אחרים, לא מנהל הפלטפורמה, לא אתר אחר.
-- (מחליף את הגרסה של מיגרציה 4; ה-rollback מחזיר אותה)
CREATE OR REPLACE FUNCTION hospitality._owner_emails(_tenant_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
           NULLIF(s.notification_emails, '{}'::text[]),
           CASE WHEN COALESCE(s.contact_email, t.owner_email) IS NOT NULL
                THEN ARRAY[COALESCE(s.contact_email, t.owner_email)] END,
           (SELECT array_agg(DISTINCT lower(u.email))
              FROM public.user_roles ur
              JOIN auth.users u ON u.id = ur.user_id
             WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected AND NOT ur.is_blocked
               AND u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
               AND (u.banned_until IS NULL OR u.banned_until < now())),
           '{}'::text[])
    FROM public.tenants t
    LEFT JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.id = _tenant_id AND t.site_type = 'hospitality';
$$;

-- ------------------------------------------------------------
-- 6. פונקציות: בעלים (צפייה) ומנהל הפלטפורמה
-- ------------------------------------------------------------
-- החבילה והשימוש של האתר — לבעלים / מנהל (צפייה בלבד; שינוי רק ע"י הפלטפורמה)
CREATE OR REPLACE FUNCTION hospitality.my_entitlements()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality.entitlements(hospitality._staff_tenant('settings'));
END $$;

CREATE OR REPLACE FUNCTION hospitality._require_platform_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION hospitality.admin_plans()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sort_order, p.code) FROM hospitality.plans p), '[]'::jsonb);
END $$;

-- שינוי מנוי של אתר — מנהל הפלטפורמה בלבד, נרשם ביומן. הורדת חבילה מתחת לשימוש
-- הנוכחי מותרת (היחידות הקיימות נשארות), אבל אי אפשר להוסיף יחידות עד שמתפנה מקום.
CREATE OR REPLACE FUNCTION hospitality.admin_set_subscription(
  _tenant_id uuid, _plan text, _status text, _trial_ends_at timestamptz DEFAULT NULL,
  _current_period_end timestamptz DEFAULT NULL, _extra_units integer DEFAULT 0, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _before hospitality.subscriptions;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'אתר האירוח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hospitality.plans p WHERE p.code = _plan) THEN
    RAISE EXCEPTION 'חבילה לא מוכרת: %', _plan USING ERRCODE = 'check_violation';
  END IF;
  IF _status NOT IN ('trialing', 'active', 'past_due', 'canceled', 'expired') THEN
    RAISE EXCEPTION 'סטטוס מנוי לא מוכר: %', _status USING ERRCODE = 'check_violation';
  END IF;
  IF _status = 'trialing' AND _trial_ends_at IS NULL THEN
    RAISE EXCEPTION 'לניסיון צריך תאריך סיום' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _before FROM hospitality.subscriptions s WHERE s.tenant_id = _tenant_id FOR UPDATE;
  INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at, current_period_end,
                                         extra_units, note, updated_by)
  VALUES (_tenant_id, _plan, _status, _trial_ends_at, _current_period_end, COALESCE(_extra_units, 0),
          NULLIF(btrim(_note), ''), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET plan_code = EXCLUDED.plan_code, status = EXCLUDED.status, trial_ends_at = EXCLUDED.trial_ends_at,
        current_period_end = EXCLUDED.current_period_end, extra_units = EXCLUDED.extra_units,
        note = EXCLUDED.note, updated_by = EXCLUDED.updated_by;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hosp_subscription_set',
          jsonb_build_object('plan', _plan, 'status', _status, 'extra_units', COALESCE(_extra_units, 0),
                             'previous', CASE WHEN _before.tenant_id IS NULL THEN NULL
                                              ELSE jsonb_build_object('plan', _before.plan_code, 'status', _before.status,
                                                                      'extra_units', _before.extra_units) END));
  RETURN hospitality.entitlements(_tenant_id);
END $$;

-- סטטיסטיקות לכל אתר — מנהל הפלטפורמה בלבד. ספירות וסכומים בלבד: אין שמות,
-- אימיילים או טלפונים של אורחים.
CREATE OR REPLACE FUNCTION hospitality.admin_site_stats()
RETURNS TABLE (
  tenant_id uuid, slug text, name text, tenant_status text, plan text, subscription_status text,
  subscription_active boolean, trial_ends_at text, units_active integer, units_limit integer, properties integer,
  bookings_pending integer, bookings_upcoming integer, bookings_created_30d integer, nights_next_30d integer,
  revenue_30d numeric, currency text, guests integer, last_booking_at text, backend_enabled boolean,
  booking_enabled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN QUERY
  SELECT t.id, t.slug, t.name, t.status, e ->> 'plan', e ->> 'status', (e ->> 'active')::boolean,
         e ->> 'trial_ends_at', (e ->> 'units_used')::integer, (e ->> 'max_units')::integer,
         (SELECT count(*)::integer FROM hospitality.properties p WHERE p.tenant_id = t.id),
         (SELECT count(*)::integer FROM hospitality.bookings b WHERE b.tenant_id = t.id
             AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()),
         (SELECT count(*)::integer FROM hospitality.bookings b WHERE b.tenant_id = t.id
             AND b.status IN ('confirmed', 'cancel_requested', 'checked_in') AND b.check_out >= current_date),
         (SELECT count(*)::integer FROM hospitality.bookings b WHERE b.tenant_id = t.id
             AND b.created_at >= now() - interval '30 days'),
         (SELECT COALESCE(sum(upper(o.nights * daterange(current_date, current_date + 30))
                              - lower(o.nights * daterange(current_date, current_date + 30))), 0)::integer
            FROM hospitality.unit_occupancy o
            JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id AND b.unit_id = o.unit_id
           WHERE o.tenant_id = t.id AND o.nights && daterange(current_date, current_date + 30)),
         (SELECT COALESCE(sum(b.total), 0) FROM hospitality.bookings b WHERE b.tenant_id = t.id
             AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
             AND b.created_at >= now() - interval '30 days'),
         COALESCE((SELECT s.currency FROM hospitality.settings s WHERE s.tenant_id = t.id), 'ILS'),
         (SELECT count(*)::integer FROM hospitality.guests g WHERE g.tenant_id = t.id AND g.anonymized_at IS NULL),
         hospitality._ts((SELECT max(b.created_at) FROM hospitality.bookings b WHERE b.tenant_id = t.id)),
         hospitality.flag_for('hospitality_backend_enabled', t.id),
         hospitality.flag_for('hospitality_booking_enabled', t.id)
    FROM public.tenants t
    CROSS JOIN LATERAL (SELECT hospitality.entitlements(t.id) AS e) x
   WHERE t.site_type = 'hospitality'
   ORDER BY t.created_at;
END $$;

-- סיכום כולל לכל הפלטפורמה — מנהל הפלטפורמה בלבד
CREATE OR REPLACE FUNCTION hospitality.admin_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN (
    SELECT jsonb_build_object(
      'sites', count(*),
      'sites_active_subscription', count(*) FILTER (WHERE x.subscription_active),
      'sites_by_plan', COALESCE((SELECT jsonb_object_agg(plan, n) FROM (
                          SELECT y.plan, count(*) AS n FROM hospitality.admin_site_stats() y GROUP BY y.plan) z), '{}'::jsonb),
      'units_active', COALESCE(sum(x.units_active), 0),
      'bookings_pending', COALESCE(sum(x.bookings_pending), 0),
      'bookings_upcoming', COALESCE(sum(x.bookings_upcoming), 0),
      'bookings_created_30d', COALESCE(sum(x.bookings_created_30d), 0),
      'nights_next_30d', COALESCE(sum(x.nights_next_30d), 0),
      'revenue_30d', COALESCE(sum(x.revenue_30d), 0),
      'guests', COALESCE(sum(x.guests), 0))
      FROM hospitality.admin_site_stats() x);
END $$;

-- ------------------------------------------------------------
-- 7. הרשאות הפעלה
-- ------------------------------------------------------------
DO $$
DECLARE
  _f record;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
     WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('policies_record_version', 'policy_versions_append_only', 'bookings_terms_guard', '_units_used',
                         'entitlements', 'settings_create_subscription', 'units_limit_guard', '_public_tenant',
                         '_owner_emails', 'my_entitlements', '_require_platform_admin', 'admin_plans',
                         'admin_set_subscription', 'admin_site_stats', 'admin_overview')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f.sig);
  END LOOP;
END $$;
-- ההרשאה נבדקת בתוך כל פונקציה (can('settings') / מנהל הפלטפורמה)
GRANT EXECUTE ON FUNCTION hospitality.my_entitlements() TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.admin_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.admin_set_subscription(uuid, text, text, timestamptz, timestamptz, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.admin_site_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.admin_overview() TO authenticated;

COMMIT;

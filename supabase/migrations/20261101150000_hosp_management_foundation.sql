-- ============================================================
-- Hospitality Stage 2a — יסודות אזור הניהול (מיגרציה 7)
--
--   1. דגל אזור הניהול hospitality_management_enabled (כבוי; נפרד מדגל האתר הציבורי)
--   2. מגבלת המנהלים של Hospitality (במקום הכלל של Ecommerce):
--      • plans.max_managers (NULL = ללא הגבלה): ניסיון 3 · בסיסית 2 · מקצועית 5 · ללא הגבלה
--      • subscriptions.extra_managers — מקומות נוספים שמנהל הפלטפורמה מקצה
--      • הבעלים נספר כמקום; מנהלי פלטפורמה פטורים (לא נספרים ולא מוגבלים)
--      • נאכף במסד בטריגר על user_roles, בנעילה לכל אתר (אותו מפתח כמו Ecommerce)
--      • הורדת חבילה לא מסירה מנהלים קיימים — רק חוסמת הוספה עד שעומדים במגבלה
--      • מנוי לא פעיל → אי אפשר להוסיף מנהלים (כמו יחידות)
--      • הטריגר של Ecommerce מדלג על אתרים שאינם Ecommerce (שורה אחת; המסלול של
--        החנויות לא השתנה)
--   3. תור המיילים: לצוות אין יותר קריאה ישירה של הטבלה (התוכן כולל את קישור
--      "ניהול ההזמנה" של האורח עד שהמייל נשלח). מצב המיילים להזמנה — דרך
--      staff_email_status(), בלי התוכן ועם נמען מוסתר.
--   4. ייצוא / מחיקת פרטי אורח — לבעלים בלבד (הרשאה חדשה guests.privacy)
--   5. management_context() — קריאה אחת למעטפת הניהול: תפקיד, הרשאות, דגלים,
--      מנוי ומגבלות, פרטי האתר ורשימת ההקמה
--
-- Rollback: supabase/rollbacks/20261101150000_hosp_management_foundation.down.sql
-- אידמפוטנטית.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. דגל אזור הניהול
-- ------------------------------------------------------------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('hospitality_management_enabled', false, 'Hospitality: אזור הניהול של בעל העסק (נפרד מהאתר הציבורי)')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 2. מגבלת המנהלים
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'hospitality' AND table_name = 'plans' AND column_name = 'max_managers') THEN
    ALTER TABLE hospitality.plans ADD COLUMN max_managers integer
      CONSTRAINT plans_max_managers_check CHECK (max_managers IS NULL OR max_managers >= 1);
    -- הערכים שאושרו (רק בהוספת העמודה — הרצה חוזרת לא דורסת שינוי של מנהל הפלטפורמה)
    UPDATE hospitality.plans SET max_managers = CASE code
      WHEN 'trial' THEN 3 WHEN 'basic' THEN 2 WHEN 'pro' THEN 5 ELSE NULL END;
  END IF;
END $$;
COMMENT ON COLUMN hospitality.plans.max_managers IS 'מספר המנהלים בחבילה כולל הבעלים; NULL = ללא הגבלה';

ALTER TABLE hospitality.subscriptions
  ADD COLUMN IF NOT EXISTS extra_managers integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_extra_managers_check'
                   AND conrelid = 'hospitality.subscriptions'::regclass) THEN
    ALTER TABLE hospitality.subscriptions ADD CONSTRAINT subscriptions_extra_managers_check
      CHECK (extra_managers BETWEEN 0 AND 100);
  END IF;
END $$;

-- המקומות שבשימוש: המנהלים של האתר (גם חסומים — כמו ב-Ecommerce), בלי מנהלי פלטפורמה
CREATE OR REPLACE FUNCTION hospitality._managers_used(_tenant_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::integer FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant_id AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id);
$$;
REVOKE ALL ON FUNCTION hospitality._managers_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._managers_used(uuid) TO service_role;

-- הזכאות של אתר — כמו במיגרציה 5, ובנוסף מגבלת המנהלים והשימוש בה
CREATE OR REPLACE FUNCTION hospitality.entitlements(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  s hospitality.subscriptions;
  p hospitality.plans;
  _implicit boolean := false;
  _active boolean;
  _max integer;
  _max_managers integer;
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
    s.extra_managers := 0;
  ELSE
    SELECT * INTO p FROM hospitality.plans x WHERE x.code = s.plan_code;
  END IF;
  _active := t.status = 'active' AND CASE s.status
    WHEN 'trialing' THEN s.trial_ends_at > now()
    WHEN 'active' THEN s.current_period_end IS NULL OR s.current_period_end > now()
    WHEN 'past_due' THEN s.current_period_end IS NULL OR s.current_period_end + interval '7 days' > now()
    ELSE false END;
  _max := CASE WHEN p.max_units IS NULL THEN NULL ELSE p.max_units + s.extra_units END;
  _max_managers := CASE WHEN p.max_managers IS NULL THEN NULL ELSE p.max_managers + s.extra_managers END;
  RETURN jsonb_build_object(
    'plan', p.code, 'plan_name', p.name, 'status', s.status, 'active', _active, 'implicit', _implicit,
    'trial_ends_at', hospitality._ts(s.trial_ends_at), 'current_period_end', hospitality._ts(s.current_period_end),
    'max_units', _max, 'extra_units', s.extra_units, 'units_used', hospitality._units_used(_tenant_id),
    'max_managers', _max_managers, 'extra_managers', s.extra_managers,
    'managers_used', hospitality._managers_used(_tenant_id),
    'features', p.features);
END $$;

-- הטריגר: מנהל חדש (או שינוי תפקיד ל-admin / העברה לאתר אחר) באתר אירוח
CREATE OR REPLACE FUNCTION hospitality.user_roles_seat_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _e jsonb;
  _used integer;
  _limit integer;
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND OLD.tenant_id = NEW.tenant_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.site_type = 'hospitality') THEN
    RETURN NEW;
  END IF;
  -- מנהלי פלטפורמה פטורים: לא מוגבלים כשהם מוסיפים, ולא תופסים מקום כשהם מתווספים
  IF public.is_platform_admin(auth.uid()) OR public.is_platform_admin(NEW.user_id) THEN
    RETURN NEW;
  END IF;
  -- שתי הוספות במקביל לאותו אתר — אחת אחרי השנייה (אותו מפתח כמו ב-Ecommerce)
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || NEW.tenant_id::text, 0));
  _e := hospitality.entitlements(NEW.tenant_id);
  IF NOT COALESCE((_e ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'המנוי של האתר אינו פעיל — אי אפשר להוסיף מנהלים' USING ERRCODE = 'check_violation';
  END IF;
  _limit := (_e ->> 'max_managers')::integer;
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _used FROM public.user_roles ur
   WHERE ur.tenant_id = NEW.tenant_id AND ur.role = 'admin' AND ur.user_id <> NEW.user_id
     AND NOT public.is_platform_admin(ur.user_id);
  IF _used >= _limit THEN
    RAISE EXCEPTION 'הגעתם למגבלת המנהלים בחבילה (%). אפשר להסיר מנהל או לבקש מקומות נוספים.', _limit
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.user_roles_seat_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hospitality_admin_seat_guard ON public.user_roles;
CREATE TRIGGER hospitality_admin_seat_guard
BEFORE INSERT OR UPDATE OF role, tenant_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION hospitality.user_roles_seat_guard();

-- הטריגר של Ecommerce (חלק 24) — אותו גוף בדיוק, ובנוסף: אתר שאינו Ecommerce
-- עובר לכלל של המנוע שלו (למעלה). חנויות: אין שינוי.
CREATE OR REPLACE FUNCTION public.user_roles_admin_seat_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  used INTEGER;
  lim INTEGER;
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN RETURN NEW; END IF;
  -- אתרים שאינם Ecommerce: מגבלת המנהלים של המנוע שלהם (Hospitality: hospitality_admin_seat_guard)
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = NEW.tenant_id AND t.site_type <> 'ecommerce') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND OLD.tenant_id = NEW.tenant_id THEN RETURN NEW; END IF;
  IF public.is_platform_admin(auth.uid()) THEN RETURN NEW; END IF;
  -- שתי הוספות במקביל לאותה חנות — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || NEW.tenant_id::text, 0));
  SELECT count(*) INTO used FROM public.user_roles
   WHERE tenant_id = NEW.tenant_id AND role = 'admin' AND user_id <> NEW.user_id;
  lim := public.tenant_admin_limit(NEW.tenant_id);
  IF used >= lim THEN
    RAISE EXCEPTION 'הגעת למגבלת המנהלים בחבילה שלך (%). שדרג את החבילה או הוסף מנהל נוסף ב-200₪ לשנה.', lim
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.user_roles_admin_seat_guard() FROM PUBLIC, anon, authenticated;

-- מקומות נוספים — מנהל פלטפורמה בלבד (בלי לשנות את החתימה של admin_set_subscription)
CREATE OR REPLACE FUNCTION hospitality.admin_set_extra_managers(_tenant_id uuid, _extra integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _extra IS NULL OR _extra < 0 OR _extra > 100 THEN
    RAISE EXCEPTION 'מספר המקומות הנוספים חייב להיות בין 0 ל-100' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality') THEN
    RAISE EXCEPTION 'אתר האירוח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at, extra_managers, updated_by)
  SELECT _tenant_id, 'trial', 'trialing', t.created_at + make_interval(days => p.trial_days), _extra, auth.uid()
    FROM public.tenants t, hospitality.plans p WHERE t.id = _tenant_id AND p.code = 'trial'
  ON CONFLICT (tenant_id) DO UPDATE
    SET extra_managers = EXCLUDED.extra_managers, updated_by = auth.uid(), updated_at = now();
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, auth.uid(), 'hospitality_extra_managers', jsonb_build_object('extra_managers', _extra));
  RETURN hospitality.entitlements(_tenant_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_set_extra_managers(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_set_extra_managers(uuid, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. תור המיילים — בלי קריאה ישירה של הצוות
-- ------------------------------------------------------------
REVOKE SELECT ON hospitality.notifications FROM authenticated;

-- "d•••@gmail.com" — לתצוגה בלבד
CREATE OR REPLACE FUNCTION hospitality.mask_email(_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _email IS NULL OR position('@' IN _email) < 2 THEN NULL
    ELSE left(_email, 1) || '•••' || substr(_email, position('@' IN _email))
  END;
$$;
REVOKE ALL ON FUNCTION hospitality.mask_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.mask_email(text) TO service_role;

-- מצב המיילים של הזמנה — לצוות עם הרשאת הזמנות. בלי התוכן (payload), בלי
-- טקסט השגיאה של הספק, עם נמען מוסתר.
CREATE OR REPLACE FUNCTION hospitality.staff_email_status(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.id = _booking_id) THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', n.id, 'event', n.event, 'recipient_kind', n.recipient_kind,
             'recipient', hospitality.mask_email(n.recipient_email), 'status', n.status,
             'attempts', n.attempts, 'has_error', n.last_error IS NOT NULL,
             'created_at', hospitality._ts(n.created_at), 'sent_at', hospitality._ts(n.sent_at))
           ORDER BY n.created_at, n.id)
      FROM hospitality.notifications n
     WHERE n.tenant_id = _t AND n.booking_id = _booking_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_email_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_email_status(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. פרטיות האורחים — ייצוא ומחיקה לבעלים בלבד
-- ------------------------------------------------------------
--   guests.privacy — ייצוא / מחיקת פרטי אורח — הבעלים בלבד
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

--   owner   → כל ההרשאות
--   manager → הכל חוץ מ-staff.managers, billing.manage ו-guests.privacy
CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
  g hospitality.guests;
BEGIN
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'guest', jsonb_build_object('full_name', g.full_name, 'email', g.email, 'phone', g.phone, 'notes', g.notes,
                                'marketing_consent', g.marketing_consent, 'created_at', hospitality._ts(g.created_at),
                                'anonymized_at', hospitality._ts(g.anonymized_at)),
    'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', b.number, 'status', b.status, 'check_in', b.check_in, 'check_out', b.check_out,
                  'adults', b.adults, 'children', b.children, 'total', b.total, 'currency', b.currency,
                  'special_requests', b.special_requests, 'policy_acceptance', b.policy_acceptance,
                  'created_at', hospitality._ts(b.created_at)) ORDER BY b.check_in)
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION hospitality.anonymize_guest(_guest_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id) THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._anonymize_guest(_t, _guest_id);
  RETURN true;
END $$;

-- ------------------------------------------------------------
-- 5. ההקשר של אזור הניהול
-- ------------------------------------------------------------
-- רק בעלים / מנהל של אתר האירוח של הבקשה, כשהמסד ואזור הניהול פעילים לאתר.
-- מנהל (לא בעלים) מקבל מהמנוי רק מה שצריך למסכים (פעיל, יחידות) — בלי פרטי החבילה.
CREATE OR REPLACE FUNCTION hospitality.management_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
  _role text;
  t public.tenants;
  s hospitality.settings;
  _e jsonb;
BEGIN
  IF _t IS NULL OR public.current_site_type() IS DISTINCT FROM 'hospitality' THEN
    RAISE EXCEPTION 'אין לחשבון הזה הרשאת ניהול באתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _role := public.store_staff_role(auth.uid());
  IF _role IS NULL OR _role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'אין לחשבון הזה הרשאת ניהול באתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT hospitality.flag('hospitality_backend_enabled') OR NOT hospitality.flag('hospitality_management_enabled') THEN
    RAISE EXCEPTION 'אזור הניהול אינו פעיל באתר הזה' USING ERRCODE = 'feature_not_supported';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = _t;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  _e := hospitality.entitlements(_t);
  RETURN jsonb_build_object(
    'role', _role,
    'permissions', (SELECT jsonb_object_agg(p, hospitality.can(p)) FROM unnest(hospitality.permissions()) p),
    'flags', jsonb_build_object(
      'management', true,
      'frontend', hospitality.flag('hospitality_frontend_enabled'),
      'booking', hospitality.flag('hospitality_booking_enabled')),
    'site', jsonb_build_object('name', t.name, 'slug', t.slug, 'status', t.status),
    'business', jsonb_build_object(
      'name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
      'timezone', COALESCE(s.timezone, 'Asia/Jerusalem'),
      'currency', COALESCE(s.currency, 'ILS')),
    'entitlements', CASE WHEN hospitality.can('billing.manage') THEN _e
                         ELSE jsonb_build_object('active', _e -> 'active', 'max_units', _e -> 'max_units',
                                                 'units_used', _e -> 'units_used') END,
    'checklist', jsonb_build_object(
      'business', COALESCE(btrim(s.business_name) <> '' AND (s.contact_phone IS NOT NULL OR s.contact_email IS NOT NULL), false),
      'units', EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.is_active),
      'photos', EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.kind = 'image' AND NOT m.is_demo),
      'prices', EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.is_active AND u.base_price > 0),
      -- מדיניות הביטול נבדקה: יש יותר ממדיניות אחת, או שמדיניות נערכה אחרי שנוצרה
      'policy', EXISTS (SELECT 1 FROM hospitality.policy_versions v WHERE v.tenant_id = _t AND v.version > 1)
                OR (SELECT count(*) FROM hospitality.policies x WHERE x.tenant_id = _t) > 1));
END $$;
REVOKE ALL ON FUNCTION hospitality.management_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.management_context() TO authenticated, service_role;

COMMIT;

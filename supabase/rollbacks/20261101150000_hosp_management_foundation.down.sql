-- ============================================================
-- Rollback: 20261101150000_hosp_management_foundation.sql
-- מחזיר את המצב של מיגרציה 6: כלל המנהלים של Ecommerce חל שוב על אתרי אירוח,
-- הצוות קורא שוב את תור המיילים ישירות, ייצוא / מחיקת אורח חוזרים להרשאת guests.
-- הגנה: נעצר אם מנהל הפלטפורמה כבר הקצה מקומות נוספים (extra_managers > 0),
-- כדי לא למחוק בשקט החלטה עסקית. דגל אזור הניהול נמחק (עם ההפעלות לאתרים).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality'
               AND table_name = 'subscriptions' AND column_name = 'extra_managers')
     AND EXISTS (SELECT 1 FROM hospitality.subscriptions WHERE extra_managers > 0) THEN
    RAISE EXCEPTION 'rollback refused: extra manager seats were assigned (hospitality.subscriptions.extra_managers > 0)';
  END IF;
END $$;

-- 5. ההקשר של אזור הניהול
DROP FUNCTION IF EXISTS hospitality.management_context();

-- 4. ייצוא / מחיקת אורח — חזרה להרשאת guests (מיגרציה 4); ההרשאות של מיגרציה 3
CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests');
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
  _t uuid := hospitality._staff_tenant('guests');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id) THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._anonymize_guest(_t, _guest_id);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

-- הרשאת צוות באתר האירוח של הבקשה. מבוסס על public.store_staff_role():
--   owner (המנהל המוגן / מנהל-על) → כל ההרשאות של Hospitality
--   manager (admin לא מוגן)      → הכל חוץ מ-staff.managers ו-billing.manage
--   כל השאר (אורח, לקוח, חבר באתר אחר, אתר Ecommerce) → כלום.
-- הרשאה לא מוכרת (גם שמות של Ecommerce כמו pos) → false.
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
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- 3. תור המיילים — חזרה לקריאה ישירה של הצוות (מיגרציה 4)
DROP FUNCTION IF EXISTS hospitality.staff_email_status(uuid);
DROP FUNCTION IF EXISTS hospitality.mask_email(text);
GRANT SELECT ON hospitality.notifications TO authenticated;

-- 2. מגבלת המנהלים — הטריגר של Ecommerce חוזר לגוף המקורי (חלק 24)
DROP FUNCTION IF EXISTS hospitality.admin_set_extra_managers(uuid, integer);
DROP TRIGGER IF EXISTS hospitality_admin_seat_guard ON public.user_roles;
DROP FUNCTION IF EXISTS hospitality.user_roles_seat_guard();
CREATE OR REPLACE FUNCTION public.user_roles_admin_seat_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  used INTEGER;
  lim INTEGER;
BEGIN
  IF NEW.role IS DISTINCT FROM 'admin' THEN RETURN NEW; END IF;
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

-- הזכאות — הגרסה של מיגרציה 5 (לפני הסרת העמודות: הגוף לא מפנה אליהן)
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
DROP FUNCTION IF EXISTS hospitality._managers_used(uuid);
ALTER TABLE hospitality.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_extra_managers_check;
ALTER TABLE hospitality.subscriptions DROP COLUMN IF EXISTS extra_managers;
ALTER TABLE hospitality.plans DROP COLUMN IF EXISTS max_managers;

-- 1. הדגל (ההפעלות לאתרים נמחקות איתו — ON DELETE CASCADE)
DELETE FROM public.platform_feature_flags WHERE key = 'hospitality_management_enabled';

COMMIT;

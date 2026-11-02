-- ============================================================
-- Rollback של 20261105120000_hosp_setup_guide.sql (מיגרציה 35 — מדריך ההקמה)
-- נמחקים: setup_state (המקום שבו העסק עצר במדריך, צעדים שאושרו ודילוגים — מצב תצוגה, לא נתוני
-- עסק: היחידות, המחירים, ההגדרות והאתר לא נוגעים), setup_guide / setup_save והעזרים.
-- management_context חוזרת לגרסה של מיגרציה 7 — מילה במילה (בלי 'site' ברשימת ההקמה).
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי מסך "הקמת העסק".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.setup_save(text, text);
DROP FUNCTION IF EXISTS hospitality.setup_guide();
DROP FUNCTION IF EXISTS hospitality._setup_view(uuid);

-- ההקשר של אזור הניהול — הגרסה של מיגרציה 7
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

DROP FUNCTION IF EXISTS hospitality._setup_site_ready(uuid);
DROP TABLE IF EXISTS hospitality.setup_state;

COMMIT;

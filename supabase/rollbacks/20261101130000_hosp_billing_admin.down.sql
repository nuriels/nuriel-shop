-- ============================================================
-- Rollback: 20261101130000_hosp_billing_admin.sql
-- מסיר חבילות, מנויים, היסטוריית מדיניות, מגבלת היחידות, הגנת התנאים בהזמנה
-- והסטטיסטיקות; מחזיר את _public_tenant ו-_owner_emails של מיגרציה 4.
-- נעצר אם מנוי שונה ע"י הפלטפורמה (לא ניסיון ברירת מחדל) או שיש היסטוריית
-- מדיניות מעבר לגרסה הראשונה — אלה נתוני חיוב / ביקורת שלא נמחקים בשקט.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.subscriptions') IS NOT NULL AND EXISTS (
       SELECT 1 FROM hospitality.subscriptions
        WHERE plan_code <> 'trial' OR status <> 'trialing' OR extra_units <> 0 OR updated_by IS NOT NULL) THEN
    RAISE EXCEPTION 'יש מנויים שהפלטפורמה שינתה — גבו אותם לפני rollback של החבילות';
  END IF;
  IF to_regclass('hospitality.policy_versions') IS NOT NULL
     AND EXISTS (SELECT 1 FROM hospitality.policy_versions WHERE version > 1) THEN
    RAISE EXCEPTION 'יש היסטוריית מדיניות ביטול — גבו אותה לפני rollback';
  END IF;
END $$;

DROP TRIGGER IF EXISTS units_limit_guard ON hospitality.units;
DROP TRIGGER IF EXISTS settings_create_subscription ON hospitality.settings;
DROP TRIGGER IF EXISTS bookings_terms_guard ON hospitality.bookings;
DROP TRIGGER IF EXISTS policies_record_version ON hospitality.policies;

DROP FUNCTION IF EXISTS hospitality.admin_overview();
DROP FUNCTION IF EXISTS hospitality.admin_site_stats();
DROP FUNCTION IF EXISTS hospitality.admin_set_subscription(uuid, text, text, timestamptz, timestamptz, integer, text);
DROP FUNCTION IF EXISTS hospitality.admin_plans();
DROP FUNCTION IF EXISTS hospitality._require_platform_admin();
DROP FUNCTION IF EXISTS hospitality.my_entitlements();
DROP FUNCTION IF EXISTS hospitality.units_limit_guard();
DROP FUNCTION IF EXISTS hospitality.settings_create_subscription();
DROP FUNCTION IF EXISTS hospitality.entitlements(uuid);
DROP FUNCTION IF EXISTS hospitality._units_used(uuid);
DROP FUNCTION IF EXISTS hospitality.bookings_terms_guard();
DROP FUNCTION IF EXISTS hospitality.policies_record_version();

DROP TABLE IF EXISTS hospitality.policy_versions;
DROP FUNCTION IF EXISTS hospitality.policy_versions_append_only();
DROP TABLE IF EXISTS hospitality.subscriptions;
DROP TABLE IF EXISTS hospitality.plans;

-- הגרסאות של מיגרציה 4
CREATE OR REPLACE FUNCTION hospitality._public_tenant(_need_booking boolean)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR (_need_booking AND NOT hospitality.flag_for('hospitality_booking_enabled', _t)) THEN
    RAISE EXCEPTION 'ההזמנות באתר הזה אינן פעילות' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN _t;
END $$;

CREATE OR REPLACE FUNCTION hospitality._owner_emails(_tenant_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
           NULLIF(s.notification_emails, '{}'::text[]),
           CASE WHEN COALESCE(s.contact_email, t.owner_email) IS NOT NULL
                THEN ARRAY[COALESCE(s.contact_email, t.owner_email)] END,
           (SELECT array_agg(lower(ur.email) ORDER BY ur.created_at) FROM public.user_roles ur
             WHERE ur.tenant_id = t.id AND ur.is_protected AND NOT ur.is_blocked),
           '{}'::text[])
    FROM public.tenants t
    LEFT JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.id = _tenant_id;
$$;
REVOKE ALL ON FUNCTION hospitality._public_tenant(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._owner_emails(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._public_tenant(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION hospitality._owner_emails(uuid) TO service_role;

COMMIT;

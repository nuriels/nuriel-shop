-- ============================================================
-- Rollback: 20261101160000_hosp_settings_team.sql
-- חזרה למצב של מיגרציה 7: הצוות מעדכן שוב את ההגדרות ישירות (אותן עמודות כמו
-- במיגרציה 4), 11 הרשאות, בלי יומן הפעולות, בלי פונקציות הצוות ובלי ה-trigger של
-- user_roles לאתרי אירוח.
-- הגנה: נעצר אם ביומן הפעולות יש רשומות — לא מוחקים היסטוריה בשקט.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.audit_log') IS NOT NULL
     AND EXISTS (SELECT 1 FROM hospitality.audit_log) THEN
    RAISE EXCEPTION 'rollback refused: hospitality.audit_log has rows (team / settings history)';
  END IF;
END $$;

-- 5. user_roles באתרי אירוח
DROP TRIGGER IF EXISTS hospitality_admin_row_guard ON public.user_roles;
DROP FUNCTION IF EXISTS hospitality.user_roles_admin_row_guard();

-- 4. צוות
DROP FUNCTION IF EXISTS hospitality.team_activity(integer);
DROP FUNCTION IF EXISTS hospitality.team_remove_manager(uuid);
DROP FUNCTION IF EXISTS hospitality.team_add_manager(text, text);
DROP FUNCTION IF EXISTS hospitality.team_members();

-- 3. הגדרות
DROP FUNCTION IF EXISTS hospitality.update_settings(jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.settings_view();
DROP FUNCTION IF EXISTS hospitality._settings_fields(text);
DROP FUNCTION IF EXISTS hospitality._settings_values(hospitality.settings);
DROP FUNCTION IF EXISTS hospitality._sv_int(jsonb, text, integer, integer, boolean);
DROP FUNCTION IF EXISTS hospitality._sv_text(jsonb, text, integer, boolean);
DROP FUNCTION IF EXISTS hospitality._settings_label(text);
ALTER TABLE hospitality.settings DROP COLUMN IF EXISTS revision;
GRANT UPDATE (business_name, contact_phone, contact_email, whatsapp_phone, address, check_in_time,
              check_out_time, booking_mode, approval_window_minutes, approval_reminder_pct,
              max_open_requests, payment_hold_minutes, weekend_nights, currency, timezone,
              guest_retention_months, notification_emails)
  ON hospitality.settings TO authenticated;

-- 2. יומן הפעולות
DROP FUNCTION IF EXISTS hospitality._audit(uuid, text, text, jsonb);
DROP TABLE IF EXISTS hospitality.audit_log;
DROP FUNCTION IF EXISTS hospitality.audit_log_append_only();

-- 1. הרשאות — הגרסה של מיגרציה 7
DROP FUNCTION IF EXISTS hospitality._manage_tenant(text);
DROP FUNCTION IF EXISTS hospitality.mask_phone(text);
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

COMMIT;

-- ============================================================
-- Rollback של 20261116120000_bp_inquiries.sql (מיגרציה 196 — פניות מלקוחות באתרי העסקים)
-- הגנה: נעצר כשיש פנייה כלשהי (גם פניית בדיקה) או הגדרות התראה שמורות — rollback היה מוחק פניות של
-- לקוחות. קודם מייצאים / מוחקים בממשק הניהול, ורק אז מריצים.
-- בלי נתונים: הפונקציות והטבלאות נמחקות, וההרשאות של בעל העסק חוזרות לגרסה של מיגרציה 193.
-- היומן (audit_log) נשאר כמו שהוא — רשומות inquiry.* שבו לא נמחקות (היסטוריה).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_profile.inquiries) THEN
    RAISE EXCEPTION 'יש פניות מלקוחות באתרי העסקים — rollback היה מוחק אותן. לא מבוצע';
  END IF;
  IF EXISTS (SELECT 1 FROM business_profile.inquiry_settings) THEN
    RAISE EXCEPTION 'יש הגדרות התראה שמורות לפניות — rollback היה מוחק אותן. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.bp_inquiry_submit(uuid, text, text, text, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.bp_inquiry_notify_claim(uuid);
DROP FUNCTION IF EXISTS public.bp_inquiry_notify_result(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.bp_inquiry_notify_due(integer);
DROP FUNCTION IF EXISTS public.bp_inquiries_purge();
DROP FUNCTION IF EXISTS public.bp_inquiries_list(text, boolean, integer);
DROP FUNCTION IF EXISTS public.bp_inquiry_get(uuid);
DROP FUNCTION IF EXISTS public.bp_inquiry_set_status(uuid, text);
DROP FUNCTION IF EXISTS public.bp_inquiry_add_note(uuid, text);
DROP FUNCTION IF EXISTS public.bp_inquiry_delete_note(uuid);
DROP FUNCTION IF EXISTS public.bp_inquiry_delete(uuid);
DROP FUNCTION IF EXISTS public.bp_inquiries_delete_test();
DROP FUNCTION IF EXISTS public.bp_inquiry_retry_notify(uuid);
DROP FUNCTION IF EXISTS public.bp_inquiry_settings();
DROP FUNCTION IF EXISTS public.bp_inquiry_settings_save(text, boolean, integer);
DROP FUNCTION IF EXISTS public.bp_inquiries_new_count();
DROP FUNCTION IF EXISTS business_profile._inquiry_json(business_profile.inquiries, boolean);
DROP FUNCTION IF EXISTS business_profile._inquiry_reference(uuid);
DROP FUNCTION IF EXISTS business_profile._inquiry_notify_block(uuid);
DROP FUNCTION IF EXISTS business_profile._inquiry_settings(uuid);
DROP FUNCTION IF EXISTS business_profile._site_live(uuid);
DROP FUNCTION IF EXISTS business_profile._inquiry_email_ok(text);

DROP TABLE IF EXISTS business_profile.inquiry_notes;
DROP TABLE IF EXISTS business_profile.inquiries;
DROP TABLE IF EXISTS business_profile.inquiry_settings;

-- ההרשאות — בדיוק כמו במיגרציה 193
CREATE OR REPLACE FUNCTION business_profile.permissions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN business_profile.request_site() IS NULL OR auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.store_staff_role(auth.uid()) = 'owner' THEN
      ARRAY['content.edit', 'site.publish', 'versions.restore', 'settings.owner']
    WHEN public.store_staff_role(auth.uid()) = 'manager' THEN ARRAY['content.edit']
    ELSE ARRAY[]::text[]
  END;
$$;
REVOKE ALL ON FUNCTION business_profile.permissions() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

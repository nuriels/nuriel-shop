-- ============================================================
-- Rollback של 20261115100000_site_tag_manager.sql (מיגרציה 192 — Google Tag Manager לכל אתר)
-- הגנה: נעצר כשבעל עסק כלשהו כבר שמר מזהה — rollback היה מוחק את ההגדרה שלו. לפני rollback כזה —
-- גיבוי, והחלטה מפורשת.
-- בלי נתונים: הטבלה וחמש הפונקציות נמחקות. רשומות היומן (site_tag_manager_saved) נשארות.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי GTM.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('public.site_tracking') IS NOT NULL AND EXISTS (SELECT 1 FROM public.site_tracking) THEN
    RAISE EXCEPTION 'יש אתרים ששמרו מזהה Google Tag Manager — rollback היה מוחק אותו. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.save_my_tag_manager(text, boolean);
DROP FUNCTION IF EXISTS public.my_tag_manager();
DROP FUNCTION IF EXISTS public.site_tag_manager();
DROP FUNCTION IF EXISTS public.site_tracking_allowed();
DROP FUNCTION IF EXISTS public.site_tracking_can_edit();
DROP TABLE IF EXISTS public.site_tracking;

NOTIFY pgrst, 'reload schema';

COMMIT;

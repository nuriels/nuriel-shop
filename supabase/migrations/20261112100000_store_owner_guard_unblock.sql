-- ============================================================
-- הרשאות צוות החנות: מנהל שהבעלים חסם — רק הבעלים משחרר
-- user_roles_owner_guard (מיגרציה 20261019390000) עצר מנהל (שאינו הבעלים) מלחסום מנהל אחר, אבל לא
-- מלשחרר אותו: הכפתור "שחרור" בלשונית המשתמשים מעדכן ישירות את user_roles, ומדיניות ה-RLS מתירה
-- לכל מנהל. עכשיו כל שינוי של is_blocked בשורת מנהל — רק הבעלים (staff.managers), מנהל הפלטפורמה
-- או השרת. שאר הפונקציה זהה מילה במילה. בלי שינוי נתונים.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.user_roles_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _trusted boolean := _me IS NULL OR public.is_platform_admin(_me);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT _trusted AND OLD.role = 'admin' AND NOT public.staff_can('staff.managers', _me) THEN
      RAISE EXCEPTION 'רק בעל החנות יכול להסיר מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT _trusted THEN
      NEW.is_protected := false;
      IF NEW.role = 'admin' AND NOT public.staff_can('staff.managers', _me) THEN
        RAISE EXCEPTION 'רק בעל החנות יכול להוסיף מנהלים' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.role = 'admin' AND NOT NEW.is_protected AND NOT NEW.is_blocked THEN
      -- שתי הוספות במקביל לחנות חדשה — אחת אחרי השנייה
      PERFORM pg_advisory_xact_lock(hashtextextended('store-owner:' || NEW.tenant_id::text, 0));
      IF NOT EXISTS (SELECT 1 FROM public.user_roles
                      WHERE tenant_id = NEW.tenant_id AND is_protected) THEN
        NEW.is_protected := true;
        NEW.is_approved := true;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT _trusted AND NOT public.staff_can('staff.managers', _me) THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND (OLD.role = 'admin' OR NEW.role = 'admin') THEN
      RAISE EXCEPTION 'רק בעל החנות יכול למנות מנהלים או לשנות תפקיד של מנהל'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- גם שחרור: מנהל שהבעלים חסם — רק הבעלים משחרר (לפני כן הכלל עצר רק חסימה, והכפתור "שחרור"
    -- בלשונית המשתמשים עדכן ישירות את user_roles — מנהל אחר יכול היה להחזיר מנהל שהבעלים חסם)
    IF OLD.role = 'admin' AND NEW.is_blocked IS DISTINCT FROM OLD.is_blocked THEN
      RAISE EXCEPTION 'רק בעל החנות יכול לחסום או לשחרר מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;

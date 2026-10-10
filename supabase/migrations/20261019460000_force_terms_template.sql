-- ============================================================
-- חלק 37ג: דריסה בכוח של התקנון בכל החנויות הקיימות (Pre-launch)
--
-- בחלק 37ב החנויות קיבלו את הנוסח המלא רק אם התקנון שלהן לא נערך (מנגנון
-- ההגנה). כרגע כל החנויות הקיימות הן חנויות בדיקה, ולכן כאן התקנון
-- (site_settings.terms_content) נדרס בכל ה-Tenants — גם אם נערך — בנוסח
-- המלא עם המשתנים {{store_name}}, {{store_email}}, {{store_phone}}
-- (legal_default_html('terms') מחלק 37ב — זהה לנוסח שנמסר).
--
-- ⚠ מדיניות הפרטיות (privacy_content) ומדיניות הביטולים — לא נוגעים בהן.
--
-- מיגרציה רצה פעם אחת בשרת (_migrations_applied); גם בהרצה חוזרת התוצאה זהה.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION public.legal_force_terms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.site_settings
     SET terms_content = public.legal_default_html('terms')
   WHERE terms_content IS DISTINCT FROM public.legal_default_html('terms');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;
REVOKE ALL ON FUNCTION public.legal_force_terms() FROM PUBLIC, anon, authenticated;

SELECT public.legal_force_terms();

COMMIT;

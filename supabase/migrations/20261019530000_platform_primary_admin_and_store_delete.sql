-- ============================================================
-- תיקונים בפאנל הפלטפורמה:
--   1. מחיקת חנות נכשלה ב"אי אפשר למחוק את המנהל הראשי" — בעל החנות (is_protected)
--      הוא חלק מהחנות, ומחיקה מלאה של החנות על ידי מנהל פלטפורמה חייבת למחוק גם אותו.
--      ההגנה נשארת בכל מצב אחר (אפליקציה / API ישיר).
--   2. מנהל-על שנוסף יכול היה להסיר את מנהל-העל הראשי. עכשיו הראשי (הוותיק ביותר)
--      מוגן: רק הוא עצמו (דרך מסד הנתונים) יכול להשתנות, ואף מנהל-על אחר לא מסיר אותו.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- 1. הטריגר מאפשר מחיקה רק בתוך platform_delete_tenant של אותה חנות
CREATE OR REPLACE FUNCTION public.guard_protected_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_protected
     AND COALESCE(current_setting('nuriel.deleting_tenant', true), '') <> OLD.tenant_id::text THEN
    RAISE EXCEPTION 'אי אפשר למחוק את המנהל הראשי';
  END IF;
  RETURN OLD;
END; $$;

DO $$
DECLARE
  _def text := pg_get_functiondef('public.platform_delete_tenant(uuid,text)'::regprocedure);
  _marker text := E'  SELECT COALESCE(array_agg(ur.user_id), ''{}'') INTO _users';
BEGIN
  IF position('nuriel.deleting_tenant' in _def) = 0 THEN
    IF position(_marker in _def) = 0 THEN
      RAISE EXCEPTION 'platform_delete_tenant: נקודת ההחלפה לא נמצאה';
    END IF;
    -- מקומי לטרנזקציה: נעלם בסיומה
    _def := replace(_def, _marker,
      E'  PERFORM set_config(''nuriel.deleting_tenant'', _tenant::text, true);\n' || _marker);
    EXECUTE _def;
  END IF;
END $$;

-- 2. מנהל-העל הראשי = הוותיק ביותר
CREATE OR REPLACE FUNCTION public.primary_platform_admin()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.platform_admins ORDER BY created_at, user_id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.primary_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primary_platform_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_remove_admin(_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להסיר מנהלי-על' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _user_id = auth.uid() THEN
    RAISE EXCEPTION 'אי אפשר להסיר את עצמך — מנהל-על אחר צריך לעשות את זה';
  END IF;
  IF _user_id = public.primary_platform_admin() THEN
    RAISE EXCEPTION 'אי אפשר להסיר את מנהל-העל הראשי' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.platform_admins) <= 1 THEN
    RAISE EXCEPTION 'חייב להישאר לפחות מנהל-על אחד';
  END IF;
  DELETE FROM public.platform_admins WHERE user_id = _user_id;
END $$;
REVOKE ALL ON FUNCTION public.platform_remove_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_remove_admin(uuid) TO authenticated, service_role;

-- הרשימה מסמנת מי הראשי (לממשק); העמודה החדשה בסוף כדי לא לשבור קוראים
DROP FUNCTION IF EXISTS public.platform_list_admins();
CREATE FUNCTION public.platform_list_admins()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz, is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pa.user_id, u.email::text, pa.created_at, pa.user_id = public.primary_platform_admin()
    FROM public.platform_admins pa
    JOIN auth.users u ON u.id = pa.user_id
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY pa.created_at, pa.user_id;
$$;
REVOKE ALL ON FUNCTION public.platform_list_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_admins() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

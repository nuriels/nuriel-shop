-- ============================================================
-- בדיקת כתובת (slug) לחנות חדשה — אותה בדיקה בשלושה מקומות:
--   1. בטופס, בזמן ההקלדה (platform_slug_problem דרך פונקציית השרת)
--   2. ביצירה עצמה (platform_create_tenant קוראת לה לפני ה-INSERT)
--   3. במסד: UNIQUE על tenants.slug — גם אם שני מנהלים לוחצים באותו רגע,
--      רק אחד מצליח, והשני מקבל הודעה ברורה (unique_violation).
-- ============================================================
BEGIN;

-- NULL = הכתובת תקינה ופנויה; אחרת — הסיבה, בעברית, להצגה בטופס
CREATE OR REPLACE FUNCTION public.platform_slug_problem(_slug text)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להקים חנויות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _s = '' THEN
    RETURN 'יש להזין כתובת באנגלית';
  END IF;
  IF _s !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' THEN
    RETURN 'כתובת: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)';
  END IF;
  IF _s = ANY (public.platform_reserved_slugs()) OR _s LIKE 'api-%' THEN
    RETURN format('הכתובת "%s" שמורה — בחרו כתובת אחרת', _s);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = _s) THEN
    RETURN format('הכתובת "%s" כבר תפוסה ע"י חנות אחרת', _s);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.platform_slug_problem(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_slug_problem(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_create_tenant(_slug text, _name text, _domain text DEFAULT NULL)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(lower(btrim(COALESCE(_domain, ''))), '');
  _problem text;
  t public.tenants;
BEGIN
  -- כולל בדיקת הרשאה (מנהל פלטפורמה), פורמט, כתובות שמורות וכתובת תפוסה
  _problem := public.platform_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;
  IF length(_n) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'שם החנות חייב להכיל 1 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND _d !~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' THEN
    RAISE EXCEPTION 'הדומיין "%" לא תקין (למשל shop.example.com, בלי https://)', _d USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE domain = _d) THEN
    RAISE EXCEPTION 'הדומיין "%" כבר משויך לחנות אחרת', _d USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.tenants (slug, name, domain)
    VALUES (_s, _n, _d)
    RETURNING * INTO t;   -- tenants_seed_settings יוצר את שורות ההגדרות
  EXCEPTION WHEN unique_violation THEN
    -- שתי הקמות במקביל עם אותה כתובת: ה-UNIQUE במסד הכריע
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י חנות אחרת — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;
  RETURN t;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

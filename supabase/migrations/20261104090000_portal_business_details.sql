-- ============================================================
-- הקמת חנות מהשער (nuriel-app2) — פרטי העסק כבר בהקמה (שלב E1)
--
-- עד עכשיו: שם + כתובת → החנות נפתחה, ואת פרטי העסק (ח.פ, סוג עוסק, מע"מ, טלפון)
-- הבעלים היו צריכים למצוא אחר כך בהגדרות — והתקנון הוצג עם מקומות חסרים.
--
--   • portal_create_store_business(_email, _name, _slug, _business) — אותה פתיחה כמו
--     portal_create_store (הפונקציה הקיימת נקראת מבפנים, באותה טרנזקציה), ומיד גם פרטי
--     העסק — באותם שדות שמנהל החנות עורך בהגדרות. לכן התקנון, מדיניות הפרטיות, המסמכים
--     והמיילים מתמלאים מהם אוטומטית (legal-content: business_name / business_tax_id /
--     support_phone / business_email / business_address):
--       legal_name          — שם העסק הרשמי (חובה, 2–120)
--       tax_id              — ח.פ / ע.מ (חובה, 5–12 ספרות — כמו tenants.tax_id)
--       business_type       — authorized (עוסק מורשה) / exempt (עוסק פטור) / company (חברה).
--                             חברה = מורשה לעניין מע"מ (site_settings.business_type נשאר
--                             exempt / authorized); עוסק פטור → מע"מ 0% (הטריגר הקיים)
--       prices_include_vat  — המחירים באתר כוללים מע"מ (ברירת מחדל: כן; בעוסק פטור לא רלוונטי)
--       phone               — טלפון לשירות לקוחות (חובה, 9–15 ספרות) → support_phone +
--                             business_phone
--       address             — כתובת העסק (לא חובה, עד 200)
--     אימייל העסק = אימייל הבעלים (מאומת בשער), אם עוד ריק.
--   • portal_set_store_logo(_email, _tenant, _path) — לוגו שהועלה בהקמה (לא חובה): רק
--     לחנות שהאימייל מנהל בה, ורק לנתיב של החנות עצמה (<tenant>/site/logo-…).
--   שתיהן לשרת בלבד (service_role) — השרת קורא להן אחרי אימות האימייל בשער.
--   portal_create_store הקיים לא השתנה (לשונית ישנה של השער ממשיכה לעבוד).
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261104090000_portal_business_details.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION public.portal_create_store_business(
  _email text, _name text, _slug text, _business jsonb)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b jsonb := COALESCE(_business, '{}'::jsonb);
  _legal text;
  _tax text;
  _kind text;
  _phone text;
  _address text;
  _incl boolean;
  t public.tenants;
BEGIN
  IF jsonb_typeof(_b) <> 'object' THEN
    RAISE EXCEPTION 'פרטי העסק חסרים' USING ERRCODE = 'check_violation';
  END IF;
  _legal := btrim(regexp_replace(COALESCE(_b ->> 'legal_name', ''), '\s+', ' ', 'g'));
  _tax := regexp_replace(COALESCE(_b ->> 'tax_id', ''), '[\s-]', '', 'g');
  _kind := COALESCE(_b ->> 'business_type', '');
  _phone := regexp_replace(btrim(COALESCE(_b ->> 'phone', '')), '[^0-9+]', '', 'g');
  _address := btrim(regexp_replace(COALESCE(_b ->> 'address', ''), '\s+', ' ', 'g'));

  IF length(_legal) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם העסק: 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind NOT IN ('authorized', 'exempt', 'company') THEN
    RAISE EXCEPTION 'יש לבחור את סוג העסק' USING ERRCODE = 'check_violation';
  END IF;
  IF _tax !~ '^[0-9]{5,12}$' THEN
    RAISE EXCEPTION 'מספר ח.פ / ע.מ: 5 עד 12 ספרות' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'טלפון לשירות לקוחות: 9 עד 15 ספרות' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_address) > 200 THEN
    RAISE EXCEPTION 'כתובת העסק: עד 200 תווים' USING ERRCODE = 'check_violation';
  END IF;
  _incl := CASE
    WHEN _kind = 'exempt' THEN true
    WHEN jsonb_typeof(_b -> 'prices_include_vat') = 'boolean' THEN (_b ->> 'prices_include_vat')::boolean
    ELSE true
  END;

  -- הפתיחה עצמה — אותה פונקציה (אימות החשבון, מגבלת החנויות, הכתובת, הבעלים)
  t := public.portal_create_store(_email, _name, _slug);

  UPDATE public.site_settings
     SET business_name      = _legal,
         business_tax_id    = _tax,
         business_type      = CASE WHEN _kind = 'exempt' THEN 'exempt' ELSE 'authorized' END,
         prices_include_vat = _incl,
         support_phone      = _phone,
         business_phone     = _phone,
         business_address   = CASE WHEN _address <> '' THEN _address ELSE business_address END,
         business_email     = CASE WHEN btrim(COALESCE(business_email, '')) = ''
                                   THEN lower(btrim(_email)) ELSE business_email END
   WHERE tenant_id = t.id;

  UPDATE public.tenants SET tax_id = _tax WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.portal_create_store_business(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_create_store_business(text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.portal_set_store_logo(_email text, _tenant uuid, _path text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _p text := btrim(COALESCE(_path, ''));
BEGIN
  IF _tenant IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
         JOIN auth.users u ON u.id = ur.user_id
        WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND NOT ur.is_blocked
          AND lower(u.email) = _e) THEN
    RAISE EXCEPTION 'החנות לא נמצאה בחשבון שלכם' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _p !~ ('^' || _tenant::text || '/site/logo-[0-9]{10,16}\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'נתיב הלוגו לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.site_settings SET logo_path = _p WHERE tenant_id = _tenant;
END $$;
REVOKE ALL ON FUNCTION public.portal_set_store_logo(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_set_store_logo(text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

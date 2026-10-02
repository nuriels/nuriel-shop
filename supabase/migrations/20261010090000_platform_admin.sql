-- ============================================================
-- SaaS מרובה חנויות — חלק 3: מנהל פלטפורמה והקמת חנויות מהדפדפן
-- ============================================================
-- • platform_admins — מנהלי הפלטפורמה כולה (מעל כל החנויות). שונה מ-
--   user_roles.role = 'admin', שהוא מנהל של חנות אחת בלבד.
--   המנהל הראשון מוגדר ע"י deploy/setup-selfhost.sh (PLATFORM_ADMIN_EMAIL).
-- • platform_list_tenants() / platform_create_tenant() — הפונקציות שפאנל
--   הניהול (nuriel.nuri1.fit/platform) קורא להן. כל אחת בודקת בעצמה שהקורא
--   הוא מנהל פלטפורמה, כך שגם קריאה ישירה ל-API לא עוקפת את ההרשאה.
-- • יצירת חנות = שורה ב-tenants; הטריגר מחלק 2 יוצר לה site_settings
--   ו-email_settings. מנהל החנות נוצר בשרת (צריך את ה-Auth API).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- אין מדיניות: גישה רק דרך הפונקציות למטה (SECURITY DEFINER) או service_role
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM anon, authenticated;
GRANT ALL ON public.platform_admins TO service_role;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user_id);
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated, service_role;

-- תת-דומיינים שלא ניתנים כחנות: תשתית, הפלטפורמה, ופרויקטים אחרים בשרת
CREATE OR REPLACE FUNCTION public.platform_reserved_slugs()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'www', 'api', 'admin', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets',
    'studio', 'status', 'help', 'support', 'docs', 'blog', 'test', 'dev', 'staging',
    'nuriel', 'platform', 'kobi', 'kaia', 'moments', 'inv'
  ];
$$;

CREATE OR REPLACE FUNCTION public.platform_list_tenants()
RETURNS TABLE(id uuid, slug text, name text, domain text, is_default boolean,
              created_at timestamptz, admins integer, customers integer,
              products integer, orders integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.domain, t.is_default, t.created_at,
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'admin'),
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'customer'),
         (SELECT count(*)::int FROM public.global_products gp WHERE gp.tenant_id = t.id),
         (SELECT count(*)::int FROM public.orders o WHERE o.tenant_id = t.id)
    FROM public.tenants t
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY t.is_default DESC, t.created_at;
$$;
REVOKE ALL ON FUNCTION public.platform_list_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_tenants() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_create_tenant(_slug text, _name text, _domain text DEFAULT NULL)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(lower(btrim(COALESCE(_domain, ''))), '');
  t public.tenants;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להקים חנויות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _s !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' THEN
    RAISE EXCEPTION 'כתובת החנות: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)';
  END IF;
  IF _s = ANY (public.platform_reserved_slugs()) OR _s LIKE 'api-%' THEN
    RAISE EXCEPTION 'הכתובת "%" שמורה — בחרו כתובת אחרת', _s;
  END IF;
  IF length(_n) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'שם החנות חייב להכיל 1 עד 120 תווים';
  END IF;
  IF _d IS NOT NULL AND _d !~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' THEN
    RAISE EXCEPTION 'הדומיין "%" לא תקין (למשל shop.example.com, בלי https://)', _d;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = _s) THEN
    RAISE EXCEPTION 'כבר קיימת חנות בכתובת "%"', _s;
  END IF;
  IF _d IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE domain = _d) THEN
    RAISE EXCEPTION 'הדומיין "%" כבר משויך לחנות אחרת', _d;
  END IF;

  INSERT INTO public.tenants (slug, name, domain)
  VALUES (_s, _n, _d)
  RETURNING * INTO t;   -- tenants_seed_settings יוצר את שורות ההגדרות
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.platform_create_tenant(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_tenant(text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- SaaS מרובה חנויות — חלק 3: לוח בקרה לחנויות (מנהל-על)
-- ============================================================
-- • tenants: אימייל מנהל החנות, ח.פ / עוסק מורשה, סוג מנוי (trial ברירת
--   מחדל), סטטוס (active / suspended).
--   פרטי הקשר (אימייל, ח.פ) לא נחשפים לגולשים: anon/authenticated רואים
--   ב-tenants רק עמודות ציבוריות.
-- • פונקציות לפאנל הפלטפורמה — כל אחת בודקת בעצמה שהקורא הוא מנהל-על:
--   platform_create_tenant (מורחבת), platform_list_tenants (מורחבת),
--   platform_set_tenant_status, platform_set_tenant_plan,
--   platform_list_admins, platform_add_admin, platform_remove_admin.
-- • חנות מוקפאת נחסמת גם במסד (לא רק בניתוב): הקטלוג ריק ללקוחות,
--   ואי אפשר לפתוח הזמנה חדשה — גם בקריאה ישירה ל-API. הצוות של החנות
--   ממשיך לעבוד בפאנל הניהול שלו.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. שדות חדשים בחנות
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS owner_email TEXT
    CHECK (owner_email IS NULL OR (owner_email = lower(btrim(owner_email))
                                   AND owner_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  ADD COLUMN IF NOT EXISTS tax_id TEXT
    CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{5,12}$'),
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'basic', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tenants.owner_email IS 'אימייל מנהל החנות (המשתמש הראשון)';
COMMENT ON COLUMN public.tenants.tax_id IS 'ח.פ / עוסק מורשה — ספרות בלבד';
COMMENT ON COLUMN public.tenants.plan IS 'סוג מנוי: trial (ברירת מחדל) / basic / pro / enterprise';
COMMENT ON COLUMN public.tenants.status IS 'active / suspended — חנות מוקפאת נעולה ללקוחות';

-- גולשים ומשתמשים רואים רק עמודות ציבוריות (לא אימייל / ח.פ / מנוי)
REVOKE SELECT ON public.tenants FROM anon, authenticated;
GRANT SELECT (id, slug, name, domain, is_default, status, created_at)
  ON public.tenants TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenant_is_active(_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND status = 'active');
$$;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(uuid) TO anon, authenticated, service_role;

-- ============================================================
-- 2. אכיפת הקפאה במסד
-- ============================================================
-- לקוח של חנות מוקפאת לא יכול לפתוח הזמנה (גם לא דרך ה-API); צוות החנות כן
DROP POLICY IF EXISTS tenant_active_for_new_orders ON public.orders;
CREATE POLICY tenant_active_for_new_orders ON public.orders
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.tenant_is_active(tenant_id) OR public.is_staff(auth.uid()));

-- הקטלוג: ללקוחות ולאורחים של חנות מוקפאת — ריק
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE(id uuid, sku character varying, name text, category text, description text, image_url text, images text[], colors text[], barcode text, is_promo boolean, is_out_of_stock boolean, price numeric, original_price numeric, sale_ends_at timestamp with time zone, created_at timestamp with time zone, has_deposit boolean, deposit_price numeric, deposit_units integer, pack_size integer, min_order_quantity integer, is_custom_price boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT
      CASE
        WHEN auth.uid() IS NULL THEN NULL
        WHEN public.is_staff(auth.uid()) THEN 1
        ELSE (
          SELECT cp.price_tier
          FROM public.customer_profiles cp
          JOIN public.user_roles ur ON ur.user_id = cp.user_id
          WHERE cp.user_id = auth.uid()
            AND ur.is_approved = true
            AND ur.is_blocked = false
        )
      END AS tier,
      -- צוות תמיד רואה את המחירון הרגיל; מחירון אישי רק ללקוח עצמו
      CASE
        WHEN auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN false
        ELSE COALESCE((
          SELECT cp.price_list_type = 'custom'
          FROM public.customer_profiles cp
          WHERE cp.user_id = auth.uid()
        ), false)
      END AS has_custom,
      public.current_tenant_id() AS tenant_id
  )
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors, gp.barcode,
    -- "מבצע" = המבצע בפועל בתוקף וגם באמת מוזיל ללקוח הזה
    (gp.is_promo AND pr.sale_applies) AS is_promo,
    gp.is_out_of_stock,
    CASE
      WHEN pr.base_price IS NULL THEN NULL
      WHEN pr.sale_applies THEN gp.sale_price
      ELSE pr.base_price
    END AS price,
    CASE WHEN pr.sale_applies THEN pr.base_price ELSE NULL END AS original_price,
    CASE WHEN pr.sale_applies THEN gp.sale_ends_at ELSE NULL END AS sale_ends_at,
    gp.created_at,
    gp.has_deposit, gp.deposit_price, gp.deposit_units,
    gp.pack_size,
    gp.min_order_quantity,
    (pr.custom_price IS NOT NULL AND NOT pr.sale_applies) AS is_custom_price
  FROM public.global_products gp
  CROSS JOIN viewer v
  CROSS JOIN LATERAL (
    SELECT CASE v.tier
             WHEN 1 THEN gp.price_tier1
             WHEN 2 THEN gp.price_tier2
             WHEN 3 THEN gp.price_tier3
           END AS tier_price
  ) base
  LEFT JOIN public.user_custom_prices ucp
         ON v.has_custom AND base.tier_price IS NOT NULL
        AND ucp.user_id = auth.uid() AND ucp.product_id = gp.id
  CROSS JOIN LATERAL (
    SELECT
      ucp.custom_price,
      COALESCE(ucp.custom_price, base.tier_price) AS base_price,
      (base.tier_price IS NOT NULL
        AND public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)
        AND gp.sale_price < COALESCE(ucp.custom_price, base.tier_price)) AS sale_applies
  ) pr
  WHERE NOT gp.is_hidden
    AND gp.tenant_id = v.tenant_id
    -- חנות מוקפאת: הקטלוג ריק ללקוחות ולאורחים; הצוות של החנות ממשיך לראות
    AND (public.tenant_is_active(v.tenant_id) OR public.is_staff(auth.uid()))
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;

-- ============================================================
-- 3. פאנל הפלטפורמה: חנויות
-- ============================================================
DROP FUNCTION IF EXISTS public.platform_list_tenants();
CREATE FUNCTION public.platform_list_tenants()
RETURNS TABLE(id uuid, slug text, name text, domain text, is_default boolean,
              created_at timestamptz, owner_email text, tax_id text, plan text,
              status text, status_changed_at timestamptz,
              admins integer, customers integer, products integer, orders integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.domain, t.is_default, t.created_at,
         t.owner_email, t.tax_id, t.plan, t.status, t.status_changed_at,
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

DROP FUNCTION IF EXISTS public.platform_create_tenant(text, text, text);
CREATE FUNCTION public.platform_create_tenant(
  _slug text,
  _name text,
  _owner_email text DEFAULT NULL,
  _tax_id text DEFAULT NULL,
  _plan text DEFAULT 'trial',
  _status text DEFAULT 'active',
  _domain text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
  _n text := btrim(COALESCE(_name, ''));
  _e text := NULLIF(lower(btrim(COALESCE(_owner_email, ''))), '');
  -- ח.פ נשמר כספרות בלבד (מקפים ורווחים מהקלדה מוסרים)
  _t text := NULLIF(regexp_replace(COALESCE(_tax_id, ''), '[\s-]', '', 'g'), '');
  _p text := lower(btrim(COALESCE(_plan, 'trial')));
  _st text := lower(btrim(COALESCE(_status, 'active')));
  _d text := NULLIF(lower(btrim(COALESCE(_domain, ''))), '');
  _problem text;
  t public.tenants;
BEGIN
  -- כולל בדיקת הרשאה (מנהל-על), פורמט, כתובות שמורות וכתובת תפוסה
  _problem := public.platform_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;
  IF length(_n) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'שם החנות חייב להכיל 1 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NOT NULL AND _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'אימייל מנהל החנות לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _t IS NOT NULL AND _t !~ '^[0-9]{5,12}$' THEN
    RAISE EXCEPTION 'ח.פ / עוסק מורשה: ספרות בלבד (5 עד 12)' USING ERRCODE = 'check_violation';
  END IF;
  IF _p NOT IN ('trial', 'basic', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'סוג מנוי לא מוכר: %', _p USING ERRCODE = 'check_violation';
  END IF;
  IF _st NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר: %', _st USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND _d !~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' THEN
    RAISE EXCEPTION 'הדומיין "%" לא תקין (למשל shop.example.com, בלי https://)', _d USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants WHERE domain = _d) THEN
    RAISE EXCEPTION 'הדומיין "%" כבר משויך לחנות אחרת', _d USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.tenants (slug, name, domain, owner_email, tax_id, plan, status, status_changed_at)
    VALUES (_s, _n, _d, _e, _t, _p, _st, CASE WHEN _st <> 'active' THEN now() END)
    RETURNING * INTO t;   -- tenants_seed_settings יוצר את שורות ההגדרות
  EXCEPTION WHEN unique_violation THEN
    -- שתי הקמות במקביל עם אותה כתובת: ה-UNIQUE במסד הכריע
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י חנות אחרת — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.platform_create_tenant(text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_tenant(text, text, text, text, text, text, text) TO authenticated, service_role;

-- הקפאה / שחרור חנות
CREATE OR REPLACE FUNCTION public.platform_set_tenant_status(_tenant uuid, _status text)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _st text := lower(btrim(COALESCE(_status, '')));
  t public.tenants;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לשנות סטטוס חנות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _st NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר: %', _st USING ERRCODE = 'check_violation';
  END IF;
  IF _st = 'suspended' AND EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND is_default) THEN
    RAISE EXCEPTION 'החנות הראשית של הפלטפורמה לא ניתנת להקפאה' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.tenants
     SET status = _st,
         status_changed_at = CASE WHEN status IS DISTINCT FROM _st THEN now() ELSE status_changed_at END
   WHERE id = _tenant
  RETURNING * INTO t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_tenant_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tenant_status(uuid, text) TO authenticated, service_role;

-- עדכון סוג מנוי
CREATE OR REPLACE FUNCTION public.platform_set_tenant_plan(_tenant uuid, _plan text)
RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p text := lower(btrim(COALESCE(_plan, '')));
  t public.tenants;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לשנות מנוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _p NOT IN ('trial', 'basic', 'pro', 'enterprise') THEN
    RAISE EXCEPTION 'סוג מנוי לא מוכר: %', _p USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.tenants SET plan = _p WHERE id = _tenant RETURNING * INTO t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_tenant_plan(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tenant_plan(uuid, text) TO authenticated, service_role;

-- ============================================================
-- 4. פאנל הפלטפורמה: מנהלי-על
-- ============================================================
CREATE OR REPLACE FUNCTION public.platform_list_admins()
RETURNS TABLE(user_id uuid, email text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pa.user_id, u.email::text, pa.created_at
    FROM public.platform_admins pa
    JOIN auth.users u ON u.id = pa.user_id
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY pa.created_at;
$$;
REVOKE ALL ON FUNCTION public.platform_list_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_admins() TO authenticated, service_role;

-- הוספה לפי אימייל של חשבון קיים (מי שעוד לא נרשם — נרשם/מתחבר פעם אחת קודם)
CREATE OR REPLACE FUNCTION public.platform_add_admin(_email text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להוסיף מנהלי-על' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.id INTO _uid FROM auth.users u WHERE lower(u.email) = _e;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'אין חשבון עם האימייל %. המשתמש צריך להירשם או להתחבר פעם אחת, ואז להוסיף אותו', _e;
  END IF;
  INSERT INTO public.platform_admins (user_id) VALUES (_uid) ON CONFLICT (user_id) DO NOTHING;
  RETURN _uid;
END $$;
REVOKE ALL ON FUNCTION public.platform_add_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_add_admin(text) TO authenticated, service_role;

-- הסרה — לא את עצמך ולא את האחרון (שלא יישאר פאנל בלי מנהל)
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
  IF (SELECT count(*) FROM public.platform_admins) <= 1 THEN
    RAISE EXCEPTION 'חייב להישאר לפחות מנהל-על אחד';
  END IF;
  DELETE FROM public.platform_admins WHERE user_id = _user_id;
END $$;
REVOKE ALL ON FUNCTION public.platform_remove_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_remove_admin(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

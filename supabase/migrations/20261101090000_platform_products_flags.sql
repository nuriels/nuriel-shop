-- ============================================================
-- פלטפורמה — סוג מוצר לכל Tenant + דגלי פיצ'רים (Hospitality Stage 1a)
-- ============================================================
-- מה המיגרציה עושה (הכל תוספתי; התנהגות החנויות הקיימות לא משתנה):
--   1. tenants.site_type — 'ecommerce' (ברירת מחדל, כל החנויות הקיימות) או
--      'hospitality'. לא ניתן לשינוי אחרי היצירה.
--   2. current_site_type() — סוג המוצר של החנות של הבקשה הנוכחית.
--   3. platform_product_roles + טריגר על user_roles: מוצר שרשם תפקידים מקבל
--      רק אותם. מוצר שלא רשם תפקידים — אין הגבלה (Ecommerce לא רשום כאן,
--      ולכן לא מושפע). Hospitality ירשום את התפקידים שלו במיגרציה שלו.
--   4. דגלי פיצ'רים כלליים: platform_feature_flags, tenant_feature_flags,
--      platform_feature_enabled(), platform_set_flag(). כל הדגלים כבויים.
--      אין גישה ישירה לטבלאות מה-API — רק דרך הפונקציות.
--   5. platform_seed_tenant_shared() — שורות ההגדרות המשותפות (site_settings,
--      email_settings) לחנות חדשה; ישמש מנועים שאינם Ecommerce.
--   6. הטריגר הקיים tenants_seed_settings רץ מעכשיו רק כש-site_type =
--      'ecommerce' (תנאי WHEN). גוף הפונקציה לא שונה — לחנויות Ecommerce
--      אותן שורות בדיוק כמו קודם.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101090000_platform_products_flags.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. סוג המוצר
-- ------------------------------------------------------------
-- DEFAULT קבוע: מילוי מיידי של השורות הקיימות בלי UPDATE (בלי טריגרים, בלי נעילה ארוכה)
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS site_type text NOT NULL DEFAULT 'ecommerce';
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_site_type_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_site_type_check
  CHECK (site_type IN ('ecommerce', 'hospitality'));
COMMENT ON COLUMN public.tenants.site_type IS
  'סוג המוצר של ה-Tenant: ecommerce (חנות) / hospitality (אתר אירוח). לא ניתן לשינוי אחרי היצירה.';

CREATE OR REPLACE FUNCTION public.tenants_site_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.site_type IS DISTINCT FROM OLD.site_type THEN
    RAISE EXCEPTION 'אי אפשר לשנות את סוג האתר אחרי שנפתח'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tenants_site_type_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_site_type_immutable ON public.tenants;
CREATE TRIGGER tenants_site_type_immutable
BEFORE UPDATE OF site_type ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_site_type_immutable();

-- סוג המוצר של החנות של הבקשה (NULL אם החנות לא זוהתה)
CREATE OR REPLACE FUNCTION public.current_site_type()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.site_type FROM public.tenants t WHERE t.id = public.current_tenant_id();
$$;
REVOKE ALL ON FUNCTION public.current_site_type() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_site_type() TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 2. תפקידים מותרים לפי מוצר
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_product_roles (
  product text NOT NULL CHECK (product IN ('ecommerce', 'hospitality')),
  role    text NOT NULL CHECK (role ~ '^[a-z_]{2,32}$'),
  PRIMARY KEY (product, role)
);
ALTER TABLE public.platform_product_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_product_roles FROM anon, authenticated;
GRANT ALL ON public.platform_product_roles TO service_role;
COMMENT ON TABLE public.platform_product_roles IS
  'התפקידים שכל מוצר מקבל ב-user_roles. מוצר בלי שורות כאן — אין הגבלה (התנהגות קיימת).';

CREATE OR REPLACE FUNCTION public.user_roles_product_role_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _product text;
BEGIN
  SELECT t.site_type INTO _product FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF _product IS NULL THEN
    RETURN NEW;  -- tenant_id לא קיים: המפתח הזר ידחה את השורה
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_product_roles r WHERE r.product = _product)
     AND NOT EXISTS (SELECT 1 FROM public.platform_product_roles r
                      WHERE r.product = _product AND r.role = NEW.role) THEN
    RAISE EXCEPTION 'התפקיד % לא קיים באתר מסוג %', NEW.role, _product
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.user_roles_product_role_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_product_role_guard ON public.user_roles;
CREATE TRIGGER user_roles_product_role_guard
BEFORE INSERT OR UPDATE OF role, tenant_id ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.user_roles_product_role_guard();

-- ------------------------------------------------------------
-- 3. דגלי פיצ'רים (כלליים — המנועים רושמים את המפתחות שלהם)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_feature_flags (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  enabled     boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.platform_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_feature_flags FROM anon, authenticated;
GRANT ALL ON public.platform_feature_flags TO service_role;

CREATE TABLE IF NOT EXISTS public.tenant_feature_flags (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key        text NOT NULL REFERENCES public.platform_feature_flags(key) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE public.tenant_feature_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_feature_flags FROM anon, authenticated;
GRANT ALL ON public.tenant_feature_flags TO service_role;

-- דגל פעיל לחנות = פעיל בפלטפורמה וגם לחנות. מפתח לא מוכר = כבוי.
CREATE OR REPLACE FUNCTION public.platform_feature_enabled(_key text, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT f.enabled FROM public.platform_feature_flags f WHERE f.key = _key), false)
     AND COALESCE(
    (SELECT tf.enabled FROM public.tenant_feature_flags tf
      WHERE tf.key = _key AND tf.tenant_id = _tenant_id), false);
$$;
REVOKE ALL ON FUNCTION public.platform_feature_enabled(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_feature_enabled(text, uuid) TO authenticated, service_role;

-- הפעלה / כיבוי — מנהל פלטפורמה בלבד (גם בקריאה ישירה ל-API), עם רישום ביומן.
-- _tenant_id NULL = הדגל ברמת הפלטפורמה; אחרת — לחנות אחת.
CREATE OR REPLACE FUNCTION public.platform_set_flag(_key text, _enabled boolean, _tenant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF NOT public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לשנות דגלים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'ערך הדגל חסר' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_feature_flags f WHERE f.key = _key) THEN
    RAISE EXCEPTION 'דגל לא מוכר: %', _key USING ERRCODE = 'no_data_found';
  END IF;

  IF _tenant_id IS NULL THEN
    UPDATE public.platform_feature_flags
       SET enabled = _enabled, updated_at = now(), updated_by = _uid
     WHERE key = _key;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id) THEN
      RAISE EXCEPTION 'החנות לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled, updated_at, updated_by)
    VALUES (_tenant_id, _key, _enabled, now(), _uid)
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _uid;
  END IF;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant_id, _uid, 'feature_flag_set',
          jsonb_build_object('key', _key, 'enabled', _enabled,
                             'scope', CASE WHEN _tenant_id IS NULL THEN 'platform' ELSE 'tenant' END));
  RETURN _enabled;
END $$;
REVOKE ALL ON FUNCTION public.platform_set_flag(text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_flag(text, boolean, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. הגדרות משותפות לחנות חדשה (למנועים שאינם Ecommerce)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_seed_tenant_shared(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  SELECT t.name INTO _name FROM public.tenants t WHERE t.id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (_tenant_id, _name, '')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.platform_seed_tenant_shared(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_seed_tenant_shared(uuid) TO service_role;

-- ------------------------------------------------------------
-- 5. ה-seed הקיים של Ecommerce — רק לחנויות Ecommerce (גוף הפונקציה לא שונה)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS tenants_seed_settings ON public.tenants;
CREATE TRIGGER tenants_seed_settings
AFTER INSERT ON public.tenants
FOR EACH ROW
WHEN (NEW.site_type = 'ecommerce')
EXECUTE FUNCTION public.tenants_seed_settings();

COMMIT;

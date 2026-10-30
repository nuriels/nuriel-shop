-- ============================================================
-- Rollback: 20261101090000_platform_products_flags.sql
-- מחזיר את המצב הקודם בדיוק: הטריגר הקיים בלי תנאי WHEN, בלי site_type,
-- בלי טבלאות הדגלים ובלי כלל התפקידים לפי מוצר.
-- להריץ רק אחרי rollback של כל המיגרציות שתלויות בזה (Hospitality, guard).
-- אם כבר קיימות חנויות שאינן ecommerce — עוצרים (אין לאבד את סוג האתר שלהן).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'site_type')
     AND EXISTS (SELECT 1 FROM public.tenants WHERE site_type <> 'ecommerce') THEN
    RAISE EXCEPTION 'קיימות חנויות שאינן ecommerce — אי אפשר להסיר את site_type';
  END IF;
END $$;

-- הטריגר הקיים — כמו שהיה (בלי WHEN)
DROP TRIGGER IF EXISTS tenants_seed_settings ON public.tenants;
CREATE TRIGGER tenants_seed_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_seed_settings();

DROP FUNCTION IF EXISTS public.platform_seed_tenant_shared(uuid);
DROP FUNCTION IF EXISTS public.platform_set_flag(text, boolean, uuid);
DROP FUNCTION IF EXISTS public.platform_feature_enabled(text, uuid);
DROP TABLE IF EXISTS public.tenant_feature_flags;
DROP TABLE IF EXISTS public.platform_feature_flags;

DROP TRIGGER IF EXISTS user_roles_product_role_guard ON public.user_roles;
DROP FUNCTION IF EXISTS public.user_roles_product_role_guard();
DROP TABLE IF EXISTS public.platform_product_roles;

DROP FUNCTION IF EXISTS public.current_site_type();
DROP TRIGGER IF EXISTS tenants_site_type_immutable ON public.tenants;
DROP FUNCTION IF EXISTS public.tenants_site_type_immutable();
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_site_type_check;
ALTER TABLE public.tenants DROP COLUMN IF EXISTS site_type;

COMMIT;

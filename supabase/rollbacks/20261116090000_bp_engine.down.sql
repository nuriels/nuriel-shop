-- ============================================================
-- Rollback של 20261116090000_bp_engine.sql (מיגרציה 193 — מנוע אתרי עסקים, Stage 1)
-- הגנה: נעצר כשקיים אתר עסק כלשהו (tenants.site_type = 'business_profile') או שורה בסכמה business_profile —
-- rollback היה מוחק את האתר, הטיוטות וההיסטוריה שלו. לפני rollback כזה — גיבוי, והחלטה מפורשת.
-- בלי נתונים: הסכמה, 17 הפונקציות, שני הדגלים ותפקיד המוצר נמחקים, וה-CHECK של סוג האתר חוזר לשני סוגים.
-- רשומות היומן של הפלטפורמה (bp_*) נשארות. לפני ה-rollback: האפליקציה חוזרת לגרסה בלי המנוע.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.site_type = 'business_profile') THEN
    RAISE EXCEPTION 'יש אתרי עסקים (business_profile) — rollback היה מוחק אותם. לא מבוצע';
  END IF;
  IF to_regclass('business_profile.site_versions') IS NOT NULL
     AND (EXISTS (SELECT 1 FROM business_profile.site_versions) OR EXISTS (SELECT 1 FROM business_profile.sites)) THEN
    RAISE EXCEPTION 'יש נתונים בסכמה business_profile — rollback היה מוחק אותם. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.platform_bp_open_site(text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.platform_bp_set_owner(uuid, text);
DROP FUNCTION IF EXISTS public.platform_bp_sites();
DROP FUNCTION IF EXISTS public.platform_bp_review(uuid);
DROP FUNCTION IF EXISTS public.platform_bp_approve_publish(uuid, uuid);
DROP FUNCTION IF EXISTS public.platform_bp_reject_publish(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.platform_bp_set_public(uuid, boolean);
DROP FUNCTION IF EXISTS public.bp_studio_context();
DROP FUNCTION IF EXISTS public.bp_draft_get();
DROP FUNCTION IF EXISTS public.bp_draft_save(jsonb, integer);
DROP FUNCTION IF EXISTS public.bp_publish(integer, text);
DROP FUNCTION IF EXISTS public.bp_cancel_publish_request();
DROP FUNCTION IF EXISTS public.bp_versions();
DROP FUNCTION IF EXISTS public.bp_version_get(uuid);
DROP FUNCTION IF EXISTS public.bp_version_restore(uuid, integer);
DROP FUNCTION IF EXISTS public.bp_public_site();
DROP FUNCTION IF EXISTS public.bp_site_head();

DROP SCHEMA IF EXISTS business_profile CASCADE;

-- הדגלים (השורות של האתרים נמחקות איתם — ON DELETE CASCADE)
DELETE FROM public.platform_feature_flags WHERE key IN ('business_profile_enabled', 'business_profile_public');

DELETE FROM public.platform_product_roles WHERE product = 'business_profile';
ALTER TABLE public.platform_product_roles DROP CONSTRAINT IF EXISTS platform_product_roles_product_check;
ALTER TABLE public.platform_product_roles ADD CONSTRAINT platform_product_roles_product_check
  CHECK (product IN ('ecommerce', 'hospitality'));

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_site_type_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_site_type_check
  CHECK (site_type IN ('ecommerce', 'hospitality'));

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Rollback: 20261101110000_hosp_schema.sql
-- מסיר את הטבלאות, הפונקציות, מדיניות הדלי ורישומי Hospitality
-- (תפקידים, דגלים). הסכמה hospitality עצמה נשארת (ריקה): אם היא חשופה
-- ב-PGRST_DB_SCHEMAS, סכמה חסרה מפילה את כל ה-API (503).
-- נעצר אם קיים אתר אירוח (אין מחיקה שקטה של נתוני לקוחות), או אם נשארו
-- בסכמה אובייקטים של מיגרציה מאוחרת יותר (קודם ה-rollback שלה).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants WHERE site_type = 'hospitality') THEN
    RAISE EXCEPTION 'יש אתרי אירוח — מחקו אותם (או גבו את הנתונים) לפני rollback של סכמת Hospitality';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'hosp-media') THEN
    RAISE EXCEPTION 'יש קבצים בדלי hosp-media — מחקו אותם לפני rollback';
  END IF;
END $$;

DROP POLICY IF EXISTS "hosp media staff read" ON storage.objects;
DROP POLICY IF EXISTS "hosp media staff insert" ON storage.objects;
DROP POLICY IF EXISTS "hosp media staff update" ON storage.objects;
DROP POLICY IF EXISTS "hosp media staff delete" ON storage.objects;
-- גרסאות חדשות של Supabase Storage חוסמות מחיקה ישירה (protect_delete); הדלי
-- ריק (נבדק למעלה), ולכן מותר כאן — רק בטרנזקציה הזו. בגרסאות ישנות אין השפעה.
SET LOCAL storage.allow_delete_query = 'true';
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id = 'hosp-media';
  END IF;
END $$;

DROP TABLE IF EXISTS hospitality.promotions;
DROP TABLE IF EXISTS hospitality.rate_rules;
DROP TABLE IF EXISTS hospitality.media;
DROP TABLE IF EXISTS hospitality.unit_amenities;
DROP TABLE IF EXISTS hospitality.amenities;
DROP TABLE IF EXISTS hospitality.unit_beds;
DROP TABLE IF EXISTS hospitality.unit_members;
DROP TABLE IF EXISTS hospitality.units;
DROP TABLE IF EXISTS hospitality.properties;
DROP TABLE IF EXISTS hospitality.policies;
DROP TABLE IF EXISTS hospitality.settings;

DROP FUNCTION IF EXISTS hospitality.admin_create_site(text, text, text, text);
DROP FUNCTION IF EXISTS hospitality.units_membership_guard();
DROP FUNCTION IF EXISTS hospitality.unit_members_validate();
DROP FUNCTION IF EXISTS hospitality.policies_default_guard();
DROP FUNCTION IF EXISTS hospitality.policies_validate();
DROP FUNCTION IF EXISTS hospitality.settings_validate();
DROP FUNCTION IF EXISTS hospitality.touch_updated_at();
DROP FUNCTION IF EXISTS hospitality.tenant_guard();
DROP FUNCTION IF EXISTS hospitality.request_tenant();
DROP FUNCTION IF EXISTS hospitality.can(text);
DROP FUNCTION IF EXISTS hospitality.permissions();
DROP FUNCTION IF EXISTS hospitality.flag_for(text, uuid);
DROP FUNCTION IF EXISTS hospitality.flag(text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'hospitality'::regnamespace)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'hospitality'::regnamespace)
     OR EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'hospitality'::regnamespace) THEN
    RAISE EXCEPTION 'נשארו אובייקטים בסכמה hospitality — קודם ה-rollback של המיגרציות המאוחרות יותר';
  END IF;
END $$;

DELETE FROM public.platform_feature_flags WHERE key LIKE 'hospitality\_%';
DELETE FROM public.platform_product_roles WHERE product = 'hospitality';

COMMIT;

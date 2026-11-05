-- ============================================================
-- Rollback ל-20261107100000_lic_digital_licenses.sql: הסרת מודול הרישיונות הדיגיטליים.
-- שימו לב: מוחק גם את נתוני המודול (שליחות, קישורים, יומן, רשומות קבצים) — לגבות לפני.
-- הדלי הפרטי license-files והקבצים שבו נשארים באחסון (Supabase חוסם מחיקה ישירה מ-SQL);
-- למחוק דרך ה-Storage API אחרי גיבוי, אם רוצים.
-- ============================================================
BEGIN;

DROP TABLE IF EXISTS public.license_audit;
DROP TABLE IF EXISTS public.license_download_links;
DROP TABLE IF EXISTS public.license_deliveries;
DROP TABLE IF EXISTS public.license_files;

DROP FUNCTION IF EXISTS public.license_link_peek(text);
DROP FUNCTION IF EXISTS public.license_consume_download(text);
DROP FUNCTION IF EXISTS public.license_set_default_file(uuid);
DROP FUNCTION IF EXISTS public.license_check_refs();
DROP FUNCTION IF EXISTS public.license_audit_append_only();

-- הדגל (וההפעלות לחנויות — tenant_feature_flags נמחקות ב-CASCADE)
DELETE FROM public.platform_feature_flags WHERE key = 'digital_licenses';

NOTIFY pgrst, 'reload schema';

COMMIT;

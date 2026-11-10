-- Rollback של 20261110210000_hosp_consent.sql (Google SEO שלב 4 — הסכמה ל-Cookies, כבוי)
-- מוחק את שתי הפונקציות, את טבלת הרשומות ואת המתג (גם ההגדרות שלו לאתרים — ON DELETE CASCADE).
-- הרשומות עצמן אנונימיות; אם יש בהן משהו — מגבים לפני (pg_dump) כמו לפני כל Rollback.
BEGIN;
SET LOCAL client_min_messages = warning;
DROP FUNCTION IF EXISTS hospitality.site_consent_record(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS hospitality.analytics_enabled();
DROP TABLE IF EXISTS hospitality.consent_records;
DELETE FROM public.platform_feature_flags WHERE key = 'hospitality_analytics_enabled';
NOTIFY pgrst, 'reload schema';
COMMIT;

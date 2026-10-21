-- ============================================================
-- אימות בעלות ב-Google Search Console — לכל חנות בנפרד (שיווק ואינטגרציות)
--   google_site_verification — ערך ה-content של מטא תג האימות (נכנס ל-<head>)
--   google_verification_file — שם קובץ האימות (googleXXXX.html); האתר מגיש אותו
--                             בשורש הדומיין של החנות עם התוכן שגוגל מצפה לו
-- שניהם נבדקים בפורמט המדויק — לא נכנס לדף שום תו אחר.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS google_site_verification TEXT,
  ADD COLUMN IF NOT EXISTS google_verification_file TEXT;

DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_google_verification_check
    CHECK ((google_site_verification IS NULL OR google_site_verification ~ '^[A-Za-z0-9_-]{20,100}$')
           AND (google_verification_file IS NULL OR google_verification_file ~ '^google[0-9a-f]{8,32}\.html$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.site_settings.google_site_verification IS 'Google Search Console: content של מטא תג האימות';
COMMENT ON COLUMN public.site_settings.google_verification_file IS 'Google Search Console: שם קובץ האימות (googleXXXX.html)';

NOTIFY pgrst, 'reload schema';
COMMIT;

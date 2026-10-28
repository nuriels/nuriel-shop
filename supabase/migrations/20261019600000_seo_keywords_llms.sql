-- ============================================================
-- SEO ברמת החנות: מילות מפתח + llms.txt אוטומטי
-- ============================================================
-- תוספות בלבד (ברירת מחדל: ריק / כבוי — אף חנות לא משתנה עד שמפעילים):
--   * site_settings.seo_keywords — מילות מפתח של החנות ("מילה, מילה"), עד 500 תווים
--   * site_settings.llms_txt_enabled — מפעיל את /llms.txt (נוצר אוטומטית מנתוני החנות)
-- דרך חזרה: supabase/rollbacks/20261019600000_seo_keywords_llms.down.sql
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS seo_keywords text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS llms_txt_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_seo_keywords_check'
                  AND conrelid = 'public.site_settings'::regclass) THEN
    ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_seo_keywords_check
      CHECK (char_length(seo_keywords) <= 500);
  END IF;
END $$;

COMMENT ON COLUMN public.site_settings.seo_keywords IS 'מילות מפתח של החנות (מופרדות בפסיק) — <meta name="keywords">';
COMMENT ON COLUMN public.site_settings.llms_txt_enabled IS 'מפעיל /llms.txt — תקציר החנות לכלי בינה מלאכותית, נוצר אוטומטית';

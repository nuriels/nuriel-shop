-- ביטול 20261019600000_seo_keywords_llms
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_seo_keywords_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS seo_keywords,
  DROP COLUMN IF EXISTS llms_txt_enabled;

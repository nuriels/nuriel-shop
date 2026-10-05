-- ============================================================
-- חלק 19: עמוד המוצר + באנר צדדי למסכי מחשב
--
-- 1. באנר צדדי (Desktop only) בהגדרות האתר:
--    desktop_banner_active    — להציג / לא (ברירת מחדל: לא)
--    desktop_banner_image_url — הקישור הציבורי לתמונה (מועלית לדלי branding,
--                               תיקיית site/ של החנות — כמו הלוגו). בלי מגבלת אורך.
--    desktop_banner_link      — לאן הבאנר מוביל (לא חובה): כתובת מלאה
--                               (https://…) או עמוד באתר (/?category=מבצעים).
--    site_settings קריא לכולם (האתר מציג את הבאנר לאורחים) — אין כאן סודות.
--    הבדיקות במסד (טריגר): רווחים → NULL, רק http/https לתמונה, קישור בטוח בלבד
--    (בלי javascript: / data:), ובאנר פעיל חייב תמונה.
--
-- 2. תיאור המוצר נשמר עכשיו כ-HTML מעורך הטקסט העשיר — עד 20,000 תווים
--    (NOT VALID: חל על שמירות חדשות בלבד; מוצרים קיימים לא נבדקים מחדש).
--    הניקוי מ-XSS נעשה בכל הצגה (DOMPurify ברשימה סגורה — src/lib/rich-text.ts).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. באנר צדדי
-- ------------------------------------------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS desktop_banner_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS desktop_banner_image_url text,
  ADD COLUMN IF NOT EXISTS desktop_banner_link text;

COMMENT ON COLUMN public.site_settings.desktop_banner_active IS
  'באנר צדדי במסכי מחשב (lg ומעלה) — מוצג רק כשפעיל ויש תמונה';
COMMENT ON COLUMN public.site_settings.desktop_banner_image_url IS
  'קישור ציבורי לתמונת הבאנר (דלי branding, <tenant>/site/...)';
COMMENT ON COLUMN public.site_settings.desktop_banner_link IS
  'לאן הבאנר מוביל: https://… או נתיב באתר (/…); NULL = בלי קישור';

CREATE OR REPLACE FUNCTION public.site_settings_desktop_banner_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.desktop_banner_image_url := NULLIF(btrim(COALESCE(NEW.desktop_banner_image_url, '')), '');
  NEW.desktop_banner_link := NULLIF(btrim(COALESCE(NEW.desktop_banner_link, '')), '');

  IF NEW.desktop_banner_image_url IS NOT NULL
     AND NEW.desktop_banner_image_url !~* '^https?://[^\s"''<>]+$' THEN
    RAISE EXCEPTION 'קישור תמונת הבאנר לא תקין — העלו את התמונה מחדש'
      USING ERRCODE = 'check_violation';
  END IF;

  -- כתובת מלאה, או נתיב באתר שמתחיל ב-/ (לא // — זה כבר אתר אחר)
  IF NEW.desktop_banner_link IS NOT NULL AND (
       char_length(NEW.desktop_banner_link) > 2000
       OR NEW.desktop_banner_link !~* '^(https?://[^\s"''<>]+|/(?!/)[^\s"''<>]*)$') THEN
    RAISE EXCEPTION 'הקישור של הבאנר: כתובת מלאה (https://…) או עמוד באתר (למשל /?category=מבצעים)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.desktop_banner_active AND NEW.desktop_banner_image_url IS NULL THEN
    RAISE EXCEPTION 'כדי להציג את הבאנר צריך קודם להעלות תמונה'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.site_settings_desktop_banner_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS site_settings_desktop_banner_guard ON public.site_settings;
CREATE TRIGGER site_settings_desktop_banner_guard
  BEFORE INSERT OR UPDATE OF desktop_banner_active, desktop_banner_image_url, desktop_banner_link
  ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_desktop_banner_guard();

-- ------------------------------------------------------------
-- 2. תיאור מוצר (HTML) — עד 20,000 תווים
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'global_products_description_length'
                    AND conrelid = 'public.global_products'::regclass) THEN
    ALTER TABLE public.global_products
      ADD CONSTRAINT global_products_description_length
      CHECK (description IS NULL OR char_length(description) <= 20000) NOT VALID;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- עיצוב מסך הבית: הפעלה / השבתה לכל באנר, תמונת פוסטר לסרטון, זמן החלפה
-- ============================================================
-- תוספות בלבד — אין מחיקת עמודות או שורות, ואין שינוי בנתונים קיימים:
--   * home_banner_slides.is_active — ברירת מחדל true, כך שכל הבאנרים הקיימים
--     נשארים מוצגים בדיוק כמו קודם.
--   * desktop_poster_url / mobile_poster_url — תמונה שמוצגת לפני שהסרטון נטען
--     ובמקומו אם הטעינה נכשלת. NULL = בלי פוסטר (כמו היום).
--   * site_settings.banner_interval_seconds — כל כמה שניות מתחלפים הבאנרים.
--     ברירת מחדל 5 — זהה לזמן הקבוע שהיה בקוד.
--   * replace_home_banners — שומר גם את השדות החדשים, ומוחק במפורש רק את
--     הבאנרים של החנות הנוכחית (בנוסף להפרדה של ה-RLS).
-- אידמפוטנטי — אפשר להריץ שוב. דרך חזרה: supabase/rollbacks/20261019560000_home_design.down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. באנרים: פעיל / כבוי + פוסטרים
-- ------------------------------------------------------------
ALTER TABLE public.home_banner_slides
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS desktop_poster_url text,
  ADD COLUMN IF NOT EXISTS mobile_poster_url text;

COMMENT ON COLUMN public.home_banner_slides.is_active IS
  'false = הבאנר נשמר אבל לא מוצג באתר (מושבת זמנית)';
COMMENT ON COLUMN public.home_banner_slides.desktop_poster_url IS
  'תמונת פוסטר לסרטון המחשב (דלי branding, <tenant>/site/banners/...); NULL = בלי';
COMMENT ON COLUMN public.home_banner_slides.mobile_poster_url IS
  'תמונת פוסטר לסרטון הנייד; NULL = בלי';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'home_banner_slides_poster_url_check'
                    AND conrelid = 'public.home_banner_slides'::regclass) THEN
    ALTER TABLE public.home_banner_slides
      ADD CONSTRAINT home_banner_slides_poster_url_check CHECK (
        (desktop_poster_url IS NULL OR desktop_poster_url ~* '^https?://[^[:space:]"''<>]+$')
        AND (mobile_poster_url IS NULL OR mobile_poster_url ~* '^https?://[^[:space:]"''<>]+$'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. זמן החלפה בין הבאנרים (לכל חנות)
-- ------------------------------------------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS banner_interval_seconds integer NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.site_settings.banner_interval_seconds IS
  'כל כמה שניות מתחלפים הבאנרים במסך הבית (3–15). סרטון מתנגן עד סופו לפני ההחלפה';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'site_settings_banner_interval_check'
                    AND conrelid = 'public.site_settings'::regclass) THEN
    ALTER TABLE public.site_settings
      ADD CONSTRAINT site_settings_banner_interval_check
      CHECK (banner_interval_seconds BETWEEN 3 AND 15);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. שמירת כל הבאנרים בפעולה אחת — עם השדות החדשים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_home_banners(_slides JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  saved INTEGER;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לעדכן את באנרי מסך הבית';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'לא זוהתה החנות — הבאנרים לא נשמרו';
  END IF;
  IF _slides IS NULL OR jsonb_typeof(_slides) <> 'array' THEN
    RAISE EXCEPTION 'נתוני באנרים לא תקינים';
  END IF;

  -- רק הבאנרים של החנות הנוכחית (גם ה-RLS מגביל לחנות — זו הגנה נוספת)
  DELETE FROM public.home_banner_slides WHERE tenant_id = _tenant;

  INSERT INTO public.home_banner_slides (
    tenant_id, placement, position,
    desktop_image_url, desktop_width, desktop_height,
    mobile_image_url, mobile_width, mobile_height,
    show_desktop, show_mobile, link_url, alt_text,
    is_active, desktop_poster_url, mobile_poster_url
  )
  SELECT _tenant,
         x ->> 'placement',
         COALESCE((x ->> 'position')::integer, 0),
         NULLIF(x ->> 'desktop_image_url', ''),
         (x ->> 'desktop_width')::integer,
         (x ->> 'desktop_height')::integer,
         NULLIF(x ->> 'mobile_image_url', ''),
         (x ->> 'mobile_width')::integer,
         (x ->> 'mobile_height')::integer,
         COALESCE((x ->> 'show_desktop')::boolean, true),
         COALESCE((x ->> 'show_mobile')::boolean, true),
         NULLIF(btrim(COALESCE(x ->> 'link_url', '')), ''),
         COALESCE(x ->> 'alt_text', ''),
         -- גרסה ישנה של האתר (בלי השדה) — הבאנר נשאר פעיל, כמו קודם
         COALESCE((x ->> 'is_active')::boolean, true),
         NULLIF(btrim(COALESCE(x ->> 'desktop_poster_url', '')), ''),
         NULLIF(btrim(COALESCE(x ->> 'mobile_poster_url', '')), '')
    FROM jsonb_array_elements(_slides) AS x;

  GET DIAGNOSTICS saved = ROW_COUNT;
  RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION public.replace_home_banners(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_home_banners(JSONB) TO authenticated;

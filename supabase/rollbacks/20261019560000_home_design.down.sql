-- ============================================================
-- דרך חזרה ל-20261019560000_home_design.sql (להרצה ידנית בלבד, רק במקרה של תקלה)
-- ============================================================
-- הקובץ לא בתיקיית migrations, ולכן setup-selfhost.sh לא מריץ אותו אוטומטית.
-- הרצה:  psql ... -v ON_ERROR_STOP=1 -f supabase/rollbacks/20261019560000_home_design.down.sql
--   ואז:  DELETE FROM public._migrations_applied WHERE filename = '20261019560000_home_design.sql';
--
-- מה נשמר: כל הבאנרים, התמונות והקישורים. מה הולך לאיבוד: הפוסטרים וזמן ההחלפה
-- (חוזר ל-5 שניות הקבועות בקוד הישן). באנר שהיה מושבת (is_active = false) מוסתר
-- גם במחשב וגם בנייד לפני הסרת העמודה — כדי שלא יופיע פתאום באתר.
-- חשוב: להריץ רק אחרי החזרת קוד האתר לגרסה הקודמת.
-- ============================================================
BEGIN;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('public.home_banner_slides', 'desktop_poster_url IS NOT NULL OR mobile_poster_url IS NOT NULL', 'תמונות פוסטר של באנרי מסך הבית'),
      ('public.site_settings', 'banner_interval_seconds <> 5', 'זמן החלפת באנרים שהוגדר')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

UPDATE public.home_banner_slides
   SET show_desktop = false, show_mobile = false
 WHERE is_active = false;

CREATE OR REPLACE FUNCTION public.replace_home_banners(_slides JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  saved INTEGER;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לעדכן את באנרי מסך הבית';
  END IF;
  IF _slides IS NULL OR jsonb_typeof(_slides) <> 'array' THEN
    RAISE EXCEPTION 'נתוני באנרים לא תקינים';
  END IF;

  DELETE FROM public.home_banner_slides WHERE true;

  INSERT INTO public.home_banner_slides (
    placement, position,
    desktop_image_url, desktop_width, desktop_height,
    mobile_image_url, mobile_width, mobile_height,
    show_desktop, show_mobile, link_url, alt_text
  )
  SELECT x ->> 'placement',
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
         COALESCE(x ->> 'alt_text', '')
    FROM jsonb_array_elements(_slides) AS x;

  GET DIAGNOSTICS saved = ROW_COUNT;
  RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION public.replace_home_banners(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_home_banners(JSONB) TO authenticated;

ALTER TABLE public.home_banner_slides DROP CONSTRAINT IF EXISTS home_banner_slides_poster_url_check;
ALTER TABLE public.home_banner_slides
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS desktop_poster_url,
  DROP COLUMN IF EXISTS mobile_poster_url;

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_banner_interval_check;
ALTER TABLE public.site_settings DROP COLUMN IF EXISTS banner_interval_seconds;

COMMIT;

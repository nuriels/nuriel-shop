-- ביטול 20261019600000_seo_keywords_llms
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
      ('public.site_settings', 'seo_keywords <> '''' OR llms_txt_enabled', 'מילות מפתח ל-SEO והגדרת llms.txt שבעלי החנויות הגדירו')
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
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_seo_keywords_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS seo_keywords,
  DROP COLUMN IF EXISTS llms_txt_enabled;
COMMIT;

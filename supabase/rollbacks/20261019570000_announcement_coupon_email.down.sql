-- דרך חזרה ל-20261019570000 (ידני בלבד). אחריה:
--   DELETE FROM public._migrations_applied WHERE filename = '20261019570000_announcement_coupon_email.sql';
-- מוחק את רישום שליחות הקופון ואת הגדרות פס ההודעות; שאר הנתונים לא נפגעים.
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
      ('public.coupon_email_sends', 'true', 'שליחות מיילי קופון (רישום למניעת שליחה כפולה)'),
      ('public.site_settings', 'announcement_enabled OR announcement_text <> '''' OR announcement_coupon_code IS NOT NULL OR announcement_style <> ''gold''', 'הודעת האתר שבעלי החנויות הגדירו')
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
DROP FUNCTION IF EXISTS public.coupon_email_claim(text, text);
DROP FUNCTION IF EXISTS public.coupon_email_release(text, text);
DROP TABLE IF EXISTS public.coupon_email_sends;
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_announcement_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS announcement_enabled, DROP COLUMN IF EXISTS announcement_text,
  DROP COLUMN IF EXISTS announcement_coupon_code, DROP COLUMN IF EXISTS announcement_style;
COMMIT;

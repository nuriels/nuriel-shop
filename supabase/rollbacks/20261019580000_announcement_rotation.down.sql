-- דרך חזרה ל-20261019580000 (ידני בלבד). אחריה:
--   DELETE FROM public._migrations_applied WHERE filename = '20261019580000_announcement_rotation.sql';
-- ההודעות הרשימתיות נמחקות; הטקסט והקופון הישנים (announcement_text / announcement_coupon_code) נשארו כמות שהם.
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
      ('public.site_settings', 'announcement_items <> ''[]''::jsonb OR announcement_mode <> ''rotate'' OR announcement_interval_seconds <> 5', 'הודעות מתחלפות שבעלי החנויות הגדירו')
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
DROP TRIGGER IF EXISTS site_settings_announcement_guard ON public.site_settings;
DROP FUNCTION IF EXISTS public.site_settings_announcement_guard();
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_announcement_rotation_check;
ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS announcement_items, DROP COLUMN IF EXISTS announcement_mode,
  DROP COLUMN IF EXISTS announcement_interval_seconds;
COMMIT;

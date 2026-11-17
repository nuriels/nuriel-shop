-- Rollback של 20261110210000_hosp_consent.sql (Google SEO שלב 4 — הסכמה ל-Cookies, כבוי)
-- מוחק את שתי הפונקציות, את טבלת הרשומות ואת המתג (גם ההגדרות שלו לאתרים — ON DELETE CASCADE).
-- הרשומות עצמן אנונימיות; אם יש בהן משהו — מגבים לפני (pg_dump) כמו לפני כל Rollback.
BEGIN;
SET LOCAL client_min_messages = warning;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('hospitality.consent_records', 'true', 'רשומות הסכמה (ראיה משפטית)')
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
DROP FUNCTION IF EXISTS hospitality.site_consent_record(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS hospitality.analytics_enabled();
DROP TABLE IF EXISTS hospitality.consent_records;
DELETE FROM public.platform_feature_flags WHERE key = 'hospitality_analytics_enabled';
NOTIFY pgrst, 'reload schema';
COMMIT;

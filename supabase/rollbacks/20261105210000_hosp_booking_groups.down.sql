-- ============================================================
-- Rollback — מיגרציה 44 (20261105210000_hosp_booking_groups.sql)
-- מוחק את public_free_units, request_booking_group, booking_group ו-booking_group_decide, ואת
-- bookings.group_id (והאינדקס שלה). שום פונקציה קיימת לא השתנתה ב-44, אז אין מה להחזיר.
-- מה קורה: הזמנות שנוצרו כבקשה לכמה חדרים נשארות — כל חדר הזמנה רגילה, בלי הקישור ביניהן. מיילים
-- של קבוצות שכבר בתור — נשארים בתור (בלי שינוי); האפליקציה הקודמת לא שולחת אירוע שהיא לא מכירה.
-- ============================================================

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
      ('hospitality.bookings', 'group_id IS NOT NULL', 'הזמנות מרובות-חדרים (קבוצות)')
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

DROP FUNCTION IF EXISTS hospitality.booking_group_decide(uuid, boolean, text);
DROP FUNCTION IF EXISTS hospitality.booking_group(uuid);
DROP FUNCTION IF EXISTS hospitality.request_booking_group(jsonb, date, date, text, text, text, text, boolean, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.public_free_units(date, date);
DROP INDEX IF EXISTS hospitality.bookings_group_idx;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS group_id;

COMMIT;

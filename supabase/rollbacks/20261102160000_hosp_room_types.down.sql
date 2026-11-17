-- Rollback of 20261102160000_hosp_room_types.sql (RT — hotel room types).
-- Drops the room-type functions, units.category_id and unit_categories. Bookings are untouched
-- (they always hold a physical room); rooms simply lose their type.
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
      ('hospitality.unit_categories', 'true', 'סוגי חדרים'),
      ('hospitality.units', 'category_id IS NOT NULL', 'יחידות ששויכו לסוג חדר')
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
DROP FUNCTION IF EXISTS hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid);
DROP FUNCTION IF EXISTS hospitality.quote_type(uuid, date, date, integer, integer, text, uuid);
DROP FUNCTION IF EXISTS hospitality.public_type_availability(uuid, date, date);
DROP FUNCTION IF EXISTS hospitality._type_rooms(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality.room_type_apply(uuid, numeric, integer, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS hospitality.room_type_assign(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality.room_type_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.room_type_save(uuid, uuid, text, text, integer);
DROP FUNCTION IF EXISTS hospitality._room_type_slug(uuid, text, uuid);
DROP FUNCTION IF EXISTS hospitality.room_types_view();
DROP FUNCTION IF EXISTS hospitality.public_room_types();
DROP FUNCTION IF EXISTS hospitality._room_types_payload(uuid, boolean);
DROP INDEX IF EXISTS hospitality.units_category_idx;
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_category_kind;
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_category_fk;
ALTER TABLE hospitality.units DROP COLUMN IF EXISTS category_id;
DROP TABLE IF EXISTS hospitality.unit_categories;
COMMIT;

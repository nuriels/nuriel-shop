-- Rollback of 20261102160000_hosp_room_types.sql (RT — hotel room types).
-- Drops the room-type functions, units.category_id and unit_categories. Bookings are untouched
-- (they always hold a physical room); rooms simply lose their type.
BEGIN;
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

-- Rollback of 20261102100000_hosp_bookings_staff.sql (Stage 2h — bookings list and card).
-- Read functions only: drop them. No data changes.
BEGIN;
DROP FUNCTION IF EXISTS hospitality.staff_booking_detail(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_bookings(text, text, integer, integer);
DROP FUNCTION IF EXISTS hospitality._booking_tab(text, date, date);
DROP FUNCTION IF EXISTS hospitality._booking_state(hospitality.bookings);
COMMIT;

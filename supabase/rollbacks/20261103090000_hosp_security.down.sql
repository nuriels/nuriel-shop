-- Rollback of 20261103090000_hosp_security.sql (D1: shared rate limits, server-only booking requests).
-- Drops the shared counters and their functions, and returns the booking-request functions to the
-- grants of migrations 4 / 22 (callable by anon and authenticated through the API). Data: the counters
-- are temporary by nature; nothing else changes.
BEGIN;
DROP FUNCTION IF EXISTS hospitality.rate_sweep();
DROP FUNCTION IF EXISTS hospitality.rate_check(jsonb);
DROP TABLE IF EXISTS hospitality.rate_buckets;

GRANT EXECUTE ON FUNCTION hospitality.request_booking(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) FROM service_role;
REVOKE EXECUTE ON FUNCTION hospitality.quote_type(uuid, date, date, integer, integer, text, uuid) FROM service_role;
COMMIT;

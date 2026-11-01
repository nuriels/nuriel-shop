-- Rollback of 20261102170000_hosp_payments.sql (payments ledger).
-- Drops the payment functions and the payments table. bookings.amount_paid keeps its last value
-- (the column existed before; the ledger rows are lost).
BEGIN;
DROP FUNCTION IF EXISTS hospitality.payment_provider_record(uuid, uuid, text, numeric, text, text, date);
DROP FUNCTION IF EXISTS hospitality.payment_void(uuid, text);
DROP FUNCTION IF EXISTS hospitality.payment_record(uuid, text, text, numeric, date, text);
DROP FUNCTION IF EXISTS hospitality._payment_insert(uuid, hospitality.bookings, text, text, numeric, date, text, text, text, text);
DROP FUNCTION IF EXISTS hospitality.booking_payments(uuid);
DROP FUNCTION IF EXISTS hospitality._payments_json(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._payments_sync(uuid, uuid);
DROP TABLE IF EXISTS hospitality.payments;
DROP FUNCTION IF EXISTS hospitality.payments_immutable();
COMMIT;

-- Rollback of 20261102120000_hosp_emails_dashboard.sql (Stage 2k — emails screen and dashboard).
-- Functions only: drop them. Emails already queued / sent stay in the outbox.
BEGIN;
DROP FUNCTION IF EXISTS hospitality.dashboard();
DROP FUNCTION IF EXISTS hospitality._occupancy(uuid, date, integer, integer);
DROP FUNCTION IF EXISTS hospitality.requeue_notification(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_emails(text, integer);
COMMIT;

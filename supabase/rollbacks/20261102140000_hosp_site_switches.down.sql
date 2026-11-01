-- Rollback of 20261102140000_hosp_site_switches.sql (Stage 4c — website switches in the platform panel).
-- One read-only function: drop it. The flags themselves are untouched.
BEGIN;
DROP FUNCTION IF EXISTS hospitality.admin_site_switches();
COMMIT;

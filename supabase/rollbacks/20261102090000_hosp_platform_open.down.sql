-- Rollback of 20261102090000_hosp_platform_open.sql (P1 — opening a business from the platform panel).
-- Only functions were added: drop them. Sites, owners and flags created with them stay as they are
-- (they are ordinary rows, the same as a site opened with admin_create_site).
BEGIN;
DROP FUNCTION IF EXISTS hospitality.admin_set_owner(uuid, text, text);
DROP FUNCTION IF EXISTS hospitality.admin_open_site(text, text, text, text, date);
DROP FUNCTION IF EXISTS hospitality.admin_platform_flags();
DROP FUNCTION IF EXISTS hospitality.admin_sites();
COMMIT;

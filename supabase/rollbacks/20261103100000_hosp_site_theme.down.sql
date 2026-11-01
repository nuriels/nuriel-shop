-- Rollback of 20261103100000_hosp_site_theme.sql (D2: theme when a business is opened).
-- Drops the function. Drafts it created stay (they are ordinary drafts the business edits).
BEGIN;
DROP FUNCTION IF EXISTS hospitality.admin_site_theme(uuid, text);
COMMIT;

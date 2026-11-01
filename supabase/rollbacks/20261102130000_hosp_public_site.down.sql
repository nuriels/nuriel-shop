-- Rollback of 20261102130000_hosp_public_site.sql (Stage 4 — public website reads).
-- Functions only: drop them. No data is created by the migration.
BEGIN;
DROP FUNCTION IF EXISTS hospitality.public_availability(uuid, date, date);
DROP FUNCTION IF EXISTS hospitality.public_site();
DROP FUNCTION IF EXISTS hospitality._public_policy(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._public_amenities(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._public_media(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._public_site_tenant();
COMMIT;

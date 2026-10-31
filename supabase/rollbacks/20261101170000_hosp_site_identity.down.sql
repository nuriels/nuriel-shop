-- ============================================================
-- Rollback: 20261101170000_hosp_site_identity.sql
-- חזרה למצב של מיגרציה 8: בלי hospitality.site_identity(). אין נתונים.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;
DROP FUNCTION IF EXISTS hospitality.site_identity();
COMMIT;

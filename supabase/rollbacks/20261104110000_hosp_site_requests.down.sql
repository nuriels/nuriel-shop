-- ============================================================
-- Rollback של 20261104110000_hosp_site_requests.sql (שלב E2)
-- מסרב כשיש בקשות (מידע של לקוחות) — קודם מטפלים בהן / מייצאים ומוחקים ידנית.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "אתר לצימר" בשער.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint := 0;
BEGIN
  IF to_regclass('hospitality.site_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM hospitality.site_requests' INTO _n;
  END IF;
  IF _n > 0 THEN
    RAISE EXCEPTION 'יש % בקשות לאתרי צימר — לפני ה-rollback מטפלים בהן ומוחקים אותן ידנית', _n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.admin_site_request_set(uuid, text, text);
DROP FUNCTION IF EXISTS hospitality.admin_site_requests();
DROP FUNCTION IF EXISTS hospitality.site_request_submit(text, jsonb);
DROP FUNCTION IF EXISTS hospitality._site_request_json(hospitality.site_requests);
DROP TABLE IF EXISTS hospitality.site_requests;

NOTIFY pgrst, 'reload schema';

COMMIT;

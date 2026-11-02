-- ============================================================
-- Rollback של 20261105100000_hosp_support.sql (שלב E4 — מערכת התמיכה של עסקי האירוח)
-- מסרב כשיש פניות או קבצים (מידע של לקוחות) — קודם מייצאים / מוחקים ידנית.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי מסך "תמיכה".
-- מיילים "support_reply" שכבר בתור ההודעות נשארים (הם של העסק, בלי תוכן הפנייה); ה-worker
-- הישן לא מכיר את האירוע ומסמן אותם "נכשל" — אפשר למחוק אותם לפני ה-rollback:
--   DELETE FROM hospitality.notifications WHERE event = 'support_reply';
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint := 0;
BEGIN
  IF to_regclass('hospitality.support_tickets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM hospitality.support_tickets' INTO _n;
  END IF;
  IF _n > 0 THEN
    RAISE EXCEPTION 'יש % פניות תמיכה — לפני ה-rollback מייצאים ומוחקים אותן ידנית', _n;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'hosp-support') THEN
    RAISE EXCEPTION 'יש קבצים בדלי hosp-support — מחקו אותם לפני rollback';
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.admin_support_settings(text, boolean);
DROP FUNCTION IF EXISTS hospitality.admin_support_file(uuid);
DROP FUNCTION IF EXISTS hospitality.admin_support_files_ready(uuid[]);
DROP FUNCTION IF EXISTS hospitality.admin_support_set_status(uuid, text);
DROP FUNCTION IF EXISTS hospitality.admin_support_reply(uuid, text, boolean, text, jsonb);
DROP FUNCTION IF EXISTS hospitality.admin_support_ticket(uuid);
DROP FUNCTION IF EXISTS hospitality.admin_support_tickets(text, text, date, date, text, boolean, integer, integer);
DROP FUNCTION IF EXISTS hospitality.support_file(uuid);
DROP FUNCTION IF EXISTS hospitality.support_files_ready(uuid[]);
DROP FUNCTION IF EXISTS hospitality.support_set_open(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality.support_reply(uuid, text, jsonb);
DROP FUNCTION IF EXISTS hospitality.support_open(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS hospitality.support_ticket(uuid);
DROP FUNCTION IF EXISTS hospitality.support_unread();
DROP FUNCTION IF EXISTS hospitality.support_list();
DROP FUNCTION IF EXISTS hospitality.support_platform_recipients();
DROP FUNCTION IF EXISTS hospitality._support_notify_business(hospitality.support_tickets, uuid);
DROP FUNCTION IF EXISTS hospitality._support_business(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality._support_body(text);
DROP FUNCTION IF EXISTS hospitality._support_set_status(uuid, text);
DROP FUNCTION IF EXISTS hospitality._support_messages(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality._support_ticket_row(hospitality.support_tickets, text);
DROP FUNCTION IF EXISTS hospitality._support_add_files(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._support_sender_name(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._support_plan(uuid);

DROP TABLE IF EXISTS hospitality.support_attachments;
DROP TABLE IF EXISTS hospitality.support_messages;
DROP TABLE IF EXISTS hospitality.support_tickets;
DROP TABLE IF EXISTS hospitality.support_settings;

-- הדלי ריק (נבדק למעלה); גרסאות חדשות של Storage חוסמות מחיקה ישירה — מותר רק בטרנזקציה הזו
SET LOCAL storage.allow_delete_query = 'true';
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id = 'hosp-support';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Rollback של 20261111110000_hosp_events.sql (מיגרציה 63 — אירועים במתחם הבריכה ותנאי העסק לחוזים)
-- הגנה: נעצר כשיש אירועים או תנאי עסק שנשמרו (נתונים של העסק), ונעצר אם מיגרציה 64 עוד קיימת (החוזים
-- משתמשים בתנאים ובאירועים). בלי נתונים: שלוש הטבלאות (תנאי העסק, האירועים, ההיסטוריה שלהם) והפונקציות
-- נמחקות. ההרחבה btree_gist נשארת (קיימת מאז מיגרציית ההזמנות). יומן הפעולות נשאר.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "אירועים".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.client_contracts') IS NOT NULL THEN
    RAISE EXCEPTION 'קודם rollback של מיגרציה 64 (20261111120000_hosp_client_contracts)';
  END IF;
  IF to_regclass('hospitality.events') IS NOT NULL AND EXISTS (SELECT 1 FROM hospitality.events) THEN
    RAISE EXCEPTION 'יש אירועים במערכת — rollback היה מוחק אותם. לא מבוצע';
  END IF;
  IF to_regclass('hospitality.business_terms') IS NOT NULL AND EXISTS (SELECT 1 FROM hospitality.business_terms) THEN
    RAISE EXCEPTION 'נשמרו תנאי עסק לחוזים ולאירועים — rollback היה מוחק אותם. לא מבוצע';
  END IF;
END $$;

-- הפונקציות (קודם — חלקן מקבלות שורה של טבלת האירועים / התנאים)
DROP FUNCTION IF EXISTS hospitality._event_apply(uuid,hospitality.events,jsonb);
DROP FUNCTION IF EXISTS hospitality._event_conflicts(uuid,uuid,timestamp with time zone,timestamp with time zone,uuid);
DROP FUNCTION IF EXISTS hospitality._event_customer(uuid,jsonb);
DROP FUNCTION IF EXISTS hospitality._event_guard(uuid,hospitality.events,boolean);
DROP FUNCTION IF EXISTS hospitality._event_json(hospitality.events);
DROP FUNCTION IF EXISTS hospitality._event_lodging(uuid,uuid,timestamp with time zone,timestamp with time zone);
DROP FUNCTION IF EXISTS hospitality._event_log(uuid,uuid,text,text,text,jsonb,text);
DROP FUNCTION IF EXISTS hospitality._event_outside_pool(uuid,time without time zone,time without time zone);
DROP FUNCTION IF EXISTS hospitality._event_payment_status(hospitality.events);
DROP FUNCTION IF EXISTS hospitality._event_pool_allowed(uuid,time without time zone,time without time zone);
DROP FUNCTION IF EXISTS hospitality._event_type_label(text,text);
DROP FUNCTION IF EXISTS hospitality._signature_paths(jsonb,boolean);
DROP FUNCTION IF EXISTS hospitality._staff_event(uuid,uuid,integer);
DROP FUNCTION IF EXISTS hospitality._terms(uuid);
DROP FUNCTION IF EXISTS hospitality._terms_json(hospitality.business_terms);
DROP FUNCTION IF EXISTS hospitality.business_terms_confirm(integer);
DROP FUNCTION IF EXISTS hospitality.business_terms_save(jsonb,integer);
DROP FUNCTION IF EXISTS hospitality.business_terms_view();
DROP FUNCTION IF EXISTS hospitality.event_check(jsonb,uuid);
DROP FUNCTION IF EXISTS hospitality.event_create(jsonb);
DROP FUNCTION IF EXISTS hospitality.event_set_status(uuid,integer,text,text,boolean);
DROP FUNCTION IF EXISTS hospitality.event_update(uuid,integer,jsonb);
DROP FUNCTION IF EXISTS hospitality.staff_booking_events(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_event_detail(uuid);
DROP FUNCTION IF EXISTS hospitality.staff_events(text,text,text,date,date,integer,integer);

-- הטבלאות (עם הטריגרים, ה-EXCLUDE, המדיניות והאינדקסים שלהן), ואז פונקציית הטריגר
DROP TABLE IF EXISTS hospitality.event_log;
DROP TABLE IF EXISTS hospitality.events;
DROP TABLE IF EXISTS hospitality.business_terms;
DROP FUNCTION IF EXISTS hospitality.event_log_append_only();

COMMIT;

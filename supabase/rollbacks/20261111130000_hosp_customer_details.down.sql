-- ============================================================
-- Rollback של 20261111130000_hosp_customer_details.sql (מיגרציה 65 — תיקון פרטי הלקוח בהזמנה / באירוע)
-- בלי הגנה על נתונים: רק הפונקציות נמחקות. מה שכבר תוקן נשאר כמו שהוא — כרטיסי הלקוח המעודכנים,
-- הקישורים שבוטלו, ההיסטוריה ("פרטי הלקוח תוקנו"), יומן הפעולות והמיילים שנשלחו; זה מצב תקין גם בלי
-- המיגרציה. מייל "פרטי ההזמנה" שעוד בתור — האפליקציה הקודמת לא מכירה אותו ולא שולחת.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי התיקון (אחרת השרת קורא לפונקציות שנמחקו).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.event_customer_update(uuid, integer, jsonb, text);
DROP FUNCTION IF EXISTS hospitality.booking_resend_details(uuid);
DROP FUNCTION IF EXISTS hospitality.booking_customer_update(uuid, integer, jsonb, text, boolean);
DROP FUNCTION IF EXISTS hospitality._customer_apply(uuid, hospitality.guests, jsonb, text, uuid[], uuid);
DROP FUNCTION IF EXISTS hospitality._send_booking_details(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._booking_active(text);
DROP FUNCTION IF EXISTS hospitality._customer_patch(jsonb);

COMMIT;

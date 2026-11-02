-- ============================================================
-- Rollback — מיגרציה 44 (20261105210000_hosp_booking_groups.sql)
-- מוחק את public_free_units, request_booking_group, booking_group ו-booking_group_decide, ואת
-- bookings.group_id (והאינדקס שלה). שום פונקציה קיימת לא השתנתה ב-44, אז אין מה להחזיר.
-- מה קורה: הזמנות שנוצרו כבקשה לכמה חדרים נשארות — כל חדר הזמנה רגילה, בלי הקישור ביניהן. מיילים
-- של קבוצות שכבר בתור — נשארים בתור (בלי שינוי); האפליקציה הקודמת לא שולחת אירוע שהיא לא מכירה.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.booking_group_decide(uuid, boolean, text);
DROP FUNCTION IF EXISTS hospitality.booking_group(uuid);
DROP FUNCTION IF EXISTS hospitality.request_booking_group(jsonb, date, date, text, text, text, text, boolean, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.public_free_units(date, date);
DROP INDEX IF EXISTS hospitality.bookings_group_idx;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS group_id;

COMMIT;

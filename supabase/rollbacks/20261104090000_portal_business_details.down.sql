-- ============================================================
-- Rollback של 20261104090000_portal_business_details.sql
-- מוחק רק את שתי הפונקציות החדשות. חנויות שכבר נפתחו נשארות כמו שהן — פרטי העסק
-- שנשמרו בהקמה הם שדות רגילים בהגדרות החנות (לא נמחקים).
-- לפני ה-rollback: האפליקציה חוזרת לגרסה שקוראת ל-portal_create_store בלבד.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.portal_set_store_logo(text, uuid, text);
DROP FUNCTION IF EXISTS public.portal_create_store_business(text, text, text, jsonb);

NOTIFY pgrst, 'reload schema';

COMMIT;

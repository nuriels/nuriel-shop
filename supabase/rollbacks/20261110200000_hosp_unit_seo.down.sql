-- ============================================================
-- Rollback: 20261110200000_hosp_unit_seo.sql — מוחק את שתי הפונקציות בלבד.
-- הערכים שנשמרו בעמודות seo_title / seo_description נשארים: העמודות היו קיימות לפני המיגרציה,
-- והקוד הקודם כבר מציג אותן באתר הציבורי. אחרי ה-rollback הסכמה זהה בדיוק לזו של מיגרציה 61.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.unit_seo_set(uuid, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.unit_seo_get(uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;

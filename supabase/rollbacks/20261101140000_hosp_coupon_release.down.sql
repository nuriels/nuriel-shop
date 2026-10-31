-- ============================================================
-- Rollback: 20261101140000_hosp_coupon_release.sql
-- מסיר את שחרור השימוש בקופון (חוזר לכלל הקודם: נספר ביצירה, לא משתחרר).
-- מספרי השימוש שכבר שוחררו נשארים כפי שהם; ההיסטוריה נשמרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DROP TRIGGER IF EXISTS bookings_coupon_usage ON hospitality.bookings;
DROP FUNCTION IF EXISTS hospitality.bookings_coupon_usage();
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_promotion_released_check;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS promotion_released_at;

COMMIT;

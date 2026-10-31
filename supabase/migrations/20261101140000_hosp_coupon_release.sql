-- ============================================================
-- Hospitality — שחרור שימוש בקופון (החלטה עסקית מאושרת, אחרי שלב 1e)
-- ============================================================
-- הכלל:
--   • שימוש בקופון נספר כשההזמנה / הבקשה נוצרת (כמו קודם, עם usage_limit).
--   • השימוש משתחרר כשההזמנה מסתיימת לפני שאושרה: הבעלים דחה (declined),
--     הבקשה פגה (expired), או האורח ביטל בקשה שעוד לא אושרה (pending → cancelled).
--   • אחרי שההזמנה אושרה — השימוש נשאר נספר, גם אם היא מבוטלת אחר כך.
--   • בקשה שפגה ואושרה מחדש ע"י הבעלים (expired → confirmed) צורכת שוב את השימוש,
--     רק אם נשאר מקום בקופון (אחרת האישור נדחה עם הסבר).
-- אטומי (באותה טרנזקציה של שינוי הסטטוס) ופעם אחת בלבד: promotion_released_at
-- מסמן ששוחרר, ומעברי הסטטוס עצמם קורים פעם אחת (נעילת השורה + מכונת המצבים).
-- כל שחרור / צריכה מחדש נרשמים בהיסטוריית ההזמנה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101140000_hosp_coupon_release.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS promotion_released_at timestamptz;
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_promotion_released_check;
ALTER TABLE hospitality.bookings ADD CONSTRAINT bookings_promotion_released_check
  CHECK (promotion_released_at IS NULL OR status IN ('declined', 'expired', 'cancelled'));

CREATE OR REPLACE FUNCTION hospitality.bookings_coupon_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR OLD.promotion_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- הסתיימה לפני אישור → השימוש חוזר (פעם אחת)
  IF OLD.status IN ('pending_approval', 'pending_payment') AND NEW.status IN ('declined', 'expired', 'cancelled')
     AND OLD.promotion_released_at IS NULL THEN
    UPDATE hospitality.promotions p SET used_count = p.used_count - 1
     WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.promotion_id AND p.used_count > 0;
    NEW.promotion_released_at := now();
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, from_status, to_status, actor_kind, actor_id, changes)
    VALUES (OLD.tenant_id, OLD.id, 'coupon_released', OLD.status, NEW.status, 'system', auth.uid(),
            jsonb_build_object('promotion_id', OLD.promotion_id));
    RETURN NEW;
  END IF;

  -- בקשה שפגה ואושרה מחדש → צורכת שוב את השימוש (אם נשאר מקום)
  IF OLD.status = 'expired' AND NEW.status = 'confirmed' AND OLD.promotion_released_at IS NOT NULL THEN
    UPDATE hospitality.promotions p SET used_count = p.used_count + 1
     WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.promotion_id
       AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הקופון של ההזמנה כבר נוצל עד הסוף — אי אפשר לאשר אותה מחדש עם ההנחה'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.promotion_released_at := NULL;
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, from_status, to_status, actor_kind, actor_id, changes)
    VALUES (OLD.tenant_id, OLD.id, 'coupon_reconsumed', OLD.status, NEW.status, 'system', auth.uid(),
            jsonb_build_object('promotion_id', OLD.promotion_id));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.bookings_coupon_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.bookings_coupon_usage() TO service_role;

-- אחרי bookings_before_write (מכונת המצבים) לפי סדר השמות — מעבר לא חוקי נדחה לפני כן
DROP TRIGGER IF EXISTS bookings_coupon_usage ON hospitality.bookings;
CREATE TRIGGER bookings_coupon_usage BEFORE UPDATE OF status ON hospitality.bookings
FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_coupon_usage();

COMMIT;

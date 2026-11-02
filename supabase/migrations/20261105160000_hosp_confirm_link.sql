-- ============================================================
-- Hospitality — מיגרציה 39: קישור אישי גם במייל "ההזמנה אושרה"
--
-- עד עכשיו הקישור לעמוד ההזמנה של האורח ("לצפייה וניהול ההזמנה") היה רק במייל הראשון ("קיבלנו את
-- בקשת ההזמנה שלך"): הטוקן נשמר במסד רק כ-hash, ולכן אחרי השליחה אי אפשר לצרף אותו שוב. במייל
-- האישור — שבו האורח מחפש את פרטי התשלום וההגעה — לא היה קישור.
--
-- עכשיו, כשבעל העסק מאשר בקשה (approve_booking), נוצר להזמנה טוקן שני, ונשלח רק במייל האישור —
-- באותה דרך כמו הראשון:
--   • במסד רק ה-hash (manage_token2_hash, ייחודי). הטוקן עצמו רק במייל שבתור, ונמחק ממנו אחרי
--     השליחה (אותו מנגנון כמו הראשון — mark_notification / claim_notifications);
--   • שני הקישורים פתוחים — הראשון לא מתבטל (אורח שפותח את המייל הראשון לא נתקע), ובאותו תוקף
--     (30 יום אחרי היציאה; מתעדכן בשינוי תאריכים כמו קודם);
--   • רק להזמנה שכבר יש לה קישור אישי, ורק כשיש לאורח אימייל (לא נוצר סוד שאף אחד לא יקבל);
--   • מחיקת פרטי אורח (_anonymize_guest) מוחקת את שני הטוקנים;
--   • אין טוקן שני בלי ראשון (CHECK).
-- עמוד האורח, בקשת ביטול, פרטי ההגעה והתשלום — כולם עוברים דרך _guest_booking, שמקבלת עכשיו כל אחד
-- משני הטוקנים (אותו עסק, בתוקף). בלי פונקציות חדשות ובלי שינוי בהרשאות; ההיסטוריה של ההזמנה לא
-- משתנה (הטוקן נשמר באותו עדכון של האישור).
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105160000_hosp_confirm_link.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הטוקן השני (hash בלבד)
-- ------------------------------------------------------------
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS manage_token2_hash text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'hospitality.bookings'::regclass AND conname = 'bookings_manage_token2_check') THEN
    ALTER TABLE hospitality.bookings ADD CONSTRAINT bookings_manage_token2_check
      CHECK (manage_token2_hash IS NULL OR (manage_token2_hash ~ '^[0-9a-f]{64}$' AND manage_token_hash IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token2 ON hospitality.bookings (manage_token2_hash)
  WHERE manage_token2_hash IS NOT NULL;

-- ------------------------------------------------------------
-- 2. ההזמנה של האורח: כל אחד משני הטוקנים (או אורח מחובר — כמו קודם)
-- ------------------------------------------------------------
-- ההזמנה של האורח: טוקן "ניהול ההזמנה" (בתוקף עד 30 יום אחרי היציאה), או אורח
-- מחובר שההזמנה מקושרת אליו (זהות מאומתת). כל כישלון — אותה תשובה: לא נמצאה.
CREATE OR REPLACE FUNCTION hospitality._guest_booking(_tenant_id uuid, _token text, _booking_id uuid, _lock boolean)
RETURNS hospitality.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
  _h text;
BEGIN
  IF _token IS NOT NULL THEN
    IF _token ~ '^[0-9a-f]{64}$' THEN
      -- הקישור מהמייל הראשון, או ממייל האישור (מיגרציה 39) — אותו עסק, ובתוקף
      _h := encode(sha256(convert_to(_token, 'UTF8')), 'hex');
      IF _lock THEN
        SELECT * INTO b FROM hospitality.bookings x
         WHERE (x.manage_token_hash = _h OR x.manage_token2_hash = _h)
           AND x.tenant_id = _tenant_id AND x.manage_token_expires_at > now()
         FOR UPDATE;
      ELSE
        SELECT * INTO b FROM hospitality.bookings x
         WHERE (x.manage_token_hash = _h OR x.manage_token2_hash = _h)
           AND x.tenant_id = _tenant_id AND x.manage_token_expires_at > now();
      END IF;
    END IF;
  ELSIF _booking_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT x.* INTO b FROM hospitality.bookings x
      JOIN hospitality.guests g ON g.tenant_id = x.tenant_id AND g.id = x.guest_id
     WHERE x.tenant_id = _tenant_id AND x.id = _booking_id AND g.user_id = auth.uid();
    IF FOUND AND _lock THEN
      SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _tenant_id AND x.id = _booking_id FOR UPDATE;
    END IF;
  END IF;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN b;
END $$;

-- ------------------------------------------------------------
-- 3. אישור בקשה: טוקן שני למייל האישור
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.approve_booking(_booking_id uuid, _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
  _token text;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF b.status NOT IN ('pending_approval', 'expired') THEN
    RAISE EXCEPTION 'אפשר לאשר רק בקשה שממתינה לאישור' USING ERRCODE = 'check_violation';
  END IF;
  -- מיגרציה 39: קישור אישי גם במייל האישור — רק כשלהזמנה כבר יש קישור, ולאורח יש אימייל
  IF b.manage_token_hash IS NOT NULL AND EXISTS (
       SELECT 1 FROM hospitality.guests g
        WHERE g.tenant_id = b.tenant_id AND g.id = b.guest_id
          AND g.anonymized_at IS NULL AND g.email_normalized IS NOT NULL) THEN
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  END IF;
  PERFORM hospitality._set_actor('staff', NULL);
  UPDATE hospitality.bookings x
     SET status = 'confirmed', hold_expires_at = NULL, reminder_due_at = NULL,
         manage_token2_hash = CASE WHEN _token IS NULL THEN x.manage_token2_hash
                                   ELSE encode(sha256(convert_to(_token, 'UTF8')), 'hex') END
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest',
                               CASE WHEN _token IS NULL THEN '{}'::jsonb
                                    ELSE jsonb_build_object('manage_token', _token) END);
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

-- ------------------------------------------------------------
-- 4. מחיקת פרטי אורח: גם הטוקן השני
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.guests g
     SET full_name = 'אורח שנמחק', email = NULL, phone = NULL, notes = NULL, user_id = NULL,
         marketing_consent = false, anonymized_at = now()
   WHERE g.tenant_id = _tenant_id AND g.id = _guest_id AND g.anonymized_at IS NULL;
  UPDATE hospitality.bookings b
     SET special_requests = NULL, policy_acceptance = b.policy_acceptance - 'ip' - 'user_agent',
         manage_token_hash = NULL, manage_token2_hash = NULL, manage_token_expires_at = NULL
   WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id;
  UPDATE hospitality.notifications n
     SET payload = '{}'::jsonb,
         recipient_email = CASE WHEN n.recipient_kind = 'guest' THEN 'anonymized@invalid.invalid' ELSE n.recipient_email END,
         status = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'dead' ELSE n.status END,
         last_error = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'guest anonymized' ELSE n.last_error END,
         updated_at = now()
   WHERE n.tenant_id = _tenant_id
     AND n.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id);
END $$;

COMMIT;

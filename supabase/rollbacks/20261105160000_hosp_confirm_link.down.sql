-- ============================================================
-- Rollback — מיגרציה 39 (20261105160000_hosp_confirm_link.sql)
-- מחזיר את _guest_booking, approve_booking ו-_anonymize_guest כפי שהיו במיגרציה 14
-- (20261101120000_hosp_booking.sql), מילה במילה, ומוריד את הטוקן השני (העמודה, ה-CHECK והאינדקס).
-- מה קורה: הקישורים שנשלחו במיילי האישור מפסיקים לעבוד; הקישורים מהמייל הראשון ממשיכים כרגיל.
-- מיילי אישור חדשים — שוב בלי קישור. בלי שינוי בהזמנות עצמן.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION hospitality._guest_booking(_tenant_id uuid, _token text, _booking_id uuid, _lock boolean)
RETURNS hospitality.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  IF _token IS NOT NULL THEN
    IF _token ~ '^[0-9a-f]{64}$' THEN
      IF _lock THEN
        SELECT * INTO b FROM hospitality.bookings x
         WHERE x.manage_token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
           AND x.tenant_id = _tenant_id AND x.manage_token_expires_at > now()
         FOR UPDATE;
      ELSE
        SELECT * INTO b FROM hospitality.bookings x
         WHERE x.manage_token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
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

CREATE OR REPLACE FUNCTION hospitality.approve_booking(_booking_id uuid, _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF b.status NOT IN ('pending_approval', 'expired') THEN
    RAISE EXCEPTION 'אפשר לאשר רק בקשה שממתינה לאישור' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('staff', NULL);
  UPDATE hospitality.bookings x SET status = 'confirmed', hold_expires_at = NULL, reminder_due_at = NULL
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest');
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

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
         manage_token_hash = NULL, manage_token_expires_at = NULL
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

DROP INDEX IF EXISTS hospitality.bookings_manage_token2;
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_manage_token2_check;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS manage_token2_hash;

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 28: תשלום טלפוני (שלב D4) — על תשתית התשלומים של מיגרציה 23
--
-- ההחלטה: אין סליקה באתר. האורח שולח בקשה; נציג העסק מתקשר, גובה במסוף שלו, ורושם את התשלום
-- ביומן התשלומים הקיים (payment_record). בלי מערכת תשלומים נוספת ובלי פרטי כרטיס במערכת.
--
--   • תיקון: _payments_sync עדכן רק את amount_paid — עכשיו גם את payment_status (לא שולם /
--     שולמה מקדמה / שולם) לפי מה שנרשם בפועל. "שולם" מופיע רק אחרי רישום של העסק.
--     הזמנות קיימות מתוקנות פעם אחת (רק שורות שהמצב שלהן לא תאם את הסכום ששולם);
--   • confirm_payment (Stage 1d — לשרת בלבד, לא בשימוש) רשם תשלום ישירות בהזמנה, מחוץ ליומן
--     התשלומים — מערכת כפולה. עכשיו הוא רושם ביומן (provider = 'confirm'), כמו כל תשלום;
--   • שומר על פרטי כרטיס: הערה בתשלום לא יכולה להכיל רצף של 13–19 ספרות (מספר כרטיס).
-- ============================================================

-- ------------------------------------------------------------
-- 1. הסכום ששולם ומצב התשלום — תמיד לפי יומן התשלומים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._payments_sync(_t uuid, _booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _paid numeric;
BEGIN
  SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
    FROM hospitality.payments p
   WHERE p.tenant_id = _t AND p.booking_id = _booking_id AND p.status = 'recorded';
  _paid := greatest(_paid, 0);
  UPDATE hospitality.bookings b
     SET amount_paid = _paid,
         payment_status = CASE WHEN _paid <= 0 THEN 'unpaid' WHEN _paid >= b.total THEN 'paid' ELSE 'deposit_paid' END
   WHERE b.tenant_id = _t AND b.id = _booking_id
     AND (b.amount_paid IS DISTINCT FROM _paid
          OR b.payment_status IS DISTINCT FROM
             CASE WHEN _paid <= 0 THEN 'unpaid' WHEN _paid >= b.total THEN 'paid' ELSE 'deposit_paid' END);
  RETURN _paid;
END $$;
REVOKE ALL ON FUNCTION hospitality._payments_sync(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- הזמנות שנרשם להן תשלום לפני התיקון (המצב נשאר "לא שולם")
UPDATE hospitality.bookings b
   SET payment_status = CASE WHEN b.amount_paid <= 0 THEN 'unpaid' WHEN b.amount_paid >= b.total THEN 'paid' ELSE 'deposit_paid' END
 WHERE b.payment_status IS DISTINCT FROM
       CASE WHEN b.amount_paid <= 0 THEN 'unpaid' WHEN b.amount_paid >= b.total THEN 'paid' ELSE 'deposit_paid' END;

-- ------------------------------------------------------------
-- 2. confirm_payment — דרך יומן התשלומים (בלי מערכת כפולה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.confirm_payment(_booking_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'סכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(b.tenant_id);
  PERFORM hospitality._expire_due(b.tenant_id);
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = _booking_id FOR UPDATE;
  IF b.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לתשלום' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('system', 'התקבל תשלום');
  UPDATE hospitality.bookings x SET status = 'confirmed', hold_expires_at = NULL WHERE x.id = b.id RETURNING * INTO b;
  -- התשלום עצמו — שורה ביומן (הסכום והמצב בהזמנה מחושבים ממנו)
  PERFORM hospitality._payment_insert(b.tenant_id, b,
                                      CASE WHEN b.amount_paid + _amount >= b.total THEN 'full' ELSE 'deposit' END,
                                      'provider', _amount, (now() AT TIME ZONE 'UTC')::date, NULL,
                                      'confirm', 'confirm:' || gen_random_uuid()::text, 'system');
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = b.id;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest');
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'amount_paid', b.amount_paid);
END $$;

-- ------------------------------------------------------------
-- 3. בלי מספרי כרטיס בהערות התשלום
-- ------------------------------------------------------------
ALTER TABLE hospitality.payments DROP CONSTRAINT IF EXISTS payments_note_no_card;
ALTER TABLE hospitality.payments ADD CONSTRAINT payments_note_no_card
  CHECK (note IS NULL OR note !~ '([0-9][ -]?){12,18}[0-9]');

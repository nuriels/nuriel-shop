-- Rollback of 20261103120000_hosp_phone_payments.sql (D4: phone payments on the payments ledger).
-- Restores _payments_sync of migration 23 and confirm_payment of migration 4 exactly, and drops the
-- card-number guard on payment notes. Data: payment_status values set by the fix stay (they match
-- what was recorded); ledger rows written by confirm_payment stay (ordinary payment rows).
BEGIN;
ALTER TABLE hospitality.payments DROP CONSTRAINT IF EXISTS payments_note_no_card;
CREATE OR REPLACE FUNCTION hospitality._payments_sync(_t uuid, _booking_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _paid numeric;
BEGIN
  SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
    FROM hospitality.payments p
   WHERE p.tenant_id = _t AND p.booking_id = _booking_id AND p.status = 'recorded';
  _paid := greatest(_paid, 0);
  UPDATE hospitality.bookings b SET amount_paid = _paid
   WHERE b.tenant_id = _t AND b.id = _booking_id AND b.amount_paid IS DISTINCT FROM _paid;
  RETURN _paid;
END $$;
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
  UPDATE hospitality.bookings x
     SET status = 'confirmed', hold_expires_at = NULL, amount_paid = x.amount_paid + _amount,
         payment_status = CASE WHEN x.amount_paid + _amount >= x.total THEN 'paid' ELSE 'deposit_paid' END
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest');
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'amount_paid', b.amount_paid);
END $$;
COMMIT;

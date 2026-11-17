-- Rollback of 20261102170000_hosp_payments.sql (payments ledger).
-- Drops the payment functions and the payments table. bookings.amount_paid keeps its last value
-- (the column existed before; the ledger rows are lost).
BEGIN;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('hospitality.payments', 'true', 'רישום תשלומים של הזמנות')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS hospitality.payment_provider_record(uuid, uuid, text, numeric, text, text, date);
DROP FUNCTION IF EXISTS hospitality.payment_void(uuid, text);
DROP FUNCTION IF EXISTS hospitality.payment_record(uuid, text, text, numeric, date, text);
DROP FUNCTION IF EXISTS hospitality._payment_insert(uuid, hospitality.bookings, text, text, numeric, date, text, text, text, text);
DROP FUNCTION IF EXISTS hospitality.booking_payments(uuid);
DROP FUNCTION IF EXISTS hospitality._payments_json(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._payments_sync(uuid, uuid);
DROP TABLE IF EXISTS hospitality.payments;
DROP FUNCTION IF EXISTS hospitality.payments_immutable();
COMMIT;

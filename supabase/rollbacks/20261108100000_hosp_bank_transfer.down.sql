-- ============================================================
-- Rollback של 20261108100000_hosp_bank_transfer.sql (מיגרציה 55 — מדיניות העברה בנקאית ואישורי העברה)
-- מסרב כשיש אישורי העברה שהאורחים העלו (רשומות או קבצים בדלי) — הם של האורחים ושל העסק: קודם
-- מורידים עותק ומוחקים ידנית. העמודה payment_method (האמצעי שהאורח בחר) נמחקת.
-- תשלומים שנרשמו כשהצוות אישר העברה נשארים ביומן התשלומים (הם תשלומים אמיתיים) — לא נוגעים בהם.
-- guest_payment_info ו-public_payment_methods() חוזרות לגרסה של מיגרציה 37 — מילה במילה.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "אישורי העברה".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _n bigint := 0;
BEGIN
  IF to_regclass('hospitality.payment_proofs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM hospitality.payment_proofs' INTO _n;
  END IF;
  IF _n > 0 THEN
    RAISE EXCEPTION 'יש % אישורי העברה שהאורחים העלו — לפני ה-rollback מורידים עותק ומוחקים אותם ידנית', _n;
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL
     AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs') THEN
    RAISE EXCEPTION 'יש קבצים בדלי hosp-payment-proofs — מחקו אותם לפני rollback';
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.payment_proofs_waiting();
DROP FUNCTION IF EXISTS hospitality.payment_proof_review(uuid, text, numeric, text);
DROP FUNCTION IF EXISTS hospitality.payment_proof_file(uuid);
DROP FUNCTION IF EXISTS hospitality.booking_payment_proofs(uuid);
DROP FUNCTION IF EXISTS hospitality.guest_proof_ready(uuid);
DROP FUNCTION IF EXISTS hospitality.guest_proof_slot(text, uuid, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.guest_set_payment_method(text, uuid, text);
DROP FUNCTION IF EXISTS hospitality.email_booking_payment_methods(uuid);

-- הוראות התשלום לאורח ולאתר — הגרסאות של מיגרציה 37 (בלי כלל 7 הימים ובלי מצב ההעברה)
DROP FUNCTION IF EXISTS hospitality.public_payment_methods(date);
CREATE OR REPLACE FUNCTION hospitality.guest_payment_info(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  p hospitality.payment_settings;
  _methods text[];
  _due numeric;
  _deposit numeric;
BEGIN
  b := hospitality._guest_booking(_t, _token, _booking_id, false);
  p := hospitality._payment_settings(_t);
  _methods := hospitality._payment_methods(_t);
  IF b.status IN ('declined', 'cancelled', 'expired', 'no_show', 'cancel_requested') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'closed', 'methods', to_jsonb(_methods));
  END IF;
  IF b.status = 'pending_approval' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_confirmed', 'methods', to_jsonb(_methods));
  END IF;
  _due := GREATEST(b.total - b.amount_paid, 0);
  IF _due <= 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'paid', 'methods', to_jsonb(_methods));
  END IF;
  -- מקדמה שעוד לא שולמה: מה שנשאר ממנה
  _deposit := CASE WHEN b.deposit_amount > b.amount_paid THEN b.deposit_amount - b.amount_paid ELSE 0 END;
  RETURN jsonb_build_object(
    'available', true,
    'methods', to_jsonb(_methods),
    'currency', b.currency,
    'amount_due', _due,
    'deposit_due', _deposit,
    'reference', '#' || b.number,
    'bank', CASE WHEN p.bank_enabled THEN jsonb_build_object('name', p.bank_name, 'branch', p.bank_branch,
                                                             'account', p.bank_account, 'holder', p.bank_holder) END,
    'bit', CASE WHEN p.bit_enabled THEN jsonb_build_object('phone', p.bit_phone) END,
    'phone', CASE WHEN p.phone_enabled THEN jsonb_build_object('number', hospitality._payment_phone(_t)) END,
    'note', p.note);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_payment_info(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_payment_info(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.public_payment_methods()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  RETURN jsonb_build_object('methods', to_jsonb(hospitality._payment_methods(_t)));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_payment_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_payment_methods() TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS hospitality._transfer_state(hospitality.bookings);
DROP FUNCTION IF EXISTS hospitality._proof_json(hospitality.payment_proofs);
DROP TABLE IF EXISTS hospitality.payment_proofs;

DROP FUNCTION IF EXISTS hospitality._bank_for_booking(hospitality.bookings);
DROP FUNCTION IF EXISTS hospitality._booked_on(hospitality.bookings);
DROP FUNCTION IF EXISTS hospitality._site_today(uuid);
DROP FUNCTION IF EXISTS hospitality._bank_transfer_allowed(uuid, date, date);
DROP FUNCTION IF EXISTS hospitality._bank_transfer_min_days();

ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS payment_method;

-- הדלי ריק (נבדק למעלה); גרסאות חדשות של Storage חוסמות מחיקה ישירה — מותר רק בטרנזקציה הזו
SET LOCAL storage.allow_delete_query = 'true';
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id = 'hosp-payment-proofs';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

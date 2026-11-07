-- ============================================================
-- Rollback של 20261108110000_hosp_guest_area.sql (מיגרציה 56 — "ההזמנות שלי", האזור האישי לאורח)
-- נמחקים: קודי הכניסה והחיבורים לאזור (האורחים יתחברו שוב אחרי פריסה חוזרת) והפונקציות של האזור.
-- ההזמנות, האורחים, התשלומים ואישורי ההעברה לא נוגעים (המיגרציה לא שינתה אותם).
-- guest_payment_info / guest_set_payment_method / guest_proof_slot חוזרות לגרסה של מיגרציה 55 — מילה במילה.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "ההזמנות שלי".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.guest_area_proof_slot(text, uuid, text, text, integer);
DROP FUNCTION IF EXISTS hospitality.guest_area_set_payment_method(text, uuid, text);
DROP FUNCTION IF EXISTS hospitality.guest_area_booking(text, uuid);
DROP FUNCTION IF EXISTS hospitality.guest_area_bookings(text);
DROP FUNCTION IF EXISTS hospitality.guest_area_sign_out(text);
DROP FUNCTION IF EXISTS hospitality.guest_code_consume(text, text, text);
DROP FUNCTION IF EXISTS hospitality.guest_code_issue(text, text);

-- הקישור האישי — הגרסאות של מיגרציה 55
CREATE OR REPLACE FUNCTION hospitality.guest_payment_info(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  p hospitality.payment_settings;
  _methods text[];
  _due numeric;
  _deposit numeric;
  _transfer jsonb;
BEGIN
  b := hospitality._guest_booking(_t, _token, _booking_id, false);
  p := hospitality._payment_settings(_t);
  _methods := hospitality._payment_methods(_t);
  -- שלב א' 5: העברה בנקאית — רק כשההגעה לפחות 7 ימים אחרי מועד ההזמנה
  IF NOT hospitality._bank_for_booking(b) THEN
    _methods := array_remove(_methods, 'bank');
  END IF;
  _transfer := hospitality._transfer_state(b);
  IF b.status IN ('declined', 'cancelled', 'expired', 'no_show', 'cancel_requested') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'closed', 'methods', to_jsonb(_methods),
                              'transfer', _transfer, 'payment_method', b.payment_method);
  END IF;
  IF b.status = 'pending_approval' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_confirmed', 'methods', to_jsonb(_methods),
                              'transfer', _transfer, 'payment_method', b.payment_method);
  END IF;
  _due := GREATEST(b.total - b.amount_paid, 0);
  IF _due <= 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'paid', 'methods', to_jsonb(_methods),
                              'transfer', _transfer, 'payment_method', b.payment_method);
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
    'bank', CASE WHEN p.bank_enabled AND 'bank' = ANY (_methods)
                 THEN jsonb_build_object('name', p.bank_name, 'branch', p.bank_branch,
                                         'account', p.bank_account, 'holder', p.bank_holder) END,
    'bit', CASE WHEN p.bit_enabled THEN jsonb_build_object('phone', p.bit_phone) END,
    'phone', CASE WHEN p.phone_enabled THEN jsonb_build_object('number', hospitality._payment_phone(_t)) END,
    'note', p.note,
    'transfer', _transfer,
    'payment_method', b.payment_method);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_payment_info(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_payment_info(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_set_payment_method(_token text, _booking_id uuid, _method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  _methods text[] := hospitality._payment_methods(_t);
BEGIN
  IF _method IS NULL OR _method NOT IN ('bank', 'bit', 'phone', 'other') THEN
    RAISE EXCEPTION 'אמצעי התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  b := hospitality._guest_booking(_t, _token, _booking_id, true);
  IF b.status NOT IN ('pending_approval', 'pending_payment', 'confirmed') THEN
    RAISE EXCEPTION 'אי אפשר לשנות את אופן התשלום בהזמנה הזו' USING ERRCODE = 'check_violation';
  END IF;
  IF _method IN ('bank', 'bit', 'phone') AND NOT (_method = ANY (_methods)) THEN
    RAISE EXCEPTION 'אמצעי התשלום הזה לא זמין באתר' USING ERRCODE = 'check_violation';
  END IF;
  IF _method = 'bank' AND NOT hospitality._bank_for_booking(b) THEN
    RAISE EXCEPTION 'העברה בנקאית אפשרית רק כשההגעה לפחות % ימים אחרי מועד ההזמנה',
      hospitality._bank_transfer_min_days() USING ERRCODE = 'check_violation';
  END IF;
  IF b.payment_method IS DISTINCT FROM _method THEN
    UPDATE hospitality.bookings x SET payment_method = _method WHERE x.tenant_id = _t AND x.id = b.id;
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
    VALUES (_t, b.id, 'payment_method_chosen', 'guest', auth.uid(),
            jsonb_build_object('from', b.payment_method, 'to', _method));
  END IF;
  RETURN hospitality.guest_payment_info(_token, _booking_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_set_payment_method(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_set_payment_method(text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_proof_slot(_token text, _booking_id uuid, _file_name text,
                                                        _mime text, _size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  _state jsonb;
  _id uuid := gen_random_uuid();
  _path text;
  _recent integer;
BEGIN
  b := hospitality._guest_booking(_t, _token, _booking_id, true);
  _state := hospitality._transfer_state(b);
  IF NOT (_state ->> 'can_upload')::boolean THEN
    RAISE EXCEPTION 'אי אפשר להעלות אישור העברה להזמנה הזו כרגע' USING ERRCODE = 'check_violation';
  END IF;
  -- הגנה מהצפה: עד 3 העלאות שלא הושלמו בשעה האחרונה להזמנה
  SELECT count(*) INTO _recent FROM hospitality.payment_proofs p
   WHERE p.tenant_id = _t AND p.booking_id = b.id AND p.status = 'pending' AND p.created_at > now() - interval '1 hour';
  IF _recent >= 3 THEN
    RAISE EXCEPTION 'יותר מדי ניסיונות העלאה — נסו שוב בעוד שעה' USING ERRCODE = 'check_violation';
  END IF;
  _path := _t::text || '/' || b.id::text || '/' || _id::text;
  INSERT INTO hospitality.payment_proofs (id, tenant_id, booking_id, file_name, mime, size_bytes, storage_path,
                                          uploaded_by)
  VALUES (_id, _t, b.id, _file_name, _mime, _size, _path, auth.uid());
  RETURN jsonb_build_object('id', _id, 'path', _path);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_proof_slot(text, uuid, text, text, integer) FROM PUBLIC;
-- השרת קורא בשם האורח (הקישור המאובטח / החשבון המחובר) אחרי שבדק את הקובץ. קריאה ישירה רק רושמת מקום
-- ריק (pending) — לא נראה לאף אחד, ורק השרת (מפתח שירות) יכול להעלות אליו ולסמן "התקבל"
GRANT EXECUTE ON FUNCTION hospitality.guest_proof_slot(text, uuid, text, text, integer) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS hospitality._proof_slot(uuid, hospitality.bookings, text, text, integer);
DROP FUNCTION IF EXISTS hospitality._set_payment_method(uuid, hospitality.bookings, text);
DROP FUNCTION IF EXISTS hospitality._guest_payment_json(uuid, hospitality.bookings);
DROP FUNCTION IF EXISTS hospitality._guest_area_booking(uuid, text, uuid, boolean);
DROP FUNCTION IF EXISTS hospitality._guest_area_email(uuid, text);
DROP FUNCTION IF EXISTS hospitality._guest_area_has_bookings(uuid, text);

DROP TABLE IF EXISTS hospitality.guest_sessions;
DROP TABLE IF EXISTS hospitality.guest_codes;

NOTIFY pgrst, 'reload schema';

COMMIT;

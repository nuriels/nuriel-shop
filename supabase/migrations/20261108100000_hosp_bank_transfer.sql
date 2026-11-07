-- ============================================================
-- Hospitality — מיגרציה 55: מדיניות העברה בנקאית ואישורי העברה (שלב א' 5)
--
--   • העברה בנקאית — רק כשההגעה לפחות 7 ימים אחרי מועד ההזמנה (לפי היום אצל העסק). פחות מזה —
--     האפשרות לא מוצגת ולא זמינה גם ב-API: public_payment_methods(_check_in) לפני ההזמנה,
--     guest_payment_info ו-guest_set_payment_method אחריה. החישוב במסד, לפי תאריך ההגעה בפועל.
--   • bookings.payment_method — האמצעי שהאורח בחר (bank / bit / phone / other); NULL — לא נבחר.
--     האורח רואה "ממתין לאישור העברה" עד שהעסק מאשר תשלום.
--   • payment_proofs — אישורי העברה שהאורח העלה (צילום / PDF) לדלי הפרטי hosp-payment-proofs,
--     משויכים להזמנה: pending (נרשם, הקובץ עוד עולה) → submitted (התקבל, ממתין לבדיקה) →
--     approved (העסק אישר — נרשם תשלום ביומן) / rejected (נדחה, עם סיבה; אפשר להעלות שוב).
--     הכול בשרת — רענון / סגירת הדפדפן / חזרה מאוחרת לא מאבדים את האפשרות להעלות.
--     הקובץ נבדק בשרת (סוג לפי התוכן, PDF בלי תוכן פעיל, עד 5MB); לדלי אין מדיניות למשתמשים —
--     רק השרת (מפתח שירות) מעלה ויוצר קישור חתום קצר, אחרי שהמסד אישר הרשאה.
--   • לאורח: guest_proof_slot / guest_proof_ready (לפי הקישור המאובטח או חשבון מחובר שההזמנה שלו).
--     לצוות (הרשאת bookings): booking_payment_proofs, payment_proof_file, payment_proof_review.
--   • אישור = תשלום ביומן (_payment_insert, אמצעי transfer) — מצב התשלום ממשיך לנבוע מהיומן.
--   • המיילים לאורח מזכירים העברה בנקאית רק לפי אותו כלל (email_booking_payment_methods, שרת בלבד).
--
-- בלי שינוי בנתונים קיימים: עמודה חדשה (NULL), טבלה חדשה, דלי חדש. העסקים שלא הפעילו העברה
-- בנקאית לא מושפעים. החנויות (Ecommerce) לא מושפעות.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. האמצעי שהאורח בחר
-- ------------------------------------------------------------
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE hospitality.bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('bank', 'bit', 'phone', 'other'));
COMMENT ON COLUMN hospitality.bookings.payment_method IS
  'Hospitality (שלב א'' 5): אמצעי התשלום שהאורח בחר — bank / bit / phone / other; NULL — לא נבחר';

-- ------------------------------------------------------------
-- 2. כלל 7 הימים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._bank_transfer_min_days()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 7 $$;

-- ההגעה לפחות 7 ימים אחרי היום שבו ההזמנה נעשתה (לפי אזור הזמן של העסק)
CREATE OR REPLACE FUNCTION hospitality._bank_transfer_allowed(_t uuid, _check_in date, _booked_on date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _check_in IS NOT NULL AND _booked_on IS NOT NULL
         AND _check_in - _booked_on >= hospitality._bank_transfer_min_days();
$$;

-- היום אצל העסק
CREATE OR REPLACE FUNCTION hospitality._site_today(_t uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date
                     FROM hospitality.settings s WHERE s.tenant_id = _t),
                  (now() AT TIME ZONE 'Asia/Jerusalem')::date);
$$;

-- היום שבו ההזמנה נעשתה (אצל העסק)
CREATE OR REPLACE FUNCTION hospitality._booked_on(_b hospitality.bookings)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (_b.created_at AT TIME ZONE COALESCE(
            (SELECT s.timezone FROM hospitality.settings s WHERE s.tenant_id = _b.tenant_id), 'Asia/Jerusalem'))::date;
$$;

-- העברה בנקאית זמינה להזמנה: העסק הפעיל אותה + כלל 7 הימים
CREATE OR REPLACE FUNCTION hospitality._bank_for_booking(_b hospitality.bookings)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT p.bank_enabled FROM hospitality._payment_settings(_b.tenant_id) p), false)
         AND hospitality._bank_transfer_allowed(_b.tenant_id, _b.check_in, hospitality._booked_on(_b));
$$;

REVOKE ALL ON FUNCTION hospitality._bank_transfer_allowed(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._site_today(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._booked_on(hospitality.bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._bank_for_booking(hospitality.bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._bank_transfer_min_days() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. אישורי העברה
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.payment_proofs (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL,
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 160),
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  storage_path text NOT NULL UNIQUE,
  -- pending: נרשם, הקובץ עוד עולה; submitted: התקבל וממתין לבדיקה; approved / rejected: נבדק
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),
  review_note  text CHECK (review_note IS NULL OR char_length(review_note) BETWEEN 1 AND 300),
  payment_id   uuid,
  uploaded_by  uuid,
  reviewed_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  UNIQUE (tenant_id, id),
  CHECK ((status IN ('submitted', 'approved', 'rejected')) = (submitted_at IS NOT NULL)),
  CHECK ((status IN ('approved', 'rejected')) = (reviewed_at IS NOT NULL)),
  CHECK (status <> 'approved' OR payment_id IS NOT NULL),
  CHECK (status <> 'rejected' OR review_note IS NOT NULL),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.payment_proofs IS
  'Hospitality (שלב א'' 5): אישורי העברה בנקאית שהאורח העלה (דלי פרטי hosp-payment-proofs). הקובץ נבדק בשרת; צפייה בקישור חתום; רק דרך פונקציות.';
CREATE INDEX IF NOT EXISTS payment_proofs_booking_idx ON hospitality.payment_proofs (tenant_id, booking_id, created_at);
CREATE INDEX IF NOT EXISTS payment_proofs_waiting_idx ON hospitality.payment_proofs (tenant_id)
  WHERE status = 'submitted';

ALTER TABLE hospitality.payment_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.payment_proofs FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.payment_proofs;
CREATE POLICY tenant_isolation ON hospitality.payment_proofs AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.payment_proofs;
CREATE POLICY backend_enabled ON hospitality.payment_proofs AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.payment_proofs;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.payment_proofs
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- הדלי הפרטי: בלי שום מדיניות למשתמשים — רק השרת (מפתח שירות) מעלה ויוצר קישור חתום
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('hosp-payment-proofs', 'hosp-payment-proofs', false, 5242880,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO UPDATE
      SET public = false, file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- מה שהאורח והצוות רואים על אישור (בלי נתיב הקובץ)
CREATE OR REPLACE FUNCTION hospitality._proof_json(_p hospitality.payment_proofs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', _p.id, 'status', _p.status, 'file_name', _p.file_name, 'mime', _p.mime,
                            'size', _p.size_bytes, 'submitted_at', hospitality._ts(_p.submitted_at),
                            'reviewed_at', hospitality._ts(_p.reviewed_at), 'review_note', _p.review_note);
$$;
REVOKE ALL ON FUNCTION hospitality._proof_json(hospitality.payment_proofs) FROM PUBLIC, anon, authenticated;

-- מצב ההעברה של הזמנה (לאורח): זמינה? נבחרה? אפשר להעלות? האישורים שהתקבלו (בלי "pending")
CREATE OR REPLACE FUNCTION hospitality._transfer_state(_b hospitality.bookings)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _allowed boolean := hospitality._bank_for_booking(_b);
  _due numeric := GREATEST(_b.total - _b.amount_paid, 0);
  _proofs jsonb;
  _count integer;
  _waiting boolean;
BEGIN
  SELECT COALESCE(jsonb_agg(hospitality._proof_json(p) ORDER BY p.submitted_at DESC), '[]'::jsonb),
         count(*), bool_or(p.status = 'submitted')
    INTO _proofs, _count, _waiting
    FROM hospitality.payment_proofs p
   WHERE p.tenant_id = _b.tenant_id AND p.booking_id = _b.id AND p.status <> 'pending';
  RETURN jsonb_build_object(
    'allowed', _allowed,
    'min_days', hospitality._bank_transfer_min_days(),
    'chosen', COALESCE(_b.payment_method = 'bank', false),
    'proofs', _proofs,
    'waiting_review', COALESCE(_waiting, false),
    -- להעלות אישור: העברה זמינה, ההזמנה אושרה (פרטי החשבון מוצגים), נשאר סכום, עד 5 אישורים
    'can_upload', _allowed AND _b.status IN ('confirmed', 'pending_payment') AND _due > 0 AND _count < 5);
END $$;
REVOKE ALL ON FUNCTION hospitality._transfer_state(hospitality.bookings) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. לפני ההזמנה: אילו אמצעים מוצגים (העברה — רק לפי כלל 7 הימים)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS hospitality.public_payment_methods();
CREATE OR REPLACE FUNCTION hospitality.public_payment_methods(_check_in date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _methods text[] := hospitality._payment_methods(_t);
  _bank boolean;
BEGIN
  -- בלי תאריך הגעה: אי אפשר לדעת — העברה לא מוצעת
  _bank := 'bank' = ANY (_methods)
           AND hospitality._bank_transfer_allowed(_t, _check_in, hospitality._site_today(_t));
  IF NOT _bank THEN
    _methods := array_remove(_methods, 'bank');
  END IF;
  RETURN jsonb_build_object('methods', to_jsonb(_methods), 'bank_allowed', _bank,
                            'bank_min_days', hospitality._bank_transfer_min_days());
END $$;
REVOKE ALL ON FUNCTION hospitality.public_payment_methods(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_payment_methods(date) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 5. אחרי ההזמנה: הוראות התשלום לאורח (העברה — רק לפי כלל 7 הימים) + מצב ההעברה
-- ------------------------------------------------------------
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

-- המיילים לאורח (שרת בלבד): אותם אמצעים כמו בעמוד ההזמנה — העברה בנקאית רק לפי כלל 7 הימים
CREATE OR REPLACE FUNCTION hospitality.email_booking_payment_methods(_booking_id uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
  _methods text[];
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = _booking_id;
  IF b.id IS NULL THEN
    RETURN NULL;
  END IF;
  _methods := hospitality._payment_methods(b.tenant_id);
  IF NOT hospitality._bank_for_booking(b) THEN
    _methods := array_remove(_methods, 'bank');
  END IF;
  RETURN _methods;
END $$;
REVOKE ALL ON FUNCTION hospitality.email_booking_payment_methods(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.email_booking_payment_methods(uuid) TO service_role;

-- ------------------------------------------------------------
-- 6. האורח בוחר אמצעי תשלום (בטופס ההזמנה או בעמוד ההזמנה)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 7. האורח מעלה אישור: מקום לקובץ (pending) → השרת מעלה → "התקבל" (submitted)
-- ------------------------------------------------------------
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

-- אחרי שהשרת העלה את הקובץ (מפתח שירות בלבד): "התקבל" — ממתין לבדיקת העסק
CREATE OR REPLACE FUNCTION hospitality.guest_proof_ready(_proof_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  p hospitality.payment_proofs;
BEGIN
  SELECT * INTO p FROM hospitality.payment_proofs x WHERE x.tenant_id = _t AND x.id = _proof_id FOR UPDATE;
  IF p.id IS NULL OR p.status <> 'pending' OR p.created_at < now() - interval '1 hour' THEN
    RAISE EXCEPTION 'הקובץ לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE hospitality.payment_proofs x SET status = 'submitted', submitted_at = now() WHERE x.id = p.id;
  -- מי שהעלה אישור העברה — בחר בהעברה בנקאית
  UPDATE hospitality.bookings x SET payment_method = 'bank'
   WHERE x.tenant_id = _t AND x.id = p.booking_id AND x.payment_method IS DISTINCT FROM 'bank';
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, p.booking_id, 'payment_proof_submitted', 'guest', p.uploaded_by,
          jsonb_build_object('proof', p.id, 'mime', p.mime, 'size', p.size_bytes));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_proof_ready(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_proof_ready(uuid) TO service_role;

-- ------------------------------------------------------------
-- 8. הצוות: רשימה, צפייה בקובץ, אישור (= תשלום ביומן) או דחייה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.booking_payment_proofs(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  b hospitality.bookings;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'payment_method', b.payment_method,
    'bank_allowed', hospitality._bank_for_booking(b),
    'amount_due', GREATEST(b.total - b.amount_paid, 0),
    'currency', b.currency,
    'proofs', COALESCE((SELECT jsonb_agg(hospitality._proof_json(p) ORDER BY p.submitted_at DESC)
                          FROM hospitality.payment_proofs p
                         WHERE p.tenant_id = _t AND p.booking_id = b.id AND p.status <> 'pending'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_payment_proofs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_payment_proofs(uuid) TO authenticated, service_role;

-- הנתיב לקישור החתום — רק אחרי בדיקת הרשאה ושייכות לעסק (השרת חותם במפתח השירות)
CREATE OR REPLACE FUNCTION hospitality.payment_proof_file(_proof_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  p hospitality.payment_proofs;
BEGIN
  SELECT * INTO p FROM hospitality.payment_proofs x
   WHERE x.tenant_id = _t AND x.id = _proof_id AND x.status <> 'pending';
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'הקובץ לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('path', p.storage_path, 'name', p.file_name, 'mime', p.mime);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_proof_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_proof_file(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.payment_proof_review(_proof_id uuid, _decision text, _amount numeric DEFAULT NULL,
                                                            _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  p hospitality.payment_proofs;
  b hospitality.bookings;
  pay hospitality.payments;
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
  _kind text;
BEGIN
  IF _decision IS NULL OR _decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'ההחלטה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _n IS NOT NULL AND char_length(_n) > 300 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.payment_proofs x WHERE x.tenant_id = _t AND x.id = _proof_id FOR UPDATE;
  IF p.id IS NULL OR p.status = 'pending' THEN
    RAISE EXCEPTION 'האישור לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  -- פעם אחת בלבד (לחיצה כפולה / שני אנשי צוות במקביל)
  IF p.status <> 'submitted' THEN
    RAISE EXCEPTION 'האישור הזה כבר נבדק' USING ERRCODE = 'serialization_failure';
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = p.booking_id FOR UPDATE;
  IF _decision = 'reject' THEN
    IF _n IS NULL OR char_length(_n) < 2 THEN
      RAISE EXCEPTION 'כתבו לאורח למה האישור נדחה' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE hospitality.payment_proofs x
       SET status = 'rejected', review_note = _n, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE x.id = p.id;
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes, note)
    VALUES (_t, b.id, 'payment_proof_rejected', 'staff', auth.uid(), jsonb_build_object('proof', p.id), _n);
    PERFORM hospitality._audit(_t, 'payments.proof_rejected', 'הזמנה #' || b.number, jsonb_build_object('proof', p.id));
  ELSE
    IF _amount IS NULL OR _amount <= 0 THEN
      RAISE EXCEPTION 'כתבו את הסכום שהתקבל' USING ERRCODE = 'check_violation';
    END IF;
    IF b.status IN ('declined', 'expired') THEN
      RAISE EXCEPTION 'אי אפשר לרשום תשלום לבקשה שנדחתה או פגה' USING ERRCODE = 'check_violation';
    END IF;
    _kind := CASE WHEN b.amount_paid <= 0 AND _amount >= b.total THEN 'full'
                  WHEN b.amount_paid <= 0 THEN 'deposit'
                  ELSE 'balance' END;
    pay := hospitality._payment_insert(_t, b, _kind, 'transfer', _amount, hospitality._site_today(_t),
                                       COALESCE(_n, 'העברה בנקאית — אישור שהאורח העלה'), NULL, NULL, 'staff');
    UPDATE hospitality.payment_proofs x
       SET status = 'approved', review_note = _n, payment_id = pay.id, reviewed_by = auth.uid(), reviewed_at = now()
     WHERE x.id = p.id;
    PERFORM hospitality._audit(_t, 'payments.proof_approved', 'הזמנה #' || b.number,
                               jsonb_build_object('proof', p.id, 'amount', pay.amount));
  END IF;
  RETURN hospitality.booking_payment_proofs(b.id);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_proof_review(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_proof_review(uuid, text, numeric, text) TO authenticated, service_role;

-- כמה אישורים ממתינים לבדיקה, והוותיק שבהם (ל"דורש טיפול" בלוח הבקרה של העסק)
DROP FUNCTION IF EXISTS hospitality.payment_proofs_waiting();
CREATE OR REPLACE FUNCTION hospitality.payment_proofs_waiting()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _count integer;
  _booking uuid;
  _number integer;
BEGIN
  SELECT count(*)::integer INTO _count
    FROM hospitality.payment_proofs p WHERE p.tenant_id = _t AND p.status = 'submitted';
  SELECT b.id, b.number INTO _booking, _number
    FROM hospitality.payment_proofs p
    JOIN hospitality.bookings b ON b.tenant_id = p.tenant_id AND b.id = p.booking_id
   WHERE p.tenant_id = _t AND p.status = 'submitted'
   ORDER BY p.submitted_at, p.id
   LIMIT 1;
  RETURN jsonb_build_object('count', _count, 'booking_id', _booking, 'booking_number', _number);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_proofs_waiting() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_proofs_waiting() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 56: "ההזמנות שלי" — אזור אישי לאורח באתר (שלב א' 2)
--
--   • הכניסה: קוד חד-פעמי למייל (6 ספרות, 10 דקות, עד 5 ניסיונות). במסד רק HMAC של הקוד (עם סוד
--     השרת). קוד נשלח רק כשיש באתר הזה הזמנה עם הכתובת — והתשובה לגולש זהה תמיד (בלי חשיפה מי
--     הזמין); עד קוד אחד ל-30 שניות ו-5 קודים בשעה לכתובת, גם כשאין הזמנות.
--   • אחרי קוד נכון — חיבור לאתר הזה בלבד (guest_sessions): טוקן אקראי בעוגייה HttpOnly של האתר,
--     במסד רק ה-hash; בתוקף 14 יום; יציאה מבטלת אותו במסד.
--   • מה רואים: בדיוק ההזמנות באתר הזה שהאימייל שלהן הוא הכתובת שהוכחה בקוד — אותן הזמנות שהקישור
--     האישי שלהן כבר נשלח לתיבה הזו. בלי שיוך לחשבונות המערכת (חשבון שנפתח עם סיסמה לא נותן גישה
--     לכאן), בלי מאגר משותף בין אתרים, ואורח שפרטיו נמחקו (אנונימיזציה) — לא מוצג.
--   • מה עושים: רשימה (תאריכים, יחידה, אורחים, מחיר, מצב תשלום ומצב הזמנה, מצב ההעברה), פרטי הזמנה
--     עם הוראות התשלום ואישורי ההעברה, העלאת אישור העברה ובחירת אמצעי תשלום — באותם כללים של
--     הקישור האישי (מיגרציה 55).
--   • כל הפונקציות החדשות לשרת בלבד (מפתח השירות): העוגייה לא נגישה לדפדפן, והשרת מעביר רק את ה-hash.
--   • guest_payment_info / guest_set_payment_method / guest_proof_slot (55) — אותה התנהגות בדיוק; הגוף
--     עבר לעזרים פנימיים שמשמשים גם את האזור האישי.
--
-- בלי שינוי בנתונים קיימים: שתי טבלאות חדשות. החנויות (Ecommerce) ואתרי אירוח אחרים לא מושפעים.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. קודי כניסה וחיבורים
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.guest_codes (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  -- HMAC-SHA256 (base64url) של אתר:כתובת:קוד — לא הקוד עצמו
  code_hash   text NOT NULL CHECK (code_hash ~ '^[A-Za-z0-9_-]{43}$'),
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);
COMMENT ON TABLE hospitality.guest_codes IS
  'Hospitality (שלב א'' 2): קודי כניסה לאזור "ההזמנות שלי" — רק HMAC של הקוד; נמחקים אחרי יום. רק דרך פונקציות.';
CREATE INDEX IF NOT EXISTS guest_codes_email_idx ON hospitality.guest_codes (tenant_id, email, created_at DESC);

CREATE TABLE IF NOT EXISTS hospitality.guest_sessions (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  -- SHA-256 של הטוקן שבעוגייה
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
COMMENT ON TABLE hospitality.guest_sessions IS
  'Hospitality (שלב א'' 2): חיבורים לאזור "ההזמנות שלי" אחרי קוד נכון למייל — רק hash של הטוקן; 14 יום; יציאה מבטלת.';
CREATE INDEX IF NOT EXISTS guest_sessions_tenant_idx ON hospitality.guest_sessions (tenant_id, expires_at);

DO $$
DECLARE _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['guest_codes', 'guest_sessions'] LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated, service_role', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag(''hospitality_backend_enabled'')))
                      WITH CHECK ((SELECT hospitality.flag(''hospitality_backend_enabled'')))', _tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _tbl);
    EXECUTE format('CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()', _tbl);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. עזרים פנימיים
-- ------------------------------------------------------------
-- יש באתר הזה הזמנה עם הכתובת (של אורח שפרטיו לא נמחקו)?
CREATE OR REPLACE FUNCTION hospitality._guest_area_has_bookings(_t uuid, _email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.guests g
                   JOIN hospitality.bookings b ON b.tenant_id = g.tenant_id AND b.guest_id = g.id
                  WHERE g.tenant_id = _t AND g.email_normalized = _email AND g.anonymized_at IS NULL);
$$;

-- הכתובת של חיבור בתוקף לאתר הזה — או שגיאה (השרת מציג שוב את מסך הכניסה)
CREATE OR REPLACE FUNCTION hospitality._guest_area_email(_t uuid, _session_hash text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _e text;
BEGIN
  IF _session_hash IS NOT NULL AND _session_hash ~ '^[0-9a-f]{64}$' THEN
    SELECT s.email INTO _e FROM hospitality.guest_sessions s
     WHERE s.tenant_id = _t AND s.token_hash = _session_hash AND s.revoked_at IS NULL AND s.expires_at > now();
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'החיבור הסתיים — היכנסו שוב עם קוד למייל' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN _e;
END $$;

-- הזמנה של הכתובת באתר הזה (לפי האימייל של האורח בהזמנה)
CREATE OR REPLACE FUNCTION hospitality._guest_area_booking(_t uuid, _email text, _booking_id uuid, _lock boolean)
RETURNS hospitality.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  SELECT x.* INTO b FROM hospitality.bookings x
    JOIN hospitality.guests g ON g.tenant_id = x.tenant_id AND g.id = x.guest_id
   WHERE x.tenant_id = _t AND x.id = _booking_id AND g.email_normalized = _email AND g.anonymized_at IS NULL;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _lock THEN
    SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = b.id FOR UPDATE;
  END IF;
  RETURN b;
END $$;

-- הוראות התשלום ומצב ההעברה של הזמנה (הגוף של guest_payment_info, מיגרציה 55 — בלי שינוי)
CREATE OR REPLACE FUNCTION hospitality._guest_payment_json(_t uuid, b hospitality.bookings)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p hospitality.payment_settings;
  _methods text[];
  _due numeric;
  _deposit numeric;
  _transfer jsonb;
BEGIN
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

-- האורח בוחר אמצעי תשלום (הגוף של guest_set_payment_method, מיגרציה 55 — בלי שינוי)
CREATE OR REPLACE FUNCTION hospitality._set_payment_method(_t uuid, b hospitality.bookings, _method text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _methods text[] := hospitality._payment_methods(_t);
BEGIN
  IF _method IS NULL OR _method NOT IN ('bank', 'bit', 'phone', 'other') THEN
    RAISE EXCEPTION 'אמצעי התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
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
END $$;

-- מקום לקובץ אישור (הגוף של guest_proof_slot, מיגרציה 55 — בלי שינוי)
CREATE OR REPLACE FUNCTION hospitality._proof_slot(_t uuid, b hospitality.bookings, _file_name text, _mime text,
                                                  _size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _state jsonb := hospitality._transfer_state(b);
  _id uuid := gen_random_uuid();
  _path text;
  _recent integer;
BEGIN
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

REVOKE ALL ON FUNCTION hospitality._guest_area_has_bookings(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._guest_area_email(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._guest_area_booking(uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._guest_payment_json(uuid, hospitality.bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._set_payment_method(uuid, hospitality.bookings, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hospitality._proof_slot(uuid, hospitality.bookings, text, text, integer) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. הקישור האישי (מיגרציה 55) — אותה התנהגות, דרך העזרים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.guest_payment_info(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  RETURN hospitality._guest_payment_json(_t, hospitality._guest_booking(_t, _token, _booking_id, false));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_payment_info(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_payment_info(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_set_payment_method(_token text, _booking_id uuid, _method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  IF _method IS NULL OR _method NOT IN ('bank', 'bit', 'phone', 'other') THEN
    RAISE EXCEPTION 'אמצעי התשלום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_payment_method(_t, hospitality._guest_booking(_t, _token, _booking_id, true), _method);
  RETURN hospitality.guest_payment_info(_token, _booking_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_set_payment_method(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_set_payment_method(text, uuid, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_proof_slot(_token text, _booking_id uuid, _file_name text,
                                                        _mime text, _size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  RETURN hospitality._proof_slot(_t, hospitality._guest_booking(_t, _token, _booking_id, true),
                                 _file_name, _mime, _size);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_proof_slot(text, uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_proof_slot(text, uuid, text, text, integer) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4. הכניסה: קוד למייל → חיבור (לשרת בלבד)
-- ------------------------------------------------------------
-- קוד חדש לכתובת (מבטל קודמים). send=false — אין באתר הזה הזמנות עם הכתובת: השרת לא שולח מייל,
-- והתשובה לגולש זהה. המגבלות חלות תמיד (גם בלי הזמנות) — כך שגם הן לא מגלות מי הזמין.
CREATE OR REPLACE FUNCTION hospitality.guest_code_issue(_email text, _code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality.normalize_email(_email);
  _last timestamptz;
  _hour integer;
BEGIN
  IF _e IS NULL OR char_length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _code_hash IS NULL OR _code_hash !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'בקשה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  -- ניקיון: קודים מעל יום וחיבורים שפגו מעל יום (של האתר הזה)
  DELETE FROM hospitality.guest_codes c WHERE c.tenant_id = _t AND c.created_at < now() - interval '1 day';
  DELETE FROM hospitality.guest_sessions s WHERE s.tenant_id = _t AND s.expires_at < now() - interval '1 day';
  SELECT max(c.created_at), count(*) FILTER (WHERE c.created_at > now() - interval '1 hour')
    INTO _last, _hour
    FROM hospitality.guest_codes c WHERE c.tenant_id = _t AND c.email = _e;
  IF _last > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'קוד נשלח זה עתה — אפשר לבקש קוד חדש בעוד חצי דקה' USING ERRCODE = 'check_violation';
  END IF;
  IF _hour >= 5 THEN
    RAISE EXCEPTION 'נשלחו כבר כמה קודים לכתובת הזו — נסו שוב בעוד שעה' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.guest_codes c SET consumed_at = now()
   WHERE c.tenant_id = _t AND c.email = _e AND c.consumed_at IS NULL;
  INSERT INTO hospitality.guest_codes (tenant_id, email, code_hash, expires_at)
  VALUES (_t, _e, _code_hash, now() + interval '10 minutes');
  RETURN jsonb_build_object('send', hospitality._guest_area_has_bookings(_t, _e));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_code_issue(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_code_issue(text, text) TO service_role;

-- קוד נכון (חד-פעמי, עד 5 ניסיונות) → חיבור חדש עם ה-hash שהשרת יצר
CREATE OR REPLACE FUNCTION hospitality.guest_code_consume(_email text, _code_hash text, _session_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality.normalize_email(_email);
  c hospitality.guest_codes;
BEGIN
  IF _session_hash IS NULL OR _session_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'בקשה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM hospitality.guest_codes x
   WHERE x.tenant_id = _t AND x.email = _e AND x.consumed_at IS NULL
   ORDER BY x.created_at DESC LIMIT 1
   FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;
  IF c.expires_at <= now() THEN
    UPDATE hospitality.guest_codes x SET consumed_at = now() WHERE x.id = c.id;
    RETURN jsonb_build_object('result', 'expired');
  END IF;
  IF _code_hash IS DISTINCT FROM c.code_hash THEN
    UPDATE hospitality.guest_codes x
       SET attempts = x.attempts + 1,
           consumed_at = CASE WHEN x.attempts + 1 >= 5 THEN now() END
     WHERE x.id = c.id;
    IF c.attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('result', 'locked');
    END IF;
    RETURN jsonb_build_object('result', 'invalid', 'left', 5 - c.attempts - 1);
  END IF;
  UPDATE hospitality.guest_codes x SET consumed_at = now() WHERE x.id = c.id;
  INSERT INTO hospitality.guest_sessions (tenant_id, email, token_hash, expires_at)
  VALUES (_t, _e, _session_hash, now() + interval '14 days');
  RETURN jsonb_build_object('result', 'ok');
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_code_consume(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_code_consume(text, text, text) TO service_role;

-- יציאה: החיבור מבוטל במסד
CREATE OR REPLACE FUNCTION hospitality.guest_area_sign_out(_session_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  UPDATE hospitality.guest_sessions s SET revoked_at = now()
   WHERE s.tenant_id = _t AND s.token_hash = _session_hash AND s.revoked_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_sign_out(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_sign_out(text) TO service_role;

-- ------------------------------------------------------------
-- 5. האזור האישי (לשרת בלבד, לפי החיבור)
-- ------------------------------------------------------------
-- ההזמנות של הכתובת באתר הזה: הקרובות קודם (לפי ההגעה), אחר כך מה שעבר (החדש קודם)
CREATE OR REPLACE FUNCTION hospitality.guest_area_bookings(_session_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
  _today date := hospitality._site_today(_t);
BEGIN
  RETURN jsonb_build_object(
    'email', _e,
    'bookings', COALESCE((
      SELECT jsonb_agg(hospitality._guest_view(b) || jsonb_build_object(
               'payment_status', b.payment_status,
               'payment_method', b.payment_method,
               'transfer', hospitality._transfer_state(b))
             ORDER BY (b.check_out >= _today) DESC,
                      CASE WHEN b.check_out >= _today THEN b.check_in END,
                      CASE WHEN b.check_out < _today THEN b.check_in END DESC,
                      b.number)
        FROM hospitality.bookings b
        JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
       WHERE b.tenant_id = _t AND g.email_normalized = _e AND g.anonymized_at IS NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_bookings(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_bookings(text) TO service_role;

-- הזמנה אחת: הפרטים, הוראות התשלום ומצב ההעברה
CREATE OR REPLACE FUNCTION hospitality.guest_area_booking(_session_hash text, _booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
  b hospitality.bookings;
BEGIN
  b := hospitality._guest_area_booking(_t, _e, _booking_id, false);
  RETURN jsonb_build_object('booking', hospitality._guest_view(b) || jsonb_build_object(
                              'payment_status', b.payment_status, 'payment_method', b.payment_method),
                            'payment', hospitality._guest_payment_json(_t, b));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_booking(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_booking(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.guest_area_set_payment_method(_session_hash text, _booking_id uuid, _method text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
BEGIN
  PERFORM hospitality._set_payment_method(_t, hospitality._guest_area_booking(_t, _e, _booking_id, true), _method);
  RETURN hospitality._guest_payment_json(_t, hospitality._guest_area_booking(_t, _e, _booking_id, false));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_set_payment_method(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_set_payment_method(text, uuid, text) TO service_role;

-- מקום לקובץ אישור — אחר כך השרת מעלה ומסמן "התקבל" (guest_proof_ready, מיגרציה 55)
CREATE OR REPLACE FUNCTION hospitality.guest_area_proof_slot(_session_hash text, _booking_id uuid, _file_name text,
                                                             _mime text, _size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _e text := hospitality._guest_area_email(_t, _session_hash);
BEGIN
  RETURN hospitality._proof_slot(_t, hospitality._guest_area_booking(_t, _e, _booking_id, true),
                                 _file_name, _mime, _size);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_area_proof_slot(text, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.guest_area_proof_slot(text, uuid, text, text, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Rollback ל-SEC P3: ההרשאה, ה-policy ושתי פונקציות הבקשה מהאתר חוזרות לגרסה הקודמת.
-- ============================================================
BEGIN;

-- L2 (אותו סדר הרשאות כמו במקור: authenticated ואז service_role)
REVOKE ALL ON FUNCTION public.resolve_login_email(text) FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO service_role;

-- L5
DROP POLICY IF EXISTS "anyone can request reset" ON public.password_reset_requests;
CREATE POLICY "anyone can request reset" ON public.password_reset_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'new' AND admin_note IS NULL);

-- L9: request_booking (גרסת SEC-M3)
CREATE OR REPLACE FUNCTION hospitality.request_booking(_unit_id uuid, _check_in date, _check_out date, _full_name text, _email text, _phone text, _idempotency_key text, _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2, _children integer DEFAULT 0, _special_requests text DEFAULT NULL::text, _promo_code text DEFAULT NULL::text, _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _e text := hospitality.normalize_email(_email);
  _p text := hospitality.normalize_phone(_phone);
  _name text := btrim(COALESCE(_full_name, ''));
  s hospitality.settings;
  g hospitality.guests;
  b hospitality.bookings;
  _q jsonb;
  _open integer;
  _token text;
  _status text;
  _acceptance jsonb;
BEGIN
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _idempotency_key IS NULL OR _idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$' THEN
    RAISE EXCEPTION 'חסר מזהה בקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר את תנאי הביטול לפני שליחת הבקשה' USING ERRCODE = 'check_violation';
  END IF;

  -- אותו איש קשר — אחת אחרי השנייה (גם לתקרה וגם ל-idempotency); סדר קבוע
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contact:' || _t || ':' || k, 0))
     FROM unnest(ARRAY['e:' || _e, 'p:' || _p]) k ORDER BY k;

  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id AND x.email_normalized = _e) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', true,
                              'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                              'currency', b.currency, 'manage_token', NULL);
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;

  SELECT count(*) INTO _open
    FROM hospitality.bookings x
    JOIN hospitality.guests y ON y.tenant_id = x.tenant_id AND y.id = x.guest_id
   WHERE x.tenant_id = _t AND x.status IN ('pending_approval', 'pending_payment') AND x.hold_expires_at > now()
     AND (y.email_normalized = _e OR y.phone_normalized = _p);
  IF _open >= s.max_open_requests THEN
    RAISE EXCEPTION 'כבר יש % בקשות פתוחות מאותם פרטי קשר — נא להמתין לתשובת העסק', _open
      USING ERRCODE = 'check_violation';
  END IF;
  -- SEC-M3: בקשה מהאתר — עד 14 לילות, ותקרה לעסק על לילות-יחידה שמוחזקים בבקשות שלא אושרו
  PERFORM hospitality._online_hold_guard(_t, ARRAY[_unit_id], _check_in, _check_out);

  _q := hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, _promo_code, true);
  IF NOT (_q ->> 'available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
  IF _policy_hash IS DISTINCT FROM _q ->> 'policy_hash' THEN
    RAISE EXCEPTION 'תנאי ההזמנה השתנו — נא לעיין בהם שוב ולאשר' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO g FROM hospitality.guests x
   WHERE x.tenant_id = _t AND x.email_normalized = _e AND x.anonymized_at IS NULL
   ORDER BY x.created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone, marketing_consent)
    VALUES (_t, _name, _e, _phone, COALESCE(_marketing_consent, false))
    RETURNING * INTO g;
  ELSIF _marketing_consent AND NOT g.marketing_consent THEN
    UPDATE hospitality.guests x SET marketing_consent = true WHERE x.id = g.id RETURNING * INTO g;
  END IF;
  -- אורח מחובר עם אותו אימייל מאומת — מקשרים (אימייל שהוקלד בלבד לא מקשר כלום)
  -- SEC-C1: אין קישור הזמנה לחשבון בזמן הבקשה. קישור רק דרך claim_guest_bookings(_token)
  -- עם הוכחת בעלות (אסימון הניהול מהמייל). (הבלוק הקודם סמך על email_confirmed_at שאוטו-אישור מאיין.)

  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _status := CASE s.booking_mode WHEN 'instant' THEN 'confirmed' ELSE 'pending_approval' END;
  _acceptance := jsonb_build_object(
    'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
    'language', left(COALESCE(_language, 'he'), 10),
    'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
    'user_agent', left(hospitality._header('user-agent'), 300));

  PERFORM hospitality._set_actor('guest', NULL);
  BEGIN
    b := hospitality._create_booking(_t, _q, g.id, _status, 'site', NULL, NULL, _q -> 'policy', _acceptance,
                                     _idempotency_key, NULL, _special_requests,
                                     encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
  END;
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
          jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _q -> 'policy' -> 'policy_id',
                             'version', _q -> 'policy' -> 'version', 'channel', 'site'));

  IF _status = 'confirmed' THEN
    PERFORM hospitality._enqueue(b, 'new_booking', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest', jsonb_build_object('manage_token', _token), true);
  ELSE
    PERFORM hospitality._enqueue(b, 'new_request', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'request_received', 'guest', jsonb_build_object('manage_token', _token), true);
  END IF;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', false,
                            'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                            'currency', b.currency, 'manage_token', _token);
END $function$;

-- L9: request_booking_group (גרסת SEC-M3)
CREATE OR REPLACE FUNCTION hospitality.request_booking_group(_rooms jsonb, _check_in date, _check_out date, _full_name text, _email text, _phone text, _idempotency_key text, _policy_accepted boolean, _special_requests text DEFAULT NULL::text, _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _e text := hospitality.normalize_email(_email);
  _p text := hospitality.normalize_phone(_phone);
  _name text := btrim(COALESCE(_full_name, ''));
  s hospitality.settings;
  g hospitality.guests;
  b hospitality.bookings;
  _first hospitality.bookings;
  _room jsonb;
  _q jsonb;
  _quotes jsonb := '[]'::jsonb;
  _units uuid[];
  _open integer;
  _token text;
  _status text;
  _acceptance jsonb;
  _group uuid := gen_random_uuid();
  _n integer := 0;
  _total numeric := 0;
  _out jsonb := '[]'::jsonb;
BEGIN
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  -- מזהי ההזמנות של החדרים: המזהה + "-1", "-2"…
  IF _idempotency_key IS NULL OR _idempotency_key !~ '^[A-Za-z0-9_-]{8,90}$' THEN
    RAISE EXCEPTION 'חסר מזהה בקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר את תנאי הביטול לפני שליחת הבקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _rooms IS NULL OR jsonb_typeof(_rooms) <> 'array' OR jsonb_array_length(_rooms) NOT BETWEEN 2 AND 8
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_rooms) r
                 WHERE jsonb_typeof(r) <> 'object' OR NOT (r ->> 'unit_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'בקשה לכמה חדרים — בין 2 ל-8 חדרים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg((r ->> 'unit_id')::uuid) INTO _units FROM jsonb_array_elements(_rooms) r;
  IF cardinality(_units) <> (SELECT count(DISTINCT x) FROM unnest(_units) x) THEN
    RAISE EXCEPTION 'כל חדר — פעם אחת בבקשה' USING ERRCODE = 'check_violation';
  END IF;

  -- אותו איש קשר — אחת אחרי השנייה (כמו בבקשה לחדר אחד)
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contact:' || _t || ':' || k, 0))
     FROM unnest(ARRAY['e:' || _e, 'p:' || _p]) k ORDER BY k;

  -- אותה בקשה שוב (אותו מזהה) — הקבוצה הקיימת, בלי קישורים ובלי מיילים
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key || '-1';
  IF FOUND THEN
    IF b.group_id IS NULL OR NOT EXISTS (
         SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id AND x.email_normalized = _e) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'group_id', b.group_id, 'duplicate', true, 'status', b.status, 'currency', b.currency,
      'hold_expires_at', hospitality._ts(b.hold_expires_at),
      'total', (SELECT sum(x.total) FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.group_id = b.group_id),
      'bookings', (SELECT jsonb_agg(jsonb_build_object('booking_id', x.id, 'number', x.number, 'unit_id', x.unit_id,
                                                       'unit_name', u.name, 'adults', x.adults, 'children', x.children,
                                                       'total', x.total, 'manage_token', NULL) ORDER BY x.number)
                     FROM hospitality.bookings x
                     JOIN hospitality.units u ON u.tenant_id = x.tenant_id AND u.id = x.unit_id
                    WHERE x.tenant_id = _t AND x.group_id = b.group_id));
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;

  -- בקשות פתוחות מאותם פרטי קשר — בקשה לכמה חדרים נספרת כאחת
  SELECT count(DISTINCT COALESCE(x.group_id, x.id)) INTO _open
    FROM hospitality.bookings x
    JOIN hospitality.guests y ON y.tenant_id = x.tenant_id AND y.id = x.guest_id
   WHERE x.tenant_id = _t AND x.status IN ('pending_approval', 'pending_payment') AND x.hold_expires_at > now()
     AND (y.email_normalized = _e OR y.phone_normalized = _p);
  IF _open >= s.max_open_requests THEN
    RAISE EXCEPTION 'כבר יש % בקשות פתוחות מאותם פרטי קשר — נא להמתין לתשובת העסק', _open
      USING ERRCODE = 'check_violation';
  END IF;
  -- SEC-M3: בקשה מהאתר — עד 14 לילות, ותקרה לעסק על לילות-יחידה שמוחזקים בבקשות שלא אושרו
  PERFORM hospitality._online_hold_guard(_t, _units, _check_in, _check_out);

  -- כל החדרים: פנויים ופתוחים, בתנאים שהאורח ראה ואישר (כל חדר — התנאים שלו)
  FOR _room IN SELECT r FROM jsonb_array_elements(_rooms) WITH ORDINALITY AS e(r, i) ORDER BY i LOOP
    IF EXISTS (SELECT 1 FROM hospitality.units u
                WHERE u.tenant_id = _t AND u.id = (_room ->> 'unit_id')::uuid
                  AND (u.kind = 'whole_property' OR u.category_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'את "כל המתחם" ואת חדרי המלון מזמינים בבקשה נפרדת' USING ERRCODE = 'check_violation';
    END IF;
    _q := hospitality._quote(_t, (_room ->> 'unit_id')::uuid, _check_in, _check_out,
                             COALESCE((_room ->> 'adults')::integer, 2), COALESCE((_room ->> 'children')::integer, 0),
                             NULL, true);
    IF NOT (_q ->> 'available')::boolean THEN
      RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים ב%', _q ->> 'unit_name' USING ERRCODE = 'exclusion_violation';
    END IF;
    IF (_room ->> 'policy_hash') IS DISTINCT FROM _q ->> 'policy_hash' THEN
      RAISE EXCEPTION 'תנאי ההזמנה השתנו — נא לעיין בהם שוב ולאשר' USING ERRCODE = 'check_violation';
    END IF;
    _quotes := _quotes || jsonb_build_array(_q);
  END LOOP;

  SELECT * INTO g FROM hospitality.guests x
   WHERE x.tenant_id = _t AND x.email_normalized = _e AND x.anonymized_at IS NULL
   ORDER BY x.created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone, marketing_consent)
    VALUES (_t, _name, _e, _phone, COALESCE(_marketing_consent, false))
    RETURNING * INTO g;
  ELSIF _marketing_consent AND NOT g.marketing_consent THEN
    UPDATE hospitality.guests x SET marketing_consent = true WHERE x.id = g.id RETURNING * INTO g;
  END IF;
  -- SEC-C1: אין קישור הזמנה לחשבון בזמן הבקשה. קישור רק דרך claim_guest_bookings(_token)
  -- עם הוכחת בעלות (אסימון הניהול מהמייל). (הבלוק הקודם סמך על email_confirmed_at שאוטו-אישור מאיין.)

  _status := CASE s.booking_mode WHEN 'instant' THEN 'confirmed' ELSE 'pending_approval' END;
  PERFORM hospitality._set_actor('guest', NULL);
  FOR _q IN SELECT x FROM jsonb_array_elements(_quotes) WITH ORDINALITY AS e(x, i) ORDER BY i LOOP
    _n := _n + 1;
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    _acceptance := jsonb_build_object(
      'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
      'language', left(COALESCE(_language, 'he'), 10), 'group_id', _group,
      'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
      'user_agent', left(hospitality._header('user-agent'), 300));
    BEGIN
      b := hospitality._create_booking(_t, _q, g.id, _status, 'site', NULL, NULL, _q -> 'policy', _acceptance,
                                       _idempotency_key || '-' || _n, NULL, _special_requests,
                                       encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END;
    -- תזכורת האישור לעסק — אחת לקבוצה (בחדר הראשון)
    UPDATE hospitality.bookings x
       SET group_id = _group, reminder_due_at = CASE WHEN _n = 1 THEN x.reminder_due_at END
     WHERE x.id = b.id RETURNING * INTO b;
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
    VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
            jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _q -> 'policy' -> 'policy_id',
                               'version', _q -> 'policy' -> 'version', 'channel', 'site', 'group_id', _group));
    IF _n = 1 THEN
      _first := b;
    END IF;
    _total := _total + b.total;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'booking_id', b.id, 'number', b.number, 'unit_id', b.unit_id, 'unit_name', _q ->> 'unit_name',
      'adults', b.adults, 'children', b.children, 'total', b.total, 'manage_token', _token));
  END LOOP;

  -- מייל אחד לעסק ומייל אחד לאורח — כל החדרים (לאורח: קישור אישי לכל חדר)
  PERFORM hospitality._enqueue(_first, CASE _status WHEN 'confirmed' THEN 'new_group_booking' ELSE 'new_group_request' END,
                               'owner', jsonb_build_object(
                                 'rooms', (SELECT jsonb_agg(r - 'manage_token' - 'booking_id' - 'unit_id') FROM jsonb_array_elements(_out) r),
                                 'room_count', _n, 'total', _total), true);
  PERFORM hospitality._enqueue(_first, CASE _status WHEN 'confirmed' THEN 'group_booking_confirmed' ELSE 'group_request_received' END,
                               'guest', jsonb_build_object(
                                 'rooms', (SELECT jsonb_agg(r - 'booking_id' - 'unit_id') FROM jsonb_array_elements(_out) r),
                                 'room_count', _n, 'total', _total), true);
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('group_id', _group, 'duplicate', false, 'status', _status, 'total', _total,
                            'currency', _first.currency, 'hold_expires_at', hospitality._ts(_first.hold_expires_at),
                            'bookings', _out);
END $function$;

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 44: כמה חדרים בבקשה אחת
--
-- אורח שרוצה, למשל, שני חדרים (ולא את כל המתחם) שולח בקשה אחת: כל החדרים נתפסים יחד או אף אחד,
-- מייל אחד לאורח (עם קישור אישי לכל חדר) ומייל אחד לעסק. בעל העסק מאשר / דוחה את כל החדרים בלחיצה
-- אחת — והאורח מקבל מייל אחד. כל חדר הוא הזמנה רגילה (תשלומים, ביטול, שינוי — לכל חדר בנפרד), עם
-- מזהה קבוצה משותף. שום פונקציה קיימת לא משתנה.
--   1. bookings.group_id — מזהה הקבוצה (ריק — הזמנה של חדר אחד).
--   2. public_free_units(_check_in, _check_out) — לאתר: יחידות (לא "כל המתחם", לא חדרי מלון לפי
--      סוג) שפתוחות ופנויות בתאריכים — להוספת חדר.
--   3. request_booking_group(...) — לשרת האפליקציה בלבד (כמו request_booking): 2–8 חדרים, אותם כללים
--      (התנאים שהאורח אישר לכל חדר, תפוסה, תאריכים פתוחים, מגבלת הבקשות הפתוחות — כאן הבקשה נספרת
--      כאחת). תזכורת האישור לעסק — אחת לקבוצה.
--   4. booking_group(_booking_id) — לצוות: החדרים של הקבוצה.
--   5. booking_group_decide(_booking_id, _approve, _reason) — לצוות: אישור / דחייה של כל החדרים
--      שממתינים, דרך approve_booking / decline_booking, ומייל אחד לאורח במקום מייל לכל חדר.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105210000_hosp_booking_groups.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. העמודה
-- ------------------------------------------------------------
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS bookings_group_idx ON hospitality.bookings (tenant_id, group_id) WHERE group_id IS NOT NULL;
COMMENT ON COLUMN hospitality.bookings.group_id IS
  'בקשה אחת לכמה חדרים (מיגרציה 44): אותו מזהה לכל החדרים; ריק — הזמנה של חדר אחד';

-- ------------------------------------------------------------
-- 2. יחידות פנויות ופתוחות בתאריכים — להוספת חדר באתר
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.public_free_units(_check_in date, _check_out date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _today date;
BEGIN
  SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date INTO _today
    FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  IF _check_in IS NULL OR _check_out IS NULL OR _check_out <= _check_in OR _check_out - _check_in > 60
     OR _check_in < _today OR _check_in > _today + 730 THEN
    RAISE EXCEPTION 'תאריכי השהייה לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'check_in', _check_in, 'check_out', _check_out,
    'units', COALESCE((
      SELECT jsonb_agg(u.id ORDER BY p.sort_order, u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active'
         AND u.kind <> 'whole_property' AND u.category_id IS NULL
         AND u.open_until IS NOT NULL AND _check_out - 1 <= u.open_until
         AND _check_out - _check_in >= u.min_nights
         AND NOT EXISTS (
               SELECT 1 FROM hospitality.unit_occupancy o
                 LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
                WHERE o.tenant_id = _t AND o.unit_id = ANY (hospitality._fanout_units(_t, u.id))
                  AND o.nights && daterange(_check_in, _check_out)
                  AND NOT COALESCE(b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now(), false))),
      '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_free_units(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_free_units(date, date) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. בקשה אחת לכמה חדרים (שרת האפליקציה בלבד — אחרי הבדיקה נגד בוטים והגבלת הקצב)
-- ------------------------------------------------------------
-- _rooms: [{"unit_id", "adults", "children", "policy_hash"}] — 2 עד 8 חדרים שונים
CREATE OR REPLACE FUNCTION hospitality.request_booking_group(
  _rooms jsonb, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _special_requests text DEFAULT NULL,
  _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  IF auth.uid() IS NOT NULL AND g.user_id IS NULL AND EXISTS (
       SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
          AND lower(u.email) = _e) THEN
    UPDATE hospitality.guests x SET user_id = auth.uid() WHERE x.id = g.id;
  END IF;

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
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_group(jsonb, date, date, text, text, text, text, boolean, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_group(jsonb, date, date, text, text, text, text, boolean, text, boolean, text)
  TO service_role;

-- ------------------------------------------------------------
-- 4. לצוות: החדרים של הקבוצה (מעמוד ההזמנה של אחד מהם)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.booking_group(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  _g uuid;
BEGIN
  SELECT x.group_id INTO _g FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _g IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'group_id', _g,
    'bookings', (SELECT jsonb_agg(jsonb_build_object(
                          'id', x.id, 'number', x.number, 'unit_name', u.name, 'status', x.status,
                          'check_in', x.check_in, 'check_out', x.check_out, 'adults', x.adults,
                          'children', x.children, 'total', x.total, 'currency', x.currency,
                          'revision', x.revision) ORDER BY x.number)
                   FROM hospitality.bookings x
                   JOIN hospitality.units u ON u.tenant_id = x.tenant_id AND u.id = x.unit_id
                  WHERE x.tenant_id = _t AND x.group_id = _g));
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_group(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. לצוות: אישור / דחייה של כל החדרים שממתינים — ומייל אחד לאורח
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.booking_group_decide(_booking_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  _g uuid;
  _ids uuid[] := '{}';
  _id uuid;
  _first hospitality.bookings;
  _rooms jsonb;
  _event text := CASE WHEN _approve THEN 'booking_confirmed' ELSE 'booking_declined' END;
BEGIN
  IF _approve IS NULL THEN
    RAISE EXCEPTION 'יש לבחור אישור או דחייה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(_t);
  SELECT x.group_id INTO _g FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF _g IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  FOR _id IN SELECT x.id FROM hospitality.bookings x
              WHERE x.tenant_id = _t AND x.group_id = _g AND x.status = 'pending_approval'
              ORDER BY x.number LOOP
    IF _approve THEN
      PERFORM hospitality.approve_booking(_id, NULL);
    ELSE
      PERFORM hospitality.decline_booking(_id, _reason, NULL);
    END IF;
    _ids := _ids || _id;
  END LOOP;
  IF cardinality(_ids) = 0 THEN
    RAISE EXCEPTION 'אין בקבוצה בקשות שממתינות לאישור' USING ERRCODE = 'check_violation';
  END IF;
  -- המיילים לאורח שנוצרו עכשיו (מייל לכל חדר) → מייל אחד עם כל החדרים (ולכל חדר — הקישור האישי שלו)
  SELECT jsonb_agg(jsonb_build_object('number', n.payload -> 'booking_number', 'unit_name', n.payload -> 'unit_name',
                                      'adults', n.payload -> 'adults', 'children', n.payload -> 'children',
                                      'total', n.payload -> 'total', 'manage_token', n.payload -> 'manage_token')
                   ORDER BY (n.payload ->> 'booking_number')::integer)
    INTO _rooms
    FROM hospitality.notifications n
   WHERE n.tenant_id = _t AND n.booking_id = ANY (_ids) AND n.recipient_kind = 'guest' AND n.event = _event
     AND n.status = 'queued' AND n.created_at = now();
  DELETE FROM hospitality.notifications n
   WHERE n.tenant_id = _t AND n.booking_id = ANY (_ids) AND n.recipient_kind = 'guest' AND n.event = _event
     AND n.status = 'queued' AND n.created_at = now();
  SELECT * INTO _first FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _ids[1];
  IF _rooms IS NOT NULL THEN
    PERFORM hospitality._enqueue(_first, 'group_' || _event, 'guest',
                                 jsonb_build_object('rooms', _rooms, 'room_count', cardinality(_ids),
                                                    'total', (SELECT sum(x.total) FROM hospitality.bookings x
                                                               WHERE x.tenant_id = _t AND x.id = ANY (_ids)))
                                 || CASE WHEN _approve THEN '{}'::jsonb ELSE jsonb_build_object('reason', left(_reason, 500)) END);
  END IF;
  RETURN jsonb_build_object('group_id', _g, 'decided', cardinality(_ids),
                            'status', CASE WHEN _approve THEN 'confirmed' ELSE 'declined' END);
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_group_decide(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_group_decide(uuid, boolean, text) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 65: תיקון פרטי הלקוח בהזמנה / באירוע קיימים (שם, טלפון, אימייל)
--
-- עד עכשיו פרטי הלקוח נקבעו פעם אחת (בבקשה מהאתר, בהזמנה ידנית או באירוע) ולא היה אפשר לתקן אותם —
-- טעות באימייל אומרת שהלקוח לא מקבל את המיילים, את הקישור האישי ואת החוזה. עכשיו:
--   • booking_customer_update(_booking_id, _expected_revision, _data, _scope, _notify) — הצוות (הרשאת
--     guests וגם bookings) מתקן את השם / הטלפון / האימייל של לקוח ההזמנה:
--       _scope 'guest'   — בכרטיס הלקוח עצמו (משותף לכל ההזמנות והאירועים שלו);
--       _scope 'booking' — רק להזמנה הזו (ולקבוצת החדרים שלה): ההזמנה עוברת לכרטיס אחר — קיים לפי
--                          האימייל (ואם אין — הטלפון), או חדש. הכרטיס הקיים לא משתנה;
--     אין הזמנה חדשה ואין מחיקה: התאריכים, המחיר, המצב והתשלומים לא משתנים;
--   • אימייל שהשתנה: הקישורים האישיים שנשלחו לכתובת הקודמת מתבטלים, מיילים לאורח שעוד לא יצאו לכתובת
--     הקודמת לא יוצאים, וחיבור לחשבון של הכתובת הקודמת מתנתק; _notify — מייל "פרטי ההזמנה" עם קישור
--     אישי חדש לכתובת המעודכנת;
--   • חוזה פתוח (טרם נחתם) שנוצר מכרטיס הלקוח — פרטי החותם מתעדכנים והקישור שנשלח מתבטל (שולחים
--     שוב מהכרטיס של ההזמנה); חוזה חתום לא משתנה לעולם — מוחזר כדי להציע חוזה מתוקן (מיגרציה 64),
--     והקודם נשאר בארכיון;
--   • booking_resend_details(_booking_id) — "פרטי ההזמנה" שוב לכתובת של הלקוח, עם קישור חדש (הקודם
--     מתבטל). להזמנה פעילה בלבד;
--   • event_customer_update(_event_id, _expected_revision, _data, _scope) — אותו תיקון לאירוע (בלי
--     קישור אישי ובלי מייל — לאירוע אין עמוד לקוח);
--   • תיעוד: בהיסטוריה של ההזמנה / האירוע (מי, מתי, אילו שדות; אימייל וטלפון — ממוסכים בלבד, כי
--     ההיסטוריה לא נמחקת במחיקת פרטי אורח) וביומן הפעולות של הצוות.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261111130000_hosp_customer_details.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הקלט: רק השדות שנשלחו, בדוקים (אימייל ריק — מחיקת האימייל; שם וטלפון — חובה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._customer_patch(_data jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  k text;
  _out jsonb := '{}'::jsonb;
  _s text;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'פרטי הלקוח לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_data) LOOP
    IF k NOT IN ('full_name', 'phone', 'email') THEN
      RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF _data ? 'full_name' THEN
    _s := hospitality._cv_text(_data -> 'full_name', 'שם הלקוח', 120, true);
    IF char_length(_s) < 2 THEN
      RAISE EXCEPTION 'נא למלא את שם הלקוח' USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_object('full_name', _s);
  END IF;
  IF _data ? 'phone' THEN
    _s := hospitality._cv_text(_data -> 'phone', 'טלפון', 30, true);
    IF hospitality.normalize_phone(_s) IS NULL THEN
      RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_object('phone', _s);
  END IF;
  IF _data ? 'email' THEN
    _s := hospitality._cv_text(_data -> 'email', 'אימייל', 254, false);
    IF _s IS NOT NULL AND hospitality.normalize_email(_s) IS NULL THEN
      RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_object('email', hospitality.normalize_email(_s));
  END IF;
  IF _out = '{}'::jsonb THEN
    RAISE EXCEPTION 'לא נשלח אף פרט לעדכון' USING ERRCODE = 'check_violation';
  END IF;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._customer_patch(jsonb) FROM PUBLIC, anon, authenticated;

-- הזמנה "פעילה" — אפשר לשלוח לה פרטים וקישור (לא בוטלה / נדחתה / פגה, והאורח עוד לא עזב)
CREATE OR REPLACE FUNCTION hospitality._booking_active(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _status IN ('pending_approval', 'pending_payment', 'confirmed', 'cancel_requested', 'checked_in');
$$;
REVOKE ALL ON FUNCTION hospitality._booking_active(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. "פרטי ההזמנה" ללקוח: קישור אישי חדש לכל חדר פעיל בקבוצה (הקודמים מתבטלים), ומייל אחד
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._send_booking_details(_t uuid, _booking uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r hospitality.bookings;
  _lead hospitality.bookings;
  _token text;
  _first_token text;
  _rooms jsonb := '[]'::jsonb;
  _total numeric := 0;
  _n integer := 0;
BEGIN
  FOR r IN SELECT x.* FROM hospitality.bookings x
            WHERE x.tenant_id = _t AND x.id = ANY (hospitality._contract_booking_ids(_t, _booking))
              AND hospitality._booking_active(x.status)
            ORDER BY x.number FOR UPDATE
  LOOP
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    UPDATE hospitality.bookings x
       SET manage_token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex'), manage_token2_hash = NULL,
           manage_token_expires_at = ((x.check_out + 31)::timestamp)
                                     AT TIME ZONE COALESCE(NULLIF(x.policy_snapshot ->> 'timezone', ''), 'Asia/Jerusalem')
     WHERE x.id = r.id RETURNING * INTO r;
    _n := _n + 1;
    IF _n = 1 THEN
      _lead := r;
      _first_token := _token;
    END IF;
    _total := _total + r.total;
    _rooms := _rooms || jsonb_build_array(jsonb_build_object(
      'number', r.number, 'unit_name', (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = r.unit_id),
      'adults', r.adults, 'children', r.children, 'total', r.total, 'manage_token', _token));
  END LOOP;
  IF _n = 0 THEN
    RETURN 0;
  END IF;
  RETURN hospitality._enqueue(_lead, 'booking_details', 'guest',
    CASE WHEN _n > 1 THEN jsonb_build_object('rooms', _rooms, 'room_count', _n, 'total', _total)
         ELSE jsonb_build_object('manage_token', _first_token) END);
END $$;
REVOKE ALL ON FUNCTION hospitality._send_booking_details(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. התיקון עצמו (משותף להזמנה ולאירוע): הכרטיס או הקישור לכרטיס אחר, הקישורים, המיילים בתור,
--    והחוזים הפתוחים. מחזיר מה השתנה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._customer_apply(_t uuid, g hospitality.guests, _patch jsonb, _scope text,
                                                       _booking_ids uuid[], _event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _name text := COALESCE(_patch ->> 'full_name', g.full_name);
  _phone text := CASE WHEN _patch ? 'phone' THEN _patch ->> 'phone' ELSE g.phone END;
  _email text := CASE WHEN _patch ? 'email' THEN _patch ->> 'email' ELSE g.email_normalized END;
  _fields text[] := ARRAY[]::text[];
  _target uuid := g.id;
  _existing boolean := false;
  _affected uuid[];
  _email_changed boolean;
  _revoked integer := 0;
  _dropped integer := 0;
  c record;
  _open integer[] := ARRAY[]::integer[];
  _signed jsonb := '[]'::jsonb;
BEGIN
  IF _name IS DISTINCT FROM g.full_name THEN _fields := _fields || 'full_name'::text; END IF;
  IF hospitality.normalize_phone(_phone) IS DISTINCT FROM g.phone_normalized THEN _fields := _fields || 'phone'::text; END IF;
  _email_changed := _email IS DISTINCT FROM g.email_normalized;
  IF _email_changed THEN _fields := _fields || 'email'::text; END IF;
  IF cardinality(_fields) = 0 THEN
    RAISE EXCEPTION 'הפרטים זהים לפרטים הקיימים — לא היה מה לעדכן' USING ERRCODE = 'check_violation';
  END IF;
  IF hospitality.normalize_phone(_phone) IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;

  IF _scope = 'guest' THEN
    -- הכרטיס עצמו: חל על כל ההזמנות והאירועים שלו. חשבון שחובר לכתובת הקודמת — מתנתק
    UPDATE hospitality.guests x
       SET full_name = _name, phone = _phone, email = _email,
           user_id = CASE WHEN _email_changed THEN NULL ELSE x.user_id END, updated_at = now()
     WHERE x.tenant_id = _t AND x.id = g.id;
    _affected := ARRAY(SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id);
  ELSE
    -- רק ההזמנה / האירוע הזה: כרטיס קיים לפי האימייל (ואם אין אימייל — הטלפון), או כרטיס חדש
    SELECT x.id INTO _target FROM hospitality.guests x
     WHERE x.tenant_id = _t AND x.anonymized_at IS NULL AND x.id <> g.id
       AND ((_email IS NOT NULL AND x.email_normalized = _email)
            OR (_email IS NULL AND x.phone_normalized = hospitality.normalize_phone(_phone)))
     ORDER BY x.created_at LIMIT 1;
    _existing := _target IS NOT NULL;
    IF _target IS NULL THEN
      INSERT INTO hospitality.guests (tenant_id, full_name, email, phone) VALUES (_t, _name, _email, _phone)
      RETURNING id INTO _target;
    END IF;
    IF _event_id IS NOT NULL THEN
      UPDATE hospitality.events x SET guest_id = _target, revision = x.revision + 1, updated_at = now()
       WHERE x.tenant_id = _t AND x.id = _event_id;
      _affected := ARRAY[]::uuid[];
    ELSE
      UPDATE hospitality.bookings x SET guest_id = _target WHERE x.tenant_id = _t AND x.id = ANY (_booking_ids);
      _affected := _booking_ids;
    END IF;
  END IF;

  -- אימייל שהשתנה: מה שנשלח לכתובת הקודמת מפסיק לעבוד, ומה שעוד לא יצא אליה — לא יוצא
  IF _email_changed AND cardinality(_affected) > 0 THEN
    UPDATE hospitality.bookings x
       SET manage_token_hash = NULL, manage_token2_hash = NULL, manage_token_expires_at = NULL
     WHERE x.tenant_id = _t AND x.id = ANY (_affected) AND x.manage_token_hash IS NOT NULL;
    GET DIAGNOSTICS _revoked = ROW_COUNT;
    IF g.email_normalized IS NOT NULL THEN
      UPDATE hospitality.notifications n
         SET status = 'dead', last_error = 'customer email corrected', locked_until = NULL,
             payload = CASE WHEN jsonb_typeof(n.payload -> 'rooms') = 'array'
                            THEN (n.payload - 'manage_token') || jsonb_build_object('rooms', (
                                   SELECT COALESCE(jsonb_agg(r.value - 'manage_token' ORDER BY r.ord), '[]'::jsonb)
                                     FROM jsonb_array_elements(n.payload -> 'rooms') WITH ORDINALITY AS r(value, ord)))
                            ELSE n.payload - 'manage_token' END,
             updated_at = now()
       WHERE n.tenant_id = _t AND n.booking_id = ANY (_affected) AND n.recipient_kind = 'guest'
         AND n.recipient_email = g.email_normalized AND n.status IN ('queued', 'failed');
      GET DIAGNOSTICS _dropped = ROW_COUNT;
    END IF;
  END IF;

  -- החוזים של ההזמנה / האירוע: פתוח שנוצר מהכרטיס — פרטי החותם מתעדכנים והקישור מת (שולחים שוב);
  -- חתום — לא נוגעים (מציעים חוזה מתוקן)
  FOR c IN SELECT x.* FROM hospitality.client_contracts x
            WHERE x.tenant_id = _t
              AND ((_event_id IS NOT NULL AND x.event_id = _event_id)
                   OR (_event_id IS NULL AND x.booking_id = ANY (_booking_ids)))
              AND x.status IN ('draft', 'sent', 'viewed', 'signed')
            ORDER BY x.number FOR UPDATE
  LOOP
    IF c.status = 'signed' THEN
      _signed := _signed || jsonb_build_array(jsonb_build_object('id', c.id, 'number', c.number));
    ELSIF c.guest_id = g.id THEN
      UPDATE hospitality.client_contracts x
         SET guest_id = _target, signer_name = _name, signer_phone = _phone,
             signer_email = COALESCE(_email, x.signer_email),
             data = x.data || jsonb_build_object('signer_name', _name, 'signer_phone', _phone,
                                                 'signer_email', COALESCE(_email, x.signer_email)),
             token_hash = NULL, updated_at = now()
       WHERE x.id = c.id;
      PERFORM hospitality._contract_log(_t, c.id, 'signer_updated', 'staff', auth.uid(), NULL,
        jsonb_build_object('fields', to_jsonb(_fields), 'email_removed', _email IS NULL AND _email_changed));
      _open := _open || c.number;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'guest_id', _target, 'existing_guest', _existing, 'fields', to_jsonb(_fields), 'email_changed', _email_changed,
    'email', _email, 'links_revoked', _revoked, 'emails_dropped', _dropped,
    'open_contracts_updated', to_jsonb(_open), 'signed_contracts', _signed,
    -- להיסטוריה: ממוסך בלבד (ההיסטוריה לא נמחקת במחיקת פרטי אורח)
    'history', jsonb_build_object(
      'fields', to_jsonb(_fields), 'scope', _scope, 'guest_changed', _target <> g.id,
      'email', CASE WHEN _email_changed THEN jsonb_build_object('from', hospitality.mask_email(g.email_normalized),
                                                                'to', hospitality.mask_email(_email)) END,
      'phone', CASE WHEN 'phone' = ANY (_fields) THEN jsonb_build_object('from', hospitality.mask_phone(g.phone),
                                                                        'to', hospitality.mask_phone(_phone)) END));
END $$;
REVOKE ALL ON FUNCTION hospitality._customer_apply(uuid, hospitality.guests, jsonb, text, uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. ההזמנה: תיקון פרטי הלקוח (ובקשה — מייל "פרטי ההזמנה" לכתובת המעודכנת)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.booking_customer_update(_booking_id uuid, _expected_revision integer,
                                                               _data jsonb, _scope text DEFAULT 'guest',
                                                               _notify boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests');
  _patch jsonb := hospitality._customer_patch(_data);
  b hospitality.bookings;
  g hospitality.guests;
  _ids uuid[];
  _r jsonb;
  _sent integer := 0;
  _lead uuid;
BEGIN
  PERFORM hospitality._staff_tenant('bookings');
  IF _scope IS NULL OR _scope NOT IN ('guest', 'booking') THEN
    RAISE EXCEPTION 'היקף השינוי לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id FOR UPDATE;
  IF g.id IS NULL OR g.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'פרטי הלקוח של ההזמנה נמחקו — אי אפשר לעדכן אותם' USING ERRCODE = 'check_violation';
  END IF;
  _ids := hospitality._contract_booking_ids(_t, b.id);
  -- קבוצת חדרים שחלק ממנה של כרטיס אחר — "רק להזמנה הזו" מעביר את כל הקבוצה (כרטיס אחד לבקשה)
  _r := hospitality._customer_apply(_t, g, _patch, _scope, _ids, NULL);
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  SELECT _t, x, 'customer_updated', 'staff', auth.uid(), _r -> 'history' FROM unnest(_ids) x;
  PERFORM hospitality._audit(_t, 'bookings.customer_updated', 'הזמנה #' || b.number,
    jsonb_build_object('fields', _r -> 'fields', 'scope', _scope));
  IF _notify THEN
    IF _r ->> 'email' IS NULL THEN
      RAISE EXCEPTION 'לשליחת פרטי ההזמנה צריך אימייל של הלקוח' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT hospitality._booking_active(b.status) THEN
      RAISE EXCEPTION 'אפשר לשלוח פרטים רק להזמנה פעילה' USING ERRCODE = 'check_violation';
    END IF;
    _sent := hospitality._send_booking_details(_t, b.id);
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
    VALUES (_t, b.id, 'details_sent', 'staff', auth.uid(),
            jsonb_build_object('email', hospitality.mask_email(_r ->> 'email'), 'queued', _sent > 0));
    PERFORM hospitality._audit(_t, 'bookings.details_sent', 'הזמנה #' || b.number,
      jsonb_build_object('email', hospitality.mask_email(_r ->> 'email')));
  END IF;
  -- הזמנות אחרות של אותו כרטיס שהקישור שלהן בוטל (שינוי בכרטיס) — מייל עם קישור חדש גם להן
  IF _notify AND _scope = 'guest' AND (_r ->> 'email_changed')::boolean THEN
    FOR _lead IN SELECT DISTINCT ON (COALESCE(x.group_id, x.id)) x.id FROM hospitality.bookings x
                  WHERE x.tenant_id = _t AND x.guest_id = g.id AND NOT (x.id = ANY (_ids))
                    AND hospitality._booking_active(x.status)
                  ORDER BY COALESCE(x.group_id, x.id), x.number
    LOOP
      _sent := _sent + hospitality._send_booking_details(_t, _lead);
    END LOOP;
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = b.id;
  RETURN (_r - 'history' - 'email') || jsonb_build_object(
    'booking_id', b.id, 'revision', b.revision, 'scope', _scope, 'details_queued', _sent,
    'email_masked', hospitality.mask_email(_r ->> 'email'));
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_customer_update(uuid, integer, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_customer_update(uuid, integer, jsonb, text, boolean) TO authenticated, service_role;

-- שליחה חוזרת של "פרטי ההזמנה" (קישור אישי חדש; הקודם מתבטל) — לכתובת שבכרטיס
CREATE OR REPLACE FUNCTION hospitality.booking_resend_details(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  b hospitality.bookings;
  g hospitality.guests;
  _sent integer;
BEGIN
  b := hospitality._staff_booking(_t, _booking_id, NULL);
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id;
  IF g.id IS NULL OR g.anonymized_at IS NOT NULL OR g.email_normalized IS NULL THEN
    RAISE EXCEPTION 'ללקוח אין אימייל — הוסיפו אימייל בפרטי הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT hospitality._booking_active(b.status) THEN
    RAISE EXCEPTION 'אפשר לשלוח פרטים רק להזמנה פעילה' USING ERRCODE = 'check_violation';
  END IF;
  _sent := hospitality._send_booking_details(_t, b.id);
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'details_sent', 'staff', auth.uid(),
          jsonb_build_object('email', hospitality.mask_email(g.email_normalized), 'queued', _sent > 0));
  PERFORM hospitality._audit(_t, 'bookings.details_sent', 'הזמנה #' || b.number,
    jsonb_build_object('email', hospitality.mask_email(g.email_normalized)));
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = b.id;
  RETURN jsonb_build_object('booking_id', b.id, 'revision', b.revision, 'queued', _sent > 0,
                            'email_masked', hospitality.mask_email(g.email_normalized));
END $$;
REVOKE ALL ON FUNCTION hospitality.booking_resend_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.booking_resend_details(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. האירוע: אותו תיקון (בלי קישור אישי ובלי מייל)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.event_customer_update(_event_id uuid, _expected_revision integer,
                                                             _data jsonb, _scope text DEFAULT 'guest')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests');
  _patch jsonb := hospitality._customer_patch(_data);
  e hospitality.events;
  g hospitality.guests;
  _r jsonb;
BEGIN
  PERFORM hospitality._staff_tenant('bookings');
  IF _scope IS NULL OR _scope NOT IN ('guest', 'booking') THEN
    RAISE EXCEPTION 'היקף השינוי לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  e := hospitality._staff_event(_t, _event_id, _expected_revision);
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = e.guest_id FOR UPDATE;
  IF g.id IS NULL OR g.anonymized_at IS NOT NULL THEN
    RAISE EXCEPTION 'פרטי הלקוח של האירוע נמחקו — אי אפשר לעדכן אותם' USING ERRCODE = 'check_violation';
  END IF;
  _r := hospitality._customer_apply(_t, g, _patch, _scope, ARRAY[]::uuid[], e.id);
  PERFORM hospitality._event_log(_t, e.id, 'customer_updated', NULL, NULL, _r -> 'history', NULL);
  PERFORM hospitality._audit(_t, 'events.customer_updated', 'אירוע #' || e.number,
    jsonb_build_object('fields', _r -> 'fields', 'scope', _scope));
  SELECT * INTO e FROM hospitality.events x WHERE x.id = e.id;
  RETURN (_r - 'history' - 'email') || jsonb_build_object(
    'event_id', e.id, 'revision', e.revision, 'scope', _scope,
    'email_masked', hospitality.mask_email(_r ->> 'email'));
END $$;
REVOKE ALL ON FUNCTION hospitality.event_customer_update(uuid, integer, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.event_customer_update(uuid, integer, jsonb, text) TO authenticated, service_role;

COMMIT;

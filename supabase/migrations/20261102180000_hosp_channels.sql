-- ============================================================
-- Hospitality — סנכרון ערוצים (iCal) עם Airbnb / Booking.com (Stage 12, תשתית; אושר 02/11)
--
-- ייצוא:
--   • channel_feeds — קישור סודי אחד לכל יחידה (טוקן אקראי, אפשר להחליף); הקובץ (.ics) מכיל רק
--     לילות תפוסים / חסומים (כולל בקשות שממתינות לאישור) — בלי שמות, טלפונים או אימיילים;
--   • channel_feed(tenant, token) — לשרת בלבד (השער מגיש /ical/<token>).
-- ייבוא:
--   • channel_calendars — לכל יחידה קישורי יומן חיצוניים (https), סטטוס, שגיאות, התנגשויות;
--   • אירוע חיצוני → חסימה (blocks.channel_calendar_id + external_uid), שמוחזקת באותו EXCLUDE
--     כמו כל הזמנה. אירוע שחופף הזמנה / חסימה קיימת — לא נכתב; נרשם ברשימת ההתנגשויות.
--     אירוע שהשתנה / נעלם — משנה / משחרר רק את החסימה שלו (עם היסטוריה). הזמנות של נוריאל
--     לא משתנות אוטומטית אף פעם;
--   • channel_sync_apply (צוות, "סנכרן עכשיו") / channel_sync_service + channel_calendars_due
--     (לשרת בלבד — הסנכרון התקופתי). ההורדה עצמה — בשרת האפליקציה, עם הגנת SSRF של הפלטפורמה.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hospitality.channel_feeds (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL,
  token      text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  PRIMARY KEY (tenant_id, unit_id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.channel_feeds IS
  'Hospitality: קישור ה-iCal הסודי של כל יחידה (ייצוא לילות תפוסים בלבד) — רק דרך פונקציות';

CREATE TABLE IF NOT EXISTS hospitality.channel_calendars (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id      uuid NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('airbnb', 'booking', 'vrbo', 'google', 'other')),
  url          text NOT NULL CHECK (url ~ '^https://[^[:space:]]{4,}$' AND char_length(url) <= 1000),
  enabled      boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  last_status  text NOT NULL DEFAULT 'never' CHECK (last_status IN ('never', 'ok', 'error')),
  last_error   text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  events       integer NOT NULL DEFAULT 0,
  -- אירועים שלא נכתבו (חופפים הזמנה / חסימה): [{uid, from, to}] — בלי פרטים אישיים
  conflicts    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array'),
  failures     integer NOT NULL DEFAULT 0,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  -- הוסר ע"י הצוות: לא נמחק (החסימות ששוחררו נשארות מקושרות בהיסטוריה), לא מסונכרן ולא מוצג
  removed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (removed_at IS NULL OR NOT enabled),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_calendars_url_key ON hospitality.channel_calendars (tenant_id, unit_id, url)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS channel_calendars_due_idx ON hospitality.channel_calendars (next_sync_at) WHERE enabled;
COMMENT ON TABLE hospitality.channel_calendars IS
  'Hospitality: יומנים חיצוניים לייבוא (Airbnb / Booking.com / אחר) — רק דרך פונקציות';

DO $$
DECLARE _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['channel_feeds', 'channel_calendars'] LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated, service_role', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                     USING (tenant_id = (SELECT public.current_tenant_id()))
                     WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))$p$, _tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _tbl);
    EXECUTE format($p$CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                     USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
                     WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')))$p$, _tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _tbl);
    EXECUTE format($g$CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                     FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()$g$, _tbl);
  END LOOP;
END $$;

-- חסימה שמקורה ביומן חיצוני
ALTER TABLE hospitality.blocks ADD COLUMN IF NOT EXISTS channel_calendar_id uuid;
ALTER TABLE hospitality.blocks ADD COLUMN IF NOT EXISTS external_uid text;
ALTER TABLE hospitality.blocks DROP CONSTRAINT IF EXISTS blocks_external_uid_len;
ALTER TABLE hospitality.blocks ADD CONSTRAINT blocks_external_uid_len
  CHECK (external_uid IS NULL OR char_length(external_uid) BETWEEN 1 AND 300);
ALTER TABLE hospitality.blocks DROP CONSTRAINT IF EXISTS blocks_channel_fk;
-- בלי פעולה במחיקה: יומן לא נמחק (removed_at) — חסימה ששוחררה לא משתנה, וההיסטוריה נשמרת
ALTER TABLE hospitality.blocks ADD CONSTRAINT blocks_channel_fk
  FOREIGN KEY (tenant_id, channel_calendar_id) REFERENCES hospitality.channel_calendars (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_channel_uid ON hospitality.blocks (tenant_id, channel_calendar_id, external_uid)
  WHERE released_at IS NULL AND channel_calendar_id IS NOT NULL;

-- ------------------------------------------------------------
-- ייצוא
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._new_feed_token()
RETURNS text LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 40);
$$;
REVOKE ALL ON FUNCTION hospitality._new_feed_token() FROM PUBLIC, anon, authenticated;

-- הקובץ של יחידה לפי הטוקן (השרת בודק שהבקשה הגיעה לכתובת של אותו עסק)
CREATE OR REPLACE FUNCTION hospitality.channel_feed(_tenant_id uuid, _token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f hospitality.channel_feeds;
  u hospitality.units;
  _today date;
BEGIN
  IF _token IS NULL OR _token !~ '^[0-9a-f]{40}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO f FROM hospitality.channel_feeds x WHERE x.token = _token AND x.tenant_id = _tenant_id;
  IF f.unit_id IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _tenant_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _tenant_id AND x.id = f.unit_id;
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _tenant_id;
  _today := COALESCE(_today, current_date);
  RETURN jsonb_build_object(
    'unit_id', u.id, 'unit_name', u.name,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('uid', e.uid, 'from', lower(e.nights), 'to', upper(e.nights), 'kind', e.kind)
                       ORDER BY lower(e.nights))
        FROM (SELECT DISTINCT ON (o.nights, COALESCE(o.booking_id, o.block_id))
                     COALESCE(o.booking_id, o.block_id)::text AS uid, o.nights,
                     CASE WHEN o.booking_id IS NOT NULL THEN 'booking' ELSE 'block' END AS kind
                FROM hospitality.unit_occupancy o
                LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
               WHERE o.tenant_id = _tenant_id AND o.unit_id = f.unit_id
                 AND upper(o.nights) >= _today - 30 AND lower(o.nights) <= _today + 730
                 AND (o.booking_id IS NULL
                      OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()))) e),
      '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_feed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.channel_feed(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- לצוות (הרשאת bookings)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.channels_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'unit_id', u.id, 'name', u.name, 'kind', u.kind, 'is_active', u.is_active,
             'feed_token', f.token, 'feed_created_at', hospitality._ts(f.created_at),
             'calendars', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'id', c.id, 'channel', c.channel, 'url', c.url, 'enabled', c.enabled,
                             'last_sync_at', hospitality._ts(c.last_sync_at), 'last_status', c.last_status,
                             'last_error', c.last_error, 'events', c.events, 'conflicts', c.conflicts,
                             'next_sync_at', hospitality._ts(c.next_sync_at)) ORDER BY c.created_at)
                             FROM hospitality.channel_calendars c
                            WHERE c.tenant_id = _t AND c.unit_id = u.id AND c.removed_at IS NULL), '[]'::jsonb))
           ORDER BY p.sort_order, (u.kind = 'whole_property'), u.sort_order, u.created_at)
      FROM hospitality.units u
      JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
      LEFT JOIN hospitality.channel_feeds f ON f.tenant_id = u.tenant_id AND f.unit_id = u.id
     WHERE u.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.channels_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.channels_view() TO authenticated, service_role;

-- הקישור לייצוא: נוצר בפעם הראשונה; _rotate — טוקן חדש (הקודם מפסיק לעבוד מיד)
CREATE OR REPLACE FUNCTION hospitality.channel_feed_token(_unit_id uuid, _rotate boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  u hospitality.units;
  f hospitality.channel_feeds;
BEGIN
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO f FROM hospitality.channel_feeds x WHERE x.tenant_id = _t AND x.unit_id = u.id FOR UPDATE;
  IF f.token IS NULL THEN
    INSERT INTO hospitality.channel_feeds (tenant_id, unit_id, token)
    VALUES (_t, u.id, hospitality._new_feed_token()) RETURNING * INTO f;
  ELSIF _rotate THEN
    UPDATE hospitality.channel_feeds x SET token = hospitality._new_feed_token(), rotated_at = now()
     WHERE x.tenant_id = _t AND x.unit_id = u.id RETURNING * INTO f;
    PERFORM hospitality._audit(_t, 'channels.feed_rotated', u.name, '{}'::jsonb);
  END IF;
  RETURN f.token;
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_feed_token(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.channel_feed_token(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.channel_calendar_add(_unit_id uuid, _channel text, _url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  u hospitality.units;
  c hospitality.channel_calendars;
  _u text := btrim(COALESCE(_url, ''));
BEGIN
  IF _channel IS NULL OR _channel NOT IN ('airbnb', 'booking', 'vrbo', 'google', 'other') THEN
    RAISE EXCEPTION 'הערוץ לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _u !~ '^https://[^[:space:]]{4,}$' OR char_length(_u) > 1000 THEN
    RAISE EXCEPTION 'הקישור ליומן חייב להתחיל ב-https://' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT count(*) FROM hospitality.channel_calendars x
       WHERE x.tenant_id = _t AND x.unit_id = u.id AND x.removed_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'עד 5 יומנים חיצוניים ליחידה' USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    INSERT INTO hospitality.channel_calendars (tenant_id, unit_id, channel, url)
    VALUES (_t, u.id, _channel, _u) RETURNING * INTO c;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הקישור הזה כבר מחובר ליחידה' USING ERRCODE = 'unique_violation';
  END;
  PERFORM hospitality._audit(_t, 'channels.calendar_added', u.name, jsonb_build_object('channel', _channel));
  RETURN jsonb_build_object('id', c.id);
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_calendar_add(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.channel_calendar_add(uuid, text, text) TO authenticated, service_role;

-- הסרה: החסימות של היומן משתחררות, והיומן מסומן כהוסר (לא נמחק — ההיסטוריה נשמרת)
CREATE OR REPLACE FUNCTION hospitality.channel_calendar_remove(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  c hospitality.channel_calendars;
  _n integer;
BEGIN
  SELECT * INTO c FROM hospitality.channel_calendars x
   WHERE x.tenant_id = _t AND x.id = _id AND x.removed_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'היומן לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE hospitality.blocks k SET released_at = now(), updated_at = now()
   WHERE k.tenant_id = _t AND k.channel_calendar_id = c.id AND k.released_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE hospitality.channel_calendars x SET enabled = false, removed_at = now(), updated_at = now()
   WHERE x.id = c.id;
  PERFORM hospitality._audit(_t, 'channels.calendar_removed',
                             (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = c.unit_id),
                             jsonb_build_object('channel', c.channel, 'released', _n));
  RETURN jsonb_build_object('released', _n);
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_calendar_remove(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.channel_calendar_remove(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- החלת אירועים מיומן חיצוני
-- _events: [{uid, from, to}] (to = יום העזיבה, לא כולל); _error — ההורדה / הקריאה נכשלה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._channel_apply(_t uuid, _calendar_id uuid, _events jsonb, _error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c hospitality.channel_calendars;
  k hospitality.blocks;
  _today date;
  _e jsonb;
  _uid text;
  _from date;
  _to date;
  _label text;
  _seen text[] := '{}';
  _conflicts jsonb := '[]'::jsonb;
  _written integer := 0;
BEGIN
  SELECT * INTO c FROM hospitality.channel_calendars x
   WHERE x.tenant_id = _t AND x.id = _calendar_id AND x.removed_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'היומן לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _error IS NOT NULL THEN
    UPDATE hospitality.channel_calendars x
       SET last_status = 'error', last_error = left(_error, 300), last_sync_at = now(), failures = x.failures + 1,
           -- המתנה שגדלה אחרי שגיאות: 30 דקות, שעה, שעתיים… עד 6 שעות
           next_sync_at = now() + least(interval '6 hours', interval '30 minutes' * power(2, least(x.failures, 4))),
           updated_at = now()
     WHERE x.id = c.id;
    RETURN jsonb_build_object('status', 'error');
  END IF;
  IF _events IS NULL OR jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) > 2000 THEN
    RAISE EXCEPTION 'רשימת האירועים לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  _label := 'סנכרון: ' || CASE c.channel WHEN 'airbnb' THEN 'Airbnb' WHEN 'booking' THEN 'Booking.com'
                                          WHEN 'vrbo' THEN 'Vrbo' WHEN 'google' THEN 'Google' ELSE 'יומן חיצוני' END;
  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._set_actor('system', NULL);

  FOR _e IN SELECT * FROM jsonb_array_elements(_events) LOOP
    _uid := left(btrim(COALESCE(_e ->> 'uid', '')), 300);
    BEGIN
      _from := (_e ->> 'from')::date;
      _to := (_e ->> 'to')::date;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF _uid = '' OR _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > 366 THEN CONTINUE; END IF;
    -- עבר / רחוק מדי — לא משפיע על הזמינות
    IF _to <= _today OR _from > _today + 730 THEN CONTINUE; END IF;
    _from := greatest(_from, _today);
    _seen := array_append(_seen, _uid);
    SELECT * INTO k FROM hospitality.blocks x
     WHERE x.tenant_id = _t AND x.channel_calendar_id = c.id AND x.external_uid = _uid AND x.released_at IS NULL;
    IF k.id IS NOT NULL AND k.start_date = _from AND k.end_date = _to THEN
      _written := _written + 1;
      CONTINUE;
    END IF;
    BEGIN
      IF k.id IS NOT NULL THEN
        UPDATE hospitality.blocks x SET start_date = _from, end_date = _to, updated_at = now() WHERE x.id = k.id;
      ELSE
        INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason, channel_calendar_id, external_uid, created_by)
        VALUES (_t, c.unit_id, _from, _to, _label, c.id, _uid, NULL);
      END IF;
      _written := _written + 1;
    EXCEPTION WHEN exclusion_violation THEN
      -- חופף הזמנה / חסימה אצלנו: לא נכתב (החסימה הקודמת שלו, אם הייתה, נשארת כמו שהייתה)
      _conflicts := _conflicts || jsonb_build_array(jsonb_build_object('uid', _uid, 'from', _from, 'to', _to));
    END;
  END LOOP;

  -- אירוע שנעלם מהיומן (ועדיין רלוונטי) — החסימה שלו משתחררת
  UPDATE hospitality.blocks x SET released_at = now(), updated_at = now()
   WHERE x.tenant_id = _t AND x.channel_calendar_id = c.id AND x.released_at IS NULL
     AND x.end_date > _today AND NOT (x.external_uid = ANY (_seen));

  PERFORM hospitality._set_actor('', NULL);
  UPDATE hospitality.channel_calendars x
     SET last_status = 'ok', last_error = NULL, last_sync_at = now(), failures = 0, events = _written,
         conflicts = _conflicts, next_sync_at = now() + interval '30 minutes', updated_at = now()
   WHERE x.id = c.id;
  RETURN jsonb_build_object('status', 'ok', 'events', _written, 'conflicts', _conflicts);
END $$;
REVOKE ALL ON FUNCTION hospitality._channel_apply(uuid, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

-- "סנכרן עכשיו" (צוות): השרת הוריד וקרא את היומן — כאן רק ההחלה
CREATE OR REPLACE FUNCTION hospitality.channel_sync_apply(_calendar_id uuid, _events jsonb, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality._channel_apply(hospitality._manage_tenant('bookings'), _calendar_id, _events, _error);
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_sync_apply(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.channel_sync_apply(uuid, jsonb, text) TO authenticated, service_role;

-- הסנכרון התקופתי (שרת בלבד): העסק לפי היומן
CREATE OR REPLACE FUNCTION hospitality.channel_sync_service(_calendar_id uuid, _events jsonb, _error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := (SELECT x.tenant_id FROM hospitality.channel_calendars x WHERE x.id = _calendar_id);
BEGIN
  IF _t IS NULL THEN
    RAISE EXCEPTION 'היומן לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._channel_apply(_t, _calendar_id, _events, _error);
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_sync_service(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.channel_sync_service(uuid, jsonb, text) TO service_role;

-- היומנים שהגיע זמנם (שרת בלבד): רק בעסקים שהמסד ואזור הניהול שלהם פעילים; "חכירה" של 10 דקות
-- כדי ששני תהליכים לא יורידו את אותו יומן
CREATE OR REPLACE FUNCTION hospitality.channel_calendars_due(_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _rows jsonb;
BEGIN
  WITH due AS (
    SELECT c.id FROM hospitality.channel_calendars c
     WHERE c.enabled AND c.removed_at IS NULL AND c.next_sync_at <= now()
       AND hospitality.flag_for('hospitality_backend_enabled', c.tenant_id)
       AND hospitality.flag_for('hospitality_management_enabled', c.tenant_id)
     ORDER BY c.next_sync_at
     LIMIT greatest(1, least(COALESCE(_limit, 10), 50))
     FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE hospitality.channel_calendars x SET next_sync_at = now() + interval '10 minutes'
      FROM due WHERE x.id = due.id
    RETURNING x.id, x.tenant_id, x.url
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'tenant_id', l.tenant_id, 'url', l.url)), '[]'::jsonb)
    INTO _rows FROM leased l;
  RETURN _rows;
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_calendars_due(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.channel_calendars_due(integer) TO service_role;

COMMIT;

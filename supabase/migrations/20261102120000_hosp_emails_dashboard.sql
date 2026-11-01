-- ============================================================
-- Hospitality Stage 2k — מיילים (מצב ושליחה חוזרת) ולוח בקרה
--
-- התור (hospitality.notifications), claim / mark ו-expire_holds קיימים מ-Stage 1; ה-worker
-- שבאפליקציה שולח (outbox/worker.server.ts). כאן:
--   • staff_emails(filter, limit) — המיילים של העסק: ממתינים / נכשלו / נשלחו, נמען ממוסך;
--   • requeue_notification(id) — "לשלוח שוב" מייל שנכשל (failed / dead → queued);
--   • dashboard() — המספרים של לוח הבקרה: הגעות ועזיבות היום, שוהים, תפוסה הלילה /
--     7 / 30 ימים, יחידות פנויות הלילה, הכנסות החודש, בקשות ממתינות, בקשות ביטול,
--     מיילים שנכשלו, הזמנות אחרונות.
-- הרשאה: bookings (בעלים ומנהלים), אזור הניהול פעיל. בלי טבלה או עמודה חדשה.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION hospitality.staff_emails(_filter text DEFAULT 'all', _limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  IF _filter NOT IN ('all', 'failed', 'waiting', 'sent') THEN
    RAISE EXCEPTION 'סינון לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'עמוד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
                 'failed', count(*) FILTER (WHERE n.status IN ('failed', 'dead')),
                 'waiting', count(*) FILTER (WHERE n.status IN ('queued', 'sending')),
                 'sent', count(*) FILTER (WHERE n.status = 'sent'))
                 FROM hospitality.notifications n WHERE n.tenant_id = _t),
    'items', COALESCE((
      SELECT jsonb_agg(row ORDER BY created DESC) FROM (
        SELECT n.created_at AS created, jsonb_build_object(
                 'id', n.id, 'event', n.event, 'recipient_kind', n.recipient_kind,
                 'recipient', hospitality.mask_email(n.recipient_email), 'status', n.status,
                 'attempts', n.attempts, 'has_error', n.last_error IS NOT NULL,
                 'next_attempt_at', hospitality._ts(n.next_attempt_at),
                 'created_at', hospitality._ts(n.created_at), 'sent_at', hospitality._ts(n.sent_at),
                 'booking_id', n.booking_id, 'booking_number', b.number) AS row
          FROM hospitality.notifications n
          LEFT JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
         WHERE n.tenant_id = _t
           AND (_filter = 'all'
                OR (_filter = 'failed' AND n.status IN ('failed', 'dead'))
                OR (_filter = 'waiting' AND n.status IN ('queued', 'sending'))
                OR (_filter = 'sent' AND n.status = 'sent'))
         ORDER BY n.created_at DESC
         LIMIT _limit) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_emails(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_emails(text, integer) TO authenticated, service_role;

-- שליחה חוזרת של מייל שנכשל — חוזר לתור מיד (ה-worker ישלח בסבב הבא)
CREATE OR REPLACE FUNCTION hospitality.requeue_notification(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  n hospitality.notifications;
BEGIN
  UPDATE hospitality.notifications x
     SET status = 'queued', attempts = 0, next_attempt_at = now(), locked_until = NULL,
         last_error = NULL, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id AND x.status IN ('failed', 'dead')
  RETURNING * INTO n;
  IF n.id IS NULL THEN
    RAISE EXCEPTION 'אפשר לשלוח שוב רק מייל שנכשל' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._audit(_t, 'emails.requeued', n.event, jsonb_build_object('recipient', hospitality.mask_email(n.recipient_email)));
  RETURN jsonb_build_object('id', n.id, 'status', n.status);
END $$;
REVOKE ALL ON FUNCTION hospitality.requeue_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.requeue_notification(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- לוח הבקרה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _units integer;
  _month_start date;
BEGIN
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  _month_start := date_trunc('month', _today)::date;
  -- יחידות פיזיות פעילות ("כל המתחם" נספר דרך יחידותיו)
  SELECT count(*) INTO _units FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property';
  RETURN jsonb_build_object(
    'today', _today,
    'units', _units,
    'arrivals_today', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                         AND b.check_in = _today AND b.status IN ('confirmed', 'cancel_requested')),
    'departures_today', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                           AND b.check_out = _today AND b.status = 'checked_in'),
    'staying', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'checked_in'),
    'pending', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                  AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()),
    'cancel_requests', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'cancel_requested'),
    'failed_emails', (SELECT count(*) FROM hospitality.notifications n WHERE n.tenant_id = _t AND n.status IN ('failed', 'dead')),
    -- תפוסה: לילות תפוסים ביחידות פיזיות (הזמנות שמחזיקות מלאי) מתוך יחידות × לילות
    'occupied_tonight', (SELECT count(DISTINCT o.unit_id) FROM hospitality.unit_occupancy o
                           JOIN hospitality.units u ON u.tenant_id = o.tenant_id AND u.id = o.unit_id
                          WHERE o.tenant_id = _t AND o.booking_id IS NOT NULL AND u.kind <> 'whole_property'
                            AND o.nights @> _today),
    'blocked_tonight', (SELECT count(DISTINCT o.unit_id) FROM hospitality.unit_occupancy o
                          JOIN hospitality.units u ON u.tenant_id = o.tenant_id AND u.id = o.unit_id
                         WHERE o.tenant_id = _t AND o.block_id IS NOT NULL AND o.booking_id IS NULL
                           AND u.kind <> 'whole_property' AND o.nights @> _today),
    'occupancy_7', hospitality._occupancy(_t, _today, 7, _units),
    'occupancy_30', hospitality._occupancy(_t, _today, 30, _units),
    'revenue_month', (SELECT COALESCE(sum(n.price), 0) FROM hospitality.booking_nights n
                        JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
                       WHERE n.tenant_id = _t AND n.night >= _month_start AND n.night < (_month_start + interval '1 month')::date
                         AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')),
    'currency', COALESCE((SELECT s.currency FROM hospitality.settings s WHERE s.tenant_id = _t), 'ILS'),
    'recent', COALESCE((SELECT jsonb_agg(r ORDER BY (r ->> 'created_at') DESC) FROM (
                 SELECT jsonb_build_object('id', b.id, 'number', b.number, 'status', b.status,
                          'state', hospitality._booking_state(b), 'guest_name', g.full_name, 'unit_name', u.name,
                          'check_in', b.check_in, 'check_out', b.check_out, 'total', b.total,
                          'created_at', hospitality._ts(b.created_at)) AS r
                   FROM hospitality.bookings b
                   JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
                   JOIN hospitality.units u ON u.tenant_id = b.tenant_id AND u.id = b.unit_id
                  WHERE b.tenant_id = _t
                  ORDER BY b.created_at DESC LIMIT 5) z), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard() TO authenticated, service_role;

-- אחוז תפוסה ל-N לילות מהיום (לילות הזמנה ביחידות פיזיות / יחידות × N)
CREATE OR REPLACE FUNCTION hospitality._occupancy(_t uuid, _from date, _days integer, _units integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN COALESCE(_units, 0) = 0 THEN 0 ELSE round(100.0 * COALESCE((
    SELECT sum(upper(o.nights * daterange(_from, _from + _days)) - lower(o.nights * daterange(_from, _from + _days)))
      FROM hospitality.unit_occupancy o
      JOIN hospitality.units u ON u.tenant_id = o.tenant_id AND u.id = o.unit_id
     WHERE o.tenant_id = _t AND o.booking_id IS NOT NULL AND u.kind <> 'whole_property'
       AND o.nights && daterange(_from, _from + _days)), 0) / (_units * _days))::integer END;
$$;
REVOKE ALL ON FUNCTION hospitality._occupancy(uuid, date, integer, integer) FROM PUBLIC, anon, authenticated;

COMMIT;

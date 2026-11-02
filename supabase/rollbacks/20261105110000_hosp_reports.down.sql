-- ============================================================
-- Rollback של 20261105110000_hosp_reports.sql (שלב F7 — דוחות וייצוא)
-- אין נתונים חדשים (רק פונקציות). הפונקציות של לוח הבקרה חוזרות לגרסה של מיגרציה 32 — מילה במילה.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי מסך "דוחות".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.reports_view(date, date, uuid[], text[], text[]);

-- לוח הבקרה — הגרסה של מיגרציה 32
CREATE OR REPLACE FUNCTION hospitality._dashboard_nights(_t uuid, _from date, _to date)
RETURNS TABLE (unit_id uuid, night date, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH phys AS (
    SELECT u.id FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property'
  ),
  booked AS (
    -- לילות הזמנה (מתחם שלם — בכל אחת מהיחידות שבו); הזמנה שנרשמה מערוץ חיצוני — "ערוץ"
    SELECT COALESCE(m.member_unit_id, b.unit_id) AS u_id, n.night AS d, (b.source = 'external') AS channel
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
      LEFT JOIN hospitality.unit_members m ON m.tenant_id = b.tenant_id AND m.parent_unit_id = b.unit_id
     WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
  ),
  blk AS (
    -- חסימות פעילות: מסונכרנות מערוץ (Airbnb / Booking…) או פנימיות
    SELECT COALESCE(m.member_unit_id, k.unit_id) AS u_id, gs::date AS d, (k.channel_calendar_id IS NOT NULL) AS synced
      FROM hospitality.blocks k
      LEFT JOIN hospitality.unit_members m ON m.tenant_id = k.tenant_id AND m.parent_unit_id = k.unit_id
      CROSS JOIN LATERAL generate_series(GREATEST(k.start_date, _from)::timestamp,
                                         LEAST(k.end_date - 1, _to)::timestamp, interval '1 day') gs
     WHERE k.tenant_id = _t AND k.released_at IS NULL AND k.start_date <= _to AND k.end_date > _from
  ),
  occupied AS (
    SELECT x.u_id, x.d, CASE WHEN bool_or(x.channel) THEN 'channel' ELSE 'direct' END AS k
      FROM (SELECT b.u_id, b.d, b.channel FROM booked b
            UNION ALL
            SELECT k.u_id, k.d, true FROM blk k WHERE k.synced) x
     WHERE x.u_id IN (SELECT p.id FROM phys p)
     GROUP BY x.u_id, x.d
  )
  SELECT o.u_id, o.d, o.k FROM occupied o
  UNION ALL
  SELECT DISTINCT k.u_id, k.d, 'blocked' FROM blk k
   WHERE NOT k.synced AND k.u_id IN (SELECT p.id FROM phys p)
     AND NOT EXISTS (SELECT 1 FROM occupied o WHERE o.u_id = k.u_id AND o.d = k.d);
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_nights(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._dashboard_numbers(_t uuid, _tz text, _from date, _to date,
                                                         _units integer, _fin boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _len integer := _to - _from + 1;
  _start timestamptz := (_from::timestamp AT TIME ZONE _tz);
  _end timestamptz := ((_to + 1)::timestamp AT TIME ZONE _tz);
  _bookings integer;
  _cancels integer;
  _occ integer;
  _channel integer;
  _blocked integer;
  _avail integer;
  _nights integer;
  _rev numeric := 0;
  _paid numeric := 0;
BEGIN
  SELECT count(*) INTO _bookings FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.created_at >= _start AND b.created_at < _end
     AND b.status NOT IN ('declined', 'expired', 'cancelled')
     AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now());

  SELECT count(DISTINCT e.booking_id) INTO _cancels FROM hospitality.booking_events e
   WHERE e.tenant_id = _t AND e.to_status IN ('cancelled', 'no_show')
     AND e.created_at >= _start AND e.created_at < _end;

  SELECT count(*) FILTER (WHERE x.kind <> 'blocked'), count(*) FILTER (WHERE x.kind = 'channel'),
         count(*) FILTER (WHERE x.kind = 'blocked')
    INTO _occ, _channel, _blocked
    FROM hospitality._dashboard_nights(_t, _from, _to) x;
  _avail := GREATEST(COALESCE(_units, 0) * _len - _blocked, 0);

  SELECT count(*), COALESCE(sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END), 0)
    INTO _nights, _rev
    FROM hospitality.booking_nights n
    JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
   WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
     AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out');

  IF _fin THEN
    SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
      FROM hospitality.payments p
     WHERE p.tenant_id = _t AND p.status = 'recorded' AND p.paid_at BETWEEN _from AND _to;
  END IF;

  RETURN jsonb_build_object(
    'bookings', _bookings,
    'cancellations', _cancels,
    'nights_sold', _nights,
    'occupied_nights', _occ,
    'channel_nights', _channel,
    'blocked_nights', _blocked,
    'available_nights', _avail,
    'occupancy', CASE WHEN _avail > 0 THEN round(100.0 * _occ / _avail, 1) END,
    'revenue', CASE WHEN _fin THEN round(_rev, 2) END,
    'collected', CASE WHEN _fin THEN round(_paid, 2) END,
    'adr', CASE WHEN _fin AND _nights > 0 THEN round(_rev / _nights, 2) END);
END $$;
REVOKE ALL ON FUNCTION hospitality._dashboard_numbers(uuid, text, date, date, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._dashboard_series(_t uuid, _tz text, _from date, _to date, _bucket text,
                                                        _units integer, _fin boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH days AS (
    SELECT gs::date AS day FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') gs
  ),
  created AS (
    SELECT (b.created_at AT TIME ZONE _tz)::date AS day, count(*) AS n
      FROM hospitality.bookings b
     WHERE b.tenant_id = _t
       AND b.created_at >= (_from::timestamp AT TIME ZONE _tz) AND b.created_at < ((_to + 1)::timestamp AT TIME ZONE _tz)
       AND b.status NOT IN ('declined', 'expired', 'cancelled')
       AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())
     GROUP BY 1
  ),
  rev AS (
    SELECT n.night AS day, sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END) AS amount
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
     WHERE _fin AND n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
     GROUP BY 1
  ),
  nights AS (
    SELECT x.night AS day, count(*) FILTER (WHERE x.kind <> 'blocked') AS occ,
           count(*) FILTER (WHERE x.kind = 'blocked') AS blocked
      FROM hospitality._dashboard_nights(_t, _from, _to) x
     GROUP BY 1
  ),
  per_day AS (
    SELECT CASE _bucket WHEN 'day' THEN d.day
                        WHEN 'week' THEN d.day - extract(dow FROM d.day)::integer
                        ELSE date_trunc('month', d.day)::date END AS bucket,
           COALESCE(c.n, 0) AS bookings, COALESCE(r.amount, 0) AS revenue,
           COALESCE(o.occ, 0) AS occ, COALESCE(o.blocked, 0) AS blocked
      FROM days d
      LEFT JOIN created c ON c.day = d.day
      LEFT JOIN rev r ON r.day = d.day
      LEFT JOIN nights o ON o.day = d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'start', g.bucket, 'days', g.days, 'bookings', g.bookings,
           'revenue', CASE WHEN _fin THEN round(g.revenue, 2) END,
           'occupancy', CASE WHEN COALESCE(_units, 0) * g.days - g.blocked > 0
                             THEN round(100.0 * g.occ / (_units * g.days - g.blocked), 1) END)
           ORDER BY g.bucket), '[]'::jsonb)
    FROM (SELECT p.bucket, count(*)::integer AS days, sum(p.bookings)::integer AS bookings,
                 sum(p.revenue) AS revenue, sum(p.occ)::integer AS occ, sum(p.blocked)::integer AS blocked
            FROM per_day p GROUP BY p.bucket) g;
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_series(uuid, text, date, date, text, integer, boolean) FROM PUBLIC, anon, authenticated;


DROP FUNCTION IF EXISTS hospitality._report_series(uuid, text, date, date, text, integer, boolean, uuid[], text[], text[]);
DROP FUNCTION IF EXISTS hospitality._report_numbers(uuid, text, date, date, integer, boolean, uuid[], text[], text[]);
DROP FUNCTION IF EXISTS hospitality._report_match(hospitality.bookings, uuid[], text[], text[]);
DROP FUNCTION IF EXISTS hospitality._report_nights(uuid, date, date, uuid[], text[]);

NOTIFY pgrst, 'reload schema';

COMMIT;

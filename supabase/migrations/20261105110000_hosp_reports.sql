-- ============================================================
-- Hospitality — דוחות וייצוא (שלב F7, מיגרציה 34)
--
-- מקור אמת אחד עם לוח הבקרה (F3, מיגרציה 32): החישובים של הלילות, המספרים והגרף עוברים לגרסה
-- עם סינון (_report_nights / _report_numbers / _report_series), והפונקציות של לוח הבקרה
-- (_dashboard_*) קוראות להן בלי סינון — אותן חתימות, אותן תוצאות (בדיקות לוח הבקרה רצות עליהן).
--
-- reports_view(from, to, יחידות, מקורות, סטטוסים) — הרשאת reports (בעלים ומנהלים), אזור הניהול פעיל:
--   • סיכום (אותם מספרים כמו לוח הבקרה), הכנסות לפי חודש ולפי התקופה, מקורות, ביצועים לכל יחידה,
--     ביטולים, ההזמנות בתקופה;
--   • כספים — הכנסות, תשלומים שנגבו ויתרות לתשלום — רק עם הרשאת reports.finance (כמו לוח הבקרה);
--   • שמות אורחים מלאים רק עם הרשאת guests (אחרת שם פרטי ואות);
--   • בידוד: הכול לפי העסק של המשתמש; מזהי יחידות של עסק אחר — פשוט לא נמצאים.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105110000_hosp_reports.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הלילות — עם סינון יחידות ומקורות (NULL = הכול, בדיוק כמו בלוח הבקרה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._report_nights(_t uuid, _from date, _to date, _units uuid[], _sources text[])
RETURNS TABLE (unit_id uuid, night date, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH phys AS (
    -- יחידה שנבחרה, או יחידה בתוך "כל המתחם" שנבחר
    SELECT u.id FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property'
       AND (_units IS NULL OR u.id = ANY (_units)
            OR EXISTS (SELECT 1 FROM hospitality.unit_members m
                        WHERE m.tenant_id = _t AND m.member_unit_id = u.id AND m.parent_unit_id = ANY (_units)))
  ),
  booked AS (
    -- לילות הזמנה (מתחם שלם — בכל אחת מהיחידות שבו); הזמנה שנרשמה מערוץ חיצוני — "ערוץ"
    SELECT COALESCE(m.member_unit_id, b.unit_id) AS u_id, n.night AS d, (b.source = 'external') AS channel
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
      LEFT JOIN hospitality.unit_members m ON m.tenant_id = b.tenant_id AND m.parent_unit_id = b.unit_id
     WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
       AND (_sources IS NULL OR b.source = ANY (_sources))
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
            -- תאריכים מסונכרנים מערוץ = מקור "ערוץ חיצוני"
            SELECT k.u_id, k.d, true FROM blk k
             WHERE k.synced AND (_sources IS NULL OR 'external' = ANY (_sources))) x
     WHERE x.u_id IN (SELECT p.id FROM phys p)
     GROUP BY x.u_id, x.d
  )
  SELECT o.u_id, o.d, o.k FROM occupied o
  UNION ALL
  SELECT DISTINCT k.u_id, k.d, 'blocked' FROM blk k
   WHERE NOT k.synced AND k.u_id IN (SELECT p.id FROM phys p)
     AND NOT EXISTS (SELECT 1 FROM occupied o WHERE o.u_id = k.u_id AND o.d = k.d);
$$;
REVOKE ALL ON FUNCTION hospitality._report_nights(uuid, date, date, uuid[], text[]) FROM PUBLIC, anon, authenticated;

-- הזמנה עוברת את הסינון (יחידה — היחידה של ההזמנה; מקור; סטטוס)
CREATE OR REPLACE FUNCTION hospitality._report_match(b hospitality.bookings, _units uuid[], _sources text[], _statuses text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (_units IS NULL OR b.unit_id = ANY (_units))
     AND (_sources IS NULL OR b.source = ANY (_sources))
     AND (_statuses IS NULL OR b.status = ANY (_statuses));
$$;
REVOKE ALL ON FUNCTION hospitality._report_match(hospitality.bookings, uuid[], text[], text[]) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. המספרים של תקופה — עם סינון (NULL = הכול, כמו בלוח הבקרה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._report_numbers(_t uuid, _tz text, _from date, _to date,
                                                      _units integer, _fin boolean,
                                                      _unit_ids uuid[], _sources text[], _statuses text[])
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
     AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())
     AND hospitality._report_match(b, _unit_ids, _sources, _statuses);

  SELECT count(DISTINCT e.booking_id) INTO _cancels FROM hospitality.booking_events e
    JOIN hospitality.bookings b ON b.tenant_id = e.tenant_id AND b.id = e.booking_id
   WHERE e.tenant_id = _t AND e.to_status IN ('cancelled', 'no_show')
     AND e.created_at >= _start AND e.created_at < _end
     AND hospitality._report_match(b, _unit_ids, _sources, NULL);

  SELECT count(*) FILTER (WHERE x.kind <> 'blocked'), count(*) FILTER (WHERE x.kind = 'channel'),
         count(*) FILTER (WHERE x.kind = 'blocked')
    INTO _occ, _channel, _blocked
    FROM hospitality._report_nights(_t, _from, _to, _unit_ids, _sources) x;
  _avail := GREATEST(COALESCE(_units, 0) * _len - _blocked, 0);

  SELECT count(*), COALESCE(sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END), 0)
    INTO _nights, _rev
    FROM hospitality.booking_nights n
    JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
   WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
     AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
     AND hospitality._report_match(b, _unit_ids, _sources, _statuses);

  IF _fin THEN
    SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
      FROM hospitality.payments p
      JOIN hospitality.bookings b ON b.tenant_id = p.tenant_id AND b.id = p.booking_id
     WHERE p.tenant_id = _t AND p.status = 'recorded' AND p.paid_at BETWEEN _from AND _to
       AND hospitality._report_match(b, _unit_ids, _sources, _statuses);
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
REVOKE ALL ON FUNCTION hospitality._report_numbers(uuid, text, date, date, integer, boolean, uuid[], text[], text[]) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. הגרף / הכנסות לפי יום / שבוע / חודש — עם סינון
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._report_series(_t uuid, _tz text, _from date, _to date, _bucket text,
                                                     _units integer, _fin boolean,
                                                     _unit_ids uuid[], _sources text[], _statuses text[])
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
       AND hospitality._report_match(b, _unit_ids, _sources, _statuses)
     GROUP BY 1
  ),
  rev AS (
    SELECT n.night AS day, sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END) AS amount
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
     WHERE _fin AND n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
       AND hospitality._report_match(b, _unit_ids, _sources, _statuses)
     GROUP BY 1
  ),
  nights AS (
    SELECT x.night AS day, count(*) FILTER (WHERE x.kind <> 'blocked') AS occ,
           count(*) FILTER (WHERE x.kind = 'blocked') AS blocked
      FROM hospitality._report_nights(_t, _from, _to, _unit_ids, _sources) x
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
REVOKE ALL ON FUNCTION hospitality._report_series(uuid, text, date, date, text, integer, boolean, uuid[], text[], text[]) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. לוח הבקרה — אותן חתימות, דרך אותו חישוב (בלי סינון)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._dashboard_nights(_t uuid, _from date, _to date)
RETURNS TABLE (unit_id uuid, night date, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.unit_id, x.night, x.kind FROM hospitality._report_nights(_t, _from, _to, NULL, NULL) x;
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_nights(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._dashboard_numbers(_t uuid, _tz text, _from date, _to date,
                                                         _units integer, _fin boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._report_numbers(_t, _tz, _from, _to, _units, _fin, NULL, NULL, NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_numbers(uuid, text, date, date, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._dashboard_series(_t uuid, _tz text, _from date, _to date, _bucket text,
                                                        _units integer, _fin boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._report_series(_t, _tz, _from, _to, _bucket, _units, _fin, NULL, NULL, NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_series(uuid, text, date, date, text, integer, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. הדוחות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.reports_view(_from date, _to date, _unit_ids uuid[] DEFAULT NULL,
                                                    _sources text[] DEFAULT NULL, _statuses text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('reports');
  _fin boolean := hospitality.can('reports.finance');
  _guests boolean := hospitality.can('guests');
  _tz text;
  _cur text;
  _len integer;
  _bucket text;
  _units integer;
  _u uuid[] := NULLIF(_unit_ids, '{}'::uuid[]);
  _s text[] := NULLIF(_sources, '{}'::text[]);
  _st text[] := NULLIF(_statuses, '{}'::text[]);
  _limit constant integer := 1000;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _len := _to - _from + 1;
  IF _len > 366 THEN
    RAISE EXCEPTION 'אפשר להציג עד שנה אחת' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(COALESCE(_u, '{}')) > 200 OR cardinality(COALESCE(_s, '{}')) > 10
     OR cardinality(COALESCE(_st, '{}')) > 10 THEN
    RAISE EXCEPTION 'יותר מדי ערכים בסינון' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(_s, '{}')) x WHERE x NOT IN ('site', 'phone', 'walk_in', 'owner', 'external')) THEN
    RAISE EXCEPTION 'מקור לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(_st, '{}')) x
              WHERE x NOT IN ('pending_approval', 'pending_payment', 'confirmed', 'cancel_requested', 'checked_in',
                              'checked_out', 'cancelled', 'no_show')) THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.timezone, s.currency INTO _tz, _cur FROM hospitality.settings s WHERE s.tenant_id = _t;
  _tz := COALESCE(_tz, 'Asia/Jerusalem');
  _bucket := CASE WHEN _len <= 62 THEN 'day' WHEN _len <= 186 THEN 'week' ELSE 'month' END;
  -- היחידות שהזמינות נמדדת בהן (כמו בלוח הבקרה; עם סינון — היחידות שנבחרו / שבתוך "כל המתחם" שנבחר)
  SELECT count(*) INTO _units FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property'
     AND (_u IS NULL OR u.id = ANY (_u)
          OR EXISTS (SELECT 1 FROM hospitality.unit_members m
                      WHERE m.tenant_id = _t AND m.member_unit_id = u.id AND m.parent_unit_id = ANY (_u)));

  RETURN jsonb_build_object(
    'period', jsonb_build_object('from', _from, 'to', _to, 'days', _len, 'bucket', _bucket),
    'currency', COALESCE(_cur, 'ILS'),
    'finance', _fin,
    'guests', _guests,
    'units', _units,
    'summary', hospitality._report_numbers(_t, _tz, _from, _to, _units, _fin, _u, _s, _st),
    'series', hospitality._report_series(_t, _tz, _from, _to, _bucket, _units, _fin, _u, _s, _st),
    'months', hospitality._report_series(_t, _tz, _from, _to, 'month', _units, _fin, _u, _s, _st),

    -- מקורות: הזמנות שנוצרו בתקופה, ולילות + הכנסה של שהיות בתקופה
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('source', k.source, 'channel', k.channel, 'bookings', k.bookings,
                                          'nights', k.nights, 'revenue', CASE WHEN _fin THEN round(k.revenue, 2) END)
                       ORDER BY k.nights DESC, k.bookings DESC)
        FROM (SELECT x.source, x.channel, sum(x.bookings)::integer AS bookings, sum(x.nights)::integer AS nights,
                     sum(x.revenue) AS revenue
                FROM (SELECT b.source, CASE WHEN b.source = 'external' THEN lower(NULLIF(btrim(b.channel), '')) END AS channel,
                             1 AS bookings, 0 AS nights, 0::numeric AS revenue
                        FROM hospitality.bookings b
                       WHERE b.tenant_id = _t
                         AND b.created_at >= (_from::timestamp AT TIME ZONE _tz)
                         AND b.created_at < ((_to + 1)::timestamp AT TIME ZONE _tz)
                         AND b.status NOT IN ('declined', 'expired', 'cancelled')
                         AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())
                         AND hospitality._report_match(b, _u, _s, _st)
                      UNION ALL
                      SELECT b.source, CASE WHEN b.source = 'external' THEN lower(NULLIF(btrim(b.channel), '')) END,
                             0, 1, n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END
                        FROM hospitality.booking_nights n
                        JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
                       WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
                         AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
                         AND hospitality._report_match(b, _u, _s, _st)) x
               GROUP BY x.source, x.channel) k), '[]'::jsonb),

    -- ביצועים לכל יחידה: לילות שנמכרו, תפוסה (יחידה פיזית), הכנסה ומחיר ממוצע ללילה
    'by_unit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'unit_id', u.id, 'name', u.name, 'kind', u.kind, 'property', p.name, 'is_active', u.is_active,
               'bookings', COALESCE(r.bookings, 0), 'nights_sold', COALESCE(r.nights, 0),
               'occupied_nights', CASE WHEN u.kind <> 'whole_property' THEN COALESCE(o.occ, 0) END,
               'available_nights', CASE WHEN u.kind <> 'whole_property' AND u.is_active THEN GREATEST(_len - COALESCE(o.blocked, 0), 0) END,
               'occupancy', CASE WHEN u.kind <> 'whole_property' AND u.is_active AND _len - COALESCE(o.blocked, 0) > 0
                                 THEN round(100.0 * COALESCE(o.occ, 0) / (_len - COALESCE(o.blocked, 0)), 1) END,
               'revenue', CASE WHEN _fin THEN round(COALESCE(r.revenue, 0), 2) END,
               'adr', CASE WHEN _fin AND COALESCE(r.nights, 0) > 0 THEN round(r.revenue / r.nights, 2) END)
             ORDER BY p.sort_order, (u.kind = 'whole_property'), u.sort_order, u.name)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
        LEFT JOIN (SELECT x.unit_id, count(*) FILTER (WHERE x.kind <> 'blocked') AS occ,
                          count(*) FILTER (WHERE x.kind = 'blocked') AS blocked
                     FROM hospitality._report_nights(_t, _from, _to, _u, _s) x GROUP BY x.unit_id) o ON o.unit_id = u.id
        LEFT JOIN (SELECT b.unit_id, count(DISTINCT b.id) AS bookings, count(*) AS nights,
                          sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END) AS revenue
                     FROM hospitality.booking_nights n
                     JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
                    WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
                      AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
                      AND hospitality._report_match(b, _u, _s, _st)
                    GROUP BY b.unit_id) r ON r.unit_id = u.id
       WHERE u.tenant_id = _t AND p.status <> 'archived'
         AND (_u IS NULL OR u.id = ANY (_u))
         AND (u.is_active OR r.unit_id IS NOT NULL)), '[]'::jsonb),

    -- ביטולים בתקופה (כולל "לא הגיעו")
    'cancellations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'booking_id', b.id, 'number', b.number, 'unit', un.name, 'status', b.status, 'source', b.source,
               'check_in', b.check_in, 'check_out', b.check_out, 'cancelled_at', hospitality._ts(c.at),
               'total', CASE WHEN _fin THEN b.total END) ORDER BY c.at DESC)
        FROM (SELECT e.booking_id, max(e.created_at) AS at FROM hospitality.booking_events e
               WHERE e.tenant_id = _t AND e.to_status IN ('cancelled', 'no_show')
                 AND e.created_at >= (_from::timestamp AT TIME ZONE _tz)
                 AND e.created_at < ((_to + 1)::timestamp AT TIME ZONE _tz)
               GROUP BY e.booking_id) c
        JOIN hospitality.bookings b ON b.tenant_id = _t AND b.id = c.booking_id
        JOIN hospitality.units un ON un.tenant_id = _t AND un.id = b.unit_id
       WHERE hospitality._report_match(b, _u, _s, NULL)), '[]'::jsonb),

    -- תשלומים שנגבו בתקופה (החזר — במינוס) — רק עם הרשאת כספים
    'payments', CASE WHEN _fin THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'paid_at', p.paid_at, 'booking_id', b.id, 'number', b.number, 'unit', un.name,
               'kind', p.kind, 'method', p.method,
               'amount', CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END)
             ORDER BY p.paid_at DESC, p.created_at DESC)
        FROM hospitality.payments p
        JOIN hospitality.bookings b ON b.tenant_id = p.tenant_id AND b.id = p.booking_id
        JOIN hospitality.units un ON un.tenant_id = _t AND un.id = b.unit_id
       WHERE p.tenant_id = _t AND p.status = 'recorded' AND p.paid_at BETWEEN _from AND _to
         AND hospitality._report_match(b, _u, _s, _st)), '[]'::jsonb) END,

    -- יתרות לתשלום: הזמנות פעילות עם שהות בתקופה, שעוד לא שולמו במלואן — רק עם הרשאת כספים
    'balances', CASE WHEN _fin THEN COALESCE((
      SELECT jsonb_agg(row ORDER BY ci, num) FROM (
        SELECT b.check_in AS ci, b.number AS num, jsonb_build_object(
                 'booking_id', b.id, 'number', b.number, 'unit', un.name, 'status', b.status,
                 'guest', CASE WHEN _guests THEN g.full_name
                               ELSE hospitality._short_guest_name(g.full_name, g.anonymized_at IS NOT NULL) END,
                 'check_in', b.check_in, 'check_out', b.check_out, 'total', b.total,
                 'paid', round(COALESCE(pd.paid, 0), 2), 'balance', round(b.total - COALESCE(pd.paid, 0), 2)) AS row
          FROM hospitality.bookings b
          JOIN hospitality.units un ON un.tenant_id = _t AND un.id = b.unit_id
          LEFT JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          LEFT JOIN (SELECT p.booking_id, sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END) AS paid
                       FROM hospitality.payments p WHERE p.tenant_id = _t AND p.status = 'recorded'
                      GROUP BY p.booking_id) pd ON pd.booking_id = b.id
         WHERE b.tenant_id = _t AND b.check_in <= _to AND b.check_out > _from
           AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
           AND b.total - COALESCE(pd.paid, 0) > 0.004
           AND hospitality._report_match(b, _u, _s, _st)
         ORDER BY b.check_in, b.number
         LIMIT _limit) q), '[]'::jsonb) END,

    -- ההזמנות עם שהות בתקופה (לייצוא)
    'bookings', COALESCE((
      SELECT jsonb_agg(row ORDER BY ci, num) FROM (
        SELECT b.check_in AS ci, b.number AS num, jsonb_build_object(
                 'booking_id', b.id, 'number', b.number, 'status', b.status, 'source', b.source,
                 'channel', b.channel, 'unit', un.name,
                 'guest', CASE WHEN _guests THEN g.full_name
                               ELSE hospitality._short_guest_name(g.full_name, g.anonymized_at IS NOT NULL) END,
                 'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.check_out - b.check_in,
                 'adults', b.adults, 'children', b.children, 'created_at', hospitality._ts(b.created_at),
                 'total', CASE WHEN _fin THEN b.total END,
                 'paid', CASE WHEN _fin THEN round(COALESCE(pd.paid, 0), 2) END) AS row
          FROM hospitality.bookings b
          JOIN hospitality.units un ON un.tenant_id = _t AND un.id = b.unit_id
          LEFT JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
          LEFT JOIN (SELECT p.booking_id, sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END) AS paid
                       FROM hospitality.payments p WHERE p.tenant_id = _t AND p.status = 'recorded'
                      GROUP BY p.booking_id) pd ON pd.booking_id = b.id
         WHERE b.tenant_id = _t AND b.check_in <= _to AND b.check_out > _from
           AND b.status NOT IN ('declined', 'expired')
           AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())
           AND hospitality._report_match(b, _u, _s, _st)
         ORDER BY b.check_in, b.number
         LIMIT _limit) q), '[]'::jsonb),
    'limit', _limit);
END $$;
REVOKE ALL ON FUNCTION hospitality.reports_view(date, date, uuid[], text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.reports_view(date, date, uuid[], text[], text[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

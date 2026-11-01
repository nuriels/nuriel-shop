-- ============================================================
-- Hospitality Stage 2h — הזמנות: רשימה וכרטיס הזמנה לצוות (G8)
--
-- הפעולות עצמן כבר קיימות מ-Stage 1f (approve_booking, decline_booking, set_stay_status,
-- cancel_booking, modify_booking, approve / decline_cancellation, cancellation_quote,
-- staff_email_status) — עם revision, נעילה ויומן אירועים. כאן רק קריאה:
--   • staff_bookings(tab, q, limit, offset) — הרשימה לפי לשונית (ממתינות · קרובות · שוהים ·
--     עבר · בוטלו) עם ספירות, חיפוש לפי מספר / שם / טלפון / אימייל, פרטי קשר ממוסכים תמיד;
--   • staff_booking_detail(id) — כרטיס הזמנה: לילה-לילה, מדיניות שנשמרה, כללי המקום,
--     היסטוריה, מיילים; טלפון ואימייל מלאים רק למי שיש לו הרשאת guests.
-- "פג תוקף" מחושב גם לפני שתהליך הניקוי רץ (pending שעבר את hold_expires_at).
-- הרשאה: bookings (בעלים ומנהלים), אזור הניהול פעיל. בלי טבלה או עמודה חדשה.
-- ============================================================
BEGIN;

-- המצב "בפועל" של הזמנה: ממתינה שהחלון שלה עבר — כבר לא תופסת תאריכים
CREATE OR REPLACE FUNCTION hospitality._booking_state(b hospitality.bookings)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()
              THEN 'expired' ELSE b.status END;
$$;
REVOKE ALL ON FUNCTION hospitality._booking_state(hospitality.bookings) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._booking_tab(_state text, _check_out date, _today date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _state IN ('pending_approval', 'pending_payment', 'cancel_requested') THEN 'pending'
    WHEN _state = 'checked_in' THEN 'staying'
    WHEN _state = 'confirmed' AND _check_out >= _today THEN 'upcoming'
    WHEN _state IN ('cancelled', 'declined', 'expired') THEN 'cancelled'
    ELSE 'past' END;
$$;
REVOKE ALL ON FUNCTION hospitality._booking_tab(text, date, date) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1. הרשימה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.staff_bookings(_tab text DEFAULT 'pending', _q text DEFAULT NULL,
                                                      _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _query text := NULLIF(btrim(COALESCE(_q, '')), '');
  _digits text;
  _number integer;
BEGIN
  IF _tab NOT IN ('pending', 'upcoming', 'staying', 'past', 'cancelled', 'all') THEN
    RAISE EXCEPTION 'לשונית לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _limit NOT BETWEEN 1 AND 100 OR _offset < 0 OR _offset > 100000 THEN
    RAISE EXCEPTION 'עמוד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _query IS NOT NULL AND char_length(_query) > 100 THEN
    RAISE EXCEPTION 'החיפוש ארוך מדי' USING ERRCODE = 'check_violation';
  END IF;
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  _digits := regexp_replace(COALESCE(_query, ''), '[^0-9]', '', 'g');
  IF _query ~ '^#?[0-9]{1,9}$' THEN _number := _digits::integer; END IF;

  RETURN (
    WITH x AS (
      SELECT b.id, b.number,
             hospitality._booking_tab(hospitality._booking_state(b), b.check_out, _today) AS tab,
             CASE hospitality._booking_tab(hospitality._booking_state(b), b.check_out, _today)
               WHEN 'pending' THEN to_char(COALESCE(b.hold_expires_at, b.cancellation_requested_at, b.created_at),
                                           'YYYYMMDDHH24MISS')
               WHEN 'upcoming' THEN to_char(b.check_in, 'YYYYMMDD')
               WHEN 'staying' THEN to_char(b.check_out, 'YYYYMMDD')
               ELSE to_char(99999999 - to_char(b.check_out, 'YYYYMMDD')::integer, 'FM00000000') END AS sort_key
        FROM hospitality.bookings b
        JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
       WHERE b.tenant_id = _t
         AND (_query IS NULL
              OR b.number = _number
              OR g.full_name ILIKE '%' || _query || '%'
              OR (length(_digits) >= 4 AND g.phone_normalized LIKE '%' || _digits || '%')
              OR (position('@' IN _query) > 0 AND g.email_normalized ILIKE '%' || lower(_query) || '%'))
    )
    SELECT jsonb_build_object(
      'tab', _tab, 'q', _query, 'today', _today, 'limit', _limit, 'offset', _offset,
      'total', (SELECT count(*) FROM x WHERE _tab = 'all' OR x.tab = _tab),
      'counts', (SELECT jsonb_build_object(
                   'pending', count(*) FILTER (WHERE x.tab = 'pending'),
                   'upcoming', count(*) FILTER (WHERE x.tab = 'upcoming'),
                   'staying', count(*) FILTER (WHERE x.tab = 'staying'),
                   'past', count(*) FILTER (WHERE x.tab = 'past'),
                   'cancelled', count(*) FILTER (WHERE x.tab = 'cancelled'),
                   'all', count(*)) FROM x),
      'items', COALESCE((
        SELECT jsonb_agg(q.row ORDER BY q.sort_key, q.number) FROM (
          SELECT x.sort_key, x.number, jsonb_build_object(
                   'id', b.id, 'number', b.number, 'status', b.status,
                   'state', hospitality._booking_state(b), 'tab', x.tab,
                   'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights,
                   'adults', b.adults, 'children', b.children,
                   'total', b.total, 'currency', b.currency, 'payment_status', b.payment_status,
                   'amount_paid', b.amount_paid, 'source', b.source, 'channel', b.channel, 'revision', b.revision,
                   'created_at', hospitality._ts(b.created_at), 'hold_expires_at', hospitality._ts(b.hold_expires_at),
                   'cancellation_requested_at', hospitality._ts(b.cancellation_requested_at),
                   'unit_id', u.id, 'unit_name', u.name, 'property_name', p.name,
                   'guest_name', g.full_name,
                   'guest_phone', hospitality.mask_phone(g.phone),
                   'guest_email', hospitality.mask_email(g.email)) AS row
            FROM x
            JOIN hospitality.bookings b ON b.tenant_id = _t AND b.id = x.id
            JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
            JOIN hospitality.units u ON u.tenant_id = b.tenant_id AND u.id = b.unit_id
            JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
           WHERE _tab = 'all' OR x.tab = _tab
           ORDER BY x.sort_key, x.number
           LIMIT _limit OFFSET _offset) q), '[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_bookings(text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_bookings(text, text, integer, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. כרטיס הזמנה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.staff_booking_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  b hospitality.bookings;
  g hospitality.guests;
  u hospitality.units;
  _property text;
  _full boolean := hospitality.can('guests');
  _today date;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _id;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = b.unit_id;
  SELECT p.name INTO _property FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = u.property_id;
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;

  RETURN jsonb_build_object(
    'id', b.id, 'number', b.number, 'status', b.status, 'state', hospitality._booking_state(b),
    'tab', hospitality._booking_tab(hospitality._booking_state(b), b.check_out, COALESCE(_today, current_date)),
    'today', COALESCE(_today, current_date), 'revision', b.revision,
    'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights,
    'adults', b.adults, 'children', b.children,
    'unit', jsonb_build_object('id', u.id, 'name', u.name, 'kind', u.kind, 'property_name', _property),
    'currency', b.currency, 'subtotal', b.subtotal, 'discount', b.discount, 'total', b.total,
    'deposit_amount', b.deposit_amount, 'amount_paid', b.amount_paid, 'payment_status', b.payment_status,
    'price_manual', b.price_manual,
    'source', b.source, 'channel', b.channel,
    'created_at', hospitality._ts(b.created_at), 'updated_at', hospitality._ts(b.updated_at),
    'hold_expires_at', hospitality._ts(b.hold_expires_at),
    'special_requests', b.special_requests, 'notes', b.notes,
    'cancellation_requested_at', hospitality._ts(b.cancellation_requested_at),
    'cancellation_reason', b.cancellation_reason, 'cancellation_outcome', b.cancellation_outcome,
    'policy', b.policy_snapshot - 'schedule',
    'policy_schedule', b.policy_snapshot -> 'schedule',
    'house_rules', b.house_rules_snapshot,
    'guest', jsonb_build_object(
      'id', g.id, 'name', g.full_name, 'anonymized', g.anonymized_at IS NOT NULL,
      'contact_full', _full,
      'phone', CASE WHEN _full THEN g.phone ELSE hospitality.mask_phone(g.phone) END,
      'email', CASE WHEN _full THEN g.email ELSE hospitality.mask_email(g.email) END,
      'bookings_count', (SELECT count(*) FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.guest_id = g.id)),
    'nights_detail', COALESCE((SELECT jsonb_agg(jsonb_build_object('night', n.night, 'base_rate', n.base_rate,
                                                                   'extras', n.extras, 'price', n.price,
                                                                   'rule', n.rule_applied) ORDER BY n.night)
                                 FROM hospitality.booking_nights n WHERE n.tenant_id = _t AND n.booking_id = b.id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'kind', e.kind, 'from', e.from_status, 'to', e.to_status, 'actor_kind', e.actor_kind,
                          'actor', CASE WHEN e.actor_kind = 'staff' THEN
                                     COALESCE((SELECT CASE WHEN ur.is_protected THEN 'הבעלים'
                                                     ELSE COALESCE(ur.display_name, hospitality.mask_email(ur.email)) END
                                                 FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = e.actor_id),
                                              'צוות') END,
                          'note', e.note, 'changes', e.changes, 'at', hospitality._ts(e.created_at))
                          ORDER BY e.created_at, e.id)
                         FROM hospitality.booking_events e WHERE e.tenant_id = _t AND e.booking_id = b.id), '[]'::jsonb),
    'emails', hospitality.staff_email_status(b.id));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_booking_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_booking_detail(uuid) TO authenticated, service_role;

COMMIT;

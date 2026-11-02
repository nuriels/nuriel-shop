-- ============================================================
-- Hospitality — מיגרציה 43: פתיחת תאריכים להזמנה
--
-- בעל המקום פותח תאריכים קדימה לכל יחידה ("פתוח להזמנות עד…"); אורחים מזמינים באתר רק בתאריכים
-- הפתוחים. כברירת מחדל — סגור: יחידה חדשה, וגם כל היחידות שכבר קיימות (החלטת בעל הפלטפורמה), עד
-- שבעל המקום פותח. הצוות (הזמנה ידנית / בטלפון, שינוי הזמנה) — יכול להזמין גם בתאריכים סגורים.
--   1. units.open_until — הלילה האחרון שפתוח להזמנה (כולל); ריק — סגור.
--   2. _quote (מיגרציה 14): לאורח — זמין רק בתאריכים פתוחים (available = false בסגור, בלי שגיאה,
--      כדי שבמלונות יבחר חדר אחר מהסוג); מחזיר גם open ו-open_until. calendar (14): open_until לכל
--      יחידה. public_availability (19): open_until, ו"כל המתחם" תפוס גם כשאחת היחידות שלו תפוסה
--      (עד עכשיו לוח השנה באתר הראה אותו פנוי, וההצעה נכשלה רק בשלב המחיר). public_type_availability
--      (22): לילה פנוי = יש חדר מהסוג שגם פתוח וגם פנוי. channel_feed (24): ביומן של "כל המתחם" —
--      גם ההזמנות של היחידות שלו. ליומנים החיצוניים (Airbnb / Booking) נשלחות, כמו היום, רק הזמנות
--      וחסימות — לא "עוד לא נפתח".
--   3. units_open_dates(_unit_ids, _until) — פתיחה / הארכה / קיצור / סגירה, ליחידה אחת או לכמה. ביומן.
--   4. dashboard_tasks (32): משימה "open_dates"; open_dates_remind() — תזכורת במייל (השרת, פעם ביום;
--      לכל היותר מייל בשבוע לכל כתובת) לאתר שפתוח להזמנות.
-- כל השאר בפונקציות — מילה במילה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105200000_hosp_open_dates.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. העמודה (ריק = סגור — גם ליחידות הקיימות)
-- ------------------------------------------------------------
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS open_until date;
COMMENT ON COLUMN hospitality.units.open_until IS
  'הלילה האחרון שפתוח להזמנה באתר (כולל); ריק — עוד לא נפתחו תאריכים. הצוות יכול להזמין גם בסגור';

-- ------------------------------------------------------------
-- 2. הזמינות (כמו במיגרציות 14, 19, 22, 24 — עם התאריכים הפתוחים)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._quote(_tenant_id uuid, _unit_id uuid, _check_in date, _check_out date,
                                              _adults integer, _children integer, _promo_code text,
                                              _guest_mode boolean, _policy_id uuid DEFAULT NULL,
                                              _exclude_booking uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  s hospitality.settings;
  u hospitality.units;
  pr hospitality.properties;
  pol hospitality.policies;
  _code text := NULLIF(upper(btrim(COALESCE(_promo_code, ''))), '');
  _today date;
  _nights jsonb;
  _subtotal numeric;
  _rule_min integer;
  _min integer;
  _promo_id uuid;
  _discount numeric := 0;
  _total numeric;
  _available boolean;
  _snapshot jsonb;
  _open boolean;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האתר עדיין לא הוגדר' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _tenant_id AND x.id = _unit_id;
  SELECT * INTO pr FROM hospitality.properties x WHERE x.tenant_id = _tenant_id AND x.id = u.property_id;
  IF u.id IS NULL OR (_guest_mode AND (NOT u.is_active OR pr.status <> 'active')) THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _check_in IS NULL OR _check_out IS NULL OR _check_out <= _check_in THEN
    RAISE EXCEPTION 'תאריכי השהייה לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  IF _check_out - _check_in > 60 THEN
    RAISE EXCEPTION 'אפשר להזמין עד 60 לילות' USING ERRCODE = 'check_violation';
  END IF;
  _today := (now() AT TIME ZONE s.timezone)::date;
  IF _guest_mode AND _check_in < _today THEN
    RAISE EXCEPTION 'אי אפשר להזמין לתאריך שעבר' USING ERRCODE = 'check_violation';
  END IF;
  IF _guest_mode AND _check_in > _today + 730 THEN
    RAISE EXCEPTION 'אפשר להזמין עד שנתיים מראש' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_adults, 0) < 1 OR COALESCE(_children, -1) < 0 OR _adults + _children > u.capacity THEN
    RAISE EXCEPTION 'מספר האורחים לא מתאים ליחידה (עד % אורחים)', u.capacity USING ERRCODE = 'check_violation';
  END IF;
  -- מקסימום מבוגרים / ילדים ליחידה (שלב 2d) — בכל הצעת מחיר: אתר, הזמנה ידנית ושינוי הזמנה
  IF u.max_adults IS NOT NULL AND _adults > u.max_adults THEN
    RAISE EXCEPTION '%', CASE WHEN u.max_adults = 1 THEN 'ביחידה הזאת אפשר מבוגר אחד בלבד'
                              ELSE format('ביחידה הזאת אפשר עד %s מבוגרים', u.max_adults) END
      USING ERRCODE = 'check_violation';
  END IF;
  IF u.max_children IS NOT NULL AND _children > u.max_children THEN
    RAISE EXCEPTION '%', CASE WHEN u.max_children = 0 THEN 'היחידה הזאת לא מתאימה לילדים'
                              WHEN u.max_children = 1 THEN 'ביחידה הזאת אפשר ילד אחד בלבד'
                              ELSE format('ביחידה הזאת אפשר עד %s ילדים', u.max_children) END
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('night', p.night, 'base_rate', p.base_rate, 'extras', p.extras, 'price', p.price,
                                      'rule_applied', p.rule_applied, 'rule_id', p.rule_id) ORDER BY p.night),
         sum(p.price), max(p.rule_min_nights)
    INTO _nights, _subtotal, _rule_min
    FROM hospitality._price_nights(_tenant_id, _unit_id, _check_in, _check_out, _adults, _children) p;
  _min := greatest(u.min_nights, COALESCE(_rule_min, 0));
  IF _guest_mode AND _check_out - _check_in < _min THEN
    RAISE EXCEPTION 'בתאריכים האלה אפשר להזמין לפחות % לילות', _min USING ERRCODE = 'check_violation';
  END IF;

  SELECT x.id, x.disc INTO _promo_id, _discount
    FROM (SELECT p.id, CASE p.discount_kind WHEN 'percent' THEN round(_subtotal * p.value / 100, 2)
                                            ELSE least(p.value, _subtotal) END AS disc
            FROM hospitality.promotions p
           WHERE p.tenant_id = _tenant_id AND p.is_active
             AND (p.unit_id = u.id OR p.property_id = u.property_id OR (p.unit_id IS NULL AND p.property_id IS NULL))
             AND (p.stay_from IS NULL OR _check_in >= p.stay_from) AND (p.stay_to IS NULL OR _check_out <= p.stay_to)
             AND (p.book_from IS NULL OR now() >= p.book_from) AND (p.book_to IS NULL OR now() < p.book_to)
             AND (p.min_nights IS NULL OR _check_out - _check_in >= p.min_nights)
             AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit)
             AND CASE WHEN _code IS NULL THEN p.code IS NULL ELSE p.code = _code END) x
   ORDER BY x.disc DESC, x.id
   LIMIT 1;
  IF _code IS NOT NULL AND _promo_id IS NULL THEN
    RAISE EXCEPTION 'קוד הקופון לא תקף לתאריכים האלה' USING ERRCODE = 'check_violation';
  END IF;
  _discount := COALESCE(_discount, 0);
  _total := _subtotal - _discount;

  _available := NOT EXISTS (
    SELECT 1 FROM hospitality.unit_occupancy o
      LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
     WHERE o.tenant_id = _tenant_id
       AND o.unit_id = ANY (hospitality._fanout_units(_tenant_id, _unit_id))
       AND o.nights && daterange(_check_in, _check_out)
       -- חסימה (booking_id ריק) תמיד נספרת; רק ההזמנה שמשנים מוחרגת (תיקון 3a)
       AND (o.booking_id IS NULL OR o.booking_id IS DISTINCT FROM _exclude_booking)
       AND NOT COALESCE(b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now(), false));
  -- מיגרציה 43: תאריכים פתוחים להזמנה — עד הלילה האחרון שבעל המקום פתח (open_until, כולל).
  -- אורח (האתר) — רק בתאריכים פתוחים; הצוות (הזמנה ידנית, שינוי, הצעת מחיר) — גם בסגורים.
  _open := u.open_until IS NOT NULL AND _check_out - 1 <= u.open_until;
  IF _guest_mode AND NOT _open THEN
    _available := false;
  END IF;

  pol := hospitality._resolve_policy(_tenant_id, _unit_id, _check_in, _check_out, _policy_id);
  _snapshot := hospitality._snapshot(pol.id, pol.version, pol.name, hospitality._policy_rules(pol),
                                     s.timezone, s.check_in_time, s.currency, _check_in, _total);
  RETURN jsonb_build_object(
    'available', _available, 'open', _open, 'open_until', u.open_until, 'unit_id', u.id, 'unit_name', u.name, 'unit_kind', u.kind,
    'check_in', _check_in, 'check_out', _check_out, 'nights_count', _check_out - _check_in,
    'adults', _adults, 'children', _children, 'min_nights', _min, 'nights', _nights,
    'subtotal', _subtotal, 'discount', _discount, 'promotion_id', _promo_id, 'total', _total,
    'currency', s.currency, 'deposit_amount', _snapshot -> 'deposit_amount',
    'policy', _snapshot, 'policy_hash', hospitality._hash(_snapshot));
END $$;

CREATE OR REPLACE FUNCTION hospitality.calendar(_from date, _to date, _unit_ids uuid[] DEFAULT NULL,
                                                _include_cancelled boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  s hospitality.settings;
BEGIN
  PERFORM hospitality._calendar_range(_from, _to);
  IF _unit_ids IS NOT NULL AND cardinality(_unit_ids) > 500 THEN
    RAISE EXCEPTION 'יותר מדי יחידות בבקשה אחת' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  RETURN jsonb_build_object(
    'from', _from, 'to', _to, 'today', (now() AT TIME ZONE s.timezone)::date,
    'weekend_nights', to_jsonb(s.weekend_nights), 'currency', s.currency,
    'stamp', hospitality._calendar_stamp(_t, _from, _to),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p WHERE p.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', u.id, 'name', u.name, 'property_id', u.property_id, 'kind', u.kind, 'unit_type', u.unit_type,
               'is_active', u.is_active, 'open_until', u.open_until,
               'member_ids', CASE WHEN u.kind = 'whole_property' THEN
                               COALESCE((SELECT jsonb_agg(m.member_unit_id) FROM hospitality.unit_members m
                                          WHERE m.tenant_id = _t AND m.parent_unit_id = u.id), '[]'::jsonb) END)
             ORDER BY p.sort_order, p.created_at, (u.kind = 'whole_property'), u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND p.status <> 'archived'
         AND (_unit_ids IS NULL OR u.id = ANY (_unit_ids))
         AND (u.is_active OR EXISTS (SELECT 1 FROM hospitality.unit_occupancy o
                                      WHERE o.tenant_id = _t AND o.unit_id = u.id
                                        AND o.nights && daterange(_from, _to)))), '[]'::jsonb),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id, 'number', b.number, 'unit_id', b.unit_id, 'check_in', b.check_in,
               'check_out', b.check_out, 'status', b.status, 'adults', b.adults, 'children', b.children,
               'total', b.total, 'source', b.source, 'channel', b.channel, 'guest_name', g.full_name)
             ORDER BY b.check_in, b.number)
        FROM hospitality.bookings b
        LEFT JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
       WHERE b.tenant_id = _t AND b.check_out > _from AND b.check_in < _to
         AND (_unit_ids IS NULL OR b.unit_id = ANY (_unit_ids)
              OR b.unit_id IN (SELECT m.parent_unit_id FROM hospitality.unit_members m
                                WHERE m.tenant_id = _t AND m.member_unit_id = ANY (_unit_ids)))
         AND b.status NOT IN ('declined', 'expired')
         AND (_include_cancelled OR b.status <> 'cancelled')
         AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())), '[]'::jsonb),
    'blocks', COALESCE((
      SELECT jsonb_agg(hospitality._block_json(k, u.name) ORDER BY k.start_date)
        FROM hospitality.blocks k
        JOIN hospitality.units u ON u.tenant_id = k.tenant_id AND u.id = k.unit_id
       WHERE k.tenant_id = _t AND k.released_at IS NULL AND k.end_date > _from AND k.start_date < _to
         AND (_unit_ids IS NULL OR k.unit_id = ANY (_unit_ids)
              OR k.unit_id IN (SELECT m.parent_unit_id FROM hospitality.unit_members m
                                WHERE m.tenant_id = _t AND m.member_unit_id = ANY (_unit_ids)))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.calendar(date, date, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.calendar(date, date, uuid[], boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.public_availability(_unit_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > 120 THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hospitality.units u JOIN hospitality.properties p
                   ON p.tenant_id = u.tenant_id AND p.id = u.property_id
                  WHERE u.tenant_id = _t AND u.id = _unit_id AND u.is_active AND p.status = 'active') THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'unit_id', _unit_id, 'from', _from, 'to', _to,
    -- מיגרציה 43: הלילה האחרון שפתוח להזמנה (null — עוד לא נפתחו תאריכים); אחריו — סגור
    'open_until', (SELECT u.open_until FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = _unit_id),
    'busy', COALESCE((
      SELECT jsonb_agg(DISTINCT d::date ORDER BY d::date)
        FROM hospitality.unit_occupancy o
        LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
        CROSS JOIN LATERAL generate_series(greatest(lower(o.nights), _from), least(upper(o.nights), _to) - 1, interval '1 day') d
       -- מיגרציה 43: "כל המתחם" תפוס גם כשאחת היחידות שלו תפוסה (כמו בהצעת המחיר)
       WHERE o.tenant_id = _t AND o.unit_id = ANY (hospitality._fanout_units(_t, _unit_id))
         AND o.nights && daterange(_from, _to)
         AND (o.booking_id IS NULL
              OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_availability(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_availability(uuid, date, date) TO anon, authenticated, service_role;

-- לילות שבהם אף חדר מהסוג לא פתוח ופנוי (בלי מי / למה), עד 120 ימים
CREATE OR REPLACE FUNCTION hospitality.public_type_availability(_category_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
  _rooms uuid[];
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from OR _to - _from > 120 THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _rooms := hospitality._type_rooms(_t, _category_id, NULL);
  IF cardinality(_rooms) = 0 THEN
    RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'category_id', _category_id, 'from', _from, 'to', _to, 'rooms', cardinality(_rooms),
    -- מיגרציה 43: הלילה האחרון שחדר כלשהו מהסוג פתוח בו להזמנה (null — אף חדר לא נפתח)
    'open_until', (SELECT max(u.open_until) FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_rooms)),
    -- לילות שבהם אין חדר מהסוג שגם פתוח להזמנה וגם פנוי
    'busy', COALESCE((
      SELECT jsonb_agg(n.night ORDER BY n.night)
        FROM (SELECT d::date AS night FROM generate_series(_from, _to - 1, interval '1 day') d) n
       WHERE NOT EXISTS (
               SELECT 1 FROM hospitality.units u
                WHERE u.tenant_id = _t AND u.id = ANY (_rooms) AND u.open_until >= n.night
                  AND NOT EXISTS (
                        SELECT 1 FROM hospitality.unit_occupancy o
                          LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
                         WHERE o.tenant_id = _t AND o.unit_id = u.id AND o.nights @> n.night
                           AND (o.booking_id IS NULL
                                OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()))))),
      '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_type_availability(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_type_availability(uuid, date, date) TO anon, authenticated, service_role;

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
               -- מיגרציה 43: ביומן של "כל המתחם" — גם ההזמנות והחסימות של היחידות שלו
               WHERE o.tenant_id = _tenant_id AND o.unit_id = ANY (hospitality._fanout_units(_tenant_id, f.unit_id))
                 AND upper(o.nights) >= _today - 30 AND lower(o.nights) <= _today + 730
                 AND (o.booking_id IS NULL
                      OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()))) e),
      '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_feed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.channel_feed(uuid, text) TO service_role;

-- ------------------------------------------------------------
-- 3. פתיחת תאריכים — לבעל העסק ולמנהלים (הרשאת bookings, כמו החסימות)
-- ------------------------------------------------------------
-- _until: הלילה האחרון שפתוח להזמנה באתר (כולל), עד שנתיים קדימה; NULL — סגור (אין תאריכים פתוחים).
-- אפשר גם לקצר (לסגור מתאריך). ההזמנות שכבר קיימות לא משתנות. ביומן הפעולות.
CREATE OR REPLACE FUNCTION hospitality.units_open_dates(_unit_ids uuid[], _until date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _n integer;
  _names text;
BEGIN
  IF _unit_ids IS NULL OR cardinality(_unit_ids) = 0 THEN
    RAISE EXCEPTION 'לא נבחרו יחידות' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_unit_ids) > 500 THEN
    RAISE EXCEPTION 'יותר מדי יחידות בבקשה אחת' USING ERRCODE = 'check_violation';
  END IF;
  SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date INTO _today
    FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  IF _until IS NOT NULL AND _until < _today THEN
    RAISE EXCEPTION 'התאריך כבר עבר — כדי לסגור הכול בוחרים "סגור להזמנות"' USING ERRCODE = 'check_violation';
  END IF;
  IF _until > _today + 730 THEN
    RAISE EXCEPTION 'אפשר לפתוח תאריכים עד שנתיים קדימה' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_unit_ids) x
              WHERE NOT EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = x)) THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE hospitality.units u SET open_until = _until, updated_at = now()
   WHERE u.tenant_id = _t AND u.id = ANY (_unit_ids) AND u.open_until IS DISTINCT FROM _until;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    SELECT string_agg(u.name, ', ' ORDER BY u.sort_order, u.created_at) INTO _names
      FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_unit_ids);
    PERFORM hospitality._audit(_t, CASE WHEN _until IS NULL THEN 'calendar.dates_closed' ELSE 'calendar.dates_opened' END,
                               left(_names, 120), jsonb_build_object('until', _until, 'units', _n));
  END IF;
  RETURN jsonb_build_object(
    'updated', _n,
    'units', (SELECT jsonb_agg(jsonb_build_object('id', u.id, 'open_until', u.open_until) ORDER BY u.sort_order, u.created_at)
                FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_unit_ids)));
END $$;
REVOKE ALL ON FUNCTION hospitality.units_open_dates(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.units_open_dates(uuid[], date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. תזכורת במייל לבעל העסק (השרת קורא לה פעם ביום) — לאתר שפתוח להזמנות: יחידות פעילות שאין בהן
--    תאריכים פתוחים, או שנשארו להן פחות מ-14 לילות פתוחים. לכל היותר מייל אחד בשבוע לכל כתובת.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.open_dates_remind()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  _email text;
  _n integer := 0;
BEGIN
  FOR r IN
    SELECT u.tenant_id, x.today,
           jsonb_agg(jsonb_build_object('name', u.name, 'open_until', u.open_until)
                     ORDER BY u.open_until NULLS FIRST, p.sort_order, u.sort_order, u.created_at) AS units,
           count(*) FILTER (WHERE u.open_until IS NULL OR u.open_until < x.today) AS closed,
           count(*) FILTER (WHERE u.open_until >= x.today) AS ending
      FROM hospitality.units u
      JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id AND p.status = 'active'
      JOIN hospitality.settings s ON s.tenant_id = u.tenant_id
      CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date AS today) x
     WHERE u.is_active AND (u.open_until IS NULL OR u.open_until < x.today + 14)
       AND hospitality.flag_for('hospitality_backend_enabled', u.tenant_id)
       AND hospitality.flag_for('hospitality_booking_enabled', u.tenant_id)
       AND COALESCE((hospitality.entitlements(u.tenant_id) ->> 'active')::boolean, false)
     GROUP BY u.tenant_id, x.today
  LOOP
    FOREACH _email IN ARRAY COALESCE(hospitality._owner_emails(r.tenant_id), '{}') LOOP
      INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
      VALUES (r.tenant_id, NULL, 'open_dates_reminder', 'owner', _email,
              'open-dates:' || r.tenant_id || ':' || to_char(r.today, 'IYYY-IW') || ':' || _email,
              -- שמות היחידות ותאריכים בלבד (עד 20)
              jsonb_build_object('units', (SELECT jsonb_agg(e) FROM (SELECT e FROM jsonb_array_elements(r.units) e LIMIT 20) q),
                                 'unit_count', jsonb_array_length(r.units), 'closed_count', r.closed,
                                 'ending_count', r.ending, 'today', r.today))
      ON CONFLICT (dedupe_key) DO NOTHING;
      IF FOUND THEN
        _n := _n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION hospitality.open_dates_remind() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.open_dates_remind() TO service_role;

-- ------------------------------------------------------------
-- 5. לוח הבקרה: "פתיחת תאריכים" (כמו במיגרציה 32, עם משימה 9)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.dashboard_tasks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _items jsonb := '[]'::jsonb;
  _n integer;
  _m integer;
  _when timestamptz;
  _first uuid;
  _num integer;
  _e jsonb;
  _trial timestamptz;
  _closed integer;
  _ending integer;
  _until date;
BEGIN
  SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date INTO _today
    FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);

  -- 1. בקשות שממתינות לאישור (הקרובה לפקיעה קודם)
  SELECT count(*), min(b.hold_expires_at) INTO _n, _when FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now();
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()
     ORDER BY b.hold_expires_at, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'pending', 'severity', 'high', 'count', _n, 'due', hospitality._ts(_when),
      'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 2. בקשות ביטול מהאורחים
  SELECT count(*) INTO _n FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'cancel_requested';
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status = 'cancel_requested'
     ORDER BY b.cancellation_requested_at NULLS LAST, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'cancel_requests', 'severity', 'high', 'count', _n, 'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 3. מקדמות לגבייה: מגיעים ב-7 הימים הקרובים ושולם פחות מהמקדמה
  SELECT count(*) INTO _n FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.status = 'confirmed' AND b.check_in BETWEEN _today AND _today + 7
     AND b.deposit_amount > 0 AND b.amount_paid < b.deposit_amount;
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status = 'confirmed' AND b.check_in BETWEEN _today AND _today + 7
       AND b.deposit_amount > 0 AND b.amount_paid < b.deposit_amount
     ORDER BY b.check_in, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'deposits', 'severity', 'medium', 'count', _n, 'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 4. יומנים חיצוניים: התנגשויות / סנכרון שנכשל
  SELECT COALESCE(sum(jsonb_array_length(c.conflicts)), 0), count(*) FILTER (WHERE c.last_status = 'error')
    INTO _n, _m
    FROM hospitality.channel_calendars c
   WHERE c.tenant_id = _t AND c.enabled AND c.removed_at IS NULL;
  IF _n > 0 OR _m > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'channels', 'severity', CASE WHEN _n > 0 THEN 'high' ELSE 'medium' END,
      'count', _n + _m, 'conflicts', _n, 'failing', _m));
  END IF;

  -- 5. מיילים שנכשלו
  SELECT count(*) INTO _n FROM hospitality.notifications x WHERE x.tenant_id = _t AND x.status IN ('failed', 'dead');
  IF _n > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object('kind', 'emails', 'severity', 'medium', 'count', _n));
  END IF;

  -- 6. יחידות פעילות בלי מחיר בסיס
  IF hospitality.can('pricing') THEN
    SELECT count(*) INTO _n FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property' AND COALESCE(u.base_price, 0) <= 0;
    IF _n > 0 THEN
      _items := _items || jsonb_build_array(jsonb_build_object('kind', 'prices', 'severity', 'medium', 'count', _n));
    END IF;
  END IF;

  -- 7. שינויים באתר שלא פורסמו
  IF hospitality.can('settings') AND EXISTS (
       SELECT 1 FROM hospitality.site_versions d
        WHERE d.tenant_id = _t AND d.kind = 'draft'
          AND NOT EXISTS (
            SELECT 1 FROM hospitality.site_versions p
             WHERE p.tenant_id = _t AND p.kind = 'published' AND p.document = d.document AND p.theme = d.theme
               AND p.version = (SELECT max(x.version) FROM hospitality.site_versions x
                                 WHERE x.tenant_id = _t AND x.kind = 'published'))) THEN
    _items := _items || jsonb_build_array(jsonb_build_object('kind', 'site', 'severity', 'low', 'count', 1));
  END IF;

  -- 8. החבילה (בעלים): מנוי לא פעיל / ניסיון שמסתיים בתוך 14 יום
  IF hospitality.can('billing.manage') THEN
    _e := hospitality.entitlements(_t);
    IF _e IS NOT NULL AND NOT COALESCE((_e ->> 'active')::boolean, false) THEN
      _items := _items || jsonb_build_array(jsonb_build_object('kind', 'plan', 'severity', 'high', 'count', 1,
        'inactive', true));
    ELSE
      _trial := NULLIF(_e ->> 'trial_ends_at', '')::timestamptz;
      IF _e ->> 'status' = 'trialing' AND _trial IS NOT NULL AND _trial < now() + interval '14 days' THEN
        _items := _items || jsonb_build_array(jsonb_build_object('kind', 'plan', 'severity', 'medium', 'count', 1,
          'due', hospitality._ts(_trial), 'inactive', false));
      END IF;
    END IF;
  END IF;

  -- 9. תאריכים להזמנה (מיגרציה 43): יחידות פעילות שאין בהן תאריכים פתוחים (עוד לא נפתחו / נגמרו),
  --    ויחידות שנשארו להן פחות מ-14 לילות פתוחים
  SELECT count(*) FILTER (WHERE u.open_until IS NULL OR u.open_until < _today),
         count(*) FILTER (WHERE u.open_until BETWEEN _today AND _today + 13),
         min(u.open_until) FILTER (WHERE u.open_until >= _today)
    INTO _closed, _ending, _until
    FROM hospitality.units u
    JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
   WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active';
  IF _closed + _ending > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'open_dates', 'severity', CASE WHEN _closed > 0 THEN 'high' ELSE 'medium' END,
      'count', _closed + _ending, 'closed', _closed, 'ending', _ending, 'until', _until));
  END IF;

  RETURN jsonb_build_object('items', _items, 'count', jsonb_array_length(_items));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard_tasks() TO authenticated, service_role;

COMMIT;

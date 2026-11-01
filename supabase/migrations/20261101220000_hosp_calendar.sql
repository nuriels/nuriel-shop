-- ============================================================
-- Hospitality Stage 3a — לוח היומן (קריאה) וחסימות תאריכים
--
-- תוספת בלבד:
--   1. אינדקסים לטווח תאריכים: bookings (tenant, check_out, check_in), blocks (tenant, end_date).
--   2. calendar(from, to, unit_ids?, include_cancelled) — קריאה אחת לטווח שעל המסך: היחידות,
--      ההזמנות והחסימות שחופפות, "כל המתחם" ויחידותיו. בלי פרטי קשר (רק שם האורח).
--      calendar_stamp(from, to) — בדיקת שינוי זולה לרענון האוטומטי.
--   3. חסימות רק דרך פונקציות (ממצא A-1): block_create / block_update / block_release —
--      הרשאת bookings, הודעות בעברית, יומן פעולות. ה-EXCLUDE הקיים (unit_occupancy) נשאר
--      הסמכות הסופית מול הזמנה כפולה. blocks_upcoming — "חסימות קרובות".
--
-- Rollback: supabase/rollbacks/20261101220000_hosp_calendar.down.sql
-- אידמפוטנטית.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE INDEX IF NOT EXISTS bookings_calendar_idx ON hospitality.bookings (tenant_id, check_out, check_in);
CREATE INDEX IF NOT EXISTS blocks_calendar_idx ON hospitality.blocks (tenant_id, end_date) WHERE released_at IS NULL;

REVOKE INSERT, UPDATE, DELETE ON hospitality.blocks FROM authenticated;

-- ------------------------------------------------------------
-- עזרים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._calendar_range(_from date, _to date)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _to - _from > 62 THEN
    RAISE EXCEPTION 'אפשר להציג עד 62 ימים בבת אחת' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._calendar_range(date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._block_json(k hospitality.blocks, _unit_name text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', k.id, 'unit_id', k.unit_id, 'unit_name', _unit_name, 'start_date', k.start_date,
                            'end_date', k.end_date, 'reason', k.reason);
$$;
REVOKE ALL ON FUNCTION hospitality._block_json(hospitality.blocks, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- קריאה
-- ------------------------------------------------------------
-- הלוח לטווח [from, to): יחידות פעילות (או המבוקשות), הזמנות שחופפות (בלי בקשות שפג תוקפן,
-- בלי שנדחו / פגו; מבוטלות — רק אם ביקשו), חסימות פעילות. רק שם האורח — בלי טלפון / אימייל.
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
               'is_active', u.is_active,
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

-- "חתימה" זולה של הטווח: משתנה בכל שינוי בהזמנה / חסימה שחופפת או ביחידות
CREATE OR REPLACE FUNCTION hospitality._calendar_stamp(_t uuid, _from date, _to date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT md5(concat_ws('|',
    (SELECT count(*) || ':' || COALESCE(max(b.updated_at)::text, '') FROM hospitality.bookings b
      WHERE b.tenant_id = _t AND b.check_out > _from AND b.check_in < _to),
    (SELECT count(*) || ':' || COALESCE(max(k.updated_at)::text, '') FROM hospitality.blocks k
      WHERE k.tenant_id = _t AND k.end_date > _from AND k.start_date < _to),
    (SELECT count(*) || ':' || COALESCE(sum(u.revision), 0) || ':' || COALESCE(max(u.updated_at)::text, '')
       FROM hospitality.units u WHERE u.tenant_id = _t),
    -- בקשה שפג תוקפה נעלמת מהלוח בלי שינוי בשורה
    (SELECT count(*) FROM hospitality.bookings b
      WHERE b.tenant_id = _t AND b.check_out > _from AND b.check_in < _to
        AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())));
$$;
REVOKE ALL ON FUNCTION hospitality._calendar_stamp(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.calendar_stamp(_from date, _to date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  PERFORM hospitality._calendar_range(_from, _to);
  RETURN hospitality._calendar_stamp(_t, _from, _to);
END $$;
REVOKE ALL ON FUNCTION hospitality.calendar_stamp(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.calendar_stamp(date, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- חסימות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._block_dates(_t uuid, _from date, _to date)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _today date := (SELECT (now() AT TIME ZONE s.timezone)::date FROM hospitality.settings s WHERE s.tenant_id = _t);
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'יש לבחור תאריך התחלה ותאריך סיום (אחריו)' USING ERRCODE = 'check_violation';
  END IF;
  IF _to - _from > 366 THEN
    RAISE EXCEPTION 'חסימה אחת — עד שנה' USING ERRCODE = 'check_violation';
  END IF;
  IF _to <= _today THEN
    RAISE EXCEPTION 'אי אפשר לחסום תאריכים שעברו' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._block_dates(uuid, date, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.block_create(_unit_id uuid, _from date, _to date, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  u hospitality.units;
  k hospitality.blocks;
BEGIN
  SELECT x.* INTO u FROM hospitality.units x
    JOIN hospitality.properties p ON p.tenant_id = x.tenant_id AND p.id = x.property_id
   WHERE x.tenant_id = _t AND x.id = _unit_id AND p.status <> 'archived';
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._block_dates(_t, _from, _to);
  INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason)
  VALUES (_t, u.id, _from, _to, hospitality._cv_text(to_jsonb(_reason), 'סיבת החסימה', 300, false))
  RETURNING * INTO k;
  PERFORM hospitality._audit(_t, 'calendar.block_created', u.name,
                             jsonb_build_object('from', _from, 'to', _to, 'whole', u.kind = 'whole_property'));
  RETURN hospitality._block_json(k, u.name);
END $$;
REVOKE ALL ON FUNCTION hospitality.block_create(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.block_create(uuid, date, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.block_update(_id uuid, _from date, _to date, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  k hospitality.blocks;
  o hospitality.blocks;
  _name text;
BEGIN
  SELECT * INTO o FROM hospitality.blocks x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF o.id IS NULL OR o.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'החסימה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._block_dates(_t, _from, _to);
  UPDATE hospitality.blocks x
     SET start_date = _from, end_date = _to,
         reason = hospitality._cv_text(to_jsonb(_reason), 'סיבת החסימה', 300, false)
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO k;
  SELECT u.name INTO _name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = k.unit_id;
  PERFORM hospitality._audit(_t, 'calendar.block_updated', _name,
                             jsonb_build_object('from', jsonb_build_object('from', o.start_date, 'to', _from),
                                                'to', jsonb_build_object('from', o.end_date, 'to', _to)));
  RETURN hospitality._block_json(k, _name);
END $$;
REVOKE ALL ON FUNCTION hospitality.block_update(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.block_update(uuid, date, date, text) TO authenticated, service_role;

-- שחרור: החסימה נשמרת בהיסטוריה (released_at), התאריכים מתפנים מיד
CREATE OR REPLACE FUNCTION hospitality.block_release(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  k hospitality.blocks;
  _name text;
BEGIN
  SELECT * INTO k FROM hospitality.blocks x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF k.id IS NULL OR k.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'החסימה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE hospitality.blocks x SET released_at = now() WHERE x.tenant_id = _t AND x.id = _id;
  SELECT u.name INTO _name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = k.unit_id;
  PERFORM hospitality._audit(_t, 'calendar.block_released', _name,
                             jsonb_build_object('from', k.start_date, 'to', k.end_date));
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION hospitality.block_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.block_release(uuid) TO authenticated, service_role;

-- "חסימות קרובות": החסימות הפעילות שעוד לא נגמרו
CREATE OR REPLACE FUNCTION hospitality.blocks_upcoming()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date := (SELECT (now() AT TIME ZONE s.timezone)::date FROM hospitality.settings s WHERE s.tenant_id = _t);
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(hospitality._block_json(k, u.name) ORDER BY k.start_date, u.name)
      FROM (SELECT * FROM hospitality.blocks x
             WHERE x.tenant_id = _t AND x.released_at IS NULL AND x.end_date > _today
             ORDER BY x.start_date LIMIT 100) k
      JOIN hospitality.units u ON u.tenant_id = k.tenant_id AND u.id = k.unit_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.blocks_upcoming() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.blocks_upcoming() TO authenticated, service_role;

-- ------------------------------------------------------------
-- תיקון: חסימות נספרות בבדיקת הזמינות של הצעת המחיר
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

  pol := hospitality._resolve_policy(_tenant_id, _unit_id, _check_in, _check_out, _policy_id);
  _snapshot := hospitality._snapshot(pol.id, pol.version, pol.name, hospitality._policy_rules(pol),
                                     s.timezone, s.check_in_time, s.currency, _check_in, _total);
  RETURN jsonb_build_object(
    'available', _available, 'unit_id', u.id, 'unit_name', u.name, 'unit_kind', u.kind,
    'check_in', _check_in, 'check_out', _check_out, 'nights_count', _check_out - _check_in,
    'adults', _adults, 'children', _children, 'min_nights', _min, 'nights', _nights,
    'subtotal', _subtotal, 'discount', _discount, 'promotion_id', _promo_id, 'total', _total,
    'currency', s.currency, 'deposit_amount', _snapshot -> 'deposit_amount',
    'policy', _snapshot, 'policy_hash', hospitality._hash(_snapshot));
END $$;

COMMIT;

-- ============================================================
-- Rollback: 20261101190000_hosp_details.sql
-- חזרה למצב של מיגרציה 10: הצוות כותב שוב ישירות למיטות ולמתקנים (כמו במיגרציה 3),
-- הפונקציות של הקטלוג וחישוב המחיר (_quote) חוזרות לגרסה הקודמת בדיוק, בלי המידע
-- הפרטי להגעה, בלי קטלוג המתקנים המוכן ובלי העמודות החדשות.
-- הגנה: נעצר אם נשמר מידע חדש (שדות היחידה / המתחם, מידע פרטי להגעה, מתקן מהרשימה,
-- כללי המקום בהזמנה) — לא מוחקים מידע בשקט.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('hospitality.arrival_info') IS NOT NULL AND (
       EXISTS (SELECT 1 FROM hospitality.arrival_info)
       OR EXISTS (SELECT 1 FROM hospitality.units
                   WHERE separate_toilets <> 0 OR max_adults IS NOT NULL OR max_children IS NOT NULL)
       OR EXISTS (SELECT 1 FROM hospitality.properties
                   WHERE parking IS NOT NULL OR guest_info IS NOT NULL OR rules_smoking IS NOT NULL
                      OR rules_pets IS NOT NULL OR rules_pets_note IS NOT NULL OR rules_events IS NOT NULL
                      OR quiet_from IS NOT NULL OR cardinality(rules_custom) > 0)
       OR EXISTS (SELECT 1 FROM hospitality.amenities WHERE preset_code IS NOT NULL)
       OR EXISTS (SELECT 1 FROM hospitality.bookings WHERE house_rules_snapshot IS NOT NULL)) THEN
    RAISE EXCEPTION 'rollback refused: 2d details were saved (unit / property fields, arrival info, preset amenities or booking house rules)';
  END IF;
END $$;

-- 11. כללי המקום בהזמנה; _quote כמו במיגרציה 4
DROP TRIGGER IF EXISTS bookings_house_rules ON hospitality.bookings;
DROP FUNCTION IF EXISTS hospitality.bookings_house_rules();
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
       AND o.booking_id IS DISTINCT FROM _exclude_booking
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

-- 10. מידע פרטי להגעה
DROP FUNCTION IF EXISTS hospitality.guest_arrival_info(text, uuid);
DROP FUNCTION IF EXISTS hospitality.arrival_info_set(uuid, uuid, jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.arrival_info_view(uuid);
DROP FUNCTION IF EXISTS hospitality._arrival_json(hospitality.arrival_info);
DROP FUNCTION IF EXISTS hospitality._arrival_tenant();

-- 9. קטלוג המתקנים
DROP FUNCTION IF EXISTS hospitality.amenity_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.amenity_update(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality.amenity_create(jsonb);
DROP FUNCTION IF EXISTS hospitality._amenity_fields(jsonb, text, text, text);
DROP FUNCTION IF EXISTS hospitality.amenity_add_preset(text);

-- 8–6. הפונקציות של מיגרציה 10 בגרסה המקורית
CREATE OR REPLACE FUNCTION hospitality._unit_json(u hospitality.units)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'property_id', u.property_id, 'kind', u.kind, 'unit_type', u.unit_type,
    'name', u.name, 'description', u.description, 'capacity', u.capacity,
    'base_occupancy', u.base_occupancy, 'child_age_limit', u.child_age_limit,
    'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'is_active', u.is_active,
    'sort_order', u.sort_order, 'revision', u.revision,
    'has_price', u.base_price > 0,
    'has_photo', EXISTS (SELECT 1 FROM hospitality.media m
                          WHERE m.tenant_id = u.tenant_id AND m.unit_id = u.id AND m.kind = 'image' AND NOT m.is_demo),
    'has_history', hospitality._unit_has_history(u.tenant_id, u.id),
    'member_ids', CASE WHEN u.kind = 'whole_property' THEN
                    COALESCE((SELECT jsonb_agg(m.member_unit_id ORDER BY mu.sort_order, mu.created_at)
                                FROM hospitality.unit_members m
                                JOIN hospitality.units mu ON mu.tenant_id = m.tenant_id AND mu.id = m.member_unit_id
                               WHERE m.tenant_id = u.tenant_id AND m.parent_unit_id = u.id), '[]'::jsonb)
                  END);
$$;
REVOKE ALL ON FUNCTION hospitality._unit_json(hospitality.units) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._unit_apply(u hospitality.units, _data jsonb, _creating boolean)
RETURNS hospitality.units LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_data) e ORDER BY e.key LOOP
    CASE k
      WHEN 'name' THEN u.name := hospitality._cv_text(v, 'שם היחידה', 120, true);
      WHEN 'unit_type' THEN u.unit_type := hospitality._cv_choice(v, 'סוג היחידה',
        ARRAY['zimmer', 'suite', 'room', 'apartment', 'villa', 'cabin', 'studio', 'other']);
      WHEN 'kind' THEN
        IF u.kind = 'whole_property' OR (v #>> '{}') = 'whole_property' THEN
          RAISE EXCEPTION '"כל המתחם" נקבע במתג "השכרת המתחם כולו" בלבד' USING ERRCODE = 'check_violation';
        END IF;
        u.kind := hospitality._cv_choice(v, 'אופן ההשכרה', ARRAY['unit', 'room']);
      WHEN 'description' THEN u.description := hospitality._cv_text(v, 'תיאור היחידה', 5000, false);
      WHEN 'capacity' THEN u.capacity := hospitality._cv_int(v, 'מספר האורחים המרבי', 1, 100);
      WHEN 'base_occupancy' THEN u.base_occupancy := hospitality._cv_int(v, 'מספר האורחים הכלולים במחיר', 1, 100);
      WHEN 'child_age_limit' THEN u.child_age_limit := hospitality._cv_int(v, 'גיל ילד עד', 0, 17);
      WHEN 'bedrooms' THEN u.bedrooms := hospitality._cv_int(v, 'חדרי שינה', 0, 50);
      WHEN 'bathrooms' THEN u.bathrooms := hospitality._cv_int(v, 'חדרי רחצה', 0, 50);
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  IF _creating AND NOT (_data ? 'base_occupancy') THEN
    u.base_occupancy := LEAST(2, u.capacity);
  END IF;
  IF u.base_occupancy > u.capacity THEN
    RAISE EXCEPTION 'מספר האורחים הכלולים במחיר לא יכול להיות גדול ממספר האורחים המרבי'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN u;
END $$;
REVOKE ALL ON FUNCTION hospitality._unit_apply(hospitality.units, jsonb, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.unit_create(_property_id uuid, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  p hospitality.properties;
  u hospitality.units;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי היחידה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status = 'archived' THEN
    RAISE EXCEPTION 'המתחם בארכיון — אי אפשר להוסיף לו יחידות' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (_data ? 'name') THEN
    RAISE EXCEPTION 'יש למלא את שם היחידה' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (_data ? 'unit_type') THEN
    RAISE EXCEPTION 'סוג היחידה — יש לבחור מהרשימה' USING ERRCODE = 'check_violation';
  END IF;
  -- ברירות המחדל של הטבלה (2 אורחים, חדר אחד…)
  u.tenant_id := _t; u.property_id := _property_id; u.kind := 'unit'; u.capacity := 2; u.base_occupancy := 2;
  u.child_age_limit := 12; u.bedrooms := 1; u.bathrooms := 1; u.unit_type := 'other';
  u := hospitality._unit_apply(u, _data, true);
  INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, description, capacity,
                                 base_occupancy, child_age_limit, bedrooms, bathrooms, is_active, sort_order)
  VALUES (_t, _property_id, u.kind, u.unit_type, u.name, hospitality._catalog_slug(_t, 'units', u.name),
          u.description, u.capacity, u.base_occupancy, u.child_age_limit, u.bedrooms, u.bathrooms, true,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.units x
                     WHERE x.tenant_id = _t AND x.property_id = _property_id AND x.kind <> 'whole_property'), 0))
  RETURNING * INTO u;
  PERFORM hospitality._audit(_t, 'catalog.unit_created', u.name,
                             jsonb_build_object('property', p.name, 'unit_type', u.unit_type, 'capacity', u.capacity));
  RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_create(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_create(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.unit_update(_id uuid, _changes jsonb, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  u hospitality.units;
  n hospitality.units;
  _status text;
  _diff jsonb := '{}'::jsonb;
  f text;
BEGIN
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS DISTINCT FROM u.revision THEN
    RAISE EXCEPTION 'היחידה עודכנה בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  SELECT p.status INTO _status FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = u.property_id;
  IF _status = 'archived' AND NOT hospitality.can('catalog.owner') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לשנות יחידה במתחם שבארכיון' USING ERRCODE = 'insufficient_privilege';
  END IF;
  n := hospitality._unit_apply(u, _changes, false);
  FOREACH f IN ARRAY ARRAY['name', 'unit_type', 'kind', 'capacity', 'base_occupancy', 'child_age_limit',
                           'bedrooms', 'bathrooms'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(u) -> f THEN
      _diff := _diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(u) -> f, 'to', to_jsonb(n) -> f));
    END IF;
  END LOOP;
  IF n.description IS DISTINCT FROM u.description THEN
    _diff := _diff || jsonb_build_object('description', jsonb_build_object('changed', true));
  END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
  END IF;
  UPDATE hospitality.units x
     SET name = n.name, unit_type = n.unit_type, kind = n.kind, description = n.description,
         capacity = n.capacity, base_occupancy = n.base_occupancy, child_age_limit = n.child_age_limit,
         bedrooms = n.bedrooms, bathrooms = n.bathrooms, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'catalog.unit_updated', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.property_create(_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  _unknown text;
  p hospitality.properties;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי המתחם' USING ERRCODE = 'check_violation';
  END IF;
  SELECT k INTO _unknown FROM jsonb_object_keys(_data) k
   WHERE k NOT IN ('name', 'property_type', 'description', 'address', 'status') LIMIT 1;
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'שדה לא מוכר: %', left(_unknown, 40) USING ERRCODE = 'check_violation';
  END IF;
  p.tenant_id := _t;
  p.name := hospitality._cv_text(_data -> 'name', 'שם המתחם', 120, true);
  p.property_type := hospitality._cv_choice(_data -> 'property_type', 'סוג המקום',
    ARRAY['zimmer', 'zimmer_complex', 'vacation_apartments', 'villa', 'boutique_hotel', 'guest_house', 'other']);
  p.description := hospitality._cv_text(_data -> 'description', 'תיאור המתחם', 5000, false);
  p.address := hospitality._cv_text(_data -> 'address', 'כתובת', 300, false);
  p.status := CASE WHEN _data ? 'status'
                   THEN hospitality._cv_choice(_data -> 'status', 'מצב המתחם', ARRAY['draft', 'active'])
                   ELSE 'draft' END;
  INSERT INTO hospitality.properties (tenant_id, name, slug, property_type, description, address, status, sort_order)
  VALUES (_t, p.name, hospitality._catalog_slug(_t, 'properties', p.name), p.property_type, p.description,
          p.address, p.status,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.properties x WHERE x.tenant_id = _t), 0))
  RETURNING * INTO p;
  PERFORM hospitality._audit(_t, 'catalog.property_created', p.name,
                             jsonb_build_object('property_type', p.property_type, 'status', p.status));
  RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_create(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.property_update(_id uuid, _changes jsonb, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  p hospitality.properties;
  n hospitality.properties;
  k text;
  v jsonb;
  _diff jsonb := '{}'::jsonb;
BEGIN
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS DISTINCT FROM p.revision THEN
    RAISE EXCEPTION 'המתחם עודכן בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  IF p.status = 'archived' AND NOT hospitality.can('catalog.owner') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לשנות מתחם שבארכיון' USING ERRCODE = 'insufficient_privilege';
  END IF;
  n := p;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_changes) e ORDER BY e.key LOOP
    CASE k
      WHEN 'name' THEN n.name := hospitality._cv_text(v, 'שם המתחם', 120, true);
      WHEN 'property_type' THEN n.property_type := hospitality._cv_choice(v, 'סוג המקום',
        ARRAY['zimmer', 'zimmer_complex', 'vacation_apartments', 'villa', 'boutique_hotel', 'guest_house', 'other']);
      WHEN 'description' THEN n.description := hospitality._cv_text(v, 'תיאור המתחם', 5000, false);
      WHEN 'address' THEN n.address := hospitality._cv_text(v, 'כתובת', 300, false);
      WHEN 'status' THEN n.status := hospitality._cv_choice(v, 'מצב המתחם', ARRAY['draft', 'active']);
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  IF n.name IS DISTINCT FROM p.name THEN _diff := _diff || jsonb_build_object('name', jsonb_build_object('from', p.name, 'to', n.name)); END IF;
  IF n.property_type IS DISTINCT FROM p.property_type THEN _diff := _diff || jsonb_build_object('property_type', jsonb_build_object('from', p.property_type, 'to', n.property_type)); END IF;
  IF n.description IS DISTINCT FROM p.description THEN _diff := _diff || jsonb_build_object('description', jsonb_build_object('changed', true)); END IF;
  IF n.address IS DISTINCT FROM p.address THEN _diff := _diff || jsonb_build_object('address', jsonb_build_object('changed', true)); END IF;
  IF n.status IS DISTINCT FROM p.status THEN _diff := _diff || jsonb_build_object('status', jsonb_build_object('from', p.status, 'to', n.status)); END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
  END IF;
  UPDATE hospitality.properties x
     SET name = n.name, property_type = n.property_type, description = n.description, address = n.address,
         status = n.status, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'catalog.property_updated', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_update(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_update(uuid, jsonb, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.catalog_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _e jsonb := hospitality.entitlements(_t);
BEGIN
  RETURN jsonb_build_object(
    'limits', jsonb_build_object('max_units', _e -> 'max_units', 'units_used', hospitality._units_used(_t),
                                 'active', _e -> 'active'),
    'can_owner', hospitality.can('catalog.owner'),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'property_type', p.property_type, 'description', p.description,
               'address', p.address, 'status', p.status, 'sort_order', p.sort_order, 'revision', p.revision,
               'units', COALESCE((SELECT jsonb_agg(hospitality._unit_json(u)
                                                  ORDER BY (u.kind = 'whole_property'), u.sort_order, u.created_at)
                                    FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = p.id), '[]'::jsonb))
             ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p WHERE p.tenant_id = _t), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.catalog_view() TO authenticated, service_role;

DROP FUNCTION IF EXISTS hospitality._property_apply(hospitality.properties, jsonb);
DROP FUNCTION IF EXISTS hospitality._unit_parts_guard(hospitality.units, jsonb);

-- 5–4. העזרים
DROP FUNCTION IF EXISTS hospitality._cv_time(jsonb, text);
DROP FUNCTION IF EXISTS hospitality._house_rules_json(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._set_amenities(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._set_beds(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._cv_amenities(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._cv_beds(jsonb);
DROP FUNCTION IF EXISTS hospitality._amenity_links_json(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._beds_json(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._amenity_icons();
DROP FUNCTION IF EXISTS hospitality._amenity_categories();
DROP FUNCTION IF EXISTS hospitality.amenity_presets();

-- 3. הכתיבה הישירה של הצוות למיטות ולמתקנים חוזרת (כמו במיגרציה 3; RLS לפי catalog)
GRANT INSERT, UPDATE, DELETE ON hospitality.unit_beds TO authenticated;
GRANT INSERT, UPDATE, DELETE ON hospitality.amenities TO authenticated;
GRANT INSERT, UPDATE, DELETE ON hospitality.unit_amenities TO authenticated;

-- 2. המידע הפרטי להגעה
DROP TABLE IF EXISTS hospitality.arrival_info;

-- 1. העמודות
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS house_rules_snapshot;
DROP INDEX IF EXISTS hospitality.amenities_preset_key;
ALTER TABLE hospitality.amenities DROP CONSTRAINT IF EXISTS amenities_preset_code_check;
ALTER TABLE hospitality.amenities DROP COLUMN IF EXISTS preset_code;
ALTER TABLE hospitality.properties DROP CONSTRAINT IF EXISTS properties_details_check;
ALTER TABLE hospitality.properties
  DROP COLUMN IF EXISTS rules_custom, DROP COLUMN IF EXISTS quiet_to, DROP COLUMN IF EXISTS quiet_from,
  DROP COLUMN IF EXISTS rules_events, DROP COLUMN IF EXISTS rules_pets_note, DROP COLUMN IF EXISTS rules_pets,
  DROP COLUMN IF EXISTS rules_smoking, DROP COLUMN IF EXISTS guest_info, DROP COLUMN IF EXISTS parking_instructions,
  DROP COLUMN IF EXISTS parking_fee_note, DROP COLUMN IF EXISTS parking_spaces, DROP COLUMN IF EXISTS parking_type,
  DROP COLUMN IF EXISTS parking;
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_details_check;
ALTER TABLE hospitality.units
  DROP COLUMN IF EXISTS max_children, DROP COLUMN IF EXISTS max_adults, DROP COLUMN IF EXISTS separate_toilets;
DROP FUNCTION IF EXISTS hospitality._rules_items_ok(text[]);

COMMIT;

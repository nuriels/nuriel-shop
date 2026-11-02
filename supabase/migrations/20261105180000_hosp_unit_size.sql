-- ============================================================
-- Hospitality — מיגרציה 41: גודל היחידה (מ"ר)
--
-- בכרטיסי היחידות באתר מוצגים עכשיו גם הגודל ומה שמיוחד בה (ג׳קוזי ביחידה, בריכה במתחם — מהמתקנים
-- שבעל העסק סימן). המתקנים כבר קיימים; חסר רק שדה הגודל:
--   • units.size_sqm — מ"ר, לא חובה (5–5,000; ריק = לא מוצג);
--   • _unit_json, _unit_apply, unit_create, unit_update (מיגרציה 11) — עם size_sqm (גם ביומן השינויים);
--   • _site_payload (מיגרציה 21) — האתר הציבורי מקבל את הגודל.
-- כל השאר בפונקציות — מילה במילה. בלי פונקציות חדשות ובלי שינוי בהרשאות.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105180000_hosp_unit_size.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. העמודה
-- ------------------------------------------------------------
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS size_sqm smallint;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'hospitality.units'::regclass AND conname = 'units_size_sqm_check') THEN
    ALTER TABLE hospitality.units ADD CONSTRAINT units_size_sqm_check
      CHECK (size_sqm IS NULL OR size_sqm BETWEEN 5 AND 5000);
  END IF;
END $$;
COMMENT ON COLUMN hospitality.units.size_sqm IS 'גודל היחידה במ"ר (לא חובה) — מוצג בכרטיס היחידה ובעמוד שלה';

-- ------------------------------------------------------------
-- 2. היחידה בניהול (כמו במיגרציה 11, עם size_sqm)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._unit_json(u hospitality.units)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'property_id', u.property_id, 'kind', u.kind, 'unit_type', u.unit_type,
    'name', u.name, 'description', u.description, 'capacity', u.capacity,
    'base_occupancy', u.base_occupancy, 'child_age_limit', u.child_age_limit,
    'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'is_active', u.is_active,
    'separate_toilets', u.separate_toilets, 'max_adults', u.max_adults, 'max_children', u.max_children,
    'size_sqm', u.size_sqm,
    'sort_order', u.sort_order, 'revision', u.revision,
    'has_price', u.base_price > 0,
    'has_photo', EXISTS (SELECT 1 FROM hospitality.media m
                          WHERE m.tenant_id = u.tenant_id AND m.unit_id = u.id AND m.kind = 'image' AND NOT m.is_demo),
    'has_history', hospitality._unit_has_history(u.tenant_id, u.id),
    'beds', hospitality._beds_json(u.tenant_id, u.id),
    'amenities', hospitality._amenity_links_json(u.tenant_id, u.property_id, u.id),
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
      WHEN 'separate_toilets' THEN u.separate_toilets := hospitality._cv_int(v, 'שירותים נפרדים', 0, 50);
      WHEN 'max_adults' THEN
        u.max_adults := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                             ELSE hospitality._cv_int(v, 'מקסימום מבוגרים', 1, 100) END;
      WHEN 'max_children' THEN
        u.max_children := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                               ELSE hospitality._cv_int(v, 'מקסימום ילדים', 0, 100) END;
      -- מיגרציה 41: גודל היחידה במ"ר (לא חובה; null — מוחק)
      WHEN 'size_sqm' THEN
        u.size_sqm := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                           ELSE hospitality._cv_int(v, 'גודל היחידה (מ"ר)', 5, 5000) END;
      WHEN 'beds', 'amenities' THEN NULL;  -- טבלאות נפרדות: אצל הקורא
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
  IF u.max_adults IS NOT NULL AND u.max_adults > u.capacity THEN
    RAISE EXCEPTION 'מקסימום המבוגרים לא יכול להיות גדול ממספר האורחים המרבי' USING ERRCODE = 'check_violation';
  END IF;
  IF u.max_children IS NOT NULL AND u.max_children > u.capacity THEN
    RAISE EXCEPTION 'מקסימום הילדים לא יכול להיות גדול ממספר האורחים המרבי' USING ERRCODE = 'check_violation';
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
  _beds jsonb;
  _amen jsonb;
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
  u.child_age_limit := 12; u.bedrooms := 1; u.bathrooms := 1; u.unit_type := 'other'; u.separate_toilets := 0;
  u := hospitality._unit_apply(u, _data, true);
  IF _data ? 'beds' THEN _beds := hospitality._cv_beds(_data -> 'beds'); END IF;
  IF _data ? 'amenities' THEN _amen := hospitality._cv_amenities(_t, _data -> 'amenities'); END IF;
  INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, description, capacity,
                                 base_occupancy, child_age_limit, bedrooms, bathrooms, separate_toilets,
                                 max_adults, max_children, size_sqm, is_active, sort_order)
  VALUES (_t, _property_id, u.kind, u.unit_type, u.name, hospitality._catalog_slug(_t, 'units', u.name),
          u.description, u.capacity, u.base_occupancy, u.child_age_limit, u.bedrooms, u.bathrooms,
          u.separate_toilets, u.max_adults, u.max_children, u.size_sqm, true,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.units x
                     WHERE x.tenant_id = _t AND x.property_id = _property_id AND x.kind <> 'whole_property'), 0))
  RETURNING * INTO u;
  IF _beds IS NOT NULL THEN PERFORM hospitality._set_beds(_t, u.id, _beds); END IF;
  IF _amen IS NOT NULL THEN PERFORM hospitality._set_amenities(_t, _property_id, u.id, _amen); END IF;
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
  _beds jsonb;
  _amen jsonb;
  _d jsonb;
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
  PERFORM hospitality._unit_parts_guard(u, _changes);
  n := hospitality._unit_apply(u, _changes, false);
  IF _changes ? 'beds' THEN _beds := hospitality._cv_beds(_changes -> 'beds'); END IF;
  IF _changes ? 'amenities' THEN _amen := hospitality._cv_amenities(_t, _changes -> 'amenities'); END IF;
  FOREACH f IN ARRAY ARRAY['name', 'unit_type', 'kind', 'capacity', 'base_occupancy', 'child_age_limit',
                           'bedrooms', 'bathrooms', 'separate_toilets', 'max_adults', 'max_children', 'size_sqm'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(u) -> f THEN
      _diff := _diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(u) -> f, 'to', to_jsonb(n) -> f));
    END IF;
  END LOOP;
  IF n.description IS DISTINCT FROM u.description THEN
    _diff := _diff || jsonb_build_object('description', jsonb_build_object('changed', true));
  END IF;
  IF _beds IS NOT NULL THEN
    _d := hospitality._set_beds(_t, u.id, _beds);
    IF _d IS NOT NULL THEN _diff := _diff || jsonb_build_object('beds', _d); END IF;
  END IF;
  IF _amen IS NOT NULL THEN
    _d := hospitality._set_amenities(_t, u.property_id, u.id, _amen);
    IF _d IS NOT NULL THEN _diff := _diff || jsonb_build_object('amenities', _d); END IF;
  END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
  END IF;
  UPDATE hospitality.units x
     SET name = n.name, unit_type = n.unit_type, kind = n.kind, description = n.description,
         capacity = n.capacity, base_occupancy = n.base_occupancy, child_age_limit = n.child_age_limit,
         bedrooms = n.bedrooms, bathrooms = n.bathrooms, separate_toilets = n.separate_toilets,
         max_adults = n.max_adults, max_children = n.max_children, size_sqm = n.size_sqm,
         revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'catalog.unit_updated', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. האתר הציבורי (כמו במיגרציה 21, עם size_sqm)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._site_payload(_t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  _name text;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT COALESCE(NULLIF(btrim(s.business_name), ''), t.name) INTO _name FROM public.tenants t WHERE t.id = _t;
  RETURN jsonb_build_object(
    'business', jsonb_build_object(
      'name', _name, 'phone', s.contact_phone, 'whatsapp', s.whatsapp_phone, 'email', s.contact_email,
      'address', s.address, 'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
      'check_out_time', to_char(s.check_out_time, 'HH24:MI'), 'currency', s.currency, 'timezone', s.timezone,
      'booking_mode', s.booking_mode, 'approval_hours', round(COALESCE(s.approval_window_minutes, 720) / 60.0)),
    'today', (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date,
    -- אפשר לשלוח בקשה מהאתר: דגל ההזמנות + מנוי פעיל
    'booking_open', hospitality.flag_for('hospitality_booking_enabled', _t)
                    AND COALESCE((hospitality.entitlements(_t) ->> 'active')::boolean, false),
    'gallery', hospitality._public_media(_t, 'site', NULL, NULL),
    'policy', hospitality._public_policy(_t, NULL),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'slug', p.slug, 'name', p.name, 'property_type', p.property_type,
               'description', p.description, 'address', p.address,
               'location', CASE WHEN p.latitude IS NULL THEN NULL
                                ELSE jsonb_build_object('lat', p.latitude, 'lng', p.longitude) END,
               'parking', p.parking, 'parking_type', p.parking_type, 'parking_spaces', p.parking_spaces,
               'parking_fee_note', p.parking_fee_note, 'parking_instructions', p.parking_instructions,
               'guest_info', p.guest_info,
               'rules', jsonb_build_object('smoking', p.rules_smoking, 'pets', p.rules_pets,
                                           'pets_note', p.rules_pets_note, 'events', p.rules_events,
                                           'quiet_from', to_char(p.quiet_from, 'HH24:MI'),
                                           'quiet_to', to_char(p.quiet_to, 'HH24:MI'), 'custom', p.rules_custom),
               'amenities', hospitality._public_amenities(_t, p.id, NULL),
               'media', hospitality._public_media(_t, 'property', p.id, NULL)) ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p
       WHERE p.tenant_id = _t AND p.status = 'active'
         AND EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = p.id AND u.is_active)), '[]'::jsonb),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', u.id, 'slug', u.slug, 'name', u.name, 'property_id', u.property_id,
               'kind', u.kind, 'unit_type', u.unit_type, 'description', u.description,
               'capacity', u.capacity, 'base_occupancy', u.base_occupancy,
               'max_adults', u.max_adults, 'max_children', u.max_children, 'child_age_limit', u.child_age_limit,
               'seo_title', u.seo_title, 'seo_description', u.seo_description,
               'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'separate_toilets', u.separate_toilets, 'size_sqm', u.size_sqm,
               'base_price', u.base_price, 'min_nights', u.min_nights,
               'policy', CASE WHEN u.policy_id IS NULL THEN NULL ELSE hospitality._public_policy(_t, u.policy_id) END,
               'member_ids', (SELECT jsonb_agg(m.member_unit_id) FROM hospitality.unit_members m
                               WHERE m.tenant_id = _t AND m.parent_unit_id = u.id),
               'beds', COALESCE((SELECT jsonb_agg(jsonb_build_object('bed_type', b.bed_type, 'quantity', b.quantity,
                                                                     'room_label', b.room_label) ORDER BY b.sort_order)
                                   FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = u.id), '[]'::jsonb),
               'amenities', hospitality._public_amenities(_t, NULL, u.id),
               'media', hospitality._public_media(_t, 'unit', u.property_id, u.id)) ORDER BY p.sort_order, u.sort_order, u.created_at)
        FROM hospitality.units u
        JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
       WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality._site_payload(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

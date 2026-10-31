-- ============================================================
-- Hospitality Stage 2c.1 — מתחמים ויחידות (שכבת המסד)
--
-- מודל אחד לכל סוגי העסקים (צימר בודד, מתחם צימרים, דירות נופש, וילה, מלון
-- בוטיק) על הטבלאות הקיימות משלב 1c: אתר ← מתחמים ← יחידות (פיזיות: unit / room;
-- "כל המתחם": whole_property עם unit_members). אין שינוי במנוע ההזמנות.
--
--   1. הרשאה חדשה catalog.owner (בעלים בלבד): ארכיון ומחיקה לצמיתות. 13 הרשאות;
--      למנהל חסרות staff.managers, billing.manage, guests.privacy, settings.owner,
--      catalog.owner.
--   2. עמודות: properties.property_type, units.unit_type (תוויות בלבד — שום כלל לא
--      תלוי בהן), revision בשתי הטבלאות ("עודכן בינתיים").
--   3. אין כתיבה ישירה של הצוות ל-properties / units / unit_members — רק דרך
--      הפונקציות (קריאה נשארת עם RLS). מיטות ומתקנים — בשלב 2d.
--   4. פונקציות (DEFINER, אזור הניהול פעיל, הודעות בעברית, כל שינוי ביומן):
--      catalog_view, property_create / update / archive / delete, unit_create /
--      update / set_active / delete, whole_property_set, catalog_reorder.
--      נעילות (תמיד באותו סדר): הקטלוג של האתר → המלאי של האתר (hosp-inventory,
--      זו שכל הזמנה לוקחת) → מגבלת היחידות (הטריגר הקיים). שורות שרק מתעדכנות
--      נועלות FOR NO KEY UPDATE — לא מתנגש בבדיקת המפתח הזר של הזמנה / חסימה שנכתבת
--      באותו רגע (אחרת: deadlock). מחיקה (שחייבת נעילה מלאה) — NOWAIT אחרי מנעול
--      המלאי, והודעה "בשימוש ממש עכשיו" במקום להמתין.
--
-- Rollback: supabase/rollbacks/20261101180000_hosp_catalog.down.sql
-- אידמפוטנטית.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הרשאות: catalog.owner — בעלים בלבד
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                                  'settings.owner', 'catalog.owner')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. עמודות
-- ------------------------------------------------------------
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'other';
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'other';
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'properties_property_type_check') THEN
    ALTER TABLE hospitality.properties ADD CONSTRAINT properties_property_type_check
      CHECK (property_type IN ('zimmer', 'zimmer_complex', 'vacation_apartments', 'villa',
                               'boutique_hotel', 'guest_house', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'units_unit_type_check') THEN
    ALTER TABLE hospitality.units ADD CONSTRAINT units_unit_type_check
      CHECK (unit_type IN ('zimmer', 'suite', 'room', 'apartment', 'villa', 'cabin', 'studio', 'other'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. בלי כתיבה ישירה — רק דרך הפונקציות
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON hospitality.properties FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON hospitality.units FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON hospitality.unit_members FROM authenticated;

-- ------------------------------------------------------------
-- 4. עזרים פנימיים
-- ------------------------------------------------------------
-- טקסט מהקלט: null / מחרוזת; ריק = null; חובה; אורך
CREATE OR REPLACE FUNCTION hospitality._cv_text(_v jsonb, _label text, _max integer, _required boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN
    _s := NULL;
  ELSIF jsonb_typeof(_v) <> 'string' THEN
    RAISE EXCEPTION '% — ערך לא תקין', _label USING ERRCODE = 'check_violation';
  ELSE
    _s := NULLIF(btrim(_v #>> '{}'), '');
  END IF;
  IF _s IS NULL AND _required THEN
    RAISE EXCEPTION 'יש למלא את %', _label USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_s) > _max THEN
    RAISE EXCEPTION '% ארוך מדי (עד % תווים)', _label, _max USING ERRCODE = 'check_violation';
  END IF;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_text(jsonb, text, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._cv_int(_v jsonb, _label text, _min integer, _max integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)
     OR (_v #>> '{}')::numeric NOT BETWEEN _min AND _max THEN
    RAISE EXCEPTION '% חייב להיות מספר שלם בין % ל-%', _label, _min, _max USING ERRCODE = 'check_violation';
  END IF;
  RETURN (_v #>> '{}')::integer;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_int(jsonb, text, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._cv_choice(_v jsonb, _label text, _allowed text[])
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) <> 'string' OR NOT ((_v #>> '{}') = ANY (_allowed)) THEN
    RAISE EXCEPTION '% — יש לבחור מהרשימה', _label USING ERRCODE = 'check_violation';
  END IF;
  RETURN _v #>> '{}';
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_choice(jsonb, text, text[]) FROM PUBLIC, anon, authenticated;

-- האתר של המשתמש, הרשאת catalog (ובפעולות בעלים — catalog.owner), ומנעול הקטלוג של האתר
CREATE OR REPLACE FUNCTION hospitality._catalog_tenant(_owner_action text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
BEGIN
  IF _owner_action IS NOT NULL AND NOT hospitality.can('catalog.owner') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול %', _owner_action USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-catalog:' || _t::text, 0));
  RETURN _t;
END $$;
REVOKE ALL ON FUNCTION hospitality._catalog_tenant(text) FROM PUBLIC, anon, authenticated;

-- המנעול שכל הזמנה לוקחת (מיגרציה 4) — שינויים במבנה ההזמנה מחכים להזמנות שבדרך
CREATE OR REPLACE FUNCTION hospitality._inventory_lock(_t uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('hosp-inventory:' || _t::text, 0));
$$;
REVOKE ALL ON FUNCTION hospitality._inventory_lock(uuid) FROM PUBLIC, anon, authenticated;

-- כתובת קצרה מהשם (עברית מותרת), ייחודית באתר: "צימר הגפן" → "צימר-הגפן", "צימר-הגפן-2"…
CREATE OR REPLACE FUNCTION hospitality._catalog_slug(_t uuid, _table text, _name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _base text;
  _slug text;
  _n integer := 1;
  _taken boolean;
BEGIN
  _base := btrim(regexp_replace(lower(COALESCE(_name, '')), '[^a-z0-9א-ת]+', '-', 'g'), '-');
  _base := btrim(left(_base, 60), '-');
  IF _base = '' THEN
    _base := CASE _table WHEN 'properties' THEN 'property' ELSE 'unit' END;
  END IF;
  LOOP
    _slug := CASE WHEN _n = 1 THEN _base ELSE _base || '-' || _n END;
    IF _table = 'properties' THEN
      SELECT EXISTS (SELECT 1 FROM hospitality.properties p WHERE p.tenant_id = _t AND p.slug = _slug) INTO _taken;
    ELSE
      SELECT EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.slug = _slug) INTO _taken;
    END IF;
    EXIT WHEN NOT _taken;
    _n := _n + 1;
  END LOOP;
  RETURN _slug;
END $$;
REVOKE ALL ON FUNCTION hospitality._catalog_slug(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- יחידה שהוזמנה / נחסמה אי פעם (גם בעבר) — לא נמחקת, רק מושבתת
CREATE OR REPLACE FUNCTION hospitality._unit_has_history(_t uuid, _unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.unit_id = _unit)
      OR EXISTS (SELECT 1 FROM hospitality.blocks k WHERE k.tenant_id = _t AND k.unit_id = _unit)
      OR EXISTS (SELECT 1 FROM hospitality.unit_occupancy o WHERE o.tenant_id = _t AND o.unit_id = _unit);
$$;
REVOKE ALL ON FUNCTION hospitality._unit_has_history(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- הזמנה / חסימה שעדיין לפני סופה (הלילה האחרון אחרי היום)
CREATE OR REPLACE FUNCTION hospitality._unit_has_future(_t uuid, _unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.unit_occupancy o
                  WHERE o.tenant_id = _t AND o.unit_id = _unit AND upper(o.nights) > current_date);
$$;
REVOKE ALL ON FUNCTION hospitality._unit_has_future(uuid, uuid) FROM PUBLIC, anon, authenticated;

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

-- נכנס ל"כל המתחם" פעיל?
CREATE OR REPLACE FUNCTION hospitality._unit_in_active_whole(_t uuid, _unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.unit_members m
                   JOIN hospitality.units w ON w.tenant_id = m.tenant_id AND w.id = m.parent_unit_id
                  WHERE m.tenant_id = _t AND m.member_unit_id = _unit AND w.is_active);
$$;
REVOKE ALL ON FUNCTION hospitality._unit_in_active_whole(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. קריאה: כל המתחמים והיחידות (גם לא פעילים / בארכיון), המגבלה והרשאת הבעלים
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 6. מתחמים
-- ------------------------------------------------------------
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

-- ארכיון (בעלים): המתחם והיחידות שלו יוצאים מהשימוש (מפנים מקומות בחבילה); הזמנות עבר נשמרות
CREATE OR REPLACE FUNCTION hospitality.property_archive(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant('להעביר מתחם לארכיון');
  p hospitality.properties;
  _units integer;
BEGIN
  PERFORM hospitality._inventory_lock(_t);
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status = 'archived' THEN
    RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.units u
              WHERE u.tenant_id = _t AND u.property_id = _id AND hospitality._unit_has_future(_t, u.id)) THEN
    RAISE EXCEPTION 'יש במתחם הזמנות או חסימות עתידיות — אי אפשר להעביר אותו לארכיון'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.units u SET is_active = false, revision = u.revision + 1
   WHERE u.tenant_id = _t AND u.property_id = _id AND u.is_active;
  GET DIAGNOSTICS _units = ROW_COUNT;
  UPDATE hospitality.properties x SET status = 'archived', revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id RETURNING * INTO p;
  PERFORM hospitality._audit(_t, 'catalog.property_archived', p.name, jsonb_build_object('units_deactivated', _units));
  RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_archive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_archive(uuid) TO authenticated, service_role;

-- מחיקה לצמיתות (בעלים): רק מתחם שאף יחידה בו לא הוזמנה / נחסמה אי פעם
CREATE OR REPLACE FUNCTION hospitality.property_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant('למחוק מתחם');
  p hospitality.properties;
BEGIN
  PERFORM hospitality._inventory_lock(_t);
  BEGIN
    SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE NOWAIT;
    PERFORM 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = _id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'המתחם בשימוש ממש עכשיו (הזמנה או חסימה נכתבת) — נסו שוב בעוד רגע' USING ERRCODE = 'lock_not_available';
  END;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.units u
              WHERE u.tenant_id = _t AND u.property_id = _id AND hospitality._unit_has_history(_t, u.id)) THEN
    RAISE EXCEPTION 'במתחם יש יחידות עם הזמנות או חסימות — אפשר להעביר אותו לארכיון במקום למחוק'
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.property_deleted', p.name, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.property_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_delete(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. יחידות
-- ------------------------------------------------------------
-- שדות היחידה מהקלט (יצירה: ברירות מחדל; עדכון: רק מה שנשלח)
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

-- הפעלה / השבתה. השבתה שומרת על ההזמנות הקיימות; הפעלה — לפי מגבלת החבילה (הטריגר הקיים)
CREATE OR REPLACE FUNCTION hospitality.unit_set_active(_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  u hospitality.units;
  _status text;
BEGIN
  IF _active IS NULL THEN
    RAISE EXCEPTION 'חסר מצב היחידה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._inventory_lock(_t);
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF u.is_active = _active THEN
    RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
  END IF;
  SELECT p.status INTO _status FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = u.property_id;
  IF _active AND _status = 'archived' THEN
    RAISE EXCEPTION 'המתחם בארכיון — יש להחזיר אותו מהארכיון קודם' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT _active AND u.kind <> 'whole_property' AND hospitality._unit_in_active_whole(_t, _id) THEN
    RAISE EXCEPTION 'היחידה כלולה ב"כל המתחם" הפעיל — יש להשבית את "כל המתחם" או להסיר ממנו את היחידה קודם'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _active AND u.kind = 'whole_property' AND (
       SELECT count(*) FROM hospitality.unit_members m
         JOIN hospitality.units mu ON mu.tenant_id = m.tenant_id AND mu.id = m.member_unit_id AND mu.is_active
        WHERE m.tenant_id = _t AND m.parent_unit_id = _id) < 2 THEN
    RAISE EXCEPTION 'ל"כל המתחם" צריך לפחות שתי יחידות פעילות' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.units x SET is_active = _active, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id RETURNING * INTO u;
  PERFORM hospitality._audit(_t, CASE WHEN _active THEN 'catalog.unit_activated' ELSE 'catalog.unit_deactivated' END,
                             u.name, '{}'::jsonb);
  RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_set_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_set_active(uuid, boolean) TO authenticated, service_role;

-- מחיקה לצמיתות (בעלים): רק יחידה שלא הוזמנה / נחסמה אי פעם ושאינה חלק מ"כל המתחם"
CREATE OR REPLACE FUNCTION hospitality.unit_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant('למחוק יחידה');
  u hospitality.units;
BEGIN
  PERFORM hospitality._inventory_lock(_t);
  BEGIN
    SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'היחידה בשימוש ממש עכשיו (הזמנה או חסימה נכתבת) — נסו שוב בעוד רגע' USING ERRCODE = 'lock_not_available';
  END;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF hospitality._unit_has_history(_t, _id) THEN
    RAISE EXCEPTION 'ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.unit_members m WHERE m.tenant_id = _t AND m.member_unit_id = _id) THEN
    RAISE EXCEPTION 'היחידה כלולה ב"כל המתחם" — יש להסיר אותה משם קודם' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.unit_deleted', u.name, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_delete(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8. "השכרת המתחם כולו"
-- ------------------------------------------------------------
-- הפעלה: יוצר / מעדכן את יחידת "כל המתחם" עם היחידות שבחרו (לפחות שתיים, פעילות, מאותו
-- מתחם). שינוי היחידות כשיש ל"כל המתחם" הזמנות / חסימות עתידיות — נחסם (הטריגר הקיים).
-- כיבוי: "כל המתחם" מושבת (ההזמנות הקיימות נשמרות).
CREATE OR REPLACE FUNCTION hospitality.whole_property_set(_property_id uuid, _enabled boolean, _member_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  p hospitality.properties;
  w hospitality.units;
  _members uuid[];
  _valid integer;
  _current uuid[];
BEGIN
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'חסר מצב "השכרת המתחם כולו"' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._inventory_lock(_t);
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status = 'archived' THEN
    RAISE EXCEPTION 'המתחם בארכיון' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO w FROM hospitality.units x
   WHERE x.tenant_id = _t AND x.property_id = _property_id AND x.kind = 'whole_property'
   ORDER BY x.created_at LIMIT 1 FOR NO KEY UPDATE;

  IF NOT _enabled THEN
    IF w.id IS NOT NULL AND w.is_active THEN
      UPDATE hospitality.units x SET is_active = false, revision = x.revision + 1
       WHERE x.tenant_id = _t AND x.id = w.id RETURNING * INTO w;
      PERFORM hospitality._audit(_t, 'catalog.whole_property_disabled', p.name, '{}'::jsonb);
    END IF;
    RETURN jsonb_build_object('id', w.id, 'revision', w.revision);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT m ORDER BY m), '{}') INTO _members FROM unnest(COALESCE(_member_ids, '{}')) m;
  SELECT count(*) INTO _valid FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.property_id = _property_id AND u.id = ANY (_members)
     AND u.kind IN ('unit', 'room') AND u.is_active;
  IF cardinality(_members) < 2 OR _valid <> cardinality(_members) THEN
    RAISE EXCEPTION 'יש לבחור לפחות שתי יחידות פעילות מהמתחם' USING ERRCODE = 'check_violation';
  END IF;

  IF w.id IS NULL THEN
    INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, capacity, base_occupancy,
                                   bedrooms, bathrooms, is_active, sort_order)
    SELECT _t, _property_id, 'whole_property', 'other', left('כל המתחם — ' || p.name, 120),
           hospitality._catalog_slug(_t, 'units', 'כל המתחם ' || p.name),
           LEAST(100, sum(u.capacity)), LEAST(LEAST(100, sum(u.capacity)), sum(u.base_occupancy)),
           LEAST(50, sum(u.bedrooms)), LEAST(50, sum(u.bathrooms)), true, 1000
      FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_members)
    RETURNING * INTO w;
    INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id)
    SELECT _t, w.id, m FROM unnest(_members) m;
    PERFORM hospitality._audit(_t, 'catalog.whole_property_enabled', p.name,
                               jsonb_build_object('units', cardinality(_members)));
    RETURN jsonb_build_object('id', w.id, 'revision', w.revision);
  END IF;

  SELECT COALESCE(array_agg(m.member_unit_id ORDER BY m.member_unit_id), '{}') INTO _current
    FROM hospitality.unit_members m WHERE m.tenant_id = _t AND m.parent_unit_id = w.id;
  IF _current IS DISTINCT FROM _members THEN
    -- עתידיות ל"כל המתחם" → הטריגר unit_members_occupancy_guard עוצר עם הודעה בעברית
    DELETE FROM hospitality.unit_members m
     WHERE m.tenant_id = _t AND m.parent_unit_id = w.id AND NOT (m.member_unit_id = ANY (_members));
    INSERT INTO hospitality.unit_members (tenant_id, parent_unit_id, member_unit_id)
    SELECT _t, w.id, m FROM unnest(_members) m
     WHERE NOT (m = ANY (_current));
  END IF;
  IF _current IS DISTINCT FROM _members OR NOT w.is_active THEN
    UPDATE hospitality.units x SET is_active = true, revision = x.revision + 1
     WHERE x.tenant_id = _t AND x.id = w.id RETURNING * INTO w;
    PERFORM hospitality._audit(_t, 'catalog.whole_property_enabled', p.name,
                               jsonb_build_object('units', cardinality(_members)));
  END IF;
  RETURN jsonb_build_object('id', w.id, 'revision', w.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.whole_property_set(uuid, boolean, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.whole_property_set(uuid, boolean, uuid[]) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 9. סדר התצוגה — בטרנזקציה אחת
-- ------------------------------------------------------------
-- 'properties': מתחמים של האתר; 'units': יחידות של מתחם אחד. הסדר אינו "תוכן" — לא משנה revision.
CREATE OR REPLACE FUNCTION hospitality.catalog_reorder(_kind text, _ids uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  _n integer := cardinality(COALESCE(_ids, '{}'));
  _found integer;
  _props integer;
BEGIN
  IF _n = 0 OR _n > 500 OR (SELECT count(DISTINCT x) FROM unnest(_ids) x) <> _n THEN
    RAISE EXCEPTION 'רשימת הסדר לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'properties' THEN
    SELECT count(*) INTO _found FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = ANY (_ids);
    IF _found <> _n THEN
      RAISE EXCEPTION 'מתחם לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE hospitality.properties p SET sort_order = o.ord - 1
      FROM unnest(_ids) WITH ORDINALITY AS o(id, ord)
     WHERE p.tenant_id = _t AND p.id = o.id;
    -- מה שלא ברשימה (למשל נוסף בינתיים) — אחריה, באותו סדר; כל מקום פעם אחת
    UPDATE hospitality.properties p SET sort_order = _n + r.rn - 1
      FROM (SELECT x.id, row_number() OVER (ORDER BY x.sort_order, x.created_at, x.id) AS rn
              FROM hospitality.properties x WHERE x.tenant_id = _t AND NOT (x.id = ANY (_ids))) r
     WHERE p.tenant_id = _t AND p.id = r.id;
  ELSIF _kind = 'units' THEN
    SELECT count(*), count(DISTINCT u.property_id) INTO _found, _props
      FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = ANY (_ids) AND u.kind <> 'whole_property';
    IF _found <> _n THEN
      RAISE EXCEPTION 'יחידה לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    IF _props <> 1 THEN
      RAISE EXCEPTION 'אפשר לסדר רק יחידות של מתחם אחד בכל פעם' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE hospitality.units u SET sort_order = o.ord - 1
      FROM unnest(_ids) WITH ORDINALITY AS o(id, ord)
     WHERE u.tenant_id = _t AND u.id = o.id;
    UPDATE hospitality.units u SET sort_order = _n + r.rn - 1
      FROM (SELECT x.id, row_number() OVER (ORDER BY x.sort_order, x.created_at, x.id) AS rn
              FROM hospitality.units x
             WHERE x.tenant_id = _t AND x.kind <> 'whole_property' AND NOT (x.id = ANY (_ids))
               AND x.property_id = (SELECT y.property_id FROM hospitality.units y WHERE y.tenant_id = _t AND y.id = _ids[1])) r
     WHERE u.tenant_id = _t AND u.id = r.id;
  ELSE
    RAISE EXCEPTION 'סוג הרשימה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._audit(_t, 'catalog.reordered', NULL, jsonb_build_object('kind', _kind, 'items', _n));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.catalog_reorder(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.catalog_reorder(text, uuid[]) TO authenticated, service_role;

COMMIT;

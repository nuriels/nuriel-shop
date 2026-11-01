-- ============================================================
-- Hospitality RT — סוגי חדרים למלונות (D24; העיצוב שנסגר ב-stage-1-plan A4)
--
--   • unit_categories — סוג חדר (שם, תיאור, סדר) בתוך מתחם; units.category_id (לא חובה —
--     צימרים, וילות ודירות בלי סוג, כמו היום). רק יחידה רגילה (לא "כל המתחם"), ורק מאותו מתחם
--     (מפתח זר משולב);
--   • כל הזמנה נשארת על חדר פיזי אחד (bookings.unit_id) — ה-EXCLUDE ממשיך להגן על כל חדר,
--     ושום פונקציה קיימת לא משתנה. העברה לחדר אחר — "שינוי הזמנה" הקיים (modify_booking);
--   • מכירה לפי סוג: quote_type / request_booking_type בוחרים חדר פנוי מהסוג באותה טרנזקציה
--     ובאותה נעילה (החדר מההצעה קודם, ואחר כך לפי הסדר), ואז request_booking הרגיל;
--     public_type_availability — לילות שבהם אין אף חדר פנוי מהסוג;
--   • לצוות (catalog): room_types_view, room_type_save, room_type_delete (רק בלי חדרים),
--     room_type_assign (שיוך חדר לסוג), room_type_apply (מחיר / תפוסה / מינימום לילות לכל החדרים).
-- המחיר נשאר ברמת החדר (כמו היום); "החלה על כל החדרים" שומרת על אחידות בתוך סוג.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hospitality.unit_categories (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  slug        text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 70),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  sort_order  integer NOT NULL DEFAULT 0,
  revision    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, property_id, id),
  UNIQUE (tenant_id, slug),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.unit_categories IS
  'Hospitality: סוגי חדרים (מלונות) — סוג → כמה חדרים פיזיים; ההזמנה תמיד על חדר אחד. רק דרך פונקציות';
ALTER TABLE hospitality.unit_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.unit_categories FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.unit_categories;
CREATE POLICY tenant_isolation ON hospitality.unit_categories AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.unit_categories;
CREATE POLICY backend_enabled ON hospitality.unit_categories AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.unit_categories;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.unit_categories
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- החדר → הסוג שלו (באותו מתחם); בלי סוג = כמו היום
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS category_id uuid;
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_category_fk;
ALTER TABLE hospitality.units ADD CONSTRAINT units_category_fk
  FOREIGN KEY (tenant_id, property_id, category_id)
  REFERENCES hospitality.unit_categories (tenant_id, property_id, id);
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_category_kind;
ALTER TABLE hospitality.units ADD CONSTRAINT units_category_kind
  CHECK (category_id IS NULL OR kind <> 'whole_property');
CREATE INDEX IF NOT EXISTS units_category_idx ON hospitality.units (tenant_id, category_id) WHERE category_id IS NOT NULL;

-- ------------------------------------------------------------
-- הנתונים של סוגי החדרים (לאתר ולצוות)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._room_types_payload(_t uuid, _public boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(row ORDER BY ps, cs, cc), '[]'::jsonb) FROM (
    SELECT p.sort_order AS ps, c.sort_order AS cs, c.created_at AS cc,
           jsonb_build_object(
             'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description,
             'property_id', c.property_id, 'sort_order', c.sort_order, 'revision', c.revision,
             'room_ids', COALESCE((SELECT jsonb_agg(u.id ORDER BY u.sort_order, u.created_at)
                                     FROM hospitality.units u
                                    WHERE u.tenant_id = _t AND u.category_id = c.id
                                      AND (NOT _public OR u.is_active)), '[]'::jsonb)) AS row
      FROM hospitality.unit_categories c
      JOIN hospitality.properties p ON p.tenant_id = c.tenant_id AND p.id = c.property_id
     WHERE c.tenant_id = _t
       AND (NOT _public OR (p.status = 'active' AND EXISTS (
              SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.category_id = c.id AND u.is_active)))
  ) q;
$$;
REVOKE ALL ON FUNCTION hospitality._room_types_payload(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.public_room_types()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality._room_types_payload(hospitality._public_site_tenant(), true);
END $$;
REVOKE ALL ON FUNCTION hospitality.public_room_types() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_room_types() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.room_types_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality._room_types_payload(hospitality._manage_tenant('catalog'), false);
END $$;
REVOKE ALL ON FUNCTION hospitality.room_types_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.room_types_view() TO authenticated, service_role;

-- ------------------------------------------------------------
-- ניהול הסוגים (catalog)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._room_type_slug(_t uuid, _name text, _except uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _base text := btrim(left(btrim(regexp_replace(lower(COALESCE(_name, '')), '[^a-z0-9א-ת]+', '-', 'g'), '-'), 60), '-');
  _slug text;
  _n integer := 1;
BEGIN
  IF _base = '' THEN _base := 'room-type'; END IF;
  LOOP
    _slug := CASE WHEN _n = 1 THEN _base ELSE _base || '-' || _n END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hospitality.unit_categories c
                           WHERE c.tenant_id = _t AND c.slug = _slug AND c.id IS DISTINCT FROM _except);
    _n := _n + 1;
  END LOOP;
  RETURN _slug;
END $$;
REVOKE ALL ON FUNCTION hospitality._room_type_slug(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- חדש (_id NULL) או עדכון (עם הגרסה שהמסך מכיר)
CREATE OR REPLACE FUNCTION hospitality.room_type_save(_id uuid, _property_id uuid, _name text,
                                                      _description text DEFAULT NULL,
                                                      _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(btrim(COALESCE(_description, '')), '');
  c hospitality.unit_categories;
BEGIN
  IF char_length(_n) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'שם הסוג — בין 2 ל-80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND char_length(_d) > 4000 THEN
    RAISE EXCEPTION 'התיאור ארוך מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = _property_id AND p.status <> 'archived') THEN
      RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    INSERT INTO hospitality.unit_categories (tenant_id, property_id, name, slug, description, sort_order)
    VALUES (_t, _property_id, _n, hospitality._room_type_slug(_t, _n, NULL), _d,
            COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.unit_categories x WHERE x.tenant_id = _t), 0))
    RETURNING * INTO c;
    PERFORM hospitality._audit(_t, 'room_types.created', c.name, '{}'::jsonb);
  ELSE
    SELECT * INTO c FROM hospitality.unit_categories x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF c.id IS NULL THEN
      RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    IF _expected_revision IS NOT NULL AND c.revision <> _expected_revision THEN
      RAISE EXCEPTION 'סוג החדר השתנה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.unit_categories x
       SET name = _n, description = _d, revision = x.revision + 1, updated_at = now(),
           slug = CASE WHEN x.name = _n THEN x.slug ELSE hospitality._room_type_slug(_t, _n, x.id) END
     WHERE x.id = c.id
    RETURNING * INTO c;
    PERFORM hospitality._audit(_t, 'room_types.updated', c.name, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('id', c.id, 'slug', c.slug, 'revision', c.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.room_type_save(uuid, uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.room_type_save(uuid, uuid, text, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.room_type_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  c hospitality.unit_categories;
BEGIN
  SELECT * INTO c FROM hospitality.unit_categories x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.category_id = _id) THEN
    RAISE EXCEPTION 'יש חדרים מהסוג הזה — הוציאו אותם מהסוג קודם' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM hospitality.unit_categories x WHERE x.id = c.id;
  PERFORM hospitality._audit(_t, 'room_types.deleted', c.name, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.room_type_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.room_type_delete(uuid) TO authenticated, service_role;

-- שיוך חדר לסוג (NULL — בלי סוג). רק יחידה רגילה, ורק מאותו מתחם.
CREATE OR REPLACE FUNCTION hospitality.room_type_assign(_unit_id uuid, _category_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  u hospitality.units;
  c hospitality.unit_categories;
BEGIN
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id FOR UPDATE;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _category_id IS NOT NULL THEN
    SELECT * INTO c FROM hospitality.unit_categories x WHERE x.tenant_id = _t AND x.id = _category_id;
    IF c.id IS NULL THEN
      RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    IF u.kind = 'whole_property' THEN
      RAISE EXCEPTION '"כל המתחם" לא משויך לסוג חדר' USING ERRCODE = 'check_violation';
    END IF;
    IF c.property_id <> u.property_id THEN
      RAISE EXCEPTION 'החדר וסוג החדר צריכים להיות באותו מתחם' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF u.category_id IS NOT DISTINCT FROM _category_id THEN
    RETURN jsonb_build_object('id', u.id, 'category_id', u.category_id, 'revision', u.revision);
  END IF;
  UPDATE hospitality.units x SET category_id = _category_id, revision = x.revision + 1, updated_at = now()
   WHERE x.id = u.id RETURNING * INTO u;
  PERFORM hospitality._audit(_t, 'room_types.assigned', u.name,
                             jsonb_build_object('room_type', COALESCE(c.name, '—')));
  RETURN jsonb_build_object('id', u.id, 'category_id', u.category_id, 'revision', u.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.room_type_assign(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.room_type_assign(uuid, uuid) TO authenticated, service_role;

-- החלה על כל החדרים של הסוג (רק השדות שנשלחו). מחיר, תפוסה ומינימום לילות נשארים ברמת החדר.
CREATE OR REPLACE FUNCTION hospitality.room_type_apply(_id uuid, _base_price numeric DEFAULT NULL,
                                                       _min_nights integer DEFAULT NULL,
                                                       _capacity integer DEFAULT NULL,
                                                       _base_occupancy integer DEFAULT NULL,
                                                       _max_adults integer DEFAULT NULL,
                                                       _max_children integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  c hospitality.unit_categories;
  _n integer;
BEGIN
  SELECT * INTO c FROM hospitality.unit_categories x WHERE x.tenant_id = _t AND x.id = _id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _base_price IS NOT NULL AND (_base_price < 0 OR _base_price > 1000000) THEN
    RAISE EXCEPTION 'המחיר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _min_nights IS NOT NULL AND _min_nights NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'מינימום לילות — בין 1 ל-60' USING ERRCODE = 'check_violation';
  END IF;
  IF _capacity IS NOT NULL AND _capacity NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'מספר האורחים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    UPDATE hospitality.units x
       SET base_price = COALESCE(_base_price, x.base_price),
           min_nights = COALESCE(_min_nights, x.min_nights),
           capacity = COALESCE(_capacity, x.capacity),
           base_occupancy = LEAST(COALESCE(_base_occupancy, x.base_occupancy), COALESCE(_capacity, x.capacity)),
           max_adults = COALESCE(_max_adults, x.max_adults),
           max_children = COALESCE(_max_children, x.max_children),
           revision = x.revision + 1, updated_at = now()
     WHERE x.tenant_id = _t AND x.category_id = _id;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'הערכים לא מתאימים לחדרים (למשל מבוגרים / ילדים מעל מספר האורחים)' USING ERRCODE = 'check_violation';
  END;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM hospitality._audit(_t, 'room_types.applied', c.name, jsonb_build_object('rooms', _n));
  RETURN jsonb_build_object('rooms', _n);
END $$;
REVOKE ALL ON FUNCTION hospitality.room_type_apply(uuid, numeric, integer, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.room_type_apply(uuid, numeric, integer, integer, integer, integer, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- מכירה לפי סוג (אורחים)
-- ------------------------------------------------------------
-- החדרים הפעילים של הסוג: החדר המועדף קודם, ואחר כך לפי הסדר
CREATE OR REPLACE FUNCTION hospitality._type_rooms(_t uuid, _category_id uuid, _preferred uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(u.id ORDER BY (u.id = _preferred) DESC, u.sort_order, u.created_at), '{}')
    FROM hospitality.units u
    JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
   WHERE u.tenant_id = _t AND u.category_id = _category_id AND u.is_active AND p.status = 'active';
$$;
REVOKE ALL ON FUNCTION hospitality._type_rooms(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- לילות שבהם אף חדר מהסוג לא פנוי (בלי מי / למה), עד 120 ימים
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
    'busy', COALESCE((
      SELECT jsonb_agg(n.night ORDER BY n.night)
        FROM (SELECT d::date AS night FROM generate_series(_from, _to - 1, interval '1 day') d) n
       WHERE (SELECT count(DISTINCT o.unit_id)
                FROM hospitality.unit_occupancy o
                LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
               WHERE o.tenant_id = _t AND o.unit_id = ANY (_rooms) AND o.nights @> n.night
                 AND (o.booking_id IS NULL
                      OR NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())))
             >= cardinality(_rooms)), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_type_availability(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_type_availability(uuid, date, date) TO anon, authenticated, service_role;

-- הצעת מחיר לסוג: החדר הראשון שפנוי לכל הלילות (המועדף קודם). אין — ההצעה של החדר הראשון
-- עם available = false. ההצעה מחזירה גם את החדר (unit_id) ואת הסוג (category_id).
CREATE OR REPLACE FUNCTION hospitality.quote_type(_category_id uuid, _check_in date, _check_out date,
                                                  _adults integer DEFAULT 2, _children integer DEFAULT 0,
                                                  _promo_code text DEFAULT NULL, _preferred_unit uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _rooms uuid[];
  _room uuid;
  _q jsonb;
  _first jsonb;
BEGIN
  _rooms := hospitality._type_rooms(_t, _category_id, _preferred_unit);
  IF cardinality(_rooms) = 0 THEN
    RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  FOREACH _room IN ARRAY _rooms LOOP
    _q := hospitality._quote(_t, _room, _check_in, _check_out, _adults, _children, _promo_code, true);
    IF (_q ->> 'available')::boolean THEN
      RETURN _q || jsonb_build_object('category_id', _category_id);
    END IF;
    _first := COALESCE(_first, _q);
  END LOOP;
  RETURN _first || jsonb_build_object('category_id', _category_id);
END $$;
REVOKE ALL ON FUNCTION hospitality.quote_type(uuid, date, date, integer, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.quote_type(uuid, date, date, integer, integer, text, uuid) TO anon, authenticated;

-- בקשת הזמנה לסוג: בנעילת המלאי של העסק — חדר פנוי מהסוג שהתנאים שלו הם אלה שהאורח אישר
-- (policy_hash), ואז request_booking הרגיל לחדר הזה (באותה טרנזקציה — בלי מרוץ).
CREATE OR REPLACE FUNCTION hospitality.request_booking_type(
  _category_id uuid, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text,
  _adults integer DEFAULT 2, _children integer DEFAULT 0, _special_requests text DEFAULT NULL,
  _promo_code text DEFAULT NULL, _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he',
  _preferred_unit uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _rooms uuid[];
  _room uuid;
  _pick uuid;
  _any boolean := false;
  _q jsonb;
BEGIN
  -- חזרה על אותה בקשה (אותו מזהה) — request_booking מחזיר את הקיימת
  IF EXISTS (SELECT 1 FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key) THEN
    SELECT x.unit_id INTO _pick FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key;
  ELSE
    PERFORM hospitality._lock_inventory(_t);
    PERFORM hospitality._expire_due(_t);
    _rooms := hospitality._type_rooms(_t, _category_id, _preferred_unit);
    IF cardinality(_rooms) = 0 THEN
      RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    FOREACH _room IN ARRAY _rooms LOOP
      _q := hospitality._quote(_t, _room, _check_in, _check_out, _adults, _children, _promo_code, true);
      IF (_q ->> 'available')::boolean THEN
        _any := true;
        IF _q ->> 'policy_hash' = _policy_hash THEN
          _pick := _room;
          EXIT;
        END IF;
      END IF;
    END LOOP;
    IF _pick IS NULL THEN
      IF _any THEN
        RAISE EXCEPTION 'תנאי ההזמנה השתנו — נא לעיין בהם שוב ולאשר' USING ERRCODE = 'check_violation';
      END IF;
      RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
    END IF;
  END IF;
  RETURN hospitality.request_booking(_pick, _check_in, _check_out, _full_name, _email, _phone,
                                     _idempotency_key, _policy_accepted, _policy_hash, _adults, _children,
                                     _special_requests, _promo_code, _marketing_consent, _language);
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_type(uuid, date, date, text, text, text, text, boolean, text,
  integer, integer, text, text, boolean, text, uuid) TO anon, authenticated;

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 202: חדרים נוספים לחבילה (חבילת כלה — docs/hospitality/bridal-package-spec.md, סעיף 4)
--
-- חבילה (מיגרציה 59) היא יחידה אחת במחיר קבוע. עכשיו בעל העסק יכול לאפשר לאורח להוסיף לחבילה חדרים נוספים
-- (למשל חדר למלוות / למשפחה של הכלה) — רק יחידות שבחר מראש, במחיר קבוע ללילה לחדר, לאותם לילות בדיוק,
-- ורק כשהם פנויים. הכול בהזמנה אחת: החבילה וכל החדרים נתפסים יחד או אף אחד.
--   1. packages.addon_unit_ids / addon_nightly_price / addon_max — אילו יחידות, המחיר ללילה לחדר, וכמה
--      לכל היותר. ריק — החבילה מתנהגת בדיוק כמו היום.
--   2. package_save — אותם פרמטרים + _addons (jsonb, לא חובה). _addons ריק (NULL) = בלי שינוי בחדרים
--      הנוספים, כך שגם האפליקציה הקודמת (בלי הפרמטר) שומרת חבילה בלי למחוק אותם.
--   3. package_addons_quote — לאתר (שרת האתר בלבד): החדרים המותרים שפנויים ופתוחים בכל לילות החבילה.
--   4. package_rooms_quote — לאתר (שרת האתר בלבד): הצעה אחת לחבילה + החדרים שנבחרו; המחיר מחושב במסד:
--      מחיר החבילה + (מחיר ללילה × לילות) לכל חדר. החדרים הנוספים — באותה מדיניות ביטול של החבילה (המקדמה
--      לכל הזמנה לפי הסכום שלה). האורח מאשר hash אחד לכל התנאים.
--   5. request_booking_package_with_rooms (+ _with_documents) — טרנזקציה אחת: החבילה (כמו
--      request_booking_package) + הזמנה לכל חדר נוסף באותם תאריכים, אותו group_id (אישור / דחייה של הכול —
--      booking_group_decide הקיימת, מייל אחד), package_id + צילום החבילה עם "role": "addon" בכל חדר.
--      חדר שנתפס בין ההצעה לשליחה — שום הזמנה לא נשמרת (לא מורידים חדר בשקט).
--   6. _package_json / packages_view / _enqueue / _guest_view — + החדרים הנוספים (בניהול ובאתר), סוג
--      היחידה לבחירה בניהול, ו"חדר נוסף" במיילים ובעמודי האורח.
-- לא משתנים: request_booking, request_booking_package, request_booking_group, _quote, _package_quote, ה-EXCLUDE.
-- בלי שינוי בנתונים קיימים: שלוש עמודות חדשות עם ברירת מחדל ריקה. אידמפוטנטי.
-- Rollback: supabase/rollbacks/20261121100000_hosp_package_addon_rooms.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. העמודות
-- ------------------------------------------------------------
ALTER TABLE hospitality.packages ADD COLUMN IF NOT EXISTS addon_unit_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
ALTER TABLE hospitality.packages ADD COLUMN IF NOT EXISTS addon_nightly_price numeric(12,2);
ALTER TABLE hospitality.packages ADD COLUMN IF NOT EXISTS addon_max integer NOT NULL DEFAULT 0;
ALTER TABLE hospitality.packages DROP CONSTRAINT IF EXISTS packages_addons_check;
-- עד 8 יחידות, בלי ריק ובלי היחידה של החבילה; בלי יחידות — בלי מחיר ובלי מקסימום; עם יחידות — מחיר ו-1..N חדרים
ALTER TABLE hospitality.packages ADD CONSTRAINT packages_addons_check CHECK (
  cardinality(addon_unit_ids) <= 8
  AND array_position(addon_unit_ids, NULL) IS NULL
  AND NOT (unit_id = ANY (addon_unit_ids))
  AND (addon_nightly_price IS NULL OR (addon_nightly_price > 0 AND addon_nightly_price <= 100000))
  AND ((cardinality(addon_unit_ids) = 0 AND addon_nightly_price IS NULL AND addon_max = 0)
       OR (cardinality(addon_unit_ids) > 0 AND addon_nightly_price IS NOT NULL
           AND addon_max BETWEEN 1 AND cardinality(addon_unit_ids))));
COMMENT ON COLUMN hospitality.packages.addon_unit_ids IS
  'מיגרציה 202: יחידות שאפשר להוסיף לחבילה כחדר נוסף (באותם לילות, רק כשפנויות). ריק — בלי חדרים נוספים';
COMMENT ON COLUMN hospitality.packages.addon_nightly_price IS
  'מיגרציה 202: מחיר קבוע ללילה לכל חדר נוסף (לא מהתעריפים)';
COMMENT ON COLUMN hospitality.packages.addon_max IS
  'מיגרציה 202: כמה חדרים נוספים לכל היותר בהזמנה אחת';

-- ------------------------------------------------------------
-- 2. הנתונים של החבילה (ניהול ואתר)
-- ------------------------------------------------------------
-- יחידה שאפשר להציע כחדר נוסף: של העסק, לא היחידה של החבילה, לא "כל המתחם" ולא חדר מלון לפי סוג
-- (כמו בבקשה לכמה חדרים — מיגרציה 44)
CREATE OR REPLACE FUNCTION hospitality._package_addon_unit_ok(_t uuid, _unit_id uuid, _package_unit uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.units u
                  WHERE u.tenant_id = _t AND u.id = _unit_id AND u.id IS DISTINCT FROM _package_unit
                    AND u.kind <> 'whole_property' AND u.category_id IS NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._package_addon_unit_ok(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- לצוות: מה שנשמר. לאתר: רק יחידות פעילות במתחם פעיל (בסדר שנבחר); בלי כאלה — אין חדרים נוספים
CREATE OR REPLACE FUNCTION hospitality._package_addons_json(_t uuid, p hospitality.packages, _staff boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN cardinality(p.addon_unit_ids) = 0 OR p.addon_nightly_price IS NULL THEN NULL
    WHEN _staff THEN jsonb_build_object('unit_ids', to_jsonb(p.addon_unit_ids),
                                        'nightly_price', p.addon_nightly_price, 'max', p.addon_max)
    ELSE (SELECT CASE WHEN count(*) = 0 THEN NULL
                      ELSE jsonb_build_object('unit_ids', jsonb_agg(x.id ORDER BY x.ord),
                                              'nightly_price', p.addon_nightly_price,
                                              'max', least(p.addon_max, count(*)::integer)) END
            FROM unnest(p.addon_unit_ids) WITH ORDINALITY AS x(id, ord)
            JOIN hospitality.units u ON u.tenant_id = _t AND u.id = x.id
            JOIN hospitality.properties pr ON pr.tenant_id = u.tenant_id AND pr.id = u.property_id
           WHERE u.is_active AND pr.status = 'active' AND u.kind <> 'whole_property' AND u.category_id IS NULL
             AND u.id <> p.unit_id)
  END;
$$;
REVOKE ALL ON FUNCTION hospitality._package_addons_json(uuid, hospitality.packages, boolean) FROM PUBLIC, anon, authenticated;

-- מיגרציה 59 + החדרים הנוספים; ספירת ההזמנות של החבילה — בלי החדרים הנוספים (הם בספירה נפרדת)
CREATE OR REPLACE FUNCTION hospitality._package_json(_t uuid, p hospitality.packages, _staff boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'description', p.description, 'terms', p.terms,
    'nights', p.nights, 'price', p.price, 'max_guests', p.max_guests, 'stay_from', p.stay_from, 'stay_to', p.stay_to,
    'unit_id', p.unit_id, 'media_ids', to_jsonb(hospitality._package_media(_t, p.media_ids)),
    'sort_order', p.sort_order,
    'policy', CASE WHEN p.policy_id IS NULL OR NOT EXISTS (
                     SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = p.policy_id AND NOT x.is_archived)
                   THEN NULL ELSE hospitality._public_policy(_t, p.policy_id) END,
    'addons', hospitality._package_addons_json(_t, p, _staff))
  || CASE WHEN _staff THEN jsonb_build_object(
       'is_active', p.is_active, 'policy_id', p.policy_id, 'revision', p.revision,
       'unit_name', (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = p.unit_id),
       'bookings_count', (SELECT count(*) FROM hospitality.bookings b
                           WHERE b.tenant_id = _t AND b.package_id = p.id
                             AND COALESCE(b.package_snapshot ->> 'role', '') <> 'addon'),
       'addon_bookings_count', (SELECT count(*) FROM hospitality.bookings b
                                 WHERE b.tenant_id = _t AND b.package_id = p.id AND b.package_snapshot ->> 'role' = 'addon'),
       'updated_at', hospitality._ts(p.updated_at))
     ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION hospitality._package_json(uuid, hospitality.packages, boolean) FROM PUBLIC, anon, authenticated;

-- מיגרציה 59 + סוג היחידה ("כל המתחם") וחדר מלון לפי סוג — כדי שמסך החבילה יציע כחדר נוסף רק יחידות מתאימות
CREATE OR REPLACE FUNCTION hospitality.packages_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
BEGIN
  RETURN jsonb_build_object(
    'packages', COALESCE((SELECT jsonb_agg(hospitality._package_json(_t, p, true) ORDER BY p.sort_order, p.created_at, p.id)
                            FROM hospitality.packages p WHERE p.tenant_id = _t), '[]'::jsonb),
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'id', u.id, 'name', u.name, 'property_id', u.property_id, 'property_name', pr.name,
                                 'capacity', u.capacity, 'is_active', u.is_active,
                                 'kind', u.kind, 'typed', u.category_id IS NOT NULL)
                               ORDER BY pr.sort_order, u.sort_order, u.created_at)
                         FROM hospitality.units u
                         JOIN hospitality.properties pr ON pr.tenant_id = u.tenant_id AND pr.id = u.property_id
                        WHERE u.tenant_id = _t AND pr.status <> 'archived'), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'is_default', x.is_default)
                                           ORDER BY x.is_default DESC, x.name)
                            FROM hospitality.policies x WHERE x.tenant_id = _t AND NOT x.is_archived), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.packages_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.packages_view() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. שמירת חבילה (catalog) — מיגרציה 59 + _addons
-- ------------------------------------------------------------
-- _addons: {"unit_ids": [uuid…], "nightly_price": number|null, "max": integer}. NULL — בלי שינוי בחדרים הנוספים
-- (חבילה חדשה — בלי חדרים נוספים). unit_ids ריק — מבטל את החדרים הנוספים.
DROP FUNCTION IF EXISTS hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                 uuid, uuid[], integer);
CREATE OR REPLACE FUNCTION hospitality.package_save(
  _id uuid, _unit_id uuid, _kind text, _name text, _nights integer, _price numeric, _max_guests integer,
  _description text DEFAULT NULL, _terms text DEFAULT NULL, _stay_from date DEFAULT NULL, _stay_to date DEFAULT NULL,
  _policy_id uuid DEFAULT NULL, _media_ids uuid[] DEFAULT '{}'::uuid[], _expected_revision integer DEFAULT NULL,
  _addons jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(btrim(COALESCE(_description, '')), '');
  _terms_t text := NULLIF(btrim(COALESCE(_terms, '')), '');
  _media uuid[];
  _a_units uuid[];
  _a_price numeric;
  _a_max integer;
  _x text;
  u hospitality.units;
  p hospitality.packages;
  _before hospitality.packages;
BEGIN
  IF char_length(_n) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'שם החבילה — בין 2 ל-80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('package', 'special') THEN
    RAISE EXCEPTION 'סוג החבילה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _nights IS NULL OR _nights NOT BETWEEN 1 AND 14 THEN
    RAISE EXCEPTION 'מספר הלילות בחבילה — בין 1 ל-14' USING ERRCODE = 'check_violation';
  END IF;
  IF _price IS NULL OR _price <= 0 OR _price > 1000000 OR _price <> round(_price, 2) THEN
    RAISE EXCEPTION 'מחיר החבילה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND char_length(_d) > 4000 THEN
    RAISE EXCEPTION 'התיאור ארוך מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _terms_t IS NOT NULL AND char_length(_terms_t) > 4000 THEN
    RAISE EXCEPTION 'התנאים ארוכים מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _stay_from IS NOT NULL AND _stay_to IS NOT NULL AND _stay_to - _stay_from < _nights THEN
    RAISE EXCEPTION 'התקופה של החבילה קצרה ממספר הלילות בה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _max_guests IS NULL OR _max_guests < 1 OR _max_guests > u.capacity THEN
    RAISE EXCEPTION 'מספר האורחים בחבילה — בין 1 ל-% (התפוסה של היחידה)', u.capacity USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _policy_id AND NOT x.is_archived) THEN
    RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF cardinality(COALESCE(_media_ids, '{}'::uuid[])) > 12 THEN
    RAISE EXCEPTION 'עד 12 תמונות לחבילה' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(COALESCE(_media_ids, '{}'::uuid[])) <> (SELECT count(DISTINCT x) FROM unnest(COALESCE(_media_ids, '{}'::uuid[])) x) THEN
    RAISE EXCEPTION 'כל תמונה — פעם אחת בחבילה' USING ERRCODE = 'check_violation';
  END IF;
  _media := hospitality._package_media(_t, _media_ids);
  IF cardinality(_media) <> cardinality(COALESCE(_media_ids, '{}'::uuid[])) THEN
    RAISE EXCEPTION 'אפשר לבחור רק תמונות מהגלריות של העסק' USING ERRCODE = 'check_violation';
  END IF;

  -- החדרים הנוספים (כשנשלחו)
  IF _addons IS NOT NULL THEN
    IF jsonb_typeof(_addons) <> 'object' OR jsonb_typeof(COALESCE(_addons -> 'unit_ids', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'פרטי החדרים הנוספים לא תקינים' USING ERRCODE = 'check_violation';
    END IF;
    _a_units := '{}'::uuid[];
    FOR _x IN SELECT e FROM jsonb_array_elements_text(COALESCE(_addons -> 'unit_ids', '[]'::jsonb)) e LOOP
      IF _x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'פרטי החדרים הנוספים לא תקינים' USING ERRCODE = 'check_violation';
      END IF;
      _a_units := _a_units || _x::uuid;
    END LOOP;
    IF cardinality(_a_units) > 8 THEN
      RAISE EXCEPTION 'אפשר להציע עד 8 חדרים נוספים לחבילה' USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(_a_units) <> (SELECT count(DISTINCT x) FROM unnest(_a_units) x) THEN
      RAISE EXCEPTION 'כל חדר נוסף — פעם אחת בחבילה' USING ERRCODE = 'check_violation';
    END IF;
    IF u.id = ANY (_a_units) THEN
      RAISE EXCEPTION 'היחידה של החבילה לא יכולה להיות גם חדר נוסף' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(_a_units) x WHERE NOT hospitality._package_addon_unit_ok(_t, x, u.id)) THEN
      RAISE EXCEPTION 'אפשר להוסיף כחדר נוסף רק יחידה של העסק (לא "כל המתחם" ולא חדר מלון לפי סוג)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(_a_units) = 0 THEN
      _a_price := NULL;
      _a_max := 0;
    ELSE
      IF jsonb_typeof(_addons -> 'nightly_price') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'נא לקבוע מחיר ללילה לחדר נוסף' USING ERRCODE = 'check_violation';
      END IF;
      _a_price := (_addons ->> 'nightly_price')::numeric;
      IF _a_price <= 0 OR _a_price > 100000 OR _a_price <> round(_a_price, 2) THEN
        RAISE EXCEPTION 'המחיר ללילה לחדר נוסף לא תקין' USING ERRCODE = 'check_violation';
      END IF;
      IF jsonb_typeof(_addons -> 'max') IS DISTINCT FROM 'number' OR (_addons ->> 'max') !~ '^[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'נא לקבוע כמה חדרים נוספים אפשר להזמין' USING ERRCODE = 'check_violation';
      END IF;
      _a_max := (_addons ->> 'max')::integer;
      IF _a_max NOT BETWEEN 1 AND cardinality(_a_units) THEN
        RAISE EXCEPTION 'מספר החדרים הנוספים — בין 1 ל-% (מספר החדרים שנבחרו)', cardinality(_a_units)
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF _id IS NULL THEN
    IF (SELECT count(*) FROM hospitality.packages x WHERE x.tenant_id = _t) >= 50 THEN
      RAISE EXCEPTION 'אפשר עד 50 חבילות לעסק' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO hospitality.packages (tenant_id, unit_id, kind, name, slug, description, terms, nights, price,
                                      max_guests, stay_from, stay_to, policy_id, media_ids, sort_order,
                                      addon_unit_ids, addon_nightly_price, addon_max)
    VALUES (_t, u.id, _kind, _n, hospitality._package_slug(_t, _n, NULL), _d, _terms_t, _nights, _price,
            _max_guests, _stay_from, _stay_to, _policy_id, _media,
            COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.packages x WHERE x.tenant_id = _t), 0),
            COALESCE(_a_units, '{}'::uuid[]), _a_price, COALESCE(_a_max, 0))
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.created', p.name,
                               jsonb_build_object('unit', u.name, 'nights', p.nights, 'price', p.price)
                               || CASE WHEN cardinality(p.addon_unit_ids) > 0
                                       THEN jsonb_build_object('addon_rooms', cardinality(p.addon_unit_ids),
                                                               'addon_nightly_price', p.addon_nightly_price,
                                                               'addon_max', p.addon_max)
                                       ELSE '{}'::jsonb END);
  ELSE
    SELECT * INTO _before FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF _before.id IS NULL THEN
      RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    IF _expected_revision IS NOT NULL AND _before.revision <> _expected_revision THEN
      RAISE EXCEPTION 'החבילה השתנתה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
    END IF;
    -- בלי _addons (האפליקציה הקודמת) — החדרים הנוספים נשארים; אבל היחידה של החבילה לא יכולה להיות אחד מהם
    IF _addons IS NULL AND u.id = ANY (_before.addon_unit_ids) THEN
      RAISE EXCEPTION 'היחידה של החבילה לא יכולה להיות גם חדר נוסף' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE hospitality.packages x
       SET unit_id = u.id, kind = _kind, name = _n, description = _d, terms = _terms_t, nights = _nights,
           price = _price, max_guests = _max_guests, stay_from = _stay_from, stay_to = _stay_to,
           policy_id = _policy_id, media_ids = _media, revision = x.revision + 1, updated_at = now(),
           slug = CASE WHEN x.name = _n THEN x.slug ELSE hospitality._package_slug(_t, _n, x.id) END,
           addon_unit_ids = CASE WHEN _addons IS NULL THEN x.addon_unit_ids ELSE _a_units END,
           addon_nightly_price = CASE WHEN _addons IS NULL THEN x.addon_nightly_price ELSE _a_price END,
           addon_max = CASE WHEN _addons IS NULL THEN x.addon_max ELSE _a_max END
     WHERE x.id = _before.id
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.updated', p.name,
                               jsonb_strip_nulls(jsonb_build_object(
                                 'price', CASE WHEN _before.price <> p.price
                                               THEN jsonb_build_object('from', _before.price, 'to', p.price) END,
                                 'nights', CASE WHEN _before.nights <> p.nights
                                                THEN jsonb_build_object('from', _before.nights, 'to', p.nights) END,
                                 'unit', CASE WHEN _before.unit_id <> p.unit_id THEN u.name END,
                                 'addon_rooms', CASE WHEN _before.addon_unit_ids IS DISTINCT FROM p.addon_unit_ids
                                                     THEN jsonb_build_object('from', cardinality(_before.addon_unit_ids),
                                                                             'to', cardinality(p.addon_unit_ids)) END,
                                 'addon_nightly_price', CASE WHEN _before.addon_nightly_price IS DISTINCT FROM p.addon_nightly_price
                                                             THEN jsonb_build_object('from', _before.addon_nightly_price,
                                                                                     'to', p.addon_nightly_price) END,
                                 'addon_max', CASE WHEN _before.addon_max <> p.addon_max
                                                   THEN jsonb_build_object('from', _before.addon_max, 'to', p.addon_max) END)));
  END IF;
  RETURN hospitality._package_json(_t, p, true);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                uuid, uuid[], integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                   uuid, uuid[], integer, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. לאתר: החדרים הנוספים הפנויים, והצעה אחת לחבילה + חדרים (שרת האתר בלבד)
-- ------------------------------------------------------------
-- הצעה לחדר נוסף אחד, בלילות של החבילה: אותה בדיקת תפוסה ("כל המתחם", חסימות, ערוצים) ותאריכים פתוחים של
-- היחידה; בלי מינימום הלילות של היחידה (החבילה קובעת את הלילות); המחיר — קבוע ללילה; המדיניות — של החבילה
CREATE OR REPLACE FUNCTION hospitality._package_addon_room(_t uuid, p hospitality.packages, _unit_id uuid,
                                                          _check_in date, _check_out date, _adults integer,
                                                          _children integer, _policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  u hospitality.units;
  pr hospitality.properties;
  pol hospitality.policies;
  _q jsonb;
  _total numeric;
  _snap jsonb;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id;
  SELECT * INTO pr FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = u.property_id;
  IF u.id IS NULL OR NOT (u.id = ANY (p.addon_unit_ids)) OR NOT u.is_active OR pr.status <> 'active'
     OR NOT hospitality._package_addon_unit_ok(_t, u.id, p.unit_id) THEN
    RAISE EXCEPTION 'החדר הנוסף לא זמין בחבילה הזו' USING ERRCODE = 'no_data_found';
  END IF;
  _q := hospitality._quote(_t, u.id, _check_in, _check_out, _adults, _children, NULL, false, _policy_id);
  _total := round(p.addon_nightly_price * (_check_out - _check_in), 2);
  pol := hospitality._resolve_policy(_t, u.id, _check_in, _check_out, _policy_id);
  _snap := hospitality._snapshot(pol.id, pol.version, pol.name, hospitality._policy_rules(pol),
                                 s.timezone, s.check_in_time, s.currency, _check_in, _total);
  RETURN jsonb_build_object(
    'unit_id', u.id, 'unit_name', u.name, 'capacity', u.capacity, 'max_adults', u.max_adults,
    'max_children', u.max_children,
    'check_in', _check_in, 'check_out', _check_out, 'nights_count', _check_out - _check_in,
    'adults', _adults, 'children', _children,
    'nightly_price', p.addon_nightly_price, 'total', _total, 'currency', s.currency,
    'deposit_amount', _snap -> 'deposit_amount', 'policy', _snap,
    'available', (_q ->> 'available')::boolean AND COALESCE((_q ->> 'open')::boolean, false));
END $$;
REVOKE ALL ON FUNCTION hospitality._package_addon_room(uuid, hospitality.packages, uuid, date, date, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;

-- הצעה אחת: החבילה (_package_quote — בלי שינוי) + החדרים שנבחרו. _rooms: [{"unit_id", "adults", "children"}].
-- בלי חדרים — בדיוק ההצעה של החבילה (אותו hash). עם חדרים — hash אחד לחבילה ולכל החדרים (מחיר ותנאים)
CREATE OR REPLACE FUNCTION hospitality._package_rooms_quote(_t uuid, _package_id uuid, _check_in date, _adults integer,
                                                           _children integer, _rooms jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p hospitality.packages;
  _pq jsonb;
  _check_out date;
  _policy uuid;
  _room jsonb;
  _r jsonb;
  _out jsonb := '[]'::jsonb;
  _hashed jsonb := '[]'::jsonb;
  _units uuid[];
  _sum numeric := 0;
  _all boolean;
BEGIN
  IF _rooms IS NULL OR jsonb_typeof(_rooms) <> 'array' OR jsonb_array_length(_rooms) > 8
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(_rooms) r
                 WHERE jsonb_typeof(r) <> 'object'
                    OR NOT COALESCE(r ->> 'unit_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR (r ? 'adults' AND NOT COALESCE(r ->> 'adults', '') ~ '^[0-9]{1,2}$')
                    OR (r ? 'children' AND NOT COALESCE(r ->> 'children', '') ~ '^[0-9]{1,2}$')) THEN
    RAISE EXCEPTION 'בחירת החדרים הנוספים לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  _pq := hospitality._package_quote(_t, _package_id, _check_in, _adults, _children);
  IF jsonb_array_length(_rooms) = 0 THEN
    RETURN _pq || jsonb_build_object('package_available', (_pq ->> 'available')::boolean, 'rooms', '[]'::jsonb,
                                     'rooms_total', 0, 'grand_total', (_pq ->> 'total')::numeric);
  END IF;
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _package_id;
  IF cardinality(p.addon_unit_ids) = 0 OR p.addon_nightly_price IS NULL THEN
    RAISE EXCEPTION 'לחבילה הזו אין חדרים נוספים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg((r ->> 'unit_id')::uuid) INTO _units FROM jsonb_array_elements(_rooms) r;
  IF cardinality(_units) <> (SELECT count(DISTINCT x) FROM unnest(_units) x) THEN
    RAISE EXCEPTION 'כל חדר נוסף — פעם אחת בבקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_units) > p.addon_max THEN
    RAISE EXCEPTION 'אפשר להוסיף לחבילה עד % חדרים', p.addon_max USING ERRCODE = 'check_violation';
  END IF;
  _check_out := (_pq ->> 'check_out')::date;
  -- כל החדרים — באותה מדיניות ביטול של החבילה (זו שבהצעה של החבילה); המקדמה — לכל הזמנה לפי הסכום שלה
  _policy := (_pq -> 'policy' ->> 'policy_id')::uuid;
  FOR _room IN SELECT r FROM jsonb_array_elements(_rooms) WITH ORDINALITY AS e(r, i) ORDER BY i LOOP
    _r := hospitality._package_addon_room(_t, p, (_room ->> 'unit_id')::uuid, _check_in, _check_out,
                                          COALESCE((_room ->> 'adults')::integer, 2),
                                          COALESCE((_room ->> 'children')::integer, 0), _policy);
    _out := _out || jsonb_build_array(_r);
    _hashed := _hashed || jsonb_build_array(jsonb_build_object(
      'unit_id', _r -> 'unit_id', 'adults', _r -> 'adults', 'children', _r -> 'children',
      'nightly_price', _r -> 'nightly_price', 'total', _r -> 'total', 'policy', _r -> 'policy'));
    _sum := _sum + (_r ->> 'total')::numeric;
  END LOOP;
  _all := (_pq ->> 'available')::boolean
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_out) x WHERE NOT (x ->> 'available')::boolean);
  RETURN _pq || jsonb_build_object(
    'available', _all, 'package_available', (_pq ->> 'available')::boolean,
    'rooms', _out, 'rooms_total', _sum, 'grand_total', (_pq ->> 'total')::numeric + _sum,
    'policy_hash', hospitality._hash(jsonb_build_object('package', _pq ->> 'policy_hash', 'rooms', _hashed)));
END $$;
REVOKE ALL ON FUNCTION hospitality._package_rooms_quote(uuid, uuid, date, integer, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- לאתר: אילו חדרים נוספים פנויים ופתוחים בכל לילות החבילה (רק הפנויים; בלי מדיניות ובלי פרטי הזמנות)
CREATE OR REPLACE FUNCTION hospitality.package_addons_quote(_package_id uuid, _check_in date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  p hospitality.packages;
  _pq jsonb;
  _check_out date;
  _u uuid;
  _r jsonb;
  _units jsonb := '[]'::jsonb;
BEGIN
  -- אותן בדיקות של החבילה (פעילה, תאריך, תקופה) — לאורח אחד, רק כדי לבדוק את התאריך
  _pq := hospitality._package_quote(_t, _package_id, _check_in, 1, 0);
  _check_out := (_pq ->> 'check_out')::date;
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _package_id;
  IF cardinality(p.addon_unit_ids) > 0 AND p.addon_nightly_price IS NOT NULL THEN
    FOREACH _u IN ARRAY p.addon_unit_ids LOOP
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM hospitality.units u
          JOIN hospitality.properties pr ON pr.tenant_id = u.tenant_id AND pr.id = u.property_id
         WHERE u.tenant_id = _t AND u.id = _u AND u.is_active AND pr.status = 'active')
        OR NOT hospitality._package_addon_unit_ok(_t, _u, p.unit_id);
      _r := hospitality._package_addon_room(_t, p, _u, _check_in, _check_out, 1, 0, NULL);
      IF (_r ->> 'available')::boolean THEN
        _units := _units || jsonb_build_array(jsonb_build_object(
          'unit_id', _r -> 'unit_id', 'unit_name', _r -> 'unit_name', 'capacity', _r -> 'capacity',
          'max_adults', _r -> 'max_adults', 'max_children', _r -> 'max_children',
          'nightly_price', _r -> 'nightly_price', 'total', _r -> 'total'));
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'package_id', _package_id, 'check_in', _check_in, 'check_out', _check_out,
    'nights', _check_out - _check_in, 'currency', _pq -> 'currency',
    'nightly_price', p.addon_nightly_price,
    'max', CASE WHEN p.addon_nightly_price IS NULL THEN 0 ELSE least(p.addon_max, jsonb_array_length(_units)) END,
    'units', _units);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_addons_quote(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.package_addons_quote(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION hospitality.package_rooms_quote(_package_id uuid, _check_in date, _adults integer DEFAULT 2,
                                                          _children integer DEFAULT 0, _rooms jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality._package_rooms_quote(hospitality._public_tenant(true), _package_id, _check_in, _adults, _children,
                                          COALESCE(_rooms, '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb) TO service_role;

-- ------------------------------------------------------------
-- 5. בקשת הזמנה לחבילה עם חדרים נוספים (שרת האתר בלבד — אחרי הבדיקה נגד בוטים והגבלת הקצב)
-- ------------------------------------------------------------
-- בלי חדרים — request_booking_package הקיימת, בלי שינוי. עם חדרים: כמו request_booking_package (פרטי קשר,
-- בקשות פתוחות — הבקשה נספרת כאחת, תקרת לילות מוחזקים, תפוסה, תאריכים פתוחים, התנאים שאושרו) וכמו
-- request_booking_group (מזהי ההזמנות: המזהה + "-1", "-2"…, אותו group_id, תזכורת אישור אחת, מייל אחד לעסק
-- ומייל אחד לאורח עם קישור אישי לכל הזמנה). הכול או כלום.
CREATE OR REPLACE FUNCTION hospitality.request_booking_package_with_rooms(
  _package_id uuid, _check_in date, _rooms jsonb, _full_name text, _email text, _phone text, _idempotency_key text,
  _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2, _children integer DEFAULT 0,
  _special_requests text DEFAULT NULL, _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _e text := hospitality.normalize_email(_email);
  _p text := hospitality.normalize_phone(_phone);
  _name text := btrim(COALESCE(_full_name, ''));
  s hospitality.settings;
  g hospitality.guests;
  b hospitality.bookings;
  _first hospitality.bookings;
  pk hospitality.packages;
  _q jsonb;
  _room jsonb;
  _units uuid[];
  _open integer;
  _token text;
  _status text;
  _acceptance jsonb;
  _group uuid := gen_random_uuid();
  _n integer := 0;
  _total numeric := 0;
  _out jsonb := '[]'::jsonb;
  _pkg jsonb;
BEGIN
  IF _rooms IS NULL OR jsonb_typeof(_rooms) <> 'array' THEN
    RAISE EXCEPTION 'בחירת החדרים הנוספים לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_rooms) = 0 THEN
    RETURN hospitality.request_booking_package(_package_id, _check_in, _full_name, _email, _phone, _idempotency_key,
                                               _policy_accepted, _policy_hash, _adults, _children, _special_requests,
                                               _marketing_consent, _language);
  END IF;
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  -- מזהי ההזמנות: המזהה + "-1" (החבילה), "-2"… (החדרים)
  IF _idempotency_key IS NULL OR _idempotency_key !~ '^[A-Za-z0-9_-]{8,90}$' THEN
    RAISE EXCEPTION 'חסר מזהה בקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר את תנאי החבילה ואת תנאי הביטול לפני שליחת הבקשה' USING ERRCODE = 'check_violation';
  END IF;

  -- אותו איש קשר — אחת אחרי השנייה (כמו בבקשה לחבילה ולכמה חדרים)
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contact:' || _t || ':' || k, 0))
     FROM unnest(ARRAY['e:' || _e, 'p:' || _p]) k ORDER BY k;

  -- אותה בקשה שוב (אותו מזהה) — מה שכבר נשמר, בלי קישורים ובלי מיילים
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key || '-1';
  IF FOUND THEN
    IF b.group_id IS NULL OR b.package_id IS DISTINCT FROM _package_id OR NOT EXISTS (
         SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id AND x.email_normalized = _e) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'group_id', b.group_id, 'duplicate', true, 'status', b.status, 'currency', b.currency,
      'hold_expires_at', hospitality._ts(b.hold_expires_at),
      'total', (SELECT sum(x.total) FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.group_id = b.group_id),
      'bookings', (SELECT jsonb_agg(jsonb_build_object('booking_id', x.id, 'number', x.number, 'unit_id', x.unit_id,
                                                       'unit_name', u.name, 'adults', x.adults, 'children', x.children,
                                                       'total', x.total, 'manage_token', NULL,
                                                       'role', COALESCE(x.package_snapshot ->> 'role', 'package'))
                                    ORDER BY x.number)
                     FROM hospitality.bookings x
                     JOIN hospitality.units u ON u.tenant_id = x.tenant_id AND u.id = x.unit_id
                    WHERE x.tenant_id = _t AND x.group_id = b.group_id));
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;

  -- בקשות פתוחות מאותם פרטי קשר — בקשה לחבילה עם חדרים נספרת כאחת
  SELECT count(DISTINCT COALESCE(x.group_id, x.id)) INTO _open
    FROM hospitality.bookings x
    JOIN hospitality.guests y ON y.tenant_id = x.tenant_id AND y.id = x.guest_id
   WHERE x.tenant_id = _t AND x.status IN ('pending_approval', 'pending_payment') AND x.hold_expires_at > now()
     AND (y.email_normalized = _e OR y.phone_normalized = _p);
  IF _open >= s.max_open_requests THEN
    RAISE EXCEPTION 'כבר יש % בקשות פתוחות מאותם פרטי קשר — נא להמתין לתשובת העסק', _open
      USING ERRCODE = 'check_violation';
  END IF;

  _q := hospitality._package_rooms_quote(_t, _package_id, _check_in, _adults, _children, _rooms);
  -- SEC-M3: בקשה מהאתר — עד 14 לילות, ותקרה לעסק על לילות-יחידה שמוחזקים בבקשות שלא אושרו (כל היחידות)
  SELECT array_agg(x.u) INTO _units
    FROM (SELECT (_q ->> 'unit_id')::uuid AS u
          UNION ALL SELECT (r ->> 'unit_id')::uuid FROM jsonb_array_elements(_q -> 'rooms') r) x;
  PERFORM hospitality._online_hold_guard(_t, _units, _check_in, (_q ->> 'check_out')::date);
  IF NOT (_q ->> 'package_available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
  FOR _room IN SELECT r FROM jsonb_array_elements(_q -> 'rooms') r LOOP
    IF NOT (_room ->> 'available')::boolean THEN
      RAISE EXCEPTION 'החדר הנוסף % כבר לא פנוי בתאריכים האלה — אפשר להזמין בלי או לבחור חדר אחר',
        _room ->> 'unit_name' USING ERRCODE = 'exclusion_violation';
    END IF;
  END LOOP;
  IF _policy_hash IS DISTINCT FROM _q ->> 'policy_hash' THEN
    RAISE EXCEPTION 'תנאי ההזמנה השתנו — נא לעיין בהם שוב ולאשר' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO g FROM hospitality.guests x
   WHERE x.tenant_id = _t AND x.email_normalized = _e AND x.anonymized_at IS NULL
   ORDER BY x.created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone, marketing_consent)
    VALUES (_t, _name, _e, _phone, COALESCE(_marketing_consent, false))
    RETURNING * INTO g;
  END IF;
  -- SEC-L9 / SEC-C1 (כמו request_booking): בקשה מהאתר לא משנה כרטיס אורח קיים ולא מקשרת לחשבון

  SELECT * INTO pk FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _package_id;
  _pkg := _q -> 'package';
  _status := CASE s.booking_mode WHEN 'instant' THEN 'confirmed' ELSE 'pending_approval' END;
  PERFORM hospitality._set_actor('guest', NULL);

  -- 1. החבילה — במחיר החבילה (מתחלק בין הלילות), כמו request_booking_package
  _n := 1;
  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _acceptance := jsonb_build_object(
    'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
    'package_id', _package_id, 'group_id', _group, 'role', 'package',
    'language', left(COALESCE(_language, 'he'), 10),
    'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
    'user_agent', left(hospitality._header('user-agent'), 300),
    'marketing_consent', COALESCE(_marketing_consent, false));
  BEGIN
    b := hospitality._create_booking(_t, _q, g.id, _status, 'site', NULL, (_q ->> 'total')::numeric, _q -> 'policy',
                                     _acceptance, _idempotency_key || '-1', NULL, _special_requests,
                                     encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
  END;
  UPDATE hospitality.bookings x SET package_id = _package_id, package_snapshot = _pkg, group_id = _group
   WHERE x.id = b.id RETURNING * INTO b;
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
          jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _q -> 'policy' -> 'policy_id',
                             'version', _q -> 'policy' -> 'version', 'channel', 'site', 'group_id', _group,
                             'package_id', _package_id, 'package', _pkg ->> 'name', 'role', 'package'));
  _first := b;
  _total := b.total;
  _out := jsonb_build_array(jsonb_build_object(
    'booking_id', b.id, 'number', b.number, 'unit_id', b.unit_id, 'unit_name', _q ->> 'unit_name',
    'adults', b.adults, 'children', b.children, 'total', b.total, 'manage_token', _token, 'role', 'package'));

  -- 2. כל חדר נוסף — הזמנה רגילה על היחידה, באותם תאריכים, במחיר הקבוע ללילה ובמדיניות של החבילה
  FOR _room IN SELECT r FROM jsonb_array_elements(_q -> 'rooms') WITH ORDINALITY AS e(r, i) ORDER BY i LOOP
    _n := _n + 1;
    _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    _acceptance := jsonb_build_object(
      'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
      'package_id', _package_id, 'group_id', _group, 'role', 'addon',
      'language', left(COALESCE(_language, 'he'), 10),
      'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
      'user_agent', left(hospitality._header('user-agent'), 300),
      'marketing_consent', COALESCE(_marketing_consent, false));
    BEGIN
      b := hospitality._create_booking(_t, _room, g.id, _status, 'site', NULL, (_room ->> 'total')::numeric,
                                       _room -> 'policy', _acceptance, _idempotency_key || '-' || _n, NULL,
                                       _special_requests, encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END;
    -- תזכורת האישור לעסק — אחת לבקשה (בהזמנת החבילה)
    UPDATE hospitality.bookings x
       SET package_id = _package_id, group_id = _group, reminder_due_at = NULL,
           package_snapshot = _pkg || jsonb_build_object('role', 'addon', 'addon_nightly_price', pk.addon_nightly_price)
     WHERE x.id = b.id RETURNING * INTO b;
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
    VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
            jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _room -> 'policy' -> 'policy_id',
                               'version', _room -> 'policy' -> 'version', 'channel', 'site', 'group_id', _group,
                               'package_id', _package_id, 'package', _pkg ->> 'name', 'role', 'addon'));
    _total := _total + b.total;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'booking_id', b.id, 'number', b.number, 'unit_id', b.unit_id, 'unit_name', _room ->> 'unit_name',
      'adults', b.adults, 'children', b.children, 'total', b.total, 'manage_token', _token, 'role', 'addon'));
  END LOOP;

  -- מייל אחד לעסק ומייל אחד לאורח — החבילה וכל החדרים (לאורח: קישור אישי לכל הזמנה)
  PERFORM hospitality._enqueue(_first, CASE _status WHEN 'confirmed' THEN 'new_group_booking' ELSE 'new_group_request' END,
                               'owner', jsonb_build_object(
                                 'rooms', (SELECT jsonb_agg(r - 'manage_token' - 'booking_id' - 'unit_id') FROM jsonb_array_elements(_out) r),
                                 'room_count', _n, 'total', _total), true);
  PERFORM hospitality._enqueue(_first, CASE _status WHEN 'confirmed' THEN 'group_booking_confirmed' ELSE 'group_request_received' END,
                               'guest', jsonb_build_object(
                                 'rooms', (SELECT jsonb_agg(r - 'booking_id' - 'unit_id') FROM jsonb_array_elements(_out) r),
                                 'room_count', _n, 'total', _total), true);
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('group_id', _group, 'duplicate', false, 'status', _status, 'total', _total,
                            'currency', _first.currency, 'hold_expires_at', hospitality._ts(_first.hold_expires_at),
                            'bookings', _out);
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean,
                                                                      text, integer, integer, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean,
                                                                         text, integer, integer, text, boolean, text)
  TO service_role;

-- מיגרציה 60: כשהטופס הציג מסמכים לאישור — אילו גרסאות האורח אישר, לכל ההזמנות של הבקשה, באותה טרנזקציה
CREATE OR REPLACE FUNCTION hospitality.request_booking_package_with_rooms_with_documents(
  _documents jsonb, _package_id uuid, _check_in date, _rooms jsonb, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text, _adults integer DEFAULT 2,
  _children integer DEFAULT 0, _special_requests text DEFAULT NULL, _marketing_consent boolean DEFAULT false,
  _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _docs jsonb := hospitality._documents_for_booking(_t, _documents, 'accommodation');
  _r jsonb;
BEGIN
  _r := hospitality.request_booking_package_with_rooms(_package_id, _check_in, _rooms, _full_name, _email, _phone,
                                                       _idempotency_key, _policy_accepted, _policy_hash, _adults,
                                                       _children, _special_requests, _marketing_consent, _language);
  PERFORM hospitality._documents_accept(
    _t, CASE WHEN _r ? 'group_id'
             THEN (SELECT array_agg(b.id ORDER BY b.number) FROM hospitality.bookings b
                    WHERE b.tenant_id = _t AND b.group_id = (_r ->> 'group_id')::uuid)
             ELSE ARRAY[(_r ->> 'booking_id')::uuid] END,
    _docs, 'accommodation');
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_package_with_rooms_with_documents(jsonb, uuid, date, jsonb, text, text,
                                                                                     text, text, boolean, text, integer,
                                                                                     integer, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_package_with_rooms_with_documents(jsonb, uuid, date, jsonb, text,
                                                                                        text, text, text, boolean, text,
                                                                                        integer, integer, text, boolean,
                                                                                        text) TO service_role;

-- ------------------------------------------------------------
-- 6. "חדר נוסף" במיילים ובעמודי האורח
-- ------------------------------------------------------------
-- מיגרציה 59 + package_role ("addon") — רק בהזמנה של חדר נוסף; במיילים של הזמנות אחרות לא משתנה כלום
CREATE OR REPLACE FUNCTION hospitality._enqueue(_b hospitality.bookings, _event text, _recipient text,
                                                _extra jsonb DEFAULT '{}'::jsonb, _once boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _emails text[];
  _guest hospitality.guests;
  _unit text;
  _email text;
  _n integer := 0;
  _added integer;
BEGIN
  SELECT * INTO _guest FROM hospitality.guests g WHERE g.tenant_id = _b.tenant_id AND g.id = _b.guest_id;
  SELECT u.name INTO _unit FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
  IF _recipient = 'guest' THEN
    _emails := array_remove(ARRAY[CASE WHEN _guest.anonymized_at IS NULL THEN _guest.email_normalized END], NULL);
  ELSE
    _emails := hospitality._owner_emails(_b.tenant_id);
  END IF;
  FOREACH _email IN ARRAY COALESCE(_emails, '{}') LOOP
    INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
    VALUES (_b.tenant_id, _b.id, _event, _recipient, _email,
            'booking:' || _b.id || ':' || _event || CASE WHEN _once THEN '' ELSE ':r' || _b.revision END || ':' || _email,
            jsonb_build_object('booking_number', _b.number, 'status', _b.status, 'unit_name', _unit,
                               'check_in', _b.check_in, 'check_out', _b.check_out, 'nights', _b.check_out - _b.check_in,
                               'adults', _b.adults, 'children', _b.children, 'guest_name', _guest.full_name,
                               'total', _b.total, 'currency', _b.currency,
                               'hold_expires_at', hospitality._ts(_b.hold_expires_at))
            -- שלב א' 7: הזמנת חבילה — שם החבילה בכל מייל שלה
            || CASE WHEN _b.package_snapshot IS NOT NULL
                    THEN jsonb_build_object('package_name', _b.package_snapshot ->> 'name') ELSE '{}'::jsonb END
            -- מיגרציה 202: חדר נוסף לחבילה
            || CASE WHEN _b.package_snapshot ->> 'role' = 'addon'
                    THEN jsonb_build_object('package_role', 'addon') ELSE '{}'::jsonb END
            || COALESCE(_extra, '{}'::jsonb))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS _added = ROW_COUNT;
    _n := _n + _added;
  END LOOP;
  RETURN _n;
END $$;

-- מיגרציה 59 + package_role (ריק — הזמנה של חבילה / הזמנה רגילה; "addon" — חדר נוסף לחבילה)
CREATE OR REPLACE FUNCTION hospitality._guest_view(_b hospitality.bookings)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', _b.id, 'number', _b.number, 'status', _b.status, 'unit_name', u.name,
    'check_in', _b.check_in, 'check_out', _b.check_out, 'nights', _b.check_out - _b.check_in,
    'adults', _b.adults, 'children', _b.children, 'total', _b.total, 'currency', _b.currency,
    'deposit_amount', _b.deposit_amount, 'amount_paid', _b.amount_paid,
    'hold_expires_at', hospitality._ts(_b.hold_expires_at),
    'policy', _b.policy_snapshot, 'cancellation_outcome', _b.cancellation_outcome,
    'can_request_cancellation', _b.status IN ('pending_approval', 'pending_payment', 'confirmed'),
    'package_name', _b.package_snapshot ->> 'name',
    'package_role', _b.package_snapshot ->> 'role')
    FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;

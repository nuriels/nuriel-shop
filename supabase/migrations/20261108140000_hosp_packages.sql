-- ============================================================
-- Hospitality שלב א' 7 — חבילות אירוח וחבילות מיוחדות (מיגרציה 59)
--
-- עד היום המוצר היחיד באתר היה יחידה (בתאריכים שהאורח בוחר, במחיר מהתעריפים). עכשיו גם חבילה,
-- למשל "חבילת כלה – שני לילות ב-VIP". סוג הפריט באתר: יחידת אירוח (כמו היום) / חבילת אירוח /
-- חבילה מיוחדת.
--
--   • packages — חבילה על יחידה אחת: מספר לילות קבוע, מחיר קבוע לחבילה, עד כמה אורחים, תיאור, תנאי
--     החבילה, תמונות (נבחרות מהתמונות שכבר בגלריות של העסק — בלי עותקים), תקופה שבה אפשר להזמין
--     אותה (לא חובה), מדיניות ביטול משלה (לא חובה — אחרת כמו ביחידה), מוצגת / מוסתרת, סדר;
--   • הזמנת חבילה היא הזמנה רגילה על היחידה (bookings.unit_id) — אותה תפוסה ואותו EXCLUDE, כך שאי
--     אפשר להזמין את היחידה פעמיים לאותם לילות (חבילה + חבילה, חבילה + הזמנה רגילה, ערוצים, חסימות).
--     bookings.package_id + package_snapshot — מה שהאורח ראה ואישר (שם, סוג, לילות, מחיר, תנאים);
--   • package_quote / request_booking_package — רק דרך שרת האתר (מפתח השירות), כמו request_booking:
--     אותן בדיקות (פרטי קשר, בקשות פתוחות, תקרת לילות מוחזקים, תאריכים פתוחים, תפוסה), המחיר —
--     של החבילה (לא מהתעריפים), והאורח מאשר את התנאים (hash של מדיניות הביטול + פרטי החבילה);
--   • לצוות (catalog): packages_view, package_save, package_set_active, package_delete (רק חבילה
--     בלי הזמנות — אחרת מסתירים אותה). כל שינוי נרשם ביומן הפעולות;
--   • לאתר: public_packages() — החבילות המוצגות, ביחידה פעילה, שהתקופה שלהן עוד לא נגמרה;
--   • _enqueue ו-_guest_view (מיגרציה 13), staff_booking_detail (16) — + החבילה: שם החבילה בכל מייל
--     של הזמנת חבילה, בעמודי האורח ובעמוד ההזמנה בניהול.
-- בלי שינוי בנתונים קיימים: טבלה חדשה ריקה ושתי עמודות ריקות בהזמנות; שום מחיר קיים לא משתנה.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. החבילות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.packages (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL,
  -- package = חבילת אירוח; special = חבילה מיוחדת (חבילת כלה, יום הולדת…) — מסומנת באתר
  kind        text NOT NULL DEFAULT 'package' CHECK (kind IN ('package', 'special')),
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  slug        text NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 70),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  terms       text CHECK (terms IS NULL OR char_length(terms) <= 4000),
  nights      integer NOT NULL CHECK (nights BETWEEN 1 AND 14),
  price       numeric(12,2) NOT NULL CHECK (price > 0 AND price <= 1000000),
  max_guests  integer NOT NULL CHECK (max_guests BETWEEN 1 AND 50),
  -- אפשר להזמין לשהייה בתוך התקופה (הגעה מ-stay_from, עזיבה עד stay_to); ריק — בלי הגבלה
  stay_from   date,
  stay_to     date,
  policy_id   uuid,
  -- תמונות מהגלריות של העסק (יחידה / מתחם / אתר), בסדר שנבחר — לא קבצים חדשים
  media_ids   uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(media_ids) <= 12),
  is_active   boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  revision    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  CHECK (stay_from IS NULL OR stay_to IS NULL OR stay_to > stay_from),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_id) REFERENCES hospitality.policies (tenant_id, id)
);
COMMENT ON TABLE hospitality.packages IS
  'Hospitality (שלב א'' 7): חבילות אירוח וחבילות מיוחדות — יחידה אחת, לילות ומחיר קבועים. ההזמנה — על היחידה. רק דרך פונקציות';
CREATE INDEX IF NOT EXISTS packages_unit_idx ON hospitality.packages (tenant_id, unit_id);
ALTER TABLE hospitality.packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.packages FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.packages;
CREATE POLICY tenant_isolation ON hospitality.packages AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.packages;
CREATE POLICY backend_enabled ON hospitality.packages AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.packages;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.packages
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- ההזמנה → החבילה (בלי מפתח זר: מה שהאורח הזמין נשמר ב-package_snapshot, גם אם החבילה תשתנה)
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS package_id uuid;
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS package_snapshot jsonb;
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_package_snapshot_check;
ALTER TABLE hospitality.bookings ADD CONSTRAINT bookings_package_snapshot_check
  CHECK ((package_id IS NULL) = (package_snapshot IS NULL)
         AND (package_snapshot IS NULL OR (jsonb_typeof(package_snapshot) = 'object'
                                           AND pg_column_size(package_snapshot) <= 16384)));
CREATE INDEX IF NOT EXISTS bookings_package_idx ON hospitality.bookings (tenant_id, package_id) WHERE package_id IS NOT NULL;
COMMENT ON COLUMN hospitality.bookings.package_snapshot IS
  'Hospitality (שלב א'' 7): החבילה כפי שהאורח הזמין ואישר (שם, סוג, לילות, מחיר, תנאים)';

-- ------------------------------------------------------------
-- 2. הנתונים של החבילות
-- ------------------------------------------------------------
-- התמונות של חבילה: רק תמונות (לא סרטונים ולא לוגו) של העסק הזה, בסדר שנשמר
CREATE OR REPLACE FUNCTION hospitality._package_media(_t uuid, _ids uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(x.id ORDER BY x.ord), '{}'::uuid[])
    FROM unnest(COALESCE(_ids, '{}'::uuid[])) WITH ORDINALITY AS x(id, ord)
   WHERE EXISTS (SELECT 1 FROM hospitality.media m
                  WHERE m.tenant_id = _t AND m.id = x.id AND m.kind = 'image' AND m.owner_kind <> 'brand');
$$;
REVOKE ALL ON FUNCTION hospitality._package_media(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._package_json(_t uuid, p hospitality.packages, _staff boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'description', p.description, 'terms', p.terms,
    'nights', p.nights, 'price', p.price, 'max_guests', p.max_guests, 'stay_from', p.stay_from, 'stay_to', p.stay_to,
    'unit_id', p.unit_id, 'media_ids', to_jsonb(hospitality._package_media(_t, p.media_ids)),
    'sort_order', p.sort_order,
    'policy', CASE WHEN p.policy_id IS NULL OR NOT EXISTS (
                     SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = p.policy_id AND NOT x.is_archived)
                   THEN NULL ELSE hospitality._public_policy(_t, p.policy_id) END)
  || CASE WHEN _staff THEN jsonb_build_object(
       'is_active', p.is_active, 'policy_id', p.policy_id, 'revision', p.revision,
       'unit_name', (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = p.unit_id),
       'bookings_count', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.package_id = p.id),
       'updated_at', hospitality._ts(p.updated_at))
     ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION hospitality._package_json(uuid, hospitality.packages, boolean) FROM PUBLIC, anon, authenticated;

-- לאתר: מוצגות, ביחידה פעילה במתחם פעיל, ושהתקופה שלהן עוד לא נגמרה
CREATE OR REPLACE FUNCTION hospitality.public_packages()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
  _today date;
BEGIN
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  RETURN COALESCE((
    SELECT jsonb_agg(hospitality._package_json(_t, p, false) ORDER BY p.sort_order, p.created_at, p.id)
      FROM hospitality.packages p
      JOIN hospitality.units u ON u.tenant_id = p.tenant_id AND u.id = p.unit_id
      JOIN hospitality.properties pr ON pr.tenant_id = u.tenant_id AND pr.id = u.property_id
     WHERE p.tenant_id = _t AND p.is_active AND u.is_active AND pr.status = 'active'
       AND (p.stay_to IS NULL OR p.stay_to - p.nights >= _today)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.public_packages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_packages() TO anon, authenticated, service_role;

-- לצוות: כל החבילות (גם המוסתרות), היחידות והמדיניות לבחירה
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
                                 'capacity', u.capacity, 'is_active', u.is_active)
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
-- 3. ניהול החבילות (catalog)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._package_slug(_t uuid, _name text, _except uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _base text := btrim(left(btrim(regexp_replace(lower(COALESCE(_name, '')), '[^a-z0-9א-ת]+', '-', 'g'), '-'), 60), '-');
  _slug text;
  _n integer := 1;
BEGIN
  IF _base = '' THEN _base := 'package'; END IF;
  LOOP
    _slug := CASE WHEN _n = 1 THEN _base ELSE _base || '-' || _n END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM hospitality.packages p
                           WHERE p.tenant_id = _t AND p.slug = _slug AND p.id IS DISTINCT FROM _except);
    _n := _n + 1;
  END LOOP;
  RETURN _slug;
END $$;
REVOKE ALL ON FUNCTION hospitality._package_slug(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- חדשה (_id NULL) או עדכון (עם הגרסה שהמסך מכיר). חבילה חדשה נשמרת מוסתרת — מציגים אותה באתר במתג.
CREATE OR REPLACE FUNCTION hospitality.package_save(
  _id uuid, _unit_id uuid, _kind text, _name text, _nights integer, _price numeric, _max_guests integer,
  _description text DEFAULT NULL, _terms text DEFAULT NULL, _stay_from date DEFAULT NULL, _stay_to date DEFAULT NULL,
  _policy_id uuid DEFAULT NULL, _media_ids uuid[] DEFAULT '{}'::uuid[], _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(btrim(COALESCE(_description, '')), '');
  _terms_t text := NULLIF(btrim(COALESCE(_terms, '')), '');
  _media uuid[];
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

  IF _id IS NULL THEN
    IF (SELECT count(*) FROM hospitality.packages x WHERE x.tenant_id = _t) >= 50 THEN
      RAISE EXCEPTION 'אפשר עד 50 חבילות לעסק' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO hospitality.packages (tenant_id, unit_id, kind, name, slug, description, terms, nights, price,
                                      max_guests, stay_from, stay_to, policy_id, media_ids, sort_order)
    VALUES (_t, u.id, _kind, _n, hospitality._package_slug(_t, _n, NULL), _d, _terms_t, _nights, _price,
            _max_guests, _stay_from, _stay_to, _policy_id, _media,
            COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.packages x WHERE x.tenant_id = _t), 0))
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.created', p.name,
                               jsonb_build_object('unit', u.name, 'nights', p.nights, 'price', p.price));
  ELSE
    SELECT * INTO _before FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF _before.id IS NULL THEN
      RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    IF _expected_revision IS NOT NULL AND _before.revision <> _expected_revision THEN
      RAISE EXCEPTION 'החבילה השתנתה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.packages x
       SET unit_id = u.id, kind = _kind, name = _n, description = _d, terms = _terms_t, nights = _nights,
           price = _price, max_guests = _max_guests, stay_from = _stay_from, stay_to = _stay_to,
           policy_id = _policy_id, media_ids = _media, revision = x.revision + 1, updated_at = now(),
           slug = CASE WHEN x.name = _n THEN x.slug ELSE hospitality._package_slug(_t, _n, x.id) END
     WHERE x.id = _before.id
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.updated', p.name,
                               jsonb_strip_nulls(jsonb_build_object(
                                 'price', CASE WHEN _before.price <> p.price
                                               THEN jsonb_build_object('from', _before.price, 'to', p.price) END,
                                 'nights', CASE WHEN _before.nights <> p.nights
                                                THEN jsonb_build_object('from', _before.nights, 'to', p.nights) END,
                                 'unit', CASE WHEN _before.unit_id <> p.unit_id THEN u.name END)));
  END IF;
  RETURN hospitality._package_json(_t, p, true);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                uuid, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                   uuid, uuid[], integer) TO authenticated, service_role;

-- מוצגת באתר / מוסתרת
CREATE OR REPLACE FUNCTION hospitality.package_set_active(_id uuid, _active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  p hospitality.packages;
BEGIN
  IF _active IS NULL THEN
    RAISE EXCEPTION 'חסר מצב התצוגה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.is_active IS DISTINCT FROM _active THEN
    UPDATE hospitality.packages x SET is_active = _active, revision = x.revision + 1, updated_at = now()
     WHERE x.id = p.id RETURNING * INTO p;
    PERFORM hospitality._audit(_t, CASE WHEN _active THEN 'packages.shown' ELSE 'packages.hidden' END, p.name, '{}'::jsonb);
  END IF;
  RETURN hospitality._package_json(_t, p, true);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_set_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_set_active(uuid, boolean) TO authenticated, service_role;

-- מחיקה — רק חבילה שאין לה הזמנות (חבילה שהוזמנה — מסתירים; ההזמנות שומרות את פרטי החבילה)
CREATE OR REPLACE FUNCTION hospitality.package_delete(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  p hospitality.packages;
BEGIN
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.package_id = p.id) THEN
    RAISE EXCEPTION 'לחבילה הזו יש הזמנות — אפשר להסתיר אותה מהאתר' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM hospitality.packages x WHERE x.id = p.id;
  PERFORM hospitality._audit(_t, 'packages.deleted', p.name, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.package_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_delete(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. הצעת מחיר ובקשת הזמנה לחבילה (מהאתר, דרך השרת)
-- ------------------------------------------------------------
-- הצעת המחיר של היחידה (_quote — תפוסה, תאריכים פתוחים, אורחים), עם המחיר והתנאים של החבילה.
-- מינימום הלילות של היחידה לא חל — החבילה קובעת את מספר הלילות.
CREATE OR REPLACE FUNCTION hospitality._package_quote(_t uuid, _package_id uuid, _check_in date,
                                                      _adults integer, _children integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s hospitality.settings;
  p hospitality.packages;
  u hospitality.units;
  pr hospitality.properties;
  pol hospitality.policies;
  _today date;
  _check_out date;
  _q jsonb;
  _snapshot jsonb;
  _pkg jsonb;
  _available boolean;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT * INTO p FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _package_id;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = p.unit_id;
  SELECT * INTO pr FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = u.property_id;
  IF s.tenant_id IS NULL OR p.id IS NULL OR NOT p.is_active OR u.id IS NULL OR NOT u.is_active OR pr.status <> 'active' THEN
    RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _check_in IS NULL THEN
    RAISE EXCEPTION 'נא לבחור תאריך הגעה' USING ERRCODE = 'check_violation';
  END IF;
  _today := (now() AT TIME ZONE s.timezone)::date;
  IF _check_in < _today THEN
    RAISE EXCEPTION 'אי אפשר להזמין לתאריך שעבר' USING ERRCODE = 'check_violation';
  END IF;
  IF _check_in > _today + 730 THEN
    RAISE EXCEPTION 'אפשר להזמין עד שנתיים מראש' USING ERRCODE = 'check_violation';
  END IF;
  _check_out := _check_in + p.nights;
  IF (p.stay_from IS NOT NULL AND _check_in < p.stay_from) OR (p.stay_to IS NOT NULL AND _check_out > p.stay_to) THEN
    RAISE EXCEPTION 'החבילה זמינה לשהייה %', concat_ws(' ',
      CASE WHEN p.stay_from IS NOT NULL THEN 'מ-' || to_char(p.stay_from, 'DD.MM.YYYY') END,
      CASE WHEN p.stay_to IS NOT NULL THEN 'עד ' || to_char(p.stay_to, 'DD.MM.YYYY') END)
      USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_adults, 0) < 1 OR COALESCE(_children, -1) < 0 OR _adults + _children > p.max_guests THEN
    RAISE EXCEPTION 'החבילה מיועדת לעד % אורחים', p.max_guests USING ERRCODE = 'check_violation';
  END IF;

  -- מצב צוות (_guest_mode = false) רק כדי לדלג על מינימום הלילות; הבדיקות של אורח — כאן ולמטה
  _q := hospitality._quote(_t, u.id, _check_in, _check_out, _adults, _children, NULL, false);
  -- אורח — רק בתאריכים שבעל המקום פתח (מיגרציה 43), וכשהיחידה פנויה בכל הלילות
  _available := (_q ->> 'available')::boolean AND COALESCE((_q ->> 'open')::boolean, false);

  pol := hospitality._resolve_policy(_t, u.id, _check_in, _check_out,
           CASE WHEN EXISTS (SELECT 1 FROM hospitality.policies x
                              WHERE x.tenant_id = _t AND x.id = p.policy_id AND NOT x.is_archived)
                THEN p.policy_id END);
  _snapshot := hospitality._snapshot(pol.id, pol.version, pol.name, hospitality._policy_rules(pol),
                                     s.timezone, s.check_in_time, s.currency, _check_in, p.price);
  _pkg := jsonb_build_object('id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'nights', p.nights,
                             'price', p.price, 'max_guests', p.max_guests, 'terms', p.terms);
  RETURN (_q - 'nights' - 'promotion_id' - 'min_nights') || jsonb_build_object(
    'available', _available, 'subtotal', p.price, 'discount', 0, 'total', p.price,
    'deposit_amount', _snapshot -> 'deposit_amount', 'policy', _snapshot,
    -- האורח מאשר את מדיניות הביטול ואת פרטי החבילה (שינוי במחיר / בלילות / בתנאים — אישור מחדש)
    'policy_hash', hospitality._hash(jsonb_build_object('policy', _snapshot, 'package', _pkg)),
    'package', _pkg);
END $$;
REVOKE ALL ON FUNCTION hospitality._package_quote(uuid, uuid, date, integer, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.package_quote(_package_id uuid, _check_in date, _adults integer DEFAULT 2,
                                                     _children integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN hospitality._package_quote(hospitality._public_tenant(true), _package_id, _check_in, _adults, _children);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_quote(uuid, date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.package_quote(uuid, date, integer, integer) TO service_role;

-- כמו request_booking (מיגרציה 51): אותן בדיקות ואותו סדר, עם הצעת המחיר של החבילה
CREATE OR REPLACE FUNCTION hospitality.request_booking_package(
  _package_id uuid, _check_in date, _full_name text, _email text, _phone text, _idempotency_key text,
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
  _q jsonb;
  _open integer;
  _token text;
  _status text;
  _acceptance jsonb;
BEGIN
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _idempotency_key IS NULL OR _idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$' THEN
    RAISE EXCEPTION 'חסר מזהה בקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר את תנאי החבילה ואת תנאי הביטול לפני שליחת הבקשה' USING ERRCODE = 'check_violation';
  END IF;

  -- אותו איש קשר — אחת אחרי השנייה (גם לתקרה וגם ל-idempotency); סדר קבוע
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contact:' || _t || ':' || k, 0))
     FROM unnest(ARRAY['e:' || _e, 'p:' || _p]) k ORDER BY k;

  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF b.package_id IS DISTINCT FROM _package_id OR NOT EXISTS (
         SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id AND x.email_normalized = _e) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', true,
                              'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                              'currency', b.currency, 'manage_token', NULL);
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;

  SELECT count(*) INTO _open
    FROM hospitality.bookings x
    JOIN hospitality.guests y ON y.tenant_id = x.tenant_id AND y.id = x.guest_id
   WHERE x.tenant_id = _t AND x.status IN ('pending_approval', 'pending_payment') AND x.hold_expires_at > now()
     AND (y.email_normalized = _e OR y.phone_normalized = _p);
  IF _open >= s.max_open_requests THEN
    RAISE EXCEPTION 'כבר יש % בקשות פתוחות מאותם פרטי קשר — נא להמתין לתשובת העסק', _open
      USING ERRCODE = 'check_violation';
  END IF;

  _q := hospitality._package_quote(_t, _package_id, _check_in, _adults, _children);
  -- SEC-M3: בקשה מהאתר — עד 14 לילות, ותקרה לעסק על לילות-יחידה שמוחזקים בבקשות שלא אושרו
  PERFORM hospitality._online_hold_guard(_t, ARRAY[(_q ->> 'unit_id')::uuid], _check_in, (_q ->> 'check_out')::date);
  IF NOT (_q ->> 'available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
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

  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _status := CASE s.booking_mode WHEN 'instant' THEN 'confirmed' ELSE 'pending_approval' END;
  _acceptance := jsonb_build_object(
    'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
    'package_id', _package_id,
    'language', left(COALESCE(_language, 'he'), 10),
    'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
    'user_agent', left(hospitality._header('user-agent'), 300),
    'marketing_consent', COALESCE(_marketing_consent, false));

  PERFORM hospitality._set_actor('guest', NULL);
  BEGIN
    -- המחיר — של החבילה (מתחלק בין הלילות), לא מהתעריפים ובלי קופון
    b := hospitality._create_booking(_t, _q, g.id, _status, 'site', NULL, (_q ->> 'total')::numeric, _q -> 'policy',
                                     _acceptance, _idempotency_key, NULL, _special_requests,
                                     encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
  END;
  UPDATE hospitality.bookings x SET package_id = _package_id, package_snapshot = _q -> 'package'
   WHERE x.id = b.id RETURNING * INTO b;
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
          jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _q -> 'policy' -> 'policy_id',
                             'version', _q -> 'policy' -> 'version', 'channel', 'site',
                             'package_id', _package_id, 'package', _q -> 'package' ->> 'name'));

  IF _status = 'confirmed' THEN
    PERFORM hospitality._enqueue(b, 'new_booking', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest', jsonb_build_object('manage_token', _token), true);
  ELSE
    PERFORM hospitality._enqueue(b, 'new_request', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'request_received', 'guest', jsonb_build_object('manage_token', _token), true);
  END IF;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', false,
                            'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                            'currency', b.currency, 'manage_token', _token);
END $$;
REVOKE ALL ON FUNCTION hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer,
                                                           integer, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer,
                                                              integer, text, boolean, text) TO service_role;

-- ------------------------------------------------------------
-- 5. החבילה במיילים, בעמודי האורח ובעמוד ההזמנה בניהול
-- ------------------------------------------------------------
-- מיגרציה 13 + שם החבילה (רק בהזמנת חבילה)
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
            || COALESCE(_extra, '{}'::jsonb))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS _added = ROW_COUNT;
    _n := _n + _added;
  END LOOP;
  RETURN _n;
END $$;

-- מיגרציה 13 + שם החבילה (ריק בהזמנה רגילה) — לעמוד ההזמנה ולאזור "ההזמנות שלי"
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
    'package_name', _b.package_snapshot ->> 'name')
    FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
$$;

-- מיגרציה 16 + החבילה (שם, סוג, לילות, מחיר ותנאים — כפי שהאורח הזמין)
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
    'package', b.package_snapshot,
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

COMMIT;

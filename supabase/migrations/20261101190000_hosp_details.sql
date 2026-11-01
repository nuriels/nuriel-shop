-- ============================================================
-- Hospitality Stage 2d — פרטי היחידה והמתחם
--
-- תוספת בלבד (שום עמודה / טבלה לא נמחקת או משנה שם); שורות קיימות לא משתנות.
--   1. עמודות: units — שירותים נפרדים, מקסימום מבוגרים / ילדים; properties — חניה,
--      מידע שימושי לאורחים, כללי המקום (עישון, חיות, אירועים, שעות שקט, כללים משלכם);
--      amenities.preset_code (מתקן מהרשימה); bookings.house_rules_snapshot.
--   2. טבלה נפרדת למידע הפרטי להגעה (קוד כניסה / שער, Wi-Fi, הוראות הגעה) — בלי שום
--      הרשאה ישירה ובלי מדיניות PERMISSIVE: רק דרך הפונקציות. אף פונקציה ציבורית,
--      SEO או snapshot לא קוראת ממנה; היומן רושם איזה שדה השתנה — לעולם לא את הערך.
--   3. בלי כתיבה ישירה של הצוות למיטות ולמתקנים — רק דרך הפונקציות (כמו מתחמים
--      ויחידות במיגרציה 10), כל שינוי ביומן ועם בדיקת "עודכן בינתיים" (revision).
--   4. פונקציות: unit_create / unit_update מקבלות שירותים, מקסימום מבוגרים / ילדים,
--      מיטות (beds) ומתקנים (amenities); property_create / property_update מקבלות
--      מיקום, חניה, מידע לאורחים, כללי המקום ומתקנים משותפים; קטלוג המתקנים (רשימה
--      מוכנה + מתקנים משלכם); מידע פרטי להגעה לצוות ולאורח מורשה בלבד.
--   5. מנוע ההזמנות: מקסימום מבוגרים / ילדים נבדק בכל הצעת מחיר (ולכן גם בבקשה מהאתר,
--      בהזמנה ידנית ובשינוי הזמנה); כל הזמנה חדשה שומרת את כללי המקום שחלו עליה.
--
-- Rollback: supabase/rollbacks/20261101190000_hosp_details.down.sql
-- אידמפוטנטית.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. עמודות
-- ------------------------------------------------------------
-- כללים משלכם: עד 20, כל אחד 1–200 תווים
CREATE OR REPLACE FUNCTION hospitality._rules_items_ok(_items text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT cardinality(_items) <= 20
     AND NOT EXISTS (SELECT 1 FROM unnest(_items) i
                      WHERE i IS NULL OR btrim(i) = '' OR char_length(i) > 200);
$$;
REVOKE ALL ON FUNCTION hospitality._rules_items_ok(text[]) FROM PUBLIC, anon, authenticated;

ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS separate_toilets smallint NOT NULL DEFAULT 0;
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS max_adults smallint;
ALTER TABLE hospitality.units ADD COLUMN IF NOT EXISTS max_children smallint;
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_details_check;
ALTER TABLE hospitality.units ADD CONSTRAINT units_details_check CHECK (
  separate_toilets BETWEEN 0 AND 50
  AND (max_adults IS NULL OR max_adults BETWEEN 1 AND capacity)
  AND (max_children IS NULL OR max_children BETWEEN 0 AND capacity));

ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS parking text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS parking_type text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS parking_spaces smallint;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS parking_fee_note text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS parking_instructions text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS guest_info text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS rules_smoking text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS rules_pets text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS rules_pets_note text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS rules_events text;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS quiet_from time;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS quiet_to time;
ALTER TABLE hospitality.properties ADD COLUMN IF NOT EXISTS rules_custom text[] NOT NULL DEFAULT '{}';
ALTER TABLE hospitality.properties DROP CONSTRAINT IF EXISTS properties_details_check;
ALTER TABLE hospitality.properties ADD CONSTRAINT properties_details_check CHECK (
  (parking IS NULL OR parking IN ('none', 'free', 'paid'))
  AND (parking_type IS NULL OR parking_type IN ('private', 'shared'))
  AND (CASE WHEN parking IN ('free', 'paid') THEN parking_type IS NOT NULL
            ELSE parking_type IS NULL AND parking_spaces IS NULL END)
  AND (parking_spaces IS NULL OR parking_spaces BETWEEN 0 AND 500)
  AND (parking_fee_note IS NULL OR (parking = 'paid' AND char_length(parking_fee_note) <= 120))
  AND (parking_instructions IS NULL OR (parking IS NOT NULL AND char_length(parking_instructions) <= 1000))
  AND (guest_info IS NULL OR char_length(guest_info) <= 4000)
  AND (rules_smoking IS NULL OR rules_smoking IN ('forbidden', 'outside', 'allowed'))
  AND (rules_pets IS NULL OR rules_pets IN ('no', 'on_request', 'allowed'))
  AND (rules_pets_note IS NULL OR char_length(rules_pets_note) <= 300)
  AND (rules_events IS NULL OR rules_events IN ('no', 'on_request', 'allowed'))
  AND ((quiet_from IS NULL) = (quiet_to IS NULL))
  AND hospitality._rules_items_ok(rules_custom));

ALTER TABLE hospitality.amenities ADD COLUMN IF NOT EXISTS preset_code text;
ALTER TABLE hospitality.amenities DROP CONSTRAINT IF EXISTS amenities_preset_code_check;
ALTER TABLE hospitality.amenities ADD CONSTRAINT amenities_preset_code_check
  CHECK (preset_code IS NULL OR preset_code ~ '^[a-z][a-z_]{1,29}$');
CREATE UNIQUE INDEX IF NOT EXISTS amenities_preset_key ON hospitality.amenities (tenant_id, preset_code)
  WHERE preset_code IS NOT NULL;

-- כללי המקום שחלו על ההזמנה (נכתב ביצירה, לא משתנה אחר כך — גם לא בשינוי הזמנה)
ALTER TABLE hospitality.bookings ADD COLUMN IF NOT EXISTS house_rules_snapshot jsonb;

-- ------------------------------------------------------------
-- 2. מידע פרטי להגעה — טבלה נפרדת, בלי גישה ישירה בכלל
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.arrival_info (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id   uuid NOT NULL,
  -- null = לכל המתחם; אחרת — ערכים ליחידה (למשל קוד דלת לכל צימר)
  unit_id       uuid,
  entry_code    text CHECK (entry_code IS NULL OR char_length(entry_code) <= 60),
  gate_code     text CHECK (gate_code IS NULL OR char_length(gate_code) <= 60),
  wifi_name     text CHECK (wifi_name IS NULL OR char_length(wifi_name) <= 60),
  wifi_password text CHECK (wifi_password IS NULL OR char_length(wifi_password) <= 100),
  instructions  text CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
  revision      integer NOT NULL DEFAULT 1,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (num_nonnulls(entry_code, gate_code, wifi_name, wifi_password, instructions) > 0),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS arrival_info_target_key ON hospitality.arrival_info
  (tenant_id, property_id, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE hospitality.arrival_info IS
  'Hospitality: מידע פרטי להגעה (קודים, Wi-Fi) — רק דרך פונקציות; לצוות ולאורח מורשה בחלון הזמן';
ALTER TABLE hospitality.arrival_info ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.arrival_info FROM PUBLIC, anon, authenticated, service_role;
-- כמו יומן הפעולות: בידוד לפי אתר ודגל המסד (RESTRICTIVE), בלי מדיניות PERMISSIVE ובלי הרשאות
DROP POLICY IF EXISTS tenant_isolation ON hospitality.arrival_info;
CREATE POLICY tenant_isolation ON hospitality.arrival_info AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.arrival_info;
CREATE POLICY backend_enabled ON hospitality.arrival_info AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));

-- ------------------------------------------------------------
-- 3. בלי כתיבה ישירה למיטות ולמתקנים — רק דרך הפונקציות (קריאה נשארת עם RLS)
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON hospitality.unit_beds FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON hospitality.amenities FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON hospitality.unit_amenities FROM authenticated;

-- ------------------------------------------------------------
-- 4. קטלוג המתקנים: הרשימה המוכנה והאייקונים
-- ------------------------------------------------------------
-- הקודים, השמות והקבוצות של הרשימה המוכנה (חניה — בשדות החניה של המתחם, לא כאן).
-- הרשימה נבדקת גם ב-Vitest (tests/unit/hospitality-details.test.ts) מול האייקונים במסך.
CREATE OR REPLACE FUNCTION hospitality.amenity_presets()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '[
    {"code": "wifi", "name": "Wi-Fi", "category": "room", "icon": "wifi"},
    {"code": "ac", "name": "מיזוג", "category": "room", "icon": "air-vent"},
    {"code": "tv", "name": "טלוויזיה", "category": "room", "icon": "tv"},
    {"code": "kitchenette", "name": "מטבחון", "category": "kitchen", "icon": "cooking-pot"},
    {"code": "fridge", "name": "מקרר", "category": "kitchen", "icon": "refrigerator"},
    {"code": "microwave", "name": "מיקרוגל", "category": "kitchen", "icon": "microwave"},
    {"code": "coffee_machine", "name": "מכונת קפה", "category": "kitchen", "icon": "coffee"},
    {"code": "balcony", "name": "מרפסת", "category": "outdoor", "icon": "fence"},
    {"code": "yard", "name": "חצר", "category": "outdoor", "icon": "trees"},
    {"code": "view", "name": "נוף", "category": "outdoor", "icon": "mountain"},
    {"code": "bbq", "name": "פינת מנגל", "category": "outdoor", "icon": "flame"},
    {"code": "pool", "name": "בריכה", "category": "pool_spa", "icon": "waves"},
    {"code": "jacuzzi", "name": "ג׳קוזי", "category": "pool_spa", "icon": "bath"},
    {"code": "breakfast", "name": "ארוחת בוקר", "category": "services", "icon": "croissant"},
    {"code": "accessibility", "name": "נגישות", "category": "accessibility", "icon": "accessibility"}
  ]'::jsonb;
$$;
REVOKE ALL ON FUNCTION hospitality.amenity_presets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.amenity_presets() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._amenity_categories()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['room', 'kitchen', 'outdoor', 'pool_spa', 'services', 'accessibility', 'other']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality._amenity_categories() FROM PUBLIC, anon, authenticated;

-- האייקונים שאפשר לבחור למתקן משלכם (אותה רשימה במסך: management/details/amenity-icons.ts)
CREATE OR REPLACE FUNCTION hospitality._amenity_icons()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['wifi', 'air-vent', 'tv', 'cooking-pot', 'refrigerator', 'microwave', 'coffee', 'fence', 'trees',
               'mountain', 'flame', 'waves', 'bath', 'croissant', 'accessibility', 'sparkles', 'star', 'heart',
               'sun', 'snowflake', 'baby', 'paw-print', 'bike', 'gamepad-2', 'book-open', 'music',
               'washing-machine', 'utensils', 'bed-double', 'sofa', 'shower-head', 'flower-2', 'car-front',
               'dumbbell', 'check']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality._amenity_icons() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. עזרים: מיטות, מתקנים, כללי המקום
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._beds_json(_t uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bed_type', b.bed_type, 'quantity', b.quantity,
                                               'room_label', b.room_label) ORDER BY b.sort_order, b.created_at, b.id),
                  '[]'::jsonb)
    FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = _unit;
$$;
REVOKE ALL ON FUNCTION hospitality._beds_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- המתקנים של יחידה / מתחם: [{amenity_id, note}] בסדר הקטלוג
CREATE OR REPLACE FUNCTION hospitality._amenity_links_json(_t uuid, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('amenity_id', l.amenity_id, 'note', l.note)
                            ORDER BY a.sort_order, a.name), '[]'::jsonb)
    FROM hospitality.unit_amenities l
    JOIN hospitality.amenities a ON a.tenant_id = l.tenant_id AND a.id = l.amenity_id
   WHERE l.tenant_id = _t
     AND CASE WHEN _unit IS NOT NULL THEN l.unit_id = _unit ELSE l.property_id = _property END;
$$;
REVOKE ALL ON FUNCTION hospitality._amenity_links_json(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- מיטות מהקלט: [{bed_type, quantity, room_label?}] — עד 30 שורות
CREATE OR REPLACE FUNCTION hospitality._cv_beds(_v jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _out jsonb := '[]'::jsonb;
  r jsonb;
  _n integer := 0;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN
    RAISE EXCEPTION 'מיטות — ערך לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_v) > 30 THEN
    RAISE EXCEPTION 'אפשר להגדיר עד 30 שורות מיטות ביחידה' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(_v) x LOOP
    _n := _n + 1;
    IF jsonb_typeof(r) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k
                                               WHERE k NOT IN ('bed_type', 'quantity', 'room_label')) THEN
      RAISE EXCEPTION 'מיטות — שורה % לא תקינה', _n USING ERRCODE = 'check_violation';
    END IF;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'bed_type', hospitality._cv_choice(r -> 'bed_type', 'סוג המיטה',
                    ARRAY['double', 'queen', 'king', 'single', 'sofa_bed', 'bunk', 'crib', 'mattress']),
      'quantity', hospitality._cv_int(r -> 'quantity', 'מספר המיטות בשורה', 1, 20),
      'room_label', hospitality._cv_text(r -> 'room_label', 'שם החדר', 60, false)));
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_beds(jsonb) FROM PUBLIC, anon, authenticated;

-- מתקנים מהקלט: [{amenity_id, note?}] — מהקטלוג של האתר, בלי כפילויות, עד 80
CREATE OR REPLACE FUNCTION hospitality._cv_amenities(_t uuid, _v jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _out jsonb := '[]'::jsonb;
  r jsonb;
  _id uuid;
  _seen uuid[] := '{}';
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN
    RAISE EXCEPTION 'מתקנים — ערך לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_v) > 80 THEN
    RAISE EXCEPTION 'אפשר לסמן עד 80 מתקנים' USING ERRCODE = 'check_violation';
  END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(_v) x LOOP
    IF jsonb_typeof(r) <> 'object' OR jsonb_typeof(r -> 'amenity_id') <> 'string'
       OR (r ->> 'amenity_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('amenity_id', 'note')) THEN
      RAISE EXCEPTION 'מתקנים — ערך לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    _id := (r ->> 'amenity_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM hospitality.amenities a WHERE a.tenant_id = _t AND a.id = _id) THEN
      RAISE EXCEPTION 'המתקן לא נמצא ברשימת המתקנים של העסק' USING ERRCODE = 'no_data_found';
    END IF;
    IF _id = ANY (_seen) THEN
      RAISE EXCEPTION 'אותו מתקן סומן פעמיים' USING ERRCODE = 'check_violation';
    END IF;
    _seen := _seen || _id;
    _out := _out || jsonb_build_array(jsonb_build_object(
      'amenity_id', _id, 'note', hospitality._cv_text(r -> 'note', 'הערה למתקן', 120, false)));
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_amenities(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- החלפת המיטות של יחידה; מחזיר את השינוי ליומן (בלי שינוי — null)
CREATE OR REPLACE FUNCTION hospitality._set_beds(_t uuid, _unit uuid, _beds jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _old jsonb := hospitality._beds_json(_t, _unit);
  _sum_old integer;
  _sum_new integer;
BEGIN
  IF _old = _beds THEN
    RETURN NULL;
  END IF;
  DELETE FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = _unit;
  INSERT INTO hospitality.unit_beds (tenant_id, unit_id, bed_type, quantity, room_label, sort_order)
  SELECT _t, _unit, x ->> 'bed_type', (x ->> 'quantity')::smallint, x ->> 'room_label', (n - 1)::integer
    FROM jsonb_array_elements(_beds) WITH ORDINALITY AS e(x, n);
  SELECT COALESCE(sum((x ->> 'quantity')::integer), 0) INTO _sum_old FROM jsonb_array_elements(_old) x;
  SELECT COALESCE(sum((x ->> 'quantity')::integer), 0) INTO _sum_new FROM jsonb_array_elements(_beds) x;
  RETURN jsonb_build_object('from', _sum_old, 'to', _sum_new);
END $$;
REVOKE ALL ON FUNCTION hospitality._set_beds(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- החלפת המתקנים של יחידה (_unit) או של מתחם (_property, כש-_unit null); מחזיר ליומן
-- את שמות המתקנים שנוספו / הוסרו / שההערה שלהם השתנתה (בלי שינוי — null)
CREATE OR REPLACE FUNCTION hospitality._set_amenities(_t uuid, _property uuid, _unit uuid, _items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _old jsonb := hospitality._amenity_links_json(_t, _property, _unit);
  _added text[];
  _removed text[];
  _noted text[];
BEGIN
  WITH o AS (SELECT (x ->> 'amenity_id')::uuid AS id, x ->> 'note' AS note FROM jsonb_array_elements(_old) x),
       n AS (SELECT (x ->> 'amenity_id')::uuid AS id, x ->> 'note' AS note FROM jsonb_array_elements(_items) x)
  SELECT (SELECT array_agg(a.name ORDER BY a.name) FROM n JOIN hospitality.amenities a ON a.tenant_id = _t AND a.id = n.id
           WHERE n.id NOT IN (SELECT id FROM o)),
         (SELECT array_agg(a.name ORDER BY a.name) FROM o JOIN hospitality.amenities a ON a.tenant_id = _t AND a.id = o.id
           WHERE o.id NOT IN (SELECT id FROM n)),
         (SELECT array_agg(a.name ORDER BY a.name) FROM n JOIN o ON o.id = n.id
            JOIN hospitality.amenities a ON a.tenant_id = _t AND a.id = n.id
           WHERE n.note IS DISTINCT FROM o.note)
    INTO _added, _removed, _noted;
  IF _added IS NULL AND _removed IS NULL AND _noted IS NULL THEN
    RETURN NULL;
  END IF;
  DELETE FROM hospitality.unit_amenities l
   WHERE l.tenant_id = _t AND CASE WHEN _unit IS NOT NULL THEN l.unit_id = _unit ELSE l.property_id = _property END;
  INSERT INTO hospitality.unit_amenities (tenant_id, amenity_id, property_id, unit_id, note)
  SELECT _t, (x ->> 'amenity_id')::uuid, CASE WHEN _unit IS NULL THEN _property END, _unit, x ->> 'note'
    FROM jsonb_array_elements(_items) x;
  RETURN jsonb_strip_nulls(jsonb_build_object('added', to_jsonb(_added), 'removed', to_jsonb(_removed),
                                              'notes', to_jsonb(_noted)));
END $$;
REVOKE ALL ON FUNCTION hospitality._set_amenities(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- כללי המקום (כפי שחלים עכשיו) — ל-snapshot של הזמנה ולתצוגה
CREATE OR REPLACE FUNCTION hospitality._house_rules_json(_t uuid, _property uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'smoking', p.rules_smoking, 'pets', p.rules_pets, 'pets_note', p.rules_pets_note, 'events', p.rules_events,
    'quiet_from', to_char(p.quiet_from, 'HH24:MI'), 'quiet_to', to_char(p.quiet_to, 'HH24:MI'),
    'custom', to_jsonb(p.rules_custom),
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'), 'check_out_time', to_char(s.check_out_time, 'HH24:MI'))
    FROM hospitality.properties p
    LEFT JOIN hospitality.settings s ON s.tenant_id = p.tenant_id
   WHERE p.tenant_id = _t AND p.id = _property;
$$;
REVOKE ALL ON FUNCTION hospitality._house_rules_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- "HH:MM" מהקלט (או null)
CREATE OR REPLACE FUNCTION hospitality._cv_time(_v jsonb, _label text)
RETURNS time LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' OR (jsonb_typeof(_v) = 'string' AND btrim(_v #>> '{}') = '') THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_v) <> 'string' OR (_v #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION '% — יש לכתוב שעה בצורה 22:00', _label USING ERRCODE = 'check_violation';
  END IF;
  RETURN (_v #>> '{}')::time;
END $$;
REVOKE ALL ON FUNCTION hospitality._cv_time(jsonb, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. היחידה: השדות החדשים, המיטות והמתקנים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._unit_json(u hospitality.units)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'property_id', u.property_id, 'kind', u.kind, 'unit_type', u.unit_type,
    'name', u.name, 'description', u.description, 'capacity', u.capacity,
    'base_occupancy', u.base_occupancy, 'child_age_limit', u.child_age_limit,
    'bedrooms', u.bedrooms, 'bathrooms', u.bathrooms, 'is_active', u.is_active,
    'separate_toilets', u.separate_toilets, 'max_adults', u.max_adults, 'max_children', u.max_children,
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

-- שדות היחידה מהקלט (יצירה: ברירות מחדל; עדכון: רק מה שנשלח). מיטות ומתקנים — אצל הקורא.
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

-- מיטות ומתקנים ל"כל המתחם" — לא: הם נקבעים בכל יחידה ובמתחם
CREATE OR REPLACE FUNCTION hospitality._unit_parts_guard(u hospitality.units, _data jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF u.kind = 'whole_property' AND (_data ? 'beds' OR _data ? 'amenities') THEN
    RAISE EXCEPTION 'ב"כל המתחם" המיטות והמתקנים נקבעים בכל יחידה ובעמוד המתחם' USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._unit_parts_guard(hospitality.units, jsonb) FROM PUBLIC, anon, authenticated;

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
                                 max_adults, max_children, is_active, sort_order)
  VALUES (_t, _property_id, u.kind, u.unit_type, u.name, hospitality._catalog_slug(_t, 'units', u.name),
          u.description, u.capacity, u.base_occupancy, u.child_age_limit, u.bedrooms, u.bathrooms,
          u.separate_toilets, u.max_adults, u.max_children, true,
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
                           'bedrooms', 'bathrooms', 'separate_toilets', 'max_adults', 'max_children'] LOOP
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
         max_adults = n.max_adults, max_children = n.max_children, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'catalog.unit_updated', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_update(uuid, jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 7. המתחם: מיקום, חניה, מידע לאורחים, כללי המקום, מתקנים משותפים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._property_apply(p hospitality.properties, _data jsonb)
RETURNS hospitality.properties LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  k text;
  v jsonb;
  _lat numeric;
  _lng numeric;
  _items text[];
BEGIN
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_data) e ORDER BY e.key LOOP
    CASE k
      WHEN 'name' THEN p.name := hospitality._cv_text(v, 'שם המתחם', 120, true);
      WHEN 'property_type' THEN p.property_type := hospitality._cv_choice(v, 'סוג המקום',
        ARRAY['zimmer', 'zimmer_complex', 'vacation_apartments', 'villa', 'boutique_hotel', 'guest_house', 'other']);
      WHEN 'description' THEN p.description := hospitality._cv_text(v, 'תיאור המתחם', 5000, false);
      WHEN 'address' THEN p.address := hospitality._cv_text(v, 'כתובת', 300, false);
      WHEN 'status' THEN p.status := hospitality._cv_choice(v, 'מצב המתחם', ARRAY['draft', 'active']);
      WHEN 'location' THEN
        -- {lat, lng} או null (מחיקת המיקום)
        IF v IS NULL OR jsonb_typeof(v) = 'null' THEN
          p.latitude := NULL; p.longitude := NULL;
        ELSIF jsonb_typeof(v) <> 'object' OR jsonb_typeof(v -> 'lat') <> 'number' OR jsonb_typeof(v -> 'lng') <> 'number'
              OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) x WHERE x NOT IN ('lat', 'lng')) THEN
          RAISE EXCEPTION 'המיקום — יש להדביק קישור למפה או לכתוב קואורדינטות' USING ERRCODE = 'check_violation';
        ELSE
          _lat := (v ->> 'lat')::numeric; _lng := (v ->> 'lng')::numeric;
          IF _lat NOT BETWEEN -90 AND 90 OR _lng NOT BETWEEN -180 AND 180 THEN
            RAISE EXCEPTION 'המיקום — קואורדינטות מחוץ לטווח' USING ERRCODE = 'check_violation';
          END IF;
          p.latitude := round(_lat, 6); p.longitude := round(_lng, 6);
        END IF;
      WHEN 'parking' THEN
        p.parking := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                          ELSE hospitality._cv_choice(v, 'חניה', ARRAY['none', 'free', 'paid']) END;
      WHEN 'parking_type' THEN
        p.parking_type := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                               ELSE hospitality._cv_choice(v, 'סוג החניה', ARRAY['private', 'shared']) END;
      WHEN 'parking_spaces' THEN
        p.parking_spaces := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                                 ELSE hospitality._cv_int(v, 'מספר מקומות החניה', 0, 500) END;
      WHEN 'parking_fee_note' THEN p.parking_fee_note := hospitality._cv_text(v, 'מחיר החניה', 120, false);
      WHEN 'parking_instructions' THEN p.parking_instructions := hospitality._cv_text(v, 'הוראות החניה', 1000, false);
      WHEN 'guest_info' THEN p.guest_info := hospitality._cv_text(v, 'מידע שימושי לאורחים', 4000, false);
      WHEN 'rules_smoking' THEN
        p.rules_smoking := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                                ELSE hospitality._cv_choice(v, 'עישון', ARRAY['forbidden', 'outside', 'allowed']) END;
      WHEN 'rules_pets' THEN
        p.rules_pets := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                             ELSE hospitality._cv_choice(v, 'בעלי חיים', ARRAY['no', 'on_request', 'allowed']) END;
      WHEN 'rules_pets_note' THEN p.rules_pets_note := hospitality._cv_text(v, 'התנאים לבעלי חיים', 300, false);
      WHEN 'rules_events' THEN
        p.rules_events := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL
                               ELSE hospitality._cv_choice(v, 'מסיבות ואירועים', ARRAY['no', 'on_request', 'allowed']) END;
      WHEN 'quiet_from' THEN p.quiet_from := hospitality._cv_time(v, 'שעות שקט — מ');
      WHEN 'quiet_to' THEN p.quiet_to := hospitality._cv_time(v, 'שעות שקט — עד');
      WHEN 'rules_custom' THEN
        IF v IS NULL OR jsonb_typeof(v) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) <> 'string') THEN
          RAISE EXCEPTION 'כללים משלכם — ערך לא תקין' USING ERRCODE = 'check_violation';
        END IF;
        SELECT COALESCE(array_agg(btrim(x) ORDER BY n), '{}') INTO _items
          FROM jsonb_array_elements_text(v) WITH ORDINALITY AS e(x, n) WHERE btrim(x) <> '';
        IF cardinality(_items) > 20 THEN
          RAISE EXCEPTION 'אפשר לכתוב עד 20 כללים משלכם' USING ERRCODE = 'check_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(_items) i WHERE char_length(i) > 200) THEN
          RAISE EXCEPTION 'כל כלל — עד 200 תווים' USING ERRCODE = 'check_violation';
        END IF;
        p.rules_custom := _items;
      WHEN 'amenities' THEN NULL;  -- טבלה נפרדת: אצל הקורא
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  -- חניה: בלי חניה — בלי סוג, מקומות ומחיר; חניה בחינם — בלי מחיר
  IF p.parking IS NULL OR p.parking = 'none' THEN
    p.parking_type := NULL; p.parking_spaces := NULL; p.parking_fee_note := NULL;
  ELSIF p.parking = 'free' THEN
    p.parking_fee_note := NULL;
  END IF;
  IF p.parking IS NULL THEN
    p.parking_instructions := NULL;
  END IF;
  IF p.parking IN ('free', 'paid') AND p.parking_type IS NULL THEN
    RAISE EXCEPTION 'סוג החניה — יש לבחור פרטית או משותפת' USING ERRCODE = 'check_violation';
  END IF;
  IF (p.quiet_from IS NULL) <> (p.quiet_to IS NULL) THEN
    RAISE EXCEPTION 'שעות שקט — יש למלא מתי מתחילות ומתי נגמרות' USING ERRCODE = 'check_violation';
  END IF;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION hospitality._property_apply(hospitality.properties, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.property_create(_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  p hospitality.properties;
  _amen jsonb;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי המתחם' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (_data ? 'name') THEN
    RAISE EXCEPTION 'יש למלא את שם המתחם' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (_data ? 'property_type') THEN
    RAISE EXCEPTION 'סוג המקום — יש לבחור מהרשימה' USING ERRCODE = 'check_violation';
  END IF;
  p.tenant_id := _t; p.status := 'draft'; p.rules_custom := '{}';
  p := hospitality._property_apply(p, _data);
  IF _data ? 'amenities' THEN _amen := hospitality._cv_amenities(_t, _data -> 'amenities'); END IF;
  INSERT INTO hospitality.properties (tenant_id, name, slug, property_type, description, address, status, sort_order,
                                      latitude, longitude, parking, parking_type, parking_spaces, parking_fee_note,
                                      parking_instructions, guest_info, rules_smoking, rules_pets, rules_pets_note,
                                      rules_events, quiet_from, quiet_to, rules_custom)
  VALUES (_t, p.name, hospitality._catalog_slug(_t, 'properties', p.name), p.property_type, p.description,
          p.address, p.status,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.properties x WHERE x.tenant_id = _t), 0),
          p.latitude, p.longitude, p.parking, p.parking_type, p.parking_spaces, p.parking_fee_note,
          p.parking_instructions, p.guest_info, p.rules_smoking, p.rules_pets, p.rules_pets_note,
          p.rules_events, p.quiet_from, p.quiet_to, p.rules_custom)
  RETURNING * INTO p;
  IF _amen IS NOT NULL THEN PERFORM hospitality._set_amenities(_t, p.id, NULL, _amen); END IF;
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
  _diff jsonb := '{}'::jsonb;
  _amen jsonb;
  _d jsonb;
  f text;
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
  n := hospitality._property_apply(p, _changes);
  IF _changes ? 'amenities' THEN _amen := hospitality._cv_amenities(_t, _changes -> 'amenities'); END IF;
  -- שינויים: ערכים קצרים — מ / אל; טקסט חופשי ומיקום — רק "השתנה"
  FOREACH f IN ARRAY ARRAY['name', 'property_type', 'status', 'parking', 'parking_type', 'parking_spaces',
                           'rules_smoking', 'rules_pets', 'rules_events', 'quiet_from', 'quiet_to'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(p) -> f THEN
      _diff := _diff || jsonb_build_object(f, jsonb_build_object('from', to_jsonb(p) -> f, 'to', to_jsonb(n) -> f));
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['description', 'address', 'parking_fee_note', 'parking_instructions', 'guest_info',
                           'rules_pets_note', 'rules_custom'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(p) -> f THEN
      _diff := _diff || jsonb_build_object(f, jsonb_build_object('changed', true));
    END IF;
  END LOOP;
  IF n.latitude IS DISTINCT FROM p.latitude OR n.longitude IS DISTINCT FROM p.longitude THEN
    _diff := _diff || jsonb_build_object('location', jsonb_build_object('changed', true));
  END IF;
  IF _amen IS NOT NULL THEN
    _d := hospitality._set_amenities(_t, p.id, NULL, _amen);
    IF _d IS NOT NULL THEN _diff := _diff || jsonb_build_object('amenities', _d); END IF;
  END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', p.id, 'revision', p.revision);
  END IF;
  UPDATE hospitality.properties x
     SET name = n.name, property_type = n.property_type, description = n.description, address = n.address,
         status = n.status, latitude = n.latitude, longitude = n.longitude, parking = n.parking,
         parking_type = n.parking_type, parking_spaces = n.parking_spaces, parking_fee_note = n.parking_fee_note,
         parking_instructions = n.parking_instructions, guest_info = n.guest_info,
         rules_smoking = n.rules_smoking, rules_pets = n.rules_pets, rules_pets_note = n.rules_pets_note,
         rules_events = n.rules_events, quiet_from = n.quiet_from, quiet_to = n.quiet_to,
         rules_custom = n.rules_custom, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._audit(_t, 'catalog.property_updated', n.name, _diff);
  RETURN jsonb_build_object('id', n.id, 'revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.property_update(uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.property_update(uuid, jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 8. הקריאה: כל הפרטים, קטלוג המתקנים והרשימה המוכנה (בלי המידע הפרטי להגעה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.catalog_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _e jsonb := hospitality.entitlements(_t);
  s hospitality.settings;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  RETURN jsonb_build_object(
    'limits', jsonb_build_object('max_units', _e -> 'max_units', 'units_used', hospitality._units_used(_t),
                                 'active', _e -> 'active'),
    'can_owner', hospitality.can('catalog.owner'),
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'), 'check_out_time', to_char(s.check_out_time, 'HH24:MI'),
    'amenities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'icon', a.icon, 'category', a.category,
                                          'preset_code', a.preset_code) ORDER BY a.sort_order, a.name)
        FROM hospitality.amenities a WHERE a.tenant_id = _t), '[]'::jsonb),
    'amenity_presets', hospitality.amenity_presets(),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'property_type', p.property_type, 'description', p.description,
               'address', p.address, 'status', p.status, 'sort_order', p.sort_order, 'revision', p.revision,
               'latitude', p.latitude, 'longitude', p.longitude,
               'parking', p.parking, 'parking_type', p.parking_type, 'parking_spaces', p.parking_spaces,
               'parking_fee_note', p.parking_fee_note, 'parking_instructions', p.parking_instructions,
               'guest_info', p.guest_info,
               'rules_smoking', p.rules_smoking, 'rules_pets', p.rules_pets, 'rules_pets_note', p.rules_pets_note,
               'rules_events', p.rules_events, 'quiet_from', to_char(p.quiet_from, 'HH24:MI'),
               'quiet_to', to_char(p.quiet_to, 'HH24:MI'), 'rules_custom', to_jsonb(p.rules_custom),
               'amenities', hospitality._amenity_links_json(_t, p.id, NULL),
               'units', COALESCE((SELECT jsonb_agg(hospitality._unit_json(u)
                                                  ORDER BY (u.kind = 'whole_property'), u.sort_order, u.created_at)
                                    FROM hospitality.units u WHERE u.tenant_id = _t AND u.property_id = p.id), '[]'::jsonb))
             ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p WHERE p.tenant_id = _t), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.catalog_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.catalog_view() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 9. קטלוג המתקנים של העסק
-- ------------------------------------------------------------
-- הוספה מהרשימה המוכנה (אם כבר קיים — אותו מתקן; שם זהה למתקן משלכם — מתחברים אליו)
CREATE OR REPLACE FUNCTION hospitality.amenity_add_preset(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  _p jsonb;
  a hospitality.amenities;
BEGIN
  SELECT x INTO _p FROM jsonb_array_elements(hospitality.amenity_presets()) x WHERE x ->> 'code' = _code;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'המתקן לא ברשימה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO a FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.preset_code = _code;
  IF FOUND THEN
    RETURN jsonb_build_object('id', a.id, 'created', false);
  END IF;
  SELECT * INTO a FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.name = _p ->> 'name' AND x.preset_code IS NULL;
  IF FOUND THEN
    UPDATE hospitality.amenities x SET preset_code = _code WHERE x.tenant_id = _t AND x.id = a.id;
    RETURN jsonb_build_object('id', a.id, 'created', false);
  END IF;
  INSERT INTO hospitality.amenities (tenant_id, name, icon, category, preset_code, sort_order)
  VALUES (_t, _p ->> 'name', _p ->> 'icon', _p ->> 'category', _code,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.amenities x WHERE x.tenant_id = _t), 0))
  RETURNING * INTO a;
  PERFORM hospitality._audit(_t, 'catalog.amenity_added', a.name, jsonb_build_object('preset', _code));
  RETURN jsonb_build_object('id', a.id, 'created', true);
END $$;
REVOKE ALL ON FUNCTION hospitality.amenity_add_preset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.amenity_add_preset(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._amenity_fields(_data jsonb, _name text, _category text, _icon text,
                                                      OUT name text, OUT category text, OUT icon text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  name := _name; category := _category; icon := _icon;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_data) e LOOP
    CASE k
      WHEN 'name' THEN name := hospitality._cv_text(v, 'שם המתקן', 60, true);
      WHEN 'category' THEN category := hospitality._cv_choice(v, 'קבוצה', hospitality._amenity_categories());
      WHEN 'icon' THEN icon := hospitality._cv_choice(v, 'אייקון', hospitality._amenity_icons());
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION hospitality._amenity_fields(jsonb, text, text, text) FROM PUBLIC, anon, authenticated;

-- מתקן משלכם: שם, קבוצה ואייקון מהרשימה הקבועה
CREATE OR REPLACE FUNCTION hospitality.amenity_create(_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  f record;
  a hospitality.amenities;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' OR NOT (_data ? 'name') THEN
    RAISE EXCEPTION 'יש למלא את שם המתקן' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO f FROM hospitality._amenity_fields(_data, NULL, 'other', 'check');
  IF EXISTS (SELECT 1 FROM hospitality.amenities x WHERE x.tenant_id = _t AND lower(x.name) = lower(f.name)) THEN
    RAISE EXCEPTION 'כבר יש מתקן בשם הזה' USING ERRCODE = 'unique_violation';
  END IF;
  IF (SELECT count(*) FROM hospitality.amenities x WHERE x.tenant_id = _t) >= 200 THEN
    RAISE EXCEPTION 'אפשר להגדיר עד 200 מתקנים' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.amenities (tenant_id, name, icon, category, sort_order)
  VALUES (_t, f.name, f.icon, f.category,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.amenities x WHERE x.tenant_id = _t), 0))
  RETURNING * INTO a;
  PERFORM hospitality._audit(_t, 'catalog.amenity_added', a.name, jsonb_build_object('custom', true));
  RETURN jsonb_build_object('id', a.id, 'created', true);
END $$;
REVOKE ALL ON FUNCTION hospitality.amenity_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.amenity_create(jsonb) TO authenticated, service_role;

-- עריכת מתקן משלכם (מתקן מהרשימה המוכנה לא משתנה)
CREATE OR REPLACE FUNCTION hospitality.amenity_update(_id uuid, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  a hospitality.amenities;
  f record;
BEGIN
  SELECT * INTO a FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתקן לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF a.preset_code IS NOT NULL THEN
    RAISE EXCEPTION 'מתקן מהרשימה לא משנים — אפשר להוסיף מתקן משלכם' USING ERRCODE = 'check_violation';
  END IF;
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' OR _data = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO f FROM hospitality._amenity_fields(_data, a.name, COALESCE(a.category, 'other'), COALESCE(a.icon, 'check'));
  IF EXISTS (SELECT 1 FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.id <> _id AND lower(x.name) = lower(f.name)) THEN
    RAISE EXCEPTION 'כבר יש מתקן בשם הזה' USING ERRCODE = 'unique_violation';
  END IF;
  UPDATE hospitality.amenities x SET name = f.name, category = f.category, icon = f.icon
   WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.amenity_updated', f.name,
                             CASE WHEN f.name IS DISTINCT FROM a.name
                                  THEN jsonb_build_object('name', jsonb_build_object('from', a.name, 'to', f.name))
                                  ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION hospitality.amenity_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.amenity_update(uuid, jsonb) TO authenticated, service_role;

-- הסרה מהקטלוג: יורד מכל היחידות והמתחמים שסומן בהם (והם מקבלים גרסה חדשה — "עודכן בינתיים")
CREATE OR REPLACE FUNCTION hospitality.amenity_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  a hospitality.amenities;
  _units integer;
  _props integer;
BEGIN
  SELECT * INTO a FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתקן לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE hospitality.units u SET revision = u.revision + 1
   WHERE u.tenant_id = _t AND u.id IN (SELECT l.unit_id FROM hospitality.unit_amenities l
                                        WHERE l.tenant_id = _t AND l.amenity_id = _id AND l.unit_id IS NOT NULL);
  GET DIAGNOSTICS _units = ROW_COUNT;
  UPDATE hospitality.properties p SET revision = p.revision + 1
   WHERE p.tenant_id = _t AND p.id IN (SELECT l.property_id FROM hospitality.unit_amenities l
                                        WHERE l.tenant_id = _t AND l.amenity_id = _id AND l.property_id IS NOT NULL);
  GET DIAGNOSTICS _props = ROW_COUNT;
  DELETE FROM hospitality.amenities x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.amenity_removed', a.name,
                             jsonb_build_object('units', _units, 'properties', _props));
  RETURN jsonb_build_object('id', _id, 'units', _units, 'properties', _props);
END $$;
REVOKE ALL ON FUNCTION hospitality.amenity_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.amenity_delete(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 10. מידע פרטי להגעה
-- ------------------------------------------------------------
-- צוות עם הרשאת catalog או bookings (גם קבלה שלא עורכת יחידות צריכה את הקוד לאורח)
CREATE OR REPLACE FUNCTION hospitality._arrival_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF hospitality.can('catalog') THEN
    RETURN hospitality._manage_tenant('catalog');
  END IF;
  RETURN hospitality._manage_tenant('bookings');
END $$;
REVOKE ALL ON FUNCTION hospitality._arrival_tenant() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._arrival_json(r hospitality.arrival_info)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
    'entry_code', r.entry_code, 'gate_code', r.gate_code, 'wifi_name', r.wifi_name,
    'wifi_password', r.wifi_password, 'instructions', r.instructions, 'revision', r.revision) END;
$$;
REVOKE ALL ON FUNCTION hospitality._arrival_json(hospitality.arrival_info) FROM PUBLIC, anon, authenticated;

-- לצוות: המידע של המתחם ושל כל יחידה פיזית בו
CREATE OR REPLACE FUNCTION hospitality.arrival_info_view(_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._arrival_tenant();
  p hospitality.properties;
  r hospitality.arrival_info;
BEGIN
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO r FROM hospitality.arrival_info x WHERE x.tenant_id = _t AND x.property_id = p.id AND x.unit_id IS NULL;
  RETURN jsonb_build_object(
    'property_id', p.id,
    'can_edit', p.status <> 'archived' OR hospitality.can('catalog.owner'),
    'property', hospitality._arrival_json(r),
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('unit_id', u.id, 'name', u.name,
                                          'info', hospitality._arrival_json(a)) ORDER BY u.sort_order, u.created_at)
        FROM hospitality.units u
        LEFT JOIN hospitality.arrival_info a ON a.tenant_id = u.tenant_id AND a.unit_id = u.id
       WHERE u.tenant_id = _t AND u.property_id = p.id AND u.kind <> 'whole_property'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.arrival_info_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.arrival_info_view(uuid) TO authenticated, service_role;

-- שמירה (למתחם — _unit_id null, או ליחידה). הכול ריק → נמחק. ביומן: אילו שדות — בלי הערכים.
CREATE OR REPLACE FUNCTION hospitality.arrival_info_set(_property_id uuid, _unit_id uuid, _values jsonb,
                                                        _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._arrival_tenant();
  p hospitality.properties;
  _unit_name text;
  o hospitality.arrival_info;
  n hospitality.arrival_info;
  k text;
  v jsonb;
  _fields text[] := '{}';
  f text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-arrival:' || _t::text, 0));
  SELECT * INTO p FROM hospitality.properties x WHERE x.tenant_id = _t AND x.id = _property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF p.status = 'archived' AND NOT hospitality.can('catalog.owner') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לשנות מתחם שבארכיון' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _unit_id IS NOT NULL THEN
    SELECT u.name INTO _unit_name FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.id = _unit_id AND u.property_id = p.id AND u.kind <> 'whole_property';
    IF _unit_name IS NULL THEN
      RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  IF _values IS NULL OR jsonb_typeof(_values) <> 'object' THEN
    RAISE EXCEPTION 'חסרים הפרטים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO o FROM hospitality.arrival_info x
   WHERE x.tenant_id = _t AND x.property_id = p.id AND x.unit_id IS NOT DISTINCT FROM _unit_id FOR UPDATE;
  IF _expected_revision IS DISTINCT FROM o.revision THEN
    RAISE EXCEPTION 'פרטי ההגעה עודכנו בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  n := o;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_values) e LOOP
    CASE k
      WHEN 'entry_code' THEN n.entry_code := hospitality._cv_text(v, 'קוד הכניסה', 60, false);
      WHEN 'gate_code' THEN n.gate_code := hospitality._cv_text(v, 'קוד השער', 60, false);
      WHEN 'wifi_name' THEN n.wifi_name := hospitality._cv_text(v, 'שם רשת ה-Wi-Fi', 60, false);
      WHEN 'wifi_password' THEN n.wifi_password := hospitality._cv_text(v, 'סיסמת ה-Wi-Fi', 100, false);
      WHEN 'instructions' THEN n.instructions := hospitality._cv_text(v, 'הוראות הגעה', 2000, false);
      ELSE RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END CASE;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['entry_code', 'gate_code', 'wifi_name', 'wifi_password', 'instructions'] LOOP
    IF to_jsonb(n) -> f IS DISTINCT FROM to_jsonb(o) -> f THEN
      _fields := _fields || f;
    END IF;
  END LOOP;
  IF cardinality(_fields) = 0 THEN
    RETURN jsonb_build_object('revision', o.revision);
  END IF;
  IF num_nonnulls(n.entry_code, n.gate_code, n.wifi_name, n.wifi_password, n.instructions) = 0 THEN
    DELETE FROM hospitality.arrival_info x WHERE x.tenant_id = _t AND x.id = o.id;
    n := NULL;
  ELSIF o.id IS NULL THEN
    INSERT INTO hospitality.arrival_info (tenant_id, property_id, unit_id, entry_code, gate_code, wifi_name,
                                          wifi_password, instructions)
    VALUES (_t, p.id, _unit_id, n.entry_code, n.gate_code, n.wifi_name, n.wifi_password, n.instructions)
    RETURNING * INTO n;
  ELSE
    UPDATE hospitality.arrival_info x
       SET entry_code = n.entry_code, gate_code = n.gate_code, wifi_name = n.wifi_name,
           wifi_password = n.wifi_password, instructions = n.instructions,
           revision = x.revision + 1, updated_at = now()
     WHERE x.tenant_id = _t AND x.id = o.id
    RETURNING * INTO n;
  END IF;
  -- רק שמות השדות — לעולם לא הקודים עצמם
  PERFORM hospitality._audit(_t, 'catalog.arrival_info_updated', COALESCE(_unit_name, p.name),
                             jsonb_build_object('fields', to_jsonb(_fields)));
  RETURN jsonb_build_object('revision', n.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.arrival_info_set(uuid, uuid, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.arrival_info_set(uuid, uuid, jsonb, integer) TO authenticated, service_role;

-- לאורח מורשה (קישור "ניהול ההזמנה", או אורח מחובר שההזמנה שלו): רק הזמנה מאושרת /
-- שוהים, ורק מ-48 שעות לפני שעת הכניסה ועד שעת היציאה. אחרת — בלי ערכים, רק מתי.
CREATE OR REPLACE FUNCTION hospitality.guest_arrival_info(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  s hospitality.settings;
  u hospitality.units;
  r hospitality.arrival_info;
  _from timestamptz;
  _to timestamptz;
BEGIN
  b := hospitality._guest_booking(_t, _token, _booking_id, false);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  _from := ((b.check_in + s.check_in_time)::timestamp AT TIME ZONE s.timezone) - interval '48 hours';
  _to := (b.check_out + s.check_out_time)::timestamp AT TIME ZONE s.timezone;
  IF b.status NOT IN ('confirmed', 'cancel_requested', 'checked_in') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_confirmed');
  END IF;
  IF now() < _from THEN
    RETURN jsonb_build_object('available', false, 'reason', 'too_early', 'available_from', hospitality._ts(_from));
  END IF;
  IF now() > _to THEN
    RETURN jsonb_build_object('available', false, 'reason', 'ended');
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = b.unit_id;
  SELECT * INTO r FROM hospitality.arrival_info x
   WHERE x.tenant_id = _t AND x.property_id = u.property_id AND x.unit_id IS NULL;
  RETURN jsonb_build_object(
    'available', true, 'available_until', hospitality._ts(_to),
    'property', hospitality._arrival_json(r) - 'revision',
    'units', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', x.name, 'info', hospitality._arrival_json(a) - 'revision')
                       ORDER BY x.sort_order, x.created_at)
        FROM hospitality.units x
        JOIN hospitality.arrival_info a ON a.tenant_id = x.tenant_id AND a.unit_id = x.id
       WHERE x.tenant_id = _t
         AND x.id = ANY (CASE WHEN u.kind = 'whole_property'
                              THEN ARRAY(SELECT m.member_unit_id FROM hospitality.unit_members m
                                          WHERE m.tenant_id = _t AND m.parent_unit_id = u.id)
                              ELSE ARRAY[u.id] END)), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_arrival_info(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_arrival_info(text, uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 11. מנוע ההזמנות: מקסימום מבוגרים / ילדים (בכל הצעת מחיר) וכללי המקום בכל הזמנה חדשה
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

CREATE OR REPLACE FUNCTION hospitality.bookings_house_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.house_rules_snapshot := hospitality._house_rules_json(
      NEW.tenant_id, (SELECT u.property_id FROM hospitality.units u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.unit_id));
  ELSE
    -- נשמר כפי שהיה ביצירה (גם כששינוי הזמנה מעביר אותה ליחידה אחרת)
    NEW.house_rules_snapshot := OLD.house_rules_snapshot;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.bookings_house_rules() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bookings_house_rules ON hospitality.bookings;
CREATE TRIGGER bookings_house_rules BEFORE INSERT OR UPDATE ON hospitality.bookings
FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_house_rules();

COMMIT;

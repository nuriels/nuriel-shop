-- ============================================================
-- Rollback: 20261101180000_hosp_catalog.sql
-- חזרה למצב של מיגרציה 9: הצוות כותב שוב ישירות למתחמים וליחידות (כמו במיגרציה 3),
-- 12 הרשאות, בלי פונקציות הקטלוג, בלי סוגי מתחם / יחידה ובלי revision.
-- הגנה: נעצר אם נשמרו סוגים (property_type / unit_type שאינם 'other') — לא מוחקים
-- מידע בשקט. יומן הפעולות (מיגרציה 8) נשאר כמו שהוא.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'hospitality' AND table_name = 'properties' AND column_name = 'property_type')
     AND (EXISTS (SELECT 1 FROM hospitality.properties WHERE property_type <> 'other')
          OR EXISTS (SELECT 1 FROM hospitality.units WHERE unit_type <> 'other')) THEN
    RAISE EXCEPTION 'rollback refused: properties / units have a saved type (property_type / unit_type)';
  END IF;
END $$;

-- 9–5. הפונקציות
DROP FUNCTION IF EXISTS hospitality.catalog_reorder(text, uuid[]);
DROP FUNCTION IF EXISTS hospitality.whole_property_set(uuid, boolean, uuid[]);
DROP FUNCTION IF EXISTS hospitality.unit_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.unit_set_active(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality.unit_update(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.unit_create(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._unit_apply(hospitality.units, jsonb, boolean);
DROP FUNCTION IF EXISTS hospitality.property_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.property_archive(uuid);
DROP FUNCTION IF EXISTS hospitality.property_update(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.property_create(jsonb);
DROP FUNCTION IF EXISTS hospitality.catalog_view();

-- 4. העזרים
DROP FUNCTION IF EXISTS hospitality._unit_in_active_whole(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._unit_json(hospitality.units);
DROP FUNCTION IF EXISTS hospitality._unit_has_future(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._unit_has_history(uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._catalog_slug(uuid, text, text);
DROP FUNCTION IF EXISTS hospitality._inventory_lock(uuid);
DROP FUNCTION IF EXISTS hospitality._catalog_tenant(text);
DROP FUNCTION IF EXISTS hospitality._cv_choice(jsonb, text, text[]);
DROP FUNCTION IF EXISTS hospitality._cv_int(jsonb, text, integer, integer);
DROP FUNCTION IF EXISTS hospitality._cv_text(jsonb, text, integer, boolean);

-- 3. הכתיבה הישירה של הצוות חוזרת (כמו במיגרציה 3; RLS לפי catalog)
GRANT INSERT, UPDATE, DELETE ON hospitality.properties TO authenticated;
GRANT INSERT, UPDATE, DELETE ON hospitality.units TO authenticated;
GRANT INSERT, UPDATE, DELETE ON hospitality.unit_members TO authenticated;

-- 2. העמודות
ALTER TABLE hospitality.units DROP CONSTRAINT IF EXISTS units_unit_type_check;
ALTER TABLE hospitality.properties DROP CONSTRAINT IF EXISTS properties_property_type_check;
ALTER TABLE hospitality.units DROP COLUMN IF EXISTS revision;
ALTER TABLE hospitality.units DROP COLUMN IF EXISTS unit_type;
ALTER TABLE hospitality.properties DROP COLUMN IF EXISTS revision;
ALTER TABLE hospitality.properties DROP COLUMN IF EXISTS property_type;

-- 1. ההרשאות כמו במיגרציה 8
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner']::text[];
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
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

COMMIT;

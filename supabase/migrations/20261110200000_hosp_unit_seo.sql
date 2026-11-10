-- ============================================================
-- SEO (שלב 2 של פרויקט Google SEO): כותרת ותיאור לגוגל לכל יחידה
--
-- העמודות hospitality.units.seo_title / seo_description קיימות מאז המיגרציה הראשונה של Hospitality,
-- והאתר הציבורי כבר משתמש בהן (_site_payload, מיגרציה 41) — אבל לא הייתה דרך לערוך אותן.
-- כאן שתי פונקציות חדשות בלבד: בלי שינוי בטבלאות ובלי שינוי בשום פונקציה קיימת.
--   • unit_seo_get — הערכים הנוכחיים והגרסה של היחידה (צוות עם הרשאת catalog)
--   • unit_seo_set — שמירה עם הגרסה שנטענה (HS409 כשמישהו שמר בינתיים, כמו unit_update);
--     שורה אחת בלי סימני תגיות, ריק = ברירת המחדל של האתר; מתחם בארכיון — רק בעל העסק;
--     ביומן הפעולות כמו כל עדכון יחידה (catalog.unit_updated) — מה השתנה, בלי הטקסט עצמו
--
-- Rollback: supabase/rollbacks/20261110200000_hosp_unit_seo.down.sql — מוחק את שתי הפונקציות.
-- ערכים שנשמרו נשארים בעמודות (הן היו קיימות קודם, והקוד הקודם כבר מציג אותן באתר).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION hospitality.unit_seo_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  u hospitality.units;
BEGIN
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', u.id, 'seo_title', u.seo_title, 'seo_description', u.seo_description,
                            'revision', u.revision);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_seo_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_seo_get(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.unit_seo_set(_id uuid, _seo_title text, _seo_description text,
                                                    _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant();
  u hospitality.units;
  _status text;
  -- שורה אחת בתוצאות החיפוש: בלי תווי בקרה (שבירות שורה, טאב) ובלי < >; ריק → NULL (ברירת המחדל)
  _title text := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(_seo_title, ''), '[[:cntrl:]]+', ' ', 'g'),
                                             '[<>]', '', 'g')), '');
  _desc text := NULLIF(btrim(regexp_replace(regexp_replace(COALESCE(_seo_description, ''), '[[:cntrl:]]+', ' ', 'g'),
                                            '[<>]', '', 'g')), '');
  _diff jsonb := '{}'::jsonb;
  _rev integer;
BEGIN
  IF char_length(_title) > 120 OR char_length(_desc) > 320 THEN
    RAISE EXCEPTION 'כותרת לגוגל עד 120 תווים ותיאור עד 320' USING ERRCODE = 'check_violation';
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
  IF _title IS DISTINCT FROM u.seo_title THEN
    _diff := _diff || jsonb_build_object('seo_title', jsonb_build_object('changed', true));
  END IF;
  IF _desc IS DISTINCT FROM u.seo_description THEN
    _diff := _diff || jsonb_build_object('seo_description', jsonb_build_object('changed', true));
  END IF;
  IF _diff = '{}'::jsonb THEN
    RETURN jsonb_build_object('id', u.id, 'revision', u.revision);
  END IF;
  UPDATE hospitality.units x
     SET seo_title = _title, seo_description = _desc, revision = x.revision + 1
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING x.revision INTO _rev;
  PERFORM hospitality._audit(_t, 'catalog.unit_updated', u.name, _diff);
  RETURN jsonb_build_object('id', u.id, 'revision', _rev);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_seo_set(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_seo_set(uuid, text, text, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 205: מחיקה בטוחה של יחידה (למשל יחידה שנפתחה בטעות)
--
-- המחיקה קיימת מאז מיגרציה 10 (בעלים בלבד; רק יחידה שלא הוזמנה / נחסמה אף פעם ושאינה ב"כל המתחם").
-- ארבעה דברים שהיא לא ידעה, והם מתוקנים כאן:
--   1. חבילה שהיחידה היא היחידה שלה (packages.unit_id, ON DELETE CASCADE) נמחקה בשקט יחד עם היחידה.
--      עכשיו המחיקה נעצרת עם הסבר: קודם מעבירים את החבילה ליחידה אחרת או מוחקים אותה.
--   2. חדרים נוספים לחבילה (packages.addon_unit_ids, מיגרציה 202, מערך בלי מפתח זר) — נשאר מזהה של יחידה
--      שלא קיימת. עכשיו היחידה יוצאת מהרשימה באותה טרנזקציה: הכמות המרבית לא עולה על מה שנשאר, ורשימה
--      שהתרוקנה מחזירה את החבילה למצב "בלי חדרים נוספים" (כפי שה-CHECK של מיגרציה 202 דורש). גרסת החבילה עולה.
--   3. הצעות SEO פתוחות ליחידה ולתמונות שלה נשארו ממתינות לשדה שכבר לא קיים — עכשיו נסגרות ("stale").
--   4. קובצי התמונות של היחידה נשארו בדלי אחרי שהרשומות נמחקו (CASCADE) — עכשיו המחיקה מחזירה את רשימת
--      הקבצים לשרת (removed_files), בדיוק כמו media_delete, והשרת מוחק אותם מהדלי.
--   + unit_delete_preview(_id) — לחלון "האם למחוק?": מה יימחק יחד עם היחידה ומה עוצר את המחיקה (ולמה),
--     בלי לשנות דבר. בעלים בלבד, כמו המחיקה. התנאים — פונקציה אחת משותפת, כך שהחלון והמחיקה לא חלוקים.
-- לא משתנים: התנאים הקיימים (הזמנות / חסימות / "כל המתחם") וההודעות שלהם, ההרשאות, הנעילות.
-- unit_delete מחזירה עכשיו jsonb ולא boolean (DROP + CREATE): האפליקציה הקודמת מתעלמת מהתוצאה, כך שהסדר
-- "מיגרציה ← אפליקציה" בטוח. בלי שינוי בנתונים קיימים. אידמפוטנטי.
-- Rollback: supabase/rollbacks/20261123100000_hosp_unit_delete_safe.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. מה עוצר מחיקה של יחידה (NULL — אפשר למחוק): {code, reason}
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._unit_delete_block(_t uuid, _id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _package text;
BEGIN
  IF hospitality._unit_has_history(_t, _id) THEN
    RETURN jsonb_build_object('code', 'history',
      'reason', 'ליחידה יש הזמנות או חסימות — אפשר להשבית אותה במקום למחוק');
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.unit_members m WHERE m.tenant_id = _t AND m.member_unit_id = _id) THEN
    RETURN jsonb_build_object('code', 'whole',
      'reason', 'היחידה כלולה ב"כל המתחם" — יש להסיר אותה משם קודם');
  END IF;
  SELECT p.name INTO _package FROM hospitality.packages p
   WHERE p.tenant_id = _t AND p.unit_id = _id ORDER BY p.sort_order, p.created_at LIMIT 1;
  IF _package IS NOT NULL THEN
    RETURN jsonb_build_object('code', 'package',
      'reason', format('החבילה "%s" שייכת ליחידה הזו — יש להעביר את החבילה ליחידה אחרת או למחוק אותה קודם', _package));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality._unit_delete_block(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. החלון "האם למחוק?" — קריאה בלבד (בלי נעילת הקטלוג)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.unit_delete_preview(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  u hospitality.units;
BEGIN
  IF NOT hospitality.can('catalog.owner') THEN
    RAISE EXCEPTION 'רק בעל העסק יכול למחוק יחידה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'id', u.id, 'name', u.name, 'kind', u.kind, 'is_active', u.is_active, 'revision', u.revision,
    'block', hospitality._unit_delete_block(_t, _id),
    'photos', (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = _t AND m.unit_id = _id),
    'prices', (SELECT count(*) FROM hospitality.rate_rules r WHERE r.tenant_id = _t AND r.unit_id = _id)
            + (SELECT count(*) FROM hospitality.promotions p WHERE p.tenant_id = _t AND p.unit_id = _id),
    'beds', (SELECT count(*) FROM hospitality.unit_beds b WHERE b.tenant_id = _t AND b.unit_id = _id),
    'amenities', (SELECT count(*) FROM hospitality.unit_amenities a WHERE a.tenant_id = _t AND a.unit_id = _id),
    'calendars', (SELECT count(*) FROM hospitality.channel_feeds f WHERE f.tenant_id = _t AND f.unit_id = _id)
               + (SELECT count(*) FROM hospitality.channel_calendars c WHERE c.tenant_id = _t AND c.unit_id = _id),
    'addon_packages', COALESCE((SELECT jsonb_agg(p.name ORDER BY p.sort_order, p.created_at)
                                  FROM hospitality.packages p
                                 WHERE p.tenant_id = _t AND _id = ANY (p.addon_unit_ids)), '[]'::jsonb),
    'seo_open', (SELECT count(*) FROM hospitality.seo_proposals s
                  WHERE s.tenant_id = _t AND s.status IN ('pending', 'later')
                    AND ((s.target_kind = 'unit' AND s.target_id = _id)
                      OR (s.target_kind = 'media' AND s.target_id IN (
                            SELECT m.id FROM hospitality.media m WHERE m.tenant_id = _t AND m.unit_id = _id)))));
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_delete_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_delete_preview(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. המחיקה: אותם תנאים + חבילה, ניקוי החדרים הנוספים וההצעות, והקבצים לשרת
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS hospitality.unit_delete(uuid);
CREATE FUNCTION hospitality.unit_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._catalog_tenant('למחוק יחידה');
  u hospitality.units;
  _block jsonb;
  _addons jsonb;
  _files jsonb;
  _photos integer;
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
  _block := hospitality._unit_delete_block(_t, _id);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION '%', _block ->> 'reason' USING ERRCODE = 'check_violation';
  END IF;

  -- חדרים נוספים בחבילות (מערך, בלי מפתח זר): היחידה יוצאת מהרשימה; רשימה ריקה — בלי חדרים נוספים
  SELECT COALESCE(jsonb_agg(p.name ORDER BY p.sort_order, p.created_at), '[]'::jsonb) INTO _addons
    FROM hospitality.packages p WHERE p.tenant_id = _t AND _id = ANY (p.addon_unit_ids);
  UPDATE hospitality.packages p
     SET addon_unit_ids = array_remove(p.addon_unit_ids, _id),
         addon_max = CASE WHEN cardinality(array_remove(p.addon_unit_ids, _id)) = 0 THEN 0
                          ELSE LEAST(p.addon_max, cardinality(array_remove(p.addon_unit_ids, _id))) END,
         addon_nightly_price = CASE WHEN cardinality(array_remove(p.addon_unit_ids, _id)) = 0 THEN NULL
                                    ELSE p.addon_nightly_price END,
         revision = p.revision + 1,
         updated_at = now()
   WHERE p.tenant_id = _t AND _id = ANY (p.addon_unit_ids);

  -- הצעות SEO פתוחות ליחידה ולתמונות שלה: אין יותר על מה להחיל אותן
  UPDATE hospitality.seo_proposals s SET status = 'stale', decided_at = now()
   WHERE s.tenant_id = _t AND s.status IN ('pending', 'later')
     AND ((s.target_kind = 'unit' AND s.target_id = _id)
       OR (s.target_kind = 'media' AND s.target_id IN (
             SELECT m.id FROM hospitality.media m WHERE m.tenant_id = _t AND m.unit_id = _id)));

  -- הקבצים של התמונות (המקור והגדלים) — השרת מוחק אותם מהדלי אחרי המחיקה, כמו media_delete
  SELECT count(DISTINCT m.id), COALESCE(jsonb_agg(f.path) FILTER (WHERE f.path IS NOT NULL), '[]'::jsonb)
    INTO _photos, _files
    FROM hospitality.media m
    LEFT JOIN LATERAL jsonb_array_elements_text(hospitality._media_files(m)) AS f(path) ON true
   WHERE m.tenant_id = _t AND m.unit_id = _id;

  DELETE FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'catalog.unit_deleted', u.name,
    jsonb_build_object('photos', _photos)
    || CASE WHEN jsonb_array_length(_addons) > 0
            THEN jsonb_build_object('removed_from_package_addons', _addons) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('deleted', true, 'removed_files', _files, 'removed_from_package_addons', _addons);
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.unit_delete(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- Hospitality Stage 2e — תמונות וגלריות
--
-- תוספת בלבד. שלוש גלריות: לאתר, לכל מתחם ולכל יחידה (media.owner_kind).
--   1. עמודות: media.variants (נתיבי הגדלים הנוספים: 960 / 480 / thumb), media.source_url
--      (מאיפה יובאה תמונה מקישור — העותק שלנו בלבד מוצג).
--   2. בלי כתיבה ישירה של הצוות ל-media — רק דרך הפונקציות (כמו הקטלוג). הקבצים עצמם
--      נכתבים לדלי hosp-media עם הטוקן של המשתמש (מדיניות ה-Storage הקיימת: נתיב
--      "<tenant>/..." + הרשאת media + הדגל; נבדק מול Storage האמיתי — G12).
--   3. פונקציות (DEFINER, הרשאת media, אזור הניהול פעיל, יומן): media_list, media_galleries,
--      media_add, media_add_embed, media_update, media_set_cover, media_reorder,
--      media_replace, media_delete. הנתיבים נבדקים כאן (רק "<tenant>/<uuid>…" של האתר),
--      והקבצים למחיקה מוחזרים לשרת — הוא מוחק רק אותם, עם הטוקן של המשתמש.
--   4. מדידת נפח האחסון לאתר (בייטים, כולל הגדלים הנוספים). מגבלה ואכיפה — OD-04 (Stage 11).
--
-- Rollback: supabase/rollbacks/20261101200000_hosp_media.down.sql
-- אידמפוטנטית.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. עמודות
-- ------------------------------------------------------------
ALTER TABLE hospitality.media ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE hospitality.media ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_details_check;
ALTER TABLE hospitality.media ADD CONSTRAINT media_details_check CHECK (
  jsonb_typeof(variants) = 'object'
  AND (source_url IS NULL OR (char_length(source_url) <= 1000 AND source_url ~* '^https?://')));
CREATE INDEX IF NOT EXISTS media_site_idx ON hospitality.media (tenant_id, owner_kind, sort_order);

-- ------------------------------------------------------------
-- 2. בלי כתיבה ישירה — רק דרך הפונקציות (קריאה נשארת עם RLS)
-- ------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON hospitality.media FROM authenticated;

-- ------------------------------------------------------------
-- 3. עזרים
-- ------------------------------------------------------------
-- הגלריה: site (בלי מזהה) / property / unit של האתר. מחזיר (property_id, unit_id) ושם לתצוגה.
CREATE OR REPLACE FUNCTION hospitality._media_owner(_t uuid, _owner_kind text, _owner_id uuid,
                                                    OUT property_id uuid, OUT unit_id uuid, OUT label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _kind text;
BEGIN
  CASE _owner_kind
    WHEN 'site' THEN
      IF _owner_id IS NOT NULL THEN
        RAISE EXCEPTION 'הגלריה לא נמצאה' USING ERRCODE = 'no_data_found';
      END IF;
      label := 'גלריית האתר';
    WHEN 'property' THEN
      SELECT p.id, p.name INTO property_id, label FROM hospitality.properties p
       WHERE p.tenant_id = _t AND p.id = _owner_id;
      IF property_id IS NULL THEN
        RAISE EXCEPTION 'המתחם לא נמצא' USING ERRCODE = 'no_data_found';
      END IF;
    WHEN 'unit' THEN
      SELECT u.id, u.name, u.kind INTO unit_id, label, _kind FROM hospitality.units u
       WHERE u.tenant_id = _t AND u.id = _owner_id;
      IF unit_id IS NULL THEN
        RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
      END IF;
      IF _kind = 'whole_property' THEN
        RAISE EXCEPTION 'התמונות של "כל המתחם" — בגלריה של המתחם' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'הגלריה לא נמצאה' USING ERRCODE = 'no_data_found';
  END CASE;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_owner(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- כל שורות הגלריה (נעילה — לסדר, לתמונה ראשית ולמחיקה)
CREATE OR REPLACE FUNCTION hospitality._media_gallery_lock(_t uuid, _owner_kind text, _property uuid, _unit uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(
    'hosp-media:' || _t::text || ':' || _owner_kind || ':' || COALESCE(_property, _unit, _t)::text, 0));
$$;
REVOKE ALL ON FUNCTION hospitality._media_gallery_lock(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._media_in_gallery(m hospitality.media, _owner_kind text, _property uuid, _unit uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT m.owner_kind = _owner_kind AND m.property_id IS NOT DISTINCT FROM _property
     AND m.unit_id IS NOT DISTINCT FROM _unit;
$$;
REVOKE ALL ON FUNCTION hospitality._media_in_gallery(hospitality.media, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- קובץ שהשרת כתב: "<tenant>/<uuid>.<ext>" בלבד (הגדלים: "<tenant>/<uuid>-<size>.webp")
CREATE OR REPLACE FUNCTION hospitality._media_path_ok(_t uuid, _path text, _variant boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _path IS NOT NULL AND split_part(_path, '/', 1) = _t::text
     AND CASE WHEN _variant
              THEN _path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(960|480|thumb)\.webp$'
              ELSE _path ~ '^[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|mp4|webm|mov)$' END;
$$;
REVOKE ALL ON FUNCTION hospitality._media_path_ok(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

-- פריט קובץ מהשרת: {kind, storage_path, variants, width, height, size_bytes, alt?, source_url?}
CREATE OR REPLACE FUNCTION hospitality._media_item(_t uuid, _item jsonb)
RETURNS hospitality.media LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  m hospitality.media;
  k text;
  v jsonb;
BEGIN
  IF _item IS NULL OR jsonb_typeof(_item) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי הקובץ' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_item) x
              WHERE x NOT IN ('kind', 'storage_path', 'variants', 'width', 'height', 'size_bytes', 'alt', 'source_url')) THEN
    RAISE EXCEPTION 'פרטי הקובץ לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  m.kind := hospitality._cv_choice(_item -> 'kind', 'סוג הקובץ', ARRAY['image', 'video']);
  m.storage_path := _item ->> 'storage_path';
  IF NOT hospitality._media_path_ok(_t, m.storage_path, false)
     OR (m.kind = 'image' AND m.storage_path !~ '\.webp$') OR (m.kind = 'video' AND m.storage_path ~ '\.webp$') THEN
    RAISE EXCEPTION 'נתיב הקובץ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  m.variants := COALESCE(_item -> 'variants', '{}'::jsonb);
  IF jsonb_typeof(m.variants) <> 'object' THEN
    RAISE EXCEPTION 'נתיב הקובץ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(m.variants) e LOOP
    IF k NOT IN ('960', '480', 'thumb') OR jsonb_typeof(v) <> 'string'
       OR NOT hospitality._media_path_ok(_t, v #>> '{}', true)
       OR (v #>> '{}') <> regexp_replace(m.storage_path, '\.webp$', '-' || k || '.webp') THEN
      RAISE EXCEPTION 'נתיב הקובץ לא תקין' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF m.kind = 'video' AND m.variants <> '{}'::jsonb THEN
    RAISE EXCEPTION 'נתיב הקובץ לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  m.width := CASE WHEN _item ? 'width' AND jsonb_typeof(_item -> 'width') <> 'null'
                  THEN hospitality._cv_int(_item -> 'width', 'רוחב', 1, 20000) END;
  m.height := CASE WHEN _item ? 'height' AND jsonb_typeof(_item -> 'height') <> 'null'
                   THEN hospitality._cv_int(_item -> 'height', 'גובה', 1, 20000) END;
  m.size_bytes := hospitality._cv_int(_item -> 'size_bytes', 'גודל הקובץ', 1, 60000000);
  m.alt := hospitality._cv_text(_item -> 'alt', 'טקסט חלופי', 250, false);
  m.source_url := hospitality._cv_text(_item -> 'source_url', 'הקישור', 1000, false);
  IF m.source_url IS NOT NULL AND m.source_url !~* '^https?://' THEN
    RAISE EXCEPTION 'הקישור לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_item(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- כל הקבצים של פריט (המקור והגדלים) — להחזרה לשרת למחיקה
CREATE OR REPLACE FUNCTION hospitality._media_files(m hospitality.media)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN m.storage_path IS NULL THEN '[]'::jsonb
              ELSE jsonb_build_array(m.storage_path)
                   || COALESCE((SELECT jsonb_agg(v ORDER BY k) FROM jsonb_each_text(m.variants) AS e(k, v)), '[]'::jsonb) END;
$$;
REVOKE ALL ON FUNCTION hospitality._media_files(hospitality.media) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._media_json(m hospitality.media)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'variants', m.variants,
    'embed_provider', m.embed_provider, 'embed_id', m.embed_id, 'alt', m.alt, 'width', m.width,
    'height', m.height, 'size_bytes', m.size_bytes, 'is_cover', m.is_cover, 'sort_order', m.sort_order,
    'is_demo', m.is_demo, 'licence_ref', m.licence_ref, 'source_url', m.source_url);
$$;
REVOKE ALL ON FUNCTION hospitality._media_json(hospitality.media) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._media_usage(_t uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('bytes', COALESCE(sum(m.size_bytes), 0),
                            'files', COALESCE(sum(CASE WHEN m.storage_path IS NULL THEN 0
                                                       ELSE 1 + (SELECT count(*) FROM jsonb_object_keys(m.variants)) END), 0),
                            'items', count(*))
    FROM hospitality.media m WHERE m.tenant_id = _t;
$$;
REVOKE ALL ON FUNCTION hospitality._media_usage(uuid) FROM PUBLIC, anon, authenticated;

-- אם אין תמונה ראשית בגלריה — הראשונה בסדר (תמונה, לא סרטון)
CREATE OR REPLACE FUNCTION hospitality._media_ensure_cover(_t uuid, _owner_kind text, _property uuid, _unit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.is_cover
                    AND hospitality._media_in_gallery(m, _owner_kind, _property, _unit)) THEN
    UPDATE hospitality.media x SET is_cover = true
     WHERE x.id = (SELECT m.id FROM hospitality.media m
                    WHERE m.tenant_id = _t AND m.kind = 'image'
                      AND hospitality._media_in_gallery(m, _owner_kind, _property, _unit)
                    ORDER BY m.sort_order, m.created_at LIMIT 1);
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_ensure_cover(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._media_get(_t uuid, _id uuid, _lock boolean)
RETURNS hospitality.media LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m hospitality.media;
BEGIN
  IF _lock THEN
    SELECT * INTO m FROM hospitality.media x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  ELSE
    SELECT * INTO m FROM hospitality.media x WHERE x.tenant_id = _t AND x.id = _id;
  END IF;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN m;
END $$;
REVOKE ALL ON FUNCTION hospitality._media_get(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. קריאה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.media_list(_owner_kind text, _owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  o record;
BEGIN
  SELECT * INTO o FROM hospitality._media_owner(_t, _owner_kind, _owner_id);
  RETURN jsonb_build_object(
    'owner_kind', _owner_kind, 'owner_id', _owner_id, 'label', o.label,
    'usage', hospitality._media_usage(_t),
    'items', COALESCE((SELECT jsonb_agg(hospitality._media_json(m) ORDER BY m.sort_order, m.created_at)
                         FROM hospitality.media m
                        WHERE m.tenant_id = _t AND hospitality._media_in_gallery(m, _owner_kind, o.property_id, o.unit_id)),
                      '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_list(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_list(text, uuid) TO authenticated, service_role;

-- סקירה: כל הגלריות של האתר — כמה פריטים והתמונה הראשית
CREATE OR REPLACE FUNCTION hospitality.media_galleries()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
BEGIN
  RETURN jsonb_build_object(
    'usage', hospitality._media_usage(_t),
    'site', jsonb_build_object(
      'count', (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = _t AND m.owner_kind = 'site'),
      'cover', (SELECT hospitality._media_json(m) FROM hospitality.media m
                 WHERE m.tenant_id = _t AND m.owner_kind = 'site' AND m.is_cover)),
    'properties', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name,
               'count', (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = _t AND m.property_id = p.id),
               'cover', (SELECT hospitality._media_json(m) FROM hospitality.media m
                          WHERE m.tenant_id = _t AND m.property_id = p.id AND m.is_cover),
               'units', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'id', u.id, 'name', u.name, 'is_active', u.is_active,
                          'count', (SELECT count(*) FROM hospitality.media m WHERE m.tenant_id = _t AND m.unit_id = u.id),
                          'cover', (SELECT hospitality._media_json(m) FROM hospitality.media m
                                     WHERE m.tenant_id = _t AND m.unit_id = u.id AND m.is_cover))
                          ORDER BY u.sort_order, u.created_at)
                   FROM hospitality.units u
                  WHERE u.tenant_id = _t AND u.property_id = p.id AND u.kind <> 'whole_property'), '[]'::jsonb))
             ORDER BY p.sort_order, p.created_at)
        FROM hospitality.properties p WHERE p.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_galleries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_galleries() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. הוספה, עריכה, תמונה ראשית, סדר, החלפה, מחיקה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.media_add(_owner_kind text, _owner_id uuid, _item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  o record;
  m hospitality.media;
BEGIN
  SELECT * INTO o FROM hospitality._media_owner(_t, _owner_kind, _owner_id);
  PERFORM hospitality._media_gallery_lock(_t, _owner_kind, o.property_id, o.unit_id);
  m := hospitality._media_item(_t, _item);
  IF (SELECT count(*) FROM hospitality.media x WHERE x.tenant_id = _t
        AND hospitality._media_in_gallery(x, _owner_kind, o.property_id, o.unit_id)) >= 60 THEN
    RAISE EXCEPTION 'אפשר עד 60 תמונות וסרטונים בגלריה אחת' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.media x WHERE x.tenant_id = _t AND x.storage_path = m.storage_path) THEN
    RAISE EXCEPTION 'הקובץ כבר בגלריה' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO hospitality.media (tenant_id, owner_kind, property_id, unit_id, kind, storage_path, variants, alt,
                                 width, height, size_bytes, source_url, sort_order)
  VALUES (_t, _owner_kind, o.property_id, o.unit_id, m.kind, m.storage_path, m.variants, m.alt,
          m.width, m.height, m.size_bytes, m.source_url,
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.media x WHERE x.tenant_id = _t
                      AND hospitality._media_in_gallery(x, _owner_kind, o.property_id, o.unit_id)), 0))
  RETURNING * INTO m;
  PERFORM hospitality._media_ensure_cover(_t, _owner_kind, o.property_id, o.unit_id);
  PERFORM hospitality._audit(_t, 'media.added', o.label,
                             jsonb_build_object('kind', m.kind, 'imported', m.source_url IS NOT NULL));
  RETURN hospitality._media_json(hospitality._media_get(_t, m.id, false));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_add(text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_add(text, uuid, jsonb) TO authenticated, service_role;

-- סרטון מ-YouTube / Vimeo (מזהה בלבד — הקישור לא נשמר ולא נפתח)
CREATE OR REPLACE FUNCTION hospitality.media_add_embed(_owner_kind text, _owner_id uuid, _provider text, _embed_id text,
                                                       _alt text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  o record;
  m hospitality.media;
BEGIN
  SELECT * INTO o FROM hospitality._media_owner(_t, _owner_kind, _owner_id);
  PERFORM hospitality._media_gallery_lock(_t, _owner_kind, o.property_id, o.unit_id);
  IF _provider NOT IN ('youtube', 'vimeo') OR _embed_id IS NULL
     OR _embed_id !~ (CASE _provider WHEN 'youtube' THEN '^[A-Za-z0-9_-]{11}$' ELSE '^[0-9]{6,12}$' END) THEN
    RAISE EXCEPTION 'קישור הסרטון לא תקין — רק YouTube או Vimeo' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM hospitality.media x WHERE x.tenant_id = _t
        AND hospitality._media_in_gallery(x, _owner_kind, o.property_id, o.unit_id)) >= 60 THEN
    RAISE EXCEPTION 'אפשר עד 60 תמונות וסרטונים בגלריה אחת' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.media (tenant_id, owner_kind, property_id, unit_id, kind, embed_provider, embed_id, alt, sort_order)
  VALUES (_t, _owner_kind, o.property_id, o.unit_id, 'embed', _provider, _embed_id,
          hospitality._cv_text(to_jsonb(_alt), 'טקסט חלופי', 250, false),
          COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.media x WHERE x.tenant_id = _t
                      AND hospitality._media_in_gallery(x, _owner_kind, o.property_id, o.unit_id)), 0))
  RETURNING * INTO m;
  PERFORM hospitality._audit(_t, 'media.added', o.label, jsonb_build_object('kind', 'embed', 'provider', _provider));
  RETURN hospitality._media_json(m);
END $$;
REVOKE ALL ON FUNCTION hospitality.media_add_embed(text, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_add_embed(text, uuid, text, text, text) TO authenticated, service_role;

-- טקסט חלופי (ALT)
CREATE OR REPLACE FUNCTION hospitality.media_update(_id uuid, _alt text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  m hospitality.media := hospitality._media_get(_t, _id, true);
  _new text := hospitality._cv_text(to_jsonb(_alt), 'טקסט חלופי', 250, false);
BEGIN
  IF _new IS DISTINCT FROM m.alt THEN
    UPDATE hospitality.media x SET alt = _new WHERE x.tenant_id = _t AND x.id = _id RETURNING * INTO m;
    PERFORM hospitality._audit(_t, 'media.alt_updated', NULL, jsonb_build_object('alt', jsonb_build_object('changed', true)));
  END IF;
  RETURN hospitality._media_json(m);
END $$;
REVOKE ALL ON FUNCTION hospitality.media_update(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_update(uuid, text) TO authenticated, service_role;

-- תמונה ראשית — אחת לגלריה, בפעולה אחת (האינדקס media_one_cover מבטיח גם במקביל)
CREATE OR REPLACE FUNCTION hospitality.media_set_cover(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  m hospitality.media := hospitality._media_get(_t, _id, false);
BEGIN
  PERFORM hospitality._media_gallery_lock(_t, m.owner_kind, m.property_id, m.unit_id);
  m := hospitality._media_get(_t, _id, true);
  IF m.kind <> 'image' THEN
    RAISE EXCEPTION 'רק תמונה יכולה להיות התמונה הראשית' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT m.is_cover THEN
    UPDATE hospitality.media x SET is_cover = false
     WHERE x.tenant_id = _t AND x.is_cover AND hospitality._media_in_gallery(x, m.owner_kind, m.property_id, m.unit_id);
    UPDATE hospitality.media x SET is_cover = true WHERE x.tenant_id = _t AND x.id = _id;
    PERFORM hospitality._audit(_t, 'media.cover_set', NULL, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('id', _id);
END $$;
REVOKE ALL ON FUNCTION hospitality.media_set_cover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_set_cover(uuid) TO authenticated, service_role;

-- סדר: אותם פריטים בדיוק, והסדר שנטען (expected) עדיין נכון — אחרת "עודכן בינתיים"
CREATE OR REPLACE FUNCTION hospitality.media_reorder(_owner_kind text, _owner_id uuid, _expected uuid[], _ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  o record;
  _current uuid[];
BEGIN
  SELECT * INTO o FROM hospitality._media_owner(_t, _owner_kind, _owner_id);
  PERFORM hospitality._media_gallery_lock(_t, _owner_kind, o.property_id, o.unit_id);
  SELECT COALESCE(array_agg(m.id ORDER BY m.sort_order, m.created_at), '{}') INTO _current
    FROM hospitality.media m WHERE m.tenant_id = _t AND hospitality._media_in_gallery(m, _owner_kind, o.property_id, o.unit_id);
  IF _expected IS DISTINCT FROM _current THEN
    RAISE EXCEPTION 'הגלריה עודכנה בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) <> cardinality(_current)
     OR EXISTS (SELECT 1 FROM unnest(_ids) i WHERE i <> ALL (_current))
     OR (SELECT count(DISTINCT i) FROM unnest(_ids) i) <> cardinality(_ids) THEN
    RAISE EXCEPTION 'רשימת הסדר לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.media x SET sort_order = n.ord - 1
    FROM unnest(_ids) WITH ORDINALITY AS n(id, ord)
   WHERE x.tenant_id = _t AND x.id = n.id AND x.sort_order IS DISTINCT FROM n.ord - 1;
  PERFORM hospitality._audit(_t, 'media.reordered', o.label, '{}'::jsonb);
  RETURN jsonb_build_object('ids', to_jsonb(_ids));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_reorder(text, uuid, uuid[], uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_reorder(text, uuid, uuid[], uuid[]) TO authenticated, service_role;

-- החלפה: הקובץ החדש באותו מקום, עם אותה תמונה ראשית ואותו ALT (אם לא נשלח חדש).
-- מחזיר את הקבצים הישנים — השרת מוחק אותם
CREATE OR REPLACE FUNCTION hospitality.media_replace(_id uuid, _item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  o hospitality.media := hospitality._media_get(_t, _id, true);
  n hospitality.media := hospitality._media_item(_t, _item);
BEGIN
  IF o.kind = 'embed' OR n.kind <> o.kind THEN
    RAISE EXCEPTION 'אפשר להחליף תמונה בתמונה וסרטון בסרטון' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hospitality.media x WHERE x.tenant_id = _t AND x.storage_path = n.storage_path) THEN
    RAISE EXCEPTION 'הקובץ כבר בגלריה' USING ERRCODE = 'unique_violation';
  END IF;
  UPDATE hospitality.media x
     SET storage_path = n.storage_path, variants = n.variants, width = n.width, height = n.height,
         size_bytes = n.size_bytes, source_url = n.source_url, alt = COALESCE(n.alt, x.alt),
         is_demo = false, licence_ref = NULL
   WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'media.replaced', NULL, jsonb_build_object('kind', o.kind));
  RETURN jsonb_build_object('item', hospitality._media_json(hospitality._media_get(_t, _id, false)),
                            'removed_files', hospitality._media_files(o));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_replace(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_replace(uuid, jsonb) TO authenticated, service_role;

-- מחיקה: הרשומה, ואם הייתה ראשית — הבאה בתור; מחזיר את הקבצים — השרת מוחק אותם מהדלי
CREATE OR REPLACE FUNCTION hospitality.media_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('media');
  m hospitality.media := hospitality._media_get(_t, _id, false);
BEGIN
  PERFORM hospitality._media_gallery_lock(_t, m.owner_kind, m.property_id, m.unit_id);
  m := hospitality._media_get(_t, _id, true);
  DELETE FROM hospitality.media x WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._media_ensure_cover(_t, m.owner_kind, m.property_id, m.unit_id);
  PERFORM hospitality._audit(_t, 'media.deleted', NULL, jsonb_build_object('kind', m.kind, 'was_cover', m.is_cover));
  RETURN jsonb_build_object('id', _id, 'removed_files', hospitality._media_files(m));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_delete(uuid) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- Rollback של 20261111100000_hosp_hero_video_verified.sql (מיגרציה 62 — סרטון הפתיח לפי אורך שנמדד בשרת)
-- בלי הגנה על נתונים: האורך שנמדד אפשר למדוד שוב (הקבצים עצמם לא נוגעים). הפונקציות שהשתנו חוזרות
-- לגרסה הקודמת מילה במילה: _media_json / media_replace (12), _public_media (42), site_draft_save /
-- site_publish (21); העמודות החדשות נמחקות והאורך שנמדד מתאפס (לפני 62 העמודה לא מולאה).
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי הבדיקה (אחרת השרת קורא לפונקציות שנמחקו).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.media_video_verified(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS hospitality.media_videos_to_check(integer);

-- _media_json — כמו במיגרציה 12
CREATE OR REPLACE FUNCTION hospitality._media_json(m hospitality.media)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'variants', m.variants,
    'embed_provider', m.embed_provider, 'embed_id', m.embed_id, 'alt', m.alt, 'width', m.width,
    'height', m.height, 'size_bytes', m.size_bytes, 'is_cover', m.is_cover, 'sort_order', m.sort_order,
    'is_demo', m.is_demo, 'licence_ref', m.licence_ref, 'source_url', m.source_url);
$$;
REVOKE ALL ON FUNCTION hospitality._media_json(hospitality.media) FROM PUBLIC, anon, authenticated;

-- _public_media — כמו במיגרציה 42
CREATE OR REPLACE FUNCTION hospitality._public_media(_t uuid, _kind text, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'path', m.storage_path, 'variants', m.variants,
           'embed_provider', m.embed_provider, 'embed_id', m.embed_id,
           'alt', m.alt, 'width', m.width, 'height', m.height, 'is_cover', m.is_cover, 'is_demo', m.is_demo)
           ORDER BY m.is_cover DESC, m.sort_order, m.created_at), '[]'::jsonb)
    FROM hospitality.media m
   WHERE m.tenant_id = _t AND m.owner_kind = _kind
     AND CASE _kind
           WHEN 'site' THEN m.property_id IS NULL AND m.unit_id IS NULL
           WHEN 'brand' THEN m.property_id IS NULL AND m.unit_id IS NULL
           WHEN 'property' THEN m.property_id = _property
           WHEN 'unit' THEN m.unit_id = _unit
           ELSE false
         END;
$$;
REVOKE ALL ON FUNCTION hospitality._public_media(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- media_replace — כמו במיגרציה 12
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

-- site_draft_save — כמו במיגרציה 21
CREATE OR REPLACE FUNCTION hospitality.site_draft_save(_revision integer, _theme text, _document jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
BEGIN
  IF _document IS NULL OR jsonb_typeof(_document) <> 'object' THEN
    RAISE EXCEPTION 'מסמך האתר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF pg_column_size(_document) > 262144 THEN
    RAISE EXCEPTION 'מסמך האתר גדול מדי' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  IF d.id IS NULL THEN
    IF COALESCE(_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
    END IF;
    INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, based_on, created_by)
    VALUES (_t, 'draft', 0, _theme, _document, 1,
            (SELECT max(x.version) FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'),
            auth.uid())
    RETURNING * INTO d;
  ELSE
    IF d.revision IS DISTINCT FROM _revision THEN
      RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.site_versions x
       SET theme = _theme, document = _document, revision = x.revision + 1, updated_at = now()
     WHERE x.id = d.id
    RETURNING * INTO d;
  END IF;
  RETURN jsonb_build_object('revision', d.revision, 'updated_at', hospitality._ts(d.updated_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_draft_save(integer, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_draft_save(integer, text, jsonb) TO authenticated, service_role;

-- site_publish — כמו במיגרציה 21
CREATE OR REPLACE FUNCTION hospitality.site_publish(_revision integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  _v integer;
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF _n IS NOT NULL AND char_length(_n) > 120 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 120 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'אין טיוטה לפרסום' USING ERRCODE = 'no_data_found';
  END IF;
  IF d.revision IS DISTINCT FROM _revision THEN
    RAISE EXCEPTION 'העיצוב השתנה ממקום אחר — טענו את העורך מחדש' USING ERRCODE = 'serialization_failure';
  END IF;
  -- גרסה אחת בכל פעם לכל עסק
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-site-publish:' || _t, 0));
  SELECT COALESCE(max(x.version), 0) + 1 INTO _v FROM hospitality.site_versions x
   WHERE x.tenant_id = _t AND x.kind = 'published';
  INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision, note, created_by)
  VALUES (_t, 'published', _v, d.theme, d.document, 1, _n, auth.uid());
  UPDATE hospitality.site_versions x SET based_on = _v WHERE x.id = d.id;
  PERFORM hospitality._audit(_t, 'site.published', 'גרסה ' || _v, jsonb_build_object('theme', d.theme));
  RETURN jsonb_build_object('version', _v);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_publish(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.site_publish(integer, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS hospitality._hero_video_problem(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS hospitality._hero_video_ref(jsonb);
DROP FUNCTION IF EXISTS hospitality._hero_video_max_seconds();

DROP INDEX IF EXISTS hospitality.media_video_unchecked_idx;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_video_check_kind;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_video_codec_check;
ALTER TABLE hospitality.media DROP COLUMN IF EXISTS duration_checked_at;
ALTER TABLE hospitality.media DROP COLUMN IF EXISTS video_codec;
UPDATE hospitality.media SET duration_seconds = NULL WHERE duration_seconds IS NOT NULL;

COMMIT;

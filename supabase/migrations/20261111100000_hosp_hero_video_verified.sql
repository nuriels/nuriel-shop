-- ============================================================
-- Hospitality — סרטון הפתיח: עד 15 שניות, לפי אורך שהשרת מדד בעצמו (מיגרציה 62)
--
-- הבעיה: העלאה לגלריה ("תמונות") קיבלה סרטון עד 50MB בלי למדוד את אורכו, ומסמך העיצוב קיבל כל
-- מזהה — כך סרטון ארוך יכול היה להיות סרטון הפתיח. עכשיו:
--   • media: האורך (duration_seconds — העמודה קיימת מאז מיגרציה 3 ולא מולאה), ה-codec ומתי נבדק.
--     רק השרת כותב אותם (media_video_verified — מפתח השירות בלבד), אחרי שקרא את הקובץ עצמו
--     (video-info.ts: הארוך מבין הכותרת, הרצועות והפריים האחרון בפועל). הצוות לא יכול להצהיר על אורך;
--   • החלפת קובץ (media_replace) מאפסת את הבדיקה — הקובץ החדש נמדד מחדש;
--   • שמירת הטיוטה (site_draft_save): סרטון פתיח חדש / שהשתנה — רק סרטון של העסק, שנמדד, עד 15
--     שניות (15.5 עם הסובלנות). ערך שלא השתנה (טיוטה ישנה) לא חוסם שמירה של שינויים אחרים;
--   • פרסום (site_publish): סרטון פתיח שנמדד ונמצא ארוך / לא נקרא / לא של העסק — נחסם, עם הסבר.
--     סרטון שעוד לא נמדד (סרטונים ישנים, עד שהבדיקה ברקע מגיעה אליהם) — לא חוסם, אבל לא מוצג;
--   • האתר (_public_media): האורך שנמדד עובר לאתר, והאתר מציג סרטון פתיח רק כשהוא נמדד ועד 15
--     שניות — אחרת התמונה הראשית (videoById). נבדק גם בבדיקות היחידה וב-E2E;
--   • בדיקה ברקע של סרטונים ישנים: media_videos_to_check (מפתח השירות) → השרת מוריד וקורא →
--     media_video_verified. קובץ שלא נקרא — נרשם "נבדק, אורך לא ידוע" (לא חוזרים עליו בלולאה).
-- בלי שינוי בנתונים קיימים מלבד שלוש העמודות (ריקות). Rollback: supabase/rollbacks/…_hosp_hero_video_verified.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE hospitality.media ADD COLUMN IF NOT EXISTS video_codec text;
ALTER TABLE hospitality.media ADD COLUMN IF NOT EXISTS duration_checked_at timestamptz;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_video_codec_check;
ALTER TABLE hospitality.media ADD CONSTRAINT media_video_codec_check
  CHECK (video_codec IS NULL OR video_codec IN ('h264', 'hevc', 'av1', 'vp8', 'vp9', 'other'));
-- אורך ובדיקה — רק לסרטון שהועלה (לא לתמונה ולא להטמעה)
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_video_check_kind;
ALTER TABLE hospitality.media ADD CONSTRAINT media_video_check_kind
  CHECK (kind = 'video' OR (duration_checked_at IS NULL AND video_codec IS NULL));
CREATE INDEX IF NOT EXISTS media_video_unchecked_idx ON hospitality.media (created_at)
  WHERE kind = 'video' AND duration_checked_at IS NULL;

-- הגבול: 15 שניות + סובלנות של חצי שנייה ("15 שניות" בטלפון יוצא לפעמים 15.3). אותו גבול ב-video-info.ts
CREATE OR REPLACE FUNCTION hospitality._hero_video_max_seconds()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT 15.5::numeric $$;
REVOKE ALL ON FUNCTION hospitality._hero_video_max_seconds() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 1. השרת רושם את מה שמדד (מפתח השירות בלבד)
-- ------------------------------------------------------------
-- _seconds NULL — הקובץ לא נקרא (נרשם כנבדק, ולא יוצג בפתיח). מחזיר אם מתאים לפתיח
CREATE OR REPLACE FUNCTION hospitality.media_video_verified(_tenant uuid, _id uuid, _seconds numeric, _codec text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m hospitality.media;
  _s numeric := CASE WHEN _seconds IS NULL OR _seconds <= 0 OR _seconds > 999999 THEN NULL
                     ELSE round(_seconds, 2) END;
  _c text := CASE WHEN _codec IS NULL THEN NULL
                  WHEN _codec IN ('h264', 'hevc', 'av1', 'vp8', 'vp9') THEN _codec ELSE 'other' END;
BEGIN
  UPDATE hospitality.media x
     SET duration_seconds = _s, video_codec = _c, duration_checked_at = now(), updated_at = now()
   WHERE x.tenant_id = _tenant AND x.id = _id AND x.kind = 'video'
  RETURNING * INTO m;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'הסרטון לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', m.id, 'seconds', m.duration_seconds, 'codec', m.video_codec,
                            'hero_ok', m.duration_seconds IS NOT NULL
                                       AND m.duration_seconds <= hospitality._hero_video_max_seconds());
END $$;
REVOKE ALL ON FUNCTION hospitality.media_video_verified(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.media_video_verified(uuid, uuid, numeric, text) TO service_role;

-- סרטונים שעוד לא נבדקו (הישנים קודם) — לבדיקה ברקע
CREATE OR REPLACE FUNCTION hospitality.media_videos_to_check(_limit integer DEFAULT 5)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', m.tenant_id, 'id', m.id,
                                               'storage_path', m.storage_path, 'size_bytes', m.size_bytes)
                            ORDER BY m.created_at), '[]'::jsonb)
    FROM (SELECT * FROM hospitality.media x
           WHERE x.kind = 'video' AND x.duration_checked_at IS NULL AND x.storage_path IS NOT NULL
           ORDER BY x.created_at
           LIMIT LEAST(GREATEST(COALESCE(_limit, 5), 1), 20)) m;
$$;
REVOKE ALL ON FUNCTION hospitality.media_videos_to_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.media_videos_to_check(integer) TO service_role;

-- ------------------------------------------------------------
-- 2. הסרטון בעורך ובאתר
-- ------------------------------------------------------------
-- הגלריה בניהול: גם האורך שנמדד, ה-codec והאם נבדק (כדי להראות לבעל העסק למה הסרטון לא מוצג)
CREATE OR REPLACE FUNCTION hospitality._media_json(m hospitality.media)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'variants', m.variants,
    'embed_provider', m.embed_provider, 'embed_id', m.embed_id, 'alt', m.alt, 'width', m.width,
    'height', m.height, 'size_bytes', m.size_bytes, 'is_cover', m.is_cover, 'sort_order', m.sort_order,
    'is_demo', m.is_demo, 'licence_ref', m.licence_ref, 'source_url', m.source_url,
    'duration_seconds', m.duration_seconds, 'video_codec', m.video_codec,
    'duration_checked', m.duration_checked_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._media_json(hospitality.media) FROM PUBLIC, anon, authenticated;

-- האתר: כמו במיגרציה 42, ועוד 'seconds' — האורך שהשרת מדד (רק לסרטון; null — לא נמדד / לא נקרא)
CREATE OR REPLACE FUNCTION hospitality._public_media(_t uuid, _kind text, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'path', m.storage_path, 'variants', m.variants,
           'embed_provider', m.embed_provider, 'embed_id', m.embed_id,
           'alt', m.alt, 'width', m.width, 'height', m.height, 'is_cover', m.is_cover, 'is_demo', m.is_demo,
           'seconds', CASE WHEN m.kind = 'video' AND m.duration_checked_at IS NOT NULL THEN m.duration_seconds END)
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

-- ------------------------------------------------------------
-- 3. החלפת קובץ: כמו במיגרציה 12, והבדיקה מתאפסת (הקובץ החדש נמדד מחדש בשרת)
-- ------------------------------------------------------------
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
         is_demo = false, licence_ref = NULL,
         duration_seconds = NULL, video_codec = NULL, duration_checked_at = NULL
   WHERE x.tenant_id = _t AND x.id = _id;
  PERFORM hospitality._audit(_t, 'media.replaced', NULL, jsonb_build_object('kind', o.kind));
  RETURN jsonb_build_object('item', hospitality._media_json(hospitality._media_get(_t, _id, false)),
                            'removed_files', hospitality._media_files(o));
END $$;
REVOKE ALL ON FUNCTION hospitality.media_replace(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.media_replace(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. מסמך העיצוב: סרטון הפתיח
-- ------------------------------------------------------------
-- מזהה סרטון הפתיח שבמסמך (המקטע 'hero' — מופיע פעם אחת; normalizeDesign לוקח את הראשון). null — אין
CREATE OR REPLACE FUNCTION hospitality._hero_video_ref(_document jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (SELECT s -> 'content' -> 'video'
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_document -> 'sections') = 'array'
                                           THEN _document -> 'sections' ELSE '[]'::jsonb END) WITH ORDINALITY e(s, i)
           WHERE jsonb_typeof(s) = 'object' AND s ->> 'type' = 'hero'
             AND jsonb_typeof(s -> 'content') = 'object' AND (s -> 'content') ? 'video'
             AND jsonb_typeof(s -> 'content' -> 'video') <> 'null'
           ORDER BY i LIMIT 1);
$$;
REVOKE ALL ON FUNCTION hospitality._hero_video_ref(jsonb) FROM PUBLIC, anon, authenticated;

-- למה סרטון הפתיח לא מתאים (עברית, לבעל העסק) — או null. _strict: גם "עוד לא נמדד" הוא בעיה
CREATE OR REPLACE FUNCTION hospitality._hero_video_problem(_t uuid, _document jsonb, _strict boolean)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _ref jsonb := hospitality._hero_video_ref(_document);
  m hospitality.media;
BEGIN
  IF _ref IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_ref) <> 'string'
     OR (_ref #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 'סרטון הפתיח לא תקין — הסירו אותו והעלו שוב';
  END IF;
  SELECT * INTO m FROM hospitality.media x
   WHERE x.tenant_id = _t AND x.id = (_ref #>> '{}')::uuid AND x.owner_kind <> 'brand';
  IF m.id IS NULL THEN
    RETURN 'סרטון הפתיח לא נמצא בתמונות של האתר — הסירו אותו והעלו שוב';
  END IF;
  IF m.kind <> 'video' THEN
    RETURN 'בפתיח אפשר רק סרטון שהועלה לאתר (לא תמונה ולא קישור ל-YouTube / Vimeo)';
  END IF;
  IF m.duration_checked_at IS NULL THEN
    RETURN CASE WHEN _strict THEN 'אורך הסרטון עוד לא נבדק — העלו אותו דרך "העלאת סרטון" בפתיח' END;
  END IF;
  IF m.duration_seconds IS NULL THEN
    RETURN 'לא הצלחנו לקרוא את אורך הסרטון. שמרו אותו מחדש כ-MP4 והעלו שוב';
  END IF;
  IF m.duration_seconds > hospitality._hero_video_max_seconds() THEN
    RETURN format('סרטון הפתיח ארוך מדי (%s שניות). עד 15 שניות — הסירו אותו או העלו סרטון קצר יותר',
                  round(m.duration_seconds)::integer);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality._hero_video_problem(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- שמירת הטיוטה (אוטומטית) — כמו במיגרציה 21, ועוד: סרטון פתיח חדש / שהשתנה חייב להיות תקין
CREATE OR REPLACE FUNCTION hospitality.site_draft_save(_revision integer, _theme text, _document jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  _problem text;
BEGIN
  IF _document IS NULL OR jsonb_typeof(_document) <> 'object' THEN
    RAISE EXCEPTION 'מסמך האתר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF pg_column_size(_document) > 262144 THEN
    RAISE EXCEPTION 'מסמך האתר גדול מדי' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft' FOR UPDATE;
  -- ערך שלא השתנה מהטיוטה הקיימת לא חוסם (טיוטה מלפני הבדיקה); ערך חדש — נבדק במלואו
  IF hospitality._hero_video_ref(_document) IS DISTINCT FROM hospitality._hero_video_ref(d.document) THEN
    _problem := hospitality._hero_video_problem(_t, _document, true);
    IF _problem IS NOT NULL THEN
      RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
    END IF;
  END IF;
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

-- פרסום — כמו במיגרציה 21, ועוד: סרטון פתיח שנמדד ונמצא לא מתאים חוסם את הפרסום (עם הסבר)
CREATE OR REPLACE FUNCTION hospitality.site_publish(_revision integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  _v integer;
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
  _problem text;
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
  _problem := hospitality._hero_video_problem(_t, d.document, false);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
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

COMMIT;

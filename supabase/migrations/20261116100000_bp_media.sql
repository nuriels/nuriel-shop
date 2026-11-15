-- ============================================================
-- מיגרציה 194: ספריית המדיה של אתרי העסקים (Nuriel Websites, Stage 2)
--
-- • business_profile.media — תמונה לכל שורה: הנתיב בדלי, הגדלים (WebP / AVIF), מידות, גודל, טקסט חלופי לפי שפה
--   ({he, en?}). הקבצים עצמם נבדקים ומקודדים מחדש בשרת (sharp: בלי מטא-דאטה ומיקום, בלי SVG / HEIC / אנימציה).
-- • הדלי bp-media — קריאה ציבורית (התמונות של האתר), כתיבה ומחיקה רק לנתיב "<האתר של הבקשה>/…", רק למי שרשאי
--   לערוך את האתר, ורק כשהמנוע פעיל לאתר. רק סוגי תמונה, עד 8MB לקובץ.
-- • מכסה לכל אתר (business_profile.sites.media_quota_bytes, ברירת מחדל 200MB) — מגבלה טכנית, לא מחיר; מנהל
--   הפלטפורמה יכול לשנות.
-- • גולש מקבל רק תמונות שמופיעות בגרסה המפורסמת (bp_media_public) — לא את כל הספרייה.
-- • תמונה שבשימוש בטיוטה, בבקשת פרסום או בגרסה שבאוויר — לא נמחקת.
--
-- Rollback: supabase/rollbacks/20261116100000_bp_media.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE business_profile.sites
  ADD COLUMN IF NOT EXISTS media_quota_bytes bigint NOT NULL DEFAULT 209715200
    CHECK (media_quota_bytes BETWEEN 0 AND 10737418240);

CREATE TABLE IF NOT EXISTS business_profile.media (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'image' CHECK (kind = 'image'),
  storage_path  text NOT NULL CHECK (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  -- הגדלים הנוספים: {"960": "<path>", "480": "<path>", "avif": "<path>"}
  variants      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variants) = 'object' AND pg_column_size(variants) <= 1024),
  width         integer CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height        integer CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  size_bytes    bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  alt           jsonb NOT NULL DEFAULT '{"he": ""}'::jsonb CHECK (jsonb_typeof(alt) = 'object' AND pg_column_size(alt) <= 1024),
  original_name text CHECK (original_name IS NULL OR char_length(original_name) <= 200),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (split_part(storage_path, '/', 1) = tenant_id::text)
);
CREATE INDEX IF NOT EXISTS bp_media_tenant ON business_profile.media (tenant_id, created_at DESC);
ALTER TABLE business_profile.media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON business_profile.media FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON business_profile.media TO service_role;

-- כל מזהי המדיה שמסמך מפנה אליהם ({"media": "<uuid>"} בכל עומק)
CREATE OR REPLACE FUNCTION business_profile._media_ids(_doc jsonb)
RETURNS uuid[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT (v #>> '{}')::uuid), '{}')
    FROM jsonb_path_query(COALESCE(_doc, '{}'::jsonb), 'strict $.**.media') AS v
   WHERE jsonb_typeof(v) = 'string'
     AND (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
REVOKE ALL ON FUNCTION business_profile._media_ids(jsonb) FROM PUBLIC, anon, authenticated;

-- מותר לכתוב לדלי של האתר הזה (מדיניות ה-Storage): עריכת תוכן באתר עסק שהמנוע פעיל בו
CREATE OR REPLACE FUNCTION public.bp_media_can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT business_profile.request_site() IS NOT NULL
     AND public.platform_feature_enabled('business_profile_enabled', business_profile.request_site())
     AND business_profile.can('content.edit');
$$;
REVOKE ALL ON FUNCTION public.bp_media_can_write() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_media_can_write() TO authenticated;

-- ---------- ממשק הניהול ----------
CREATE OR REPLACE FUNCTION public.bp_media_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
BEGIN
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'storage_path', m.storage_path, 'variants', m.variants, 'width', m.width,
               'height', m.height, 'size_bytes', m.size_bytes, 'alt', m.alt, 'original_name', m.original_name,
               'created_at', m.created_at) ORDER BY m.created_at DESC)
             FROM business_profile.media m WHERE m.tenant_id = _t), '[]'::jsonb),
    'used_bytes', (SELECT COALESCE(sum(m.size_bytes), 0) FROM business_profile.media m WHERE m.tenant_id = _t),
    'quota_bytes', (SELECT s.media_quota_bytes FROM business_profile.sites s WHERE s.tenant_id = _t));
END $$;

-- בדיקה לפני העלאה (האם יש מקום) — כדי לא לשמור קבצים שלא יירשמו
CREATE OR REPLACE FUNCTION public.bp_media_check_quota(_bytes bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  _used bigint;
  _quota bigint;
BEGIN
  SELECT COALESCE(sum(m.size_bytes), 0) INTO _used FROM business_profile.media m WHERE m.tenant_id = _t;
  SELECT s.media_quota_bytes INTO _quota FROM business_profile.sites s WHERE s.tenant_id = _t;
  IF _used + GREATEST(COALESCE(_bytes, 0), 0) > _quota THEN
    RAISE EXCEPTION 'אין מספיק מקום בספריית המדיה (בשימוש % מתוך % MB)',
      round(_used / 1048576.0), round(_quota / 1048576.0) USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object('site', _t, 'used_bytes', _used, 'quota_bytes', _quota);
END $$;

-- רישום תמונה שהשרת כבר בדק, קידד ושמר בדלי (בנתיב של האתר הזה)
CREATE OR REPLACE FUNCTION public.bp_media_add(_id uuid, _storage_path text, _variants jsonb, _width integer,
                                                _height integer, _size_bytes bigint, _alt jsonb DEFAULT NULL,
                                                _original_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  _used bigint;
  _quota bigint;
  _v text;
BEGIN
  IF split_part(COALESCE(_storage_path, ''), '/', 1) <> _t::text THEN
    RAISE EXCEPTION 'נתיב הקובץ לא שייך לאתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOR _v IN SELECT value FROM jsonb_each_text(COALESCE(_variants, '{}'::jsonb)) LOOP
    IF split_part(_v, '/', 1) <> _t::text OR _v !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-[a-z0-9]{2,8}\.(webp|avif)$' THEN
      RAISE EXCEPTION 'נתיב הקובץ לא שייך לאתר הזה' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_media:' || _t::text, 0));
  SELECT COALESCE(sum(m.size_bytes), 0) INTO _used FROM business_profile.media m WHERE m.tenant_id = _t;
  SELECT s.media_quota_bytes INTO _quota FROM business_profile.sites s WHERE s.tenant_id = _t;
  IF _used + _size_bytes > _quota THEN
    RAISE EXCEPTION 'אין מספיק מקום בספריית המדיה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO business_profile.media (id, tenant_id, storage_path, variants, width, height, size_bytes, alt,
                                      original_name, created_by)
  VALUES (_id, _t, _storage_path, COALESCE(_variants, '{}'::jsonb), _width, _height, _size_bytes,
          COALESCE(_alt, '{"he": ""}'::jsonb), NULLIF(btrim(COALESCE(_original_name, '')), ''), auth.uid());
  PERFORM business_profile._log(_t, 'media.added', jsonb_build_object('id', _id, 'bytes', _size_bytes));
  RETURN jsonb_build_object('id', _id);
END $$;

CREATE OR REPLACE FUNCTION public.bp_media_set_alt(_id uuid, _alt jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
BEGIN
  IF jsonb_typeof(_alt) IS DISTINCT FROM 'object' OR char_length(COALESCE(_alt ->> 'he', '')) > 200
     OR char_length(COALESCE(_alt ->> 'en', '')) > 200 THEN
    RAISE EXCEPTION 'טקסט חלופי עד 200 תווים' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE business_profile.media SET alt = jsonb_strip_nulls(jsonb_build_object('he', COALESCE(_alt ->> 'he', ''), 'en', _alt ->> 'en'))
   WHERE id = _id AND tenant_id = _t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', _id);
END $$;

-- מחיקה: לא כשהתמונה בטיוטה, בבקשת פרסום או בגרסה שבאוויר. מחזיר את הנתיבים למחיקה מהדלי
CREATE OR REPLACE FUNCTION public.bp_media_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  m business_profile.media;
BEGIN
  SELECT * INTO m FROM business_profile.media x WHERE x.id = _id AND x.tenant_id = _t;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'התמונה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM business_profile.site_versions v
              LEFT JOIN business_profile.sites s ON s.live_version_id = v.id
              WHERE v.tenant_id = _t AND (v.state IN ('draft', 'pending') OR s.tenant_id IS NOT NULL)
                AND _id = ANY (business_profile._media_ids(v.document))) THEN
    RAISE EXCEPTION 'התמונה בשימוש באתר — הסירו אותה מהאתר קודם' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM business_profile.media WHERE id = _id;
  PERFORM business_profile._log(_t, 'media.deleted', jsonb_build_object('id', _id));
  RETURN jsonb_build_object('paths', to_jsonb(ARRAY[m.storage_path] ||
                                     ARRAY(SELECT value FROM jsonb_each_text(m.variants))));
END $$;

-- ---------- האתר הציבורי ----------
-- רק תמונות שמופיעות בגרסה המפורסמת של האתר של הבקשה (באותם תנאים של bp_public_site)
CREATE OR REPLACE FUNCTION public.bp_media_public()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'variants', m.variants,
                                               'width', m.width, 'height', m.height)), '[]'::jsonb)
    FROM public.tenants t
    JOIN business_profile.sites s ON s.tenant_id = t.id AND s.first_approved_at IS NOT NULL
    JOIN business_profile.site_versions v ON v.id = s.live_version_id AND v.state = 'published'
    JOIN business_profile.media m ON m.tenant_id = t.id AND m.id = ANY (business_profile._media_ids(v.document))
   WHERE t.id = business_profile.request_site()
     AND t.status = 'active'
     AND public.platform_feature_enabled('business_profile_enabled', t.id)
     AND public.platform_feature_enabled('business_profile_public', t.id);
$$;

-- מנהל הפלטפורמה, בבדיקת בקשת הפרסום: רק התמונות שמופיעות בצילום שנשלח לאישור (לא כל הספרייה)
CREATE OR REPLACE FUNCTION public.platform_bp_review_media(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _r jsonb;
BEGIN
  PERFORM business_profile._require_platform_admin();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'storage_path', m.storage_path, 'variants', m.variants,
                                               'width', m.width, 'height', m.height)), '[]'::jsonb)
    INTO _r
    FROM business_profile.site_versions v
    JOIN business_profile.media m ON m.tenant_id = v.tenant_id AND m.id = ANY (business_profile._media_ids(v.document))
   WHERE v.tenant_id = _tenant AND v.state = 'pending';
  RETURN _r;
END $$;

-- מנהל הפלטפורמה: מכסת המדיה של אתר (מגבלה טכנית)
CREATE OR REPLACE FUNCTION public.platform_bp_set_media_quota(_tenant uuid, _bytes bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM business_profile._require_platform_admin();
  UPDATE business_profile.sites SET media_quota_bytes = _bytes, updated_at = now() WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'אתר העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM business_profile._log(_tenant, 'media.quota_set', jsonb_build_object('bytes', _bytes));
  RETURN jsonb_build_object('quota_bytes', _bytes);
END $$;

REVOKE ALL ON FUNCTION public.bp_media_list(), public.bp_media_check_quota(bigint),
  public.bp_media_add(uuid, text, jsonb, integer, integer, bigint, jsonb, text), public.bp_media_set_alt(uuid, jsonb),
  public.bp_media_delete(uuid), public.bp_media_public(), public.platform_bp_set_media_quota(uuid, bigint),
  public.platform_bp_review_media(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_media_list(), public.bp_media_check_quota(bigint),
  public.bp_media_add(uuid, text, jsonb, integer, integer, bigint, jsonb, text), public.bp_media_set_alt(uuid, jsonb),
  public.bp_media_delete(uuid), public.platform_bp_set_media_quota(uuid, bigint), public.platform_bp_review_media(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_media_public() TO anon, authenticated, service_role;

-- ---------- הדלי ----------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('bp-media', 'bp-media', true, 8388608, ARRAY['image/webp', 'image/avif'])
    ON CONFLICT (id) DO UPDATE
      SET public = true, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    -- (ההעלאה של Storage קוראת את השורה שנוצרה — צריך גם קריאה לעורכים; הגולשים קוראים דרך הכתובת הציבורית)
    DROP POLICY IF EXISTS "bp media editor read" ON storage.objects;
    CREATE POLICY "bp media editor read" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'bp-media'
             AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
             AND (SELECT public.bp_media_can_write()));
    DROP POLICY IF EXISTS "bp media editor insert" ON storage.objects;
    CREATE POLICY "bp media editor insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'bp-media'
                  AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
                  AND (SELECT public.bp_media_can_write()));
    DROP POLICY IF EXISTS "bp media editor delete" ON storage.objects;
    CREATE POLICY "bp media editor delete" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'bp-media'
             AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
             AND (SELECT public.bp_media_can_write()));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

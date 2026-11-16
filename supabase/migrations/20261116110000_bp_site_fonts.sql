-- ============================================================
-- מיגרציה 195: גופני אתר בספריית המדיה + תבנית "קלאסית" (Nuriel Websites — שחזור נאמן של אתר קיים)
--
-- • גופני אתר: קובצי WOFF2 של האתר עצמו (למשל הגופנים שהאתר הישן אירח) נשמרים בספריית המדיה של אותו אתר,
--   באותו דלי ובאותה תיקייה, ונספרים במכסה. לכל גופן: משפחה, משקל (או טווח לגופן משתנה), סגנון, טווח Unicode
--   ורישיון. הקובץ נבדק בשרת (חתימת WOFF2, עד 2MB) ונשמר כמו שהוא — הדפדפן מאמת גופנים בעצמו (OTS).
-- • מסמך האתר מפנה לגופן לפי מזהה המדיה ({"media": …}), ולכן: הגולש מקבל רק גופנים שבגרסה המפורסמת, וגופן בשימוש
--   לא נמחק (אותם כללים של התמונות, בלי קוד נוסף).
-- • תבנית "קלאסית" (classic) — זמינה.
--
-- Rollback: supabase/rollbacks/20261116110000_bp_site_fonts.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO business_profile.templates (key, label_he, label_en, status, sort)
VALUES ('classic', 'קלאסית', 'Classic', 'available', 7)
ON CONFLICT (key) DO UPDATE SET label_he = EXCLUDED.label_he, label_en = EXCLUDED.label_en,
                                status = EXCLUDED.status, sort = EXCLUDED.sort;

-- סוג המדיה: תמונה או גופן; נתיב: ‎.webp (תמונה) או ‎.woff2 (גופן); פרטי הגופן — רק לגופן
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS media_kind_check;
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS media_storage_path_check;
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS bp_media_kind_path;
ALTER TABLE business_profile.media ADD COLUMN IF NOT EXISTS font jsonb;
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS bp_media_font_shape;
ALTER TABLE business_profile.media
  ADD CONSTRAINT media_kind_check CHECK (kind IN ('image', 'font')),
  ADD CONSTRAINT bp_media_kind_path CHECK (
    (kind = 'image' AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' AND font IS NULL)
    OR (kind = 'font' AND storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.woff2$' AND font IS NOT NULL
        AND variants = '{}'::jsonb)),
  ADD CONSTRAINT bp_media_font_shape CHECK (font IS NULL OR (jsonb_typeof(font) = 'object' AND pg_column_size(font) <= 8192));

-- בדיקת פרטי גופן (משותפת להוספה ולבדיקות): משפחה, משקל/טווח, סגנון, טווח Unicode, רישיון
CREATE OR REPLACE FUNCTION business_profile._font_meta_ok(_font jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(_font) = 'object'
     AND COALESCE(_font ->> 'family', '') ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$'
     AND COALESCE(_font ->> 'weight', '') ~ '^[1-9]00( [1-9]00)?$'
     AND COALESCE(_font ->> 'style', '') IN ('normal', 'italic')
     AND COALESCE(_font ->> 'unicode_range', '') ~ '^(|U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(, ?U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?){0,250})$'
     AND char_length(COALESCE(_font ->> 'license', '')) <= 120;
$$;
REVOKE ALL ON FUNCTION business_profile._font_meta_ok(jsonb) FROM PUBLIC, anon, authenticated;

-- רישום גופן שהשרת כבר בדק ושמר בדלי (בנתיב של האתר הזה)
CREATE OR REPLACE FUNCTION public.bp_media_add_font(_id uuid, _storage_path text, _size_bytes bigint, _font jsonb,
                                                     _original_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  _used bigint;
  _quota bigint;
BEGIN
  IF split_part(COALESCE(_storage_path, ''), '/', 1) <> _t::text
     OR _storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.woff2$' THEN
    RAISE EXCEPTION 'נתיב הקובץ לא שייך לאתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT business_profile._font_meta_ok(_font) THEN
    RAISE EXCEPTION 'פרטי הגופן לא תקינים (משפחה, משקל, סגנון או טווח תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_size_bytes, 0) NOT BETWEEN 1 AND 2097152 THEN
    RAISE EXCEPTION 'קובץ הגופן גדול מדי — עד 2MB' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_media:' || _t::text, 0));
  SELECT COALESCE(sum(m.size_bytes), 0) INTO _used FROM business_profile.media m WHERE m.tenant_id = _t;
  SELECT s.media_quota_bytes INTO _quota FROM business_profile.sites s WHERE s.tenant_id = _t;
  IF _used + _size_bytes > _quota THEN
    RAISE EXCEPTION 'אין מספיק מקום בספריית המדיה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO business_profile.media (id, tenant_id, kind, storage_path, variants, size_bytes, alt, original_name,
                                      font, created_by)
  VALUES (_id, _t, 'font', _storage_path, '{}'::jsonb, _size_bytes, '{"he": ""}'::jsonb,
          NULLIF(btrim(COALESCE(_original_name, '')), ''),
          jsonb_build_object('family', _font ->> 'family', 'weight', _font ->> 'weight', 'style', _font ->> 'style',
                             'unicode_range', COALESCE(_font ->> 'unicode_range', ''),
                             'license', COALESCE(_font ->> 'license', '')),
          auth.uid());
  PERFORM business_profile._log(_t, 'media.font_added', jsonb_build_object('id', _id, 'bytes', _size_bytes,
                                                                            'family', _font ->> 'family'));
  RETURN jsonb_build_object('id', _id);
END $$;

-- הספרייה בממשק הניהול: עכשיו גם הסוג ופרטי הגופן
CREATE OR REPLACE FUNCTION public.bp_media_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
BEGIN
  RETURN jsonb_build_object(
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'kind', m.kind, 'storage_path', m.storage_path, 'variants', m.variants, 'width', m.width,
               'height', m.height, 'size_bytes', m.size_bytes, 'alt', m.alt, 'original_name', m.original_name,
               'font', m.font, 'created_at', m.created_at) ORDER BY m.created_at DESC)
             FROM business_profile.media m WHERE m.tenant_id = _t), '[]'::jsonb),
    'used_bytes', (SELECT COALESCE(sum(m.size_bytes), 0) FROM business_profile.media m WHERE m.tenant_id = _t),
    'quota_bytes', (SELECT s.media_quota_bytes FROM business_profile.sites s WHERE s.tenant_id = _t));
END $$;

-- הגולש: רק מה שבגרסה המפורסמת (תמונות וגופנים), עם הסוג
CREATE OR REPLACE FUNCTION public.bp_media_public()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
                                               'variants', m.variants, 'width', m.width, 'height', m.height)), '[]'::jsonb)
    FROM public.tenants t
    JOIN business_profile.sites s ON s.tenant_id = t.id AND s.first_approved_at IS NOT NULL
    JOIN business_profile.site_versions v ON v.id = s.live_version_id AND v.state = 'published'
    JOIN business_profile.media m ON m.tenant_id = t.id AND m.id = ANY (business_profile._media_ids(v.document))
   WHERE t.id = business_profile.request_site()
     AND t.status = 'active'
     AND public.platform_feature_enabled('business_profile_enabled', t.id)
     AND public.platform_feature_enabled('business_profile_public', t.id);
$$;

CREATE OR REPLACE FUNCTION public.platform_bp_review_media(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _r jsonb;
BEGIN
  PERFORM business_profile._require_platform_admin();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'storage_path', m.storage_path,
                                               'variants', m.variants, 'width', m.width, 'height', m.height)), '[]'::jsonb)
    INTO _r
    FROM business_profile.site_versions v
    JOIN business_profile.media m ON m.tenant_id = v.tenant_id AND m.id = ANY (business_profile._media_ids(v.document))
   WHERE v.tenant_id = _tenant AND v.state = 'pending';
  RETURN _r;
END $$;

-- הדלי: גם WOFF2 (תמונות — כמו קודם)
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/webp', 'image/avif', 'font/woff2']
     WHERE id = 'bp-media';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.bp_media_add_font(uuid, text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_media_add_font(uuid, text, bigint, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.bp_media_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_media_list() TO authenticated;
REVOKE ALL ON FUNCTION public.bp_media_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bp_media_public() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_bp_review_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_bp_review_media(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

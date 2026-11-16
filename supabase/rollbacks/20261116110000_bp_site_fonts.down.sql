-- ============================================================
-- Rollback של 20261116110000_bp_site_fonts.sql (מיגרציה 195 — גופני אתר + תבנית "קלאסית")
-- הגנה: נעצר כשיש גופן בספריית המדיה, או כשגרסה כלשהי (טיוטה, בקשה או מפורסמת) בנויה בתבנית "קלאסית".
-- בלי נתונים: הפונקציות חוזרות לגרסה של 194, העמודה והאילוצים חוזרים, הדלי חוזר לתמונות בלבד, והתבנית נמחקת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_profile.media WHERE kind = 'font') THEN
    RAISE EXCEPTION 'יש גופנים בספריית המדיה של אתרי העסקים — rollback היה מוחק אותם. לא מבוצע';
  END IF;
  IF EXISTS (SELECT 1 FROM business_profile.site_versions WHERE template = 'classic') THEN
    RAISE EXCEPTION 'יש אתר בתבנית "קלאסית" — rollback היה שובר אותו. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.bp_media_add_font(uuid, text, bigint, jsonb, text);
DROP FUNCTION IF EXISTS business_profile._font_meta_ok(jsonb);

ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS bp_media_kind_path;
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS bp_media_font_shape;
ALTER TABLE business_profile.media DROP CONSTRAINT IF EXISTS media_kind_check;
ALTER TABLE business_profile.media DROP COLUMN IF EXISTS font;
ALTER TABLE business_profile.media
  ADD CONSTRAINT media_kind_check CHECK (kind = 'image'),
  ADD CONSTRAINT media_storage_path_check CHECK (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$');

-- הפונקציות — בדיוק כמו במיגרציה 194
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

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET allowed_mime_types = ARRAY['image/webp', 'image/avif'] WHERE id = 'bp-media';
  END IF;
END $$;

DELETE FROM business_profile.templates WHERE key = 'classic';

NOTIFY pgrst, 'reload schema';

COMMIT;

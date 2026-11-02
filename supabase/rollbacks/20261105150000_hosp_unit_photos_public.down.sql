-- ============================================================
-- Rollback — מיגרציה 38 (20261105150000_hosp_unit_photos_public.sql)
-- מחזיר את _public_media כפי שהייתה במיגרציה 19 (20261102130000_hosp_public_site.sql), מילה במילה —
-- כלומר בחזרה למצב שבו התמונות של היחידות לא מופיעות באתר. בלי שינוי בנתונים.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION hospitality._public_media(_t uuid, _kind text, _property uuid, _unit uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'path', m.storage_path, 'variants', m.variants,
           'embed_provider', m.embed_provider, 'embed_id', m.embed_id,
           'alt', m.alt, 'width', m.width, 'height', m.height, 'is_cover', m.is_cover, 'is_demo', m.is_demo)
           ORDER BY m.is_cover DESC, m.sort_order, m.created_at), '[]'::jsonb)
    FROM hospitality.media m
   WHERE m.tenant_id = _t AND m.owner_kind = _kind
     AND m.property_id IS NOT DISTINCT FROM _property AND m.unit_id IS NOT DISTINCT FROM _unit;
$$;
REVOKE ALL ON FUNCTION hospitality._public_media(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

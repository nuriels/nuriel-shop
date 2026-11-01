-- ============================================================
-- Rollback: 20261101200000_hosp_media.sql
-- חזרה למצב של מיגרציה 11: הצוות כותב שוב ישירות ל-media (כמו במיגרציה 3; RLS לפי
-- media), בלי פונקציות הגלריה, בלי variants / source_url.
-- הגנה: נעצר אם נשמרו תמונות דרך שלב 2e (גדלים נוספים או ייבוא מקישור) — לא מוחקים מידע
-- בשקט. הקבצים בדלי לא נמחקים כאן (Storage API בלבד).
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _saved boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'hospitality' AND table_name = 'media' AND column_name = 'variants') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM hospitality.media WHERE variants <> ''{}''::jsonb OR source_url IS NOT NULL)'
      INTO _saved;
  END IF;
  IF _saved THEN
    RAISE EXCEPTION 'rollback refused: 2e media (size variants or link imports) were saved';
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.media_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.media_replace(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality.media_reorder(text, uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS hospitality.media_set_cover(uuid);
DROP FUNCTION IF EXISTS hospitality.media_update(uuid, text);
DROP FUNCTION IF EXISTS hospitality.media_add_embed(text, uuid, text, text, text);
DROP FUNCTION IF EXISTS hospitality.media_add(text, uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality.media_galleries();
DROP FUNCTION IF EXISTS hospitality.media_list(text, uuid);
DROP FUNCTION IF EXISTS hospitality._media_get(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS hospitality._media_ensure_cover(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._media_usage(uuid);
DROP FUNCTION IF EXISTS hospitality._media_json(hospitality.media);
DROP FUNCTION IF EXISTS hospitality._media_files(hospitality.media);
DROP FUNCTION IF EXISTS hospitality._media_item(uuid, jsonb);
DROP FUNCTION IF EXISTS hospitality._media_path_ok(uuid, text, boolean);
DROP FUNCTION IF EXISTS hospitality._media_in_gallery(hospitality.media, text, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._media_gallery_lock(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS hospitality._media_owner(uuid, text, uuid);

GRANT INSERT, UPDATE, DELETE ON hospitality.media TO authenticated;

DROP INDEX IF EXISTS hospitality.media_site_idx;
ALTER TABLE hospitality.media DROP CONSTRAINT IF EXISTS media_details_check;
ALTER TABLE hospitality.media DROP COLUMN IF EXISTS source_url;
ALTER TABLE hospitality.media DROP COLUMN IF EXISTS variants;

COMMIT;

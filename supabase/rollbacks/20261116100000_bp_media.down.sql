-- ============================================================
-- Rollback של 20261116100000_bp_media.sql (מיגרציה 194 — ספריית המדיה של אתרי העסקים)
-- הגנה: נעצר כשיש תמונה כלשהי בספרייה — rollback היה מוחק את הרשומות (והתמונות היו נשארות יתומות בדלי).
-- בלי נתונים: הטבלה, 9 הפונקציות, מדיניות ה-Storage, הדלי (אם ריק) ועמודת המכסה נמחקים.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי ספריית המדיה.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('business_profile.media') IS NOT NULL AND EXISTS (SELECT 1 FROM business_profile.media) THEN
    RAISE EXCEPTION 'יש תמונות בספריית המדיה של אתרי העסקים — rollback היה מוחק אותן. לא מבוצע';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL AND EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'bp-media') THEN
    RAISE EXCEPTION 'יש קבצים בדלי bp-media — rollback היה משאיר אותם בלי רשומות. לא מבוצע';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "bp media editor read" ON storage.objects;
    DROP POLICY IF EXISTS "bp media editor insert" ON storage.objects;
    DROP POLICY IF EXISTS "bp media editor delete" ON storage.objects;
  END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    DELETE FROM storage.buckets WHERE id = 'bp-media';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.platform_bp_review_media(uuid);
DROP FUNCTION IF EXISTS public.platform_bp_set_media_quota(uuid, bigint);
DROP FUNCTION IF EXISTS public.bp_media_public();
DROP FUNCTION IF EXISTS public.bp_media_delete(uuid);
DROP FUNCTION IF EXISTS public.bp_media_set_alt(uuid, jsonb);
DROP FUNCTION IF EXISTS public.bp_media_add(uuid, text, jsonb, integer, integer, bigint, jsonb, text);
DROP FUNCTION IF EXISTS public.bp_media_check_quota(bigint);
DROP FUNCTION IF EXISTS public.bp_media_list();
DROP FUNCTION IF EXISTS public.bp_media_can_write();
DROP FUNCTION IF EXISTS business_profile._media_ids(jsonb);
DROP TABLE IF EXISTS business_profile.media;
ALTER TABLE business_profile.sites DROP COLUMN IF EXISTS media_quota_bytes;

NOTIFY pgrst, 'reload schema';

COMMIT;

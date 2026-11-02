-- ============================================================
-- Hospitality — מיגרציה 38: התמונות של היחידות מופיעות באתר הציבורי
--
-- הבעיה (מיגרציות 19–20): נתוני האתר (_site_payload) מבקשים את התמונות של יחידה לפי המתחם *וגם*
-- היחידה — _public_media(_t, 'unit', u.property_id, u.id) — אבל תמונה של יחידה נשמרת בלי מתחם, כך
-- מחייב ה-CHECK של הטבלה (owner_kind = 'unit' → unit_id מלא ו-property_id ריק), וכל יחידה באתר
-- שייכת למתחם. התוצאה: אף תמונה שבעל העסק העלה ליחידה לא הופיעה באתר הציבורי, בתצוגה המקדימה של
-- העורך, בכרטיס היחידה בטופס ההזמנה ובתמונת השיתוף — רק "התמונות יעלו בקרוב". (נמצא בבדיקת המסלול
-- של עסק חדש: פתיחה → יחידה → העלאת תמונות → פרסום.)
--
-- עכשיו _public_media מזהה את הבעלים של התמונה בדיוק כמו ה-CHECK של הטבלה: האתר — בלי מתחם ובלי
-- יחידה; מתחם — לפי המתחם; יחידה — לפי היחידה בלבד. אותה חתימה, אותן הרשאות (פנימית — בלי הרשאה
-- לאורחים או למשתמשים), אותו סדר (הראשית קודם) ואותם שדות. שום פונקציה אחרת לא משתנה: האתר מציג
-- רק יחידות פעילות של העסק עצמו (כמו קודם), ותמונה של יחידה אחת לא עוברת ליחידה אחרת או למתחם.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105150000_hosp_unit_photos_public.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- תמונות של בעלים אחד (האתר / מתחם / יחידה) — הראשית קודם, לפי הסדר
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
           WHEN 'property' THEN m.property_id = _property
           WHEN 'unit' THEN m.unit_id = _unit
           ELSE false
         END;
$$;
REVOKE ALL ON FUNCTION hospitality._public_media(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

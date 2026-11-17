-- ביטויי חיפוש ראשוניים לנופי דורית — לטיוטת האתר בלבד (design.seo.keywords). לא מפרסם.
--   • נכנס רק לטיוטה, דרך site_draft_save (כמו שמירה בעורך), בשם מנהל הפלטפורמה. אין טיוטה — הטיוטה
--     נוצרת מהגרסה המפורסמת האחרונה, וכל השאר בה נשאר בדיוק כמו שהוא.
--   • לא נוגע בגרסה המפורסמת: האתר החי לא משתנה. גם אחרי פרסום — הביטויים לא מוצגים באתר (אין meta keywords,
--     והם מוסרים מנתוני העמוד). הם רשימת עבודה בלשונית "גוגל ושיתוף".
--   • כבר יש ביטויים בטיוטה, או שזה לא אתר אירוח — עצירה, שום דבר לא משתנה.
--   • הרשימה זהה לבדיקה ב-tests/unit/hospitality-seo-keywords.test.ts (הבלוק בין שורות ה-BEGIN/END KEYWORDS).
-- ביטויים על בריכה / ג'קוזי / אירועים לא נמצאים כאן בכוונה: הם יתווספו רק אחרי שבעל העסק יאשר מה נכון בפועל
-- (ראו docs/audit/nofi-dorit-google-indexing.md, פרק "SEO בעברית וקידום מקומי").
-- שימוש (⛔ רק באישור): docker exec -i <db> psql -U postgres -d postgres -q -tA -v slug=nofi-dorit \
--          -v admin=<platform admin email> < scripts/hospitality/seo-keywords-nofi-dorit.sql
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT a.user_id FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id WHERE lower(u.email) = lower(:'admin')), 'role', 'authenticated')::text, true) IS NOT NULL AS claims,
       set_config('request.headers', json_build_object('x-tenant-id', (SELECT id FROM public.tenants WHERE slug = :'slug' AND site_type = 'hospitality'))::text, true) IS NOT NULL AS tenant
\gset
SELECT set_config('seo.slug', :'slug', true) IS NOT NULL AS s \gset
DO $do$
DECLARE
  _t uuid := (SELECT id FROM public.tenants WHERE slug = current_setting('seo.slug') AND site_type = 'hospitality');
  -- BEGIN KEYWORDS
  _keywords jsonb := $k$[
    {"id": "kw-1", "text": "צימר ליד בית שמש", "group": "local", "primary": true},
    {"id": "kw-2", "text": "צימרים ליד בית שמש", "group": "local"},
    {"id": "kw-3", "text": "נופי דורית", "group": "general"},
    {"id": "kw-4", "text": "נופי דורית חוויה בכפר", "group": "general", "primary": true},
    {"id": "kw-5", "text": "צימר בישעי", "group": "local", "primary": true},
    {"id": "kw-6", "text": "צימרים בישעי", "group": "local"},
    {"id": "kw-7", "text": "צימר לזוגות ליד בית שמש", "group": "service"},
    {"id": "kw-8", "text": "צימר למשפחות ליד בית שמש", "group": "service"},
    {"id": "kw-9", "text": "חופשה זוגית ליד בית שמש", "group": "service"},
    {"id": "kw-10", "text": "אירוח כפרי באזור בית שמש", "group": "local"}
  ]$k$::jsonb;
  -- END KEYWORDS
  _e jsonb;
  _doc jsonb;
  _theme text;
  _rev integer;
  _r jsonb;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'the hospitality site was not found — nothing changed'; END IF;
  _e := hospitality.site_editor();
  IF _e -> 'draft' IS NOT NULL AND jsonb_typeof(_e -> 'draft') = 'object' THEN
    _doc := _e -> 'draft' -> 'document';
    _theme := _e -> 'draft' ->> 'theme';
    _rev := (_e -> 'draft' ->> 'revision')::integer;
  ELSIF _e -> 'published' IS NOT NULL AND jsonb_typeof(_e -> 'published') = 'object' THEN
    _doc := _e -> 'published' -> 'document';
    _theme := _e -> 'published' ->> 'theme';
    _rev := 0;
  ELSE
    RAISE EXCEPTION 'the site has no design yet — nothing changed';
  END IF;
  IF jsonb_typeof(_doc -> 'seo' -> 'keywords') = 'array' AND jsonb_array_length(_doc -> 'seo' -> 'keywords') > 0 THEN
    RAISE EXCEPTION 'the draft already has % search phrases — nothing changed', jsonb_array_length(_doc -> 'seo' -> 'keywords');
  END IF;
  _doc := jsonb_set(_doc, '{seo}', COALESCE(_doc -> 'seo', '{}'::jsonb) || jsonb_build_object('keywords', _keywords), true);
  _r := hospitality.site_draft_save(_rev, _theme, _doc);
  RAISE NOTICE 'draft saved: revision % (was %), % search phrases', _r ->> 'revision', _rev, jsonb_array_length(_keywords);
END $do$;
COMMIT;
SELECT 'draft phrases: ' || COALESCE(jsonb_array_length(d.document -> 'seo' -> 'keywords'), 0) ||
       ' / published phrases: ' || COALESCE((SELECT jsonb_array_length(p.document -> 'seo' -> 'keywords')
                                       FROM hospitality.site_versions p
                                      WHERE p.tenant_id = d.tenant_id AND p.kind = 'published'
                                      ORDER BY p.version DESC LIMIT 1), 0)
  FROM hospitality.site_versions d
 WHERE d.tenant_id = (SELECT id FROM public.tenants WHERE slug = :'slug' AND site_type = 'hospitality') AND d.kind = 'draft';

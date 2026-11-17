-- מדיניות הפרטיות של אתר צימר, לפני הפעלת המדידה (Google Analytics): המשפט מהתבנית "האתר משתמש רק בעוגיות
-- הכרחיות… אין באתר עוגיות פרסום או מעקב" מוחלף בסעיף על המדידה — בהסכמה בלבד.
--   • הטיוטה: אותו שינוי בלבד (המשתנים {{…}} נשארים). גרסה מפורסמת חדשה: הגרסה המפורסמת הנוכחית + השינוי +
--     תאריך העדכון — דרך site_document_save / site_document_publish (כמו "פרסום" בניהול), בשם מנהל הפלטפורמה,
--     ונרשם ביומן העסק (documents.saved / documents.published).
--   • המשפט לא נמצא (מסמך שנכתב אחרת, או שכבר עודכן) — עצירה, שום דבר לא משתנה.
-- שימוש: docker exec -i <db> psql -U postgres -d postgres -q -tA -v slug=<site> -v admin=<platform admin email> \
--          -v today='17 בנובמבר 2026' < scripts/hospitality/privacy-analytics-section.sql
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claims', json_build_object('sub', (SELECT a.user_id FROM public.platform_admins a JOIN auth.users u ON u.id = a.user_id WHERE lower(u.email) = lower(:'admin')), 'role', 'authenticated')::text, true) IS NOT NULL AS claims,
       set_config('request.headers', json_build_object('x-tenant-id', (SELECT id FROM public.tenants WHERE slug = :'slug'))::text, true) IS NOT NULL AS tenant
\gset
SELECT set_config('privacy.slug', :'slug', true) IS NOT NULL AS s, set_config('privacy.today', :'today', true) IS NOT NULL AS d \gset
DO $do$
DECLARE
  _t uuid := (SELECT id FROM public.tenants WHERE slug = current_setting('privacy.slug'));
  _old text := 'האתר משתמש רק בעוגיות הכרחיות לפעולתו. אין באתר עוגיות פרסום או מעקב.';
  _new text := $n$האתר משתמש בעוגיות הכרחיות לפעולתו (למשל הכניסה לאזור "ההזמנות שלי" ושמירת הבחירה שלכם לגבי עוגיות). אין באתר עוגיות פרסום.
מדידה (Google Analytics) — רק אם אישרתם:
- כדי להבין איך משתמשים באתר ולשפר אותו, האתר נעזר בשירות Google Analytics 4 של Google. השירות פועל רק אחרי שאישרתם זאת בחלון העוגיות; עד אז לא נטען באתר שום קוד של Google.
- נמדדים: אילו עמודים נצפו, צפייה ביחידות ובחבילות, התחלת הזמנה ושליחת בקשת הזמנה, ולחיצות על טלפון, וואטסאפ או אימייל, וכן נתונים טכניים כלליים כמו סוג המכשיר והדפדפן.
- לא נשלחים ל-Google שם, טלפון, אימייל, מספר הזמנה או קישורים אישיים, וכתובת העמוד נשלחת בלי פרמטרים אישיים.
- המידע לא משמש לפרסום: אותות הפרסום של Google חסומים ו-Google Signals כבוי.
- עוגיות המדידה (ששמן מתחיל ב-_ga) נשמרות על כתובת האתר הזה בלבד. הנתונים נשמרים ב-Google Analytics עד חודשיים.
- Google מעבדת את המידע עבור העסק, וייתכן שגם מחוץ לישראל. מידע נוסף במדיניות הפרטיות של Google: policies.google.com/privacy
- אפשר לשנות את הבחירה בכל רגע דרך "הגדרות Cookies" בתחתית האתר. ביטול ההסכמה מפסיק את המדידה ומוחק את עוגיות המדידה מהדפדפן.$n$;
  _today text := current_setting('privacy.today');
  d hospitality.site_documents;
  v hospitality.site_document_versions;
  _saved jsonb;
  _r jsonb;
BEGIN
  IF _t IS NULL THEN RAISE EXCEPTION 'the site was not found — nothing changed'; END IF;
  SELECT * INTO d FROM hospitality.site_documents x WHERE x.tenant_id = _t AND x.kind = 'privacy';
  IF d.kind IS NULL OR d.published_version IS NULL THEN
    RAISE EXCEPTION 'the privacy policy is not published on this site — nothing changed';
  END IF;
  SELECT * INTO v FROM hospitality.site_document_versions x
   WHERE x.tenant_id = _t AND x.kind = 'privacy' AND x.version = d.published_version;
  IF position(_old IN d.draft_body) = 0 OR position(_old IN v.body) = 0 THEN
    RAISE EXCEPTION 'the "necessary cookies only" sentence was not found (draft: %, published: %) — nothing changed',
      position(_old IN d.draft_body) > 0, position(_old IN v.body) > 0;
  END IF;
  _saved := hospitality.site_document_save('privacy', d.draft_title, replace(d.draft_body, _old, _new), d.revision);
  _r := hospitality.site_document_publish('privacy', v.title,
          regexp_replace(replace(v.body, _old, _new), 'תאריך עדכון: [^\n]*', 'תאריך עדכון: ' || _today),
          (_saved ->> 'revision')::integer);
  RAISE NOTICE 'privacy policy published: version % (was %)', _r ->> 'version', d.published_version;
END $do$;
COMMIT;
SELECT 'live version ' || d.published_version || ': ' ||
       (position('Google Analytics 4' IN v.body) > 0)::text || ' / old sentence gone: ' ||
       (position('אין באתר עוגיות פרסום או מעקב' IN v.body) = 0)::text || ' / ' ||
       substring(v.body FROM 'תאריך עדכון: [^\n]*')
  FROM hospitality.site_documents d JOIN hospitality.site_document_versions v
    ON v.tenant_id = d.tenant_id AND v.kind = d.kind AND v.version = d.published_version
 WHERE d.tenant_id = (SELECT id FROM public.tenants WHERE slug = :'slug') AND d.kind = 'privacy';

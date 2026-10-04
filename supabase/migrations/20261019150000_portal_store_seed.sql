-- ============================================================
-- חלק 12 (השלמה): חנות השער של הפלטפורמה — nuriel-app2
--
-- שער הפלטפורמה (דף הנחיתה + כניסה בקוד + פתיחת חנויות) מוצג באתר של
-- החנות שה-slug שלה בדיוק nuriel-app2 (PORTAL_STORE_SLUG ב-src/lib/portal.ts).
-- בלי רשומת חנות כזו, הכתובת nuriel-app2.<base> לא משויכת לאף חנות
-- והשרת מחזיר "החנות לא נמצאה".
--
-- המיגרציה יוצרת את החנות אם היא חסרה (ולא נוגעת בה אם כבר קיימת):
--   • tenants: slug = nuriel-app2, שם "Nuri1 Portal", פעילה.
--     שורות ההגדרות (site_settings / email_settings / שיטת משלוח) נוצרות
--     בטריגר tenants_seed_settings, כמו בכל חנות חדשה.
--   • שם העסק בהגדרות — "Nuri1": מוצג בראש דף הנחיתה, בכותרת הדפדפן,
--     ובשם השולח של מייל הקוד ("Nuri1" <orders@nuri1.fit>). נקבע רק אם
--     עדיין ריק — שינוי שנעשה בהגדרות החנות לא נדרס בהרצה חוזרת.
-- תעודת ה-SSL לכתובת מונפקת אוטומטית ע"י סקריפט התעודות בשרת (כדקה);
-- עד אז האתר זמין ב-http דרך בלוק ה-80 הכללי של nginx.
-- ============================================================
BEGIN;

DO $$
DECLARE
  _slug CONSTANT text := 'nuriel-app2';
  t public.tenants;
  _created boolean := false;
BEGIN
  INSERT INTO public.tenants (slug, name, plan, status)
  VALUES (_slug, 'Nuri1 Portal', 'enterprise', 'active')
  ON CONFLICT (slug) DO NOTHING
  RETURNING * INTO t;
  _created := t.id IS NOT NULL;

  IF NOT _created THEN
    SELECT * INTO t FROM public.tenants WHERE slug = _slug;
  END IF;

  -- גיבוי: אם משום מה אין שורות הגדרות (חנות שנוצרה לפני הטריגר)
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (t.id, t.name, '')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (t.id)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.site_settings
     SET business_name = 'Nuri1'
   WHERE tenant_id = t.id
     AND btrim(COALESCE(business_name, '')) = '';

  IF _created THEN
    RAISE NOTICE '20261019150000: נוצרה חנות השער % (Nuri1 Portal)', _slug;
  ELSE
    RAISE NOTICE '20261019150000: חנות השער % כבר קיימת — לא שונתה', _slug;
  END IF;
  IF t.status <> 'active' THEN
    RAISE WARNING '⚠ חנות השער % מוקפאת — דף הנחיתה לא יוצג עד שחרור ההקפאה בפאנל הפלטפורמה', _slug;
  END IF;
END $$;

COMMIT;

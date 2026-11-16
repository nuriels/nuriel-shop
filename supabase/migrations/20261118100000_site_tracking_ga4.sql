-- ============================================================
-- מיגרציה 199: מזהה Google Analytics 4 בהגדרות העסק — באותה טבלה של Google Tag Manager (site_tracking)
--
-- • public.site_tracking מקבלת עמודה ga4_measurement_id: מזהה מדידה בלבד (G- ואחריו 4 עד 16 אותיות
--   גדולות / ספרות), נבדק כאן (CHECK) ובשרת. כמו GTM — בלי קוד חופשי, הטבלה סגורה ל-API, הכול דרך פונקציות.
-- • מי משנה (GA4 וגם GTM): צימר — בעל העסק או מנהל הפלטפורמה (hospitality.can('ownership')); עד עכשיו גם
--   מנהל/ת עסק שהבעלים מינה — מעכשיו לא. חנות — בעל החנות (store_staff_role = 'owner', כולל מנהל הפלטפורמה),
--   בלי שינוי. כל שינוי נרשם ב-platform_audit_log.
-- • מי קורא: האתר (גם לאורחים) — site_ga4() מחזירה רק את המזהה של האתר של הבקשה (current_tenant_id() לפי
--   ה-Host), ורק כשהמדידה מותרת לאתר (בצימר: המתג hospitality_analytics_enabled, כבוי כברירת מחדל).
-- • העברה: מזהה GA4 שכבר נשמר בעורך האתר (בגרסה המפורסמת, document.seo.ga4) מועתק לכאן — כך שום אתר לא
--   מאבד מדידה. מעכשיו האתר קורא את המזהה רק מכאן; השדה בעורך האתר הוסר.
-- • הטעינה בדפדפן לא משתנה: GA4 ו-GTM נטענים רק אחרי הסכמה, עם Consent Mode (src/engines/hospitality/
--   website/consent/ga.ts, src/platform/analytics/gtm-client.ts).
--
-- Rollback: supabase/rollbacks/20261118100000_site_tracking_ga4.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.site_tracking
  ADD COLUMN IF NOT EXISTS ga4_measurement_id text
    CONSTRAINT site_tracking_ga4_format CHECK (ga4_measurement_id ~ '^G-[A-Z0-9]{4,16}$');
COMMENT ON COLUMN public.site_tracking.ga4_measurement_id IS
  'מיגרציה 199: מזהה מדידה של Google Analytics 4 (G-XXXXXXXXXX) בלבד. ריק = בלי GA4';

-- מי רשאי לשנות את כלי המדידה של האתר הנוכחי (פנימי). צימר: בעל העסק או מנהל הפלטפורמה בלבד
CREATE OR REPLACE FUNCTION public.site_tracking_can_edit()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RETURN false;
  END IF;
  IF public.current_site_type() = 'hospitality' THEN
    RETURN COALESCE(hospitality.can('ownership'), false);
  END IF;
  -- COALESCE: לקוח / משתמש בלי תפקיד בחנות — NULL, ובלי זה 'NOT NULL' לא היה חוסם
  RETURN COALESCE(public.store_staff_role(auth.uid()) = 'owner', false);
END $$;

-- לאתר (גם לאורחים): מזהה ה-GA4 של האתר של הבקשה, או NULL
CREATE OR REPLACE FUNCTION public.site_ga4()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.ga4_measurement_id FROM public.site_tracking t
   WHERE t.tenant_id = public.current_tenant_id() AND t.ga4_measurement_id IS NOT NULL
     AND public.site_tracking_allowed();
$$;

-- לבעל העסק: ההגדרות השמורות של האתר הזה (GTM + GA4, גם כשהמדידה כבויה)
CREATE OR REPLACE FUNCTION public.my_tag_manager()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.site_tracking;
BEGIN
  IF NOT public.site_tracking_can_edit() THEN
    RAISE EXCEPTION 'רק בעל העסק מנהל את כלי המדידה של האתר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM public.site_tracking x WHERE x.tenant_id = public.current_tenant_id();
  RETURN jsonb_build_object('container_id', t.gtm_container_id, 'enabled', COALESCE(t.gtm_enabled, false),
                            'ga4_id', t.ga4_measurement_id,
                            'updated_at', t.updated_at, 'loads_on_site', public.site_tracking_allowed());
END $$;

-- שמירת מזהה GA4 (ריק = מחיקה). מזהה לא תקין — נדחה. GTM לא משתנה
CREATE OR REPLACE FUNCTION public.save_my_ga4(_measurement_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _id text := NULLIF(upper(btrim(COALESCE(_measurement_id, ''))), '');
  _before text;
BEGIN
  IF NOT public.site_tracking_can_edit() THEN
    RAISE EXCEPTION 'רק בעל העסק מנהל את כלי המדידה של האתר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _id IS NOT NULL AND _id !~ '^G-[A-Z0-9]{4,16}$' THEN
    RAISE EXCEPTION 'מזהה Google Analytics 4 לא תקין — בתבנית G-XXXXXXXXXX (אותיות באנגלית וספרות)'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT x.ga4_measurement_id INTO _before FROM public.site_tracking x WHERE x.tenant_id = _tenant FOR UPDATE;
  INSERT INTO public.site_tracking AS s (tenant_id, ga4_measurement_id, updated_at, updated_by)
  VALUES (_tenant, _id, now(), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET ga4_measurement_id = EXCLUDED.ga4_measurement_id, updated_at = now(), updated_by = auth.uid();
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, auth.uid(), (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()), 'site_ga4_saved',
          jsonb_build_object('ga4_id', _id, 'previous', _before));
  RETURN public.my_tag_manager();
END $$;

REVOKE ALL ON FUNCTION public.site_tracking_can_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.site_ga4() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_ga4() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_tag_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tag_manager() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_my_ga4(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_ga4(text) TO authenticated, service_role;

-- העברה: מזהה GA4 מהגרסה המפורסמת האחרונה של כל אתר אירוח (אם עוד אין מזהה בטבלה)
INSERT INTO public.site_tracking AS s (tenant_id, ga4_measurement_id, updated_at)
SELECT v.tenant_id, upper(btrim(v.document -> 'seo' ->> 'ga4')), now()
  FROM (SELECT DISTINCT ON (x.tenant_id) x.tenant_id, x.document
          FROM hospitality.site_versions x
         WHERE x.kind = 'published'
         ORDER BY x.tenant_id, x.version DESC) v
 WHERE upper(btrim(COALESCE(v.document -> 'seo' ->> 'ga4', ''))) ~ '^G-[A-Z0-9]{4,16}$'
ON CONFLICT (tenant_id) DO UPDATE
  SET ga4_measurement_id = COALESCE(s.ga4_measurement_id, EXCLUDED.ga4_measurement_id);

NOTIFY pgrst, 'reload schema';

COMMIT;

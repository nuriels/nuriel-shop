-- ============================================================
-- Rollback של 20261118100000_site_tracking_ga4.sql (מיגרציה 199 — מזהה GA4 בהגדרות העסק)
-- הגנה: נעצר כשלאתר כלשהו שמור מזהה GA4 — rollback היה מוחק אותו. לפני rollback כזה — גיבוי, והחלטה
-- מפורשת (אפשר להחזיר את המזהה לעורך האתר בגרסה המפורסמת).
-- בלי נתונים: העמודה ושתי הפונקציות החדשות נמחקות; site_tracking_can_edit ו-my_tag_manager חוזרות בדיוק
-- לגרסה של מיגרציה 192. רשומות היומן (site_ga4_saved) נשארות.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה הקודמת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND table_name = 'site_tracking' AND column_name = 'ga4_measurement_id')
     AND EXISTS (SELECT 1 FROM public.site_tracking WHERE ga4_measurement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'יש אתרים ששמרו מזהה Google Analytics 4 — rollback היה מוחק אותו. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.save_my_ga4(text);
DROP FUNCTION IF EXISTS public.site_ga4();

CREATE OR REPLACE FUNCTION public.site_tracking_can_edit()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RETURN false;
  END IF;
  IF public.current_site_type() = 'hospitality' THEN
    RETURN COALESCE(hospitality.can('settings.owner'), false);
  END IF;
  -- COALESCE: לקוח / משתמש בלי תפקיד בחנות — NULL, ובלי זה 'NOT NULL' לא היה חוסם
  RETURN COALESCE(public.store_staff_role(auth.uid()) = 'owner', false);
END $$;

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
                            'updated_at', t.updated_at, 'loads_on_site', public.site_tracking_allowed());
END $$;

-- שורות שנוצרו רק בשביל GA4 (בלי GTM) — כבר ריקות (ההגנה למעלה); מוחקים כדי לחזור למצב של 192
DELETE FROM public.site_tracking WHERE gtm_container_id IS NULL AND NOT gtm_enabled;
ALTER TABLE public.site_tracking DROP COLUMN IF EXISTS ga4_measurement_id;

NOTIFY pgrst, 'reload schema';

COMMIT;

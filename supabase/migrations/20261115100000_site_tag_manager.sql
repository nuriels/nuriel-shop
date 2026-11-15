-- ============================================================
-- מיגרציה 192: Google Tag Manager לכל אתר — מזהה Container בלבד, לשני המנועים
--
-- • public.site_tracking — שורה לכל אתר (חנות או צימר): מזהה GTM ומתג. בלי שדה טקסט, HTML או JS חופשי:
--   רק מזהה בתבנית GTM-XXXXXXX, נבדק כאן (CHECK) ובשרת. הטבלה סגורה לגמרי ל-API (RLS, בלי הרשאות);
--   הכול דרך הפונקציות שבסוף. בהמשך (באישור נפרד) יעברו לכאן גם GA4 ו-Meta Pixel — לא במיגרציה הזו.
-- • מי משנה: חנות — בעל החנות בלבד; צימר — הבעלים, או מנהל/ת עסק שהבעלים מינה (settings.owner).
--   מנהלים, עובדים ולקוחות — לא. כל שינוי נרשם ב-platform_audit_log.
-- • מי קורא: האתר עצמו (גם לאורחים) מקבל רק את המזהה המופעל של האתר של הבקשה — current_tenant_id() לפי
--   ה-Host, אף פעם לא מזהה שנשלח מהדפדפן. מזהה של עסק אחד לא חוזר לעולם באתר של עסק אחר.
-- • שום דבר קיים לא משתנה: אין שורות לאף עסק עד שבעל העסק שומר. המזהים הקיימים (GA4 ו-Pixel של החנויות,
--   GA4 של הצימרים) נשארים במקומם.
--
-- הטעינה בדפדפן (src/platform/analytics): רק אחרי הסכמה לעוגיות, עם Consent Mode, פעם אחת לכל דף, ואירוע
-- page_view אחד לכל מעבר עמוד (בלי כפילויות ב-SPA). לא באזורי הניהול, החשבון והתצוגה המקדימה.
--
-- Rollback: supabase/rollbacks/20261115100000_site_tag_manager.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.site_tracking (
  tenant_id        uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- מזהה Container בלבד: GTM- ואחריו 4 עד 12 אותיות גדולות / ספרות
  gtm_container_id text CHECK (gtm_container_id ~ '^GTM-[A-Z0-9]{4,12}$'),
  gtm_enabled      boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  CHECK (NOT gtm_enabled OR gtm_container_id IS NOT NULL)
);
COMMENT ON TABLE public.site_tracking IS
  'מיגרציה 192: כלי מדידה לכל אתר — היום מזהה Google Tag Manager בלבד (בלי קוד חופשי). כתיבה דרך פונקציה בלבד';
ALTER TABLE public.site_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_tracking FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.site_tracking TO service_role;

-- מי רשאי לשנות את כלי המדידה של האתר הנוכחי (פנימי)
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

-- האם מזהה שמור נטען באתר: חנות — כן; צימר — רק כשהמדידה הופעלה לאתר בפלטפורמה (המתג
-- hospitality_analytics_enabled, כמו GA4 — כבוי כברירת מחדל)
CREATE OR REPLACE FUNCTION public.site_tracking_allowed()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.current_site_type() = 'hospitality' THEN
    RETURN COALESCE(hospitality.analytics_enabled(), false);
  END IF;
  RETURN public.current_tenant_id() IS NOT NULL;
END $$;

-- לאתר (גם לאורחים): המזהה המופעל של האתר של הבקשה, או NULL
CREATE OR REPLACE FUNCTION public.site_tag_manager()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.gtm_container_id FROM public.site_tracking t
   WHERE t.tenant_id = public.current_tenant_id() AND t.gtm_enabled AND t.gtm_container_id IS NOT NULL
     AND public.site_tracking_allowed();
$$;

-- לבעל העסק: ההגדרה השמורה של האתר הזה (גם כשהיא כבויה)
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

-- שמירה: מזהה (או ריק = מחיקה) והמתג. מזהה לא תקין — נדחה; הפעלה בלי מזהה — נדחית
CREATE OR REPLACE FUNCTION public.save_my_tag_manager(_container_id text, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _id text := NULLIF(upper(btrim(COALESCE(_container_id, ''))), '');
  _on boolean := COALESCE(_enabled, false);
  _before public.site_tracking;
BEGIN
  IF NOT public.site_tracking_can_edit() THEN
    RAISE EXCEPTION 'רק בעל העסק מנהל את כלי המדידה של האתר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _id IS NOT NULL AND _id !~ '^GTM-[A-Z0-9]{4,12}$' THEN
    RAISE EXCEPTION 'מזהה Google Tag Manager לא תקין — בתבנית GTM-XXXXXXX (אותיות באנגלית וספרות)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _on AND _id IS NULL THEN
    RAISE EXCEPTION 'כדי להפעיל צריך מזהה Container' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO _before FROM public.site_tracking x WHERE x.tenant_id = _tenant FOR UPDATE;
  INSERT INTO public.site_tracking AS s (tenant_id, gtm_container_id, gtm_enabled, updated_at, updated_by)
  VALUES (_tenant, _id, _on, now(), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET gtm_container_id = EXCLUDED.gtm_container_id, gtm_enabled = EXCLUDED.gtm_enabled,
        updated_at = now(), updated_by = auth.uid();
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, auth.uid(), (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()), 'site_tag_manager_saved',
          jsonb_build_object('container_id', _id, 'enabled', _on,
            'previous', jsonb_build_object('container_id', _before.gtm_container_id,
                                           'enabled', COALESCE(_before.gtm_enabled, false))));
  RETURN public.my_tag_manager();
END $$;

REVOKE ALL ON FUNCTION public.site_tracking_can_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.site_tracking_allowed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.site_tag_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_tag_manager() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_tag_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tag_manager() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_my_tag_manager(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_tag_manager(text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Rollback של 20261117090000_bp_site_address.sql (מיגרציה 197 — כתובת האתר ותיק האתר)
-- הגנה: נעצר כשיש כתובת מפנה (תת-דומיין ישן / הצורה השנייה של דומיין אישי) — rollback היה שובר הפניות 301
-- של אתר שכבר שינה כתובת. קודם מחזירים את הכתובת / מסירים את הדומיין, ורק אז מריצים.
-- ההגדרות של הדומיין האישי (רשומת ה-TXT, תוצאת הבדיקה) נמחקות; עמודות tenants.custom_domain* (משותפות
-- לכל המוצרים) נשארות כמו שהן. היומן (audit_log) נשאר — רשומות site.* / draft.saved לא נמחקות.
-- הפונקציות המשותפות (tenant_slug_problem, ssl_agent_targets, custom_domain_targets) והפונקציות של המנוע
-- (_log, bp_draft_save) חוזרות בדיוק לגרסה הקודמת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('business_profile.domain_settings', 'true', 'הגדרות ואימות דומיין אישי')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenant_host_redirects) THEN
    RAISE EXCEPTION 'יש כתובות מפנות (שינוי כתובת / דומיין אישי) — rollback היה שובר אותן. לא מבוצע';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.platform_bp_site_file(uuid);
DROP FUNCTION IF EXISTS public.bp_custom_domain_record_check(uuid, text, boolean, boolean, text, boolean, text);
DROP FUNCTION IF EXISTS public.bp_custom_domain_set(text, boolean);
DROP FUNCTION IF EXISTS public.bp_slug_change(text, text);
DROP FUNCTION IF EXISTS public.bp_slug_check(text);
DROP FUNCTION IF EXISTS public.bp_address_state();
DROP FUNCTION IF EXISTS business_profile._address_json(uuid);
DROP FUNCTION IF EXISTS business_profile._slug_problem(text, uuid);
DROP FUNCTION IF EXISTS business_profile._reserved_slug(text);
DROP TABLE IF EXISTS business_profile.domain_settings;

-- שמירת טיוטה — כמו במיגרציה 193 (בלי רישום ביומן)
CREATE OR REPLACE FUNCTION public.bp_draft_save(_document jsonb, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  _template text := business_profile._template_of(_document);
  _new integer;
BEGIN
  UPDATE business_profile.site_versions
     SET document = _document, template = _template, revision = revision + 1, updated_at = now(),
         updated_by = auth.uid()
   WHERE tenant_id = _t AND state = 'draft' AND revision = _revision
  RETURNING revision INTO _new;
  IF _new IS NULL THEN
    RAISE EXCEPTION 'הטיוטה נשמרה בינתיים ממקום אחר — רעננו את העמוד כדי לא לדרוס שינויים'
      USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN jsonb_build_object('revision', _new);
END $$;
REVOKE ALL ON FUNCTION public.bp_draft_save(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_draft_save(jsonb, integer) TO authenticated;

-- היומן — כמו במיגרציה 193
CREATE OR REPLACE FUNCTION business_profile._log(_tenant uuid, _action text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), _action, COALESCE(_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION business_profile._log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- סוכן התעודות — כמו במיגרציות 20261014090000 / 20261019110000
CREATE OR REPLACE FUNCTION public.ssl_agent_targets()
RETURNS TABLE(kind text, tenant_id uuid, slug text, is_default boolean, host text,
              renew_requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'store', t.id, t.slug, t.is_default, s.host, s.renew_requested_at
    FROM public.tenants t
    LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id
  UNION ALL
  SELECT 'deleted', NULL, NULL, NULL, s.host, NULL
    FROM public.tenant_ssl s
   WHERE s.tenant_id IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ssl_agent_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ssl_agent_targets() TO service_role;

CREATE OR REPLACE FUNCTION public.custom_domain_targets()
RETURNS TABLE(tenant_id uuid, slug text, custom_domain text, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.custom_domain, t.custom_domain_status
    FROM public.tenants t
   WHERE t.custom_domain IS NOT NULL
     AND t.custom_domain_verified_at IS NOT NULL
   ORDER BY t.custom_domain;
$$;
REVOKE ALL ON FUNCTION public.custom_domain_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_domain_targets() TO service_role;

-- בדיקת כתובת לפתיחת אתר / חנות — כמו לפני המיגרציה
CREATE OR REPLACE FUNCTION public.tenant_slug_problem(_slug text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
BEGIN
  IF _s = '' THEN
    RETURN 'יש להזין כתובת באנגלית';
  END IF;
  IF _s !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' THEN
    RETURN 'כתובת: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)';
  END IF;
  IF _s = ANY (public.platform_reserved_slugs()) OR _s LIKE 'api-%' THEN
    RETURN format('הכתובת "%s" שמורה — בחרו כתובת אחרת', _s);
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = _s) THEN
    RETURN format('הכתובת "%s" כבר תפוסה ע"י חנות אחרת', _s);
  END IF;
  RETURN NULL;
END $function$;

DROP FUNCTION IF EXISTS public.tenant_redirect_for_host(text);
DROP TABLE IF EXISTS public.tenant_host_redirects;

NOTIFY pgrst, 'reload schema';

COMMIT;

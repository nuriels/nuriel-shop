-- ============================================================
-- מיגרציה 197: כתובת האתר של אתרי העסקים (Nuriel Websites, ‏business_profile) + תיק האתר בפאנל הפלטפורמה
--
-- • שינוי תת-הדומיין (<slug>.<base>) מממשק הניהול של בעל העסק: בדיקת פורמט, שמות שמורים ותפוסים (כולל
--   כתובות ישנות של אתרים אחרים), עד 3 שינויים ב-30 יום. האתר לא נמחק ולא נוצר חדש — רק tenants.slug משתנה.
--   הכתובת הישנה נשמרת שנה ב-tenant_host_redirects (old_slug): השרת מחזיר ממנה 301 לכתובת הנוכחית, והיא לא
--   ניתנת לאתר אחר באותה תקופה. סוכן התעודות (ssl_agent_targets) ממשיך להחזיק לה תעודה — כדי שגם https יופנה.
-- • דומיין אישי: אותן עמודות של tenants (custom_domain*) והניתוב הקיים (tenant_for_host) — ובנוסף לאתרי עסקים
--   הוכחת בעלות ברשומת TXT (business_profile.domain_settings.verify_token), בדיקת DNS בשרת, והכתובת השנייה
--   (www / בלי www) כהפניה (custom_alternate) שסוכן התעודות מוציא לה תעודה (custom_domain_targets).
--   רק השרת (service_role) מסמן אימות — לא הדפדפן. בלי שינויי DNS מכאן.
-- • יומן: כל שמירת טיוטה נרשמת (draft.saved — אילו חלקים השתנו); פעולה של מנהל הפלטפורמה מסומנת
--   (via = platform_admin) בכל רשומה ביומן של האתר.
-- • תיק האתר בפאנל: platform_bp_site_file — כתובות, דומיין, מצב, תאריכים ויומן משולב (האתר + הפלטפורמה).
--
-- Rollback: supabase/rollbacks/20261117090000_bp_site_address.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ---------- 1. כתובות שמפנות לאתר (פלטפורמה) ----------
CREATE TABLE IF NOT EXISTS public.tenant_host_redirects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- old_slug: name = התווית הישנה (efrat-old → efrat-old.<base>); custom_alternate: name = הדומיין המלא
  kind       text NOT NULL CHECK (kind IN ('old_slug', 'custom_alternate')),
  name       text NOT NULL CHECK (name = lower(name) AND char_length(name) BETWEEN 3 AND 253
                                  AND name ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (kind, name)
);
CREATE INDEX IF NOT EXISTS tenant_host_redirects_tenant ON public.tenant_host_redirects (tenant_id);
ALTER TABLE public.tenant_host_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_host_redirects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tenant_host_redirects TO service_role;

COMMENT ON TABLE public.tenant_host_redirects IS
  'כתובות שמפנות (301) לכתובת הנוכחית של אתר: תת-דומיין ישן אחרי שינוי כתובת (שנה), והצורה השנייה של דומיין אישי (www / בלי www).';

-- הכתובת של הבקשה ← האתר שאליו מפנים (רק כשהכתובת לא שייכת לאף אתר — נבדק בשרת לפני כן)
CREATE OR REPLACE FUNCTION public.tenant_redirect_for_host(_host text)
RETURNS TABLE(tenant_id uuid, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH h AS (SELECT lower(split_part(btrim(COALESCE(_host, '')), ':', 1)) AS host)
  SELECT r.tenant_id, r.kind
    FROM public.tenant_host_redirects r, h
   WHERE (r.expires_at IS NULL OR r.expires_at > now())
     AND ((r.kind = 'custom_alternate' AND r.name = h.host)
       OR (r.kind = 'old_slug' AND h.host LIKE '%.%.%' AND r.name = split_part(h.host, '.', 1)
           AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = r.name)))
   ORDER BY r.kind
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.tenant_redirect_for_host(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_redirect_for_host(text) TO service_role;

-- כתובת ישנה של אתר (בתקופת ההפניה) לא ניתנת לאתר / חנות חדשים
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
  IF EXISTS (SELECT 1 FROM public.tenant_host_redirects r
              WHERE r.kind = 'old_slug' AND r.name = _s AND (r.expires_at IS NULL OR r.expires_at > now())) THEN
    RETURN format('הכתובת "%s" שייכת עדיין לאתר אחר (הפניה מכתובת ישנה) — בחרו כתובת אחרת', _s);
  END IF;
  RETURN NULL;
END $function$;

-- ---------- 2. סוכן התעודות: גם לכתובות המפנות ----------
-- תת-דומיין ישן: שורה בלי מזהה אתר (kind = alias) — הסוכן מוציא לו תעודה ובלוק 443 (השרת מחזיר 301),
-- והדיווח שלו (בלי מזהה אתר) לא נשמר בטבלת התעודות של האתר
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
   WHERE s.tenant_id IS NULL
  UNION ALL
  SELECT 'alias', NULL, r.name, false, NULL, NULL
    FROM public.tenant_host_redirects r
   WHERE r.kind = 'old_slug'
     AND (r.expires_at IS NULL OR r.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = r.name);
$$;
REVOKE ALL ON FUNCTION public.ssl_agent_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ssl_agent_targets() TO service_role;

-- הצורה השנייה של דומיין אישי (www / בלי www) — רק אחרי אימות ה-DNS של הדומיין הראשי. הדיווח שלה לא
-- משנה את מצב הדומיין הראשי (custom_domain_report מעדכן רק את הדומיין של האתר)
CREATE OR REPLACE FUNCTION public.custom_domain_targets()
RETURNS TABLE(tenant_id uuid, slug text, custom_domain text, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.tenant_id, x.slug, x.custom_domain, x.status FROM (
    SELECT t.id AS tenant_id, t.slug, t.custom_domain, t.custom_domain_status AS status
      FROM public.tenants t
     WHERE t.custom_domain IS NOT NULL
       AND t.custom_domain_verified_at IS NOT NULL
    UNION ALL
    SELECT t.id, t.slug, r.name, t.custom_domain_status
      FROM public.tenant_host_redirects r
      JOIN public.tenants t ON t.id = r.tenant_id
     WHERE r.kind = 'custom_alternate'
       AND (r.expires_at IS NULL OR r.expires_at > now())
       AND t.custom_domain IS NOT NULL
       AND t.custom_domain_verified_at IS NOT NULL
  ) x
  ORDER BY x.custom_domain;
$$;
REVOKE ALL ON FUNCTION public.custom_domain_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_domain_targets() TO service_role;

-- ---------- 3. הגדרות הדומיין של אתר עסק ----------
CREATE TABLE IF NOT EXISTS business_profile.domain_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- הערך של רשומת ה-TXT (הוכחת בעלות): _nuriel-verify.<domain>  TXT  nuriel-verify=<token>
  verify_token          text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')
                          CHECK (verify_token ~ '^[0-9a-f]{32}$'),
  ownership_domain      text,
  ownership_verified_at timestamptz,
  -- להפנות גם את הצורה השנייה (www / בלי www) אל הדומיין שנבחר
  alternate_redirect    boolean NOT NULL DEFAULT true,
  -- תוצאת הבדיקה האחרונה (לתצוגה): txt, dns, alternate, message, at — בלי פרטים אישיים
  last_check            jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);
ALTER TABLE business_profile.domain_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_profile.domain_settings;
CREATE POLICY tenant_isolation ON business_profile.domain_settings AS RESTRICTIVE
  USING (tenant_id = business_profile.request_site());
REVOKE ALL ON business_profile.domain_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON business_profile.domain_settings TO service_role;

-- ---------- 4. היומן: מי פעל (מנהל הפלטפורמה מסומן) ----------
CREATE OR REPLACE FUNCTION business_profile._log(_tenant uuid, _action text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), _action,
          COALESCE(_details, '{}'::jsonb)
            || CASE WHEN auth.uid() IS NOT NULL AND public.is_platform_admin(auth.uid())
                    THEN '{"via": "platform_admin"}'::jsonb ELSE '{}'::jsonb END);
$$;
REVOKE ALL ON FUNCTION business_profile._log(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- שמירת טיוטה — עכשיו גם ביומן: אילו חלקים במסמך השתנו (שמות החלקים בלבד, בלי התוכן)
CREATE OR REPLACE FUNCTION public.bp_draft_save(_document jsonb, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  _template text := business_profile._template_of(_document);
  _old jsonb;
  _new integer;
  _changed text[];
BEGIN
  SELECT v.document INTO _old FROM business_profile.site_versions v
   WHERE v.tenant_id = _t AND v.state = 'draft' AND v.revision = _revision FOR UPDATE;
  UPDATE business_profile.site_versions
     SET document = _document, template = _template, revision = revision + 1, updated_at = now(),
         updated_by = auth.uid()
   WHERE tenant_id = _t AND state = 'draft' AND revision = _revision
  RETURNING revision INTO _new;
  IF _new IS NULL THEN
    RAISE EXCEPTION 'הטיוטה נשמרה בינתיים ממקום אחר — רעננו את העמוד כדי לא לדרוס שינויים'
      USING ERRCODE = 'serialization_failure';
  END IF;
  SELECT COALESCE(array_agg(k ORDER BY k), ARRAY[]::text[]) INTO _changed
    FROM (SELECT jsonb_object_keys(COALESCE(_old, '{}'::jsonb)) AS k
          UNION SELECT jsonb_object_keys(_document)) keys
   WHERE (COALESCE(_old, '{}'::jsonb) -> k) IS DISTINCT FROM (_document -> k);
  PERFORM business_profile._log(_t, 'draft.saved',
    jsonb_build_object('revision', _new, 'template', _template, 'changed', to_jsonb(_changed)));
  RETURN jsonb_build_object('revision', _new);
END $$;
REVOKE ALL ON FUNCTION public.bp_draft_save(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bp_draft_save(jsonb, integer) TO authenticated;

-- ---------- 5. כתובת האתר (ממשק הניהול — בעל העסק / מנהל הפלטפורמה) ----------
-- שמות שמורים נוספים לאתרי עסקים (מעבר לרשימה של הפלטפורמה)
CREATE OR REPLACE FUNCTION business_profile._reserved_slug(_s text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _s = ANY (ARRAY['m', 'stg', 'portal', 'manage', 'login', 'logout', 'account', 'accounts', 'auth',
                         'oauth', 'sso', 'ns1', 'ns2', 'mx', 'webmail', 'email', 'autodiscover', 'localhost',
                         'root', 'billing', 'pay', 'payment', 'secure', 'preview', 'sites', 'websites', 'dns',
                         'ssl', 'www1', 'www2', 'img', 'images', 'media', 'files', 'upload', 'uploads',
                         'nuriel-app', 'nuriel-app2', 'nuriel-shop', 'nuriel-websites', 'admin-panel'])
      OR _s LIKE 'nuriel%' OR _s LIKE 'xn--%';
$$;
REVOKE ALL ON FUNCTION business_profile._reserved_slug(text) FROM PUBLIC, anon, authenticated;

-- הבעיה בכתובת (או NULL): פורמט, שמורה, תפוסה ע"י אתר אחר / כתובת ישנה של אתר אחר
CREATE OR REPLACE FUNCTION business_profile._slug_problem(_s text, _tenant uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _s IS NULL OR _s = '' THEN
    RETURN 'יש להזין כתובת באנגלית';
  END IF;
  IF _s !~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$' OR _s LIKE '%--%' THEN
    RETURN 'כתובת: 3–63 תווים — אותיות באנגלית קטנות, ספרות ומקף בודד (לא בהתחלה ולא בסוף)';
  END IF;
  IF _s = ANY (public.platform_reserved_slugs()) OR _s LIKE 'api-%' OR business_profile._reserved_slug(_s) THEN
    RETURN 'הכתובת הזו שמורה למערכת — בחרו כתובת אחרת';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.slug = _s AND t.id <> _tenant) THEN
    RETURN 'הכתובת הזו כבר תפוסה';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_host_redirects r
              WHERE r.kind = 'old_slug' AND r.name = _s AND r.tenant_id <> _tenant
                AND (r.expires_at IS NULL OR r.expires_at > now())) THEN
    RETURN 'הכתובת הזו כבר תפוסה';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION business_profile._slug_problem(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION business_profile._address_json(_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'slug', t.slug,
    'old_slugs', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', r.name, 'expires_at', r.expires_at)
                                            ORDER BY r.created_at DESC)
                             FROM public.tenant_host_redirects r
                            WHERE r.tenant_id = t.id AND r.kind = 'old_slug'
                              AND (r.expires_at IS NULL OR r.expires_at > now())), '[]'::jsonb),
    'changes_30d', (SELECT count(*) FROM business_profile.audit_log a
                     WHERE a.tenant_id = t.id AND a.action = 'site.address_changed'
                       AND a.created_at > now() - interval '30 days'),
    'custom_domain', t.custom_domain,
    'custom_domain_status', t.custom_domain_status,
    'custom_domain_error', t.custom_domain_error,
    'custom_domain_verified_at', t.custom_domain_verified_at,
    'custom_domain_checked_at', t.custom_domain_checked_at,
    'custom_domain_ssl_expires_at', t.custom_domain_ssl_expires_at,
    'alternate', (SELECT r.name FROM public.tenant_host_redirects r
                   WHERE r.tenant_id = t.id AND r.kind = 'custom_alternate' LIMIT 1),
    'verify_token', d.verify_token,
    'ownership_domain', d.ownership_domain,
    'ownership_verified_at', d.ownership_verified_at,
    'alternate_redirect', COALESCE(d.alternate_redirect, true),
    'last_check', d.last_check)
  FROM public.tenants t
  LEFT JOIN business_profile.domain_settings d ON d.tenant_id = t.id
  WHERE t.id = _tenant;
$$;
REVOKE ALL ON FUNCTION business_profile._address_json(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bp_address_state()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('settings.owner');
BEGIN
  INSERT INTO business_profile.domain_settings (tenant_id) VALUES (_t) ON CONFLICT (tenant_id) DO NOTHING;
  RETURN business_profile._address_json(_t);
END $$;

CREATE OR REPLACE FUNCTION public.bp_slug_check(_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('settings.owner');
  _s text := lower(btrim(COALESCE(_slug, '')));
  _current text;
  _problem text;
BEGIN
  SELECT t.slug INTO _current FROM public.tenants t WHERE t.id = _t;
  IF _s = _current THEN
    RETURN jsonb_build_object('slug', _s, 'available', false, 'reason', 'same',
                              'message', 'זו הכתובת הנוכחית של האתר');
  END IF;
  _problem := business_profile._slug_problem(_s, _t);
  RETURN jsonb_build_object('slug', _s, 'available', _problem IS NULL,
                            'reason', CASE WHEN _problem IS NULL THEN 'ok' ELSE 'problem' END,
                            'message', COALESCE(_problem, 'הכתובת פנויה'));
END $$;

CREATE OR REPLACE FUNCTION public.bp_slug_change(_slug text, _current text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('settings.owner');
  _s text := lower(btrim(COALESCE(_slug, '')));
  _old text;
  _problem text;
BEGIN
  SELECT t.slug INTO _old FROM public.tenants t WHERE t.id = _t FOR UPDATE;
  IF _old IS DISTINCT FROM lower(btrim(COALESCE(_current, ''))) THEN
    RAISE EXCEPTION 'כתובת האתר השתנתה בינתיים — רעננו את העמוד' USING ERRCODE = 'serialization_failure';
  END IF;
  IF _s = _old THEN
    RETURN business_profile._address_json(_t);
  END IF;
  _problem := business_profile._slug_problem(_s, _t);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM business_profile.audit_log a
       WHERE a.tenant_id = _t AND a.action = 'site.address_changed'
         AND a.created_at > now() - interval '30 days') >= 3 THEN
    RAISE EXCEPTION 'אפשר לשנות את כתובת האתר עד 3 פעמים ב-30 יום — נסו שוב מאוחר יותר'
      USING ERRCODE = 'check_violation';
  END IF;

  -- הכתובת הישנה מפנה לחדשה שנה; חזרה לכתובת ישנה של אותו אתר מבטלת את ההפניה שלה
  INSERT INTO public.tenant_host_redirects (tenant_id, kind, name, expires_at)
  VALUES (_t, 'old_slug', _old, now() + interval '365 days')
  ON CONFLICT (kind, name) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, expires_at = EXCLUDED.expires_at,
                                         created_at = now();
  DELETE FROM public.tenant_host_redirects r WHERE r.tenant_id = _t AND r.kind = 'old_slug' AND r.name = _s;
  BEGIN
    UPDATE public.tenants SET slug = _s WHERE id = _t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת נתפסה הרגע ע"י אתר אחר — בחרו כתובת אחרת' USING ERRCODE = 'check_violation';
  END;

  PERFORM business_profile._log(_t, 'site.address_changed', jsonb_build_object('from', _old, 'to', _s));
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_t, auth.uid(), 'bp_site_address_changed', jsonb_build_object('from', _old, 'to', _s));
  RETURN business_profile._address_json(_t);
END $$;

-- דומיין אישי: שמירה (→ ממתין לבדיקה) או הסרה (ריק). הבדיקה עצמה — בשרת (bp_custom_domain_record_check)
CREATE OR REPLACE FUNCTION public.bp_custom_domain_set(_domain text, _alternate_redirect boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('settings.owner');
  _d text := NULLIF(lower(btrim(COALESCE(_domain, ''))), '');
  _old text;
BEGIN
  INSERT INTO business_profile.domain_settings (tenant_id) VALUES (_t) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT t.custom_domain INTO _old FROM public.tenants t WHERE t.id = _t FOR UPDATE;

  IF _d IS NULL THEN
    IF _old IS NOT NULL THEN
      UPDATE public.tenants SET custom_domain = NULL WHERE id = _t;
      DELETE FROM public.tenant_host_redirects r WHERE r.tenant_id = _t AND r.kind = 'custom_alternate';
      UPDATE business_profile.domain_settings
         SET ownership_domain = NULL, ownership_verified_at = NULL, last_check = NULL,
             updated_at = now(), updated_by = auth.uid()
       WHERE tenant_id = _t;
      PERFORM business_profile._log(_t, 'site.custom_domain_removed', jsonb_build_object('domain', _old));
    END IF;
    RETURN business_profile._address_json(_t);
  END IF;

  IF char_length(_d) > 253
     OR _d !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$' THEN
    RAISE EXCEPTION 'הדומיין לא תקין — למשל www.example.co.il' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t
              WHERE t.id <> _t AND (t.custom_domain = _d OR t.domain = _d))
     OR EXISTS (SELECT 1 FROM public.tenant_host_redirects r
                 WHERE r.kind = 'custom_alternate' AND r.name = _d AND r.tenant_id <> _t) THEN
    RAISE EXCEPTION 'הדומיין הזה כבר מחובר לאתר אחר במערכת' USING ERRCODE = 'check_violation';
  END IF;

  IF _old IS DISTINCT FROM _d THEN
    -- הטריגר של tenants מאפס אימות ותעודה ומסמן pending
    UPDATE public.tenants SET custom_domain = _d WHERE id = _t;
    DELETE FROM public.tenant_host_redirects r WHERE r.tenant_id = _t AND r.kind = 'custom_alternate';
    UPDATE business_profile.domain_settings
       SET ownership_domain = NULL, ownership_verified_at = NULL, last_check = NULL
     WHERE tenant_id = _t;
  END IF;
  UPDATE business_profile.domain_settings
     SET alternate_redirect = COALESCE(_alternate_redirect, true), updated_at = now(), updated_by = auth.uid()
   WHERE tenant_id = _t;
  IF NOT COALESCE(_alternate_redirect, true) THEN
    DELETE FROM public.tenant_host_redirects r WHERE r.tenant_id = _t AND r.kind = 'custom_alternate';
  END IF;
  PERFORM business_profile._log(_t, 'site.custom_domain_set',
    jsonb_build_object('domain', _d, 'alternate_redirect', COALESCE(_alternate_redirect, true)));
  RETURN business_profile._address_json(_t);
END $$;

-- תוצאת הבדיקה מהשרת (service_role בלבד — אחרי שאילתות DNS אמיתיות). מסמן אימות רק אם גם רשומת ה-TXT
-- (בעלות) וגם ההפניה לשרת תקינות; הצורה השנייה נרשמת להפניה רק אם גם היא מפנה לשרת.
CREATE OR REPLACE FUNCTION public.bp_custom_domain_record_check(_tenant uuid, _domain text, _txt_ok boolean,
                                                                _dns_ok boolean, _alternate text,
                                                                _alternate_ok boolean, _message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  d business_profile.domain_settings;
  _ok boolean := COALESCE(_txt_ok, false) AND COALESCE(_dns_ok, false);
  _alt text := NULLIF(lower(btrim(COALESCE(_alternate, ''))), '');
  _msg text := left(COALESCE(_message, ''), 500);
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant FOR UPDATE;
  IF t.id IS NULL OR t.site_type <> 'business_profile' THEN
    RAISE EXCEPTION 'האתר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  -- הדומיין הוחלף / הוסר בזמן הבדיקה — לא מעדכנים
  IF t.custom_domain IS DISTINCT FROM lower(btrim(COALESCE(_domain, ''))) THEN
    RETURN business_profile._address_json(_tenant);
  END IF;
  INSERT INTO business_profile.domain_settings (tenant_id) VALUES (_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT * INTO d FROM business_profile.domain_settings x WHERE x.tenant_id = _tenant;

  UPDATE business_profile.domain_settings
     SET ownership_domain = CASE WHEN _txt_ok THEN t.custom_domain ELSE ownership_domain END,
         ownership_verified_at = CASE WHEN _txt_ok THEN COALESCE(
                                   CASE WHEN ownership_domain = t.custom_domain THEN ownership_verified_at END, now())
                                 ELSE ownership_verified_at END,
         last_check = jsonb_build_object('txt', COALESCE(_txt_ok, false), 'dns', COALESCE(_dns_ok, false),
                                         'alternate', _alt, 'alternate_ok', COALESCE(_alternate_ok, false),
                                         'message', _msg, 'at', now()),
         updated_at = now()
   WHERE tenant_id = _tenant;

  IF _ok THEN
    UPDATE public.tenants
       SET custom_domain_status = CASE WHEN t.custom_domain_status = 'active' THEN 'active' ELSE 'verified' END,
           custom_domain_verified_at = COALESCE(t.custom_domain_verified_at, now()),
           custom_domain_error = NULL
     WHERE id = _tenant;
  ELSE
    UPDATE public.tenants
       SET custom_domain_status = 'error', custom_domain_verified_at = NULL,
           custom_domain_error = NULLIF(_msg, '')
     WHERE id = _tenant;
  END IF;

  IF _ok AND d.alternate_redirect AND COALESCE(_alternate_ok, false) AND _alt IS NOT NULL
     AND _alt <> t.custom_domain
     AND NOT EXISTS (SELECT 1 FROM public.tenants x WHERE x.id <> _tenant AND (x.custom_domain = _alt OR x.domain = _alt))
     AND NOT EXISTS (SELECT 1 FROM public.tenant_host_redirects r
                      WHERE r.kind = 'custom_alternate' AND r.name = _alt AND r.tenant_id <> _tenant) THEN
    DELETE FROM public.tenant_host_redirects r
     WHERE r.tenant_id = _tenant AND r.kind = 'custom_alternate' AND r.name <> _alt;
    INSERT INTO public.tenant_host_redirects (tenant_id, kind, name)
    VALUES (_tenant, 'custom_alternate', _alt)
    ON CONFLICT (kind, name) DO NOTHING;
  ELSE
    DELETE FROM public.tenant_host_redirects r WHERE r.tenant_id = _tenant AND r.kind = 'custom_alternate';
  END IF;

  INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, NULL, 'site.custom_domain_checked',
          jsonb_build_object('domain', t.custom_domain, 'ok', _ok, 'txt', COALESCE(_txt_ok, false),
                             'dns', COALESCE(_dns_ok, false)));
  RETURN business_profile._address_json(_tenant);
END $$;

-- ---------- 6. תיק האתר בפאנל הפלטפורמה ----------
CREATE OR REPLACE FUNCTION public.platform_bp_site_file(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
BEGIN
  PERFORM business_profile._require_platform_admin();
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant AND x.site_type = 'business_profile';
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'created_at', t.created_at,
    'owner_email', t.owner_email,
    'owner', (SELECT jsonb_build_object('email', u.email, 'since', ur.created_at)
                FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
               WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected
               ORDER BY ur.created_at LIMIT 1),
    'address', business_profile._address_json(t.id),
    'state', business_profile._state(t.id),
    'draft', (SELECT jsonb_build_object('template', v.template, 'revision', v.revision, 'updated_at', v.updated_at,
                                        'updated_by', (SELECT u.email FROM auth.users u WHERE u.id = v.updated_by))
                FROM business_profile.site_versions v WHERE v.tenant_id = t.id AND v.state = 'draft'),
    'media', (SELECT jsonb_build_object('count', count(*), 'bytes', COALESCE(sum(m.size_bytes), 0))
                FROM business_profile.media m WHERE m.tenant_id = t.id),
    -- היומן המשולב: פעולות באתר (כולל של מנהל הפלטפורמה — via) + פעולות בפאנל (כניסה לניהול, אישורים)
    'audit', COALESCE((
      SELECT jsonb_agg(x.e ORDER BY x.at DESC, x.n DESC) FROM (
        SELECT u.e, u.at, u.n FROM (
          SELECT jsonb_build_object('source', 'site', 'action', a.action, 'details', a.details, 'at', a.created_at,
                                    'actor', (SELECT au.email FROM auth.users au WHERE au.id = a.actor_id),
                                    'platform_admin', COALESCE(a.details ->> 'via' = 'platform_admin', false)) AS e,
                 a.created_at AS at, lpad(a.id::text, 20, '0') AS n
            FROM business_profile.audit_log a WHERE a.tenant_id = t.id
          UNION ALL
          SELECT jsonb_build_object('source', 'platform', 'action', p.action, 'details', p.details,
                                    'at', p.created_at,
                                    'actor', COALESCE(p.actor_email,
                                                      (SELECT au.email FROM auth.users au WHERE au.id = p.actor_id)),
                                    'platform_admin', true),
                 p.created_at, lpad(p.id::text, 20, '0')
            FROM public.platform_audit_log p WHERE p.tenant_id = t.id
        ) u
        ORDER BY u.at DESC, u.n DESC
        LIMIT 80
      ) x), '[]'::jsonb));
END $$;

-- ---------- 7. הרשאות ----------
REVOKE ALL ON FUNCTION
  public.bp_address_state(), public.bp_slug_check(text), public.bp_slug_change(text, text),
  public.bp_custom_domain_set(text, boolean),
  public.bp_custom_domain_record_check(uuid, text, boolean, boolean, text, boolean, text),
  public.platform_bp_site_file(uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.bp_address_state(), public.bp_slug_check(text), public.bp_slug_change(text, text),
  public.bp_custom_domain_set(text, boolean), public.platform_bp_site_file(uuid)
TO authenticated;
REVOKE ALL ON FUNCTION public.bp_custom_domain_record_check(uuid, text, boolean, boolean, text, boolean, text)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bp_custom_domain_record_check(uuid, text, boolean, boolean, text, boolean, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- מיגרציה 193: מנוע אתרי עסקים (Nuriel Websites, ‏business_profile) — Stage 1
--
-- • סוג אתר שלישי: tenants.site_type += 'business_profile' (וגם בטבלת התפקידים לכל מוצר: admin בלבד).
--   החנויות וההתארחות לא משתנות — אף שורה קיימת לא נוגעת, ואף פונקציה שלהן לא מוחלפת.
-- • סכמה סגורה business_profile (בלי הרשאות ל-anon / authenticated, RLS על כל טבלה): sites, templates,
--   site_versions, audit_log. כל הגישה דרך פונקציות public.bp_* (בעל העסק, באתר שלו) ו-public.platform_bp_*
--   (מנהל הפלטפורמה בלבד). כל פונקציה בודקת בעצמה את האתר (current_tenant_id() לפי ה-Host) ואת התפקיד.
-- • גרסאות: טיוטה אחת לכל אתר (revision — נעילה אופטימית: שני עורכים לא דורסים זה את זה), בקשת פרסום
--   אחת לכל היותר (צילום של הטיוטה), וגרסאות מפורסמות שלא משתנות לעולם (היסטוריה + שחזור).
-- • פרסום: הפרסום הראשון של כל אתר — רק באישור מנהל הפלטפורמה (החלטה 3). אחרי האישור הראשון — בעל העסק
--   מפרסם בעצמו. שחזור = העתקת גרסה קודמת לטיוטה (ואז פרסום רגיל), כך ששום גרסה לא נמחקת.
-- • דגלים (כבויים כברירת מחדל): business_profile_enabled (המנוע + ממשק הניהול) ו-business_profile_public
--   (האתר הציבורי). בנוסף לכל אתר צריך גרסה מפורסמת שאושרה.
-- • תבניות: 6 רשומות; elegant ו-portfolio זמינות, ארבע האחרות "מתוכננות" (החלטה 4) — הוספה של תבנית =
--   שורה + קוד תצוגה, בלי שינוי במנוע.
--
-- Rollback: supabase/rollbacks/20261116090000_bp_engine.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ---------- 1. סוג האתר והתפקידים ----------
ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_site_type_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_site_type_check
  CHECK (site_type IN ('ecommerce', 'hospitality', 'business_profile'));

ALTER TABLE public.platform_product_roles DROP CONSTRAINT IF EXISTS platform_product_roles_product_check;
ALTER TABLE public.platform_product_roles ADD CONSTRAINT platform_product_roles_product_check
  CHECK (product IN ('ecommerce', 'hospitality', 'business_profile'));
-- אתר עסק: מנהלים בלבד (בעל העסק = admin מוגן). אין לקוחות, סוכנים, מחסן או קופה
INSERT INTO public.platform_product_roles (product, role) VALUES ('business_profile', 'admin')
ON CONFLICT DO NOTHING;

-- ---------- 2. דגלים (כבויים) ----------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('business_profile_enabled', false, 'Nuriel Websites: המנוע וממשק הניהול (/studio) של אתרי עסקים'),
  ('business_profile_public', false, 'Nuriel Websites: האתר הציבורי של אתרי עסקים (רק גרסה מפורסמת שאושרה)')
ON CONFLICT (key) DO NOTHING;

-- ---------- 3. הסכמה והטבלאות ----------
CREATE SCHEMA IF NOT EXISTS business_profile;
REVOKE ALL ON SCHEMA business_profile FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA business_profile TO service_role;

CREATE TABLE IF NOT EXISTS business_profile.templates (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,31}$'),
  label_he   text NOT NULL CHECK (char_length(label_he) BETWEEN 1 AND 60),
  label_en   text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 60),
  -- available: אפשר לבחור; planned: מוצגת כ"בקרוב" ולא נשמרת
  status     text NOT NULL DEFAULT 'planned' CHECK (status IN ('available', 'planned')),
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO business_profile.templates (key, label_he, label_en, status, sort) VALUES
  ('elegant', 'אלגנטית', 'Elegant', 'available', 1),
  ('portfolio', 'תיק עבודות', 'Portfolio', 'available', 2),
  ('professional', 'מקצועית', 'Professional', 'planned', 3),
  ('creative', 'יצירתית', 'Creative', 'planned', 4),
  ('minimal', 'מינימליסטית', 'Minimal', 'planned', 5),
  ('luxury', 'יוקרתית', 'Luxury', 'planned', 6)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS business_profile.sites (
  tenant_id         uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  live_version_id   uuid,
  -- האישור הראשון של מנהל הפלטפורמה; מכאן בעל העסק מפרסם בעצמו
  first_approved_at timestamptz,
  first_approved_by uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_profile.site_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- draft: הטיוטה (אחת); pending: בקשת פרסום ראשון (אחת); published / rejected: היסטוריה, לא משתנה
  state           text NOT NULL CHECK (state IN ('draft', 'pending', 'published', 'rejected')),
  -- מספר הגרסה המפורסמת (1, 2, …) — רק ל-published
  version         integer CHECK (version IS NULL OR version >= 1),
  template        text NOT NULL REFERENCES business_profile.templates(key),
  document        jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 524288),
  -- טיוטה: עולה בכל שמירה; צילום: ה-revision של הטיוטה שממנה נוצר
  revision        integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  based_on        uuid REFERENCES business_profile.site_versions(id) ON DELETE SET NULL,
  note            text CHECK (note IS NULL OR char_length(note) <= 300),
  review_note     text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  CHECK ((state = 'published') = (version IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS bp_site_versions_one_draft
  ON business_profile.site_versions (tenant_id) WHERE state = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS bp_site_versions_one_pending
  ON business_profile.site_versions (tenant_id) WHERE state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS bp_site_versions_version
  ON business_profile.site_versions (tenant_id, version) WHERE version IS NOT NULL;
CREATE INDEX IF NOT EXISTS bp_site_versions_history
  ON business_profile.site_versions (tenant_id, created_at DESC);

ALTER TABLE business_profile.sites DROP CONSTRAINT IF EXISTS sites_live_version_fkey;
ALTER TABLE business_profile.sites ADD CONSTRAINT sites_live_version_fkey
  FOREIGN KEY (live_version_id) REFERENCES business_profile.site_versions(id);

CREATE TABLE IF NOT EXISTS business_profile.audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id   uuid,
  action     text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{2,59}$'),
  details    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(details) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bp_audit_log_tenant ON business_profile.audit_log (tenant_id, created_at DESC);

-- גרסה מפורסמת / נדחית — לא משתנה ולא נמחקת (חוץ ממחיקת האתר כולו, CASCADE)
CREATE OR REPLACE FUNCTION business_profile.versions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state IN ('published', 'rejected') THEN
    RAISE EXCEPTION 'גרסה מפורסמת לא משתנה' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'draft' AND NEW.state <> 'draft' THEN
    RAISE EXCEPTION 'הטיוטה נשארת טיוטה' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.state IN ('published', 'rejected')
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
    RAISE EXCEPTION 'גרסה מפורסמת לא נמחקת' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION business_profile.versions_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bp_versions_immutable ON business_profile.site_versions;
CREATE TRIGGER bp_versions_immutable BEFORE UPDATE OR DELETE ON business_profile.site_versions
FOR EACH ROW EXECUTE FUNCTION business_profile.versions_immutable();

-- יומן — רק הוספה
CREATE OR REPLACE FUNCTION business_profile.audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'היומן לא משתנה' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION business_profile.audit_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bp_audit_immutable ON business_profile.audit_log;
CREATE TRIGGER bp_audit_immutable BEFORE UPDATE ON business_profile.audit_log
FOR EACH ROW EXECUTE FUNCTION business_profile.audit_immutable();

-- סגור לגמרי ל-API; קריאה בלבד ל-service_role (גיבויים / תמיכה)
ALTER TABLE business_profile.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile.site_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA business_profile FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA business_profile TO service_role;

-- ---------- 4. עזרים פנימיים ----------
-- האתר של הבקשה, רק כשהוא אתר עסק
CREATE OR REPLACE FUNCTION business_profile.request_site()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id FROM public.tenants t
   WHERE t.id = public.current_tenant_id() AND t.site_type = 'business_profile';
$$;

-- ההרשאות של המשתמש באתר של הבקשה. בעל העסק (admin מוגן) ומנהל הפלטפורמה — הכול; מנהל רגיל (בעתיד,
-- כשבעל העסק יצרף צוות) — עריכת תוכן בלבד. כל השאר — כלום.
CREATE OR REPLACE FUNCTION business_profile.permissions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN business_profile.request_site() IS NULL OR auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.store_staff_role(auth.uid()) = 'owner' THEN
      ARRAY['content.edit', 'site.publish', 'versions.restore', 'settings.owner']
    WHEN public.store_staff_role(auth.uid()) = 'manager' THEN ARRAY['content.edit']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION business_profile.can(_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _permission = ANY (business_profile.permissions());
$$;

-- האתר של הבקשה, כשלמשתמש יש ההרשאה והמנוע פעיל לאתר; אחרת — שגיאה (בלי לחשוף אם האתר קיים)
CREATE OR REPLACE FUNCTION business_profile.studio_site(_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.request_site();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'נדרשת התחברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _t IS NULL OR NOT public.platform_feature_enabled('business_profile_enabled', _t)
     OR NOT business_profile.can(_permission) THEN
    RAISE EXCEPTION 'אין הרשאה לפעולה הזו באתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _t;
END $$;

CREATE OR REPLACE FUNCTION business_profile._log(_tenant uuid, _action text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), _action, COALESCE(_details, '{}'::jsonb));
$$;

-- תבנית שאפשר לבחור (available)
CREATE OR REPLACE FUNCTION business_profile._template_of(_document jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _k text := COALESCE(_document ->> 'template', '');
BEGIN
  IF jsonb_typeof(_document) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'מסמך האתר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF octet_length(_document::text) > 524288 THEN
    RAISE EXCEPTION 'האתר גדול מדי (עד 512KB של תוכן)' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM business_profile.templates t WHERE t.key = _k AND t.status = 'available') THEN
    RAISE EXCEPTION 'התבנית "%" לא זמינה', _k USING ERRCODE = 'check_violation';
  END IF;
  RETURN _k;
END $$;

-- מצב האתר לתצוגה (פנימי)
CREATE OR REPLACE FUNCTION business_profile._state(_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'status', CASE
      WHEN EXISTS (SELECT 1 FROM business_profile.site_versions v WHERE v.tenant_id = s.tenant_id AND v.state = 'pending')
        THEN 'pending_review'
      WHEN s.live_version_id IS NULL THEN 'draft'
      ELSE 'live' END,
    'approved', s.first_approved_at IS NOT NULL,
    'first_approved_at', s.first_approved_at,
    'live_version', (SELECT v.version FROM business_profile.site_versions v WHERE v.id = s.live_version_id),
    'live_published_at', (SELECT v.created_at FROM business_profile.site_versions v WHERE v.id = s.live_version_id),
    'public_enabled', public.platform_feature_enabled('business_profile_public', s.tenant_id),
    'pending', (SELECT jsonb_build_object('id', v.id, 'requested_at', v.created_at, 'revision', v.revision, 'note', v.note)
                  FROM business_profile.site_versions v WHERE v.tenant_id = s.tenant_id AND v.state = 'pending'),
    'last_rejection', (SELECT jsonb_build_object('at', v.reviewed_at, 'note', v.review_note)
                         FROM business_profile.site_versions v
                        WHERE v.tenant_id = s.tenant_id AND v.state = 'rejected'
                          AND NOT EXISTS (SELECT 1 FROM business_profile.site_versions p
                                           WHERE p.tenant_id = s.tenant_id AND p.state IN ('pending', 'published')
                                             AND p.created_at > v.reviewed_at)
                        ORDER BY v.reviewed_at DESC LIMIT 1))
    FROM business_profile.sites s WHERE s.tenant_id = _tenant;
$$;

-- גרסה מפורסמת חדשה מצילום (פנימי — הקורא בודק הרשאה)
-- _requested_by: מי ביקש (בפרסום ראשון — בעל העסק); _reviewed_by: מנהל הפלטפורמה שאישר (או NULL)
CREATE OR REPLACE FUNCTION business_profile._publish(_tenant uuid, _template text, _document jsonb,
                                                     _revision integer, _note text, _requested_by uuid,
                                                     _reviewed_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _v integer;
  _id uuid;
BEGIN
  SELECT COALESCE(max(v.version), 0) + 1 INTO _v FROM business_profile.site_versions v WHERE v.tenant_id = _tenant;
  INSERT INTO business_profile.site_versions (tenant_id, state, version, template, document, revision, note,
                                              created_by, reviewed_by, reviewed_at)
  VALUES (_tenant, 'published', _v, _template, _document, _revision, _note, _requested_by, _reviewed_by,
          CASE WHEN _reviewed_by IS NOT NULL THEN now() END)
  RETURNING id INTO _id;
  UPDATE business_profile.sites SET live_version_id = _id, updated_at = now() WHERE tenant_id = _tenant;
  RETURN jsonb_build_object('id', _id, 'version', _v);
END $$;

REVOKE ALL ON FUNCTION business_profile.request_site(), business_profile.permissions(),
  business_profile.can(text), business_profile.studio_site(text), business_profile._log(uuid, text, jsonb),
  business_profile._template_of(jsonb), business_profile._state(uuid),
  business_profile._publish(uuid, text, jsonb, integer, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- ---------- 5. מנהל הפלטפורמה ----------
CREATE OR REPLACE FUNCTION business_profile._require_platform_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
REVOKE ALL ON FUNCTION business_profile._require_platform_admin() FROM PUBLIC, anon, authenticated;

-- פתיחת אתר עסק (מנהל הפלטפורמה). טיוטה ראשונה מהמסמך שהאפליקציה בנתה מהתבנית. בלי פרסום, בלי דומיין
-- אישי, בלי חיוב. הבעלים: אם יש כבר חשבון מאומת לאימייל — מצורף; אחרת — מאוחר יותר (platform_bp_set_owner).
CREATE OR REPLACE FUNCTION public.platform_bp_open_site(_slug text, _name text, _owner_email text DEFAULT NULL,
                                                         _document jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
  _n text := btrim(regexp_replace(COALESCE(_name, ''), '\s+', ' ', 'g'));
  _e text := NULLIF(lower(btrim(COALESCE(_owner_email, ''))), '');
  _doc jsonb := COALESCE(_document, jsonb_build_object('schema', 1, 'template', 'elegant', 'locales', '["he"]'::jsonb,
                                                       'pages', '[]'::jsonb));
  _template text;
  _problem text;
  _owner jsonb := NULL;
  t public.tenants;
BEGIN
  -- כולל בדיקת מנהל הפלטפורמה, פורמט, כתובות שמורות וכתובת תפוסה
  _problem := public.platform_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_n) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם העסק חייב להכיל 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NOT NULL AND (_e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(_e) > 254) THEN
    RAISE EXCEPTION 'אימייל בעל העסק לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _template := business_profile._template_of(_doc);

  BEGIN
    INSERT INTO public.tenants (slug, name, owner_email, site_type)
    VALUES (_s, _n, _e, 'business_profile')
    RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י אתר אחר — בחרו כתובת אחרת', _s USING ERRCODE = 'check_violation';
  END;

  -- ההגדרות המשותפות של הפלטפורמה (שם, מיילים); לא נוצרים נתוני חנות (הטריגר רץ רק לחנויות)
  PERFORM public.platform_seed_tenant_shared(t.id);
  INSERT INTO business_profile.sites (tenant_id) VALUES (t.id);
  INSERT INTO business_profile.site_versions (tenant_id, state, template, document, created_by)
  VALUES (t.id, 'draft', _template, _doc, auth.uid());
  -- המנוע וממשק הניהול — לאתר הזה (פועל רק כשגם הדגל של הפלטפורמה דולק). האתר הציבורי — רק באישור פרסום
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled, updated_by)
  VALUES (t.id, 'business_profile_enabled', true, auth.uid())
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true, updated_by = auth.uid(), updated_at = now();

  PERFORM business_profile._log(t.id, 'site.opened', jsonb_build_object('slug', t.slug, 'template', _template));
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (t.id, auth.uid(), 'bp_site_opened', jsonb_build_object('slug', t.slug, 'template', _template));

  IF _e IS NOT NULL THEN
    _owner := public.platform_bp_set_owner(t.id, _e);
  END IF;
  RETURN jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'owner', _owner);
END $$;

-- בעל העסק (מנהל הפלטפורמה): רק חשבון שנוצר / אומת במערכת (כמו בשאר המוצרים — SEC-H1)
CREATE OR REPLACE FUNCTION public.platform_bp_set_owner(_tenant uuid, _email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _e text := NULLIF(lower(btrim(COALESCE(_email, ''))), '');
  _uid uuid;
  _current uuid;
BEGIN
  PERFORM business_profile._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.site_type = 'business_profile') THEN
    RAISE EXCEPTION 'אתר העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _e IS NULL OR _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR length(_e) > 254 THEN
    RAISE EXCEPTION 'אימייל בעל העסק לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_owner:' || _tenant::text, 0));

  SELECT ur.user_id INTO _current FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND ur.is_protected
   ORDER BY ur.created_at LIMIT 1;
  _uid := public._platform_account_id(_e);
  IF _current IS NOT NULL THEN
    IF _current = _uid THEN
      RETURN jsonb_build_object('status', 'already_owner');
    END IF;
    RAISE EXCEPTION 'לאתר הזה כבר יש בעלים' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.tenants SET owner_email = _e WHERE id = _tenant;
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_account');
  END IF;
  IF public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'זה חשבון של מנהל הפלטפורמה — יש להזין את האימייל של בעל העסק' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'customer') THEN
    RAISE EXCEPTION 'האימייל הזה שייך לחשבון של לקוח בחנות — יש להשתמש באימייל אחר לבעל העסק'
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
  VALUES (_tenant, _uid, _e, 'admin', true, true);
  PERFORM business_profile._log(_tenant, 'site.owner_set', '{}'::jsonb);
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), 'bp_owner_set', '{}'::jsonb);
  RETURN jsonb_build_object('status', 'added');
END $$;

-- רשימת אתרי העסקים לפאנל
CREATE OR REPLACE FUNCTION public.platform_bp_sites()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM business_profile._require_platform_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'owner_email', t.owner_email,
             'has_owner', EXISTS (SELECT 1 FROM public.user_roles ur
                                   WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected),
             'created_at', t.created_at,
             'template', (SELECT v.template FROM business_profile.site_versions v
                           WHERE v.tenant_id = t.id AND v.state = 'draft'),
             'state', business_profile._state(t.id)) ORDER BY t.created_at DESC)
      FROM public.tenants t
     WHERE t.site_type = 'business_profile'), '[]'::jsonb);
END $$;

-- בקשת הפרסום (הצילום) לבדיקה בפאנל
CREATE OR REPLACE FUNCTION public.platform_bp_review(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v business_profile.site_versions;
BEGIN
  PERFORM business_profile._require_platform_admin();
  SELECT * INTO v FROM business_profile.site_versions x WHERE x.tenant_id = _tenant AND x.state = 'pending';
  IF v.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', v.id, 'template', v.template, 'document', v.document, 'revision', v.revision,
                            'note', v.note, 'requested_at', v.created_at);
END $$;

-- אישור הפרסום הראשון: הצילום שנבדק (לפי מזהה) הופך לגרסה מפורסמת, והאתר הציבורי נפתח לאתר
CREATE OR REPLACE FUNCTION public.platform_bp_approve_publish(_tenant uuid, _version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v business_profile.site_versions;
  _r jsonb;
BEGIN
  PERFORM business_profile._require_platform_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_publish:' || _tenant::text, 0));
  SELECT * INTO v FROM business_profile.site_versions x
   WHERE x.id = _version AND x.tenant_id = _tenant AND x.state = 'pending'
   FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'בקשת הפרסום לא נמצאה (אולי בוטלה או שכבר טופלה)' USING ERRCODE = 'no_data_found';
  END IF;
  DELETE FROM business_profile.site_versions WHERE id = v.id;
  _r := business_profile._publish(_tenant, v.template, v.document, v.revision, v.note, v.created_by, auth.uid());
  UPDATE business_profile.sites
     SET first_approved_at = COALESCE(first_approved_at, now()),
         first_approved_by = COALESCE(first_approved_by, auth.uid()), updated_at = now()
   WHERE tenant_id = _tenant;
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled, updated_by)
  VALUES (_tenant, 'business_profile_public', true, auth.uid())
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true, updated_by = auth.uid(), updated_at = now();
  PERFORM business_profile._log(_tenant, 'publish.approved', jsonb_build_object('version', _r -> 'version'));
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), 'bp_publish_approved', jsonb_build_object('version', _r -> 'version'));
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.platform_bp_reject_publish(_tenant uuid, _version uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  PERFORM business_profile._require_platform_admin();
  IF _n IS NULL OR char_length(_n) > 500 THEN
    RAISE EXCEPTION 'כתבו לבעל העסק מה צריך לתקן (עד 500 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE business_profile.site_versions
     SET state = 'rejected', review_note = _n, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   WHERE id = _version AND tenant_id = _tenant AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'בקשת הפרסום לא נמצאה (אולי בוטלה או שכבר טופלה)' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM business_profile._log(_tenant, 'publish.rejected', '{}'::jsonb);
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), 'bp_publish_rejected', '{}'::jsonb);
  RETURN jsonb_build_object('status', 'rejected');
END $$;

-- הסתרת האתר הציבורי / החזרה (מנהל הפלטפורמה) — בלי למחוק גרסאות
CREATE OR REPLACE FUNCTION public.platform_bp_set_public(_tenant uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM business_profile._require_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM business_profile.sites s WHERE s.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'אתר העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _enabled AND NOT EXISTS (SELECT 1 FROM business_profile.sites s WHERE s.tenant_id = _tenant
                                 AND s.first_approved_at IS NOT NULL AND s.live_version_id IS NOT NULL) THEN
    RAISE EXCEPTION 'אי אפשר לפתוח אתר שעוד לא אושר לפרסום' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled, updated_by)
  VALUES (_tenant, 'business_profile_public', COALESCE(_enabled, false), auth.uid())
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = auth.uid(), updated_at = now();
  PERFORM business_profile._log(_tenant, 'site.public_set', jsonb_build_object('enabled', COALESCE(_enabled, false)));
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (_tenant, auth.uid(), 'bp_public_set', jsonb_build_object('enabled', COALESCE(_enabled, false)));
  RETURN business_profile._state(_tenant);
END $$;

-- ---------- 6. ממשק הניהול (/studio) — האתר של הבקשה בלבד ----------
CREATE OR REPLACE FUNCTION public.bp_studio_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
BEGIN
  RETURN jsonb_build_object(
    'site', (SELECT jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status)
               FROM public.tenants t WHERE t.id = _t),
    'permissions', to_jsonb(business_profile.permissions()),
    'platform_admin', public.is_platform_admin(auth.uid()),
    'state', business_profile._state(_t),
    'templates', (SELECT jsonb_agg(jsonb_build_object('key', x.key, 'label_he', x.label_he, 'label_en', x.label_en,
                                                      'status', x.status) ORDER BY x.sort)
                    FROM business_profile.templates x));
END $$;

CREATE OR REPLACE FUNCTION public.bp_draft_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  v business_profile.site_versions;
BEGIN
  SELECT * INTO v FROM business_profile.site_versions x WHERE x.tenant_id = _t AND x.state = 'draft';
  RETURN jsonb_build_object('document', v.document, 'revision', v.revision, 'template', v.template,
                            'updated_at', v.updated_at);
END $$;

-- שמירת טיוטה: רק כשה-revision שנשלח הוא הנוכחי (אחרת — "מישהו אחר שמר בינתיים", בלי לדרוס)
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

-- פרסום: לפני האישור הראשון — בקשה למנהל הפלטפורמה (צילום של הטיוטה); אחריו — גרסה מפורסמת חדשה מיד
CREATE OR REPLACE FUNCTION public.bp_publish(_revision integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('site.publish');
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
  d business_profile.site_versions;
  _approved boolean;
  _r jsonb;
BEGIN
  IF _n IS NOT NULL AND char_length(_n) > 300 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bp_publish:' || _t::text, 0));
  SELECT * INTO d FROM business_profile.site_versions x WHERE x.tenant_id = _t AND x.state = 'draft' FOR UPDATE;
  IF d.revision IS DISTINCT FROM _revision THEN
    RAISE EXCEPTION 'הטיוטה נשמרה בינתיים ממקום אחר — רעננו את העמוד ובדקו לפני הפרסום'
      USING ERRCODE = 'serialization_failure';
  END IF;
  PERFORM business_profile._template_of(d.document);
  SELECT s.first_approved_at IS NOT NULL INTO _approved FROM business_profile.sites s WHERE s.tenant_id = _t;
  IF NOT _approved THEN
    -- בקשה אחת: בקשה חדשה מחליפה את הקודמת (שלא טופלה)
    DELETE FROM business_profile.site_versions WHERE tenant_id = _t AND state = 'pending';
    INSERT INTO business_profile.site_versions (tenant_id, state, template, document, revision, note, created_by)
    VALUES (_t, 'pending', d.template, d.document, d.revision, _n, auth.uid());
    PERFORM business_profile._log(_t, 'publish.requested', jsonb_build_object('revision', d.revision));
    INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
    VALUES (_t, auth.uid(), 'bp_publish_requested', jsonb_build_object('revision', d.revision));
    RETURN jsonb_build_object('mode', 'pending_review');
  END IF;
  _r := business_profile._publish(_t, d.template, d.document, d.revision, _n, auth.uid(), NULL);
  PERFORM business_profile._log(_t, 'publish.published', jsonb_build_object('version', _r -> 'version'));
  RETURN jsonb_build_object('mode', 'published') || _r;
END $$;

CREATE OR REPLACE FUNCTION public.bp_cancel_publish_request()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('site.publish');
BEGIN
  DELETE FROM business_profile.site_versions WHERE tenant_id = _t AND state = 'pending';
  IF FOUND THEN
    PERFORM business_profile._log(_t, 'publish.request_cancelled', '{}'::jsonb);
  END IF;
  RETURN business_profile._state(_t);
END $$;

-- היסטוריית הגרסאות (בלי המסמכים עצמם)
CREATE OR REPLACE FUNCTION public.bp_versions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', v.id, 'state', v.state, 'version', v.version, 'template', v.template, 'note', v.note,
             'review_note', v.review_note, 'created_at', v.created_at, 'reviewed_at', v.reviewed_at,
             'live', v.id = s.live_version_id) ORDER BY v.created_at DESC)
      FROM business_profile.site_versions v
      JOIN business_profile.sites s ON s.tenant_id = v.tenant_id
     WHERE v.tenant_id = _t AND v.state IN ('pending', 'published', 'rejected')), '[]'::jsonb);
END $$;

-- גרסה אחת (לתצוגה מקדימה בממשק הניהול) — רק של האתר הזה
CREATE OR REPLACE FUNCTION public.bp_version_get(_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('content.edit');
  v business_profile.site_versions;
BEGIN
  SELECT * INTO v FROM business_profile.site_versions x WHERE x.id = _version AND x.tenant_id = _t;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'הגרסה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', v.id, 'state', v.state, 'version', v.version, 'template', v.template,
                            'document', v.document, 'created_at', v.created_at);
END $$;

-- שחזור: גרסה קודמת → הטיוטה (ההיסטוריה לא משתנה). אחר כך — פרסום רגיל
CREATE OR REPLACE FUNCTION public.bp_version_restore(_version uuid, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('versions.restore');
  v business_profile.site_versions;
  _new integer;
BEGIN
  SELECT * INTO v FROM business_profile.site_versions x
   WHERE x.id = _version AND x.tenant_id = _t AND x.state IN ('published', 'rejected');
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'הגרסה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM business_profile._template_of(v.document);
  UPDATE business_profile.site_versions
     SET document = v.document, template = v.template, revision = revision + 1, based_on = v.id, updated_at = now(),
         updated_by = auth.uid()
   WHERE tenant_id = _t AND state = 'draft' AND revision = _revision
  RETURNING revision INTO _new;
  IF _new IS NULL THEN
    RAISE EXCEPTION 'הטיוטה נשמרה בינתיים ממקום אחר — רעננו את העמוד לפני השחזור'
      USING ERRCODE = 'serialization_failure';
  END IF;
  PERFORM business_profile._log(_t, 'versions.restored', jsonb_build_object('version', v.version, 'from', v.id));
  RETURN jsonb_build_object('revision', _new);
END $$;

-- ---------- 7. האתר הציבורי ----------
-- הגרסה המפורסמת של האתר של הבקשה — רק כשהדגלים דולקים, הפרסום אושר והאתר לא מושעה. אחרת NULL (בלי
-- לחשוף אם יש טיוטה, בקשה או אתר בכלל)
CREATE OR REPLACE FUNCTION public.bp_public_site()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('name', t.name, 'version', v.version, 'template', v.template, 'document', v.document,
                            'published_at', v.created_at)
    FROM public.tenants t
    JOIN business_profile.sites s ON s.tenant_id = t.id AND s.first_approved_at IS NOT NULL
    JOIN business_profile.site_versions v ON v.id = s.live_version_id AND v.state = 'published'
   WHERE t.id = business_profile.request_site()
     AND t.status = 'active'
     AND public.platform_feature_enabled('business_profile_enabled', t.id)
     AND public.platform_feature_enabled('business_profile_public', t.id);
$$;

-- שם העסק לכותרות (גם לפני הפרסום — ממשק הניהול, עמוד "האתר בהקמה"); בלי שום תוכן
CREATE OR REPLACE FUNCTION public.bp_site_head()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('name', t.name)
    FROM public.tenants t WHERE t.id = business_profile.request_site();
$$;

-- ---------- 8. הרשאות ----------
REVOKE ALL ON FUNCTION public.platform_bp_open_site(text, text, text, jsonb), public.platform_bp_set_owner(uuid, text),
  public.platform_bp_sites(), public.platform_bp_review(uuid), public.platform_bp_approve_publish(uuid, uuid),
  public.platform_bp_reject_publish(uuid, uuid, text), public.platform_bp_set_public(uuid, boolean),
  public.bp_studio_context(), public.bp_draft_get(), public.bp_draft_save(jsonb, integer),
  public.bp_publish(integer, text), public.bp_cancel_publish_request(), public.bp_versions(),
  public.bp_version_get(uuid), public.bp_version_restore(uuid, integer), public.bp_public_site(), public.bp_site_head()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_bp_open_site(text, text, text, jsonb), public.platform_bp_set_owner(uuid, text),
  public.platform_bp_sites(), public.platform_bp_review(uuid), public.platform_bp_approve_publish(uuid, uuid),
  public.platform_bp_reject_publish(uuid, uuid, text), public.platform_bp_set_public(uuid, boolean),
  public.bp_studio_context(), public.bp_draft_get(), public.bp_draft_save(jsonb, integer),
  public.bp_publish(integer, text), public.bp_cancel_publish_request(), public.bp_versions(),
  public.bp_version_get(uuid), public.bp_version_restore(uuid, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_public_site(), public.bp_site_head() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Hospitality — מיגרציה 40: פתיחה עצמית של צימר מהשער (30 ימי ניסיון)
--
-- עד עכשיו "אתר לצימר" בשער (nuriel-app2) רק שלח בקשה — ובעל המקום חיכה לשיחה. עכשיו הוא פותח את
-- העסק בעצמו, מקבל 30 ימי ניסיון ומתחיל מיד למלא את הפרטים במדריך ההקמה; ובמקביל הבקשה נשמרת
-- (כמו קודם) ומנהלי הפלטפורמה מקבלים את הפרטים כדי לחזור אליו.
--
--   1. ניסיון של 30 יום (במקום 14) — לעסקים חדשים בלבד: הניסיון נקבע כשהעסק נפתח (הטריגר
--      settings_create_subscription), ולעסקים שכבר פתוחים כלום לא משתנה. רק אם הערך עוד 14
--      (ערך ברירת המחדל) — אין עריכה של ימי הניסיון בפאנל, אבל לא דורסים ערך אחר.
--   2. site_requests: opened_tenant_id + opened_at — העסק שנפתח מהבקשה (ובפאנל: "נפתח לניסיון").
--      השם לא tenant_id — הבקשות הן של הפלטפורמה, לא של העסק (בלי גישה מה-API; פונקציות בלבד).
--   3. portal_open_site(_email, _slug, _request) — מהשרת בלבד (אחרי אימות האימייל בשער ואחרי
--      שהשרת פתח חשבון התחברות לאימייל, אם לא היה). בטרנזקציה אחת:
--        • הבקשה (site_request_submit — אותן בדיקות, עד 3 ביום לאימייל);
--        • העסק — כמו admin_create_site: Tenant מסוג hospitality, ההגדרות המשותפות, פרטי העסק
--          (שם, אימייל, טלפון), מדיניות ביטול ראשונה ("גמישה"), מנוי ניסיון;
--        • המסד ואזור הניהול פתוחים לעסק (כמו admin_open_site); האתר הציבורי וההזמנות — בפרסום;
--        • בעל העסק — admin מוגן (כמו admin_set_owner, עם אותם סירובים: מנהל הפלטפורמה,
--          לקוח בחנות; ועד 10 אתרים לחשבון — כמו בחנויות), ביומן הפלטפורמה.
--      הכתובת נבדקת כמו בחנויות (tenant_slug_problem). כל כישלון — כלום לא נשמר.
--   4. האתר נפתח כשבעל העסק מפרסם: טריגר על גרסה מפורסמת (site_versions, kind = published) —
--      לעסק שנפתח מהשער מדליק את האתר הציבורי ואת ההזמנות. רק כשהפלטפורמה עוד לא החליטה לגבי
--      האתר של העסק הזה (אין לו עדיין דגל אתר משלו): דגל שמנהל הפלטפורמה כיבה — נשאר כבוי, ואחרי
--      הפתיחה הראשונה פרסומים נוספים לא נוגעים בדגלים. הדגלים הכלליים של הפלטפורמה (המנוע פתוח
--      בכלל) לא משתנים מכאן. ביומן הפלטפורמה.
--   5. מדריך ההקמה ועורך האתר: opens_on_publish — "האתר ייפתח לגולשים ברגע שתפרסמו" (במקום
--      "צוות נוריאל פותח אותו") כשהפרסום הבא באמת יפתח אותו.
--   6. portal_trial_days() — כמה ימי ניסיון (לשער, מהשרת בלבד).
--   7. _site_request_json — גם העסק שנפתח (כתובת ומועד).
--
-- בלי שינוי בחנויות ובהרשאות הקיימות. אידמפוטנטי.
-- Rollback: supabase/rollbacks/20261105170000_hosp_portal_open.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. 30 ימי ניסיון לעסק חדש
-- ------------------------------------------------------------
UPDATE hospitality.plans SET trial_days = 30, updated_at = now()
 WHERE code = 'trial' AND trial_days = 14;

-- ------------------------------------------------------------
-- 2. הבקשה → העסק שנפתח ממנה
-- ------------------------------------------------------------
ALTER TABLE hospitality.site_requests
  ADD COLUMN IF NOT EXISTS opened_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;
ALTER TABLE hospitality.site_requests ADD COLUMN IF NOT EXISTS opened_at timestamptz;
CREATE INDEX IF NOT EXISTS site_requests_opened_idx ON hospitality.site_requests (opened_tenant_id)
  WHERE opened_tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION hospitality._site_request_json(r hospitality.site_requests)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'email', r.email, 'business_name', r.business_name, 'phone', r.phone,
    'units', r.units, 'plan_code', r.plan_code,
    'plan_name', (SELECT p.name FROM hospitality.plans p WHERE p.code = r.plan_code),
    'area', r.area, 'message', r.message, 'status', r.status, 'admin_note', r.admin_note,
    'handled_at', hospitality._ts(r.handled_at), 'created_at', hospitality._ts(r.created_at),
    -- מיגרציה 40: העסק שנפתח מהשער (null — בקשה בלבד, או שהעסק נמחק)
    'opened_tenant_id', r.opened_tenant_id,
    'opened_slug', (SELECT t.slug FROM public.tenants t WHERE t.id = r.opened_tenant_id),
    'opened_at', hospitality._ts(r.opened_at));
$$;

-- העסק נפתח מהשער (יש בקשה שממנה הוא נפתח)
CREATE OR REPLACE FUNCTION hospitality._portal_opened(_t uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM hospitality.site_requests r
                  WHERE r.opened_tenant_id = _t AND r.opened_at IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION hospitality._portal_opened(uuid) FROM PUBLIC, anon, authenticated;

-- הפרסום הבא יפתח את האתר לגולשים: עסק מהשער, הפלטפורמה עוד לא החליטה לגבי האתר שלו,
-- והאתרים הציבוריים פתוחים בפלטפורמה בכלל
CREATE OR REPLACE FUNCTION hospitality._opens_on_publish(_t uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._portal_opened(_t)
     AND NOT EXISTS (SELECT 1 FROM public.tenant_feature_flags f
                      WHERE f.tenant_id = _t AND f.key = 'hospitality_frontend_enabled')
     AND COALESCE((SELECT f.enabled FROM public.platform_feature_flags f
                    WHERE f.key = 'hospitality_frontend_enabled'), false);
$$;
REVOKE ALL ON FUNCTION hospitality._opens_on_publish(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. פתיחת העסק מהשער (השרת בלבד)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.portal_open_site(_email text, _slug text, _request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _e text := lower(btrim(COALESCE(_email, '')));
  _s text := lower(btrim(COALESCE(_slug, '')));
  _max CONSTANT integer := 10;
  _uid uuid;
  _problem text;
  _req jsonb;
  t public.tenants;
BEGIN
  IF _e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  -- החשבון נפתח בשרת לפני הקריאה (אימייל מאומת בשער, בלי סיסמה)
  SELECT u.id INTO _uid FROM auth.users u
   WHERE lower(u.email) = _e AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'החשבון לא נמצא — התחילו מחדש מהזנת האימייל' USING ERRCODE = 'check_violation';
  END IF;

  -- אותה נעילה כמו בפתיחת חנות מהשער: שתי לשוניות — אחת אחרי השנייה
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-create:' || _uid::text, 7021));

  IF public.is_platform_admin(_uid) THEN
    RAISE EXCEPTION 'זה חשבון של מנהל הפלטפורמה — לפתיחת עסק השתמשו באימייל של בעל העסק'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur
              WHERE (ur.user_id = _uid OR lower(btrim(ur.email)) = _e) AND ur.role = 'customer') THEN
    RAISE EXCEPTION 'כתובת המייל הזו רשומה כלקוח בחנות אחרת במערכת. כדי לפתוח עסק משלכם השתמשו בכתובת מייל אחרת.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'admin') >= _max THEN
    RAISE EXCEPTION 'הגעתם למספר האתרים המרבי לחשבון אחד (%). לאתרים נוספים פנו לתמיכה.', _max
      USING ERRCODE = 'check_violation';
  END IF;

  _problem := public.tenant_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;

  -- הבקשה — אותן בדיקות ואותה מגבלה (3 ביום לאימייל); מנהלי הפלטפורמה חוזרים לבעל העסק
  _req := hospitality.site_request_submit(_e, _request);

  BEGIN
    INSERT INTO public.tenants (slug, name, owner_email, site_type)
    VALUES (_s, _req ->> 'business_name', _e, 'hospitality')
    RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י אתר אחר — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;

  -- כמו admin_create_site: ההגדרות המשותפות, פרטי העסק (מנוי הניסיון נוצר בטריגר), מדיניות ראשונה
  PERFORM public.platform_seed_tenant_shared(t.id);
  INSERT INTO hospitality.settings (tenant_id, business_name, contact_email, contact_phone)
  VALUES (t.id, _req ->> 'business_name', _e, _req ->> 'phone');
  INSERT INTO hospitality.policies (tenant_id, name, is_default, free_cancel_days, fee_tiers, no_show_fee)
  VALUES (t.id, 'גמישה', true, 7, '[{"from_days": 7, "fee": "percent_total", "value": 50}]'::jsonb, 'full');

  -- כמו admin_open_site: המסד ואזור הניהול; האתר הציבורי וההזמנות — בפרסום (סעיף 4)
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
  VALUES (t.id, 'hospitality_backend_enabled', true), (t.id, 'hospitality_management_enabled', true)
  ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true;

  -- כמו admin_set_owner: בעל העסק — admin מוגן
  INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, is_protected)
  VALUES (t.id, _uid, _e, 'admin', true, true);

  UPDATE hospitality.site_requests r SET opened_tenant_id = t.id, opened_at = now()
   WHERE r.id = (_req ->> 'id')::uuid;

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (t.id, _uid, 'hosp_site_opened',
          jsonb_build_object('slug', t.slug, 'plan', 'trial', 'owner', hospitality.mask_email(_e),
                             'source', 'portal', 'request', _req ->> 'id'));

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'domain', t.domain,
                                 'is_default', t.is_default, 'status', t.status,
                                 'custom_domain', t.custom_domain,
                                 'custom_domain_status', t.custom_domain_status,
                                 'created_at', t.created_at),
    'trial_ends_at', hospitality._ts((SELECT s.trial_ends_at FROM hospitality.subscriptions s WHERE s.tenant_id = t.id)),
    'request', _req);
END $$;
REVOKE ALL ON FUNCTION hospitality.portal_open_site(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.portal_open_site(text, text, jsonb) TO service_role;

-- כמה ימי ניסיון מקבל עסק חדש (לשער — מהשרת בלבד)
CREATE OR REPLACE FUNCTION hospitality.portal_trial_days()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.trial_days FROM hospitality.plans p WHERE p.code = 'trial';
$$;
REVOKE ALL ON FUNCTION hospitality.portal_trial_days() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.portal_trial_days() TO service_role;

-- ------------------------------------------------------------
-- 4. האתר נפתח כשבעל העסק מפרסם (עסק שנפתח מהשער)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.site_versions_portal_open()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  -- רק עסק מהשער, ורק כשהפלטפורמה עוד לא החליטה לגבי האתר שלו (דגל שכובה — נשאר כבוי;
  -- אחרי הפתיחה הראשונה — פרסומים נוספים לא נוגעים בדגלים)
  IF NOT hospitality._portal_opened(NEW.tenant_id)
     OR EXISTS (SELECT 1 FROM public.tenant_feature_flags f
                 WHERE f.tenant_id = NEW.tenant_id AND f.key = 'hospitality_frontend_enabled') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled, updated_at, updated_by)
  VALUES (NEW.tenant_id, 'hospitality_frontend_enabled', true, now(), auth.uid()),
         (NEW.tenant_id, 'hospitality_booking_enabled', true, now(), auth.uid())
  ON CONFLICT (tenant_id, key) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
    VALUES (NEW.tenant_id, auth.uid(), 'hosp_site_opened_on_publish',
            jsonb_build_object('version', NEW.version, 'flags', _n));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hospitality.site_versions_portal_open() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS site_versions_portal_open ON hospitality.site_versions;
CREATE TRIGGER site_versions_portal_open AFTER INSERT ON hospitality.site_versions
FOR EACH ROW WHEN (NEW.kind = 'published') EXECUTE FUNCTION hospitality.site_versions_portal_open();

-- ------------------------------------------------------------
-- 5. מדריך ההקמה ועורך האתר: "האתר ייפתח ברגע שתפרסמו"
-- ------------------------------------------------------------
-- כמו במיגרציה 35, עם opens_on_publish בצעד הפרסום
CREATE OR REPLACE FUNCTION hospitality.setup_guide()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN jsonb_set(hospitality._setup_view(_t), '{steps,publish,opens_on_publish}',
                   to_jsonb(hospitality._opens_on_publish(_t)), true);
END $$;

CREATE OR REPLACE FUNCTION hospitality.setup_save(_step text, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  st hospitality.setup_state;
BEGIN
  IF _step IS NULL OR _step NOT IN ('details', 'contact', 'units', 'photos', 'prices', 'booking', 'policy',
                                    'payments', 'template', 'logo', 'site', 'seo', 'publish') THEN
    RAISE EXCEPTION 'צעד לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _action IS NULL OR _action NOT IN ('visit', 'confirm', 'unconfirm', 'skip', 'unskip') THEN
    RAISE EXCEPTION 'פעולה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _action IN ('confirm', 'unconfirm') AND _step NOT IN ('booking', 'policy', 'payments') THEN
    RAISE EXCEPTION 'את הצעד הזה משלימים במסך שלו' USING ERRCODE = 'check_violation';
  END IF;
  IF _action IN ('skip', 'unskip') AND _step NOT IN ('logo', 'seo') THEN
    RAISE EXCEPTION 'אי אפשר לדלג על הצעד הזה' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO hospitality.setup_state AS x (tenant_id, current_step, confirmed, skipped, updated_by, updated_at)
  VALUES (_t, _step,
          CASE WHEN _action = 'confirm' THEN ARRAY[_step] ELSE '{}' END,
          CASE WHEN _action = 'skip' THEN ARRAY[_step] ELSE '{}' END,
          auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE
     SET current_step = _step,
         confirmed = CASE _action
                       WHEN 'confirm' THEN ARRAY(SELECT DISTINCT e FROM unnest(x.confirmed || _step) e ORDER BY e)
                       WHEN 'unconfirm' THEN array_remove(x.confirmed, _step)
                       ELSE x.confirmed END,
         skipped = CASE _action
                     WHEN 'skip' THEN ARRAY(SELECT DISTINCT e FROM unnest(x.skipped || _step) e ORDER BY e)
                     WHEN 'unskip' THEN array_remove(x.skipped, _step)
                     ELSE x.skipped END,
         updated_by = auth.uid(),
         updated_at = now()
  RETURNING * INTO st;

  IF _action <> 'visit' THEN
    PERFORM hospitality._audit(_t, 'setup.' || _action, 'מדריך ההקמה', jsonb_build_object('step', _step));
  END IF;
  RETURN jsonb_set(hospitality._setup_view(_t), '{steps,publish,opens_on_publish}',
                   to_jsonb(hospitality._opens_on_publish(_t)), true);
END $$;

-- כמו במיגרציה 21, עם opens_on_publish
CREATE OR REPLACE FUNCTION hospitality.site_editor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  d hospitality.site_versions;
  p hospitality.site_versions;
BEGIN
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft';
  SELECT * INTO p FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
   ORDER BY x.version DESC LIMIT 1;
  RETURN jsonb_build_object(
    'draft', CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
               'revision', d.revision, 'theme', d.theme, 'document', d.document, 'based_on', d.based_on,
               'updated_at', hospitality._ts(d.updated_at)) END,
    'published', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
               'version', p.version, 'theme', p.theme, 'document', p.document,
               'published_at', hospitality._ts(p.created_at)) END,
    -- שינויים שעוד לא פורסמו: יש טיוטה, והיא שונה מהגרסה האחרונה
    'unpublished', d.id IS NOT NULL AND (p.id IS NULL OR d.document IS DISTINCT FROM p.document OR d.theme <> p.theme),
    'site_open', hospitality.flag_for('hospitality_frontend_enabled', _t),
    -- מיגרציה 40: הפרסום הבא יפתח את האתר לגולשים (עסק שנפתח מהשער)
    'opens_on_publish', hospitality._opens_on_publish(_t),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'theme', v.theme,
                            'note', v.note, 'published_at', hospitality._ts(v.created_at)) ORDER BY v.version DESC)
                            FROM (SELECT * FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
                                   ORDER BY x.version DESC LIMIT 30) v), '[]'::jsonb));
END $$;

COMMIT;

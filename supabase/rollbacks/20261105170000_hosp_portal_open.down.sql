-- ============================================================
-- Rollback — מיגרציה 40 (20261105170000_hosp_portal_open.sql)
-- מחזיר את _site_request_json כפי שהייתה במיגרציה 31, את setup_guide ו-setup_save כפי שהיו
-- במיגרציה 35 ואת site_editor כפי שהייתה במיגרציה 21 — מילה במילה; מוריד את portal_open_site,
-- portal_trial_days, הטריגר "האתר נפתח בפרסום" ופונקציות העזר, ואת שתי העמודות של הבקשות.
-- הניסיון לעסק חדש חוזר ל-14 יום (רק אם הוא עדיין 30).
-- מה קורה: עסקים שכבר נפתחו מהשער נשארים כמו שהם — עסקים רגילים (בעלים, ניסיון, דגלים). הקישור
-- בין הבקשה לעסק נמחק (נשאר ביומן הפלטפורמה: hosp_site_opened עם source = portal ומזהה הבקשה),
-- ועסק כזה שעוד לא פרסם — האתר שלו ייפתח רק כשמנהל הפלטפורמה ידליק אותו (כמו לפני 40).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE OR REPLACE FUNCTION hospitality._site_request_json(r hospitality.site_requests)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'email', r.email, 'business_name', r.business_name, 'phone', r.phone,
    'units', r.units, 'plan_code', r.plan_code,
    'plan_name', (SELECT p.name FROM hospitality.plans p WHERE p.code = r.plan_code),
    'area', r.area, 'message', r.message, 'status', r.status, 'admin_note', r.admin_note,
    'handled_at', hospitality._ts(r.handled_at), 'created_at', hospitality._ts(r.created_at));
$$;

CREATE OR REPLACE FUNCTION hospitality.setup_guide()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN hospitality._setup_view(_t);
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
  RETURN hospitality._setup_view(_t);
END $$;

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
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'theme', v.theme,
                            'note', v.note, 'published_at', hospitality._ts(v.created_at)) ORDER BY v.version DESC)
                            FROM (SELECT * FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
                                   ORDER BY x.version DESC LIMIT 30) v), '[]'::jsonb));
END $$;

DROP TRIGGER IF EXISTS site_versions_portal_open ON hospitality.site_versions;
DROP FUNCTION IF EXISTS hospitality.site_versions_portal_open();
DROP FUNCTION IF EXISTS hospitality.portal_open_site(text, text, jsonb);
DROP FUNCTION IF EXISTS hospitality.portal_trial_days();
DROP FUNCTION IF EXISTS hospitality._opens_on_publish(uuid);
DROP FUNCTION IF EXISTS hospitality._portal_opened(uuid);

DROP INDEX IF EXISTS hospitality.site_requests_opened_idx;
ALTER TABLE hospitality.site_requests DROP COLUMN IF EXISTS opened_at;
ALTER TABLE hospitality.site_requests DROP COLUMN IF EXISTS opened_tenant_id;

UPDATE hospitality.plans SET trial_days = 14, updated_at = now()
 WHERE code = 'trial' AND trial_days = 30;

COMMIT;

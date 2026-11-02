-- ============================================================
-- Hospitality — מדריך ההקמה (מיגרציה 35)
--
-- מסך אחד שמוביל עסק חדש מההרשמה עד אתר מוכן לפרסום, ומחזיר אותו לאותה נקודה כשהוא חוזר.
-- הסטטוס של כל צעד מחושב מהנתונים עצמם (לא "סימון ידני" שמתיישן); רק שלושה דברים נשמרים:
--
--   • setup_state (שורה לעסק): הצעד האחרון שהעסק עבד עליו (current_step — להמשך מאותה נקודה),
--     צעדי "בדיקה" שאושרו (confirmed: הגדרות הזמנה / מדיניות ביטול / תשלום — ערכי ברירת המחדל
--     יכולים להתאים, ואז "בדקתי, מתאים לי" הוא ההשלמה), וצעדי רשות שדילגו עליהם (skipped: לוגו,
--     גוגל ושיתוף). RLS, בלי הרשאות ישירות, בידוד עסק + דגל המסד (כמו שאר הטבלאות).
--   • setup_guide() — הרשאת settings (כמו עורך האתר וההגדרות), אזור הניהול פעיל: 13 הצעדים עם
--     עובדות להצגה (כמה יחידות / תמונות / מחירים, ערכת העיצוב, מצב הפרסום), חמשת אבני הדרך
--     (פרטים / יחידה / תמונות / מחירים / אתר מוכן לפרסום) והמצב השמור. בלי פרטים אישיים.
--   • setup_save(צעד, פעולה) — visit (הצעד הנוכחי) / confirm / unconfirm / skip / unskip, רק לצעדים
--     שמתאימים לפעולה; אישור ודילוג נרשמים ביומן הפעולות של העסק.
--
-- טיוטה אף פעם לא מוצגת כמפורסמת: "פורסם" = יש גרסה מפורסמת (האתר הציבורי קורא רק אותה);
-- שינויים בטיוטה שעוד לא פורסמו מסומנים בנפרד, וגם האם האתר פתוח לגולשים (החלטה של הפלטפורמה).
--
-- management_context(): לרשימת ההקמה בלוח הבקרה נוסף 'site' — "האתר מוכן לפרסום" (אותו חישוב
-- כמו במדריך). 'policy' נשאר בתשובה (תאימות לגרסת האפליקציה הקודמת בזמן העדכון).
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105120000_hosp_setup_guide.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. המצב השמור של המדריך
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.setup_state (
  tenant_id    uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  current_step text CHECK (current_step IS NULL OR current_step IN (
                 'details', 'contact', 'units', 'photos', 'prices', 'booking', 'policy', 'payments',
                 'template', 'logo', 'site', 'seo', 'publish')),
  confirmed    text[] NOT NULL DEFAULT '{}' CHECK (confirmed <@ ARRAY['booking', 'policy', 'payments']),
  skipped      text[] NOT NULL DEFAULT '{}' CHECK (skipped <@ ARRAY['logo', 'seo']),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.setup_state IS 'Hospitality: מדריך ההקמה — הצעד האחרון, צעדים שאושרו ודילוגים (שורה לעסק)';

ALTER TABLE hospitality.setup_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.setup_state FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.setup_state;
CREATE POLICY tenant_isolation ON hospitality.setup_state AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.setup_state;
CREATE POLICY backend_enabled ON hospitality.setup_state AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.setup_state;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.setup_state
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- ------------------------------------------------------------
-- 2. "האתר מוכן לפרסום" — אבן הדרך המשותפת למדריך ולרשימה בלוח הבקרה
-- ------------------------------------------------------------
-- פרטי העסק (שם + טלפון או מייל), ערכת עיצוב (טיוטה או גרסה), ולפחות יחידה אחת שאפשר להזמין:
-- פעילה, במתחם פעיל, עם מחיר ועם תמונה משלה (לא תמונת הדגמה) — כמו "חסר כדי לקבל הזמנות".
CREATE OR REPLACE FUNCTION hospitality._setup_site_ready(_t uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT btrim(s.business_name) <> '' AND (s.contact_phone IS NOT NULL OR s.contact_email IS NOT NULL)
                     FROM hospitality.settings s WHERE s.tenant_id = _t), false)
     AND EXISTS (SELECT 1 FROM hospitality.site_versions v WHERE v.tenant_id = _t)
     AND EXISTS (SELECT 1 FROM hospitality.units u
                   JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
                  WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active' AND u.base_price > 0
                    AND EXISTS (SELECT 1 FROM hospitality.media m
                                 WHERE m.tenant_id = u.tenant_id AND m.unit_id = u.id
                                   AND m.kind = 'image' AND NOT m.is_demo));
$$;
REVOKE ALL ON FUNCTION hospitality._setup_site_ready(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. העובדות והסטטוס של כל צעד (פנימי)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._setup_view(_t uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s  hospitality.settings;
  st hospitality.setup_state;
  d  hospitality.site_versions;
  p  hospitality.site_versions;
  pol hospitality.policies;
  _units int; _active int; _priced int; _bookable int; _no_photo int; _photos int;
  _policy_reviewed boolean;
  _logo boolean; _seo boolean; _edited boolean;
  _steps jsonb;
  _ms jsonb;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  SELECT * INTO st FROM hospitality.setup_state x WHERE x.tenant_id = _t;
  SELECT * INTO d FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'draft';
  SELECT * INTO p FROM hospitality.site_versions x WHERE x.tenant_id = _t AND x.kind = 'published'
   ORDER BY x.version DESC LIMIT 1;
  SELECT * INTO pol FROM hospitality.policies x WHERE x.tenant_id = _t AND x.is_default AND NOT x.is_archived LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE u.is_active),
         count(*) FILTER (WHERE u.is_active AND u.base_price > 0),
         count(*) FILTER (WHERE u.is_active AND x.status = 'active' AND u.base_price > 0 AND ph.has),
         count(*) FILTER (WHERE u.is_active AND NOT ph.has)
    INTO _units, _active, _priced, _bookable, _no_photo
    FROM hospitality.units u
    JOIN hospitality.properties x ON x.tenant_id = u.tenant_id AND x.id = u.property_id
   CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM hospitality.media m
                                       WHERE m.tenant_id = u.tenant_id AND m.unit_id = u.id
                                         AND m.kind = 'image' AND NOT m.is_demo) AS has) ph
   WHERE u.tenant_id = _t;
  SELECT count(*) INTO _photos FROM hospitality.media m WHERE m.tenant_id = _t AND m.kind = 'image' AND NOT m.is_demo;

  -- אותו כלל כמו ברשימה של לוח הבקרה: מדיניות נערכה אחרי שנוצרה, או שיש יותר ממדיניות אחת
  _policy_reviewed := EXISTS (SELECT 1 FROM hospitality.policy_versions v WHERE v.tenant_id = _t AND v.version > 1)
                      OR (SELECT count(*) FROM hospitality.policies x WHERE x.tenant_id = _t) > 1;
  -- מהטיוטה (אם יש) או מהגרסה המפורסמת
  _logo := COALESCE(COALESCE(d.document, p.document) ? 'logo', false);
  _seo := COALESCE(NULLIF(btrim(COALESCE(d.document, p.document) -> 'seo' ->> 'title'), ''),
                   NULLIF(btrim(COALESCE(d.document, p.document) -> 'seo' ->> 'description'), '')) IS NOT NULL;
  -- העסק עבד על האתר: הטיוטה נשמרה מאז שנוצרה, או שכבר פורסמה גרסה
  _edited := p.id IS NOT NULL OR COALESCE(d.revision, 1) > 1;

  _steps := jsonb_build_object(
    'details', jsonb_build_object('done', COALESCE(btrim(s.business_name) <> '', false),
                 'name', COALESCE(btrim(s.business_name) <> '', false),
                 'address', COALESCE(btrim(s.address) <> '', false)),
    'contact', jsonb_build_object('done', s.contact_phone IS NOT NULL OR s.contact_email IS NOT NULL,
                 'phone', s.contact_phone IS NOT NULL, 'email', s.contact_email IS NOT NULL,
                 'whatsapp', s.whatsapp_phone IS NOT NULL),
    'units', jsonb_build_object('done', _active > 0, 'total', _units, 'active', _active),
    'photos', jsonb_build_object('done', _photos > 0, 'count', _photos, 'units_without', _no_photo),
    'prices', jsonb_build_object('done', _priced > 0, 'priced', _priced, 'active', _active),
    'booking', jsonb_build_object(
                 'done', 'booking' = ANY (COALESCE(st.confirmed, '{}'))
                         -- או שהעסק כבר שינה את ברירות המחדל במסך ההגדרות
                         OR COALESCE(s.check_in_time, '15:00'::time) <> '15:00'::time
                         OR COALESCE(s.check_out_time, '11:00'::time) <> '11:00'::time
                         OR COALESCE(s.approval_window_minutes, 720) <> 720,
                 'confirmed', 'booking' = ANY (COALESCE(st.confirmed, '{}')),
                 'mode', COALESCE(s.booking_mode, 'request'),
                 'check_in', to_char(COALESCE(s.check_in_time, '15:00'::time), 'HH24:MI'),
                 'check_out', to_char(COALESCE(s.check_out_time, '11:00'::time), 'HH24:MI'),
                 'approval_hours', round(COALESCE(s.approval_window_minutes, 720) / 60.0, 1)),
    'policy', jsonb_build_object(
                 'done', _policy_reviewed OR 'policy' = ANY (COALESCE(st.confirmed, '{}')),
                 'confirmed', 'policy' = ANY (COALESCE(st.confirmed, '{}')),
                 'reviewed', _policy_reviewed,
                 'name', pol.name, 'free_cancel_days', pol.free_cancel_days),
    'payments', jsonb_build_object(
                 'done', COALESCE(pol.deposit_kind, 'none') <> 'none' OR 'payments' = ANY (COALESCE(st.confirmed, '{}')),
                 'confirmed', 'payments' = ANY (COALESCE(st.confirmed, '{}')),
                 'deposit_kind', COALESCE(pol.deposit_kind, 'none'),
                 'deposit_value', COALESCE(pol.deposit_value, 0),
                 'deposit_due', COALESCE(pol.deposit_due, 'approval')),
    'template', jsonb_build_object('done', d.id IS NOT NULL OR p.id IS NOT NULL, 'theme', COALESCE(d.theme, p.theme)),
    'logo', jsonb_build_object('done', _logo OR 'logo' = ANY (COALESCE(st.skipped, '{}')),
                 'has', _logo, 'skipped', 'logo' = ANY (COALESCE(st.skipped, '{}'))),
    'site', jsonb_build_object('done', _edited, 'edited', _edited),
    'seo', jsonb_build_object('done', _seo OR 'seo' = ANY (COALESCE(st.skipped, '{}')),
                 'has', _seo, 'skipped', 'seo' = ANY (COALESCE(st.skipped, '{}'))),
    'publish', jsonb_build_object('done', p.id IS NOT NULL,
                 'published', p.id IS NOT NULL,
                 'version', p.version,
                 'published_at', hospitality._ts(p.created_at),
                 -- שינויים שעוד לא פורסמו: יש טיוטה והיא שונה מהגרסה האחרונה (כמו בעורך האתר)
                 'unpublished', d.id IS NOT NULL AND (p.id IS NULL OR d.document IS DISTINCT FROM p.document OR d.theme <> p.theme),
                 'ready', hospitality._setup_site_ready(_t),
                 'site_open', hospitality.flag('hospitality_frontend_enabled'),
                 'booking_open', hospitality.flag('hospitality_booking_enabled')));

  _ms := jsonb_build_object(
    'business', (_steps -> 'details' ->> 'done')::boolean AND (_steps -> 'contact' ->> 'done')::boolean,
    'units', _active > 0,
    'photos', _photos > 0,
    'prices', _priced > 0,
    'site', hospitality._setup_site_ready(_t));

  RETURN jsonb_build_object(
    'steps', _steps,
    'milestones', _ms,
    'bookable_units', _bookable,
    'state', jsonb_build_object(
      'current_step', st.current_step,
      'confirmed', to_jsonb(COALESCE(st.confirmed, '{}')),
      'skipped', to_jsonb(COALESCE(st.skipped, '{}')),
      'updated_at', hospitality._ts(st.updated_at)));
END $$;
REVOKE ALL ON FUNCTION hospitality._setup_view(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. ה-API: קריאה ושמירה (הרשאת settings, אזור הניהול פעיל)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.setup_guide()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN hospitality._setup_view(_t);
END $$;
REVOKE ALL ON FUNCTION hospitality.setup_guide() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.setup_guide() TO authenticated, service_role;

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
REVOKE ALL ON FUNCTION hospitality.setup_save(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.setup_save(text, text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. ההקשר של אזור הניהול: + 'site' (האתר מוכן לפרסום) ברשימת ההקמה
-- ------------------------------------------------------------
-- כמו במיגרציה 7, עם מפתח אחד נוסף ברשימה. 'policy' נשאר (גרסת האפליקציה הקודמת קוראת אותו).
CREATE OR REPLACE FUNCTION hospitality.management_context()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
  _role text;
  t public.tenants;
  s hospitality.settings;
  _e jsonb;
BEGIN
  IF _t IS NULL OR public.current_site_type() IS DISTINCT FROM 'hospitality' THEN
    RAISE EXCEPTION 'אין לחשבון הזה הרשאת ניהול באתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _role := public.store_staff_role(auth.uid());
  IF _role IS NULL OR _role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'אין לחשבון הזה הרשאת ניהול באתר הזה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT hospitality.flag('hospitality_backend_enabled') OR NOT hospitality.flag('hospitality_management_enabled') THEN
    RAISE EXCEPTION 'אזור הניהול אינו פעיל באתר הזה' USING ERRCODE = 'feature_not_supported';
  END IF;
  SELECT * INTO t FROM public.tenants x WHERE x.id = _t;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  _e := hospitality.entitlements(_t);
  RETURN jsonb_build_object(
    'role', _role,
    'permissions', (SELECT jsonb_object_agg(p, hospitality.can(p)) FROM unnest(hospitality.permissions()) p),
    'flags', jsonb_build_object(
      'management', true,
      'frontend', hospitality.flag('hospitality_frontend_enabled'),
      'booking', hospitality.flag('hospitality_booking_enabled')),
    'site', jsonb_build_object('name', t.name, 'slug', t.slug, 'status', t.status),
    'business', jsonb_build_object(
      'name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
      'timezone', COALESCE(s.timezone, 'Asia/Jerusalem'),
      'currency', COALESCE(s.currency, 'ILS')),
    'entitlements', CASE WHEN hospitality.can('billing.manage') THEN _e
                         ELSE jsonb_build_object('active', _e -> 'active', 'max_units', _e -> 'max_units',
                                                 'units_used', _e -> 'units_used') END,
    'checklist', jsonb_build_object(
      'business', COALESCE(btrim(s.business_name) <> '' AND (s.contact_phone IS NOT NULL OR s.contact_email IS NOT NULL), false),
      'units', EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.is_active),
      'photos', EXISTS (SELECT 1 FROM hospitality.media m WHERE m.tenant_id = _t AND m.kind = 'image' AND NOT m.is_demo),
      'prices', EXISTS (SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.is_active AND u.base_price > 0),
      -- מדיניות הביטול נבדקה: יש יותר ממדיניות אחת, או שמדיניות נערכה אחרי שנוצרה
      'policy', EXISTS (SELECT 1 FROM hospitality.policy_versions v WHERE v.tenant_id = _t AND v.version > 1)
                OR (SELECT count(*) FROM hospitality.policies x WHERE x.tenant_id = _t) > 1,
      -- מיגרציה 35: האתר מוכן לפרסום (כמו במדריך ההקמה)
      'site', hospitality._setup_site_ready(_t)));
END $$;
REVOKE ALL ON FUNCTION hospitality.management_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.management_context() TO authenticated, service_role;

COMMIT;

-- ============================================================
-- Rollback של 20261105140000_hosp_payment_instructions.sql (מיגרציה 37 — הוראות תשלום לאורחים)
-- נמחקים: payment_settings (הוראות התשלום של העסקים — לשמור עותק לפני, אם צריך) והפונקציות שלה.
-- מצב התשלום של ההזמנות ויומן התשלומים לא נוגעים (המיגרציה לא שינתה אותם).
-- _setup_view חוזרת לגרסה של מיגרציה 35 — מילה במילה.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "תשלום מאורחים".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- מדריך ההקמה — הגרסה של מיגרציה 35
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

DROP FUNCTION IF EXISTS hospitality.email_payment_methods(uuid);
DROP FUNCTION IF EXISTS hospitality.public_payment_methods();
DROP FUNCTION IF EXISTS hospitality.guest_payment_info(text, uuid);
DROP FUNCTION IF EXISTS hospitality.payment_settings_save(jsonb, integer);
DROP FUNCTION IF EXISTS hospitality.payment_settings_view();
DROP FUNCTION IF EXISTS hospitality._payment_settings_json(uuid);
DROP FUNCTION IF EXISTS hospitality._payment_phone(uuid);
DROP FUNCTION IF EXISTS hospitality._payment_methods(uuid);
DROP FUNCTION IF EXISTS hospitality._payment_settings(uuid);
DROP TABLE IF EXISTS hospitality.payment_settings;

COMMIT;

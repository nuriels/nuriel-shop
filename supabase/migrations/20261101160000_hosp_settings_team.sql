-- ============================================================
-- Hospitality Stage 2b.1 — הגדרות העסק וצוות הניהול (מיגרציה 8)
--
--   1. הרשאה לבעלים בלבד: settings.owner (נמעני ההתראות)
--   2. יומן פעולות hospitality.audit_log — רק הוספה; נכתב רק ע"י הפונקציות; נקרא
--      רק ע"י הבעלים (team_activity). מי, באיזה אתר, מתי ומה השתנה — בלי סיסמאות,
--      טוקנים, וכתובות / טלפונים מלאים (מוסתרים).
--   3. הגדרות: לצוות אין יותר עדכון ישיר של hospitality.settings. קריאה וכתיבה
--      דרך settings_view() / update_settings(): הרשאה לכל שדה, בדיקה עם הודעה
--      בעברית, שדות נעולים (מטבע, אזור זמן, הזמנה מיידית, זמן החזקת תשלום),
--      ובדיקת "עודכן בינתיים" לפי settings.revision.
--   4. צוות: team_members / team_add_manager / team_remove_manager /
--      team_activity — לבעלים בלבד. ההוספה רצה בשם הבעלים, כך שכל ההגנות
--      הקיימות של user_roles חלות (בעלים בלבד, מגבלת מקומות, חשבון לקוח של
--      חנות אחרת, סוג התפקיד באתר).
--   5. trigger על public.user_roles לשורות של אתרי אירוח בלבד: מי שאינו הבעלים
--      של האתר (או מנהל פלטפורמה / השרת) משנה רק את שם המשתמש ושם התצוגה של
--      השורה של עצמו. שורות של חנויות — אין שום שינוי (היציאה בשורה הראשונה).
--
-- Rollback: supabase/rollbacks/20261101160000_hosp_settings_team.down.sql
-- אידמפוטנטית.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הרשאות: settings.owner — לבעלים בלבד
-- ------------------------------------------------------------
--   settings.owner — נמעני ההתראות של העסק — הבעלים בלבד
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

--   owner   → כל ההרשאות
--   manager → הכל חוץ מ-staff.managers, billing.manage, guests.privacy ו-settings.owner
CREATE OR REPLACE FUNCTION hospitality.can(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _permission = ANY (hospitality.permissions())
    AND public.current_site_type() = 'hospitality'
    AND CASE public.store_staff_role(auth.uid())
          WHEN 'owner' THEN true
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- צוות של אתר האירוח, כשהמסד ואזור הניהול פעילים לאתר
CREATE OR REPLACE FUNCTION hospitality._manage_tenant(_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant(_permission);
BEGIN
  IF NOT hospitality.flag('hospitality_management_enabled') THEN
    RAISE EXCEPTION 'אזור הניהול אינו פעיל באתר הזה' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN _t;
END $$;
REVOKE ALL ON FUNCTION hospitality._manage_tenant(text) FROM PUBLIC, anon, authenticated;

-- "•••4567" — לתצוגה ולתיעוד בלבד
CREATE OR REPLACE FUNCTION hospitality.mask_phone(_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _phone IS NULL THEN NULL
              ELSE '•••' || right(regexp_replace(_phone, '[^0-9]', '', 'g'), 4) END;
$$;
REVOKE ALL ON FUNCTION hospitality.mask_phone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.mask_phone(text) TO service_role;

-- ------------------------------------------------------------
-- 2. יומן הפעולות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- בלי מפתח זר: ההיסטוריה נשמרת גם אחרי שחשבון נמחק
  actor_id     uuid,
  actor_role   text NOT NULL CHECK (actor_role IN ('owner', 'manager', 'platform', 'system')),
  -- תמונת מצב לתצוגה: שם התצוגה / שם המשתמש / אימייל מוסתר
  actor_label  text CHECK (actor_label IS NULL OR char_length(actor_label) <= 120),
  action       text NOT NULL CHECK (action ~ '^[a-z][a-z_.]{2,59}$'),
  target_label text CHECK (target_label IS NULL OR char_length(target_label) <= 120),
  changes      jsonb NOT NULL DEFAULT '{}'::jsonb
               CHECK (jsonb_typeof(changes) = 'object' AND pg_column_size(changes) <= 8192),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON hospitality.audit_log (tenant_id, created_at DESC, id DESC);
COMMENT ON TABLE hospitality.audit_log IS 'Hospitality: יומן פעולות (צוות, הגדרות) — רק הוספה';
ALTER TABLE hospitality.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON hospitality.audit_log TO service_role;
-- כמו כל טבלה עם tenant_id בסכמה: בידוד לפי אתר ודגל המסד (RESTRICTIVE). אין מדיניות
-- PERMISSIVE ואין הרשאות — אין גישה ישירה בכלל; קריאה רק דרך team_activity()
DROP POLICY IF EXISTS tenant_isolation ON hospitality.audit_log;
CREATE POLICY tenant_isolation ON hospitality.audit_log AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.audit_log;
CREATE POLICY backend_enabled ON hospitality.audit_log AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));

-- רק הוספה: אין עדכון ואין מחיקה (גם לא לבעלי המסד) — חוץ ממחיקת האתר כולו
-- (ON DELETE CASCADE מ-tenants, שרץ מתוך trigger אחר, או platform_delete_tenant)
CREATE OR REPLACE FUNCTION hospitality.audit_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (pg_catalog.pg_trigger_depth() > 1
       OR COALESCE(current_setting('nuriel.deleting_tenant', true), '') = OLD.tenant_id::text) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'יומן הפעולות אינו ניתן לשינוי או למחיקה' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION hospitality.audit_log_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_log_append_only ON hospitality.audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON hospitality.audit_log
FOR EACH ROW EXECUTE FUNCTION hospitality.audit_log_append_only();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON hospitality.audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON hospitality.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION hospitality.audit_log_append_only();

-- רישום פעולה בשם המשתמש הנוכחי
CREATE OR REPLACE FUNCTION hospitality._audit(_tenant_id uuid, _action text, _target_label text, _changes jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _me uuid := auth.uid();
  _role text;
  _label text;
BEGIN
  IF _me IS NULL THEN
    _role := 'system';
  ELSIF public.is_platform_admin(_me) THEN
    _role := 'platform';
  ELSE
    SELECT CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END,
           COALESCE(NULLIF(btrim(ur.display_name), ''), ur.username)
      INTO _role, _label
      FROM public.user_roles ur
     WHERE ur.tenant_id = _tenant_id AND ur.user_id = _me AND ur.role = 'admin';
    _role := COALESCE(_role, 'system');
  END IF;
  IF _label IS NULL AND _me IS NOT NULL THEN
    SELECT hospitality.mask_email(lower(u.email)) INTO _label FROM auth.users u WHERE u.id = _me;
  END IF;
  INSERT INTO hospitality.audit_log (tenant_id, actor_id, actor_role, actor_label, action, target_label, changes)
  VALUES (_tenant_id, _me, _role, left(_label, 120), _action, left(_target_label, 120), COALESCE(_changes, '{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality._audit(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. הגדרות העסק
-- ------------------------------------------------------------
ALTER TABLE hospitality.settings ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
-- לצוות אין עדכון ישיר (גם לא בעמודות) — רק דרך update_settings()
REVOKE UPDATE ON hospitality.settings FROM authenticated;
REVOKE UPDATE (business_name, contact_phone, contact_email, whatsapp_phone, address, check_in_time,
               check_out_time, booking_mode, approval_window_minutes, approval_reminder_pct,
               max_open_requests, payment_hold_minutes, weekend_nights, currency, timezone,
               guest_retention_months, notification_emails)
  ON hospitality.settings FROM authenticated;

-- השם של כל שדה בהודעות למשתמש
CREATE OR REPLACE FUNCTION hospitality._settings_label(_field text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _field
    WHEN 'business_name' THEN 'שם העסק'
    WHEN 'contact_phone' THEN 'טלפון העסק'
    WHEN 'contact_email' THEN 'אימייל העסק'
    WHEN 'whatsapp_phone' THEN 'מספר WhatsApp'
    WHEN 'address' THEN 'כתובת העסק'
    WHEN 'check_in_time' THEN 'שעת הגעה'
    WHEN 'check_out_time' THEN 'שעת עזיבה'
    WHEN 'approval_window_minutes' THEN 'זמן לאישור בקשה'
    WHEN 'approval_reminder_pct' THEN 'זמן התזכורת'
    WHEN 'max_open_requests' THEN 'בקשות פתוחות לאורח'
    WHEN 'weekend_nights' THEN 'לילות סוף שבוע'
    WHEN 'notification_emails' THEN 'נמעני ההתראות'
    WHEN 'guest_retention_months' THEN 'שמירת פרטי אורחים'
    WHEN 'booking_mode' THEN 'אופן ההזמנה'
    WHEN 'currency' THEN 'מטבע'
    WHEN 'timezone' THEN 'אזור זמן'
    WHEN 'payment_hold_minutes' THEN 'זמן החזקה לתשלום'
    ELSE _field END;
$$;
REVOKE ALL ON FUNCTION hospitality._settings_label(text) FROM PUBLIC, anon, authenticated;

-- טקסט מ-jsonb: null / "" → NULL (או שגיאה אם חובה); אורך מרבי
CREATE OR REPLACE FUNCTION hospitality._sv_text(_v jsonb, _field text, _max integer, _required boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _s text;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN
    _s := NULL;
  ELSIF jsonb_typeof(_v) <> 'string' THEN
    RAISE EXCEPTION '% — ערך לא תקין', hospitality._settings_label(_field) USING ERRCODE = 'check_violation';
  ELSE
    _s := NULLIF(btrim(_v #>> '{}'), '');
  END IF;
  IF _s IS NULL AND _required THEN
    RAISE EXCEPTION 'יש למלא את %', hospitality._settings_label(_field) USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_s) > _max THEN
    RAISE EXCEPTION '% ארוך מדי (עד % תווים)', hospitality._settings_label(_field), _max USING ERRCODE = 'check_violation';
  END IF;
  RETURN _s;
END $$;
REVOKE ALL ON FUNCTION hospitality._sv_text(jsonb, text, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._sv_int(_v jsonb, _field text, _min integer, _max integer, _required boolean)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN
    IF _required THEN
      RAISE EXCEPTION 'יש למלא את %', hospitality._settings_label(_field) USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)
     OR (_v #>> '{}')::numeric NOT BETWEEN _min AND _max THEN
    RAISE EXCEPTION '% חייב להיות מספר שלם בין % ל-%', hospitality._settings_label(_field), _min, _max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN (_v #>> '{}')::integer;
END $$;
REVOKE ALL ON FUNCTION hospitality._sv_int(jsonb, text, integer, integer, boolean) FROM PUBLIC, anon, authenticated;

-- הערכים של ההגדרות לתצוגה (שעות כ-HH:MM)
CREATE OR REPLACE FUNCTION hospitality._settings_values(s hospitality.settings)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'business_name', s.business_name, 'contact_phone', s.contact_phone, 'contact_email', s.contact_email,
    'whatsapp_phone', s.whatsapp_phone, 'address', s.address,
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'), 'check_out_time', to_char(s.check_out_time, 'HH24:MI'),
    'approval_window_minutes', s.approval_window_minutes, 'approval_reminder_pct', s.approval_reminder_pct,
    'max_open_requests', s.max_open_requests, 'weekend_nights', to_jsonb(s.weekend_nights),
    'notification_emails', to_jsonb(s.notification_emails), 'guest_retention_months', s.guest_retention_months,
    'booking_mode', s.booking_mode, 'currency', s.currency, 'timezone', s.timezone,
    'payment_hold_minutes', s.payment_hold_minutes);
$$;
REVOKE ALL ON FUNCTION hospitality._settings_values(hospitality.settings) FROM PUBLIC, anon, authenticated;

-- השדות שכל איש צוות עם הרשאת settings עורך; של הבעלים; נעולים
CREATE OR REPLACE FUNCTION hospitality._settings_fields(_kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _kind
    WHEN 'general' THEN ARRAY['business_name', 'contact_phone', 'contact_email', 'whatsapp_phone', 'address',
                              'check_in_time', 'check_out_time', 'approval_window_minutes', 'approval_reminder_pct',
                              'max_open_requests', 'weekend_nights']
    WHEN 'locked' THEN ARRAY['booking_mode', 'currency', 'timezone', 'payment_hold_minutes']
    ELSE '{}'::text[] END;
$$;
REVOKE ALL ON FUNCTION hospitality._settings_fields(text) FROM PUBLIC, anon, authenticated;

-- ההגדרות לתצוגה + מה המשתמש רשאי לערוך
CREATE OR REPLACE FUNCTION hospitality.settings_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  s hospitality.settings;
  _editable text[] := hospitality._settings_fields('general');
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הגדרות העסק לא נמצאו' USING ERRCODE = 'no_data_found';
  END IF;
  IF hospitality.can('settings.owner') THEN
    _editable := _editable || 'notification_emails'::text;
  END IF;
  IF hospitality.can('guests.privacy') THEN
    _editable := _editable || 'guest_retention_months'::text;
  END IF;
  RETURN jsonb_build_object(
    'revision', s.revision,
    'updated_at', hospitality._ts(s.updated_at),
    'values', hospitality._settings_values(s),
    'editable', to_jsonb(_editable),
    'locked', to_jsonb(hospitality._settings_fields('locked')));
END $$;
REVOKE ALL ON FUNCTION hospitality.settings_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.settings_view() TO authenticated, service_role;

-- שמירת שינויים: { "field": value, ... } + הגרסה שהמסך טען.
-- כל שדה נבדק (הרשאה, ערך) לפני שמשהו נכתב; שינוי אמיתי → revision + 1 ושורה ביומן.
CREATE OR REPLACE FUNCTION hospitality.update_settings(_changes jsonb, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  s hospitality.settings;
  n hospitality.settings;
  k text;
  v jsonb;
  _s text;
  _arr text[];
  _nights smallint[];
  _diff jsonb := '{}'::jsonb;
  _old jsonb;
  _new jsonb;
BEGIN
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הגדרות העסק לא נמצאו' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS DISTINCT FROM s.revision THEN
    RAISE EXCEPTION 'ההגדרות עודכנו בינתיים — מרעננים' USING ERRCODE = 'HS409';
  END IF;
  n := s;

  FOR k, v IN SELECT e.key, e.value FROM jsonb_each(_changes) e ORDER BY e.key LOOP
    IF k = ANY (hospitality._settings_fields('locked')) THEN
      RAISE EXCEPTION 'השדה "%" נעול בשלב הזה', hospitality._settings_label(k) USING ERRCODE = 'insufficient_privilege';
    ELSIF k = 'notification_emails' AND NOT hospitality.can('settings.owner') THEN
      RAISE EXCEPTION 'רק בעל העסק יכול לשנות את %', hospitality._settings_label(k) USING ERRCODE = 'insufficient_privilege';
    ELSIF k = 'guest_retention_months' AND NOT hospitality.can('guests.privacy') THEN
      RAISE EXCEPTION 'רק בעל העסק יכול לשנות את %', hospitality._settings_label(k) USING ERRCODE = 'insufficient_privilege';
    ELSIF NOT (k = ANY (hospitality._settings_fields('general')) OR k IN ('notification_emails', 'guest_retention_months')) THEN
      RAISE EXCEPTION 'שדה לא מוכר: %', left(k, 40) USING ERRCODE = 'check_violation';
    END IF;

    CASE k
      WHEN 'business_name' THEN
        n.business_name := hospitality._sv_text(v, k, 120, true);
      WHEN 'address' THEN
        n.address := hospitality._sv_text(v, k, 300, false);
      WHEN 'contact_phone', 'whatsapp_phone' THEN
        _s := hospitality._sv_text(v, k, 20, false);
        IF _s IS NOT NULL AND _s !~ '^\+?[0-9 ()-]{7,20}$' THEN
          RAISE EXCEPTION '% — מספר הטלפון לא תקין', hospitality._settings_label(k) USING ERRCODE = 'check_violation';
        END IF;
        IF k = 'contact_phone' THEN n.contact_phone := _s; ELSE n.whatsapp_phone := _s; END IF;
      WHEN 'contact_email' THEN
        _s := lower(hospitality._sv_text(v, k, 254, false));
        IF _s IS NOT NULL AND _s !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
          RAISE EXCEPTION 'כתובת האימייל של העסק לא תקינה' USING ERRCODE = 'check_violation';
        END IF;
        n.contact_email := _s;
      WHEN 'check_in_time', 'check_out_time' THEN
        _s := hospitality._sv_text(v, k, 5, true);
        IF _s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          RAISE EXCEPTION '% — שעה לא תקינה (למשל 15:00)', hospitality._settings_label(k) USING ERRCODE = 'check_violation';
        END IF;
        IF k = 'check_in_time' THEN n.check_in_time := _s::time; ELSE n.check_out_time := _s::time; END IF;
      WHEN 'approval_window_minutes' THEN
        n.approval_window_minutes := hospitality._sv_int(v, k, 60, 2880, true);
      WHEN 'approval_reminder_pct' THEN
        n.approval_reminder_pct := hospitality._sv_int(v, k, 10, 90, true);
      WHEN 'max_open_requests' THEN
        n.max_open_requests := hospitality._sv_int(v, k, 1, 10, true);
      WHEN 'weekend_nights' THEN
        IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) > 7
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x
                       WHERE jsonb_typeof(x) <> 'number' OR (x #>> '{}') !~ '^[0-6]$') THEN
          RAISE EXCEPTION 'לילות סוף שבוע — יש לבחור ימים מהרשימה' USING ERRCODE = 'check_violation';
        END IF;
        SELECT COALESCE(array_agg(DISTINCT (x #>> '{}')::smallint ORDER BY (x #>> '{}')::smallint), '{}')
          INTO _nights FROM jsonb_array_elements(v) x;
        n.weekend_nights := _nights;
      WHEN 'notification_emails' THEN
        IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) > 5
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) <> 'string') THEN
          RAISE EXCEPTION 'נמעני ההתראות — עד 5 כתובות אימייל' USING ERRCODE = 'check_violation';
        END IF;
        SELECT COALESCE(array_agg(DISTINCT lower(btrim(x #>> '{}'))), '{}') INTO _arr
          FROM jsonb_array_elements(v) x WHERE btrim(x #>> '{}') <> '';
        IF EXISTS (SELECT 1 FROM unnest(_arr) e WHERE e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(e) > 254) THEN
          RAISE EXCEPTION 'נמעני ההתראות — אחת הכתובות לא תקינה' USING ERRCODE = 'check_violation';
        END IF;
        n.notification_emails := _arr;
      WHEN 'guest_retention_months' THEN
        n.guest_retention_months := hospitality._sv_int(v, k, 6, 120, false);
    END CASE;

    -- מה השתנה — ליומן (אימיילים וטלפונים מוסתרים)
    _old := hospitality._settings_values(s) -> k;
    _new := hospitality._settings_values(n) -> k;
    IF _old IS DISTINCT FROM _new THEN
      IF k IN ('contact_email') THEN
        _old := to_jsonb(hospitality.mask_email(s.contact_email));
        _new := to_jsonb(hospitality.mask_email(n.contact_email));
      ELSIF k IN ('contact_phone', 'whatsapp_phone') THEN
        _old := to_jsonb(hospitality.mask_phone(_old #>> '{}'));
        _new := to_jsonb(hospitality.mask_phone(_new #>> '{}'));
      ELSIF k = 'notification_emails' THEN
        _old := (SELECT COALESCE(jsonb_agg(hospitality.mask_email(e) ORDER BY e), '[]'::jsonb) FROM unnest(s.notification_emails) e);
        _new := (SELECT COALESCE(jsonb_agg(hospitality.mask_email(e) ORDER BY e), '[]'::jsonb) FROM unnest(n.notification_emails) e);
      END IF;
      _diff := _diff || jsonb_build_object(k, jsonb_build_object('from', _old, 'to', _new));
    END IF;
  END LOOP;

  IF _diff <> '{}'::jsonb THEN
    UPDATE hospitality.settings x
       SET business_name = n.business_name, contact_phone = n.contact_phone, contact_email = n.contact_email,
           whatsapp_phone = n.whatsapp_phone, address = n.address, check_in_time = n.check_in_time,
           check_out_time = n.check_out_time, approval_window_minutes = n.approval_window_minutes,
           approval_reminder_pct = n.approval_reminder_pct, max_open_requests = n.max_open_requests,
           weekend_nights = n.weekend_nights, notification_emails = n.notification_emails,
           guest_retention_months = n.guest_retention_months, revision = s.revision + 1
     WHERE x.tenant_id = _t;
    PERFORM hospitality._audit(_t, 'settings.updated', NULL, _diff);
  END IF;
  RETURN hospitality.settings_view();
END $$;
REVOKE ALL ON FUNCTION hospitality.update_settings(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.update_settings(jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. צוות הניהול (בעלים בלבד)
-- ------------------------------------------------------------
-- הבעלים והמנהלים של האתר (בלי מנהלי פלטפורמה) + המקומות
CREATE OR REPLACE FUNCTION hospitality.team_members()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e jsonb := hospitality.entitlements(_t);
BEGIN
  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ur.user_id,
               'role', CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END,
               'display_name', ur.display_name, 'username', ur.username, 'email', lower(u.email),
               'is_blocked', ur.is_blocked, 'added_at', hospitality._ts(ur.created_at),
               'last_sign_in_at', hospitality._ts(u.last_sign_in_at))
             ORDER BY ur.is_protected DESC, ur.created_at, ur.user_id)
        FROM public.user_roles ur
        JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id)), '[]'::jsonb),
    'seats', jsonb_build_object('used', _e -> 'managers_used', 'limit', _e -> 'max_managers', 'active', _e -> 'active'));
END $$;
REVOKE ALL ON FUNCTION hospitality.team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_members() TO authenticated, service_role;

-- הוספת מנהל לפי אימייל. רץ בשם הבעלים — ה-triggers הקיימים של user_roles חלים.
-- אין חשבון → {status: needs_account} (רק אחרי שכל הבדיקות שלא תלויות בחשבון עברו);
-- השרת יוצר חשבון מאומת וקורא שוב. כבר מנהל → {status: already_member}.
CREATE OR REPLACE FUNCTION hospitality.team_add_manager(_email text, _display_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  _e text := lower(btrim(COALESCE(_email, '')));
  _name text := NULLIF(btrim(COALESCE(_display_name, '')), '');
  _ent jsonb;
  _uid uuid;
  _role text;
  _generic CONSTANT text := 'אי אפשר לצרף את החשבון הזה כמנהל. פנו לתמיכה.';
BEGIN
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) > 60 THEN
    RAISE EXCEPTION 'השם ארוך מדי (עד 60 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  -- מנעול המקומות של האתר קודם לכל: הוספה מקבילה של אותו אדם מחכה כאן, ואחר כך
  -- רואה את השורה שנוספה (already_member) — ולא "הגעתם למגבלה" על המקום שהיא עצמה תפסה
  PERFORM pg_advisory_xact_lock(hashtextextended('admin_seats:' || _t::text, 0));

  SELECT u.id INTO _uid FROM auth.users u
   WHERE lower(u.email) = _e AND u.deleted_at IS NULL
   ORDER BY u.created_at LIMIT 1;

  IF _uid IS NOT NULL THEN
    SELECT ur.role INTO _role FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _uid;
    IF _role = 'admin' THEN
      RETURN jsonb_build_object('status', 'already_member', 'user_id', _uid);
    ELSIF _role IS NOT NULL OR public.is_platform_admin(_uid)
          OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.role = 'customer') THEN
      -- לא חושפים למה (לקוח של חנות אחרת / מנהל פלטפורמה / תפקיד אחר)
      RAISE EXCEPTION '%', _generic USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- בדיקות שלא תלויות בחשבון — לפני שמבקשים מהשרת ליצור חשבון
  _ent := hospitality.entitlements(_t);
  IF NOT COALESCE((_ent ->> 'active')::boolean, false) THEN
    RAISE EXCEPTION 'המנוי של האתר אינו פעיל — אי אפשר להוסיף מנהלים' USING ERRCODE = 'check_violation';
  END IF;
  IF _ent ->> 'max_managers' IS NOT NULL
     AND (_ent ->> 'managers_used')::integer >= (_ent ->> 'max_managers')::integer THEN
    RAISE EXCEPTION 'הגעתם למגבלת המנהלים בחבילה (%). אפשר להסיר מנהל או לבקש מקומות נוספים.', _ent ->> 'max_managers'
      USING ERRCODE = 'check_violation';
  END IF;

  IF _uid IS NULL THEN
    RETURN jsonb_build_object('status', 'needs_account');
  END IF;

  BEGIN
    INSERT INTO public.user_roles (tenant_id, user_id, email, role, is_approved, display_name)
    VALUES (_t, _uid, _e, 'admin', true, _name);
  EXCEPTION WHEN unique_violation THEN
    -- הוספה מקבילה של אותו אדם — כבר מנהל; כל סיבה אחרת — הודעה כללית
    IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _uid AND ur.role = 'admin') THEN
      RETURN jsonb_build_object('status', 'already_member', 'user_id', _uid);
    END IF;
    RAISE EXCEPTION '%', _generic USING ERRCODE = 'insufficient_privilege';
  END;
  PERFORM hospitality._audit(_t, 'team.manager_added', COALESCE(_name, hospitality.mask_email(_e)),
                             jsonb_build_object('email', hospitality.mask_email(_e)));
  RETURN jsonb_build_object('status', 'added', 'user_id', _uid);
END $$;
REVOKE ALL ON FUNCTION hospitality.team_add_manager(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_add_manager(text, text) TO authenticated, service_role;

-- הסרת מנהל (לא הבעלים). הגישה נגמרת מיד: אין יותר שיוך לאתר.
CREATE OR REPLACE FUNCTION hospitality.team_remove_manager(_user_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _email text;
BEGIN
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'אי אפשר להסיר את בעל העסק' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = _user_id;
  DELETE FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = _user_id;
  PERFORM hospitality._audit(_t, 'team.manager_removed',
                             COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(COALESCE(_email, r.email))),
                             jsonb_build_object('email', hospitality.mask_email(COALESCE(_email, r.email))));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.team_remove_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_remove_manager(uuid) TO authenticated, service_role;

-- הפעילות האחרונה (צוות + הגדרות), החדשה קודם
CREATE OR REPLACE FUNCTION hospitality.team_activity(_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
BEGIN
  IF _limit IS NULL OR _limit < 1 OR _limit > 200 THEN
    RAISE EXCEPTION 'מספר רשומות לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'at', hospitality._ts(a.created_at), 'actor_role', a.actor_role, 'actor', a.actor_label,
             'action', a.action, 'target', a.target_label, 'changes', a.changes) ORDER BY a.created_at DESC, a.id DESC)
      FROM (SELECT * FROM hospitality.audit_log x WHERE x.tenant_id = _t
             ORDER BY x.created_at DESC, x.id DESC LIMIT _limit) a), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.team_activity(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_activity(integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. user_roles באתרי אירוח: מנהל משנה רק את שם המשתמש ושם התצוגה של עצמו
-- ------------------------------------------------------------
-- רק לשורות של אתרי אירוח (לפני ואחרי השינוי). השרת (בלי משתמש) ומנהלי הפלטפורמה —
-- הכללים הקיימים. הבעלים של האתר (המנהל המוגן, לא חסום) — הכללים הקיימים.
-- כל השאר: רק השורה של עצמם, ורק username / display_name. חנויות: אין שינוי.
CREATE OR REPLACE FUNCTION hospitality.user_roles_admin_row_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants t
                  WHERE t.id IN (OLD.tenant_id, NEW.tenant_id) AND t.site_type = 'hospitality') THEN
    RETURN NEW;
  END IF;
  IF _me IS NULL OR public.is_platform_admin(_me) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur
              WHERE ur.tenant_id = OLD.tenant_id AND ur.user_id = _me AND ur.role = 'admin'
                AND ur.is_protected AND NOT ur.is_blocked) THEN
    RETURN NEW;
  END IF;
  IF OLD.user_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לשנות פרטים של מנהלים אחרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.user_id, NEW.tenant_id, NEW.role, NEW.email, NEW.is_approved, NEW.is_blocked, NEW.is_protected,
      NEW.must_change_password, NEW.agent_number, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.tenant_id, OLD.role, OLD.email, OLD.is_approved, OLD.is_blocked, OLD.is_protected,
      OLD.must_change_password, OLD.agent_number, OLD.created_at) THEN
    RAISE EXCEPTION 'אפשר לשנות רק את שם המשתמש ואת שם התצוגה שלך' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.user_roles_admin_row_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS hospitality_admin_row_guard ON public.user_roles;
CREATE TRIGGER hospitality_admin_row_guard
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION hospitality.user_roles_admin_row_guard();

COMMIT;

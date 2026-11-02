-- ============================================================
-- Hospitality — מיגרציה 37: הוראות תשלום לאורחים (העברה בנקאית, Bit, טלפון, הוראות משלכם)
--
-- אין סליקה באתר (D4). עד עכשיו האורח שמע רק "נציג העסק יתקשר להשלמת התשלום". עכשיו בעל העסק
-- בוחר איך משלמים לו, והאורח רואה את ההוראות בעמוד ההזמנה שלו (הקישור המאובטח) — אחרי שההזמנה
-- אושרה ונשאר סכום לתשלום.
--
--   • payment_settings (שורה לעסק): העברה בנקאית (בנק, סניף, חשבון, שם בעל החשבון), Bit (טלפון),
--     תשלום טלפוני (ברירת המחדל — כמו היום; טלפון לפניות, ואם אין — טלפון העסק), והוראות משלכם
--     (טקסט חופשי). RLS, בלי הרשאות ישירות, בידוד עסק + דגל המסד, tenant_guard.
--   • payment_settings_view() — הרשאת settings (בעלים ומנהלים רואים מה האורחים יראו).
--   • payment_settings_save(שינויים, גרסה) — בעלי העסק בלבד: שינוי של לאן הכסף הולך הוא הפעולה
--     הרגישה ביותר בעסק (מנהל לא יכול להפנות תשלומים לחשבון שלו). גרסה (עריכה מקבילה), בדיקת שדות,
--     ויומן הפעולות (אילו שדות השתנו — בלי הערכים).
--   • guest_payment_info(טוקן / הזמנה של אורח מחובר) — האורח של ההזמנה בלבד (אותה בדיקה כמו
--     פרטי ההגעה): פרטי התשלום רק כשההזמנה אושרה (או ממתינה לתשלום) ויש יתרה; לפני האישור —
--     רק אילו אמצעים קיימים ("יופיעו כאן אחרי האישור"). מספר ההזמנה כאסמכתא להעברה.
--   • public_payment_methods() — לאתר: רק אילו אמצעים פעילים (בלי פרטים), לנוסח בטופס ההזמנה.
--   • email_payment_methods(עסק) — לשרת בלבד (מפתח השירות), לנוסח המיילים.
--   • מדריך ההקמה: צעד "תשלום ומקדמה" מושלם גם כשהוגדרו הוראות תשלום, ומציג אילו אמצעים פעילים.
--
-- הוראות תשלום אינן אישור שהכסף התקבל: מצב התשלום (לא שולם / מקדמה / שולם) ממשיך להתעדכן רק
-- מיומן התשלומים, אחרי שהעסק רושם תשלום שקיבל (payment_record). שום פונקציה כאן לא נוגעת בו.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105140000_hosp_payment_instructions.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. ההגדרות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.payment_settings (
  tenant_id      uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  bank_enabled   boolean NOT NULL DEFAULT false,
  bank_name      text CHECK (bank_name IS NULL OR char_length(bank_name) BETWEEN 2 AND 60),
  bank_branch    text CHECK (bank_branch IS NULL OR bank_branch ~ '^[0-9]{1,4}$'),
  bank_account   text CHECK (bank_account IS NULL OR bank_account ~ '^[0-9]([0-9-]{2,18})[0-9]$'),
  bank_holder    text CHECK (bank_holder IS NULL OR char_length(bank_holder) BETWEEN 2 AND 80),
  bit_enabled    boolean NOT NULL DEFAULT false,
  bit_phone      text CHECK (bit_phone IS NULL OR bit_phone ~ '^05[0-9]-?[0-9]{7}$'),
  phone_enabled  boolean NOT NULL DEFAULT true,
  phone_number   text CHECK (phone_number IS NULL OR phone_number ~ '^\+?[0-9 ()-]{7,20}$'),
  note           text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  revision       integer NOT NULL DEFAULT 1,
  updated_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- אמצעי פעיל — עם כל הפרטים שלו
  CHECK (NOT bank_enabled OR (bank_name IS NOT NULL AND bank_branch IS NOT NULL AND bank_account IS NOT NULL
                              AND bank_holder IS NOT NULL)),
  CHECK (NOT bit_enabled OR bit_phone IS NOT NULL)
);
COMMENT ON TABLE hospitality.payment_settings IS 'Hospitality: הוראות תשלום לאורחים (העברה בנקאית / Bit / טלפון / טקסט) — שורה לעסק';

ALTER TABLE hospitality.payment_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.payment_settings FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.payment_settings;
CREATE POLICY tenant_isolation ON hospitality.payment_settings AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.payment_settings;
CREATE POLICY backend_enabled ON hospitality.payment_settings AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.payment_settings;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.payment_settings
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- ------------------------------------------------------------
-- 2. עזרים פנימיים
-- ------------------------------------------------------------
-- השורה של העסק — וברירת המחדל כשעוד לא נשמרה (תשלום טלפוני, כמו היום)
CREATE OR REPLACE FUNCTION hospitality._payment_settings(_t uuid)
RETURNS hospitality.payment_settings LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p hospitality.payment_settings;
BEGIN
  SELECT * INTO p FROM hospitality.payment_settings x WHERE x.tenant_id = _t;
  IF NOT FOUND THEN
    p.tenant_id := _t;
    p.bank_enabled := false;
    p.bit_enabled := false;
    p.phone_enabled := true;
    p.revision := 0;
  END IF;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION hospitality._payment_settings(uuid) FROM PUBLIC, anon, authenticated;

-- האמצעים הפעילים, בסדר קבוע: bank / bit / phone / note
CREATE OR REPLACE FUNCTION hospitality._payment_methods(_t uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY(SELECT m FROM (VALUES
           (1, 'bank', p.bank_enabled),
           (2, 'bit', p.bit_enabled),
           (3, 'phone', p.phone_enabled),
           (4, 'note', p.note IS NOT NULL)) v(o, m, on_)
          WHERE v.on_ ORDER BY v.o)
    FROM hospitality._payment_settings(_t) p;
$$;
REVOKE ALL ON FUNCTION hospitality._payment_methods(uuid) FROM PUBLIC, anon, authenticated;

-- הטלפון לתשלום: המספר שהוגדר לתשלומים, ואם אין — טלפון העסק
CREATE OR REPLACE FUNCTION hospitality._payment_phone(_t uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(p.phone_number, (SELECT s.contact_phone FROM hospitality.settings s WHERE s.tenant_id = _t))
    FROM hospitality._payment_settings(_t) p;
$$;
REVOKE ALL ON FUNCTION hospitality._payment_phone(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._payment_settings_json(_t uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'bank_enabled', p.bank_enabled, 'bank_name', p.bank_name, 'bank_branch', p.bank_branch,
    'bank_account', p.bank_account, 'bank_holder', p.bank_holder,
    'bit_enabled', p.bit_enabled, 'bit_phone', p.bit_phone,
    'phone_enabled', p.phone_enabled, 'phone_number', p.phone_number,
    'note', p.note, 'revision', p.revision,
    'methods', to_jsonb(hospitality._payment_methods(_t)),
    'business_phone', (SELECT s.contact_phone FROM hospitality.settings s WHERE s.tenant_id = _t),
    'updated_at', hospitality._ts(p.updated_at))
    FROM hospitality._payment_settings(_t) p;
$$;
REVOKE ALL ON FUNCTION hospitality._payment_settings_json(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. אזור הניהול: צפייה (settings) ושמירה (בעלים בלבד)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.payment_settings_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN hospitality._payment_settings_json(_t)
         || jsonb_build_object('editable', public.store_staff_role(auth.uid()) = 'owner');
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_settings_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_settings_view() TO authenticated, service_role;

-- _changes: רק השדות ששונו. ערך ריק ("") = מחיקה. מחזיר את התצוגה המעודכנת.
CREATE OR REPLACE FUNCTION hospitality.payment_settings_save(_changes jsonb, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  p hospitality.payment_settings;
  _k text;
  _v jsonb;
  _txt text;
  _changed text[] := '{}';
BEGIN
  IF public.store_staff_role(auth.uid()) IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'רק בעלי העסק יכולים לשנות את פרטי התשלום' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' THEN
    RAISE EXCEPTION 'אין שינויים לשמירה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT _k2 INTO _k FROM jsonb_object_keys(_changes) _k2
   WHERE _k2 NOT IN ('bank_enabled', 'bank_name', 'bank_branch', 'bank_account', 'bank_holder',
                     'bit_enabled', 'bit_phone', 'phone_enabled', 'phone_number', 'note') LIMIT 1;
  IF _k IS NOT NULL THEN
    RAISE EXCEPTION 'שדה לא מוכר: %', _k USING ERRCODE = 'check_violation';
  END IF;

  -- עריכה מקבילה: נועלים את השורה (או את העסק, כשעוד אין שורה) ובודקים את הגרסה
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-payment-settings:' || _t, 0));
  p := hospitality._payment_settings(_t);
  IF _revision IS DISTINCT FROM p.revision THEN
    RAISE EXCEPTION 'פרטי התשלום השתנו בינתיים — טענו מחדש ושמרו שוב' USING ERRCODE = 'serialization_failure';
  END IF;

  FOR _k, _v IN SELECT * FROM jsonb_each(_changes) LOOP
    IF _k IN ('bank_enabled', 'bit_enabled', 'phone_enabled') THEN
      IF jsonb_typeof(_v) <> 'boolean' THEN
        RAISE EXCEPTION 'ערך לא תקין: %', _k USING ERRCODE = 'check_violation';
      END IF;
    ELSIF jsonb_typeof(_v) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'ערך לא תקין: %', _k USING ERRCODE = 'check_violation';
    END IF;
    _txt := NULLIF(btrim(regexp_replace(COALESCE(_v #>> '{}', ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), '');
    CASE _k
      WHEN 'bank_enabled' THEN p.bank_enabled := (_v #>> '{}')::boolean;
      WHEN 'bit_enabled' THEN p.bit_enabled := (_v #>> '{}')::boolean;
      WHEN 'phone_enabled' THEN p.phone_enabled := (_v #>> '{}')::boolean;
      WHEN 'bank_name' THEN p.bank_name := left(regexp_replace(_txt, '\s+', ' ', 'g'), 60);
      WHEN 'bank_holder' THEN p.bank_holder := left(regexp_replace(_txt, '\s+', ' ', 'g'), 80);
      WHEN 'bank_branch' THEN p.bank_branch := regexp_replace(_txt, '\s', '', 'g');
      WHEN 'bank_account' THEN p.bank_account := regexp_replace(_txt, '[\s/]', '', 'g');
      WHEN 'bit_phone' THEN p.bit_phone := regexp_replace(_txt, '[\s()]', '', 'g');
      WHEN 'phone_number' THEN p.phone_number := _txt;
      WHEN 'note' THEN p.note := _txt;
    END CASE;
    _changed := _changed || _k;
  END LOOP;

  BEGIN
    INSERT INTO hospitality.payment_settings AS x
      (tenant_id, bank_enabled, bank_name, bank_branch, bank_account, bank_holder, bit_enabled, bit_phone,
       phone_enabled, phone_number, note, revision, updated_by, updated_at)
    VALUES (_t, p.bank_enabled, p.bank_name, p.bank_branch, p.bank_account, p.bank_holder, p.bit_enabled,
            p.bit_phone, p.phone_enabled, p.phone_number, p.note, p.revision + 1, auth.uid(), now())
    ON CONFLICT (tenant_id) DO UPDATE
       SET bank_enabled = EXCLUDED.bank_enabled, bank_name = EXCLUDED.bank_name,
           bank_branch = EXCLUDED.bank_branch, bank_account = EXCLUDED.bank_account,
           bank_holder = EXCLUDED.bank_holder, bit_enabled = EXCLUDED.bit_enabled,
           bit_phone = EXCLUDED.bit_phone, phone_enabled = EXCLUDED.phone_enabled,
           phone_number = EXCLUDED.phone_number, note = EXCLUDED.note,
           revision = EXCLUDED.revision, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '%', CASE
      WHEN p.bank_enabled AND (p.bank_name IS NULL OR p.bank_branch IS NULL OR p.bank_account IS NULL OR p.bank_holder IS NULL)
        THEN 'להעברה בנקאית צריך בנק, סניף, מספר חשבון ושם בעל החשבון'
      WHEN p.bank_branch IS NOT NULL AND p.bank_branch !~ '^[0-9]{1,4}$' THEN 'מספר סניף: עד 4 ספרות'
      WHEN p.bank_account IS NOT NULL AND p.bank_account !~ '^[0-9]([0-9-]{2,18})[0-9]$' THEN 'מספר חשבון: ספרות (ומקפים), 4 עד 20 תווים'
      WHEN p.bit_enabled AND p.bit_phone IS NULL THEN 'ל-Bit צריך מספר טלפון נייד'
      WHEN p.bit_phone IS NOT NULL AND p.bit_phone !~ '^05[0-9]-?[0-9]{7}$' THEN 'מספר Bit: טלפון נייד ישראלי (05X-XXXXXXX)'
      WHEN p.phone_number IS NOT NULL AND p.phone_number !~ '^\+?[0-9 ()-]{7,20}$' THEN 'מספר טלפון לא תקין'
      WHEN p.note IS NOT NULL AND char_length(p.note) > 1000 THEN 'ההוראות ארוכות מדי (עד 1,000 תווים)'
      ELSE 'פרטי התשלום לא תקינים' END
      USING ERRCODE = 'check_violation';
  END;

  PERFORM hospitality._audit(_t, 'payments.instructions_updated', 'פרטי התשלום לאורחים',
                             (SELECT jsonb_object_agg(c, true) FROM unnest(_changed) c));
  RETURN hospitality._payment_settings_json(_t) || jsonb_build_object('editable', true);
END $$;
REVOKE ALL ON FUNCTION hospitality.payment_settings_save(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.payment_settings_save(jsonb, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. לאורח: ההוראות להזמנה שלו (טוקן / אורח מחובר), ולאתר: רק אילו אמצעים קיימים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.guest_payment_info(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  p hospitality.payment_settings;
  _methods text[];
  _due numeric;
  _deposit numeric;
BEGIN
  b := hospitality._guest_booking(_t, _token, _booking_id, false);
  p := hospitality._payment_settings(_t);
  _methods := hospitality._payment_methods(_t);
  IF b.status IN ('declined', 'cancelled', 'expired', 'no_show', 'cancel_requested') THEN
    RETURN jsonb_build_object('available', false, 'reason', 'closed', 'methods', to_jsonb(_methods));
  END IF;
  IF b.status = 'pending_approval' THEN
    RETURN jsonb_build_object('available', false, 'reason', 'not_confirmed', 'methods', to_jsonb(_methods));
  END IF;
  _due := GREATEST(b.total - b.amount_paid, 0);
  IF _due <= 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'paid', 'methods', to_jsonb(_methods));
  END IF;
  -- מקדמה שעוד לא שולמה: מה שנשאר ממנה
  _deposit := CASE WHEN b.deposit_amount > b.amount_paid THEN b.deposit_amount - b.amount_paid ELSE 0 END;
  RETURN jsonb_build_object(
    'available', true,
    'methods', to_jsonb(_methods),
    'currency', b.currency,
    'amount_due', _due,
    'deposit_due', _deposit,
    'reference', '#' || b.number,
    'bank', CASE WHEN p.bank_enabled THEN jsonb_build_object('name', p.bank_name, 'branch', p.bank_branch,
                                                             'account', p.bank_account, 'holder', p.bank_holder) END,
    'bit', CASE WHEN p.bit_enabled THEN jsonb_build_object('phone', p.bit_phone) END,
    'phone', CASE WHEN p.phone_enabled THEN jsonb_build_object('number', hospitality._payment_phone(_t)) END,
    'note', p.note);
END $$;
REVOKE ALL ON FUNCTION hospitality.guest_payment_info(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.guest_payment_info(text, uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.public_payment_methods()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  RETURN jsonb_build_object('methods', to_jsonb(hospitality._payment_methods(_t)));
END $$;
REVOKE ALL ON FUNCTION hospitality.public_payment_methods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.public_payment_methods() TO anon, authenticated, service_role;

-- לשרת בלבד: לנוסח המיילים (אילו אמצעים — בלי פרטים)
CREATE OR REPLACE FUNCTION hospitality.email_payment_methods(_tenant_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT hospitality._payment_methods(_tenant_id);
$$;
REVOKE ALL ON FUNCTION hospitality.email_payment_methods(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.email_payment_methods(uuid) TO service_role;

-- ------------------------------------------------------------
-- 5. מדריך ההקמה: "תשלום ומקדמה" — גם הוראות תשלום שנשמרו משלימות את הצעד
-- ------------------------------------------------------------
-- כמו במיגרציה 35, עם _pay ושני שדות נוספים בצעד (configured, methods).
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
  _pay boolean;
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

  -- מיגרציה 37: הוראות התשלום לאורחים נשמרו (בעלי העסק בחרו איך משלמים להם)
  _pay := EXISTS (SELECT 1 FROM hospitality.payment_settings x WHERE x.tenant_id = _t);
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
                 'done', COALESCE(pol.deposit_kind, 'none') <> 'none' OR 'payments' = ANY (COALESCE(st.confirmed, '{}'))
                         OR _pay,
                 'confirmed', 'payments' = ANY (COALESCE(st.confirmed, '{}')),
                 'configured', _pay,
                 'methods', to_jsonb(hospitality._payment_methods(_t)),
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

COMMIT;

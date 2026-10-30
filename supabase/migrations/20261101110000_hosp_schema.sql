-- ============================================================
-- Hospitality — סכמה, הרשאות וטבלאות הבסיס (Hospitality Stage 1c, מיגרציה 3)
-- ============================================================
-- מה המיגרציה עושה (הכל חדש, בסכמה נפרדת; החנויות לא מושפעות):
--   1. סכמה hospitality + הרשאות USAGE. הטבלאות לא פתוחות ל-anon בכלל;
--      גישה ציבורית (האתר, ההזמנות) תהיה רק דרך פונקציות DEFINER בשלבים הבאים.
--   2. רישום מוצר: התפקידים של Hospitality (admin בלבד — בעלים/מנהל) ב-
--      platform_product_roles. מעכשיו אתר אירוח לא מקבל customer / agent /
--      cashier / warehouse. התפקידים של Ecommerce לא משתנים.
--   3. מפתחות הדגלים של Hospitality (כולם כבויים).
--   4. hospitality.flag() / can() / permissions() / request_tenant().
--   5. טבלאות 1–11: settings, policies, properties, units, unit_members,
--      unit_beds, amenities, unit_amenities, media, rate_rules, promotions.
--      RLS בכל טבלה: RESTRICTIVE tenant_isolation + backend_enabled (דגל),
--      PERMISSIVE לצוות לפי can(). שורה שייכת תמיד לאתר אירוח (טריגר).
--   6. דלי hosp-media (קריאה ציבורית; כתיבה לתיקיית האתר בלבד, לצוות עם
--      הרשאת media ודגל פעיל).
--   7. hospitality.admin_create_site() — מנהל הפלטפורמה פותח אתר אירוח:
--      ה-Tenant, ההגדרות המשותפות, הגדרות האתר ומדיניות ביטול ראשונה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101110000_hosp_schema.down.sql
-- (לא מוחק את הסכמה עצמה — סכמה חשופה שחסרה מפילה את כל ה-API).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הסכמה
-- ------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS hospitality;
COMMENT ON SCHEMA hospitality IS 'Nuriel Hospitality — מנוע אתרי האירוח (נפרד מ-Ecommerce)';
GRANT USAGE ON SCHEMA hospitality TO anon, authenticated, service_role;
-- פונקציות חדשות בסכמה לא נפתחות אוטומטית לכולם (ברירת המחדל של Postgres)
ALTER DEFAULT PRIVILEGES IN SCHEMA hospitality REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. התפקידים של Hospitality
-- ------------------------------------------------------------
-- admin = בעלים (is_protected) או מנהל. אורחים לא חברים ב-user_roles בכלל.
INSERT INTO public.platform_product_roles (product, role) VALUES ('hospitality', 'admin')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 3. מפתחות הדגלים (כבויים; הרצה חוזרת לא מאפסת דגל שהופעל)
-- ------------------------------------------------------------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('hospitality_backend_enabled',    false, 'Hospitality: מסד הנתונים והפונקציות של מנוע האירוח'),
  ('hospitality_frontend_enabled',   false, 'Hospitality: האתר הציבורי ואזור הניהול'),
  ('hospitality_onboarding_enabled', false, 'Hospitality: פתיחת אתר אירוח עצמאית'),
  ('hospitality_themes_enabled',     false, 'Hospitality: ערכות עיצוב ועורך האתר'),
  ('hospitality_booking_enabled',    false, 'Hospitality: קבלת הזמנות מהאתר')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 4. פונקציות הבסיס
-- ------------------------------------------------------------
-- דגל פעיל לאתר של הבקשה: מפתח של Hospitality, האתר הוא אתר אירוח,
-- והדגל פעיל בפלטפורמה וגם לאתר.
CREATE OR REPLACE FUNCTION hospitality.flag(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _key LIKE 'hospitality\_%'
    AND public.current_site_type() = 'hospitality'
    AND public.platform_feature_enabled(_key, public.current_tenant_id()),
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.flag(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.flag(text) TO authenticated, service_role;

-- אותו דבר לאתר מסוים — לשרת ולפונקציות DEFINER (אורחים) בלבד
CREATE OR REPLACE FUNCTION hospitality.flag_for(_key text, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _key LIKE 'hospitality\_%'
    AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.site_type = 'hospitality')
    AND public.platform_feature_enabled(_key, _tenant_id),
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.flag_for(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.flag_for(text, uuid) TO service_role;

-- רשימת ההרשאות של Hospitality (מקור אחד; המסכים ישקפו אותה)
--   settings        — פרטי העסק והגדרות ההזמנה
--   policies        — מדיניות ביטול ומקדמה
--   catalog         — מתחמים, יחידות, מיטות, מתקנים
--   media           — תמונות וסרטונים
--   pricing         — מחירים, עונות, חגים, מבצעים וקופונים
--   bookings        — הזמנות, חסימות ולוח הזמינות (שלב 1d)
--   guests          — כרטיסי אורחים (שלב 1d)
--   reports         — לוח בקרה ודוחות
--   staff.managers  — מינוי / הסרה של מנהלים — הבעלים בלבד
--   billing.manage  — חבילת Hospitality ופרטי החיוב — הבעלים בלבד
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

-- הרשאת צוות באתר האירוח של הבקשה. מבוסס על public.store_staff_role():
--   owner (המנהל המוגן / מנהל-על) → כל ההרשאות של Hospitality
--   manager (admin לא מוגן)      → הכל חוץ מ-staff.managers ו-billing.manage
--   כל השאר (אורח, לקוח, חבר באתר אחר, אתר Ecommerce) → כלום.
-- הרשאה לא מוכרת (גם שמות של Ecommerce כמו pos) → false.
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
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- האתר של הבקשה לפונקציות של אורחים: ה-x-tenant-id של האתר, רק אם הוא אתר
-- אירוח פעיל. לא תלוי בשיוך של המשתמש (current_tenant_id מחזיר NULL למי שחבר
-- באתר אחר — למשל עובד של חנות שמזמין צימר).
CREATE OR REPLACE FUNCTION hospitality.request_tenant()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id
    FROM public.tenants t
   WHERE t.site_type = 'hospitality'
     AND t.status = 'active'
     AND t.id::text = lower(NULLIF(btrim(
           NULLIF(current_setting('request.headers', true), '')::json ->> 'x-tenant-id'), ''));
$$;
REVOKE ALL ON FUNCTION hospitality.request_tenant() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.request_tenant() TO anon, authenticated, service_role;

-- כל שורה בסכמה שייכת לאתר אירוח, והאתר של שורה לא משתנה
CREATE OR REPLACE FUNCTION hospitality.tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _type text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'אי אפשר להעביר נתונים בין אתרים' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT t.site_type INTO _type FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF _type IS DISTINCT FROM 'hospitality' THEN
    RAISE EXCEPTION 'הטבלה % שייכת למנוע האירוח ואינה זמינה לאתר מסוג %', TG_TABLE_NAME, COALESCE(_type, 'לא ידוע')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.tenant_guard() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. הטבלאות
-- ------------------------------------------------------------

-- 1. settings — פרטי העסק והגדרות ההזמנה (שורה אחת לאתר)
CREATE TABLE IF NOT EXISTS hospitality.settings (
  tenant_id               uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_name           text NOT NULL DEFAULT '' CHECK (char_length(business_name) <= 120),
  contact_phone           text CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  contact_email           text CHECK (contact_email IS NULL OR (contact_email = lower(btrim(contact_email))
                                      AND contact_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  whatsapp_phone          text CHECK (whatsapp_phone IS NULL OR whatsapp_phone ~ '^\+?[0-9 ()-]{7,20}$'),
  address                 text CHECK (address IS NULL OR char_length(address) <= 300),
  check_in_time           time NOT NULL DEFAULT '15:00',
  check_out_time          time NOT NULL DEFAULT '11:00',
  booking_mode            text NOT NULL DEFAULT 'request' CHECK (booking_mode IN ('request', 'instant')),
  approval_window_minutes integer NOT NULL DEFAULT 720 CHECK (approval_window_minutes BETWEEN 60 AND 2880),
  approval_reminder_pct   smallint NOT NULL DEFAULT 50 CHECK (approval_reminder_pct BETWEEN 10 AND 90),
  max_open_requests       smallint NOT NULL DEFAULT 2 CHECK (max_open_requests BETWEEN 1 AND 10),
  payment_hold_minutes    integer NOT NULL DEFAULT 30 CHECK (payment_hold_minutes BETWEEN 5 AND 1440),
  -- לילות סוף שבוע: ימים בשבוע (0 = ראשון ... 6 = שבת), ברירת מחדל חמישי + שישי
  weekend_nights          smallint[] NOT NULL DEFAULT '{4,5}'
                          CHECK (weekend_nights <@ '{0,1,2,3,4,5,6}'::smallint[] AND cardinality(weekend_nights) <= 7),
  currency                text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  timezone                text NOT NULL DEFAULT 'Asia/Jerusalem',
  guest_retention_months  smallint NOT NULL DEFAULT 36 CHECK (guest_retention_months BETWEEN 6 AND 120),
  notification_emails     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(notification_emails) <= 5),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.settings IS 'Hospitality: פרטי העסק והגדרות ההזמנה (שורה לאתר)';

CREATE OR REPLACE FUNCTION hospitality.settings_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.timezone) THEN
    RAISE EXCEPTION 'אזור זמן לא מוכר: %', NEW.timezone USING ERRCODE = 'check_violation';
  END IF;
  NEW.notification_emails := ARRAY(
    SELECT DISTINCT lower(btrim(e)) FROM unnest(NEW.notification_emails) e WHERE btrim(e) <> '');
  IF EXISTS (SELECT 1 FROM unnest(NEW.notification_emails) e WHERE e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN
    RAISE EXCEPTION 'כתובת אימייל להתראות לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.settings_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS settings_validate ON hospitality.settings;
CREATE TRIGGER settings_validate BEFORE INSERT OR UPDATE ON hospitality.settings
FOR EACH ROW EXECUTE FUNCTION hospitality.settings_validate();

-- 2. policies — מדיניות ביטול ומקדמה: כמה מדיניות בשם לכל עסק, אחת ברירת מחדל.
--    שינוי בכללים מעלה את version (ההזמנות שומרות עותק — שלב 1d).
CREATE TABLE IF NOT EXISTS hospitality.policies (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_default       boolean NOT NULL DEFAULT false,
  is_archived      boolean NOT NULL DEFAULT false,
  -- מקדמה: none / percent (מהסכום) / fixed
  deposit_kind     text NOT NULL DEFAULT 'none' CHECK (deposit_kind IN ('none', 'percent', 'fixed')),
  deposit_value    numeric(12,2) NOT NULL DEFAULT 0,
  deposit_due      text NOT NULL DEFAULT 'approval' CHECK (deposit_due IN ('booking', 'approval')),
  -- ביטול חינם עד N ימים לפני ההגעה (NULL = אין ביטול חינם), בשעה (NULL = שעת הצ'ק-אין)
  free_cancel_days smallint CHECK (free_cancel_days IS NULL OR free_cancel_days BETWEEN 0 AND 365),
  free_cancel_time time,
  -- מדרגות אחרי המועד: [{"from_days": N, "fee": ..., "value": ...}], ימים בסדר יורד
  fee_tiers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  no_show_fee      text NOT NULL DEFAULT 'full'
                   CHECK (no_show_fee IN ('deposit', 'percent_total', 'fixed', 'full')),
  no_show_value    numeric(12,2) NOT NULL DEFAULT 0,
  auto_cancel      text NOT NULL DEFAULT 'never' CHECK (auto_cancel IN ('never', 'within_free_window', 'always')),
  guest_text       text CHECK (guest_text IS NULL OR char_length(guest_text) <= 2000),
  house_rules      text CHECK (house_rules IS NULL OR char_length(house_rules) <= 4000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (NOT (is_default AND is_archived)),
  CHECK (CASE deposit_kind
           WHEN 'none' THEN deposit_value = 0
           WHEN 'percent' THEN deposit_value > 0 AND deposit_value <= 100
           ELSE deposit_value > 0 END),
  CHECK (CASE no_show_fee
           WHEN 'percent_total' THEN no_show_value BETWEEN 0 AND 100
           WHEN 'fixed' THEN no_show_value >= 0
           ELSE no_show_value = 0 END),
  CHECK (auto_cancel <> 'within_free_window' OR free_cancel_days IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS policies_one_default ON hospitality.policies (tenant_id) WHERE is_default;
COMMENT ON TABLE hospitality.policies IS 'Hospitality: מדיניות ביטול ומקדמה (כמה לכל עסק, אחת ברירת מחדל, עם גרסה)';

CREATE OR REPLACE FUNCTION hospitality.policies_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _tier jsonb;
  _prev integer;
  _days integer;
  _fee text;
  _value numeric;
BEGIN
  IF jsonb_typeof(NEW.fee_tiers) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.fee_tiers) > 10 THEN
    RAISE EXCEPTION 'מדרגות הביטול: רשימה של עד 10 מדרגות' USING ERRCODE = 'check_violation';
  END IF;
  FOR _tier IN SELECT * FROM jsonb_array_elements(NEW.fee_tiers) LOOP
    IF jsonb_typeof(_tier) <> 'object' OR jsonb_typeof(_tier -> 'from_days') <> 'number'
       OR jsonb_typeof(_tier -> 'fee') <> 'string' THEN
      RAISE EXCEPTION 'מדרגת ביטול לא תקינה: %', _tier USING ERRCODE = 'check_violation';
    END IF;
    _days := (_tier ->> 'from_days')::numeric;
    _fee := _tier ->> 'fee';
    _value := COALESCE((_tier ->> 'value')::numeric, 0);
    IF _days <> (_tier ->> 'from_days')::numeric OR _days < 0 OR _days > 365 THEN
      RAISE EXCEPTION 'מדרגת ביטול: מספר ימים שלם בין 0 ל-365' USING ERRCODE = 'check_violation';
    END IF;
    IF _prev IS NOT NULL AND _days >= _prev THEN
      RAISE EXCEPTION 'מדרגות הביטול חייבות להיות מסודרות מהרחוקה לקרובה' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.free_cancel_days IS NOT NULL AND _days > NEW.free_cancel_days THEN
      RAISE EXCEPTION 'מדרגת ביטול לא יכולה להתחיל לפני סוף הביטול החינם' USING ERRCODE = 'check_violation';
    END IF;
    IF _fee NOT IN ('none', 'percent_total', 'percent_deposit', 'fixed', 'deposit', 'full') THEN
      RAISE EXCEPTION 'סוג דמי ביטול לא מוכר: %', _fee USING ERRCODE = 'check_violation';
    END IF;
    IF (_fee IN ('percent_total', 'percent_deposit') AND (_value < 0 OR _value > 100))
       OR (_fee = 'fixed' AND _value < 0)
       OR (_fee IN ('none', 'deposit', 'full') AND _value <> 0) THEN
      RAISE EXCEPTION 'ערך לא תקין בדמי הביטול (אחוז 0–100, סכום קבוע 0 ומעלה)' USING ERRCODE = 'check_violation';
    END IF;
    IF _fee IN ('percent_deposit', 'deposit') AND NEW.deposit_kind = 'none' THEN
      RAISE EXCEPTION 'דמי ביטול לפי המקדמה דורשים מקדמה במדיניות' USING ERRCODE = 'check_violation';
    END IF;
    _prev := _days;
  END LOOP;
  IF NEW.no_show_fee = 'deposit' AND NEW.deposit_kind = 'none' THEN
    RAISE EXCEPTION 'דמי אי-הגעה לפי המקדמה דורשים מקדמה במדיניות' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' AND (
       NEW.deposit_kind, NEW.deposit_value, NEW.deposit_due, NEW.free_cancel_days, NEW.free_cancel_time,
       NEW.fee_tiers, NEW.no_show_fee, NEW.no_show_value, NEW.auto_cancel, NEW.guest_text, NEW.house_rules)
     IS DISTINCT FROM (
       OLD.deposit_kind, OLD.deposit_value, OLD.deposit_due, OLD.free_cancel_days, OLD.free_cancel_time,
       OLD.fee_tiers, OLD.no_show_fee, OLD.no_show_value, OLD.auto_cancel, OLD.guest_text, OLD.house_rules) THEN
    NEW.version := OLD.version + 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version;
  ELSE
    NEW.version := 1;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.policies_validate() FROM PUBLIC, anon, authenticated;

-- בדיוק ברירת מחדל אחת לכל עסק שיש לו מדיניות:
--   • המדיניות הראשונה היא ברירת המחדל;
--   • סימון אחרת כברירת מחדל מוריד את הסימון מהקודמת;
--   • אי אפשר להוריד סימון / למחוק את ברירת המחדל ישירות (רק בהחלפה, או
--     במחיקת האתר כולו).
CREATE OR REPLACE FUNCTION hospitality.policies_default_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default AND pg_catalog.pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'אי אפשר למחוק את מדיניות ברירת המחדל — קודם בחרו ברירת מחדל אחרת'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND NOT NEW.is_default AND NOT NEW.is_archived
     AND NOT EXISTS (SELECT 1 FROM hospitality.policies p WHERE p.tenant_id = NEW.tenant_id AND p.is_default) THEN
    NEW.is_default := true;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default AND NOT NEW.is_default AND pg_catalog.pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'חייבת להיות מדיניות ברירת מחדל — בחרו מדיניות אחרת כברירת מחדל'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_default AND (TG_OP = 'INSERT' OR NOT OLD.is_default) THEN
    UPDATE hospitality.policies p SET is_default = false
     WHERE p.tenant_id = NEW.tenant_id AND p.is_default AND p.id <> NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.policies_default_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS policies_validate ON hospitality.policies;
CREATE TRIGGER policies_validate BEFORE INSERT OR UPDATE ON hospitality.policies
FOR EACH ROW EXECUTE FUNCTION hospitality.policies_validate();
DROP TRIGGER IF EXISTS policies_default_guard ON hospitality.policies;
CREATE TRIGGER policies_default_guard BEFORE INSERT OR UPDATE OF is_default OR DELETE ON hospitality.policies
FOR EACH ROW EXECUTE FUNCTION hospitality.policies_default_guard();

-- 3. properties — מתחם / אתר אירוח פיזי
CREATE TABLE IF NOT EXISTS hospitality.properties (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  slug        text NOT NULL CHECK (char_length(slug) <= 80
                AND slug ~ '^[a-z0-9א-ת]+(-[a-z0-9א-ת]+)*$'),
  description text CHECK (description IS NULL OR char_length(description) <= 10000),
  address     text CHECK (address IS NULL OR char_length(address) <= 300),
  latitude    numeric(9,6) CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude   numeric(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
COMMENT ON TABLE hospitality.properties IS 'Hospitality: מתחם (שם, כתובת, מיקום, סטטוס)';

-- 4. units — חדר / צימר / יחידה, או "כל המתחם" (whole_property) שמאגד יחידות
CREATE TABLE IF NOT EXISTS hospitality.units (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL,
  kind              text NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit', 'room', 'whole_property')),
  name              text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  slug              text NOT NULL CHECK (char_length(slug) <= 80
                      AND slug ~ '^[a-z0-9א-ת]+(-[a-z0-9א-ת]+)*$'),
  description       text CHECK (description IS NULL OR char_length(description) <= 10000),
  capacity          smallint NOT NULL DEFAULT 2 CHECK (capacity BETWEEN 1 AND 100),
  base_occupancy    smallint NOT NULL DEFAULT 2 CHECK (base_occupancy >= 1),
  child_age_limit   smallint NOT NULL DEFAULT 12 CHECK (child_age_limit BETWEEN 0 AND 17),
  bedrooms          smallint NOT NULL DEFAULT 1 CHECK (bedrooms BETWEEN 0 AND 50),
  bathrooms         smallint NOT NULL DEFAULT 1 CHECK (bathrooms BETWEEN 0 AND 50),
  base_price        numeric(10,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  extra_adult_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (extra_adult_price >= 0),
  extra_child_price numeric(10,2) NOT NULL DEFAULT 0 CHECK (extra_child_price >= 0),
  min_nights        smallint NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60),
  price_floor       numeric(10,2) CHECK (price_floor IS NULL OR price_floor >= 0),
  price_ceiling     numeric(10,2) CHECK (price_ceiling IS NULL OR price_ceiling >= 0),
  policy_id         uuid,
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  seo_title         text CHECK (seo_title IS NULL OR char_length(seo_title) <= 120),
  seo_description   text CHECK (seo_description IS NULL OR char_length(seo_description) <= 320),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, slug),
  CHECK (base_occupancy <= capacity),
  CHECK (price_floor IS NULL OR price_ceiling IS NULL OR price_floor <= price_ceiling),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_id) REFERENCES hospitality.policies (tenant_id, id) ON DELETE SET NULL (policy_id)
);
CREATE INDEX IF NOT EXISTS units_property_idx ON hospitality.units (tenant_id, property_id);
CREATE INDEX IF NOT EXISTS units_policy_idx ON hospitality.units (tenant_id, policy_id) WHERE policy_id IS NOT NULL;
COMMENT ON TABLE hospitality.units IS 'Hospitality: יחידות אירוח (חדר / צימר / כל המתחם)';

-- 5. unit_members — "כל המתחם" ↔ היחידות שהוא כולל
CREATE TABLE IF NOT EXISTS hospitality.unit_members (
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  parent_unit_id uuid NOT NULL,
  member_unit_id uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, parent_unit_id, member_unit_id),
  CHECK (parent_unit_id <> member_unit_id),
  FOREIGN KEY (tenant_id, parent_unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, member_unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS unit_members_member_idx ON hospitality.unit_members (tenant_id, member_unit_id);
COMMENT ON TABLE hospitality.unit_members IS 'Hospitality: היחידות שכלולות בהזמנת "כל המתחם"';

CREATE OR REPLACE FUNCTION hospitality.unit_members_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _parent hospitality.units;
  _member hospitality.units;
BEGIN
  SELECT * INTO _parent FROM hospitality.units u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.parent_unit_id;
  SELECT * INTO _member FROM hospitality.units u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.member_unit_id;
  IF _parent.id IS NULL OR _member.id IS NULL THEN
    RETURN NEW;  -- המפתח הזר ידחה
  END IF;
  IF _parent.kind <> 'whole_property' THEN
    RAISE EXCEPTION 'רק יחידה מסוג "כל המתחם" יכולה לכלול יחידות' USING ERRCODE = 'check_violation';
  END IF;
  IF _member.kind = 'whole_property' THEN
    RAISE EXCEPTION '"כל המתחם" לא יכול להיות חלק מ"כל המתחם" אחר' USING ERRCODE = 'check_violation';
  END IF;
  IF _parent.property_id <> _member.property_id THEN
    RAISE EXCEPTION 'היחידה שייכת למתחם אחר' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.unit_members_validate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS unit_members_validate ON hospitality.unit_members;
CREATE TRIGGER unit_members_validate BEFORE INSERT OR UPDATE ON hospitality.unit_members
FOR EACH ROW EXECUTE FUNCTION hospitality.unit_members_validate();

-- יחידה שמשויכת ל"כל המתחם" לא משנה סוג / מתחם בלי להסיר קודם את השיוך
CREATE OR REPLACE FUNCTION hospitality.units_membership_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.unit_members m
              WHERE m.tenant_id = NEW.tenant_id
                AND (m.parent_unit_id = NEW.id OR m.member_unit_id = NEW.id)) THEN
    RAISE EXCEPTION 'היחידה משויכת ל"כל המתחם" — הסירו את השיוך לפני שינוי הסוג או המתחם'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.units_membership_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS units_membership_guard ON hospitality.units;
CREATE TRIGGER units_membership_guard BEFORE UPDATE OF kind, property_id ON hospitality.units
FOR EACH ROW
WHEN (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.property_id IS DISTINCT FROM OLD.property_id)
EXECUTE FUNCTION hospitality.units_membership_guard();

-- 6. unit_beds — מיטות וסידורי שינה
CREATE TABLE IF NOT EXISTS hospitality.unit_beds (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL,
  bed_type   text NOT NULL CHECK (bed_type IN ('double', 'queen', 'king', 'single', 'sofa_bed', 'bunk', 'crib', 'mattress')),
  quantity   smallint NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  room_label text CHECK (room_label IS NULL OR char_length(room_label) <= 60),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS unit_beds_unit_idx ON hospitality.unit_beds (tenant_id, unit_id);
COMMENT ON TABLE hospitality.unit_beds IS 'Hospitality: מיטות וסידורי שינה ביחידה';

-- 7. amenities — קטלוג המתקנים של העסק
CREATE TABLE IF NOT EXISTS hospitality.amenities (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  icon       text CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,40}$'),
  category   text CHECK (category IS NULL OR char_length(category) <= 40),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);
COMMENT ON TABLE hospitality.amenities IS 'Hospitality: קטלוג המתקנים (ג׳קוזי, בריכה, מטבח...)';

-- 8. unit_amenities — מתקן במתחם או ביחידה
CREATE TABLE IF NOT EXISTS hospitality.unit_amenities (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amenity_id  uuid NOT NULL,
  property_id uuid,
  unit_id     uuid,
  note        text CHECK (note IS NULL OR char_length(note) <= 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, amenity_id, property_id),
  UNIQUE (tenant_id, amenity_id, unit_id),
  CHECK (num_nonnulls(property_id, unit_id) = 1),
  FOREIGN KEY (tenant_id, amenity_id) REFERENCES hospitality.amenities (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS unit_amenities_property_idx ON hospitality.unit_amenities (tenant_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unit_amenities_unit_idx ON hospitality.unit_amenities (tenant_id, unit_id) WHERE unit_id IS NOT NULL;
COMMENT ON TABLE hospitality.unit_amenities IS 'Hospitality: מתקן במתחם או ביחידה';

-- 9. media — תמונות וסרטונים (קובץ בדלי hosp-media או הטמעה מ-YouTube / Vimeo)
CREATE TABLE IF NOT EXISTS hospitality.media (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_kind       text NOT NULL DEFAULT 'site' CHECK (owner_kind IN ('site', 'property', 'unit')),
  property_id      uuid,
  unit_id          uuid,
  kind             text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video', 'embed')),
  storage_path     text CHECK (storage_path IS NULL OR (char_length(storage_path) <= 400
                     AND storage_path !~ '(^|/)\.\.(/|$)')),
  embed_provider   text CHECK (embed_provider IS NULL OR embed_provider IN ('youtube', 'vimeo')),
  embed_id         text CHECK (embed_id IS NULL OR embed_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  alt              text CHECK (alt IS NULL OR char_length(alt) <= 250),
  width            integer CHECK (width IS NULL OR width > 0),
  height           integer CHECK (height IS NULL OR height > 0),
  size_bytes       bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  duration_seconds numeric(8,2) CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  is_cover         boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  is_demo          boolean NOT NULL DEFAULT false,
  licence_ref      text CHECK (licence_ref IS NULL OR char_length(licence_ref) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (CASE owner_kind
           WHEN 'site' THEN property_id IS NULL AND unit_id IS NULL
           WHEN 'property' THEN property_id IS NOT NULL AND unit_id IS NULL
           ELSE unit_id IS NOT NULL AND property_id IS NULL END),
  -- קובץ: בתיקייה של האתר בדלי; הטמעה: ספק + מזהה, בלי קובץ
  CHECK (CASE kind
           WHEN 'embed' THEN storage_path IS NULL AND embed_provider IS NOT NULL AND embed_id IS NOT NULL
           ELSE storage_path IS NOT NULL AND split_part(storage_path, '/', 1) = tenant_id::text
                AND embed_provider IS NULL AND embed_id IS NULL END),
  -- תמונות דמו מגיעות עם מקור / רישיון
  CHECK (NOT is_demo OR licence_ref IS NOT NULL),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS media_one_cover ON hospitality.media
  (tenant_id, owner_kind, COALESCE(property_id, unit_id)) NULLS NOT DISTINCT WHERE is_cover;
CREATE INDEX IF NOT EXISTS media_property_idx ON hospitality.media (tenant_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_unit_idx ON hospitality.media (tenant_id, unit_id) WHERE unit_id IS NOT NULL;
COMMENT ON TABLE hospitality.media IS 'Hospitality: תמונות וסרטונים של האתר / מתחם / יחידה';

-- 10. rate_rules — מחירים: ימי חול / סוף שבוע / עונה / חג
CREATE TABLE IF NOT EXISTS hospitality.rate_rules (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  kind        text NOT NULL CHECK (kind IN ('weekday', 'weekend', 'season', 'holiday')),
  -- היקף: יחידה, מתחם, או כל היחידות (שניהם NULL)
  property_id uuid,
  unit_id     uuid,
  -- טווח לילות [date_from, date_to) — חובה בעונה / חג
  date_from   date,
  date_to     date,
  -- ימים בשבוע (ביט 0 = ראשון ... ביט 6 = שבת)
  days_mask   smallint NOT NULL DEFAULT 127 CHECK (days_mask BETWEEN 1 AND 127),
  -- fixed: מחיר ללילה | percent: שינוי באחוזים | amount: שינוי בסכום
  price_mode  text NOT NULL DEFAULT 'fixed' CHECK (price_mode IN ('fixed', 'percent', 'amount')),
  value       numeric(10,2) NOT NULL,
  min_nights  smallint CHECK (min_nights IS NULL OR min_nights BETWEEN 1 AND 60),
  priority    integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
  policy_id   uuid,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (num_nonnulls(property_id, unit_id) <= 1),
  CHECK ((date_from IS NULL) = (date_to IS NULL)),
  CHECK (date_to IS NULL OR date_to > date_from),
  CHECK (kind NOT IN ('season', 'holiday') OR date_from IS NOT NULL),
  CHECK (CASE price_mode
           WHEN 'fixed' THEN value >= 0
           WHEN 'percent' THEN value BETWEEN -90 AND 500
           ELSE true END),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, policy_id) REFERENCES hospitality.policies (tenant_id, id) ON DELETE SET NULL (policy_id)
);
CREATE INDEX IF NOT EXISTS rate_rules_scope_idx ON hospitality.rate_rules (tenant_id, unit_id, property_id);
CREATE INDEX IF NOT EXISTS rate_rules_property_idx ON hospitality.rate_rules (tenant_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rate_rules_policy_idx ON hospitality.rate_rules (tenant_id, policy_id) WHERE policy_id IS NOT NULL;
COMMENT ON TABLE hospitality.rate_rules IS 'Hospitality: כללי מחיר (חול, סוף שבוע, עונה, חג) כולל מדיניות לחגים';

-- 11. promotions — הנחות אוטומטיות וקופונים (code)
CREATE TABLE IF NOT EXISTS hospitality.promotions (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  code          text CHECK (code IS NULL OR code ~ '^[A-Z0-9_-]{3,32}$'),
  discount_kind text NOT NULL CHECK (discount_kind IN ('percent', 'fixed')),
  value         numeric(10,2) NOT NULL,
  property_id   uuid,
  unit_id       uuid,
  stay_from     date,
  stay_to       date,
  book_from     timestamptz,
  book_to       timestamptz,
  min_nights    smallint CHECK (min_nights IS NULL OR min_nights BETWEEN 1 AND 60),
  usage_limit   integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count    integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (num_nonnulls(property_id, unit_id) <= 1),
  CHECK (CASE discount_kind WHEN 'percent' THEN value > 0 AND value <= 100 ELSE value > 0 END),
  CHECK (stay_to IS NULL OR stay_from IS NULL OR stay_to > stay_from),
  CHECK (book_to IS NULL OR book_from IS NULL OR book_to > book_from),
  CHECK (usage_limit IS NULL OR used_count <= usage_limit),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS promotions_code_key ON hospitality.promotions (tenant_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotions_property_idx ON hospitality.promotions (tenant_id, property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS promotions_unit_idx ON hospitality.promotions (tenant_id, unit_id) WHERE unit_id IS NOT NULL;
COMMENT ON TABLE hospitality.promotions IS 'Hospitality: מבצעים אוטומטיים וקופונים';

-- ------------------------------------------------------------
-- 6. הרשאות, RLS וטריגרים משותפים לכל הטבלאות
-- ------------------------------------------------------------
--   • anon: אין הרשאה לטבלאות (גישה ציבורית רק דרך פונקציות DEFINER).
--   • RESTRICTIVE tenant_isolation: רק שורות של האתר של הבקשה.
--   • RESTRICTIVE backend_enabled: רק כשהדגל hospitality_backend_enabled פעיל לאתר.
--   • PERMISSIVE staff: בעלים / מנהל עם ההרשאה המתאימה (can()).
DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('settings', 'settings', true),
      ('policies', 'policies', true),
      ('properties', 'catalog', true),
      ('units', 'catalog', true),
      ('unit_members', 'catalog', false),
      ('unit_beds', 'catalog', false),
      ('amenities', 'catalog', false),
      ('unit_amenities', 'catalog', false),
      ('media', 'media', true),
      ('rate_rules', 'pricing', true),
      ('promotions', 'pricing', true)
    ) AS v(tbl, perm, has_updated_at)
  LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _t.tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated', _t.tbl);
    -- settings: שורה אחת שנוצרת בפתיחת האתר ונמחקת רק איתו — הצוות רק קורא ומעדכן
    IF _t.tbl = 'settings' THEN
      EXECUTE format('GRANT SELECT, UPDATE ON hospitality.%I TO authenticated', _t.tbl);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON hospitality.%I TO authenticated', _t.tbl);
    END IF;
    EXECUTE format('GRANT ALL ON hospitality.%I TO service_role', _t.tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))$p$, _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
                      WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')))$p$, _t.tbl);
    EXECUTE format('DROP POLICY IF EXISTS staff ON hospitality.%I', _t.tbl);
    EXECUTE format($p$CREATE POLICY staff ON hospitality.%I FOR ALL TO authenticated
                      USING ((SELECT hospitality.can(%L)))
                      WITH CHECK ((SELECT hospitality.can(%L)))$p$, _t.tbl, _t.perm, _t.perm);

    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _t.tbl);
    EXECUTE format($g$CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()$g$, _t.tbl);
    IF _t.has_updated_at THEN
      EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON hospitality.%I', _t.tbl);
      EXECUTE format($g$CREATE TRIGGER touch_updated_at BEFORE UPDATE ON hospitality.%I
                        FOR EACH ROW EXECUTE FUNCTION hospitality.touch_updated_at()$g$, _t.tbl);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 7. דלי המדיה
-- ------------------------------------------------------------
-- קריאה ציבורית (הדלי public — קישורי התמונות של האתר). כתיבה: נתיב
-- "<tenant_id>/..." של האתר של הבקשה, צוות עם הרשאת media, והדגל פעיל.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('hosp-media', 'hosp-media', true, 52428800,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime'])
    ON CONFLICT (id) DO UPDATE
      SET public = true, file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

DROP POLICY IF EXISTS "hosp media staff read" ON storage.objects;
CREATE POLICY "hosp media staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hosp-media'
         AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
         AND (SELECT hospitality.can('media')));
DROP POLICY IF EXISTS "hosp media staff insert" ON storage.objects;
CREATE POLICY "hosp media staff insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hosp-media'
              AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
              AND (SELECT hospitality.can('media'))
              AND (SELECT hospitality.flag('hospitality_backend_enabled')));
DROP POLICY IF EXISTS "hosp media staff update" ON storage.objects;
CREATE POLICY "hosp media staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hosp-media'
         AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
         AND (SELECT hospitality.can('media'))
         AND (SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK (bucket_id = 'hosp-media'
              AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
              AND (SELECT hospitality.can('media'))
              AND (SELECT hospitality.flag('hospitality_backend_enabled')));
DROP POLICY IF EXISTS "hosp media staff delete" ON storage.objects;
CREATE POLICY "hosp media staff delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hosp-media'
         AND split_part(name, '/', 1) = (SELECT public.current_tenant_id())::text
         AND (SELECT hospitality.can('media'))
         AND (SELECT hospitality.flag('hospitality_backend_enabled')));

-- ------------------------------------------------------------
-- 8. פתיחת אתר אירוח (מנהל הפלטפורמה)
-- ------------------------------------------------------------
-- יוצר את ה-Tenant (site_type = hospitality — ה-seed של Ecommerce לא רץ),
-- ההגדרות המשותפות (site_settings, email_settings), הגדרות האתר ומדיניות
-- ביטול ראשונה שהבעלים יערוך. הדגלים נשארים כבויים. הבעלים מצורף בנפרד
-- (כמו בחנויות), כ-admin בלבד.
CREATE OR REPLACE FUNCTION hospitality.admin_create_site(
  _slug text,
  _name text,
  _owner_email text DEFAULT NULL,
  _domain text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _s text := lower(btrim(COALESCE(_slug, '')));
  _n text := btrim(COALESCE(_name, ''));
  _e text := NULLIF(lower(btrim(COALESCE(_owner_email, ''))), '');
  _d text := NULLIF(lower(btrim(COALESCE(_domain, ''))), '');
  _problem text;
  t public.tenants;
BEGIN
  -- כולל בדיקת הרשאה (מנהל הפלטפורמה), פורמט, כתובות שמורות וכתובת תפוסה
  _problem := public.platform_slug_problem(_s);
  IF _problem IS NOT NULL THEN
    RAISE EXCEPTION '%', _problem USING ERRCODE = 'check_violation';
  END IF;
  IF length(_n) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'שם האתר חייב להכיל 1 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NOT NULL AND _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'אימייל בעל האתר לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND _d !~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' THEN
    RAISE EXCEPTION 'הדומיין "%" לא תקין (למשל stay.example.com, בלי https://)', _d USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenants x WHERE x.domain = _d) THEN
    RAISE EXCEPTION 'הדומיין "%" כבר משויך לאתר אחר', _d USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.tenants (slug, name, domain, owner_email, site_type)
    VALUES (_s, _n, _d, _e, 'hospitality')
    RETURNING * INTO t;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'הכתובת "%" נתפסה הרגע ע"י אתר אחר — בחרו כתובת אחרת', _s
      USING ERRCODE = 'check_violation';
  END;

  PERFORM public.platform_seed_tenant_shared(t.id);
  INSERT INTO hospitality.settings (tenant_id, business_name, contact_email)
  VALUES (t.id, _n, _e);
  -- נקודת התחלה בלבד (תבנית "גמישה"); הבעלים קובע את המדיניות שלו
  INSERT INTO hospitality.policies (tenant_id, name, is_default, free_cancel_days, fee_tiers, no_show_fee)
  VALUES (t.id, 'גמישה', true, 7, '[{"from_days": 7, "fee": "percent_total", "value": 50}]'::jsonb, 'full');

  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (t.id, auth.uid(), 'site_created', jsonb_build_object('site_type', 'hospitality', 'slug', _s));
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_create_site(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_create_site(text, text, text, text) TO authenticated, service_role;

COMMIT;

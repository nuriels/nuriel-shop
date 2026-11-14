-- ============================================================
-- מיגרציה 189: שכבת החיוב המשותפת (Billing & Agreements) — חנויות (Ecommerce) וצימרים (Hospitality)
--
-- מה Nuriel גובה מכל עסק הוא נתון של הפלטפורמה, לא של המנוע. לכן סכמה נפרדת, billing, ברמת הפלטפורמה:
--   • billing.settings        — שיעור המע"מ ברירת המחדל להסכמים חדשים (18%)
--   • billing.agreements      — ההסכם עם כל לקוח, בגרסאות: חבילה, מחיר מוסכם (חודשי / שנתי), מחזור,
--                               דמי הקמה, התחייבות, תאריך תחילה, מע"מ (כולל / לא כולל + השיעור), תנאים
--                               (גלויים לבעל העסק) והערה פנימית (Nuriel בלבד). כל שינוי = גרסה חדשה;
--                               הקודמת נשמרת ונסגרת (superseded_at). אין עריכה ואין מחיקה.
--   • billing.ledger          — היומן הכספי, רק הוספה: חיוב (נדרש לתשלום), תשלום (התקבל), זיכוי וביטול.
--                               טעות מתוקנת בשורת ביטול שמצביעה על השורה המקורית; המקור נשאר.
--                               כל שורה שומרת את שיעור המע"מ שלה ואת הפירוק (לפני מע"מ / מע"מ / סה"כ).
--                               "provider" (אישור מספק תשלומים) לא ניתן לרישום ידני — רק "manual".
--   • billing.upgrade_requests — בקשת שינוי חבילה של בעל העסק. אין חיוב אוטומטי והחבילה הפעילה לא
--                               משתנה עד שמנהל הפלטפורמה מאשר.
--
-- לא משתנה: המחירונים (platform_plans / hospitality.plans), המנויים, המגבלות והנעילה של כל מנוע. תאריך
-- החידוש — מקור אחד בלבד: סוף התקופה במנוי של המנוע (current_period_end / trial_ends_at). השכבה החדשה
-- נוגעת במנוי רק בשתי פעולות מפורשות של מנהל הפלטפורמה: החלפת חבילה (התאריך נשמר) וחידוש לתקופה הבאה
-- (מסוף התקופה הנוכחית — הזמן ששולם לא אובד). אין כאן שום נגיעה בשורות קיימות ובהיסטוריה הישנה
-- (billing_history נשאר כמו שהוא), ואין מילוי אוטומטי של הסכמים לעסקים קיימים.
--
-- גישה: אין שום הרשאה ישירה לטבלאות (לא anon, לא authenticated; service_role — קריאה בלבד). הכול דרך
-- הפונקציות שבסוף הקובץ:
--   • בעל העסק בלבד (חנות: staff_can('billing.manage'); צימר: hospitality.can('billing.manage')) — העסק
--     של הבקשה בלבד, בלי הערות פנימיות, אסמכתאות ומי רשם. מנהלים, מנהל/ת עסק ועובדים — לא.
--   • מנהל הפלטפורמה (is_platform_admin) — כל העסקים, וכל פעולה נרשמת ב-platform_audit_log.
-- השורות לא נמחקות עם העסק (בלי FK — כמו billing_history מ-SEC-M5): רשומות כספיות נשמרות.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS billing;
COMMENT ON SCHEMA billing IS 'מיגרציה 189: הסכמים, יומן כספי ובקשות שדרוג — ברמת הפלטפורמה, לשני המנועים';
REVOKE ALL ON SCHEMA billing FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA billing TO service_role;

-- ------------------------------------------------------------
-- 1. הגדרות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.settings (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- שיעור המע"מ שמוצע בהסכם חדש; כל הסכם וכל שורה ביומן שומרים את השיעור שלהם
  default_vat_rate numeric(5,2) NOT NULL DEFAULT 18.00 CHECK (default_vat_rate BETWEEN 0 AND 100),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);
INSERT INTO billing.settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. הסכמים (גרסאות)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.agreements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- בלי FK: ההסכם נשמר גם אחרי מחיקת העסק (tenant_label — שם וכתובת ברגע הרישום)
  tenant_id          uuid NOT NULL,
  tenant_label       text NOT NULL CHECK (char_length(tenant_label) BETWEEN 1 AND 200),
  engine             text NOT NULL CHECK (engine IN ('ecommerce', 'hospitality')),
  version            integer NOT NULL CHECK (version >= 1),
  -- החבילה נבדקת מול המחירון של המנוע בכל רישום (חבילה עתידית — בלי שינוי כאן)
  plan_code          text NOT NULL CHECK (plan_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  billing_cycle      text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  -- מחיר המחירון החודשי ברגע ההסכם (לתצוגה ולהשוואה בלבד)
  list_price_monthly numeric(12,2) CHECK (list_price_monthly IS NULL OR list_price_monthly >= 0),
  -- המחיר המוסכם; NULL = לפי המחירון. שנתי בלי מחיר שנתי = 12 × החודשי
  agreed_monthly     numeric(12,2) CHECK (agreed_monthly IS NULL OR agreed_monthly BETWEEN 0 AND 1000000),
  agreed_yearly      numeric(12,2) CHECK (agreed_yearly IS NULL OR agreed_yearly BETWEEN 0 AND 1000000),
  setup_fee          numeric(12,2) NOT NULL DEFAULT 0 CHECK (setup_fee BETWEEN 0 AND 1000000),
  commitment_months  integer CHECK (commitment_months IS NULL OR commitment_months BETWEEN 1 AND 120),
  start_date         date,
  -- included: המחירים כוללים מע"מ | excluded: המחירים לפני מע"מ, והמע"מ מתווסף ומוצג בנפרד
  vat_mode           text NOT NULL CHECK (vat_mode IN ('included', 'excluded')),
  vat_rate           numeric(5,2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  -- תנאי ההסכם — גלויים לבעל העסק
  terms              text CHECK (terms IS NULL OR char_length(terms) <= 2000),
  -- הערה פנימית — מנהל הפלטפורמה בלבד, לעולם לא חוזרת לבעל העסק
  internal_note      text CHECK (internal_note IS NULL OR char_length(internal_note) <= 2000),
  -- initial: הסכם ראשון | change: שינוי של מנהל הפלטפורמה | upgrade: אישור בקשת שדרוג
  reason             text NOT NULL DEFAULT 'change' CHECK (reason IN ('initial', 'change', 'upgrade')),
  effective_on       date NOT NULL,
  upgrade_request_id uuid,
  created_by         uuid,
  created_by_email   text,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- נסגרת כשנוצרת גרסה חדשה (העדכון היחיד שמותר על שורה קיימת)
  superseded_at      timestamptz,
  superseded_by      uuid,
  UNIQUE (tenant_id, version),
  CHECK ((superseded_at IS NULL) = (superseded_by IS NULL))
);
-- הסכם נוכחי אחד לכל עסק
CREATE UNIQUE INDEX IF NOT EXISTS agreements_current_idx ON billing.agreements (tenant_id) WHERE superseded_at IS NULL;
COMMENT ON TABLE billing.agreements IS 'מיגרציה 189: ההסכם עם כל עסק, בגרסאות (רק הוספה; סגירת גרסה קודמת היא העדכון היחיד)';

-- ------------------------------------------------------------
-- 3. בקשות שינוי חבילה
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.upgrade_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  tenant_label        text NOT NULL CHECK (char_length(tenant_label) BETWEEN 1 AND 200),
  engine              text NOT NULL CHECK (engine IN ('ecommerce', 'hospitality')),
  current_plan        text NOT NULL,
  requested_plan      text NOT NULL CHECK (requested_plan ~ '^[a-z][a-z0-9_]{1,30}$'),
  requested_cycle     text NOT NULL CHECK (requested_cycle IN ('monthly', 'yearly')),
  -- מחיר המחירון של החבילה המבוקשת ברגע הבקשה (תצוגה בלבד — לא מחייב)
  list_price_monthly  numeric(12,2),
  customer_note       text CHECK (customer_note IS NULL OR char_length(customer_note) <= 500),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  requested_by        uuid,
  requested_by_email  text,
  created_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at          timestamptz,
  decided_by          uuid,
  decided_by_email    text,
  -- התשובה לבעל העסק (גלויה לו)
  decision_message    text CHECK (decision_message IS NULL OR char_length(decision_message) <= 500),
  agreement_id        uuid,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- בקשה פתוחה אחת לכל עסק
CREATE UNIQUE INDEX IF NOT EXISTS upgrade_requests_pending_idx ON billing.upgrade_requests (tenant_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS upgrade_requests_status_idx ON billing.upgrade_requests (status, created_at DESC);
COMMENT ON TABLE billing.upgrade_requests IS 'מיגרציה 189: בקשת שינוי חבילה של בעל העסק — רק הסטטוס משתנה, פעם אחת';

-- ------------------------------------------------------------
-- 4. היומן הכספי (רק הוספה)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing.ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  tenant_id          uuid NOT NULL,
  tenant_label       text NOT NULL CHECK (char_length(tenant_label) BETWEEN 1 AND 200),
  engine             text NOT NULL CHECK (engine IN ('ecommerce', 'hospitality')),
  -- charge: נדרש לתשלום | payment: התקבל | credit: זיכוי (מקטין את הנדרש) | reversal: ביטול רישום
  kind               text NOT NULL CHECK (kind IN ('charge', 'payment', 'credit', 'reversal')),
  -- subscription: מנוי | setup: דמי הקמה | other: אחר
  category           text NOT NULL CHECK (category IN ('subscription', 'setup', 'other')),
  -- הסכום הכולל (כולל מע"מ, אם יש), והפירוק שלו — מחושב במסד בלבד
  amount             numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  vat_rate           numeric(5,2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
  vat_amount         numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
  net_amount         numeric(12,2) NOT NULL CHECK (net_amount >= 0),
  currency           text NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  occurred_on        date NOT NULL,
  period_start       date,
  period_end         date,
  method             text CHECK (method IS NULL OR method IN ('bank_transfer', 'bit', 'credit_card', 'cash', 'check', 'other')),
  -- גלוי לבעל העסק
  description        text CHECK (description IS NULL OR char_length(description) <= 200),
  -- מנהל הפלטפורמה בלבד
  reference          text CHECK (reference IS NULL OR char_length(reference) <= 120),
  internal_note      text CHECK (internal_note IS NULL OR char_length(internal_note) <= 500),
  -- manual: נרשם בידי מנהל הפלטפורמה | provider: אישור מספק תשלומים (לעתיד; לא ניתן לרישום ידני)
  confirmation       text NOT NULL DEFAULT 'manual' CHECK (confirmation IN ('manual', 'provider')),
  provider_ref       text CHECK (provider_ref IS NULL OR char_length(provider_ref) <= 200),
  -- platform_admin: רישום ידני | renewal: חידוש תקופה | plan_change: הפרש יחסי בשינוי חבילה |
  -- legacy_import: העתקה מ-billing_history (רק בשלב נפרד, באישור) | provider: ספק תשלומים (לעתיד)
  source             text NOT NULL DEFAULT 'platform_admin'
                     CHECK (source IN ('platform_admin', 'renewal', 'plan_change', 'legacy_import', 'provider')),
  legacy_ref         uuid UNIQUE,
  agreement_id       uuid REFERENCES billing.agreements(id),
  upgrade_request_id uuid REFERENCES billing.upgrade_requests(id),
  -- שורת ביטול מצביעה על השורה שהיא מבטלת; כל שורה מבוטלת לכל היותר פעם אחת
  reverses_id        uuid UNIQUE REFERENCES billing.ledger(id),
  recorded_by        uuid,
  recorded_by_email  text,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
  CHECK (net_amount + vat_amount = amount),
  CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CHECK (confirmation <> 'provider' OR provider_ref IS NOT NULL),
  CHECK (method IS NULL OR kind IN ('payment', 'reversal'))
);
CREATE INDEX IF NOT EXISTS ledger_tenant_idx ON billing.ledger (tenant_id, occurred_on DESC, entry_no DESC);
COMMENT ON TABLE billing.ledger IS 'מיגרציה 189: היומן הכספי — רק הוספה; תיקון בשורת ביטול (reverses_id)';

ALTER TABLE billing.upgrade_requests DROP CONSTRAINT IF EXISTS upgrade_requests_agreement_fk;
ALTER TABLE billing.upgrade_requests ADD CONSTRAINT upgrade_requests_agreement_fk
  FOREIGN KEY (agreement_id) REFERENCES billing.agreements(id);
ALTER TABLE billing.agreements DROP CONSTRAINT IF EXISTS agreements_request_fk;
ALTER TABLE billing.agreements ADD CONSTRAINT agreements_request_fk
  FOREIGN KEY (upgrade_request_id) REFERENCES billing.upgrade_requests(id);

-- ------------------------------------------------------------
-- 5. הגנות: רק הוספה, והמנוע תמיד של העסק
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _type text;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'רשומות החיוב לא נמחקות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT t.site_type INTO _type FROM public.tenants t WHERE t.id = NEW.tenant_id;
    -- העתקה עתידית של היסטוריה ישנה (legacy_import) יכולה להיות של עסק שכבר נמחק
    IF _type IS DISTINCT FROM NEW.engine THEN
      IF TG_TABLE_NAME <> 'ledger' OR _type IS NOT NULL OR (to_jsonb(NEW) ->> 'source') <> 'legacy_import' THEN
        RAISE EXCEPTION 'העסק לא נמצא או שהמנוע שלו שונה (%)', COALESCE(_type, 'לא ידוע') USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'ledger' THEN
      IF ((to_jsonb(NEW) ->> 'confirmation') = 'provider' OR (to_jsonb(NEW) ->> 'source') = 'provider')
         AND COALESCE(current_setting('billing.provider_write', true), '') <> 'on' THEN
        RAISE EXCEPTION 'אישור ספק תשלומים לא נרשם ידנית' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE
  IF TG_TABLE_NAME = 'ledger' THEN
    RAISE EXCEPTION 'היומן הכספי לא ניתן לשינוי — מתקנים בשורת ביטול' USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_TABLE_NAME = 'agreements' THEN
    -- מותר רק לסגור גרסה פעם אחת
    IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
       AND (to_jsonb(NEW) - 'superseded_at' - 'superseded_by') = (to_jsonb(OLD) - 'superseded_at' - 'superseded_by') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'הסכם לא נערך — יוצרים גרסה חדשה' USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_TABLE_NAME = 'upgrade_requests' THEN
    -- מותר רק להחליט על בקשה פתוחה, פעם אחת
    IF OLD.status = 'pending' AND NEW.status <> 'pending'
       AND (to_jsonb(NEW) - 'status' - 'decided_at' - 'decided_by' - 'decided_by_email' - 'decision_message' - 'agreement_id')
         = (to_jsonb(OLD) - 'status' - 'decided_at' - 'decided_by' - 'decided_by_email' - 'decision_message' - 'agreement_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'הבקשה כבר טופלה' USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_TABLE_NAME = 'settings' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'פעולה לא מותרת' USING ERRCODE = 'insufficient_privilege';
END $$;

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['agreements', 'ledger', 'upgrade_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS guard ON billing.%I', _t);
    EXECUTE format('CREATE TRIGGER guard BEFORE INSERT OR UPDATE OR DELETE ON billing.%I
                    FOR EACH ROW EXECUTE FUNCTION billing.guard()', _t);
    EXECUTE format('DROP TRIGGER IF EXISTS no_truncate ON billing.%I', _t);
    EXECUTE format('CREATE TRIGGER no_truncate BEFORE TRUNCATE ON billing.%I
                    FOR EACH STATEMENT EXECUTE FUNCTION billing.guard()', _t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS guard ON billing.settings;
CREATE TRIGGER guard BEFORE UPDATE OR DELETE ON billing.settings FOR EACH ROW EXECUTE FUNCTION billing.guard();

-- הרשאות: אין גישה ישירה לאף משתמש של ה-API. service_role — קריאה בלבד (גיבוי / תחקור)
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['settings', 'agreements', 'ledger', 'upgrade_requests'] LOOP
    EXECUTE format('ALTER TABLE billing.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('REVOKE ALL ON billing.%I FROM PUBLIC, anon, authenticated, service_role', _t);
    EXECUTE format('GRANT SELECT ON billing.%I TO service_role', _t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE billing.ledger_entry_no_seq FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. עזר: תאריך, מע"מ, מחירון, מצב המנוי
-- ------------------------------------------------------------
-- "היום" של העסקים (אזור הזמן של ישראל) — ימים שנותרו ותאריכים ביומן
CREATE OR REPLACE FUNCTION billing.today()
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Jerusalem')::date;
$$;

CREATE OR REPLACE FUNCTION billing.local_date(_ts timestamptz)
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (_ts AT TIME ZONE 'Asia/Jerusalem')::date;
$$;

-- פירוק מחיר לפי מצב המע"מ: included — הסכום כולל מע"מ; excluded — הסכום לפני מע"מ, והמע"מ מתווסף
CREATE OR REPLACE FUNCTION billing.price_parts(_price numeric, _mode text, _rate numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _p numeric := round(COALESCE(_price, 0), 2);
  _r numeric := COALESCE(_rate, 0);
  _vat numeric;
BEGIN
  IF _price IS NULL THEN
    RETURN NULL;
  END IF;
  IF _mode = 'excluded' THEN
    _vat := round(_p * _r / 100, 2);
    RETURN jsonb_build_object('net', _p, 'vat', _vat, 'gross', _p + _vat, 'rate', _r, 'mode', _mode);
  END IF;
  _vat := round(_p * _r / (100 + _r), 2);
  RETURN jsonb_build_object('net', _p - _vat, 'vat', _vat, 'gross', _p, 'rate', _r, 'mode', 'included');
END $$;

-- סכום כולל ידוע (כמו תשלום שהתקבל) → מע"מ ולפני מע"מ, לפי השיעור
CREATE OR REPLACE FUNCTION billing.gross_parts(_gross numeric, _rate numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT billing.price_parts(_gross, 'included', _rate);
$$;

CREATE OR REPLACE FUNCTION billing.engine_of(_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.site_type FROM public.tenants t WHERE t.id = _tenant;
$$;

CREATE OR REPLACE FUNCTION billing.tenant_label(_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT left(format('%s (%s)', t.name, t.slug), 200) FROM public.tenants t WHERE t.id = _tenant;
$$;

-- המחירון של המנוע — נקרא בכל פעם, כך שחבילה שתתווסף בעתיד עובדת בלי שינוי כאן.
-- בצימרים: כל החבילות חוץ מהניסיון; published = מוצעת ללקוחות
CREATE OR REPLACE FUNCTION billing.catalog(_engine text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE _engine
    WHEN 'ecommerce' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', p.plan_type, 'name', p.title, 'list_monthly', p.monthly_price,
                                          'setup_fee', NULL, 'published', true)
                       ORDER BY p.monthly_price, p.plan_type)
        FROM public.platform_plans p), '[]'::jsonb)
    WHEN 'hospitality' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'list_monthly', p.price_monthly,
                                          'setup_fee', p.setup_fee,
                                          'published', p.is_published AND p.price_monthly IS NOT NULL)
                       ORDER BY p.sort_order, p.code)
        FROM hospitality.plans p WHERE p.code <> 'trial'), '[]'::jsonb)
    ELSE '[]'::jsonb END;
$$;

CREATE OR REPLACE FUNCTION billing.plan_info(_engine text, _code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e FROM jsonb_array_elements(billing.catalog(_engine)) e WHERE e ->> 'code' = _code;
$$;

CREATE OR REPLACE FUNCTION billing.plan_name(_engine text, _code text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(billing.plan_info(_engine, _code) ->> 'name',
                  CASE WHEN _code = 'trial' THEN 'ניסיון' ELSE _code END);
$$;

-- המנוי של המנוע (מקור האמת לחבילה הפעילה ולתאריך החידוש) — לקריאה בלבד.
-- renewal_kind: trial (סוף הניסיון) | period (סוף התקופה ששולמה) | none (ללא תפוגה)
CREATE OR REPLACE FUNCTION billing.engine_state(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  es public.tenant_subscriptions;
  hs hospitality.subscriptions;
  _plan text;
  _status text;
  _end timestamptz;
  _kind text;
  _active boolean;
  _trial_days integer;
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF t.site_type = 'ecommerce' THEN
    SELECT * INTO es FROM public.tenant_subscriptions x WHERE x.tenant_id = _tenant;
    _plan := COALESCE(es.plan_type, 'trial');
    _status := COALESCE(es.status, 'trialing');
    _end := CASE WHEN _plan = 'trial' THEN es.trial_ends_at ELSE es.current_period_end END;
    _active := COALESCE((public.tenant_subscription_state(_tenant) ->> 'active')::boolean, true);
    _kind := CASE WHEN _plan = 'trial' THEN 'trial' WHEN _end IS NULL THEN 'none' ELSE 'period' END;
  ELSE
    SELECT * INTO hs FROM hospitality.subscriptions x WHERE x.tenant_id = _tenant;
    IF NOT FOUND THEN
      SELECT p.trial_days INTO _trial_days FROM hospitality.plans p WHERE p.code = 'trial';
      _plan := 'trial';
      _status := 'trialing';
      _end := t.created_at + make_interval(days => COALESCE(_trial_days, 0));
    ELSE
      _plan := hs.plan_code;
      _status := hs.status;
      _end := CASE WHEN hs.status = 'trialing' THEN hs.trial_ends_at ELSE hs.current_period_end END;
    END IF;
    _active := COALESCE((hospitality.entitlements(_tenant) ->> 'active')::boolean, false);
    _kind := CASE WHEN _status = 'trialing' THEN 'trial' WHEN _end IS NULL THEN 'none' ELSE 'period' END;
  END IF;
  RETURN jsonb_build_object(
    'engine', t.site_type, 'plan', _plan, 'plan_name', billing.plan_name(t.site_type, _plan),
    'status', _status, 'active', _active, 'renewal_kind', _kind, 'renewal_at', _end,
    'renewal_on', billing.local_date(_end),
    'days_left', CASE WHEN _end IS NULL THEN NULL ELSE GREATEST(0, billing.local_date(_end) - billing.today()) END,
    'system', t.is_default);
END $$;

-- המחיר של מחזור חיוב לפי ההסכם (לפני הפירוק): שנתי בלי מחיר שנתי = 12 × החודשי
CREATE OR REPLACE FUNCTION billing.cycle_price(a billing.agreements)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE a.billing_cycle
    WHEN 'yearly' THEN COALESCE(a.agreed_yearly, COALESCE(a.agreed_monthly, a.list_price_monthly) * 12)
    ELSE COALESCE(a.agreed_monthly, a.list_price_monthly) END;
$$;

CREATE OR REPLACE FUNCTION billing.cycle_interval(_cycle text)
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _cycle WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END;
$$;

CREATE OR REPLACE FUNCTION billing.current_agreement(_tenant uuid)
RETURNS billing.agreements LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.* FROM billing.agreements a WHERE a.tenant_id = _tenant AND a.superseded_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION billing.agreement_json(a billing.agreements, _internal boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', a.id, 'version', a.version, 'plan', a.plan_code, 'plan_name', billing.plan_name(a.engine, a.plan_code),
    'billing_cycle', a.billing_cycle, 'list_price_monthly', a.list_price_monthly,
    'agreed_monthly', a.agreed_monthly, 'agreed_yearly', a.agreed_yearly,
    'monthly', billing.price_parts(COALESCE(a.agreed_monthly, a.list_price_monthly), a.vat_mode, a.vat_rate),
    'yearly', billing.price_parts(COALESCE(a.agreed_yearly, COALESCE(a.agreed_monthly, a.list_price_monthly) * 12),
                                  a.vat_mode, a.vat_rate),
    'cycle_price', billing.price_parts(billing.cycle_price(a), a.vat_mode, a.vat_rate),
    'special_price', a.agreed_monthly IS NOT NULL OR a.agreed_yearly IS NOT NULL,
    'setup_fee', billing.price_parts(a.setup_fee, a.vat_mode, a.vat_rate),
    'commitment_months', a.commitment_months, 'start_date', a.start_date,
    'commitment_ends_on', CASE WHEN a.start_date IS NULL OR a.commitment_months IS NULL THEN NULL
                               ELSE (a.start_date + make_interval(months => a.commitment_months))::date END,
    'vat_mode', a.vat_mode, 'vat_rate', a.vat_rate, 'terms', a.terms, 'effective_on', a.effective_on,
    'reason', a.reason, 'created_at', a.created_at)
    || CASE WHEN _internal THEN jsonb_build_object(
         'internal_note', a.internal_note, 'created_by_email', a.created_by_email,
         'superseded_at', a.superseded_at, 'upgrade_request_id', a.upgrade_request_id)
       ELSE '{}'::jsonb END
  END;
$$;

CREATE OR REPLACE FUNCTION billing.request_json(r billing.upgrade_requests, _internal boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', r.id, 'current_plan', r.current_plan, 'current_plan_name', billing.plan_name(r.engine, r.current_plan),
    'requested_plan', r.requested_plan, 'requested_plan_name', billing.plan_name(r.engine, r.requested_plan),
    'requested_cycle', r.requested_cycle, 'list_price_monthly', r.list_price_monthly,
    'customer_note', r.customer_note, 'status', r.status, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_message', r.decision_message)
    || CASE WHEN _internal THEN jsonb_build_object(
         'tenant_id', r.tenant_id, 'tenant_label', r.tenant_label, 'engine', r.engine,
         'requested_by_email', r.requested_by_email, 'decided_by_email', r.decided_by_email,
         'agreement_id', r.agreement_id)
       ELSE '{}'::jsonb END
  END;
$$;

-- ------------------------------------------------------------
-- 7. הסיכום — פונקציה אחת לפאנל ולאזור הלקוח (אותם מספרים בדיוק)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.summary(_tenant uuid, _internal boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  a billing.agreements;
  _state jsonb;
  _engine text;
  _plan_list jsonb;
  _setup jsonb;
  _totals record;
  _renewal jsonb;
  _setup_due numeric;
  _sub_due numeric;
  _other_due numeric;
BEGIN
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  _engine := t.site_type;
  _state := billing.engine_state(_tenant);
  a := billing.current_agreement(_tenant);
  _plan_list := billing.plan_info(_engine, COALESCE(a.plan_code, _state ->> 'plan'));

  -- סכומים: שורה שבוטלה לא נספרת, ושורות הביטול עצמן לא נספרות. שורות שיועתקו בעתיד מההיסטוריה הישנה
  -- (legacy_import, רק באישור) נספרות ב"סה"כ שולם" בלבד — לא מול חיובים חדשים (אין להן חיוב תואם, ולא
  -- ממציאים חיוב), כדי שלא תופיע ללקוח "זכות" שלא קיימת
  SELECT
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'charge' AND l.category = 'subscription' AND l.source <> 'legacy_import'), 0)
      - COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'credit' AND l.category = 'subscription' AND l.source <> 'legacy_import'), 0) AS sub_due,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'payment' AND l.category = 'subscription' AND l.source <> 'legacy_import'), 0) AS sub_paid,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'charge' AND l.category = 'setup' AND l.source <> 'legacy_import'), 0)
      - COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'credit' AND l.category = 'setup' AND l.source <> 'legacy_import'), 0) AS setup_extra,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'payment' AND l.category = 'setup' AND l.source <> 'legacy_import'), 0) AS setup_paid,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'charge' AND l.category = 'other' AND l.source <> 'legacy_import'), 0)
      - COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'credit' AND l.category = 'other' AND l.source <> 'legacy_import'), 0) AS other_due,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'payment' AND l.category = 'other' AND l.source <> 'legacy_import'), 0) AS other_paid,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'payment' AND l.source = 'legacy_import'), 0) AS legacy_paid,
    COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'payment'), 0) AS total_paid
    INTO _totals
    FROM billing.ledger l
   WHERE l.tenant_id = _tenant AND l.kind <> 'reversal'
     AND NOT EXISTS (SELECT 1 FROM billing.ledger r WHERE r.reverses_id = l.id);

  _setup_due := COALESCE((billing.price_parts(a.setup_fee, a.vat_mode, a.vat_rate) ->> 'gross')::numeric, 0)
                + _totals.setup_extra;
  _sub_due := _totals.sub_due;
  _other_due := _totals.other_due;

  _renewal := jsonb_build_object(
    'kind', _state ->> 'renewal_kind', 'on', _state -> 'renewal_on', 'days_left', _state -> 'days_left',
    -- הסכום הצפוי לחידוש: לפי ההסכם (המחזור והמע"מ שלו), ובלי הסכם — מחיר המחירון החודשי
    'basis', CASE WHEN a.id IS NOT NULL THEN 'agreement' WHEN _plan_list IS NOT NULL THEN 'list' ELSE 'none' END,
    'cycle', COALESCE(a.billing_cycle, 'monthly'),
    'expected', CASE WHEN a.id IS NOT NULL THEN billing.price_parts(billing.cycle_price(a), a.vat_mode, a.vat_rate)
                     WHEN _plan_list ->> 'list_monthly' IS NOT NULL
                       THEN jsonb_build_object('gross', (_plan_list ->> 'list_monthly')::numeric, 'mode', 'list')
                END);

  RETURN jsonb_build_object(
    'tenant_id', t.id, 'business_name', t.name, 'slug', t.slug, 'engine', _engine,
    'today', billing.today(),
    'subscription', _state,
    'list_price_monthly', (_plan_list ->> 'list_monthly')::numeric,
    'list_setup_fee', (_plan_list ->> 'setup_fee')::numeric,
    'agreement', billing.agreement_json(a, _internal),
    'plan_mismatch', a.id IS NOT NULL AND a.plan_code <> (_state ->> 'plan') AND (_state ->> 'renewal_kind') <> 'trial',
    'setup', jsonb_build_object('due', _setup_due, 'paid', _totals.setup_paid, 'balance', _setup_due - _totals.setup_paid),
    'subscription_money', jsonb_build_object('due', _sub_due, 'paid', _totals.sub_paid, 'balance', _sub_due - _totals.sub_paid),
    'other', jsonb_build_object('due', _other_due, 'paid', _totals.other_paid, 'balance', _other_due - _totals.other_paid),
    'legacy_paid', _totals.legacy_paid,
    'total', jsonb_build_object('due', _setup_due + _sub_due + _other_due, 'paid', _totals.total_paid,
                                'balance', _setup_due + _sub_due + _other_due - (_totals.total_paid - _totals.legacy_paid)),
    'renewal', _renewal,
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'no', l.entry_no, 'kind', l.kind, 'category', l.category, 'amount', l.amount,
               'net', l.net_amount, 'vat', l.vat_amount, 'vat_rate', l.vat_rate, 'occurred_on', l.occurred_on,
               'period_start', l.period_start, 'period_end', l.period_end, 'method', l.method,
               'description', l.description, 'confirmation', l.confirmation, 'source', l.source,
               'reverses_id', l.reverses_id,
               'reversed', EXISTS (SELECT 1 FROM billing.ledger r WHERE r.reverses_id = l.id))
             || CASE WHEN _internal THEN jsonb_build_object(
                  'reference', l.reference, 'internal_note', l.internal_note,
                  'recorded_by_email', l.recorded_by_email, 'created_at', l.created_at,
                  'legacy_ref', l.legacy_ref)
                ELSE '{}'::jsonb END
             ORDER BY l.occurred_on DESC, l.entry_no DESC)
        FROM billing.ledger l
       WHERE l.tenant_id = _tenant AND (_internal OR l.kind <> 'reversal')), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(billing.request_json(r, _internal) ORDER BY r.created_at DESC)
        FROM (SELECT * FROM billing.upgrade_requests r WHERE r.tenant_id = _tenant
               ORDER BY r.created_at DESC LIMIT CASE WHEN _internal THEN 50 ELSE 5 END) r), '[]'::jsonb),
    'plans', billing.catalog(_engine))
    || CASE WHEN _internal THEN jsonb_build_object(
         'history', COALESCE((SELECT jsonb_agg(billing.agreement_json(h, true) ORDER BY h.version DESC)
                                FROM billing.agreements h WHERE h.tenant_id = _tenant), '[]'::jsonb),
         'default_vat_rate', (SELECT s.default_vat_rate FROM billing.settings s WHERE s.id))
       ELSE '{}'::jsonb END;
END $$;

-- ------------------------------------------------------------
-- 8. הרשאות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.require_platform_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT COALESCE(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- העסק של הבקשה, ורק לבעלים שלו (או למנהל הפלטפורמה). מנהלים, מנהל/ת עסק ועובדים — לא
CREATE OR REPLACE FUNCTION billing.owner_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
  _engine text;
  _ok boolean := false;
BEGIN
  IF _t IS NOT NULL AND auth.uid() IS NOT NULL THEN
    _engine := billing.engine_of(_t);
    _ok := CASE _engine
      WHEN 'hospitality' THEN hospitality.can('billing.manage')
      WHEN 'ecommerce' THEN public.staff_can('billing.manage', auth.uid())
      ELSE false END;
  END IF;
  IF NOT COALESCE(_ok, false) THEN
    RAISE EXCEPTION 'רק בעל העסק יכול לצפות בפרטי החיוב' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _t;
END $$;

CREATE OR REPLACE FUNCTION billing.actor_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION billing.audit(_tenant uuid, _action text, _details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, auth.uid(), billing.actor_email(), _action, COALESCE(_details, '{}'::jsonb));
$$;

-- ------------------------------------------------------------
-- 9. קלט: הסכם
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.num(_v jsonb, _key text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE _x jsonb := _v -> _key;
BEGIN
  IF _x IS NULL OR jsonb_typeof(_x) = 'null' OR btrim(_x #>> '{}') = '' THEN
    RETURN NULL;
  END IF;
  RETURN round((_x #>> '{}')::numeric, 2);
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'ערך מספרי לא תקין בשדה %', _key USING ERRCODE = 'check_violation';
END $$;

CREATE OR REPLACE FUNCTION billing.txt(_v jsonb, _key text, _max integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT NULLIF(left(btrim(COALESCE(_v ->> _key, '')), _max), '');
$$;

-- בונה גרסת הסכם חדשה (לא שומרת) מהקלט, ובודק אותה מול המחירון של המנוע
CREATE OR REPLACE FUNCTION billing.build_agreement(_tenant uuid, _input jsonb)
RETURNS billing.agreements LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a billing.agreements;
  _engine text := billing.engine_of(_tenant);
  _plan jsonb;
  _d text;
BEGIN
  IF _engine IS NULL THEN
    RAISE EXCEPTION 'העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  a.tenant_id := _tenant;
  a.engine := _engine;
  a.tenant_label := COALESCE(billing.tenant_label(_tenant), _tenant::text);
  a.plan_code := lower(btrim(COALESCE(_input ->> 'plan', '')));
  _plan := billing.plan_info(_engine, a.plan_code);
  IF _plan IS NULL THEN
    RAISE EXCEPTION 'החבילה "%" לא קיימת במחירון של %', a.plan_code,
      CASE _engine WHEN 'hospitality' THEN 'הצימרים' ELSE 'החנויות' END USING ERRCODE = 'check_violation';
  END IF;
  a.list_price_monthly := (_plan ->> 'list_monthly')::numeric;
  a.billing_cycle := COALESCE(NULLIF(_input ->> 'billing_cycle', ''), 'monthly');
  IF a.billing_cycle NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'מחזור חיוב: חודשי או שנתי' USING ERRCODE = 'check_violation';
  END IF;
  a.agreed_monthly := billing.num(_input, 'agreed_monthly');
  a.agreed_yearly := billing.num(_input, 'agreed_yearly');
  a.setup_fee := COALESCE(billing.num(_input, 'setup_fee'), 0);
  IF a.agreed_monthly < 0 OR a.agreed_yearly < 0 OR a.setup_fee < 0
     OR a.agreed_monthly > 1000000 OR a.agreed_yearly > 1000000 OR a.setup_fee > 1000000 THEN
    RAISE EXCEPTION 'סכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF a.agreed_monthly IS NULL AND a.list_price_monthly IS NULL THEN
    RAISE EXCEPTION 'לחבילה הזו אין מחיר במחירון — יש לקבוע מחיר מוסכם' USING ERRCODE = 'check_violation';
  END IF;
  a.commitment_months := NULLIF(btrim(COALESCE(_input ->> 'commitment_months', '')), '')::integer;
  IF a.commitment_months IS NOT NULL AND a.commitment_months NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'תקופת התחייבות: 1 עד 120 חודשים' USING ERRCODE = 'check_violation';
  END IF;
  _d := NULLIF(btrim(COALESCE(_input ->> 'start_date', '')), '');
  a.start_date := CASE WHEN _d IS NULL THEN NULL ELSE _d::date END;
  a.vat_mode := COALESCE(NULLIF(_input ->> 'vat_mode', ''), 'excluded');
  IF a.vat_mode NOT IN ('included', 'excluded') THEN
    RAISE EXCEPTION 'מע"מ: כולל או לא כולל' USING ERRCODE = 'check_violation';
  END IF;
  a.vat_rate := COALESCE(billing.num(_input, 'vat_rate'), (SELECT s.default_vat_rate FROM billing.settings s WHERE s.id));
  IF a.vat_rate NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'שיעור מע"מ: 0 עד 100' USING ERRCODE = 'check_violation';
  END IF;
  a.terms := billing.txt(_input, 'terms', 2000);
  a.internal_note := billing.txt(_input, 'internal_note', 2000);
  a.effective_on := billing.today();
  RETURN a;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'תאריך התחלה לא תקין' USING ERRCODE = 'check_violation';
WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'תקופת התחייבות לא תקינה' USING ERRCODE = 'check_violation';
END $$;

-- ------------------------------------------------------------
-- 10. הצעת הפרש יחסי (שינוי באמצע תקופה) — קריאה בלבד
-- ------------------------------------------------------------
-- תאריך החידוש לא משתנה; הזמן שנותר מחושב לפי "היום" בישראל. ההפרש = (המחיר היומי החדש − הקודם) ×
-- הימים שנותרו. חיובי = חיוב אפשרי, שלילי = זיכוי אפשרי. שום דבר לא נרשם כאן.
CREATE OR REPLACE FUNCTION billing.quote(_tenant uuid, n billing.agreements)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _state jsonb := billing.engine_state(_tenant);
  o billing.agreements := billing.current_agreement(_tenant);
  _end timestamptz := (_state ->> 'renewal_at')::timestamptz;
  _end_on date;
  _today date := billing.today();
  _old_gross numeric;
  _new_gross numeric;
  _old_days integer;
  _new_days integer;
  _left integer;
  _diff numeric;
  _list jsonb;
BEGIN
  IF (_state ->> 'renewal_kind') <> 'period' OR _end IS NULL OR _end <= now() THEN
    RETURN jsonb_build_object('kind', 'none',
      'reason', CASE _state ->> 'renewal_kind' WHEN 'trial' THEN 'trial' WHEN 'none' THEN 'no_period' ELSE 'expired' END,
      'difference', 0, 'renewal_on', _state -> 'renewal_on', 'vat_rate', n.vat_rate,
      'new_cycle_price', (billing.price_parts(billing.cycle_price(n), n.vat_mode, n.vat_rate) ->> 'gross')::numeric);
  END IF;
  _end_on := billing.local_date(_end);
  _left := GREATEST(0, _end_on - _today);
  _new_gross := (billing.price_parts(billing.cycle_price(n), n.vat_mode, n.vat_rate) ->> 'gross')::numeric;
  _new_days := _end_on - billing.local_date(_end - billing.cycle_interval(n.billing_cycle));
  IF o.id IS NOT NULL THEN
    _old_gross := (billing.price_parts(billing.cycle_price(o), o.vat_mode, o.vat_rate) ->> 'gross')::numeric;
    _old_days := _end_on - billing.local_date(_end - billing.cycle_interval(o.billing_cycle));
  ELSE
    -- בלי הסכם: מחיר המחירון החודשי של החבילה הפעילה
    _list := billing.plan_info(_state ->> 'engine', _state ->> 'plan');
    _old_gross := COALESCE((_list ->> 'list_monthly')::numeric, 0);
    _old_days := _end_on - billing.local_date(_end - interval '1 month');
  END IF;
  _diff := round((_new_gross / GREATEST(_new_days, 1) - _old_gross / GREATEST(_old_days, 1)) * _left, 2);
  RETURN jsonb_build_object(
    'kind', CASE WHEN _diff > 0 THEN 'charge' WHEN _diff < 0 THEN 'credit' ELSE 'none' END,
    'reason', CASE WHEN _diff = 0 THEN 'same_price' END,
    'renewal_on', _end_on, 'days_left', _left,
    'old_basis', CASE WHEN o.id IS NULL THEN 'list' ELSE 'agreement' END,
    'old_cycle_price', _old_gross, 'old_cycle_days', _old_days,
    'new_cycle_price', _new_gross, 'new_cycle_days', _new_days,
    'difference', _diff, 'vat_rate', n.vat_rate);
END $$;

-- ------------------------------------------------------------
-- 11. כתיבה ליומן (פנימי — כל הכניסות עוברות כאן)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing.add_entry(
  _tenant uuid, _kind text, _category text, _amount numeric, _vat_rate numeric, _occurred_on date,
  _source text, _extra jsonb DEFAULT '{}'::jsonb)
RETURNS billing.ledger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l billing.ledger;
  _parts jsonb;
  _a billing.agreements := billing.current_agreement(_tenant);
BEGIN
  IF _amount IS NULL OR round(_amount, 2) <= 0 OR _amount > 1000000 THEN
    RAISE EXCEPTION 'סכום לא תקין (חייב להיות גדול מאפס)' USING ERRCODE = 'check_violation';
  END IF;
  _parts := billing.gross_parts(round(_amount, 2), _vat_rate);
  INSERT INTO billing.ledger (tenant_id, tenant_label, engine, kind, category, amount, vat_rate, vat_amount, net_amount,
                              occurred_on, period_start, period_end, method, description, reference, internal_note,
                              confirmation, source, agreement_id, upgrade_request_id, reverses_id,
                              recorded_by, recorded_by_email)
  VALUES (_tenant, COALESCE(billing.tenant_label(_tenant), _tenant::text), billing.engine_of(_tenant),
          _kind, _category, (_parts ->> 'gross')::numeric, _vat_rate, (_parts ->> 'vat')::numeric, (_parts ->> 'net')::numeric,
          COALESCE(_occurred_on, billing.today()),
          NULLIF(_extra ->> 'period_start', '')::date, NULLIF(_extra ->> 'period_end', '')::date,
          NULLIF(_extra ->> 'method', ''), billing.txt(_extra, 'description', 200), billing.txt(_extra, 'reference', 120),
          billing.txt(_extra, 'internal_note', 500), 'manual', _source, _a.id,
          NULLIF(_extra ->> 'upgrade_request_id', '')::uuid, NULLIF(_extra ->> 'reverses_id', '')::uuid,
          auth.uid(), billing.actor_email())
  RETURNING * INTO l;
  RETURN l;
END $$;

-- ------------------------------------------------------------
-- 12. החלפת חבילה במנוי של המנוע — התאריכים לא משתנים (פנימי)
-- ------------------------------------------------------------
-- בניסיון: לא נוגעים (כל הפיצ'רים פתוחים; החבילה נכנסת בחידוש הראשון). בחבילה בתשלום: רק החבילה.
CREATE OR REPLACE FUNCTION billing.apply_plan(_tenant uuid, _plan text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _state jsonb := billing.engine_state(_tenant);
  _before text := _state ->> 'plan';
BEGIN
  IF (_state ->> 'renewal_kind') = 'trial' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'trial', 'plan', _before);
  END IF;
  IF _before = _plan THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'same_plan', 'plan', _before);
  END IF;
  IF (_state ->> 'engine') = 'ecommerce' THEN
    UPDATE public.tenant_subscriptions SET plan_type = _plan WHERE tenant_id = _tenant;
  ELSE
    UPDATE hospitality.subscriptions SET plan_code = _plan, updated_by = auth.uid() WHERE tenant_id = _tenant;
  END IF;
  PERFORM billing.audit(_tenant, 'billing_plan_applied',
    jsonb_build_object('engine', _state ->> 'engine', 'previous_plan', _before, 'plan', _plan,
                       'renewal_at_unchanged', _state -> 'renewal_at', 'status', _state ->> 'status'));
  RETURN jsonb_build_object('applied', true, 'previous_plan', _before, 'plan', _plan);
END $$;

-- ------------------------------------------------------------
-- 13. פונקציות לבעל העסק (העסק של הבקשה בלבד)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_billing_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN billing.summary(billing.owner_tenant(), false);
END $$;

CREATE OR REPLACE FUNCTION public.my_billing_request_upgrade(_plan text, _cycle text DEFAULT 'monthly', _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := billing.owner_tenant();
  _engine text := billing.engine_of(_t);
  _state jsonb := billing.engine_state(_t);
  _a billing.agreements := billing.current_agreement(_t);
  _p text := lower(btrim(COALESCE(_plan, '')));
  _info jsonb := billing.plan_info(_engine, _p);
  r billing.upgrade_requests;
BEGIN
  IF _info IS NULL OR NOT COALESCE((_info ->> 'published')::boolean, false) THEN
    RAISE EXCEPTION 'החבילה לא זמינה' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_cycle, 'monthly') NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'מחזור חיוב: חודשי או שנתי' USING ERRCODE = 'check_violation';
  END IF;
  IF _p = COALESCE(_a.plan_code, _state ->> 'plan') THEN
    RAISE EXCEPTION 'זו כבר החבילה שלך' USING ERRCODE = 'check_violation';
  END IF;
  -- אותו עסק: בקשה אחת בכל פעם (גם בשתי לחיצות במקביל — האינדקס הייחודי)
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-request:' || _t::text, 189));
  IF EXISTS (SELECT 1 FROM billing.upgrade_requests x WHERE x.tenant_id = _t AND x.status = 'pending') THEN
    RAISE EXCEPTION 'כבר יש בקשה שממתינה לטיפול' USING ERRCODE = 'unique_violation';
  END IF;
  -- שליחה וביטול בלולאה: עד 10 בקשות ביממה לעסק
  IF (SELECT count(*) FROM billing.upgrade_requests x
       WHERE x.tenant_id = _t AND x.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'נשלחו יותר מדי בקשות היום — נסו שוב מחר או פנו לתמיכה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO billing.upgrade_requests (tenant_id, tenant_label, engine, current_plan, requested_plan, requested_cycle,
                                        list_price_monthly, customer_note, requested_by, requested_by_email)
  VALUES (_t, COALESCE(billing.tenant_label(_t), _t::text), _engine, COALESCE(_a.plan_code, _state ->> 'plan'), _p,
          COALESCE(_cycle, 'monthly'), (_info ->> 'list_monthly')::numeric,
          NULLIF(left(btrim(COALESCE(_note, '')), 500), ''), auth.uid(), billing.actor_email())
  RETURNING * INTO r;
  RETURN billing.request_json(r, false);
END $$;

CREATE OR REPLACE FUNCTION public.my_billing_cancel_request(_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := billing.owner_tenant();
  r billing.upgrade_requests;
BEGIN
  UPDATE billing.upgrade_requests x
     SET status = 'canceled', decided_at = now(), decided_by = auth.uid(), decided_by_email = billing.actor_email()
   WHERE x.id = _request AND x.tenant_id = _t AND x.status = 'pending'
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר טופלה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN billing.request_json(r, false);
END $$;

-- ------------------------------------------------------------
-- 14. פונקציות למנהל הפלטפורמה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_billing_card(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM billing.require_platform_admin();
  RETURN billing.summary(_tenant, true);
END $$;

-- הצעת ההפרש לפני שמירה (לא נרשם כלום)
CREATE OR REPLACE FUNCTION public.platform_billing_quote(_tenant uuid, _input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM billing.require_platform_admin();
  RETURN billing.quote(_tenant, billing.build_agreement(_tenant, _input));
END $$;

-- גרסת הסכם חדשה. _expected_version: הגרסה שהמסך הציג (0 = אין הסכם) — השתנתה בינתיים → נעצר.
-- _apply_plan: להחליף גם את החבילה הפעילה (התאריכים לא משתנים). _record_difference: לרשום את ההפרש
-- היחסי (ההצעה שהוצגה) כחיוב / זיכוי. _request: אישור בקשת שדרוג (נסגרת כ"אושרה").
CREATE OR REPLACE FUNCTION public.platform_billing_save_agreement(
  _tenant uuid, _input jsonb, _expected_version integer,
  _apply_plan boolean DEFAULT false, _record_difference boolean DEFAULT false, _request uuid DEFAULT NULL,
  _request_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o billing.agreements;
  n billing.agreements;
  r billing.upgrade_requests;
  _quote jsonb;
  _applied jsonb := jsonb_build_object('applied', false, 'reason', 'not_requested');
  _entry billing.ledger;
BEGIN
  PERFORM billing.require_platform_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-agreement:' || _tenant::text, 189));
  o := billing.current_agreement(_tenant);
  IF COALESCE(o.version, 0) <> COALESCE(_expected_version, -1) THEN
    RAISE EXCEPTION 'ההסכם השתנה בינתיים — רעננו את המסך ונסו שוב' USING ERRCODE = 'serialization_failure';
  END IF;
  n := billing.build_agreement(_tenant, _input);
  IF _request IS NOT NULL THEN
    SELECT * INTO r FROM billing.upgrade_requests x WHERE x.id = _request AND x.tenant_id = _tenant FOR UPDATE;
    IF r.id IS NULL OR r.status <> 'pending' THEN
      RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר טופלה' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  -- ההצעה מחושבת לפני שההסכם החדש נשמר (מול ההסכם הקודם)
  _quote := billing.quote(_tenant, n);

  n.id := gen_random_uuid();
  n.version := COALESCE(o.version, 0) + 1;
  n.reason := CASE WHEN r.id IS NOT NULL THEN 'upgrade' WHEN o.id IS NULL THEN 'initial' ELSE 'change' END;
  n.upgrade_request_id := r.id;
  n.created_by := auth.uid();
  n.created_by_email := billing.actor_email();
  n.created_at := clock_timestamp();
  IF o.id IS NOT NULL THEN
    UPDATE billing.agreements SET superseded_at = clock_timestamp(), superseded_by = n.id WHERE id = o.id;
  END IF;
  INSERT INTO billing.agreements VALUES (n.*);

  IF _apply_plan OR r.id IS NOT NULL THEN
    _applied := billing.apply_plan(_tenant, n.plan_code);
  END IF;
  IF _record_difference AND (_quote ->> 'kind') IN ('charge', 'credit') THEN
    _entry := billing.add_entry(_tenant, _quote ->> 'kind', 'subscription', abs((_quote ->> 'difference')::numeric),
      n.vat_rate, billing.today(), 'plan_change',
      jsonb_build_object('period_start', billing.today(), 'period_end', _quote ->> 'renewal_on',
        'description', format('%s יחסי — %s (%s ימים עד החידוש)',
                              CASE WHEN _quote ->> 'kind' = 'charge' THEN 'הפרש' ELSE 'זיכוי' END,
                              billing.plan_name(n.engine, n.plan_code), _quote ->> 'days_left'),
        'upgrade_request_id', r.id));
  END IF;
  IF r.id IS NOT NULL THEN
    UPDATE billing.upgrade_requests
       SET status = 'approved', decided_at = now(), decided_by = auth.uid(), decided_by_email = billing.actor_email(),
           decision_message = NULLIF(left(btrim(COALESCE(_request_message, '')), 500), ''), agreement_id = n.id
     WHERE id = r.id;
  END IF;
  PERFORM billing.audit(_tenant, 'billing_agreement_saved', jsonb_build_object(
    'version', n.version, 'previous_version', o.version, 'plan', n.plan_code, 'previous_plan', o.plan_code,
    'cycle', n.billing_cycle, 'agreed_monthly', n.agreed_monthly, 'agreed_yearly', n.agreed_yearly,
    'previous_agreed_monthly', o.agreed_monthly, 'previous_agreed_yearly', o.agreed_yearly,
    'setup_fee', n.setup_fee, 'vat_mode', n.vat_mode, 'vat_rate', n.vat_rate,
    'plan_applied', _applied -> 'applied', 'difference_recorded', _entry.id IS NOT NULL,
    'difference', CASE WHEN _entry.id IS NOT NULL THEN _quote -> 'difference' END, 'request', r.id));
  RETURN jsonb_build_object('card', billing.summary(_tenant, true), 'plan', _applied, 'quote', _quote,
                            'entry_id', _entry.id);
END $$;

-- רישום ידני ביומן: חיוב / תשלום / זיכוי. תמיד "manual" (נרשם בידי מנהל הפלטפורמה)
CREATE OR REPLACE FUNCTION public.platform_billing_record_entry(_tenant uuid, _input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _kind text := _input ->> 'kind';
  _category text := COALESCE(NULLIF(_input ->> 'category', ''), 'subscription');
  _method text := NULLIF(_input ->> 'method', '');
  _a billing.agreements;
  _rate numeric;
  _date date;
  l billing.ledger;
BEGIN
  PERFORM billing.require_platform_admin();
  IF billing.engine_of(_tenant) IS NULL THEN
    RAISE EXCEPTION 'העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _kind NOT IN ('charge', 'payment', 'credit') THEN
    RAISE EXCEPTION 'סוג רישום: חיוב, תשלום או זיכוי' USING ERRCODE = 'check_violation';
  END IF;
  IF _category NOT IN ('subscription', 'setup', 'other') THEN
    RAISE EXCEPTION 'קטגוריה: מנוי, הקמה או אחר' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind = 'payment' AND (_method IS NULL OR _method NOT IN ('bank_transfer', 'bit', 'credit_card', 'cash', 'check', 'other')) THEN
    RAISE EXCEPTION 'בחרו אמצעי תשלום' USING ERRCODE = 'check_violation';
  END IF;
  _a := billing.current_agreement(_tenant);
  _rate := COALESCE(billing.num(_input, 'vat_rate'), _a.vat_rate, (SELECT s.default_vat_rate FROM billing.settings s WHERE s.id));
  IF _rate NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'שיעור מע"מ: 0 עד 100' USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    _date := COALESCE(NULLIF(_input ->> 'occurred_on', '')::date, billing.today());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'תאריך לא תקין' USING ERRCODE = 'check_violation';
  END;
  IF _date > billing.today() + 1 AND _kind = 'payment' THEN
    RAISE EXCEPTION 'תאריך תשלום עתידי' USING ERRCODE = 'check_violation';
  END IF;
  l := billing.add_entry(_tenant, _kind, _category, billing.num(_input, 'amount'), _rate, _date, 'platform_admin',
         jsonb_build_object('method', CASE WHEN _kind = 'payment' THEN _method END,
           'description', _input ->> 'description', 'reference', _input ->> 'reference',
           'internal_note', _input ->> 'internal_note',
           'period_start', _input ->> 'period_start', 'period_end', _input ->> 'period_end'));
  PERFORM billing.audit(_tenant, 'billing_entry_recorded', jsonb_build_object(
    'entry', l.entry_no, 'kind', l.kind, 'category', l.category, 'amount', l.amount, 'vat_rate', l.vat_rate,
    'occurred_on', l.occurred_on, 'method', l.method));
  RETURN billing.summary(_tenant, true);
END $$;

-- ביטול רישום: שורת ביטול חדשה; השורה המקורית נשארת (ומסומנת "בוטל" בתצוגה)
CREATE OR REPLACE FUNCTION public.platform_billing_reverse_entry(_entry uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o billing.ledger;
  l billing.ledger;
BEGIN
  PERFORM billing.require_platform_admin();
  IF char_length(btrim(COALESCE(_reason, ''))) < 2 THEN
    RAISE EXCEPTION 'כתבו את סיבת הביטול' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO o FROM billing.ledger x WHERE x.id = _entry FOR UPDATE;
  IF o.id IS NULL THEN
    RAISE EXCEPTION 'הרישום לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF o.kind = 'reversal' THEN
    RAISE EXCEPTION 'אי אפשר לבטל שורת ביטול' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM billing.ledger x WHERE x.reverses_id = o.id) THEN
    RAISE EXCEPTION 'הרישום כבר בוטל' USING ERRCODE = 'unique_violation';
  END IF;
  l := billing.add_entry(o.tenant_id, 'reversal', o.category, o.amount, o.vat_rate, billing.today(), o.source,
         jsonb_build_object('reverses_id', o.id, 'method', o.method,
           'description', format('ביטול רישום #%s', o.entry_no),
           'internal_note', left(btrim(_reason), 500)));
  PERFORM billing.audit(o.tenant_id, 'billing_entry_reversed', jsonb_build_object(
    'entry', o.entry_no, 'reversal', l.entry_no, 'kind', o.kind, 'amount', o.amount, 'reason', left(btrim(_reason), 200)));
  RETURN billing.summary(o.tenant_id, true);
END $$;

-- חידוש לתקופה הבאה לפי ההסכם: מסוף התקופה הנוכחית (או סוף הניסיון) — הזמן ששולם לא אובד; אם כבר
-- עבר — מעכשיו. החבילה של ההסכם נכנסת למנוי, נרשם חיוב על התקופה, ואם התקבל — גם התשלום.
-- _expected_renewal: תאריך החידוש שהמסך הציג (מונע חידוש כפול בשתי לחיצות).
CREATE OR REPLACE FUNCTION public.platform_billing_renew(_tenant uuid, _expected_renewal date, _input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a billing.agreements;
  _state jsonb;
  _engine text;
  _old_end timestamptz;
  _from timestamptz;
  _to timestamptz;
  _price jsonb;
  _charge billing.ledger;
  _pay billing.ledger;
  _method text := NULLIF(_input ->> 'method', '');
  _paid boolean := COALESCE((_input ->> 'record_payment')::boolean, false);
  t public.tenants;
BEGIN
  PERFORM billing.require_platform_admin();
  PERFORM pg_advisory_xact_lock(hashtextextended('billing-agreement:' || _tenant::text, 189));
  SELECT * INTO t FROM public.tenants x WHERE x.id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'העסק לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.is_default THEN
    RAISE EXCEPTION 'חנות המערכת לא מתחדשת' USING ERRCODE = 'check_violation';
  END IF;
  a := billing.current_agreement(_tenant);
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'קודם צריך לקבוע הסכם ללקוח' USING ERRCODE = 'check_violation';
  END IF;
  _state := billing.engine_state(_tenant);
  _engine := _state ->> 'engine';
  IF (_state ->> 'renewal_kind') = 'none' THEN
    RAISE EXCEPTION 'למנוי הזה אין תאריך סיום — אין מה לחדש' USING ERRCODE = 'check_violation';
  END IF;
  IF (_state ->> 'renewal_on')::date IS DISTINCT FROM _expected_renewal THEN
    RAISE EXCEPTION 'תאריך החידוש השתנה בינתיים — רעננו את המסך' USING ERRCODE = 'serialization_failure';
  END IF;
  IF _paid AND (_method IS NULL OR _method NOT IN ('bank_transfer', 'bit', 'credit_card', 'cash', 'check', 'other')) THEN
    RAISE EXCEPTION 'בחרו אמצעי תשלום' USING ERRCODE = 'check_violation';
  END IF;
  _old_end := (_state ->> 'renewal_at')::timestamptz;
  _from := GREATEST(now(), COALESCE(_old_end, now()));
  IF (_state ->> 'status') IN ('canceled', 'expired') THEN
    _from := now();
  END IF;
  _to := _from + billing.cycle_interval(a.billing_cycle);

  IF _engine = 'ecommerce' THEN
    UPDATE public.tenant_subscriptions
       SET plan_type = a.plan_code, status = 'active', current_period_end = _to
     WHERE tenant_id = _tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'המנוי של החנות לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    INSERT INTO hospitality.subscriptions (tenant_id, plan_code, status, trial_ends_at, current_period_end, updated_by)
    VALUES (_tenant, a.plan_code, 'active', (_state ->> 'renewal_at')::timestamptz, _to, auth.uid())
    ON CONFLICT (tenant_id) DO UPDATE
      SET plan_code = EXCLUDED.plan_code, status = 'active', current_period_end = EXCLUDED.current_period_end,
          updated_by = EXCLUDED.updated_by;
  END IF;

  _price := billing.price_parts(billing.cycle_price(a), a.vat_mode, a.vat_rate);
  IF (_price ->> 'gross')::numeric > 0 THEN
    _charge := billing.add_entry(_tenant, 'charge', 'subscription', (_price ->> 'gross')::numeric, a.vat_rate,
      billing.today(), 'renewal', jsonb_build_object(
        'period_start', billing.local_date(_from), 'period_end', billing.local_date(_to),
        'description', format('מנוי %s, %s – %s', billing.plan_name(_engine, a.plan_code),
                              to_char(billing.local_date(_from), 'DD/MM/YYYY'), to_char(billing.local_date(_to), 'DD/MM/YYYY'))));
    IF _paid THEN
      _pay := billing.add_entry(_tenant, 'payment', 'subscription',
        COALESCE(billing.num(_input, 'amount'), (_price ->> 'gross')::numeric), a.vat_rate,
        COALESCE(NULLIF(_input ->> 'paid_on', '')::date, billing.today()), 'renewal', jsonb_build_object(
          'method', _method, 'reference', _input ->> 'reference',
          'period_start', billing.local_date(_from), 'period_end', billing.local_date(_to),
          'description', format('תשלום מנוי %s – %s', to_char(billing.local_date(_from), 'DD/MM/YYYY'),
                                to_char(billing.local_date(_to), 'DD/MM/YYYY'))));
    END IF;
  END IF;
  PERFORM billing.audit(_tenant, 'billing_renewed', jsonb_build_object(
    'engine', _engine, 'plan', a.plan_code, 'previous_plan', _state ->> 'plan', 'previous_status', _state ->> 'status',
    'previous_end', _old_end, 'new_end', _to, 'cycle', a.billing_cycle, 'charge', _charge.entry_no,
    'payment', _pay.entry_no));
  RETURN billing.summary(_tenant, true);
END $$;

CREATE OR REPLACE FUNCTION public.platform_billing_requests(_status text DEFAULT 'pending')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM billing.require_platform_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(billing.request_json(r, true) || jsonb_build_object(
             'subscription', billing.engine_state(r.tenant_id),
             'agreement', billing.agreement_json(billing.current_agreement(r.tenant_id), true))
           ORDER BY r.created_at DESC)
      FROM (SELECT * FROM billing.upgrade_requests x
             WHERE _status IS NULL OR _status = 'all' OR x.status = _status
             ORDER BY x.created_at DESC LIMIT 200) r), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.platform_billing_reject_request(_request uuid, _message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r billing.upgrade_requests;
BEGIN
  PERFORM billing.require_platform_admin();
  UPDATE billing.upgrade_requests x
     SET status = 'rejected', decided_at = now(), decided_by = auth.uid(), decided_by_email = billing.actor_email(),
         decision_message = NULLIF(left(btrim(COALESCE(_message, '')), 500), '')
   WHERE x.id = _request AND x.status = 'pending'
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'הבקשה לא נמצאה או שכבר טופלה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM billing.audit(r.tenant_id, 'billing_request_rejected', jsonb_build_object(
    'request', r.id, 'requested_plan', r.requested_plan));
  RETURN billing.request_json(r, true);
END $$;

CREATE OR REPLACE FUNCTION public.platform_billing_pending_count()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM billing.require_platform_admin();
  RETURN (SELECT count(*)::integer FROM billing.upgrade_requests r WHERE r.status = 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.platform_billing_save_settings(_default_vat_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _before numeric;
BEGIN
  PERFORM billing.require_platform_admin();
  IF _default_vat_rate IS NULL OR _default_vat_rate NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'שיעור מע"מ: 0 עד 100' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.default_vat_rate INTO _before FROM billing.settings s WHERE s.id FOR UPDATE;
  UPDATE billing.settings SET default_vat_rate = round(_default_vat_rate, 2), updated_at = now(), updated_by = auth.uid()
   WHERE id;
  PERFORM billing.audit(NULL, 'billing_settings_saved',
    jsonb_build_object('default_vat_rate', round(_default_vat_rate, 2), 'previous', _before));
  RETURN jsonb_build_object('default_vat_rate', round(_default_vat_rate, 2));
END $$;

-- ------------------------------------------------------------
-- 15. הרשאות הרצה
-- ------------------------------------------------------------
DO $$
DECLARE _f record;
BEGIN
  -- כל הפונקציות בסכמה billing — פנימיות בלבד
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace = 'billing'::regnamespace LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', _f.sig);
  END LOOP;
  -- הפונקציות הציבוריות: למשתמש מחובר (ההרשאה נבדקת בתוך כל אחת)
  FOR _f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
             WHERE p.pronamespace = 'public'::regnamespace
               AND p.proname IN ('my_billing_summary', 'my_billing_request_upgrade', 'my_billing_cancel_request',
                                 'platform_billing_card', 'platform_billing_quote', 'platform_billing_save_agreement',
                                 'platform_billing_record_entry', 'platform_billing_reverse_entry', 'platform_billing_renew',
                                 'platform_billing_requests', 'platform_billing_reject_request',
                                 'platform_billing_pending_count', 'platform_billing_save_settings') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', _f.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

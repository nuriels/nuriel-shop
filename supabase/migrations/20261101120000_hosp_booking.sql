-- ============================================================
-- Hospitality — מנוע ההזמנות (Hospitality Stage 1d, מיגרציה 4)
-- ============================================================
-- מה המיגרציה עושה (הכל בסכמה hospitality; החנויות לא מושפעות):
--   1. btree_gist (תוסף סטנדרטי) — מניעת חפיפה במסד עצמו.
--   2. טבלאות 12–18: guests, bookings, booking_nights, booking_events, blocks,
--      unit_occupancy (EXCLUDE: אותה יחידה פיזית לא נתפסת פעמיים באותו לילה),
--      notifications (תור מיילים — נכתב באותה טרנזקציה, לא נשלח בשלב הזה).
--   3. מכונת מצבים (טריגר), סנכרון תפוסה (טריגר, כולל "כל המתחם"), היסטוריה
--      לכל שינוי סטטוס (טריגר), ובדיקת עקביות בסוף כל טרנזקציה (לילות, מחיר,
--      תפוסה מול סטטוס) — אין הזמנה חלקית.
--   4. מחיר לפי לילה, מבצעים, מדיניות ביטול עם לוח זמנים מוחלט (snapshot),
--      דמי ביטול לפי זמן הבקשה של האורח (שעון המסד).
--   5. פונקציות לאורחים (request_tenant + טוקן / זהות מאומתת), לבעלים (can()),
--      ולמערכת (service_role): תפוגה, תזכורות, תור המיילים, פרטיות.
--   כל השעות והמועדים — לפי now() של המסד. אין תשלומים, אין החזרים, אין שליחה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101120000_hosp_booking.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. הגדרות: מונה מספרי הזמנה, שמירת נתוני אורחים רק כשהוגדרה
-- ------------------------------------------------------------
ALTER TABLE hospitality.settings
  ADD COLUMN IF NOT EXISTS last_booking_number integer NOT NULL DEFAULT 1000 CHECK (last_booking_number >= 1000);
-- מחיקת נתוני אורחים אוטומטית רק כשהעסק הגדיר תקופה (ברירת מחדל: לא מוחקים)
ALTER TABLE hospitality.settings ALTER COLUMN guest_retention_months DROP NOT NULL;
ALTER TABLE hospitality.settings ALTER COLUMN guest_retention_months SET DEFAULT NULL;
-- הצוות מעדכן את ההגדרות — אבל לא את המונה
REVOKE UPDATE ON hospitality.settings FROM authenticated;
GRANT UPDATE (business_name, contact_phone, contact_email, whatsapp_phone, address, check_in_time,
              check_out_time, booking_mode, approval_window_minutes, approval_reminder_pct,
              max_open_requests, payment_hold_minutes, weekend_nights, currency, timezone,
              guest_retention_months, notification_emails)
  ON hospitality.settings TO authenticated;

-- ------------------------------------------------------------
-- 2. עזרים טהורים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.normalize_email(_email text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN lower(btrim(_email)) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN lower(btrim(_email)) END;
$$;

-- ספרות בלבד; 972… → 0…
CREATE OR REPLACE FUNCTION hospitality.normalize_phone(_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN d ~ '^[0-9]{9,15}$' THEN d END
    FROM (SELECT CASE WHEN x LIKE '972%' THEN '0' || substr(x, 4) ELSE x END AS d
            FROM (SELECT regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g') AS x) a) b;
$$;

-- זמן כטקסט UTC קבוע (לא תלוי באזור הזמן של החיבור — ה-snapshot וה-hash יציבים)
CREATE OR REPLACE FUNCTION hospitality._ts(_at timestamptz)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_char(_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
$$;

CREATE OR REPLACE FUNCTION hospitality._fee_amount(_kind text, _value numeric, _total numeric, _deposit numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT least(_total, greatest(0, CASE _kind
    WHEN 'none' THEN 0
    WHEN 'percent_total' THEN round(_total * _value / 100, 2)
    WHEN 'percent_deposit' THEN round(_deposit * _value / 100, 2)
    WHEN 'fixed' THEN _value
    WHEN 'deposit' THEN _deposit
    WHEN 'full' THEN _total
    ELSE _total END));
$$;

-- לוח הזמנים המוחלט של מדיניות ביטול להזמנה מסוימת:
--   • עד free_until — ביטול חינם (אם יש חלון כזה);
--   • אחריו — המדרגות לפי הסדר (הראשונה מתחילה בסוף החלון החינמי, או מיד
--     אם אין חלון); בלי מדרגות — הסכום המלא;
--   • המועד = N ימים לפני ההגעה, בשעת הביטול (ברירת מחדל: שעת הצ'ק-אין),
--     באזור הזמן של העסק (כולל מעבר שעון).
CREATE OR REPLACE FUNCTION hospitality.policy_schedule(_rules jsonb, _check_in date, _tz text,
                                                       _check_in_time time, _total numeric, _deposit numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
DECLARE
  _cut time := COALESCE((_rules ->> 'free_cancel_time')::time, _check_in_time);
  _arrival timestamptz := (_check_in + _check_in_time) AT TIME ZONE _tz;
  _free_until timestamptz;
  _tiers jsonb := COALESCE(_rules -> 'fee_tiers', '[]'::jsonb);
  _n integer := jsonb_array_length(COALESCE(_rules -> 'fee_tiers', '[]'::jsonb));
  _periods jsonb := '[]'::jsonb;
  _from timestamptz;
  _until timestamptz;
  _tier jsonb;
  i integer;
BEGIN
  IF _rules ->> 'free_cancel_days' IS NOT NULL THEN
    _free_until := ((_check_in - (_rules ->> 'free_cancel_days')::integer) + _cut) AT TIME ZONE _tz;
    _periods := _periods || jsonb_build_array(jsonb_build_object(
      'from', NULL, 'until', hospitality._ts(_free_until), 'fee', 0, 'kind', 'free'));
  END IF;
  _from := _free_until;
  IF _n = 0 THEN
    _periods := _periods || jsonb_build_array(jsonb_build_object(
      'from', hospitality._ts(_from), 'until', NULL, 'fee', _total, 'kind', 'full'));
  ELSE
    FOR i IN 0 .. _n - 1 LOOP
      _tier := _tiers -> i;
      _until := CASE WHEN i < _n - 1
                     THEN ((_check_in - ((_tiers -> (i + 1)) ->> 'from_days')::integer) + _cut) AT TIME ZONE _tz END;
      _periods := _periods || jsonb_build_array(jsonb_build_object(
        'from', hospitality._ts(_from), 'until', hospitality._ts(_until),
        'fee', hospitality._fee_amount(_tier ->> 'fee', COALESCE((_tier ->> 'value')::numeric, 0), _total, _deposit),
        'kind', _tier ->> 'fee', 'from_days', (_tier ->> 'from_days')::integer));
      _from := _until;
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'arrival', hospitality._ts(_arrival),
    'free_until', hospitality._ts(_free_until),
    'periods', _periods,
    'no_show_fee', hospitality._fee_amount(_rules ->> 'no_show_fee', COALESCE((_rules ->> 'no_show_value')::numeric, 0), _total, _deposit),
    'total', _total,
    'deposit_amount', _deposit);
END $$;

-- התקופה במועד נתון (התקופות מכסות את כל ציר הזמן — בדיוק אחת מתאימה)
CREATE OR REPLACE FUNCTION hospitality.fee_at(_schedule jsonb, _at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('period_index', e.ord - 1, 'fee', (e.p ->> 'fee')::numeric, 'kind', e.p ->> 'kind',
                            'from', e.p -> 'from', 'until', e.p -> 'until')
    FROM jsonb_array_elements(_schedule -> 'periods') WITH ORDINALITY AS e(p, ord)
   WHERE ((e.p ->> 'from') IS NULL OR (e.p ->> 'from')::timestamptz <= _at)
     AND ((e.p ->> 'until') IS NULL OR _at < (e.p ->> 'until')::timestamptz)
   ORDER BY e.ord
   LIMIT 1;
$$;

-- snapshot של מדיניות להזמנה: הכללים, הגרסה ולוח הזמנים המוחלט. ה-hash (בלי
-- זמן החישוב) הוא מה שהאורח מאשר.
CREATE OR REPLACE FUNCTION hospitality._snapshot(_policy_id uuid, _version integer, _name text, _rules jsonb,
                                                 _tz text, _check_in_time time, _currency text,
                                                 _check_in date, _total numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _deposit numeric := CASE _rules ->> 'deposit_kind'
                        WHEN 'percent' THEN round(_total * (_rules ->> 'deposit_value')::numeric / 100, 2)
                        WHEN 'fixed' THEN least((_rules ->> 'deposit_value')::numeric, _total)
                        ELSE 0 END;
BEGIN
  RETURN jsonb_build_object(
    'policy_id', _policy_id, 'version', _version, 'name', _name, 'rules', _rules,
    'timezone', _tz, 'check_in_time', to_char(_check_in_time, 'HH24:MI'), 'currency', _currency,
    'total', _total, 'deposit_amount', _deposit,
    'schedule', hospitality.policy_schedule(_rules, _check_in, _tz, _check_in_time, _total, _deposit));
END $$;

CREATE OR REPLACE FUNCTION hospitality._policy_rules(_p hospitality.policies)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'deposit_kind', _p.deposit_kind, 'deposit_value', _p.deposit_value, 'deposit_due', _p.deposit_due,
    'free_cancel_days', _p.free_cancel_days, 'free_cancel_time', to_char(_p.free_cancel_time, 'HH24:MI'),
    'fee_tiers', _p.fee_tiers, 'no_show_fee', _p.no_show_fee, 'no_show_value', _p.no_show_value,
    'auto_cancel', _p.auto_cancel, 'guest_text', _p.guest_text, 'house_rules', _p.house_rules);
$$;

CREATE OR REPLACE FUNCTION hospitality._hash(_doc jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(_doc::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION hospitality._header(_name text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NULLIF(current_setting('request.headers', true), '')::json ->> _name;
$$;

-- ------------------------------------------------------------
-- 3. הטבלאות
-- ------------------------------------------------------------

-- 12. guests — כרטיס אורח לכל עסק (לא חבר ב-user_roles; user_id רק בזהות מאומתת)
CREATE TABLE IF NOT EXISTS hospitality.guests (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name         text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  email             text CHECK (email IS NULL OR char_length(email) <= 254),
  email_normalized  text GENERATED ALWAYS AS (hospitality.normalize_email(email)) STORED,
  phone             text CHECK (phone IS NULL OR char_length(phone) <= 30),
  phone_normalized  text GENERATED ALWAYS AS (hospitality.normalize_phone(phone)) STORED,
  notes             text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  anonymized_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (anonymized_at IS NULL OR (email IS NULL AND phone IS NULL AND user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS guests_email_idx ON hospitality.guests (tenant_id, email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS guests_phone_idx ON hospitality.guests (tenant_id, phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS guests_user_idx ON hospitality.guests (user_id) WHERE user_id IS NOT NULL;
COMMENT ON TABLE hospitality.guests IS 'Hospitality: אורחים (לכל עסק בנפרד; לא חברים ב-user_roles)';

-- 13. bookings
CREATE TABLE IF NOT EXISTS hospitality.bookings (
  id                        uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number                    integer NOT NULL CHECK (number > 1000),
  unit_id                   uuid NOT NULL,
  guest_id                  uuid NOT NULL,
  check_in                  date NOT NULL,
  check_out                 date NOT NULL,
  nights                    integer GENERATED ALWAYS AS (check_out - check_in) STORED,
  adults                    smallint NOT NULL DEFAULT 2 CHECK (adults BETWEEN 1 AND 100),
  children                  smallint NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 100),
  status                    text NOT NULL CHECK (status IN ('pending_approval', 'pending_payment', 'confirmed',
                              'cancel_requested', 'checked_in', 'checked_out', 'declined', 'cancelled', 'expired', 'no_show')),
  hold_expires_at           timestamptz,
  reminder_due_at           timestamptz,
  source                    text NOT NULL DEFAULT 'site' CHECK (source IN ('site', 'phone', 'walk_in', 'owner', 'external')),
  channel                   text CHECK (channel IS NULL OR char_length(channel) <= 60),
  idempotency_key           text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
  currency                  text NOT NULL DEFAULT 'ILS' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal                  numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount                  numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total                     numeric(12,2) NOT NULL CHECK (total >= 0),
  deposit_amount            numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  amount_paid               numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status            text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'deposit_paid', 'paid')),
  price_manual              boolean NOT NULL DEFAULT false,
  promotion_id              uuid,
  policy_id                 uuid,
  policy_snapshot           jsonb NOT NULL,
  policy_acceptance         jsonb NOT NULL,
  cancellation_requested_at timestamptz,
  cancellation_reason       text CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 1000),
  cancellation_outcome      jsonb,
  fee_override              jsonb,
  revision                  integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  manage_token_hash         text CHECK (manage_token_hash IS NULL OR manage_token_hash ~ '^[0-9a-f]{64}$'),
  manage_token_expires_at   timestamptz,
  notes                     text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  special_requests          text CHECK (special_requests IS NULL OR char_length(special_requests) <= 2000),
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  CHECK (check_out > check_in AND check_out - check_in <= 60),
  CHECK (discount <= subtotal AND total = subtotal - discount),
  CHECK (deposit_amount <= total),
  -- בקשה / המתנה לתשלום — תמיד עם מועד תפוגה (שעון המסד); אחרת בלי
  CHECK ((status IN ('pending_approval', 'pending_payment')) = (hold_expires_at IS NOT NULL)),
  CHECK ((manage_token_hash IS NULL) = (manage_token_expires_at IS NULL)),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES hospitality.guests (tenant_id, id),
  FOREIGN KEY (tenant_id, promotion_id) REFERENCES hospitality.promotions (tenant_id, id) ON DELETE SET NULL (promotion_id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES hospitality.policies (tenant_id, id) ON DELETE SET NULL (policy_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key ON hospitality.bookings (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_manage_token ON hospitality.bookings (manage_token_hash) WHERE manage_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_holds_idx ON hospitality.bookings (hold_expires_at) WHERE hold_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_guest_idx ON hospitality.bookings (tenant_id, guest_id);
CREATE INDEX IF NOT EXISTS bookings_unit_idx ON hospitality.bookings (tenant_id, unit_id, check_in);
CREATE INDEX IF NOT EXISTS bookings_promotion_idx ON hospitality.bookings (tenant_id, promotion_id) WHERE promotion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_policy_idx ON hospitality.bookings (tenant_id, policy_id) WHERE policy_id IS NOT NULL;
COMMENT ON TABLE hospitality.bookings IS 'Hospitality: הזמנות (כתיבה רק דרך הפונקציות)';

-- 14. booking_nights — מחיר נעול לכל לילה
CREATE TABLE IF NOT EXISTS hospitality.booking_nights (
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id   uuid NOT NULL,
  night        date NOT NULL,
  base_rate    numeric(12,2) NOT NULL CHECK (base_rate >= 0),
  extras       numeric(12,2) NOT NULL DEFAULT 0 CHECK (extras >= 0),
  price        numeric(12,2) NOT NULL CHECK (price >= 0),
  rule_applied text NOT NULL CHECK (rule_applied IN ('base', 'weekday', 'weekend', 'season', 'holiday', 'manual')),
  rule_id      uuid,
  PRIMARY KEY (tenant_id, booking_id, night),
  CHECK (price = base_rate + extras),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.booking_nights IS 'Hospitality: מחיר נעול לכל לילה בהזמנה';

-- 15. booking_events — היסטוריה (רק הוספה)
CREATE TABLE IF NOT EXISTS hospitality.booking_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
  from_status text,
  to_status   text,
  actor_kind  text NOT NULL CHECK (actor_kind IN ('guest', 'staff', 'system')),
  actor_id    uuid,
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(changes) <= 4096),
  note        text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS booking_events_booking_idx ON hospitality.booking_events (tenant_id, booking_id, id);
COMMENT ON TABLE hospitality.booking_events IS 'Hospitality: היסטוריית ההזמנה (לא ניתנת לעריכה)';

-- 16. blocks — חסימות של הבעלים
CREATE TABLE IF NOT EXISTS hospitality.blocks (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id     uuid NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 300),
  released_at timestamptz,
  created_by  uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (end_date > start_date AND end_date - start_date <= 366),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS blocks_unit_idx ON hospitality.blocks (tenant_id, unit_id, start_date);
COMMENT ON TABLE hospitality.blocks IS 'Hospitality: חסימות תאריכים של הבעלים';

-- 17. unit_occupancy — פנימי: יחידה פיזית × טווח לילות [check_in, check_out)
--     לכל הזמנה / חסימה שתופסת מלאי. "כל המתחם" תופס גם את כל היחידות שבו.
--     ה-EXCLUDE הוא הסמכות הסופית: גם כתיבה שעוקפת את הפונקציות לא תיצור חפיפה.
CREATE TABLE IF NOT EXISTS hospitality.unit_occupancy (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL,
  nights     daterange NOT NULL CHECK (NOT isempty(nights) AND lower_inc(nights) AND NOT upper_inc(nights)
                                       AND NOT lower_inf(nights) AND NOT upper_inf(nights)),
  booking_id uuid,
  block_id   uuid,
  CHECK (num_nonnulls(booking_id, block_id) = 1),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES hospitality.units (tenant_id, id),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, block_id) REFERENCES hospitality.blocks (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT unit_occupancy_no_overlap EXCLUDE USING gist (tenant_id WITH =, unit_id WITH =, nights WITH &&)
);
CREATE INDEX IF NOT EXISTS unit_occupancy_booking_idx ON hospitality.unit_occupancy (tenant_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unit_occupancy_block_idx ON hospitality.unit_occupancy (tenant_id, block_id) WHERE block_id IS NOT NULL;
COMMENT ON TABLE hospitality.unit_occupancy IS 'Hospitality: תפוסת מלאי פנימית (EXCLUDE מונע הזמנה כפולה)';

-- 18. notifications — תור מיילים (נכתב באותה טרנזקציה; לא נשלח בשלב הזה)
CREATE TABLE IF NOT EXISTS hospitality.notifications (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  booking_id          uuid,
  event               text NOT NULL CHECK (event ~ '^[a-z_]{3,40}$'),
  recipient_kind      text NOT NULL CHECK (recipient_kind IN ('owner', 'guest')),
  recipient_email     text NOT NULL CHECK (recipient_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  dedupe_key          text NOT NULL UNIQUE CHECK (char_length(dedupe_key) <= 400),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(payload) <= 8192),
  status              text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'dead')),
  attempts            smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  locked_until        timestamptz,
  last_error          text CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  provider_message_id text CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, booking_id) REFERENCES hospitality.bookings (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS notifications_due_idx ON hospitality.notifications (next_attempt_at) WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS notifications_sending_idx ON hospitality.notifications (locked_until) WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS notifications_booking_idx ON hospitality.notifications (tenant_id, booking_id);
COMMENT ON TABLE hospitality.notifications IS 'Hospitality: תור מיילים (outbox) עם מפתח כפילות';

-- ------------------------------------------------------------
-- 4. RLS, הרשאות וטריגרים משותפים
-- ------------------------------------------------------------
-- הצוות: קריאה בלבד (כתיבה דרך הפונקציות), חוץ מחסימות (קריאה / הוספה / עדכון).
-- אורחים: אין גישה לטבלאות בכלל — רק פונקציות DEFINER.
DO $$
DECLARE
  _t record;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('guests', 'guests', 'SELECT', true),
      ('bookings', 'bookings', 'SELECT', false),
      ('booking_nights', 'bookings', 'SELECT', false),
      ('booking_events', 'bookings', 'SELECT', false),
      ('blocks', 'bookings', 'SELECT, INSERT, UPDATE', true),
      ('unit_occupancy', 'bookings', 'SELECT', false),
      ('notifications', 'bookings', 'SELECT', false)
    ) AS v(tbl, perm, grants, touch)
  LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _t.tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated', _t.tbl);
    EXECUTE format('GRANT %s ON hospitality.%I TO authenticated', _t.grants, _t.tbl);
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
    IF _t.touch THEN
      EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON hospitality.%I', _t.tbl);
      EXECUTE format($g$CREATE TRIGGER touch_updated_at BEFORE UPDATE ON hospitality.%I
                        FOR EACH ROW EXECUTE FUNCTION hospitality.touch_updated_at()$g$, _t.tbl);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. עזרים פנימיים (בלי הרשאה ל-API)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._holding(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _status IN ('pending_approval', 'pending_payment', 'confirmed', 'cancel_requested', 'checked_in');
$$;

-- היחידות הפיזיות שהזמנה / חסימה של יחידה תופסת: היא עצמה, ו"כל המתחם" — גם כל היחידות שבו
CREATE OR REPLACE FUNCTION hospitality._fanout_units(_tenant_id uuid, _unit_id uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ARRAY[_unit_id] || COALESCE((SELECT array_agg(m.member_unit_id ORDER BY m.member_unit_id)
                                        FROM hospitality.unit_members m
                                       WHERE m.tenant_id = _tenant_id AND m.parent_unit_id = _unit_id), '{}');
$$;

-- מי פועל ולמה — נרשם בהיסטוריה ע"י הטריגר (actor_id תמיד auth.uid())
CREATE OR REPLACE FUNCTION hospitality._set_actor(_kind text, _note text DEFAULT NULL)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT set_config('hospitality.actor', _kind, true), set_config('hospitality.note', COALESCE(left(_note, 1000), ''), true);
$$;

-- כל פעולה שמשנה מלאי של אתר — אחת אחרי השנייה (הודעות שגיאה ברורות, בלי deadlock).
-- ה-EXCLUDE נשאר הסמכות הסופית גם בלי הנעילה הזו.
CREATE OR REPLACE FUNCTION hospitality._lock_inventory(_tenant_id uuid)
RETURNS void LANGUAGE sql SET search_path = '' AS $$
  SELECT pg_advisory_xact_lock(hashtextextended('hosp-inventory:' || _tenant_id::text, 0));
$$;

-- כתובות המייל של בעל העסק: נמעני ההתראות, אחרת מייל העסק, אחרת מייל הבעלים של
-- האתר, ואם אין — מייל החשבון של הבעלים (המנהל המוגן). בעל העסק תמיד מקבל הודעה.
CREATE OR REPLACE FUNCTION hospitality._owner_emails(_tenant_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
           NULLIF(s.notification_emails, '{}'::text[]),
           CASE WHEN COALESCE(s.contact_email, t.owner_email) IS NOT NULL
                THEN ARRAY[COALESCE(s.contact_email, t.owner_email)] END,
           (SELECT array_agg(lower(ur.email) ORDER BY ur.created_at) FROM public.user_roles ur
             WHERE ur.tenant_id = t.id AND ur.is_protected AND NOT ur.is_blocked),
           '{}'::text[])
    FROM public.tenants t
    LEFT JOIN hospitality.settings s ON s.tenant_id = t.id
   WHERE t.id = _tenant_id;
$$;

-- הוספה לתור המיילים: שורה לכל נמען, מפתח כפילות ייחודי. אירוע שקורה פעם אחת
-- בחיי ההזמנה (_once) — בלי מספר הגרסה; מעבר סטטוס — עם הגרסה שאחריו.
CREATE OR REPLACE FUNCTION hospitality._enqueue(_b hospitality.bookings, _event text, _recipient text,
                                                _extra jsonb DEFAULT '{}'::jsonb, _once boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _emails text[];
  _guest hospitality.guests;
  _unit text;
  _email text;
  _n integer := 0;
  _added integer;
BEGIN
  SELECT * INTO _guest FROM hospitality.guests g WHERE g.tenant_id = _b.tenant_id AND g.id = _b.guest_id;
  SELECT u.name INTO _unit FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
  IF _recipient = 'guest' THEN
    _emails := array_remove(ARRAY[CASE WHEN _guest.anonymized_at IS NULL THEN _guest.email_normalized END], NULL);
  ELSE
    _emails := hospitality._owner_emails(_b.tenant_id);
  END IF;
  FOREACH _email IN ARRAY COALESCE(_emails, '{}') LOOP
    INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
    VALUES (_b.tenant_id, _b.id, _event, _recipient, _email,
            'booking:' || _b.id || ':' || _event || CASE WHEN _once THEN '' ELSE ':r' || _b.revision END || ':' || _email,
            jsonb_build_object('booking_number', _b.number, 'status', _b.status, 'unit_name', _unit,
                               'check_in', _b.check_in, 'check_out', _b.check_out, 'nights', _b.check_out - _b.check_in,
                               'adults', _b.adults, 'children', _b.children, 'guest_name', _guest.full_name,
                               'total', _b.total, 'currency', _b.currency,
                               'hold_expires_at', hospitality._ts(_b.hold_expires_at)) || COALESCE(_extra, '{}'::jsonb))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS _added = ROW_COUNT;
    _n := _n + _added;
  END LOOP;
  RETURN _n;
END $$;

-- תפוגה עצלה: כל בקשה / המתנה לתשלום של האתר שעבר מועדה → expired (התפוסה
-- משתחררת בטריגר, באותה טרנזקציה), מיילים לאורח ולבעלים. בטוח להרצה כפולה.
CREATE OR REPLACE FUNCTION hospitality._expire_due(_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _actor text := current_setting('hospitality.actor', true);
  _note text := current_setting('hospitality.note', true);
  _ids uuid[];
  _b hospitality.bookings;
BEGIN
  SELECT array_agg(b.id ORDER BY b.id) INTO _ids
    FROM hospitality.bookings b
   WHERE b.tenant_id = _tenant_id AND b.status IN ('pending_approval', 'pending_payment')
     AND b.hold_expires_at <= now();
  IF _ids IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM hospitality._set_actor('system', 'פג המועד לאישור');
  WITH upd AS (
    UPDATE hospitality.bookings b SET status = 'expired', hold_expires_at = NULL, reminder_due_at = NULL
     WHERE b.tenant_id = _tenant_id AND b.id = ANY (_ids)
       AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()
    RETURNING b.id)
  SELECT array_agg(id) INTO _ids FROM upd;
  FOR _b IN SELECT * FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.id = ANY (COALESCE(_ids, '{}')) LOOP
    PERFORM hospitality._enqueue(_b, 'request_expired', 'guest', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(_b, 'request_expired_owner', 'owner', '{}'::jsonb, true);
  END LOOP;
  PERFORM set_config('hospitality.actor', COALESCE(_actor, ''), true),
          set_config('hospitality.note', COALESCE(_note, ''), true);
  RETURN COALESCE(cardinality(_ids), 0);
END $$;

-- מחיר לכל לילה: חג > עונה של היחידה > עונה של המתחם / כללית > סוף שבוע >
-- אמצע שבוע > מחיר בסיס; בתוך אותה רמה — היקף ספציפי יותר, עדיפות, החדש.
-- תוספת אורחים מעל התפוסה הבסיסית; רצפה / תקרה.
CREATE OR REPLACE FUNCTION hospitality._price_nights(_tenant_id uuid, _unit_id uuid, _check_in date, _check_out date,
                                                     _adults integer, _children integer)
RETURNS TABLE (night date, base_rate numeric, extras numeric, price numeric, rule_applied text, rule_id uuid,
               rule_min_nights integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH u AS (SELECT * FROM hospitality.units WHERE tenant_id = _tenant_id AND id = _unit_id),
  s AS (SELECT weekend_nights FROM hospitality.settings WHERE tenant_id = _tenant_id),
  n AS (SELECT d::date AS night, extract(dow FROM d)::smallint AS dow
          FROM generate_series(_check_in::timestamp, (_check_out - 1)::timestamp, interval '1 day') d),
  cand AS (
    SELECT n.night, r.id, r.kind, r.price_mode, r.value, r.min_nights, r.priority, r.created_at,
           (CASE r.kind WHEN 'holiday' THEN 50
                        WHEN 'season' THEN CASE WHEN r.unit_id IS NOT NULL THEN 40 ELSE 30 END
                        WHEN 'weekend' THEN 20 ELSE 10 END)
           + CASE WHEN r.unit_id IS NOT NULL THEN 2 WHEN r.property_id IS NOT NULL THEN 1 ELSE 0 END AS rank
      FROM n CROSS JOIN u CROSS JOIN s
      JOIN hospitality.rate_rules r
        ON r.tenant_id = _tenant_id AND r.is_active
       AND (r.unit_id = u.id OR r.property_id = u.property_id OR (r.unit_id IS NULL AND r.property_id IS NULL))
       AND (r.date_from IS NULL OR (n.night >= r.date_from AND n.night < r.date_to))
       AND (r.days_mask & (1 << n.dow)) <> 0
       AND (r.kind <> 'weekend' OR n.dow = ANY (s.weekend_nights))
       AND (r.kind <> 'weekday' OR NOT (n.dow = ANY (s.weekend_nights)))),
  best AS (SELECT DISTINCT ON (c.night) c.* FROM cand c ORDER BY c.night, c.rank DESC, c.priority DESC, c.created_at DESC, c.id),
  mins AS (SELECT max(c.min_nights)::integer AS m FROM cand c)
  SELECT n.night, rate.r, ext.e, rate.r + ext.e, COALESCE(b.kind, 'base'), b.id, (SELECT m FROM mins)
    FROM n CROSS JOIN u
    LEFT JOIN best b ON b.night = n.night
    CROSS JOIN LATERAL (
      SELECT round(greatest(0, least(
               greatest(raw.p, COALESCE(u.price_floor, raw.p)),
               COALESCE(u.price_ceiling, greatest(raw.p, COALESCE(u.price_floor, raw.p))))), 2) AS r
        FROM (SELECT CASE WHEN b.id IS NULL THEN u.base_price
                          WHEN b.price_mode = 'fixed' THEN b.value
                          WHEN b.price_mode = 'percent' THEN u.base_price * (1 + b.value / 100)
                          ELSE u.base_price + b.value END AS p) raw) rate
    CROSS JOIN LATERAL (
      SELECT round(greatest(_adults - u.base_occupancy, 0) * u.extra_adult_price
                   + greatest(_children - greatest(u.base_occupancy - _adults, 0), 0) * u.extra_child_price, 2) AS e) ext
   ORDER BY n.night;
$$;

-- מדיניות הביטול שחלה: בחירה ידנית → כלל עונה / חג עם מדיניות (העדיפות הגבוהה)
-- → מדיניות היחידה → ברירת המחדל
CREATE OR REPLACE FUNCTION hospitality._resolve_policy(_tenant_id uuid, _unit_id uuid, _check_in date, _check_out date,
                                                       _manual uuid)
RETURNS hospitality.policies
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p hospitality.policies;
  u hospitality.units;
BEGIN
  IF _manual IS NOT NULL THEN
    SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _tenant_id AND x.id = _manual AND NOT x.is_archived;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    RETURN p;
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _tenant_id AND x.id = _unit_id;
  SELECT x.* INTO p
    FROM hospitality.rate_rules r
    JOIN hospitality.policies x ON x.tenant_id = r.tenant_id AND x.id = r.policy_id AND NOT x.is_archived
   WHERE r.tenant_id = _tenant_id AND r.is_active AND r.kind IN ('season', 'holiday')
     AND (r.unit_id = u.id OR r.property_id = u.property_id OR (r.unit_id IS NULL AND r.property_id IS NULL))
     AND daterange(r.date_from, r.date_to) && daterange(_check_in, _check_out)
   ORDER BY r.priority DESC, r.created_at DESC, r.id
   LIMIT 1;
  IF FOUND THEN
    RETURN p;
  END IF;
  IF u.policy_id IS NOT NULL THEN
    SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _tenant_id AND x.id = u.policy_id AND NOT x.is_archived;
    IF FOUND THEN
      RETURN p;
    END IF;
  END IF;
  SELECT * INTO p FROM hospitality.policies x WHERE x.tenant_id = _tenant_id AND x.is_default;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'לא הוגדרה מדיניות ביטול לעסק' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN p;
END $$;

-- הצעת מחיר: מחיר לכל לילה, מבצע, זמינות (בקשה שפג תוקפה = פנוי), מדיניות + לוח זמנים.
-- _guest_mode: כללים של האתר הציבורי (יחידה ומתחם פעילים, תאריך עתידי, מינימום לילות).
CREATE OR REPLACE FUNCTION hospitality._quote(_tenant_id uuid, _unit_id uuid, _check_in date, _check_out date,
                                              _adults integer, _children integer, _promo_code text,
                                              _guest_mode boolean, _policy_id uuid DEFAULT NULL,
                                              _exclude_booking uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  s hospitality.settings;
  u hospitality.units;
  pr hospitality.properties;
  pol hospitality.policies;
  _code text := NULLIF(upper(btrim(COALESCE(_promo_code, ''))), '');
  _today date;
  _nights jsonb;
  _subtotal numeric;
  _rule_min integer;
  _min integer;
  _promo_id uuid;
  _discount numeric := 0;
  _total numeric;
  _available boolean;
  _snapshot jsonb;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האתר עדיין לא הוגדר' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _tenant_id AND x.id = _unit_id;
  SELECT * INTO pr FROM hospitality.properties x WHERE x.tenant_id = _tenant_id AND x.id = u.property_id;
  IF u.id IS NULL OR (_guest_mode AND (NOT u.is_active OR pr.status <> 'active')) THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _check_in IS NULL OR _check_out IS NULL OR _check_out <= _check_in THEN
    RAISE EXCEPTION 'תאריכי השהייה לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  IF _check_out - _check_in > 60 THEN
    RAISE EXCEPTION 'אפשר להזמין עד 60 לילות' USING ERRCODE = 'check_violation';
  END IF;
  _today := (now() AT TIME ZONE s.timezone)::date;
  IF _guest_mode AND _check_in < _today THEN
    RAISE EXCEPTION 'אי אפשר להזמין לתאריך שעבר' USING ERRCODE = 'check_violation';
  END IF;
  IF _guest_mode AND _check_in > _today + 730 THEN
    RAISE EXCEPTION 'אפשר להזמין עד שנתיים מראש' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_adults, 0) < 1 OR COALESCE(_children, -1) < 0 OR _adults + _children > u.capacity THEN
    RAISE EXCEPTION 'מספר האורחים לא מתאים ליחידה (עד % אורחים)', u.capacity USING ERRCODE = 'check_violation';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('night', p.night, 'base_rate', p.base_rate, 'extras', p.extras, 'price', p.price,
                                      'rule_applied', p.rule_applied, 'rule_id', p.rule_id) ORDER BY p.night),
         sum(p.price), max(p.rule_min_nights)
    INTO _nights, _subtotal, _rule_min
    FROM hospitality._price_nights(_tenant_id, _unit_id, _check_in, _check_out, _adults, _children) p;
  _min := greatest(u.min_nights, COALESCE(_rule_min, 0));
  IF _guest_mode AND _check_out - _check_in < _min THEN
    RAISE EXCEPTION 'בתאריכים האלה אפשר להזמין לפחות % לילות', _min USING ERRCODE = 'check_violation';
  END IF;

  SELECT x.id, x.disc INTO _promo_id, _discount
    FROM (SELECT p.id, CASE p.discount_kind WHEN 'percent' THEN round(_subtotal * p.value / 100, 2)
                                            ELSE least(p.value, _subtotal) END AS disc
            FROM hospitality.promotions p
           WHERE p.tenant_id = _tenant_id AND p.is_active
             AND (p.unit_id = u.id OR p.property_id = u.property_id OR (p.unit_id IS NULL AND p.property_id IS NULL))
             AND (p.stay_from IS NULL OR _check_in >= p.stay_from) AND (p.stay_to IS NULL OR _check_out <= p.stay_to)
             AND (p.book_from IS NULL OR now() >= p.book_from) AND (p.book_to IS NULL OR now() < p.book_to)
             AND (p.min_nights IS NULL OR _check_out - _check_in >= p.min_nights)
             AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit)
             AND CASE WHEN _code IS NULL THEN p.code IS NULL ELSE p.code = _code END) x
   ORDER BY x.disc DESC, x.id
   LIMIT 1;
  IF _code IS NOT NULL AND _promo_id IS NULL THEN
    RAISE EXCEPTION 'קוד הקופון לא תקף לתאריכים האלה' USING ERRCODE = 'check_violation';
  END IF;
  _discount := COALESCE(_discount, 0);
  _total := _subtotal - _discount;

  _available := NOT EXISTS (
    SELECT 1 FROM hospitality.unit_occupancy o
      LEFT JOIN hospitality.bookings b ON b.tenant_id = o.tenant_id AND b.id = o.booking_id
     WHERE o.tenant_id = _tenant_id
       AND o.unit_id = ANY (hospitality._fanout_units(_tenant_id, _unit_id))
       AND o.nights && daterange(_check_in, _check_out)
       AND o.booking_id IS DISTINCT FROM _exclude_booking
       AND NOT COALESCE(b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now(), false));

  pol := hospitality._resolve_policy(_tenant_id, _unit_id, _check_in, _check_out, _policy_id);
  _snapshot := hospitality._snapshot(pol.id, pol.version, pol.name, hospitality._policy_rules(pol),
                                     s.timezone, s.check_in_time, s.currency, _check_in, _total);
  RETURN jsonb_build_object(
    'available', _available, 'unit_id', u.id, 'unit_name', u.name, 'unit_kind', u.kind,
    'check_in', _check_in, 'check_out', _check_out, 'nights_count', _check_out - _check_in,
    'adults', _adults, 'children', _children, 'min_nights', _min, 'nights', _nights,
    'subtotal', _subtotal, 'discount', _discount, 'promotion_id', _promo_id, 'total', _total,
    'currency', s.currency, 'deposit_amount', _snapshot -> 'deposit_amount',
    'policy', _snapshot, 'policy_hash', hospitality._hash(_snapshot));
END $$;

-- יצירת הזמנה (משותף לאתר ולהזמנה ידנית): מספר, הזמנה, לילות נעולים, קופון.
-- התפוסה וההיסטוריה — בטריגרים, באותה טרנזקציה. קורא לפונקציה מחזיק בנעילת המלאי.
CREATE OR REPLACE FUNCTION hospitality._create_booking(_tenant_id uuid, _q jsonb, _guest_id uuid, _status text,
                                                       _source text, _channel text, _manual_total numeric,
                                                       _snapshot jsonb, _acceptance jsonb, _idempotency_key text,
                                                       _notes text, _special text, _token_hash text)
RETURNS hospitality.bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  s hospitality.settings;
  b hospitality.bookings;
  _number integer;
  _n integer := (_q ->> 'nights_count')::integer;
  _total numeric := COALESCE(_manual_total, (_q ->> 'total')::numeric);
  _subtotal numeric := COALESCE(_manual_total, (_q ->> 'subtotal')::numeric);
  _discount numeric := CASE WHEN _manual_total IS NULL THEN (_q ->> 'discount')::numeric ELSE 0 END;
  _promo uuid := CASE WHEN _manual_total IS NULL THEN (_q ->> 'promotion_id')::uuid END;
  _per numeric;
BEGIN
  UPDATE hospitality.settings x SET last_booking_number = x.last_booking_number + 1
   WHERE x.tenant_id = _tenant_id
  RETURNING * INTO s;
  _number := s.last_booking_number;

  INSERT INTO hospitality.bookings (
    tenant_id, number, unit_id, guest_id, check_in, check_out, adults, children, status,
    hold_expires_at, reminder_due_at, source, channel, idempotency_key, currency, subtotal, discount, total,
    deposit_amount, price_manual, promotion_id, policy_id, policy_snapshot, policy_acceptance,
    manage_token_hash, manage_token_expires_at, notes, special_requests, created_by)
  VALUES (
    _tenant_id, _number, (_q ->> 'unit_id')::uuid, _guest_id, (_q ->> 'check_in')::date, (_q ->> 'check_out')::date,
    (_q ->> 'adults')::smallint, (_q ->> 'children')::smallint, _status,
    CASE _status WHEN 'pending_approval' THEN now() + make_interval(mins => s.approval_window_minutes)
                 WHEN 'pending_payment' THEN now() + make_interval(mins => s.payment_hold_minutes) END,
    CASE WHEN _status = 'pending_approval'
         THEN now() + make_interval(mins => s.approval_window_minutes * s.approval_reminder_pct / 100) END,
    _source, NULLIF(btrim(_channel), ''), _idempotency_key, s.currency, _subtotal, _discount, _total,
    (_snapshot ->> 'deposit_amount')::numeric, _manual_total IS NOT NULL, _promo,
    (_snapshot ->> 'policy_id')::uuid, _snapshot, _acceptance,
    _token_hash,
    CASE WHEN _token_hash IS NOT NULL
         THEN (((_q ->> 'check_out')::date + 31)::timestamp) AT TIME ZONE s.timezone END,
    NULLIF(btrim(_notes), ''), NULLIF(btrim(_special), ''), auth.uid())
  RETURNING * INTO b;

  IF _manual_total IS NULL THEN
    INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, extras, price, rule_applied, rule_id)
    SELECT _tenant_id, b.id, (x ->> 'night')::date, (x ->> 'base_rate')::numeric, (x ->> 'extras')::numeric,
           (x ->> 'price')::numeric, x ->> 'rule_applied', (x ->> 'rule_id')::uuid
      FROM jsonb_array_elements(_q -> 'nights') x;
  ELSE
    -- מחיר ידני: מתחלק בין הלילות (השארית בלילה האחרון)
    _per := trunc(_total / _n, 2);
    INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, extras, price, rule_applied)
    SELECT _tenant_id, b.id, b.check_in + i,
           CASE WHEN i = _n - 1 THEN _total - _per * (_n - 1) ELSE _per END, 0,
           CASE WHEN i = _n - 1 THEN _total - _per * (_n - 1) ELSE _per END, 'manual'
      FROM generate_series(0, _n - 1) i;
  END IF;

  IF _promo IS NOT NULL THEN
    UPDATE hospitality.promotions p SET used_count = p.used_count + 1
     WHERE p.tenant_id = _tenant_id AND p.id = _promo AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הקופון כבר נוצל עד הסוף' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN b;
END $$;

-- תוצאת ביטול במועד נתון לפי ה-snapshot של ההזמנה
CREATE OR REPLACE FUNCTION hospitality._cancellation_outcome(_b hospitality.bookings, _at timestamptz, _by text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _p jsonb := hospitality.fee_at(_b.policy_snapshot -> 'schedule', _at);
  _fee numeric := COALESCE((_p ->> 'fee')::numeric, _b.total);
BEGIN
  RETURN jsonb_build_object(
    'computed_at', hospitality._ts(_at), 'requested_by', _by,
    'period_index', (_p ->> 'period_index')::integer, 'fee_kind', _p ->> 'kind',
    'fee', _fee, 'amount_paid', _b.amount_paid,
    'refund_due', greatest(_b.amount_paid - _fee, 0), 'charge_due', greatest(_fee - _b.amount_paid, 0));
END $$;

-- סיכום הזמנה לאורח (בלי הערות פנימיות ובלי פרטי ביקורת)
CREATE OR REPLACE FUNCTION hospitality._guest_view(_b hospitality.bookings)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', _b.id, 'number', _b.number, 'status', _b.status, 'unit_name', u.name,
    'check_in', _b.check_in, 'check_out', _b.check_out, 'nights', _b.check_out - _b.check_in,
    'adults', _b.adults, 'children', _b.children, 'total', _b.total, 'currency', _b.currency,
    'deposit_amount', _b.deposit_amount, 'amount_paid', _b.amount_paid,
    'hold_expires_at', hospitality._ts(_b.hold_expires_at),
    'policy', _b.policy_snapshot, 'cancellation_outcome', _b.cancellation_outcome,
    'can_request_cancellation', _b.status IN ('pending_approval', 'pending_payment', 'confirmed'))
    FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
$$;

-- ------------------------------------------------------------
-- 6. טריגרים: מצבים, גרסה, תפוסה, היסטוריה, עקביות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.bookings_before_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _allowed text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('pending_approval', 'pending_payment', 'confirmed') THEN
      RAISE EXCEPTION 'הזמנה חדשה לא יכולה להתחיל בסטטוס %', NEW.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.revision := 1;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    _allowed := CASE OLD.status
      WHEN 'pending_approval' THEN ARRAY['confirmed', 'pending_payment', 'declined', 'cancelled', 'expired']
      WHEN 'pending_payment' THEN ARRAY['confirmed', 'cancelled', 'expired']
      WHEN 'confirmed' THEN ARRAY['checked_in', 'cancel_requested', 'cancelled', 'no_show']
      WHEN 'cancel_requested' THEN ARRAY['cancelled', 'confirmed']
      WHEN 'checked_in' THEN ARRAY['checked_out']
      WHEN 'expired' THEN ARRAY['confirmed']
      ELSE '{}'::text[] END;
    IF NOT (NEW.status = ANY (_allowed)) THEN
      RAISE EXCEPTION 'מעבר סטטוס לא חוקי: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_before_write ON hospitality.bookings;
CREATE TRIGGER bookings_before_write BEFORE INSERT OR UPDATE ON hospitality.bookings
FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_before_write();

-- תפוסה לפי הסטטוס (מוחזקת / משוחררת) + שורת היסטוריה לכל שינוי סטטוס.
-- חפיפה → השגיאה של ה-EXCLUDE מתורגמת להודעה ברורה; הטרנזקציה כולה נכשלת.
CREATE OR REPLACE FUNCTION hospitality.bookings_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND hospitality._holding(OLD.status);
  _is boolean := hospitality._holding(NEW.status);
  _actor text := NULLIF(current_setting('hospitality.actor', true), '');
BEGIN
  IF TG_OP = 'INSERT' OR NOT (_was AND _is AND NEW.unit_id = OLD.unit_id
                              AND NEW.check_in = OLD.check_in AND NEW.check_out = OLD.check_out) THEN
    DELETE FROM hospitality.unit_occupancy o WHERE o.tenant_id = NEW.tenant_id AND o.booking_id = NEW.id;
    IF _is THEN
      BEGIN
        INSERT INTO hospitality.unit_occupancy (tenant_id, unit_id, nights, booking_id)
        SELECT NEW.tenant_id, x, daterange(NEW.check_in, NEW.check_out), NEW.id
          FROM unnest(hospitality._fanout_units(NEW.tenant_id, NEW.unit_id)) x;
      EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
      END;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, from_status, to_status, actor_kind, actor_id, note)
    VALUES (NEW.tenant_id, NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'status_changed' END,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
            CASE WHEN _actor IN ('guest', 'staff', 'system') THEN _actor
                 WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END,
            auth.uid(), NULLIF(current_setting('hospitality.note', true), ''));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS bookings_after_write ON hospitality.bookings;
CREATE TRIGGER bookings_after_write AFTER INSERT OR UPDATE OF status, unit_id, check_in, check_out ON hospitality.bookings
FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_after_write();

-- עקביות בסוף הטרנזקציה: לילה נעול לכל לילה בטווח, סכום הלילות = הסכום לפני
-- הנחה, ותפוסה בדיוק לפי הסטטוס. אחרת — כל הטרנזקציה נדחית (אין הזמנה חלקית).
CREATE OR REPLACE FUNCTION hospitality.bookings_consistency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tenant uuid;
  _id uuid;
  b hospitality.bookings;
  _count integer;
  _sum numeric;
  _outside boolean;
  _occ integer;
  _expected integer;
BEGIN
  IF TG_TABLE_NAME = 'bookings' THEN
    _tenant := NEW.tenant_id; _id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    _tenant := OLD.tenant_id; _id := OLD.booking_id;
  ELSE
    _tenant := NEW.tenant_id; _id := NEW.booking_id;
  END IF;
  IF _id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _tenant AND x.id = _id;
  IF NOT FOUND THEN
    RETURN NULL;  -- ההזמנה נמחקה (מחיקת אתר)
  END IF;
  SELECT count(*) FILTER (WHERE n.night >= b.check_in AND n.night < b.check_out),
         COALESCE(sum(n.price), 0),
         bool_or(n.night < b.check_in OR n.night >= b.check_out)
    INTO _count, _sum, _outside
    FROM hospitality.booking_nights n WHERE n.tenant_id = b.tenant_id AND n.booking_id = b.id;
  IF _count <> b.check_out - b.check_in OR COALESCE(_outside, false) OR _sum <> b.subtotal THEN
    RAISE EXCEPTION 'הזמנה % לא עקבית: הלילות או המחיר לא תואמים', b.number USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO _occ FROM hospitality.unit_occupancy o WHERE o.tenant_id = b.tenant_id AND o.booking_id = b.id
     AND o.nights = daterange(b.check_in, b.check_out);
  _expected := CASE WHEN hospitality._holding(b.status)
                    THEN cardinality(hospitality._fanout_units(b.tenant_id, b.unit_id)) ELSE 0 END;
  IF _occ <> _expected OR EXISTS (SELECT 1 FROM hospitality.unit_occupancy o WHERE o.tenant_id = b.tenant_id
                                     AND o.booking_id = b.id AND o.nights <> daterange(b.check_in, b.check_out)) THEN
    RAISE EXCEPTION 'הזמנה % לא עקבית: התפוסה לא תואמת לסטטוס', b.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS bookings_consistency ON hospitality.bookings;
CREATE CONSTRAINT TRIGGER bookings_consistency AFTER INSERT OR UPDATE ON hospitality.bookings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_consistency();
DROP TRIGGER IF EXISTS booking_nights_consistency ON hospitality.booking_nights;
CREATE CONSTRAINT TRIGGER booking_nights_consistency AFTER INSERT OR UPDATE OR DELETE ON hospitality.booking_nights
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_consistency();
DROP TRIGGER IF EXISTS unit_occupancy_consistency ON hospitality.unit_occupancy;
CREATE CONSTRAINT TRIGGER unit_occupancy_consistency AFTER INSERT OR UPDATE OR DELETE ON hospitality.unit_occupancy
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hospitality.bookings_consistency();

-- היסטוריה — רק הוספה (מחיקה רק כחלק ממחיקת ההזמנה / האתר)
CREATE OR REPLACE FUNCTION hospitality.booking_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_catalog.pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'היסטוריית ההזמנה לא ניתנת לשינוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS booking_events_append_only ON hospitality.booking_events;
CREATE TRIGGER booking_events_append_only BEFORE UPDATE OR DELETE ON hospitality.booking_events
FOR EACH ROW EXECUTE FUNCTION hospitality.booking_events_append_only();

-- חסימות: מחזיקות תפוסה עד שמשחררים אותן (released_at). "כל המתחם" — גם היחידות שבו.
CREATE OR REPLACE FUNCTION hospitality.blocks_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._lock_inventory(NEW.tenant_id);
  PERFORM hospitality._expire_due(NEW.tenant_id);
  DELETE FROM hospitality.unit_occupancy o WHERE o.tenant_id = NEW.tenant_id AND o.block_id = NEW.id;
  IF NEW.released_at IS NULL THEN
    BEGIN
      INSERT INTO hospitality.unit_occupancy (tenant_id, unit_id, nights, block_id)
      SELECT NEW.tenant_id, x, daterange(NEW.start_date, NEW.end_date), NEW.id
        FROM unnest(hospitality._fanout_units(NEW.tenant_id, NEW.unit_id)) x;
    EXCEPTION WHEN exclusion_violation THEN
      RAISE EXCEPTION 'יש הזמנה או חסימה בתאריכים האלה' USING ERRCODE = 'exclusion_violation';
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS blocks_after_write ON hospitality.blocks;
CREATE TRIGGER blocks_after_write AFTER INSERT OR UPDATE OF released_at, unit_id, start_date, end_date ON hospitality.blocks
FOR EACH ROW EXECUTE FUNCTION hospitality.blocks_after_write();

-- שחרור חסימה הוא סופי (חסימה חדשה = שורה חדשה)
CREATE OR REPLACE FUNCTION hospitality.blocks_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'החסימה כבר שוחררה' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS blocks_before_update ON hospitality.blocks;
CREATE TRIGGER blocks_before_update BEFORE UPDATE ON hospitality.blocks
FOR EACH ROW EXECUTE FUNCTION hospitality.blocks_before_update();

-- "כל המתחם" עם הזמנות / חסימות עתידיות — לא משנים את היחידות שבו
CREATE OR REPLACE FUNCTION hospitality.unit_members_occupancy_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.parent_unit_id ELSE NEW.parent_unit_id END;
  _tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
BEGIN
  IF pg_catalog.pg_trigger_depth() = 1 AND EXISTS (
       SELECT 1 FROM hospitality.unit_occupancy o
        WHERE o.tenant_id = _tenant AND o.unit_id = _parent AND upper(o.nights) > current_date) THEN
    RAISE EXCEPTION 'יש הזמנות או חסימות עתידיות ל"כל המתחם" — אי אפשר לשנות את היחידות שבו'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS unit_members_occupancy_guard ON hospitality.unit_members;
CREATE TRIGGER unit_members_occupancy_guard BEFORE INSERT OR UPDATE OR DELETE ON hospitality.unit_members
FOR EACH ROW EXECUTE FUNCTION hospitality.unit_members_occupancy_guard();

-- ------------------------------------------------------------
-- 7. פונקציות לאורחים (anon / authenticated, האתר לפי request_tenant)
-- ------------------------------------------------------------
-- האתר של בקשה ציבורית: קיים, אתר אירוח פעיל, והדגלים פתוחים
CREATE OR REPLACE FUNCTION hospitality._public_tenant(_need_booking boolean)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
BEGIN
  IF _t IS NULL OR NOT hospitality.flag_for('hospitality_backend_enabled', _t)
     OR (_need_booking AND NOT hospitality.flag_for('hospitality_booking_enabled', _t)) THEN
    RAISE EXCEPTION 'ההזמנות באתר הזה אינן פעילות' USING ERRCODE = 'feature_not_supported';
  END IF;
  RETURN _t;
END $$;

-- ההזמנה של האורח: טוקן "ניהול ההזמנה" (בתוקף עד 30 יום אחרי היציאה), או אורח
-- מחובר שההזמנה מקושרת אליו (זהות מאומתת). כל כישלון — אותה תשובה: לא נמצאה.
CREATE OR REPLACE FUNCTION hospitality._guest_booking(_tenant_id uuid, _token text, _booking_id uuid, _lock boolean)
RETURNS hospitality.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  IF _token IS NOT NULL THEN
    IF _token ~ '^[0-9a-f]{64}$' THEN
      IF _lock THEN
        SELECT * INTO b FROM hospitality.bookings x
         WHERE x.manage_token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
           AND x.tenant_id = _tenant_id AND x.manage_token_expires_at > now()
         FOR UPDATE;
      ELSE
        SELECT * INTO b FROM hospitality.bookings x
         WHERE x.manage_token_hash = encode(sha256(convert_to(_token, 'UTF8')), 'hex')
           AND x.tenant_id = _tenant_id AND x.manage_token_expires_at > now();
      END IF;
    END IF;
  ELSIF _booking_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT x.* INTO b FROM hospitality.bookings x
      JOIN hospitality.guests g ON g.tenant_id = x.tenant_id AND g.id = x.guest_id
     WHERE x.tenant_id = _tenant_id AND x.id = _booking_id AND g.user_id = auth.uid();
    IF FOUND AND _lock THEN
      SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _tenant_id AND x.id = _booking_id FOR UPDATE;
    END IF;
  END IF;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN b;
END $$;

-- הצעת מחיר. בעלים / מנהל של האתר (can('bookings')) מקבל מחיר גם כשההזמנות
-- באתר סגורות ולכל יחידה; אורח — רק כשהאתר פתוח להזמנות.
CREATE OR REPLACE FUNCTION hospitality.quote(_unit_id uuid, _check_in date, _check_out date,
                                             _adults integer DEFAULT 2, _children integer DEFAULT 0,
                                             _promo_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
  _staff boolean := _t IS NOT NULL AND public.current_tenant_id() = _t AND hospitality.can('bookings')
                    AND hospitality.flag('hospitality_backend_enabled');
BEGIN
  IF NOT _staff THEN
    _t := hospitality._public_tenant(true);
  END IF;
  RETURN hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, _promo_code, NOT _staff);
END $$;

-- בקשת הזמנה מהאתר (בלי חשבון). בטרנזקציה אחת: נעילה לפי איש הקשר (אימייל +
-- טלפון) ותקרת הבקשות הפתוחות, נעילת המלאי, תפוגה עצלה, מחיר מחדש, אישור תנאי
-- הביטול (hash של מה שהוצג), הזמנה + לילות + תפוסה + היסטוריה + מיילים בתור.
-- חוזר עם אותו מפתח (idempotency) → אותה הזמנה, בלי כפילות.
CREATE OR REPLACE FUNCTION hospitality.request_booking(
  _unit_id uuid, _check_in date, _check_out date, _full_name text, _email text, _phone text,
  _idempotency_key text, _policy_accepted boolean, _policy_hash text,
  _adults integer DEFAULT 2, _children integer DEFAULT 0, _special_requests text DEFAULT NULL,
  _promo_code text DEFAULT NULL, _marketing_consent boolean DEFAULT false, _language text DEFAULT 'he')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _e text := hospitality.normalize_email(_email);
  _p text := hospitality.normalize_phone(_phone);
  _name text := btrim(COALESCE(_full_name, ''));
  s hospitality.settings;
  g hospitality.guests;
  b hospitality.bookings;
  _q jsonb;
  _open integer;
  _token text;
  _status text;
  _acceptance jsonb;
BEGIN
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא שם מלא' USING ERRCODE = 'check_violation';
  END IF;
  IF _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _idempotency_key IS NULL OR _idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$' THEN
    RAISE EXCEPTION 'חסר מזהה בקשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_accepted IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר את תנאי הביטול לפני שליחת הבקשה' USING ERRCODE = 'check_violation';
  END IF;

  -- אותו איש קשר — אחת אחרי השנייה (גם לתקרה וגם ל-idempotency); סדר קבוע
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-contact:' || _t || ':' || k, 0))
     FROM unnest(ARRAY['e:' || _e, 'p:' || _p]) k ORDER BY k;

  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.idempotency_key = _idempotency_key;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id AND x.email_normalized = _e) THEN
      RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', true,
                              'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                              'currency', b.currency, 'manage_token', NULL);
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;

  SELECT count(*) INTO _open
    FROM hospitality.bookings x
    JOIN hospitality.guests y ON y.tenant_id = x.tenant_id AND y.id = x.guest_id
   WHERE x.tenant_id = _t AND x.status IN ('pending_approval', 'pending_payment') AND x.hold_expires_at > now()
     AND (y.email_normalized = _e OR y.phone_normalized = _p);
  IF _open >= s.max_open_requests THEN
    RAISE EXCEPTION 'כבר יש % בקשות פתוחות מאותם פרטי קשר — נא להמתין לתשובת העסק', _open
      USING ERRCODE = 'check_violation';
  END IF;

  _q := hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, _promo_code, true);
  IF NOT (_q ->> 'available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
  IF _policy_hash IS DISTINCT FROM _q ->> 'policy_hash' THEN
    RAISE EXCEPTION 'תנאי ההזמנה השתנו — נא לעיין בהם שוב ולאשר' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO g FROM hospitality.guests x
   WHERE x.tenant_id = _t AND x.email_normalized = _e AND x.anonymized_at IS NULL
   ORDER BY x.created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone, marketing_consent)
    VALUES (_t, _name, _e, _phone, COALESCE(_marketing_consent, false))
    RETURNING * INTO g;
  ELSIF _marketing_consent AND NOT g.marketing_consent THEN
    UPDATE hospitality.guests x SET marketing_consent = true WHERE x.id = g.id RETURNING * INTO g;
  END IF;
  -- אורח מחובר עם אותו אימייל מאומת — מקשרים (אימייל שהוקלד בלבד לא מקשר כלום)
  IF auth.uid() IS NOT NULL AND g.user_id IS NULL AND EXISTS (
       SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL
          AND lower(u.email) = _e) THEN
    UPDATE hospitality.guests x SET user_id = auth.uid() WHERE x.id = g.id;
  END IF;

  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  _status := CASE s.booking_mode WHEN 'instant' THEN 'confirmed' ELSE 'pending_approval' END;
  _acceptance := jsonb_build_object(
    'accepted_at', hospitality._ts(now()), 'channel', 'site', 'snapshot_hash', _q ->> 'policy_hash',
    'language', left(COALESCE(_language, 'he'), 10),
    'ip', left(btrim(split_part(COALESCE(hospitality._header('x-forwarded-for'), hospitality._header('x-real-ip'), ''), ',', 1)), 64),
    'user_agent', left(hospitality._header('user-agent'), 300));

  PERFORM hospitality._set_actor('guest', NULL);
  BEGIN
    b := hospitality._create_booking(_t, _q, g.id, _status, 'site', NULL, NULL, _q -> 'policy', _acceptance,
                                     _idempotency_key, NULL, _special_requests,
                                     encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'מזהה הבקשה כבר בשימוש' USING ERRCODE = 'unique_violation';
  END;
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'policy_accepted', 'guest', auth.uid(),
          jsonb_build_object('snapshot_hash', _q ->> 'policy_hash', 'policy_id', _q -> 'policy' -> 'policy_id',
                             'version', _q -> 'policy' -> 'version', 'channel', 'site'));

  IF _status = 'confirmed' THEN
    PERFORM hospitality._enqueue(b, 'new_booking', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest', jsonb_build_object('manage_token', _token), true);
  ELSE
    PERFORM hospitality._enqueue(b, 'new_request', 'owner', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(b, 'request_received', 'guest', jsonb_build_object('manage_token', _token), true);
  END IF;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'duplicate', false,
                            'hold_expires_at', hospitality._ts(b.hold_expires_at), 'total', b.total,
                            'currency', b.currency, 'manage_token', _token);
END $$;

CREATE OR REPLACE FUNCTION hospitality.get_booking_by_token(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  RETURN hospitality._guest_view(hospitality._guest_booking(_t, _token, NULL, false));
END $$;

-- מה יקרה אם האורח יבטל עכשיו (לפי ה-snapshot ושעון המסד) — בלי לשנות דבר
CREATE OR REPLACE FUNCTION hospitality.cancellation_quote(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid;
  b hospitality.bookings;
  _o jsonb;
  _auto text;
BEGIN
  IF _token IS NULL AND _booking_id IS NOT NULL AND public.current_tenant_id() IS NOT NULL
     AND hospitality.can('bookings') AND hospitality.flag('hospitality_backend_enabled')
     AND EXISTS (SELECT 1 FROM hospitality.bookings x WHERE x.tenant_id = public.current_tenant_id() AND x.id = _booking_id) THEN
    SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = public.current_tenant_id() AND x.id = _booking_id;
  ELSE
    _t := hospitality._public_tenant(false);
    b := hospitality._guest_booking(_t, _token, _booking_id, false);
  END IF;
  IF b.status NOT IN ('pending_approval', 'pending_payment', 'confirmed') THEN
    RAISE EXCEPTION 'אי אפשר לבטל הזמנה בסטטוס הזה' USING ERRCODE = 'check_violation';
  END IF;
  IF b.status <> 'confirmed' THEN
    RETURN jsonb_build_object('fee', 0, 'refund_due', b.amount_paid, 'charge_due', 0, 'result', 'cancelled',
                              'computed_at', hospitality._ts(now()), 'kind', 'withdrawn');
  END IF;
  _o := hospitality._cancellation_outcome(b, now(), 'guest');
  _auto := b.policy_snapshot -> 'rules' ->> 'auto_cancel';
  RETURN _o || jsonb_build_object('result',
    CASE WHEN _auto = 'always' OR (_auto = 'within_free_window' AND (_o ->> 'fee')::numeric = 0)
         THEN 'cancelled' ELSE 'cancel_requested' END);
END $$;

-- בקשת ביטול של האורח. דמי הביטול נקבעים לפי זמן הבקשה (שעון המסד) ונשמרים.
-- אישור אוטומטי רק אם המדיניות מאפשרת; אחרת cancel_requested והתאריכים נשארים תפוסים.
CREATE OR REPLACE FUNCTION hospitality.request_cancellation(_token text DEFAULT NULL, _booking_id uuid DEFAULT NULL,
                                                            _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  b hospitality.bookings;
  _o jsonb;
  _auto text;
  _to text;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  b := hospitality._guest_booking(_t, _token, _booking_id, true);
  PERFORM hospitality._set_actor('guest', _reason);
  IF b.status IN ('pending_approval', 'pending_payment') THEN
    -- ביטול בקשה שעוד לא אושרה — בלי דמי ביטול
    UPDATE hospitality.bookings x
       SET status = 'cancelled', hold_expires_at = NULL, reminder_due_at = NULL,
           cancellation_requested_at = now(), cancellation_reason = NULLIF(btrim(_reason), ''),
           cancellation_outcome = jsonb_build_object('computed_at', hospitality._ts(now()), 'requested_by', 'guest',
                                                     'kind', 'withdrawn', 'fee', 0, 'amount_paid', x.amount_paid,
                                                     'refund_due', x.amount_paid, 'charge_due', 0, 'final_fee', 0)
     WHERE x.id = b.id RETURNING * INTO b;
    PERFORM hospitality._enqueue(b, 'request_withdrawn', 'owner');
    PERFORM hospitality._enqueue(b, 'booking_cancelled', 'guest');
  ELSIF b.status = 'confirmed' THEN
    _o := hospitality._cancellation_outcome(b, now(), 'guest');
    _auto := b.policy_snapshot -> 'rules' ->> 'auto_cancel';
    _to := CASE WHEN _auto = 'always' OR (_auto = 'within_free_window' AND (_o ->> 'fee')::numeric = 0)
                THEN 'cancelled' ELSE 'cancel_requested' END;
    UPDATE hospitality.bookings x
       SET status = _to, cancellation_requested_at = now(), cancellation_reason = NULLIF(btrim(_reason), ''),
           cancellation_outcome = _o || CASE WHEN _to = 'cancelled'
                                            THEN jsonb_build_object('final_fee', _o -> 'fee', 'automatic', true)
                                            ELSE '{}'::jsonb END
     WHERE x.id = b.id RETURNING * INTO b;
    IF _to = 'cancelled' THEN
      PERFORM hospitality._enqueue(b, 'cancelled_by_guest', 'owner');
      PERFORM hospitality._enqueue(b, 'booking_cancelled', 'guest');
    ELSE
      PERFORM hospitality._enqueue(b, 'cancellation_requested', 'owner');
      PERFORM hospitality._enqueue(b, 'cancellation_received', 'guest');
    END IF;
  ELSIF b.status = 'cancel_requested' THEN
    RAISE EXCEPTION 'בקשת הביטול כבר נשלחה וממתינה לבעל העסק' USING ERRCODE = 'check_violation';
  ELSE
    RAISE EXCEPTION 'אי אפשר לבטל הזמנה בסטטוס הזה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('', NULL);
  RETURN hospitality._guest_view(b);
END $$;

-- ההזמנות של אורח מחובר באתר הזה (רק כרטיסי אורח שקושרו לזהות מאומתת)
CREATE OR REPLACE FUNCTION hospitality.my_bookings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'נדרשת התחברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(hospitality._guest_view(b) ORDER BY b.check_in DESC)
      FROM hospitality.bookings b
      JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
     WHERE b.tenant_id = _t AND g.user_id = auth.uid()), '[]'::jsonb);
END $$;

-- קישור הזמנות קודמות לאורח המחובר: רק לפי האימייל המאומת של החשבון (מ-auth.users),
-- רק באתר הזה, ורק כרטיסים שעוד לא קושרו. אין פרמטר אימייל — הקלדה לא מקשרת.
CREATE OR REPLACE FUNCTION hospitality.claim_guest_bookings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_tenant(false);
  _email text;
  _n integer;
BEGIN
  SELECT hospitality.normalize_email(u.email) INTO _email
    FROM auth.users u WHERE u.id = auth.uid() AND u.email_confirmed_at IS NOT NULL;
  IF _email IS NULL THEN
    RAISE EXCEPTION 'נדרש חשבון עם אימייל מאומת' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE hospitality.guests g SET user_id = auth.uid()
   WHERE g.tenant_id = _t AND g.email_normalized = _email AND g.user_id IS NULL AND g.anonymized_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ------------------------------------------------------------
-- 8. פונקציות לבעלים / מנהל (can('bookings') / can('guests'), הדגל פעיל)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._staff_tenant(_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := public.current_tenant_id();
BEGIN
  IF _t IS NULL OR NOT hospitality.can(_permission) OR NOT hospitality.flag('hospitality_backend_enabled') THEN
    RAISE EXCEPTION 'אין הרשאה לפעולה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN _t;
END $$;

-- ההזמנה נעולה לעדכון; גרסה צפויה שונה → "עודכנה בינתיים"
CREATE OR REPLACE FUNCTION hospitality._staff_booking(_tenant_id uuid, _booking_id uuid, _expected_revision integer)
RETURNS hospitality.bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _tenant_id AND x.id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected_revision IS NOT NULL AND _expected_revision <> b.revision THEN
    RAISE EXCEPTION 'ההזמנה עודכנה בינתיים — נא לרענן את המסך' USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN b;
END $$;

-- הזמנה ידנית ("הוספת הזמנה"): אותו מנוע זמינות ואותו EXCLUDE; ברירת מחדל confirmed.
CREATE OR REPLACE FUNCTION hospitality.create_manual_booking(
  _unit_id uuid, _check_in date, _check_out date, _full_name text, _phone text,
  _terms_explained boolean, _email text DEFAULT NULL, _adults integer DEFAULT 2, _children integer DEFAULT 0,
  _total_override numeric DEFAULT NULL, _policy_id uuid DEFAULT NULL, _status text DEFAULT 'confirmed',
  _source text DEFAULT 'phone', _channel text DEFAULT NULL, _notes text DEFAULT NULL,
  _send_guest_email boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  _e text := hospitality.normalize_email(_email);
  _p text := hospitality.normalize_phone(_phone);
  _name text := btrim(COALESCE(_full_name, ''));
  s hospitality.settings;
  g hospitality.guests;
  b hospitality.bookings;
  _q jsonb;
  _snapshot jsonb;
  _token text;
BEGIN
  IF _terms_explained IS NOT TRUE THEN
    RAISE EXCEPTION 'יש לאשר שתנאי הביטול הוסברו ללקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _status NOT IN ('confirmed', 'pending_approval') THEN
    RAISE EXCEPTION 'סטטוס לא מתאים להזמנה ידנית' USING ERRCODE = 'check_violation';
  END IF;
  IF _source NOT IN ('phone', 'walk_in', 'owner', 'external') THEN
    RAISE EXCEPTION 'מקור ההזמנה לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'נא למלא את שם האורח' USING ERRCODE = 'check_violation';
  END IF;
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _email IS NOT NULL AND btrim(_email) <> '' AND _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _total_override IS NOT NULL AND _total_override < 0 THEN
    RAISE EXCEPTION 'המחיר לא יכול להיות שלילי' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  _q := hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, NULL, false, _policy_id);
  IF NOT (_q ->> 'available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
  _snapshot := _q -> 'policy';
  IF _total_override IS NOT NULL THEN
    _snapshot := hospitality._snapshot((_snapshot ->> 'policy_id')::uuid, (_snapshot ->> 'version')::integer,
                                       _snapshot ->> 'name', _snapshot -> 'rules', s.timezone, s.check_in_time,
                                       s.currency, _check_in, _total_override);
  END IF;

  SELECT * INTO g FROM hospitality.guests x
   WHERE x.tenant_id = _t AND x.anonymized_at IS NULL
     AND ((_e IS NOT NULL AND x.email_normalized = _e) OR (_e IS NULL AND x.phone_normalized = _p))
   ORDER BY x.created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone)
    VALUES (_t, _name, _e, _phone) RETURNING * INTO g;
  END IF;

  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  PERFORM hospitality._set_actor('staff', NULL);
  b := hospitality._create_booking(
    _t, _q, g.id, _status, _source, _channel, _total_override, _snapshot,
    jsonb_build_object('accepted_at', hospitality._ts(now()), 'channel', 'owner_phone',
                       'snapshot_hash', hospitality._hash(_snapshot), 'recorded_by', auth.uid()),
    NULL, _notes, NULL, encode(sha256(convert_to(_token, 'UTF8')), 'hex'));
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes)
  VALUES (_t, b.id, 'policy_accepted', 'staff', auth.uid(),
          jsonb_build_object('snapshot_hash', hospitality._hash(_snapshot), 'channel', 'owner_phone',
                             'policy_id', _snapshot -> 'policy_id', 'version', _snapshot -> 'version',
                             'manual_price', _total_override IS NOT NULL));
  IF _send_guest_email AND g.email_normalized IS NOT NULL THEN
    PERFORM hospitality._enqueue(b, CASE WHEN _status = 'confirmed' THEN 'booking_confirmed' ELSE 'request_received' END,
                                 'guest', jsonb_build_object('manage_token', _token), true);
  END IF;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'number', b.number, 'status', b.status, 'total', b.total,
                            'revision', b.revision, 'manage_token', CASE WHEN _send_guest_email THEN NULL ELSE _token END);
END $$;

-- אישור בקשה (גם בקשה שפג תוקפה — רק אם התאריכים עדיין פנויים; ה-EXCLUDE מכריע)
CREATE OR REPLACE FUNCTION hospitality.approve_booking(_booking_id uuid, _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  PERFORM hospitality._expire_due(_t);
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _booking_id;
  IF b.status NOT IN ('pending_approval', 'expired') THEN
    RAISE EXCEPTION 'אפשר לאשר רק בקשה שממתינה לאישור' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('staff', NULL);
  UPDATE hospitality.bookings x SET status = 'confirmed', hold_expires_at = NULL, reminder_due_at = NULL
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest');
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

CREATE OR REPLACE FUNCTION hospitality.decline_booking(_booking_id uuid, _reason text DEFAULT NULL,
                                                       _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  IF b.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'אפשר לדחות רק בקשה שממתינה לאישור' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('staff', _reason);
  UPDATE hospitality.bookings x SET status = 'declined', hold_expires_at = NULL, reminder_due_at = NULL
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_declined', 'guest', jsonb_build_object('reason', left(_reason, 500)));
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

-- שינוי הזמנה (תאריכים / יחידה / אורחים / מחיר) בטרנזקציה אחת: תפוסה ישנה יוצאת,
-- חדשה נכנסת (EXCLUDE), לילות מחושבים מחדש, אותם כללי ביטול על התאריכים החדשים.
CREATE OR REPLACE FUNCTION hospitality.modify_booking(
  _booking_id uuid, _expected_revision integer, _check_in date, _check_out date,
  _unit_id uuid DEFAULT NULL, _adults integer DEFAULT NULL, _children integer DEFAULT NULL,
  _total_override numeric DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
  _before jsonb;
  _q jsonb;
  _snap jsonb;
  _total numeric;
  _subtotal numeric;
  _discount numeric;
  _n integer;
  _per numeric;
BEGIN
  IF _expected_revision IS NULL THEN
    RAISE EXCEPTION 'חסרה גרסת ההזמנה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(_t);
  PERFORM hospitality._expire_due(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  IF b.status NOT IN ('pending_approval', 'pending_payment', 'confirmed') THEN
    RAISE EXCEPTION 'אי אפשר לשנות הזמנה בסטטוס הזה' USING ERRCODE = 'check_violation';
  END IF;
  _before := jsonb_build_object('unit_id', b.unit_id, 'check_in', b.check_in, 'check_out', b.check_out,
                                'adults', b.adults, 'children', b.children, 'total', b.total);
  _q := hospitality._quote(_t, COALESCE(_unit_id, b.unit_id), _check_in, _check_out,
                           COALESCE(_adults, b.adults), COALESCE(_children, b.children), NULL, false,
                           NULL, b.id);
  IF NOT (_q ->> 'available')::boolean THEN
    RAISE EXCEPTION 'התאריכים המבוקשים כבר לא פנויים' USING ERRCODE = 'exclusion_violation';
  END IF;
  _n := _check_out - _check_in;
  IF _total_override IS NOT NULL THEN
    IF _total_override < 0 THEN
      RAISE EXCEPTION 'המחיר לא יכול להיות שלילי' USING ERRCODE = 'check_violation';
    END IF;
    _total := _total_override; _subtotal := _total_override; _discount := 0;
  ELSE
    _subtotal := (_q ->> 'subtotal')::numeric;
    _discount := least(b.discount, _subtotal);
    _total := _subtotal - _discount;
  END IF;
  -- אותם כללים בדיוק (מה-snapshot), על התאריכים והסכום החדשים
  _snap := hospitality._snapshot((b.policy_snapshot ->> 'policy_id')::uuid, (b.policy_snapshot ->> 'version')::integer,
                                 b.policy_snapshot ->> 'name', b.policy_snapshot -> 'rules',
                                 b.policy_snapshot ->> 'timezone', (b.policy_snapshot ->> 'check_in_time')::time,
                                 b.currency, _check_in, _total);

  DELETE FROM hospitality.booking_nights n WHERE n.tenant_id = _t AND n.booking_id = b.id;
  PERFORM hospitality._set_actor('staff', _note);
  UPDATE hospitality.bookings x
     SET unit_id = COALESCE(_unit_id, x.unit_id), check_in = _check_in, check_out = _check_out,
         adults = COALESCE(_adults, x.adults), children = COALESCE(_children, x.children),
         subtotal = _subtotal, discount = _discount, total = _total, price_manual = _total_override IS NOT NULL,
         deposit_amount = (_snap ->> 'deposit_amount')::numeric, policy_snapshot = _snap,
         manage_token_expires_at = CASE WHEN x.manage_token_hash IS NOT NULL
                                        THEN ((_check_out + 31)::timestamp) AT TIME ZONE (_snap ->> 'timezone') END
   WHERE x.id = b.id RETURNING * INTO b;
  IF _total_override IS NULL THEN
    INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, extras, price, rule_applied, rule_id)
    SELECT _t, b.id, (x ->> 'night')::date, (x ->> 'base_rate')::numeric, (x ->> 'extras')::numeric,
           (x ->> 'price')::numeric, x ->> 'rule_applied', (x ->> 'rule_id')::uuid
      FROM jsonb_array_elements(_q -> 'nights') x;
  ELSE
    _per := trunc(_total / _n, 2);
    INSERT INTO hospitality.booking_nights (tenant_id, booking_id, night, base_rate, extras, price, rule_applied)
    SELECT _t, b.id, _check_in + i, CASE WHEN i = _n - 1 THEN _total - _per * (_n - 1) ELSE _per END, 0,
           CASE WHEN i = _n - 1 THEN _total - _per * (_n - 1) ELSE _per END, 'manual'
      FROM generate_series(0, _n - 1) i;
  END IF;
  INSERT INTO hospitality.booking_events (tenant_id, booking_id, kind, actor_kind, actor_id, changes, note)
  VALUES (_t, b.id, 'modified', 'staff', auth.uid(),
          jsonb_build_object('before', _before,
                             'after', jsonb_build_object('unit_id', b.unit_id, 'check_in', b.check_in, 'check_out', b.check_out,
                                                         'adults', b.adults, 'children', b.children, 'total', b.total)),
          NULLIF(btrim(_note), ''));
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision, 'total', b.total);
END $$;

-- ביטול ע"י הבעלים (דמי ביטול לפי ה-snapshot ברגע הביטול; אפשר להפחית / לוותר עם סיבה)
CREATE OR REPLACE FUNCTION hospitality.cancel_booking(_booking_id uuid, _reason text DEFAULT NULL,
                                                      _fee_override numeric DEFAULT NULL,
                                                      _override_reason text DEFAULT NULL,
                                                      _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
  _o jsonb;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  IF b.status NOT IN ('pending_approval', 'pending_payment', 'confirmed', 'cancel_requested') THEN
    RAISE EXCEPTION 'אי אפשר לבטל הזמנה בסטטוס הזה' USING ERRCODE = 'check_violation';
  END IF;
  -- בקשת ביטול קיימת — הדמים כבר נקבעו לפי זמן הבקשה
  _o := CASE WHEN b.status = 'cancel_requested' THEN b.cancellation_outcome
             WHEN b.status = 'confirmed' THEN hospitality._cancellation_outcome(b, now(), 'staff')
             ELSE jsonb_build_object('computed_at', hospitality._ts(now()), 'requested_by', 'staff', 'kind', 'withdrawn',
                                     'fee', 0, 'amount_paid', b.amount_paid, 'refund_due', b.amount_paid, 'charge_due', 0) END;
  RETURN hospitality._finish_cancellation(_t, b, _o, _fee_override, _override_reason, _reason);
END $$;

CREATE OR REPLACE FUNCTION hospitality.approve_cancellation(_booking_id uuid, _fee_override numeric DEFAULT NULL,
                                                            _override_reason text DEFAULT NULL,
                                                            _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
BEGIN
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  IF b.status <> 'cancel_requested' THEN
    RAISE EXCEPTION 'אין בקשת ביטול ממתינה להזמנה הזו' USING ERRCODE = 'check_violation';
  END IF;
  RETURN hospitality._finish_cancellation(_t, b, b.cancellation_outcome, _fee_override, _override_reason, NULL);
END $$;

-- סיום ביטול: דמי ביטול סופיים (התוצאה שנקבעה, או הפחתה / ויתור עם סיבה),
-- החזר לחישוב בלבד (refund_due) — אין החזר כספי בשלב הזה.
CREATE OR REPLACE FUNCTION hospitality._finish_cancellation(_tenant_id uuid, _b hospitality.bookings, _o jsonb,
                                                            _fee_override numeric, _override_reason text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings := _b;
  _fee numeric := (_o ->> 'fee')::numeric;
  _final numeric;
  _override jsonb;
BEGIN
  IF _fee_override IS NOT NULL THEN
    IF _fee_override < 0 OR _fee_override > _fee THEN
      RAISE EXCEPTION 'אפשר רק להפחית או לוותר על דמי הביטול (0 עד %)', _fee USING ERRCODE = 'check_violation';
    END IF;
    IF char_length(btrim(COALESCE(_override_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'נא לציין סיבה לשינוי דמי הביטול' USING ERRCODE = 'check_violation';
    END IF;
    _override := jsonb_build_object('amount', _fee_override, 'calculated_fee', _fee, 'reason', left(_override_reason, 500),
                                    'actor_id', auth.uid(), 'at', hospitality._ts(now()));
  END IF;
  _final := COALESCE(_fee_override, _fee);
  PERFORM hospitality._set_actor('staff', COALESCE(_reason, _override_reason));
  UPDATE hospitality.bookings x
     SET status = 'cancelled', hold_expires_at = NULL, reminder_due_at = NULL,
         cancellation_outcome = _o || jsonb_build_object('final_fee', _final,
                                                         'refund_due', greatest(x.amount_paid - _final, 0),
                                                         'charge_due', greatest(_final - x.amount_paid, 0),
                                                         'approved_at', hospitality._ts(now())),
         fee_override = _override
   WHERE x.tenant_id = _tenant_id AND x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, CASE WHEN _b.status = 'cancel_requested' THEN 'cancellation_approved' ELSE 'booking_cancelled' END,
                               'guest', jsonb_build_object('fee', _final));
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision,
                            'final_fee', _final, 'refund_due', b.cancellation_outcome -> 'refund_due');
END $$;

CREATE OR REPLACE FUNCTION hospitality.decline_cancellation(_booking_id uuid, _reason text,
                                                            _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
BEGIN
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'נא לציין סיבה לדחיית הביטול' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  IF b.status <> 'cancel_requested' THEN
    RAISE EXCEPTION 'אין בקשת ביטול ממתינה להזמנה הזו' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('staff', _reason);
  UPDATE hospitality.bookings x SET status = 'confirmed', cancellation_outcome = NULL
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'cancellation_declined', 'guest', jsonb_build_object('reason', left(_reason, 500)));
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

-- צ'ק-אין / צ'ק-אאוט / אי-הגעה (מיום ההגעה, לפי אזור הזמן של העסק)
CREATE OR REPLACE FUNCTION hospitality.set_stay_status(_booking_id uuid, _status text,
                                                       _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('bookings');
  b hospitality.bookings;
  _today date;
BEGIN
  IF _status NOT IN ('checked_in', 'checked_out', 'no_show') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(_t);
  b := hospitality._staff_booking(_t, _booking_id, _expected_revision);
  _today := (now() AT TIME ZONE (b.policy_snapshot ->> 'timezone'))::date;
  IF _status IN ('checked_in', 'no_show') AND _today < b.check_in THEN
    RAISE EXCEPTION 'אפשר לסמן רק מיום ההגעה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('staff', NULL);
  UPDATE hospitality.bookings x
     SET status = _status,
         cancellation_outcome = CASE WHEN _status = 'no_show'
           THEN jsonb_build_object('kind', 'no_show', 'computed_at', hospitality._ts(now()), 'requested_by', 'staff',
                                   'fee', (x.policy_snapshot -> 'schedule' ->> 'no_show_fee')::numeric,
                                   'final_fee', (x.policy_snapshot -> 'schedule' ->> 'no_show_fee')::numeric,
                                   'amount_paid', x.amount_paid,
                                   'refund_due', greatest(x.amount_paid - (x.policy_snapshot -> 'schedule' ->> 'no_show_fee')::numeric, 0),
                                   'charge_due', greatest((x.policy_snapshot -> 'schedule' ->> 'no_show_fee')::numeric - x.amount_paid, 0))
           ELSE x.cancellation_outcome END
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'revision', b.revision);
END $$;

-- פרטיות: ייצוא / אנונימיזציה של כרטיס אורח (חסום כשיש הזמנה שעדיין מחזיקה תאריכים)
CREATE OR REPLACE FUNCTION hospitality._anonymize_guest(_tenant_id uuid, _guest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id
                AND hospitality._holding(b.status)) THEN
    RAISE EXCEPTION 'לאורח יש הזמנה פעילה או עתידית — אי אפשר למחוק את פרטיו עכשיו' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.guests g
     SET full_name = 'אורח שנמחק', email = NULL, phone = NULL, notes = NULL, user_id = NULL,
         marketing_consent = false, anonymized_at = now()
   WHERE g.tenant_id = _tenant_id AND g.id = _guest_id AND g.anonymized_at IS NULL;
  UPDATE hospitality.bookings b
     SET special_requests = NULL, policy_acceptance = b.policy_acceptance - 'ip' - 'user_agent',
         manage_token_hash = NULL, manage_token_expires_at = NULL
   WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id;
  UPDATE hospitality.notifications n
     SET payload = '{}'::jsonb,
         recipient_email = CASE WHEN n.recipient_kind = 'guest' THEN 'anonymized@invalid.invalid' ELSE n.recipient_email END,
         status = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'dead' ELSE n.status END,
         last_error = CASE WHEN n.status IN ('queued', 'failed', 'sending') THEN 'guest anonymized' ELSE n.last_error END,
         updated_at = now()
   WHERE n.tenant_id = _tenant_id
     AND n.booking_id IN (SELECT b.id FROM hospitality.bookings b WHERE b.tenant_id = _tenant_id AND b.guest_id = _guest_id);
END $$;

CREATE OR REPLACE FUNCTION hospitality.export_guest(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests');
  g hospitality.guests;
BEGIN
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'guest', jsonb_build_object('full_name', g.full_name, 'email', g.email, 'phone', g.phone, 'notes', g.notes,
                                'marketing_consent', g.marketing_consent, 'created_at', hospitality._ts(g.created_at),
                                'anonymized_at', hospitality._ts(g.anonymized_at)),
    'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'number', b.number, 'status', b.status, 'check_in', b.check_in, 'check_out', b.check_out,
                  'adults', b.adults, 'children', b.children, 'total', b.total, 'currency', b.currency,
                  'special_requests', b.special_requests, 'policy_acceptance', b.policy_acceptance,
                  'created_at', hospitality._ts(b.created_at)) ORDER BY b.check_in)
                FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION hospitality.anonymize_guest(_guest_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id) THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._anonymize_guest(_t, _guest_id);
  RETURN true;
END $$;

-- ------------------------------------------------------------
-- 9. פונקציות מערכת (service_role בלבד)
-- ------------------------------------------------------------
-- סריקה: תפוגת בקשות שעבר מועדן + תזכורת אחת לבעלים ב-50% מהחלון.
-- בטוח להרצה כפולה / מקבילה (SKIP LOCKED, מפתח כפילות למיילים).
CREATE OR REPLACE FUNCTION hospitality.expire_holds(_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _ids uuid[];
  _b hospitality.bookings;
  _reminders integer := 0;
BEGIN
  SELECT array_agg(x.id) INTO _ids FROM (
    SELECT b.id FROM hospitality.bookings b
     WHERE b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now()
     ORDER BY b.hold_expires_at LIMIT greatest(1, least(COALESCE(_limit, 500), 5000))
     FOR UPDATE SKIP LOCKED) x;
  PERFORM hospitality._set_actor('system', 'פג המועד לאישור');
  FOR _b IN
    UPDATE hospitality.bookings b SET status = 'expired', hold_expires_at = NULL, reminder_due_at = NULL
     WHERE b.id = ANY (COALESCE(_ids, '{}')) AND b.status IN ('pending_approval', 'pending_payment')
    RETURNING b.*
  LOOP
    PERFORM hospitality._enqueue(_b, 'request_expired', 'guest', '{}'::jsonb, true);
    PERFORM hospitality._enqueue(_b, 'request_expired_owner', 'owner', '{}'::jsonb, true);
  END LOOP;
  FOR _b IN
    SELECT b.* FROM hospitality.bookings b
     WHERE b.status = 'pending_approval' AND b.reminder_due_at <= now() AND b.hold_expires_at > now()
       AND NOT EXISTS (SELECT 1 FROM hospitality.notifications n
                        WHERE n.booking_id = b.id AND n.event = 'approval_reminder')
     FOR UPDATE SKIP LOCKED
  LOOP
    _reminders := _reminders + hospitality._enqueue(_b, 'approval_reminder', 'owner', '{}'::jsonb, true);
  END LOOP;
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('expired', COALESCE(cardinality(_ids), 0), 'reminders', _reminders);
END $$;

-- תשלום שהתקבל (סטטוס בלבד — אין ספק תשלומים בשלב הזה)
CREATE OR REPLACE FUNCTION hospitality.confirm_payment(_booking_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b hospitality.bookings;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'סכום לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._lock_inventory(b.tenant_id);
  PERFORM hospitality._expire_due(b.tenant_id);
  SELECT * INTO b FROM hospitality.bookings x WHERE x.id = _booking_id FOR UPDATE;
  IF b.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לתשלום' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._set_actor('system', 'התקבל תשלום');
  UPDATE hospitality.bookings x
     SET status = 'confirmed', hold_expires_at = NULL, amount_paid = x.amount_paid + _amount,
         payment_status = CASE WHEN x.amount_paid + _amount >= x.total THEN 'paid' ELSE 'deposit_paid' END
   WHERE x.id = b.id RETURNING * INTO b;
  PERFORM hospitality._enqueue(b, 'booking_confirmed', 'guest');
  PERFORM hospitality._set_actor('', NULL);
  RETURN jsonb_build_object('booking_id', b.id, 'status', b.status, 'amount_paid', b.amount_paid);
END $$;

-- תור המיילים: worker לוקח שורות (SKIP LOCKED — שני workers לא לוקחים אותה שורה),
-- שורה שנתקעה ב-sending מעבר לזמן הנעילה חוזרת לתור.
CREATE OR REPLACE FUNCTION hospitality.claim_notifications(_batch integer DEFAULT 20)
RETURNS SETOF hospitality.notifications LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _batch IS NULL OR _batch < 1 OR _batch > 200 THEN
    RAISE EXCEPTION 'גודל אצווה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  -- נתקע אחרי הניסיון האחרון → dead
  UPDATE hospitality.notifications n
     SET status = 'dead', last_error = 'worker timeout', locked_until = NULL, payload = n.payload - 'manage_token',
         updated_at = now()
   WHERE n.status = 'sending' AND n.locked_until < now() AND n.attempts >= 5;
  RETURN QUERY
  UPDATE hospitality.notifications n
     SET status = 'sending', attempts = n.attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
   WHERE n.id IN (SELECT x.id FROM hospitality.notifications x
                   WHERE (x.status IN ('queued', 'failed') AND x.next_attempt_at <= now())
                      OR (x.status = 'sending' AND x.locked_until < now())
                   ORDER BY x.next_attempt_at, x.created_at, x.id
                   LIMIT _batch
                   FOR UPDATE SKIP LOCKED)
  RETURNING n.*;
END $$;

-- תוצאת שליחה: sent / failed (ניסיון חוזר: 1, 5, 30, 120, 720 דק') / dead אחרי 5 ניסיונות.
-- רק משורה שב-sending — סימון כפול לא משנה דבר. אחרי שליחה הטוקן נמחק מהתוכן.
CREATE OR REPLACE FUNCTION hospitality.mark_notification(_id uuid, _ok boolean, _error text DEFAULT NULL,
                                                         _provider_message_id text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n hospitality.notifications;
BEGIN
  SELECT * INTO n FROM hospitality.notifications x WHERE x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההודעה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF n.status <> 'sending' THEN
    RETURN n.status;
  END IF;
  IF _ok THEN
    UPDATE hospitality.notifications x
       SET status = 'sent', sent_at = now(), provider_message_id = left(_provider_message_id, 200), last_error = NULL,
           locked_until = NULL, payload = x.payload - 'manage_token', updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  ELSIF n.attempts >= 5 THEN
    UPDATE hospitality.notifications x
       SET status = 'dead', last_error = left(COALESCE(_error, 'unknown error'), 1000), locked_until = NULL,
           payload = x.payload - 'manage_token', updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  ELSE
    UPDATE hospitality.notifications x
       SET status = 'failed', last_error = left(COALESCE(_error, 'unknown error'), 1000), locked_until = NULL,
           next_attempt_at = now() + make_interval(mins => (ARRAY[1, 5, 30, 120, 720])[greatest(x.attempts, 1)]),
           updated_at = now()
     WHERE x.id = _id RETURNING * INTO n;
  END IF;
  RETURN n.status;
END $$;

-- מחיקת פרטי אורחים לפי תקופת השמירה של כל עסק — רק עסק שהגדיר תקופה
CREATE OR REPLACE FUNCTION hospitality.apply_retention()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  _n integer := 0;
BEGIN
  FOR r IN
    SELECT g.tenant_id, g.id
      FROM hospitality.guests g
      JOIN hospitality.settings s ON s.tenant_id = g.tenant_id AND s.guest_retention_months IS NOT NULL
     WHERE g.anonymized_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM hospitality.bookings b WHERE b.tenant_id = g.tenant_id AND b.guest_id = g.id
                          AND (hospitality._holding(b.status)
                               OR b.check_out > (now() - make_interval(months => s.guest_retention_months))::date))
       AND g.created_at < now() - make_interval(months => s.guest_retention_months)
  LOOP
    PERFORM hospitality._anonymize_guest(r.tenant_id, r.id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- ------------------------------------------------------------
-- 10. הרשאות הפעלה
-- ------------------------------------------------------------
DO $$
DECLARE
  _f record;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
     WHERE p.pronamespace = 'hospitality'::regnamespace
       AND p.proname IN ('normalize_email', 'normalize_phone', '_ts', '_fee_amount', 'policy_schedule', 'fee_at',
                         '_snapshot', '_policy_rules', '_hash', '_header', '_holding', '_fanout_units', '_set_actor',
                         '_lock_inventory', '_owner_emails', '_enqueue', '_expire_due', '_price_nights',
                         '_resolve_policy', '_quote', '_create_booking', '_cancellation_outcome', '_guest_view',
                         'bookings_before_write', 'bookings_after_write', 'bookings_consistency',
                         'booking_events_append_only', 'blocks_after_write', 'blocks_before_update',
                         'unit_members_occupancy_guard', '_public_tenant', '_guest_booking', 'quote',
                         'request_booking', 'get_booking_by_token', 'cancellation_quote', 'request_cancellation',
                         'my_bookings', 'claim_guest_bookings', '_staff_tenant', '_staff_booking',
                         'create_manual_booking', 'approve_booking', 'decline_booking', 'modify_booking',
                         'cancel_booking', 'approve_cancellation', '_finish_cancellation', 'decline_cancellation',
                         'set_stay_status', '_anonymize_guest', 'export_guest', 'anonymize_guest', 'expire_holds',
                         'confirm_payment', 'claim_notifications', 'mark_notification', 'apply_retention')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', _f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', _f.sig);
  END LOOP;
END $$;

-- אורחים (גם בלי חשבון)
GRANT EXECUTE ON FUNCTION hospitality.quote(uuid, date, date, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_booking(uuid, date, date, text, text, text, text, boolean, text,
                                                       integer, integer, text, text, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.get_booking_by_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.cancellation_quote(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.request_cancellation(text, uuid, text) TO anon, authenticated;
-- אורח מחובר
GRANT EXECUTE ON FUNCTION hospitality.my_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.claim_guest_bookings() TO authenticated;
-- בעלים / מנהל (ההרשאה נבדקת בתוך כל פונקציה: can() + הדגל)
GRANT EXECUTE ON FUNCTION hospitality.create_manual_booking(uuid, date, date, text, text, boolean, text, integer, integer,
                                                             numeric, uuid, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.approve_booking(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.decline_booking(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.modify_booking(uuid, integer, date, date, uuid, integer, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.cancel_booking(uuid, text, numeric, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.approve_cancellation(uuid, numeric, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.decline_cancellation(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.set_stay_status(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.export_guest(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION hospitality.anonymize_guest(uuid) TO authenticated;

COMMIT;

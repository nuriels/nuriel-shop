-- ============================================================
-- Hospitality — אירועים במתחם (מיגרציה 63): הזמנת מתחם הבריכה לאירוע, בלי לינה — תהליך נפרד לגמרי
-- מהזמנות הלינה (טבלה משלו, מספור משלו, מסך משלו). הכללים מהחוזה "הסכם שכירות והזמנת אירוח —
-- מתחם הבריכה לאירועים" (נופי דורית):
--   • עד 50 משתתפים — CHECK במסד (אי אפשר לשמור יותר, גם לא ישירות);
--   • אין שני אירועים פעילים (ממתין / מאושר) באותו מתחם באותו זמן — EXCLUDE במסד (גם במקביל);
--   • פיקדון / ערבות לנזקים: 2,000 ₪ קבוע (ברירת המחדל מתנאי העסק), מצב הפיקדון נרשם;
--   • איחור בפינוי: 200 ₪ לכל שעה — נשמר באירוע (כמו שנקבע ביום ההזמנה);
--   • שעות הבריכה 08:00–18:00 — אירוע שחורג מהן מסומן ("אסור להיכנס למים מחוץ לשעות"), לא נחסם;
--   • לפני אישור: בדיקת זמינות — אירוע חופף נחסם; אורחים בצימרים באותו מתחם באותו זמן — אישור
--     מפורש של בעל העסק ("אני יודע/ת"), נרשם באירוע ובהיסטוריה. הזמנות הלינה עצמן לא משתנות.
-- תנאי העסק (business_terms): המספרים מהחוזים (פיקדון, דמי איחור, שעות הבריכה, מכסות, ימי ביטול)
-- ופרטים לחוזים (נציג מורשה, עוסק מורשה, מתקנים, יחידות). ברירות המחדל — כפי שהם בחוזים; עסק אחר
-- מעדכן ומאשר לפני שליחת חוזה ראשון (מיגרציה 64).
-- הרשאות: אירועים — bookings (בעלים ומנהלים); תנאי העסק — settings, אישור — settings.owner (בעלים).
-- הכל ביומן הפעולות (_audit) ובהיסטוריית האירוע (event_log — רק הוספה).
-- Rollback: supabase/rollbacks/20261111110000_hosp_events.down.sql (מסרב כשיש אירועים / תנאים שמורים)
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. תנאי העסק (לאירועים ולחוזים)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.business_terms (
  tenant_id                 uuid NOT NULL PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- צד א' בחוזים (שאר הפרטים — שם העסק, כתובת, טלפון, מייל — מהגדרות העסק)
  representative_name       text CHECK (representative_name IS NULL OR char_length(representative_name) BETWEEN 2 AND 80),
  business_tax_id           text CHECK (business_tax_id IS NULL OR business_tax_id ~ '^[0-9]{5,9}$'),
  -- המתקנים, כפי שמופיעים במבוא לחוזים ("מטבח חוץ, פינת מנגל…") ובסעיף ההתנהגות ("פינת המנגל, מטבח החוץ…")
  facilities                text NOT NULL DEFAULT 'מטבח חוץ, פינת מנגל, טרמפולינה ושולחן טניס'
                            CHECK (char_length(facilities) BETWEEN 2 AND 300),
  facilities_definite       text NOT NULL DEFAULT 'פינת המנגל, מטבח החוץ, הטרמפולינה ושולחן הטניס'
                            CHECK (char_length(facilities_definite) BETWEEN 2 AND 300),
  -- חתימת הנציג (צד א'), פעם אחת לכל החוזים: קווים בלבד (path M/L בתוך 600×200) — לא SVG חופשי
  representative_signature  jsonb CHECK (representative_signature IS NULL OR (jsonb_typeof(representative_signature) = 'array'
                                   AND jsonb_array_length(representative_signature) BETWEEN 1 AND 60
                                   AND pg_column_size(representative_signature) <= 65536)),
  -- חוזה האירוח, סעיף 1: יחידה + למי מיועדת ("מיועד לזוג ועד 3 ילדים") — [{unit_id, name, description}]
  unit_lines                jsonb NOT NULL DEFAULT '[]'::jsonb
                            CHECK (jsonb_typeof(unit_lines) = 'array' AND jsonb_array_length(unit_lines) <= 30
                                   AND pg_column_size(unit_lines) <= 8192),
  max_lodging_guests        integer NOT NULL DEFAULT 12 CHECK (max_lodging_guests BETWEEN 1 AND 500),
  max_event_guests          integer NOT NULL DEFAULT 50 CHECK (max_event_guests BETWEEN 1 AND 50),
  pool_open_time            time NOT NULL DEFAULT '08:00',
  pool_close_time           time NOT NULL DEFAULT '18:00',
  deposit_amount            numeric(10,2) NOT NULL DEFAULT 2000 CHECK (deposit_amount BETWEEN 0 AND 100000),
  event_late_fee_per_hour   numeric(10,2) NOT NULL DEFAULT 200 CHECK (event_late_fee_per_hour BETWEEN 0 AND 10000),
  lodging_late_fee_per_hour numeric(10,2) NOT NULL DEFAULT 100 CHECK (lodging_late_fee_per_hour BETWEEN 0 AND 10000),
  free_cancellation_days    integer NOT NULL DEFAULT 14 CHECK (free_cancellation_days BETWEEN 0 AND 365),
  -- בעל העסק בדק שהפרטים והמספרים נכונים לעסק שלו (נדרש לפני שליחת חוזה — מיגרציה 64)
  confirmed_at              timestamptz,
  confirmed_by              uuid,
  revision                  integer NOT NULL DEFAULT 1,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (pool_close_time > pool_open_time),
  CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL))
);
COMMENT ON TABLE hospitality.business_terms IS
  'Hospitality (מיגרציה 63): תנאי העסק לאירועים ולחוזים — מספרים מהחוזים ופרטי צד א''; רק דרך פונקציות';

-- ------------------------------------------------------------
-- 2. אירועים
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.events (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number            integer NOT NULL CHECK (number > 1000),
  property_id       uuid NOT NULL,
  guest_id          uuid NOT NULL,
  event_type        text NOT NULL CHECK (event_type IN ('bridal_shower', 'bar_mitzvah', 'birthday', 'private_party',
                                                        'family_event', 'other')),
  event_type_other  text CHECK (event_type_other IS NULL OR char_length(event_type_other) BETWEEN 2 AND 80),
  event_date        date NOT NULL,
  start_time        time NOT NULL,
  end_time          time NOT NULL,
  -- הזמן המלא באזור הזמן של העסק; שעת סיום קטנה משעת ההתחלה = למחרת (אירוע שנגמר אחרי חצות)
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  participants      integer NOT NULL CHECK (participants BETWEEN 1 AND 50),
  price             numeric(10,2) NOT NULL CHECK (price BETWEEN 0 AND 1000000),
  advance_amount    numeric(10,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  amount_paid       numeric(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid BETWEEN 0 AND 1000000),
  deposit_amount    numeric(10,2) NOT NULL DEFAULT 2000 CHECK (deposit_amount BETWEEN 0 AND 100000),
  deposit_status    text NOT NULL DEFAULT 'pending' CHECK (deposit_status IN ('pending', 'held', 'returned', 'charged')),
  late_fee_per_hour numeric(10,2) NOT NULL DEFAULT 200 CHECK (late_fee_per_hour BETWEEN 0 AND 10000),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  cancel_reason     text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
  cancelled_at      timestamptz,
  -- אושר למרות שיש אורחים בצימרים באותו מתחם באותו זמן (בעל העסק סימן שהוא יודע)
  lodging_ack       boolean NOT NULL DEFAULT false,
  internal_notes    text CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 2000),
  revision          integer NOT NULL DEFAULT 1,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  CHECK (advance_amount <= price),
  CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '24 hours'),
  CHECK ((event_type = 'other') = (event_type_other IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, property_id) REFERENCES hospitality.properties (tenant_id, id),
  FOREIGN KEY (tenant_id, guest_id) REFERENCES hospitality.guests (tenant_id, id),
  -- אין שני אירועים פעילים באותו מתחם באותו זמן — המסד מכריע, גם בשתי בקשות במקביל
  CONSTRAINT events_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, property_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status IN ('pending', 'confirmed'))
);
CREATE INDEX IF NOT EXISTS events_date_idx ON hospitality.events (tenant_id, event_date);
CREATE INDEX IF NOT EXISTS events_guest_idx ON hospitality.events (tenant_id, guest_id);
COMMENT ON TABLE hospitality.events IS
  'Hospitality (מיגרציה 63): אירועים במתחם (בריכה, בלי לינה) — נפרד מההזמנות; רק דרך פונקציות';

CREATE TABLE IF NOT EXISTS hospitality.event_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL,
  kind        text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
  from_status text,
  to_status   text,
  actor_kind  text NOT NULL CHECK (actor_kind IN ('guest', 'staff', 'system')),
  actor_id    uuid,
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(changes) <= 4096),
  note        text CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, event_id) REFERENCES hospitality.events (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS event_log_event_idx ON hospitality.event_log (tenant_id, event_id, id);
COMMENT ON TABLE hospitality.event_log IS 'Hospitality (מיגרציה 63): היסטוריית האירוע (לא ניתנת לעריכה)';

-- היסטוריה — רק הוספה (מחיקה רק כחלק ממחיקת האתר)
CREATE OR REPLACE FUNCTION hospitality.event_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR pg_catalog.pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'היסטוריית האירוע לא ניתנת לשינוי' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION hospitality.event_log_append_only() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS event_log_append_only ON hospitality.event_log;
CREATE TRIGGER event_log_append_only BEFORE UPDATE OR DELETE ON hospitality.event_log
FOR EACH ROW EXECUTE FUNCTION hospitality.event_log_append_only();

-- סגורות לתפקידי ה-API: RLS מגביל (העסק הנוכחי + הדגל), שומר העסק, ורק דרך הפונקציות
DO $$
DECLARE _tbl text;
BEGIN
  FOREACH _tbl IN ARRAY ARRAY['business_terms', 'events', 'event_log'] LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _tbl);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated, service_role', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _tbl);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _tbl);
    EXECUTE format('CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag(''hospitality_backend_enabled'')))
                      WITH CHECK ((SELECT hospitality.flag(''hospitality_backend_enabled'')))', _tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _tbl);
    EXECUTE format('CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()', _tbl);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. עזרים
-- ------------------------------------------------------------
-- חתימה (ציור): מערך קווים — כל קו "M x,y L x,y …" בתוך 600×200, עד 60 קווים. כל דבר אחר — שגיאה.
-- כך שום SVG חופשי לא נשמר (התצוגה בונה את ה-SVG בעצמה)
CREATE OR REPLACE FUNCTION hospitality._signature_paths(_v jsonb, _nullable boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  p jsonb;
  _n integer := 0;
BEGIN
  IF _v IS NULL OR jsonb_typeof(_v) = 'null' THEN
    IF _nullable THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'חסרה חתימה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'החתימה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  FOR p IN SELECT x FROM jsonb_array_elements(_v) x LOOP
    IF jsonb_typeof(p) <> 'string' OR char_length(p #>> '{}') NOT BETWEEN 3 AND 8000
       OR (p #>> '{}') !~ '^M[0-9]{1,3},[0-9]{1,3}( L[0-9]{1,3},[0-9]{1,3})*$' THEN
      RAISE EXCEPTION 'החתימה לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    _n := _n + (SELECT count(*) FROM regexp_matches(p #>> '{}', '[ML]', 'g'));
  END LOOP;
  -- חתימה של נקודה אחת או שתיים היא לא חתימה
  IF _n < 3 THEN
    RAISE EXCEPTION 'החתימה קצרה מדי — חתמו שוב' USING ERRCODE = 'check_violation';
  END IF;
  RETURN _v;
END $$;
REVOKE ALL ON FUNCTION hospitality._signature_paths(jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- תנאי העסק עם ברירות המחדל של החוזים (גם כשעוד לא נשמרו)
CREATE OR REPLACE FUNCTION hospitality._terms(_t uuid)
RETURNS hospitality.business_terms LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  r hospitality.business_terms;
BEGIN
  SELECT * INTO r FROM hospitality.business_terms x WHERE x.tenant_id = _t;
  IF r.tenant_id IS NULL THEN
    r.tenant_id := _t;
    r.facilities := 'מטבח חוץ, פינת מנגל, טרמפולינה ושולחן טניס';
    r.facilities_definite := 'פינת המנגל, מטבח החוץ, הטרמפולינה ושולחן הטניס';
    r.unit_lines := '[]'::jsonb;
    r.max_lodging_guests := 12;
    r.max_event_guests := 50;
    r.pool_open_time := '08:00';
    r.pool_close_time := '18:00';
    r.deposit_amount := 2000;
    r.event_late_fee_per_hour := 200;
    r.lodging_late_fee_per_hour := 100;
    r.free_cancellation_days := 14;
    r.revision := 0;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION hospitality._terms(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._terms_json(r hospitality.business_terms)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'representative_name', r.representative_name, 'business_tax_id', r.business_tax_id,
    'representative_signature', r.representative_signature,
    'facilities', r.facilities, 'facilities_definite', r.facilities_definite, 'unit_lines', r.unit_lines,
    'max_lodging_guests', r.max_lodging_guests, 'max_event_guests', r.max_event_guests,
    'pool_open_time', to_char(r.pool_open_time, 'HH24:MI'), 'pool_close_time', to_char(r.pool_close_time, 'HH24:MI'),
    'deposit_amount', r.deposit_amount, 'event_late_fee_per_hour', r.event_late_fee_per_hour,
    'lodging_late_fee_per_hour', r.lodging_late_fee_per_hour, 'free_cancellation_days', r.free_cancellation_days,
    'confirmed', r.confirmed_at IS NOT NULL, 'confirmed_at', hospitality._ts(r.confirmed_at),
    'revision', r.revision, 'saved', r.revision > 0);
$$;
REVOKE ALL ON FUNCTION hospitality._terms_json(hospitality.business_terms) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._event_type_label(_type text, _other text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _type
    WHEN 'bridal_shower' THEN 'מסיבת כלה'
    WHEN 'bar_mitzvah' THEN 'בר מצווה'
    WHEN 'birthday' THEN 'יום הולדת'
    WHEN 'private_party' THEN 'מסיבה פרטית'
    WHEN 'family_event' THEN 'אירוע משפחתי'
    ELSE COALESCE(_other, 'אחר') END;
$$;
REVOKE ALL ON FUNCTION hospitality._event_type_label(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._event_payment_status(e hospitality.events)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN e.amount_paid >= e.price THEN 'paid'
              WHEN e.amount_paid = 0 THEN 'unpaid'
              WHEN e.advance_amount > 0 AND e.amount_paid >= e.advance_amount THEN 'advance_paid'
              ELSE 'partial' END;
$$;
REVOKE ALL ON FUNCTION hospitality._event_payment_status(hospitality.events) FROM PUBLIC, anon, authenticated;

-- אורחים בצימרים של המתחם שנמצאים במקום בזמן האירוע: מכניסה (שעת הכניסה) עד יציאה (שעת היציאה)
CREATE OR REPLACE FUNCTION hospitality._event_lodging(_t uuid, _property uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'booking_id', b.id, 'number', b.number, 'unit_name', u.name, 'status', b.status,
           'check_in', b.check_in, 'check_out', b.check_out) ORDER BY b.check_in, b.number), '[]'::jsonb)
    FROM hospitality.bookings b
    JOIN hospitality.units u ON u.tenant_id = b.tenant_id AND u.id = b.unit_id
    JOIN hospitality.settings s ON s.tenant_id = b.tenant_id
   WHERE b.tenant_id = _t AND u.property_id = _property
     AND hospitality._booking_state(b) IN ('pending_approval', 'pending_payment', 'confirmed', 'checked_in', 'cancel_requested')
     AND tstzrange(((b.check_in + COALESCE(s.check_in_time, '14:00'::time))::timestamp) AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'),
                   ((b.check_out + COALESCE(s.check_out_time, '11:00'::time))::timestamp) AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'), '[)')
         && tstzrange(_from, _to, '[)');
$$;
REVOKE ALL ON FUNCTION hospitality._event_lodging(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- אירועים פעילים אחרים שחופפים (לבדיקה לפני שמירה — ה-EXCLUDE הוא ההגנה הסופית)
CREATE OR REPLACE FUNCTION hospitality._event_conflicts(_t uuid, _property uuid, _from timestamptz, _to timestamptz, _exclude uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'event_id', e.id, 'number', e.number, 'event_type', hospitality._event_type_label(e.event_type, e.event_type_other),
           'event_date', e.event_date, 'start_time', to_char(e.start_time, 'HH24:MI'),
           'end_time', to_char(e.end_time, 'HH24:MI'), 'status', e.status) ORDER BY e.starts_at), '[]'::jsonb)
    FROM hospitality.events e
   WHERE e.tenant_id = _t AND e.property_id = _property AND e.status IN ('pending', 'confirmed')
     AND e.id IS DISTINCT FROM _exclude
     AND tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(_from, _to, '[)');
$$;
REVOKE ALL ON FUNCTION hospitality._event_conflicts(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;

-- אירוע שחורג משעות הבריכה (אסור להיכנס למים מחוץ להן — מסומן, לא נחסם)
CREATE OR REPLACE FUNCTION hospitality._event_outside_pool(_t uuid, _start time, _end time)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT _start < r.pool_open_time OR _end > r.pool_close_time OR _end <= _start
    FROM (SELECT (hospitality._terms(_t)).*) r;
$$;
REVOKE ALL ON FUNCTION hospitality._event_outside_pool(uuid, time, time) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._event_json(e hospitality.events)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'number', e.number, 'property_id', e.property_id,
    'property_name', (SELECT p.name FROM hospitality.properties p WHERE p.tenant_id = e.tenant_id AND p.id = e.property_id),
    'customer', (SELECT jsonb_build_object(
                   'guest_id', g.id, 'full_name', g.full_name,
                   'email', CASE WHEN hospitality.can('guests') THEN g.email ELSE hospitality.mask_email(g.email) END,
                   'phone', CASE WHEN hospitality.can('guests') THEN g.phone ELSE hospitality.mask_phone(g.phone) END,
                   'anonymized', g.anonymized_at IS NOT NULL)
                   FROM hospitality.guests g WHERE g.tenant_id = e.tenant_id AND g.id = e.guest_id),
    'event_type', e.event_type, 'event_type_other', e.event_type_other,
    'event_type_label', hospitality._event_type_label(e.event_type, e.event_type_other),
    'event_date', e.event_date, 'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'),
    'starts_at', hospitality._ts(e.starts_at), 'ends_at', hospitality._ts(e.ends_at),
    'ends_next_day', e.end_time <= e.start_time,
    'outside_pool_hours', hospitality._event_outside_pool(e.tenant_id, e.start_time, e.end_time),
    'participants', e.participants, 'price', e.price, 'advance_amount', e.advance_amount,
    'amount_paid', e.amount_paid, 'balance_due', greatest(e.price - e.amount_paid, 0),
    'payment_status', hospitality._event_payment_status(e),
    'deposit_amount', e.deposit_amount, 'deposit_status', e.deposit_status, 'late_fee_per_hour', e.late_fee_per_hour,
    'status', CASE WHEN e.status = 'confirmed' AND e.ends_at <= now() THEN 'past' ELSE e.status END,
    'stored_status', e.status, 'cancel_reason', e.cancel_reason, 'cancelled_at', hospitality._ts(e.cancelled_at),
    'lodging_ack', e.lodging_ack, 'internal_notes', e.internal_notes, 'revision', e.revision,
    'created_at', hospitality._ts(e.created_at), 'updated_at', hospitality._ts(e.updated_at));
$$;
REVOKE ALL ON FUNCTION hospitality._event_json(hospitality.events) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._event_log(_t uuid, _event uuid, _kind text, _from text, _to text,
                                                  _changes jsonb, _note text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO hospitality.event_log (tenant_id, event_id, kind, from_status, to_status, actor_kind, actor_id, changes, note)
  VALUES (_t, _event, _kind, _from, _to, CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'staff' END, auth.uid(),
          COALESCE(_changes, '{}'::jsonb), _note);
$$;
REVOKE ALL ON FUNCTION hospitality._event_log(uuid, uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- הלקוח: כרטיס קיים (של העסק, לא מחוק) או חדש — לפי מייל, ואם אין — לפי טלפון (כמו הזמנה ידנית)
CREATE OR REPLACE FUNCTION hospitality._event_customer(_t uuid, _data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _c jsonb := _data -> 'customer';
  _id uuid;
  _name text;
  _phone text;
  _email text;
  _e text;
  _p text;
BEGIN
  IF jsonb_typeof(_data -> 'guest_id') = 'string' THEN
    BEGIN
      _id := (_data ->> 'guest_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'הלקוח לא נמצא' USING ERRCODE = 'no_data_found';
    END;
    IF NOT EXISTS (SELECT 1 FROM hospitality.guests g WHERE g.tenant_id = _t AND g.id = _id AND g.anonymized_at IS NULL) THEN
      RAISE EXCEPTION 'הלקוח לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
    RETURN _id;
  END IF;
  IF _c IS NULL OR jsonb_typeof(_c) <> 'object' THEN
    RAISE EXCEPTION 'יש לבחור לקוח או למלא את פרטי הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  _name := hospitality._cv_text(_c -> 'full_name', 'שם הלקוח', 120, true);
  IF char_length(_name) < 2 THEN
    RAISE EXCEPTION 'נא למלא את שם הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  _phone := hospitality._cv_text(_c -> 'phone', 'טלפון', 30, true);
  _p := hospitality.normalize_phone(_phone);
  IF _p IS NULL THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _email := hospitality._cv_text(_c -> 'email', 'אימייל', 254, false);
  _e := hospitality.normalize_email(_email);
  IF _email IS NOT NULL AND _e IS NULL THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT g.id INTO _id FROM hospitality.guests g
   WHERE g.tenant_id = _t AND g.anonymized_at IS NULL
     AND ((_e IS NOT NULL AND g.email_normalized = _e) OR (_e IS NULL AND g.phone_normalized = _p))
   ORDER BY g.created_at LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO hospitality.guests (tenant_id, full_name, email, phone) VALUES (_t, _name, _e, _phone)
    RETURNING id INTO _id;
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION hospitality._event_customer(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- הקלט של אירוע (יצירה או עדכון): שדה שלא נשלח — נשאר כמו ב-_base. מחזיר שורה מלאה (בלי שמירה)
CREATE OR REPLACE FUNCTION hospitality._event_apply(_t uuid, _base hospitality.events, _data jsonb)
RETURNS hospitality.events LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e hospitality.events := _base;
  r hospitality.business_terms := hospitality._terms(_t);
  _tz text;
  k text;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'פרטי האירוע לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_data) LOOP
    IF k NOT IN ('property_id', 'guest_id', 'customer', 'event_type', 'event_type_other', 'event_date', 'start_time',
                 'end_time', 'participants', 'price', 'advance_amount', 'amount_paid', 'deposit_amount',
                 'deposit_status', 'internal_notes', 'status', 'lodging_ack') THEN
      RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  IF _data ? 'property_id' THEN
    BEGIN
      e.property_id := (_data ->> 'property_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      e.property_id := NULL;
    END;
    IF e.property_id IS NULL OR NOT EXISTS (SELECT 1 FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = e.property_id) THEN
      RAISE EXCEPTION 'יש לבחור את המתחם של האירוע' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF _data ? 'event_type' THEN
    e.event_type := hospitality._cv_choice(_data -> 'event_type', 'סוג האירוע',
                      ARRAY['bridal_shower', 'bar_mitzvah', 'birthday', 'private_party', 'family_event', 'other']);
  END IF;
  IF _data ? 'event_type_other' OR _data ? 'event_type' THEN
    e.event_type_other := CASE WHEN e.event_type = 'other'
                               THEN hospitality._cv_text(_data -> 'event_type_other', 'סוג האירוע (אחר)', 80, true) END;
  END IF;
  IF _data ? 'event_date' THEN
    e.event_date := hospitality._cv_date(_data -> 'event_date', 'תאריך האירוע');
  END IF;
  IF _data ? 'start_time' THEN
    e.start_time := hospitality._cv_time(_data -> 'start_time', 'שעת ההתחלה');
  END IF;
  IF _data ? 'end_time' THEN
    e.end_time := hospitality._cv_time(_data -> 'end_time', 'שעת הסיום');
  END IF;
  IF e.event_date IS NULL OR e.start_time IS NULL OR e.end_time IS NULL THEN
    RAISE EXCEPTION 'יש למלא תאריך, שעת התחלה ושעת סיום' USING ERRCODE = 'check_violation';
  END IF;
  IF e.event_date NOT BETWEEN current_date - 365 AND current_date + 1100 THEN
    RAISE EXCEPTION 'תאריך האירוע רחוק מדי' USING ERRCODE = 'check_violation';
  END IF;
  IF e.end_time = e.start_time THEN
    RAISE EXCEPTION 'שעת הסיום צריכה להיות אחרי שעת ההתחלה' USING ERRCODE = 'check_violation';
  END IF;
  IF _data ? 'participants' THEN
    e.participants := hospitality._cv_int(_data -> 'participants', 'מספר המשתתפים', 1, 1000);
  END IF;
  IF e.participants IS NULL THEN
    RAISE EXCEPTION 'יש למלא את מספר המשתתפים' USING ERRCODE = 'check_violation';
  END IF;
  IF e.participants > r.max_event_guests THEN
    RAISE EXCEPTION 'עד % משתתפים באירוע (לפי החוזה) — אי אפשר יותר', r.max_event_guests USING ERRCODE = 'check_violation';
  END IF;
  IF _data ? 'price' THEN e.price := hospitality._cv_money(_data -> 'price', 'המחיר', 0, 1000000, false); END IF;
  IF _data ? 'advance_amount' THEN
    e.advance_amount := COALESCE(hospitality._cv_money(_data -> 'advance_amount', 'המקדמה', 0, 1000000, true), 0);
  END IF;
  IF _data ? 'amount_paid' THEN
    e.amount_paid := COALESCE(hospitality._cv_money(_data -> 'amount_paid', 'הסכום ששולם', 0, 1000000, true), 0);
  END IF;
  IF _data ? 'deposit_amount' THEN
    e.deposit_amount := hospitality._cv_money(_data -> 'deposit_amount', 'הפיקדון', 0, 100000, false);
  END IF;
  IF _data ? 'deposit_status' THEN
    e.deposit_status := hospitality._cv_choice(_data -> 'deposit_status', 'מצב הפיקדון',
                                               ARRAY['pending', 'held', 'returned', 'charged']);
  END IF;
  IF _data ? 'internal_notes' THEN
    e.internal_notes := hospitality._cv_text(_data -> 'internal_notes', 'הערות פנימיות', 2000, false);
  END IF;
  IF e.price IS NULL THEN
    RAISE EXCEPTION 'יש למלא את המחיר' USING ERRCODE = 'check_violation';
  END IF;
  e.advance_amount := COALESCE(e.advance_amount, 0);
  e.amount_paid := COALESCE(e.amount_paid, 0);
  IF e.advance_amount > e.price THEN
    RAISE EXCEPTION 'המקדמה לא יכולה להיות גדולה מהמחיר' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(s.timezone, 'Asia/Jerusalem') INTO _tz FROM hospitality.settings s WHERE s.tenant_id = _t;
  _tz := COALESCE(_tz, 'Asia/Jerusalem');
  e.starts_at := ((e.event_date + e.start_time)::timestamp) AT TIME ZONE _tz;
  e.ends_at := ((e.event_date + CASE WHEN e.end_time <= e.start_time THEN 1 ELSE 0 END + e.end_time)::timestamp) AT TIME ZONE _tz;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION hospitality._event_apply(uuid, hospitality.events, jsonb) FROM PUBLIC, anon, authenticated;

-- האירוע של העסק, נעול לעדכון; גרסה צפויה שונה → "עודכן בינתיים"
CREATE OR REPLACE FUNCTION hospitality._staff_event(_t uuid, _id uuid, _expected integer)
RETURNS hospitality.events LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e hospitality.events;
BEGIN
  SELECT * INTO e FROM hospitality.events x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'האירוע לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF _expected IS NOT NULL AND e.revision <> _expected THEN
    RAISE EXCEPTION 'האירוע עודכן בינתיים — רעננו את העמוד' USING ERRCODE = 'serialization_failure';
  END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION hospitality._staff_event(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

-- לפני שמירה של אירוע פעיל: אין אירוע חופף; ובאישור — אורחים בצימרים רק עם אישור מפורש
CREATE OR REPLACE FUNCTION hospitality._event_guard(_t uuid, e hospitality.events, _confirming boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _c jsonb;
  _l jsonb;
BEGIN
  IF e.status NOT IN ('pending', 'confirmed') THEN
    RETURN;
  END IF;
  _c := hospitality._event_conflicts(_t, e.property_id, e.starts_at, e.ends_at, e.id);
  IF jsonb_array_length(_c) > 0 THEN
    RAISE EXCEPTION 'יש כבר אירוע במתחם בזמן הזה (אירוע #% — % %–%)', _c -> 0 ->> 'number', _c -> 0 ->> 'event_date',
                    _c -> 0 ->> 'start_time', _c -> 0 ->> 'end_time' USING ERRCODE = 'exclusion_violation';
  END IF;
  IF _confirming AND e.status = 'confirmed' AND NOT e.lodging_ack THEN
    _l := hospitality._event_lodging(_t, e.property_id, e.starts_at, e.ends_at);
    IF jsonb_array_length(_l) > 0 THEN
      RAISE EXCEPTION 'באותו זמן יש אורחים בצימרים במתחם (% הזמנות) — סמנו שאתם יודעים על כך כדי לאשר',
                      jsonb_array_length(_l) USING ERRCODE = 'check_violation', HINT = 'lodging_ack';
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION hospitality._event_guard(uuid, hospitality.events, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. תנאי העסק — צפייה, שמירה, אישור
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.business_terms_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  RETURN hospitality._terms_json(hospitality._terms(_t)) || jsonb_build_object(
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'property_id', u.property_id,
                                                           'max_adults', u.max_adults, 'max_children', u.max_children,
                                                           'capacity', u.capacity)
                                        ORDER BY u.sort_order, u.created_at)
                         FROM hospitality.units u WHERE u.tenant_id = _t AND u.is_active), '[]'::jsonb),
    'can_edit', hospitality.can('settings'), 'can_confirm', hospitality.can('settings.owner'));
END $$;
REVOKE ALL ON FUNCTION hospitality.business_terms_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.business_terms_view() TO authenticated, service_role;

-- שמירה: כל שינוי מבטל את האישור (בעל העסק מאשר שוב)
CREATE OR REPLACE FUNCTION hospitality.business_terms_save(_data jsonb, _revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  o hospitality.business_terms := hospitality._terms(_t);
  n hospitality.business_terms;
  k text;
  _line jsonb;
  _lines jsonb := '[]'::jsonb;
BEGIN
  IF _data IS NULL OR jsonb_typeof(_data) <> 'object' THEN
    RAISE EXCEPTION 'פרטי התנאים לא תקינים' USING ERRCODE = 'check_violation';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_data) LOOP
    IF k NOT IN ('representative_name', 'business_tax_id', 'representative_signature', 'facilities',
                 'facilities_definite', 'unit_lines', 'max_lodging_guests', 'max_event_guests', 'pool_open_time',
                 'pool_close_time', 'deposit_amount', 'event_late_fee_per_hour', 'lodging_late_fee_per_hour',
                 'free_cancellation_days') THEN
      RAISE EXCEPTION 'שדה לא מוכר: %', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-terms:' || _t, 0));
  o := hospitality._terms(_t);
  IF COALESCE(_revision, 0) <> o.revision THEN
    RAISE EXCEPTION 'התנאים עודכנו בינתיים — רעננו את העמוד' USING ERRCODE = 'serialization_failure';
  END IF;
  n := o;
  IF _data ? 'representative_name' THEN
    n.representative_name := hospitality._cv_text(_data -> 'representative_name', 'שם הנציג המורשה', 80, false);
  END IF;
  IF _data ? 'business_tax_id' THEN
    n.business_tax_id := regexp_replace(COALESCE(hospitality._cv_text(_data -> 'business_tax_id', 'מספר עוסק / ח.פ', 20, false), ''),
                                        '[^0-9]', '', 'g');
    n.business_tax_id := NULLIF(n.business_tax_id, '');
    IF n.business_tax_id IS NOT NULL AND n.business_tax_id !~ '^[0-9]{5,9}$' THEN
      RAISE EXCEPTION 'מספר עוסק / ח.פ — 5 עד 9 ספרות' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF _data ? 'representative_signature' THEN
    n.representative_signature := hospitality._signature_paths(_data -> 'representative_signature', true);
  END IF;
  IF _data ? 'facilities' THEN
    n.facilities := hospitality._cv_text(_data -> 'facilities', 'המתקנים', 300, true);
  END IF;
  IF _data ? 'facilities_definite' THEN
    n.facilities_definite := hospitality._cv_text(_data -> 'facilities_definite', 'המתקנים (בסעיף ההתנהגות)', 300, true);
  END IF;
  IF _data ? 'unit_lines' THEN
    IF jsonb_typeof(_data -> 'unit_lines') <> 'array' OR jsonb_array_length(_data -> 'unit_lines') > 30 THEN
      RAISE EXCEPTION 'רשימת היחידות לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    FOR _line IN SELECT x FROM jsonb_array_elements(_data -> 'unit_lines') x LOOP
      IF jsonb_typeof(_line) <> 'object' THEN
        RAISE EXCEPTION 'רשימת היחידות לא תקינה' USING ERRCODE = 'check_violation';
      END IF;
      -- יחידה של העסק (לסימון "הצימר/ים המוזמנים" בחוזה) — או בלי (שורה בלבד)
      IF _line ? 'unit_id' AND jsonb_typeof(_line -> 'unit_id') <> 'null' AND NOT EXISTS (
           SELECT 1 FROM hospitality.units u WHERE u.tenant_id = _t AND u.id::text = (_line ->> 'unit_id')) THEN
        RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'check_violation';
      END IF;
      _lines := _lines || jsonb_build_array(jsonb_build_object(
        'unit_id', CASE WHEN jsonb_typeof(_line -> 'unit_id') = 'string' THEN _line -> 'unit_id' END,
        'name', hospitality._cv_text(_line -> 'name', 'שם היחידה', 60, true),
        'description', hospitality._cv_text(_line -> 'description', 'למי מיועדת היחידה', 120, true)));
    END LOOP;
    n.unit_lines := _lines;
  END IF;
  IF _data ? 'max_lodging_guests' THEN
    n.max_lodging_guests := hospitality._cv_int(_data -> 'max_lodging_guests', 'מכסת אורחים ללינה', 1, 500);
  END IF;
  IF _data ? 'max_event_guests' THEN
    n.max_event_guests := hospitality._cv_int(_data -> 'max_event_guests', 'מכסת משתתפים באירוע', 1, 50);
  END IF;
  IF _data ? 'pool_open_time' THEN
    n.pool_open_time := COALESCE(hospitality._cv_time(_data -> 'pool_open_time', 'פתיחת הבריכה'), n.pool_open_time);
  END IF;
  IF _data ? 'pool_close_time' THEN
    n.pool_close_time := COALESCE(hospitality._cv_time(_data -> 'pool_close_time', 'סגירת הבריכה'), n.pool_close_time);
  END IF;
  IF n.pool_close_time <= n.pool_open_time THEN
    RAISE EXCEPTION 'שעת סגירת הבריכה צריכה להיות אחרי שעת הפתיחה' USING ERRCODE = 'check_violation';
  END IF;
  IF _data ? 'deposit_amount' THEN
    n.deposit_amount := hospitality._cv_money(_data -> 'deposit_amount', 'הפיקדון', 0, 100000, false);
  END IF;
  IF _data ? 'event_late_fee_per_hour' THEN
    n.event_late_fee_per_hour := hospitality._cv_money(_data -> 'event_late_fee_per_hour', 'דמי איחור באירוע', 0, 10000, false);
  END IF;
  IF _data ? 'lodging_late_fee_per_hour' THEN
    n.lodging_late_fee_per_hour := hospitality._cv_money(_data -> 'lodging_late_fee_per_hour', 'דמי איחור בלינה', 0, 10000, false);
  END IF;
  IF _data ? 'free_cancellation_days' THEN
    n.free_cancellation_days := hospitality._cv_int(_data -> 'free_cancellation_days', 'ימי ביטול בלי חיוב', 0, 365);
  END IF;
  INSERT INTO hospitality.business_terms AS x (tenant_id, representative_name, business_tax_id, representative_signature,
           facilities, facilities_definite, unit_lines, max_lodging_guests, max_event_guests, pool_open_time,
           pool_close_time, deposit_amount, event_late_fee_per_hour, lodging_late_fee_per_hour, free_cancellation_days,
           confirmed_at, confirmed_by, revision, updated_at)
  VALUES (_t, n.representative_name, n.business_tax_id, n.representative_signature, n.facilities, n.facilities_definite,
          n.unit_lines,
          n.max_lodging_guests, n.max_event_guests, n.pool_open_time, n.pool_close_time, n.deposit_amount,
          n.event_late_fee_per_hour, n.lodging_late_fee_per_hour, n.free_cancellation_days, NULL, NULL, 1, now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET representative_name = EXCLUDED.representative_name, business_tax_id = EXCLUDED.business_tax_id,
        representative_signature = EXCLUDED.representative_signature,
        facilities = EXCLUDED.facilities, facilities_definite = EXCLUDED.facilities_definite,
        unit_lines = EXCLUDED.unit_lines, max_lodging_guests = EXCLUDED.max_lodging_guests,
        max_event_guests = EXCLUDED.max_event_guests, pool_open_time = EXCLUDED.pool_open_time,
        pool_close_time = EXCLUDED.pool_close_time, deposit_amount = EXCLUDED.deposit_amount,
        event_late_fee_per_hour = EXCLUDED.event_late_fee_per_hour,
        lodging_late_fee_per_hour = EXCLUDED.lodging_late_fee_per_hour,
        free_cancellation_days = EXCLUDED.free_cancellation_days,
        confirmed_at = NULL, confirmed_by = NULL, revision = x.revision + 1, updated_at = now();
  PERFORM hospitality._audit(_t, 'terms.saved', 'תנאי העסק לחוזים ולאירועים',
    jsonb_build_object('deposit_amount', n.deposit_amount, 'max_event_guests', n.max_event_guests,
                       'max_lodging_guests', n.max_lodging_guests, 'event_late_fee', n.event_late_fee_per_hour,
                       'lodging_late_fee', n.lodging_late_fee_per_hour, 'pool', to_char(n.pool_open_time, 'HH24:MI')
                       || '–' || to_char(n.pool_close_time, 'HH24:MI'), 'units', jsonb_array_length(n.unit_lines)));
  RETURN hospitality.business_terms_view();
END $$;
REVOKE ALL ON FUNCTION hospitality.business_terms_save(jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.business_terms_save(jsonb, integer) TO authenticated, service_role;

-- אישור בעל העסק: "בדקתי — הפרטים והמספרים נכונים לעסק שלי" (בעלים בלבד; רק אחרי שמירה)
CREATE OR REPLACE FUNCTION hospitality.business_terms_confirm(_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings.owner');
  r hospitality.business_terms;
BEGIN
  SELECT * INTO r FROM hospitality.business_terms x WHERE x.tenant_id = _t FOR UPDATE;
  IF r.tenant_id IS NULL THEN
    RAISE EXCEPTION 'שמרו את התנאים לפני האישור' USING ERRCODE = 'check_violation';
  END IF;
  IF r.revision <> COALESCE(_revision, -1) THEN
    RAISE EXCEPTION 'התנאים עודכנו בינתיים — רעננו את העמוד' USING ERRCODE = 'serialization_failure';
  END IF;
  IF r.representative_name IS NULL OR r.business_tax_id IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטי צד א'' לחוזים: שם הנציג המורשה ומספר העוסק' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.business_terms x SET confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
   WHERE x.tenant_id = _t;
  PERFORM hospitality._audit(_t, 'terms.confirmed', 'תנאי העסק לחוזים ולאירועים', jsonb_build_object('revision', r.revision));
  RETURN hospitality.business_terms_view();
END $$;
REVOKE ALL ON FUNCTION hospitality.business_terms_confirm(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.business_terms_confirm(integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. אירועים — רשימה, פרטים, בדיקת זמינות
-- ------------------------------------------------------------
-- _tab: upcoming (ממתין + מאושר, עוד לא הסתיים) | pending | past | cancelled | all
CREATE OR REPLACE FUNCTION hospitality.staff_events(_tab text DEFAULT 'upcoming', _q text DEFAULT NULL,
                                                    _type text DEFAULT NULL, _from date DEFAULT NULL, _to date DEFAULT NULL,
                                                    _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _s text := NULLIF(btrim(COALESCE(_q, '')), '');
  _digits text := NULLIF(regexp_replace(COALESCE(_q, ''), '[^0-9]', '', 'g'), '');
  _rows jsonb;
  _total integer;
BEGIN
  IF _tab NOT IN ('upcoming', 'pending', 'past', 'cancelled', 'all') THEN
    RAISE EXCEPTION 'לשונית לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _type IS NOT NULL AND _type NOT IN ('bridal_shower', 'bar_mitzvah', 'birthday', 'private_party', 'family_event', 'other') THEN
    RAISE EXCEPTION 'סוג האירוע לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  WITH hits AS (
    SELECT e.id, e.starts_at
      FROM hospitality.events e
      JOIN hospitality.guests g ON g.tenant_id = e.tenant_id AND g.id = e.guest_id
     WHERE e.tenant_id = _t
       AND CASE _tab
             WHEN 'upcoming' THEN e.status IN ('pending', 'confirmed') AND e.ends_at > now()
             WHEN 'pending' THEN e.status = 'pending'
             WHEN 'past' THEN e.status = 'completed' OR (e.status = 'confirmed' AND e.ends_at <= now())
             WHEN 'cancelled' THEN e.status = 'cancelled'
             ELSE true END
       AND (_type IS NULL OR e.event_type = _type)
       AND (_from IS NULL OR e.event_date >= _from)
       AND (_to IS NULL OR e.event_date <= _to)
       AND (_s IS NULL OR g.full_name ILIKE '%' || _s || '%' OR g.email_normalized LIKE '%' || lower(_s) || '%'
            OR (_digits IS NOT NULL AND (g.phone_normalized LIKE '%' || _digits || '%' OR e.number::text = _digits)))
  ), page AS (
    -- הקרובים קודם; בעבר / בבוטלו / הכל — האחרונים קודם
    SELECT h.id FROM hits h
     ORDER BY CASE WHEN _tab IN ('past', 'cancelled', 'all') THEN -extract(epoch FROM h.starts_at)
                   ELSE extract(epoch FROM h.starts_at) END, h.id
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)
  )
  SELECT (SELECT count(*)::integer FROM hits),
         COALESCE((SELECT jsonb_agg(hospitality._event_json(e)
                                    ORDER BY CASE WHEN _tab IN ('past', 'cancelled', 'all') THEN -extract(epoch FROM e.starts_at)
                                                  ELSE extract(epoch FROM e.starts_at) END, e.id)
                     FROM hospitality.events e WHERE e.tenant_id = _t AND e.id IN (SELECT id FROM page)), '[]'::jsonb)
    INTO _total, _rows;
  RETURN jsonb_build_object(
    'rows', _rows, 'total', _total,
    'counts', (SELECT jsonb_build_object(
                 'upcoming', count(*) FILTER (WHERE e.status IN ('pending', 'confirmed') AND e.ends_at > now()),
                 'pending', count(*) FILTER (WHERE e.status = 'pending'),
                 'past', count(*) FILTER (WHERE e.status = 'completed' OR (e.status = 'confirmed' AND e.ends_at <= now())),
                 'cancelled', count(*) FILTER (WHERE e.status = 'cancelled'),
                 'all', count(*))
                 FROM hospitality.events e WHERE e.tenant_id = _t),
    'properties', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.sort_order, p.created_at)
                              FROM hospitality.properties p WHERE p.tenant_id = _t AND p.status <> 'archived'), '[]'::jsonb),
    'terms', hospitality._terms_json(hospitality._terms(_t)));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_events(text, text, text, date, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_events(text, text, text, date, date, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.staff_event_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  e hospitality.events;
BEGIN
  SELECT * INTO e FROM hospitality.events x WHERE x.tenant_id = _t AND x.id = _id;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'האירוע לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._event_json(e) || jsonb_build_object(
    'lodging', hospitality._event_lodging(_t, e.property_id, e.starts_at, e.ends_at),
    'conflicts', CASE WHEN e.status IN ('pending', 'confirmed')
                      THEN hospitality._event_conflicts(_t, e.property_id, e.starts_at, e.ends_at, e.id) ELSE '[]'::jsonb END,
    'terms', hospitality._terms_json(hospitality._terms(_t)),
    'log', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'from_status', l.from_status,
                                                         'to_status', l.to_status, 'actor_kind', l.actor_kind,
                                                         'changes', l.changes, 'note', l.note, 'at', hospitality._ts(l.created_at))
                                      ORDER BY l.id DESC)
                       FROM hospitality.event_log l WHERE l.tenant_id = _t AND l.event_id = e.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_event_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_event_detail(uuid) TO authenticated, service_role;

-- בדיקה בלי שמירה (הטופס בודק תוך כדי): אירועים חופפים, אורחים בצימרים, שעות הבריכה, מכסת המשתתפים
CREATE OR REPLACE FUNCTION hospitality.event_check(_data jsonb, _exclude uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  e hospitality.events;
  r hospitality.business_terms := hospitality._terms(_t);
BEGIN
  IF _exclude IS NOT NULL THEN
    SELECT * INTO e FROM hospitality.events x WHERE x.tenant_id = _t AND x.id = _exclude;
    IF e.id IS NULL THEN
      RAISE EXCEPTION 'האירוע לא נמצא' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  -- בזמן ההקלדה המשתתפים / המחיר עוד לא חייבים להיות מלאים (מה שכן נשלח — נבדק כרגיל)
  IF _exclude IS NULL THEN
    e.participants := 1;
    e.price := 0;
  END IF;
  e := hospitality._event_apply(_t, e, (COALESCE(_data, '{}'::jsonb) - 'guest_id' - 'customer' - 'status' - 'lodging_ack'));
  IF e.property_id IS NULL THEN
    RAISE EXCEPTION 'יש לבחור את המתחם של האירוע' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'conflicts', hospitality._event_conflicts(_t, e.property_id, e.starts_at, e.ends_at, _exclude),
    'lodging', hospitality._event_lodging(_t, e.property_id, e.starts_at, e.ends_at),
    'outside_pool_hours', hospitality._event_outside_pool(_t, e.start_time, e.end_time),
    'ends_next_day', e.end_time <= e.start_time,
    'max_event_guests', r.max_event_guests,
    'pool_open_time', to_char(r.pool_open_time, 'HH24:MI'), 'pool_close_time', to_char(r.pool_close_time, 'HH24:MI'));
END $$;
REVOKE ALL ON FUNCTION hospitality.event_check(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.event_check(jsonb, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. אירועים — יצירה, עדכון, מצב
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.event_create(_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  r hospitality.business_terms := hospitality._terms(_t);
  e hospitality.events;
  _status text := COALESCE(_data ->> 'status', 'pending');
BEGIN
  IF _status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'אירוע חדש — ממתין או מאושר' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (_data ? 'property_id') THEN
    RAISE EXCEPTION 'יש לבחור את המתחם של האירוע' USING ERRCODE = 'check_violation';
  END IF;
  -- ברירות המחדל מהחוזה / מתנאי העסק (אפשר לשנות לאירוע)
  e.deposit_amount := r.deposit_amount;
  e.deposit_status := 'pending';
  e.late_fee_per_hour := r.event_late_fee_per_hour;
  e := hospitality._event_apply(_t, e, _data - 'guest_id' - 'customer' - 'status' - 'lodging_ack');
  -- אירוע אחד בכל פעם לכל עסק: המספור והבדיקה (ה-EXCLUDE מכריע גם כך)
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-events:' || _t, 0));
  e.guest_id := hospitality._event_customer(_t, _data);
  e.status := _status;
  e.lodging_ack := COALESCE((_data ->> 'lodging_ack')::boolean, false);
  e.id := gen_random_uuid();
  PERFORM hospitality._event_guard(_t, e, true);
  SELECT COALESCE(max(x.number), 1000) + 1 INTO e.number FROM hospitality.events x WHERE x.tenant_id = _t;
  INSERT INTO hospitality.events (id, tenant_id, number, property_id, guest_id, event_type, event_type_other, event_date,
                                  start_time, end_time, starts_at, ends_at, participants, price, advance_amount, amount_paid,
                                  deposit_amount, deposit_status, late_fee_per_hour, status, lodging_ack, internal_notes,
                                  created_by)
  VALUES (e.id, _t, e.number, e.property_id, e.guest_id, e.event_type, e.event_type_other, e.event_date, e.start_time,
          e.end_time, e.starts_at, e.ends_at, e.participants, e.price, e.advance_amount, e.amount_paid, e.deposit_amount,
          e.deposit_status, e.late_fee_per_hour, e.status, e.lodging_ack, e.internal_notes, auth.uid())
  RETURNING * INTO e;
  PERFORM hospitality._event_log(_t, e.id, 'created', NULL, e.status,
    jsonb_build_object('event_type', e.event_type, 'event_date', e.event_date, 'start_time', to_char(e.start_time, 'HH24:MI'),
                       'end_time', to_char(e.end_time, 'HH24:MI'), 'participants', e.participants, 'price', e.price,
                       'deposit_amount', e.deposit_amount, 'lodging_ack', e.lodging_ack), NULL);
  PERFORM hospitality._audit(_t, 'events.created', 'אירוע #' || e.number,
    jsonb_build_object('event_date', e.event_date, 'participants', e.participants, 'status', e.status));
  RETURN hospitality._event_json(e);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION '%', CASE WHEN SQLERRM LIKE 'יש כבר אירוע%' THEN SQLERRM ELSE 'יש כבר אירוע במתחם בזמן הזה' END
    USING ERRCODE = 'exclusion_violation';
END $$;
REVOKE ALL ON FUNCTION hospitality.event_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.event_create(jsonb) TO authenticated, service_role;

-- עדכון פרטים (לא מצב ולא לקוח): כל שינוי נרשם — לפני ואחרי
CREATE OR REPLACE FUNCTION hospitality.event_update(_id uuid, _revision integer, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  o hospitality.events;
  n hospitality.events;
  _changes jsonb := '{}'::jsonb;
  k text;
BEGIN
  IF _data ? 'status' OR _data ? 'guest_id' OR _data ? 'customer' OR _data ? 'lodging_ack' THEN
    RAISE EXCEPTION 'מצב האירוע והלקוח משתנים בפעולות נפרדות' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-events:' || _t, 0));
  o := hospitality._staff_event(_t, _id, _revision);
  IF o.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'אירוע שבוטל או הסתיים לא משתנה' USING ERRCODE = 'check_violation';
  END IF;
  n := hospitality._event_apply(_t, o, _data);
  -- שינוי זמן / מתחם באירוע מאושר: אישור האורחים בצימרים נבדק מחדש
  IF (n.starts_at, n.ends_at, n.property_id) IS DISTINCT FROM (o.starts_at, o.ends_at, o.property_id) THEN
    n.lodging_ack := false;
    PERFORM hospitality._event_guard(_t, n, true);
  END IF;
  FOR k IN SELECT unnest(ARRAY['property_id', 'event_type', 'event_type_other', 'event_date', 'start_time', 'end_time',
                               'participants', 'price', 'advance_amount', 'amount_paid', 'deposit_amount',
                               'deposit_status', 'internal_notes']) LOOP
    IF to_jsonb(o) -> k IS DISTINCT FROM to_jsonb(n) -> k THEN
      _changes := _changes || jsonb_build_object(k, jsonb_build_object(
        'from', CASE WHEN k = 'internal_notes' THEN to_jsonb(left(o.internal_notes, 80)) ELSE to_jsonb(o) -> k END,
        'to', CASE WHEN k = 'internal_notes' THEN to_jsonb(left(n.internal_notes, 80)) ELSE to_jsonb(n) -> k END));
    END IF;
  END LOOP;
  IF _changes = '{}'::jsonb THEN
    RETURN hospitality._event_json(o);
  END IF;
  UPDATE hospitality.events x
     SET property_id = n.property_id, event_type = n.event_type, event_type_other = n.event_type_other,
         event_date = n.event_date, start_time = n.start_time, end_time = n.end_time, starts_at = n.starts_at,
         ends_at = n.ends_at, participants = n.participants, price = n.price, advance_amount = n.advance_amount,
         amount_paid = n.amount_paid, deposit_amount = n.deposit_amount, deposit_status = n.deposit_status,
         internal_notes = n.internal_notes, lodging_ack = n.lodging_ack, revision = x.revision + 1, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._event_log(_t, n.id, 'updated', NULL, NULL, _changes, NULL);
  PERFORM hospitality._audit(_t, 'events.updated', 'אירוע #' || n.number,
                             jsonb_build_object('fields', (SELECT jsonb_agg(x) FROM jsonb_object_keys(_changes) x)));
  RETURN hospitality._event_json(n);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION '%', CASE WHEN SQLERRM LIKE 'יש כבר אירוע%' THEN SQLERRM ELSE 'יש כבר אירוע במתחם בזמן הזה' END
    USING ERRCODE = 'exclusion_violation';
END $$;
REVOKE ALL ON FUNCTION hospitality.event_update(uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.event_update(uuid, integer, jsonb) TO authenticated, service_role;

-- מצב: pending → confirmed (בדיקת זמינות; אורחים בצימרים — רק עם _lodging_ack), → cancelled (סיבה),
-- confirmed → completed (רק אחרי הסיום), cancelled → pending (פתיחה מחדש — אם הזמן עדיין פנוי)
CREATE OR REPLACE FUNCTION hospitality.event_set_status(_id uuid, _revision integer, _status text,
                                                        _reason text DEFAULT NULL, _lodging_ack boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  o hospitality.events;
  n hospitality.events;
  _r text := NULLIF(btrim(COALESCE(_reason, '')), '');
BEGIN
  IF _status NOT IN ('pending', 'confirmed', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'מצב לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_r) > 300 THEN
    RAISE EXCEPTION 'הסיבה ארוכה מדי (עד 300 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-events:' || _t, 0));
  o := hospitality._staff_event(_t, _id, _revision);
  n := o;
  IF NOT (o.status, _status) IN (('pending', 'confirmed'), ('pending', 'cancelled'), ('confirmed', 'cancelled'),
                                 ('confirmed', 'completed'), ('cancelled', 'pending'), ('confirmed', 'pending')) THEN
    RAISE EXCEPTION 'אי אפשר לעבור ממצב "%" למצב "%"', o.status, _status USING ERRCODE = 'check_violation';
  END IF;
  IF _status = 'completed' AND o.ends_at > now() THEN
    RAISE EXCEPTION 'אפשר לסמן "הסתיים" רק אחרי שעת הסיום' USING ERRCODE = 'check_violation';
  END IF;
  n.status := _status;
  n.cancel_reason := CASE WHEN _status = 'cancelled' THEN _r END;
  n.cancelled_at := CASE WHEN _status = 'cancelled' THEN now() END;
  IF _status = 'confirmed' THEN
    n.lodging_ack := COALESCE(_lodging_ack, false);
  END IF;
  PERFORM hospitality._event_guard(_t, n, _status = 'confirmed');
  UPDATE hospitality.events x
     SET status = n.status, cancel_reason = n.cancel_reason, cancelled_at = n.cancelled_at, lodging_ack = n.lodging_ack,
         revision = x.revision + 1, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO n;
  PERFORM hospitality._event_log(_t, n.id, 'status_changed', o.status, n.status,
    jsonb_build_object('lodging_ack', n.lodging_ack,
                       'lodging', CASE WHEN _status = 'confirmed'
                                       THEN jsonb_array_length(hospitality._event_lodging(_t, n.property_id, n.starts_at, n.ends_at)) END),
    _r);
  PERFORM hospitality._audit(_t, 'events.status', 'אירוע #' || n.number,
                             jsonb_build_object('from', o.status, 'to', n.status));
  RETURN hospitality._event_json(n);
EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION '%', CASE WHEN SQLERRM LIKE 'יש כבר אירוע%' THEN SQLERRM ELSE 'יש כבר אירוע במתחם בזמן הזה' END
    USING ERRCODE = 'exclusion_violation';
END $$;
REVOKE ALL ON FUNCTION hospitality.event_set_status(uuid, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.event_set_status(uuid, integer, text, text, boolean) TO authenticated, service_role;

COMMIT;

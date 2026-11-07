-- ============================================================
-- Rollback של 20261108140000_hosp_packages.sql (מיגרציה 59 — חבילות אירוח וחבילות מיוחדות)
-- מסרב כשיש חבילות או הזמנות של חבילות: החבילות הן תוכן של העסק, ובהזמנת חבילה נשמר מה שהאורח
-- הזמין ואישר (שם, לילות, מחיר, תנאים). קודם מוחקים את החבילות במסך "חבילות" (חבילה בלי הזמנות),
-- ומחליטים מה לעשות בהזמנות של חבילות — הן עצמן הזמנות רגילות על היחידה, במחיר החבילה.
-- _enqueue ו-_guest_view חוזרות לגרסה של מיגרציה 13, staff_booking_detail לגרסה של מיגרציה 16 — מילה
-- במילה. לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "חבילות".
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _packages bigint := 0;
  _bookings bigint := 0;
BEGIN
  IF to_regclass('hospitality.packages') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM hospitality.packages' INTO _packages;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hospitality' AND table_name = 'bookings'
              AND column_name = 'package_id') THEN
    EXECUTE 'SELECT count(*) FROM hospitality.bookings WHERE package_id IS NOT NULL' INTO _bookings;
  END IF;
  IF _bookings > 0 THEN
    RAISE EXCEPTION 'יש % הזמנות של חבילות — פרטי החבילה שהאורח הזמין יאבדו. לפני ה-rollback מחליטים מה לעשות בהן', _bookings;
  END IF;
  IF _packages > 0 THEN
    RAISE EXCEPTION 'יש % חבילות — מחקו אותן במסך "חבילות" לפני ה-rollback', _packages;
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.request_booking_package(uuid, date, text, text, text, text, boolean, text, integer,
                                                            integer, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.package_quote(uuid, date, integer, integer);
DROP FUNCTION IF EXISTS hospitality._package_quote(uuid, uuid, date, integer, integer);
DROP FUNCTION IF EXISTS hospitality.package_delete(uuid);
DROP FUNCTION IF EXISTS hospitality.package_set_active(uuid, boolean);
DROP FUNCTION IF EXISTS hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                 uuid, uuid[], integer);
DROP FUNCTION IF EXISTS hospitality._package_slug(uuid, text, uuid);
DROP FUNCTION IF EXISTS hospitality.packages_view();
DROP FUNCTION IF EXISTS hospitality.public_packages();
DROP FUNCTION IF EXISTS hospitality._package_json(uuid, hospitality.packages, boolean);
DROP FUNCTION IF EXISTS hospitality._package_media(uuid, uuid[]);

-- התור של המיילים — הגרסה של מיגרציה 13 (בלי שם החבילה)
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

-- עמודי האורח — הגרסה של מיגרציה 13 (בלי שם החבילה)
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

-- עמוד ההזמנה בניהול — הגרסה של מיגרציה 16 (בלי החבילה)
CREATE OR REPLACE FUNCTION hospitality.staff_booking_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  b hospitality.bookings;
  g hospitality.guests;
  u hospitality.units;
  _property text;
  _full boolean := hospitality.can('guests');
  _today date;
BEGIN
  SELECT * INTO b FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.id = _id;
  IF b.id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = b.guest_id;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = b.unit_id;
  SELECT p.name INTO _property FROM hospitality.properties p WHERE p.tenant_id = _t AND p.id = u.property_id;
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;

  RETURN jsonb_build_object(
    'id', b.id, 'number', b.number, 'status', b.status, 'state', hospitality._booking_state(b),
    'tab', hospitality._booking_tab(hospitality._booking_state(b), b.check_out, COALESCE(_today, current_date)),
    'today', COALESCE(_today, current_date), 'revision', b.revision,
    'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights,
    'adults', b.adults, 'children', b.children,
    'unit', jsonb_build_object('id', u.id, 'name', u.name, 'kind', u.kind, 'property_name', _property),
    'currency', b.currency, 'subtotal', b.subtotal, 'discount', b.discount, 'total', b.total,
    'deposit_amount', b.deposit_amount, 'amount_paid', b.amount_paid, 'payment_status', b.payment_status,
    'price_manual', b.price_manual,
    'source', b.source, 'channel', b.channel,
    'created_at', hospitality._ts(b.created_at), 'updated_at', hospitality._ts(b.updated_at),
    'hold_expires_at', hospitality._ts(b.hold_expires_at),
    'special_requests', b.special_requests, 'notes', b.notes,
    'cancellation_requested_at', hospitality._ts(b.cancellation_requested_at),
    'cancellation_reason', b.cancellation_reason, 'cancellation_outcome', b.cancellation_outcome,
    'policy', b.policy_snapshot - 'schedule',
    'policy_schedule', b.policy_snapshot -> 'schedule',
    'house_rules', b.house_rules_snapshot,
    'guest', jsonb_build_object(
      'id', g.id, 'name', g.full_name, 'anonymized', g.anonymized_at IS NOT NULL,
      'contact_full', _full,
      'phone', CASE WHEN _full THEN g.phone ELSE hospitality.mask_phone(g.phone) END,
      'email', CASE WHEN _full THEN g.email ELSE hospitality.mask_email(g.email) END,
      'bookings_count', (SELECT count(*) FROM hospitality.bookings x WHERE x.tenant_id = _t AND x.guest_id = g.id)),
    'nights_detail', COALESCE((SELECT jsonb_agg(jsonb_build_object('night', n.night, 'base_rate', n.base_rate,
                                                                   'extras', n.extras, 'price', n.price,
                                                                   'rule', n.rule_applied) ORDER BY n.night)
                                 FROM hospitality.booking_nights n WHERE n.tenant_id = _t AND n.booking_id = b.id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'kind', e.kind, 'from', e.from_status, 'to', e.to_status, 'actor_kind', e.actor_kind,
                          'actor', CASE WHEN e.actor_kind = 'staff' THEN
                                     COALESCE((SELECT CASE WHEN ur.is_protected THEN 'הבעלים'
                                                     ELSE COALESCE(ur.display_name, hospitality.mask_email(ur.email)) END
                                                 FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = e.actor_id),
                                              'צוות') END,
                          'note', e.note, 'changes', e.changes, 'at', hospitality._ts(e.created_at))
                          ORDER BY e.created_at, e.id)
                         FROM hospitality.booking_events e WHERE e.tenant_id = _t AND e.booking_id = b.id), '[]'::jsonb),
    'emails', hospitality.staff_email_status(b.id));
END $$;

DROP INDEX IF EXISTS hospitality.bookings_package_idx;
ALTER TABLE hospitality.bookings DROP CONSTRAINT IF EXISTS bookings_package_snapshot_check;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS package_snapshot;
ALTER TABLE hospitality.bookings DROP COLUMN IF EXISTS package_id;
DROP TABLE IF EXISTS hospitality.packages;

COMMIT;

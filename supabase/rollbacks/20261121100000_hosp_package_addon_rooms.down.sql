-- ============================================================
-- Rollback: 20261121100000_hosp_package_addon_rooms.sql — חדרים נוספים לחבילה (מיגרציה 202)
--   • הגנה: נעצר כשיש הזמנה של חדר נוסף לחבילה (נתוני לקוחות), או כשבעל עסק הגדיר חדרים נוספים בחבילה
--     (העבודה שלו) — שום דבר לא משתנה. ההזמנות עצמן אינן נמחקות לעולם.
--   • מוחק את הפונקציות החדשות ואת שלוש העמודות; package_save / _package_json / packages_view / _enqueue /
--     _guest_view חוזרות לגרסה של מיגרציה 59 מילה במילה.
--   • אחרי ה-rollback הסכמה זהה בדיוק לזו שלפני המיגרציה.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
DECLARE
  _rooms bigint;
  _packages bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'hospitality' AND table_name = 'packages' AND column_name = 'addon_unit_ids') THEN
    SELECT count(*) INTO _rooms FROM hospitality.bookings b WHERE b.package_snapshot ->> 'role' = 'addon';
    IF _rooms > 0 THEN
      RAISE EXCEPTION 'rollback stopped: % bookings are add-on rooms of a package — nothing changed', _rooms;
    END IF;
    EXECUTE 'SELECT count(*) FROM hospitality.packages p WHERE cardinality(p.addon_unit_ids) > 0' INTO _packages;
    IF _packages > 0 THEN
      RAISE EXCEPTION 'rollback stopped: % packages have add-on rooms configured — nothing changed', _packages;
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS hospitality.request_booking_package_with_rooms_with_documents(jsonb, uuid, date, jsonb, text, text,
                                                                                      text, text, boolean, text, integer,
                                                                                      integer, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.request_booking_package_with_rooms(uuid, date, jsonb, text, text, text, text, boolean,
                                                                       text, integer, integer, text, boolean, text);
DROP FUNCTION IF EXISTS hospitality.package_rooms_quote(uuid, date, integer, integer, jsonb);
DROP FUNCTION IF EXISTS hospitality.package_addons_quote(uuid, date);
DROP FUNCTION IF EXISTS hospitality._package_rooms_quote(uuid, uuid, date, integer, integer, jsonb);
DROP FUNCTION IF EXISTS hospitality._package_addon_room(uuid, hospitality.packages, uuid, date, date, integer, integer, uuid);
DROP FUNCTION IF EXISTS hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                 uuid, uuid[], integer, jsonb);

-- מיגרציה 59, מילה במילה
-- חדשה (_id NULL) או עדכון (עם הגרסה שהמסך מכיר). חבילה חדשה נשמרת מוסתרת — מציגים אותה באתר במתג.
CREATE OR REPLACE FUNCTION hospitality.package_save(
  _id uuid, _unit_id uuid, _kind text, _name text, _nights integer, _price numeric, _max_guests integer,
  _description text DEFAULT NULL, _terms text DEFAULT NULL, _stay_from date DEFAULT NULL, _stay_to date DEFAULT NULL,
  _policy_id uuid DEFAULT NULL, _media_ids uuid[] DEFAULT '{}'::uuid[], _expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
  _n text := btrim(COALESCE(_name, ''));
  _d text := NULLIF(btrim(COALESCE(_description, '')), '');
  _terms_t text := NULLIF(btrim(COALESCE(_terms, '')), '');
  _media uuid[];
  u hospitality.units;
  p hospitality.packages;
  _before hospitality.packages;
BEGIN
  IF char_length(_n) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'שם החבילה — בין 2 ל-80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('package', 'special') THEN
    RAISE EXCEPTION 'סוג החבילה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _nights IS NULL OR _nights NOT BETWEEN 1 AND 14 THEN
    RAISE EXCEPTION 'מספר הלילות בחבילה — בין 1 ל-14' USING ERRCODE = 'check_violation';
  END IF;
  IF _price IS NULL OR _price <= 0 OR _price > 1000000 OR _price <> round(_price, 2) THEN
    RAISE EXCEPTION 'מחיר החבילה לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _d IS NOT NULL AND char_length(_d) > 4000 THEN
    RAISE EXCEPTION 'התיאור ארוך מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _terms_t IS NOT NULL AND char_length(_terms_t) > 4000 THEN
    RAISE EXCEPTION 'התנאים ארוכים מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _stay_from IS NOT NULL AND _stay_to IS NOT NULL AND _stay_to - _stay_from < _nights THEN
    RAISE EXCEPTION 'התקופה של החבילה קצרה ממספר הלילות בה' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO u FROM hospitality.units x WHERE x.tenant_id = _t AND x.id = _unit_id;
  IF u.id IS NULL THEN
    RAISE EXCEPTION 'היחידה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _max_guests IS NULL OR _max_guests < 1 OR _max_guests > u.capacity THEN
    RAISE EXCEPTION 'מספר האורחים בחבילה — בין 1 ל-% (התפוסה של היחידה)', u.capacity USING ERRCODE = 'check_violation';
  END IF;
  IF _policy_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = _policy_id AND NOT x.is_archived) THEN
    RAISE EXCEPTION 'מדיניות הביטול לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF cardinality(COALESCE(_media_ids, '{}'::uuid[])) > 12 THEN
    RAISE EXCEPTION 'עד 12 תמונות לחבילה' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(COALESCE(_media_ids, '{}'::uuid[])) <> (SELECT count(DISTINCT x) FROM unnest(COALESCE(_media_ids, '{}'::uuid[])) x) THEN
    RAISE EXCEPTION 'כל תמונה — פעם אחת בחבילה' USING ERRCODE = 'check_violation';
  END IF;
  _media := hospitality._package_media(_t, _media_ids);
  IF cardinality(_media) <> cardinality(COALESCE(_media_ids, '{}'::uuid[])) THEN
    RAISE EXCEPTION 'אפשר לבחור רק תמונות מהגלריות של העסק' USING ERRCODE = 'check_violation';
  END IF;

  IF _id IS NULL THEN
    IF (SELECT count(*) FROM hospitality.packages x WHERE x.tenant_id = _t) >= 50 THEN
      RAISE EXCEPTION 'אפשר עד 50 חבילות לעסק' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO hospitality.packages (tenant_id, unit_id, kind, name, slug, description, terms, nights, price,
                                      max_guests, stay_from, stay_to, policy_id, media_ids, sort_order)
    VALUES (_t, u.id, _kind, _n, hospitality._package_slug(_t, _n, NULL), _d, _terms_t, _nights, _price,
            _max_guests, _stay_from, _stay_to, _policy_id, _media,
            COALESCE((SELECT max(x.sort_order) + 1 FROM hospitality.packages x WHERE x.tenant_id = _t), 0))
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.created', p.name,
                               jsonb_build_object('unit', u.name, 'nights', p.nights, 'price', p.price));
  ELSE
    SELECT * INTO _before FROM hospitality.packages x WHERE x.tenant_id = _t AND x.id = _id FOR UPDATE;
    IF _before.id IS NULL THEN
      RAISE EXCEPTION 'החבילה לא נמצאה' USING ERRCODE = 'no_data_found';
    END IF;
    IF _expected_revision IS NOT NULL AND _before.revision <> _expected_revision THEN
      RAISE EXCEPTION 'החבילה השתנתה בינתיים — רעננו ונסו שוב' USING ERRCODE = 'serialization_failure';
    END IF;
    UPDATE hospitality.packages x
       SET unit_id = u.id, kind = _kind, name = _n, description = _d, terms = _terms_t, nights = _nights,
           price = _price, max_guests = _max_guests, stay_from = _stay_from, stay_to = _stay_to,
           policy_id = _policy_id, media_ids = _media, revision = x.revision + 1, updated_at = now(),
           slug = CASE WHEN x.name = _n THEN x.slug ELSE hospitality._package_slug(_t, _n, x.id) END
     WHERE x.id = _before.id
    RETURNING * INTO p;
    PERFORM hospitality._audit(_t, 'packages.updated', p.name,
                               jsonb_strip_nulls(jsonb_build_object(
                                 'price', CASE WHEN _before.price <> p.price
                                               THEN jsonb_build_object('from', _before.price, 'to', p.price) END,
                                 'nights', CASE WHEN _before.nights <> p.nights
                                                THEN jsonb_build_object('from', _before.nights, 'to', p.nights) END,
                                 'unit', CASE WHEN _before.unit_id <> p.unit_id THEN u.name END)));
  END IF;
  RETURN hospitality._package_json(_t, p, true);
END $$;
REVOKE ALL ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                uuid, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.package_save(uuid, uuid, text, text, integer, numeric, integer, text, text, date, date,
                                                   uuid, uuid[], integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality._package_json(_t uuid, p hospitality.packages, _staff boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'kind', p.kind, 'name', p.name, 'description', p.description, 'terms', p.terms,
    'nights', p.nights, 'price', p.price, 'max_guests', p.max_guests, 'stay_from', p.stay_from, 'stay_to', p.stay_to,
    'unit_id', p.unit_id, 'media_ids', to_jsonb(hospitality._package_media(_t, p.media_ids)),
    'sort_order', p.sort_order,
    'policy', CASE WHEN p.policy_id IS NULL OR NOT EXISTS (
                     SELECT 1 FROM hospitality.policies x WHERE x.tenant_id = _t AND x.id = p.policy_id AND NOT x.is_archived)
                   THEN NULL ELSE hospitality._public_policy(_t, p.policy_id) END)
  || CASE WHEN _staff THEN jsonb_build_object(
       'is_active', p.is_active, 'policy_id', p.policy_id, 'revision', p.revision,
       'unit_name', (SELECT u.name FROM hospitality.units u WHERE u.tenant_id = _t AND u.id = p.unit_id),
       'bookings_count', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.package_id = p.id),
       'updated_at', hospitality._ts(p.updated_at))
     ELSE '{}'::jsonb END;
$$;
REVOKE ALL ON FUNCTION hospitality._package_json(uuid, hospitality.packages, boolean) FROM PUBLIC, anon, authenticated;

-- לצוות: כל החבילות (גם המוסתרות), היחידות והמדיניות לבחירה
CREATE OR REPLACE FUNCTION hospitality.packages_view()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('catalog');
BEGIN
  RETURN jsonb_build_object(
    'packages', COALESCE((SELECT jsonb_agg(hospitality._package_json(_t, p, true) ORDER BY p.sort_order, p.created_at, p.id)
                            FROM hospitality.packages p WHERE p.tenant_id = _t), '[]'::jsonb),
    'units', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'id', u.id, 'name', u.name, 'property_id', u.property_id, 'property_name', pr.name,
                                 'capacity', u.capacity, 'is_active', u.is_active)
                               ORDER BY pr.sort_order, u.sort_order, u.created_at)
                         FROM hospitality.units u
                         JOIN hospitality.properties pr ON pr.tenant_id = u.tenant_id AND pr.id = u.property_id
                        WHERE u.tenant_id = _t AND pr.status <> 'archived'), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'is_default', x.is_default)
                                           ORDER BY x.is_default DESC, x.name)
                            FROM hospitality.policies x WHERE x.tenant_id = _t AND NOT x.is_archived), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.packages_view() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.packages_view() TO authenticated, service_role;

-- מיגרציה 13 + שם החבילה (רק בהזמנת חבילה)
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
                               'hold_expires_at', hospitality._ts(_b.hold_expires_at))
            -- שלב א' 7: הזמנת חבילה — שם החבילה בכל מייל שלה
            || CASE WHEN _b.package_snapshot IS NOT NULL
                    THEN jsonb_build_object('package_name', _b.package_snapshot ->> 'name') ELSE '{}'::jsonb END
            || COALESCE(_extra, '{}'::jsonb))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS _added = ROW_COUNT;
    _n := _n + _added;
  END LOOP;
  RETURN _n;
END $$;

-- מיגרציה 13 + שם החבילה (ריק בהזמנה רגילה) — לעמוד ההזמנה ולאזור "ההזמנות שלי"
CREATE OR REPLACE FUNCTION hospitality._guest_view(_b hospitality.bookings)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', _b.id, 'number', _b.number, 'status', _b.status, 'unit_name', u.name,
    'check_in', _b.check_in, 'check_out', _b.check_out, 'nights', _b.check_out - _b.check_in,
    'adults', _b.adults, 'children', _b.children, 'total', _b.total, 'currency', _b.currency,
    'deposit_amount', _b.deposit_amount, 'amount_paid', _b.amount_paid,
    'hold_expires_at', hospitality._ts(_b.hold_expires_at),
    'policy', _b.policy_snapshot, 'cancellation_outcome', _b.cancellation_outcome,
    'can_request_cancellation', _b.status IN ('pending_approval', 'pending_payment', 'confirmed'),
    'package_name', _b.package_snapshot ->> 'name')
    FROM hospitality.units u WHERE u.tenant_id = _b.tenant_id AND u.id = _b.unit_id;
$$;

DROP FUNCTION IF EXISTS hospitality._package_addons_json(uuid, hospitality.packages, boolean);
DROP FUNCTION IF EXISTS hospitality._package_addon_unit_ok(uuid, uuid, uuid);
ALTER TABLE hospitality.packages DROP CONSTRAINT IF EXISTS packages_addons_check;
ALTER TABLE hospitality.packages DROP COLUMN IF EXISTS addon_max;
ALTER TABLE hospitality.packages DROP COLUMN IF EXISTS addon_nightly_price;
ALTER TABLE hospitality.packages DROP COLUMN IF EXISTS addon_unit_ids;

NOTIFY pgrst, 'reload schema';
COMMIT;

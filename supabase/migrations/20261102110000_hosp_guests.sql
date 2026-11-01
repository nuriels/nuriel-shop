-- ============================================================
-- Hospitality Stage 2j — אורחים ופרטיות
--
--   • staff_guests(q, limit, offset) — רשימת האורחים: שם, פרטי קשר ממוסכים, מספר שהיות,
--     השהייה האחרונה / הבאה; חיפוש לפי שם / טלפון / אימייל (הרשאת guests);
--   • staff_guest_detail(id) — כרטיס אורח: פרטי קשר מלאים, הערות, ההזמנות שלו;
--   • update_guest_notes(id, notes) — הערות פנימיות (G9), ביומן בלי התוכן;
--   • export_guest_logged(id) — ייצוא (בעלים בלבד, guests.privacy) עם רישום ביומן הפעולות;
--     export_guest (Stage 2a) כבר לא נקרא ישירות — כדי שכל ייצוא יירשם (security plan PRIV-07);
--   • anonymize_guest — מוגדרת מחדש עם רישום ביומן (בלי פרטים אישיים).
-- בלי טבלה או עמודה חדשה.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION hospitality.staff_guests(_q text DEFAULT NULL, _limit integer DEFAULT 50,
                                                    _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests');
  _query text := NULLIF(btrim(COALESCE(_q, '')), '');
  _digits text;
  _today date;
BEGIN
  IF _limit NOT BETWEEN 1 AND 100 OR _offset < 0 OR _offset > 100000 THEN
    RAISE EXCEPTION 'עמוד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _query IS NOT NULL AND char_length(_query) > 100 THEN
    RAISE EXCEPTION 'החיפוש ארוך מדי' USING ERRCODE = 'check_violation';
  END IF;
  _digits := regexp_replace(COALESCE(_query, ''), '[^0-9]', '', 'g');
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  RETURN (
    WITH g AS (
      SELECT x.*,
             (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = x.id
                 AND b.status IN ('confirmed', 'checked_in', 'checked_out', 'cancel_requested')) AS stays,
             (SELECT max(b.check_in) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = x.id
                 AND b.status IN ('checked_in', 'checked_out')) AS last_stay,
             (SELECT min(b.check_in) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = x.id
                 AND b.status IN ('confirmed', 'pending_approval', 'pending_payment', 'cancel_requested')
                 AND b.check_in >= _today) AS next_stay
        FROM hospitality.guests x
       WHERE x.tenant_id = _t
         AND (_query IS NULL
              OR x.full_name ILIKE '%' || _query || '%'
              OR (length(_digits) >= 4 AND x.phone_normalized LIKE '%' || _digits || '%')
              OR (position('@' IN _query) > 0 AND x.email_normalized ILIKE '%' || lower(_query) || '%'))
    )
    SELECT jsonb_build_object(
      'q', _query, 'limit', _limit, 'offset', _offset,
      'total', (SELECT count(*) FROM g),
      'items', COALESCE((
        SELECT jsonb_agg(row ORDER BY ord) FROM (
          SELECT jsonb_build_object(
                   'id', g.id, 'name', g.full_name, 'anonymized', g.anonymized_at IS NOT NULL,
                   'phone', hospitality.mask_phone(g.phone), 'email', hospitality.mask_email(g.email),
                   'stays', g.stays, 'last_stay', g.last_stay, 'next_stay', g.next_stay,
                   'has_notes', g.notes IS NOT NULL AND g.notes <> '',
                   'created_at', hospitality._ts(g.created_at)) AS row,
                 row_number() OVER (ORDER BY g.next_stay NULLS LAST, g.last_stay DESC NULLS LAST, g.created_at DESC) AS ord
            FROM g
           ORDER BY ord
           LIMIT _limit OFFSET _offset) q), '[]'::jsonb)));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_guests(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_guests(text, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.staff_guest_detail(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests');
  g hospitality.guests;
BEGIN
  SELECT * INTO g FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _id;
  IF g.id IS NULL THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object(
    'id', g.id, 'name', g.full_name, 'phone', g.phone, 'email', g.email, 'notes', g.notes,
    'marketing_consent', g.marketing_consent, 'has_account', g.user_id IS NOT NULL,
    'anonymized_at', hospitality._ts(g.anonymized_at),
    'created_at', hospitality._ts(g.created_at), 'updated_at', hospitality._ts(g.updated_at),
    'can_privacy', hospitality.can('guests.privacy'),
    'active_bookings', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.guest_id = g.id
                          AND b.status IN ('pending_approval', 'pending_payment', 'confirmed', 'cancel_requested', 'checked_in')),
    'bookings', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', b.id, 'number', b.number, 'status', b.status, 'state', hospitality._booking_state(b),
                  'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights,
                  'total', b.total, 'currency', b.currency, 'unit_name', u.name) ORDER BY b.check_in DESC)
                FROM hospitality.bookings b
                JOIN hospitality.units u ON u.tenant_id = b.tenant_id AND u.id = b.unit_id
               WHERE b.tenant_id = _t AND b.guest_id = g.id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_guest_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_guest_detail(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.update_guest_notes(_id uuid, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests');
  _n text := NULLIF(btrim(COALESCE(_notes, '')), '');
  g hospitality.guests;
BEGIN
  IF _n IS NOT NULL AND char_length(_n) > 2000 THEN
    RAISE EXCEPTION 'ההערות ארוכות מדי (עד 2000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.guests x SET notes = _n, updated_at = now()
   WHERE x.tenant_id = _t AND x.id = _id AND x.anonymized_at IS NULL
  RETURNING * INTO g;
  IF g.id IS NULL THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._audit(_t, 'guests.notes_updated', g.full_name, jsonb_build_object('notes', jsonb_build_object('changed', true)));
  RETURN jsonb_build_object('id', g.id, 'notes', g.notes, 'updated_at', hospitality._ts(g.updated_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.update_guest_notes(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.update_guest_notes(uuid, text) TO authenticated, service_role;

-- ייצוא עם רישום ביומן — הבעלים בלבד (guests.privacy נבדק ב-export_guest)
CREATE OR REPLACE FUNCTION hospitality.export_guest_logged(_guest_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('guests.privacy');
  _data jsonb := hospitality.export_guest(_guest_id);
BEGIN
  PERFORM hospitality._audit(_t, 'guests.exported', _data -> 'guest' ->> 'full_name', '{}'::jsonb);
  RETURN _data;
END $$;
REVOKE ALL ON FUNCTION hospitality.export_guest_logged(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.export_guest_logged(uuid) TO authenticated, service_role;
-- הייצוא הישיר — רק דרך הפונקציה שרושמת ביומן
REVOKE EXECUTE ON FUNCTION hospitality.export_guest(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION hospitality.anonymize_guest(_guest_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._staff_tenant('guests.privacy');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hospitality.guests x WHERE x.tenant_id = _t AND x.id = _guest_id) THEN
    RAISE EXCEPTION 'האורח לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM hospitality._anonymize_guest(_t, _guest_id);
  -- ביומן: רק שהפעולה נעשתה (בלי שם, אימייל או טלפון)
  PERFORM hospitality._audit(_t, 'guests.anonymized', 'אורח', '{}'::jsonb);
  RETURN true;
END $$;

COMMIT;

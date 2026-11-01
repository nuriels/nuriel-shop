-- ============================================================
-- Rollback של 20261105090000_hosp_dashboard.sql (שלב F3)
--   • מחזיר את permissions() / can() (מיגרציה 10) ואת team_members() / team_remove_manager()
--     (מיגרציה 8) בדיוק כמו שהיו — בלי הרשאת "נתונים כספיים".
--   • מוחק את פונקציות לוח הבקרה החדשות, את האינדקסים ואת טבלת ההרשאות שניתנו למנהלים
--     (אחרי ה-rollback המנהלים רואים שוב את נתוני הכסף כמו לפני השלב — התנהגות הגרסה הקודמת).
--   • לא נוגע בהזמנות, בתשלומים או בשום נתון אחר.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי לוח הבקרה החדש.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

DROP FUNCTION IF EXISTS hospitality.dashboard_tasks();
DROP FUNCTION IF EXISTS hospitality.dashboard_today();
DROP FUNCTION IF EXISTS hospitality._dashboard_stay(hospitality.bookings);
DROP FUNCTION IF EXISTS hospitality._short_guest_name(text, boolean);
DROP FUNCTION IF EXISTS hospitality.dashboard_overview(date, date);
DROP FUNCTION IF EXISTS hospitality._dashboard_series(uuid, text, date, date, text, integer, boolean);
DROP FUNCTION IF EXISTS hospitality._dashboard_numbers(uuid, text, date, date, integer, boolean);
DROP FUNCTION IF EXISTS hospitality._dashboard_nights(uuid, date, date);
DROP FUNCTION IF EXISTS hospitality.team_set_finance(uuid, boolean);

DROP INDEX IF EXISTS hospitality.bookings_created_idx;
DROP INDEX IF EXISTS hospitality.booking_nights_night_idx;
DROP INDEX IF EXISTS hospitality.payments_paid_idx;
DROP INDEX IF EXISTS hospitality.booking_events_status_idx;

-- ---------- לוח הבקרה של שלב 2k (מיגרציה 20261102120000) — בדיוק כמו שהיה ----------
CREATE OR REPLACE FUNCTION hospitality.dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _units integer;
  _month_start date;
BEGIN
  SELECT (now() AT TIME ZONE s.timezone)::date INTO _today FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);
  _month_start := date_trunc('month', _today)::date;
  -- יחידות פיזיות פעילות ("כל המתחם" נספר דרך יחידותיו)
  SELECT count(*) INTO _units FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property';
  RETURN jsonb_build_object(
    'today', _today,
    'units', _units,
    'arrivals_today', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                         AND b.check_in = _today AND b.status IN ('confirmed', 'cancel_requested')),
    'departures_today', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                           AND b.check_out = _today AND b.status = 'checked_in'),
    'staying', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'checked_in'),
    'pending', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t
                  AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()),
    'cancel_requests', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'cancel_requested'),
    'failed_emails', (SELECT count(*) FROM hospitality.notifications n WHERE n.tenant_id = _t AND n.status IN ('failed', 'dead')),
    -- תפוסה: לילות תפוסים ביחידות פיזיות (הזמנות שמחזיקות מלאי) מתוך יחידות × לילות
    'occupied_tonight', (SELECT count(DISTINCT o.unit_id) FROM hospitality.unit_occupancy o
                           JOIN hospitality.units u ON u.tenant_id = o.tenant_id AND u.id = o.unit_id
                          WHERE o.tenant_id = _t AND o.booking_id IS NOT NULL AND u.kind <> 'whole_property'
                            AND o.nights @> _today),
    'blocked_tonight', (SELECT count(DISTINCT o.unit_id) FROM hospitality.unit_occupancy o
                          JOIN hospitality.units u ON u.tenant_id = o.tenant_id AND u.id = o.unit_id
                         WHERE o.tenant_id = _t AND o.block_id IS NOT NULL AND o.booking_id IS NULL
                           AND u.kind <> 'whole_property' AND o.nights @> _today),
    'occupancy_7', hospitality._occupancy(_t, _today, 7, _units),
    'occupancy_30', hospitality._occupancy(_t, _today, 30, _units),
    'revenue_month', (SELECT COALESCE(sum(n.price), 0) FROM hospitality.booking_nights n
                        JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
                       WHERE n.tenant_id = _t AND n.night >= _month_start AND n.night < (_month_start + interval '1 month')::date
                         AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')),
    'currency', COALESCE((SELECT s.currency FROM hospitality.settings s WHERE s.tenant_id = _t), 'ILS'),
    'recent', COALESCE((SELECT jsonb_agg(r ORDER BY (r ->> 'created_at') DESC) FROM (
                 SELECT jsonb_build_object('id', b.id, 'number', b.number, 'status', b.status,
                          'state', hospitality._booking_state(b), 'guest_name', g.full_name, 'unit_name', u.name,
                          'check_in', b.check_in, 'check_out', b.check_out, 'total', b.total,
                          'created_at', hospitality._ts(b.created_at)) AS r
                   FROM hospitality.bookings b
                   JOIN hospitality.guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
                   JOIN hospitality.units u ON u.tenant_id = b.tenant_id AND u.id = b.unit_id
                  WHERE b.tenant_id = _t
                  ORDER BY b.created_at DESC LIMIT 5) z), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard() TO authenticated, service_role;

-- ---------- הצוות (מיגרציה 8) ----------
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

-- ---------- ההרשאות (מיגרציה 10) ----------
CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner']::text[];
$$;
REVOKE ALL ON FUNCTION hospitality.permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.permissions() TO authenticated, service_role;

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
          WHEN 'manager' THEN _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                                  'settings.owner', 'catalog.owner')
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

DROP TABLE IF EXISTS hospitality.staff_grants;

NOTIFY pgrst, 'reload schema';

COMMIT;

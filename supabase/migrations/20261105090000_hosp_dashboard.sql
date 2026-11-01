-- ============================================================
-- Hospitality — לוח הבקרה של בעל העסק (שלב F3)
--
-- 1. הרשאת "נתונים כספיים" (reports.finance):
--    • לבעלים — תמיד. למנהל — רק אם הבעלים נתן לו במפורש (staff_grants). ברירת המחדל: לא.
--    • team_set_finance(_user_id, _enabled) — הבעלים בלבד; ביומן הפעולות.
--    • team_members() מציג למי יש; team_remove_manager() מוחק את ההרשאות של מי שהוסר.
--    • ההרשאה נאכפת במסד: dashboard_overview מחזירה הכנסות / גבייה / ADR רק למי שיש לו אותה.
--    (נתוני הכסף של הזמנה בודדת — במסכי ההזמנות — נשארים כמו היום: המנהלים מטפלים בתשלומים.)
--
-- 2. dashboard_overview(_from, _to) — הנתונים לתקופה (עד שנה), ותקופה קודמת באותו אורך להשוואה
--    (רק כשהאתר כבר היה קיים בה — לא מציגים השוואה מומצאת), וגרף לפי יום / שבוע / חודש:
--    • הזמנות — נוצרו בתקופה (שעון העסק), בלי שנדחו / פגו / בוטלו.
--    • הכנסות — ערך לילות האירוח שבתוך התקופה, אחרי הנחות (מחיר הלילה × סה"כ / סכום ביניים),
--      בהזמנות מאושרות / שוהים / שעזבו. בלי מבוטלות.
--    • גבייה בפועל — תשלומים שנרשמו (בניכוי החזרים) לפי תאריך התשלום. תשלום שבוטל לא נספר.
--    • תפוסה — לילות-יחידה תפוסים ÷ לילות-יחידה זמינים, ביחידות הפיזיות הפעילות:
--      תפוסים = הזמנות (מתחם שלם — בכל היחידות שבו) + תאריכים מסונכרנים מ-Airbnb / Booking ושאר
--      הערוצים; כל לילה-יחידה נספר פעם אחת (בלי ספירה כפולה); בלי מבוטלות.
--      חסימה פנימית — לא לינה: מורידה את הזמינות (המכנה) ולא נספרת כתפוסה.
--    • ביטולים — הזמנות שבוטלו / לא הגיעו בתקופה (לפי יומן ההזמנה).
--    • ממתינות — עכשיו (לא תלוי בתקופה), עם מועד הפקיעה הקרוב.
--    הרשאה: reports ("לוח בקרה ודוחות" — בעלים ומנהלים).
-- 3. dashboard_today() — מגיעים / עוזבים היום, שוהים, וצ'ק-אין ב-7 הימים הקרובים (שם פרטי + אות).
-- 4. dashboard_tasks() — מה דורש טיפול: בקשות לאישור, בקשות ביטול, מקדמות לגבייה, יומנים
--    חיצוניים, מיילים שנכשלו, יחידות בלי מחיר, אתר שלא פורסם, סוף ניסיון / חבילה (לפי ההרשאות).
-- 5. אינדקסים לשאילתות לפי תאריך.
-- 6. לוח הבקרה של שלב 2k (dashboard()) — אותה פונקציה, אבל "הכנסות החודש" רק עם הרשאת
--    "נתונים כספיים" (עד עכשיו כל מנהל עם הרשאת הזמנות קיבל אותן).
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105090000_hosp_dashboard.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. הרשאת "נתונים כספיים"
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.staff_grants (
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('reports.finance')),
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, permission)
);
COMMENT ON TABLE hospitality.staff_grants IS
  'Hospitality: הרשאות שהבעלים נותן למנהל במפורש (כרגע: צפייה בנתונים כספיים). רק דרך פונקציות.';
ALTER TABLE hospitality.staff_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.staff_grants FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.staff_grants;
CREATE POLICY tenant_isolation ON hospitality.staff_grants AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.staff_grants;
CREATE POLICY backend_enabled ON hospitality.staff_grants AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.staff_grants;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.staff_grants
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

CREATE OR REPLACE FUNCTION hospitality.permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['settings', 'policies', 'catalog', 'media', 'pricing', 'bookings', 'guests',
               'reports', 'staff.managers', 'billing.manage', 'guests.privacy', 'settings.owner',
               'catalog.owner', 'reports.finance']::text[];
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
          WHEN 'manager' THEN CASE
            -- נתונים כספיים: רק מנהל שהבעלים נתן לו במפורש
            WHEN _permission = 'reports.finance' THEN EXISTS (
              SELECT 1 FROM hospitality.staff_grants g
               WHERE g.tenant_id = public.current_tenant_id() AND g.user_id = auth.uid()
                 AND g.permission = 'reports.finance')
            ELSE _permission NOT IN ('staff.managers', 'billing.manage', 'guests.privacy',
                                     'settings.owner', 'catalog.owner')
          END
          ELSE false
        END,
    false);
$$;
REVOKE ALL ON FUNCTION hospitality.can(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.can(text) TO authenticated, service_role;

-- הצוות: כמו קודם + finance (לבעלים תמיד; למנהל — אם ניתנה לו הרשאה)
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
               'last_sign_in_at', hospitality._ts(u.last_sign_in_at),
               'finance', ur.is_protected OR EXISTS (
                 SELECT 1 FROM hospitality.staff_grants g
                  WHERE g.tenant_id = _t AND g.user_id = ur.user_id AND g.permission = 'reports.finance'))
             ORDER BY ur.is_protected DESC, ur.created_at, ur.user_id)
        FROM public.user_roles ur
        JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.tenant_id = _t AND ur.role = 'admin' AND NOT public.is_platform_admin(ur.user_id)), '[]'::jsonb),
    'seats', jsonb_build_object('used', _e -> 'managers_used', 'limit', _e -> 'max_managers', 'active', _e -> 'active'));
END $$;
REVOKE ALL ON FUNCTION hospitality.team_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_members() TO authenticated, service_role;

-- הסרת מנהל: כמו קודם + ההרשאות שניתנו לו נמחקות (כדי שלא יחזרו אם יצורף שוב)
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
  DELETE FROM hospitality.staff_grants g WHERE g.tenant_id = _t AND g.user_id = _user_id;
  PERFORM hospitality._audit(_t, 'team.manager_removed',
                             COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(COALESCE(_email, r.email))),
                             jsonb_build_object('email', hospitality.mask_email(COALESCE(_email, r.email))));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION hospitality.team_remove_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_remove_manager(uuid) TO authenticated, service_role;

-- הבעלים נותן / מבטל למנהל צפייה בנתונים כספיים
CREATE OR REPLACE FUNCTION hospitality.team_set_finance(_user_id uuid, _enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('staff.managers');
  r public.user_roles;
  _label text;
BEGIN
  IF _user_id IS NULL OR _enabled IS NULL THEN
    RAISE EXCEPTION 'חסרים פרטים' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO r FROM public.user_roles ur
   WHERE ur.tenant_id = _t AND ur.user_id = _user_id AND ur.role = 'admin'
     AND NOT public.is_platform_admin(ur.user_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המנהל לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.is_protected THEN
    RAISE EXCEPTION 'לבעלים יש תמיד גישה לנתונים הכספיים' USING ERRCODE = 'check_violation';
  END IF;
  _label := COALESCE(NULLIF(btrim(r.display_name), ''), hospitality.mask_email(r.email), 'מנהל');
  IF _enabled THEN
    INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission, granted_by)
    VALUES (_t, _user_id, 'reports.finance', auth.uid())
    ON CONFLICT (tenant_id, user_id, permission) DO NOTHING;
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.finance_granted', _label, '{}'::jsonb);
    END IF;
  ELSE
    DELETE FROM hospitality.staff_grants g
     WHERE g.tenant_id = _t AND g.user_id = _user_id AND g.permission = 'reports.finance';
    IF FOUND THEN
      PERFORM hospitality._audit(_t, 'team.finance_revoked', _label, '{}'::jsonb);
    END IF;
  END IF;
  RETURN hospitality.team_members();
END $$;
REVOKE ALL ON FUNCTION hospitality.team_set_finance(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.team_set_finance(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. לילות-יחידה בתקופה: תפוס (ישיר / ערוץ) או חסום פנימית — כל לילה-יחידה פעם אחת
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._dashboard_nights(_t uuid, _from date, _to date)
RETURNS TABLE (unit_id uuid, night date, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH phys AS (
    SELECT u.id FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property'
  ),
  booked AS (
    -- לילות הזמנה (מתחם שלם — בכל אחת מהיחידות שבו); הזמנה שנרשמה מערוץ חיצוני — "ערוץ"
    SELECT COALESCE(m.member_unit_id, b.unit_id) AS u_id, n.night AS d, (b.source = 'external') AS channel
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
      LEFT JOIN hospitality.unit_members m ON m.tenant_id = b.tenant_id AND m.parent_unit_id = b.unit_id
     WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
  ),
  blk AS (
    -- חסימות פעילות: מסונכרנות מערוץ (Airbnb / Booking…) או פנימיות
    SELECT COALESCE(m.member_unit_id, k.unit_id) AS u_id, gs::date AS d, (k.channel_calendar_id IS NOT NULL) AS synced
      FROM hospitality.blocks k
      LEFT JOIN hospitality.unit_members m ON m.tenant_id = k.tenant_id AND m.parent_unit_id = k.unit_id
      CROSS JOIN LATERAL generate_series(GREATEST(k.start_date, _from)::timestamp,
                                         LEAST(k.end_date - 1, _to)::timestamp, interval '1 day') gs
     WHERE k.tenant_id = _t AND k.released_at IS NULL AND k.start_date <= _to AND k.end_date > _from
  ),
  occupied AS (
    SELECT x.u_id, x.d, CASE WHEN bool_or(x.channel) THEN 'channel' ELSE 'direct' END AS k
      FROM (SELECT b.u_id, b.d, b.channel FROM booked b
            UNION ALL
            SELECT k.u_id, k.d, true FROM blk k WHERE k.synced) x
     WHERE x.u_id IN (SELECT p.id FROM phys p)
     GROUP BY x.u_id, x.d
  )
  SELECT o.u_id, o.d, o.k FROM occupied o
  UNION ALL
  SELECT DISTINCT k.u_id, k.d, 'blocked' FROM blk k
   WHERE NOT k.synced AND k.u_id IN (SELECT p.id FROM phys p)
     AND NOT EXISTS (SELECT 1 FROM occupied o WHERE o.u_id = k.u_id AND o.d = k.d);
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_nights(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- המספרים של תקופה אחת
CREATE OR REPLACE FUNCTION hospitality._dashboard_numbers(_t uuid, _tz text, _from date, _to date,
                                                         _units integer, _fin boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _len integer := _to - _from + 1;
  _start timestamptz := (_from::timestamp AT TIME ZONE _tz);
  _end timestamptz := ((_to + 1)::timestamp AT TIME ZONE _tz);
  _bookings integer;
  _cancels integer;
  _occ integer;
  _channel integer;
  _blocked integer;
  _avail integer;
  _nights integer;
  _rev numeric := 0;
  _paid numeric := 0;
BEGIN
  SELECT count(*) INTO _bookings FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.created_at >= _start AND b.created_at < _end
     AND b.status NOT IN ('declined', 'expired', 'cancelled')
     AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now());

  SELECT count(DISTINCT e.booking_id) INTO _cancels FROM hospitality.booking_events e
   WHERE e.tenant_id = _t AND e.to_status IN ('cancelled', 'no_show')
     AND e.created_at >= _start AND e.created_at < _end;

  SELECT count(*) FILTER (WHERE x.kind <> 'blocked'), count(*) FILTER (WHERE x.kind = 'channel'),
         count(*) FILTER (WHERE x.kind = 'blocked')
    INTO _occ, _channel, _blocked
    FROM hospitality._dashboard_nights(_t, _from, _to) x;
  _avail := GREATEST(COALESCE(_units, 0) * _len - _blocked, 0);

  SELECT count(*), COALESCE(sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END), 0)
    INTO _nights, _rev
    FROM hospitality.booking_nights n
    JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
   WHERE n.tenant_id = _t AND n.night BETWEEN _from AND _to
     AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out');

  IF _fin THEN
    SELECT COALESCE(sum(CASE WHEN p.kind = 'refund' THEN -p.amount ELSE p.amount END), 0) INTO _paid
      FROM hospitality.payments p
     WHERE p.tenant_id = _t AND p.status = 'recorded' AND p.paid_at BETWEEN _from AND _to;
  END IF;

  RETURN jsonb_build_object(
    'bookings', _bookings,
    'cancellations', _cancels,
    'nights_sold', _nights,
    'occupied_nights', _occ,
    'channel_nights', _channel,
    'blocked_nights', _blocked,
    'available_nights', _avail,
    'occupancy', CASE WHEN _avail > 0 THEN round(100.0 * _occ / _avail, 1) END,
    'revenue', CASE WHEN _fin THEN round(_rev, 2) END,
    'collected', CASE WHEN _fin THEN round(_paid, 2) END,
    'adr', CASE WHEN _fin AND _nights > 0 THEN round(_rev / _nights, 2) END);
END $$;
REVOKE ALL ON FUNCTION hospitality._dashboard_numbers(uuid, text, date, date, integer, boolean) FROM PUBLIC, anon, authenticated;

-- הגרף: לפי יום / שבוע (מיום ראשון) / חודש
CREATE OR REPLACE FUNCTION hospitality._dashboard_series(_t uuid, _tz text, _from date, _to date, _bucket text,
                                                        _units integer, _fin boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH days AS (
    SELECT gs::date AS day FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') gs
  ),
  created AS (
    SELECT (b.created_at AT TIME ZONE _tz)::date AS day, count(*) AS n
      FROM hospitality.bookings b
     WHERE b.tenant_id = _t
       AND b.created_at >= (_from::timestamp AT TIME ZONE _tz) AND b.created_at < ((_to + 1)::timestamp AT TIME ZONE _tz)
       AND b.status NOT IN ('declined', 'expired', 'cancelled')
       AND NOT (b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at <= now())
     GROUP BY 1
  ),
  rev AS (
    SELECT n.night AS day, sum(n.price * CASE WHEN b.subtotal > 0 THEN b.total / b.subtotal ELSE 0 END) AS amount
      FROM hospitality.booking_nights n
      JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
     WHERE _fin AND n.tenant_id = _t AND n.night BETWEEN _from AND _to
       AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')
     GROUP BY 1
  ),
  nights AS (
    SELECT x.night AS day, count(*) FILTER (WHERE x.kind <> 'blocked') AS occ,
           count(*) FILTER (WHERE x.kind = 'blocked') AS blocked
      FROM hospitality._dashboard_nights(_t, _from, _to) x
     GROUP BY 1
  ),
  per_day AS (
    SELECT CASE _bucket WHEN 'day' THEN d.day
                        WHEN 'week' THEN d.day - extract(dow FROM d.day)::integer
                        ELSE date_trunc('month', d.day)::date END AS bucket,
           COALESCE(c.n, 0) AS bookings, COALESCE(r.amount, 0) AS revenue,
           COALESCE(o.occ, 0) AS occ, COALESCE(o.blocked, 0) AS blocked
      FROM days d
      LEFT JOIN created c ON c.day = d.day
      LEFT JOIN rev r ON r.day = d.day
      LEFT JOIN nights o ON o.day = d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'start', g.bucket, 'days', g.days, 'bookings', g.bookings,
           'revenue', CASE WHEN _fin THEN round(g.revenue, 2) END,
           'occupancy', CASE WHEN COALESCE(_units, 0) * g.days - g.blocked > 0
                             THEN round(100.0 * g.occ / (_units * g.days - g.blocked), 1) END)
           ORDER BY g.bucket), '[]'::jsonb)
    FROM (SELECT p.bucket, count(*)::integer AS days, sum(p.bookings)::integer AS bookings,
                 sum(p.revenue) AS revenue, sum(p.occ)::integer AS occ, sum(p.blocked)::integer AS blocked
            FROM per_day p GROUP BY p.bucket) g;
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_series(uuid, text, date, date, text, integer, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.dashboard_overview(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('reports');
  _fin boolean := hospitality.can('reports.finance');
  _tz text;
  _cur text;
  _today date;
  _len integer;
  _pfrom date;
  _pto date;
  _since date;
  _bucket text;
  _units integer;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'טווח התאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  _len := _to - _from + 1;
  IF _len > 366 THEN
    RAISE EXCEPTION 'אפשר להציג עד שנה אחת' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.timezone, s.currency INTO _tz, _cur FROM hospitality.settings s WHERE s.tenant_id = _t;
  _tz := COALESCE(_tz, 'Asia/Jerusalem');
  _today := (now() AT TIME ZONE _tz)::date;
  _pfrom := _from - _len;
  _pto := _from - 1;
  SELECT (t.created_at AT TIME ZONE _tz)::date INTO _since FROM public.tenants t WHERE t.id = _t;
  _bucket := CASE WHEN _len <= 62 THEN 'day' WHEN _len <= 186 THEN 'week' ELSE 'month' END;
  SELECT count(*) INTO _units FROM hospitality.units u
   WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property';

  RETURN jsonb_build_object(
    'me', jsonb_build_object('first_name', (
      SELECT NULLIF(split_part(btrim(ur.display_name), ' ', 1), '')
        FROM public.user_roles ur WHERE ur.tenant_id = _t AND ur.user_id = auth.uid())),
    'period', jsonb_build_object('from', _from, 'to', _to, 'days', _len, 'bucket', _bucket,
                                 'previous_from', _pfrom, 'previous_to', _pto, 'today', _today),
    'currency', COALESCE(_cur, 'ILS'),
    'finance', _fin,
    'units', _units,
    'current', hospitality._dashboard_numbers(_t, _tz, _from, _to, _units, _fin),
    -- השוואה — רק כשהאתר כבר היה קיים בכל התקופה הקודמת
    'previous', CASE WHEN _since IS NOT NULL AND _since <= _pfrom
                     THEN hospitality._dashboard_numbers(_t, _tz, _pfrom, _pto, _units, _fin) END,
    'pending', (SELECT jsonb_build_object('count', count(*), 'next_expiry', hospitality._ts(min(b.hold_expires_at)))
                  FROM hospitality.bookings b
                 WHERE b.tenant_id = _t AND b.status IN ('pending_approval', 'pending_payment')
                   AND b.hold_expires_at > now()),
    'series', hospitality._dashboard_series(_t, _tz, _from, _to, _bucket, _units, _fin),
    -- הקו המקווקו בגרף: אותה חלוקה לתקופה הקודמת (רק כשיש השוואה)
    'previous_series', CASE WHEN _since IS NOT NULL AND _since <= _pfrom
                            THEN hospitality._dashboard_series(_t, _tz, _pfrom, _pto, _bucket, _units, _fin) END);
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard_overview(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard_overview(date, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. היום בעסק
-- ------------------------------------------------------------
-- "נועה ל." — שם פרטי ואות; אורח שנמחק — "אורח"
CREATE OR REPLACE FUNCTION hospitality._short_guest_name(_full_name text, _anonymized boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN _anonymized OR btrim(COALESCE(_full_name, '')) = '' THEN 'אורח'
    WHEN position(' ' IN btrim(_full_name)) = 0 THEN btrim(_full_name)
    ELSE split_part(btrim(_full_name), ' ', 1) || ' '
         || left(regexp_replace(btrim(_full_name), '^.*\s', ''), 1) || '.'
  END;
$$;
REVOKE ALL ON FUNCTION hospitality._short_guest_name(text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality._dashboard_stay(b hospitality.bookings)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'number', b.number, 'status', b.status, 'state', hospitality._booking_state(b),
    'guest', hospitality._short_guest_name(g.full_name, g.anonymized_at IS NOT NULL),
    'unit_name', u.name, 'check_in', b.check_in, 'check_out', b.check_out, 'nights', b.nights,
    'adults', b.adults, 'children', b.children, 'payment_status', b.payment_status,
    'source', b.source, 'channel', b.channel, 'revision', b.revision)
    FROM hospitality.guests g, hospitality.units u
   WHERE g.tenant_id = b.tenant_id AND g.id = b.guest_id AND u.tenant_id = b.tenant_id AND u.id = b.unit_id;
$$;
REVOKE ALL ON FUNCTION hospitality._dashboard_stay(hospitality.bookings) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION hospitality.dashboard_today()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  s hospitality.settings;
  _today date;
BEGIN
  SELECT * INTO s FROM hospitality.settings x WHERE x.tenant_id = _t;
  _today := (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date;
  RETURN jsonb_build_object(
    'today', _today,
    'check_in_time', to_char(s.check_in_time, 'HH24:MI'),
    'check_out_time', to_char(s.check_out_time, 'HH24:MI'),
    -- מגיעים היום (כולל מי שכבר הגיע)
    'arrivals', COALESCE((SELECT jsonb_agg(hospitality._dashboard_stay(b) ORDER BY b.number)
                            FROM hospitality.bookings b
                           WHERE b.tenant_id = _t AND b.check_in = _today
                             AND b.status IN ('confirmed', 'cancel_requested', 'checked_in')), '[]'::jsonb),
    -- עוזבים היום (כולל מי שכבר עזב)
    'departures', COALESCE((SELECT jsonb_agg(hospitality._dashboard_stay(b) ORDER BY b.number)
                              FROM hospitality.bookings b
                             WHERE b.tenant_id = _t AND b.check_out = _today
                               AND b.status IN ('checked_in', 'checked_out')), '[]'::jsonb),
    'staying', (SELECT count(*) FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'checked_in'),
    -- צ'ק-אין ב-7 הימים הקרובים
    'upcoming', COALESCE((SELECT jsonb_agg(z.j ORDER BY z.ci, z.num) FROM (
                  SELECT hospitality._dashboard_stay(b) AS j, b.check_in AS ci, b.number AS num
                    FROM hospitality.bookings b
                   WHERE b.tenant_id = _t AND b.check_in BETWEEN _today + 1 AND _today + 7
                     AND b.status IN ('confirmed', 'cancel_requested')
                   ORDER BY b.check_in, b.number LIMIT 8) z), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard_today() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4. דורש טיפול
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.dashboard_tasks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _today date;
  _items jsonb := '[]'::jsonb;
  _n integer;
  _m integer;
  _when timestamptz;
  _first uuid;
  _num integer;
  _e jsonb;
  _trial timestamptz;
BEGIN
  SELECT (now() AT TIME ZONE COALESCE(s.timezone, 'Asia/Jerusalem'))::date INTO _today
    FROM hospitality.settings s WHERE s.tenant_id = _t;
  _today := COALESCE(_today, current_date);

  -- 1. בקשות שממתינות לאישור (הקרובה לפקיעה קודם)
  SELECT count(*), min(b.hold_expires_at) INTO _n, _when FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now();
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status IN ('pending_approval', 'pending_payment') AND b.hold_expires_at > now()
     ORDER BY b.hold_expires_at, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'pending', 'severity', 'high', 'count', _n, 'due', hospitality._ts(_when),
      'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 2. בקשות ביטול מהאורחים
  SELECT count(*) INTO _n FROM hospitality.bookings b WHERE b.tenant_id = _t AND b.status = 'cancel_requested';
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status = 'cancel_requested'
     ORDER BY b.cancellation_requested_at NULLS LAST, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'cancel_requests', 'severity', 'high', 'count', _n, 'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 3. מקדמות לגבייה: מגיעים ב-7 הימים הקרובים ושולם פחות מהמקדמה
  SELECT count(*) INTO _n FROM hospitality.bookings b
   WHERE b.tenant_id = _t AND b.status = 'confirmed' AND b.check_in BETWEEN _today AND _today + 7
     AND b.deposit_amount > 0 AND b.amount_paid < b.deposit_amount;
  IF _n > 0 THEN
    SELECT b.id, b.number INTO _first, _num FROM hospitality.bookings b
     WHERE b.tenant_id = _t AND b.status = 'confirmed' AND b.check_in BETWEEN _today AND _today + 7
       AND b.deposit_amount > 0 AND b.amount_paid < b.deposit_amount
     ORDER BY b.check_in, b.number LIMIT 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'deposits', 'severity', 'medium', 'count', _n, 'booking_id', _first, 'booking_number', _num));
  END IF;

  -- 4. יומנים חיצוניים: התנגשויות / סנכרון שנכשל
  SELECT COALESCE(sum(jsonb_array_length(c.conflicts)), 0), count(*) FILTER (WHERE c.last_status = 'error')
    INTO _n, _m
    FROM hospitality.channel_calendars c
   WHERE c.tenant_id = _t AND c.enabled AND c.removed_at IS NULL;
  IF _n > 0 OR _m > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'channels', 'severity', CASE WHEN _n > 0 THEN 'high' ELSE 'medium' END,
      'count', _n + _m, 'conflicts', _n, 'failing', _m));
  END IF;

  -- 5. מיילים שנכשלו
  SELECT count(*) INTO _n FROM hospitality.notifications x WHERE x.tenant_id = _t AND x.status IN ('failed', 'dead');
  IF _n > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object('kind', 'emails', 'severity', 'medium', 'count', _n));
  END IF;

  -- 6. יחידות פעילות בלי מחיר בסיס
  IF hospitality.can('pricing') THEN
    SELECT count(*) INTO _n FROM hospitality.units u
     WHERE u.tenant_id = _t AND u.is_active AND u.kind <> 'whole_property' AND COALESCE(u.base_price, 0) <= 0;
    IF _n > 0 THEN
      _items := _items || jsonb_build_array(jsonb_build_object('kind', 'prices', 'severity', 'medium', 'count', _n));
    END IF;
  END IF;

  -- 7. שינויים באתר שלא פורסמו
  IF hospitality.can('settings') AND EXISTS (
       SELECT 1 FROM hospitality.site_versions d
        WHERE d.tenant_id = _t AND d.kind = 'draft'
          AND NOT EXISTS (
            SELECT 1 FROM hospitality.site_versions p
             WHERE p.tenant_id = _t AND p.kind = 'published' AND p.document = d.document AND p.theme = d.theme
               AND p.version = (SELECT max(x.version) FROM hospitality.site_versions x
                                 WHERE x.tenant_id = _t AND x.kind = 'published'))) THEN
    _items := _items || jsonb_build_array(jsonb_build_object('kind', 'site', 'severity', 'low', 'count', 1));
  END IF;

  -- 8. החבילה (בעלים): מנוי לא פעיל / ניסיון שמסתיים בתוך 14 יום
  IF hospitality.can('billing.manage') THEN
    _e := hospitality.entitlements(_t);
    IF _e IS NOT NULL AND NOT COALESCE((_e ->> 'active')::boolean, false) THEN
      _items := _items || jsonb_build_array(jsonb_build_object('kind', 'plan', 'severity', 'high', 'count', 1,
        'inactive', true));
    ELSE
      _trial := NULLIF(_e ->> 'trial_ends_at', '')::timestamptz;
      IF _e ->> 'status' = 'trialing' AND _trial IS NOT NULL AND _trial < now() + interval '14 days' THEN
        _items := _items || jsonb_build_array(jsonb_build_object('kind', 'plan', 'severity', 'medium', 'count', 1,
          'due', hospitality._ts(_trial), 'inactive', false));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('items', _items, 'count', jsonb_array_length(_items));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard_tasks() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. אינדקסים לשאילתות לפי תאריך
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS bookings_created_idx ON hospitality.bookings (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS booking_nights_night_idx ON hospitality.booking_nights (tenant_id, night);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON hospitality.payments (tenant_id, paid_at) WHERE status = 'recorded';
CREATE INDEX IF NOT EXISTS booking_events_status_idx ON hospitality.booking_events (tenant_id, to_status, created_at);

-- ------------------------------------------------------------
-- 6. לוח הבקרה של שלב 2k: "הכנסות החודש" רק עם הרשאת "נתונים כספיים"
-- ------------------------------------------------------------
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
    -- F3: סכום כספי מצטבר — רק עם הרשאת "נתונים כספיים" (בעלים, או מנהל שקיבל אותה)
    'revenue_month', CASE WHEN hospitality.can('reports.finance') THEN
                       (SELECT COALESCE(sum(n.price), 0) FROM hospitality.booking_nights n
                          JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
                         WHERE n.tenant_id = _t AND n.night >= _month_start AND n.night < (_month_start + interval '1 month')::date
                           AND b.status IN ('confirmed', 'cancel_requested', 'checked_in', 'checked_out')) END,
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

NOTIFY pgrst, 'reload schema';

COMMIT;

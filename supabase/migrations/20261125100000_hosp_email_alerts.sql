-- ============================================================
-- Hospitality — מיגרציה 206: התראה על מייל שלא נשלח — סימון "נקרא" / "טופל", והתראה שטופלה יורדת
--
-- הבעיה (נופי דורית, ובכל עסק אירוח): "מייל שלא נשלח" בכרטיס "דורש טיפול", בפעמון ובתפריט, בלי דרך להסיר.
-- ההתראה לא נשמרת בשום מקום — היא נספרת מחדש בכל טעינה מתור המיילים (hospitality.notifications, status
-- failed / dead), בלי חלון זמן ובלי "טופל". היא נעלמה רק כשאותו מייל נשלח בהצלחה; מייל שלא יכול להצליח
-- (כתובת שגויה) — לעולם לא. וגם מיילים שהמערכת ביטלה בכוונה (האורח נמחק, כתובת המייל של הלקוח תוקנה)
-- הופיעו כ"נכשלו" — ושליחה חוזרת שלהם הייתה הולכת לכתובת הישנה.
--
-- התיקון — ההתראה (מה שמוצג למשתמש) נפרדת מההיסטוריה הטכנית של המייל:
--   1. שלוש עמודות על שורת המייל: alert_seen_at ("נקרא"), alert_handled_at + alert_handled_by ("טופל").
--      המייל עצמו, הסטטוס שלו, הניסיונות והשגיאה — לא משתנים ולא נמחקים (יומן, מניעת כפילויות, היסטוריה).
--   2. התראה פתוחה = נכשל, לא סומן "טופל", ולא בוטל בכוונה (_email_cancelled).
--   3. dashboard_tasks / staff_emails סופרים רק התראות פתוחות; staff_emails מחזיר את מצב ההתראה בכל שורה,
--      ומסנן חדש "handled" (מה שטופל / בוטל) — ההיסטוריה גלויה.
--   4. email_alerts_mark(_ids, 'seen' | 'handled' | 'reopen') ו-email_alerts_mark_all('seen' | 'handled') —
--      בהרשאת "הזמנות" (כמו "שליחה חוזרת"), רק בעסק של המשתמש, נרשם ביומן הפעילות.
--   5. requeue_notification: לא שולח מייל שבוטל בכוונה; ניסיון חדש מתחיל התראה חדשה (הסימונים מתאפסים).
-- dashboard() (failed_emails) לא בשימוש במסך — לא שונה.
-- ============================================================
BEGIN;

ALTER TABLE hospitality.notifications
  ADD COLUMN IF NOT EXISTS alert_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_handled_at timestamptz,
  ADD COLUMN IF NOT EXISTS alert_handled_by uuid;

-- התראות פתוחות של עסק — מה שהכרטיס, הפעמון והתפריט סופרים
CREATE INDEX IF NOT EXISTS notifications_open_alerts_idx ON hospitality.notifications (tenant_id)
  WHERE status IN ('failed', 'dead') AND alert_handled_at IS NULL;

-- מייל שהמערכת ביטלה בכוונה — לא כישלון שצריך לטפל בו (והטקסטים האלה נכתבים רק על ידי המערכת)
CREATE OR REPLACE FUNCTION hospitality._email_cancelled(_status text, _error text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _status = 'dead' AND COALESCE(_error, '') IN ('guest anonymized', 'customer email corrected')
$$;
REVOKE ALL ON FUNCTION hospitality._email_cancelled(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._email_cancelled(text, text) TO service_role;

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
  _closed integer;
  _ending integer;
  _until date;
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

  -- 5. מיילים שנכשלו — רק התראות פתוחות (מיגרציה 206): לא סומנו "טופל", ולא מיילים שהמערכת ביטלה בכוונה
  --    (פרטי הלקוח נמחקו / תוקנו). unseen — כמה מהן עוד לא סומנו "נקרא" (המספר בפעמון ובתפריט)
  SELECT count(*), count(*) FILTER (WHERE x.alert_seen_at IS NULL) INTO _n, _m FROM hospitality.notifications x
   WHERE x.tenant_id = _t AND x.status IN ('failed', 'dead') AND x.alert_handled_at IS NULL
     AND NOT hospitality._email_cancelled(x.status, x.last_error);
  IF _n > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object('kind', 'emails', 'severity', 'medium', 'count', _n,
      'unseen', _m));
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

  -- 9. תאריכים להזמנה (מיגרציה 43): יחידות פעילות שאין בהן תאריכים פתוחים (עוד לא נפתחו / נגמרו),
  --    ויחידות שנשארו להן פחות מ-14 לילות פתוחים
  SELECT count(*) FILTER (WHERE u.open_until IS NULL OR u.open_until < _today),
         count(*) FILTER (WHERE u.open_until BETWEEN _today AND _today + 13),
         min(u.open_until) FILTER (WHERE u.open_until >= _today)
    INTO _closed, _ending, _until
    FROM hospitality.units u
    JOIN hospitality.properties p ON p.tenant_id = u.tenant_id AND p.id = u.property_id
   WHERE u.tenant_id = _t AND u.is_active AND p.status = 'active';
  IF _closed + _ending > 0 THEN
    _items := _items || jsonb_build_array(jsonb_build_object(
      'kind', 'open_dates', 'severity', CASE WHEN _closed > 0 THEN 'high' ELSE 'medium' END,
      'count', _closed + _ending, 'closed', _closed, 'ending', _ending, 'until', _until));
  END IF;

  RETURN jsonb_build_object('items', _items, 'count', jsonb_array_length(_items));
END $$;
REVOKE ALL ON FUNCTION hospitality.dashboard_tasks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.dashboard_tasks() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.staff_emails(_filter text DEFAULT 'all', _limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
BEGIN
  IF _filter NOT IN ('all', 'failed', 'handled', 'waiting', 'sent') THEN
    RAISE EXCEPTION 'סינון לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'עמוד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
                 'failed', count(*) FILTER (WHERE n.status IN ('failed', 'dead') AND n.alert_handled_at IS NULL
                                              AND NOT hospitality._email_cancelled(n.status, n.last_error)),
                 'handled', count(*) FILTER (WHERE n.status IN ('failed', 'dead') AND (n.alert_handled_at IS NOT NULL
                                              OR hospitality._email_cancelled(n.status, n.last_error))),
                 'waiting', count(*) FILTER (WHERE n.status IN ('queued', 'sending')),
                 'sent', count(*) FILTER (WHERE n.status = 'sent'))
                 FROM hospitality.notifications n WHERE n.tenant_id = _t),
    'items', COALESCE((
      SELECT jsonb_agg(row ORDER BY created DESC) FROM (
        SELECT n.created_at AS created, jsonb_build_object(
                 'id', n.id, 'event', n.event, 'recipient_kind', n.recipient_kind,
                 'recipient', hospitality.mask_email(n.recipient_email), 'status', n.status,
                 'attempts', n.attempts, 'has_error', n.last_error IS NOT NULL,
                 'next_attempt_at', hospitality._ts(n.next_attempt_at),
                 'created_at', hospitality._ts(n.created_at), 'sent_at', hospitality._ts(n.sent_at),
                 'booking_id', n.booking_id, 'booking_number', b.number,
                 'alert', CASE WHEN n.status IN ('failed', 'dead') THEN jsonb_build_object(
                   'seen', n.alert_seen_at IS NOT NULL,
                   'handled', n.alert_handled_at IS NOT NULL,
                   'handled_at', hospitality._ts(n.alert_handled_at),
                   'cancelled', hospitality._email_cancelled(n.status, n.last_error)) END) AS row
          FROM hospitality.notifications n
          LEFT JOIN hospitality.bookings b ON b.tenant_id = n.tenant_id AND b.id = n.booking_id
         WHERE n.tenant_id = _t
           AND (_filter = 'all'
                OR (_filter = 'failed' AND n.status IN ('failed', 'dead') AND n.alert_handled_at IS NULL
                    AND NOT hospitality._email_cancelled(n.status, n.last_error))
                OR (_filter = 'handled' AND n.status IN ('failed', 'dead') AND (n.alert_handled_at IS NOT NULL
                    OR hospitality._email_cancelled(n.status, n.last_error)))
                OR (_filter = 'waiting' AND n.status IN ('queued', 'sending'))
                OR (_filter = 'sent' AND n.status = 'sent'))
         ORDER BY n.created_at DESC
         LIMIT _limit) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.staff_emails(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.staff_emails(text, integer) TO authenticated, service_role;

-- שליחה חוזרת של מייל שנכשל — חוזר לתור מיד (ה-worker ישלח בסבב הבא)
CREATE OR REPLACE FUNCTION hospitality.requeue_notification(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  n hospitality.notifications;
BEGIN
  -- מייל שהמערכת ביטלה בכוונה (האורח נמחק / כתובת המייל של הלקוח תוקנה) — לא נשלח שוב: הוא היה הולך לכתובת
  -- הישנה, או בלי הפרטים (מיגרציה 206)
  IF EXISTS (SELECT 1 FROM hospitality.notifications x
              WHERE x.tenant_id = _t AND x.id = _id AND hospitality._email_cancelled(x.status, x.last_error)) THEN
    RAISE EXCEPTION 'המייל הזה בוטל בכוונה (פרטי הלקוח נמחקו או עודכנו) — לא שולחים אותו שוב' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.notifications x
     SET status = 'queued', attempts = 0, next_attempt_at = now(), locked_until = NULL,
         last_error = NULL, updated_at = now(),
         alert_seen_at = NULL, alert_handled_at = NULL, alert_handled_by = NULL
   WHERE x.tenant_id = _t AND x.id = _id AND x.status IN ('failed', 'dead')
  RETURNING * INTO n;
  IF n.id IS NULL THEN
    RAISE EXCEPTION 'אפשר לשלוח שוב רק מייל שנכשל' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM hospitality._audit(_t, 'emails.requeued', n.event, jsonb_build_object('recipient', hospitality.mask_email(n.recipient_email)));
  RETURN jsonb_build_object('id', n.id, 'status', n.status);
END $$;
REVOKE ALL ON FUNCTION hospitality.requeue_notification(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.requeue_notification(uuid) TO authenticated, service_role;

-- "נקרא" / "טופל" / "להחזיר להתראות" — למיילים שנכשלו של העסק, עד 200 בפעם
CREATE OR REPLACE FUNCTION hospitality.email_alerts_mark(_ids uuid[], _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _n integer;
BEGIN
  IF _action IS NULL OR _action NOT IN ('seen', 'handled', 'reopen') THEN
    RAISE EXCEPTION 'פעולה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'אפשר לסמן בין 1 ל-200 מיילים בפעם' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.notifications x
     SET alert_seen_at = CASE WHEN _action = 'reopen' THEN NULL ELSE COALESCE(x.alert_seen_at, now()) END,
         alert_handled_at = CASE _action WHEN 'handled' THEN COALESCE(x.alert_handled_at, now())
                                         WHEN 'reopen' THEN NULL ELSE x.alert_handled_at END,
         alert_handled_by = CASE _action WHEN 'handled' THEN COALESCE(x.alert_handled_by, auth.uid())
                                         WHEN 'reopen' THEN NULL ELSE x.alert_handled_by END
   WHERE x.tenant_id = _t AND x.id = ANY (_ids) AND x.status IN ('failed', 'dead');
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM hospitality._audit(_t, CASE _action WHEN 'seen' THEN 'emails.alert_seen'
                                                WHEN 'handled' THEN 'emails.alert_handled'
                                                ELSE 'emails.alert_reopened' END,
                               NULL, jsonb_build_object('count', _n));
  END IF;
  RETURN jsonb_build_object('updated', _n);
END $$;
REVOKE ALL ON FUNCTION hospitality.email_alerts_mark(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.email_alerts_mark(uuid[], text) TO authenticated, service_role;

-- "סימון הכול כנקרא" / "סימון הכול כטופל" — כל ההתראות הפתוחות של העסק
CREATE OR REPLACE FUNCTION hospitality.email_alerts_mark_all(_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('bookings');
  _n integer;
BEGIN
  IF _action IS NULL OR _action NOT IN ('seen', 'handled') THEN
    RAISE EXCEPTION 'פעולה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.notifications x
     SET alert_seen_at = COALESCE(x.alert_seen_at, now()),
         alert_handled_at = CASE WHEN _action = 'handled' THEN now() ELSE x.alert_handled_at END,
         alert_handled_by = CASE WHEN _action = 'handled' THEN auth.uid() ELSE x.alert_handled_by END
   WHERE x.tenant_id = _t AND x.status IN ('failed', 'dead') AND x.alert_handled_at IS NULL
     AND NOT hospitality._email_cancelled(x.status, x.last_error)
     AND (_action = 'handled' OR x.alert_seen_at IS NULL);
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM hospitality._audit(_t, CASE _action WHEN 'seen' THEN 'emails.alert_seen' ELSE 'emails.alert_handled' END,
                               NULL, jsonb_build_object('count', _n, 'all', true));
  END IF;
  RETURN jsonb_build_object('updated', _n);
END $$;
REVOKE ALL ON FUNCTION hospitality.email_alerts_mark_all(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.email_alerts_mark_all(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

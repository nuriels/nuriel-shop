-- ============================================================
-- Hospitality — מיגרציה 27: התראות וזיהוי של תאריכים מיומנים חיצוניים (שלב D3)
--
--   • התנגשות חדשה בסנכרון (אירוע ב-Airbnb / Booking.com על תאריכים שתפוסים אצלנו) → מייל
--     לבעל העסק (תור המיילים הקיים, 'channel_conflict') ורישום ביומן הפעולות. רק כשמופיעה
--     התנגשות שלא הייתה בסנכרון הקודם — בלי מייל חוזר כל 30 דקות על אותה התנגשות, ולכל היותר
--     מייל אחד ביום על אותן התנגשויות (יומן "מהבהב" לא מציף). כשכל ההתנגשויות החדשות הן
--     בדיוק התאריכים של הזמנה / חסימה שלנו — סימון 'echo_like' (ייתכן שהערוץ מחזיר את התאריכים
--     שייצאנו אליו), כדי שהמייל יגיד את זה.
--     טריגר על channel_calendars (שינוי ב-conflicts) — בלי שינוי בפונקציית הסנכרון עצמה.
--     שום הזמנה לא משתנה ולא מתבטלת: ההתנגשות רק מדווחת (כמו עד עכשיו).
--   • _block_json — החסימה בלוח מגיעה גם עם הערוץ ('channel': airbnb / booking / vrbo /
--     google / other) והאם היא מסנכרון ('synced'), כדי שהלוח יציג את מקור התפוסה.
--     שדות נוספים בלבד — כל מי שמשתמש בה ממשיך לעבוד.
-- ============================================================

-- ------------------------------------------------------------
-- 1. החסימה עם מקור התפוסה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality._block_json(k hospitality.blocks, _unit_name text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', k.id, 'unit_id', k.unit_id, 'unit_name', _unit_name, 'start_date', k.start_date,
                            'end_date', k.end_date, 'reason', k.reason,
                            'synced', k.channel_calendar_id IS NOT NULL,
                            'channel', (SELECT c.channel FROM hospitality.channel_calendars c
                                         WHERE c.tenant_id = k.tenant_id AND c.id = k.channel_calendar_id));
$$;

-- ------------------------------------------------------------
-- 2. התנגשות חדשה → מייל לבעל העסק + יומן הפעולות
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.channel_conflicts_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _new jsonb;
  _count integer;
  _unit text;
  _label text;
  _email text;
  _echo boolean;
BEGIN
  -- ההתנגשויות שלא היו בסנכרון הקודם (לפי מזהה האירוע והתאריכים)
  SELECT COALESCE(jsonb_agg(c ORDER BY c ->> 'from'), '[]'::jsonb) INTO _new
    FROM jsonb_array_elements(COALESCE(NEW.conflicts, '[]'::jsonb)) c
   WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(OLD.conflicts, '[]'::jsonb)) o
            WHERE o ->> 'uid' = c ->> 'uid' AND o ->> 'from' = c ->> 'from' AND o ->> 'to' = c ->> 'to');
  _count := jsonb_array_length(_new);
  IF _count = 0 THEN
    RETURN NEW;
  END IF;
  SELECT u.name INTO _unit FROM hospitality.units u WHERE u.tenant_id = NEW.tenant_id AND u.id = NEW.unit_id;
  -- כל ההתנגשויות החדשות = בדיוק תאריכים שתפוסים אצלנו (הזמנה / חסימה שלא מהיומן הזה)
  _echo := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(_new) c
     WHERE NOT EXISTS (
             SELECT 1 FROM hospitality.unit_occupancy o
               LEFT JOIN hospitality.blocks k ON k.tenant_id = o.tenant_id AND k.id = o.block_id
              WHERE o.tenant_id = NEW.tenant_id AND o.unit_id = NEW.unit_id
                AND o.nights = daterange((c ->> 'from')::date, (c ->> 'to')::date)
                AND k.channel_calendar_id IS DISTINCT FROM NEW.id));
  _label := CASE NEW.channel WHEN 'airbnb' THEN 'Airbnb' WHEN 'booking' THEN 'Booking.com' WHEN 'vrbo' THEN 'Vrbo'
                             WHEN 'google' THEN 'Google' ELSE 'יומן חיצוני' END;
  FOREACH _email IN ARRAY COALESCE(hospitality._owner_emails(NEW.tenant_id), '{}') LOOP
    INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
    VALUES (NEW.tenant_id, NULL, 'channel_conflict', 'owner', _email,
            'channel:' || NEW.id || ':' || md5(_new::text) || ':' || to_char(now(), 'YYYY-MM-DD') || ':' || _email,
            -- תאריכים בלבד (עד 10) — בלי פרטים של אורחים
            jsonb_build_object('unit_name', _unit, 'channel_label', _label, 'conflict_count', _count,
                               'echo_like', _echo,
                               'conflicts', (SELECT jsonb_agg(jsonb_build_object('from', x ->> 'from', 'to', x ->> 'to'))
                                               FROM (SELECT x FROM jsonb_array_elements(_new) x LIMIT 10) q)))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
  PERFORM hospitality._audit(NEW.tenant_id, 'channels.conflict', left(COALESCE(_unit, ''), 120),
                             jsonb_build_object('channel', NEW.channel, 'count', _count, 'echo_like', _echo));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hospitality.channel_conflicts_notify() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS channel_conflicts_notify ON hospitality.channel_calendars;
CREATE TRIGGER channel_conflicts_notify AFTER UPDATE OF conflicts ON hospitality.channel_calendars
  FOR EACH ROW WHEN (NEW.conflicts IS DISTINCT FROM OLD.conflicts)
  EXECUTE FUNCTION hospitality.channel_conflicts_notify();

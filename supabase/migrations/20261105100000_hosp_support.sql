-- ============================================================
-- Hospitality — מערכת תמיכה לעסקי האירוח (שלב E4, מיגרציה 33)
--
-- מערכת נפרדת בסכמת hospitality — מערכת התמיכה של החנויות (public.support_*) לא משתנה.
--
-- 1. טבלאות (RLS, בידוד לפי עסק, בלי גישה ישירה — רק דרך הפונקציות):
--    • support_tickets — פנייה: נושא, דחיפות, סטטוס (חדשה / בטיפול / ממתינה לתשובת הלקוח / נפתרה /
--      נסגרה), מספר רץ, מי פתח, מתי נענתה לראשונה, מה כל צד קרא.
--    • support_messages — הודעות; "הערה פנימית" (internal) — רק של צוות הפלטפורמה, ולעולם לא
--      מוחזרת לעסק.
--    • support_attachments — קבצים מצורפים (JPG / PNG / WebP / PDF, עד 5MB, עד 5 להודעה ו-20
--      לפנייה) בדלי פרטי hosp-support. השרת בודק את התוכן עצמו (לא רק את הסיומת) ומעלה בהרשאת
--      שירות; הורדה — קישור חתום קצר, רק אחרי בדיקת הרשאה כאן.
--    • support_settings — הגדרת הפלטפורמה: מספר WhatsApp לתמיכה בחבילת פרימיום.
-- 2. צד העסק (בעלים ומנהלים — הרשאת settings): רשימה, פתיחה, צפייה (מסמן כנקרא), תגובה, סגירה
--    ופתיחה מחדש, קבצים. הגבלה: 10 פניות חדשות ביממה לעסק.
-- 3. צד הפלטפורמה (מנהל הפלטפורמה בלבד): כל הפניות עם סינון (סטטוס / דחיפות / תאריכים / חיפוש),
--    "ממתינה למענה", פרטי העסק, מענה או הערה פנימית, שינוי סטטוס, סגירה ופתיחה מחדש.
-- 4. מיילים (תור ההודעות הקיים): לעסק כשהפלטפורמה עונה; לצוות הפלטפורמה על פנייה חדשה / תגובה.
-- 5. "דורש טיפול" בלוח הבקרה: תשובה חדשה מהתמיכה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261105100000_hosp_support.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. טבלאות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hospitality.support_tickets (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  number             bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  subject            text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),
  topic              text NOT NULL
                     CHECK (topic IN ('bookings', 'payments', 'website', 'calendar', 'account', 'technical', 'other')),
  priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status             text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  opened_by          uuid,
  opened_by_name     text CHECK (opened_by_name IS NULL OR char_length(opened_by_name) <= 120),
  opened_by_email    text CHECK (opened_by_email IS NULL OR char_length(opened_by_email) <= 254),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_message_at    timestamptz NOT NULL DEFAULT now(),
  -- מי כתב אחרון (בלי הערות פנימיות): business / platform
  last_public_sender text CHECK (last_public_sender IS NULL OR last_public_sender IN ('business', 'platform')),
  first_response_at  timestamptz,
  business_read_at   timestamptz,
  platform_read_at   timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  UNIQUE (tenant_id, id)
);
COMMENT ON TABLE hospitality.support_tickets IS
  'Hospitality (E4): פניות תמיכה של עסקי האירוח לצוות הפלטפורמה. גישה רק דרך פונקציות.';
CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx ON hospitality.support_tickets (tenant_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON hospitality.support_tickets (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS hospitality.support_messages (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id   uuid NOT NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('business', 'platform')),
  sender_id   uuid,
  sender_name text CHECK (sender_name IS NULL OR char_length(sender_name) <= 120),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  -- הערה פנימית: רק צוות הפלטפורמה כותב ורואה
  internal    boolean NOT NULL DEFAULT false CHECK (NOT internal OR sender_type = 'platform'),
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES hospitality.support_tickets (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.support_messages IS
  'Hospitality (E4): הודעות בפניות התמיכה. internal = הערה פנימית של הפלטפורמה (לא נחשפת לעסק).';
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON hospitality.support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS hospitality.support_attachments (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL,
  message_id   uuid NOT NULL,
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 160),
  mime         text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes   integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  storage_path text NOT NULL UNIQUE,
  -- pending: נרשם, הקובץ עוד לא הועלה; ready: הועלה ונבדק
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES hospitality.support_tickets (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, message_id) REFERENCES hospitality.support_messages (tenant_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE hospitality.support_attachments IS
  'Hospitality (E4): קבצים מצורפים לפניות (דלי פרטי hosp-support). הקובץ נבדק בשרת; הורדה בקישור חתום.';
CREATE INDEX IF NOT EXISTS support_attachments_message_idx ON hospitality.support_attachments (message_id);

DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['support_tickets', 'support_messages', 'support_attachments'] LOOP
    EXECUTE format('ALTER TABLE hospitality.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('REVOKE ALL ON hospitality.%I FROM PUBLIC, anon, authenticated, service_role', _t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON hospitality.%I', _t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON hospitality.%I AS RESTRICTIVE
                      USING (tenant_id = (SELECT public.current_tenant_id()))
                      WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))$p$, _t);
    EXECUTE format('DROP POLICY IF EXISTS backend_enabled ON hospitality.%I', _t);
    EXECUTE format($p$CREATE POLICY backend_enabled ON hospitality.%I AS RESTRICTIVE
                      USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
                      WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')))$p$, _t);
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_guard ON hospitality.%I', _t);
    EXECUTE format('CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.%I
                      FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard()', _t);
  END LOOP;
END $$;

-- הגדרת הפלטפורמה (שורה אחת): WhatsApp לתמיכה בחבילת פרימיום
CREATE TABLE IF NOT EXISTS hospitality.support_settings (
  id         boolean PRIMARY KEY DEFAULT true CHECK (id),
  whatsapp   text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9]{9,15}$'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.support_settings IS
  'Hospitality (E4): הגדרות התמיכה של הפלטפורמה (שורה אחת): WhatsApp לפרימיום. גישה דרך פונקציות בלבד.';
ALTER TABLE hospitality.support_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.support_settings FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO hospitality.support_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- הדלי הפרטי לקבצים: בלי שום מדיניות למשתמשים — רק השרת (מפתח שירות) מעלה ויוצר קישור חתום
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('hosp-support', 'hosp-support', false, 5242880,
            ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    ON CONFLICT (id) DO UPDATE
      SET public = false, file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. עזרים פנימיים
-- ------------------------------------------------------------
-- רמת התמיכה לפי החבילה: בסיסית → basic; ניסיון / בלי מנוי → trial; כל השאר (פרימיום והישנות) → premium
CREATE OR REPLACE FUNCTION hospitality._support_plan(_tenant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE COALESCE((SELECT s.plan_code FROM hospitality.subscriptions s WHERE s.tenant_id = _tenant_id), 'trial')
           WHEN 'basic' THEN 'basic'
           WHEN 'trial' THEN 'trial'
           ELSE 'premium' END;
$$;
REVOKE ALL ON FUNCTION hospitality._support_plan(uuid) FROM PUBLIC, anon, authenticated;

-- שם השולח לתצוגה: השם בצוות, או האימייל
CREATE OR REPLACE FUNCTION hospitality._support_sender_name(_tenant_id uuid, _user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT left(COALESCE(
    (SELECT NULLIF(btrim(ur.display_name), '') FROM public.user_roles ur
      WHERE ur.tenant_id = _tenant_id AND ur.user_id = _user LIMIT 1),
    (SELECT u.email::text FROM auth.users u WHERE u.id = _user)), 120);
$$;
REVOKE ALL ON FUNCTION hospitality._support_sender_name(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- הקבצים של בקשה: [{name, mime, size}] — עד 5, סוג וגודל מותרים; מחזיר את הרשומות שנוצרו
CREATE OR REPLACE FUNCTION hospitality._support_add_files(_t uuid, _ticket uuid, _message uuid, _files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _f jsonb;
  _id uuid;
  _out jsonb := '[]'::jsonb;
  _name text;
BEGIN
  IF _files IS NULL OR jsonb_typeof(_files) <> 'array' OR jsonb_array_length(_files) = 0 THEN
    RETURN _out;
  END IF;
  IF jsonb_array_length(_files) > 5 THEN
    RAISE EXCEPTION 'אפשר לצרף עד 5 קבצים להודעה' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM hospitality.support_attachments a WHERE a.ticket_id = _ticket)
     + jsonb_array_length(_files) > 20 THEN
    RAISE EXCEPTION 'אפשר לצרף עד 20 קבצים לפנייה' USING ERRCODE = 'check_violation';
  END IF;
  FOR _f IN SELECT * FROM jsonb_array_elements(_files) LOOP
    -- שם הקובץ — בלי נתיב ותווים מסוכנים
    _name := left(btrim(regexp_replace(COALESCE(_f ->> 'name', ''), '[\\/<>:"|?*\x00-\x1f]', '_', 'g')), 160);
    IF _name = '' THEN _name := 'קובץ'; END IF;
    IF COALESCE(_f ->> 'mime', '') NOT IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') THEN
      RAISE EXCEPTION 'סוג הקובץ לא נתמך (תמונה JPG / PNG / WebP או PDF)' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE((_f ->> 'size')::integer, 0) NOT BETWEEN 1 AND 5242880 THEN
      RAISE EXCEPTION 'קובץ גדול מדי (עד 5MB)' USING ERRCODE = 'check_violation';
    END IF;
    _id := gen_random_uuid();
    INSERT INTO hospitality.support_attachments
      (id, tenant_id, ticket_id, message_id, file_name, mime, size_bytes, storage_path)
    VALUES (_id, _t, _ticket, _message, _name, _f ->> 'mime', (_f ->> 'size')::integer,
            _t::text || '/' || _ticket::text || '/' || _id::text);
    _out := _out || jsonb_build_object('id', _id, 'path', _t::text || '/' || _ticket::text || '/' || _id::text,
                                       'name', _name, 'mime', _f ->> 'mime');
  END LOOP;
  RETURN _out;
END $$;
REVOKE ALL ON FUNCTION hospitality._support_add_files(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- פנייה לתצוגה ברשימה (שני הצדדים); _side = 'business' / 'platform' לספירת הלא-נקראות
CREATE OR REPLACE FUNCTION hospitality._support_ticket_row(tk hospitality.support_tickets, _side text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', tk.id, 'number', tk.number, 'subject', tk.subject, 'topic', tk.topic, 'priority', tk.priority,
    'status', tk.status, 'opened_by_name', tk.opened_by_name,
    'created_at', hospitality._ts(tk.created_at), 'updated_at', hospitality._ts(tk.updated_at),
    'last_message_at', hospitality._ts(tk.last_message_at), 'last_public_sender', tk.last_public_sender,
    'first_response_at', hospitality._ts(tk.first_response_at),
    'needs_reply', tk.status IN ('new', 'in_progress') AND tk.last_public_sender = 'business',
    'unread', (SELECT count(*)::int FROM hospitality.support_messages m
                WHERE m.ticket_id = tk.id AND NOT m.internal
                  AND m.sender_type <> _side
                  AND m.created_at > COALESCE(CASE WHEN _side = 'platform' THEN tk.platform_read_at
                                                   ELSE tk.business_read_at END, '-infinity')),
    'preview', (SELECT left(m.body, 140) FROM hospitality.support_messages m
                 WHERE m.ticket_id = tk.id AND (NOT m.internal OR _side = 'platform')
                 ORDER BY m.created_at DESC LIMIT 1));
$$;
REVOKE ALL ON FUNCTION hospitality._support_ticket_row(hospitality.support_tickets, text) FROM PUBLIC, anon, authenticated;

-- ההודעות של פנייה; _with_internal — רק לצד הפלטפורמה. לעסק: בלי הערות פנימיות (וגם לא הקבצים
-- שלהן), ובמקום השם / האימייל של איש הצוות בפלטפורמה — "צוות התמיכה".
CREATE OR REPLACE FUNCTION hospitality._support_messages(_ticket uuid, _with_internal boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'sender_type', m.sender_type,
           'sender_name', CASE WHEN m.sender_type = 'platform' AND NOT _with_internal THEN 'צוות התמיכה'
                               ELSE m.sender_name END,
           'mine', m.sender_id IS NOT DISTINCT FROM auth.uid(), 'body', m.body,
           'internal', m.internal, 'created_at', hospitality._ts(m.created_at),
           'files', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                'id', a.id, 'name', a.file_name, 'mime', a.mime, 'size', a.size_bytes)
                                ORDER BY a.created_at)
                               FROM hospitality.support_attachments a
                              WHERE a.message_id = m.id AND a.status = 'ready'), '[]'::jsonb))
           ORDER BY m.created_at), '[]'::jsonb)
    FROM hospitality.support_messages m
   WHERE m.ticket_id = _ticket AND (_with_internal OR NOT m.internal);
$$;
REVOKE ALL ON FUNCTION hospitality._support_messages(uuid, boolean) FROM PUBLIC, anon, authenticated;


-- שינוי סטטוס עם חותמות הזמן (נפתרה / נסגרה)
CREATE OR REPLACE FUNCTION hospitality._support_set_status(_ticket uuid, _status text)
RETURNS hospitality.support_tickets LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tk hospitality.support_tickets;
BEGIN
  IF _status NOT IN ('new', 'in_progress', 'waiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.support_tickets x
     SET status = _status,
         resolved_at = CASE WHEN _status = 'resolved' THEN COALESCE(x.resolved_at, now())
                            WHEN _status = 'closed' THEN x.resolved_at END,
         closed_at = CASE WHEN _status = 'closed' THEN COALESCE(x.closed_at, now()) END,
         updated_at = now()
   WHERE x.id = _ticket
  RETURNING * INTO tk;
  RETURN tk;
END $$;
REVOKE ALL ON FUNCTION hospitality._support_set_status(uuid, text) FROM PUBLIC, anon, authenticated;

-- בדיקת התוכן של הודעה
CREATE OR REPLACE FUNCTION hospitality._support_body(_body text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF char_length(btrim(COALESCE(_body, ''))) < 1 THEN
    RAISE EXCEPTION 'כתבו הודעה' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(btrim(_body)) > 5000 THEN
    RAISE EXCEPTION 'ההודעה ארוכה מדי (עד 5,000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN btrim(_body);
END $$;
REVOKE ALL ON FUNCTION hospitality._support_body(text) FROM PUBLIC, anon, authenticated;

-- פרטי העסק לצד הפלטפורמה (בקצרה ברשימה, במלואם בפנייה)
CREATE OR REPLACE FUNCTION hospitality._support_business(_tenant_id uuid, _full boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
           'id', t.id, 'name', COALESCE(NULLIF(btrim(s.business_name), ''), t.name), 'slug', t.slug,
           'domain', t.domain, 'plan', hospitality._support_plan(t.id))
      || CASE WHEN _full THEN jsonb_build_object(
           'plan_code', sub.plan_code, 'subscription_status', sub.status,
           'owner_email', t.owner_email, 'contact_email', s.contact_email, 'contact_phone', s.contact_phone,
           'units', (SELECT count(*)::int FROM hospitality.units u
                      WHERE u.tenant_id = t.id AND u.is_active AND u.kind <> 'whole_property'),
           'tickets', (SELECT count(*)::int FROM hospitality.support_tickets x WHERE x.tenant_id = t.id),
           'created_at', hospitality._ts(t.created_at))
         ELSE '{}'::jsonb END
    FROM public.tenants t
    LEFT JOIN hospitality.settings s ON s.tenant_id = t.id
    LEFT JOIN hospitality.subscriptions sub ON sub.tenant_id = t.id
   WHERE t.id = _tenant_id;
$$;
REVOKE ALL ON FUNCTION hospitality._support_business(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. מיילים
-- ------------------------------------------------------------
-- לעסק (תור ההודעות הקיים): "יש תשובה מהתמיכה" — למי שפתח את הפנייה, ואם אין — לבעל העסק.
-- בלי תוכן ההודעה (המייל עלול להיות מועבר); הקישור מוביל לאזור הניהול, שם צריך להתחבר.
CREATE OR REPLACE FUNCTION hospitality._support_notify_business(tk hospitality.support_tickets, _message uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _emails text[];
  _email text;
  _n integer := 0;
  _added integer;
BEGIN
  _emails := CASE WHEN tk.opened_by_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN ARRAY[tk.opened_by_email]
                  ELSE hospitality._owner_emails(tk.tenant_id) END;
  FOREACH _email IN ARRAY COALESCE(_emails, '{}') LOOP
    INSERT INTO hospitality.notifications (tenant_id, booking_id, event, recipient_kind, recipient_email, dedupe_key, payload)
    VALUES (tk.tenant_id, NULL, 'support_reply', 'owner', _email,
            'support:' || _message::text || ':' || _email,
            jsonb_build_object('ticket_id', tk.id, 'ticket_number', tk.number, 'subject', left(tk.subject, 120),
                               'ticket_status', tk.status))
    ON CONFLICT (dedupe_key) DO NOTHING;
    GET DIAGNOSTICS _added = ROW_COUNT;
    _n := _n + _added;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION hospitality._support_notify_business(hospitality.support_tickets, uuid) FROM PUBLIC, anon, authenticated;

-- לצוות הפלטפורמה: הכתובות של מנהלי הפלטפורמה — רק לשרת (מפתח שירות), לא לעסקים. השרת שולח
-- את ההתראה על פנייה חדשה / תגובה אחרי שהפעולה נשמרה (כשל במייל לא מפיל את הפנייה).
CREATE OR REPLACE FUNCTION hospitality.support_platform_recipients()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(DISTINCT lower(u.email::text)), '{}'::text[])
    FROM public.platform_admins pa
    JOIN auth.users u ON u.id = pa.user_id
   WHERE u.email IS NOT NULL AND u.deleted_at IS NULL;
$$;
REVOKE ALL ON FUNCTION hospitality.support_platform_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.support_platform_recipients() TO service_role;

-- ------------------------------------------------------------
-- 4. צד העסק — בעלים ומנהלים (הרשאת settings), אזור הניהול פעיל
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hospitality.support_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _plan text := hospitality._support_plan(_t);
BEGIN
  RETURN jsonb_build_object(
    'plan', _plan,
    'whatsapp', CASE WHEN _plan = 'premium' THEN (SELECT s.whatsapp FROM hospitality.support_settings s WHERE s.id) END,
    'counts', (SELECT jsonb_build_object(
                 'open', count(*) FILTER (WHERE x.status IN ('new', 'in_progress')),
                 'waiting_customer', count(*) FILTER (WHERE x.status = 'waiting_customer'),
                 'done', count(*) FILTER (WHERE x.status IN ('resolved', 'closed')),
                 'all', count(*))
                 FROM hospitality.support_tickets x WHERE x.tenant_id = _t),
    'items', COALESCE((
      SELECT jsonb_agg(hospitality._support_ticket_row(tk, 'business')
                       ORDER BY (tk.status IN ('resolved', 'closed')), tk.last_message_at DESC)
        FROM hospitality.support_tickets tk
       WHERE tk.tenant_id = _t
         AND tk.id IN (SELECT x.id FROM hospitality.support_tickets x WHERE x.tenant_id = _t
                        ORDER BY x.last_message_at DESC LIMIT 200)), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.support_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_list() TO authenticated, service_role;

-- כמה תשובות של התמיכה עוד לא נקראו (לתג בתפריט)
CREATE OR REPLACE FUNCTION hospitality.support_unread()
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
BEGIN
  RETURN (SELECT count(*)::int
            FROM hospitality.support_messages m
            JOIN hospitality.support_tickets tk ON tk.tenant_id = m.tenant_id AND tk.id = m.ticket_id
           WHERE m.tenant_id = _t AND NOT m.internal AND m.sender_type = 'platform'
             AND m.created_at > COALESCE(tk.business_read_at, '-infinity'::timestamptz));
END $$;
REVOKE ALL ON FUNCTION hospitality.support_unread() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_unread() TO authenticated, service_role;

-- פנייה אחת (בלי הערות פנימיות); הצפייה מסמנת את התשובות כנקראו
CREATE OR REPLACE FUNCTION hospitality.support_ticket(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  tk hospitality.support_tickets;
BEGIN
  UPDATE hospitality.support_tickets x SET business_read_at = now()
   WHERE x.tenant_id = _t AND x.id = _id
  RETURNING * INTO tk;
  IF tk.id IS NULL THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._support_ticket_row(tk, 'business')
      || jsonb_build_object('messages', hospitality._support_messages(tk.id, false),
                            'plan', hospitality._support_plan(_t));
END $$;
REVOKE ALL ON FUNCTION hospitality.support_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_ticket(uuid) TO authenticated, service_role;

-- פתיחת פנייה: נושא, תחום, דחיפות, תיאור, קבצים (רשומות "ממתין"; השרת מעלה ומסמן "מוכן").
-- עד 10 פניות חדשות ביממה לעסק.
CREATE OR REPLACE FUNCTION hospitality.support_open(_subject text, _topic text, _priority text, _body text,
                                                    _files jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _uid uuid := auth.uid();
  _name text;
  _text text := hospitality._support_body(_body);
  tk hospitality.support_tickets;
  _m uuid := gen_random_uuid();
  _uploads jsonb;
BEGIN
  IF char_length(btrim(COALESCE(_subject, ''))) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'נושא הפנייה: 3 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _topic IS NULL OR _topic NOT IN ('bookings', 'payments', 'website', 'calendar', 'account', 'technical', 'other') THEN
    RAISE EXCEPTION 'בחרו תחום' USING ERRCODE = 'check_violation';
  END IF;
  IF _priority IS NULL OR _priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'בחרו דחיפות' USING ERRCODE = 'check_violation';
  END IF;
  -- לא להציף: נעילה לעסק (גם פניות מקבילות נספרות)
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-support-open:' || _t::text, 0));
  IF (SELECT count(*) FROM hospitality.support_tickets x
       WHERE x.tenant_id = _t AND x.created_at > now() - interval '1 day') >= 10 THEN
    RAISE EXCEPTION 'נפתחו הרבה פניות היום — אפשר להוסיף פרטים בפנייה קיימת' USING ERRCODE = 'check_violation';
  END IF;
  _name := hospitality._support_sender_name(_t, _uid);
  INSERT INTO hospitality.support_tickets
    (tenant_id, subject, topic, priority, opened_by, opened_by_name, opened_by_email, last_public_sender)
  VALUES (_t, btrim(_subject), _topic, _priority, _uid, _name,
          (SELECT left(lower(u.email::text), 254) FROM auth.users u WHERE u.id = _uid), 'business')
  RETURNING * INTO tk;
  INSERT INTO hospitality.support_messages (id, tenant_id, ticket_id, sender_type, sender_id, sender_name, body)
  VALUES (_m, _t, tk.id, 'business', _uid, _name, _text);
  _uploads := hospitality._support_add_files(_t, tk.id, _m, _files);
  PERFORM hospitality._audit(_t, 'support.opened', '#' || tk.number,
                             jsonb_build_object('topic', _topic, 'priority', _priority));
  RETURN jsonb_build_object('ticket', hospitality._support_ticket_row(tk, 'business'), 'message_id', _m,
                            'uploads', _uploads, 'business', hospitality._support_business(_t, false));
END $$;
REVOKE ALL ON FUNCTION hospitality.support_open(text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_open(text, text, text, text, jsonb) TO authenticated, service_role;

-- תגובה של העסק. פנייה סגורה — קודם פותחים מחדש. תגובה לפנייה שממתינה ללקוח / נפתרה → "בטיפול".
-- עד 30 הודעות בשעה לעסק.
CREATE OR REPLACE FUNCTION hospitality.support_reply(_ticket uuid, _body text, _files jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _uid uuid := auth.uid();
  _text text := hospitality._support_body(_body);
  tk hospitality.support_tickets;
  _m uuid := gen_random_uuid();
  _uploads jsonb;
BEGIN
  SELECT * INTO tk FROM hospitality.support_tickets x WHERE x.tenant_id = _t AND x.id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF tk.status = 'closed' THEN
    RAISE EXCEPTION 'הפנייה סגורה — אפשר לפתוח אותה מחדש' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM hospitality.support_messages m
       WHERE m.tenant_id = _t AND m.sender_type = 'business' AND m.created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'נשלחו הרבה הודעות — נסו שוב בעוד כמה דקות' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.support_messages (id, tenant_id, ticket_id, sender_type, sender_id, sender_name, body)
  VALUES (_m, _t, tk.id, 'business', _uid, hospitality._support_sender_name(_t, _uid), _text);
  _uploads := hospitality._support_add_files(_t, tk.id, _m, _files);
  IF tk.status IN ('waiting_customer', 'resolved') THEN
    tk := hospitality._support_set_status(tk.id, 'in_progress');
  END IF;
  UPDATE hospitality.support_tickets x
     SET last_message_at = now(), last_public_sender = 'business', business_read_at = now(), updated_at = now()
   WHERE x.id = tk.id
  RETURNING * INTO tk;
  RETURN jsonb_build_object('ticket', hospitality._support_ticket_row(tk, 'business'), 'message_id', _m,
                            'uploads', _uploads, 'business', hospitality._support_business(_t, false));
END $$;
REVOKE ALL ON FUNCTION hospitality.support_reply(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_reply(uuid, text, jsonb) TO authenticated, service_role;

-- סגירה (העסק סיים) / פתיחה מחדש (פנייה שנפתרה או נסגרה → "בטיפול", ממתינה למענה מהתמיכה)
CREATE OR REPLACE FUNCTION hospitality.support_set_open(_ticket uuid, _open boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  tk hospitality.support_tickets;
BEGIN
  SELECT * INTO tk FROM hospitality.support_tickets x WHERE x.tenant_id = _t AND x.id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _open THEN
    IF tk.status NOT IN ('resolved', 'closed') THEN
      RAISE EXCEPTION 'הפנייה כבר פתוחה' USING ERRCODE = 'check_violation';
    END IF;
    tk := hospitality._support_set_status(tk.id, 'in_progress');
    UPDATE hospitality.support_tickets x SET last_public_sender = 'business', last_message_at = now()
     WHERE x.id = tk.id RETURNING * INTO tk;
    PERFORM hospitality._audit(_t, 'support.reopened', '#' || tk.number, '{}'::jsonb);
  ELSE
    IF tk.status = 'closed' THEN
      RAISE EXCEPTION 'הפנייה כבר סגורה' USING ERRCODE = 'check_violation';
    END IF;
    tk := hospitality._support_set_status(tk.id, 'closed');
    PERFORM hospitality._audit(_t, 'support.closed', '#' || tk.number, '{}'::jsonb);
  END IF;
  RETURN hospitality._support_ticket_row(tk, 'business');
END $$;
REVOKE ALL ON FUNCTION hospitality.support_set_open(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_set_open(uuid, boolean) TO authenticated, service_role;

-- אחרי ההעלאה: הקבצים שהמשתמש עצמו צירף (בשעה האחרונה) → "מוכן"
CREATE OR REPLACE FUNCTION hospitality.support_files_ready(_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _n integer;
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN 0; END IF;
  IF cardinality(_ids) > 5 THEN
    RAISE EXCEPTION 'יותר מדי קבצים' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.support_attachments a SET status = 'ready'
   WHERE a.tenant_id = _t AND a.id = ANY (_ids) AND a.status = 'pending'
     AND a.created_at > now() - interval '1 hour'
     AND EXISTS (SELECT 1 FROM hospitality.support_messages m
                  WHERE m.tenant_id = _t AND m.id = a.message_id AND m.sender_type = 'business'
                    AND m.sender_id = auth.uid());
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION hospitality.support_files_ready(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_files_ready(uuid[]) TO authenticated, service_role;

-- קובץ להורדה: רק של העסק, רק "מוכן", ולעולם לא של הערה פנימית. השרת יוצר קישור חתום קצר.
CREATE OR REPLACE FUNCTION hospitality.support_file(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._manage_tenant('settings');
  _r jsonb;
BEGIN
  SELECT jsonb_build_object('path', a.storage_path, 'name', a.file_name, 'mime', a.mime) INTO _r
    FROM hospitality.support_attachments a
    JOIN hospitality.support_messages m ON m.tenant_id = a.tenant_id AND m.id = a.message_id
   WHERE a.tenant_id = _t AND a.id = _id AND a.status = 'ready' AND NOT m.internal;
  IF _r IS NULL THEN
    RAISE EXCEPTION 'הקובץ לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.support_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.support_file(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. צד הפלטפורמה — מנהל הפלטפורמה בלבד
-- ------------------------------------------------------------
-- כל הפניות: סינון לפי סטטוס (או "פתוחות"), דחיפות, תאריכי פתיחה, חיפוש (נושא / מספר / עסק /
-- אימייל), "ממתינות למענה" (הכי ותיקות קודם).
CREATE OR REPLACE FUNCTION hospitality.admin_support_tickets(_status text DEFAULT NULL, _priority text DEFAULT NULL,
                                                             _from date DEFAULT NULL, _to date DEFAULT NULL,
                                                             _q text DEFAULT NULL, _needs_reply boolean DEFAULT false,
                                                             _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _needle text := lower(NULLIF(btrim(COALESCE(_q, '')), ''));
  _num bigint;
  _ids uuid[];
  _total integer;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _status IS NOT NULL AND _status NOT IN ('open', 'new', 'in_progress', 'waiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  IF _priority IS NOT NULL AND _priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'דחיפות לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF _limit NOT BETWEEN 1 AND 200 OR _offset NOT BETWEEN 0 AND 100000 THEN
    RAISE EXCEPTION 'עמוד לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(COALESCE(_needle, '')) > 80 THEN
    RAISE EXCEPTION 'החיפוש ארוך מדי' USING ERRCODE = 'check_violation';
  END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _to < _from THEN
    RAISE EXCEPTION 'טווח תאריכים לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _needle ~ '^#?[0-9]{1,12}$' THEN
    _num := ltrim(_needle, '#')::bigint;
  END IF;

  WITH matched AS (
    SELECT tk.id,
           CASE WHEN _needs_reply THEN extract(epoch FROM tk.last_message_at)
                ELSE -extract(epoch FROM tk.last_message_at) END AS ord
      FROM hospitality.support_tickets tk
      JOIN public.tenants t ON t.id = tk.tenant_id
      LEFT JOIN hospitality.settings s ON s.tenant_id = tk.tenant_id
     WHERE (_status IS NULL
            OR (_status = 'open' AND tk.status IN ('new', 'in_progress', 'waiting_customer'))
            OR tk.status = _status)
       AND (_priority IS NULL OR tk.priority = _priority)
       AND (_from IS NULL OR (tk.created_at AT TIME ZONE 'Asia/Jerusalem')::date >= _from)
       AND (_to IS NULL OR (tk.created_at AT TIME ZONE 'Asia/Jerusalem')::date <= _to)
       AND (NOT COALESCE(_needs_reply, false)
            OR (tk.status IN ('new', 'in_progress') AND tk.last_public_sender = 'business'))
       AND (_needle IS NULL
            OR tk.number = _num
            OR position(_needle IN lower(tk.subject)) > 0
            OR position(_needle IN lower(COALESCE(s.business_name, t.name))) > 0
            OR position(_needle IN lower(t.slug)) > 0
            OR position(_needle IN COALESCE(tk.opened_by_email, '')) > 0)
  ), page AS (
    SELECT m.id, m.ord FROM matched m ORDER BY m.ord, m.id LIMIT _limit OFFSET _offset
  )
  SELECT (SELECT count(*)::int FROM matched), (SELECT array_agg(p.id ORDER BY p.ord, p.id) FROM page p)
    INTO _total, _ids;

  RETURN jsonb_build_object(
    'counts', (SELECT jsonb_build_object(
                 'new', count(*) FILTER (WHERE x.status = 'new'),
                 'in_progress', count(*) FILTER (WHERE x.status = 'in_progress'),
                 'waiting_customer', count(*) FILTER (WHERE x.status = 'waiting_customer'),
                 'resolved', count(*) FILTER (WHERE x.status = 'resolved'),
                 'closed', count(*) FILTER (WHERE x.status = 'closed'),
                 'needs_reply', count(*) FILTER (WHERE x.status IN ('new', 'in_progress')
                                                   AND x.last_public_sender = 'business'),
                 'urgent_open', count(*) FILTER (WHERE x.priority IN ('high', 'urgent')
                                                   AND x.status IN ('new', 'in_progress', 'waiting_customer')))
                 FROM hospitality.support_tickets x),
    'total', COALESCE(_total, 0),
    'items', COALESCE((
      SELECT jsonb_agg(hospitality._support_ticket_row(tk, 'platform')
                       || jsonb_build_object('business', hospitality._support_business(tk.tenant_id, false),
                                             'opened_by_email', tk.opened_by_email)
                       ORDER BY array_position(_ids, tk.id))
        FROM hospitality.support_tickets tk
       WHERE tk.id = ANY (COALESCE(_ids, '{}'::uuid[]))), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_tickets(text, text, date, date, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_tickets(text, text, date, date, text, boolean, integer, integer) TO authenticated, service_role;

-- פנייה אחת עם ההערות הפנימיות ופרטי העסק; הצפייה מסמנת כנקראה בפלטפורמה
CREATE OR REPLACE FUNCTION hospitality.admin_support_ticket(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tk hospitality.support_tickets;
BEGIN
  PERFORM hospitality._require_platform_admin();
  UPDATE hospitality.support_tickets x SET platform_read_at = now() WHERE x.id = _id RETURNING * INTO tk;
  IF tk.id IS NULL THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN hospitality._support_ticket_row(tk, 'platform')
      || jsonb_build_object('business', hospitality._support_business(tk.tenant_id, true),
                            'opened_by_email', tk.opened_by_email,
                            'resolved_at', hospitality._ts(tk.resolved_at), 'closed_at', hospitality._ts(tk.closed_at),
                            'messages', hospitality._support_messages(tk.id, true));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_ticket(uuid) TO authenticated, service_role;

-- מענה (לעסק — ברירת המחדל "ממתינה לתשובת הלקוח", מייל לעסק) או הערה פנימית (לא נחשפת לעסק;
-- פנייה חדשה עוברת ל"בטיפול"). _status — לשנות גם סטטוס באותה פעולה.
CREATE OR REPLACE FUNCTION hospitality.admin_support_reply(_id uuid, _body text, _internal boolean DEFAULT false,
                                                           _status text DEFAULT NULL, _files jsonb DEFAULT '[]'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _text text;
  tk hospitality.support_tickets;
  _m uuid := gen_random_uuid();
  _uploads jsonb;
  _next text;
BEGIN
  PERFORM hospitality._require_platform_admin();
  _text := hospitality._support_body(_body);
  IF _status IS NOT NULL AND _status NOT IN ('in_progress', 'waiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'סטטוס לא מוכר' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO tk FROM hospitality.support_tickets x WHERE x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO hospitality.support_messages (id, tenant_id, ticket_id, sender_type, sender_id, sender_name, body, internal)
  VALUES (_m, tk.tenant_id, tk.id, 'platform', auth.uid(),
          (SELECT left(lower(u.email::text), 120) FROM auth.users u WHERE u.id = auth.uid()),
          _text, COALESCE(_internal, false));
  _uploads := hospitality._support_add_files(tk.tenant_id, tk.id, _m, _files);
  IF COALESCE(_internal, false) THEN
    _next := COALESCE(_status, CASE WHEN tk.status = 'new' THEN 'in_progress' ELSE tk.status END);
    IF _next <> tk.status THEN
      tk := hospitality._support_set_status(tk.id, _next);
    END IF;
    UPDATE hospitality.support_tickets x SET platform_read_at = now(), updated_at = now()
     WHERE x.id = tk.id RETURNING * INTO tk;
  ELSE
    tk := hospitality._support_set_status(tk.id, COALESCE(_status, 'waiting_customer'));
    UPDATE hospitality.support_tickets x
       SET last_message_at = now(), last_public_sender = 'platform', platform_read_at = now(),
           first_response_at = COALESCE(x.first_response_at, now()), updated_at = now()
     WHERE x.id = tk.id RETURNING * INTO tk;
    PERFORM hospitality._support_notify_business(tk, _m);
  END IF;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (tk.tenant_id, auth.uid(), CASE WHEN COALESCE(_internal, false) THEN 'hosp_support_note' ELSE 'hosp_support_reply' END,
          jsonb_build_object('ticket', tk.number, 'status', tk.status));
  RETURN jsonb_build_object('message_id', _m, 'uploads', _uploads, 'status', tk.status);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_reply(uuid, text, boolean, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_reply(uuid, text, boolean, text, jsonb) TO authenticated, service_role;

-- שינוי סטטוס (כולל סגירה ופתיחה מחדש)
CREATE OR REPLACE FUNCTION hospitality.admin_support_set_status(_id uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tk hospitality.support_tickets;
  _old text;
BEGIN
  PERFORM hospitality._require_platform_admin();
  SELECT * INTO tk FROM hospitality.support_tickets x WHERE x.id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  _old := tk.status;
  tk := hospitality._support_set_status(tk.id, _status);
  UPDATE hospitality.support_tickets x SET platform_read_at = now() WHERE x.id = tk.id RETURNING * INTO tk;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (tk.tenant_id, auth.uid(), 'hosp_support_status',
          jsonb_build_object('ticket', tk.number, 'from', _old, 'to', tk.status));
  RETURN hospitality._support_ticket_row(tk, 'platform');
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_set_status(uuid, text) TO authenticated, service_role;

-- אחרי ההעלאה של צוות הפלטפורמה
CREATE OR REPLACE FUNCTION hospitality.admin_support_files_ready(_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN 0; END IF;
  IF cardinality(_ids) > 5 THEN
    RAISE EXCEPTION 'יותר מדי קבצים' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.support_attachments a SET status = 'ready'
   WHERE a.id = ANY (_ids) AND a.status = 'pending' AND a.created_at > now() - interval '1 hour'
     AND EXISTS (SELECT 1 FROM hospitality.support_messages m
                  WHERE m.tenant_id = a.tenant_id AND m.id = a.message_id AND m.sender_type = 'platform'
                    AND m.sender_id = auth.uid());
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_files_ready(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_files_ready(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.admin_support_file(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _r jsonb;
BEGIN
  PERFORM hospitality._require_platform_admin();
  SELECT jsonb_build_object('path', a.storage_path, 'name', a.file_name, 'mime', a.mime) INTO _r
    FROM hospitality.support_attachments a WHERE a.id = _id AND a.status = 'ready';
  IF _r IS NULL THEN
    RAISE EXCEPTION 'הקובץ לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_file(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_file(uuid) TO authenticated, service_role;

-- הגדרות התמיכה (WhatsApp לפרימיום)
CREATE OR REPLACE FUNCTION hospitality.admin_support_settings(_whatsapp text DEFAULT NULL, _save boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _w text := NULLIF(regexp_replace(COALESCE(_whatsapp, ''), '[\s\-()]', '', 'g'), '');
  _s hospitality.support_settings;
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF _save THEN
    IF _w IS NOT NULL AND _w !~ '^\+?[0-9]{9,15}$' THEN
      RAISE EXCEPTION 'מספר WhatsApp לא תקין' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE hospitality.support_settings x SET whatsapp = _w, updated_by = auth.uid(), updated_at = now()
     WHERE x.id RETURNING * INTO _s;
    INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
    VALUES (NULL, auth.uid(), 'hosp_support_settings', jsonb_build_object('whatsapp', _w IS NOT NULL));
  ELSE
    SELECT * INTO _s FROM hospitality.support_settings x WHERE x.id;
  END IF;
  RETURN jsonb_build_object('whatsapp', _s.whatsapp, 'updated_at', hospitality._ts(_s.updated_at));
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_support_settings(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_support_settings(text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

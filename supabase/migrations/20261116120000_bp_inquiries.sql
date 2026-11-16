-- ============================================================
-- מיגרציה 196: פניות מלקוחות באתרי העסקים (Nuriel Websites, ‏business_profile)
--
-- • טבלאות סגורות (RLS, בלי הרשאות ל-anon / authenticated) בסכמת business_profile:
--   inquiries (הפנייה + מצב הטיפול + מצב ההתראה במייל), inquiry_notes (הערות פנימיות),
--   inquiry_settings (המייל להתראות, הפעלה, תקופת השמירה) — פרטים פרטיים, לא במסמך האתר הציבורי.
-- • שליחת פנייה: רק מהשרת שלנו (service_role) — אחרי מלכודת בוטים, הגבלת קצב ובדיקת הקלט שם. המסד
--   בודק שוב: האתר של הבקשה (x-tenant-id), אתר חי (או פניית בדיקה מהתצוגה המקדימה), קלט תקין, הגבלת
--   קצב לפי טביעת IP (HMAC — אין כתובות IP במסד) ולפי אתר, ומפתח חד-פעמי (client_key) נגד שליחה כפולה.
-- • ההתראה במייל: הפנייה נשמרת קודם, תמיד. מצב השליחה נשמר בשורה (pending / sending / sent / failed /
--   skipped), עם מספר ניסיונות, שגיאה אחרונה (בלי פרטים אישיים) וניסיון חוזר אוטומטי (5 / 30 / 120 דק').
--   ניסיון חוזר ידני — מממשק הניהול, למורשים בלבד.
-- • ממשק הניהול: הרשאה חדשה inquiries.manage — לבעל העסק (ולמנהל הפלטפורמה) בלבד; מנהל תוכן לא רואה
--   פרטי לקוחות. כל פעולה של מנהל נרשמת ב-audit_log (בלי תוכן הפנייה).
-- • שמירה ומחיקה: פניות נמחקות אוטומטית אחרי retention_days (ברירת מחדל 365, 30–1095), פניות בדיקה
--   אחרי 30 יום; מחיקה ידנית של פנייה / של כל פניות הבדיקה.
--
-- Rollback: supabase/rollbacks/20261116120000_bp_inquiries.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ---------- 1. הרשאה חדשה: ניהול פניות (בעל העסק בלבד) ----------
CREATE OR REPLACE FUNCTION business_profile.permissions()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN business_profile.request_site() IS NULL OR auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.store_staff_role(auth.uid()) = 'owner' THEN
      ARRAY['content.edit', 'site.publish', 'versions.restore', 'settings.owner', 'inquiries.manage']
    WHEN public.store_staff_role(auth.uid()) = 'manager' THEN ARRAY['content.edit']
    ELSE ARRAY[]::text[]
  END;
$$;
REVOKE ALL ON FUNCTION business_profile.permissions() FROM PUBLIC, anon, authenticated;

-- ---------- 2. טבלאות ----------
CREATE TABLE IF NOT EXISTS business_profile.inquiry_settings (
  tenant_id      uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  notify_email   text CHECK (notify_email IS NULL OR (char_length(notify_email) <= 254
                   AND notify_email ~ '^[^[:space:]@<>"'']+@[^[:space:]@<>"'']+\.[^[:space:]@<>"'']+$')),
  notify_enabled boolean NOT NULL DEFAULT true,
  retention_days integer NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 30 AND 1095),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid
);

CREATE TABLE IF NOT EXISTS business_profile.inquiries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- נוצר בדפדפן כשהטופס נפתח: אותה שליחה פעמיים (לחיצה כפולה / רשת איטית) = פנייה אחת
  client_key          uuid NOT NULL,
  kind                text NOT NULL DEFAULT 'contact'
                        CHECK (kind IN ('contact', 'consultation', 'quote', 'other')),
  form_title          text CHECK (form_title IS NULL OR char_length(form_title) <= 160),
  page_path           text CHECK (page_path IS NULL OR (char_length(page_path) <= 200 AND page_path ~ '^/')),
  full_name           text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone               text CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{9,15}$'),
  email               text CHECK (email IS NULL OR (char_length(email) <= 254
                        AND email ~ '^[^[:space:]@<>"'']+@[^[:space:]@<>"'']+\.[^[:space:]@<>"'']+$')),
  message             text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 4000),
  status              text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done')),
  status_changed_at   timestamptz,
  status_changed_by   uuid,
  -- פנייה מהתצוגה המקדימה (לפני הפרסום) — מסומנת בממשק, לא נספרת בהגבלת הקצב של האתר החי
  is_test             boolean NOT NULL DEFAULT false,
  -- HMAC של כתובת ה-IP (בשרת) — להגבלת קצב בלבד
  ip_hash             text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  notify_status       text NOT NULL DEFAULT 'pending'
                        CHECK (notify_status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  notify_attempts     integer NOT NULL DEFAULT 0 CHECK (notify_attempts BETWEEN 0 AND 1000),
  notify_error        text CHECK (notify_error IS NULL OR char_length(notify_error) <= 300),
  notify_next_at      timestamptz,
  notify_locked_until timestamptz,
  notify_sent_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bp_inquiries_contact_way CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT bp_inquiries_client_key UNIQUE (tenant_id, client_key),
  CONSTRAINT bp_inquiries_tenant_id UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS bp_inquiries_list ON business_profile.inquiries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bp_inquiries_rate ON business_profile.inquiries (tenant_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS bp_inquiries_notify_due ON business_profile.inquiries (notify_next_at)
  WHERE notify_status IN ('pending', 'sending', 'failed');

CREATE TABLE IF NOT EXISTS business_profile.inquiry_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  inquiry_id uuid NOT NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body = btrim(body)),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- הערה תמיד באותו אתר של הפנייה שלה
  CONSTRAINT bp_inquiry_notes_inquiry FOREIGN KEY (tenant_id, inquiry_id)
    REFERENCES business_profile.inquiries (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS bp_inquiry_notes_of ON business_profile.inquiry_notes (inquiry_id, created_at);

-- סגור ל-API (כמו שאר הסכמה): אין הרשאות לגולשים / למשתמשים; גישה רק דרך הפונקציות שלמטה.
-- RLS + מדיניות הפרדה בין אתרים — הגנה נוספת אם מישהו יוסיף הרשאה בטעות בעתיד.
ALTER TABLE business_profile.inquiry_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile.inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile.inquiry_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON business_profile.inquiry_settings;
DROP POLICY IF EXISTS tenant_isolation ON business_profile.inquiries;
DROP POLICY IF EXISTS tenant_isolation ON business_profile.inquiry_notes;
CREATE POLICY tenant_isolation ON business_profile.inquiry_settings AS RESTRICTIVE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON business_profile.inquiries AS RESTRICTIVE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation ON business_profile.inquiry_notes AS RESTRICTIVE
  USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
REVOKE ALL ON business_profile.inquiry_settings, business_profile.inquiries, business_profile.inquiry_notes
  FROM PUBLIC, anon, authenticated, service_role;
-- קריאה בלבד ל-service_role (גיבויים / תמיכה) — כמו שאר הסכמה
GRANT SELECT ON business_profile.inquiry_settings, business_profile.inquiries, business_profile.inquiry_notes
  TO service_role;

-- ---------- 3. עזרים פנימיים ----------
CREATE OR REPLACE FUNCTION business_profile._inquiry_email_ok(_v text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _v IS NOT NULL AND char_length(_v) <= 254
     AND _v ~ '^[^[:space:]@<>"'']+@[^[:space:]@<>"'']+\.[^[:space:]@<>"'']+$';
$$;

-- האתר חי (אותם תנאים של bp_public_site, בלי להחזיר את המסמך)
CREATE OR REPLACE FUNCTION business_profile._site_live(_t uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
      JOIN business_profile.sites s ON s.tenant_id = t.id AND s.first_approved_at IS NOT NULL
      JOIN business_profile.site_versions v ON v.id = s.live_version_id AND v.state = 'published'
     WHERE t.id = _t AND t.status = 'active'
       AND public.platform_feature_enabled('business_profile_enabled', t.id)
       AND public.platform_feature_enabled('business_profile_public', t.id));
$$;

-- ההגדרות של אתר (עם ברירות המחדל כשעוד לא נשמרו)
CREATE OR REPLACE FUNCTION business_profile._inquiry_settings(_t uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'notify_email', s.notify_email,
    'notify_enabled', COALESCE(s.notify_enabled, true),
    'retention_days', COALESCE(s.retention_days, 365),
    'updated_at', s.updated_at)
    FROM (SELECT 1) one
    LEFT JOIN business_profile.inquiry_settings s ON s.tenant_id = _t;
$$;

-- הסיבה שאין התראה במייל (NULL = אפשר לשלוח)
CREATE OR REPLACE FUNCTION business_profile._inquiry_notify_block(_t uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN s.notify_enabled IS FALSE THEN 'ההתראות במייל כבויות בהגדרות'
    WHEN s.notify_email IS NULL THEN 'לא הוגדר מייל להתראות'
    ELSE NULL END
    FROM (SELECT 1) one
    LEFT JOIN business_profile.inquiry_settings s ON s.tenant_id = _t;
$$;

CREATE OR REPLACE FUNCTION business_profile._inquiry_reference(_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT upper(left(replace(_id::text, '-', ''), 8));
$$;

-- שורה לרשימה / לפרטים (בלי ip_hash ובלי מפתח הלקוח)
CREATE OR REPLACE FUNCTION business_profile._inquiry_json(_i business_profile.inquiries, _full boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', _i.id, 'reference', business_profile._inquiry_reference(_i.id), 'created_at', _i.created_at,
    'kind', _i.kind, 'form_title', _i.form_title, 'page_path', _i.page_path,
    'full_name', _i.full_name, 'phone', _i.phone, 'email', _i.email,
    'message', CASE WHEN _full THEN _i.message ELSE left(_i.message, 160) END,
    'status', _i.status, 'status_changed_at', _i.status_changed_at, 'is_test', _i.is_test,
    'notify_status', _i.notify_status, 'notify_attempts', _i.notify_attempts,
    'notify_error', _i.notify_error, 'notify_sent_at', _i.notify_sent_at, 'notify_next_at', _i.notify_next_at,
    'notes_count', (SELECT count(*) FROM business_profile.inquiry_notes n
                     WHERE n.tenant_id = _i.tenant_id AND n.inquiry_id = _i.id));
$$;

REVOKE ALL ON FUNCTION business_profile._inquiry_email_ok(text), business_profile._site_live(uuid),
  business_profile._inquiry_settings(uuid), business_profile._inquiry_notify_block(uuid),
  business_profile._inquiry_reference(uuid), business_profile._inquiry_json(business_profile.inquiries, boolean)
  FROM PUBLIC, anon, authenticated;

-- ---------- 4. שליחת פנייה (השרת בלבד) ----------
-- האתר — של הבקשה (x-tenant-id). _test: פנייה מהתצוגה המקדימה (השרת בדק שהשולח מחובר ומורשה באתר).
CREATE OR REPLACE FUNCTION public.bp_inquiry_submit(_client_key uuid, _kind text, _form_title text, _page_path text,
                                                    _full_name text, _phone text, _email text, _message text,
                                                    _ip_hash text DEFAULT NULL, _test boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.request_site();
  _name text := btrim(regexp_replace(COALESCE(_full_name, ''), '[[:space:]]+', ' ', 'g'));
  _ph text := NULLIF(regexp_replace(COALESCE(_phone, ''), '[^0-9+]', '', 'g'), '');
  _em text := NULLIF(lower(btrim(COALESCE(_email, ''))), '');
  _msg text := NULLIF(btrim(COALESCE(_message, '')), '');
  _k text := COALESCE(NULLIF(btrim(_kind), ''), 'contact');
  _title text := NULLIF(left(btrim(COALESCE(_form_title, '')), 160), '');
  _path text := NULLIF(btrim(COALESCE(_page_path, '')), '');
  _block text;
  _row business_profile.inquiries;
BEGIN
  IF _t IS NULL THEN
    RAISE EXCEPTION 'האתר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF COALESCE(_test, false) THEN
    IF NOT public.platform_feature_enabled('business_profile_enabled', _t) THEN
      RAISE EXCEPTION 'הטופס לא זמין כרגע' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT business_profile._site_live(_t) THEN
    RAISE EXCEPTION 'הטופס לא זמין כרגע' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _client_key IS NULL THEN
    RAISE EXCEPTION 'הטופס לא תקין — רעננו את העמוד ונסו שוב' USING ERRCODE = 'check_violation';
  END IF;

  -- אותה שליחה שוב (לחיצה כפולה / ניסיון חוזר של הרשת) — מחזירים את הפנייה שכבר נשמרה
  SELECT * INTO _row FROM business_profile.inquiries i WHERE i.tenant_id = _t AND i.client_key = _client_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', _row.id, 'reference', business_profile._inquiry_reference(_row.id),
                              'duplicate', true, 'notify', false, 'test', _row.is_test);
  END IF;

  -- קלט (השרת כבר בדק; כאן — שוב, עם הודעות למשתמש)
  IF char_length(_name) < 2 OR char_length(_name) > 120 THEN
    RAISE EXCEPTION 'נא למלא שם (2–120 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _ph IS NOT NULL AND _ph !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'מספר הטלפון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _em IS NOT NULL AND NOT business_profile._inquiry_email_ok(_em) THEN
    RAISE EXCEPTION 'כתובת האימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _ph IS NULL AND _em IS NULL THEN
    RAISE EXCEPTION 'נא להשאיר טלפון או אימייל לחזרה' USING ERRCODE = 'check_violation';
  END IF;
  IF _msg IS NOT NULL AND char_length(_msg) > 4000 THEN
    RAISE EXCEPTION 'ההודעה ארוכה מדי (עד 4000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  IF _k NOT IN ('contact', 'consultation', 'quote', 'other') THEN _k := 'contact'; END IF;
  IF _path IS NOT NULL AND (char_length(_path) > 200 OR _path !~ '^/') THEN _path := NULL; END IF;
  IF _ip_hash IS NOT NULL AND _ip_hash !~ '^[0-9a-f]{64}$' THEN _ip_hash := NULL; END IF;

  -- הגבלת קצב: 5 פניות ב-10 דקות מאותה כתובת באתר; 60 פניות בשעה לאתר (הצפה)
  IF _ip_hash IS NOT NULL AND (
       SELECT count(*) FROM business_profile.inquiries i
        WHERE i.tenant_id = _t AND i.ip_hash = _ip_hash AND i.created_at > now() - interval '10 minutes') >= 5 THEN
    RAISE EXCEPTION 'נשלחו כמה פניות ברצף. נסו שוב בעוד כמה דקות' USING ERRCODE = 'P0429';
  END IF;
  IF (SELECT count(*) FROM business_profile.inquiries i
       WHERE i.tenant_id = _t AND i.is_test = COALESCE(_test, false)
         AND i.created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'נשלחו כמה פניות ברצף. נסו שוב בעוד כמה דקות' USING ERRCODE = 'P0429';
  END IF;

  _block := business_profile._inquiry_notify_block(_t);
  INSERT INTO business_profile.inquiries (tenant_id, client_key, kind, form_title, page_path, full_name, phone,
                                          email, message, is_test, ip_hash, notify_status, notify_error)
  VALUES (_t, _client_key, _k, _title, _path, _name, _ph, _em, _msg, COALESCE(_test, false), _ip_hash,
          CASE WHEN _block IS NULL THEN 'pending' ELSE 'skipped' END, _block)
  ON CONFLICT (tenant_id, client_key) DO NOTHING
  RETURNING * INTO _row;
  IF NOT FOUND THEN -- שתי שליחות מקבילות עם אותו מפתח: השנייה מחזירה את הראשונה
    SELECT * INTO _row FROM business_profile.inquiries i WHERE i.tenant_id = _t AND i.client_key = _client_key;
    RETURN jsonb_build_object('id', _row.id, 'reference', business_profile._inquiry_reference(_row.id),
                              'duplicate', true, 'notify', false, 'test', _row.is_test);
  END IF;
  RETURN jsonb_build_object('id', _row.id, 'reference', business_profile._inquiry_reference(_row.id),
                            'duplicate', false, 'notify', _row.notify_status = 'pending', 'test', _row.is_test);
END $$;

-- ---------- 5. ההתראה במייל (השרת / תהליך הרקע בלבד) ----------
-- לוקחים פנייה לשליחה (נעילה ל-2 דקות): מחזיר את מה שצריך למייל, או NULL (כבר נשלחה / נעולה / כבויה)
CREATE OR REPLACE FUNCTION public.bp_inquiry_notify_claim(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _i business_profile.inquiries;
  _block text;
BEGIN
  SELECT * INTO _i FROM business_profile.inquiries i WHERE i.id = _id FOR UPDATE;
  IF NOT FOUND OR _i.notify_status NOT IN ('pending', 'sending', 'failed')
     OR (_i.notify_locked_until IS NOT NULL AND _i.notify_locked_until > now()) THEN
    RETURN NULL;
  END IF;
  _block := business_profile._inquiry_notify_block(_i.tenant_id);
  IF _block IS NOT NULL THEN
    UPDATE business_profile.inquiries
       SET notify_status = 'skipped', notify_error = _block, notify_next_at = NULL, notify_locked_until = NULL,
           updated_at = now()
     WHERE id = _id;
    RETURN NULL;
  END IF;
  UPDATE business_profile.inquiries
     SET notify_status = 'sending', notify_attempts = notify_attempts + 1,
         notify_locked_until = now() + interval '2 minutes', notify_next_at = NULL, updated_at = now()
   WHERE id = _id
  RETURNING * INTO _i;
  RETURN jsonb_build_object(
    'id', _i.id, 'reference', business_profile._inquiry_reference(_i.id), 'attempt', _i.notify_attempts,
    'to', (SELECT s.notify_email FROM business_profile.inquiry_settings s WHERE s.tenant_id = _i.tenant_id),
    'site', (SELECT jsonb_build_object('id', t.id, 'slug', t.slug, 'name', t.name, 'domain', t.domain)
               FROM public.tenants t WHERE t.id = _i.tenant_id),
    'kind', _i.kind, 'form_title', _i.form_title, 'page_path', _i.page_path, 'full_name', _i.full_name,
    'phone', _i.phone, 'email', _i.email, 'message', _i.message, 'created_at', _i.created_at,
    'is_test', _i.is_test);
END $$;

-- תוצאת השליחה. כישלון → ניסיון אוטומטי אחרי 5 / 30 / 120 דקות; אחרי 4 ניסיונות — רק ידני
CREATE OR REPLACE FUNCTION public.bp_inquiry_notify_result(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(_ok, false) THEN
    UPDATE business_profile.inquiries
       SET notify_status = 'sent', notify_sent_at = now(), notify_error = NULL, notify_next_at = NULL,
           notify_locked_until = NULL, updated_at = now()
     WHERE id = _id AND notify_status = 'sending';
  ELSE
    UPDATE business_profile.inquiries
       SET notify_status = 'failed',
           notify_error = left(COALESCE(NULLIF(btrim(_error), ''), 'השליחה נכשלה'), 300),
           notify_next_at = CASE notify_attempts
                              WHEN 1 THEN now() + interval '5 minutes'
                              WHEN 2 THEN now() + interval '30 minutes'
                              WHEN 3 THEN now() + interval '120 minutes'
                              ELSE NULL END,
           notify_locked_until = NULL, updated_at = now()
     WHERE id = _id AND notify_status = 'sending';
  END IF;
END $$;

-- מה לשלוח עכשיו (תהליך הרקע): כישלונות שהגיע זמנם, ממתינות שנתקעו (השרת נפל לפני השליחה), ונעילות שפגו
CREATE OR REPLACE FUNCTION public.bp_inquiry_notify_due(_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(x.id), '[]'::jsonb) FROM (
    SELECT i.id FROM business_profile.inquiries i
     WHERE (i.notify_status = 'failed' AND i.notify_next_at IS NOT NULL AND i.notify_next_at <= now())
        OR (i.notify_status = 'pending' AND i.created_at < now() - interval '2 minutes')
        OR (i.notify_status = 'sending' AND i.notify_locked_until < now())
     ORDER BY i.created_at
     LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100)) x;
$$;

-- מחיקה לפי מדיניות השמירה (תהליך הרקע, פעם ביום). מחזיר כמה נמחקו
CREATE OR REPLACE FUNCTION public.bp_inquiries_purge()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _total integer;
BEGIN
  WITH gone AS (
    DELETE FROM business_profile.inquiries i
     USING public.tenants t
     LEFT JOIN business_profile.inquiry_settings s ON s.tenant_id = t.id
     WHERE i.tenant_id = t.id
       AND ((i.is_test AND i.created_at < now() - interval '30 days')
         OR (NOT i.is_test AND i.created_at < now() - make_interval(days => COALESCE(s.retention_days, 365))))
    RETURNING i.tenant_id, i.is_test),
  per_site AS (
    SELECT g.tenant_id, count(*) FILTER (WHERE NOT g.is_test) AS n, count(*) FILTER (WHERE g.is_test) AS n_test
      FROM gone g GROUP BY g.tenant_id),
  logged AS (
    -- ביומן של כל אתר: כמה נמחקו (בלי פרטים); המחיקה האוטומטית — בלי משתמש
    INSERT INTO business_profile.audit_log (tenant_id, actor_id, action, details)
    SELECT p.tenant_id, NULL, 'inquiry.purged', jsonb_build_object('count', p.n, 'test', p.n_test)
      FROM per_site p
    RETURNING 1)
  SELECT COALESCE(sum(p.n + p.n_test), 0)::integer INTO _total FROM per_site p;
  RETURN _total;
END $$;

-- ---------- 6. ממשק הניהול: "פניות מלקוחות" (inquiries.manage) ----------
CREATE OR REPLACE FUNCTION public.bp_inquiries_list(_status text DEFAULT NULL, _include_test boolean DEFAULT true,
                                                    _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
BEGIN
  IF _status IS NOT NULL AND _status NOT IN ('new', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'סינון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(business_profile._inquiry_json(i, false) ORDER BY i.created_at DESC)
        FROM business_profile.inquiries i
       WHERE i.id IN (SELECT x.id FROM business_profile.inquiries x
                       WHERE x.tenant_id = _t AND (_status IS NULL OR x.status = _status)
                         AND (COALESCE(_include_test, true) OR NOT x.is_test)
                       ORDER BY x.created_at DESC
                       LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 500))), '[]'::jsonb),
    'counts', (SELECT jsonb_build_object(
                 'all', count(*) FILTER (WHERE COALESCE(_include_test, true) OR NOT i.is_test),
                 'new', count(*) FILTER (WHERE i.status = 'new' AND (COALESCE(_include_test, true) OR NOT i.is_test)),
                 'in_progress', count(*) FILTER (WHERE i.status = 'in_progress' AND (COALESCE(_include_test, true) OR NOT i.is_test)),
                 'done', count(*) FILTER (WHERE i.status = 'done' AND (COALESCE(_include_test, true) OR NOT i.is_test)),
                 'test', count(*) FILTER (WHERE i.is_test),
                 'notify_failed', count(*) FILTER (WHERE i.notify_status = 'failed'))
                 FROM business_profile.inquiries i WHERE i.tenant_id = _t),
    'settings', business_profile._inquiry_settings(_t) - 'updated_at',
    'notify_block', business_profile._inquiry_notify_block(_t));
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _i business_profile.inquiries;
BEGIN
  SELECT * INTO _i FROM business_profile.inquiries i WHERE i.id = _id AND i.tenant_id = _t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN business_profile._inquiry_json(_i, true) || jsonb_build_object(
    'notes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'id', n.id, 'body', n.body, 'created_at', n.created_at,
                         'mine', n.created_by IS NOT DISTINCT FROM auth.uid(),
                         'author', (SELECT ur.email FROM public.user_roles ur
                                     WHERE ur.tenant_id = _t AND ur.user_id = n.created_by LIMIT 1))
                       ORDER BY n.created_at)
                         FROM business_profile.inquiry_notes n
                        WHERE n.tenant_id = _t AND n.inquiry_id = _i.id), '[]'::jsonb),
    -- היסטוריית הטיפול (מיומן הפעולות): מי ומתי שינה מצב / הוסיף הערה / ביקש שליחה חוזרת
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'action', a.action, 'at', a.created_at, 'from', a.details ->> 'from',
                           'to', a.details ->> 'to',
                           'by', (SELECT ur.email FROM public.user_roles ur
                                   WHERE ur.tenant_id = _t AND ur.user_id = a.actor_id LIMIT 1))
                         ORDER BY a.created_at)
                           FROM business_profile.audit_log a
                          WHERE a.tenant_id = _t AND a.action LIKE 'inquiry.%' AND a.details ->> 'id' = _i.id::text),
                         '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_set_status(_id uuid, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _from text;
BEGIN
  IF _status IS NULL OR _status NOT IN ('new', 'in_progress', 'done') THEN
    RAISE EXCEPTION 'מצב לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT i.status INTO _from FROM business_profile.inquiries i WHERE i.id = _id AND i.tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _from <> _status THEN
    UPDATE business_profile.inquiries
       SET status = _status, status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now()
     WHERE id = _id AND tenant_id = _t;
    PERFORM business_profile._log(_t, 'inquiry.status', jsonb_build_object('id', _id, 'from', _from, 'to', _status));
  END IF;
  RETURN jsonb_build_object('id', _id, 'status', _status);
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_add_note(_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _b text := btrim(COALESCE(_body, ''));
  _note uuid;
BEGIN
  IF char_length(_b) < 1 OR char_length(_b) > 2000 THEN
    RAISE EXCEPTION 'ההערה צריכה להכיל 1–2000 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM business_profile.inquiries i WHERE i.id = _id AND i.tenant_id = _t) THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT count(*) FROM business_profile.inquiry_notes n WHERE n.tenant_id = _t AND n.inquiry_id = _id) >= 100 THEN
    RAISE EXCEPTION 'אפשר עד 100 הערות לפנייה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO business_profile.inquiry_notes (tenant_id, inquiry_id, body, created_by)
  VALUES (_t, _id, _b, auth.uid()) RETURNING id INTO _note;
  UPDATE business_profile.inquiries SET updated_at = now() WHERE id = _id AND tenant_id = _t;
  PERFORM business_profile._log(_t, 'inquiry.note_added', jsonb_build_object('id', _id, 'note', _note));
  RETURN jsonb_build_object('id', _note);
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_delete_note(_note uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _inquiry uuid;
BEGIN
  DELETE FROM business_profile.inquiry_notes n WHERE n.id = _note AND n.tenant_id = _t
  RETURNING n.inquiry_id INTO _inquiry;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההערה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM business_profile._log(_t, 'inquiry.note_deleted', jsonb_build_object('id', _inquiry, 'note', _note));
  RETURN jsonb_build_object('id', _note);
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_delete(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _test boolean;
BEGIN
  DELETE FROM business_profile.inquiries i WHERE i.id = _id AND i.tenant_id = _t RETURNING i.is_test INTO _test;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM business_profile._log(_t, 'inquiry.deleted', jsonb_build_object('id', _id, 'test', _test));
  RETURN jsonb_build_object('id', _id);
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiries_delete_test()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _n integer;
BEGIN
  DELETE FROM business_profile.inquiries i WHERE i.tenant_id = _t AND i.is_test;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM business_profile._log(_t, 'inquiry.test_deleted', jsonb_build_object('count', _n));
  END IF;
  RETURN jsonb_build_object('deleted', _n);
END $$;

-- ניסיון חוזר ידני לשליחת ההתראה: הפנייה חוזרת ל"ממתינה", והשרת שולח מיד (claim → result)
CREATE OR REPLACE FUNCTION public.bp_inquiry_retry_notify(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _i business_profile.inquiries;
  _block text := business_profile._inquiry_notify_block(_t);
BEGIN
  SELECT * INTO _i FROM business_profile.inquiries i WHERE i.id = _id AND i.tenant_id = _t FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הפנייה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION '% — עדכנו בהגדרות ונסו שוב', _block USING ERRCODE = 'check_violation';
  END IF;
  IF _i.notify_status = 'sent' THEN
    RAISE EXCEPTION 'ההתראה כבר נשלחה' USING ERRCODE = 'check_violation';
  END IF;
  IF _i.notify_status = 'sending' AND _i.notify_locked_until > now() THEN
    RAISE EXCEPTION 'השליחה כבר מתבצעת — נסו שוב בעוד דקה' USING ERRCODE = 'check_violation';
  END IF;
  IF _i.notify_attempts >= 20 THEN
    RAISE EXCEPTION 'היו כבר 20 ניסיונות שליחה לפנייה הזו' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE business_profile.inquiries
     SET notify_status = 'pending', notify_error = NULL, notify_next_at = NULL, notify_locked_until = NULL,
         updated_at = now()
   WHERE id = _id AND tenant_id = _t;
  PERFORM business_profile._log(_t, 'inquiry.notify_retry', jsonb_build_object('id', _id));
  RETURN jsonb_build_object('id', _id);
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
BEGIN
  RETURN business_profile._inquiry_settings(_t) || jsonb_build_object(
    -- הצעה למילוי: המייל של חשבון בעל העסק (לא נשמר עד שבוחרים בו)
    'account_email', (SELECT ur.email FROM public.user_roles ur
                       WHERE ur.tenant_id = _t AND ur.user_id = auth.uid() LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.bp_inquiry_settings_save(_notify_email text, _notify_enabled boolean,
                                                           _retention_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := business_profile.studio_site('inquiries.manage');
  _em text := NULLIF(lower(btrim(COALESCE(_notify_email, ''))), '');
  _old text;
BEGIN
  IF _em IS NOT NULL AND NOT business_profile._inquiry_email_ok(_em) THEN
    RAISE EXCEPTION 'כתובת המייל להתראות לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _retention_days IS NULL OR _retention_days < 30 OR _retention_days > 1095 THEN
    RAISE EXCEPTION 'תקופת השמירה צריכה להיות בין 30 ל-1095 ימים' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(_notify_enabled, true) AND _em IS NULL THEN
    RAISE EXCEPTION 'כדי לקבל התראות צריך מייל להתראות' USING ERRCODE = 'check_violation';
  END IF;
  SELECT s.notify_email INTO _old FROM business_profile.inquiry_settings s WHERE s.tenant_id = _t;
  INSERT INTO business_profile.inquiry_settings (tenant_id, notify_email, notify_enabled, retention_days,
                                                 updated_at, updated_by)
  VALUES (_t, _em, COALESCE(_notify_enabled, true), _retention_days, now(), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET notify_email = EXCLUDED.notify_email, notify_enabled = EXCLUDED.notify_enabled,
        retention_days = EXCLUDED.retention_days, updated_at = now(), updated_by = auth.uid();
  -- ביומן: מה השתנה, בלי כתובת המייל עצמה
  PERFORM business_profile._log(_t, 'inquiry.settings', jsonb_build_object(
    'notify_enabled', COALESCE(_notify_enabled, true), 'retention_days', _retention_days,
    'email_changed', _old IS DISTINCT FROM _em));
  RETURN business_profile._inquiry_settings(_t);
END $$;

-- מספר הפניות החדשות (התג בתפריט) — 0 למי שאין לו הרשאה (בלי שגיאה)
CREATE OR REPLACE FUNCTION public.bp_inquiries_new_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN business_profile.can('inquiries.manage')
              AND public.platform_feature_enabled('business_profile_enabled', business_profile.request_site())
    THEN (SELECT count(*)::integer FROM business_profile.inquiries i
           WHERE i.tenant_id = business_profile.request_site() AND i.status = 'new' AND NOT i.is_test)
    ELSE 0 END;
$$;

-- ---------- 7. הרשאות ----------
REVOKE ALL ON FUNCTION
  public.bp_inquiry_submit(uuid, text, text, text, text, text, text, text, text, boolean),
  public.bp_inquiry_notify_claim(uuid), public.bp_inquiry_notify_result(uuid, boolean, text),
  public.bp_inquiry_notify_due(integer), public.bp_inquiries_purge(),
  public.bp_inquiries_list(text, boolean, integer), public.bp_inquiry_get(uuid),
  public.bp_inquiry_set_status(uuid, text), public.bp_inquiry_add_note(uuid, text),
  public.bp_inquiry_delete_note(uuid), public.bp_inquiry_delete(uuid), public.bp_inquiries_delete_test(),
  public.bp_inquiry_retry_notify(uuid), public.bp_inquiry_settings(),
  public.bp_inquiry_settings_save(text, boolean, integer), public.bp_inquiries_new_count()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.bp_inquiry_submit(uuid, text, text, text, text, text, text, text, text, boolean),
  public.bp_inquiry_notify_claim(uuid), public.bp_inquiry_notify_result(uuid, boolean, text),
  public.bp_inquiry_notify_due(integer), public.bp_inquiries_purge()
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.bp_inquiries_list(text, boolean, integer), public.bp_inquiry_get(uuid),
  public.bp_inquiry_set_status(uuid, text), public.bp_inquiry_add_note(uuid, text),
  public.bp_inquiry_delete_note(uuid), public.bp_inquiry_delete(uuid), public.bp_inquiries_delete_test(),
  public.bp_inquiry_retry_notify(uuid), public.bp_inquiry_settings(),
  public.bp_inquiry_settings_save(text, boolean, integer), public.bp_inquiries_new_count()
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

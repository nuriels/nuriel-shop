-- ============================================================
-- Hospitality — בקשות לאתר צימר מהשער (שלב E2)
--
-- בשער (nuriel-app2) בוחרים עכשיו: "חנות אונליין" (הפתיחה העצמית הקיימת) או "אתר לצימר".
-- אתר לצימר כולל הקמה בתשלום שמנהל הפלטפורמה מבצע — לכן לא נפתח לבד, אלא נשלחת בקשה:
--
--   • site_requests — הבקשות: האימייל (מאומת בשער), שם העסק, טלפון, כמה יחידות, החבילה
--     המבוקשת, אזור, הערה; מצב (חדשה / טופלה) והערת המנהל. בלי גישה מה-API — פונקציות בלבד.
--   • site_request_submit(_email, _request) — מהשרת בלבד (אחרי אימות האימייל בשער). עד 3
--     בקשות לאימייל ביממה. מחזיר גם את כתובות מנהלי הפלטפורמה — להתראה במייל.
--   • admin_site_requests() / admin_site_request_set(_id, _status, _note) — מנהל הפלטפורמה
--     בלבד ("ניהול Hospitality" בפאנל); כל שינוי ביומן הפלטפורמה.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261104110000_hosp_site_requests.down.sql
-- (מסרב כשיש בקשות — הן מידע של לקוחות)
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS hospitality.site_requests (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email         text NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND char_length(email) <= 254),
  business_name text NOT NULL CHECK (char_length(btrim(business_name)) BETWEEN 2 AND 120),
  phone         text NOT NULL CHECK (phone ~ '^\+?[0-9]{9,15}$'),
  units         integer CHECK (units IS NULL OR units BETWEEN 1 AND 500),
  plan_code     text CHECK (plan_code IS NULL OR plan_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  area          text CHECK (area IS NULL OR char_length(area) <= 80),
  message       text CHECK (message IS NULL OR char_length(message) <= 1000),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  admin_note    text CHECK (admin_note IS NULL OR char_length(admin_note) <= 500),
  handled_by    uuid,
  handled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE hospitality.site_requests IS
  'בקשות לאתר צימר מהשער (nuriel-app2) — לטיפול מנהל הפלטפורמה. גישה דרך פונקציות בלבד.';
CREATE INDEX IF NOT EXISTS site_requests_status_idx ON hospitality.site_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS site_requests_email_idx ON hospitality.site_requests (lower(email), created_at DESC);
ALTER TABLE hospitality.site_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.site_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON hospitality.site_requests TO service_role;

CREATE OR REPLACE FUNCTION hospitality._site_request_json(r hospitality.site_requests)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'email', r.email, 'business_name', r.business_name, 'phone', r.phone,
    'units', r.units, 'plan_code', r.plan_code,
    'plan_name', (SELECT p.name FROM hospitality.plans p WHERE p.code = r.plan_code),
    'area', r.area, 'message', r.message, 'status', r.status, 'admin_note', r.admin_note,
    'handled_at', hospitality._ts(r.handled_at), 'created_at', hospitality._ts(r.created_at));
$$;
REVOKE ALL ON FUNCTION hospitality._site_request_json(hospitality.site_requests) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality._site_request_json(hospitality.site_requests) TO service_role;

-- מהשרת בלבד: האימייל כבר אומת בשער (אסימון חתום)
CREATE OR REPLACE FUNCTION hospitality.site_request_submit(_email text, _request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _r jsonb := COALESCE(_request, '{}'::jsonb);
  _e text := lower(btrim(COALESCE(_email, '')));
  _name text;
  _phone text;
  _units integer;
  _plan text;
  _area text;
  _message text;
  r hospitality.site_requests;
BEGIN
  IF jsonb_typeof(_r) <> 'object' THEN
    RAISE EXCEPTION 'פרטי הבקשה חסרים' USING ERRCODE = 'check_violation';
  END IF;
  IF _e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(_e) > 254 THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  _name := btrim(regexp_replace(COALESCE(_r ->> 'business_name', ''), '\s+', ' ', 'g'));
  _phone := regexp_replace(btrim(COALESCE(_r ->> 'phone', '')), '[^0-9+]', '', 'g');
  _area := NULLIF(btrim(regexp_replace(COALESCE(_r ->> 'area', ''), '\s+', ' ', 'g')), '');
  _message := NULLIF(btrim(COALESCE(_r ->> 'message', '')), '');
  _plan := NULLIF(btrim(COALESCE(_r ->> 'plan_code', '')), '');
  IF length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם העסק: 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'טלפון: 9 עד 15 ספרות' USING ERRCODE = 'check_violation';
  END IF;
  IF _r ? 'units' AND jsonb_typeof(_r -> 'units') <> 'null' THEN
    IF jsonb_typeof(_r -> 'units') <> 'number' OR (_r ->> 'units') !~ '^\d{1,3}$'
       OR (_r ->> 'units')::integer NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'מספר היחידות: 1 עד 500' USING ERRCODE = 'check_violation';
    END IF;
    _units := (_r ->> 'units')::integer;
  END IF;
  IF _plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hospitality.plans p WHERE p.code = _plan AND p.is_published) THEN
    RAISE EXCEPTION 'חבילה לא מוכרת' USING ERRCODE = 'check_violation';
  END IF;
  IF length(COALESCE(_area, '')) > 80 THEN
    RAISE EXCEPTION 'אזור: עד 80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF length(COALESCE(_message, '')) > 1000 THEN
    RAISE EXCEPTION 'ההערה: עד 1,000 תווים' USING ERRCODE = 'check_violation';
  END IF;

  -- לא להציף: עד 3 בקשות לאימייל ביממה (נעילה לאימייל — גם בקשות מקבילות)
  PERFORM pg_advisory_xact_lock(hashtextextended('hosp-site-request:' || _e, 0));
  IF (SELECT count(*) FROM hospitality.site_requests x
       WHERE lower(x.email) = _e AND x.created_at > now() - interval '1 day') >= 3 THEN
    RAISE EXCEPTION 'הבקשה כבר אצלנו — נחזור אליכם בהקדם' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO hospitality.site_requests (email, business_name, phone, units, plan_code, area, message)
  VALUES (_e, _name, _phone, _units, _plan, _area, _message)
  RETURNING * INTO r;

  RETURN hospitality._site_request_json(r) || jsonb_build_object(
    'notify', COALESCE((SELECT jsonb_agg(DISTINCT lower(u.email::text))
                          FROM public.platform_admins pa JOIN auth.users u ON u.id = pa.user_id
                         WHERE u.email IS NOT NULL), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION hospitality.site_request_submit(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.site_request_submit(text, jsonb) TO service_role;

-- מנהל הפלטפורמה: הבקשות (חדשות קודם, ואז האחרונות)
CREATE OR REPLACE FUNCTION hospitality.admin_site_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hospitality._require_platform_admin();
  RETURN COALESCE((
    SELECT jsonb_agg(hospitality._site_request_json(r) ORDER BY (r.status = 'new') DESC, r.created_at DESC)
      FROM (SELECT * FROM hospitality.site_requests x
             ORDER BY (x.status = 'new') DESC, x.created_at DESC LIMIT 200) r), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_site_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_site_requests() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION hospitality.admin_site_request_set(_id uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r hospitality.site_requests;
  _n text := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  PERFORM hospitality._require_platform_admin();
  IF COALESCE(_status, '') NOT IN ('new', 'handled') THEN
    RAISE EXCEPTION 'מצב לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF length(COALESCE(_n, '')) > 500 THEN
    RAISE EXCEPTION 'ההערה: עד 500 תווים' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE hospitality.site_requests x
     SET status = _status, admin_note = _n,
         handled_by = CASE WHEN _status = 'handled' THEN auth.uid() END,
         handled_at = CASE WHEN _status = 'handled' THEN now() END
   WHERE x.id = _id
  RETURNING * INTO r;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'הבקשה לא נמצאה' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, action, details)
  VALUES (NULL, auth.uid(), 'hosp_site_request_set',
          jsonb_build_object('id', r.id, 'status', r.status, 'business', left(r.business_name, 60)));
  RETURN hospitality._site_request_json(r);
END $$;
REVOKE ALL ON FUNCTION hospitality.admin_site_request_set(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION hospitality.admin_site_request_set(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

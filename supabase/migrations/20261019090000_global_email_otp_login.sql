-- ============================================================
-- חלק 8: תשתית מייל גלובלית + התחברות בקוד למייל (OTP)
--
-- 1. מפתח Resend אחד לכל המערכת (RESEND_API_KEY בשרת) במקום מפתח לכל
--    חנות: הטבלה tenant_secrets והפונקציות שלה מוסרות.
--    השולח: "שם החנות <orders@nuri1.fit>" — נקבע בקוד השרת.
-- 2. email_settings.sender_email הופך ל"כתובת למענה" (Reply-To) של החנות.
--    ברירת המחדל הישנה (orders@nuri1.fit — כתובת המערכת) מתאפסת לריק,
--    ואז התשובות מגיעות לאימייל העסק מהגדרות האתר.
-- 3. login_codes — קודי כניסה חד-פעמיים בני 6 ספרות שנשלחים למייל:
--    - נשמר רק HMAC של הקוד (מחושב בשרת עם סוד), לא הקוד עצמו
--    - תוקף 10 דקות, קוד חדש מבטל את הקודמים
--    - עד 5 ניסיונות שגויים לקוד, ואז הוא ננעל
--    - עד 5 קודים לכתובת ברבע שעה, ולפחות 30 שניות בין קוד לקוד
--    - גישה: service_role בלבד (השרת), צמוד לחנות של הדומיין
--
-- ניתן להרצה חוזרת.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ביטול מפתח המייל לכל חנות
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.platform_set_tenant_resend_key(uuid, text);
DROP FUNCTION IF EXISTS public.platform_tenant_email_keys();
DROP TABLE IF EXISTS public.tenant_secrets;

-- ------------------------------------------------------------
-- 2. כתובת למענה
-- ------------------------------------------------------------
ALTER TABLE public.email_settings ALTER COLUMN sender_email SET DEFAULT '';
UPDATE public.email_settings
   SET sender_email = ''
 WHERE lower(btrim(sender_email)) LIKE '%@nuri1.fit';

COMMENT ON COLUMN public.email_settings.sender_email IS
  'כתובת למענה (Reply-To) של מיילי החנות. ריק = אימייל העסק. המיילים יוצאים מכתובת המערכת עם שם החנות.';

-- ------------------------------------------------------------
-- 3. קודי כניסה למייל
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  code_hash TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip TEXT CHECK (ip IS NULL OR length(ip) <= 64),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS login_codes_lookup_idx
  ON public.login_codes (tenant_id, email, created_at DESC);
CREATE INDEX IF NOT EXISTS login_codes_created_idx ON public.login_codes (created_at);

COMMENT ON TABLE public.login_codes IS
  'קודי כניסה חד-פעמיים למייל (נשמר רק HMAC). שרת בלבד — אין גישה מהדפדפן.';

ALTER TABLE public.login_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.login_codes;
CREATE POLICY tenant_isolation ON public.login_codes AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.login_codes FROM anon, authenticated;
GRANT ALL ON public.login_codes TO service_role;

-- הנפקת קוד: בודק קצב, מבטל קודים קודמים ושומר את ה-HMAC החדש.
-- מחזיר את מועד פקיעת הקוד. החנות — לפי הדומיין (x-tenant-id).
CREATE OR REPLACE FUNCTION public.issue_login_code(_email text, _code_hash text, _ip text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _recent integer;
  _last timestamptz;
  _expires timestamptz := now() + interval '10 minutes';
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF length(_e) > 254 OR _e !~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _code_hash IS NULL OR _code_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'קוד לא תקין' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- בקשות במקביל לאותה כתובת עוברות אחת-אחת (הגבלת הקצב לא נעקפת במרוץ)
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant::text || ':' || _e, 7019));

  SELECT count(*)::int, max(created_at) INTO _recent, _last
    FROM public.login_codes
   WHERE tenant_id = _tenant AND email = _e AND created_at > now() - interval '15 minutes';
  IF _last IS NOT NULL AND _last > now() - interval '30 seconds' THEN
    RAISE EXCEPTION 'קוד נשלח זה עתה — אפשר לבקש קוד חדש בעוד חצי דקה'
      USING ERRCODE = 'check_violation';
  END IF;
  IF _recent >= 5 THEN
    RAISE EXCEPTION 'נשלחו כבר כמה קודים לכתובת הזו. נסו שוב בעוד רבע שעה, או התחברו עם סיסמה.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- קוד חדש מבטל את הקודמים של אותה כתובת בחנות
  UPDATE public.login_codes
     SET consumed_at = now()
   WHERE tenant_id = _tenant AND email = _e AND consumed_at IS NULL;

  -- ניקוי: קודים בני יותר מיום (בכל החנויות) כבר לא נחוצים
  DELETE FROM public.login_codes WHERE created_at < now() - interval '1 day';

  INSERT INTO public.login_codes (tenant_id, email, code_hash, expires_at, ip)
  VALUES (_tenant, _e, _code_hash, _expires, left(NULLIF(btrim(COALESCE(_ip, '')), ''), 64));

  RETURN _expires;
END $$;

REVOKE ALL ON FUNCTION public.issue_login_code(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_login_code(text, text, text) TO service_role;

-- אימות קוד: הקוד הפעיל האחרון של הכתובת בחנות.
-- result: ok / invalid (+ left) / locked / expired / none.
-- ב-ok מוחזר גם החשבון: user_id (null = אין חשבון — הרשמה), החנות שהוא
-- רשום בה, האם זו החנות הנוכחית, מנהל-על, חסום.
CREATE OR REPLACE FUNCTION public.consume_login_code(_email text, _code_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _max CONSTANT integer := 5;
  c RECORD;
  _uid uuid;
  _member uuid;
  _blocked boolean := false;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;

  SELECT * INTO c
    FROM public.login_codes
   WHERE tenant_id = _tenant AND email = _e AND consumed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'none');
  END IF;

  IF c.expires_at <= now() THEN
    UPDATE public.login_codes SET consumed_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  IF _code_hash IS DISTINCT FROM c.code_hash THEN
    UPDATE public.login_codes
       SET attempts = attempts + 1,
           consumed_at = CASE WHEN attempts + 1 >= _max THEN now() ELSE NULL END
     WHERE id = c.id;
    IF c.attempts + 1 >= _max THEN
      RETURN jsonb_build_object('result', 'locked');
    END IF;
    RETURN jsonb_build_object('result', 'invalid', 'left', _max - c.attempts - 1);
  END IF;

  -- קוד נכון — חד-פעמי
  UPDATE public.login_codes SET consumed_at = now() WHERE id = c.id;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NOT NULL THEN
    SELECT ur.tenant_id, ur.is_blocked INTO _member, _blocked
      FROM public.user_roles ur
     WHERE ur.user_id = _uid
     ORDER BY (ur.tenant_id = _tenant) DESC
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'result', 'ok',
    'user_id', _uid,
    'member_tenant', _member,
    'same_store', COALESCE(_member = _tenant, false),
    'platform_admin', CASE WHEN _uid IS NULL THEN false
                           ELSE COALESCE(public.is_platform_admin(_uid), false) END,
    'blocked', COALESCE(_blocked, false)
  );
END $$;

REVOKE ALL ON FUNCTION public.consume_login_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_login_code(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

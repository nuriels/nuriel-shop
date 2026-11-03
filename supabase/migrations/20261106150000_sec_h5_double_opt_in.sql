-- ============================================================
-- SEC-H5: דיוור שיווקי — אישור כפול (Double Opt-in) ותיעוד ההסכמה
-- ------------------------------------------------------------
-- עד כה כל כתובת שהוקלדה (חלון הקופון, הקופה תוך כדי הקלדה, הרשמה עם סיסמה, "החשבון שלי")
-- נרשמה מיד כמנויה וקיבלה פרסומת — בלי הוכחה שבעל הכתובת ביקש, וגם הסרה קודמת "התבטלה".
--
-- מעכשיו:
--   • הצטרפות חדשה (או חזרה של מי שהוסר) = "ממתינה לאישור": נשמר רק hash של אסימון חד-פעמי
--     (64 hex, נוצר בשרת האפליקציה), והשרת שולח מייל אישור אחד (לא פרסומת). שום דיוור לא נשלח
--     עד הלחיצה על הקישור — marketing_confirm.
--   • לכל היותר מייל אישור אחד לכתובת ב-24 שעות (גם מול שימוש לרעה בחלון הקופון).
--   • הסרה — תמיד מיידית, ומבטלת אישור ממתין.
--   • ראיית הסכמה: hash של ה-IP (עם מלח החנות), הדפדפן, השיטה (popup / checkout / register /
--     account), ומועד האישור — על השורה וביומן (marketing_consent_events.kind).
--   • מנויים קיימים (הסכמה חד-שלבית, עם הנוסח ביומן) נשארים מנויים: confirmed_at = NULL מסמן
--     הסכמה ישנה — האם לבקש מהם אישור מחדש היא החלטה עסקית/משפטית, לא נעשית כאן.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.marketing_consents
  ADD COLUMN IF NOT EXISTS confirm_token_hash text,
  ADD COLUMN IF NOT EXISTS confirm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_context jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_ip_hash text,
  ADD COLUMN IF NOT EXISTS consent_user_agent text,
  ADD COLUMN IF NOT EXISTS consent_method text;

ALTER TABLE public.marketing_consent_events
  ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS ip_hash text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS method text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_consents_doi_check') THEN
    ALTER TABLE public.marketing_consents ADD CONSTRAINT marketing_consents_doi_check CHECK (
      (confirm_token_hash IS NULL OR confirm_token_hash ~ '^[0-9a-f]{64}$')
      AND (consent_ip_hash IS NULL OR consent_ip_hash ~ '^[0-9a-f]{64}$')
      AND (consent_user_agent IS NULL OR char_length(consent_user_agent) <= 300)
      AND (consent_method IS NULL OR consent_method IN ('popup', 'checkout', 'register', 'account'))
      AND (confirm_context IS NULL OR jsonb_typeof(confirm_context) = 'object'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_consent_events_doi_check') THEN
    ALTER TABLE public.marketing_consent_events ADD CONSTRAINT marketing_consent_events_doi_check CHECK (
      (kind IS NULL OR kind IN ('request', 'confirm', 'unsubscribe'))
      AND (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$')
      AND (user_agent IS NULL OR char_length(user_agent) <= 300)
      AND (method IS NULL OR char_length(method) <= 40));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS marketing_consents_confirm_token_idx
  ON public.marketing_consents (confirm_token_hash) WHERE confirm_token_hash IS NOT NULL;

-- ---------- הסכמה / הסרה (מהשרת בלבד) ----------
-- מחזיר: subscribed (מנוי פעיל), pending (ממתין לאישור), confirm_issued (הקריאה הזו שמרה אסימון
-- חדש — על השרת לשלוח מייל אישור), throttled, token (טוקן ההסרה, רק למנוי פעיל), welcome_due.
DROP FUNCTION IF EXISTS public.marketing_set_consent(text, boolean, text, text, uuid);
CREATE OR REPLACE FUNCTION public.marketing_set_consent(
  _email text, _subscribed boolean, _source text, _consent_text text DEFAULT NULL, _user_id uuid DEFAULT NULL,
  _confirm_token_hash text DEFAULT NULL, _ip_hash text DEFAULT NULL, _user_agent text DEFAULT NULL,
  _method text DEFAULT NULL, _context jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _clean text := lower(btrim(COALESCE(_email, '')));
  _text text := NULLIF(left(btrim(COALESCE(_consent_text, '')), 600), '');
  _hash text := lower(btrim(COALESCE(_confirm_token_hash, '')));
  _ip text := CASE WHEN lower(COALESCE(_ip_hash, '')) ~ '^[0-9a-f]{64}$' THEN lower(_ip_hash) END;
  _ua text := NULLIF(left(btrim(COALESCE(_user_agent, '')), 300), '');
  _how text := CASE WHEN _method IN ('popup', 'checkout', 'register', 'account') THEN _method END;
  -- ההקשר היחיד שנשמר: קוד קופון לשליחה אחרי האישור (חלון הקופון)
  _ctx jsonb := CASE WHEN jsonb_typeof(_context) = 'object'
                      AND (_context ->> 'coupon') ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
                     THEN jsonb_build_object('coupon', _context ->> 'coupon') END;
  _row public.marketing_consents;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF char_length(_clean) > 254 OR _clean !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _subscribed IS NULL OR _source IS NULL
     OR _source NOT IN ('register', 'checkout', 'account', 'unsubscribe_link') THEN
    RAISE EXCEPTION 'בקשה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;

  -- הסרה: תמיד מיידית, ומבטלת אישור ממתין
  IF NOT _subscribed THEN
    INSERT INTO public.marketing_consents AS mc (
      tenant_id, email, user_id, subscribed, source, unsubscribed_at, consent_ip_hash, consent_user_agent)
    VALUES (_tenant, _clean, _user_id, false, _source, now(), _ip, _ua)
    ON CONFLICT (tenant_id, email) DO UPDATE
      SET subscribed = false,
          source = EXCLUDED.source,
          user_id = COALESCE(mc.user_id, EXCLUDED.user_id),
          unsubscribed_at = CASE WHEN mc.subscribed OR mc.unsubscribed_at IS NULL THEN now() ELSE mc.unsubscribed_at END,
          confirm_token_hash = NULL, confirm_sent_at = NULL, confirm_context = NULL,
          updated_at = now()
    RETURNING * INTO _row;
    INSERT INTO public.marketing_consent_events (tenant_id, email, subscribed, source, kind, ip_hash, user_agent, method)
    VALUES (_tenant, _clean, false, _source, 'unsubscribe', _ip, _ua, _how);
    RETURN jsonb_build_object('subscribed', false, 'pending', false, 'confirm_issued', false,
                              'throttled', false, 'token', _row.unsubscribe_token, 'welcome_due', false);
  END IF;

  SELECT * INTO _row FROM public.marketing_consents
   WHERE tenant_id = _tenant AND email = _clean FOR UPDATE;

  -- כבר מנוי פעיל — אין מה לאשר (רק קישור לחשבון, אם חסר)
  IF FOUND AND _row.subscribed THEN
    IF _user_id IS NOT NULL AND _row.user_id IS NULL THEN
      UPDATE public.marketing_consents SET user_id = _user_id, updated_at = now() WHERE id = _row.id;
    END IF;
    RETURN jsonb_build_object('subscribed', true, 'pending', false, 'confirm_issued', false,
                              'throttled', false, 'token', _row.unsubscribe_token, 'welcome_due', false);
  END IF;

  -- הצטרפות חדשה / חזרה אחרי הסרה — רק באישור כפול
  IF _hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'נדרש אישור במייל להצטרפות לדיוור' USING ERRCODE = 'check_violation';
  END IF;

  -- מייל אישור אחד לכתובת ב-24 שעות
  IF FOUND AND _row.confirm_sent_at IS NOT NULL AND _row.confirm_sent_at > now() - interval '24 hours' THEN
    RETURN jsonb_build_object('subscribed', false, 'pending', true, 'confirm_issued', false,
                              'throttled', true, 'token', NULL, 'welcome_due', false);
  END IF;

  INSERT INTO public.marketing_consents AS mc (
    tenant_id, email, user_id, subscribed, source, consent_text,
    confirm_token_hash, confirm_sent_at, confirm_context, consent_ip_hash, consent_user_agent, consent_method)
  VALUES (_tenant, _clean, _user_id, false, _source, _text, _hash, now(), _ctx, _ip, _ua, _how)
  ON CONFLICT (tenant_id, email) DO UPDATE
    SET source = EXCLUDED.source,
        consent_text = COALESCE(EXCLUDED.consent_text, mc.consent_text),
        user_id = COALESCE(mc.user_id, EXCLUDED.user_id),
        confirm_token_hash = EXCLUDED.confirm_token_hash,
        confirm_sent_at = now(),
        confirm_context = EXCLUDED.confirm_context,
        consent_ip_hash = EXCLUDED.consent_ip_hash,
        consent_user_agent = EXCLUDED.consent_user_agent,
        consent_method = EXCLUDED.consent_method,
        updated_at = now()
  RETURNING * INTO _row;

  INSERT INTO public.marketing_consent_events (tenant_id, email, subscribed, source, consent_text, kind, ip_hash, user_agent, method)
  VALUES (_tenant, _clean, false, _source, _text, 'request', _ip, _ua, _how);

  RETURN jsonb_build_object('subscribed', false, 'pending', true, 'confirm_issued', true,
                            'throttled', false, 'token', NULL, 'welcome_due', false);
END $$;
REVOKE ALL ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid, text, text, text, text, jsonb)
  TO service_role;

-- ---------- אישור מהקישור במייל ----------
-- לפי האסימון (בתוקף 7 ימים), רק בחנות של הבקשה. מחזיר NULL אם לא נמצא / פג תוקף; אחרת
-- {email, token (טוקן ההסרה), welcome_due, context, source}. חד-פעמי.
CREATE OR REPLACE FUNCTION public.marketing_confirm(_token text, _ip_hash text DEFAULT NULL, _user_agent text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _t text := lower(btrim(COALESCE(_token, '')));
  _ip text := CASE WHEN lower(COALESCE(_ip_hash, '')) ~ '^[0-9a-f]{64}$' THEN lower(_ip_hash) END;
  _ua text := NULLIF(left(btrim(COALESCE(_user_agent, '')), 300), '');
  _row public.marketing_consents;
  _context jsonb;
BEGIN
  IF _tenant IS NULL OR _t !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO _row FROM public.marketing_consents
   WHERE tenant_id = _tenant AND confirm_token_hash = encode(sha256(convert_to(_t, 'UTF8')), 'hex')
   FOR UPDATE;
  IF NOT FOUND OR _row.confirm_sent_at IS NULL OR _row.confirm_sent_at < now() - interval '7 days' THEN
    RETURN NULL;
  END IF;
  _context := _row.confirm_context;

  UPDATE public.marketing_consents
     SET subscribed = true, consented_at = now(), confirmed_at = now(), unsubscribed_at = NULL,
         confirm_token_hash = NULL, confirm_sent_at = NULL, confirm_context = NULL, updated_at = now()
   WHERE id = _row.id
  RETURNING * INTO _row;

  INSERT INTO public.marketing_consent_events (tenant_id, email, subscribed, source, consent_text, kind, ip_hash, user_agent, method)
  VALUES (_tenant, _row.email, true, _row.source, _row.consent_text, 'confirm', _ip, _ua, _row.consent_method);

  RETURN jsonb_build_object(
    'email', _row.email,
    'token', _row.unsubscribe_token,
    'welcome_due', _row.welcome_sent_at IS NULL AND _row.source IN ('register', 'account'),
    'context', _context,
    'source', _row.source);
END $$;
REVOKE ALL ON FUNCTION public.marketing_confirm(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_confirm(text, text, text) TO service_role;

-- שליחת מייל האישור נכשלה → משחררים את הבקשה הממתינה (אחרת ההגבלה של 24 שעות חוסמת ניסיון חוזר)
CREATE OR REPLACE FUNCTION public.marketing_release_confirm(_email text, _confirm_token_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketing_consents
     SET confirm_token_hash = NULL, confirm_sent_at = NULL, confirm_context = NULL, updated_at = now()
   WHERE tenant_id = public.current_tenant_id()
     AND email = lower(btrim(COALESCE(_email, '')))
     AND NOT subscribed
     AND confirm_token_hash = lower(btrim(COALESCE(_confirm_token_hash, '')));
$$;
REVOKE ALL ON FUNCTION public.marketing_release_confirm(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_release_confirm(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

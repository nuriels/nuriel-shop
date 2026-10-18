-- ============================================================
-- חלק 40: הסכמה לדיוור (חוק התקשורת — "חוק הספאם", סעיף 30א)
--
-- דיוור שיווקי (קופון ברוכים הבאים, תזכורת על עגלה נטושה) נשלח רק למי
-- שסימן בעצמו "אני מאשר/ת קבלת דיוור" (תיבה לא מסומנת מראש) — בהרשמה,
-- בקופה או בעמוד "החשבון שלי". כל מייל שיווקי: "פרסומת" בתחילת הנושא, פרטי
-- העסק וקישור הסרה; הסרה מכבדת מיד.
--
-- marketing_consents        — המצב הנוכחי לכל אימייל בחנות (מנוי / הוסר)
-- marketing_consent_events  — יומן ההסכמות וההסרות (הוכחה: מתי, מאיפה, איזה נוסח)
-- site_settings.welcome_coupon_code — הקופון שנשלח במייל "ברוכים הבאים" למצטרפים
--
-- הכתיבה רק מהשרת (service_role) דרך הפונקציות; מנהל החנות רק קורא.
-- עגלה נטושה: התזכורת האוטומטית (abandoned_carts_due) רק למי שמנוי.
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.marketing_consents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT public.current_tenant_id()
                     REFERENCES public.tenants(id) ON DELETE CASCADE,
  email              text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subscribed         boolean NOT NULL,
  source             text NOT NULL CHECK (source IN ('register', 'checkout', 'account', 'unsubscribe_link')),
  consent_text       text CHECK (consent_text IS NULL OR char_length(consent_text) <= 600),
  consented_at       timestamptz,
  unsubscribed_at    timestamptz,
  unsubscribe_token  uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  welcome_sent_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_consents_email_key UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS public.marketing_consent_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL DEFAULT public.current_tenant_id()
                REFERENCES public.tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  subscribed    boolean NOT NULL,
  source        text NOT NULL,
  consent_text  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_consent_events_email_idx
  ON public.marketing_consent_events (tenant_id, email, created_at DESC);

ALTER TABLE public.marketing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_consent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.marketing_consents;
CREATE POLICY tenant_isolation ON public.marketing_consents
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "marketing consents readable by admin" ON public.marketing_consents;
CREATE POLICY "marketing consents readable by admin" ON public.marketing_consents
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS tenant_isolation ON public.marketing_consent_events;
CREATE POLICY tenant_isolation ON public.marketing_consent_events
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "marketing consent events readable by admin" ON public.marketing_consent_events;
CREATE POLICY "marketing consent events readable by admin" ON public.marketing_consent_events
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

REVOKE ALL ON public.marketing_consents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_consent_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_consents TO authenticated;
GRANT SELECT ON public.marketing_consent_events TO authenticated;
GRANT ALL ON public.marketing_consents TO service_role;
GRANT ALL ON public.marketing_consent_events TO service_role;

-- קופון "ברוכים הבאים" (קוד של קופון קיים בחנות; NULL = לא שולחים מייל ברוכים הבאים)
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS welcome_coupon_code text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_welcome_coupon_check') THEN
    ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_welcome_coupon_check
      CHECK (welcome_coupon_code IS NULL OR welcome_coupon_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$');
  END IF;
END $$;

-- ---------- הסכמה / הסרה (מהשרת בלבד) ----------
-- מחזיר: subscribed, token (לקישור ההסרה), welcome_due (מגיע מייל ברוכים הבאים)
CREATE OR REPLACE FUNCTION public.marketing_set_consent(
  _email text, _subscribed boolean, _source text, _consent_text text DEFAULT NULL, _user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _clean text := lower(btrim(COALESCE(_email, '')));
  _text text := NULLIF(left(btrim(COALESCE(_consent_text, '')), 600), '');
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

  INSERT INTO public.marketing_consents AS mc (
    tenant_id, email, user_id, subscribed, source, consent_text, consented_at, unsubscribed_at)
  VALUES (
    _tenant, _clean, _user_id, _subscribed, _source, _text,
    CASE WHEN _subscribed THEN now() END,
    CASE WHEN _subscribed THEN NULL ELSE now() END)
  ON CONFLICT (tenant_id, email) DO UPDATE
    SET subscribed = EXCLUDED.subscribed,
        source = EXCLUDED.source,
        consent_text = COALESCE(EXCLUDED.consent_text, mc.consent_text),
        user_id = COALESCE(mc.user_id, EXCLUDED.user_id),
        consented_at = CASE WHEN EXCLUDED.subscribed THEN now() ELSE mc.consented_at END,
        unsubscribed_at = CASE WHEN EXCLUDED.subscribed THEN NULL ELSE now() END,
        updated_at = now()
  RETURNING * INTO _row;

  INSERT INTO public.marketing_consent_events (tenant_id, email, subscribed, source, consent_text)
  VALUES (_tenant, _clean, _subscribed, _source, _text);

  RETURN jsonb_build_object(
    'subscribed', _row.subscribed,
    'token', _row.unsubscribe_token,
    'welcome_due', _row.subscribed AND _row.welcome_sent_at IS NULL
                   AND _source IN ('register', 'account'));
END $$;
REVOKE ALL ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid) TO service_role;

-- הסרה מקישור במייל: לפי הטוקן, רק בחנות של הבקשה. מחזיר את האימייל (או NULL)
CREATE OR REPLACE FUNCTION public.marketing_unsubscribe(_token uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _email text;
  _was boolean;
BEGIN
  IF _tenant IS NULL OR _token IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT email, subscribed INTO _email, _was
    FROM public.marketing_consents
   WHERE unsubscribe_token = _token AND tenant_id = _tenant
   FOR UPDATE;
  IF _email IS NULL THEN
    RETURN NULL;
  END IF;
  IF _was THEN
    UPDATE public.marketing_consents
       SET subscribed = false, source = 'unsubscribe_link', unsubscribed_at = now(), updated_at = now()
     WHERE unsubscribe_token = _token AND tenant_id = _tenant;
    INSERT INTO public.marketing_consent_events (tenant_id, email, subscribed, source)
    VALUES (_tenant, _email, false, 'unsubscribe_link');
  END IF;
  RETURN _email;
END $$;
REVOKE ALL ON FUNCTION public.marketing_unsubscribe(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_unsubscribe(uuid) TO service_role;

-- מותר לשלוח דיוור לכתובת? מחזיר את טוקן ההסרה (NULL = אסור לשלוח)
CREATE OR REPLACE FUNCTION public.marketing_send_token(_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mc.unsubscribe_token
    FROM public.marketing_consents mc
   WHERE mc.tenant_id = public.current_tenant_id()
     AND mc.email = lower(btrim(COALESCE(_email, '')))
     AND mc.subscribed;
$$;
REVOKE ALL ON FUNCTION public.marketing_send_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_send_token(text) TO service_role;

-- מייל "ברוכים הבאים": תפיסה אטומית (לא נשלח פעמיים) ושחרור אם השליחה נכשלה
CREATE OR REPLACE FUNCTION public.marketing_claim_welcome(_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketing_consents
     SET welcome_sent_at = now(), updated_at = now()
   WHERE tenant_id = public.current_tenant_id()
     AND email = lower(btrim(COALESCE(_email, '')))
     AND subscribed AND welcome_sent_at IS NULL
  RETURNING unsubscribe_token;
$$;
REVOKE ALL ON FUNCTION public.marketing_claim_welcome(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_claim_welcome(text) TO service_role;

CREATE OR REPLACE FUNCTION public.marketing_release_welcome(_email text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.marketing_consents
     SET welcome_sent_at = NULL, updated_at = now()
   WHERE tenant_id = public.current_tenant_id()
     AND email = lower(btrim(COALESCE(_email, '')));
$$;
REVOKE ALL ON FUNCTION public.marketing_release_welcome(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_release_welcome(text) TO service_role;

-- ---------- עגלות נטושות: תזכורת רק למי שאישר דיוור ----------
CREATE OR REPLACE FUNCTION public.abandoned_carts_due(_min_age_hours INTEGER DEFAULT 4, _limit INTEGER DEFAULT 25)
RETURNS SETOF UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _tid UUID := public.current_tenant_id();
BEGIN
  IF _tid IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.id FROM public.abandoned_carts c
     WHERE c.tenant_id = _tid AND c.status = 'open'
       AND c.email IS NOT NULL AND btrim(c.email) <> ''
       AND COALESCE(c.item_count, 0) > 0
       AND COALESCE(c.reminder_count, 0) = 0
       AND c.updated_at < now() - make_interval(hours => GREATEST(1, LEAST(COALESCE(_min_age_hours, 4), 720)))
       AND EXISTS (SELECT 1 FROM public.marketing_consents mc
                    WHERE mc.tenant_id = _tid AND mc.email = lower(btrim(c.email)) AND mc.subscribed)
     ORDER BY c.updated_at
     LIMIT GREATEST(1, LEAST(COALESCE(_limit, 25), 100));
END; $$;
REVOKE ALL ON FUNCTION public.abandoned_carts_due(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandoned_carts_due(INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

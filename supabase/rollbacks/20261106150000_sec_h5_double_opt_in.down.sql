-- ============================================================
-- Rollback ל-SEC-H5: חזרה להסכמה חד-שלבית. marketing_set_consent חוזרת לגרסה של חלק 40 (5 פרמטרים)
-- מילה במילה, marketing_confirm נמחקת, וכך גם העמודות, האילוצים והאינדקס של האישור הכפול.
-- נתונים: מי שאישר — נשאר מנוי; מי שרק ביקש ולא אישר — נשאר לא-מנוי (לא קיבל הוכחה);
-- ראיות ההסכמה החדשות (IP מגובב, דפדפן, שיטה, confirmed_at, kind ביומן) נמחקות עם העמודות.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- הגנת נתונים (ביקורת R-3): ה-rollback לא מוחק נתוני לקוחות בשקט. אם יש שורות — נעצר; ייצאו / גבו והחליטו
DO $$
DECLARE
  _n bigint;
  _t text;
  _w text;
  _what text;
BEGIN
  FOR _t, _w, _what IN VALUES
      ('public.marketing_consents', 'confirmed_at IS NOT NULL OR consent_method IS NOT NULL OR consent_ip_hash IS NOT NULL', 'הוכחות הסכמה לדיוור (אישור בשני שלבים, שיטה, גיבוב IP) — ראיה חוקית'),
      ('public.marketing_consent_events', 'kind IS NOT NULL OR method IS NOT NULL OR ip_hash IS NOT NULL', 'אירועי הסכמה ביומן ההסכמות — ראיה חוקית')
  LOOP
    IF to_regclass(_t) IS NOT NULL THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s WHERE %s', _t, _w) INTO _n;
      EXCEPTION WHEN undefined_column THEN
        _n := 0; -- העמודה כבר הוסרה (rollback חלקי קודם)
      END;
      IF _n > 0 THEN
        RAISE EXCEPTION 'יש % שורות: % — ייצאו אותן והחליטו לפני ה-rollback (לא מבוצע)', _n, _what;
      END IF;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.marketing_release_confirm(text, text);
DROP FUNCTION IF EXISTS public.marketing_confirm(text, text, text);
DROP FUNCTION IF EXISTS public.marketing_set_consent(text, boolean, text, text, uuid, text, text, text, text, jsonb);

-- marketing_set_consent — גרסת חלק 40 (מקור)
CREATE OR REPLACE FUNCTION public.marketing_set_consent(_email text, _subscribed boolean, _source text, _consent_text text DEFAULT NULL::text, _user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_set_consent(text, boolean, text, text, uuid) TO service_role;

DROP INDEX IF EXISTS public.marketing_consents_confirm_token_idx;
ALTER TABLE public.marketing_consents DROP CONSTRAINT IF EXISTS marketing_consents_doi_check;
ALTER TABLE public.marketing_consent_events DROP CONSTRAINT IF EXISTS marketing_consent_events_doi_check;
ALTER TABLE public.marketing_consents
  DROP COLUMN IF EXISTS confirm_token_hash,
  DROP COLUMN IF EXISTS confirm_sent_at,
  DROP COLUMN IF EXISTS confirm_context,
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS consent_ip_hash,
  DROP COLUMN IF EXISTS consent_user_agent,
  DROP COLUMN IF EXISTS consent_method;
ALTER TABLE public.marketing_consent_events
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS ip_hash,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS method;

NOTIFY pgrst, 'reload schema';

COMMIT;

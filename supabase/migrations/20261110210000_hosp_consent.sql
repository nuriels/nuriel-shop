-- ============================================================
-- Google SEO שלב 4: הסכמה ל-Cookies באתרי האירוח — כבוי, מאחורי מתג
--
-- היום באתרי האירוח אין שום Cookie או תגית שדורשים הסכמה (בלי Analytics). המיגרציה מכינה את המנגנון
-- כך שכשיוחלט על מדידה (Google Analytics 4) — מדליקים מתג ומזינים מזהה, בלי פיתוח נוסף:
--   • מתג חדש hospitality_analytics_enabled — כבוי. כמו כל מתג של Hospitality: פועל רק כשהוא דולק
--     גם לפלטפורמה וגם לאתר (flag_for). כבוי — אין באנר, אין תגית ואין רשומות.
--   • hospitality.consent_records — רשומה אנונימית של בחירת הגולש: מזהה אקראי שנוצר בדפדפן, האם
--     אושרה מדידה, מה נבחר (אישור / סירוב / שמירה / ביטול), גרסת המדיניות ומתי. בלי IP, בלי דפדפן
--     ובלי שום פרט מזהה. נשמרת 24 חודשים (נמחקת בכל רישום חדש של אותו אתר).
--   • analytics_enabled() — לאתר ולעורך: האם המדידה זמינה באתר של הכתובת (המתג בלבד).
--   • site_consent_record(...) — רק לשרת האפליקציה (service_role), אחרי הגבלת קצב; רק באתר פתוח
--     שהמדידה בו זמינה.
-- אין שינוי בטבלה קיימת או בפונקציה קיימת. Ecommerce — לא נוגעים.
--
-- Rollback: supabase/rollbacks/20261110210000_hosp_consent.down.sql — מוחק את הטבלה, את שתי
-- הפונקציות ואת המתג.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('hospitality_analytics_enabled', false,
   'Hospitality: מדידה (Google Analytics 4) באתר האירוח — נטענת רק אחרי הסכמת הגולש')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS hospitality.consent_records (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  consent_id     uuid NOT NULL,
  analytics      boolean NOT NULL,
  action         text NOT NULL CHECK (action IN ('accept', 'reject', 'save', 'withdraw')),
  policy_version text NOT NULL CHECK (policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- אישור — עם מדידה; סירוב וביטול — בלי
  CONSTRAINT consent_records_action_matches CHECK (
    (action = 'accept' AND analytics) OR (action IN ('reject', 'withdraw') AND NOT analytics)
    OR action = 'save')
);
CREATE INDEX IF NOT EXISTS consent_records_tenant_created
  ON hospitality.consent_records (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS consent_records_tenant_consent
  ON hospitality.consent_records (tenant_id, consent_id);

-- כמו כל טבלה בסכמה (מיגרציה 60): RLS, בלי הרשאות ישירות לאף תפקיד, האתר של שורה לא משתנה.
-- הגישה — רק דרך הפונקציות למטה.
ALTER TABLE hospitality.consent_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hospitality.consent_records FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS tenant_isolation ON hospitality.consent_records;
CREATE POLICY tenant_isolation ON hospitality.consent_records AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS backend_enabled ON hospitality.consent_records;
CREATE POLICY backend_enabled ON hospitality.consent_records AS RESTRICTIVE
  USING ((SELECT hospitality.flag('hospitality_backend_enabled')))
  WITH CHECK ((SELECT hospitality.flag('hospitality_backend_enabled')));
DROP TRIGGER IF EXISTS tenant_guard ON hospitality.consent_records;
CREATE TRIGGER tenant_guard BEFORE INSERT OR UPDATE OF tenant_id ON hospitality.consent_records
  FOR EACH ROW EXECUTE FUNCTION hospitality.tenant_guard();

-- האם המדידה זמינה באתר של הכתובת (x-tenant-id) — רק המתג; לא חושף שום דבר אחר
CREATE OR REPLACE FUNCTION hospitality.analytics_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality.request_tenant();
BEGIN
  RETURN _t IS NOT NULL AND hospitality.flag_for('hospitality_analytics_enabled', _t);
END $$;
REVOKE ALL ON FUNCTION hospitality.analytics_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hospitality.analytics_enabled() TO anon, authenticated, service_role;

-- רישום הבחירה של הגולש. רק השרת קורא לזה (אחרי הגבלת הקצב), רק באתר פתוח ורק כשהמדידה זמינה בו
CREATE OR REPLACE FUNCTION hospitality.site_consent_record(_consent_id uuid, _analytics boolean,
                                                           _action text, _policy_version text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _t uuid := hospitality._public_site_tenant();
BEGIN
  IF NOT hospitality.flag_for('hospitality_analytics_enabled', _t) THEN
    RAISE EXCEPTION 'באתר הזה אין Cookies שדורשים הסכמה' USING ERRCODE = 'feature_not_supported';
  END IF;
  IF _consent_id IS NULL OR _analytics IS NULL OR _action IS NULL
     OR _action NOT IN ('accept', 'reject', 'save', 'withdraw')
     OR _policy_version IS NULL OR _policy_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR (_action = 'accept' AND NOT _analytics) OR (_action IN ('reject', 'withdraw') AND _analytics) THEN
    RAISE EXCEPTION 'הבחירה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO hospitality.consent_records (tenant_id, consent_id, analytics, action, policy_version)
  VALUES (_t, _consent_id, _analytics, _action, _policy_version);
  -- שמירה ל-24 חודשים בלבד
  DELETE FROM hospitality.consent_records
   WHERE tenant_id = _t AND created_at < now() - interval '24 months';
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION hospitality.site_consent_record(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hospitality.site_consent_record(uuid, boolean, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- חלק 17: דומיין פרטי, מפתח Resend של החנות, יומן התראות
--
-- 1. site_settings.custom_domain — הדומיין הפרטי של החנות, גלוי לקוד האתר.
--    מקור האמת נשאר tenants.custom_domain (ממנו הניתוב, אימות ה-DNS ותעודת
--    ה-SSL — חלק 9). העמודה ב-site_settings היא שיקוף שמתעדכן אוטומטית
--    (טריגר), ואי אפשר לכתוב אליה ישירות — כך שני המקומות לא נפרדים לעולם.
-- 2. 'shops' שמורה — shops.nuri1.fit הוא יעד ה-CNAME לדומיינים פרטיים.
-- 3. tenant_email_secrets — מפתח ה-API של Resend של החנות (לא ב-site_settings:
--    הטבלה הזו קריאה לכל גולש באתר, ומפתח API שם היה דולף לכל העולם).
--    רק השרת (service role) קורא/כותב. בלי מפתח — שולחים במפתח הפלטפורמה.
-- 4. notification_logs — כל ניסיון שליחה של התראה (הצלחה / כישלון / דילוג):
--    מנהל החנות רואה את היומן בפאנל, רק השרת כותב.
--
-- ניתן להרצה חוזרת.
-- ============================================================

-- ============================================================
-- 1. site_settings.custom_domain — שיקוף של tenants.custom_domain
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS custom_domain TEXT;

COMMENT ON COLUMN public.site_settings.custom_domain IS
  'הדומיין הפרטי של החנות (www.my-shop.co.il) — שיקוף אוטומטי של tenants.custom_domain. נשמר דרך מסך "דומיין פרטי" בלבד.';

-- כל כתיבה ל-site_settings: העמודה נלקחת תמיד מ-tenants (גם אם הדפדפן שלח
-- ערך אחר — המנהל לא עוקף כך את אימות ה-DNS / הגבלת החבילה)
CREATE OR REPLACE FUNCTION public.site_settings_custom_domain_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT t.custom_domain INTO NEW.custom_domain
    FROM public.tenants t
   WHERE t.id = NEW.tenant_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.site_settings_custom_domain_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS site_settings_custom_domain_sync ON public.site_settings;
CREATE TRIGGER site_settings_custom_domain_sync
BEFORE INSERT OR UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.site_settings_custom_domain_sync();

-- שינוי הדומיין של החנות (שמירה / הסרה / מחיקה ע"י הפלטפורמה) ← site_settings
CREATE OR REPLACE FUNCTION public.tenants_custom_domain_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.custom_domain IS DISTINCT FROM OLD.custom_domain THEN
    -- הטריגר של site_settings קורא את הערך מ-tenants (כבר מעודכן כאן)
    UPDATE public.site_settings s
       SET custom_domain = NEW.custom_domain
     WHERE s.tenant_id = NEW.id
       AND s.custom_domain IS DISTINCT FROM NEW.custom_domain;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.tenants_custom_domain_mirror() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_custom_domain_mirror ON public.tenants;
CREATE TRIGGER tenants_custom_domain_mirror
AFTER INSERT OR UPDATE OF custom_domain ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_custom_domain_mirror();

-- מילוי ראשוני לחנויות קיימות
UPDATE public.site_settings s
   SET custom_domain = t.custom_domain
  FROM public.tenants t
 WHERE t.id = s.tenant_id
   AND s.custom_domain IS DISTINCT FROM t.custom_domain;

-- ============================================================
-- 2. כתובות שמורות: shops (יעד ה-CNAME של דומיינים פרטיים)
-- ============================================================
CREATE OR REPLACE FUNCTION public.platform_reserved_slugs()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'www', 'api', 'admin', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets',
    'studio', 'status', 'help', 'support', 'docs', 'blog', 'test', 'dev', 'staging',
    'nuriel', 'platform', 'kobi', 'kaia', 'moments', 'inv', 'nuri', 'shops'
  ];
$$;

-- ============================================================
-- 3. מפתח Resend של החנות — רק לשרת
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_email_secrets (
  tenant_id       UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  resend_api_key  TEXT NOT NULL CHECK (resend_api_key ~ '^re_[A-Za-z0-9_-]{8,200}$'),
  -- כתובת השולח — על דומיין שהחנות אימתה בחשבון ה-Resend שלה
  sender_email    TEXT NOT NULL CHECK (
                    char_length(sender_email) <= 254
                    AND sender_email = lower(sender_email)
                    AND sender_email ~ '^[^[:space:]@<>"]+@[^[:space:]@<>"]+\.[^[:space:]@<>"]+$'),
  -- תוצאת הבדיקה מול Resend בשמירה: verified | unverified | unknown (מפתח מוגבל לשליחה)
  domain_status   TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (domain_status IN ('verified', 'unverified', 'unknown')),
  checked_at      TIMESTAMPTZ,
  -- הכישלון האחרון בשליחה במפתח של החנות (נפלנו למפתח הפלטפורמה)
  last_error      TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  last_error_at   TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID
);
COMMENT ON TABLE public.tenant_email_secrets IS
  'מפתח ה-API של Resend של החנות + כתובת השולח (חלק 17) — רק לשרת. בלי שורה: שליחה במפתח הפלטפורמה.';
ALTER TABLE public.tenant_email_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_email_secrets;
CREATE POLICY tenant_isolation ON public.tenant_email_secrets AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.tenant_email_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tenant_email_secrets TO service_role;

-- ============================================================
-- 4. יומן התראות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id                  UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL DEFAULT public.current_tenant_id()
                      REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id            UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  type                TEXT NOT NULL DEFAULT 'email' CHECK (type IN ('email')),
  -- איזו התראה: אישור הזמנה ללקוח / התראה לצוות / נשלח / מייל בדיקה
  template            TEXT NOT NULL DEFAULT 'order_confirmation'
                      CHECK (template IN ('order_confirmation', 'order_staff', 'order_shipped', 'test')),
  recipient           TEXT NOT NULL DEFAULT '' CHECK (char_length(recipient) <= 1000),
  subject             TEXT NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  -- דרך איזה מפתח: של החנות או של הפלטפורמה (NULL = לא נשלח בכלל)
  provider            TEXT CHECK (provider IS NULL OR provider IN ('tenant', 'platform')),
  provider_message_id TEXT CHECK (provider_message_id IS NULL OR char_length(provider_message_id) <= 200),
  error               TEXT CHECK (error IS NULL OR char_length(error) <= 1000),
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notification_logs IS
  'כל ניסיון שליחת התראה (חלק 17): הצלחה / כישלון / דילוג, דרך מפתח החנות או הפלטפורמה';

CREATE INDEX IF NOT EXISTS notification_logs_tenant_sent_idx
  ON public.notification_logs (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS notification_logs_order_idx
  ON public.notification_logs (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.notification_logs;
CREATE POLICY tenant_isolation ON public.notification_logs
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "notification logs readable by admin" ON public.notification_logs;
CREATE POLICY "notification logs readable by admin" ON public.notification_logs
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.notification_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.notification_logs TO authenticated;
-- רק השרת כותב; יומן — בלי עריכה (מחיקת הזמנה מאפסת את order_id דרך ה-FK)
GRANT SELECT, INSERT, DELETE ON public.notification_logs TO service_role;

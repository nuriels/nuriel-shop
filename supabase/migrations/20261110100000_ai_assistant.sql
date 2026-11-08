-- ============================================================
-- NURIEL AI ASSISTANT — מיגרציה 61: תוסף עוזר AI בתשלום שנתי (150 ₪ לשנה, לחנות / למתחם)
-- ============================================================
-- שני מוצרים נפרדים, כל אחד עם קטלוג מדריכים משלו (בקוד): NURIEL AI – Ecommerce ו-NURIEL AI – Hospitality.
-- החבילה של עסק היא תמיד מסוג העסק עצמו — tenants.site_type (שאי אפשר לשנות) — וזה נבדק כאן, במסד,
-- בכל הפעלה ובכל בקשה. לא לפי מה שהדפדפן שולח.
--
--   • ai_packages               שתי החבילות: שם, מחיר (באגורות), 12 חודשים, וקטלוג המדריכים של המוצר
--   • ai_subscriptions          החבילה של עסק (שורה אחת לעסק): סוג המוצר, השבתה ידנית
--   • ai_subscription_periods   תקופות של 12 חודשים: התחלה, סיום מדויק, המחיר שנשמר בהפעלה / בחידוש
--   • ai_subscription_events    היסטוריה: הפעלה, חידוש, השבתה, החזרה — מי ביצע, מתי, תאריכים ומחיר
--   • ai_settings               הגדרות כלליות (שורה אחת): מצב (כבוי / בדיקה / פעיל), דגם, מפתח API מוצפן
--                                (מוצפן באפליקציה לפני השמירה — המסד לא רואה מפתח גלוי), מגבלות
--   • ai_usage_log              יומן שימוש: עסק, תוצאה, מדריכים, טוקנים, עלות משוערת — בלי זהות השואל
--   • ai_notifications          התראות החידוש: 30 / 14 / 7 / 1 ימים לפני הסיום וביום הסיום — פעם אחת בלבד
--
-- תאריכים — לפי שעון ישראל (Asia/Jerusalem), בשרת בלבד (ai_today):
--   התקופה היא [התחלה, התחלה + 12 חודשים): תאריך הסיום (היום האחרון שבו החבילה בתוקף, כולל) הוא יום
--   לפני אותו תאריך 12 חודשים קדימה. 08.11.2026 → 07.11.2027 · 01.03.2027 → 29.02.2028 (שנה מעוברת) ·
--   31.01.2027 → 30.01.2028 · 29.02.2028 → 27.02.2029 (אין 29.02 ב-2029: יום השנה הוא 28.02).
--   הבדיקה רצה בכל בקשה: ב-00:00 שעון ישראל של היום שאחרי הסיום — העוזר נעצר (subscription_expired).
--
-- סטטוס (ai_state_on): none · scheduled (טרם התחילה) · active · ending_soon (30 יום ומטה עד הסוף) ·
--   expired · suspended (הושבתה ידנית) · mismatch (החבילה לא מסוג העסק — לא אמור לקרות; נחסם).
--   זכאות (entitled) = active / ending_soon בלבד.
--
-- חידוש: תקופה חדשה של 12 חודשים. כשהחבילה עוד בתוקף — מתחילה ביום שאחרי הסוף (בלי ימים אבודים);
--   כשפגה — מהיום. ההגדרות, היסטוריית השימוש וההתראות לא נמחקים כשהחבילה פגה, וחידוש ממשיך מאותו מקום.
--   אין חיוב אוטומטי: מנהל העל מפעיל / מחדש רק אחרי אישור ותשלום (מחוץ למערכת).
--
-- הרשאות: כל הטבלאות סגורות לדפדפן (anon / authenticated) — גם למנהל עסק וגם למנהל העל. כל פעולה של
--   מנהל העל עוברת דרך פונקציה שמקבלת את מזהה המבצע מהשרת ובודקת בעצמה שהוא מנהל פלטפורמה
--   (is_platform_admin), כך שגם תקלה בשרת לא נותנת למנהל עסק להפעיל, להאריך או לשנות מחיר. הפונקציות
--   פתוחות רק לשרת האפליקציה (service_role). כל פעולה נרשמת גם ביומן הפלטפורמה (platform_audit_log),
--   שנשמר גם אחרי מחיקת עסק.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261110100000_ai_assistant.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1. החבילות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_packages (
  code TEXT PRIMARY KEY CHECK (code IN ('nuriel_ai_ecommerce', 'nuriel_ai_hospitality')),
  product TEXT NOT NULL UNIQUE CHECK (product IN ('ecommerce', 'hospitality')),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  -- 15000 = 150 ₪. המחיר שנשמר בכל תקופה הוא המחיר ברגע ההפעלה / החידוש
  price_agorot INTEGER NOT NULL CHECK (price_agorot BETWEEN 1 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  period_months INTEGER NOT NULL DEFAULT 12 CHECK (period_months = 12),
  -- איזה קטלוג מדריכים (בקוד) שייך למוצר. האפליקציה מוודאת שהקטלוג שלה תואם
  guide_catalog TEXT NOT NULL CHECK (guide_catalog ~ '^[a-z]+-v[0-9]+$'),
  CHECK ((code = 'nuriel_ai_ecommerce' AND product = 'ecommerce')
      OR (code = 'nuriel_ai_hospitality' AND product = 'hospitality')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ai_packages (code, product, name, price_agorot, guide_catalog) VALUES
  ('nuriel_ai_ecommerce', 'ecommerce', 'NURIEL AI – Ecommerce', 15000, 'ecommerce-v1'),
  ('nuriel_ai_hospitality', 'hospitality', 'NURIEL AI – Hospitality', 15000, 'hospitality-v1')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------
-- 2. החבילה של עסק (שורה אחת לעסק)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  package_code TEXT NOT NULL REFERENCES public.ai_packages(code),
  product TEXT NOT NULL CHECK (product IN ('ecommerce', 'hospitality')),
  -- השבתה ידנית של מנהל העל: העוזר נעצר מיד, גם באמצע תקופה. התקופה ממשיכה לרוץ
  suspended BOOLEAN NOT NULL DEFAULT false,
  suspended_at TIMESTAMPTZ,
  suspended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  suspend_reason TEXT CHECK (suspend_reason IS NULL OR char_length(suspend_reason) <= 300),
  CHECK (suspended = (suspended_at IS NOT NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- סוג החבילה = סוג העסק = סוג החבילה בקטלוג; העסק, החבילה וסוגה לא משתנים אחרי היצירה
CREATE OR REPLACE FUNCTION public.ai_subscriptions_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _site_type text;
  _package_product text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                           OR NEW.package_code IS DISTINCT FROM OLD.package_code
                           OR NEW.product IS DISTINCT FROM OLD.product) THEN
    RAISE EXCEPTION 'ai: the business, the package and its product do not change' USING ERRCODE = 'check_violation';
  END IF;
  SELECT t.site_type INTO _site_type FROM public.tenants t WHERE t.id = NEW.tenant_id;
  SELECT p.product INTO _package_product FROM public.ai_packages p WHERE p.code = NEW.package_code;
  IF _site_type IS DISTINCT FROM NEW.product OR _package_product IS DISTINCT FROM NEW.product THEN
    RAISE EXCEPTION 'ai: the package must match the business type' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_subscriptions_guard ON public.ai_subscriptions;
CREATE TRIGGER ai_subscriptions_guard BEFORE INSERT OR UPDATE ON public.ai_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.ai_subscriptions_guard();

-- ------------------------------------------------------------
-- 3. תאריכים
-- ------------------------------------------------------------
-- "היום" לפי שעון ישראל — המקור היחיד לתאריך של היום בכל החישובים
CREATE OR REPLACE FUNCTION public.ai_today()
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Jerusalem')::date
$$;

-- היום האחרון של תקופה שמתחילה ב-_start (כולל): יום לפני אותו תאריך 12 חודשים קדימה
CREATE OR REPLACE FUNCTION public.ai_period_end(_start date)
RETURNS date LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT (_start + interval '12 months')::date - 1
$$;

-- ------------------------------------------------------------
-- 4. התקופות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_subscription_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.ai_subscriptions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('activation', 'renewal')),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  price_agorot INTEGER NOT NULL CHECK (price_agorot BETWEEN 0 AND 10000000),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK (currency = 'ILS'),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- תמיד 12 חודשים בדיוק — גם מי שכותב ישירות למסד לא יכול להאריך תקופה
  CONSTRAINT ai_period_is_12_months CHECK (ends_on = (starts_on + interval '12 months')::date - 1),
  -- שתי תקופות של אותה חבילה לא חופפות
  CONSTRAINT ai_periods_no_overlap EXCLUDE USING gist
    (subscription_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS ai_subscription_periods_sub_idx
  ON public.ai_subscription_periods (subscription_id, starts_on);

CREATE OR REPLACE FUNCTION public.ai_periods_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_subscriptions s
                  WHERE s.id = NEW.subscription_id AND s.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'ai: the period belongs to the package of the same business' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_periods_guard ON public.ai_subscription_periods;
CREATE TRIGGER ai_periods_guard BEFORE INSERT OR UPDATE ON public.ai_subscription_periods
  FOR EACH ROW EXECUTE FUNCTION public.ai_periods_guard();

-- ------------------------------------------------------------
-- 5. ההיסטוריה (append-only: לשרת אין UPDATE / DELETE)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_subscription_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.ai_subscriptions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('activated', 'renewed', 'suspended', 'resumed')),
  period_id UUID REFERENCES public.ai_subscription_periods(id) ON DELETE SET NULL,
  starts_on DATE,
  ends_on DATE,
  price_agorot INTEGER CHECK (price_agorot IS NULL OR price_agorot BETWEEN 0 AND 10000000),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT CHECK (actor_email IS NULL OR char_length(actor_email) <= 320),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_subscription_events_sub_idx
  ON public.ai_subscription_events (subscription_id, created_at DESC);

-- ------------------------------------------------------------
-- 6. ההגדרות הכלליות (שורה אחת)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- off = אף אחד לא משתמש · test = רק מנהל העל (מצב בדיקה) · on = כל עסק עם חבילה בתוקף
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'test', 'on')),
  model TEXT NOT NULL DEFAULT 'claude-haiku-5-5' CHECK (model ~ '^claude-[a-z0-9-]{3,60}$'),
  -- AES-256-GCM (v1.iv.tag.ciphertext), מוצפן באפליקציה. המפתח הגלוי לא נשמר בשום מקום
  api_key_encrypted TEXT CHECK (api_key_encrypted IS NULL OR api_key_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  -- 4 התווים האחרונים — להצגה למנהל העל בלבד
  api_key_last4 TEXT CHECK (api_key_last4 IS NULL OR api_key_last4 ~ '^[A-Za-z0-9_-]{4}$'),
  api_key_updated_at TIMESTAMPTZ,
  api_key_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- מגבלות: אורך שאלה, שאלות לעסק בשעה (הרבה מתחת לתקרה של כל המערכת — 1500 בשעה, באפליקציה — כך
  -- שעסק אחד לא יכול לנצל אותה לבד), שאלות למשתמש בדקה
  max_question_chars INTEGER NOT NULL DEFAULT 400 CHECK (max_question_chars BETWEEN 50 AND 1000),
  tenant_hourly_limit INTEGER NOT NULL DEFAULT 60 CHECK (tenant_hourly_limit BETWEEN 1 AND 300),
  user_minute_limit INTEGER NOT NULL DEFAULT 6 CHECK (user_minute_limit BETWEEN 1 AND 60),
  -- תקציב חודשי משוער (בדולרים) — חריגה מסומנת למנהל העל כחריגה (לא עוצרת)
  monthly_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 25 CHECK (monthly_budget_usd BETWEEN 0 AND 100000),
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  last_error_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 7. יומן השימוש — בלי זהות השואל; טקסט השאלה (אחרי הסרת מידע רגיש) רק כשאין מדריך / כשנחסמה
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  product TEXT CHECK (product IS NULL OR product IN ('ecommerce', 'hospitality')),
  -- ai = סיווג של הדגם · search = חיפוש מילות מפתח · ai_error = הקריאה נכשלה · blocked = בקשה אסורה,
  -- נעצרה לפני הדגם · test = בדיקת חיבור / שאלת בדיקה של מנהל העל
  mode TEXT NOT NULL CHECK (mode IN ('ai', 'search', 'ai_error', 'blocked', 'test')),
  outcome TEXT NOT NULL CHECK (outcome IN ('guides', 'off_topic', 'unknown', 'failed')),
  guides TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(guides) <= 3),
  question TEXT CHECK (question IS NULL OR char_length(question) <= 500),
  model TEXT CHECK (model IS NULL OR char_length(model) <= 80),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cache_write_tokens INTEGER CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
  cache_read_tokens INTEGER CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
  cost_usd NUMERIC(12, 6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  error TEXT CHECK (error IS NULL OR char_length(error) <= 300)
);
CREATE INDEX IF NOT EXISTS ai_usage_log_created_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_tenant_idx ON public.ai_usage_log (tenant_id, created_at DESC);

-- סיכום יומי של כל המערכת (בלי עמודת עסק): כל שורה ביומן מתווספת לסיכום של היום שלה (שעון ישראל).
-- הסיכומים והתקציב החודשי נקראים מכאן — כך שמחיקת עסק (שמוחקת את השורות שלו ביומן) לא מקטינה את
-- מה שכבר שולם ל-Anthropic. טריגר בלבד כותב לכאן; לשרת — קריאה בלבד
CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  day DATE NOT NULL,
  product TEXT NOT NULL DEFAULT '' CHECK (product IN ('', 'ecommerce', 'hospitality')),
  mode TEXT NOT NULL CHECK (mode IN ('ai', 'search', 'ai_error', 'blocked', 'test')),
  outcome TEXT NOT NULL CHECK (outcome IN ('guides', 'off_topic', 'unknown', 'failed')),
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  PRIMARY KEY (day, product, mode, outcome)
);

CREATE OR REPLACE FUNCTION public.ai_usage_daily_add()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.ai_usage_daily AS d (day, product, mode, outcome, calls, input_tokens, output_tokens,
                                          cache_write_tokens, cache_read_tokens, cost_usd)
  VALUES ((NEW.created_at AT TIME ZONE 'Asia/Jerusalem')::date, COALESCE(NEW.product, ''), NEW.mode, NEW.outcome, 1,
          COALESCE(NEW.input_tokens, 0), COALESCE(NEW.output_tokens, 0), COALESCE(NEW.cache_write_tokens, 0),
          COALESCE(NEW.cache_read_tokens, 0), COALESCE(NEW.cost_usd, 0))
  ON CONFLICT (day, product, mode, outcome) DO UPDATE
     SET calls = d.calls + 1,
         input_tokens = d.input_tokens + EXCLUDED.input_tokens,
         output_tokens = d.output_tokens + EXCLUDED.output_tokens,
         cache_write_tokens = d.cache_write_tokens + EXCLUDED.cache_write_tokens,
         cache_read_tokens = d.cache_read_tokens + EXCLUDED.cache_read_tokens,
         cost_usd = d.cost_usd + EXCLUDED.cost_usd;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_usage_daily_add ON public.ai_usage_log;
CREATE TRIGGER ai_usage_daily_add AFTER INSERT ON public.ai_usage_log
  FOR EACH ROW EXECUTE FUNCTION public.ai_usage_daily_add();

-- ------------------------------------------------------------
-- 8. התראות החידוש — אותה התראה לאותה תקופה נשלחת פעם אחת בלבד (UNIQUE)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.ai_subscriptions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- תאריך הסיום שעליו ההתראה (אחרי חידוש יש תאריך סיום חדש — והתראות חדשות לקראתו)
  period_ends_on DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('d30', 'd14', 'd7', 'd1', 'd0')),
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
  -- pending = נתפסה לשליחה · sent · failed (נרשמה השגיאה; עוד ניסיון אחרי שעה, עד 3 ניסיונות) ·
  -- skipped (אין כתובת תקינה — סופי)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts SMALLINT NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  -- הכתובת במיסוך (n***@example.com) — לא הכתובת המלאה
  recipient_masked TEXT CHECK (recipient_masked IS NULL OR char_length(recipient_masked) <= 120),
  error TEXT CHECK (error IS NULL OR char_length(error) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- מתי נתפס הניסיון הנוכחי (התפיסה שנתקעה נמדדת ממנו)
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT ai_notifications_once UNIQUE (subscription_id, period_ends_on, kind, channel)
);
CREATE INDEX IF NOT EXISTS ai_notifications_tenant_idx ON public.ai_notifications (tenant_id, created_at DESC);

-- ------------------------------------------------------------
-- 9. הרשאות על הטבלאות: סגור לדפדפן. השרת: קריאה; כתיבה רק ליומן השימוש ולשגיאה האחרונה.
--    כל שאר השינויים — רק דרך הפונקציות למטה (SECURITY DEFINER), שבודקות ורושמות
-- ------------------------------------------------------------
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['ai_packages', 'ai_subscriptions', 'ai_subscription_periods', 'ai_subscription_events',
                            'ai_settings', 'ai_usage_log', 'ai_usage_daily', 'ai_notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', _t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', _t);
  END LOOP;
END $$;
GRANT INSERT ON public.ai_usage_log TO service_role;
GRANT UPDATE (last_error, last_error_at) ON public.ai_settings TO service_role;

-- ------------------------------------------------------------
-- 10. המצב של עסק ביום נתון
-- ------------------------------------------------------------
-- סוף הרצף של תקופות צמודות שמתחיל בתקופה שמסתיימת ב-_end (חידוש מראש מתחיל ביום שאחרי)
CREATE OR REPLACE FUNCTION public.ai_chain_end(_subscription uuid, _end date)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _next date;
  _guard integer := 0;
BEGIN
  LOOP
    SELECT p.ends_on INTO _next FROM public.ai_subscription_periods p
     WHERE p.subscription_id = _subscription AND p.starts_on = _end + 1;
    EXIT WHEN NOT FOUND OR _guard >= 50;
    _end := _next;
    _guard := _guard + 1;
  END LOOP;
  RETURN _end;
END $$;

CREATE OR REPLACE FUNCTION public.ai_state_on(_tenant uuid, _today date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.tenants;
  s public.ai_subscriptions;
  pk public.ai_packages;
  cur public.ai_subscription_periods;
  _chain_end date;
  _next public.ai_subscription_periods;
  _last public.ai_subscription_periods;
  _status text;
  _starts date;
  _ends date;
  _days integer;
BEGIN
  IF _today IS NULL THEN
    RAISE EXCEPTION 'ai: a date is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'none', 'entitled', false, 'today', _today, 'tenant_found', false);
  END IF;
  SELECT * INTO pk FROM public.ai_packages WHERE product = t.site_type;
  SELECT * INTO s FROM public.ai_subscriptions WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tenant_found', true, 'tenant_id', t.id, 'site_type', t.site_type, 'status', 'none', 'entitled', false,
      'today', _today, 'package_code', pk.code, 'package_name', pk.name, 'price_agorot', pk.price_agorot);
  END IF;

  SELECT * INTO cur FROM public.ai_subscription_periods p
   WHERE p.subscription_id = s.id AND p.starts_on <= _today AND p.ends_on >= _today;
  IF FOUND THEN
    _chain_end := public.ai_chain_end(s.id, cur.ends_on);
  END IF;
  SELECT * INTO _next FROM public.ai_subscription_periods p
   WHERE p.subscription_id = s.id AND p.starts_on > _today ORDER BY p.starts_on LIMIT 1;
  SELECT * INTO _last FROM public.ai_subscription_periods p
   WHERE p.subscription_id = s.id ORDER BY p.ends_on DESC LIMIT 1;

  IF s.product IS DISTINCT FROM t.site_type THEN
    _status := 'mismatch';
  ELSIF s.suspended THEN
    _status := 'suspended';
  ELSIF cur.id IS NOT NULL THEN
    _status := CASE WHEN _chain_end - _today <= 30 THEN 'ending_soon' ELSE 'active' END;
  ELSIF _next.id IS NOT NULL THEN
    _status := 'scheduled';
  ELSIF _last.id IS NOT NULL THEN
    _status := 'expired';
  ELSE
    _status := 'none';
  END IF;

  IF cur.id IS NOT NULL THEN
    _starts := cur.starts_on;
    _ends := _chain_end;
  ELSIF _next.id IS NOT NULL THEN
    _starts := _next.starts_on;
    _ends := public.ai_chain_end(s.id, _next.ends_on);
  ELSIF _last.id IS NOT NULL THEN
    _starts := _last.starts_on;
    _ends := _last.ends_on;
  END IF;
  _days := CASE WHEN _ends IS NOT NULL THEN _ends - _today END;

  RETURN jsonb_build_object(
    'tenant_found', true,
    'tenant_id', t.id,
    'site_type', t.site_type,
    'subscription_id', s.id,
    'product', s.product,
    'package_code', s.package_code,
    'package_name', pk.name,
    'guide_catalog', pk.guide_catalog,
    'price_agorot', pk.price_agorot,
    'status', _status,
    'entitled', _status IN ('active', 'ending_soon'),
    'today', _today,
    'starts_on', _starts,
    'ends_on', _ends,
    'days_left', _days,
    -- תקופה פעילה + חידוש שכבר נקבע מראש: מתי מתחיל החידוש
    'renewal_starts_on', CASE WHEN cur.id IS NOT NULL AND _chain_end > cur.ends_on THEN cur.ends_on + 1 END,
    'current_period_ends_on', cur.ends_on,
    -- סוף התקופה האחרונה (של כל התקופות) — מסך החידוש שולח אותו חזרה, והחידוש נעצר אם הוא השתנה בינתיים
    'last_ends_on', _last.ends_on,
    'suspended', s.suspended,
    'suspended_at', s.suspended_at,
    'suspend_reason', s.suspend_reason);
END $$;

-- לשרת האפליקציה: המצב היום (שעון ישראל). נקרא בכל בקשה לעוזר — לא פעם אחת בטעינה
CREATE OR REPLACE FUNCTION public.ai_entitlement(_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.ai_state_on(_tenant, public.ai_today())
$$;

-- ------------------------------------------------------------
-- 11. מנהל העל
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_require_platform_admin(_actor uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_admin(_actor) THEN
    RAISE EXCEPTION 'ai: platform admin only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT u.email INTO _email FROM auth.users u WHERE u.id = _actor;
  RETURN _email;
END $$;

CREATE OR REPLACE FUNCTION public.ai_audit(_actor uuid, _email text, _tenant uuid, _action text, _details jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, _actor, _email, _action, COALESCE(_details, '{}'::jsonb));
$$;

-- כל העסקים (חנויות ומתחמים) עם מצב החבילה היום. סינון לפי סוג וחיפוש לפי שם / כתובת
CREATE OR REPLACE FUNCTION public.ai_admin_list(_actor uuid, _product text DEFAULT NULL, _search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _today date := public.ai_today();
  _q text := NULLIF(left(btrim(COALESCE(_search, '')), 80), '');
BEGIN
  PERFORM public.ai_require_platform_admin(_actor);
  IF _product IS NOT NULL AND _product NOT IN ('ecommerce', 'hospitality') THEN
    RAISE EXCEPTION 'ai: unknown product' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'site_type', t.site_type,
             'tenant_status', t.status, 'state', public.ai_state_on(t.id, _today))
           ORDER BY t.name, t.slug)
      FROM public.tenants t
     WHERE t.site_type IN ('ecommerce', 'hospitality')
       AND (_product IS NULL OR t.site_type = _product)
       AND (_q IS NULL
            OR t.name ILIKE '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR t.slug ILIKE '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), '[]'::jsonb);
END $$;

-- הפעלה: בחירת סוג העוזר (חייב להתאים לסוג העסק) ותאריך התחלה; הסיום — 12 חודשים, אוטומטית
CREATE OR REPLACE FUNCTION public.ai_admin_activate(_actor uuid, _tenant uuid, _product text, _starts_on date,
                                                    _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text := public.ai_require_platform_admin(_actor);
  _today date := public.ai_today();
  t public.tenants;
  pk public.ai_packages;
  s public.ai_subscriptions;
  _state jsonb;
  _period uuid;
  _kind text := 'activation';
  _clean_note text := NULLIF(left(btrim(COALESCE(_note, '')), 300), '');
BEGIN
  SELECT * INTO t FROM public.tenants WHERE id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai: business not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF _product IS NULL OR _product NOT IN ('ecommerce', 'hospitality') THEN
    RAISE EXCEPTION 'ai: unknown product' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF t.site_type IS DISTINCT FROM _product THEN
    RAISE EXCEPTION 'ai: the assistant type must match the business type' USING ERRCODE = 'check_violation';
  END IF;
  IF _starts_on IS NULL OR _starts_on < _today - 60 OR _starts_on > _today + 365 THEN
    RAISE EXCEPTION 'ai: start date out of range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO pk FROM public.ai_packages WHERE product = _product;

  SELECT * INTO s FROM public.ai_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF FOUND THEN
    _state := public.ai_state_on(_tenant, _today);
    IF _state ->> 'status' NOT IN ('expired', 'none') THEN
      RAISE EXCEPTION 'ai: already has a package — renew it instead' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ai_subscription_periods p
                WHERE p.subscription_id = s.id AND p.ends_on >= _starts_on) THEN
      RAISE EXCEPTION 'ai: the start date overlaps an earlier period' USING ERRCODE = 'check_violation';
    END IF;
    _kind := 'renewal';
  ELSE
    INSERT INTO public.ai_subscriptions (tenant_id, package_code, product, created_by)
    VALUES (_tenant, pk.code, _product, _actor)
    RETURNING * INTO s;
  END IF;

  INSERT INTO public.ai_subscription_periods (subscription_id, tenant_id, kind, starts_on, ends_on, price_agorot,
                                              note, created_by)
  VALUES (s.id, _tenant, _kind, _starts_on, public.ai_period_end(_starts_on), pk.price_agorot, _clean_note, _actor)
  RETURNING id INTO _period;
  INSERT INTO public.ai_subscription_events (subscription_id, tenant_id, kind, period_id, starts_on, ends_on,
                                             price_agorot, actor_id, actor_email, note)
  VALUES (s.id, _tenant, CASE WHEN _kind = 'activation' THEN 'activated' ELSE 'renewed' END, _period, _starts_on,
          public.ai_period_end(_starts_on), pk.price_agorot, _actor, _email, _clean_note);
  PERFORM public.ai_audit(_actor, _email, _tenant,
    CASE WHEN _kind = 'activation' THEN 'ai_subscription_activated' ELSE 'ai_subscription_renewed' END,
    jsonb_build_object('product', _product, 'starts_on', _starts_on, 'ends_on', public.ai_period_end(_starts_on),
                       'price_agorot', pk.price_agorot));
  RETURN public.ai_state_on(_tenant, _today);
END $$;

-- חידוש לשנה נוספת: בתוקף / טרם התחילה → מהיום שאחרי הסוף; פגה → מהיום. חידוש אחד מראש לכל היותר
-- _expected_last_end: סוף התקופה האחרונה כפי שהמסך הציג (last_ends_on). השתנה בינתיים (לחיצה כפולה, ניסיון
-- חוזר אחרי שהתשובה אבדה, שני מנהלים, רשימה ישנה) → נעצר, ולא נרשמת שנה נוספת בטעות
CREATE OR REPLACE FUNCTION public.ai_admin_renew(_actor uuid, _tenant uuid, _expected_last_end date,
                                                 _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text := public.ai_require_platform_admin(_actor);
  _today date := public.ai_today();
  s public.ai_subscriptions;
  pk public.ai_packages;
  _last_end date;
  _start date;
  _period uuid;
  _clean_note text := NULLIF(left(btrim(COALESCE(_note, '')), 300), '');
BEGIN
  SELECT * INTO s FROM public.ai_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai: no package to renew — activate first' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT t.site_type FROM public.tenants t WHERE t.id = _tenant) IS DISTINCT FROM s.product THEN
    RAISE EXCEPTION 'ai: the assistant type must match the business type' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO pk FROM public.ai_packages WHERE code = s.package_code;
  SELECT max(p.ends_on) INTO _last_end FROM public.ai_subscription_periods p WHERE p.subscription_id = s.id;
  IF _expected_last_end IS DISTINCT FROM _last_end THEN
    RAISE EXCEPTION 'ai: the package changed meanwhile — reload before renewing' USING ERRCODE = 'check_violation';
  END IF;
  -- לכל היותר תקופה עתידית אחת: חידוש מראש (או הפעלה שעוד לא התחילה) כבר קיים → אי אפשר לחדש שוב עד שהיא
  -- תתחיל. כך גם ביום האחרון של תקופה אפשר לחדש פעם אחת בלבד
  IF EXISTS (SELECT 1 FROM public.ai_subscription_periods p WHERE p.subscription_id = s.id AND p.starts_on > _today) THEN
    RAISE EXCEPTION 'ai: a renewal is already scheduled' USING ERRCODE = 'check_violation';
  END IF;
  _start := GREATEST(COALESCE(_last_end + 1, _today), _today);

  INSERT INTO public.ai_subscription_periods (subscription_id, tenant_id, kind, starts_on, ends_on, price_agorot,
                                              note, created_by)
  VALUES (s.id, _tenant, 'renewal', _start, public.ai_period_end(_start), pk.price_agorot, _clean_note, _actor)
  RETURNING id INTO _period;
  INSERT INTO public.ai_subscription_events (subscription_id, tenant_id, kind, period_id, starts_on, ends_on,
                                             price_agorot, actor_id, actor_email, note)
  VALUES (s.id, _tenant, 'renewed', _period, _start, public.ai_period_end(_start), pk.price_agorot, _actor, _email,
          _clean_note);
  PERFORM public.ai_audit(_actor, _email, _tenant, 'ai_subscription_renewed',
    jsonb_build_object('product', s.product, 'starts_on', _start, 'ends_on', public.ai_period_end(_start),
                       'price_agorot', pk.price_agorot));
  RETURN public.ai_state_on(_tenant, _today);
END $$;

-- השבתה ידנית / החזרה. ההשבתה עוצרת את העוזר מיד; התקופה ממשיכה לרוץ
CREATE OR REPLACE FUNCTION public.ai_admin_set_suspended(_actor uuid, _tenant uuid, _suspended boolean,
                                                         _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text := public.ai_require_platform_admin(_actor);
  s public.ai_subscriptions;
  _clean text := NULLIF(left(btrim(COALESCE(_reason, '')), 300), '');
BEGIN
  IF _suspended IS NULL THEN
    RAISE EXCEPTION 'ai: suspended must be true or false' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO s FROM public.ai_subscriptions WHERE tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai: no package for this business' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.suspended = _suspended THEN
    RETURN public.ai_state_on(_tenant, public.ai_today());
  END IF;
  UPDATE public.ai_subscriptions
     SET suspended = _suspended,
         suspended_at = CASE WHEN _suspended THEN now() END,
         suspended_by = CASE WHEN _suspended THEN _actor END,
         suspend_reason = CASE WHEN _suspended THEN _clean END
   WHERE id = s.id;
  INSERT INTO public.ai_subscription_events (subscription_id, tenant_id, kind, actor_id, actor_email, note)
  VALUES (s.id, _tenant, CASE WHEN _suspended THEN 'suspended' ELSE 'resumed' END, _actor, _email, _clean);
  PERFORM public.ai_audit(_actor, _email, _tenant,
    CASE WHEN _suspended THEN 'ai_subscription_suspended' ELSE 'ai_subscription_resumed' END,
    jsonb_build_object('product', s.product, 'reason', _clean));
  RETURN public.ai_state_on(_tenant, public.ai_today());
END $$;

-- ההיסטוריה של עסק: תקופות, פעולות, התראות
CREATE OR REPLACE FUNCTION public.ai_admin_history(_actor uuid, _tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.ai_subscriptions;
BEGIN
  PERFORM public.ai_require_platform_admin(_actor);
  SELECT * INTO s FROM public.ai_subscriptions WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('periods', '[]'::jsonb, 'events', '[]'::jsonb, 'notifications', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'starts_on', p.starts_on, 'ends_on', p.ends_on, 'price_agorot', p.price_agorot,
        'note', p.note, 'created_at', p.created_at) ORDER BY p.starts_on DESC)
      FROM public.ai_subscription_periods p WHERE p.subscription_id = s.id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'price_agorot', e.price_agorot,
        'actor_email', e.actor_email, 'note', e.note, 'created_at', e.created_at) ORDER BY e.created_at DESC, e.id DESC)
      FROM public.ai_subscription_events e WHERE e.subscription_id = s.id), '[]'::jsonb),
    'notifications', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', n.kind, 'period_ends_on', n.period_ends_on, 'status', n.status,
        'recipient_masked', n.recipient_masked, 'error', n.error, 'attempts', n.attempts,
        'created_at', n.created_at) ORDER BY n.created_at DESC)
      FROM (SELECT * FROM public.ai_notifications x WHERE x.subscription_id = s.id
             ORDER BY x.created_at DESC LIMIT 50) n), '[]'::jsonb));
END $$;

-- הגדרות כלליות: מצב, דגם, מפתח (כבר מוצפן באפליקציה), מגבלות. שדה שלא נשלח — לא משתנה
CREATE OR REPLACE FUNCTION public.ai_admin_save_settings(_actor uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _email text := public.ai_require_platform_admin(_actor);
  _changed text[] := '{}';
  s public.ai_settings;
BEGIN
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN
    RAISE EXCEPTION 'ai: settings must be an object' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(_patch) k
              WHERE k NOT IN ('mode', 'model', 'api_key_encrypted', 'api_key_last4', 'remove_key',
                              'max_question_chars', 'tenant_hourly_limit', 'user_minute_limit',
                              'monthly_budget_usd')) THEN
    RAISE EXCEPTION 'ai: unknown setting' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (_patch ? 'api_key_encrypted') AND (_patch ->> 'remove_key') = 'true' THEN
    RAISE EXCEPTION 'ai: replace or remove the key, not both' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.ai_settings SET
    mode = COALESCE(_patch ->> 'mode', mode),
    model = COALESCE(_patch ->> 'model', model),
    max_question_chars = COALESCE((_patch ->> 'max_question_chars')::integer, max_question_chars),
    tenant_hourly_limit = COALESCE((_patch ->> 'tenant_hourly_limit')::integer, tenant_hourly_limit),
    user_minute_limit = COALESCE((_patch ->> 'user_minute_limit')::integer, user_minute_limit),
    monthly_budget_usd = COALESCE((_patch ->> 'monthly_budget_usd')::numeric, monthly_budget_usd),
    updated_at = now(),
    updated_by = _actor
   WHERE id;
  IF _patch ? 'api_key_encrypted' THEN
    UPDATE public.ai_settings
       SET api_key_encrypted = _patch ->> 'api_key_encrypted', api_key_last4 = _patch ->> 'api_key_last4',
           api_key_updated_at = now(), api_key_updated_by = _actor, last_error = NULL, last_error_at = NULL
     WHERE id;
  ELSIF (_patch ->> 'remove_key') = 'true' THEN
    UPDATE public.ai_settings
       SET api_key_encrypted = NULL, api_key_last4 = NULL, api_key_updated_at = now(), api_key_updated_by = _actor,
           last_error = NULL, last_error_at = NULL
     WHERE id;
  END IF;

  SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO _changed
    FROM jsonb_object_keys(_patch) k WHERE k NOT IN ('api_key_encrypted', 'api_key_last4', 'remove_key');
  IF _patch ? 'api_key_encrypted' THEN _changed := array_append(_changed, 'api_key_replaced'); END IF;
  IF (_patch ->> 'remove_key') = 'true' THEN _changed := array_append(_changed, 'api_key_removed'); END IF;
  -- ביומן: מה השתנה ולאיזה ערך — אף פעם לא המפתח (גם לא מוצפן)
  PERFORM public.ai_audit(_actor, _email, NULL, 'ai_settings_changed',
    jsonb_build_object('changed', to_jsonb(_changed), 'mode', _patch -> 'mode', 'model', _patch -> 'model'));
  -- המצב אחרי השמירה — בלי המפתח (רק האם יש, ו-4 התווים האחרונים)
  SELECT * INTO s FROM public.ai_settings WHERE id;
  RETURN jsonb_build_object('mode', s.mode, 'model', s.model, 'has_key', s.api_key_encrypted IS NOT NULL,
                            'key_last4', s.api_key_last4, 'max_question_chars', s.max_question_chars,
                            'tenant_hourly_limit', s.tenant_hourly_limit, 'user_minute_limit', s.user_minute_limit,
                            'monthly_budget_usd', s.monthly_budget_usd);
END $$;

-- שימוש ועלויות — למנהל העל בלבד: החודש (לפי UTC, כמו חודש החיוב של Anthropic), לפי עסק (כולל 24 השעות
-- האחרונות מול 14 הימים שלפניהן — לזיהוי חריגות), לפי יום, ושאלות אחרונות בלי מדריך / שנחסמו (אחרי סינון
-- מידע רגיש, בלי זהות השואל ובלי שם העסק)
CREATE OR REPLACE FUNCTION public.ai_admin_usage(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- החודש לפי שעון ישראל (כמו כל התאריכים בתוסף)
  _month_first date := date_trunc('month', public.ai_today()::timestamp)::date;
  _month_start timestamptz := _month_first::timestamp AT TIME ZONE 'Asia/Jerusalem';
  _since timestamptz;
BEGIN
  PERFORM public.ai_require_platform_admin(_actor);
  _since := LEAST(_month_start, now() - interval '15 days');
  RETURN jsonb_build_object(
    'month_start', _month_start,
    -- הסיכומים והתקציב — מהסיכום היומי, שלא נמחק עם עסק
    'totals', (SELECT jsonb_build_object(
        'questions', COALESCE(sum(d.calls) FILTER (WHERE d.mode <> 'test'), 0),
        'ai', COALESCE(sum(d.calls) FILTER (WHERE d.mode = 'ai'), 0),
        'search', COALESCE(sum(d.calls) FILTER (WHERE d.mode = 'search'), 0),
        'blocked', COALESCE(sum(d.calls) FILTER (WHERE d.mode = 'blocked'), 0),
        'failed', COALESCE(sum(d.calls) FILTER (WHERE d.outcome = 'failed' AND d.mode <> 'test'), 0),
        'off_topic', COALESCE(sum(d.calls) FILTER (WHERE d.outcome = 'off_topic' AND d.mode <> 'test'), 0),
        'unknown', COALESCE(sum(d.calls) FILTER (WHERE d.outcome = 'unknown' AND d.mode <> 'test'), 0),
        'tests', COALESCE(sum(d.calls) FILTER (WHERE d.mode = 'test'), 0),
        'input_tokens', COALESCE(sum(d.input_tokens), 0),
        'output_tokens', COALESCE(sum(d.output_tokens), 0),
        'cache_write_tokens', COALESCE(sum(d.cache_write_tokens), 0),
        'cache_read_tokens', COALESCE(sum(d.cache_read_tokens), 0),
        'cost_usd', COALESCE(sum(d.cost_usd), 0),
        'test_cost_usd', COALESCE(sum(d.cost_usd) FILTER (WHERE d.mode = 'test'), 0))
      FROM public.ai_usage_daily d WHERE d.day >= _month_first),
    'tenants', COALESCE((SELECT jsonb_agg(x.j ORDER BY x.cost DESC, x.calls DESC) FROM (
        SELECT jsonb_build_object(
                 'tenant_id', l.tenant_id, 'name', t.name, 'slug', t.slug, 'product', max(l.product),
                 'questions_month', count(*) FILTER (WHERE l.created_at >= _month_start AND l.mode <> 'test'),
                 'cost_usd_month', COALESCE(sum(l.cost_usd) FILTER (WHERE l.created_at >= _month_start), 0),
                 'calls_24h', count(*) FILTER (WHERE l.created_at >= now() - interval '24 hours'),
                 'blocked_24h', count(*) FILTER (WHERE l.created_at >= now() - interval '24 hours' AND l.mode = 'blocked'),
                 'failed_24h', count(*) FILTER (WHERE l.created_at >= now() - interval '24 hours' AND l.outcome = 'failed'),
                 'calls_prev_14d', count(*) FILTER (WHERE l.created_at < now() - interval '24 hours'
                                                      AND l.created_at >= now() - interval '15 days'),
                 'last_at', max(l.created_at)) AS j,
               COALESCE(sum(l.cost_usd) FILTER (WHERE l.created_at >= _month_start), 0) AS cost,
               count(*) AS calls
          FROM public.ai_usage_log l
          LEFT JOIN public.tenants t ON t.id = l.tenant_id
         WHERE l.created_at >= _since AND l.tenant_id IS NOT NULL
         GROUP BY l.tenant_id, t.name, t.slug) x), '[]'::jsonb),
    'days', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', x.day, 'questions', x.n, 'cost_usd', x.c) ORDER BY x.day)
      FROM (SELECT d.day, COALESCE(sum(d.calls) FILTER (WHERE d.mode <> 'test'), 0) AS n, COALESCE(sum(d.cost_usd), 0) AS c
              FROM public.ai_usage_daily d WHERE d.day >= public.ai_today() - 13 GROUP BY d.day) x), '[]'::jsonb),
    'recent_questions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'question', u.question, 'product', u.product, 'outcome', u.outcome, 'mode', u.mode, 'at', u.created_at)
        ORDER BY u.created_at DESC)
      FROM (SELECT l.question, l.product, l.outcome, l.mode, l.created_at FROM public.ai_usage_log l
             WHERE l.question IS NOT NULL AND l.mode <> 'test' ORDER BY l.created_at DESC LIMIT 30) u), '[]'::jsonb));
END $$;

-- ------------------------------------------------------------
-- 12. התראות החידוש
-- ------------------------------------------------------------
-- מה צריך לצאת ביום נתון: לכל חבילה פעילה (לא מושבתת) — הסף הנוכחי לפי מספר הימים עד סוף הרצף
-- (30 / 14 / 7 / 1 / 0). סף שכבר נשלח לאותו תאריך סיום לא חוזר. חידוש מזיז את תאריך הסיום → אין
-- התראה על הסיום הישן. כשהמתזמן לא רץ כמה ימים — יוצאת רק ההתראה של הסף הנוכחי (לא כמה בבת אחת)
CREATE OR REPLACE FUNCTION public.ai_due_notifications_on(_today date)
RETURNS TABLE (subscription_id uuid, tenant_id uuid, product text, business_name text, slug text,
               owner_email text, period_ends_on date, days_left integer, kind text, price_agorot integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH cur AS (
    -- הנמען: כתובת הבעלים של העסק; בלי כתובת — מנהל העסק המוגן (הבעלים) הפעיל הראשון
    SELECT s.id AS subscription_id, s.tenant_id, s.product, t.name, t.slug,
           COALESCE(NULLIF(btrim(t.owner_email), ''),
                    (SELECT ur.email FROM public.user_roles ur
                      WHERE ur.tenant_id = t.id AND ur.role = 'admin' AND ur.is_protected AND NOT ur.is_blocked
                      ORDER BY ur.created_at LIMIT 1)) AS owner_email,
           pk.price_agorot,
           public.ai_chain_end(s.id, p.ends_on) AS chain_end
      FROM public.ai_subscriptions s
      JOIN public.tenants t ON t.id = s.tenant_id AND t.site_type = s.product
      JOIN public.ai_packages pk ON pk.code = s.package_code
      JOIN public.ai_subscription_periods p
        ON p.subscription_id = s.id AND p.starts_on <= _today AND p.ends_on >= _today
     WHERE NOT s.suspended
  ), due AS (
    SELECT c.*, (c.chain_end - _today)::integer AS days_left,
           CASE WHEN c.chain_end - _today = 0 THEN 'd0'
                WHEN c.chain_end - _today <= 1 THEN 'd1'
                WHEN c.chain_end - _today <= 7 THEN 'd7'
                WHEN c.chain_end - _today <= 14 THEN 'd14'
                WHEN c.chain_end - _today <= 30 THEN 'd30' END AS kind
      FROM cur c
  )
  SELECT d.subscription_id, d.tenant_id, d.product, d.name, d.slug, d.owner_email, d.chain_end, d.days_left, d.kind,
         d.price_agorot
    FROM due d
   WHERE d.kind IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ai_notifications n
                      WHERE n.subscription_id = d.subscription_id AND n.period_ends_on = d.chain_end
                        AND n.kind = d.kind AND n.channel = 'email'
                        -- שליחה שנכשלה: ניסיון נוסף שעה אחרי הקודם, עד 3 ניסיונות. נשלחה / דולגה / בטיפול — לא
                        AND NOT (n.status = 'failed' AND n.attempts < 3
                                 AND n.finished_at < now() - interval '1 hour'))
   ORDER BY d.days_left, d.name
$$;

CREATE OR REPLACE FUNCTION public.ai_due_notifications()
RETURNS TABLE (subscription_id uuid, tenant_id uuid, product text, business_name text, slug text,
               owner_email text, period_ends_on date, days_left integer, kind text, price_agorot integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM public.ai_due_notifications_on(public.ai_today())
$$;

-- תפיסת התראה לשליחה (פעם אחת בלבד): מחזירה את המזהה, או NULL כשכבר נתפסה / נשלחה, כשהחבילה
-- חודשה או הושבתה בינתיים (תאריך הסיום כבר אחר), או כשהסף לא בתוקף היום
CREATE OR REPLACE FUNCTION public.ai_notification_claim(_subscription uuid, _period_ends_on date, _kind text,
                                                        _recipient_masked text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id bigint;
  _tenant uuid;
BEGIN
  SELECT d.tenant_id INTO _tenant FROM public.ai_due_notifications_on(public.ai_today()) d
   WHERE d.subscription_id = _subscription AND d.period_ends_on = _period_ends_on AND d.kind = _kind;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.ai_notifications (subscription_id, tenant_id, period_ends_on, kind, recipient_masked)
  VALUES (_subscription, _tenant, _period_ends_on, _kind, left(_recipient_masked, 120))
  ON CONFLICT ON CONSTRAINT ai_notifications_once DO NOTHING
  RETURNING id INTO _id;
  IF _id IS NULL THEN
    -- ניסיון נוסף לשליחה שנכשלה (אותה שורה — ואותו Idempotency-Key אצל ספק המיילים)
    UPDATE public.ai_notifications n
       SET status = 'pending', attempts = n.attempts + 1, error = NULL, finished_at = NULL, claimed_at = now(),
           recipient_masked = left(_recipient_masked, 120)
     WHERE n.subscription_id = _subscription AND n.period_ends_on = _period_ends_on AND n.kind = _kind
       AND n.channel = 'email' AND n.status = 'failed' AND n.attempts < 3
       AND n.finished_at < now() - interval '1 hour'
    RETURNING n.id INTO _id;
  END IF;
  RETURN _id;
END $$;

-- סיום: נשלחה / נכשלה (השגיאה נרשמת; ניסיון נוסף אחרי שעה, עד 3) / דולגה (אין כתובת תקינה). רק מ-pending
CREATE OR REPLACE FUNCTION public.ai_notification_finish(_id bigint, _status text, _error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF _status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'ai: unknown notification status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.ai_notifications
     SET status = _status, error = left(_error, 300), finished_at = now()
   WHERE id = _id AND status = 'pending';
  RETURN FOUND;
END $$;

-- תפיסה שנתקעה (השרת נפל בין התפיסה לשליחה): אחרי שעה — נכשלה. הניסיון הבא (אם נשארו) יוצא עם אותו
-- Idempotency-Key, כך שאם המייל כבר יצא — ספק המיילים לא שולח אותו שוב
CREATE OR REPLACE FUNCTION public.ai_notifications_mark_stale()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  UPDATE public.ai_notifications
     SET status = 'failed', error = 'interrupted before the result was recorded', finished_at = now()
   WHERE status = 'pending' AND claimed_at < now() - interval '1 hour';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

-- ------------------------------------------------------------
-- 13. הרשאות על הפונקציות: רק שרת האפליקציה. הפונקציות הפנימיות (_on, chain_end, audit, guards) —
--     לאף תפקיד (רק מתוך הפונקציות האחרות)
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ai_subscriptions_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_periods_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_usage_daily_add() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_chain_end(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_state_on(uuid, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_require_platform_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_audit(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ai_due_notifications_on(date) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.ai_today() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_period_end(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_entitlement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_list(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_activate(uuid, uuid, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_renew(uuid, uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_set_suspended(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_history(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_save_settings(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_admin_usage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_due_notifications() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_notification_claim(uuid, date, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_notification_finish(bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_notifications_mark_stale() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_today(), public.ai_period_end(date), public.ai_entitlement(uuid),
  public.ai_admin_list(uuid, text, text), public.ai_admin_activate(uuid, uuid, text, date, text),
  public.ai_admin_renew(uuid, uuid, date, text), public.ai_admin_set_suspended(uuid, uuid, boolean, text),
  public.ai_admin_history(uuid, uuid), public.ai_admin_save_settings(uuid, jsonb), public.ai_admin_usage(uuid),
  public.ai_due_notifications(), public.ai_notification_claim(uuid, date, text, text),
  public.ai_notification_finish(bigint, text, text), public.ai_notifications_mark_stale()
  TO service_role;

COMMIT;

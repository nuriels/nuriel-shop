-- ============================================================
-- חלק 16א: עמודי חובה, טופס "צור קשר" וטופס "ביטול עסקה"
--
--   • site_settings: מדיניות ביטולים (cancellation_policy_content) ושעות
--     פעילות (business_hours). התקנון, מדיניות הפרטיות ומדיניות הביטולים
--     נשמרים כ-HTML מעוצב (עורך טקסט עשיר בפאנל) — האתר מנקה אותם לפני
--     הצגה (רשימת תגיות ומחלקות מותרות).
--   • contact_messages: פניות מטופס "צור קשר" (כולל קובץ מצורף אופציונלי
--     בדלי פרטי — רק השרת ניגש אליו).
--   • cancellation_requests: הודעות ביטול עסקה — תיעוד רגולטורי לבעל
--     החנות (חוק הגנת הצרכן). הלקוח לא יכול לערוך, והמנהל לא יכול למחוק.
--   • store_legal_identity(): השם המשפטי וח.פ / ע.מ של החנות (מפרטי העוסק),
--     להצגה בעמוד "צור קשר" ובתחתית האתר — ציבורי (חובת גילוי לפי חוק).
--
-- הפניות נשמרות רק דרך השרת (Server Functions): הגבלת קצב, אימות
-- (Captcha בטופס הביטול) ובדיקת הקובץ — שם. מכאן ה-RPC פתוחות ל-service_role
-- בלבד.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. הגדרות האתר: מדיניות ביטולים ושעות פעילות
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS cancellation_policy_content TEXT NOT NULL DEFAULT '',
  -- טקסט חופשי, שורה לכל טווח: "א'-ה' 09:00-17:00"
  ADD COLUMN IF NOT EXISTS business_hours TEXT NOT NULL DEFAULT '';

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_legal_length_check;
ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_legal_length_check CHECK (
    char_length(terms_content) <= 200000
    AND char_length(privacy_content) <= 200000
    AND char_length(cancellation_policy_content) <= 200000
    AND char_length(business_hours) <= 500);

COMMENT ON COLUMN public.site_settings.cancellation_policy_content IS
  'מדיניות ביטול עסקה (HTML מעוצב, מנוקה בהצגה) — מוצגת בראש עמוד /cancellations';
COMMENT ON COLUMN public.site_settings.business_hours IS
  'שעות הפעילות של העסק — מוצגות בעמוד "צור קשר"';

-- ============================================================
-- 2. עזרים: נרמול טלפון ומספר הזמנה
-- ============================================================
-- טלפון: רק ספרות ו-+ (050-123 4567 → 0501234567)
CREATE OR REPLACE FUNCTION public.normalize_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(btrim(COALESCE(_phone, '')), '[^0-9+]', '', 'g'), '');
$$;
GRANT EXECUTE ON FUNCTION public.normalize_phone(text) TO anon, authenticated, service_role;

-- מספר הזמנה: בלי רווחים ו-#, באותיות גדולות (sh 26-0000001 → SH26-0000001)
CREATE OR REPLACE FUNCTION public.normalize_order_number(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(_value, ''), '[[:space:]#]', '', 'g')), '');
$$;
GRANT EXECUTE ON FUNCTION public.normalize_order_number(text) TO anon, authenticated, service_role;

-- ההזמנה של החנות הנוכחית לפי המספר (או null)
CREATE OR REPLACE FUNCTION public.order_by_number(_tenant uuid, _order_number text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id
    FROM public.orders o
   WHERE o.tenant_id = _tenant
     AND upper(o.order_number) = public.normalize_order_number(_order_number)
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.order_by_number(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_by_number(uuid, text) TO service_role;

-- ============================================================
-- 3. פניות "צור קשר"
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID NOT NULL DEFAULT public.current_tenant_id()
                   REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  phone            TEXT NOT NULL CHECK (phone ~ '^\+?[0-9]{9,15}$'),
  email            TEXT NOT NULL CHECK (char_length(email) <= 254
                                        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message          TEXT NOT NULL CHECK (char_length(message) BETWEEN 2 AND 5000),
  order_number     TEXT CHECK (order_number IS NULL OR order_number ~ '^[A-Z0-9_/-]{1,40}$'),
  -- ההזמנה שנמצאה לפי המספר (אם נמצאה)
  order_id         UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  -- קובץ מצורף (דלי contact-attachments, פרטי): <tenant_id>/<id>/<שם>
  attachment_path  TEXT CHECK (attachment_path IS NULL OR char_length(attachment_path) <= 400),
  attachment_name  TEXT CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 200),
  attachment_type  TEXT CHECK (attachment_type IS NULL OR char_length(attachment_type) <= 100),
  attachment_size  INTEGER CHECK (attachment_size IS NULL OR attachment_size BETWEEN 1 AND 5242880),
  -- new: חדשה | handled: טופלה
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled')),
  admin_note       TEXT CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  handled_at       TIMESTAMPTZ,
  handled_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_messages_attachment_check CHECK (
    (attachment_path IS NULL) = (attachment_name IS NULL)
    AND (attachment_path IS NULL) = (attachment_size IS NULL))
);
CREATE INDEX IF NOT EXISTS contact_messages_list_idx
  ON public.contact_messages (tenant_id, status, created_at DESC);

COMMENT ON TABLE public.contact_messages IS
  'פניות מטופס "צור קשר" באתר (חלק 16א) — נשמרות מהשרת בלבד';

-- ============================================================
-- 4. הודעות ביטול עסקה
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cancellation_requests (
  id                   UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            UUID NOT NULL DEFAULT public.current_tenant_id()
                       REFERENCES public.tenants(id) ON DELETE CASCADE,
  first_name           TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 60),
  last_name            TEXT NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 60),
  phone                TEXT NOT NULL CHECK (phone ~ '^\+?[0-9]{9,15}$'),
  email                TEXT NOT NULL CHECK (char_length(email) <= 254
                                            AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  -- סיבת הביטול — לא חובה (החוק לא מחייב את הצרכן לנמק)
  message              TEXT CHECK (message IS NULL OR char_length(message) <= 5000),
  order_number         TEXT NOT NULL CHECK (order_number ~ '^[A-Z0-9_/-]{1,40}$'),
  order_id             UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  -- ההזמנה נמצאה, והאימייל או הטלפון תואמים לפרטי הלקוח בהזמנה
  order_contact_match  BOOLEAN NOT NULL DEFAULT false,
  -- new: חדשה | in_progress: בטיפול | completed: בוצע (העסקה בוטלה) | rejected: נדחתה
  status               TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'in_progress', 'completed', 'rejected')),
  admin_note           TEXT CHECK (admin_note IS NULL OR char_length(admin_note) <= 2000),
  handled_at           TIMESTAMPTZ,
  handled_by           UUID,
  -- נשלח ללקוח מייל "קיבלנו את הודעת הביטול"
  confirmation_sent_at TIMESTAMPTZ,
  -- מועד קבלת ההודעה — זה התאריך הקובע לספירת 14 הימים להחזר
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cancellation_requests_list_idx
  ON public.cancellation_requests (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS cancellation_requests_order_idx
  ON public.cancellation_requests (order_id) WHERE order_id IS NOT NULL;

COMMENT ON TABLE public.cancellation_requests IS
  'הודעות ביטול עסקה מהאתר (חלק 16א) — תיעוד רגולטורי: אין עריכה של פרטי הלקוח ואין מחיקה';

-- ============================================================
-- 5. טיפול של המנהל: סטטוס + הערה; מי ומתי — נקבע במסד
-- ============================================================
CREATE OR REPLACE FUNCTION public.site_inbox_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.admin_note := NULLIF(btrim(COALESCE(NEW.admin_note, '')), '');
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'new' THEN
      NEW.handled_at := NULL;
      NEW.handled_by := NULL;
    ELSE
      NEW.handled_at := now();
      NEW.handled_by := auth.uid();
    END IF;
  ELSE
    NEW.handled_at := OLD.handled_at;
    NEW.handled_by := OLD.handled_by;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contact_messages_touch ON public.contact_messages;
CREATE TRIGGER contact_messages_touch
BEFORE UPDATE ON public.contact_messages
FOR EACH ROW EXECUTE FUNCTION public.site_inbox_touch();

DROP TRIGGER IF EXISTS cancellation_requests_touch ON public.cancellation_requests;
CREATE TRIGGER cancellation_requests_touch
BEFORE UPDATE ON public.cancellation_requests
FOR EACH ROW EXECUTE FUNCTION public.site_inbox_touch();

-- ============================================================
-- 6. RLS: בידוד בין חנויות; המנהל קורא ומעדכן סטטוס / הערה בלבד
-- ============================================================
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.contact_messages;
CREATE POLICY tenant_isolation ON public.contact_messages
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "contact messages readable by admin" ON public.contact_messages;
CREATE POLICY "contact messages readable by admin" ON public.contact_messages
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "contact messages updatable by admin" ON public.contact_messages;
CREATE POLICY "contact messages updatable by admin" ON public.contact_messages
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.contact_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_messages TO authenticated;
GRANT UPDATE (status, admin_note) ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

ALTER TABLE public.cancellation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.cancellation_requests;
CREATE POLICY tenant_isolation ON public.cancellation_requests
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "cancellation requests readable by admin" ON public.cancellation_requests;
CREATE POLICY "cancellation requests readable by admin" ON public.cancellation_requests
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "cancellation requests updatable by admin" ON public.cancellation_requests;
CREATE POLICY "cancellation requests updatable by admin" ON public.cancellation_requests
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.cancellation_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cancellation_requests TO authenticated;
GRANT UPDATE (status, admin_note) ON public.cancellation_requests TO authenticated;
-- גם השרת לא מוחק: תיעוד רגולטורי (נמחק רק עם החנות עצמה)
GRANT SELECT, INSERT, UPDATE ON public.cancellation_requests TO service_role;
REVOKE DELETE, TRUNCATE ON public.cancellation_requests FROM service_role;

-- ============================================================
-- 7. שמירת פנייה — מהשרת בלבד
-- ============================================================
CREATE OR REPLACE FUNCTION public.contact_message_submit(
  _id uuid,
  _full_name text,
  _phone text,
  _email text,
  _message text,
  _order_number text DEFAULT NULL,
  _attachment_path text DEFAULT NULL,
  _attachment_name text DEFAULT NULL,
  _attachment_type text DEFAULT NULL,
  _attachment_size integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _order_no text := public.normalize_order_number(_order_number);
  _order uuid;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _attachment_path IS NOT NULL AND _attachment_path NOT LIKE _tenant::text || '/' || _id::text || '/%' THEN
    RAISE EXCEPTION 'נתיב הקובץ המצורף אינו תקין';
  END IF;
  IF _order_no IS NOT NULL THEN
    _order := public.order_by_number(_tenant, _order_no);
  END IF;

  INSERT INTO public.contact_messages (
    id, tenant_id, full_name, phone, email, message, order_number, order_id,
    attachment_path, attachment_name, attachment_type, attachment_size)
  VALUES (
    _id, _tenant, btrim(COALESCE(_full_name, '')), COALESCE(public.normalize_phone(_phone), ''),
    lower(btrim(COALESCE(_email, ''))), btrim(COALESCE(_message, '')), _order_no, _order,
    _attachment_path, NULLIF(btrim(COALESCE(_attachment_name, '')), ''),
    NULLIF(btrim(COALESCE(_attachment_type, '')), ''), _attachment_size);

  RETURN jsonb_build_object('id', _id, 'order_found', _order IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.contact_message_submit(uuid, text, text, text, text, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_message_submit(uuid, text, text, text, text, text, text, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.cancellation_request_submit(
  _first_name text,
  _last_name text,
  _phone text,
  _email text,
  _message text,
  _order_number text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _order_no text := public.normalize_order_number(_order_number);
  _phone_n text := COALESCE(public.normalize_phone(_phone), '');
  _email_n text := lower(btrim(COALESCE(_email, '')));
  _order public.orders%ROWTYPE;
  _match boolean := false;
  _id uuid;
  _created timestamptz;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _order_no IS NULL THEN
    RAISE EXCEPTION 'יש להזין מספר הזמנה';
  END IF;

  SELECT o.* INTO _order
    FROM public.orders o
   WHERE o.id = public.order_by_number(_tenant, _order_no);
  IF _order.id IS NOT NULL THEN
    -- 05x / +9725x: משווים את 9 הספרות האחרונות
    _match := (_order.customer_email IS NOT NULL AND lower(btrim(_order.customer_email)) = _email_n)
           OR (public.normalize_phone(_order.customer_phone) IS NOT NULL
               AND right(public.normalize_phone(_order.customer_phone), 9) = right(_phone_n, 9));
  END IF;

  INSERT INTO public.cancellation_requests (
    tenant_id, first_name, last_name, phone, email, message, order_number, order_id,
    order_contact_match)
  VALUES (
    _tenant, btrim(COALESCE(_first_name, '')), btrim(COALESCE(_last_name, '')), _phone_n, _email_n,
    NULLIF(btrim(COALESCE(_message, '')), ''), _order_no, _order.id, COALESCE(_match, false))
  RETURNING id, created_at INTO _id, _created;

  -- לשרת בלבד (להתראה למנהל) — לא חוזר לדפדפן: לא חושפים אילו הזמנות קיימות
  RETURN jsonb_build_object('id', _id, 'created_at', _created, 'order_number', _order_no,
                            'order_found', _order.id IS NOT NULL,
                            'contact_match', COALESCE(_match, false));
END $$;
REVOKE ALL ON FUNCTION public.cancellation_request_submit(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancellation_request_submit(text, text, text, text, text, text)
  TO service_role;

-- סימון "נשלח ללקוח אישור במייל" (מהשרת, אחרי שליחה מוצלחת)
CREATE OR REPLACE FUNCTION public.cancellation_request_confirmed(_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.cancellation_requests
     SET confirmation_sent_at = now()
   WHERE id = _id AND tenant_id = public.current_tenant_id();
$$;
REVOKE ALL ON FUNCTION public.cancellation_request_confirmed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancellation_request_confirmed(uuid) TO service_role;

-- ============================================================
-- 8. הזהות המשפטית של החנות — ציבורי
-- ============================================================
-- מפרטי העוסק (tenant_billing_profile); אם עוד לא מולאו — משם העסק ומה-ח.פ
-- שבהגדרות האתר. בלי כתובת ובלי מייל החיובים (אלה לא לציבור).
CREATE OR REPLACE FUNCTION public.store_legal_identity()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (SELECT public.current_tenant_id() AS id)
  SELECT CASE
    WHEN b.tenant_id IS NOT NULL THEN
      jsonb_build_object('source', 'billing_profile', 'business_name', b.company_name,
                         'business_type', b.business_type, 'tax_id', b.tax_id)
    WHEN s.tenant_id IS NOT NULL
         AND (btrim(s.business_name) <> '' OR btrim(s.business_tax_id) <> '') THEN
      jsonb_build_object('source', 'site_settings', 'business_name', btrim(s.business_name),
                         'business_type', NULL, 'tax_id', btrim(s.business_tax_id))
    ELSE NULL
  END
    FROM t
    LEFT JOIN public.tenant_billing_profile b ON b.tenant_id = t.id
    LEFT JOIN public.site_settings s ON s.tenant_id = t.id
   WHERE t.id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.store_legal_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_legal_identity() TO anon, authenticated, service_role;

-- ============================================================
-- 9. מונה "פניות חדשות" לתפריט הניהול
-- ============================================================
CREATE OR REPLACE FUNCTION public.site_inbox_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) OR _tenant IS NULL THEN
    RETURN jsonb_build_object('contact', 0, 'cancellations', 0);
  END IF;
  RETURN jsonb_build_object(
    'contact', (SELECT count(*) FROM public.contact_messages
                 WHERE tenant_id = _tenant AND status = 'new'),
    'cancellations', (SELECT count(*) FROM public.cancellation_requests
                       WHERE tenant_id = _tenant AND status IN ('new', 'in_progress')));
END $$;
REVOKE ALL ON FUNCTION public.site_inbox_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.site_inbox_counts() TO authenticated, service_role;

-- ============================================================
-- 10. דלי פרטי לקבצים מצורפים — רק השרת (service_role) קורא וכותב
-- ============================================================
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('contact-attachments', 'contact-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END $$;

COMMIT;

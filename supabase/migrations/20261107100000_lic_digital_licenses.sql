-- ============================================================
-- LIC-1 — מודול שליחת רישיונות דיגיטליים (Office / Windows). פיילוט: נוריאל מחשבים בלבד.
--
-- מה נוסף:
--   • דגל הפיילוט digital_licenses (מנגנון הדגלים הקיים): פעיל ברמת הפלטפורמה, אבל לא מופעל
--     לאף חנות — ההפעלה לחנות נעשית במפורש בפריסה (tenant_feature_flags), אחרי זיהוי החנות.
--   • license_files          — קבצי מוצר (מדריך PDF / תוכנת התקנה EXE / קבלה PDF). גרסאות שלא
--                              משתנות: החלפת ברירת מחדל יוצרת שורה חדשה, קישורים קיימים נשארים
--                              נעוצים לגרסה שנשלחה.
--   • license_deliveries     — כל שליחה: פרטי הלקוח, המפתח מוצפן (AES-256-GCM בשרת — המסד לא רואה
--                              את המפתח לעולם), 5 תווים אחרונים לתצוגה, טביעת HMAC לזיהוי כפילויות,
--                              סטטוס המייל האמיתי מהספק, ומפתח idempotency ייחודי (מניעת שליחה כפולה).
--   • license_download_links — קישור הורדה: רק SHA-256 של ה-Token נשמר, תוקף, מגבלת הורדות, ביטול.
--   • license_audit          — יומן פעולות (שליחה, צפייה במפתח, קישורים, הורדות, קבצים). לא ניתן לעריכה.
--   • license_link_peek / license_consume_download — בדיקה וצריכה אטומית של הורדה, תמיד בתוך
--     החנות של הבקשה (current_tenant_id); license_set_default_file — החלפת ברירת מחדל אטומית.
--   • דלי אחסון פרטי license-files.
--
-- גישה: כל הטבלאות והפונקציות — service_role בלבד (שרת האפליקציה). RLS מופעל בלי מדיניות לדפדפן,
-- כך שגם הענקה בטעות לא חושפת דבר. הפרדת חנויות: מפתחות זרים מורכבים (tenant_id, id) + נתיב
-- הקובץ חייב להיות בתיקיית החנות + בדיקת tenant בכל פונקציה.
-- Rollback: supabase/rollbacks/20261107100000_lic_digital_licenses.down.sql
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 0. דגל הפיילוט (לא מופעל לאף חנות כאן)
-- ------------------------------------------------------------
INSERT INTO public.platform_feature_flags (key, enabled, description) VALUES
  ('digital_licenses', true,
   'פיילוט: שליחת רישיונות דיגיטליים (Office / Windows) — פעיל רק בחנות שהופעל לה במפורש')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 1. קבצי מוצר
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.license_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT public.current_tenant_id()
               REFERENCES public.tenants(id) ON DELETE CASCADE,
  product      text NOT NULL CHECK (product IN ('office', 'windows')),
  kind         text NOT NULL CHECK (kind IN ('guide', 'installer', 'receipt')),
  storage_path text NOT NULL UNIQUE
               CHECK (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|exe)$'),
  file_name    text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  size_bytes   bigint NOT NULL CHECK (size_bytes > 0),
  is_default   boolean NOT NULL DEFAULT false,
  archived_at  timestamptz,
  uploaded_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- הקובץ תמיד בתיקיית החנות שלו באחסון
  CONSTRAINT license_files_path_in_tenant CHECK (split_part(storage_path, '/', 1) = tenant_id::text),
  -- תוכנת התקנה = EXE; מדריך / קבלה = PDF
  CONSTRAINT license_files_ext_matches_kind CHECK ((kind = 'installer') = (storage_path LIKE '%.exe')),
  -- קבלה היא של שליחה אחת — אף פעם לא ברירת מחדל; קובץ בארכיון אינו ברירת מחדל
  CONSTRAINT license_files_receipt_not_default CHECK (kind <> 'receipt' OR NOT is_default),
  CONSTRAINT license_files_archived_not_default CHECK (NOT (is_default AND archived_at IS NOT NULL)),
  CONSTRAINT license_files_tenant_id_id_key UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS license_files_one_default
  ON public.license_files (tenant_id, product, kind) WHERE is_default;
CREATE INDEX IF NOT EXISTS license_files_tenant_idx
  ON public.license_files (tenant_id, product, kind, created_at DESC);

-- ------------------------------------------------------------
-- 2. שליחות
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.license_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT public.current_tenant_id()
                      REFERENCES public.tenants(id) ON DELETE CASCADE,
  idempotency_key     uuid NOT NULL,
  product             text NOT NULL CHECK (product IN ('office', 'windows')),
  customer_name       text NOT NULL CHECK (char_length(customer_name) BETWEEN 2 AND 120),
  customer_email      text NOT NULL
                      CHECK (char_length(customer_email) <= 254
                             AND customer_email ~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$'
                             AND customer_email = lower(customer_email)),
  customer_phone      text NOT NULL CHECK (customer_phone ~ '^\+?[0-9]{7,15}$'),
  business_id         text CHECK (business_id ~ '^[0-9]{9}$'),
  order_number        text CHECK (char_length(order_number) BETWEEN 1 AND 40),
  -- המפתח: מוצפן בשרת (v1:base64(iv|tag|ciphertext)); המסד לא מקבל אותו לעולם בגלוי
  key_ciphertext      text NOT NULL CHECK (key_ciphertext ~ '^v1:[A-Za-z0-9+/]+=*$'),
  key_tail            text NOT NULL CHECK (char_length(key_tail) BETWEEN 1 AND 6),
  key_fingerprint     text NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  guide_file_id       uuid,
  installer_file_id   uuid,
  receipt_file_id     uuid,
  email_status        text NOT NULL DEFAULT 'pending'
                      CHECK (email_status IN ('pending', 'accepted', 'delivered', 'failed', 'unknown')),
  provider_message_id text CHECK (char_length(provider_message_id) <= 200),
  provider_last_event text CHECK (char_length(provider_last_event) <= 40),
  email_error         text CHECK (char_length(email_error) <= 500),
  status_checked_at   timestamptz,
  send_count          integer NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  sent_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_deliveries_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT license_deliveries_tenant_id_id_key UNIQUE (tenant_id, id),
  -- קבצים רק מאותה חנות
  CONSTRAINT license_deliveries_guide_fk
    FOREIGN KEY (tenant_id, guide_file_id) REFERENCES public.license_files (tenant_id, id),
  CONSTRAINT license_deliveries_installer_fk
    FOREIGN KEY (tenant_id, installer_file_id) REFERENCES public.license_files (tenant_id, id),
  CONSTRAINT license_deliveries_receipt_fk
    FOREIGN KEY (tenant_id, receipt_file_id) REFERENCES public.license_files (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS license_deliveries_tenant_idx
  ON public.license_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS license_deliveries_fingerprint_idx
  ON public.license_deliveries (tenant_id, key_fingerprint);

-- ------------------------------------------------------------
-- 3. קישורי הורדה
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.license_download_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT public.current_tenant_id()
                   REFERENCES public.tenants(id) ON DELETE CASCADE,
  delivery_id      uuid NOT NULL,
  file_id          uuid NOT NULL,
  -- רק SHA-256 של ה-Token (ה-Token עצמו לא נשמר בשום מקום)
  token_hash       text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at       timestamptz NOT NULL,
  max_downloads    integer NOT NULL DEFAULT 3 CHECK (max_downloads BETWEEN 1 AND 10),
  download_count   integer NOT NULL DEFAULT 0,
  revoked_at       timestamptz,
  revoked_reason   text CHECK (revoked_reason IN ('replaced', 'manual')),
  last_download_at timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT license_links_count_range CHECK (download_count BETWEEN 0 AND max_downloads),
  CONSTRAINT license_links_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT license_links_revoked_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT license_links_delivery_fk
    FOREIGN KEY (tenant_id, delivery_id) REFERENCES public.license_deliveries (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT license_links_file_fk
    FOREIGN KEY (tenant_id, file_id) REFERENCES public.license_files (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS license_links_delivery_idx
  ON public.license_download_links (tenant_id, delivery_id, created_at DESC);

-- ------------------------------------------------------------
-- 4. יומן פעולות (append-only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.license_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT public.current_tenant_id()
              REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN (
                'send', 'send_failed', 'resend', 'reveal_key', 'link_created', 'link_revoked',
                'download', 'download_denied', 'file_uploaded', 'file_rejected', 'file_default',
                'file_archived', 'status_refreshed')),
  delivery_id uuid,
  link_id     uuid,
  file_id     uuid,
  -- פרטים בלבד — אף פעם לא מפתח / Token (נאכף בקוד; כאן — רק אובייקט קטן)
  details     jsonb NOT NULL DEFAULT '{}'::jsonb
              CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS license_audit_tenant_idx ON public.license_audit (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS license_audit_delivery_idx
  ON public.license_audit (tenant_id, delivery_id, created_at DESC) WHERE delivery_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.license_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'license_audit is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS license_audit_no_update ON public.license_audit;
CREATE TRIGGER license_audit_no_update
  BEFORE UPDATE ON public.license_audit
  FOR EACH ROW EXECUTE FUNCTION public.license_audit_append_only();

-- ------------------------------------------------------------
-- 5. סוג הקובץ חייב להתאים לשימוש (מדריך / התקנה / קבלה) ולמוצר; קובץ בארכיון לא נבחר מחדש
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.license_check_refs()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _ref   uuid;
  _want  text;
  _f     record;
  _prod  text;
BEGIN
  IF TG_TABLE_NAME = 'license_download_links' THEN
    SELECT d.product INTO _prod
      FROM public.license_deliveries d WHERE d.id = NEW.delivery_id AND d.tenant_id = NEW.tenant_id;
    SELECT f.kind, f.product, f.archived_at INTO _f
      FROM public.license_files f WHERE f.id = NEW.file_id AND f.tenant_id = NEW.tenant_id;
    IF NOT FOUND OR _f.kind <> 'installer' OR _f.product IS DISTINCT FROM _prod THEN
      RAISE EXCEPTION 'license: a download link must point to an installer of the same product and store'
        USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' AND _f.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'license: an archived installer cannot get a new link' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- license_deliveries
  FOREACH _want IN ARRAY ARRAY['guide', 'installer', 'receipt'] LOOP
    _ref := CASE _want WHEN 'guide' THEN NEW.guide_file_id
                       WHEN 'installer' THEN NEW.installer_file_id
                       ELSE NEW.receipt_file_id END;
    CONTINUE WHEN _ref IS NULL;
    -- בעדכון — בודקים רק הפניה שהשתנתה
    IF TG_OP = 'UPDATE' THEN
      CONTINUE WHEN _ref IS NOT DISTINCT FROM (CASE _want WHEN 'guide' THEN OLD.guide_file_id
                                                          WHEN 'installer' THEN OLD.installer_file_id
                                                          ELSE OLD.receipt_file_id END);
    END IF;
    SELECT f.kind, f.product, f.archived_at INTO _f
      FROM public.license_files f WHERE f.id = _ref AND f.tenant_id = NEW.tenant_id;
    IF NOT FOUND OR _f.kind <> _want OR _f.product <> NEW.product OR _f.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'license: % file must be an active % file of this product and store', _want, _want
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS license_deliveries_check_refs ON public.license_deliveries;
CREATE TRIGGER license_deliveries_check_refs
  BEFORE INSERT OR UPDATE OF guide_file_id, installer_file_id, receipt_file_id, product
  ON public.license_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.license_check_refs();
DROP TRIGGER IF EXISTS license_links_check_refs ON public.license_download_links;
CREATE TRIGGER license_links_check_refs
  BEFORE INSERT OR UPDATE OF file_id, delivery_id
  ON public.license_download_links
  FOR EACH ROW EXECUTE FUNCTION public.license_check_refs();

-- ------------------------------------------------------------
-- 6. בדיקת קישור (בלי לצרוך) — תמיד בחנות של הבקשה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.license_link_peek(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _l      record;
BEGIN
  IF _tenant IS NULL OR _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  SELECT l.id, l.delivery_id, l.expires_at, l.max_downloads, l.download_count, l.revoked_at,
         f.storage_path, f.file_name, f.size_bytes, d.product
    INTO _l
    FROM public.license_download_links l
    JOIN public.license_files f ON f.id = l.file_id AND f.tenant_id = l.tenant_id
    JOIN public.license_deliveries d ON d.id = l.delivery_id AND d.tenant_id = l.tenant_id
   WHERE l.token_hash = _token_hash AND l.tenant_id = _tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN _l.revoked_at IS NOT NULL THEN 'revoked'
                  WHEN _l.expires_at <= now() THEN 'expired'
                  WHEN _l.download_count >= _l.max_downloads THEN 'exhausted'
                  ELSE 'valid' END,
    'link_id', _l.id,
    'delivery_id', _l.delivery_id,
    'product', _l.product,
    'file_name', _l.file_name,
    'size_bytes', _l.size_bytes,
    'storage_path', _l.storage_path,
    'downloads', _l.download_count,
    'max_downloads', _l.max_downloads,
    'remaining', greatest(_l.max_downloads - _l.download_count, 0),
    'expires_at', _l.expires_at);
END $$;

-- ------------------------------------------------------------
-- 7. צריכת הורדה — אטומית: UPDATE אחד עם כל התנאים, כך שגם הורדות במקביל לא עוברות את המגבלה
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.license_consume_download(_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _link   public.license_download_links%ROWTYPE;
  _state  text;
BEGIN
  IF _tenant IS NULL OR _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found');
  END IF;

  UPDATE public.license_download_links l
     SET download_count = l.download_count + 1,
         last_download_at = now()
   WHERE l.token_hash = _token_hash
     AND l.tenant_id = _tenant
     AND l.revoked_at IS NULL
     AND l.expires_at > now()
     AND l.download_count < l.max_downloads
  RETURNING l.* INTO _link;

  IF FOUND THEN
    INSERT INTO public.license_audit (tenant_id, action, delivery_id, link_id, file_id, details)
    VALUES (_tenant, 'download', _link.delivery_id, _link.id, _link.file_id,
            jsonb_build_object('download', _link.download_count, 'max', _link.max_downloads));
    RETURN jsonb_build_object(
      'ok', true, 'state', 'valid',
      'link_id', _link.id,
      'downloads', _link.download_count,
      'max_downloads', _link.max_downloads,
      'remaining', _link.max_downloads - _link.download_count,
      'expires_at', _link.expires_at);
  END IF;

  SELECT l.* INTO _link
    FROM public.license_download_links l
   WHERE l.token_hash = _token_hash AND l.tenant_id = _tenant;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found');
  END IF;
  _state := CASE WHEN _link.revoked_at IS NOT NULL THEN 'revoked'
                 WHEN _link.expires_at <= now() THEN 'expired'
                 ELSE 'exhausted' END;
  INSERT INTO public.license_audit (tenant_id, action, delivery_id, link_id, file_id, details)
  VALUES (_tenant, 'download_denied', _link.delivery_id, _link.id, _link.file_id,
          jsonb_build_object('state', _state));
  RETURN jsonb_build_object('ok', false, 'state', _state);
END $$;

-- ------------------------------------------------------------
-- 8. החלפת קובץ ברירת המחדל (מדריך / התקנה) — אטומית, בחנות של הבקשה. שתי החלפות במקביל
--    (אותה חנות, מוצר וסוג) רצות אחת אחרי השנייה (נעילה), כך שתמיד נשארת ברירת מחדל אחת ושתיהן מצליחות.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.license_set_default_file(_file_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _f      record;
BEGIN
  SELECT f.product, f.kind INTO _f
    FROM public.license_files f
   WHERE f.id = _file_id AND f.tenant_id = _tenant;
  IF NOT FOUND OR _f.kind NOT IN ('guide', 'installer') THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('license_default:' || _tenant::text || ':' || _f.product || ':' || _f.kind, 0));
  -- אחרי הנעילה — קריאה מחדש (כל פקודה כאן רואה את מה שהחלפה קודמת כבר שמרה)
  SELECT f.id, f.product, f.kind, f.archived_at INTO _f
    FROM public.license_files f
   WHERE f.id = _file_id AND f.tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND OR _f.archived_at IS NOT NULL THEN
    RETURN false;
  END IF;
  UPDATE public.license_files
     SET is_default = false
   WHERE tenant_id = _tenant AND product = _f.product AND kind = _f.kind
     AND is_default AND id <> _f.id;
  UPDATE public.license_files SET is_default = true WHERE id = _f.id;
  RETURN true;
END $$;

-- ------------------------------------------------------------
-- 9. הרשאות: שרת האפליקציה בלבד
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['license_files', 'license_deliveries', 'license_download_links', 'license_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.license_link_peek(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.license_consume_download(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.license_set_default_file(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.license_check_refs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.license_audit_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.license_link_peek(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.license_consume_download(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.license_set_default_file(uuid) TO service_role;

-- ------------------------------------------------------------
-- 10. דלי אחסון פרטי: PDF / EXE, עד 50MB (מגבלת ברירת המחדל של שירות האחסון)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('license-files', 'license-files', false, 52428800,
            ARRAY['application/pdf', 'application/vnd.microsoft.portable-executable'])
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

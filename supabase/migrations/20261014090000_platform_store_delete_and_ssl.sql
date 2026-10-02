-- ============================================================
-- SaaS מרובה חנויות — חלק 3: מחיקת חנות + מצב תעודות SSL בפאנל
-- ============================================================
-- • platform_delete_tenant: מחיקת חנות וכל המידע שלה (מנהל-על בלבד,
--   לא החנות הראשית, ורק אחרי הקלדת כתובת החנות לאישור). הקשרים לחנות
--   במסד הם ON DELETE RESTRICT (הגנה ממחיקה בטעות), ולכן הפונקציה מוחקת
--   קודם את כל השורות של החנות בכל הטבלאות ורק אז את החנות עצמה — הכל
--   בטרנזקציה אחת: או שהכל נמחק, או ששום דבר.
--   חשבונות ההתחברות והקבצים ב-Storage נמחקים אחר כך בשרת האפליקציה.
-- • tenant_ssl: מצב התעודה של כל חנות, כפי שהשרת מדווח (deploy/ssl/
--   store-certs.sh, כל דקה): תוקף, שגיאה אחרונה, ובקשת חידוש מהפאנל.
--   כשחנות נמחקת השורה נשארת בלי tenant_id — סימן לשרת למחוק את
--   התעודה שלה — והשרת מסיר אותה אחרי שסיים.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. מצב תעודות SSL
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenant_ssl (
  host               TEXT PRIMARY KEY CHECK (host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  tenant_id          UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  -- active: יש תעודה | pending: ממתינה להנפקה | error: ההנפקה נכשלה
  -- blocked: הכתובת שייכת לאתר אחר בשרת | external: תעודה שלא מנוהלת כאן
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('active', 'pending', 'error', 'blocked', 'external')),
  issued_at          TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  last_error         TEXT,
  -- מתי השרת דיווח לאחרונה (אם עבר הרבה זמן — הטיימר בשרת לא רץ)
  checked_at         TIMESTAMPTZ,
  -- לחיצה על "חידוש תעודה" בפאנל; השרת מאפס אחרי שטיפל
  renew_requested_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_ssl_tenant_id_key
  ON public.tenant_ssl (tenant_id) WHERE tenant_id IS NOT NULL;

COMMENT ON TABLE public.tenant_ssl IS 'מצב תעודת ה-SSL של כל חנות — מדווח ע"י deploy/ssl/store-certs.sh';

-- רק השרת (service role) ופונקציות הפלטפורמה ניגשים לטבלה
ALTER TABLE public.tenant_ssl ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_ssl FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ssl TO service_role;

-- מה השרת צריך בכל ריצה: כל החנויות (+ בקשת חידוש), וכתובות של חנויות שנמחקו
CREATE OR REPLACE FUNCTION public.ssl_agent_targets()
RETURNS TABLE(kind text, tenant_id uuid, slug text, is_default boolean, host text,
              renew_requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'store', t.id, t.slug, t.is_default, s.host, s.renew_requested_at
    FROM public.tenants t
    LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id
  UNION ALL
  SELECT 'deleted', NULL, NULL, NULL, s.host, NULL
    FROM public.tenant_ssl s
   WHERE s.tenant_id IS NULL;
$$;
REVOKE ALL ON FUNCTION public.ssl_agent_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ssl_agent_targets() TO service_role;

-- הדיווח של השרת: מצב כל תעודה, ואילו כתובות של חנויות שנמחקו כבר נוקו
CREATE OR REPLACE FUNCTION public.ssl_agent_report(_rows jsonb DEFAULT '[]', _removed text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  _tenant uuid;
  _host text;
  _handled timestamptz;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) LOOP
    _tenant := NULLIF(r->>'tenant_id', '')::uuid;
    _host := lower(r->>'host');
    _handled := NULLIF(r->>'renewal_handled', '')::timestamptz;
    -- החנות נמחקה בין הקריאה לדיווח — אין מה לעדכן
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant);
    -- כתובת החנות השתנתה (למשל חנות ברירת המחדל) — השורה הישנה מתפנה
    DELETE FROM public.tenant_ssl WHERE tenant_id = _tenant AND host <> _host;

    INSERT INTO public.tenant_ssl AS s
           (host, tenant_id, status, issued_at, expires_at, last_error, checked_at)
    VALUES (_host, _tenant, r->>'status',
            NULLIF(r->>'issued_at', '')::timestamptz,
            NULLIF(r->>'expires_at', '')::timestamptz,
            NULLIF(left(r->>'error', 500), ''),
            now())
    ON CONFLICT (host) DO UPDATE
       SET tenant_id  = EXCLUDED.tenant_id,
           status     = EXCLUDED.status,
           issued_at  = EXCLUDED.issued_at,
           expires_at = EXCLUDED.expires_at,
           last_error = EXCLUDED.last_error,
           checked_at = now(),
           -- מאפסים רק את הבקשה שהשרת טיפל בה (לחיצה חדשה בינתיים נשמרת)
           renew_requested_at = CASE
             WHEN _handled IS NOT NULL AND s.renew_requested_at <= _handled THEN NULL
             ELSE s.renew_requested_at
           END;
  END LOOP;

  DELETE FROM public.tenant_ssl
   WHERE tenant_id IS NULL AND host = ANY (COALESCE(_removed, '{}'));
END $$;
REVOKE ALL ON FUNCTION public.ssl_agent_report(jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ssl_agent_report(jsonb, text[]) TO service_role;

-- כפתור "חידוש תעודה" בפאנל — השרת מבצע תוך דקה
CREATE OR REPLACE FUNCTION public.platform_request_ssl_renewal(_tenant uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.tenant_ssl;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לחדש תעודות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO s FROM public.tenant_ssl WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'השרת עוד לא דיווח על התעודה של החנות הזו — נסו שוב בעוד דקה';
  END IF;
  IF s.status = 'blocked' THEN
    RAISE EXCEPTION 'הכתובת % שייכת לאתר אחר בשרת — אין תעודה לחדש', s.host;
  END IF;
  IF s.status = 'external' THEN
    RAISE EXCEPTION 'התעודה של % לא מנוהלת אוטומטית בשרת', s.host;
  END IF;
  UPDATE public.tenant_ssl SET renew_requested_at = now()
   WHERE tenant_id = _tenant
  RETURNING renew_requested_at INTO s.renew_requested_at;
  RETURN s.renew_requested_at;
END $$;
REVOKE ALL ON FUNCTION public.platform_request_ssl_renewal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_request_ssl_renewal(uuid) TO authenticated, service_role;

-- רשימת החנויות בפאנל — עם מצב התעודה
DROP FUNCTION IF EXISTS public.platform_list_tenants();
CREATE FUNCTION public.platform_list_tenants()
RETURNS TABLE(id uuid, slug text, name text, domain text, is_default boolean,
              created_at timestamptz, owner_email text, tax_id text, plan text,
              status text, status_changed_at timestamptz,
              admins integer, customers integer, products integer, orders integer,
              ssl_host text, ssl_status text, ssl_issued_at timestamptz,
              ssl_expires_at timestamptz, ssl_error text, ssl_checked_at timestamptz,
              ssl_renew_requested_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.domain, t.is_default, t.created_at,
         t.owner_email, t.tax_id, t.plan, t.status, t.status_changed_at,
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'admin'),
         (SELECT count(*)::int FROM public.user_roles ur WHERE ur.tenant_id = t.id AND ur.role = 'customer'),
         (SELECT count(*)::int FROM public.global_products gp WHERE gp.tenant_id = t.id),
         (SELECT count(*)::int FROM public.orders o WHERE o.tenant_id = t.id),
         s.host, s.status, s.issued_at, s.expires_at, s.last_error, s.checked_at,
         s.renew_requested_at
    FROM public.tenants t
    LEFT JOIN public.tenant_ssl s ON s.tenant_id = t.id
   WHERE public.is_platform_admin(auth.uid())
   ORDER BY t.is_default DESC, t.created_at;
$$;
REVOKE ALL ON FUNCTION public.platform_list_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_tenants() TO authenticated, service_role;

-- ============================================================
-- 2. מחיקת חנות
-- ============================================================
-- מחזיר: { slug, rows, user_ids } — user_ids = חשבונות ההתחברות של החנות
-- (בלי מנהלי-על), שהשרת מוחק אחר כך מ-Auth.
CREATE OR REPLACE FUNCTION public.platform_delete_tenant(_tenant uuid, _confirm_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.tenants;
  _tables regclass[];
  _tbl regclass;
  _n bigint;
  _total bigint := 0;
  _left text[];
  _pass int;
  _progress boolean;
  _users uuid[];
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול למחוק חנויות' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO t FROM public.tenants WHERE id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  IF t.is_default THEN
    RAISE EXCEPTION 'החנות הראשית של הפלטפורמה לא ניתנת למחיקה' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(btrim(COALESCE(_confirm_slug, ''))) <> t.slug THEN
    RAISE EXCEPTION 'כדי למחוק, יש להקליד את כתובת החנות (%) בדיוק', t.slug
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(array_agg(ur.user_id), '{}') INTO _users
    FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant
     AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = ur.user_id);

  -- כל הטבלאות עם tenant_id (חוץ מ-tenants ומ-tenant_ssl)
  SELECT COALESCE(array_agg(c.oid::regclass ORDER BY c.relname), '{}') INTO _tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname NOT IN ('tenants', 'tenant_ssl');

  -- הטבלאות קשורות זו לזו (מוצר ← קטגוריה, הזמנה ← לקוח…), וחלק מהקשרים
  -- RESTRICT. במקום לתחזק סדר ידני: מוחקים בסבבים — טבלה שעוד יש לה
  -- שורות תלויות מחכה לסבב הבא — עד שלא נשאר כלום.
  FOR _pass IN 1..20 LOOP
    _progress := false;
    _left := '{}';
    FOREACH _tbl IN ARRAY _tables LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', _tbl) USING _tenant;
        GET DIAGNOSTICS _n = ROW_COUNT;
        IF _n > 0 THEN
          _total := _total + _n;
          _progress := true;
        END IF;
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        _left := _left || _tbl::text;
      END;
    END LOOP;
    -- טריגרים יכולים להוסיף שורות בזמן המחיקה — בודקים שבאמת לא נשאר כלום
    IF cardinality(_left) = 0 THEN
      FOREACH _tbl IN ARRAY _tables LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE tenant_id = $1)', _tbl)
          INTO _progress USING _tenant;
        IF _progress THEN
          _left := _left || _tbl::text;
        END IF;
      END LOOP;
      EXIT WHEN cardinality(_left) = 0;
      _progress := true;
    END IF;
    IF NOT _progress THEN
      RAISE EXCEPTION 'המחיקה נעצרה — נשארו שורות שלא ניתן למחוק בטבלאות: %',
        array_to_string(_left, ', ');
    END IF;
  END LOOP;
  IF cardinality(_left) > 0 THEN
    RAISE EXCEPTION 'המחיקה לא הושלמה — נשארו שורות בטבלאות: %', array_to_string(_left, ', ');
  END IF;

  -- tenant_ssl.tenant_id מתאפס → השרת יודע למחוק את התעודה של הכתובת
  DELETE FROM public.tenants WHERE id = _tenant;

  RETURN jsonb_build_object('slug', t.slug, 'rows', _total, 'user_ids', to_jsonb(_users));
END $$;
REVOKE ALL ON FUNCTION public.platform_delete_tenant(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_delete_tenant(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

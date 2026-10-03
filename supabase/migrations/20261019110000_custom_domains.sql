-- ============================================================
-- חלק 9: דומיין מותאם אישית לחנות (למשל www.his-shop.co.il)
--
-- הזרימה:
--   1. מנהל החנות מזין דומיין בפאנל (/admin/settings/domain) → pending
--   2. מוסיף אצל רשם הדומיין רשומת CNAME אל <slug>.nuri1.fit (או A לכתובת
--      השרת), ולוחץ "אימות וחיבור דומיין": השרת בודק את ה-DNS, ורק אם
--      הבדיקה עוברת → verified (custom_domain_verified_at). מכאן הדומיין
--      מנותב לחנות (tenant_for_host).
--   3. סקריפט התעודות בשרת (deploy/ssl/store-certs.sh, כל דקה) קורא את
--      הדומיינים המאומתים (custom_domain_targets), מוסיף אותם ל-nginx,
--      מנפיק תעודת Let's Encrypt ומדווח (custom_domain_report) → active.
--      כשל בהנפקה → error עם ההודעה; ניסיון חוזר אוטומטי.
-- הסטטוסים: pending | verified | active | error
-- רק השרת (service role) מסמן verified / active — לא הדפדפן.
--
-- ניתן להרצה חוזרת.
-- ============================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS custom_domain TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain_status TEXT,
  ADD COLUMN IF NOT EXISTS custom_domain_error TEXT,
  -- מתי אומת ה-DNS (NULL = לא מאומת — הדומיין לא מנותב ואין תעודה)
  ADD COLUMN IF NOT EXISTS custom_domain_verified_at TIMESTAMPTZ,
  -- הדיווח האחרון של סקריפט התעודות
  ADD COLUMN IF NOT EXISTS custom_domain_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS custom_domain_ssl_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS custom_domain_updated_at TIMESTAMPTZ;

-- דומיין אחד לחנות אחת בלבד
CREATE UNIQUE INDEX IF NOT EXISTS tenants_custom_domain_key
  ON public.tenants (custom_domain) WHERE custom_domain IS NOT NULL;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_custom_domain_format_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_custom_domain_format_check CHECK (
  custom_domain IS NULL OR (
    custom_domain = lower(custom_domain)
    AND length(custom_domain) <= 253
    AND custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
  )
);

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_custom_domain_status_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_custom_domain_status_check CHECK (
  (custom_domain IS NULL AND custom_domain_status IS NULL)
  OR (custom_domain IS NOT NULL
      AND custom_domain_status IN ('pending', 'verified', 'active', 'error'))
);

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_custom_domain_error_check;
ALTER TABLE public.tenants ADD CONSTRAINT tenants_custom_domain_error_check CHECK (
  custom_domain_error IS NULL OR length(custom_domain_error) <= 500
);

COMMENT ON COLUMN public.tenants.custom_domain IS
  'דומיין מותאם אישית שמנהל החנות חיבר (www.his-shop.co.il). מנותב לחנות רק אחרי אימות DNS.';
COMMENT ON COLUMN public.tenants.custom_domain_status IS
  'pending = ממתין לאימות DNS | verified = DNS אומת, ממתין לתעודה | active = פעיל עם SSL | error = שגיאה (custom_domain_error)';

-- דומיין מותאם לא יכול להיות הדומיין (tenants.domain) של חנות אחרת, ולהפך
CREATE OR REPLACE FUNCTION public.tenants_domain_conflicts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.custom_domain IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tenants t
        WHERE t.id <> NEW.id AND t.domain = NEW.custom_domain) THEN
    RAISE EXCEPTION 'הדומיין % כבר משמש חנות אחרת', NEW.custom_domain
      USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.domain IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.tenants t
        WHERE t.id <> NEW.id AND t.custom_domain = NEW.domain) THEN
    RAISE EXCEPTION 'הדומיין % כבר משמש חנות אחרת', NEW.domain
      USING ERRCODE = 'unique_violation';
  END IF;
  -- דומיין חדש / שונה — מתחילים מחדש: צריך אימות DNS ותעודה חדשה
  IF TG_OP = 'UPDATE' AND NEW.custom_domain IS DISTINCT FROM OLD.custom_domain THEN
    NEW.custom_domain_verified_at := NULL;
    NEW.custom_domain_checked_at := NULL;
    NEW.custom_domain_ssl_expires_at := NULL;
    NEW.custom_domain_error := NULL;
    NEW.custom_domain_updated_at := now();
    NEW.custom_domain_status := CASE WHEN NEW.custom_domain IS NULL THEN NULL ELSE 'pending' END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tenants_domain_conflicts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_domain_conflicts ON public.tenants;
CREATE TRIGGER tenants_domain_conflicts
BEFORE INSERT OR UPDATE OF domain, custom_domain ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_domain_conflicts();

-- דומיין ← חנות: דומיין מלא (tenants.domain) ← דומיין מותאם מאומת ← תת-דומיין
-- (slug) ← חנות ברירת המחדל. דומיין מותאם שלא אומת לא מנותב לחנות.
CREATE OR REPLACE FUNCTION public.tenant_for_host(_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH h AS (SELECT lower(split_part(btrim(COALESCE(_host, '')), ':', 1)) AS host)
  SELECT COALESCE(
    (SELECT t.id FROM public.tenants t, h WHERE t.domain = h.host),
    (SELECT t.id FROM public.tenants t, h
      WHERE t.custom_domain = h.host AND t.custom_domain_verified_at IS NOT NULL),
    (SELECT t.id FROM public.tenants t, h
      WHERE h.host LIKE '%.%.%' AND t.slug = split_part(h.host, '.', 1)),
    (SELECT t.id FROM public.tenants t WHERE t.is_default)
  );
$$;
REVOKE ALL ON FUNCTION public.tenant_for_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_for_host(text) TO anon, authenticated, service_role;

-- סקריפט התעודות: כל הדומיינים המאומתים (DNS) — להוסיף ל-nginx ולהנפיק תעודה
CREATE OR REPLACE FUNCTION public.custom_domain_targets()
RETURNS TABLE(tenant_id uuid, slug text, custom_domain text, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.custom_domain, t.custom_domain_status
    FROM public.tenants t
   WHERE t.custom_domain IS NOT NULL
     AND t.custom_domain_verified_at IS NOT NULL
   ORDER BY t.custom_domain;
$$;
REVOKE ALL ON FUNCTION public.custom_domain_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_domain_targets() TO service_role;

-- הדיווח של סקריפט התעודות: [{tenant_id, domain, status, expires_at, error}]
--   status = active  → פעיל (תעודה תקפה)
--   status = error   → ההנפקה נכשלה (השגיאה מוצגת למנהל החנות)
--   status = pending → עוד בתהליך (נשאר verified)
-- מעדכן רק אם הדומיין של החנות לא השתנה בינתיים.
CREATE OR REPLACE FUNCTION public.custom_domain_report(_rows jsonb DEFAULT '[]')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  _status text;
  _count integer := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) LOOP
    _status := r->>'status';
    CONTINUE WHEN _status NOT IN ('active', 'error', 'pending');
    UPDATE public.tenants t
       SET custom_domain_status = CASE _status
             WHEN 'active' THEN 'active'
             WHEN 'error' THEN 'error'
             ELSE CASE WHEN t.custom_domain_status = 'active' THEN 'active' ELSE 'verified' END
           END,
           custom_domain_error = CASE WHEN _status = 'error'
             THEN NULLIF(left(COALESCE(r->>'error', ''), 500), '') ELSE NULL END,
           custom_domain_ssl_expires_at = CASE WHEN _status = 'active'
             THEN NULLIF(r->>'expires_at', '')::timestamptz ELSE t.custom_domain_ssl_expires_at END,
           custom_domain_checked_at = now()
     WHERE t.id = NULLIF(r->>'tenant_id', '')::uuid
       AND t.custom_domain = lower(r->>'domain')
       AND t.custom_domain_verified_at IS NOT NULL;
    IF FOUND THEN
      _count := _count + 1;
    END IF;
  END LOOP;
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.custom_domain_report(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_domain_report(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';

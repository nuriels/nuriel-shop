-- ============================================================
-- מפתח Resend לכל חנות — מוגדר פעם אחת בפאנל הפלטפורמה.
--
-- השרת שולח את מיילי החנות (אישורי הזמנה, "ההזמנה נשלחה", איפוס סיסמה…)
-- עם המפתח של החנות; חנות בלי מפתח — עם המפתח הכללי של השרת
-- (RESEND_API_KEY), כמו קודם.
--
-- המפתח הוא סוד: הטבלה סגורה לגמרי ללקוחות, לצוות החנות ולמנהל החנות
-- (אין שום מדיניות RLS — רק service_role בשרת קורא אותה). מנהל הפלטפורמה
-- רואה בפאנל רק אם מוגדר מפתח ואת 4 התווים האחרונים שלו.
--
-- המיגרציה ניתנת להרצה חוזרת.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_secrets (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  resend_api_key TEXT
    CHECK (resend_api_key IS NULL OR resend_api_key ~ '^re_[A-Za-z0-9_-]{8,200}$'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.tenant_secrets IS
  'סודות לכל חנות (מפתח Resend). שרת בלבד — אין גישה מהדפדפן.';

ALTER TABLE public.tenant_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_secrets FROM anon, authenticated;
GRANT ALL ON public.tenant_secrets TO service_role;

-- פאנל הפלטפורמה: לכל חנות — האם מוגדר מפתח, ו-4 התווים האחרונים
CREATE OR REPLACE FUNCTION public.platform_tenant_email_keys()
RETURNS TABLE(tenant_id uuid, has_key boolean, key_hint text, updated_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה רואה את הגדרות המייל של החנויות'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT s.tenant_id,
           s.resend_api_key IS NOT NULL,
           CASE WHEN s.resend_api_key IS NULL THEN NULL
                ELSE '…' || right(s.resend_api_key, 4) END,
           s.updated_at
      FROM public.tenant_secrets s;
END $$;

REVOKE ALL ON FUNCTION public.platform_tenant_email_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_tenant_email_keys() TO authenticated, service_role;

-- שמירה / מחיקה של מפתח החנות (NULL או ריק = מחיקה, חזרה למפתח הכללי).
-- מחזיר את 4 התווים האחרונים (או NULL).
CREATE OR REPLACE FUNCTION public.platform_set_tenant_resend_key(_tenant uuid, _key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _clean text := NULLIF(btrim(COALESCE(_key, '')), '');
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול להגדיר מפתח מייל לחנות'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant) THEN
    RAISE EXCEPTION 'החנות לא נמצאה';
  END IF;
  IF _clean IS NOT NULL AND _clean !~ '^re_[A-Za-z0-9_-]{8,200}$' THEN
    RAISE EXCEPTION 'מפתח Resend מתחיל ב-re_ ומכיל אותיות באנגלית, ספרות, _ ו-- בלבד'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tenant_secrets AS s (tenant_id, resend_api_key, updated_at, updated_by)
  VALUES (_tenant, _clean, now(), auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE
    SET resend_api_key = EXCLUDED.resend_api_key,
        updated_at = now(),
        updated_by = auth.uid();

  RETURN CASE WHEN _clean IS NULL THEN NULL ELSE '…' || right(_clean, 4) END;
END $$;

REVOKE ALL ON FUNCTION public.platform_set_tenant_resend_key(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_tenant_resend_key(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

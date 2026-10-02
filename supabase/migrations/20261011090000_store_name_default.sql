-- ============================================================
-- חנות חדשה מתחילה בלי שם עסק: עד שבעל החנות ממלא אותו בהגדרות האתר,
-- ה-title וה-Open Graph מציגים "החנות שלי" (src/lib/platform.functions.ts).
-- השם שמנהל הפלטפורמה הזין בהקמה נשמר ככותרת האתר (site_title).
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.tenants_seed_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (NEW.id, NEW.name, '')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

COMMIT;

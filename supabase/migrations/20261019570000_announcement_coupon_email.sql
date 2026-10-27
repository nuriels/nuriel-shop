-- ============================================================
-- פס הודעות זז בכותרת האתר + שליחת קופון במייל מהחלון הקופץ
-- ============================================================
-- תוספות בלבד (ברירת מחדל: כבוי — אף חנות לא משתנה עד שמפעילים):
--   * site_settings.announcement_* — טקסט, קופון להקפצה וצבע (שחור / זהב)
--   * coupon_email_sends — רישום שליחה כדי שאותו קופון לא יישלח פעמיים לאותה כתובת
-- דרך חזרה: supabase/rollbacks/20261019570000_announcement_coupon_email.down.sql
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS announcement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS announcement_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS announcement_coupon_code text,
  ADD COLUMN IF NOT EXISTS announcement_style text NOT NULL DEFAULT 'gold';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_announcement_check'
                  AND conrelid = 'public.site_settings'::regclass) THEN
    ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_announcement_check CHECK (
      announcement_style IN ('gold', 'black')
      AND char_length(announcement_text) <= 200
      AND (announcement_coupon_code IS NULL OR announcement_coupon_code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.coupon_email_sends (
  tenant_id   uuid NOT NULL DEFAULT public.current_tenant_id()
              REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) BETWEEN 3 AND 254),
  coupon_code text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email, coupon_code)
);
ALTER TABLE public.coupon_email_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.coupon_email_sends;
CREATE POLICY tenant_isolation ON public.coupon_email_sends
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.coupon_email_sends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.coupon_email_sends TO service_role;

-- תופס את השליחה: true = מותר לשלוח עכשיו (אף פעם לא נשלח), false = כבר נשלח
CREATE OR REPLACE FUNCTION public.coupon_email_claim(_email text, _code text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows integer;
BEGIN
  INSERT INTO public.coupon_email_sends (tenant_id, email, coupon_code)
  VALUES (public.current_tenant_id(), lower(btrim(COALESCE(_email, ''))), upper(btrim(COALESCE(_code, ''))))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  RETURN _rows = 1;
END; $$;

-- שחרור אחרי כשל בשליחה — כדי שאפשר יהיה לנסות שוב
CREATE OR REPLACE FUNCTION public.coupon_email_release(_email text, _code text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.coupon_email_sends
   WHERE tenant_id = public.current_tenant_id()
     AND email = lower(btrim(COALESCE(_email, '')))
     AND coupon_code = upper(btrim(COALESCE(_code, '')));
$$;
REVOKE ALL ON FUNCTION public.coupon_email_claim(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.coupon_email_release(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coupon_email_claim(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.coupon_email_release(text, text) TO service_role;

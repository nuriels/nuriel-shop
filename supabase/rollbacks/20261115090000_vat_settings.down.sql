-- ============================================================
-- Rollback של 20261115090000_vat_settings.sql (מיגרציה 191 — מע"מ לפי סוג העוסק, שיעור מרכזי, צילום בהזמנה)
-- הגנה: נעצר כשנקבע שיעור מרכזי נוסף מעבר ל-18% ההתחלתי (נתון שמנהל הפלטפורמה הזין), או כשיש הזמנה
-- שנשמר בה סוג העוסק (vat_business_type) — rollback היה מוחק צילום מצב של עסקאות. לפני rollback כזה —
-- גיבוי, והחלטה מפורשת.
-- בלי נתונים כאלה: העמודות החדשות (בהזמנות ובהגדרות), הטבלה, הטריגרים והפונקציות נמחקים; שתי הפונקציות
-- של הטריגרים ו-portal_create_store_business חוזרות לגרסה הקודמת מילה במילה. ערכי vat_rate /
-- prices_include_vat שנשמרו בהזמנות ובהגדרות לא משתנים.
-- לפני ה-rollback: האפליקציה חוזרת לגרסה בלי "מע"מ וסוג עוסק".
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$
BEGIN
  IF to_regclass('public.vat_rates') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.vat_rates WHERE effective_from <> DATE '2025-01-01') THEN
    RAISE EXCEPTION 'נקבע שיעור מע"מ מרכזי נוסף — rollback היה מוחק אותו. לא מבוצע';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'vat_business_type') THEN
    IF EXISTS (SELECT 1 FROM public.orders WHERE vat_business_type IS NOT NULL) THEN
      RAISE EXCEPTION 'יש הזמנות עם צילום סוג העוסק — rollback היה מוחק אותו. לא מבוצע (גיבוי + החלטה מפורשת קודם)';
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.platform_vat_rate_cancel(bigint);
DROP FUNCTION IF EXISTS public.platform_vat_rate_schedule(numeric, date, text);
DROP FUNCTION IF EXISTS public.platform_vat_rates();
DROP FUNCTION IF EXISTS public.store_save_vat_settings(text, boolean);
DROP FUNCTION IF EXISTS public.store_vat_profile();

DROP TRIGGER IF EXISTS orders_vat_snapshot_guard ON public.orders;
DROP FUNCTION IF EXISTS public.orders_vat_snapshot_guard();
ALTER TABLE public.orders
  DROP COLUMN IF EXISTS net_amount,
  DROP COLUMN IF EXISTS vat_amount,
  DROP COLUMN IF EXISTS gross_amount,
  DROP COLUMN IF EXISTS vat_business_type;
DROP FUNCTION IF EXISTS public.order_vat_amount(numeric, boolean, numeric);

CREATE OR REPLACE FUNCTION public.orders_vat_from_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT st.business_type, st.vat_rate, st.prices_include_vat INTO s
    FROM public.site_settings st
   WHERE st.tenant_id = NEW.tenant_id;
  IF FOUND THEN
    NEW.vat_rate := CASE WHEN s.business_type = 'exempt' THEN 0
                         ELSE COALESCE(s.vat_rate, 18) END;
    NEW.prices_include_vat := COALESCE(s.prices_include_vat, true);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.site_settings_vat_by_business_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.business_type = 'exempt' THEN
    NEW.vat_rate := 0;
  ELSIF TG_OP = 'UPDATE' AND OLD.business_type = 'exempt'
        AND COALESCE(NEW.vat_rate, 0) = 0 THEN
    NEW.vat_rate := 18;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.portal_create_store_business(
  _email text, _name text, _slug text, _business jsonb)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b jsonb := COALESCE(_business, '{}'::jsonb);
  _legal text;
  _tax text;
  _kind text;
  _phone text;
  _address text;
  _incl boolean;
  t public.tenants;
BEGIN
  IF jsonb_typeof(_b) <> 'object' THEN
    RAISE EXCEPTION 'פרטי העסק חסרים' USING ERRCODE = 'check_violation';
  END IF;
  _legal := btrim(regexp_replace(COALESCE(_b ->> 'legal_name', ''), '\s+', ' ', 'g'));
  _tax := regexp_replace(COALESCE(_b ->> 'tax_id', ''), '[\s-]', '', 'g');
  _kind := COALESCE(_b ->> 'business_type', '');
  _phone := regexp_replace(btrim(COALESCE(_b ->> 'phone', '')), '[^0-9+]', '', 'g');
  _address := btrim(regexp_replace(COALESCE(_b ->> 'address', ''), '\s+', ' ', 'g'));

  IF length(_legal) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם העסק: 2 עד 120 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _kind NOT IN ('authorized', 'exempt', 'company') THEN
    RAISE EXCEPTION 'יש לבחור את סוג העסק' USING ERRCODE = 'check_violation';
  END IF;
  IF _tax !~ '^[0-9]{5,12}$' THEN
    RAISE EXCEPTION 'מספר ח.פ / ע.מ: 5 עד 12 ספרות' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'טלפון לשירות לקוחות: 9 עד 15 ספרות' USING ERRCODE = 'check_violation';
  END IF;
  IF length(_address) > 200 THEN
    RAISE EXCEPTION 'כתובת העסק: עד 200 תווים' USING ERRCODE = 'check_violation';
  END IF;
  _incl := CASE
    WHEN _kind = 'exempt' THEN true
    WHEN jsonb_typeof(_b -> 'prices_include_vat') = 'boolean' THEN (_b ->> 'prices_include_vat')::boolean
    ELSE true
  END;

  -- הפתיחה עצמה — אותה פונקציה (אימות החשבון, מגבלת החנויות, הכתובת, הבעלים)
  t := public.portal_create_store(_email, _name, _slug);

  UPDATE public.site_settings
     SET business_name      = _legal,
         business_tax_id    = _tax,
         business_type      = CASE WHEN _kind = 'exempt' THEN 'exempt' ELSE 'authorized' END,
         prices_include_vat = _incl,
         support_phone      = _phone,
         business_phone     = _phone,
         business_address   = CASE WHEN _address <> '' THEN _address ELSE business_address END,
         business_email     = CASE WHEN btrim(COALESCE(business_email, '')) = ''
                                   THEN lower(btrim(_email)) ELSE business_email END
   WHERE tenant_id = t.id;

  UPDATE public.tenants SET tax_id = _tax WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END $$;

ALTER TABLE public.site_settings
  DROP COLUMN IF EXISTS vat_settings_confirmed_by,
  DROP COLUMN IF EXISTS vat_settings_confirmed_at;

DROP FUNCTION IF EXISTS public.tenant_vat_profile(uuid, date);
DROP FUNCTION IF EXISTS public.vat_rate_on(date);
DROP TABLE IF EXISTS public.vat_rates;
DROP FUNCTION IF EXISTS public.vat_rates_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;

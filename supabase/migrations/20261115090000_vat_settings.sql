-- ============================================================
-- מיגרציה 191: מע"מ לפי סוג העוסק של כל עסק — שיעור מרכזי, צילום מצב בכל הזמנה, הגדרה עצמאית לכל Tenant
--
-- 1. שיעור המע"מ המרכזי (public.vat_rates): ברמת הפלטפורמה, בצד השרת בלבד. ערך התחלתי 18% (מ-1.1.2025).
--    שינוי עתידי נקבע מראש עם תאריך תחילה (רק מנהל הפלטפורמה, רק לתאריך עתידי); שיעור שכבר נכנס לתוקף
--    לא נערך ולא נמחק. כל הזמנה שומרת את השיעור שחל ביום יצירתה, ולכן שינוי עתידי לא משנה היסטוריה.
-- 2. סוג העוסק של כל חנות (site_settings.business_type) — הגדרה עצמאית לכל Tenant, אף פעם לא נגזרת מ-Nuriel:
--      • עוסק פטור: מע"מ 0% נעול. "המחירים כוללים מע"מ" לא רלוונטי (נשמר true = המחיר הוא הסופי).
--      • עוסק מורשה: השיעור המרכזי, והבחירה אם המחירים באתר כוללים מע"מ.
--    השינוי — רק דרך store_save_vat_settings (בעל העסק בלבד), שגם מסמנת שההגדרה אושרה. עדכון ישיר מה-API
--    של סוג העוסק / "כולל מע"מ" נדחה. vat_rate של החנות נגזר תמיד (פטור → 0, מורשה → המרכזי).
--    חנויות קיימות: לא משנים להן כלום. vat_settings_confirmed_at נשאר ריק → בעל העסק רואה בקשה לאשר.
-- 3. הזמנות: בכל הזמנה חדשה (קופה, קופה בחנות, הזמנה ידנית, הצעת מחיר, סל משותף — כולן INSERT ל-orders)
--    נשמרים סוג העוסק, השיעור ו"כולל מע"מ" מהשרת (לא מהדפדפן), ונגזרים במסד: לפני מע"מ / מע"מ / סה"כ
--    (עמודות מחושבות — אותו חישוב כמו order_gross ששימש עד היום לתשלום). אחרי יצירת ההזמנה מצב המע"מ
--    שלה לא משתנה (גם לא בעריכת הזמנה). הזמנות קיימות: הערכים שלהן לא משתנים; סוג העוסק לא נשמר אז
--    (NULL — לא מנחשים), והסכומים המחושבים נגזרים מהערכים השמורים שלהן.
--
-- לא משתנה: order_gross / order_amount_due (הסכום לתשלום), ההנחות, הקופונים, המשלוח והפיקדון — החישוב שלהם
-- כמו קודם. צימרים — לא כאן (אין להם עדיין מע"מ בכלל; ראו docs/billing/vat-report.md).
--
-- Rollback: supabase/rollbacks/20261115090000_vat_settings.down.sql
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. שיעור המע"מ המרכזי
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vat_rates (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate             numeric(5,2) NOT NULL CHECK (rate >= 0 AND rate < 100),
  effective_from   date NOT NULL UNIQUE,
  note             text NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  created_by       uuid,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.vat_rates IS 'מיגרציה 191: שיעור המע"מ המרכזי לפי תאריך תחילה (רק הוספה; רק שיעור עתידי ניתן לביטול)';
INSERT INTO public.vat_rates (rate, effective_from, note)
VALUES (18.00, DATE '2025-01-01', 'שיעור המע"מ בישראל מ-1 בינואר 2025')
ON CONFLICT (effective_from) DO NOTHING;
ALTER TABLE public.vat_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vat_rates FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.vat_rates TO service_role;

CREATE OR REPLACE FUNCTION public.vat_rates_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'שיעור מע"מ לא נערך — קובעים שיעור חדש עם תאריך תחילה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'TRUNCATE' OR OLD.effective_from <= (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'שיעור שכבר נכנס לתוקף לא נמחק' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS vat_rates_guard ON public.vat_rates;
CREATE TRIGGER vat_rates_guard BEFORE UPDATE OR DELETE ON public.vat_rates
  FOR EACH ROW EXECUTE FUNCTION public.vat_rates_guard();
DROP TRIGGER IF EXISTS vat_rates_no_truncate ON public.vat_rates;
CREATE TRIGGER vat_rates_no_truncate BEFORE TRUNCATE ON public.vat_rates
  FOR EACH STATEMENT EXECUTE FUNCTION public.vat_rates_guard();

-- השיעור שחל ביום מסוים (ברירת מחדל: היום בישראל). אין שורה (לא אמור לקרות) → 18
CREATE OR REPLACE FUNCTION public.vat_rate_on(_on date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT r.rate FROM public.vat_rates r
                    WHERE r.effective_from <= COALESCE(_on, (now() AT TIME ZONE 'Asia/Jerusalem')::date)
                    ORDER BY r.effective_from DESC LIMIT 1), 18.00);
$$;

-- ------------------------------------------------------------
-- 2. סוג העוסק של כל חנות — עצמאי, נבחר בידי בעל העסק
-- ------------------------------------------------------------
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS vat_settings_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS vat_settings_confirmed_by uuid;
COMMENT ON COLUMN public.site_settings.vat_settings_confirmed_at IS
  'מיגרציה 191: מתי בעל העסק בחר / אישר את סוג העוסק והגדרת המע"מ. NULL בחנות קיימת = עוד לא אושר';

-- מצב המע"מ של עסק (פנימי): פטור → 0 ו"המחיר סופי"; מורשה → השיעור המרכזי והבחירה של העסק
CREATE OR REPLACE FUNCTION public.tenant_vat_profile(_tenant uuid, _on date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'business_type', COALESCE(s.business_type, 'authorized'),
    'prices_include_vat', CASE WHEN s.business_type = 'exempt' THEN true ELSE COALESCE(s.prices_include_vat, true) END,
    'vat_rate', CASE WHEN s.business_type = 'exempt' THEN 0 ELSE public.vat_rate_on(_on) END,
    'confirmed', s.vat_settings_confirmed_at IS NOT NULL)
  FROM (SELECT 1) one
  LEFT JOIN public.site_settings s ON s.tenant_id = _tenant;
$$;

-- לאתר (גם לאורחים): מצב המע"מ של החנות הנוכחית — מה שהקופה והמסד יחשבו בפועל
CREATE OR REPLACE FUNCTION public.store_vat_profile()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.tenant_vat_profile(public.current_tenant_id(), NULL);
$$;

-- בעל העסק בלבד: שמירת סוג העוסק ו"כולל מע"מ" (מסומן כמאושר). לא משנה אף הזמנה קיימת
CREATE OR REPLACE FUNCTION public.store_save_vat_settings(_business_type text, _prices_include_vat boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _before public.site_settings;
  _incl boolean;
BEGIN
  IF _tenant IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'יש להתחבר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.staff_can('billing.manage') THEN
    RAISE EXCEPTION 'רק בעל העסק משנה את סוג העוסק ואת הגדרות המע"מ' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _business_type IS NULL OR _business_type NOT IN ('exempt', 'authorized') THEN
    RAISE EXCEPTION 'יש לבחור את סוג העוסק: פטור או מורשה' USING ERRCODE = 'check_violation';
  END IF;
  IF _business_type = 'authorized' AND _prices_include_vat IS NULL THEN
    RAISE EXCEPTION 'עוסק מורשה: יש לבחור אם המחירים באתר כוללים מע"מ' USING ERRCODE = 'check_violation';
  END IF;
  _incl := CASE WHEN _business_type = 'exempt' THEN true ELSE _prices_include_vat END;
  SELECT * INTO _before FROM public.site_settings s WHERE s.tenant_id = _tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הגדרות החנות לא נמצאו' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE public.site_settings
     SET business_type = _business_type, prices_include_vat = _incl,
         vat_settings_confirmed_at = now(), vat_settings_confirmed_by = auth.uid()
   WHERE tenant_id = _tenant;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (_tenant, auth.uid(), (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()), 'store_vat_settings_saved',
          jsonb_build_object('business_type', _business_type, 'prices_include_vat', _incl,
            'previous', jsonb_build_object('business_type', _before.business_type,
                                           'prices_include_vat', _before.prices_include_vat,
                                           'confirmed', _before.vat_settings_confirmed_at IS NOT NULL)));
  RETURN public.tenant_vat_profile(_tenant, NULL);
END $$;

-- הגנה + נרמול על כל כתיבה להגדרות החנות:
--   • מה-API (anon / authenticated) אי אפשר לשנות ישירות את סוג העוסק, את "כולל מע"מ" של עוסק מורשה או
--     את סימון האישור — רק דרך store_save_vat_settings (בעל העסק).
--   • vat_rate נגזר תמיד: פטור → 0; מורשה → השיעור המרכזי. פטור → "המחיר סופי" (prices_include_vat = true).
CREATE OR REPLACE FUNCTION public.site_settings_vat_by_business_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND current_user IN ('anon', 'authenticated') THEN
    IF NEW.business_type IS DISTINCT FROM OLD.business_type
       OR (NEW.business_type = 'authorized' AND NEW.prices_include_vat IS DISTINCT FROM OLD.prices_include_vat)
       OR NEW.vat_settings_confirmed_at IS DISTINCT FROM OLD.vat_settings_confirmed_at
       OR NEW.vat_settings_confirmed_by IS DISTINCT FROM OLD.vat_settings_confirmed_by THEN
      RAISE EXCEPTION 'סוג העוסק והגדרות המע"מ נשמרים במסך "מע"מ וסוג עוסק" (בעל העסק בלבד)'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  IF NEW.business_type = 'exempt' THEN
    NEW.vat_rate := 0;
    NEW.prices_include_vat := true;
  ELSE
    NEW.vat_rate := public.vat_rate_on(NULL);
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
         -- מיגרציה 191: סוג העוסק והגדרת המע"מ נבחרו במפורש בפתיחת החנות
         vat_settings_confirmed_at = now(),
         support_phone      = _phone,
         business_phone     = _phone,
         business_address   = CASE WHEN _address <> '' THEN _address ELSE business_address END,
         business_email     = CASE WHEN btrim(COALESCE(business_email, '')) = ''
                                   THEN lower(btrim(_email)) ELSE business_email END
   WHERE tenant_id = t.id;

  UPDATE public.tenants SET tax_id = _tax WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END $$;

-- ------------------------------------------------------------
-- 3. הזמנות: צילום מצב המע"מ ופירוק הסכום — בצד השרת
-- ------------------------------------------------------------
-- המע"מ שבתוך הסכום — אותו עיגול כמו order_gross (סה"כ) ו-calculateVat באפליקציה:
--   כולל מע"מ: מע"מ = סה"כ − עיגול(סה"כ ÷ (1 + שיעור))      לפני מע"מ: מע"מ = עיגול(הסכום × שיעור)
CREATE OR REPLACE FUNCTION public.order_vat_amount(_total numeric, _prices_include_vat boolean, _vat_rate numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN GREATEST(COALESCE(_vat_rate, 18), 0) = 0 THEN 0::numeric
    WHEN COALESCE(_prices_include_vat, true) THEN
      round(COALESCE(_total, 0), 2)
      - round(round(COALESCE(_total, 0), 2) / (1 + GREATEST(COALESCE(_vat_rate, 18), 0) / 100), 2)
    ELSE round(round(COALESCE(_total, 0), 2) * GREATEST(COALESCE(_vat_rate, 18), 0) / 100, 2)
  END;
$$;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vat_business_type text CHECK (vat_business_type IN ('exempt', 'authorized')),
  ADD COLUMN IF NOT EXISTS gross_amount numeric
    GENERATED ALWAYS AS (public.order_gross(total, prices_include_vat, vat_rate)) STORED,
  ADD COLUMN IF NOT EXISTS vat_amount numeric
    GENERATED ALWAYS AS (public.order_vat_amount(total, prices_include_vat, vat_rate)) STORED,
  ADD COLUMN IF NOT EXISTS net_amount numeric
    GENERATED ALWAYS AS (public.order_gross(total, prices_include_vat, vat_rate)
                         - public.order_vat_amount(total, prices_include_vat, vat_rate)) STORED;
COMMENT ON COLUMN public.orders.vat_business_type IS
  'מיגרציה 191: סוג העוסק של החנות ברגע ההזמנה. NULL = הזמנה מלפני 191 (לא נשמר אז)';
COMMENT ON COLUMN public.orders.gross_amount IS 'מיגרציה 191: סה"כ לתשלום (כולל מע"מ אם יש) — מחושב במסד';
COMMENT ON COLUMN public.orders.vat_amount IS 'מיגרציה 191: סכום המע"מ — מחושב במסד';
COMMENT ON COLUMN public.orders.net_amount IS 'מיגרציה 191: הסכום לפני מע"מ — מחושב במסד';

-- הזמנה חדשה: מצב המע"מ מהשרת — סוג העוסק של החנות והשיעור המרכזי ביום ההזמנה. מה שהדפדפן שלח נדרס.
CREATE OR REPLACE FUNCTION public.orders_vat_from_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p jsonb := public.tenant_vat_profile(NEW.tenant_id, NULL);
BEGIN
  NEW.vat_business_type := p ->> 'business_type';
  NEW.vat_rate := (p ->> 'vat_rate')::numeric;
  NEW.prices_include_vat := (p ->> 'prices_include_vat')::boolean;
  RETURN NEW;
END $$;

-- אחרי היצירה מצב המע"מ של ההזמנה לא משתנה — גם לא בעריכת הזמנה ולא בידי מנהל
CREATE OR REPLACE FUNCTION public.orders_vat_snapshot_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.vat_rate IS DISTINCT FROM OLD.vat_rate
     OR NEW.prices_include_vat IS DISTINCT FROM OLD.prices_include_vat
     OR NEW.vat_business_type IS DISTINCT FROM OLD.vat_business_type THEN
    RAISE EXCEPTION 'מצב המע"מ של הזמנה נשמר ברגע יצירתה ואינו משתנה' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_vat_snapshot_guard ON public.orders;
CREATE TRIGGER orders_vat_snapshot_guard BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_vat_snapshot_guard();

-- ------------------------------------------------------------
-- 4. ניהול השיעור המרכזי — מנהל הפלטפורמה בלבד
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_vat_rates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
  _seller jsonb;
BEGIN
  IF NOT COALESCE(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- סוג העוסק של Nuriel כמוכרת (שכבת החיוב, מיגרציה 189) — לתצוגה באותו מסך
  IF to_regprocedure('billing.vat_profile(date)') IS NOT NULL THEN
    EXECUTE 'SELECT billing.vat_profile(NULL)' INTO _seller;
  END IF;
  RETURN jsonb_build_object(
    'today', _today,
    'seller', _seller,
    'current', public.vat_rate_on(_today),
    'rates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'rate', r.rate, 'effective_from', r.effective_from,
                         'note', r.note, 'created_by_email', r.created_by_email, 'created_at', r.created_at,
                         'scheduled', r.effective_from > _today) ORDER BY r.effective_from DESC)
                         FROM public.vat_rates r), '[]'::jsonb));
END $$;

-- שיעור חדש — רק מתאריך עתידי (מחר והלאה). הזמנות והסכמים קיימים לא משתנים
CREATE OR REPLACE FUNCTION public.platform_vat_rate_schedule(_rate numeric, _effective_from date, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _id bigint;
BEGIN
  IF NOT COALESCE(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _rate IS NULL OR _rate < 0 OR _rate >= 100 THEN
    RAISE EXCEPTION 'שיעור מע"מ: 0 עד 99.99' USING ERRCODE = 'check_violation';
  END IF;
  IF _effective_from IS NULL OR _effective_from <= (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'שיעור חדש נקבע מראש, מתאריך עתידי בלבד — לא רטרואקטיבית' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vat_rates r WHERE r.effective_from = _effective_from) THEN
    RAISE EXCEPTION 'כבר נקבע שיעור לתאריך הזה — בטלו אותו קודם' USING ERRCODE = 'unique_violation';
  END IF;
  INSERT INTO public.vat_rates (rate, effective_from, note, created_by, created_by_email)
  VALUES (round(_rate, 2), _effective_from, left(btrim(COALESCE(_note, '')), 300), auth.uid(),
          (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()))
  RETURNING id INTO _id;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (NULL, auth.uid(), (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()), 'vat_rate_scheduled',
          jsonb_build_object('id', _id, 'rate', round(_rate, 2), 'effective_from', _effective_from,
                             'current', public.vat_rate_on(NULL)));
  RETURN public.platform_vat_rates();
END $$;

-- ביטול שיעור שעוד לא נכנס לתוקף
CREATE OR REPLACE FUNCTION public.platform_vat_rate_cancel(_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.vat_rates;
BEGIN
  IF NOT COALESCE(public.is_platform_admin(auth.uid()), false) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM public.vat_rates x WHERE x.id = _id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'השיעור לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  IF r.effective_from <= (now() AT TIME ZONE 'Asia/Jerusalem')::date THEN
    RAISE EXCEPTION 'שיעור שכבר נכנס לתוקף לא מבוטל' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public.vat_rates WHERE id = _id;
  INSERT INTO public.platform_audit_log (tenant_id, actor_id, actor_email, action, details)
  VALUES (NULL, auth.uid(), (SELECT u.email::text FROM auth.users u WHERE u.id = auth.uid()), 'vat_rate_canceled',
          jsonb_build_object('id', r.id, 'rate', r.rate, 'effective_from', r.effective_from));
  RETURN public.platform_vat_rates();
END $$;

-- ------------------------------------------------------------
-- 5. הרשאות הרצה
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.vat_rates_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orders_vat_snapshot_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_vat_profile(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_vat_profile(uuid, date) TO service_role;
-- מספר ציבורי (השיעור החוקי) — גם הטריגר של הגדרות החנות קורא לו בהרשאות המשתמש
REVOKE ALL ON FUNCTION public.vat_rate_on(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vat_rate_on(date) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_vat_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_vat_profile() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.order_vat_amount(numeric, boolean, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_vat_amount(numeric, boolean, numeric) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.store_save_vat_settings(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_save_vat_settings(text, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_vat_rates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_vat_rates() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_vat_rate_schedule(numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_vat_rate_schedule(numeric, date, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.platform_vat_rate_cancel(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_vat_rate_cancel(bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

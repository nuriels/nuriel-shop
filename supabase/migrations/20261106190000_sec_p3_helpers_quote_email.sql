-- ============================================================
-- SEC-P3 (חלק ב'): עוזרים שחושפים מידע, ניחוש קודי קופון, אימייל בשורת התפקיד
-- ------------------------------------------------------------
-- L3: פונקציות עזר שנפתחו לכל משתמש מחובר / לגולש:
--   • product_serial_gap — מלאי של מוצר בכל חנות, בלי בדיקת חנות/תפקיד → רק לשרת (הקוראות שלה
--     ב-SQL הן SECURITY DEFINER; האפליקציה לא קוראת לה).
--   • staff_display_name — שם / שם-משתמש (נגזר מהמייל) של כל חבר בחנות → רק לשרת (כנ"ל;
--     הדפדפן משתמש ב-staff_display_names, שמסנן לצוות בלבד).
--   • can_pick / is_warehouse — פתוחות לגולש (anon) בטעות (המיגרציה המקורית הסירה רק PUBLIC) →
--     הגולש לא; משתמש מחובר — כמו קודם (מדיניות RLS של המחסן משתמשות בהן).
--   • order_coupon_verify — בודקת הזמנה לפי מזהה בלי בדיקת בעלות → גולש מחובר רק להזמנה שלו.
-- L4: hospitality.quote / quote_type — פתוחות ל-API (האתר הציבורי). קריאה ישירה עוקפת את הגבלת
--   הקצב של האפליקציה, והודעת "קוד הקופון לא תקף" הופכת אותן לאורקל לניחוש קודים. עכשיו קוד קופון
--   מתקבל רק מהשרת (service_role, אחרי הגבלת הקצב) או מצוות העסק; בלי קוד — הכול כמו קודם.
-- L6: user_roles.email — שורה שמשתמש מוסיף לעצמו (הרשמה כלקוח מהדפדפן) שומרת את המייל שהדפדפן
--   שלח, בלי בדיקה. עכשיו: המייל של החשבון עצמו (auth.users). שורות שהשרת/הצוות יוצרים — כמו קודם.
-- רק קוד (בלי שינוי שרת/תצורה). מיגרציה מסודרת + Rollback.
-- ============================================================
BEGIN;

-- ---------- L3 ----------
REVOKE EXECUTE ON FUNCTION public.product_serial_gap(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.staff_display_name(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.can_pick(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_warehouse(uuid) FROM anon;

-- order_coupon_verify
CREATE OR REPLACE FUNCTION public.order_coupon_verify(_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  v_products numeric;
  v_min numeric;
BEGIN
  -- SEC-L3: גולש מחובר בודק רק הזמנה שלו (place_order יוצר אותה עם customer_id = auth.uid());
  -- הזמנה של מישהו אחר — יציאה שקטה, בלי לחשוף סכום / קוד קופון. השרת (place_guest_order) — כמו קודם.
  SELECT tenant_id, coupon_code, coupon_min_order, kind, order_source INTO o
    FROM public.orders WHERE id = _order
     AND (customer_id IS NOT DISTINCT FROM auth.uid()
          OR COALESCE(current_setting('role', true), '') NOT IN ('anon', 'authenticated'));
  IF NOT FOUND OR o.kind = 'quote' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(oi.quantity * oi.unit_price)
                    FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0)
    INTO v_products
    FROM public.order_items oi
   WHERE oi.order_id = _order;

  -- חלק 35: מינימום להזמנה מהאתר (סכום המוצרים, לפני משלוח ופיקדון)
  IF COALESCE(o.order_source, 'web') = 'web' THEN
    SELECT s.minimum_order_amount INTO v_min
      FROM public.site_settings s WHERE s.tenant_id = o.tenant_id LIMIT 1;
    IF v_min IS NOT NULL AND v_products < v_min THEN
      RAISE EXCEPTION 'סכום ההזמנה המינימלי באתר הוא ₪% — חסרים עוד ₪% (לפני משלוח)',
        trim_scale(v_min), trim_scale(round(v_min - v_products, 2))
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF o.coupon_code IS NULL OR o.coupon_min_order IS NULL THEN
    RETURN;
  END IF;
  IF v_products < o.coupon_min_order THEN
    RAISE EXCEPTION 'הקופון % תקף בהזמנה של ₪% ומעלה (לפני משלוח) — הוסיפו מוצרים או הסירו את הקופון',
      o.coupon_code, trim_scale(o.coupon_min_order)
      USING ERRCODE = 'check_violation';
  END IF;
END $function$;

-- ---------- L4 ----------
-- quote
CREATE OR REPLACE FUNCTION hospitality.quote(_unit_id uuid, _check_in date, _check_out date, _adults integer DEFAULT 2, _children integer DEFAULT 0, _promo_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality.request_tenant();
  _staff boolean := _t IS NOT NULL AND public.current_tenant_id() = _t AND hospitality.can('bookings')
                    AND hospitality.flag('hospitality_backend_enabled');
BEGIN
  IF NOT _staff THEN
    -- SEC-L4: קוד קופון נבדק רק דרך שרת האתר (מפתח השירות — אחרי הגבלת הקצב של האפליקציה). גולש
    -- שקורא ישירות ל-API לא יכול לנחש קודים בלי הגבלה. בלי קוד — הצעת מחיר ציבורית, כמו קודם.
    IF NULLIF(btrim(COALESCE(_promo_code, '')), '') IS NOT NULL
       AND COALESCE(current_setting('role', true), '') IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'קוד קופון נבדק רק דרך טופס ההזמנה באתר' USING ERRCODE = 'insufficient_privilege';
    END IF;
    _t := hospitality._public_tenant(true);
  END IF;
  RETURN hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, _promo_code, NOT _staff);
END $function$;

-- quote_type
CREATE OR REPLACE FUNCTION hospitality.quote_type(_category_id uuid, _check_in date, _check_out date, _adults integer DEFAULT 2, _children integer DEFAULT 0, _promo_code text DEFAULT NULL::text, _preferred_unit uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _t uuid := hospitality._public_tenant(true);
  _rooms uuid[];
  _room uuid;
  _q jsonb;
  _first jsonb;
BEGIN
  -- SEC-L4: קוד קופון נבדק רק דרך שרת האתר (מפתח השירות — אחרי הגבלת הקצב של האפליקציה). גולש
  -- שקורא ישירות ל-API לא יכול לנחש קודים בלי הגבלה. בלי קוד — הצעת מחיר ציבורית, כמו קודם.
  IF NULLIF(btrim(COALESCE(_promo_code, '')), '') IS NOT NULL
     AND COALESCE(current_setting('role', true), '') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'קוד קופון נבדק רק דרך טופס ההזמנה באתר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _rooms := hospitality._type_rooms(_t, _category_id, _preferred_unit);
  IF cardinality(_rooms) = 0 THEN
    RAISE EXCEPTION 'סוג החדר לא נמצא' USING ERRCODE = 'no_data_found';
  END IF;
  FOREACH _room IN ARRAY _rooms LOOP
    _q := hospitality._quote(_t, _room, _check_in, _check_out, _adults, _children, _promo_code, true);
    IF (_q ->> 'available')::boolean THEN
      RETURN _q || jsonb_build_object('category_id', _category_id);
    END IF;
    _first := COALESCE(_first, _q);
  END LOOP;
  RETURN _first || jsonb_build_object('category_id', _category_id);
END $function$;

-- ---------- L6 ----------
-- הטריגר רץ לפני user_roles_default_username (שם המשתמש נגזר מהמייל) ולפני normalize_user_email.
CREATE OR REPLACE FUNCTION public.user_roles_auth_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _email text;
BEGIN
  -- רק שורה שהמשתמש מוסיף לעצמו (JWT שלו). השרת (service_role) והצוות שמוסיפים חשבון אחר — כמו קודם.
  IF auth.uid() IS NOT NULL AND NEW.user_id = auth.uid() THEN
    SELECT lower(btrim(u.email)) INTO _email FROM auth.users u WHERE u.id = NEW.user_id;
    -- דפדפן תקין שולח user.email ?? "" — אותו ערך בדיוק
    NEW.email := COALESCE(_email, '');
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.user_roles_auth_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_auth_email ON public.user_roles;
CREATE TRIGGER user_roles_auth_email BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_auth_email();

COMMIT;

-- ============================================================
-- Rollback ל-20261106190000_sec_p3_helpers_quote_email.sql: ההרשאות, הפונקציות והטריגר חוזרים
-- לגרסת המקור (סדר ההרשאות כמו במקור, כך שהסכמה זהה).
-- ============================================================
BEGIN;

-- L6
DROP TRIGGER IF EXISTS user_roles_auth_email ON public.user_roles;
DROP FUNCTION IF EXISTS public.user_roles_auth_email();

-- L4: quote_type (גרסת המקור)
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

-- L4: quote (גרסת המקור)
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
    _t := hospitality._public_tenant(true);
  END IF;
  RETURN hospitality._quote(_t, _unit_id, _check_in, _check_out, _adults, _children, _promo_code, NOT _staff);
END $function$;

-- L3: order_coupon_verify (גרסת המקור)
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
  SELECT tenant_id, coupon_code, coupon_min_order, kind, order_source INTO o
    FROM public.orders WHERE id = _order;
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

-- L3: ההרשאות — באותו סדר כמו במקור
REVOKE ALL ON FUNCTION public.is_warehouse(uuid) FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_warehouse(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_warehouse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_warehouse(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.can_pick(uuid) FROM authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_pick(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_pick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_pick(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.staff_display_name(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.staff_display_name(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_display_name(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.product_serial_gap(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.product_serial_gap(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.product_serial_gap(uuid) TO service_role;

COMMIT;

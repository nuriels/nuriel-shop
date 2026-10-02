-- ============================================================
-- משתמש חסום מאבד גישה — גם דרך ה-API, לא רק במסך (06.10.2026)
-- ============================================================
-- נמצא בבדיקת אבטחה: is_admin / is_agent (ולכן is_staff וכל ההרשאות שנשענות
-- עליהן) בדקו רק את התפקיד. מנהל/סוכן חסום המשיך לערוך מוצרים, לקרוא את כל
-- ההזמנות ולשנות הגדרות — כל עוד החיבור שלו לא פג. והלקוח החסום עדיין יכול
-- היה ליצור הזמנה דרך ה-API.
-- עכשיו: חסום = בלי הרשאות צוות, ובלי יצירת הזמנות / שורות הזמנה.
-- המנהל הראשי המוגן לא מושפע (אי אפשר לחסום אותו — guard_protected_admin_update).
-- פעולות שרת (service role, auth.uid() ריק) לא מושפעות. אידמפוטנטי.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'admin' AND NOT is_blocked);
$$;

CREATE OR REPLACE FUNCTION public.is_agent(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'agent' AND NOT is_blocked);
$$;

CREATE OR REPLACE FUNCTION public.reject_blocked_user_orders()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND is_blocked
  ) THEN
    RAISE EXCEPTION 'החשבון חסום — לא ניתן לשלוח הזמנות. לבירור פנו אלינו.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.reject_blocked_user_orders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS orders_reject_blocked_user ON public.orders;
CREATE TRIGGER orders_reject_blocked_user
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.reject_blocked_user_orders();

DROP TRIGGER IF EXISTS order_items_reject_blocked_user ON public.order_items;
CREATE TRIGGER order_items_reject_blocked_user
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.reject_blocked_user_orders();

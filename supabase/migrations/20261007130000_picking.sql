-- ============================================================
-- קובי: ליקוט הזמנות + משתמש "מחסנאי" (07.10.2026)
-- ============================================================
-- התהליך: מנהל מאשר הזמנה (status → picking, כמו היום) → עובד מחסן "לוקח"
-- אותה (נעילה: רק אחד מצליח) → מסמן כל שורה (נשמר מיד) → "אישור ליקוט" →
-- status → shipped. באמצע אפשר להשהות, להעביר לעובד אחר או לשחרר. המנהל יכול
-- לעשות כל פעולה במקום העובד. חוסרים: באישור, הכמות בהזמנה מתעדכנת למה שלוקט
-- (המלאי שלא נלקח חוזר דרך הטריגרים הקיימים), ומה שחסר מוחזר למי שקרא.
-- "מחסנאי" (role = warehouse) — רואה ופועל רק דרך הפונקציות כאן; אין לו גישה
-- לטבלאות הניהול, למחירונים או לקטלוג. לא נכלל ב-is_staff.
-- כל פעולה נרשמת ב-picking_events. אידמפוטנטי.
-- ============================================================

-- ------------------------------------------------------------
-- 1. סוג משתמש חדש
-- ------------------------------------------------------------
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'agent', 'customer', 'warehouse'));

CREATE OR REPLACE FUNCTION public.is_warehouse(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'warehouse' AND NOT is_blocked);
$$;

/** מי רשאי ללקט: מחסנאי או מנהל (לא חסומים) */
CREATE OR REPLACE FUNCTION public.can_pick(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR public.is_warehouse(_user_id);
$$;
REVOKE ALL ON FUNCTION public.is_warehouse(UUID), public.can_pick(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_warehouse(UUID), public.can_pick(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2. שדות ליקוט
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_urgent            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS picker_id            UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS picking_paused       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS picking_claimed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picking_approved_by  UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_picking_idx ON public.orders (status, is_urgent DESC, created_at) WHERE status = 'picking';
CREATE INDEX IF NOT EXISTS orders_picker_idx ON public.orders (picker_id, picked_at);

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS picked      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS picked_qty  INTEGER,
  ADD COLUMN IF NOT EXISTS picked_at   TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.picking_events (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  actor_id    UUID,
  action      TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS picking_events_order_idx ON public.picking_events (order_id, created_at);
REVOKE ALL ON public.picking_events FROM anon, authenticated;
GRANT SELECT ON public.picking_events TO authenticated;
GRANT ALL ON public.picking_events TO service_role;
ALTER TABLE public.picking_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "picking events readable by pickers" ON public.picking_events;
CREATE POLICY "picking events readable by pickers" ON public.picking_events
FOR SELECT TO authenticated USING (public.can_pick(auth.uid()));

CREATE OR REPLACE FUNCTION public.picking_log(_order_id UUID, _action TEXT, _details JSONB DEFAULT '{}'::jsonb)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.picking_events (order_id, actor_id, action, details)
  VALUES (_order_id, auth.uid(), _action, COALESCE(_details, '{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.picking_log(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

/** שם לתצוגה של משתמש צוות */
CREATE OR REPLACE FUNCTION public.staff_display_name(_user_id UUID)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(username), ''), email)
    FROM public.user_roles WHERE user_id = _user_id;
$$;
REVOKE ALL ON FUNCTION public.staff_display_name(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_display_name(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3. בדיקת גישה להזמנה: המלקט שלה, או מנהל
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.picking_assert_order(_order_id UUID, _require_picking BOOLEAN DEFAULT true)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  END IF;
  IF _require_picking AND o.status <> 'picking' THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאת בליקוט';
  END IF;
  IF NOT public.is_admin(auth.uid()) AND o.picker_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ההזמנה בליקוט אצל %', COALESCE(public.staff_display_name(o.picker_id), 'עובד אחר')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN o;
END; $$;
REVOKE ALL ON FUNCTION public.picking_assert_order(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. פעולות
-- ------------------------------------------------------------
/** לקחת הזמנה לליקוט — רק אחד מצליח (העדכון מותנה ב-picker_id IS NULL) */
CREATE OR REPLACE FUNCTION public.picking_claim(_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.orders
     SET picker_id = auth.uid(), picking_claimed_at = now(), picking_paused = false
   WHERE id = _order_id AND status = 'picking' AND picker_id IS NULL;
  IF FOUND THEN
    PERFORM public.picking_log(_order_id, 'claim');
    RETURN;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  ELSIF o.status <> 'picking' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לליקוט';
  ELSIF o.picker_id = auth.uid() THEN
    RETURN; -- כבר אצלי
  ELSE
    RAISE EXCEPTION 'ההזמנה כבר בליקוט אצל %', COALESCE(public.staff_display_name(o.picker_id), 'עובד אחר');
  END IF;
END; $$;

/** שחרור חזרה לרשימה (המלקט או מנהל). הסימונים נשמרים */
CREATE OR REPLACE FUNCTION public.picking_release(_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
BEGIN
  UPDATE public.orders SET picker_id = NULL, picking_paused = false, picking_claimed_at = NULL
   WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'release', jsonb_build_object('from', o.picker_id));
END; $$;

/** העברה לעובד אחר (המלקט או מנהל). הסימונים נשמרים */
CREATE OR REPLACE FUNCTION public.picking_transfer(_order_id UUID, _to_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
BEGIN
  IF _to_user IS NULL OR NOT public.can_pick(_to_user) THEN
    RAISE EXCEPTION 'אפשר להעביר רק לעובד מחסן פעיל';
  END IF;
  IF _to_user = o.picker_id THEN
    RETURN;
  END IF;
  UPDATE public.orders SET picker_id = _to_user, picking_paused = false, picking_claimed_at = now()
   WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'transfer', jsonb_build_object('from', o.picker_id, 'to', _to_user));
END; $$;

/** השהיה / המשך — ההזמנה נשארת אצל המלקט */
CREATE OR REPLACE FUNCTION public.picking_set_paused(_order_id UUID, _paused BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
BEGIN
  IF o.picker_id IS NULL THEN
    RAISE EXCEPTION 'ההזמנה לא נלקחה לליקוט';
  END IF;
  UPDATE public.orders SET picking_paused = _paused WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, CASE WHEN _paused THEN 'pause' ELSE 'resume' END);
END; $$;

/** סימון שורה: כמה לוקט בפועל (NULL = ביטול הסימון). נשמר מיד */
CREATE OR REPLACE FUNCTION public.picking_mark_item(_item_id UUID, _picked_qty INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it public.order_items;
BEGIN
  SELECT * INTO it FROM public.order_items WHERE id = _item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'השורה לא נמצאה';
  END IF;
  IF it.is_deposit THEN
    RAISE EXCEPTION 'פיקדון מתעדכן לבד לפי המוצר';
  END IF;
  PERFORM public.picking_assert_order(it.order_id);
  IF _picked_qty IS NULL THEN
    UPDATE public.order_items SET picked = false, picked_qty = NULL, picked_at = NULL WHERE id = _item_id;
  ELSE
    IF _picked_qty < 0 OR _picked_qty > it.quantity THEN
      RAISE EXCEPTION 'כמות שלוקטה חייבת להיות בין 0 ל-%', it.quantity;
    END IF;
    UPDATE public.order_items SET picked = true, picked_qty = _picked_qty, picked_at = now() WHERE id = _item_id;
  END IF;
  PERFORM public.picking_log(it.order_id, 'item',
    jsonb_build_object('item_id', _item_id, 'product_id', it.product_id, 'ordered', it.quantity, 'picked', _picked_qty));
END; $$;

/** דחוף — רק מנהל. מוצג ראשון, באדום, אצל כל המלקטים */
CREATE OR REPLACE FUNCTION public.set_order_urgent(_order_id UUID, _urgent BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לסמן הזמנה כדחופה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.orders SET is_urgent = _urgent WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, CASE WHEN _urgent THEN 'urgent_on' ELSE 'urgent_off' END);
END; $$;

/**
 * אישור ליקוט (המלקט או מנהל): כל השורות חייבות להיות מסומנות. חוסרים —
 * הכמות בהזמנה מתעדכנת למה שלוקט (0 = השורה יורדת), הפיקדון עוקב, הסכום
 * מתעדכן והמלאי שלא נלקח חוזר (טריגרים קיימים). ואז status → shipped.
 * מחזיר את רשימת החוסרים (למייל ללקוח).
 */
CREATE OR REPLACE FUNCTION public.picking_approve(_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
  unpicked INTEGER;
  shortages JSONB := '[]'::jsonb;
  r RECORD;
  dep RECORD;
BEGIN
  IF o.picker_id IS NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'ההזמנה לא נלקחה לליקוט';
  END IF;
  SELECT count(*) INTO unpicked FROM public.order_items WHERE order_id = _order_id AND NOT is_deposit AND NOT picked;
  IF unpicked > 0 THEN
    RAISE EXCEPTION 'יש % שורות שעוד לא סומנו', unpicked;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = _order_id AND NOT is_deposit AND picked_qty > 0) THEN
    RAISE EXCEPTION 'לא לוקט אף פריט — אם ההזמנה לא יוצאת, בטלו אותה בניהול ההזמנות';
  END IF;

  FOR r IN
    SELECT oi.id, oi.product_id, oi.quantity, oi.picked_qty, gp.name
      FROM public.order_items oi
      LEFT JOIN public.global_products gp ON gp.id = oi.product_id
     WHERE oi.order_id = _order_id AND NOT oi.is_deposit AND oi.picked_qty < oi.quantity
  LOOP
    shortages := shortages || jsonb_build_object(
      'product_id', r.product_id, 'name', r.name, 'ordered', r.quantity, 'picked', r.picked_qty);
    -- הפיקדון של אותו מוצר עוקב אחרי הכמות החדשה (יחס שנשמר מהשורה המקורית)
    FOR dep IN SELECT id, quantity FROM public.order_items WHERE order_id = _order_id AND is_deposit AND product_id = r.product_id LOOP
      IF r.picked_qty = 0 THEN
        DELETE FROM public.order_items WHERE id = dep.id;
      ELSE
        UPDATE public.order_items
           SET quantity = GREATEST(1, round(dep.quantity::numeric * r.picked_qty / r.quantity)::integer)
         WHERE id = dep.id;
      END IF;
    END LOOP;
    IF r.picked_qty = 0 THEN
      DELETE FROM public.order_items WHERE id = r.id;
    ELSE
      UPDATE public.order_items SET quantity = r.picked_qty WHERE id = r.id;
    END IF;
  END LOOP;

  UPDATE public.orders
     SET status = 'shipped', picked_at = now(), picking_paused = false, picking_approved_by = auth.uid()
   WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'approve',
    jsonb_build_object('picker', o.picker_id, 'by_manager', o.picker_id IS DISTINCT FROM auth.uid(), 'shortages', shortages));
  RETURN jsonb_build_object('shortages', shortages, 'picker_id', o.picker_id);
END; $$;

-- ------------------------------------------------------------
-- 5. קריאה: רשימות, שורות, עובדים, סטטיסטיקה (מחסנאי/מנהל בלבד)
-- ------------------------------------------------------------
/** הזמנות בליקוט (+ מה שלוקט ב-45 הימים האחרונים, להיסטוריה) */
CREATE OR REPLACE FUNCTION public.picking_orders()
RETURNS TABLE (
  id UUID, order_number TEXT, status TEXT, is_urgent BOOLEAN, created_at TIMESTAMPTZ, note TEXT,
  picker_id UUID, picker_name TEXT, picking_paused BOOLEAN, picking_claimed_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ, picking_approved_by UUID, approved_by_name TEXT,
  customer_name TEXT, customer_address TEXT, customer_phone TEXT, contact_name TEXT,
  total_lines INTEGER, picked_lines INTEGER, short_lines INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.order_number, o.status, o.is_urgent, o.created_at, o.note,
         o.picker_id, public.staff_display_name(o.picker_id), o.picking_paused, o.picking_claimed_at,
         o.picked_at, o.picking_approved_by, public.staff_display_name(o.picking_approved_by),
         COALESCE(cp.business_name, cp.contact_name, 'לקוח'), cp.business_address, cp.phone, cp.contact_name,
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit AND oi.picked),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit AND oi.picked AND oi.picked_qty < oi.quantity)
    FROM public.orders o
    LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id
   WHERE public.can_pick(auth.uid())
     AND (o.status = 'picking' OR (o.status = 'shipped' AND o.picked_at > now() - interval '45 days'))
   ORDER BY (o.status = 'picking') DESC, o.is_urgent DESC, o.created_at;
$$;

/** שורות הליקוט של הזמנה: מוצר, תמונה, ברקוד, איתור, מארז, כמות, סימון */
CREATE OR REPLACE FUNCTION public.picking_order_lines(_order_id UUID)
RETURNS TABLE (
  item_id UUID, product_id UUID, name TEXT, sku TEXT, barcode TEXT, image_url TEXT,
  shelf_location TEXT, pack_size INTEGER, quantity INTEGER, picked BOOLEAN, picked_qty INTEGER, picked_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.id, oi.product_id, COALESCE(gp.name, 'מוצר'), gp.sku, gp.barcode, gp.image_url,
         NULLIF(btrim(gp.shelf_location), ''), gp.pack_size, oi.quantity, oi.picked, oi.picked_qty, oi.picked_at
    FROM public.order_items oi
    LEFT JOIN public.global_products gp ON gp.id = oi.product_id
   WHERE public.can_pick(auth.uid()) AND oi.order_id = _order_id AND NOT oi.is_deposit
   ORDER BY NULLIF(btrim(gp.shelf_location), '') NULLS LAST, gp.name;
$$;

/** עובדי המחסן (והמנהלים שמחזיקים הזמנות) — ללשוניות "מי מלקט מה" ולהעברה */
CREATE OR REPLACE FUNCTION public.picking_workers()
RETURNS TABLE (user_id UUID, name TEXT, role TEXT, is_blocked BOOLEAN, active_orders INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.role, ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking')
    FROM public.user_roles ur
   WHERE public.can_pick(auth.uid())
     AND (ur.role = 'warehouse'
          OR (ur.role = 'admin' AND EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking')))
   ORDER BY ur.role = 'warehouse' DESC, 2;
$$;

/** כמה הזמנות ליקט עובד: לפי חודש (24 חודשים) ולפי שבוע (16 שבועות). מחסנאי — רק על עצמו */
CREATE OR REPLACE FUNCTION public.picking_stats(_user_id UUID DEFAULT NULL)
RETURNS TABLE (period TEXT, period_start DATE, orders INTEGER, lines INTEGER)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target UUID := COALESCE(_user_id, auth.uid());
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF target <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'מחסנאי רואה רק את הנתונים של עצמו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT 'month', date_trunc('month', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.picker_id = target AND o.status = 'shipped' AND o.picked_at >= date_trunc('month', now()) - interval '23 months'
     GROUP BY 2
    UNION ALL
    SELECT 'week', date_trunc('week', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.picker_id = target AND o.status = 'shipped' AND o.picked_at >= date_trunc('week', now()) - interval '15 weeks'
     GROUP BY 2
    ORDER BY 1, 2;
END; $$;

/** סיכום לכל העובדים (ביצועי סוכנים ועובדים) — מנהל בלבד */
CREATE OR REPLACE FUNCTION public.picking_leaderboard()
RETURNS TABLE (user_id UUID, name TEXT, is_blocked BOOLEAN, this_month INTEGER, last_month INTEGER, total INTEGER, in_progress INTEGER, last_picked_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'shipped' AND o.picked_at >= date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'shipped' AND o.picked_at >= date_trunc('month', now()) - interval '1 month' AND o.picked_at < date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'shipped'),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking'),
         (SELECT max(o.picked_at) FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'shipped')
    FROM public.user_roles ur
   WHERE public.is_admin(auth.uid())
     AND (ur.role = 'warehouse' OR EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id))
   ORDER BY 4 DESC, 2;
$$;

-- הרשאות הפעלה: רק משתמשים מחוברים (בתוך כל פונקציה נבדק can_pick / is_admin)
REVOKE ALL ON FUNCTION
  public.picking_claim(UUID), public.picking_release(UUID), public.picking_transfer(UUID, UUID),
  public.picking_set_paused(UUID, BOOLEAN), public.picking_mark_item(UUID, INTEGER), public.set_order_urgent(UUID, BOOLEAN),
  public.picking_approve(UUID), public.picking_orders(), public.picking_order_lines(UUID), public.picking_workers(),
  public.picking_stats(UUID), public.picking_leaderboard()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.picking_claim(UUID), public.picking_release(UUID), public.picking_transfer(UUID, UUID),
  public.picking_set_paused(UUID, BOOLEAN), public.picking_mark_item(UUID, INTEGER), public.set_order_urgent(UUID, BOOLEAN),
  public.picking_approve(UUID), public.picking_orders(), public.picking_order_lines(UUID), public.picking_workers(),
  public.picking_stats(UUID), public.picking_leaderboard()
  TO authenticated, service_role;

-- ============================================================
-- קובי: אישור מנהל לליקוט + מלאי לפי איתורים + העברה בין איתורים + בדיקת מלאי (07.10.2026)
-- ============================================================
-- 1. מחסנאי שמאשר ליקוט → status 'picked' ("לוקטה — ממתינה לאישור מנהל").
--    המנהל מאשר (→ shipped, ואז המייל ללקוח) או מחזיר לליקוט. מנהל שמאשר
--    ליקוט בעצמו → ישר shipped. 'picked' נחשבת הזמנה פתוחה: המלאי נשאר שמור.
-- 2. מלאי לפי איתורים: product_locations = הכמות **הפנויה** בכל איתור.
--    תמיד: סכום האיתורים = global_products.stock_quantity (המלאי הפנוי).
--    כל שינוי במלאי שאינו העברה (הזמנה, ביטול, ספירה, עדכון ידני) נרשם
--    ב"ראשי" (ירידה שלא מספיקה ב"ראשי" — מהאיתור הגדול הבא). לכן כמות
--    שמורה אף פעם לא נמצאת באף איתור — ואי אפשר להעביר אותה.
-- 3. העברה בין איתורים: טיוטה (כל שורה נשמרת מיד) → אישור מבצע הכל יחד.
--    נבדק בשורה וגם באישור: לא יותר ממה שיש באיתור המקור, לא לאותו איתור.
--    מי שיצר (מחסנאי/מנהל) מאשר; מנהל רואה ומאשר הכל.
-- 4. בדיקת מלאי למחסנאי: חיפוש לפי שם/מק"ט/ברקוד — מלאי, שמור, פנוי ואיתורים.
--    בלי מחירים (הפונקציה לא מחזירה אותם; למחסנאי אין גישה לטבלת המוצרים).
-- אידמפוטנטי.
-- ============================================================

-- ------------------------------------------------------------
-- 1. סטטוס חדש + הפונקציות שמכירות את רשימת הסטטוסים הפתוחים
-- ------------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'agent_review', 'picking', 'picked', 'shipped', 'cancelled'));

CREATE OR REPLACE FUNCTION public.stock_reserved_open()
RETURNS TABLE (product_id UUID, reserved INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.product_id, SUM(oi.reserved_quantity)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE public.is_staff(auth.uid())
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking', 'picked')
     AND NOT oi.is_deposit
     AND oi.reserved_quantity > 0
   GROUP BY oi.product_id;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_count(_count_id UUID)
RETURNS TABLE (counted INTEGER, changed INTEGER, marked_out_of_stock INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD;
  line RECORD;
  p RECORD;
  held INTEGER;
  available INTEGER;
  min_sell INTEGER;
  n_counted INTEGER := 0;
  n_changed INTEGER := 0;
  n_marked INTEGER := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לאשר ספירת מלאי';
  END IF;

  SELECT * INTO c FROM public.stock_counts WHERE id = _count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הספירה לא נמצאה';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'הספירה כבר %', CASE c.status WHEN 'applied' THEN 'אושרה' ELSE 'בוטלה' END;
  END IF;

  PERFORM set_config('kobi.stock_internal', 'on', true);

  FOR line IN
    SELECT * FROM public.stock_count_lines WHERE count_id = _count_id ORDER BY product_id
  LOOP
    SELECT id, stock_quantity, pack_size, is_out_of_stock, out_of_stock_auto INTO p
      FROM public.global_products WHERE id = line.product_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(oi.reserved_quantity), 0)::integer INTO held
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.product_id = p.id
       AND o.kind = 'order'
       AND o.status IN ('pending', 'agent_review', 'picking', 'picked')
       AND NOT oi.is_deposit;

    available := GREATEST(line.counted_units - held, 0);
    min_sell := CASE WHEN p.pack_size IS NOT NULL AND p.pack_size >= 2 THEN p.pack_size ELSE 1 END;
    n_counted := n_counted + 1;
    IF available <> p.stock_quantity THEN
      n_changed := n_changed + 1;
    END IF;

    IF available < min_sell THEN
      IF NOT p.is_out_of_stock THEN
        n_marked := n_marked + 1;
        UPDATE public.global_products
           SET stock_quantity = available, is_out_of_stock = true, out_of_stock_auto = true
         WHERE id = p.id;
      ELSE
        UPDATE public.global_products SET stock_quantity = available WHERE id = p.id;
      END IF;
    ELSIF p.is_out_of_stock AND p.out_of_stock_auto THEN
      UPDATE public.global_products
         SET stock_quantity = available, is_out_of_stock = false, out_of_stock_auto = false
       WHERE id = p.id;
    ELSE
      UPDATE public.global_products SET stock_quantity = available WHERE id = p.id;
    END IF;

    UPDATE public.stock_count_lines
       SET recorded_before = p.stock_quantity, reserved_open = held, applied_quantity = available
     WHERE id = line.id;
  END LOOP;

  UPDATE public.stock_counts
     SET status = 'applied', applied_by = auth.uid(), applied_at = now()
   WHERE id = _count_id;

  PERFORM set_config('kobi.stock_internal', 'off', true);
  RETURN QUERY SELECT n_counted, n_changed, n_marked;
END; $$;

-- ------------------------------------------------------------
-- 2. ליקוט: אישור המחסנאי → 'picked'; אישור מנהל → 'shipped'; החזרה לליקוט
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.picking_approve(_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
  unpicked INTEGER;
  shortages JSONB := '[]'::jsonb;
  r RECORD;
  dep RECORD;
  by_admin BOOLEAN := public.is_admin(auth.uid());
  final_status TEXT;
BEGIN
  IF o.picker_id IS NULL AND NOT by_admin THEN
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

  -- מנהל שמאשר בעצמו — ישר "נשלחה"; מחסנאי — ממתינה לאישור מנהל
  final_status := CASE WHEN by_admin THEN 'shipped' ELSE 'picked' END;
  UPDATE public.orders
     SET status = final_status, picked_at = now(), picking_paused = false,
         picking_approved_by = CASE WHEN by_admin THEN auth.uid() ELSE NULL END
   WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'approve',
    jsonb_build_object('picker', o.picker_id, 'by_manager', by_admin, 'status', final_status, 'shortages', shortages));
  RETURN jsonb_build_object('shortages', shortages, 'picker_id', o.picker_id, 'status', final_status);
END; $$;

/** אישור מנהל לליקוט שבוצע → "נשלחה / בוצעה" (ואז המייל ללקוח) */
CREATE OR REPLACE FUNCTION public.picking_manager_approve(_order_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
  shortages JSONB;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל מאשר ליקוט שבוצע' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'picked' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לאישור ליקוט';
  END IF;
  UPDATE public.orders SET status = 'shipped', picking_approved_by = auth.uid() WHERE id = _order_id;
  SELECT details -> 'shortages' INTO shortages FROM public.picking_events
   WHERE order_id = _order_id AND action = 'approve' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.picking_log(_order_id, 'manager_approve');
  RETURN jsonb_build_object('shortages', COALESCE(shortages, '[]'::jsonb), 'status', 'shipped');
END; $$;

/** המנהל מחזיר ליקוט שבוצע לליקוט (לתיקון) — אצל אותו מלקט, הסימונים נשמרים */
CREATE OR REPLACE FUNCTION public.picking_return(_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o public.orders;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל מחזיר לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'picked' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לאישור ליקוט';
  END IF;
  UPDATE public.orders SET status = 'picking', picked_at = NULL, picking_paused = false WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'returned');
END; $$;

-- הרשימה כוללת עכשיו גם 'picked' (ליקוטים שבוצעו)
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
         (SELECT count(*)::int FROM public.picking_events e, jsonb_array_elements(e.details -> 'shortages') s
           WHERE e.order_id = o.id AND e.action = 'approve'
             AND e.created_at = (SELECT max(e2.created_at) FROM public.picking_events e2 WHERE e2.order_id = o.id AND e2.action = 'approve'))
         + (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit AND oi.picked AND oi.picked_qty < oi.quantity)
    FROM public.orders o
    LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id
   WHERE public.can_pick(auth.uid())
     AND (o.status IN ('picking', 'picked') OR (o.status = 'shipped' AND o.picked_at > now() - interval '45 days'))
   ORDER BY CASE o.status WHEN 'picking' THEN 0 WHEN 'picked' THEN 1 ELSE 2 END, o.is_urgent DESC, o.created_at;
$$;

-- הסטטיסטיקה: הליקוט נזקף למלקט ברגע שאישר (גם לפני אישור המנהל)
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
     WHERE o.picker_id = target AND o.status IN ('picked', 'shipped') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('month', now()) - interval '23 months'
     GROUP BY 2
    UNION ALL
    SELECT 'week', date_trunc('week', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.picker_id = target AND o.status IN ('picked', 'shipped') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('week', now()) - interval '15 weeks'
     GROUP BY 2
    ORDER BY 1, 2;
END; $$;

CREATE OR REPLACE FUNCTION public.picking_leaderboard()
RETURNS TABLE (user_id UUID, name TEXT, is_blocked BOOLEAN, this_month INTEGER, last_month INTEGER, total INTEGER, in_progress INTEGER, last_picked_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at >= date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at >= date_trunc('month', now()) - interval '1 month' AND o.picked_at < date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at IS NOT NULL),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking'),
         (SELECT max(o.picked_at) FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped'))
    FROM public.user_roles ur
   WHERE public.is_admin(auth.uid())
     AND (ur.role = 'warehouse' OR EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id))
   ORDER BY 4 DESC, 2;
$$;

-- ------------------------------------------------------------
-- 3. מלאי לפי איתורים
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_locations (
  product_id UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  location   TEXT NOT NULL CHECK (length(btrim(location)) BETWEEN 1 AND 40),
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, location)
);
CREATE INDEX IF NOT EXISTS product_locations_location_idx ON public.product_locations (location);
REVOKE ALL ON public.product_locations FROM anon, authenticated;
GRANT SELECT ON public.product_locations TO authenticated;
GRANT ALL ON public.product_locations TO service_role;
ALTER TABLE public.product_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product locations readable by warehouse and admin" ON public.product_locations;
CREATE POLICY "product locations readable by warehouse and admin" ON public.product_locations
FOR SELECT TO authenticated USING (public.can_pick(auth.uid()));

CREATE OR REPLACE FUNCTION public.normalize_location(_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(regexp_replace(btrim(COALESCE(_name, '')), '\s+', ' ', 'g')), '');
$$;

/** מחיל שינוי במלאי הפנוי על האיתורים: עלייה → "ראשי"; ירידה → "ראשי" ואז מהגדול הבא */
CREATE OR REPLACE FUNCTION public.locations_apply_delta(_product_id UUID, _delta INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  need INTEGER;
  take INTEGER;
  loc RECORD;
BEGIN
  IF _delta = 0 THEN
    RETURN;
  END IF;
  IF _delta > 0 THEN
    INSERT INTO public.product_locations (product_id, location, quantity)
    VALUES (_product_id, 'ראשי', _delta)
    ON CONFLICT (product_id, location)
    DO UPDATE SET quantity = public.product_locations.quantity + EXCLUDED.quantity, updated_at = now();
    RETURN;
  END IF;
  need := -_delta;
  FOR loc IN
    SELECT location, quantity FROM public.product_locations
     WHERE product_id = _product_id AND quantity > 0
     ORDER BY (location = 'ראשי') DESC, quantity DESC
     FOR UPDATE
  LOOP
    EXIT WHEN need <= 0;
    take := LEAST(need, loc.quantity);
    UPDATE public.product_locations SET quantity = quantity - take, updated_at = now()
     WHERE product_id = _product_id AND location = loc.location;
    need := need - take;
  END LOOP;
  DELETE FROM public.product_locations WHERE product_id = _product_id AND quantity = 0 AND location <> 'ראשי';
END; $$;
REVOKE ALL ON FUNCTION public.locations_apply_delta(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.products_sync_locations()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.stock_quantity, 0) > 0 THEN
      PERFORM public.locations_apply_delta(NEW.id, NEW.stock_quantity);
    END IF;
  ELSIF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
    PERFORM public.locations_apply_delta(NEW.id, COALESCE(NEW.stock_quantity, 0) - COALESCE(OLD.stock_quantity, 0));
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS global_products_sync_locations ON public.global_products;
CREATE TRIGGER global_products_sync_locations
AFTER INSERT OR UPDATE OF stock_quantity ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.products_sync_locations();

-- אתחול חד-פעמי: המלאי הקיים לאיתור שכבר מוגדר למוצר (shelf_location), אחרת "ראשי".
-- ובכל הרצה: יישור מוצר שסכום האיתורים שלו לא שווה למלאי (ההפרש ל"ראשי").
INSERT INTO public.product_locations (product_id, location, quantity)
SELECT gp.id, COALESCE(public.normalize_location(gp.shelf_location), 'ראשי'), gp.stock_quantity
  FROM public.global_products gp
 WHERE gp.stock_quantity > 0
   AND NOT EXISTS (SELECT 1 FROM public.product_locations pl WHERE pl.product_id = gp.id)
ON CONFLICT DO NOTHING;
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT gp.id, gp.stock_quantity - COALESCE((SELECT SUM(quantity) FROM public.product_locations pl WHERE pl.product_id = gp.id), 0) AS diff
      FROM public.global_products gp
  LOOP
    IF r.diff <> 0 THEN
      PERFORM public.locations_apply_delta(r.id, r.diff);
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4. העברות בין איתורים (טיוטה → אישור)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.location_transfers (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  note         TEXT,
  created_by   UUID NOT NULL REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by  UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.location_transfer_lines (
  id            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transfer_id   UUID NOT NULL REFERENCES public.location_transfers(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  from_location TEXT NOT NULL,
  to_location   TEXT NOT NULL,
  quantity      INTEGER NOT NULL CHECK (quantity > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_location <> to_location)
);
CREATE INDEX IF NOT EXISTS location_transfers_status_idx ON public.location_transfers (status, created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS location_transfer_lines_transfer_idx ON public.location_transfer_lines (transfer_id);
REVOKE ALL ON public.location_transfers, public.location_transfer_lines FROM anon, authenticated;
GRANT ALL ON public.location_transfers, public.location_transfer_lines TO service_role;
ALTER TABLE public.location_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_transfer_lines ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.transfer_assert(_transfer_id UUID, _draft BOOLEAN DEFAULT true)
RETURNS public.location_transfers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.location_transfers;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה להעברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM public.location_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההעברה לא נמצאה';
  END IF;
  IF t.created_by <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'זו העברה של עובד אחר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _draft AND t.status <> 'draft' THEN
    RAISE EXCEPTION 'ההעברה כבר %', CASE t.status WHEN 'approved' THEN 'אושרה' ELSE 'בוטלה' END;
  END IF;
  RETURN t;
END; $$;
REVOKE ALL ON FUNCTION public.transfer_assert(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

/** כמה אפשר להוציא מאיתור, בניכוי שורות אחרות באותה טיוטה מאותו מוצר ואיתור */
CREATE OR REPLACE FUNCTION public.transfer_available(_transfer_id UUID, _product_id UUID, _from TEXT, _except_line UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT quantity FROM public.product_locations WHERE product_id = _product_id AND location = _from), 0)
       - COALESCE((SELECT SUM(quantity) FROM public.location_transfer_lines
                    WHERE transfer_id = _transfer_id AND product_id = _product_id AND from_location = _from
                      AND id IS DISTINCT FROM _except_line), 0)::integer;
$$;
REVOKE ALL ON FUNCTION public.transfer_available(UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transfer_create(_note TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id UUID;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה להעברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.location_transfers (created_by, note) VALUES (auth.uid(), NULLIF(btrim(COALESCE(_note, '')), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;

/** הוספה / עדכון של שורה בטיוטה — נשמר מיד, ונבדק מול מה שיש באיתור המקור */
CREATE OR REPLACE FUNCTION public.transfer_line_save(
  _transfer_id UUID, _line_id UUID, _product_id UUID, _from TEXT, _to TEXT, _quantity INTEGER
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.location_transfers := public.transfer_assert(_transfer_id);
  src TEXT := public.normalize_location(_from);
  dst TEXT := public.normalize_location(_to);
  avail INTEGER;
  saved UUID;
BEGIN
  IF src IS NULL THEN RAISE EXCEPTION 'יש לבחור איתור מקור'; END IF;
  IF dst IS NULL THEN RAISE EXCEPTION 'יש לבחור או להקליד איתור יעד'; END IF;
  IF length(dst) > 40 THEN RAISE EXCEPTION 'שם האיתור ארוך מדי (עד 40 תווים)'; END IF;
  IF src = dst THEN RAISE EXCEPTION 'איתור היעד זהה לאיתור המקור'; END IF;
  IF _quantity IS NULL OR _quantity < 1 THEN RAISE EXCEPTION 'הכמות להעברה חייבת להיות לפחות 1'; END IF;
  avail := public.transfer_available(_transfer_id, _product_id, src, _line_id);
  IF _quantity > avail THEN
    RAISE EXCEPTION 'אפשר להעביר מ"%" עד % יח׳ (כמות שמורה להזמנות לא ניתנת להעברה)', src, GREATEST(avail, 0);
  END IF;
  IF _line_id IS NULL THEN
    INSERT INTO public.location_transfer_lines (transfer_id, product_id, from_location, to_location, quantity)
    VALUES (_transfer_id, _product_id, src, dst, _quantity) RETURNING id INTO saved;
  ELSE
    UPDATE public.location_transfer_lines
       SET product_id = _product_id, from_location = src, to_location = dst, quantity = _quantity
     WHERE id = _line_id AND transfer_id = _transfer_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN RAISE EXCEPTION 'השורה לא נמצאה'; END IF;
  END IF;
  UPDATE public.location_transfers SET updated_at = now() WHERE id = _transfer_id;
  RETURN saved;
END; $$;

CREATE OR REPLACE FUNCTION public.transfer_line_delete(_line_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid UUID;
BEGIN
  SELECT transfer_id INTO tid FROM public.location_transfer_lines WHERE id = _line_id;
  IF tid IS NULL THEN RETURN; END IF;
  PERFORM public.transfer_assert(tid);
  DELETE FROM public.location_transfer_lines WHERE id = _line_id;
  UPDATE public.location_transfers SET updated_at = now() WHERE id = tid;
END; $$;

CREATE OR REPLACE FUNCTION public.transfer_cancel(_transfer_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.location_transfers := public.transfer_assert(_transfer_id);
BEGIN
  UPDATE public.location_transfers SET status = 'cancelled', updated_at = now() WHERE id = _transfer_id;
END; $$;

/** אישור: בודק שוב את כל השורות מול המלאי של עכשיו, ומבצע את כולן יחד (או אף אחת) */
CREATE OR REPLACE FUNCTION public.transfer_approve(_transfer_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.location_transfers := public.transfer_assert(_transfer_id);
  g RECORD;
  l RECORD;
  n INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.location_transfer_lines WHERE transfer_id = _transfer_id) THEN
    RAISE EXCEPTION 'אין שורות בהעברה';
  END IF;
  -- נעילת השורות של המוצרים המעורבים, ובדיקה מצטברת לכל מוצר+איתור מקור
  PERFORM 1 FROM public.product_locations pl
    WHERE pl.product_id IN (SELECT product_id FROM public.location_transfer_lines WHERE transfer_id = _transfer_id)
    ORDER BY pl.product_id, pl.location FOR UPDATE;
  FOR g IN
    SELECT tl.product_id, tl.from_location, SUM(tl.quantity)::int AS qty, max(gp.name) AS name,
           COALESCE((SELECT quantity FROM public.product_locations pl WHERE pl.product_id = tl.product_id AND pl.location = tl.from_location), 0) AS have
      FROM public.location_transfer_lines tl JOIN public.global_products gp ON gp.id = tl.product_id
     WHERE tl.transfer_id = _transfer_id
     GROUP BY tl.product_id, tl.from_location
  LOOP
    IF g.qty > g.have THEN
      RAISE EXCEPTION 'לא ניתן לאשר: "%" — ב"%" יש עכשיו % יח׳ פנויות, וההעברה מבקשת %', g.name, g.from_location, g.have, g.qty;
    END IF;
  END LOOP;
  FOR l IN SELECT * FROM public.location_transfer_lines WHERE transfer_id = _transfer_id ORDER BY created_at LOOP
    UPDATE public.product_locations SET quantity = quantity - l.quantity, updated_at = now()
     WHERE product_id = l.product_id AND location = l.from_location;
    INSERT INTO public.product_locations (product_id, location, quantity) VALUES (l.product_id, l.to_location, l.quantity)
    ON CONFLICT (product_id, location) DO UPDATE SET quantity = public.product_locations.quantity + EXCLUDED.quantity, updated_at = now();
    n := n + 1;
  END LOOP;
  DELETE FROM public.product_locations
   WHERE quantity = 0 AND location <> 'ראשי'
     AND product_id IN (SELECT product_id FROM public.location_transfer_lines WHERE transfer_id = _transfer_id);
  UPDATE public.location_transfers SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   WHERE id = _transfer_id;
  RETURN n;
END; $$;

/** רשימת העברות: מחסנאי — שלו; מנהל — של כולם */
CREATE OR REPLACE FUNCTION public.transfers_list(_status TEXT)
RETURNS TABLE (id UUID, status TEXT, note TEXT, created_by UUID, created_by_name TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
               approved_by_name TEXT, approved_at TIMESTAMPTZ, lines INTEGER, units INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.status, t.note, t.created_by, public.staff_display_name(t.created_by), t.created_at, t.updated_at,
         public.staff_display_name(t.approved_by), t.approved_at,
         (SELECT count(*)::int FROM public.location_transfer_lines l WHERE l.transfer_id = t.id),
         (SELECT COALESCE(SUM(quantity), 0)::int FROM public.location_transfer_lines l WHERE l.transfer_id = t.id)
    FROM public.location_transfers t
   WHERE public.can_pick(auth.uid())
     AND t.status = _status
     AND (t.created_by = auth.uid() OR public.is_admin(auth.uid()))
     AND (t.status = 'draft' OR t.updated_at > now() - interval '120 days')
   ORDER BY t.updated_at DESC
   LIMIT 200;
$$;

CREATE OR REPLACE FUNCTION public.transfer_lines(_transfer_id UUID)
RETURNS TABLE (id UUID, product_id UUID, name TEXT, sku TEXT, barcode TEXT, image_url TEXT, pack_size INTEGER,
               from_location TEXT, to_location TEXT, quantity INTEGER, available INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.product_id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.pack_size,
         l.from_location, l.to_location, l.quantity,
         COALESCE((SELECT quantity FROM public.product_locations pl WHERE pl.product_id = l.product_id AND pl.location = l.from_location), 0)
    FROM public.location_transfer_lines l
    JOIN public.location_transfers t ON t.id = l.transfer_id
    JOIN public.global_products gp ON gp.id = l.product_id
   WHERE public.can_pick(auth.uid()) AND l.transfer_id = _transfer_id
     AND (t.created_by = auth.uid() OR public.is_admin(auth.uid()))
   ORDER BY l.created_at;
$$;

-- ------------------------------------------------------------
-- 5. בדיקת מלאי (בלי מחירים) + רשימת איתורים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stock_lookup(_query TEXT)
RETURNS TABLE (id UUID, name TEXT, sku TEXT, barcode TEXT, image_url TEXT, category TEXT, pack_size INTEGER,
               is_hidden BOOLEAN, available INTEGER, reserved INTEGER, locations JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (SELECT btrim(COALESCE(_query, '')) AS t)
  SELECT gp.id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.category, gp.pack_size, gp.is_hidden,
         gp.stock_quantity,
         COALESCE((SELECT SUM(oi.reserved_quantity)::int FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                    WHERE oi.product_id = gp.id AND NOT oi.is_deposit AND o.kind = 'order'
                      AND o.status IN ('pending', 'agent_review', 'picking', 'picked')), 0),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('location', pl.location, 'quantity', pl.quantity)
                                    ORDER BY (pl.location = 'ראשי') DESC, pl.quantity DESC)
                     FROM public.product_locations pl WHERE pl.product_id = gp.id AND pl.quantity > 0), '[]'::jsonb)
    FROM public.global_products gp, q
   WHERE public.can_pick(auth.uid())
     AND length(q.t) >= 2
     AND (gp.barcode = q.t OR gp.sku = q.t OR gp.sku ILIKE q.t || '%' OR gp.name ILIKE '%' || q.t || '%')
   ORDER BY (gp.barcode = q.t OR gp.sku = q.t) DESC, gp.name
   LIMIT 30;
$$;

CREATE OR REPLACE FUNCTION public.locations_list()
RETURNS TABLE (location TEXT, products INTEGER, units INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.location, count(*)::int, SUM(pl.quantity)::int
    FROM public.product_locations pl
   WHERE public.can_pick(auth.uid())
   GROUP BY pl.location
   ORDER BY (pl.location = 'ראשי') DESC, pl.location;
$$;

-- מסך הליקוט מציג מאיפה ללקט (איתורים עם כמות)
DROP FUNCTION IF EXISTS public.picking_order_lines(UUID);
CREATE OR REPLACE FUNCTION public.picking_order_lines(_order_id UUID)
RETURNS TABLE (
  item_id UUID, product_id UUID, name TEXT, sku TEXT, barcode TEXT, image_url TEXT,
  shelf_location TEXT, pack_size INTEGER, quantity INTEGER, picked BOOLEAN, picked_qty INTEGER, picked_at TIMESTAMPTZ,
  locations JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.id, oi.product_id, COALESCE(gp.name, 'מוצר'), gp.sku, gp.barcode, gp.image_url,
         NULLIF(btrim(gp.shelf_location), ''), gp.pack_size, oi.quantity, oi.picked, oi.picked_qty, oi.picked_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('location', pl.location, 'quantity', pl.quantity)
                                    ORDER BY (pl.location = 'ראשי') DESC, pl.quantity DESC)
                     FROM public.product_locations pl WHERE pl.product_id = oi.product_id AND pl.quantity > 0), '[]'::jsonb)
    FROM public.order_items oi
    LEFT JOIN public.global_products gp ON gp.id = oi.product_id
   WHERE public.can_pick(auth.uid()) AND oi.order_id = _order_id AND NOT oi.is_deposit
   ORDER BY NULLIF(btrim(gp.shelf_location), '') NULLS LAST, gp.name;
$$;

REVOKE ALL ON FUNCTION
  public.picking_manager_approve(UUID), public.picking_return(UUID), public.picking_order_lines(UUID),
  public.transfer_create(TEXT), public.transfer_line_save(UUID, UUID, UUID, TEXT, TEXT, INTEGER), public.transfer_line_delete(UUID),
  public.transfer_cancel(UUID), public.transfer_approve(UUID), public.transfers_list(TEXT), public.transfer_lines(UUID),
  public.stock_lookup(TEXT), public.locations_list()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.picking_manager_approve(UUID), public.picking_return(UUID), public.picking_order_lines(UUID),
  public.transfer_create(TEXT), public.transfer_line_save(UUID, UUID, UUID, TEXT, TEXT, INTEGER), public.transfer_line_delete(UUID),
  public.transfer_cancel(UUID), public.transfer_approve(UUID), public.transfers_list(TEXT), public.transfer_lines(UUID),
  public.stock_lookup(TEXT), public.locations_list()
  TO authenticated, service_role;

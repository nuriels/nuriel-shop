-- ============================================================
-- ספירת מלאי (02.10.2026)
--   1. ספירות (stock_counts) ושורות ספירה (stock_count_lines)
--   2. apply_stock_count — עדכון אטומי: זמין = נספר פחות מה ששמור להזמנות פתוחות
--   3. stock_reserved_open — כמה שמור כרגע בהזמנות פתוחות לכל מוצר
--   4. "אזל" אוטומטי גם כשנשאר פחות ממארז אחד (לא רק ב-0)
-- אידמפוטנטי: בטוח להרצה חוזרת.
-- ============================================================


-- ============================================================
-- 1. טבלאות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title          TEXT NOT NULL DEFAULT '',
  -- קטגוריה שנבחרה לספירה חלקית (כולל תת-הקטגוריות שלה); NULL = כל המחסן
  scope_category TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'cancelled')),
  created_by     UUID DEFAULT auth.uid() REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by     UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  applied_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ספירה פתוחה אחת בכל רגע — שתי ספירות במקביל היו דורסות זו את זו
CREATE UNIQUE INDEX IF NOT EXISTS stock_counts_one_open_idx
  ON public.stock_counts ((true)) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id                UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  count_id          UUID NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  -- כמה יחידות נמצאו פיזית על המדף (המארזים כבר מוכפלים)
  counted_units     INTEGER NOT NULL CHECK (counted_units >= 0),
  -- איך הוזן (לתצוגה בלבד): מארזים שלמים + יחידות בודדות
  packs             INTEGER CHECK (packs IS NULL OR packs >= 0),
  loose_units       INTEGER CHECK (loose_units IS NULL OR loose_units >= 0),
  counted_by        UUID DEFAULT auth.uid() REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  counted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- נקבעים ברגע האישור (היסטוריה): מה היה רשום, כמה היה שמור, מה נקבע
  recorded_before   INTEGER,
  reserved_open     INTEGER,
  applied_quantity  INTEGER,
  UNIQUE (count_id, product_id)
);
CREATE INDEX IF NOT EXISTS stock_count_lines_count_idx ON public.stock_count_lines (count_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_counts, public.stock_count_lines TO authenticated;
GRANT ALL ON public.stock_counts, public.stock_count_lines TO service_role;
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

-- פתיחה/ביטול של ספירה — מנהל בלבד. האישור (עדכון המלאי) רק דרך apply_stock_count.
DROP POLICY IF EXISTS "stock counts readable by staff" ON public.stock_counts;
CREATE POLICY "stock counts readable by staff" ON public.stock_counts
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "stock counts opened by admin" ON public.stock_counts;
CREATE POLICY "stock counts opened by admin" ON public.stock_counts
FOR INSERT TO authenticated
WITH CHECK (public.is_admin(auth.uid()) AND status = 'open' AND applied_at IS NULL);

DROP POLICY IF EXISTS "stock counts cancelled by admin" ON public.stock_counts;
CREATE POLICY "stock counts cancelled by admin" ON public.stock_counts
FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) AND status = 'open')
WITH CHECK (public.is_admin(auth.uid()) AND status IN ('open', 'cancelled') AND applied_at IS NULL);

-- שורות: כל איש צוות יכול לספור, רק בספירה פתוחה
DROP POLICY IF EXISTS "stock count lines readable by staff" ON public.stock_count_lines;
CREATE POLICY "stock count lines readable by staff" ON public.stock_count_lines
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "stock count lines written by staff" ON public.stock_count_lines;
CREATE POLICY "stock count lines written by staff" ON public.stock_count_lines
FOR ALL TO authenticated
USING (public.is_staff(auth.uid())
       AND EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.id = count_id AND c.status = 'open'))
WITH CHECK (public.is_staff(auth.uid())
       AND EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.id = count_id AND c.status = 'open'));

-- שדות ההיסטוריה נקבעים רק באישור — לא מהדפדפן
CREATE OR REPLACE FUNCTION public.guard_stock_count_line()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.recorded_before := NULL;
  NEW.reserved_open := NULL;
  NEW.applied_quantity := NULL;
  NEW.counted_at := now();
  -- מי ספר אחרון את המוצר הזה
  NEW.counted_by := COALESCE(auth.uid(), NEW.counted_by);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS stock_count_lines_guard ON public.stock_count_lines;
CREATE TRIGGER stock_count_lines_guard
BEFORE INSERT OR UPDATE ON public.stock_count_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_stock_count_line();

DROP TRIGGER IF EXISTS stock_counts_updated_at ON public.stock_counts;
CREATE TRIGGER stock_counts_updated_at
BEFORE UPDATE ON public.stock_counts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 2. כמה שמור כרגע בהזמנות פתוחות (הסחורה עדיין פיזית על המדף)
-- ============================================================
CREATE OR REPLACE FUNCTION public.stock_reserved_open()
RETURNS TABLE (product_id UUID, reserved INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT oi.product_id, SUM(oi.reserved_quantity)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE public.is_staff(auth.uid())
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking')
     AND NOT oi.is_deposit
     AND oi.reserved_quantity > 0
   GROUP BY oi.product_id;
$$;
REVOKE ALL ON FUNCTION public.stock_reserved_open() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_reserved_open() TO authenticated, service_role;


-- ============================================================
-- 3. אישור ספירה — פעולה אחת: כל המוצרים שנספרו מתעדכנים או אף אחד
-- ============================================================
-- זמין למכירה = נספר על המדף − שמור להזמנות פתוחות (עוד לא נשלחו).
-- נספר 0 / פחות ממארז אחד → "אזל" (סימון אוטומטי, יוסר לבד כשייכנס מלאי).
-- "אזל" שהמנהל סימן ידנית נשאר. מוצרים שלא נספרו — לא משתנים.
-- בלי מבול התראות: האישור מחזיר סיכום, ההתראות האוטומטיות מושתקות בזמן העדכון.
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
       AND o.status IN ('pending', 'agent_review', 'picking')
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
REVOKE ALL ON FUNCTION public.apply_stock_count(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_count(UUID) TO authenticated;


-- ============================================================
-- 4. "אזל" אוטומטי גם כשנשאר פחות ממארז אחד
-- ============================================================
-- עד עכשיו רק 0 סומן. במוצר שנמכר ב-24 ונשארו 6 — לקוח כבר לא יכול להזמין,
-- ולכן גם זה "אזל" (עם התראה), והסימון יורד לבד כשחוזר לפחות מארז שלם.
CREATE OR REPLACE FUNCTION public.product_stock_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  min_sell INTEGER;
BEGIN
  -- עדכון מתוך אישור ספירה — הדגלים נקבעים שם במפורש
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_out_of_stock IS DISTINCT FROM OLD.is_out_of_stock THEN
    -- המנהל שינה את הסימון בעצמו — מעכשיו זה סימון ידני
    NEW.out_of_stock_auto := false;
    RETURN NEW;
  END IF;
  min_sell := CASE WHEN NEW.pack_size IS NOT NULL AND NEW.pack_size >= 2 THEN NEW.pack_size ELSE 1 END;
  IF NOT OLD.is_out_of_stock
     AND OLD.stock_quantity > 0
     AND NEW.stock_quantity < min_sell
     AND (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
          OR NEW.pack_size IS DISTINCT FROM OLD.pack_size) THEN
    NEW.is_out_of_stock := true;
    NEW.out_of_stock_auto := true;
  ELSIF OLD.is_out_of_stock AND OLD.out_of_stock_auto AND NEW.stock_quantity >= min_sell THEN
    NEW.is_out_of_stock := false;
    NEW.out_of_stock_auto := false;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS global_products_stock_status ON public.global_products;
CREATE TRIGGER global_products_stock_status
BEFORE UPDATE OF stock_quantity, is_out_of_stock, pack_size ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.product_stock_status();

-- ההתראה: גם היא שותקת בזמן אישור ספירה, והטקסט מתאים גם ל"פחות ממארז"
CREATE OR REPLACE FUNCTION public.notify_out_of_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.is_out_of_stock AND NEW.out_of_stock_auto
     AND NOT (OLD.is_out_of_stock AND OLD.out_of_stock_auto) THEN
    INSERT INTO public.staff_notifications (user_id, kind, title, body, link)
    SELECT ur.user_id,
           'out_of_stock',
           'מוצר אזל מהמלאי',
           NEW.name || CASE WHEN NEW.stock_quantity > 0
                            THEN ' · נשארו ' || NEW.stock_quantity || ' יחידות, פחות ממארז — סומן "אזל"'
                            ELSE ' · סומן "אזל" אוטומטית ואינו זמין להזמנה' END,
           '/admin?tab=products'
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
       AND NOT ur.is_blocked
       AND ur.user_id IS DISTINCT FROM auth.uid();
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS global_products_notify_out_of_stock ON public.global_products;
CREATE TRIGGER global_products_notify_out_of_stock
AFTER UPDATE OF stock_quantity, is_out_of_stock, pack_size ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.notify_out_of_stock();

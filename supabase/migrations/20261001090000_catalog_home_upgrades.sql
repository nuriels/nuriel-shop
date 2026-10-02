-- ============================================================
-- שדרוג קטלוג ומסך הבית (01.10.2026)
--   1. הסתרת מוצרים (is_hidden)       — נעלם מלקוחות, נחסם בהזמנה
--   2. מחיר מבצע נמוך מהמחיר הרגיל    — נאכף במסד
--   3. דרגי מחיר רדומים                — כל הלקוחות בדרג 1, הדרג הקודם נשמר בגיבוי
--   4. שמירת מלאי בהזמנה               — יורד בשליחה, חוזר בביטול, "אזל" + התראה ב-0
--   5. שליחת הזמנה אטומית (place_order) — אין יותר הזמנה ריקה כשהשורות נדחות
--   6. טיוטות מוצרים (product_drafts)
--   7. באנרים למסך הבית (home_banner_slides)
--
-- ⚠️ המיגרציה לא נוגעת במחירי המוצרים (price_tier1/2/3, sale_price) —
--    רק מוסיפה עמודות, טבלאות, פונקציות וטריגרים.
-- אידמפוטנטי: בטוח להרצה חוזרת (נבדק פעמיים על מסד ניסוי).
-- ============================================================


-- ============================================================
-- 1. עמודות חדשות במוצרים ובשורות הזמנה
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false,
  -- true = המערכת סימנה "אזל" כשהמלאי הגיע ל-0 (ולכן גם תסיר את הסימון כשיחזור מלאי)
  ADD COLUMN IF NOT EXISTS out_of_stock_auto BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS global_products_hidden_idx ON public.global_products (is_hidden);

-- כמה יחידות מהשורה נלקחו בפועל מהמלאי (כדי שביטול יחזיר בדיוק את מה שנלקח)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS reserved_quantity INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_reserved_quantity_check CHECK (reserved_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS price_tiers_enabled BOOLEAN NOT NULL DEFAULT false;


-- ============================================================
-- 2. דרגי מחיר רדומים
-- ============================================================
-- מתג אחד במסד: site_settings.price_tiers_enabled (ברירת מחדל false).
-- כשהוא כבוי — כל פרופיל לקוח נשמר תמיד בדרג 1, והממשק מציג מחיר אחד.
-- מחירי דרג 2/3 שכבר הוזנו במוצרים נשארים במקומם ולא נמחקים.
CREATE OR REPLACE FUNCTION public.price_tiers_enabled()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT s.price_tiers_enabled FROM public.site_settings s WHERE s.id = true), false);
$$;
GRANT EXECUTE ON FUNCTION public.price_tiers_enabled() TO anon, authenticated, service_role;

-- גיבוי חד-פעמי של הדרג של כל לקוח לפני המעבר לדרג 1 (לשחזור אם יופעלו הדרגים).
-- ON CONFLICT DO NOTHING: הרצה חוזרת לא דורסת את הגיבוי המקורי.
CREATE TABLE IF NOT EXISTS public.price_tier_backup (
  user_id    UUID NOT NULL PRIMARY KEY REFERENCES public.customer_profiles(user_id) ON DELETE CASCADE,
  price_tier SMALLINT,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.price_tier_backup FROM anon, authenticated;
GRANT ALL ON public.price_tier_backup TO service_role;
ALTER TABLE public.price_tier_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO public.price_tier_backup (user_id, price_tier)
SELECT cp.user_id, cp.price_tier FROM public.customer_profiles cp
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.force_single_price_tier()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.price_tiers_enabled() THEN
    NEW.price_tier := 1;
  END IF;
  RETURN NEW;
END; $$;

-- השם מתחיל ב-"customer_profiles_t..." כדי לרוץ אחרי customer_profiles_protect_columns
DROP TRIGGER IF EXISTS customer_profiles_tier_dormant ON public.customer_profiles;
CREATE TRIGGER customer_profiles_tier_dormant
BEFORE INSERT OR UPDATE ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.force_single_price_tier();

ALTER TABLE public.customer_profiles ALTER COLUMN price_tier SET DEFAULT 1;
UPDATE public.customer_profiles SET price_tier = 1 WHERE price_tier IS DISTINCT FROM 1;


-- ============================================================
-- 3. מחיר מבצע חייב להיות נמוך מהמחיר הרגיל
-- ============================================================
-- נבדק רק כשמחיר המבצע או המחיר הרגיל משתנים — עדכוני מלאי ושאר השדות
-- לא ייחסמו בגלל נתון ישן שכבר קיים במסד.
CREATE OR REPLACE FUNCTION public.guard_product_sale_price()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  regular NUMERIC;
BEGIN
  IF NEW.sale_price IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.sale_price IS NOT DISTINCT FROM OLD.sale_price
     AND NEW.price_tier1 IS NOT DISTINCT FROM OLD.price_tier1
     AND NEW.price_tier2 IS NOT DISTINCT FROM OLD.price_tier2
     AND NEW.price_tier3 IS NOT DISTINCT FROM OLD.price_tier3 THEN
    RETURN NEW;
  END IF;
  regular := CASE WHEN public.price_tiers_enabled()
                  THEN LEAST(NEW.price_tier1, NEW.price_tier2, NEW.price_tier3)
                  ELSE NEW.price_tier1 END;
  IF NEW.sale_price >= regular THEN
    RAISE EXCEPTION 'מחיר המבצע (% ₪) חייב להיות נמוך מהמחיר הרגיל (% ₪)', NEW.sale_price, regular
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS global_products_guard_sale_price ON public.global_products;
CREATE TRIGGER global_products_guard_sale_price
BEFORE INSERT OR UPDATE ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.guard_product_sale_price();


-- ============================================================
-- 4. שמירת מלאי בהזמנה
-- ============================================================
-- כללים:
--  • הזמנה (kind='order') שאינה מבוטלת שומרת מלאי ברגע שהשורה נכנסת.
--    בקשת הצעת מחיר (quote) לא שומרת.
--  • מוצר במלאי 0 שלא מסומן "אזל" = מלאי שלא נספר עדיין → לא נשמר ולא נחסם,
--    כדי שמוצרים שעוד לא הוזנה להם כמות ימשיכו להיות זמינים.
--  • לקוח לא יכול להזמין יותר ממה שיש; צוות יכול (שומרים את מה שיש).
--  • ביטול / מחיקה / הקטנת כמות מחזירים בדיוק את מה שנלקח (reserved_quantity).
--  • מלאי שיורד ל-0 → "אזל" אוטומטי + התראה למנהלים; חזרת מלאי מסירה
--    את הסימון רק אם המערכת היא שסימנה אותו.

CREATE OR REPLACE FUNCTION public.stock_release(_product_id UUID, _qty INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN;
  END IF;
  UPDATE public.global_products SET stock_quantity = stock_quantity + _qty WHERE id = _product_id;
END; $$;

CREATE OR REPLACE FUNCTION public.stock_reserve(_product_id UUID, _want INTEGER, _strict BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  take INTEGER;
BEGIN
  IF _want IS NULL OR _want <= 0 THEN
    RETURN 0;
  END IF;
  -- נעילת שורת המוצר: שתי הזמנות במקביל לא ישמרו את אותה יחידה פעמיים
  SELECT name, stock_quantity, pack_size, is_out_of_stock INTO p
    FROM public.global_products WHERE id = _product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF p.stock_quantity <= 0 THEN
    -- בדיקה חוזרת אחרי הנעילה: אם הזמנה מקבילה לקחה את היחידה האחרונה,
    -- המוצר כבר סומן "אזל" — לקוח נחסם כאן ולא עובר כ"מלאי שלא נספר"
    IF _strict AND p.is_out_of_stock THEN
      RAISE EXCEPTION 'המוצר "%" אזל מהמלאי — הסירו אותו מהסל', p.name
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN 0;
  END IF;
  IF _strict AND _want > p.stock_quantity THEN
    IF p.pack_size IS NOT NULL AND p.pack_size >= 2 THEN
      RAISE EXCEPTION 'נותרו במלאי רק % יחידות של "%" (% מארזים שלמים) — עדכנו את הכמות בסל',
        p.stock_quantity, p.name, p.stock_quantity / p.pack_size
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'נותרו במלאי רק % יחידות של "%" — עדכנו את הכמות בסל',
      p.stock_quantity, p.name
      USING ERRCODE = 'check_violation';
  END IF;
  take := LEAST(_want, p.stock_quantity);
  UPDATE public.global_products SET stock_quantity = stock_quantity - take WHERE id = _product_id;
  RETURN take;
END; $$;

REVOKE ALL ON FUNCTION public.stock_release(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_reserve(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_release(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.stock_reserve(UUID, INTEGER, BOOLEAN) TO service_role;

-- שורות הזמנה: שמירה בהכנסה, התאמה בשינוי כמות, החזרה במחיקה
CREATE OR REPLACE FUNCTION public.order_items_stock_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent RECORD;
  prod RECORD;
  is_customer BOOLEAN;
  active BOOLEAN;
  extra INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.reserved_quantity > 0 THEN
      PERFORM public.stock_release(OLD.product_id, OLD.reserved_quantity);
    END IF;
    RETURN OLD;
  END IF;

  -- עדכון פנימי מתוך orders_stock_sync (ביטול/שחזור הזמנה) — עובר כמו שהוא
  IF TG_OP = 'UPDATE' AND current_setting('kobi.stock_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deposit THEN
    NEW.reserved_quantity := 0;
    RETURN NEW;
  END IF;

  is_customer := NOT public.is_staff(auth.uid());
  SELECT kind, status INTO parent FROM public.orders WHERE id = NEW.order_id;
  active := FOUND AND parent.kind = 'order' AND parent.status <> 'cancelled';

  IF TG_OP = 'INSERT' THEN
    -- הערך לא מגיע מהדפדפן: רק המסד קובע כמה נשמר
    NEW.reserved_quantity := 0;
    IF is_customer THEN
      SELECT name, is_hidden, is_out_of_stock INTO prod
        FROM public.global_products WHERE id = NEW.product_id;
      IF FOUND AND prod.is_hidden THEN
        RAISE EXCEPTION 'המוצר "%" אינו זמין עוד להזמנה — הסירו אותו מהסל', prod.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF FOUND AND prod.is_out_of_stock AND parent.kind = 'order' THEN
        RAISE EXCEPTION 'המוצר "%" אזל מהמלאי — הסירו אותו מהסל', prod.name
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF active THEN
      NEW.reserved_quantity := public.stock_reserve(NEW.product_id, NEW.quantity, is_customer);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE מהממשק (עריכת הזמנה ע"י הצוות): reserved_quantity לא ניתן לשינוי ישיר
  NEW.reserved_quantity := OLD.reserved_quantity;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    PERFORM public.stock_release(OLD.product_id, OLD.reserved_quantity);
    NEW.reserved_quantity := 0;
    IF active THEN
      NEW.reserved_quantity := public.stock_reserve(NEW.product_id, NEW.quantity, false);
    END IF;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    IF NEW.quantity < OLD.reserved_quantity THEN
      PERFORM public.stock_release(NEW.product_id, OLD.reserved_quantity - NEW.quantity);
      NEW.reserved_quantity := NEW.quantity;
    ELSIF active AND NEW.quantity > OLD.reserved_quantity THEN
      extra := public.stock_reserve(NEW.product_id, NEW.quantity - OLD.reserved_quantity, false);
      NEW.reserved_quantity := OLD.reserved_quantity + extra;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- השם "order_items_stock..." ממוקם אחרי order_items_snapshot_product (סדר אלפביתי),
-- כך שבדיקת המארזים והתמחור רצות קודם
DROP TRIGGER IF EXISTS order_items_stock_sync ON public.order_items;
CREATE TRIGGER order_items_stock_sync
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.order_items_stock_sync();

-- הזמנה: ביטול מחזיר את כל המלאי שנשמר; שחזור מביטול (או הפיכת הצעה להזמנה) שומר מחדש
CREATE OR REPLACE FUNCTION public.orders_stock_sync()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it RECORD;
  was_active BOOLEAN := OLD.kind = 'order' AND OLD.status <> 'cancelled';
  now_active BOOLEAN := NEW.kind = 'order' AND NEW.status <> 'cancelled';
  got INTEGER;
BEGIN
  IF was_active = now_active THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('kobi.stock_sync', 'on', true);
  FOR it IN
    SELECT id, product_id, quantity, reserved_quantity
      FROM public.order_items
     WHERE order_id = NEW.id AND NOT is_deposit
     ORDER BY product_id
  LOOP
    IF was_active THEN
      IF it.reserved_quantity > 0 THEN
        PERFORM public.stock_release(it.product_id, it.reserved_quantity);
        UPDATE public.order_items SET reserved_quantity = 0 WHERE id = it.id;
      END IF;
    ELSE
      got := public.stock_reserve(it.product_id, it.quantity - it.reserved_quantity, false);
      IF got > 0 THEN
        UPDATE public.order_items SET reserved_quantity = reserved_quantity + got WHERE id = it.id;
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('kobi.stock_sync', 'off', true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS orders_stock_sync ON public.orders;
CREATE TRIGGER orders_stock_sync
AFTER UPDATE OF status, kind ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_stock_sync();

-- מוצר: "אזל" אוטומטי ב-0, והסרה אוטומטית כשהמלאי חוזר (רק לסימון אוטומטי)
CREATE OR REPLACE FUNCTION public.product_stock_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_out_of_stock IS DISTINCT FROM OLD.is_out_of_stock THEN
    -- המנהל שינה את הסימון בעצמו — מעכשיו זה סימון ידני
    NEW.out_of_stock_auto := false;
  ELSIF OLD.stock_quantity > 0 AND NEW.stock_quantity = 0 AND NOT OLD.is_out_of_stock THEN
    NEW.is_out_of_stock := true;
    NEW.out_of_stock_auto := true;
  ELSIF OLD.stock_quantity = 0 AND NEW.stock_quantity > 0
        AND OLD.is_out_of_stock AND OLD.out_of_stock_auto THEN
    NEW.is_out_of_stock := false;
    NEW.out_of_stock_auto := false;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS global_products_stock_status ON public.global_products;
CREATE TRIGGER global_products_stock_status
BEFORE UPDATE OF stock_quantity, is_out_of_stock ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.product_stock_status();

-- התראה בפעמון לכל המנהלים (חוץ ממי שביצע את השינוי בעצמו)
DO $$ BEGIN
  ALTER TABLE public.staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_kind_check;
  ALTER TABLE public.staff_notifications
    ADD CONSTRAINT staff_notifications_kind_check
    CHECK (kind IN ('new_customer', 'new_order', 'out_of_stock'));
END $$;

CREATE OR REPLACE FUNCTION public.notify_out_of_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_out_of_stock AND NEW.out_of_stock_auto
     AND NOT (OLD.is_out_of_stock AND OLD.out_of_stock_auto) THEN
    INSERT INTO public.staff_notifications (user_id, kind, title, body, link)
    SELECT ur.user_id,
           'out_of_stock',
           'מוצר אזל מהמלאי',
           NEW.name || ' · סומן "אזל" אוטומטית ואינו זמין להזמנה',
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
AFTER UPDATE OF stock_quantity, is_out_of_stock ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.notify_out_of_stock();


-- ============================================================
-- 5. שליחת הזמנה/בקשה של לקוח — פעולה אחת אטומית
-- ============================================================
-- עד היום ההזמנה והשורות נשלחו בשתי בקשות: אם השורות נדחו (מארז, מלאי,
-- מוצר מוסתר) נשארה הזמנה ריקה וסוכן קיבל התראה על הזמנה שלא קיימת.
-- כאן הכל בטרנזקציה אחת. SECURITY INVOKER — אותן הרשאות RLS ואותם טריגרים
-- בדיוק כמו בהכנסה ישירה מהדפדפן.
CREATE OR REPLACE FUNCTION public.place_order(
  _kind TEXT, _items JSONB, _vat_rate NUMERIC, _prices_include_vat BOOLEAN
)
RETURNS TABLE (id UUID, order_number TEXT, kind TEXT)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  created RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'יש להתחבר כדי לשלוח הזמנה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הסל ריק';
  END IF;

  INSERT INTO public.orders AS o (customer_id, status, kind, total, vat_rate, prices_include_vat)
  VALUES (auth.uid(), 'pending', COALESCE(_kind, 'order'), 0,
          COALESCE(_vat_rate, 18), COALESCE(_prices_include_vat, true))
  RETURNING o.id, o.order_number, o.kind INTO created;

  -- מיון לפי מוצר: נעילות המלאי נלקחות תמיד באותו סדר (בלי deadlock בין הזמנות)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
  SELECT created.id,
         (x ->> 'product_id')::uuid,
         (x ->> 'quantity')::integer,
         COALESCE((x ->> 'unit_price')::numeric, 0),
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   ORDER BY (x ->> 'product_id'), COALESCE((x ->> 'is_deposit')::boolean, false);

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END; $$;
REVOKE ALL ON FUNCTION public.place_order(TEXT, JSONB, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(TEXT, JSONB, NUMERIC, BOOLEAN) TO authenticated;


-- ============================================================
-- 6. הקטלוג: מוצר מוסתר לא מוחזר לאף אחד בחזית האתר
-- ============================================================
-- זהה לגרסה ב-20260927090000_pack_size.sql, בתוספת WHERE NOT gp.is_hidden
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN,
  price NUMERIC, original_price NUMERIC, sale_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  has_deposit BOOLEAN, deposit_price NUMERIC, deposit_units INTEGER,
  pack_size INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH viewer AS (
    SELECT CASE
             WHEN auth.uid() IS NULL THEN NULL
             WHEN public.is_staff(auth.uid()) THEN 1
             ELSE (
               SELECT cp.price_tier
               FROM public.customer_profiles cp
               JOIN public.user_roles ur ON ur.user_id = cp.user_id
               WHERE cp.user_id = auth.uid()
                 AND ur.is_approved = true
                 AND ur.is_blocked = false
             )
           END AS tier
  )
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors, gp.barcode,
    gp.is_promo, gp.is_out_of_stock,
    CASE
      WHEN base.tier_price IS NULL THEN NULL
      WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at) THEN gp.sale_price
      ELSE base.tier_price
    END AS price,
    CASE
      WHEN base.tier_price IS NULL THEN NULL
      WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at) THEN base.tier_price
      ELSE NULL
    END AS original_price,
    CASE
      WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at) THEN gp.sale_ends_at
      ELSE NULL
    END AS sale_ends_at,
    gp.created_at,
    gp.has_deposit, gp.deposit_price, gp.deposit_units,
    gp.pack_size
  FROM public.global_products gp
  CROSS JOIN viewer v
  CROSS JOIN LATERAL (
    SELECT CASE v.tier
             WHEN 1 THEN gp.price_tier1
             WHEN 2 THEN gp.price_tier2
             WHEN 3 THEN gp.price_tier3
           END AS tier_price
  ) base
  WHERE NOT gp.is_hidden
  ORDER BY gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated;


-- ============================================================
-- 7. טיוטות מוצרים — טופס "מוצר חדש" נשמר אוטומטית, מנהלים בלבד
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_drafts (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID DEFAULT auth.uid() REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_drafts_updated_idx ON public.product_drafts (updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_drafts TO authenticated;
GRANT ALL ON public.product_drafts TO service_role;
ALTER TABLE public.product_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product drafts managed by admin" ON public.product_drafts;
CREATE POLICY "product drafts managed by admin" ON public.product_drafts
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS product_drafts_updated_at ON public.product_drafts;
CREATE TRIGGER product_drafts_updated_at
BEFORE UPDATE ON public.product_drafts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 8. באנרים למסך הבית — כמה תמונות לכל באנר, נפרד למחשב ולנייד
-- ============================================================
-- התמונות עצמן בדלי branding תחת site/banners/ (מדיניות הכתיבה של אדמין
-- לתיקייה site כבר קיימת, והדלי ציבורי לקריאה).
CREATE TABLE IF NOT EXISTS public.home_banner_slides (
  id                UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  placement         TEXT NOT NULL CHECK (placement IN ('top', 'bottom')),
  position          INTEGER NOT NULL DEFAULT 0,
  desktop_image_url TEXT,
  desktop_width     INTEGER,
  desktop_height    INTEGER,
  mobile_image_url  TEXT,
  mobile_width      INTEGER,
  mobile_height     INTEGER,
  show_desktop      BOOLEAN NOT NULL DEFAULT true,
  show_mobile       BOOLEAN NOT NULL DEFAULT true,
  -- רק קישור פנימי (/...) או https — חוסם javascript: וקישורים מסוג //
  link_url          TEXT CHECK (link_url IS NULL OR link_url ~ '^(https?://[^[:space:]]+|/([^/[:space:]][^[:space:]]*)?)$'),
  alt_text          TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (desktop_image_url IS NOT NULL OR mobile_image_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS home_banner_slides_order_idx
  ON public.home_banner_slides (placement, position);

GRANT SELECT ON public.home_banner_slides TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.home_banner_slides TO authenticated;
GRANT ALL ON public.home_banner_slides TO service_role;
ALTER TABLE public.home_banner_slides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "home banners public read" ON public.home_banner_slides;
CREATE POLICY "home banners public read" ON public.home_banner_slides
FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "home banners admin write" ON public.home_banner_slides;
CREATE POLICY "home banners admin write" ON public.home_banner_slides
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS home_banner_slides_updated_at ON public.home_banner_slides;
CREATE TRIGGER home_banner_slides_updated_at
BEFORE UPDATE ON public.home_banner_slides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- שמירת כל הבאנרים בפעולה אחת: מה שבמסך הניהול הוא מה שיוצג (כל או כלום)
CREATE OR REPLACE FUNCTION public.replace_home_banners(_slides JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  saved INTEGER;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לעדכן את באנרי מסך הבית';
  END IF;
  IF _slides IS NULL OR jsonb_typeof(_slides) <> 'array' THEN
    RAISE EXCEPTION 'נתוני באנרים לא תקינים';
  END IF;

  DELETE FROM public.home_banner_slides WHERE true;

  INSERT INTO public.home_banner_slides (
    placement, position,
    desktop_image_url, desktop_width, desktop_height,
    mobile_image_url, mobile_width, mobile_height,
    show_desktop, show_mobile, link_url, alt_text
  )
  SELECT x ->> 'placement',
         COALESCE((x ->> 'position')::integer, 0),
         NULLIF(x ->> 'desktop_image_url', ''),
         (x ->> 'desktop_width')::integer,
         (x ->> 'desktop_height')::integer,
         NULLIF(x ->> 'mobile_image_url', ''),
         (x ->> 'mobile_width')::integer,
         (x ->> 'mobile_height')::integer,
         COALESCE((x ->> 'show_desktop')::boolean, true),
         COALESCE((x ->> 'show_mobile')::boolean, true),
         NULLIF(btrim(COALESCE(x ->> 'link_url', '')), ''),
         COALESCE(x ->> 'alt_text', '')
    FROM jsonb_array_elements(_slides) AS x;

  GET DIAGNOSTICS saved = ROW_COUNT;
  RETURN saved;
END; $$;
REVOKE ALL ON FUNCTION public.replace_home_banners(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_home_banners(JSONB) TO authenticated;

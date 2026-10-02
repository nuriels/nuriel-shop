-- ============================================================
-- קובי: מינימום יחידות להזמנה (MOQ) למוצר (06.10.2026)
-- ============================================================
-- נפרד ממנגנון המארזים ופועל במקביל אליו — מנגנון המארזים לא משתנה:
--   • מארזים (קיים): הכמות היא כפולה של המארז (6, 12, 18...)
--   • מינימום (חדש): רק סף תחתון (למשל 2) — מותר 2, 3, 4, 5... ולא 1
-- מוצר עם שניהם: כפולה של המארז וגם לא פחות מהמינימום (מארז 6 + מינימום 8
-- → 12, 18...). NULL = אין מינימום. נאכף במסד ללקוחות; צוות יכול לחרוג, כמו
-- במארזים. אידמפוטנטי.
-- ============================================================

ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS min_order_quantity INTEGER;

DO $$ BEGIN
  ALTER TABLE public.global_products ADD CONSTRAINT global_products_min_order_quantity_check
    CHECK (min_order_quantity IS NULL OR min_order_quantity BETWEEN 2 AND 100000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- אכיפה על שורות הזמנה — הפונקציה הקיימת (20260928090000_order_integrity)
-- כמו שהיא, ובנוסף בדיקת המינימום אחרי בדיקת המארזים
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  authoritative NUMERIC;
  staff BOOLEAN := public.is_staff(auth.uid());
BEGIN
  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at,
         has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity
    INTO p
    FROM public.global_products WHERE id = NEW.product_id;
  product_found := FOUND;

  IF product_found AND staff THEN
    -- צוות: ערכים שנשלחו נשמרים (למשל שם מותאם בהזמנה ידנית), ומה שחסר נלקח מהמוצר
    IF NEW.is_deposit THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), 'פיקדון – ' || p.name);
    ELSE
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name);
    END IF;
    NEW.product_sku := COALESCE(NEW.product_sku, p.sku);
    NEW.product_barcode := COALESCE(NEW.product_barcode, p.barcode);
    NEW.product_category := COALESCE(NEW.product_category, p.category);
    NEW.product_image_url := COALESCE(NEW.product_image_url, p.image_url);
    NEW.product_shelf_location := COALESCE(NEW.product_shelf_location, p.shelf_location);
    IF NOT NEW.is_deposit THEN
      NEW.product_pack_size := COALESCE(NEW.product_pack_size, p.pack_size);
    END IF;
  ELSIF product_found THEN
    -- לקוח (וכל קריאה שאינה צוות): הצילום תמיד מהמוצר במסד — ערכים מהדפדפן
    -- נדרסים, כדי שאי אפשר יהיה לכתוב שם/ברקוד/איתור שקריים לבון הליקוט
    NEW.product_name := CASE WHEN NEW.is_deposit THEN 'פיקדון – ' || p.name ELSE p.name END;
    NEW.product_sku := p.sku;
    NEW.product_barcode := p.barcode;
    NEW.product_category := p.category;
    NEW.product_image_url := p.image_url;
    NEW.product_shelf_location := p.shelf_location;
    NEW.product_pack_size := CASE WHEN NEW.is_deposit THEN NULL ELSE p.pack_size END;
  END IF;

  SELECT kind, customer_id INTO parent FROM public.orders WHERE id = NEW.order_id;
  parent_found := FOUND;

  -- מוצר שנמכר במארזים: לקוח חייב להזמין כפולה שלמה של המארז (צוות יכול
  -- לחרוג במקרים מיוחדים — הממשק מזהיר אותו). נאכף כאן, לא רק בדפדפן.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.pack_size IS NOT NULL
     AND NOT staff
     AND (NEW.quantity < p.pack_size OR NEW.quantity % p.pack_size <> 0) THEN
    RAISE EXCEPTION 'המוצר "%" נמכר במארזים של % יחידות — הכמות חייבת להיות %, % וכן הלאה',
      p.name, p.pack_size, p.pack_size, p.pack_size * 2;
  END IF;

  -- מינימום יחידות להזמנה (נפרד מהמארזים, ובמקביל אליהם): לקוח לא יכול להזמין
  -- פחות מהמינימום; כל כמות מעליו מותרת. צוות יכול לחרוג, כמו במארזים.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.min_order_quantity IS NOT NULL
     AND NOT staff
     AND NEW.quantity < p.min_order_quantity THEN
    RAISE EXCEPTION 'מינימום להזמנה ממוצר "%" הינו % יחידות', p.name, p.min_order_quantity;
  END IF;

  IF parent_found AND NOT staff THEN
    IF parent.kind = 'quote' THEN
      NEW.unit_price := 0;
    ELSIF NEW.is_deposit THEN
      IF product_found AND p.deposit_price IS NOT NULL AND p.deposit_units IS NOT NULL THEN
        NEW.unit_price := p.deposit_price * p.deposit_units;
      ELSE
        NEW.unit_price := 0;
      END IF;
    ELSIF product_found THEN
      SELECT cp.price_tier INTO buyer_tier
        FROM public.customer_profiles cp
       WHERE cp.user_id = parent.customer_id;

      authoritative := CASE buyer_tier
                         WHEN 1 THEN p.price_tier1
                         WHEN 2 THEN p.price_tier2
                         WHEN 3 THEN p.price_tier3
                       END;

      IF public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
        authoritative := p.sale_price;
      END IF;

      NEW.unit_price := COALESCE(authoritative, 0);
    END IF;
  END IF;

  RETURN NEW;
END; $$;


-- ------------------------------------------------------------
-- הקטלוג מחזיר את המינימום (שינוי בעמודות ההחזרה מחייב DROP)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN,
  price NUMERIC, original_price NUMERIC, sale_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  has_deposit BOOLEAN, deposit_price NUMERIC, deposit_units INTEGER,
  pack_size INTEGER,
  min_order_quantity INTEGER
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
    -- "מבצע" ללקוח פירושו שהמבצע בפועל בתוקף עכשיו — לא רק שהמנהל סימן
    -- אותו כזה אי-פעם. כך מוצר שתאריך המבצע שלו עבר לא ממשיך להציג תגית
    -- "מבצע" בלי מחיר מוצלב.
    (gp.is_promo AND public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)) AS is_promo,
    gp.is_out_of_stock,
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
    gp.pack_size,
    gp.min_order_quantity
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

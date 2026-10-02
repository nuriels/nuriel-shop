-- ============================================================
-- פיקדון על מוצרים: סימון "כולל פיקדון" + מחיר פיקדון ליחידה +
-- כמות יחידות במארז, ושורת פיקדון אוטומטית בהזמנה
-- ============================================================
-- מוצרים מסוימים (למשל משקאות בבקבוק/פחית) חייבים בפיקדון. המחיר נקבע
-- ליחידה בודדת (לדוגמה 30 אגורות), אבל המוצר נמכר במארז (לדוגמה 24
-- יחידות) — כך שסכום הפיקדון לכל מארז הוא deposit_price * deposit_units.
-- כשלקוח מוסיף מוצר כזה להזמנה, נוצרת שורת הזמנה נוספת (is_deposit=true)
-- על אותו product_id, שממחירה אוטומטית בטריגר לפי שדות אלה — באותו
-- מנגנון שכבר מחשב מחיר יחידה לפי דרג הלקוח, כדי שלא יהיה אפשר לזייף
-- את סכום הפיקדון מהדפדפן.

-- אידמפוטנטי: הרצה חלקית קודמת השאירה חלק מהעמודות — כל שלב כאן בטוח להרצה חוזרת.
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS has_deposit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_price NUMERIC(12,2) CHECK (deposit_price IS NULL OR deposit_price >= 0),
  ADD COLUMN IF NOT EXISTS deposit_units INTEGER CHECK (deposit_units IS NULL OR deposit_units > 0);

DO $$
BEGIN
  ALTER TABLE public.global_products
    ADD CONSTRAINT global_products_deposit_fields_check
    CHECK (NOT has_deposit OR (deposit_price IS NOT NULL AND deposit_units IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_deposit BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- get_catalog(): מוסיפים את שלושת שדות הפיקדון, כדי שהלקוח יראה
-- "כולל פיקדון" בקטלוג ונוכל לחשב את הסכום מיד עם ההוספה לסל
-- ============================================================
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN,
  price NUMERIC, original_price NUMERIC, sale_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  has_deposit BOOLEAN, deposit_price NUMERIC, deposit_units INTEGER
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
    gp.has_deposit, gp.deposit_price, gp.deposit_units
  FROM public.global_products gp
  CROSS JOIN viewer v
  CROSS JOIN LATERAL (
    SELECT CASE v.tier
             WHEN 1 THEN gp.price_tier1
             WHEN 2 THEN gp.price_tier2
             WHEN 3 THEN gp.price_tier3
           END AS tier_price
  ) base
  ORDER BY gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated;

-- ============================================================
-- snapshot_order_item_product(): שורת פיקדון (is_deposit=true) מתומחרת
-- מ-deposit_price * deposit_units של אותו מוצר, לא מדרג הלקוח/מבצע.
-- שם הפריט מקבל קידומת "פיקדון –" כדי שיהיה ברור במסמכים ובתיק הלקוח.
-- ============================================================
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  authoritative NUMERIC;
BEGIN
  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at,
         has_deposit, deposit_price, deposit_units
    INTO p
    FROM public.global_products WHERE id = NEW.product_id;
  product_found := FOUND;

  IF product_found THEN
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
  END IF;

  SELECT kind, customer_id INTO parent FROM public.orders WHERE id = NEW.order_id;
  parent_found := FOUND;

  IF parent_found AND NOT public.is_staff(auth.uid()) THEN
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

-- ============================================================
-- קובי: מחירון אישי מיוחד ללקוחות ספציפיים (07.10.2026)
-- ============================================================
-- • customer_profiles.price_list_type: 'regular' (ברירת מחדל) / 'custom'
-- • user_custom_prices: טבלת עזר ששומרת *רק* את המחירים שהמנהל דרס ללקוח.
--   המוצרים לא משוכפלים — מוצר בלי שורה כאן מקבל את המחיר הרגיל שלו.
--   מחיקת השורה = חזרה אוטומטית למחיר הרגיל.
-- • מחיר אישי פעיל רק כשהלקוח במחירון 'custom'. החזרת לקוח ל'regular' לא
--   מוחקת את המחירים — הם נשמרים (לא פעילים), וחזרה ל-'custom' משחזרת אותם.
-- • מוצר שנמחק מהאתר / לקוח שנמחק: השורות נמחקות אוטומטית (ON DELETE CASCADE).
-- • מבצע כללי בתוקף שזול מהמחיר האישי — הלקוח מקבל את הזול מביניהם.
-- • שורות פיקדון והצעות מחיר לא מושפעות.
-- נאכף בשרת: get_catalog (תצוגה) + snapshot_order_item_product (המחיר
-- שנשמר בהזמנה), כך שאי אפשר לעקוף מהדפדפן. אידמפוטנטי.
-- ============================================================

-- ------------------------------------------------------------
-- 1. סוג מחירון ללקוח
-- ------------------------------------------------------------
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS price_list_type TEXT NOT NULL DEFAULT 'regular';

DO $$ BEGIN
  ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_price_list_type_check
    CHECK (price_list_type IN ('regular', 'custom'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- רק מנהל (או השרת עצמו) קובע סוג מחירון — לקוח/סוכן לא יכולים לשנות אותו,
-- גם לא בהרשמה עצמית (INSERT) וגם לא בעדכון פרופיל
CREATE OR REPLACE FUNCTION public.protect_price_list_type()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.price_list_type := 'regular';
    ELSE
      NEW.price_list_type := OLD.price_list_type;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.protect_price_list_type() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customer_profiles_protect_price_list ON public.customer_profiles;
CREATE TRIGGER customer_profiles_protect_price_list
BEFORE INSERT OR UPDATE ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_price_list_type();

-- ------------------------------------------------------------
-- 2. טבלת המחירים האישיים (רק דריסות)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_custom_prices (
  user_id      UUID NOT NULL REFERENCES public.customer_profiles(user_id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  custom_price NUMERIC(12, 2) NOT NULL CHECK (custom_price >= 0 AND custom_price < 10000000),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS user_custom_prices_product_idx ON public.user_custom_prices (product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_custom_prices TO authenticated;
GRANT ALL ON public.user_custom_prices TO service_role;

ALTER TABLE public.user_custom_prices ENABLE ROW LEVEL SECURITY;

-- ניהול: מנהל בלבד
DROP POLICY IF EXISTS "custom prices admin all" ON public.user_custom_prices;
CREATE POLICY "custom prices admin all" ON public.user_custom_prices
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- קריאה: הסוכן המטפל (כדי שהזמנה שהוא יוצר ללקוח תתומחר נכון)
DROP POLICY IF EXISTS "custom prices readable by handling agent" ON public.user_custom_prices;
CREATE POLICY "custom prices readable by handling agent" ON public.user_custom_prices
FOR SELECT TO authenticated
USING (public.is_agent_of_customer(auth.uid(), user_id));

-- חותמת עדכון + מי עדכן
CREATE OR REPLACE FUNCTION public.stamp_custom_price()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_custom_prices_stamp ON public.user_custom_prices;
CREATE TRIGGER user_custom_prices_stamp
BEFORE INSERT OR UPDATE ON public.user_custom_prices
FOR EACH ROW EXECUTE FUNCTION public.stamp_custom_price();

-- ------------------------------------------------------------
-- 3. המחיר האישי *הפעיל* של לקוח למוצר (NULL = אין / המחירון לא אישי)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_custom_price(_user_id UUID, _product_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ucp.custom_price
    FROM public.user_custom_prices ucp
    JOIN public.customer_profiles cp ON cp.user_id = ucp.user_id
   WHERE ucp.user_id = _user_id
     AND ucp.product_id = _product_id
     AND cp.price_list_type = 'custom';
$$;
REVOKE ALL ON FUNCTION public.active_custom_price(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.active_custom_price(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 4. אכיפה בשורות הזמנה — הפונקציה הקיימת (20261006100000_min_order_quantity)
--    כמו שהיא, ובנוסף המחיר האישי בחישוב המחיר המחייב
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  buyer_custom NUMERIC;
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

      -- מחירון אישי: רק ללקוח שיש לו מחירים בכלל (דרג משויך)
      IF authoritative IS NOT NULL THEN
        buyer_custom := public.active_custom_price(parent.customer_id, NEW.product_id);
        IF buyer_custom IS NOT NULL THEN
          authoritative := buyer_custom;
        END IF;
      END IF;

      -- מבצע כללי בתוקף: חל על כולם, אבל לא מייקר ללקוח עם מחיר אישי זול יותר
      IF authoritative IS NOT NULL
         AND public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
        authoritative := LEAST(authoritative, p.sale_price);
      END IF;

      NEW.unit_price := COALESCE(authoritative, 0);
    END IF;
  END IF;

  RETURN NEW;
END; $$;


-- ------------------------------------------------------------
-- 5. הקטלוג: מחיר אישי במקום המחיר הרגיל, ודגל is_custom_price לתצוגה
--    (שינוי בעמודות ההחזרה מחייב DROP)
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
  min_order_quantity INTEGER,
  is_custom_price BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH viewer AS (
    SELECT
      CASE
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
      END AS tier,
      -- צוות תמיד רואה את המחירון הרגיל; מחירון אישי רק ללקוח עצמו
      CASE
        WHEN auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN false
        ELSE COALESCE((
          SELECT cp.price_list_type = 'custom'
          FROM public.customer_profiles cp
          WHERE cp.user_id = auth.uid()
        ), false)
      END AS has_custom
  )
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors, gp.barcode,
    -- "מבצע" = המבצע בפועל בתוקף וגם באמת מוזיל ללקוח הזה
    (gp.is_promo AND pr.sale_applies) AS is_promo,
    gp.is_out_of_stock,
    CASE
      WHEN pr.base_price IS NULL THEN NULL
      WHEN pr.sale_applies THEN gp.sale_price
      ELSE pr.base_price
    END AS price,
    CASE WHEN pr.sale_applies THEN pr.base_price ELSE NULL END AS original_price,
    CASE WHEN pr.sale_applies THEN gp.sale_ends_at ELSE NULL END AS sale_ends_at,
    gp.created_at,
    gp.has_deposit, gp.deposit_price, gp.deposit_units,
    gp.pack_size,
    gp.min_order_quantity,
    (pr.custom_price IS NOT NULL AND NOT pr.sale_applies) AS is_custom_price
  FROM public.global_products gp
  CROSS JOIN viewer v
  CROSS JOIN LATERAL (
    SELECT CASE v.tier
             WHEN 1 THEN gp.price_tier1
             WHEN 2 THEN gp.price_tier2
             WHEN 3 THEN gp.price_tier3
           END AS tier_price
  ) base
  LEFT JOIN public.user_custom_prices ucp
         ON v.has_custom AND base.tier_price IS NOT NULL
        AND ucp.user_id = auth.uid() AND ucp.product_id = gp.id
  CROSS JOIN LATERAL (
    SELECT
      ucp.custom_price,
      COALESCE(ucp.custom_price, base.tier_price) AS base_price,
      (base.tier_price IS NOT NULL
        AND public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)
        AND gp.sale_price < COALESCE(ucp.custom_price, base.tier_price)) AS sale_applies
  ) pr
  WHERE NOT gp.is_hidden
  ORDER BY gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated;

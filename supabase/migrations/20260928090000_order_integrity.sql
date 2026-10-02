-- ============================================================
-- שלמות שורות הזמנה (בדיקת אבטחה לפני פריסה, 23.09)
-- ============================================================
-- 1. צילום פרטי המוצר בשורה: אצל לקוח תמיד מהמסד (קודם נשמר מה שהדפדפן
--    שלח, כך שאפשר היה לכתוב איתור/שם שקריים לבון הליקוט).
-- 2. פיקדון: שורת הפיקדון נוצרה רק בדפדפן — לקוח יכול היה להשמיט אותה או
--    לשלוח כמות קטנה יותר. עכשיו טריגר מוודא שלכל מוצר חייב-פיקדון בהזמנת
--    לקוח יש שורת פיקדון, ושהכמות שלה זהה לכמות המוצר.
-- 3. לקוח יכול להוסיף שורות רק להזמנה שלו שעדיין "ממתינה" (קודם — גם
--    להזמנה שכבר נשלחה). צוות — ללא שינוי.
--
-- אידמפוטנטי: בטוח להרצה חוזרת.

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
         has_deposit, deposit_price, deposit_units, pack_size
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


-- ============================================================
-- 2. שורת פיקדון מובטחת בהזמנות לקוח
-- ============================================================
-- רץ אחרי ההכנסה (AFTER ROW → בסוף הפקודה), כך ששורות שנשלחו יחד באותה
-- פקודה כבר גלויות: אם הדפדפן שלח שורת פיקדון — רק מיישרים את הכמות; אם
-- לא — מוסיפים אחת (המחיר נקבע ב-snapshot_order_item_product).
CREATE OR REPLACE FUNCTION public.ensure_order_item_deposit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  deposit_id UUID;
BEGIN
  IF NEW.is_deposit OR public.is_staff(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT has_deposit, deposit_price, deposit_units INTO p
    FROM public.global_products WHERE id = NEW.product_id;
  IF NOT FOUND OR NOT COALESCE(p.has_deposit, false)
     OR p.deposit_price IS NULL OR p.deposit_units IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO deposit_id
    FROM public.order_items
   WHERE order_id = NEW.order_id AND product_id = NEW.product_id AND is_deposit
   ORDER BY id
   LIMIT 1;

  IF deposit_id IS NULL THEN
    INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
    VALUES (NEW.order_id, NEW.product_id, NEW.quantity, 0, true);
  ELSE
    UPDATE public.order_items SET quantity = NEW.quantity
     WHERE id = deposit_id AND quantity <> NEW.quantity;
  END IF;

  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS order_items_ensure_deposit ON public.order_items;
CREATE TRIGGER order_items_ensure_deposit
AFTER INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.ensure_order_item_deposit();

-- ============================================================
-- 3. לקוח מוסיף שורות רק להזמנה ממתינה שלו
-- ============================================================
DROP POLICY IF EXISTS "order items insert" ON public.order_items;
CREATE POLICY "order items insert" ON public.order_items
FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND ((o.customer_id = auth.uid() AND o.status = 'pending')
         OR public.is_admin(auth.uid())
         OR o.agent_id = auth.uid())));

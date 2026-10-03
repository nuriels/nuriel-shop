-- ============================================================
-- SaaS מרובה חנויות — חלק 5: הגדלת מכירות — מוצרי קופה, מתנות בעגלה,
-- מוצרים קשורים ומשלוח חינם
-- ============================================================
-- 1. מוצר קופה (Order Bump): global_products.is_order_bump + משפט שיווקי
--    קצר. הלקוח רואה אותו בסל, ממש לפני שליחת ההזמנה (get_order_bumps).
-- 2. הטבות עגלה — "קנה וקבל" (cart_promotions): כלל = תנאי (סכום קנייה
--    מינימלי, או כמות מקטגוריה) → מוצר במתנה. המתנה נקבעת במסד ולא
--    בדפדפן: place_order קורא ל-apply_order_gifts, שבודקת את התנאי מול
--    המחירים האמיתיים של ההזמנה ומוסיפה שורת מתנה בחינם. לקוח לא יכול
--    לסמן שורה כמתנה בעצמו (נאכף בטריגר snapshot_order_item_product).
-- 3. מוצרים קשורים (product_relations): המנהל בוחר ידנית; בלי בחירה —
--    החנות מציגה מוצרים מאותה קטגוריה.
-- 4. משלוח חינם: site_settings.free_shipping_threshold (NULL = כבוי).
-- כל הטבלאות החדשות עם tenant_id והפרדה מלאה בין חנויות (RLS).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. מוצרי קופה (Order Bump)
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS is_order_bump BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_bump_text TEXT
    CHECK (order_bump_text IS NULL OR length(order_bump_text) <= 160);

COMMENT ON COLUMN public.global_products.is_order_bump IS
  'מוצר קופה: מוצע ללקוח בסל, רגע לפני שליחת ההזמנה';
COMMENT ON COLUMN public.global_products.order_bump_text IS
  'משפט קצר שמוצג בהצעה בקופה (עד 160 תווים); ריק = טקסט ברירת מחדל';

-- הקטלוג מגיע ללקוח דרך get_catalog (global_products עצמה פתוחה רק לצוות),
-- ולכן גם רשימת מוצרי הקופה מגיעה מפונקציה
CREATE OR REPLACE FUNCTION public.get_order_bumps()
RETURNS TABLE(product_id uuid, pitch text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gp.id, NULLIF(btrim(gp.order_bump_text), '')
    FROM public.global_products gp
   WHERE gp.tenant_id = public.current_tenant_id()
     AND gp.is_order_bump
     AND NOT gp.is_hidden
     AND NOT gp.is_out_of_stock
     AND (public.tenant_storefront_open(gp.tenant_id) OR public.is_staff(auth.uid()))
   ORDER BY gp.sort_order ASC NULLS LAST, gp.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_order_bumps() TO anon, authenticated, service_role;

-- ============================================================
-- 2. מוצרים קשורים (Cross-sell)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_relations (
  tenant_id          UUID NOT NULL DEFAULT public.current_tenant_id()
                     REFERENCES public.tenants(id) ON DELETE RESTRICT,
  product_id         UUID NOT NULL,
  related_product_id UUID NOT NULL,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, product_id, related_product_id),
  CONSTRAINT product_relations_not_self CHECK (product_id <> related_product_id),
  CONSTRAINT product_relations_product_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT product_relations_related_fkey FOREIGN KEY (tenant_id, related_product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_relations_related_idx
  ON public.product_relations (tenant_id, related_product_id);

COMMENT ON TABLE public.product_relations IS
  'מוצרים קשורים שהמנהל בחר ("מוצרים נוספים שאולי תאהבו")';

ALTER TABLE public.product_relations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_relations;
CREATE POLICY tenant_isolation ON public.product_relations
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "product relations readable" ON public.product_relations;
CREATE POLICY "product relations readable" ON public.product_relations
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "product relations managed by admin" ON public.product_relations;
CREATE POLICY "product relations managed by admin" ON public.product_relations
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.product_relations FROM anon;
GRANT SELECT ON public.product_relations TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_relations TO authenticated;
GRANT ALL ON public.product_relations TO service_role;

-- עד 12 מוצרים קשורים למוצר — מעבר לזה זה כבר לא "המלצה"
CREATE OR REPLACE FUNCTION public.product_relations_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.product_relations
       WHERE tenant_id = NEW.tenant_id AND product_id = NEW.product_id) >= 12 THEN
    RAISE EXCEPTION 'אפשר לבחור עד 12 מוצרים קשורים למוצר' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS product_relations_limit ON public.product_relations;
CREATE TRIGGER product_relations_limit
  BEFORE INSERT ON public.product_relations
  FOR EACH ROW EXECUTE FUNCTION public.product_relations_limit();

-- ============================================================
-- 3. הטבות עגלה — "קנה וקבל" (Buy X Get Y)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cart_promotions (
  id              UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL DEFAULT public.current_tenant_id()
                  REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  -- min_subtotal: סכום המוצרים בעגלה ≥ min_subtotal
  -- category_quantity: לפחות min_quantity יחידות מהקטגוריה (כולל תתי-קטגוריות)
  condition_type  TEXT NOT NULL CHECK (condition_type IN ('min_subtotal', 'category_quantity')),
  min_subtotal    NUMERIC(12, 2) CHECK (min_subtotal IS NULL OR min_subtotal > 0),
  category        TEXT,
  min_quantity    INTEGER CHECK (min_quantity IS NULL OR min_quantity >= 1),
  gift_product_id UUID NOT NULL,
  gift_quantity   INTEGER NOT NULL DEFAULT 1 CHECK (gift_quantity BETWEEN 1 AND 100),
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_promotions_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cart_promotions_condition_check CHECK (
    (condition_type = 'min_subtotal'
       AND min_subtotal IS NOT NULL AND category IS NULL AND min_quantity IS NULL)
    OR (condition_type = 'category_quantity'
       AND category IS NOT NULL AND min_quantity IS NOT NULL AND min_subtotal IS NULL)),
  CONSTRAINT cart_promotions_dates_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT cart_promotions_gift_fkey FOREIGN KEY (tenant_id, gift_product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE,
  -- שינוי שם קטגוריה מתעדכן כאן אוטומטית; מחיקת הקטגוריה מוחקת את ההטבה
  CONSTRAINT cart_promotions_category_fkey FOREIGN KEY (tenant_id, category)
    REFERENCES public.categories(tenant_id, name) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cart_promotions_tenant_idx ON public.cart_promotions (tenant_id);

COMMENT ON TABLE public.cart_promotions IS
  'הטבות עגלה: כשהתנאי מתקיים — מוצר במתנה (בחינם) נוסף להזמנה';

DROP TRIGGER IF EXISTS cart_promotions_updated_at ON public.cart_promotions;
CREATE TRIGGER cart_promotions_updated_at
  BEFORE UPDATE ON public.cart_promotions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cart_promotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.cart_promotions;
CREATE POLICY tenant_isolation ON public.cart_promotions
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- לקוחות ואורחים רואים הטבות פעילות (כדי שהעגלה תציג את המתנה); מנהל
-- רואה הכל. שתי מדיניות נפרדות: לאורח אין הרשאה להריץ is_admin
DROP POLICY IF EXISTS "cart promotions readable" ON public.cart_promotions;
CREATE POLICY "cart promotions readable" ON public.cart_promotions
  FOR SELECT TO anon
  USING (is_active);
DROP POLICY IF EXISTS "cart promotions readable by members" ON public.cart_promotions;
CREATE POLICY "cart promotions readable by members" ON public.cart_promotions
  FOR SELECT TO authenticated
  USING (is_active OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "cart promotions managed by admin" ON public.cart_promotions;
CREATE POLICY "cart promotions managed by admin" ON public.cart_promotions
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.cart_promotions FROM anon;
GRANT SELECT ON public.cart_promotions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cart_promotions TO authenticated;
GRANT ALL ON public.cart_promotions TO service_role;

-- שורות מתנה בהזמנה
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promotion_id UUID;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_promotion_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_promotion_fkey FOREIGN KEY (tenant_id, promotion_id)
    REFERENCES public.cart_promotions(tenant_id, id) ON DELETE SET NULL (promotion_id);
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_gift_not_deposit;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_gift_not_deposit CHECK (NOT (is_gift AND is_deposit));
CREATE INDEX IF NOT EXISTS order_items_promotion_idx
  ON public.order_items (order_id, promotion_id) WHERE promotion_id IS NOT NULL;

COMMENT ON COLUMN public.order_items.is_gift IS 'שורת מתנה (הטבת עגלה) — בחינם, נוספה ע"י apply_order_gifts';
COMMENT ON COLUMN public.order_items.promotion_id IS 'ההטבה שבזכותה נוספה המתנה';

-- צילום המוצר והמחיר בשורת הזמנה — עכשיו גם עם שורות מתנה
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  buyer_custom NUMERIC;
  authoritative NUMERIC;
  staff BOOLEAN := public.is_staff(auth.uid());
  -- שורת מתנה (הטבת עגלה): בחינם, ונוספת רק ע"י apply_order_gifts
  gift BOOLEAN := COALESCE(NEW.is_gift, false);
BEGIN
  -- לקוח לא יכול לסמן שורה כמתנה בעצמו (למשל בקריאה ישירה ל-API) — מתנות
  -- מתווספות רק בתוך apply_order_gifts, אחרי שהמסד בדק שהתנאי של ההטבה מתקיים
  IF gift AND NOT staff AND current_setting('app.order_gifts', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'מתנות מתווספות להזמנה רק אוטומטית, לפי הטבות החנות'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT gift AND NOT staff THEN
    NEW.promotion_id := NULL;
  END IF;

  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at,
         has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity
    INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  product_found := FOUND;

  IF product_found AND staff THEN
    -- צוות: ערכים שנשלחו נשמרים (למשל שם מותאם בהזמנה ידנית), ומה שחסר נלקח מהמוצר
    IF NEW.is_deposit THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), 'פיקדון – ' || p.name);
    ELSIF gift THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name || ' (מתנה)');
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
    NEW.product_name := CASE WHEN NEW.is_deposit THEN 'פיקדון – ' || p.name
                             WHEN gift THEN p.name || ' (מתנה)'
                             ELSE p.name END;
    NEW.product_sku := p.sku;
    NEW.product_barcode := p.barcode;
    NEW.product_category := p.category;
    NEW.product_image_url := p.image_url;
    NEW.product_shelf_location := p.shelf_location;
    NEW.product_pack_size := CASE WHEN NEW.is_deposit THEN NULL ELSE p.pack_size END;
  END IF;

  SELECT kind, customer_id INTO parent FROM public.orders
   WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id;
  parent_found := FOUND;

  -- מוצר שנמכר במארזים: לקוח חייב להזמין כפולה שלמה של המארז (צוות יכול
  -- לחרוג במקרים מיוחדים — הממשק מזהיר אותו). נאכף כאן, לא רק בדפדפן.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.pack_size IS NOT NULL
     AND NOT staff AND NOT gift
     AND (NEW.quantity < p.pack_size OR NEW.quantity % p.pack_size <> 0) THEN
    RAISE EXCEPTION 'המוצר "%" נמכר במארזים של % יחידות — הכמות חייבת להיות %, % וכן הלאה',
      p.name, p.pack_size, p.pack_size, p.pack_size * 2;
  END IF;

  -- מינימום יחידות להזמנה (נפרד מהמארזים, ובמקביל אליהם): לקוח לא יכול להזמין
  -- פחות מהמינימום; כל כמות מעליו מותרת. צוות יכול לחרוג, כמו במארזים.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.min_order_quantity IS NOT NULL
     AND NOT staff AND NOT gift
     AND NEW.quantity < p.min_order_quantity THEN
    RAISE EXCEPTION 'מינימום להזמנה ממוצר "%" הינו % יחידות', p.name, p.min_order_quantity;
  END IF;

  IF parent_found AND NOT staff THEN
    IF parent.kind = 'quote' OR gift THEN
      -- בקשת הצעת מחיר — בלי מחירים; מתנה — בחינם
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
END $$;

-- שורת פיקדון אוטומטית — לא לשורות מתנה (המתנה ניתנת בלי חיוב בכלל)
CREATE OR REPLACE FUNCTION public.ensure_order_item_deposit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  deposit_id UUID;
BEGIN
  IF NEW.is_deposit OR NEW.is_gift OR public.is_staff(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT has_deposit, deposit_price, deposit_units INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
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
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price, is_deposit)
    VALUES (NEW.tenant_id, NEW.order_id, NEW.product_id, NEW.quantity, 0, true);
  ELSE
    UPDATE public.order_items SET quantity = NEW.quantity
     WHERE id = deposit_id AND quantity <> NEW.quantity;
  END IF;

  RETURN NULL;
END $$;

-- ההטבות שהזמנה זכאית להן, ומוסיפה את המתנות שעוד חסרות. בטוחה להרצה
-- חוזרת (מתנה של הטבה נוספת פעם אחת בלבד). התנאי נבדק מול המחירים
-- שהמסד קבע לשורות — לא מול מה שהדפדפן חישב.
CREATE OR REPLACE FUNCTION public.apply_order_gifts(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  r RECORD;
  _subtotal NUMERIC;
  _units INTEGER;
  _added INTEGER := 0;
BEGIN
  SELECT id, tenant_id, customer_id, kind, status INTO o
    FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- רק הלקוח של ההזמנה (או צוות החנות), ורק בחנות של הקורא
  IF o.tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT (o.customer_id = auth.uid() OR public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'אין הרשאה להזמנה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- מתנות רק בהזמנה עם מחירים (לא בבקשת הצעת מחיר), ורק לפני שטופלה
  IF o.kind <> 'order' OR o.status <> 'pending' THEN
    RETURN 0;
  END IF;

  -- סכום המוצרים (בלי פיקדונות ובלי מתנות) — אותו בסיס שמוצג ללקוח בסל
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0) INTO _subtotal
    FROM public.order_items oi
   WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_gift;

  FOR r IN
    SELECT cp.*
      FROM public.cart_promotions cp
     WHERE cp.tenant_id = o.tenant_id
       AND cp.is_active
       AND (cp.starts_at IS NULL OR cp.starts_at <= now())
       AND (cp.ends_at IS NULL OR cp.ends_at > now())
     ORDER BY cp.sort_order, cp.created_at
  LOOP
    -- כבר קיבל את המתנה של ההטבה הזו
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.order_items oi
                           WHERE oi.order_id = o.id AND oi.promotion_id = r.id);

    IF r.condition_type = 'min_subtotal' THEN
      CONTINUE WHEN _subtotal < r.min_subtotal;
    ELSE
      -- יחידות מהקטגוריה ומכל תתי-הקטגוריות שלה
      WITH RECURSIVE subtree(name) AS (
        SELECT r.category
        UNION
        SELECT c.name FROM public.categories c
          JOIN subtree s ON c.parent_name = s.name
         WHERE c.tenant_id = o.tenant_id
      )
      SELECT COALESCE(SUM(oi.quantity), 0) INTO _units
        FROM public.order_items oi
        JOIN public.global_products gp ON gp.tenant_id = oi.tenant_id AND gp.id = oi.product_id
       WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_gift
         AND gp.category IN (SELECT name FROM subtree);
      CONTINUE WHEN _units < r.min_quantity;
    END IF;

    -- מוצר המתנה חייב להיות זמין (לא מוסתר ולא אזל)
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.global_products gp
                               WHERE gp.tenant_id = o.tenant_id AND gp.id = r.gift_product_id
                                 AND NOT gp.is_hidden AND NOT gp.is_out_of_stock);

    PERFORM set_config('app.order_gifts', 'on', true);
    BEGIN
      INSERT INTO public.order_items
             (tenant_id, order_id, product_id, quantity, unit_price, is_gift, promotion_id)
      VALUES (o.tenant_id, o.id, r.gift_product_id, r.gift_quantity, 0, true, r.id);
      _added := _added + 1;
    EXCEPTION WHEN OTHERS THEN
      -- מתנה שלא ניתן לצרף (למשל לא נשאר מספיק במלאי) לא מפילה את ההזמנה
      RAISE WARNING 'apply_order_gifts: הטבה % לא צורפה להזמנה %: %', r.id, o.id, SQLERRM;
    END;
    PERFORM set_config('app.order_gifts', 'off', true);
  END LOOP;

  RETURN _added;
END $$;
REVOKE ALL ON FUNCTION public.apply_order_gifts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_gifts(uuid) TO authenticated, service_role;

-- שליחת הזמנה מהסל — כמו קודם, ובסוף מצרפים את המתנות שההזמנה זכאית להן
CREATE OR REPLACE FUNCTION public.place_order(_kind text, _items jsonb, _vat_rate numeric, _prices_include_vat boolean)
RETURNS TABLE(id uuid, order_number text, kind text)
LANGUAGE plpgsql
SET search_path = public
AS $$
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

  -- מיון לפי מוצר: נעילות המלאי נלקחות תמיד באותו סדר (בלי deadlock בין הזמנות).
  -- שורות שהדפדפן סימן כ"מתנה" לא נכנסות כאן — המתנות נקבעות במסד בלבד.
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
  SELECT created.id,
         (x ->> 'product_id')::uuid,
         (x ->> 'quantity')::integer,
         COALESCE((x ->> 'unit_price')::numeric, 0),
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
   ORDER BY (x ->> 'product_id'), COALESCE((x ->> 'is_deposit')::boolean, false);

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts(created.id);
  END IF;

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END; $$;

-- ============================================================
-- 4. משלוח חינם
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS free_shipping_threshold NUMERIC(12, 2)
    CHECK (free_shipping_threshold IS NULL OR free_shipping_threshold > 0);
COMMENT ON COLUMN public.site_settings.free_shipping_threshold IS
  'סכום המוצרים בעגלה שממנו המשלוח חינם (מד ההתקדמות בסל). NULL = כבוי';

NOTIFY pgrst, 'reload schema';

COMMIT;

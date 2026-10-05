-- ============================================================
-- חלק 20: מסך הבית הדינאמי + מלאי חכם
--
-- 1. categories.show_on_homepage — אילו קטגוריות מוצגות כריבועים במסך הבית.
--    כבר הייתה עמודה ותיקה לאותו תפקיד (show_on_home, מ-04.10). העמודה החדשה
--    מקבלת את הבחירות הקיימות, ומכאן שתיהן נשמרות זהות (טריגר): הקוד החדש
--    עובד רק עם show_on_homepage, ובדקות שבין המיגרציה לבניית הגרסה החדשה
--    הגרסה הקודמת של האתר (שקוראת show_on_home) ממשיכה לעבוד בלי שגיאות.
--
-- 2. global_products.is_featured — "הקפץ למסך ראשי": בלוק "מוצרים נבחרים"
--    במסך הבית.
--
-- 3. מלאי חכם: מוצר שהמלאי שלו 0 (או פחות ממארז אחד) נחשב "אזל" אוטומטית —
--    גם אם הסימון הידני "אזל מהמלאי" לא עודכן:
--      • get_catalog מחזיר is_out_of_stock = true (הכרטיס מציג "אזל מהמלאי"
--        וכפתור ההוספה לסל מנוטרל), ומחזיר קודם את מה שיש במלאי — מה שאזל
--        יורד לסוף הרשימה.
--      • בהזמנה של לקוח (stock_reserve במצב קפדני): מלאי 0 = "אזל" — כך שגם
--        סל ישן בדפדפן לא יעבור.
--      • מוצרי קופה (get_order_bumps) ופיד זאפ (storefront_feed_products) —
--        לפי אותו כלל.
--    חריגים: מוצר דיגיטלי (אין לו מלאי פיזי), ומוצר עם וריאציות — שם קובעת
--    הזמינות של הוריאציות (וריאציה שסופרת מלאי — לפי המלאי שלה).
--    הנתונים עצמם לא משתנים: לא מסמנים מוצרים ולא שולחים התראות "אזל" בגלל
--    המיגרציה — רק התצוגה וההזמנה מתייחסות ל-0 כ"אזל".
--
-- אידמפוטנטי: בטוח להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. קטגוריות במסך הבית
-- ------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS show_on_homepage boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.categories.show_on_homepage IS
  'הצג קטגוריה במסך הבית (ריבוע בעמוד הראשי). אף אחת לא סומנה — 5 הראשונות';
COMMENT ON COLUMN public.categories.show_on_home IS
  'עמודה ותיקה — מראה של show_on_homepage (נשמרות זהות בטריגר)';

CREATE OR REPLACE FUNCTION public.categories_homepage_mirror()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.show_on_homepage := COALESCE(NEW.show_on_homepage, false) OR COALESCE(NEW.show_on_home, false);
  ELSIF NEW.show_on_homepage IS DISTINCT FROM OLD.show_on_homepage THEN
    NULL; -- הקוד החדש שינה את show_on_homepage — הוא הקובע
  ELSIF NEW.show_on_home IS DISTINCT FROM OLD.show_on_home THEN
    NEW.show_on_homepage := COALESCE(NEW.show_on_home, false); -- גרסה קודמת של האתר
  END IF;
  NEW.show_on_home := NEW.show_on_homepage;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS categories_homepage_mirror ON public.categories;
CREATE TRIGGER categories_homepage_mirror
BEFORE INSERT OR UPDATE OF show_on_homepage, show_on_home ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.categories_homepage_mirror();

-- הבחירות הקיימות עוברות לעמודה החדשה (בהרצה חוזרת — כבר זהות, אין שינוי)
UPDATE public.categories
   SET show_on_homepage = show_on_home
 WHERE show_on_homepage IS DISTINCT FROM show_on_home;

-- ------------------------------------------------------------
-- 2. מוצרים נבחרים
-- ------------------------------------------------------------
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.global_products.is_featured IS
  '"הקפץ למסך ראשי" — מוצג בבלוק "מוצרים נבחרים" במסך הבית';

CREATE INDEX IF NOT EXISTS global_products_featured_idx
  ON public.global_products (tenant_id)
  WHERE is_featured;

-- ------------------------------------------------------------
-- 3. מלאי חכם
-- ------------------------------------------------------------
-- "יש במלאי למכירה": לפחות מארז אחד (או יחידה אחת). דיגיטלי — תמיד (בלי מלאי פיזי)
CREATE OR REPLACE FUNCTION public.product_stock_sellable(_stock integer, _pack_size integer, _is_digital boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(_is_digital, false)
      OR COALESCE(_stock, 0) >= GREATEST(COALESCE(_pack_size, 1), 1);
$$;
COMMENT ON FUNCTION public.product_stock_sellable(integer, integer, boolean) IS
  'חלק 20: מלאי 0 (או פחות ממארז) = אזל, גם בלי הסימון הידני. מוצר דיגיטלי — תמיד זמין מבחינת מלאי';

-- הזמנה של לקוח (קפדני): מלאי 0 = "אזל" — גם כשהסימון הידני לא עודכן.
-- צוות (לא קפדני) — כמו קודם: ההזמנה נקלטת, ושומרים רק את מה שיש.
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
    -- חלק 20: מלאי 0 = אזל ללקוח (גם אם הסימון הידני לא עודכן); בדיקה אחרי
    -- הנעילה — אם הזמנה מקבילה לקחה את היחידה האחרונה, הלקוח נחסם כאן
    IF _strict THEN
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
REVOKE ALL ON FUNCTION public.stock_reserve(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_reserve(UUID, INTEGER, BOOLEAN) TO service_role;

-- מוצרי קופה (Order bump): רק מה שאפשר באמת לקנות
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
     AND (public.product_stock_sellable(gp.stock_quantity, gp.pack_size, gp.is_digital)
          OR EXISTS (SELECT 1 FROM public.product_variants pv
                      WHERE pv.product_id = gp.id AND pv.is_active))
     AND (public.tenant_storefront_open(gp.tenant_id) OR public.is_staff(auth.uid()))
   ORDER BY gp.sort_order ASC NULLS LAST, gp.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_order_bumps() TO anon, authenticated, service_role;

-- הקטלוג: + is_featured, "אזל" אוטומטי במלאי 0, ומה שיש במלאי — קודם
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE FUNCTION public.get_catalog()
RETURNS TABLE(
  id uuid, sku character varying, name text, category text, description text,
  image_url text, images text[], colors text[], barcode text, is_promo boolean,
  is_out_of_stock boolean, price numeric, original_price numeric,
  sale_ends_at timestamp with time zone, created_at timestamp with time zone,
  has_deposit boolean, deposit_price numeric, deposit_units integer, pack_size integer,
  min_order_quantity integer, is_custom_price boolean,
  is_digital boolean, variant_attributes jsonb, variants jsonb,
  categories text[], is_featured boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT
      -- מחירון פתוח לכולם: אורח, ממתין לאישור, לקוח בלי דרג וצוות — המחירון
      -- הרגיל (דרג 1); לקוח מאושר עם דרג משויך — הדרג שלו
      public.buyer_price_tier(auth.uid()) AS tier,
      -- צוות תמיד רואה את המחירון הרגיל; מחירון אישי רק ללקוח עצמו
      CASE
        WHEN auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN false
        ELSE COALESCE((
          SELECT cp.price_list_type = 'custom'
          FROM public.customer_profiles cp
          WHERE cp.user_id = auth.uid()
        ), false)
      END AS has_custom,
      public.current_tenant_id() AS tenant_id
  )
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors, gp.barcode,
    -- "מבצע" = המבצע בפועל בתוקף וגם באמת מוזיל ללקוח הזה
    (gp.is_promo AND pr.sale_applies) AS is_promo,
    st.sold_out AS is_out_of_stock,
    fp.price,
    CASE WHEN pr.sale_applies THEN pr.base_price ELSE NULL END AS original_price,
    CASE WHEN pr.sale_applies THEN gp.sale_ends_at ELSE NULL END AS sale_ends_at,
    gp.created_at,
    gp.has_deposit, gp.deposit_price, gp.deposit_units,
    gp.pack_size,
    gp.min_order_quantity,
    (pr.custom_price IS NOT NULL AND NOT pr.sale_applies) AS is_custom_price,
    gp.is_digital,
    CASE WHEN var.list IS NULL THEN '[]'::jsonb ELSE gp.variant_attributes END AS variant_attributes,
    COALESCE(var.list, '[]'::jsonb) AS variants,
    -- חלק 18: כל הקטגוריות של המוצר (הראשית תמיד ביניהן)
    COALESCE(cats.names, ARRAY[gp.category]) AS categories,
    -- חלק 20: "הקפץ למסך ראשי"
    gp.is_featured
  FROM public.global_products gp
  CROSS JOIN viewer v
  CROSS JOIN LATERAL (
    SELECT CASE v.tier
             WHEN 1 THEN gp.price_tier1
             WHEN 2 THEN gp.price_tier2
             WHEN 3 THEN gp.price_tier3
           END AS tier_price,
           -- המוצר עצמו (בלי וריאציות): לא סומן "אזל" ויש במלאי לפחות מארז אחד
           (NOT gp.is_out_of_stock
             AND public.product_stock_sellable(gp.stock_quantity, gp.pack_size, gp.is_digital))
             AS own_available
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
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN pr.base_price IS NULL THEN NULL
             WHEN pr.sale_applies THEN gp.sale_price
             ELSE pr.base_price
           END AS price
  ) fp
  -- הוריאציות הפעילות: מחיר (משלה, או המחיר של המוצר לצופה) וזמינות — בלי
  -- לחשוף כמה יחידות יש במלאי. וריאציה שלא סופרת מלאי — לפי המוצר עצמו.
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'id', x.id,
             'options', x.options,
             'sku', x.sku,
             'price', CASE WHEN fp.price IS NULL THEN NULL ELSE COALESCE(x.price, fp.price) END,
             'own_price', x.price IS NOT NULL,
             'available', x.available)
             ORDER BY x.sort_order, x.created_at) AS list,
           bool_or(x.available) AS any_available
      FROM (
        SELECT pv.id, pv.options, pv.sku, pv.price, pv.sort_order, pv.created_at,
               CASE WHEN pv.stock_quantity IS NULL THEN base.own_available
                    ELSE NOT gp.is_out_of_stock
                         AND pv.stock_quantity >= GREATEST(COALESCE(gp.pack_size, 1), 1) END AS available
          FROM public.product_variants pv
         WHERE pv.product_id = gp.id AND pv.is_active
      ) x
  ) var ON true
  -- "אזל": מוצר עם וריאציות — כשאף וריאציה לא זמינה; בלי וריאציות — סימון
  -- ידני, או מלאי 0 (חלק 20: אוטומטית, גם בלי לעדכן את הסימון)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN var.list IS NOT NULL THEN NOT COALESCE(var.any_available, false)
                ELSE NOT base.own_available END AS sold_out
  ) st
  LEFT JOIN LATERAL (
    SELECT array_agg(c.name ORDER BY (c.name = gp.category) DESC, c.sort_order, c.name) AS names
      FROM public.product_categories pc
      JOIN public.categories c ON c.id = pc.category_id
     WHERE pc.product_id = gp.id
  ) cats ON true
  WHERE NOT gp.is_hidden
    AND gp.tenant_id = v.tenant_id
    -- חנות מוקפאת או במצב שבת: הקטלוג ריק ללקוחות ולאורחים; הצוות ממשיך לראות
    AND (public.tenant_storefront_open(v.tenant_id) OR public.is_staff(auth.uid()))
  -- מה שיש במלאי — קודם; מה שאזל — בסוף. בתוך כל קבוצה: הסדר שהמנהל קבע
  -- בגרירה, ומוצר שעוד לא סודר — מהחדש לישן
  ORDER BY st.sold_out ASC, gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated, service_role;

-- הפידים (מפת האתר / זאפ): "במלאי" לפי אותו כלל — מוצר במלאי 0 לא נשלח לזאפ
-- כזמין. אותה חתימה כמו בחלק 14.
CREATE OR REPLACE FUNCTION public.storefront_feed_products()
RETURNS TABLE(
  id uuid, sku text, name text, category text, description text, image_url text,
  barcode text, price numeric, regular_price numeric, in_stock boolean,
  is_digital boolean, show_in_zap boolean, seo_title text, seo_description text,
  updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gp.id, gp.sku::text, gp.name, gp.category, gp.description, gp.image_url,
         gp.barcode,
         CASE WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)
                   AND gp.sale_price < gp.price_tier1
              THEN gp.sale_price ELSE gp.price_tier1 END,
         gp.price_tier1,
         CASE
           WHEN EXISTS (SELECT 1 FROM public.product_variants pv
                         WHERE pv.product_id = gp.id AND pv.is_active) THEN
             NOT gp.is_out_of_stock AND EXISTS (
               SELECT 1 FROM public.product_variants pv
                WHERE pv.product_id = gp.id AND pv.is_active
                  AND CASE WHEN pv.stock_quantity IS NULL
                           THEN public.product_stock_sellable(gp.stock_quantity, gp.pack_size, gp.is_digital)
                           ELSE pv.stock_quantity >= GREATEST(COALESCE(gp.pack_size, 1), 1) END)
           ELSE NOT gp.is_out_of_stock
                AND public.product_stock_sellable(gp.stock_quantity, gp.pack_size, gp.is_digital)
         END,
         gp.is_digital, gp.show_in_zap, gp.seo_title, gp.seo_description, gp.updated_at
    FROM public.global_products gp
   WHERE gp.tenant_id = public.current_tenant_id()
     AND NOT gp.is_hidden
     AND public.tenant_is_active(gp.tenant_id)
     AND public.tenant_subscription_active(gp.tenant_id)
   ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.storefront_feed_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_feed_products() TO service_role;

COMMIT;

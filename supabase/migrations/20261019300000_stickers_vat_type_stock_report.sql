-- ============================================================
-- חלק 23: מדבקות למוצרים, מע"מ לפי סוג העוסק, ודו"ח ספירת מלאי
--   1. גלריית מדבקות (product_stickers) ברמת החנות + מדבקה למוצר (גודל, שקיפות)
--   2. get_catalog: + sticker (כתובת, גודל, שקיפות) — לכרטיסים, לחלון ולעמוד המוצר
--   3. site_settings.business_type: 'exempt' (עוסק פטור / זעיר) או 'authorized'
--      (עוסק מורשה / חברה). עוסק פטור — המע"מ ננעל על 0% בכל האתר.
--   4. הזמנה חדשה מקבלת את שיעור המע"מ ואת "המחירים כוללים מע"מ" מהגדרות
--      החנות — לא ממה שהדפדפן שלח (גם עוסק פטור, וגם מניעת תשלום חסר)
--   5. ספירת מלאי: שווי ליחידה נשמר ברגע העדכון — לדו"ח הספירה (הפרש בשקלים)
-- אידמפוטנטי: בטוח להרצה חוזרת.
-- ============================================================


-- ============================================================
-- 1. גלריית מדבקות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_stickers (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT public.current_tenant_id()
              REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- כתובת ציבורית של התמונה (נשמרת ב-product-images תחת <tenant>/stickers/)
  image_url   TEXT NOT NULL CHECK (
                char_length(image_url) <= 2048
                AND image_url ~ '^https?://[^\s"''<>]+$'),
  -- שם לזיהוי בגלריה, וגם הטקסט החלופי (alt) של המדבקה באתר
  name        TEXT NOT NULL DEFAULT '' CHECK (char_length(name) <= 60),
  created_by  UUID DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_stickers_tenant_idx
  ON public.product_stickers (tenant_id, created_at DESC);

COMMENT ON TABLE public.product_stickers IS
  'גלריית המדבקות של החנות — מעלים פעם אחת ובוחרים בכל מוצר';

-- שם נקי, ועד 200 מדבקות לחנות (גלריה, לא מחסן קבצים)
CREATE OR REPLACE FUNCTION public.product_stickers_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := btrim(regexp_replace(COALESCE(NEW.name, ''), '\s+', ' ', 'g'));
  IF TG_OP = 'INSERT' AND (
       SELECT count(*) FROM public.product_stickers s WHERE s.tenant_id = NEW.tenant_id
     ) >= 200 THEN
    RAISE EXCEPTION 'בגלריה כבר יש 200 מדבקות — מחקו מדבקות שלא בשימוש כדי להוסיף חדשות';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS product_stickers_guard ON public.product_stickers;
CREATE TRIGGER product_stickers_guard
  BEFORE INSERT OR UPDATE ON public.product_stickers
  FOR EACH ROW EXECUTE FUNCTION public.product_stickers_guard();

ALTER TABLE public.product_stickers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_stickers;
CREATE POLICY tenant_isolation ON public.product_stickers
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- הניהול — מנהל החנות. הלקוחות מקבלים את המדבקה דרך get_catalog בלבד.
DROP POLICY IF EXISTS "stickers managed by admin" ON public.product_stickers;
CREATE POLICY "stickers managed by admin" ON public.product_stickers
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.product_stickers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_stickers TO authenticated;
GRANT ALL ON public.product_stickers TO service_role;

-- המדבקה של המוצר: מהגלריה, גודל (אחוז מרוחב התמונה) ושקיפות (אחוז)
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS sticker_id UUID
    REFERENCES public.product_stickers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sticker_size SMALLINT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS sticker_opacity SMALLINT NOT NULL DEFAULT 100;

DO $$ BEGIN
  ALTER TABLE public.global_products ADD CONSTRAINT global_products_sticker_size_check
    CHECK (sticker_size BETWEEN 10 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.global_products ADD CONSTRAINT global_products_sticker_opacity_check
    CHECK (sticker_opacity BETWEEN 10 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS global_products_sticker_idx
  ON public.global_products (sticker_id) WHERE sticker_id IS NOT NULL;

-- מדבקה רק מהגלריה של אותה חנות
CREATE OR REPLACE FUNCTION public.global_products_sticker_same_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sticker_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.sticker_id IS DISTINCT FROM OLD.sticker_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.product_stickers s
        WHERE s.id = NEW.sticker_id AND s.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'המדבקה לא נמצאה בגלריה של החנות';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS global_products_sticker_same_tenant ON public.global_products;
CREATE TRIGGER global_products_sticker_same_tenant
  BEFORE INSERT OR UPDATE OF sticker_id ON public.global_products
  FOR EACH ROW EXECUTE FUNCTION public.global_products_sticker_same_tenant();


-- ============================================================
-- 2. הקטלוג: + sticker
-- ============================================================
-- sticker = NULL כשאין מדבקה; אחרת {url, size, opacity, label}
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
  categories text[], is_featured boolean, sticker jsonb)
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
    gp.is_featured,
    -- חלק 23: מדבקת המוצר (פינה עליונה שמאלית של התמונה, עגולה)
    CASE WHEN ps.id IS NULL THEN NULL
         ELSE jsonb_build_object(
                'url', ps.image_url,
                'size', gp.sticker_size,
                'opacity', gp.sticker_opacity,
                'label', NULLIF(ps.name, ''))
    END AS sticker
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
  LEFT JOIN public.product_stickers ps
         ON ps.id = gp.sticker_id AND ps.tenant_id = gp.tenant_id
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


-- ============================================================
-- 3. סוג העוסק: פטור → מע"מ 0% נעול
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'authorized';
DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_business_type_check
    CHECK (business_type IN ('exempt', 'authorized'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.site_settings.business_type IS
  'exempt = עוסק פטור / זעיר (מע"מ 0%, נעול); authorized = עוסק מורשה / חברה';

-- עוסק פטור: המע"מ תמיד 0 (כל מי שקורא vat_rate — עגלה, קופה, פיד, מסמכים —
-- מקבל 0). חזרה לעוסק מורשה כשהמע"מ 0 → השיעור בישראל (18%).
CREATE OR REPLACE FUNCTION public.site_settings_vat_by_business_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.business_type = 'exempt' THEN
    NEW.vat_rate := 0;
  ELSIF TG_OP = 'UPDATE' AND OLD.business_type = 'exempt'
        AND COALESCE(NEW.vat_rate, 0) = 0 THEN
    NEW.vat_rate := 18;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS site_settings_vat_by_business_type ON public.site_settings;
CREATE TRIGGER site_settings_vat_by_business_type
  BEFORE INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_vat_by_business_type();


-- ============================================================
-- 4. הזמנה חדשה: המע"מ מהגדרות החנות, לא מהדפדפן
-- ============================================================
-- place_order מקבל את השיעור ואת "כולל מע"מ" מהקופה — לשונית ישנה (או בקשה
-- ידנית) הייתה יכולה לשלוח 18% בחנות פטורה, או 0% / "כולל" בחנות שמוסיפה
-- מע"מ ולשלם פחות. מה שנקבע ברגע ההזמנה הוא מה שהחנות מוגדרת אליו.
CREATE OR REPLACE FUNCTION public.orders_vat_from_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  SELECT st.business_type, st.vat_rate, st.prices_include_vat INTO s
    FROM public.site_settings st
   WHERE st.tenant_id = NEW.tenant_id;
  IF FOUND THEN
    NEW.vat_rate := CASE WHEN s.business_type = 'exempt' THEN 0
                         ELSE COALESCE(s.vat_rate, 18) END;
    NEW.prices_include_vat := COALESCE(s.prices_include_vat, true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_vat_from_settings ON public.orders;
CREATE TRIGGER orders_vat_from_settings
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_vat_from_settings();


-- ============================================================
-- 5. ספירת מלאי: שווי ליחידה לדו"ח הספירה
-- ============================================================
-- נקבע ברגע העדכון (היסטוריה): מחיר עלות כשיש, אחרת מחיר המכירה הרגיל
ALTER TABLE public.stock_count_lines
  ADD COLUMN IF NOT EXISTS unit_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS value_source TEXT;
DO $$ BEGIN
  ALTER TABLE public.stock_count_lines ADD CONSTRAINT stock_count_lines_value_source_check
    CHECK (value_source IS NULL OR value_source IN ('cost', 'price'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- שדות ההיסטוריה (כולל השווי) נקבעים רק בעדכון המלאי — לא מהדפדפן
CREATE OR REPLACE FUNCTION public.guard_stock_count_line()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.recorded_before := NULL;
  NEW.reserved_open := NULL;
  NEW.applied_quantity := NULL;
  NEW.unit_value := NULL;
  NEW.value_source := NULL;
  NEW.counted_at := now();
  -- מי ספר אחרון את המוצר הזה
  NEW.counted_by := CASE WHEN auth.uid() IS NULL THEN NEW.counted_by
                        ELSE public.tenant_member_id() END;
  RETURN NEW;
END; $function$;

-- כמו קודם (עדכון חותך רק למה שנספר; 0 / פחות ממארז → "אזל"), ובנוסף נשמר
-- השווי ליחידה — הדו"ח מציג את ההפרש בשקלים כפי שהיה ברגע הספירה
CREATE OR REPLACE FUNCTION public.apply_stock_count(_count_id uuid)
 RETURNS TABLE(counted integer, changed integer, marked_out_of_stock integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT * INTO c FROM public.stock_counts
   WHERE id = _count_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
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
    SELECT id, stock_quantity, pack_size, is_out_of_stock, out_of_stock_auto,
           cost_price, price_tier1 INTO p
      FROM public.global_products WHERE id = line.product_id AND tenant_id = c.tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(oi.reserved_quantity), 0)::integer INTO held
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.product_id = p.id
       AND o.kind = 'order'
       AND o.status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier')
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
       SET recorded_before = p.stock_quantity, reserved_open = held, applied_quantity = available,
           unit_value = CASE WHEN COALESCE(p.cost_price, 0) > 0 THEN p.cost_price
                             ELSE COALESCE(p.price_tier1, 0) END,
           value_source = CASE WHEN COALESCE(p.cost_price, 0) > 0 THEN 'cost' ELSE 'price' END
     WHERE id = line.id;
  END LOOP;

  UPDATE public.stock_counts
     SET status = 'applied', applied_by = public.tenant_member_id(), applied_at = now()
   WHERE id = _count_id;

  PERFORM set_config('kobi.stock_internal', 'off', true);
  RETURN QUERY SELECT n_counted, n_changed, n_marked;
END $function$;
REVOKE ALL ON FUNCTION public.apply_stock_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_stock_count(uuid) TO authenticated, service_role;

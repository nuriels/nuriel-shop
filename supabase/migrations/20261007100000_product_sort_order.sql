-- ============================================================
-- קובי: סדר מוצרים בתוך קטגוריה (גרירה בניהול) (07.10.2026)
-- ============================================================
-- global_products.sort_order — הסדר שהמנהל קבע בגרירה. NULL = עוד לא סודר:
-- מופיע אחרי המסודרים, מהחדש לישן (כמו שהיה עד היום) — כך שקטגוריות שלא
-- נוגעים בהן לא משתנות.
-- reorder_products(קטגוריה, רשימת מוצרים לפי הסדר החדש): מנהל בלבד, ובודק
-- במסד שכל המוצרים ברשימה שייכים לקטגוריה הזו (או לתת-קטגוריה שלה). הפונקציה
-- משנה רק את הסדר — לעולם לא את הקטגוריה. אידמפוטנטי.
-- ============================================================

ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

CREATE INDEX IF NOT EXISTS global_products_category_sort_idx
  ON public.global_products (category, sort_order);

CREATE OR REPLACE FUNCTION public.reorder_products(_category TEXT, _product_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed TEXT[];
  foreign_count INTEGER;
  updated INTEGER;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לשנות את סדר המוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _category IS NULL OR btrim(_category) = '' THEN
    RAISE EXCEPTION 'חסרה קטגוריה';
  END IF;
  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF array_length(_product_ids, 1) > 5000 THEN
    RAISE EXCEPTION 'יותר מדי מוצרים בבקשה אחת';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_product_ids) AS x) <> array_length(_product_ids, 1) THEN
    RAISE EXCEPTION 'רשימת המוצרים לא תקינה (מוצר כפול)';
  END IF;

  WITH RECURSIVE subtree(name) AS (
    SELECT _category
    UNION
    SELECT c.name FROM public.categories c JOIN subtree s ON c.parent_name = s.name
  )
  SELECT array_agg(name) INTO allowed FROM subtree;

  SELECT count(*) INTO foreign_count
    FROM unnest(_product_ids) AS x(id)
    LEFT JOIN public.global_products gp ON gp.id = x.id
   WHERE gp.id IS NULL OR NOT (gp.category = ANY (allowed));
  IF foreign_count > 0 THEN
    RAISE EXCEPTION 'שגיאה: לא ניתן להעביר מוצר לקטגוריה אחרת בגרירה. כדי לשנות קטגוריית מוצר, יש להיכנס לעריכת המוצר ולשנות זאת משם.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.global_products gp
     SET sort_order = o.pos * 10
    FROM unnest(_product_ids) WITH ORDINALITY AS o(id, pos)
   WHERE gp.id = o.id AND gp.sort_order IS DISTINCT FROM o.pos * 10;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;
REVOKE ALL ON FUNCTION public.reorder_products(TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_products(TEXT, UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- הקטלוג: אותה פונקציה בדיוק (20261007090000_custom_price_lists), רק הסדר
-- ------------------------------------------------------------
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
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated;

-- ============================================================
-- ניהול קטגוריות במסך הבית + מבצע עם תאריך תפוגה חובה (04.10.2026)
-- ============================================================
-- 1. categories.show_on_home — איזה קטגוריות מוצגות כריבועים במסך הבית
-- 2. מחיר מבצע מחייב תאריך סיום עתידי (נבדק רק כששדות המבצע עצמם משתנים,
--    כדי שלא לחסום מוצרים ישנים שכבר במבצע בלי תאריך — עד שהם נערכים שוב)
-- 3. get_catalog(): is_promo מחזיר האם המבצע *בפועל* בתוקף כרגע, ולא רק
--    שהמנהל אי-פעם סימן "מבצעים חמים" — כך מוצר עם מבצע שפג לא ממשיך
--    להופיע עם תגית "מבצע" בלי מחיר מוצלב.
-- אידמפוטנטי: בטוח להרצה חוזרת.
-- ============================================================

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS show_on_home BOOLEAN NOT NULL DEFAULT false;

-- ⚠️ תיקון באג קיים: "categories readable by everyone" (מ-07.09) מאפשרת
-- לאורחים לקרוא לפי ה-RLS, אבל אף מיגרציה מעולם לא נתנה לתפקיד anon את
-- הרשאת ה-SELECT ברמת הטבלה עצמה (Postgres דורש את שתיהן יחד). בפועל
-- אורח שמבקר באתר קיבל תמיד "permission denied" בשקט (הקוד בצד הלקוח בולע
-- את השגיאה) — כלומר לא ראה קטגוריות בכלל. חשוב במיוחד עכשיו שהדף הראשי
-- מוצג כריבועי קטגוריות.
GRANT SELECT ON public.categories TO anon;


-- ============================================================
-- מחיר מבצע: תאריך סיום חובה ועתידי, בנוסף לבדיקה הקיימת (נמוך מהרגיל)
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_product_sale_price()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  regular NUMERIC;
  sale_fields_changed BOOLEAN;
BEGIN
  IF NEW.sale_price IS NULL THEN
    RETURN NEW;
  END IF;

  sale_fields_changed := TG_OP = 'INSERT'
    OR NEW.sale_price IS DISTINCT FROM OLD.sale_price
    OR NEW.sale_ends_at IS DISTINCT FROM OLD.sale_ends_at
    OR NEW.price_tier1 IS DISTINCT FROM OLD.price_tier1
    OR NEW.price_tier2 IS DISTINCT FROM OLD.price_tier2
    OR NEW.price_tier3 IS DISTINCT FROM OLD.price_tier3;

  -- מוצר ישן עם מבצע שנשמר לפני התוספת הזו (בלי תאריך) — לא נחסם בעדכון
  -- שלא נוגע במבצע עצמו (למשל שינוי מלאי). ברגע שהמבצע עצמו נערך שוב,
  -- הכלל נאכף.
  IF NOT sale_fields_changed THEN
    RETURN NEW;
  END IF;

  IF NEW.sale_ends_at IS NULL THEN
    RAISE EXCEPTION 'מחיר מבצע מחייב תאריך ושעת סיום' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sale_ends_at <= now() THEN
    RAISE EXCEPTION 'תאריך סיום המבצע חייב להיות בעתיד' USING ERRCODE = 'check_violation';
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


-- ============================================================
-- get_catalog(): is_promo = מבצע שבאמת בתוקף עכשיו (לא רק שסומן אי-פעם)
-- ============================================================
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

-- ============================================================
-- קליטת מלאי בסריקה: מוצרים שממתינים לאישור, וסימון "חדש באתר".
-- ============================================================

-- ============================================================
-- 1. מוצרים שנסרקו ואינם קיימים בקטלוג — ממתינים לאישור
-- ============================================================
-- כשסורקים ברקוד שאין לו מוצר, לא יוצרים מוצר "על עיוור" (אין שם, אין
-- קטגוריה, אין מחירים — והוא היה מופיע מיד ללקוחות). במקום זה נרשמת
-- בקשה בטבלה הזו, והמנהל משלים אותה למוצר אמיתי בלשונית ייעודית.
CREATE TABLE IF NOT EXISTS public.pending_products (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barcode        TEXT,
  suggested_name TEXT NOT NULL DEFAULT '',
  image_url      TEXT,
  /** כמה פעמים הפריט נסרק — עוזר להעריך כמות שהתקבלה במשלוח */
  scanned_count  INTEGER NOT NULL DEFAULT 1 CHECK (scanned_count >= 0),
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by     UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ברקוד ממתין אחד לכל קוד: סריקה חוזרת מגדילה מונה במקום ליצור כפילות
CREATE UNIQUE INDEX IF NOT EXISTS pending_products_barcode_idx
  ON public.pending_products (barcode) WHERE barcode IS NOT NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS pending_products_status_idx
  ON public.pending_products (status, created_at DESC);

GRANT SELECT ON public.pending_products TO authenticated;
GRANT ALL ON public.pending_products TO service_role;
ALTER TABLE public.pending_products ENABLE ROW LEVEL SECURITY;

-- קריאה לצוות בלבד; הכתיבה נעשית דרך server functions (service role)
DROP POLICY IF EXISTS "pending products readable by staff" ON public.pending_products;
CREATE POLICY "pending products readable by staff" ON public.pending_products
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP TRIGGER IF EXISTS pending_products_updated_at ON public.pending_products;
CREATE TRIGGER pending_products_updated_at
BEFORE UPDATE ON public.pending_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. "חדש באתר": חושפים את תאריך ההוספה בקטלוג הציבורי
-- ============================================================
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN,
  price NUMERIC, original_price NUMERIC, sale_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
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
    gp.created_at
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

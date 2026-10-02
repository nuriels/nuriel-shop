-- ============================================================
-- הגנת סופר-אדמין, תיק לקוח (עגלה חיה), חתימה על תנאי שירות,
-- מחירי מבצע לפי תאריכים, איתור במחסן ומצב תחזוקה.
-- כל הסעיפים אידמפוטנטיים — הרצה חוזרת אחרי כשל חלקי ממשיכה בלי ליפול.
-- ============================================================

-- ============================================================
-- 1. סופר-אדמין מוגן: אי אפשר לחסום, למחוק או לשנות לו הרשאות
-- ============================================================
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;

-- המנהל הראשי: החשבון של בעל המערכת, ואם אינו קיים — המנהל הוותיק ביותר.
DO $$
DECLARE target UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE is_protected = true) THEN
    SELECT user_id INTO target FROM public.user_roles
     WHERE lower(btrim(email)) = 'nuriel.sh1@gmail.com' LIMIT 1;
    IF target IS NULL THEN
      SELECT user_id INTO target FROM public.user_roles
       WHERE role = 'admin' ORDER BY created_at, user_id LIMIT 1;
    END IF;
    IF target IS NOT NULL THEN
      UPDATE public.user_roles
         SET is_protected = true, role = 'admin', is_approved = true, is_blocked = false
       WHERE user_id = target;
    END IF;
  END IF;
END $$;

-- אכיפה במסד, לא רק בממשק: גם קריאה ישירה ל-API לא תוכל לפגוע בחשבון הזה.
CREATE OR REPLACE FUNCTION public.guard_protected_admin_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_protected THEN
    IF NEW.role <> 'admin' THEN
      RAISE EXCEPTION 'אי אפשר לשנות את ההרשאות של המנהל הראשי';
    END IF;
    IF NEW.is_blocked THEN
      RAISE EXCEPTION 'אי אפשר לחסום את המנהל הראשי';
    END IF;
    IF NOT NEW.is_approved THEN
      RAISE EXCEPTION 'אי אפשר לבטל את האישור של המנהל הראשי';
    END IF;
    -- ההגנה עצמה מוסרת רק ישירות במסד (psql), לא דרך האפליקציה
    IF NOT NEW.is_protected AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'אי אפשר להסיר את ההגנה מהמנהל הראשי דרך האפליקציה';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_roles_guard_protected_update ON public.user_roles;
CREATE TRIGGER user_roles_guard_protected_update
BEFORE UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_protected_admin_update();

CREATE OR REPLACE FUNCTION public.guard_protected_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_protected THEN
    RAISE EXCEPTION 'אי אפשר למחוק את המנהל הראשי';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS user_roles_guard_protected_delete ON public.user_roles;
CREATE TRIGGER user_roles_guard_protected_delete
BEFORE DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_protected_admin_delete();

-- הרחבת ההגנה על עמודות רגישות: גם is_protected לא ניתן לשינוי ע"י המשתמש
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.is_blocked := OLD.is_blocked;
    NEW.email := OLD.email;
    NEW.agent_number := OLD.agent_number;
  END IF;
  -- is_protected אינו ניתן לשינוי מהאפליקציה בכלל, גם לא ע"י אדמין
  NEW.is_protected := OLD.is_protected;
  RETURN NEW;
END; $$;

-- ============================================================
-- 2. קטגוריות: ביטול היצירה האוטומטית
-- ============================================================
-- המיגרציה של המעבר לקטלוג משקאות זרעה 9 קטגוריות ברירת מחדל. לפי ההנחיה
-- אין יצירה אוטומטית בכלל — המנהל בונה את הרשימה מאפס. מוסרות כאן רק
-- קטגוריות שנזרעו ואף מוצר לא משתמש בהן (כדי לא לשבור נתונים אמיתיים).
DELETE FROM public.categories c
WHERE c.name IN (
  'משקאות מוגזים', 'מים ומים מוגזים', 'מיצים ומשקאות טבעיים',
  'משקאות אנרגיה וספורט', 'בירות', 'יינות', 'משקאות חריפים',
  'קוקטיילים מוכנים', 'קפה ומשקאות חמים'
)
AND NOT EXISTS (SELECT 1 FROM public.global_products p WHERE p.category = c.name);

-- ============================================================
-- 3. מוצרים: מחיר מבצע לפי תאריכים, תמחור אחיד ואיתור במחסן
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS sale_price NUMERIC(12,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  ADD COLUMN IF NOT EXISTS sale_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS uniform_price BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shelf_location TEXT;

/**
 * האם המבצע של המוצר פעיל כרגע: קיים מחיר מבצע, ואנחנו בתוך טווח
 * התאריכים (NULL בקצה = פתוח לאותו כיוון).
 */
CREATE OR REPLACE FUNCTION public.sale_is_active(
  _sale_price NUMERIC, _starts TIMESTAMPTZ, _ends TIMESTAMPTZ
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT _sale_price IS NOT NULL
     AND (_starts IS NULL OR _starts <= now())
     AND (_ends IS NULL OR _ends >= now());
$$;
GRANT EXECUTE ON FUNCTION public.sale_is_active(numeric, timestamptz, timestamptz) TO anon, authenticated, service_role;

-- get_catalog: מחזיר את המחיר בתוקף + המחיר המקורי כשיש מבצע (להצגה מחוקה)
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN,
  price NUMERIC, original_price NUMERIC, sale_ends_at TIMESTAMPTZ
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
    END AS sale_ends_at
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
-- 4. איתור במחסן בשורת ההזמנה (לבון הליקוט)
-- ============================================================
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS product_shelf_location TEXT;

CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; parent RECORD;
BEGIN
  SELECT name, sku, barcode, category, image_url, shelf_location INTO p
  FROM public.global_products WHERE id = NEW.product_id;
  IF FOUND THEN
    NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name);
    NEW.product_sku := COALESCE(NEW.product_sku, p.sku);
    NEW.product_barcode := COALESCE(NEW.product_barcode, p.barcode);
    NEW.product_category := COALESCE(NEW.product_category, p.category);
    NEW.product_image_url := COALESCE(NEW.product_image_url, p.image_url);
    NEW.product_shelf_location := COALESCE(NEW.product_shelf_location, p.shelf_location);
  END IF;

  SELECT kind INTO parent FROM public.orders WHERE id = NEW.order_id;
  IF FOUND AND parent.kind = 'quote' AND NOT public.is_staff(auth.uid()) THEN
    NEW.unit_price := 0;
  END IF;
  RETURN NEW;
END; $$;

UPDATE public.order_items oi
SET product_shelf_location = gp.shelf_location
FROM public.global_products gp
WHERE gp.id = oi.product_id AND oi.product_shelf_location IS NULL AND gp.shelf_location IS NOT NULL;

-- ============================================================
-- 5. עגלת קניות שמורה (תיק הלקוח — "עגלה חיה")
-- ============================================================
-- העגלה נשמרת בשרת ולא רק בדפדפן, כדי שמנהל/סוכן יראו בזמן אמת מה הלקוח
-- אוסף, והלקוח לא יאבד את הסל בין מכשירים.
CREATE TABLE IF NOT EXISTS public.customer_carts (
  user_id    UUID NOT NULL PRIMARY KEY REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_carts TO authenticated;
GRANT ALL ON public.customer_carts TO service_role;
ALTER TABLE public.customer_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cart readable by owner or staff" ON public.customer_carts;
CREATE POLICY "cart readable by owner or staff" ON public.customer_carts
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), user_id))
);

DROP POLICY IF EXISTS "cart written by owner" ON public.customer_carts;
CREATE POLICY "cart written by owner" ON public.customer_carts
FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cart updated by owner" ON public.customer_carts;
CREATE POLICY "cart updated by owner" ON public.customer_carts
FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cart deleted by owner or admin" ON public.customer_carts;
CREATE POLICY "cart deleted by owner or admin" ON public.customer_carts
FOR DELETE TO authenticated USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS customer_carts_updated_at ON public.customer_carts;
CREATE TRIGGER customer_carts_updated_at
BEFORE UPDATE ON public.customer_carts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 6. חתימה דיגיטלית על תנאי השירות
-- ============================================================
-- הטופס נשלח במייל עם קישור ייחודי. הטוקן נשמר כ-hash בלבד (כמו באיפוס
-- סיסמה), והמסמך החתום נשמר בתיק הלקוח יחד עם נוסח התנאים שנחתם בפועל.
CREATE TABLE IF NOT EXISTS public.service_agreements (
  user_id        UUID NOT NULL PRIMARY KEY REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  token_hash     TEXT UNIQUE,
  sent_at        TIMESTAMPTZ,
  signed_at      TIMESTAMPTZ,
  signer_name    TEXT,
  /** חתימת העכבר/מגע כ-SVG path, או NULL אם נחתם בשם מוקלד בלבד */
  signature_svg  TEXT,
  /** נוסח התנאים שנחתם בפועל — כדי שנוכל להוכיח על מה נחתם */
  terms_snapshot TEXT,
  signer_ip      TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_agreements_signed_idx ON public.service_agreements (signed_at);

GRANT SELECT ON public.service_agreements TO authenticated;
GRANT ALL ON public.service_agreements TO service_role;
ALTER TABLE public.service_agreements ENABLE ROW LEVEL SECURITY;

-- קריאה בלבד מהאפליקציה; היצירה והחתימה נעשות בשרת (service role)
DROP POLICY IF EXISTS "agreement readable by owner or staff" ON public.service_agreements;
CREATE POLICY "agreement readable by owner or staff" ON public.service_agreements
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), user_id))
);

-- ============================================================
-- 7. מצב תחזוקה
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message TEXT NOT NULL DEFAULT
    'האתר בשיפוצים ויחזור לפעילות בקרוב. לכל דבר דחוף אנחנו זמינים בטלפון.';

-- בידוד נתונים מלא: כל משתמש רואה אך ורק את המוצרים והקטגוריות שלו
-- (או של סניפים ששותפו איתו מפורשות). אידמפוטנטי — בטוח להרצה חוזרת.

-- ============================================================
-- 1. מוצרים: קריאה/עדכון רק לבעל המוצר, לסופר-אדמין,
--    או למי שיש לו גישה לסניף שהמוצר נמצא במלאי שלו
-- ============================================================
CREATE INDEX IF NOT EXISTS store_inventory_product_idx
  ON public.store_inventory (product_id);

DROP POLICY IF EXISTS "products readable by approved" ON public.global_products;
CREATE POLICY "products readable by owner or store access" ON public.global_products
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (public.is_approved(auth.uid()) AND (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.store_inventory si
      WHERE si.product_id = global_products.id
        AND public.owns_store(si.store_id, auth.uid())
    )
  ))
);

DROP POLICY IF EXISTS "products update by creator" ON public.global_products;
CREATE POLICY "products update by creator or store access" ON public.global_products
FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (public.is_approved(auth.uid()) AND (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.store_inventory si
      WHERE si.product_id = global_products.id
        AND public.owns_store(si.store_id, auth.uid())
    )
  ))
)
WITH CHECK (true);

-- ============================================================
-- 2. קטגוריות: מרשימה גלובלית אחת → רשימה פרטית לכל משתמש.
--    בלי קטגוריות ברירת-מחדל — כל משתמש בונה לעצמו.
-- ============================================================
ALTER TABLE public.global_products
  DROP CONSTRAINT IF EXISTS global_products_category_fkey;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS owner_id UUID;

-- בנייה מחדש של התוכן: מחיקת ברירות המחדל הגלובליות,
-- ויצירת קטגוריה פרטית לכל יוצר לפי המוצרים הקיימים שלו
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.categories WHERE owner_id IS NULL
  ) THEN
    DELETE FROM public.categories WHERE owner_id IS NULL;
    INSERT INTO public.categories (name, owner_id, sort_order)
    SELECT DISTINCT gp.category, gp.created_by, 100
    FROM public.global_products gp
    WHERE gp.category IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- מפתח ראשי חדש: ייחודיות פר (משתמש, שם) במקום שם גלובלי
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_pkey'
      AND conrelid = 'public.categories'::regclass
      AND pg_get_constraintdef(oid) NOT LIKE '%owner_id%'
  ) THEN
    ALTER TABLE public.categories DROP CONSTRAINT categories_pkey;
    ALTER TABLE public.categories ALTER COLUMN owner_id SET NOT NULL;
    ALTER TABLE public.categories ADD PRIMARY KEY (owner_id, name);
  END IF;
END $$;

-- הבעלים נקבע אוטומטית למשתמש המחובר בהוספה מהלקוח
ALTER TABLE public.categories ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- מדיניות חדשה: כל משתמש מאושר מנהל את הקטגוריות של עצמו בלבד
DROP POLICY IF EXISTS "categories readable by approved" ON public.categories;
DROP POLICY IF EXISTS "categories insert by super admin" ON public.categories;
DROP POLICY IF EXISTS "categories update by super admin" ON public.categories;
DROP POLICY IF EXISTS "categories delete by super admin" ON public.categories;

CREATE POLICY "categories select own" ON public.categories
FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR (public.is_approved(auth.uid()) AND owner_id = auth.uid()));

CREATE POLICY "categories insert own" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (public.is_approved(auth.uid()) AND owner_id = auth.uid());

CREATE POLICY "categories update own" ON public.categories
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "categories delete own" ON public.categories
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()) OR owner_id = auth.uid());

-- ============================================================
-- 3. שמירת שלמות: קטגוריית מוצר חייבת להתקיים אצל יוצר המוצר
--    (מחליף את ה-FK הגלובלי שהוסר)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_product_category()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- הקטגוריה תקינה אם היא קיימת אצל יוצר המוצר, או אצל העורך הנוכחי
  -- (שותף/בעלים חדש שעורך מוצר שנוצר ע"י אחר)
  IF NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.name = NEW.category
      AND (c.owner_id = NEW.created_by OR (auth.uid() IS NOT NULL AND c.owner_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'קטגוריה "%" לא קיימת אצלך — הוסיפו אותה קודם (כפתור +)', NEW.category;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS product_category_check ON public.global_products;
CREATE TRIGGER product_category_check
BEFORE INSERT OR UPDATE OF category ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.check_product_category();

-- ============================================================
-- 4. שינוי שם קטגוריה: אטומי — הקטגוריה וכל מוצרי הבעלים יחד
-- ============================================================
CREATE OR REPLACE FUNCTION public.rename_user_category(_owner UUID, _old TEXT, _new TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated INTEGER;
BEGIN
  IF length(btrim(_new)) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'שם קטגוריה חייב להכיל 1 עד 30 תווים';
  END IF;
  UPDATE public.categories SET name = btrim(_new)
  WHERE owner_id = _owner AND name = _old;
  IF NOT FOUND THEN RAISE EXCEPTION 'הקטגוריה לא נמצאה'; END IF;
  UPDATE public.global_products SET category = btrim(_new)
  WHERE created_by = _owner AND category = _old;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;
REVOKE ALL ON FUNCTION public.rename_user_category(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_user_category(uuid, text, text) TO service_role;

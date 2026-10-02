-- קטגוריות דינמיות: טבלה מנוהלת במקום רשימה קשיחה ב-CHECK.
-- שינוי שם קטגוריה מתעדכן אוטומטית בכל המוצרים (ON UPDATE CASCADE);
-- מחיקת קטגוריה שיש בה מוצרים נחסמת (ON DELETE RESTRICT).

CREATE TABLE public.categories (
  name       TEXT PRIMARY KEY CHECK (length(btrim(name)) BETWEEN 1 AND 30),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.categories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- כל משתמש מאושר קורא; רק הסופר-אדמין מנהל
CREATE POLICY "categories readable by approved" ON public.categories
FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid()));

CREATE POLICY "categories insert by super admin" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "categories update by super admin" ON public.categories
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "categories delete by super admin" ON public.categories
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

-- זריעה: חמש קטגוריות הבסיס + כל ערך שכבר קיים במוצרים
INSERT INTO public.categories (name, sort_order) VALUES
  ('עגילים', 1), ('שרשרת', 2), ('טבעת', 3), ('שעון', 4), ('סט', 5)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.categories (name)
SELECT DISTINCT category FROM public.global_products
ON CONFLICT (name) DO NOTHING;

-- החלפת ה-CHECK הקשיח במפתח זר מדורג
ALTER TABLE public.global_products
  DROP CONSTRAINT IF EXISTS global_products_category_check;

ALTER TABLE public.global_products
  ADD CONSTRAINT global_products_category_fkey
  FOREIGN KEY (category) REFERENCES public.categories(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

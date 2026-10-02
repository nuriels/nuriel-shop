-- ============================================================
-- עץ קטגוריות: תת-קטגוריות עד 3 רמות (אלכוהול ← וויסקי ← סקוטי),
-- תמונה לקטגוריה, וסדר קבוע בין קטגוריות אחיות.
-- ============================================================
-- המפתח נשאר השם (ייחודי בכל העץ), כך שכל מה שכבר מפנה לקטגוריה לפי
-- שם — מוצרים, מסמכים, דוחות — ממשיך לעבוד בלי שינוי. תת-קטגוריה מפנה
-- לאב שלה לפי שם, עם ON UPDATE CASCADE: שינוי שם של אב מעדכן אוטומטית
-- גם את הילדים וגם את המוצרים. ON DELETE RESTRICT: אי אפשר למחוק קטגוריה
-- שיש בה מוצרים או תת-קטגוריות — מוצר לעולם לא נמחק בגלל מחיקת קטגוריה.
--
-- אידמפוטנטי: בטוח להרצה חוזרת.

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_name TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image_url TEXT;

DO $$
BEGIN
  ALTER TABLE public.categories
    ADD CONSTRAINT categories_parent_fkey FOREIGN KEY (parent_name)
    REFERENCES public.categories(name) ON UPDATE CASCADE ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.categories
    ADD CONSTRAINT categories_not_own_parent CHECK (parent_name IS NULL OR parent_name <> name);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS categories_parent_idx ON public.categories (parent_name, sort_order);

-- ============================================================
-- שמירה על מבנה העץ בשרת (לא רק בממשק):
-- 1. אין מעגלים — קטגוריה לא יכולה לעבור אל תוך עצמה או תת-קטגוריה שלה
-- 2. עומק מקסימלי 3 — כולל כשמעבירים ענף שלם עם הילדים שלו
-- ============================================================
CREATE OR REPLACE FUNCTION public.categories_tree_guard()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  self_name TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.name ELSE NEW.name END;
  cursor_name TEXT := NEW.parent_name;
  parent_depth INTEGER := 0;
  subtree_height INTEGER := 0;
BEGIN
  IF NEW.parent_name IS NULL THEN
    RETURN NEW;
  END IF;

  WHILE cursor_name IS NOT NULL LOOP
    IF cursor_name = self_name OR cursor_name = NEW.name THEN
      RAISE EXCEPTION 'אי אפשר להעביר קטגוריה אל תוך עצמה או אל תוך תת-קטגוריה שלה';
    END IF;
    parent_depth := parent_depth + 1;
    IF parent_depth > 10 THEN
      RAISE EXCEPTION 'מבנה הקטגוריות אינו תקין (נמצא מעגל)';
    END IF;
    SELECT c.parent_name INTO cursor_name FROM public.categories c WHERE c.name = cursor_name;
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE sub(name, lvl) AS (
      SELECT c.name, 1 FROM public.categories c WHERE c.parent_name = OLD.name
      UNION ALL
      SELECT c.name, s.lvl + 1
        FROM public.categories c
        JOIN sub s ON c.parent_name = s.name
       WHERE s.lvl < 10
    )
    SELECT COALESCE(max(lvl), 0) INTO subtree_height FROM sub;
  END IF;

  IF parent_depth + 1 + subtree_height > 3 THEN
    RAISE EXCEPTION 'אפשר עד 3 רמות של קטגוריות — המיקום הזה יוצר רמה רביעית';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS categories_tree_guard ON public.categories;
CREATE TRIGGER categories_tree_guard
BEFORE INSERT OR UPDATE OF parent_name ON public.categories
FOR EACH ROW EXECUTE FUNCTION public.categories_tree_guard();

-- ============================================================
-- שינוי שם: מחזיר כמה מוצרים עודכנו (קודם הוחזר תמיד 1 — מספר שורות
-- הקטגוריות), ומאפשר קריאה מהשרת עם service role. בגרסה הקודמת הקריאה
-- מהשרת נחסמה תמיד ב"אין הרשאה", כי auth.uid() ריק תחת service role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rename_category(_old TEXT, _new TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE products_count INTEGER;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  IF length(btrim(_new)) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'שם קטגוריה חייב להכיל 1 עד 30 תווים';
  END IF;
  SELECT count(*) INTO products_count FROM public.global_products WHERE category = _old;
  UPDATE public.categories SET name = btrim(_new) WHERE name = _old;
  IF NOT FOUND THEN RAISE EXCEPTION 'הקטגוריה לא נמצאה'; END IF;
  RETURN products_count;
END; $$;
REVOKE ALL ON FUNCTION public.rename_category(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_category(text, text) TO authenticated, service_role;

-- ============================================================
-- סידור קטגוריות אחיות: מקבל את השמות בסדר הרצוי ושומר אותו אטומית
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_category_order(_names TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  UPDATE public.categories c
     SET sort_order = o.ord
    FROM unnest(_names) WITH ORDINALITY AS o(name, ord)
   WHERE c.name = o.name;
END; $$;
REVOKE ALL ON FUNCTION public.set_category_order(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_category_order(text[]) TO authenticated, service_role;

-- ============================================================
-- ספירת מוצרים לכל קטגוריה (ישירות בה, בלי תת-קטגוריות) — לפאנל הניהול.
-- נספר בשרת כדי שהמספר יהיה מדויק גם כשיש יותר מוצרים ממגבלת השורות של ה-API.
-- ============================================================
CREATE OR REPLACE FUNCTION public.category_product_counts()
RETURNS TABLE (category TEXT, products BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gp.category, count(*) FROM public.global_products gp GROUP BY gp.category;
$$;
REVOKE ALL ON FUNCTION public.category_product_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.category_product_counts() TO authenticated, service_role;

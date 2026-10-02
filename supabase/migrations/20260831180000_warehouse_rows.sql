-- מבנה מחסן פר-משתמש: שורות עם מספר מדפים גמיש. אידמפוטנטי.

CREATE TABLE IF NOT EXISTS public.warehouse_rows (
  owner_id    UUID NOT NULL DEFAULT auth.uid(),
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 20),
  shelf_count INTEGER NOT NULL DEFAULT 4 CHECK (shelf_count BETWEEN 1 AND 100),
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouse_rows TO authenticated;
GRANT ALL ON public.warehouse_rows TO service_role;
ALTER TABLE public.warehouse_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse select own" ON public.warehouse_rows;
CREATE POLICY "warehouse select own" ON public.warehouse_rows
FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR (public.is_approved(auth.uid()) AND owner_id = auth.uid()));

DROP POLICY IF EXISTS "warehouse insert own" ON public.warehouse_rows;
CREATE POLICY "warehouse insert own" ON public.warehouse_rows
FOR INSERT TO authenticated
WITH CHECK (public.is_approved(auth.uid()) AND owner_id = auth.uid());

DROP POLICY IF EXISTS "warehouse update own" ON public.warehouse_rows;
CREATE POLICY "warehouse update own" ON public.warehouse_rows
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "warehouse delete own" ON public.warehouse_rows;
CREATE POLICY "warehouse delete own" ON public.warehouse_rows
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()) OR owner_id = auth.uid());

-- זריעה חד-פעמית: שורות שכבר בשימוש במוצרים קיימים ("0" = ללא מיקום, לא נזרעת)
INSERT INTO public.warehouse_rows (owner_id, name)
SELECT DISTINCT created_by, btrim(row_number)
FROM public.global_products
WHERE row_number IS NOT NULL AND btrim(row_number) NOT IN ('', '0')
ON CONFLICT (owner_id, name) DO NOTHING;

-- שינוי שם שורה: אטומי — השורה וכל מוצרי הבעלים יחד
CREATE OR REPLACE FUNCTION public.rename_warehouse_row(_owner UUID, _old TEXT, _new TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated INTEGER;
BEGIN
  IF length(btrim(_new)) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'שם שורה חייב להכיל 1 עד 20 תווים';
  END IF;
  UPDATE public.warehouse_rows SET name = btrim(_new)
  WHERE owner_id = _owner AND name = _old;
  IF NOT FOUND THEN RAISE EXCEPTION 'השורה לא נמצאה'; END IF;
  UPDATE public.global_products SET row_number = btrim(_new)
  WHERE created_by = _owner AND row_number = _old;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;
REVOKE ALL ON FUNCTION public.rename_warehouse_row(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_warehouse_row(uuid, text, text) TO service_role;

-- ============================================================
-- חלק 18: ייבוא CSV חכם — תמונות שמורות אצלנו, וקטגוריות מרובות שנוצרות לבד
--
-- 1. categories.id — מזהה קבוע לכל קטגוריה (המפתח הקיים הוא (tenant_id, name),
--    ושם משתנה בשינוי שם; טבלת הקשר נשענת על המזהה).
-- 2. product_categories — מוצר יכול להיות בכמה קטגוריות. global_products.category
--    נשארת "הקטגוריה הראשית" (כל המסכים הקיימים ממשיכים לעבוד), והיא תמיד
--    גם בטבלת הקשר (טריגר). שורות קיימות מתמלאות כאן.
-- 3. get_catalog מחזיר גם categories — כל הקטגוריות של המוצר — כדי שהקטלוג
--    יציג מוצר בכל הקטגוריות שלו.
-- 4. import_products מקבל לכל שורה:
--      images     — רשימת קישורים (השרת כבר הוריד את התמונות ושמר אותן אצלנו)
--      categories — רשימת נתיבים [["מחשבים", "מחשבים ניידים"], ["כבלים"]]:
--                   קטגוריה שלא קיימת נוצרת (כולל קטגוריות האב בנתיב), והמוצר
--                   מקושר לכל הקטגוריות. הראשונה = הקטגוריה הראשית.
--    (השדות הישנים image_url / category עדיין נתמכים.)
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. מזהה לקטגוריה
-- ============================================================
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.categories'::regclass AND conname = 'categories_id_key') THEN
    ALTER TABLE public.categories ADD CONSTRAINT categories_id_key UNIQUE (id);
  END IF;
END $$;

COMMENT ON COLUMN public.categories.id IS
  'חלק 18: מזהה קבוע (לא משתנה בשינוי שם) — לטבלת הקשר product_categories';

-- ============================================================
-- 2. product_categories — מוצר ↔ קטגוריות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_categories (
  tenant_id   uuid NOT NULL DEFAULT public.current_tenant_id()
              REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);
COMMENT ON TABLE public.product_categories IS
  'חלק 18: כל הקטגוריות של מוצר (כולל הראשית — global_products.category)';

CREATE INDEX IF NOT EXISTS product_categories_category_idx ON public.product_categories (category_id);
CREATE INDEX IF NOT EXISTS product_categories_tenant_idx ON public.product_categories (tenant_id);

-- המוצר והקטגוריה — של אותה חנות כמו השורה
CREATE OR REPLACE FUNCTION public.product_categories_same_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.global_products gp
                  WHERE gp.id = NEW.product_id AND gp.tenant_id = NEW.tenant_id)
     OR NOT EXISTS (SELECT 1 FROM public.categories c
                     WHERE c.id = NEW.category_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'המוצר והקטגוריה חייבים להיות של אותה חנות'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.product_categories_same_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS product_categories_same_tenant ON public.product_categories;
CREATE TRIGGER product_categories_same_tenant
BEFORE INSERT OR UPDATE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.product_categories_same_tenant();

-- הקטגוריה הראשית לא יוצאת מהרשימה (גם לא במחיקה ישירה מהדפדפן)
CREATE OR REPLACE FUNCTION public.product_categories_keep_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('kobi.product_category_sync', true) IS DISTINCT FROM 'on'
     AND EXISTS (SELECT 1 FROM public.global_products gp
                   JOIN public.categories c ON c.tenant_id = gp.tenant_id AND c.name = gp.category
                  WHERE gp.id = OLD.product_id AND c.id = OLD.category_id) THEN
    RAISE EXCEPTION 'אי אפשר להסיר את הקטגוריה הראשית של המוצר — משנים אותה בעריכת המוצר'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.product_categories_keep_primary() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS product_categories_keep_primary ON public.product_categories;
CREATE TRIGGER product_categories_keep_primary
BEFORE DELETE ON public.product_categories
FOR EACH ROW EXECUTE FUNCTION public.product_categories_keep_primary();

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_categories;
CREATE POLICY tenant_isolation ON public.product_categories
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- הקטלוג ציבורי (כמו הקטגוריות עצמן)
DROP POLICY IF EXISTS "product categories readable by everyone" ON public.product_categories;
CREATE POLICY "product categories readable by everyone" ON public.product_categories
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "product categories added by admin" ON public.product_categories;
CREATE POLICY "product categories added by admin" ON public.product_categories
  FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "product categories removed by admin" ON public.product_categories;
CREATE POLICY "product categories removed by admin" ON public.product_categories
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.product_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_categories TO anon, authenticated;
GRANT INSERT, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

-- הקטגוריה הראשית (global_products.category) תמיד מקושרת; החלפת הראשית —
-- הקישור עובר מהישנה לחדשה (שינוי שם של קטגוריה לא משנה דבר: המזהה נשאר)
CREATE OR REPLACE FUNCTION public.global_products_sync_primary_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('kobi.product_category_sync', 'on', true);
  IF TG_OP = 'UPDATE' AND NEW.category IS DISTINCT FROM OLD.category THEN
    DELETE FROM public.product_categories pc
     USING public.categories c
     WHERE pc.product_id = NEW.id
       AND pc.category_id = c.id
       AND c.tenant_id = NEW.tenant_id
       AND c.name = OLD.category;
  END IF;
  INSERT INTO public.product_categories (tenant_id, product_id, category_id)
  SELECT NEW.tenant_id, NEW.id, c.id
    FROM public.categories c
   WHERE c.tenant_id = NEW.tenant_id AND c.name = NEW.category
  ON CONFLICT DO NOTHING;
  PERFORM set_config('kobi.product_category_sync', 'off', true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.global_products_sync_primary_category() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS global_products_sync_primary_category ON public.global_products;
CREATE TRIGGER global_products_sync_primary_category
AFTER INSERT OR UPDATE OF category ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.global_products_sync_primary_category();

-- מילוי ראשוני: הקטגוריה הראשית של כל מוצר קיים
INSERT INTO public.product_categories (tenant_id, product_id, category_id)
SELECT gp.tenant_id, gp.id, c.id
  FROM public.global_products gp
  JOIN public.categories c ON c.tenant_id = gp.tenant_id AND c.name = gp.category
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. הקטלוג: כל הקטגוריות של כל מוצר (categories)
--    זהה לחלק 10, ועמודה אחת נוספת בסוף
-- ============================================================
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
  categories text[])
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
    -- למוצר עם וריאציות: "אזל" רק כשאף וריאציה לא זמינה
    (gp.is_out_of_stock OR (var.list IS NOT NULL AND NOT var.any_available)) AS is_out_of_stock,
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
    COALESCE(cats.names, ARRAY[gp.category]) AS categories
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
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN pr.base_price IS NULL THEN NULL
             WHEN pr.sale_applies THEN gp.sale_price
             ELSE pr.base_price
           END AS price
  ) fp
  -- הוריאציות הפעילות: מחיר (משלה, או המחיר של המוצר לצופה) וזמינות — בלי
  -- לחשוף כמה יחידות יש במלאי
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
               CASE WHEN pv.stock_quantity IS NULL THEN NOT gp.is_out_of_stock
                    ELSE pv.stock_quantity >= GREATEST(COALESCE(gp.pack_size, 1), 1) END AS available
          FROM public.product_variants pv
         WHERE pv.product_id = gp.id AND pv.is_active
      ) x
  ) var ON true
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
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated, service_role;

-- ============================================================
-- 4. ייבוא CSV — תמונות מרובות וקטגוריות מרובות
-- ============================================================
-- קטגוריה לפי נתיב (["מחשבים", "מחשבים ניידים"]): מה שחסר נוצר, האב — רק
-- לקטגוריה חדשה (קטגוריה קיימת לא זזה). עד 3 רמות (הנתיב נחתך מהסוף).
-- מחזיר {"leaf": הקטגוריה העמוקה בנתיב, "created": [מה שנוצר]}.
DROP FUNCTION IF EXISTS public.import_ensure_category_path(uuid, jsonb, text[]);
CREATE OR REPLACE FUNCTION public.import_ensure_category_path(_tenant uuid, _path jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _names text[] := '{}';
  _name text;
  _parent text := NULL;
  _inserted integer;
  _leaf text := NULL;
  _created text[] := '{}';
BEGIN
  IF _path IS NULL OR jsonb_typeof(_path) <> 'array' THEN
    RETURN jsonb_build_object('leaf', NULL, 'created', '[]'::jsonb);
  END IF;
  SELECT array_agg(n) INTO _names
    FROM (
      SELECT left(btrim(regexp_replace(value, '\s+', ' ', 'g')), 30) AS n, ordinality
        FROM jsonb_array_elements_text(_path) WITH ORDINALITY
    ) x
   WHERE n <> '';
  IF _names IS NULL OR array_length(_names, 1) IS NULL THEN
    RETURN jsonb_build_object('leaf', NULL, 'created', '[]'::jsonb);
  END IF;
  -- עד 3 רמות: הרמות העמוקות נשמרות
  IF array_length(_names, 1) > 3 THEN
    _names := _names[array_length(_names, 1) - 2 : array_length(_names, 1)];
  END IF;

  FOREACH _name IN ARRAY _names LOOP
    IF _name = _parent THEN
      CONTINUE; -- "כבלים > כבלים"
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.tenant_id = _tenant AND c.name = _name) THEN
      BEGIN
        INSERT INTO public.categories (tenant_id, name, parent_name)
        VALUES (_tenant, _name, _parent)
        ON CONFLICT (tenant_id, name) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN
        -- האב לא מתאים (למשל רמה רביעית) — נוצרת כקטגוריה ראשית
        INSERT INTO public.categories (tenant_id, name)
        VALUES (_tenant, _name)
        ON CONFLICT (tenant_id, name) DO NOTHING;
      END;
      GET DIAGNOSTICS _inserted = ROW_COUNT;
      IF _inserted > 0 AND NOT _name = ANY (_created) THEN
        _created := _created || _name;
      END IF;
    END IF;
    _parent := _name;
    _leaf := _name;
  END LOOP;
  RETURN jsonb_build_object('leaf', _leaf, 'created', to_jsonb(_created));
END $$;
REVOKE ALL ON FUNCTION public.import_ensure_category_path(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_ensure_category_path(uuid, jsonb) TO authenticated, service_role;

-- השורות כבר מפוענחות (בשרת): [{row, name, price, categories: [[...]], images: [...],
-- description, sku, barcode, stock, sale_price, sale_ends_at, cost_price, hidden,
-- show_in_zap, seo_title, seo_description}] (category / image_url — הפורמט הישן).
-- כל שורה בתת-טרנזקציה משלה: שגיאה בשורה אחת נרשמת ולא מבטלת את האחרות
-- (וגם קטגוריות שנוצרו בשבילה מתבטלות איתה). רץ בהרשאות המשתמש (RLS + מגבלת
-- החבילה בטריגרים) — רק מנהל החנות. מחיר מבצע בלי תאריך סיום (חובה בחנות) —
-- המוצר נוצר בלי המבצע, עם אזהרה.
CREATE OR REPLACE FUNCTION public.import_products(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  r jsonb;
  i integer := 0;
  _row integer;
  created integer := 0;
  duplicates integer := 0;
  sku_replaced integer := 0;
  errors jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  _warning text;
  new_categories text[] := '{}';
  _row_new_categories text[];
  limit_hit boolean := false;
  _name text;
  _price numeric;
  _sale numeric;
  _sale_ends timestamptz;
  _cost numeric;
  _stock integer;
  _paths jsonb;
  _path jsonb;
  _ensured jsonb;
  _leaf text;
  _leaves text[];
  _category text;
  _sku text;
  _barcode text;
  _images text[];
  _image text;
  _description text;
  _hidden boolean;
  _zap boolean;
  _seo_title text;
  _seo_description text;
  _tries integer;
  _product_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לייבא מוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'קובץ הייבוא לא תקין';
  END IF;
  IF jsonb_array_length(_rows) > 500 THEN
    RAISE EXCEPTION 'עד 500 שורות בכל שליחה';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    i := i + 1;
    _row := CASE WHEN (r ->> 'row') ~ '^[0-9]{1,7}$' THEN (r ->> 'row')::integer ELSE i END;
    _name := left(btrim(regexp_replace(COALESCE(r ->> 'name', ''), '\s+', ' ', 'g')), 200);

    IF limit_hit THEN
      errors := errors || jsonb_build_object('row', _row, 'name', _name,
        'message', 'לא נוסף — הגעתם למגבלת המוצרים של החבילה');
      CONTINUE;
    END IF;

    BEGIN
      IF _name = '' THEN
        RAISE EXCEPTION 'חסר שם מוצר';
      END IF;

      -- מחיר: חובה, מספר אי-שלילי
      IF COALESCE(r ->> 'price', '') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN
        RAISE EXCEPTION 'מחיר לא תקין: "%"', COALESCE(r ->> 'price', '');
      END IF;
      _price := (r ->> 'price')::numeric;

      _sale := NULL;
      IF COALESCE(r ->> 'sale_price', '') <> '' THEN
        IF (r ->> 'sale_price') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN
          RAISE EXCEPTION 'מחיר מבצע לא תקין: "%"', r ->> 'sale_price';
        END IF;
        _sale := (r ->> 'sale_price')::numeric;
        IF _sale >= _price THEN
          _sale := NULL; -- "מבצע" שלא מוזיל — מתעלמים
        END IF;
      END IF;

      -- סיום המבצע: YYYY-MM-DD (השרת ממיר מ-DD/MM/YYYY), עד סוף אותו יום
      _sale_ends := NULL;
      _warning := NULL;
      IF _sale IS NOT NULL THEN
        IF COALESCE(r ->> 'sale_ends_at', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          BEGIN
            _sale_ends := ((r ->> 'sale_ends_at')::date + 1)::timestamp AT TIME ZONE 'Asia/Jerusalem';
          EXCEPTION WHEN OTHERS THEN
            _sale_ends := NULL;
          END;
        END IF;
        IF _sale_ends IS NULL OR _sale_ends <= now() THEN
          _warning := CASE WHEN _sale_ends IS NULL
                           THEN 'המבצע לא יובא — חסר תאריך סיום למבצע (עמודת "סיום מבצע")'
                           ELSE 'המבצע לא יובא — תאריך סיום המבצע כבר עבר' END;
          _sale := NULL;
          _sale_ends := NULL;
        END IF;
      END IF;

      _cost := NULL;
      IF COALESCE(r ->> 'cost_price', '') <> '' THEN
        IF (r ->> 'cost_price') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN
          RAISE EXCEPTION 'מחיר עלות לא תקין: "%"', r ->> 'cost_price';
        END IF;
        _cost := (r ->> 'cost_price')::numeric;
      END IF;

      _stock := 0;
      IF COALESCE(r ->> 'stock', '') <> '' THEN
        IF (r ->> 'stock') !~ '^[0-9]{1,7}$' THEN
          RAISE EXCEPTION 'כמות מלאי לא תקינה: "%"', r ->> 'stock';
        END IF;
        _stock := (r ->> 'stock')::integer;
      END IF;

      _barcode := NULLIF(btrim(COALESCE(r ->> 'barcode', '')), '');
      IF _barcode IS NOT NULL AND char_length(_barcode) > 64 THEN
        RAISE EXCEPTION 'ברקוד ארוך מדי';
      END IF;

      -- תמונות: רשימה (חלק 18) או קישור אחד (הפורמט הישן). עד 10.
      _images := '{}';
      IF jsonb_typeof(r -> 'images') = 'array' THEN
        SELECT COALESCE(array_agg(btrim(value) ORDER BY ordinality), '{}')
          INTO _images
          FROM jsonb_array_elements_text(r -> 'images') WITH ORDINALITY
         WHERE btrim(value) <> '';
      ELSIF NULLIF(btrim(COALESCE(r ->> 'image_url', '')), '') IS NOT NULL THEN
        _images := ARRAY[btrim(r ->> 'image_url')];
      END IF;
      IF array_length(_images, 1) > 10 THEN
        _images := _images[1:10];
      END IF;
      FOREACH _image IN ARRAY _images LOOP
        IF _image !~* '^https?://[^\s]+$' OR char_length(_image) > 1000 THEN
          RAISE EXCEPTION 'קישור התמונה חייב להתחיל ב-https://';
        END IF;
      END LOOP;

      _description := NULLIF(left(btrim(COALESCE(r ->> 'description', '')), 5000), '');
      _hidden := lower(COALESCE(r ->> 'hidden', '')) IN ('true', '1', 'yes', 'כן', 'y');
      _zap := lower(COALESCE(r ->> 'show_in_zap', '')) NOT IN ('false', '0', 'no', 'לא', 'n');
      _seo_title := NULLIF(left(btrim(COALESCE(r ->> 'seo_title', '')), 120), '');
      _seo_description := NULLIF(left(btrim(COALESCE(r ->> 'seo_description', '')), 320), '');

      -- כפילויות: ברקוד או מק"ט שכבר קיימים בחנות — מדלגים (לא דורסים מוצר)
      IF _barcode IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.global_products gp
            WHERE gp.tenant_id = _tenant AND gp.barcode = _barcode) THEN
        duplicates := duplicates + 1;
        RAISE EXCEPTION 'ברקוד % כבר קיים בחנות — דילגנו על השורה', _barcode;
      END IF;

      _sku := btrim(COALESCE(r ->> 'sku', ''));
      IF _sku ~ '^[0-9]{8}$' THEN
        IF EXISTS (SELECT 1 FROM public.global_products gp
                    WHERE gp.tenant_id = _tenant AND gp.sku = _sku) THEN
          duplicates := duplicates + 1;
          RAISE EXCEPTION 'מק"ט % כבר קיים בחנות — דילגנו על השורה', _sku;
        END IF;
      ELSE
        IF _sku <> '' THEN
          sku_replaced := sku_replaced + 1;
        END IF;
        -- מק"ט פנימי חדש בן 8 ספרות (כמו בהוספת מוצר רגילה)
        _tries := 0;
        LOOP
          _sku := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
          EXIT WHEN NOT EXISTS (SELECT 1 FROM public.global_products gp
                                 WHERE gp.tenant_id = _tenant AND gp.sku = _sku);
          _tries := _tries + 1;
          IF _tries > 20 THEN
            RAISE EXCEPTION 'לא נמצא מק"ט פנוי — נסו שוב';
          END IF;
        END LOOP;
      END IF;

      -- קטגוריות: רשימת נתיבים (חלק 18) או שם אחד (הפורמט הישן). חסרות — נוצרות.
      _row_new_categories := '{}';
      _leaves := '{}';
      IF jsonb_typeof(r -> 'categories') = 'array' AND jsonb_array_length(r -> 'categories') > 0 THEN
        _paths := r -> 'categories';
      ELSE
        _paths := jsonb_build_array(jsonb_build_array(COALESCE(r ->> 'category', '')));
      END IF;
      FOR _path IN SELECT value FROM jsonb_array_elements(_paths) LIMIT 10 LOOP
        IF jsonb_typeof(_path) = 'string' THEN
          _path := jsonb_build_array(_path);
        END IF;
        _ensured := public.import_ensure_category_path(_tenant, _path);
        _row_new_categories := _row_new_categories
          || ARRAY(SELECT jsonb_array_elements_text(_ensured -> 'created'));
        _leaf := _ensured ->> 'leaf';
        IF _leaf IS NOT NULL AND NOT _leaf = ANY (_leaves) THEN
          _leaves := _leaves || _leaf;
        END IF;
      END LOOP;
      IF array_length(_leaves, 1) IS NULL THEN
        _ensured := public.import_ensure_category_path(_tenant, '["כללי"]'::jsonb);
        _row_new_categories := _row_new_categories
          || ARRAY(SELECT jsonb_array_elements_text(_ensured -> 'created'));
        _leaves := ARRAY[_ensured ->> 'leaf'];
      END IF;
      _category := _leaves[1];

      INSERT INTO public.global_products (
        tenant_id, sku, name, category, description, image_url, images, barcode,
        shelf_location, price_tier1, price_tier2, price_tier3, uniform_price,
        cost_price, is_promo, sale_price, sale_ends_at, stock_quantity, is_out_of_stock,
        is_hidden, show_in_zap, seo_title, seo_description, created_by)
      VALUES (
        _tenant, _sku, _name, _category, _description, _images[1], _images, _barcode,
        'A0A', _price, _price, _price, true,
        _cost, _sale IS NOT NULL, _sale, _sale_ends, _stock, false,
        _hidden, _zap, _seo_title, _seo_description, auth.uid())
      RETURNING id INTO _product_id;

      -- כל הקטגוריות (הראשית כבר מקושרת בטריגר)
      INSERT INTO public.product_categories (tenant_id, product_id, category_id)
      SELECT _tenant, _product_id, c.id
        FROM public.categories c
       WHERE c.tenant_id = _tenant AND c.name = ANY (_leaves)
      ON CONFLICT DO NOTHING;

      created := created + 1;
      IF _warning IS NOT NULL THEN
        warnings := warnings || jsonb_build_object('row', _row, 'name', _name, 'message', _warning);
      END IF;
      FOREACH _leaf IN ARRAY _row_new_categories LOOP
        IF NOT _leaf = ANY (new_categories) THEN
          new_categories := new_categories || _leaf;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'בחבילה הבסיסית אפשר עד%' THEN
        limit_hit := true;
      END IF;
      errors := errors || jsonb_build_object('row', _row, 'name', _name, 'message', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'created', created,
    'failed', jsonb_array_length(errors),
    'duplicates', duplicates,
    'sku_replaced', sku_replaced,
    'limit_reached', limit_hit,
    'new_categories', to_jsonb(new_categories),
    'errors', errors,
    'warnings', warnings);
END $$;
REVOKE ALL ON FUNCTION public.import_products(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_products(jsonb) TO authenticated, service_role;

COMMIT;

-- ============================================================
-- חלק 10: לוגיסטיקת משלוחים, מוצרים דיגיטליים ווריאציות
--
--  1. שיטות משלוח לכל חנות (shipping_methods): שם, מחיר, סוג (משלוח /
--     איסוף עצמי), פעיל/כבוי. לכל חנות קיימת (ולכל חנות חדשה) נוצרת
--     "איסוף עצמי" ב-0 ₪. ההזמנה שומרת את השיטה, הסוג והמחיר (צילום), והסכום
--     הכולל של ההזמנה = המוצרים + דמי המשלוח. משלוח חינם מעל הסף שבהגדרות
--     (free_shipping_threshold) — על שיטות "משלוח" בלבד.
--  2. מוצר דיגיטלי (global_products.is_digital): לא שומר מלאי פיזי, לא דורש
--     משלוח ולא נכנס לליקוט. סל שכולו דיגיטלי — בלי שיטת משלוח ובלי כתובת.
--  3. סטטוס לכל שורה בהזמנה (order_items.item_status) + מפתח רישיון
--     (digital_license_key, עד 100 תווים). פיזי → "ממתין לשליח" (או "ממתין
--     לאיסוף"); דיגיטלי → "ממתין להזנת רישיון" → "נמסר במייל" אחרי שהמנהל
--     שלח את הרישיון (השליחה עצמה בשרת — src/lib/license.functions.ts).
--  4. וריאציות מוצר: מאפיינים על המוצר (variant_attributes, למשל צבע/מידה)
--     וטבלת product_variants — לכל צירוף: מק"ט, מחיר ומלאי משלו (ריק =
--     כמו המוצר). שורת הזמנה נושאת variant_id + צילום התווית; לקוח חייב
--     לבחור וריאציה כשיש למוצר וריאציות. המלאי נשמר מהוריאציה (אם היא
--     סופרת מלאי) או מהמוצר.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- עזר: uuid מטקסט שהגיע מהדפדפן (ערך לא תקין → NULL, לא שגיאה)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.uuid_or_null(_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN _value::uuid
  END;
$$;

-- ============================================================
-- 1. שיטות משלוח
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shipping_methods (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   UUID NOT NULL DEFAULT public.current_tenant_id()
              REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  -- הסבר קצר ללקוח בקופה ("עד 3 ימי עסקים"). באיסוף עצמי — ריק = כתובת העסק מההגדרות
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  -- delivery = שליח עד הבית (דורש כתובת) · pickup = איסוף עצמי (בלי כתובת)
  kind        TEXT NOT NULL DEFAULT 'delivery' CHECK (kind IN ('delivery', 'pickup')),
  price       NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0 AND price <= 100000),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT shipping_methods_tenant_id_key UNIQUE (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS shipping_methods_tenant_idx
  ON public.shipping_methods (tenant_id, sort_order);

COMMENT ON TABLE public.shipping_methods IS
  'שיטות המשלוח של החנות (קופה): שם, מחיר, משלוח / איסוף עצמי, פעיל';

DROP TRIGGER IF EXISTS shipping_methods_updated_at ON public.shipping_methods;
CREATE TRIGGER shipping_methods_updated_at
  BEFORE UPDATE ON public.shipping_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.shipping_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.shipping_methods;
CREATE POLICY tenant_isolation ON public.shipping_methods
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- אורחים ולקוחות רואים את השיטות הפעילות (לבחירה בקופה); המנהל רואה הכל
DROP POLICY IF EXISTS "shipping methods readable" ON public.shipping_methods;
CREATE POLICY "shipping methods readable" ON public.shipping_methods
  FOR SELECT TO anon
  USING (is_active);
DROP POLICY IF EXISTS "shipping methods readable by members" ON public.shipping_methods;
CREATE POLICY "shipping methods readable by members" ON public.shipping_methods
  FOR SELECT TO authenticated
  USING (is_active OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "shipping methods managed by admin" ON public.shipping_methods;
CREATE POLICY "shipping methods managed by admin" ON public.shipping_methods
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.shipping_methods FROM anon;
GRANT SELECT ON public.shipping_methods TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipping_methods TO authenticated;
GRANT ALL ON public.shipping_methods TO service_role;

-- "איסוף עצמי" ב-0 ₪ לכל חנות קיימת (הכתובת — כתובת העסק מההגדרות)
INSERT INTO public.shipping_methods (tenant_id, name, description, kind, price, sort_order)
SELECT t.id, 'איסוף עצמי', '', 'pickup', 0, 0
  FROM public.tenants t
 WHERE NOT EXISTS (SELECT 1 FROM public.shipping_methods m WHERE m.tenant_id = t.id);

-- וגם לכל חנות חדשה
CREATE OR REPLACE FUNCTION public.tenants_seed_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (NEW.id, NEW.name, '')
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.shipping_methods m WHERE m.tenant_id = NEW.id) THEN
    INSERT INTO public.shipping_methods (tenant_id, name, description, kind, price, sort_order)
    VALUES (NEW.id, 'איסוף עצמי', '', 'pickup', 0, 0);
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- המשלוח על ההזמנה (צילום בעת ההזמנה)
-- ------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_method_id UUID,
  ADD COLUMN IF NOT EXISTS shipping_method_name TEXT,
  -- delivery / pickup = לפי השיטה · digital = סל דיגיטלי בלבד (בלי משלוח) ·
  -- NULL = הזמנה ישנה / הזמנה ידנית בלי שיטה
  ADD COLUMN IF NOT EXISTS shipping_kind TEXT,
  -- מחיר השיטה בעת ההזמנה (או מה שהצוות קבע ידנית)
  ADD COLUMN IF NOT EXISTS shipping_base_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  -- סף "משלוח חינם" בעת ההזמנה (רק בשיטת משלוח) — NULL = בלי
  ADD COLUMN IF NOT EXISTS shipping_free_threshold NUMERIC(12, 2),
  -- דמי המשלוח בפועל (0 אם הסל עבר את הסף) — חלק מ-total
  ADD COLUMN IF NOT EXISTS shipping_price NUMERIC(10, 2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_shipping_fields_check CHECK (
    (shipping_kind IS NULL OR shipping_kind IN ('delivery', 'pickup', 'digital'))
    AND (shipping_method_name IS NULL OR length(shipping_method_name) <= 60)
    AND shipping_base_price >= 0 AND shipping_price >= 0
    AND (shipping_free_threshold IS NULL OR shipping_free_threshold > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_shipping_method_fkey;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_shipping_method_fkey FOREIGN KEY (tenant_id, shipping_method_id)
    REFERENCES public.shipping_methods(tenant_id, id) ON DELETE SET NULL (shipping_method_id);
CREATE INDEX IF NOT EXISTS orders_shipping_method_idx
  ON public.orders (shipping_method_id) WHERE shipping_method_id IS NOT NULL;

COMMENT ON COLUMN public.orders.shipping_kind IS
  'delivery = משלוח לכתובת · pickup = איסוף עצמי · digital = סל דיגיטלי בלבד';
COMMENT ON COLUMN public.orders.shipping_price IS
  'דמי המשלוח בפועל (כלולים ב-total). 0 כשהסל עבר את סף המשלוח החינם';

-- הזמנת אורח: כתובת חובה רק כשיש משלוח לכתובת (לא באיסוף עצמי / דיגיטלי)
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_guest_details_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_guest_details_check CHECK (
  customer_id IS NOT NULL
  OR (customer_name IS NOT NULL AND customer_tax_id IS NOT NULL
      AND customer_phone IS NOT NULL AND customer_email IS NOT NULL
      AND (shipping_kind IN ('pickup', 'digital')
           OR (billing_city IS NOT NULL AND billing_address IS NOT NULL
               AND billing_zip IS NOT NULL))));

-- ------------------------------------------------------------
-- הסכום הכולל וצילום המשלוח — נקבעים כאן בלבד
--  INSERT: שם/סוג/מחיר נלקחים מהשיטה במסד (לא מהדפדפן).
--  UPDATE: total = שורות ההזמנה + דמי המשלוח. צוות ששינה את דמי המשלוח ביד —
--          זה המחיר מעכשיו (בלי משלוח חינם אוטומטי); צוות שהחליף שיטה —
--          המחיר של השיטה החדשה.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_shipping_and_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  staff BOOLEAN := public.is_staff(auth.uid());
  v_items NUMERIC := 0;
  v_products NUMERIC := 0;
  rederive BOOLEAN;
BEGIN
  rederive := TG_OP = 'INSERT'
    OR (NEW.shipping_method_id IS NOT NULL
        AND NEW.shipping_method_id IS DISTINCT FROM OLD.shipping_method_id);

  IF rederive THEN
    IF NEW.shipping_method_id IS NOT NULL THEN
      SELECT sm.name, sm.kind, sm.price, sm.is_active INTO m
        FROM public.shipping_methods sm
       WHERE sm.id = NEW.shipping_method_id AND sm.tenant_id = NEW.tenant_id;
      IF NOT FOUND OR (NOT m.is_active AND NOT staff) THEN
        RAISE EXCEPTION 'שיטת המשלוח שנבחרה אינה זמינה עוד — בחרו שיטה אחרת'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.shipping_method_name := m.name;
      NEW.shipping_kind := m.kind;
      NEW.shipping_base_price := m.price;
      NEW.shipping_free_threshold := CASE
        WHEN m.kind = 'delivery' AND TG_OP = 'INSERT' THEN
          (SELECT s.free_shipping_threshold FROM public.site_settings s WHERE s.tenant_id = NEW.tenant_id)
      END;
    ELSIF TG_OP = 'INSERT' THEN
      -- בלי שיטה: סל דיגיטלי בלבד, או הזמנה בלי משלוח מוגדר (ידנית / ישנה)
      NEW.shipping_method_name := NULL;
      NEW.shipping_kind := CASE WHEN NEW.shipping_kind = 'digital' THEN 'digital' END;
      IF NOT staff THEN
        NEW.shipping_base_price := 0;
      END IF;
      NEW.shipping_free_threshold := NULL;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0),
           COALESCE(SUM(oi.quantity * oi.unit_price) FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0)
      INTO v_items, v_products
      FROM public.order_items oi
     WHERE oi.order_id = NEW.id;
    -- דמי משלוח שהוזנו ביד (עריכת הזמנה) — המחיר הקבוע מעכשיו
    IF NOT rederive AND NEW.shipping_price IS DISTINCT FROM OLD.shipping_price THEN
      NEW.shipping_base_price := GREATEST(COALESCE(NEW.shipping_price, 0), 0);
      NEW.shipping_free_threshold := NULL;
    END IF;
  END IF;

  NEW.shipping_price := CASE
    -- בקשה להצעת מחיר — בלי מחירים (גם לא משלוח) עד שהצוות ממיר להזמנה
    WHEN NEW.kind = 'quote' THEN 0
    WHEN NEW.shipping_free_threshold IS NOT NULL AND v_products >= NEW.shipping_free_threshold THEN 0
    ELSE NEW.shipping_base_price
  END;
  NEW.total := v_items + NEW.shipping_price;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_shipping_and_total ON public.orders;
CREATE TRIGGER orders_shipping_and_total
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_shipping_and_total();

-- שורה נוספה / השתנתה / נמחקה → ההזמנה מחשבת את הסכום מחדש (בטריגר שלמעלה)
CREATE OR REPLACE FUNCTION public.recompute_order_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE public.orders o SET total = o.total WHERE o.id = _order_id;
  RETURN NULL;
END $$;

-- ============================================================
-- 2. מוצר דיגיטלי + מאפייני וריאציות על המוצר
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS is_digital BOOLEAN NOT NULL DEFAULT false,
  -- [{"name":"צבע","values":["אדום","שחור"]},{"name":"מידה","values":["S","M","L"]}]
  ADD COLUMN IF NOT EXISTS variant_attributes JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE public.global_products ADD CONSTRAINT global_products_variant_attributes_check
    CHECK (jsonb_typeof(variant_attributes) = 'array' AND jsonb_array_length(variant_attributes) <= 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.global_products.is_digital IS
  'מוצר דיגיטלי (רישיון / קוד): בלי מלאי פיזי, בלי משלוח ובלי ליקוט';
COMMENT ON COLUMN public.global_products.variant_attributes IS
  'מאפייני הוריאציות (עד 3): [{name, values[]}] — הצירופים עצמם ב-product_variants';

-- ============================================================
-- 3. וריאציות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_variants (
  id             UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID NOT NULL DEFAULT public.current_tenant_id()
                 REFERENCES public.tenants(id) ON DELETE RESTRICT,
  product_id     UUID NOT NULL,
  -- {"צבע":"אדום","מידה":"S"} — מפתח לכל מאפיין של המוצר
  options        JSONB NOT NULL CHECK (jsonb_typeof(options) = 'object'),
  sku            TEXT CHECK (sku IS NULL OR sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  -- NULL = מחיר המוצר (כולל דרגים, מבצע ומחירון אישי); ערך = מחיר קבוע לוריאציה
  price          NUMERIC(20, 10) CHECK (price IS NULL OR (price >= 0 AND price <= 10000000)),
  -- NULL = בלי מלאי נפרד (המלאי של המוצר); ערך = מלאי זמין לוריאציה הזו
  stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT product_variants_options_key UNIQUE (product_id, options),
  -- נדחה לסוף הפעולה: החלפת מק"טים בין שתי וריאציות בשמירה אחת
  CONSTRAINT product_variants_sku_key UNIQUE (tenant_id, sku) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT product_variants_product_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS product_variants_product_idx
  ON public.product_variants (product_id, sort_order);
CREATE INDEX IF NOT EXISTS product_variants_tenant_idx ON public.product_variants (tenant_id);

COMMENT ON TABLE public.product_variants IS
  'וריאציות מוצר (צירוף של מאפיינים): מק"ט, מחיר ומלאי לכל צירוף';

DROP TRIGGER IF EXISTS product_variants_updated_at ON public.product_variants;
CREATE TRIGGER product_variants_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_variants;
CREATE POLICY tenant_isolation ON public.product_variants
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- הקטלוג ללקוחות — דרך get_catalog. כאן: קריאה לצוות; כתיבה רק דרך
-- save_product_variants (בדיקות מלאות במקום אחד)
DROP POLICY IF EXISTS "variants readable by staff" ON public.product_variants;
CREATE POLICY "variants readable by staff" ON public.product_variants
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));
REVOKE ALL ON public.product_variants FROM anon, authenticated;
GRANT SELECT ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;

-- "אדום · S" — הערכים לפי סדר המאפיינים של המוצר
CREATE OR REPLACE FUNCTION public.variant_label(_options jsonb, _attributes jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(string_agg(_options ->> (a.value ->> 'name'), ' · ' ORDER BY a.ord), '')
    FROM jsonb_array_elements(COALESCE(_attributes, '[]'::jsonb)) WITH ORDINALITY AS a(value, ord)
   WHERE _options ? (a.value ->> 'name');
$$;

-- שמירת כל הוריאציות של מוצר בפעולה אחת (מנהל בלבד):
--   _attributes = [{name, values[]}]  (ריק = בלי וריאציות — הכל נמחק)
--   _variants   = [{options:{מאפיין:ערך}, sku, price, stock_quantity, is_active}]
-- צירוף שלא נשלח — נמחק (בהזמנות קודמות נשאר צילום התווית).
CREATE OR REPLACE FUNCTION public.save_product_variants(
  _product_id uuid,
  _attributes jsonb,
  _variants jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  a jsonb;
  v jsonb;
  attrs jsonb := '[]'::jsonb;
  clean jsonb := '[]'::jsonb;
  names text[] := '{}';
  vals text[];
  val text;
  aname text;
  opts jsonb;
  o_key text;
  v_sku text;
  v_price numeric;
  v_stock integer;
  seen_opts jsonb[] := '{}';
  seen_skus text[] := '{}';
  combos bigint := 1;
  saved integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לנהל וריאציות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT gp.id, gp.tenant_id, gp.name INTO p
    FROM public.global_products gp
   WHERE gp.id = _product_id AND gp.tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המוצר לא נמצא';
  END IF;

  -- ---------- המאפיינים ----------
  IF _attributes IS NULL OR jsonb_typeof(_attributes) <> 'array' THEN
    RAISE EXCEPTION 'מבנה המאפיינים אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_attributes) > 3 THEN
    RAISE EXCEPTION 'עד 3 מאפיינים למוצר (למשל צבע, מידה, חומר)' USING ERRCODE = 'check_violation';
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(_attributes) LOOP
    aname := btrim(COALESCE(a ->> 'name', ''));
    IF length(aname) < 1 OR length(aname) > 30 THEN
      RAISE EXCEPTION 'שם מאפיין: 1 עד 30 תווים' USING ERRCODE = 'check_violation';
    END IF;
    IF aname = ANY (names) THEN
      RAISE EXCEPTION 'המאפיין "%" מופיע פעמיים', aname USING ERRCODE = 'check_violation';
    END IF;
    names := names || aname;
    IF jsonb_typeof(a -> 'values') <> 'array' THEN
      RAISE EXCEPTION 'חסרים ערכים למאפיין "%"', aname USING ERRCODE = 'check_violation';
    END IF;
    vals := '{}';
    FOR val IN SELECT btrim(x) FROM jsonb_array_elements_text(a -> 'values') AS x LOOP
      CONTINUE WHEN val = '';
      IF length(val) > 30 THEN
        RAISE EXCEPTION 'ערך ארוך מדי במאפיין "%" (עד 30 תווים)', aname USING ERRCODE = 'check_violation';
      END IF;
      IF val = ANY (vals) THEN
        RAISE EXCEPTION 'הערך "%" מופיע פעמיים במאפיין "%"', val, aname USING ERRCODE = 'check_violation';
      END IF;
      vals := vals || val;
    END LOOP;
    IF cardinality(vals) = 0 THEN
      RAISE EXCEPTION 'הוסיפו לפחות ערך אחד למאפיין "%"', aname USING ERRCODE = 'check_violation';
    END IF;
    IF cardinality(vals) > 30 THEN
      RAISE EXCEPTION 'עד 30 ערכים למאפיין "%"', aname USING ERRCODE = 'check_violation';
    END IF;
    combos := combos * cardinality(vals);
    attrs := attrs || jsonb_build_object('name', aname, 'values', to_jsonb(vals));
  END LOOP;

  IF jsonb_array_length(attrs) = 0 THEN
    DELETE FROM public.product_variants WHERE product_id = p.id;
    UPDATE public.global_products SET variant_attributes = '[]'::jsonb WHERE id = p.id;
    RETURN 0;
  END IF;
  IF combos > 300 THEN
    RAISE EXCEPTION 'יותר מדי צירופים (%). עד 300 וריאציות למוצר', combos USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- הצירופים ----------
  IF _variants IS NULL OR jsonb_typeof(_variants) <> 'array' THEN
    RAISE EXCEPTION 'מבנה הוריאציות אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_variants) = 0 THEN
    RAISE EXCEPTION 'הגדירו לפחות וריאציה אחת (או הסירו את המאפיינים)' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_variants) > 300 THEN
    RAISE EXCEPTION 'עד 300 וריאציות למוצר' USING ERRCODE = 'check_violation';
  END IF;

  FOR v IN SELECT value FROM jsonb_array_elements(_variants) LOOP
    IF jsonb_typeof(v -> 'options') <> 'object' THEN
      RAISE EXCEPTION 'וריאציה בלי מאפיינים' USING ERRCODE = 'check_violation';
    END IF;
    -- הצירוף: ערך קיים לכל מאפיין, ורק למאפיינים של המוצר
    opts := '{}'::jsonb;
    FOR a IN SELECT value FROM jsonb_array_elements(attrs) LOOP
      aname := a ->> 'name';
      val := btrim(COALESCE(v -> 'options' ->> aname, ''));
      IF NOT (a -> 'values') ? val THEN
        RAISE EXCEPTION 'בוריאציה חסר ערך תקין למאפיין "%"', aname USING ERRCODE = 'check_violation';
      END IF;
      opts := opts || jsonb_build_object(aname, val);
    END LOOP;
    FOR o_key IN SELECT jsonb_object_keys(v -> 'options') LOOP
      IF NOT o_key = ANY (names) THEN
        RAISE EXCEPTION 'מאפיין לא מוכר בוריאציה: "%"', o_key USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    IF opts = ANY (seen_opts) THEN
      RAISE EXCEPTION 'הוריאציה "%" מופיעה פעמיים', public.variant_label(opts, attrs)
        USING ERRCODE = 'check_violation';
    END IF;
    seen_opts := seen_opts || opts;

    v_sku := NULLIF(btrim(COALESCE(v ->> 'sku', '')), '');
    IF v_sku IS NOT NULL THEN
      IF v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' THEN
        RAISE EXCEPTION 'מק"ט "%" אינו תקין — אותיות באנגלית, ספרות, נקודה, מקף (עד 40)', v_sku
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_sku = ANY (seen_skus) THEN
        RAISE EXCEPTION 'המק"ט "%" מופיע בשתי וריאציות', v_sku USING ERRCODE = 'check_violation';
      END IF;
      seen_skus := seen_skus || v_sku;
      IF EXISTS (SELECT 1 FROM public.global_products gp
                  WHERE gp.tenant_id = p.tenant_id AND gp.sku = v_sku)
         OR EXISTS (SELECT 1 FROM public.product_variants pv
                     WHERE pv.tenant_id = p.tenant_id AND pv.sku = v_sku AND pv.product_id <> p.id) THEN
        RAISE EXCEPTION 'המק"ט "%" כבר בשימוש במוצר אחר', v_sku USING ERRCODE = 'unique_violation';
      END IF;
    END IF;

    BEGIN
      v_price := NULLIF(btrim(COALESCE(v ->> 'price', '')), '')::numeric;
      v_stock := NULLIF(btrim(COALESCE(v ->> 'stock_quantity', '')), '')::numeric::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'מחיר או מלאי לא תקינים בוריאציה "%"', public.variant_label(opts, attrs)
        USING ERRCODE = 'check_violation';
    END;
    IF v_price IS NOT NULL AND (v_price < 0 OR v_price > 10000000) THEN
      RAISE EXCEPTION 'מחיר לא תקין בוריאציה "%"', public.variant_label(opts, attrs)
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_stock IS NOT NULL AND v_stock < 0 THEN
      RAISE EXCEPTION 'מלאי לא יכול להיות שלילי ("%")', public.variant_label(opts, attrs)
        USING ERRCODE = 'check_violation';
    END IF;

    clean := clean || jsonb_build_array(jsonb_build_object(
      'options', opts,
      'sku', v_sku,
      'price', v_price,
      'stock_quantity', v_stock,
      'is_active', COALESCE((v ->> 'is_active')::boolean, true)));
  END LOOP;

  SET CONSTRAINTS public.product_variants_sku_key DEFERRED;

  DELETE FROM public.product_variants pv
   WHERE pv.product_id = p.id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(clean) c WHERE c.value -> 'options' = pv.options);

  UPDATE public.global_products SET variant_attributes = attrs WHERE id = p.id;

  INSERT INTO public.product_variants
         (tenant_id, product_id, options, sku, price, stock_quantity, is_active, sort_order)
  SELECT p.tenant_id, p.id, c.value -> 'options', c.value ->> 'sku',
         (c.value ->> 'price')::numeric, (c.value ->> 'stock_quantity')::integer,
         (c.value ->> 'is_active')::boolean, c.ord::integer
    FROM jsonb_array_elements(clean) WITH ORDINALITY AS c(value, ord)
  ON CONFLICT (product_id, options) DO UPDATE
     SET sku = EXCLUDED.sku,
         price = EXCLUDED.price,
         stock_quantity = EXCLUDED.stock_quantity,
         is_active = EXCLUDED.is_active,
         sort_order = EXCLUDED.sort_order;
  GET DIAGNOSTICS saved = ROW_COUNT;

  SET CONSTRAINTS public.product_variants_sku_key IMMEDIATE;
  RETURN saved;
END $$;

REVOKE ALL ON FUNCTION public.save_product_variants(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_variants(uuid, jsonb, jsonb) TO authenticated, service_role;

-- ============================================================
-- 4. שורות הזמנה: דיגיטלי, סטטוס, רישיון, וריאציה
-- ============================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_digital BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_status TEXT,
  ADD COLUMN IF NOT EXISTS digital_license_key TEXT,
  ADD COLUMN IF NOT EXISTS license_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS license_sent_to TEXT,
  ADD COLUMN IF NOT EXISTS variant_id UUID,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  -- המלאי של השורה נשמר מהוריאציה (true) או מהמוצר (false)
  ADD COLUMN IF NOT EXISTS reserved_from_variant BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_item_status_check CHECK (
    item_status IS NULL OR item_status IN (
      'awaiting_courier', 'awaiting_pickup', 'shipped', 'delivered',
      'awaiting_license', 'delivered_email', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_license_check CHECK (
    (digital_license_key IS NULL OR length(digital_license_key) BETWEEN 1 AND 100)
    AND (license_sent_to IS NULL OR length(license_sent_to) <= 254)
    AND (variant_label IS NULL OR length(variant_label) <= 200));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.order_items ADD CONSTRAINT order_items_deposit_no_variant
    CHECK (NOT is_deposit OR variant_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_variant_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_variant_fkey FOREIGN KEY (tenant_id, variant_id)
    REFERENCES public.product_variants(tenant_id, id) ON DELETE SET NULL (variant_id);
CREATE INDEX IF NOT EXISTS order_items_variant_idx
  ON public.order_items (variant_id) WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN public.order_items.item_status IS
  'awaiting_courier ממתין לשליח · awaiting_pickup ממתין לאיסוף · shipped נשלח · delivered נמסר · awaiting_license ממתין להזנת רישיון · delivered_email נמסר במייל · cancelled בוטל';
COMMENT ON COLUMN public.order_items.digital_license_key IS
  'מפתח הרישיון של מוצר דיגיטלי (עד 100 תווים) — נשלח ללקוח במייל ומוצג באזור האישי';

-- הסטטוס של שורה לפי סוג המוצר, מצב ההזמנה וסוג המשלוח
CREATE OR REPLACE FUNCTION public.order_item_status_for(
  _is_digital boolean,
  _license_sent boolean,
  _order_status text,
  _shipping_kind text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _is_digital THEN
      CASE WHEN _license_sent THEN 'delivered_email'
           WHEN _order_status = 'cancelled' THEN 'cancelled'
           ELSE 'awaiting_license' END
    WHEN _order_status = 'cancelled' THEN 'cancelled'
    WHEN _order_status = 'shipped' THEN 'shipped'
    WHEN _order_status = 'delivered' THEN 'delivered'
    WHEN _shipping_kind = 'pickup' THEN 'awaiting_pickup'
    ELSE 'awaiting_courier'
  END;
$$;

-- הסכום של ההזמנה מחושב מחדש רק כשכמות / מחיר משתנים (לא בעדכון סטטוס
-- של שורה או בשליחת רישיון)
DROP TRIGGER IF EXISTS order_items_recompute_total ON public.order_items;
CREATE TRIGGER order_items_recompute_total
  AFTER INSERT OR DELETE OR UPDATE OF quantity, unit_price, order_id ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();

-- השורות הקיימות: רק הסטטוס (kobi.stock_sync — בלי לגעת במלאי)
SELECT set_config('kobi.stock_sync', 'on', true);
UPDATE public.order_items oi
   SET item_status = public.order_item_status_for(false, false, o.status, o.shipping_kind)
  FROM public.orders o
 WHERE o.id = oi.order_id AND NOT oi.is_deposit AND oi.item_status IS NULL;
SELECT set_config('kobi.stock_sync', 'off', true);

-- שינוי סטטוס ההזמנה (או סוג המשלוח) → הסטטוס של כל שורה
CREATE OR REPLACE FUNCTION public.orders_sync_item_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.shipping_kind IS NOT DISTINCT FROM OLD.shipping_kind THEN
    RETURN NULL;
  END IF;
  UPDATE public.order_items oi
     SET item_status = public.order_item_status_for(
           oi.is_digital, oi.license_sent_at IS NOT NULL, NEW.status, NEW.shipping_kind)
   WHERE oi.order_id = NEW.id
     AND NOT oi.is_deposit
     AND oi.item_status IS DISTINCT FROM public.order_item_status_for(
           oi.is_digital, oi.license_sent_at IS NOT NULL, NEW.status, NEW.shipping_kind);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS orders_sync_item_status ON public.orders;
CREATE TRIGGER orders_sync_item_status
  AFTER UPDATE OF status, shipping_kind ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_sync_item_status();

-- ------------------------------------------------------------
-- צילום המוצר והמחיר בשורת הזמנה — עכשיו גם וריאציה, דיגיטלי וסטטוס
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  variant_found BOOLEAN := false;
  v_options JSONB;
  v_sku TEXT;
  v_price NUMERIC;
  v_active BOOLEAN;
  label TEXT;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  buyer_custom NUMERIC;
  authoritative NUMERIC;
  staff BOOLEAN := public.is_staff(auth.uid());
  -- שורת מתנה (הטבת עגלה): בחינם, ונוספת רק ע"י apply_order_gifts
  gift BOOLEAN := COALESCE(NEW.is_gift, false);
BEGIN
  -- לקוח לא יכול לסמן שורה כמתנה בעצמו (למשל בקריאה ישירה ל-API) — מתנות
  -- מתווספות רק בתוך apply_order_gifts, אחרי שהמסד בדק שהתנאי של ההטבה מתקיים
  IF gift AND NOT staff AND current_setting('app.order_gifts', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'מתנות מתווספות להזמנה רק אוטומטית, לפי הטבות החנות'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT gift AND NOT staff THEN
    NEW.promotion_id := NULL;
  END IF;

  -- רישיון נמסר רק דרך שליחת הרישיון (שרת) — לא בהוספת שורה
  NEW.digital_license_key := NULL;
  NEW.license_sent_at := NULL;
  NEW.license_sent_to := NULL;
  -- פיקדון שייך למוצר, לא לוריאציה
  IF NEW.is_deposit THEN
    NEW.variant_id := NULL;
  END IF;

  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at,
         has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity,
         is_digital, variant_attributes
    INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  product_found := FOUND;

  -- הוריאציה: חייבת להיות של המוצר הזה
  IF NEW.variant_id IS NOT NULL THEN
    SELECT v.options, v.sku, v.price, v.is_active INTO v_options, v_sku, v_price, v_active
      FROM public.product_variants v
     WHERE v.id = NEW.variant_id AND v.tenant_id = NEW.tenant_id AND v.product_id = NEW.product_id;
    variant_found := FOUND;
    IF NOT variant_found THEN
      RAISE EXCEPTION 'האפשרות שנבחרה לא נמצאה במוצר — רעננו את העמוד ובחרו שוב'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_active AND NOT staff THEN
      RAISE EXCEPTION 'האפשרות "%" של "%" אינה זמינה עוד — הסירו אותה מהסל',
        public.variant_label(v_options, p.variant_attributes), p.name
        USING ERRCODE = 'check_violation';
    END IF;
    label := public.variant_label(v_options, p.variant_attributes);
    NEW.variant_label := label;
  ELSE
    NEW.variant_label := NULL;
    -- למוצר יש וריאציות פעילות: לקוח חייב לבחור (מתנה — הצוות משלים)
    IF product_found AND NOT staff AND NOT NEW.is_deposit AND NOT gift
       AND EXISTS (SELECT 1 FROM public.product_variants v
                    WHERE v.product_id = NEW.product_id AND v.is_active) THEN
      RAISE EXCEPTION 'יש לבחור % עבור "%"',
        (SELECT string_agg(a ->> 'name', ' / ') FROM jsonb_array_elements(p.variant_attributes) a),
        p.name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.is_digital := product_found AND NOT NEW.is_deposit AND COALESCE(p.is_digital, false);

  IF product_found AND staff THEN
    -- צוות: ערכים שנשלחו נשמרים (למשל שם מותאם בהזמנה ידנית), ומה שחסר נלקח מהמוצר
    IF NEW.is_deposit THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), 'פיקדון – ' || p.name);
    ELSIF gift THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''),
        p.name || COALESCE(' — ' || label, '') || ' (מתנה)');
    ELSE
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''),
        p.name || COALESCE(' — ' || label, ''));
    END IF;
    NEW.product_sku := COALESCE(NEW.product_sku, v_sku, p.sku);
    NEW.product_barcode := COALESCE(NEW.product_barcode, p.barcode);
    NEW.product_category := COALESCE(NEW.product_category, p.category);
    NEW.product_image_url := COALESCE(NEW.product_image_url, p.image_url);
    NEW.product_shelf_location := COALESCE(NEW.product_shelf_location, p.shelf_location);
    IF NOT NEW.is_deposit THEN
      NEW.product_pack_size := COALESCE(NEW.product_pack_size, p.pack_size);
    END IF;
  ELSIF product_found THEN
    -- לקוח (וכל קריאה שאינה צוות): הצילום תמיד מהמוצר במסד — ערכים מהדפדפן
    -- נדרסים, כדי שאי אפשר יהיה לכתוב שם/ברקוד/איתור שקריים לבון הליקוט
    NEW.product_name := CASE WHEN NEW.is_deposit THEN 'פיקדון – ' || p.name
                             WHEN gift THEN p.name || COALESCE(' — ' || label, '') || ' (מתנה)'
                             ELSE p.name || COALESCE(' — ' || label, '') END;
    NEW.product_sku := COALESCE(v_sku, p.sku);
    NEW.product_barcode := p.barcode;
    NEW.product_category := p.category;
    NEW.product_image_url := p.image_url;
    NEW.product_shelf_location := p.shelf_location;
    NEW.product_pack_size := CASE WHEN NEW.is_deposit THEN NULL ELSE p.pack_size END;
  END IF;

  SELECT kind, customer_id, status, shipping_kind INTO parent FROM public.orders
   WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id;
  parent_found := FOUND;

  -- הזמנה "דיגיטלית בלבד" (בלי שיטת משלוח) — לא יכולה לקבל מוצר פיזי מלקוח
  IF parent_found AND product_found AND NOT staff AND parent.shipping_kind = 'digital'
     AND NOT NEW.is_deposit AND NOT gift AND NOT COALESCE(p.is_digital, false) THEN
    RAISE EXCEPTION 'המוצר "%" נשלח פיזית — יש לבחור שיטת משלוח', p.name
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.item_status := CASE
    WHEN NEW.is_deposit THEN NULL
    ELSE public.order_item_status_for(NEW.is_digital, false,
           CASE WHEN parent_found THEN parent.status END,
           CASE WHEN parent_found THEN parent.shipping_kind END)
  END;

  -- מוצר שנמכר במארזים: לקוח חייב להזמין כפולה שלמה של המארז (צוות יכול
  -- לחרוג במקרים מיוחדים — הממשק מזהיר אותו). נאכף כאן, לא רק בדפדפן.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.pack_size IS NOT NULL
     AND NOT staff AND NOT gift
     AND (NEW.quantity < p.pack_size OR NEW.quantity % p.pack_size <> 0) THEN
    RAISE EXCEPTION 'המוצר "%" נמכר במארזים של % יחידות — הכמות חייבת להיות %, % וכן הלאה',
      p.name, p.pack_size, p.pack_size, p.pack_size * 2;
  END IF;

  -- מינימום יחידות להזמנה (נפרד מהמארזים, ובמקביל אליהם): לקוח לא יכול להזמין
  -- פחות מהמינימום; כל כמות מעליו מותרת. צוות יכול לחרוג, כמו במארזים.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.min_order_quantity IS NOT NULL
     AND NOT staff AND NOT gift
     AND NEW.quantity < p.min_order_quantity THEN
    RAISE EXCEPTION 'מינימום להזמנה ממוצר "%" הינו % יחידות', p.name, p.min_order_quantity;
  END IF;

  IF parent_found AND NOT staff THEN
    IF parent.kind = 'quote' OR gift THEN
      -- בקשת הצעת מחיר — בלי מחירים; מתנה — בחינם
      NEW.unit_price := 0;
    ELSIF NEW.is_deposit THEN
      IF product_found AND p.deposit_price IS NOT NULL AND p.deposit_units IS NOT NULL THEN
        NEW.unit_price := p.deposit_price * p.deposit_units;
      ELSE
        NEW.unit_price := 0;
      END IF;
    ELSIF variant_found AND v_price IS NOT NULL THEN
      -- וריאציה עם מחיר משלה: המחיר הזה לכל הקונים
      NEW.unit_price := v_price;
    ELSIF product_found THEN
      -- אותו דרג שהקטלוג מציג לקונה (אורח / ממתין לאישור / בלי דרג = 1)
      buyer_tier := public.buyer_price_tier(parent.customer_id);

      authoritative := CASE buyer_tier
                         WHEN 1 THEN p.price_tier1
                         WHEN 2 THEN p.price_tier2
                         WHEN 3 THEN p.price_tier3
                       END;

      -- מחירון אישי: רק ללקוח שיש לו מחירים בכלל (דרג משויך)
      IF authoritative IS NOT NULL THEN
        buyer_custom := public.active_custom_price(parent.customer_id, NEW.product_id);
        IF buyer_custom IS NOT NULL THEN
          authoritative := buyer_custom;
        END IF;
      END IF;

      -- מבצע כללי בתוקף: חל על כולם, אבל לא מייקר ללקוח עם מחיר אישי זול יותר
      IF authoritative IS NOT NULL
         AND public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
        authoritative := LEAST(authoritative, p.sale_price);
      END IF;

      NEW.unit_price := COALESCE(authoritative, 0);
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- פיקדון: כמות שורת הפיקדון = סך היחידות של המוצר בהזמנה (כמה וריאציות
-- של אותו מוצר → שורת פיקדון אחת על הכל)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_order_item_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  deposit_id UUID;
  units INTEGER;
BEGIN
  IF NEW.is_deposit OR NEW.is_gift OR public.is_staff(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT has_deposit, deposit_price, deposit_units INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR NOT COALESCE(p.has_deposit, false)
     OR p.deposit_price IS NULL OR p.deposit_units IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(quantity), 0)::integer INTO units
    FROM public.order_items
   WHERE order_id = NEW.order_id AND product_id = NEW.product_id
     AND NOT is_deposit AND NOT is_gift;

  SELECT id INTO deposit_id
    FROM public.order_items
   WHERE order_id = NEW.order_id AND product_id = NEW.product_id AND is_deposit
   ORDER BY id
   LIMIT 1;

  IF deposit_id IS NULL THEN
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price, is_deposit)
    VALUES (NEW.tenant_id, NEW.order_id, NEW.product_id, units, 0, true);
  ELSE
    UPDATE public.order_items SET quantity = units
     WHERE id = deposit_id AND quantity <> units;
    -- שורות פיקדון כפולות לאותו מוצר (נשלחו מהדפדפן) — מתאחדות לאחת
    DELETE FROM public.order_items
     WHERE order_id = NEW.order_id AND product_id = NEW.product_id AND is_deposit
       AND id <> deposit_id;
  END IF;

  RETURN NULL;
END $$;

-- ------------------------------------------------------------
-- מלאי: מהוריאציה (אם היא סופרת מלאי) או מהמוצר. מוצר דיגיטלי — בלי מלאי.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.variant_stock_reserve(_variant_id uuid, _want integer, _strict boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v RECORD;
  take INTEGER;
BEGIN
  IF _want IS NULL OR _want <= 0 OR _variant_id IS NULL THEN
    RETURN 0;
  END IF;
  -- נעילת שורת הוריאציה: שתי הזמנות במקביל לא ישמרו את אותה יחידה פעמיים
  SELECT pv.stock_quantity, pv.options, gp.name, gp.variant_attributes INTO v
    FROM public.product_variants pv
    JOIN public.global_products gp ON gp.id = pv.product_id
   WHERE pv.id = _variant_id
   FOR UPDATE OF pv;
  IF NOT FOUND OR v.stock_quantity IS NULL THEN
    RETURN 0;
  END IF;
  IF v.stock_quantity <= 0 THEN
    IF _strict THEN
      RAISE EXCEPTION '"%" (%) אזל מהמלאי — הסירו אותו מהסל',
        v.name, public.variant_label(v.options, v.variant_attributes)
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN 0;
  END IF;
  IF _strict AND _want > v.stock_quantity THEN
    RAISE EXCEPTION 'נותרו במלאי רק % יחידות של "%" (%) — עדכנו את הכמות בסל',
      v.stock_quantity, v.name, public.variant_label(v.options, v.variant_attributes)
      USING ERRCODE = 'check_violation';
  END IF;
  take := LEAST(_want, v.stock_quantity);
  UPDATE public.product_variants SET stock_quantity = stock_quantity - take WHERE id = _variant_id;
  RETURN take;
END $$;

-- שמירת מלאי לשורה: מהוריאציה אם היא סופרת מלאי, אחרת מהמוצר
CREATE OR REPLACE FUNCTION public.order_item_reserve(
  _product_id uuid,
  _variant_id uuid,
  _want integer,
  _strict boolean,
  OUT taken integer,
  OUT from_variant boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _variant_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.product_variants
        WHERE id = _variant_id AND stock_quantity IS NOT NULL) THEN
    from_variant := true;
    taken := public.variant_stock_reserve(_variant_id, _want, _strict);
  ELSE
    from_variant := false;
    taken := public.stock_reserve(_product_id, _want, _strict);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.order_item_release(
  _product_id uuid,
  _variant_id uuid,
  _from_variant boolean,
  _qty integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN;
  END IF;
  IF _from_variant THEN
    UPDATE public.product_variants
       SET stock_quantity = stock_quantity + _qty
     WHERE id = _variant_id AND stock_quantity IS NOT NULL;
  ELSE
    PERFORM public.stock_release(_product_id, _qty);
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.variant_stock_reserve(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_item_reserve(uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_item_release(uuid, uuid, boolean, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.order_items_stock_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent RECORD;
  prod RECORD;
  is_customer BOOLEAN;
  active BOOLEAN;
  extra INTEGER;
  r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.reserved_quantity > 0 THEN
      PERFORM public.order_item_release(OLD.product_id, OLD.variant_id,
                                        OLD.reserved_from_variant, OLD.reserved_quantity);
    END IF;
    RETURN OLD;
  END IF;

  -- עדכון פנימי מתוך orders_stock_sync (ביטול/שחזור הזמנה) — עובר כמו שהוא
  IF TG_OP = 'UPDATE' AND current_setting('kobi.stock_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- פיקדון ומוצר דיגיטלי — בלי מלאי פיזי
  IF NEW.is_deposit OR NEW.is_digital THEN
    IF TG_OP = 'UPDATE' AND OLD.reserved_quantity > 0 THEN
      PERFORM public.order_item_release(OLD.product_id, OLD.variant_id,
                                        OLD.reserved_from_variant, OLD.reserved_quantity);
    END IF;
    NEW.reserved_quantity := 0;
    NEW.reserved_from_variant := false;
    RETURN NEW;
  END IF;

  is_customer := NOT public.is_staff(auth.uid());
  SELECT kind, status INTO parent FROM public.orders WHERE id = NEW.order_id;
  active := FOUND AND parent.kind = 'order' AND parent.status <> 'cancelled';

  IF TG_OP = 'INSERT' THEN
    -- הערך לא מגיע מהדפדפן: רק המסד קובע כמה נשמר
    NEW.reserved_quantity := 0;
    NEW.reserved_from_variant := false;
    IF is_customer THEN
      SELECT name, is_hidden, is_out_of_stock INTO prod
        FROM public.global_products WHERE id = NEW.product_id;
      IF FOUND AND prod.is_hidden THEN
        RAISE EXCEPTION 'המוצר "%" אינו זמין עוד להזמנה — הסירו אותו מהסל', prod.name
          USING ERRCODE = 'check_violation';
      END IF;
      IF FOUND AND prod.is_out_of_stock AND parent.kind = 'order' THEN
        RAISE EXCEPTION 'המוצר "%" אזל מהמלאי — הסירו אותו מהסל', prod.name
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF active THEN
      SELECT * INTO r FROM public.order_item_reserve(NEW.product_id, NEW.variant_id, NEW.quantity, is_customer);
      NEW.reserved_quantity := r.taken;
      NEW.reserved_from_variant := r.from_variant;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE מהממשק (עריכת הזמנה ע"י הצוות): reserved_quantity לא ניתן לשינוי ישיר
  NEW.reserved_quantity := OLD.reserved_quantity;
  NEW.reserved_from_variant := OLD.reserved_from_variant;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.variant_id IS DISTINCT FROM OLD.variant_id THEN
    PERFORM public.order_item_release(OLD.product_id, OLD.variant_id,
                                      OLD.reserved_from_variant, OLD.reserved_quantity);
    NEW.reserved_quantity := 0;
    NEW.reserved_from_variant := false;
    -- וריאציה שנמחקה (variant_id → NULL באותו מוצר): לא שומרים במקומה מהמוצר
    IF active AND NOT (NEW.variant_id IS NULL AND OLD.variant_id IS NOT NULL
                       AND NEW.product_id = OLD.product_id) THEN
      SELECT * INTO r FROM public.order_item_reserve(NEW.product_id, NEW.variant_id, NEW.quantity, false);
      NEW.reserved_quantity := r.taken;
      NEW.reserved_from_variant := r.from_variant;
    END IF;
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    IF NEW.quantity < OLD.reserved_quantity THEN
      PERFORM public.order_item_release(NEW.product_id, NEW.variant_id,
                                        OLD.reserved_from_variant, OLD.reserved_quantity - NEW.quantity);
      NEW.reserved_quantity := NEW.quantity;
    ELSIF active AND NEW.quantity > OLD.reserved_quantity THEN
      IF OLD.reserved_quantity = 0 THEN
        SELECT * INTO r FROM public.order_item_reserve(NEW.product_id, NEW.variant_id, NEW.quantity, false);
        NEW.reserved_quantity := r.taken;
        NEW.reserved_from_variant := r.from_variant;
      ELSIF OLD.reserved_from_variant THEN
        extra := public.variant_stock_reserve(NEW.variant_id, NEW.quantity - OLD.reserved_quantity, false);
        NEW.reserved_quantity := OLD.reserved_quantity + extra;
      ELSE
        extra := public.stock_reserve(NEW.product_id, NEW.quantity - OLD.reserved_quantity, false);
        NEW.reserved_quantity := OLD.reserved_quantity + extra;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ביטול / שחזור הזמנה: המלאי חוזר / נשמר מחדש — מאותו מקור (וריאציה / מוצר)
CREATE OR REPLACE FUNCTION public.orders_stock_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it RECORD;
  was_active BOOLEAN := OLD.kind = 'order' AND OLD.status <> 'cancelled';
  now_active BOOLEAN := NEW.kind = 'order' AND NEW.status <> 'cancelled';
  got INTEGER;
  r RECORD;
BEGIN
  IF was_active = now_active THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('kobi.stock_sync', 'on', true);
  FOR it IN
    SELECT id, product_id, variant_id, quantity, reserved_quantity, reserved_from_variant
      FROM public.order_items
     WHERE order_id = NEW.id AND NOT is_deposit AND NOT is_digital
     ORDER BY product_id, variant_id NULLS FIRST
  LOOP
    IF was_active THEN
      IF it.reserved_quantity > 0 THEN
        PERFORM public.order_item_release(it.product_id, it.variant_id,
                                          it.reserved_from_variant, it.reserved_quantity);
        UPDATE public.order_items SET reserved_quantity = 0, reserved_from_variant = false
         WHERE id = it.id;
      END IF;
    ELSIF it.reserved_quantity = 0 THEN
      SELECT * INTO r FROM public.order_item_reserve(it.product_id, it.variant_id, it.quantity, false);
      IF r.taken > 0 THEN
        UPDATE public.order_items SET reserved_quantity = r.taken, reserved_from_variant = r.from_variant
         WHERE id = it.id;
      END IF;
    ELSE
      IF it.reserved_from_variant THEN
        got := public.variant_stock_reserve(it.variant_id, it.quantity - it.reserved_quantity, false);
      ELSE
        got := public.stock_reserve(it.product_id, it.quantity - it.reserved_quantity, false);
      END IF;
      IF got > 0 THEN
        UPDATE public.order_items SET reserved_quantity = reserved_quantity + got WHERE id = it.id;
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('kobi.stock_sync', 'off', true);
  RETURN NULL;
END $$;

-- "שמור להזמנות פתוחות" לפי מוצר — רק מה שנשמר מהמלאי של המוצר עצמו
CREATE OR REPLACE FUNCTION public.stock_reserved_open()
RETURNS TABLE(product_id uuid, reserved integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.product_id, SUM(oi.reserved_quantity)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE public.is_staff(auth.uid())
     AND o.tenant_id = public.current_tenant_id()
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier')
     AND NOT oi.is_deposit
     AND NOT oi.reserved_from_variant
     AND oi.reserved_quantity > 0
   GROUP BY oi.product_id;
$$;

CREATE OR REPLACE FUNCTION public.stock_lookup(_query text)
RETURNS TABLE(id uuid, name text, sku text, barcode text, image_url text, category text, pack_size integer, is_hidden boolean, available integer, reserved integer, locations jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (SELECT btrim(COALESCE(_query, '')) AS t)
  SELECT gp.id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.category, gp.pack_size, gp.is_hidden,
         gp.stock_quantity,
         COALESCE((SELECT SUM(oi.reserved_quantity)::int FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                    WHERE oi.product_id = gp.id AND NOT oi.is_deposit AND NOT oi.reserved_from_variant
                      AND o.kind = 'order'
                      AND o.status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier')), 0),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('location', pl.location, 'quantity', pl.quantity)
                                    ORDER BY (pl.location = 'ראשי') DESC, pl.quantity DESC)
                     FROM public.product_locations pl WHERE pl.product_id = gp.id AND pl.quantity > 0), '[]'::jsonb)
    FROM public.global_products gp, q
   WHERE public.can_pick(auth.uid())
     AND gp.tenant_id = public.current_tenant_id()
     AND length(q.t) >= 2
     AND (gp.barcode = q.t OR gp.sku = q.t OR gp.sku ILIKE q.t || '%' OR gp.name ILIKE '%' || q.t || '%')
   ORDER BY (gp.barcode = q.t OR gp.sku = q.t) DESC, gp.name
   LIMIT 30;
$$;

-- ------------------------------------------------------------
-- ליקוט: שורות דיגיטליות לא נכנסות למחסן; הוריאציה מופיעה בשם ובמק"ט
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.picking_order_lines(_order_id uuid)
RETURNS TABLE(item_id uuid, product_id uuid, name text, sku text, barcode text, image_url text, shelf_location text, pack_size integer, quantity integer, picked boolean, picked_qty integer, picked_at timestamp with time zone, locations jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.id, oi.product_id,
         CASE WHEN oi.variant_label IS NOT NULL
              THEN COALESCE(gp.name, 'מוצר') || ' — ' || oi.variant_label
              ELSE COALESCE(gp.name, 'מוצר') END,
         COALESCE(CASE WHEN oi.variant_id IS NOT NULL THEN oi.product_sku END, gp.sku),
         gp.barcode, gp.image_url,
         NULLIF(btrim(gp.shelf_location), ''), gp.pack_size, oi.quantity, oi.picked, oi.picked_qty, oi.picked_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('location', pl.location, 'quantity', pl.quantity)
                                    ORDER BY (pl.location = 'ראשי') DESC, pl.quantity DESC)
                     FROM public.product_locations pl WHERE pl.product_id = oi.product_id AND pl.quantity > 0), '[]'::jsonb)
    FROM public.order_items oi
    LEFT JOIN public.global_products gp ON gp.id = oi.product_id
   WHERE public.can_pick(auth.uid()) AND oi.order_id = _order_id
     AND NOT oi.is_deposit AND NOT oi.is_digital
     AND oi.tenant_id = public.current_tenant_id()
   ORDER BY NULLIF(btrim(gp.shelf_location), '') NULLS LAST, gp.name, oi.variant_label NULLS FIRST;
$$;

CREATE OR REPLACE FUNCTION public.picking_mark_item(_item_id uuid, _picked_qty integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it public.order_items;
BEGIN
  SELECT * INTO it FROM public.order_items
   WHERE id = _item_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'השורה לא נמצאה';
  END IF;
  IF it.is_deposit THEN
    RAISE EXCEPTION 'פיקדון מתעדכן לבד לפי המוצר';
  END IF;
  IF it.is_digital THEN
    RAISE EXCEPTION 'מוצר דיגיטלי נמסר במייל — אין מה ללקט';
  END IF;
  PERFORM public.picking_assert_order(it.order_id);
  IF _picked_qty IS NULL THEN
    UPDATE public.order_items SET picked = false, picked_qty = NULL, picked_at = NULL WHERE id = _item_id;
  ELSE
    IF _picked_qty < 0 OR _picked_qty > it.quantity THEN
      RAISE EXCEPTION 'כמות שלוקטה חייבת להיות בין 0 ל-%', it.quantity;
    END IF;
    UPDATE public.order_items SET picked = true, picked_qty = _picked_qty, picked_at = now() WHERE id = _item_id;
  END IF;
  PERFORM public.picking_log(it.order_id, 'item',
    jsonb_build_object('item_id', _item_id, 'product_id', it.product_id, 'ordered', it.quantity, 'picked', _picked_qty));
END $$;

CREATE OR REPLACE FUNCTION public.picking_approve(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
  unpicked INTEGER;
  shortages JSONB := '[]'::jsonb;
  r RECORD;
  dep RECORD;
  by_admin BOOLEAN := public.is_admin(auth.uid());
  final_status TEXT;
  physical_units INTEGER;
  picked_units INTEGER;
BEGIN
  IF o.picker_id IS NULL AND NOT by_admin THEN
    RAISE EXCEPTION 'ההזמנה לא נלקחה לליקוט';
  END IF;
  SELECT count(*) INTO unpicked FROM public.order_items
   WHERE order_id = _order_id AND NOT is_deposit AND NOT is_digital AND NOT picked;
  IF unpicked > 0 THEN
    RAISE EXCEPTION 'יש % שורות שעוד לא סומנו', unpicked;
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = _order_id AND NOT is_deposit AND NOT is_digital)
     AND NOT EXISTS (SELECT 1 FROM public.order_items
                      WHERE order_id = _order_id AND NOT is_deposit AND NOT is_digital AND picked_qty > 0) THEN
    RAISE EXCEPTION 'לא לוקט אף פריט — אם ההזמנה לא יוצאת, בטלו אותה בניהול ההזמנות';
  END IF;

  FOR r IN
    SELECT oi.id, oi.product_id, oi.quantity, oi.picked_qty, oi.product_name AS name
      FROM public.order_items oi
     WHERE oi.order_id = _order_id AND NOT oi.is_deposit AND NOT oi.is_digital
       AND oi.picked_qty < oi.quantity
  LOOP
    shortages := shortages || jsonb_build_object(
      'product_id', r.product_id, 'name', r.name, 'ordered', r.quantity, 'picked', r.picked_qty);
    IF r.picked_qty = 0 THEN
      DELETE FROM public.order_items WHERE id = r.id;
    ELSE
      UPDATE public.order_items SET quantity = r.picked_qty WHERE id = r.id;
    END IF;
  END LOOP;

  -- הפיקדון של כל מוצר שחסר — לפי כמה שלוקט בפועל מכל השורות שלו
  FOR dep IN
    SELECT d.id, d.product_id
      FROM public.order_items d
     WHERE d.order_id = _order_id AND d.is_deposit
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(shortages) s
                    WHERE (s ->> 'product_id')::uuid = d.product_id)
  LOOP
    SELECT COALESCE(SUM(quantity), 0)::integer INTO picked_units
      FROM public.order_items
     WHERE order_id = _order_id AND product_id = dep.product_id AND NOT is_deposit AND NOT is_gift;
    IF picked_units = 0 THEN
      DELETE FROM public.order_items WHERE id = dep.id;
    ELSE
      UPDATE public.order_items SET quantity = picked_units WHERE id = dep.id AND quantity <> picked_units;
    END IF;
  END LOOP;

  -- מנהל שמאשר בעצמו — ישר "נשלחה"; מחסנאי — ממתינה לאישור מנהל
  final_status := CASE WHEN by_admin THEN 'shipped' ELSE 'picked' END;
  UPDATE public.orders
     SET status = final_status, picked_at = now(), picking_paused = false,
         picking_approved_by = CASE WHEN by_admin THEN public.tenant_member_id() ELSE NULL END
   WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'approve',
    jsonb_build_object('picker', o.picker_id, 'by_manager', by_admin, 'status', final_status, 'shortages', shortages));
  RETURN jsonb_build_object('shortages', shortages, 'picker_id', o.picker_id, 'status', final_status);
END $$;

CREATE OR REPLACE FUNCTION public.picking_orders()
RETURNS TABLE(id uuid, order_number text, status text, is_urgent boolean, created_at timestamp with time zone, note text, picker_id uuid, picker_name text, picking_paused boolean, picking_claimed_at timestamp with time zone, picked_at timestamp with time zone, picking_approved_by uuid, approved_by_name text, customer_name text, customer_address text, customer_phone text, contact_name text, total_lines integer, picked_lines integer, short_lines integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.order_number, o.status, o.is_urgent, o.created_at, o.note,
         o.picker_id, public.staff_display_name(o.picker_id), o.picking_paused, o.picking_claimed_at,
         o.picked_at, o.picking_approved_by, public.staff_display_name(o.picking_approved_by),
         COALESCE(o.customer_name, cp.business_name, cp.contact_name, 'לקוח'),
         CASE WHEN o.shipping_kind = 'pickup'
                THEN 'איסוף עצמי'
              WHEN o.ship_to_different
                THEN concat_ws(', ', o.shipping_address, o.shipping_city, o.shipping_zip)
              WHEN o.billing_address IS NOT NULL
                THEN concat_ws(', ', o.billing_address, o.billing_city, o.billing_zip)
              ELSE cp.business_address END,
         COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_phone END, o.customer_phone, cp.phone),
         CASE WHEN o.ship_to_different THEN o.shipping_name
              ELSE COALESCE(cp.contact_name, o.customer_name) END,
         (SELECT count(*)::int FROM public.order_items oi
           WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_digital),
         (SELECT count(*)::int FROM public.order_items oi
           WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_digital AND oi.picked),
         (SELECT count(*)::int FROM public.picking_events e, jsonb_array_elements(e.details -> 'shortages') s
           WHERE e.order_id = o.id AND e.action = 'approve'
             AND e.created_at = (SELECT max(e2.created_at) FROM public.picking_events e2 WHERE e2.order_id = o.id AND e2.action = 'approve'))
         + (SELECT count(*)::int FROM public.order_items oi
             WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_digital
               AND oi.picked AND oi.picked_qty < oi.quantity)
    FROM public.orders o
    LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id
   WHERE public.can_pick(auth.uid())
     AND o.tenant_id = public.current_tenant_id()
     AND (o.status IN ('picking', 'picked') OR (o.status IN ('awaiting_courier', 'shipped', 'delivered') AND o.picked_at > now() - interval '45 days'))
     -- הזמנה שכולה דיגיטלית — אין מה ללקט
     AND EXISTS (SELECT 1 FROM public.order_items oi
                  WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_digital)
   ORDER BY CASE o.status WHEN 'picking' THEN 0 WHEN 'picked' THEN 1 ELSE 2 END, o.is_urgent DESC, o.created_at;
$$;

-- ============================================================
-- 5. הקופה: משלוח, כתובת לפי הצורך, וריאציות
-- ============================================================

-- בדיקת הטופס — עם _need_address = false (איסוף עצמי / סל דיגיטלי) הכתובת
-- רשות (ואם הוזנה — נבדקת), ואין "שלח לכתובת אחרת"
CREATE OR REPLACE FUNCTION public.normalize_checkout_details(_details jsonb, _guest boolean, _need_address boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_tax text;
  v_phone text;
  v_email text;
  v_city text;
  v_address text;
  v_zip text;
  v_ship boolean;
  s_name text;
  s_phone text;
  s_city text;
  s_address text;
  s_zip text;
  v_note text;
BEGIN
  IF _details IS NULL OR jsonb_typeof(_details) <> 'object' THEN
    RAISE EXCEPTION 'חסרים פרטי ההזמנה (שם, כתובת וטלפון)' USING ERRCODE = 'check_violation';
  END IF;

  v_name := btrim(COALESCE(_details ->> 'customer_name', ''));
  IF length(v_name) < 2 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'נא להזין שם מלא או שם חברה' USING ERRCODE = 'check_violation';
  END IF;

  v_tax := regexp_replace(COALESCE(_details ->> 'customer_tax_id', ''), '\D', '', 'g');
  IF v_tax !~ '^[0-9]{5,12}$' THEN
    RAISE EXCEPTION 'נא להזין מספר ת.ז / ח.פ תקין (ספרות בלבד)' USING ERRCODE = 'check_violation';
  END IF;

  v_phone := regexp_replace(COALESCE(_details ->> 'customer_phone', ''), '[^0-9+]', '', 'g');
  IF v_phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'נא להזין מספר טלפון תקין' USING ERRCODE = 'check_violation';
  END IF;

  v_email := NULLIF(lower(btrim(COALESCE(_details ->> 'customer_email', ''))), '');
  IF v_email IS NULL AND _guest THEN
    RAISE EXCEPTION 'נא להזין כתובת אימייל — אליה יישלח אישור ההזמנה'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_email IS NOT NULL AND (length(v_email) > 254
     OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
    RAISE EXCEPTION 'כתובת האימייל אינה תקינה' USING ERRCODE = 'check_violation';
  END IF;

  v_city := NULLIF(btrim(COALESCE(_details ->> 'billing_city', '')), '');
  IF (v_city IS NULL AND _need_address) OR length(v_city) < 2 OR length(v_city) > 80 THEN
    RAISE EXCEPTION 'נא להזין עיר' USING ERRCODE = 'check_violation';
  END IF;
  v_address := NULLIF(btrim(COALESCE(_details ->> 'billing_address', '')), '');
  IF (v_address IS NULL AND _need_address) OR length(v_address) < 2 OR length(v_address) > 200 THEN
    RAISE EXCEPTION 'נא להזין כתובת (רחוב ומספר בית)' USING ERRCODE = 'check_violation';
  END IF;
  v_zip := NULLIF(regexp_replace(COALESCE(_details ->> 'billing_zip', ''), '\D', '', 'g'), '');
  IF (v_zip IS NULL AND _need_address) OR v_zip !~ '^[0-9]{5,7}$' THEN
    RAISE EXCEPTION 'נא להזין מיקוד תקין (5 או 7 ספרות)' USING ERRCODE = 'check_violation';
  END IF;

  v_ship := _need_address AND COALESCE(_details ->> 'ship_to_different', 'false') = 'true';
  IF v_ship THEN
    s_name := btrim(COALESCE(_details ->> 'shipping_name', ''));
    IF length(s_name) < 2 OR length(s_name) > 120 THEN
      RAISE EXCEPTION 'נא להזין את שם מקבל המשלוח' USING ERRCODE = 'check_violation';
    END IF;
    s_phone := NULLIF(regexp_replace(COALESCE(_details ->> 'shipping_phone', ''), '[^0-9+]', '', 'g'), '');
    IF s_phone IS NOT NULL AND s_phone !~ '^\+?[0-9]{9,15}$' THEN
      RAISE EXCEPTION 'מספר הטלפון של מקבל המשלוח אינו תקין' USING ERRCODE = 'check_violation';
    END IF;
    s_city := btrim(COALESCE(_details ->> 'shipping_city', ''));
    IF length(s_city) < 2 OR length(s_city) > 80 THEN
      RAISE EXCEPTION 'נא להזין את עיר המשלוח' USING ERRCODE = 'check_violation';
    END IF;
    s_address := btrim(COALESCE(_details ->> 'shipping_address', ''));
    IF length(s_address) < 2 OR length(s_address) > 200 THEN
      RAISE EXCEPTION 'נא להזין את כתובת המשלוח (רחוב ומספר בית)' USING ERRCODE = 'check_violation';
    END IF;
    s_zip := regexp_replace(COALESCE(_details ->> 'shipping_zip', ''), '\D', '', 'g');
    IF s_zip !~ '^[0-9]{5,7}$' THEN
      RAISE EXCEPTION 'נא להזין מיקוד תקין לכתובת המשלוח (5 או 7 ספרות)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_note := NULLIF(btrim(COALESCE(_details ->> 'note', '')), '');
  IF length(v_note) > 1000 THEN
    RAISE EXCEPTION 'ההערות ארוכות מדי (עד 1000 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(_details ->> 'accepted_terms', 'false') <> 'true' THEN
    RAISE EXCEPTION 'יש לאשר את תנאי השימוש כדי להשלים את ההזמנה'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'customer_name', v_name,
    'customer_tax_id', v_tax,
    'customer_phone', v_phone,
    'customer_email', v_email,
    'billing_city', v_city,
    'billing_address', v_address,
    'billing_zip', v_zip,
    'ship_to_different', v_ship,
    'shipping_name', s_name,
    'shipping_phone', s_phone,
    'shipping_city', s_city,
    'shipping_address', s_address,
    'shipping_zip', s_zip,
    'note', v_note
  );
END $$;

-- הגרסה הקודמת (שתי פרמטרים) — כתובת חובה, כמו קודם
CREATE OR REPLACE FUNCTION public.normalize_checkout_details(_details jsonb, _guest boolean)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.normalize_checkout_details(_details, _guest, true);
$$;

-- המשלוח של סל: אם יש בו מוצר פיזי — השיטה שנבחרה (פעילה, של החנות);
-- סל דיגיטלי בלבד — בלי משלוח. need_address = משלוח לכתובת (או חנות בלי
-- שיטות משלוח בכלל — כמו קודם).
CREATE OR REPLACE FUNCTION public.checkout_shipping(_items jsonb, _details jsonb)
RETURNS TABLE(method_id uuid, kind text, need_address boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _method uuid := public.uuid_or_null(_details ->> 'shipping_method_id');
  _kind text;
  has_physical boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) AS x
      LEFT JOIN public.global_products gp
             ON gp.tenant_id = _tenant AND gp.id = public.uuid_or_null(x ->> 'product_id')
     WHERE COALESCE(x ->> 'is_gift', 'false') <> 'true'
       AND COALESCE(x ->> 'is_deposit', 'false') <> 'true'
       AND NOT COALESCE(gp.is_digital, false)
  ) INTO has_physical;

  IF NOT has_physical THEN
    RETURN QUERY SELECT NULL::uuid, 'digital'::text, false;
    RETURN;
  END IF;

  IF _method IS NULL THEN
    -- _details = NULL: קריאה בפורמט הישן (בלי טופס קופה) — כמו קודם, בלי שיטה
    IF _details IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.shipping_methods m WHERE m.tenant_id = _tenant AND m.is_active) THEN
      RAISE EXCEPTION 'נא לבחור שיטת משלוח' USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY SELECT NULL::uuid, NULL::text, true;
    RETURN;
  END IF;

  SELECT m.kind INTO _kind
    FROM public.shipping_methods m
   WHERE m.id = _method AND m.tenant_id = _tenant AND m.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'שיטת המשלוח שנבחרה אינה זמינה עוד — בחרו שיטה אחרת'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY SELECT _method, _kind, _kind = 'delivery';
END $$;

REVOKE ALL ON FUNCTION public.checkout_shipping(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkout_shipping(jsonb, jsonb) TO authenticated, service_role;

-- שליחת הזמנה של לקוח מחובר. _details = טופס הקופה (כולל shipping_method_id).
-- השורות: product_id, variant_id, quantity (המחיר נקבע במסד). שורות פיקדון
-- נוצרות במסד לפי המוצר — מה שהדפדפן שלח לא נכנס.
CREATE OR REPLACE FUNCTION public.place_order(
  _kind text,
  _items jsonb,
  _vat_rate numeric,
  _prices_include_vat boolean,
  _details jsonb DEFAULT NULL
)
RETURNS TABLE(id uuid, order_number text, kind text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  created RECORD;
  d jsonb;
  ship RECORD;
  staff boolean := public.is_staff(auth.uid());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'יש להתחבר כדי לשלוח הזמנה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הסל ריק';
  END IF;
  IF jsonb_array_length(_items) > 400 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת';
  END IF;

  SELECT * INTO ship FROM public.checkout_shipping(_items, _details);

  IF _details IS NOT NULL THEN
    d := public.normalize_checkout_details(_details, false, ship.need_address);
    -- לקוח רשום: אם לא הוזן אימייל אחר — האימייל של החשבון
    IF d ->> 'customer_email' IS NULL THEN
      d := d || jsonb_build_object('customer_email',
        (SELECT ur.email FROM public.user_roles ur WHERE ur.user_id = auth.uid()));
    END IF;
  END IF;

  INSERT INTO public.orders AS o (
    customer_id, status, kind, total, vat_rate, prices_include_vat, note,
    customer_name, customer_tax_id, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip,
    terms_accepted_at, shipping_method_id, shipping_kind)
  VALUES (
    auth.uid(), 'pending', COALESCE(_kind, 'order'), 0,
    COALESCE(_vat_rate, 18), COALESCE(_prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    COALESCE((d ->> 'ship_to_different')::boolean, false),
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    CASE WHEN d IS NULL THEN NULL ELSE now() END,
    ship.method_id, ship.kind)
  RETURNING o.id, o.order_number, o.kind INTO created;

  -- מיון לפי מוצר ווריאציה: נעילות המלאי נלקחות תמיד באותו סדר (בלי
  -- deadlock בין הזמנות). שורות "מתנה" מהדפדפן לא נכנסות — המתנות נקבעות במסד.
  INSERT INTO public.order_items (order_id, product_id, variant_id, quantity, unit_price, is_deposit)
  SELECT created.id,
         (x ->> 'product_id')::uuid,
         CASE WHEN COALESCE((x ->> 'is_deposit')::boolean, false) THEN NULL
              ELSE public.uuid_or_null(x ->> 'variant_id') END,
         (x ->> 'quantity')::integer,
         COALESCE((x ->> 'unit_price')::numeric, 0),
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
     AND (staff OR NOT COALESCE((x ->> 'is_deposit')::boolean, false))
   ORDER BY (x ->> 'product_id'), public.uuid_or_null(x ->> 'variant_id') NULLS FIRST,
            COALESCE((x ->> 'is_deposit')::boolean, false);

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts(created.id);
  END IF;

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END $$;

REVOKE ALL ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb)
  TO authenticated, service_role;

-- הזמנת אורח (בלי חשבון) — מהשרת של האתר בלבד (service_role)
CREATE OR REPLACE FUNCTION public.place_guest_order(_kind text, _items jsonb, _details jsonb)
RETURNS TABLE(id uuid, order_number text, kind text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  d jsonb;
  st RECORD;
  ship RECORD;
  created RECORD;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'משתמש מחובר שולח הזמנה מהחשבון שלו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הסל ריק';
  END IF;
  IF jsonb_array_length(_items) > 400 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת';
  END IF;

  SELECT * INTO ship FROM public.checkout_shipping(_items, _details);
  d := public.normalize_checkout_details(_details, true, ship.need_address);

  -- מצב המע"מ של החנות (לא מהדפדפן)
  SELECT s.vat_rate, s.prices_include_vat INTO st
    FROM public.site_settings s WHERE s.tenant_id = _tenant;

  INSERT INTO public.orders AS o (
    tenant_id, customer_id, status, kind, total, vat_rate, prices_include_vat, note,
    customer_name, customer_tax_id, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip,
    terms_accepted_at, shipping_method_id, shipping_kind)
  VALUES (
    _tenant, NULL, 'pending', CASE WHEN _kind = 'quote' THEN 'quote' ELSE 'order' END, 0,
    COALESCE(st.vat_rate, 18), COALESCE(st.prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    (d ->> 'ship_to_different')::boolean,
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    now(), ship.method_id, ship.kind)
  RETURNING o.id, o.order_number, o.kind INTO created;

  INSERT INTO public.order_items (tenant_id, order_id, product_id, variant_id, quantity, unit_price, is_deposit)
  SELECT _tenant,
         created.id,
         (x ->> 'product_id')::uuid,
         public.uuid_or_null(x ->> 'variant_id'),
         (x ->> 'quantity')::integer,
         0,
         false
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
     AND NOT COALESCE((x ->> 'is_deposit')::boolean, false)
   ORDER BY (x ->> 'product_id'), public.uuid_or_null(x ->> 'variant_id') NULLS FIRST;

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts_internal(created.id);
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.kind, o.total FROM public.orders o WHERE o.id = created.id;
END $$;

REVOKE ALL ON FUNCTION public.place_guest_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_guest_order(text, jsonb, jsonb) TO service_role;

-- ============================================================
-- 6. הקטלוג: דיגיטלי, מאפיינים ווריאציות (עם המחיר של הצופה)
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
  is_digital boolean, variant_attributes jsonb, variants jsonb)
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
    COALESCE(var.list, '[]'::jsonb) AS variants
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
  WHERE NOT gp.is_hidden
    AND gp.tenant_id = v.tenant_id
    -- חנות מוקפאת או במצב שבת: הקטלוג ריק ללקוחות ולאורחים; הצוות ממשיך לראות
    AND (public.tenant_storefront_open(v.tenant_id) OR public.is_staff(auth.uid()))
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated, service_role;

COMMIT;

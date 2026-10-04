-- ============================================================
-- חלק 14: שיווק, נטישות, אינטגרציות וייבוא נתונים
--
-- 1. SEO: כותרת ותיאור לחנות (site_settings) ולכל מוצר, ו"הצג בזאפ"
--    (show_in_zap) לכל מוצר. storefront_feed_products — הקטלוג הציבורי
--    (מחיר לאורח) לעמודי המוצר, למפת האתר ולפיד של זאפ.
-- 2. ייבוא מוצרים מ-CSV (import_products): שורה-שורה, כל שורה בנפרד —
--    שורה שגויה לא מפילה את כל הקובץ. קטגוריה חסרה נוצרת.
-- 3. קופונים (coupons) + פופ-אפ מבצעים בכניסה לאתר. ההנחה נקבעת במסד בלבד:
--    הקופון נבדק ביצירת ההזמנה (טריגר), וההנחה מחושבת יחד עם הסכום הכולל
--    (orders_shipping_and_total). הדפדפן שולח רק את הקוד.
-- 4. עגלות נטושות (abandoned_carts): נשמרות מהקופה ברגע שיש אימייל, ונסגרות
--    לבד ("שוחזרה") כשאותו אימייל משלים הזמנה. קישור שחזור סודי לכל עגלה.
-- 5. התראת מלאי נמוך (3 יחידות או פחות) — פעם אחת עד שהמלאי עולה שוב;
--    מעקב: Facebook Pixel ו-Google Analytics (site_settings, בפורמט קשיח).
-- 6. Google SSO נעול בחבילה הבסיסית — גם בהרשמה עצמית במסד (user_roles).
-- 7. חבילות ומחירים (platform_plans) — עורך בפאנל הפלטפורמה; "המנוי שלי"
--    של כל חנות קורא מכאן.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SEO, זאפ, פופ-אפ ומעקב — הגדרות החנות
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS promo_popup_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS promo_popup_text TEXT NOT NULL DEFAULT '',
  -- קוד קופון שמוצג בפופ-אפ עם כפתור "העתקה" (לא חובה)
  ADD COLUMN IF NOT EXISTS promo_popup_coupon TEXT,
  ADD COLUMN IF NOT EXISTS facebook_pixel_id TEXT,
  ADD COLUMN IF NOT EXISTS google_analytics_id TEXT,
  -- זמן האספקה שמופיע בפיד של זאפ (ימי עסקים)
  ADD COLUMN IF NOT EXISTS zap_delivery_days SMALLINT NOT NULL DEFAULT 3;

DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_seo_check
    CHECK (char_length(seo_title) <= 120 AND char_length(seo_description) <= 320);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_promo_popup_check
    CHECK (char_length(promo_popup_text) <= 600
           AND (NOT promo_popup_enabled OR btrim(promo_popup_text) <> '')
           AND (promo_popup_coupon IS NULL OR promo_popup_coupon ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- המזהים נכנסים לקוד שרץ בדפדפן (<head>) — רק הפורמט הרשמי, בלי שום תו אחר
DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_tracking_check
    CHECK ((facebook_pixel_id IS NULL OR facebook_pixel_id ~ '^[0-9]{6,20}$')
           AND (google_analytics_id IS NULL
                OR google_analytics_id ~ '^(G|GT|AW)-[A-Z0-9]{4,16}$'
                OR google_analytics_id ~ '^UA-[0-9]{4,10}-[0-9]{1,4}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_zap_delivery_days_check
    CHECK (zap_delivery_days BETWEEN 0 AND 60);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.site_settings.seo_title IS 'כותרת לגוגל ולשיתוף (ריק = שם העסק)';
COMMENT ON COLUMN public.site_settings.seo_description IS 'תיאור לגוגל ולשיתוף (עד 320 תווים)';
COMMENT ON COLUMN public.site_settings.facebook_pixel_id IS 'מזהה Facebook Pixel (ספרות בלבד) — מוזרק ל-<head>';
COMMENT ON COLUMN public.site_settings.google_analytics_id IS 'מזהה Google Analytics (G-XXXX) — מוזרק ל-<head>';

-- ============================================================
-- 1b. SEO וזאפ — מוצרים
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS seo_title TEXT,
  ADD COLUMN IF NOT EXISTS seo_description TEXT,
  ADD COLUMN IF NOT EXISTS show_in_zap BOOLEAN NOT NULL DEFAULT true,
  -- נשלחה התראת "מלאי נמוך" — מתאפס לבד כשהמלאי עולה מעל הסף
  ADD COLUMN IF NOT EXISTS low_stock_alerted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS low_stock_alerted BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.global_products ADD CONSTRAINT global_products_seo_check
    CHECK ((seo_title IS NULL OR char_length(seo_title) <= 120)
           AND (seo_description IS NULL OR char_length(seo_description) <= 320));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.global_products.show_in_zap IS
  'להציג את המוצר בפיד של זאפ השוואת מחירים (/zap.xml)';

-- הקטלוג הציבורי — המחיר שאורח רואה (דרג 1, כולל מבצע בתוקף). לעמוד המוצר
-- (תגיות SEO), למפת האתר ולפיד של זאפ. בלי מצב שבת: הפיד לא נעלם מגוגל
-- ומזאפ בכל שבת (העמודים עצמם מציגים "שבת שלום"). חנות מוקפאת / שהמנוי
-- שלה פג — ריק.
CREATE OR REPLACE FUNCTION public.storefront_feed_products()
RETURNS TABLE(
  id uuid, sku text, name text, category text, description text, image_url text,
  barcode text, price numeric, regular_price numeric, in_stock boolean,
  is_digital boolean, show_in_zap boolean, seo_title text, seo_description text,
  updated_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gp.id, gp.sku::text, gp.name, gp.category, gp.description, gp.image_url,
         gp.barcode,
         CASE WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)
                   AND gp.sale_price < gp.price_tier1
              THEN gp.sale_price ELSE gp.price_tier1 END,
         gp.price_tier1,
         NOT gp.is_out_of_stock
           AND (NOT EXISTS (SELECT 1 FROM public.product_variants pv
                             WHERE pv.product_id = gp.id AND pv.is_active)
                OR EXISTS (SELECT 1 FROM public.product_variants pv
                            WHERE pv.product_id = gp.id AND pv.is_active
                              AND (pv.stock_quantity IS NULL OR pv.stock_quantity > 0))),
         gp.is_digital, gp.show_in_zap, gp.seo_title, gp.seo_description, gp.updated_at
    FROM public.global_products gp
   WHERE gp.tenant_id = public.current_tenant_id()
     AND NOT gp.is_hidden
     AND public.tenant_is_active(gp.tenant_id)
     AND public.tenant_subscription_active(gp.tenant_id)
   ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.storefront_feed_products() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_feed_products() TO service_role;

-- ============================================================
-- 2. ייבוא מוצרים מ-CSV
-- ============================================================
-- השורות כבר מפוענחות (בשרת): [{row, name, price, category, description,
-- sku, barcode, stock, image_url, sale_price, sale_ends_at, cost_price,
-- hidden, show_in_zap, seo_title, seo_description}]. כל שורה בתת-טרנזקציה
-- משלה: שגיאה בשורה אחת נרשמת ולא מבטלת את האחרות. רץ בהרשאות המשתמש
-- (RLS + מגבלת החבילה בטריגרים) — רק מנהל החנות. מחיר מבצע בלי תאריך סיום
-- (חובה בחנות) — המוצר נוצר בלי המבצע, עם אזהרה.
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
  limit_hit boolean := false;
  _name text;
  _price numeric;
  _sale numeric;
  _sale_ends timestamptz;
  _cost numeric;
  _stock integer;
  _category text;
  _sku text;
  _barcode text;
  _image text;
  _description text;
  _hidden boolean;
  _zap boolean;
  _seo_title text;
  _seo_description text;
  _new_category boolean;
  _tries integer;
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

      _category := left(btrim(regexp_replace(COALESCE(r ->> 'category', ''), '\s+', ' ', 'g')), 60);
      IF _category = '' THEN
        _category := 'כללי';
      END IF;

      _barcode := NULLIF(btrim(COALESCE(r ->> 'barcode', '')), '');
      IF _barcode IS NOT NULL AND char_length(_barcode) > 64 THEN
        RAISE EXCEPTION 'ברקוד ארוך מדי';
      END IF;

      _image := NULLIF(btrim(COALESCE(r ->> 'image_url', '')), '');
      IF _image IS NOT NULL AND (_image !~* '^https?://[^\s]+$' OR char_length(_image) > 1000) THEN
        RAISE EXCEPTION 'קישור התמונה חייב להתחיל ב-https://';
      END IF;

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

      _new_category := false;
      IF NOT EXISTS (SELECT 1 FROM public.categories c
                      WHERE c.tenant_id = _tenant AND c.name = _category) THEN
        INSERT INTO public.categories (tenant_id, name) VALUES (_tenant, _category);
        _new_category := true;
      END IF;

      INSERT INTO public.global_products (
        tenant_id, sku, name, category, description, image_url, images, barcode,
        shelf_location, price_tier1, price_tier2, price_tier3, uniform_price,
        cost_price, is_promo, sale_price, sale_ends_at, stock_quantity, is_out_of_stock,
        is_hidden, show_in_zap, seo_title, seo_description, created_by)
      VALUES (
        _tenant, _sku, _name, _category, _description, _image,
        CASE WHEN _image IS NULL THEN '{}'::text[] ELSE ARRAY[_image] END, _barcode,
        'A0A', _price, _price, _price, true,
        _cost, _sale IS NOT NULL, _sale, _sale_ends, _stock, false,
        _hidden, _zap, _seo_title, _seo_description, auth.uid());

      created := created + 1;
      IF _warning IS NOT NULL THEN
        warnings := warnings || jsonb_build_object('row', _row, 'name', _name, 'message', _warning);
      END IF;
      IF _new_category THEN
        new_categories := new_categories || _category;
      END IF;
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

-- ============================================================
-- 3. קופונים
-- ============================================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        UUID NOT NULL DEFAULT public.current_tenant_id()
                   REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- אותיות גדולות באנגלית, ספרות, מקף וקו תחתון (מנורמל בטריגר)
  code             TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  discount_type    TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value   NUMERIC(12, 2) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  description      TEXT CHECK (description IS NULL OR char_length(description) <= 160),
  -- סכום מוצרים מינימלי (לפני משלוח); NULL = בלי מינימום
  min_order_total  NUMERIC(12, 2) CHECK (min_order_total IS NULL OR min_order_total > 0),
  -- כמה הזמנות יכולות להשתמש בקופון (הזמנות שבוטלו לא נספרות); NULL = ללא הגבלה
  max_uses         INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  starts_at        TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_by       UUID DEFAULT auth.uid(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_key UNIQUE (tenant_id, code),
  CONSTRAINT coupons_value_check CHECK (
    discount_value > 0
    AND (discount_type <> 'percent' OR discount_value <= 100)
    AND discount_value <= 1000000),
  CONSTRAINT coupons_dates_check CHECK (
    starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX IF NOT EXISTS coupons_tenant_idx ON public.coupons (tenant_id, created_at DESC);

COMMENT ON TABLE public.coupons IS
  'קודי הנחה של החנות: אחוז או סכום קבוע מסכום המוצרים (לפני משלוח)';

CREATE OR REPLACE FUNCTION public.coupons_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.code := upper(btrim(COALESCE(NEW.code, '')));
  NEW.description := NULLIF(btrim(COALESCE(NEW.description, '')), '');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coupons_normalize ON public.coupons;
CREATE TRIGGER coupons_normalize
  BEFORE INSERT OR UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.coupons_normalize();

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.coupons;
CREATE POLICY tenant_isolation ON public.coupons
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- הלקוחות לא רואים את רשימת הקופונים — רק בדיקת קוד שהקלידו (check_coupon)
DROP POLICY IF EXISTS "coupons managed by admin" ON public.coupons;
CREATE POLICY "coupons managed by admin" ON public.coupons
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.coupons FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;
GRANT ALL ON public.coupons TO service_role;

-- הקופון על ההזמנה: הקוד וצילום של תנאי ההנחה (שינוי בקופון אחר כך לא
-- משנה הזמנות קיימות), והסכום שהופחת בפועל
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS coupon_discount_type TEXT,
  ADD COLUMN IF NOT EXISTS coupon_discount_value NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS coupon_min_order NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_coupon_check
    CHECK ((coupon_discount_type IS NULL OR coupon_discount_type IN ('percent', 'fixed'))
           AND discount_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS orders_coupon_idx ON public.orders (coupon_id) WHERE coupon_id IS NOT NULL;

-- מה מונע מהקופון לחול עכשיו (NULL = תקין). _subtotal = סכום המוצרים (לפני
-- משלוח); NULL = בלי בדיקת מינימום
CREATE OR REPLACE FUNCTION public.coupon_problem(c public.coupons, _subtotal numeric)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  used integer;
BEGIN
  IF c.id IS NULL OR NOT c.is_active THEN
    RETURN 'קוד הקופון לא נמצא או שאינו פעיל';
  END IF;
  IF c.starts_at IS NOT NULL AND c.starts_at > now() THEN
    RETURN 'הקופון עוד לא בתוקף';
  END IF;
  IF c.expires_at IS NOT NULL AND c.expires_at <= now() THEN
    RETURN 'תוקף הקופון הסתיים';
  END IF;
  IF c.max_uses IS NOT NULL THEN
    SELECT count(*) INTO used
      FROM public.orders o
     WHERE o.coupon_id = c.id AND o.status <> 'cancelled';
    IF used >= c.max_uses THEN
      RETURN 'הקופון כבר נוצל עד הסוף';
    END IF;
  END IF;
  IF _subtotal IS NOT NULL AND c.min_order_total IS NOT NULL AND _subtotal < c.min_order_total THEN
    RETURN format('הקופון תקף בהזמנה של ₪%s ומעלה (לפני משלוח)', trim_scale(c.min_order_total));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.coupon_problem(public.coupons, numeric) FROM PUBLIC, anon, authenticated;

-- בדיקת קוד מהקופה (מהשרת של האתר, עם הגבלת קצב לפי IP)
CREATE OR REPLACE FUNCTION public.check_coupon(_code text, _subtotal numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  problem text;
BEGIN
  SELECT * INTO c FROM public.coupons
   WHERE tenant_id = public.current_tenant_id()
     AND code = upper(btrim(COALESCE(_code, '')));
  problem := public.coupon_problem(c, _subtotal);
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '%', problem USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object(
    'code', c.code,
    'discount_type', c.discount_type,
    'discount_value', c.discount_value,
    'min_order_total', c.min_order_total,
    'description', c.description);
END $$;
REVOKE ALL ON FUNCTION public.check_coupon(text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_coupon(text, numeric) TO service_role;

-- הקופון נקבע ביצירת ההזמנה בלבד: הדפדפן שולח רק coupon_code, והתנאים
-- נלקחים מטבלת הקופונים (שדות ההנחה שנשלחו ישירות — נדרסים). אחר כך:
-- צוות יכול רק להסיר את הקופון; כל שינוי אחר בשדות האלה מתבטל.
CREATE OR REPLACE FUNCTION public.orders_apply_coupon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.coupons;
  problem text;
  _code text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.coupon_code IS NULL AND OLD.coupon_code IS NOT NULL AND public.is_staff(auth.uid()) THEN
      NEW.coupon_id := NULL;
      NEW.coupon_discount_type := NULL;
      NEW.coupon_discount_value := NULL;
      NEW.coupon_min_order := NULL;
    ELSE
      -- קופון שנמחק (ON DELETE SET NULL): הקישור מתנתק, הצילום על ההזמנה נשאר
      NEW.coupon_id := CASE
        WHEN NEW.coupon_id IS NULL AND OLD.coupon_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM public.coupons cp WHERE cp.id = OLD.coupon_id) THEN NULL
        ELSE OLD.coupon_id
      END;
      NEW.coupon_code := OLD.coupon_code;
      NEW.coupon_discount_type := OLD.coupon_discount_type;
      NEW.coupon_discount_value := OLD.coupon_discount_value;
      NEW.coupon_min_order := OLD.coupon_min_order;
    END IF;
    RETURN NEW;
  END IF;

  _code := upper(btrim(COALESCE(NEW.coupon_code, '')));
  NEW.coupon_id := NULL;
  NEW.coupon_discount_type := NULL;
  NEW.coupon_discount_value := NULL;
  NEW.coupon_min_order := NULL;
  IF _code = '' THEN
    NEW.coupon_code := NULL;
    RETURN NEW;
  END IF;

  -- נעילת הקופון: שתי הזמנות במקביל לא יעברו יחד את מגבלת השימושים
  SELECT * INTO c FROM public.coupons
   WHERE tenant_id = NEW.tenant_id AND code = _code
   FOR UPDATE;
  problem := public.coupon_problem(c, NULL);
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION '%', problem USING ERRCODE = 'check_violation';
  END IF;
  NEW.coupon_id := c.id;
  NEW.coupon_code := c.code;
  NEW.coupon_discount_type := c.discount_type;
  NEW.coupon_discount_value := c.discount_value;
  NEW.coupon_min_order := c.min_order_total;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_apply_coupon ON public.orders;
-- השם קודם ל-orders_shipping_and_total בסדר האלפביתי — רץ לפניו
CREATE TRIGGER orders_apply_coupon
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_apply_coupon();

-- הסכום הכולל: שורות ההזמנה + משלוח − הנחת קופון. ההנחה על סכום המוצרים
-- (בלי פיקדונות, מתנות ומשלוח), רק אם הגיעו למינימום של הקופון, ולא יותר
-- מסכום המוצרים. בקשה להצעת מחיר — בלי הנחה (עד שהצוות ממיר להזמנה).
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
  v_discount NUMERIC := 0;
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

  IF NEW.kind <> 'quote'
     AND NEW.coupon_discount_type IS NOT NULL
     AND v_products > 0
     AND v_products >= COALESCE(NEW.coupon_min_order, 0) THEN
    v_discount := CASE NEW.coupon_discount_type
      WHEN 'percent' THEN round(v_products * NEW.coupon_discount_value / 100, 2)
      ELSE NEW.coupon_discount_value
    END;
    v_discount := GREATEST(LEAST(v_discount, round(v_products, 2)), 0);
  END IF;
  NEW.discount_amount := v_discount;
  NEW.total := v_items + NEW.shipping_price - v_discount;
  RETURN NEW;
END $$;

-- אחרי השליחה: קופון עם מינימום שלא הגיעו אליו — הודעה ברורה (וההזמנה
-- מתבטלת), במקום הזמנה "בלי ההנחה" בשקט
CREATE OR REPLACE FUNCTION public.order_coupon_verify(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_products numeric;
BEGIN
  SELECT coupon_code, coupon_min_order, kind INTO o FROM public.orders WHERE id = _order;
  IF NOT FOUND OR o.coupon_code IS NULL OR o.kind = 'quote' OR o.coupon_min_order IS NULL THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(oi.quantity * oi.unit_price)
                    FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0)
    INTO v_products
    FROM public.order_items oi
   WHERE oi.order_id = _order;
  IF v_products < o.coupon_min_order THEN
    RAISE EXCEPTION 'הקופון % תקף בהזמנה של ₪% ומעלה (לפני משלוח) — הוסיפו מוצרים או הסירו את הקופון',
      o.coupon_code, trim_scale(o.coupon_min_order)
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.order_coupon_verify(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_coupon_verify(uuid) TO authenticated, service_role;

-- כמה פעמים כל קופון נוצל, וכמה הנחה ניתנה (למסך הקופונים של המנהל)
CREATE OR REPLACE FUNCTION public.coupon_usage()
RETURNS TABLE(coupon_id uuid, uses bigint, discount_total numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצפות בקופונים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.coupon_id, count(*), COALESCE(SUM(o.discount_amount), 0)
      FROM public.orders o
     WHERE o.tenant_id = public.current_tenant_id()
       AND o.coupon_id IS NOT NULL
       AND o.status <> 'cancelled'
     GROUP BY o.coupon_id;
END $$;
REVOKE ALL ON FUNCTION public.coupon_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coupon_usage() TO authenticated;

-- שליחת הזמנה של לקוח מחובר — כמו קודם, ועכשיו גם coupon_code מטופס הקופה
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
    terms_accepted_at, shipping_method_id, shipping_kind, coupon_code)
  VALUES (
    auth.uid(), 'pending', COALESCE(_kind, 'order'), 0,
    COALESCE(_vat_rate, 18), COALESCE(_prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    COALESCE((d ->> 'ship_to_different')::boolean, false),
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    CASE WHEN d IS NULL THEN NULL ELSE now() END,
    ship.method_id, ship.kind,
    NULLIF(left(btrim(COALESCE(_details ->> 'coupon_code', '')), 40), ''))
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
  PERFORM public.order_coupon_verify(created.id);

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END $$;

REVOKE ALL ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb)
  TO authenticated, service_role;

-- הזמנת אורח (בלי חשבון) — מהשרת של האתר בלבד (service_role), עם קופון
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
    terms_accepted_at, shipping_method_id, shipping_kind, coupon_code)
  VALUES (
    _tenant, NULL, 'pending', CASE WHEN _kind = 'quote' THEN 'quote' ELSE 'order' END, 0,
    COALESCE(st.vat_rate, 18), COALESCE(st.prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    (d ->> 'ship_to_different')::boolean,
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    now(), ship.method_id, ship.kind,
    NULLIF(left(btrim(COALESCE(_details ->> 'coupon_code', '')), 40), ''))
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
  PERFORM public.order_coupon_verify(created.id);

  RETURN QUERY
    SELECT o.id, o.order_number, o.kind, o.total FROM public.orders o WHERE o.id = created.id;
END $$;

REVOKE ALL ON FUNCTION public.place_guest_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_guest_order(text, jsonb, jsonb) TO service_role;

-- ============================================================
-- 4. עגלות נטושות
-- ============================================================
CREATE TABLE IF NOT EXISTS public.abandoned_carts (
  id                  UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID NOT NULL DEFAULT public.current_tenant_id()
                      REFERENCES public.tenants(id) ON DELETE RESTRICT,
  -- מזהה העגלה בדפדפן (מתחלף אחרי הזמנה) — עדכון של אותה עגלה ולא שורה חדשה
  session_key         UUID NOT NULL,
  -- סוד לקישור "להשלמת ההזמנה" במייל התזכורת
  restore_token       UUID NOT NULL DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL CHECK (char_length(email) <= 254
                                           AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  customer_name       TEXT CHECK (customer_name IS NULL OR char_length(customer_name) <= 120),
  phone               TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  -- [{product_id, variant_id, name, variant_label, quantity, unit_price, image_url}]
  items               JSONB NOT NULL CHECK (jsonb_typeof(items) = 'array'
                                            AND jsonb_array_length(items) BETWEEN 1 AND 100),
  item_count          INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  total               NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'recovered', 'dismissed')),
  recovered_order_id  UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  reminder_count      INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  last_reminder_at    TIMESTAMPTZ,
  last_reminder_coupon TEXT,
  -- מתי נפתח קישור השחזור מהמייל (בפעם האחרונה)
  restored_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT abandoned_carts_session_key UNIQUE (tenant_id, session_key),
  CONSTRAINT abandoned_carts_token_key UNIQUE (restore_token)
);
CREATE INDEX IF NOT EXISTS abandoned_carts_list_idx
  ON public.abandoned_carts (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS abandoned_carts_email_idx
  ON public.abandoned_carts (tenant_id, lower(email)) WHERE status = 'open';

COMMENT ON TABLE public.abandoned_carts IS
  'עגלות שהגיעו לקופה עם אימייל ולא הושלמו — לתזכורת במייל (עם קופון)';

ALTER TABLE public.abandoned_carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.abandoned_carts;
CREATE POLICY tenant_isolation ON public.abandoned_carts
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- נשמרות רק מהשרת (save_abandoned_cart); המנהל קורא, מעדכן (תזכורת /
-- "סגור") ומוחק
DROP POLICY IF EXISTS "abandoned carts readable by admin" ON public.abandoned_carts;
CREATE POLICY "abandoned carts readable by admin" ON public.abandoned_carts
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "abandoned carts updatable by admin" ON public.abandoned_carts;
CREATE POLICY "abandoned carts updatable by admin" ON public.abandoned_carts
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "abandoned carts deletable by admin" ON public.abandoned_carts;
CREATE POLICY "abandoned carts deletable by admin" ON public.abandoned_carts
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.abandoned_carts FROM anon, authenticated;
GRANT SELECT, DELETE ON public.abandoned_carts TO authenticated;
GRANT UPDATE (status, reminder_count, last_reminder_at, last_reminder_coupon, updated_at)
  ON public.abandoned_carts TO authenticated;
GRANT ALL ON public.abandoned_carts TO service_role;

-- שמירת העגלה מהקופה (מהשרת של האתר). המחירים והשמות — מהמסד (המחיר
-- הרגיל לאורח), לא מהדפדפן. סל ריק → העגלה נמחקת. מי שהשלים הזמנה עם
-- אותו אימייל ברבע השעה האחרונה — לא נשמר (מרוץ בין השמירה לשליחה).
CREATE OR REPLACE FUNCTION public.save_abandoned_cart(
  _session uuid,
  _email text,
  _name text,
  _phone text,
  _items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _clean_email text := lower(btrim(COALESCE(_email, '')));
  _lines jsonb;
  _count integer;
  _total numeric;
  _id uuid;
BEGIN
  IF _tenant IS NULL OR _session IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.tenant_storefront_open(_tenant) THEN
    RETURN NULL;
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) > 100 THEN
    RAISE EXCEPTION 'עגלה לא תקינה';
  END IF;
  IF char_length(_clean_email) > 254
     OR _clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RETURN NULL;
  END IF;

  WITH req AS (
    SELECT public.uuid_or_null(x ->> 'product_id') AS product_id,
           public.uuid_or_null(x ->> 'variant_id') AS variant_id,
           CASE WHEN (x ->> 'quantity') ~ '^[0-9]{1,6}$' THEN (x ->> 'quantity')::integer END AS qty,
           ord
      FROM jsonb_array_elements(_items) WITH ORDINALITY AS t(x, ord)
  ), lines AS (
    SELECT r.ord, r.product_id, pv.id AS variant_id, r.qty, gp.name, gp.image_url,
           CASE WHEN pv.id IS NOT NULL
                THEN public.variant_label(pv.options, gp.variant_attributes) END AS variant_label,
           round(COALESCE(pv.price,
             CASE WHEN public.sale_is_active(gp.sale_price, gp.sale_starts_at, gp.sale_ends_at)
                       AND gp.sale_price < gp.price_tier1
                  THEN gp.sale_price ELSE gp.price_tier1 END), 2) AS unit_price
      FROM req r
      JOIN public.global_products gp
        ON gp.id = r.product_id AND gp.tenant_id = _tenant AND NOT gp.is_hidden
      LEFT JOIN public.product_variants pv
        ON pv.id = r.variant_id AND pv.product_id = gp.id AND pv.is_active
     WHERE r.qty BETWEEN 1 AND 100000
  )
  SELECT jsonb_agg(jsonb_build_object(
           'product_id', l.product_id,
           'variant_id', l.variant_id,
           'name', l.name,
           'variant_label', l.variant_label,
           'quantity', l.qty,
           'unit_price', l.unit_price,
           'image_url', l.image_url) ORDER BY l.ord),
         COALESCE(SUM(l.qty), 0),
         COALESCE(SUM(l.qty * l.unit_price), 0)
    INTO _lines, _count, _total
    FROM lines l;

  IF _lines IS NULL THEN
    DELETE FROM public.abandoned_carts
     WHERE tenant_id = _tenant AND session_key = _session AND status = 'open';
    RETURN NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders o
              WHERE o.tenant_id = _tenant
                AND lower(o.customer_email) = _clean_email
                AND o.created_at > now() - interval '15 minutes') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.abandoned_carts AS ac (
    tenant_id, session_key, email, customer_name, phone, items, item_count, total)
  VALUES (
    _tenant, _session, _clean_email,
    NULLIF(left(btrim(COALESCE(_name, '')), 120), ''),
    NULLIF(left(btrim(COALESCE(_phone, '')), 30), ''),
    _lines, _count, LEAST(round(_total, 2), 9999999999.99))
  ON CONFLICT (tenant_id, session_key) DO UPDATE
    SET email = EXCLUDED.email,
        customer_name = EXCLUDED.customer_name,
        phone = EXCLUDED.phone,
        items = EXCLUDED.items,
        item_count = EXCLUDED.item_count,
        total = EXCLUDED.total,
        updated_at = now()
    WHERE ac.status = 'open'
  RETURNING ac.id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.save_abandoned_cart(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_abandoned_cart(uuid, text, text, text, jsonb) TO service_role;

-- קישור השחזור מהמייל: מה היה בעגלה (ובאיזה קופון התזכורת נשלחה)
CREATE OR REPLACE FUNCTION public.abandoned_cart_restore(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ac public.abandoned_carts;
BEGIN
  SELECT * INTO ac FROM public.abandoned_carts
   WHERE restore_token = _token AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הקישור לא תקף — ייתכן שהעגלה כבר נמחקה' USING ERRCODE = 'no_data_found';
  END IF;
  IF ac.status = 'recovered' THEN
    RAISE EXCEPTION 'ההזמנה מהעגלה הזו כבר הושלמה — תודה!' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.abandoned_carts SET restored_at = now() WHERE id = ac.id;
  RETURN jsonb_build_object(
    'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'product_id', i ->> 'product_id',
                'variant_id', i ->> 'variant_id',
                'quantity', (i ->> 'quantity')::integer)), '[]'::jsonb)
                FROM jsonb_array_elements(ac.items) i),
    'email', ac.email,
    'name', ac.customer_name,
    'phone', ac.phone,
    'session_key', ac.session_key,
    'coupon', ac.last_reminder_coupon);
END $$;
REVOKE ALL ON FUNCTION public.abandoned_cart_restore(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.abandoned_cart_restore(uuid) TO service_role;

-- הזמנה עם אותו אימייל → העגלות הפתוחות שלו "שוחזרו"
CREATE OR REPLACE FUNCTION public.orders_recover_abandoned_carts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_email IS NOT NULL AND btrim(NEW.customer_email) <> '' THEN
    UPDATE public.abandoned_carts
       SET status = 'recovered', recovered_order_id = NEW.id, updated_at = now()
     WHERE tenant_id = NEW.tenant_id
       AND status = 'open'
       AND lower(email) = lower(btrim(NEW.customer_email));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS orders_recover_abandoned_carts ON public.orders;
CREATE TRIGGER orders_recover_abandoned_carts
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_recover_abandoned_carts();

-- ============================================================
-- 5. התראת מלאי נמוך
-- ============================================================
-- מלאי שעלה מעל הסף (קליטה / ספירה / ביטול הזמנה) — אפשר להתריע שוב
CREATE OR REPLACE FUNCTION public.reset_low_stock_alert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity IS NULL OR NEW.stock_quantity > 3 THEN
    NEW.low_stock_alerted := false;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS global_products_reset_low_stock ON public.global_products;
CREATE TRIGGER global_products_reset_low_stock
  BEFORE UPDATE OF stock_quantity ON public.global_products
  FOR EACH ROW EXECUTE FUNCTION public.reset_low_stock_alert();
DROP TRIGGER IF EXISTS product_variants_reset_low_stock ON public.product_variants;
CREATE TRIGGER product_variants_reset_low_stock
  BEFORE UPDATE OF stock_quantity ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.reset_low_stock_alert();

-- אחרי הזמנה: המוצרים / הוריאציות שההזמנה הורידה להם מלאי (מלאי שנספר
-- בפועל) ונשארו עם 3 יחידות או פחות — כל אחד מסומן ומוחזר פעם אחת בלבד
CREATE OR REPLACE FUNCTION public.claim_low_stock_alerts(_order uuid, _threshold integer DEFAULT 3)
RETURNS TABLE(alert_product_id uuid, alert_name text, alert_variant text, alert_sku text, alert_stock integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH prod AS (
    UPDATE public.global_products gp
       SET low_stock_alerted = true
     WHERE gp.id IN (SELECT oi.product_id FROM public.order_items oi
                      WHERE oi.order_id = _order
                        AND oi.reserved_quantity > 0
                        AND NOT oi.reserved_from_variant)
       AND gp.tenant_id = public.current_tenant_id()
       AND gp.stock_quantity <= _threshold
       AND NOT gp.low_stock_alerted
    RETURNING gp.id, gp.name, NULL::text AS variant, gp.sku::text AS sku, gp.stock_quantity
  ), vars AS (
    UPDATE public.product_variants pv
       SET low_stock_alerted = true
      FROM public.global_products gp
     WHERE pv.id IN (SELECT oi.variant_id FROM public.order_items oi
                      WHERE oi.order_id = _order
                        AND oi.reserved_quantity > 0
                        AND oi.reserved_from_variant)
       AND gp.id = pv.product_id
       AND pv.tenant_id = public.current_tenant_id()
       AND pv.stock_quantity IS NOT NULL
       AND pv.stock_quantity <= _threshold
       AND NOT pv.low_stock_alerted
    RETURNING gp.id, gp.name, public.variant_label(pv.options, gp.variant_attributes),
              COALESCE(pv.sku, gp.sku::text), pv.stock_quantity
  )
  SELECT * FROM prod
  UNION ALL
  SELECT * FROM vars;
END $$;
REVOKE ALL ON FUNCTION public.claim_low_stock_alerts(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_low_stock_alerts(uuid, integer) TO service_role;

-- ============================================================
-- 6. Google SSO — רק בחבילות שכוללות אותו (גם בהרשמה עצמית במסד)
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_roles_require_google_feature()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _claims jsonb := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  _oauth boolean;
BEGIN
  -- רק הרשמה עצמית (המשתמש רושם את עצמו); מנהל שמוסיף משתמש — לא כאן
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(_claims -> 'amr') = 'array' THEN _claims -> 'amr' ELSE '[]'::jsonb END) e
     WHERE e ->> 'method' = 'oauth'
  ) INTO _oauth;
  IF _oauth AND NOT public.tenant_has_feature(NEW.tenant_id, 'google_login') THEN
    RAISE EXCEPTION 'התחברות עם Google אינה זמינה בחנות הזו — הירשמו עם קוד למייל'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_roles_require_google_feature ON public.user_roles;
CREATE TRIGGER user_roles_require_google_feature
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_require_google_feature();

-- ============================================================
-- 7. חבילות ומחירים — עורך בפאנל הפלטפורמה
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_plans (
  plan_type      TEXT PRIMARY KEY CHECK (plan_type IN ('basic', 'premium')),
  title          TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  tagline        TEXT NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 160),
  monthly_price  NUMERIC(10, 2) NOT NULL CHECK (monthly_price >= 0 AND monthly_price <= 100000),
  features       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 20),
  -- תווית על הכרטיס ("הכי משתלם"); NULL = בלי
  badge          TEXT CHECK (badge IS NULL OR char_length(badge) <= 40),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     UUID
);
COMMENT ON TABLE public.platform_plans IS
  'מה שכתוב בכרטיסי המחירים ("המנוי שלי"): כותרת, משפט, מחיר חודשי ורשימת פיצ''רים. ההרשאות עצמן — plan_features';

CREATE TABLE IF NOT EXISTS public.platform_pricing_settings (
  id            BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  payment_note  TEXT NOT NULL DEFAULT '' CHECK (char_length(payment_note) <= 200),
  vat_note      TEXT NOT NULL DEFAULT '' CHECK (char_length(vat_note) <= 200),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID
);

INSERT INTO public.platform_plans (plan_type, title, tagline, monthly_price, features, badge)
VALUES
  ('basic', 'חבילה בסיסית', 'כל מה שצריך כדי למכור באונליין — מהיום הראשון', 450,
   ARRAY['עד 1,000 מוצרים', 'סאב-דומיין יוקרתי', 'קופה חכמה ללא נטישות',
         'מערכת הזדהות בקוד למייל', 'דשבורד סטטיסטיקות', 'מצב שבת',
         'ניהול הזמנות ושליחים', 'הדפסת מדבקות משלוח', 'מנוע מבצעים'],
   NULL),
  ('premium', 'חבילת פרימיום', 'לחנויות שגדלות — בלי מגבלות ועם כל הכלים', 700,
   ARRAY['מוצרים ללא הגבלה!', 'חיבור דומיין אישי משלך', 'מכירת מוצרים דיגיטליים',
         'ניהול וריאציות (צבעים / מידות)', 'התחברות לקוחות דרך Google', 'צ''אט תמיכה VIP',
         'כולל כל פיצ''רי הבסיס'],
   'הכי משתלם')
ON CONFLICT (plan_type) DO NOTHING;

INSERT INTO public.platform_pricing_settings (id, payment_note, vat_note)
VALUES (true,
        'התשלום הינו מראש לשנה, או בפריסה ל-12 תשלומים חודשיים שווים.',
        '* המחירים אינם כוללים מע״מ (עוסק פטור)')
ON CONFLICT (id) DO NOTHING;

-- כולם קוראים (תצוגת מחירים); כתיבה רק דרך platform_save_pricing
ALTER TABLE public.platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_pricing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans readable by everyone" ON public.platform_plans;
CREATE POLICY "plans readable by everyone" ON public.platform_plans
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "pricing notes readable by everyone" ON public.platform_pricing_settings;
CREATE POLICY "pricing notes readable by everyone" ON public.platform_pricing_settings
  FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.platform_plans, public.platform_pricing_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_plans, public.platform_pricing_settings TO anon, authenticated;
GRANT ALL ON public.platform_plans, public.platform_pricing_settings TO service_role;

-- שמירת העורך: _plans = [{plan_type, title, tagline, monthly_price, features[], badge}],
-- _notes = {payment_note, vat_note}. הכל או כלום.
CREATE OR REPLACE FUNCTION public.platform_save_pricing(_plans jsonb, _notes jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p jsonb;
  _type text;
  _features text[];
  _feature text;
  _price numeric;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל הפלטפורמה יכול לערוך את החבילות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _plans IS NULL OR jsonb_typeof(_plans) <> 'array' THEN
    RAISE EXCEPTION 'נתוני החבילות לא תקינים';
  END IF;

  FOR p IN SELECT value FROM jsonb_array_elements(_plans) LOOP
    _type := p ->> 'plan_type';
    IF _type NOT IN ('basic', 'premium') THEN
      RAISE EXCEPTION 'חבילה לא מוכרת: %', COALESCE(_type, '');
    END IF;
    IF char_length(btrim(COALESCE(p ->> 'title', ''))) NOT BETWEEN 1 AND 60 THEN
      RAISE EXCEPTION 'שם החבילה: 1 עד 60 תווים';
    END IF;
    IF COALESCE(p ->> 'monthly_price', '') !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'מחיר חודשי לא תקין';
    END IF;
    _price := (p ->> 'monthly_price')::numeric;
    IF _price > 100000 THEN
      RAISE EXCEPTION 'מחיר חודשי לא תקין';
    END IF;
    IF jsonb_typeof(p -> 'features') <> 'array' THEN
      RAISE EXCEPTION 'רשימת הפיצ''רים לא תקינה';
    END IF;
    _features := '{}';
    FOR _feature IN SELECT btrim(value) FROM jsonb_array_elements_text(p -> 'features') LOOP
      CONTINUE WHEN _feature = '';
      IF char_length(_feature) > 120 THEN
        RAISE EXCEPTION 'פיצ''ר ארוך מדי (עד 120 תווים): %', left(_feature, 30) || '…';
      END IF;
      _features := _features || _feature;
    END LOOP;
    IF cardinality(_features) = 0 OR cardinality(_features) > 20 THEN
      RAISE EXCEPTION 'בכל חבילה 1 עד 20 פיצ''רים';
    END IF;

    INSERT INTO public.platform_plans AS pp (plan_type, title, tagline, monthly_price, features, badge, updated_at, updated_by)
    VALUES (_type,
            btrim(p ->> 'title'),
            left(btrim(COALESCE(p ->> 'tagline', '')), 160),
            _price,
            _features,
            NULLIF(left(btrim(COALESCE(p ->> 'badge', '')), 40), ''),
            now(), auth.uid())
    ON CONFLICT (plan_type) DO UPDATE
      SET title = EXCLUDED.title, tagline = EXCLUDED.tagline,
          monthly_price = EXCLUDED.monthly_price, features = EXCLUDED.features,
          badge = EXCLUDED.badge, updated_at = now(), updated_by = auth.uid();
  END LOOP;

  IF _notes IS NOT NULL THEN
    IF char_length(COALESCE(_notes ->> 'payment_note', '')) > 200
       OR char_length(COALESCE(_notes ->> 'vat_note', '')) > 200 THEN
      RAISE EXCEPTION 'ההערות מתחת למחירים: עד 200 תווים';
    END IF;
    INSERT INTO public.platform_pricing_settings AS ps (id, payment_note, vat_note, updated_at, updated_by)
    VALUES (true, btrim(COALESCE(_notes ->> 'payment_note', '')), btrim(COALESCE(_notes ->> 'vat_note', '')),
            now(), auth.uid())
    ON CONFLICT (id) DO UPDATE
      SET payment_note = EXCLUDED.payment_note, vat_note = EXCLUDED.vat_note,
          updated_at = now(), updated_by = auth.uid();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_save_pricing(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_pricing(jsonb, jsonb) TO authenticated;

COMMIT;

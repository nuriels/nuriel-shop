-- ============================================================
-- SaaS מרובה חנויות — חלק 4: הגדרות חנות (מצב שבת, צבע מותג) + כתובות שמורות
-- ============================================================
-- • הגדרות החנות נשמרות ב-site_settings (שורה אחת לכל חנות), כמו כל שאר
--   ההגדרות שמנהל החנות כבר עורך: טלפון (business_phone / support_phone),
--   כתובת (business_address), לוגו (logo_path) ותצוגת מע"מ
--   (prices_include_vat). כאן נוספים רק השדות החסרים:
--     is_sabbath_mode — מצב שבת: הקטלוג מוסתר ואי אפשר להזמין
--     brand_color     — צבע המותג (#rrggbb); ריק = עיצוב ברירת המחדל
-- • מצב שבת נאכף גם במסד, לא רק במסך: הקטלוג ריק ללקוחות ולאורחים, והזמנה
--   חדשה של לקוח נחסמת עם הודעה ברורה (גם מלשונית פתוחה / קריאה ישירה).
--   צוות החנות ממשיך לעבוד (הזמנה ידנית, פאנל ניהול).
-- • כתובות שמורות לחנויות: נוסף "nuri" (שאר הכתובות של האתרים בשרת —
--   kobi, kaia, inv, moments, api, www, admin, app, platform — כבר חסומות).
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. כתובות שמורות
-- ============================================================
CREATE OR REPLACE FUNCTION public.platform_reserved_slugs()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY[
    'www', 'api', 'admin', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets',
    'studio', 'status', 'help', 'support', 'docs', 'blog', 'test', 'dev', 'staging',
    'nuriel', 'platform', 'kobi', 'kaia', 'moments', 'inv', 'nuri'
  ];
$$;

-- ============================================================
-- 2. שדות חדשים בהגדרות החנות
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS is_sabbath_mode BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_color TEXT
    CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$');

COMMENT ON COLUMN public.site_settings.is_sabbath_mode IS
  'מצב שבת: הקטלוג מוסתר ללקוחות ולאורחים, ואי אפשר לבצע הזמנות';
COMMENT ON COLUMN public.site_settings.brand_color IS
  'צבע המותג של החנות (#rrggbb, אותיות קטנות). NULL = עיצוב ברירת המחדל';

-- ============================================================
-- 3. האם החנות פתוחה ללקוחות: פעילה (לא מוקפאת) ולא במצב שבת
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_storefront_open(_tenant uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.tenant_is_active(_tenant)
     AND NOT COALESCE((SELECT s.is_sabbath_mode FROM public.site_settings s
                        WHERE s.tenant_id = _tenant), false);
$$;
GRANT EXECUTE ON FUNCTION public.tenant_storefront_open(uuid) TO anon, authenticated, service_role;

-- הקטלוג
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE(id uuid, sku character varying, name text, category text, description text, image_url text, images text[], colors text[], barcode text, is_promo boolean, is_out_of_stock boolean, price numeric, original_price numeric, sale_ends_at timestamp with time zone, created_at timestamp with time zone, has_deposit boolean, deposit_price numeric, deposit_units integer, pack_size integer, min_order_quantity integer, is_custom_price boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH viewer AS (
    SELECT
      CASE
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
      END AS tier,
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
    gp.is_out_of_stock,
    CASE
      WHEN pr.base_price IS NULL THEN NULL
      WHEN pr.sale_applies THEN gp.sale_price
      ELSE pr.base_price
    END AS price,
    CASE WHEN pr.sale_applies THEN pr.base_price ELSE NULL END AS original_price,
    CASE WHEN pr.sale_applies THEN gp.sale_ends_at ELSE NULL END AS sale_ends_at,
    gp.created_at,
    gp.has_deposit, gp.deposit_price, gp.deposit_units,
    gp.pack_size,
    gp.min_order_quantity,
    (pr.custom_price IS NOT NULL AND NOT pr.sale_applies) AS is_custom_price
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
  WHERE NOT gp.is_hidden
    AND gp.tenant_id = v.tenant_id
    -- חנות מוקפאת או במצב שבת: הקטלוג ריק ללקוחות ולאורחים; הצוות ממשיך לראות
    AND (public.tenant_storefront_open(v.tenant_id) OR public.is_staff(auth.uid()))
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;

-- הזמנה חדשה של לקוח כשהחנות סגורה — הודעה ברורה במקום שגיאת הרשאה כללית.
-- טריגר (ולא רק מדיניות) כדי לתפוס כל דרך ליצירת הזמנה.
CREATE OR REPLACE FUNCTION public.orders_require_open_storefront()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- צוות החנות (הזמנה ידנית) ופעולות שרת בלי משתמש — לא נחסמים
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF NOT public.tenant_is_active(NEW.tenant_id) THEN
    RAISE EXCEPTION 'האתר נעול זמנית — לא ניתן לבצע הזמנות כרגע'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.site_settings s
              WHERE s.tenant_id = NEW.tenant_id AND s.is_sabbath_mode) THEN
    RAISE EXCEPTION 'שבת שלום — האתר שומר שבת. ניתן להזמין במוצאי שבת'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_require_open_storefront ON public.orders;
CREATE TRIGGER orders_require_open_storefront
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_require_open_storefront();

NOTIFY pgrst, 'reload schema';

COMMIT;

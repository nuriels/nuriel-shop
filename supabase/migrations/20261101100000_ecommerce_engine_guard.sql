-- ============================================================
-- מנוע Ecommerce — הגנה: טבלאות החנות רק לאתרים מסוג ecommerce (Hospitality Stage 1b)
-- ============================================================
-- מה המיגרציה עושה (תוספתי; לחנויות הקיימות — אין שינוי התנהגות):
--   1. רישום התפקידים של Ecommerce ב-platform_product_roles: בדיוק חמשת
--      התפקידים שה-CHECK של user_roles מתיר היום (admin, agent, customer,
--      warehouse, cashier). מכאן כלל "תפקידים לפי מוצר" (מיגרציה 20261101090000)
--      חל גם על חנויות — ומתיר את כל התפקידים שלהן כמו קודם.
--   2. 40 טבלאות Ecommerce (docs/architecture/db-classification.md) מקבלות:
--      • AFTER INSERT ברמת פקודה (transition table) — שאילתה אחת לפקודה, לא
--        לשורה: אם אחת השורות שייכת לאתר שאינו ecommerce — הפקודה נכשלת.
--      • BEFORE UPDATE OF tenant_id לשורה, עם WHEN (tenant_id השתנה) — לא רץ
--        בכלל בעדכון רגיל (PostgreSQL לא מתיר transition table עם רשימת עמודות).
--      טריגרים חלים על כל נתיב כתיבה: PostgREST, פונקציות SECURITY DEFINER,
--      service_role ו-postgres — שלא כמו RLS.
--   3. מדיניות RESTRICTIVE חדשה על storage.objects: בדלי product-images אין
--      כתיבה/עדכון באתר מסוג hospitality. המדיניות הקיימות לא שונו; אתר שלא
--      זוהה (NULL) מתנהג כמו קודם.
--
-- אידמפוטנטי. Rollback: supabase/rollbacks/20261101100000_ecommerce_engine_guard.down.sql
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ------------------------------------------------------------
-- 1. תפקידי Ecommerce
-- ------------------------------------------------------------
INSERT INTO public.platform_product_roles (product, role) VALUES
  ('ecommerce', 'admin'),
  ('ecommerce', 'agent'),
  ('ecommerce', 'customer'),
  ('ecommerce', 'warehouse'),
  ('ecommerce', 'cashier')
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 2. הגנת כתיבה על טבלאות Ecommerce
-- ------------------------------------------------------------
-- הוספה: פקודה אחת = בדיקה אחת על כל השורות שנוספו
CREATE OR REPLACE FUNCTION public.ecommerce_rows_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _site text;
BEGIN
  SELECT t.site_type INTO _site
    FROM (SELECT DISTINCT n.tenant_id FROM new_rows n) n
    JOIN public.tenants t ON t.id = n.tenant_id
   WHERE t.site_type <> 'ecommerce'
   LIMIT 1;
  IF _site IS NOT NULL THEN
    RAISE EXCEPTION 'הטבלה % שייכת למנוע החנויות ואינה זמינה לאתר מסוג %', TG_TABLE_NAME, _site
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.ecommerce_rows_guard() FROM PUBLIC, anon, authenticated;

-- העברת שורה לאתר אחר (tenant_id משתנה) — רק בין אתרי ecommerce
CREATE OR REPLACE FUNCTION public.ecommerce_row_move_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _site text;
BEGIN
  SELECT t.site_type INTO _site FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF _site IS DISTINCT FROM 'ecommerce' AND _site IS NOT NULL THEN
    RAISE EXCEPTION 'הטבלה % שייכת למנוע החנויות ואינה זמינה לאתר מסוג %', TG_TABLE_NAME, _site
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ecommerce_row_move_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'abandoned_carts', 'cancellation_requests', 'cart_promotions', 'categories',
    'coupon_email_sends', 'coupons', 'customer_carts', 'customer_emails',
    'customer_invites', 'customer_profiles', 'global_products', 'grow_payment_processes',
    'home_banner_slides', 'location_transfer_lines', 'location_transfers',
    'order_courier_links', 'order_delivery_events', 'order_items', 'order_number_counters',
    'orders', 'pages', 'pending_products', 'picking_events', 'price_tier_backup',
    'product_categories', 'product_drafts', 'product_locations', 'product_relations',
    'product_reviews', 'product_serials', 'product_stickers', 'product_variants',
    'service_agreements', 'shared_carts', 'shipping_methods', 'stock_count_lines',
    'stock_counts', 'tenant_addons', 'tenant_subscriptions', 'user_custom_prices'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ecommerce_rows_guard ON public.%I', _t);
    EXECUTE format(
      'CREATE TRIGGER ecommerce_rows_guard AFTER INSERT ON public.%I '
      'REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT '
      'EXECUTE FUNCTION public.ecommerce_rows_guard()', _t);
    EXECUTE format('DROP TRIGGER IF EXISTS ecommerce_row_move_guard ON public.%I', _t);
    EXECUTE format(
      'CREATE TRIGGER ecommerce_row_move_guard BEFORE UPDATE OF tenant_id ON public.%I '
      'FOR EACH ROW WHEN (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) '
      'EXECUTE FUNCTION public.ecommerce_row_move_guard()', _t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. תמונות מוצרים — לא באתר מסוג hospitality
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "product images not on hospitality sites (insert)" ON storage.objects;
CREATE POLICY "product images not on hospitality sites (insert)" ON storage.objects
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id <> 'product-images' OR public.current_site_type() IS DISTINCT FROM 'hospitality');
DROP POLICY IF EXISTS "product images not on hospitality sites (update)" ON storage.objects;
CREATE POLICY "product images not on hospitality sites (update)" ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket_id <> 'product-images' OR public.current_site_type() IS DISTINCT FROM 'hospitality')
  WITH CHECK (bucket_id <> 'product-images' OR public.current_site_type() IS DISTINCT FROM 'hospitality');

COMMIT;

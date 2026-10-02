-- ============================================================
-- SaaS מרובה חנויות — חלק 1: tenant_id + RLS להפרדה הרמטית בין חנויות
-- ============================================================
-- מה המיגרציה עושה:
--   1. טבלת tenants (חנויות) + חנות ברירת מחדל שכל המידע הקיים משויך אליה.
--   2. עמודת tenant_id (NOT NULL + FK) בכל 26 הטבלאות העסקיות, עם מילוי
--      אוטומטי בהוספה (DEFAULT public.current_tenant_id()) — הקוד הקיים
--      ממשיך לעבוד בלי לשלוח tenant_id.
--   3. מדיניות RLS מסוג RESTRICTIVE בשם tenant_isolation על כל טבלה:
--      היא מצטרפת ב-AND לכל המדיניות הקיימת (מנהל/סוכן/לקוח), כך שההרשאות
--      הקיימות לא משתנות — רק מוגבלות לחנות של המשתמש.
--   4. ייחודיות לפי חנות (מק"ט, ברקוד, מספר הזמנה, שם קטגוריה...) ומפתחות
--      זרים מורכבים (tenant_id, ...) — שורה של חנות אחת לא יכולה להצביע
--      על שורה של חנות אחרת, גם לא דרך service_role או פונקציית DEFINER.
--
-- איך נקבעת "החנות הנוכחית" (public.current_tenant_id):
--   א. משתמש מחובר עם שורה ב-user_roles ← החנות שלו מה-DB (מקור אמת;
--      header לא יכול לעקוף את זה).
--   ב. אחרת (אורח, נרשם חדש, שרת עם service_role) ← header בשם x-tenant-id,
--      רק אם הוא מזהה חנות קיימת. header לא חוקי = NULL = אין גישה.
--   ג. אחרת ← החנות המסומנת is_default (גשר תאימות למערכת החנות-האחת
--      הנוכחית; יכובה בחלק 2 כשהאפליקציה תשלח x-tenant-id תמיד).
--   ד. אחרת NULL ← RLS חוסם הכל והוספות נכשלות (fail closed).
--
-- ⚠️ גבולות חלק 1 (מתוכנן לחלק 2 — אין ליצור חנות שנייה לפני כן):
--   • פונקציות SECURITY DEFINER (get_catalog, picking_*, transfer_*,
--     notify_*, rename_category, resolve_login_email ועוד) רצות כבעלים
--     ועוקפות RLS — עדיין לא מסוננות לפי חנות. לוגיקת החיפוש לא שונתה.
--   • קוד השרת עם service_role עוקף RLS — צריך לשלוח x-tenant-id.
--   • Storage (תמונות/לוגו) — הנתיבים עדיין לא מחולקים לפי חנות.
--   • order_number_counters נשאר מונה גלובלי; username ואימייל נשארים
--     ייחודיים גלובלית (כניסה עם שם משתמש עדיין לא יודעת על חנויות).
--
-- הרצה: Supabase Studio → SQL Editor, או:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 20261008090000_multi_tenant_foundation.sql
-- דורש PostgreSQL 15+ (ON DELETE SET NULL (column)) — כל גרסאות Supabase הנוכחיות.
-- ============================================================

BEGIN;
-- בלי הודעות "does not exist, skipping" של DROP ... IF EXISTS
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. טבלת החנויות + חנות ברירת מחדל למידע הקיים
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- מזהה קצר לתת-דומיין / כתובת (kobi → kobi.example.com)
  slug       TEXT NOT NULL UNIQUE
             CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- גשר תאימות: בקשה בלי משתמש ובלי x-tenant-id משויכת לחנות הזו
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- לכל היותר חנות ברירת מחדל אחת
CREATE UNIQUE INDEX IF NOT EXISTS tenants_single_default_idx
  ON public.tenants ((true)) WHERE is_default;

-- מזהה קבוע (לא אקראי) — אותו ערך בכל סביבה, קל להפנות אליו בסקריפטים
INSERT INTO public.tenants (id, slug, name, is_default)
SELECT '00000000-0000-0000-0000-000000000001'::uuid,
       'kobi',
       COALESCE(
         (SELECT NULLIF(btrim(s.business_name), '') FROM public.site_settings s LIMIT 1),
         (SELECT NULLIF(btrim(s.site_title), '') FROM public.site_settings s LIMIT 1),
         'החנות הראשית'
       ),
       true
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. tenant_id בכל הטבלאות העסקיות
--    ADD COLUMN עם DEFAULT קבוע = מילוי מיידי של כל השורות הקיימות בלי
--    UPDATE: לא מפעיל טריגרים, לא נוגע ב-updated_at, לא נועל לאורך זמן.
-- ============================================================
DO $$
DECLARE
  _default_tenant CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    -- משתמשים ולקוחות
    'user_roles', 'customer_profiles', 'customer_carts', 'customer_emails',
    'customer_invites', 'service_agreements', 'user_custom_prices',
    'price_tier_backup', 'password_reset_requests', 'password_reset_tokens',
    'staff_notifications',
    -- קטלוג ותוכן האתר
    'categories', 'global_products', 'pending_products', 'product_drafts',
    'home_banner_slides', 'site_settings', 'email_settings',
    -- הזמנות, ליקוט ומלאי
    'orders', 'order_items', 'picking_events', 'product_locations',
    'location_transfers', 'location_transfer_lines',
    'stock_counts', 'stock_count_lines'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT %L',
      _t, _default_tenant);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) '
      'REFERENCES public.tenants(id) ON DELETE RESTRICT',
      _t, _t || '_tenant_id_fkey');
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id)',
      _t || '_tenant_id_idx', _t);
  END LOOP;
END $$;

-- ============================================================
-- 3. זיהוי החנות של הבקשה הנוכחית (ראו פירוט בראש הקובץ)
--    SECURITY DEFINER: קורא את user_roles בלי לעבור דרך ה-RLS של עצמו
--    (אחרת — רקורסיה אינסופית במדיניות של user_roles).
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tid uuid;
  _hdr text;
BEGIN
  -- א. משתמש מחובר שכבר משויך לחנות — תמיד החנות שלו, header לא משנה
  IF _uid IS NOT NULL THEN
    SELECT ur.tenant_id INTO _tid FROM public.user_roles ur WHERE ur.user_id = _uid;
    IF FOUND THEN
      RETURN _tid;
    END IF;
  END IF;

  -- ב. header מפורש (PostgREST חושף את כל ה-headers ב-request.headers)
  _hdr := NULLIF(btrim(NULLIF(current_setting('request.headers', true), '')::json ->> 'x-tenant-id'), '');
  IF _hdr IS NOT NULL THEN
    IF _hdr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT t.id INTO _tid FROM public.tenants t WHERE t.id = _hdr::uuid;
    END IF;
    -- header שגוי/לא קיים: NULL ולא נפילה לברירת מחדל
    RETURN _tid;
  END IF;

  -- ג. גשר תאימות: חנות ברירת המחדל (אם מוגדרת)
  SELECT t.id INTO _tid FROM public.tenants t WHERE t.is_default;
  RETURN _tid;  -- ד. NULL אם אין — הכל נחסם
END $$;

REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO anon, authenticated, service_role;

-- מעכשיו: הוספה בלי tenant_id מקבלת את החנות של הבקשה (לא את ברירת המחדל הקבועה)
DO $$
DECLARE _t text;
BEGIN
  FOR _t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
       AND c.table_name <> 'tenants'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT public.current_tenant_id()', _t);
  END LOOP;
END $$;

-- ============================================================
-- 4. ייחודיות לפי חנות (שמות האילוצים נשמרים — הקוד מזהה לפיהם שגיאות)
-- ============================================================

-- הגדרות אתר/מייל: היו שורה יחידה גלובלית (id = true) ← שורה אחת לכל חנות.
-- העמודה id נשארת (תמיד true), כך ש-.eq("id", true) בקוד ממשיך לעבוד.
ALTER TABLE public.site_settings  DROP CONSTRAINT site_settings_pkey,
                                  ADD CONSTRAINT site_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.email_settings DROP CONSTRAINT email_settings_pkey,
                                  ADD CONSTRAINT email_settings_pkey PRIMARY KEY (tenant_id);

-- קטגוריות: המפתח היה השם בלבד — שתי חנויות יכולות להחזיק "יינות".
-- קודם מסירים את המפתחות הזרים שמצביעים על השם, ומחזירים אותם בסעיף 5.
ALTER TABLE public.global_products DROP CONSTRAINT global_products_category_fkey;
ALTER TABLE public.categories      DROP CONSTRAINT categories_parent_fkey;
ALTER TABLE public.categories      DROP CONSTRAINT categories_pkey,
                                   ADD CONSTRAINT categories_pkey PRIMARY KEY (tenant_id, name);

ALTER TABLE public.global_products DROP CONSTRAINT global_products_sku_key,
                                   ADD CONSTRAINT global_products_sku_key UNIQUE (tenant_id, sku);
DROP INDEX public.global_products_barcode_key;
CREATE UNIQUE INDEX global_products_barcode_key
  ON public.global_products (tenant_id, barcode) WHERE barcode IS NOT NULL;

DROP INDEX public.pending_products_barcode_idx;
CREATE UNIQUE INDEX pending_products_barcode_idx
  ON public.pending_products (tenant_id, barcode)
  WHERE barcode IS NOT NULL AND status = 'pending';

ALTER TABLE public.orders DROP CONSTRAINT orders_order_number_key,
                          ADD CONSTRAINT orders_order_number_key UNIQUE (tenant_id, order_number);

-- ספירת מלאי פתוחה אחת — לכל חנות, לא לכל המערכת
DROP INDEX public.stock_counts_one_open_idx;
CREATE UNIQUE INDEX stock_counts_one_open_idx
  ON public.stock_counts (tenant_id) WHERE status = 'open';

DROP INDEX public.user_roles_agent_number_idx;
CREATE UNIQUE INDEX user_roles_agent_number_idx
  ON public.user_roles (tenant_id, agent_number) WHERE agent_number IS NOT NULL;

-- מפתחות (tenant_id, id) בטבלאות-האב — נדרשים למפתחות הזרים המורכבים
ALTER TABLE public.user_roles         ADD CONSTRAINT user_roles_tenant_user_key         UNIQUE (tenant_id, user_id);
ALTER TABLE public.customer_profiles  ADD CONSTRAINT customer_profiles_tenant_user_key  UNIQUE (tenant_id, user_id);
ALTER TABLE public.global_products    ADD CONSTRAINT global_products_tenant_id_key      UNIQUE (tenant_id, id);
ALTER TABLE public.orders             ADD CONSTRAINT orders_tenant_id_key               UNIQUE (tenant_id, id);
ALTER TABLE public.location_transfers ADD CONSTRAINT location_transfers_tenant_id_key   UNIQUE (tenant_id, id);
ALTER TABLE public.stock_counts       ADD CONSTRAINT stock_counts_tenant_id_key         UNIQUE (tenant_id, id);

-- ============================================================
-- 5. מפתחות זרים מורכבים: הפניה תמיד בתוך אותה חנות
--    אותם שמות ואותן פעולות ON DELETE/UPDATE כמו קודם. SET NULL (עמודה)
--    מאפס רק את עמודת המשתמש ולא את tenant_id.
-- ============================================================

-- קטגוריות
ALTER TABLE public.categories ADD CONSTRAINT categories_parent_fkey
  FOREIGN KEY (tenant_id, parent_name) REFERENCES public.categories(tenant_id, name)
  ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_category_fkey
  FOREIGN KEY (tenant_id, category) REFERENCES public.categories(tenant_id, name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- ← user_roles
ALTER TABLE public.customer_carts
  DROP CONSTRAINT customer_carts_user_id_fkey,
  ADD CONSTRAINT customer_carts_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE public.customer_emails
  DROP CONSTRAINT customer_emails_user_id_fkey,
  ADD CONSTRAINT customer_emails_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE,
  DROP CONSTRAINT customer_emails_sent_by_fkey,
  ADD CONSTRAINT customer_emails_sent_by_fkey FOREIGN KEY (tenant_id, sent_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (sent_by);
ALTER TABLE public.customer_invites
  DROP CONSTRAINT customer_invites_agent_id_fkey,
  ADD CONSTRAINT customer_invites_agent_id_fkey FOREIGN KEY (tenant_id, agent_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (agent_id),
  DROP CONSTRAINT customer_invites_created_by_fkey,
  ADD CONSTRAINT customer_invites_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (created_by),
  DROP CONSTRAINT customer_invites_used_by_fkey,
  ADD CONSTRAINT customer_invites_used_by_fkey FOREIGN KEY (tenant_id, used_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (used_by);
ALTER TABLE public.customer_profiles
  DROP CONSTRAINT customer_profiles_user_id_fkey,
  ADD CONSTRAINT customer_profiles_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE,
  DROP CONSTRAINT customer_profiles_agent_id_fkey,
  ADD CONSTRAINT customer_profiles_agent_id_fkey FOREIGN KEY (tenant_id, agent_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (agent_id);
ALTER TABLE public.location_transfers
  DROP CONSTRAINT location_transfers_created_by_fkey,
  ADD CONSTRAINT location_transfers_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE,
  DROP CONSTRAINT location_transfers_approved_by_fkey,
  ADD CONSTRAINT location_transfers_approved_by_fkey FOREIGN KEY (tenant_id, approved_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (approved_by);
ALTER TABLE public.orders
  DROP CONSTRAINT orders_customer_id_fkey,
  ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE,
  DROP CONSTRAINT orders_agent_id_fkey,
  ADD CONSTRAINT orders_agent_id_fkey FOREIGN KEY (tenant_id, agent_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (agent_id),
  DROP CONSTRAINT orders_picker_id_fkey,
  ADD CONSTRAINT orders_picker_id_fkey FOREIGN KEY (tenant_id, picker_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (picker_id),
  DROP CONSTRAINT orders_picking_approved_by_fkey,
  ADD CONSTRAINT orders_picking_approved_by_fkey FOREIGN KEY (tenant_id, picking_approved_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (picking_approved_by);
ALTER TABLE public.password_reset_tokens
  DROP CONSTRAINT password_reset_tokens_user_id_fkey,
  ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE public.pending_products
  DROP CONSTRAINT pending_products_created_by_fkey,
  ADD CONSTRAINT pending_products_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (created_by);
ALTER TABLE public.product_drafts
  DROP CONSTRAINT product_drafts_created_by_fkey,
  ADD CONSTRAINT product_drafts_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (created_by);
ALTER TABLE public.service_agreements
  DROP CONSTRAINT service_agreements_user_id_fkey,
  ADD CONSTRAINT service_agreements_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE public.staff_notifications
  DROP CONSTRAINT staff_notifications_user_id_fkey,
  ADD CONSTRAINT staff_notifications_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE public.stock_count_lines
  DROP CONSTRAINT stock_count_lines_counted_by_fkey,
  ADD CONSTRAINT stock_count_lines_counted_by_fkey FOREIGN KEY (tenant_id, counted_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (counted_by);
ALTER TABLE public.stock_counts
  DROP CONSTRAINT stock_counts_created_by_fkey,
  ADD CONSTRAINT stock_counts_created_by_fkey FOREIGN KEY (tenant_id, created_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (created_by),
  DROP CONSTRAINT stock_counts_applied_by_fkey,
  ADD CONSTRAINT stock_counts_applied_by_fkey FOREIGN KEY (tenant_id, applied_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (applied_by);

-- ← customer_profiles
ALTER TABLE public.price_tier_backup
  DROP CONSTRAINT price_tier_backup_user_id_fkey,
  ADD CONSTRAINT price_tier_backup_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.customer_profiles(tenant_id, user_id) ON DELETE CASCADE;
ALTER TABLE public.user_custom_prices
  DROP CONSTRAINT user_custom_prices_user_id_fkey,
  ADD CONSTRAINT user_custom_prices_user_id_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.customer_profiles(tenant_id, user_id) ON DELETE CASCADE;

-- ← global_products
ALTER TABLE public.location_transfer_lines
  DROP CONSTRAINT location_transfer_lines_product_id_fkey,
  ADD CONSTRAINT location_transfer_lines_product_id_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.order_items
  DROP CONSTRAINT order_items_product_id_fkey,
  ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.product_locations
  DROP CONSTRAINT product_locations_product_id_fkey,
  ADD CONSTRAINT product_locations_product_id_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.stock_count_lines
  DROP CONSTRAINT stock_count_lines_product_id_fkey,
  ADD CONSTRAINT stock_count_lines_product_id_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.user_custom_prices
  DROP CONSTRAINT user_custom_prices_product_id_fkey,
  ADD CONSTRAINT user_custom_prices_product_id_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE;

-- ← orders
ALTER TABLE public.order_items
  DROP CONSTRAINT order_items_order_id_fkey,
  ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.picking_events
  DROP CONSTRAINT picking_events_order_id_fkey,
  ADD CONSTRAINT picking_events_order_id_fkey FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders(tenant_id, id) ON DELETE CASCADE;

-- ← location_transfers / stock_counts
ALTER TABLE public.location_transfer_lines
  DROP CONSTRAINT location_transfer_lines_transfer_id_fkey,
  ADD CONSTRAINT location_transfer_lines_transfer_id_fkey FOREIGN KEY (tenant_id, transfer_id)
    REFERENCES public.location_transfers(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE public.stock_count_lines
  DROP CONSTRAINT stock_count_lines_count_id_fkey,
  ADD CONSTRAINT stock_count_lines_count_id_fkey FOREIGN KEY (tenant_id, count_id)
    REFERENCES public.stock_counts(tenant_id, id) ON DELETE CASCADE;

-- ============================================================
-- 6. RLS: מדיניות הפרדה RESTRICTIVE על כל טבלה עם tenant_id
--    RESTRICTIVE = מצטרפת ב-AND לכל מדיניות קיימת. TO public = כל תפקיד
--    שכפוף ל-RLS (anon, authenticated וכל תפקיד עתידי). service_role
--    ובעלי הטבלאות לא כפופים ל-RLS ממילא.
--    (SELECT ...) = מחושב פעם אחת לשאילתה ולא פעם לכל שורה.
--    WITH CHECK = אי אפשר להוסיף/להעביר שורה לחנות אחרת.
-- ============================================================
DO $$
DECLARE _t text;
BEGIN
  FOR _t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
       AND c.table_name <> 'tenants'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', _t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', _t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO public '
      'USING (tenant_id = (SELECT public.current_tenant_id())) '
      'WITH CHECK (tenant_id = (SELECT public.current_tenant_id()))', _t);
  END LOOP;
END $$;

-- tenants: כל אחד רואה רק את החנות של הבקשה שלו; כתיבה — רק service_role
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenants FROM anon, authenticated;
GRANT SELECT ON public.tenants TO anon, authenticated;
GRANT ALL ON public.tenants TO service_role;
DROP POLICY IF EXISTS "tenant visible to its own requests" ON public.tenants;
CREATE POLICY "tenant visible to its own requests" ON public.tenants
  FOR SELECT TO anon, authenticated
  USING (id = (SELECT public.current_tenant_id()));

-- טבלת מעקב המיגרציות של deploy/setup-selfhost.sh נוצרה בלי RLS ונחשפה
-- ל-API: אורח יכול היה למחוק שורה ולגרום להרצה חוזרת של מיגרציה שמוחקת
-- טבלאות. נועלים — רק postgres/service_role.
DO $$
BEGIN
  IF to_regclass('public._migrations_applied') IS NOT NULL THEN
    ALTER TABLE public._migrations_applied ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public._migrations_applied FROM anon, authenticated;
  END IF;
END $$;

-- ============================================================
-- 7. בדיקה עצמית — המיגרציה נכשלת (ומתבטלת) אם משהו לא במקום
-- ============================================================
DO $$
DECLARE _missing text;
BEGIN
  -- כל טבלה ב-public (חוץ מהחריגות המתועדות) חייבת tenant_id + RLS + הפרדה
  SELECT string_agg(c.relname, ', ') INTO _missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname NOT IN ('tenants', 'order_number_counters', '_migrations_applied')
     AND NOT (
       c.relrowsecurity
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                      AND a.attnotnull AND NOT a.attisdropped)
       AND EXISTS (SELECT 1 FROM pg_policies p
                    WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.policyname = 'tenant_isolation'
                      AND p.permissive = 'RESTRICTIVE')
     );
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'multi-tenant: טבלאות בלי tenant_id/RLS/tenant_isolation: %', _missing;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE is_default) IS NOT TRUE THEN
    RAISE EXCEPTION 'multi-tenant: חנות ברירת המחדל לא נוצרה';
  END IF;
END $$;

-- PostgREST טוען מחדש את הסכמה (עמודות/טבלה חדשות) בלי restart לקונטיינר
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- שדרוג לפלטפורמת B2B להזמנת משקאות: תפקידים (אדמין/סוכן/לקוח),
-- קבוצות מחיר, שיוך לקוח-סוכן, הזמנות בזרימת סטטוסים חדשה,
-- הגדרות אתר ומייל. מחליף לחלוטין את מודל ה"סניפים" הרב-דיירי.
-- ============================================================

-- ============================================================
-- 0. ניקוי מודל ה"סניפים" הישן (קיוסק, שיתוף סניפים, מלאי-לפי-סניף)
-- ============================================================
DROP TABLE IF EXISTS public.order_items CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.store_shares CASCADE;
DROP TABLE IF EXISTS public.store_inventory CASCADE;
DROP TABLE IF EXISTS public.stores CASCADE;
DROP TABLE IF EXISTS public.warehouse_rows CASCADE;

DROP FUNCTION IF EXISTS public.approve_order(uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public.check_selling_price();
DROP FUNCTION IF EXISTS public.rename_warehouse_row(uuid, text, text);
DROP FUNCTION IF EXISTS public.rename_user_category(uuid, text, text);
-- owns_store still has dependent policies on global_products at this point
-- (dropped below in section 4) — its DROP FUNCTION lives there instead.
DROP TRIGGER IF EXISTS product_category_check ON public.global_products;
DROP FUNCTION IF EXISTS public.check_product_category();
DROP TABLE IF EXISTS public.user_profiles CASCADE;

ALTER TABLE public.global_products
  DROP COLUMN IF EXISTS shelf_number,
  DROP COLUMN IF EXISTS row_number;

-- ============================================================
-- 1. תפקידים: אדמין / סוכן / לקוח, וחסימת משתמשים
-- ============================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('admin', 'agent', 'customer')),
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;

-- עטוף ב-DO: אם קובץ זה נעצר קודם *אחרי* שכבר הפיל את is_super_admin
-- (למטה) והרצה חוזרת מתחילה מהתחלה, העמודה כבר לא קיימת — בלי התנאי הזה
-- ה-UPDATE הישיר היה נכשל בהרצה חוזרת כזו.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_roles' AND column_name = 'is_super_admin'
  ) THEN
    UPDATE public.user_roles SET role = 'admin' WHERE is_super_admin = true;
  END IF;
END $$;

-- "self register pending" (המדיניות המקורית) בודקת ישירות את עמודת
-- is_super_admin בביטוי ה-WITH CHECK שלה, כלומר Postgres רושם תלות אמיתית
-- של המדיניות בעמודה — היא חייבת להיעלם *לפני* שאפשר להפיל את העמודה.
DROP POLICY IF EXISTS "own role readable" ON public.user_roles;
DROP POLICY IF EXISTS "self register pending" ON public.user_roles;
DROP POLICY IF EXISTS "super admin updates roles" ON public.user_roles;
DROP POLICY IF EXISTS "super admin deletes roles" ON public.user_roles;

ALTER TABLE public.user_roles DROP COLUMN IF EXISTS is_super_admin;

-- פונקציות עזר ל-RLS (SECURITY DEFINER כדי למנוע רקורסיה במדיניות)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- שם הפונקציה נשמר לתאימות לאחור; מיישם כעת את תפקיד "אדמין"
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_agent(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'agent');
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR public.is_agent(_user_id);
$$;

-- הטבלה עצמה (ללא RLS/מדיניות עדיין — אלה בסעיף 2) נוצרת כאן, מוקדם מהצפוי,
-- כי is_agent_of_customer למטה היא פונקציית LANGUAGE sql רגילה: Postgres
-- פותר ומאמת את גוף השאילתה שלה כבר ב-CREATE FUNCTION, ולכן customer_profiles
-- חייבת כבר להתקיים באותו רגע (בניגוד לפונקציות/טריגרים ב-plpgsql).
CREATE TABLE public.customer_profiles (
  user_id          UUID NOT NULL PRIMARY KEY REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  business_name    TEXT NOT NULL CHECK (length(btrim(business_name)) BETWEEN 2 AND 120),
  business_address TEXT NOT NULL CHECK (length(btrim(business_address)) BETWEEN 2 AND 200),
  tax_id           TEXT NOT NULL CHECK (length(btrim(tax_id)) BETWEEN 1 AND 20),
  contact_name     TEXT NOT NULL CHECK (length(btrim(contact_name)) BETWEEN 2 AND 80),
  phone            TEXT NOT NULL CHECK (length(btrim(phone)) BETWEEN 7 AND 20),
  -- NULL = "ללא קבוצה / אורח" — ברירת המחדל בהרשמה עצמית. חובה על מנהל/סוכן
  -- לבחור דרג במפורש (או להשאיר "ללא קבוצה" במפורש) בעת יצירה/אישור משתמש;
  -- כל עוד זה NULL, get_catalog() מתנהג בדיוק כמו עבור אורח לא מחובר.
  price_tier       SMALLINT DEFAULT NULL CHECK (price_tier IS NULL OR price_tier IN (1, 2, 3)),
  agent_id         UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  age_confirmed    BOOLEAN NOT NULL DEFAULT false CHECK (age_confirmed = true),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- האם _customer_id הוא לקוח המשויך לסוכן _agent_id
CREATE OR REPLACE FUNCTION public.is_agent_of_customer(_agent_id UUID, _customer_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_profiles cp
    WHERE cp.user_id = _customer_id AND cp.agent_id = _agent_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_agent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_agent_of_customer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_agent(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_agent_of_customer(uuid, uuid) TO authenticated, service_role;

-- מדיניות user_roles מחדש (הישנות כבר הוסרו למעלה, לפני הפלת is_super_admin)
CREATE POLICY "role readable by self staff or agent of customer" ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND public.is_agent_of_customer(auth.uid(), user_id))
);

CREATE POLICY "self register pending customer" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND role = 'customer' AND is_approved = false AND is_blocked = false);

CREATE POLICY "admin updates roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "admin deletes roles" ON public.user_roles
FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

-- ============================================================
-- 2. פרופיל לקוח עסקי: הרשאות/RLS (הטבלה עצמה נוצרה כבר למעלה בסעיף 1,
-- לפני is_agent_of_customer שתלויה בה ישירות בזמן CREATE FUNCTION)
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_profiles TO authenticated;
GRANT ALL ON public.customer_profiles TO service_role;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer profile select" ON public.customer_profiles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR (public.is_agent(auth.uid()) AND agent_id = auth.uid())
);

-- הרשמה עצמית: הלקוח יוצר את הפרופיל שלו בלבד, תמיד ללא קבוצת מחיר/סוכן —
-- אלה נקבעים אך ורק ע"י מנהל/סוכן (ראו customer profile admin update).
CREATE POLICY "customer profile self insert" ON public.customer_profiles
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND price_tier IS NULL AND agent_id IS NULL);

CREATE POLICY "customer profile admin update" ON public.customer_profiles
FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "customer profile admin delete" ON public.customer_profiles
FOR DELETE TO authenticated
USING (public.is_admin(auth.uid()));

CREATE TRIGGER customer_profiles_updated_at
BEFORE UPDATE ON public.customer_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. קטגוריות: חוזרות לרשימה גלובלית אחת, ניהול אדמין בלבד
-- ============================================================
-- זהו מעבר עסקי מלא מקטלוג תכשיטים לקטלוג משקאות — הקטגוריות הישנות
-- (עגילים/שרשרת/וכו') וכל מוצרי הדמו הישנים אינם רלוונטיים עוד ומנוקים.
DELETE FROM public.global_products;

ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_category_fkey;

DROP POLICY IF EXISTS "categories select own" ON public.categories;
DROP POLICY IF EXISTS "categories insert own" ON public.categories;
DROP POLICY IF EXISTS "categories update own" ON public.categories;
DROP POLICY IF EXISTS "categories delete own" ON public.categories;
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_pkey;
DELETE FROM public.categories;
ALTER TABLE public.categories DROP COLUMN IF EXISTS owner_id;
ALTER TABLE public.categories ADD PRIMARY KEY (name);

INSERT INTO public.categories (name, sort_order) VALUES
  ('משקאות מוגזים', 1),
  ('מים ומים מוגזים', 2),
  ('מיצים ומשקאות טבעיים', 3),
  ('משקאות אנרגיה וספורט', 4),
  ('בירות', 5),
  ('יינות', 6),
  ('משקאות חריפים', 7),
  ('קוקטיילים מוכנים', 8),
  ('קפה ומשקאות חמים', 9)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.global_products
  ADD CONSTRAINT global_products_category_fkey
  FOREIGN KEY (category) REFERENCES public.categories(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE POLICY "categories readable by everyone" ON public.categories
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "categories insert by admin" ON public.categories
FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "categories update by admin" ON public.categories
FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "categories delete by admin" ON public.categories
FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.rename_category(_old TEXT, _new TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE updated INTEGER;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  IF length(btrim(_new)) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'שם קטגוריה חייב להכיל 1 עד 30 תווים';
  END IF;
  UPDATE public.categories SET name = btrim(_new) WHERE name = _old;
  IF NOT FOUND THEN RAISE EXCEPTION 'הקטגוריה לא נמצאה'; END IF;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END; $$;
REVOKE ALL ON FUNCTION public.rename_category(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_category(text, text) TO authenticated, service_role;

-- ============================================================
-- 4. קטלוג המשקאות: מחירי 3 דרגים, מלאי, מבצע/אזל, תיאור
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  ADD COLUMN IF NOT EXISTS is_out_of_stock BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_promo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_tier1 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_tier1 >= 0),
  ADD COLUMN IF NOT EXISTS price_tier2 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_tier2 >= 0),
  ADD COLUMN IF NOT EXISTS price_tier3 NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_tier3 >= 0);

ALTER TABLE public.global_products ALTER COLUMN cost_price DROP NOT NULL;

DROP POLICY IF EXISTS "products readable by owner or store access" ON public.global_products;
DROP POLICY IF EXISTS "products insert by approved" ON public.global_products;
DROP POLICY IF EXISTS "products update by creator or store access" ON public.global_products;
DROP POLICY IF EXISTS "products delete by super admin" ON public.global_products;
-- last dependent policies are gone now — safe to drop the old per-store helper
DROP FUNCTION IF EXISTS public.owns_store(uuid, uuid);

CREATE POLICY "products managed by admin" ON public.global_products
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- קטלוג לצפייה (אורח/לקוח/סוכן/אדמין) — מחיר מחושב לפי קבוצת המחיר של הצופה בלבד,
-- כך ששם/מספר הדרג של הלקוח לעולם לא נחשף ללקוח עצמו.
-- לקוח ללא קבוצת מחיר משויכת (NULL), לא מאושר, או חסום — מקבל NULL בדיוק
-- כמו אורח לא מחובר, ואינו רואה מחיר ואינו יכול להזמין.
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[],
  is_promo BOOLEAN, is_out_of_stock BOOLEAN, price NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors,
    gp.is_promo, gp.is_out_of_stock,
    CASE
      WHEN auth.uid() IS NULL THEN NULL
      WHEN public.is_staff(auth.uid()) THEN gp.price_tier1
      ELSE (
        SELECT CASE cp.price_tier
                 WHEN 1 THEN gp.price_tier1
                 WHEN 2 THEN gp.price_tier2
                 WHEN 3 THEN gp.price_tier3
               END
        FROM public.customer_profiles cp
        JOIN public.user_roles ur ON ur.user_id = cp.user_id
        WHERE cp.user_id = auth.uid()
          AND ur.is_approved = true
          AND ur.is_blocked = false
      )
    END AS price
  FROM public.global_products gp
  ORDER BY gp.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog() TO anon, authenticated;

-- ============================================================
-- 5. הזמנות B2B: לקוח, סוכן משויך (מוצמד אוטומטית), 5 סטטוסים
-- ============================================================
CREATE TABLE public.orders (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id  UUID NOT NULL REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  agent_id     UUID REFERENCES public.user_roles(user_id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'agent_review', 'picking', 'shipped', 'cancelled')),
  total        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id   UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.global_products(id) ON DELETE RESTRICT,
  quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_customer_idx ON public.orders (customer_id, created_at DESC);
CREATE INDEX orders_agent_idx ON public.orders (agent_id, created_at DESC);
CREATE INDEX order_items_order_idx ON public.order_items (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_order(_customer_id UUID, _agent_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(auth.uid())
      OR _customer_id = auth.uid()
      OR (_agent_id IS NOT NULL AND _agent_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.can_view_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_order(uuid, uuid) TO authenticated, service_role;

CREATE POLICY "orders select" ON public.orders
FOR SELECT TO authenticated USING (public.can_view_order(customer_id, agent_id));

CREATE POLICY "orders insert by customer" ON public.orders
FOR INSERT TO authenticated
WITH CHECK (customer_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "orders update by staff" ON public.orders
FOR UPDATE TO authenticated
USING (public.is_admin(auth.uid()) OR agent_id = auth.uid())
WITH CHECK (public.is_admin(auth.uid()) OR agent_id = auth.uid());

CREATE POLICY "orders delete by admin" ON public.orders
FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "order items select" ON public.order_items
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.can_view_order(o.customer_id, o.agent_id)));

CREATE POLICY "order items insert" ON public.order_items
FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND (o.customer_id = auth.uid() OR public.is_admin(auth.uid()))));

CREATE POLICY "order items update by staff" ON public.order_items
FOR UPDATE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND (public.is_admin(auth.uid()) OR o.agent_id = auth.uid())))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND (public.is_admin(auth.uid()) OR o.agent_id = auth.uid())));

CREATE POLICY "order items delete by staff" ON public.order_items
FOR DELETE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id
    AND (public.is_admin(auth.uid()) OR o.agent_id = auth.uid())));

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- הצמדת הסוכן המשויך ללקוח באופן אוטומטי — הלקוח/הלקוח בצד ה-API
-- לא יכול "לבחור" סוכן לעצמו; זה תמיד נקבע לפי פרופיל הלקוח בשרת.
CREATE OR REPLACE FUNCTION public.stamp_order_agent()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) OR NEW.agent_id IS NULL THEN
    SELECT agent_id INTO NEW.agent_id FROM public.customer_profiles WHERE user_id = NEW.customer_id;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER orders_stamp_agent
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.stamp_order_agent();

-- עדכון סה"כ ההזמנה בהתאם לשורות בפועל (אחרי הוספה/עריכה/מחיקה/ביטול)
CREATE OR REPLACE FUNCTION public.recompute_order_total()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _order_id UUID := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
  UPDATE public.orders o
  SET total = COALESCE((SELECT SUM(oi.quantity * oi.unit_price) FROM public.order_items oi WHERE oi.order_id = _order_id), 0)
  WHERE o.id = _order_id;
  RETURN NULL;
END; $$;

CREATE TRIGGER order_items_recompute_total
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();

-- ============================================================
-- 6. הגדרות אתר (תוכן ציבורי) והגדרות מייל (פרטי, אדמין/שרת בלבד)
-- ============================================================
CREATE TABLE public.site_settings (
  id                BOOLEAN NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  site_title        TEXT NOT NULL DEFAULT 'סוכנות המשקאות',
  logo_path         TEXT,
  about_content     TEXT NOT NULL DEFAULT '',
  contact_content   TEXT NOT NULL DEFAULT '',
  terms_content     TEXT NOT NULL DEFAULT '',
  privacy_content   TEXT NOT NULL DEFAULT '',
  business_name     TEXT NOT NULL DEFAULT '',
  business_tax_id   TEXT NOT NULL DEFAULT '',
  business_address  TEXT NOT NULL DEFAULT '',
  business_phone    TEXT NOT NULL DEFAULT '',
  business_email    TEXT NOT NULL DEFAULT '',
  sells_alcohol     BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.email_settings (
  id                   BOOLEAN NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  -- ברירת מחדל לפי דומיין ה-VPS; ניתן לשנות בפאנל הניהול → הגדרות מייל
  -- ברגע שדומיין אחר מאומת אצל Resend.
  sender_email         TEXT NOT NULL DEFAULT 'orders@nuri1.fit',
  notify_admin_user_ids UUID[] NOT NULL DEFAULT '{}',
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;
GRANT ALL ON public.email_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.email_settings TO authenticated;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site settings readable by everyone" ON public.site_settings
FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "site settings writable by admin" ON public.site_settings
FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "site settings updatable by admin" ON public.site_settings
FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "email settings readable by admin" ON public.email_settings
FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "email settings writable by admin" ON public.email_settings
FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "email settings updatable by admin" ON public.email_settings
FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER site_settings_updated_at BEFORE UPDATE ON public.site_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER email_settings_updated_at BEFORE UPDATE ON public.email_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.site_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.email_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 7. אחסון: לוגו האתר ותמונות מוצרים חייבים להיות גלויים לאורחים —
--    מסמנים את הדליים כציבוריים (כתיבה עדיין נחסמת ע"י RLS למטה)
-- ============================================================
UPDATE storage.buckets SET public = true WHERE id IN ('branding', 'product-images');

DROP POLICY IF EXISTS "branding own read" ON storage.objects;
DROP POLICY IF EXISTS "branding own insert" ON storage.objects;
DROP POLICY IF EXISTS "branding own update" ON storage.objects;
DROP POLICY IF EXISTS "branding own delete" ON storage.objects;

CREATE POLICY "branding site logo public read" ON storage.objects
FOR SELECT TO anon, authenticated
USING (bucket_id = 'branding' AND (storage.foldername(name))[1] = 'site');

CREATE POLICY "branding site logo admin write" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'branding' AND (storage.foldername(name))[1] = 'site' AND public.is_admin(auth.uid()));

CREATE POLICY "branding site logo admin update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'branding' AND (storage.foldername(name))[1] = 'site' AND public.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'branding' AND (storage.foldername(name))[1] = 'site' AND public.is_admin(auth.uid()));

CREATE POLICY "branding site logo admin delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'branding' AND (storage.foldername(name))[1] = 'site' AND public.is_admin(auth.uid()));

-- תמונות מוצרים גלויות גם לאורחים (קטלוג ציבורי), ניהול אדמין בלבד
DROP POLICY IF EXISTS "product images readable by approved" ON storage.objects;
DROP POLICY IF EXISTS "product images insert by approved" ON storage.objects;
DROP POLICY IF EXISTS "product images update by approved" ON storage.objects;
DROP POLICY IF EXISTS "product images delete by super admin" ON storage.objects;

CREATE POLICY "product images public read" ON storage.objects
FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');

CREATE POLICY "product images admin write" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images' AND public.is_admin(auth.uid()));

CREATE POLICY "product images admin update" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'product-images' AND public.is_admin(auth.uid()))
WITH CHECK (bucket_id = 'product-images' AND public.is_admin(auth.uid()));

CREATE POLICY "product images admin delete" ON storage.objects
FOR DELETE TO authenticated USING (bucket_id = 'product-images' AND public.is_admin(auth.uid()));

-- ============================================================
-- 8. משתמש-על → אדמין ראשון של המערכת
-- ============================================================
UPDATE public.user_roles
SET role = 'admin', is_approved = true, is_blocked = false
WHERE email = 'nuriel.sh1@gmail.com';

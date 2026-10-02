-- ============================================================
-- שדרוג "מקצועי": אימייל ייחודי, מחיקת משתמשים, איפוס סיסמה בקישור חד-פעמי,
-- בקשות הצעת מחיר, ברקוד בהזמנה, מע"מ דינמי ופרטי מסמך.
-- כל הסעיפים אידמפוטנטיים (IF EXISTS / IF NOT EXISTS / DO $$) כדי שהרצה
-- חוזרת אחרי כשל חלקי תמשיך בלי ליפול — ראו לקחי הסשן הקודם.
-- ============================================================

-- ============================================================
-- 1. אימייל ייחודי (באג כפילויות)
-- ============================================================
-- נרמול: כל אימייל נשמר תמיד ב-lowercase ובלי רווחים מיותרים, כך
-- ש-"A@b.com" ו-"a@b.com " לא ייחשבו לשתי כתובות שונות.
CREATE OR REPLACE FUNCTION public.normalize_user_email()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_roles_normalize_email ON public.user_roles;
CREATE TRIGGER user_roles_normalize_email
BEFORE INSERT OR UPDATE OF email ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.normalize_user_email();

UPDATE public.user_roles SET email = lower(btrim(email)) WHERE email <> lower(btrim(email));

-- ניקוי כפילויות קיימות לפני יצירת האינדקס הייחודי: משאירים את השורה
-- הוותיקה ביותר לכל אימייל, ומוחקים כפילויות *רק* אם אין להן היסטוריה
-- (הזמנות או פרופיל עסקי) — כדי לא לאבד מידע אמיתי בטעות.
DO $$
DECLARE removed INTEGER;
BEGIN
  WITH ranked AS (
    SELECT user_id, email,
           row_number() OVER (PARTITION BY lower(btrim(email)) ORDER BY created_at, user_id) AS rn
    FROM public.user_roles
  )
  DELETE FROM public.user_roles ur
  USING ranked r
  WHERE ur.user_id = r.user_id
    AND r.rn > 1
    AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = ur.user_id OR o.agent_id = ur.user_id)
    AND NOT EXISTS (SELECT 1 FROM public.customer_profiles cp WHERE cp.user_id = ur.user_id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'הוסרו % שורות user_roles כפולות (ללא היסטוריה)', removed;
  END IF;
END $$;

-- יצירת האינדקס הייחודי. אם *עדיין* נותרו כפילויות עם היסטוריה אמיתית,
-- לא מפילים את כל המיגרציה — רושמים אזהרה ברורה כדי שהמנהל יטפל ידנית.
DO $$
BEGIN
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS user_roles_email_unique_idx
      ON public.user_roles (lower(btrim(email)));
  EXCEPTION WHEN unique_violation THEN
    RAISE WARNING 'לא ניתן ליצור אינדקס ייחודי על אימייל — קיימות כפילויות עם היסטוריה. יש לאחד/למחוק ידנית ואז להריץ: CREATE UNIQUE INDEX user_roles_email_unique_idx ON public.user_roles (lower(btrim(email)));';
  END;
END $$;

-- ============================================================
-- 2. מספר סוכן (מופיע במסמכי ההזמנה של לקוחות המשויכים לסוכן)
-- ============================================================
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS agent_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_agent_number_idx
  ON public.user_roles (agent_number) WHERE agent_number IS NOT NULL;

-- הקצאה אוטומטית של מספר סוכן רץ (S-001, S-002...) לכל מי שהופך לסוכן
CREATE OR REPLACE FUNCTION public.assign_agent_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_num INTEGER;
BEGIN
  IF NEW.role = 'agent' AND (NEW.agent_number IS NULL OR btrim(NEW.agent_number) = '') THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(agent_number, '\D', '', 'g'), '')::INTEGER), 0) + 1
      INTO next_num
      FROM public.user_roles
     WHERE agent_number IS NOT NULL;
    NEW.agent_number := 'S-' || lpad(next_num::TEXT, 3, '0');
  END IF;
  IF NEW.agent_number IS NOT NULL AND btrim(NEW.agent_number) = '' THEN
    NEW.agent_number := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS user_roles_assign_agent_number ON public.user_roles;
CREATE TRIGGER user_roles_assign_agent_number
BEFORE INSERT OR UPDATE OF role, agent_number ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.assign_agent_number();

-- מילוי לסוכנים קיימים
DO $$
DECLARE r RECORD; next_num INTEGER;
BEGIN
  FOR r IN SELECT user_id FROM public.user_roles WHERE role = 'agent' AND agent_number IS NULL LOOP
    SELECT COALESCE(MAX(NULLIF(regexp_replace(agent_number, '\D', '', 'g'), '')::INTEGER), 0) + 1
      INTO next_num FROM public.user_roles WHERE agent_number IS NOT NULL;
    UPDATE public.user_roles SET agent_number = 'S-' || lpad(next_num::TEXT, 3, '0') WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- מספר הסוכן צריך להישמר גם כשמשתמש רגיל מעדכן את עצמו (הטריגר
-- protect_privileged_columns מגן על role/is_approved/is_blocked/email בלבד).
CREATE OR REPLACE FUNCTION public.protect_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    NEW.role := OLD.role;
    NEW.is_approved := OLD.is_approved;
    NEW.is_blocked := OLD.is_blocked;
    NEW.email := OLD.email;
    NEW.agent_number := OLD.agent_number;
  END IF;
  RETURN NEW;
END; $$;

-- ============================================================
-- 3. איפוס סיסמה: טוקן חד-פעמי בתוקף 3 שעות
-- ============================================================
-- הטבלה נגישה לשרת בלבד (service_role). אין מדיניות RLS לאף תפקיד אחר,
-- ולכן גם לקוח מחובר אינו יכול לקרוא/לנחש טוקנים של אחרים.
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES public.user_roles(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON public.password_reset_tokens (user_id, created_at DESC);

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_tokens FROM anon, authenticated;
GRANT ALL ON public.password_reset_tokens TO service_role;

-- ============================================================
-- 4. הגדרות מע"מ, טלפון שירות לקוחות ומספר מסמך
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS prices_include_vat BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  ADD COLUMN IF NOT EXISTS support_phone TEXT NOT NULL DEFAULT '';

-- ============================================================
-- 5. בקשות הצעת מחיר (לקוח ללא קבוצת מחיר) + צילום נתוני מע"מ בהזמנה
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'order',
  ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS prices_include_vat BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_kind_check CHECK (kind IN ('order', 'quote'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS orders_kind_idx ON public.orders (kind, created_at DESC);

-- האם המשתמש רשאי לראות מחירים בכלל (מאושר + לא חסום + קבוצת מחיר משויכת).
-- אותה הגדרה בדיוק שבה משתמשת get_catalog() — כדי שלא ייווצר מצב שבו
-- לקוח לא רואה מחיר בקטלוג אבל כן מקבל "הזמנה" עם מחירים.
CREATE OR REPLACE FUNCTION public.customer_has_prices(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.customer_profiles cp
    JOIN public.user_roles ur ON ur.user_id = cp.user_id
    WHERE cp.user_id = _user_id
      AND cp.price_tier IS NOT NULL
      AND ur.is_approved = true
      AND ur.is_blocked = false
  );
$$;
REVOKE ALL ON FUNCTION public.customer_has_prices(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_has_prices(uuid) TO authenticated, service_role;

-- לקוח ללא קבוצת מחיר מייצר תמיד "בקשה להצעת מחיר", גם אם צד הלקוח
-- ינסה לשלוח kind='order'. אנשי צוות (מנהל/סוכן) קובעים בעצמם.
CREATE OR REPLACE FUNCTION public.enforce_order_kind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) AND NOT public.customer_has_prices(NEW.customer_id) THEN
    NEW.kind := 'quote';
    NEW.total := 0;
  END IF;
  IF NEW.kind NOT IN ('order', 'quote') THEN
    NEW.kind := 'order';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_enforce_kind ON public.orders;
CREATE TRIGGER orders_enforce_kind
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_order_kind();

-- ============================================================
-- 6. צילום פרטי המוצר לתוך שורת ההזמנה (שם, מקט, ברקוד, תמונה)
-- ============================================================
-- למה לשמור עותק ולא רק product_id: (א) הלקוח אינו רשאי לקרוא את
-- global_products (RLS: אדמין/צוות בלבד), ולכן ההזמנות שלו הוצגו בלי
-- שמות מוצרים; (ב) מסמך PDF חייב לשקף את מה שהוזמן בפועל גם אם המוצר
-- שונה/נמחק בהמשך.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS product_sku TEXT,
  ADD COLUMN IF NOT EXISTS product_barcode TEXT,
  ADD COLUMN IF NOT EXISTS product_category TEXT,
  ADD COLUMN IF NOT EXISTS product_image_url TEXT;

CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p RECORD; parent RECORD;
BEGIN
  SELECT name, sku, barcode, category, image_url INTO p
  FROM public.global_products WHERE id = NEW.product_id;
  IF FOUND THEN
    NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name);
    NEW.product_sku := COALESCE(NEW.product_sku, p.sku);
    NEW.product_barcode := COALESCE(NEW.product_barcode, p.barcode);
    NEW.product_category := COALESCE(NEW.product_category, p.category);
    NEW.product_image_url := COALESCE(NEW.product_image_url, p.image_url);
  END IF;

  -- בבקשת הצעת מחיר אין מחירים כלל אצל הלקוח; רק צוות רשאי לתמחר אותה.
  SELECT kind INTO parent FROM public.orders WHERE id = NEW.order_id;
  IF FOUND AND parent.kind = 'quote' AND NOT public.is_staff(auth.uid()) THEN
    NEW.unit_price := 0;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS order_items_snapshot_product ON public.order_items;
CREATE TRIGGER order_items_snapshot_product
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_order_item_product();

-- מילוי שורות קיימות
UPDATE public.order_items oi
SET product_name = gp.name,
    product_sku = gp.sku,
    product_barcode = gp.barcode,
    product_category = gp.category,
    product_image_url = gp.image_url
FROM public.global_products gp
WHERE gp.id = oi.product_id AND oi.product_name IS NULL;

-- ============================================================
-- 7. ברקוד: שדה אופציונלי לחלוטין, ריק נשמר כ-NULL (ולא כמחרוזת ריקה,
--    שהייתה מתנגשת באינדקס הייחודי בין כמה מוצרים בלי ברקוד)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_product_barcode()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.barcode := NULLIF(btrim(COALESCE(NEW.barcode, '')), '');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS global_products_normalize_barcode ON public.global_products;
CREATE TRIGGER global_products_normalize_barcode
BEFORE INSERT OR UPDATE OF barcode ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.normalize_product_barcode();

UPDATE public.global_products SET barcode = NULL WHERE barcode IS NOT NULL AND btrim(barcode) = '';

-- ============================================================
-- 8. הרשאות מחיקה: מחיקת משתמש מוחקת גם את התוכן התלוי בו
-- ============================================================
-- ההזמנות של לקוח שנמחק נמחקות איתו (customer_id ... ON DELETE CASCADE
-- כבר קיים). כאן מוודאים שגם השיוך ההפוך לא חוסם: סוכן שנמחק משאיר את
-- ההזמנות והלקוחות שלו בלי סוכן, במקום למנוע את המחיקה.
DO $$ BEGIN
  ALTER TABLE public.customer_profiles DROP CONSTRAINT IF EXISTS customer_profiles_agent_id_fkey;
  ALTER TABLE public.customer_profiles
    ADD CONSTRAINT customer_profiles_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.user_roles(user_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_agent_id_fkey;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.user_roles(user_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 9. get_catalog(): מוסיפים ברקוד (מוצג בפירוט ההזמנה/המסמך)
-- ============================================================
DROP FUNCTION IF EXISTS public.get_catalog();
CREATE OR REPLACE FUNCTION public.get_catalog()
RETURNS TABLE (
  id UUID, sku VARCHAR, name TEXT, category TEXT, description TEXT,
  image_url TEXT, images TEXT[], colors TEXT[], barcode TEXT,
  is_promo BOOLEAN, is_out_of_stock BOOLEAN, price NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    gp.id, gp.sku, gp.name, gp.category, gp.description,
    gp.image_url, gp.images, gp.colors, gp.barcode,
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

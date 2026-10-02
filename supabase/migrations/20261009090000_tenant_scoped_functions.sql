-- ============================================================
-- SaaS מרובה חנויות — חלק 2: אטימת הפונקציות שעוקפות RLS
-- ============================================================
-- פונקציות SECURITY DEFINER רצות כבעלי הטבלאות ולכן עוקפות את מדיניות
-- tenant_isolation. כאן כל אחת מהן מסוננת לפי החנות:
--   • פונקציות שנקראות מהאפליקציה (RPC) ← public.current_tenant_id()
--     (משתמש מחובר: החנות שלו; אורח/שרת: header בשם x-tenant-id).
--   • טריגרים ← NEW.tenant_id / OLD.tenant_id של השורה עצמה, כך ששורות-בן
--     (התראות, איתורים, פיקדונות, יומן ליקוט) נוצרות תמיד באותה חנות.
--   • פונקציות תפקיד (is_admin, is_agent, can_pick...) מחזירות true רק
--     כשהמשתמש שייך לחנות של הבקשה.
--
-- בנוסף:
--   • price_tiers_enabled() — שורת ההגדרות של החנות הנוכחית בלבד.
--   • מספור הזמנות ושמות משתמש — לכל חנות בנפרד.
--   • tenant_for_host() — זיהוי החנות לפי הדומיין (לשרת ולדפדפן).
--   • משתמש מחובר שנכנס לאתר של חנות אחרת (header לא תואם) ← אין גישה.
--   • Storage — כתיבה רק לתיקייה <tenant_id>/... של החנות.
--   • חנות חדשה מקבלת אוטומטית שורות site_settings / email_settings.
--
-- לוגיקת החיפוש (stock_lookup, get_catalog) לא שונתה — רק נוסף סינון חנות.
-- דורש את מיגרציה 20261008090000_multi_tenant_foundation.
-- ============================================================

BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. זיהוי חנות לפי דומיין + הקמת חנות חדשה
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS domain TEXT UNIQUE
  CHECK (domain IS NULL OR domain = lower(btrim(domain)));

COMMENT ON COLUMN public.tenants.domain IS
  'דומיין מלא של החנות (למשל shop.example.com). בלי דומיין — זיהוי לפי תת-דומיין = slug';

-- דומיין מלא ← תת-דומיין (slug.example.com) ← חנות ברירת המחדל
CREATE OR REPLACE FUNCTION public.tenant_for_host(_host text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH h AS (SELECT lower(split_part(btrim(COALESCE(_host, '')), ':', 1)) AS host)
  SELECT COALESCE(
    (SELECT t.id FROM public.tenants t, h WHERE t.domain = h.host),
    (SELECT t.id FROM public.tenants t, h
      WHERE h.host LIKE '%.%.%' AND t.slug = split_part(h.host, '.', 1)),
    (SELECT t.id FROM public.tenants t WHERE t.is_default)
  );
$$;
REVOKE ALL ON FUNCTION public.tenant_for_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_for_host(text) TO anon, authenticated, service_role;

-- חנות חדשה ← שורות הגדרות משלה (האפליקציה מניחה שהן קיימות)
CREATE OR REPLACE FUNCTION public.tenants_seed_settings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.site_settings (tenant_id, site_title, business_name)
  VALUES (NEW.id, NEW.name, NEW.name)
  ON CONFLICT (tenant_id) DO NOTHING;
  INSERT INTO public.email_settings (tenant_id)
  VALUES (NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tenants_seed_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenants_seed_settings ON public.tenants;
CREATE TRIGGER tenants_seed_settings
AFTER INSERT ON public.tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_seed_settings();

-- ============================================================
-- 2. החנות של הבקשה — משתמש מחובר באתר של חנות אחרת לא מקבל גישה
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tid uuid;
  _hdr text := lower(NULLIF(btrim(
    NULLIF(current_setting('request.headers', true), '')::json ->> 'x-tenant-id'), ''));
BEGIN
  -- א. משתמש מחובר שמשויך לחנות: החנות שלו. אם הבקשה הגיעה מהאתר של
  --    חנות אחרת (header שונה) — NULL, כלומר אין גישה לשום דבר.
  IF _uid IS NOT NULL THEN
    SELECT ur.tenant_id INTO _tid FROM public.user_roles ur WHERE ur.user_id = _uid;
    IF FOUND THEN
      IF _hdr IS NOT NULL AND _hdr IS DISTINCT FROM _tid::text THEN
        RETURN NULL;
      END IF;
      RETURN _tid;
    END IF;
  END IF;

  -- ב. header מפורש (אורח, נרשם חדש, שרת עם service_role)
  IF _hdr IS NOT NULL THEN
    IF _hdr ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT t.id INTO _tid FROM public.tenants t WHERE t.id = _hdr::uuid;
    END IF;
    RETURN _tid;
  END IF;

  -- ג. גשר תאימות: חנות ברירת המחדל (אם מוגדרת)
  SELECT t.id INTO _tid FROM public.tenants t WHERE t.is_default;
  RETURN _tid;
END $$;

-- ============================================================
-- 3. מספור הזמנות ושמות משתמש — לכל חנות בנפרד
-- ============================================================
ALTER TABLE public.order_number_counters
  ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001'
  REFERENCES public.tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.order_number_counters ALTER COLUMN tenant_id DROP DEFAULT;
ALTER TABLE public.order_number_counters
  DROP CONSTRAINT order_number_counters_pkey,
  ADD CONSTRAINT order_number_counters_pkey PRIMARY KEY (tenant_id, year);

DROP FUNCTION IF EXISTS public.next_order_number();
CREATE OR REPLACE FUNCTION public.next_order_number(_tenant uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_year SMALLINT := EXTRACT(YEAR FROM now())::SMALLINT;
  next_value BIGINT;
BEGIN
  INSERT INTO public.order_number_counters (tenant_id, year, last_value)
  VALUES (_tenant, current_year, 1)
  ON CONFLICT (tenant_id, year) DO UPDATE
    SET last_value = public.order_number_counters.last_value + 1
  RETURNING last_value INTO next_value;

  RETURN 'SH' || to_char(now(), 'YY') || lpad(next_value::TEXT, 7, '0');
END $$;
REVOKE ALL ON FUNCTION public.next_order_number(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.order_number := public.next_order_number(NEW.tenant_id);
  RETURN NEW;
END $$;

-- שם משתמש ייחודי בתוך החנות (כניסה עם שם משתמש מסוננת לפי חנות, סעיף 6)
ALTER TABLE public.user_roles
  DROP CONSTRAINT user_roles_username_key,
  ADD CONSTRAINT user_roles_username_key UNIQUE (tenant_id, username);

CREATE OR REPLACE FUNCTION public.assign_default_username()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE base TEXT; candidate TEXT; suffix INT := 0;
BEGIN
  IF NEW.username IS NOT NULL AND btrim(NEW.username) <> '' THEN
    NEW.username := lower(btrim(NEW.username));
    RETURN NEW;
  END IF;
  base := public.default_username_from_email(NEW.email);
  IF length(base) < 3 THEN base := rpad(base, 3, 'x'); END IF;
  candidate := base;
  WHILE EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE tenant_id = NEW.tenant_id AND username = candidate
       AND user_id IS DISTINCT FROM NEW.user_id
  ) LOOP
    suffix := suffix + 1;
    candidate := base || suffix::text;
  END LOOP;
  NEW.username := candidate;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.assign_agent_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_num INTEGER;
BEGIN
  IF NEW.role = 'agent' AND (NEW.agent_number IS NULL OR btrim(NEW.agent_number) = '') THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(agent_number, '\D', '', 'g'), '')::INTEGER), 0) + 1
      INTO next_num
      FROM public.user_roles
     WHERE tenant_id = NEW.tenant_id AND agent_number IS NOT NULL;
    NEW.agent_number := 'S-' || lpad(next_num::TEXT, 3, '0');
  END IF;
  IF NEW.agent_number IS NOT NULL AND btrim(NEW.agent_number) = '' THEN
    NEW.agent_number := NULL;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 4. פונקציות תפקיד: true רק בתוך החנות של הבקשה
--    (כל פונקציה ומדיניות שבודקת is_admin/is_staff/can_pick יורשת את זה)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'admin' AND NOT is_blocked
                    AND tenant_id = public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public.is_agent(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'agent' AND NOT is_blocked
                    AND tenant_id = public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public.is_warehouse(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'warehouse' AND NOT is_blocked
                    AND tenant_id = public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND is_approved = true
                    AND tenant_id = public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public.is_agent_of_customer(_agent_id uuid, _customer_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.customer_profiles cp
    WHERE cp.user_id = _customer_id AND cp.agent_id = _agent_id
      AND cp.tenant_id = public.current_tenant_id()
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_display_name(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(display_name), ''), NULLIF(btrim(username), ''), email)
    FROM public.user_roles
   WHERE user_id = _user_id AND tenant_id = public.current_tenant_id();
$$;

CREATE OR REPLACE FUNCTION public.staff_display_names(_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, agent_number text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id, NULLIF(btrim(ur.display_name), ''), ur.agent_number
    FROM public.user_roles ur
   WHERE ur.user_id = ANY(_ids)
     AND ur.role IN ('agent', 'admin')
     AND ur.tenant_id = public.current_tenant_id();
$$;

-- ============================================================
-- 5. הגדרות (singleton) — שורת ההגדרות של החנות בלבד
-- ============================================================
CREATE OR REPLACE FUNCTION public.price_tiers_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT s.price_tiers_enabled FROM public.site_settings s
                    WHERE s.tenant_id = public.current_tenant_id()), false);
$$;

-- טריגר: לפי החנות של הפרופיל עצמו, לא של הבקשה
CREATE OR REPLACE FUNCTION public.force_single_price_tier()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT s.price_tiers_enabled FROM public.site_settings s
                    WHERE s.tenant_id = NEW.tenant_id), false) THEN
    NEW.price_tier := 1;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- 6. קטלוג, קטגוריות וכניסה
-- ============================================================
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
  -- סדר שהמנהל קבע בגרירה; מוצר שעוד לא סודר — כמו קודם, מהחדש לישן
  ORDER BY gp.sort_order ASC NULLS LAST, gp.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.category_product_counts()
RETURNS TABLE(category text, products bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gp.category, count(*)
    FROM public.global_products gp
   WHERE gp.tenant_id = public.current_tenant_id()
   GROUP BY gp.category;
$$;

CREATE OR REPLACE FUNCTION public.rename_category(_old text, _new text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  products_count INTEGER;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF length(btrim(_new)) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'שם קטגוריה חייב להכיל 1 עד 30 תווים';
  END IF;
  SELECT count(*) INTO products_count FROM public.global_products
   WHERE tenant_id = _tenant AND category = _old;
  UPDATE public.categories SET name = btrim(_new) WHERE tenant_id = _tenant AND name = _old;
  IF NOT FOUND THEN RAISE EXCEPTION 'הקטגוריה לא נמצאה'; END IF;
  RETURN products_count;
END $$;

CREATE OR REPLACE FUNCTION public.set_category_order(_names text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה';
  END IF;
  UPDATE public.categories c
     SET sort_order = o.ord
    FROM unnest(_names) WITH ORDINALITY AS o(name, ord)
   WHERE c.name = o.name AND c.tenant_id = public.current_tenant_id();
END $$;

CREATE OR REPLACE FUNCTION public.reorder_products(_category text, _product_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed TEXT[];
  foreign_count INTEGER;
  updated INTEGER;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לשנות את סדר המוצרים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _category IS NULL OR btrim(_category) = '' THEN
    RAISE EXCEPTION 'חסרה קטגוריה';
  END IF;
  IF _product_ids IS NULL OR array_length(_product_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF array_length(_product_ids, 1) > 5000 THEN
    RAISE EXCEPTION 'יותר מדי מוצרים בבקשה אחת';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(_product_ids) AS x) <> array_length(_product_ids, 1) THEN
    RAISE EXCEPTION 'רשימת המוצרים לא תקינה (מוצר כפול)';
  END IF;

  WITH RECURSIVE subtree(name) AS (
    SELECT _category
    UNION
    SELECT c.name FROM public.categories c JOIN subtree s ON c.parent_name = s.name
     WHERE c.tenant_id = _tenant
  )
  SELECT array_agg(name) INTO allowed FROM subtree;

  -- מוצר של חנות אחרת נחשב "לא נמצא" — כמו מוצר שלא קיים
  SELECT count(*) INTO foreign_count
    FROM unnest(_product_ids) AS x(id)
    LEFT JOIN public.global_products gp ON gp.id = x.id AND gp.tenant_id = _tenant
   WHERE gp.id IS NULL OR NOT (gp.category = ANY (allowed));
  IF foreign_count > 0 THEN
    RAISE EXCEPTION 'שגיאה: לא ניתן להעביר מוצר לקטגוריה אחרת בגרירה. כדי לשנות קטגוריית מוצר, יש להיכנס לעריכת המוצר ולשנות זאת משם.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.global_products gp
     SET sort_order = o.pos * 10
    FROM unnest(_product_ids) WITH ORDINALITY AS o(id, pos)
   WHERE gp.id = o.id AND gp.tenant_id = _tenant
     AND gp.sort_order IS DISTINCT FROM o.pos * 10;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated;
END $$;

-- שם משתמש ← אימייל, רק בתוך החנות של האתר שממנו נכנסים
CREATE OR REPLACE FUNCTION public.resolve_login_email(_identifier text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _identifier ILIKE '%@%' THEN _identifier
    ELSE (SELECT email FROM public.user_roles
           WHERE username = lower(btrim(_identifier))
             AND tenant_id = public.current_tenant_id())
  END;
$$;

-- ============================================================
-- 7. התראות לצוות — רק לצוות של אותה חנות
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_admins_system(_title text, _body text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sent INTEGER;
  _tenant uuid := public.current_tenant_id();
BEGIN
  INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
  SELECT ur.tenant_id, ur.user_id, 'system', _title, COALESCE(_body, ''), NULL
    FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND NOT ur.is_blocked;
  GET DIAGNOSTICS sent = ROW_COUNT;
  RETURN sent;
END $$;

CREATE OR REPLACE FUNCTION public.notify_customer_assigned()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_role TEXT;
  customer_email TEXT;
BEGIN
  -- ב-INSERT אין רשומת OLD כלל, ולכן משווים ל-OLD רק בעדכון
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.agent_id IS NOT DISTINCT FROM OLD.agent_id THEN
    RETURN NEW;
  END IF;

  SELECT role INTO recipient_role FROM public.user_roles
   WHERE user_id = NEW.agent_id AND tenant_id = NEW.tenant_id;
  SELECT email INTO customer_email FROM public.user_roles
   WHERE user_id = NEW.user_id AND tenant_id = NEW.tenant_id;

  INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
  VALUES (
    NEW.tenant_id,
    NEW.agent_id,
    'new_customer',
    'לקוח חדש שויך אליך',
    COALESCE(NULLIF(NEW.business_name, ''), customer_email, ''),
    CASE WHEN recipient_role = 'admin' THEN '/admin?tab=users' ELSE '/agent' END
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_role TEXT;
  business TEXT;
BEGIN
  IF NEW.agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO recipient_role FROM public.user_roles
   WHERE user_id = NEW.agent_id AND tenant_id = NEW.tenant_id;
  SELECT business_name INTO business FROM public.customer_profiles
   WHERE user_id = NEW.customer_id AND tenant_id = NEW.tenant_id;

  INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
  VALUES (
    NEW.tenant_id,
    NEW.agent_id,
    'new_order',
    CASE WHEN NEW.kind = 'quote' THEN 'בקשת הצעת מחיר חדשה' ELSE 'הזמנה חדשה התקבלה' END,
    COALESCE(business, '') || ' · ' || NEW.order_number,
    CASE WHEN recipient_role = 'admin' THEN '/admin?tab=orders' ELSE '/agent?tab=orders' END
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_out_of_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.is_out_of_stock AND NEW.out_of_stock_auto
     AND NOT (OLD.is_out_of_stock AND OLD.out_of_stock_auto) THEN
    INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
    SELECT ur.tenant_id,
           ur.user_id,
           'out_of_stock',
           'מוצר אזל מהמלאי',
           NEW.name || CASE WHEN NEW.stock_quantity > 0
                            THEN ' · נשארו ' || NEW.stock_quantity || ' יחידות, פחות ממארז — סומן "אזל"'
                            ELSE ' · סומן "אזל" אוטומטית ואינו זמין להזמנה' END,
           '/admin?tab=products'
      FROM public.user_roles ur
     WHERE ur.tenant_id = NEW.tenant_id
       AND ur.role = 'admin'
       AND NOT ur.is_blocked
       AND ur.user_id IS DISTINCT FROM auth.uid();
  END IF;
  RETURN NULL;
END $$;

-- ============================================================
-- 8. הזמנות ומלאי — שורות-בן נוצרות באותה חנות של שורת-האב
-- ============================================================

-- פיקדון אוטומטי: באותה חנות של שורת ההזמנה
CREATE OR REPLACE FUNCTION public.ensure_order_item_deposit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  deposit_id UUID;
BEGIN
  IF NEW.is_deposit OR public.is_staff(auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT has_deposit, deposit_price, deposit_units INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND OR NOT COALESCE(p.has_deposit, false)
     OR p.deposit_price IS NULL OR p.deposit_units IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO deposit_id
    FROM public.order_items
   WHERE order_id = NEW.order_id AND product_id = NEW.product_id AND is_deposit
   ORDER BY id
   LIMIT 1;

  IF deposit_id IS NULL THEN
    INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price, is_deposit)
    VALUES (NEW.tenant_id, NEW.order_id, NEW.product_id, NEW.quantity, 0, true);
  ELSE
    UPDATE public.order_items SET quantity = NEW.quantity
     WHERE id = deposit_id AND quantity <> NEW.quantity;
  END IF;

  RETURN NULL;
END $$;

-- צילום פרטי המוצר: רק מוצר של אותה חנות (לא חושף שם/מחיר של חנות אחרת
-- גם בהודעות השגיאה). מוצר זר נדחה ממילא ע"י המפתח הזר המורכב.
CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
  parent RECORD;
  parent_found BOOLEAN := false;
  buyer_tier SMALLINT;
  buyer_custom NUMERIC;
  authoritative NUMERIC;
  staff BOOLEAN := public.is_staff(auth.uid());
BEGIN
  SELECT name, sku, barcode, category, image_url, shelf_location,
         price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at,
         has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity
    INTO p
    FROM public.global_products WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  product_found := FOUND;

  IF product_found AND staff THEN
    -- צוות: ערכים שנשלחו נשמרים (למשל שם מותאם בהזמנה ידנית), ומה שחסר נלקח מהמוצר
    IF NEW.is_deposit THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), 'פיקדון – ' || p.name);
    ELSE
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name);
    END IF;
    NEW.product_sku := COALESCE(NEW.product_sku, p.sku);
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
    NEW.product_name := CASE WHEN NEW.is_deposit THEN 'פיקדון – ' || p.name ELSE p.name END;
    NEW.product_sku := p.sku;
    NEW.product_barcode := p.barcode;
    NEW.product_category := p.category;
    NEW.product_image_url := p.image_url;
    NEW.product_shelf_location := p.shelf_location;
    NEW.product_pack_size := CASE WHEN NEW.is_deposit THEN NULL ELSE p.pack_size END;
  END IF;

  SELECT kind, customer_id INTO parent FROM public.orders
   WHERE id = NEW.order_id AND tenant_id = NEW.tenant_id;
  parent_found := FOUND;

  -- מוצר שנמכר במארזים: לקוח חייב להזמין כפולה שלמה של המארז (צוות יכול
  -- לחרוג במקרים מיוחדים — הממשק מזהיר אותו). נאכף כאן, לא רק בדפדפן.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.pack_size IS NOT NULL
     AND NOT staff
     AND (NEW.quantity < p.pack_size OR NEW.quantity % p.pack_size <> 0) THEN
    RAISE EXCEPTION 'המוצר "%" נמכר במארזים של % יחידות — הכמות חייבת להיות %, % וכן הלאה',
      p.name, p.pack_size, p.pack_size, p.pack_size * 2;
  END IF;

  -- מינימום יחידות להזמנה (נפרד מהמארזים, ובמקביל אליהם): לקוח לא יכול להזמין
  -- פחות מהמינימום; כל כמות מעליו מותרת. צוות יכול לחרוג, כמו במארזים.
  IF parent_found AND product_found AND NOT NEW.is_deposit AND p.min_order_quantity IS NOT NULL
     AND NOT staff
     AND NEW.quantity < p.min_order_quantity THEN
    RAISE EXCEPTION 'מינימום להזמנה ממוצר "%" הינו % יחידות', p.name, p.min_order_quantity;
  END IF;

  IF parent_found AND NOT staff THEN
    IF parent.kind = 'quote' THEN
      NEW.unit_price := 0;
    ELSIF NEW.is_deposit THEN
      IF product_found AND p.deposit_price IS NOT NULL AND p.deposit_units IS NOT NULL THEN
        NEW.unit_price := p.deposit_price * p.deposit_units;
      ELSE
        NEW.unit_price := 0;
      END IF;
    ELSIF product_found THEN
      SELECT cp.price_tier INTO buyer_tier
        FROM public.customer_profiles cp
       WHERE cp.user_id = parent.customer_id;

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

-- איתור "ראשי" חדש נוצר בחנות של המוצר (לא של הבקשה)
CREATE OR REPLACE FUNCTION public.locations_apply_delta(_product_id uuid, _delta integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  need INTEGER;
  take INTEGER;
  loc RECORD;
  _tenant uuid;
BEGIN
  IF _delta = 0 THEN
    RETURN;
  END IF;
  IF _delta > 0 THEN
    SELECT tenant_id INTO _tenant FROM public.global_products WHERE id = _product_id;
    IF _tenant IS NULL THEN
      RETURN;
    END IF;
    INSERT INTO public.product_locations (tenant_id, product_id, location, quantity)
    VALUES (_tenant, _product_id, 'ראשי', _delta)
    ON CONFLICT (product_id, location)
    DO UPDATE SET quantity = public.product_locations.quantity + EXCLUDED.quantity, updated_at = now();
    RETURN;
  END IF;
  need := -_delta;
  FOR loc IN
    SELECT location, quantity FROM public.product_locations
     WHERE product_id = _product_id AND quantity > 0
     ORDER BY (location = 'ראשי') DESC, quantity DESC
     FOR UPDATE
  LOOP
    EXIT WHEN need <= 0;
    take := LEAST(need, loc.quantity);
    UPDATE public.product_locations SET quantity = quantity - take, updated_at = now()
     WHERE product_id = _product_id AND location = loc.location;
    need := need - take;
  END LOOP;
  DELETE FROM public.product_locations WHERE product_id = _product_id AND quantity = 0 AND location <> 'ראשי';
END $$;

CREATE OR REPLACE FUNCTION public.locations_list()
RETURNS TABLE(location text, products integer, units integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pl.location, count(*)::int, SUM(pl.quantity)::int
    FROM public.product_locations pl
   WHERE public.can_pick(auth.uid())
     AND pl.tenant_id = public.current_tenant_id()
   GROUP BY pl.location
   ORDER BY (pl.location = 'ראשי') DESC, pl.location;
$$;

CREATE OR REPLACE FUNCTION public.stock_lookup(_query text)
RETURNS TABLE(id uuid, name text, sku text, barcode text, image_url text, category text, pack_size integer, is_hidden boolean, available integer, reserved integer, locations jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (SELECT btrim(COALESCE(_query, '')) AS t)
  SELECT gp.id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.category, gp.pack_size, gp.is_hidden,
         gp.stock_quantity,
         COALESCE((SELECT SUM(oi.reserved_quantity)::int FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                    WHERE oi.product_id = gp.id AND NOT oi.is_deposit AND o.kind = 'order'
                      AND o.status IN ('pending', 'agent_review', 'picking', 'picked')), 0),
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

CREATE OR REPLACE FUNCTION public.stock_reserved_open()
RETURNS TABLE(product_id uuid, reserved integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.product_id, SUM(oi.reserved_quantity)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE public.is_staff(auth.uid())
     AND o.tenant_id = public.current_tenant_id()
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking', 'picked')
     AND NOT oi.is_deposit
     AND oi.reserved_quantity > 0
   GROUP BY oi.product_id;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_count(_count_id uuid)
RETURNS TABLE(counted integer, changed integer, marked_out_of_stock integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  line RECORD;
  p RECORD;
  held INTEGER;
  available INTEGER;
  min_sell INTEGER;
  n_counted INTEGER := 0;
  n_changed INTEGER := 0;
  n_marked INTEGER := 0;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לאשר ספירת מלאי';
  END IF;

  SELECT * INTO c FROM public.stock_counts
   WHERE id = _count_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הספירה לא נמצאה';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'הספירה כבר %', CASE c.status WHEN 'applied' THEN 'אושרה' ELSE 'בוטלה' END;
  END IF;

  PERFORM set_config('kobi.stock_internal', 'on', true);

  FOR line IN
    SELECT * FROM public.stock_count_lines WHERE count_id = _count_id ORDER BY product_id
  LOOP
    SELECT id, stock_quantity, pack_size, is_out_of_stock, out_of_stock_auto INTO p
      FROM public.global_products WHERE id = line.product_id AND tenant_id = c.tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(oi.reserved_quantity), 0)::integer INTO held
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.product_id = p.id
       AND o.kind = 'order'
       AND o.status IN ('pending', 'agent_review', 'picking', 'picked')
       AND NOT oi.is_deposit;

    available := GREATEST(line.counted_units - held, 0);
    min_sell := CASE WHEN p.pack_size IS NOT NULL AND p.pack_size >= 2 THEN p.pack_size ELSE 1 END;
    n_counted := n_counted + 1;
    IF available <> p.stock_quantity THEN
      n_changed := n_changed + 1;
    END IF;

    IF available < min_sell THEN
      IF NOT p.is_out_of_stock THEN
        n_marked := n_marked + 1;
        UPDATE public.global_products
           SET stock_quantity = available, is_out_of_stock = true, out_of_stock_auto = true
         WHERE id = p.id;
      ELSE
        UPDATE public.global_products SET stock_quantity = available WHERE id = p.id;
      END IF;
    ELSIF p.is_out_of_stock AND p.out_of_stock_auto THEN
      UPDATE public.global_products
         SET stock_quantity = available, is_out_of_stock = false, out_of_stock_auto = false
       WHERE id = p.id;
    ELSE
      UPDATE public.global_products SET stock_quantity = available WHERE id = p.id;
    END IF;

    UPDATE public.stock_count_lines
       SET recorded_before = p.stock_quantity, reserved_open = held, applied_quantity = available
     WHERE id = line.id;
  END LOOP;

  UPDATE public.stock_counts
     SET status = 'applied', applied_by = auth.uid(), applied_at = now()
   WHERE id = _count_id;

  PERFORM set_config('kobi.stock_internal', 'off', true);
  RETURN QUERY SELECT n_counted, n_changed, n_marked;
END $$;

CREATE OR REPLACE FUNCTION public.set_order_urgent(_order_id uuid, _urgent boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל יכול לסמן הזמנה כדחופה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.orders SET is_urgent = _urgent
   WHERE id = _order_id AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  END IF;
  PERFORM public.picking_log(_order_id, CASE WHEN _urgent THEN 'urgent_on' ELSE 'urgent_off' END);
END $$;

-- ============================================================
-- 9. ליקוט (picking_*)
-- ============================================================

-- יומן הליקוט נרשם בחנות של ההזמנה
CREATE OR REPLACE FUNCTION public.picking_log(_order_id uuid, _action text, _details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.picking_events (tenant_id, order_id, actor_id, action, details)
  SELECT o.tenant_id, o.id, auth.uid(), _action, COALESCE(_details, '{}'::jsonb)
    FROM public.orders o
   WHERE o.id = _order_id;
$$;

-- כל פעולת ליקוט על הזמנה בודדת עוברת כאן — הזמנה של חנות אחרת = "לא נמצאה"
CREATE OR REPLACE FUNCTION public.picking_assert_order(_order_id uuid, _require_picking boolean DEFAULT true)
RETURNS public.orders
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders
   WHERE id = _order_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  END IF;
  IF _require_picking AND o.status <> 'picking' THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאת בליקוט';
  END IF;
  IF NOT public.is_admin(auth.uid()) AND o.picker_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'ההזמנה בליקוט אצל %', COALESCE(public.staff_display_name(o.picker_id), 'עובד אחר')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN o;
END $$;

CREATE OR REPLACE FUNCTION public.picking_claim(_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.orders
     SET picker_id = auth.uid(), picking_claimed_at = now(), picking_paused = false
   WHERE id = _order_id AND tenant_id = _tenant AND status = 'picking' AND picker_id IS NULL;
  IF FOUND THEN
    PERFORM public.picking_log(_order_id, 'claim');
    RETURN;
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = _order_id AND tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה';
  ELSIF o.status <> 'picking' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לליקוט';
  ELSIF o.picker_id = auth.uid() THEN
    RETURN; -- כבר אצלי
  ELSE
    RAISE EXCEPTION 'ההזמנה כבר בליקוט אצל %', COALESCE(public.staff_display_name(o.picker_id), 'עובד אחר');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.picking_mark_item(_item_id uuid, _picked_qty integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
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

CREATE OR REPLACE FUNCTION public.picking_manager_approve(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  shortages JSONB;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל מאשר ליקוט שבוצע' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders
   WHERE id = _order_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR o.status <> 'picked' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לאישור ליקוט';
  END IF;
  UPDATE public.orders SET status = 'shipped', picking_approved_by = auth.uid() WHERE id = _order_id;
  SELECT details -> 'shortages' INTO shortages FROM public.picking_events
   WHERE order_id = _order_id AND action = 'approve' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.picking_log(_order_id, 'manager_approve');
  RETURN jsonb_build_object('shortages', COALESCE(shortages, '[]'::jsonb), 'status', 'shipped');
END $$;

CREATE OR REPLACE FUNCTION public.picking_return(_order_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל מחזיר לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO o FROM public.orders
   WHERE id = _order_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND OR o.status <> 'picked' THEN
    RAISE EXCEPTION 'ההזמנה לא ממתינה לאישור ליקוט';
  END IF;
  UPDATE public.orders SET status = 'picking', picked_at = NULL, picking_paused = false WHERE id = _order_id;
  PERFORM public.picking_log(_order_id, 'returned');
END $$;

CREATE OR REPLACE FUNCTION public.picking_order_lines(_order_id uuid)
RETURNS TABLE(item_id uuid, product_id uuid, name text, sku text, barcode text, image_url text, shelf_location text, pack_size integer, quantity integer, picked boolean, picked_qty integer, picked_at timestamp with time zone, locations jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT oi.id, oi.product_id, COALESCE(gp.name, 'מוצר'), gp.sku, gp.barcode, gp.image_url,
         NULLIF(btrim(gp.shelf_location), ''), gp.pack_size, oi.quantity, oi.picked, oi.picked_qty, oi.picked_at,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('location', pl.location, 'quantity', pl.quantity)
                                    ORDER BY (pl.location = 'ראשי') DESC, pl.quantity DESC)
                     FROM public.product_locations pl WHERE pl.product_id = oi.product_id AND pl.quantity > 0), '[]'::jsonb)
    FROM public.order_items oi
    LEFT JOIN public.global_products gp ON gp.id = oi.product_id
   WHERE public.can_pick(auth.uid()) AND oi.order_id = _order_id AND NOT oi.is_deposit
     AND oi.tenant_id = public.current_tenant_id()
   ORDER BY NULLIF(btrim(gp.shelf_location), '') NULLS LAST, gp.name;
$$;

CREATE OR REPLACE FUNCTION public.picking_orders()
RETURNS TABLE(id uuid, order_number text, status text, is_urgent boolean, created_at timestamp with time zone, note text, picker_id uuid, picker_name text, picking_paused boolean, picking_claimed_at timestamp with time zone, picked_at timestamp with time zone, picking_approved_by uuid, approved_by_name text, customer_name text, customer_address text, customer_phone text, contact_name text, total_lines integer, picked_lines integer, short_lines integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.order_number, o.status, o.is_urgent, o.created_at, o.note,
         o.picker_id, public.staff_display_name(o.picker_id), o.picking_paused, o.picking_claimed_at,
         o.picked_at, o.picking_approved_by, public.staff_display_name(o.picking_approved_by),
         COALESCE(cp.business_name, cp.contact_name, 'לקוח'), cp.business_address, cp.phone, cp.contact_name,
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit AND oi.picked),
         (SELECT count(*)::int FROM public.picking_events e, jsonb_array_elements(e.details -> 'shortages') s
           WHERE e.order_id = o.id AND e.action = 'approve'
             AND e.created_at = (SELECT max(e2.created_at) FROM public.picking_events e2 WHERE e2.order_id = o.id AND e2.action = 'approve'))
         + (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id AND NOT oi.is_deposit AND oi.picked AND oi.picked_qty < oi.quantity)
    FROM public.orders o
    LEFT JOIN public.customer_profiles cp ON cp.user_id = o.customer_id
   WHERE public.can_pick(auth.uid())
     AND o.tenant_id = public.current_tenant_id()
     AND (o.status IN ('picking', 'picked') OR (o.status = 'shipped' AND o.picked_at > now() - interval '45 days'))
   ORDER BY CASE o.status WHEN 'picking' THEN 0 WHEN 'picked' THEN 1 ELSE 2 END, o.is_urgent DESC, o.created_at;
$$;

CREATE OR REPLACE FUNCTION public.picking_leaderboard()
RETURNS TABLE(user_id uuid, name text, is_blocked boolean, this_month integer, last_month integer, total integer, in_progress integer, last_picked_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at >= date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at >= date_trunc('month', now()) - interval '1 month' AND o.picked_at < date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped') AND o.picked_at IS NOT NULL),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking'),
         (SELECT max(o.picked_at) FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','shipped'))
    FROM public.user_roles ur
   WHERE public.is_admin(auth.uid())
     AND ur.tenant_id = public.current_tenant_id()
     AND (ur.role = 'warehouse' OR EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id))
   ORDER BY 4 DESC, 2;
$$;

CREATE OR REPLACE FUNCTION public.picking_stats(_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(period text, period_start date, orders integer, lines integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID := COALESCE(_user_id, auth.uid());
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF target <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'מחסנאי רואה רק את הנתונים של עצמו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT 'month', date_trunc('month', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.tenant_id = _tenant
       AND o.picker_id = target AND o.status IN ('picked', 'shipped') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('month', now()) - interval '23 months'
     GROUP BY 2
    UNION ALL
    SELECT 'week', date_trunc('week', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.tenant_id = _tenant
       AND o.picker_id = target AND o.status IN ('picked', 'shipped') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('week', now()) - interval '15 weeks'
     GROUP BY 2
    ORDER BY 1, 2;
END $$;

CREATE OR REPLACE FUNCTION public.picking_workers()
RETURNS TABLE(user_id uuid, name text, role text, is_blocked boolean, active_orders integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.role, ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking')
    FROM public.user_roles ur
   WHERE public.can_pick(auth.uid())
     AND ur.tenant_id = public.current_tenant_id()
     AND (ur.role = 'warehouse'
          OR (ur.role = 'admin' AND EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking')))
   ORDER BY ur.role = 'warehouse' DESC, 2;
$$;

-- picking_approve / picking_release / picking_set_paused / picking_transfer
-- לא השתנו: הן עוברות דרך picking_assert_order (מסוננת לפי חנות), ו-can_pick
-- של העובד היעד ב-picking_transfer כבר מחייב שייכות לחנות.

-- ============================================================
-- 10. העברות בין איתורים (transfer_*)
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_assert(_transfer_id uuid, _draft boolean DEFAULT true)
RETURNS public.location_transfers
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.location_transfers;
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה להעברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM public.location_transfers
   WHERE id = _transfer_id AND tenant_id = public.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ההעברה לא נמצאה';
  END IF;
  IF t.created_by <> auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'זו העברה של עובד אחר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _draft AND t.status <> 'draft' THEN
    RAISE EXCEPTION 'ההעברה כבר %', CASE t.status WHEN 'approved' THEN 'אושרה' ELSE 'בוטלה' END;
  END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_create(_note text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה להעברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.location_transfers (tenant_id, created_by, note)
  VALUES (_tenant, auth.uid(), NULLIF(btrim(COALESCE(_note, '')), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_line_delete(_line_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tid UUID;
BEGIN
  SELECT transfer_id INTO tid FROM public.location_transfer_lines
   WHERE id = _line_id AND tenant_id = public.current_tenant_id();
  IF tid IS NULL THEN RETURN; END IF;
  PERFORM public.transfer_assert(tid);
  DELETE FROM public.location_transfer_lines WHERE id = _line_id;
  UPDATE public.location_transfers SET updated_at = now() WHERE id = tid;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_line_save(_transfer_id uuid, _line_id uuid, _product_id uuid, _from text, _to text, _quantity integer)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.location_transfers := public.transfer_assert(_transfer_id);
  src TEXT := public.normalize_location(_from);
  dst TEXT := public.normalize_location(_to);
  avail INTEGER;
  saved UUID;
BEGIN
  -- מוצר של חנות אחרת: נדחה לפני שבודקים כמויות (לא חושף מלאי זר)
  IF NOT EXISTS (SELECT 1 FROM public.global_products WHERE id = _product_id AND tenant_id = t.tenant_id) THEN
    RAISE EXCEPTION 'המוצר לא נמצא';
  END IF;
  IF src IS NULL THEN RAISE EXCEPTION 'יש לבחור איתור מקור'; END IF;
  IF dst IS NULL THEN RAISE EXCEPTION 'יש לבחור או להקליד איתור יעד'; END IF;
  IF length(dst) > 40 THEN RAISE EXCEPTION 'שם האיתור ארוך מדי (עד 40 תווים)'; END IF;
  IF src = dst THEN RAISE EXCEPTION 'איתור היעד זהה לאיתור המקור'; END IF;
  IF _quantity IS NULL OR _quantity < 1 THEN RAISE EXCEPTION 'הכמות להעברה חייבת להיות לפחות 1'; END IF;
  avail := public.transfer_available(_transfer_id, _product_id, src, _line_id);
  IF _quantity > avail THEN
    RAISE EXCEPTION 'אפשר להעביר מ"%" עד % יח׳ (כמות שמורה להזמנות לא ניתנת להעברה)', src, GREATEST(avail, 0);
  END IF;
  IF _line_id IS NULL THEN
    INSERT INTO public.location_transfer_lines (tenant_id, transfer_id, product_id, from_location, to_location, quantity)
    VALUES (t.tenant_id, _transfer_id, _product_id, src, dst, _quantity) RETURNING id INTO saved;
  ELSE
    UPDATE public.location_transfer_lines
       SET product_id = _product_id, from_location = src, to_location = dst, quantity = _quantity
     WHERE id = _line_id AND transfer_id = _transfer_id
    RETURNING id INTO saved;
    IF saved IS NULL THEN RAISE EXCEPTION 'השורה לא נמצאה'; END IF;
  END IF;
  UPDATE public.location_transfers SET updated_at = now() WHERE id = _transfer_id;
  RETURN saved;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_approve(_transfer_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.location_transfers := public.transfer_assert(_transfer_id);
  g RECORD;
  l RECORD;
  n INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.location_transfer_lines WHERE transfer_id = _transfer_id) THEN
    RAISE EXCEPTION 'אין שורות בהעברה';
  END IF;
  -- נעילת השורות של המוצרים המעורבים, ובדיקה מצטברת לכל מוצר+איתור מקור
  PERFORM 1 FROM public.product_locations pl
    WHERE pl.product_id IN (SELECT product_id FROM public.location_transfer_lines WHERE transfer_id = _transfer_id)
    ORDER BY pl.product_id, pl.location FOR UPDATE;
  FOR g IN
    SELECT tl.product_id, tl.from_location, SUM(tl.quantity)::int AS qty, max(gp.name) AS name,
           COALESCE((SELECT quantity FROM public.product_locations pl WHERE pl.product_id = tl.product_id AND pl.location = tl.from_location), 0) AS have
      FROM public.location_transfer_lines tl JOIN public.global_products gp ON gp.id = tl.product_id
     WHERE tl.transfer_id = _transfer_id
     GROUP BY tl.product_id, tl.from_location
  LOOP
    IF g.qty > g.have THEN
      RAISE EXCEPTION 'לא ניתן לאשר: "%" — ב"%" יש עכשיו % יח׳ פנויות, וההעברה מבקשת %', g.name, g.from_location, g.have, g.qty;
    END IF;
  END LOOP;
  FOR l IN SELECT * FROM public.location_transfer_lines WHERE transfer_id = _transfer_id ORDER BY created_at LOOP
    UPDATE public.product_locations SET quantity = quantity - l.quantity, updated_at = now()
     WHERE product_id = l.product_id AND location = l.from_location;
    INSERT INTO public.product_locations (tenant_id, product_id, location, quantity)
    VALUES (t.tenant_id, l.product_id, l.to_location, l.quantity)
    ON CONFLICT (product_id, location) DO UPDATE SET quantity = public.product_locations.quantity + EXCLUDED.quantity, updated_at = now();
    n := n + 1;
  END LOOP;
  DELETE FROM public.product_locations
   WHERE quantity = 0 AND location <> 'ראשי'
     AND product_id IN (SELECT product_id FROM public.location_transfer_lines WHERE transfer_id = _transfer_id);
  UPDATE public.location_transfers SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
   WHERE id = _transfer_id;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_lines(_transfer_id uuid)
RETURNS TABLE(id uuid, product_id uuid, name text, sku text, barcode text, image_url text, pack_size integer, from_location text, to_location text, quantity integer, available integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.product_id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.pack_size,
         l.from_location, l.to_location, l.quantity,
         COALESCE((SELECT quantity FROM public.product_locations pl WHERE pl.product_id = l.product_id AND pl.location = l.from_location), 0)
    FROM public.location_transfer_lines l
    JOIN public.location_transfers t ON t.id = l.transfer_id
    JOIN public.global_products gp ON gp.id = l.product_id
   WHERE public.can_pick(auth.uid()) AND l.transfer_id = _transfer_id
     AND t.tenant_id = public.current_tenant_id()
     AND (t.created_by = auth.uid() OR public.is_admin(auth.uid()))
   ORDER BY l.created_at;
$$;

CREATE OR REPLACE FUNCTION public.transfers_list(_status text)
RETURNS TABLE(id uuid, status text, note text, created_by uuid, created_by_name text, created_at timestamp with time zone, updated_at timestamp with time zone, approved_by_name text, approved_at timestamp with time zone, lines integer, units integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.status, t.note, t.created_by, public.staff_display_name(t.created_by), t.created_at, t.updated_at,
         public.staff_display_name(t.approved_by), t.approved_at,
         (SELECT count(*)::int FROM public.location_transfer_lines l WHERE l.transfer_id = t.id),
         (SELECT COALESCE(SUM(quantity), 0)::int FROM public.location_transfer_lines l WHERE l.transfer_id = t.id)
    FROM public.location_transfers t
   WHERE public.can_pick(auth.uid())
     AND t.tenant_id = public.current_tenant_id()
     AND t.status = _status
     AND (t.created_by = auth.uid() OR public.is_admin(auth.uid()))
     AND (t.status = 'draft' OR t.updated_at > now() - interval '120 days')
   ORDER BY t.updated_at DESC
   LIMIT 200;
$$;

-- ============================================================
-- 11. Storage: כל חנות כותבת רק לתיקייה <tenant_id>/...
--     קבצים ישנים (site/..., products/...) נשארים זמינים לקריאה, וניתנים
--     לניהול רק ע"י מנהל חנות ברירת המחדל שאליה הם שייכים.
-- ============================================================
CREATE OR REPLACE FUNCTION public.storage_path_in_current_tenant(_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN split_part(_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN split_part(_name, '/', 1) = public.current_tenant_id()::text
    -- נתיב ישן בלי מזהה חנות: רק חנות ברירת המחדל (שאליה שויך כל המידע הקיים)
    ELSE EXISTS (SELECT 1 FROM public.tenants t
                  WHERE t.is_default AND t.id = public.current_tenant_id())
  END;
$$;
GRANT EXECUTE ON FUNCTION public.storage_path_in_current_tenant(text) TO anon, authenticated, service_role;

DO $$
DECLARE _p text;
BEGIN
  FOREACH _p IN ARRAY ARRAY[
    'product images admin write', 'product images admin update', 'product images admin delete',
    'branding site logo admin write', 'branding site logo admin update', 'branding site logo admin delete',
    'branding site logo public read'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', _p);
  END LOOP;
END $$;

CREATE POLICY "product images admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin(auth.uid())
              AND public.storage_path_in_current_tenant(name));
CREATE POLICY "product images admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin(auth.uid())
         AND public.storage_path_in_current_tenant(name))
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin(auth.uid())
              AND public.storage_path_in_current_tenant(name));
CREATE POLICY "product images admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin(auth.uid())
         AND public.storage_path_in_current_tenant(name));

-- branding: <tenant_id>/site/... (לוגו ובאנרים); בנתיב הישן — site/...
CREATE POLICY "branding site logo public read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'branding'
         AND ((storage.foldername(name))[1] = 'site' OR (storage.foldername(name))[2] = 'site'));
CREATE POLICY "branding site logo admin write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'branding' AND public.is_admin(auth.uid())
              AND public.storage_path_in_current_tenant(name)
              AND ((storage.foldername(name))[1] = 'site' OR (storage.foldername(name))[2] = 'site'));
CREATE POLICY "branding site logo admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'branding' AND public.is_admin(auth.uid())
         AND public.storage_path_in_current_tenant(name))
  WITH CHECK (bucket_id = 'branding' AND public.is_admin(auth.uid())
              AND public.storage_path_in_current_tenant(name)
              AND ((storage.foldername(name))[1] = 'site' OR (storage.foldername(name))[2] = 'site'));
CREATE POLICY "branding site logo admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'branding' AND public.is_admin(auth.uid())
         AND public.storage_path_in_current_tenant(name));

-- ============================================================
-- 12. בדיקה עצמית: אין עוד פונקציית DEFINER שקוראת את ההגדרות בלי חנות
-- ============================================================
DO $$
DECLARE _bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND p.prosrc ~ '(site_settings|email_settings)'
     AND p.prosrc !~ 'tenant_id';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'multi-tenant: פונקציות שקוראות הגדרות בלי tenant_id: %', _bad;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

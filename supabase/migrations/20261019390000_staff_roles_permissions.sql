-- ============================================================
-- חלק 33: תפקידים והרשאות לצוות החנות (Staff Roles & Permissions)
--
-- התפקידים בחנות (user_roles.role + is_protected):
--   owner     — בעל החנות: המנהל המוגן (is_protected) — כל ההרשאות.
--               לכל חנות בעלים אחד: המנהל הראשון שנוסף לחנות (וחנויות
--               קיימות — לפי owner_email של החנות, אחרת המנהל הוותיק).
--               אי אפשר לחסום / למחוק / להוריד לו הרשאות (כמו קודם).
--   manager   — מנהל חנות (role='admin' בלי הגנה): רואה ומנהל הכל, חוץ
--               משינוי חבילת ה-SaaS / רכישת תוספים / פרטי החיוב, ומינוי
--               או הורדה של מנהלים אחרים (רק הבעלים).
--   cashier   — קופאי (חדש): רק הקופה המהירה — יצירת הזמנות וצפייה
--               במוצרים (בלי מחירי עלות, בלי רשימת ההזמנות וההכנסות).
--   warehouse — מחסנאי: מלאי (בדיקת מלאי, העברות, ליקוט), הדפסת
--               מדבקות ברקוד, וצפייה / עדכון סטטוס משלוח של הזמנות —
--               בלי מחירים.
--   agent     — סוכן מכירות (כמו קודם, האזור שלו ב-/agent).
--
-- מטריצת ההרשאות במקום אחד: staff_can(permission) — וכל הבדיקות בשרת
-- ובמסד עוברות דרכה. המסכים (src/lib/permissions.ts) משקפים אותה.
--
-- מעקב עובדים על הזמנות: orders.created_by → created_by_staff_id (שינוי
-- שם — העמודה של חלק 32). נשמר אוטומטית במסד (לא מהדפדפן): בקופה — מי
-- שהקליד; בהזמנה שעובד פתח ללקוח מהניהול — העובד.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. תפקיד "קופאי"
-- ============================================================
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('admin', 'agent', 'customer', 'warehouse', 'cashier'));

CREATE OR REPLACE FUNCTION public.is_cashier(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'cashier' AND NOT is_blocked
                    AND tenant_id = public.current_tenant_id());
$$;
REVOKE ALL ON FUNCTION public.is_cashier(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_cashier(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. בעל החנות = המנהל המוגן. השלמה לחנויות שאין בהן עדיין בעלים:
--    המנהל שהאימייל שלו הוא owner_email של החנות, אחרת הוותיק ביותר
-- ============================================================
WITH owners AS (
  SELECT DISTINCT ON (ur.tenant_id) ur.tenant_id, ur.user_id
    FROM public.user_roles ur
    JOIN public.tenants t ON t.id = ur.tenant_id
   WHERE ur.role = 'admin'
     AND NOT ur.is_blocked
     AND NOT EXISTS (SELECT 1 FROM public.user_roles p
                      WHERE p.tenant_id = ur.tenant_id AND p.is_protected)
   ORDER BY ur.tenant_id,
            (lower(ur.email) = lower(COALESCE(t.owner_email, ''))) DESC,
            ur.created_at, ur.user_id
)
UPDATE public.user_roles ur
   SET is_protected = true, is_approved = true
  FROM owners o
 WHERE ur.tenant_id = o.tenant_id AND ur.user_id = o.user_id;

-- ============================================================
-- 3. התפקיד בחנות + מטריצת ההרשאות
-- ============================================================
-- owner / manager / cashier / warehouse / agent — או NULL (לקוח / חסום / אורח).
-- מנהל-על (God Mode) = בעלים בכל חנות.
CREATE OR REPLACE FUNCTION public.store_staff_role(_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN NULL
    WHEN public.is_platform_admin(_user_id) THEN 'owner'
    ELSE (
      SELECT CASE ur.role
               WHEN 'admin' THEN CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END
               WHEN 'cashier' THEN 'cashier'
               WHEN 'warehouse' THEN 'warehouse'
               WHEN 'agent' THEN 'agent'
             END
        FROM public.user_roles ur
       WHERE ur.user_id = _user_id
         AND ur.tenant_id = public.current_tenant_id()
         AND NOT ur.is_blocked
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.store_staff_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_staff_role(uuid) TO authenticated, service_role;

-- ההרשאות:
--   pos             — הקופה המהירה (יצירת הזמנה, חיפוש לקוח, מחיר ללקוח)
--   products.view   — רשימת המוצרים (בלי מחיר עלות)
--   inventory       — מלאי ומדבקות ברקוד
--   orders.fulfill  — רשימת ההזמנות למשלוח + עדכון סטטוס משלוח (בלי מחירים)
--   admin           — פאנל הניהול המלא (לוח בקרה, הזמנות, הגדרות, משתמשים...)
--   staff.manage    — ניהול הצוות (קופאים, מחסנאים, סוכנים)
--   staff.managers  — מינוי / הורדה / חסימה של מנהלים — הבעלים בלבד
--   billing.manage  — חבילת ה-SaaS, תוספים ופרטי החיוב — הבעלים בלבד
CREATE OR REPLACE FUNCTION public.staff_can(_permission text, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    CASE public.store_staff_role(_user_id)
      WHEN 'owner' THEN true
      WHEN 'manager' THEN _permission NOT IN ('billing.manage', 'staff.managers')
      WHEN 'cashier' THEN _permission IN ('pos', 'products.view')
      WHEN 'warehouse' THEN _permission IN ('products.view', 'inventory', 'orders.fulfill')
      WHEN 'agent' THEN _permission IN ('products.view')
    END,
    false);
$$;
REVOKE ALL ON FUNCTION public.staff_can(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_can(text, uuid) TO authenticated, service_role;

-- ============================================================
-- 4. "צוות" בטריגרים של ההזמנה: קופאי נחשב צוות רק בתוך הקופה.
--    admin_create_order (למטה) מסמן את הטרנזקציה (kobi.pos_actor) אחרי
--    בדיקת ההרשאה — כך ההזמנה שלו עוברת בדיוק את אותם כללים כמו של
--    מנהל (מחיר כפי שנשלח, מלאי בלי חסימה, האתר בשבת...), בלי שהקופאי
--    יקבל גישת "צוות" לטבלאות (מחירי עלות, ספירות מלאי, מוצרים ממתינים).
--    הדגל נקבע רק בתוך הפונקציה, ונמחק בסוף הטרנזקציה.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin(_user_id) OR public.is_agent(_user_id)
      OR (_user_id IS NOT NULL
          AND COALESCE(current_setting('kobi.pos_actor', true), '') = _user_id::text
          AND public.is_cashier(_user_id));
$$;

-- ============================================================
-- 5. בעלים ומנהלים — שמירה במסד (גם מעבר לבדיקות בשרת):
--    • המנהל הראשון שנוסף לחנות בלי בעלים — הופך לבעלים.
--    • האפליקציה לא יוצרת שורת בעלים בעצמה (is_protected).
--    • רק הבעלים (או מנהל-על) ממנה מנהל, משנה תפקיד של מנהל, חוסם או
--      מוחק מנהל. השרת (service_role, בלי משתמש) — בודק בעצמו לפני.
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_roles_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _trusted boolean := _me IS NULL OR public.is_platform_admin(_me);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT _trusted AND OLD.role = 'admin' AND NOT public.staff_can('staff.managers', _me) THEN
      RAISE EXCEPTION 'רק בעל החנות יכול להסיר מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT _trusted THEN
      NEW.is_protected := false;
      IF NEW.role = 'admin' AND NOT public.staff_can('staff.managers', _me) THEN
        RAISE EXCEPTION 'רק בעל החנות יכול להוסיף מנהלים' USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
    IF NEW.role = 'admin' AND NOT NEW.is_protected AND NOT NEW.is_blocked THEN
      -- שתי הוספות במקביל לחנות חדשה — אחת אחרי השנייה
      PERFORM pg_advisory_xact_lock(hashtextextended('store-owner:' || NEW.tenant_id::text, 0));
      IF NOT EXISTS (SELECT 1 FROM public.user_roles
                      WHERE tenant_id = NEW.tenant_id AND is_protected) THEN
        NEW.is_protected := true;
        NEW.is_approved := true;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT _trusted AND NOT public.staff_can('staff.managers', _me) THEN
    IF NEW.role IS DISTINCT FROM OLD.role AND (OLD.role = 'admin' OR NEW.role = 'admin') THEN
      RAISE EXCEPTION 'רק בעל החנות יכול למנות מנהלים או לשנות תפקיד של מנהל'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.role = 'admin' AND NEW.is_blocked AND NOT OLD.is_blocked THEN
      RAISE EXCEPTION 'רק בעל החנות יכול לחסום מנהל' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_roles_owner_guard ON public.user_roles;
CREATE TRIGGER user_roles_owner_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.user_roles_owner_guard();

-- ============================================================
-- 6. ניהול הצוות: שינוי תפקיד של עובד (מסך "צוות והרשאות").
--    manager / cashier / warehouse / agent. לא את הבעלים, לא את עצמך,
--    ומנהלים — רק הבעלים. מגבלת המנהלים בחבילה נאכפת בטריגר הקיים.
-- ============================================================
CREATE OR REPLACE FUNCTION public.store_set_staff_role(_user_id uuid, _staff_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
  _target RECORD;
  _role text;
BEGIN
  IF _me IS NULL OR _tenant IS NULL OR NOT public.staff_can('staff.manage', _me) THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה לניהול הצוות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  _role := CASE _staff_role
             WHEN 'manager' THEN 'admin'
             WHEN 'cashier' THEN 'cashier'
             WHEN 'warehouse' THEN 'warehouse'
             WHEN 'agent' THEN 'agent'
           END;
  IF _role IS NULL THEN
    RAISE EXCEPTION 'תפקיד לא תקין' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ur.role, ur.is_protected INTO _target
    FROM public.user_roles ur
   WHERE ur.user_id = _user_id AND ur.tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'העובד לא נמצא בחנות' USING ERRCODE = 'check_violation';
  END IF;
  IF _target.is_protected THEN
    RAISE EXCEPTION 'אי אפשר לשנות את התפקיד של בעל החנות' USING ERRCODE = 'check_violation';
  END IF;
  IF _user_id = _me THEN
    RAISE EXCEPTION 'אי אפשר לשנות את התפקיד של עצמך' USING ERRCODE = 'check_violation';
  END IF;
  IF _target.role = 'customer' THEN
    RAISE EXCEPTION 'זה חשבון של לקוח — צירוף לצוות נעשה במסך "משתמשים"'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (_role = 'admin' OR _target.role = 'admin') AND _role IS DISTINCT FROM _target.role
     AND NOT public.staff_can('staff.managers', _me) THEN
    RAISE EXCEPTION 'רק בעל החנות יכול למנות מנהלים או לשנות תפקיד של מנהל'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _role IS DISTINCT FROM _target.role THEN
    UPDATE public.user_roles
       SET role = _role, is_approved = true
     WHERE user_id = _user_id AND tenant_id = _tenant;
  END IF;
  RETURN _staff_role;
END $$;
REVOKE ALL ON FUNCTION public.store_set_staff_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_set_staff_role(uuid, text) TO authenticated, service_role;

-- צירוף חשבון קיים לצוות (חלק 18ב) — גם כקופאי. מנהלים — רק הבעלים
-- (נאכף בטריגר user_roles_owner_guard)
CREATE OR REPLACE FUNCTION public.store_link_existing_account(_email text, _role text, _display_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _e text := lower(btrim(COALESCE(_email, '')));
  _uid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('staff.manage', auth.uid()) THEN
    RAISE EXCEPTION 'רק מנהל החנות יכול לצרף אנשי צוות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF COALESCE(_role, '') NOT IN ('admin', 'agent', 'warehouse', 'cashier') THEN
    RAISE EXCEPTION 'אפשר לצרף חשבון קיים רק כאיש צוות או כמנהל' USING ERRCODE = 'check_violation';
  END IF;
  IF _e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'כתובת אימייל לא תקינה' USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.id INTO _uid
    FROM auth.users u
   WHERE lower(u.email) = _e
   ORDER BY u.created_at
   LIMIT 1;
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid AND ur.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'כתובת האימייל הזו כבר רשומה בחנות' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.user_roles
    (tenant_id, user_id, email, role, is_approved, is_blocked, must_change_password, display_name)
  VALUES
    (_tenant, _uid, _e, _role, true, false, false, NULLIF(btrim(COALESCE(_display_name, '')), ''));
  RETURN _uid;
END $$;
REVOKE ALL ON FUNCTION public.store_link_existing_account(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_link_existing_account(text, text, text) TO authenticated, service_role;

-- מחליף החנויות: גם קופאי; "בעלים" = בעל החנות (המנהל המוגן), או — כמו
-- קודם — המנהל שהאימייל שלו הוא owner_email של החנות
CREATE OR REPLACE FUNCTION public.my_stores()
RETURNS TABLE(tenant_id uuid, slug text, name text, role text, is_owner boolean, status text,
              is_default boolean, domain text, custom_domain text, custom_domain_status text,
              is_current boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT auth.uid() AS uid, public.current_tenant_id() AS current)
  SELECT t.id, t.slug,
         COALESCE(NULLIF(btrim(s.business_name), ''), t.name),
         ur.role,
         (ur.role = 'admin'
          AND (ur.is_protected
               OR (t.owner_email IS NOT NULL
                   AND lower(btrim(t.owner_email)) = lower(btrim(ur.email))))),
         t.status, t.is_default, t.domain, t.custom_domain, t.custom_domain_status,
         t.id IS NOT DISTINCT FROM me.current
    FROM me
    JOIN public.user_roles ur ON ur.user_id = me.uid
    JOIN public.tenants t ON t.id = ur.tenant_id
    LEFT JOIN public.site_settings s ON s.tenant_id = t.id
   WHERE me.uid IS NOT NULL
     AND ur.role IN ('admin', 'agent', 'warehouse', 'cashier')
     AND NOT ur.is_blocked
   ORDER BY (t.id IS NOT DISTINCT FROM me.current) DESC,
            lower(COALESCE(NULLIF(btrim(s.business_name), ''), t.name)), t.created_at;
$$;

-- התפקיד של המשתמש המחובר בחנות — עכשיו גם staff_role (owner / manager /
-- cashier / warehouse / agent). סוג ההחזרה השתנה → DROP + CREATE.
DROP FUNCTION IF EXISTS public.my_store_role();
CREATE FUNCTION public.my_store_role()
RETURNS TABLE(user_id uuid, email text, username text, role text, is_approved boolean,
              is_blocked boolean, must_change_password boolean, is_platform_admin boolean,
              is_member boolean, staff_role text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid := public.current_tenant_id();
  _platform boolean;
BEGIN
  IF _uid IS NULL OR _tenant IS NULL THEN
    RETURN;
  END IF;
  _platform := public.is_platform_admin(_uid);

  RETURN QUERY
    SELECT ur.user_id, ur.email, ur.username, ur.role, ur.is_approved, ur.is_blocked,
           ur.must_change_password, _platform, true,
           CASE
             WHEN _platform THEN 'owner'
             WHEN ur.is_blocked THEN NULL
             WHEN ur.role = 'admin' THEN CASE WHEN ur.is_protected THEN 'owner' ELSE 'manager' END
             WHEN ur.role IN ('cashier', 'warehouse', 'agent') THEN ur.role
           END
      FROM public.user_roles ur
     WHERE ur.user_id = _uid AND ur.tenant_id = _tenant;
  IF FOUND OR NOT _platform THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT u.id, COALESCE(u.email, '')::text,
           COALESCE(NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''), 'platform')::text,
           'admin'::text, true, false, false, true, false, 'owner'::text
      FROM auth.users u
     WHERE u.id = _uid;
END $$;
REVOKE ALL ON FUNCTION public.my_store_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_store_role() TO authenticated;

-- ============================================================
-- 7. חבילה, תוספים ופרטי חיוב — הבעלים בלבד (מנהל רואה, לא משנה).
--    השרת (service_role) ומנהל הפלטפורמה — כמו קודם.
-- ============================================================
CREATE OR REPLACE FUNCTION public.require_store_owner_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.staff_can('billing.manage', auth.uid()) THEN
    RAISE EXCEPTION 'רק בעל החנות יכול לשנות את החבילה, לרכוש תוספים או לעדכן את פרטי החיוב'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_addons_owner_only ON public.tenant_addons;
CREATE TRIGGER tenant_addons_owner_only
BEFORE INSERT OR UPDATE ON public.tenant_addons
FOR EACH ROW EXECUTE FUNCTION public.require_store_owner_billing();

DROP TRIGGER IF EXISTS upgrade_requests_owner_only ON public.upgrade_requests;
CREATE TRIGGER upgrade_requests_owner_only
BEFORE INSERT ON public.upgrade_requests
FOR EACH ROW EXECUTE FUNCTION public.require_store_owner_billing();

DROP TRIGGER IF EXISTS tenant_billing_profile_owner_only ON public.tenant_billing_profile;
CREATE TRIGGER tenant_billing_profile_owner_only
BEFORE INSERT OR UPDATE ON public.tenant_billing_profile
FOR EACH ROW EXECUTE FUNCTION public.require_store_owner_billing();

-- ============================================================
-- 8. מעקב עובדים על הזמנות: created_by (חלק 32) → created_by_staff_id
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'created_by')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'orders'
                        AND column_name = 'created_by_staff_id') THEN
    ALTER TABLE public.orders RENAME COLUMN created_by TO created_by_staff_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_created_by_fkey') THEN
    ALTER TABLE public.orders RENAME CONSTRAINT orders_created_by_fkey TO orders_created_by_staff_id_fkey;
  END IF;
END $$;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_by_staff_id uuid;
-- העובד שיצר את ההזמנה (מנהל-על שאינו חבר בחנות — NULL). עובד שנמחק — NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.orders'::regclass
                    AND conname = 'orders_created_by_staff_id_fkey') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_created_by_staff_id_fkey
      FOREIGN KEY (tenant_id, created_by_staff_id) REFERENCES public.user_roles (tenant_id, user_id)
      ON DELETE SET NULL (created_by_staff_id);
  END IF;
END $$;
COMMENT ON COLUMN public.orders.created_by_staff_id IS
  'העובד שהקליד את ההזמנה (קופה מהירה / הזמנה שנפתחה ללקוח מהניהול). נקבע במסד בלבד';

CREATE INDEX IF NOT EXISTS orders_created_by_staff_idx
  ON public.orders (tenant_id, created_by_staff_id, created_at DESC)
  WHERE created_by_staff_id IS NOT NULL;

-- שדות הקופה ומי יצר — נקבעים במסד. הקופה: מנהל / בעלים / קופאי.
-- הזמנה שעובד (מנהל / סוכן / קופאי) פתח עבור לקוח — נרשם מי פתח.
CREATE OR REPLACE FUNCTION public.orders_pos_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  pos boolean := public.staff_can('pos', _me);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT pos OR NEW.order_source IS DISTINCT FROM 'pos' THEN
      NEW.order_source := 'web';
      IF NOT pos THEN
        NEW.manual_discount_type := NULL;
        NEW.manual_discount_value := NULL;
        NEW.pos_payment_method := NULL;
      END IF;
    END IF;
    -- תמיד העובד שמחובר בפועל (לא ערך מהדפדפן)
    NEW.created_by_staff_id :=
      CASE
        WHEN _me IS NULL THEN NULL
        WHEN NEW.order_source = 'pos' THEN public.tenant_member_id(_me)
        WHEN public.is_staff(_me) AND NEW.customer_id IS DISTINCT FROM _me
          THEN public.tenant_member_id(_me)
      END;
  ELSE
    NEW.order_source := OLD.order_source;
    -- לא משתנה אחרי היצירה — חוץ מ-NULL כשהעובד כבר לא בחנות (ON DELETE SET NULL)
    IF NEW.created_by_staff_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.user_roles ur
                   WHERE ur.tenant_id = OLD.tenant_id AND ur.user_id = OLD.created_by_staff_id) THEN
      NEW.created_by_staff_id := OLD.created_by_staff_id;
    END IF;
    IF NOT pos THEN
      NEW.manual_discount_type := OLD.manual_discount_type;
      NEW.manual_discount_value := OLD.manual_discount_value;
      NEW.pos_payment_method := OLD.pos_payment_method;
    END IF;
  END IF;
  -- הסכום בפועל — רק מהחישוב במסד
  NEW.manual_discount_amount := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE OLD.manual_discount_amount END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_pos_guard ON public.orders;
CREATE TRIGGER orders_pos_guard
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.orders_pos_guard();

-- ============================================================
-- 9. הקופה המהירה — גם לקופאי
-- ============================================================
CREATE OR REPLACE FUNCTION public.pos_unit_price(
  _customer_id uuid,
  _product_id uuid,
  _variant_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p RECORD;
  v_price numeric;
  tier smallint;
  price numeric;
  custom numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('pos') THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT gp.price_tier1, gp.price_tier2, gp.price_tier3,
         gp.sale_price, gp.sale_starts_at, gp.sale_ends_at
    INTO p
    FROM public.global_products gp
   WHERE gp.id = _product_id AND gp.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  IF _variant_id IS NOT NULL THEN
    SELECT v.price INTO v_price
      FROM public.product_variants v
     WHERE v.id = _variant_id AND v.product_id = _product_id
       AND v.tenant_id = public.current_tenant_id();
    IF v_price IS NOT NULL THEN
      RETURN round(v_price, 2);
    END IF;
  END IF;
  tier := CASE WHEN _customer_id IS NULL THEN 1 ELSE public.buyer_price_tier(_customer_id) END;
  price := CASE tier WHEN 1 THEN p.price_tier1 WHEN 2 THEN p.price_tier2 WHEN 3 THEN p.price_tier3 END;
  IF price IS NOT NULL AND _customer_id IS NOT NULL THEN
    custom := public.active_custom_price(_customer_id, _product_id);
    IF custom IS NOT NULL THEN
      price := custom;
    END IF;
  END IF;
  IF price IS NOT NULL AND public.sale_is_active(p.sale_price, p.sale_starts_at, p.sale_ends_at) THEN
    price := LEAST(price, p.sale_price);
  END IF;
  RETURN round(COALESCE(price, 0), 2);
END $$;

REVOKE ALL ON FUNCTION public.pos_unit_price(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_unit_price(uuid, uuid, uuid) TO authenticated, service_role;

-- יצירת הזמנה בקופה (זהה לחלק 32, עם שלושה שינויים):
--   • ההרשאה: staff_can('pos') — בעלים, מנהל או קופאי.
--   • SECURITY DEFINER: לקופאי אין הרשאת כתיבה ישירה להזמנות (וגם לא
--     קריאה — הוא לא רואה הזמנות והכנסות). כל שאילתה כאן מסוננת במפורש
--     לחנות של האתר, והטריגרים של ההזמנה רצים כרגיל.
--   • kobi.pos_actor — הקופאי נחשב "צוות" בטריגרים של ההזמנה הזו בלבד.
CREATE OR REPLACE FUNCTION public.admin_create_order(
  _customer_id uuid,
  _items jsonb,
  _details jsonb
)
RETURNS TABLE(id uuid, order_number text, total numeric, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
  _me uuid := auth.uid();
  d jsonb := COALESCE(_details, '{}'::jsonb);
  _fulfillment text := COALESCE(NULLIF(btrim(COALESCE(_details ->> 'fulfillment', '')), ''), 'in_store');
  _method uuid := public.uuid_or_null(_details ->> 'shipping_method_id');
  _method_kind text;
  _shipping_kind text;
  _has_physical boolean;
  _member RECORD;
  _profile RECORD;
  _name text;
  _phone text;
  _email text;
  _city text;
  _address text;
  _zip text;
  _note text;
  _pay text := COALESCE(NULLIF(btrim(COALESCE(_details ->> 'payment_method', '')), ''), 'cash');
  _paid boolean := lower(COALESCE(_details ->> 'paid', 'true')) IN ('true', 't', '1', 'yes');
  _disc_type text := NULLIF(btrim(COALESCE(_details #>> '{discount,type}', '')), '');
  _disc_raw text := btrim(COALESCE(_details #>> '{discount,value}', ''));
  _disc_value numeric;
  line jsonb;
  p RECORD;
  _variant uuid;
  _attrs text;
  _created_id uuid;
BEGIN
  IF _me IS NULL OR NOT public.staff_can('pos', _me) THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה לקופה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF jsonb_typeof(d) <> 'object' THEN
    RAISE EXCEPTION 'פרטי ההזמנה אינם תקינים' USING ERRCODE = 'check_violation';
  END IF;
  -- מכאן: העובד בקופה נחשב "צוות" בטריגרים של ההזמנה (עד סוף הטרנזקציה)
  PERFORM set_config('kobi.pos_actor', _me::text, true);

  -- ---------- השורות ----------
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'הוסיפו לפחות מוצר אחד להזמנה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(_items) > 200 THEN
    RAISE EXCEPTION 'יותר מדי שורות בהזמנה אחת (עד 200)' USING ERRCODE = 'check_violation';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    IF jsonb_typeof(line) <> 'object' OR public.uuid_or_null(line ->> 'product_id') IS NULL THEN
      RAISE EXCEPTION 'שורה לא תקינה בהזמנה — רעננו את המסך ונסו שוב'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT gp.name, gp.variant_attributes INTO p
      FROM public.global_products gp
     WHERE gp.id = public.uuid_or_null(line ->> 'product_id') AND gp.tenant_id = _tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'אחד המוצרים כבר לא קיים בקטלוג — רעננו את המסך'
        USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(line ->> 'quantity', '') !~ '^[0-9]{1,5}$'
       OR (line ->> 'quantity')::integer < 1 THEN
      RAISE EXCEPTION 'כמות לא תקינה עבור "%" (1–99,999)', p.name USING ERRCODE = 'check_violation';
    END IF;
    IF line ->> 'unit_price' IS NOT NULL
       AND (btrim(line ->> 'unit_price') !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$') THEN
      RAISE EXCEPTION 'המחיר של "%" אינו תקין', p.name USING ERRCODE = 'check_violation';
    END IF;
    _variant := public.uuid_or_null(line ->> 'variant_id');
    IF _variant IS NULL AND EXISTS (
         SELECT 1 FROM public.product_variants v
          WHERE v.product_id = public.uuid_or_null(line ->> 'product_id')
            AND v.tenant_id = _tenant AND v.is_active) THEN
      SELECT string_agg(a ->> 'name', ' / ') INTO _attrs
        FROM jsonb_array_elements(COALESCE(p.variant_attributes, '[]'::jsonb)) a;
      RAISE EXCEPTION 'יש לבחור % עבור "%"', COALESCE(_attrs, 'אפשרות'), p.name
        USING ERRCODE = 'check_violation';
    END IF;
    IF _variant IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.product_variants v
          WHERE v.id = _variant AND v.product_id = public.uuid_or_null(line ->> 'product_id')
            AND v.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'האפשרות שנבחרה עבור "%" כבר לא קיימת — רעננו את המסך', p.name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- ---------- הלקוח ----------
  IF _customer_id IS NOT NULL THEN
    SELECT ur.email, ur.is_blocked, ur.role INTO _member
      FROM public.user_roles ur
     WHERE ur.user_id = _customer_id AND ur.tenant_id = _tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'הלקוח לא נמצא בחנות — חפשו אותו שוב' USING ERRCODE = 'check_violation';
    END IF;
    IF _member.is_blocked THEN
      RAISE EXCEPTION 'החשבון של הלקוח חסום — לא ניתן לפתוח לו הזמנה'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT cp.business_name, cp.phone, cp.city, cp.business_address, cp.zip_code INTO _profile
      FROM public.customer_profiles cp
     WHERE cp.user_id = _customer_id AND cp.tenant_id = _tenant;
  END IF;

  _name := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'customer_name', ''), '\s+', ' ', 'g')), '');
  IF _name IS NULL AND _customer_id IS NOT NULL THEN
    _name := NULLIF(btrim(COALESCE(_profile.business_name, '')), '');
  END IF;
  IF _name IS NULL AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'נא להזין את שם הלקוח' USING ERRCODE = 'check_violation';
  END IF;
  IF _name IS NOT NULL AND char_length(_name) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'שם הלקוח: בין 2 ל-120 תווים' USING ERRCODE = 'check_violation';
  END IF;

  _phone := NULLIF(regexp_replace(COALESCE(d ->> 'customer_phone', ''), '[^0-9+]', '', 'g'), '');
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'מספר הטלפון אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _phone IS NULL AND _customer_id IS NOT NULL THEN
    -- מהפרופיל — רק אם הוא בפורמט שהמסד מקבל (אחרת בלי טלפון בהזמנה)
    _phone := NULLIF(regexp_replace(COALESCE(_profile.phone, ''), '[^0-9+]', '', 'g'), '');
    IF _phone !~ '^\+?[0-9]{9,15}$' THEN
      _phone := NULL;
    END IF;
  END IF;
  IF _phone IS NULL AND _customer_id IS NULL THEN
    RAISE EXCEPTION 'נא להזין מספר טלפון נייד של הלקוח' USING ERRCODE = 'check_violation';
  END IF;

  _email := NULLIF(lower(btrim(COALESCE(d ->> 'customer_email', ''))), '');
  IF _email IS NOT NULL AND (char_length(_email) > 254
     OR _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
    RAISE EXCEPTION 'כתובת האימייל אינה תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF _email IS NULL AND _customer_id IS NOT NULL THEN
    _email := NULLIF(lower(btrim(COALESCE(_member.email, ''))), '');
    IF _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      _email := NULL;
    END IF;
  END IF;

  _city := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'city', ''), '\s+', ' ', 'g')), '');
  _address := NULLIF(btrim(regexp_replace(COALESCE(d ->> 'address', ''), '\s+', ' ', 'g')), '');
  _zip := NULLIF(regexp_replace(COALESCE(d ->> 'zip', ''), '\D', '', 'g'), '');
  IF _city IS NOT NULL AND char_length(_city) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'שם העיר: בין 2 ל-80 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _address IS NOT NULL AND char_length(_address) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'הכתובת: בין 2 ל-200 תווים' USING ERRCODE = 'check_violation';
  END IF;
  IF _zip IS NOT NULL AND _zip !~ '^[0-9]{5,7}$' THEN
    RAISE EXCEPTION 'מיקוד לא תקין (5 או 7 ספרות) — או השאירו ריק' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- מסירה / משלוח ----------
  IF _fulfillment NOT IN ('in_store', 'shipping') THEN
    RAISE EXCEPTION 'אופן המסירה אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(_items) AS x
      JOIN public.global_products gp
        ON gp.tenant_id = _tenant AND gp.id = public.uuid_or_null(x ->> 'product_id')
     WHERE NOT gp.is_digital
  ) INTO _has_physical;

  IF _fulfillment = 'shipping' THEN
    IF _method IS NULL THEN
      RAISE EXCEPTION 'נא לבחור שיטת משלוח' USING ERRCODE = 'check_violation';
    END IF;
    SELECT m.kind INTO _method_kind
      FROM public.shipping_methods m
     WHERE m.id = _method AND m.tenant_id = _tenant AND m.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'שיטת המשלוח שנבחרה אינה זמינה עוד — בחרו שיטה אחרת'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _method_kind = 'delivery' THEN
      -- לקוח רשום בלי כתובת בטופס — הכתובת השמורה בפרופיל שלו
      IF _city IS NULL AND _address IS NULL AND _customer_id IS NOT NULL THEN
        _city := NULLIF(btrim(COALESCE(_profile.city, '')), '');
        _address := NULLIF(btrim(COALESCE(_profile.business_address, '')), '');
        _zip := CASE WHEN COALESCE(_profile.zip_code, '') ~ '^[0-9]{5,7}$' THEN _profile.zip_code END;
        IF char_length(_city) NOT BETWEEN 2 AND 80 THEN _city := NULL; END IF;
        IF char_length(_address) NOT BETWEEN 2 AND 200 THEN _address := NULL; END IF;
      END IF;
      IF _city IS NULL OR _address IS NULL THEN
        RAISE EXCEPTION 'למשלוח עד הבית נא להזין עיר וכתובת (רחוב ומספר בית)'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
    _method := NULL;
    _shipping_kind := CASE WHEN NOT _has_physical THEN 'digital' END;
  END IF;

  -- ---------- תשלום ----------
  IF _pay NOT IN ('cash', 'card', 'bit', 'transfer', 'check', 'later') THEN
    RAISE EXCEPTION 'אמצעי התשלום אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  IF _pay = 'later' THEN
    _paid := false;
  END IF;

  -- ---------- הנחה ידנית ----------
  IF _disc_type IS NOT NULL OR _disc_raw <> '' THEN
    IF _disc_type IS NULL OR _disc_type NOT IN ('percent', 'fixed') THEN
      RAISE EXCEPTION 'סוג ההנחה אינו תקין (אחוזים או סכום)' USING ERRCODE = 'check_violation';
    END IF;
    IF _disc_raw !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'סכום ההנחה אינו תקין' USING ERRCODE = 'check_violation';
    END IF;
    _disc_value := _disc_raw::numeric;
    IF _disc_value <= 0 THEN
      _disc_type := NULL;
      _disc_value := NULL;
    ELSIF _disc_type = 'percent' AND _disc_value > 100 THEN
      RAISE EXCEPTION 'הנחה באחוזים — עד 100%%' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  _note := NULLIF(btrim(COALESCE(d ->> 'note', '')), '');
  IF char_length(_note) > 1000 THEN
    RAISE EXCEPTION 'ההערה ארוכה מדי (עד 1000 תווים)' USING ERRCODE = 'check_violation';
  END IF;

  -- ---------- ההזמנה ----------
  INSERT INTO public.orders AS o (
    customer_id, status, kind, total, note,
    customer_name, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    shipping_method_id, shipping_kind,
    order_source, manual_discount_type, manual_discount_value, pos_payment_method)
  VALUES (
    _customer_id, 'pending', 'order', 0, _note,
    _name, _phone, _email,
    _city, _address, _zip,
    _method, _shipping_kind,
    'pos', _disc_type, _disc_value, _pay)
  RETURNING o.id INTO _created_id;

  -- השורות — ממוינות לפי מוצר ווריאציה (נעילות המלאי תמיד באותו סדר)
  INSERT INTO public.order_items (order_id, product_id, variant_id, quantity, unit_price)
  SELECT _created_id, x.product_id, x.variant_id, x.quantity,
         COALESCE(x.unit_price, public.pos_unit_price(_customer_id, x.product_id, x.variant_id))
    FROM (
      SELECT public.uuid_or_null(e ->> 'product_id') AS product_id,
             public.uuid_or_null(e ->> 'variant_id') AS variant_id,
             (e ->> 'quantity')::integer AS quantity,
             CASE WHEN e ->> 'unit_price' IS NULL THEN NULL
                  ELSE round(btrim(e ->> 'unit_price')::numeric, 2) END AS unit_price
        FROM jsonb_array_elements(_items) AS e
    ) AS x
   ORDER BY x.product_id, x.variant_id NULLS FIRST;

  -- פיקדון למוצרים שיש להם (שורה אחת לכל מוצר — כמו בקופה של האתר)
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
  SELECT _created_id, gp.id, SUM(oi.quantity)::integer, gp.deposit_price * gp.deposit_units, true
    FROM public.order_items oi
    JOIN public.global_products gp ON gp.id = oi.product_id AND gp.tenant_id = oi.tenant_id
   WHERE oi.order_id = _created_id AND NOT oi.is_deposit AND NOT oi.is_gift
     AND gp.has_deposit AND gp.deposit_price IS NOT NULL AND gp.deposit_units IS NOT NULL
   GROUP BY gp.id, gp.deposit_price, gp.deposit_units
   ORDER BY gp.id;

  -- מתנות לפי הטבות החנות (כמו בכל הזמנה)
  PERFORM public.apply_order_gifts(_created_id);

  -- התשלום התקבל בקופה — המסלול הרגיל של שדות התשלום
  IF _paid THEN
    PERFORM set_config('kobi.payment_update', 'on', true);
    UPDATE public.orders AS o
       SET payment_status = 'paid', paid_at = now(), payment_confirmed_by = _me
     WHERE o.id = _created_id;
    PERFORM set_config('kobi.payment_update', 'off', true);
  END IF;

  -- מכירה בחנות: הלקוח כבר קיבל את המוצרים
  IF _fulfillment = 'in_store' THEN
    UPDATE public.orders AS o SET status = 'delivered' WHERE o.id = _created_id;
  END IF;

  PERFORM set_config('kobi.pos_actor', '', true);
  RETURN QUERY
    SELECT o.id, o.order_number, o.total, o.status FROM public.orders AS o WHERE o.id = _created_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_create_order(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_order(uuid, jsonb, jsonb) TO authenticated, service_role;

-- חיפוש לקוח לקופה (זהה לחלק 32) — גם לקופאי
CREATE OR REPLACE FUNCTION public.admin_search_customers(_term text DEFAULT '')
RETURNS TABLE(
  kind text,
  customer_id uuid,
  name text,
  phone text,
  email text,
  city text,
  address text,
  zip text,
  price_tier smallint,
  price_list_type text,
  orders_count integer,
  last_order_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
  _q text := lower(btrim(regexp_replace(COALESCE(_term, ''), '\s+', ' ', 'g')));
  _digits text := regexp_replace(COALESCE(_term, ''), '\D', '', 'g');
  _like text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('pos') THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(_q) > 80 THEN
    _q := left(_q, 80);
  END IF;
  -- +972 50... → 050...
  IF _digits LIKE '972%' AND char_length(_digits) >= 5 THEN
    _digits := '0' || substr(_digits, 4);
  END IF;
  IF char_length(_digits) < 3 THEN
    _digits := NULL;
  END IF;
  _like := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  WITH accounts AS (
    SELECT 'account'::text AS kind,
           ur.user_id AS customer_id,
           COALESCE(NULLIF(btrim(cp.business_name), ''), NULLIF(btrim(ur.display_name), ''),
                    split_part(ur.email, '@', 1)) AS name,
           cp.phone AS phone,
           ur.email AS email,
           cp.city AS city,
           cp.business_address AS address,
           cp.zip_code AS zip,
           public.buyer_price_tier(ur.user_id) AS price_tier,
           COALESCE(cp.price_list_type, 'regular') AS price_list_type,
           (SELECT count(*)::integer FROM public.orders o
             WHERE o.tenant_id = _tenant AND o.customer_id = ur.user_id) AS orders_count,
           (SELECT max(o.created_at) FROM public.orders o
             WHERE o.tenant_id = _tenant AND o.customer_id = ur.user_id) AS last_order_at
      FROM public.user_roles ur
      LEFT JOIN public.customer_profiles cp
             ON cp.user_id = ur.user_id AND cp.tenant_id = ur.tenant_id
     WHERE ur.tenant_id = _tenant
       AND ur.role = 'customer'
       AND NOT ur.is_blocked
       AND (_q = ''
            OR lower(COALESCE(cp.business_name, '')) LIKE _like
            OR lower(COALESCE(cp.contact_name, '')) LIKE _like
            OR lower(COALESCE(ur.display_name, '')) LIKE _like
            OR lower(ur.email) LIKE _like
            OR (_digits IS NOT NULL
                AND regexp_replace(COALESCE(cp.phone, ''), '\D', '', 'g') LIKE '%' || _digits || '%'))
  ),
  guest_orders AS (
    SELECT o.*,
           COALESCE(lower(o.customer_email), o.customer_phone) AS buyer_key
      FROM public.orders o
     WHERE o.tenant_id = _tenant
       AND o.customer_id IS NULL
       AND o.customer_name IS NOT NULL
       -- מי שיש לו חשבון בחנות — מופיע כלקוח רשום
       AND NOT EXISTS (SELECT 1 FROM public.user_roles ur2
                        WHERE ur2.tenant_id = _tenant
                          AND lower(ur2.email) = lower(COALESCE(o.customer_email, '')))
  ),
  guests AS (
    SELECT DISTINCT ON (g.buyer_key)
           'guest'::text AS kind,
           NULL::uuid AS customer_id,
           g.customer_name AS name,
           g.customer_phone AS phone,
           g.customer_email AS email,
           g.billing_city AS city,
           g.billing_address AS address,
           g.billing_zip AS zip,
           1::smallint AS price_tier,
           'regular'::text AS price_list_type,
           (count(*) OVER (PARTITION BY g.buyer_key))::integer AS orders_count,
           max(g.created_at) OVER (PARTITION BY g.buyer_key) AS last_order_at
      FROM guest_orders g
     WHERE g.buyer_key IS NOT NULL
       AND (_q = ''
            OR lower(g.customer_name) LIKE _like
            OR lower(COALESCE(g.customer_email, '')) LIKE _like
            OR (_digits IS NOT NULL
                AND regexp_replace(COALESCE(g.customer_phone, ''), '\D', '', 'g') LIKE '%' || _digits || '%'))
     ORDER BY g.buyer_key, g.created_at DESC
  )
  SELECT r.kind, r.customer_id, r.name, r.phone, r.email, r.city, r.address, r.zip,
         r.price_tier, r.price_list_type, r.orders_count, r.last_order_at
    FROM (SELECT * FROM accounts UNION ALL SELECT * FROM guests) AS r
   ORDER BY r.last_order_at DESC NULLS LAST, r.name
   LIMIT CASE WHEN _q = '' THEN 8 ELSE 20 END;
END $$;

REVOKE ALL ON FUNCTION public.admin_search_customers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_customers(text) TO authenticated, service_role;

-- המחירון האישי של הלקוח שנבחר בקופה
DROP POLICY IF EXISTS "custom prices readable at pos" ON public.user_custom_prices;
CREATE POLICY "custom prices readable at pos" ON public.user_custom_prices
  FOR SELECT TO authenticated
  USING (public.staff_can('pos'));

-- ============================================================
-- 10. הקטלוג לעובדים (קופה ומדבקות): בלי מחיר עלות. כולל מוצרים מוסתרים
--     (אפשר למכור / לתייג מוצר שלא מוצג באתר) והקטגוריות הנוספות.
--     מנהלים רואים את אותו הקטלוג — מסלול אחד לכולם.
-- ============================================================
CREATE OR REPLACE FUNCTION public.staff_product_catalog()
RETURNS TABLE(
  id uuid,
  sku text,
  name text,
  category text,
  barcode text,
  image_url text,
  price_tier1 numeric,
  price_tier2 numeric,
  price_tier3 numeric,
  sale_price numeric,
  sale_starts_at timestamptz,
  sale_ends_at timestamptz,
  stock_quantity integer,
  is_hidden boolean,
  is_digital boolean,
  has_deposit boolean,
  deposit_price numeric,
  deposit_units integer,
  variant_attributes jsonb,
  category_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('products.view') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT gp.id, gp.sku::text, gp.name, gp.category, gp.barcode, gp.image_url,
           gp.price_tier1, gp.price_tier2, gp.price_tier3,
           gp.sale_price, gp.sale_starts_at, gp.sale_ends_at,
           gp.stock_quantity, gp.is_hidden, gp.is_digital,
           gp.has_deposit, gp.deposit_price, gp.deposit_units,
           COALESCE(gp.variant_attributes, '[]'::jsonb),
           COALESCE((SELECT array_agg(pc.category_id ORDER BY pc.category_id)
                       FROM public.product_categories pc
                      WHERE pc.product_id = gp.id AND pc.tenant_id = _tenant), '{}'::uuid[])
      FROM public.global_products gp
     WHERE gp.tenant_id = _tenant
     ORDER BY gp.name, gp.id;
END $$;
REVOKE ALL ON FUNCTION public.staff_product_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_product_catalog() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_product_variants()
RETURNS TABLE(
  id uuid,
  product_id uuid,
  options jsonb,
  sku text,
  price numeric,
  stock_quantity integer,
  is_active boolean,
  sort_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('products.view') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT v.id, v.product_id, v.options, v.sku, v.price, v.stock_quantity, v.is_active, v.sort_order
      FROM public.product_variants v
     WHERE v.tenant_id = _tenant AND v.is_active
     ORDER BY v.product_id, v.sort_order, v.id;
END $$;
REVOKE ALL ON FUNCTION public.staff_product_variants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_product_variants() TO authenticated, service_role;

-- גודל מדבקת הברקוד של החנות — גם המחסנאי שומר (לא כל ההגדרות)
CREATE OR REPLACE FUNCTION public.save_barcode_label_size(_width_mm numeric, _height_mm numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('inventory') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _width_mm IS NULL OR _height_mm IS NULL
     OR _width_mm NOT BETWEEN 30 AND 200 OR _height_mm NOT BETWEEN 20 AND 300 THEN
    RAISE EXCEPTION 'גודל המדבקה: רוחב 30–200 מ"מ, גובה 20–300 מ"מ' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.site_settings
     SET barcode_label_width_mm = round(_width_mm, 1),
         barcode_label_height_mm = round(_height_mm, 1)
   WHERE tenant_id = _tenant;
END $$;
REVOKE ALL ON FUNCTION public.save_barcode_label_size(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_barcode_label_size(numeric, numeric) TO authenticated, service_role;

-- ============================================================
-- 11. המחסנאי: הזמנות למשלוח ועדכון סטטוס — בלי מחירים
-- ============================================================
-- פרטי שילוח: גם המחסנאי (בעדכון סטטוס משלוח) — לא רק צוות המכירות
CREATE OR REPLACE FUNCTION public.orders_tracking_normalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.tracking_number := NULLIF(btrim(NEW.tracking_number), '');
  NEW.shipping_provider := NULLIF(btrim(NEW.shipping_provider), '');
  NEW.tracking_url := NULLIF(btrim(NEW.tracking_url), '');
  IF TG_OP = 'INSERT' THEN
    -- הזמנה חדשה של לקוח לא מגיעה עם פרטי שילוח
    IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
      NEW.tracking_number := NULL; NEW.shipping_provider := NULL; NEW.tracking_url := NULL;
    END IF;
    NEW.tracking_updated_at := CASE WHEN COALESCE(NEW.tracking_number, NEW.shipping_provider, NEW.tracking_url) IS NOT NULL
                                    THEN now() END;
  ELSIF (NEW.tracking_number, NEW.shipping_provider, NEW.tracking_url)
        IS DISTINCT FROM (OLD.tracking_number, OLD.shipping_provider, OLD.tracking_url) THEN
    IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid())
       AND NOT public.staff_can('orders.fulfill', auth.uid()) THEN
      RAISE EXCEPTION 'רק צוות החנות יכול לעדכן פרטי שילוח' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.tracking_updated_at := now();
  ELSE
    NEW.tracking_updated_at := OLD.tracking_updated_at;
  END IF;
  RETURN NEW;
END $$;

-- ההזמנות שבטיפול המחסן: בליקוט, לוקטו, ממתינות לשליח, נשלחו
-- (+ "נמסרו" בשבוע האחרון כשמבקשים). בלי סכומים ומחירים.
CREATE OR REPLACE FUNCTION public.fulfillment_orders(_include_delivered boolean DEFAULT false)
RETURNS TABLE(
  id uuid,
  order_number text,
  created_at timestamptz,
  status text,
  is_urgent boolean,
  customer_name text,
  customer_phone text,
  city text,
  address text,
  zip text,
  shipping_method_name text,
  shipping_kind text,
  tracking_number text,
  shipping_provider text,
  delivery_attempts integer,
  items_count integer,
  units_count integer,
  order_source text,
  note text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('orders.fulfill') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.created_at, o.status, o.is_urgent,
           COALESCE(NULLIF(btrim(CASE WHEN o.ship_to_different THEN o.shipping_name END), ''),
                    NULLIF(btrim(o.customer_name), ''),
                    NULLIF(btrim(cp.business_name), ''),
                    NULLIF(btrim(ur.display_name), ''),
                    split_part(COALESCE(ur.email, ''), '@', 1)),
           COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_phone END, o.customer_phone, cp.phone),
           COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_city END, o.billing_city, cp.city),
           COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_address END, o.billing_address,
                    cp.business_address),
           COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_zip END, o.billing_zip, cp.zip_code),
           o.shipping_method_name, o.shipping_kind,
           o.tracking_number, o.shipping_provider, o.delivery_attempts,
           (SELECT count(*)::integer FROM public.order_items oi
             WHERE oi.order_id = o.id AND NOT oi.is_deposit),
           (SELECT COALESCE(sum(oi.quantity), 0)::integer FROM public.order_items oi
             WHERE oi.order_id = o.id AND NOT oi.is_deposit),
           o.order_source, o.note, o.updated_at
      FROM public.orders o
      LEFT JOIN public.user_roles ur ON ur.tenant_id = o.tenant_id AND ur.user_id = o.customer_id
      LEFT JOIN public.customer_profiles cp ON cp.tenant_id = o.tenant_id AND cp.user_id = o.customer_id
     WHERE o.tenant_id = _tenant
       AND o.kind = 'order'
       AND (o.status IN ('picking', 'picked', 'awaiting_courier', 'shipped')
            OR (_include_delivered AND o.status = 'delivered'
                AND COALESCE(o.delivered_at, o.updated_at) > now() - interval '7 days'))
     ORDER BY CASE o.status
                WHEN 'awaiting_courier' THEN 1 WHEN 'picked' THEN 2 WHEN 'picking' THEN 3
                WHEN 'shipped' THEN 4 ELSE 5 END,
              o.is_urgent DESC, o.created_at
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.fulfillment_orders(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fulfillment_orders(boolean) TO authenticated, service_role;

-- עדכון סטטוס משלוח (ומספר מעקב). המעברים:
--   ממתינה לשליח → נשלחה, נשלחה → נמסרה ללקוח,
--   וביטול טעות: נשלחה → ממתינה לשליח, נמסרה → נשלחה.
-- הליקוט עצמו — במסך הליקוט (picking_*), ואישור ליקוט — מנהל.
-- מחזיר את הסטטוס החדש, ו-notify=true כשנשלח מייל "יצאה למשלוח".
CREATE OR REPLACE FUNCTION public.fulfillment_set_status(
  _order_id uuid,
  _status text,
  _tracking_number text DEFAULT NULL,
  _shipping_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  o RECORD;
  _tracking text := NULLIF(btrim(COALESCE(_tracking_number, '')), '');
  _provider text := NULLIF(btrim(COALESCE(_shipping_provider, '')), '');
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('orders.fulfill') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(_tracking) > 100 OR char_length(_provider) > 60 THEN
    RAISE EXCEPTION 'פרטי המשלוח ארוכים מדי' USING ERRCODE = 'check_violation';
  END IF;

  SELECT o2.id, o2.status, o2.kind, o2.order_number INTO o
    FROM public.orders o2
   WHERE o2.id = _order_id AND o2.tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND OR o.kind <> 'order' THEN
    RAISE EXCEPTION 'ההזמנה לא נמצאה' USING ERRCODE = 'check_violation';
  END IF;

  IF _status = o.status THEN
    -- רק עדכון פרטי השילוח
    IF o.status NOT IN ('awaiting_courier', 'shipped') THEN
      RAISE EXCEPTION 'אפשר לעדכן מספר מעקב רק להזמנה שממתינה לשליח או שנשלחה'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT ((o.status = 'awaiting_courier' AND _status = 'shipped')
          OR (o.status = 'shipped' AND _status IN ('delivered', 'awaiting_courier'))
          OR (o.status = 'delivered' AND _status = 'shipped')) THEN
    RAISE EXCEPTION 'אי אפשר להעביר את ההזמנה % מ"%" ל"%"', o.order_number,
      CASE o.status WHEN 'pending' THEN 'התקבלה' WHEN 'agent_review' THEN 'בטיפול סוכן'
                    WHEN 'picking' THEN 'בליקוט' WHEN 'picked' THEN 'לוקטה'
                    WHEN 'awaiting_courier' THEN 'ממתינה לשליח' WHEN 'shipped' THEN 'נשלחה'
                    WHEN 'delivered' THEN 'נמסרה' WHEN 'cancelled' THEN 'בוטלה' ELSE o.status END,
      CASE _status WHEN 'awaiting_courier' THEN 'ממתינה לשליח' WHEN 'shipped' THEN 'נשלחה'
                   WHEN 'delivered' THEN 'נמסרה' ELSE COALESCE(_status, '') END
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.orders AS u
     SET status = _status,
         tracking_number = CASE WHEN _tracking_number IS NULL THEN u.tracking_number ELSE _tracking END,
         shipping_provider = CASE WHEN _shipping_provider IS NULL THEN u.shipping_provider ELSE _provider END
   WHERE u.id = o.id;

  RETURN jsonb_build_object(
    'order_number', o.order_number,
    'status', _status,
    'notify', o.status = 'awaiting_courier' AND _status = 'shipped');
END $$;
REVOKE ALL ON FUNCTION public.fulfillment_set_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fulfillment_set_status(uuid, text, text, text) TO authenticated, service_role;

COMMIT;

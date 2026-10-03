-- ============================================================
-- חלק 6: מנהל-על בכל החנויות (God Mode), מחירון פתוח לכולם,
-- קופה עם כתובת חלופית והזמנת אורח, ופרטי כתובת בפרופיל הלקוח.
--
-- 1. God Mode: מי שרשום ב-platform_admins הוא מנהל מלא בכל חנות —
--    בלי שורה בטבלת הצוות (user_roles) של אותה חנות. החנות נקבעת לפי
--    ה-x-tenant-id של הבקשה (הדומיין שממנו הגיע). עמודות "מי ביצע"
--    שמפנות לצוות החנות מקבלות NULL כשהפעולה נעשית ע"י מנהל-על.
-- 2. מחירון פתוח: אורחים, לקוחות שעוד לא אושרו ולקוחות בלי קבוצת מחיר
--    רואים ומזמינים לפי המחירון הרגיל (דרג 1). לקוח מאושר עם דרג משויך
--    ממשיך לקבל את המחירון שלו. טבלת המוצרים עצמה נשארת סגורה (יש בה
--    מחיר עלות, מלאי ואיתורים) — הקטלוג הציבורי נקרא דרך get_catalog,
--    שמחזיר רק עמודות ללקוח, רק של החנות הנוכחית.
-- 3. קופה: פרטי חיוב (שם / חברה, ת.ז / ח.פ, טלפון, אימייל, עיר, כתובת,
--    מיקוד), הערות, ו"משלוח לכתובת אחרת" — נשמרים על ההזמנה עצמה, וזה
--    מה שהמנהל רואה. הזמנת אורח (בלי חשבון) נוצרת רק דרך השרת
--    (place_guest_order, service_role בלבד), עם הגבלת קצב ובדיקת כל השדות.
-- 4. פרופיל הלקוח: עיר ומיקוד (ברירת המחדל בקופה, נערכים באזור האישי).
--
-- המיגרציה ניתנת להרצה חוזרת.
-- ============================================================

-- ------------------------------------------------------------
-- 1. God Mode
-- ------------------------------------------------------------

-- החנות של הבקשה. משתמש שמשויך לחנות נשאר בחנות שלו; header של חנות אחרת
-- = אין גישה לשום דבר — חוץ ממנהל-על, שעובד בחנות שה-header מצביע עליה.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
  --    מנהל-על (platform_admins) הוא החריג: הוא מנהל את כל החנויות.
  IF _uid IS NOT NULL THEN
    SELECT ur.tenant_id INTO _tid FROM public.user_roles ur WHERE ur.user_id = _uid;
    IF FOUND THEN
      IF _hdr IS NULL OR _hdr = _tid::text THEN
        RETURN _tid;
      END IF;
      IF NOT public.is_platform_admin(_uid) THEN
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  -- ב. header מפורש (אורח, נרשם חדש, מנהל-על, שרת עם service_role)
  IF _hdr IS NOT NULL THEN
    _tid := NULL;
    IF _hdr ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT t.id INTO _tid FROM public.tenants t WHERE t.id = _hdr::uuid;
    END IF;
    RETURN _tid;
  END IF;
  -- ג. גשר תאימות: חנות ברירת המחדל (אם מוגדרת)
  SELECT t.id INTO _tid FROM public.tenants t WHERE t.is_default;
  RETURN _tid;
END $$;

-- מנהל החנות הנוכחית: מנהל שרשום בצוות שלה, או מנהל-על (בכל חנות שזוהתה).
-- is_admin / is_staff / can_pick וכל מדיניות ה-RLS נשענים על הפונקציה הזו.
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND role = 'admin' AND NOT is_blocked
                    AND tenant_id = public.current_tenant_id())
      OR (public.is_platform_admin(_user_id) AND public.current_tenant_id() IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = _user_id AND is_approved = true
                    AND tenant_id = public.current_tenant_id())
      OR (public.is_platform_admin(_user_id) AND public.current_tenant_id() IS NOT NULL);
$$;

-- המשתמש אם הוא רשום בצוות / בלקוחות של החנות הנוכחית, אחרת NULL.
-- עמודות כמו "נוצר ע"י" מפנות ל-user_roles של החנות (מפתח זר) — מנהל-על
-- שאינו רשום בחנות נרשם בהן כ-NULL במקום שהפעולה תיכשל.
CREATE OR REPLACE FUNCTION public.tenant_member_id(_user_id uuid DEFAULT auth.uid())
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id FROM public.user_roles ur
   WHERE ur.user_id = _user_id AND ur.tenant_id = public.current_tenant_id();
$$;

REVOKE ALL ON FUNCTION public.tenant_member_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_member_id(uuid) TO authenticated, service_role;

ALTER TABLE public.product_drafts ALTER COLUMN created_by SET DEFAULT public.tenant_member_id();
ALTER TABLE public.stock_counts ALTER COLUMN created_by SET DEFAULT public.tenant_member_id();
ALTER TABLE public.stock_count_lines ALTER COLUMN counted_by SET DEFAULT public.tenant_member_id();
-- העברה שפתח מנהל-על (שאינו בצוות החנות) נשמרת בלי "נוצרה ע"י"
ALTER TABLE public.location_transfers ALTER COLUMN created_by DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_stock_count(_count_id uuid)
 RETURNS TABLE(counted integer, changed integer, marked_out_of_stock integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     SET status = 'applied', applied_by = public.tenant_member_id(), applied_at = now()
   WHERE id = _count_id;

  PERFORM set_config('kobi.stock_internal', 'off', true);
  RETURN QUERY SELECT n_counted, n_changed, n_marked;
END $function$;

CREATE OR REPLACE FUNCTION public.transfer_create(_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id UUID;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה להעברות' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.location_transfers (tenant_id, created_by, note)
  VALUES (_tenant, public.tenant_member_id(), NULLIF(btrim(COALESCE(_note, '')), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END $function$;

CREATE OR REPLACE FUNCTION public.transfer_approve(_transfer_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  UPDATE public.location_transfers SET status = 'approved', approved_by = public.tenant_member_id(), approved_at = now(), updated_at = now()
   WHERE id = _transfer_id;
  RETURN n;
END $function$;

CREATE OR REPLACE FUNCTION public.picking_claim(_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders;
  _tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.can_pick(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לליקוט' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- מנהל-על שאינו בצוות החנות רואה ומאשר, אבל לא לוקח הזמנה לליקוט בעצמו
  IF public.tenant_member_id() IS NULL THEN
    RAISE EXCEPTION 'ליקוט מתבצע ע"י עובדי החנות — מנהל-על יכול לצפות ולאשר, אבל לא לקחת הזמנה לליקוט'
      USING ERRCODE = 'insufficient_privilege';
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
END $function$;

CREATE OR REPLACE FUNCTION public.picking_manager_approve(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  UPDATE public.orders SET status = 'shipped', picking_approved_by = public.tenant_member_id() WHERE id = _order_id;
  SELECT details -> 'shortages' INTO shortages FROM public.picking_events
   WHERE order_id = _order_id AND action = 'approve' ORDER BY created_at DESC LIMIT 1;
  PERFORM public.picking_log(_order_id, 'manager_approve');
  RETURN jsonb_build_object('shortages', COALESCE(shortages, '[]'::jsonb), 'status', 'shipped');
END $function$;

CREATE OR REPLACE FUNCTION public.picking_approve(_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o public.orders := public.picking_assert_order(_order_id);
  unpicked INTEGER;
  shortages JSONB := '[]'::jsonb;
  r RECORD;
  dep RECORD;
  by_admin BOOLEAN := public.is_admin(auth.uid());
  final_status TEXT;
BEGIN
  IF o.picker_id IS NULL AND NOT by_admin THEN
    RAISE EXCEPTION 'ההזמנה לא נלקחה לליקוט';
  END IF;
  SELECT count(*) INTO unpicked FROM public.order_items WHERE order_id = _order_id AND NOT is_deposit AND NOT picked;
  IF unpicked > 0 THEN
    RAISE EXCEPTION 'יש % שורות שעוד לא סומנו', unpicked;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE order_id = _order_id AND NOT is_deposit AND picked_qty > 0) THEN
    RAISE EXCEPTION 'לא לוקט אף פריט — אם ההזמנה לא יוצאת, בטלו אותה בניהול ההזמנות';
  END IF;

  FOR r IN
    SELECT oi.id, oi.product_id, oi.quantity, oi.picked_qty, gp.name
      FROM public.order_items oi
      LEFT JOIN public.global_products gp ON gp.id = oi.product_id
     WHERE oi.order_id = _order_id AND NOT oi.is_deposit AND oi.picked_qty < oi.quantity
  LOOP
    shortages := shortages || jsonb_build_object(
      'product_id', r.product_id, 'name', r.name, 'ordered', r.quantity, 'picked', r.picked_qty);
    FOR dep IN SELECT id, quantity FROM public.order_items WHERE order_id = _order_id AND is_deposit AND product_id = r.product_id LOOP
      IF r.picked_qty = 0 THEN
        DELETE FROM public.order_items WHERE id = dep.id;
      ELSE
        UPDATE public.order_items
           SET quantity = GREATEST(1, round(dep.quantity::numeric * r.picked_qty / r.quantity)::integer)
         WHERE id = dep.id;
      END IF;
    END LOOP;
    IF r.picked_qty = 0 THEN
      DELETE FROM public.order_items WHERE id = r.id;
    ELSE
      UPDATE public.order_items SET quantity = r.picked_qty WHERE id = r.id;
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
END; $function$;

CREATE OR REPLACE FUNCTION public.guard_stock_count_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('kobi.stock_internal', true) = 'on' THEN
    RETURN NEW;
  END IF;
  NEW.recorded_before := NULL;
  NEW.reserved_open := NULL;
  NEW.applied_quantity := NULL;
  NEW.counted_at := now();
  -- מי ספר אחרון את המוצר הזה
  NEW.counted_by := CASE WHEN auth.uid() IS NULL THEN NEW.counted_by
                        ELSE public.tenant_member_id() END;
  RETURN NEW;
END; $function$;

-- התפקיד של המשתמש המחובר בחנות הנוכחית — עבור הממשק (useAuthState).
-- חבר צוות / לקוח: השורה שלו. מנהל-על שאינו רשום בחנות: "מנהל" מלא,
-- בלי ליצור לו שורה בצוות של החנות (is_member = false).
CREATE OR REPLACE FUNCTION public.my_store_role()
RETURNS TABLE(user_id uuid, email text, username text, role text, is_approved boolean,
              is_blocked boolean, must_change_password boolean,
              is_platform_admin boolean, is_member boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
           ur.must_change_password, _platform, true
      FROM public.user_roles ur
     WHERE ur.user_id = _uid AND ur.tenant_id = _tenant;
  IF FOUND OR NOT _platform THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT u.id, COALESCE(u.email, '')::text,
           COALESCE(NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''), 'platform')::text,
           'admin'::text, true, false, false, true, false
      FROM auth.users u
     WHERE u.id = _uid;
END $$;

REVOKE ALL ON FUNCTION public.my_store_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_store_role() TO authenticated;

-- כניסה מפאנל הפלטפורמה לניהול חנות ("היכנס לניהול"): קוד חד-פעמי קצר
-- מועד, צמוד לחנות אחת. נשמר רק ה-hash. גישה: service_role בלבד (השרת).
CREATE TABLE IF NOT EXISTS public.platform_admin_handoffs (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS platform_admin_handoffs_expires_idx
  ON public.platform_admin_handoffs (expires_at);
ALTER TABLE public.platform_admin_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.platform_admin_handoffs;
CREATE POLICY tenant_isolation ON public.platform_admin_handoffs AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
REVOKE ALL ON public.platform_admin_handoffs FROM anon, authenticated;
GRANT ALL ON public.platform_admin_handoffs TO service_role;

-- ------------------------------------------------------------
-- 2. מחירון פתוח לכולם
-- ------------------------------------------------------------

-- הדרג שלפיו קונה מסוים רואה ומזמין: לקוח מאושר ולא חסום עם דרג משויך —
-- הדרג שלו; כל השאר (אורח, ממתין לאישור, בלי דרג, צוות) — המחירון הרגיל (1).
CREATE OR REPLACE FUNCTION public.buyer_price_tier(_user_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT cp.price_tier
      FROM public.customer_profiles cp
      JOIN public.user_roles ur ON ur.user_id = cp.user_id
     WHERE cp.user_id = _user_id
       AND ur.is_approved AND NOT ur.is_blocked
       AND cp.price_tier IN (1, 2, 3)
  ), 1)::smallint;
$$;

REVOKE ALL ON FUNCTION public.buyer_price_tier(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buyer_price_tier(uuid) TO service_role;

-- "יש מחירים" — מעכשיו לכל מי שאינו חסום
CREATE OR REPLACE FUNCTION public.customer_has_prices(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles ur
                      WHERE ur.user_id = _user_id AND ur.is_blocked);
$$;

CREATE OR REPLACE FUNCTION public.get_catalog()
 RETURNS TABLE(id uuid, sku character varying, name text, category text, description text, image_url text, images text[], colors text[], barcode text, is_promo boolean, is_out_of_stock boolean, price numeric, original_price numeric, sale_ends_at timestamp with time zone, created_at timestamp with time zone, has_deposit boolean, deposit_price numeric, deposit_units integer, pack_size integer, min_order_quantity integer, is_custom_price boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_order_item_product()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  product_found BOOLEAN := false;
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
    ELSIF gift THEN
      NEW.product_name := COALESCE(NULLIF(btrim(COALESCE(NEW.product_name, '')), ''), p.name || ' (מתנה)');
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
    NEW.product_name := CASE WHEN NEW.is_deposit THEN 'פיקדון – ' || p.name
                             WHEN gift THEN p.name || ' (מתנה)'
                             ELSE p.name END;
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
END $function$;

-- הזמנה חדשה של לקוח / אורח נכנסת תמיד בתחילת הזרימה. אין יותר "בקשת
-- הצעת מחיר בכפייה" ללקוח בלי דרג, ואין חסימה על פרופיל לא מלא — פרטי
-- החיוב והמשלוח מגיעים עם ההזמנה עצמה מהקופה.
CREATE OR REPLACE FUNCTION public.enforce_order_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    NEW.status := 'pending';
    NEW.total := 0;
  END IF;
  IF NEW.kind NOT IN ('order', 'quote') THEN
    NEW.kind := 'order';
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------
-- 3. קופה: פרטי חיוב ומשלוח על ההזמנה, והזמנת אורח
-- ------------------------------------------------------------

ALTER TABLE public.orders ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS billing_zip TEXT,
  ADD COLUMN IF NOT EXISTS ship_to_different BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping_name TEXT,
  ADD COLUMN IF NOT EXISTS shipping_phone TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_zip TEXT,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.customer_id IS
  'הלקוח הרשום. NULL = הזמנת אורח (הפרטים בעמודות customer_* / billing_*)';
COMMENT ON COLUMN public.orders.ship_to_different IS
  'true = המשלוח לכתובת שבעמודות shipping_* (ולא לכתובת החיוב)';

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_checkout_fields_check CHECK (
        (customer_name IS NULL OR length(btrim(customer_name)) BETWEEN 2 AND 120)
    AND (customer_tax_id IS NULL OR customer_tax_id ~ '^[0-9]{5,12}$')
    AND (customer_phone IS NULL OR customer_phone ~ '^\+?[0-9]{9,15}$')
    AND (customer_email IS NULL OR (length(customer_email) <= 254
         AND customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    AND (billing_city IS NULL OR length(btrim(billing_city)) BETWEEN 2 AND 80)
    AND (billing_address IS NULL OR length(btrim(billing_address)) BETWEEN 2 AND 200)
    AND (billing_zip IS NULL OR billing_zip ~ '^[0-9]{5,7}$')
    AND (shipping_name IS NULL OR length(btrim(shipping_name)) BETWEEN 2 AND 120)
    AND (shipping_phone IS NULL OR shipping_phone ~ '^\+?[0-9]{9,15}$')
    AND (shipping_city IS NULL OR length(btrim(shipping_city)) BETWEEN 2 AND 80)
    AND (shipping_address IS NULL OR length(btrim(shipping_address)) BETWEEN 2 AND 200)
    AND (shipping_zip IS NULL OR shipping_zip ~ '^[0-9]{5,7}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- הזמנת אורח (בלי חשבון) חייבת לשאת את כל פרטי הקשר והחיוב שלה
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_guest_details_check CHECK (
    customer_id IS NOT NULL
    OR (customer_name IS NOT NULL AND customer_tax_id IS NOT NULL
        AND customer_phone IS NOT NULL AND customer_email IS NOT NULL
        AND billing_city IS NOT NULL AND billing_address IS NOT NULL
        AND billing_zip IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- "שלח לכתובת אחרת": הכתובת החלופית מלאה
DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_shipping_details_check CHECK (
    NOT ship_to_different
    OR (shipping_name IS NOT NULL AND shipping_city IS NOT NULL
        AND shipping_address IS NOT NULL AND shipping_zip IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS orders_guest_idx
  ON public.orders (tenant_id, created_at DESC) WHERE customer_id IS NULL;

-- בדיקה ונרמול של טופס הקופה (הודעות שגיאה בעברית, לתצוגה ללקוח).
-- טלפון / ת.ז / מיקוד נשמרים כספרות בלבד; אימייל באותיות קטנות.
CREATE OR REPLACE FUNCTION public.normalize_checkout_details(_details jsonb, _guest boolean)
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

  v_city := btrim(COALESCE(_details ->> 'billing_city', ''));
  IF length(v_city) < 2 OR length(v_city) > 80 THEN
    RAISE EXCEPTION 'נא להזין עיר' USING ERRCODE = 'check_violation';
  END IF;
  v_address := btrim(COALESCE(_details ->> 'billing_address', ''));
  IF length(v_address) < 2 OR length(v_address) > 200 THEN
    RAISE EXCEPTION 'נא להזין כתובת (רחוב ומספר בית)' USING ERRCODE = 'check_violation';
  END IF;
  v_zip := regexp_replace(COALESCE(_details ->> 'billing_zip', ''), '\D', '', 'g');
  IF v_zip !~ '^[0-9]{5,7}$' THEN
    RAISE EXCEPTION 'נא להזין מיקוד תקין (5 או 7 ספרות)' USING ERRCODE = 'check_violation';
  END IF;

  v_ship := COALESCE(_details ->> 'ship_to_different', 'false') = 'true';
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

-- המתנות עצמן (בלי בדיקת הרשאה) — נקרא רק מתוך פונקציות אחרות במסד:
-- apply_order_gifts (אחרי בדיקת הרשאה) ו-place_guest_order.
CREATE OR REPLACE FUNCTION public.apply_order_gifts_internal(_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  o RECORD;
  r RECORD;
  _subtotal NUMERIC;
  _units INTEGER;
  _added INTEGER := 0;
BEGIN
  SELECT id, tenant_id, customer_id, kind, status INTO o
    FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- מתנות רק בהזמנה עם מחירים (לא בבקשת הצעת מחיר), ורק לפני שטופלה
  IF o.kind <> 'order' OR o.status <> 'pending' THEN
    RETURN 0;
  END IF;

  -- סכום המוצרים (בלי פיקדונות ובלי מתנות) — אותו בסיס שמוצג ללקוח בסל
  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0) INTO _subtotal
    FROM public.order_items oi
   WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_gift;

  FOR r IN
    SELECT cp.*
      FROM public.cart_promotions cp
     WHERE cp.tenant_id = o.tenant_id
       AND cp.is_active
       AND (cp.starts_at IS NULL OR cp.starts_at <= now())
       AND (cp.ends_at IS NULL OR cp.ends_at > now())
     ORDER BY cp.sort_order, cp.created_at
  LOOP
    -- כבר קיבל את המתנה של ההטבה הזו
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.order_items oi
                           WHERE oi.order_id = o.id AND oi.promotion_id = r.id);

    IF r.condition_type = 'min_subtotal' THEN
      CONTINUE WHEN _subtotal < r.min_subtotal;
    ELSE
      -- יחידות מהקטגוריה ומכל תתי-הקטגוריות שלה
      WITH RECURSIVE subtree(name) AS (
        SELECT r.category
        UNION
        SELECT c.name FROM public.categories c
          JOIN subtree s ON c.parent_name = s.name
         WHERE c.tenant_id = o.tenant_id
      )
      SELECT COALESCE(SUM(oi.quantity), 0) INTO _units
        FROM public.order_items oi
        JOIN public.global_products gp ON gp.tenant_id = oi.tenant_id AND gp.id = oi.product_id
       WHERE oi.order_id = o.id AND NOT oi.is_deposit AND NOT oi.is_gift
         AND gp.category IN (SELECT name FROM subtree);
      CONTINUE WHEN _units < r.min_quantity;
    END IF;

    -- מוצר המתנה חייב להיות זמין (לא מוסתר ולא אזל)
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.global_products gp
                               WHERE gp.tenant_id = o.tenant_id AND gp.id = r.gift_product_id
                                 AND NOT gp.is_hidden AND NOT gp.is_out_of_stock);

    PERFORM set_config('app.order_gifts', 'on', true);
    BEGIN
      INSERT INTO public.order_items
             (tenant_id, order_id, product_id, quantity, unit_price, is_gift, promotion_id)
      VALUES (o.tenant_id, o.id, r.gift_product_id, r.gift_quantity, 0, true, r.id);
      _added := _added + 1;
    EXCEPTION WHEN OTHERS THEN
      -- מתנה שלא ניתן לצרף (למשל לא נשאר מספיק במלאי) לא מפילה את ההזמנה
      RAISE WARNING 'apply_order_gifts: הטבה % לא צורפה להזמנה %: %', r.id, o.id, SQLERRM;
    END;
    PERFORM set_config('app.order_gifts', 'off', true);
  END LOOP;

  RETURN _added;
END $function$;

REVOKE ALL ON FUNCTION public.apply_order_gifts_internal(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- מתנות להזמנה של הקורא (הלקוח של ההזמנה או צוות החנות)
CREATE OR REPLACE FUNCTION public.apply_order_gifts(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
BEGIN
  SELECT id, tenant_id, customer_id INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- IS DISTINCT FROM ולא "=": בהזמנת אורח customer_id הוא NULL, ו-NULL = uid
  -- היה מדלג על הבדיקה בשקט
  IF o.tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR (auth.role() IS DISTINCT FROM 'service_role'
         AND o.customer_id IS DISTINCT FROM auth.uid()
         AND NOT public.is_staff(auth.uid())) THEN
    RAISE EXCEPTION 'אין הרשאה להזמנה הזו' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN public.apply_order_gifts_internal(_order_id);
END $$;

REVOKE ALL ON FUNCTION public.apply_order_gifts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_order_gifts(uuid) TO authenticated, service_role;

-- שליחת הזמנה של לקוח מחובר. _details = טופס הקופה (חובה מהקופה החדשה;
-- NULL נשאר אפשרי לתאימות עם דפדפן שעוד מריץ גרסה קודמת של האתר).
DROP FUNCTION IF EXISTS public.place_order(text, jsonb, numeric, boolean);
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

  IF _details IS NOT NULL THEN
    d := public.normalize_checkout_details(_details, false);
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
    terms_accepted_at)
  VALUES (
    auth.uid(), 'pending', COALESCE(_kind, 'order'), 0,
    COALESCE(_vat_rate, 18), COALESCE(_prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    COALESCE((d ->> 'ship_to_different')::boolean, false),
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    CASE WHEN d IS NULL THEN NULL ELSE now() END)
  RETURNING o.id, o.order_number, o.kind INTO created;

  -- מיון לפי מוצר: נעילות המלאי נלקחות תמיד באותו סדר (בלי deadlock בין הזמנות).
  -- שורות שהדפדפן סימן כ"מתנה" לא נכנסות כאן — המתנות נקבעות במסד בלבד.
  INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, is_deposit)
  SELECT created.id,
         (x ->> 'product_id')::uuid,
         (x ->> 'quantity')::integer,
         COALESCE((x ->> 'unit_price')::numeric, 0),
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
   ORDER BY (x ->> 'product_id'), COALESCE((x ->> 'is_deposit')::boolean, false);

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts(created.id);
  END IF;

  RETURN QUERY SELECT created.id, created.order_number, created.kind;
END $$;

REVOKE ALL ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(text, jsonb, numeric, boolean, jsonb)
  TO authenticated, service_role;

-- הזמנת אורח (בלי חשבון). נקראת רק מהשרת של האתר (service_role) — שם יש
-- הגבלת קצב לפי IP. המחירים, המלאי, המתנות ושעות הפעילות נקבעים כאן ובטריגרים
-- בדיוק כמו בהזמנה של לקוח: המחירון הרגיל (דרג 1), מלאי קשיח, נעילה בשבת.
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

  d := public.normalize_checkout_details(_details, true);

  -- מצב המע"מ של החנות (לא מהדפדפן)
  SELECT s.vat_rate, s.prices_include_vat INTO st
    FROM public.site_settings s WHERE s.tenant_id = _tenant;

  INSERT INTO public.orders AS o (
    tenant_id, customer_id, status, kind, total, vat_rate, prices_include_vat, note,
    customer_name, customer_tax_id, customer_phone, customer_email,
    billing_city, billing_address, billing_zip,
    ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip,
    terms_accepted_at)
  VALUES (
    _tenant, NULL, 'pending', CASE WHEN _kind = 'quote' THEN 'quote' ELSE 'order' END, 0,
    COALESCE(st.vat_rate, 18), COALESCE(st.prices_include_vat, true), d ->> 'note',
    d ->> 'customer_name', d ->> 'customer_tax_id', d ->> 'customer_phone', d ->> 'customer_email',
    d ->> 'billing_city', d ->> 'billing_address', d ->> 'billing_zip',
    (d ->> 'ship_to_different')::boolean,
    d ->> 'shipping_name', d ->> 'shipping_phone', d ->> 'shipping_city',
    d ->> 'shipping_address', d ->> 'shipping_zip',
    now())
  RETURNING o.id, o.order_number, o.kind INTO created;

  INSERT INTO public.order_items (tenant_id, order_id, product_id, quantity, unit_price, is_deposit)
  SELECT _tenant,
         created.id,
         (x ->> 'product_id')::uuid,
         (x ->> 'quantity')::integer,
         0,
         COALESCE((x ->> 'is_deposit')::boolean, false)
    FROM jsonb_array_elements(_items) AS x
   WHERE NOT COALESCE((x ->> 'is_gift')::boolean, false)
   ORDER BY (x ->> 'product_id'), COALESCE((x ->> 'is_deposit')::boolean, false);

  IF created.kind = 'order' THEN
    PERFORM public.apply_order_gifts_internal(created.id);
  END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.kind, o.total FROM public.orders o WHERE o.id = created.id;
END $$;

REVOKE ALL ON FUNCTION public.place_guest_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_guest_order(text, jsonb, jsonb) TO service_role;

-- חנות סגורה (מוקפאת / שבת): נחסמות גם הזמנות אורח. צוות החנות (הזמנה ידנית)
-- ופעולות שרת עבור לקוח רשום (למשל "הזמנה חוזרת") — כמו קודם.
CREATE OR REPLACE FUNCTION public.orders_require_open_storefront()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_staff(auth.uid()) OR (auth.uid() IS NULL AND NEW.customer_id IS NOT NULL) THEN
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

-- התראה על הזמנה חדשה: לסוכן המשויך (כמו קודם). הזמנת אורח אין לה סוכן —
-- ההתראה הולכת לכל מנהלי החנות.
CREATE OR REPLACE FUNCTION public.notify_new_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recipient_role TEXT;
  business TEXT;
BEGIN
  IF NEW.customer_id IS NULL THEN
    INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
    SELECT NEW.tenant_id, ur.user_id, 'new_order',
           CASE WHEN NEW.kind = 'quote' THEN 'בקשת הצעת מחיר חדשה מאורח'
                ELSE 'הזמנה חדשה מאורח' END,
           COALESCE(NEW.customer_name, 'אורח') || ' · ' || NEW.order_number,
           '/admin?tab=orders'
      FROM public.user_roles ur
     WHERE ur.tenant_id = NEW.tenant_id AND ur.role = 'admin' AND NOT ur.is_blocked;
    RETURN NEW;
  END IF;

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
    COALESCE(NEW.customer_name, business, '') || ' · ' || NEW.order_number,
    CASE WHEN recipient_role = 'admin' THEN '/admin?tab=orders' ELSE '/agent?tab=orders' END
  );
  RETURN NEW;
END $$;

-- מסך הליקוט: שם הלקוח, והכתובת / הטלפון / המקבל — של המשלוח בפועל
-- (כתובת חלופית אם נבחרה בקופה, אחרת כתובת החיוב, ובהזמנה ישנה — מהפרופיל)
CREATE OR REPLACE FUNCTION public.picking_orders()
 RETURNS TABLE(id uuid, order_number text, status text, is_urgent boolean, created_at timestamp with time zone, note text, picker_id uuid, picker_name text, picking_paused boolean, picking_claimed_at timestamp with time zone, picked_at timestamp with time zone, picking_approved_by uuid, approved_by_name text, customer_name text, customer_address text, customer_phone text, contact_name text, total_lines integer, picked_lines integer, short_lines integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.order_number, o.status, o.is_urgent, o.created_at, o.note,
         o.picker_id, public.staff_display_name(o.picker_id), o.picking_paused, o.picking_claimed_at,
         o.picked_at, o.picking_approved_by, public.staff_display_name(o.picking_approved_by),
         COALESCE(o.customer_name, cp.business_name, cp.contact_name, 'לקוח'),
         CASE WHEN o.ship_to_different
                THEN concat_ws(', ', o.shipping_address, o.shipping_city, o.shipping_zip)
              WHEN o.billing_address IS NOT NULL
                THEN concat_ws(', ', o.billing_address, o.billing_city, o.billing_zip)
              ELSE cp.business_address END,
         COALESCE(CASE WHEN o.ship_to_different THEN o.shipping_phone END, o.customer_phone, cp.phone),
         CASE WHEN o.ship_to_different THEN o.shipping_name
              ELSE COALESCE(cp.contact_name, o.customer_name) END,
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
$function$;

-- ------------------------------------------------------------
-- 4. פרופיל הלקוח: עיר ומיקוד (ברירת המחדל בקופה)
-- ------------------------------------------------------------

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT;

DO $$ BEGIN
  ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_city_zip_check CHECK (
        (city IS NULL OR length(btrim(city)) BETWEEN 1 AND 80)
    AND (zip_code IS NULL OR zip_code ~ '^[0-9]{5,7}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';

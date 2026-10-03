-- ============================================================
-- חלק 7: לוגיסטיקה — סטטוסי משלוח, שליחים, פורטל שליח ומדבקות.
--
-- 1. סטטוסים חדשים להזמנה:
--      awaiting_courier — "ממתינה לשליח" (נוצר קישור לשליח)
--      delivered        — "נמסרה ללקוח" (השליח סימן "נמסר")
--    משלוח שנכשל לא מחליף סטטוס: ההזמנה נשארת "ממתינה לשליח" ומונה
--    הניסיונות (delivery_attempts) עולה — "משלוח נכשל — ניסיון X".
-- 2. קישור לשליח (order_courier_links): טוקן אקראי (256 ביט) בכתובת, בלי
--    התחברות; בתוקף 7 ימים מכל מסירה לשליח; צוות החנות בלבד רואה אותו.
--    השליח פועל רק דרך השרת (courier_delivery / courier_report —
--    service_role בלבד): רואה את פרטי המשלוח, ומסמן "נמסר" או "נכשל".
-- 3. יומן משלוח (order_delivery_events): מסירה לשליח, ניסיון שנכשל, נשלחה,
--    נמסרה — מי ומתי.
-- 4. מדבקות משלוח: רוחב וגובה (מ"מ) בהגדרות החנות — ברירת מחדל 70×50.
-- 5. המלאי והליקוט מכירים את הסטטוסים החדשים (הזמנה שממתינה לשליח עדיין
--    במחסן; ליקוטים שהמשיכו למשלוח נספרים לעובד).
--
-- המיגרציה ניתנת להרצה חוזרת.
-- ============================================================

-- ------------------------------------------------------------
-- 1. סטטוסים ושדות משלוח על ההזמנה
-- ------------------------------------------------------------

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK (
  status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier',
             'shipped', 'delivered', 'cancelled'));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivery_failure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_delivery_failure_note TEXT,
  ADD COLUMN IF NOT EXISTS courier_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.delivery_attempts IS
  'כמה ניסיונות מסירה נכשלו (השליח סימן "משלוח נכשל")';

DO $$ BEGIN
  ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_fields_check CHECK (
        delivery_attempts BETWEEN 0 AND 99
    AND (last_delivery_failure_note IS NULL OR length(last_delivery_failure_note) <= 300));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- חותמות זמן לפי הסטטוס (לפני השמירה)
CREATE OR REPLACE FUNCTION public.orders_track_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'awaiting_courier' THEN
      NEW.courier_assigned_at := now();
    ELSIF NEW.status = 'shipped' THEN
      NEW.shipped_at := now();
    ELSIF NEW.status = 'delivered' THEN
      NEW.delivered_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_track_delivery ON public.orders;
CREATE TRIGGER orders_track_delivery
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_track_delivery();

-- ------------------------------------------------------------
-- 2. יומן משלוח
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('courier_assigned', 'delivery_failed', 'delivered', 'shipped')),
  attempt INTEGER CHECK (attempt IS NULL OR attempt >= 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  actor TEXT NOT NULL CHECK (actor IN ('staff', 'courier')),
  created_by UUID DEFAULT public.tenant_member_id(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.user_roles(tenant_id, user_id)
    ON DELETE SET NULL (created_by)
);

CREATE INDEX IF NOT EXISTS order_delivery_events_order_idx
  ON public.order_delivery_events (order_id, created_at);

ALTER TABLE public.order_delivery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.order_delivery_events;
CREATE POLICY tenant_isolation ON public.order_delivery_events AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
DROP POLICY IF EXISTS "delivery events readable by staff" ON public.order_delivery_events;
CREATE POLICY "delivery events readable by staff" ON public.order_delivery_events
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.orders o
                     WHERE o.id = order_delivery_events.order_id AND o.agent_id = auth.uid()));
REVOKE ALL ON public.order_delivery_events FROM anon;
GRANT SELECT ON public.order_delivery_events TO authenticated;
GRANT ALL ON public.order_delivery_events TO service_role;

-- כל שינוי סטטוס שקשור למשלוח נרשם ביומן (צוות = משתמש מחובר; שליח = בלי משתמש)
CREATE OR REPLACE FUNCTION public.orders_log_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('awaiting_courier', 'shipped', 'delivered') THEN
    INSERT INTO public.order_delivery_events (tenant_id, order_id, kind, attempt, actor, created_by)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      CASE NEW.status WHEN 'awaiting_courier' THEN 'courier_assigned' ELSE NEW.status END,
      CASE WHEN NEW.status = 'shipped' THEN NULL ELSE NEW.delivery_attempts + 1 END,
      CASE WHEN auth.uid() IS NULL THEN 'courier' ELSE 'staff' END,
      public.tenant_member_id()
    );
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS orders_log_delivery_status ON public.orders;
CREATE TRIGGER orders_log_delivery_status
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_log_delivery_status();

-- ------------------------------------------------------------
-- 3. קישור לשליח
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_courier_links (
  order_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL DEFAULT public.current_tenant_id()
    REFERENCES public.tenants(id) ON DELETE RESTRICT,
  token TEXT NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  courier_name TEXT
    CHECK (courier_name IS NULL OR length(btrim(courier_name)) BETWEEN 1 AND 80),
  courier_phone TEXT CHECK (courier_phone IS NULL OR courier_phone ~ '^\+?[0-9]{9,15}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID DEFAULT public.tenant_member_id(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
  opened_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TIMESTAMPTZ,
  FOREIGN KEY (tenant_id, order_id) REFERENCES public.orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES public.user_roles(tenant_id, user_id)
    ON DELETE SET NULL (created_by)
);

COMMENT ON TABLE public.order_courier_links IS
  'קישור זמני לשליח (בלי התחברות). הטוקן סודי — רק צוות החנות רואה אותו.';

ALTER TABLE public.order_courier_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.order_courier_links;
CREATE POLICY tenant_isolation ON public.order_courier_links AS RESTRICTIVE
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- מנהל — כל ההזמנות; סוכן — ההזמנות שהוא מטפל בהן. לקוחות — אף פעם
-- (אחרת לקוח היה יכול לסמן לעצמו "נמסר")
DROP POLICY IF EXISTS "courier links managed by staff" ON public.order_courier_links;
CREATE POLICY "courier links managed by staff" ON public.order_courier_links
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())
         OR EXISTS (SELECT 1 FROM public.orders o
                     WHERE o.id = order_courier_links.order_id AND o.agent_id = auth.uid()))
  WITH CHECK (public.is_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.orders o
                          WHERE o.id = order_courier_links.order_id AND o.agent_id = auth.uid()));
REVOKE ALL ON public.order_courier_links FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_courier_links TO authenticated;
GRANT ALL ON public.order_courier_links TO service_role;

-- מסירת הזמנות לשליח (בודדת או גורפת): הסטטוס עובר ל"ממתינה לשליח",
-- ולכל הזמנה קישור לשליח — הקיים (תוקפו מתחדש ל-7 ימים) או חדש
-- (_renew = true מבטל את הקישור הקודם). רצה בהרשאות הקורא (RLS).
CREATE OR REPLACE FUNCTION public.assign_order_courier(
  _order_ids uuid[],
  _courier_name text DEFAULT NULL,
  _courier_phone text DEFAULT NULL,
  _renew boolean DEFAULT false
)
RETURNS TABLE(order_id uuid, order_number text, token text, expires_at timestamptz,
              delivery_attempts integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  o RECORD;
  _name text := NULLIF(btrim(COALESCE(_courier_name, '')), '');
  _phone text := NULLIF(regexp_replace(COALESCE(_courier_phone, ''), '[^0-9+]', '', 'g'), '');
  _found integer := 0;
  _new_token text;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'אין הרשאה לנהל משלוחים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _order_ids IS NULL OR cardinality(_order_ids) = 0 THEN
    RAISE EXCEPTION 'לא נבחרו הזמנות';
  END IF;
  IF cardinality(_order_ids) > 200 THEN
    RAISE EXCEPTION 'אפשר למסור עד 200 הזמנות בפעולה אחת';
  END IF;
  IF _name IS NOT NULL AND length(_name) > 80 THEN
    RAISE EXCEPTION 'שם השליח ארוך מדי';
  END IF;
  IF _phone IS NOT NULL AND _phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'מספר הטלפון של השליח אינו תקין';
  END IF;

  FOR o IN
    SELECT ord.id, ord.order_number, ord.status, ord.kind
      FROM public.orders ord
     WHERE ord.id = ANY (_order_ids)
     ORDER BY ord.order_number
  LOOP
    _found := _found + 1;
    IF o.kind <> 'order' THEN
      RAISE EXCEPTION 'בקשה להצעת מחיר (%) לא נמסרת לשליח', o.order_number;
    END IF;
    IF o.status IN ('cancelled', 'delivered') THEN
      RAISE EXCEPTION 'ההזמנה % %', o.order_number,
        CASE o.status WHEN 'cancelled' THEN 'בוטלה' ELSE 'כבר נמסרה' END;
    END IF;
    IF o.status <> 'awaiting_courier' THEN
      UPDATE public.orders SET status = 'awaiting_courier' WHERE id = o.id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'אין הרשאה לעדכן את ההזמנה %', o.order_number
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    -- 2 × gen_random_uuid = 244 ביט אקראיים (pg_strong_random)
    _new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO public.order_courier_links AS l (order_id, token, courier_name, courier_phone)
    VALUES (o.id, _new_token, _name, _phone)
    ON CONFLICT (order_id) DO UPDATE SET
      token = CASE WHEN _renew OR l.expires_at <= now() THEN EXCLUDED.token ELSE l.token END,
      created_at = CASE WHEN _renew OR l.expires_at <= now() THEN now() ELSE l.created_at END,
      expires_at = now() + interval '7 days',
      courier_name = COALESCE(EXCLUDED.courier_name, l.courier_name),
      courier_phone = COALESCE(EXCLUDED.courier_phone, l.courier_phone);
  END LOOP;

  IF _found <> cardinality(_order_ids) THEN
    RAISE EXCEPTION 'חלק מההזמנות לא נמצאו (או שאין הרשאה אליהן)';
  END IF;

  RETURN QUERY
    SELECT ord.id, ord.order_number, l.token, l.expires_at, ord.delivery_attempts
      FROM public.orders ord
      JOIN public.order_courier_links l ON l.order_id = ord.id
     WHERE ord.id = ANY (_order_ids)
     ORDER BY ord.order_number;
END $$;

REVOKE ALL ON FUNCTION public.assign_order_courier(uuid[], text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_order_courier(uuid[], text, text, boolean)
  TO authenticated, service_role;

-- פרטי המשלוח לשליח (מסך הקישור). בלי התחברות: נקרא רק מהשרת (service_role)
-- עם החנות של הדומיין. פרטים אישיים מוחזרים רק כשההזמנה ממתינה לשליח
-- והקישור בתוקף; אחרת — רק המצב ומספר ההזמנה.
CREATE OR REPLACE FUNCTION public.courier_delivery(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l RECORD;
  o RECORD;
  cp RECORD;
  st RECORD;
  _items integer;
  _units integer;
  _ship boolean;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32,64}$' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO l FROM public.order_courier_links
   WHERE token = _token AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id;

  IF o.status = 'delivered' THEN
    RETURN jsonb_build_object('state', 'delivered', 'order_number', o.order_number,
                              'delivered_at', o.delivered_at);
  END IF;
  IF o.status <> 'awaiting_courier' THEN
    RETURN jsonb_build_object('state', 'closed', 'order_number', o.order_number);
  END IF;
  IF l.expires_at <= now() THEN
    RETURN jsonb_build_object('state', 'expired', 'order_number', o.order_number);
  END IF;

  UPDATE public.order_courier_links
     SET opened_count = opened_count + 1, last_opened_at = now()
   WHERE order_id = l.order_id;

  SELECT business_name, contact_name, phone, business_address, city, zip_code INTO cp
    FROM public.customer_profiles WHERE user_id = o.customer_id;
  SELECT business_name, site_title, business_phone, support_phone INTO st
    FROM public.site_settings WHERE tenant_id = o.tenant_id;
  SELECT count(*)::int, COALESCE(sum(quantity), 0)::int INTO _items, _units
    FROM public.order_items WHERE order_id = o.id AND NOT is_deposit;

  _ship := o.ship_to_different;
  RETURN jsonb_build_object(
    'state', 'active',
    'order_number', o.order_number,
    'recipient_name', CASE WHEN _ship THEN o.shipping_name
                           ELSE COALESCE(cp.contact_name, o.customer_name, cp.business_name) END,
    'customer_name', COALESCE(o.customer_name, cp.business_name),
    'recipient_phone', CASE WHEN _ship THEN COALESCE(o.shipping_phone, o.customer_phone, cp.phone)
                            ELSE COALESCE(o.customer_phone, cp.phone) END,
    'street', CASE WHEN _ship THEN o.shipping_address
                   ELSE COALESCE(o.billing_address, cp.business_address) END,
    'city', CASE WHEN _ship THEN o.shipping_city ELSE COALESCE(o.billing_city, cp.city) END,
    'zip', CASE WHEN _ship THEN o.shipping_zip ELSE COALESCE(o.billing_zip, cp.zip_code) END,
    'alternate_address', _ship,
    'note', o.note,
    'items', _items,
    'units', _units,
    'attempts', o.delivery_attempts,
    'last_failure_note', o.last_delivery_failure_note,
    'last_failure_at', o.last_delivery_failure_at,
    'courier_name', l.courier_name,
    'expires_at', l.expires_at,
    'store_name', COALESCE(NULLIF(btrim(st.business_name), ''), st.site_title),
    'store_phone', COALESCE(NULLIF(btrim(st.support_phone), ''), NULLIF(btrim(st.business_phone), ''))
  );
END $$;

REVOKE ALL ON FUNCTION public.courier_delivery(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_delivery(text) TO service_role;

-- השליח מדווח: נמסר → "נמסרה"; נכשל → נשארת "ממתינה לשליח" והמונה עולה
-- (+ התראה למנהלי החנות ולסוכן המטפל). הקישור נשאר פעיל עד שנמסרה.
CREATE OR REPLACE FUNCTION public.courier_report(_token text, _delivered boolean, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l RECORD;
  o RECORD;
  _clean text := NULLIF(left(btrim(COALESCE(_note, '')), 300), '');
  _attempts integer;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32,64}$' THEN
    RAISE EXCEPTION 'הקישור לא תקין' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO l FROM public.order_courier_links
   WHERE token = _token AND tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'הקישור לא תקין' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO o FROM public.orders WHERE id = l.order_id FOR UPDATE;
  IF o.status = 'delivered' THEN
    RAISE EXCEPTION 'ההזמנה כבר סומנה כנמסרה' USING ERRCODE = 'check_violation';
  END IF;
  IF o.status <> 'awaiting_courier' THEN
    RAISE EXCEPTION 'ההזמנה כבר לא ממתינה לשליח — פנו לחנות' USING ERRCODE = 'check_violation';
  END IF;
  IF l.expires_at <= now() THEN
    RAISE EXCEPTION 'תוקף הקישור פג — בקשו מהחנות קישור חדש' USING ERRCODE = 'check_violation';
  END IF;

  IF _delivered THEN
    UPDATE public.orders SET status = 'delivered' WHERE id = o.id;
    RETURN jsonb_build_object('status', 'delivered', 'attempts', o.delivery_attempts,
                              'order_number', o.order_number);
  END IF;

  UPDATE public.orders
     SET delivery_attempts = delivery_attempts + 1,
         last_delivery_failure_at = now(),
         last_delivery_failure_note = _clean
   WHERE id = o.id
  RETURNING delivery_attempts INTO _attempts;

  INSERT INTO public.order_delivery_events (tenant_id, order_id, kind, attempt, note, actor, created_by)
  VALUES (o.tenant_id, o.id, 'delivery_failed', _attempts, _clean, 'courier', NULL);

  INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
  SELECT o.tenant_id, ur.user_id, 'system',
         'משלוח נכשל — ניסיון ' || _attempts,
         o.order_number || COALESCE(' · ' || _clean, ''),
         CASE WHEN ur.role = 'admin' THEN '/admin?tab=orders' ELSE '/agent?tab=orders' END
    FROM public.user_roles ur
   WHERE ur.tenant_id = o.tenant_id AND NOT ur.is_blocked
     AND (ur.role = 'admin' OR ur.user_id = o.agent_id);

  RETURN jsonb_build_object('status', 'awaiting_courier', 'attempts', _attempts,
                            'order_number', o.order_number);
END $$;

REVOKE ALL ON FUNCTION public.courier_report(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_report(text, boolean, text) TO service_role;

-- ------------------------------------------------------------
-- 4. מידות מדבקת משלוח (הגדרות החנות)
-- ------------------------------------------------------------

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS label_width_mm NUMERIC(5,1) NOT NULL DEFAULT 70,
  ADD COLUMN IF NOT EXISTS label_height_mm NUMERIC(5,1) NOT NULL DEFAULT 50;

DO $$ BEGIN
  ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_label_size_check CHECK (
    label_width_mm BETWEEN 30 AND 200 AND label_height_mm BETWEEN 20 AND 300);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 5. מלאי וליקוט: הסטטוסים החדשים
-- ------------------------------------------------------------

-- הזמנה שממתינה לשליח עדיין במחסן — שמורה (כמו הזמנה בליקוט)
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
       AND o.status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier')
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

CREATE OR REPLACE FUNCTION public.stock_lookup(_query text)
 RETURNS TABLE(id uuid, name text, sku text, barcode text, image_url text, category text, pack_size integer, is_hidden boolean, available integer, reserved integer, locations jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH q AS (SELECT btrim(COALESCE(_query, '')) AS t)
  SELECT gp.id, gp.name, gp.sku, gp.barcode, gp.image_url, gp.category, gp.pack_size, gp.is_hidden,
         gp.stock_quantity,
         COALESCE((SELECT SUM(oi.reserved_quantity)::int FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
                    WHERE oi.product_id = gp.id AND NOT oi.is_deposit AND o.kind = 'order'
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
$function$;

CREATE OR REPLACE FUNCTION public.stock_reserved_open()
 RETURNS TABLE(product_id uuid, reserved integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT oi.product_id, SUM(oi.reserved_quantity)::integer
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE public.is_staff(auth.uid())
     AND o.tenant_id = public.current_tenant_id()
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking', 'picked', 'awaiting_courier')
     AND NOT oi.is_deposit
     AND oi.reserved_quantity > 0
   GROUP BY oi.product_id;
$function$;

-- ליקוט שהמשיך למשלוח / נמסר — נספר לעובד שליקט
CREATE OR REPLACE FUNCTION public.picking_leaderboard()
 RETURNS TABLE(user_id uuid, name text, is_blocked boolean, this_month integer, last_month integer, total integer, in_progress integer, last_picked_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ur.user_id, public.staff_display_name(ur.user_id), ur.is_blocked,
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','awaiting_courier','shipped','delivered') AND o.picked_at >= date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','awaiting_courier','shipped','delivered') AND o.picked_at >= date_trunc('month', now()) - interval '1 month' AND o.picked_at < date_trunc('month', now())),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','awaiting_courier','shipped','delivered') AND o.picked_at IS NOT NULL),
         (SELECT count(*)::int FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status = 'picking'),
         (SELECT max(o.picked_at) FROM public.orders o WHERE o.picker_id = ur.user_id AND o.status IN ('picked','awaiting_courier','shipped','delivered'))
    FROM public.user_roles ur
   WHERE public.is_admin(auth.uid())
     AND ur.tenant_id = public.current_tenant_id()
     AND (ur.role = 'warehouse' OR EXISTS (SELECT 1 FROM public.orders o WHERE o.picker_id = ur.user_id))
   ORDER BY 4 DESC, 2;
$function$;

CREATE OR REPLACE FUNCTION public.picking_stats(_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(period text, period_start date, orders integer, lines integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       AND o.picker_id = target AND o.status IN ('picked', 'awaiting_courier', 'shipped', 'delivered') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('month', now()) - interval '23 months'
     GROUP BY 2
    UNION ALL
    SELECT 'week', date_trunc('week', o.picked_at)::date, count(DISTINCT o.id)::int, count(oi.id)::int
      FROM public.orders o
      LEFT JOIN public.order_items oi ON oi.order_id = o.id AND NOT oi.is_deposit
     WHERE o.tenant_id = _tenant
       AND o.picker_id = target AND o.status IN ('picked', 'awaiting_courier', 'shipped', 'delivered') AND o.picked_at IS NOT NULL
       AND o.picked_at >= date_trunc('week', now()) - interval '15 weeks'
     GROUP BY 2
    ORDER BY 1, 2;
END $function$;

-- מסך הליקוט: הזמנות שיצאו (גם לשליח / נמסרו) נשארות ב"בוצעו לאחרונה"
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
     AND (o.status IN ('picking', 'picked') OR (o.status IN ('awaiting_courier', 'shipped', 'delivered') AND o.picked_at > now() - interval '45 days'))
   ORDER BY CASE o.status WHEN 'picking' THEN 0 WHEN 'picked' THEN 1 ELSE 2 END, o.is_urgent DESC, o.created_at;
$function$;

NOTIFY pgrst, 'reload schema';

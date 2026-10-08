-- ============================================================
-- חלק 35: ERP מתקדם (מספרים סידוריים ואחריות), שמירת שבת וחג אוטומטית,
-- וחוקי סל (מינימום להזמנה).
--
-- 1. מספרים סידוריים (Serial Numbers):
--    • global_products (טבלת המוצרים של החנויות): requires_serial — המוצר נמכר
--      יחידה-יחידה עם מספר סידורי; warranty_months — חודשי אחריות (0 = בלי).
--    • product_serials: כל יחידה פיזית במלאי (ייחודי לכל מוצר בחנות),
--      סטטוס in_stock / sold, תאריך קליטה, ואחרי המכירה — ההזמנה, השורה
--      ותוקף האחריות.
--    • order_items.serial_number: המספרים הסידוריים שנמכרו בשורה (לתיעוד, לקבלה
--      ולאזור האישי), ו-warranty_until: תוקף האחריות המחושב.
--    • קליטת סחורה: מוצר שדורש מספר סידורי — המלאי שלו עולה רק דרך קליטה
--      יחידה-יחידה (product_serials_receive). עדכון ישיר של המלאי כלפי מעלה
--      נחסם במסד (החזרות של הזמנות שבוטלו — עוברות כרגיל).
--    • ליקוט / קופה: אי אפשר להעביר הזמנה ל"ממתינה לשליח" / "נשלחה" / "נמסרה"
--      לפני שלכל יחידה של מוצר כזה שויך מספר סידורי. השיוך — בסריקה (או
--      בחירה מרשימת הפנויים), והסטטוס של היחידה עובר ל-sold. ביטול ההזמנה
--      (או הסרת השורה) מחזיר את היחידות ל-in_stock.
--    • בקופה המהירה: מכירה בחנות (נמסרת מיד) — חובה לסרוק מספר סידורי לכל
--      יחידה; הזמנה למשלוח — אפשר עכשיו או בליקוט.
-- 2. שמירת שבת וחג אוטומטית (שעון ישראל, Asia/Jerusalem):
--    site_settings.shabbat_auto_enabled + shabbat_start_time (שישי) +
--    shabbat_end_time (שבת) + holidays (מערך JSON של חגים: התחלה וסיום).
--    בתוך החלון: האתר פתוח לגלישה ולאזור האישי, אבל אי אפשר להוסיף לסל
--    ולבצע הזמנה — נאכף גם כאן במסד (הזמנה חדשה מהאתר נחסמת, גם של אורח).
--    מצב השבת הידני מחלק 4 (מסך "שבת שלום" מלא) — נשאר כמו שהוא.
-- 3. site_settings.minimum_order_amount — מינימום להזמנה מהאתר (סכום המוצרים,
--    לפני משלוח ופיקדון). נאכף בסוף place_order / place_guest_order.
--    מד ההתקדמות למשלוח חינם — כבר קיים (free_shipping_threshold, חלק 5).
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. מוצרים: דורש מספר סידורי + חודשי אחריות
-- ============================================================
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS requires_serial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_months integer NOT NULL DEFAULT 0;

ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_warranty_months_check;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_warranty_months_check
  CHECK (warranty_months BETWEEN 0 AND 240);
ALTER TABLE public.global_products DROP CONSTRAINT IF EXISTS global_products_serial_physical_check;
ALTER TABLE public.global_products ADD CONSTRAINT global_products_serial_physical_check
  CHECK (NOT (requires_serial AND is_digital));

COMMENT ON COLUMN public.global_products.requires_serial IS
  'חלק 35: המוצר נמכר עם מספר סידורי לכל יחידה (קליטה וליקוט בסריקה)';
COMMENT ON COLUMN public.global_products.warranty_months IS
  'חלק 35: חודשי אחריות מיום הרכישה (0 = בלי אחריות)';

-- ============================================================
-- 2. product_serials — יחידה פיזית אחת = שורה אחת
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE t.typname = 'product_serial_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.product_serial_status AS ENUM ('in_stock', 'sold');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.product_serials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT public.current_tenant_id()
                  REFERENCES public.tenants(id) ON DELETE RESTRICT,
  product_id      uuid NOT NULL,
  serial_number   text NOT NULL,
  status          public.product_serial_status NOT NULL DEFAULT 'in_stock',
  received_at     timestamptz NOT NULL DEFAULT now(),
  -- מי קלט את היחידה (NULL — פעולת מערכת / משתמש שהוסר)
  received_by     uuid,
  -- אחרי המכירה: ההזמנה, השורה, מתי שויך ועד מתי האחריות
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  order_item_id   uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  sold_at         timestamptz,
  warranty_until  date,
  CONSTRAINT product_serials_product_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT product_serials_received_by_fkey FOREIGN KEY (tenant_id, received_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (received_by),
  -- אותיות באנגלית (גדולות), ספרות ו- . _ / # : - ; עד 64 תווים
  CONSTRAINT product_serials_format_check
    CHECK (serial_number ~ '^[A-Z0-9][A-Z0-9._/#:-]{0,63}$'),
  CONSTRAINT product_serials_state_check CHECK (
    (status = 'in_stock' AND order_id IS NULL AND order_item_id IS NULL
       AND sold_at IS NULL AND warranty_until IS NULL)
    OR (status = 'sold' AND sold_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.product_serials IS
  'חלק 35: מספרים סידוריים — כל יחידה במלאי (in_stock) או שנמכרה (sold) עם ההזמנה ותוקף האחריות';

-- מספר סידורי ייחודי לכל מוצר בחנות
CREATE UNIQUE INDEX IF NOT EXISTS product_serials_unique_per_product
  ON public.product_serials (tenant_id, product_id, serial_number);
-- חיפוש לפי מספר סידורי (בדיקת אחריות) והיחידות הפנויות של מוצר
CREATE INDEX IF NOT EXISTS product_serials_serial_idx
  ON public.product_serials (tenant_id, serial_number);
CREATE INDEX IF NOT EXISTS product_serials_available_idx
  ON public.product_serials (tenant_id, product_id, received_at) WHERE status = 'in_stock';
CREATE INDEX IF NOT EXISTS product_serials_item_idx
  ON public.product_serials (order_item_id) WHERE order_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS product_serials_order_idx
  ON public.product_serials (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_serials;
CREATE POLICY tenant_isolation ON public.product_serials
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- קריאה ישירה — צוות המלאי / הליקוט / הקופה. כתיבה — רק דרך הפונקציות למטה.
DROP POLICY IF EXISTS "serials readable by stock staff" ON public.product_serials;
CREATE POLICY "serials readable by stock staff" ON public.product_serials
  FOR SELECT TO authenticated
  USING (public.staff_can('inventory') OR public.staff_can('orders.fulfill') OR public.staff_can('pos'));

REVOKE ALL ON public.product_serials FROM anon, authenticated;
GRANT SELECT ON public.product_serials TO authenticated;
GRANT ALL ON public.product_serials TO service_role;

-- ============================================================
-- 3. order_items: המספרים הסידוריים שנמכרו + תוקף האחריות
-- ============================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS warranty_until date,
  -- צילום מצב: השורה דורשת מספר סידורי לכל יחידה (נקבע במסד)
  ADD COLUMN IF NOT EXISTS serial_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.serial_number IS
  'חלק 35: המספרים הסידוריים שנמכרו בשורה (מופרדים בפסיק) — נקבע במסד בלבד';
COMMENT ON COLUMN public.order_items.warranty_until IS
  'חלק 35: תוקף האחריות (מיום הרכישה + חודשי האחריות של המוצר)';
COMMENT ON COLUMN public.order_items.serial_required IS
  'חלק 35: השורה דורשת מספר סידורי לכל יחידה לפני משלוח / מסירה';

-- ============================================================
-- 4. עזרים
-- ============================================================
-- ניקוי מספר סידורי מסריקה / הקלדה: בלי רווחים ותווי בקרה, באותיות גדולות
CREATE OR REPLACE FUNCTION public.serial_normalize(_serial text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(COALESCE(_serial, ''), '[[:space:][:cntrl:]]', '', 'g'));
$$;
GRANT EXECUTE ON FUNCTION public.serial_normalize(text) TO anon, authenticated, service_role;

-- תוקף האחריות: יום הרכישה (שעון ישראל) + חודשי האחריות; NULL = בלי אחריות
CREATE OR REPLACE FUNCTION public.serial_warranty_until(_purchased_at timestamptz, _months integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(_months, 0) > 0 AND _purchased_at IS NOT NULL
      THEN ((_purchased_at AT TIME ZONE 'Asia/Jerusalem')::date
             + make_interval(months => _months))::date
  END;
$$;
GRANT EXECUTE ON FUNCTION public.serial_warranty_until(timestamptz, integer)
  TO anon, authenticated, service_role;

-- הודעת שגיאה: מספר סידורי לא תקין
CREATE OR REPLACE FUNCTION public.serial_check_format(_serial text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _serial = '' THEN
    RAISE EXCEPTION 'נא להזין / לסרוק מספר סידורי' USING ERRCODE = 'check_violation';
  END IF;
  IF _serial !~ '^[A-Z0-9][A-Z0-9._/#:-]{0,63}$' THEN
    RAISE EXCEPTION 'מספר סידורי לא תקין: "%" (אותיות באנגלית, ספרות ו- . _ / # : - — עד 64 תווים)',
      left(_serial, 70) USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- יחידות במלאי של מוצר שעוד אין להן מספר סידורי:
--   (פנוי במלאי + שמור להזמנות שעוד לא יצאו ושעוד לא שויך להן מספר)
--   פחות היחידות הפנויות שכבר יש להן מספר.
-- אחרי שמסמנים מוצר קיים כ"דורש מספר סידורי" — כאן רואים כמה יחידות צריך לרשום.
CREATE OR REPLACE FUNCTION public.product_serial_gap(_product_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT gp.stock_quantity FROM public.global_products gp WHERE gp.id = _product_id), 0)
       + COALESCE((
           SELECT SUM(GREATEST(oi.reserved_quantity
                     - (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id), 0))
             FROM public.order_items oi
             JOIN public.orders o ON o.id = oi.order_id
            WHERE oi.product_id = _product_id
              AND NOT oi.is_deposit
              AND NOT oi.reserved_from_variant
              AND o.kind = 'order'
              AND o.status IN ('pending', 'agent_review', 'picking', 'picked')), 0)::integer
       - (SELECT count(*) FROM public.product_serials ps
           WHERE ps.product_id = _product_id AND ps.status = 'in_stock')::integer;
$$;
REVOKE ALL ON FUNCTION public.product_serial_gap(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serial_gap(uuid) TO authenticated, service_role;

-- עדכון שורת ההזמנה מהמספרים ששויכו לה (רק מכאן — העמודות מוגנות בטריגר)
CREATE OR REPLACE FUNCTION public.order_item_refresh_serials(_item uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('nuri.serials', 'on', true);
  UPDATE public.order_items oi
     SET serial_number = (SELECT string_agg(ps.serial_number, ', ' ORDER BY ps.sold_at, ps.serial_number)
                            FROM public.product_serials ps WHERE ps.order_item_id = oi.id),
         warranty_until = (SELECT max(ps.warranty_until)
                             FROM public.product_serials ps WHERE ps.order_item_id = oi.id)
   WHERE oi.id = _item;
  PERFORM set_config('nuri.serials', 'off', true);
END $$;
REVOKE ALL ON FUNCTION public.order_item_refresh_serials(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_item_refresh_serials(uuid) TO service_role;

-- שיוך מספר סידורי לשורה בהזמנה (פנימי — ההרשאה נבדקת בפונקציה שקוראת)
CREATE OR REPLACE FUNCTION public.order_item_assign_serial_internal(_item uuid, _serial text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serial text := public.serial_normalize(_serial);
  it RECORD;
  o RECORD;
  p RECORD;
  s RECORD;
  v_other text;
  v_sold_in text;
  v_assigned integer;
  v_until date;
BEGIN
  SELECT oi.id, oi.tenant_id, oi.order_id, oi.product_id, oi.quantity, oi.is_deposit,
         oi.serial_required, oi.product_name
    INTO it
    FROM public.order_items oi
   WHERE oi.id = _item
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'שורת ההזמנה לא נמצאה — רעננו את המסך' USING ERRCODE = 'check_violation';
  END IF;
  SELECT o2.kind, o2.status, o2.order_number, o2.created_at INTO o
    FROM public.orders o2 WHERE o2.id = it.order_id;
  IF o.kind <> 'order' THEN
    RAISE EXCEPTION 'בבקשה להצעת מחיר אין שיוך מספרים סידוריים' USING ERRCODE = 'check_violation';
  END IF;
  IF o.status = 'cancelled' THEN
    RAISE EXCEPTION 'ההזמנה בוטלה — אי אפשר לשייך לה מספר סידורי' USING ERRCODE = 'check_violation';
  END IF;
  SELECT gp.name, gp.requires_serial, gp.warranty_months INTO p
    FROM public.global_products gp WHERE gp.id = it.product_id;
  IF it.is_deposit OR NOT (it.serial_required OR COALESCE(p.requires_serial, false)) THEN
    RAISE EXCEPTION 'המוצר "%" לא מוגדר כמוצר עם מספר סידורי',
      COALESCE(it.product_name, p.name, 'מוצר') USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.serial_check_format(v_serial);

  SELECT count(*)::integer INTO v_assigned FROM public.product_serials ps WHERE ps.order_item_id = it.id;
  IF v_assigned >= it.quantity THEN
    RAISE EXCEPTION 'לכל % היחידות של "%" כבר שויך מספר סידורי',
      it.quantity, COALESCE(it.product_name, p.name) USING ERRCODE = 'check_violation';
  END IF;

  SELECT ps.id, ps.status, ps.order_id, ps.order_item_id INTO s
    FROM public.product_serials ps
   WHERE ps.tenant_id = it.tenant_id AND ps.product_id = it.product_id
     AND ps.serial_number = v_serial
   FOR UPDATE;
  IF NOT FOUND THEN
    SELECT gp.name INTO v_other
      FROM public.product_serials ps
      JOIN public.global_products gp ON gp.id = ps.product_id
     WHERE ps.tenant_id = it.tenant_id AND ps.serial_number = v_serial
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'המספר הסידורי % שייך למוצר אחר: "%"', v_serial, v_other
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'המספר הסידורי % לא נמצא במלאי של "%" — קלטו אותו קודם ב"קליטת סחורה"',
      v_serial, COALESCE(it.product_name, p.name) USING ERRCODE = 'check_violation';
  END IF;
  IF s.status = 'sold' THEN
    IF s.order_item_id = it.id THEN
      RAISE EXCEPTION 'המספר הסידורי % כבר משויך לשורה הזו', v_serial USING ERRCODE = 'check_violation';
    END IF;
    SELECT o3.order_number INTO v_sold_in FROM public.orders o3 WHERE o3.id = s.order_id;
    RAISE EXCEPTION 'המספר הסידורי % כבר נמכר%', v_serial,
      CASE WHEN v_sold_in IS NOT NULL THEN ' (הזמנה ' || v_sold_in || ')' ELSE '' END
      USING ERRCODE = 'check_violation';
  END IF;

  v_until := public.serial_warranty_until(o.created_at, p.warranty_months);
  UPDATE public.product_serials
     SET status = 'sold', order_id = it.order_id, order_item_id = it.id,
         sold_at = now(), warranty_until = v_until
   WHERE id = s.id;
  PERFORM public.order_item_refresh_serials(it.id);

  RETURN jsonb_build_object(
    'id', s.id,
    'serial_number', v_serial,
    'assigned', v_assigned + 1,
    'required', it.quantity,
    'warranty_until', v_until);
END $$;
REVOKE ALL ON FUNCTION public.order_item_assign_serial_internal(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_item_assign_serial_internal(uuid, text) TO service_role;

-- החזרת יחידות שנמכרו למלאי (ביטול הזמנה / מחיקת שורה / הסרת שיוך)
CREATE OR REPLACE FUNCTION public.product_serials_release(_order uuid, _item uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.product_serials ps
     SET status = 'in_stock', order_id = NULL, order_item_id = NULL,
         sold_at = NULL, warranty_until = NULL
   WHERE (_item IS NOT NULL AND ps.order_item_id = _item)
      OR (_item IS NULL AND _order IS NOT NULL AND ps.order_id = _order);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.product_serials_release(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_serials_release(uuid, uuid) TO service_role;

-- ============================================================
-- 5. טריגרים — מוצרים
-- ============================================================
-- מלאי של מוצר עם מספרים סידוריים עולה רק דרך קליטה (product_serials_receive).
-- pg_trigger_depth() > 1 = עדכון מתוך טריגר אחר (ביטול הזמנה / הסרת שורה
-- מחזירים מלאי) — עובר כרגיל.
CREATE OR REPLACE FUNCTION public.global_products_serial_stock_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT NEW.requires_serial
     OR pg_trigger_depth() > 1
     OR COALESCE(current_setting('nuri.serial_stock', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.stock_quantity > 0 THEN
    RAISE EXCEPTION 'מוצר עם מספרים סידוריים נשמר עם מלאי 0 — את היחידות מוסיפים ב"קליטת סחורה" (סריקת מספר סידורי לכל יחידה)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.stock_quantity > OLD.stock_quantity THEN
    RAISE EXCEPTION 'למוצר "%" נדרש מספר סידורי לכל יחידה — הוסיפו מלאי דרך "קליטת סחורה" (סריקת מספרים סידוריים)',
      NEW.name USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS global_products_serial_stock_guard ON public.global_products;
CREATE TRIGGER global_products_serial_stock_guard
  BEFORE INSERT OR UPDATE OF stock_quantity, requires_serial ON public.global_products
  FOR EACH ROW EXECUTE FUNCTION public.global_products_serial_stock_guard();

-- הפעלה / כיבוי "דורש מספר סידורי" — מתעדכן גם בהזמנות שעוד לא יצאו
CREATE OR REPLACE FUNCTION public.global_products_serial_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.requires_serial IS NOT DISTINCT FROM OLD.requires_serial THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('nuri.serials', 'on', true);
  UPDATE public.order_items oi
     SET serial_required = NEW.requires_serial
    FROM public.orders o
   WHERE oi.order_id = o.id
     AND oi.product_id = NEW.id
     AND NOT oi.is_deposit
     AND NOT oi.is_gift
     AND o.kind = 'order'
     AND o.status IN ('pending', 'agent_review', 'picking', 'picked');
  PERFORM set_config('nuri.serials', 'off', true);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS global_products_serial_sync ON public.global_products;
CREATE TRIGGER global_products_serial_sync
  AFTER UPDATE OF requires_serial ON public.global_products
  FOR EACH ROW EXECUTE FUNCTION public.global_products_serial_sync();

-- ============================================================
-- 6. טריגרים — שורות הזמנה
-- ============================================================
CREATE OR REPLACE FUNCTION public.order_items_serial_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned integer;
  v_internal boolean := COALESCE(current_setting('nuri.serials', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.serial_number := NULL;
    NEW.warranty_until := NULL;
    NEW.serial_required := NOT COALESCE(NEW.is_deposit, false)
      AND NOT COALESCE(NEW.is_gift, false)
      AND COALESCE((SELECT gp.requires_serial FROM public.global_products gp
                     WHERE gp.id = NEW.product_id), false);
    RETURN NEW;
  END IF;

  -- העמודות נקבעות רק במסד (שיוך / ביטול)
  IF NOT v_internal THEN
    NEW.serial_number := OLD.serial_number;
    NEW.warranty_until := OLD.warranty_until;
    NEW.serial_required := OLD.serial_required;
  END IF;

  IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity < OLD.quantity THEN
    SELECT count(*)::integer INTO v_assigned
      FROM public.product_serials ps WHERE ps.order_item_id = OLD.id;
    IF v_assigned > 0 AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      RAISE EXCEPTION 'לשורה "%" כבר שויכו מספרים סידוריים — הסירו אותם לפני החלפת המוצר',
        COALESCE(OLD.product_name, 'מוצר') USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.quantity < v_assigned THEN
      RAISE EXCEPTION 'לשורה "%" שויכו % מספרים סידוריים — הסירו קודם מספר סידורי לפני הקטנת הכמות',
        COALESCE(OLD.product_name, 'מוצר'), v_assigned USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      NEW.serial_required := NOT NEW.is_deposit AND NOT NEW.is_gift
        AND COALESCE((SELECT gp.requires_serial FROM public.global_products gp
                       WHERE gp.id = NEW.product_id), false);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS order_items_serial_guard ON public.order_items;
CREATE TRIGGER order_items_serial_guard
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_serial_guard();

-- שורה שנמחקה (עריכת הזמנה / מחיקת הזמנה) — היחידות חוזרות למלאי
CREATE OR REPLACE FUNCTION public.order_items_serial_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.product_serials_release(NULL, OLD.id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS order_items_serial_release ON public.order_items;
CREATE TRIGGER order_items_serial_release
  BEFORE DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.order_items_serial_release();

-- ============================================================
-- 7. טריגרים — הזמנות
-- ============================================================
-- אין משלוח / מסירה בלי מספר סידורי לכל יחידה
CREATE OR REPLACE FUNCTION public.orders_require_serials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  missing RECORD;
BEGIN
  IF NEW.kind <> 'order'
     OR NEW.status NOT IN ('awaiting_courier', 'shipped', 'delivered')
     OR OLD.status IN ('awaiting_courier', 'shipped', 'delivered') THEN
    RETURN NEW;
  END IF;
  SELECT oi.product_name, oi.quantity,
         (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id)::integer AS assigned
    INTO missing
    FROM public.order_items oi
   WHERE oi.order_id = NEW.id
     AND oi.serial_required
     AND NOT oi.is_deposit
     AND (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id) < oi.quantity
   ORDER BY oi.created_at, oi.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'לא ניתן לסמן את ההזמנה כ"%" לפני הזנת מספר סידורי: "%" (הוזנו % מתוך %) — סרקו או בחרו מספר סידורי לכל יחידה',
      CASE NEW.status WHEN 'awaiting_courier' THEN 'ממתינה לשליח'
                      WHEN 'shipped' THEN 'נשלחה' ELSE 'נמסרה' END,
      COALESCE(missing.product_name, 'מוצר'), missing.assigned, missing.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_require_serials ON public.orders;
CREATE TRIGGER orders_require_serials
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_require_serials();

-- הזמנה שבוטלה — היחידות חוזרות למלאי (in_stock), השורות מתנקות
CREATE OR REPLACE FUNCTION public.orders_cancel_release_serials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it RECORD;
BEGIN
  IF NEW.status <> 'cancelled' OR OLD.status = 'cancelled' THEN
    RETURN NULL;
  END IF;
  FOR it IN
    SELECT DISTINCT ps.order_item_id AS id
      FROM public.product_serials ps
     WHERE ps.order_id = NEW.id AND ps.order_item_id IS NOT NULL
  LOOP
    PERFORM public.product_serials_release(NULL, it.id);
    PERFORM public.order_item_refresh_serials(it.id);
  END LOOP;
  PERFORM public.product_serials_release(NEW.id, NULL);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS orders_cancel_release_serials ON public.orders;
CREATE TRIGGER orders_cancel_release_serials
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_cancel_release_serials();

-- ============================================================
-- 8. פעולות — קליטה וניהול מלאי סריאלי (הרשאת "מלאי": מחסנאי, מנהל, בעלים)
-- ============================================================
-- המוצרים שדורשים מספר סידורי (לקופה, לליקוט ולמסך המלאי)
CREATE OR REPLACE FUNCTION public.serial_products()
RETURNS TABLE(
  product_id uuid,
  name text,
  sku text,
  barcode text,
  warranty_months integer,
  stock_quantity integer,
  in_stock_serials integer,
  sold_serials integer,
  missing_serials integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.staff_can('inventory') OR public.staff_can('orders.fulfill')
                                OR public.staff_can('pos')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT gp.id, gp.name, gp.sku::text, gp.barcode, gp.warranty_months, gp.stock_quantity,
           (SELECT count(*) FROM public.product_serials ps
             WHERE ps.product_id = gp.id AND ps.status = 'in_stock')::integer,
           (SELECT count(*) FROM public.product_serials ps
             WHERE ps.product_id = gp.id AND ps.status = 'sold')::integer,
           GREATEST(public.product_serial_gap(gp.id), 0)
      FROM public.global_products gp
     WHERE gp.tenant_id = public.current_tenant_id()
       AND gp.requires_serial
     ORDER BY gp.name;
END $$;
REVOKE ALL ON FUNCTION public.serial_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.serial_products() TO authenticated, service_role;

-- קליטת סחורה: מספר סידורי לכל יחידה.
--   _mode 'receive'  — סחורה חדשה: המלאי עולה במספר היחידות.
--   _mode 'existing' — רישום יחידות שכבר במלאי (מוצר שעבר עכשיו למספרים
--                      סידוריים): המלאי לא משתנה; עד מספר היחידות בלי מספר.
CREATE OR REPLACE FUNCTION public.product_serials_receive(
  _product_id uuid,
  _serials text[],
  _mode text DEFAULT 'receive'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _me uuid := auth.uid();
  p RECORD;
  v_list text[];
  v_serial text;
  v_dup text;
  v_existing RECORD;
  v_gap integer;
  v_count integer;
BEGIN
  IF _me IS NULL OR NOT public.staff_can('inventory', _me) THEN
    RAISE EXCEPTION 'אין לך הרשאה לקליטת סחורה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _mode IS NULL OR _mode NOT IN ('receive', 'existing') THEN
    RAISE EXCEPTION 'סוג הקליטה אינו תקין' USING ERRCODE = 'check_violation';
  END IF;
  SELECT gp.id, gp.name, gp.requires_serial, gp.is_digital INTO p
    FROM public.global_products gp
   WHERE gp.id = _product_id AND gp.tenant_id = _tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המוצר לא נמצא' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT p.requires_serial THEN
    RAISE EXCEPTION 'המוצר "%" לא מוגדר כ"דורש מספר סידורי" — הפעילו את האפשרות בעריכת המוצר',
      p.name USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_variants v
              WHERE v.product_id = p.id AND v.is_active AND v.stock_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'למוצר "%" יש וריאציות עם מלאי נפרד — מספרים סידוריים נתמכים במוצר בלי מלאי לפי וריאציה',
      p.name USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(array_agg(x.s ORDER BY x.ord), '{}')
    INTO v_list
    FROM (SELECT public.serial_normalize(t.v) AS s, t.ord
            FROM unnest(COALESCE(_serials, '{}')) WITH ORDINALITY AS t(v, ord)) x
   WHERE x.s <> '';
  v_count := COALESCE(array_length(v_list, 1), 0);
  IF v_count = 0 THEN
    RAISE EXCEPTION 'סרקו או הקלידו לפחות מספר סידורי אחד' USING ERRCODE = 'check_violation';
  END IF;
  IF v_count > 500 THEN
    RAISE EXCEPTION 'עד 500 יחידות בקליטה אחת' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH v_serial IN ARRAY v_list LOOP
    PERFORM public.serial_check_format(v_serial);
  END LOOP;
  SELECT x INTO v_dup FROM unnest(v_list) x GROUP BY x HAVING count(*) > 1 LIMIT 1;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'המספר הסידורי % מופיע יותר מפעם אחת ברשימה', v_dup
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT ps.serial_number, ps.status, ps.received_at, o.order_number INTO v_existing
    FROM public.product_serials ps
    LEFT JOIN public.orders o ON o.id = ps.order_id
   WHERE ps.tenant_id = _tenant AND ps.product_id = p.id AND ps.serial_number = ANY (v_list)
   LIMIT 1;
  IF FOUND THEN
    IF v_existing.status = 'sold' THEN
      RAISE EXCEPTION 'המספר הסידורי % כבר נמכר%', v_existing.serial_number,
        CASE WHEN v_existing.order_number IS NOT NULL
             THEN ' (הזמנה ' || v_existing.order_number || ')' ELSE '' END
        USING ERRCODE = 'unique_violation';
    END IF;
    RAISE EXCEPTION 'המספר הסידורי % כבר קיים במלאי (נקלט ב-%)', v_existing.serial_number,
      to_char(v_existing.received_at AT TIME ZONE 'Asia/Jerusalem', 'DD/MM/YYYY')
      USING ERRCODE = 'unique_violation';
  END IF;

  IF _mode = 'existing' THEN
    v_gap := public.product_serial_gap(p.id);
    IF v_count > v_gap THEN
      RAISE EXCEPTION 'במלאי יש רק % יחידות של "%" בלי מספר סידורי — לסחורה חדשה בחרו "קליטת סחורה חדשה"',
        GREATEST(v_gap, 0), p.name USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.product_serials (tenant_id, product_id, serial_number, received_by)
  SELECT _tenant, p.id, s, CASE WHEN EXISTS (SELECT 1 FROM public.user_roles ur
                                              WHERE ur.tenant_id = _tenant AND ur.user_id = _me)
                                THEN _me END
    FROM unnest(v_list) AS s;

  IF _mode = 'receive' THEN
    PERFORM set_config('nuri.serial_stock', 'on', true);
    UPDATE public.global_products gp
       SET stock_quantity = gp.stock_quantity + v_count
     WHERE gp.id = p.id;
    PERFORM set_config('nuri.serial_stock', 'off', true);
  END IF;

  RETURN jsonb_build_object(
    'added', v_count,
    'stock_quantity', (SELECT gp.stock_quantity FROM public.global_products gp WHERE gp.id = p.id),
    'in_stock_serials', (SELECT count(*) FROM public.product_serials ps
                          WHERE ps.product_id = p.id AND ps.status = 'in_stock'),
    'missing_serials', GREATEST(public.product_serial_gap(p.id), 0));
END $$;
REVOKE ALL ON FUNCTION public.product_serials_receive(uuid, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serials_receive(uuid, text[], text) TO authenticated, service_role;

-- תיקון טעות הקלדה ביחידה שבמלאי
CREATE OR REPLACE FUNCTION public.product_serial_update(_serial_id uuid, _serial text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serial text := public.serial_normalize(_serial);
  s RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('inventory') THEN
    RAISE EXCEPTION 'אין לך הרשאה לעדכן מספרים סידוריים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT ps.id, ps.product_id, ps.status, ps.serial_number INTO s
    FROM public.product_serials ps
   WHERE ps.id = _serial_id AND ps.tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המספר הסידורי לא נמצא — רעננו את המסך' USING ERRCODE = 'check_violation';
  END IF;
  IF s.status = 'sold' THEN
    RAISE EXCEPTION 'אי אפשר לשנות מספר סידורי של יחידה שנמכרה' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.serial_check_format(v_serial);
  IF v_serial = s.serial_number THEN
    RETURN v_serial;
  END IF;
  IF EXISTS (SELECT 1 FROM public.product_serials ps
              WHERE ps.product_id = s.product_id AND ps.serial_number = v_serial) THEN
    RAISE EXCEPTION 'המספר הסידורי % כבר קיים במוצר הזה', v_serial USING ERRCODE = 'unique_violation';
  END IF;
  UPDATE public.product_serials SET serial_number = v_serial WHERE id = s.id;
  RETURN v_serial;
END $$;
REVOKE ALL ON FUNCTION public.product_serial_update(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serial_update(uuid, text) TO authenticated, service_role;

-- הסרת יחידה מהמלאי (פגומה / אבדה): _write_off = המלאי יורד ביחידה.
-- בלי _write_off — רק המספר נמחק (נרשם בטעות), המלאי לא משתנה.
CREATE OR REPLACE FUNCTION public.product_serial_remove(_serial_id uuid, _write_off boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('inventory') THEN
    RAISE EXCEPTION 'אין לך הרשאה להסיר מספרים סידוריים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT ps.id, ps.product_id, ps.status, ps.serial_number INTO s
    FROM public.product_serials ps
   WHERE ps.id = _serial_id AND ps.tenant_id = public.current_tenant_id()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המספר הסידורי לא נמצא — רעננו את המסך' USING ERRCODE = 'check_violation';
  END IF;
  IF s.status = 'sold' THEN
    RAISE EXCEPTION 'היחידה % נמכרה — אי אפשר להסיר אותה מהמלאי', s.serial_number
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM public.product_serials WHERE id = s.id;
  IF COALESCE(_write_off, true) THEN
    UPDATE public.global_products gp
       SET stock_quantity = GREATEST(gp.stock_quantity - 1, 0)
     WHERE gp.id = s.product_id;
  END IF;
  RETURN jsonb_build_object(
    'serial_number', s.serial_number,
    'stock_quantity', (SELECT gp.stock_quantity FROM public.global_products gp WHERE gp.id = s.product_id));
END $$;
REVOKE ALL ON FUNCTION public.product_serial_remove(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serial_remove(uuid, boolean) TO authenticated, service_role;

-- היחידות של מוצר (מסך המלאי): פנויות / נמכרו / הכל, עם חיפוש
CREATE OR REPLACE FUNCTION public.product_serials_list(
  _product_id uuid,
  _status text DEFAULT 'all',
  _search text DEFAULT '',
  _limit integer DEFAULT 200
)
RETURNS TABLE(
  id uuid,
  serial_number text,
  status text,
  received_at timestamptz,
  sold_at timestamptz,
  warranty_until date,
  order_id uuid,
  order_number text,
  customer_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := public.serial_normalize(_search);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.staff_can('inventory') OR public.staff_can('orders.fulfill')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT ps.id, ps.serial_number, ps.status::text, ps.received_at, ps.sold_at, ps.warranty_until,
           ps.order_id, o.order_number, o.customer_name
      FROM public.product_serials ps
      LEFT JOIN public.orders o ON o.id = ps.order_id
     WHERE ps.tenant_id = public.current_tenant_id()
       AND ps.product_id = _product_id
       AND (COALESCE(_status, 'all') = 'all' OR ps.status::text = _status)
       AND (v_q = '' OR strpos(ps.serial_number, v_q) > 0)
     ORDER BY ps.status, COALESCE(ps.sold_at, ps.received_at) DESC, ps.serial_number
     LIMIT LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000);
END $$;
REVOKE ALL ON FUNCTION public.product_serials_list(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serials_list(uuid, text, text, integer) TO authenticated, service_role;

-- היחידות הפנויות לשיוך ("קלט חכם" בליקוט ובקופה)
CREATE OR REPLACE FUNCTION public.product_serials_available(
  _product_id uuid,
  _search text DEFAULT '',
  _limit integer DEFAULT 100
)
RETURNS TABLE(id uuid, serial_number text, received_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := public.serial_normalize(_search);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.staff_can('orders.fulfill') OR public.staff_can('pos')
                                OR public.staff_can('inventory')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT ps.id, ps.serial_number, ps.received_at
      FROM public.product_serials ps
     WHERE ps.tenant_id = public.current_tenant_id()
       AND ps.product_id = _product_id
       AND ps.status = 'in_stock'
       AND (v_q = '' OR strpos(ps.serial_number, v_q) > 0)
     -- הוותיקות קודם (FIFO)
     ORDER BY ps.received_at, ps.serial_number
     LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
END $$;
REVOKE ALL ON FUNCTION public.product_serials_available(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.product_serials_available(uuid, text, integer) TO authenticated, service_role;

-- בדיקת אחריות: חיפוש מספר סידורי בכל המוצרים של החנות
CREATE OR REPLACE FUNCTION public.serial_lookup(_serial text)
RETURNS TABLE(
  id uuid,
  serial_number text,
  status text,
  product_id uuid,
  product_name text,
  product_sku text,
  received_at timestamptz,
  sold_at timestamptz,
  warranty_until date,
  warranty_active boolean,
  order_id uuid,
  order_number text,
  customer_name text,
  customer_phone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_q text := public.serial_normalize(_serial);
BEGIN
  IF auth.uid() IS NULL OR NOT (public.staff_can('inventory') OR public.staff_can('orders.fulfill')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF char_length(v_q) < 2 THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT ps.id, ps.serial_number, ps.status::text, gp.id, gp.name, gp.sku::text,
           ps.received_at, ps.sold_at, ps.warranty_until,
           (ps.warranty_until IS NOT NULL
             AND ps.warranty_until >= (now() AT TIME ZONE 'Asia/Jerusalem')::date),
           ps.order_id, o.order_number, o.customer_name, o.customer_phone
      FROM public.product_serials ps
      JOIN public.global_products gp ON gp.id = ps.product_id
      LEFT JOIN public.orders o ON o.id = ps.order_id
     WHERE ps.tenant_id = public.current_tenant_id()
       AND strpos(ps.serial_number, v_q) > 0
     ORDER BY (ps.serial_number = v_q) DESC, ps.serial_number
     LIMIT 25;
END $$;
REVOKE ALL ON FUNCTION public.serial_lookup(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.serial_lookup(text) TO authenticated, service_role;

-- ============================================================
-- 9. פעולות — שיוך בליקוט / בהזמנה (הרשאת "ליקוט": מחסנאי, מנהל, בעלים)
-- ============================================================
CREATE OR REPLACE FUNCTION public.order_item_assign_serial(_order_item_id uuid, _serial text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('orders.fulfill') THEN
    RAISE EXCEPTION 'אין לך הרשאה לשייך מספרים סידוריים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.order_items oi
                  WHERE oi.id = _order_item_id AND oi.tenant_id = public.current_tenant_id()) THEN
    RAISE EXCEPTION 'שורת ההזמנה לא נמצאה — רעננו את המסך' USING ERRCODE = 'check_violation';
  END IF;
  RETURN public.order_item_assign_serial_internal(_order_item_id, _serial);
END $$;
REVOKE ALL ON FUNCTION public.order_item_assign_serial(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_item_assign_serial(uuid, text) TO authenticated, service_role;

-- הסרת שיוך (נסרק בטעות): לפני שההזמנה יצאה — כל מי שמלקט; אחרי — רק מנהל
CREATE OR REPLACE FUNCTION public.order_item_unassign_serial(_order_item_id uuid, _serial_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('orders.fulfill') THEN
    RAISE EXCEPTION 'אין לך הרשאה לעדכן מספרים סידוריים' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT o.status INTO v_status
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
   WHERE oi.id = _order_item_id AND oi.tenant_id = public.current_tenant_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'שורת ההזמנה לא נמצאה — רעננו את המסך' USING ERRCODE = 'check_violation';
  END IF;
  IF v_status IN ('awaiting_courier', 'shipped', 'delivered') AND NOT public.staff_can('admin') THEN
    RAISE EXCEPTION 'ההזמנה כבר יצאה — רק מנהל יכול להסיר מספר סידורי' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.product_serials ps
     SET status = 'in_stock', order_id = NULL, order_item_id = NULL,
         sold_at = NULL, warranty_until = NULL
   WHERE ps.id = _serial_id AND ps.order_item_id = _order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המספר הסידורי לא משויך לשורה הזו' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public.order_item_refresh_serials(_order_item_id);
END $$;
REVOKE ALL ON FUNCTION public.order_item_unassign_serial(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_item_unassign_serial(uuid, uuid) TO authenticated, service_role;

-- המספרים ששויכו לשורה
CREATE OR REPLACE FUNCTION public.order_item_serials(_order_item_id uuid)
RETURNS TABLE(id uuid, serial_number text, sold_at timestamptz, warranty_until date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.staff_can('orders.fulfill') OR public.staff_can('admin')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT ps.id, ps.serial_number, ps.sold_at, ps.warranty_until
      FROM public.product_serials ps
     WHERE ps.order_item_id = _order_item_id
       AND ps.tenant_id = public.current_tenant_id()
     ORDER BY ps.sold_at, ps.serial_number;
END $$;
REVOKE ALL ON FUNCTION public.order_item_serials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_item_serials(uuid) TO authenticated, service_role;

-- השורות של הזמנה שדורשות / קיבלו מספר סידורי (למסך הליקוט — המחסנאי לא
-- קורא את טבלת השורות ישירות)
CREATE OR REPLACE FUNCTION public.order_serial_lines(_order_id uuid)
RETURNS TABLE(
  item_id uuid,
  product_id uuid,
  product_name text,
  quantity integer,
  serial_required boolean,
  serial_number text,
  warranty_until date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('orders.fulfill') THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT oi.id, oi.product_id, oi.product_name, oi.quantity, oi.serial_required,
           oi.serial_number, oi.warranty_until
      FROM public.order_items oi
     WHERE oi.order_id = _order_id
       AND oi.tenant_id = public.current_tenant_id()
       AND NOT oi.is_deposit
       AND (oi.serial_required OR oi.serial_number IS NOT NULL)
     ORDER BY oi.created_at, oi.id;
END $$;
REVOKE ALL ON FUNCTION public.order_serial_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_serial_lines(uuid) TO authenticated, service_role;

-- סימון מרוכז כ"נשלחה": אילו מההזמנות עוד חסר בהן מספר סידורי (מדלגים עליהן)
CREATE OR REPLACE FUNCTION public.orders_missing_serials(_order_ids uuid[])
RETURNS TABLE(order_id uuid, product_name text, assigned integer, required integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_staff(auth.uid()) OR public.staff_can('orders.fulfill')) THEN
    RAISE EXCEPTION 'אין הרשאה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (oi.order_id)
           oi.order_id, oi.product_name,
           (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id)::integer,
           oi.quantity
      FROM public.order_items oi
     WHERE oi.order_id = ANY (COALESCE(_order_ids, '{}'))
       AND oi.tenant_id = public.current_tenant_id()
       AND oi.serial_required
       AND NOT oi.is_deposit
       AND (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id) < oi.quantity
     ORDER BY oi.order_id, oi.created_at;
END $$;
REVOKE ALL ON FUNCTION public.orders_missing_serials(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orders_missing_serials(uuid[]) TO authenticated, service_role;

-- ============================================================
-- 10. הקופה המהירה: מספר סידורי לכל יחידה (מכירה בחנות — חובה)
--     זהה לחלק 33, ובנוסף: "serials" בכל שורה; השיוך לפני הסימון "נמסרה".
-- ============================================================
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
  -- חלק 35: מספרים סידוריים לכל שורה
  _serial_count integer;
  _sn text;
  _item_id uuid;
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
    SELECT gp.name, gp.variant_attributes, gp.requires_serial INTO p
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
    -- חלק 35: מספר סידורי לכל יחידה. מכירה בחנות (נמסרת מיד) — חובה;
    -- הזמנה למשלוח — אפשר עכשיו או בליקוט.
    IF line -> 'serials' IS NOT NULL AND jsonb_typeof(line -> 'serials') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'רשימת המספרים הסידוריים של "%" אינה תקינה', p.name
        USING ERRCODE = 'check_violation';
    END IF;
    _serial_count := CASE WHEN jsonb_typeof(line -> 'serials') = 'array'
                          THEN jsonb_array_length(line -> 'serials') ELSE 0 END;
    IF _serial_count > 0 AND NOT p.requires_serial THEN
      RAISE EXCEPTION 'המוצר "%" לא דורש מספר סידורי', p.name USING ERRCODE = 'check_violation';
    END IF;
    IF _serial_count > (line ->> 'quantity')::integer THEN
      RAISE EXCEPTION 'יותר מספרים סידוריים מיחידות עבור "%"', p.name USING ERRCODE = 'check_violation';
    END IF;
    IF p.requires_serial AND _fulfillment = 'in_store'
       AND _serial_count <> (line ->> 'quantity')::integer THEN
      RAISE EXCEPTION 'מכירה בחנות: סרקו מספר סידורי לכל יחידה של "%" (% מתוך %)',
        p.name, _serial_count, (line ->> 'quantity')::integer USING ERRCODE = 'check_violation';
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

  -- חלק 35: שיוך המספרים הסידוריים שנסרקו בקופה (לפני הסימון "נמסרה")
  FOR line IN SELECT value FROM jsonb_array_elements(_items) LOOP
    CONTINUE WHEN jsonb_typeof(line -> 'serials') IS DISTINCT FROM 'array';
    FOR _sn IN SELECT jsonb_array_elements_text(line -> 'serials') LOOP
      SELECT oi.id INTO _item_id
        FROM public.order_items oi
       WHERE oi.order_id = _created_id
         AND oi.product_id = public.uuid_or_null(line ->> 'product_id')
         AND oi.variant_id IS NOT DISTINCT FROM public.uuid_or_null(line ->> 'variant_id')
         AND NOT oi.is_deposit
         AND NOT oi.is_gift
         AND (SELECT count(*) FROM public.product_serials ps WHERE ps.order_item_id = oi.id) < oi.quantity
       ORDER BY oi.created_at, oi.id
       LIMIT 1;
      IF _item_id IS NULL THEN
        RAISE EXCEPTION 'יותר מספרים סידוריים מיחידות בהזמנה' USING ERRCODE = 'check_violation';
      END IF;
      PERFORM public.order_item_assign_serial_internal(_item_id, _sn);
    END LOOP;
  END LOOP;

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

-- ============================================================
-- 11. שמירת שבת וחג אוטומטית (שעון ישראל)
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS shabbat_auto_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shabbat_start_time time NOT NULL DEFAULT '16:00',
  ADD COLUMN IF NOT EXISTS shabbat_end_time time NOT NULL DEFAULT '20:30',
  ADD COLUMN IF NOT EXISTS holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS minimum_order_amount numeric(12,2);

ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_holidays_check;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_holidays_check
  CHECK (jsonb_typeof(holidays) = 'array' AND jsonb_array_length(holidays) <= 60);
ALTER TABLE public.site_settings DROP CONSTRAINT IF EXISTS site_settings_minimum_order_check;
ALTER TABLE public.site_settings ADD CONSTRAINT site_settings_minimum_order_check
  CHECK (minimum_order_amount IS NULL
         OR (minimum_order_amount > 0 AND minimum_order_amount <= 1000000));

COMMENT ON COLUMN public.site_settings.shabbat_auto_enabled IS
  'חלק 35: שמירת שבת וחג אוטומטית — בחלון הזמן אין הוספה לסל ואין הזמנות (הגלישה פתוחה)';
COMMENT ON COLUMN public.site_settings.shabbat_start_time IS
  'חלק 35: כניסת שבת — השעה ביום שישי (שעון ישראל)';
COMMENT ON COLUMN public.site_settings.shabbat_end_time IS
  'חלק 35: צאת שבת — השעה במוצאי שבת (שעון ישראל)';
COMMENT ON COLUMN public.site_settings.holidays IS
  'חלק 35: חגים — [{"name": "פסח", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM"}] בשעון ישראל';
COMMENT ON COLUMN public.site_settings.minimum_order_amount IS
  'חלק 35: מינימום להזמנה מהאתר (סכום המוצרים לפני משלוח). NULL = בלי מינימום';

-- בדיקה וניקוי של רשימת החגים (מיון לפי תאריך, שם מנוקה)
CREATE OR REPLACE FUNCTION public.site_settings_rest_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  e jsonb;
  v_out jsonb := '[]'::jsonb;
  v_start timestamp;
  v_end timestamp;
  v_name text;
BEGIN
  NEW.holidays := COALESCE(NEW.holidays, '[]'::jsonb);
  IF jsonb_typeof(NEW.holidays) <> 'array' THEN
    RAISE EXCEPTION 'רשימת החגים אינה תקינה' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(NEW.holidays) > 60 THEN
    RAISE EXCEPTION 'עד 60 חגים ברשימה — מחקו חגים שעברו' USING ERRCODE = 'check_violation';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(NEW.holidays) LOOP
    IF jsonb_typeof(e) <> 'object'
       OR COALESCE(e ->> 'start', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'
       OR COALESCE(e ->> 'end', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' THEN
      RAISE EXCEPTION 'תאריך או שעה לא תקינים ברשימת החגים' USING ERRCODE = 'check_violation';
    END IF;
    v_name := NULLIF(btrim(regexp_replace(COALESCE(e ->> 'name', ''), '\s+', ' ', 'g')), '');
    BEGIN
      v_start := (e ->> 'start')::timestamp;
      v_end := (e ->> 'end')::timestamp;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'תאריך לא קיים ברשימת החגים%',
        CASE WHEN v_name IS NOT NULL THEN ' ("' || v_name || '")' ELSE '' END
        USING ERRCODE = 'check_violation';
    END;
    IF char_length(v_name) > 60 THEN
      RAISE EXCEPTION 'שם החג: עד 60 תווים' USING ERRCODE = 'check_violation';
    END IF;
    IF v_end <= v_start THEN
      RAISE EXCEPTION 'בחג "%": שעת הסיום חייבת להיות אחרי שעת הכניסה', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_end - v_start > interval '8 days' THEN
      RAISE EXCEPTION 'החג "%" ארוך מדי (עד 8 ימים ברצף)', COALESCE(v_name, 'ללא שם')
        USING ERRCODE = 'check_violation';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'name', v_name,
      'start', to_char(v_start, 'YYYY-MM-DD"T"HH24:MI'),
      'end', to_char(v_end, 'YYYY-MM-DD"T"HH24:MI')));
  END LOOP;
  SELECT COALESCE(jsonb_agg(x ORDER BY x ->> 'start', x ->> 'end'), '[]'::jsonb)
    INTO NEW.holidays
    FROM jsonb_array_elements(v_out) AS x;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS site_settings_rest_validate ON public.site_settings;
CREATE TRIGGER site_settings_rest_validate
  BEFORE INSERT OR UPDATE OF holidays ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_rest_validate();

-- חלונות המנוחה (שעון ישראל, בלי אזור זמן) שחופפים לטווח: שבתות + חגים
CREATE OR REPLACE FUNCTION public.store_rest_windows(_tenant uuid, _from timestamp, _to timestamp)
RETURNS TABLE(starts_at timestamp, ends_at timestamp, kind text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (
    SELECT st.shabbat_start_time AS st, st.shabbat_end_time AS et, st.holidays AS h
      FROM public.site_settings st
     WHERE st.tenant_id = _tenant AND st.shabbat_auto_enabled
     LIMIT 1
  )
  SELECT fri.d + s.st, (fri.d + 1) + s.et, 'shabbat'::text, NULL::text
    FROM s
   CROSS JOIN LATERAL (
     SELECT g::date AS d
       FROM generate_series(_from::date - 8, _to::date + 1, interval '1 day') AS g
      WHERE extract(isodow FROM g) = 5
   ) AS fri
   WHERE fri.d + s.st < _to AND (fri.d + 1) + s.et > _from
  UNION ALL
  SELECT (e ->> 'start')::timestamp, (e ->> 'end')::timestamp, 'holiday'::text,
         NULLIF(e ->> 'name', '')
    FROM s
   CROSS JOIN LATERAL jsonb_array_elements(s.h) AS e
   WHERE (e ->> 'start')::timestamp < _to AND (e ->> 'end')::timestamp > _from;
$$;
REVOKE ALL ON FUNCTION public.store_rest_windows(uuid, timestamp, timestamp) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_rest_windows(uuid, timestamp, timestamp) TO service_role;

-- האם החנות כרגע בשבת / חג, ומתי חוזרת לפעילות (שבת שנצמדת לחג — עד סוף שניהם).
-- כשפתוחה — מתי הסגירה הבאה (לפס "האתר ייסגר היום ב-16:00").
CREATE OR REPLACE FUNCTION public.store_rest_state(
  _tenant uuid DEFAULT NULL,
  _at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t uuid := COALESCE(_tenant, public.current_tenant_id());
  loc timestamp := COALESCE(_at, now()) AT TIME ZONE 'Asia/Jerusalem';
  cur RECORD;
  nxt RECORD;
  v_reopen timestamp;
  i integer := 0;
BEGIN
  IF t IS NULL THEN
    RETURN jsonb_build_object('closed', false);
  END IF;
  SELECT w.starts_at, w.ends_at, w.kind, w.name INTO cur
    FROM public.store_rest_windows(t, loc - interval '9 days', loc + interval '9 days') AS w
   WHERE w.starts_at <= loc AND w.ends_at > loc
   ORDER BY (w.kind = 'holiday') DESC, w.ends_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    SELECT w.starts_at, w.kind, w.name INTO nxt
      FROM public.store_rest_windows(t, loc, loc + interval '8 days') AS w
     WHERE w.starts_at > loc
     ORDER BY w.starts_at
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('closed', false);
    END IF;
    RETURN jsonb_build_object(
      'closed', false,
      'next_close_at', nxt.starts_at AT TIME ZONE 'Asia/Jerusalem',
      'next_kind', nxt.kind,
      'next_name', nxt.name);
  END IF;
  v_reopen := cur.ends_at;
  LOOP
    i := i + 1;
    EXIT WHEN i > 20;
    SELECT w.ends_at INTO nxt
      FROM public.store_rest_windows(t, v_reopen - interval '9 days', v_reopen + interval '9 days') AS w
     WHERE w.starts_at <= v_reopen AND w.ends_at > v_reopen
     ORDER BY w.ends_at DESC
     LIMIT 1;
    EXIT WHEN NOT FOUND;
    v_reopen := nxt.ends_at;
  END LOOP;
  RETURN jsonb_build_object(
    'closed', true,
    'kind', cur.kind,
    'name', cur.name,
    'reopens_at', v_reopen AT TIME ZONE 'Asia/Jerusalem');
END $$;
REVOKE ALL ON FUNCTION public.store_rest_state(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_rest_state(uuid, timestamptz) TO anon, authenticated, service_role;

-- הזמנה חדשה מהאתר — נחסמת בשבת / חג (גם של אורח, וגם "הזמנה חוזרת" שהשרת
-- יוצר בשם הלקוח). הקופה וצוות החנות — לא נחסמים. השאר זהה לחלק 6.
CREATE OR REPLACE FUNCTION public.orders_require_open_storefront()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.order_source, 'web') = 'pos' OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  -- חלק 35: שמירת שבת וחג אוטומטית
  IF COALESCE((public.store_rest_state(NEW.tenant_id, now()) ->> 'closed')::boolean, false) THEN
    RAISE EXCEPTION 'האתר שומר שבת/חג ויחזור לפעילות בצאת השבת/חג'
      USING ERRCODE = 'check_violation';
  END IF;
  IF auth.uid() IS NULL AND NEW.customer_id IS NOT NULL THEN
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

-- ============================================================
-- 12. מינימום להזמנה (בסוף place_order / place_guest_order, אחרי כל השורות)
--     + בדיקת המינימום של הקופון (זהה לחלק 14)
-- ============================================================
CREATE OR REPLACE FUNCTION public.order_coupon_verify(_order uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  v_products numeric;
  v_min numeric;
BEGIN
  SELECT tenant_id, coupon_code, coupon_min_order, kind, order_source INTO o
    FROM public.orders WHERE id = _order;
  IF NOT FOUND OR o.kind = 'quote' THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(oi.quantity * oi.unit_price)
                    FILTER (WHERE NOT oi.is_deposit AND NOT oi.is_gift), 0)
    INTO v_products
    FROM public.order_items oi
   WHERE oi.order_id = _order;

  -- חלק 35: מינימום להזמנה מהאתר (סכום המוצרים, לפני משלוח ופיקדון)
  IF COALESCE(o.order_source, 'web') = 'web' THEN
    SELECT s.minimum_order_amount INTO v_min
      FROM public.site_settings s WHERE s.tenant_id = o.tenant_id LIMIT 1;
    IF v_min IS NOT NULL AND v_products < v_min THEN
      RAISE EXCEPTION 'סכום ההזמנה המינימלי באתר הוא ₪% — חסרים עוד ₪% (לפני משלוח)',
        trim_scale(v_min), trim_scale(round(v_min - v_products, 2))
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF o.coupon_code IS NULL OR o.coupon_min_order IS NULL THEN
    RETURN;
  END IF;
  IF v_products < o.coupon_min_order THEN
    RAISE EXCEPTION 'הקופון % תקף בהזמנה של ₪% ומעלה (לפני משלוח) — הוסיפו מוצרים או הסירו את הקופון',
      o.coupon_code, trim_scale(o.coupon_min_order)
      USING ERRCODE = 'check_violation';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.order_coupon_verify(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_coupon_verify(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

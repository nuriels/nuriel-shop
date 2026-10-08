-- ============================================================
-- חלק 34: ביקורות וחוות דעת לקוחות (Product Reviews) — הוכחה חברתית
--
-- 1. product_reviews: ביקורת = שם, דירוג 1–5, טקסט. כל ביקורת חדשה ממתינה
--    לאישור (is_approved = false) ומוצגת באתר רק אחרי שמנהל אישר.
--      • כתיבה — רק דרך product_review_submit (פעולת שרת: הגבלת קצב לפי IP,
--        שדה מלכודת לבוטים). אורח — עם שם; לקוח מחובר — ביקורת אחת למוצר,
--        עם "רכישה מאומתת" כשהוא באמת קנה את המוצר.
--      • בלי קישורים בטקסט (ספאם), בלי כפילויות.
--      • הטקסט של הלקוח לא נערך אחרי השליחה — מאשרים, מסתירים או מוחקים.
--    קריאה באתר — רק ביקורות מאושרות, דרך פונקציות (בלי מזהה המשתמש).
-- 2. אישור / הסתרה / מחיקה — בעלים ומנהל חנות בלבד (staff_can('admin');
--    לא קופאי, לא מחסנאי, לא סוכן). התראה בפעמון לכל המנהלים על ביקורת חדשה.
-- 3. site_settings.reviews_enabled — הצגת ביקורות וטופס "כתוב ביקורת" באתר
--    (ברירת מחדל: פעיל).
-- 4. סיכומי דירוג (ממוצע + מספר ביקורות) — לעמוד המוצר, לכרטיסי הקטלוג
--    ול-JSON-LD של גוגל (aggregateRating).
--
-- מוצרים קשורים (Upsell) — כבר קיימים מחלק 5 (product_relations + הבחירה
-- בעריכת מוצר); בחלק הזה רק התצוגה בעמוד המוצר השתדרגה.
--
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

-- ============================================================
-- 1. הטבלה
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT public.current_tenant_id()
                     REFERENCES public.tenants(id) ON DELETE RESTRICT,
  product_id         uuid NOT NULL,
  customer_name      text NOT NULL,
  rating             smallint NOT NULL,
  content            text NOT NULL,
  is_approved        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- לקוח מחובר שכתב (NULL = אורח); לא נחשף באתר
  user_id            uuid,
  -- הלקוח קנה את המוצר בחנות (נקבע במסד בזמן השליחה)
  verified_purchase  boolean NOT NULL DEFAULT false,
  approved_at        timestamptz,
  approved_by        uuid,
  CONSTRAINT product_reviews_product_fkey FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.global_products(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT product_reviews_user_fkey FOREIGN KEY (tenant_id, user_id)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (user_id),
  CONSTRAINT product_reviews_approved_by_fkey FOREIGN KEY (tenant_id, approved_by)
    REFERENCES public.user_roles(tenant_id, user_id) ON DELETE SET NULL (approved_by),
  CONSTRAINT product_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT product_reviews_name_check CHECK (char_length(btrim(customer_name)) BETWEEN 2 AND 60),
  CONSTRAINT product_reviews_content_check CHECK (char_length(btrim(content)) BETWEEN 3 AND 2000),
  CONSTRAINT product_reviews_approval_check CHECK (is_approved OR approved_at IS NULL)
);

COMMENT ON TABLE public.product_reviews IS
  'חוות דעת לקוחות על מוצרים — מוצגות באתר רק אחרי אישור מנהל (חלק 34)';

-- הביקורות המאושרות של מוצר (עמוד המוצר), ותור האישור (ניהול)
CREATE INDEX IF NOT EXISTS product_reviews_product_idx
  ON public.product_reviews (tenant_id, product_id, created_at DESC) WHERE is_approved;
CREATE INDEX IF NOT EXISTS product_reviews_pending_idx
  ON public.product_reviews (tenant_id, created_at DESC) WHERE NOT is_approved;
-- לקוח מחובר — ביקורת אחת לכל מוצר
CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_one_per_customer
  ON public.product_reviews (tenant_id, product_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.product_reviews;
CREATE POLICY tenant_isolation ON public.product_reviews
  AS RESTRICTIVE FOR ALL TO public
  USING (tenant_id = (SELECT public.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.current_tenant_id()));
-- קריאה ישירה של הטבלה (כולל ממתינות) — רק בעלים / מנהל חנות.
-- האתר קורא דרך product_reviews_public / product_review_summary.
DROP POLICY IF EXISTS "reviews readable by store managers" ON public.product_reviews;
CREATE POLICY "reviews readable by store managers" ON public.product_reviews
  FOR SELECT TO authenticated
  USING (public.staff_can('admin'));

-- כתיבה — רק דרך הפונקציות למטה (SECURITY DEFINER)
REVOKE ALL ON public.product_reviews FROM anon, authenticated;
GRANT SELECT ON public.product_reviews TO authenticated;
GRANT ALL ON public.product_reviews TO service_role;

-- ============================================================
-- 2. הגדרת החנות + סוג התראה חדש
-- ============================================================
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS reviews_enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.site_settings.reviews_enabled IS
  'חלק 34: הצגת ביקורות הלקוחות וטופס "כתוב ביקורת" בעמוד המוצר';

ALTER TABLE public.staff_notifications DROP CONSTRAINT IF EXISTS staff_notifications_kind_check;
ALTER TABLE public.staff_notifications ADD CONSTRAINT staff_notifications_kind_check
  CHECK (kind IN ('new_customer', 'new_order', 'out_of_stock', 'system', 'new_review'));

-- האם הביקורות פעילות בחנות של האתר
CREATE OR REPLACE FUNCTION public.reviews_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.reviews_enabled FROM public.site_settings s
      WHERE s.tenant_id = public.current_tenant_id() LIMIT 1),
    true);
$$;
REVOKE ALL ON FUNCTION public.reviews_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reviews_enabled() TO anon, authenticated, service_role;

-- ============================================================
-- 3. שליחת ביקורת (מפעולת השרת בלבד — service_role)
--    _user_id = הלקוח המחובר (השרת אימת את החיבור), או NULL לאורח.
-- ============================================================
CREATE OR REPLACE FUNCTION public.product_review_submit(
  _product_id uuid,
  _customer_name text,
  _rating integer,
  _content text,
  _user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _name text := btrim(regexp_replace(COALESCE(_customer_name, ''), '\s+', ' ', 'g'));
  _text text := replace(COALESCE(_content, ''), E'\r\n', E'\n');
  _product RECORD;
  _member RECORD;
  _verified boolean := false;
  _id uuid;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF NOT public.reviews_enabled() THEN
    RAISE EXCEPTION 'כתיבת ביקורות אינה פעילה בחנות הזו' USING ERRCODE = 'check_violation';
  END IF;

  SELECT gp.id, gp.name INTO _product
    FROM public.global_products gp
   WHERE gp.id = _product_id AND gp.tenant_id = _tenant AND NOT gp.is_hidden;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'המוצר לא נמצא' USING ERRCODE = 'check_violation';
  END IF;

  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'בחרו דירוג בין 1 ל-5 כוכבים' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'השם: בין 2 ל-60 תווים' USING ERRCODE = 'check_violation';
  END IF;
  -- תווי בקרה (חוץ משורה חדשה) החוצה, שורות ריקות מרובות → שורה ריקה אחת
  _text := regexp_replace(replace(_text, E'\t', ' '), E'[\\x01-\\x08\\x0B-\\x1F\\x7F]', '', 'g');
  _text := btrim(regexp_replace(_text, E'\\n{3,}', E'\n\n', 'g'), E' \n');
  IF char_length(_text) < 3 THEN
    RAISE EXCEPTION 'נא לכתוב כמה מילים על המוצר' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(_text) > 2000 THEN
    RAISE EXCEPTION 'הביקורת ארוכה מדי (עד 2000 תווים)' USING ERRCODE = 'check_violation';
  END IF;
  -- קישורים = ספאם (גם בשם)
  IF (_text || ' ' || _name) ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|co\.il|ru|xyz|info|biz|io|ly)\M)' THEN
    RAISE EXCEPTION 'אי אפשר לכלול קישורים בביקורת' USING ERRCODE = 'check_violation';
  END IF;

  IF _user_id IS NOT NULL THEN
    SELECT ur.role, ur.is_blocked INTO _member
      FROM public.user_roles ur
     WHERE ur.user_id = _user_id AND ur.tenant_id = _tenant;
    IF NOT FOUND THEN
      _user_id := NULL;  -- חשבון של חנות אחרת — נשמר כאורח
    ELSIF _member.is_blocked THEN
      RAISE EXCEPTION 'החשבון חסום — לא ניתן לכתוב ביקורת' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF _user_id IS NOT NULL THEN
    -- שני שליחות במקביל של אותו לקוח — אחת אחרי השנייה
    PERFORM pg_advisory_xact_lock(hashtextextended('review:' || _tenant::text || ':' || _product_id::text || ':' || _user_id::text, 0));
    IF EXISTS (SELECT 1 FROM public.product_reviews r
                WHERE r.tenant_id = _tenant AND r.product_id = _product_id AND r.user_id = _user_id) THEN
      RAISE EXCEPTION 'כבר כתבת ביקורת על המוצר הזה — תודה!' USING ERRCODE = 'unique_violation';
    END IF;
    -- "רכישה מאומתת": הזמנה של הלקוח עם המוצר, שכבר יצאה אליו
    SELECT EXISTS (
      SELECT 1
        FROM public.orders o
        JOIN public.order_items oi ON oi.order_id = o.id
       WHERE o.tenant_id = _tenant AND o.customer_id = _user_id AND o.kind = 'order'
         AND o.status IN ('picked', 'awaiting_courier', 'shipped', 'delivered')
         AND oi.product_id = _product_id AND NOT oi.is_deposit
    ) INTO _verified;
  END IF;

  -- אותה ביקורת בדיוק נשלחה כבר היום (לחיצה כפולה / רענון)
  IF EXISTS (SELECT 1 FROM public.product_reviews r
              WHERE r.tenant_id = _tenant AND r.product_id = _product_id
                AND lower(r.customer_name) = lower(_name) AND r.content = _text
                AND r.created_at > now() - interval '1 day') THEN
    RAISE EXCEPTION 'הביקורת הזו כבר נשלחה — היא ממתינה לאישור' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.product_reviews
    (tenant_id, product_id, customer_name, rating, content, is_approved, user_id, verified_purchase)
  VALUES
    (_tenant, _product_id, _name, _rating, _text, false, _user_id, _verified)
  RETURNING id INTO _id;

  -- התראה בפעמון לבעלים ולמנהלים
  INSERT INTO public.staff_notifications (tenant_id, user_id, kind, title, body, link)
  SELECT _tenant, ur.user_id, 'new_review', 'ביקורת חדשה ממתינה לאישור',
         _product.name || ' · ' || repeat('★', _rating) || ' · ' || _name,
         '/admin?tab=reviews'
    FROM public.user_roles ur
   WHERE ur.tenant_id = _tenant AND ur.role = 'admin' AND NOT ur.is_blocked;

  RETURN jsonb_build_object('id', _id, 'verified_purchase', _verified);
END $$;
REVOKE ALL ON FUNCTION public.product_review_submit(uuid, text, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_review_submit(uuid, text, integer, text, uuid) TO service_role;

-- ============================================================
-- 4. קריאה באתר: ביקורות מאושרות + סיכומים (בלי מזהה הכותב)
-- ============================================================
CREATE OR REPLACE FUNCTION public.product_reviews_public(
  _product_id uuid,
  _limit integer DEFAULT 10,
  _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  customer_name text,
  rating smallint,
  content text,
  created_at timestamptz,
  verified_purchase boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.customer_name, r.rating, r.content, r.created_at, r.verified_purchase
    FROM public.product_reviews r
    JOIN public.global_products gp ON gp.tenant_id = r.tenant_id AND gp.id = r.product_id
   WHERE r.tenant_id = public.current_tenant_id()
     AND r.product_id = _product_id
     AND r.is_approved
     AND NOT gp.is_hidden
     AND public.reviews_enabled()
   ORDER BY r.created_at DESC, r.id
   LIMIT LEAST(GREATEST(COALESCE(_limit, 10), 1), 50)
  OFFSET GREATEST(COALESCE(_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.product_reviews_public(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_reviews_public(uuid, integer, integer) TO anon, authenticated, service_role;

-- ממוצע, מספר ביקורות והתפלגות הכוכבים של מוצר
CREATE OR REPLACE FUNCTION public.product_review_summary(_product_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH approved AS (
    SELECT r.rating
      FROM public.product_reviews r
      JOIN public.global_products gp ON gp.tenant_id = r.tenant_id AND gp.id = r.product_id
     WHERE r.tenant_id = public.current_tenant_id()
       AND r.product_id = _product_id
       AND r.is_approved
       AND NOT gp.is_hidden
       AND public.reviews_enabled()
  )
  SELECT jsonb_build_object(
    'enabled', public.reviews_enabled(),
    'count', (SELECT count(*) FROM approved),
    'average', (SELECT round(avg(rating)::numeric, 1) FROM approved),
    'distribution', jsonb_build_object(
      '5', (SELECT count(*) FROM approved WHERE rating = 5),
      '4', (SELECT count(*) FROM approved WHERE rating = 4),
      '3', (SELECT count(*) FROM approved WHERE rating = 3),
      '2', (SELECT count(*) FROM approved WHERE rating = 2),
      '1', (SELECT count(*) FROM approved WHERE rating = 1)));
$$;
REVOKE ALL ON FUNCTION public.product_review_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_review_summary(uuid) TO anon, authenticated, service_role;

-- כל המוצרים של החנות עם ביקורות מאושרות — לכוכבים בכרטיסי הקטלוג
CREATE OR REPLACE FUNCTION public.product_rating_summaries()
RETURNS TABLE(product_id uuid, review_count integer, average_rating numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.product_id, count(*)::integer, round(avg(r.rating)::numeric, 1)
    FROM public.product_reviews r
    JOIN public.global_products gp ON gp.tenant_id = r.tenant_id AND gp.id = r.product_id
   WHERE r.tenant_id = public.current_tenant_id()
     AND r.is_approved
     AND NOT gp.is_hidden
     AND public.reviews_enabled()
   GROUP BY r.product_id
   ORDER BY r.product_id;
$$;
REVOKE ALL ON FUNCTION public.product_rating_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_rating_summaries() TO anon, authenticated, service_role;

-- ============================================================
-- 5. ניהול: רשימה ואישור / הסתרה / מחיקה — בעלים ומנהל חנות בלבד
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_product_reviews(_status text DEFAULT 'pending')
RETURNS TABLE(
  id uuid,
  product_id uuid,
  product_name text,
  product_image_url text,
  product_hidden boolean,
  customer_name text,
  customer_email text,
  rating smallint,
  content text,
  is_approved boolean,
  verified_purchase boolean,
  created_at timestamptz,
  approved_at timestamptz,
  approved_by_name text
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
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('admin') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(_status, '') NOT IN ('pending', 'approved', 'all') THEN
    RAISE EXCEPTION 'סינון לא תקין' USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
    SELECT r.id, r.product_id, gp.name, gp.image_url, gp.is_hidden,
           r.customer_name, u.email, r.rating, r.content, r.is_approved, r.verified_purchase,
           r.created_at, r.approved_at,
           COALESCE(NULLIF(btrim(a.display_name), ''), a.username, a.email)
      FROM public.product_reviews r
      JOIN public.global_products gp ON gp.tenant_id = r.tenant_id AND gp.id = r.product_id
      LEFT JOIN public.user_roles u ON u.tenant_id = r.tenant_id AND u.user_id = r.user_id
      LEFT JOIN public.user_roles a ON a.tenant_id = r.tenant_id AND a.user_id = r.approved_by
     WHERE r.tenant_id = _tenant
       AND (_status = 'all'
            OR (_status = 'pending' AND NOT r.is_approved)
            OR (_status = 'approved' AND r.is_approved))
     ORDER BY CASE WHEN _status = 'pending' THEN r.created_at END ASC,
              r.created_at DESC, r.id
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.admin_product_reviews(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_product_reviews(text) TO authenticated, service_role;

-- אישור / הסתרה / מחיקה של ביקורת אחת או כמה (סימון מרובה). מחזיר כמה עודכנו.
CREATE OR REPLACE FUNCTION public.admin_review_moderate(_ids uuid[], _action text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _count integer;
BEGIN
  IF auth.uid() IS NULL OR _tenant IS NULL OR NOT public.staff_can('admin') THEN
    RAISE EXCEPTION 'אין לך הרשאה מתאימה' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN
    RAISE EXCEPTION 'לא נבחרו ביקורות' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(_ids) > 500 THEN
    RAISE EXCEPTION 'עד 500 ביקורות בפעולה אחת' USING ERRCODE = 'check_violation';
  END IF;

  IF _action = 'approve' THEN
    UPDATE public.product_reviews r
       SET is_approved = true, approved_at = now(), approved_by = public.tenant_member_id()
     WHERE r.tenant_id = _tenant AND r.id = ANY (_ids) AND NOT r.is_approved;
  ELSIF _action = 'hide' THEN
    UPDATE public.product_reviews r
       SET is_approved = false, approved_at = NULL, approved_by = NULL
     WHERE r.tenant_id = _tenant AND r.id = ANY (_ids) AND r.is_approved;
  ELSIF _action = 'delete' THEN
    DELETE FROM public.product_reviews r
     WHERE r.tenant_id = _tenant AND r.id = ANY (_ids);
  ELSE
    RAISE EXCEPTION 'פעולה לא תקינה' USING ERRCODE = 'check_violation';
  END IF;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END $$;
REVOKE ALL ON FUNCTION public.admin_review_moderate(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_moderate(uuid[], text) TO authenticated, service_role;

COMMIT;

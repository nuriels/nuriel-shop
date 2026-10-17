-- ============================================================
-- חלק 39ב: הצעת מחיר שבעל החנות (או צוות עם הרשאת קופה) שולח ללקוח
--
-- נבנית בקופה המהירה → "שליחה כהצעת מחיר" → קישור /cart/{code} (אותו מנגנון
-- של שיתוף עגלה — חלק 39), עם שם הלקוח, הערה ותוקף. הלקוח בוחר מה לאשר
-- ועובר לקופה. המחירים — כמו בשיתוף עגלה — לפי מי שפותח (לא נשמר מחיר).
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

ALTER TABLE public.shared_carts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'cart',
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_carts_kind_check') THEN
    ALTER TABLE public.shared_carts ADD CONSTRAINT shared_carts_kind_check
      CHECK (kind IN ('cart', 'quote'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_carts_quote_text_check') THEN
    ALTER TABLE public.shared_carts ADD CONSTRAINT shared_carts_quote_text_check
      CHECK (char_length(COALESCE(customer_name, '')) <= 120 AND char_length(COALESCE(note, '')) <= 2000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_quote(
  _items jsonb, _customer_name text DEFAULT NULL, _note text DEFAULT NULL, _valid_days integer DEFAULT 7)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.staff_can('pos') THEN
    RAISE EXCEPTION 'רק צוות החנות יכול לשלוח הצעת מחיר' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _valid_days IS NULL OR _valid_days < 1 OR _valid_days > 90 THEN
    RAISE EXCEPTION 'תוקף ההצעה: בין יום אחד ל-90 ימים' USING ERRCODE = 'check_violation';
  END IF;
  IF char_length(COALESCE(_customer_name, '')) > 120 OR char_length(COALESCE(_note, '')) > 2000 THEN
    RAISE EXCEPTION 'שם הלקוח או ההערה ארוכים מדי' USING ERRCODE = 'check_violation';
  END IF;
  -- אותן בדיקות של שיתוף עגלה (מוצרים של החנות, כמויות, הגבלת קצב)
  _code := public.create_shared_cart(_items);
  UPDATE public.shared_carts
     SET kind = 'quote',
         customer_name = NULLIF(btrim(_customer_name), ''),
         note = NULLIF(btrim(_note), ''),
         expires_at = now() + make_interval(days => _valid_days)
   WHERE code = _code;
  RETURN _code;
END $$;
REVOKE ALL ON FUNCTION public.create_quote(jsonb, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_quote(jsonb, text, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_shared_cart(_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('items', c.items, 'created_at', c.created_at, 'expires_at', c.expires_at,
                            'kind', c.kind, 'customer_name', c.customer_name, 'note', c.note)
    FROM public.shared_carts c
   WHERE c.code = btrim(_code)
     AND c.tenant_id = public.current_tenant_id()
     AND c.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.get_shared_cart(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_cart(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

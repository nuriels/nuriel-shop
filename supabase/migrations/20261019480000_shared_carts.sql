-- ============================================================
-- חלק 39: שיתוף עגלה בקישור
--
-- לקוח (או בעל החנות) לוחץ "שיתוף העגלה" → נשמרת "תמונה" של העגלה עם קוד
-- קצר → קישור /cart/{code}. מי שפותח את הקישור רואה את המוצרים, בוחר אילו
-- להוסיף (ובאיזו כמות) — והם נכנסים לעגלה שלו.
--
-- נשמרים רק מזהי מוצרים / וריאציות וכמויות — לא מחירים: המחיר תמיד מחושב
-- לפי מי שפותח (מחירון אישי / דרג), כך שאף אחד לא "מקבל" מחיר של אחר.
-- אין גישה ישירה לטבלה — רק דרך שתי פונקציות, כל חנות רק את שלה.
-- ניתן להרצה חוזרת.
-- ============================================================
BEGIN;
SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.shared_carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9]{8}$'),
  items       jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'
                                    AND jsonb_array_length(items) BETWEEN 1 AND 100),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '90 days'
);
CREATE INDEX IF NOT EXISTS shared_carts_tenant_created_idx ON public.shared_carts (tenant_id, created_at DESC);
ALTER TABLE public.shared_carts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_carts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.shared_carts TO service_role;

-- יצירת קישור: [{ product_id, variant_id?, quantity }] → קוד בן 8 תווים
CREATE OR REPLACE FUNCTION public.create_shared_cart(_items jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant uuid := public.current_tenant_id();
  _clean jsonb := '[]'::jsonb;
  _item jsonb;
  _pid uuid;
  _vid uuid;
  _qty integer;
  _code text;
  _alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'החנות לא זוהתה';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array'
     OR jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 100 THEN
    RAISE EXCEPTION 'העגלה ריקה או גדולה מדי (עד 100 שורות)' USING ERRCODE = 'check_violation';
  END IF;
  -- הגנה מהצפה: עד 300 קישורים בשעה לחנות
  IF (SELECT count(*) FROM public.shared_carts
       WHERE tenant_id = _tenant AND created_at > now() - interval '1 hour') >= 300 THEN
    RAISE EXCEPTION 'יותר מדי קישורים נוצרו בשעה האחרונה — נסו שוב מאוחר יותר'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      _pid := (_item ->> 'product_id')::uuid;
      _vid := NULLIF(_item ->> 'variant_id', '')::uuid;
      _qty := (_item ->> 'quantity')::integer;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'שורה לא תקינה בעגלה' USING ERRCODE = 'check_violation';
    END;
    IF _qty IS NULL OR _qty < 1 OR _qty > 100000 THEN
      RAISE EXCEPTION 'כמות לא תקינה' USING ERRCODE = 'check_violation';
    END IF;
    -- רק מוצרים של החנות הזו שמוצגים באתר
    IF NOT EXISTS (SELECT 1 FROM public.global_products p
                    WHERE p.id = _pid AND p.tenant_id = _tenant AND NOT p.is_hidden) THEN
      CONTINUE;
    END IF;
    _clean := _clean || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', _pid, 'variant_id', _vid, 'quantity', _qty)));
  END LOOP;
  IF jsonb_array_length(_clean) = 0 THEN
    RAISE EXCEPTION 'אין בעגלה מוצרים שאפשר לשתף' USING ERRCODE = 'check_violation';
  END IF;

  LOOP
    SELECT string_agg(substr(_alphabet, 1 + floor(random() * length(_alphabet))::int, 1), '')
      INTO _code FROM generate_series(1, 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.shared_carts WHERE code = _code);
  END LOOP;
  INSERT INTO public.shared_carts (tenant_id, code, items, created_by)
  VALUES (_tenant, _code, _clean, auth.uid());
  RETURN _code;
END $$;
REVOKE ALL ON FUNCTION public.create_shared_cart(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shared_cart(jsonb) TO anon, authenticated, service_role;

-- פתיחת קישור: השורות (רק מהחנות של הבקשה; פג תוקף → NULL)
CREATE OR REPLACE FUNCTION public.get_shared_cart(_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('items', c.items, 'created_at', c.created_at, 'expires_at', c.expires_at)
    FROM public.shared_carts c
   WHERE c.code = btrim(_code)
     AND c.tenant_id = public.current_tenant_id()
     AND c.expires_at > now();
$$;
REVOKE ALL ON FUNCTION public.get_shared_cart(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_cart(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

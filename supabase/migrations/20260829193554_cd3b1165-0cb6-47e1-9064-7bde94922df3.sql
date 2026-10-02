-- 1. Warehouse location fields
ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS shelf_number TEXT NOT NULL DEFAULT '0',
  ADD COLUMN IF NOT EXISTS row_number   TEXT NOT NULL DEFAULT '0';

-- 2. Orders
CREATE TABLE public.orders (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id     UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled')),
  total        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id           UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_store_idx ON public.orders (store_id, created_at DESC);
CREATE INDEX order_items_order_idx ON public.order_items (order_id);

-- 3. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;

-- 4. RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders select" ON public.orders
FOR SELECT TO authenticated USING (public.owns_store(store_id, auth.uid()));
CREATE POLICY "orders insert" ON public.orders
FOR INSERT TO authenticated WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "orders update" ON public.orders
FOR UPDATE TO authenticated USING (public.owns_store(store_id, auth.uid()))
WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "orders delete" ON public.orders
FOR DELETE TO authenticated USING (public.owns_store(store_id, auth.uid()));

CREATE POLICY "order items select" ON public.order_items
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.owns_store(o.store_id, auth.uid())));
CREATE POLICY "order items insert" ON public.order_items
FOR INSERT TO authenticated WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.owns_store(o.store_id, auth.uid())));
CREATE POLICY "order items update" ON public.order_items
FOR UPDATE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.owns_store(o.store_id, auth.uid())))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.owns_store(o.store_id, auth.uid())));
CREATE POLICY "order items delete" ON public.order_items
FOR DELETE TO authenticated USING (EXISTS (
  SELECT 1 FROM public.orders o WHERE o.id = order_id AND public.owns_store(o.store_id, auth.uid())));

CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Approve order + deduct stock
CREATE OR REPLACE FUNCTION public.approve_order(_order_id UUID, _cancelled_item_ids UUID[] DEFAULT '{}', _quantities JSONB DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _store UUID;
  _status TEXT;
  it RECORD;
  _new_total NUMERIC := 0;
BEGIN
  SELECT store_id, status INTO _store, _status FROM public.orders WHERE id = _order_id;
  IF _store IS NULL THEN RAISE EXCEPTION 'ההזמנה לא נמצאה'; END IF;
  IF NOT public.owns_store(_store, auth.uid()) THEN RAISE EXCEPTION 'אין הרשאה לאשר הזמנה זו'; END IF;
  IF _status <> 'pending' THEN RAISE EXCEPTION 'ההזמנה כבר טופלה'; END IF;

  -- apply manager edits
  UPDATE public.order_items SET is_cancelled = true
  WHERE order_id = _order_id AND id = ANY(_cancelled_item_ids);

  UPDATE public.order_items oi
  SET quantity = GREATEST(1, (_quantities ->> oi.id::text)::int)
  WHERE oi.order_id = _order_id AND _quantities ? oi.id::text;

  FOR it IN
    SELECT id, product_id, quantity, unit_price FROM public.order_items
    WHERE order_id = _order_id AND is_cancelled = false
  LOOP
    UPDATE public.store_inventory
    SET stock_quantity = GREATEST(0, stock_quantity - it.quantity)
    WHERE store_id = _store AND product_id = it.product_id;
    _new_total := _new_total + (it.quantity * it.unit_price);
  END LOOP;

  UPDATE public.orders SET status = 'approved', total = _new_total WHERE id = _order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_order(uuid, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_order(uuid, uuid[], jsonb) TO authenticated, service_role;
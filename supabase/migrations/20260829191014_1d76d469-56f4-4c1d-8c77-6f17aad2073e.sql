-- Master catalog + per-store inventory
CREATE OR REPLACE FUNCTION public.generate_sku()
RETURNS varchar LANGUAGE plpgsql SET search_path = public AS $$
DECLARE candidate varchar(8);
BEGIN
  LOOP
    candidate := lpad((floor(random() * 100000000))::bigint::text, 8, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.global_products WHERE sku = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE TABLE public.global_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku VARCHAR(8) NOT NULL UNIQUE CHECK (sku ~ '^[0-9]{8}$'),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('עגילים','שרשרת','טבעת','שעון','סט')),
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  image_url TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.store_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.global_products(id) ON DELETE CASCADE,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.global_products TO authenticated;
GRANT ALL ON public.global_products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_inventory TO authenticated;
GRANT ALL ON public.store_inventory TO service_role;

ALTER TABLE public.global_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;

-- helper: does the current user own the store (or is super admin)
CREATE OR REPLACE FUNCTION public.owns_store(_store_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.stores s
        WHERE s.id = _store_id AND s.owner_id = _user_id AND public.is_approved(_user_id)
      );
$$;
REVOKE ALL ON FUNCTION public.owns_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_store(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_sku() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_sku() TO authenticated, service_role;

-- global_products: every approved user reads; creator or super admin writes
CREATE POLICY "products readable by approved" ON public.global_products
FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()) OR public.is_approved(auth.uid()));

CREATE POLICY "products insert by approved" ON public.global_products
FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid())
       OR (created_by = auth.uid() AND public.is_approved(auth.uid())));

CREATE POLICY "products update by creator" ON public.global_products
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()) OR (created_by = auth.uid() AND public.is_approved(auth.uid())))
WITH CHECK (public.is_super_admin(auth.uid()) OR (created_by = auth.uid() AND public.is_approved(auth.uid())));

CREATE POLICY "products delete by super admin" ON public.global_products
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

-- store_inventory: only own stores; super admin bypass
CREATE POLICY "inventory select" ON public.store_inventory
FOR SELECT TO authenticated USING (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory insert" ON public.store_inventory
FOR INSERT TO authenticated WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory update" ON public.store_inventory
FOR UPDATE TO authenticated USING (public.owns_store(store_id, auth.uid()))
WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory delete" ON public.store_inventory
FOR DELETE TO authenticated USING (public.owns_store(store_id, auth.uid()));

-- selling_price must never be below cost_price
CREATE OR REPLACE FUNCTION public.check_selling_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cost NUMERIC;
BEGIN
  SELECT cost_price INTO cost FROM public.global_products WHERE id = NEW.product_id;
  IF cost IS NOT NULL AND NEW.selling_price < cost THEN
    RAISE EXCEPTION 'מחיר המכירה אינו יכול להיות נמוך ממחיר העלות';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER store_inventory_price_guard
BEFORE INSERT OR UPDATE ON public.store_inventory
FOR EACH ROW EXECUTE FUNCTION public.check_selling_price();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER global_products_updated_at BEFORE UPDATE ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER store_inventory_updated_at BEFORE UPDATE ON public.store_inventory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
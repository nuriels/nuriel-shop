-- ============================================================
-- נוריאל מחשבים | Multi-store inventory management schema
-- ============================================================

-- 1. Tables ---------------------------------------------------
CREATE TABLE public.user_roles (
  user_id        UUID PRIMARY KEY,          -- matches auth.users.id
  email          TEXT NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  is_approved    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.stores (
  id         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL,                 -- matches auth.users.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Data API grants (required by PostgREST) ------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;

-- 3. Security definer helpers (avoid RLS recursion) -----------
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND is_super_admin = true);
$$;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND is_approved = true);
$$;

REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_approved(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_approved(uuid) TO authenticated, service_role;

-- 4. RLS ------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- user_roles: own row visible; super admin sees/manages everything
CREATE POLICY "own role readable" ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

-- new sign-ups may only create their own pending, non-admin row
CREATE POLICY "self register pending" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND is_super_admin = false AND is_approved = false);

CREATE POLICY "super admin updates roles" ON public.user_roles
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super admin deletes roles" ON public.user_roles
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

-- stores: unapproved users get nothing; approved users get their own rows;
-- super admins get every row (read/insert/update/delete).
CREATE POLICY "stores select" ON public.stores
FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid())
       OR (owner_id = auth.uid() AND public.is_approved(auth.uid())));

CREATE POLICY "stores insert" ON public.stores
FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid())
       OR (owner_id = auth.uid() AND public.is_approved(auth.uid())));

CREATE POLICY "stores update" ON public.stores
FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid())
       OR (owner_id = auth.uid() AND public.is_approved(auth.uid())))
WITH CHECK (public.is_super_admin(auth.uid())
       OR (owner_id = auth.uid() AND public.is_approved(auth.uid())));

CREATE POLICY "stores delete" ON public.stores
FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid())
       OR (owner_id = auth.uid() AND public.is_approved(auth.uid())));

-- 5. Seed: super admin account -------------------------------
-- nuriel.sh1@gmail.com / 0505492178
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
)
SELECT '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       'nuriel.sh1@gmail.com', crypt('0505492178', gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'nuriel.sh1@gmail.com');

INSERT INTO public.user_roles (user_id, email, is_super_admin, is_approved)
SELECT id, email, true, true FROM auth.users WHERE email = 'nuriel.sh1@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET is_super_admin = true, is_approved = true;

-- ============================================================
-- Phase 2 | Master catalog & smart inventory
-- ============================================================

-- 1. SKU generator (8 random unique digits) --------------------
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

-- 2. Tables ---------------------------------------------------
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

-- 3. Data API grants ------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.global_products TO authenticated;
GRANT ALL ON public.global_products TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_inventory TO authenticated;
GRANT ALL ON public.store_inventory TO service_role;

ALTER TABLE public.global_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;

-- 4. Store ownership helper -----------------------------------
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

-- 5. RLS: global_products (read for approved, write for creator/admin)
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

-- 6. RLS: store_inventory (own stores only, super admin bypass)
CREATE POLICY "inventory select" ON public.store_inventory
FOR SELECT TO authenticated USING (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory insert" ON public.store_inventory
FOR INSERT TO authenticated WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory update" ON public.store_inventory
FOR UPDATE TO authenticated USING (public.owns_store(store_id, auth.uid()))
WITH CHECK (public.owns_store(store_id, auth.uid()));
CREATE POLICY "inventory delete" ON public.store_inventory
FOR DELETE TO authenticated USING (public.owns_store(store_id, auth.uid()));

-- 7. selling_price >= cost_price guard ------------------------
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
REVOKE ALL ON FUNCTION public.check_selling_price() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_selling_price() TO service_role;

CREATE TRIGGER store_inventory_price_guard
BEFORE INSERT OR UPDATE ON public.store_inventory
FOR EACH ROW EXECUTE FUNCTION public.check_selling_price();

-- 8. updated_at triggers --------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER global_products_updated_at BEFORE UPDATE ON public.global_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER store_inventory_updated_at BEFORE UPDATE ON public.store_inventory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

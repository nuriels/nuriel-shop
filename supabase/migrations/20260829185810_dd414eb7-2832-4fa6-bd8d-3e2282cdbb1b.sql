CREATE TABLE public.user_roles (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.stores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT ALL ON public.stores TO service_role;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND is_super_admin = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND is_approved = true
  );
$$;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own role readable" ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));

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

CREATE POLICY "stores select" ON public.stores
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (owner_id = auth.uid() AND public.is_approved(auth.uid()))
);

CREATE POLICY "stores insert" ON public.stores
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (owner_id = auth.uid() AND public.is_approved(auth.uid()))
);

CREATE POLICY "stores update" ON public.stores
FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (owner_id = auth.uid() AND public.is_approved(auth.uid()))
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (owner_id = auth.uid() AND public.is_approved(auth.uid()))
);

CREATE POLICY "stores delete" ON public.stores
FOR DELETE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (owner_id = auth.uid() AND public.is_approved(auth.uid()))
);
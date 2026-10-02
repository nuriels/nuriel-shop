ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS colors text[] NOT NULL DEFAULT '{}'::text[];
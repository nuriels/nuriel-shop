ALTER TABLE public.global_products
  ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.global_products
SET images = ARRAY[image_url]
WHERE image_url IS NOT NULL AND cardinality(images) = 0;
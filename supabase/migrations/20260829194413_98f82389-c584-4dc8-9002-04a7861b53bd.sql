ALTER TABLE public.global_products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS global_products_barcode_key ON public.global_products (barcode) WHERE barcode IS NOT NULL;
-- ============================================================
-- חלק 36: מילות מפתח למוצר (global_products.seo_keywords) — ניקוי ובדיקות
-- ============================================================
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
INSERT INTO public.categories (tenant_id, name) VALUES ('70000000-0000-0000-0000-00000000000b', 'בדיקת SEO') ON CONFLICT DO NOTHING;
INSERT INTO public.global_products (id, tenant_id, sku, name, category, created_by, price_tier1, price_tier2, stock_quantity) VALUES
  ('8b000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000b', '97200001', 'נעלי ריצה', 'בדיקת SEO', 'a0000000-0000-0000-0000-0000000000b1', 300, 300, 5)
ON CONFLICT DO NOTHING;

SELECT tests.check('seo: seo_title / seo_description / seo_keywords columns exist',
  $$SELECT count(*) = 3 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'global_products'
       AND column_name IN ('seo_title', 'seo_description', 'seo_keywords')$$);
SELECT tests.run('seo: owner saves title, description and keywords',
  $$UPDATE public.global_products SET seo_title = 'נעלי ריצה לנשים | החנות', seo_description = 'נעלי ריצה קלות במשלוח מהיר',
           seo_keywords = ' נעלי ריצה ,  נעלי  ספורט;נעלי ריצה, Running Shoes
running shoes,,, ' WHERE id = '8b000000-0000-0000-0000-000000000001'$$, :B1, NULL, 1);
SELECT tests.check('seo: keywords cleaned — trimmed, spaces collapsed, duplicates removed (case-insensitive)',
  $$SELECT seo_keywords = 'נעלי ריצה, נעלי ספורט, Running Shoes' FROM public.global_products WHERE id = '8b000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('seo: only commas / spaces → NULL',
  $$UPDATE public.global_products SET seo_keywords = ' , ;  ' WHERE id = '8b000000-0000-0000-0000-000000000001'$$, :B1, NULL, 1);
SELECT tests.check('seo: … stored as NULL',
  $$SELECT seo_keywords IS NULL FROM public.global_products WHERE id = '8b000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('seo: a keyword over 60 chars → rejected',
  $$UPDATE public.global_products SET seo_keywords = repeat('א', 61) WHERE id = '8b000000-0000-0000-0000-000000000001'$$, :B1, 'ארוכה מדי');
SELECT tests.run('seo: more than 30 keywords → rejected',
  $$UPDATE public.global_products SET seo_keywords = (SELECT string_agg('מילה' || g, ',') FROM generate_series(1, 31) g) WHERE id = '8b000000-0000-0000-0000-000000000001'$$, :B1, 'עד 30');
SELECT tests.check('seo: normalize helper is idempotent',
  $$SELECT public.normalize_seo_keywords(public.normalize_seo_keywords('a, b ,A')) = 'a, b'$$);
DELETE FROM public.global_products WHERE id = '8b000000-0000-0000-0000-000000000001';

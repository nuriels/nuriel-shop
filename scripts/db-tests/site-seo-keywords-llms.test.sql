-- מילות מפתח של החנות + מתג llms.txt: ברירות מחדל, שמירה, תקינות, הפרדה בין חנויות
SELECT tests.check('site seo: defaults (no keywords, llms.txt off) for every store',
  $$SELECT bool_and(seo_keywords = '' AND llms_txt_enabled = false) FROM public.site_settings$$);
SELECT tests.run('site seo: admin A saves keywords and turns llms.txt on',
  $$UPDATE public.site_settings SET seo_keywords = 'חנות מחשבים, מחשב נייד', llms_txt_enabled = true WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 1);
SELECT tests.check('site seo: saved in store A only',
  $$SELECT (SELECT seo_keywords = 'חנות מחשבים, מחשב נייד' AND llms_txt_enabled FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')
      AND (SELECT seo_keywords = '' AND NOT llms_txt_enabled FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.run('site seo: keywords over 500 chars rejected',
  $$UPDATE public.site_settings SET seo_keywords = repeat('א', 501) WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', 'seo_keywords_check');
SELECT tests.run('site seo: an agent cannot change the keywords',
  $$UPDATE public.site_settings SET seo_keywords = 'x' WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a2', NULL, 0);
SELECT tests.check('site seo: store A unchanged after the rejected saves',
  $$SELECT seo_keywords = 'חנות מחשבים, מחשב נייד' AND llms_txt_enabled FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);

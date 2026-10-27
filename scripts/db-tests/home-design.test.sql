-- ============================================================
-- עיצוב מסך הבית: באנרים פעילים/מושבתים, פוסטרים, זמן החלפה, הפרדה בין חנויות
-- ============================================================
-- A = 70..0a (מנהל a1, סוכן a2), B = 70..0b (מנהל b1). הבאנרים הקיימים מ-fixtures.sql

-- ---------- נתונים קיימים נשמרים ----------
SELECT tests.check('home design: existing banners stay active after the migration',
  $$SELECT count(*) = 3 AND bool_and(is_active) AND bool_and(desktop_poster_url IS NULL AND mobile_poster_url IS NULL)
      FROM public.home_banner_slides WHERE id IN ('b5000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-0000000000b1', 'b5000000-0000-0000-0000-0000000000b2')$$);
SELECT tests.check('home design: existing banner content is unchanged',
  $$SELECT desktop_image_url = 'https://cdn.test/b-bottom.mp4' AND link_url = 'https://example.com' AND alt_text = 'סרטון B'
      FROM public.home_banner_slides WHERE id = 'b5000000-0000-0000-0000-0000000000b2'$$);
SELECT tests.check('home design: every store gets the old interval (5 seconds) by default',
  $$SELECT bool_and(banner_interval_seconds = 5) FROM public.site_settings
     WHERE tenant_id IN ('70000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.check('home design: existing branding of store B is unchanged',
  $$SELECT logo_path = '70000000-0000-0000-0000-00000000000b/site/logo-1.png' AND brand_color = '#1e3a8a' AND site_title = 'חנות B'
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);

-- ---------- שמירה בחנות A ----------
SELECT tests.run('home design: admin A saves 3 banners (one disabled, video with poster)',
  $$SELECT public.replace_home_banners('[
     {"placement":"top","position":0,"desktop_image_url":"https://cdn.test/a1.webp","alt_text":"א","is_active":true},
     {"placement":"top","position":1,"desktop_image_url":"https://cdn.test/a2.mp4","desktop_poster_url":"https://cdn.test/a2-poster.webp","alt_text":"ב","is_active":false,"link_url":"/product/9c700000-0000-0000-0000-000000000001"},
     {"placement":"bottom","position":0,"mobile_image_url":"https://cdn.test/a3.webp","alt_text":"ג"}
   ]'::jsonb)$$,
  'a0000000-0000-0000-0000-0000000000a1');
SELECT tests.check('home design: store A now has exactly the 3 saved banners',
  $$SELECT count(*) = 3 FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('home design: disabled flag, poster and link saved',
  $$SELECT NOT is_active AND desktop_poster_url = 'https://cdn.test/a2-poster.webp' AND link_url = '/product/9c700000-0000-0000-0000-000000000001'
      FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND placement = 'top' AND position = 1$$);
SELECT tests.check('home design: a banner sent without is_active (old client) stays active',
  $$SELECT is_active FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND placement = 'bottom'$$);
SELECT tests.check('home design: saving in store A did not touch store B banners',
  $$SELECT count(*) = 2 FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);

-- ---------- שמירה בחנות B לא נוגעת ב-A ----------
SELECT tests.run('home design: admin B clears its own banners',
  $$SELECT public.replace_home_banners('[]'::jsonb)$$, 'a0000000-0000-0000-0000-0000000000b1');
SELECT tests.check('home design: store B banners removed, store A banners intact',
  $$SELECT (SELECT count(*) FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000b') = 0
       AND (SELECT count(*) FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000a') = 3$$);
-- מחזירים ל-B את הבאנרים (לסבב הבא של הבדיקות)
INSERT INTO public.home_banner_slides (id, tenant_id, placement, position, desktop_image_url, mobile_image_url, link_url, alt_text) VALUES
  ('b5000000-0000-0000-0000-0000000000b1', '70000000-0000-0000-0000-00000000000b', 'top', 0, 'https://cdn.test/b-top.webp', 'https://cdn.test/b-top-m.webp', NULL, 'באנר B'),
  ('b5000000-0000-0000-0000-0000000000b2', '70000000-0000-0000-0000-00000000000b', 'bottom', 0, 'https://cdn.test/b-bottom.mp4', NULL, 'https://example.com', 'סרטון B')
ON CONFLICT (id) DO NOTHING;

-- ---------- הרשאות ----------
SELECT tests.run('home design: an agent cannot replace the banners',
  $$SELECT public.replace_home_banners('[]'::jsonb)$$, 'a0000000-0000-0000-0000-0000000000a2', 'רק מנהל');
SELECT tests.run('home design: a guest cannot call the save function',
  $$SELECT public.replace_home_banners('[]'::jsonb)$$, NULL, 'permission denied');
SELECT tests.run('home design: admin A cannot write a banner directly into store B',
  $$INSERT INTO public.home_banner_slides (tenant_id, placement, desktop_image_url) VALUES ('70000000-0000-0000-0000-00000000000b', 'top', 'https://cdn.test/x.webp')$$,
  'a0000000-0000-0000-0000-0000000000a1', 'row-level security');
SELECT tests.run('home design: admin A cannot delete store B banners directly',
  $$DELETE FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 0);
SELECT tests.check('home design: store B banners still there after the attempts',
  $$SELECT count(*) = 2 FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);

-- ---------- ולידציה ----------
SELECT tests.run('home design: poster with javascript: is rejected',
  $$SELECT public.replace_home_banners('[{"placement":"top","desktop_image_url":"https://cdn.test/v.mp4","desktop_poster_url":"javascript:alert(1)"}]'::jsonb)$$,
  'a0000000-0000-0000-0000-0000000000a1', 'poster_url_check');
SELECT tests.run('home design: unsafe banner link is still rejected',
  $$SELECT public.replace_home_banners('[{"placement":"top","desktop_image_url":"https://cdn.test/v.webp","link_url":"//evil.example"}]'::jsonb)$$,
  'a0000000-0000-0000-0000-0000000000a1', 'check');
SELECT tests.check('home design: a rejected save leaves store A banners as they were',
  $$SELECT count(*) = 3 FROM public.home_banner_slides WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);

-- ---------- זמן החלפה ----------
SELECT tests.run('home design: admin A sets the interval to 8 seconds',
  $$UPDATE public.site_settings SET banner_interval_seconds = 8 WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 1);
SELECT tests.check('home design: interval changed only in store A',
  $$SELECT (SELECT banner_interval_seconds FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a') = 8
       AND (SELECT banner_interval_seconds FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b') = 5$$);
SELECT tests.run('home design: interval under 3 seconds rejected',
  $$UPDATE public.site_settings SET banner_interval_seconds = 2 WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', 'banner_interval_check');
SELECT tests.run('home design: interval over 15 seconds rejected',
  $$UPDATE public.site_settings SET banner_interval_seconds = 16 WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', 'banner_interval_check');
SELECT tests.run('home design: an agent cannot change the interval',
  $$UPDATE public.site_settings SET banner_interval_seconds = 10 WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a2', NULL, 0);

-- ---------- מיתוג: עדכון שלושת השדות לא נוגע בשאר ההגדרות ולא בחנות אחרת ----------
SELECT tests.run('home design: admin A saves branding only (title, logo, color)',
  $$UPDATE public.site_settings SET site_title = 'חנות A חדשה', logo_path = '70000000-0000-0000-0000-00000000000a/site/logo-2.png', brand_color = '#0f766e' WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 1);
SELECT tests.check('home design: branding of store A saved, store B branding unchanged',
  $$SELECT (SELECT site_title = 'חנות A חדשה' AND brand_color = '#0f766e' AND banner_interval_seconds = 8 FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')
       AND (SELECT site_title = 'חנות B' AND brand_color = '#1e3a8a' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);

-- ---------- קריאה ציבורית: כל חנות רואה רק את הבאנרים שלה ----------
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.run('home design: a guest on store B sees only store B banners',
  $$SELECT 1 FROM public.home_banner_slides$$, NULL, NULL, 2);
SELECT set_config('request.headers', '', false);

-- פס הודעות מתחלף: רשימת הודעות, מצב, זמן החלפה, בדיקות תקינות, הפרדה בין חנויות, מעבר מהמבנה הישן
SELECT tests.check('rotation: defaults (rotate, 5 seconds, no items) for every store',
  $$SELECT bool_and(announcement_mode = 'rotate' AND announcement_interval_seconds = 5) FROM public.site_settings$$);
SELECT tests.run('rotation: admin A saves 3 messages (text / free shipping / coupon + link + end date)',
  $$UPDATE public.site_settings SET announcement_items = '[
      {"id":"a","kind":"text","text":"קולקציה חדשה","coupon_code":null,"link_url":"/?category=%D7%9E%D7%A1%D7%9B%D7%99%D7%9D","ends_at":null,"active":true},
      {"id":"b","kind":"free_shipping","text":"","coupon_code":null,"link_url":null,"ends_at":null,"active":true},
      {"id":"c","kind":"text","text":"קופון","coupon_code":"WELCOME10","link_url":"https://example.com","ends_at":"2030-01-01T00:00:00Z","active":false}]'::jsonb,
      announcement_interval_seconds = 7, announcement_mode = 'marquee' WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 1);
SELECT tests.check('rotation: saved in store A only',
  $$SELECT (SELECT jsonb_array_length(announcement_items) = 3 AND announcement_interval_seconds = 7 AND announcement_mode = 'marquee' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')
      AND (SELECT announcement_items = '[]'::jsonb AND announcement_interval_seconds = 5 FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.run('rotation: 6 messages rejected',
  $$UPDATE public.site_settings SET announcement_items = (SELECT jsonb_agg(jsonb_build_object('id', g, 'kind', 'text', 'text', 'x')) FROM generate_series(1, 6) g) WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', 'rotation_check');
SELECT tests.run('rotation: interval 2 rejected', $$UPDATE public.site_settings SET announcement_interval_seconds = 2 WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'rotation_check');
SELECT tests.run('rotation: interval 11 rejected', $$UPDATE public.site_settings SET announcement_interval_seconds = 11 WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'rotation_check');
SELECT tests.run('rotation: unknown mode rejected', $$UPDATE public.site_settings SET announcement_mode = 'fade' WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'rotation_check');
SELECT tests.run('rotation: javascript: link rejected',
  $$UPDATE public.site_settings SET announcement_items = '[{"id":"x","kind":"text","text":"x","link_url":"javascript:alert(1)"}]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'הקישור בהודעה');
SELECT tests.run('rotation: // link rejected',
  $$UPDATE public.site_settings SET announcement_items = '[{"id":"x","kind":"text","text":"x","link_url":"//evil.example"}]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'הקישור בהודעה');
SELECT tests.run('rotation: text over 200 chars rejected',
  $$UPDATE public.site_settings SET announcement_items = jsonb_build_array(jsonb_build_object('id','x','kind','text','text', repeat('א', 201))) WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'ארוך מדי');
SELECT tests.run('rotation: bad coupon code rejected',
  $$UPDATE public.site_settings SET announcement_items = '[{"id":"x","kind":"text","text":"x","coupon_code":"bad code"}]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'קוד הקופון');
SELECT tests.run('rotation: unknown message kind rejected',
  $$UPDATE public.site_settings SET announcement_items = '[{"id":"x","kind":"script","text":"x"}]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'סוג הודעה');
SELECT tests.run('rotation: bad end date rejected',
  $$UPDATE public.site_settings SET announcement_items = '[{"id":"x","kind":"text","text":"x","ends_at":"not a date"}]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'timestamp');
SELECT tests.run('rotation: an agent cannot change the messages',
  $$UPDATE public.site_settings SET announcement_items = '[]'::jsonb WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a2', NULL, 0);
SELECT tests.check('rotation: store A messages unchanged after the rejected saves',
  $$SELECT jsonb_array_length(announcement_items) = 3 FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);

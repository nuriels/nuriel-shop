-- ============================================================
-- חלק 35ב: ברכה ותמונה לשבת ולחגים (site_settings.shabbat_message /
-- shabbat_image_url, ו-message / image_url בכל חג). חנות B.
-- ============================================================
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);

SELECT tests.check('greetings: new columns exist, empty by default',
  $$SELECT shabbat_message IS NULL AND shabbat_image_url IS NULL
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.run('greetings: owner sets a Shabbat greeting + image',
  $$UPDATE public.site_settings SET shabbat_message = 'שבת שלום ומבורך', shabbat_image_url = 'https://cdn.example.com/shabbat.jpg' WHERE id = true$$,
  :B1, NULL, 1);
SELECT tests.run('greetings: Shabbat greeting longer than 120 → rejected',
  $$UPDATE public.site_settings SET shabbat_message = repeat('א', 121) WHERE id = true$$, :B1, 'site_settings_shabbat_message_check');
SELECT tests.run('greetings: empty (spaces only) Shabbat greeting → rejected (use NULL)',
  $$UPDATE public.site_settings SET shabbat_message = '   ' WHERE id = true$$, :B1, 'site_settings_shabbat_message_check');
SELECT tests.run('greetings: image that is not http(s) → rejected',
  $$UPDATE public.site_settings SET shabbat_image_url = 'javascript:alert(1)' WHERE id = true$$, :B1, 'site_settings_shabbat_image_check');
SELECT tests.run('greetings: holiday with greeting + image is kept (spaces cleaned)',
  $$UPDATE public.site_settings SET holidays = '[{"name":"סוכות","start":"2027-10-15T16:00","end":"2027-10-16T20:30","message":"  חג   סוכות שמח ","image_url":"https://cdn.example.com/sukkot.jpg"}]' WHERE id = true$$,
  :B1, NULL, 1);
SELECT tests.check('greetings: stored message / image_url',
  $$SELECT holidays -> 0 ->> 'message' = 'חג סוכות שמח' AND holidays -> 0 ->> 'image_url' = 'https://cdn.example.com/sukkot.jpg'
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.run('greetings: holiday without greeting / image still fine (null fields)',
  $$UPDATE public.site_settings SET holidays = '[{"name":"פסח","start":"2027-04-21T16:00","end":"2027-04-22T20:30"}]' WHERE id = true$$, :B1, NULL, 1);
SELECT tests.check('greetings: … message and image_url are null',
  $$SELECT holidays -> 0 -> 'message' = 'null'::jsonb AND holidays -> 0 -> 'image_url' = 'null'::jsonb
      FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.run('greetings: holiday greeting over 120 → rejected',
  $$UPDATE public.site_settings SET holidays = jsonb_build_array(jsonb_build_object('name','חג','start','2027-04-21T16:00','end','2027-04-22T20:30','message',repeat('ב',121))) WHERE id = true$$,
  :B1, 'הברכה עד 120');
SELECT tests.run('greetings: holiday image with a bad scheme → rejected',
  $$UPDATE public.site_settings SET holidays = '[{"name":"חג","start":"2027-04-21T16:00","end":"2027-04-22T20:30","image_url":"data:image/png;base64,AAA"}]' WHERE id = true$$,
  :B1, 'כתובת התמונה');
SELECT tests.check('greetings: store_rest_state still works with the new fields',
  $$SELECT NOT (public.store_rest_state('70000000-0000-0000-0000-00000000000b', '2026-10-14 12:00+03') ->> 'closed')::boolean$$);
UPDATE public.site_settings SET shabbat_message = NULL, shabbat_image_url = NULL, holidays = '[]'::jsonb
 WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';

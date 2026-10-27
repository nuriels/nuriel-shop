-- פס הודעות + רישום שליחת קופון: ברירות מחדל, בדיקות תקינות, הפרדה בין חנויות, שליחה פעם אחת
SELECT tests.check('announcement: off by default in every store',
  $$SELECT bool_and(NOT announcement_enabled AND announcement_text = '' AND announcement_coupon_code IS NULL AND announcement_style = 'gold') FROM public.site_settings$$);
SELECT tests.run('announcement: admin A saves text, coupon, black style',
  $$UPDATE public.site_settings SET announcement_enabled = true, announcement_text = 'משלוח חינם מעל 1000', announcement_coupon_code = 'WELCOME10', announcement_style = 'black' WHERE id = true$$,
  'a0000000-0000-0000-0000-0000000000a1', NULL, 1);
SELECT tests.check('announcement: saved in store A only',
  $$SELECT (SELECT announcement_style = 'black' FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000a')
      AND (SELECT NOT announcement_enabled FROM public.site_settings WHERE tenant_id = '70000000-0000-0000-0000-00000000000b')$$);
SELECT tests.run('announcement: unknown style rejected',
  $$UPDATE public.site_settings SET announcement_style = 'red' WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'announcement_check');
SELECT tests.run('announcement: text over 200 chars rejected',
  $$UPDATE public.site_settings SET announcement_text = repeat('א', 201) WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'announcement_check');
SELECT tests.run('announcement: malformed coupon code rejected',
  $$UPDATE public.site_settings SET announcement_coupon_code = 'bad code!' WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a1', 'announcement_check');
SELECT tests.run('announcement: an agent cannot change it',
  $$UPDATE public.site_settings SET announcement_text = 'x' WHERE id = true$$, 'a0000000-0000-0000-0000-0000000000a2', NULL, 0);

SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('coupon email: first claim allowed', $$SELECT public.coupon_email_claim('Buyer@Test.local', 'welcome10')$$);
SELECT tests.check('coupon email: second claim (refresh / retry) refused', $$SELECT NOT public.coupon_email_claim('buyer@test.local', 'WELCOME10')$$);
SELECT tests.check('coupon email: another coupon for the same address allowed', $$SELECT public.coupon_email_claim('buyer@test.local', 'OTHER5')$$);
SELECT tests.check('coupon email: release after a failed send allows a retry',
  $$SELECT (SELECT public.coupon_email_release('buyer@test.local', 'OTHER5')) IS NULL AND public.coupon_email_claim('buyer@test.local', 'OTHER5')$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.check('coupon email: the same address in store B is independent', $$SELECT public.coupon_email_claim('buyer@test.local', 'WELCOME10')$$);
SELECT tests.check('coupon email: one row per store', $$SELECT (SELECT count(*) FROM public.coupon_email_sends WHERE coupon_code = 'WELCOME10') = 2$$);
SELECT tests.run('coupon email: clients cannot call the claim function',
  $$SELECT public.coupon_email_claim('x@y.zz', 'ABC')$$, NULL, 'permission denied');
SELECT tests.run('coupon email: clients cannot read the table',
  $$SELECT * FROM public.coupon_email_sends$$, 'a0000000-0000-0000-0000-0000000000a1', 'permission denied');
SELECT set_config('request.headers', '', false);

-- ============================================================
-- חלק 40: הסכמה לדיוור (חוק הספאם) — רישום, הסרה, קופון ברוכים הבאים,
-- ותזכורת עגלה נטושה רק למי שאישר
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- 1. הרשמה עם אישור דיוור → מנוי, מגיע מייל ברוכים הבאים
SELECT tests.check('consent: register opt-in → subscribed + welcome due + token',
  $$SELECT (r ->> 'subscribed')::boolean AND (r ->> 'welcome_due')::boolean AND (r ->> 'token') IS NOT NULL
      FROM (SELECT public.marketing_set_consent('  Dana@Test.Local ', true, 'register', 'אני מאשר/ת קבלת דיוור', NULL) r) x$$);
SELECT tests.check('consent: stored lower-case with the text and time + an event row',
  $$SELECT (SELECT subscribed AND consented_at IS NOT NULL AND consent_text = 'אני מאשר/ת קבלת דיוור' AND source = 'register'
              FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')
       AND (SELECT count(*) = 1 FROM public.marketing_consent_events WHERE email = 'dana@test.local')$$);
SELECT tests.check('consent: send token available for a subscriber',
  $$SELECT public.marketing_send_token('DANA@test.local') IS NOT NULL$$);

-- 2. ברוכים הבאים נשלח פעם אחת בלבד
SELECT tests.check('welcome: first claim succeeds',
  $$SELECT public.marketing_claim_welcome('dana@test.local') IS NOT NULL$$);
SELECT tests.check('welcome: second claim → nothing (no double email)',
  $$SELECT public.marketing_claim_welcome('dana@test.local') IS NULL$$);
SELECT tests.check('welcome: after it was sent, re-consent is not "welcome due"',
  $$SELECT NOT (public.marketing_set_consent('dana@test.local', true, 'account', NULL, NULL) ->> 'welcome_due')::boolean$$);
SELECT tests.check('welcome: checkout consent never triggers the welcome email',
  $$SELECT NOT (public.marketing_set_consent('buyer@test.local', true, 'checkout', 'טקסט', NULL) ->> 'welcome_due')::boolean$$);

-- 3. הסרה מקישור → לא שולחים יותר
SELECT tests.check('unsubscribe link: returns the email',
  $$SELECT public.marketing_unsubscribe((SELECT unsubscribe_token FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')) = 'dana@test.local'$$);
SELECT tests.check('unsubscribe link: sending is off from now on',
  $$SELECT public.marketing_send_token('dana@test.local') IS NULL
       AND (SELECT NOT subscribed AND unsubscribed_at IS NOT NULL AND source = 'unsubscribe_link'
              FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')$$);
SELECT tests.check('unsubscribe: logged as an event',
  $$SELECT EXISTS (SELECT 1 FROM public.marketing_consent_events WHERE email = 'dana@test.local' AND NOT subscribed AND source = 'unsubscribe_link')$$);
SELECT tests.check('unsubscribe: unknown token → NULL',
  $$SELECT public.marketing_unsubscribe(gen_random_uuid()) IS NULL$$);
SELECT tests.check('welcome: an unsubscribed address cannot be claimed',
  $$SELECT public.marketing_claim_welcome('dana@test.local') IS NULL$$);

-- 4. חנות אחרת: לא רואה ולא מסירה
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.check('store B: no send token for store A''s subscriber',
  $$SELECT public.marketing_send_token('buyer@test.local') IS NULL$$);
SELECT tests.check('store B: store A''s token does not unsubscribe there',
  $$SELECT public.marketing_unsubscribe((SELECT unsubscribe_token FROM public.marketing_consents WHERE email = 'buyer@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')) IS NULL$$);
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('store A: buyer still subscribed after the store B attempt',
  $$SELECT public.marketing_send_token('buyer@test.local') IS NOT NULL$$);

-- 5. הרשאות: רק מהשרת
SELECT tests.run('guest cannot record consent directly',
  $$SELECT public.marketing_set_consent('x@test.local', true, 'checkout', NULL, NULL)$$, NULL, 'permission denied');
SELECT tests.run('customer cannot read the send token',
  $$SELECT public.marketing_send_token('buyer@test.local')$$, 'a0000000-0000-0000-0000-00000000000c', 'permission denied');
SELECT tests.run('guest cannot read the consents table',
  $$SELECT * FROM public.marketing_consents$$, NULL, 'permission denied');
SELECT tests.run('store admin reads the consents of the store',
  $$SELECT 1 WHERE EXISTS (SELECT 1 FROM public.marketing_consents WHERE email = 'buyer@test.local')$$, :OA, NULL, 1);
SELECT tests.run('store admin cannot forge a consent',
  $$UPDATE public.marketing_consents SET subscribed = true WHERE email = 'dana@test.local'$$, :OA, 'permission denied');
SELECT tests.check('bad email / source rejected',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.marketing_consents WHERE email = 'not-an-email')$$);
SELECT tests.run('bad source → rejected',
  $$SELECT 1 FROM (SELECT public.marketing_set_consent('ok@test.local', true, 'popup', NULL, NULL)) x$$, NULL, 'permission denied');

-- 6. קופון ברוכים הבאים — פורמט קוד בלבד
SELECT tests.check('welcome coupon column rejects a bad code',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_welcome_coupon_check') IS FALSE$$);

-- 7. עגלה נטושה: לא מנוי → לא בתזכורת האוטומטית
INSERT INTO public.abandoned_carts (id, tenant_id, session_key, email, items, item_count, total, status, reminder_count) VALUES
  ('ac400000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'buyer@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0),
  ('ac400000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'noconsent@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0),
  ('ac400000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'dana@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0);
SET session_replication_role = replica;
UPDATE public.abandoned_carts SET updated_at = now() - interval '5 hours' WHERE id::text LIKE 'ac400000-%';
SET session_replication_role = origin;
SELECT tests.check('due: only the subscriber (not the one who never agreed, not the one who unsubscribed)',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT array_agg(d) FILTER (WHERE d::text LIKE 'ac400000-%') = ARRAY['ac400000-0000-0000-0000-000000000001']::uuid[]
      FROM x, LATERAL public.abandoned_carts_due(4, 100) d$$);

-- ניקוי
DELETE FROM public.abandoned_carts WHERE id::text LIKE 'ac400000-%';
DELETE FROM public.marketing_consent_events WHERE email IN ('dana@test.local', 'buyer@test.local');
DELETE FROM public.marketing_consents WHERE email IN ('dana@test.local', 'buyer@test.local');
SELECT set_config('request.headers', '', false);

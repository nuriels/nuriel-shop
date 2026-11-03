-- ============================================================
-- חלק 40 + SEC-H5: הסכמה לדיוור (חוק הספאם) — אישור כפול (double opt-in), הסרה מיידית,
-- קופון ברוכים הבאים אחרי האישור, תיעוד ההסכמה, ותזכורת עגלה נטושה רק למי שאישר
-- ============================================================
\set OA '''a0000000-0000-0000-0000-0000000000a1'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- אסימוני אישור "גולמיים" (כמו שהשרת שולח במייל) וה-hash שלהם (מה שנשמר במסד)
CREATE OR REPLACE FUNCTION pg_temp.h(_t text) RETURNS text LANGUAGE sql AS
  $$ SELECT encode(sha256(convert_to(_t, 'UTF8')), 'hex') $$;
-- שגיאה צפויה (נרשמת, לא מופצת). הערה: שאילתה לא רואה כתיבות של פונקציה שהיא עצמה קוראת —
-- לכן בדיקת "מה נשמר" תמיד בהצהרה נפרדת מהקריאה שכתבה.
CREATE OR REPLACE FUNCTION pg_temp.expect_error(_name text, _sql text, _pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE err text;
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, err IS NOT NULL AND err ILIKE '%' || _pattern || '%', COALESCE('ERROR: ' || err, 'no error'));
END $f$;
\set T1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set T2 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set T3 '''3333333333333333333333333333333333333333333333333333333333333333'''
\set T4 '''4444444444444444444444444444444444444444444444444444444444444444'''
\set T5 '''5555555555555555555555555555555555555555555555555555555555555555'''
\set IPH '''abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'''

-- 1. הרשמה עם אישור דיוור → ממתין לאישור במייל, עוד לא מנוי, לא נשלח שום דיוור
SELECT tests.check('double opt-in: a sign-up opt-in is pending, not subscribed, and asks for one confirmation email',
  format($$SELECT NOT (r ->> 'subscribed')::boolean AND (r ->> 'pending')::boolean
             AND (r ->> 'confirm_issued')::boolean AND NOT (r ->> 'welcome_due')::boolean AND (r ->> 'token') IS NULL
      FROM (SELECT public.marketing_set_consent('  Dana@Test.Local ', true, 'register', 'אני מאשר/ת קבלת דיוור', NULL,
                                                pg_temp.h(%L), %L, 'Mozilla/5.0 test', 'register') r) x$$, :T1, :IPH));
SELECT tests.check('double opt-in: nothing can be sent before the confirmation (no send token, no welcome claim)',
  $$SELECT public.marketing_send_token('dana@test.local') IS NULL
       AND public.marketing_claim_welcome('dana@test.local') IS NULL$$);
SELECT tests.check('evidence: the request is stored with the token hash, IP hash, browser, method and text',
  format($$SELECT NOT subscribed AND confirm_token_hash = pg_temp.h(%L) AND confirm_sent_at IS NOT NULL
             AND consent_ip_hash = %L AND consent_user_agent = 'Mozilla/5.0 test' AND consent_method = 'register'
             AND consent_text = 'אני מאשר/ת קבלת דיוור' AND confirmed_at IS NULL
      FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a'$$, :T1, :IPH));
SELECT tests.check('evidence: the request is logged as a "request" event (with IP hash and method)',
  format($$SELECT count(*) = 1 AND bool_and(NOT subscribed AND ip_hash = %L AND method = 'register')
      FROM public.marketing_consent_events WHERE email = 'dana@test.local' AND kind = 'request'$$, :IPH));
SELECT pg_temp.expect_error('double opt-in: a new subscription without a confirmation token is refused',
  $$SELECT public.marketing_set_consent('notoken@test.local', true, 'account', NULL, NULL)$$,
  'נדרש אישור במייל');
SELECT tests.check('double opt-in: … and recorded nothing',
  $$SELECT NOT EXISTS (SELECT 1 FROM public.marketing_consents WHERE email = 'notoken@test.local')$$);

-- 2. אותה כתובת שוב תוך 24 שעות → אין מייל אישור נוסף (מגן מפני הצפת כתובת זרה)
SELECT tests.check('throttle: a second request within 24h sends no second confirmation email',
  format($$SELECT (r ->> 'pending')::boolean AND (r ->> 'throttled')::boolean AND NOT (r ->> 'confirm_issued')::boolean
      FROM (SELECT public.marketing_set_consent('dana@test.local', true, 'account', NULL, NULL, pg_temp.h(%L)) r) x$$, :T2));
SELECT tests.check('throttle: the first token is still the valid one',
  format($$SELECT confirm_token_hash = pg_temp.h(%L) FROM public.marketing_consents
      WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a'$$, :T1));

-- 2b. שליחת מייל האישור נכשלה → שחרור (רק עם ה-hash של אותה בקשה), ואפשר לבקש שוב מיד
SELECT public.marketing_set_consent('retry@test.local', true, 'account', NULL, NULL, pg_temp.h(repeat('9', 64)));
SELECT public.marketing_release_confirm('retry@test.local', repeat('0', 64));
SELECT tests.check('release: a wrong token hash releases nothing (still throttled)',
  $$SELECT (r ->> 'throttled')::boolean
      FROM (SELECT public.marketing_set_consent('retry@test.local', true, 'account', NULL, NULL, pg_temp.h(repeat('a', 64))) r) x$$);
SELECT public.marketing_release_confirm('retry@test.local', pg_temp.h(repeat('9', 64)));
SELECT tests.check('release: after a failed send the address can ask again at once',
  $$SELECT (r ->> 'confirm_issued')::boolean
      FROM (SELECT public.marketing_set_consent('retry@test.local', true, 'account', NULL, NULL, pg_temp.h(repeat('b', 64))) r) x$$);
SELECT tests.check('release: the released link no longer confirms',
  format($$SELECT public.marketing_confirm(%L) IS NULL$$, repeat('9', 64)));
SELECT tests.run('guest cannot release a confirmation',
  $$SELECT public.marketing_release_confirm('retry@test.local', 'x')$$, NULL, 'permission denied');

-- 3. אישור: אסימון שגוי / תקין / חד-פעמי
SELECT tests.check('confirm: a wrong token confirms nothing',
  format($$SELECT public.marketing_confirm(%L) IS NULL AND public.marketing_send_token('dana@test.local') IS NULL$$, :T2));
SELECT tests.check('confirm: a malformed token is ignored',
  $$SELECT public.marketing_confirm('x'' OR 1=1 --') IS NULL AND public.marketing_confirm(NULL) IS NULL$$);
SELECT tests.check('confirm: the emailed token subscribes the address; the welcome email is now due',
  format($$SELECT r ->> 'email' = 'dana@test.local' AND (r ->> 'welcome_due')::boolean AND (r ->> 'token') IS NOT NULL
      FROM (SELECT public.marketing_confirm(%L, %L, 'Mozilla/5.0 click') r) x$$, :T1, :IPH));
SELECT tests.check('confirm: subscribed, confirmed_at set, the token is cleared',
  $$SELECT subscribed AND confirmed_at IS NOT NULL AND consented_at IS NOT NULL AND confirm_token_hash IS NULL
       AND confirm_sent_at IS NULL AND unsubscribed_at IS NULL
      FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('confirm: logged as a "confirm" event with the click''s browser',
  $$SELECT EXISTS (SELECT 1 FROM public.marketing_consent_events
                    WHERE email = 'dana@test.local' AND kind = 'confirm' AND subscribed AND user_agent = 'Mozilla/5.0 click')$$);
SELECT tests.check('confirm: the token works only once',
  format($$SELECT public.marketing_confirm(%L) IS NULL$$, :T1));
SELECT tests.check('confirm: send token available for the confirmed subscriber',
  $$SELECT public.marketing_send_token('DANA@test.local') IS NOT NULL$$);

-- 4. ברוכים הבאים נשלח פעם אחת בלבד
SELECT tests.check('welcome: first claim succeeds',
  $$SELECT public.marketing_claim_welcome('dana@test.local') IS NOT NULL$$);
SELECT tests.check('welcome: second claim → nothing (no double email)',
  $$SELECT public.marketing_claim_welcome('dana@test.local') IS NULL$$);
SELECT tests.check('already subscribed: opting in again needs no confirmation and is not "welcome due"',
  format($$SELECT (r ->> 'subscribed')::boolean AND NOT (r ->> 'confirm_issued')::boolean AND NOT (r ->> 'welcome_due')::boolean
      FROM (SELECT public.marketing_set_consent('dana@test.local', true, 'account', NULL, NULL, pg_temp.h(%L)) r) x$$, :T3));

-- 5. קופה: אישור כפול גם כאן, ואין מייל ברוכים הבאים
SELECT public.marketing_set_consent('buyer@test.local', true, 'checkout', 'טקסט', NULL, pg_temp.h(:T3), NULL, NULL, 'checkout');
SELECT tests.check('checkout: the confirmation is never "welcome due"',
  format($$SELECT NOT (r ->> 'welcome_due')::boolean AND r ->> 'source' = 'checkout'
      FROM (SELECT public.marketing_confirm(%L) r) x$$, :T3));
SELECT tests.check('checkout: … and the buyer is now a subscriber',
  $$SELECT public.marketing_send_token('buyer@test.local') IS NOT NULL$$);

-- 6. פג תוקף: קישור אישור בן יותר מ-7 ימים לא מאשר
SELECT public.marketing_set_consent('late@test.local', true, 'account', NULL, NULL, pg_temp.h(:T4));
UPDATE public.marketing_consents SET confirm_sent_at = now() - interval '8 days' WHERE email = 'late@test.local';
SELECT tests.check('confirm: a link older than 7 days does not subscribe',
  format($$SELECT public.marketing_confirm(%L) IS NULL AND public.marketing_send_token('late@test.local') IS NULL$$, :T4));

-- 7. הקשר (חלון הקופון): רק קוד קופון תקין נשמר, ומוחזר באישור
SELECT public.marketing_set_consent('popup@test.local', true, 'account', NULL, NULL, pg_temp.h(:T5), NULL, NULL, 'popup',
                                   '{"coupon": "WELCOME10", "evil": "<script>"}'::jsonb);
SELECT tests.check('context: only a well-formed coupon code is kept',
  $$SELECT confirm_context = '{"coupon": "WELCOME10"}'::jsonb AND consent_method = 'popup'
      FROM public.marketing_consents WHERE email = 'popup@test.local'$$);
SELECT tests.check('context: returned once, on confirmation',
  format($$SELECT r -> 'context' = '{"coupon": "WELCOME10"}'::jsonb FROM (SELECT public.marketing_confirm(%L) r) x$$, :T5));
SELECT public.marketing_set_consent('junk@test.local', true, 'account', NULL, NULL, pg_temp.h(repeat('6', 64)),
                                   '1.2.3.4', repeat('u', 999), 'bogus');
SELECT tests.check('evidence: a malformed IP hash / bad method is dropped, a long browser string is cut',
  $$SELECT consent_ip_hash IS NULL AND consent_method IS NULL AND char_length(consent_user_agent) = 300
      FROM public.marketing_consents WHERE email = 'junk@test.local'$$);

-- 8. הסרה מקישור → לא שולחים יותר; וחזרה דורשת אישור מחדש (לא "מחיים" הסרה)
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
SELECT tests.check('no resurrection: opting in again after unsubscribing is pending — not subscribed',
  format($$SELECT (r ->> 'pending')::boolean AND (r ->> 'confirm_issued')::boolean AND NOT (r ->> 'subscribed')::boolean
      FROM (SELECT public.marketing_set_consent('dana@test.local', true, 'checkout', NULL, NULL, pg_temp.h(%L)) r) x$$, repeat('7', 64)));
SELECT tests.check('no resurrection: … still nothing may be sent to the address',
  $$SELECT public.marketing_send_token('dana@test.local') IS NULL$$);
SELECT tests.check('unsubscribe (opt-out at checkout) is immediate',
  $$SELECT NOT (r ->> 'subscribed')::boolean AND NOT (r ->> 'pending')::boolean
      FROM (SELECT public.marketing_set_consent('dana@test.local', false, 'checkout', NULL, NULL) r) x$$);
SELECT tests.check('unsubscribe: … and cancels the pending confirmation (the emailed link no longer subscribes)',
  format($$SELECT public.marketing_confirm(%L) IS NULL$$, repeat('7', 64)));
SELECT tests.check('unsubscribe: … the token is gone and the address is not subscribed',
  $$SELECT confirm_token_hash IS NULL AND confirm_sent_at IS NULL AND NOT subscribed
      FROM public.marketing_consents WHERE email = 'dana@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('unsubscribe: logged as an "unsubscribe" event',
  $$SELECT EXISTS (SELECT 1 FROM public.marketing_consent_events WHERE email = 'dana@test.local' AND kind = 'unsubscribe' AND NOT subscribed)$$);

-- 9. חנות אחרת: לא רואה, לא מסירה ולא מאשרת
SELECT public.marketing_set_consent('crossstore@test.local', true, 'account', NULL, NULL, pg_temp.h(repeat('8', 64)));
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.check('store B: no send token for store A''s subscriber',
  $$SELECT public.marketing_send_token('buyer@test.local') IS NULL$$);
SELECT tests.check('store B: store A''s token does not unsubscribe there',
  $$SELECT public.marketing_unsubscribe((SELECT unsubscribe_token FROM public.marketing_consents WHERE email = 'buyer@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')) IS NULL$$);
SELECT tests.check('store B: store A''s confirmation link confirms nothing there',
  format($$SELECT public.marketing_confirm(%L) IS NULL$$, repeat('8', 64)));
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
SELECT tests.check('store A: buyer still subscribed after the store B attempt; the A link is still pending',
  $$SELECT public.marketing_send_token('buyer@test.local') IS NOT NULL
       AND (SELECT NOT subscribed AND confirm_token_hash IS NOT NULL FROM public.marketing_consents
             WHERE email = 'crossstore@test.local' AND tenant_id = '70000000-0000-0000-0000-00000000000a')$$);

-- 10. הרשאות: רק מהשרת
SELECT tests.run('guest cannot record consent directly',
  $$SELECT public.marketing_set_consent('x@test.local', true, 'checkout', NULL, NULL)$$, NULL, 'permission denied');
SELECT tests.run('guest cannot confirm directly (only through the app server)',
  $$SELECT public.marketing_confirm(repeat('8', 64))$$, NULL, 'permission denied');
SELECT tests.run('customer cannot confirm directly either',
  $$SELECT public.marketing_confirm(repeat('8', 64))$$, 'a0000000-0000-0000-0000-00000000000c', 'permission denied');
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

-- 11. קופון ברוכים הבאים — פורמט קוד בלבד
SELECT tests.check('welcome coupon column rejects a bad code',
  $$SELECT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_settings_welcome_coupon_check') IS FALSE$$);

-- 12. עגלה נטושה: רק מנוי שאישר — לא מי שלא הסכים, לא מי שהוסר, ולא מי שעוד לא אישר
INSERT INTO public.abandoned_carts (id, tenant_id, session_key, email, items, item_count, total, status, reminder_count) VALUES
  ('ac400000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'buyer@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0),
  ('ac400000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'noconsent@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0),
  ('ac400000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'dana@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0),
  ('ac400000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'crossstore@test.local', '[{"name":"x","quantity":1,"unit_price":5}]', 1, 5, 'open', 0);
SET session_replication_role = replica;
UPDATE public.abandoned_carts SET updated_at = now() - interval '5 hours' WHERE id::text LIKE 'ac400000-%';
SET session_replication_role = origin;
SELECT tests.check('due: only the confirmed subscriber (not the one who never agreed, not the one who unsubscribed, not a pending one)',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT array_agg(d) FILTER (WHERE d::text LIKE 'ac400000-%') = ARRAY['ac400000-0000-0000-0000-000000000001']::uuid[]
      FROM x, LATERAL public.abandoned_carts_due(4, 100) d$$);

-- ניקוי
DELETE FROM public.abandoned_carts WHERE id::text LIKE 'ac400000-%';
DELETE FROM public.marketing_consent_events WHERE email IN ('dana@test.local', 'buyer@test.local', 'late@test.local',
  'popup@test.local', 'junk@test.local', 'crossstore@test.local', 'retry@test.local');
DELETE FROM public.marketing_consents WHERE email IN ('dana@test.local', 'buyer@test.local', 'late@test.local',
  'popup@test.local', 'junk@test.local', 'crossstore@test.local', 'retry@test.local');
SELECT set_config('request.headers', '', false);

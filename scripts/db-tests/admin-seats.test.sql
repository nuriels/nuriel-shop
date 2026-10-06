-- ============================================================
-- מגבלת מנהלים לפי חבילה + בקשות שדרוג (upgrade_requests)
-- ============================================================
\set P   '''a0000000-0000-0000-0000-0000000000f0'''
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set AGA '''a0000000-0000-0000-0000-0000000000a2'''
\set B1  '''a0000000-0000-0000-0000-0000000000b1'''

-- בקשה "מהשרת" (service_role, בלי משתמש) — כמו createStaffUser
CREATE OR REPLACE FUNCTION tests.server(_name TEXT, _sql TEXT, _expect_error TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $f$
DECLARE err TEXT;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN err := SQLERRM;
  END;
  INSERT INTO tests.results (name, ok, detail)
  VALUES (_name, CASE WHEN _expect_error IS NULL THEN err IS NULL ELSE COALESCE(err ILIKE '%' || _expect_error || '%', false) END,
          COALESCE('ERROR: ' || err, 'ok'));
END; $f$;
CREATE OR REPLACE FUNCTION tests.as_store(_tid TEXT) RETURNS VOID LANGUAGE sql AS $f$
  SELECT set_config('request.headers', json_build_object('x-tenant-id', _tid)::text, false);
$f$;

-- ---------- מגבלות ----------
SELECT tests.check('limit: basic = 1', $$SELECT public.tenant_admin_limit('70000000-0000-0000-0000-00000000000a') = 1$$);
SELECT tests.check('limit: premium = 3', $$SELECT public.tenant_admin_limit('70000000-0000-0000-0000-00000000000b') = 3$$);
SELECT tests.check('limit: trial = 3 (like premium)', $$SELECT public.tenant_admin_limit('70000000-0000-0000-0000-00000000000c') = 3$$);

-- ---------- אכיפה ב-user_roles ----------
SELECT tests.server('A (basic, owner only): server adds a 2nd admin -> rejected',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c1', 'new1@test.local', 'new1', 'admin', true)$$,
  'הגעת למגבלת המנהלים');
SELECT tests.server('A: adding a warehouse worker is not limited',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c2', 'new2@test.local', 'new2', 'warehouse', true)$$);
SELECT tests.server('A: promoting the agent to admin -> rejected',
  $$UPDATE public.user_roles SET role = 'admin' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
      AND user_id = 'a0000000-0000-0000-0000-0000000000a2'$$, 'הגעת למגבלת המנהלים');
SELECT tests.server('A: the owner keeps working (update of other fields)',
  $$UPDATE public.user_roles SET display_name = 'בעלים' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
      AND user_id = 'a0000000-0000-0000-0000-0000000000a1'$$);
SELECT tests.server('B (premium, 2 admins): 3rd admin -> allowed',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000c1', 'new1@test.local', 'new1', 'admin', true)$$);
SELECT tests.server('B: 4th admin -> rejected',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000c3', 'new3@test.local', 'new3', 'admin', true)$$,
  'הגעת למגבלת המנהלים');
SELECT tests.check('platform admin may exceed (exempt): 4th admin in B as platform admin',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true)),
         ins AS (INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
                 SELECT '70000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-0000000000c3', 'new3@test.local', 'new3', 'admin', true
                   FROM x RETURNING 1)
    SELECT count(*) = 1 FROM ins$$);
SELECT tests.server('cleanup: remove the platform-added admin',
  $$DELETE FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND user_id = 'a0000000-0000-0000-0000-0000000000c3'$$);

-- ---------- מצב המנהלים לחנות ----------
SELECT tests.as_store('70000000-0000-0000-0000-00000000000a');
SELECT tests.run('A owner: store_admin_seats()', $$SELECT public.store_admin_seats()$$, :OA, NULL, 1);
SELECT tests.check('A seats: basic, limit 1, used 1, no request',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT s->>'plan' = 'basic' AND (s->>'limit')::int = 1 AND (s->>'used')::int = 1 AND s->'request' = 'null'::jsonb
      FROM x, LATERAL (SELECT public.store_admin_seats() s) q$$);
SELECT tests.run('A agent: store_admin_seats() -> no permission', $$SELECT public.store_admin_seats()$$, :AGA, 'אין הרשאה');
SELECT tests.run('A agent: cannot request an upgrade', $$SELECT public.request_extra_admin()$$, :AGA, 'רק מנהל החנות');

-- ---------- זרימת הבקשה ----------
SELECT tests.run('A owner: send upgrade request', $$SELECT public.request_extra_admin()$$, :OA, NULL, 1);
SELECT tests.run('A owner: second click returns the same request', $$SELECT public.request_extra_admin()$$, :OA, NULL, 1);
SELECT tests.check('one open request for A, status pending',
  $$SELECT count(*) = 1 AND bool_and(status = 'pending') FROM public.upgrade_requests
     WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.run('A owner: cannot update the request directly',
  $$UPDATE public.upgrade_requests SET status = 'approved'$$, :OA, 'permission denied');
SELECT tests.run('A owner: cannot send a payment link', $$SELECT public.platform_send_upgrade_link(
     (SELECT id FROM public.upgrade_requests LIMIT 1), 'https://pay.example/x')$$, :OA, 'אין הרשאה');
SELECT tests.run('A owner: cannot approve', $$SELECT public.platform_approve_upgrade(
     (SELECT id FROM public.upgrade_requests LIMIT 1))$$, :OA, 'אין הרשאה');
SELECT tests.run('A owner sees own request (RLS)', $$SELECT 1 FROM public.upgrade_requests$$, :OA, NULL, 1);
SELECT tests.as_store('70000000-0000-0000-0000-00000000000b');
SELECT tests.run('B admin does not see A''s request (RLS)', $$SELECT 1 FROM public.upgrade_requests$$, :B1, NULL, 0);
SELECT tests.as_store('70000000-0000-0000-0000-00000000000a');
SELECT tests.run('B admin with A''s header -> no permission', $$SELECT public.store_admin_seats()$$, :B1, 'אין הרשאה');

SELECT tests.run('platform: list requests', $$SELECT public.platform_upgrade_requests()$$, :P, NULL, 1);
SELECT tests.check('platform list: A''s request with store name + limits',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f0', true))
    SELECT r->0->>'tenant_name' = 'חנות A' AND (r->0->>'admin_limit')::int = 1 AND (r->0->>'admins_used')::int = 1
      FROM x, LATERAL (SELECT public.platform_upgrade_requests() r) q$$);
SELECT tests.run('platform: http link rejected', $$SELECT public.platform_send_upgrade_link(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'), 'http://pay.example/x')$$,
  :P, 'https://');
SELECT tests.run('platform: send payment link', $$SELECT public.platform_send_upgrade_link(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'), ' https://pay.example/abc ')$$,
  :P, NULL, 1);
SELECT tests.check('A seats: request payment_link_sent with the (trimmed) url',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT s->'request'->>'status' = 'payment_link_sent' AND s->'request'->>'payment_url' = 'https://pay.example/abc'
      FROM x, LATERAL (SELECT public.store_admin_seats() s) q$$);
SELECT tests.run('platform: approve', $$SELECT public.platform_approve_upgrade(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'))$$, :P, NULL, 1);
SELECT tests.run('platform: approve twice -> rejected', $$SELECT public.platform_approve_upgrade(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'))$$, :P, 'כבר אושרה');
SELECT tests.check('A: extra_admins_count = 1 (not 2), limit 2',
  $$SELECT s.extra_admins_count = 1 AND public.tenant_admin_limit(s.tenant_id) = 2
      FROM public.tenant_subscriptions s WHERE s.tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('A seats: no open request, 1 extra seat renewing in a year',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT s->'request' = 'null'::jsonb AND jsonb_array_length(s->'extra_seats') = 1
           AND (s->'extra_seats'->0->>'renews_at')::timestamptz > now() + interval '364 days'
      FROM x, LATERAL (SELECT public.store_admin_seats() s) q$$);
SELECT tests.server('A: now a 2nd admin is allowed',
  $$INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
    VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000c1', 'new1@test.local', 'new1', 'admin', true)$$);
SELECT tests.server('A: a 3rd admin -> rejected again (limit 2)',
  $$UPDATE public.user_roles SET role = 'admin' WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'
      AND user_id = 'a0000000-0000-0000-0000-0000000000a2'$$, 'הגעת למגבלת המנהלים בחבילה שלך (2)');
SELECT tests.run('A owner: a new request after approval', $$SELECT public.request_extra_admin()$$, :OA, NULL, 1);
SELECT tests.run('platform: delete the open request', $$SELECT public.platform_delete_upgrade_request(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'pending'))$$,
  :P, NULL, 1);
SELECT tests.run('platform: cannot delete an approved request', $$SELECT public.platform_delete_upgrade_request(
     (SELECT id FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a' AND status = 'approved'))$$,
  :P, 'רק בקשה שעוד לא אושרה');
SELECT tests.run('guest cannot read requests', $$SELECT 1 FROM public.upgrade_requests$$, NULL, 'permission denied');

-- ---------- הורדת חבילה: מנהלים קיימים נשארים ----------
SELECT tests.server('B: downgrade to basic (3 admins stay)',
  $$UPDATE public.tenant_subscriptions SET plan_type = 'basic' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'$$);
SELECT tests.check('B: still 3 admins after downgrade',
  $$SELECT count(*) = 3 FROM public.user_roles WHERE tenant_id = '70000000-0000-0000-0000-00000000000b' AND role = 'admin'$$);
SELECT tests.server('B: existing admin edit still works',
  $$UPDATE public.user_roles SET display_name = 'מנהל' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b'
      AND user_id = 'a0000000-0000-0000-0000-0000000000b2'$$);

-- ניקוי: חזרה למצב ה-fixtures
SELECT set_config('request.headers', '', false);
DELETE FROM public.upgrade_requests;
DELETE FROM public.user_roles WHERE user_id IN ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c3');
UPDATE public.tenant_subscriptions SET extra_admins_count = 0;
UPDATE public.tenant_subscriptions SET plan_type = 'premium' WHERE tenant_id = '70000000-0000-0000-0000-00000000000b';

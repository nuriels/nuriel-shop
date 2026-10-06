-- ============================================================
-- חלק 27: abandoned_carts_due — סלים שמחכים לתזכורת ראשונה (+ הסליקה סגורה)
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set AGA '''a0000000-0000-0000-0000-0000000000a2'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO public.abandoned_carts (id, tenant_id, session_key, email, items, item_count, total, status, reminder_count) VALUES
  ('ac000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'due@test.local', '[{"name":"יין","quantity":1,"unit_price":50}]', 1, 50, 'open', 0),
  ('ac000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'fresh@test.local', '[{"name":"יין","quantity":1,"unit_price":50}]', 1, 50, 'open', 0),
  ('ac000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'reminded@test.local', '[{"name":"יין","quantity":1,"unit_price":50}]', 1, 50, 'open', 1),
  ('ac000000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'recovered@test.local', '[{"name":"יין","quantity":1,"unit_price":50}]', 1, 50, 'recovered', 0),
  ('ac000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'old@test.local', '[{"name":"יין","quantity":2,"unit_price":50}]', 2, 100, 'open', 0),
  ('ac000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-00000000000b', gen_random_uuid(), 'b@test.local', '[{"name":"יין","quantity":1,"unit_price":50}]', 1, 50, 'open', 0);
SET session_replication_role = replica;
UPDATE public.abandoned_carts SET updated_at = now() - interval '5 hours' WHERE id IN ('ac000000-0000-0000-0000-000000000001', 'ac000000-0000-0000-0000-000000000003', 'ac000000-0000-0000-0000-000000000004');
UPDATE public.abandoned_carts SET updated_at = now() - interval '1 hour' WHERE id = 'ac000000-0000-0000-0000-000000000002';
UPDATE public.abandoned_carts SET updated_at = now() - interval '6 hours' WHERE id IN ('ac000000-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000006');
SET session_replication_role = origin;

SELECT tests.check('due (A, 4h): only the open, un-reminded, older carts — oldest first',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT array_agg(d ORDER BY n) = ARRAY['ac000000-0000-0000-0000-000000000005', 'ac000000-0000-0000-0000-000000000001']::uuid[]
      FROM x, LATERAL (SELECT d, row_number() OVER () n FROM public.abandoned_carts_due(4, 25) d) q$$);
SELECT tests.check('due with 7h: none',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT count(*) = 0 FROM x, LATERAL public.abandoned_carts_due(7, 25) d$$);
SELECT tests.check('due limit 1: the oldest only',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a1', true))
    SELECT array_agg(d) = ARRAY['ac000000-0000-0000-0000-000000000005']::uuid[] FROM x, LATERAL public.abandoned_carts_due(4, 1) d$$);
SELECT tests.run('agent: no permission', $$SELECT * FROM public.abandoned_carts_due()$$, :AGA, 'אין הרשאה');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.check('store B admin: only store B''s cart',
  $$WITH x AS (SELECT set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000b1', true))
    SELECT array_agg(d) = ARRAY['ac000000-0000-0000-0000-000000000006']::uuid[] FROM x, LATERAL public.abandoned_carts_due() d$$);
SELECT tests.run('guest: no permission', $$SELECT * FROM public.abandoned_carts_due()$$, NULL, 'permission denied');
SELECT tests.check('card clearing is closed in the DB (Hyp frozen)', $$SELECT NOT public.card_clearing_live()$$);

SELECT set_config('request.headers', '', false);
DELETE FROM public.abandoned_carts WHERE id::text LIKE 'ac000000-%';

-- ============================================================
-- חלק 25: סימון "נשלח מייל" למספר מעקב ולבקשת שדרוג (פעם אחת)
-- ============================================================
\set OA  '''a0000000-0000-0000-0000-0000000000a1'''
\set AGA '''a0000000-0000-0000-0000-0000000000a2'''
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);
INSERT INTO auth.users (id, email) VALUES ('a0000000-0000-0000-0000-0000000000d2', 'cust2.a@test.local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
VALUES ('70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d2', 'cust2.a@test.local', 'cust2_a', 'customer', true)
ON CONFLICT DO NOTHING;
INSERT INTO public.customer_profiles (user_id, business_name, age_confirmed, profile_completed)
VALUES ('a0000000-0000-0000-0000-0000000000d2', 'לקוח 2', true, true) ON CONFLICT DO NOTHING;
INSERT INTO public.orders (id, tenant_id, customer_id, kind)
VALUES ('0e000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000d2', 'order');

SELECT tests.run('claim without a tracking number → nothing to send',
  $$SELECT 1 WHERE (public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')->>'claimed')::boolean = false$$, :OA, NULL, 1);
UPDATE public.orders SET tracking_number = 'AB123' WHERE id = '0e000000-0000-0000-0000-000000000001';
SELECT tests.run('admin: first claim for AB123 → send',
  $$SELECT 1 WHERE (public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')->>'claimed')::boolean$$, :OA, NULL, 1);
SELECT tests.run('admin: second claim for the same number → no second email',
  $$SELECT 1 WHERE NOT (public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')->>'claimed')::boolean$$, :OA, NULL, 1);
SELECT tests.run('admin: release after a failed send',
  $$SELECT public.order_release_tracking_email('0e000000-0000-0000-0000-000000000001', NULL)$$, :OA, NULL, 1);
SELECT tests.run('admin: claim again after release → send',
  $$SELECT 1 WHERE (public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')->>'claimed')::boolean$$, :OA, NULL, 1);
UPDATE public.orders SET tracking_number = 'CD456' WHERE id = '0e000000-0000-0000-0000-000000000001';
SELECT tests.run('admin: a new number → send again',
  $$SELECT 1 WHERE (public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')->>'claimed')::boolean$$, :OA, NULL, 1);
SELECT tests.check('tracking_notified_number = CD456',
  $$SELECT tracking_notified_number = 'CD456' FROM public.orders WHERE id = '0e000000-0000-0000-0000-000000000001'$$);
SELECT tests.run('agent not assigned to the order → no permission',
  $$SELECT public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')$$, :AGA, 'אין הרשאה');
SELECT tests.run('customer → no permission',
  $$SELECT public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')$$,
  'a0000000-0000-0000-0000-0000000000d2', 'אין הרשאה');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000b')::text, false);
SELECT tests.run('admin of another store → not found',
  $$SELECT public.order_claim_tracking_email('0e000000-0000-0000-0000-000000000001')$$,
  'a0000000-0000-0000-0000-0000000000b1', 'ההזמנה לא נמצאה');
SELECT set_config('request.headers', json_build_object('x-tenant-id', '70000000-0000-0000-0000-00000000000a')::text, false);

-- ---------- בקשת שדרוג: התראה לפלטפורמה פעם אחת ----------
SELECT tests.run('store admin: send upgrade request', $$SELECT public.request_extra_admin()$$, :OA, NULL, 1);
SELECT tests.check('server: first claim → notify',
  $$SELECT public.upgrade_request_claim_notification(id) FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('server: second claim → already notified',
  $$SELECT NOT public.upgrade_request_claim_notification(id) FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a'$$);
SELECT tests.check('server: release, then claim again',
  $$SELECT public.upgrade_request_claim_notification(id)
      FROM (SELECT id, public.upgrade_request_release_notification(id) FROM public.upgrade_requests
             WHERE tenant_id = '70000000-0000-0000-0000-00000000000a') r$$);
SELECT tests.run('store admin cannot call the claim (service_role only)',
  $$SELECT public.upgrade_request_claim_notification((SELECT id FROM public.upgrade_requests LIMIT 1))$$, :OA, 'permission denied');

-- ניקוי
SELECT set_config('request.headers', '', false);
DELETE FROM public.upgrade_requests WHERE tenant_id = '70000000-0000-0000-0000-00000000000a';
DELETE FROM public.orders WHERE id = '0e000000-0000-0000-0000-000000000001';
